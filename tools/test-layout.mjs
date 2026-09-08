// ---------------------------------------------------------------------------
// test-layout.mjs — the layout pipeline, out of the React memo it was stranded
// in and under test for the first time.
//
// `layoutRooms` is what App.jsx's `rooms` memo used to be: the document in, the
// laid-out rooms out. Everything it calls — planner.js, chunking.js,
// ceilingDesign.js, cove.js, track.js, roomTypes.js — has had its own script in
// here for a long time. What had never been tested is the ASSEMBLY: the order
// the passes run in, the conversions between the plan's pixels and each room's
// own feet, and which of the answers survive to the drawing.
//
// SHAPE AND NOT COORDINATES, deliberately. The exact position of a downlight is
// the planner's business and test-planner.mjs already argues about it; a second
// copy of those numbers here would break on every legitimate tuning change and
// teach nobody anything. What this script asserts is what the ASSEMBLY promises:
// a room comes back lit or refused with a reason, everything it produces lands
// inside the room it belongs to, a hole in the ceiling is respected, a fan is
// carried to the room it stands in, and two identical calls produce two
// identical answers.
//
// Five claims, and every assertion below belongs to one of them:
//
//   1. EVERY ROOM COMES BACK ANSWERED. `plan.ok` is true, or it is false and
//      says why. A room that comes back silently empty is the failure this
//      catches.
//   2. WHAT IS PLACED IS PLACED IN THE ROOM. Cells, cove tape and fittings are
//      all inside the polygon they were laid out on — the room-local feet and
//      the plan's pixels have to agree, and they are converted in a dozen
//      places.
//   3. THE HOLES AND THE OBSTACLES REACH THE PASSES THAT CARE. A no-light zone
//      is cut out of the grid; a fan belongs to the room it is standing in and
//      to no other; and no fitting stands in a fan's clearance.
//   4. A NAME IS STABLE. Chunk keys are geometry, so two identical calls name
//      the same pieces — that is what a remembered pick is stored against.
//   5. IT IS PURE. Two calls with one input produce deeply equal answers. That
//      is the whole justification for the move out of the memo, so it is asserted
//      rather than assumed.
//
//   node tools/test-layout.mjs
// ---------------------------------------------------------------------------

import { layoutRooms } from '../src/lib/layout.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';
import { shapeFromDrag } from '../src/lib/ceilingShapes.js';
import { pointInPolygon } from '../src/lib/geometry.js';
import { surfaceDistance } from '../src/lib/planner.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);

// --- the fixture ------------------------------------------------------------
//
// TEN PIXELS TO THE FOOT, and no outline is written in pixels below: `outline`
// takes feet and multiplies, because a fixture written in pixels is a fixture
// nobody can check by eye. The two rooms sit side by side in one plan the way
// they would on a real sheet — the L starts at x = 40 ft — so the conversion
// into each room's OWN feet, measured from its own bounding box, is actually
// exercised rather than being the identity.
const PX = 10;
const opt = PLAN_OPTIONS;
const ftPx = (p) => ({ x: p.x * PX, y: p.y * PX });
// Built by hand rather than through `makeOutline`, whose ids carry a timestamp.
// Claim 5 compares two whole answers, and an id that moves would pass it for the
// wrong reason on the first call and fail it on the second.
const outline = (id, ptsFt) => ({ id, name: id, pointsPx: ptsFt.map(ftPx), rectify: true });

const RECT = outline('rect-room',
  [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 13 }, { x: 0, y: 13 }]);
const L = outline('l-room',
  [{ x: 40, y: 0 }, { x: 84, y: 0 }, { x: 84, y: 30 },
   { x: 56, y: 30 }, { x: 56, y: 14 }, { x: 40, y: 14 }]);

