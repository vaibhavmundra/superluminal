// ---------------------------------------------------------------------------
// cove.js — a cove ceiling: WHAT ONE IS, and the geometry of drawing it.
//
// WHERE IT IS DECIDED IS NOT HERE ANY MORE. A cove is one of the ceiling
// designs a CHUNK can have, the chunks come from the room outline, and the
// choosing — along with the ladder that works out how much light the strip has
// already accounted for — lives in ceilingDesign.js. This file is the detail
// itself: how far the band is set in, what it is lit with, where the tape sits,
// and the four pieces of band a cove leaves round its line. Anybody with a
// rectangle can draw one.
//
// A COVE IS NOT A FITTING YOU PLACE. It is a change to the CEILING: a band is
// dropped around the perimeter of the space, a pocket runs along the inside
// edge of that band, and a strip in the pocket washes the higher ceiling in the
// middle. Everything this file does follows from that one fact.
//
//   * The cove line is a rectangle, always, however the space is shaped. A
//     cove that followed an L-shaped room round its inside corner is a detail
//     nobody builds — the band is set out square and the room is squared up to
//     it — so the cove takes ONE CHUNK of the ceiling and insets it. An L is
//     two chunks and can therefore carry two coves, each set out square, which
//     is exactly what would be built.
//
//   * The inset comes from a table, not from a formula. It is a joinery figure:
//     how wide the dropped band has to be to hide a pocket, carry a service
//     void and still read as a band rather than as a mistake. It scales with
//     the room in steps because that is how it is drawn. See OFFSET_STEPS.
//
//   * THE COVE LINE CUTS THE GRID, the way the room outline does. Inside it is
//     one grid, outside it is another, and no cell straddles the line. That is
//     what makes "put the downlights inside the cove" a statement about cells
//     rather than a filter applied afterwards.
//
//   * AND IT IS A LINE NOTHING MAY CROWD. Two feet clear on the room side, one
//     foot on the pocket side. A downlight closer than that on the inside
//     flattens the cove's own glow; one closer on the outside is a fitting in
//     the pocket's shadow. The planner enforces this — see `opt.coves`.
//
// THE LADDER, WHICH IS RUN IN ceilingDesign.js AND EXPLAINED HERE because it
// is a fact about coves rather than about the code that climbs it. A cove is an
// ambient source with a fixed output — 120 lm per foot of run, delivered — so
// the first question is whether the space under it needs anything else at all.
// Three rungs, taken in order, and the layout stops at the first that meets the
// brief:
//
//   1. cove alone     no downlights in the host chunk at all
//   2. + inside       the grid inside the cove line is lit
//   3. + the band     the band outside it is lit too, with the smaller 5 W lamp
//                     where the band is narrow enough that a 7 W would spill
//
// "Meets the brief" is `required < TOLERANCE * provided` at every rung, and the
// tolerance is a deliberate 1.2: a cove is indirect light and a room lit to
// within a sixth of its figure by indirect light reads BETTER than one lit to
// the figure exactly by forty downlights. It is the one place in this app where
// the arithmetic is allowed to be generous, and it is generous on purpose.
//
// PURE. No React, no DOM. Feet in, feet out — the caller converts.
// ---------------------------------------------------------------------------

// The one import, and it is pure geometry: a drawn cove's ring has to be grown
// into the room rather than out of a chunk, so this file now has to be able to
// ask whether a rectangle is inside an outline. See coveHostFor.
import { pointInPolygon } from './geometry.js';


/**
 * HOW FAR IN THE COVE LINE SITS, by the smaller dimension of the chunk it is
 * drawn in. Read as "up to `under` feet across, inset `offset` feet".
 *
 * A step table and not a ratio, because the band is built and a builder works
 * in feet: 2, 3, 4, 6, 8. A proportional rule would ask for a 3ft 7in band and
 * get a 3ft 6in one, and the drawing would then disagree with the room.
 *
 * The SMALLER dimension governs because the band is subtracted from both ends
 * of it — a 3ft inset in a 10ft room leaves 4ft in the middle, and the same
 * inset in the 30ft length of it is neither here nor there.
 */
