// Workout log: describe a session in your own words (or with the keyboard mic), let Claude
// structure it, review and correct it, then save it to the synced log for the selected date.
import {formatSets, parseSets, exerciseProgress, knownExercises, scaledKcal, absorbWatchSession} from './workout-math.mjs';
import {ageOf} from './profile.mjs';
import {recentWorkouts, shortLabel} from './recent.mjs';
import {KEYS, read, fmt, shortDate, latestWeight, creditsByDate, shareOf, weightUnit} from './store.mjs';

const el = id => document.getElementById(id);
const key = 'daily-check-in-workouts-v1';
const TYPES = [['strength', 'Strength'], ['cardio', 'Cardio'], ['sport', 'Sport'], ['mobility', 'Mobility / yoga'], ['mixed', 'Mixed'], ['other', 'Other']];
const MAX_KCAL = 5000;
const PROGRESS_SHOWN = 8;

const day = el('day'), notes = el('workout-text'), status = el('workout-status'), editor = el('workout-editor'), saveButton = el('save-workout');
// draft: the workout being reviewed; editing: id of the saved workout it replaces.
let draft = null, editing = null, busy = false;

const node = (parent, tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; parent.append(n); return n; };
const button = (parent, label, action) => { const b = node(parent, 'button', label); b.type = 'button'; b.onclick = action; return b; };

function field(parent, label, value, attrs, onInput) {
 const wrap = node(parent, 'label', '', 'field');
 node(wrap, 'span', label, 'label');
 const input = document.createElement(attrs.tag || 'input');
 input.className = attrs.tag === 'select' ? 'select' : 'input' + (attrs.type === 'number' ? ' num' : '');
 if (attrs.options) for (const [v, text] of attrs.options) input.append(new Option(text, v));
 const {tag: _tag, options: _options, ...rest} = attrs;
 Object.assign(input, rest, {value: value ?? ''});
 input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => onInput(input.value));
 wrap.append(input);
 return input;
}

const blankExercise = () => ({name: '', sets: [], setsText: '', unit: weightUnit(), distanceKm: null, minutes: null});
const withText = exercise => ({...exercise, setsText: exercise.setsText ?? formatSets(exercise.sets)});
const number = (value, max) => { const n = Number(value); return value !== '' && Number.isFinite(n) && n > 0 ? Math.min(n, max) : null; };

function renderEditor() {
 editor.replaceChildren();
 if (!draft) return;
 const update = patch => { draft = {...draft, ...patch}; };
 const head = node(editor, 'div', '', 'two-col');
 field(head, 'Session', draft.title, {type: 'text', maxLength: 120}, title => update({title}));
 field(head, 'Type', draft.type, {tag: 'select', options: TYPES}, type => update({type}));
 const numbers = node(editor, 'div', '', 'two-col');
 // Changing the session length rescales the calorie estimate at the same rate per minute. The rate
 // comes from the last minutes/kcal pair the person settled on, so typing digit by digit cannot drift.
 let base = {minutes: draft.minutes, kcal: draft.kcal};
 const minutesField = field(numbers, 'Minutes', draft.minutes ?? '', {type: 'number', inputMode: 'numeric', min: '0', max: '1440'}, v => {
  const minutes = number(v, 1440);
  // No length to go on yet: keep the calories while the first one is typed (it sets the rate on leaving the box).
  // Watch calories are measured, so a new length leaves them alone.
  if (!(base.minutes > 0) || draft.watch) { update({minutes}); return; }
  const kcal = Math.min(MAX_KCAL, scaledKcal(base, minutes));
  update({minutes, kcal});
  kcalField.value = kcal ? String(kcal) : '';
 });
 const kcalField = field(numbers, draft.watch ? 'Calories (from Apple Watch)' : 'Estimated kcal', draft.kcal || '', {type: 'number', inputMode: 'numeric', min: '0', max: String(MAX_KCAL)}, v => {
  const kcal = number(v, MAX_KCAL) ?? 0;
  update({kcal});
  base = {minutes: draft.minutes, kcal};
 });
 minutesField.addEventListener('change', () => { if (!(base.minutes > 0) && draft.minutes > 0) base = {minutes: draft.minutes, kcal: draft.kcal}; });
 const list = node(editor, 'ul', '', 'list');
 draft.exercises.forEach((exercise, index) => {
  const updateExercise = patch => update({exercises: draft.exercises.map((e, i) => i === index ? {...e, ...patch} : e)});
  const card = node(list, 'li', '', 'edit-item');
  const top = node(card, 'div', '', 'edit-head');
  field(top, 'Exercise', exercise.name, {type: 'text', maxLength: 60}, name => updateExercise({name}));
  button(top, 'Remove', () => { update({exercises: draft.exercises.filter((_, i) => i !== index)}); renderEditor(); }).className = 'btn btn--ghost';
  const sets = node(card, 'div', '', 'sets-row');
  field(sets, 'Sets (reps @ weight)', exercise.setsText, {type: 'text', maxLength: 200, placeholder: '3×8 @ 135, 6 @ 145'}, setsText => updateExercise({setsText}));
  field(sets, 'Unit', exercise.unit, {tag: 'select', options: [['lb', 'lb'], ['kg', 'kg']]}, unit => updateExercise({unit}));
  const cardio = node(card, 'div', '', 'two-col');
  field(cardio, 'Distance (km)', exercise.distanceKm ?? '', {type: 'number', inputMode: 'decimal', min: '0', step: '0.01'}, v => updateExercise({distanceKm: number(v, 500)}));
  field(cardio, 'Minutes', exercise.minutes ?? '', {type: 'number', inputMode: 'numeric', min: '0'}, v => updateExercise({minutes: number(v, 1440)}));
 });
 const addButton = button(editor, '+ Add exercise', () => { update({exercises: [...draft.exercises, blankExercise()]}); renderEditor(); editor.querySelector('ul > li:last-child input')?.focus(); });
 addButton.className = 'btn btn--secondary';
 addButton.style.marginTop = 'var(--space-3)';
 for (const note of draft.assumptions || []) node(editor, 'p', 'Assumed: ' + note, 'hint');
 saveButton.disabled = false;
}

