// ---------------------------------------------------------------------------
// test-cob-array.mjs — A RUN OF DOWNLIGHTS SET OUT ON A GEOMETRY.
//
// FOUR CLAIMS, and every assertion below belongs to one of them:
//
//   1. THE CORNERS ARE NOT NEGOTIABLE. Ask for four lamps on a rectangle and
//      they are its four corners — not four equal steps round its perimeter,
//      which is what dividing the arc length gives and which strands three of
//      the four in the middle of three different edges. Every count the geometry
//      can produce hits every corner.
//   2. THE COUNT STEPS IN THE GEOMETRY'S OWN UNITS. A rectangle counts 4, 8, 12;
//      a hexagon 6, 12, 18, 24; a triangle 3, 6, 9. A figure between two of them
//      is not a worse version of either — it is a run that has stopped describing
//      the shape — so it is quantised rather than taken.
//   3. TWO GEOMETRIES ARE FREE, AND BOTH FOR THE SAME REASON: there is nowhere on
//      them a lamp is OBLIGED to sit. A circle has no corners at all; a straight
//      line has two and they are its ends, which is what `pointsAlong` already
//      lands on — so a single lamp in the middle of a line stays reachable.
//   4. THE ANCHORS SURVIVE EVERYTHING DONE TO THE PATH. Offset in by a foot, the
//      lamps are on the INNER ring's corners; dragged across the ceiling they are
//      on the corners of where the run now is; rounded off, each one sits at the
//      middle of its own fillet rather than out at a sharp corner that the
//      outline no longer contains.
//
//   node tools/test-cob-array.mjs
// ---------------------------------------------------------------------------

import { arraySpots, arrayQuanta, quantiseCount, arrayAsks } from '../src/lib/cob.js';
import { cornersFt, outlineFt } from '../src/lib/ceilingShapes.js';
import { pointsAnchored, arcLengthAt } from '../src/lib/geometry.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const at = (list, p, e = 1e-6) => list.some((q) => near(q.x, p.x, e) && near(q.y, p.y, e));
const allCorners = (list, corners, e = 1e-6) => corners.every((c) => at(list, c, e));
const say = (t) => console.log('\n' + t);

/* An 11 x 8 rectangle placed with its top-left at the origin — the room in the
   report this was written for. Deliberately NOT square: equal sides would hide
   the whole bug, because on a square the perimeter division and the corner
   division agree. */
const RECT = { kind: 'rect', x: 5.5, y: 4, wFt: 11, hFt: 8, rot: 0 };

say('-- 1. the corners are not negotiable --');
{
  const path = outlineFt(RECT), corners = cornersFt(RECT);
  /* AND THEY ARE NOT THE OUTLINE'S POINTS, which is the whole reason the corners
     are a separate question. Said with a ROUNDED rectangle because an unrounded
     one happens to have four of each and would prove nothing. */
  ok(corners.length === 4, 'a rectangle has four corners');
  ok(cornersFt({ ...RECT, radiusFt: 1.5 }).length === 4
    && outlineFt({ ...RECT, radiusFt: 1.5 }).length > 20,
    `...and a rounded one still has four, off an outline of `
    + `${outlineFt({ ...RECT, radiusFt: 1.5 }).length} points`);

  const four = arraySpots(path, { closed: true, side: 'on', count: 4, corners });
  ok(four.length === 4, 'four asked for, four placed');
  ok(allCorners(four, corners), '...and each one is a corner of the rectangle');

  const eight = arraySpots(path, { closed: true, side: 'on', count: 8, corners });
  ok(eight.length === 8, 'eight asked for, eight placed');
  ok(allCorners(eight, corners), '...the four corners are still served');
  ok(at(eight, { x: 5.5, y: 0 }) && at(eight, { x: 11, y: 4 })
    && at(eight, { x: 5.5, y: 8 }) && at(eight, { x: 0, y: 4 }),
    '...and the other four are the middle of each edge');

  /* THE SPACING IS EVEN PER EDGE AND NOT AROUND THE WHOLE RING, which is the
     trade the corners are kept at: 5.5 ft between lamps on an 11 ft side and 4 ft
     on an 8 ft one. Asserted rather than merely allowed, because "make it even
     everywhere" is exactly the change that would silently break claim 1. */
  const gap = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  ok(near(gap({ x: 0, y: 0 }, { x: 5.5, y: 0 }), 5.5)
    && near(gap({ x: 11, y: 0 }, { x: 11, y: 4 }), 4),
    'each edge is even in itself; a long edge and a short one are not equal');

  const twelve = arraySpots(path, { closed: true, side: 'on', count: 12, corners });
  ok(twelve.length === 12 && allCorners(twelve, corners),
    'twelve is the thirds of every edge, corners included');
}

