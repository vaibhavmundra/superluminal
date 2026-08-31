// ---------------------------------------------------------------------------
// shelfStrip.js — lighting the shelves the render pass found.
//
// THE THIRD AND LAST OF THE RENDER PASS'S FIVE TYPES TO GET A FITTING, and the
// three divide the vocabulary between them for reasons that are about optics
// rather than about tidiness:
//
//   painting / wall_art   artSpots.js      a narrow beam pointed AT it
//   panelling / wallpaper reverseCove.js   a slot at the wall washing DOWN it
//   shelves               HERE             a strip IN it, lighting what is on it
//
// A shelf is not a surface you graze and not an object you point at. It is a
// horizontal plane with things standing on it, and the light belongs under the
// shelf above — concealed at the front lip, throwing down onto the tier below.
// That is a linear product, bought by the metre, and it runs the length of the
// unit.
//
// WHAT THE PLAN CAN AND CANNOT SAY, because this is the honest limit of the
// feature and it is worth stating rather than papering over. PROMPT 02's rule D
// says stacked shelves share the same start and end cells — three shelves one
// above another are ONE run in plan view, because a plan is a horizontal cut and
// cannot see a stack. So this produces ONE run per shelf element: the length is
// the plan's answer and it is right, and the number of TIERS is a specification
// decision the drawing does not hold. The panel says so rather than multiplying
// by a number nobody measured.
//
// IT STOPS AT A DOOR, like the reverse cove and for the same reason: a shelf
// does not cross an opening, so neither does its tape. wallSegments does the
// cutting, and it is imported rather than reimplemented — two answers to "where
// are the doors in this wall" is two places for them to drift.
//
// PURE. No React, no canvas. Plan pixels throughout; the caller converts.
// ---------------------------------------------------------------------------

import { wallOf, wallSegments } from './reverseCove.js';

export const SHELF_STRIP = {
  /** What this lights, and the whole of it. */
  types: ['shelves'],

  /**
   * A run shorter than this is not worth a driver, in feet. Same figure and
   * same argument as the reverse cove's: a six-inch length of tape with two end
   * caps is not something anybody installs, and billing one is worse than
   * leaving it out.
   */
  minRunFt: 1,
};

export const wantsShelfStrip = (type, o = SHELF_STRIP) => o.types.includes(type);

/**
 * One shelves element -> its strip runs, in PLAN PIXELS. One per wall segment
 * the unit reaches; an empty list if it gets none.
 *
 * THE RUN SITS ON THE ELEMENT'S OWN BAND, not against the wall like a cove. The
 * two are different fittings in different places: a reverse cove is a slot in
 * the CEILING at the wall face, and this is tape inside a piece of joinery that
 * stands a foot into the room. Drawing both on the wall line would put them on
 * top of each other on any wall that has both, and they would read as one thing.
 */
export function shelfStripsFor(element, grid,
                               { pxPerFt = null, doors = [], opt = SHELF_STRIP } = {}) {
  if (!grid || !(pxPerFt > 0)) return [];
  if (!wantsShelfStrip(element?.type, opt) || !element?.cells?.length) return [];
  const w = wallOf(element, grid);
  if (!w) return [];

  const runLo = w.horizontal ? w.rect.x0 : w.rect.y0;
  const runHi = w.horizontal ? w.rect.x1 : w.rect.y1;
  // The middle of the band the model actually put the shelves in — which is
  // where the joinery is, roughly half its depth off the wall.
  const mid = w.horizontal ? (w.rect.y0 + w.rect.y1) / 2 : (w.rect.x0 + w.rect.x1) / 2;

  const segments = wallSegments(grid, w.side, doors, { pxPerFt });
  const out = [];

  segments.forEach((sg, i) => {
    const lo = Math.max(sg.lo, runLo);
    const hi = Math.min(sg.hi, runHi);
    if ((hi - lo) / pxPerFt < opt.minRunFt) return;

    // NO 70% RULE HERE, and its absence is deliberate. That rule exists for the
    // reverse cove because a slot that stops short of the end of a wall reads as
    // a mistake in the CEILING — it is a plasterboard detail and the ceiling is
    // continuous. A shelf strip is inside a piece of furniture: it is exactly as
    // long as the joinery is, and running it past the end of the unit would put
    // tape on a wall.
    out.push({
      rect: w.horizontal
        ? { x0: lo, x1: hi, y0: w.rect.y0, y1: w.rect.y1 }
        : { y0: lo, y1: hi, x0: w.rect.x0, x1: w.rect.x1 },
      run: w.horizontal
        ? [{ x: lo, y: mid }, { x: hi, y: mid }]
        : [{ x: mid, y: lo }, { x: mid, y: hi }],
      wall: w.side, horizontal: w.horizontal,
      type: element.type,
      runLength: hi - lo,
      lengthFt: (hi - lo) / pxPerFt,
      segment: i + 1, ofSegments: segments.length,
      split: segments.length > 1,
      // The bounds a hand-drag is clamped to — the wall segment, so a strip
      // cannot be stretched across the opening that ended it. See trimWallRun.
      seg: { lo: sg.lo, hi: sg.hi },
    });
  });

  return out;
}
