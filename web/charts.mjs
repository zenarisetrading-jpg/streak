// SVG chart markup for the design system's chart classes (see DESIGN.md).
// Inputs are numbers only, so the markup can be inserted as HTML safely.
const W = 330;
const r1 = n => Math.round(n * 10) / 10;
const finite = v => typeof v === 'number' && Number.isFinite(v);
// Every other input here is a number, so the markup is safe to insert as HTML. Tick labels are
// the one string that reaches the SVG (a formatted weight, which units.mjs builds), so escape it
// rather than make the whole module's safety depend on that one caller staying numeric.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function scale(values, {min, max, pad = 0.08} = {}) {
 const nums = values.filter(finite);
 const lo = min ?? Math.min(...nums);
 const hi = max ?? Math.max(...nums);
 const span = hi - lo || 1;
 return {lo: lo - span * pad, hi: hi + span * pad};
}

const path = pts => pts.map(([x, y], i) => (i ? 'L' : 'M') + r1(x) + ' ' + r1(y)).join(' ');
const move = ([x, y]) => 'M' + r1(x) + ' ' + r1(y);

// A single night's HRV or resting heart rate is mostly noise, and drawn raw it looks like an
// ECG trace. Each point is averaged with the days either side (weighted 1-2-1) so the line shows
// the trend the number actually carries. The first and last readings are left where they are.
export function smoothSeries(values) {
 if (values.length < 3) return [...values];
 return values.map((value, i) => (i === 0 || i === values.length - 1 ? value : (values[i - 1] + value * 2 + values[i + 1]) / 4));
}

// How far each control point reaches towards its neighbour. Larger is tighter to the readings.
const TENSION = 6;
const between = (value, a, b) => Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b));

// A Catmull-Rom spline written as cubic Béziers: one calm curve that still passes through
// every reading. Control points are held between the two readings they join, so the curve
// cannot bulge past them into a spike or dip that was never measured.
export function curvePath(pts) {
 if (pts.length < 3) return path(pts);
 let d = move(pts[0]);
 for (let i = 0; i < pts.length - 1; i++) {
  const before = pts[i - 1] ?? pts[i], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], after = pts[i + 2] ?? pts[i + 1];
  // Both axes are held inside the segment. Clamping y alone leaves the curve free to hook
  // backwards when readings are unevenly spaced, which happens whenever the Watch misses a day.
  const c1 = [between(x1 + (x2 - before[0]) / TENSION, x1, x2), between(y1 + (y2 - before[1]) / TENSION, y1, y2)];
  const c2 = [between(x2 - (after[0] - x1) / TENSION, x1, x2), between(y2 - (after[1] - y1) / TENSION, y1, y2)];
  d += ' C' + [c1, c2, [x2, y2]].map(([x, y]) => r1(x) + ' ' + r1(y)).join(' ');
 }
 return d;
}

// Daily intake bars (green under, red over) with the allowance as a dashed step line.
// days: [{eaten: number|null, allowance: number|null}]
export function intakeBars(days, {height = 150} = {}) {
 const top = Math.max(...days.flatMap(d => [d.eaten ?? 0, d.allowance ?? 0]), 1) * 1.15;
 const base = height - 6;
 const y = v => base - v / top * (base - 6);
 const step = W / Math.max(days.length, 1);
 const barW = Math.max(2, Math.min(14, step * 0.62));
 const out = [];
 for (const tick of [1000, 2000, 3000, 4000].filter(t => t < top)) {
  out.push(`<line class="chart__grid" x1="0" x2="${W}" y1="${r1(y(tick))}" y2="${r1(y(tick))}"/>`, `<text class="chart__tick" x="0" y="${r1(y(tick) - 4)}">${tick / 1000}k</text>`);
 }
 days.forEach((d, i) => {
  if (!(d.eaten > 0)) return;
  const over = d.allowance !== null && d.eaten > d.allowance;
  const x = i * step + (step - barW) / 2;
  out.push(`<rect class="chart__bar--${over ? 'over' : 'under'}" x="${r1(x)}" y="${r1(y(d.eaten))}" width="${r1(barW)}" height="${r1(base - y(d.eaten))}" rx="${r1(barW / 2)}"/>`);
 });
 const line = [];
 days.forEach((d, i) => { if (finite(d.allowance)) line.push([i * step, y(d.allowance)], [(i + 1) * step, y(d.allowance)]); });
 if (line.length) out.push(`<path class="chart__line chart__line--target" d="${path(line)}"/>`);
 return {viewBox: `0 0 ${W} ${height}`, markup: out.join('')};
}

