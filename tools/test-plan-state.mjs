// tools/test-plan-state.mjs — the save/restore contract, in Node, no browser.
//
// WHAT THIS IS ACTUALLY GUARDING. serialiseEditor and applyEditor are two halves
// of one mapping, thirty-odd fields wide, and the failure mode when they drift
// is silent: a field added to the writer and forgotten in the reader means a
// user's correction to a room outline is quietly absent the next time they open
// the plan. Nothing throws, nothing warns, and it will not be noticed for weeks.
//
// So the test drives applyEditor with a RECORDING SET OF SETTERS and then checks
// that what came out the far side is what went in. The last section is the
// important one: it walks the serialised object's own keys and asserts that
// every one of them reached a setter, which is the check that fails when
// somebody adds a field to only one side.
import { serialiseEditor, applyEditor, statsFrom, statusFrom, STATE_VERSION,
         NOT_UNDOABLE, NOT_UNDOABLE_KEYS, setterFor }
  from '../src/lib/planState.js';
import { newHistory, record, stepBack, historyDepth, VIEW_FIELDS, sameDoc }
  from '../src/lib/undo.js';
import { docReducer, initialDoc, DOC_FIELDS } from '../src/hooks/usePlanDoc.js';
import { CEILING_MM_MIN, CEILING_MM_MAX, materialsOf } from '../src/lib/materials.js';

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (s) => console.log('\n' + s);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A plan mid-edit: two spaces found by the detector, one of them corrected by
// hand, a bed dismissed, a chandelier placed, one accent rejected.
const STATE = {
  unitId: 'mm',
  scaleMode: 'door', refId: 'door900', customFt: 3,
  measure: { a: { x: 10, y: 20 }, b: { x: 210, y: 20 } },
  doorPick: { id: 'd2', mm: 900 },
  pxPerFt: 18.5, ceilingFt: 10,
  outlines: [
    { id: 'o1', name: 'Living', pointsDu: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
      rectify: true, detected: true, reviewed: true },
    { id: 'o2', name: 'Bed 1', pointsDu: [{ x: 120, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 70 }, { x: 120, y: 70 }],
      rectify: true, detected: true, reviewed: false },
  ],
  litIds: ['o1', 'o2'], focusId: 'o1', selectedOutlineId: 'o2',
  roomState: { status: 'done', count: 2, ms: 4120, meta: { model: 'rooms-v3' } },
  projectType: 'residential',
  pdfPage: 3,
  roomTypes: { o1: { type: 'living', confidence: 0.82, why: 'sofa and a TV unit' },
               o2: { type: 'bedroom', confidence: 0.91, why: 'a bed' } },
  detections: [{ id: 'det-0', cls: 'bed', conf: 0.88, rect: { x0: 130, y0: 10, x1: 190, y1: 60 }, roomId: 'o2' }],
  dismissed: ['det-7'],
  bedVerdicts: { o2: { kind: 'judged', pick: 'openai', confidence: 0.7, asked: true } },
  provider: 'judge',
  zones: [{ id: 'z1', x0: 5, y0: 5, x1: 25, y1: 25 }],
  doors: [{ id: 'd2', x: 118, y: 35, w: 16 }],
  doorsOk: true,
  ceilingObjs: [{ id: 'c1', type: 'chandelier', x: 8.2, y: 5.5, r: 1.4 }],
  chunkPicks: { o1: 'halves-x' },
  accentResults: { o1: { zones: [{ id: 'acc-o1-0', kind: 'strip', rejected: false },
                                 { id: 'acc-o1-1', kind: 'cove', rejected: true }] } },
  accentDismissed: ['acc-o1-2'],
  manualAccents: [{ id: 'man-1', kind: 'sconce', roomId: 'o1' }],
  // The render pass: what the model said about the walls, and the two lengths
  // somebody dragged afterwards. The renders themselves are deliberately absent
  // — see planState.js — but everything derived from them must come back, or a
  // reopened plan is missing its reverse coves, its shelf strips and its art
  // spots while every other light is still on the sheet.
  wallResults: { o1: { elements: [
    { id: 'we-o1-0', type: 'panelling', wall: 'bottom',
      start_cell: 'B1', end_cell: 'H1', width_ft: 7 },
    { id: 'we-o1-1', type: 'painting', wall: 'left',
      start_cell: 'A3', end_cell: 'A5', width_ft: 3 },
  ], took: 8210 } },
  runTrims: { 'rcove-we-o1-0-0': { startFt: 0.5, endFt: -1 },
              'shelf-we-o1-2-0': { startFt: 0, endFt: 0.75 } },
  // Pointers into the bucket, not pixels: see planState.js and db.uploadRender.
  renderRefs: { o1: [
    { path: 'u1/p1/renders/o1/mf3k9-0.jpg', name: 'living-01.png',
      w: 1400, h: 788, bytes: 402_112, quality: 0.82,
      fromW: 4000, fromH: 2250, fromBytes: 8_411_002, at: '2026-08-31T09:12:00.000Z' },
  ] },
  surfaceResults: { o1: { surfaces: [{ id: 'surf-o1-0', kind: 'tv' }] } },
  surfaceDismissed: [], manualSurfaces: [{ id: 'ms-1', roomId: 'o1' }],
  // The switchboards somebody threw away. `sbResults` — the on-demand pass's
  // stored answer — used to be here; the pass is gone and the boards are derived,
  // so what has to survive a reload is the deletions and nothing else.
  boardsOff: ['sb-o2-facing'],
  // ...and one dragged along its space's walls: 4.25ft round from the run walk's
  // own starting corner. See wallPath in electrical.js.
  boardMoves: { 'sb-o1-door': 4.25 },
  layers: { plan: true, lights: true, labels: true }, zoom: 1.4, view: 'boq',
};

/** applyEditor's setters, recording rather than setting. */
function recorder() {
  const got = {};
  const trap = new Proxy({}, {
    get: (_t, key) => (v) => { got[key] = typeof v === 'function' ? v(undefined) : v; },
  });
  return { got, set: trap };
}

