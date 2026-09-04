// ---------------------------------------------------------------------------
// bedGrid.js — the one place a chunk's grid is allowed to take its cell lines
// from ANOTHER chunk's lights.
//
// THE PROBLEM, WHICH IS STRUCTURAL AND NOT A TUNING FAULT.
//
// A bed is a no-light zone, so it carves the room. In an ordinary bedroom that
// leaves three pieces around it: a strip along each long side of the bed, and
// the region beyond its foot. planner.js grids every chunk INDEPENDENTLY —
// `chooseChunkGrid` sees one rectangle, the fans, and nothing else — so the two
// flank strips get one row of lights each, the foot region gets whatever its
// own proportions ask for, and the three have no reason on earth to line up.
// They usually do not. From the floor that reads as a fault, because the bed
// between them is invisible from below and the eye simply sees three lights in
// a rough diagonal.
//
// WHY THE EXISTING ALIGNMENT PASS DOES NOT FIX IT. `alignAxis` already clusters
// lights into rows ACROSS chunks, and it is good at what it does — but it moves
// a light WITHIN its cell and never changes the grid. Two limits bound it:
// `alignTol` (1.25 ft) is how far apart two lights may be and still be
// considered the same row at all, and `centreBand` (0.20 of the cell) is how
// far one may then travel. So it closes drift of a foot or so. The foot region
// of a bedroom is out by half a cell — three or four feet — because it is
// running a DIFFERENT NUMBER OF ROWS. No amount of sliding fixes a row count.
//
// SO THIS CHANGES THE GRID, AND ONLY WHERE THE PASS ABOVE HAS ALREADY FAILED.
// The room is laid out normally first. Only if the foot region's lights then
// fail to line up with the flanking ones does any of this run — a bedroom whose
// grid already agrees with itself is never touched, and neither is any room
// without a detected bed.
//
// WHAT IT DOES WHEN IT RUNS
//
//   1. The foot region becomes ONE chunk, spanning the full width of
//      flank + bed + flank. It is often already one; where the decomposition
//      split it, the pieces are merged, because two chunks cannot be given one
//      row of lights. What is left of the chunks it was cut out of stays as it
//      is — except for a piece too small to be a chunk on its own, which joins
//      the neighbour it shares a full edge with rather than being left to go
//      dark. See `carveFootRegion`.
//   2. Its cell lines along the alignment axis are COPIED FROM THE CHUNKS
//      BESIDE THE BED — their own cut lines, plus the bed's two edges, which
//      make the band alongside the bed a row in its own right. So the foot
//      column's cells are the same depth as the cells they sit next to, and a
//      light at the centre of one is level with the light at the centre of the
//      other. Alignment is not searched for or scored; it is what copying the
//      lines MEANS.
//
// WHY NOT DERIVE THE LINES FROM THE LIGHTS THEMSELVES, which was the first
// answer and is the obvious one: size the first cell so its centre lands on the
// light one side of the bed. It works, and it is unusable. A cell's centre is
// its midpoint, so anchoring to a light 0.9 ft off the wall demands a 1.8 ft
// cell — and 1.8 ft is a third of what a 50 sqft brief allows, so the guard
// throws it out. That is not a rare shape: a strip along the side of a bed IS
// shallow, which is exactly why its light is near the wall. Measured over a
// thousand synthetic bedrooms, light-anchoring was refused on this ground in
// 261 rooms and applied in 103.
//
// COPYING THE LINES HAS NO SUCH PROBLEM, and the reason is worth stating: a
// 1.8 ft row in the foot column is a copy of a 1.8 ft row that is already on
// the drawing beside it. Whatever is wrong with a cell that shallow is already
// wrong one chunk to the left, and mirroring it is the thing that makes the two
// read as one grid. So there is no minimum to fail.
//
// THE LIGHTS STAY 7 W. An earlier reading of this rule bought them as the 5 W
// narrow beam, on the theory that a re-cut chunk is a denser chunk. It is not:
// the rows are copies of rows that already carry the 7 W fitting, so the same
// lamp is the consistent choice and the cheaper one to explain — the foot of
// the bed is lit exactly as the sides of it are.
//
// PURE GEOMETRY. No DOM, no model calls, no imports from planner.js — which
// imports this — so the whole thing is testable on numbers alone.
// ---------------------------------------------------------------------------

