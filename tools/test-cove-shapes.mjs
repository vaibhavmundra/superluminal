// ---------------------------------------------------------------------------
// test-cove-shapes.mjs — a cove somebody DREW.
//
// Five claims, and every assertion below belongs to one of them:
//
//   1. THE PRIMITIVES ARE THE SHAPES THEY CLAIM TO BE. A square is square to
//      the drawing and not a diamond, a triangle points up, a rectangle spans
//      corner to corner and everything else spans from the middle.
//   2. THE OFFSET IS A REAL OFFSET. The tape is three inches outside the line
//      everywhere — on the flats AND at the corners — which for a polygon means
//      its circumradius grows by more than three inches, and for a sharp corner
//      means an arc rather than a longer point.
//   3. THE PEN CLOSES ITSELF. Whether or not the last click landed on the first
//      point, and without leaving a zero-length edge behind for the offset and
//      the fillet to trip over.
//   4. THE GRID IS CUT ON THE BOUNDING BOX. Inside the shape's rectangle is one
//      grid, outside it is the room's own, and no cell straddles the line —
//      which is what a cove does, said about a circle.
//   5. THE SCHEDULE BILLS THE OUTLINE AND NOT THE RECTANGLE. A round cove is
//      the tape that goes round it, which is a fifth less than its bounding
//      square's perimeter.
//
//   node tools/test-cove-shapes.mjs
// ---------------------------------------------------------------------------

import { shapeFromDrag, penShape, outlineFt, coveRectFt, bboxFt, pathLengthFt,
         maxRadiusFt, roundable, bigEnough, sidesOf, MIN_SPAN_FT,
         resizeShape, handlesFor, frameFt, stretchy, clampCoveMove }
  from '../src/lib/ceilingShapes.js';
import { designChunking, planCeilingDesign, optionsForChunk, chunkKey }
  from '../src/lib/ceilingDesign.js';
import { STRIP_OFFSET_FT, coveHostFor, bandBetween, bandFixtureFor, HALO,
         COVE_GAP_FT, coveClearOfOutline } from '../src/lib/cove.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const say = (t) => console.log('\n' + t);
const opt = PLAN_OPTIONS;
const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

// --- 1. the primitives ------------------------------------------------------
say('1. the primitives are the shapes they claim to be');
{
  const r = shapeFromDrag('rect', { x: 4, y: 3 }, { x: 14, y: 9 });
  const rb = coveRectFt(r);
  ok(near(rb.x0, 4) && near(rb.y0, 3) && near(rb.x1, 14) && near(rb.y1, 9),
    'a rectangle spans corner to corner, from the press to the pointer');

  const rs = shapeFromDrag('rect', { x: 4, y: 3 }, { x: 14, y: 9 }, { uniform: true });
  const rsb = coveRectFt(rs);
  ok(near(rsb.x1 - rsb.x0, rsb.y1 - rsb.y0) && near(rsb.x0, 4) && near(rsb.y0, 3),
    '...and Shift squares it up about the corner it was pressed at');

  const q = shapeFromDrag('square', { x: 10, y: 10 }, { x: 10 + 5 * Math.SQRT2, y: 10 });
  const qb = coveRectFt(q);
  ok(near(qb.x1 - qb.x0, 10, 0.02) && near(qb.y1 - qb.y0, 10, 0.02),
    'a square is square to the drawing and not a diamond');
  ok(near((qb.x0 + qb.x1) / 2, 10) && near((qb.y0 + qb.y1) / 2, 10),
    '...and it is centred on the press, because it is spanned from the middle');

  const t = shapeFromDrag('triangle', { x: 0, y: 0 }, { x: 0, y: -6 });
  const tp = outlineFt(t);
  ok(near(Math.min(...tp.map((p) => p.y)), -6, 0.02),
    'a triangle points up: its apex is the radius above the centre');
  ok(near(pathLengthFt(tp), 3 * 6 * Math.sqrt(3), 0.02),
    '...and its perimeter is the equilateral one for that circumradius');

  const c = shapeFromDrag('circle', { x: 0, y: 0 }, { x: 6, y: 0 });
  ok(near(pathLengthFt(outlineFt(c)), 2 * Math.PI * 6, 0.02),
    'a circle is a circle, to within the polyline that samples it');

  const h = shapeFromDrag('polygon', { x: 0, y: 0 }, { x: 5, y: 0 }, { sides: 8 });
  ok(sidesOf(h) === 8 && outlineFt(h).length === 8,
    'a polygon has the number of sides it was asked for');
  ok(!roundable(c) && roundable(h) && roundable(t),
    'only the circle refuses a corner radius — it has no corners');
}

