// The setup flow a new person sees first: one question a screen, nothing to read, and an
// allowance at the end of it. Everything it asks is also editable in Settings afterwards — this
// exists so the first run is six taps instead of a tour of seven cards across two tabs.
import {STEPS, LAST, stepAt, defaultDraft, problem, outcome, setupPatch, hasAllowance, MIN_AGE, MAX_AGE, MIN_HEIGHT_IN, MAX_HEIGHT_IN} from './setup-steps.mjs';
import {ACTIVITY, ACTIVITY_TILES} from './profile.mjs';
import {figureMarkup, heightLabel, FIGURE_VIEWBOX} from './figure.mjs';
import {KEYS, read, saveDay, saveSettings, localToday, targetsOf, fmt, h, icon, rangeFill} from './store.mjs';
import {weightRange, weightText, heightText, WEIGHT_UNITS, inputValue, parseWeight} from './units.mjs';

const el = id => document.getElementById(id);
const YEAR = new Date().getFullYear();
const ADVANCE_MS = 220;
// Putting setup off is a choice about this device, not a fact about the person, so it stays out
// of the synced settings. It only silences the flow; Settings still has "Walk me through it".
const SKIPPED_KEY = 'daily-check-in-setup-v1';

let index = 0;
let draft = null;
let error = '';
let open = false;
// The pending auto-advance. It has to be cancellable: a second tap, or Back, within the fifth of
// a second a pick waits would otherwise be acted on by a timer that was meant for the step before.
let timer = null;
// Whether this run was asked for ("Walk me through it again") rather than offered to an empty
// account. An asked-for run is never closed by an arriving sync.
let asked = false;

const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

const skipped = () => { try { return localStorage.getItem(SKIPPED_KEY) === 'later'; } catch { return false; } };
const rememberSkip = () => { try { localStorage.setItem(SKIPPED_KEY, 'later'); } catch { /* storage off: it asks again */ } };

// Every change to an answer goes through here, so the step on screen and the draft behind it
// cannot disagree.
function update(patch) {
 draft = {...draft, ...patch};
 error = '';
 render();
}

const unitButtons = () => h('div', {class: 'segmented', role: 'group', 'aria-label': 'Weigh in'},
 ...WEIGHT_UNITS.map(unit => h('button', {
  type: 'button', 'aria-pressed': String(draft.unit === unit),
  onclick: () => { if (draft.unit !== unit) update({unit, weight: convert(draft.weight, unit), goal: convert(draft.goal, unit)}); },
 }, unit)));

// Switching units mid-flow keeps the weight you already typed, read back in the new unit,
// rather than leaving 190 in a box that now says kg.
const convert = (typed, unit) => {
 const pounds = parseWeight(typed, draft.unit);
 return pounds === null ? '' : inputValue(pounds, unit);
};

// A number box that remembers what is typed and takes Enter as Continue.
function numberField(key, {label, placeholder}) {
 const {min, max} = weightRange(draft.unit);
 const field = h('input', {
  class: 'setup__input num', type: 'number', inputmode: 'decimal', step: '0.1', min, max,
  value: draft[key], placeholder, 'aria-label': label, autocomplete: 'off',
 });
 // Typing cannot re-render — that would take the caret with it — so the complaint about the
 // last answer is taken off the screen by hand rather than by rebuilding the step.
 field.addEventListener('input', () => {
  draft = {...draft, [key]: field.value, maintain: false};
  if (error) { error = ''; el('setup').querySelector('.setup__error')?.remove(); }
  live();
 });
 field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); next(); } });
 return field;
}

// The one line under the goal box: what the answer so far means, so the number is not abstract.
function live() {
 const note = el('setup-live');
 if (!note) return;
 const step = stepAt(index);
 if (step.type !== 'goal') return;
 const now = parseWeight(draft.weight, draft.unit);
 const goal = draft.maintain ? null : parseWeight(draft.goal, draft.unit);
 note.textContent = goal === null || now === null ? ''
  : Math.abs(goal - now) < 1 ? 'That is about where you are now — we will hold you steady.'
  : weightText(Math.abs(goal - now), draft.unit) + (goal < now ? ' to lose.' : ' to gain.');
}

function heightBody() {
 const svg = h('svg', {class: 'setup__figure', viewBox: FIGURE_VIEWBOX, 'aria-hidden': 'true'});
 svg.innerHTML = figureMarkup(draft);
 const shown = heightText(draft.heightIn, draft.unit) ?? heightLabel(draft.heightIn);
 const readout = h('output', {class: 'picker__value'}, shown);
 const slider = h('input', {
  class: 'range', type: 'range', min: MIN_HEIGHT_IN, max: MAX_HEIGHT_IN, step: '1',
  value: String(draft.heightIn), 'aria-label': 'Height', 'aria-valuetext': shown,
 });
 rangeFill(slider);
 // Redrawn in place rather than through update(), so dragging the slider does not rebuild the
 // step underneath the thumb and drop the drag.
 slider.addEventListener('input', () => {
  draft = {...draft, heightIn: Number(slider.value)};
  const label = heightText(draft.heightIn, draft.unit) ?? heightLabel(draft.heightIn);
  readout.textContent = label;
  slider.setAttribute('aria-valuetext', label);
  rangeFill(slider);
  svg.innerHTML = figureMarkup(draft);
 });
 return [h('div', {class: 'setup__stage'}, svg), readout, slider];
}

