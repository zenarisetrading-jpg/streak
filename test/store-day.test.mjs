import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';

// store.mjs only touches the DOM inside functions, so a couple of stubs are enough to test the
// one place every screen writes a day record.
const written = [];
globalThis.localStorage = {
 data: {},
 getItem(key) { return key in this.data ? this.data[key] : null; },
 setItem(key, value) { this.data[key] = String(value); },
};
globalThis.window = {trackerWrite: (key, value) => written.push([key, value]), dispatchEvent: () => {}, addEventListener: () => {}};
globalThis.Event = class { constructor(type) { this.type = type; } };

const {saveDay, KEYS, read} = await import('../web/store.mjs');

const seed = days => { localStorage.data[KEYS.days] = JSON.stringify(days); };
beforeEach(() => { localStorage.data = {}; written.length = 0; });

test('saving part of a day keeps everything else on it', () => {
 seed({'2026-11-13': {mood: 4, energy: 3, weight: '172', kind: 'Workday', note: 'long day'}});
 const entry = saveDay('2026-11-13', {soreness: 2});
 assert.deepEqual(entry, {mood: 4, energy: 3, weight: '172', kind: 'Workday', note: 'long day', soreness: 2});
 assert.deepEqual(read(KEYS.days)['2026-11-13'], entry);
});

// The bug this guards: the weight form used to write every field it had on screen, so saving a
// note with a stale blank form wiped a weight the prompt had just saved.
test('one screen saving a field cannot blank what another screen saved', () => {
 seed({'2026-11-13': {}});
 saveDay('2026-11-13', {weight: '180', kind: 'Workday'});   // the prompt at the top
 const entry = saveDay('2026-11-13', {note: 'family dinner'}); // the form lower down
 assert.equal(entry.weight, '180');
 assert.equal(entry.kind, 'Workday');
 assert.equal(entry.note, 'family dinner');
});

test('an empty value clears a field on purpose', () => {
 seed({'2026-11-13': {mood: 4, weight: '172'}});
 const entry = saveDay('2026-11-13', {weight: ''});
 assert.equal(entry.weight, '');
 assert.equal(entry.mood, 4, 'and leaves the rest alone');
});

test('other days are untouched', () => {
 seed({'2026-11-12': {mood: 2}, '2026-11-13': {mood: 5}});
 saveDay('2026-11-13', {energy: 4});
 assert.deepEqual(read(KEYS.days)['2026-11-12'], {mood: 2});
});

test('a day with no record yet is created', () => {
 const entry = saveDay('2026-11-13', {mood: 5});
 assert.deepEqual(entry, {mood: 5});
});

test('every save is handed to sync under the day key', () => {
 seed({});
 saveDay('2026-11-13', {mood: 5});
 assert.deepEqual(written, [['day:2026-11-13', {mood: 5}]]);
});