// --- 2. the offset ----------------------------------------------------------
say('2. the tape sits three inches outside the line, everywhere');
{
  const g = STRIP_OFFSET_FT;
  const c = shapeFromDrag('circle', { x: 0, y: 0 }, { x: 6, y: 0 });
  ok(near(pathLengthFt(outlineFt(c, g)), 2 * Math.PI * (6 + g), 0.03),
    "a circle's tape is a circle three inches bigger");

  const t = shapeFromDrag('triangle', { x: 0, y: 0 }, { x: 0, y: -6 });
  const tb = bboxFt(t), tgb = bboxFt(t, g);
  ok(near(tgb.y1 - tb.y1, g, 0.01),
    'the flat side of a triangle moves out by exactly the offset');
  // A SHARP CORNER OFFSETS TO AN ARC, so the perimeter grows by the full turn
  // round the shape — 2*PI*g — and not by the amount a scaled-up triangle would.
  ok(near(pathLengthFt(outlineFt(t, g)),
          pathLengthFt(outlineFt(t)) + 2 * Math.PI * g, 0.03),
    '...and the corners round off, so the run grows by one full turn of arc');

  const r = { ...shapeFromDrag('rect', { x: 0, y: 0 }, { x: 10, y: 6 }), radiusFt: 2 };
  ok(near(pathLengthFt(outlineFt(r)), 2 * (10 - 4) + 2 * (6 - 4) + 2 * Math.PI * 2, 0.03),
    'a rounded rectangle is two straights and four quarter-circles');
  ok(near(maxRadiusFt(r), 3),
    '...and the radius is capped at half the shorter side, which is a stadium');
}

// --- 3. the pen -------------------------------------------------------------
say('3. the pen closes the shape whether or not you did');
{
  const open = penShape([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }]);
  const shut = penShape([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 },
                         { x: 0, y: 0 }]);
  ok(open && shut && open.pts.length === shut.pts.length,
    'a path closed by hand and one left open come out as the same shape');
  ok(near(pathLengthFt(outlineFt(open)), 32),
    '...and it is the closed square, 32 ft round');
  ok(penShape([{ x: 0, y: 0 }, { x: 4, y: 0 }]) === null,
    'two points is not a shape and is refused rather than half-made');
  const dup = penShape([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }]);
  ok(dup && dup.pts.length === 3,
    'a doubled click leaves no zero-length edge for the offset to trip over');
  ok(near(pathLengthFt(outlineFt(open, STRIP_OFFSET_FT)),
          32 + 2 * Math.PI * STRIP_OFFSET_FT, 0.03),
    'a traced outline offsets like every other one: the flats out, the corners round');
  ok(!bigEnough(shapeFromDrag('circle', { x: 0, y: 0 }, { x: MIN_SPAN_FT / 4, y: 0 }))
     && bigEnough(shapeFromDrag('circle', { x: 0, y: 0 }, { x: 4, y: 0 })),
    'a drag that wobbled is not a shape; a real one is');
}

