// Body weight is stored in pounds everywhere (check-ins, goals, the maths). Each person picks lb or kg
// in About you, and these helpers convert at the edges: what is shown and what is typed in.
export const KG_PER_LB = 0.45359237;
export const WEIGHT_UNITS = ['lb', 'kg'];
const MIN_LB = 50;
const MAX_LB = 700;
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

export const unitOf = settings => settings?.weightUnit === 'kg' ? 'kg' : 'lb';
export const toUnit = (lb, unit) => unit === 'kg' ? lb * KG_PER_LB : lb;
// Pounds kept to two places so a kg value typed in shows the same kg value back.
export const fromUnit = (value, unit) => round(unit === 'kg' ? value / KG_PER_LB : value, 2);

// "228 lb", "103.4 kg": the value as typed, to one decimal.
export const weightText = (lb, unit) => round(toUnit(lb, unit), 1) + ' ' + unit;
// "+1.2 lb", "−0.5 kg": a change, always with one decimal.
export function weightChange(lb, unit) {
 const value = toUnit(lb, unit);
 return (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toFixed(1) + ' ' + unit;
}
// The accepted range for a typed weight, in the person's unit.
export const weightRange = unit => ({min: Math.ceil(toUnit(MIN_LB, unit)), max: Math.floor(toUnit(MAX_LB, unit))});
// The value to put in an input box: blank when there is no weight.
export const inputValue = (lb, unit) => Number(lb) > 0 ? String(round(toUnit(Number(lb), unit), 1)) : '';

// A typed weight in the person's unit → pounds, or null when it is outside the accepted range.
export function parseWeight(text, unit) {
 const value = Number(String(text).replace(',', '.'));
 const {min, max} = weightRange(unit);
 return value >= min && value <= max ? fromUnit(value, unit) : null;
}

export const heightText = (inches, unit) => unit === 'kg' ? Math.round(inches * 2.54) + ' cm' : null;
