// Analytics screen: intake vs allowance, weight trend, weekly balance, streak and macros,
// sleep and recovery trends, and what the data says about maintenance calories.
import {allowanceOn, weeklySummary, impliedMaintenance, expectedWeeklyChange, averageBurn, mondayOf, intakeOf, KCAL_PER_LB} from './energy.mjs';
import {dateRange, dailySeries, intakeSummary, weightSeries, loggingStreak, macroAverages, healthSeries, goalProgress, workoutSeries, workoutSummary} from './analytics-data.mjs';
import {weekPlan} from './budget.mjs';
import {macroTargets, macroStatus, proteinTarget} from './profile.mjs';
import {intakeBars, trendLine, divergingBars, sessionBars, sleepBars, sparkline, draw} from './charts.mjs';
import {weightText, toUnit} from './units.mjs';
import {KEYS, read, localToday, targetsOf, creditsByDate, kcalOnly, fmt, signed, weightDelta, weightUnit, shortDate, hoursMinutes, h, icon, unit, delta, macroBar, latestWeight} from './store.mjs';

const el = id => document.getElementById(id);
const SLEEP_TARGET = 7;
const STEP_GOAL = 10000;
const STREAK_DOTS = 14;
// Fewer logged days than this and a week's balance is a sample, not a verdict.
const THIN_WEEK = 4;
// Past this many days a bar is a week, not a day: 90 daily bars are 3px wide.
const WEEKLY_BARS_OVER = 30;
const MIN_AVERAGE_BARS = 3;
let rangeDays = 30;

const title = text => h('h2', {class: 'section-title'}, text);
const axis = dates => h('div', {class: 'chart-axis'}, ...[dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]].map(d => h('span', {}, shortDate(d))));
const legendKey = (text, color, kind = '') => h('span', {class: 'legend__key' + (kind ? ' legend__key--' + kind : ''), style: {'--key': color}}, text);
const emptyCard = (art, heading, text) => h('article', {class: 'card card--flat'}, h('div', {class: 'empty'}, h('div', {class: 'empty__art'}, icon(art)), h('p', {class: 'empty__title'}, heading), h('p', {class: 'empty__text'}, text)));
function chart(spec, label, cls = 'chart') { const svg = h('svg', {class: cls}); draw(svg, spec, label); return svg; }

// What the week budget needs to know about the stored weeks: what was eaten on each logged day and
// what each day was called. Intake goes through energy.mjs so it is rounded exactly the way
// dayBalance rounds it, rather than by a second copy that only happens to agree.
//
// These three belong beside weekPlan in budget.mjs (and intakeByDate beside intakeOf in
// energy.mjs); they sit here because this screen is the only caller that needs them over more
// than one week, and moving them is a change to files this pass does not own.
const intakeByDate = (mealsByDate, from) => Object.fromEntries(Object.entries(mealsByDate || {})
 .filter(([date, meals]) => date >= from && meals?.length)
 .map(([date, meals]) => [date, intakeOf(meals)]));

const kindsByDate = (daysByDate, from) => Object.fromEntries(Object.entries(daysByDate || {})
 .filter(([date, day]) => date >= from && typeof day?.kind === 'string' && day.kind)
 .map(([date, day]) => [date, day.kind]));

// What each date in a range was allowed. Every Mon–Sun week the range touches is planned once and
// in full, because a day's share depends on the whole week around it — including the days that
// fall outside the range being looked at. A week with no allowance history plans to null and is
// simply absent from the map, so those dates fall back to the flat daily.
const sharesOver = (dates, options) => Object.fromEntries([...new Set(dates.map(mondayOf))]
 .map(week => weekPlan({...options, date: week}))
 .filter(Boolean)
 .flatMap(plan => plan.days.map(day => [day.date, day.allowance])));

