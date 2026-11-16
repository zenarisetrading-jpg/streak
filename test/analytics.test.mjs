import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dayBalance, weekToDate} from '../web/energy.mjs';
import {weekPlan, capDay} from '../web/budget.mjs';
import {dateRange, dailySeries, intakeSummary, weightSeries, loggingStreak, macroAverages, healthSeries, goalProgress, workoutSeries, workoutSummary} from '../web/analytics-data.mjs';
import {intakeBars, trendLine, divergingBars, sleepBars, sparkline} from '../web/charts.mjs';

const meal = kcal => ({items: [{name: 'x', assumption: '', protein: 0, carbs: kcal / 4, fat: 0}]});
const targets = [{from: '2026-01-01', kcal: 2000}];

test('daily series leaves unlogged days as gaps and summarises the range', () => {
 const dates = dateRange('2026-11-12', 3);
 assert.deepEqual(dates, ['2026-11-10', '2026-11-11', '2026-11-12']);
 const series = dailySeries(dates, {'2026-11-10': [meal(1800)], '2026-11-12': [meal(2300)]}, targets, {'2026-11-12': 200});
 assert.equal(series[1].eaten, null);
 assert.equal(series[2].allowance, 2200);
 assert.deepEqual(intakeSummary(series), {loggedDays: 2, underDays: 1, overDays: 1, avgEaten: 2050, avgAllowance: 2100, balance: -100});
});

// What budget.mjs's sharesOver does, written out here so these tests pin the data layer's own
// behaviour rather than the producer's: every week the range touches, planned once and in full.
const sharesFor = (dates, options) => Object.fromEntries(
 [...new Set(dates.map(date => weekPlan({...options, date})?.week).filter(Boolean))]
  .flatMap(week => weekPlan({...options, date: week}).days.map(day => [day.date, day.allowance])));

test('a range spanning two weeks draws each day at its share of its own week', () => {
 // Thu–Wed across Mon 11-09 and Mon 11-16, with a family event on Saturday 11-14.
 const dates = dateRange('2026-11-18', 7);
 const kinds = {'2026-11-14': 'Family event'};
 const shares = sharesFor(dates, {targets, settings: {}, today: '2026-11-09', eaten: {}, kinds});
 const series = dailySeries(dates, {'2026-11-14': [meal(2500)]}, targets, {}, shares);
 const on = date => series.find(d => d.date === date);

 assert.equal(on('2026-11-14').allowance, 2500, 'the event day is given its 500');
 assert.ok(on('2026-11-13').allowance < 2000, 'the rest of that week pays for it');
 // Nothing crosses Sunday: the next week starts from the full pool.
 assert.equal(on('2026-11-16').allowance, 2000);
 assert.equal(on('2026-11-18').allowance, 2000);
 // Eating the event day exactly to plan is an under day, not a red bar.
 assert.equal(intakeSummary(series).underDays, 1);
 assert.equal(intakeSummary(series).overDays, 0);
 // …but the range's net is still measured against the week's own budget of seven flat days,
 // so it reads the same as it would with no shares at all.
 assert.equal(intakeSummary(series).balance, 500);
 assert.equal(intakeSummary(dailySeries(dates, {'2026-11-14': [meal(2500)]}, targets, {})).balance, 500);
});

test('the daily cap clips a day after exercise is added, as Today clips it', () => {
 const dates = dateRange('2026-11-11', 3);
 const settings = {dayBudget: {cap: 2200}};
 const shares = sharesFor(dates, {targets, settings, today: '2026-11-09', eaten: {}, kinds: {}});
 const meals = {'2026-11-10': [meal(2100)], '2026-11-11': [meal(2100)]};
 const series = dailySeries(dates, meals, targets, {'2026-11-11': 400}, shares, settings);

 assert.equal(series[1].allowance, 2000, 'under the cap, the share stands');
 assert.equal(series[2].allowance, 2200, '2000 share + 400 earned, held at the cap');
 // The cap changes what you may eat, not what the week costs: the net is still against the budget.
 assert.equal(series[2].balance, -300);
});

test('daily series without shares is unchanged', () => {
 const dates = dateRange('2026-11-12', 2);
 const series = dailySeries(dates, {'2026-11-12': [meal(2300)]}, targets, {'2026-11-12': 200});
 assert.equal(series[1].allowance, 2200);
 assert.equal(series[1].balance, 100);
 assert.equal(series[0].eaten, null);
});

test('workout totals per day and per week, with rest days kept as zeroes', () => {
 const dates = dateRange('2026-11-18', 10); // 2026-11-09 (Mon) … 2026-11-18 (Wed)
 const workouts = {
  '2026-11-09': [{minutes: 45, kcal: 300}, {minutes: 20, kcal: 150}], // two in one day
  '2026-11-11': [{minutes: 60, kcal: 400}],
  '2026-11-13': [{kcal: 200}],                                       // sets only, no clock
  '2026-11-17': [{minutes: 30, kcal: 250}],
 };
 const series = workoutSeries(dates, workouts);
 assert.deepEqual(series[0], {date: '2026-11-09', sessions: 2, timed: 2, minutes: 65, kcal: 450});
 assert.deepEqual(series[1], {date: '2026-11-10', sessions: 0, timed: 0, minutes: 0, kcal: 0});
 assert.deepEqual(series[4], {date: '2026-11-13', sessions: 1, timed: 0, minutes: 0, kcal: 200});
 assert.equal(series.length, 10);

 const summary = workoutSummary(series);
 assert.equal(summary.sessions, 5);
 assert.equal(summary.minutes, 155);
 assert.equal(summary.activeDays, 4);
 assert.equal(summary.restDays, 6);
 assert.equal(summary.avgSessionMinutes, 39); // 155 over the 4 sessions that had a time
 assert.equal(workoutSummary(workoutSeries(dates, {})).sessions, 0);
 assert.equal(workoutSummary(workoutSeries(dates, {})).avgSessionMinutes, null);
 assert.equal(workoutSummary([]), null);
 assert.deepEqual(workouts['2026-11-09'].length, 2); // nothing was mutated
});

