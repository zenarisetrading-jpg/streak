import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recentMeals, recentWorkouts, scaleItems, shortLabel} from '../web/recent.mjs';

const item = (name, grams, protein, carbs, fat) => ({name, assumption: grams ? grams + ' g' : '1 cup', ...(grams ? {grams} : {}), protein, carbs, fat});
const meal = (id, kind, text, at, items = [item('oats', 50, 6, 30, 3)]) => ({id, kind, text, at, items, unknown: []});

test('recentMeals lists each meal once, newest first, up to the chosen day', () => {
 const data = {
  '2026-11-10': [meal('a', 'Breakfast', 'Oats with milk', 1)],
  '2026-11-11': [meal('b', 'Breakfast', 'oats  with milk', 2), meal('c', 'Lunch', 'Chicken rice', 3)],
  '2026-11-12': [meal('d', 'Dinner', 'Dal and roti', 4)],
 };
 const list = recentMeals(data, {upTo: '2026-11-13'});
 assert.deepEqual(list.map(m => m.id), ['d', 'c', 'b']);
 assert.equal(list[2].date, '2026-11-11');
});

test('recentMeals puts the chosen meal time first and skips empty or future entries', () => {
 const data = {
  '2026-11-11': [meal('a', 'Breakfast', 'Oats', 1), meal('b', 'Lunch', 'Rice', 2), meal('e', 'Lunch', 'Nothing', 3, [])],
  '2026-11-14': [meal('f', 'Breakfast', 'Eggs', 5)],
 };
 assert.deepEqual(recentMeals(data, {upTo: '2026-11-13', kind: 'Breakfast'}).map(m => m.id), ['a', 'b']);
});

test('recentMeals includes earlier meals from the same day and caps the list', () => {
 const data = {'2026-11-13': [meal('a', 'Breakfast', 'Tea', 1)]};
 for (let i = 0; i < 12; i++) data['2026-10-' + String(10 + i)] = [meal('m' + i, 'Lunch', 'Meal ' + i, i)];
 const list = recentMeals(data, {upTo: '2026-11-13', limit: 5});
 assert.equal(list.length, 5);
 assert.equal(list[0].id, 'a');
});

test('scaleItems multiplies macros and grams', () => {
 const [oats, milk] = scaleItems([item('oats', 50, 6, 30, 3), item('milk', null, 8, 12, 5)], 1.5);
 assert.deepEqual([oats.grams, oats.protein, oats.carbs, oats.fat], [75, 9, 45, 4.5]);
 assert.equal(oats.assumption, '75 g');
 assert.deepEqual([milk.protein, milk.carbs, milk.fat], [12, 18, 7.5]);
 assert.equal(milk.grams, undefined);
 assert.deepEqual(scaleItems([item('oats', 50, 6, 30, 3)], 1)[0].grams, 50);
});

test('recentWorkouts lists each session once by title, newest first', () => {
 const w = (id, title, exercises = [{name: 'Bench', sets: [{reps: 8, weight: 135}], unit: 'lb'}]) => ({id, title, type: 'strength', minutes: 45, kcal: 300, exercises});
 const data = {
  '2026-11-10': [w('a', 'Push day')],
  '2026-11-11': [w('b', 'Leg day'), w('c', 'push day')],
  '2026-11-14': [w('d', 'Future')],
 };
 assert.deepEqual(recentWorkouts(data, {upTo: '2026-11-13'}).map(x => x.id), ['c', 'b']);
});

test('shortLabel trims long names on a word', () => {
 assert.equal(shortLabel('Oats with milk'), 'Oats with milk');
 assert.equal(shortLabel('Two eggs scrambled with butter, toast and a cup of masala chai', 30), 'Two eggs scrambled with…');
});
