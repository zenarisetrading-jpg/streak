import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatSets, parseSets, oneRepMax, exerciseProgress, scaledKcal, absorbWatchSession} from '../web/workout-math.mjs';

test('sets round-trip through editable text', () => {
 const sets = [{reps: 8, weight: 135}, {reps: 8, weight: 135}, {reps: 6, weight: 145}];
 assert.equal(formatSets(sets), '2×8 @ 135, 6 @ 145');
 assert.deepEqual(parseSets('2×8 @ 135, 6 @ 145').sets, sets);
 assert.deepEqual(parseSets('3x10').sets, [{reps: 10, weight: null}, {reps: 10, weight: null}, {reps: 10, weight: null}]);
 assert.deepEqual(parseSets('12 at 50.5').sets, [{reps: 12, weight: 50.5}]);
 assert.deepEqual(parseSets('').sets, []);
 const noReps = [{reps: null, weight: 30}, {reps: null, weight: 30}, {reps: null, weight: null}];
 assert.equal(formatSets(noReps), '2×@ 30');
 assert.deepEqual(parseSets(formatSets(noReps)).sets, noReps.slice(0, 2));
 assert.deepEqual(parseSets('8 @ 135 lb').sets, [{reps: 8, weight: 135}]);
 assert.match(parseSets('heavy').error, /3×8/);
 assert.match(parseSets('30x5').error, /Up to 20/);
 assert.match(parseSets('99999999999x5').error, /Up to 20/);
 assert.match(parseSets('0x5').error, /3×8/);
});

test('progress compares each exercise with its previous session', () => {
 const workouts = {
  '2026-11-05': [{exercises: [{name: 'Bench press', sets: [{reps: 8, weight: 135}], unit: 'lb'}]}],
  '2026-11-12': [{exercises: [{name: 'bench press ', sets: [{reps: 6, weight: 150}, {reps: 8, weight: 140}], unit: 'lb'}, {name: 'Treadmill walk', sets: [], distanceKm: 2}]}],
 };
 const [bench, walk] = exerciseProgress(workouts).sort((a, b) => a.name.localeCompare(b.name));
 assert.equal(bench.sessions, 2);
 assert.deepEqual(bench.latest.best, {reps: 6, weight: 150});
 assert.equal(bench.trend, 1);
 assert.equal(walk.trend, null);
 assert.equal(Math.round(oneRepMax({reps: 8, weight: 135})), 171);
});

test('changing the minutes rescales the calorie estimate', () => {
 assert.equal(scaledKcal({minutes: 60, kcal: 300}, 45), 225);
 assert.equal(scaledKcal({minutes: null, kcal: 300}, 45), 300);
 assert.equal(scaledKcal({minutes: 60, kcal: 0}, 45), 0);
 assert.equal(scaledKcal({minutes: 60, kcal: 300}, null), 300);
});

test('a session logged after the Watch sent it takes over the Watch session instead of counting twice', () => {
 const watch = {id: 'watch-0939am', source: 'watch', title: 'Apple Watch workout', minutes: 47, kcal: 428, exercises: [], watch: {minutes: 47, kcal: 428}};
 const other = {id: 'x', title: 'Elliptical', minutes: 10, kcal: 75, exercises: []};
 const typed = {id: 'm1', title: 'Incline walk', minutes: 45, kcal: 330, exercises: [{name: 'Walk'}]};
 assert.deepEqual(absorbWatchSession(typed, [other, watch]), {entry: {...typed, kcal: 428, watchId: 'watch-0939am', watch: {minutes: 47, kcal: 428}}, replaces: 'watch-0939am'});
 assert.equal(absorbWatchSession({...typed, minutes: 90}, [watch, {...watch, id: 'watch-1200pm', minutes: 30}]).replaces, null);
 assert.equal(absorbWatchSession(typed, [{...watch, exercises: [{name: 'Walk'}]}]).replaces, null);
 assert.equal(absorbWatchSession(typed, [{...watch, kcal: 0}]).replaces, null);
 assert.equal(absorbWatchSession({...typed, watchId: 'watch-1'}, [watch]).replaces, null);
 assert.equal(absorbWatchSession(typed, [other]).replaces, null);
});

test('adding the minutes to a session saved earlier also takes over the Watch session', () => {
 const watch = {id: 'watch-0700am', source: 'watch', minutes: 62, kcal: 410, exercises: [], watch: {minutes: 62, kcal: 410}};
 const saved = {id: 'm1', title: 'Push day', minutes: null, kcal: 0, exercises: [{name: 'Bench'}]};
 const edited = {...saved, minutes: 60};
 assert.equal(absorbWatchSession(saved, [saved, watch]).replaces, null);
 assert.deepEqual(absorbWatchSession(edited, [saved, watch]), {entry: {...edited, kcal: 410, watchId: 'watch-0700am', watch: {minutes: 62, kcal: 410}}, replaces: 'watch-0700am'});
});

test('a Watch session cut short folds into the longer logged session and keeps the larger calories', () => {
 const died = {id: 'watch-0700am', source: 'watch', minutes: 20, kcal: 150, exercises: [], watch: {minutes: 20, kcal: 150}};
 const typed = {id: 'm1', title: 'Push day', minutes: 60, kcal: 320, exercises: [{name: 'Bench'}]};
 assert.deepEqual(absorbWatchSession(typed, [died]), {entry: {...typed, kcal: 320, watchId: 'watch-0700am', watch: {minutes: 20, kcal: 150}}, replaces: 'watch-0700am'});
 assert.equal(absorbWatchSession({...typed, kcal: 100}, [died]).entry.kcal, 150);
 assert.equal(absorbWatchSession({...typed, minutes: 15}, [died]).replaces, 'watch-0700am');
 assert.equal(absorbWatchSession({...typed, minutes: 5}, [{...died, minutes: 40}]).replaces, null);
});

test('a cut-short Watch session is only folded in when the day leaves no doubt, and never one the person changed', () => {
 const died = {id: 'watch-0700am', source: 'watch', minutes: 20, kcal: 150, exercises: [], watch: {minutes: 20, kcal: 150}};
 const typed = {id: 'm2', title: 'Legs', minutes: 45, kcal: 200, exercises: []};
 const yoga = {id: 'm1', title: 'Yoga', minutes: 60, kcal: 120, exercises: []};
 assert.equal(absorbWatchSession(typed, [yoga, died]).replaces, null);
 assert.equal(absorbWatchSession(typed, [died, {...died, id: 'watch-1200pm', exercises: [{name: 'Run'}]}]).replaces, null);
 assert.equal(absorbWatchSession({...typed, minutes: 20}, [{...died, title: 'Morning run', kcal: 180}]).replaces, null);
 assert.equal(absorbWatchSession(typed, [died]).replaces, 'watch-0700am');
});