export const OFFSET_STEPS = [
  // The first band is the only OPEN one — "less than 10 feet" — and every band
  // after it closes on its upper figure, so a room exactly 12 ft across takes
  // the 3 ft inset and one exactly 30 ft takes the 6. The bands as spoken
  // overlap at their ends ("10 to 12", "12 to 20"), and the earlier band wins:
  // the smaller inset leaves more ceiling, which is the safer way to be wrong
  // about a boundary case.
  { under: 10, offset: 2 },
  { upTo: 15, offset: 3 },
  { upTo: 20, offset: 4 },
  { upTo: 30, offset: 6 },
];
export const OFFSET_MAX = 8;   // over 30 ft

/** The inset for a chunk whose smaller side is `ft`. */
export function coveOffsetFor(ft) {
  for (const s of OFFSET_STEPS) {
    if (s.under != null ? ft < s.under : ft <= s.upTo) return s.offset;
  }
  return OFFSET_MAX;
}

/**
 * WHAT THE BAND IS LIT WITH, when it comes to that.
 *
 * A downlight in the band is lighting a strip of ceiling a few feet wide, from
 * a foot or two away from a wall on one side and the cove pocket on the other.
 * The ordinary 7 W at 36 degrees throws a cone wider than the band and puts
 * most of it up the wall; under about 6 ft of band the 5 W narrow lamp — the
 * same one a toilet's grid uses, and already a line in the schedule — is the
 * fitting that actually lands on the floor.
 *
 * 6 FT IS THE BREAK because that is roughly where the band stops being a strip
 * and starts being a piece of ceiling in its own right.
 */
export const NARROW_BAND_FT = 6;
export const bandFixtureFor = (offsetFt) =>
  (offsetFt < NARROW_BAND_FT ? 'small-narrow' : 'small');

/**
 * WHERE THE TAPE ACTUALLY SITS, relative to the line that is drawn.
 *
 * THREE INCHES OUTSIDE IT, and the two are not the same object. The cove line
 * is the SETTING-OUT line — the visible edge of the dropped band, the thing a
 * builder measures to and the thing the grid is cut on. The tape lives in the
 * pocket just behind that edge, where it cannot be seen from the room, which is
 * the entire point of a cove: you see the light and never the source.
 *
 * So the drawing carries both. The line is drawn as a line — dotted, thin, the
 * way any setting-out mark is drawn — and the strip is drawn as a strip, three
 * inches out, with the dots and the glow every other run on this sheet has.
 * Collapsing them into one mark would be drawing the tape where the plaster is.
 *
 * IT IS ALSO THE LENGTH THAT GETS BILLED. The run round the outside of the line
 * is a foot longer on each axis than the line itself, and it is the tape that
 * is bought by the metre.
 */
export const STRIP_OFFSET_FT = 0.25;   // 3 in

/** How much slack the brief is allowed. See the header. */
export const COVE_TOLERANCE = 1.2;

/**
 * THE RING OF FLAT CEILING A COVE OWNS, and why it exists at all.
 *
 * THE SHAPE SOMEBODY DREW IS THE POCKET. The ceiling outside it is flat and at
 * the same height, so there is no band in the plasterboard sense — nothing is
 * dropped. What there is instead is a question about the GRID: where does the
 * ordinary ceiling start again?
 *
 * `coveOutside` — one foot — is the only answer the planner has on its own, and
 * one foot is not enough. A 7 W downlight a foot from the tape reads as a
 * mistake. But the fix is not "always claim a few feet", because a few feet
 * claimed out of the middle of a big room is a few feet of ceiling nobody asked
 * the cove to light.
 *
 * SO THE RING IS A CHUNKING DEVICE AND NOTHING ELSE. It exists to stop a strip
 * of ceiling being left that is too narrow to grid. That is its whole purpose,
 * and every figure below follows from it:
 *
 *   nothing within reach   NO RING. The grid comes up to the cove line and
 *                          keeps its own distance — a cell is seven feet, so a
 *                          light in the strip sits three feet off the cove
 *                          without anybody arranging it.
 *   a WALL within 6 ft     the ring takes the whole distance. Under six feet
 *                          there is no cell to be had, so the choice is between
 *                          the cove owning that ceiling and a row of downlights
 *                          jammed between a cove and a wall.
 *   a HOLE or another COVE
 *   within 4 ft            the same, at the shorter reach: an enclosed room's
 *                          wall or a neighbouring cove is a boundary the ring
 *                          may run to, but not from as far away.
 *
 * IT DOES NOT DEPEND ON THE COVE'S SIZE. It used to — the ring took its width
 * from OFFSET_STEPS, on the reasoning that a bigger cove throws further — and
 * that was the wrong question. A cove eight feet across and one twenty-five feet
 * across leave the same unusable strip beside the same wall. What the ring is
 * about is the ceiling AROUND the cove, and the cove's own dimensions have
 * nothing to say about that.
 *
 * AND IT IS WHY THERE IS NO SLIVER. Either the ring eats the strip whole,
 * or the strip is at least six feet and grids properly. There is no width in
 * between for the chunker to make a two-foot chunk out of and then put a row of
 * downlights in.
 */
