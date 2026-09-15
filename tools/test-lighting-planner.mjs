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
  planTotals, fixtureGroups, highlightRows, troubleLines, gridRowKey,
  PREP_STEPS, stepsWanted, advanceTo, noteOn, allDone, withFails,
  loaderShapes, chunkOptionPicks,
} from '../src/features/lighting-planner/lightingRules.js';
import { FITTING_LUMENS } from '../src/lib/settings.js';
import { FIXTURE_BY_ID } from '../src/lib/boq.js';
import { COB_WATT_RANGE } from '../src/lib/cob.js';
import { LAMP_WATTAGES, wattsOf, wattRangeOf, wattOptionsOf }
  from '../src/lib/ceilingObjects.js';

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
  /* THE GRID'S LAMPS CARRY NO CELL IN THIS FIXTURE, so they keep the shared row
     — which is the rule for a lamp the grid cannot name. The block below is the
     one that exercises the named ones. */
  assert.equal(by.get('cob').count, 3, 'lamps with no cell of their own share a row');
  ok('fixtureGroups splits linear runs per run and counts pieces together');
}

/* --- EVERY DOWNLIGHT THE GRID CAN NAME IS ITS OWN ROW ----------------------
   THIS IS THE ONE THE BUG WAS REPORTED AGAINST: "if I change one COB light's
   wattage, then all others in that room change their wattage." They were one
   row — twelve lamps, one set of chips, one entry in `fixtureWatts` — so there
   was only ever one number and no second one could exist. */
{
  const cells = ['0,0,6,7', '6,0,12,7', '0,7,6,14'];
  const r = room({ lights: [{}, {}, {}] });
  r.plan.lightsPx = cells.map((cellKey, i) => ({
    id: 'L' + i, cellKey, fixture: i === 2 ? 'large' : 'small' }));
  const by = new Map(fixtureGroups(r, lists()).map((q) => [q.key, q]));

  assert.ok(!by.has('cob'), 'the shared row is gone when every lamp can be named');
  for (const c of cells) assert.equal(by.get(gridRowKey(c)).count, 1, `${c} is its own row`);
  assert.equal(by.get(gridRowKey(cells[0])).familyId, 'cob', 'one family still');

  /* EACH OPENS AT ITS OWN CATALOGUE FIGURE, which is a correction the split
     brings with it: one row could state only one number, so a room mixing small
     lamps with a large one reported every one of them at the family's 7 W. */
  assert.equal(by.get(gridRowKey(cells[0])).defaultWatts, 7, 'a small lamp is a 7 W line');
  assert.equal(by.get(gridRowKey(cells[2])).defaultWatts, 12, '...and a large one is 12 W');

  /* AND THE ROOM'S OLD FIGURE IS NOT CONSULTED, WHICH REVERSES WHAT THIS BLOCK
     USED TO ASSERT. `fixtureWatts[roomId].cob` is the legacy key from when the
     whole grid was one row, and it used to sit in front of the catalogue figure
     as each row's default "so a reopened plan does not quietly jump". That
     kindness was the last shared link in the wattage path: a lamp with no entry
     of its own read that one number, so moving it moved every lamp in the room —
     and ROW_WATTS_SET DELETES an entry equal to the default, so setting a lamp
     TO the shared figure dropped it straight back into the shared pool. The
     per-cell keys above were doing their job and this was undoing it.
     THE COST IS REAL AND IS THE SMALLER ONE: a plan saved at room level now
     opens at the catalogue figure instead of at the stored one. A figure changes
     under somebody once, against every lamp in every room being chained together
     for ever. Nothing deletes the stored value; it is simply no longer read. */
  const old9 = new Map(fixtureGroups(r, lists({ roomWatts: { cob: 9 } }))
    .map((q) => [q.key, q]));
  assert.equal(old9.get(gridRowKey(cells[0])).defaultWatts, 7,
    'a room-level figure no longer reaches a small lamp');
  assert.equal(old9.get(gridRowKey(cells[2])).defaultWatts, 12,
    '...nor a large one — each opens at its own catalogue line');

  /* AND A LAMP WITH NO CELL FALLS BACK TO THE SHARED ROW ALONGSIDE THEM. */
  const mixed = room({ lights: [{}, {}] });
  mixed.plan.lightsPx = [{ id: 'A', cellKey: '0,0,6,7', fixture: 'small' },
                         { id: 'B', cellKey: null, fixture: 'small' }];
  const bm = new Map(fixtureGroups(mixed, lists()).map((q) => [q.key, q]));
  assert.equal(bm.get(gridRowKey('0,0,6,7')).count, 1);
  assert.equal(bm.get('cob').count, 1, 'the unnamed one is still counted');
  ok('fixtureGroups gives every named downlight a row of its own');
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
  assert.equal(by.get('spot').defaultWatts, FIXTURE_BY_ID.spot.watts);
  assert.equal(by.get('art-spot').count, 1);
  assert.equal(by.get('art-spot').defaultWatts, FIXTURE_BY_ID['art-spot'].watts);
  /* TWO ROWS, TWO CATALOGUE WATTAGES, AND NO LAYER OVERRIDE ON EITHER. It used
     to be `art ? 'accent' : 'task'`, back when there were three layers: one is
     what you work by, the other what you look at. With two, the question is "is
     this washing the room or is it pointed at something", and an art spot is the
     most pointed fitting on the drawing — a 24-degree cone on a picture, 80% of
     it at the floor. Both are task light, which is the `cob` family's own
     answer, so there is nothing left to override. See `layer` in lib/lumens.js. */
  assert.equal(by.get('spot').layer, undefined);
  assert.equal(by.get('art-spot').layer, undefined);
  assert.ok(!by.has('s4') && !by.has('s5'));
  ok('fixtureGroups bills a work spot and an art spot as two rows at two wattages');
}

