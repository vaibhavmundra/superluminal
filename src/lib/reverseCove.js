// ---------------------------------------------------------------------------
// reverseCove.js — the ceiling detail over a panelled or papered wall.
//
// WHAT A REVERSE COVE IS, since the name is the opposite of the one next door.
// An ordinary cove (cove.js) is a band dropped round the perimeter with the
// tape hidden BEHIND it, throwing light up and back onto the slab: the ceiling
// appears to float. A reverse cove is the same detail turned to face the other
// way — a slot at the wall with the tape at its inner lip, washing DOWN the
// wall. You build one when the wall is the thing worth looking at, which is
// exactly what panelling and wallpaper are: a surface, running the length of a
// wall, that a spot would scallop and a downlight would flatten.
//
// So the render pass finding `panelling` or `wallpaper` on a wall is the
// trigger, and this file is the whole rule:
//
//   · 8 INCHES WIDE ON PLAN, measured in from the wall face. That is a real
//     slot in a real ceiling; it is not a line, and it is not scaled to the
//     room.
//   · AS LONG AS THE PANELLED RUN — unless that run is 70% or more of the wall
//     SEGMENT, in which case it runs the whole segment. A detail that stops nine
//     tenths of the way along a wall reads as an error rather than as a
//     decision; past the threshold the honest answer is that the wall is
//     panelled, so the ceiling over it is coved.
//   · A DOOR DIVIDES THE WALL FOR MEASURING. A wall with a door in it is not
//     one wall for the 70% test: each side is a segment, measured and judged on
//     its own, because panelling filling the thirteen feet beside a door is
//     plainly a full run of panelling and not 65% of something. See
//     wallSegments.
//
//     BUT THE COVE ITSELF MAY CROSS THE DOOR, and this is worth stating because
//     the code used to forbid it. A door head is about 7 ft and a ceiling is 9
//     or more, so the slab over an opening is ordinary continuous ceiling with
//     two feet of wall above the frame — there is nothing there to stop a slot.
//     Two consequences: a hand-drag is clamped to the WALL and not to the
//     segment, and where the segments either side of an opening are BOTH full
//     the coves are bridged into one run through, because a break in the slot
//     over a door with cove on both sides is a detail nobody would build.
//     (A shelf strip is the opposite case and keeps the hard stop: shelving
//     cannot stand in a doorway. See shelfStrip.js.)
//   · AND IT IS A NO-DRAW AREA. Eight inches of ceiling is now a slot with tape
//     in it. Nothing else goes there — not a downlight, not a spot, not the
//     setting-out of an ordinary cove — and the way that is enforced is that
//     the band becomes a no-light zone like any other, which every placer in
//     this app already obeys.
//
// PURE. No React, no canvas. Everything is in PLAN PIXELS because that is the
// space the grid and the wall elements already live in; the caller converts.
// ---------------------------------------------------------------------------

import { cellRect } from './wallGrid.js';

export const REVERSE_COVE = {
  /**
   * The slot, across the ceiling, in INCHES.
   *
   * A real dimension and not a fraction of anything. A reverse cove is a
   * plasterboard detail: the slot is as wide as the fitting and the shadow gap
   * need it to be, and that number does not change because the room got bigger.
   */
  widthIn: 8,

  /**
   * Past this share of the wall, the cove takes the whole wall.
   *
   * The rule this encodes is about how a drawing READS rather than about
   * lighting. A slot that runs 71% of a wall and then stops looks like somebody
   * mis-set it out; one that runs the whole wall looks like a decision. Below
   * the threshold the panelling is plainly a feature ON a wall and the cove
   * belongs to the feature, so it stops where the feature does.
   */
  fullWallAt: 0.7,

  /**
   * How close a door has to be to a wall line to be counted as being IN it, in
   * feet.
   *
   * A door's box is the leaf plus its swing, and it is drawn straddling the
   * wall it hangs in — partly in the wall's own thickness, partly in the room.
   * A test for "touching the wall line" would therefore miss a door whose box
   * sits an inch inside the room on a drawing whose walls are nine inches
   * thick. A foot and a half is wider than any wall this app will meet and far
   * narrower than anything that could be mistaken for a door standing in the
   * middle of the room.
   */
  doorOnWallFt: 1.5,

  /**
   * A cove shorter than this is not a cove, in feet.
   *
   * Two doors close together leave a sliver of wall between them; a six-inch
   * slot with a driver and two end caps is not a detail anybody builds, and
   * billing one is worse than leaving it out. Applied to the finished length,
   * so it catches both a sliver segment and a sliver of panelling inside a
   * long one.
   */
  minRunFt: 1,

  /**
   * WHAT TRIGGERS ONE, and it is deliberately the two types that artSpots.js
   * leaves alone. Between them these two files cover the render pass's
   * vocabulary: a picture is a thing you point a narrow beam AT, a panelled
   * wall is a surface you wash DOWN, and shelves are neither (see the README's
   * Known limits — they want a strip per shelf and get nothing yet).
   */
  types: ['panelling', 'wallpaper'],
};

