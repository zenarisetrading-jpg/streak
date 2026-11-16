// Workout helpers: sets as editable text ("3×8 @ 135, 6 @ 145") and per-exercise progress.
const SET_PART = /^(?:(\d+)\s*[x×]\s*)?(\d+)?\s*(?:(?:@|at)\s*(\d+(?:\.\d+)?)\s*(?:lbs?|kgs?)?)?$/i;
const MAX_SETS = 20;

const sameSet = (a, b) => a.reps === b.reps && a.weight === b.weight;
// A set without reps is written "@ 135" so it still parses back.
const setLabel = s => [s.reps ?? '', s.weight ? '@ ' + s.weight : ''].filter(Boolean).join(' ');

// Groups repeated sets: [{8,135},{8,135},{6,145}] → "2×8 @ 135, 6 @ 145".
export function formatSets(sets) {
 const groups = [];
 for (const set of (sets || []).filter(s => s.reps || s.weight)) {
  const last = groups[groups.length - 1];
  if (last && sameSet(last.set, set)) last.count += 1;
  else groups.push({set, count: 1});
 }
 return groups.map(({set, count}) => (count > 1 ? count + '×' : '') + setLabel(set)).join(', ');
}

// Returns {sets} or {error}. Accepts "3x8 @ 135", "8 at 135", "10, 10, 8" and "@ 50".
export function parseSets(value) {
 const parts = String(value || '').split(',').map(p => p.trim()).filter(Boolean);
 const sets = [];
 for (const part of parts) {
  const match = SET_PART.exec(part);
  if (!match || (!match[2] && !match[3])) return {error: 'Write sets like 3×8 @ 135, 6 @ 145.'};
  const count = match[1] ? Number(match[1]) : 1;
  if (count < 1) return {error: 'Write sets like 3×8 @ 135, 6 @ 145.'};
  if (sets.length + count > MAX_SETS) return {error: 'Up to ' + MAX_SETS + ' sets per exercise.'};
  const set = {reps: match[2] ? Number(match[2]) : null, weight: match[3] ? Number(match[3]) : null};
  for (let i = 0; i < count; i++) sets.push(set);
 }
 return {sets};
}

// Epley estimate of a one-rep max; lets 8 @ 135 and 5 @ 150 be compared.
export const oneRepMax = ({reps, weight}) => reps > 0 && weight > 0 ? weight * (1 + (reps === 1 ? 0 : reps / 30)) : 0;

function bestSet(sets) {
 return (sets || []).reduce((best, s) => oneRepMax(s) > (best ? oneRepMax(best) : 0) ? s : best, null);
}

const nameKey = name => String(name || '').trim().toLowerCase();

// Latest and previous session per exercise, newest first: weighted lifts by best set,
// cardio by distance or minutes.
export function exerciseProgress(workoutsByDate) {
 const byName = new Map();
 for (const [date, workouts] of Object.entries(workoutsByDate || {})) {
  for (const workout of workouts || []) {
   for (const exercise of workout.exercises || []) {
    const key = nameKey(exercise.name);
    if (!key) continue;
    const best = bestSet(exercise.sets);
    const score = best ? oneRepMax(best) : exercise.distanceKm || exercise.minutes || 0;
    if (!score) continue;
    const session = {date, best, score, unit: exercise.unit || 'lb', distanceKm: exercise.distanceKm ?? null, minutes: exercise.minutes ?? null};
    if (!byName.has(key)) byName.set(key, {name: exercise.name.trim(), sessions: []});
    const sessions = byName.get(key).sessions;
    const sameDay = sessions.findIndex(s => s.date === date);
    if (sameDay === -1) sessions.push(session);
    else if (score > sessions[sameDay].score) sessions[sameDay] = session;
   }
  }
 }
 return [...byName.values()].map(({name, sessions}) => {
  const sorted = sessions.sort((a, b) => b.date.localeCompare(a.date));
  const [latest, previous = null] = sorted;
  return {name, latest, previous, sessions: sorted.length, trend: previous ? Math.sign(Math.round(latest.score - previous.score)) : null};
 }).sort((a, b) => b.latest.date.localeCompare(a.latest.date) || a.name.localeCompare(b.name));
}

export const knownExercises = workoutsByDate => exerciseProgress(workoutsByDate).map(e => e.name).slice(0, 40);

// Calories for a new session length at the same rate per minute; unchanged without a rate to go on.
export function scaledKcal(workout, minutes) {
 const from = Number(workout?.minutes), kcal = Number(workout?.kcal);
 if (!(minutes > 0) || !(from > 0) || !(kcal > 0)) return kcal || 0;
 return Math.round(kcal * minutes / from);
}

// Keep in step with LINK_MINUTES / LINK_SHARE in worker/watch-workouts.mjs.
const LINK_MINUTES = 10;
const LINK_SHARE = 0.3;

// A session logged after the Watch already sent the same workout would count its calories twice.
// It takes over an untouched Watch session that day: one of about the same length gives it the
// Watch's calories; a shorter one (the Watch stopped early, say it died mid-workout) gives it the
// larger of its estimate and the Watch's part. The logged session keeps its own title and
// exercises. Returns the entry to save and the id of the Watch session it replaces (or null).
// A Watch session the person has not changed: no exercises added, and its minutes and calories
// still the Watch's.
const untouched = w => !(w.exercises || []).length && (!w.watch || (Number(w.kcal) === Number(w.watch.kcal) && Number(w.minutes) === Number(w.watch.minutes)));

export function absorbWatchSession(entry, dayEntries) {
 const minutes = Number(entry.minutes);
 if (entry.source === 'watch' || entry.watchId || !(minutes > 0)) return {entry, replaces: null};
 const candidates = (dayEntries || [])
  .filter(w => w && w.id !== entry.id && w.source === 'watch' && untouched(w) && Number(w.kcal) > 0 && Number(w.minutes) > 0)
  .map(w => ({w, gap: Math.abs(Number(w.minutes) - minutes)}))
  .sort((a, b) => a.gap - b.gap);
 const close = candidates.find(({w, gap}) => gap <= Math.max(LINK_MINUTES, Number(w.minutes) * LINK_SHARE));
 // Only when it is clear, by the same rule as the server: the day has one Watch session and no
 // other logged session, and the Watch session was shorter.
 const others = (dayEntries || []).filter(w => w && w.id !== entry.id);
 const clear = others.filter(w => w.source === 'watch').length === 1 && !others.some(w => w.source !== 'watch' && !w.watchId && Number(w.minutes) > 0);
 const cutShort = close || !clear || candidates.length !== 1 ? null : candidates.find(({w}) => Number(w.minutes) < minutes);
 const match = close || cutShort;
 if (!match) return {entry, replaces: null};
 const {w} = match, own = Number(entry.kcal) > 0 ? Number(entry.kcal) : 0;
 return {entry: {...entry, kcal: close ? Number(w.kcal) : Math.max(own, Number(w.kcal)), watchId: w.id, watch: w.watch || {minutes: w.minutes, kcal: w.kcal}}, replaces: w.id};
}
