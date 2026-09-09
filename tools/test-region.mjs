// ---------------------------------------------------------------------------
// test-region.mjs — THE REGION PRIMITIVE.
//
// WHAT IS ASSERTED. Not geometry.js's polygon maths — `pointInPolygon`,
// `polygonArea`, `offsetPolygon` and `maxInset` are called rather than copied
// and have their own tests. What is asserted is what a REGION adds:
//
//   INSIDE     the third constraint kind, the one point.js does not have: hold
//              this INSIDE that, with a gap.
//   MET        an already-legal point is not touched, and an illegal one stops
//              against the wall and slides along it.
//   WINDING    the ring is wound anti-clockwise, because the inward normal
//              depends on it and half the clamps would push OUT without it.
//   BOUNDARY   its outline is a host, so a plate can slide round a room.
//   CARRY      what it holds is separate from what merely sits inside it.
//
//   node tools/test-region.mjs
// ---------------------------------------------------------------------------

import {
  REGION, makeRegion, isRegion, asPathHost, regionArea, regionContains,
  regionBounds, regionCentre, clearanceIn, insetRegion, regionMaxInset,
  clampInside, translateRegion, regionAdapters, regionOrtho, dependentsOfRegion,
} from '../src/lib/region.js';
import { pointOn, freePoint, resolvePoint } from '../src/lib/point.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

/** A 100 square, given CLOCKWISE on purpose — makeRegion has to fix it. */
const SQ = makeRegion([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 },
  { x: 100, y: 0 }], { id: 'sq' });
/** An L, so the notch can be tested. */
const L = makeRegion([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 },
  { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }], { id: 'L' });

// ---------------------------------------------------------------------------
say('WHAT A REGION IS — a closed path with an inside');
{
  ok(REGION === 'region' && isRegion(SQ), 'three points is the least that has one');
  ok(!isRegion(makeRegion([{ x: 0, y: 0 }, { x: 1, y: 1 }])),
    'and two is a path, not a region');
  ok(near(regionArea(SQ), 10000), 'its area is geometry.js\'s');
  ok(near(regionArea(L), 6400),
    'and the L\'s is 10,000 less the 60 x 60 notch — not its bounding box');
  const b = regionBounds(SQ);
  ok(b.minX === 0 && b.maxX === 100 && b.w === 100, 'its extent is geometry.js\'s bbox');
  ok(regionContains(SQ, { x: 50, y: 50 }) && !regionContains(SQ, { x: 150, y: 50 }),
    'and it can say what is inside it');
  ok(!regionContains(L, { x: 80, y: 80 }),
    'including that an L\'s notch is OUTSIDE it — which a bounding box cannot say');
  ok(regionOrtho() === true, 'a region move takes the shift lock, like a path');
}

// ---------------------------------------------------------------------------
say('WINDING — fixed on the way in, because the inward normal depends on it');
{
  /* SQ WAS GIVEN CLOCKWISE. `ensureCCW` turns it round, and without that
     `clampInside`'s left-hand normal points OUT of the region it is supposed to
     be holding things in — for every edge, silently. */
  const pushed = clampInside({ x: -20, y: 50 }, SQ, { gap: 5 });
  ok(regionContains(SQ, pushed),
    'a point outside a clockwise-given region is pushed INSIDE it, not further out');
  ok(near(pushed.x, 5) && near(pushed.y, 50), 'to exactly the gap off the wall it met');
}

// ---------------------------------------------------------------------------
say('INSIDE — the third constraint kind, and the limit is MET not announced');
{
  ok(clearanceIn(SQ, { x: 10, y: 50 }) === 10, 'how far inside a point is...');
  ok(clearanceIn(SQ, { x: -10, y: 50 }) === -10, '...and negative when it is outside');

  const free = { x: 50, y: 50 };
  ok(clampInside(free, SQ, { gap: 5 }) === free,
    'an already-legal point is returned UNTOUCHED — the same object, not a copy '
    + 'nudged for no reason');

  const held = clampInside({ x: 50, y: 1 }, SQ, { gap: 5 });
  ok(near(held.y, 5) && near(held.x, 50),
    'one too close stops AGAINST the wall — only the offending component is taken away');
  const slid = clampInside({ x: 80, y: -30 }, SQ, { gap: 5 });
  ok(near(slid.y, 5) && near(slid.x, 80),
    'so pushed at a wall it SLIDES along it, which is what a clamp should feel like');
  ok(clampInside({ x: 1, y: 1 }, null) !== null, 'no region, no change');
  ok(near(clampInside({ x: 50, y: 1 }, SQ).y, 1),
    'and with no gap asked for, being inside is enough');
}

