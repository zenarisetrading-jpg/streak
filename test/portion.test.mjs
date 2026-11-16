import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gramsIn, withGrams, itemGrams, rescale} from '../web/portion.mjs';

test('reads and rewrites the gram amount in a portion', () => {
 assert.equal(gramsIn('1 bowl (~180 g)'), 180);
 assert.equal(gramsIn('250ml glass'), 250);
 assert.equal(gramsIn('2 rotis'), null);
 assert.equal(withGrams('1 bowl (~180 g)', 150), '1 bowl (~150 g)');
 assert.equal(withGrams('2 rotis', 80), '2 rotis (80 g)');
 assert.equal(itemGrams({grams: 0, assumption: '1 cup (200 g)'}), 200);
});

test('changing the weight rescales the macros proportionally', () => {
 const curry = {name: 'Chicken curry', assumption: '1 bowl (~180 g)', grams: 180, protein: 27, carbs: 9, fat: 18};
 assert.deepEqual(rescale(curry, 150), {name: 'Chicken curry', assumption: '1 bowl (~150 g)', grams: 150, protein: 22.5, carbs: 7.5, fat: 15});
 // Older saved items have the weight only in the text.
 assert.equal(rescale({assumption: '200 g', protein: 10, carbs: 20, fat: 4}, 100).carbs, 10);
 // Without a known weight there is nothing to scale from, so only the weight is recorded.
 assert.deepEqual(rescale({assumption: '2 rotis', protein: 6, carbs: 38, fat: 2}, 80), {assumption: '2 rotis (80 g)', grams: 80, protein: 6, carbs: 38, fat: 2});
 assert.equal(rescale(curry, 0), curry);
});

test('reads kilograms, grams spelled out and litres', () => {
 assert.equal(gramsIn('0.2 kg chicken'), 200);
 assert.equal(gramsIn('1,5 kg rice'), 1500);
 assert.equal(gramsIn('150 gm paneer'), 150);
 assert.equal(gramsIn('150 grams paneer'), 150);
 assert.equal(gramsIn('180gms'), 180);
 assert.equal(gramsIn('0.5 l milk'), 500);
 assert.equal(gramsIn('2 large eggs'), null);
 assert.equal(gramsIn('2 good rotis'), null);
 assert.equal(withGrams('0.2 kg chicken', 150), '150 g chicken');
 assert.equal(withGrams('0.5 litre milk', 300), '300 ml milk');
 assert.equal(withGrams('150 grams paneer', 100), '100 g paneer');
});
