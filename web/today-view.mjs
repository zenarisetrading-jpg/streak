// Today screen: the calorie ring for the selected date, this week's Mon–Sun balance,
// recovery tiles from Apple Health and one tip.
import {dayBalance, weekToDate, weekDates, intakeOf} from './energy.mjs';
import {weekPlan, shareNote, capDay} from './budget.mjs';
import {totals} from './nutrition.mjs';
import {dateRange} from './analytics-data.mjs';
import {proteinTarget, macroTargets, macroStatus} from './profile.mjs';
import {restOfDayPlan} from './plan.mjs';
import {recoveryScore, BASELINE_WINDOW as BASELINE_SPAN, BASELINE_MIN_DAYS} from './recovery.mjs';
import {KEYS, read, localToday, selectedDate, targetsOf, latestWeight, creditsByDate, kcalOnly, fmt, signed, weightDelta, h, icon, unit, ring, delta, macroBar} from './store.mjs';

const el = id => document.getElementById(id);
const SLEEP_GOAL = 8;
const STEP_GOAL = 10000;
const WEEK_SCALE = 1.15;
const MACROS = [['protein', 'Protein', ''], ['carbs', 'Carbs', 'meter--neutral'], ['fat', 'Fat', 'meter--info']];

function calorieCard(date, targets, credit, proteinGoal, plan) {
 const meals = read(KEYS.meals)[date] || [];
 const share = plan?.days.find(day => day.date === date)?.allowance;
 const day = dayBalance(meals, targets, date, credit.kcal, share);
 // The cap is the most you may eat in a day, exercise included, so it is applied here — after the
 // earned calories are added and before anything is drawn. Everything below reads these: the ring,
 // the macro targets and the plan for the rest of the day all follow the capped number.
 const {eaten, base, earned} = day;
 const allowance = capDay(day.allowance, plan?.budget);
 const balance = allowance === null ? null : eaten - allowance;
 const card = el('today-card');
 const over = balance > 0;
 const chip = allowance === null ? null : h('span', {class: 'chip ' + (over ? 'chip--over' : 'chip--under')}, over ? 'Over' : eaten ? 'On track' : 'Fresh start');
 const centre = allowance === null
  ? [h('span', {class: 'num ring__big'}, fmt(eaten)), h('span', {class: 'eyebrow', style: {'margin-top': '4px'}}, 'kcal eaten')]
  : [h('span', {class: 'num ring__big'}, fmt(Math.abs(balance))), h('span', {class: 'eyebrow', style: {'margin-top': '4px'}}, over ? 'kcal over' : 'kcal left')];
 const sum = totals(meals.flatMap(meal => meal.items));
 const targets_ = macroTargets(allowance, proteinGoal);
 const note = shareNote(plan, date, earned);
 card.replaceChildren(
  h('div', {class: 'card__head'}, h('h2', {class: 'card__title'}, date === localToday() ? 'Calories today' : 'Calories'), chip),
  h('div', {class: 'hero-today'},
   ring(allowance ? eaten / allowance * 100 : 0, {cls: over ? 'ring--over' : '', label: centre}),
   h('div', {class: 'kv'},
    h('div', {}, h('p', {class: 'eyebrow'}, 'Eaten'), h('p', {class: 'stat__value num'}, fmt(eaten), unit('kcal'))),
    allowance === null
     ? h('div', {}, h('p', {class: 'eyebrow'}, 'Allowance'), h('button', {class: 'btn btn--ghost', type: 'button', onclick: () => window.dispatchEvent(new Event('setup-restart'))}, 'Set up your allowance'))
     : h('div', {}, h('p', {class: 'eyebrow'}, 'Allowance'), h('p', {class: 'stat__value num'}, fmt(allowance), unit('kcal')),
      earned > 0 ? h('p', {class: 'stat__foot'}, fmt(base) + ' base + ', h('strong', {class: 'earned'}, fmt(earned) + ' earned'), credit.source === 'watch' ? ' from extra Watch activity' : ' from workouts') : null))),
  // Why today is not the usual number: an event being saved for, or a week running ahead of itself.
  ...(note ? [h('p', {class: 'share-note'}, icon('spark'), h('span', {}, note))] : []),
  h('div', {class: 'macro-grid'}, MACROS.map(([key, label, cls]) => {
   const target = targets_?.[key] ?? null;
   return macroBar(label, sum[key], target, cls, macroStatus(key, sum[key], target), {compact: true, inProgress: date === localToday()});
  })),
 );
 return {eaten, allowance, sum, targets: targets_, meals: meals.length};
}