function yearBody() {
 const readout = h('output', {class: 'picker__value'}, String(draft.birthYear));
 const age = h('p', {class: 'setup__live'}, (YEAR - draft.birthYear) + ' years old');
 const slider = h('input', {
  class: 'range', type: 'range', min: YEAR - MAX_AGE, max: YEAR - MIN_AGE, step: '1',
  value: String(draft.birthYear), 'aria-label': 'Birth year', 'aria-valuetext': String(draft.birthYear),
 });
 rangeFill(slider);
 slider.addEventListener('input', () => {
  draft = {...draft, birthYear: Number(slider.value)};
  readout.textContent = String(draft.birthYear);
  slider.setAttribute('aria-valuetext', String(draft.birthYear));
  rangeFill(slider);
  age.textContent = (YEAR - draft.birthYear) + ' years old';
 });
 return [readout, age, slider];
}

// Picking is the answer, so the flow moves on by itself: a tap plus a Continue tap is one tap
// too many when the tap already said everything. The wait is there to let the chosen tile show
// as chosen — which means anything the person does inside it wins, and the timer is dropped.
function pick(patch) {
 const from = index;
 update(patch);
 cancel();
 timer = setTimeout(() => { timer = null; if (open && index === from) next(); }, ADVANCE_MS);
}

const sexBody = () => [h('div', {class: 'setup__choices'},
 ...[['male', 'Male'], ['female', 'Female']].map(([value, label]) => h('button', {
  class: 'setup__choice', type: 'button', 'aria-pressed': String(draft.sex === value), onclick: () => pick({sex: value}),
 }, label)))];

const activityBody = () => [h('div', {class: 'setup__tiles', role: 'radiogroup', 'aria-label': 'How active is a normal week?'},
 ...Object.entries(ACTIVITY_TILES).map(([value, {emoji, title, detail}]) => h('button', {
  class: 'activity-tile', type: 'button', role: 'radio', 'aria-checked': String(draft.activity === value),
  'aria-label': ACTIVITY[value].label, onclick: () => pick({activity: value}),
 }, h('span', {class: 'activity-tile__icon', 'aria-hidden': 'true'}, emoji), h('strong', {}, title), h('small', {}, detail))))];

const goalBody = () => [
 numberField('goal', {label: 'Goal weight in ' + draft.unit, placeholder: draft.unit === 'kg' ? 'e.g. 80' : 'e.g. 175'}),
 h('p', {class: 'setup__live', id: 'setup-live'}),
 h('button', {class: 'setup__later', type: 'button', onclick: () => pick({maintain: true, goal: ''})}, 'I just want to hold steady'),
];

function resultBody() {
 const result = outcome(draft, YEAR);
 if (!result) return [h('p', {class: 'setup__live'}, 'Something is still missing. Step back and check your answers.')];
 const {allowance, maintenance, protein, direction} = result;
 return [
  h('p', {class: 'setup__number num'}, fmt(allowance), h('span', {class: 'stat__unit'}, 'kcal a day')),
  h('p', {class: 'setup__live'},
   direction < 0 ? 'About ' + fmt(maintenance) + ' holds your weight. We hold back ' + fmt(maintenance - allowance) + ' so you lose steadily.'
   : direction > 0 ? 'About ' + fmt(maintenance) + ' holds your weight, plus ' + fmt(allowance - maintenance) + ' to gain slowly.'
   : 'That is about what holds your weight steady.'),
  h('div', {class: 'setup__facts'},
   h('div', {}, h('p', {class: 'eyebrow'}, 'Protein'), h('p', {class: 'stat__value num'}, fmt(protein), h('span', {class: 'stat__unit'}, 'g'))),
   h('div', {}, h('p', {class: 'eyebrow'}, 'A week'), h('p', {class: 'stat__value num'}, fmt(allowance * 7), h('span', {class: 'stat__unit'}, 'kcal')))),
  h('p', {class: 'setup__fine'}, 'Every one of these is in Settings, and after two weeks of logging Analytics measures your real maintenance instead of estimating it.'),
 ];
}