// Shown right under Save and scrolled into view, so it is not hidden behind the phone keyboard.
function showError(message) {
 status.textContent = message;
 status.classList.add('error');
 document.activeElement?.blur();
 status.scrollIntoView({block: 'center', behavior: 'smooth'});
}

// While a workout is being checked or edited, the notes box and Log it step aside so the only
// actions are Cancel and Save workout.
function setReviewing(on) {
 el('workouts').classList.toggle('is-reviewing', on);
 el('workout-card-title').textContent = !on ? 'Log a session' : editing ? 'Edit workout' : 'Check and save';
}
function showDraft(next) { draft = {...next, exercises: next.exercises.map(withText)}; setReviewing(true); renderEditor(); }
function clearDraft() { draft = null; editor.replaceChildren(); saveButton.disabled = true; setReviewing(false); }
function reset() { editing = null; notes.value = ''; clearDraft(); }

async function requestWorkout(text) {
 let response;
 try {
  response = await fetch('/api/workout-estimate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, weightLb: Number(latestWeight()) || undefined, sex: read('daily-check-in-settings-v1').profile?.sex, age: ageOf(read('daily-check-in-settings-v1').profile) ?? undefined, known: knownExercises(read(key))})});
 } catch { throw new Error('Could not reach the server. Check your connection.'); }
 const body = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(body.error || 'The estimate failed (' + response.status + ').');
 return body;
}

el('estimate-workout').onclick = async () => {
 const text = notes.value.trim();
 if (!day.value || !text) { status.textContent = 'Choose a date and describe your workout.'; return; }
 if (busy) return;
 busy = true; el('estimate-workout').disabled = true; clearDraft(); status.classList.remove('error'); status.textContent = 'Reading your workout…';
 try {
  const result = await requestWorkout(text);
  if (!result.isWorkout) { status.textContent = (result.title || 'No exercise found in those notes.') + ' Nothing was saved.'; return; }
  showDraft(result);
  status.textContent = 'Check the exercises, sets and calories, then save.';
 } catch (error) {
  showDraft({title: text.slice(0, 120), type: 'other', minutes: null, kcal: 0, exercises: [blankExercise()], assumptions: []});
  status.textContent = error.message + ' Fill in the workout by hand instead.';
 } finally { busy = false; el('estimate-workout').disabled = false; }
};

el('cancel-workout').onclick = () => { reset(); status.textContent = ''; status.classList.remove('error'); };

el('manual-workout').onclick = () => {
 if (!day.value) { status.textContent = 'Choose a date first.'; return; }
 editing = null;
 showDraft({title: notes.value.trim().slice(0, 120), type: 'strength', minutes: null, kcal: 0, exercises: [blankExercise()], assumptions: []});
 status.textContent = 'Enter the workout, then save.';
};

saveButton.onclick = () => {
 if (!draft) return;
 const exercises = [];
 for (const exercise of draft.exercises) {
  const name = exercise.name.trim();
  if (!name) continue;
  const parsed = parseSets(exercise.setsText);
  if (parsed.error) { showError(name + ': ' + parsed.error); return; }
  exercises.push({name, sets: parsed.sets, unit: exercise.unit, distanceKm: exercise.distanceKm, minutes: exercise.minutes});
 }
 const title = draft.title.trim() || exercises[0]?.name || '';
 if (!title && !exercises.length) { status.textContent = 'Add a session name or an exercise before saving.'; return; }
 try {
  const data = read(key), entries = data[day.value] || [];
  // A Watch workout (or one the Watch's numbers were matched to) keeps its Watch numbers, so later
  // uploads know whether you changed them.
  const fromWatch = !editing || !draft.watch ? {} : draft.source === 'watch' ? {source: 'watch', start: draft.start, watch: draft.watch} : {watchId: draft.watchId, watch: draft.watch};
  const typed = {id: editing || crypto.randomUUID(), text: notes.value.trim(), title, type: draft.type, minutes: draft.minutes, kcal: Math.round(draft.kcal || 0), exercises, notes: draft.assumptions || [], ...fromWatch};
  // A session the Watch already sent (saved new, or given its minutes later) replaces that Watch
  // session instead of counting twice.
  const {entry, replaces} = absorbWatchSession(typed, entries);
  const kept = entries.filter(w => w.id !== replaces);
  const next = {...data, [day.value]: editing && kept.some(w => w.id === editing) ? kept.map(w => w.id === editing ? entry : w) : [...kept, entry]};
  localStorage.setItem(key, JSON.stringify(next));
  if (replaces) window.trackerWrite('workout:' + day.value + ':' + replaces, null);
  window.trackerWrite('workout:' + day.value + ':' + entry.id, entry);
  reset(); render(); status.classList.remove('error'); status.textContent = replaces ? 'Workout saved with the Apple Watch calories.' : 'Workout saved.';
 } catch { status.textContent = 'Could not save. Check browser storage.'; }
};

const sessionLabel = s => s.best ? (s.best.reps ?? '?') + ' × ' + s.best.weight + ' ' + s.unit : s.distanceKm ? s.distanceKm + ' km' : s.minutes + ' min';
const svgIcon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg; };

