import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupMeals, sectionOf, loggedHour, kindForHour, typeOf, typeOfEntry} from '../web/meal-sections.mjs';

const DATE = '2026-11-12';
const at = hour => new Date(2026, 10, 12, hour, 15).getTime();
const item = (protein, carbs, fat) => ({name: 'x', protein, carbs, fat});
const meal = (kind, hour, items = [item(10, 10, 0)], unknown = []) => ({id: kind + hour, kind, text: kind, items, unknown, ...(hour === null ? {} : {at: at(hour)})});

test('loggedHour only counts a time on the meal date', () => {
 assert.equal(loggedHour(meal('Lunch', 13), DATE), 13);
 assert.equal(loggedHour(meal('Lunch', 13), '2026-11-11'), null);
 assert.equal(loggedHour(meal('Lunch', null), DATE), null);
});

test('snacks go where their time puts them', () => {
 assert.equal(sectionOf(meal('Snack / drink', 10), DATE), 'Morning snacks');
 assert.equal(sectionOf(meal('Snack / drink', 16), DATE), 'Afternoon snacks');
 assert.equal(sectionOf(meal('Snack / drink', 21), DATE), 'Evening snacks');
 assert.equal(sectionOf(meal('Snack / drink', null), DATE), 'Snacks & drinks');
 assert.equal(sectionOf(meal('Dinner', 9), DATE), 'Dinner');
});

test('groupMeals orders sections by the day and subtotals each', () => {
 const groups = groupMeals([
  meal('Dinner', 20, [item(30, 40, 10)]),
  meal('Snack / drink', 16, [item(2, 20, 5)]),
  meal('Breakfast', 8, [item(20, 30, 10)]),
  meal('Breakfast', 9, [item(5, 0, 0)], ['chai']),
 ], DATE);
 assert.deepEqual(groups.map(g => g.name), ['Breakfast', 'Afternoon snacks', 'Dinner']);
 assert.deepEqual(groups[0].sum, {protein: 25, carbs: 30, fat: 10});
 assert.equal(groups[0].kcal, 25 * 4 + 30 * 4 + 10 * 9);
 assert.equal(groups[0].partial, true);
 assert.equal(groups[2].kcal, 30 * 4 + 40 * 4 + 10 * 9);
 assert.deepEqual(groups[0].entries.map(e => e.at), [at(8), at(9)]);
});

test('kindForHour picks the likely meal', () => {
 assert.equal(kindForHour(8), 'Breakfast');
 assert.equal(kindForHour(13), 'Lunch');
 assert.equal(kindForHour(16), 'Snack / drink');
 assert.equal(kindForHour(20), 'Dinner');
 assert.equal(kindForHour(23), 'Snack / drink');
});

// Colour is a category, not a verdict: the three snack sections share one colour, and a snack
// keeps its own colour wherever the hour files it.
test('each meal type has one colour, and snacks share theirs', () => {
 assert.deepEqual(['Breakfast', 'Lunch', 'Dinner'].map(typeOf), ['breakfast', 'lunch', 'dinner']);
 for (const name of ['Morning snacks', 'Afternoon snacks', 'Evening snacks', 'Snacks & drinks']) {
  assert.equal(typeOf(name), 'snack', name);
 }
 // Every section groupMeals can produce must map to a colour that exists in the stylesheet.
 const css = readFileSync(new URL('../web/design/tokens.css', import.meta.url), 'utf8');
 const groups = groupMeals([meal('Breakfast', 8), meal('Lunch', 13), meal('Dinner', 20), meal('Snack / drink', 16)], DATE);
 for (const group of groups) {
  assert.match(css, new RegExp('--color-meal-' + typeOf(group.name) + ':'), group.name + ' has no colour');
 }
});

test('a snack keeps the snack colour whatever hour it lands in', () => {
 assert.equal(typeOfEntry(meal('Snack / drink', 8)), 'snack');
 assert.equal(typeOfEntry(meal('Breakfast', 8)), 'breakfast');
 // An entry whose kind is something the app no longer offers still gets a colour, not undefined.
 assert.equal(typeOfEntry({kind: 'Brunch'}), 'snack');
 assert.equal(typeOfEntry(undefined), 'snack');
});
