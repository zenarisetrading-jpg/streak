// The About you figure: an illustrated person in sportswear standing beside a height ruler.
// It scales with height, switches person with sex, and gains speed lines with activity.
// Numbers in, SVG markup out (no user text is inserted).
const VIEW_W = 150;
const VIEW_H = 230;
const GROUND = 218;
const PX_PER_IN = (GROUND - 14) / 84; // a 7 ft person reaches the top tick
const CENTER_X = 92;
const RULER_X = 22;
const ARCS = {sedentary: 0, light: 1, moderate: 2, very: 3};

const r1 = n => Math.round(n * 10) / 10;

// Illustrations trimmed to the person, so the image top is the top of the head and the bottom the soles.
const PEOPLE = {male: {src: '/img/man.webp', aspect: 211 / 496}, female: {src: '/img/woman.webp', aspect: 225 / 486}};

export const heightLabel = inches => Math.floor(inches / 12) + '′' + (inches % 12) + '″';

// Where the figure sits for a height: the image is 100 units tall, scaled so its head reaches the height.
function placement(heightIn, aspect = PEOPLE.male.aspect) {
 const scale = heightIn * PX_PER_IN / 100;
 return {scale: r1(scale * 1000) / 1000, x: r1(CENTER_X - 50 * aspect * scale), y: r1(GROUND - 100 * scale), top: r1(GROUND - heightIn * PX_PER_IN)};
}

export function figureMarkup({heightIn, sex, activity}) {
 const person = PEOPLE[sex] || PEOPLE.male;
 const p = placement(heightIn, person.aspect);
 const ticks = [];
 for (let ft = 4; ft <= 7; ft++) {
  const y = r1(GROUND - ft * 12 * PX_PER_IN);
  ticks.push(`<line class="ruler__tick" x1="${RULER_X - 6}" x2="${RULER_X + 6}" y1="${y}" y2="${y}"/><text class="ruler__label" x="${RULER_X - 10}" y="${y + 4}" text-anchor="end">${ft}′</text>`);
  if (ft < 7) for (let i = 3; i < 12; i += 3) { const yy = r1(GROUND - (ft * 12 + i) * PX_PER_IN); ticks.push(`<line class="ruler__tick ruler__tick--minor" x1="${RULER_X - 3}" x2="${RULER_X + 3}" y1="${yy}" y2="${yy}"/>`); }
 }
 // Speed lines trailing behind the figure, more of them as activity rises.
 const arcs = Array.from({length: ARCS[activity] ?? 0}, (_, i) => {
  const right = CENTER_X - 34 * p.scale - 4, y = GROUND - (70 - i * 12) * p.scale, length = 10 + i * 4;
  return `<path class="figure__motion" style="--i:${i}" d="M${r1(right - length)} ${r1(y)} L${r1(right)} ${r1(y)}"/>`;
 }).join('');
 return `<line class="ruler__spine" x1="${RULER_X}" x2="${RULER_X}" y1="${r1(GROUND - 84 * PX_PER_IN)}" y2="${GROUND}"/>${ticks.join('')}`
  + `<ellipse class="figure__shadow" cx="${CENTER_X}" cy="${GROUND}" rx="${r1(16 * p.scale + 6)}" ry="3"/>`
  + `<line class="figure__mark" x1="${RULER_X}" x2="${CENTER_X}" y1="${p.top}" y2="${p.top}"/>`
  + arcs
  + `<g class="figure__body${sex ? '' : ' figure__body--unset'}" style="transform: translate(${p.x}px, ${p.y}px) scale(${p.scale})"><image href="${person.src}" width="${r1(100 * person.aspect)}" height="100"/></g>`;
}

export const FIGURE_VIEWBOX = `0 0 ${VIEW_W} ${VIEW_H}`;
