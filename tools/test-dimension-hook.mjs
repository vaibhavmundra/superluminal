// tools/test-dimension-hook.mjs — the read boundary, driven with React mocked.
//
// The pure reader has its own suite. THIS is the layer between it and the app:
// when the question is asked, the one write that follows, whether the door step
// is held back while an answer may still arrive, and what the panel is told.
// It had no coverage, and it is exactly where a working reader can still fail
// to reach the screen.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { projectOutlinesPx } from '../src/lib/planProjection.js';
import { readScale, statedRecord } from '../src/features/dimension-intelligence/index.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const sec = (s) => console.log('\n' + s);

const PPF = 20;
const txt = (str, cx, cy, { w = null, h = 10, rot = 0 } = {}) => {
  const wid = w ?? str.length * 6;
  return { str, w: wid, h, rot, x: cx - (wid / 2) * Math.cos(rot), y: cy - (wid / 2) * Math.sin(rot) };
};
/** A chain of three figures at PPF, which resolves from text alone. */
const CHAIN = [
  txt(`10'-0"`, 10 * PPF / 2, 50),
  txt(`12'-6"`, 10 * PPF + 12.5 * PPF / 2, 50),
  txt(`8'-0"`, 22.5 * PPF + 8 * PPF / 2, 50),
];
const source = { kind: 'raster', w: 1200, h: 900, toDu: (p) => p, fromDu: (p) => p };

// --- load the hook body with useEffect/useMemo captured ---------------------
let effects = [];
/* `useState` IS STUBBED TO ITS INITIAL VALUE, which is the right reading for a
   single render: the timeout that would flip it has not fired. Tests that want
   the timed-out state pass `restoredPlan` instead, which reaches the same
   `roomsSettled` by the other route. */
const exports = {
  useEffect: (fn) => { effects.push(fn); },
  useMemo: (fn) => fn(),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  projectOutlinesPx, readScale, statedRecord,
};
const text = await readFile(new URL('../src/features/dimension-intelligence/useDimensionIntelligence.js', import.meta.url), 'utf8');
const mod = new SourceTextModule(text);
await mod.link(() => new SyntheticModule(Object.keys(exports), function () {
  for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
}));
await mod.evaluate();
const useDI = mod.namespace.default;

/** One render, plus its effects. Returns { out, writes }. */
function render(doc, { planText = null, textKind = null, isVector = false,
                      restoredPlan = false } = {}) {
  effects = [];
  const writes = [];
  const out = useDI({ doc, docActions: { setStated: (r) => writes.push(r) },
                      source, planText, textKind, isVector, restoredPlan });
  for (const e of effects) e();
  return { out, writes };
}
const fresh = (over = {}) =>
  ({ outlines: [], roomState: { status: 'running' }, stated: null, scaleMode: 'door', ...over });

sec('OUTLINES FIRST — nothing is decided while the detector is out');
{
  /* THE SEQUENCE IS THE ARCHITECTURE. Even a chain, which needs no polygon at
     all, waits: settling early would pick whichever evidence happened to be
     ready first, and on a plan whose dimensions are all room sizes that is no
     evidence at all. The wait is the detector's own and costs nothing. */
  const waiting = render(fresh(), { planText: CHAIN });
  ok('a chain does NOT resolve before the spaces land', waiting.out.status === 'reading',
     waiting.out.status);
  ok('...so the busy modal stays up', waiting.out.pending === true);
  ok('...and nothing is written yet', waiting.writes.length === 0, `${waiting.writes.length}`);
  ok('...and the panel says it is reading',
     /Reading the dimensions/.test(waiting.out.note), waiting.out.note);
}

sec('...and then it reads, the moment the spaces are in');
{
  const { out, writes } = render(fresh({ roomState: { status: 'done' } }), { planText: CHAIN });
  ok('reads once the detector has answered', out.status === 'read', out.status);
  ok('...so the door step is skipped', out.pending === false);
  ok('writes the record exactly once', writes.length === 1, `${writes.length}`);
  ok('...with the right scale', Math.abs(writes[0].pxPerFt - PPF) < 0.01, `${writes[0]?.pxPerFt}`);
  ok('and says so on the panel', /Scale read off the drawing/.test(out.note), out.note);
  /* THREE PRINTED FIGURES ARE TWO MEASUREMENTS. A chain of n labels yields n-1
     spans between their centres, and the note counts the spans that agreed —
     which is what the number is actually about. */
  ok('...naming how many measurements agreed',
     /2 agreeing measurements/.test(out.note), out.note);
}

