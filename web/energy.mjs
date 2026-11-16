// Calorie allowance math: daily balance against the allowance, weekly summaries,
// and the maintenance level implied by intake and weight change.
import {energy, totals} from './nutrition.mjs';

export const KCAL_PER_LB = 3500;
const MIN_LOGGED_DAYS = 7;
const MIN_WEEKS_APART = 2;

const toDate = date => new Date(date + 'T12:00:00Z');
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;

export function mondayOf(date) {
 const d = toDate(date);
 d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
 return d.toISOString().slice(0, 10);
}

// Allowance history: [{from: 'YYYY-MM-DD', kcal}]. A day uses the latest entry on or before it.
export function allowanceOn(targets, date) {
 const applicable = (targets || []).filter(t => t.from <= date).sort((a, b) => a.from.localeCompare(b.from));
 return applicable.length ? applicable[applicable.length - 1].kcal : null;
}

// Returns a new history with the allowance set from `date` onwards; past days keep theirs.
export function withAllowance(targets, date, kcal) {
 return [...(targets || []).filter(t => t.from !== date), {from: date, kcal}].sort((a, b) => a.from.localeCompare(b.from));
}

// A day's intake in whole calories. Exported because the week budget has to round a day exactly
// the way dayBalance does: two roundings that merely happen to agree are a bug waiting to happen.
export const intakeOf = meals => Math.round(energy(totals((meals || []).flatMap(meal => meal.items))));

// Exercise earns extra allowance: the Watch's activity above the person's usual day, or the
// calories on the sessions they logged, whichever is larger, never both. A session the Watch
// recorded carries the Watch's calories and is also inside its daily total, so taking the larger
// cannot count it twice; a session the Watch missed (left at home, or it died mid-workout) keeps
// its estimate. `final` is false while today's Watch total is still partial (before the evening
// upload). `share` is how much is eaten back.
export function exerciseCredit(health, workouts, share = 1, activeBaseline = null, final = true) {
 const reported = Number(health?.workoutKcal) > 0 ? Number(health.workoutKcal) : 0;
 const watchKnown = reported > 0 || (activeBaseline !== null && Number(health?.activeKcal) > 0);
 const watch = reported || Math.round(Math.max(0, Number(health?.activeKcal || 0) - (activeBaseline ?? 0)));
 const logged = (workouts || []).reduce((sum, w) => sum + (Number(w?.kcal) > 0 ? Number(w.kcal) : 0), 0);
 const useWatch = watchKnown && watch > 0 && watch >= logged;
 const kcal = useWatch ? watch : logged;
 return {kcal: Math.round(kcal * share), source: useWatch ? 'watch' : logged ? 'logged' : null, logged, watch: watchKnown ? watch : null, final};
}

