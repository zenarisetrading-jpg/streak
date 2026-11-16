import {test} from 'node:test';
import assert from 'node:assert/strict';
import {feelScore, baselineOf, recoveryScore, BASELINE_MIN_DAYS, FEEL_FIELDS} from '../web/recovery.mjs';

const night = (extra = {}) => ({sleepHours: 8, hrv: 40, restingHR: 60, activeKcal: 400, ...extra});
const history = (count, extra = {}) => Array.from({length: count}, () => night(extra));
const scoreOf = (...args) => recoveryScore(...args).score;
const componentKeys = result => result.components.map(c => c.key);
const component = (result, key) => result.components.find(c => c.key === key);

test('a feel check-in scores higher when the day felt good', () => {
 assert.equal(feelScore({mood: 5, energy: 5, soreness: 1, sleepQuality: 5}), 100);
 assert.equal(feelScore({mood: 1, energy: 1, soreness: 5, sleepQuality: 1}), 0);
 assert.equal(feelScore({mood: 3, energy: 3, soreness: 3, sleepQuality: 3}), 50);
 // Soreness runs the other way: sore legs pull the score down.
 assert.ok(feelScore({mood: 4, energy: 4, soreness: 1}) > feelScore({mood: 4, energy: 4, soreness: 5}));
});

test('a partly filled check-in uses only the answered fields', () => {
 assert.equal(feelScore({mood: 5}), 100);
 assert.equal(feelScore({}), null);
 assert.equal(feelScore(null), null);
 assert.equal(feelScore({mood: 9, energy: 0}), null, 'out-of-range answers are ignored');
});

test('a baseline needs a few days before it means anything', () => {
 assert.equal(baselineOf([]), null);
 assert.equal(baselineOf([40, 42]), null);
 assert.deepEqual(baselineOf([40, 42, 44]), {mean: 42, days: 3});
 // Blanks are skipped, not counted as zero.
 assert.deepEqual(baselineOf([40, null, 42, undefined, 44]), {mean: 42, days: 3});
});

test('a steady day against its own baseline lands in the middle', () => {
 const result = recoveryScore({health: night(), history: history(7), feel: null});
 assert.ok(result.score >= 60 && result.score <= 85, 'got ' + result.score);
 assert.equal(result.band, 'Ready');
 assert.equal(result.baselineDays, 7);
});

test('better HRV, lower resting heart rate and a long sleep raise the score', () => {
 const base = {history: history(7), feel: null};
 const steady = scoreOf({...base, health: night()});
 assert.ok(scoreOf({...base, health: night({hrv: 52})}) > steady, 'HRV up');
 assert.ok(scoreOf({...base, health: night({restingHR: 54})}) > steady, 'resting HR down');
 assert.ok(scoreOf({...base, health: night({sleepHours: 5})}) < steady, 'short sleep');
 assert.ok(scoreOf({...base, health: night({hrv: 26, restingHR: 70, sleepHours: 5})}) < 40, 'a rough day');
});

test('the score stays within 0 and 100 however extreme the day', () => {
 for (const health of [night({hrv: 200, restingHR: 35, sleepHours: 14}), night({hrv: 1, restingHR: 110, sleepHours: 0.5})]) {
  const {score} = recoveryScore({health, history: history(7), feel: null});
  assert.ok(score >= 0 && score <= 100, 'got ' + score);
 }
});

test('with too little history it scores what it can and says the baseline is still building', () => {
 const result = recoveryScore({health: night(), history: history(BASELINE_MIN_DAYS - 1), feel: null});
 assert.equal(result.baselineDays, BASELINE_MIN_DAYS - 1);
 assert.equal(result.building, true);
 assert.deepEqual(componentKeys(result), ['sleep'], 'only sleep needs no baseline');
 assert.ok(result.score > 0);
});

test('the check-in counts even on the very first day, with no watch history at all', () => {
 const result = recoveryScore({health: null, history: [], feel: {mood: 5, energy: 5, soreness: 1, sleepQuality: 5}});
 assert.deepEqual(componentKeys(result), ['feel']);
 assert.equal(result.score, 100);
 assert.equal(result.band, 'Strong');
});

test('with nothing at all there is no score to show', () => {
 const result = recoveryScore({health: null, history: [], feel: null});
 assert.equal(result.score, null);
 assert.deepEqual(result.components, []);
});

test('how you say you feel moves the score', () => {
 const base = {health: night(), history: history(7)};
 const rough = recoveryScore({...base, feel: {mood: 1, energy: 1, soreness: 5, sleepQuality: 2}});
 const good = recoveryScore({...base, feel: {mood: 5, energy: 5, soreness: 1, sleepQuality: 5}});
 assert.ok(good.score > rough.score + 20, rough.score + ' vs ' + good.score);
 assert.ok(componentKeys(rough).includes('feel'));
});

