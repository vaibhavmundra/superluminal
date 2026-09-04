// ---------------------------------------------------------------------------
// planner.js — the actual layout engine. Input: a rectilinear polygon in FEET
// plus optional fixtures and no-light zones. Output: chunks, grids and lights.
//
// Pipeline
//   1. carve      — subtract the no-light zones from the room, as if the
//                   outline of the space had changed
//   2. chunk      — ADOPT one of the ways what's left can be cut into
//                   rectangles. The planner does not invent the decomposition:
//                   chunking.js enumerates the candidates, somebody chooses,
//                   and the choice arrives here as `chunkStrategy` (an id) or
//                   `chunkPlan` (an explicit set of rectangles). With neither,
//                   the heuristic recommendation is used so a headless call
//                   still works. Chunks thinner than minChunk, or smaller than
//                   minChunkArea overall, are omitted.
//   3. grid       — each chunk is divided into its own near-square grid.
//                   There is nothing sacred about 6x6: the target cell is a
//                   preference, and every chunk sizes its cells to suit its
//                   own width and height.
//   3b. classify   — a cell that cannot hold a small light near its own centre
//                   is "awkward", and the matching bids to cover it instead
//   4. lights     — a SMALL light at the centre of every cell is the default.
//                   Where a cell cannot take one (a fan's clearance covers its
//                   centre band), it is paired with a neighbour and served by a
//                   LARGE light on their shared grid line instead. Zone edges
//                   count as walls for the wall-distance rule.
//   5. align      — snap light coordinates into shared rows/columns, across
//                   chunk boundaries too, then re-seat any light that ended up
//                   diagonal to its own cell back onto a centre line
//   6. fixtures   — clear anything fouling any of the ceiling fans
// ---------------------------------------------------------------------------

import { bbox, pointInPolygon, distanceToBoundary } from './geometry.js';
import { maxWeightMatching } from './matching.js';
import {
  enumerateChunkings, findChunking, prepareZones,
  normalizeZone, pointInZone, inAnyZone,
} from './chunking.js';
import { bedFootPlan, applyBedFootPlan, carveFootRegion, carveRefusal, footGeometry, flankFitLines, BED_GRID_DEFAULTS } from './bedGrid.js';

// Zone geometry lives in chunking.js — it is what defines the chunks — but the
// planner has always exported normalizeZone, so callers keep working.
export { normalizeZone, prepareZones, enumerateChunkings };

/**
 * The brief is an AREA. Everything about a cell's sides follows from it.
 *
 * `targetArea` is the number a person actually states — "about 50 square feet
 * to a light". The ideal side is its square root, and the bounds on a side are
 * fixed fractions of that: 2/3 and 4/3, the same proportions the old absolute
 * 4 ft and 8 ft bore to a 6 ft ideal. Keeping them proportional keeps the
 * ASPECT envelope identical as the area moves — the worst oblong the bounds
 * admit is the same shape at 36 sqft as at 50 — which is why they are derived
 * rather than left as constants to drift out of step.
 *
 * Any of the three can still be passed explicitly to override its derivation.
 */
/**
 * WHAT A FOOT OF COVE PUTS ON THE ROOM, in lumens.
 *
 * NOT the tape's own output. A cove is an INDIRECT source: the strip is hidden
 * in a pocket, fires at the ceiling, and what reaches the room is what the
 * ceiling and the pocket's own walls give back. 120 lm/ft is that delivered
 * figure — a 850 lm/m tape (see the BOQ catalogue, which is where the product
 * is) run through a plaster pocket, after the reflection and the maintenance
 * losses have been taken. It is the number to change when the tape or the
 * pocket detail changes, and it is stated here rather than derived because a
 * drawing cannot know either.
 *
 * REVERSE COVES ARE NOT THIS. A reverse cove throws light downward onto the
 * wall instead of upward onto the ceiling, delivers far more of it and does a
 * different job. Nothing in this file plans one; if one is ever added it needs
 * its own figure rather than a factor on this one.
 */
export const COVE_LUMENS_PER_FT = 120;

export const MIN_SIDE_RATIO = 2 / 3;
export const MAX_SIDE_RATIO = 4 / 3;

/** The side lengths implied by a target cell area. */
export function sidesForArea(area) {
  const side = Math.sqrt(area);
  return {
    targetCell: Math.round(side * 100) / 100,
    minCell: Math.round(side * MIN_SIDE_RATIO * 100) / 100,
    maxCell: Math.round(side * MAX_SIDE_RATIO * 100) / 100,
  };
}

/** Fill in whatever a caller left to be derived from targetArea. */
export function resolveOptions(o) {
  const derived = sidesForArea(o.targetArea ?? 50);
  return {
    ...o,
    targetCell: o.targetCell ?? derived.targetCell,
    minCell: o.minCell ?? derived.minCell,
    maxCell: o.maxCell ?? derived.maxCell,
  };
}

/**
 * THE SAME OPTIONS WITH A DIFFERENT CELL, AND THE SIDES RE-DERIVED WITH IT.
 *
 * `{ ...opt, targetArea: 25 }` IS NOT ENOUGH, and this helper exists because
 * that is what the app was doing. `resolveOptions` MATERIALISES targetCell,
 * minCell and maxCell — PLAN_OPTIONS is a resolved object, so those three keys
 * are present and hold the 50 sqft answer. Spreading a new `targetArea` over it
 * changes the area band in `bestGrid` and leaves every SIDE dial pointing at a
 * 7.07 ft cell: `partitionAxis`, `sidesFor` and `evenCounts` all score against
 * targetCell/minCell/maxCell, so the grid went on being pulled towards the
 * cell it was told not to use. Kitchens have been half-overridden the whole
 * time — the band said 25 and the sides said 50 — and the same trap would have
 * swallowed the office override.
 *
 * So the three derived keys are dropped and re-derived. Anything a caller
 * pinned by hand is pinned deliberately and would survive; nothing does.
 */
export function withTargetArea(o, area) {
  const { targetCell: _tc, minCell: _mn, maxCell: _mx, ...rest } = o;
  return resolveOptions({ ...rest, targetArea: area });
}

export const DEFAULTS = {
  // targetCell / minCell / maxCell are DERIVED from targetArea — see
  // resolveOptions. They are absent here on purpose: pinning them in the
  // defaults is what let the ideal side say 6 ft while the area said 50.
  minBand: 3.0,           // ft — a band thinner than this dissolves into its neighbour
  minChunk: 1.5,          // ft — a chunk this thin (either dimension) is omitted entirely
  minChunkArea: 9.0,      // sqft — ...and so is one this small overall, however
                          //   square. Two rules rather than one because they
                          //   fail differently: a 1.4ft x 20ft strip behind a
                          //   duct is caught by the side rule, and a 2ft x 2ft
                          //   notch beside a chimney breast passes that and is
                          //   caught by this one. Neither deserves a light.
  chunkStrategy: 'auto',  // which of the enumerated decompositions to lay the
                          //   grid on: a strategy id from chunking.js, or
                          //   'auto' for the heuristic recommendation. The app
                          //   sets this from what the user picked.
  chunkPlan: null,        // ...or an explicit { chunks, omitted } handed in
                          //   whole, for a decomposition that came from
                          //   somewhere other than the strategy list.
  coves: [],              // cove outlines in THIS space's feet, as rectangles.
                          //   A cove is not a wall and not a no-light zone: the
                          //   ceiling carries straight on across it. What it is
                          //   is a LINE NOTHING MAY SIT NEAR, because a
                          //   downlight crowding the pocket washes the cove out
                          //   and one just outside it is lost in the pocket's
                          //   own glow. See coveInside / coveOutside.
  coveInside: 2.0,        // ft — no fitting this close to a cove line, on the
                          //   room side of it
  coveOutside: 1.0,       // ft — ...or this close on the pocket side. Smaller,
                          //   because the band out there is narrow by
                          //   construction and a fitting in it is lighting the
                          //   perimeter rather than competing with the cove.
  minWallDistance: 5.0,   // ft — a large light must be this far from the NEAREST
                          //      wall in every direction. Zone edges are walls.
                          //      The design rule is 6 ft; 5 ft is that rule with
                          //      its working tolerance.
  minSharedEdge: 3.0,     // ft — cells must share at least this much wall to pair up
  allowChunkAxis: true,   // a large light may slide along its grid line to sit on
                          //   one of the chunk's centre axes
  allowGridEdgePositions: true, // ...or all the way to a grid intersection
  allowEdgeSliding: true, // a large light may sit anywhere along its grid line,
                          //   not only at the midpoint, chunk axis or vertices
  vertexBand: 0.5,        // ft — dead band beside each vertex, so a light is
                          //   either ON the vertex (lighting four boxes) or
                          //   clearly away from it (lighting two)
  chunkAxisBonus: 1.5,    // what landing on the midpoint or a chunk axis is worth
  alignSnap: 0.15,        // ft — how close counts as "lined up with"
  misalignPenalty: 1.5,   // what a large light lining up with nothing costs,
                          //   priced in boxes so it can actually compete
  allowRoaming: true,     // last resort: a large light may leave its grid line
  roamSpan: 0.35,         // how far off the shared edge it may roam, as a
                          //   fraction of half the pair's width
  roamPenalty: 0.75,      // what leaving the grid line costs. Below the price of
                          //   two healthy boxes, so a roaming light that keeps
                          //   every small light beats a vertex that eats two —
                          //   above zero, so an on-line spot always wins first.
  minLightSpacing: 3.9,   // ft — no two lights closer than this. Midpoints are
                          //   naturally spread; the off-midpoint spots are not,
                          //   so without this two large lights can end up a
                          //   foot apart.
  offCentrePenalty: 1.5,  // what sliding the full half-length away costs
  cellEdgePad: 0.10,      // fraction of the cell a nudged light keeps clear of its own edge
  centreBand: 0.20,       // a small light must sit within this fraction of the cell
                          //   from its centre. A cell that cannot take one is
                          //   "awkward": the matching bids to cover it with a
                          //   large light instead.
  sizeWeight: 4.0,        // how hard partitionAxis alone holds a band to targetCell.
                          //   A chunk's own grid is judged on area instead — see
                          //   targetArea below — because a cell is a 2D thing.
  targetArea: 50.0,       // sqft — what one cell should cover. The whole brief,
                          //   stated in the quantity that actually matters; the
                          //   sides follow from it (see sidesForArea).
  areaTol: 0.25,          // ± fraction of targetArea that is acceptable: 37.5 to
                          //   62.5 sqft. Not slop — an acceptance band. A grid
                          //   whose cells all sit inside it beats one that leaves
                          //   it, whatever else is on offer.
  areaWeight: 6.0,        // how steeply a cell outside the band is penalised. Well
                          //   above fanLineWeight, so the fan never drags a grid
                          //   out of the band — it only chooses within it.
  sizeBias: 1.0,          // BIGGER IS BETTER, inside the band. The cost of a cell
                          //   falls as its area rises, so between two divisions
                          //   that both qualify the coarser one wins: fewer, larger
                          //   boxes. Held below fanLineWeight on purpose — the fan
                          //   is settled first, and only then does the grid reach
                          //   for the biggest cells that still fit the band.
  shapeWeight: 0.8,       // what an oblong cell costs, per unit of aspect ratio
                          //   beyond square. Priced on the RATIO, not on distance
                          //   from the ideal side, so it does not quietly fight
                          //   sizeBias — a big square cell and a small square cell
                          //   are equally square.
  fanLineWeight: 2.5,     // what putting a grid line exactly on the one fan in a
                          //   chunk is worth, per axis. Above the whole spread of
                          //   sizeBias and shapeWeight combined, so a fan on a
                          //   line is never traded away for a bigger cell.
  fanCornerBonus: 2.5,    // ...and what hitting BOTH axes is worth on top, because
                          //   a fan on an intersection is a shared corner of four
                          //   cells, while a fan on a single line can sit level
                          //   with the centres of the two cells it divides.
  awkwardGridPenalty: 0.25, // a mild tiebreak against grids that park a fan on a
                          //   cell centre — not enough to distort the grid, since
                          //   such a cell is ceded gracefully anyway
  smallFirst: true,       // Small lights are the default: every cell gets one at
                          //   its centre. A large light is only used where a
                          //   small one is impossible — see the pricing below.
  rescueValue: 10,        // what lighting a box that cannot take a small light is
                          //   worth. Deliberately far above pairCostNormal: if a
                          //   large light CAN reach such a box we always want it,
                          //   and only the choice between rescues is a trade-off.
  pairCostNormal: 0.5,    // what it costs to pull a healthy box into a large
                          //   light's coverage and take away its own centred
                          //   light. Raise it above rescueValue to prefer ceding.
  omitAwkwardCells: true, // a cell that can take neither a centred small light
                          //   nor a shared large one gets NO light of its own —
                          //   the fan is the ceiling feature there. Set false to
                          //   place an off-centre light anyway.
  awkwardPriority: 2.0,   // how much a large light covering an awkward cell is
                          //   worth, in units of "one ordinary cell covered".
                          //   0 turns the whole preference off.
  alignTol: 1.25,         // ft — lights within this get snapped into a row/column
  fanClearance: 1.0,      // ft — keep lights this far outside the fan's blade circle
  fanAnchorWeight: 0.6,   // how hard each chunk's grid tries to line up with the fans
  preferLongAxis: true,
  uniformOrientation: true, // pair every cell the same way when it costs nothing
  // THE BEDROOM RULE — see bedGrid.js. On by default and self-limiting: it does
  // nothing at all unless the room has a detected bed AND the ordinary layout
  // left the foot region's lights out of line with the ones either side of it.
  // Set false to have this app lay bedrooms out exactly as it did before.
  bedFootAlign: true,
  ...BED_GRID_DEFAULTS,
};