// A ceiling fan in the middle of the rectangular room, and nowhere near the L.
const FAN = { id: 'fan1', kind: 'fan', x: 8 * PX, y: 6.5 * PX, r: 2.5 * PX };
// A bed in the L's lower leg. It is in both `zoneList` (what the planner is
// given) and `zones` (the room as BUILT) because a hand-drawn box is both.
const BED = { id: 'z-bed', cls: 'bed', kind: 'bed', source: 'hand', roomId: 'l-room',
              x0: 60 * PX, y0: 18 * PX, x1: 70 * PX, y1: 26 * PX };
// A cove somebody drew on the L's upper leg. `shapeFromDrag` mints an id from a
// counter, so it is overwritten for the same reason the outlines' are.
const COVE = { ...shapeFromDrag('rect', { x: 44, y: 3 }, { x: 60, y: 12 }), id: 'sh-cove' };

const INPUT = {
  source: { kind: 'raster' },
  pxPerFt: PX,
  litOutlines: [RECT, L],
  useBoundingRect: false,
  ceilingObstaclesPx: [FAN],
  zoneList: [BED],
  zones: [BED],
  reverseCoveZones: [],
  chunkOpt: { targetArea: opt.targetArea, minChunk: opt.minChunk,
              minChunkArea: opt.minChunkArea, fanClearance: opt.fanClearance },
  chunkPicks: {},
  opt,
  enclosedZones: () => [],
  roomTypes: {},
  projectId: 'residential',
  designPicks: {},
  ceilingKinds: {},
  ceilingShapes: [COVE],
  lightMoves: {},
  manualTracks: [],
  isAdmin: false,
};

const rooms = layoutRooms(INPUT);
const rect = rooms.find((r) => r.id === 'rect-room');
const ell = rooms.find((r) => r.id === 'l-room');

// --- 1. every room comes back answered --------------------------------------
say('1. EVERY ROOM COMES BACK ANSWERED');
{
  ok(rooms.length === 2, 'both lit outlines come back as rooms');
  ok(!!rect && !!ell, '...and each is found by the id it went in with');
  for (const r of rooms) {
    ok(r.plan.ok === true || (r.plan.ok === false && typeof r.plan.reason === 'string'
                              && r.plan.reason.length > 0),
      `${r.id}: plan.ok is true, or false with a reason in words`);
  }
  ok(rect.plan.ok && ell.plan.ok, 'both of these rooms are big enough to lay out');

  // AND A ROOM THAT CANNOT BE LAID OUT SAYS SO rather than coming back empty.
  // This is the other half of the claim and the half that is easy to lose: a
  // refusal that arrives as `{ ok: false }` with nothing on it reaches the
  // troubles list as a blank line.
  const tiny = layoutRooms({ ...INPUT, ceilingShapes: [], zoneList: [], zones: [],
    litOutlines: [outline('tiny', [{ x: 0, y: 0 }, { x: 3, y: 0 },
                                   { x: 3, y: 2 }, { x: 0, y: 2 }])] });
  ok(tiny.length === 1, 'a room too small to light is still RETURNED, not dropped');
  ok(tiny[0].plan.ok === false, '...refused');
  ok(/\S/.test(tiny[0].plan.reason ?? ''),
    `...and it says why: "${tiny[0].plan.reason}"`);
  ok(Array.isArray(tiny[0].plan.polygonPx) && tiny[0].plan.polygonPx.length >= 3,
    '...and it still carries its outline, which is what the canvas draws it from');
}

