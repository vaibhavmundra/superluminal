// ---------------------------------------------------------------------------
// test-box.mjs — THE BOX PRIMITIVE.
//
// WHAT IS ASSERTED. The resize and rotate arithmetic itself is the ceiling
// object's, moved here unchanged, and tools/test-ceiling.mjs already drives it
// through that file's re-exports. What is asserted HERE is what the box adds as
// a primitive:
//
//   ROTATION IS REAL. A rotated box's corners, its outline, its axis-aligned
//   bounds and its hit test are all asked in the box's OWN frame — testing a
//   turned box against its bounds picks it up in the corners it does not
//   occupy.
//   MOVE TOUCHES NOTHING BUT THE CENTRE, which is the whole argument for a
//   chandelier being a point with a size rather than a shape.
//   THE GRIPS ARE POINTS and the outline is a host, so the corner handles ride
//   the point primitive and anything can be held on an edge.
//   THE MODES ARE ONE GESTURE — only a move is a translation.
//   AND THE ALIASES HOLD: ceilingObjects.js's names ARE these functions.
//
//   node tools/test-box.mjs
// ---------------------------------------------------------------------------

import {
  BOX, SIZE_LIMITS, clampFt, makeBox, isBox, isUniform, toLocal, toWorld,
  boxCorners, boxOutline, asPathHost, boxBounds, boxContains, boxAdapters,
  boxOrtho, BOX_MODES, boxMoves, resizeFromCorner, ROTATE_SNAP, rotateTo,
  applyBoxResize, cornerHandles, rotateHandle,
} from '../src/lib/box.js';
import {
  clampFt as objClampFt, resizeFromCorner as objResize, rotateTo as objRotate,
  toLocal as objToLocal, ROTATE_SNAP as objSnap,
} from '../src/lib/ceilingObjects.js';
import { isConstrained, pointOn, resolvePoint } from '../src/lib/point.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

/** A 4 x 2 box at (10, 10), square to the world. */
const B = makeBox({ x: 10, y: 10, wFt: 4, hFt: 2, id: 'b' });
/** The same, turned a quarter turn. */
const T = makeBox({ x: 10, y: 10, wFt: 4, hFt: 2, rot: Math.PI / 2, id: 't' });
/** A round one — a chandelier. */
const R = makeBox({ x: 0, y: 0, wFt: 3, hFt: 9, uniform: true, id: 'r' });

// ---------------------------------------------------------------------------
say('WHAT A BOX IS — a centre, two extents, an angle');
{
  ok(BOX === 'box' && isBox(B), 'and it is one');
  ok(!isBox({ x: 0, y: 0, wFt: 0, hFt: 1 }), 'with no extent it is not');
  ok(near(clampFt(0.1), SIZE_LIMITS.minFt) && near(clampFt(99), SIZE_LIMITS.maxFt),
    'hand-dragged sizes are clamped');
  ok(isUniform(R) && !isUniform(B), 'and a round one is told apart by its own flag');
  ok(near(R.hFt, R.wFt),
    'a uniform box\'s second extent is forced to its first at birth — a chandelier '
    + 'has ONE dimension');
  ok(boxOrtho() === true, 'a box move takes the shift lock');
}

// ---------------------------------------------------------------------------
say('ROTATION IS REAL — every question is asked in the box\'s own frame');
{
  const l = toLocal({ x: 12, y: 10 }, { x: 10, y: 10 }, 0);
  ok(near(l.x, 2) && near(l.y, 0), 'a world point in the box\'s coordinates...');
  const w = toWorld(l, { x: 10, y: 10 }, 0);
  ok(near(w.x, 12) && near(w.y, 10), '...and back out again');

  const c = boxCorners(B);
  ok(c.length === 4 && c.every((q) => q.sx && q.sy),
    'four corners, each naming itself with the sign pair resizeFromCorner takes');
  const tl = c.find((q) => q.sx === -1 && q.sy === -1);
  ok(near(tl.x, 8) && near(tl.y, 9), 'square to the world, they are where you would expect');

  const out = boxOutline(B);
  ok(out.length === 4 && near(out[0].x, 8) && near(out[1].x, 12),
    'and its outline is a ring, wound to read as a path');

  const bb = boxBounds(B);
  ok(near(bb.w, 4) && near(bb.h, 2), 'square to the world, its bounds ARE its extents');
  const tb = boxBounds(T);
  ok(near(tb.w, 2) && near(tb.h, 4),
    'turned a quarter turn they are swapped — which is why `wFt` x `hFt` is not a hit test');

  ok(boxContains(B, { x: 11.5, y: 10.5 }) && !boxContains(B, { x: 11.5, y: 12 }),
    'the hit test is asked in the frame...');
  ok(boxContains(T, { x: 10.5, y: 11.5 }) && !boxContains(T, { x: 11.5, y: 10.5 }),
    '...so a turned box is not picked up in the corners it does not occupy');
}

// ---------------------------------------------------------------------------
say('MOVE — it touches the centre and NOTHING else');
{
  const unit = boxAdapters();
  ok(near(unit.at(T).x, 10) && near(unit.at(T).y, 10), 'a box\'s position is its centre');
  const moved = unit.to(T, { x: 50, y: 60 });
  ok(near(moved.x, 50) && near(moved.y, 60), 'and a move writes it');
  ok(near(moved.wFt, T.wFt) && near(moved.hFt, T.hFt) && near(moved.rot, T.rot),
    'the extent and the angle are untouched — the whole argument for a chandelier '
    + 'being a point with a size');
  ok(near(boxBounds(moved).w, boxBounds(T).w), 'so it is the same box, elsewhere');
}

