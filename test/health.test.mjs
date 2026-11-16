import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {parseHealth, mergeHealth, sleepHoursFrom, durationSeconds} from '../worker/health.mjs';
import {memoryD1} from './helpers.mjs';

const ORIGIN = 'https://app.example.workers.dev';
const NOW = new Date('2026-11-10T18:00:00Z');
const env = () => ({DB: memoryD1(), DEV_USER_EMAIL: 'me@example.com'});
const local = (path, opts = {}) => new Request('http://localhost:8787' + path, {...opts, headers: {origin: 'http://localhost:8787', ...opts.headers}});
const ingest = (token, body) => new Request(ORIGIN + '/ingest/health', {method: 'POST', headers: token ? {authorization: 'Bearer ' + token} : {}, body: JSON.stringify(body)});
const today = new Date().toISOString().slice(0, 10);

test('parses Shortcut totals, including numbers sent as text', () => {
 const {value} = parseHealth({date: '2026-11-10', activeKcal: '1,234.6', restingKcal: 1850, steps: '9876', exerciseMinutes: ''}, NOW);
 assert.deepEqual(value, {date: '2026-11-10', activeKcal: 1235, restingKcal: 1850, steps: 9876, exerciseMinutes: null, workoutKcal: null, workoutMinutes: null, sleepHours: null, restingHR: null, hrv: null, burnedKcal: 3085, receivedAt: NOW.toISOString()});
});

test('rejects bad health payloads', () => {
 assert.match(parseHealth({date: '10/11/2026', steps: 1}, NOW).error, /date/);
 assert.match(parseHealth({date: '2026-10-01', steps: 1}, NOW).error, /two days/);
 assert.match(parseHealth({date: '2026-11-10', steps: -5}, NOW).error, /steps/);
 assert.match(parseHealth({date: '2026-11-10', activeKcal: 'lots'}, NOW).error, /activeKcal/);
 assert.match(parseHealth({date: '2026-11-10'}, NOW).error, /at least/);
 const recovery = parseHealth({date: '2026-11-10', sleepHours: '7.46 hr', restingHR: 58.4, hrv: '41 ms', workoutKcal: '350'}, NOW).value;
 assert.deepEqual([recovery.sleepHours, recovery.restingHR, recovery.hrv, recovery.workoutKcal], [7.5, 58, 41, 350]);
 assert.match(parseHealth({date: '2026-11-10', sleepHours: 30}, NOW).error, /sleepHours/);
 assert.match(parseHealth([], NOW).error, /JSON object/);
});

test('key lifecycle: create, ingest, rotate, revoke', async () => {
 const e = env();
 assert.deepEqual(await (await worker.fetch(local('/api/health-key'), e)).json(), {active: false, createdAt: null});
 const {token} = await (await worker.fetch(local('/api/health-key', {method: 'POST'}), e)).json();
 assert.match(token, /^dct_[A-Za-z0-9_-]{40,}$/);
 assert.equal((await (await worker.fetch(local('/api/health-key'), e)).json()).active, true);
 assert.doesNotMatch(JSON.stringify(e.DB.raw.prepare('SELECT * FROM health_tokens').all()), new RegExp(token));

 const ok = await worker.fetch(ingest(token, {date: today, activeKcal: 500, restingKcal: 1800, steps: 8000}), e);
 assert.equal(ok.status, 200);
 assert.equal((await ok.json()).burnedKcal, 2300);
 const records = await (await worker.fetch(local('/api/records'), e)).json();
 assert.equal(records['health:' + today].burnedKcal, 2300);

 const {token: rotated} = await (await worker.fetch(local('/api/health-key', {method: 'POST'}), e)).json();
 assert.equal((await worker.fetch(ingest(token, {date: today, steps: 1}), e)).status, 401);
 assert.equal((await worker.fetch(ingest(rotated, {date: today, steps: 1}), e)).status, 200);
 assert.equal((await worker.fetch(local('/api/health-key', {method: 'DELETE'}), e)).status, 204);
 assert.equal((await worker.fetch(ingest(rotated, {date: today, steps: 1}), e)).status, 401);
});