// ---------------------------------------------------------------------------
section('a full round trip');
{
  const p = serialiseEditor(STATE, { pxPerFt: STATE.pxPerFt });
  const { got, set } = recorder();
  applyEditor(p, set);

  ok('stamps the version', p.v === STATE_VERSION, `got ${p.v}`);
  ok('stamps a time', typeof p.savedAt === 'string' && !Number.isNaN(Date.parse(p.savedAt)));

  ok('outlines survive, corrections included',
    same(got.setOutlines, STATE.outlines), JSON.stringify(got.setOutlines));
  ok('the corrected outline is still marked reviewed',
    got.setOutlines[0].reviewed === true && got.setOutlines[1].reviewed === false);
  ok('lit rooms survive', same(got.setLitIds, STATE.litIds));
  ok('focus and selection survive', got.setFocusId === 'o1' && got.setSelectedOutlineId === 'o2');
  ok('room types survive', same(got.setRoomTypes, STATE.roomTypes));
  ok('the building type is restored through its alias',
    got.setProjectType === 'residential', got.setProjectType);
  // A drawing set must reopen on the sheet that was chosen, not on its title page.
  ok('the chosen PDF page survives', got.setPdfPage === 3, String(got.setPdfPage));
  ok('detections survive', same(got.setDetections, STATE.detections));
  ok('dismissals survive', same(got.setDismissed, STATE.dismissed));
  ok('bed verdicts survive', same(got.setBedVerdicts, STATE.bedVerdicts));
  ok('no-light zones survive', same(got.setZones, STATE.zones));
  ok('ceiling objects survive', same(got.setCeilingObjs, STATE.ceilingObjs));
  ok('chunk picks survive', same(got.setChunkPicks, STATE.chunkPicks));
  ok('accents survive, rejections included', same(got.setAccentResults, STATE.accentResults));
  ok('hand-placed accents survive', same(got.setManualAccents, STATE.manualAccents));
  ok('task surfaces survive', same(got.setSurfaceResults, STATE.surfaceResults));
  ok('hand-drawn surfaces survive', same(got.setManualSurfaces, STATE.manualSurfaces));
  // A DERIVED FITTING'S DISMISSAL, AND THE SAME ARGUMENT AS THE ACCENTS'. A
  // board is recomputed on every render, so "not this one" only exists as long
  // as this list does — drop it and a deleted plate is back on the sheet the
  // next time the plan is opened.
  ok('deleted switchboards stay deleted', same(got.setBoardsOff, STATE.boardsOff));
  /* AND A MOVED ONE STAYS MOVED, which is the same argument again and the one
     that was asked for out loud: a board is recomputed on every render, so this
     map is the ONLY record that a plate is anywhere other than where its rule
     put it. Drop it and the switch walks back to the door on reload. */
  ok('a switchboard dragged along the wall stays there',
    same(got.setBoardMoves, STATE.boardMoves), JSON.stringify(got.setBoardMoves));
  ok('and it is stored in feet, not plan pixels',
    got.setBoardMoves['sb-o1-door'] === 4.25,
    'plan pixels would move the day somebody corrected the scale');
  // THE REGRESSION THIS SECTION WAS ADDED FOR. Reverse coves, shelf strips and
  // art spots are all derived from these two on every render — nothing about
  // them is stored — so if either field fails to round trip the render pass's
  // lights are simply gone the next time the plan is opened, with every other
  // light still in place. Which is exactly how it was reported.
  ok('the wall elements survive', same(got.setWallResults, STATE.wallResults));
  ok('and keep their cells and widths',
    got.setWallResults?.o1?.elements?.[0]?.start_cell === 'B1'
    && got.setWallResults?.o1?.elements?.[0]?.width_ft === 7);
  ok('hand-dragged run lengths survive', same(got.setRunTrims, STATE.runTrims));
  ok('the stored renders come back as pointers', same(got.setRenderRefs, STATE.renderRefs));
  ok('and keep the size they were sent at',
    got.setRenderRefs?.o1?.[0]?.w === 1400 && got.setRenderRefs?.o1?.[0]?.fromW === 4000);
  ok('but no pixels went into the column',
    !JSON.stringify(serialiseEditor(STATE, { pxPerFt: STATE.pxPerFt })).includes('base64')
    && !JSON.stringify(serialiseEditor(STATE, { pxPerFt: STATE.pxPerFt })).includes('data:image'));
  ok('scale survives', got.setScaleMode === 'door' && got.setRefId === 'door900'
    && got.setCustomFt === 3 && same(got.setMeasure, STATE.measure)
    && same(got.setDoorPick, STATE.doorPick));
  ok('ceiling height survives', got.setCeilingFt === 10);
  ok('units override survives', got.setUnitId === 'mm');
  ok('view preferences survive',
    got.setZoom === 1.4 && got.setView === 'boq' && same(got.setLayers, STATE.layers));

  // The detectors must come back as ANSWERED, or reopening a plan offers to
  // re-run four model calls whose results are already on screen.
  ok('the segmenter reads as done', got.setRoomState?.status === 'done');
  ok('and says it was restored', got.setRoomState?.restored === true);
  ok('the furniture detector reads as done', got.setDetectState?.status === 'done');
  ok('the door detector reads as done', got.setDoorState?.status === 'done');
  // ...AND THE CONFIRMATION IS NOT THE DETECTION. The door boxes come back
  // either way; whether a PERSON has said the set is complete is a separate
  // answer, and it is the one the electrical layer is gated behind.
  ok('the door confirmation survives', got.setDoorsOk === true, String(got.setDoorsOk));
}

section('the door confirmation, on rows that predate it');
{
  // THE GRANDFATHER CLAUSE. `doorsOk` gates the electrical layer, so reading a
  // missing key as `false` would take the wiring off every plan that was saved
  // before the gate existed and put a question in front of somebody who has
  // been looking at their loops for a week. Having the layer ON is the old
  // evidence that the electricals were wanted, and it stands in once.
  const withWiring = recorder();
  applyEditor({ v: 5, outlines: [], ui: { layers: { electrical: true } } }, withWiring.set);
  ok('a plan already showing its wiring is treated as confirmed',
    withWiring.got.setDoorsOk === true, String(withWiring.got.setDoorsOk));

  const without = recorder();
  applyEditor({ v: 5, outlines: [], ui: { layers: { electrical: false } } }, without.set);
  ok('and one that never asked for it is not',
    without.got.setDoorsOk === false, String(without.got.setDoorsOk));

  const bare = recorder();
  applyEditor({ v: 0, outlines: [] }, bare.set);
  ok('a row with no board edits restores empty ones rather than undefined',
    same(bare.got.setBoardsOff, []) && same(bare.got.setBoardMoves, {}));
  ok('a row with no ui block at all does not throw and reads as unconfirmed',
    bare.got.setDoorsOk === false, String(bare.got.setDoorsOk));

  // ...and an explicit answer always wins over the inference.
  const said = recorder();
  applyEditor({ v: 9, doorsOk: false, ui: { layers: { electrical: true } } }, said.set);
  ok('a stored false is not overridden by the layer',
    said.got.setDoorsOk === false, String(said.got.setDoorsOk));
}

