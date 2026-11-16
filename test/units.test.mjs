import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unitOf, toUnit, fromUnit, weightText, weightChange, weightRange, inputValue, parseWeight, heightText} from '../web/units.mjs';

test('the unit defaults to lb', () => {
 assert.equal(unitOf({}), 'lb');
 assert.equal(unitOf(null), 'lb');
 assert.equal(unitOf({weightUnit: 'kg'}), 'kg');
 assert.equal(unitOf({weightUnit: 'stone'}), 'lb');
});

test('converts between pounds and kilograms', () => {
 assert.equal(toUnit(100, 'lb'), 100);
 assert.equal(Math.round(toUnit(220.46, 'kg') * 10) / 10, 100);
 assert.equal(fromUnit(100, 'kg'), 220.46);
 assert.equal(fromUnit(185.3, 'lb'), 185.3);
});

test('a kg value typed in shows the same value back', () => {
 for (const kg of ['72.5', '80', '103.4', '55.1']) assert.equal(inputValue(parseWeight(kg, 'kg'), 'kg'), kg);
 assert.equal(inputValue('185.2', 'lb'), '185.2');
 assert.equal(inputValue('', 'kg'), '');
});

test('formats weights and changes in the chosen unit', () => {
 assert.equal(weightText(228, 'lb'), '228 lb');
 assert.equal(weightText(228, 'kg'), '103.4 kg');
 assert.equal(weightChange(-2.2046, 'kg'), '−1.0 kg');
 assert.equal(weightChange(1.25, 'lb'), '+1.3 lb');
 assert.equal(weightChange(0, 'kg'), '0.0 kg');
});

test('checks typed weights against the range in that unit', () => {
 assert.deepEqual(weightRange('lb'), {min: 50, max: 700});
 assert.deepEqual(weightRange('kg'), {min: 23, max: 317});
 assert.equal(parseWeight('20', 'kg'), null);
 assert.equal(parseWeight('72,5', 'kg'), fromUnit(72.5, 'kg'));
 assert.equal(parseWeight('180', 'lb'), 180);
 assert.equal(parseWeight('abc', 'lb'), null);
});

test('height in cm only for kg', () => {
 assert.equal(heightText(70, 'kg'), '178 cm');
 assert.equal(heightText(70, 'lb'), null);
});
