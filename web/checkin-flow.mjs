// The prompt at the top of Today: one question at a time, and gone once it is answered.
// It appears only for today, only while something is still unanswered, and never blocks the
// screen — every question can be put off, and the full form lower down stays the place to edit.
import {KEYS, read, saveDay, weightUnit, localToday, selectedDate, h, icon} from './store.mjs';
import {STEPS, SCALE, isAnswered, answeredCount, isComplete, nextStep} from './checkin-steps.mjs';
import {FEEL_MAX} from './recovery.mjs';
import {inputValue, parseWeight, weightRange} from './units.mjs';

const el = id => document.getElementById(id);
// Dismissing is a per-device choice about today's prompt, so it stays out of the synced record.
const DISMISSED_KEY = 'daily-check-in-prompt-v1';
const LEAVING_MS = 600;

// Questions put off with "Later" come back on the next load: this is for getting past one
// question now, not a lasting choice, and the card is gone for the day either way once skipped.
const putOff = new Set();
let leaving = false;
// Whether an answer landed in this sitting, and on which day. A day finished earlier, or on
// another device, should not replay the farewell every time Today is opened.
let answeredOn = null;
let showing = null;
let error = '';
// What is typed in the weight box. Kept here so a sync or a settings save landing mid-entry
// cannot rebuild the card out from under it.
let draft = '';

const dismissed = () => {
 try {
  const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}');
  return value && typeof value === 'object' ? value : {};
 } catch { return {}; }
};
const dismiss = date => { try { localStorage.setItem(DISMISSED_KEY, JSON.stringify({[date]: true})); } catch { /* storage off: it just reappears */ } };
// The day types come from the form's own menu, so the two can never fall out of step.
const dayTypes = () => [...(el('kind')?.options || [])].map(option => option.value).filter(Boolean);
const greeting = (hour = new Date().getHours()) => (hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening') + ' check-in';

function answer(date, key, value) {
 error = '';
 try {
  saveDay(date, {[key]: value});
  answeredOn = date;
 } catch {
  error = 'Could not save. Check that browser storage is enabled.';
  render({force: true});
 }
}

const scaleStep = (date, step) => [
 h('div', {class: 'checkin__ends'}, h('span', {}, step.ends[0]), h('span', {}, step.ends[1])),
 h('div', {class: 'checkin__scale', role: 'group', 'aria-label': step.question},
  ...SCALE.map(value => h('button', {
   type: 'button', 'aria-label': value + ' of ' + FEEL_MAX,
   onclick: () => answer(date, step.key, value),
  }, String(value)))),
];

function weightStep(date, step, entry) {
 const unit = weightUnit();
 const {min, max} = weightRange(unit);
 const field = h('input', {
  class: 'checkin__input', type: 'number', inputmode: 'decimal', step: '0.1', min, max,
  value: draft || inputValue(entry.weight, unit), placeholder: 'Weight in ' + unit, 'aria-label': 'Weight in ' + unit,
 });
 field.addEventListener('input', () => { draft = field.value; });
 // A number that cannot be read is a typo, not a decision to skip: say so and stay put.
 const save = () => {
  const weight = parseWeight(field.value, unit);
  if (field.value.trim() && weight !== null) { draft = ''; return answer(date, 'weight', String(weight)); }
  error = 'Enter a weight between ' + min + ' and ' + max + ' ' + unit + ', or tap Later.';
  render({force: true});
 };
 field.addEventListener('keydown', event => { if (event.key === 'Enter') save(); });
 return [field, h('button', {class: 'checkin__go', type: 'button', onclick: save}, 'Save weight')];
}

const choiceStep = (date, entry) => [
 h('div', {class: 'checkin__chips', role: 'group', 'aria-label': 'Day type'},
  ...dayTypes().map(name => h('button', {
   type: 'button', 'aria-pressed': String(entry.kind === name),
   onclick: () => answer(date, 'kind', name),
  }, name))),
];

function later(step) {
 putOff.add(step.key);
 error = '';
 draft = '';
 render({force: true});
}

function body(date, step, entry) {
 if (step.type === 'scale') return scaleStep(date, step);
 if (step.type === 'weight') return weightStep(date, step, entry);
 return choiceStep(date, entry);
}

// Folds the card away. The dismissal is written straight away, so closing the app mid-animation
// cannot bring the card back.
function finish(box, date, message) {
 if (leaving) return;
 leaving = true;
 dismiss(date);
 box.replaceChildren(h('div', {class: 'checkin__done checkin__step'}, icon('spark'), h('span', {}, message)));
 box.classList.add('checkin--leaving');
 setTimeout(() => {
  leaving = false;
  answeredOn = null;
  showing = null;
  box.classList.remove('checkin--leaving');
  render();
 }, LEAVING_MS);
}

// A sync or a settings save must not wipe a half-typed weight or restart the animation, so an
// unchanged question is left exactly as it is.
const sameStep = (step, box) => showing === step.key && box.firstChild;

function render({force = false} = {}) {
 const box = el('checkin-flow');
 if (!box || leaving) return;
 const date = selectedDate();
 const entry = read(KEYS.days)[date] || {};
 const next = nextStep(entry, putOff);
 // The last answer earns a moment before the card goes, but only for the person who just gave
 // it: a day completed on another device should simply not show the prompt.
 const farewell = isComplete(entry) && answeredOn === date;
 // Past days are a record, not a prompt: the form lower down handles those.
 box.hidden = date !== localToday() || Boolean(dismissed()[date]) || (!next && !farewell);
 if (box.hidden) { box.replaceChildren(); showing = null; return; }
 if (farewell) { finish(box, date, 'All set. Have a good one.'); return; }
 if (!force && sameStep(next, box)) return;

 const question = h('p', {class: 'checkin__question', tabindex: '-1'}, next.question);
 box.replaceChildren(
  h('div', {class: 'checkin__head'},
   h('p', {class: 'checkin__title'}, greeting()),
   h('div', {class: 'checkin__progress', role: 'img', 'aria-label': answeredCount(entry) + ' of ' + STEPS.length + ' answered'},
    ...STEPS.map(step => h('i', {class: isAnswered(entry, step) ? 'is-done' : ''})))),
  h('div', {class: 'checkin__step'}, question, ...body(date, next, entry)),
  ...(error ? [h('p', {class: 'checkin__error', role: 'alert'}, error)] : []),
  h('div', {class: 'checkin__foot'},
   h('button', {class: 'checkin__link', type: 'button', onclick: () => later(next)}, 'Later'),
   h('button', {class: 'checkin__link', type: 'button', onclick: () => finish(box, date, 'Skipped for today.')}, 'Skip the rest')),
 );
 // Keyboard and screen-reader users lose their place when the tapped button is replaced, so
 // the new question takes focus — but only once it is a different question.
 if (showing !== null && showing !== next.key && document.activeElement !== document.body) question.focus({preventScroll: true});
 showing = next.key;
}

for (const event of ['tracker-synced', 'checkin-saved', 'settings-saved']) window.addEventListener(event, () => render());
el('day').addEventListener('change', () => { putOff.clear(); error = ''; draft = ''; answeredOn = null; showing = null; render({force: true}); });
render();
