import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validProfile, maintenanceEstimate, suggestedAllowance, proteinTarget, ageOf, macroTargets, macroStatus} from '../web/profile.mjs';

const me = {heightIn: 70, birthYear: 1986, sex: 'male', activity: 'light'};

test('profile must be complete and plausible', () => {
 assert.ok(validProfile(me, 2026));
 assert.equal(validProfile({...me, heightIn: 20}, 2026), null);
 assert.equal(validProfile({...me, birthYear: 2020}, 2026), null);
 assert.equal(validProfile({...me, sex: ''}, 2026), null);
 assert.equal(validProfile({...me, activity: 'couch'}, 2026), null);
 assert.equal(ageOf(me, 2026), 40);
});

test('maintenance and allowance follow Mifflin-St Jeor and the goal', () => {
 // 238 lb = 107.95 kg, 70 in = 177.8 cm, age 40: BMR 1079.5 + 1111.25 - 200 + 5 = 1995.7; x1.375 = 2744
 assert.equal(maintenanceEstimate(me, 238, 2026), 2750);
 assert.deepEqual(suggestedAllowance(me, 238, 228, 2026), {bmr: 1996, factor: 1.375, maintenance: 2750, allowance: 2250, direction: -1});
 assert.equal(suggestedAllowance(me, 238, null, 2026).allowance, 2750);
 assert.equal(suggestedAllowance({...me, sex: 'female', heightIn: 60, activity: 'sedentary'}, 110, 100, 2026).allowance, 1200);
 assert.equal(maintenanceEstimate(me, null, 2026), null);
});

test('protein target uses the goal weight', () => {
 assert.equal(proteinTarget(238, 228), 180);
 assert.equal(proteinTarget(150, null), 120);
 assert.equal(proteinTarget(null, null), null);
});

test('macro targets fill the allowance and flag the right direction', () => {
 // 2,250 kcal with 180 g protein: fat 75 g (675 kcal), carbs (2250 - 720 - 675) / 4 = 214 g
 assert.deepEqual(macroTargets(2250, 180), {protein: 180, carbs: 214, fat: 75});
 assert.deepEqual(macroTargets(2000), {protein: 125, carbs: 224, fat: 67});
 assert.equal(macroTargets(null), null);
 assert.deepEqual(macroStatus('protein', 120, 180), {level: 'under', concern: true, ratio: 0.67});
 assert.deepEqual(macroStatus('fat', 95, 75), {level: 'over', concern: true, ratio: 1.27});
 assert.deepEqual(macroStatus('fat', 50, 75), {level: 'under', concern: false, ratio: 0.67});
 assert.equal(macroStatus('carbs', 210, 214).level, 'on');
 assert.equal(macroStatus('carbs', 210, 0), null);
});
