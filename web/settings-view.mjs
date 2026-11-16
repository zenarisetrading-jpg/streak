// The calorie settings: the daily allowance, how much exercise is eaten back, and how the week's
// total is shared between its days. One card, one Save — the three used to be two cards with a
// Save each and a third control that saved itself on change, so the same screen taught three
// different rules about when your typing takes effect.
import {allowanceOn, withAllowance} from './energy.mjs';
import {budgetOf, baseShares, DEFAULTS, LIMITS} from './budget.mjs';
import {EARLIEST} from './setup-steps.mjs';
import {KEYS, read, localToday, shareOf, targetsOf, fmt, saveSettings} from './store.mjs';

const el = id => document.getElementById(id);
const MIN_KCAL = 800;
const MAX_KCAL = 6000;
const SHARES = [1, 0.75, 0.5, 0];
const status = message => { el('energy-status').textContent = message; };

// The week's shape, as four plain numbers. A light day is stored as a negative, so the field
// asks for "kcal less" and the sign is added here rather than asked of the user.
const SHAPE = [['weekend-boost', 'weekend', 1], ['event-boost', 'event', 1], ['light-cut', 'light', -1], ['day-cap', 'cap', 1]];
const LABELS = {weekend: 'a weekend boost', event: 'an event day', light: 'a light day', cap: 'a daily cap'};

// What each day works out as, in the person's own numbers. This is the whole explanation of the
// four boxes above it, which is why there is no paragraph trying to say the same thing in prose.
function renderShape(settings) {
 const budget = budgetOf(settings);
 for (const [id, key, sign] of SHAPE) {
  if (document.activeElement === el(id)) continue;
  // No cap is no cap, so the box is left empty for its "No limit" placeholder to say so. A
  // literal 0 in a box labelled "most in one day" reads as a limit of nothing.
  el(id).value = key === 'cap' && budget.cap === 0 ? '' : String(budget[key] * sign);
 }
 const daily = allowanceOn(targetsOf(settings), localToday());
 const [weekday] = baseShares(daily || 0, budget.weekend);
 el('shape-preview').textContent = daily === null ? 'Set a daily allowance above and this shows what each day works out as.'
  : 'Weekdays ' + fmt(Math.round(weekday)) + ', Saturday and Sunday ' + fmt(Math.round(daily + budget.weekend)) + ' kcal. An event day adds ' + fmt(budget.event) + ', a light day takes off ' + fmt(-budget.light) + '.'
   + (budget.cap > 0 ? ' No day goes above ' + fmt(budget.cap) + ', exercise included.' : '');
}

function render() {
 const settings = read(KEYS.settings);
 if (document.activeElement !== el('kcal-target')) el('kcal-target').value = allowanceOn(targetsOf(settings), localToday()) ?? '';
 if (document.activeElement !== el('exercise-share')) el('exercise-share').value = String(shareOf(settings));
 renderShape(settings);
}

// Reads the four shape boxes. Returns the budget, or the complaint to show instead.
function readShape() {
 const dayBudget = {};
 for (const [id, key, sign] of SHAPE) {
  const typed = el(id).value.trim();
  // An empty field takes the default the placeholder is showing, not zero: clearing a box to
  // "go back to normal" used to switch the feature off instead.
  const value = typed === '' ? DEFAULTS[key] : Math.round(Number(typed)) * sign;
  const [min, max] = LIMITS[key];
  if (!Number.isFinite(value) || value < min || value > max) {
   return {problem: 'Enter ' + LABELS[key] + ' between ' + fmt(0) + ' and ' + fmt(Math.max(Math.abs(min), max)) + ' kcal.'};
  }
  dayBudget[key] = value;
 }
 return {dayBudget};
}

// One Save for the card. Everything is checked before anything is written, and only what changed
// is written: an untouched allowance must not be restamped as a change made today, and an
// untouched field must not take a newer timestamp and beat an edit made on another device.
el('save-calories').onclick = () => {
 const settings = read(KEYS.settings);
 const typed = el('kcal-target').value.trim();
 const kcal = Math.round(Number(typed));
 if (!(kcal >= MIN_KCAL && kcal <= MAX_KCAL)) {
  status('Enter an allowance between ' + fmt(MIN_KCAL) + ' and ' + fmt(MAX_KCAL) + ' kcal.');
  return;
 }
 const {dayBudget, problem} = readShape();
 if (problem) { status(problem); return; }
 const share = Number(el('exercise-share').value);

 const current = targetsOf(settings);
 const patch = {dayBudget};
 if (SHARES.includes(share) && share !== shareOf(settings)) patch.exerciseShare = share;
 // The first allowance applies to past days too; later changes apply from today, leaving
 // history as it was.
 if (kcal !== allowanceOn(current, localToday())) {
  patch.calorieTargets = withAllowance(current, current.length ? localToday() : EARLIEST, kcal);
 }

 document.activeElement?.blur();
 try {
  saveSettings(patch);
  status(patch.calorieTargets ? 'Saved. ' + fmt(kcal) + ' kcal a day from today.' : 'Saved.');
 } catch { status('Could not save. Check that browser storage is enabled.'); }
};

for (const event of ['tracker-synced', 'settings-saved']) window.addEventListener(event, render);
render();
