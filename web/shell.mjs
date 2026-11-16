// App shell: tab switching, the shared date (day strip and picker), header labels and the snap button.
import {localToday as localDate, displayName} from './store.mjs';
const el = id => document.getElementById(id);
const SCREENS = ['today', 'log', 'workouts', 'analytics', 'settings'];
const day = el('day');

const asDate = date => new Date(date + 'T12:00:00');
const shift = (date, n) => { const d = asDate(date); d.setDate(d.getDate() + n); return localDate(d); };

function show(name) {
 const screen = SCREENS.includes(name) ? name : 'today';
 for (const s of SCREENS) el('screen-' + s).hidden = s !== screen;
 for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === screen));
 el('topbar').dataset.screen = screen;
 history.replaceState(null, '', screen === 'today' ? location.pathname : '#' + screen);
 window.scrollTo({top: 0});
 window.dispatchEvent(new CustomEvent('screen-shown', {detail: screen}));
}

const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'; };

let firstName = '';
const AVATARS = {male: '/img/avatar-man.webp', female: '/img/avatar-woman.webp'};

// The avatar shows the person's illustration once their body is set in About you, else their initial.
function renderAvatars() {
 let sex = '';
 try { sex = JSON.parse(localStorage.getItem('daily-check-in-settings-v1') || '{}').profile?.sex || ''; } catch {}
 for (const avatar of document.querySelectorAll('.avatar')) {
  if (AVATARS[sex]) {
   const img = document.createElement('img');
   img.src = AVATARS[sex]; img.alt = ''; img.className = 'avatar__img';
   avatar.replaceChildren(img);
  } else avatar.textContent = (firstName[0] || '·').toUpperCase();
 }
}
const STRIP_DAYS = 14;

// The last two weeks as tappable day pills, ending today, with the selected day highlighted.
function renderStrip() {
 const strip = el('date-strip');
 const hadFocus = strip.contains(document.activeElement);
 const today = localDate();
 const dates = Array.from({length: STRIP_DAYS}, (_, i) => shift(today, i - STRIP_DAYS + 1));
 if (!dates.includes(day.value)) dates.unshift(day.value);
 strip.replaceChildren(...dates.map(date => {
  const d = asDate(date);
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'date-chip';
  chip.setAttribute('aria-pressed', String(date === day.value));
  chip.setAttribute('aria-label', date === today ? 'Today' : d.toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric'}));
  const number = document.createElement('strong'); number.textContent = String(d.getDate());
  const weekday = document.createElement('small'); weekday.textContent = date === today ? 'Today' : d.toLocaleDateString('en-US', {weekday: 'short'});
  chip.append(number, weekday);
  chip.onclick = () => setDate(date);
  const item = document.createElement('li'); item.append(chip);
  return item;
 }));
 // Rebuilding the chips drops keyboard focus; put it back on the chosen day.
 if (hadFocus) strip.querySelector('[aria-pressed="true"]')?.focus({preventScroll: true});
 centerSelectedDay();
}

// Scroll the strip itself (not the page) so the selected day sits in view.
function centerSelectedDay() {
 const strip = el('date-strip');
 const selected = strip.querySelector('[aria-pressed="true"]');
 if (selected) strip.scrollLeft = selected.offsetLeft - strip.clientWidth / 2 + selected.clientWidth / 2;
}

function renderLabels() {
 const date = day.value;
 const today = localDate();
 el('greeting').textContent = 'Hi' + (firstName ? ' ' + firstName : '') + ' 👋';
 el('greeting-sub').textContent = date === today ? greeting() + '. Here’s your day so far.' : 'Looking back at ' + asDate(date).toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric'});
 renderStrip();
}

function setDate(date) {
 if (!date || date > localDate()) return;
 day.value = date;
 day.dispatchEvent(new Event('change'));
}

// The sticky top bar slims down once the page has scrolled.
const topbar = el('topbar');
// The day pills change size with it, so keep the selected day in view when it does.
// Separate thresholds stop it flickering on pages that are only just taller than the screen.
const COMPACT_AT = 24, EXPAND_AT = 4;
const compact = () => {
 const was = topbar.classList.contains('is-compact');
 const now = was ? window.scrollY > EXPAND_AT : window.scrollY > COMPACT_AT;
 if (now !== was) { topbar.classList.toggle('is-compact', now); barHeight(); requestAnimationFrame(centerSelectedDay); }
};
window.addEventListener('scroll', compact, {passive: true});
// Anchored scrolls (Edit jumps to the form) stop below the bar instead of under it.
const barHeight = () => document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');
new ResizeObserver(barHeight).observe(topbar);
barHeight();

document.addEventListener('click', event => {
 const target = event.target.closest('[data-tab],[data-go]');
 if (target) show(target.dataset.tab || target.dataset.go);
});
day.addEventListener('change', renderLabels);
// The camera button jumps to the food log and opens the photo picker in the same tap.
el('fab-snap').onclick = () => { show('log'); el('snap-meal').click(); };

// sync.js may confirm the account before this module loads, so read what it already knows too.
function setUser(value) {
 const email = String(value || '');
 firstName = displayName(email);
 renderAvatars();
 renderLabels();
}
window.addEventListener('tracker-user', event => setUser(event.detail));
if (window.trackerUser) setUser(window.trackerUser);

for (const event of ['tracker-synced', 'settings-saved']) window.addEventListener(event, renderAvatars);
// A home-screen app can resume the next morning with yesterday still selected. When the date
// rolls over, move the picker forward if it was on the old today, so entries land on the right day.
let knownToday = localDate();
function rollOver() {
 const today = localDate();
 if (today === knownToday) return;
 const wasToday = day.value === knownToday;
 knownToday = today;
 day.max = today;
 if (wasToday) setDate(today); else renderLabels();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) rollOver(); });
window.addEventListener('pageshow', rollOver);
window.addEventListener('focus', rollOver);

day.max = localDate();
day.value = localDate();
renderLabels();
renderAvatars();
show(location.hash.slice(1));
