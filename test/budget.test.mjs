import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {baseShares, budgetOf, offsetFor, weekPlan, shareNote, capDay, KINDS, DEFAULTS, LIMITS} from '../web/budget.mjs';

// Monday 2026-11-09 … Sunday 2026-11-15.
const MON = '2026-11-09', TUE = '2026-11-10', WED = '2026-11-11', THU = '2026-11-12';
const FRI = '2026-11-13', SAT = '2026-11-14', SUN = '2026-11-15';
const DAILY = 2000;
const plan = (over = {}) => weekPlan({daily: DAILY, date: WED, ...over});
const on = (result, date) => result.days.find(day => day.date === date);

test('the weekend shape moves calories without changing the week', () => {
 const shares = baseShares(DAILY, 350);
 assert.equal(shares.length, 7);
 assert.equal(shares[0], 1860, 'a weekday gives up two fifths of the boost');
 assert.equal(shares[5], 2350);
 assert.equal(shares[6], 2350);
 assert.equal(shares.reduce((a, b) => a + b, 0), DAILY * 7, 'the week still adds up');
});

test('no boost leaves every day the same', () => {
 assert.deepEqual(baseShares(DAILY), Array(7).fill(DAILY));
});

test('a day type is worth what Settings says it is', () => {
 const budget = {weekend: 0, event: 600, light: -300};
 assert.equal(offsetFor('Family event', budget), 600);
 assert.equal(offsetFor('Travel + event', budget), 600);
 assert.equal(offsetFor('Light day', budget), -300);
 assert.equal(offsetFor('Workday', budget), 0);
 assert.equal(offsetFor('', budget), 0, 'an unanswered day is an ordinary one');
 assert.equal(offsetFor('Something else entirely', budget), 0);
});

test('settings are read defensively', () => {
 assert.deepEqual(budgetOf({}), DEFAULTS);
 assert.deepEqual(budgetOf(null), DEFAULTS);
 assert.equal(budgetOf({dayBudget: {event: 99999}}).event, LIMITS.event[1], 'clamped, not trusted');
 assert.equal(budgetOf({dayBudget: {light: 400}}).light, 0, 'a light day can never add calories');
 assert.equal(budgetOf({dayBudget: {weekend: 'lots'}}).weekend, DEFAULTS.weekend);
});

// The heart of it: a known event is paid for by the days that have not happened yet.
test('an event ahead of you lightens the days in between', () => {
 const result = plan({kinds: {[SAT]: 'Family event'}, eaten: {[MON]: DAILY, [TUE]: DAILY}});
 assert.equal(on(result, SAT).allowance, DAILY + DEFAULTS.event, 'the event day gets what it was promised');
 // Wednesday, Thursday, Friday and Sunday share the cost: 500 over four days.
 assert.equal(on(result, WED).allowance, DAILY - 125);
 assert.equal(on(result, SUN).allowance, DAILY - 125);
});

test('the later you declare it, the fewer days there are to take it from', () => {
 const kinds = {[SAT]: 'Family event'};
 const spine = {[MON]: DAILY, [TUE]: DAILY, [SAT]: DAILY + DEFAULTS.event};
 // Declared on Wednesday: Wednesday to Friday each ate their lightened share.
 const early = weekPlan({daily: DAILY, date: SUN, kinds, eaten: {...spine, [WED]: 1875, [THU]: 1875, [FRI]: 1875}});
 // Declared on Friday: Wednesday and Thursday had already eaten a full day by then.
 const late = weekPlan({daily: DAILY, date: SUN, kinds, eaten: {...spine, [WED]: DAILY, [THU]: DAILY, [FRI]: 1750}});
 assert.equal(on(early, SUN).allowance, 1875);
 assert.equal(on(late, SUN).allowance, 1750, 'Sunday carries what the earlier days did not');
});

test('a light day hands its calories back to the rest of the week', () => {
 const result = plan({kinds: {[FRI]: 'Light day'}});
 assert.equal(on(result, FRI).allowance, DAILY + DEFAULTS.light);
 assert.ok(on(result, WED).allowance > DAILY, 'the others are a little easier');
});

// He asked for exactly this: a week that got away from you leaves a thin Sunday, and Monday starts clean.
test('going over tightens the days that are left, and never the next week', () => {
 const result = plan({eaten: {[MON]: DAILY + 1400, [TUE]: DAILY}});
 assert.equal(on(result, WED).allowance, DAILY - 280, '1400 spread over the five days left');
 assert.equal(on(result, SUN).allowance, DAILY - 280);
 const next = weekPlan({daily: DAILY, date: '2026-11-16', eaten: {[MON]: DAILY + 1400, [TUE]: DAILY}});
 assert.equal(on(next, '2026-11-16').allowance, DAILY, 'Monday is a fresh start');
});