// --- 4 and 5. the engine ----------------------------------------------------
//
// The room, the shape and the wiring App does between them: the shape's
// rectangle goes in as a HOLE so the chunker cuts the room around it, and comes
// back as a chunk of its own carrying the cove already decided.
function layWithShape(polygon, shape) {
  const rect = coveRectFt(shape);
  const hostBox = coveHostFor(rect, polygon);
  const outline = outlineFt(shape);
  const stripOutline = outlineFt(shape, STRIP_OFFSET_FT);
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  const hw = hostBox.x1 - hostBox.x0, hh = hostBox.y1 - hostBox.y0;
  const sx = stripOutline.map((q) => q.x), sy = stripOutline.map((q) => q.y);
  const line = { ...rect, w, h, area: w * h };
  const host = { ...hostBox, w: hw, h: hh, area: hw * hh };
  const chunk = {
    ...hostBox, w: hw, h: hh, key: chunkKey(hostBox), shapeId: 'shape-1',
    coveGeo: {
      offset: 0, host, line,
      strip: { x0: Math.min(...sx), y0: Math.min(...sy),
               x1: Math.max(...sx), y1: Math.max(...sy),
               w: Math.max(...sx) - Math.min(...sx), h: Math.max(...sy) - Math.min(...sy) },
      band: bandBetween(host, line).map((b) => ({
        ...b, fixture: bandFixtureFor(Math.min(b.w, b.h)) })),
      perimeterFt: pathLengthFt(stripOutline),
      chunkAreaSqft: hw * hh, innerAreaSqft: w * h, bandAreaSqft: hw * hh - w * h,
      smallerFt: Math.min(hw, hh),
      shapeId: 'shape-1', outline, stripOutline,
    },
  };
  const design = designChunking(polygon, [hostBox], opt, []);
  return {
    rect, host: hostBox, chunk, design,
    built: planCeilingDesign({
      polygonFt: polygon, fixturesFt: [], zonesFt: [], builtZonesFt: [hostBox],
      designChunks: [...design.chunks, chunk],
      picks: { [chunk.key]: 'cove' }, opt,
    }),
  };
}

say('4. the grid is cut on the rectangle the shape fits in');
{
  const room = box(30, 24);
  // A circle 12 ft across in the middle of a 30 x 24 room.
  const circle = shapeFromDrag('circle', { x: 15, y: 12 }, { x: 21, y: 12 });
  const { rect, host, chunk, design, built } = layWithShape(room, circle);

  ok(near(rect.x1 - rect.x0, 12, 0.02) && near(rect.y1 - rect.y0, 12, 0.02),
    'a circle 12 ft across is a 12 ft SQUARE as far as the engine is concerned');

  ok(optionsForChunk(chunk).length === 1 && optionsForChunk(chunk)[0].id === 'cove',
    'a drawn shape offers one ceiling design and no other — it IS the decision');

  ok(design.chunks.every((c) => c.x1 <= host.x0 + 1e-6 || c.x0 >= host.x1 - 1e-6
                             || c.y1 <= host.y0 + 1e-6 || c.y0 >= host.y1 - 1e-6),
    'the ceiling OUTSIDE it is chunked around its RING, not around the shape');
  ok(design.chunks.length >= 4,
    '...and a shape in the middle of a room leaves the four pieces round it');

  const part = built.parts.find((p) => p.key === chunk.key);
  ok(part && part.kind === 'cove' && part.pick === 'cove',
    'the shape chunk comes back as a cove');
  ok(built.plan.ok, 'the whole space lays out');

  const mine = built.plan.chunks.filter((c) => c.design === chunk.key);
  const inner = mine.filter((c) => c.cove === 'inner');
  const bandPieces = mine.filter((c) => c.cove === 'band');
  ok(inner.length === 1,
    'the shape contributes exactly one INNER chunk to the grid');
  ok(near(inner[0].x0, rect.x0) && near(inner[0].x1, rect.x1)
     && near(inner[0].y0, rect.y0) && near(inner[0].y1, rect.y1),
    "...and it is the shape's own rectangle, not an inset of it");
  /* AND NO RING, because this circle is six feet or more from every wall. The
     ring is a chunking device — see HALO — so where the ceiling around a cove
     is wide enough to grid on its own, there is nothing for it to do. */
  ok(bandPieces.length === 0,
    'a cove with six feet of ceiling on every side gets no ring at all');

  // No cell may straddle the line, which is the whole claim "the cove cuts the
  // grid" makes. Every chunk is either wholly inside the rectangle or wholly out.
  const straddles = built.plan.chunks.filter((c) => {
    const inX = c.x0 >= rect.x0 - 1e-6 && c.x1 <= rect.x1 + 1e-6;
    const inY = c.y0 >= rect.y0 - 1e-6 && c.y1 <= rect.y1 + 1e-6;
    const outX = c.x1 <= rect.x0 + 1e-6 || c.x0 >= rect.x1 - 1e-6;
    const outY = c.y1 <= rect.y0 + 1e-6 || c.y0 >= rect.y1 - 1e-6;
    return !((inX && inY) || outX || outY);
  });
  ok(straddles.length === 0, 'no chunk of the grid straddles the cove line');

  /* THE POINT OF THE WHOLE RING: nothing lands in it. NOT "nothing lands in the
     host" — the ladder may well light the ceiling INSIDE the cove line, and on
     this room it does. The ring is the strip between the line and the host, and
     that is the piece the cove has been made answerable for. */
  const inRing = (l) =>
    l.x > host.x0 - 1e-6 && l.x < host.x1 + 1e-6
    && l.y > host.y0 - 1e-6 && l.y < host.y1 + 1e-6
    && !(l.x > rect.x0 + 1e-6 && l.x < rect.x1 - 1e-6
         && l.y > rect.y0 + 1e-6 && l.y < rect.y1 - 1e-6);
  ok(!built.plan.lights.some(inRing),
    'and NO ambient fitting lands in the ring — which is the whole point of it');
  const nearest = Math.min(...built.plan.lights
    .filter((l) => !(l.x > rect.x0 && l.x < rect.x1 && l.y > rect.y0 && l.y < rect.y1))
    .map((l) => Math.max(rect.x0 - l.x, l.x - rect.x1, rect.y0 - l.y, l.y - rect.y1)));
  ok(nearest >= 2,
    `the closest ambient fitting outside the line is ${nearest.toFixed(1)} ft off it, `
    + `not the ${opt.coveOutside} ft the dead band alone would have allowed`);

  // And nothing crowds it: the planner is handed the line and keeps clear.
  const tooClose = built.plan.lights.filter((l) => {
    const dx = Math.max(rect.x0 - l.x, l.x - rect.x1, 0);
    const dy = Math.max(rect.y0 - l.y, l.y - rect.y1, 0);
    const outside = dx > 0 || dy > 0;
    const d = outside ? Math.hypot(dx, dy)
      : Math.min(l.x - rect.x0, rect.x1 - l.x, l.y - rect.y0, rect.y1 - l.y);
    return outside ? d < opt.coveOutside - 1e-6 : d < opt.coveInside - 1e-6;
  });
  ok(tooClose.length === 0,
    'and nothing crowds the line — the clearances a cove asks for are enforced');
}