{
  /* THE OBJECTS CARRY IDS, because the row key IS the fitting's id now — one row
     per decorative lamp, see `fixtureGroups`. Every real object is minted with
     one; a fixture without one is not a fitting this app could ever hold. */
  const r = room({ fans: [{ id: 'f1', kind: 'fan' },
                          { id: 'ch1', typeId: 'chandelier', kind: 'chandelier' },
                          { id: 'ch2', typeId: 'pendant', kind: 'chandelier' }] });
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
  /* --- AND EACH DECORATIVE FITTING IS ITS OWN ROW, WHICH IT WAS NOT --------
     IT WAS `by.get('lamp').count === 2`: one row for every chandelier, pendant
     and floor lamp in the room, on the counted-family rule. That rule is for
     things bought as a lot, and these are not — a chandelier is several lamps in
     one body at 55 W and a floor lamp is one bulb in a shade. One row meant one
     wattage across all of them, which was wrong about at least one. */
  assert.ok(!by.has('lamp'), 'the decorative lamps no longer share one row');
  assert.ok(!by.has('f1'), 'a fan is not a fitting and is in no row');
  assert.equal(by.get('ch1').count, 1, 'a chandelier is its own row...');
  assert.equal(by.get('ch2').count, 1, '...and so is the pendant beside it');
  assert.equal(by.get('ch1').label, 'Chandelier', 'labelled by its type');
  assert.equal(by.get('ch2').label, 'Pendant', '...which is what tells the two apart');
  /* ONE FAMILY STILL. They share a distribution — a bare fitting throwing in
     every direction — so nothing about the arithmetic changed; what changed is
     that the ROW is the fitting rather than the family. */
  assert.equal(by.get('ch1').familyId, 'lamp');
  assert.equal(by.get('ch2').familyId, 'lamp');
  /* AND EACH CARRIES ITS OWN CONTROL, which is the whole point — and they are
     not the same KIND of control. A chandelier is a span to 55 W and gets the
     slider; a pendant is one bulb, so it gets the three figures a bulb is sold
     at and no slider at all. Exactly one of the two is non-null per row, which
     is what the panel's three-way branch reads. */
  assert.equal(by.get('ch1').wattRange.max, 55);
  assert.equal(by.get('ch1').wattOptions, null, 'a chandelier is not a list');
  assert.equal(by.get('ch2').wattRange, null, 'a pendant is not a slider');
  assert.deepEqual(by.get('ch2').wattOptions, [7, 9, 12],
    '...it is the three wattages a bulb is bought at');
  assert.equal(by.get('ch2').defaultWatts, 9,
    'and the row carries the TYPE\'s default, not the family\'s');
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
    selAccId: null, selSpotId: null, selLightId: null, selShapeId: null,
    manualCobs: [{ id: 'c1', roomId: 'r1' }],
    cobArrays: [{ id: 'a1', roomId: 'r2' }],
    trackModulesPx: [{ id: 'm1', roomId: 'r3' }],
    accentZonesPx: [{ id: 'z1', roomId: 'r4', type: 'strip' },
                    { id: 'z2', roomId: 'r5', type: 'sconce' },
                    { id: 'cove-1', roomId: 'r8', type: 'strip', kind: 'cove',
                      shapeId: 'shape-1' },
                    { id: 'track-strip', roomId: 'r8', type: 'strip',
                      kind: 'ceiling-strip', shapeId: 'track-1' }],
    taskSpotsPx: [{ id: 's1', roomId: 'r6', fixture: 'spot' },
                  { id: 's2', roomId: 'r7', fixture: 'art-spot' }],
    /* THE CEILING OBJECTS, THROUGH THE LIST THAT DECIDES WHICH ROOM THEY ARE IN.
       `objectsInRoom` is what `fixtureGroups` counts the lamp row from, so the
       row this opens cannot be a row the count did not make. */
    rooms: [{ id: 'r10', geo: { objectsInRoom: [
      { id: 'o1', kind: 'chandelier' },
      { id: 'o2', kind: 'standing_lamp' },
      { id: 'o3', kind: 'fan' },
      { id: 'o4', kind: 'ac' },
    ] } }],
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
  /* A GRID LIGHT LIGHTS ITS OWN ROW, AND IT USED TO LIGHT THE GRID'S. It pushed
     `'cob'` — the row the whole grid shared — so pressing any of twelve
     downlights opened one figure and setting it there set all twelve. The cell
     names the row now; see `gridRowKey`, which both ends call so they cannot
     compose it differently. */
  assert.deepEqual(highlightRows({ ...base, selLightId: 'r9|3,4' }),
    { keys: [gridRowKey('3,4')], roomId: 'r9' }, 'a grid light lights its own row');
  /* ...AND A LAMP THE GRID COULD NOT NAME STILL OPENS THE SHARED ONE. A light
     with no cell of its own has nowhere to store an override, so it is counted
     under `cob` — and that is the row to open for it. */
  assert.deepEqual(highlightRows({ ...base, selLightId: 'r9|' }),
    { keys: ['cob'], roomId: 'r9' }, 'an unnamed lamp keeps the shared row');
  assert.deepEqual(highlightRows({ ...base, selShapeId: 'shape-1' }),
    { keys: ['cove-1'], roomId: 'r8' }, 'a drawn cove lights its exact run row');
  assert.deepEqual(highlightRows({ ...base, selShapeId: 'track-1' }),
    { keys: [], roomId: null }, 'another ceiling shape does not open the cove list');
  assert.deepEqual(highlightRows({ ...base, selCobId: 'c1', selSpotId: 's1' }),
    { keys: ['c1', 'spot'], roomId: 'r6' }, 'two things can be picked at once');
  assert.deepEqual(highlightRows(base), { keys: [], roomId: null });
  ok('highlightRows translates every kind of selection into row keys');
}