sec('a detector that failed still releases the step');
{
  // 'error' is an answer: no polygons are coming, so the chain is judged on
  // what it has rather than waiting for something that will never arrive.
  const { out, writes } = render(fresh({ roomState: { status: 'error' } }), { planText: CHAIN });
  ok('an error settles the sequence', out.status === 'read', out.status);
  ok('...and the chain still reads', writes.length === 1 && Math.abs(writes[0].pxPerFt - PPF) < 0.01);
}

sec('the second render, once the record is in the document');
{
  const { out, writes } = render(
    fresh({ roomState: { status: 'done' },
            stated: { pxPerFt: PPF, confidence: 'high' }, scaleMode: 'stated' }),
    { planText: CHAIN });
  ok('still reads', out.status === 'read');
  ok('and does NOT write again', writes.length === 0, `${writes.length}`);
  ok('the record is handed back', out.stated?.pxPerFt === PPF);
}

sec('a plan somebody re-measured off a door keeps their answer');
{
  // `scaleMode` moved off 'stated', so the reading must stop applying.
  const { out } = render(
    fresh({ roomState: { status: 'done' },
            stated: { pxPerFt: PPF, confidence: 'high' }, scaleMode: 'door' }),
    { planText: CHAIN });
  ok('the record is withheld while another mode is in force', out.stated === null);
}

sec('a reopened plan whose spaces were never saved');
{
  /* THE STALL THIS FIXES. `restoring` in usePlanRecognition is set once and
     never cleared, so a reopened plan's detectors never run — and applyEditor
     restores `roomState` as 'idle' when the row carries no segmentation. Read
     as "still coming", that left the busy modal up for ever on a plan whose
     spaces were never going to arrive. */
  const stuck = render(fresh({ roomState: { status: 'idle' } }),
                       { planText: CHAIN, restoredPlan: true });
  ok('idle on a REOPENED plan is terminal, not early', stuck.out.status !== 'reading',
     stuck.out.status);
  ok('...so the modal comes down', stuck.out.pending === false);
  ok('...and the chain is still read', stuck.out.status === 'read', stuck.out.status);

  // ...while the very same state on a FRESH upload means the opposite: the
  // effect has not fired yet. One render, and it must still wait.
  const fresher = render(fresh({ roomState: { status: 'idle' } }), { planText: CHAIN });
  ok('idle on a FRESH upload still waits', fresher.out.status === 'reading', fresher.out.status);
  ok('...so the two cannot be merged', fresher.out.pending === true);
}

sec('a drawing with no text layer at all');
{
  /* THE CASE THAT USED TO BE SILENT, and silence is the one answer that cannot
     be acted on: it puts somebody on the door step with no account of why the
     drawing did not answer for itself. Which sentence depends on the FILE. */
  const photo = render(fresh(), { planText: null, textKind: 'image' });
  ok('an image settles at once', photo.out.status === 'none' && !photo.out.pending);
  ok('writes nothing', photo.writes.length === 0);
  ok('and says an image has no text', /image carries no text/.test(photo.out.note), photo.out.note);

  const flat = render(fresh(), { planText: null, textKind: 'pdf' });
  ok('a PDF with no text layer says THAT instead',
     /PDF has no text layer/.test(flat.out.note), flat.out.note);

  ok('neither is ever silent', !!photo.out.note && !!flat.out.note);
}

sec('a DXF is never read');
{
  const { out, writes } = render(fresh(), { planText: CHAIN, isVector: true });
  ok('vector plans are left alone', out.status === 'none' && writes.length === 0);
}

