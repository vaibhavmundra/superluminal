/**
 * THE PURE HALF OF features/lighting-planner/.
 *
 * What a plan's lumens per square foot add up to, which fittings on one ceiling
 * merge into one analysis row and which get a row apiece, which row a fitting
 * picked on the drawing lights up, what a room that failed says about itself,
 * which pipeline steps a given run is actually going to do, how the loading
 * screen's checklist advances and what each step reports, what the loader draws
 * before the layout exists, and what flipping one chunk through its options
 * writes back. None of it needs React, a canvas, a pointer or a model call —
 * the hooks around it hold nothing but state and dependency arrays — which is
 * why it is out of the controllers and can be checked here.
 *
 * The numbers follow the other geometry scripts: 30 px/ft, so one foot is
 * thirty pixels.
 *
 *   node tools/test-lighting-planner.mjs
 */
import assert from 'node:assert/strict';
import {
  planTotals, fixtureGroups, highlightRows, troubleLines,
  PREP_STEPS, stepsWanted, advanceTo, noteOn, allDone, withFails,
  loaderShapes, chunkOptionPicks,
} from '../src/features/lighting-planner/lightingRules.js';
import { FITTING_LUMENS } from '../src/lib/settings.js';
import { FIXTURE_BY_ID } from '../src/lib/boq.js';
import { COB_WATT_RANGE } from '../src/lib/cob.js';

const PPF = 30;
let n = 0;
const ok = (what) => { n++; console.log(`  ok ${what}`); };

/** A lit space in the shape the rules are handed. */
const room = ({ id = 'r1', name = 'Living', lights = [], coves = [],
                areaSqft = 240, fans = [], stats = null } = {}) => ({
  id,
  outline: { name },
  geo: { polygonFt: [], fansInRoom: fans },
  coves,
  plan: { ok: true, lights, stats: stats ?? { areaSqft, unserved: 0, clashes: 0,
                                              ceded: 0, outsideBand: 0, fans: 0 } },
});

// --- the plan's headline figure ---------------------------------------------
{
  const rooms = [
    room({ lights: [{ kind: 'small' }, { kind: 'large' }], areaSqft: 200 }),
    room({ id: 'r2', lights: [{ kind: 'small' }], areaSqft: 100,
           coves: [{ coveLumens: 1000 }, { coveLumens: 500 }] }),
    { id: 'r3', outline: { name: 'Dud' }, geo: {}, plan: { ok: false, reason: 'too small' } },
  ];
  const t = planTotals(rooms);
  assert.equal(t.rooms, 2);
  assert.equal(t.failed, 1, 'a room with no layout is counted as failed');
  assert.equal(t.lights, 3);
  assert.equal(t.coves, 2);
  assert.equal(t.areaSqft, 300);
  assert.equal(t.gridLumens, FITTING_LUMENS.small * 2 + FITTING_LUMENS.large);
  assert.equal(t.coveLumens, 1500, 'a cove is ambient light and is counted');
  assert.equal(t.lumens, t.gridLumens + t.coveLumens);
  assert.equal(t.perSqft, t.lumens / 300, 'summed over the plan, not averaged');
  ok('planTotals sums the grid and the coves over the lit rooms');

  // THE CATALOGUE WINS OVER THE GEOMETRY'S TWO CONSTANTS.
  const named = planTotals([room({ lights: [{ kind: 'small', fixture: 'spot' }] })]);
  assert.equal(named.gridLumens, FIXTURE_BY_ID.spot.lumens);
  ok('planTotals takes a fitting’s output off the catalogue when it names one');

  assert.equal(planTotals([]).perSqft, 0, 'no rooms is not a divide by zero');
  ok('planTotals divides by at least one square foot');
}

// --- what is on one ceiling, counted by family ------------------------------
const lists = (over = {}) => ({
  accentZonesPx: [], taskSpotsPx: [], cobArrays: [], arrayCobsPx: [],
  magTracksPx: [], trackModulesPx: [], manualCobs: [], pxPerFt: PPF, ...over,
});