// --- 2. what is placed is placed in the room --------------------------------
say('2. WHAT IS PLACED IS PLACED IN THE ROOM');
{
  // THE GRID FIRST, because it is the thing there is most of. Every cell the
  // chunker cut has to have its centre inside the polygon it was cut from —
  // this is the assertion that catches a room-local-feet value that escaped
  // into the plan's pixel space or the other way round, and with the L's
  // bounding box starting at 40 ft, an unconverted number lands 400 px away.
  for (const r of [rect, ell]) {
    const cells = r.plan.gridCellsPx;
    ok(cells.length > 0, `${r.id}: the chunker cut ${cells.length} cells`);
    const outside = cells.filter((c) => !pointInPolygon(
      { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }, r.plan.polygonPx));
    ok(outside.length === 0, `${r.id}: ...and every one of them is inside the room`);
    ok(r.plan.gridLightsPx.length > 0,
      `${r.id}: the grid's actual light count survives separately from its cells`);
    ok(r.plan.gridLightsPx.every((l) => pointInPolygon(l, r.plan.polygonPx)),
      `${r.id}: ...and every saved grid light is inside the room`);
  }

  // THE FITTINGS, which is the assertion the claim is really about. It is a
  // real loop over a list that is EMPTY TODAY, and the reason is stated below
  // in claim 3 — `AUTO_GRID` is off, so the grid's answer is blanked after it
  // is computed. Written as a loop rather than as an assertion about zero so
  // that it becomes the real test the day that switch is flipped, rather than
  // something somebody has to remember to come back and write.
  for (const r of [rect, ell]) {
    const stray = r.plan.lightsPx.filter((l) => !pointInPolygon(l, r.plan.polygonPx));
    ok(stray.length === 0,
      `${r.id}: every one of ${r.plan.lightsPx.length} fittings is inside the room`);
    ok(r.plan.lightsPx.every((l) => l.fixture),
      `${r.id}: ...and every one of them knows what it is bought as`);
  }

  // THE COVE THE HAND DREW, which survives the blanking because a drawn cove is
  // not the grid's — see the note at `coves` in layout.js.
  ok(ell.coves.length === 1, 'the drawn cove reaches the L-shaped room as one cove');
  ok(ell.coveStrips.length === 1, '...and as one run of tape, not four');
  ok(ell.ceiling === 'cove', '...and the room reports its ceiling as a cove');
  ok(rect.coves.length === 0 && rect.ceiling === 'standard',
    '...and the rectangular room, which nobody drew on, is untouched by it');
  const strip = ell.coveStrips[0];
  ok(strip.loop.every((p) => pointInPolygon(p, ell.plan.polygonPx)),
    '...the tape is inside the room it is installed in');
  ok(strip.runLength > 0, `...and has a length to bill (${(strip.runLength / PX).toFixed(1)} ft)`);
  ok(strip.shapeId === 'sh-cove',
    '...and it remembers which drawn shape it belongs to, so it can be deleted');
  ok(strip.id.includes(ell.coves[0].key),
    '...and its id carries the chunk key, so two coves in a room are two runs');
}