// --- no-light zones ---------------------------------------------------------

/** How deep inside the zones a point sits — 0 when clear. Used as a penalty. */
function zoneDepth(p, zones) {
  let d = 0;
  for (const z of zones) {
    if (!pointInZone(p, z)) continue;
    d += Math.min(p.x - z.x0, z.x1 - p.x, p.y - z.y0, z.y1 - p.y);
  }
  return d;
}

/** Distance from a point to a rectangle's boundary (works inside and out). */
function rectEdgeDistance(p, z) {
  const dx = Math.max(z.x0 - p.x, 0, p.x - z.x1);
  const dy = Math.max(z.y0 - p.y, 0, p.y - z.y1);
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - z.x0, z.x1 - p.x, p.y - z.y0, z.y1 - p.y);
}

/**
 * The coves an option asked for, in the one shape the rest of this file uses.
 *
 * Sorted corners and the two clearances resolved per cove, so every reader
 * downstream — the small-light search, the large-light candidates, the
 * alignment pass — asks the same question of the same object rather than each
 * re-deriving it from `opt`.
 */
function prepareCoves(coves, opt) {
  return (coves || []).map((c) => ({
    x0: Math.min(c.x0, c.x1), x1: Math.max(c.x0, c.x1),
    y0: Math.min(c.y0, c.y1), y1: Math.max(c.y0, c.y1),
    inside: c.inside ?? opt.coveInside,
    outside: c.outside ?? opt.coveOutside,
  }));
}

/** How far into a cove's dead band a point sits — 0 when clear of every one. */
function coveDepth(p, coves) {
  let v = 0;
  for (const cv of coves) {
    const within = p.x > cv.x0 && p.x < cv.x1 && p.y > cv.y0 && p.y < cv.y1;
    const need = within ? cv.inside : cv.outside;
    const d = rectEdgeDistance(p, cv);
    if (d < need - 1e-9) v += need - d;
  }
  return v;
}

/** The same question as a yes/no, for the passes that only need to refuse. */
function coveBlocked(p, opt) {
  return coveDepth(p, opt.coves || []) > 1e-9;
}

// --- which decomposition do we lay the grid on? -----------------------------

/**
 * The decomposition is a DECISION, not a derivation.
 *
 * An L-shaped room can be cut into two rectangles two different ways and
 * neither is wrong — which one is right depends on how the space is used, which
 * the geometry does not know. So the planner never invents one. chunking.js
 * enumerates the candidates, somebody chooses, and the choice arrives here:
 *
 *   opt.chunkPlan      an explicit { chunks, omitted } — used verbatim. This is
 *                      the user's (or a model's) answer; re-deriving it would
 *                      silently overrule them.
 *   opt.chunkStrategy  a strategy id from chunking.js.
 *   neither            the heuristic recommendation, so a headless call
 *                      (a test, a script, an export) still produces a layout.
 *
 * A requested strategy that no longer exists — the sliders moved, and two
 * strategies that used to differ now agree — falls back to the recommendation
 * rather than failing, and says so in `unavailable`.
 */
function resolveChunking(polygon, zones, opt, fans) {
  if (opt.chunkPlan && Array.isArray(opt.chunkPlan.chunks) && opt.chunkPlan.chunks.length) {
    const p = opt.chunkPlan;
    return {
      id: p.id || 'given', label: p.label || 'Chosen configuration', strategy: p.strategy || null,
      blurb: p.blurb || '', highlights: p.highlights || [], metrics: p.metrics || null,
      chunks: p.chunks, omitted: p.omitted || [],
      optionCount: null, recommendedId: null, needsChoice: null,
      chosenBy: 'given', unavailable: null,
    };
  }
  const all = enumerateChunkings(polygon, zones, opt, fans);
  const wanted = opt.chunkStrategy && opt.chunkStrategy !== 'auto'
    ? findChunking(all.options, opt.chunkStrategy) : null;
  const chosen = wanted || findChunking(all.options, all.recommendedId);
  if (!chosen) {
    return { id: null, label: null, strategy: null, blurb: '', highlights: [], metrics: null,
             chunks: [], omitted: [], optionCount: 0, recommendedId: null,
             needsChoice: false, chosenBy: 'none', unavailable: null };
  }
  return {
    id: chosen.id, label: chosen.label, strategy: chosen.strategy, blurb: chosen.blurb,
    highlights: chosen.highlights || [], metrics: chosen.metrics,
    chunks: chosen.chunks, omitted: chosen.omitted,
    optionCount: all.options.length, recommendedId: all.recommendedId,
    needsChoice: all.needsChoice,
    chosenBy: wanted ? 'requested' : 'auto',
    unavailable: (opt.chunkStrategy && opt.chunkStrategy !== 'auto' && !wanted) ? opt.chunkStrategy : null,
  };
}

/** What the caller gets to know about the decomposition it ended up with,
 *  minus the rectangles themselves (those are already in `chunks`). */
function chunkingReport(c) {
  return {
    id: c.id, label: c.label, strategy: c.strategy, blurb: c.blurb,
    highlights: c.highlights, metrics: c.metrics,
    optionCount: c.optionCount, recommendedId: c.recommendedId,
    needsChoice: c.needsChoice, chosenBy: c.chosenBy, unavailable: c.unavailable,
  };
}

/**
 * Subtract the zones from the room and decompose the remaining space into
 * rectangular chunks — the single-answer form kept for callers that just want
 * one. It resolves through the same path as the planner, so "the default
 * decomposition" means one thing in this codebase, not two.
 *
 * For the actual candidate list, use enumerateChunkings() in chunking.js.
 */
export function decomposeIntoChunks(polygon, zones, opt) {
  const picked = resolveChunking(polygon, zones, { ...DEFAULTS, ...opt }, []);
  return {
    chunks: picked.chunks.map((c) => ({ ...c })),
    omitted: picked.omitted.map((c) => ({ ...c })),
  };
}

// --- 1D band partition ------------------------------------------------------

const ANCHOR_TOL = 0.05;   // ft — "on the line" to within about half an inch

/**
 * Split [lo,hi] into n pieces such that each is close to target, then score
 * how well the resulting cut lines / centres line up with the soft anchors.
 */
function scoreSplit(lo, hi, n, softAnchors, opt) {
  const size = (hi - lo) / n;
  let penalty = Math.abs(size - opt.targetCell) / opt.targetCell;
  if (size < opt.minCell) penalty += 3 * (opt.minCell - size);
  if (size > opt.maxCell) penalty += 3 * (size - opt.maxCell);

  // Reward a CUT LINE landing on a soft anchor — never a cell centre.
  //
  // This matters more than it looks. A fan parked on a cell centre is the worst
  // case there is: that cell can never hold a small light near its middle, and
  // every grid intersection around it is inside the fan's clearance circle too,
  // so no large light can rescue it either. Put the fan on a grid intersection
  // instead and it becomes a shared corner of four cells, each of whose centres
  // is half a diagonal away — comfortably clear.
  let bonus = 0;
  for (const a of softAnchors) {
    if (a < lo - 1e-6 || a > hi + 1e-6) continue;
    let best = Infinity;
    for (let k = 0; k <= n; k++) best = Math.min(best, Math.abs(lo + k * size - a));
    bonus += opt.fanAnchorWeight * Math.max(0, 1 - best / (opt.targetCell * 0.5));
  }
  return bonus - penalty;
}

