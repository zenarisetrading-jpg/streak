// Daily check-in for the selected date: weight, day type and a note.
// Older entries may also hold walk/lift fields; saving keeps them. Weight is stored in lb and shown
// in the person's unit (units.mjs).
import {unitOf, inputValue, parseWeight, weightRange} from './units.mjs';
import {saveDay} from './store.mjs';
const el = id => document.getElementById(id);
const key = 'daily-check-in-v1';
const FIELDS = ['kind', 'weight', 'note'];
const settingsKey = 'daily-check-in-settings-v1';
const form = el('form'), day = el('day'), status = el('status');
let dirty = false;
// What the fields held when the form was last filled, so an untouched field is never written back.
let loaded = {};

const read = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
const unit = () => { try { return unitOf(JSON.parse(localStorage.getItem(settingsKey) || '{}')); } catch { return 'lb'; } };

function load() {
 const entry = read()[day.value] || {};
 const u = unit(), {min, max} = weightRange(u);
 el('weight-unit-label').textContent = u;
 Object.assign(el('weight'), {min, max});
 for (const field of FIELDS) el(field).value = field === 'weight' ? inputValue(entry.weight, u) : entry[field] || '';
 loaded = Object.fromEntries(FIELDS.map(field => [field, el(field).value]));
 dirty = false;
}

form.addEventListener('input', () => { dirty = true; });
form.addEventListener('submit', event => {
 event.preventDefault();
 const fields = Object.fromEntries(FIELDS.map(field => [field, el(field).value.trim()]));
 if (!Object.values(fields).some(Boolean)) { status.textContent = 'Add at least one detail.'; return; }
 const u = unit(), {min, max} = weightRange(u);
 const weight = fields.weight ? parseWeight(fields.weight, u) : null;
 if (fields.weight && weight === null) { status.textContent = 'Enter a weight between ' + min + ' and ' + max + ' ' + u + '.'; return; }
 try {
  const saved = read()[day.value]?.weight;
  // An untouched weight keeps its stored value rather than a rounded round trip through kg.
  fields.weight = !fields.weight ? '' : fields.weight === inputValue(saved, u) ? saved : String(weight);
  // Only what the person actually edited. Anything else on the day — the check-in answers, and
  // a weight or day type the prompt saved while this form sat open — is left alone.
  const patch = Object.fromEntries(FIELDS
   .filter(field => el(field).value !== loaded[field])
   .map(field => [field, fields[field]]));
  if (!Object.keys(patch).length) { status.textContent = 'Nothing new to save.'; return; }
  saveDay(day.value, patch);
  loaded = Object.fromEntries(FIELDS.map(field => [field, el(field).value]));
  dirty = false;
  status.textContent = 'Saved for ' + new Date(day.value + 'T12:00:00').toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) + '.';
 } catch { status.textContent = 'Could not save. Check that browser storage is enabled.'; }
});
day.addEventListener('change', () => { status.textContent = ''; load(); });
for (const event of ['tracker-synced', 'settings-saved', 'checkin-saved']) window.addEventListener(event, () => { if (!dirty && !form.contains(document.activeElement)) load(); });
load();