export const wantsReverseCove = (type, o = REVERSE_COVE) => o.types.includes(type);

/**
 * A WALL, CUT AT ITS DOORS. Returns the pieces along the wall, in plan pixels.
 *
 * THIS IS THE THING THAT MAKES THE 70% RULE MEAN ANYTHING ON A REAL PLAN. A
 * twenty-foot wall with a door two thirds of the way along it is not a
 * twenty-foot wall: it is thirteen feet and five, with an opening between them.
 * Panelling filling the thirteen is 65% of the wall and 100% of the segment it
 * is actually on — under the threshold by the first reading and over it by the
 * second, and the second is the one a person would give. The ceiling detail
 * cannot cross an opening, so neither can the arithmetic about it.
 *
 * `doors` are whole-sheet detections in the same pixel space as the grid — the
 * ones this app already found to set the scale. A door is IN this wall if its
 * box sits within `doorOnWallFt` of the wall line and its extent along the wall
 * lands inside the room. Everything else on the sheet is somebody else's door.
 *
 * No doors is one segment: the whole wall, which is exactly what this returned
 * before doors were considered at all.
 */
export function wallSegments(grid, side, doors = [], { pxPerFt = null, opt = REVERSE_COVE } = {}) {
  const horizontal = side === 'top' || side === 'bottom';
  const lo = horizontal ? grid.x0 : grid.y0;
  const hi = horizontal ? grid.x1 : grid.y1;
  const whole = [{ lo, hi }];
  if (!doors?.length || !(pxPerFt > 0)) return whole;

  const at = side === 'top' ? grid.y0 : side === 'bottom' ? grid.y1
    : side === 'left' ? grid.x0 : grid.x1;
  const tol = opt.doorOnWallFt * pxPerFt;

  const gaps = [];
  for (const d of doors) {
    const r = d?.rect;
    if (!r) continue;
    // Across the wall: does the box reach the wall line?
    const a0 = horizontal ? r.y0 : r.x0;
    const a1 = horizontal ? r.y1 : r.x1;
    if (a1 < at - tol || a0 > at + tol) continue;
    // Along the wall: does it land inside this room's extent?
    const g0 = horizontal ? r.x0 : r.y0;
    const g1 = horizontal ? r.x1 : r.y1;
    if (g1 <= lo || g0 >= hi) continue;
    gaps.push({ lo: Math.max(lo, g0), hi: Math.min(hi, g1) });
  }
  if (!gaps.length) return whole;

  gaps.sort((a, b) => a.lo - b.lo);
  const out = [];
  let cursor = lo;
  for (const g of gaps) {
    // Overlapping doors — a double leaf detected as two boxes — are one gap.
    if (g.lo > cursor) out.push({ lo: cursor, hi: g.lo });
    cursor = Math.max(cursor, g.hi);
  }
  if (cursor < hi) out.push({ lo: cursor, hi });

  // A wall that is all door has no segment worth coving; say so with an empty
  // list rather than by handing back the whole wall as if the door were not
  // there.
  const min = opt.minRunFt * pxPerFt;
  return out.filter((sg) => sg.hi - sg.lo >= min);
}

/**
 * Which wall of the grid the run lies against, which way it runs, and the band
 * of cells it occupies.
 *
 * EXPORTED because shelfStrip.js asks the same question of the same kind of
 * element. "Which wall is this run on" has one right answer per element and it
 * must not be arrived at twice: a shelf strip and a reverse cove disagreeing
 * about which wall a run is on would put two fittings on two different walls
 * from one detection.
 */
export function wallOf(element, grid) {
  const horizontal = element.start && element.end ? element.start.y === element.end.y : true;
  const a = cellRect(grid, element.start?.x ?? 1, element.start?.y ?? 1);
  const b = cellRect(grid, element.end?.x ?? 1, element.end?.y ?? 1);
  if (!a || !b) return null;
  const rect = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
                 x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  // NEAREST EDGE, NOT THE OUTERMOST CELL INDEX. A run hugs a wall by rule A of
  // PROMPT 02, but the model does not always put it on row 1 or row `rows` —
  // an open-plan space has walls the bounding box does not, and a run against
  // one of those lands somewhere in the middle. The nearest edge of the grid is
  // the wall this app can actually draw against, and it is the same reading
  // sideOf() takes for the anchors.
  const side = horizontal
    ? (rect.y0 - grid.y0 <= grid.y1 - rect.y1 ? 'top' : 'bottom')
    : (rect.x0 - grid.x0 <= grid.x1 - rect.x1 ? 'left' : 'right');
  return { horizontal, side, rect };
}