export function partitionAxis(hardAnchors, softAnchors, opt) {
  const bands = dissolveBands(hardAnchors, opt);
  const lines = [bands[0]];
  for (let i = 0; i < bands.length - 1; i++) {
    const cands = bandCandidates(bands[i], bands[i + 1], softAnchors, opt);
    const best = cands.reduce((a, b) => (b.score > a.score ? b : a));
    lines.push(...best.lines.slice(1));
  }
  return [...new Set(lines.map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
}

function dissolveBands(hardAnchors, opt) {
  const uniq = [...new Set(hardAnchors.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const kept = [uniq[0]];
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] - kept[kept.length - 1] >= opt.minBand) kept.push(uniq[i]);
    else if (i === uniq.length - 1) kept[kept.length - 1] = uniq[i]; // never lose the far wall
  }
  if (kept.length < 2) kept.push(uniq[uniq.length - 1]);
  return kept;
}

/** Evenly spaced cut lines for [lo,hi] in n pieces, far end exact. */
function evenLines(lo, hi, n) {
  const size = (hi - lo) / n;
  const lines = [];
  for (let k = 0; k < n; k++) lines.push(lo + k * size);
  lines.push(hi);
  return lines;
}

/** Every piece count that keeps a span's even division inside [minCell,maxCell]. */
function viableCounts(span, opt) {
  const out = [];
  const lo = Math.max(1, Math.ceil(span / opt.maxCell - 1e-9));
  const hi = Math.max(1, Math.floor(span / opt.minCell + 1e-9));
  for (let n = lo; n <= hi && out.length < 8; n++) out.push(n);
  if (!out.length) out.push(Math.max(1, Math.round(span / opt.targetCell)));
  return out;
}

/** How well a set of cut lines lines up with the soft anchors inside the band. */
function alignBonus(lines, softAnchors, lo, hi, opt) {
  let bonus = 0, seen = 0;
  for (const a of softAnchors) {
    if (a < lo - 1e-6 || a > hi + 1e-6) continue;
    let best = Infinity;
    for (const v of lines) best = Math.min(best, Math.abs(v - a));
    bonus += Math.max(0, 1 - best / (opt.targetCell * 0.5));
    seen++;
  }
  // Average, not sum: two fans on the same line are satisfied by ONE line, so
  // summing would double the reward and let fan alignment swamp cell size.
  return seen ? opt.fanAnchorWeight * (bonus / seen) : 0;
}

/** The axis-only size penalty — kept for partitionAxis, which has no partner axis. */
function axisPenalty(sizes, opt) {
  let p = 0;
  for (const s of sizes) {
    p += opt.sizeWeight * Math.abs(s - opt.targetCell) / opt.targetCell;
    if (s < opt.minCell) p += 3 * (opt.minCell - s);
    if (s > opt.maxCell) p += 3 * (s - opt.maxCell);
  }
  return p / sizes.length;
}

/**
 * The ways a single band could reasonably be divided, each with its own
 * quality score. The caller picks — and for a chunk it picks the x and y
 * candidates TOGETHER, because both whether a fan lands on a cell centre and
 * whether a cell covers about 36 sqft are two-dimensional questions that
 * neither axis can answer alone.
 *
 * Two families of candidate:
 *
 *   EVEN     — n-1, n, n+1 pieces all the same size. The tidy reading, and the
 *              only one when there is nothing in particular to line up with.
 *   ANCHORED — a cut line placed EXACTLY on `anchor`, with each side then
 *              divided evenly on its own terms. Cell sizes differ either side
 *              of that line, which is the price of the fan landing on it.
 *
 * `anchor` is passed only for a chunk holding exactly one fan (see
 * chooseChunkGrid): one fan is one coordinate to hit, with no second fan whose
 * claim could contradict it.
 */
export function bandCandidates(lo, hi, softAnchors, opt, anchor = null) {
  const W = hi - lo;
  const out = [];
  const seen = new Set();
  const add = (lines) => {
    const key = lines.map((v) => Math.round(v * 1e4)).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const sizes = [];
    for (let k = 0; k < lines.length - 1; k++) sizes.push(lines[k + 1] - lines[k]);
    // "Anchored" is a property of the LINES, not of how they were built: an
    // even division that happens to land on the fan is every bit as anchored
    // as one we bent to get there, and must be credited the same.
    const onAnchor = anchor != null && lines.some((v) => Math.abs(v - anchor) < ANCHOR_TOL);
    const align = alignBonus(lines, softAnchors, lo, hi, opt);
    out.push({
      n: sizes.length, sizes, size: W / sizes.length, lines,
      anchored: onAnchor, align,
      score: align - axisPenalty(sizes, opt),
    });
  };

  const base = Math.max(1, Math.round(W / opt.targetCell));
  for (const n of [...new Set([base - 1, base, base + 1])].filter((v) => v >= 1)) {
    add(evenLines(lo, hi, n));
  }

  // A line exactly on the fan needs a cell to live on either side of it, so the
  // fan has to be at least one cell in from both ends. A fan closer than that
  // is already near a wall line, and the even divisions above are the answer.
  if (anchor != null) {
    const a = anchor - lo, b = hi - anchor;
    if (a >= opt.minCell - 1e-9 && b >= opt.minCell - 1e-9) {
      for (const na of viableCounts(a, opt)) {
        for (const nb of viableCounts(b, opt)) {
          add([...evenLines(lo, anchor, na), ...evenLines(anchor, hi, nb).slice(1)]);
        }
      }
    }
  }
  return out;
}

/**
 * What a pair of axis candidates costs, judged on the cells they actually make.
 *
 * The brief is an area, not a side: a cell should cover about `targetArea`
 * (36 sqft), and anything within `areaTol` of it is acceptable. Inside that
 * band the penalty is deliberately slight — that slack is the budget the grid
 * spends on landing a fan on a line — and outside it the penalty is steep, so
 * a grid only leaves the band when nothing in it will do.
 *
 * Sides still matter, but only through minCell/maxCell and a mild pull towards
 * a square cell: 36 sqft as 4 x 9 is not what anyone means by a 6 by 6 grid.
 */
function gridCost(cx, cy, opt) {
  const loA = opt.targetArea * (1 - opt.areaTol);
  const hiA = opt.targetArea * (1 + opt.areaTol);
  const bandWidth = Math.max(1e-9, hiA - loA);
  let pen = 0, n = 0, ok = true;
  for (const w of cx.sizes) {
    for (const h of cy.sizes) {
      const area = w * h;
      // Leaving the band costs a flat charge plus a slope. Inside the band the
      // charge is zero, which is what makes the tolerance usable slack rather
      // than a second, softer target.
      const outside = area < loA ? loA - area : area > hiA ? area - hiA : 0;
      if (outside > 0) {
        pen += opt.areaWeight * (0.5 + outside / (opt.targetArea * opt.areaTol));
        ok = false;
      }
      // Bigger is better, inside the band: the cost falls linearly to zero at
      // the top of it. Between two divisions that both qualify, this is what
      // takes the coarser — fewer, larger boxes — and it cannot push a cell
      // past the band, because outside it the charge above dominates.
      pen += opt.sizeBias * Math.min(1, Math.max(0, (hiA - area) / bandWidth));
      // Aspect, priced on the ratio so it stays orthogonal to size.
      pen += opt.shapeWeight * (Math.max(w, h) / Math.min(w, h) - 1);
      for (const s of [w, h]) {
        if (s < opt.minCell) { pen += 3 * (opt.minCell - s); ok = false; }
        if (s > opt.maxCell) { pen += 3 * (s - opt.maxCell); ok = false; }
      }
      n++;
    }
  }
  // "Acceptable" means acceptable as a CELL, not merely as an area. A 12 x 4
  // ft box covers 48 sqft and is nobody's idea of a lighting grid, so the
  // side bounds gate the preferred tier alongside the area band — otherwise a
  // 3:1 oblong that happens to land in the band would beat a near-square cell
  // a foot and a half short of it.
  return { cost: n ? pen / n : 0, inBand: ok };
}

/**
 * Pick a chunk's x and y divisions jointly.
 *
 * Scoring each axis on its own is what let a fan end up sitting on a cell
 * centre: each axis looked reasonable, and only the combination was bad. Each
 * combination is charged for the cells it would leave unable to hold a centred
 * light, for the area those cells cover, and credited for putting the fan on a
 * line.
 *
 * A chunk with EXACTLY ONE fan is the case worth bending the grid for. There
 * is a single coordinate pair to hit, so the fan can be put on a grid line
 * outright rather than merely near one — and the reward is largest when both
 * axes hit it, because a fan on a grid INTERSECTION is a shared corner of four
 * cells whose centres are each half a diagonal away, while a fan on a single
 * line can still sit level with the centres of the two cells it divides.
 */
function chooseChunkGrid(ch, softX, softY, fans, opt) {
  const inside = fans.filter((f) =>
    f.x > ch.x0 + 1e-6 && f.x < ch.x1 - 1e-6 && f.y > ch.y0 + 1e-6 && f.y < ch.y1 - 1e-6);
  const solo = inside.length === 1 ? inside[0] : null;

  const xs = bandCandidates(ch.x0, ch.x1, softX, opt, solo ? solo.x : null);
  const ys = bandCandidates(ch.y0, ch.y1, softY, opt, solo ? solo.y : null);

  const rated = [];
  for (const cx of xs) {
    for (const cy of ys) {
      let awk = 0;
      for (let i = 0; i < cx.n; i++) {
        for (let j = 0; j < cy.n; j++) {
          const x0 = cx.lines[i], x1 = cx.lines[i + 1];
          const y0 = cy.lines[j], y1 = cy.lines[j + 1];
          const cell = {
            x0, x1, y0, y1,
            cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0,
          };
          if (cellIsAwkward(cell, fans, opt)) awk++;
        }
      }
      const { cost, inBand } = gridCost(cx, cy, opt);
      const hits = (cx.anchored ? 1 : 0) + (cy.anchored ? 1 : 0);
      const anchorBonus = opt.fanLineWeight * hits
        + (hits === 2 ? opt.fanCornerBonus : 0);
      const score = cx.align + cy.align + anchorBonus - cost
        - opt.awkwardGridPenalty * awk;
      rated.push({ score, inBand, xLines: cx.lines, yLines: cy.lines,
                   awkward: awk, fanOnLines: hits });
    }
  }

  // The area band comes first and the fan second. Every grid whose cells all
  // sit inside the band is preferred outright to every grid that leaves it —
  // no amount of fan alignment buys a 22 sqft cell when a 36 sqft one is
  // available. Only when NOTHING fits the band does the soft penalty above
  // decide, which is the case a corridor two feet wider than a cell presents.
  const pool = rated.filter((r) => r.inBand);
  return (pool.length ? pool : rated).reduce((a, b) => (b.score > a.score ? b : a));
}

/**
 * How far a point is from an obstacle's SURFACE. Positive outside, negative in.
 *
 * This replaced `hypot(q - f) - f.r`, and the reason is worth writing down.
 * Everything on the ceiling used to be reduced to a circle, so a rectangular
 * AC cassette or trap door was given the circle that CIRCUMSCRIBED it — right
 * at the corners, and badly wrong along the flats. A 900 x 900 cassette
 * reserved a 636mm radius where its own face is 450mm out, and a 1200 x 600
 * trap door reserved 670mm along an edge that is 300mm away. On a tight
 * ceiling that is a whole row of downlights refused for nothing.
 *
 * The exact answer for a rectangle is not hard and is not slower in any way
 * that matters: rotate the point into the object's own frame, and the distance
 * to the rectangle is the length of the part of the offset that falls outside
 * it on each axis. Clearance then means what it says — `fanClearance` feet from
 * the object's actual face, whichever face is nearest.
 *
 * The set of points at exactly `c` from a rectangle is that rectangle grown by
 * `c` with its corners rounded to radius `c` — which is what the canvas draws,
 * so what you see reserved is exactly what is reserved.
 *
 * A fixture with no `shape` is a circle, which keeps every existing caller and
 * every fan the detector finds working unchanged.
 */
export function surfaceDistance(f, q) {
  if (f?.shape === 'rect') {
    const c = Math.cos(f.rot || 0), sn = Math.sin(f.rot || 0);
    const dx = q.x - f.x, dy = q.y - f.y;
    // into the object's own frame, where the rectangle is axis-aligned
    const lx = Math.abs(dx * c + dy * sn) - (f.w || 0) / 2;
    const ly = Math.abs(-dx * sn + dy * c) - (f.h || 0) / 2;
    if (lx <= 0 && ly <= 0) return Math.max(lx, ly);   // inside: negative
    return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
  }
  return Math.hypot(q.x - f.x, q.y - f.y) - (f.r || 0);
}

/**
 * Can this cell hold a small light inside its centre band, clear of the fans?
 * Cells never overlap a no-light zone, so only the fans can spoil a centre.
 */
function cellIsAwkward(cell, fans, opt) {
  if (!fans.length) return false;
  const clear = (qx, qy) => !fans.some((f) =>
    surfaceDistance(f, { x: qx, y: qy }) < opt.fanClearance);
  if (clear(cell.cx, cell.cy)) return false;
  const dx = cell.w * opt.centreBand, dy = cell.h * opt.centreBand;
  const N = 13;
  for (let k = 0; k < N; k++) {
    const t = (k / (N - 1)) * 2 - 1;
    if (clear(cell.cx + t * dx, cell.cy)) return false;
    if (clear(cell.cx, cell.cy + t * dy)) return false;
  }
  return true;
}

// --- main -------------------------------------------------------------------

export function planLights(polygon, fixtures = [], options = {}, noLightZones = []) {
  const opt = resolveOptions({ ...DEFAULTS, ...options });
  if (!polygon || polygon.length < 4) {
    return { ok: false, reason: 'No usable space outline.', chunks: [], cells: [], lights: [] };
  }

  const fans = fixtures.filter((f) => f.type === 'fan');

  // A room can carry several fans. Every fan is an obstacle in its own right,
  // and every fan is a soft anchor the grid tries to line up with.
  // Distance to the obstacle's FACE, not to a circle round it — see
  // surfaceDistance. `fanClearance` is now literally what it says.
  const fanBlocked = (q) => fans.some((f) => surfaceDistance(f, q) < opt.fanClearance);
  const zones = prepareZones(noLightZones);
  // A COVE IS A LINE, NOT A HOLE. The zones above are subtracted from the room
  // — the ceiling stops at them. A cove does not stop the ceiling; it draws a
  // rectangle on it and forbids fittings within a couple of feet either side.
  // So it never reaches the chunker, and instead rides on `opt` for the three
  // passes that place or move a fitting. Normalised onto `opt` so those passes
  // ask one prepared object rather than each re-deriving the clearances.
  opt.coves = prepareCoves(opt.coves, opt);

  // 1+2. carve the zones out, then adopt ONE of the ways what remains can be
  // cut into rectangles. See resolveChunking: the choice is made elsewhere and
  // handed in, which is what lets the app show the options and place lights
  // only afterwards.
  const chosen = resolveChunking(polygon, zones, opt, fans);
  // THE ONE EDIT ANYTHING IS ALLOWED TO MAKE TO A CHOSEN DECOMPOSITION, and it
  // is made only on the second pass — `opt.bedFoot` is absent on the first, so
  // this is the identity function for every room and every first look at one.
  // See bedGrid.js for what carries it here and why.
  const chunks = applyBedFootPlan(chosen.chunks.map((c) => ({ ...c })), opt.bedFoot, opt);
  const omitted = chosen.omitted.map((c) => ({ ...c }));
  if (!chunks.length) {
    const reason = zones.length
      ? 'No-light zones cover the whole region — nowhere left to put a light.'
      : 'Space is smaller than one grid cell.';
    return { ok: false, reason, chunks: [], omittedChunks: omitted, zones, cells: [], lights: [],
             chunking: chunkingReport(chosen) };
  }

  // The outline has effectively changed: zone edges are walls now, so the
  // wall-distance rule measures against them too.
  const wallDist = (p) => {
    let d = distanceToBoundary(p, polygon);
    for (const z of zones) d = Math.min(d, rectEdgeDistance(p, z));
    return d;
  };

  const softX = [], softY = [];
  for (const f of fixtures) { softX.push(f.x); softY.push(f.y); }

  // 3. each chunk gets its own grid and cells
  //
  // A DARK CHUNK STILL GETS ITS GRID. `ch.dark` says a chunk is laid out but
  // not lit — the band outside a cove, when the cove alone is carrying the
  // room. The grid is drawn because it is the false-ceiling setting-out and a
  // person reads it; the fittings are absent because that is the design. It is
  // NOT the same as an omitted chunk (too small to light, dropped by the
  // chunker) and not the same as a ceded cell (a light was wanted and would not
  // fit): both of those are failures with a reason, and this is an intention.
  const cells = [];
  const byId = new Map();
  const darkCells = new Set();
  // EVERY CHUNK'S GRID BEFORE ANY CHUNK'S CELLS, and in two phases, because one
  // chunk's grid can now depend on another's. The foot of a bed COPIES the cut
  // lines of the chunks beside it (see bedGrid.js), so those have to be settled
  // first — and they are not the rectangles the previous pass gridded, since the
  // carve stopped them at the foot line. This was one loop while every chunk was
  // an island.
  chunks.forEach((ch, ci) => { ch.id = ci; });
  for (const ch of chunks) {
    if (ch.bedFoot) continue;
    const grid = chooseChunkGrid(ch, softX, softY, fans, opt);
    ch.xLines = grid.xLines;
    ch.yLines = grid.yLines;
  }
  for (const ch of chunks) {
    if (!ch.bedFoot) continue;
    // The ordinary grid first: the run axis keeps whatever the chooser decided,
    // because nothing about the flanks says anything about it.
    const grid = chooseChunkGrid(ch, softX, softY, fans, opt);
    ch.xLines = grid.xLines;
    ch.yLines = grid.yLines;
    const geo = footGeometry({ polygon, zones, chunks, opt });
    const lines = geo ? flankFitLines(geo, opt) : null;
    if (lines) {
      if (ch.bedFoot.fit === 'x') ch.xLines = lines; else ch.yLines = lines;
    } else {
      // Nothing to copy after the carve. The chunk keeps the grid it was just
      // given, which is a legitimate layout — but it is not THIS rule's layout,
      // so it must not be reported as one.
      ch.bedFoot = null;
    }
  }
  chunks.forEach((ch, ci) => {
    ch.cellAt = new Map(); // "i,j" -> cell, local to this chunk
    for (let i = 0; i < ch.xLines.length - 1; i++) {
      for (let j = 0; j < ch.yLines.length - 1; j++) {
        const rect = { x0: ch.xLines[i], x1: ch.xLines[i + 1], y0: ch.yLines[j], y1: ch.yLines[j + 1] };
        const cell = {
          id: cells.length, chunk: ci, i, j, ...rect,
          cx: (rect.x0 + rect.x1) / 2, cy: (rect.y0 + rect.y1) / 2,
          w: rect.x1 - rect.x0, h: rect.y1 - rect.y0,
        };
        cells.push(cell);
        byId.set(cell.id, cell);
        if (ch.dark) darkCells.add(cell.id);
        ch.cellAt.set(`${i},${j}`, cell);
      }
    }
  });

  // Which grid boxes does a light at this point illuminate? A point on the
  // interior of an edge belongs to the two boxes either side; a point on a
  // vertex belongs to all four boxes that meet there. Chunk boundaries are not
  // respected on purpose — a vertex shared with the next chunk still lights its
  // boxes, and pretending otherwise would double-light them.
  const TOUCH = 1e-6;
  const cellsAt = (p) => cells.filter((c) =>
    // A dark cell is never lit, not even incidentally: a light sitting on a
    // chunk boundary would otherwise claim the box on the unlit side and count
    // it as served.
    !darkCells.has(c.id) &&
    p.x >= c.x0 - TOUCH && p.x <= c.x1 + TOUCH &&
    p.y >= c.y0 - TOUCH && p.y <= c.y1 + TOUCH).map((c) => c.id);

  // 3b. Which cells can actually take a small light near their own centre?
  // A cell that cannot is "awkward": a small light there would sit visibly off
  // centre, so it is better served by a large light shared with a neighbour.
  // The matching below bids for these rather than patching them afterwards.
  const wideFrac = Math.max(0, 0.5 - opt.cellEdgePad);
  const centred = new Map();  // cell id -> spot within the centre band, or null
  const awkward = new Set();
  for (const c of cells) {
    if (darkCells.has(c.id)) continue;   // nothing is going there, awkward or not
    const spot = findSmallSpot(c, polygon, fans, zones, opt, opt.centreBand);
    if (spot.ok) centred.set(c.id, spot);
    else awkward.add(c.id);
  }

  // 4. candidate large-light positions on shared grid lines, within a chunk.
  //
  // A large light lives on the grid line two cells share. The midpoint of that
  // line is the natural home, but it is not the only allowed spot: the light
  // may also slide to where the line crosses one of the CHUNK's centre axes
  // (so it lines up with the chunk as a whole), or all the way to either end of
  // the line — a grid intersection, which is a corner of the boxes it serves.
  // Each option is emitted as its own candidate; the matching picks. Parallel
  // candidates for the same pair are harmless, since only one can be chosen.
  const candidates = [];
  const pairSpots = new Map();   // every valid position for a given pair
  for (const ch of chunks) {
    if (ch.dark) continue;
    const longAxis = ch.w >= ch.h ? 'x' : 'y';
    // the coordinates the rest of the layout actually uses: the row and column
    // centres the small lights sit on, and the grid lines themselves
    const rowC = [], colC = [];
    for (let j = 0; j < ch.yLines.length - 1; j++) rowC.push((ch.yLines[j] + ch.yLines[j + 1]) / 2);
    for (let i = 0; i < ch.xLines.length - 1; i++) colC.push((ch.xLines[i] + ch.xLines[i + 1]) / 2);
    const chunkAxis = { x: (ch.x0 + ch.x1) / 2, y: (ch.y0 + ch.y1) / 2 };
    for (const c of ch.cellAt.values()) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const n = ch.cellAt.get(`${c.i + di},${c.j + dj}`);
        if (!n) continue;
        // the shared edge: vertical if the neighbour is to the right
        const vertical = di === 1;
        const lo = vertical ? Math.max(c.y0, n.y0) : Math.max(c.x0, n.x0);
        const hi = vertical ? Math.min(c.y1, n.y1) : Math.min(c.x1, n.x1);
        const len = hi - lo;
        if (len < opt.minSharedEdge) continue;
        const fixed = vertical ? c.x1 : c.y1;   // the grid line itself
        const mid = (lo + hi) / 2;
        const axis = vertical ? chunkAxis.y : chunkAxis.x;

        // Where along the line the light may sit. The midpoint is the natural
        // home and the chunk's centre axis is the other meaningful anchor, but
        // the position is NOT restricted to those two plus the vertices: the
        // light may sit anywhere along the line, and the weighting below simply
        // prefers the anchors. That freedom is what lets one light slip between
        // two fans instead of two expensive lights working around them.
        //
        // The band next to each vertex is excluded, though. A light half a foot
        // from a vertex reads as being ON the vertex, and would then have to
        // light four boxes rather than two — so it is either at the vertex or
        // clearly away from it.
        const vBand = Math.max(opt.vertexBand, len * 0.12);
        const spots = [];
        const label = (v) => Math.abs(v - mid) < 1e-6 ? 'midpoint'
          : (opt.allowChunkAxis && Math.abs(v - axis) < 1e-6) ? 'chunk-axis' : 'edge';
        if (opt.allowEdgeSliding) {
          const N = 49;
          for (let k = 0; k <= N; k++) {
            const v = lo + (k / N) * len;
            if (v - lo < vBand - 1e-9 || hi - v < vBand - 1e-9) continue;
            spots.push({ v, kind: label(v) });
          }
        }
        for (const v of [mid, ...(opt.allowChunkAxis && axis > lo + vBand && axis < hi - vBand ? [axis] : [])]) {
          if (!spots.some((sp) => Math.abs(sp.v - v) < 1e-6)) spots.push({ v, kind: label(v) });
        }
        if (!spots.length) spots.push({ v: mid, kind: 'midpoint' });
        if (opt.allowGridEdgePositions) {
          for (const v of [lo, hi]) spots.push({ v, kind: 'grid-corner' });
        }

        // LAST RESORT — roaming. When nothing on the grid line is any good, the
        // light may leave the line altogether and slide along the line joining
        // the two box centres instead: still serving both, still on the row or
        // column the small lights use, just no longer over the boundary between
        // them. It is priced below every on-line option so it is only reached
        // when those are worse.
        const centreLine = vertical ? c.cy : c.cx;      // both boxes share it
        const acrossLo = vertical ? c.x0 : c.y0;
        const acrossHi = vertical ? n.x1 : n.y1;
        const acrossMid = fixed;                        // the shared edge
        const reach = (acrossHi - acrossLo) / 2 * opt.roamSpan;
        const roamSpots = [];
        if (opt.allowRoaming) {
          const M = 41;
          for (let k = 0; k <= M; k++) {
            const v = acrossMid - reach + (k / M) * 2 * reach;
            if (v < acrossLo + 1e-9 || v > acrossHi - 1e-9) continue;
            if (Math.abs(v - acrossMid) < 1e-6) continue;   // that is the on-line case
            roamSpots.push({ v, kind: 'roam' });
          }
        }

        const span = { len, lo, hi, mid, fixed, axisV: axis, dir: vertical ? 'v' : 'h' };
        const roamSpan = { len: 2 * reach, lo: Math.max(acrossLo, acrossMid - reach),
                           hi: Math.min(acrossHi, acrossMid + reach), mid: acrossMid,
                           fixed: centreLine, axisV: vertical ? chunkAxis.x : chunkAxis.y,
                           dir: vertical ? 'h' : 'v' };

        for (const spot of [...spots, ...roamSpots]) {
          const roaming = spot.kind === 'roam';
          const p = roaming
            ? (vertical ? { x: spot.v, y: centreLine } : { x: centreLine, y: spot.v })
            : (vertical ? { x: fixed, y: spot.v } : { x: spot.v, y: fixed });
          const wall = wallDist(p);
          if (wall + 1e-9 < opt.minWallDistance) continue;
          if (fanBlocked(p)) continue;
          if (coveBlocked(p, opt)) continue;

          // weight: deeper into the room is better, the long axis is better,
          // lining up with a fixture is better, a squarer pair is better.
          let w = 0;
          w += 2.0 * Math.min(wall, 12) / 12;
          if (opt.preferLongAxis && (vertical ? 'x' : 'y') === longAxis) w += 1.0;
          // lining up with ANY fan is worth the same bonus
          if (fans.some((f) => Math.min(Math.abs(p.x - f.x), Math.abs(p.y - f.y)) < opt.alignTol)) w += 1.5;
          const ar = Math.min(c.w, c.h) / Math.max(c.w, c.h);
          w += 0.75 * ar;
          w += 0.5 * Math.min(len / opt.targetCell, 1);
          // breathing room past the fan clearance: two otherwise equal spots
          // are not equal if one of them only just scrapes past a blade circle
          const gap = fans.length
            ? Math.min(...fans.map((f) => surfaceDistance(f, p) - opt.fanClearance))
            : 3;
          w += 0.6 * Math.min(Math.max(gap, 0), 3) / 3;
          // the midpoint stays the default; a slide has to earn its keep, and
          // landing on a chunk axis is exactly what earns it
          // stay near an anchor: the midpoint, or the chunk's centre axis
          const offMid = roaming
            ? Math.abs(spot.v - acrossMid) / Math.max(reach, 1e-9)
            : Math.abs(spot.v - mid) / (len / 2);
          const offAxis = (!roaming && opt.allowChunkAxis)
            ? Math.abs(spot.v - axis) / (len / 2) : Infinity;
          w -= opt.offCentrePenalty * Math.min(offMid, offAxis);
          if (spot.kind === 'chunk-axis' || spot.kind === 'midpoint') w += opt.chunkAxisBonus;

          // A roaming light serves the pair it was made for. It sits inside one
          // of the two boxes rather than over their boundary, so its coverage
          // is by assignment, not by which box happens to contain the point.
          const cover = roaming ? [c.id, n.id] : cellsAt(p);
          if (!cover.includes(c.id) || !cover.includes(n.id)) continue;
          // Does this position line up with anything else in the drawing? A
          // light on a row/column the small lights already use, on a grid line,
          // or on the chunk's centre axis reads as deliberate. One parked
          // between all of them reads as a mistake, however legal it is.
          // a roaming light sits on the pair's own centre line, which IS the
          // row or column the small lights use, so it is aligned by construction
          const centres = roaming ? (vertical ? colC : rowC) : (vertical ? rowC : colC);
          const lines = roaming ? (vertical ? ch.xLines : ch.yLines) : (vertical ? ch.yLines : ch.xLines);
          const aligned = roaming
            ? true
            : centres.some((v) => Math.abs(v - spot.v) < opt.alignSnap)
              || lines.some((v) => Math.abs(v - spot.v) < opt.alignSnap)
              || (opt.allowChunkAxis && Math.abs(axis - spot.v) < opt.alignSnap);
          const key = `${Math.min(c.id, n.id)}-${Math.max(c.id, n.id)}-${cover.length}`;
          if (!pairSpots.has(key)) pairSpots.set(key, []);
          const cand = { a: c, b: n, p, vertical, w, spot: spot.kind, cover, key, aligned, roaming,
                         chunk: ch.id,
                         span: roaming ? roamSpan : span,
                         // a roaming light slides ACROSS the boundary, so it
                         // moves on the other axis from an on-line one
                         moveAxis: roaming ? (vertical ? 'h' : 'v') : (vertical ? 'v' : 'h') };
          pairSpots.get(key).push(cand);
          candidates.push(cand);
        }
      }
    }
  }

  // 5. bipartite matching — checkerboard parity splits each chunk's grid graph
  // (edges never cross chunks, so per-chunk parity is a valid global bipartition)
  const Lidx = new Map(), Ridx = new Map();
  for (const c of cells) {
    const m = (c.i + c.j) % 2 === 0 ? Lidx : Ridx;
    if (!m.has(c.id)) m.set(c.id, m.size);
  }
  // Price a pair by what covering those two cells is WORTH, not just by how
  // pretty it is. The aesthetic score is scaled right down so it can only ever
  // break ties between equally valuable matchings — never buy a worse layout.
  //
  // SMALL FIRST (the default). A small light at the cell centre is the norm, so
  // covering a healthy cell with a large light is a LOSS: that cell gives up
  // its own centred light to share one. Only a cell that cannot take a small
  // light is worth rescuing. Pairs that rescue nobody are dropped outright, so
  // the result never depends on the aesthetic score outweighing the cost.
  //
  // LARGE FIRST (the earlier behaviour, kept for comparison). Every covered
  // cell is worth 1, an awkward one 1 + awkwardPriority, so large lights spread
  // across the whole plan.
  const AESTHETIC_SCALE = 1 / 10;
  const valueOf = (priority) => (c) =>
    opt.smallFirst
      ? (awkward.has(c.id) ? opt.rescueValue : -opt.pairCostNormal)
      : 1 + (awkward.has(c.id) ? priority : 0);
  const worthPairing = (cand) =>
    !opt.smallFirst || cand.cover.some((id) => awkward.has(id));
  const candValue = (cand, priority) => {
    const cellValue = valueOf(priority);
    let v = 0;
    for (const id of cand.cover) v += cellValue(byId.get(id));
    // A position that lines up with nothing is charged for it, in the same
    // currency as the boxes — otherwise a scaled-down aesthetic score could
    // never outweigh the cost of one extra box and the layout would always
    // take the tidier-on-paper, worse-looking option.
    if (!cand.aligned) v -= opt.misalignPenalty;
    if (cand.roaming) v -= opt.roamPenalty;
    return v + cand.w * AESTHETIC_SCALE;
  };

  const solve = (subset, priority) => {
    const mEdges = [];
    for (const cand of subset) {
      const [lc, rc] = (cand.a.i + cand.a.j) % 2 === 0 ? [cand.a, cand.b] : [cand.b, cand.a];
      if (!Lidx.has(lc.id) || !Ridx.has(rc.id)) continue;
      mEdges.push({ l: Lidx.get(lc.id), r: Ridx.get(rc.id), w: candValue(cand, priority), id: cand });
    }
    // Weights now price the trade-off directly, so no cardinality bias: two
    // ordinary pairs and one pair that rescues an awkward cell compete fairly.
    return maxWeightMatching(Lidx.size, Ridx.size, mEdges, { maximizeCardinality: false });
  };

  // Midpoints first. They are naturally well spread, and this is the layout
  // that has always been correct — the off-midpoint spots are an exception,
  // not an equal option, so they never get to displace a midpoint pairing.
  const usable = candidates.filter(worthPairing);
  // A candidate that lights exactly two boxes is a domino, and a matching over
  // those is automatically a disjoint packing. Anything that lights four (a
  // light sitting on a vertex) cannot be expressed as a matching edge, so it is
  // packed separately with an explicit overlap check.
  //
  // ANY candidate that lights exactly two boxes is a valid matching edge — its
  // coverage is precisely the pair it joins — so all of them go into the same
  // solve, whether they sit on the midpoint or slid along the line. Splitting
  // them was a real bug: the midpoint-only matching would spend a box on a
  // mediocre pairing and block a far better slid one that only the second pass
  // could see. Only four-box pieces, which no matching edge can express, are
  // packed afterwards.
  const bestOf = (list) => {
    const best = new Map();
    for (const c of list) {
      const key = `${Math.min(c.a.id, c.b.id)}-${Math.max(c.a.id, c.b.id)}`;
      const cur = best.get(key);
      if (!cur || c.w > cur.w) best.set(key, c);
    }
    return [...best.values()];
  };
  const primary = bestOf(usable.filter((c) => c.cover.length === 2));
  const alternateBest = bestOf(usable.filter((c) => c.cover.length !== 2));

  /**
   * Build a complete placement for one value of awkwardPriority.
   *
   * The priority steers the FIRST pass, but the second pass and the ceding
   * decision both depend on what the first pass left behind, so the objective
   * is not separable — a priority that helps one cell can strand another. Both
   * settings are therefore built in full and the better result is kept.
   */
  const place = (priority, vertexFirst) => {
    let matched = solve(primary, priority);
    if (opt.uniformOrientation) {
      const tidiness = (m) => {
        const xs = new Set(m.map((e) => e.id.p.x.toFixed(2)));
        const ys = new Set(m.map((e) => e.id.p.y.toFixed(2)));
        return xs.size + ys.size; // fewer distinct rows/columns == tidier
      };
      const rescues = (m) => m.reduce((n, e) =>
        n + (awkward.has(e.id.a.id) ? 1 : 0) + (awkward.has(e.id.b.id) ? 1 : 0), 0);
      for (const subset of [primary.filter((c) => c.vertical), primary.filter((c) => !c.vertical)]) {
        if (!subset.length) continue;
        const alt = solve(subset, priority);
        if (alt.length === matched.length && rescues(alt) >= rescues(matched)
            && tidiness(alt) < tidiness(matched)) matched = alt;
      }
    }

    const used = new Set();
    const lights = [];
    const ceded = [];   // cells deliberately left to a fan
    const addLarge = (cand) => {
      for (const id of cand.cover) used.add(id);
      lights.push({
        id: `L${lights.length}`, kind: 'large',
        x: cand.p.x, y: cand.p.y,
        axis: cand.moveAxis,
        // the chunk whose grid line this light sits on. Not the same as the
        // chunk of cells[0]: a light at a grid intersection on a chunk
        // boundary lights boxes in the neighbouring chunk too.
        chunk: cand.chunk,
        cells: [...cand.cover],
        span: cand.span, spot: cand.spot, locked: false,
        lightsBoxes: cand.cover.length,
        aligned: cand.aligned,
        roaming: cand.roaming,
        value: candValue(cand, priority),
        options: (pairSpots.get(cand.key) || [cand]).filter((o) =>
          o.cover.length === cand.cover.length && o.cover.every((id) => cand.cover.includes(id))),
        // it may only shift to a spot that lights exactly the same boxes,
        // otherwise the alignment pass would silently change what is covered
        // every legal position on this line that lights the same boxes, so the
        // alignment pass has somewhere to go
        allowed: [...new Set(
          (pairSpots.get(cand.key) || [cand])
            .filter((o) => o.cover.length === cand.cover.length
                        && o.cover.every((id) => cand.cover.includes(id)))
            .map((o) => Math.round((cand.vertical ? o.p.y : o.p.x) * 1e6) / 1e6)
        )].sort((a, b) => a - b),
      });
    };
    // Four-box pieces are packed greedily. Whether that happens BEFORE or AFTER
    // the two-box matching changes the answer — a matching that has already
    // claimed a box blocks any four-box piece touching it, and vice versa — so
    // both orders are built and the better one is kept.
    const packFourBox = () => {
      if (!alternateBest.length) return;
      const byValue = [...alternateBest].sort((x, y) => candValue(y, priority) - candValue(x, priority));
      for (const cand of byValue) {
        if (cand.cover.some((id) => used.has(id))) continue;   // no box lit twice
        if (candValue(cand, priority) <= 0) continue;          // must earn its place
        if (!farEnoughOf(cand.p)) continue;
        addLarge(cand);
      }
    };
    const farEnoughOf = (p) =>
      lights.every((l) => Math.hypot(l.x - p.x, l.y - p.y) >= opt.minLightSpacing - 1e-9);

    if (vertexFirst) packFourBox();
    for (const e of matched) {
      if (e.id.cover.some((id) => used.has(id))) continue;
      addLarge(e.id);
    }
    if (!vertexFirst) packFourBox();

    for (const c of cells) {
      if (used.has(c.id)) continue;
      if (darkCells.has(c.id)) continue;   // laid out, deliberately unlit
      // Inside the centre band: the ordinary case.
      let spot = centred.get(c.id);
      if (!spot) {
        // Awkward, and neither pass could rescue it with a large light. A light
        // shoved to the edge of its own box looks like a mistake, so by default
        // we place none: a fan occupies that ceiling anyway. The cell is
        // recorded as ceded, not lost.
        if (opt.omitAwkwardCells) { ceded.push(c); continue; }
        spot = findSmallSpot(c, polygon, fans, zones, opt, wideFrac);
      }
      const { p, ok, axis } = spot;
      lights.push({ id: `S${lights.length}`, kind: 'small', x: p.x, y: p.y,
                    cells: [c.id], cell: c, locked: false,
                    nudged: p.x !== c.cx || p.y !== c.cy, slid: axis,
                    outsideBand: !centred.has(c.id), clash: !ok });
    }
    // A matching cannot express "keep your distance", so crowding is repaired
    // here. Either light of a clashing pair may be the one that moves — trying
    // only the first would give up while the second had somewhere to go — and a
    // light with nowhere to go is dropped, its boxes falling back to small
    // lights. Dropping strictly reduces the number of large lights, so the loop
    // always terminates.
    const spacingOK = (p, self) => lights.every((l) =>
      l === self
      || (l.kind !== 'large' && self.kind !== 'large')   // the grid spaces small lights
      || Math.hypot(l.x - p.x, l.y - p.y) >= opt.minLightSpacing - 1e-9);

    const relocate = (l) => {
      if (l.kind !== 'large') return false;
      const alt = (l.options || [])
        .filter((o) => Math.hypot(o.p.x - l.x, o.p.y - l.y) > 1e-9 && spacingOK(o.p, l))
        .sort((x, y) => y.w - x.w)[0];
      if (!alt) return false;
      l.x = alt.p.x; l.y = alt.p.y; l.spot = alt.spot; l.roaming = alt.roaming;
      const along = l.axis === 'v' ? l.y : l.x;
      if (!l.allowed.some((v) => Math.abs(v - along) < 1e-6)) {
        l.allowed = [...l.allowed, Math.round(along * 1e6) / 1e6].sort((a, b) => a - b);
      }
      return true;
    };

    const drop = (l) => {
      lights.splice(lights.indexOf(l), 1);
      for (const id of l.cells) {
        used.delete(id);
        const cell = byId.get(id);
        const sp = centred.get(id);
        if (!sp) { ceded.push(cell); continue; }
        lights.push({ id: `S${lights.length}`, kind: 'small', x: sp.p.x, y: sp.p.y,
                      cells: [id], cell, locked: false,
                      nudged: sp.p.x !== cell.cx || sp.p.y !== cell.cy, slid: sp.axis,
                      outsideBand: false, clash: false });
        used.add(id);
      }
    };

    for (let pass = 0; pass < 200; pass++) {
      let clash = null;
      outer:
      for (let i = 0; i < lights.length; i++) {
        for (let j = i + 1; j < lights.length; j++) {
          const a = lights[i], b = lights[j];
          if (a.kind !== 'large' && b.kind !== 'large') continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) >= opt.minLightSpacing - 1e-9) continue;
          clash = [a, b]; break outer;
        }
      }
      if (!clash) break;
      // move whichever can; failing that, drop the one worth less
      const [a, b] = clash;
      const order = (a.value || 0) <= (b.value || 0) ? [a, b] : [b, a];
      if (relocate(order[0]) || relocate(order[1])) continue;
      drop(order[0].kind === 'large' ? order[0] : order[1]);
    }

    const score = lights.filter((l) => l.kind === 'large')
      .reduce((t, l) => t + (l.value || 0), 0);
    return { lights, used, ceded, score };
  };

  // Fewest compromised cells wins; then most large lights; then the tidier one.
  // The value function already prices everything that matters — rescues,
  // healthy boxes given up, and positions that line up with nothing — so the
  // placement worth the most wins. Coverage and tidiness only break ties.
  const rank = (r) => [
    Math.round(r.score * 1e6) / 1e6,
    -(r.ceded.length + r.lights.filter((l) => l.outsideBand).length),
    (opt.smallFirst ? -1 : 1) * r.lights.filter((l) => l.kind === 'large').length,
    -(new Set(r.lights.map((l) => l.x.toFixed(2))).size + new Set(r.lights.map((l) => l.y.toFixed(2))).size),
  ];
  const better = (a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b;
    return a;
  };
  const priorities = opt.smallFirst || opt.awkwardPriority === 0
    ? [opt.awkwardPriority] : [opt.awkwardPriority, 0];
  let result = null;
  for (const pr of priorities) for (const vf of [false, true]) {
    const r2 = place(pr, vf);
    result = result ? better(result, r2) : r2;
  }
  const { lights, used, ceded } = result;

  // 6. alignment pass — cluster into rows and columns, across chunks too
  alignAxis(lights, 'x', polygon, opt, fans, zones, wallDist);
  alignAxis(lights, 'y', polygon, opt, fans, zones, wallDist);

  // 7. re-seat: the alignment pass works one axis at a time, so a light that
  // was nudged along one axis can drift on the other and end up diagonal to
  // its own cell again. Pull the smaller of the two offsets back to zero
  // wherever that is still a legal position.
  reseatOnCellAxis(lights, polygon, fans, zones, opt);

  // --- 8. THE BEDROOM SECOND LOOK ------------------------------------------
  //
  // Everything above has run: the grid, the matching, the alignment pass and
  // the re-seat. If the lights beyond the foot of the bed still do not line up
  // with the ones either side of it, they never will by sliding — the two
  // regions are running different numbers of rows, and only a different grid
  // fixes that. See bedGrid.js.
  //
  // A WHOLE SECOND LAYOUT, AND THAT IS THE POINT. Deciding up front whether a
  // bedroom needs this would mean predicting the outcome of the pass that is
  // supposed to prevent it; running the room normally and then LOOKING is both
  // simpler and honest — a bedroom that comes out aligned on its own is never
  // re-cut, and cannot be made worse by a rule it does not need.
  //
  // `bedFoot` on the options is what stops it recursing: the second call has it
  // set, so `bedFootPlan` is never reached again.
  let bedFootWhy = opt.bedFootAlign ? null : 'the bedroom rule is switched off';
  if (opt.bedFootAlign && !opt.bedFoot) {
    const { plan, why } = bedFootPlan({ polygon, zones, chunks, lights, opt });
    bedFootWhy = why;
    if (plan) {
      const retry = planLights(polygon, fixtures, { ...options, bedFoot: plan }, noLightZones);
      // ...AND ONLY IF IT WORKED. The merge can be refused as unsafe and the
      // derived cells can break the side bounds, both silently and both leaving
      // a layout no better than this one. `bedFootApplied` is the second pass
      // saying it actually did the thing.
      if (retry.ok && retry.stats?.bedFootApplied) return retry;
      /* THE SENTENCE COMES FROM THE CARVE ITSELF, WITH ITS NUMBERS IN IT.
         "It would leave a sliver" was true of every refusal and actionable in
         none of them: two different minimums can refuse, a piece can miss
         either by a hair or by half, and the answer to "is the minimum wrong or
         is the room wrong" is a measurement. So the carve is run here on the
         chunks it would have run on, purely to be told what happened.
         THE SAME DECOMPOSITION, WHICH IS WHY THIS IS HONEST RATHER THAN AN
         APPROXIMATION. `chunks` at this point is `chosen.chunks` with the
         bed-foot merge applied, and on THIS pass there is no merge to apply —
         `opt.bedFoot` is unset, which is the condition we are inside. The
         second pass re-decomposes the same polygon with the same zones and the
         same options, so it reaches the same chunks and hands them to the same
         function. Running it again costs one pass over a handful of
         rectangles. */
      const refusal = carveRefusal(carveFootRegion(chunks,
        { region: plan.region, fit: plan.fit, holes: plan.holes ?? [] }, opt));
      bedFootWhy = refusal ?? 'the foot region could not be cut out';
    }
  }

  const served = new Set();
  for (const l of lights) for (const cid of l.cells) served.add(cid);
  const stats = {
    chunks: chunks.length,
    omittedChunks: omitted.length,
    cells: cells.length,
    served: served.size,
    // Cells nobody ever meant to light — see `ch.dark` above. Counted so the
    // line below can subtract them: a dark cell is not an unserved one, and
    // reporting it as one would put a fault on every cove in the job.
    dark: darkCells.size,
    // a ceded cell is a decision, not a hole; `unserved` must stay at zero
    unserved: cells.length - served.size - ceded.length - darkCells.size,
    nudged: lights.filter((l) => l.nudged).length,
    awkward: awkward.size,
    rescued: [...awkward].filter((id) => used.has(id)).length,
    outsideBand: lights.filter((l) => l.outsideBand).length,
    ceded: ceded.length,
    // off BOTH of its cell's centre lines for no reason — drift. A light that
    // is off both because it lines up with a constrained neighbour on each
    // axis is counted separately, as `alignedDiagonal`.
    offAxis: lights.filter((l) => {
      if (l.kind !== 'small' || !l.cell) return false;
      if (l.diagonal === 'aligned') return false;
      return Math.abs(l.x - l.cell.cx) > 0.05 && Math.abs(l.y - l.cell.cy) > 0.05;
    }).length,
    alignedDiagonal: lights.filter((l) => l.diagonal === 'aligned').length,
    clashes: lights.filter((l) => l.clash).length,
    large: lights.filter((l) => l.kind === 'large').length,
    small: lights.filter((l) => l.kind === 'small').length,
    fans: fans.length,
    avgCell: cells.reduce((s, c) => s + (c.w + c.h) / 2, 0) / cells.length,
    areaSqft: Math.abs(polygonArea(polygon)),
    // Did the bedroom rule actually take? Set only on the second pass, and only
    // when the merge and the derived cells both survived. Read by the first
    // pass to decide whether the second one was worth keeping, and by the audit
    // panel, which is where "why does this bedroom look different" is asked.
    bedFootApplied: chunks.some((c) => c.bedFoot),
    // ...AND WHEN IT DID NOT, THE SENTENCE SAYING WHY. Null on the pass that
    // applied it. See bedFootPlan: declining is this rule's ordinary behaviour,
    // so it has to be able to tell a room it left alone on purpose from one it
    // never looked at. Only ever read by the admin panel.
    bedFootWhy: chunks.some((c) => c.bedFoot) ? null : bedFootWhy,
  };
  return { ok: true, chunks, omittedChunks: omitted, zones, cells, lights,
           cededCells: ceded, awkwardCells: [...awkward], stats, opt,
           chunking: chunkingReport(chosen) };
}

