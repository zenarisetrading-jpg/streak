import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STEPS, LAST, stepAt, defaultDraft, problem, outcome, setupPatch, isSetUp, hasAllowance, EARLIEST} from '../web/setup-steps.mjs';
import {suggestedAllowance} from '../web/profile.mjs';
import {allowanceOn} from '../web/energy.mjs';

const YEAR = 2026;
// Someone 5′10″, 36, male, active three times a week, 190 lb, wanting 175.
const answered = {...defaultDraft('lb', YEAR), weight: '190', heightIn: 70, birthYear: 1990, sex: 'male', activity: 'moderate', goal: '175'};
const step = key => STEPS.find(s => s.key === key);

test('the questions are asked in the order the maths needs them', () => {
 assert.deepEqual(STEPS.map(s => s.key), ['weight', 'heightIn', 'birthYear', 'sex', 'activity', 'goal', 'done']);
 assert.equal(stepAt(LAST).type, 'result', 'the last screen shows the answer, it does not ask');
 // Walking off either end must land on a real step rather than undefined.
 assert.equal(stepAt(-3).key, 'weight');
 assert.equal(stepAt(99).key, 'done');
});

test('every question states what is wrong rather than silently refusing', () => {
 const blank = defaultDraft('lb', YEAR);
 for (const key of ['weight', 'sex', 'activity', 'goal']) {
  assert.match(problem(step(key), blank, YEAR), /\S/, key + ' must say why it cannot go on');
 }
 // Height and year are pre-set to something plausible, so they are answered on arrival.
 assert.equal(problem(step('heightIn'), blank, YEAR), '');
 assert.equal(problem(step('birthYear'), blank, YEAR), '');
});

test('a weight outside the range is a typo, not an answer', () => {
 assert.match(problem(step('weight'), {...answered, weight: '19'}, YEAR), /between 50 and 700 lb/);
 assert.match(problem(step('weight'), {...answered, weight: 'x'}, YEAR), /between/);
 assert.equal(problem(step('weight'), {...answered, weight: '190'}, YEAR), '');
 // kg asks in kg: a kg user typing 86 must not be told to enter at least 50 lb.
 assert.match(problem(step('weight'), {...defaultDraft('kg', YEAR), weight: '12'}, YEAR), /between 23 and 317 kg/);
 assert.equal(problem(step('weight'), {...defaultDraft('kg', YEAR), weight: '86'}, YEAR), '');
});

test('holding steady is a complete answer to the goal question', () => {
 const maintain = {...answered, goal: '', maintain: true};
 assert.equal(problem(step('goal'), maintain, YEAR), '');
 assert.equal(outcome(maintain, YEAR).goal, null);
 assert.equal(outcome(maintain, YEAR).direction, 0, 'no goal is no deficit');
});

test('the numbers shown at the end are the ones the app goes on to use', () => {
 const shown = outcome(answered, YEAR);
 const same = suggestedAllowance({heightIn: 70, birthYear: 1990, sex: 'male', activity: 'moderate'}, 190, 175, YEAR);
 assert.equal(shown.allowance, same.allowance);
 assert.equal(shown.direction, -1, '190 heading for 175 is a deficit');
 assert.ok(shown.allowance < shown.maintenance);
 assert.ok(shown.protein > 0);
});

test('nothing is worked out from a half-answered flow', () => {
 for (const gap of [{sex: ''}, {activity: ''}, {weight: ''}, {heightIn: 12}]) {
  assert.equal(outcome({...answered, ...gap}, YEAR), null, JSON.stringify(gap));
  assert.equal(setupPatch({...answered, ...gap}, {date: '2026-11-15', year: YEAR}), null, 'and nothing is saved either');
 }
});