/**
 * One wall element -> its reverse coves, in PLAN PIXELS. One per wall segment
 * the panelling reaches; an empty list if it gets none.
 *
 * A LIST AND NOT ONE COVE, because a wall is not one wall once there is a door
 * in it. Each segment is measured, judged against the 70% rule and coved on its
 * own — so panelling that fills the thirteen feet on one side of a door takes
 * the whole of that side and stops at the opening, rather than being 65% of a
 * notional twenty-foot wall and stopping short of the door for no visible
 * reason.
 *
 * Each cove carries the arithmetic that chose its length — `spanFt`, `wallFt`,
 * `fraction`, and which segment of how many — so the panel can say "9 of 12 ft
 * on segment 1 of 2, 75%, so the whole segment" rather than presenting a length
 * nobody can check.
 */
export function reverseCovesFor(element, grid,
                                { pxPerFt = null, doors = [], opt = REVERSE_COVE } = {}) {
  if (!grid || !(pxPerFt > 0)) return [];
  if (!wantsReverseCove(element?.type, opt) || !element?.cells?.length) return [];
  const w = wallOf(element, grid);
  if (!w) return [];

  const depth = (opt.widthIn / 12) * pxPerFt;
  const along = w.horizontal ? 'x' : 'y';
  const runLo = w.horizontal ? w.rect.x0 : w.rect.y0;
  const runHi = w.horizontal ? w.rect.x1 : w.rect.y1;

  const segments = wallSegments(grid, w.side, doors, { pxPerFt, opt });
  const out = [];

  segments.forEach((sg, i) => {
    // THE PANELLING INSIDE THIS SEGMENT, and nothing outside it. A run that
    // crosses a door contributes to both segments — which is right: it is
    // panelling on both pieces of wall — but each piece is judged on what it
    // actually holds.
    const lo0 = Math.max(sg.lo, runLo);
    const hi0 = Math.min(sg.hi, runHi);
    if (hi0 - lo0 <= 0) return;

    const segPx = sg.hi - sg.lo;
    const fraction = segPx > 0 ? (hi0 - lo0) / segPx : 0;
    const full = fraction >= opt.fullWallAt;
    const lo = full ? sg.lo : lo0;
    const hi = full ? sg.hi : hi0;
    if ((hi - lo) / pxPerFt < opt.minRunFt) return;

    // Eight inches in from the wall face. A cove is at the wall whatever the run
    // did; anchoring the band on the element's own cells instead would float it
    // into the room wherever the model put the run off the edge.
    const rect = w.horizontal
      ? { x0: lo, x1: hi,
          ...(w.side === 'top' ? { y0: grid.y0, y1: grid.y0 + depth }
                               : { y0: grid.y1 - depth, y1: grid.y1 }) }
      : { y0: lo, y1: hi,
          ...(w.side === 'left' ? { x0: grid.x0, x1: grid.x0 + depth }
                                : { x0: grid.x1 - depth, x1: grid.x1 }) };

    // The tape, down the middle of the slot. One straight run with two ends —
    // which is what a reverse cove is, and the difference from cove.js's closed
    // loop: that one turns four corners and this one does not turn any.
    const midAcross = w.horizontal ? (rect.y0 + rect.y1) / 2 : (rect.x0 + rect.x1) / 2;
    const run = w.horizontal
      ? [{ x: rect.x0, y: midAcross }, { x: rect.x1, y: midAcross }]
      : [{ x: midAcross, y: rect.y0 }, { x: midAcross, y: rect.y1 }];

    out.push({
      rect, run, along,
      wall: w.side, horizontal: w.horizontal,
      type: element.type,
      runLength: hi - lo,
      lengthFt: (hi - lo) / pxPerFt,
      widthFt: opt.widthIn / 12,
      spanFt: (hi0 - lo0) / pxPerFt,
      // THE SEGMENT'S LENGTH, NOT THE WALL'S. On a wall with no door the two
      // are the same number and nobody notices; on one with a door this is the
      // whole point, and a panel reporting the wall's length beside a segment's
      // percentage would be two numbers that cannot both be right.
      wallFt: segPx / pxPerFt,
      fraction, full,
      segment: i + 1, ofSegments: segments.length,
      split: segments.length > 1,
      // TWO SETS OF BOUNDS, AND THEY ARE DIFFERENT ON PURPOSE.
      // `seg` is the piece of wall this cove was MEASURED against — the 70%
      // denominator, and what the panel quotes. `bounds` is how far it may be
      // STRETCHED, which is the whole wall: the ceiling runs over the door head,
      // so a slot dragged across an opening is buildable. See trimWallRun.
      seg: { lo: sg.lo, hi: sg.hi },
      bounds: { lo: w.horizontal ? grid.x0 : grid.y0,
                hi: w.horizontal ? grid.x1 : grid.y1 },
    });
  });

  return out;
}