test('a hard few days of training pulls the score down', () => {
 const calm = history(14, {activeKcal: 300});
 const heavy = recoveryScore({health: night({activeKcal: 1400}), history: [...calm, night({activeKcal: 1400}), night({activeKcal: 1500})], feel: null});
 const easy = recoveryScore({health: night({activeKcal: 300}), history: calm, feel: null});
 assert.ok(component(heavy, 'load').score < component(easy, 'load').score);
});

test('the note names the weakest thing about the day', () => {
 const result = recoveryScore({health: night({sleepHours: 4}), history: history(7), feel: null});
 assert.match(result.note, /sleep/i);
 assert.match(recoveryScore({health: night({restingHR: 75}), history: history(7), feel: null}).note, /resting heart rate/i);
});

test('bands read the way a person would describe the day', () => {
 const bandAt = score => recoveryScore({health: null, history: [], feel: {mood: score, energy: score, soreness: 6 - score, sleepQuality: score}}).band;
 assert.equal(bandAt(5), 'Strong');
 assert.equal(bandAt(3), 'Steady');
 assert.equal(bandAt(1), 'Rest');
});

test('the check-in fields are the four the UI offers', () => {
 assert.deepEqual([...FEEL_FIELDS].sort(), ['energy', 'mood', 'soreness', 'sleepQuality'].sort());
});

test('today does not count towards recent training load while it is still adding up', () => {
 // Apple Health sends running totals, so this morning's activeKcal is a fraction of the day.
 const week = history(14, {activeKcal: 900});
 const morning = recoveryScore({health: night({activeKcal: 40}), history: week, feel: null});
 const evening = recoveryScore({health: night({activeKcal: 900}), history: week, feel: null});
 const load = result => result.components.find(c => c.key === 'load').score;
 assert.equal(load(morning), load(evening), 'the load score should not drift through the day');
});

test('only the last fortnight counts towards a baseline', () => {
 const old = history(20, {hrv: 100});
 const recent = history(14, {hrv: 40});
 const result = recoveryScore({health: night({hrv: 40}), history: [...old, ...recent], feel: null});
 const hrv = result.components.find(c => c.key === 'hrv');
 assert.match(hrv.detail, /40 ms vs 40 usual/, 'the old readings should have aged out');
 assert.equal(result.baselineDays, 14);
});

test('the card keeps saying it is learning until HRV and heart rate have a baseline', () => {
 // Plenty of sleep logged, but the Watch has sent heart data only twice.
 const sleepOnly = history(9, {hrv: null, restingHR: null});
 const result = recoveryScore({health: night(), history: [...sleepOnly, ...history(2)], feel: null});
 assert.equal(result.building, true, 'sleep alone should not retire the hint');
 assert.equal(result.baselineDays, 2);
});

test('readings that come back as text or nonsense are ignored, not scored', () => {
 const odd = {sleepHours: '8', hrv: 'x', restingHR: null, activeKcal: undefined};
 const result = recoveryScore({health: odd, history: history(7), feel: {mood: '4', energy: true, soreness: 2.5}});
 // Sleep as text, HRV as a word and a missing resting HR are all dropped. Training load
 // survives because it is built from the days behind today, not from today's record.
 assert.deepEqual(result.components.map(c => c.key), ['load', 'feel']);
 // mood 4 is the only check-in answer that is a whole number in range.
 assert.equal(result.components.find(c => c.key === 'feel').score, 75);
});

test('every band has wording, including the middle two', () => {
 const bandFor = feel => recoveryScore({health: null, history: [], feel}).band;
 assert.equal(bandFor({mood: 5, energy: 5, sleepQuality: 5, soreness: 1}), 'Strong');
 assert.equal(bandFor({mood: 4, energy: 4, sleepQuality: 4, soreness: 3}), 'Ready');
 assert.equal(bandFor({mood: 3, energy: 3, sleepQuality: 3, soreness: 3}), 'Steady');
 assert.equal(bandFor({mood: 3, energy: 2, sleepQuality: 3, soreness: 4}), 'Take it easy');
 assert.equal(bandFor({mood: 1, energy: 1, sleepQuality: 1, soreness: 5}), 'Rest');
});

test('a day with nothing wrong says so rather than inventing a weak point', () => {
 const result = recoveryScore({health: night({hrv: 48, restingHR: 55, sleepHours: 8.5}), history: history(7), feel: null});
 assert.match(result.note, /good day to push/);
});
