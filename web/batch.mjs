// Logging a dish by the pot instead of the plate.
// For anything cooked in bulk — biryani, dal, curry, pulao — what went in the pot and how many
// ate from it are numbers the cook already knows, and dividing them beats judging a serving by
// eye. It also sidesteps raw-versus-cooked entirely: boiling rice only adds water, so the
// macros of the dry rice are the macros of the whole pot.
import {scaleItems} from './recent.mjs';

export const MAX_SERVINGS = 50;

// One person's share, or null when the numbers do not describe a share of anything.
export function shareFactor(made, ate = 1) {
 const servings = Number(made), portions = Number(ate);
 if (!Number.isFinite(servings) || !Number.isFinite(portions)) return null;
 if (!(servings >= 1) || servings > MAX_SERVINGS) return null;
 if (!(portions > 0) || portions > servings) return null;
 return portions / servings;
}

// The whole pot's items cut down to the share eaten. Invalid numbers leave the items alone,
// so a half-typed serving count can never silently shrink a meal.
export function splitBatch(items, made, ate = 1) {
 const factor = shareFactor(made, ate);
 return factor === null ? items : scaleItems(items, factor);
}

const tidy = n => String(Math.round(Number(n) * 100) / 100);

export function shareLabel(made, ate = 1) {
 if (shareFactor(made, ate) === null) return '';
 return Number(ate) === 1
  ? 'Your share: 1 of ' + tidy(made) + (Number(made) === 1 ? ' serving' : ' servings')
  : 'Your share: ' + tidy(ate) + ' of ' + tidy(made) + ' servings';
}
