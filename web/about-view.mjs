// The "You" card: every answer the allowance is worked out from, in one card and in the order
// the maths needs them — body, where you are now, where you are going, how active your week is —
// and then the allowance itself. Weight and goal used to live on another tab and in another card,
// which meant the suggested allowance could not be worked out from the card you were looking at.
// One Save writes all of it: the profile, the unit, today's weigh-in and the goal.
import {withAllowance, allowanceOn} from './energy.mjs';
import {ACTIVITY, ACTIVITY_TILES, validProfile, suggestedAllowance, proteinTarget} from './profile.mjs';
import {EARLIEST, MIN_AGE, MAX_AGE, DEFAULT_HEIGHT_IN, DEFAULT_AGE} from './setup-steps.mjs';
import {figureMarkup, heightLabel, FIGURE_VIEWBOX} from './figure.mjs';
import {KEYS, read, localToday, targetsOf, latestWeight, fmt, saveSettings, saveDay, weightUnit, rangeFill} from './store.mjs';
import {weightText, heightText, inputValue, parseWeight, weightRange, WEIGHT_UNITS} from './units.mjs';

const el = id => document.getElementById(id);
const YEAR = new Date().getFullYear();
const COUNT_MS = 600;
const status = message => { el('about-status').textContent = message; };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let draft = null;
// What the three typed boxes held when the card was last filled from storage: weight and goal in
// pounds, the date as typed. Save compares against these to know what was actually changed, so an
// untouched box writes nothing — neither a weigh-in for today nor a fresh timestamp, which would
// beat a newer edit of the same field made on another device.
let seeded = {weight: null, goal: null, goalDate: ''};
// Whether the card holds edits that have not been saved. A sync landing mid-edit must not wipe
// them, and focus is no way to tell: on iOS a tap on a button leaves focus on the body, so every
// answer given by tapping would look like an untouched card.
let dirty = false;

function fromSettings() {
 const settings = read(KEYS.settings);
 const p = settings.profile || {};
 const u = weightUnit();
 seeded = {weight: latestWeight(), goal: Number(settings.goalWeight) > 0 ? Number(settings.goalWeight) : null, goalDate: settings.goalDate ?? ''};
 return {
  heightIn: Number(p.heightIn) || DEFAULT_HEIGHT_IN, birthYear: Number(p.birthYear) || YEAR - DEFAULT_AGE,
  sex: p.sex || '', activity: p.activity || '',
  weight: inputValue(seeded.weight, u), goal: inputValue(seeded.goal, u), goalDate: seeded.goalDate,
 };
}

// Whether a box holds something other than what was put in it. The comparison is between what is
// typed and what the box would show for the stored value, in the unit on screen: comparing the
// numbers instead would call 86.2 kg a change from a stored 190 lb, because reading 190 lb back
// as one decimal of kg and then into pounds again lands on 190.04.
const edited = (key, u) => draft[key].trim() !== inputValue(seeded[key], u);

// What the boxes say right now, in pounds. The card works from what is typed rather than from
// what is saved, so the allowance at the bottom answers the number you are looking at.
const typedWeight = () => parseWeight(draft.weight, weightUnit());
const typedGoal = () => parseWeight(draft.goal, weightUnit());

// Counts a number up to its new value once; jumps straight there with reduced motion.
function countTo(node, value) {
 const from = Number(node.dataset.value || 0);
 node.dataset.value = String(value);
 if (reducedMotion.matches || from === value) { node.textContent = fmt(value); return; }
 const start = performance.now();
 const step = now => {
  const t = Math.min(1, (now - start) / COUNT_MS);
  node.textContent = fmt(from + (value - from) * (1 - (1 - t) ** 3));
  if (t < 1 && node.dataset.value === String(value)) requestAnimationFrame(step);
 };
 requestAnimationFrame(step);
}

function renderFigure() {
 const svg = el('figure');
 svg.setAttribute('viewBox', FIGURE_VIEWBOX);
 svg.innerHTML = figureMarkup(draft);
 const u = weightUnit();
 const height = heightText(draft.heightIn, u) ?? heightLabel(draft.heightIn);
 el('height-readout').textContent = height;
 el('height').value = String(draft.heightIn);
 el('height').setAttribute('aria-valuetext', height);
 rangeFill(el('height'));
 const weight = typedWeight();
 el('figure-weight').replaceChildren();
 if (weight) { const tag = document.createElement('span'); tag.textContent = weightText(weight, u); el('figure-weight').append(tag); }
}

function renderPickers() {
 el('born').textContent = String(draft.birthYear);
 el('age-readout').textContent = (YEAR - draft.birthYear) + ' years old';
 for (const b of el('sex').querySelectorAll('[data-sex]')) b.setAttribute('aria-pressed', String(b.dataset.sex === draft.sex));
 const tiles = [...el('activity').querySelectorAll('[data-activity]')];
 for (const t of tiles) {
  const on = t.dataset.activity === draft.activity;
  t.setAttribute('aria-checked', String(on));
  t.tabIndex = on || (!draft.activity && t === tiles[0]) ? 0 : -1;
 }
}

