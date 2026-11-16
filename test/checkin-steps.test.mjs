import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FEEL_QUESTIONS, STEPS, SCALE, isAnswered, answeredCount, isComplete, nextStep, describeFeel} from '../web/checkin-steps.mjs';
import {FEEL_FIELDS, FEEL_MIN, FEEL_MAX} from '../web/recovery.mjs';

const full = {mood: 4, energy: 3, sleepQuality: 4, soreness: 2, weight: '172', kind: 'Workday'};
const keyOf = step => step?.key ?? null;

test('the questions the screens ask are the ones the score reads', () => {
 assert.deepEqual([...FEEL_QUESTIONS.map(q => q.key)].sort(), [...FEEL_FIELDS].sort());
 // Every question needs the parts both screens rely on.
 for (const question of FEEL_QUESTIONS) {
  assert.ok(question.label && question.question && question.icon, question.key);
  assert.equal(question.ends.length, 2, question.key);
 }
});

test('the scale runs the whole range', () => {
 assert.deepEqual(SCALE, [1, 2, 3, 4, 5]);
 assert.equal(SCALE[0], FEEL_MIN);
 assert.equal(SCALE.at(-1), FEEL_MAX);
});

test('a question counts as answered only when the answer is usable', () => {
 const mood = STEPS.find(step => step.key === 'mood');
 for (const value of [1, 5, '3']) assert.equal(isAnswered({mood: value}, mood), true, String(value));
 for (const value of [0, 6, 2.5, '', null, undefined, 'x', true]) assert.equal(isAnswered({mood: value}, mood), false, String(value));
});

test('weight and day type have their own idea of answered', () => {
 const weight = STEPS.find(step => step.key === 'weight');
 const kind = STEPS.find(step => step.key === 'kind');
 assert.equal(isAnswered({weight: '172'}, weight), true);
 assert.equal(isAnswered({weight: '0'}, weight), false);
 assert.equal(isAnswered({weight: ''}, weight), false);
 assert.equal(isAnswered({kind: 'Travel'}, kind), true);
 assert.equal(isAnswered({kind: '   '}, kind), false, 'blanks are not an answer');
 assert.equal(isAnswered({}, kind), false);
});

test('the questions are asked in order, skipping the ones already answered', () => {
 assert.equal(keyOf(nextStep({})), 'mood');
 assert.equal(keyOf(nextStep({mood: 4})), 'energy');
 assert.equal(keyOf(nextStep({mood: 4, energy: 3, sleepQuality: 4, soreness: 2})), 'weight');
 assert.equal(keyOf(nextStep({...full, kind: ''})), 'kind');
 assert.equal(nextStep(full), null, 'nothing left to ask');
});

test('a question put off is passed over, and the rest carry on', () => {
 assert.equal(keyOf(nextStep({}, new Set(['mood']))), 'energy');
 assert.equal(keyOf(nextStep({}, new Set(['mood', 'energy', 'sleepQuality', 'soreness']))), 'weight');
 assert.equal(nextStep({}, new Set(STEPS.map(step => step.key))), null, 'everything put off');
 // Putting one off does not mark it answered.
 assert.equal(answeredCount({}, new Set(['mood'])), 0);
});

test('a day is only complete when every step has an answer', () => {
 assert.equal(isComplete(full), true);
 assert.equal(answeredCount(full), STEPS.length);
 assert.equal(isComplete({...full, kind: ''}), false);
 assert.equal(isComplete({...full, weight: '0'}), false);
 assert.equal(isComplete({}), false);
 assert.equal(answeredCount({mood: 4, weight: '172'}), 2);
});

test('a stray record never throws', () => {
 for (const entry of [{}, {mood: null}, {weight: 'x'}]) {
  assert.doesNotThrow(() => isComplete(entry));
  assert.doesNotThrow(() => nextStep(entry));
 }
});

test('the wording says which way an answer leans, never overstating it', () => {
 const ends = ['None', 'Very'];
 assert.equal(describeFeel(1, ends), 'None');
 assert.equal(describeFeel(5, ends), 'Very');
 assert.equal(describeFeel(3, ends), 'Right in the middle');
 // The bug this guards: 2 is not "none".
 assert.equal(describeFeel(2, ends), 'Closer to none');
 assert.equal(describeFeel(4, ends), 'Closer to very');
});