say('5. the schedule bills the outline, not the rectangle');
{
  const room = box(30, 24);
  const circle = shapeFromDrag('circle', { x: 15, y: 12 }, { x: 21, y: 12 });
  const { built } = layWithShape(room, circle);
  const rep = built.coves[0];
  const tape = 2 * Math.PI * (6 + STRIP_OFFSET_FT);
  ok(near(rep.perimeterFt, tape, 0.05),
    `a round cove is ${tape.toFixed(1)} ft of tape, the circle's own run`);
  ok(rep.perimeterFt < 4 * (12 + 2 * STRIP_OFFSET_FT) - 5,
    "...which is well short of its bounding square's perimeter — the point of the shape");
  ok(near(rep.chunkAreaSqft, rep.innerAreaSqft),
    'with no ring, the ceiling it answers for is the shape\'s own box and no more');
  /* WITH a ring, the ring counts — which is what stops one coming free. */
  const near2 = layWithShape(box(30, 24), shapeFromDrag(
    'rect', { x: 3, y: 3 }, { x: 20, y: 16 }));
  ok(near2.host.x0 < 3 - 1e-6,
    'a cove three feet from a wall does get a ring');
  ok(near2.built.coves[0].chunkAreaSqft > near2.built.coves[0].innerAreaSqft,
    '...and the ceiling it answers for then includes it, so a ring is never free');
  ok(rep.shapeId === 'shape-1' && rep.outline?.length && rep.stripOutline?.length,
    'the report carries the outline through, so the drawing can draw the circle');
  ok(near(pathLengthFt(rep.stripOutline), rep.perimeterFt, 1e-6),
    "...and the length billed is that outline's own length");

  // A TRIANGLE, TO SHOW THE RECTANGLE IS NOT THE SHAPE. Its bounding box is a
  // good deal bigger than the triangle, and the grid is cut on the box.
  const tri = shapeFromDrag('triangle', { x: 15, y: 12 }, { x: 15, y: 5 });
  const t = layWithShape(room, tri);
  ok(t.built.plan.ok && t.built.coves.length === 1,
    'a triangular cove lays out too');
  ok(near(t.built.coves[0].perimeterFt,
          pathLengthFt(outlineFt(tri, STRIP_OFFSET_FT)), 1e-6),
    "...and is billed by its own three sides, not by its bounding box's four");
  ok(t.built.coves[0].chunkAreaSqft > 0.99 * (t.rect.x1 - t.rect.x0) * (t.rect.y1 - t.rect.y0),
    'the ceiling it is responsible for is the RECTANGLE, which is what got gridded');
}

