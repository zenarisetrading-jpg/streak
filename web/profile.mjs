// Starting estimates from the About you details: maintenance calories (Mifflin–St Jeor
// times an activity factor), a suggested allowance for the weight goal, and a protein target.
// Once two weeks of meals and weigh-ins exist, the measured maintenance on Analytics is better.
export const ACTIVITY = {
 sedentary: {factor: 1.2, label: 'Mostly sitting'},
 light: {factor: 1.375, label: 'Lightly active (walks, 1–3 workouts a week)'},
 moderate: {factor: 1.55, label: 'Active (3–5 workouts a week)'},
 very: {factor: 1.725, label: 'Very active (daily training or physical job)'},
};
// How the four levels are shown. The wording lives beside the factors it labels, so the setup
// flow and the Settings card cannot end up describing the same level differently.
export const ACTIVITY_TILES = {
 sedentary: {emoji: '\u{1F6CB}\uFE0F', title: 'Mostly sitting', detail: 'Desk days, little walking'},
 light: {emoji: '\u{1F6B6}', title: 'Lightly active', detail: 'Walks, 1\u20133 workouts'},
 moderate: {emoji: '\u{1F3C3}', title: 'Active', detail: '3\u20135 workouts a week'},
 very: {emoji: '\u{1F525}', title: 'Very active', detail: 'Daily training or on your feet'},
};

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const LOSS_DEFICIT = 500; // about 1 lb a week
const GAIN_SURPLUS = 250;
const MIN_ALLOWANCE = {male: 1500, female: 1200};
const PROTEIN_G_PER_LB = 0.8;
const ROUND_TO = 50;

const round = (n, step) => Math.round(n / step) * step;

// Returns null unless every detail is present and plausible.
export function validProfile(p, year = new Date().getFullYear()) {
 const heightIn = Number(p?.heightIn), birthYear = Number(p?.birthYear);
 if (!(heightIn >= 48 && heightIn <= 96)) return null;
 if (!(birthYear >= year - 100 && birthYear <= year - 13)) return null;
 if (!['male', 'female'].includes(p?.sex) || !ACTIVITY[p?.activity]) return null;
 return {heightIn, birthYear, sex: p.sex, activity: p.activity};
}

// Basal metabolic rate: what the body burns at rest (Mifflin–St Jeor).
function bmr(profile, weightLb, year = new Date().getFullYear()) {
 const p = validProfile(profile, year);
 if (!p || !(weightLb > 0)) return null;
 const age = year - p.birthYear;
 return Math.round(10 * weightLb * KG_PER_LB + 6.25 * p.heightIn * CM_PER_IN - 5 * age + (p.sex === 'male' ? 5 : -161));
}

export function maintenanceEstimate(profile, weightLb, year = new Date().getFullYear()) {
 const rest = bmr(profile, weightLb, year);
 return rest === null ? null : round(rest * ACTIVITY[profile.activity].factor, ROUND_TO);
}

// Allowance for the goal: a ~1 lb/week deficit to lose, a small surplus to gain, never below a safe floor.
export function suggestedAllowance(profile, weightLb, goalLb, year = new Date().getFullYear()) {
 const maintenance = maintenanceEstimate(profile, weightLb, year);
 if (maintenance === null) return null;
 const direction = goalLb > 0 && Math.abs(goalLb - weightLb) >= 1 ? Math.sign(goalLb - weightLb) : 0;
 const raw = direction < 0 ? maintenance - LOSS_DEFICIT : direction > 0 ? maintenance + GAIN_SURPLUS : maintenance;
 return {bmr: bmr(profile, weightLb, year), factor: ACTIVITY[profile.activity].factor, maintenance, allowance: Math.max(MIN_ALLOWANCE[profile.sex], round(raw, ROUND_TO)), direction};
}

// Protein per day from the goal weight (or current weight without a goal).
export function proteinTarget(weightLb, goalLb) {
 const basis = goalLb > 0 ? goalLb : weightLb;
 return basis > 0 ? Math.round(basis * PROTEIN_G_PER_LB / 5) * 5 : null;
}

export const ageOf = (profile, year = new Date().getFullYear()) => validProfile(profile, year) ? year - Number(profile.birthYear) : null;

// Daily macro targets for an allowance: protein from the goal weight (or 25% of calories without one),
// fat at 30% of calories, and carbs filling the rest.
const FAT_SHARE = 0.3;
const FALLBACK_PROTEIN_SHARE = 0.25;
export function macroTargets(allowance, proteinG = null) {
 if (!(allowance > 0)) return null;
 const protein = proteinG > 0 ? proteinG : Math.round(allowance * FALLBACK_PROTEIN_SHARE / 4);
 const fat = Math.round(allowance * FAT_SHARE / 9);
 const carbs = Math.max(0, Math.round((allowance - protein * 4 - fat * 9) / 4));
 return {protein, carbs, fat};
}

// Where an amount sits against its target. Within 10% counts as on target.
// Protein below target is the concern; for carbs and fat it is going over.
const TOLERANCE = 0.1;
export function macroStatus(key, actual, target) {
 if (!(target > 0)) return null;
 const ratio = actual / target;
 const level = ratio < 1 - TOLERANCE ? 'under' : ratio > 1 + TOLERANCE ? 'over' : 'on';
 const concern = key === 'protein' ? level === 'under' : level === 'over';
 return {level, concern, ratio: Math.round(ratio * 100) / 100};
}
