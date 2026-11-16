// The daily check-in's questions, and the rules for which one to ask next.
// One list, used by the prompt at the top of Today and by the summary lower down, so the two
// can never drift apart in wording or order. Pure functions only, so the rules can be tested
// without a browser.
import {FEEL_MIN, FEEL_MAX, isFeelValue} from './recovery.mjs';

export const FEEL_QUESTIONS = [
 {key: 'mood', label: 'Mood', question: 'How is your mood?', ends: ['Low', 'Great'], icon: 'mood'},
 {key: 'energy', label: 'Energy', question: 'How is your energy?', ends: ['Drained', 'Full'], icon: 'bolt'},
 {key: 'sleepQuality', label: 'Sleep quality', question: 'How did you sleep?', ends: ['Poor', 'Deep'], icon: 'moon'},
 {key: 'soreness', label: 'Soreness', question: 'How sore do you feel?', ends: ['None', 'Very'], icon: 'ache'},
];

// The two that are not a 1-5 scale. Weight and day type already live on the day's record.
export const STEPS = [
 ...FEEL_QUESTIONS.map(question => ({...question, type: 'scale'})),
 {key: 'weight', type: 'weight', question: 'Step on the scales?', label: 'Weight'},
 {key: 'kind', type: 'choice', question: 'What kind of day is it?', label: 'Day type'},
];

export const SCALE = Array.from({length: FEEL_MAX - FEEL_MIN + 1}, (_, i) => FEEL_MIN + i);
const MIDDLE = (FEEL_MIN + FEEL_MAX) / 2;

export function isAnswered(entry, step) {
 const value = entry?.[step.key];
 if (step.type === 'scale') return isFeelValue(value);
 if (step.type === 'weight') return Number(value) > 0;
 return Boolean(String(value ?? '').trim());
}

export const answeredCount = entry => STEPS.filter(step => isAnswered(entry, step)).length;
export const isComplete = entry => STEPS.every(step => isAnswered(entry, step));
// The first question still unanswered and not put off in this sitting.
export const nextStep = (entry, later = new Set()) => STEPS.find(step => !isAnswered(entry, step) && !later.has(step.key)) ?? null;

// Only the ends of the scale earn the end word; the ones between say which way they lean, so a
// soreness of 2 reads "closer to none" rather than claiming it was none at all.
export const describeFeel = (value, ends) => value === FEEL_MIN ? ends[0]
 : value === FEEL_MAX ? ends[1]
 : value === MIDDLE ? 'Right in the middle'
 : 'Closer to ' + (value < MIDDLE ? ends[0] : ends[1]).toLowerCase();

export const scaleLabel = (label, value, ends) => label + ': ' + value + ' of ' + FEEL_MAX + ', ' + describeFeel(value, ends).toLowerCase();
