// Shared helpers for the view modules: the synced local caches, exercise credits,
// number formatting and a small element builder (text always goes in as text, never HTML).
import {exerciseCredit, activeBaseline, watchFinal} from './energy.mjs';
import {unitOf, weightChange} from './units.mjs';

export const KEYS = {days: 'daily-check-in-v1', meals: 'daily-check-in-meals-v1', settings: 'daily-check-in-settings-v1', health: 'daily-check-in-health-v1', workouts: 'daily-check-in-workouts-v1'};
const SHARES = [1, 0.75, 0.5, 0];

export const read = key => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
// A first name to greet by. Cloudflare Access only ever tells the app an email address, so the
// name is read out of it: "sam.taylor@example.com" becomes "Sam". It is a greeting, not an
// identity — anything that cannot be made sense of is shown as it was typed rather than guessed at.
export const displayName = value => {
 const local = String(value || '').split('@')[0];
 const first = local.split(/[._+-]/).filter(Boolean)[0] || local;
 return first ? first[0].toUpperCase() + first.slice(1) : '';
};
export const localToday = (d = new Date()) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
export const selectedDate = () => document.getElementById('day').value || localToday();
export const shareOf = settings => SHARES.includes(settings?.exerciseShare) ? settings.exerciseShare : 1;
export const targetsOf = settings => settings?.calorieTargets || [];


// Exercise calories earned per date: the Watch's number when it has one, else logged workouts.
export function creditsByDate(share = shareOf(read(KEYS.settings))) {
 const health = read(KEYS.health), workouts = read(KEYS.workouts);
 const dates = new Set([...Object.keys(health), ...Object.keys(workouts)]);
 return Object.fromEntries([...dates].map(date => [date, exerciseCredit(health[date], workouts[date], share, activeBaseline(health, date), watchFinal(date, health[date]))]));
}
// Saves settings fields and stamps each with the time it changed; the server keeps the newer
// value per field, so edits from two devices do not undo each other. null clears a field.
export function saveSettings(patch) {
 const current = read(KEYS.settings);
 const now = Date.now();
 const next = {...current, ...patch, _at: {...(current._at || {}), ...Object.fromEntries(Object.keys(patch).map(field => [field, now]))}};
 localStorage.setItem(KEYS.settings, JSON.stringify(next));
 window.trackerWrite('settings:profile', next);
 window.dispatchEvent(new Event('settings-saved'));
 return next;
}

// The one place a day's record is written. Every screen that edits part of a day (the weight
// form, the check-in taps, the prompt at the top of Today) merges its own fields in here, so no
// screen can wipe another's. Throws if storage is full; callers show their own message.
export function saveDay(date, patch) {
 const days = read(KEYS.days);
 const entry = {...(days[date] || {}), ...patch};
 localStorage.setItem(KEYS.days, JSON.stringify({...days, [date]: entry}));
 window.trackerWrite('day:' + date, entry);
 window.dispatchEvent(new Event('checkin-saved'));
 return entry;
}

export const latestWeight = () => Number(Object.entries(read(KEYS.days)).filter(([, d]) => Number(d?.weight) > 0).sort(([a], [b]) => b.localeCompare(a))[0]?.[1].weight) || null;
export const kcalOnly = credits => Object.fromEntries(Object.entries(credits).map(([date, c]) => [date, c.kcal]));

// Paints the filled part of a range track. Chrome stops honouring accent-color as soon as the
// track itself is styled, so how far along the slider is has to be set as a percentage.
export function rangeFill(input) {
 const min = Number(input.min || 0), max = Number(input.max || 100), value = Number(input.value);
 input.style.setProperty('--fill', (max > min ? ((value - min) / (max - min)) * 100 : 0) + '%');
}

export const fmt = n => Math.round(n).toLocaleString('en-US');
export const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
// The signed-in person's weight unit, and a weight change (given in lb) shown in it.
export const weightUnit = () => unitOf(read(KEYS.settings));
export const weightDelta = lbs => weightChange(lbs, weightUnit());
export const shortDate = date => new Date(date + 'T12:00:00').toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
export const hoursMinutes = hours => { const m = Math.round(hours * 60); return [Math.floor(m / 60), m % 60]; };

// h('p', {class: 'eyebrow'}, 'Text', child, …). Strings become text nodes; null/false are skipped.
export function h(tag, attrs = {}, ...children) {
 const svg = ['svg', 'circle', 'use'].includes(tag);
 const node = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
 for (const [k, v] of Object.entries(attrs || {})) {
  if (v === null || v === undefined || v === false) continue;
  if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
  else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
  else node.setAttribute(k, v === true ? '' : v);
 }
 for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
 return node;
}

export const icon = (name, attrs = {}) => h('svg', attrs, h('use', {href: '#i-' + name}));
export const unit = text => h('span', {class: 'stat__unit'}, text);

// Ring from the design system: --p is 0–100.
export function ring(percent, {cls = '', label = []} = {}) {
 const svg = h('svg', {class: 'ring ' + cls, viewBox: '0 0 120 120', style: {'--p': String(Math.max(0, Math.min(100, Math.round(percent))))}, 'aria-hidden': 'true'},
  h('circle', {class: 'ring__track', cx: 60, cy: 60, r: 52}), h('circle', {class: 'ring__fill', cx: 60, cy: 60, r: 52, pathLength: 100}));
 return h('div', {class: 'ring-wrap'}, svg, h('div', {class: 'ring__label'}, ...label));
}

// Delta pill; good decides the colour, the arrow always carries the direction.
export function delta(diff, text, {lowerIsBetter = false} = {}) {
 if (diff === null || diff === undefined) return null;
 const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
 const good = diff === 0 ? null : (diff < 0) === lowerIsBetter;
 return h('span', {class: 'delta' + (good === null ? '' : good ? ' delta--good' : ' delta--bad')}, arrow + ' ' + text);
}

const STATUS_TEXT = {under: 'Under', on: 'On target', over: 'Over'};

// A macro amount against its daily target: the fill shows the amount, the dark tick marks the target,
// and the line under it says under, on target or over (highlighted when it is the direction to watch).
// status comes from macroStatus() in profile.mjs.
export function macroBar(label, actual, target, cls, status, {compact = false, inProgress = false} = {}) {
 const top = Math.max(actual, target || 0) * 1.15 || 1;
 const amount = Math.round(actual) + (target ? ' / ' + target : '') + ' g';
 const gap = target ? Math.abs(Math.round(actual - target)) : 0;
 // While the day is still going, falling short just means there is room left, not a miss.
 const toGo = inProgress && status?.level === 'under';
 const note = status && (status.level === 'on' ? 'On target' : toGo ? gap + ' g to go' : STATUS_TEXT[status.level] + ' by ' + gap + ' g');
 const meter = h('div', {class: 'meter macro__meter ' + cls, style: {'--p': String(Math.round(actual / top * 100))}, role: 'img', 'aria-label': label + ' ' + amount + (note ? ', ' + note.toLowerCase() : '')},
  h('span'), target ? h('i', {class: 'macro__mark', style: {'--m': String(Math.round(target / top * 100))}}) : null);
 const status_ = note ? h('p', {class: 'macro__status' + (status.concern && !toGo ? ' is-concern' : status.level === 'on' ? ' is-on' : '')}, note) : null;
 return compact
  ? h('div', {class: 'macro'}, h('p', {class: 'eyebrow'}, label), h('strong', {class: 'num'}, amount), meter, status_)
  : h('div', {class: 'macro'}, h('div', {class: 'row-between'}, h('span', {class: 'label'}, label), h('span', {class: 'num hint'}, amount)), meter, status_);
}