// --- 3. the holes and the obstacles reach the passes that care --------------
say('3. THE HOLES AND THE OBSTACLES REACH THE PASSES THAT CARE');
{
  // THE BED IS A HOLE IN THE GRID. It arrives in the plan's pixels, is
  // converted into the L's own feet, and the chunker cuts round it — so no cell
  // may overlap it. Testing this on the CELLS rather than on the lights is what
  // makes it an assertion rather than a hope: cells survive the blanking.
  const zonesFt = ell.geo.zonesFt;
  ok(zonesFt.length === 1 && zonesFt[0].id === 'z-bed',
    'the bed reaches the L-shaped room, and only it');
  ok(zonesFt[0].kind === 'bed' && zonesFt[0].cls === 'bed',
    '...still knowing WHAT it is, not just where');
  const overlaps = ell.plan.gridCellsPx.filter((c) => zonesFt.some((z) =>
    c.x0 / PX < z.x1 - 1e-9 && c.x1 / PX > z.x0 + 1e-9
    && c.y0 / PX < z.y1 - 1e-9 && c.y1 / PX > z.y0 + 1e-9));
  ok(overlaps.length === 0, '...and not one of the cells is cut over it');
  ok(rect.geo.zonesFt.length === 0,
    '...while the room it was not drawn in never hears about it');

  // THE FAN BELONGS TO THE ROOM IT IS STANDING IN. A whole-floor plan carries
  // every fan in the building, and the filter that picks out this ceiling's is
  // one line in layoutRooms with no other test on it.
  ok(rect.plan.fansFt.length === 1 && rect.plan.fansFt[0].type === 'fan',
    'the fan reaches the room it stands in');
  ok(Math.abs(rect.plan.fansFt[0].r - 2.5) < 1e-9,
    '...with its blade circle converted into that room\'s feet');
  ok(ell.plan.fansFt.length === 0,
    '...and does not reach the room it is nowhere near');
  ok(rect.plan.stats.fans === 1 && ell.plan.stats.fans === 0,
    '...and the count in `stats` says the same, which is what the panel reads');

  // AND NO FITTING STANDS IN ITS CLEARANCE. Same shape of assertion as the
  // containment loop above and for the same reason: the list is empty today
  // because `AUTO_GRID` is off — the grid runs, and the block that blanks it
  // throws the fittings away and keeps the geometry. This asserts the rule
  // against whatever is actually there.
  const fans = rect.plan.fansFt;
  const tooClose = rect.plan.lights.filter((l) =>
    fans.some((f) => surfaceDistance(f, l) < opt.fanClearance));
  ok(tooClose.length === 0,
    `no fitting stands within ${opt.fanClearance} ft of the fan `
    + `(${rect.plan.lights.length} to check)`);
  // Said out loud rather than left as a silent zero, because a suite that
  // reports "0 lights, all of them fine" and calls it a pass is the kind of
  // green nobody should trust. See AUTO_GRID in layout.js.
  ok(rect.plan.lights.length === 0 && rect.plan.gridCellsPx.length > 0
      && rect.plan.gridLightsPx.length > 0,
    'AUTO_GRID is OFF, so the grid is computed and its FITTINGS are blanked — '
    + 'the two loops above are real and currently vacuous, and become the test '
    + 'the day that switch is flipped');
}

// --- 4. a name is stable ----------------------------------------------------
say('4. A NAME IS STABLE');
{
  const again = layoutRooms(INPUT);
  for (const r of rooms) {
    const b = again.find((q) => q.id === r.id);
    const ka = r.design.chunks.map((c) => c.key);
    const kb = b.design.chunks.map((c) => c.key);
    ok(ka.length > 0, `${r.id}: the ceiling is ${ka.length} piece(s)`);
    ok(ka.join('|') === kb.join('|'),
      `${r.id}: ...and a second call names the same pieces in the same order`);
    ok(ka.every((k) => /^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(k)),
      `${r.id}: ...by their geometry, which is what survives a re-render`);
  }
  ok(new Set(ell.design.chunks.map((c) => c.key)).size === ell.design.chunks.length,
    'no two pieces of the L-shaped ceiling share a name');

  // A REMEMBERED PICK IS STORED AGAINST ONE OF THOSE NAMES, so handing one back
  // has to be honoured rather than quietly falling through to the recommendation.
  const opts = ell.design.options ?? [];
  if (opts.length > 1) {
    const other = opts.find((o) => o.id !== ell.chosenId);
    const picked = layoutRooms({ ...INPUT, chunkPicks: { 'l-room': other.id } })
      .find((r) => r.id === 'l-room');
    ok(picked.chosenId === other.id, 'a chunking asked for by name is the one laid out');
    ok(picked.chunkingChosenBy === 'user', '...and the room says the choice was a hand\'s');
  } else {
    ok(ell.chunkingChosenBy === 'recommended',
      'this ceiling reads only one way, so the reading is the recommendation');
  }
}

