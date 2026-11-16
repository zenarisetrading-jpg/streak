import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sparkline, smoothSeries, sessionBars, divergingBars} from '../web/charts.mjs';

const lineOf = markup => /class="chart__line[^"]*" d="([^"]+)"/.exec(markup)?.[1] ?? '';
const areaOf = markup => /class="chart__area[^"]*" d="([^"]+)"/.exec(markup)?.[1] ?? '';
const numbersIn = d => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
// Each curve segment ends at the point it was drawn to.
const endPoints = d => d.split('C').slice(1).map(segment => numbersIn(segment).slice(-2));

test('a sparkline is drawn as curves, not straight segments', () => {
 const {markup} = sparkline([30, 45, 35, 50, 40, 55, 42]);
 const d = lineOf(markup);
 assert.match(d, /^M[\d. ]+ C/, 'starts at the first reading, then curves');
 assert.equal(/ L/.test(d), false, 'no straight joins left in the line');
 assert.equal(d.match(/C/g).length, 6, 'one curve per gap between readings');
});

test('the line follows the readings but softens a one-day spike', () => {
 const calm = [40, 40, 40, 40, 40];
 const spike = [40, 40, 80, 40, 40];
 const heightOf = values => {
  const ys = [...lineOf(sparkline(values, {smooth: false}).markup).matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => Number(m[2]));
  return Math.max(...ys) - Math.min(...ys);
 };
 const curvedYs = endPoints(lineOf(sparkline(spike).markup)).map(([, y]) => y);
 assert.ok(Math.max(...curvedYs) - Math.min(...curvedYs) < heightOf(spike), 'the spike is damped, not drawn raw');
 assert.equal(heightOf(calm), 0, 'a calm run has nothing to damp');
});

test('the line starts and ends on the real first and last readings', () => {
 const values = [30, 45, 35, 50, 40];
 const straight = numbersIn(lineOf(sparkline(values, {smooth: false}).markup));
 const curved = numbersIn(lineOf(sparkline(values).markup));
 assert.deepEqual(curved.slice(0, 2), straight.slice(0, 2), 'same starting point');
 assert.deepEqual(curved.slice(-2), straight.slice(-2), 'same end point');
});

test('the curve never bulges outside the chart', () => {
 for (const values of [[10, 90, 10, 90, 10], [5, 5, 5, 80, 5], [1, 2, 100, 3, 4, 5]]) {
  const {markup} = sparkline(values, {area: true, cls: 'info'});
  for (const n of [...numbersIn(lineOf(markup)), ...numbersIn(areaOf(markup))]) {
   assert.ok(n >= 0 && n <= 120, 'point ' + n + ' outside the 120×40 box for ' + values);
  }
 }
});

test('a flat run of readings stays flat', () => {
 const d = lineOf(sparkline([40, 40, 40, 40]).markup);
 const ys = numbersIn(d).filter((_, i) => i % 2 === 1);
 assert.equal(new Set(ys).size, 1, 'a flat line should not ripple: ' + d);
});

test('the filled area closes along the bottom', () => {
 const d = areaOf(sparkline([10, 20, 15], {area: true}).markup);
 assert.match(d, /C/, 'the top edge of the fill is the same curve');
 assert.match(d, /L[\d. ]+ 40 L[\d. ]+ 40 Z$/, 'and it closes along the baseline');
});

test('too few readings draw nothing at all', () => {
 assert.equal(sparkline([]).markup, '');
 assert.equal(sparkline([5]).markup, '');
 assert.equal(sparkline([null, 5, null]).markup, '');
});

test('gaps between readings are joined rather than breaking the line', () => {
 const {markup} = sparkline([30, null, 50, null, 40]);
 assert.equal(lineOf(markup).match(/C/g).length, 2);
});

test('a gap in the readings does not make the curve hook backwards', () => {
 // Only the first two and last two days of a fortnight were recorded.
 const values = Array(30).fill(null);
 [[0, 10], [1, 20], [28, 30], [29, 15]].forEach(([i, v]) => { values[i] = v; });
 const d = lineOf(sparkline(values).markup);
 const xs = numbersIn(d).filter((_, i) => i % 2 === 0);
 assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 120, 'control points left the chart: ' + d);
 // Before the x values were clamped, a long gap threw a control point to x = -11.4 and the
 // line hooked back on itself. Each curve must stay inside the span of its own two readings.
 const points = [[...numbersIn(d).slice(0, 2)], ...endPoints(d)];
 d.split('C').slice(1).forEach((segment, i) => {
  const [c1x, , c2x] = numbersIn(segment);
  const [left, right] = [points[i][0], points[i + 1][0]];
  for (const x of [c1x, c2x]) assert.ok(x >= left && x <= right, x + ' outside the segment [' + left + ', ' + right + ']');
 });
});

test('control points stay between the two readings they join', () => {
 const d = lineOf(sparkline([10, 90, 20, 80, 15]).markup);
 const points = [[...numbersIn(d).slice(0, 2)], ...endPoints(d)];
 d.split('C').slice(1).forEach((segment, i) => {
  const [c1x, c1y, c2x, c2y] = numbersIn(segment);
  const [x1, y1] = points[i], [x2, y2] = points[i + 1];
  for (const [value, a, b] of [[c1x, x1, x2], [c2x, x1, x2], [c1y, y1, y2], [c2y, y1, y2]]) {
   assert.ok(value >= Math.min(a, b) && value <= Math.max(a, b), value + ' outside [' + a + ', ' + b + ']');
  }
 });
});

test('smoothing leaves the readings it was given alone', () => {
 const values = [30, 45, 35];
 const copy = [...values];
 sparkline(values);
 assert.deepEqual(values, copy);
 const given = [1, 9, 2];
 assert.deepEqual(smoothSeries(given), [1, 5.25, 2]);
 assert.deepEqual(given, [1, 9, 2]);
});

// --- training volume bars -------------------------------------------------

const bucket = (start, minutes = [], unknown = 0) => ({
 start, minutes, unknown,
 sessions: minutes.length + unknown,
 total: minutes.reduce((a, b) => a + b, 0),
});
const rectsIn = markup => [...markup.matchAll(/<rect class="chart__bar--(\w+)"[^>]*y="([\d.-]+)"[^>]*width="([\d.-]+)" height="([\d.-]+)"/g)]
 .map(m => ({kind: m[1], y: Number(m[2]), width: Number(m[3]), height: Number(m[4])}));

test('a range with no workouts at all draws no bars', () => {
 const {markup, viewBox} = sessionBars([]);
 assert.equal(rectsIn(markup).length, 0);
 assert.equal(viewBox, '0 0 330 130');
 const rest = sessionBars([bucket('2026-11-09'), bucket('2026-11-10'), bucket('2026-11-11')]);
 assert.equal(rectsIn(rest.markup).length, 0, 'rest days are empty slots, not bars');
 assert.match(rest.markup, /chart__grid/, 'the scale is still drawn so the empty range reads as zero, not broken');
});

test('rest days leave their slot empty without shifting the sessions either side', () => {
 const week = [bucket('2026-11-09', [60]), bucket('2026-11-10'), bucket('2026-11-11'), bucket('2026-11-12', [60])];
 const xs = [...sessionBars(week).markup.matchAll(/<rect class="[^"]*" x="([\d.]+)"/g)].map(m => Number(m[1]));
 assert.equal(xs.length, 2, 'only the two days that were trained get a bar');
 // Four even slots across the plot area, which is 330 less the label gutter: the second bar sits
 // three steps right of the first.
 assert.ok(Math.abs((xs[1] - xs[0]) - (330 - 26) / 4 * 3) < 0.2, 'slots stay evenly spaced: ' + xs);
});

test('a single session fills a sensible part of the frame, not all of it', () => {
 const bars = rectsIn(sessionBars([bucket('2026-11-09', [20])]).markup);
 assert.equal(bars.length, 1);
 // The 30-minute floor means a 20-minute session is about half-height, not a full slab.
 assert.ok(bars[0].height > 10 && bars[0].height < (130 - 6) * 0.7, 'height ' + bars[0].height);
});

test('all-zero buckets draw nothing but keep the chart valid', () => {
 const zeroed = [{start: '2026-11-09', sessions: 0, minutes: [], unknown: 0, total: 0}];
 const {markup} = sessionBars(zeroed, {average: 0});
 assert.equal(rectsIn(markup).length, 0);
 assert.equal(/chart__line--target/.test(markup), false, 'a zero average is no average at all');
});

test('bar heights are proportional to the minutes trained', () => {
 const [short, long] = rectsIn(sessionBars([bucket('2026-11-09', [30]), bucket('2026-11-10', [90])]).markup);
 assert.ok(Math.abs(long.height / short.height - 3) < 0.05, '90 minutes should be three times 30: ' + long.height + ' vs ' + short.height);
});

test('a session is one segment, so the seams count the sessions', () => {
 const one = rectsIn(sessionBars([bucket('2026-11-09', [90])]).markup);
 const three = rectsIn(sessionBars([bucket('2026-11-09', [30, 30, 30])]).markup);
 assert.equal(one.length, 1);
 assert.equal(three.length, 3, 'three sessions, three segments');
 const stacked = three.reduce((a, r) => a + r.height, 0);
 assert.ok(stacked < one[0].height, 'the seams take height out of the same total');
 assert.ok(stacked > one[0].height - 8, 'but only the two 2px seams: ' + stacked + ' vs ' + one[0].height);
 // Segments stack upwards without overlapping.
 const tops = three.map(r => r.y);
 assert.deepEqual(tops, [...tops].sort((a, b) => b - a), 'each segment sits above the last');
});

test('a session with no length recorded still shows up, outlined', () => {
 const {markup} = sessionBars([bucket('2026-11-09', [45], 1)]);
 const bars = rectsIn(markup);
 // Outlined rather than filled grey: a grey block means "below target" on the sleep chart, and
 // this is a length nobody recorded, not a shortfall.
 assert.deepEqual(bars.map(b => b.kind), ['info', 'ghost']);
 assert.ok(bars[1].height < bars[0].height, 'the stub cannot be read as time trained');
 const onlyUnknown = rectsIn(sessionBars([bucket('2026-11-09', [], 2)]).markup);
 assert.deepEqual(onlyUnknown.map(b => b.kind), ['ghost', 'ghost'], 'a day of untimed sessions is not an empty day');
});

// The bug this guards: untimed stubs were drawn in space the minutes scale never reserved, so a
// busy bar ran off the top of the frame and the overflow was silently dropped. The headline count
// said eleven sessions and the bar drew eight.
test('a bar full of sessions draws every one of them', () => {
 const busy = bucket('2026-11-09', [60, 60, 60, 60, 60], 6);
 const bars = rectsIn(sessionBars([busy]).markup);
 assert.equal(bars.filter(b => b.kind === 'info').length, 5);
 assert.equal(bars.filter(b => b.kind === 'ghost').length, 6, 'all six untimed sessions, not three');
});

test('everything drawn stays inside the viewBox', () => {
 const cases = [
  [bucket('2026-11-09', [600])],
  [bucket('2026-11-09', [1440, 1440, 1440, 1440])],
  [bucket('2026-11-09', [1], 8)],
  Array.from({length: 30}, (_, i) => bucket('2026-11-' + i, i % 3 ? [] : [45, 20])),
  Array.from({length: 13}, () => bucket('2026-11-09', [60, 60, 60], 2)),
 ];
 for (const buckets of cases) {
  const {markup} = sessionBars(buckets, {average: 70});
  for (const r of rectsIn(markup)) {
   assert.ok(r.y >= 0 && r.y + r.height <= 130, 'bar ' + r.y + '+' + r.height + ' left the 130-tall box');
   assert.ok(r.height > 0 && r.width > 0, 'degenerate bar ' + JSON.stringify(r));
  }
  for (const m of markup.matchAll(/<rect class="[^"]*" x="([\d.]+)" y="[\d.-]+" width="([\d.]+)"/g)) {
   assert.ok(Number(m[1]) >= 0 && Number(m[1]) + Number(m[2]) <= 330, 'bar ran off the right edge');
  }
  for (const m of markup.matchAll(/y1="([\d.-]+)"/g)) assert.ok(Number(m[1]) >= 0 && Number(m[1]) <= 130);
 }
});

test('the average line is drawn only when there is an average to draw', () => {
 const buckets = [bucket('2026-11-09', [60]), bucket('2026-11-10', [30])];
 assert.match(sessionBars(buckets, {average: 45}).markup, /chart__line chart__line--target/);
 assert.equal(/chart__line--target/.test(sessionBars(buckets).markup), false);
});

test('the gridline labels read in minutes and hours', () => {
 const ticks = markup => [...markup.matchAll(/class="chart__tick"[^>]*>([^<]+)</g)].map(m => m[1]);
 assert.deepEqual(ticks(sessionBars([bucket('a', [40])]).markup), ['30m']);
 assert.deepEqual(ticks(sessionBars([bucket('a', [200])]).markup), ['1h', '2h', '3h']);
 assert.ok(ticks(sessionBars([bucket('a', [900])]).markup).every(t => /h$/.test(t)), 'long ranges stay in hours');
});

test('drawing the chart leaves the data it was given alone', () => {
 const buckets = [bucket('2026-11-09', [30, 45], 1)];
 const copy = JSON.parse(JSON.stringify(buckets));
 sessionBars(buckets, {average: 40});
 assert.deepEqual(buckets, copy);
});

// --- weekly balance reference line ----------------------------------------

const gridsIn = markup => [...markup.matchAll(/<line class="chart__grid"[^>]*y1="([\d.-]+)"[^>]*?(\/>|style)/g)].map(m => Number(m[1]));

test('the balance chart gains a labelled reference line on each side of zero', () => {
 const weeks = [{balance: -7000, partial: false}, {balance: 7000, partial: false}];
 const plain = divergingBars(weeks);
 const ticked = divergingBars(weeks, {tick: 3500, tickLabel: '1.0 lb'});
 assert.equal(gridsIn(plain.markup).length, 1, 'only the zero line without a tick');
 assert.equal(gridsIn(ticked.markup).length, 3, 'zero plus one line either side');
 const labels = [...ticked.markup.matchAll(/class="chart__tick"[^>]*>([^<]+)</g)].map(m => m[1]);
 assert.deepEqual(labels, ['1.0 lb', '1.0 lb'], 'the same label both sides; the side carries the sign');
 assert.match(ticked.markup, /<text class="chart__tick" x="330" text-anchor="end"/, 'ticks sit on the right, as on the trend chart');
 // The bars are drawn after the reference so they sit on top of it.
 assert.ok(ticked.markup.indexOf('chart__grid" x1="0" x2="330" y1="' + gridsIn(ticked.markup)[1]) < ticked.markup.indexOf('<rect'));
});

test('a reference line that would fall outside the plot is left out', () => {
 const weeks = [{balance: -500, partial: false}];
 assert.equal(gridsIn(divergingBars(weeks, {tick: 3500, tickLabel: '1 lb'}).markup).length, 1, 'no room for either line');
 for (const tick of [null, 0, -3500, NaN]) {
  assert.equal(gridsIn(divergingBars([{balance: -7000, partial: false}], {tick}).markup).length, 1, 'no reference for tick ' + tick);
 }
});

test('existing balance callers are unaffected by the new options', () => {
 const weeks = [{balance: -1200, partial: false}, {balance: 800, partial: true}];
 const {markup, viewBox} = divergingBars(weeks);
 assert.equal(viewBox, '0 0 330 150');
 assert.match(markup, /chart__bar--under/);
 assert.match(markup, /chart__bar--over[^>]*opacity="0.55"/);
});

test('a tick label cannot break out of the markup', () => {
 const {markup} = divergingBars([{balance: -7000, partial: false}], {tick: 3500, tickLabel: '<script>&'});
 assert.equal(/<script>/.test(markup), false);
 assert.match(markup, /&lt;script&gt;&amp;/);
});