{
  const r = room({ lights: [{}, {}, {}] });
  const rows = fixtureGroups(r, lists({
    accentZonesPx: [
      { id: 'z1', roomId: 'r1', type: 'strip', kind: 'cove', runLength: 30 * PPF },
      { id: 'z2', roomId: 'r1', type: 'strip', kind: 'cove', runLength: 10 * PPF },
      { id: 'z3', roomId: 'r1', type: 'sconce' },
      { id: 'z4', roomId: 'r1', type: 'sconce' },
      { id: 'z5', roomId: 'r2', type: 'strip', kind: 'cove', runLength: 99 },
      { id: 'z6', roomId: 'r1', type: 'strip', kind: 'cove', rejected: true },
    ],
  }));
  const by = new Map(rows.map((q) => [q.key, q]));
  assert.ok(by.has('z1') && by.has('z2'), 'sold by the metre: a row per run');
  assert.equal(by.get('z1').lengthFt, 30, 'feet come off the live scale');
  assert.equal(by.get('z1').familyId, 'cove');
  assert.equal(by.get('sconce').count, 2, 'sold by the piece: one row for the lot');
  assert.ok(!by.has('z5'), 'another room’s run is not in this room');
  assert.ok(!by.has('z6'), 'a rejected run is not a fitting');
  assert.equal(by.get('cob').count, 3, 'the ambient grid is one row');
  ok('fixtureGroups splits linear runs per run and counts pieces together');
}

{
  const r = room();
  const rows = fixtureGroups(r, lists({
    taskSpotsPx: [
      { id: 's1', roomId: 'r1', x: 1, y: 1, fixture: 'spot' },
      { id: 's2', roomId: 'r1', x: 2, y: 2, fixture: 'spot' },
      { id: 's3', roomId: 'r1', x: 3, y: 3, fixture: 'art-spot' },
      { id: 's4', roomId: 'r1', rejected: true, fixture: 'spot' },
      { id: 's5', roomId: 'r1', x: null, fixture: 'spot' },
    ],
  }));
  const by = new Map(rows.map((q) => [q.key, q]));
  assert.equal(by.get('spot').count, 2);
  assert.equal(by.get('spot').layer, 'task');
  assert.equal(by.get('spot').defaultWatts, FIXTURE_BY_ID.spot.watts);
  assert.equal(by.get('art-spot').count, 1);
  assert.equal(by.get('art-spot').layer, 'accent');
  assert.ok(!by.has('s4') && !by.has('s5'));
  ok('fixtureGroups bills a work spot and an art spot as two rows, one layer each');
}

{
  const r = room({ fans: [{ kind: 'fan' }, { kind: 'chandelier' }, { kind: 'chandelier' }] });
  const rows = fixtureGroups(r, lists({
    cobArrays: [{ id: 'a1', roomId: 'r1', watts: 999, beam: 37 }],
    arrayCobsPx: [
      { arrayId: 'a1', roomId: 'r1' }, { arrayId: 'a1', roomId: 'r1' },
      { arrayId: 'a1', roomId: 'r2' },
    ],
    manualCobs: [
      { id: 'c1', roomId: 'r1', watts: 18, beam: 24 },
      { id: 'c2', roomId: 'r1', watts: 18, beam: 24 },
      { id: 'c3', roomId: 'r2', watts: 9, beam: 24 },
    ],
    magTracksPx: [{ id: 't1', roomId: 'r1' }, { id: 't2', roomId: 'r2' }],
    trackModulesPx: [
      { id: 'm1', on: 't1', kind: 'diffuser', watts: 18 },
      { id: 'm2', on: 't1', kind: 'diffuser', watts: 5 },
      { id: 'm3', on: 't1', kind: 'washer' },
      { id: 'm4', on: 't2', kind: 'diffuser' },
    ],
  }));
  const by = new Map(rows.map((q) => [q.key, q]));
  assert.equal(by.get('a1').count, 2, 'an array is one row and its own room’s lamps');
  assert.equal(by.get('a1').watts, COB_WATT_RANGE.max, 'the array’s wattage is clamped');
  assert.equal(by.get('a1').beam, 36, 'and its optic snaps to one that is sold');
  assert.equal(by.get('c1').count, 1);
  assert.equal(by.get('c2').count, 1, 'two hand-placed lamps are two decisions');
  assert.ok(!by.has('c3'));
  assert.equal(by.get('m1').watts, 18);
  assert.equal(by.get('m2').watts, 5, 'a module is specified on its own');
  assert.ok(!by.has('m3'), 'the wall washer has no numbers yet');
  assert.ok(!by.has('m4'), 'a module on another room’s run is not in this room');
  assert.equal(by.get('lamp').count, 2, 'a chandelier is a lamp; a fan is not');
  ok('fixtureGroups gives an array one row and a placed lamp or module a row apiece');
}

