// ---------------------------------------------------------------------------
// artSpots.js — lighting the wall art the render pass found.
//
// THE RULE, WHICH IS THE WHOLE FEATURE: a painting or a piece of wall art gets
// ONE narrow-beam directional spot for every two feet of its width. A five-foot
// installation gets two. Not three — see spotCountFor for why that example is
// load-bearing.
//
// AND THEN IT PLACES NOTHING. That is the point of this file being forty lines
// of arithmetic rather than a second placement engine.
//
// taskSpots.js already knows how to stand a directional spot on the secondary
// grid: on a segment between two downlights, nearest the thing it is lighting,
// clear of the walls and the ceiling objects and the no-light zones and the
// cove, and never twice on the same segment. Every one of those rules applies
// to a spot aimed at a painting for exactly the same reasons it applies to one
// aimed at a desk — it is the same fitting in the same ceiling. A second
// placer would be a second set of those rules to keep in step, and they would
// not stay in step.
//
// SO THIS FILE TURNS ART INTO TARGETS AND HANDS THEM TO THAT PLACER. An
// artwork's run of cells is sliced into N equal parts along its own wall, and
// each part is a target like any other. Three things fall out of that for free,
// and they are the three things that would otherwise have to be written here:
//
//   · the spots come out EVENLY SPACED along the piece, at the 1/2N, 3/2N …
//     points, because their targets are;
//   · they cannot land on top of each other, because the used-once rule already
//     stops two targets sharing a segment;
//   · they cannot land on top of a spot lighting a desk either, because the
//     art targets and the task surfaces go into ONE planTaskSpots call per room.
//
// WHY 24 DEGREES, when the task spot is 30. A task spot lights a plane you work
// at from three or four feet above it; the pool wants to be wider than the
// desk. Art is lit from a metre or more off the wall at an angle, and the beam
// has to land ON the picture and not on the wall around it — a wide beam over a
// framed piece throws a bright halo on the plaster and washes the frame out.
// Narrower is the whole specification.
//
// PURE. No React, no canvas, no fetch.
// ---------------------------------------------------------------------------

import { WALL_BY_ID } from './wallPrompt.js';
import { secondaryGrid, spotLegality, chunkFor, rectDistance, carriedByTrack,
         SPOT_DEFAULTS } from './taskSpots.js';

export const ART_SPOT = {
  /** The catalogue id in boq.js. One name, so the drawing, the tooltip and the
   *  schedule cannot disagree about what is being bought. */
  fixture: 'art-spot',

  /** Feet of artwork per spot. */
  ftPerSpot: 2,

  /**
   * How many spots is more than a wall has. A thirty-foot gallery run would
   * otherwise ask for fifteen segments in one room and empty the grid.
   */
  maxPerElement: 8,

  /**
   * HOW FAR APART THE SPOTS IN ONE GROUP SIT, in feet, along their own line.
   *
   * A GROUP IS A FORMATION, NOT A HANDFUL OF INDEPENDENT FITTINGS, and that is
   * the whole reason placeArtCluster exists. Two spots lighting one picture are
   * read together: on site they are one row on one setting-out line, and on the
   * drawing they have to look like it. Placed one at a time — which is what this
   * did first — each went to whatever grid segment happened to be nearest its
   * own share of the artwork, and a pair came out several feet apart on two
   * different lines, aimed at the same wall from two directions. It is not a
   * near miss; it is not the same design.
   */
  spacingFt: 1,

  /**
   * HOW FAR OFF THE WALL THE ROW MAY STAND, in feet.
   *
   * The minimum is the ceiling's own rule and comes from SPOT_DEFAULTS. The
   * MAXIMUM is this file's, and it is what stops "the nearest line that works"
   * from meaning a line in the middle of the room: a spot four feet off the wall
   * is already grazing a picture rather than lighting it, and past that it is a
   * downlight pointed at a wall. If nothing inside this band works, the honest
   * answer is that this piece cannot be lit from this ceiling — which is what
   * the group is dropped and reported for.
   */
  maxStandoffFt: 4,

  /**
   * How close a spot may sit to a fitting that is already there — an ambient
   * downlight, a task spot, or a spot from another group.
   *
   * The lines this row stands on are the ambient grid's own lines, so they run
   * THROUGH the downlights. Without this the obvious tidy answer — the nearest
   * parallel line, centred on the art — puts a spot in the same hole as a
   * downlight surprisingly often, and it draws as one circle.
   */
  clearOfFittingFt: 1,

  /**
   * How far the row may slide along its line to get clear, in feet.
   *
   * Centred on the artwork is the design and stays the home. But a row blocked
   * by one downlight is not a row with nowhere to go, and refusing the whole
   * group over a foot is the same mistake taskSpots.js's `slideSpan` note
   * describes. Bounded, because a row that has slid three feet is no longer
   * lighting the thing it was centred on.
   */
  slideFt: 1.5,

  /**
   * WHICH WALL ELEMENTS GET LIT, and it is deliberately only these two.
   *
   * Panelling and wallpaper are SURFACES — they are grazed from a slot or a
   * cove along their length, which is a strip, not a spot, and putting a row of
   * spots down a panelled wall would scallop it. Shelves are lit from inside
   * with a strip on each shelf. Both are real lighting jobs and both are the
   * wrong fitting from this file, so they are left alone rather than served
   * badly here. See the README's Known limits.
   */
  types: ['painting', 'wall_art'],
};