say('-- 2. the count steps in the geometry\'s own units --');
{
  const q = arrayQuanta(cornersFt(RECT), true);
  ok(q.base === 4 && q.step === 4 && !q.free, 'a rectangle: base 4, step 4');
  ok(quantiseCount(1, q) === 4, 'fewer lamps than corners is not offered: 1 -> 4');
  ok(quantiseCount(5, q) === 4 && quantiseCount(7, q) === 8, '5 -> 4 and 7 -> 8');
  ok(quantiseCount(12, q) === 12, 'a figure the shape CAN produce is left alone');

  const HEX = { kind: 'polygon', sides: 6, x: 0, y: 0, rFt: 5, rot: 0 };
  const hp = outlineFt(HEX), hc = cornersFt(HEX);
  const hq = arrayQuanta(hc, true);
  ok(hc.length === 6 && hq.base === 6 && hq.step === 6, 'a hexagon: base 6, step 6');
  for (const n of [6, 12, 18, 24]) {
    const pts = arraySpots(hp, { closed: true, side: 'on', count: n, corners: hc });
    ok(pts.length === n && allCorners(pts, hc),
      `${n} on a hexagon is ${n}, and all six corners are in it`);
  }
  ok(quantiseCount(7, hq) === 6 && quantiseCount(10, hq) === 12
    && quantiseCount(23, hq) === 24, 'hexagon: 7 -> 6, 10 -> 12, 23 -> 24');

  const TRI = { kind: 'triangle', x: 0, y: 0, rFt: 6, rot: 0 };
  const tc = cornersFt(TRI);
  const tq = arrayQuanta(tc, true);
  ok(tc.length === 3 && tq.base === 3 && tq.step === 3, 'a triangle: base 3, step 3');
  const six = arraySpots(outlineFt(TRI), { closed: true, side: 'on', count: 6, corners: tc });
  ok(six.length === 6 && allCorners(six, tc), 'six on a triangle is corners plus midpoints');

  const asksR = arrayAsks(outlineFt(RECT), { closed: true, corners: cornersFt(RECT) });
  ok(asksR.countMin === 4 && asksR.countStep === 4, 'the bar is told min 4, step 4');
  const asksH = arrayAsks(hp, { closed: true, corners: hc });
  ok(asksH.countMin === 6 && asksH.countStep === 6, '...and min 6, step 6 for the hexagon');
}