{
  // IN THE FAMILY TABLE'S OWN ORDER, so rows do not reshuffle as fittings arrive.
  const rows = fixtureGroups(room({ lights: [{}] }), lists({
    accentZonesPx: [{ id: 'z1', roomId: 'r1', type: 'strip', kind: 'cove', runLength: 60 }],
  }));
  assert.deepEqual(rows.map((q) => q.familyId), ['cove', 'cob']);
  ok('fixtureGroups returns rows in the family table’s order');
}

{
  assert.equal(fixtureGroups(room({ lights: [{}] }), lists({ pxPerFt: 0 })).length, 1);
  const rows = fixtureGroups(room(), lists({
    pxPerFt: 0,
    accentZonesPx: [{ id: 'z1', roomId: 'r1', type: 'strip', kind: 'shelf', runLength: 600 }],
  }));
  assert.equal(rows[0].lengthFt, 0, 'no scale means no length, not a wrong one');
  ok('fixtureGroups refuses to invent feet without a scale');
}

// --- which analysis row the selection is ------------------------------------
{
  const base = {
    selCobId: null, selArrayId: null, selModuleId: null,
    selAccId: null, selSpotId: null, selLightId: null,
    manualCobs: [{ id: 'c1', roomId: 'r1' }],
    cobArrays: [{ id: 'a1', roomId: 'r2' }],
    trackModulesPx: [{ id: 'm1', roomId: 'r3' }],
    accentZonesPx: [{ id: 'z1', roomId: 'r4', type: 'strip' },
                    { id: 'z2', roomId: 'r5', type: 'sconce' }],
    taskSpotsPx: [{ id: 's1', roomId: 'r6', fixture: 'spot' },
                  { id: 's2', roomId: 'r7', fixture: 'art-spot' }],
  };
  assert.deepEqual(highlightRows({ ...base, selCobId: 'c1' }),
    { keys: ['c1'], roomId: 'r1' });
  assert.deepEqual(highlightRows({ ...base, selArrayId: 'a1' }),
    { keys: ['a1'], roomId: 'r2' });
  assert.deepEqual(highlightRows({ ...base, selModuleId: 'm1' }),
    { keys: ['m1'], roomId: 'r3' });
  assert.deepEqual(highlightRows({ ...base, selAccId: 'z1' }),
    { keys: ['z1'], roomId: 'r4' });
  assert.deepEqual(highlightRows({ ...base, selAccId: 'z2' }),
    { keys: ['sconce'], roomId: 'r5' }, 'a sconce shares one counted row');
  assert.deepEqual(highlightRows({ ...base, selSpotId: 's1' }),
    { keys: ['spot'], roomId: 'r6' });
  assert.deepEqual(highlightRows({ ...base, selSpotId: 's2' }),
    { keys: ['art-spot'], roomId: 'r7' });
  assert.deepEqual(highlightRows({ ...base, selLightId: 'r9|3,4' }),
    { keys: ['cob'], roomId: 'r9' }, 'a grid light lights the grid’s row');
  assert.deepEqual(highlightRows({ ...base, selCobId: 'c1', selSpotId: 's1' }),
    { keys: ['c1', 'spot'], roomId: 'r6' }, 'two things can be picked at once');
  assert.deepEqual(highlightRows(base), { keys: [], roomId: null });
  ok('highlightRows translates every kind of selection into row keys');
}