import { bbox } from './geometry.js';

const EPS = 1e-6;

export const BED_GRID_DEFAULTS = {
  // ft — how close the head of the bed must be to a wall before we are willing
  // to say which end is the foot. A bed floating in the middle of a room has no
  // foot as far as this file is concerned, and guessing one would put a special
  // chunk on an arbitrary side.
  bedHeadGap: 2.0,
  // Fraction of the bed's own run that a chunk must overlap before it counts as
  // flanking it. A chunk clipping the corner of the bed is not beside it.
  flankOverlap: 0.5,
};

/** The bed, if this room has one. The biggest, on the off chance of two. */
export function bedZoneIn(zones = []) {
  const beds = zones.filter((z) => z.cls === 'bed');
  if (!beds.length) return null;
  return beds.reduce((a, b) =>
    ((b.x1 - b.x0) * (b.y1 - b.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a));
}

const lo = (r, ax) => (ax === 'x' ? r.x0 : r.y0);
const hi = (r, ax) => (ax === 'x' ? r.x1 : r.y1);
const other = (ax) => (ax === 'x' ? 'y' : 'x');
const overlap = (a, b, ax) => Math.min(hi(a, ax), hi(b, ax)) - Math.max(lo(a, ax), lo(b, ax));

/**
 * WHICH END OF THE BED IS THE FOOT, and what lies beyond it.
 *
 * The head is the end against a wall — a headboard is not put in the middle of
 * a room — so the four gaps between the bed and the room's bounding box are
 * measured and the smallest is the head. The foot is the opposite end, and the
 * REGION is everything from the bed's foot edge to the far wall.
 *
 * The bounding box and not the outline itself, deliberately: an L-shaped
 * bedroom's far "wall" in a given direction is not a single edge, and the
 * chunks that actually cover the region are what decide its extent below. The
 * box only has to answer which side the bed is pushed against, and for that it
 * is exact whenever the bed is against any wall of the box — which is every
 * case this rule is for.
 *
 * Returns null whenever the answer would be a guess: no bed, a bed adrift in
 * the middle of the floor, no chunk beside it, or nothing beyond its foot.
 */
export function footGeometry({ polygon, zones = [], chunks = [], opt = {} }) {
  const o = { ...BED_GRID_DEFAULTS, ...opt };
  const bed = bedZoneIn(zones);
  if (!bed || !polygon?.length || !chunks.length) return null;

  const box = bbox(polygon);
  // run: the axis the head-to-foot direction lies along.
  // fit: the axis the flanking lights and the foot lights must agree on.
  const sides = [
    { head: 'x0', run: 'x', dir: +1, gap: bed.x0 - box.minX },
    { head: 'x1', run: 'x', dir: -1, gap: box.maxX - bed.x1 },
    { head: 'y0', run: 'y', dir: +1, gap: bed.y0 - box.minY },
    { head: 'y1', run: 'y', dir: -1, gap: box.maxY - bed.y1 },
  ];
  const head = sides.reduce((a, b) => (b.gap < a.gap ? b : a));
  if (head.gap > o.bedHeadGap) return null;   // not against any wall — no foot

  const run = head.run, fit = other(run);
  // The plane the foot region starts at, and which way "beyond" is.
  const cut = head.dir > 0 ? hi(bed, run) : lo(bed, run);
  const beyond = (r) => (head.dir > 0
    ? lo(r, run) >= cut - EPS
    : hi(r, run) <= cut + EPS);

  // FLANKS — a chunk alongside the bed, on the fit axis. It has to be on the
  // bed's own stretch of the run axis (not out past its foot) and has to
  // actually run beside it rather than clip a corner.
  const bedRun = hi(bed, run) - lo(bed, run);
  const flanks = chunks.filter((c) =>
    !beyond(c)
    && overlap(c, bed, run) > o.flankOverlap * bedRun
    && (hi(c, fit) <= lo(bed, fit) + EPS || lo(c, fit) >= hi(bed, fit) - EPS));
  if (!flanks.length) return null;

  const foot = chunks.filter(beyond);
  if (!foot.length) return null;

  // THE SPAN, AND IT IS THE WHOLE POINT OF THE RULE. Flank + bed + flank, on
  // the fit axis — one chunk as wide as everything it has to agree with, rather
  // than however wide the decomposition happened to leave it.
  const spanLo = Math.min(lo(bed, fit), ...flanks.map((c) => lo(c, fit)));
  const spanHi = Math.max(hi(bed, fit), ...flanks.map((c) => hi(c, fit)));

  const region = run === 'x'
    ? { x0: head.dir > 0 ? cut : Math.min(...foot.map((c) => c.x0)),
        x1: head.dir > 0 ? Math.max(...foot.map((c) => c.x1)) : cut,
        y0: spanLo, y1: spanHi }
    : { y0: head.dir > 0 ? cut : Math.min(...foot.map((c) => c.y0)),
        y1: head.dir > 0 ? Math.max(...foot.map((c) => c.y1)) : cut,
        x0: spanLo, x1: spanHi };

  return { bed, run, fit, region, flanks, foot, headGap: head.gap };
}

const inRect = (p, r) => p.x > r.x0 - EPS && p.x < r.x1 + EPS
                      && p.y > r.y0 - EPS && p.y < r.y1 + EPS;

/**
 * EVERY ROW OF LIGHTS BESIDE THE BED — the coordinates the foot region has to
 * meet, whether there is one of them or four.
 *
 * A flank strip is usually one cell deep and so carries one row, but it does not
 * have to. An earlier version of this refused the whole rule whenever a flank
 * carried more than one, because it was ANCHORING to the row and two rows gave
 * it nothing single to anchor to. Copying cut lines has no such difficulty — a
 * flank divided into three rows simply hands three lines across — so the
 * restriction went with the anchoring, and took 93 bedrooms in a thousand with
 * it.
 *
 * Lights within `tol` of each other are one row, which is what stops a light the
 * fan pushed half a foot off its line from being counted as a row of its own.
 */
export function flankAnchors(lights, geo, tol) {
  const vals = [];
  for (const f of geo.flanks) {
    for (const l of lights) if (inRect(l, f)) vals.push(l[geo.fit]);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const rows = [[vals[0]]];
  for (let k = 1; k < vals.length; k++) {
    const run = rows[rows.length - 1];
    if (vals[k] - run[run.length - 1] <= tol) run.push(vals[k]);
    else rows.push([vals[k]]);
  }
  return rows.map((r) => r.reduce((s, v) => s + v, 0) / r.length);
}

/**
 * Is every anchor already served by a light in the foot region?
 *
 * Run AFTER the ordinary layout, alignment pass included — so a false here is
 * not "the grid might disagree", it is "everything the planner already knows
 * how to do has been done and they still do not line up".
 */
export function footIsAligned(lights, geo, anchors, tol) {
  const inFoot = lights.filter((l) => inRect(l, geo.region));
  if (!inFoot.length) return true;    // nothing there to be out of line
  return anchors.every((a) => inFoot.some((l) => Math.abs(l[geo.fit] - a) <= tol));
}

/**
 * THE CUT LINES OF THE CHUNKS BESIDE THE BED, PLUS THE BED'S OWN EDGES.
 *
 * This is the whole rule. The foot column is divided on the alignment axis by
 * exactly the lines its neighbours are divided by, so its cells are the same
 * depth as theirs and their centres coincide. Nothing is searched, nothing is
 * scored, and there is no tolerance: two cells of the same depth with the same
 * top edge have the same centre, and a light at each centre is a level pair.
 *
 * THE BED'S TWO EDGES ARE IN THE LIST because the band alongside the bed is a
 * row of the foot column even though no chunk beside it carries one — the bed
 * is there instead. That row is what the third light in the column sits in.
 *
 * A span longer than the room's own `maxCell` is divided evenly, which is the
 * one place a line appears that was not copied from somewhere. It is for a bed
 * long enough that the band beside it would otherwise be a single very deep
 * cell; the lights it adds have nothing beside them to line up with, so they
 * are free to fall where the ordinary rule would put them.
 *
 * There is NO MINIMUM here, unlike everywhere else a grid is chosen, and that
 * is deliberate — see the note at the top of this file. Every copied line
 * bounds a cell that already exists one chunk away.
 *
 * `flanks` must be chunks that have already been gridded, so `xLines`/`yLines`
 * are on them. Returns null when the copy would not actually divide anything.
 */
export function flankFitLines(geo, opt) {
  const key = geo.fit === 'x' ? 'xLines' : 'yLines';
  const low = lo(geo.region, geo.fit);
  const high = hi(geo.region, geo.fit);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const inside = (v) => v > low + EPS && v < high - EPS;

  const set = new Set([r6(low), r6(high)]);
  for (const f of geo.flanks) {
    for (const v of (f[key] || [])) if (inside(v)) set.add(r6(v));
  }
  for (const v of [lo(geo.bed, geo.fit), hi(geo.bed, geo.fit)]) if (inside(v)) set.add(r6(v));

  let lines = [...set].sort((a, b) => a - b);
  if (lines.length < 3) return null;   // one cell is not a division

  const max = opt.maxCell ?? Infinity;
  const out = [lines[0]];
  for (let k = 0; k < lines.length - 1; k++) {
    const span = lines[k + 1] - lines[k];
    const n = span > max + EPS ? Math.ceil(span / max) : 1;
    for (let i = 1; i <= n; i++) out.push(r6(lines[k] + (i / n) * span));
  }
  return out;
}

/**
 * THE FOOT REGION AS ONE CHUNK, CARVED OUT OF WHATEVER WAS THERE.
 *
 * This used to only MERGE — replace the pieces lying inside the region with the
 * region itself — and that was not enough on any real bedroom. The band below a
 * bed usually runs the full width of the room, past the foot of the bed and on
 * to the far wall, so it STRADDLES the region rather than sitting inside it.
 * Merging refused, and the whole rule declined on exactly the plans it was
 * written for.
 *
 * So a straddling chunk is cut instead: the part inside the region is absorbed,
 * and the part outside stays as a chunk of its own. That is what the sketch of
 * this rule shows — the bands either side of the bed stop at the foot line, and
 * the column beyond it runs the full depth of all three.
 *
 * IT STILL REFUSES TO CREATE SLIVERS. A cut that leaves a two-inch offcut has
 * not read the room right, and a chunk under the room\'s own `minChunk` /
 * `minChunkArea` would be dropped by the chunker if it had produced it — so
 * producing one here and keeping it would be putting a light somewhere the
 * decomposition has already said is too small to light. Any such offcut and the
 * whole carve is refused, which leaves the ordinary layout standing.
 *
 * It also refuses when the region is not fully covered: a hole in it is a duct
 * or an enclosed room the decomposition worked around, and paving over it would
 * put a fitting exactly where something else already said not to.
 */
/**
 * THE AREA OF A SET OF RECTANGLES, COUNTING OVERLAP ONCE.
 *
 * A plain sum would double-count, and here that is not a rounding error — it is
 * the difference between "this region is accounted for" and "this region has a
 * gap in it", which is the whole judgement `carveFootRegion` makes below. Two
 * no-light zones genuinely do overlap: a hand-drawn box over a wardrobe the
 * detector also found is one piece of ceiling and two rectangles.
 *
 * A SLAB SWEEP, because the inputs are axis-aligned and there are a handful of
 * them. Cut at every x, and in each slab merge the y-intervals of the rectangles
 * that span it. Exact, twenty lines, and no dependency.
 */
function unionArea(rects) {
  if (!rects.length) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const w = xs[i + 1] - xs[i];
    if (w <= EPS) continue;
    const spans = rects
      .filter((r) => r.x0 <= xs[i] + EPS && r.x1 >= xs[i + 1] - EPS)
      .map((r) => [r.y0, r.y1])
      .sort((a, b) => a[0] - b[0]);
    let acc = 0;
    let cur = null;
    for (const [a, b] of spans) {
      if (!cur || a > cur[1]) { if (cur) acc += cur[1] - cur[0]; cur = [a, b]; }
      else cur[1] = Math.max(cur[1], b);
    }
    if (cur) acc += cur[1] - cur[0];
    total += w * acc;
  }
  return total;
}

/** A rectangle clipped to another, or null when they do not meet. */
function clipTo(r, R) {
  const x0 = Math.max(r.x0, R.x0), x1 = Math.min(r.x1, R.x1);
  const y0 = Math.max(r.y0, R.y0), y1 = Math.min(r.y1, R.y1);
  return (x1 - x0 > EPS && y1 - y0 > EPS) ? { x0, y0, x1, y1 } : null;
}

export function carveFootRegion(chunks, geo, opt = {}) {
  const R = geo.region;
  const minSide = opt.minChunk ?? 1.5;
  const minArea = opt.minChunkArea ?? 9;
  const clash = (c) => Math.min(c.x1, R.x1) - Math.max(c.x0, R.x0) > EPS
                    && Math.min(c.y1, R.y1) - Math.max(c.y0, R.y0) > EPS;

  const kept = [];
  let covered = 0;
  for (const c of chunks) {
    if (!clash(c)) { kept.push(c); continue; }
    const ix0 = Math.max(c.x0, R.x0), ix1 = Math.min(c.x1, R.x1);
    const iy0 = Math.max(c.y0, R.y0), iy1 = Math.min(c.y1, R.y1);
    covered += (ix1 - ix0) * (iy1 - iy0);
    // What is left of this chunk once the region is taken out of it: the strip
    // to each side of the overlap, then the strip above and below what remains
    // between them. Up to four pieces; on a region that touches three walls,
    // in practice one.
    for (const r of [
      { x0: c.x0, x1: ix0, y0: c.y0, y1: c.y1 },
      { x0: ix1, x1: c.x1, y0: c.y0, y1: c.y1 },
      { x0: ix0, x1: ix1, y0: c.y0, y1: iy0 },
      { x0: ix0, x1: ix1, y0: iy1, y1: c.y1 },
    ]) {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      if (w <= EPS || h <= EPS) continue;
      // NOT VALIDATED YET. A piece too small to stand on its own may still have
      // a neighbour to join — see the absorb pass below, which runs once every
      // leftover exists rather than judging them one at a time in here.
      kept.push({ ...r, w, h, area: w * h });
    }
  }

  /* --- A LEFTOVER TOO SMALL TO BE A CHUNK JOINS THE ONE NEXT TO IT ----------
   *
   * WHY THIS IS NOT "LET THE SMALL PIECE THROUGH". A chunk under the planner's
   * own minimums is OMITTED — left dark, no light — so producing one would take
   * the light off a corner of the room that has one today. That is what the
   * refusal was protecting against, and it was right to.
   *
   * WHAT IT MISSED IS THAT THE PIECE DOES NOT HAVE TO BE A CHUNK. Cutting a
   * full-width course out of a room leaves the corner of that course standing
   * on top of the flank below it — same width, touching along its whole edge —
   * and the two together are one perfectly ordinary rectangle. Refusing the
   * whole re-cut because a piece would be lonely, when the piece has a neighbour
   * it fits exactly, is a bedroom losing its alignment over an arithmetic
   * accident.
   *
   * A FULL SHARED EDGE AND NOTHING LESS. Two rectangles only merge into a
   * rectangle when they agree exactly on one axis and touch on the other; a
   * partial overlap would give an L, and every downstream reader here assumes a
   * chunk is a box. So this can absorb a corner into a flank and cannot invent
   * a shape.
   *
   * REPEATED UNTIL NOTHING MOVES, because absorbing one piece can make its
   * neighbour absorbable in turn, and the pass is a handful of rectangles.
   * A piece with nowhere to go still refuses — with its measurements, so the
   * panel can say which piece and by how much. */
  const fails = (c) => Math.min(c.w, c.h) < minSide - EPS || c.w * c.h < minArea - EPS;
  const joins = (a, b) =>
    (Math.abs(a.x0 - b.x0) < EPS && Math.abs(a.x1 - b.x1) < EPS
      && (Math.abs(a.y1 - b.y0) < EPS || Math.abs(b.y1 - a.y0) < EPS))
    || (Math.abs(a.y0 - b.y0) < EPS && Math.abs(a.y1 - b.y1) < EPS
      && (Math.abs(a.x1 - b.x0) < EPS || Math.abs(b.x1 - a.x0) < EPS));
  for (let moved = true; moved;) {
    moved = false;
    for (let i = 0; i < kept.length && !moved; i++) {
      if (!fails(kept[i])) continue;
      const j = kept.findIndex((q, k) => k !== i && joins(kept[i], q));
      if (j < 0) continue;
      const a = kept[i], b = kept[j];
      const box = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
                    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
      kept.splice(Math.max(i, j), 1);
      kept.splice(Math.min(i, j), 1);
      kept.push({ ...b, ...box, w: box.x1 - box.x0, h: box.y1 - box.y0,
                  area: (box.x1 - box.x0) * (box.y1 - box.y0) });
      moved = true;
    }
  }
  const stranded = kept.find(fails);
  if (stranded) {
    /* THE PIECE ITSELF COMES BACK, NOT JUST A NO. "It would leave a sliver" is
       true of every refusal and actionable in none: two minimums can refuse, a
       piece can miss either by a hair or by half, and "is the minimum wrong or
       is the room wrong" is a measurement. */
    return { chunks: null, foot: null,
             blocked: { w: stranded.w, h: stranded.h,
                        area: stranded.w * stranded.h, minSide, minArea } };
  }

  /* WHAT THE REGION SHOULD ADD UP TO — ITS AREA, LESS THE HOLES IN IT.
   *
   * THE TEST IS THAT NOTHING IS UNACCOUNTED FOR, and it used to say that as
   * "the chunks cover every inch of the region". That was true while the only
   * no-light zone a bedroom had was the bed, which is outside this region by
   * construction — the region starts at the bed's FOOT edge. It stopped being
   * true the day a detected wardrobe became a no-light zone: a wardrobe running
   * past the foot of the bed puts a hole inside the region, no chunk covers a
   * hole, the sums came up short, and a bedroom that wanted this rule was
   * refused it for a reason that was not a fault.
   *
   * A HOLE IS ACCOUNTED FOR. That is the distinction the old test could not
   * draw: a piece of the region belonging to no chunk is a gap when nobody
   * meant it and a zone when somebody did, and only the second is fine. So the
   * zones inside the region are discounted from what the chunks are expected to
   * add up to, and a genuine gap still fails exactly as before.
   *
   * AND THE FOOT CHUNK STILL SPANS THE WHOLE RECTANGLE, hole included, which is
   * the point of the rule rather than a compromise with it: the foot region has
   * to be ONE chunk to be given one grid copied from the flanks — two chunks
   * either side of the wardrobe would be gridded independently, which is the
   * misalignment this file exists to remove. The wardrobe does not get a light
   * out of that: a cell inside a no-light zone cannot place one near its centre,
   * so it comes out `awkward` and is ceded (see `omitAwkwardCells` in
   * planner.js). The chunk covers the wardrobe; the light does not.
   */
  const holes = (geo.holes ?? []).map((z) => clipTo(z, R)).filter(Boolean);
  const full = (R.x1 - R.x0) * (R.y1 - R.y0);
  const want = full - unionArea(holes);
  if (Math.abs(covered - want) > Math.max(1e-4, full * 1e-6)) {
    return { chunks: null, foot: null, uncovered: want - covered };
  }

  const foot = { ...R, w: R.x1 - R.x0, h: R.y1 - R.y0, area: full };
  return { chunks: [...kept, foot], foot, blocked: null, uncovered: 0 };
}

/**
 * WHY A CARVE WAS REFUSED, in a sentence with the numbers in it.
 *
 * Built here rather than in the planner because the numbers are here: the piece
 * that failed, and the two minimums it failed against. The planner's job is to
 * decide WHEN to ask, not to know what a sliver is.
 */
export function carveRefusal(res) {
  if (!res || res.chunks) return null;
  if (res.blocked) {
    const { w, h, area, minSide, minArea } = res.blocked;
    const thin = Math.min(w, h) < minSide;
    return `cutting the foot region out would leave a ${w.toFixed(1)} × ${h.toFixed(1)} ft`
      + ` piece — ${thin ? `under the ${minSide} ft minimum width`
                         : `${area.toFixed(1)} sqft, under the ${minArea} sqft minimum`}`;
  }
  if (res.uncovered > 0) {
    return `${res.uncovered.toFixed(1)} sqft of the foot region belongs to no chunk`;
  }
  return 'the foot region could not be cut out';
}

/**
 * Everything the second pass needs — and, when there is to be no second pass,
 * WHY.
 *
 * THE REASON IS NOT DEBUG OUTPUT, it is the feature's only visible surface when
 * it declines. This rule does nothing to most bedrooms and that is by design,
 * so "it did not change" is its ordinary behaviour and is indistinguishable
 * from "it is not switched on" or "it is broken" unless it says which. The
 * string comes back to the planner, into `stats.bedFoot`, and out to the admin
 * panel, where somebody looking at a bedroom that still does not line up can
 * read the sentence rather than guess.
 *
 * Called once, on a finished layout. A room that gets `plan: null` here is laid
 * out exactly as this app has always laid it out.
 */
export function bedFootPlan({ polygon, zones, chunks, lights, opt }) {
  const no = (why) => ({ plan: null, why });

  // A ROOM WITH NO BED GETS NO SENTENCE, not even "no bed". The reason is
  // reported per space in the admin panel, and a rule that announced its
  // irrelevance in every kitchen, corridor and balcony on the sheet would bury
  // the one bedroom it has something to say about.
  if (!bedZoneIn(zones)) return { plan: null, why: null };
  const geo = footGeometry({ polygon, zones, chunks, opt });
  if (!geo) {
    return no('the bed is not against a wall, or there is no chunk beside it '
      + 'and none beyond its foot');
  }
  const tol = opt.alignSnap ?? 0.15;
  const anchors = flankAnchors(lights, geo, tol);
  if (!anchors) return no('there are no lights beside the bed to line up with');
  if (anchors.length < 2) return no('only one row of lights beside the bed');
  if (footIsAligned(lights, geo, anchors, tol)) return no('already lined up');

  // THE LINES ARE TAKEN NOW, off the flanks this pass has already gridded, and
  // carried to the second pass rather than recomputed there. They are the same
  // either way — the merge only touches chunks inside the foot region and the
  // flanks are outside it, so their grids are identical in both passes — and
  // taking them here means the second pass never has to care what order it
  // grids chunks in.
  // THE LINES THEMSELVES ARE NOT CARRIED. They are read again on the second
  // pass, off the flanks AS THEY END UP THERE — the carve stops those flanks at
  // the foot line, so they are not the same rectangles this pass gridded, and a
  // line copied from the wrong shape is worse than no line at all. What is
  // carried is only the region; the lines follow from it. This call is the
  // dry run: if there is nothing to copy, there is no point laying the room out
  // a second time.
  if (!flankFitLines(geo, opt)) {
    return no('the chunks beside the bed have no cut lines to copy');
  }
  /* THE HOLES TRAVEL WITH THE PLAN. The second pass re-decomposes the room and
     re-reads the flank lines off the chunks it produces, but the ZONES are the
     same list it was handed in the first place — so carrying them here costs
     nothing and saves threading a fourth argument through `applyBedFootPlan`
     for a fact this function already has in its hand. Clipped and non-bed only:
     the bed is outside the region by construction, and a rectangle that does
     not reach the region is not a hole in it. */
  const holes = zones.filter((z) => z.cls !== 'bed'
    && Math.min(z.x1, geo.region.x1) - Math.max(z.x0, geo.region.x0) > EPS
    && Math.min(z.y1, geo.region.y1) - Math.max(z.y0, geo.region.y0) > EPS);
  return { plan: { fit: geo.fit, anchors, region: geo.region, holes }, why: null };
}

/**
 * Apply a plan to a fresh decomposition: merge the foot pieces into one chunk
 * and mark it. Returns the chunk list to use, unchanged if the merge is unsafe.
 */
export function applyBedFootPlan(chunks, plan, opt = {}) {
  if (!plan) return chunks;
  const merged = carveFootRegion(chunks,
    { region: plan.region, fit: plan.fit, holes: plan.holes ?? [] }, opt);
  if (!merged?.chunks) return chunks;
  // NO FIXTURE OVERRIDE. The rows are copies of rows that already carry this
  // room\'s ordinary fitting, so the foot of the bed is lit with the same lamp
  // as the sides of it. See the note at the top of this file.
  merged.foot.bedFoot = { fit: plan.fit };
  return merged.chunks;
}