/**
 * Find the best spot for a small light inside its cell, searching only the two
 * centre lines and only out to `maxFrac` of the cell's size from the centre.
 *
 * Returns { p, ok, axis, dist, violation }. `ok` means a fully clear position
 * was found inside that band; otherwise `p` is the least-bad point on an axis.
 *
 * A light on a centre line still reads as belonging to its box and stays in
 * line with the row or column it shares; one pushed into a corner just looks
 * like a mistake. Ties go to the cell's longer axis, which has more room.
 */
function findSmallSpot(cell, polygon, fans, zones, opt, maxFrac) {
  const base = { x: cell.cx, y: cell.cy };
  // How badly a point violates the constraints — 0 means fully clear. Summing
  // over the fans matters when a cell is squeezed between two of them: the
  // fallback then lands where it intrudes on the pair least, not just on one.
  const violation = (q) => {
    let v = zoneDepth(q, zones);
    // The cove's dead band, priced the same way — as a DEPTH rather than a
    // refusal, so a cell squeezed against a cove line still lands as far off it
    // as the cell allows instead of falling back to its own dead centre.
    v += coveDepth(q, opt.coves || []);
    for (const f of fans) {
      v += Math.max(0, opt.fanClearance - surfaceDistance(f, q));
    }
    return v;
  };
  if (violation(base) === 0) return { p: base, ok: true, axis: null, dist: 0, violation: 0 };

  const dxMax = cell.w * maxFrac, dyMax = cell.h * maxFrac;
  const longAxis = cell.w >= cell.h ? 'h' : 'v';
  const N = 41;
  let best = null, bestD = Infinity, bestAxis = null;
  let fb = null, fbV = Infinity, fbD = Infinity, fbAxis = null;
  for (let k = 0; k < N; k++) {
    const t = (k / (N - 1)) * 2 - 1; // -1 .. 1
    const cands = [
      { axis: 'h', p: { x: cell.cx + t * dxMax, y: cell.cy } },
      { axis: 'v', p: { x: cell.cx, y: cell.cy + t * dyMax } },
    ];
    for (const c of cands) {
      if (!pointInPolygon(c.p, polygon)) continue;
      const v = violation(c.p);
      const d = Math.hypot(c.p.x - base.x, c.p.y - base.y);
      if (v === 0) {
        const better = d < bestD - 1e-9 ||
          (Math.abs(d - bestD) <= 1e-9 && c.axis === longAxis && bestAxis !== longAxis);
        if (best === null || better) { best = c.p; bestD = d; bestAxis = c.axis; }
      }
      const fbBetter = v < fbV - 1e-9 ||
        (Math.abs(v - fbV) <= 1e-9 && (d < fbD - 1e-9 ||
          (Math.abs(d - fbD) <= 1e-9 && c.axis === longAxis && fbAxis !== longAxis)));
      if (fb === null || fbBetter) { fb = c.p; fbV = v; fbD = d; fbAxis = c.axis; }
    }
  }
  if (best) return { p: best, ok: true, axis: bestAxis, dist: bestD, violation: 0 };
  return { p: fb || base, ok: false, axis: fbAxis, dist: fbD, violation: fbV };
}

