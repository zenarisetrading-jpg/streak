import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {endedWorkout, hasWorkoutFields, wallClock} from '../worker/watch-session.mjs';
import {memoryD1} from './helpers.mjs';

const NOW = new Date('2026-11-13T07:00:00Z');
const at = (h, m) => 'Nov 13, 2026 at ' + ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
const range = (from, count) => Array.from({length: count}, (_, i) => from + i);

// A walk from 9:42 to 10:27 (one Exercise Minute sample per minute), after a short stroll at 8:00.
const walkBody = () => ({
 date: '2026-11-13', steps: 5000, workoutEnded: true,
 workoutMinuteStarts: [...range(0, 4).map(i => at(8, i)), ...range(0, 46).map(i => at(9 + Math.floor((42 + i) / 60), (42 + i) % 60))].join('\n'),
 workoutMinuteValues: Array(50).fill('1').join('\n'),
 workoutEnergyStarts: [at(8, 1), at(9, 50), at(10, 10), at(10, 40)].join('\n'),
 workoutEnergyValues: ['30', '200.4', '225', '15'].join('\n'),
});

test('reads Shortcut dates in the formats iOS writes', () => {
 const expected = Date.UTC(2026, 10, 13, 21, 5);
 assert.equal(wallClock('Nov 13, 2026 at 9:05 PM'), expected);
 assert.equal(wallClock('13 Nov 2026 at 21:05'), expected);
 assert.equal(wallClock('13-Nov-2026, 9:05 pm'), expected);
 assert.equal(wallClock('2026-11-13 21:05:00'), expected);
 assert.equal(wallClock('Nov 13, 2026 at 12:10 AM'), Date.UTC(2026, 10, 13, 0, 10));
 assert.ok(Number.isNaN(wallClock('yesterday')));
});

test('the last unbroken run of exercise minutes becomes the workout', () => {
 assert.deepEqual(endedWorkout(walkBody(), NOW), {
  key: 'workout:2026-11-13:watch-0942am',
  value: {id: 'watch-0942am', source: 'watch', title: 'Apple Watch workout', type: 'other', minutes: 46, kcal: 425, start: '9:42 AM', exercises: [], text: '', notes: [], watch: {minutes: 46, kcal: 425}},
 });
});

test('a short gap of a minute or two does not split the workout', () => {
 const body = walkBody();
 const starts = body.workoutMinuteStarts.split('\n');
 body.workoutMinuteStarts = starts.filter((_, i) => i !== 20 && i !== 21).join('\n');
 body.workoutMinuteValues = Array(48).fill('1').join('\n');
 assert.equal(endedWorkout(body, NOW).value.minutes, 46);
});

test('finds the lists by name prefix and tells starts from values by their contents', () => {
 const body = walkBody();
 const odd = {date: body.date, workoutEnded: 'Yes', workoutMinutesB: body.workoutMinuteStarts, workoutMinutesA: body.workoutMinuteValues, workoutEnergyX: body.workoutEnergyValues, workoutEnergyY: body.workoutEnergyStarts};
 assert.deepEqual(endedWorkout(odd, NOW).value.watch, {minutes: 46, kcal: 425});
 const noValues = {...body, workoutMinuteValues: body.workoutMinuteStarts};
 assert.equal(endedWorkout(noValues, NOW).value.minutes, 46);
});

test('no workout without the flag, with too few minutes or with unreadable times', () => {
 assert.equal(endedWorkout({...walkBody(), workoutEnded: false}, NOW), null);
 assert.equal(endedWorkout({...walkBody(), workoutMinuteStarts: at(10, 0), workoutMinuteValues: '1'}, NOW), null);
 assert.equal(endedWorkout({...walkBody(), workoutMinuteStarts: 'soon\nlater'}, NOW), null);
 assert.equal(endedWorkout({...walkBody(), workoutMinuteStarts: ''}, NOW), null);
 const old = walkBody();
 old.workoutMinuteStarts = old.workoutMinuteStarts.replace(/Nov 13/g, 'Oct 1');
 assert.equal(endedWorkout(old, NOW), null);
});

test('ingest saves the day and the workout, and a second run updates the same workout', async () => {
 const e = {DB: memoryD1(), DEV_USER_EMAIL: 'me@example.com'};
 const local = (path, opts = {}) => new Request('http://localhost:8787' + path, {...opts, headers: {origin: 'http://localhost:8787', ...opts.headers}});
 const {token} = await (await worker.fetch(local('/api/health-key', {method: 'POST'}), e)).json();
 const today = new Date();
 const body = walkBody();
 const month = today.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'});
 const stamp = month + ' ' + today.getUTCDate() + ', ' + today.getUTCFullYear();
 for (const key of ['workoutMinuteStarts', 'workoutEnergyStarts']) body[key] = body[key].replace(/Nov 13, 2026/g, stamp);
 body.date = today.toISOString().slice(0, 10);
 body.workoutEnergyStarts += ('\n' + body.workoutEnergyStarts.split('\n')[1]).repeat(300);
 body.workoutEnergyValues += '\n0'.repeat(300);
 const send = () => worker.fetch(new Request('https://app.example.workers.dev/ingest/health', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: JSON.stringify(body)}), e);
 assert.equal((await send()).status, 200);
 assert.equal((await send()).status, 200);
 const records = await (await worker.fetch(local('/api/records'), e)).json();
 const workouts = Object.keys(records).filter(k => k.startsWith('workout:'));
 assert.deepEqual(workouts, ['workout:' + body.date + ':watch-0942am']);
 assert.equal(records[workouts[0]].kcal, 425);
 assert.equal(records['health:' + body.date].steps, 5000);
});

test('long lines stay quick and the daily workoutMinutes total is not a sample list', () => {
 const started = Date.now();
 assert.equal(endedWorkout({workoutEnded: true, workoutMinuteStarts: 'a'.repeat(900000), workoutMinuteValues: '1'}, NOW), null);
 assert.ok(Date.now() - started < 500);
 assert.equal(hasWorkoutFields({workoutMinutes: 40, workoutKcal: 300}), false);
 assert.equal(hasWorkoutFields({workoutMinuteStarts: ''}), true);
});