function intakeSection(dates, series, s) {
 if (!s.loggedDays) return [title('Intake vs allowance'), emptyCard('log', 'No meals in this range', 'Log meals and this shows each day against your allowance.')];
 return [title('Intake vs allowance'), h('article', {class: 'card'},
  h('p', {class: 'stat__value num', style: {margin: '0'}}, String(s.underDays), unit('of ' + s.loggedDays + ' logged days under')),
  // The allowance is now the day's share of its week and the net is still against the week's own
  // budget, so the yardstick is named: the three numbers are no longer one arithmetic sentence.
  h('p', {class: 'card__sub', style: {'margin-bottom': 'var(--space-4)'}}, 'Average ' + fmt(s.avgEaten) + ' eaten' + (s.avgAllowance ? ' vs ' + fmt(s.avgAllowance) + ' allowed' : '') + (s.balance !== null ? ' · net ' + signed(s.balance) + ' kcal vs budget' : '')),
  chart(intakeBars(series), 'Daily intake against allowance: ' + s.underDays + ' days under, ' + s.overDays + ' over'),
  axis(dates),
  h('div', {class: 'legend'}, legendKey('Under', 'var(--color-under)'), legendKey('Over', 'var(--color-over)'), legendKey('Allowance', 'var(--color-text-muted)', true)))];
}

const MIN_TREND_DAYS = 7;
const longDate = date => new Date(date + 'T12:00:00').toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});

function goalLine(w, settings) {
 const first = w.trend[0], last = w.trend[w.trend.length - 1];
 const rate = last && last.i - first.i >= MIN_TREND_DAYS ? (last.value - first.value) / (last.i - first.i) : null;
 const g = goalProgress(w.latest, settings.goalWeight, rate, localToday(), settings.goalDate);
 if (!g) return h('p', {class: 'stat__foot'}, h('button', {class: 'btn btn--ghost', type: 'button', 'data-go': 'settings'}, 'Set a weight goal'));
 const u = weightUnit();
 if (g.reached) return h('p', {class: 'stat__foot'}, 'Goal of ' + weightText(settings.goalWeight, u) + ' reached. Nice work.');
 const parts = [toUnit(Math.abs(g.toGo), u).toFixed(1) + ' ' + u + ' to ' + weightText(settings.goalWeight, u)];
 if (g.eta) parts.push('on this trend around ' + longDate(g.eta));
 else parts.push('the trend is not heading there yet');
 if (g.neededPerWeek !== null) parts.push('needs ' + weightDelta(g.neededPerWeek) + ' a week to make ' + longDate(settings.goalDate));
 return h('p', {class: 'stat__foot'}, parts.join(' · '));
}

// The weigh-ins (kept in lb) in the person's unit, for the numbers and chart on screen.
function inUnit(w, u) {
 const convert = p => ({...p, value: Math.round(toUnit(p.value, u) * 10) / 10});
 return {...w, points: w.points.map(convert), trend: w.trend.map(convert), latest: toUnit(w.latest, u), change: w.change === null ? null : Math.round(toUnit(w.change, u) * 10) / 10};
}

function weightSection(dates, days, settings) {
 const lbs = weightSeries(dates, days);
 const u = weightUnit();
 const w = inUnit(lbs, u);
 if (!w.points.length) return [h('div', {style: {'margin-top': 'var(--space-3)'}}, emptyCard('scale', 'No weigh-ins in this range', 'Add your weight in the Today check-in. The trend smooths out day-to-day water swings.'))];
 const goal = settings.goalWeight > 0 ? Math.round(toUnit(settings.goalWeight, u) * 10) / 10 : null;
 return [h('div', {class: 'tile-grid', style: {'margin-top': 'var(--space-3)'}}, h('article', {class: 'stat span-2'},
  h('div', {class: 'row-between'},
   h('div', {}, h('p', {class: 'eyebrow'}, 'Weight · 7-day trend'), h('p', {class: 'stat__value stat__value--hero num', style: {'margin-top': '4px'}}, w.latest.toFixed(1), unit(u))),
   w.change === null ? null : delta(w.change, Math.abs(w.change).toFixed(1) + ' ' + u + ' in ' + rangeDays + ' d', {lowerIsBetter: goal === null || goal < w.latest})),
  goalLine(lbs, settings),
  h('div', {style: {'margin-top': 'var(--space-3)'}}, chart(trendLine(w.points, w.trend, dates.length, {target: goal}), 'Weight trend ' + (w.change === null ? '' : (w.change <= 0 ? 'down ' : 'up ') + Math.abs(w.change).toFixed(1) + ' ' + u) + ' over ' + rangeDays + ' days' + (goal ? ', goal ' + goal + ' ' + u : ''))),
  h('div', {class: 'legend', style: {'margin-top': 'var(--space-2)'}}, legendKey('Weigh-in', 'var(--color-chart-neutral)'), legendKey('7-day average', 'var(--color-accent)'), goal ? legendKey('Goal', 'var(--color-text-muted)', true) : null)))];
}