function progressDelta(p) {
 if (p.trend === null) return node(document.createDocumentFragment(), 'span', p.sessions === 1 ? 'first log' : '→ same', 'delta');
 const latest = p.latest, before = p.previous;
 const amount = latest.best && before.best ? Math.abs(Math.round((latest.best.weight - before.best.weight) * 10) / 10) + ' ' + latest.unit
  : latest.distanceKm && before.distanceKm ? Math.abs(Math.round((latest.distanceKm - before.distanceKm) * 100) / 100) + ' km' : 'vs last';
 const text = (p.trend > 0 ? '↑ ' : p.trend < 0 ? '↓ ' : '→ ') + (amount.startsWith('0 ') ? 'more reps' : amount);
 return node(document.createDocumentFragment(), 'span', text, 'delta' + (p.trend > 0 ? ' delta--good' : p.trend < 0 ? ' delta--bad' : ''));
}

function renderProgress() {
 const list = el('exercise-progress');
 list.replaceChildren();
 const progress = exerciseProgress(read(key)).slice(0, PROGRESS_SHOWN);
 for (const p of progress) {
  const item = node(list, 'li', '', 'list-row');
  const body = node(item, 'div', '', 'list-row__body');
  node(body, 'p', p.name, 'list-row__title');
  node(body, 'p', sessionLabel(p.latest) + ' · ' + shortDate(p.latest.date) + (p.previous ? ' · before ' + sessionLabel(p.previous) : ''), 'list-row__meta num');
  item.append(progressDelta(p));
 }
 if (!progress.length) node(list, 'li', 'Progress per exercise appears after you log workouts with sets or distances.', 'hint');
}

