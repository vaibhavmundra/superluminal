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

const rect = (x0, y0, x1, y1) => ({
  x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, area: (x1 - x0) * (y1 - y0),
});

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
  const band = [
    rect(chunk.x0, chunk.y0, chunk.x1, line.y0),          // top, corner to corner
    rect(chunk.x0, line.y1, chunk.x1, chunk.y1),          // bottom, corner to corner
    rect(chunk.x0, line.y0, line.x0, line.y1),            // left, between them
    rect(line.x1, line.y0, chunk.x1, line.y1),            // right, between them
  ].filter((r) => r.w > 1e-6 && r.h > 1e-6);

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