// --- 6. resizing one already on the drawing ---------------------------------
say('6. the side opposite the grip stays nailed down');
{
  const BR = { sx: 1, sy: 1 }, TL = { sx: -1, sy: -1 }, RIGHT = { sx: 1, sy: 0 };
  const r = { ...shapeFromDrag('rect', { x: 0, y: 0 }, { x: 10, y: 6 }), radiusFt: 1 };

  const a = frameFt(resizeShape(r, BR, { x: 20, y: 14 }));
  ok(near(a.x0, 0) && near(a.y0, 0) && near(a.x1, 20) && near(a.y1, 14),
    'drag the bottom-right and the top-left does not move');

  const b = frameFt(resizeShape(r, TL, { x: -4, y: -4 }));
  ok(near(b.x1, 10) && near(b.y1, 6) && near(b.x0, -4) && near(b.y0, -4),
    '...and the other way round: drag the top-left, the bottom-right holds');

  const c = frameFt(resizeShape(r, RIGHT, { x: 16, y: 99 }));
  ok(near(c.x1 - c.x0, 16) && near(c.y1 - c.y0, 6),
    'an edge grip moves one dimension and says nothing about the other');

  // THE ANCHOR IS RE-READ OFF THE SHAPE EVERY FRAME — see resizeShape — so the
  // same pointer applied again and again has to be a no-op. If it drifts, a
  // resize creeps for as long as the pointer is held still.
  let z = r;
  for (let i = 0; i < 8; i++) z = resizeShape(z, BR, { x: 20, y: 14 });
  const zf = frameFt(z);
  ok(near(zf.x0, 0) && near(zf.y0, 0) && near(zf.x1, 20) && near(zf.y1, 14),
    'holding the pointer still resizes to the same box however many frames pass');

  ok(near(resizeShape(r, BR, { x: 20, y: 14 }).radiusFt, 1),
    'the corner radius survives a resize — it is a property, not a shape');
  const tiny = resizeShape(r, BR, { x: 3, y: 3 });
  ok(tiny.radiusFt <= maxRadiusFt(tiny) + 1e-9,
    '...clamped only where the geometry forces it, on a shape dragged down small');
  const floor = frameFt(resizeShape(r, BR, { x: 0.01, y: 0.01 }));
  ok(near(floor.x1 - floor.x0, MIN_SPAN_FT) && near(floor.y1 - floor.y0, MIN_SPAN_FT),
    '...and nothing can be dragged smaller than the smallest shape there is');
}

