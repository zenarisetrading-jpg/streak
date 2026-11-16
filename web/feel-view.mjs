// The daily check-in your watch cannot do for you: four taps on how the day feels.
// Answers are kept on the day's own record, next to weight and the note, so they sync
// with everything else and the weight form leaves them alone.
import {KEYS, read, saveDay, selectedDate, h, icon} from './store.mjs';
import {FEEL_MAX, isFeelValue} from './recovery.mjs';
import {FEEL_QUESTIONS, SCALE, describeFeel, scaleLabel} from './checkin-steps.mjs';

const el = id => document.getElementById(id);

// Kept outside the card, because saving redraws it.
let message = '';
const status = text => { message = text; };
const entryFor = date => read(KEYS.days)[date] || {};

// Saving keeps every other field on the day, so the weight form and this card cannot
// overwrite each other.
function save(date, key, value) {
 const current = read(KEYS.days)[date] || {};
 // A stored answer can come back from the server as text, so compare the numbers: tapping the
 // number already chosen should always clear it.
 const next = Number(current[key]) === value ? '' : value;
 // The message is set first: saveDay dispatches its event synchronously, so the card redraws
 // before this function returns and would otherwise show the previous tap's message.
 status(answered({...current, [key]: next}) === FEEL_QUESTIONS.length ? 'All four saved.' : 'Saved.');
 try { saveDay(date, {[key]: next}); }
 catch { status('Could not save. Check that browser storage is enabled.'); render(); }
}

// The same test the score uses, so the count here can never disagree with it.
const answered = entry => FEEL_QUESTIONS.filter(({key}) => isFeelValue(entry[key])).length;

function question(date, {key, label, ends}, entry) {
 const chosen = isFeelValue(entry[key]) ? Number(entry[key]) : 0;
 return h('div', {class: 'field', style: {margin: '0'}},
  h('div', {class: 'row-between'}, h('span', {class: 'label'}, label), h('span', {class: 'hint'}, ends[0] + ' → ' + ends[1])),
  h('div', {class: 'segmented', role: 'group', 'aria-label': label},
   ...SCALE.map(value => h('button', {
    type: 'button', class: 'num', 'aria-pressed': String(value === chosen),
    'aria-label': label + ' ' + value + ' of ' + FEEL_MAX,
    onclick: () => save(date, key, value),
   }, String(value)))));
}

const dots = value => Array.from({length: FEEL_MAX}, (_, i) =>
 h('i', {class: [i < value ? 'is-on' : '', i + 1 === value ? 'is-last' : ''].filter(Boolean).join(' ')}));

// Once every answer is in, the four scales would only repeat what the prompt at the top of
// Today already asked, so the card shows what was said and gets out of the way.
const summary = entry => h('div', {style: {'margin-top': 'var(--space-3)'}},
 ...FEEL_QUESTIONS.map(({key, label, ends, icon: name}) => {
  const value = Number(entry[key]);
  return h('div', {class: 'feel-row'},
   h('span', {class: 'feel-row__name'}, icon(name), label),
   h('span', {class: 'feel-row__read'},
    h('span', {class: 'hint'}, describeFeel(value, ends)),
    h('span', {class: 'dots', role: 'img', 'aria-label': scaleLabel(label, value, ends)}, ...dots(value))));
 }));

let editing = false;

function render() {
 const date = selectedDate();
 const entry = entryFor(date);
 const done = answered(entry);
 const complete = done === FEEL_QUESTIONS.length;
 const showSummary = complete && !editing;
 el('feel-card').replaceChildren(
  h('div', {class: 'card__head'},
   h('h2', {class: 'card__title'}, showSummary ? 'How you felt' : 'How do you feel?'),
   showSummary ? h('button', {class: 'btn btn--ghost', type: 'button', onclick: () => { editing = true; render(); }}, 'Edit')
    : editing ? h('button', {class: 'btn btn--ghost', type: 'button', onclick: () => { editing = false; render(); }}, 'Done')
    : h('span', {class: 'chip' + (complete ? ' chip--under' : '')}, done + ' of ' + FEEL_QUESTIONS.length)),
  // replaceChildren would print a bare null, so the scales are spread in only when shown.
  showSummary ? summary(entry) : h('p', {class: 'card__sub'}, 'Tap a number. This is the part your Watch cannot see, and it feeds the recovery score.'),
  ...(showSummary ? [] : [h('div', {class: 'stack', style: {gap: 'var(--space-4)', 'margin-top': 'var(--space-4)'}},
   ...FEEL_QUESTIONS.map(item => question(date, item, entry)))]),
  h('p', {class: 'status', role: 'status'}, message));
}

for (const event of ['tracker-synced', 'checkin-saved']) window.addEventListener(event, render);
el('day').addEventListener('change', () => { message = ''; editing = false; render(); });
render();