/**
 * Two coves on one wall are one cove.
 *
 * A wall can come back both `panelling` and `wallpaper` — the model saw fluted
 * timber to the dado and paper above it, which is one wall and two honest
 * answers. Two bands then land in the same eight inches of ceiling: drawn, they
 * are one band with a doubled outline; billed, they are twice the tape that
 * will be bought. So overlapping coves on the same wall are merged into their
 * union, and the merged one remembers what it came from.
 */
export function mergeReverseCoves(list, { pxPerFt = null } = {}) {
  const out = [];
  const remeasure = (c) => {
    const len = c.horizontal ? c.rect.x1 - c.rect.x0 : c.rect.y1 - c.rect.y0;
    const mid = c.horizontal ? (c.rect.y0 + c.rect.y1) / 2 : (c.rect.x0 + c.rect.x1) / 2;
    c.run = c.horizontal
      ? [{ x: c.rect.x0, y: mid }, { x: c.rect.x1, y: mid }]
      : [{ x: mid, y: c.rect.y0 }, { x: mid, y: c.rect.y1 }];
    c.runLength = len;
    if (pxPerFt > 0) c.lengthFt = len / pxPerFt;
  };

  for (const c of list) {
    const hit = out.find((q) => q.wall === c.wall
      && q.rect.x0 < c.rect.x1 && c.rect.x0 < q.rect.x1
      && q.rect.y0 < c.rect.y1 && c.rect.y0 < q.rect.y1);
    if (!hit) { out.push({ ...c, from: [c.elementId ?? c.type] }); continue; }
    const rect = {
      x0: Math.min(hit.rect.x0, c.rect.x0), y0: Math.min(hit.rect.y0, c.rect.y0),
      x1: Math.max(hit.rect.x1, c.rect.x1), y1: Math.max(hit.rect.y1, c.rect.y1),
    };
    hit.rect = rect;
    remeasure(hit);
    hit.full = hit.full || c.full;
    hit.fraction = Math.max(hit.fraction, c.fraction);
    hit.from.push(c.elementId ?? c.type);
  }

  // --- and then the doors are bridged.
  //
  // TWO FULL SEGMENTS EITHER SIDE OF AN OPENING ARE ONE SLOT. The ceiling runs
  // over the door head — 7 ft of door under 9 ft of ceiling — so there is
  // nothing over an opening to interrupt a cove, and stopping either side of one
  // when both walls beside it are coved is a break somebody would have to be
  // told to build. So the two are joined and the run crosses.
  //
  // ONLY WHEN BOTH ARE FULL. A cove that stops part-way along its own segment is
  // stopping where the panelling stops, which is a real edge with a reason;
  // running it on across a door to meet something on the far side would be
  // inventing a length neither side asked for.
  let bridged = true;
  while (bridged) {
    bridged = false;
    for (let i = 0; i < out.length && !bridged; i++) {
      for (let j = i + 1; j < out.length && !bridged; j++) {
        const a = out[i], b = out[j];
        if (a.wall !== b.wall || !a.full || !b.full) continue;
        // Adjacent pieces of the SAME wall's segmentation. Index adjacency
        // rather than a distance test, so a wide opening and a narrow one are
        // treated alike and two coves that merely happen to be near each other
        // on different walls never qualify.
        const segs = [a.segment, b.segment].sort((p, q) => p - q);
        if (a.ofSegments !== b.ofSegments || segs[1] - segs[0] !== 1) continue;
        a.rect = {
          x0: Math.min(a.rect.x0, b.rect.x0), y0: Math.min(a.rect.y0, b.rect.y0),
          x1: Math.max(a.rect.x1, b.rect.x1), y1: Math.max(a.rect.y1, b.rect.y1),
        };
        remeasure(a);
        a.seg = { lo: Math.min(a.seg.lo, b.seg.lo), hi: Math.max(a.seg.hi, b.seg.hi) };
        a.segment = segs[0];
        a.bridged = (a.bridged ?? 0) + 1;
        a.from.push(...b.from);
        out.splice(j, 1);
        bridged = true;
      }
    }
  }

  return out;
}

