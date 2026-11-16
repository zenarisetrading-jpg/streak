// Portion weights: read the grams from a portion description, and rescale a food's macros when
// its weight changes, keeping its per-gram make-up (180 g → 150 g gives 5/6 of each macro).
// "180 g", "180g", "180 gm", "180 grams", "0.2 kg", "1,5 kg", "250 ml", "0.5 l". Liquids count 1 ml as 1 g.
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(kilograms?|kilos?|kgs?|grams?|gms?|gm|g|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l)\b/i;
const THOUSAND = /^(kilo|kg|lit|l$)/i;
const LIQUID = /^(milli|ml|lit|l$)/i;
const round1 = n => Math.round(n * 10) / 10;

// Measures and counts in a portion description: "1.5 cups", "3 tablespoons", "2 rotis".
// Vessels are left out on purpose. A bowl holding 150 g instead of 180 g is still a bowl, and
// "0.8 bowl" reads worse than the round number it replaced.
const HOUSEHOLD = /(\d+(?:[.,]\d+)?)(\s*(?:[×x]\s*)?)(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|spoons?|pieces?|slices?|rotis?|chapatis?|phulkas?|scoops?|eggs?|idlis?|samosas?)\b/i;
// Things you count come in halves at best; things you measure can take a decimal.
const COUNTED = /^(pieces?|slices?|rotis?|chapatis?|phulkas?|eggs?|scoops?)$/i;

// The description with its household count scaled to match a new weight, so "1.5 cups (250 g)"
// corrected down to 120 g reads "0.7 cups (120 g)" rather than keeping a count twice the truth.
export function scaleHousehold(text, factor) {
 const portion = String(text || '');
 if (!(factor > 0) || factor === 1) return portion;
 if (!HOUSEHOLD.test(portion)) return portion;
 return portion.replace(HOUSEHOLD, (whole, amount, gap, unit) => {
  const scaled = Number(amount.replace(',', '.')) * factor;
  const rounded = COUNTED.test(unit) ? Math.round(scaled * 2) / 2 : round1(scaled);
  // A count that rounds away would read as "0 rotis", so leave the phrase out altogether.
  // "1 rotis" reads as a mistake, so a count of exactly one drops the plural.
  const named = rounded === 1 ? unit.replace(/s$/i, '') : unit;
  return rounded > 0 ? rounded + gap + named : '';
 }).replace(/\s{2,}/g, ' ').replace(/^[\s,]+/, '').trim();
}

export function gramsIn(text) {
 const match = AMOUNT.exec(String(text || ''));
 if (!match) return null;
 const amount = Number(match[1].replace(',', '.'));
 return THOUSAND.test(match[2]) ? amount * 1000 : amount;
}

// The portion text with its amount updated (in g, or ml for drinks), or the amount added if it had none.
export function withGrams(text, grams) {
 const portion = String(text || '').trim();
 const amount = Math.round(grams);
 if (AMOUNT.test(portion)) return portion.replace(AMOUNT, (_, _n, unit) => amount + (LIQUID.test(unit) ? ' ml' : ' g'));
 return (portion ? portion + ' ' : '') + '(' + amount + ' g)';
}

export const itemGrams = item => item?.grams > 0 ? item.grams : gramsIn(item?.assumption);

export function rescale(item, grams) {
 const from = itemGrams(item);
 if (!(grams > 0)) return item;
 if (!(from > 0)) return {...item, grams, assumption: withGrams(item.assumption, grams)};
 const factor = grams / from;
 return {...item, grams, assumption: withGrams(scaleHousehold(item.assumption, factor), grams), protein: round1(item.protein * factor), carbs: round1(item.carbs * factor), fat: round1(item.fat * factor)};
}