// Raw points as neutral dots plus a smoothed accent line with an area fill.
// points: [{i, value}] on a 0..count-1 index axis; trend: same shape.
export function trendLine(points, trend, count, {height = 130, unitTicks = 1, target = null} = {}) {
 const all = [...points, ...trend].map(p => p.value).concat(finite(target) ? [target] : []);
 if (!all.length) return {viewBox: `0 0 ${W} ${height}`, markup: ''};
 const {lo, hi} = scale(all, {pad: 0.15});
 const x = i => 4 + i / Math.max(count - 1, 1) * (W - 8);
 const y = v => height - 8 - (v - lo) / (hi - lo) * (height - 16);
 const out = [];
 const first = Math.ceil(lo / unitTicks) * unitTicks;
 const step = Math.max(unitTicks, Math.ceil((hi - lo) / 3 / unitTicks) * unitTicks);
 for (let t = first; t <= hi; t += step) {
  out.push(`<line class="chart__grid" x1="0" x2="${W}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>`, `<text class="chart__tick" x="${W}" text-anchor="end" y="${r1(y(t) - 4)}">${r1(t)}</text>`);
 }
 if (finite(target)) out.push(`<line class="chart__line chart__line--target" x1="0" x2="${W}" y1="${r1(y(target))}" y2="${r1(y(target))}"/>`);
 const line = trend.map(p => [x(p.i), y(p.value)]);
 if (line.length > 1) out.push(`<path class="chart__area" d="${path([...line, [line[line.length - 1][0], height], [line[0][0], height]])} Z"/>`);
 for (const p of points) out.push(`<circle cx="${r1(x(p.i))}" cy="${r1(y(p.value))}" r="2.5" fill="var(--color-chart-neutral)"/>`);
 if (line.length > 1) out.push(`<path class="chart__line" d="${path(line)}"/>`);
 if (line.length) { const [lx, ly] = line[line.length - 1]; out.push(`<circle class="chart__dot" cx="${r1(lx)}" cy="${r1(ly)}" r="5"/>`); }
 return {viewBox: `0 0 ${W} ${height}`, markup: out.join('')};
}