// ---------------------------------------------------------------------------
say('INSET — the pocket a cove runs in');
{
  const in10 = insetRegion(SQ, 10);
  ok(in10.length >= 4, 'geometry.js\'s own offset, so a rounded outline keeps its corners');
  const b = regionBounds({ pts: in10 });
  ok(near(b.minX, 10) && near(b.maxX, 90), 'a foot off all round is a foot off all round');
  ok(regionMaxInset(SQ) > 0, 'and how far in it can be taken before it closes on itself');
  ok(insetRegion({ pts: [] }, 10).length === 0, 'nothing in, nothing out');
}

// ---------------------------------------------------------------------------
say('BOUNDARY — its outline is a host, which is how a plate slides round a room');
{
  const h = asPathHost(SQ);
  ok(h.id === 'sq' && h.closed === true,
    'the three fields point.js asks for, and ALWAYS closed — that is what makes it a region');
  const plate = pointOn('sq', 0.25, { id: 'b1' });
  const at = resolvePoint(plate, h);
  ok(at && near(at.x, 100) && near(at.y, 100),
    'a point a quarter round resolves through the point primitive, on the corner it reaches');
  ok(at.ux === 0 && at.uy === 1,
    'with the direction the boundary is heading — which is what aims a plate at the room');
  ok(!regionContains(SQ, { x: at.x + 1, y: at.y + 1 }),
    'and it sits ON the outline, not inside the region');
  ok(asPathHost(makeRegion([{ x: 0, y: 0 }])) === null,
    'and nothing that cannot hold a point');
}

// ---------------------------------------------------------------------------
say('MOVE — the path\'s own translation, so fractions on the boundary survive');
{
  const moved = translateRegion(SQ, { dx: 10, dy: 20 });
  ok(near(moved.pts[0].x, SQ.pts[0].x + 10), 'every point by one delta');
  ok(near(regionArea(moved), regionArea(SQ)), 'its area is unchanged');
  const unit = regionAdapters();
  ok(near(unit.at(SQ).x, SQ.pts[0].x),
    'the anchor is the first point and NOT the centre — an L\'s box centre is in its notch');
  const c = regionCentre(L);
  ok(!regionContains(L, c),
    'which this proves: the L\'s own centre is outside the L, so it is a handle and '
    + 'not a place to put anything');
  ok(near(unit.to(SQ, { x: 5, y: 5 }).pts[0].x, 5), 'and `to` lands it where asked');
}

// ---------------------------------------------------------------------------
say('CARRY — held ON it, and merely INSIDE it, are different questions');
{
  const points = [
    pointOn('sq', 0.25, { id: 'onBoundary' }),
    freePoint({ x: 50, y: 50 }, { id: 'insideIt' }),
    freePoint({ x: 500, y: 500 }, { id: 'elsewhere' }),
  ];
  const spans = [{ id: 'run', on: 'sq', a: 0, b: 0.5 }];
  const dep = dependentsOfRegion(SQ, { points, spans });
  ok(dep.points.join() === 'onBoundary' && dep.spans.join() === 'run',
    'what is HELD on the boundary has no position without it, and goes with it');
  ok(dep.inside.join() === 'insideIt',
    'what merely SITS inside is returned separately — a downlight in a room is not '
    + 'held by the room');
  ok(!dep.points.includes('insideIt') && !dep.inside.includes('elsewhere'),
    'and the two lists do not leak into each other');
}

console.log('\n' + (fail ? `FAILED ${fail}` : 'all good'));
process.exit(fail ? 1 : 0);