// ---------------------------------------------------------------------------
say('THE GRIPS ARE POINTS, AND THE OUTLINE IS A HOST');
{
  const hs = cornerHandles(B);
  ok(hs.length === 4 && !isConstrained(hs[0]),
    'the corner handles come out as FREE point records — the point gesture, not a second one');
  ok(hs.every((h) => h.corner && Math.abs(h.corner.sx) === 1),
    'each carrying the sign pair resizeFromCorner is given');
  ok(hs.some((h) => h.id === 'b#lt') && hs.every((h) => h.of === 'b'),
    'and named so a press can find which box and which corner it came from');

  const rot = rotateHandle(B, 1);
  ok(near(rot.x, 10) && near(rot.y, 8),
    'the rotation grip sits off the top edge in the box\'s own frame...');
  const rotT = rotateHandle(T, 1);
  ok(near(rotT.x, 12) && near(rotT.y, 10),
    '...so it stays above the box however far the box is turned');
  ok(rotateHandle(null) === null, 'and there is none for a box that is not one');

  const h = asPathHost(B);
  ok(h.id === 'b' && h.closed === true && h.pts.length === 4,
    'its outline is the host contract, always closed');
  const onEdge = resolvePoint(pointOn('b', 0, {}), h);
  ok(near(onEdge.x, 8) && near(onEdge.y, 9),
    'so a point can be held on a box\'s EDGE and resolves through the point primitive');
}

// ---------------------------------------------------------------------------
say('MODES — three of them, one gesture, and only the first is a translation');
{
  ok(BOX_MODES.join() === 'move,resize,rotate', 'the three are named once');
  ok(boxMoves({ mode: 'move' }) && !boxMoves({ mode: 'resize' })
    && !boxMoves({ mode: 'rotate' }),
    'and `moves` says which frames resolve a lock, a snap and a delta');
  ok(boxMoves({}) === true,
    'a gesture that names no mode is a move — a plain drag should not need to say so');
}

// ---------------------------------------------------------------------------
say('RESIZE AND ROTATE — the arithmetic, and the anchor that makes it direct');
{
  const br = { sx: 1, sy: 1 };
  const next = resizeFromCorner(B, br, { x: 16, y: 14 });
  ok(near(next.wFt, 8) && near(next.hFt, 5),
    'dragging the bottom-right to (16,14) from an anchor at (8,9) grows it to 8 x 5');
  const anchor = boxCorners({ ...B, ...next })
    .find((q) => q.sx === -1 && q.sy === -1);
  ok(near(anchor.x, 8) && near(anchor.y, 9),
    'and the TOP-LEFT is still exactly where it was — the box grows under your hand '
    + 'rather than sliding around beneath it');

  const uni = resizeFromCorner(B, br, { x: 16, y: 10.5 }, { uniform: true });
  ok(near(uni.wFt / uni.hFt, B.wFt / B.hFt), 'Shift locks the aspect ratio');
  const mid = resizeFromCorner(B, br, { x: 14, y: 12 }, { fromCentre: true });
  ok(near(mid.x, B.x) && near(mid.y, B.y) && near(mid.wFt, 8),
    'and Alt keeps the centre and grows both sides');

  const free = rotateTo(B, { x: 10, y: 0 }, { startRot: 0, startAngle: 0 });
  ok(near(free, -Math.PI / 2), 'a rotate is free by default');
  const snapped = rotateTo(B, { x: 20, y: 1 }, { snap: true });
  ok(near(snapped % ROTATE_SNAP, 0) || near(Math.abs(snapped % ROTATE_SNAP), ROTATE_SNAP),
    'and quantised to fifteen degrees only while Shift is held');
  ok(rotateTo(B, { x: 10.001, y: 10 }, { startRot: 3.2 }) <= Math.PI,
    'normalised to (-PI, PI] so no readout ever says 725 degrees');

  const bigger = applyBoxResize(R, { x: 0, y: 0, wFt: 5, hFt: 2 });
  ok(near(bigger.wFt, 5) && near(bigger.hFt, 5),
    'a round box stays round through a resize — the larger of the two wins');
  const rect = applyBoxResize(B, { x: 1, y: 2, wFt: 5, hFt: 2 });
  ok(near(rect.wFt, 5) && near(rect.hFt, 2), 'and a rectangular one keeps both');
}

// ---------------------------------------------------------------------------
say('ALIASES — ceilingObjects.js\'s names ARE these functions, not copies');
{
  ok(objClampFt === clampFt && objResize === resizeFromCorner
    && objRotate === rotateTo && objToLocal === toLocal && objSnap === ROTATE_SNAP,
    'five names re-exported, so the forty call sites did not have to change');
  ok(near(objResize(B, { sx: 1, sy: 1 }, { x: 16, y: 14 }).wFt, 8),
    'and they still answer exactly as that file documented them');
}

console.log('\n' + (fail ? `FAILED ${fail}` : 'all good'));
process.exit(fail ? 1 : 0);
