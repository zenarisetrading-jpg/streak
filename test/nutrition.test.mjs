import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimate} from '../web/nutrition.mjs';

const first = text => estimate(text).items[0];
const grams = text => Number(/~?(\d+(?:\.\d+)?)\s*g/.exec(first(text)?.assumption)?.[1] ?? NaN);

// The bug this guards: "pieces" multiplied the default serving, so three tikka cubes were read
// as three 100 g servings — nine times the protein actually eaten.
test('counting pieces counts pieces, not servings', () => {
 assert.equal(grams('3 pieces chicken tikka'), 33);
 assert.ok(first('3 pieces chicken tikka').protein < 12, 'about 10 g of protein, not 87');
 assert.equal(grams('2 pieces paneer'), 50);
});

test('a tikka piece and a whole breast are not the same piece', () => {
 // They used to share one row, so a piece of either weighed the same.
 assert.equal(grams('1 piece chicken tikka'), 11);
 assert.equal(grams('1 piece chicken breast'), 110);
});

test('naming a food without a count still gives a sensible serving', () => {
 assert.equal(grams('chicken tikka'), 110, 'a serving, not a single cube');
 assert.equal(grams('chicken breast'), 110);
});

test('an explicit weight always wins', () => {
 assert.equal(grams('200 g chicken tikka'), 200);
 assert.equal(grams('250g rice'), 250);
 assert.ok(first('200 g chicken tikka').protein > 55, 'macros follow the stated weight');
});

test('foods already counted in pieces are unchanged', () => {
 assert.equal(grams('3 pieces samosa'), 270);
 assert.equal(grams('2 rotis'), 80);
 assert.equal(grams('2 idlis'), 100);
});

test('cooked weights line up with a 450 g pack of three breasts', () => {
 // 450 g pack = 3 breasts = ~150 g raw each; ten pieces each; ~30% lost in the tandoor.
 const rawPerPiece = 450 / 3 / 10;
 const cookedPerPiece = grams('1 piece chicken tikka');
 assert.ok(Math.abs(cookedPerPiece - rawPerPiece * 0.7) < 2, cookedPerPiece + ' vs ' + (rawPerPiece * 0.7).toFixed(1));
});