// The two weight boxes carry the unit in their label and their range, so switching to kg does
// not leave a box asking for a number between 50 and 700.
function renderWeightFields() {
 const u = weightUnit(), {min, max} = weightRange(u);
 el('about-weight-unit').textContent = u;
 el('goal-weight-unit').textContent = u;
 Object.assign(el('about-weight'), {min, max, placeholder: u === 'kg' ? 'e.g. 86' : 'e.g. 190'});
 Object.assign(el('goal-weight'), {min, max, placeholder: 'Optional'});
 for (const [id, key] of [['about-weight', 'weight'], ['goal-weight', 'goal'], ['goal-date', 'goalDate']]) {
  if (document.activeElement !== el(id)) el(id).value = draft[key];
 }
}

function renderFuel() {
 const box = el('fuel');
 const weight = typedWeight();
 el('use-suggestion').hidden = true;
 if (!validProfile(draft, YEAR)) { box.hidden = true; status('Pick your body and activity level to see your numbers.'); return; }
 if (weight === null) { box.hidden = true; status('Add your weight above to see your allowance.'); return; }
 status('');
 box.hidden = false;
 const goal = typedGoal();
 const result = suggestedAllowance(draft, weight, goal, YEAR);
 if (!result) { box.hidden = true; return; }
 const {bmr, factor, maintenance, allowance, direction} = result;
 const whole = Math.max(maintenance, allowance);
 el('fuel-fill').style.inlineSize = (direction > 0 ? maintenance : allowance) / whole * 100 + '%';
 el('fuel-cut').style.inlineSize = Math.abs(maintenance - allowance) / whole * 100 + '%';
 el('fuel-cut').classList.toggle('gain', direction > 0);
 countTo(el('fuel-allowance'), allowance);
 countTo(el('fuel-protein'), proteinTarget(weight, goal));
 const goalText = goal ? weightText(goal, weightUnit()) + ' goal' : 'goal';
 el('fuel-math').textContent = 'BMR ' + fmt(bmr) + ' × ' + factor + ' activity = ' + fmt(maintenance) + ' maintenance' + (direction < 0 ? ' − ' + fmt(maintenance - allowance) : direction > 0 ? ' + ' + fmt(allowance - maintenance) : '') + ' = ' + fmt(allowance) + ' kcal';
 // The line above already gives the arithmetic, down to the maintenance figure and the size of
 // the deficit. This one says only what the arithmetic cannot: what the striped part means and
 // what it is for.
 el('fuel-explain').textContent = direction < 0 ? 'The striped part is held back to lose about ' + (weightUnit() === 'kg' ? '0.5 kg' : '1 lb') + ' a week toward your ' + goalText + '.'
  : direction > 0 ? 'The striped part is added to gain slowly toward your ' + goalText + '.'
  : 'That holds your weight steady. Set a goal weight above to lose or gain.';
 el('use-suggestion').hidden = allowanceOn(targetsOf(read(KEYS.settings)), localToday()) === allowance;
 el('use-suggestion').textContent = 'Use ' + fmt(allowance) + ' kcal as my allowance';
}

// A change the person made. It marks the card as holding unsaved work, which is what keeps an
// arriving sync from resetting it.
function edit(patch) {
 dirty = true;
 update(patch);
}

function update(patch) {
 draft = {...draft, ...patch};
 renderFigure();
 renderPickers();
 renderWeightFields();
 renderFuel();
}

// The weight unit saves straight away and applies to every screen; heights follow it (cm with kg).
function renderUnit() {
 for (const button of el('weight-unit').querySelectorAll('[data-unit]')) button.setAttribute('aria-pressed', String(button.dataset.unit === weightUnit()));
}
el('weight-unit').addEventListener('click', event => {
 const unit = event.target.closest('[data-unit]')?.dataset.unit;
 if (!WEIGHT_UNITS.includes(unit) || unit === weightUnit()) return;
 // Read the boxes in the old unit before the switch, so a half-typed weight comes back as the
 // same weight rather than as the same digits.
 const was = {weight: typedWeight(), goal: typedGoal()};
 const untouched = {weight: !edited('weight', weightUnit()), goal: !edited('goal', weightUnit())};
 try {
  saveSettings({weightUnit: unit});
  // saveSettings fires settings-saved, which refills the card; put the converted boxes back
  // after it, and leave a box that was never touched reading as the stored value in the new unit.
  update({
   weight: untouched.weight ? inputValue(seeded.weight, unit) : inputValue(was.weight, unit),
   goal: untouched.goal ? inputValue(seeded.goal, unit) : inputValue(was.goal, unit),
  });
  status('Weights now show in ' + unit + '.');
 } catch { status('Could not save.'); }
});