section('the writer and the reader cover the same fields');
{
  // Every key the writer emits has to be consumed. `v`, `savedAt` and `scale`
  // are structural rather than state (the reader unpacks `scale` into five
  // setters), so they are named exemptions rather than an excuse to skip the
  // check.
  const STRUCTURAL = new Set(['v', 'savedAt', 'scale', 'ui', 'ceilingFt']);
  const p = serialiseEditor(STATE, { pxPerFt: STATE.pxPerFt });
  const src = applyEditor.toString();
  const missed = Object.keys(p).filter((k) => !STRUCTURAL.has(k) && !src.includes(`p.${k}`));
  ok('no field is written but never read', missed.length === 0, `orphaned: ${missed.join(', ')}`);

  const { got } = (() => { const r = recorder(); applyEditor(p, r.set); return r; })();
  ok('every setter the editor passes is called at least once',
    Object.keys(got).length >= 28, `${Object.keys(got).length} called`);
}

section('an old row, missing half its fields');
{
  // A row written by an earlier version of the writer is a normal thing to meet.
  // It must restore what it has and default the rest rather than throwing, which
  // would make the plan unopenable.
  const { got, set } = recorder();
  let threw = null;
  try { applyEditor({ v: 0, outlines: STATE.outlines }, set); } catch (e) { threw = e; }
  ok('does not throw', !threw, String(threw));
  ok('restores what it has', same(got.setOutlines, STATE.outlines));
  ok('defaults what it does not', same(got.setLitIds, []) && same(got.setRoomTypes, {})
    && same(got.setAccentResults, {}));
  ok('and does not claim a detector ran', got.setRoomState?.status === 'idle');
}

section('null is survivable');
{
  const { got, set } = recorder();
  let threw = null;
  try { applyEditor(null, set); } catch (e) { threw = e; }
  ok('a plan with no saved state opens', !threw && Object.keys(got).length === 0);
}

// ---------------------------------------------------------------------------
// THE INVARIANT THE TWO HAND-WRITTEN LISTS WERE SUPPOSED TO GUARANTEE.
//
// Every section above tests ONE field, or one behaviour of one field, which is
// why the writer and the reader were able to drift for as long as they did: a
// field nobody wrote a case for is a field nobody notices is missing. This is
// the check that does not have to be told what to look at — it walks the
// document itself and asserts, for every field in it, that what comes back out
// of applyEditor is what went in.
//
// A DOCUMENT BUILT BY DOING THINGS TO IT, not a literal. The three migrated
// fields are driven through `docReducer` with N random VALID actions, so what is
// being round-tripped is a document some sequence of real edits could actually
// produce — including the sparse-map edge cases a hand-written fixture forgets:
// an entry added and then removed, a value written back to its default, a room
// whose last row was deleted.
// ---------------------------------------------------------------------------

/* A COMPLETE DOCUMENT. Every one of the sixty-one fields at the value App's own
   `useState` starts it at, so the round trip is tested over the whole shape
   rather than over whichever fields a fixture happened to mention. A field left
   `undefined` here would round-trip as `[]` or `{}` — applyEditor's `??` doing
   its job — and would silently pass a comparison it should fail. */
const EMPTY_DOC = {
  unitId: null, pdfPage: null,
  scaleMode: 'door', refId: 'door900', customFt: 3,
  measure: { a: null, b: null }, doorPick: null, ceilingFt: 10,
  outlines: [], litIds: [], dirtyIds: [], focusId: null, selectedOutlineId: null,
  roomState: { status: 'idle' },
  projectType: null, roomTypes: {},
  detections: [], dismissed: [], bedVerdicts: {}, provider: 'judge', zones: [],
  doors: [], doorsOk: false,
  ceilingObjs: [], chunkPicks: {}, designPicks: {}, ceilingKinds: {},
  ceilingShapes: [], lightMoves: {},
  accentResults: {}, accentDismissed: [], manualAccents: [],
  surfaceResults: {}, surfaceDismissed: [], manualSurfaces: [], artDismissed: [],
  wallResults: {}, runTrims: {}, runsOff: [],
  manualCoves: [], manualTracks: [], manualCobs: [], autoSpots: [],
  cobArrays: [], trackFixtures: [], renderRefs: {},
  boardsOff: [], boardMoves: {}, boardPoints: {}, flowBoards: {}, flowBends: {},
  manualBoards: [], boardKinds: {}, boardHeights: {}, boardOrders: {},
  ceilingMm: {}, materials: {}, fixtureWatts: {},
  layers: { plan: true, lights: true, labels: false, electrical: false },
  zoom: 1, view: 'spaces',
};

/* THE FIELDS THE ROUND TRIP DOES NOT COVER, EACH WITH ITS OWN TEST BELOW.
   Named rather than skipped: an exclusion nobody can see is a hole, and the
   whole failure this file guards against is a field quietly not being checked.
   Two entries, and adding a third should be an argument, not a convenience. */
const EXCLUDED = {
  // LOSSY IN BOTH DIRECTIONS, ON PURPOSE. The writer keeps the segmenter's own
  // `proposed` payload; the reader deliberately does not restore it and stamps
  // `restored: true` instead. Asserted exactly, as an asymmetry, below.
  roomState: 'serialised as `segmentation`, restored deliberately lossily',
  // WRITE-ONLY. Stamped as `scale.pxPerFtAtSave` as a check on the scale rules,
  // and never read back — it is not even a document field, it is the
  // serialiser's second argument. Asserted below.
  pxPerFt: 'a derived check, written and never restored',
};

/* THE TRUTHINESS-GUARDED FIELDS. `applyEditor` restores these behind `if (x)`
   rather than `??`, so a falsy value would not come back. That is the shape the
   guards have always had and is preserved deliberately — see planState.js — so
   the generator below never produces a falsy value for one of them. The list is
   here so that a guard added or removed shows up as a diff in this file. */
const TRUTHY_GUARDED = ['scaleMode', 'refId', 'measure', 'provider',
                        'layers', 'zoom', 'view'];

const on_off = (r) => r() < 0.5;