say('...and each shape stretches only as far as it can be that shape');
{
  const BR = { sx: 1, sy: 1 };
  const q = shapeFromDrag('square', { x: 5, y: 5 }, { x: 5 + 5 * Math.SQRT2, y: 5 });
  const stretched = resizeShape(q, BR, { x: 20, y: 6 });
  const sf = frameFt(stretched);
  ok(stretched.kind === 'rect' && !near(sf.x1 - sf.x0, sf.y1 - sf.y0),
    'a square stretched becomes a RECTANGLE rather than refusing the drag');
  const held = resizeShape(q, BR, { x: 20, y: 6 }, { uniform: true });
  const hf = frameFt(held);
  ok(held.kind === 'square' && near(hf.x1 - hf.x0, hf.y1 - hf.y0),
    '...and Shift keeps it square');

  const c = shapeFromDrag('circle', { x: 0, y: 0 }, { x: 6, y: 0 });
  const cf = frameFt(resizeShape(c, BR, { x: 20, y: 8 }));
  ok(near(cf.x1 - cf.x0, cf.y1 - cf.y0),
    'a circle cannot be squashed — this model has no ellipse to squash it into');
  ok(handlesFor(c).length === 4 && handlesFor(c).every((h) => h.sx && h.sy),
    '...so it offers corner grips only: an edge grip would do the corner’s job');

  const h = shapeFromDrag('polygon', { x: 0, y: 0 }, { x: 5, y: 0 }, { sides: 6 });
  const hg = resizeShape(h, BR, { x: 20, y: 6 });
  ok(hg.kind === 'polygon' && sidesOf(hg) === 6 && !stretchy(h),
    'a hexagon scales and stays a hexagon — unequal sides would not be one');

  const t = shapeFromDrag('triangle', { x: 10, y: 10 }, { x: 10, y: 4 });
  const t0 = frameFt(t);
  const t1 = frameFt(resizeShape(t, BR, { x: t0.x0 + 20, y: t0.y0 + 20 }));
  ok(near(t1.x0, t0.x0) && near(t1.y0, t0.y0),
    "a triangle's anchor holds too, though its centre is not the middle of its box");

  const pen = { ...penShape([{ x: 0, y: 0 }, { x: 8, y: 0 },
                             { x: 8, y: 8 }, { x: 0, y: 8 }]), radiusFt: 1 };
  const pf = frameFt(resizeShape(pen, BR, { x: 16, y: 4 }));
  ok(stretchy(pen) && near(pf.x1 - pf.x0, 16) && near(pf.y1 - pf.y0, 4),
    'a traced path squashes on both axes — it has as many dimensions as points');
  ok(handlesFor(pen).length === 8,
    '...and offers edge grips as well, because its axes really do move apart');
}

say('...and a resized cove is still the cove the engine reads');
{
  const room = box(30, 24);
  const grown = resizeShape(
    shapeFromDrag('rect', { x: 8, y: 6 }, { x: 16, y: 12 }), { sx: 1, sy: 1 },
    { x: 22, y: 18 });
  const { rect, built } = layWithShape(room, grown);
  ok(near(rect.x0, 8) && near(rect.y0, 6) && near(rect.x1, 22) && near(rect.y1, 18),
    'the grid is cut on the box the grips left, not on the one it started at');
  /* AND THE CEILING IT ANSWERS FOR IS THE HOST, not the box the grips left —
     the ring counts. `innerAreaSqft` is the box; `chunkAreaSqft` is the box plus
     its ring, and it is the second that `required` is computed from. */
  ok(built.plan.ok && built.coves.length === 1
     && near(built.coves[0].innerAreaSqft, 14 * 12, 0.5),
    '...and the cove reports the resized box as the ceiling inside its line');
  /* AND NO RING ON THIS ONE, because the grips left it eight feet from the near
     wall and six from the top — see HALO. The ring follows the ceiling around a
     cove, not the cove, so resizing one can gain or lose its ring entirely. */
  ok(near(built.coves[0].chunkAreaSqft, built.coves[0].innerAreaSqft),
    '...and with six feet clear on every side, no ring on top of it');
}

