import {test} from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import {analyzeMeal, decodeImage, toEstimate, MODEL, OUTPUT_SCHEMA} from '../worker/meal-photo.mjs';
import {memoryD1, JPEG_B64, PNG_B64} from './helpers.mjs';

const headers = {};
const envWith = extra => ({DB: memoryD1(), ANTHROPIC_API_KEY: 'sk-test', ...extra});
const request = body => new Request('https://app.test/api/meal-photo', {method: 'POST', body: JSON.stringify(body)});
const reply = (output, stop_reason = 'end_turn') => ({stop_reason, content: [{type: 'thinking', thinking: ''}, {type: 'text', text: JSON.stringify(output)}]});
function fakeClient(result, calls = []) {
 return apiKey => ({beta: {messages: {create: async params => { calls.push({apiKey, params}); if (result instanceof Error) throw result; return result; }}}});
}
const PLATE = {
 is_food: true, summary: 'Chicken curry with two rotis',
 items: [
  {name: 'Chicken curry', portion: '1 bowl', grams: 200, protein_g: 26, carbs_g: 10, fat_g: 18, confidence: 'medium', is_hidden_extra: false},
  {name: 'Cooking oil', portion: '2 tsp absorbed', grams: 10, protein_g: 0, carbs_g: 0, fat_g: 10, confidence: 'low', is_hidden_extra: true},
 ],
 assumptions: ['Home-style curry with 2 tsp oil'], clarifying_question: '',
};

test('validates image type and contents', () => {
 assert.ok(decodeImage({mediaType: 'image/jpeg', image: JPEG_B64}).data);
 assert.ok(decodeImage({mediaType: 'image/png', image: PNG_B64}).data);
 assert.match(decodeImage({mediaType: 'image/gif', image: JPEG_B64}).error, /JPEG, PNG or WebP/);
 assert.match(decodeImage({mediaType: 'image/png', image: JPEG_B64}).error, /does not look like a PNG/);
 assert.match(decodeImage({mediaType: 'image/jpeg', image: 'data:image/jpeg;base64,abc'}).error, /could not be read/);
 assert.match(decodeImage({mediaType: 'image/jpeg', image: 'A'.repeat(6_100_000)}).error, /too large/);
});

test('sends the photo to Claude with a schema and returns editable items', async () => {
 const calls = [];
 const response = await analyzeMeal(request({mediaType: 'image/jpeg', image: JPEG_B64, hint: 'made with ghee'}), envWith(), 'me@example.com', headers, fakeClient(reply(PLATE), calls));
 assert.equal(response.status, 200);
 const body = await response.json();
 assert.equal(body.isFood, true);
 assert.deepEqual(body.items[0], {name: 'Chicken curry', assumption: '1 bowl (~200 g)', grams: 200, protein: 26, carbs: 10, fat: 18, confidence: 'medium', extra: false});
 assert.equal(body.items[1].extra, true);
 const {apiKey, params} = calls[0];
 assert.equal(apiKey, 'sk-test');
 assert.equal(params.model, MODEL);
 assert.deepEqual(params.output_config.format, {type: 'json_schema', schema: OUTPUT_SCHEMA});
 assert.equal(params.messages[0].content[0].source.data, JPEG_B64);
 assert.match(params.messages[0].content[1].text, /made with ghee/);
});

test('non-food photos return no items', async () => {
 const response = await analyzeMeal(request({mediaType: 'image/jpeg', image: JPEG_B64}), envWith(), 'u', headers,
  fakeClient(reply({is_food: false, summary: 'A laptop keyboard.', items: [{name: 'x', portion: '', grams: 1, protein_g: 1, carbs_g: 1, fat_g: 1, confidence: 'low', is_hidden_extra: false}], assumptions: [], clarifying_question: ''})));
 const body = await response.json();
 assert.equal(body.isFood, false);
 assert.deepEqual(body.items, []);
 assert.equal(body.summary, 'A laptop keyboard.');
});

test('handles refusals, truncation, bad output and upstream errors', async () => {
 const run = client => analyzeMeal(request({mediaType: 'image/jpeg', image: JPEG_B64}), envWith(), 'u', headers, client);
 assert.equal((await run(fakeClient(reply({}, 'refusal')))).status, 422);
 assert.equal((await run(fakeClient(reply({}, 'max_tokens')))).status, 502);
 assert.equal((await run(fakeClient({stop_reason: 'end_turn', content: [{type: 'text', text: 'not json'}]}))).status, 502);
 const authError = new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers());
 const authResponse = await run(fakeClient(authError));
 assert.equal(authResponse.status, 503);
 assert.doesNotMatch(JSON.stringify(await authResponse.json()), /sk-test/);
 assert.equal((await run(fakeClient(new Anthropic.RateLimitError(429, {}, 'slow', new Headers())))).status, 429);
 assert.equal((await run(fakeClient(new TypeError('network down')))).status, 502);
});

test('enforces a per-person daily limit', async () => {
 const env = envWith({PHOTO_DAILY_LIMIT: '2'});
 const run = user => analyzeMeal(request({mediaType: 'image/jpeg', image: JPEG_B64}), env, user, headers, fakeClient(reply(PLATE)));
 assert.equal((await run('me')).status, 200);
 assert.equal((await run('me')).status, 200);
 assert.equal((await run('me')).status, 429);
 assert.equal((await run('wife')).status, 200);
});

test('clamps and cleans model numbers', () => {
 const result = toEstimate({is_food: true, summary: ' x ', assumptions: [], clarifying_question: '', items: [{name: '', portion: 'huge', grams: 99999, protein_g: -5, carbs_g: 'NaN', fat_g: 1e9, confidence: 'certain', is_hidden_extra: 'yes'}]});
 assert.deepEqual(result.items[0], {name: 'Food', assumption: 'huge (~3000 g)', grams: 3000, protein: 0, carbs: 0, fat: 500, confidence: 'low', extra: false});
 assert.equal(result.summary, 'x');
});

test('estimates a dictated description without punctuation', async () => {
 const calls = [];
 const dictated = 'for lunch i had two roti s with chicken curry about a bowl and some cucumber salad and a glass of lassi';
 const response = await analyzeMeal(request({text: dictated}), envWith(), 'me', headers, fakeClient(reply(PLATE), calls));
 assert.equal(response.status, 200);
 assert.equal((await response.json()).items.length, 2);
 const content = calls[0].params.messages[0].content;
 assert.equal(content.length, 1);
 assert.equal(content[0].type, 'text');
 assert.match(content[0].text, /<description>\nfor lunch i had two roti s/);
});

test('rejects empty or oversized descriptions', async () => {
 const run = body => analyzeMeal(request(body), envWith(), 'me', headers, fakeClient(reply(PLATE)));
 assert.equal((await run({text: '   '})).status, 400);
 assert.equal((await run({text: 'x'.repeat(1501)})).status, 400);
 assert.equal((await run({})).status, 400);
});

test('does not repeat a weight the portion already states', () => {
 const item = {name: 'Rice', portion: '1/2 cup cooked (~90 g)', grams: 90, protein_g: 2, carbs_g: 25, fat_g: 0, confidence: 'high', is_hidden_extra: false};
 const result = toEstimate({is_food: true, summary: '', assumptions: [], clarifying_question: '', items: [item]});
 assert.equal(result.items[0].assumption, '1/2 cup cooked (~90 g)');
});
