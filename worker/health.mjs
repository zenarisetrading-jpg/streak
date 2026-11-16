// Apple Health import: each person gets a private send-only key for an iPhone Shortcut,
// which posts the day's activity totals. Only a SHA-256 hash of each key is stored.
import {bumpRevision} from './records.mjs';
import {exportedWorkouts, placeWatchWorkout} from './watch-workouts.mjs';
import {endedWorkout, hasWorkoutFields} from './watch-session.mjs';

const TOKEN_PREFIX = 'dct_';
const TOKEN_BYTES = 32;
const MAX_BODY_CHARS = 4000;
// Workout uploads carry many Health samples, far more than the daily totals.
const MAX_EXPORT_CHARS = 1000000;
const MAX_DAY_SKEW = 2;
const DAILY_INGEST_LIMIT = 100;
const LIMITS = {activeKcal: 10000, restingKcal: 6000, steps: 150000, exerciseMinutes: 1440, workoutKcal: 6000, workoutMinutes: 1440, sleepHours: 24, restingHR: 250, hrv: 300};
const MAX_SLEEP_SAMPLES = 400;
// Kept to one decimal; everything else is rounded to whole numbers.
const DECIMAL_FIELDS = new Set(['sleepHours']);

const toHex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

function newToken() {
 const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
 return TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function tokenStatus(env, user, headers) {
 const row = await env.DB.prepare('SELECT created_at FROM health_tokens WHERE user_id = ?').bind(user).first();
 return Response.json({active: Boolean(row), createdAt: row?.created_at ?? null}, {headers});
}

// Creating a key replaces any previous one, so an old Shortcut stops working.
export async function createToken(env, user, headers) {
 const token = newToken();
 await env.DB.prepare('INSERT INTO health_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at')
  .bind(user, await sha256(token), new Date().toISOString()).run();
 return Response.json({token}, {headers});
}

export async function revokeToken(env, user, headers) {
 await env.DB.prepare('DELETE FROM health_tokens WHERE user_id = ?').bind(user).run();
 return new Response(null, {status: 204, headers});
}

// Shortcuts may send numbers as text with thousands separators and units ("1,234.5 kcal"),
// or a list when samples are grouped; take the first number and sum lists.
const number = value => {
 if (value === undefined || value === null || value === '') return null;
 if (Array.isArray(value)) return value.reduce((sum, v) => sum + (number(v) ?? 0), 0);
 if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
 const match = /-?\d[\d,]*(?:\.\d+)?/.exec(String(value));
 return match ? Number(match[0].replace(/,/g, '')) : NaN;
};

const lines = value => (Array.isArray(value) ? value : String(value ?? '').split('\n')).map(v => String(v).trim()).filter(Boolean);

// "1:17:04", "33:48" or "59" (seconds), as Shortcuts writes a sample's Duration.
export function durationSeconds(text) {
 if (!/^\d+(?::\d{1,2}){0,2}$/.test(text)) return NaN;
 return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

const SESSION_GAP_MS = 3 * 3600 * 1000;
// Shortcuts writes dates like "Nov 11, 2026 at 12:19 AM"; only their order and gaps matter here.
const sampleTime = text => Date.parse(String(text).replace(' at ', ' '));
const notSleep = stage => /in bed|awake/i.test(stage ?? '');

// Sleep arrives as one Health sample per stage ("Core", "Deep", "REM", "Awake", "In Bed"),
// as parallel lists of durations, stages and start times. The Shortcut's window can reach back
// into the night before, so only the latest session counts (samples less than 3 hours apart),
// and overlapping samples from different sources are counted once.
export function sleepHoursFrom(durations, stages, starts) {
 const times = lines(durations).slice(0, MAX_SLEEP_SAMPLES).map(durationSeconds);
 if (!times.length) return null;
 if (times.some(Number.isNaN)) return NaN;
 const labels = lines(stages);
 const begins = lines(starts).map(sampleTime);
 if (begins.length !== times.length || begins.some(Number.isNaN)) {
  return times.filter((_, i) => !notSleep(labels[i])).reduce((sum, t) => sum + t, 0) / 3600;
 }
 const samples = times.map((t, i) => ({start: begins[i], end: begins[i] + t * 1000, asleep: !notSleep(labels[i])})).sort((a, b) => a.start - b.start);
 let session = [];
 for (const sample of samples) {
  const sessionEnd = Math.max(...session.map(x => x.end), -Infinity);
  if (session.length && sample.start - sessionEnd > SESSION_GAP_MS) session = [];
  session.push(sample);
 }
 let total = 0, coveredTo = -Infinity;
 for (const {start, end} of session.filter(x => x.asleep)) {
  if (end > coveredTo) { total += end - Math.max(start, coveredTo); coveredTo = end; }
 }
 return total / 3600000;
}

// Shortcuts sends sample durations as newline-separated text or as a list, e.g. "1:17:04".
const isDurationList = value => Array.isArray(value) || (typeof value === 'string' && value.includes(':'));

export function parseHealth(body, now = new Date()) {
 if (!body || typeof body !== 'object' || Array.isArray(body)) return {error: 'Send a JSON object.'};
 const date = String(body.date ?? '').trim();
 if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z'))) return {error: 'date must look like 2026-11-10.'};
 const skew = Math.abs(Date.parse(date + 'T12:00:00Z') - now.getTime()) / 86400000;
 if (skew > MAX_DAY_SKEW) return {error: 'date must be within two days of today.'};
 const value = {date};
 for (const [field, max] of Object.entries(LIMITS)) {
  let n;
  if (field === 'sleepHours' && isDurationList(body.sleepHours)) {
   // A sleep value that cannot be read is dropped rather than rejecting the day's other numbers.
   n = sleepHoursFrom(body.sleepHours, body.sleepStages, body[Object.keys(body).find(k => /^sleepStart/.test(k))]);
   if (Number.isNaN(n) || n > max) n = null;
  } else n = number(body[field]);
  if (Number.isNaN(n) || (n !== null && (n < 0 || n > max))) return {error: field + ' must be a number between 0 and ' + max + '.'};
  value[field] = n === null ? null : DECIMAL_FIELDS.has(field) ? Math.round(n * 10) / 10 : Math.round(n);
 }
 if (Object.keys(LIMITS).every(field => value[field] === null)) return {error: 'Send at least one of ' + Object.keys(LIMITS).join(', ') + '.'};
 value.burnedKcal = value.activeKcal !== null && value.restingKcal !== null ? value.activeKcal + value.restingKcal : null;
 value.receivedAt = now.toISOString();
 return {value};
}

// A later upload for the same day updates the fields it sends and keeps the rest, so separate
// Shortcut runs cannot erase each other's data. Day totals only grow, so they keep the larger
// value; a 0 for sleep or heart readings means "no samples yet", not a reading.
const CUMULATIVE = new Set(['activeKcal', 'restingKcal', 'steps', 'exerciseMinutes', 'workoutKcal', 'workoutMinutes']);
const READINGS = new Set(['sleepHours', 'restingHR', 'hrv']);

export function mergeHealth(previous, next) {
 const merged = {...(previous || {})};
 for (const [field, n] of Object.entries(next)) {
  if (n === null || field === 'burnedKcal') continue;
  if (CUMULATIVE.has(field)) merged[field] = Math.max(Number(merged[field]) || 0, n);
  else if (READINGS.has(field) && n === 0 && merged[field] > 0) continue;
  else merged[field] = n;
 }
 merged.burnedKcal = merged.activeKcal > 0 && merged.restingKcal > 0 ? merged.activeKcal + merged.restingKcal : null;
 return merged;
}

async function userForToken(env, request) {
 const match = /^Bearer\s+(dct_[A-Za-z0-9_-]{20,80})$/.exec(request.headers.get('authorization') || '');
 if (!match) return null;
 const row = await env.DB.prepare('SELECT user_id FROM health_tokens WHERE token_hash = ?').bind(await sha256(match[1])).first();
 return row?.user_id ?? null;
}

async function dayWorkouts(env, user, day) {
 const {results} = await env.DB.prepare('SELECT record_key, payload FROM tracker_records WHERE user_id = ? AND record_key LIKE ?').bind(user, 'workout:' + day + ':%').all();
 return results.map(row => {
  try { return {key: row.record_key, value: row.payload ? JSON.parse(row.payload) : null}; }
  catch { console.error('Skipped an unreadable workout record:', row.record_key); return null; }
 }).filter(Boolean);
}

// Watch workouts are added, matched to a session the person logged, or updated. One the person
// removed stays removed: its record is still there with no payload.
async function workoutWrites(env, user, workouts, upsert) {
 const writes = [], days = new Map();
 for (const workout of workouts) {
  const day = workout.key.split(':')[1];
  if (!days.has(day)) days.set(day, await dayWorkouts(env, user, day));
  const records = days.get(day);
  const placed = placeWatchWorkout(workout, records);
  if (!placed) continue;
  // When it goes onto a logged session, its own key is marked removed so that removing that
  // session later does not bring the Watch workout back as a new one.
  const extra = placed.key !== workout.key && !records.some(r => r.key === workout.key) ? [{key: workout.key, value: null}] : [];
  for (const record of [placed, ...extra]) writes.push(upsert(record.key, record.value));
  days.set(day, [...records.filter(r => r.key !== placed.key && !extra.some(e => e.key === r.key)), placed, ...extra]);
 }
 return writes;
}

async function underDailyLimit(env, user, now) {
 const counter = await env.DB.prepare('INSERT INTO photo_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 RETURNING count')
  .bind(user, 'health:' + now.toISOString().slice(0, 10)).first();
 return Number(counter?.count) <= DAILY_INGEST_LIMIT;
}

const upserter = (env, user) => (key, payload) => env.DB.prepare('INSERT INTO tracker_records VALUES (?, ?, ?) ON CONFLICT(user_id, record_key) DO UPDATE SET payload = excluded.payload').bind(user, key, payload === null ? null : JSON.stringify(payload));

async function saveWorkouts(env, user, workouts, headers) {
 const writes = await workoutWrites(env, user, workouts, upserter(env, user));
 await env.DB.batch([...writes, bumpRevision(env, user)]);
 console.log(JSON.stringify({event: 'workout_ingest', user, workouts: workouts.length}));
 return Response.json({ok: true, workouts: workouts.length}, {headers});
}

async function saveDay(env, user, value, workouts, headers) {
 const existing = await env.DB.prepare('SELECT payload FROM tracker_records WHERE user_id = ? AND record_key = ?').bind(user, 'health:' + value.date).first();
 const merged = mergeHealth(existing?.payload ? JSON.parse(existing.payload) : null, value);
 const upsert = upserter(env, user);
 await env.DB.batch([upsert('health:' + value.date, merged), ...await workoutWrites(env, user, workouts, upsert), bumpRevision(env, user)]);
 console.log(JSON.stringify({event: 'health_ingest', user, date: value.date, workouts: workouts.length}));
 return Response.json({ok: true, date: value.date, burnedKcal: merged.burnedKcal, workouts: workouts.length}, {headers});
}

// Takes the Shortcut's daily totals (with the workout that just ended, from the end-of-workout
// Shortcut) or a Health Auto Export workout upload.
export async function ingestHealth(request, env, headers) {
 if (request.method !== 'POST') return Response.json({error: 'Use POST.'}, {status: 405, headers});
 const user = await userForToken(env, request);
 if (!user) return Response.json({error: 'Invalid or revoked key. Create a new one in the app.'}, {status: 401, headers});
 const raw = await request.text();
 if (raw.length > MAX_EXPORT_CHARS) return Response.json({error: 'Request too large.'}, {status: 413, headers});
 let body;
 try { body = JSON.parse(raw); } catch { return Response.json({error: 'Send JSON.'}, {status: 400, headers}); }
 const now = new Date();
 const workouts = exportedWorkouts(body, now);
 if (!workouts && !hasWorkoutFields(body) && raw.length > MAX_BODY_CHARS) return Response.json({error: 'Request too large.'}, {status: 413, headers});
 const parsed = workouts ? null : parseHealth(body, now);
 if (parsed?.error) return Response.json({error: parsed.error}, {status: 400, headers});
 if (!await underDailyLimit(env, user, now)) return Response.json({error: 'Too many uploads today.'}, {status: 429, headers});
 if (workouts) return saveWorkouts(env, user, workouts, headers);
 const ended = endedWorkout(body, now);
 return saveDay(env, user, parsed.value, ended ? [ended] : [], headers);
}
