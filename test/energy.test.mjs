import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowanceOn, withAllowance, dayBalance, weeklySummary, impliedMaintenance, expectedWeeklyChange, mondayOf, averageBurn, exerciseCredit, weekToDate, activeBaseline, watchFinal} from '../web/energy.mjs';

// 500 kcal: 50 g protein, 50 g carbs, ~22.2 g fat
const meal = kcal => ({items: [{name: 'x', assumption: '', protein: 0, carbs: kcal / 4, fat: 0}]});

test('allowance history keeps past days unchanged', () => {
 const first = withAllowance([], '2026-11-01', 2000);
 const second = withAllowance(first, '2026-11-10', 1800);
 assert.deepEqual(first, [{from: '2026-11-01', kcal: 2000}]);
 assert.equal(allowanceOn(second, '2026-10-31'), null);
 assert.equal(allowanceOn(second, '2026-11-05'), 2000);
 assert.equal(allowanceOn(second, '2026-11-10'), 1800);
 assert.deepEqual(withAllowance(second, '2026-11-10', 1700).map(t => t.kcal), [2000, 1700]);
});

test('daily balance is eaten minus allowance', () => {
 assert.deepEqual(dayBalance([meal(600), meal(900)], [{from: '2026-11-01', kcal: 2000}], '2026-11-10'), {eaten: 1500, base: 2000, earned: 0, allowance: 2000, balance: -500});
 assert.deepEqual(dayBalance([meal(600)], [], '2026-11-10'), {eaten: 600, base: null, earned: 0, allowance: null, balance: null});
});

test('weeks start on Monday', () => {
 assert.equal(mondayOf('2026-11-10'), '2026-11-09');
 assert.equal(mondayOf('2026-11-15'), '2026-11-09');
 assert.equal(mondayOf('2026-11-16'), '2026-11-16');
});

test('weekly summary counts only logged days and tracks weight change', () => {
 const targets = [{from: '2026-11-01', kcal: 2000}];
 const meals = {'2026-11-02': [meal(1800)], '2026-11-03': [meal(2200)], '2026-11-04': [], '2026-11-10': [meal(1500)]};
 const days = {'2026-11-02': {weight: '240'}, '2026-11-05': {weight: '239'}, '2026-11-10': {weight: '238'}, '2026-11-11': {weight: ''}};
 const [w1, w2] = weeklySummary(meals, days, targets);
 assert.deepEqual(w1, {week: '2026-11-02', loggedDays: 2, avgIntake: 2000, balance: 0, earned: 0, avgWeight: 239.5, weightChange: null, avgBurned: null, measuredBalance: null});
 assert.deepEqual(w2, {week: '2026-11-09', loggedDays: 1, avgIntake: 1500, balance: -500, earned: 0, avgWeight: 238, weightChange: -1.5, avgBurned: null, measuredBalance: null});
});

test('implied maintenance needs enough data', () => {
 const short = [{week: '2026-11-02', loggedDays: 7, avgIntake: 2000, avgWeight: 240}, {week: '2026-11-09', loggedDays: 7, avgIntake: 2000, avgWeight: 239}];
 assert.equal(impliedMaintenance(short), null);
 assert.equal(impliedMaintenance([{week: '2026-11-02', loggedDays: 3, avgIntake: 2000, avgWeight: 240}, {week: '2026-11-16', loggedDays: 2, avgIntake: 2000, avgWeight: 239}]), null);
});

test('implied maintenance from intake and weight loss', () => {
 // 2 lb lost over 14 days at 2000 kcal/day: 2*3500/14 = 500 kcal/day deficit, maintenance 2500
 const summary = [
  {week: '2026-11-02', loggedDays: 7, avgIntake: 2000, avgWeight: 240},
  {week: '2026-11-09', loggedDays: 6, avgIntake: 2000, avgWeight: null},
  {week: '2026-11-16', loggedDays: 7, avgIntake: 2000, avgWeight: 238},
 ];
 assert.deepEqual(impliedMaintenance(summary), {kcal: 2500, avgIntake: 2000, weightChange: -2, days: 14, loggedDays: 20});
 assert.equal(expectedWeeklyChange(2000, 2500), -1);
});

test('Apple Health burn adds a measured balance', () => {
 const meals = {'2026-11-09': [meal(2000)], '2026-11-10': [meal(1800)]};
 const health = {'2026-11-09': {burnedKcal: 2600}, '2026-11-10': {burnedKcal: 2400}, '2026-11-11': {burnedKcal: 2500}};
 const [w] = weeklySummary(meals, {}, [], health);
 assert.equal(w.avgBurned, 2500);
 assert.equal(w.measuredBalance, -1200);
 assert.equal(averageBurn([w]), 2500);
});

