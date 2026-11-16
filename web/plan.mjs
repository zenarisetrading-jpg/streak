// The plan under today's calorie ring: roughly how many meals are left, what each should be, and
// which macro is the gap or already spent, with ideas from the household's usual food.
import {fmt} from './store.mjs';

const LEAN = 'chicken, fish, eggs, paneer, dal or Greek yogurt';
const NEARLY_DONE_KCAL = 300;
const PROTEIN_GAP_G = 15;
const SPENT = 0.9;

const round10 = n => Math.round(n / 10) * 10;
const mealsLeftAt = hour => hour < 11 ? 3 : hour < 16 ? 2 : 1;

// sum: grams eaten so far {protein, carbs, fat}; targets: from macroTargets(); hour: 0–23.
export function restOfDayPlan({eaten, allowance, sum, targets, hour, meals}) {
 if (allowance === null) return {title: 'Set your daily allowance', lines: ['Open Settings from your picture at the top and set a calorie target. Then this plans the rest of each day for you.']};
 const left = allowance - eaten;
 if (left < 0) return {title: fmt(-left) + ' kcal over today', lines: [
  'Keep the rest of today to water, tea without sugar or a light protein snack.',
  'A 30-minute brisk walk burns roughly 150 to 200 kcal.',
  'One over day barely moves the week. The weekly balance below shows where you stand.',
 ]};
 if (left < NEARLY_DONE_KCAL) return {title: 'Nearly at your allowance', lines: [fmt(left) + ' kcal left. If you are hungry, keep it light and high in protein: Greek yogurt, eggs or a protein shake.']};

 const mealsLeft = mealsLeftAt(hour);
 const proteinLeft = targets ? Math.max(0, targets.protein - sum.protein) : 0;
 const perMeal = round10(left / mealsLeft);
 const proteinPerMeal = Math.round(proteinLeft / mealsLeft / 5) * 5;
 const lines = [(meals ? 'About ' : 'Today: about ') + mealsLeft + (mealsLeft === 1 ? ' meal' : ' meals') + ' left, around ' + fmt(perMeal) + ' kcal' + (proteinLeft > PROTEIN_GAP_G && proteinPerMeal >= 10 ? ' and ' + proteinPerMeal + ' g protein' : '') + (mealsLeft === 1 ? '.' : ' each.')];
 if (targets) {
  lines.push(proteinLeft > PROTEIN_GAP_G
   ? 'Protein is the gap: ' + Math.round(sum.protein) + ' of ' + targets.protein + ' g so far. Build ' + (mealsLeft === 1 ? 'it' : 'each meal') + ' around ' + LEAN + '.'
   : 'Protein is on track at ' + Math.round(sum.protein) + ' g.');
  const fatSpent = sum.fat >= targets.fat * SPENT, carbsSpent = sum.carbs >= targets.carbs * SPENT;
  if (fatSpent) lines.push('Fat is nearly used up (' + Math.round(sum.fat) + ' of ' + targets.fat + ' g), so pick grilled or tandoori over fried and go easy on ghee and oil.');
  if (carbsSpent) lines.push('Carbs are covered (' + Math.round(sum.carbs) + ' of ' + targets.carbs + ' g), so fill up on vegetables and salad rather than rice or roti.');
  if (!fatSpent && !carbsSpent) lines.push('Carbs and fat have room, so a normal plate with roti or rice and sabzi fits.');
 }
 return {title: left >= 500 ? 'Plan for the rest of today' : 'Keep the rest of today light', lines};
}