// --- what a room says went wrong --------------------------------------------
{
  const stats = (over) => ({ areaSqft: 100, unserved: 0, clashes: 0, ceded: 0,
                             outsideBand: 0, fans: 0, ...over });
  const one = (r) => troubleLines([r]).map((t) => t.msg)[0];
  assert.deepEqual(troubleLines([{ outline: {}, plan: null }]), [],
    'a room with no layout yet is not a trouble');
  assert.match(one({ outline: { name: 'X' }, plan: { ok: false, reason: 'too small' } }),
    /too small/);
  assert.match(one(room({ stats: stats({ unserved: 2 }) })), /2 cells have no light at all/);
  assert.match(one(room({ stats: stats({ clashes: 1 }) })), /1 light sits inside/);
  assert.match(one(room({ stats: stats({ ceded: 1, fans: 1 }) })), /left to the fan/);
  assert.match(one(room({ stats: stats({ ceded: 1 }) })), /whole middle of it/);
  assert.match(one(room({ stats: stats({ outsideBand: 3 }) })), /3 lights sit off its cell centre/);
  assert.deepEqual(troubleLines([room()]), [], 'a clean room says nothing');
  // ONE LINE PER ROOM, AND THE FIRST REASON WINS.
  assert.equal(troubleLines([room({ stats: stats({ unserved: 1, clashes: 1 }) })]).length, 1);
  ok('troubleLines reports one reason per room, worst first');
}

// --- which steps this run is going to do ------------------------------------
{
  const keys = (o) => stepsWanted(o).map((st) => st.key);
  const all = { beds: true, bedSets: { roboflow: [], openai: [] },
                classify: true, relight: true, accents: true, surfaces: true };
  assert.deepEqual(keys(all), PREP_STEPS.map((st) => st.key));
  assert.deepEqual(keys({ ...all, bedSets: null }),
    ['geometry', 'types', 'beds2', 'accents', 'spots'],
    'the whole-plan bed contest is dormant without its two readings');
  assert.deepEqual(keys({ ...all, beds: false }),
    ['geometry', 'types', 'accents', 'spots'],
    'no beds means neither bed step');
  assert.deepEqual(keys({ ...all, classify: false }),
    ['beds', 'geometry', 'accents', 'spots'],
    'the re-check needs the classification to know which spaces are bedrooms');
  assert.deepEqual(keys({ ...all, relight: false }),
    ['beds', 'types', 'beds2', 'accents', 'spots'],
    'a recompute over an existing layout does not rebuild the geometry');
  assert.deepEqual(keys({ ...all, accents: false, surfaces: false }),
    ['beds', 'geometry', 'types', 'beds2']);
  // BEDS BEFORE THE ROOM-DEPENDENT WORK, on every combination.
  for (const o of [all, { ...all, classify: false }, { ...all, relight: false }]) {
    const k = keys(o);
    if (k.includes('beds') && k.includes('geometry')) {
      assert.ok(k.indexOf('beds') < k.indexOf('geometry'),
        'the beds are decided before anything is laid out');
    }
    if (k.includes('beds2') && k.includes('accents')) {
      assert.ok(k.indexOf('beds2') < k.indexOf('accents'),
        'a bedroom gets its bed back before its accents are asked for');
    }
  }
  ok('stepsWanted picks the steps and keeps the beds ahead of the layout');
}

// --- the checklist ----------------------------------------------------------
{
  const start = stepsWanted({ beds: false, bedSets: null, classify: true,
                              relight: true, accents: true, surfaces: true })
    .map((st, i) => ({ ...st, state: i === 0 ? 'busy' : 'idle' }));
  assert.deepEqual(start.map((st) => st.state), ['busy', 'idle', 'idle', 'idle']);

  const at2 = advanceTo(start, 'accents');
  assert.deepEqual(at2.map((st) => st.state), ['done', 'done', 'busy', 'idle']);
  assert.deepEqual(start.map((st) => st.state), ['busy', 'idle', 'idle', 'idle'],
    'advanceTo does not mutate what it was handed');

  assert.equal(advanceTo(start, 'beds'), start,
    'moving to a step this run is not doing is a no-op');

  const noted = noteOn(at2, 'accents', '4 fittings');
  assert.equal(noted.find((st) => st.key === 'accents').note, '4 fittings');
  assert.equal(noted.filter((st) => st.note).length, 1);

  assert.deepEqual(allDone(noted).map((st) => st.state),
    ['done', 'done', 'done', 'done']);
  assert.equal(allDone(noted).find((st) => st.key === 'accents').note, '4 fittings',
    'ticking the list keeps what each step found');
  ok('advanceTo, noteOn and allDone drive the checklist without mutating it');
}

