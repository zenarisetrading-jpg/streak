// Data for the Analytics screen: daily series over a date range, the weight trend,
// logging streak and macro averages. Pure functions so they can be tested in Node.
import {dayBalance, addDays, allowanceOn, mondayOf} from './energy.mjs';
import {budgetOf, capDay} from './budget.mjs';
import {totals} from './nutrition.mjs';

const TREND_DAYS = 7;

const toDate = date => new Date(date + 'T12:00:00Z');

// The `count` dates ending on `end`, oldest first.
export const dateRange = (end, count) => Array.from({length: count}, (_, i) => addDays(end, i - count + 1));

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

// Eaten and allowance per date; days without meals have eaten null so they show as gaps.
//
// `shares` is {date: allowance} from the week budget — sharesOver() in budget.mjs, which plans each
// Mon–Sun week the range touches once and in full. Without it the range falls back to the flat
// daily allowance, which is what every caller got before day types existed.
//
// Two different numbers live in a day here, and they are not the same yardstick:
// `allowance` is the day's share of its week, so the bar, its colour and the dashed line read the
// way Today reads; `balance` stays measured against the flat daily, because the week's budget *is*
// seven flat days however the shares are split. Running the net through the shares would charge
// every overspend twice — once on the day, and again on the later days whose shares it shrank —
// and the range's net would stop agreeing with the Weekly balance chart.
export function dailySeries(dates, mealsByDate, targets, creditsByDate = {}, shares = null, settings = null) {
 const budget = budgetOf(settings);
 return dates.map(date => {
  const meals = mealsByDate?.[date] || [];
  const earned = creditsByDate?.[date] || 0;
  const planned = shares?.[date];
  const {eaten, allowance} = dayBalance(meals, targets, date, earned, isNumber(planned) ? planned : null);
  const base = allowanceOn(targets, date);
  return {
   date,
   eaten: meals.length ? eaten : null,
   // The cap is clipped last, after exercise, exactly as Today clips it.
   allowance: capDay(allowance, budget),
   balance: meals.length && base !== null ? eaten - base - earned : null,
  };
 });
}

export function intakeSummary(series) {
 const logged = series.filter(d => d.eaten !== null);
 const withAllowance = logged.filter(d => d.allowance !== null);
 // A day can be drawn against a share and still have no flat base to be charged to, so the net is
 // summed over its own days rather than over the days that happen to have an allowance.
 const balanced = logged.filter(d => d.balance !== null);
 const mean = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
 return {
  loggedDays: logged.length,
  underDays: withAllowance.filter(d => d.eaten <= d.allowance).length,
  overDays: withAllowance.filter(d => d.eaten > d.allowance).length,
  avgEaten: mean(logged.map(d => d.eaten)),
  avgAllowance: mean(withAllowance.map(d => d.allowance)),
  balance: balanced.length ? balanced.reduce((sum, d) => sum + d.balance, 0) : null,
 };
}

// Weigh-ins on the range's index axis, and their trailing 7-day average.
export function weightSeries(dates, daysByDate) {
 const points = dates.map((date, i) => ({i, date, value: Number(daysByDate?.[date]?.weight)})).filter(p => p.value > 0);
 const trend = points.map(p => {
  const window = points.filter(q => q.i <= p.i && q.i > p.i - TREND_DAYS);
  return {i: p.i, value: Math.round(window.reduce((sum, q) => sum + q.value, 0) / window.length * 10) / 10};
 });
 const change = trend.length > 1 ? Math.round((trend[trend.length - 1].value - trend[0].value) * 10) / 10 : null;
 return {points, trend, latest: trend[trend.length - 1]?.value ?? null, change};
}

// Days in a row with at least one meal, ending today (or yesterday if today is still empty).
export function loggingStreak(mealsByDate, today) {
 const logged = date => (mealsByDate?.[date] || []).length > 0;
 let day = logged(today) ? today : addDays(today, -1);
 let count = 0;
 while (logged(day)) { count += 1; day = addDays(day, -1); }
 return count;
}

export function macroAverages(dates, mealsByDate) {
 const days = dates.map(date => mealsByDate?.[date] || []).filter(meals => meals.length);
 if (!days.length) return null;
 const sums = days.map(meals => totals(meals.flatMap(meal => meal.items)));
 const avg = key => Math.round(sums.reduce((sum, t) => sum + t[key], 0) / sums.length);
 return {protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat'), days: days.length};
}

// --- Workouts -------------------------------------------------------------
// The workouts map is {date: [{minutes, kcal, …}]}. Minutes are optional on a session — a lifting
// session logged as sets alone has none — so a day can honestly have sessions and no time.

const minutesOf = workout => (Number(workout?.minutes) > 0 ? Math.round(Number(workout.minutes)) : 0);
const kcalOf = workout => (Number(workout?.kcal) > 0 ? Math.round(Number(workout.kcal)) : 0);

// Sessions, minutes and calories per date. Rest days stay in the series as zeroes rather than
// gaps: a week's shape is the rest days as much as the training ones, and a bar chart that skips
// them would quietly redraw the calendar.
export const workoutSeries = (dates, workoutsByDate) => dates.map(date => {
 const workouts = workoutsByDate?.[date] || [];
 return {
  date,
  sessions: workouts.length,
  // Sessions that recorded a time, so an average length is never divided by sessions that have none.
  timed: workouts.filter(w => minutesOf(w) > 0).length,
  minutes: workouts.reduce((sum, w) => sum + minutesOf(w), 0),
  kcal: workouts.reduce((sum, w) => sum + kcalOf(w), 0),
 };
});


// Headline numbers for the range. Averages are per week of the range, not per training day, so a
// light week pulls them down the way it should.
export function workoutSummary(series) {
 if (!series.length) return null;
 const sum = key => series.reduce((total, day) => total + day[key], 0);
 const weeks = series.length / 7;
 const sessions = sum('sessions'), minutes = sum('minutes');
 return {
  sessions,
  minutes,
  kcal: sum('kcal'),
  activeDays: series.filter(day => day.sessions > 0).length,
  restDays: series.filter(day => day.sessions === 0).length,
  sessionsPerWeek: Math.round(sessions / weeks * 10) / 10,
  minutesPerWeek: Math.round(minutes / weeks),
  // Length of a typical session, over the sessions that recorded a time.
  avgSessionMinutes: sum('timed') > 0 ? Math.round(minutes / sum('timed')) : null,
 };
}

// A Health field per date, with nulls where nothing was recorded.
export const healthSeries = (dates, healthByDate, field) => dates.map(date => {
 const v = Number(healthByDate?.[date]?.[field]);
 return v > 0 ? v : null;
});


// Distance to a goal weight and when the current trend gets there.
// ratePerDay is the trend's change per day (negative when losing).
export function goalProgress(latest, goal, ratePerDay, today, goalDate = null) {
 if (!(latest > 0) || !(goal > 0)) return null;
 const toGo = Math.round((goal - latest) * 10) / 10;
 const towards = toGo !== 0 && ratePerDay !== null && Math.sign(ratePerDay) === Math.sign(toGo);
 const eta = towards ? addDays(today, Math.ceil(toGo / ratePerDay)) : null;
 const daysLeft = goalDate ? Math.round((toDate(goalDate) - toDate(today)) / 86400000) : null;
 const neededPerWeek = daysLeft > 0 ? Math.round(toGo / daysLeft * 7 * 10) / 10 : null;
 return {toGo, reached: Math.abs(toGo) < 0.5, eta, neededPerWeek, onPace: eta && goalDate ? eta <= goalDate : null};
}