function weekCard(date, targets, credits, plan) {
 const today = localToday();
 // weekToDate adds each day's earned calories to the share it is given, so the cap has to be
 // applied to the total and handed back net of them — otherwise the week strip draws a taller
 // allowance than Today does for the same day.
 const earnedOn = kcalOnly(credits);
 const shares = plan && Object.fromEntries(plan.days.map(day => {
  const earned = earnedOn[day.date] || 0;
  return [day.date, Math.max(0, capDay(day.allowance + earned, plan.budget) - earned)];
 }));
 // Two passes, because the bars and the headline are answering different questions. The bars ask
 // "was that day within what it was given", so they use the shares. The headline asks "where is
 // the week against its budget", and the budget is seven flat days — the shares are offers made a
 // day at a time, and eating under raises the later ones, so they sum to more than the pool and
 // can never be the basis of the arithmetic. Adding them up was why this number disagreed with
 // the Weekly balance chart in Analytics by 791 kcal on a real week.
 const week = weekToDate(read(KEYS.meals), targets, kcalOnly(credits), date, shares);
 const budget = weekToDate(read(KEYS.meals), targets, kcalOnly(credits), date, null);
 const allowances = week.days.map(d => d.allowance).filter(a => a !== null);
 const top = Math.max(...allowances, ...week.days.map(d => d.eaten), 1) * WEEK_SCALE;
 const avgAllowance = allowances.length ? allowances.reduce((a, b) => a + b, 0) / allowances.length : null;
 const said = week.days.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {weekday: 'long'}) + (d.logged ? ' ' + fmt(d.eaten) + (d.allowance ? ' of ' + fmt(d.allowance) : '') + (d.balance > 0 ? ', over' : '') : ' not logged')).join('; ');
 const bars = week.days.map(d => {
  const future = d.date > today;
  const cls = 'wbar' + (future ? ' wbar--future' : '') + (d.balance > 0 ? ' wbar--over' : '') + (d.date === today ? ' wbar--today' : '');
  return h('div', {class: cls, style: d.logged ? {'--h': String(Math.round(d.eaten / top * 100))} : {'--h': '0'}, title: d.logged ? fmt(d.eaten) + (d.allowance ? ' of ' + fmt(d.allowance) : '') + ' kcal' : 'Not logged', 'data-date': future ? null : d.date});
 });
 const days = week.days.map(d => h('div', {class: 'week__day', 'aria-current': d.date === date ? 'date' : null}, new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {weekday: 'narrow'})));
 const headline = budget.balance === null ? '—' : signed(budget.balance);
 el('week-card').replaceChildren(
  h('div', {class: 'card__head'},
   h('div', {}, h('p', {class: 'eyebrow'}, 'Mon – Sun balance'), h('p', {class: 'stat__value num', style: {'margin-top': '4px'}}, headline, week.balance === null ? null : unit('kcal'))),
   budget.balance === null ? null : h('span', {class: 'delta ' + (budget.balance <= 0 ? 'delta--good' : 'delta--bad')}, (budget.balance <= 0 ? '↓ under' : '↑ over') + ' · ' + weightDelta(budget.weightEquivalent))),
  h('div', {class: 'week', role: 'img', 'aria-label': 'This week: ' + said, style: {'--line': avgAllowance ? String(Math.round(avgAllowance / top * 100)) : '0'}},
   h('div', {class: 'week__plot'}, ...bars, avgAllowance ? h('div', {class: 'week__line', 'data-label': 'allowance ' + fmt(avgAllowance)}) : null),
   ...days),
  h('div', {class: 'legend'},
   h('span', {class: 'legend__key', style: {'--key': 'var(--color-under)'}}, 'Under'),
   h('span', {class: 'legend__key', style: {'--key': 'var(--color-over)'}}, 'Over'),
   h('span', {class: 'legend__key legend__key--line'}, 'Allowance'),
   week.earned > 0 ? h('span', {class: 'hint'}, '+' + fmt(week.earned) + ' earned') : null),
 );
}

// Four steps of intensity, not a traffic light: the ramp says how strong a factor is, and a weak
// one is information rather than a warning.
const intensity = score => score >= 80 ? 4 : score >= 65 ? 3 : score >= 50 ? 2 : 1;

// One readiness number from sleep, HRV, resting heart rate, recent load and the day's check-in,
// on the same dark card as the morning prompt: the pair asks and answers.
// Hidden until there is something real to score.
function readinessCard(date) {
 const health = read(KEYS.health);
 const days = dateRange(date, BASELINE_SPAN + 1);
 const history = days.slice(0, -1).map(day => health[day]).filter(Boolean);
 const result = recoveryScore({health: health[date] || null, history, feel: read(KEYS.days)[date] || null});
 const box = el('recovery-score');
 box.hidden = result.score === null;
 if (box.hidden) { box.replaceChildren(); return; }
 const factors = result.components.map(part => h('div', {class: 'factor factor--' + intensity(part.score)},
  h('div', {class: 'factor__row'}, h('span', {class: 'factor__label'}, part.label), h('span', {class: 'factor__detail'}, part.detail)),
  h('div', {class: 'factor__track', style: {'--p': String(Math.round(part.score))},
   role: 'img', 'aria-label': part.label + ': ' + Math.round(part.score) + ' of 100, ' + part.detail},
   h('span'))));
 box.replaceChildren(
  h('div', {class: 'readiness__head'}, h('p', {class: 'readiness__title'}, 'Readiness'), h('span', {class: 'readiness__band'}, result.band)),
  h('div', {class: 'readiness__hero'},
   // The dial is one image to a screen reader: the number inside it is decoration of the same fact.
   h('div', {class: 'readiness__dial', role: 'img', 'aria-label': result.score + ' of 100, ' + result.band},
    ring(result.score, {cls: 'ring--thin ring--on-dark', label: [h('span', {class: 'readiness__score'}, String(result.score))]})),
   h('p', {class: 'readiness__note'}, result.note)),
  h('div', {class: 'readiness__factors'}, ...factors),
  // replaceChildren would print a bare null, so the optional line is only added when there is one.
  ...(result.building ? [h('p', {class: 'readiness__foot'},
   'Still learning your normal — ' + result.baselineDays + ' of ' + BASELINE_MIN_DAYS + ' days. HRV and heart rate join once there are enough.')] : []));
}