test('a day nobody logged is read as an ordinary day, not as fasting', () => {
 const result = plan({eaten: {[MON]: DAILY}});
 assert.equal(on(result, WED).allowance, DAILY, 'an empty Tuesday is not a windfall');
});

test('a week spent to nothing stops at zero rather than going negative', () => {
 const result = plan({eaten: {[MON]: DAILY * 7, [TUE]: DAILY}});
 assert.equal(on(result, WED).allowance, 0);
 assert.ok(on(result, WED).drift > 0, 'and says how far past the week already is');
});

test('each day is judged as of itself, so history does not move', () => {
 const kinds = {[SAT]: 'Family event'};
 const eaten = {[MON]: DAILY + 600, [TUE]: DAILY};
 const asWed = on(weekPlan({daily: DAILY, date: WED, kinds, eaten}), WED).allowance;
 const asSun = on(weekPlan({daily: DAILY, date: SUN, kinds, eaten}), WED).allowance;
 assert.equal(asWed, asSun, "Wednesday's number is the same whenever you look at it");
});

test('the shape and the day types work together', () => {
 const result = plan({settings: {dayBudget: {weekend: 350, event: 500, light: -300}}, kinds: {[SAT]: 'Family event'}});
 assert.equal(on(result, SAT).allowance, 2350 + 500);
 assert.ok(on(result, SUN).allowance > on(result, WED).allowance, 'Sunday is still the bigger day');
});

test('no allowance set means no plan to make', () => {
 assert.equal(weekPlan({daily: null, date: WED}), null);
 assert.equal(weekPlan({daily: 0, date: WED}), null);
});

test('every day says what moved it', () => {
 const result = plan({kinds: {[SAT]: 'Family event'}});
 assert.equal(on(result, SAT).kind, 'Family event');
 assert.equal(on(result, SAT).own, DEFAULTS.event);
 assert.equal(on(result, WED).own, 0);
 assert.equal(on(result, WED).base, DAILY);
 assert.equal(result.weekly, DAILY * 7);
 assert.deepEqual(result.ahead, [{date: SAT, kind: 'Family event', own: DEFAULTS.event}], 'what the rest of the week is paying for');
});

test('the kinds that carry a number are the ones the form offers', () => {
 for (const kind of Object.keys(KINDS)) assert.ok(['none', 'event', 'light'].includes(KINDS[kind]), kind);
});

test('the day explains itself only when there is something to explain', () => {
 const plain = plan({eaten: {[MON]: DAILY, [TUE]: DAILY}});
 assert.equal(shareNote(plain, WED), '', 'an ordinary day says nothing');
 assert.equal(shareNote(null, WED), '');
 assert.equal(shareNote(plain, '2026-12-25'), '', 'a day outside the week');
});

test('the day says what it is paying for, and what it is owed', () => {
 const ahead = plan({kinds: {[SAT]: 'Family event'}, eaten: {[MON]: 1917, [TUE]: 1917}});
 assert.equal(shareNote(ahead, WED), '83 lighter today, putting it towards Saturday.');
 assert.match(shareNote(ahead, SAT), /^Up 500 for family event\./);
 assert.match(shareNote(plan({kinds: {[WED]: 'Light day'}}), WED), /^Light day: 300 under/);
 assert.match(shareNote(plan({eaten: {[MON]: DAILY + 1400, [TUE]: DAILY}}), WED), /^280 lighter today: the week is \d+ over so far\.$/);
 assert.match(shareNote(plan({kinds: {[FRI]: 'Light day'}}), WED), /more than usual/);
});

test('two events ahead are both named', () => {
 const two = plan({kinds: {[FRI]: 'Travel', [SAT]: 'Family event'}, eaten: {[MON]: 1800, [TUE]: 1800}});
 assert.match(shareNote(two, WED), /towards Friday and Saturday\.$/);
});

// The bug this guards: on a Sunday there is no rest of the week, so promising that it covers
// the event was a small lie about a number the day is judged on.
test('an event on the last day of the week does not claim the week covers it', () => {
 const sunday = weekPlan({daily: DAILY, date: SUN, kinds: {[SUN]: 'Family event'}});
 assert.equal(shareNote(sunday, SUN), 'Up 500 for family event.');
 const saturday = weekPlan({daily: DAILY, date: SAT, kinds: {[SAT]: 'Family event'}});
 assert.match(shareNote(saturday, SAT), /The rest of the week covers it\.$/);
});