export const HALO = {
  /** How far a ring will reach to meet a wall of the room itself. */
  wall: 6,
  /** ...and to meet a hole in this ceiling, or the next cove along. Shorter,
   *  because a boundary inside the room is not the end of the ceiling. */
  block: 4,
};

/**
 * THE LEAST CEILING THERE MAY BE BETWEEN TWO COVES. Six inches.
 *
 * A BUILDABILITY FIGURE, not a lighting one. Two pockets four inches apart is a
 * strip of plasterboard nobody can fix, and on the drawing it is two design
 * chunks with a sliver between them.
 *
 * ENFORCED TWICE AND THE TWO ARE DIFFERENT ACTS. A ring stops six inches short
 * of the next cove, which costs nothing — the ring was a claim about ceiling and
 * it gives up the part it cannot have. Two SHAPES drawn within six inches cannot
 * be resolved that way: their boxes are where the pockets go and no reach rule
 * moves them. The second is refused as a cove and stays on the drawing as the
 * line it is. See the filter in App.
 */
export const COVE_GAP_FT = 0.5;

const rect = (x0, y0, x1, y1) => ({
  x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, area: (x1 - x0) * (y1 - y0),
});

/**
 * THE RING BETWEEN TWO RECTANGLES, CUT INTO FOUR PIECES.
 *
 * Two full-width runs top and bottom, two shorter ones down the sides, corners
 * belonging to the horizontal runs. That division is not arbitrary: the planner
 * takes a LIST OF RECTANGLES and they must not overlap, so a ring has to be cut
 * somewhere and the corners have to belong to one run or the other.
 *
 * A piece of zero extent is dropped rather than passed on. A cove flush against
 * a wall has no ring on that side, and a zero-height rectangle in the chunk list
 * is a chunk with no cells in it that every downstream count then has to
 * special-case.
 */
export function bandBetween(host, line) {
  return [
    rect(host.x0, host.y0, host.x1, line.y0),          // top, corner to corner
    rect(host.x0, line.y1, host.x1, host.y1),          // bottom, corner to corner
    rect(host.x0, line.y0, line.x0, line.y1),          // left, between them
    rect(line.x1, line.y0, host.x1, line.y1),          // right, between them
  ].filter((r) => r.w > 1e-6 && r.h > 1e-6);
}

/** Is this rectangle wholly inside this polygon?
 *
 *  TWO TESTS AND THEY ARE EXACT TOGETHER: every corner of the rect is in the
 *  polygon, and no vertex of the polygon is in the rect. The second is what
 *  catches a notch — an L-shaped room's reflex corner poking into the ring —
 *  and without it a host could be grown straight across a piece of ceiling that
 *  does not exist. (An edge that crossed the rect without a vertex inside would
 *  have to put a corner of the rect outside, which the first test catches. So
 *  the pair is complete, not a heuristic.) */
function rectInPolygon(r, poly) {
  const e = 1e-6;
  /* THE CORNERS ARE TESTED A HAIR INSIDE THEMSELVES, and that is the whole of
     what makes the wall case work. A host whose side lands exactly ON the
     outline is the OUTCOME THIS FUNCTION EXISTS TO REACH — the ring running
     right to the plaster — and `pointInPolygon` on a point sitting exactly on
     an edge is a coin toss. Pulled in by a thousandth of a foot the answer is
     unambiguous, and a rectangle that overshoots a wall by less than that is
     not a rectangle anybody can build differently. */
  const i = 1e-3;
  const corners = [{ x: r.x0 + i, y: r.y0 + i }, { x: r.x1 - i, y: r.y0 + i },
                   { x: r.x1 - i, y: r.y1 - i }, { x: r.x0 + i, y: r.y1 - i }];
  if (!corners.every((p) => pointInPolygon(p, poly))) return false;
  return !poly.some((v) => v.x > r.x0 + e && v.x < r.x1 - e
                        && v.y > r.y0 + e && v.y < r.y1 - e);
}

