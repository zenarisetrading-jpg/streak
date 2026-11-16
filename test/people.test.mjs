import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {memoryD1, accessIssuer} from './helpers.mjs';

const TEAM = 'household.cloudflareaccess.com';
const AUD = 'aud-123';
const ORIGIN = 'https://daily-check-in.example.workers.dev';
const POLICY_URL = 'https://api.cloudflare.com/client/v4/accounts/acct/access/apps/app/policies/pol';
let issuer, realFetch, policy, cfCalls, cfFails;

before(async () => {
 issuer = await accessIssuer(TEAM, AUD);
 realFetch = globalThis.fetch;
 globalThis.fetch = async (url, init = {}) => {
  if (String(url) === issuer.certsUrl) return Response.json({keys: [issuer.jwk]});
  if (String(url) === POLICY_URL) {
   cfCalls.push({method: init.method, auth: init.headers?.Authorization, body: init.body && JSON.parse(init.body)});
   if (cfFails) return Response.json({success: false, errors: [{message: 'nope'}]}, {status: 403});
   if (init.method === 'PUT') policy = {...policy, ...JSON.parse(init.body)};
   return Response.json({success: true, result: policy});
  }
  return realFetch(url, init);
 };
});
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => {
 cfCalls = [];
 cfFails = false;
 policy = {id: 'pol', name: 'Household', decision: 'allow', include: [{email: {email: 'me@example.com'}}, {email: {email: 'wife@example.com'}}], exclude: [], require: []};
});

