// A Watch workout worked out from Health samples, for the Shortcut that runs when a workout
// ends (Shortcuts cannot read workouts themselves). The Shortcut sends workoutEnded: true with
// today's Watch Exercise Minute samples (workoutMinuteStarts, workoutMinuteValues)
// and Active Energy samples (workoutEnergyStarts, workoutEnergyValues). The latest unbroken run
// of exercise minutes is the workout; the active energy inside it is its calories.

const MINUTE_MS = 60000;
const MAX_GAP_MS = 2 * MINUTE_MS;
const MIN_MINUTES = 5;
const MAX_MINUTES = 1440;
const MAX_KCAL = 6000;
const MAX_SAMPLES = 5000;
const MAX_DAY_SKEW = 2;
const MAX_LINE_CHARS = 64;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap]\.?m\.?)?`;
const MONTH_FIRST = new RegExp(String.raw`([a-z]{3})[a-z]{0,9}\.?\s+(\d{1,2}),?\s+(\d{4})\D+?` + TIME, 'i');
const DAY_FIRST = new RegExp(String.raw`(\d{1,2})[\s-]+([a-z]{3})[a-z]{0,9}\.?[\s-]+(\d{4})\D+?` + TIME, 'i');
const ISO = new RegExp(String.raw`(\d{4})-(\d{2})-(\d{2})[ T]` + TIME, 'i');

// The daily totals workoutMinutes and workoutKcal are not workout sample fields.
const MINUTE_FIELD = /^workoutminute(?!s$)/i;
const WORKOUT_FIELD = /^workout(end|minute(?!s$)|energy)/i;

const lines = value => (Array.isArray(value) ? value : String(value ?? '').split('\n')).slice(-MAX_SAMPLES).map(v => String(v).slice(0, MAX_LINE_CHARS).trim());
const firstNumber = text => { const match = /\d[\d,]*(?:\.\d+)?/.exec(text || ''); return match ? Number(match[0].replace(/,/g, '')) : NaN; };
const isYes = value => value === true || /^(true|yes|1)$/i.test(String(value ?? '').trim());

function clock(hour, minute, meridiem) {
 const h = Number(hour) % (meridiem ? 12 : 24) + (/^p/i.test(meridiem || '') ? 12 : 0);
 return [h, Number(minute)];
}

// The time as the phone showed it, kept as if it were UTC so only its wall-clock parts matter.
export function wallClock(text) {
 const s = String(text ?? '').replace(/[  ]/g, ' ');
 let parts = null, match;
 if ((match = ISO.exec(s))) parts = [match[1], Number(match[2]) - 1, match[3], match[4], match[5], match[6]];
 else if ((match = MONTH_FIRST.exec(s))) parts = [match[3], MONTHS.indexOf(match[1].toLowerCase()), match[2], match[4], match[5], match[6]];
 else if ((match = DAY_FIRST.exec(s))) parts = [match[3], MONTHS.indexOf(match[2].toLowerCase()), match[1], match[4], match[5], match[6]];
 if (!parts || parts[1] < 0) return NaN;
 const [hour, minute] = clock(parts[3], parts[4], parts[5]);
 return Date.UTC(Number(parts[0]), parts[1], Number(parts[2]), hour, minute);
}

function samples(starts, values) {
 const times = lines(starts).map(wallClock), amounts = lines(values).map(firstNumber);
 return times.map((start, i) => ({start, amount: amounts[i]})).filter(s => Number.isFinite(s.start)).sort((a, b) => a.start - b.start);
}

function lastRun(minutes) {
 let run = null;
 for (const {start, amount} of minutes) {
  const end = start + (amount > 0 ? amount : 1) * MINUTE_MS;
  if (run && start - run.end <= MAX_GAP_MS) run.end = Math.max(run.end, end);
  else run = {start, end};
 }
 return run;
}

const label = ms => { const d = new Date(ms); const h = d.getUTCHours(); return (h % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };
const idFor = ms => { const [time, meridiem] = label(ms).split(' '); return 'watch-' + time.replace(':', '').padStart(4, '0') + meridiem.toLowerCase(); };

const isDateList = list => { const filled = lines(list).filter(Boolean); return filled.length > 0 && filled.filter(t => Number.isFinite(wallClock(t))).length * 2 >= filled.length; };

// Field names typed on a phone get cut short or swapped, so each pair is found by its prefix and
// told apart by what it holds: the list of dates is the start times, the other is the values.
function pairFor(body, pattern) {
 const lists = Object.keys(body).filter(key => pattern.test(key)).map(key => body[key]);
 return {starts: lists.find(isDateList), values: lists.find(list => !isDateList(list))};
}

export const hasWorkoutFields = body => Boolean(body) && typeof body === 'object' && Object.keys(body).some(key => WORKOUT_FIELD.test(key));

export function endedWorkout(body, now = new Date()) {
 if (!hasWorkoutFields(body) || !isYes(body[Object.keys(body).find(key => /^workoutend/i.test(key))])) return null;
 const minutePair = pairFor(body, MINUTE_FIELD), energyPair = pairFor(body, /^workoutenergy/i);
 const run = lastRun(samples(minutePair.starts, minutePair.values));
 if (!run) return null;
 const minutes = Math.min(MAX_MINUTES, Math.round((run.end - run.start) / MINUTE_MS));
 const day = new Date(run.start).toISOString().slice(0, 10);
 if (minutes < MIN_MINUTES || Math.abs(Date.parse(day + 'T12:00:00Z') - now.getTime()) / 86400000 > MAX_DAY_SKEW) return null;
 const energy = samples(energyPair.starts, energyPair.values).filter(s => s.start >= run.start && s.start < run.end && s.amount > 0);
 const kcal = Math.min(MAX_KCAL, Math.round(energy.reduce((sum, s) => sum + s.amount, 0)));
 const id = idFor(run.start);
 return {key: 'workout:' + day + ':' + id, value: {id, source: 'watch', title: 'Apple Watch workout', type: 'other', minutes, kcal, start: label(run.start), exercises: [], text: '', notes: [], watch: {minutes, kcal}}};
}