/** A tiny deterministic PRNG, so a failure is reproducible from its seed. */
function rng(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

/* ONE RANDOM VALID ACTION. Valid is the operative word: these are the actions
   the UI can actually dispatch, with the arguments it can actually supply, so a
   document built from them is a document a person could have produced. An
   action with impossible arguments would test the reducer's tolerance of
   nonsense rather than the save contract. */
function randomAction(r) {
  const room = `o${1 + Math.floor(r() * 3)}`;
  const pick = Math.floor(r() * 14);

  /* --- domain 2 and 3. The ids are drawn from a small pool ON PURPOSE: a
     remove or a patch that never names a thing that exists would test nothing,
     and a pool of three is what makes add-then-patch-then-remove sequences
     actually collide. `stamp` is fixed so a seed reproduces exactly. */
  const oneOf = (xs) => xs[Math.floor(r() * xs.length)];
  const shapeId = `sh${1 + Math.floor(r() * 3)}`;
  if (pick === 5) return { type: 'LIST_ADDED', field: 'manualCoves',
                           item: { id: `cv${1 + Math.floor(r() * 3)}`, roomId: room, band: 0.5 } };
  if (pick === 6) return { type: 'LIST_REMOVED', field: 'manualCoves',
                           id: `cv${1 + Math.floor(r() * 3)}` };
  if (pick === 7) return { type: 'LIST_ADDED_MINTED', field: 'manualTracks',
                           idPrefix: 'mtrack', stamp: 'zz',
                           item: { ptsFt: [{ x: 0, y: 0 }, { x: 4, y: 0 }], closed: false, lengthFt: 4 } };
  if (pick === 8) return { type: 'LIST_ADDED', field: 'manualCobs',
                           item: { id: `cb${1 + Math.floor(r() * 3)}`, roomId: room,
                                   xFt: 3, yFt: 4, watts: 9, beam: 36, auto: r() < 0.5 } };
  if (pick === 9) return { type: 'COB_SPEC_SET', id: `cb${1 + Math.floor(r() * 3)}`,
                           watts: oneOf([7, 12, 18]), beam: oneOf([24, 36, 60]) };
  if (pick === 10) return { type: 'AUTO_COBS_DROPPED', roomId: room };
  if (pick === 11) return { type: on_off(r) ? 'ID_ADDED' : 'ID_REMOVED',
                            field: 'autoSpots', id: room };
  if (pick === 12) return { type: 'LIST_ADDED', field: 'ceilingShapes',
                            item: { id: shapeId, role: oneOf(['cove', 'guide', 'track']),
                                    x: 1, y: 2, wFt: 8, hFt: 6 } };
  if (pick === 13) return oneOf([
    { type: 'LIST_ADDED_MINTED', field: 'cobArrays', idPrefix: 'carr', stamp: 'zz',
      item: { geomId: shapeId, roomId: room, count: 6, side: 'in',
              offsetFt: 1, watts: 7, beam: 36 } },
    { type: 'LIST_PATCHED', field: 'cobArrays', id: `carr-zz-0`,
      patch: { watts: oneOf([7, 12]) } },
    /* `quantise` COMES IN WITH THE ACTION because the real one needs
       `arrayOutline`, a memo over the shapes and the rooms — derived state the
       document may not hold. Here it stands in for that arithmetic. */
    { type: 'ARRAY_SHAPE_SET', id: `carr-zz-0`, count: oneOf([2, 4, 7]),
      quantise: (c) => Math.min(200, Math.max(1, Math.round(c))) },
    { type: 'LIST_REMOVED', field: 'cobArrays', id: `carr-zz-0` },
    { type: 'MAP_ENTRY_SET', field: 'chunkPicks', key: room, value: oneOf(['halves-x', 'thirds']) },
    { type: 'MAP_ENTRY_SET', field: 'designPicks', key: room, value: { c0: 'cove' } },
    { type: 'LIST_PATCHED', field: 'ceilingShapes', id: shapeId, patch: { radiusFt: oneOf([0, 1, 2]) } },
    { type: 'LIST_REMOVED', field: 'ceilingShapes', id: shapeId },
    { type: 'TRACK_MODULES_DROPPED', trackId: shapeId },
    { type: 'LIST_ADDED_MANY', field: 'trackFixtures',
      items: [{ id: `md${1 + Math.floor(r() * 3)}`, trackId: shapeId, kind: 'diffuser', u: 0.4, watts: 5 }] },
  ]);

  if (pick === 0) {
    // Including the two that clear an entry: an empty box, and an unparseable
    // one. Both mean "back to the default", which stores nothing.
    const raws = ['', 'abc', '2700', '3200', '27', '99999'];
    return { type: 'CEILING_MM_SET', id: room, raw: raws[Math.floor(r() * raws.length)],
             min: CEILING_MM_MIN, max: CEILING_MM_MAX };
  }
  if (pick === 1) {
    return { type: 'SURFACE_TONE_SET', id: room,
             surface: ['ceiling', 'floor'][Math.floor(r() * 2)],
             tone: ['light', 'mid', 'dark'][Math.floor(r() * 3)] };
  }
  if (pick === 2) {
    // 'light' is the default and deletes the entry — the sparse rule, exercised.
    return { type: 'WALL_TONE_SET', id: room, edge: Math.floor(r() * 4),
             tone: ['light', 'mid', 'dark'][Math.floor(r() * 3)] };
  }
  // ...and a wattage written, then written back to its family's default, which
  // deletes the row and can empty the room out of the map entirely.
  return { type: 'ROW_WATTS_SET', roomId: room,
           key: ['cob', 'cove', `run-${Math.floor(r() * 2)}`][Math.floor(r() * 3)],
           watts: [7, 9, 12, 18][Math.floor(r() * 4)], defaultWatts: 9 };
}

section('the round trip, over a document built by doing things to it');
{
  const FIELDS = Object.keys(EMPTY_DOC).filter((f) => !(f in EXCLUDED));
  let worst = null, checked = 0;

  for (let seed = 1; seed <= 200 && !worst; seed++) {
    const r = rng(seed * 2654435761);
    const n = 1 + Math.floor(r() * 40);
    let reduced = initialDoc();
    const trail = [];
    for (let i = 0; i < n; i++) {
      const a = randomAction(r);
      trail.push(a.type);
      reduced = docReducer(reduced, a);
    }
    const doc = { ...EMPTY_DOC, ...reduced };

    const p = serialiseEditor(doc, { pxPerFt: 18.5 });
    const { got, set } = recorder();
    applyEditor(p, set);

    for (const field of FIELDS) {
      checked++;
      if (!same(got[setterFor(field)], doc[field])) {
        worst = { seed, n, field, trail: trail.join(','),
                  want: doc[field], gotBack: got[setterFor(field)] };
        break;
      }
    }
  }

  ok('applyEditor(serialiseEditor(doc)) deep-equals doc, over 200 documents',
    !worst,
    worst && `seed ${worst.seed}, ${worst.n} actions, field \`${worst.field}\`: `
      + `wrote ${JSON.stringify(worst.want)}, got back ${JSON.stringify(worst.gotBack)}`
      + ` — actions: ${worst.trail}`);
  ok('and it actually checked every field of every document',
    checked === 200 * FIELDS.length, `${checked} comparisons`);

  // THE EXCLUSIONS ARE TWO, AND THEY ARE THE TWO NAMED ONES. A field added to
  // EXCLUDED to make a failure go away should be visible as a change here.
  /* THE GENERATOR HAS TO ACTUALLY REACH EVERY MIGRATED FIELD. A property test
     over actions that only ever touch three of thirteen fields passes for the
     wrong reason — it is not testing the ten it never writes. This is what says
     the random walk covers the reducer, and it fails when a domain is migrated
     without its actions being added to `randomAction`. */
  {
    const touched = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 2654435761);
      const n = 1 + Math.floor(r() * 40);
      let d = initialDoc();
      for (let i = 0; i < n; i++) {
        const before = d;
        d = docReducer(d, randomAction(r));
        if (d !== before) {
          for (const f of Object.keys(DOC_FIELDS)) if (d[f] !== before[f]) touched.add(f);
        }
      }
    }
    const untouched = Object.keys(DOC_FIELDS).filter((f) => !touched.has(f));
    /* `ceilingKinds` IS THE ONE HONEST EXCEPTION and it has to be named. No UI
       writes it any more — the decision moved to the chunk — so its only action
       is the reset, and a random walk of edits cannot reach it. It is still in
       the document so an old plan keeps its coves. See planState.js. */
    ok('the random walk actually writes every migrated field',
      same(untouched, ['ceilingKinds']), `never written: ${untouched.join(', ')}`);
  }

  ok('the round trip excludes exactly the two documented fields',
    same(Object.keys(EXCLUDED).sort(), ['pxPerFt', 'roomState']),
    Object.keys(EXCLUDED).join(', '));

  // ...and the walk covers the whole document, so a field cannot avoid the
  // check by being absent from EMPTY_DOC.
  const p = serialiseEditor(EMPTY_DOC, { pxPerFt: 1 });
  const emitted = Object.keys(p)
    .filter((k) => !['v', 'savedAt', 'scale', 'ui', 'segmentation'].includes(k));
  const uncovered = emitted.filter((k) => !FIELDS.includes(k));
  ok('every field the writer emits is in the round trip or excluded',
    uncovered.length === 0, `uncovered: ${uncovered.join(', ')}`);
}

