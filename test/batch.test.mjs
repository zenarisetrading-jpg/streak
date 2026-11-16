import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shareFactor, splitBatch, shareLabel, MAX_SERVINGS} from '../web/batch.mjs';
import {scaleHousehold, rescale} from '../web/portion.mjs';

// 2.5 cups of raw basmati, cooked for four people across lunch and dinner.
const pot = [
 {name: 'Basmati rice (dry)', assumption: '2.5 cups dry (~460 g)', grams: 460, protein: 34, carbs: 359, fat: 3},
 {name: 'Mutton', assumption: '1 kg bone-in (~1000 g)', grams: 1000, protein: 180, carbs: 0, fat: 120},
];

test('one plate is the pot divided by the plates it served', () => {
 assert.equal(shareFactor(8), 0.125);
 const [rice, mutton] = splitBatch(pot, 8);
 assert.equal(rice.grams, 58, '460 g of dry rice across eight plates');
 assert.equal(mutton.grams, 125);
 // 58 g, not the exact 57.5, so the macros follow the weight actually shown rather than
 // drifting from it by a fraction of a gram.
 assert.equal(rice.carbs, 45.3);
 assert.ok(Math.abs(rice.carbs / rice.grams - pot[0].carbs / pot[0].grams) < 0.001, 'same carbs per gram as the pot');
});

test('going back for seconds takes two shares', () => {
 assert.equal(shareFactor(8, 2), 0.25);
 assert.equal(splitBatch(pot, 8, 2)[0].grams, 115);
});

test('numbers that do not describe a share leave the meal untouched', () => {
 for (const [made, ate] of [[0, 1], [-4, 1], ['', 1], [8, 0], [8, 9], [MAX_SERVINGS + 1, 1], ['x', 1]]) {
  assert.equal(shareFactor(made, ate), null, made + '/' + ate);
  assert.deepEqual(splitBatch(pot, made, ate), pot, 'a half-typed count must not shrink the meal');
 }
});

test('the whole pot to one person is the whole pot', () => {
 assert.equal(shareFactor(1, 1), 1);
 assert.deepEqual(splitBatch(pot, 1, 1), pot);
});

test('the share is spelled out for the log', () => {
 assert.equal(shareLabel(8), 'Your share: 1 of 8 servings');
 assert.equal(shareLabel(8, 2), 'Your share: 2 of 8 servings');
 assert.equal(shareLabel(1), 'Your share: 1 of 1 serving');
 assert.equal(shareLabel(0), '');
});

// The bug this guards: correcting a weight left the household count beside it untouched, so a
// logged meal read "About 1.5 cups cooked rice (~120 g)" — and 1.5 cups is 237 g, not 120 g.
test('correcting a weight scales the household count with it', () => {
 const item = {name: 'Biryani rice', assumption: 'About 1.5 cups cooked rice (~250 g)', grams: 250, protein: 8, carbs: 70, fat: 5};
 assert.equal(rescale(item, 120).assumption, 'About 0.7 cups cooked rice (~120 g)');
 assert.equal(scaleHousehold('About 3 tablespoons, mostly onion with curd', 0.5), 'About 1.5 tablespoons, mostly onion with curd');
});

test('counted things stay countable', () => {
 assert.equal(scaleHousehold('2 rotis', 0.5), '1 roti', 'and never "1 rotis"');
 assert.equal(scaleHousehold('3 pieces', 2), '6 pieces');
 assert.equal(scaleHousehold('4 pieces', 0.3), '1 piece', 'rounded to the nearest half');
 assert.equal(scaleHousehold('1 piece', 0.1), '', 'a count that rounds away is dropped, not shown as zero');
});

test('a description with no household count is left alone', () => {
 assert.equal(scaleHousehold('a small bowl', 0.5), 'a small bowl');
 assert.equal(scaleHousehold('250 g', 0.5), '250 g', 'weights are handled separately');
 assert.equal(scaleHousehold('2 rotis', 1), '2 rotis');
});

// The parser writes counts as "2.5 × cup", so the scaler has to see past the sign — without
// this, a pot divided eight ways still claimed 2.5 cups on the plate.
test('a count written with a multiplication sign still scales', () => {
 assert.equal(scaleHousehold('2.5 × cup (~463 g)', 0.125), '0.3 × cup (~463 g)');
 assert.equal(scaleHousehold('3 x pieces', 2), '6 x pieces');
});