/**
 * Guarantee the post-condition: every small light shares either its cell's
 * centre x or its centre y. Off-axis by a hair is fine (the alignment pass
 * earns that), off-axis in both directions is not.
 */
function reseatOnCellAxis(lights, polygon, fans, zones, opt) {
  const tol = 0.05; // ft — below this, treat it as on the line
  const legal = (q) => {
    if (!pointInPolygon(q, polygon)) return false;
    if (inAnyZone(q, zones)) return false;
    if (coveBlocked(q, opt)) return false;
    return !fans.some((f) => surfaceDistance(f, q) < opt.fanClearance);
  };
  // An offset is EARNED when it is the light's own forced position, or when it
  // puts the light in line with a constrained neighbour. Only unearned offsets
  // — plain drift from a median snap — are corrected here.
  const earned = (l, axis) => isForced(l, axis) || !!(l.follows && l.follows[axis]);
  for (const l of lights) {
    if (l.kind !== 'small' || !l.cell) continue;
    const c = l.cell;
    const dx = l.x - c.cx, dy = l.y - c.cy;
    if (Math.abs(dx) <= tol || Math.abs(dy) <= tol) continue; // already on a line
    const keepX = earned(l, 'x'), keepY = earned(l, 'y');
    // Off both centre lines, but in line with its row AND its column: the
    // light sits exactly where the layout's own grid of positions puts it.
    // Pulling it back to a cell centre here would break one of those lines,
    // which is the thing this pass exists to prevent.
    if (keepX && keepY) { l.diagonal = 'aligned'; continue; }
    // Otherwise give up the unearned offset. With neither earned, zero the
    // smaller one — it is the cheaper correction.
    const tries = keepX ? [{ x: l.x, y: c.cy }]
      : keepY ? [{ x: c.cx, y: l.y }]
      : Math.abs(dx) <= Math.abs(dy)
        ? [{ x: c.cx, y: l.y }, { x: l.x, y: c.cy }]
        : [{ x: l.x, y: c.cy }, { x: c.cx, y: l.y }];
    for (const t of tries) {
      if (!legal(t)) continue;
      if (t.x !== l.x && l.follows) l.follows.x = false;
      if (t.y !== l.y && l.follows) l.follows.y = false;
      l.x = t.x; l.y = t.y;
      l.reseated = true;
      break;
    }
  }
}