sec('room sizes, which cannot be scored until the outlines land');
{
  const pairText = [txt(`18'-0" X 12'-0"`, 180, 130), txt(`14'-0" X 11'-0"`, 600, 130)];
  const waiting = render(fresh(), { planText: pairText });
  ok('holds the door step while the segmenter is out', waiting.out.status === 'reading');
  ok('...which is the same hold a chain gets', waiting.out.pending === true);
  ok('...and says it is reading', /Reading the dimensions/.test(waiting.out.note), waiting.out.note);
  ok('writes nothing yet', waiting.writes.length === 0);

  // The polygons arrive.
  const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const landed = render(fresh({
    roomState: { status: 'done' },
    outlines: [
      { id: 'r1', name: 'BED', pointsDu: box(0, 0, 18 * PPF, 12 * PPF), rectify: false },
      { id: 'r2', name: 'LIV', pointsDu: box(400, 0, 14 * PPF, 11 * PPF), rectify: false },
    ],
  }), { planText: pairText });
  ok('and reads once they have', landed.out.status === 'read', landed.out.status);
  ok('...at the right scale',
     Math.abs(landed.writes[0]?.pxPerFt - PPF) < 0.01, `${landed.writes[0]?.pxPerFt}`);
}

sec('a detector that came back empty does not hold the step for ever');
{
  const pairText = [txt(`18'-0" X 12'-0"`, 180, 130)];
  const { out } = render(fresh({ roomState: { status: 'error' } }), { planText: pairText });
  ok('an error settles it', out.status === 'none', out.status);
  ok('and the panel says why a door is being asked for',
     /No usable dimensions/.test(out.note), out.note);
}

sec('the door route gets the outlines that were already found');
{
  /* THE POINT OF FINDING THE SPACES FIRST EVEN WHEN THE SCALE FAILS. They are
     in the document by then, so naming a door width fills the plan in at once
     rather than starting a second wait. */
  const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const withRooms = fresh({
    roomState: { status: 'done' },
    outlines: [{ id: 'r1', name: 'A', pointsDu: box(0, 0, 100, 80), rectify: false }],
  });
  const { out, writes } = render(withRooms, { planText: [txt('KITCHEN', 50, 40)] });
  ok('no dimensions means the door step', out.status === 'none', out.status);
  ok('nothing is written', writes.length === 0);
  ok('but the outline survives for it', withRooms.outlines.length === 1);
}

sec('the N.T.S stamp is read as ordinary text');
{
  /* TWO OF THE THREE SAMPLE PLANS IN THIS REPO SAY `SCALE = N.T.S`, and one of
     them is dimensioned end to end. See the note in consensus.js: the phrase is
     a template habit, and the real protection is corroboration. */
  const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  /* THREE ROOMS THAT AGREE PERFECTLY. On an ordinary sheet this is a scale —
     MIN_AGREE is 2. On one that says N.T.S it is not: the bar is four. */
  const rooms = [
    { id: 'r1', pointsDu: box(0, 0, 18 * PPF, 12 * PPF), rectify: false },
    { id: 'r2', pointsDu: box(500, 0, 14 * PPF, 11 * PPF), rectify: false },
    { id: 'r3', pointsDu: box(0, 400, 20 * PPF, 16 * PPF), rectify: false },
  ];
  const sizes = [txt(`18'-0" X 12'-0"`, 180, 120), txt(`14'-0" X 11'-0"`, 640, 110),
                 txt(`20'-0" X 16'-0"`, 200, 560)];
  const plain = render(fresh({ roomState: { status: 'done' }, outlines: rooms }),
                       { planText: sizes });
  ok('three agreeing rooms ARE a scale on an ordinary sheet', plain.out.status === 'read',
     plain.out.status);

  /* A TITLE BLOCK CHANGES NOTHING. `SCALE = N.T.S` is on every sample plan in
     this repo, including ones dimensioned end to end — it goes into a template
     once and is never looked at again. It is ordinary text. */
  const stamped = render(fresh({ roomState: { status: 'done' }, outlines: rooms }),
                         { planText: [...sizes, txt('SCALE = N.T.S', 1500, 900)] });
  ok('...and the N.T.S stamp does not change that', stamped.out.status === 'read',
     stamped.out.status);
}

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);
process.exit(fail ? 1 : 0);