// H1 again, from the other side: the menu is the source of these strings, so the map has to be
// read against the menu itself. A straight apostrophe in "Mom's" silently cost that day its boost.
test('every day type the form offers is one the budget knows', async () => {
 const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
 const menu = /<select class="select" id="kind">(.*?)<\/select>/s.exec(html)?.[1];
 assert.ok(menu, 'the Day type menu is still in index.html');
 const options = [...menu.matchAll(/<option>([^<]+)<\/option>/g)].map(match => match[1]);
 assert.ok(options.length > 5, options.length + ' day types found');
 for (const option of options) assert.ok(option in KINDS, option + ' is offered by the form but missing from KINDS');
});

// Eating back what you earned must not be charged to the week: the day already paid for it.
test('exercise calories eaten back are not taken out of the rest of the week', () => {
 const earned = {[MON]: 500};
 const onTarget = plan({eaten: {[MON]: DAILY + 500, [TUE]: DAILY}, credits: earned});
 assert.equal(on(onTarget, WED).allowance, DAILY, 'a day eaten exactly to target costs the week nothing');
 const without = plan({eaten: {[MON]: DAILY + 500, [TUE]: DAILY}});
 assert.ok(on(without, WED).allowance < DAILY, 'and without the credit it is an overspend');
 const under = plan({eaten: {[MON]: 200, [TUE]: DAILY}, credits: earned});
 assert.ok(on(under, WED).allowance > DAILY, 'a credit bigger than the meal is not banked as a surplus');
});

// Today is still being eaten, so charging the week only what is logged so far made every later
// day look roomier at breakfast than at dinner.
test('a day still in progress does not inflate the days after it', () => {
 const morning = weekPlan({daily: DAILY, date: WED, today: WED, eaten: {[MON]: DAILY, [TUE]: DAILY, [WED]: 400}});
 const evening = weekPlan({daily: DAILY, date: WED, today: WED, eaten: {[MON]: DAILY, [TUE]: DAILY, [WED]: DAILY}});
 assert.equal(on(morning, THU).allowance, on(evening, THU).allowance, "Thursday holds still through Wednesday's meals");
 const over = weekPlan({daily: DAILY, date: WED, today: WED, eaten: {[MON]: DAILY, [TUE]: DAILY, [WED]: DAILY + 700}});
 assert.ok(on(over, THU).allowance < DAILY, 'but going past the share today still lands on tomorrow');
});

test('a week that spans an allowance change is planned at each day s own number', () => {
 const targets = [{from: '2000-01-01', kcal: 2000}, {from: THU, kcal: 1800}];
 const early = weekPlan({targets, date: TUE});
 const late = weekPlan({targets, date: FRI});
 assert.equal(early.weekly, late.weekly, 'the week is the same week whenever you look at it');
 assert.equal(early.weekly, 2000 * 3 + 1800 * 4);
 assert.equal(on(early, TUE).base, 2000);
 assert.equal(on(early, FRI).base, 1800);
 assert.equal(on(early, TUE).allowance, on(late, TUE).allowance, 'and Tuesday keeps its number');
});

test('settings that arrive half-written fall back rather than silently zeroing', () => {
 for (const value of [null, '', true, [], undefined, {}]) {
  assert.equal(budgetOf({dayBudget: {event: value}}).event, DEFAULTS.event, String(value));
 }
 assert.equal(budgetOf({dayBudget: {event: 450}}).event, 450, 'a real number is still used');
});

test('a weekend bigger than the weekdays can give never makes a day negative', () => {
 const shares = baseShares(200, 1000);
 assert.ok(shares.every(share => share >= 0), shares.join(', '));
 const result = weekPlan({daily: 200, settings: {dayBudget: {weekend: 1000}}, date: WED});
 assert.ok(result.days.every(day => day.allowance >= 0));
});

test('a day type that is not a string is read as no answer at all', () => {
 const result = plan({kinds: {[SAT]: {name: 'Family event'}}});
 assert.equal(on(result, SAT).kind, '');
 assert.equal(on(result, SAT).own, 0);
 assert.doesNotThrow(() => shareNote(result, SAT));
});

// The bug this guards: a day made smaller by Monday's overspend blamed Saturday's dinner instead.
test('a lighter day names the reason it is actually lighter', () => {
 const overspent = plan({kinds: {[SAT]: 'Family event'}, eaten: {[MON]: DAILY + 800, [TUE]: DAILY}});
 assert.match(shareNote(overspent, WED), /the week is \d{3,} over so far, and there is Saturday to come\.$/);
 const planned = plan({kinds: {[SAT]: 'Family event'}, eaten: {[MON]: 1917, [TUE]: 1917}});
 assert.match(shareNote(planned, WED), /putting it towards Saturday\.$/);
});

// A disciplined week with one day left used to put the whole surplus on that day.
const capped = (over = {}) => plan({settings: {dayBudget: {cap: 2400}}, ...over});

