// Apple Watch workouts sent by the Health Auto Export app (REST API automation, JSON v2):
// {"data": {"workouts": [{id, name, start: "2026-11-13 09:42:10 +0530", duration (s),
// activeEnergyBurned: {qty, units}}]}}. Each becomes a workout record for the day it started,
// with the session, its length and calories; the person adds exercises and sets in the app.

const MAX_INCOMING = 50;
const MAX_MINUTES = 1440;
const MAX_KCAL = 6000;
const MAX_DAY_SKEW = 2;
const KJ_PER_KCAL = 4.184;
const ID_PREFIX = 'hae-';
const ID_PATTERN = /^[A-Za-z0-9-]{1,72}$/;
const START_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}):?(\d{2})$/;
const TYPES = [
 ['strength', /strength|weight|core training/i],
 ['mobility', /yoga|pilates|flexib|stretch|cool ?down|mind|tai chi|barre/i],
 ['mixed', /cross training|mixed|fitness gaming/i],
 ['cardio', /run|walk|cycl|bik|swim|row|elliptical|stair|step|hiit|high intensity|interval|dance|hik|jump|cardio|kickbox/i],
 ['sport', /tennis|soccer|football|basket|badminton|cricket|golf|volley|squash|hockey|baseball|rugby|padel|pickle|boxing|martial|climb|ski|surf/i],
];

export const typeOf = name => TYPES.find(([, pattern]) => pattern.test(name))?.[0] ?? 'other';

// The day is the local date the workout started on, as the phone wrote it.
function startDay(start, now) {
 const match = START_PATTERN.exec(String(start ?? '').trim());
 if (!match) return null;
 const [, day, time, hours, minutes] = match;
 if (Number.isNaN(Date.parse(day + 'T' + time + hours + ':' + minutes))) return null;
 const skew = Math.abs(Date.parse(day + 'T12:00:00Z') - now.getTime()) / 86400000;
 return skew > MAX_DAY_SKEW ? null : day;
}

function kcalOf(workout) {
 const energy = workout.activeEnergyBurned ?? workout.activeEnergy;
 const qty = Number(energy?.qty);
 if (!(qty > 0)) return 0;
 const kcal = /kj/i.test(energy.units ?? '') ? qty / KJ_PER_KCAL : qty;
 return Math.min(MAX_KCAL, Math.round(kcal));
}

function toRecord(workout, now) {
 if (!workout || typeof workout !== 'object') return null;
 const rawId = String(workout.id ?? '');
 const title = String(workout.name ?? '').trim().slice(0, 120);
 const day = startDay(workout.start, now);
 const seconds = Number(workout.duration);
 if (!ID_PATTERN.test(rawId) || !title || !day || !(seconds > 0)) return null;
 const id = ID_PREFIX + rawId.toLowerCase();
 const minutes = Math.min(MAX_MINUTES, Math.round(seconds / 60));
 const kcal = kcalOf(workout);
 return {key: 'workout:' + day + ':' + id, value: {id, source: 'watch', title, type: typeOf(title), minutes, kcal, start: String(workout.start).trim(), exercises: [], text: '', notes: [], watch: {minutes, kcal}}};
}

// Returns null when the body is not a Health Auto Export upload, else the readable workouts.
export function exportedWorkouts(body, now = new Date()) {
 if (!body?.data || typeof body.data !== 'object') return null;
 const list = Array.isArray(body.data.workouts) ? body.data.workouts.slice(0, MAX_INCOMING) : [];
 const seen = new Set();
 return list.map(w => toRecord(w, now)).filter(record => {
  if (!record || seen.has(record.key)) return false;
  seen.add(record.key);
  return true;
 });
}

// The Watch keeps its minutes and calories up to date unless the person has changed them;
// everything else (title, exercises, sets) stays as the person left it.
export function mergeWatchWorkout(existing, incoming) {
 const before = existing.watch || {};
 return {
  ...existing,
  minutes: existing.minutes === before.minutes ? incoming.minutes : existing.minutes,
  kcal: existing.kcal === before.kcal ? incoming.kcal : existing.kcal,
  watch: incoming.watch,
 };
}

// Keep in step with LINK_MINUTES / LINK_SHARE in web/workout-math.mjs (the worker imports nothing from web/).
const LINK_MINUTES = 10;
const LINK_SHARE = 0.3;

// Where a Watch workout goes, given that day's workout records ({key, value}, value null when
// removed): onto the session it was already put on; onto a session the person logged themselves
// that lasted about as long (it keeps their title and exercises and takes the Watch calories);
// onto the day's only logged session when it ran longer and the Watch stopped early (it died
// mid-workout), keeping the larger of the estimate and the Watch's part; or into a new session.
// Returns null when the person removed it, or when it only matches a logged session but has no
// calories to give it.
export function placeWatchWorkout(incoming, dayRecords) {
 const live = dayRecords.filter(r => r.value);
 const linked = live.find(r => r.value.watchId === incoming.value.id);
 if (linked) return {key: linked.key, value: mergeWatchWorkout(linked.value, incoming.value)};
 const same = dayRecords.find(r => r.key === incoming.key);
 if (same) return same.value ? {key: same.key, value: mergeWatchWorkout(same.value, incoming.value)} : null;
 const {minutes, kcal} = incoming.value;
 const allowed = Math.max(LINK_MINUTES, minutes * LINK_SHARE);
 const logged = live
  .filter(r => r.value.source !== 'watch' && !r.value.watchId && Number(r.value.minutes) > 0)
  .map(r => ({...r, gap: Math.abs(Number(r.value.minutes) - minutes)}))
  .sort((a, b) => a.gap - b.gap);
 const close = logged.find(r => r.gap <= allowed);
 // Only when it is clear, by the same rule as the app: one logged session that day and no other
 // Watch session, and the logged session ran longer.
 const clear = logged.length === 1 && !live.some(r => r.value.source === 'watch');
 const cutShort = close || !clear ? null : logged.find(r => Number(r.value.minutes) > minutes);
 const match = close || cutShort;
 if (!match) return incoming;
 if (!(kcal > 0)) return null;
 const own = Number(match.value.kcal) > 0 ? Number(match.value.kcal) : 0;
 return {key: match.key, value: {...match.value, kcal: close ? kcal : Math.max(own, kcal), watchId: incoming.value.id, watch: incoming.value.watch}};
}
