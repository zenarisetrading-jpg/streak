import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {exportedWorkouts, mergeWatchWorkout, placeWatchWorkout, typeOf} from '../worker/watch-workouts.mjs';
import {memoryD1} from './helpers.mjs';

const NOW = new Date('2026-11-13T07:00:00Z');
const walk = {id: '550E8400-E29B-41D4-A716-446655440000', name: 'Indoor Walk', start: '2026-11-13 09:42:10 +0530', end: '2026-11-13 10:27:52 +0530', duration: 2742, activeEnergyBurned: {qty: 425.4, units: 'kcal'}};
const exportBody = workouts => ({data: {workouts}});

test('reads Health Auto Export workouts into sessions for their own day', () => {
 assert.deepEqual(exportedWorkouts(exportBody([walk]), NOW), [{
  key: 'workout:2026-11-13:hae-550e8400-e29b-41d4-a716-446655440000',
  value: {id: 'hae-550e8400-e29b-41d4-a716-446655440000', source: 'watch', title: 'Indoor Walk', type: 'cardio', minutes: 46, kcal: 425, start: '2026-11-13 09:42:10 +0530', exercises: [], text: '', notes: [], watch: {minutes: 46, kcal: 425}},
 }]);
});

test('handles kJ, a missing energy value and the older activeEnergy field', () => {
 const [kj, none, legacy] = exportedWorkouts(exportBody([
  {...walk, id: 'a', activeEnergyBurned: {qty: 1000, units: 'kJ'}},
  {...walk, id: 'b', activeEnergyBurned: undefined},
  {...walk, id: 'c', activeEnergyBurned: undefined, activeEnergy: {qty: 300, units: 'kcal'}},
 ]), NOW);
 assert.equal(kj.value.kcal, 239);
 assert.equal(none.value.kcal, 0);
 assert.equal(legacy.value.kcal, 300);
});

test('skips workouts that are unreadable, too old, in the future or repeated', () => {
 const list = exportedWorkouts(exportBody([
  {...walk, id: 'old', start: '2026-10-01 09:00:00 +0530'},
  {...walk, id: 'future', start: '2026-11-20 09:00:00 +0530'},
  {...walk, id: 'nostart', start: 'soon'},
  {...walk, id: 'zero', duration: 0},
  {...walk, id: 'bad id!'},
  {...walk, id: 'ok'},
  {...walk, id: 'ok'},
  'nonsense',
 ]), NOW);
 assert.deepEqual(list.map(w => w.value.id), ['hae-ok']);
 assert.deepEqual(exportedWorkouts({data: {}}, NOW), []);
 assert.equal(exportedWorkouts({date: '2026-11-13', steps: 5}, NOW), null);
});

test('sorts Watch types into the app types', () => {
 assert.equal(typeOf('Functional Strength Training'), 'strength');
 assert.equal(typeOf('Outdoor Walk'), 'cardio');
 assert.equal(typeOf('High Intensity Interval Training'), 'cardio');
 assert.equal(typeOf('Tennis'), 'sport');
 assert.equal(typeOf('Pilates'), 'mobility');
 assert.equal(typeOf('Cross Training'), 'mixed');
 assert.equal(typeOf('Fishing'), 'other');
});

test('a later upload updates the Watch numbers but keeps what the person added', () => {
 const incoming = exportedWorkouts(exportBody([{...walk, duration: 2400, activeEnergyBurned: {qty: 420, units: 'kcal'}}]), NOW)[0].value;
 const edited = {...incoming, title: 'Easy walk', exercises: [{name: 'Walk', sets: [], unit: 'kg', distanceKm: 3, minutes: 40}], minutes: 30, kcal: 300, watch: {minutes: 30, kcal: 300}};
 assert.deepEqual(mergeWatchWorkout(edited, incoming), {...edited, minutes: 40, kcal: 420, watch: {minutes: 40, kcal: 420}});
 const overridden = {...edited, kcal: 350};
 assert.deepEqual(mergeWatchWorkout(overridden, incoming), {...overridden, minutes: 40, watch: {minutes: 40, kcal: 420}});
});

test('ingest takes a Health Auto Export upload once and never brings back a removed workout', async () => {
 const e = {DB: memoryD1(), DEV_USER_EMAIL: 'me@example.com'};
 const local = (path, opts = {}) => new Request('http://localhost:8787' + path, {...opts, headers: {origin: 'http://localhost:8787', ...opts.headers}});
 const {token} = await (await worker.fetch(local('/api/health-key', {method: 'POST'}), e)).json();
 const start = new Date().toISOString().slice(0, 10) + ' 09:42:10 +0000';
 const body = JSON.stringify(exportBody([{...walk, start, heartRateData: Array.from({length: 300}, (_, i) => ({date: start, Avg: 120 + i % 30}))}]));
 const send = () => worker.fetch(new Request('https://app.example.workers.dev/ingest/health', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body}), e);
 const first = await send();
 assert.equal(first.status, 200);
 assert.deepEqual(await first.json(), {ok: true, workouts: 1});
 assert.equal((await send()).status, 200);
 const records = await (await worker.fetch(local('/api/records'), e)).json();
 const keys = Object.keys(records).filter(k => k.startsWith('workout:'));
 assert.equal(keys.length, 1);
 assert.equal(records[keys[0]].kcal, 425);
 assert.equal(Object.keys(records).some(k => k.startsWith('health:')), false);

 await worker.fetch(local('/api/records', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify([{key: keys[0], value: null}])}), e);
 assert.equal((await send()).status, 200);
 const after = await (await worker.fetch(local('/api/records'), e)).json();
 assert.equal(after[keys[0]], undefined);
});

