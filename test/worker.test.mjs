import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {memoryD1, accessIssuer, JPEG_B64} from './helpers.mjs';

const TEAM = 'household.cloudflareaccess.com';
const AUD = 'aud-123';
const ORIGIN = 'https://daily-check-in.example.workers.dev';
let issuer, realFetch;

before(async () => {
 issuer = await accessIssuer(TEAM, AUD);
 realFetch = globalThis.fetch;
 globalThis.fetch = async url => String(url) === issuer.certsUrl ? Response.json({keys: [issuer.jwk]}) : realFetch(url);
});
after(() => { globalThis.fetch = realFetch; });

const makeEnv = extra => ({DB: memoryD1(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: 'me@example.com, wife@example.com', ...extra});
async function call(env, path, {method = 'GET', email, token, body, origin = ORIGIN, extraHeaders = {}} = {}) {
 const headers = {origin, ...extraHeaders};
 if (token ?? email) headers['cf-access-jwt-assertion'] = token ?? await issuer.sign({email});
 return worker.fetch(new Request(ORIGIN + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), env);
}

test('fails closed when Access is not configured', async () => {
 const response = await call(makeEnv({ACCESS_AUD: ''}), '/api/me', {email: 'me@example.com'});
 assert.equal(response.status, 500);
});

test('requires a signed Access token', async () => {
 assert.equal((await call(makeEnv(), '/')).status, 401);
 assert.equal((await call(makeEnv(), '/api/me', {token: 'not.a.jwt'})).status, 401);
});

test('serves the app icons and manifest without sign-in, nothing else', async () => {
 const env = makeEnv();
 for (const path of ['/icon.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/icon-192.png', '/icon-512.png', '/favicon.png', '/app.webmanifest']) {
  const response = await call(env, path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /image\/png|manifest/, path);
 }
 for (const path of ['/', '/index.html', '/sync.js', '/api/me', '/api/records']) assert.equal((await call(env, path)).status, 401, path);
});

test('accepts a valid token and serves the app', async () => {
 const env = makeEnv();
 const me = await call(env, '/api/me', {email: 'Me@Example.com'});
 assert.equal(me.status, 200);
 assert.deepEqual(await me.json(), {email: 'me@example.com'});
 const page = await call(env, '/', {email: 'me@example.com'});
 const version = page.headers.get('x-app-version');
 assert.match(version, /^[0-9a-f]{12}$/);
 const html = await page.text();
 assert.match(html, new RegExp('name="app-version" content="' + version + '"'));
 assert.match(html, /Snap a meal/i);
});

test('rejects wrong audience, wrong issuer, expired and forged tokens', async () => {
 const env = makeEnv();
 const now = Math.floor(Date.now() / 1000);
 for (const claims of [{aud: ['other']}, {iss: 'https://evil.cloudflareaccess.com'}, {exp: now - 5}]) {
  const token = await issuer.sign({email: 'me@example.com', ...claims});
  assert.equal((await call(env, '/api/me', {token})).status, 401, JSON.stringify(claims));
 }
 const good = await issuer.sign({email: 'me@example.com'});
 const [h, , s] = good.split('.');
 const forgedPayload = Buffer.from(JSON.stringify({iss: 'https://' + TEAM, aud: [AUD], exp: now + 600, email: 'wife@example.com'})).toString('base64url');
 assert.equal((await call(env, '/api/me', {token: [h, forgedPayload, s].join('.')})).status, 401);
});

test('blocks signed-in emails that are not on the allow list', async () => {
 assert.equal((await call(makeEnv(), '/api/me', {email: 'stranger@example.com'})).status, 403);
});

test('dev bypass only works on localhost', async () => {
 const env = makeEnv({DEV_USER_EMAIL: 'me@example.com'});
 const local = await worker.fetch(new Request('http://localhost:8787/api/me'), env);
 assert.equal(local.status, 200);
 assert.equal((await call(env, '/api/me')).status, 401);
});

test('keeps each profile separate', async () => {
 const env = makeEnv();
 const meal = {id: 'm1', kind: 'Lunch', text: 'Dal', items: [{name: 'dal', assumption: '1 cup', protein: 12, carbs: 29, fat: 6}], unknown: []};
 assert.equal((await call(env, '/api/records', {method: 'POST', email: 'me@example.com', body: [{key: 'meal:2026-11-10:m1', value: meal}]})).status, 204);
 assert.deepEqual(await (await call(env, '/api/records', {email: 'me@example.com'})).json(), {'meal:2026-11-10:m1': meal});
 assert.deepEqual(await (await call(env, '/api/records', {email: 'wife@example.com'})).json(), {});
});

test('import never overwrites existing records', async () => {
 const env = makeEnv();
 const email = 'me@example.com';
 await call(env, '/api/records', {method: 'POST', email, body: [{key: 'day:2026-11-01', value: {weight: '240'}}]});
 await call(env, '/api/records', {method: 'POST', email, body: [{key: 'day:2026-11-01', value: {weight: '999'}, importOnly: true}, {key: 'day:2026-11-02', value: {weight: '239'}, importOnly: true}]});
 assert.deepEqual(await (await call(env, '/api/records', {email})).json(), {'day:2026-11-01': {weight: '240'}, 'day:2026-11-02': {weight: '239'}});
});

test('writes require same origin', async () => {
 const env = makeEnv({ANTHROPIC_API_KEY: 'test'});
 const opts = {method: 'POST', email: 'me@example.com', origin: 'https://evil.example'};
 assert.equal((await call(env, '/api/records', {...opts, body: []})).status, 403);
 assert.equal((await call(env, '/api/meal-photo', {...opts, body: {mediaType: 'image/jpeg', image: JPEG_B64}})).status, 403);
});

test('photo endpoint reports a missing API key without calling out', async () => {
 const response = await call(makeEnv(), '/api/meal-photo', {method: 'POST', email: 'me@example.com', body: {mediaType: 'image/jpeg', image: JPEG_B64}});
 assert.equal(response.status, 503);
 assert.match((await response.json()).error, /missing API key/);
});

test('stores a per-person settings record', async () => {
 const env = makeEnv();
 const settings = {calorieTargets: [{from: '2026-11-10', kcal: 1900}]};
 assert.equal((await call(env, '/api/records', {method: 'POST', email: 'me@example.com', body: [{key: 'settings:profile', value: settings}]})).status, 204);
 assert.deepEqual((await (await call(env, '/api/records', {email: 'me@example.com'})).json())['settings:profile'], settings);
 assert.equal((await call(env, '/api/records', {method: 'POST', email: 'me@example.com', body: [{key: 'settings:other', value: {}}]})).status, 400);
});

test('a poll with nothing new gets a quick 304, and any write changes the tag', async () => {
 const env = makeEnv();
 const email = 'me@example.com';
 const first = await call(env, '/api/records', {email});
 const tag = first.headers.get('etag');
 assert.equal((await call(env, '/api/records', {email, extraHeaders: {'if-none-match': tag}})).status, 304);
 assert.equal((await call(env, '/api/records', {email, extraHeaders: {'if-none-match': 'W/' + tag}})).status, 304);
 await call(env, '/api/records', {method: 'POST', email, body: [{key: 'day:2026-11-01', value: {weight: '240'}}]});
 const after = await call(env, '/api/records', {email, extraHeaders: {'if-none-match': tag}});
 assert.equal(after.status, 200);
 assert.notEqual(after.headers.get('etag'), tag);
});

test('settings edited on two devices keep the newer value per field', async () => {
 const env = makeEnv();
 const email = 'me@example.com';
 const save = value => call(env, '/api/records', {method: 'POST', email, body: [{key: 'settings:profile', value}]});
 await save({goalWeight: 228, exerciseShare: 1, _at: {goalWeight: 100, exerciseShare: 100}});
 // A device with a stale goal changes only the exercise share.
 await save({goalWeight: 240, exerciseShare: 0.5, _at: {goalWeight: 50, exerciseShare: 200}});
 const {['settings:profile']: merged} = await (await call(env, '/api/records', {email})).json();
 assert.equal(merged.goalWeight, 228);
 assert.equal(merged.exerciseShare, 0.5);
 assert.deepEqual(merged._at, {goalWeight: 100, exerciseShare: 200});
});