/* --- AND A CHANDELIER IS A SELECTION LIKE ANY OTHER ------------------------
   IT WAS THE ONE FITTING WITH NO ROUTE FROM THE DRAWING TO ITS WATTAGE. A
   chandelier, a pendant and a standing lamp are CEILING OBJECTS — the register
   the fans and the AC cassettes are in — so the press that picks one up was a
   press this function had never been told about: it highlighted nothing, opened
   nothing, and the wattage chips sat in a row nothing led to. */
{
  const base = {
    selCobId: null, selArrayId: null, selModuleId: null,
    selAccId: null, selSpotId: null, selLightId: null, selShapeId: null,
    manualCobs: [], cobArrays: [], trackModulesPx: [],
    accentZonesPx: [], taskSpotsPx: [],
    rooms: [{ id: 'r1', geo: { objectsInRoom: [
      { id: 'o1', typeId: 'chandelier', kind: 'chandelier' },
      { id: 'o2', typeId: 'standing_lamp', kind: 'standing_lamp' },
      { id: 'o3', typeId: 'fan', kind: 'fan' },
      { id: 'o4', typeId: 'ac', kind: 'ac' },
    ] } }],
  };
  assert.deepEqual(highlightRows({ ...base, selObjIds: ['o1'] }),
    { keys: ['o1'], roomId: 'r1' }, 'pressing a chandelier opens that chandelier');
  assert.deepEqual(highlightRows({ ...base, selObjIds: ['o2'] }),
    { keys: ['o2'], roomId: 'r1' }, '...and the floor lamp opens its own row');
  /* THE KEY IS THE FITTING AND NOT THE FAMILY, which is what makes the wattage
     reachable per fitting: press the chandelier and the slider that opens is the
     chandelier's. It used to be `'lamp'` for all of them — one row, one figure,
     and no way to say that the pendant beside it draws a fifth as much. */
  assert.deepEqual(highlightRows({ ...base, selObjIds: ['o1', 'o2'] }),
    { keys: ['o1', 'o2'], roomId: 'r1' }, 'two picked are two rows');
  /* AND THE THINGS IN THAT REGISTER THAT ARE NOT FITTINGS STAY OUT OF IT. A fan
     and a cassette are in no lighting schedule, and the test is the one
     `fixtureGroups` already applies — so the two cannot disagree about what
     counts as a lamp. */
  assert.deepEqual(highlightRows({ ...base, selObjIds: ['o3'] }),
    { keys: [], roomId: null }, 'a fan is not a fitting and opens nothing');
  assert.deepEqual(highlightRows({ ...base, selObjIds: ['o4'] }),
    { keys: [], roomId: null }, '...nor is an AC cassette');
  assert.deepEqual(highlightRows({ ...base, selObjIds: ['o3', 'o1'] }),
    { keys: ['o1'], roomId: 'r1' }, 'a fan picked with a pendant does not hide it');
  assert.deepEqual(highlightRows(base), { keys: [], roomId: null });
  ok('highlightRows reaches a chandelier’s row from the drawing');
}

