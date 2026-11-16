// First-run setup: the questions, in order, and the rules for each one.
//
// Everything the app needs before it can say a single useful number — weight, height, age, body,
// activity, goal — used to be spread across two tabs and three cards, and the allowance card
// could not even work out a number until a weigh-in had been saved on Today. This list is the
// one order those questions are asked in, and setupPatch is the one place the answers become
// saved settings, so the flow and the Settings form cannot drift apart.
//
// Pure functions only: no DOM, no storage. setup-view.mjs does the showing and the saving.
import {validProfile, suggestedAllowance, proteinTarget} from './profile.mjs';
import {withAllowance, allowanceOn} from './energy.mjs';
import {parseWeight, weightRange, WEIGHT_UNITS} from './units.mjs';

// The first allowance applies to past days too, so a week logged before setup is measured
// against something rather than against nothing.
export const EARLIEST = '2000-01-01';
export const MIN_HEIGHT_IN = 54;
export const MAX_HEIGHT_IN = 84;
export const MIN_AGE = 13;
export const MAX_AGE = 100;
export const DEFAULT_HEIGHT_IN = 70;
export const DEFAULT_AGE = 35;

export const STEPS = [
 {key: 'weight', type: 'weight', title: 'What do you weigh today?', hint: 'Your starting point. You can change the units here too.'},
 {key: 'heightIn', type: 'height', title: 'How tall are you?', hint: 'Drag the slider until the figure looks about right.'},
 {key: 'birthYear', type: 'year', title: 'What year were you born?', hint: 'Age changes how many calories your body burns at rest.'},
 {key: 'sex', type: 'sex', title: 'Which formula fits you?', hint: 'The two differ by about 160 calories a day. Nothing else in the app uses this.'},
 {key: 'activity', type: 'activity', title: 'How active is a normal week?', hint: 'Not counting workouts you log — those earn calories on the day.'},
 {key: 'goal', type: 'goal', title: 'Where do you want to get to?', hint: 'Losing works out at about a pound a week. You can change it any time.'},
 {key: 'done', type: 'result', title: 'Here is your starting point', hint: ''},
];

export const LAST = STEPS.length - 1;
export const stepAt = index => STEPS[Math.max(0, Math.min(LAST, index))];

export const defaultDraft = (unit = 'lb', year = new Date().getFullYear()) => ({
 unit: WEIGHT_UNITS.includes(unit) ? unit : 'lb',
 weight: '', heightIn: DEFAULT_HEIGHT_IN, birthYear: year - DEFAULT_AGE, sex: '', activity: '', goal: '', maintain: false,
});

// What is wrong with this step's answer, as a sentence to show, or '' when it is good to go.
// A step can never be passed with a bad answer, and never asks for an answer it already has.
export function problem(step, draft, year = new Date().getFullYear()) {
 const {min, max} = weightRange(draft.unit);
 switch (step.type) {
  case 'weight':
   return parseWeight(draft.weight, draft.unit) === null ? 'Enter a weight between ' + min + ' and ' + max + ' ' + draft.unit + '.' : '';
  case 'height':
   return draft.heightIn >= MIN_HEIGHT_IN && draft.heightIn <= MAX_HEIGHT_IN ? '' : 'Pick a height.';
  case 'year':
   return draft.birthYear >= year - MAX_AGE && draft.birthYear <= year - MIN_AGE ? '' : 'Pick a year between ' + (year - MAX_AGE) + ' and ' + (year - MIN_AGE) + '.';
  case 'sex':
   return draft.sex ? '' : 'Pick one to carry on.';
  case 'activity':
   return draft.activity ? '' : 'Pick the one closest to your week.';
  // A goal is the one answer that may be left out: plenty of people only want to hold steady.
  case 'goal':
   return draft.maintain || parseWeight(draft.goal, draft.unit) !== null ? '' : 'Enter a goal weight, or choose to hold steady.';
  default:
   return '';
 }
}

const profileOf = (draft, year = new Date().getFullYear()) =>
 validProfile({heightIn: draft.heightIn, birthYear: draft.birthYear, sex: draft.sex, activity: draft.activity}, year);


// The numbers the last step shows, and the ones setupPatch saves. null until every answer the
// maths needs is in, so the result step can never show a figure built on a missing answer.
export function outcome(draft, year = new Date().getFullYear()) {
 const profile = profileOf(draft, year);
 const weight = parseWeight(draft.weight, draft.unit);
 if (!profile || weight === null) return null;
 const goal = draft.maintain ? null : parseWeight(draft.goal, draft.unit);
 const result = suggestedAllowance(profile, weight, goal, year);
 if (!result) return null;
 return {...result, weight, goal, protein: proteinTarget(weight, goal), profile};
}

// The two writes setup makes: the synced settings, and today's weigh-in. Returns null rather
// than a half-filled patch when an answer is missing, so a partly-finished flow saves nothing.
export function setupPatch(draft, {date, targets = [], year = new Date().getFullYear()} = {}) {
 const result = outcome(draft, year);
 if (!result || !date) return null;
 return {
  settings: {
   profile: result.profile,
   weightUnit: draft.unit,
   goalWeight: result.goal,
   goalDate: null,
   calorieTargets: withAllowance(targets, targets.length ? date : EARLIEST, result.allowance),
  },
  day: {weight: String(result.weight)},
  allowance: result.allowance,
  protein: result.protein,
 };
}

// Whether there is an allowance at all. This, and not a complete profile, is what decides
// whether the flow is offered: someone who typed their own number before this flow existed has
// a working app, and running setup over them would replace the number they chose.
export const hasAllowance = settings => allowanceOn(settings?.calorieTargets, '9999-12-31') !== null;

// Whether this person has been through setup in full. Both halves matter: a profile with no
// allowance still leaves Today with nothing to show, and an allowance with no profile cannot be
// revised when the weight moves. Used to describe the state, not to decide whether to interrupt.
export const isSetUp = settings => Boolean(validProfile(settings?.profile)) && hasAllowance(settings);