for (const [value, {emoji, title, detail}] of Object.entries(ACTIVITY_TILES)) {
 const tile = document.createElement('button');
 tile.type = 'button';
 tile.className = 'activity-tile';
 tile.dataset.activity = value;
 tile.setAttribute('role', 'radio');
 tile.setAttribute('aria-label', ACTIVITY[value].label);
 const i = document.createElement('span'); i.className = 'activity-tile__icon'; i.textContent = emoji; i.setAttribute('aria-hidden', 'true');
 const t = document.createElement('strong'); t.textContent = title;
 const d = document.createElement('small'); d.textContent = detail;
 tile.append(i, t, d);
 el('activity').append(tile);
}

el('height').addEventListener('input', event => edit({heightIn: Number(event.target.value)}));
el('born-down').onclick = () => edit({birthYear: Math.max(YEAR - MAX_AGE, draft.birthYear - 1)});
el('born-up').onclick = () => edit({birthYear: Math.min(YEAR - MIN_AGE, draft.birthYear + 1)});
el('sex').addEventListener('click', event => { const b = event.target.closest('[data-sex]'); if (b) edit({sex: b.dataset.sex}); });
el('activity').addEventListener('click', event => { const t = event.target.closest('[data-activity]'); if (t) edit({activity: t.dataset.activity}); });
el('activity').addEventListener('keydown', event => {
 const keys = Object.keys(ACTIVITY_TILES);
 const move = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
 if (!move) return;
 event.preventDefault();
 const next = keys[(Math.max(0, keys.indexOf(draft.activity)) + move + keys.length) % keys.length];
 edit({activity: next});
 el('activity').querySelector(`[data-activity="${next}"]`).focus();
});

// Typing in a weight box moves the allowance at the bottom of the card as you type; nothing is
// saved until Save, so a number half-entered is never written to the record.
for (const [id, key] of [['about-weight', 'weight'], ['goal-weight', 'goal'], ['goal-date', 'goalDate']]) {
 el(id).addEventListener('input', event => edit({[key]: event.target.value}));
}

// One Save for the whole card. Each part is checked before anything is written, so a mistyped
// goal cannot leave the profile saved and the goal not.
el('save-about').onclick = () => {
 const profile = validProfile(draft, YEAR);
 if (!profile) { status('Pick your body and activity level first.'); return; }
 const u = weightUnit(), {min, max} = weightRange(u);
 const typedW = draft.weight.trim(), typedG = draft.goal.trim();
 const weight = typedW ? parseWeight(typedW, u) : null;
 const goal = typedG ? parseWeight(typedG, u) : null;
 if (typedW && weight === null) { status('Enter a weight between ' + min + ' and ' + max + ' ' + u + '.'); return; }
 if (typedG && goal === null) { status('Enter a goal between ' + min + ' and ' + max + ' ' + u + '.'); return; }
 if (draft.goalDate && draft.goalDate <= localToday()) { status('Pick a goal date after today, or leave it empty.'); return; }
 document.activeElement?.blur();
 // Only what changed is written. Saving an unchanged goal would stamp it with a newer time and
 // beat an edit made on another device, and an unchanged weight box would write today a weigh-in
 // the person never stepped on the scales for.
 const goalChanged = edited('goal', u) || draft.goalDate !== seeded.goalDate;
 const weightChanged = edited('weight', u) && weight !== null;
 try {
  dirty = false;
  saveSettings(goalChanged ? {profile, goalWeight: goal, goalDate: draft.goalDate || null} : {profile});
  if (weightChanged) saveDay(localToday(), {weight: String(weight)});
  status('Saved' + (weightChanged ? ', weighed in at ' + weightText(weight, u) : '') + (goalChanged && goal ? ', aiming for ' + weightText(goal, u) : '') + '.');
 } catch {
  dirty = true;
  status('Could not save. Check that browser storage is enabled.');
 }
};

el('clear-goal').onclick = () => {
 try {
  dirty = false;
  saveSettings({goalWeight: null, goalDate: null});
  update({goal: '', goalDate: ''});
  status('Goal cleared.');
 } catch {
  dirty = true;
  status('Could not save.');
 }
};

el('use-suggestion').onclick = () => {
 const profile = validProfile(draft, YEAR);
 const result = suggestedAllowance(draft, typedWeight(), typedGoal(), YEAR);
 if (!profile || !result) return;
 try {
  const current = targetsOf(read(KEYS.settings));
  saveSettings({profile, calorieTargets: withAllowance(current, current.length ? localToday() : EARLIEST, result.allowance)});
  el('use-suggestion').hidden = true;
  status('Allowance set to ' + fmt(result.allowance) + ' kcal a day from today.');
 } catch { status('Could not set the allowance.'); }
};

el('rerun-setup').onclick = () => window.dispatchEvent(new Event('setup-restart'));

// A sync or a save elsewhere refreshes the card, but never while it holds unsaved edits: an
// arriving update must not overwrite what someone is in the middle of.
function load() {
 renderUnit();
 if (!draft || (!dirty && !el('about').contains(document.activeElement))) draft = fromSettings();
 update({});
}
for (const event of ['tracker-synced', 'checkin-saved', 'settings-saved']) window.addEventListener(event, load);
load();