const makeEnv = extra => ({
 DB: memoryD1(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: 'me@example.com, wife@example.com',
 OWNER_EMAIL: 'me@example.com', ACCESS_ADMIN_TOKEN: 'test-admin', CF_ACCOUNT_ID: 'acct', ACCESS_APP_ID: 'app', ACCESS_POLICY_ID: 'pol', ...extra,
});
async function call(env, {method = 'GET', email = 'me@example.com', body, origin = ORIGIN, path = '/api/people'} = {}) {
 const headers = {origin, 'cf-access-jwt-assertion': await issuer.sign({email})};
 return worker.fetch(new Request(ORIGIN + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), env);
}
const policyEmails = () => policy.include.filter(r => r.email).map(r => r.email.email);

test('only the owner can see and change people', async () => {
 const env = makeEnv();
 assert.equal((await call(env, {email: 'wife@example.com'})).status, 403);
 assert.equal((await call(env, {email: 'wife@example.com', method: 'POST', body: {email: 'x@example.com'}})).status, 403);
 assert.equal((await call(env, {email: 'wife@example.com', method: 'DELETE', body: {email: 'x@example.com'}})).status, 403);
 assert.equal(cfCalls.length, 0);
 const list = await (await call(env)).json();
 assert.deepEqual(list, {household: ['me@example.com', 'wife@example.com'], invited: [], max: 10, ready: true});
});

test('changes need a same-origin request', async () => {
 const env = makeEnv();
 assert.equal((await call(env, {method: 'POST', body: {email: 'x@example.com'}, origin: 'https://evil.example'})).status, 403);
 assert.equal(cfCalls.length, 0);
});

test('inviting adds the email to the sign-in rule and lets them in', async () => {
 const env = makeEnv();
 assert.equal((await call(env, {email: 'friend@example.com', path: '/api/me'})).status, 403);
 const response = await call(env, {method: 'POST', body: {email: ' Friend@Example.com '}});
 assert.equal(response.status, 201);
 assert.deepEqual(policyEmails(), ['me@example.com', 'wife@example.com', 'friend@example.com']);
 assert.equal(cfCalls.at(-1).auth, 'Bearer test-admin');
 assert.equal(cfCalls.at(-1).body.decision, 'allow');
 assert.equal((await call(env, {email: 'friend@example.com', path: '/api/me'})).status, 200);
 const {invited} = await (await call(env)).json();
 assert.deepEqual(invited.map(p => p.email), ['friend@example.com']);
});

test('keeps non-email rules on the policy', async () => {
 policy.include.push({group: {id: 'g1'}});
 const env = makeEnv();
 await call(env, {method: 'POST', body: {email: 'friend@example.com'}});
 assert.deepEqual(policy.include[0], {group: {id: 'g1'}});
 assert.equal(policyEmails().length, 3);
});

test('rejects bad, duplicate and household emails, and caps invites', async () => {
 const env = makeEnv();
 for (const email of ['', 'nope', 'a@b', '.a@example.com', 'a..b@example.com', 'a@-x.com', 'a b@example.com', 'x@example.com,y@example.com', 'a'.repeat(250) + '@example.com']) {
  assert.equal((await call(env, {method: 'POST', body: {email}})).status, 400, email);
 }
 assert.equal((await call(env, {method: 'POST', body: {email: 'wife@example.com'}})).status, 409);
 assert.equal((await call(env, {method: 'POST', body: {email: 'f@example.com'}})).status, 201);
 assert.equal((await call(env, {method: 'POST', body: {email: 'f@example.com'}})).status, 409);
 for (let i = 1; i < 10; i++) assert.equal((await call(env, {method: 'POST', body: {email: `p${i}@example.com`}})).status, 201);
 assert.equal((await call(env, {method: 'POST', body: {email: 'one-too-many@example.com'}})).status, 409);
});

test('a failed Cloudflare update leaves nothing changed', async () => {
 const env = makeEnv();
 cfFails = true;
 const response = await call(env, {method: 'POST', body: {email: 'friend@example.com'}});
 assert.equal(response.status, 502);
 assert.equal((await call(env, {email: 'friend@example.com', path: '/api/me'})).status, 403);
 cfFails = false;
 assert.deepEqual((await (await call(env)).json()).invited, []);
});

test('removing blocks them at once, even if Cloudflare fails', async () => {
 const env = makeEnv();
 await call(env, {method: 'POST', body: {email: 'friend@example.com'}});
 cfFails = true;
 const response = await call(env, {method: 'DELETE', body: {email: 'friend@example.com'}});
 assert.equal(response.status, 200);
 assert.match((await response.json()).warning, /catch up/);
 assert.equal((await call(env, {email: 'friend@example.com', path: '/api/me'})).status, 403);
 cfFails = false;
 await call(env, {method: 'POST', body: {email: 'other@example.com'}});
 assert.deepEqual(policyEmails(), ['me@example.com', 'wife@example.com', 'other@example.com']);
});

test('removing someone not invited is a 404; household cannot be removed', async () => {
 const env = makeEnv();
 assert.equal((await call(env, {method: 'DELETE', body: {email: 'wife@example.com'}})).status, 404);
 assert.equal((await call(env, {method: 'DELETE', body: {email: 'ghost@example.com'}})).status, 404);
 assert.equal(cfCalls.length, 0);
});

test('reports not ready without the Cloudflare key', async () => {
 const env = makeEnv({ACCESS_ADMIN_TOKEN: ''});
 assert.equal((await (await call(env)).json()).ready, false);
 assert.equal((await call(env, {method: 'POST', body: {email: 'friend@example.com'}})).status, 503);
});

test('the policy update keeps its other settings and always includes the owner', async () => {
 Object.assign(policy, {uid: 'pol', created_at: 'x', updated_at: 'y', reusable: false, session_duration: '720h', approval_required: false, precedence: 1});
 const env = makeEnv({ALLOWED_EMAILS: 'wife@example.com'});
 const response = await call(env, {method: 'POST', body: {email: 'friend@example.com'}});
 assert.equal(response.status, 201, await response.clone().text());
 const sent = cfCalls.find(c => c.method === 'PUT').body;
 assert.equal(sent.session_duration, '720h');
 assert.equal(sent.precedence, 1);
 for (const key of ['id', 'uid', 'created_at', 'updated_at', 'reusable']) assert.equal(key in sent, false, key);
 assert.deepEqual(policyEmails(), ['me@example.com', 'wife@example.com', 'friend@example.com']);
});

test('removing a guest also revokes their Apple Health key', async () => {
 const env = makeEnv();
 await call(env, {method: 'POST', body: {email: 'friend@example.com'}});
 await env.DB.prepare('INSERT INTO health_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)').bind('friend@example.com', 'h', 'now').run();
 await call(env, {method: 'DELETE', body: {email: 'friend@example.com'}});
 assert.equal(await env.DB.prepare('SELECT 1 FROM health_tokens WHERE user_id = ?').bind('friend@example.com').first(), null);
});

test('rejects sign-in emails with look-alike non-ASCII characters', async () => {
 const env = makeEnv();
 await call(env, {method: 'POST', body: {email: 'kim@example.com'}});
 assert.equal((await call(env, {email: 'Kim@example.com', path: '/api/me'})).status, 403);
 assert.equal((await call(env, {email: 'kim@example.com', path: '/api/me'})).status, 200);
});