function balanceSection(targets, credits) {
 const {[localToday()]: _partial, ...completeHealth} = read(KEYS.health);
 const weeksShown = rangeDays > 30 ? 13 : 8;
 const firstWeek = mondayOf(dateRange(localToday(), weeksShown * 7)[0]);
 // Today is still being logged, so weekly totals and the maintenance estimate use completed days only.
 const {[localToday()]: _today, ...pastMeals} = read(KEYS.meals);
 const all = weeklySummary(pastMeals, read(KEYS.days), targets, completeHealth, kcalOnly(credits));
 const summary = all.filter(w => w.week >= firstWeek);
 const thisWeek = mondayOf(localToday());
 // A week with two logged days makes a small green bar that reads as a good week. Dimming it the
 // way the still-running week is dimmed says "there is not enough here to judge" without hiding it.
 const weeks = summary.map(w => ({balance: w.balance, partial: w.week === thisWeek || w.loggedDays < THIN_WEEK, week: w.week}));
 const net = weeks.reduce((sum, w) => sum + (w.balance || 0), 0);
 if (!weeks.some(w => w.balance !== null)) return {nodes: [], all};
 const counted = weeks.filter(w => w.balance !== null).length;
 const under = weeks.filter(w => w.balance < 0).length;
 const thin = summary.filter(w => w.balance !== null && w.loggedDays < THIN_WEEK && w.week !== thisWeek).length;
 // Every faded bar, the still-running week included — that is what the reader sees faded.
 const dimmed = weeks.some(w => w.partial && w.balance !== null);
 // The net is the honest lead — it is what actually moved the scale — but four bad weeks and four
 // good ones net to nothing, which reads as "fine". The scoreboard underneath says how many.
 const subText = [under + ' of ' + counted + ' weeks under budget', ...(thin ? [thin + (thin === 1 ? ' week is' : ' weeks are') + ' only partly logged'] : [])].join(' · ');
 const label = under + ' of ' + counted + ' weeks under budget, net ' + signed(net) + ' kcal, about ' + weightDelta(net / KCAL_PER_LB) + ' over ' + weeks.length + ' weeks';
 return {all, nodes: [title('Weekly balance'), h('article', {class: 'card'},
  h('div', {class: 'row-between'},
   h('div', {}, h('p', {class: 'eyebrow'}, weeks.length + '-week net'), h('p', {class: 'stat__value num', style: {margin: '0'}}, signed(net), unit('kcal'))),
   h('span', {class: 'chip ' + (net <= 0 ? 'chip--under' : 'chip--over')}, '≈ ' + weightDelta(net / KCAL_PER_LB))),
  h('p', {class: 'card__sub', style: {'margin-bottom': 'var(--space-3)'}}, subText),
  // One reference line at a pound either side of zero: without it a bar's height is pure relative
  // scale, and the same bar can mean 1,200 kcal in one range and 9,000 in another.
  // The reference lines carry no text: at eight weeks a right-aligned label sits on top of the
  // most recent bars. The legend names them once instead.
  chart(divergingBars(weeks, {tick: KCAL_PER_LB}), label),
  h('div', {class: 'chart-axis'},
   h('span', {}, shortDate(weeks[0].week)),
   h('span', {}, weeks.length > 2 ? shortDate(weeks[Math.floor(weeks.length / 2)].week) : ''),
   h('span', {}, weeks.length > 1 ? 'This week' : '')),
  h('div', {class: 'legend'}, legendKey('Deficit', 'var(--color-under)'), legendKey('Surplus', 'var(--color-over)'),
   legendKey('Dashed line: ' + weightDelta(1).replace(/^[+\u2212-]/, ''), 'var(--color-text-muted)', 'line'),
   // A dimmed bar is one there is not enough logged to judge. The old key called it grey, which
   // it never was, so a reader looked for a grey bar that is not in the chart.
   dimmed ? h('span', {class: 'hint'}, 'Faded bars are part-logged weeks') : null))]};
}