function body(step) {
 switch (step.type) {
  case 'weight': return [unitButtons(), numberField('weight', {label: 'Weight in ' + draft.unit, placeholder: draft.unit === 'kg' ? 'e.g. 86' : 'e.g. 190'})];
  case 'height': return heightBody();
  case 'year': return yearBody();
  case 'sex': return sexBody();
  case 'activity': return activityBody();
  case 'goal': return goalBody();
  default: return resultBody();
 }
}

function next() {
 cancel();
 const step = stepAt(index);
 const wrong = problem(step, draft, YEAR);
 if (wrong) { error = wrong; render(); return; }
 if (index === LAST) return finish();
 index += 1;
 error = '';
 render();
}

function back() {
 cancel();
 if (index === 0) return;
 index -= 1;
 error = '';
 render();
}

function finish() {
 const patch = setupPatch(draft, {date: localToday(), targets: targetsOf(read(KEYS.settings)), year: YEAR});
 if (!patch) { error = 'Something is still missing. Step back and check your answers.'; render(); return; }
 try {
  saveSettings(patch.settings);
  saveDay(localToday(), patch.day);
 } catch {
  error = 'Could not save. Check that browser storage is enabled.';
  render();
  return;
 }
 close();
}

// The app behind the overlay is not just out of sight: it is taken out of the page entirely, so
// Tab cannot walk into it and a screen reader cannot read it through the setup flow.
const BEHIND = ['topbar', 'sync-status'];
const shut = out => {
 for (const main of [document.querySelector('main.app'), document.querySelector('nav.tabbar'), ...BEHIND.map(el)]) {
  if (main) main.inert = out;
 }
};

function close() {
 cancel();
 open = false;
 asked = false;
 el('setup').hidden = true;
 el('setup').replaceChildren();
 document.body.classList.remove('is-setup');
 shut(false);
 // Hand the keyboard back to the app rather than dropping it at the top of the document.
 document.querySelector('[data-go="settings"]')?.focus({preventScroll: true});
}

function later() {
 rememberSkip();
 close();
}

function render() {
 const box = el('setup');
 if (!box || !open) return;
 const step = stepAt(index);
 const percent = Math.round((index + 1) / STEPS.length * 100);
 const title = h('h2', {class: 'setup__title', tabindex: '-1'}, step.title);
 box.replaceChildren(h('div', {class: 'setup__sheet'},
  h('div', {class: 'setup__head'},
   index === 0
    ? h('span', {class: 'setup__logo', 'aria-hidden': 'true'}, icon('spark'))
    : h('button', {class: 'setup__icon', type: 'button', 'aria-label': 'Back', onclick: back}, icon('left')),
   h('div', {class: 'setup__bar', role: 'img', 'aria-label': 'Step ' + (index + 1) + ' of ' + STEPS.length}, h('span', {style: {'--p': percent + '%'}})),
   index === LAST ? null : h('button', {class: 'setup__later', type: 'button', onclick: later}, 'Later')),
  h('div', {class: 'setup__step', key: step.key},
   title,
   step.hint ? h('p', {class: 'setup__hint'}, step.hint) : null,
   ...body(step)),
  h('div', {class: 'setup__foot'},
   error ? h('p', {class: 'setup__error', role: 'alert'}, error) : null,
   h('button', {class: 'btn btn--primary btn--block btn--lg', type: 'button', onclick: next},
    index === LAST ? 'Start tracking' : 'Continue')),
 ));
 live();
 // Rebuilding the step takes the focused control with it, so focus always has to be put back:
 // on the box to type in where there is one, and otherwise on the question, which is the thing
 // that changed and the thing a screen reader needs to hear.
 const field = box.querySelector('.setup__input');
 (field || title).focus({preventScroll: true});
}

export function start({invited = true} = {}) {
 const settings = read(KEYS.settings);
 cancel();
 draft = defaultDraft(settings.weightUnit, YEAR);
 index = 0;
 error = '';
 open = true;
 asked = invited;
 el('setup').hidden = false;
 document.body.classList.add('is-setup');
 shut(true);
 render();
}

// Offered to an account with no allowance at all, and never to one that has one: someone who set
// their allowance by hand before this flow existed does not need rescuing, and the flow would
// overwrite the number they chose. Settings still has "Walk me through it again" for them.
//
// It waits for the first sync, because a person signing in on a new device has an empty cache for
// the moment before their settings arrive, and that moment must not look like a new account.
function consider() {
 const settings = read(KEYS.settings);
 if (hasAllowance(settings)) {
  // Their own doing, so leave it: only an offer we made is taken back.
  if (open && !asked) close();
  return;
 }
 if (open || skipped()) return;
 start({invited: false});
}

// tracker-ready is the first sync finishing, however it finished; tracker-synced is every later
// change. Nothing is offered before the first one, because until then an empty cache says
// nothing about whether this person is new.
window.addEventListener('tracker-ready', consider);
window.addEventListener('tracker-synced', consider);
window.addEventListener('setup-restart', () => start());