test('a Watch workout gives its calories to a session of about the same length logged by hand', () => {
 const incoming = exportedWorkouts(exportBody([walk]), NOW)[0];
 const manual = {key: 'workout:2026-11-13:m1', value: {id: 'm1', title: 'Incline treadmill walk', type: 'cardio', minutes: 45, kcal: 330, exercises: [{name: 'cardio'}]}};
 const strength = {key: 'workout:2026-11-13:m2', value: {id: 'm2', title: 'Arms', minutes: 90, kcal: 200, exercises: []}};
 const placed = placeWatchWorkout(incoming, [strength, manual]);
 assert.equal(placed.key, manual.key);
 assert.deepEqual(placed.value, {...manual.value, kcal: 425, watchId: incoming.value.id, watch: {minutes: 46, kcal: 425}});
 const later = {...incoming, value: {...incoming.value, kcal: 440, watch: {minutes: 47, kcal: 440}}};
 assert.deepEqual(placeWatchWorkout(later, [strength, {key: manual.key, value: placed.value}]).value, {...placed.value, kcal: 440, watch: {minutes: 47, kcal: 440}});
 const legs = {key: 'workout:2026-11-13:m3', value: {id: 'm3', title: 'Legs', minutes: 80, kcal: 250, exercises: []}};
 assert.deepEqual(placeWatchWorkout(incoming, [strength, legs]), incoming);
 assert.equal(placeWatchWorkout(incoming, [{key: incoming.key, value: null}, manual]), null);
});

test('a Watch workout with no calories leaves a logged session alone', () => {
 const incoming = exportedWorkouts(exportBody([{...walk, activeEnergyBurned: undefined}]), NOW)[0];
 const manual = {key: 'workout:2026-11-13:m1', value: {id: 'm1', title: 'Walk', minutes: 45, kcal: 330, exercises: []}};
 assert.equal(placeWatchWorkout(incoming, [manual]), null);
});

test('removing a session the Watch was put on keeps it removed, and two workouts never share one session', async () => {
 const e = {DB: memoryD1(), DEV_USER_EMAIL: 'me@example.com'};
 const local = (path, opts = {}) => new Request('http://localhost:8787' + path, {...opts, headers: {origin: 'http://localhost:8787', 'content-type': 'application/json', ...opts.headers}});
 const {token} = await (await worker.fetch(local('/api/health-key', {method: 'POST'}), e)).json();
 const day = new Date().toISOString().slice(0, 10);
 const manualKey = 'workout:' + day + ':m1';
 await worker.fetch(local('/api/records', {method: 'POST', body: JSON.stringify([{key: manualKey, value: {id: 'm1', title: 'Walk', minutes: 45, kcal: 330, exercises: []}}])}), e);
 const start = day + ' 09:42:10 +0000';
 const send = list => worker.fetch(new Request('https://app.example.workers.dev/ingest/health', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: JSON.stringify(exportBody(list))}), e);
 await send([{...walk, start}, {...walk, id: 'second', start: day + ' 18:00:00 +0000', duration: 2700}]);
 let records = await (await worker.fetch(local('/api/records'), e)).json();
 let keys = Object.keys(records).filter(k => k.startsWith('workout:'));
 assert.equal(keys.length, 2);
 assert.equal(records[manualKey].kcal, 425);

 await worker.fetch(local('/api/records', {method: 'POST', body: JSON.stringify([{key: manualKey, value: null}])}), e);
 await send([{...walk, start, duration: 2800}]);
 records = await (await worker.fetch(local('/api/records'), e)).json();
 keys = Object.keys(records).filter(k => k.startsWith('workout:'));
 assert.deepEqual(keys, ['workout:' + day + ':hae-second']);
});

test('a Watch workout cut short goes onto the longer logged session and never lowers its estimate', () => {
 const incoming = exportedWorkouts(exportBody([{...walk, duration: 1200, activeEnergyBurned: {qty: 150, units: 'kcal'}}]), NOW)[0];
 const logged = {key: 'workout:2026-11-13:m1', value: {id: 'm1', title: 'Push day', minutes: 60, kcal: 320, exercises: []}};
 const placed = placeWatchWorkout(incoming, [logged]);
 assert.equal(placed.key, logged.key);
 assert.deepEqual(placed.value, {...logged.value, kcal: 320, watchId: incoming.value.id, watch: {minutes: 20, kcal: 150}});
 assert.equal(placeWatchWorkout(incoming, [{...logged, value: {...logged.value, kcal: 0}}]).value.kcal, 150);
 assert.deepEqual(placeWatchWorkout(incoming, [{...logged, value: {...logged.value, minutes: 5}}]), incoming);
 assert.deepEqual(placeWatchWorkout(incoming, [logged, {...logged, key: 'workout:2026-11-13:m2', value: {...logged.value, id: 'm2'}}]), incoming);
});

test('a cut-short Watch workout makes its own session when the day already has another Watch session', () => {
 const incoming = exportedWorkouts(exportBody([{...walk, duration: 1200, activeEnergyBurned: {qty: 150, units: 'kcal'}}]), NOW)[0];
 const logged = {key: 'workout:2026-11-13:m1', value: {id: 'm1', title: 'Push day', minutes: 60, kcal: 320, exercises: []}};
 const earlier = {key: 'workout:2026-11-13:watch-0600am', value: {id: 'watch-0600am', source: 'watch', minutes: 30, kcal: 200, exercises: []}};
 assert.deepEqual(placeWatchWorkout(incoming, [logged, earlier]), incoming);
});