// A day's Watch total is complete once its evening upload (11:40 PM) has arrived. If that upload
// never comes, the day stays partial, so the larger of Watch and notes keeps counting.
const EVENING_HOUR = 21;
const localDateOf = time => { const d = new Date(time); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
export function watchFinal(date, day) {
 if (!day?.receivedAt) return false;
 const received = localDateOf(day.receivedAt);
 return received > date || (received === date && new Date(day.receivedAt).getHours() >= EVENING_HOUR);
}

// `share` overrides the flat allowance with the day's share of the week's budget (budget.mjs).
export function dayBalance(meals, targets, date, earned = 0, share = null) {
 const eaten = intakeOf(meals);
 const base = share ?? allowanceOn(targets, date);
 const allowance = base === null ? null : base + earned;
 return {eaten, base, earned: base === null ? 0 : earned, allowance, balance: allowance === null ? null : eaten - allowance};
}

const BASELINE_DAYS = 14;
const MIN_BASELINE_DAYS = 5;

// A person's usual active calories: the median over the 14 days before `date`. Needs 5 days of data.
export function activeBaseline(healthByDate, date) {
 const start = addDays(date, -BASELINE_DAYS);
 const values = Object.entries(healthByDate || {})
  .filter(([d, h]) => d >= start && d < date && Number(h?.activeKcal) > 0)
  .map(([, h]) => Number(h.activeKcal)).sort((a, b) => a - b);
 if (values.length < MIN_BASELINE_DAYS) return null;
 const mid = Math.floor(values.length / 2);
 return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// The seven dates of the Mon–Sun week a date falls in. This module owns week boundaries, so the
// budget and the week card both ask it rather than each counting days of their own.
export const weekDates = date => Array.from({length: 7}, (_, i) => addDays(mondayOf(date), i));
export const addDays = (date, n) => { const d = toDate(date); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Monday to Sunday of the week containing `date`, with each day's balance and the running total
// over days that have meals logged (unlogged days are not read as fasting).
export function weekToDate(mealsByDate, targets, creditsByDate, date, shares = null) {
 const days = weekDates(date).map(day => {
  const meals = mealsByDate?.[day] || [];
  return {date: day, logged: meals.length > 0, ...dayBalance(meals, targets, day, creditsByDate?.[day] || 0, shares?.[day] ?? null)};
 });
 const counted = days.filter(d => d.logged && d.balance !== null);
 const balance = counted.reduce((sum, d) => sum + d.balance, 0);
 return {week: days[0].date, days, loggedDays: counted.length, balance: counted.length ? balance : null, earned: days.reduce((sum, d) => sum + d.earned, 0), weightEquivalent: counted.length ? Math.round(balance / KCAL_PER_LB * 10) / 10 : null};
}

// Only days with at least one meal count, so unlogged days are not read as fasting.
export function weeklySummary(mealsByDate, daysByDate, targets, healthByDate = {}, creditsByDate = {}) {
 const weeks = new Map();
 const week = date => {
  const key = mondayOf(date);
  if (!weeks.has(key)) weeks.set(key, {week: key, intake: [], balance: 0, balancedDays: 0, earned: 0, weights: [], burned: [], measured: 0, measuredDays: 0});
  return weeks.get(key);
 };
 for (const [date, meals] of Object.entries(mealsByDate || {})) {
  if (!meals?.length) continue;
  const {eaten, balance, earned} = dayBalance(meals, targets, date, creditsByDate?.[date] || 0);
  const w = week(date);
  w.intake.push(eaten);
  w.earned += earned;
  if (balance !== null) { w.balance += balance; w.balancedDays += 1; }
  const burned = healthByDate?.[date]?.burnedKcal;
  if (burned > 0) { w.measured += eaten - burned; w.measuredDays += 1; }
 }
 for (const [date, day] of Object.entries(daysByDate || {})) {
  const weight = Number(day?.weight);
  if (weight > 0) week(date).weights.push(weight);
 }
 for (const [date, day] of Object.entries(healthByDate || {})) {
  if (day?.burnedKcal > 0) week(date).burned.push(day.burnedKcal);
 }
 const sorted = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
 return sorted.map((w, i) => {
  const avgWeight = w.weights.length ? mean(w.weights) : null;
  const previous = sorted.slice(0, i).reverse().find(p => p.weights.length);
  return {
   week: w.week,
   loggedDays: w.intake.length,
   avgIntake: w.intake.length ? Math.round(mean(w.intake)) : null,
   balance: w.balancedDays ? w.balance : null,
   earned: w.earned,
   avgWeight: avgWeight === null ? null : Math.round(avgWeight * 10) / 10,
   weightChange: avgWeight !== null && previous ? Math.round((avgWeight - mean(previous.weights)) * 10) / 10 : null,
   avgBurned: w.burned.length ? Math.round(mean(w.burned)) : null,
   // Eaten minus Apple Health burn, over days that have both.
   measuredBalance: w.measuredDays ? w.measured : null,
  };
 });
}

// Maintenance implied by the data: average intake minus the energy the weight change accounts for.
// Needs enough logged days and weekly weight averages at least two weeks apart.
export function impliedMaintenance(summary) {
 const weighed = summary.filter(w => w.avgWeight !== null);
 if (weighed.length < 2) return null;
 const first = weighed[0], last = weighed[weighed.length - 1];
 const span = daysBetween(first.week, last.week);
 if (span < MIN_WEEKS_APART * 7) return null;
 const inSpan = summary.filter(w => w.week >= first.week && w.week <= last.week && w.avgIntake !== null);
 const loggedDays = inSpan.reduce((sum, w) => sum + w.loggedDays, 0);
 if (loggedDays < MIN_LOGGED_DAYS) return null;
 const avgIntake = inSpan.reduce((sum, w) => sum + w.avgIntake * w.loggedDays, 0) / loggedDays;
 const weightChange = last.avgWeight - first.avgWeight;
 return {
  kcal: Math.round((avgIntake - weightChange * KCAL_PER_LB / span) / 10) * 10,
  avgIntake: Math.round(avgIntake),
  weightChange: Math.round(weightChange * 10) / 10,
  days: span,
  loggedDays,
 };
}

// Expected weekly weight change if the allowance is eaten every day, given a maintenance level.
export const expectedWeeklyChange = (allowance, maintenance) => Math.round((allowance - maintenance) * 7 / KCAL_PER_LB * 10) / 10;

// Average daily burn reported by Apple Health over the weeks that have it.
export function averageBurn(summary) {
 const weeks = summary.filter(w => w.avgBurned !== null);
 return weeks.length ? Math.round(mean(weeks.map(w => w.avgBurned)) / 10) * 10 : null;
}