// One bar's worth of training, read straight off the store because the chart wants each session's
// own length and the summed series carries only the total. Same "a length over zero counts" rule
// the data layer uses, so the bars and the headline numbers cannot disagree.
const bucketOf = ({start, dates}, workoutsByDate) => {
 const workouts = dates.flatMap(date => workoutsByDate?.[date] || []);
 const minutes = workouts.map(w => Number(w?.minutes)).filter(m => m > 0).map(Math.round);
 return {start, sessions: workouts.length, minutes, unknown: workouts.length - minutes.length, total: minutes.reduce((sum, m) => sum + m, 0)};
};

// Training volume: how often and how long, on one chart. A bar's height is the minutes trained and
// each session in it is its own segment, so the second chart (and the second axis a dual-scale one
// would need) earns nothing. Up to 30 days a bar is a day; beyond that a bar is a week, because 90
// daily slots are 3px wide and unreadable.
function trainingSection(dates, workoutsByDate) {
 const weekly = rangeDays > WEEKLY_BARS_OVER;
 const series = workoutSeries(dates, workoutsByDate);
 const summary = workoutSummary(series);
 if (!summary?.sessions) return [title('Training volume'),
  emptyCard('dumbbell', 'No workouts in this range', 'Log a session on the Workouts tab and this shows how often and how long you train.')];

 const slots = weekly
  ? [...new Set(dates.map(mondayOf))].map(week => ({start: week, dates: dates.filter(date => mondayOf(date) === week)}))
  : dates.map(date => ({start: date, dates: [date]}));
 const buckets = slots.map(slot => bucketOf(slot, workoutsByDate));
 // The oldest week is usually only partly inside the range, so it is a short week drawn at full
 // width. Counting it would pull the average down and make a normal week look quiet.
 const whole = buckets.filter((b, i) => slots[i].dates.length === (weekly ? 7 : 1));
 const trained = whole.filter(b => b.sessions > 0);
 // A dashed average over two bars is noise, not a reference.
 const average = trained.length >= MIN_AVERAGE_BARS ? trained.reduce((sum, b) => sum + b.total, 0) / trained.length : null;
 const untimed = series.reduce((count, day) => count + day.sessions - day.timed, 0);
 const busiest = buckets.filter(b => b.sessions > 0).reduce((best, b) => (best && best.sessions >= b.sessions ? best : b), null);
 const [hh, mm] = hoursMinutes(summary.minutes / 60);
 const said = n => n + (n === 1 ? ' session' : ' sessions');
 const subText = [summary.sessionsPerWeek + (summary.sessionsPerWeek === 1 ? ' session' : ' sessions') + ' a week',
  ...(summary.avgSessionMinutes !== null ? ['average ' + summary.avgSessionMinutes + ' min a session'] : []),
  ...(untimed ? [untimed + (untimed === 1 ? ' session has' : ' sessions have') + ' no length recorded'] : [])].join(' · ');
 const label = 'Training volume: ' + said(summary.sessions) + ' over ' + rangeDays + ' days, ' + hh + ' hours ' + mm + ' minutes in total'
  + (busiest ? ', busiest ' + (weekly ? 'week of ' : '') + shortDate(busiest.start) + ' with ' + said(busiest.sessions) : '')
  + (untimed ? ', ' + untimed + ' without a recorded length' : '');

 return [title('Training volume'), h('article', {class: 'card'},
  h('div', {class: 'row-between', style: {'margin-bottom': 'var(--space-2)'}},
   h('div', {}, h('p', {class: 'eyebrow'}, 'Sessions · last ' + rangeDays + ' days'),
    h('p', {class: 'stat__value num', style: {margin: '0'}}, String(summary.sessions), unit(summary.sessions === 1 ? 'session' : 'sessions'))),
   h('span', {class: 'chip'}, hh + ' h ' + mm + ' m')),
  h('p', {class: 'card__sub', style: {'margin-bottom': 'var(--space-4)'}}, subText),
  chart(sessionBars(buckets, {average}), label),
  axis(buckets.map(b => b.start)),
  h('div', {class: 'legend'}, legendKey('Session', 'var(--color-info)'),
   untimed ? legendKey('No length recorded', 'var(--color-text-muted)', 'ghost') : null,
   average ? legendKey('Average', 'var(--color-text-muted)', 'line') : null))];
}