// --- 5. it is pure ----------------------------------------------------------
say('5. IT IS PURE');
{
  /* DEEP EQUALITY AND NOT `JSON.stringify`. Two things would slip through a
     string compare: `plan.toPx` is a FUNCTION and JSON drops it silently, so a
     call that stopped returning one would still match; and JSON writes NaN as
     null, so a coordinate that went bad in one call and not the other would
     compare equal to a good one. Functions are compared by arity and position,
     which is the most a fresh closure per call can promise. */
  const deepEq = (a, b, path = '') => {
    if (typeof a === 'function' || typeof b === 'function') {
      return (typeof a === typeof b && a.length === b.length) ? true : path || '<root>';
    }
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return path || '<root>';
    if (Array.isArray(a) !== Array.isArray(b)) return path || '<root>';
    if (Array.isArray(a) && a.length !== b.length) return `${path}.length`;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return `${path}{keys}`;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return `${path}.${k}`;
      const r = deepEq(a[k], b[k], `${path}.${k}`);
      if (r !== true) return r;
    }
    return true;
  };

  const first = layoutRooms(INPUT);
  const second = layoutRooms(INPUT);
  const verdict = deepEq(first, second);
  ok(verdict === true, `two calls with one input are deeply equal${verdict === true ? '' : ` — differ at ${verdict}`}`);

  // AND THE INPUT IS NOT TOUCHED. A function that answers the same twice by
  // rewriting what it was handed is not pure, it is just consistent — and the
  // caller is a React memo whose dependencies are these very objects.
  ok(INPUT.litOutlines.length === 2 && INPUT.ceilingShapes.length === 1
     && INPUT.zoneList.length === 1 && INPUT.manualTracks.length === 0,
    'the input arrays come back the length they went in');
  ok(INPUT.ceilingShapes[0].id === 'sh-cove' && INPUT.ceilingShapes[0].wFt === 16,
    '...and the drawn shape was not rewritten in place');
  ok(Object.keys(INPUT.chunkPicks).length === 0 && Object.keys(INPUT.designPicks).length === 0,
    '...and nothing was memoised back into the picks');

  // A DIFFERENT INPUT IS A DIFFERENT ANSWER, which is the other half of it: a
  // function that returns the same thing whatever it is handed would sail
  // through every assertion above.
  const noCove = layoutRooms({ ...INPUT, ceilingShapes: [] })
    .find((r) => r.id === 'l-room');
  ok(noCove.coves.length === 0 && noCove.ceiling === 'standard',
    'take the drawn cove away and the room is a standard ceiling again');
  ok(deepEq(noCove.design.chunks, ell.design.chunks) !== true,
    '...and the ceiling is cut up differently, which is what the cove was for');

  /* --- AND ONE PLACE WHERE IT IS NOT PURE, PINNED HERE ON PURPOSE ----------
     THE ROOMS ABOVE ARE RECTILINEAR AND THAT IS WHY CLAIM 5 IS GREEN. Hand a
     traced outline whose corners are a few inches off square — which is every
     outline the tracer and the detector actually produce — and the second call
     answers differently from the first.

     IT IS NOT THIS FILE'S BUG AND IT IS OLDER THAN THE MOVE. `regionFromOutline`
     is the pipeline's first line, and it WRITES BACK INTO `outline.pointsPx`:
     `ensureCCW` (geometry.js) returns the caller's own array when it is already
     counter-clockwise, `douglasPeucker` copies the array but keeps the same
     point OBJECTS, and the wall-snapping pass in `rectifyPolygon` then does
     `const y = (a.y + b.y) / 2; a.y = y; b.y = y;` straight into them. Each call
     averages the same pair again, so the corners converge by halves and the
     ANSWER only moves once the drift crosses a rounding boundary — which is
     exactly why nobody has seen it: the layout used to live in a memo, where
     nothing could call it twice with one outline and compare.

     PINNED RATHER THAN FIXED, because the fix is one line in geometry.js and it
     belongs to whoever owns that file. THIS ASSERTION IS EXPECTED TO FAIL THE
     DAY IT IS FIXED: when it does, the fix is right — delete this block and
     fold the wobbly room into the fixture above, where the purity claim can
     finally be made about the outlines the app really has. */
  {
    /* A ROOM AS THE TRACER ACTUALLY PRODUCES ONE: four walls, a dozen points
       along each, every one of them a few inches off the line. The rooms in the
       fixture above are drawn corner to corner and are already square, which is
       the only reason the assertions above are green. Generated rather than
       written out because it has to be built FRESH for each call — the whole
       point below is that the pipeline eats it. */
    let seed = 1;
    const jitter = (a) => { seed = (seed * 1103515245 + 12345) % 2147483648;
                            return ((seed / 2147483648) * 2 - 1) * a; };
    const wall = (from, to, n) => Array.from({ length: n }, (_, i) => {
      const t = i / n;
      return { x: +(from.x + (to.x - from.x) * t + (from.x === to.x ? jitter(3) : 0)).toFixed(1),
               y: +(from.y + (to.y - from.y) * t + (from.y === to.y ? jitter(3) : 0)).toFixed(1) };
    });
    const traced = () => {
      seed = 1;
      const c = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
      return { id: 'traced', name: 'traced', rectify: true,
               pointsPx: [...wall(c[0], c[1], 14), ...wall(c[1], c[2], 11),
                          ...wall(c[2], c[3], 14), ...wall(c[3], c[0], 11)] };
    };

    const held = traced();
    const bare = { ...INPUT, ceilingShapes: [], zoneList: [], zones: [],
                   ceilingObstaclesPx: [], litOutlines: [held] };
    const before = JSON.stringify(held.pointsPx);
    const first = JSON.stringify(layoutRooms(bare)[0].region.polygon);
    ok(before !== JSON.stringify(held.pointsPx),
      'KNOWN DEFECT (rectifyPolygon in geometry.js, NOT layout.js): laying a room '
      + 'out REWRITES the outline it was handed, corner by corner, in place');

    let driftedAt = 0;
    for (let i = 2; i <= 8 && !driftedAt; i++) {
      if (JSON.stringify(layoutRooms(bare)[0].region.polygon) !== first) driftedAt = i;
    }
    ok(driftedAt > 0,
      `...so the same call answers differently by call ${driftedAt || '?'}, and the `
      + 'purity asserted above holds only for an outline that arrives square. Fix '
      + 'that line and this pair flips — see the note above.');

    // AND IT CONVERGES RATHER THAN WALKING, which is why nobody has noticed:
    // the pass averages the SAME pair of corners every time, so each call moves
    // them half as far as the last. Stated here so a reader knows the size of
    // what they are looking at rather than reaching for the panic button.
    const fresh = traced();
    const one = { ...bare, litOutlines: [fresh] };
    const steps = [];
    for (let i = 0; i < 6; i++) {
      const was = fresh.pointsPx.map((q) => ({ ...q }));
      layoutRooms(one);
      steps.push(Math.max(...fresh.pointsPx.map((q, k) =>
        Math.hypot(q.x - was[k].x, q.y - was[k].y))));
    }
    // NOT MONOTONE, and it is worth knowing why: as the shape squares up, the
    // pass finds a DIFFERENT pair of near-collinear corners to average, so a
    // later call can move one further than the one before it. What it does do
    // is run out — the outline reaches a fixed point and stops moving.
    ok(steps[steps.length - 1] < steps[0] / 100,
      `...and it runs out rather than walking: by the sixth call a corner moves `
      + `less than a hundredth of what the first one moved `
      + `(${steps.map((d) => d.toFixed(4)).join(' -> ')} px)`);
  }

  // NO GUARD, NO ANSWER. The first line of the pipeline, and the one thing
  // every caller depends on while a plan is still loading.
  ok(layoutRooms({ ...INPUT, source: null }).length === 0, 'no source, no rooms');
  ok(layoutRooms({ ...INPUT, pxPerFt: 0 }).length === 0, 'no scale, no rooms');
  ok(layoutRooms({ ...INPUT, litOutlines: [] }).length === 0, 'nothing lit, no rooms');
}

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