/* --- WHAT EACH DECORATIVE FITTING MAY BE SET TO ---------------------------
   THE CATALOGUE, AND THE ONE PROPERTY THAT MATTERS ABOUT IT: the three are not
   one product, so they are not one control. A chandelier is several lamps in
   one body, reaches 55 W and is a SPAN; a pendant and a standard lamp are one
   bulb in one shade, and a bulb is bought at 7, 9 or 12 W — a LIST. */
{
  const w = (typeId, watts) => wattsOf({ typeId, kind: typeId, watts });
  const BULBS = [7, 9, 12];

  /* --- EXACTLY ONE SHAPE PER TYPE, WHICH IS WHAT THE PANEL BRANCHES ON -----
     `wattRangeOf` IS TESTED FIRST BY SpaceAnalysis and draws the slider, so a
     type that answered both would get the slider whatever list it also
     offered. This is the assertion that keeps the two readings exclusive. */
  for (const [id, spec] of Object.entries(LAMP_WATTAGES)) {
    assert.ok(!!spec.options !== (spec.min != null),
      `${id} is a list or a span and not both`);
    const o = { typeId: id, kind: id };
    assert.equal(!!wattRangeOf(o), !spec.options, `${id}: the range reading agrees`);
    assert.deepEqual(wattOptionsOf(o), spec.options ?? null,
      `${id}: ...and so does the list reading`);
  }

  /* --- THE CHANDELIER IS THE SPAN ---------------------------------------- */
  assert.equal(LAMP_WATTAGES.chandelier.max, 55, 'a chandelier reaches 55 W');
  /* STEP 1 W, for `COB_WATT_RANGE`'s reason: a slider landing on 12.4 W is a
     control pretending to a precision no product has. */
  assert.equal(LAMP_WATTAGES.chandelier.step, 1);
  assert.ok(LAMP_WATTAGES.chandelier.defaultWatts >= LAMP_WATTAGES.chandelier.min
    && LAMP_WATTAGES.chandelier.defaultWatts <= LAMP_WATTAGES.chandelier.max,
    'and its default is inside its own range');

  /* --- AND THE OTHER TWO ARE THE THREE BULBS, EXACTLY ---------------------
     ASSERTED AS THE WHOLE LIST rather than as a length or a maximum: the point
     of the change is that these are the three figures and there are no others,
     and a test that only checked the top of the list would pass on a slider. */
  assert.deepEqual(LAMP_WATTAGES.pendant.options, BULBS,
    'a pendant is 7, 9 or 12 W and nothing else');
  assert.deepEqual(LAMP_WATTAGES.standing_lamp.options, BULBS,
    'and so is a standing lamp');
  for (const id of ['pendant', 'standing_lamp']) {
    assert.equal(wattRangeOf({ typeId: id, kind: id }), null,
      `${id} offers no slider — that is what puts the chips on screen`);
    assert.ok(BULBS.includes(LAMP_WATTAGES[id].defaultWatts),
      `${id}'s default is one of the three it offers`);
  }

  /* NOTHING STORED READS THE TYPE'S DEFAULT, which is what keeps a plan saved
     before any of this existed correct rather than zeroed. */
  assert.equal(w('chandelier', undefined), LAMP_WATTAGES.chandelier.defaultWatts);
  assert.equal(w('standing_lamp', undefined), 7,
    'the floor lamp keeps the figure every decorative fitting used to share');
  assert.equal(w('pendant', undefined), 9);
  /* A STORED FIGURE WINS, AND IS CLAMPED. A file written by a build with a wider
     range must not put a 200 W chandelier through the lumen model. */
  assert.equal(w('chandelier', 40), 40);
  assert.equal(w('chandelier', 999), 55);
  /* --- AND ON A LIST IT IS SNAPPED, NOT CLAMPED --------------------------
     THE SLIDER EXISTED, so pendants are saved out there at every whole number
     from 3 to 24. Clamping would leave a 14 W pendant reading 14 with none of
     its three chips latched — a control that cannot show its own state — so
     the nearest thing anybody can buy is what it reports. */
  assert.equal(w('pendant', 9), 9, 'a figure on the list is itself');
  assert.equal(w('pendant', 14), 12, '...and 14 W off an old slider reads as 12');
  assert.equal(w('pendant', 3), 7, '...and 3 W as 7, the smallest bulb there is');
  assert.equal(w('standing_lamp', 999), 12, '...and anything absurd as the largest');
  assert.equal(w('standing_lamp', 8), 7,
    'a tie-break goes to the lower figure, which is the cheaper mistake');

  /* AND THE THINGS THAT ARE NOT LAMPS ANSWER FOR NOTHING. */
  assert.equal(wattRangeOf({ typeId: 'fan', kind: 'fan' }), null);
  assert.equal(wattOptionsOf({ typeId: 'fan', kind: 'fan' }), null);
  assert.equal(wattsOf({ typeId: 'ac', kind: 'ac' }), null);
  /* THE `kind` FALLBACK, for an object carrying no type: dropping it would take
     the fitting out of the schedule, the heatmap and the list at once. */
  assert.equal(wattRangeOf({ kind: 'chandelier' }), LAMP_WATTAGES.chandelier);
  ok('a chandelier is a span, a pendant and a standing lamp are 7/9/12 W');
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
