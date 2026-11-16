import {test} from 'node:test';
import assert from 'node:assert/strict';

// Same stubs as store-day.test.mjs: store.mjs only touches the DOM inside functions.
globalThis.localStorage = {data: {}, getItem(key) { return key in this.data ? this.data[key] : null; }, setItem(key, value) { this.data[key] = String(value); }};
globalThis.window = {trackerWrite: () => {}, dispatchEvent: () => {}, addEventListener: () => {}};
globalThis.Event = class { constructor(type) { this.type = type; } };

const {displayName} = await import('../web/store.mjs');

// The bug this guards: the greeting used to be a hardcoded map of two addresses to two names, so
// everyone else in the world was greeted by their raw email local-part, or by nothing at all.
test('the greeting is read out of the address, whoever signs in', () => {
 assert.equal(displayName('sam.taylor@example.com'), 'Sam');
 assert.equal(displayName('sam@example.com'), 'Sam');
 assert.equal(displayName('sam_taylor@example.com'), 'Sam');
 assert.equal(displayName('sam-taylor@example.com'), 'Sam');
 assert.equal(displayName('sam+groceries@example.com'), 'Sam');
});

test('a name that is already capitalised is left as it was typed', () => {
 assert.equal(displayName('McDonald@example.com'), 'McDonald');
 assert.equal(displayName('J@example.com'), 'J');
});

// A half-loaded session, a signed-out one, or an address the app cannot make sense of must leave
// the header saying plain "Hi" rather than throwing on the way to rendering it.
test('nothing to go on is an empty name, never an error', () => {
 for (const value of ['', null, undefined, '@example.com', '...@example.com']) {
  assert.doesNotThrow(() => displayName(value), String(value));
 }
 assert.equal(displayName(''), '');
 assert.equal(displayName(null), '');
 assert.equal(displayName('@example.com'), '');
});