// Weekly balance: deficits drop below the zero line in green, surpluses rise in red.
// weeks: [{balance: number|null, partial: boolean}]
// tick/tickLabel draw one labelled reference line either side of zero. Without it a bar's
// height is pure relative scale, so the same bar can mean 1,200 kcal or 9,000 and the reader
// cannot tell; at 3,500 the line reads as one pound, the unit the person actually thinks in.
export function divergingBars(weeks, {height = 150, tick = null, tickLabel = ''} = {}) {
 const vals = weeks.map(w => w.balance).filter(finite);
 const up = Math.max(0, ...vals), down = Math.max(0, ...vals.map(v => -v));
 const total = up + down || 1;
 const zero = 8 + (height - 16) * up / total;
 const unit = (height - 16) / total;
 const step = W / Math.max(weeks.length, 1);
 const barW = Math.min(28, step * 0.6);
 const out = [`<line class="chart__grid" x1="0" x2="${W}" y1="${r1(zero)}" y2="${r1(zero)}" style="stroke:var(--color-text-muted)"/>`];
 // Drawn before the bars so the bars sit on top of the reference, and left plain so the zero
 // line (which keeps its muted stroke override) stays the dominant rule.
 if (finite(tick) && tick > 0) {
  for (const y of [zero - tick * unit, zero + tick * unit]) {
   if (y < 8 || y > height - 8) continue;
   out.push(`<line class="chart__grid" x1="0" x2="${W}" y1="${r1(y)}" y2="${r1(y)}"/>`, `<text class="chart__tick" x="${W}" text-anchor="end" y="${r1(y - 4)}">${esc(tickLabel)}</text>`);
  }
 }
 weeks.forEach((w, i) => {
  if (!finite(w.balance) || w.balance === 0) return;
  const h = Math.max(2, Math.abs(w.balance) * unit);
  const x = i * step + (step - barW) / 2;
  const yTop = w.balance > 0 ? zero - h - 2 : zero + 2;
  out.push(`<rect class="chart__bar--${w.balance > 0 ? 'over' : 'under'}" x="${r1(x)}" y="${r1(yTop)}" width="${r1(barW)}" height="${r1(h)}" rx="${r1(Math.min(7, barW / 3))}"${w.partial ? ' opacity="0.55"' : ''}/>`);
 });
 return {viewBox: `0 0 ${W} ${height}`, markup: out.join('')};
}

// Training volume. A bar's height is the minutes trained in the bucket and each session inside
// it is its own segment, so how long and how often read off one chart without a second axis.
// Sessions saved without a length get a short muted cap: the count stays true and the missing
// length is visible instead of silently dropped.
// buckets: [{start, sessions, minutes: number[], unknown, total}]
// What a session with no recorded length is worth on the minutes scale. It has to be something,
// or the stub takes space the scale did not reserve; short enough that it cannot flatter a week.
const UNTIMED_MINUTES = 10;
// Width reserved on the left for the hour labels, so they never sit over a bar.
const GUTTER = 26;
export function sessionBars(buckets, {height = 130, average = null} = {}) {
 // A session with no recorded length is drawn as a short stub. It has to be worth something on
 // the minutes scale as well, or the stubs take space the scale never reserved and the segments
 // above them fall off the top of the frame — which silently dropped sessions from a busy bar.
 const drawn = b => (finite(b?.total) ? b.total : 0) + Math.max(0, Math.round(b?.unknown) || 0) * UNTIMED_MINUTES;
 // The 30-minute floor stops one short session from filling the frame.
 const top = Math.max(30, ...buckets.map(drawn)) * 1.15;
 const base = height - 6;
 const y = v => base - v / top * (base - 6);
 // A gutter on the left for the hour labels. Drawn over the bars they were unreadable, and the
 // bars behind them were too — the chart needs the scale, so the scale gets its own column.
 const plot = W - GUTTER;
 const step = plot / Math.max(buckets.length, 1);
 // Capped at 20 (wider than sleepBars) because the weekly view has only 13 slots to fill.
 const barW = Math.max(3, Math.min(20, step * 0.62));
 const rx = r1(Math.min(4, barW / 2));
 const out = [];
 const gridStep = [30, 60, 120, 180, 300].find(g => top / g <= 4) ?? 600;
 for (let t = gridStep; t < top; t += gridStep) {
  const label = t < 60 ? t + 'm' : (t % 60 === 0 ? t / 60 + 'h' : r1(t / 60) + 'h');
  out.push(`<line class="chart__grid" x1="${GUTTER}" x2="${W}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>`, `<text class="chart__tick" x="0" y="${r1(y(t) + 3)}">${label}</text>`);
 }
 buckets.forEach((b, i) => {
  if (!(b?.sessions > 0)) return; // a rest day is an empty slot, not missing data
  const x = GUTTER + i * step + (step - barW) / 2;
  const px = v => Math.max(3, v / top * (base - 6));
  const lengths = (b.minutes || []).filter(v => finite(v) && v > 0).map(px);
  const caps = Array(Math.max(0, Math.round(b.unknown) || 0)).fill(px(UNTIMED_MINUTES));
  const segments = [...lengths.map(h => [h, 'info']), ...caps.map(h => [h, 'ghost'])];
  let cursor = base;
  for (let n = 0; n < segments.length; n++) {
   const [segH, kind] = segments[n];
   if (cursor - segH < 6) break; // drawn() reserves every segment's space, so this is a belt-and-braces guard
   const last = n === segments.length - 1;
   // Shortening every segment but the last by 2px shows the card through as a seam, so the
   // number of sessions is readable without drawing a divider element.
   out.push(`<rect class="chart__bar--${kind}" x="${r1(x)}" y="${r1(cursor - segH)}" width="${r1(barW)}" height="${r1(segH - (last ? 0 : 2))}" rx="${rx}"/>`);
   cursor -= segH;
  }
 });
 // Drawn last so it sits over the bars. An average taller than the tallest bar cannot happen
 // (it is their mean), but a caller passing one would put the line off the top, so it is checked.
 if (finite(average) && average > 0 && y(average) >= 6) out.push(`<line class="chart__line chart__line--target" x1="${GUTTER}" x2="${W}" y1="${r1(y(average))}" y2="${r1(y(average))}"/>`);
 return {viewBox: `0 0 ${W} ${height}`, markup: out.join('')};
}

