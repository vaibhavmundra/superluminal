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
         NOT_UNDOABLE, NOT_UNDOABLE_KEYS, setterFor,
         LAYER_DEFAULTS, ZOOM_MIN, ZOOM_MAX, clampZoom }
  from '../src/lib/planState.js';
import { newHistory, record, stepBack, historyDepth, VIEW_FIELDS, sameDoc }
  from '../src/lib/undo.js';
import { docReducer, initialDoc, DOC_FIELDS, heldBackFields }
  from '../src/hooks/usePlanDoc.js';
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
  stated: null,
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
// A DOCUMENT BUILT BY DOING THINGS TO IT, not a literal. The migrated
// fields are driven through `docReducer` with N random VALID actions, so what is
// being round-tripped is a document some sequence of real edits could actually
// produce — including the sparse-map edge cases a hand-written fixture forgets:
// an entry added and then removed, a value written back to its default, a room
// whose last row was deleted.
// ---------------------------------------------------------------------------

/* A COMPLETE DOCUMENT. Every one of the sixty-three fields at the value App's own
   `useState` starts it at, so the round trip is tested over the whole shape
   rather than over whichever fields a fixture happened to mention. A field left
   `undefined` here would round-trip as `[]` or `{}` — applyEditor's `??` doing
   its job — and would silently pass a comparison it should fail. */