// --- 7. the ring a drawn cove owns -----------------------------------------
say('7. the ring: what it is for, and therefore how far it reaches');
{
  const room = box(60, 45);
  const at = (gap, w = 14, h = 10) =>
    coveHostFor({ x0: gap, y0: gap, x1: gap + w, y1: gap + h }, room);
  const ring = (gap, w, h) => gap - at(gap, w, h).x0;

  /* THE RING IS A CHUNKING DEVICE. It exists so that no strip of ceiling is
     left that is too narrow to grid, and every figure follows from that. */
  ok(near(ring(0.5), 0.5) && near(ring(4), 4) && near(ring(5.9), 5.9),
    `a wall inside ${HALO.wall} ft is reached exactly, whatever the distance`);
  ok(near(ring(6), 0) && near(ring(8), 0) && near(ring(12), 0),
    `a wall ${HALO.wall} ft out or further gets NO ring — the strip grids itself`);
  ok(near(at(6).x0, 0) === false && near(6 - ring(6), 6),
    '...leaving the whole six feet to the ordinary grid');

  /* AND THERE IS NO WIDTH IN BETWEEN. That is the whole claim: either the ring
     eats the strip, or the strip is big enough to be a piece of ceiling. A
     partial reach is exactly how the old rule left two-foot chunks with rows of
     downlights in them. */
  let sliver = null;
  for (let gap = 0.25; gap <= 14; gap += 0.25) {
    const left = at(gap).x0;
    if (left > 1e-6 && left < HALO.wall - 1e-6) sliver = gap;
  }
  ok(sliver === null,
    'no distance from a wall leaves a strip between nothing and six feet');

  /* IT DOES NOT DEPEND ON THE COVE'S SIZE, which is what it used to do. */
  const sizes = [[6, 5], [14, 12], [25, 20], [40, 30]];
  ok(sizes.every(([w, h]) => near(ring(12, w, h), 0)),
    'in open ceiling no cove gets a ring, however big or small it is');
  ok(sizes.every(([w, h]) => near(ring(3, w, h), 3)),
    '...and against a wall three feet out they all take the same three feet');

  /* A HOLE IS A SHORTER REACH THAN A WALL: a boundary inside the room is not
     the end of the ceiling. */
  const wc = { x0: 0, y0: 0, x1: 8, y1: 45 };
  const beside = (gap) => {
    const b = { x0: 8 + gap, y0: 10, x1: 8 + gap + 14, y1: 24 };
    return (8 + gap) - coveHostFor(b, room, { blocks: [wc] }).x0;
  };
  ok(near(beside(3), 3), `a hole ${HALO.block} ft out or nearer is reached`);
  ok(near(beside(5), 0),
    `...and one past ${HALO.block} ft is not — that strip is the room's, not the cove's`);

  /* AN L-SHAPED ROOM'S NOTCH IS STILL A WALL. */
  const L = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 14 },
             { x: 16, y: 14 }, { x: 16, y: 24 }, { x: 0, y: 24 }];
  const hl = coveHostFor({ x0: 19, y0: 9, x1: 26, y1: 12 }, L);
  ok(hl.y1 <= 14 + 1e-6, 'the ring stops at the notch rather than growing through it');

  /* TWO COVES KEEP SIX INCHES BETWEEN THEM, AT EVERY SPACING. */
  const wide = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 24 }, { x: 0, y: 24 }];
  for (const d of [8, 5, 3, 1.5, 0.8]) {
    const a = { x0: 6, y0: 8, x1: 16, y1: 16 };
    const b = { x0: 16 + d, y0: 8, x1: 26 + d, y1: 16 };
    const ha = coveHostFor(a, wide, { avoid: [b] });
    const hb = coveHostFor(b, wide, { avoid: [a, ha] });
    ok(hb.x0 - ha.x1 >= COVE_GAP_FT - 1e-6,
      `boxes ${d} ft apart leave ${(hb.x0 - ha.x1).toFixed(2)} ft between the rings`);
  }

  /* AND WHEN THERE IS A RING, IT IS STILL FOUR PIECES THAT TILE IT. */
  const line0 = { x0: 3, y0: 3, x1: 20, y1: 15 };
  const h0 = coveHostFor(line0, room);
  if (h0.x0 < line0.x0) {
    const line = { ...line0, w: line0.x1 - line0.x0, h: line0.y1 - line0.y0 };
    const host = { ...h0, w: h0.x1 - h0.x0, h: h0.y1 - h0.y0 };
    const pieces = bandBetween(host, line);
    /* FEWER THAN FOUR WHERE THE RING IS PARTIAL, and that is right rather than
       a shortfall: this cove has walls within reach on two sides only, so two of
       the four rectangles have zero extent and are dropped. A zero-height chunk
       in the planner's list is a chunk with no cells that every downstream count
       then has to special-case. */
    ok(pieces.length === 2, 'a ring on two sides comes out as two pieces, not four');
    ok(pieces.every((p) => bandFixtureFor(Math.min(p.w, p.h)) === 'small-narrow'),
      '...and every piece takes the narrow lamp');
    ok(Math.abs((host.w * host.h - line.w * line.h)
                - pieces.reduce((t, p) => t + p.w * p.h, 0)) < 1e-6,
      'the four pieces tile it exactly — no gap, no overlap');
  }
}

