// Editable list of meal items: name, portion, weight and macros, with live calories.
// Changing a food's weight (or the grams in its portion text) rescales its macros.
import {energy, totals} from './nutrition.mjs';
import {itemGrams, gramsIn, rescale} from './portion.mjs';

const FIELDS = [['protein', 'Protein g'], ['carbs', 'Carbs g'], ['fat', 'Fat g']];
const kcal = item => Math.round(energy(item)) + ' kcal';

function input(parent, label, value, attrs, onInput, onCommit = null) {
 const wrap = document.createElement('label');
 wrap.className = 'field';
 const text = document.createElement('span');
 text.className = 'label';
 text.textContent = label;
 const field = document.createElement('input');
 field.className = 'input' + (attrs.type === 'number' ? ' num' : '');
 Object.assign(field, attrs, {value: value ?? ''});
 field.addEventListener('input', () => onInput(field.value));
 if (onCommit) field.addEventListener('change', () => onCommit(field.value));
 wrap.append(text, field);
 parent.append(wrap);
 return field;
}

const toNumber = value => {
 const n = Number(value);
 return Number.isFinite(n) && n >= 0 ? n : 0;
};

const blankItem = () => ({name: '', assumption: '', protein: 0, carbs: 0, fat: 0});

// Items worth saving: named, with sane non-negative macros. Drops editor-only fields.
export const cleanItems = items => items
 .map(item => {
  const grams = itemGrams(item);
  return {name: String(item.name).trim(), assumption: String(item.assumption).trim(), ...(grams > 0 ? {grams} : {}), protein: toNumber(item.protein), carbs: toNumber(item.carbs), fat: toNumber(item.fat)};
 })
 .filter(item => item.name);

export function renderEditor(container, items, onChange) {
 container.replaceChildren();
 const list = document.createElement('ul');
 list.className = 'list';
 container.append(list);
 const total = document.createElement('p');
 total.className = 'editor-total';
 const showTotal = current => { total.textContent = 'Meal estimate · ' + kcal(totals(cleanItems(current))); };

 items.forEach((item, index) => {
  const card = document.createElement('li');
  card.className = 'edit-item' + (item.extra ? ' extra' : '');
  const update = patch => {
   const next = items.map((existing, i) => i === index ? {...existing, ...patch} : existing);
   items = next;
   calories.textContent = kcal(cleanItems([next[index]])[0] || blankItem());
   showTotal(next);
   onChange(next);
  };
  const head = document.createElement('div');
  head.className = 'edit-head';
  input(head, 'Food', item.name, {type: 'text', maxLength: 80}, name => update({name}));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.className = 'btn btn--ghost';
  remove.setAttribute('aria-label', 'Remove ' + (item.name || 'item'));
  remove.onclick = () => { const next = items.filter((_, i) => i !== index); onChange(next); renderEditor(container, next, onChange); };
  head.append(remove);
  card.append(head);
  // A new weight, typed in the weight box or into the portion text, rescales this food's macros.
  // The change fires as focus leaves the box, so wait for focus to land, re-render, then put it back.
  const resize = grams => {
   const next = items.map((existing, i) => i === index ? rescale(existing, grams) : existing);
   onChange(next);
   setTimeout(() => {
    const fields = () => [...container.querySelectorAll('input, button, select, textarea')];
    const at = fields().indexOf(document.activeElement);
    renderEditor(container, next, onChange);
    if (at >= 0) fields()[at]?.focus({preventScroll: true});
   });
  };
  input(card, 'Portion', item.assumption, {type: 'text', maxLength: 140}, assumption => update({assumption}), text => {
   const grams = gramsIn(text);
   if (grams > 0 && grams !== itemGrams(item)) resize(grams);
  });
  const macros = document.createElement('div');
  macros.className = 'input-row input-row--4';
  const grams = itemGrams(item);
  input(macros, 'Weight g', grams > 0 ? String(Math.round(grams)) : '', {type: 'number', inputMode: 'decimal', min: '0', step: '1', placeholder: '—'}, () => {}, value => { if (toNumber(value) > 0) resize(toNumber(value)); });
  for (const [field, label] of FIELDS) input(macros, label, String(Math.round(item[field] * 10) / 10), {type: 'number', inputMode: 'decimal', min: '0', step: '0.1'}, value => update({[field]: toNumber(value)}));
  card.append(macros);
  const meta = document.createElement('p');
  meta.className = 'hint';
  const calories = document.createElement('strong');
  calories.textContent = kcal(item);
  meta.append(calories);
  if (item.extra) meta.append(' · likely hidden extra, remove if not used');
  if (item.confidence === 'low') meta.append(' · low confidence, please check');
  card.append(meta);
  list.append(card);
 });

 const add = document.createElement('button');
 add.type = 'button';
 add.textContent = '+ Add item';
 add.className = 'btn btn--secondary';
 add.style.marginTop = 'var(--space-3)';
 add.onclick = () => { const next = [...items, blankItem()]; onChange(next); renderEditor(container, next, onChange); container.querySelector('ul > li:last-child input')?.focus(); };
 container.append(add);
 container.append(total);
 showTotal(items);
}