const EMPTY_DOC = {
  unitId: null, pdfPage: null,
  scaleMode: 'door', refId: 'door900', customFt: 3,
  measure: { a: null, b: null }, doorPick: null, stated: null, ceilingFt: 10,
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
  manualCoves: [], manualTracks: [], manualCobs: [], manualSpots: [], autoSpots: [],
  cobArrays: [], trackFixtures: [], renderRefs: {},
  boardsOff: [], boardMoves: {}, boardPoints: {}, flowBoards: {}, flowBends: {},
  flowLinks: {},
  manualBoards: [], boardKinds: {}, boardHeights: {}, boardOrders: {},
  ceilingMm: {}, materials: {}, fixtureWatts: {}, fixtureOff: {},
  /* THE REAL DEFAULTS AND NOT A PLAUSIBLE SUBSET. This was a hand-written
     four-key object — `{ plan, lights, labels, electrical }` — which passed
     every assertion in this file for as long as `layers` was a `useState` in
     App.jsx that nothing here could see. The moment the document owned the
     field, the shape check caught it: a fixture whose defaults disagree with the
     app's makes the round trip pass over a document App can never hold.
     Imported rather than restated, which is the whole argument. */
  layers: { ...LAYER_DEFAULTS },
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

/* WHERE THE WRITER PUTS EACH FIELD, FOR THE FIELDS IT DOES NOT PUT AT THE TOP.
   `serialiseEditor` nests the five scale settings under `scale` and the three
   view preferences under `ui`, and renames two more — so "is this field in the
   saved object" is a question about a PATH and not about a key. Anything absent
   from this map is written under its own name.

   IT IS A HAND-WRITTEN STATEMENT OF THE WRITER'S SHAPE, which is exactly the
   kind of list this refactor exists to remove — so it does not stand alone:
   `NOT_UNDOABLE_KEYS` in planState.js is the same mapping for the six held-back
   fields, and the assertion below requires the two to AGREE everywhere they
   overlap. A rename applied to one and forgotten in the other fails there. */
const WRITTEN_AS = {
  scaleMode: 'scale.mode',
  refId: 'scale.refId',
  customFt: 'scale.customFt',
  measure: 'scale.measure',
  doorPick: 'scale.doorPick',
  stated: 'scale.stated',
  layers: 'ui.layers',
  zoom: 'ui.zoom',
  view: 'ui.view',
  // THE TWO RENAMES. `roomState` is written as the segmenter's own reply and
  // `projectType` is the kind of BUILDING — see the alias note in App.jsx.
  roomState: 'segmentation',
  projectType: 'projectType',
};

/** Resolve a field to the value the writer actually stored, path and all. */
const writtenValue = (p, field) =>
  (WRITTEN_AS[field] ?? field).split('.').reduce((o, k) => (o == null ? o : o[k]), p);

/** ...and whether it is there at all, which is what the coverage check asks. */
const isWritten = (p, field) => {
  const path = (WRITTEN_AS[field] ?? field).split('.');
  let o = p;
  for (const k of path.slice(0, -1)) { if (o == null || !(k in o)) return false; o = o[k]; }
  return o != null && path[path.length - 1] in o;
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
  const pick = Math.floor(r() * 25);

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
  /* AND THE AIMED SPOT, WHICH IS THE LAMP ABOVE PLUS AN ANGLE — see
     `manualSpots` in usePlanDoc. Written through the same generic list action,
     which is the whole reason it needed no reducer case of its own. */
  if (pick === 23) return { type: 'LIST_ADDED', field: 'manualSpots',
                            item: { id: `sp${1 + Math.floor(r() * 3)}`, roomId: room,
                                    xFt: 5, yFt: 6, aim: r() * 6.28 } };
  if (pick === 24) return { type: 'LIST_REMOVED', field: 'manualSpots',
                            id: `sp${1 + Math.floor(r() * 3)}` };
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
      items: [{ id: `md${1 + Math.floor(r() * 3)}`, on: shapeId, kind: 'diffuser', u: 0.4, watts: 5 }] },
  ]);

  /* --- domain 4, SPLIT ACROSS TWO PICKS so each of its two dozen actions is
     actually drawn often enough to matter. One pick would give each option a
     dozen draws across the whole walk, and a field written once in two hundred
     documents is a field the round trip barely covers.

     THE DISMISSAL IDS ARE IN THE PASS'S OWN NAMESPACE — `acc-<room>-<n>`,
     `surf-<room>-<n>` — because that format IS the rule
     ROOM_DISMISSALS_DROPPED applies. A generator that dismissed `x1` would
     exercise the case and assert nothing: the drop would never match, and the
     "a re-run takes its room's dismissals with it" behaviour would go
     untested. */
  if (pick === 14) return oneOf([
    { type: 'MAP_MERGED', field: 'accentResults',
      entries: { [room]: { zones: [{ id: `acc-${room}-0`, kind: 'strip', rejected: false },
                                   { id: `acc-${room}-1`, kind: 'cove', rejected: on_off(r) }] } } },
    // ...and the empty merge, which is what a pass that found nothing writes.
    { type: 'MAP_MERGED', field: 'accentResults', entries: {} },
    { type: 'ID_ADDED', field: 'accentDismissed', id: `acc-${room}-${Math.floor(r() * 2)}` },
    { type: 'ID_REMOVED', field: 'accentDismissed', id: `acc-${room}-0` },
    { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed', prefix: 'acc', roomIds: [room] },
    { type: 'LIST_ADDED', field: 'manualAccents',
      item: { id: `man${1 + Math.floor(r() * 3)}`, type: 'sconce', roomId: room,
              source: 'placed', rect: { x0: 1, y0: 2, x1: 3, y1: 4 } } },
    { type: 'LIST_REMOVED', field: 'manualAccents', id: `man${1 + Math.floor(r() * 3)}` },
    { type: 'LIST_CLEARED', field: 'manualAccents' },
    /* THE FITTING THAT LIVES IN TWO STORES, DRAGGED. The id pool spans both on
       purpose — a hand-placed `man1` and a pass-produced `acc-<room>-0` — because
       the bug this case exists to fix was the write going to the wrong one. */
    { type: 'ACCENT_ZONE_UPDATED', roomId: room,
      id: oneOf(['man1', 'man2', `acc-${room}-0`, `acc-${room}-1`]),
      fn: (z) => ({ ...z, rect: { x0: 9, y0: 9, x1: 11, y1: 11 } }) },
    { type: 'MAP_MERGED', field: 'surfaceResults',
      entries: { [room]: { surfaces: [{ id: `surf-${room}-0`, kind: 'tv' }] } } },
    { type: 'ID_ADDED', field: 'surfaceDismissed', id: `surf-${room}-0` },
    { type: 'ROOM_DISMISSALS_DROPPED', field: 'surfaceDismissed', prefix: 'surf', roomIds: [room] },
    { type: 'LIST_ADDED', field: 'manualSurfaces',
      item: { id: `msf${1 + Math.floor(r() * 3)}`, roomId: room, kind: 'custom',
              label: 'Task area', source: 'placed', rect: { x0: 2, y0: 2, x1: 6, y1: 5 } } },
    { type: 'LIST_REMOVED', field: 'manualSurfaces', id: `msf${1 + Math.floor(r() * 3)}` },
    { type: 'LIST_CLEARED', field: 'manualSurfaces' },
    { type: 'ID_ADDED', field: 'artDismissed', id: `we-${room}-${Math.floor(r() * 2)}` },
    { type: 'LIST_CLEARED', field: 'artDismissed' },
  ]);

  if (pick === 15) return oneOf([
    { type: 'MAP_ENTRY_SET', field: 'wallResults', key: room,
      value: { elements: [{ id: `we-${room}-0`, type: 'painting', wall: 'left',
                            start_cell: 'A3', end_cell: 'A5', width_ft: 3 }], took: 8210 } },
    { type: 'MAP_CLEARED', field: 'wallResults' },
    /* THE TRIM'S TWO ENDS, AND 0 IS IN THE POOL ON PURPOSE. A run dragged back
       to where the rule put it must store NOTHING rather than `{a:0,b:0}` — see
       RUN_TRIM_SET — and a generator that never produced 0 would never reach
       the branch that deletes the row. */
    { type: 'RUN_TRIM_SET', trimId: `rcove-we-${room}-0-0`,
      end: on_off(r) ? 'a' : 'b', ft: oneOf([0, 0.5, -1, 0.75]) },
    { type: 'RUN_TRIM_SET', trimId: `shelf-we-${room}-1-0`,
      end: on_off(r) ? 'a' : 'b', ft: oneOf([0, 0.25]) },
    { type: 'MAP_CLEARED', field: 'runTrims' },
    { type: 'ID_ADDED', field: 'runsOff', id: `shelf-we-${room}-0-0` },
    { type: 'ID_REMOVED', field: 'runsOff', id: `shelf-we-${room}-0-0` },
    // The detector's finished answer, and the failure that writes an empty set.
    { type: 'LIST_REPLACED', field: 'doors',
      next: [{ id: 'd1', cls: 'door', conf: 0.9, openingPx: 8,
               rect: { x0: 1, y0: 2, x1: 9, y1: 4 } }] },
    { type: 'LIST_CLEARED', field: 'doors' },
    { type: 'LIST_ADDED', field: 'doors',
      item: { id: `dh${1 + Math.floor(r() * 3)}`, cls: 'door', conf: 1, placed: true,
              openingPx: 8, rect: { x0: 5, y0: 6, x1: 13, y1: 8 } } },
    // The release of a door drag: a new rect and the opening it implies.
    { type: 'LIST_PATCHED', field: 'doors', id: `dh${1 + Math.floor(r() * 3)}`,
      patch: { openingPx: oneOf([8, 12, 16]) } },
    { type: 'LIST_REMOVED', field: 'doors', id: `dh${1 + Math.floor(r() * 3)}` },
    { type: 'FIELD_SET', field: 'doorsOk', value: on_off(r) },
    { type: 'LIST_ADDED', field: 'zones',
      item: { id: `z${1 + Math.floor(r() * 3)}`, x0: 5, y0: 5, x1: 25, y1: 25 } },
    { type: 'LIST_REMOVED', field: 'zones', id: `z${1 + Math.floor(r() * 3)}` },
    { type: 'LIST_CLEARED', field: 'zones' },
  ]);

  /* --- domain 5, ALSO OVER TWO PICKS. The boards and the wires, and almost
     every one of these is an OVERRIDE of something the rules produce — which is
     what makes them worth generating rather than fixturing: the interesting
     documents are the ones where an override was added, taken back to the
     rule's own answer, and thereby deleted again. */
  const boardId = `sb-${room}-${oneOf(['door', 'facing', 'bed'])}`;
  const handBoard = `sb-hand-${1 + Math.floor(r() * 3)}`;
  const flowId = `fl-${room}-${Math.floor(r() * 2)}`;
  if (pick === 16) return oneOf([
    /* THE PLATE THE RULES PLACED, DELETED — a dismissal, because the next
       render puts a derived board straight back. */
    { type: 'BOARD_DELETED', id: boardId },
    { type: 'ID_REMOVED', field: 'boardsOff', id: boardId },
    /* ...AND THE ONE SOMEBODY PUT ON A WALL, which is REMOVED instead: there is
       no rule left to suppress. The pair is generated against the same three
       hand ids so add-then-delete sequences actually collide. */
    { type: 'LIST_ADDED', field: 'manualBoards',
      item: { id: handBoard, roomId: room, sFt: 4.25 } },
    { type: 'BOARD_DELETED', id: handBoard },
    { type: 'LIST_CLEARED', field: 'manualBoards' },
    /* A PLATE SLID ALONG ITS WALL. Drawn against BOTH kinds of id on purpose —
       the whole of BOARD_SLID is that it writes to a different store for each,
       and a generator that only ever slid one kind would test half of it. */
    { type: 'BOARD_SLID', id: boardId, sFt: oneOf([1.5, 4.25, 9]) },
    { type: 'BOARD_SLID', id: handBoard, sFt: oneOf([2, 6.75]) },
    { type: 'MAP_ENTRY_REMOVED', field: 'boardMoves', key: boardId },
    { type: 'MAP_CLEARED', field: 'boardMoves' },
    /* WHAT SOMEBODY PUT ON A PLATE. The ids are per press — two 16A sockets on
       one plate is an ordinary thing to want — so they are minted from the
       walk's own counter rather than from the point's kind. */
    { type: 'MAP_LIST_APPENDED', field: 'boardPoints', key: boardId,
      item: { id: `bp${1 + Math.floor(r() * 3)}`, kind: 'socket',
              amps: oneOf([6, 16]), label: '16A socket' } },
    { type: 'MAP_LIST_REMOVED', field: 'boardPoints', key: boardId,
      id: `bp${1 + Math.floor(r() * 3)}` },
    { type: 'MAP_CLEARED', field: 'boardPoints' },
  ]);

  if (pick === 17) return oneOf([
    /* OUTLET OR SWITCHBOARD, AND `born` BOTH WAYS ROUND. The rule that an entry
       restating what the plate was BORN as is deleted rather than written can
       only be reached by generating the matching pair, so both are drawn. */
    { type: 'BOARD_OUTLET_SET', id: boardId, outlet: on_off(r), born: false },
    { type: 'BOARD_OUTLET_SET', id: handBoard, outlet: on_off(r), born: true },
    { type: 'MAP_ENTRY_PATCHED', field: 'boardKinds', key: boardId,
      patch: { amps: oneOf([6, 16, 20]) } },
    { type: 'MAP_CLEARED', field: 'boardKinds' },
    { type: 'MAP_ENTRY_SET', field: 'boardHeights', key: boardId,
      value: oneOf([300, 1100, 1200]) },
    { type: 'MAP_CLEARED', field: 'boardHeights' },
    { type: 'MAP_ENTRY_SET', field: 'boardOrders', key: boardId,
      value: oneOf([['u1', 'u2'], ['u2', 'u1'], ['u2', 'u1', 'u3']]) },
    { type: 'MAP_CLEARED', field: 'boardOrders' },
    /* A WIRE DROPPED ON A PLATE, AND DROPPED HOME. `home` true is the way back
       out — it DELETES the override rather than storing the rules' own answer —
       so both readings have to be generated or the delete branch is never run. */
    { type: 'FLOW_BOARD_SET', flowId, boardId, home: false },
    { type: 'FLOW_BOARD_SET', flowId, boardId, home: true },
    { type: 'MAP_CLEARED', field: 'flowBoards' },
    // ...and one leg's arc nudged, which is the per-frame write.
    { type: 'MAP_ENTRY_PATCHED', field: 'flowBends', key: flowId,
      patch: { [`leg${Math.floor(r() * 3)}`]: oneOf([0, 0.5, -0.75, 1.25]) } },
    { type: 'MAP_CLEARED', field: 'flowBends' },
    /* ...and a fitting's INPUT re-plugged into another fitting, which is the
       membership override. Keyed on FITTING ids, never on the flow id above —
       a flow id is derived from the grid and would not survive a re-chunk. */
    { type: 'MAP_ENTRY_SET', field: 'flowLinks',
      key: `lt-${Math.floor(r() * 4)}`, value: `lt-${Math.floor(r() * 4) + 4}` },
    { type: 'MAP_ENTRY_REMOVED', field: 'flowLinks', key: `lt-${Math.floor(r() * 4)}` },
    { type: 'MAP_CLEARED', field: 'flowLinks' },
    // ...and Delete on the wire, which takes both overrides in one act.
    { type: 'FLOW_OVERRIDES_DROPPED', flowId },
  ]);

  /* --- domain 6a: the drawing's interpretation, and the plan's identity.
     THE TRUTHINESS-GUARDED FIELDS ARE GENERATED CAREFULLY. `scaleMode`, `refId`
     and `measure` are restored behind `if (x)` rather than `??` — see
     TRUTHY_GUARDED and the note in planState.js — so a falsy value would not
     come back and generating one would fail the round trip for a reason that is
     the guard's, not the reducer's. `customFt` and `ceilingFt` use `!= null`, so
     0 is generated for those on purpose: it round-trips and must. */
  if (pick === 18) return oneOf([
    { type: 'FIELD_SET', field: 'unitId', value: oneOf([null, 'mm', 'in', 'ft']) },
    { type: 'FIELD_SET', field: 'pdfPage', value: oneOf([null, 1, 3, 12]) },
    { type: 'FIELD_SET', field: 'scaleMode', value: oneOf(['door', 'ref']) },
    { type: 'FIELD_SET', field: 'refId', value: oneOf(['door900', 'door750', 'custom']) },
    // 0 IS IN THE POOL and it has to be: the reader guards this one with
    // `!= null`, so a zero must survive rather than being read as "absent".
    { type: 'FIELD_SET', field: 'customFt', value: oneOf([0, 3, 3.5, 12]) },
    { type: 'FIELD_SET', field: 'measure',
      value: oneOf([{ a: null, b: null },
                    { a: { x: 10, y: 20 }, b: null },
                    { a: { x: 10, y: 20 }, b: { x: 210, y: 20 } }]) },
    /* THE PICK AND THE WIDTH ARE TWO HALVES OF ONE ACT, and the width PATCHES —
       so both are generated, and `DOOR_WIDTH_SET` is generated against a
       document that may or may not have a pick in it. That is the interesting
       case: there is nothing to widen if nothing is picked. */
    { type: 'FIELD_SET', field: 'doorPick',
      value: oneOf([null, { id: 'd2', mm: null, rect: { x0: 1, y0: 2, x1: 9, y1: 4 } }]) },
    { type: 'DOOR_WIDTH_SET', mm: oneOf([700, 750, 900, 1200]) },
    /* THE SCALE A DRAWING STATED ABOUT ITSELF, and it writes TWO fields — the
       record and the mode — so the walk exercises the pair that STATED_SET
       keeps together. Null is generated too: it is what a new plan resets to,
       and it must put `scaleMode` back rather than leaving a mode pointing at
       a reading that is gone. */
    { type: 'STATED_SET', stated: oneOf([null,
        { pxPerFt: 24.5, confidence: 'high', spread: 0.004,
          from: [{ source: 'room', detail: `18'-0" X 12'-0" in BED 1` }],
          at: '2026-01-01T00:00:00.000Z' }]) },
    { type: 'FIELD_SET', field: 'projectType',
      value: oneOf([null, 'residential', 'hospitality', 'office']) },
    { type: 'MAP_MERGED', field: 'roomTypes',
      entries: { [room]: { type: oneOf(['living', 'bedroom', 'kitchen']),
                           confidence: 0.82, why: 'a bed' } } },
    // ...and the merge that a classify run over nothing writes.
    { type: 'MAP_MERGED', field: 'roomTypes', entries: {} },
    { type: 'MAP_CLEARED', field: 'roomTypes' },
  ]);

  /* --- domain 6b: the spaces, and what was found in them.
     THE OUTLINES ARE GENERATED WITH `detected` AND `reviewed` BOTH WAYS ROUND,
     because those two flags are what every rule in this domain turns on: a
     proposal nobody has touched is the only thing a re-run may delete, and
     `reviewed` is what the three lighting acts write. A generator that only made
     hand-traced outlines would never exercise the merge. */
  const oid = `o${1 + Math.floor(r() * 3)}`;
  const outline = (id, detected, reviewed) => ({
    id, name: `Room ${id.slice(1)}`, rectify: true, detected, reviewed,
    pointsDu: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
  });
  if (pick === 19) return oneOf([
    { type: 'LIST_ADDED', field: 'outlines', item: outline(oid, on_off(r), on_off(r)) },
    { type: 'LIST_PATCHED', field: 'outlines', id: oid,
      patch: { name: oneOf(['Living', 'Bed 1', 'Kitchen']) } },
    { type: 'LIST_PATCHED', field: 'outlines', id: oid, patch: { rectify: on_off(r) } },
    /* THE CORNERS, THROUGH THE FUNCTION-CARRYING CASE. The `null` return is
       generated too: fewer than three points is not a room and must be refused
       rather than stored — `removePoint` relies on that instead of checking. */
    { type: 'OUTLINE_POINTS_EDITED', id: oid,
      edit: (pts) => pts.map((q, i) => (i === 0 ? { x: q.x + 1, y: q.y } : q)) },
    { type: 'OUTLINE_POINTS_EDITED', id: oid, edit: () => null },
    { type: 'OUTLINE_POINTS_EDITED', id: oid, edit: (pts) => pts.slice(0, 2) },
    { type: 'OUTLINE_DELETED', id: oid },
    { type: 'LIST_CLEARED', field: 'outlines' },
    /* THE THREE LIGHTING ACTS. All three write several fields, and RELIT is
       drawn with `ids` both null (the whole sheet) and a subset, because the
       union branch and the assign-all branch are different code. */
    { type: 'PLAN_LIT' },
    { type: 'ROOM_LIT', id: oid },
    { type: 'RELIT', ids: null },
    { type: 'RELIT', ids: [oid] },
    { type: 'ID_REMOVED', field: 'litIds', id: oid },
    { type: 'LIST_CLEARED', field: 'litIds' },
    { type: 'ID_ADDED', field: 'dirtyIds', id: oid },
    { type: 'DIRTY_CLEARED', ids: null },
    { type: 'DIRTY_CLEARED', ids: [oid] },
    /* THE SEGMENTER'S OWN MERGE. The function is pure and returns both fields —
       see ROOMS_PROPOSED. `kept` here applies the real rule: an untouched
       proposal goes, anything a person touched stays. */
    { type: 'ROOMS_PROPOSED',
      merge: (os) => {
        const kept = os.filter((o) => !o.detected || o.reviewed);
        const made = [outline(`p${Math.floor(r() * 2)}`, true, false)]
          .filter((m) => !kept.some((k) => k.id === m.id));
        return { outlines: [...kept, ...made],
                 roomState: { status: 'done', ms: 4120, proposed: made.length,
                              returned: 1, dropped: 0, meta: { model: 'rooms-v3' } } };
      } },
  ]);

  if (pick === 20) return oneOf([
    /* `focusId` AND `selectedOutlineId` ARE `??`-GUARDED on read, so null is a
       real value for both and is generated. They are also two of the three
       fields Ctrl+Z holds back — which the save does not care about, and which
       is why they are in this walk like anything else. */
    { type: 'FIELD_SET', field: 'focusId', value: oneOf([null, oid]) },
    { type: 'FIELD_SET', field: 'selectedOutlineId', value: oneOf([null, oid]) },
    /* THE SEGMENTER'S STATUS. Not round-tripped — it is one of the two named
       EXCLUDED fields, restored deliberately lossily — but generated anyway so
       that documents carrying every shape of it go through the writer. */
    { type: 'FIELD_SET', field: 'roomState',
      value: oneOf([{ status: 'idle' },
                    { status: 'running' },
                    { status: 'error', error: 'no reply', ms: 900 },
                    { status: 'done', count: 2, ms: 4120, meta: { model: 'rooms-v3' } }]) },
    { type: 'LIST_REPLACED', field: 'detections',
      next: [{ id: `det-0`, cls: 'bed', conf: 0.88, roomId: oid,
               rect: { x0: 130, y0: 10, x1: 190, y1: 60 } }] },
    { type: 'LIST_ADDED_MANY', field: 'detections',
      items: [{ id: `det-${Math.floor(r() * 3)}`, cls: 'bed', conf: 0.7, roomId: oid,
                rect: { x0: 1, y0: 2, x1: 9, y1: 8 } }] },
    { type: 'LIST_ADDED_MANY', field: 'detections', items: [] },
    { type: 'LIST_CLEARED', field: 'detections' },
    { type: 'ID_ADDED', field: 'dismissed', id: `det-${Math.floor(r() * 3)}` },
    { type: 'LIST_CLEARED', field: 'dismissed' },
    /* THE BED CONTEST WRITES ITS VERDICTS THREE WAYS — replaced wholesale by
       the full pass, merged by the admin's "look again", and cleared by the
       plain detectors. All three are generated. */
    { type: 'FIELD_SET', field: 'bedVerdicts',
      value: { [oid]: { kind: 'judged', pick: 'openai', confidence: 0.7, asked: true } } },
    { type: 'MAP_MERGED', field: 'bedVerdicts',
      entries: { [oid]: { kind: 'one-sided', refound: true, confidence: 0.5 } } },
    { type: 'MAP_CLEARED', field: 'bedVerdicts' },
    /* `provider` IS TRUTHINESS-GUARDED, so only real ids are generated — see
       TRUTHY_GUARDED. */
    { type: 'FIELD_SET', field: 'provider', value: oneOf(['judge', 'roboflow', 'openai']) },
  ]);

  /* --- domain 6c: the ceiling's furniture, and the way it is looked at.
     THE ZOOM IS GENERATED PAST BOTH ENDS OF ITS RANGE on purpose. The restore
     guard on `ui.zoom` is a truthiness test and is only safe while a stored
     zoom cannot be 0 — see clampZoom — so a walk that only ever produced legal
     figures would never demonstrate that. */
  if (pick === 21) return oneOf([
    { type: 'LIST_ADDED', field: 'ceilingObjs',
      item: { id: `co${1 + Math.floor(r() * 3)}`, kind: oneOf(['fan', 'cassette']),
              x: 8.2, y: 5.5, diaFt: 3.9, rot: 0 } },
    { type: 'LIST_REMOVED_MANY', field: 'ceilingObjs',
      ids: [`co${1 + Math.floor(r() * 3)}`] },
    { type: 'LIST_UPDATED', field: 'ceilingObjs',
      update: (l) => l.map((o) => (o.rot === 90 ? o : { ...o, rot: 90 })) },
    // ...and the updater that moves nothing, which must not be a document.
    { type: 'LIST_UPDATED', field: 'ceilingObjs', update: (l) => l },
    { type: 'OBJECT_SWEEP_SET', ids: [`co${1 + Math.floor(r() * 3)}`],
      mm: oneOf([900, 1200, 1400]) },
    { type: 'LIST_CLEARED', field: 'ceilingObjs' },
    /* THE LAMP NUDGED OFF ITS CELL, AND PUT BACK. Both are generated against the
       same small key pool so the "the room goes with its last offset" branch is
       actually reached. */
    { type: 'LIGHT_MOVED', roomId: room, cellKey: `c${Math.floor(r() * 2)}`,
      dx: oneOf([0, 0.5, -0.25]), dy: oneOf([0, 0.75]) },
    { type: 'LIGHT_MOVE_RESET', roomId: room, cellKey: `c${Math.floor(r() * 2)}` },
    { type: 'MAP_CLEARED', field: 'lightMoves' },
    { type: 'MAP_LIST_APPENDED', field: 'renderRefs', key: room,
      item: { path: `u1/p1/renders/${room}/mf3k9-0.jpg`, name: 'living-01.png',
              w: 1400, h: 788, bytes: 402_112, quality: 0.82,
              fromW: 4000, fromH: 2250, fromBytes: 8_411_002,
              at: '2026-08-31T09:12:00.000Z' } },
    { type: 'MAP_CLEARED', field: 'renderRefs' },
  ]);

  if (pick === 22) return oneOf([
    { type: 'LAYER_TOGGLED', key: oneOf(['plan', 'lights', 'electrical', 'invert']) },
    { type: 'LAYER_SET', key: oneOf(['electrical', 'invert']), on: on_off(r) },
    /* PAST BOTH ENDS AND EXACTLY ON THEM. `ZOOM_SET` clamps, so what is stored
       is always legal — which is the condition the truthiness guard rests on. */
    { type: 'ZOOM_SET', to: oneOf([0, 0.01, ZOOM_MIN, 1, 1.4, ZOOM_MAX, 99]) },
    { type: 'ZOOM_SCALED', by: oneOf([1.2, 1 / 1.2, 100, 0.001]) },
    { type: 'FIELD_SET', field: 'view',
      value: oneOf(['spaces', 'design', 'boards', 'boq', 'admin']) },
    { type: 'STAGE_VIEW_REQUIRED' },
    { type: 'DESIGN_VIEW_REQUESTED' },
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
  /* ...or a fitting switched off, and switched back on — which deletes the
     entry and can empty the room out of the map. The same sparse rule as the
     wattage below it, exercised from the other side: there an entry appears when
     you DIFFER from the family default, here when you differ from lit. */
  if (r() < 0.25) {
    return { type: 'ROW_OFF_SET', roomId: room,
             key: ['cob', 'cove', `run-${Math.floor(r() * 2)}`][Math.floor(r() * 3)],
             off: r() < 0.6 };
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
     over actions that only ever touch three of twenty-six fields passes for the
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
    const untouched = Object.keys(DOC_FIELDS).filter((f) => !touched.has(f)).sort();
    /* TWO HONEST EXCEPTIONS, AND BOTH HAVE TO BE NAMED. Neither has a UI writer
       left, so no random walk of EDITS can reach them — and both are still in
       the document because taking a field out of the save is a decision about
       every plan already saved, not a refactor.

         `ceilingKinds`  one word per space, from before the decision moved to
                         the chunk. Its only action is the reset, and it is kept
                         so a plan made under the old switch keeps its coves.
         `ceilingFt`     the plan's single ceiling height. Read (the accent pass
                         quotes it to a model) and saved, but the only writer is
                         `applyEditor` restoring it — so on a new plan it sits
                         at 10 for ever. A PRE-EXISTING DEAD CONTROL: `ceilingMm`,
                         per space, superseded it. Named here rather than given
                         an action it has no caller for.

       A THIRD ENTRY APPEARING HERE IS A FIELD SOMEBODY MIGRATED WITHOUT ADDING
       ITS ACTIONS to `randomAction`, which is the omission this assertion was
       written to catch and has caught. */
    ok('the random walk actually writes every migrated field',
      same(untouched, ['ceilingFt', 'ceilingKinds']),
      `never written: ${untouched.join(', ')}`);
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
  /* --- AND DOMAIN 4's, WHICH ARE THE ONES A REOPENED PLAN LOSES VISIBLY. A
     dismissal that does not survive is a fitting somebody deleted back on the
     sheet; a trim that does not survive is a cove at the wrong length; a door
     confirmation that does not survive is the electrical layer gone off a
     finished drawing. All four failures look like the app being wrong about the
     design rather than like a save being broken, which is why they are here. */
  d = docReducer(d, { type: 'MAP_MERGED', field: 'accentResults',
    entries: { o1: { zones: [{ id: 'acc-o1-0', kind: 'strip', rejected: false }] } } });
  d = docReducer(d, { type: 'ID_ADDED', field: 'accentDismissed', id: 'acc-o1-1' });
  d = docReducer(d, { type: 'LIST_ADDED', field: 'manualAccents',
    item: { id: 'man9', type: 'sconce', roomId: 'o1', rect: { x0: 4, y0: 4, x1: 6, y1: 6 } } });
  d = docReducer(d, { type: 'ID_ADDED', field: 'artDismissed', id: 'we-o1-1' });
  d = docReducer(d, { type: 'MAP_ENTRY_SET', field: 'wallResults', key: 'o2',
    value: { elements: [{ id: 'we-o2-0', type: 'painting', wall: 'left' }], took: 990 } });
  d = docReducer(d, { type: 'RUN_TRIM_SET', trimId: 'rcove-we-o1-0-0', end: 'a', ft: 0.75 });
  d = docReducer(d, { type: 'ID_ADDED', field: 'runsOff', id: 'shelf-we-o1-2-0' });
  d = docReducer(d, { type: 'LIST_ADDED', field: 'doors',
    item: { id: 'dh1', cls: 'door', placed: true, openingPx: 14,
            rect: { x0: 30, y0: 30, x1: 44, y1: 34 } } });
  d = docReducer(d, { type: 'FIELD_SET', field: 'doorsOk', value: true });
  d = docReducer(d, { type: 'LIST_ADDED', field: 'zones',
    item: { id: 'z9', x0: 1, y0: 1, x1: 9, y1: 9 } });
  /* --- AND DOMAIN 5's, WHICH ARE THE ONES A RELOAD LOSES MOST QUIETLY. Every
     board and every wire is DERIVED on the next render, so an override that
     does not survive the trip is not an empty space on the drawing — it is the
     plate walking back to the door and the wire back to the plate the rules
     prefer, which looks exactly like the app having its own opinion rather than
     like a save being broken. That is why all nine are driven here. */
  d = docReducer(d, { type: 'BOARD_DELETED', id: 'sb-o2-facing' });
  d = docReducer(d, { type: 'BOARD_SLID', id: 'sb-o1-door', sFt: 4.25 });
  d = docReducer(d, { type: 'MAP_LIST_APPENDED', field: 'boardPoints', key: 'sb-o1-door',
    item: { id: 'bp1', kind: 'socket', amps: 16, label: '16A socket' } });
  d = docReducer(d, { type: 'LIST_ADDED', field: 'manualBoards',
    item: { id: 'sb-hand-1', roomId: 'o1', sFt: 7.5 } });
  d = docReducer(d, { type: 'BOARD_OUTLET_SET', id: 'sb-hand-1', outlet: false, born: true });
  d = docReducer(d, { type: 'MAP_ENTRY_PATCHED', field: 'boardKinds', key: 'sb-hand-1',
    patch: { amps: 16 } });
  d = docReducer(d, { type: 'MAP_ENTRY_SET', field: 'boardHeights', key: 'sb-o1-door', value: 300 });
  d = docReducer(d, { type: 'MAP_ENTRY_SET', field: 'boardOrders', key: 'sb-o1-door',
    value: ['u2', 'u1'] });
  d = docReducer(d, { type: 'FLOW_BOARD_SET', flowId: 'fl-o1-0',
    boardId: 'sb-hand-1', home: false });
  d = docReducer(d, { type: 'MAP_ENTRY_PATCHED', field: 'flowBends', key: 'fl-o1-0',
    patch: { leg0: 0.5 } });
  /* --- AND DOMAIN 6's. THE SCALE IS THE ONE THAT MATTERS MOST HERE, and it is
     the one whose loss is least visible: a plan that reopens without its door
     pick recomputes px/ft from a different reading, and every length on the
     sheet is then wrong by a constant — which still looks like a plan. The
     tracer's own fields are next: an outline that comes back without `reviewed`
     is a proposal a person corrected being offered for correction again, and a
     `dirtyIds` that does not survive puts the relight bill back up. */
  d = docReducer(d, { type: 'FIELD_SET', field: 'unitId', value: 'mm' });
  d = docReducer(d, { type: 'FIELD_SET', field: 'pdfPage', value: 3 });
  d = docReducer(d, { type: 'FIELD_SET', field: 'scaleMode', value: 'ref' });
  d = docReducer(d, { type: 'FIELD_SET', field: 'customFt', value: 0 });
  d = docReducer(d, { type: 'FIELD_SET', field: 'measure',
    value: { a: { x: 10, y: 20 }, b: { x: 210, y: 20 } } });
  d = docReducer(d, { type: 'FIELD_SET', field: 'doorPick',
    value: { id: 'd2', mm: null, rect: { x0: 1, y0: 2, x1: 9, y1: 4 } } });
  d = docReducer(d, { type: 'DOOR_WIDTH_SET', mm: 900 });
  d = docReducer(d, { type: 'FIELD_SET', field: 'projectType', value: 'hospitality' });
  d = docReducer(d, { type: 'MAP_MERGED', field: 'roomTypes',
    entries: { o1: { type: 'living', confidence: 0.82, why: 'a sofa' } } });

  d = docReducer(d, { type: 'LIST_ADDED', field: 'outlines',
    item: { id: 'ox', name: 'Study', rectify: true, detected: true, reviewed: false,
            pointsDu: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 7 }, { x: 0, y: 7 }] } });
  d = docReducer(d, { type: 'ROOM_LIT', id: 'ox' });
  d = docReducer(d, { type: 'ID_ADDED', field: 'dirtyIds', id: 'ox' });
  d = docReducer(d, { type: 'FIELD_SET', field: 'roomState',
    value: { status: 'done', count: 2, ms: 4120, meta: { model: 'rooms-v3' } } });
  d = docReducer(d, { type: 'LIST_ADDED_MANY', field: 'detections',
    items: [{ id: 'det-9', cls: 'bed', conf: 0.8, roomId: 'ox',
              rect: { x0: 1, y0: 1, x1: 5, y1: 5 } }] });
  d = docReducer(d, { type: 'ID_ADDED', field: 'dismissed', id: 'det-4' });
  d = docReducer(d, { type: 'MAP_MERGED', field: 'bedVerdicts',
    entries: { ox: { kind: 'judged', pick: 'openai', confidence: 0.7, asked: true } } });
  d = docReducer(d, { type: 'FIELD_SET', field: 'provider', value: 'roboflow' });

  d = docReducer(d, { type: 'LIST_ADDED', field: 'ceilingObjs',
    item: { id: 'f9', kind: 'fan', x: 8.2, y: 5.5, diaFt: 3.9, rot: 0 } });
  d = docReducer(d, { type: 'OBJECT_SWEEP_SET', ids: ['f9'], mm: 1200 });
  d = docReducer(d, { type: 'LIGHT_MOVED', roomId: 'ox', cellKey: 'c0', dx: 0.5, dy: -0.25 });
  d = docReducer(d, { type: 'MAP_LIST_APPENDED', field: 'renderRefs', key: 'ox',
    item: { path: 'u1/p1/renders/ox/aa-0.jpg', name: 'study.png', w: 1400, h: 788,
            bytes: 402_112, quality: 0.82, fromW: 4000, fromH: 2250,
            fromBytes: 8_411_002, at: '2026-08-31T09:12:00.000Z' } });
  d = docReducer(d, { type: 'LAYER_TOGGLED', key: 'labels' });
  d = docReducer(d, { type: 'LAYER_SET', key: 'electrical', on: true });
  d = docReducer(d, { type: 'ZOOM_SET', to: 1.4 });
  d = docReducer(d, { type: 'FIELD_SET', field: 'view', value: 'boq' });
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
  /* ...AND SO ARE DOMAIN 4's, NAMED ONE AT A TIME. The blanket `drift` check
     above would pass if a field simply round-tripped its default, so the edits
     that a person would notice missing are asserted by value. */
  ok('...and so are the accent decisions',
    got.setAccentDismissed.includes('acc-o1-1')
      && got.setManualAccents.some((z) => z.id === 'man9')
      && got.setArtDismissed.includes('we-o1-1'),
    JSON.stringify([got.setAccentDismissed, got.setArtDismissed]));
  ok('...and the hand-dragged run length, in feet',
    got.setRunTrims['rcove-we-o1-0-0'].a === 0.75
      && got.setRunsOff.includes('shelf-we-o1-2-0'),
    JSON.stringify(got.setRunTrims));
  ok('...and the door drawn by hand, with the confirmation that turns the wiring on',
    got.setDoors.some((q) => q.id === 'dh1' && q.openingPx === 14) && got.setDoorsOk === true,
    JSON.stringify(got.setDoorsOk));
  ok('...and the no-light zone', got.setZones.some((z) => z.id === 'z9'));
  ok('...and the render pass\'s reading of the second room\'s walls',
    got.setWallResults.o2?.elements?.[0]?.id === 'we-o2-0');
  /* ...AND DOMAIN 5's NINE, NAMED. Each of these is the only record that a
     plate or a wire is anywhere other than where the rules put it. */
  ok('...and the plate somebody threw away stays thrown away',
    got.setBoardsOff.includes('sb-o2-facing'), JSON.stringify(got.setBoardsOff));
  ok('...and the one they dragged stays dragged, in feet',
    got.setBoardMoves['sb-o1-door'] === 4.25,
    'plan pixels would move the day somebody corrected the scale');
  ok('...and the 16A socket they added to it is still on it',
    got.setBoardPoints['sb-o1-door']?.[0]?.amps === 16,
    JSON.stringify(got.setBoardPoints));
  ok('...and the plate they put on the wall themselves is still there',
    got.setManualBoards.some((b) => b.id === 'sb-hand-1' && b.sFt === 7.5),
    JSON.stringify(got.setManualBoards));
  /* THE RATING SURVIVES THE CONVERSION, which is the whole reason `amps` is
     stored in `boardKinds` rather than on the outlet it was set on. */
  ok('...and it comes back a switchboard, still rated 16A',
    same(got.setBoardKinds['sb-hand-1'], { outlet: false, amps: 16 }),
    JSON.stringify(got.setBoardKinds));
  ok('...and the height they set, which a plan view cannot show',
    got.setBoardHeights['sb-o1-door'] === 300);
  ok('...and the order they put the modules in',
    same(got.setBoardOrders['sb-o1-door'], ['u2', 'u1']));
  ok('...and the wire they moved to another plate, with the bend they gave it',
    got.setFlowBoards['fl-o1-0'] === 'sb-hand-1'
      && got.setFlowBends['fl-o1-0']?.leg0 === 0.5,
    JSON.stringify([got.setFlowBoards, got.setFlowBends]));

  /* ...AND DOMAIN 6's. THE SCALE FIRST, because a plan that reopens on a
     different reading of its own ruler has every length on the sheet wrong by a
     constant and still looks like a plan. */
  ok('...and the scale reopens on the same reading of the same door',
    got.setScaleMode === 'ref' && got.setCustomFt === 0
      && got.setDoorPick?.id === 'd2' && got.setDoorPick?.mm === 900
      && got.setDoorPick?.rect?.x1 === 9
      && got.setMeasure?.b?.x === 210,
    JSON.stringify([got.setScaleMode, got.setCustomFt, got.setDoorPick]));
  ok('...and the plan\'s identity: its units, its sheet and its building type',
    got.setUnitId === 'mm' && got.setPdfPage === 3
      && got.setProjectType === 'hospitality'
      && got.setRoomTypes.o1?.type === 'living');
  /* THE TRACER'S OWN. An outline back without `reviewed` is a correction a
     person made being offered for correction again; a `dirtyIds` that does not
     survive puts the relight bill back up. */
  ok('...and the space traced, lit, and marked as changed since',
    got.setOutlines.some((o) => o.id === 'ox' && o.reviewed === true)
      && got.setLitIds.includes('ox') && got.setDirtyIds.includes('ox'),
    JSON.stringify([got.setLitIds, got.setDirtyIds]));
  ok('...and where the panel and the tracer were looking',
    got.setFocusId === 'ox' && got.setSelectedOutlineId === 'ox');
  ok('...and the furniture found, the box struck out, and the bed verdict',
    got.setDetections.some((x) => x.id === 'det-9')
      && got.setDismissed.includes('det-4')
      && got.setBedVerdicts.ox?.pick === 'openai'
      && got.setProvider === 'roboflow');
  ok('...and the fan on the ceiling, at the sweep they set it to',
    got.setCeilingObjs.some((o) => o.id === 'f9' && o.diaFt !== 3.9),
    JSON.stringify(got.setCeilingObjs));
  ok('...and the lamp they dragged off its cell centre, in feet',
    same(got.setLightMoves.ox, { c0: { dx: 0.5, dy: -0.25 } }),
    JSON.stringify(got.setLightMoves));
  ok('...and the pointer to the render, at the size it was sent',
    got.setRenderRefs.ox?.[0]?.w === 1400 && got.setRenderRefs.ox?.[0]?.fromW === 4000);
  /* AND THE VIEW PREFERENCES, WHICH ARE CHEAP AND JARRING TO LOSE. The layers
     come back MERGED over the defaults, which is what `setLayers` in App's
     setter bag is for — so a layer this plan predates arrives at its default
     rather than at `undefined`. */
  ok('...and the layers it was left showing, merged over the defaults',
    got.setLayers.labels === !LAYER_DEFAULTS.labels
      && got.setLayers.electrical === true
      && got.setLayers.spots === LAYER_DEFAULTS.spots,
    JSON.stringify(got.setLayers));
  ok('...and the zoom and the tab', got.setZoom === 1.4 && got.setView === 'boq');
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

  /* --- THE SAME WALK, OVER DOMAIN 4's EDITS ------------------------------
     NOT A DUPLICATE OF THE BLOCK ABOVE. Those three edits are all sparse-map
     writes; these three are the three OTHER shapes this domain has — a
     dismissal added to a set, a hand-placed fitting appended to a list, and a
     scalar flag flipped — and each has its own bailout. A field whose case
     returned a fresh object for a no-op would show up as an extra step here,
     and a field the undo path holds back would show up as an edit that does not
     come off. */
  {
    let e0 = initialDoc();
    const h2 = newHistory(serialise(e0));
    const d4 = [
      { type: 'ID_ADDED', field: 'accentDismissed', id: 'acc-o1-0' },
      { type: 'LIST_ADDED', field: 'doors',
        item: { id: 'dh1', cls: 'door', placed: true, openingPx: 14,
                rect: { x0: 1, y0: 1, x1: 15, y1: 5 } } },
      { type: 'FIELD_SET', field: 'doorsOk', value: true },
    ];
    let e = e0;
    for (const a of d4) { e = docReducer(e, a); record(h2, serialise(e)); }
    ok('three of domain 4\'s edits are three steps',
      historyDepth(h2).past === 3, JSON.stringify(historyDepth(h2)));

    /* AND THE IDEMPOTENT ONES REPEATED ADD NO FOURTH. Dismissing a fitting
       already dismissed, confirming doors already confirmed, and zeroing a trim
       that was never set are all things a re-render or a second press can
       genuinely cause, and every one of them has to be no change — which is
       what stops a Ctrl+Z that appears to do nothing. Checked HERE, before the
       undo walk, because `record` compares against wherever the stack currently
       stands.
       THE DOOR IS NOT IN THIS LIST AND MUST NOT BE. `LIST_ADDED` is not a set:
       drawing a second door box in the same place is two doors, which is what
       somebody drawing it meant. An `addDoor` that deduped would be a tool that
       silently refuses to place a fitting. */
    let again = e;
    for (const a of [{ type: 'ID_ADDED', field: 'accentDismissed', id: 'acc-o1-0' },
                     { type: 'FIELD_SET', field: 'doorsOk', value: true },
                     { type: 'RUN_TRIM_SET', trimId: 'nope', end: 'a', ft: 0 }])
      again = docReducer(again, a);
    ok('...and repeating the idempotent ones produces no document at all',
      again === e);
    record(h2, serialise(again));
    ok('...so the stack stays at three',
      historyDepth(h2).past === 3, JSON.stringify(historyDepth(h2)));
    // ...while a second door box genuinely IS a second door.
    ok('...but a second door drawn in the same place is a second door',
      docReducer(e, d4[1]).doors.length === 2);

    let cur2 = serialise(e);
    record(h2, cur2);
    for (let i = 0; i < 3; i++) cur2 = stepBack(h2, cur2) ?? cur2;
    ok('...and three undos land on the document you started with',
      sameDoc(cur2, serialise(e0)),
      JSON.stringify({ accentDismissed: cur2.accentDismissed, doors: cur2.doors,
                       doorsOk: cur2.doorsOk }));
    ok('...and specifically, every one of them is gone',
      same(cur2.accentDismissed, []) && same(cur2.doors, []) && cur2.doorsOk === false,
      JSON.stringify([cur2.accentDismissed, cur2.doors, cur2.doorsOk]));
  }

  /* --- AND OVER DOMAIN 5's, WHERE ONE OF THE THREE IS A DELETION ----------
     THE ONE THAT IS WORTH ITS OWN WALK. Two of these edits ADD an override and
     the third one TAKES BOTH OF A WIRE'S AWAY, so the stack has to walk back
     through a step whose effect was a removal — which is where a case that
     returns state unchanged for a real deletion shows up as an undo that skips
     a gesture. */
  {
    let f0 = docReducer(initialDoc(), { type: 'FLOW_BOARD_SET', flowId: 'fl-o1-0',
      boardId: 'sb-o1-door', home: false });
    f0 = docReducer(f0, { type: 'MAP_ENTRY_PATCHED', field: 'flowBends',
      key: 'fl-o1-0', patch: { leg0: 0.5 } });
    const h3 = newHistory(serialise(f0));
    const edits5 = [
      { type: 'BOARD_SLID', id: 'sb-o1-door', sFt: 4.25 },
      { type: 'BOARD_OUTLET_SET', id: 'sb-o1-door', outlet: true, born: false },
      { type: 'FLOW_OVERRIDES_DROPPED', flowId: 'fl-o1-0' },
    ];
    let f = f0;
    for (const a of edits5) { f = docReducer(f, a); record(h3, serialise(f)); }
    ok('three electrical edits are three steps',
      historyDepth(h3).past === 3, JSON.stringify(historyDepth(h3)));
    ok('...and the third one really did take both of the wire\'s overrides',
      same(f.flowBoards, {}) && same(f.flowBends, {}));

    let cur3 = serialise(f);
    record(h3, cur3);
    for (let i = 0; i < 3; i++) cur3 = stepBack(h3, cur3) ?? cur3;
    ok('...and three undos put the wire back on the plate it was dragged to',
      sameDoc(cur3, serialise(f0)),
      JSON.stringify({ boardMoves: cur3.boardMoves, boardKinds: cur3.boardKinds,
                       flowBoards: cur3.flowBoards, flowBends: cur3.flowBends }));
    ok('...and specifically, the deletion came back as well as the two writes',
      same(cur3.boardMoves, {}) && same(cur3.boardKinds, {})
        && cur3.flowBoards['fl-o1-0'] === 'sb-o1-door'
        && cur3.flowBends['fl-o1-0']?.leg0 === 0.5,
      JSON.stringify([cur3.boardMoves, cur3.flowBoards, cur3.flowBends]));
  }

  /* --- AND THE HALF OF DOMAIN 6 THAT UNDO IS SUPPOSED TO IGNORE ----------
     THE POINT OF THIS BLOCK. Six fields are saved and NOT undoable — the
     viewport, the layer switches, the selection, the focus, the segmenter's
     status — and now that all six live in the document, a moved viewport
     produces a NEW DOCUMENT on every pan. Without `VIEW_FIELDS`, panning
     around a drawing would fill the undo stack with steps that undo nothing,
     and Ctrl+Z would step back through where you had been looking instead of
     through what you had done. This is what says that does not happen. */
  {
    let g0 = initialDoc();
    g0 = docReducer(g0, { type: 'LIST_ADDED', field: 'outlines',
      item: { id: 'o1', name: 'Living', rectify: true, detected: false, reviewed: true,
              pointsDu: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 7 }, { x: 0, y: 7 }] } });
    const h4 = newHistory(serialise(g0));

    // Three view-only changes: zoom, tab, layer. Not one of them is an edit.
    let g = docReducer(g0, { type: 'ZOOM_SET', to: 2.5 });
    record(h4, serialise(g));
    g = docReducer(g, { type: 'FIELD_SET', field: 'view', value: 'boq' });
    record(h4, serialise(g));
    g = docReducer(g, { type: 'LAYER_TOGGLED', key: 'labels' });
    record(h4, serialise(g));
    ok('moving the viewport and the tab produces no undo steps at all',
      historyDepth(h4).past === 0, JSON.stringify(historyDepth(h4)));
    /* ...AND THEY REALLY DID CHANGE THE DOCUMENT, which is the other half: the
       assertion above is only meaningful if there was something for `record` to
       decline. A reducer that had silently not written them would pass it too. */
    ok('...even though every one of them did produce a new document',
      g !== g0 && g.zoom === 2.5 && g.view === 'boq'
        && g.layers.labels === !LAYER_DEFAULTS.labels);

    // ...and the selection and the focus, which are held back for the same reason.
    g = docReducer(g, { type: 'FIELD_SET', field: 'focusId', value: 'o1' });
    record(h4, serialise(g));
    g = docReducer(g, { type: 'FIELD_SET', field: 'selectedOutlineId', value: 'o1' });
    record(h4, serialise(g));
    ok('...and neither does picking a space', historyDepth(h4).past === 0);

    /* AND A REAL EDIT ON TOP OF ALL THAT IS STILL ONE STEP. The viewport moved
       five times in between and none of it is in the stack. */
    g = docReducer(g, { type: 'ROOM_LIT', id: 'o1' });
    record(h4, serialise(g));
    ok('...but lighting the room is', historyDepth(h4).past === 1,
      JSON.stringify(historyDepth(h4)));

    /* `roomState` IS THE ONE HELD-BACK FIELD THAT STILL PUSHES A STEP, and that
       is the known, deliberately unfixed defect: the key map names `roomState`
       where the writer emits `segmentation`, so `substantive` deletes nothing.
       Pinned here as a STEP COUNT rather than only as a `sameDoc` result,
       because this is the shape a user meets it in — a dead Ctrl+Z. Fixing the
       map removes this step, which is a change in undo granularity and is the
       open question for the owner. */
    const depthBefore = historyDepth(h4).past;
    g = docReducer(g, { type: 'FIELD_SET', field: 'roomState',
      value: { status: 'done', count: 2, ms: 4120 } });
    record(h4, serialise(g));
    ok('KNOWN DEFECT: a re-segmentation still pushes a step whose undo does nothing',
      historyDepth(h4).past === depthBefore + 1,
      'if this is now equal, the roomState -> segmentation key was fixed and undo '
      + 'granularity changed — update this test deliberately');
  }
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
  /* THROUGH `WRITTEN_AS`, because five of these are nested under `scale` and
     three under `ui` — a bare `f in p` would report the whole scale block as
     unwritten and would have to be weakened to nothing to shut up. */
  const notWritten = fields.filter((f) => !isWritten(p, f));
  const notRead = fields.filter((f) => !(setterFor(f) in got));
  ok('every reducer field is written by serialiseEditor',
    notWritten.length === 0, `not written: ${notWritten.join(', ')}`);
  /* AND THE TWO KEY MAPS AGREE. `NOT_UNDOABLE_KEYS` is planState.js's own copy
     of this mapping for the six held-back fields; if a field is renamed or moved
     in one and not the other, one of the two is wrong and nothing else says so.
     `roomState` is in here too, mapped to the value planState deliberately keeps
     WRONG — see the known-defect test above. This assertion is what makes that
     wrongness a single fact rather than two. */
  {
    const disagree = Object.keys(NOT_UNDOABLE_KEYS)
      .filter((f) => f in WRITTEN_AS)
      .filter((f) => NOT_UNDOABLE_KEYS[f] !== WRITTEN_AS[f]);
    ok('the test\'s key paths agree with planState\'s own, except where pinned',
      same(disagree, ['roomState']),
      `disagree: ${disagree.map((f) => `${f}: ${NOT_UNDOABLE_KEYS[f]} vs ${WRITTEN_AS[f]}`).join('; ')}`);
  }
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
      ceilingMm: {}, materials: {}, fixtureWatts: {}, fixtureOff: {},
      manualCoves: [], manualTracks: [], manualCobs: [], manualSpots: [],
      cobArrays: [], trackFixtures: [], autoSpots: [],
      ceilingShapes: [], designPicks: {}, ceilingKinds: {}, chunkPicks: {},
      accentResults: {}, accentDismissed: [], manualAccents: [],
      surfaceResults: {}, surfaceDismissed: [], manualSurfaces: [], artDismissed: [],
      wallResults: {}, runTrims: {}, runsOff: [],
      /* `doorsOk` STARTS FALSE AND THAT IS PART OF THE SAVE CONTRACT. An absent
         key does NOT read as this default — see the grandfather clause in
         applyEditor and its own section above — so the two have to be able to
         disagree, and writing this out by hand is what keeps them independent. */
      doors: [], doorsOk: false, zones: [],
      boardsOff: [], boardMoves: {}, boardPoints: {}, flowBoards: {}, flowBends: {},
      flowLinks: {},
      manualBoards: [], boardKinds: {}, boardHeights: {}, boardOrders: {},
      unitId: null, pdfPage: null,
      scaleMode: 'door', refId: 'door900', customFt: 3,
      measure: { a: null, b: null }, doorPick: null, stated: null, ceilingFt: 10,
      projectType: null, roomTypes: {},
      outlines: [], litIds: [], dirtyIds: [], focusId: null, selectedOutlineId: null,
      /* THE SEGMENTER STARTS IDLE, AND THAT IS NOT THE SAME AS THE ABSENT KEY.
         A saved plan with no `segmentation` restores to `{ status: 'idle' }` and
         one with it restores to `done` + `restored: true` — see the exclusions
         section. Written out so the two cannot quietly become one. */
      roomState: { status: 'idle' },
      detections: [], dismissed: [], bedVerdicts: {}, provider: 'judge',
      ceilingObjs: [], lightMoves: {}, renderRefs: {},
      /* THE LAYER DEFAULTS ARE IMPORTED HERE TOO, and for the same reason they
         are imported into EMPTY_DOC: they are part of the save contract — an
         absent key reads as the default on every old plan — so a restated copy
         is a plan that reopens with a layer nobody chose. */
      layers: { ...LAYER_DEFAULTS },
      zoom: 1, view: 'spaces',
    }),
    JSON.stringify(initialDoc()));
  ok('...and it is sixty-five fields, which is the whole document',
    fields.length === 65, `${fields.length} fields`);
  /* AND THE DOCUMENT IS NOW EXACTLY WHAT THE FIXTURE DESCRIBES. While the
     migration was in progress the two could differ — a field App still held in
     `useState` was in EMPTY_DOC and not in DOC_FIELDS — and that slack is gone.
     Every field the save contract has is a field the reducer owns. */
  ok('...and the reducer owns exactly the fields the fixture describes',
    same(fields.slice().sort(), Object.keys(EMPTY_DOC).sort()),
    `only in one: ${[...fields.filter((f) => !(f in EMPTY_DOC)),
                     ...Object.keys(EMPTY_DOC).filter((f) => !fields.includes(f))].join(', ')}`);
  /* AND THE SEED REACHES EXACTLY ONE FIELD. `usePlanDoc` takes it so the kind of
     BUILDING can arrive from the project — see `initialDoc`. A seed that could
     write any field would be a second way to build a document. */
  ok('a seeded document differs from a bare one in one field only',
    same(Object.keys(initialDoc()).filter(
      (f) => !same(initialDoc({ projectType: 'hospitality' })[f], initialDoc()[f])),
      ['projectType']));
  ok('...and a seed naming a field the document does not have is ignored',
    !('nope' in initialDoc({ nope: 1 })));
  /* THE DEFAULTS ARE THE SAME OBJECT-SHAPE AS APP'S OWN `useState` CALLS, and
     EMPTY_DOC is the third statement of them. A field whose default drifts
     between the reducer and the fixture would make the round trip pass over a
     document App can never actually hold. */
  ok('...and every one of them starts where EMPTY_DOC says it does',
    fields.every((f) => same(initialDoc()[f], EMPTY_DOC[f])),
    fields.filter((f) => !same(initialDoc()[f], EMPTY_DOC[f])).join(', '));
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
    items: [{ id: 'm1', on: 'sh2' }, { id: 'm2', on: 'sh2' },
            { id: 'm3', on: 'sh9' }] });
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