/**
 * IS THERE ENOUGH CEILING BETWEEN THIS COVE AND THE WALL TO BUILD?
 *
 * SIX INCHES, AND IT IS THE SAME FIGURE AND THE SAME ARGUMENT AS COVE_GAP_FT.
 * A pocket four inches from the plaster leaves four inches of board between the
 * two, which is not a detail anybody can fix — exactly what two pockets four
 * inches apart leaves. The wall is just the other thing a cove can be too close
 * to.
 *
 * TESTED BY GROWING THE BOX AND ASKING IF IT STILL FITS, which is exact rather
 * than four separate distance checks: a box that clears the outline by `gap`
 * everywhere is a box whose grown version is still inside the room, notches and
 * all. It catches a cove drawn across a wall and one drawn outside the room in
 * the same test.
 *
 * A COVE THAT FAILS THIS IS NOT MOVED. It is refused as a cove and stays on the
 * drawing as the setting-out line it is — see the filter in App, and the note
 * there on why refusing visibly beats clamping something somebody drew.
 */
export function coveClearOfOutline(box, polygon = [], gap = COVE_GAP_FT) {
  if (!polygon.length) return true;
  return rectInPolygon(rect(box.x0 - gap, box.y0 - gap,
                            box.x1 + gap, box.y1 + gap), polygon);
}

/**
 * THE HOST RECTANGLE FOR A COVE: the shape's own bounding box, plus whatever
 * ring the ceiling around it needs. See HALO for what the ring is FOR — every
 * figure here follows from that and from nothing else.
 *
 * EACH SIDE IS DECIDED ON ITS OWN, because a room is not symmetric about a
 * shape somebody drew in it. A cove two feet from one wall and twelve from the
 * other cannot have the same ring on both, and the two sides are not answering
 * the same question anyway.
 *
 * AND EACH SIDE IS ONE QUESTION: WHAT STOPS IT, AND HOW FAR AWAY?
 *
 *   1. Grow outward until something stops it — the room's outline, a hole in
 *      this ceiling, or the next cove along. Bounded by the longer of the two
 *      reaches, because nothing beyond that can matter.
 *   2. Nothing stopped it inside that? NO RING. The grid comes right up to the
 *      cove and there is at least six feet of ceiling for it to work in.
 *   3. Something did? Then the ring takes the WHOLE distance to it, if that
 *      distance is inside the reach for what stopped it — six feet for a wall,
 *      four for a hole or another cove. Beyond the reach, no ring: the strip is
 *      wide enough to be a piece of ceiling in its own right.
 *
 * SO A SIDE IS EITHER FLUSH AGAINST SOMETHING OR IT IS NOT THERE. The ring is
 * never a partial reach that stops in open ceiling, because a partial reach is
 * exactly how a strip too thin to grid gets left behind — which is the thing
 * this function exists to prevent.
 *
 * ANOTHER COVE IS STOPPED SHORT BY `gap`, and that is the one exception to
 * "flush against it": two pockets six inches apart is a strip of plasterboard
 * nobody can fix. See COVE_GAP_FT.
 */