test('ingest path is the only route that skips sign-in, and it needs a key', async () => {
 const e = {DB: memoryD1(), ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com', ACCESS_AUD: 'aud'};
 assert.equal((await worker.fetch(ingest(null, {date: today, steps: 1}), e)).status, 401);
 assert.equal((await worker.fetch(ingest('dct_' + 'a'.repeat(43), {date: today, steps: 1}), e)).status, 401);
 assert.equal((await worker.fetch(new Request(ORIGIN + '/ingest/health'), e)).status, 405);
 for (const path of ['/api/records', '/api/health-key', '/ingest/health/../../api/records', '/ingest/healthx']) {
  assert.equal((await worker.fetch(new Request(ORIGIN + path), e)).status, 401, path);
 }
});

test('health records cannot be written through the normal records API', async () => {
 const e = env();
 const response = await worker.fetch(local('/api/records', {method: 'POST', body: JSON.stringify([{key: 'health:' + today, value: {burnedKcal: 1}}])}), e);
 assert.equal(response.status, 400);
});

test('accepts values with units and grouped lists', () => {
 const {value} = parseHealth({date: '2026-11-10', activeKcal: '612.4 kcal', restingKcal: ['1,000 kcal', '845 kcal'], steps: '9,120 steps'}, NOW);
 assert.equal(value.activeKcal, 612);
 assert.equal(value.restingKcal, 1845);
 assert.equal(value.steps, 9120);
});

test('later uploads for a day keep fields they do not send', () => {
 const first = {date: '2026-11-10', activeKcal: 500, restingKcal: 1800, steps: 9000, sleepHours: null, burnedKcal: 2300};
 const merged = mergeHealth(first, {date: '2026-11-10', activeKcal: 650, restingKcal: null, steps: null, sleepHours: 7.2, burnedKcal: null});
 assert.equal(merged.steps, 9000);
 assert.equal(merged.sleepHours, 7.2);
 assert.equal(merged.burnedKcal, 2450);
});

test('sleep durations from Shortcuts count only asleep stages', () => {
 assert.equal(durationSeconds('1:17:04'), 4624);
 assert.equal(durationSeconds('33:48'), 2028);
 assert.equal(durationSeconds('59'), 59);
 assert.ok(Number.isNaN(durationSeconds('abc')));
 assert.equal(sleepHoursFrom('1:00:00\n30:00\n8:00:00\n15:00', 'Core\nDeep\nIn Bed\nAwake'), 1.5);
 assert.equal(sleepHoursFrom('1:00:00\n30:00', ''), 1.5);
 assert.equal(sleepHoursFrom('', ''), null);
 const {value} = parseHealth({date: '2026-11-10', sleepHours: '3:00:00\n4:00:00\n9:00:00', sleepStages: 'Core\nREM\nIn Bed'}, NOW);
 assert.equal(value.sleepHours, 7);
});

test('sleep counts only the latest night and overlapping samples once', () => {
 const durations = ['1:00:00', '2:00:00', '15:00', '2:00:00', '2:00:00'].join('\n');
 const stages = ['Core', 'Deep', 'Awake', 'Core', 'Core'].join('\n');
 const starts = ['Nov 11, 2026 at 1:00 AM', 'Nov 11, 2026 at 2:00 AM', 'Nov 11, 2026 at 11:30 PM', 'Nov 11, 2026 at 11:45 PM', 'Nov 12, 2026 at 12:45 AM'].join('\n');
 // Last night: Core 11:45 PM to 1:45 AM, overlapping Core 12:45 to 2:45 AM, so 3 hours.
 assert.equal(sleepHoursFrom(durations, stages, starts), 3);
});

test('a later upload with zeros or smaller totals does not erase earlier data', () => {
 const earlier = {date: '2026-11-10', activeKcal: 500, restingKcal: 1500, steps: 8000, sleepHours: 7.2, hrv: 40, burnedKcal: 2000};
 const merged = mergeHealth(earlier, {date: '2026-11-10', activeKcal: 0, restingKcal: 1600, steps: 7000, sleepHours: 0, hrv: 0, restingHR: 58, burnedKcal: 1600});
 assert.equal(merged.activeKcal, 500);
 assert.equal(merged.steps, 8000);
 assert.equal(merged.sleepHours, 7.2);
 assert.equal(merged.hrv, 40);
 assert.equal(merged.restingHR, 58);
 assert.equal(merged.burnedKcal, 2100);
});

test('sleep arrives as a list too, and an unreadable sleep value keeps the rest of the upload', () => {
 assert.equal(parseHealth({date: '2026-11-10', sleepHours: ['7:00:00', '30:00'], sleepStages: ['Core', 'REM']}, NOW).value.sleepHours, 7.5);
 const {value, error} = parseHealth({date: '2026-11-10', steps: 5000, sleepHours: 'about 7:3x'}, NOW);
 assert.equal(error, undefined);
 assert.equal(value.steps, 5000);
 assert.equal(value.sleepHours, null);
});