// What counted toward the allowance this day and where it came from (the Watch's extra activity
// or the logged sessions, whichever is larger), plus the eat-back share, so this tile and the
// workout cards below always add up.
function creditNote(credit, share, hasWatchData) {
 if (!credit || credit.source === null) return hasWatchData ? 'Your Watch shows no extra activity yet' : 'Nothing logged yet';
 let note;
 if (credit.source === 'watch') {
  note = (credit.final ? 'Your Watch: ' : 'Your Watch so far: ') + fmt(credit.watch) + ' kcal above your usual day' + (credit.logged ? ', more than the ' + fmt(credit.logged) + ' kcal on your logged workouts.' : '.');
 } else {
  note = fmt(credit.logged) + ' kcal from your logged workouts';
  if (credit.watch !== null) note += ', more than the ' + fmt(credit.watch) + ' kcal of extra activity your Watch ' + (credit.final ? 'recorded.' : 'has so far.');
  else note += '.' + (hasWatchData ? ' Your Watch counts too once it has learned your usual day (about 5 days of data).' : '');
 }
 if (share < 1) note += ' You eat back ' + Math.round(share * 100) + '%, so ' + fmt(credit.kcal) + ' counts.';
 return note;
}

function renderTiles() {
 const all = read(key);
 const credit = creditsByDate()[day.value];
 const monday = new Date(day.value + 'T12:00:00'); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
 const weekDates = Array.from({length: 7}, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); });
 const sessions = weekDates.reduce((sum, d) => sum + (all[d] || []).length, 0);
 const tiles = el('workout-tiles');
 tiles.replaceChildren();
 const counted = credit?.kcal || 0;
 const note = creditNote(credit, shareOf(read(KEYS.settings)), Boolean(read(KEYS.health)[day.value]));
 for (const [label, value, unitText, iconName, foot] of [['Counted this day', (counted ? '+' : '') + fmt(counted), 'kcal', 'flame', note], ['Sessions this week', String(sessions), '', 'cal', '']]) {
  const tile = node(tiles, 'article', '', 'stat');
  const head = node(tile, 'div', '', 'stat__head');
  node(head, 'p', label, 'eyebrow');
  node(head, 'span', '', 'stat__icon stat__icon--accent').append(svgIcon(iconName));
  const v = node(tile, 'p', value, 'stat__value num');
  if (unitText) node(v, 'span', unitText, 'stat__unit');
  if (foot) node(tile, 'p', foot, 'stat__foot');
 }
}

const TYPE_LABEL = Object.fromEntries(TYPES);
const setLabel = (set, unit) => set.reps && set.weight ? set.reps + ' × ' + set.weight + ' ' + unit : set.reps ? set.reps + ' reps' : '@ ' + set.weight + ' ' + unit;
const volume = exercise => exercise.sets.reduce((sum, s) => sum + (s.reps || 0) * (s.weight || 0), 0);

// One exercise as stored: its name, a summary, and a chip for every set.
function exerciseBlock(parent, exercise) {
 const block = node(parent, 'li', '', 'exercise');
 const head = node(block, 'div', '', 'exercise__head');
 node(head, 'strong', exercise.name);
 const total = volume(exercise);
 const summary = [exercise.sets.length && exercise.sets.length + (exercise.sets.length === 1 ? ' set' : ' sets'), total && fmt(total) + ' ' + exercise.unit + ' lifted', exercise.distanceKm && exercise.distanceKm + ' km', exercise.minutes && exercise.minutes + ' min'].filter(Boolean).join(' · ');
 node(head, 'span', summary, 'hint num');
 if (exercise.sets.length) {
  const chips = node(block, 'ol', '', 'set-chips');
  exercise.sets.forEach((set, i) => {
   const chip = node(chips, 'li', '', 'set-chip num');
   node(chip, 'span', String(i + 1), 'set-chip__n');
   chip.append(setLabel(set, exercise.unit));
  });
 }
}