section("domain 4's own rules, and the identity they have to keep");
{
  const add = (d, field, item) => docReducer(d, { type: 'LIST_ADDED', field, item });

  /* --- A PASS'S ANSWER, MERGED A ROOMFUL AT A TIME ----------------------- */
  {
    const zones = { zones: [{ id: 'acc-o1-0', kind: 'strip' }] };
    const one = docReducer(initialDoc(),
      { type: 'MAP_MERGED', field: 'accentResults', entries: { o1: zones } });
    ok('a pass answering for a room writes it', same(one.accentResults, { o1: zones }));
    /* THE EMPTY MERGE IS THE COMMON CASE AND IT MUST NOT BE A DOCUMENT. The
       accent pass writes `got` whether or not any room answered — a run where
       every space failed writes `{}` — and without the bailout that would be an
       undo step for a model call that produced nothing. */
    ok('a pass that found nothing is not a change',
      docReducer(one, { type: 'MAP_MERGED', field: 'accentResults', entries: {} }) === one);
    /* AND A RE-RUN THAT RETURNS THE IDENTICAL OBJECT IS NOT ONE EITHER. By
       reference, which is the right comparison: the reducer's own writes return
       the same nested object when nothing moved. */
    ok('merging the same answer twice is one document',
      docReducer(one, { type: 'MAP_MERGED', field: 'accentResults',
                        entries: { o1: zones } }) === one);
    const two = docReducer(one, { type: 'MAP_MERGED', field: 'accentResults',
      entries: { o2: { zones: [] } } });
    ok('...and a second room does not disturb the first',
      two !== one && two.accentResults.o1 === zones);
  }

  /* --- A RE-RUN TAKES ITS ROOMS' DISMISSALS WITH IT ---------------------- */
  {
    let d = initialDoc();
    for (const id of ['acc-o1-0', 'acc-o1-2', 'acc-o2-0'])
      d = docReducer(d, { type: 'ID_ADDED', field: 'accentDismissed', id });
    const after = docReducer(d,
      { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed', prefix: 'acc', roomIds: ['o1'] });
    /* THE IDS ARE POSITIONAL, which is the whole reason this happens: a
       dismissal left behind after a re-run strikes out whatever fitting takes
       that index next — a light somebody never rejected quietly missing. */
    ok('re-reading a room drops that room\'s dismissals',
      same(after.accentDismissed, ['acc-o2-0']), JSON.stringify(after.accentDismissed));
    ok('...and leaves the rooms that were not re-read alone',
      after.accentDismissed.includes('acc-o2-0'));
    ok('...and re-reading a room with no dismissals is not a change',
      docReducer(after, { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed',
                          prefix: 'acc', roomIds: ['o1'] }) === after);
    ok('...and re-reading no rooms at all is not a change',
      docReducer(after, { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed',
                          prefix: 'acc', roomIds: [] }) === after);
    /* THE FIELD IS ONE HALF OF THE ISOLATION AND THE PREFIX IS THE OTHER, and
       they have to be tested SEPARATELY — asserting that an accent re-run leaves
       `surfaceDismissed` alone proves only that the `field` parameter works,
       which any predicate at all would pass. */
    const surf = docReducer(
      docReducer(initialDoc(), { type: 'ID_ADDED', field: 'surfaceDismissed', id: 'surf-o1-0' }),
      { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed', prefix: 'acc', roomIds: ['o1'] });
    ok('an accent re-run writes only the field it names',
      same(surf.surfaceDismissed, ['surf-o1-0']));

    /* AND THE PREFIX ITSELF, TESTED WHERE IT ACTUALLY BITES: an id of another
       namespace sitting in the SAME list. This is what the `prefix` argument is
       for — the case is generic over both dismissal lists, so a predicate that
       matched on the room alone would work perfectly on today's ids and start
       throwing away a third pass's decisions the day one is added. That mutation
       passed a first draft of this test, which is why it is written out. */
    let mixed = initialDoc();
    for (const id of ['acc-o1-0', 'surf-o1-0', 'shelf-we-o1-0-0'])
      mixed = docReducer(mixed, { type: 'ID_ADDED', field: 'accentDismissed', id });
    const onlyAcc = docReducer(mixed,
      { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed', prefix: 'acc', roomIds: ['o1'] });
    ok('...and only the ids in the pass\'s own namespace go',
      same(onlyAcc.accentDismissed, ['surf-o1-0', 'shelf-we-o1-0-0']),
      JSON.stringify(onlyAcc.accentDismissed));

    /* AND THE MATCH IS ANCHORED AT THE START. An id that CONTAINS the head
       without beginning with it is a different id, and an unanchored search
       would take it. */
    const anchored = docReducer(
      docReducer(initialDoc(), { type: 'ID_ADDED', field: 'accentDismissed', id: 'xacc-o1-0' }),
      { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed', prefix: 'acc', roomIds: ['o1'] });
    ok('...and an id that merely contains the head is not the head',
      same(anchored.accentDismissed, ['xacc-o1-0']));
    /* AND THE ROOM BOUNDARY IS THE WHOLE ID SEGMENT, not a bare prefix match:
       `acc-o10-0` is a different room from `acc-o1-0` and a startsWith on
       `acc-o1` would take both. The trailing dash is what stops that. */
    const ten = docReducer(
      docReducer(initialDoc(), { type: 'ID_ADDED', field: 'accentDismissed', id: 'acc-o10-0' }),
      { type: 'ROOM_DISMISSALS_DROPPED', field: 'accentDismissed', prefix: 'acc', roomIds: ['o1'] });
    ok('...and room o10 is not room o1', same(ten.accentDismissed, ['acc-o10-0']));
  }

  /* --- A DERIVED RUN'S TRIM, WHICH STORES ONLY WHAT WAS CHANGED ---------- */
  {
    const t1 = docReducer(initialDoc(),
      { type: 'RUN_TRIM_SET', trimId: 'rcove-we-o1-0-0', end: 'a', ft: 0.5 });
    ok('one end nudged stores both ends',
      same(t1.runTrims, { 'rcove-we-o1-0-0': { a: 0.5, b: 0 } }), JSON.stringify(t1.runTrims));
    const t2 = docReducer(t1,
      { type: 'RUN_TRIM_SET', trimId: 'rcove-we-o1-0-0', end: 'b', ft: -1 });
    ok('...and the other end joins it rather than replacing it',
      same(t2.runTrims, { 'rcove-we-o1-0-0': { a: 0.5, b: -1 } }));
    /* THE POINTER FIRES FAR FASTER THAN THE SNAP INCREMENT CHANGES. A drag
       across one setting-out step is dozens of moves that all round to the same
       figure; without the bailout every one would be a fresh document. */
    ok('writing the figure that is already there is not a change',
      docReducer(t2, { type: 'RUN_TRIM_SET', trimId: 'rcove-we-o1-0-0',
                       end: 'a', ft: 0.5 }) === t2);
    /* BACK TO NOTHING RATHER THAN TO ZERO. A run dragged back to where the rule
       put it is a run with NO edit on it — `{a:0,b:0}` left behind would mark
       it hand-edited for ever and keep a row in every future save. */
    let z = docReducer(t2, { type: 'RUN_TRIM_SET', trimId: 'rcove-we-o1-0-0', end: 'a', ft: 0 });
    z = docReducer(z, { type: 'RUN_TRIM_SET', trimId: 'rcove-we-o1-0-0', end: 'b', ft: 0 });
    ok('a run dragged back to the rule\'s own length stores nothing',
      same(z.runTrims, {}), JSON.stringify(z.runTrims));
    const fresh = initialDoc();
    ok('...and zeroing a run that was never trimmed is not a change',
      docReducer(fresh, { type: 'RUN_TRIM_SET', trimId: 'nope', end: 'a', ft: 0 }) === fresh);
    ok('...and a trim is stored in feet, not plan pixels',
      t2.runTrims['rcove-we-o1-0-0'].b === -1,
      'plan pixels would move the day somebody corrected the scale');
  }

  /* --- THE FITTING THAT LIVES IN TWO STORES ------------------------------ */
  {
    /* THE BUG THIS CASE EXISTS TO HAVE FIXED: a strip or sconce placed BY HAND
       could not be moved at all, because the write assumed the pass's store and
       the id was not in it. Both stores are tried, and each is left untouched
       when the id is not one of its own. */
    const bump = (zone) => ({ ...zone, rect: { x0: 9, y0: 9, x1: 11, y1: 11 } });
    let d = add(initialDoc(), 'manualAccents', { id: 'man1', roomId: 'o1', rect: { x0: 1 } });
    d = docReducer(d, { type: 'MAP_MERGED', field: 'accentResults',
      entries: { o1: { zones: [{ id: 'acc-o1-0', rect: { x0: 2 } }] } } });

    const hand = docReducer(d, { type: 'ACCENT_ZONE_UPDATED', roomId: 'o1', id: 'man1', fn: bump });
    ok('a hand-placed accent can be dragged',
      hand.manualAccents[0].rect.x0 === 9, JSON.stringify(hand.manualAccents[0]));
    ok('...and the pass\'s own store is untouched by it',
      hand.accentResults === d.accentResults);

    const derived = docReducer(d,
      { type: 'ACCENT_ZONE_UPDATED', roomId: 'o1', id: 'acc-o1-0', fn: bump });
    ok('a pass-produced accent can be dragged too',
      derived.accentResults.o1.zones[0].rect.x0 === 9);
    ok('...and the hand-placed list is untouched by that',
      derived.manualAccents === d.manualAccents);

    /* THE MISS COSTS A REFERENTIAL NO-OP AND NEVER A RE-RENDER — which matters
       because the drag it serves fires on every pointermove. */
    ok('an id in neither store is not a change',
      docReducer(d, { type: 'ACCENT_ZONE_UPDATED', roomId: 'o1', id: 'nope', fn: bump }) === d);
    /* A ROOM WITH NO ACCENT PASS AT ALL was the worse half of the original bug:
       `res?.zones` is undefined and the updater bailed on its first line. */
    ok('...and so is a room the pass never ran on',
      docReducer(d, { type: 'ACCENT_ZONE_UPDATED', roomId: 'o9', id: 'man1', fn: bump })
        .manualAccents[0].rect.x0 === 9);
  }

  /* --- THE DOORS, AND THE ONE FLAG THE WIRING IS BEHIND ------------------ */
  {
    let d = add(initialDoc(), 'doors', { id: 'd1', rect: { x0: 1 }, openingPx: 8 });
    ok('a door drawn by hand is added', d.doors.length === 1);
    const moved = docReducer(d, { type: 'LIST_PATCHED', field: 'doors', id: 'd1',
      patch: { openingPx: 12 } });
    ok('...and the release of a drag patches it', moved.doors[0].openingPx === 12);
    ok('...and a release that writes the figure already there is not a change',
      docReducer(moved, { type: 'LIST_PATCHED', field: 'doors', id: 'd1',
                          patch: { openingPx: 12 } }) === moved);
    /* THE DETECTOR'S ANSWER REPLACES THE LOT, and its failure path clears —
       which must not be a document when there was nothing there to clear. */
    const empty = initialDoc();
    ok('a detector failure on an empty sheet is not a change',
      docReducer(empty, { type: 'LIST_CLEARED', field: 'doors' }) === empty);
    ok('...and on a sheet with doors, it empties them',
      same(docReducer(d, { type: 'LIST_CLEARED', field: 'doors' }).doors, []));

    /* `doorsOk` IS A DECISION AND IT IS ASKED ONCE. Confirming twice is one
       document — otherwise a re-render of the confirm button would be an undo
       step for a question nobody answered again. */
    const okd = docReducer(d, { type: 'FIELD_SET', field: 'doorsOk', value: true });
    ok('confirming the doors is a change', okd !== d && okd.doorsOk === true);
    ok('...and confirming them twice is one document',
      docReducer(okd, { type: 'FIELD_SET', field: 'doorsOk', value: true }) === okd);
    ok('...and it does not disturb the door list', okd.doors === d.doors);
    /* FALSE IS A REAL VALUE HERE, which is why the flag is `??`-guarded on read
       and not truthiness-guarded. See the grandfather clause. */
    ok('and taking the confirmation back is a change',
      docReducer(okd, { type: 'FIELD_SET', field: 'doorsOk', value: false }) !== okd);
    ok('setting an unknown field is refused',
      docReducer(d, { type: 'FIELD_SET', field: 'nope', value: 1 }) === d);
  }
}

section("domain 5's own rules: two stores, and the way back out of an override");
{
  const hand = { id: 'sb-hand-1', roomId: 'o1', sFt: 4.25 };
  const withHand = docReducer(initialDoc(),
    { type: 'LIST_ADDED', field: 'manualBoards', item: hand });

  /* --- A PLATE SLID, AND THE WRITE FOLLOWS THE PLATE --------------------- */
  {
    /* THE RULE'S BOARD GETS AN OVERRIDE. `boardMoves` exists so a DERIVED board
       can be somewhere the rule did not put it. */
    const ruled = docReducer(withHand, { type: 'BOARD_SLID', id: 'sb-o1-door', sFt: 6 });
    ok('sliding a rule\'s plate writes an override',
      ruled.boardMoves['sb-o1-door'] === 6, JSON.stringify(ruled.boardMoves));
    ok('...and leaves the hand-placed list alone', ruled.manualBoards === withHand.manualBoards);

    /* A HAND-PLACED PLATE HAS ONE POSITION AND IT IS ITS OWN. Writing a move
       for one would be storing "moved from" a position that was itself a hand
       position — two records of one fact, and a plate that could be reset to a
       place nobody ever chose. */
    const own = docReducer(withHand, { type: 'BOARD_SLID', id: 'sb-hand-1', sFt: 9 });
    ok('sliding a hand-placed plate moves the plate itself',
      own.manualBoards[0].sFt === 9);
    ok('...and writes no override for it',
      same(own.boardMoves, {}), JSON.stringify(own.boardMoves));

    /* THE POINTER FIRES FAR FASTER THAN THE PLATE MOVES A MEASURABLE AMOUNT,
       and both stores have to bail — this is a per-frame path in both. */
    ok('sliding to where it already is, is not a change (rule\'s plate)',
      docReducer(ruled, { type: 'BOARD_SLID', id: 'sb-o1-door', sFt: 6 }) === ruled);
    ok('...and not a change for a hand-placed one either',
      docReducer(own, { type: 'BOARD_SLID', id: 'sb-hand-1', sFt: 9 }) === own);

    /* AND THE WAY BACK IS TO NOTHING RATHER THAN TO THE RULE'S OWN NUMBER. A
       board with no entry is a board the rules own; one carrying its rule
       position as a hand position would be marked "moved by hand" for ever and
       would stop following the door it was placed off. */
    const back = docReducer(ruled, { type: 'MAP_ENTRY_REMOVED', field: 'boardMoves', key: 'sb-o1-door' });
    ok('putting a plate back deletes the entry rather than storing a number',
      same(back.boardMoves, {}), JSON.stringify(back.boardMoves));
    ok('...and putting back one that was never moved is not a change',
      docReducer(back, { type: 'MAP_ENTRY_REMOVED', field: 'boardMoves',
                         key: 'sb-o1-door' }) === back);
  }

  /* --- A PLATE DELETED, WHICH IS TWO VERBS ------------------------------- */
  {
    const ruled = docReducer(withHand, { type: 'BOARD_DELETED', id: 'sb-o1-door' });
    ok('deleting a rule\'s plate is a dismissal that persists',
      same(ruled.boardsOff, ['sb-o1-door']), JSON.stringify(ruled.boardsOff));
    ok('...and dismissing the same plate twice is one document',
      docReducer(ruled, { type: 'BOARD_DELETED', id: 'sb-o1-door' }) === ruled);

    const own = docReducer(withHand, { type: 'BOARD_DELETED', id: 'sb-hand-1' });
    /* A HAND-PLACED BOARD HAS NO RULE TO COME BACK FROM, so dismissing one
       would leave an id in `boardsOff` for the life of the plan, suppressing
       something that no longer exists. */
    ok('deleting a hand-placed plate removes it', same(own.manualBoards, []));
    ok('...and files no dismissal for it', same(own.boardsOff, []),
      JSON.stringify(own.boardsOff));
    /* DELETING IT A SECOND TIME FILES A STRAY DISMISSAL, and that is the
       `useState` behaviour this case reproduces exactly rather than an
       improvement it declined to make: once the plate is out of
       `manualBoards` there is nothing left to tell the two verbs apart, so the
       second call takes the derived branch.
       UNREACHABLE FROM THE UI — a plate that has been deleted cannot be
       selected or have its chip pressed again — and pinned here so that the day
       somebody makes it reachable, this test says what happens. */
    ok('KNOWN: deleting an already-removed hand plate falls to the dismissal branch',
      same(docReducer(own, { type: 'BOARD_DELETED', id: 'sb-hand-1' }).boardsOff,
           ['sb-hand-1']),
      'if this changed, the two-verb split now needs to remember what it removed');
  }

  /* --- OUTLET OR SWITCHBOARD, AND WHAT THE PLATE WAS BORN AS ------------- */
  {
    /* A RULE-PLACED PLATE IS BORN A BOARD. Making it an outlet is a change and
       is stored; making it a board again matches what it was born as and must
       DELETE the entry rather than write `outlet: false` — an entry restating
       the default is a plate marked "changed by hand" for ever, and one that
       would stop following its own default if that default ever moved. */
    const out = docReducer(initialDoc(),
      { type: 'BOARD_OUTLET_SET', id: 'sb-o1-door', outlet: true, born: false });
    ok('making a rule\'s board an outlet is stored',
      same(out.boardKinds, { 'sb-o1-door': { outlet: true } }), JSON.stringify(out.boardKinds));
    const back = docReducer(out,
      { type: 'BOARD_OUTLET_SET', id: 'sb-o1-door', outlet: false, born: false });
    ok('...and setting it back to what it was born as stores nothing',
      same(back.boardKinds, {}), JSON.stringify(back.boardKinds));
    ok('...and doing that to a plate with no entry is not a change',
      docReducer(back, { type: 'BOARD_OUTLET_SET', id: 'sb-o1-door',
                         outlet: false, born: false }) === back);
    ok('...and setting the flag it already carries is not a change',
      docReducer(out, { type: 'BOARD_OUTLET_SET', id: 'sb-o1-door',
                        outlet: true, born: false }) === out);

    /* THE MIRROR IMAGE: a HAND-PLACED plate is born an outlet, so it is
       `outlet: false` that is the change and `outlet: true` that deletes. */
    const handBoard = docReducer(initialDoc(),
      { type: 'BOARD_OUTLET_SET', id: 'sb-hand-1', outlet: false, born: true });
    ok('making a hand-placed outlet into a board is stored',
      same(handBoard.boardKinds, { 'sb-hand-1': { outlet: false } }));
    ok('...and back again stores nothing',
      same(docReducer(handBoard, { type: 'BOARD_OUTLET_SET', id: 'sb-hand-1',
                                   outlet: true, born: true }).boardKinds, {}));

    /* THE RATING SURVIVES THE CONVERSION, and it is the reason `amps` lives in
       this map rather than on `manualBoards`: a 16A outlet ticked into a
       switchboard is a board with a 16A socket on it. So an entry carrying a
       rating is NOT deleted even when the flag goes back to the default. */
    const rated = docReducer(handBoard,
      { type: 'MAP_ENTRY_PATCHED', field: 'boardKinds', key: 'sb-hand-1', patch: { amps: 16 } });
    ok('re-rating a socket keeps the outlet flag beside it',
      same(rated.boardKinds['sb-hand-1'], { outlet: false, amps: 16 }),
      JSON.stringify(rated.boardKinds));
    const stillRated = docReducer(rated,
      { type: 'BOARD_OUTLET_SET', id: 'sb-hand-1', outlet: true, born: true });
    ok('...and a rated plate is not deleted when its flag goes back to default',
      stillRated.boardKinds['sb-hand-1']?.amps === 16,
      JSON.stringify(stillRated.boardKinds));
    ok('...and re-rating to the figure it already has is not a change',
      docReducer(rated, { type: 'MAP_ENTRY_PATCHED', field: 'boardKinds',
                          key: 'sb-hand-1', patch: { amps: 16 } }) === rated);
  }

  /* --- WHAT SOMEBODY PUT ON A PLATE ------------------------------------- */
  {
    let d = initialDoc();
    for (const id of ['bp1', 'bp2'])
      d = docReducer(d, { type: 'MAP_LIST_APPENDED', field: 'boardPoints', key: 'sb-o1-door',
        item: { id, kind: 'socket', amps: 16, label: '16A socket' } });
    /* TWO 16A SOCKETS ON ONE PLATE IS AN ORDINARY THING TO WANT, and they have
       to be removable one at a time — which `socket:16` used as a key cannot
       express. This is why the point carries its own id. */
    ok('two identical points on one plate are two points', d.boardPoints['sb-o1-door'].length === 2);
    const one = docReducer(d,
      { type: 'MAP_LIST_REMOVED', field: 'boardPoints', key: 'sb-o1-door', id: 'bp1' });
    ok('...and one can be removed without the other',
      same(one.boardPoints['sb-o1-door'].map((e) => e.id), ['bp2']));
    ok('...and removing one that is not there is not a change',
      docReducer(one, { type: 'MAP_LIST_REMOVED', field: 'boardPoints',
                        key: 'sb-o1-door', id: 'bp9' }) === one);
    /* REMOVING FROM A PLATE THAT HAS NO POINTS WRITES AN EMPTY ENTRY FOR IT.
       Again the `useState` behaviour reproduced rather than tidied: an absent
       key and an empty array are not the same document, so this is not a case
       the no-op rule covers. Unreachable from the UI — the chip that removes a
       point only exists where there is a point — and pinned so the choice is
       visible rather than accidental. */
    ok('KNOWN: removing from a plate with no points writes it an empty entry',
      same(docReducer(one, { type: 'MAP_LIST_REMOVED', field: 'boardPoints',
                             key: 'sb-o9-door', id: 'bp1' }).boardPoints,
           { 'sb-o1-door': [{ id: 'bp2', kind: 'socket', amps: 16, label: '16A socket' }],
             'sb-o9-door': [] }));
    /* THE KEY IS LEFT IN PLACE WHEN THE LAST POINT GOES. An empty array is what
       the `useState` updater this replaced wrote, and changing it to a delete
       would change what a saved plan holds. */
    const none = docReducer(one,
      { type: 'MAP_LIST_REMOVED', field: 'boardPoints', key: 'sb-o1-door', id: 'bp2' });
    ok('stripping a plate back to nothing leaves the key, not the points',
      same(none.boardPoints, { 'sb-o1-door': [] }), JSON.stringify(none.boardPoints));
  }

  /* --- THE TWO THINGS A PERSON DECIDES ABOUT A WIRE --------------------- */
  {
    const on = docReducer(initialDoc(),
      { type: 'FLOW_BOARD_SET', flowId: 'fl-o1-0', boardId: 'sb-o1-door', home: false });
    ok('a wire dropped on a plate is assigned to it',
      on.flowBoards['fl-o1-0'] === 'sb-o1-door');
    ok('...and dropped on the same plate again is one document',
      docReducer(on, { type: 'FLOW_BOARD_SET', flowId: 'fl-o1-0',
                       boardId: 'sb-o1-door', home: false }) === on);
    /* A DROP ON THE PLATE IT WAS ALREADY ON CLEARS THE OVERRIDE rather than
       storing it, which is the way back: dragging a wire home puts it under the
       rules instead of pinning it to the answer the rules give today. */
    const home = docReducer(on,
      { type: 'FLOW_BOARD_SET', flowId: 'fl-o1-0', boardId: 'sb-o1-door', home: true });
    ok('dragging a wire home clears the override rather than storing it',
      same(home.flowBoards, {}), JSON.stringify(home.flowBoards));
    ok('...and dragging home a wire that was never reassigned is not a change',
      docReducer(home, { type: 'FLOW_BOARD_SET', flowId: 'fl-o1-0',
                         boardId: 'sb-o1-door', home: true }) === home);

    /* ONE LEG'S ARC, AND THE OTHERS STAY WHERE THEY ARE. `flowBends` is a leg
       key -> feet inside one entry, so nudging one leg must not straighten the
       other three. */
    let b = docReducer(on, { type: 'MAP_ENTRY_PATCHED', field: 'flowBends',
      key: 'fl-o1-0', patch: { leg0: 0.5 } });
    b = docReducer(b, { type: 'MAP_ENTRY_PATCHED', field: 'flowBends',
      key: 'fl-o1-0', patch: { leg1: -0.75 } });
    ok('nudging one leg leaves the others alone',
      same(b.flowBends['fl-o1-0'], { leg0: 0.5, leg1: -0.75 }),
      JSON.stringify(b.flowBends));
    ok('...and re-writing the bend it already has is not a change',
      docReducer(b, { type: 'MAP_ENTRY_PATCHED', field: 'flowBends',
                      key: 'fl-o1-0', patch: { leg0: 0.5 } }) === b);

    /* DELETE ON A WIRE MEANS "UNDO WHAT I DID TO IT" — and it takes BOTH
       overrides, because putting a wire back under the rules is one act and
       half of it is not a state anybody asked for. */
    const clean = docReducer(b, { type: 'FLOW_OVERRIDES_DROPPED', flowId: 'fl-o1-0' });
    ok('Delete on a wire takes the plate and the bends together',
      same(clean.flowBoards, {}) && same(clean.flowBends, {}),
      JSON.stringify([clean.flowBoards, clean.flowBends]));
    ok('...and does it in one document',
      clean !== b && docReducer(clean, { type: 'FLOW_OVERRIDES_DROPPED',
                                         flowId: 'fl-o1-0' }) === clean);
    /* AND IT LEAVES OTHER WIRES ALONE. One act on one wire. */
    let two = docReducer(b, { type: 'FLOW_BOARD_SET', flowId: 'fl-o2-0',
      boardId: 'sb-o2-door', home: false });
    two = docReducer(two, { type: 'FLOW_OVERRIDES_DROPPED', flowId: 'fl-o1-0' });
    ok('...and does not reach another wire\'s override',
      two.flowBoards['fl-o2-0'] === 'sb-o2-door', JSON.stringify(two.flowBoards));
    /* AND HALF AN OVERRIDE IS STILL DROPPED IN ONE GO — a wire that was bent
       but never reassigned, which is the common case. */
    const bentOnly = docReducer(
      docReducer(initialDoc(), { type: 'MAP_ENTRY_PATCHED', field: 'flowBends',
        key: 'fl-o3-0', patch: { leg0: 1 } }),
      { type: 'FLOW_OVERRIDES_DROPPED', flowId: 'fl-o3-0' });
    ok('...and a wire that was only bent still comes clean',
      same(bentOnly.flowBends, {}), JSON.stringify(bentOnly.flowBends));
  }
}

section("domain 6a: the scale's two-part act, and the guards around it");
{
  /* --- THE DOOR AND ITS WIDTH ------------------------------------------- */
  {
    const picked = docReducer(initialDoc(), { type: 'FIELD_SET', field: 'doorPick',
      value: { id: 'd2', mm: null, rect: { x0: 1, y0: 2, x1: 9, y1: 4 } } });
    const wide = docReducer(picked, { type: 'DOOR_WIDTH_SET', mm: 900 });
    /* THE WIDTH PATCHES AND DOES NOT REPLACE. THE RECT RIDES ALONG WITH THE ID
       — the door boxes are editable from the electrical step, so the scale is
       anchored to the box that was MEASURED rather than looked up in a list that
       can change under it. A width written over the whole pick would lose it. */
    ok('setting the ruler\'s width keeps the id and the rect it was measured on',
      wide.doorPick.id === 'd2' && wide.doorPick.mm === 900
        && wide.doorPick.rect.x1 === 9, JSON.stringify(wide.doorPick));
    ok('...and setting the same width twice is one document',
      docReducer(wide, { type: 'DOOR_WIDTH_SET', mm: 900 }) === wide);
    /* NOTHING TO WIDEN IF NOTHING IS PICKED. The width control only exists
       under a chosen door, so this is the unreachable branch made explicit
       rather than a silent write of `{ mm }` with no id on it. */
    const bare = initialDoc();
    ok('...and a width with no door picked writes nothing at all',
      docReducer(bare, { type: 'DOOR_WIDTH_SET', mm: 900 }) === bare);
    ok('un-picking the door clears the whole pick',
      docReducer(wide, { type: 'FIELD_SET', field: 'doorPick', value: null }).doorPick === null);
  }

  /* --- THE SCALE'S OWN FIELDS, AND THE GUARDS THEY ARE READ BEHIND ------ */
  {
    /* `customFt` AND `ceilingFt` ARE `!= null`-GUARDED, WHICH IS WHY 0 IS SAFE
       FOR THEM AND NOT FOR THE OTHERS. Asserted rather than assumed: it is the
       difference between a reference length of zero round-tripping and coming
       back as 3. */
    const zero = docReducer(initialDoc(), { type: 'FIELD_SET', field: 'customFt', value: 0 });
    const { got, set } = recorder();
    applyEditor(serialiseEditor({ ...EMPTY_DOC, ...zero }, { pxPerFt: 18.5 }), set);
    ok('a reference length of zero survives the trip',
      got.setCustomFt === 0, String(got.setCustomFt));

    /* ...AND THE TRUTHINESS-GUARDED ONES WOULD NOT, which is the shape the
       guards have always had and is preserved deliberately. This asserts the
       LOSS so that a guard changed to `??` shows up here as a deliberate
       decision rather than as a passing test nobody looked at. */
    const emptyMode = recorder();
    applyEditor(serialiseEditor({ ...EMPTY_DOC, scaleMode: '' }, { pxPerFt: 1 }), emptyMode.set);
    ok('KNOWN: a falsy scale mode is not restored, because the guard is truthiness',
      emptyMode.got.setScaleMode === undefined,
      'if this now restores, the guard changed — update TRUTHY_GUARDED and say why');
    ok('...and the guarded list is still exactly the seven documented fields',
      same([...TRUTHY_GUARDED].sort(),
           ['layers', 'measure', 'provider', 'refId', 'scaleMode', 'view', 'zoom']),
      TRUTHY_GUARDED.join(', '));

    /* THE SCALE IS WRITTEN NESTED AND THE FIVE FIELDS ARE FLAT IN THE DOCUMENT,
       which is the asymmetry `WRITTEN_AS` exists for. Asserted directly so the
       map is not the only thing that believes it. */
    const p = serialiseEditor({ ...EMPTY_DOC, scaleMode: 'ref', refId: 'custom' },
      { pxPerFt: 18.5 });
    ok('the five scale settings are nested under `scale` in the saved object',
      p.scale.mode === 'ref' && p.scale.refId === 'custom' && !('scaleMode' in p),
      Object.keys(p).filter((k) => k.toLowerCase().includes('scale')).join(', '));
    ok('...and `writtenValue` finds them there',
      writtenValue(p, 'scaleMode') === 'ref' && writtenValue(p, 'refId') === 'custom');
    /* AND `pxPerFt` IS STILL NOT ONE OF THEM. It rides in the same block as
       `pxPerFtAtSave` and is the serialiser's second ARGUMENT — see the
       exclusions section. This is the third place that has to stay true. */
    ok('...and the scale block\'s one derived value is still write-only',
      p.scale.pxPerFtAtSave === 18.5 && !('pxPerFt' in EMPTY_DOC));
  }

  /* --- WHAT KIND OF BUILDING, THROUGH ITS ALIAS ------------------------- */
  {
    const kind = docReducer(initialDoc(),
      { type: 'FIELD_SET', field: 'projectType', value: 'hospitality' });
    ok('the document calls it projectType', kind.projectType === 'hospitality');
    const { got, set } = recorder();
    applyEditor(serialiseEditor({ ...EMPTY_DOC, ...kind }, { pxPerFt: 1 }), set);
    ok('...and it comes back through the setter of that name',
      got.setProjectType === 'hospitality', got.setProjectType);
    /* AND `setProjectId` IS NOT A NAME ON THE RESTORE PATH ANY MORE. The alias
       used to be a hand-written line in App's setter bag; it is a destructuring
       rename now, and the bag is generated. */
    ok('...and nothing on the restore path is called setProjectId',
      !('setProjectId' in got), Object.keys(got).filter((k) => k.includes('Project')).join(', '));
    ok('...and setting the same kind twice is one document',
      docReducer(kind, { type: 'FIELD_SET', field: 'projectType',
                         value: 'hospitality' }) === kind);
  }

  /* --- THE ROOM TYPES MERGE RATHER THAN REPLACE ------------------------- */
  {
    let d = docReducer(initialDoc(), { type: 'MAP_MERGED', field: 'roomTypes',
      entries: { o1: { type: 'living' }, o2: { type: 'bedroom' } } });
    /* `setRoomTypes(found)` REPLACED THE MAP, which is invisible on a full run
       and wipes eight rooms' types on a partial one. This is the regression that
       shape was changed to fix — see the note at `runPipeline` in App.jsx. */
    d = docReducer(d, { type: 'MAP_MERGED', field: 'roomTypes',
      entries: { o3: { type: 'kitchen' } } });
    ok('re-classifying one space keeps the answers for the others',
      same(Object.keys(d.roomTypes).sort(), ['o1', 'o2', 'o3']),
      JSON.stringify(Object.keys(d.roomTypes)));
    ok('...and a classify run that answered for nobody is not a change',
      docReducer(d, { type: 'MAP_MERGED', field: 'roomTypes', entries: {} }) === d);
  }
}

section("domain 6b: the acts that touch several fields at once");
{
  const outline = (id, detected, reviewed) => ({
    id, name: `Room ${id}`, rectify: true, detected, reviewed,
    pointsDu: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }],
  });
  const withThree = () => {
    let d = initialDoc();
    for (const o of [outline('o1', false, true), outline('o2', true, false),
                     outline('o3', true, true)])
      d = docReducer(d, { type: 'LIST_ADDED', field: 'outlines', item: o });
    return d;
  };

  /* --- A SPACE DELETED, AND EVERYTHING THAT REFERRED TO IT -------------- */
  {
    let d = docReducer(withThree(), { type: 'PLAN_LIT' });
    d = docReducer(d, { type: 'ID_ADDED', field: 'dirtyIds', id: 'o2' });
    d = docReducer(d, { type: 'ID_ADDED', field: 'dirtyIds', id: 'o3' });
    d = docReducer(d, { type: 'FIELD_SET', field: 'selectedOutlineId', value: 'o2' });
    d = docReducer(d, { type: 'FIELD_SET', field: 'focusId', value: 'o2' });

    const gone = docReducer(d, { type: 'OUTLINE_DELETED', id: 'o2' });
    ok('deleting a space takes the outline', same(gone.outlines.map((o) => o.id), ['o1', 'o3']));
    ok('...and its place in the lit list', same(gone.litIds, ['o1', 'o3']),
      JSON.stringify(gone.litIds));
    /* A SPACE THAT IS GONE IS NOT A SPACE THAT CHANGED. Left in, its id would
       sit in the dirty list for ever and the tracer would offer a relight of a
       room that no longer exists. */
    ok('...and its place in the dirty list', same(gone.dirtyIds, ['o3']),
      JSON.stringify(gone.dirtyIds));
    ok('...and the selection and the focus that were on it',
      gone.selectedOutlineId === null && gone.focusId === null);

    /* ...AND ONLY IF THEY WERE THIS ONE. Deleting room 3 must not drop the
       panel off room 1, which is the whole reason those two writes are
       conditional rather than unconditional clears. */
    const other = docReducer(d, { type: 'OUTLINE_DELETED', id: 'o3' });
    ok('deleting a different space leaves the selection and focus alone',
      other.selectedOutlineId === 'o2' && other.focusId === 'o2');
    ok('...and is one document, not five',
      other.outlines !== d.outlines && other.selectedOutlineId === d.selectedOutlineId);
    ok('deleting a space that is not there is not a change',
      docReducer(d, { type: 'OUTLINE_DELETED', id: 'nope' }) === d);
  }

  /* --- THE CORNERS, AND THE EDIT THAT IS REFUSED ------------------------ */
  {
    const d = withThree();
    const moved = docReducer(d, { type: 'OUTLINE_POINTS_EDITED', id: 'o2',
      edit: (pts) => pts.map((q, i) => (i === 0 ? { x: 5, y: 5 } : q)) });
    ok('a corner moves', moved.outlines[1].pointsDu[0].x === 5);
    /* TOUCHING AN OUTLINE MARKS IT REVIEWED, which is the only thing that
       distinguishes a proposal somebody has looked at from one nobody has: the
       dashed line goes solid because the corner is now where a person put it. */
    ok('...and marks the outline reviewed', moved.outlines[1].reviewed === true);
    ok('...and leaves its neighbours alone by identity',
      moved.outlines[0] === d.outlines[0] && moved.outlines[2] === d.outlines[2]);
    /* TWO POINTS ARE NOT A ROOM. `removePoint` relies on this refusal rather
       than checking the length itself, so a polygon can never be stored below
       three points. */
    ok('an edit that returns fewer than three points is refused',
      docReducer(d, { type: 'OUTLINE_POINTS_EDITED', id: 'o2',
                      edit: (pts) => pts.slice(0, 2) }) === d);
    ok('...and one that returns nothing at all is refused',
      docReducer(d, { type: 'OUTLINE_POINTS_EDITED', id: 'o2', edit: () => null }) === d);
    ok('...and editing an outline that is not there is not a change',
      docReducer(d, { type: 'OUTLINE_POINTS_EDITED', id: 'nope',
                      edit: (pts) => pts }) === d);
  }

  /* --- THE THREE LIGHTING ACTS, WHICH DIFFER IN WAYS THAT MATTER -------- */
  {
    const d = withThree();

    const all = docReducer(d, { type: 'PLAN_LIT' });
    ok('lighting the whole plan lights every space',
      same(all.litIds, ['o1', 'o2', 'o3']), JSON.stringify(all.litIds));
    ok('...and marks them all reviewed', all.outlines.every((o) => o.reviewed));
    /* NOTHING IS SELECTED TO BEGIN WITH. `focusId` used to be seeded with the
       first outline — harmless while it only decided which room the panel
       described, and a blue outline on the canvas once it drew one. A space
       highlighted because it happens to be first is a selection nobody made. */
    ok('...and selects nothing', all.focusId === null);
    ok('...and doing it twice is one document',
      docReducer(all, { type: 'PLAN_LIT' }) === all);
    /* THE LIT LIST IS READ OFF THE DOCUMENT'S OWN OUTLINES. A space traced
       between the render that queued this and the reducer running it is lit
       too, which is what a caller passing `outlines.map(o => o.id)` would miss. */
    const plusOne = docReducer(
      docReducer(d, { type: 'LIST_ADDED', field: 'outlines', item: outline('o4', false, true) }),
      { type: 'PLAN_LIT' });
    ok('...and it lights a space added since the act was queued',
      plusOne.litIds.includes('o4'), JSON.stringify(plusOne.litIds));

    const one = docReducer(d, { type: 'ROOM_LIT', id: 'o2' });
    /* AN ASSIGNMENT AND NOT A UNION: "light this room and nothing else" is what
       the button on a single space says. */
    ok('lighting one room lights only that room', same(one.litIds, ['o2']));
    ok('...and marks only it reviewed',
      one.outlines[1].reviewed === true && one.outlines[0] === d.outlines[0]);
    /* AND IT IS THE ONE LIGHTING ACT THAT SELECTS WHAT IT LIT, because a person
       who asked for one room is looking at that room. */
    ok('...and does select it', one.focusId === 'o2' && one.selectedOutlineId === 'o2');
    ok('...and doing it twice is one document',
      docReducer(one, { type: 'ROOM_LIT', id: 'o2' }) === one);

    /* A UNION, NOT AN ASSIGNMENT. On a partial relight the spaces that were
       already lit have to STAY lit — assigning the subset would blank the rest
       of the sheet, which is the regression the partial run exists to avoid. */
    const partial = docReducer(one, { type: 'RELIT', ids: ['o3'] });
    ok('a partial relight keeps the spaces that were already lit',
      same(partial.litIds.slice().sort(), ['o2', 'o3']), JSON.stringify(partial.litIds));
    ok('...and drops the focus, unlike lighting one room',
      partial.focusId === null);
    ok('...and relighting the same subset again is one document',
      docReducer(partial, { type: 'RELIT', ids: ['o3'] }) === partial);
    const full = docReducer(one, { type: 'RELIT', ids: null });
    ok('a full relight lights the sheet', same(full.litIds, ['o1', 'o2', 'o3']));
    ok('...and marks every space reviewed', full.outlines.every((o) => o.reviewed));

    /* AND CLEARING THE DIRTY LIST IS A SEPARATE ACT, seconds later. Folding it
       into RELIT would clear the flag of a space that was moved WHILE the run
       was going, which is exactly the space that is still owed a relight. */
    let dirty = docReducer(one, { type: 'ID_ADDED', field: 'dirtyIds', id: 'o1' });
    dirty = docReducer(dirty, { type: 'ID_ADDED', field: 'dirtyIds', id: 'o3' });
    ok('a relight does not clear the dirty list by itself',
      same(docReducer(dirty, { type: 'RELIT', ids: ['o3'] }).dirtyIds, ['o1', 'o3']));
    ok('...and a partial clear takes only the ids the run was given',
      same(docReducer(dirty, { type: 'DIRTY_CLEARED', ids: ['o3'] }).dirtyIds, ['o1']));
    ok('...and a full clear takes the lot',
      same(docReducer(dirty, { type: 'DIRTY_CLEARED', ids: null }).dirtyIds, []));
    const clean = docReducer(dirty, { type: 'DIRTY_CLEARED', ids: null });
    ok('...and clearing an already-empty dirty list is not a change',
      docReducer(clean, { type: 'DIRTY_CLEARED', ids: null }) === clean);
    ok('...and clearing ids that are not in it is not a change',
      docReducer(clean, { type: 'DIRTY_CLEARED', ids: ['o9'] }) === clean);
  }

  /* --- THE SEGMENTER'S MERGE, WHICH IS THE ONE THAT LOSES WORK IF WRONG - */
  {
    const d = withThree();
    /* MERGE, NEVER REPLACE, and the rule is about WORK rather than provenance:
       anything the user has TOUCHED survives, whether they drew it or dragged a
       corner of it. Only untouched proposals go, because they are the same
       answer to the same question and keeping both would double every room.
       THIS MATTERS MORE THAN IT LOOKS: the effect re-runs whenever the plan
       source changes, and correcting a DXF's unit interpretation on the tracer
       screen changes it — so without this, choosing the right units after
       nudging four rooms would silently throw the nudges away. */
    const merge = (os) => {
      const kept = os.filter((o) => !o.detected || o.reviewed);
      const made = [outline('p1', true, false)];
      return { outlines: [...kept, ...made],
               roomState: { status: 'done', ms: 4120, proposed: made.length,
                            returned: 3, dropped: 1, meta: { model: 'rooms-v3' } } };
    };
    const after = docReducer(d, { type: 'ROOMS_PROPOSED', merge });
    ok('a hand-traced outline survives a re-run',
      after.outlines.some((o) => o.id === 'o1'));
    ok('...and so does a proposal somebody corrected',
      after.outlines.some((o) => o.id === 'o3'));
    ok('...and an untouched proposal does not',
      !after.outlines.some((o) => o.id === 'o2'),
      JSON.stringify(after.outlines.map((o) => o.id)));
    /* THE COUNT COMES BACK THROUGH THE RETURN VALUE AND NOT OUT THROUGH A
       CLOSURE. It used to be a `let` assigned from inside a `setState` updater,
       which a reducer may not do — React is free to invoke it twice. And it is
       what was ADDED, not what came back: a proposal that landed on a room the
       user had already corrected was dropped, and reporting it as found would
       have somebody looking for an outline that is not there. */
    ok('...and the status reports what was added, not what was returned',
      after.roomState.proposed === 1 && after.roomState.returned === 3,
      JSON.stringify(after.roomState));
    ok('...and both fields land in one document',
      after.outlines !== d.outlines && after.roomState !== d.roomState);
    /* AND THE MERGE IS PURE, WHICH IS THE CONDITION FOR CARRYING IT IN AN
       ACTION AT ALL: running it twice on the same state gives the same answer,
       because React will. */
    const twice = docReducer(d, { type: 'ROOMS_PROPOSED', merge });
    ok('...and running the merge twice on one state gives the same answer',
      same(twice.outlines, after.outlines) && same(twice.roomState, after.roomState));
  }

  /* --- THE DETECTORS: REPLACE, APPEND, AND THE DISMISSAL THAT CANNOT SURVIVE */
  {
    const found = [{ id: 'det-0', cls: 'bed', rect: { x0: 1, y0: 1, x1: 5, y1: 5 } }];
    let d = docReducer(initialDoc(), { type: 'LIST_REPLACED', field: 'detections', next: found });
    ok('the sheet detector replaces the lot', same(d.detections, found));
    /* ...AND THE ADMIN'S "LOOK AGAIN" APPENDS, because it re-reads a few rooms
       and the boxes on the rest of the sheet have to stay. */
    d = docReducer(d, { type: 'LIST_ADDED_MANY', field: 'detections',
      items: [{ id: 'det-9', cls: 'bed', rect: { x0: 9, y0: 9, x1: 12, y1: 12 } }] });
    ok('...and a re-read of one room adds to it',
      same(d.detections.map((x) => x.id), ['det-0', 'det-9']));
    ok('...and a re-read that found nothing is not a change',
      docReducer(d, { type: 'LIST_ADDED_MANY', field: 'detections', items: [] }) === d);

    /* THE BED CONTEST'S VERDICTS ARE WRITTEN THREE WAYS and each one is a
       different act: replaced wholesale by the full pass, MERGED by the admin's
       re-read, and cleared by the plain detectors that have no contest to hold. */
    const set = docReducer(d, { type: 'FIELD_SET', field: 'bedVerdicts',
      value: { o1: { kind: 'judged' }, o2: { kind: 'none' } } });
    const merged = docReducer(set, { type: 'MAP_MERGED', field: 'bedVerdicts',
      entries: { o2: { kind: 'one-sided', refound: true } } });
    ok('re-reading one room\'s beds keeps the other rooms\' verdicts',
      merged.bedVerdicts.o1.kind === 'judged' && merged.bedVerdicts.o2.refound === true,
      JSON.stringify(merged.bedVerdicts));
    ok('...and clearing them empties the map',
      same(docReducer(merged, { type: 'MAP_CLEARED', field: 'bedVerdicts' }).bedVerdicts, {}));

    /* A DISMISSAL CANNOT SURVIVE A JUDGED RUN. The ids it holds are the merged
       set's (`det-3-...`); the judged list's are the winning detector's
       (`det-rf-0-...`), so a kept dismissal would silently apply to nothing — a
       box the user struck out would come back with no way to tell that it had.
       This is why the pass clears it rather than filtering it. */
    const withDismissal = docReducer(d, { type: 'ID_ADDED', field: 'dismissed', id: 'det-0' });
    ok('the judged pass clears the dismissals outright',
      same(docReducer(withDismissal, { type: 'LIST_CLEARED', field: 'dismissed' }).dismissed, []));
    ok('...and striking out the same box twice is one document',
      docReducer(withDismissal, { type: 'ID_ADDED', field: 'dismissed', id: 'det-0' })
        === withDismissal);
  }

  /* --- THE THREE HELD-BACK FIELDS ARE STILL DOCUMENT FIELDS ------------- */
  {
    /* THE FLAG IS NOT A GROUP. `focusId`, `selectedOutlineId` and `roomState`
       are saved and restored exactly like everything else in the document; what
       NOT_UNDOABLE answers is what Ctrl+Z does to them. Now that all three are
       migrated, `heldBackFields()` must name all six. */
    /* ALL SIX NOW, WHICH IS WHAT THE END OF THE MIGRATION LOOKS LIKE. While it
       was in progress `heldBackFields()` named only the migrated half — the
       honest reading, since a field the document does not have cannot be held
       back through the document's own setter bag. There is no half left. */
    ok('every held-back field is a reducer field',
      same([...heldBackFields()].sort(),
           ['focusId', 'layers', 'roomState', 'selectedOutlineId', 'view', 'zoom']),
      heldBackFields().join(', '));
    ok('...and it is exactly planState\'s own list, resolved',
      same([...heldBackFields()].sort(), [...NOT_UNDOABLE].sort())
        && NOT_UNDOABLE.every((f) => f in DOC_FIELDS),
      heldBackFields().join(', '));
    const focused = docReducer(initialDoc(),
      { type: 'FIELD_SET', field: 'focusId', value: 'o2' });
    ok('...and focusing a space is still a document change',
      focused.focusId === 'o2' && focused !== initialDoc().focusId);
    ok('...and focusing the space already focused is not',
      docReducer(focused, { type: 'FIELD_SET', field: 'focusId', value: 'o2' }) === focused);
  }
}

section("domain 6c: the layers merge, the zoom clamp, and the two view moves");
{
  /* --- THE LAYER SWITCHES, AND THE MERGE THAT IS THE WHOLE POINT --------- */
  {
    const d = initialDoc();
    ok('a fresh document starts at the layer defaults',
      same(d.layers, LAYER_DEFAULTS), JSON.stringify(d.layers));
    /* AND NOT AT THE DEFAULTS OBJECT ITSELF. `useState(LAYER_DEFAULTS)` handed
       out the module's own object, and one shared mutable default is two
       documents that are the same object — which is the reason every entry in
       DOC_FIELDS is a function. */
    ok('...and not at the shared object itself', d.layers !== LAYER_DEFAULTS);

    const on = docReducer(d, { type: 'LAYER_SET', key: 'electrical', on: true });
    ok('turning a layer on is a change', on.layers.electrical === true);
    /* IDEMPOTENT, WHICH IS WHY IT IS NOT THE TOGGLE. The three places that turn
       the electrical layer on — arriving at the design screen, confirming the
       doors, selecting a board — must be able to run twice. A toggle used for
       those would turn it off on the second visit. */
    ok('...and turning it on again is one document',
      docReducer(on, { type: 'LAYER_SET', key: 'electrical', on: true }) === on);
    ok('...and it does not disturb the other layers',
      on.layers.plan === LAYER_DEFAULTS.plan && on.layers.invert === LAYER_DEFAULTS.invert);

    /* THE TOGGLE IS NOT IDEMPOTENT, DELIBERATELY: it is a switch a person is
       pressing, and pressing it twice is two acts. */
    const flipped = docReducer(on, { type: 'LAYER_TOGGLED', key: 'electrical' });
    ok('toggling a layer flips it', flipped.layers.electrical === false);
    ok('...and toggling it twice comes back, in two documents',
      docReducer(flipped, { type: 'LAYER_TOGGLED', key: 'electrical' })
        .layers.electrical === true
      && docReducer(flipped, { type: 'LAYER_TOGGLED', key: 'electrical' }) !== flipped);

    /* THE RESTORE MERGE, WHICH IS THE ONE HAND-WRITTEN ENTRY LEFT IN APP'S
       SETTER BAG. A plan saved before a layer existed has no key for it, and
       ASSIGNING the stored object would leave that layer `undefined` — which
       reads as off, on a sheet whose author never decided. This asserts the
       merge that App applies before the blunt restore setter sees the value. */
    const oldPlan = { plan: false, lights: true };
    const merged = { ...LAYER_DEFAULTS, ...oldPlan };
    ok('a plan saved before a layer existed gains it at its default',
      merged.electrical === LAYER_DEFAULTS.electrical
        && merged.spots === LAYER_DEFAULTS.spots
        && merged.plan === false,
      JSON.stringify(merged));
    /* ...AND THE BAG REALLY DOES STILL MERGE. Read out of App.jsx, because the
       merge stopping is silent: the generated setter would simply win and every
       plan saved before a layer existed would reopen with it off. */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    ok('App.jsx still merges the saved layers over the defaults',
      /setLayers:\s*\(saved\)\s*=>\s*docSetters\.setLayers\(\{\s*\.\.\.LAYER_DEFAULTS/.test(app),
      'if this fails, the blunt generated setter is being used and old plans lose layers');
    /* AND IT IS DECLARED AFTER THE SPREAD, which is the other half of it: above
       `...docSetters` the generated setter would win instead. */
    ok('...and it is declared after the generated bag is spread in',
      app.indexOf('...docSetters') < app.indexOf('setLayers: (saved) =>'));
    ok('...and App no longer keeps its own copy of the defaults',
      !/^const LAYER_DEFAULTS =/m.test(app));
  }

  /* --- THE ZOOM, AND THE GUARD THAT RESTS ON ITS CLAMP ------------------- */
  {
    const d = initialDoc();
    ok('zoom starts at actual size', d.zoom === 1);
    ok('a zoom past the top is clamped',
      docReducer(d, { type: 'ZOOM_SET', to: 99 }).zoom === ZOOM_MAX);
    ok('...and one past the bottom is clamped',
      docReducer(d, { type: 'ZOOM_SET', to: 0.01 }).zoom === ZOOM_MIN);
    /* ZERO IS THE ONE THAT MATTERS. `ui.zoom` is restored behind
       `if (p.ui.zoom)` — a truthiness test — so a stored 0 would reopen at 1
       with nothing to say it had moved. The clamp is what makes 0 unreachable,
       and this is the assertion that ties the two together: if ZOOM_MIN ever
       goes to 0, this fails and the guard has to change with it. */
    ok('a zoom of zero cannot be stored, which is what the restore guard needs',
      docReducer(d, { type: 'ZOOM_SET', to: 0 }).zoom === ZOOM_MIN
        && ZOOM_MIN > 0 && clampZoom(0) > 0,
      `ZOOM_MIN is ${ZOOM_MIN} — if this reaches 0, the ui.zoom guard becomes a silent bug`);
    ok('...and setting the zoom it already has is one document',
      docReducer(d, { type: 'ZOOM_SET', to: 1 }) === d);

    /* THE FACTOR IS APPLIED TO THE REDUCER'S OWN ZOOM, which is what the
       `z => z * k` closure used to buy and is why it no longer has to be a
       function. A wheel held down cannot walk past the limit one frame at a
       time, because every step re-clamps. */
    let z = d;
    for (let i = 0; i < 40; i++) z = docReducer(z, { type: 'ZOOM_SCALED', by: 1.2 });
    ok('a factor applied forty times still stops at the limit', z.zoom === ZOOM_MAX);
    for (let i = 0; i < 80; i++) z = docReducer(z, { type: 'ZOOM_SCALED', by: 1 / 1.2 });
    ok('...and the same in the other direction', z.zoom === ZOOM_MIN);
    /* ...AND AT THE LIMIT, SCALING FURTHER IS NOT A DOCUMENT. Otherwise a wheel
       held down against the stop would fill the undo stack with steps that
       change nothing. */
    ok('scaling past the limit you are already at is not a change',
      docReducer(z, { type: 'ZOOM_SCALED', by: 1 / 1.2 }) === z);
    /* AND `fitZoom` IS THE OTHER CALLER OF THE SHARED CLAMP. Asserted by
       reading App, because the failure is silent: a second clamp with a
       different floor is a stored zoom the guard cannot be trusted about. */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    ok('App has no clamp of its own any more',
      !/const clampZoom\s*=/.test(app) && /clampZoom/.test(app),
      'App must import the clamp, not restate it');
  }

  /* --- THE TWO CONDITIONAL VIEW MOVES ----------------------------------- */
  {
    /* ONE DOCUMENT PER VIEW, BOUND ONCE. `at(v)` called twice returns two
       different objects, so `docReducer(at(v), ...) === at(v)` proves nothing —
       it is the mistake this file already warns about at `autoSpots`. Every
       identity assertion below compares against a document held in a variable. */
    const at = (v) => docReducer(initialDoc(), { type: 'FIELD_SET', field: 'view', value: v });
    const onBoq = at('boq'), onBoards = at('boards'), onDesign = at('design');
    const onSpaces = at('spaces'), onAdmin = at('admin');

    /* THE TRACER NEEDS THE STAGE, so it moves off the two views that REPLACE the
       stage and off nothing else. Forcing 'design' unconditionally meant a trip
       to straighten one wall put you back on a tab you had deliberately left. */
    ok('opening the tracer from the schedule lands on the design',
      docReducer(onBoq, { type: 'STAGE_VIEW_REQUIRED' }).view === 'design');
    ok('...and from the switchboard sheet too, for the same reason',
      docReducer(onBoards, { type: 'STAGE_VIEW_REQUIRED' }).view === 'design');
    /* AND FROM EVERYTHING ELSE IT IS NOT A DOCUMENT AT ALL — by identity, which
       is the strong form: the tab is left alone rather than reassigned to the
       value it already had. */
    for (const [name, doc] of [['spaces', onSpaces], ['design', onDesign],
                               ['admin', onAdmin]]) {
      ok(`...and from ${name} it leaves the tab alone entirely`,
        docReducer(doc, { type: 'STAGE_VIEW_REQUIRED' }) === doc);
    }

    /* A SELECTION ON THE DRAWING PULLS THE TAB TO THE DESIGN, because the
       selection is what the tab is about — but NOT out of `admin`, which is a
       different audience's tab: yanking an operator out of it because they
       clicked the drawing would lose whatever they were reading. */
    ok('selecting something on the drawing pulls the tab to the design',
      docReducer(onBoq, { type: 'DESIGN_VIEW_REQUESTED' }).view === 'design');
    ok('...and off the switchboard sheet as well',
      docReducer(onBoards, { type: 'DESIGN_VIEW_REQUESTED' }).view === 'design');
    ok('...but never out of the admin tab',
      docReducer(onAdmin, { type: 'DESIGN_VIEW_REQUESTED' }) === onAdmin);
    ok('...and it is not a change when already on the design',
      docReducer(onDesign, { type: 'DESIGN_VIEW_REQUESTED' }) === onDesign);
  }

  /* --- THE FAN SWEEP, AND THE OBJECTS THAT ARE NOT FANS ------------------ */
  {
    let d = initialDoc();
    for (const o of [{ id: 'f1', kind: 'fan', diaFt: 3.9 },
                     { id: 'f2', kind: 'fan', diaFt: 3.9 },
                     { id: 'c1', kind: 'cassette', diaFt: 2 }])
      d = docReducer(d, { type: 'LIST_ADDED', field: 'ceilingObjs', item: o });

    /* THE NON-FANS ARE IGNORED RATHER THAN REFUSED. Selecting two fans and a
       cassette and setting a sweep is a perfectly clear instruction about the
       fans, and refusing the lot would be the tool disagreeing with something
       nobody was confused about. */
    const swept = docReducer(d, { type: 'OBJECT_SWEEP_SET', ids: ['f1', 'c1'], mm: 1200 });
    ok('a sweep reaches the fan in the selection', swept.ceilingObjs[0].diaFt !== 3.9);
    ok('...and leaves the cassette alone', swept.ceilingObjs[2] === d.ceilingObjs[2]);
    ok('...and the fan that was not selected', swept.ceilingObjs[1] === d.ceilingObjs[1]);
    ok('...and setting the sweep it already has is not a change',
      docReducer(swept, { type: 'OBJECT_SWEEP_SET', ids: ['f1'], mm: 1200 }) === swept);
    ok('...and a selection with no fans in it at all is not a change',
      docReducer(d, { type: 'OBJECT_SWEEP_SET', ids: ['c1'], mm: 1200 }) === d);
  }

  /* --- THE LAMP NUDGED OFF ITS CELL ------------------------------------- */
  {
    let d = docReducer(initialDoc(),
      { type: 'LIGHT_MOVED', roomId: 'o1', cellKey: 'c0', dx: 0.5, dy: -0.25 });
    d = docReducer(d, { type: 'LIGHT_MOVED', roomId: 'o1', cellKey: 'c1', dx: 1, dy: 0 });
    ok('a nudged lamp stores a delta from its cell, in feet',
      same(d.lightMoves.o1, { c0: { dx: 0.5, dy: -0.25 }, c1: { dx: 1, dy: 0 } }),
      JSON.stringify(d.lightMoves));
    /* PER-FRAME, SO THE BAILOUT EARNS ITS KEEP: a drag that has not crossed a
       measurable distance yet writes the same delta many times over. */
    ok('...and writing the delta it already has is not a change',
      docReducer(d, { type: 'LIGHT_MOVED', roomId: 'o1', cellKey: 'c0',
                      dx: 0.5, dy: -0.25 }) === d);

    /* A LIGHT CANNOT BE DELETED — it is derived, and a ceiling with a hole in it
       where a lamp should be is not a thing this app can express. What CAN be
       taken away is the decision about where inside its cell it sits. */
    const one = docReducer(d, { type: 'LIGHT_MOVE_RESET', roomId: 'o1', cellKey: 'c0' });
    ok('resetting one lamp leaves the other', same(one.lightMoves.o1, { c1: { dx: 1, dy: 0 } }));
    /* AND THE ROOM GOES WITH ITS LAST OFFSET. An empty `{}` under a room id is a
       room marked hand-adjusted for ever, and a row in every future save — the
       same sparse rule the materials maps and `boardKinds` follow. */
    const none = docReducer(one, { type: 'LIGHT_MOVE_RESET', roomId: 'o1', cellKey: 'c1' });
    ok('...and resetting the last one takes the room out of the map entirely',
      same(none.lightMoves, {}), JSON.stringify(none.lightMoves));
    ok('...and resetting a cell that was never moved is not a change',
      docReducer(d, { type: 'LIGHT_MOVE_RESET', roomId: 'o1', cellKey: 'c9' }) === d);
    ok('...and resetting in a room with no offsets is not a change',
      docReducer(d, { type: 'LIGHT_MOVE_RESET', roomId: 'o9', cellKey: 'c0' }) === d);
  }
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