test('weight trend is a trailing 7-day average of weigh-ins', () => {
 const dates = dateRange('2026-11-12', 10);
 const days = {'2026-11-03': {weight: '240'}, '2026-11-05': {weight: '238'}, '2026-11-12': {weight: '236'}};
 const w = weightSeries(dates, days);
 assert.deepEqual(w.points.map(p => p.i), [0, 2, 9]);
 assert.deepEqual(w.trend.map(p => p.value), [240, 239, 236]);
 assert.equal(w.change, -4);
});

test('streak counts back from today, or yesterday when today is empty', () => {
 const meals = {'2026-11-10': [meal(1)], '2026-11-11': [meal(1)], '2026-11-09': []};
 assert.equal(loggingStreak(meals, '2026-11-12'), 2);
 assert.equal(loggingStreak({...meals, '2026-11-12': [meal(1)]}, '2026-11-12'), 3);
 assert.equal(loggingStreak({}, '2026-11-12'), 0);
});

test('macro averages and health comparisons', () => {
 assert.deepEqual(macroAverages(['2026-11-11', '2026-11-12'], {'2026-11-12': [meal(400)]}), {protein: 0, carbs: 100, fat: 0, days: 1});
 const hr = healthSeries(['a', 'b', 'c'], {a: {restingHR: 60}, c: {restingHR: 57}}, 'restingHR');
 assert.deepEqual(hr, [60, null, 57]);
});

test('charts produce markup from numbers', () => {
 assert.match(intakeBars([{eaten: 2500, allowance: 2000}, {eaten: null, allowance: 2000}]).markup, /chart__bar--over/);
 assert.match(trendLine([{i: 0, value: 240}], [{i: 0, value: 240}, {i: 5, value: 238}], 10).markup, /chart__dot/);
 const bars = divergingBars([{balance: -1200, partial: false}, {balance: 300, partial: true}]).markup;
 assert.match(bars, /chart__bar--under/);
 assert.match(bars, /opacity="0.55"/);
 assert.match(sleepBars([6.5, 7.5], 7).markup, /chart__bar--muted.*chart__bar--info/);
 assert.equal(sparkline([1]).markup, '');
 assert.doesNotMatch(intakeBars([]).markup, /NaN|undefined/);
});

test('goal progress gives distance, ETA and the pace needed', () => {
 const g = goalProgress(238, 228, -0.1, '2026-11-12', '2026-12-31');
 assert.equal(g.toGo, -10);
 assert.equal(g.eta, '2027-02-20');
 assert.equal(g.neededPerWeek, -1.4);
 assert.equal(g.onPace, false);
 assert.equal(goalProgress(238, 228, 0.05, '2026-11-12').eta, null);
 assert.equal(goalProgress(228.2, 228, null, '2026-11-12').reached, true);
 assert.equal(goalProgress(null, 228, -0.1, '2026-11-12'), null);
});

// The bug this guards: the cap was wired into Analytics but not into Today, so the same date read
// 3,300 on the screen you eat from and 2,700 on the screen you review. They must agree exactly.
test('Analytics shows a date the same number Today shows for it', () => {
 const targets = [{from: '2026-01-01', kcal: 2400}];
 const settings = {dayBudget: {cap: 2700}};
 const date = '2026-11-11';
 const eaten = {'2026-11-09': 800, '2026-11-10': 800};
 const credits = {[date]: 600};
 const plan = weekPlan({targets, settings, date, today: date, eaten, credits, kinds: {}});
 const share = plan.days.find(day => day.date === date).allowance;
 // Today: dayBalance adds the earned calories, then the cap clips the total.
 const onToday = capDay(dayBalance([], targets, date, credits[date], share).allowance, plan.budget);
 const shares = Object.fromEntries(plan.days.map(day => [day.date, day.allowance]));
 const [onAnalytics] = dailySeries([date], {}, targets, credits, shares, settings);
 assert.equal(onToday, 2700);
 assert.equal(onAnalytics.allowance, onToday);
});

// The bug this guards: Today's Mon–Sun headline summed the per-day shares, which are offers made
// one day at a time — eating under raises the later ones, so they add up to more than the week's
// pool. On a real week that read −1,735 beside Analytics' −944 for the same seven days.
test('the week headline measures against the week budget, not the sum of its offers', () => {
 const targets = [{from: '2000-01-01', kcal: 2300}];
 const date = '2026-11-15';
 const intake = {'2026-11-10': 2242, '2026-11-11': 1881, '2026-11-12': 2402, '2026-11-13': 2431, '2026-11-14': 2131, '2026-11-15': 1769};
 const meals = Object.fromEntries(Object.entries(intake).map(([day, kcal]) => [day, [{items: [{protein: 0, carbs: kcal / 4, fat: 0}]}]]));
 const plan = weekPlan({targets, settings: {}, date, today: date, eaten: intake, credits: {}, kinds: {}});
 const offered = plan.days.reduce((sum, day) => sum + day.allowance, 0);
 assert.ok(offered > plan.weekly, 'the offers really do exceed the pool: ' + offered + ' vs ' + plan.weekly);
 // What Today's headline and the Analytics chart must both use.
 const onBudget = weekToDate(meals, targets, {}, date, null);
 assert.equal(onBudget.balance, -944);
});
