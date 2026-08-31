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
import { serialiseEditor, applyEditor, statsFrom, statusFrom, STATE_VERSION }
  from '../src/lib/planState.js';

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
  const p = serialiseEditor(STATE);
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
    !JSON.stringify(serialiseEditor(STATE)).includes('base64')
    && !JSON.stringify(serialiseEditor(STATE)).includes('data:image'));
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
}

section('the writer and the reader cover the same fields');
{
  // Every key the writer emits has to be consumed. `v`, `savedAt` and `scale`
  // are structural rather than state (the reader unpacks `scale` into five
  // setters), so they are named exemptions rather than an excuse to skip the
  // check.
  const STRUCTURAL = new Set(['v', 'savedAt', 'scale', 'ui', 'ceilingFt']);
  const p = serialiseEditor(STATE);
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
