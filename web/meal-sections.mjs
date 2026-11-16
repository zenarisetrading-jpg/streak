// Groups a day's meals into Breakfast, Lunch, Dinner and snacks, in eating order, each with a subtotal.
// Snacks and drinks go where their logging time puts them (before lunch, afternoon, after dinner);
// a snack with no time on that day (older entries, or logged later for a past date) goes last.
import {energy, totals} from './nutrition.mjs';
import {localToday} from './store.mjs';

const SNACK = 'Snack / drink';
const ORDER = ['Breakfast', 'Morning snacks', 'Lunch', 'Afternoon snacks', 'Dinner', 'Evening snacks', 'Snacks & drinks'];
const MORNING_END = 12;
const AFTERNOON_END = 18;

// The hour the entry was logged, when that was on the meal's own date; otherwise null.
export function loggedHour(entry, date) {
 if (!(entry?.at > 0) || localToday(new Date(entry.at)) !== date) return null;
 return new Date(entry.at).getHours();
}

export function sectionOf(entry, date) {
 if (entry.kind !== SNACK) return ORDER.includes(entry.kind) ? entry.kind : 'Snacks & drinks';
 const hour = loggedHour(entry, date);
 if (hour === null) return 'Snacks & drinks';
 return hour < MORNING_END ? 'Morning snacks' : hour < AFTERNOON_END ? 'Afternoon snacks' : 'Evening snacks';
}

// [{name, entries, sum: {protein, carbs, fat}, kcal, partial}] in eating order, empty sections left out.
export function groupMeals(entries, date) {
 return ORDER.map(name => {
  const list = entries.filter(entry => sectionOf(entry, date) === name).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!list.length) return null;
  const sum = totals(list.flatMap(entry => entry.items));
  return {name, entries: list, sum, kcal: energy(sum), partial: list.some(entry => entry.unknown?.length)};
 }).filter(Boolean);
}

// Which of the four colours a section wears. The three snack sections share one, because they
// are the same kind of eating at different hours; the colour says what it is, not when it was.
// Kept here beside the sections themselves so the list and the headings cannot disagree.
const TYPES = {Breakfast: 'breakfast', Lunch: 'lunch', Dinner: 'dinner'};
export const typeOf = name => TYPES[name] ?? 'snack';

// A single entry's colour. A snack logged at breakfast time is still a snack: the entry's own
// kind decides, not the section it was filed under.
export const typeOfEntry = entry => TYPES[entry?.kind] ?? 'snack';

// The meal picker's starting choice for the time of day.
export const kindForHour = hour => hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? SNACK : hour < 22 ? 'Dinner' : SNACK;