function habitTiles(dates, meals, avgAllowance, proteinGoal) {
 const today = localToday();
 const streak = loggingStreak(meals, today);
 const dots = dateRange(today, STREAK_DOTS).map(d => h('span', {class: (meals[d] || []).length ? 'on' : ''}));
 const macros = macroAverages(dates, meals);
 const goals = macroTargets(avgAllowance, proteinGoal);
 return h('div', {class: 'tile-grid', style: {'margin-top': 'var(--space-3)'}},
  h('article', {class: 'stat stat--dark'},
   h('div', {class: 'stat__head'}, h('p', {class: 'eyebrow'}, 'Logging streak'), h('span', {class: 'stat__icon', style: {background: 'var(--color-accent)', color: '#fff'}}, icon('flame'))),
   h('p', {class: 'stat__value stat__value--hero num'}, String(streak), unit(streak === 1 ? 'day' : 'days')),
   h('div', {class: 'streak-dots', 'aria-hidden': 'true'}, ...dots)),
  h('article', {class: 'stat'}, h('p', {class: 'eyebrow'}, 'Macros vs target'),
   macros ? h('div', {class: 'stack', style: {gap: 'var(--space-3)', 'margin-top': 'var(--space-3)'}}, ...[['protein', 'Protein', ''], ['carbs', 'Carbs', 'meter--neutral'], ['fat', 'Fat', 'meter--info']].map(([k, label, cls]) => {
    const target = goals?.[k] ?? null;
    return macroBar(label, macros[k], target, cls, macroStatus(k, macros[k], target));
   }), goals ? null : h('p', {class: 'hint'}, 'Set an allowance to see targets.'))
    : h('p', {class: 'hint'}, 'Appears once meals are logged.')));
}

// One Watch field as a tile: where it is now, its shape over the range, and how its last week
// compares with its first. `lead` is the headline figure — the latest reading for something that
// is a level (resting heart rate), the daily average for something you accumulate (steps).
function trendTile(dates, health, field, label, u, lowerIsBetter, cls, {average = false} = {}) {
 const values = healthSeries(dates, health, field);
 const present = values.filter(value => value !== null);
 if (!present.length) return null;
 const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
 const firstWeek = present.slice(0, 7), lastWeek = present.slice(-7);
 const diff = present.length >= 4 ? Math.round(mean(lastWeek) - mean(firstWeek)) : null;
 const lead = Math.round(average ? mean(present) : present[present.length - 1]);
 const spark = h('svg', {class: 'chart chart--spark', preserveAspectRatio: 'none'});
 draw(spark, sparkline(values, {area: cls === 'info', cls}), label + ' over ' + rangeDays + ' days');
 return h('article', {class: 'stat'},
  h('p', {class: 'eyebrow'}, label + (average ? ' · daily avg' : '')),
  h('p', {class: 'stat__value num'}, fmt(lead), unit(u)), spark,
  // Short, because the pill shares a tile two to a row: a unitless field like steps also made
  // "2,953  over range" with the gap where its unit would have been.
  diff === null ? null : delta(diff, fmt(Math.abs(diff)) + (u ? ' ' + u : '') + ' vs start', {lowerIsBetter}));
}