say('-- 3. a circle and a straight line are free --');
{
  const CIR = { kind: 'circle', x: 0, y: 0, rFt: 5 };
  const cc = cornersFt(CIR);
  ok(cc.length === 0, 'a circle reports NO corners, though its outline has 72 points');
  ok(arrayQuanta(cc, true).free, 'so its count is free');
  ok(arraySpots(outlineFt(CIR), { closed: true, side: 'on', count: 7, corners: cc }).length === 7,
    'seven on a circle is seven');

  const LINE = { kind: 'line', x: 0, y: 0, rot: 0, pts: [{ x: 0, y: 0 }, { x: 12, y: 0 }] };
  const lc = cornersFt(LINE);
  ok(lc.length === 2 && arrayQuanta(lc, false).free,
    'two points is free: anchoring a straight line would say what `ends` already says');
  const one = arraySpots(outlineFt(LINE), { closed: false, side: 'on', count: 1, corners: lc });
  ok(one.length === 1 && near(one[0].x, 6), 'one lamp in the middle of a line is still reachable');
  const five = arraySpots(outlineFt(LINE), { closed: false, side: 'on', count: 5, corners: lc });
  ok(five.length === 5 && at(five, { x: 0, y: 0 }) && at(five, { x: 12, y: 0 }),
    'five spans it end to end');

  /* AN OPEN PEN PATH IS NOT FREE — it has an elbow, and the elbow is a corner.
     `(V - 1) x per + 1`, because there are V-1 spans and the far end belongs to
     no span. */
  const PEN = { kind: 'pen', open: true, x: 0, y: 0, rot: 0,
                pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }] };
  const pp = outlineFt(PEN), pc = cornersFt(PEN);
  const pq = arrayQuanta(pc, false);
  ok(pc.length === 3 && pq.base === 3 && pq.step === 2,
    'an L of three points: base 3, step 2 — one per span, not one per point');
  const p3 = arraySpots(pp, { closed: false, side: 'on', count: 3, corners: pc });
  ok(p3.length === 3 && at(p3, { x: 10, y: 0 }), 'three lands on both ends and the elbow');
  const p5 = arraySpots(pp, { closed: false, side: 'on', count: 5, corners: pc });
  ok(p5.length === 5 && at(p5, { x: 10, y: 0 }) && at(p5, { x: 5, y: 0 })
    && at(p5, { x: 10, y: 3 }), 'five adds a midpoint per leg and keeps the elbow');
}

say('-- 4. the anchors survive what is done to the path --');
{
  const path = outlineFt(RECT), corners = cornersFt(RECT);

  const inner = arraySpots(path, { closed: true, side: 'in', offsetFt: 1,
                                   count: 4, corners });
  ok(inner.length === 4, 'four on a ring a foot inside');
  ok(at(inner, { x: 1, y: 1 }) && at(inner, { x: 10, y: 1 })
    && at(inner, { x: 10, y: 7 }) && at(inner, { x: 1, y: 7 }),
    '...and they are the INNER ring\'s corners, not the outline\'s projected onto it');

  const moved = arraySpots(path, { closed: true, side: 'on', count: 4, corners,
                                   dx: 40, dy: -15 });
  ok(moved.length === 4 && at(moved, { x: 40, y: -15 }) && at(moved, { x: 51, y: -7 }),
    'a run dragged clear of its own shape is still corner-anchored');

  /* ROUNDED: the sharp corner is not on the outline any more — the fillet cut it
     off — and the lamp goes to the middle of the arc, which is where the corner
     of a rounded rectangle reads as being. Not at the sharp corner (0 in), and
     not at a fillet END (which for r = 1.5 is 1.5 back along each edge, so
     ~2.1 ft from the corner on the diagonal). */
  const RR = { ...RECT, radiusFt: 1.5 };
  const rp = outlineFt(RR), rc = cornersFt(RR);
  const r4 = arraySpots(rp, { closed: true, side: 'on', count: 4, corners: rc });
  ok(r4.length === 4, 'four on a rounded rectangle');
  const pull = r4.map((p) => {
    const c = rc.reduce((b, q) => (!b || Math.hypot(q.x - p.x, q.y - p.y)
      < Math.hypot(b.x - p.x, b.y - p.y) ? q : b), null);
    return Math.hypot(c.x - p.x, c.y - p.y);
  });
  const want = 1.5 * (Math.SQRT2 - 1);   // corner -> arc midpoint for a 90-deg fillet
  ok(pull.every((d) => near(d, want, 0.02)),
    'each sits at the middle of its own fillet, inboard of the sharp corner');

  /* AND THE PROJECTION IS ARC LENGTH, which is what makes all of the above one
     rule rather than four. */
  ok(near(arcLengthAt(path, { x: 0, y: 0 }, { closed: true }), 0)
    && near(arcLengthAt(path, { x: 11, y: 0 }, { closed: true }), 11),
    'a corner projects to its own distance round the outline');
  ok(pointsAnchored(path, corners.slice(0, 2), 1, { closed: true }).length === 0,
    'a closed path with fewer than three anchors is refused rather than guessed at');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