{
  assert.equal(withFails('4 fittings', 0), '4 fittings');
  assert.equal(withFails('4 fittings', 1), '4 fittings · 1 space failed');
  assert.equal(withFails('4 fittings', 3), '4 fittings · 3 spaces failed');
  ok('withFails makes a partial run say it was partial');
}

// --- what the loader draws --------------------------------------------------
{
  const outlinesPx = [
    { id: 'o1', name: 'Bed 1', pointsPx: [{ x: 0, y: 0 }, { x: 60, y: 0 },
                                          { x: 60, y: 30 }, { x: 0, y: 30 }] },
    { id: 'o2', name: 'Untyped', pointsPx: [{ x: 0, y: 0 }, { x: 10, y: 0 },
                                            { x: 10, y: 10 }, { x: 0, y: 10 }] },
  ];
  const shapes = loaderShapes({
    outlinesPx, projectId: 'residential',
    roomTypes: { o1: { type: 'bedroom' } },
    roomState: { o1: 'busy' },
  });
  assert.deepEqual(shapes[0].centre, { x: 30, y: 15 });
  assert.equal(shapes[0].state, 'busy');
  assert.ok(shapes[0].label && shapes[0].label !== 'Bed 1',
    'a classified space is labelled by its type');
  assert.equal(shapes[1].label, 'Untyped', 'and an unclassified one by its name');
  assert.equal(shapes[1].state, 'idle', 'a space this run is not touching sits idle');

  const noRun = loaderShapes({ outlinesPx, projectId: 'residential',
                               roomTypes: {}, roomState: undefined });
  assert.deepEqual(noRun.map((s) => s.state), ['idle', 'idle'],
    'the loader has shapes to draw before the run has any state');
  ok('loaderShapes draws the outlines before the layout exists');
}

// --- flipping one chunk through its options ---------------------------------
{
  const chunk = (key, pick, ids, over = {}) => ({
    key, pick, options: ids.map((id) => ({ id })), order: ids, ...over });
  const r = {
    designChunksPx: [
      chunk('k1', 'standard', ['standard', 'cove', 'track']),
      chunk('k2', 'cove', ['standard', 'cove']),
      // A CHUNK WHOSE REQUEST WAS DECLINED still keeps what it ASKED for.
      chunk('k3', 'standard', ['standard', 'cove'], { requested: 'cove' }),
    ],
  };
  assert.deepEqual(chunkOptionPicks(r, 'k1', 1),
    { k2: 'cove', k3: 'cove', k1: 'cove' });
  assert.deepEqual(chunkOptionPicks(r, 'k1', -1),
    { k2: 'cove', k3: 'cove', k1: 'track' }, 'the left arrow reaches the last option');
  // BACK TO STANDARD STORES NOTHING FOR THAT CHUNK.
  const back = chunkOptionPicks(r, 'k2', 1);
  assert.deepEqual(back, { k3: 'cove' });
  assert.ok(!('k2' in back), 'a standard ceiling costs no state');
  assert.equal(chunkOptionPicks(r, 'nope', 1), null, 'no such chunk, nothing to do');
  assert.equal(chunkOptionPicks({ designChunksPx: [chunk('k', 'standard', ['standard'])] },
    'k', 1), null, 'one option is nothing to step between');
  assert.equal(chunkOptionPicks(undefined, 'k', 1), null, 'no such room, nothing to do');
  ok('chunkOptionPicks rewrites the space from the layout and keeps every request');
}

console.log(`\n${n} lighting-planner checks passed`);
