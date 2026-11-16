// The week is the budget; a day is a share of it.
//
// Seven days of the daily allowance make the week's total, and that total never moves: the
// weekday/weekend shape and the day types only decide how it is split. A day you know will be big
// is paid for by the days that have not happened yet, and so is a day that got away from you.
// Nothing crosses Sunday — a thin Sunday is the week telling you something, and Monday starts clean.
import {allowanceOn, weekDates} from './energy.mjs';

const WEEK = 7, WEEKDAYS = 5, WEEKEND = 2;

// What each kind of day does to its share. These keys are the Day type menu in index.html, down to
// the curly apostrophe in Mom’s, because the menu's own text is what gets stored on the day.
// test/budget.test.mjs reads the menu out of the HTML and checks the two never drift apart.
export const KINDS = {
 'Workday': 'none',
 'Other': 'none',
 'Light day': 'light',
 'Mom’s': 'event',
 'Family event': 'event',
 'Workday + event': 'event',
 'Travel': 'event',
 'Travel + event': 'event',
};

// `cap` is the most a day may be, exercise included, 0 meaning no cap. It exists because the
// giveback is loudest exactly when you have done best: a disciplined week with one day left puts
// the whole surplus on that day, which turns a good week into an average one.
export const DEFAULTS = {weekend: 0, event: 500, light: -300, cap: 0};
// A light day can never add calories and an event day can never take them away, whatever is
// stored: these come from settings that sync between devices, so they are read as input, not truth.
export const LIMITS = {weekend: [0, 1000], event: [0, 2000], light: [-1500, 0], cap: [0, 6000]};

// Only an actual number counts. null, '' and false all survive Number() as 0, which would quietly
// turn a half-written setting into "events are worth nothing" instead of falling back to the default.
const clamp = (value, [min, max], fallback) =>
 typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;

export const budgetOf = settings => Object.fromEntries(Object.entries(DEFAULTS)
 .map(([key, fallback]) => [key, clamp(settings?.dayBudget?.[key], LIMITS[key], fallback)]));

export const offsetFor = (kind, budget) => {
 const effect = KINDS[kind];
 return effect === 'event' ? budget.event : effect === 'light' ? budget.light : 0;
};

// The weekend boost is taken off the five weekdays, so seven shares still add up to seven days.
// `daily` is one number, or one per day when the allowance changed during the week.
export function baseShares(daily, weekend = 0) {
 const dailies = Array.isArray(daily) ? daily : Array(WEEK).fill(daily);
 // A boost larger than the weekdays can give would hand them a negative allowance, which is not a
 // hard day but a broken one.
 const room = Math.min(...dailies.slice(0, WEEKDAYS)) * WEEKDAYS / WEEKEND;
 const boost = Math.max(0, Math.min(weekend, room));
 return dailies.map((value, i) => i < WEEKDAYS ? value - boost * WEEKEND / WEEKDAYS : value + boost);
}

// Every day is worked out as of itself: what was actually eaten before it, what the days still
// ahead of it have already been promised, and a share of whatever is left, in proportion to how big
// those days are meant to be. That makes a day's number the same whenever it is asked for, so
// looking back at a week never rewrites it.
//
// `targets` is the dated allowance history, so a week spanning a change is planned at each day's
// own allowance rather than at the one in force on the day you happen to be looking. `credits` is
// exercise eaten back: those calories are earned on the day and are not drawn from the week, so
// they are taken off before a day is charged to the budget.
export function weekPlan({daily = null, targets = null, settings = {}, date, today = date, eaten = {}, credits = {}, kinds = {}}) {
 const dates = weekDates(date);
 const dailies = dates.map(day => Number(allowanceOn(targets, day) ?? daily));
 if (!dailies.every(value => Number.isFinite(value) && value > 0)) return null;

 const budget = budgetOf(settings);
 const base = baseShares(dailies, budget.weekend);
 const own = dates.map(day => offsetFor(kinds[day], budget));
 const weekly = dailies.reduce((sum, value) => sum + value, 0);

 // Filled in order, so a day that was never logged can stand on the share it had rather than on its
 // plain base, which would hand the rest of the week calories that were already spoken for.
 const settled = [];
 const charged = i => {
  const logged = eaten[dates[i]];
  if (logged === undefined) return settled[i];
  const net = Math.max(0, logged - (Number(credits[dates[i]]) || 0));
  // Today is still being eaten. Charging the week only what has been logged so far would make
  // every later day look roomier at breakfast than it does at dinner, so today stands on its
  // share until it exceeds it.
  return dates[i] === today ? Math.max(net, settled[i]) : net;
 };

 // What the week may give a day, whatever it has to spare. Exercise is added to this later, and
 // capDay clips the total, so the week is capped here and the final number is capped there.
 const ceiling = budget.cap > 0 ? budget.cap : Infinity;
 const hold = value => Math.min(ceiling, Math.max(0, value));

 const shareAt = i => {
  if (own[i] !== 0) return {allowance: hold(base[i] + own[i]), wanted: Math.max(0, base[i] + own[i]), drift: 0};
  let spent = 0, promised = 0, weight = 0, drift = 0;
  for (let j = 0; j < WEEK; j++) {
   // A day held back by the cap costs the week only what it was allowed, so whatever the cap
   // withheld is still there for the days after it, and simply stands unspent if they cap too.
   if (j < i) { const cost = charged(j); spent += cost; drift += cost - settled[j]; }
   else if (own[j] !== 0) promised += hold(base[j] + own[j]);
   else weight += Math.max(0, base[j]);
  }
  const left = weekly - spent - promised;
  const wanted = weight > 0 ? Math.max(0, left) * Math.max(0, base[i]) / weight : 0;
  return {allowance: hold(wanted), wanted, drift};
 };

 const days = dates.map((day, i) => {
  const {allowance, wanted, drift} = shareAt(i);
  settled[i] = allowance;
  return {
   date: day, kind: typeof kinds[day] === 'string' ? kinds[day] : '',
   base: Math.round(base[i]), own: own[i], allowance: Math.round(allowance),
   // Whether the cap, rather than the week, decided this number.
   capped: wanted - allowance >= 1,
   // How far the days before this one ran past their own shares. Nothing to do with the day's
   // number — it is there so the day can say which of the two reasons made it smaller.
   drift: Math.round(drift),
  };
 });
 return {
  week: dates[0], weekly: Math.round(weekly), budget, days,
  // The days still to come that the rest of the week is paying for, in the order they arrive.
  ahead: days.filter(day => day.own !== 0 && day.date >= date).map(({date: on, kind, own: offset}) => ({date: on, kind, own: offset})),
 };
}

