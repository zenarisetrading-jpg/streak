// Past meals and workouts to log again in one tap: the latest of each distinct one, newest first.
import {rescale, itemGrams} from './portion.mjs';

const MEALS_SHOWN = 8;
const WORKOUTS_SHOWN = 6;
const LABEL_LENGTH = 32;
const round1 = n => Math.round(n * 10) / 10;
const sameName = text => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Every entry on or before upTo, with its date, newest day and latest logging time first.
function newestFirst(data, upTo) {
 return Object.entries(data || {})
  .filter(([date, entries]) => date <= upTo && Array.isArray(entries))
  .flatMap(([date, entries]) => entries.map((entry, order) => ({entry: {...entry, date}, order})))
  .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || (b.entry.at || 0) - (a.entry.at || 0) || b.order - a.order)
  .map(({entry}) => entry);
}

function distinct(entries, nameOf, limit) {
 const seen = new Set();
 return entries.filter(entry => {
  const name = sameName(nameOf(entry));
  if (!name || seen.has(name)) return false;
  seen.add(name);
  return true;
 }).slice(0, limit);
}

// Meals with at least one counted food; those logged as the chosen meal time come first.
export function recentMeals(data, {upTo, kind = null, limit = MEALS_SHOWN}) {
 const meals = newestFirst(data, upTo).filter(meal => meal.items?.length);
 const ordered = kind ? [...meals.filter(m => m.kind === kind), ...meals.filter(m => m.kind !== kind)] : meals;
 return distinct(ordered, meal => meal.text, limit);
}

export function recentWorkouts(data, {upTo, limit = WORKOUTS_SHOWN}) {
 return distinct(newestFirst(data, upTo), workout => workout.title, limit);
}

// The same foods at `factor` times the amount: weights and macros scale together.
export function scaleItems(items, factor) {
 if (factor === 1) return items;
 return items.map(item => {
  const grams = itemGrams(item);
  if (grams > 0) return rescale(item, Math.round(grams * factor));
  return {...item, protein: round1(item.protein * factor), carbs: round1(item.carbs * factor), fat: round1(item.fat * factor)};
 });
}

// A name short enough for a chip, cut on a word.
export function shortLabel(text, max = LABEL_LENGTH) {
 const name = String(text || '').trim();
 if (name.length <= max) return name;
 const cut = name.slice(0, max - 1);
 const space = cut.lastIndexOf(' ');
 return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}