// Nightly sleep bars: blue at or above target, neutral below, dashed target line.
export function sleepBars(hours, target, {height = 110} = {}) {
 const top = Math.max(target * 1.3, ...hours.filter(finite));
 const y = v => height - 4 - v / top * (height - 10);
 const step = W / Math.max(hours.length, 1);
 const barW = Math.max(3, Math.min(16, step * 0.6));
 const out = [];
 hours.forEach((h, i) => {
  if (!(h > 0)) return;
  const x = i * step + (step - barW) / 2;
  out.push(`<rect class="chart__bar--${h >= target ? 'info' : 'muted'}" x="${r1(x)}" y="${r1(y(h))}" width="${r1(barW)}" height="${r1(height - 4 - y(h))}" rx="${r1(barW / 2)}"/>`);
 });
 out.push(`<line class="chart__line chart__line--target" x1="0" x2="${W}" y1="${r1(y(target))}" y2="${r1(y(target))}"/>`);
 return {viewBox: `0 0 ${W} ${height}`, markup: out.join('')};
}

// 120×40 sparkline; gaps (null) are skipped.
export function sparkline(values, {area = false, cls = '', smooth = true} = {}) {
 const pts = values.map((v, i) => [i, v]).filter(([, v]) => finite(v));
 if (pts.length < 2) return {viewBox: '0 0 120 40', markup: ''};
 const {lo, hi} = scale(pts.map(([, v]) => v), {pad: 0.1});
 const x = i => 3 + i / Math.max(values.length - 1, 1) * 114;
 const y = v => 36 - (v - lo) / (hi - lo) * 32;
 const drawn = smooth ? smoothSeries(pts.map(([, v]) => v)) : pts.map(([, v]) => v);
 const line = pts.map(([i], n) => [x(i), y(drawn[n])]);
 const d = smooth ? curvePath(line) : path(line);
 const out = [];
 if (area) out.push(`<path class="chart__area ${cls ? 'chart__area--' + cls : ''}" d="${d} ${path([[line[line.length - 1][0], 40], [line[0][0], 40]]).replace('M', 'L')} Z"/>`);
 out.push(`<path class="chart__line ${cls ? 'chart__line--' + cls : ''}" d="${d}"/>`);
 return {viewBox: '0 0 120 40', markup: out.join('')};
}

// Puts chart markup into an <svg> element and labels it for screen readers.
export function draw(svg, {viewBox, markup}, label) {
 svg.setAttribute('viewBox', viewBox);
 svg.setAttribute('role', 'img');
 svg.setAttribute('aria-label', label);
 svg.innerHTML = markup;
}