// The cap is the most you may eat in a day, full stop — not the most the week may hand you. It is
// applied last, after exercise has been added, so a 2,700 cap and a 600 kcal session is still 2,700.
// Every screen that shows a day's number goes through here, so Today and Analytics cannot disagree.
// A null allowance means no allowance is set at all, and that is not a number to clip.
export const capDay = (allowance, budget) =>
 budget?.cap > 0 && typeof allowance === 'number' && Number.isFinite(allowance)
  ? Math.min(budget.cap, allowance)
  : allowance;

const NEAR = 25;
const dayName = date => new Date(date + 'T12:00:00').toLocaleDateString('en-US', {weekday: 'long'});
const list = names => names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0];

// One line saying why today is not the usual number. Silence when it is, because a line that
// appears every day stops being read.
export function shareNote(plan, date, earned = 0) {
 const day = plan?.days.find(entry => entry.date === date);
 if (!day) return '';
 // Only claim the week covers it when there is some week left to do the covering: on a Sunday
 // there is nothing after it, and saying otherwise would be a small lie about a real number.
 const after = plan.days.some(entry => entry.date > date && entry.own === 0);
 if (day.own > 0) return 'Up ' + day.own + ' for ' + day.kind.toLowerCase() + '.' + (after ? ' The rest of the week covers it.' : '');
 if (day.own < 0) return day.kind + ': ' + -day.own + ' under your usual, and the week gets it back.';

 const diff = day.allowance - day.base;
 // The cap, not the week, decided this one. Saying "the week has room" would be true and useless:
 // what the day needs to say is that the room is there and is not being handed over.
 // Two ways to hit the cap, and they are not the same news. The week can run into it, or the
 // week can leave room and the day's exercise run into it — in which case there is nothing spare
 // to talk about, only a session that does not buy anything.
 const cap = plan.budget?.cap > 0 ? plan.budget.cap : null;
 const clipped = cap !== null && day.allowance + (Number(earned) || 0) > cap;
 if (day.capped) return cap + ' is your most in a day, exercise included. The week has more to spare, and it stays spare.';
 if (clipped) return cap + ' is your most in a day, so today\u2019s session does not add to it.';
 if (Math.abs(diff) < NEAR) return '';
 if (diff > 0) return diff + ' more than usual — the week has room.';
 // A smaller day has two possible causes and they often arrive together. Naming only the event
 // when the real reason is an overspent Monday puts the blame in the wrong place.
 const ahead = plan.ahead.filter(entry => entry.date > date && entry.own > 0);
 const towards = ahead.length ? ' towards ' + list(ahead.map(entry => dayName(entry.date))) : '';
 if (day.drift >= NEAR) return -diff + ' lighter today: the week is ' + day.drift + ' over so far' + (towards ? ', and there is ' + list(ahead.map(entry => dayName(entry.date))) + ' to come' : '') + '.';
 return ahead.length ? -diff + ' lighter today, putting it' + towards + '.' : -diff + ' lighter today: the week is running ahead of its budget.';
}