section('the two exclusions, asserted rather than skipped');
{
  // `roomState` — the asymmetry IS the contract. The writer keeps what the
  // segmenter proposed; the reader throws it away and stamps `restored: true`
  // in its place, which is what stops the app offering to run a segmentation
  // whose answer is already on the screen. Neither half is a bug and the round
  // trip cannot hold, so what is asserted is the exact shape of the loss.
  const roomState = { status: 'done', proposed: [{ id: 'p1', pts: [1, 2] }],
                      meta: { model: 'rooms-v3' }, count: 2, ms: 4120 };
  const p = serialiseEditor({ ...EMPTY_DOC, roomState }, { pxPerFt: 18.5 });
  ok('the writer keeps the segmenter\'s own proposal',
    same(p.segmentation.proposed, roomState.proposed));

  const { got, set } = recorder();
  applyEditor(p, set);
  ok('...and the reader restores it lossily, exactly so',
    same(got.setRoomState,
         { status: 'done', restored: true, count: 2, meta: { model: 'rooms-v3' }, ms: 4120 }),
    JSON.stringify(got.setRoomState));
  ok('`restored: true` is there, which is what stops a re-segmentation being offered',
    got.setRoomState.restored === true);
  ok('and `proposed` is deliberately not restored',
    !('proposed' in got.setRoomState));

  // `pxPerFt` — present in the output, absent from the restore path. It is the
  // serialiser's second argument and not a field of the document at all.
  ok('pxPerFt is stamped into the output',
    p.scale.pxPerFtAtSave === 18.5, String(p.scale.pxPerFtAtSave));
  ok('...and nothing on the restore path sets it',
    !Object.keys(got).some((k) => k.toLowerCase().includes('pxperft')),
    Object.keys(got).filter((k) => k.toLowerCase().includes('pxperft')).join(', '));
  ok('...and it is not a document field either',
    !('pxPerFt' in EMPTY_DOC) && !(serialiseEditor(EMPTY_DOC).scale.pxPerFtAtSave));
  // A document that carries a `pxPerFt` FIELD must not be able to smuggle it in,
  // which is what the named second argument buys.
  ok('a pxPerFt field on the document is ignored',
    serialiseEditor({ ...EMPTY_DOC, pxPerFt: 99 }).scale.pxPerFtAtSave === null);
}

section('the hold-back list has one copy');
{
  // `applyStep` used to hand `applyEditor` six hand-written no-op setters and
  // planState.js knew nothing about it. This is the check that they cannot drift
  // apart again: the list is exported, App.jsx builds its no-ops from it, and
  // both of the things it names have to be real.
  const p = serialiseEditor(STATE, { pxPerFt: STATE.pxPerFt });
  const { got, set } = recorder();
  applyEditor(p, set);

  const notRestored = NOT_UNDOABLE.filter((f) => !(setterFor(f) in got));
  ok('every held-back field is one applyEditor actually restores',
    notRestored.length === 0, `never restored: ${notRestored.join(', ')}`);

  const notInDoc = NOT_UNDOABLE.filter((f) => !(f in EMPTY_DOC));
  ok('every held-back field is a real document field',
    notInDoc.length === 0, `not in the document: ${notInDoc.join(', ')}`);

  ok('it is the viewport and the selection, and nothing else',
    same([...NOT_UNDOABLE].sort(),
         ['focusId', 'layers', 'roomState', 'selectedOutlineId', 'view', 'zoom']),
    NOT_UNDOABLE.join(', '));

  // App.jsx builds its no-op bag from this list. If somebody puts the six names
  // back by hand, this is what says so.
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  ok('App.jsx does not hand-write the hold-backs any more',
    !/setFocusId:\s*hold/.test(app) && /NOT_UNDOABLE\.map/.test(app));

  // ...AND THE THIRD READER. `VIEW_FIELDS` in undo.js was a third hand-written
  // copy of this list — it is how `record` decides a document differs only in
  // the viewport and is not worth a step. It is derived now, and this is what
  // says the three cannot drift apart again.
  ok('undo.js derives its ignore list from the same place',
    same(VIEW_FIELDS, ['savedAt', ...Object.values(NOT_UNDOABLE_KEYS)]),
    VIEW_FIELDS.join(', '));
  ok('the key map covers every held-back field',
    same(Object.keys(NOT_UNDOABLE_KEYS).sort(), [...NOT_UNDOABLE].sort()),
    Object.keys(NOT_UNDOABLE_KEYS).join(', '));

  /* A KNOWN, DELIBERATELY UNFIXED DEFECT, PINNED SO IT CANNOT BE FIXED BY
     ACCIDENT. `roomState` is written out as `segmentation`, so undo.js deleting
     `roomState` from a serialised document deletes nothing and a re-run of the
     room detector pushes an undo step whose undo restores nothing visible.
     Correcting the map is a change in undo granularity and is not this
     refactor's to make — see the note in planState.js. When somebody does fix
     it, this test is what tells them the behaviour changed on purpose. */
  const seg1 = serialiseEditor({ ...EMPTY_DOC, roomState: { status: 'done', count: 2 } });
  const seg2 = serialiseEditor({ ...EMPTY_DOC, roomState: { status: 'done', count: 9 } });
  ok('KNOWN DEFECT: a re-segmentation still counts as a substantive change',
    sameDoc(seg1, seg2) === false,
    'if this now passes as `same`, the roomState -> segmentation key was fixed '
    + 'and undo granularity changed — update this test deliberately');
  ok('...because the field is written under a different key than the map names',
    NOT_UNDOABLE_KEYS.roomState === 'roomState' && 'segmentation' in seg1
      && !('roomState' in seg1));
}

