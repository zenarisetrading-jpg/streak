// How ready the day looks, from what an Apple Watch SE can actually measure — sleep, HRV,
// resting heart rate and recent activity — plus how the person says they feel.
// Every number is judged against that person's own recent days, never against a population.
// Pure functions only, so the score can be tested without a browser.

export const BASELINE_MIN_DAYS = 3;
export const BASELINE_WINDOW = 14;
// Recent days that count as "what I have just asked of my body".
export const ACUTE_DAYS = 3;
export const SLEEP_NEED = 8;
export const FEEL_FIELDS = ['mood', 'energy', 'soreness', 'sleepQuality'];
// Soreness reads the other way round: 5 means very sore.
const INVERTED = new Set(['soreness']);
// The check-in scale, shared with the screens that draw it.
export const FEEL_MIN = 1;
export const FEEL_MAX = 5;
// A full night scores 90, so an ordinary day sits mid-band and leaves room above it.
const SLEEP_FULL_SCORE = 90;
// Middle of the band: this is what "the same as usual" is worth.
const PAR = 70;
const HRV_PER_RATIO = 200;
const RHR_PER_BPM = 6;
const LOAD_PER_RATIO = 100;
const BANDS = [[80, 'Strong'], [65, 'Ready'], [50, 'Steady'], [35, 'Take it easy'], [0, 'Rest']];

// One answer from the check-in: a whole number on the 1-5 scale. Values that came back from
// storage or the server as text count too; anything else is treated as unanswered.
export const isFeelValue = value => (typeof value === 'number' || typeof value === 'string')
 && String(value).trim() !== '' && Number.isInteger(Number(value))
 && Number(value) >= FEEL_MIN && Number(value) <= FEEL_MAX;

const clamp = (n, low = 0, high = 100) => Math.min(high, Math.max(low, n));
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const present = values => (Array.isArray(values) ? values : []).filter(isNumber);
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const field = (records, name) => (Array.isArray(records) ? records : []).map(record => record?.[name]);

// A baseline only exists once there are enough days behind it; before that we say so
// rather than comparing today against one stray reading.
export function baselineOf(values, minDays = BASELINE_MIN_DAYS) {
 const recent = present(values).slice(-BASELINE_WINDOW);
 if (recent.length < Math.max(1, minDays)) return null;
 return {mean: mean(recent), days: recent.length};
}

// 0–100 from the four taps, with whichever ones were answered.
export function feelScore(feel) {
 if (!feel || typeof feel !== 'object') return null;
 const answers = FEEL_FIELDS.filter(name => isFeelValue(feel[name])).map(name => {
  const value = Number(feel[name]);
  return INVERTED.has(name) ? FEEL_MIN + FEEL_MAX - value : value;
 });
 if (!answers.length) return null;
 return clamp((mean(answers) - FEEL_MIN) / (FEEL_MAX - FEEL_MIN) * 100);
}

const sleepPart = hours => (isNumber(hours) && hours > 0 ? {
 key: 'sleep', label: 'Sleep', weight: 30,
 score: clamp(hours / SLEEP_NEED * SLEEP_FULL_SCORE),
 detail: hours.toFixed(1).replace(/\.0$/, '') + ' h of ' + SLEEP_NEED,
 low: 'short sleep',
} : null);

const hrvPart = (today, base) => (isNumber(today) && today > 0 && base ? {
 key: 'hrv', label: 'HRV', weight: 25,
 score: clamp(PAR + (today / base.mean - 1) * HRV_PER_RATIO),
 detail: Math.round(today) + ' ms vs ' + Math.round(base.mean) + ' usual',
 low: 'HRV below your usual',
} : null);

const rhrPart = (today, base) => (isNumber(today) && today > 0 && base ? {
 key: 'rhr', label: 'Resting HR', weight: 20,
 score: clamp(PAR - (today - base.mean) * RHR_PER_BPM),
 detail: Math.round(today) + ' bpm vs ' + Math.round(base.mean) + ' usual',
 low: 'a raised resting heart rate',
} : null);

// Recent effort against the fortnight behind it: a sudden hard stretch costs recovery.
const loadPart = (acute, base) => (acute !== null && base ? {
 key: 'load', label: 'Training load', weight: 10,
 score: clamp(PAR - (acute / Math.max(base.mean, 1) - 1) * LOAD_PER_RATIO),
 detail: Math.round(acute) + ' kcal a day lately',
 low: 'a hard few days of training',
} : null);

const feelPart = feel => {
 const score = feelScore(feel);
 return score === null ? null : {key: 'feel', label: 'How you feel', weight: 30, score, detail: 'your check-in', low: 'how you said you felt'};
};

const bandOf = score => BANDS.find(([floor]) => score >= floor)[1];

function noteFor(components, band) {
 if (!components.length) return '';
 const weakest = [...components].sort((a, b) => a.score - b.score)[0];
 if (weakest.score >= PAR) return 'Everything is close to your usual — a good day to push.';
 const advice = band === 'Strong' || band === 'Ready' ? 'Train as planned.' : band === 'Steady' ? 'Keep it moderate.' : 'Go easy today.';
 return 'Held back by ' + weakest.low + '. ' + advice;
}

/**
 * @param health  today's Apple Health record, or null
 * @param history earlier days, oldest first, not including today
 * @param feel    today's check-in answers, or null
 */
export function recoveryScore({health = null, history = [], feel = null} = {}) {
 const past = Array.isArray(history) ? history.slice(-BASELINE_WINDOW) : [];
 const hrvBase = baselineOf(field(past, 'hrv'));
 const rhrBase = baselineOf(field(past, 'restingHR'));
 const loadBase = baselineOf(field(past, 'activeKcal'));
 // Completed days only. Today's active calories are still adding up, so including them would
 // make a hard week look easy every morning.
 const recentActive = present(field(past.slice(-ACUTE_DAYS), 'activeKcal'));

 const components = [
  sleepPart(health?.sleepHours),
  hrvPart(health?.hrv, hrvBase),
  rhrPart(health?.restingHR, rhrBase),
  loadPart(recentActive.length ? mean(recentActive) : null, loadBase),
  feelPart(feel),
 ].filter(Boolean);

 // Only HRV and resting heart rate wait for a baseline, so only they decide whether the card
 // still says it is learning. Sleep is scored against a fixed need and counts from day one.
 const baselineDays = Math.max(present(field(past, 'hrv')).length, present(field(past, 'restingHR')).length);
 if (!components.length) return {score: null, band: null, components: [], note: '', baselineDays, building: baselineDays < BASELINE_MIN_DAYS};

 const weight = components.reduce((sum, part) => sum + part.weight, 0);
 const score = Math.round(components.reduce((sum, part) => sum + part.score * part.weight, 0) / weight);
 const band = bandOf(score);
 return {score, band, components, note: noteFor(components, band), baselineDays, building: baselineDays < BASELINE_MIN_DAYS};
}