// --- editing the length by hand ---------------------------------------------

/**
 * The tolerances for dragging a derived run's end, in FEET.
 *
 * Quoted in feet and not pixels for the reason RUN_EDIT gives next door: a snap
 * should be the same size on a site plan at 6 px/ft as on a flat at 40.
 *
 * THREE INCHES, which is a coving setting-out increment rather than a round
 * number — nobody builds a slot to the nearest tenth of a foot, and a length
 * that reads 7.13 ft on a schedule is a length somebody has to decide what to do
 * about. Hold Shift for the exact position when that is what you want.
 */
export const RUN_TRIM = {
  snapFt: 0.25,
  /** Below this it is not a run: see RUN_EDIT.minLenFt for the same argument. */
  minLenFt: 0.5,
};

/**
 * A DERIVED RUN, SHORTENED OR LENGTHENED BY HAND.
 *
 * Reverse coves and shelf strips are not placed, they are DERIVED — from the
 * cells the render pass returned, the doors in the wall and the scale — and
 * that is what makes them move with the drawing when an outline is nudged or
 * the scale is re-set. It is also what makes them awkward to edit: there is no
 * stored rectangle to drag, and storing one would throw away everything the
 * derivation buys.
 *
 * So the EDIT is stored rather than the result: two numbers per run, in FEET,
 * saying how far each end was moved from where the rule put it. `a` moves the
 * low end, `b` the high end, both positive to shorten. Everything else is still
 * derived, so a trimmed cove still follows its wall when the room is re-traced,
 * still stops at its door, and still redraws at the right size when the scale
 * changes — which none of it would if the edit were a pair of pixel coordinates.
 * Same argument as `runFt` in boq.js, one level up: never store what you can
 * derive, and never derive what somebody chose.
 *
 * IT CANNOT CROSS THE DOOR. The clamp is the run's own wall segment, so
 * stretching a cove past the opening that ended it is not available — which is
 * the one edit that would produce a drawing nobody could build.
 *
 * `base` is stamped on the way out whether or not there is a trim, because the
 * drag handler needs to know where the rule put the end in order to say how far
 * it has been moved from it. A trimmed run whose base is its own trimmed end
 * would creep on every frame of the drag.
 */
export function trimWallRun(item, trim = null,
                            { pxPerFt = null, minLenFt = RUN_TRIM.minLenFt } = {}) {
  if (!item) return item;
  const horiz = item.horizontal;
  const lo0 = horiz ? item.rect.x0 : item.rect.y0;
  const hi0 = horiz ? item.rect.x1 : item.rect.y1;
  const base = { lo: lo0, hi: hi0 };
  const a = Number(trim?.a) || 0;
  const b = Number(trim?.b) || 0;
  if (!(pxPerFt > 0) || (!a && !b)) return { ...item, base, trimmed: false };

  // `bounds` where the fitting has them, `seg` where it does not. A reverse
  // cove may be dragged the length of its wall, straight over any door in it; a
  // shelf strip carries no bounds and is held to its segment, because shelving
  // cannot stand in a doorway.
  const segLo = item.bounds?.lo ?? item.seg?.lo ?? lo0;
  const segHi = item.bounds?.hi ?? item.seg?.hi ?? hi0;
  const min = minLenFt * pxPerFt;
  let lo = lo0 + a * pxPerFt;
  let hi = hi0 - b * pxPerFt;
  lo = Math.max(segLo, Math.min(lo, segHi - min));
  hi = Math.min(segHi, Math.max(hi, lo + min));

  const across = horiz
    ? { y0: item.rect.y0, y1: item.rect.y1 }
    : { x0: item.rect.x0, x1: item.rect.x1 };
  const rect = horiz ? { x0: lo, x1: hi, ...across } : { y0: lo, y1: hi, ...across };
  const mid = horiz ? (rect.y0 + rect.y1) / 2 : (rect.x0 + rect.x1) / 2;

  return {
    ...item,
    base, trimmed: true,
    trimFt: { a: (lo - lo0) / pxPerFt, b: (hi0 - hi) / pxPerFt },
    rect,
    run: horiz ? [{ x: lo, y: mid }, { x: hi, y: mid }]
               : [{ x: mid, y: lo }, { x: mid, y: hi }],
    runLength: hi - lo,
    lengthFt: (hi - lo) / pxPerFt,
  };
}