// ---------------------------------------------------------------------------
// THE TWO MANUAL CHECKS, AS FAR AS THEY GO WITHOUT A BROWSER.
//
// WHAT THIS IS NOT. It is not "save a plan, reload it, and look at the drawing"
// — there is no canvas here, no Supabase row and no render, so nothing in this
// file can say the picture came back looking the same. What it CAN say is that
// the document survives the trip byte for byte, which is the half of that check
// a machine can hold: if the state going in equals the state coming out, a
// difference on screen would have to come from the renderer rather than from
// the save. The other half needs eyes.
// ---------------------------------------------------------------------------
section('save, reload, and the document is identical');
{
  // Three real edits, through the reducer, on top of a full document.
  let d = initialDoc();
  d = docReducer(d, { type: 'CEILING_MM_SET', id: 'o1', raw: '3200',
                      min: CEILING_MM_MIN, max: CEILING_MM_MAX });
  d = docReducer(d, { type: 'SURFACE_TONE_SET', id: 'o1', surface: 'ceiling', tone: 'dark' });
  d = docReducer(d, { type: 'ROW_WATTS_SET', roomId: 'o2', key: 'cove', watts: 12, defaultWatts: 9 });
  const before = { ...EMPTY_DOC, ...STATE, ...d };

  // SAVE: what the column would hold. RELOAD: what applyEditor puts back.
  const saved = JSON.parse(JSON.stringify(serialiseEditor(before, { pxPerFt: 18.5 })));
  const { got, set } = recorder();
  applyEditor(saved, set);

  const drift = Object.keys(before)
    .filter((f) => !(f in EXCLUDED))
    .filter((f) => setterFor(f) in got)
    .filter((f) => !same(got[setterFor(f)], before[f]));
  ok('a saved plan reopens holding exactly what it held',
    drift.length === 0, `differs in: ${drift.join(', ')}`);
  ok('the three edits are among what came back',
    got.setCeilingMm.o1 === 3200
      && materialsOf(got.setMaterials, 'o1').ceiling === 'dark'
      && got.setFixtureWatts.o2.cove === 12);
}

section('three edits, three undos, back where you started');
{
  /* THE DEBOUNCE IS SIMULATED RATHER THAN WAITED FOR. App restarts a QUIET_MS
     timer on every document and pushes when it finally runs, so one gesture is
     one step; here each edit is one settled burst, which is the same thing with
     the clock taken out. What is being checked is the STACK, not the timer. */
  const serialise = (d) => serialiseEditor({ ...EMPTY_DOC, ...d }, { pxPerFt: 18.5 });

  let d0 = initialDoc();
  const h = newHistory(serialise(d0));

  const edits = [
    { type: 'CEILING_MM_SET', id: 'o1', raw: '3200', min: CEILING_MM_MIN, max: CEILING_MM_MAX },
    { type: 'SURFACE_TONE_SET', id: 'o1', surface: 'floor', tone: 'mid' },
    { type: 'ROW_WATTS_SET', roomId: 'o2', key: 'cob', watts: 18, defaultWatts: 9 },
  ];
  let d = d0;
  for (const e of edits) { d = docReducer(d, e); record(h, serialise(d)); }

  ok('three edits are three steps', historyDepth(h).past === 3, JSON.stringify(historyDepth(h)));

  // ...and now walk back, the way `undo` does: close the burst, then step.
  let cur = serialise(d);
  record(h, cur);
  for (let i = 0; i < 3; i++) cur = stepBack(h, cur) ?? cur;

  ok('three undos land on the document you started with',
    sameDoc(cur, serialise(d0)),
    JSON.stringify({ ceilingMm: cur.ceilingMm, materials: cur.materials,
                     fixtureWatts: cur.fixtureWatts }));
  ok('...and specifically, every edit is gone',
    same(cur.ceilingMm, {}) && same(cur.materials, {}) && same(cur.fixtureWatts, {}),
    JSON.stringify([cur.ceilingMm, cur.materials, cur.fixtureWatts]));

  /* AND A FOURTH UNDO DOES NOT GO PAST THE START. `stepBack` returning null at
     the bottom of the stack is what makes the button go dead rather than the
     editor go blank — and `applyStep`'s own `if (!step) return` is the other
     half of that. */
  ok('a fourth undo has nowhere to go', stepBack(h, cur) === null);

  /* ONE GESTURE IS ONE STEP, AND A NO-OP IS NO STEP. The same edit applied
     twice produces the identical document, `record` sees no difference, and the
     stack does not grow — which is the granularity guarantee the reducer's
     identity stability exists to keep. */
  const settled = historyDepth(h).past;
  record(h, cur); record(h, cur);
  ok('recording an unchanged document adds no step',
    historyDepth(h).past === settled, `${historyDepth(h).past} vs ${settled}`);
}

section('the reducer owns what it claims to own');
{
  // The document's field table is the list this whole refactor turns three
  // hand-maintained lists into. Every field in it has to be a field the writer
  // emits and the reader restores — otherwise a field has been migrated into the
  // reducer and dropped out of the save, which is the lost-edit failure.
  const p = serialiseEditor(EMPTY_DOC, { pxPerFt: 1 });
  const { got, set } = recorder();
  applyEditor(p, set);

  const fields = Object.keys(DOC_FIELDS);
  const notWritten = fields.filter((f) => !(f in p));
  const notRead = fields.filter((f) => !(setterFor(f) in got));
  ok('every reducer field is written by serialiseEditor',
    notWritten.length === 0, `not written: ${notWritten.join(', ')}`);
  ok('every reducer field is restored by applyEditor',
    notRead.length === 0, `not restored: ${notRead.join(', ')}`);

  // ...and a fresh document is the same shape as a fresh App: all three sparse
  // maps start empty, because sparse is the whole design. See planState.js.
  /* A FRESH DOCUMENT IS THE SAME SHAPE AS A FRESH APP: the sparse maps empty,
     the lists empty. Written out rather than derived from DOC_FIELDS so that a
     field whose default changes has to be changed here too — a default is part
     of the save contract (an absent key reads as the default on every old plan),
     and deriving this assertion from the thing it is asserting would make it
     agree with any mistake. */
  ok('a new document starts at the defaults',
    same(initialDoc(), {
      ceilingMm: {}, materials: {}, fixtureWatts: {},
      manualCoves: [], manualTracks: [], manualCobs: [], cobArrays: [],
      trackFixtures: [], autoSpots: [],
      ceilingShapes: [], designPicks: {}, ceilingKinds: {}, chunkPicks: {},
    }),
    JSON.stringify(initialDoc()));
  ok('...and it is thirteen fields, three domains in',
    fields.length === 13, `${fields.length} fields`);
}