export function coveHostFor(box, polygon = [], { wall = HALO.wall, block = HALO.block,
                                                 gap = COVE_GAP_FT,
                                                 blocks = [], avoid = [] } = {}) {
  const base = rect(box.x0, box.y0, box.x1, box.y1);
  if (!polygon.length) return base;
  // A shape whose own box is already not inside the room has nothing to grow
  // into — hand it back and let the caller carry on with no ring at all.
  if (!rectInPolygon(base, polygon)) return base;

  const apart = (r, a, by) => r.x0 >= a.x1 - by || a.x0 >= r.x1 - by
                           || r.y0 >= a.y1 - by || a.y0 >= r.y1 - by;
  const inRoom = (r) => rectInPolygon(r, polygon);
  const offBlocks = (r) => blocks.every((b) => apart(r, b, 1e-6))
                        && avoid.every((a) => apart(r, a, -gap));
  const fits = (r) => inRoom(r) && offBlocks(r);

  const HI = Math.max(wall, block);
  const SIDES = [['x0', -1], ['x1', +1], ['y0', -1], ['y1', +1]];
  const coords = {
    x0: [...new Set(polygon.map((p) => p.x))], x1: [...new Set(polygon.map((p) => p.x))],
    y0: [...new Set(polygon.map((p) => p.y))], y1: [...new Set(polygon.map((p) => p.y))],
  };

  const host = { ...base };
  for (const [key, dir] of SIDES) {
    const edge = base[key];
    const at = (m) => ({ ...host, [key]: edge + dir * m });

    // 1 & 2. Nothing within reach is the common case and it is answered first:
    //        the ring is not needed, so there is none.
    if (fits(at(HI))) continue;

    // How far it CAN go. Bisection rather than a walk — the test is a handful
    // of point-in-polygons and fourteen halvings settle it to under a
    // hundredth of an inch.
    let lo = 0, hi = HI;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(at(mid))) lo = mid; else hi = mid;
    }
    /* AND IT LANDS ON WHAT STOPPED IT, not a thousandth short of it. The
       containment test works to a tolerance, so bisection settles just past the
       plaster rather than on it and the host carries a coordinate like -0.001 —
       a chunk hanging a third of a millimetre outside the room. */
    const snap = coords[key]
      .map((v) => dir * (v - edge))
      .filter((m) => m > 0 && Math.abs(m - lo) <= 5e-3);
    const m = snap.length
      ? snap.reduce((a, b) => (Math.abs(b - lo) < Math.abs(a - lo) ? b : a))
      : lo;

    /* 3. WHAT STOPPED IT DECIDES HOW FAR THE RING MAY REACH. A wall of the room
          is worth going six feet for; a hole or a neighbouring cove, four. Past
          that the strip is a piece of ceiling in its own right and the ring
          stays away from it entirely — a PARTIAL reach is what leaves a sliver,
          so there is no such thing here. */
    const stoppedByWall = !inRoom(at(m + 1e-3));
    if (m <= (stoppedByWall ? wall : block) + 1e-9) host[key] = edge + dir * m;
  }
  return rect(host.x0, host.y0, host.x1, host.y1);
}

/**
 * The cove drawn in one chunk: the line itself, and the four pieces of band
 * left outside it.
 *
 * The band is cut into four rectangles the obvious way — two full-width runs
 * top and bottom, two shorter ones down the sides — because the chunk list the
 * planner takes is a list of rectangles and they must not overlap. Corners
 * belong to the horizontal runs.
 *
 * Returns null when the chunk cannot carry a cove at all: the inset would meet
 * itself in the middle, which happens only on a chunk about 4 ft across.
 */
export function coveGeometry(chunk, { offset = null } = {}) {
  // `chunk` is any rectangle in the room's own feet — a candidate from
  // coveRectOptions, or one somebody picked. The name is historical.
  if (!chunk) return null;
  const w = chunk.x1 - chunk.x0, h = chunk.y1 - chunk.y0;
  const small = Math.min(w, h);
  const off = offset ?? coveOffsetFor(small);
  // Half an inch of daylight either side of the middle. A "cove" whose two
  // insets touch is a dropped ceiling with no ceiling left.
  if (small <= off * 2 + 0.5) return null;

  const line = rect(chunk.x0 + off, chunk.y0 + off, chunk.x1 - off, chunk.y1 - off);
  // The tape, in the pocket behind the line. Always inside the chunk, because
  // the smallest inset in the table is 2 ft and this is 3 in.
  const strip = rect(line.x0 - STRIP_OFFSET_FT, line.y0 - STRIP_OFFSET_FT,
                     line.x1 + STRIP_OFFSET_FT, line.y1 + STRIP_OFFSET_FT);
  const band = bandBetween(rect(chunk.x0, chunk.y0, chunk.x1, chunk.y1), line);

  return {
    offset: off,
    // THE RECTANGLE THE COVE WAS SET OUT IN, carried through so the panel can
    // say which of the options is in use and the picker can highlight it.
    host: rect(chunk.x0, chunk.y0, chunk.x1, chunk.y1),
    line,
    strip,
    band,
    // THE RUN IS THE PERIMETER OF THE TAPE, not of the line it hides behind —
    // see STRIP_OFFSET_FT. A cove is continuous, it turns the corner and
    // carries on, so this is one run of 2(w+h) and not four that happen to meet.
    perimeterFt: 2 * (strip.w + strip.h),
    chunkAreaSqft: w * h,
    innerAreaSqft: line.w * line.h,
    bandAreaSqft: w * h - line.w * line.h,
    smallerFt: small,
  };
}