// Activity: what you actually did, over time. Today shows the day's steps and active calories and
// nothing used to carry them forward, so a quiet fortnight was invisible until the scale said so.
function activitySection(dates, health) {
 const tiles = [
  trendTile(dates, health, 'steps', 'Steps', '', false, 'text', {average: true}),
  trendTile(dates, health, 'activeKcal', 'Active', 'kcal', false, 'info', {average: true}),
 ].filter(Boolean);
 if (!tiles.length) return [];
 const steps = healthSeries(dates, health, 'steps').filter(value => value !== null);
 const hit = steps.filter(value => value >= STEP_GOAL).length;
 return [title('Activity'), h('article', {class: 'card card--flat'},
  // The count of days over the step goal is the one judgement here; the tiles are plain numbers.
  h('p', {class: 'card__sub'}, steps.length ? hit + ' of ' + steps.length + ' days over ' + fmt(STEP_GOAL) + ' steps' : 'No step data in this range'),
  h('div', {class: 'tile-grid', style: {'margin-top': 'var(--space-3)'}}, ...tiles))];
}

function recoverySection(dates, health) {
 const nights = dates.slice(-Math.min(dates.length, 30));
 const sleep = healthSeries(nights, health, 'sleepHours');
 const recorded = sleep.filter(v => v !== null);
 const nodes = [title('Sleep and recovery')];
 if (recorded.length) {
  const avg = recorded.reduce((a, b) => a + b, 0) / recorded.length;
  const [hh, mm] = hoursMinutes(avg);
  nodes.push(h('article', {class: 'card'},
   h('div', {class: 'row-between', style: {'margin-bottom': 'var(--space-3)'}},
    h('div', {}, h('p', {class: 'eyebrow'}, 'Avg sleep · ' + recorded.length + (recorded.length === 1 ? ' night' : ' nights')), h('p', {class: 'stat__value num', style: {margin: '0'}}, String(hh), unit('h'), ' ' + mm, unit('m'))),
    h('span', {class: 'chip'}, recorded.filter(v => v >= SLEEP_TARGET).length + ' of ' + recorded.length + ' ≥ ' + SLEEP_TARGET + ' h')),
   chart(sleepBars(sleep, SLEEP_TARGET), 'Sleep per night, average ' + hh + ' hours ' + mm + ' minutes'),
   h('div', {class: 'legend'}, legendKey('≥ ' + SLEEP_TARGET + ' h', 'var(--color-info)'), legendKey('Under ' + SLEEP_TARGET + ' h', 'var(--color-chart-neutral)'), legendKey(SLEEP_TARGET + ' h target', 'var(--color-text-muted)', true))));
 }
 const tiles = [['hrv', 'HRV', 'ms', false, 'info'], ['restingHR', 'Resting HR', 'bpm', true, 'text']]
  .map(args => trendTile(dates, health, ...args)).filter(Boolean);
 if (tiles.length) nodes.push(h('div', {class: 'tile-grid', style: {'margin-top': 'var(--space-3)'}}, ...tiles));
 if (nodes.length === 1) nodes.push(emptyCard('moon', 'No sleep or heart data yet', 'Your iPhone Shortcut adds sleep, resting heart rate and HRV each morning.'));
 return nodes;
}