section('undo granularity: an edit that changes nothing is not an edit');
{
  // THE REASON THIS MATTERS IS THE DEBOUNCE. The undo stack records a step when
  // `editorState`'s IDENTITY changes and then goes quiet for QUIET_MS. A reducer
  // that returned a fresh object for a no-op edit would produce a document that
  // is deep-equal to the last one but not identical — an undo step you cannot
  // see the effect of. The `useState` updaters this replaced were all careful
  // about it; so is the reducer, and this is what says so.
  const base = docReducer(initialDoc(),
    { type: 'CEILING_MM_SET', id: 'o1', raw: '2700',
      min: CEILING_MM_MIN, max: CEILING_MM_MAX });

  const again = docReducer(base,
    { type: 'CEILING_MM_SET', id: 'o1', raw: '2700',
      min: CEILING_MM_MIN, max: CEILING_MM_MAX });
  ok('the same ceiling height twice is one document', again === base);

  const cleared = docReducer(base,
    { type: 'CEILING_MM_SET', id: 'o2', raw: '',
      min: CEILING_MM_MIN, max: CEILING_MM_MAX });
  ok('clearing a height that was never set is not a change', cleared === base);

  const toned = docReducer(base, { type: 'SURFACE_TONE_SET', id: 'o1', surface: 'ceiling', tone: 'dark' });
  ok('a real tone change IS a change', toned !== base);
  ok('...and it does not disturb the other fields',
    toned.ceilingMm === base.ceilingMm && toned.fixtureWatts === base.fixtureWatts);
  const sameTone = docReducer(toned, { type: 'SURFACE_TONE_SET', id: 'o1', surface: 'ceiling', tone: 'dark' });
  ok('the same tone twice is one document', sameTone === toned);

  // 'light' is the default: setting a wall light that is already light writes
  // nothing, which is the sparse rule the save depends on.
  const wall = docReducer(base, { type: 'WALL_TONE_SET', id: 'o1', edge: 0, tone: 'light' });
  ok('a wall set back to the default stores nothing',
    same(materialsOf(wall.materials, 'o1').walls, {}));

  const watts = docReducer(base, { type: 'ROW_WATTS_SET', roomId: 'o1', key: 'cob', watts: 9, defaultWatts: 9 });
  ok('a wattage at its family default is not stored', watts === base);
  const w2 = docReducer(base, { type: 'ROW_WATTS_SET', roomId: 'o1', key: 'cob', watts: 12, defaultWatts: 9 });
  const w3 = docReducer(w2, { type: 'ROW_WATTS_SET', roomId: 'o1', key: 'cob', watts: 9, defaultWatts: 9 });
  ok('...and setting one back to the default empties the room out of the map',
    same(w3.fixtureWatts, {}), JSON.stringify(w3.fixtureWatts));

  // An unknown action is not a document change. React invokes reducers twice in
  // StrictMode and dispatches actions this file has never heard of exactly
  // never — but a reducer that rebuilt state on `default` would turn every one
  // of those into an undo step.
  ok('an unknown action changes nothing', docReducer(base, { type: 'NOPE' }) === base);

  // ...and a restore of the value already there is not a change either, which is
  // what stops opening a plan from looking like an edit.
  const restored = docReducer(base, { type: 'DOC_FIELD_RESTORED', field: 'ceilingMm', value: base.ceilingMm });
  ok('restoring a field to what it already is, is not a change', restored === base);
  ok('restoring an unknown field is refused',
    docReducer(base, { type: 'DOC_FIELD_RESTORED', field: 'nope', value: 1 }) === base);
  ok('the truthiness-guarded set is still exactly seven fields',
    TRUTHY_GUARDED.length === 7);
}