test('the Watch number wins; logged estimates count only without it', () => {
 assert.deepEqual(exerciseCredit({workoutKcal: 420}, [{kcal: 300}]), {kcal: 420, source: 'watch', logged: 300, watch: 420, final: true});
 assert.deepEqual(exerciseCredit({workoutKcal: 250}, [{kcal: 300}]), {kcal: 300, source: 'logged', logged: 300, watch: 250, final: true});
 assert.deepEqual(exerciseCredit({}, [{kcal: 250}, {kcal: 100}]), {kcal: 350, source: 'logged', logged: 350, watch: null, final: true});
 assert.equal(exerciseCredit({workoutKcal: 400}, [], 0.5).kcal, 200);
 assert.deepEqual(exerciseCredit(undefined, undefined), {kcal: 0, source: null, logged: 0, watch: null, final: true});
});

test('a partial Watch day keeps the larger number until the full total arrives', () => {
 assert.deepEqual(exerciseCredit({activeKcal: 500}, [{kcal: 280}], 1, 450, false), {kcal: 280, source: 'logged', logged: 280, watch: 50, final: false});
 assert.equal(exerciseCredit({activeKcal: 900}, [{kcal: 280}], 1, 450, false).source, 'watch');
 assert.equal(exerciseCredit({activeKcal: 500}, [{kcal: 280}], 1, 450, true).kcal, 280);
 // Watch left at home: the phone's walking stays under the usual level, so the estimate counts.
 assert.deepEqual(exerciseCredit({activeKcal: 300}, [{kcal: 350}], 1, 450, true), {kcal: 350, source: 'logged', logged: 350, watch: 0, final: true});
 assert.deepEqual(exerciseCredit({activeKcal: 300}, [], 1, 450, true), {kcal: 0, source: null, logged: 0, watch: 0, final: true});
});

test('exercise raises the day allowance and the weekly balance', () => {
 const targets = [{from: '2026-11-01', kcal: 2000}];
 assert.deepEqual(dayBalance([meal(2300)], targets, '2026-11-10', 400), {eaten: 2300, base: 2000, earned: 400, allowance: 2400, balance: -100});
 const [w] = weeklySummary({'2026-11-10': [meal(2300)]}, {}, targets, {}, {'2026-11-10': 400});
 assert.equal(w.balance, -100);
 assert.equal(w.earned, 400);
});

test('week to date sums logged days Monday to Sunday', () => {
 const targets = [{from: '2026-11-01', kcal: 2000}];
 const meals = {'2026-11-09': [meal(1500)], '2026-11-10': [meal(2200)], '2026-11-08': [meal(9000)]};
 const week = weekToDate(meals, targets, {'2026-11-10': 300}, '2026-11-12');
 assert.equal(week.week, '2026-11-09');
 assert.equal(week.days.length, 7);
 assert.equal(week.days[6].date, '2026-11-15');
 assert.equal(week.loggedDays, 2);
 assert.equal(week.balance, -600);
 assert.equal(week.earned, 300);
 assert.equal(week.weightEquivalent, -0.2);
 assert.equal(weekToDate({}, targets, {}, '2026-11-12').balance, null);
});

test('active calories above the usual level count as Watch exercise', () => {
 const health = Object.fromEntries([1, 2, 3, 4, 5, 6].map(d => ['2026-11-0' + d, {activeKcal: 400 + d * 10}]));
 assert.equal(activeBaseline(health, '2026-11-10'), 435);
 assert.equal(activeBaseline({'2026-11-09': {activeKcal: 500}}, '2026-11-10'), null);
 assert.equal(exerciseCredit({activeKcal: 835}, [], 1, 435).kcal, 400);
 // Without a usual level yet, the Watch cannot separate workouts from daily movement.
 assert.equal(exerciseCredit({activeKcal: 835}, [{kcal: 200}], 1, null).source, 'logged');
});

test('a Watch day is final only once its evening upload has arrived', () => {
 const at = (date, hour) => new Date(date + 'T' + String(hour).padStart(2, '0') + ':40:00').toISOString();
 assert.equal(watchFinal('2026-11-10', {receivedAt: at('2026-11-10', 23)}), true);
 assert.equal(watchFinal('2026-11-10', {receivedAt: at('2026-11-10', 9)}), false);
 assert.equal(watchFinal('2026-11-10', {receivedAt: at('2026-11-11', 0)}), true);
 assert.equal(watchFinal('2026-11-10', {}), false);
});