function workoutCard(parent, workout, watchCounts) {
 const item = node(parent, 'li', '', 'workout');
 const head = node(item, 'div', '', 'list-row');
 const lead = node(head, 'span', '', 'list-row__lead');
 lead.style.background = 'var(--color-accent-soft)'; lead.style.color = 'var(--color-accent-ink)';
 lead.append(svgIcon(workout.type === 'cardio' ? 'steps' : 'dumbbell'));
 const body = node(head, 'div', '', 'list-row__body');
 node(body, 'p', workout.title, 'list-row__title');
 node(body, 'p', [(workout.source === 'watch' || workout.watch) && 'Apple Watch', TYPE_LABEL[workout.type], workout.minutes && workout.minutes + ' min', workout.exercises.length + (workout.exercises.length === 1 ? ' exercise' : ' exercises')].filter(Boolean).join(' · '), 'list-row__meta');
 const trail = node(head, 'div', '', 'list-row__trail');
 // What this session burned, by the estimate. Muted with "≈" once the Watch's number has replaced it;
 // how much of it counts toward the allowance is explained in the tile above.
 if (workout.watch && workout.kcal === workout.watch.kcal) { node(trail, 'strong', fmt(workout.kcal || 0)).style.color = 'var(--color-accent-ink)'; node(trail, 'span', 'kcal · Watch', 'hint'); }
 else if (watchCounts) { node(trail, 'strong', '≈' + fmt(workout.kcal || 0), 'est'); node(trail, 'span', 'kcal est.', 'hint'); }
 else { node(trail, 'strong', fmt(workout.kcal || 0)).style.color = 'var(--color-accent-ink)'; node(trail, 'span', 'kcal burned', 'hint'); }
 if (workout.exercises.length) {
  const list = node(item, 'ul', '', 'exercises');
  for (const exercise of workout.exercises) exerciseBlock(list, exercise);
 }
 const actions = node(item, 'div', '', 'row-actions');
 button(actions, workout.source === 'watch' && !workout.exercises.length ? 'Add exercises' : 'Edit', () => { editing = workout.id; notes.value = workout.text || ''; showDraft({...workout, assumptions: workout.notes || []}); el('workouts').scrollIntoView({block: 'start'}); }).className = 'btn btn--ghost';
 button(actions, 'Remove', () => {
  if (!confirm('Remove this workout?')) return;
  try {
   const data = read(key);
   localStorage.setItem(key, JSON.stringify({...data, [day.value]: (data[day.value] || []).filter(w => w.id !== workout.id)}));
   window.trackerWrite('workout:' + day.value + ':' + workout.id, null);
   if (editing === workout.id) reset();
   render(); status.textContent = 'Workout removed.';
  } catch { status.textContent = 'Could not remove the workout.'; }
 }).className = 'btn btn--ghost';
}

// A past session back in the editor as a new workout for the selected day.
function doAgain(workout) {
 editing = null; notes.value = '';
 showDraft({title: workout.title, type: workout.type, minutes: workout.minutes, kcal: workout.kcal || 0, exercises: workout.exercises, assumptions: []});
 status.classList.remove('error');
 status.textContent = 'Change the sets, weights or minutes, then save.';
 el('workouts').scrollIntoView({block: 'start'});
}

// A dropdown of past sessions; picking one opens it in the editor, then the dropdown goes back to its prompt.
let againWorkouts = [];
function renderAgain() {
 againWorkouts = recentWorkouts(read(key), {upTo: day.value});
 el('workout-again').hidden = !againWorkouts.length;
 el('workout-again-list').replaceChildren(new Option('Pick a past session…', ''), ...againWorkouts.map((workout, i) => new Option(shortLabel(workout.title, 40) + (workout.minutes ? ' · ' + workout.minutes + ' min' : ''), String(i))));
}
el('workout-again-list').addEventListener('change', event => {
 const workout = event.target.value === '' ? null : againWorkouts[Number(event.target.value)];
 event.target.value = '';
 if (workout) doAgain(workout);
});

function render() {
 const history = el('workout-history');
 history.replaceChildren();
 const workouts = read(key)[day.value] || [];
 const credit = creditsByDate()[day.value];
 for (const workout of workouts) workoutCard(history, workout, credit?.source === 'watch');
 if (!workouts.length) node(history, 'li', 'No workouts logged on this day.', 'hint');
 renderTiles();
 renderProgress();
 renderAgain();
 window.dispatchEvent(new Event('workouts-rendered'));
}

day.addEventListener('change', () => { reset(); status.textContent = ''; render(); });
for (const event of ['tracker-synced', 'settings-saved']) window.addEventListener(event, render);
render();