section('the list ops: identity, and the rules that are not shapes');
{
  const add = (d, field, item) => docReducer(d, { type: 'LIST_ADDED', field, item });
  let d = initialDoc();
  d = add(d, 'ceilingShapes', { id: 'sh1', role: 'cove', radiusFt: 1 });
  d = add(d, 'ceilingShapes', { id: 'sh2', role: 'track', radiusFt: 0 });

  /* THE NO-OP BAILOUT ON A PATCH. Sweeping a radius slider from 1 ft to 2 ft and
     back must land on ONE undo step, not three — and the middle of that sweep
     writes the value that is already there many times over. `patchIn` compares
     before it builds; this is what says so. */
  const same1 = docReducer(d, { type: 'LIST_PATCHED', field: 'ceilingShapes',
                                id: 'sh1', patch: { radiusFt: 1 } });
  ok('a patch that changes nothing is not a change', same1 === d);
  const moved = docReducer(d, { type: 'LIST_PATCHED', field: 'ceilingShapes',
                                id: 'sh1', patch: { radiusFt: 2 } });
  ok('...and a patch that does change something is', moved !== d);
  ok('...and it leaves its neighbours alone', moved.ceilingShapes[1] === d.ceilingShapes[1]);

  ok('patching a shape that is not there is not a change',
    docReducer(d, { type: 'LIST_PATCHED', field: 'ceilingShapes',
                    id: 'nope', patch: { radiusFt: 9 } }) === d);
  ok('removing a shape that is not there is not a change',
    docReducer(d, { type: 'LIST_REMOVED', field: 'ceilingShapes', id: 'nope' }) === d);
  ok('clearing an already-empty list is not a change',
    docReducer(d, { type: 'LIST_CLEARED', field: 'manualCoves' }) === d);
  ok('adding none of many is not a change',
    docReducer(d, { type: 'LIST_ADDED_MANY', field: 'trackFixtures', items: [] }) === d);
  ok('an unchanged list from the updater is not a change',
    docReducer(d, { type: 'LIST_UPDATED', field: 'ceilingShapes', update: (l) => l }) === d);
  ok('...and a changed one is',
    docReducer(d, { type: 'LIST_UPDATED', field: 'ceilingShapes',
                    update: (l) => l.slice(0, 1) }) !== d);

  /* THE MINTED ID KEEPS ITS FORMAT, and it is minted from the list's own length
     — which is the only reason this action exists instead of LIST_ADDED. */
  const t1 = docReducer(initialDoc(), { type: 'LIST_ADDED_MINTED', field: 'manualTracks',
    idPrefix: 'mtrack', stamp: 'abc', item: { ptsFt: [], closed: false } });
  const t2 = docReducer(t1, { type: 'LIST_ADDED_MINTED', field: 'manualTracks',
    idPrefix: 'mtrack', stamp: 'abc', item: { ptsFt: [], closed: false } });
  ok('a minted id is `prefix-stamp-index`',
    t1.manualTracks[0].id === 'mtrack-abc-0' && t2.manualTracks[1].id === 'mtrack-abc-1',
    `${t1.manualTracks[0].id}, ${t2.manualTracks[1].id}`);

  /* --- THE THREE RULES THAT ARE ABOUT ONE FIELD AND NOTHING ELSE ---------- */

  /* AUTOPLACE OFF TAKES BACK ONLY WHAT IS STILL THE TOGGLE'S, and the predicate
     is TWO terms for a reason: a lamp somebody has re-specified or dragged is
     theirs. A one-term version — every lamp in the room — is a button that
     throws away work, which is the whole thing `autoplaceIn`'s note warns
     about. */
  let cobs = initialDoc();
  cobs = add(cobs, 'manualCobs', { id: 'a1', roomId: 'o1', auto: true });
  cobs = add(cobs, 'manualCobs', { id: 'a2', roomId: 'o1', auto: false });
  cobs = add(cobs, 'manualCobs', { id: 'a3', roomId: 'o2', auto: true });
  const dropped = docReducer(cobs, { type: 'AUTO_COBS_DROPPED', roomId: 'o1' });
  ok('autoplace off drops the room\'s automatic lamps',
    !dropped.manualCobs.some((c) => c.id === 'a1'));
  ok('...and keeps the one somebody made their own',
    dropped.manualCobs.some((c) => c.id === 'a2'),
    JSON.stringify(dropped.manualCobs.map((c) => c.id)));
  ok('...and does not reach into another space',
    dropped.manualCobs.some((c) => c.id === 'a3'));
  ok('...and is not a change when the room has no automatic lamps',
    docReducer(dropped, { type: 'AUTO_COBS_DROPPED', roomId: 'o1' }) === dropped);

  /* RE-SPECIFYING CLAIMS THE LAMP. `spec: true` stops the next re-derive pass
     overwriting the figure, and `auto: false` stops the toggle taking the lamp
     away — both have to ride with the write or the edit half-applies. */
  const spec = docReducer(cobs, { type: 'COB_SPEC_SET', id: 'a1', watts: 18, beam: 24 });
  const lamp = spec.manualCobs.find((c) => c.id === 'a1');
  ok('re-specifying a lamp marks it specified and no longer automatic',
    lamp.watts === 18 && lamp.beam === 24 && lamp.spec === true && lamp.auto === false,
    JSON.stringify(lamp));
  ok('...so autoplace off can no longer take it',
    docReducer(spec, { type: 'AUTO_COBS_DROPPED', roomId: 'o1' })
      .manualCobs.some((c) => c.id === 'a1'));

  /* A RUN'S MODULES GO WITH THE RUN, by the track id and not by their own. */
  let mods = initialDoc();
  mods = docReducer(mods, { type: 'LIST_ADDED_MANY', field: 'trackFixtures',
    items: [{ id: 'm1', trackId: 'sh2' }, { id: 'm2', trackId: 'sh2' },
            { id: 'm3', trackId: 'sh9' }] });
  const gone = docReducer(mods, { type: 'TRACK_MODULES_DROPPED', trackId: 'sh2' });
  ok('deleting a run takes its modules and no others',
    same(gone.trackFixtures.map((f) => f.id), ['m3']),
    JSON.stringify(gone.trackFixtures.map((f) => f.id)));
  ok('...and dropping the modules of a run with none is not a change',
    docReducer(gone, { type: 'TRACK_MODULES_DROPPED', trackId: 'sh2' }) === gone);

  /* THE SET SEMANTICS ON `autoSpots`. Turning a switch on twice is one
     document, which is what stops a re-render producing an undo step. */
  const on1 = docReducer(initialDoc(), { type: 'ID_ADDED', field: 'autoSpots', id: 'o1' });
  ok('switching autoplace on twice is one document',
    docReducer(on1, { type: 'ID_ADDED', field: 'autoSpots', id: 'o1' }) === on1);
  /* BY IDENTITY, against ONE document — `initialDoc()` builds a new object each
     call, so comparing two of them proves nothing. */
  const fresh = initialDoc();
  ok('switching off something that was never on is not a change',
    docReducer(fresh, { type: 'ID_REMOVED', field: 'autoSpots', id: 'o1' }) === fresh);
  ok('...and switching one off that was on empties the list',
    same(docReducer(on1, { type: 'ID_REMOVED', field: 'autoSpots', id: 'o1' }).autoSpots, []));

  /* THE MAPS ARE SPARSE AND STAY SPARSE. */
  const pick1 = docReducer(initialDoc(),
    { type: 'MAP_ENTRY_SET', field: 'chunkPicks', key: 'o1', value: 'halves-x' });
  ok('setting the same chunk pick twice is one document',
    docReducer(pick1, { type: 'MAP_ENTRY_SET', field: 'chunkPicks',
                        key: 'o1', value: 'halves-x' }) === pick1);
  const freshMap = initialDoc();
  ok('clearing an empty map is not a change',
    docReducer(freshMap, { type: 'MAP_CLEARED', field: 'designPicks' }) === freshMap);
  ok('...and clearing a full one empties it',
    same(docReducer(pick1, { type: 'MAP_CLEARED', field: 'chunkPicks' }).chunkPicks, {}));
}

section('the card numbers');
{
  const rooms = [{ id: 'o1' }, { id: 'o2' }];
  const totals = { rooms: 2, failed: 0, lights: 17, areaSqft: 412.345, lumens: 12400 };
  const st = statsFrom({ totals, rooms, boq: { lines: [1, 2, 3] } });
  ok('counts spaces and fittings', st.rooms === 2 && st.lights === 17);
  ok('rounds the area to one place', st.areaSqft === 412.3, String(st.areaSqft));
  ok('is small enough to be a list column', JSON.stringify(st).length < 200);

  ok('nothing traced reads as uploaded',
    statusFrom({ outlines: [], litIds: [], totals: { rooms: 0 } }) === 'uploaded');
  ok('spaces but no layout reads as tracing',
    statusFrom({ outlines: rooms, litIds: [], totals: { rooms: 0 } }) === 'tracing');
  ok('lit but not laid out reads as planning',
    statusFrom({ outlines: rooms, litIds: ['o1'], totals: { rooms: 0 } }) === 'planning');
  ok('a layout reads as ready',
    statusFrom({ outlines: rooms, litIds: ['o1'], totals: { rooms: 2 } }) === 'ready');
}

console.log(`\n${fail ? `${fail} FAILED, ` : ''}${pass} passed`);
if (fail) process.exit(1);
console.log('all good');