/**
 * How many spots a piece of art of this width gets.
 *
 * FLOOR, NOT ROUND, AND THE FIVE-FOOT EXAMPLE IS WHY THAT IS WRITTEN DOWN.
 * "One spot for every two feet" reads like a division somebody would round, and
 * `Math.round(5 / 2)` is 3 in JavaScript — 2.5 rounds away from zero. The rule
 * as stated gives 5 ft two spots: you get a spot for each COMPLETE two feet.
 * Rounding would also make the rule discontinuous in the wrong place, handing a
 * 3 ft picture two spots and a 4 ft one two as well.
 *
 * A MINIMUM OF ONE, because a piece of art under two feet wide is still a piece
 * of art on a wall, and "zero spots" is not an answer anybody wants from a
 * feature whose entire job is to light it.
 */
export function spotCountFor(widthFt, o = ART_SPOT) {
  if (!Number.isFinite(widthFt) || widthFt <= 0) return 1;
  return Math.max(1, Math.min(o.maxPerElement, Math.floor(widthFt / o.ftPerSpot)));
}

/** Is this something this file lights? */
export const litByArtSpots = (type, o = ART_SPOT) => o.types.includes(type);

/**
 * How wide the piece is, in feet, and WHICH width that is.
 *
 * THE DOCUMENTED WIDTH WINS. `widthFt` is parsed out of PROMPT 01's `dimension`
 * — the model looked at a photograph of the actual room and said "2ft high and
 * 5ft wide" — and that is a measurement of the artwork. The cell run is PROMPT
 * 02's answer to a different question, "where on this wall does it sit", and it
 * is quantised to whole feet and clamped to the wall. Where the two disagree
 * the first one is the better number for counting fittings, and the panel
 * already shows the disagreement when it is large.
 *
 * The run is the fallback rather than nothing, because an element whose
 * dimension came back as "large" still has a length on the drawing.
 */
export function artWidthFt(element, grid) {
  if (Number.isFinite(element?.widthFt) && element.widthFt > 0) {
    return { ft: element.widthFt, from: 'dimension' };
  }
  const n = element?.cells?.length ?? 0;
  if (!n || !grid) return { ft: null, from: 'unknown' };
  const horizontal = element.start && element.end ? element.start.y === element.end.y : true;
  return { ft: n * (horizontal ? grid.cellWFt : grid.cellHFt), from: 'cells' };
}

/**
 * A rectangle cut into N equal parts ALONG ITS OWN LENGTH.
 *
 * `horizontal` says which way that is, and getting it wrong stacks every slice
 * on top of the last one rather than laying them out along the wall.
 */
