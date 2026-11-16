// Per-user tracker records (check-in days, meals, workouts and profile settings) stored in D1.
const KEY_PATTERN = /^(?:day:\d{4}-\d{2}-\d{2}|(?:meal|workout):\d{4}-\d{2}-\d{2}:[\w-]{1,80}|settings:profile)$/;
const MAX_BODY_CHARS = 500000;
const MAX_ROWS = 50;
const SETTINGS_KEY = 'settings:profile';

const isRecordValue = value => value === null || (value && typeof value === 'object' && !Array.isArray(value));
const isValidRow = row => Boolean(row) && KEY_PATTERN.test(row.key) && isRecordValue(row.value);

// Every write bumps the person's revision, so a sync poll with nothing new costs one row read.
export const bumpRevision = (env, user) => env.DB.prepare('INSERT INTO user_revisions (user_id, rev) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1').bind(user);

export async function listRecords(request, env, user, headers) {
 const revision = await env.DB.prepare('SELECT rev FROM user_revisions WHERE user_id = ?').bind(user).first();
 const etag = '"' + (revision?.rev ?? 0) + '"';
 const withTag = {...headers, ETag: etag};
 // Cloudflare may hand the tag back weak (W/"…") after compressing the response, so compare without it.
 const asked = (request.headers.get('if-none-match') || '').replace(/^W\//, '');
 if (asked === etag) return new Response(null, {status: 304, headers: withTag});
 const {results} = await env.DB.prepare('SELECT record_key, payload FROM tracker_records WHERE user_id = ? AND payload IS NOT NULL').bind(user).all();
 const records = {};
 for (const row of results) {
  try { records[row.record_key] = JSON.parse(row.payload); }
  catch { console.error('Skipped an unreadable record:', row.record_key); }
 }
 return Response.json(records, {headers: withTag});
}

// Settings are one record edited from several screens and devices. Each field carries the time it
// was last changed in `_at`, and the newer change wins per field, so two devices editing different
// settings cannot undo each other. Writes without times (older pages) win only over fields that
// have never been timed.
export function mergeSettings(previous, next) {
 if (!previous || typeof previous !== 'object') return next;
 const before = previous._at || {}, after = next._at || {};
 const merged = {...previous}, at = {...before};
 for (const [field, value] of Object.entries(next)) {
  if (field === '_at' || (after[field] || 0) < (before[field] || 0)) continue;
  merged[field] = value;
  if (after[field]) at[field] = after[field];
 }
 return {...merged, _at: at};
}

export async function writeRecords(request, env, user, headers) {
 const raw = await request.text();
 if (raw.length > MAX_BODY_CHARS) return new Response('Request too large', {status: 413, headers});
 let rows;
 try { rows = JSON.parse(raw); } catch { return new Response('Invalid JSON', {status: 400, headers}); }
 if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS || !rows.every(isValidRow)) {
  return new Response('Invalid records', {status: 400, headers});
 }
 const settingsRow = rows.find(row => row.key === SETTINGS_KEY && row.value && !row.importOnly);
 if (settingsRow) {
  const existing = await env.DB.prepare('SELECT payload FROM tracker_records WHERE user_id = ? AND record_key = ?').bind(user, SETTINGS_KEY).first();
  let previous = null;
  try { previous = existing?.payload ? JSON.parse(existing.payload) : null; } catch {}
  settingsRow.value = mergeSettings(previous, settingsRow.value);
 }
 await env.DB.batch([...rows.map(({key, value, importOnly}) => env.DB.prepare(importOnly
  ? 'INSERT INTO tracker_records VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
  : 'INSERT INTO tracker_records VALUES (?, ?, ?) ON CONFLICT(user_id, record_key) DO UPDATE SET payload = excluded.payload'
 ).bind(user, key, value === null ? null : JSON.stringify(value))), bumpRevision(env, user)]);
 return new Response(null, {status: 204, headers});
}
