import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWorkout, toWorkout, WORKOUT_SCHEMA} from '../worker/workout.mjs';
import {MODEL} from '../worker/meal-photo.mjs';
import {memoryD1} from './helpers.mjs';

const envWith = extra => ({DB: memoryD1(), ANTHROPIC_API_KEY: 'sk-test', ...extra});
const request = body => new Request('https://app.test/api/workout-estimate', {method: 'POST', body: JSON.stringify(body)});
const reply = output => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(output)}]});
const fakeClient = (result, calls = []) => apiKey => ({beta: {messages: {create: async params => { calls.push({apiKey, params}); if (result instanceof Error) throw result; return result; }}}});
const PUSH = {
 is_workout: true, summary: 'Push day', type: 'strength', duration_min: 55, kcal: 310, intensity: 'moderate',
 exercises: [
  {name: 'Bench press', sets: [{reps: 8, weight: 135}, {reps: 8, weight: 135}, {reps: 6, weight: 145}], weight_unit: 'lb', distance_km: null, minutes: null},
  {name: 'Treadmill walk', sets: [], weight_unit: 'lb', distance_km: 1.61, minutes: 20},
 ],
 assumptions: ['About 55 minutes in total'],
};

test('turns dictated notes into an editable workout', async () => {
 const calls = [];
 const response = await analyzeWorkout(request({text: 'bench 2 sets of 8 at 135 then 6 at 145, 20 min walk', weightLb: 236, age: 40, sex: 'male', known: ['Bench press']}), envWith(), 'me@example.com', {}, fakeClient(reply(PUSH), calls));
 assert.equal(response.status, 200);
 const body = await response.json();
 assert.equal(body.isWorkout, true);
 assert.equal(body.title, 'Push day');
 assert.equal(body.kcal, 310);
 assert.deepEqual(body.exercises[0].sets[2], {reps: 6, weight: 145});
 assert.equal(body.exercises[1].distanceKm, 1.61);
 const {params} = calls[0];
 assert.equal(params.model, MODEL);
 assert.deepEqual(params.output_config.format, {type: 'json_schema', schema: WORKOUT_SCHEMA});
 assert.match(params.messages[0].content[0].text, /236 lb/);
 assert.match(params.messages[0].content[0].text, /My age: 40\.\nMy sex: male\./);
 assert.match(params.messages[0].content[0].text, /Bench press/);
 assert.match(params.messages[0].content[0].text, /<notes>\nbench 2 sets/);
});

test('clamps odd values and drops non-workouts', () => {
 const odd = toWorkout({...PUSH, kcal: 99999, exercises: [{name: '', sets: [{reps: -3, weight: 'x'}], weight_unit: 'stone', distance_km: null, minutes: null}]});
 assert.equal(odd.kcal, 5000);
 assert.deepEqual(odd.exercises[0], {name: 'Exercise', sets: [{reps: null, weight: null}], unit: 'lb', distanceKm: null, minutes: null});
 const none = toWorkout({...PUSH, is_workout: false});
 assert.equal(none.isWorkout, false);
 assert.deepEqual(none.exercises, []);
 assert.equal(none.kcal, 0);
});

test('rejects empty or oversized notes without calling Claude', async () => {
 const calls = [];
 assert.equal((await analyzeWorkout(request({text: ' '}), envWith(), 'me', {}, fakeClient(reply(PUSH), calls))).status, 400);
 assert.equal((await analyzeWorkout(request({text: 'x'.repeat(2001)}), envWith(), 'me', {}, fakeClient(reply(PUSH), calls))).status, 400);
 assert.equal((await analyzeWorkout(request({text: 'run'}), envWith({ANTHROPIC_API_KEY: ''}), 'me', {}, fakeClient(reply(PUSH), calls))).status, 503);
 assert.equal(calls.length, 0);
});