// What the week budget needs to know about the stored week: what was eaten on each logged day,
// and what each day was called. Intake goes through energy.mjs so it is rounded exactly the way
// dayBalance rounds it, rather than by a second copy that only happens to agree.
const weekIntake = date => { const meals = read(KEYS.meals); return Object.fromEntries(weekDates(date).filter(day => meals[day]?.length).map(day => [day, intakeOf(meals[day])])); };
const weekKinds = date => { const days = read(KEYS.days); return Object.fromEntries(weekDates(date).map(day => [day, days[day]?.kind || ''])); };

// What you did today, and nothing the readiness card already said. Sleep, HRV and resting heart
// rate are all on that card as "against your usual", which is the useful form of them, and their
// trends are on Analytics — three copies of the same night was the old shape of this section.
function recovery(date) {
 const health = read(KEYS.health);
 const day = health[date];
 const box = el('recovery');
 el('recovery-hint').textContent = day?.receivedAt ? 'from Apple Watch · ' + new Date(day.receivedAt).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}) : '';
 if (!day) {
  box.replaceChildren(h('article', {class: 'card card--flat span-2'}, h('div', {class: 'empty'},
   h('div', {class: 'empty__art'}, icon('watch')), h('p', {class: 'empty__title'}, 'No Watch data for this day'),
   h('p', {class: 'empty__text'}, 'Your iPhone Shortcut sends sleep, steps and heart data each morning and night.'))));
  return;
 }
 const tiles = [];
 if (day.steps > 0) tiles.push(h('article', {class: 'stat stat--accent'},
  h('div', {class: 'stat__head'}, h('p', {class: 'eyebrow'}, 'Steps'), h('span', {class: 'stat__icon stat__icon--on-accent'}, icon('steps'))),
  h('p', {class: 'stat__value num'}, fmt(day.steps)),
  h('p', {class: 'stat__foot muted'}, Math.round(day.steps / STEP_GOAL * 100) + '% of 10k')));
 if (day.activeKcal > 0 || day.burnedKcal > 0) tiles.push(h('article', {class: 'stat'},
  h('div', {class: 'stat__head'}, h('p', {class: 'eyebrow'}, 'Active'), h('span', {class: 'stat__icon'}, icon('flame'))),
  h('p', {class: 'stat__value num'}, fmt(day.activeKcal || 0), unit('kcal')),
  // The total burned is the bigger number but the one you did not earn: most of it is just being
  // alive. It sits underneath so the figure that answers "did I move today" leads.
  day.burnedKcal > 0 ? h('p', {class: 'stat__foot'}, fmt(day.burnedKcal) + ' burned in all') : null));
 box.replaceChildren(...tiles);
}

// Today only: the plan for the rest of the day, right under the ring.
function plan(date, info) {
 const box = el('today-tip');
 box.hidden = date !== localToday();
 if (box.hidden) return;
 const {title, lines} = restOfDayPlan({...info, hour: new Date().getHours()});
 box.querySelector('strong').textContent = title;
 box.querySelector('ul').replaceChildren(...lines.map(line => h('li', {}, line)));
}

function renderToday() {
 const date = selectedDate();
 const settings = read(KEYS.settings);
 const targets = targetsOf(settings);
 const credits = creditsByDate();
 const week = weekPlan({targets, settings, date, today: localToday(), eaten: weekIntake(date), credits: kcalOnly(credits), kinds: weekKinds(date)});
 plan(date, calorieCard(date, targets, credits[date] || {kcal: 0, source: null}, proteinTarget(latestWeight(), settings.goalWeight), week));
 weekCard(date, targets, credits, week);
 readinessCard(date);
 recovery(date);
}

el('week-card').addEventListener('click', event => {
 const bar = event.target.closest('[data-date]');
 if (!bar) return;
 const picker = el('day');
 picker.value = bar.dataset.date;
 picker.dispatchEvent(new Event('change'));
});
for (const event of ['tracker-synced', 'meals-rendered', 'workouts-rendered', 'checkin-saved', 'settings-saved']) window.addEventListener(event, renderToday);
el('day').addEventListener('change', renderToday);
renderToday();