// --- 8. a cove keeps six inches off the walls too ---------------------------
say('8. AND SIX INCHES OFF THE ROOM\'S OWN OUTLINE, FOR THE SAME REASON');
{
  const room = box(30, 24);
  const at = (g) => coveClearOfOutline({ x0: g, y0: 5, x1: g + 12, y1: 16 }, room);
  ok(!at(0.49) && at(COVE_GAP_FT) && at(2),
    `under ${COVE_GAP_FT} ft from a wall is refused; ${COVE_GAP_FT} ft exactly is allowed`);
  ok(!at(0),
    'a cove flush against the plaster leaves no board between the two, and is refused');
  ok(!at(-1),
    '...as is one drawn straight through the wall');

  // THE SAME TEST CATCHES A NOTCH, because it is containment and not four
  // distances: an L-shaped room's inside corner is a wall like any other.
  const L = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 14 },
             { x: 16, y: 14 }, { x: 16, y: 24 }, { x: 0, y: 24 }];
  ok(!coveClearOfOutline({ x0: 12, y0: 10, x1: 22, y1: 20 }, L),
    'and a cove straddling an L-room\'s notch is refused too');
  ok(coveClearOfOutline({ x0: 18, y0: 2, x1: 28, y1: 11 }, L),
    '...where one wholly inside the same room\'s short leg is fine');

  ok(coveClearOfOutline({ x0: 0, y0: 0, x1: 5, y1: 5 }, []),
    'with no outline to measure against, nothing is refused');
}

say('...and a cove being MOVED is stopped at that band rather than refused after');
{
  const G = COVE_GAP_FT;
  const room = box(30, 24);
  const s = shapeFromDrag('rect', { x: 10, y: 8 }, { x: 20, y: 16 });
  const to = (want) => bboxFt({ ...s, ...clampCoveMove(s, want, room, G) });

  const left = to({ x: s.x - 20, y: s.y });
  ok(near(left.x0, G), `pushed at the left wall it stops ${G} ft off it, exactly`);
  ok(near(left.y0, 8) && near(left.y1, 16),
    '...without drifting on the other axis: a clamp holds one direction, not both');

  const corner = to({ x: s.x + 20, y: s.y + 20 });
  ok(near(corner.x1, 30 - G) && near(corner.y1, 24 - G),
    'pushed into a corner it stops the same distance off both walls');

  const free = to({ x: 13, y: 10 });
  ok(near(free.x0, 8) && near(free.y0, 6),
    'and a move that breaks no rule is passed through untouched');

  /* IT SLIDES, WHICH IS THE POINT OF CLAMPING RATHER THAN REFUSING — including
     along a wall the room's bounding box knows nothing about. */
  const L = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 14 },
             { x: 16, y: 14 }, { x: 16, y: 24 }, { x: 0, y: 24 }];
  const inLeg = shapeFromDrag('rect', { x: 2, y: 16 }, { x: 12, y: 22 });
  const slid = bboxFt({ ...inLeg, ...clampCoveMove(inLeg, { x: inLeg.x + 20, y: inLeg.y }, L, G) });
  ok(near(slid.x1, 16 - G),
    `pushed at an L's notch it slides up to it and stops ${G} ft short, not at zero`);

  const upRight = bboxFt({ ...inLeg,
    ...clampCoveMove(inLeg, { x: inLeg.x + 20, y: inLeg.y - 20 }, L, G) });
  ok(near(upRight.x1, 30 - G) && near(upRight.y0, G),
    '...and pushed up AND right it rounds the notch into the other leg');

  // Nowhere legal to go at all is a shape that stays where it is.
  const huge = shapeFromDrag('rect', { x: 0, y: 0 }, { x: 30, y: 24 });
  const stuck = clampCoveMove(huge, { x: huge.x + 5, y: huge.y }, room, G);
  ok(near(stuck.x, huge.x) && near(stuck.y, huge.y),
    'a cove too big for its room is not squeezed to fit — it does not move');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