test('the cap limits what the week may hand a single day', () => {
 const lean = capped({eaten: {[MON]: 800, [TUE]: 800}});
 const uncapped = plan({eaten: {[MON]: 800, [TUE]: 800}});
 assert.equal(on(uncapped, WED).allowance, 2480, 'what the surplus would have given');
 assert.equal(on(lean, WED).allowance, 2400);
 assert.equal(on(lean, WED).capped, true);
 assert.equal(on(uncapped, WED).capped, false, 'uncapped by default');
});

test('what the cap withholds is left for the days after it', () => {
 const lean = capped({eaten: {[MON]: 800, [TUE]: 800}});
 for (const day of [WED, THU, FRI]) assert.equal(on(lean, day).allowance, 2400, day);
 // Nothing is lost on the way: every later day is still offered the cap, and the remainder
 // simply stays unspent rather than piling onto Sunday.
 assert.equal(on(lean, SUN).allowance, 2400);
});

test('an event day is capped too, since the cap is the most in a day', () => {
 const party = capped({kinds: {[SAT]: 'Family event'}});
 assert.equal(on(party, SAT).allowance, 2400, 'rather than 2,500');
 assert.equal(on(party, SAT).capped, true);
});

test('a cap of zero is no cap at all', () => {
 assert.equal(budgetOf({}).cap, 0);
 const lean = plan({settings: {dayBudget: {cap: 0}}, eaten: {[MON]: 800, [TUE]: 800}});
 assert.ok(on(lean, WED).allowance > DAILY, 'the surplus still comes back');
 assert.equal(on(lean, WED).capped, false);
});

test('a capped day says the room exists and is being kept, and that training does not unlock it', () => {
 const lean = capped({eaten: {[MON]: 800, [TUE]: 800}});
 assert.match(shareNote(lean, WED), /^2400 is your most in a day, exercise included\. The week has more to spare/);
});

test('the cap never raises a day that the week could not afford anyway', () => {
 const spent = capped({eaten: {[MON]: DAILY * 4, [TUE]: DAILY}});
 assert.ok(on(spent, WED).allowance < DAILY);
 assert.equal(on(spent, WED).capped, false, 'the week decided this one, not the cap');
});

// "2700 cap, no matter what you do that day": the cap bounds the number you eat to, not the
// number the week handed you, so a session no longer buys a bigger day.
const CAP = {cap: 2700};

test('the cap clips the total after exercise is added', () => {
 assert.equal(capDay(2400 + 600, CAP), 2700, 'a 600 kcal session does not make it 3000');
 assert.equal(capDay(2700, CAP), 2700, 'landing exactly on the cap is not clipped further');
});

test('a day under the cap keeps its number, exercise and all', () => {
 assert.equal(capDay(1800, CAP), 1800);
 assert.equal(capDay(1800 + 400, CAP), 2200, 'earned calories still count below the cap');
 assert.equal(capDay(0, CAP), 0);
});

test('a cap of zero leaves the day alone', () => {
 assert.equal(capDay(3300, {cap: 0}), 3300);
 assert.equal(capDay(3300, budgetOf({})), 3300, 'and the default budget is uncapped');
 assert.equal(capDay(3300, undefined), 3300);
});

test('no allowance set survives the cap untouched', () => {
 assert.equal(capDay(null, CAP), null, 'null means no allowance, not a number to clip');
 assert.equal(capDay(undefined, CAP), undefined);
 assert.ok(Number.isNaN(capDay(NaN, CAP)));
 assert.equal(capDay(Infinity, CAP), Infinity, 'not finite, so not a number the cap can bound');
});

test('an event day plus exercise is still only the cap', () => {
 const party = plan({settings: {dayBudget: {cap: 2700, event: 500}}, kinds: {[SAT]: 'Family event'}});
 const day = on(party, SAT);
 assert.equal(day.allowance, 2500, 'the week hands it the event day, under the cap');
 assert.equal(day.capped, false, 'so the week, not the cap, decided the share');
 assert.equal(capDay(day.allowance + 600, party.budget), 2700, 'but training does not take it to 3100');
});

// The bug this guards: the cap only clipped the week's share, so a day whose share was under the
// cap and whose exercise pushed it over went past the cap with nothing said about it.
test('a day pushed over the cap by exercise alone says so', () => {
 const week = weekPlan({daily: 2400, date: WED, settings: {dayBudget: {cap: 2700}}});
 const day = week.days.find(entry => entry.date === WED);
 assert.equal(day.capped, false, 'the week did not hit the cap');
 assert.equal(capDay(day.allowance + 600, week.budget), 2700, 'but the total does');
 assert.equal(shareNote(week, WED, 600), '2700 is your most in a day, so today’s session does not add to it.');
 assert.equal(shareNote(week, WED, 0), '', 'and an ordinary day still says nothing');
});