// Maintenance from the weight trend is the most reliable; Apple Health burn is the fallback.
function insight(targets, summary) {
 const allowance = allowanceOn(targets, localToday());
 const maintenance = impliedMaintenance(summary);
 const burn = averageBurn(summary);
 const parts = [];
 if (maintenance) parts.push('From ' + maintenance.loggedDays + ' logged days and ' + weightDelta(maintenance.weightChange) + ' over ' + maintenance.days + ' days, you maintain your weight at about ' + fmt(maintenance.kcal) + ' kcal a day.');
 if (burn) parts.push('Apple Health says you burn about ' + fmt(burn) + ' kcal a day' + (maintenance ? ', ' + (Math.abs(burn - maintenance.kcal) <= 150 ? 'which matches your weight trend.' : (burn > maintenance.kcal ? 'more' : 'less') + ' than your weight trend suggests, so trust the trend.') : '.'));
 const reference = maintenance?.kcal ?? burn;
 if (reference && allowance !== null) {
  const change = expectedWeeklyChange(allowance, reference);
  parts.push('Eating your ' + fmt(allowance) + ' kcal allowance every day would mean about ' + (change === 0 ? 'no change' : weightDelta(change) + ' a week') + '.');
 }
 const heading = maintenance ? 'Your maintenance is about ' + fmt(maintenance.kcal) + ' kcal' : 'Your maintenance estimate is coming';
 if (!maintenance) parts.push('After about two weeks of logged meals and weigh-ins, this estimates your maintenance calories from your actual weight change.');
 return h('div', {class: 'tip tip--info', style: {'margin-top': 'var(--space-5)'}}, h('span', {class: 'tip__icon'}, icon('spark')), h('div', {}, h('strong', {}, heading), parts.join(' ')));
}

function renderAnalytics() {
 if (el('screen-analytics').hidden) return;
 const dates = dateRange(localToday(), rangeDays);
 const settings = read(KEYS.settings);
 const targets = targetsOf(settings);
 const credits = creditsByDate();
 const meals = read(KEYS.meals);
 const days = read(KEYS.days);
 el('range-label').textContent = shortDate(dates[0]) + ' – ' + shortDate(dates[dates.length - 1]);
 const balance = balanceSection(targets, credits);
 // From the first date's Monday, not the first date: a week planned against a truncated history
 // hands its days the wrong shares, and the oldest week of a range is usually only half covered.
 const from = mondayOf(dates[0]);
 const shares = sharesOver(dates, {
  targets, settings, today: localToday(),
  eaten: intakeByDate(meals, from), credits: kcalOnly(credits), kinds: kindsByDate(days, from),
 });
 // Settings as well as shares: the cap has to clip days whose exercise credits push them over it,
 // which is what makes a day read the same here as it reads on Today.
 const series = dailySeries(dates, meals, targets, kcalOnly(credits), shares, settings);
 const summary = intakeSummary(series);
 el('analytics').replaceChildren(
  ...intakeSection(dates, series, summary),
  ...weightSection(dates, days, settings),
  ...balance.nodes,
  habitTiles(dates, meals, summary.avgAllowance, proteinTarget(latestWeight(), settings.goalWeight)),
  ...activitySection(dates, read(KEYS.health)),
  // After the habit tiles, which carry no title of their own and would otherwise read as part of
  // the training card, and before recovery, where the rest of the energy-out story lives.
  ...trainingSection(dates, read(KEYS.workouts)),
  ...recoverySection(dates, read(KEYS.health)),
  insight(targets, balance.all),
 );
}

el('range').addEventListener('click', event => {
 const button = event.target.closest('[data-days]');
 if (!button) return;
 rangeDays = Number(button.dataset.days);
 for (const b of el('range').querySelectorAll('[data-days]')) b.setAttribute('aria-pressed', String(b === button));
 renderAnalytics();
});
window.addEventListener('screen-shown', event => { if (event.detail === 'analytics') renderAnalytics(); });
for (const event of ['tracker-synced', 'settings-saved', 'checkin-saved']) window.addEventListener(event, renderAnalytics);
renderAnalytics();