export function sliceRect(rect, n, horizontal) {
  const out = [];
  if (!rect || !(n > 0)) return out;
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    out.push(horizontal
      ? { x0: rect.x0 + (rect.x1 - rect.x0) * a, x1: rect.x0 + (rect.x1 - rect.x0) * b,
          y0: rect.y0, y1: rect.y1 }
      : { x0: rect.x0, x1: rect.x1,
          y0: rect.y0 + (rect.y1 - rect.y0) * a, y1: rect.y0 + (rect.y1 - rect.y0) * b });
  }
  return out;
}

/**
 * One wall element -> WHAT EACH SPOT IN ITS ROW AIMS AT, in whatever space
 * `rect` is given in.
 *
 * The row itself is a tight formation — a foot between fittings, see
 * placeArtCluster — and the artwork is not. So the spots are NOT all pointed at
 * its centre: the piece is divided into as many parts as there are spots and
 * each takes its own share of the width, which is how a pair lights a five-foot
 * picture evenly instead of twice-lighting the middle of it.
 *
 * `rect` is the union of the element's cells and comes from wallGrid.js; this
 * takes it rather than recomputing, so there is one definition of where the
 * artwork is.
 */
export function artTargets(element, rect, { grid = null, opt = ART_SPOT } = {}) {
  if (!rect || !litByArtSpots(element?.type, opt) || !element?.cells?.length) return [];
  const { ft, from } = artWidthFt(element, grid);
  const n = spotCountFor(ft, opt);

  // Which way the run lies. Same test as the canvas uses, and the same default:
  // a one-cell run is called horizontal and slices into itself either way.
  const horizontal = element.start && element.end ? element.start.y === element.end.y : true;
  return sliceRect(rect, n, horizontal).map((r, i) => ({
    rect: r,
    elementId: element.id,
    index: i, of: n,
    type: element.type,
    label: WALL_BY_ID[element.type]?.label || element.type,
    colour: WALL_BY_ID[element.type]?.colour || '#666',
    widthFt: ft, widthFrom: from,
    // The whole piece, so a spot can highlight what it is lighting rather than
    // the slice of it that happened to be its aim point.
    wholeRect: rect,
  }));
}

/**
 * Every art target in a room, from that room's wall elements.
 *
 * `rectFor` is passed in rather than imported so this stays free of the grid
 * geometry — App.jsx already has the union rect for every element, because the
 * canvas draws it.
 */
export function artTargetsFor(elements = [], rectFor, { grid = null, opt = ART_SPOT } = {}) {
  const out = [];
  for (const e of elements) {
    const rect = rectFor(e);
    for (const t of artTargets(e, rect, { grid, opt })) out.push(t);
  }
  return out;
}

// --- placing the row -------------------------------------------------------
//
// ONE ARTWORK IS ONE PLACEMENT, ALL OR NOTHING, and that is the difference
// between this and everything else that stands a spot on this ceiling.
//
// A task surface asks for one fitting: it gets a good position or it does not,
// and either answer is complete. A piece of art asks for a ROW — two spots, or
// four — and half a row is not half an answer. Two spots several feet apart on
// two different lines, each aimed at the same wall from its own direction, is
// not a compromised version of the design; it is a different and worse one, and
// it looks like a bug on the drawing because it is one.
//
// So the group is placed as a rigid formation:
//
//   · ON ONE LINE, and that line is PARALLEL TO THE WALL being lit. Every spot
//     therefore stands the same distance off the wall and grazes the piece at
//     the same angle, which is the only way a row of them lights it evenly.
//   · SPACED `spacingFt` APART along that line, centred on the artwork.
//   · and if no line will take the whole row — DROPPED, with a sentence saying
//     why. Not thinned, not spread out, not moved to a wall it is not on.
//
// THE LINES COME FROM THE SECONDARY GRID, exactly as they do for a task spot,
// and for the reason in taskSpots.js's header: those lines are the ambient
// layout's own skeleton, so a fitting standing on one reads as part of the
// design instead of as an offset nobody chose. What is different here is that
// the row is not on a SEGMENT of that grid — a segment is the gap between two
// downlights, four feet of it, and a one-foot row does not divide it — it is at
// a chosen point ALONG a line. The line is the part that has to be shared with
// the layout; the spacing within the row is the row's own business.

