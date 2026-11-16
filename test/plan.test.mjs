import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restOfDayPlan} from '../web/plan.mjs';

const targets = {protein: 180, carbs: 214, fat: 75};

test('splits what is left across the meals still to come and names the gap', () => {
 const plan = restOfDayPlan({eaten: 900, allowance: 2300, sum: {protein: 30, carbs: 220, fat: 30}, targets, hour: 13, meals: 2});
 assert.equal(plan.title, 'Plan for the rest of today');
 assert.equal(plan.lines[0], 'About 2 meals left, around 700 kcal and 75 g protein each.');
 assert.match(plan.lines[1], /^Protein is the gap: 30 of 180 g/);
 assert.match(plan.lines[2], /^Carbs are covered \(220 of 214 g\)/);
});

test('one meal left in the evening, fat nearly used', () => {
 const plan = restOfDayPlan({eaten: 1800, allowance: 2300, sum: {protein: 170, carbs: 100, fat: 70}, targets, hour: 19, meals: 3});
 assert.equal(plan.lines[0], 'About 1 meal left, around 500 kcal.');
 assert.match(plan.lines[1], /^Protein is on track/);
 assert.match(plan.lines[2], /^Fat is nearly used up/);
});

test('over, nearly done and no allowance', () => {
 assert.equal(restOfDayPlan({eaten: 2500, allowance: 2300, sum: {}, targets, hour: 20, meals: 3}).title, '200 kcal over today');
 assert.equal(restOfDayPlan({eaten: 2100, allowance: 2300, sum: {protein: 180, carbs: 0, fat: 0}, targets, hour: 20, meals: 3}).title, 'Nearly at your allowance');
 assert.equal(restOfDayPlan({eaten: 0, allowance: null, sum: {}, targets: null, hour: 9, meals: 0}).title, 'Set your daily allowance');
 assert.match(restOfDayPlan({eaten: 0, allowance: 2300, sum: {protein: 0, carbs: 0, fat: 0}, targets, hour: 8, meals: 0}).lines[0], /^Today: about 3 meals left, around 770 kcal and 60 g protein each\./);
});