/**
 * The discrete positions a large light may occupy along its grid line: the
 * midpoint, the chunk's centre axis where it crosses, and the two grid
 * intersections at the ends. The alignment pass may only choose from these —
 * free sliding is what made lights look like they had drifted.
 */
function allowedSpots(span, opt) {
  const out = [span.mid];
  if (opt.allowChunkAxis && span.axisV > span.lo + 1e-6 && span.axisV < span.hi - 1e-6) out.push(span.axisV);
  if (opt.allowGridEdgePositions) out.push(span.lo, span.hi);
  return [...new Set(out.map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/**
 * Snap lights into shared rows/columns. A large light on a vertical grid line
 * has its x fixed by the grid, so only its y may slide — and only within the
 * shared edge. Small lights may slide inside their own cell. Lights in
 * different chunks snap to each other when they're within tolerance, which is
 * what keeps the overall drawing reading as one layout.
 */
/** Lexicographic compare of two score tuples, highest first. */
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

/** The closest any other light already sits to this one. */
function gapAround(light, lights) {
  let best = Infinity;
  for (const l of lights) {
    if (l === light) continue;
    best = Math.min(best, Math.hypot(l.x - light.x, l.y - light.y));
  }
  return best;
}

/**
 * Is this light pinned off its own centre on this axis — pushed there by a fan
 * or a zone rather than by choice? Such a light cannot be aligned, so it is
 * what the rest of its row or column aligns TO.
 *
 * Only small lights qualify. A large light is constrained too, but differently:
 * it is fixed by the grid on one axis and free among discrete spots on the
 * other, so it has options to offer rather than a position to impose.
 */
function isForced(light, axis) {
  if (light.kind !== 'small' || !light.cell) return false;
  if (!light.nudged && !light.clash) return false;
  // findSmallSpot searches one centre line at a time, so a pushed light is off
  // centre on exactly ONE axis and `slid` records which. Without that check a
  // light nudged in x would count as pinned in y too, and the alignment pass
  // would treat a position it was free to choose as one it had to take.
  const along = light.slid === 'h' ? 'x' : light.slid === 'v' ? 'y' : null;
  if (along && along !== axis) return false;
  const centre = axis === 'x' ? light.cell.cx : light.cell.cy;
  return Math.abs(light[axis] - centre) > 0.05;
}

function alignAxis(lights, axis, polygon, opt, fans = [], zones = [], wallDist = null) {
  const dist = wallDist || ((p) => distanceToBoundary(p, polygon));
  const movable = lights.filter((l) => {
    if (l.locked) return false;
    if (l.kind === 'large') return axis === (l.axis === 'v' ? 'y' : 'x');
    return true;
  });
  if (movable.length < 2) return;

  const sorted = [...movable].sort((a, b) => a[axis] - b[axis]);
  let group = [sorted[0]];

  // Where this light would land if the row settled on `t` — or null if it
  // cannot get there.
  //
  // A SMALL light lands exactly on the line or not at all. Its only other
  // stopping place is the edge of its own centre band, and that edge is
  // meaningful to nobody: a light parked there is off its cell centre AND
  // still out of line, which is the worst of both. That is the rule this
  // whole function turns on — never move a light unless the move actually
  // buys the alignment it was made for.
  //
  // A LARGE light is different in kind. Its stopping places are the discrete
  // anchors of the grid — the midpoint of its edge, the chunk's centre axis,
  // the grid intersections at either end — and every one of those is a
  // position that means something on its own. So it may take the nearest such
  // anchor within tolerance even when that is not exactly the line.
  const landingFor = (g, t) => {
    if (g.kind === 'large') {
      const spots = g.allowed || [g.span.mid];
      const near = spots.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
      return Math.abs(near - t) <= opt.alignTol ? near : null;
    }
    const l = slideLimit(g, axis, opt);
    return (t >= l.lo - 1e-9 && t <= l.hi + 1e-9) ? t : null;
  };

  const placeable = (g, next, floor) => {
    const trial = { ...g, [axis]: next };
    if (!pointInPolygon(trial, polygon)) return false;
    if (g.kind === 'large' && dist(trial) + 1e-9 < opt.minWallDistance) return false;
    if (fans.some((f) => surfaceDistance(f, trial) < opt.fanClearance)) return false;
    if (inAnyZone(trial, zones)) return false;
    if (coveBlocked(trial, opt)) return false;
    // Aligning must not undo the spacing repair that ran before it, nor create
    // a crowded pair of its own — a chunk's cells can differ in size, so two
    // small lights 4.5 ft apart become 3.75 ft apart if a snap pulls one of
    // them towards the other. A pair that is ALREADY too close is left alone
    // rather than frozen: a light pushed off centre by a fan may have nowhere
    // better to be, and refusing to align its neighbour would not fix that.
    return !lights.some((l) => {
      if (l === g) return false;
      const d = Math.hypot(l.x - trial.x, l.y - trial.y);
      if (l.kind === 'large' || g.kind === 'large') return d < opt.minLightSpacing - 1e-9;
      if (d >= floor - 1e-9) return false;
      return d < Math.hypot(l.x - g.x, l.y - g.y) - 1e-9;
    });
  };

  const flush = () => {
    if (group.length < 2) return;
    const mid = group.reduce((s2, g) => s2 + g[axis], 0) / group.length;

    // The lines this row could settle on, and what each would mean:
    //
    //   0  a CONSTRAINED light's coordinate. A small light a fan has pushed off
    //      its cell centre has no say in where it sits, so the row forms up on
    //      it rather than leaving it visibly out of line on its own.
    //   1  a FAN's coordinate. Lights running through the fan read as
    //      deliberate.
    //   2  a coordinate the row is ALREADY using — including, when nothing has
    //      moved, everyone's shared cell-centre line. Choosing this is choosing
    //      to leave the row as it is.
    //
    // The line that puts the MOST lights on it wins, and the ranking only
    // breaks ties. That is what stops the row chasing a fan it cannot reach:
    // a fan three of four lights can get to scores 3, while the cell-centre
    // line they are all on already scores 4 — so nobody moves, and the row
    // stays a row. Alignment is worth having; half of it is not.
    const forced = group.filter((g) => isForced(g, axis));
    const cands = [];
    const add = (v, rank, anchorLight) => {
      if (!cands.some((c) => Math.abs(c.v - v) < 1e-6)) cands.push({ v, rank, anchor: anchorLight });
    };
    for (const f of forced) add(f[axis], 0, f);
    for (const f of fans) {
      if (group.some((g) => Math.abs(g[axis] - f[axis]) <= opt.alignTol)) add(f[axis], 1, null);
    }
    for (const g of group) add(g[axis], 2, null);

    let best = null;
    for (const c of cands) {
      // A row that forms up on a pushed light inherits that light's own
      // spacing, so the floor for those moves is whatever the anchor already
      // lives with — never tighter, and never relaxed for anything else.
      const floor = c.anchor
        ? Math.min(opt.minLightSpacing, gapAround(c.anchor, lights))
        : opt.minLightSpacing;
      let onLine = 0;
      for (const g of group) {
        if (Math.abs(g[axis] - c.v) < 1e-6) { onLine++; continue; }
        if (isForced(g, axis)) continue;       // it cannot come; it sets its own line
        const next = landingFor(g, c.v);
        if (next !== null && Math.abs(next - c.v) < 1e-6 && placeable(g, next, floor)) onLine++;
      }
      const key = [onLine, -c.rank, -Math.abs(c.v - mid)];
      if (!best || compareKeys(key, best.key) > 0) best = { ...c, floor, key };
    }
    if (!best || best.key[0] < 2) return;   // no line worth forming up on

    for (const g of group) {
      // A pushed light is where it has to be. It sets the line; it does not
      // follow one.
      if (isForced(g, axis)) continue;
      if (Math.abs(g[axis] - best.v) < 1e-6) continue;
      const next = landingFor(g, best.v);
      if (next === null) continue;
      if (!placeable(g, next, best.floor)) continue;
      g[axis] = next;
      // Remember WHY it moved. An offset that puts a light in line with a
      // constrained neighbour or with a fan is earned and must survive the
      // re-seat pass; an offset from an ordinary snap is drift, and does not.
      g.follows = { ...(g.follows || {}), [axis]: best.rank <= 1 };
    }
  };
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k][axis] - group[group.length - 1][axis] <= opt.alignTol) group.push(sorted[k]);
    else { flush(); group = [sorted[k]]; }
  }
  flush();
}

function slideLimit(light, axis, opt) {
  if (light.kind === 'small' && light.cell) {
    // The alignment pass may not push a light out of its centre band — that is
    // the whole guarantee, and it has to hold after aligning too, not just when
    // the light is first placed.
    const c = light.cell;
    const band = opt.centreBand;
    return axis === 'x'
      ? { lo: c.cx - band * c.w, hi: c.cx + band * c.w }
      : { lo: c.cy - band * c.h, hi: c.cy + band * c.h };
  }
  return { lo: -Infinity, hi: Infinity };
}