/** The perpendicular distance from a wall-hugging rect to a grid line. */
function standoff(line, rect) {
  return line.axis === 'h'
    ? Math.min(Math.abs(line.at - rect.y0), Math.abs(line.at - rect.y1))
    : Math.min(Math.abs(line.at - rect.x0), Math.abs(line.at - rect.x1));
}

/**
 * Every point in the row, for a line and an offset along it.
 *
 * `centre` is where the middle of the row wants to be — the artwork's own
 * centre, projected onto the line — and `slide` moves the whole row along it.
 * The row is built from the middle out so an even count straddles the centre
 * and an odd one sits on it.
 */
function rowPoints(line, centre, n, spacing, slide) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = centre + slide + (i - (n - 1) / 2) * spacing;
    out.push(line.axis === 'h' ? { x: v, y: line.at } : { x: line.at, y: v });
  }
  return out;
}

const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The whole row for one piece of art, in the room's FEET.
 *
 * `element` needs `rect` (the artwork on the plan, in feet), `horizontal` (which
 * way its run lies) and `n` (how many spots the width rule asked for).
 * `taken` is every fitting position already spoken for in this room — the
 * ambient downlights, the task spots, and the rows of any art placed before
 * this one. See ART_SPOT.clearOfFittingFt for why that matters more here than
 * anywhere else.
 *
 * Returns `{ spots: [...] }` or `{ rejected: '<sentence>' }`. Never a partial row.
 */