test('finishing saves the profile, the unit, the goal, the allowance and today’s weigh-in', () => {
 const patch = setupPatch(answered, {date: '2026-11-15', targets: [], year: YEAR});
 assert.deepEqual(patch.settings.profile, {heightIn: 70, birthYear: 1990, sex: 'male', activity: 'moderate'});
 assert.equal(patch.settings.weightUnit, 'lb');
 assert.equal(patch.settings.goalWeight, 175);
 assert.equal(patch.settings.goalDate, null);
 assert.equal(patch.day.weight, '190');
 assert.equal(allowanceOn(patch.settings.calorieTargets, '2026-11-15'), patch.allowance);
 // The very first allowance reaches back, so a week logged before setup is measured against
 // something; a later change would start from the day it was made.
 assert.equal(patch.settings.calorieTargets[0].from, EARLIEST);
 assert.equal(allowanceOn(patch.settings.calorieTargets, '2026-01-01'), patch.allowance);
});

test('setup run again over an existing allowance leaves history alone', () => {
 const targets = [{from: EARLIEST, kcal: 2000}];
 const patch = setupPatch(answered, {date: '2026-11-15', targets, year: YEAR});
 assert.equal(allowanceOn(patch.settings.calorieTargets, '2026-11-14'), 2000, 'yesterday keeps the allowance it was judged by');
 assert.equal(allowanceOn(patch.settings.calorieTargets, '2026-11-15'), patch.allowance);
});

test('a weight typed in kg is stored in pounds like every other weight', () => {
 const patch = setupPatch({...answered, unit: 'kg', weight: '86', goal: '79'}, {date: '2026-11-15', year: YEAR});
 assert.ok(Math.abs(Number(patch.day.weight) - 189.6) < 0.2, patch.day.weight);
 assert.ok(Math.abs(patch.settings.goalWeight - 174.2) < 0.2, String(patch.settings.goalWeight));
 assert.equal(patch.settings.weightUnit, 'kg', 'but it is still shown back in kg');
});

// The bug this guards: a profile with no allowance, or an allowance with no profile, left the
// person on a Today screen with nothing to show and no obvious way out of it.
test('setup is only done when both halves of it are', () => {
 const profile = {heightIn: 70, birthYear: 1990, sex: 'male', activity: 'moderate'};
 const targets = [{from: EARLIEST, kcal: 2200}];
 assert.equal(isSetUp({profile, calorieTargets: targets}), true);
 assert.equal(isSetUp({profile}), false, 'a profile alone gives Today no number');
 assert.equal(isSetUp({calorieTargets: targets}), false, 'an allowance alone cannot be revised');
 assert.equal(isSetUp({profile: {...profile, sex: ''}, calorieTargets: targets}), false);
 assert.equal(isSetUp({}), false);
 assert.equal(isSetUp(undefined), false);
});

// The bug this guards: offering setup on the strength of a missing profile would put the flow in
// front of everyone who had typed their own allowance before the flow existed — and finishing it
// would replace the number they chose with an estimate.
test('the flow is only offered where there is no allowance at all', () => {
 const typedTheirOwn = {calorieTargets: [{from: EARLIEST, kcal: 2200}]};
 assert.equal(hasAllowance(typedTheirOwn), true, 'so they are left alone');
 assert.equal(isSetUp(typedTheirOwn), false, 'even though setup never ran for them');
 assert.equal(hasAllowance({}), false);
 assert.equal(hasAllowance({calorieTargets: []}), false);
 assert.equal(hasAllowance(undefined), false);
 // An allowance that only starts in the future still counts: the person has set one.
 assert.equal(hasAllowance({calorieTargets: [{from: '2099-01-01', kcal: 2200}]}), true);
});

// Setup and the Settings card ask the same questions; these are the ids the flow fills in, so a
// renamed field in the markup fails here rather than silently going unsaved.
test('the You card still holds every answer setup collects', () => {
 const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
 const about = html.slice(html.indexOf('id="about"'), html.indexOf('id="energy"'));
 for (const id of ['height', 'born', 'sex', 'weight-unit', 'activity', 'about-weight', 'goal-weight', 'goal-date', 'fuel', 'save-about', 'rerun-setup']) {
  assert.ok(about.includes('id="' + id + '"'), 'the You card is missing ' + id);
 }
 assert.ok(html.includes('id="setup"'), 'the setup flow has nowhere to render');
 // The old separate goal card is gone; two places to type a goal is how they drift apart.
 assert.ok(!html.includes('id="save-goal"'), 'the goal card should be part of the You card now');
});