export function placeArtCluster(element, { chunks = [], lights = [], polygon = [],
                                           fixtures = [], zones = [], coves = [],
                                           taken = [], tracks = [], opt = {} } = {}) {
  const o = { ...ART_SPOT, ...opt };
  const so = { ...SPOT_DEFAULTS, ...opt };
  const rect = element.rect;
  const n = element.n ?? 1;
  const spacing = o.spacingFt;
  const minStand = so.wallDistance ?? opt.minWallDistance ?? 0;
  const clearance = opt.fanClearance ?? 0;

  const centreOf = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  const c = centreOf(rect);
  const chunk = chunkFor(c, chunks);
  if (!chunk) return { rejected: 'This artwork is not on any chunk of ceiling.' };

  const reasons = new Set();
  // A ROW OVER A BED IS THE CASE THIS RULE WAS WRITTEN FOR, and it is worth
  // saying so here rather than only in taskSpots.js. The wall behind a bed is
  // the wall a bedroom's art is on, the bed is pushed against it, and the only
  // ceiling within four feet of that wall is the ceiling over the mattress. The
  // row was refused there and the piece came back "no line off that wall" — a
  // true sentence about a rule that should not have applied. See
  // SPOT_DEFAULTS.overBed; every other zone still refuses a fitting outright.
  const legal = spotLegality({ polygon, zones, fixtures, coves, clearance,
                               wallMin: minStand, overBed: so.overBed, reasons });

  // THE LINE HAS TO RUN THE SAME WAY THE ARTWORK DOES. A piece on a horizontal
  // wall has a horizontal run, and the row that lights it is a horizontal line
  // standing off that wall — `axis: 'h'`. Take the perpendicular set and every
  // spot in the row is at a different distance from the wall, which is the
  // failure this whole function is here to make impossible.
  const axis = element.horizontal ? 'h' : 'v';
  // ACROSS A BED, WHERE THERE IS ONE. The chunk stops at the foot of the
  // mattress, so without this the lines this row may stand on start six feet
  // off the wall the art is on — outside maxStandoffFt, which is why the group
  // was dropped. See spotSpan in taskSpots.js.
  const grid = secondaryGrid(chunk, lights, { ...so, spanZones: zones });
  const rail = tracks.length ? (p) => carriedByTrack(p, tracks, so) : null;
  const alongMid = axis === 'h' ? (rect.x0 + rect.x1) / 2 : (rect.y0 + rect.y1) / 2;
  const candidates = grid.lines
    .filter((l) => l.axis === axis)
    .map((l) => {
      const d = standoff(l, rect);
      // A LINE THE TRACK CAN CARRY IS WORTH A LITTLE EXTRA STANDOFF. A row of
      // art heads clipped into a profile that is already there is the fitting
      // this ceiling is built for; the same row a yard off it is three recessed
      // spots and three holes. Charged rather than required — see
      // SPOT_DEFAULTS.trackMissFt — so a rail outside the band still loses to a
      // line inside it, because the band is about lighting the picture.
      const at = axis === 'h' ? { x: alongMid, y: l.at } : { x: l.at, y: alongMid };
      return { l, d, rank: d + (rail && !rail(at) ? so.trackMissFt : 0) };
    })
    // Inside the band, and nearest the wall first — a row further out than it
    // needs to be is a row grazing the picture at a flatter angle for nothing.
    .filter((q) => q.d >= minStand - 1e-9 && q.d <= o.maxStandoffFt + 1e-9)
    .sort((a, b) => a.rank - b.rank || a.d - b.d);

  if (!candidates.length) {
    return { rejected: grid.lines.some((l) => l.axis === axis)
      ? `No ceiling line runs parallel to this wall between ${minStand} and`
        + ` ${o.maxStandoffFt} ft off it, so a row of spots would either crowd`
        + ` the wall or graze the piece from too far out.`
      : 'This piece of ceiling has no grid line running along that wall.' };
  }

  // Centred is the design and is tried first; the slide is the concession.
  const slides = [0];
  const steps = 6;
  for (let k = 1; k <= steps; k++) {
    const d = (k / steps) * o.slideFt;
    slides.push(-d, d);
  }

  const along = axis === 'h' ? 'x' : 'y';
  let crowded = false;
  for (const { l, d } of candidates) {
    for (const slide of slides) {
      const pts = rowPoints(l, c[along], n, spacing, slide);
      if (!pts.every(legal)) continue;
      // Clear of everything already on this ceiling. Checked after the ceiling
      // rules so the reported reason is the more useful of the two.
      if (pts.some((p) => taken.some((t) => gap(p, t) < o.clearOfFittingFt - 1e-9))) {
        crowded = true; continue;
      }
      return {
        spots: pts.map((p, i) => ({
          ...p,
          index: i, of: n,
          standoff: d,
          slid: Math.abs(slide),
          line: { axis: l.axis, at: l.at, a: l.a, b: l.b },
        })),
        line: l, standoff: d, slid: Math.abs(slide),
      };
    }
  }

  const why = [...reasons];
  if (crowded) why.push('too close to a fitting that is already there');
  return { rejected: n > 1
    ? `No line off that wall will take all ${n} spots at ${spacing} ft apart`
      + (why.length ? ` — ${why.join(', or ')}.` : '.')
    : `No line off that wall will take a spot`
      + (why.length ? ` — ${why.join(', or ')}.` : '.') };
}

/**
 * Every art row in one room, placed in order and out of each other's way.
 *
 * `elements` are the wall elements with their plan rect ALREADY IN FEET and
 * their `horizontal` flag; `taken` starts as the room's existing fittings and
 * grows as rows land, so the second picture on a wall cannot sit on top of the
 * first one's row.
 */
export function planArtSpots(elements = [], ctx = {}) {
  const taken = [...(ctx.taken ?? [])];
  return elements.map((e) => {
    const res = placeArtCluster(e, { ...ctx, taken });
    if (res.spots) for (const p of res.spots) taken.push(p);
    return res;
  });
}

/** Re-exported so callers do not need taskSpots.js for the one helper. */
export { rectDistance };
