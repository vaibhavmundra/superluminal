// ---------------------------------------------------------------------------
// planner.js — the actual layout engine. Input: a rectilinear polygon in FEET
// plus optional fixtures and no-light zones. Output: chunks, grids and lights.
//
// Pipeline
//   1. carve      — subtract the no-light zones from the room, as if the
//                   outline of the space had changed
//   2. chunk      — decompose what's left into rectangular chunks (largest
//                   rectangle first); chunks thinner than minChunk are omitted
//   3. grid       — each chunk is divided into its own near-square grid.
//                   There is nothing sacred about 6x6: the target cell is a
//                   preference, and every chunk sizes its cells to suit its
//                   own width and height.
//   3b. classify   — a cell that cannot hold a small light near its own centre
//                   is "awkward", and the matching bids to cover it instead
//   4. matching   — pairs of adjacent cells (within a chunk) get a LARGE light
//                   on their shared edge; leftovers get a SMALL light at their
//                   centre. Zone edges count as walls for the wall-distance rule.
//   5. align      — snap light coordinates into shared rows/columns, across
//                   chunk boundaries too, then re-seat any light that ended up
//                   diagonal to its own cell back onto a centre line
//   6. fixtures   — clear anything fouling any of the ceiling fans
// ---------------------------------------------------------------------------

import { bbox, pointInPolygon, distanceToBoundary } from './geometry.js';
import { maxWeightMatching } from './matching.js';

export const DEFAULTS = {
  targetCell: 6.0,        // ft — the "6 by 6" ideal, a preference not a rule
  minCell: 4.0,           // ft — below this we merge rather than make a sliver
  maxCell: 8.0,           // ft — above this we split again
  minBand: 3.0,           // ft — a band thinner than this dissolves into its neighbour
  minChunk: 1.0,          // ft — a chunk this thin (either dimension) is omitted entirely
  minWallDistance: 5.0,   // ft — a large light must be this far from the NEAREST
                          //      wall in every direction. Zone edges are walls.
                          //      The design rule is 6 ft; 5 ft is that rule with
                          //      its working tolerance.
  minSharedEdge: 3.0,     // ft — cells must share at least this much wall to pair up
  cellEdgePad: 0.10,      // fraction of the cell a nudged light keeps clear of its own edge
  centreBand: 0.20,       // a small light must sit within this fraction of the cell
                          //   from its centre. A cell that cannot take one is
                          //   "awkward": the matching bids to cover it with a
                          //   large light instead.
  sizeWeight: 4.0,        // how hard the grid is held to targetCell
  awkwardGridPenalty: 0.25, // a mild tiebreak against grids that park a fan on a
                          //   cell centre — not enough to distort the grid, since
                          //   such a cell is ceded gracefully anyway
  omitAwkwardCells: true, // a cell that can take neither a centred small light
                          //   nor a shared large one gets NO light of its own —
                          //   the fan is the ceiling feature there. Set false to
                          //   place an off-centre light anyway.
  awkwardPriority: 2.0,   // how much a large light covering an awkward cell is
                          //   worth, in units of "one ordinary cell covered".
                          //   0 turns the whole preference off.
  alignTol: 1.25,         // ft — lights within this get snapped into a row/column
  fanClearance: 2.0,      // ft — keep lights this far outside the fan's blade circle
  fanAnchorWeight: 0.6,   // how hard each chunk's grid tries to line up with the fans
  preferLongAxis: true,
  uniformOrientation: true, // pair every cell the same way when it costs nothing
};

// --- no-light zones ---------------------------------------------------------

/** Put a rectangle's corners in canonical order, whatever way it was dragged. */
export function normalizeZone(z) {
  return {
    x0: Math.min(z.x0, z.x1), x1: Math.max(z.x0, z.x1),
    y0: Math.min(z.y0, z.y1), y1: Math.max(z.y0, z.y1),
  };
}

function pointInZone(p, z, pad = 0) {
  return p.x > z.x0 - pad && p.x < z.x1 + pad && p.y > z.y0 - pad && p.y < z.y1 + pad;
}

function inAnyZone(p, zones, pad = 0) {
  for (const z of zones) if (pointInZone(p, z, pad)) return true;
  return false;
}

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

// --- chunk decomposition ----------------------------------------------------

/**
 * Subtract the zones from the room and decompose the remaining space into
 * rectangular chunks. This is the heart of the model: the room minus its
 * no-light zones is treated as a new outline, chopped into rectangles.
 *
 * Method: every wall line and zone edge defines an elementary grid. Each
 * elementary cell is either free (inside the room, outside every zone) or
 * not — never partial, because the room is rectilinear and all of its edges
 * lie on those very lines. Then greedily claim the largest all-free rectangle
 * until nothing is left. Chunks thinner than minChunk in either dimension are
 * set aside as omitted.
 */
export function decomposeIntoChunks(polygon, zones, opt) {
  const box = bbox(polygon);
  const xs = new Set(), ys = new Set();
  const R = (v) => Math.round(v * 1e6) / 1e6;
  for (const p of polygon) { xs.add(R(p.x)); ys.add(R(p.y)); }
  for (const z of zones) {
    for (const v of [z.x0, z.x1]) if (v > box.minX + 1e-6 && v < box.maxX - 1e-6) xs.add(R(v));
    for (const v of [z.y0, z.y1]) if (v > box.minY + 1e-6 && v < box.maxY - 1e-6) ys.add(R(v));
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const nx = X.length - 1, ny = Y.length - 1;
  if (nx < 1 || ny < 1) return { chunks: [], omitted: [] };

  // free matrix + prefix sums for O(1) "is this whole rect free?"
  const free = [];
  for (let i = 0; i < nx; i++) {
    free.push([]);
    for (let j = 0; j < ny; j++) {
      const c = { x: (X[i] + X[i + 1]) / 2, y: (Y[j] + Y[j + 1]) / 2 };
      free[i].push(pointInPolygon(c, polygon) && !inAnyZone(c, zones) ? 1 : 0);
    }
  }
  const claimed = free.map((col) => col.map(() => false));
  const isFree = (i, j) => free[i][j] === 1 && !claimed[i][j];

  const chunks = [], omitted = [];
  for (;;) {
    // largest-area all-free rectangle of elementary cells (real area, in sqft)
    let best = null, bestArea = 0;
    for (let i0 = 0; i0 < nx; i0++) {
      for (let j0 = 0; j0 < ny; j0++) {
        if (!isFree(i0, j0)) continue;
        let jMax = ny; // widest usable row-span shrinks as we extend columns
        for (let i1 = i0; i1 < nx; i1++) {
          let j1 = j0;
          while (j1 < jMax && isFree(i1, j1)) j1++;
          jMax = j1;
          if (jMax === j0) break;
          const area = (X[i1 + 1] - X[i0]) * (Y[jMax] - Y[j0]);
          if (area > bestArea) { bestArea = area; best = { i0, i1: i1 + 1, j0, j1: jMax }; }
        }
      }
    }
    if (!best) break;
    for (let i = best.i0; i < best.i1; i++) for (let j = best.j0; j < best.j1; j++) claimed[i][j] = true;
    const ch = { x0: X[best.i0], x1: X[best.i1], y0: Y[best.j0], y1: Y[best.j1] };
    ch.w = ch.x1 - ch.x0; ch.h = ch.y1 - ch.y0;
    (Math.min(ch.w, ch.h) > opt.minChunk ? chunks : omitted).push(ch);
  }
  return { chunks, omitted };
}

// --- 1D band partition ------------------------------------------------------

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

/**
 * The two or three ways a single band could reasonably be divided, each with
 * its own quality score. The caller picks — and for a chunk it picks the x and
 * y candidates TOGETHER, because whether a fan lands on a cell centre is a
 * two-dimensional question that neither axis can answer alone.
 */
export function bandCandidates(lo, hi, softAnchors, opt) {
  const W = hi - lo;
  const base = Math.max(1, Math.round(W / opt.targetCell));
  const out = [];
  for (const n of [...new Set([base - 1, base, base + 1])].filter((v) => v >= 1)) {
    const size = W / n;
    // Cell size is the brief ("squarish, about 6 by 6"), so it is priced
    // properly rather than as a rounding error. Charging both axes for their
    // own deviation also charges an oblong grid twice, which is why no separate
    // squareness term is needed.
    let penalty = opt.sizeWeight * Math.abs(size - opt.targetCell) / opt.targetCell;
    if (size < opt.minCell) penalty += 3 * (opt.minCell - size);
    if (size > opt.maxCell) penalty += 3 * (size - opt.maxCell);
    // Reward a CUT LINE landing on a soft anchor — never a cell centre. A fan
    // on a grid line becomes a shared corner of the cells around it; a fan on
    // a cell centre ruins that cell (see chooseChunkGrid).
    // Average, not sum: two fans on the same line are satisfied by ONE line, so
    // summing would double the reward and let fan alignment swamp cell size.
    let bonus = 0, seen = 0;
    for (const a of softAnchors) {
      if (a < lo - 1e-6 || a > hi + 1e-6) continue;
      let best = Infinity;
      for (let k = 0; k <= n; k++) best = Math.min(best, Math.abs(lo + k * size - a));
      bonus += Math.max(0, 1 - best / (opt.targetCell * 0.5));
      seen++;
    }
    if (seen) bonus = opt.fanAnchorWeight * (bonus / seen);
    const lines = [];
    for (let k = 0; k <= n; k++) lines.push(lo + k * size);
    out.push({ n, size, lines, score: bonus - penalty });
  }
  return out;
}

/**
 * Pick a chunk's x and y divisions jointly.
 *
 * Scoring each axis on its own is what let a fan end up sitting on a cell
 * centre: each axis looked reasonable, and only the combination was bad. A
 * chunk is a rectangle, so each axis has exactly one band and at most three
 * candidates — nine combinations, cheap to evaluate properly. Each is charged
 * for the cells it would leave unable to hold a centred light.
 */
function chooseChunkGrid(ch, softX, softY, fans, opt) {
  const xs = bandCandidates(ch.x0, ch.x1, softX, opt);
  const ys = bandCandidates(ch.y0, ch.y1, softY, opt);
  let best = null;
  for (const cx of xs) {
    for (const cy of ys) {
      let awk = 0;
      for (let i = 0; i < cx.n; i++) {
        for (let j = 0; j < cy.n; j++) {
          const cell = {
            x0: cx.lines[i], x1: cx.lines[i + 1], y0: cy.lines[j], y1: cy.lines[j + 1],
            cx: (cx.lines[i] + cx.lines[i + 1]) / 2, cy: (cy.lines[j] + cy.lines[j + 1]) / 2,
            w: cx.size, h: cy.size,
          };
          if (cellIsAwkward(cell, fans, opt)) awk++;
        }
      }
      const score = cx.score + cy.score - opt.awkwardGridPenalty * awk;
      if (!best || score > best.score) best = { score, xLines: cx.lines, yLines: cy.lines, awkward: awk };
    }
  }
  return best;
}

/**
 * Can this cell hold a small light inside its centre band, clear of the fans?
 * Cells never overlap a no-light zone, so only the fans can spoil a centre.
 */
function cellIsAwkward(cell, fans, opt) {
  if (!fans.length) return false;
  const clear = (qx, qy) => !fans.some((f) =>
    Math.hypot(qx - f.x, qy - f.y) < (f.r || 0) + opt.fanClearance);
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
  const opt = { ...DEFAULTS, ...options };
  if (!polygon || polygon.length < 4) {
    return { ok: false, reason: 'No usable room outline.', chunks: [], cells: [], lights: [] };
  }

  const fans = fixtures.filter((f) => f.type === 'fan');

  // A room can carry several fans. Every fan is an obstacle in its own right,
  // and every fan is a soft anchor the grid tries to line up with.
  const fanNeed = (f) => (f.r || 0) + opt.fanClearance;
  const fanBlocked = (q) => fans.some((f) => Math.hypot(q.x - f.x, q.y - f.y) < fanNeed(f));
  const zones = noLightZones.map(normalizeZone)
    .filter((z) => z.x1 - z.x0 > 0.1 && z.y1 - z.y0 > 0.1);

  // 1+2. carve the zones out and chunk what remains
  const { chunks, omitted } = decomposeIntoChunks(polygon, zones, opt);
  if (!chunks.length) {
    const reason = zones.length
      ? 'No-light zones cover the whole region — nowhere left to put a light.'
      : 'Room is smaller than one grid cell.';
    return { ok: false, reason, chunks: [], omittedChunks: omitted, zones, cells: [], lights: [] };
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
  const cells = [];
  chunks.forEach((ch, ci) => {
    ch.id = ci;
    const grid = chooseChunkGrid(ch, softX, softY, fans, opt);
    ch.xLines = grid.xLines;
    ch.yLines = grid.yLines;
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
        ch.cellAt.set(`${i},${j}`, cell);
      }
    }
  });

  // 3b. Which cells can actually take a small light near their own centre?
  // A cell that cannot is "awkward": a small light there would sit visibly off
  // centre, so it is better served by a large light shared with a neighbour.
  // The matching below bids for these rather than patching them afterwards.
  const wideFrac = Math.max(0, 0.5 - opt.cellEdgePad);
  const centred = new Map();  // cell id -> spot within the centre band, or null
  const awkward = new Set();
  for (const c of cells) {
    const spot = findSmallSpot(c, polygon, fans, zones, opt, opt.centreBand);
    if (spot.ok) centred.set(c.id, spot);
    else awkward.add(c.id);
  }

  // 4. candidate large-light positions on shared grid lines, within a chunk
  const candidates = [];
  for (const ch of chunks) {
    const longAxis = ch.w >= ch.h ? 'x' : 'y';
    for (const c of ch.cellAt.values()) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const n = ch.cellAt.get(`${c.i + di},${c.j + dj}`);
        if (!n) continue;
        // the shared edge: vertical if neighbour is to the right
        const vertical = di === 1;
        const shared = vertical
          ? { len: Math.min(c.y1, n.y1) - Math.max(c.y0, n.y0), x: c.x1, y: (Math.max(c.y0, n.y0) + Math.min(c.y1, n.y1)) / 2 }
          : { len: Math.min(c.x1, n.x1) - Math.max(c.x0, n.x0), x: (Math.max(c.x0, n.x0) + Math.min(c.x1, n.x1)) / 2, y: c.y1 };
        if (shared.len < opt.minSharedEdge) continue;

        // The rule: the nearest wall — zone edges included — must be far
        // enough away, in ANY direction. Tested at the natural midpoint: the
        // light belongs on the grid intersection, and sliding it inward to
        // rescue a failing position would drag the whole layout off-grid.
        const mid = { x: shared.x, y: shared.y };
        const wall = wallDist(mid);
        if (wall + 1e-9 < opt.minWallDistance) continue;

        // A large light stays on its grid intersection, full stop. If the fan
        // is in the way the pair is simply unavailable, and both cells fall
        // through to small lights — which CAN be nudged aside.
        if (fanBlocked(mid)) continue;
        const p = mid;

        // weight: deeper into the room is better, the long axis is better,
        // lining up with a fixture is better, a squarer pair is better.
        let w = 0;
        w += 2.0 * Math.min(wall, 12) / 12;
        if (opt.preferLongAxis && (vertical ? 'x' : 'y') === longAxis) w += 1.0;
        // lining up with ANY fan is worth the same bonus
        if (fans.some((f) => Math.min(Math.abs(p.x - f.x), Math.abs(p.y - f.y)) < opt.alignTol)) w += 1.5;
        const ar = Math.min(c.w, c.h) / Math.max(c.w, c.h);
        w += 0.75 * ar;
        w += 0.5 * Math.min(shared.len / opt.targetCell, 1);

        candidates.push({ a: c, b: n, p, vertical, w, span: shared });
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
  // pretty it is. An ordinary cell is worth 1 (it would be fine with a small
  // light); an awkward one is worth 1 + awkwardPriority. The aesthetic score is
  // scaled right down so it can only ever break ties between equally valuable
  // matchings — never buy a worse-covering layout.
  const AESTHETIC_SCALE = 1 / 10;
  const cellValue = (c) => 1 + (awkward.has(c.id) ? opt.awkwardPriority : 0);
  const solve = (subset) => {
    const mEdges = [];
    for (const cand of subset) {
      const [lc, rc] = (cand.a.i + cand.a.j) % 2 === 0 ? [cand.a, cand.b] : [cand.b, cand.a];
      if (!Lidx.has(lc.id) || !Ridx.has(rc.id)) continue;
      const w = cellValue(cand.a) + cellValue(cand.b) + cand.w * AESTHETIC_SCALE;
      mEdges.push({ l: Lidx.get(lc.id), r: Ridx.get(rc.id), w, id: cand });
    }
    // Weights now price the trade-off directly, so no cardinality bias: two
    // ordinary pairs and one pair that rescues an awkward cell compete fairly.
    return maxWeightMatching(Lidx.size, Ridx.size, mEdges, { maximizeCardinality: false });
  };

  // A mixed tiling and a uniform one often cover the same number of cells, but
  // the uniform one reads as a regular array instead of a brick bond. Try all
  // three and keep the tidiest of the best-covering options.
  let matched = solve(candidates);
  if (opt.uniformOrientation) {
    const tidiness = (m) => {
      const xs = new Set(m.map((e) => e.id.p.x.toFixed(2)));
      const ys = new Set(m.map((e) => e.id.p.y.toFixed(2)));
      return xs.size + ys.size; // fewer distinct rows/columns == tidier
    };
    const rescues = (m) => m.reduce((n, e) =>
      n + (awkward.has(e.id.a.id) ? 1 : 0) + (awkward.has(e.id.b.id) ? 1 : 0), 0);
    for (const subset of [candidates.filter((c) => c.vertical), candidates.filter((c) => !c.vertical)]) {
      if (!subset.length) continue;
      const alt = solve(subset);
      if (alt.length === matched.length && rescues(alt) >= rescues(matched)
          && tidiness(alt) < tidiness(matched)) matched = alt;
    }
  }

  const used = new Set();
  const lights = [];
  const ceded = [];   // cells deliberately left to a fan
  for (const e of matched) {
    const c = e.id;
    used.add(c.a.id); used.add(c.b.id);
    lights.push({
      id: `L${lights.length}`, kind: 'large',
      x: c.p.x, y: c.p.y,
      axis: c.vertical ? 'v' : 'h',
      cells: [c.a.id, c.b.id],
      span: c.span, locked: false,
    });
  }
  for (const c of cells) {
    if (used.has(c.id)) continue;
    // Every remaining cell MUST get a light. If the centre falls inside the
    // fan's exclusion circle we move the fitting within the cell — deleting it
    // would leave the cell dark, which is never the right answer.
    // Inside the centre band: the ordinary case.
    let spot = centred.get(c.id);
    if (!spot) {
      // Awkward, and the matching could not rescue it with a large light.
      // A light shoved to the edge of its own box looks like a mistake, so by
      // default we place none: a fan occupies that ceiling anyway. The cell is
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

  // 6. alignment pass — cluster into rows and columns, across chunks too
  alignAxis(lights, 'x', polygon, opt, fans, zones, wallDist);
  alignAxis(lights, 'y', polygon, opt, fans, zones, wallDist);

  // 7. re-seat: the alignment pass works one axis at a time, so a light that
  // was nudged along one axis can drift on the other and end up diagonal to
  // its own cell again. Pull the smaller of the two offsets back to zero
  // wherever that is still a legal position.
  reseatOnCellAxis(lights, polygon, fans, zones, opt);

  const served = new Set();
  for (const l of lights) for (const cid of l.cells) served.add(cid);
  const stats = {
    chunks: chunks.length,
    omittedChunks: omitted.length,
    cells: cells.length,
    served: served.size,
    // a ceded cell is a decision, not a hole; `unserved` must stay at zero
    unserved: cells.length - served.size - ceded.length,
    nudged: lights.filter((l) => l.nudged).length,
    awkward: awkward.size,
    rescued: [...awkward].filter((id) => used.has(id)).length,
    outsideBand: lights.filter((l) => l.outsideBand).length,
    ceded: ceded.length,
    offAxis: lights.filter((l) => {
      if (l.kind !== 'small' || !l.cell) return false;
      return Math.abs(l.x - l.cell.cx) > 0.05 && Math.abs(l.y - l.cell.cy) > 0.05;
    }).length,
    clashes: lights.filter((l) => l.clash).length,
    large: lights.filter((l) => l.kind === 'large').length,
    small: lights.filter((l) => l.kind === 'small').length,
    fans: fans.length,
    avgCell: cells.reduce((s, c) => s + (c.w + c.h) / 2, 0) / cells.length,
    areaSqft: Math.abs(polygonArea(polygon)),
  };
  return { ok: true, chunks, omittedChunks: omitted, zones, cells, lights, cededCells: ceded, stats, opt };
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
    for (const f of fans) {
      v += Math.max(0, (f.r || 0) + opt.fanClearance - Math.hypot(q.x - f.x, q.y - f.y));
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
    return !fans.some((f) => Math.hypot(q.x - f.x, q.y - f.y) < (f.r || 0) + opt.fanClearance);
  };
  for (const l of lights) {
    if (l.kind !== 'small' || !l.cell) continue;
    const c = l.cell;
    const dx = l.x - c.cx, dy = l.y - c.cy;
    if (Math.abs(dx) <= tol || Math.abs(dy) <= tol) continue; // already on a line
    // zero the smaller offset first — it is the cheaper correction
    const tries = Math.abs(dx) <= Math.abs(dy)
      ? [{ x: c.cx, y: l.y }, { x: l.x, y: c.cy }]
      : [{ x: l.x, y: c.cy }, { x: c.cx, y: l.y }];
    for (const t of tries) {
      if (!legal(t)) continue;
      l.x = t.x; l.y = t.y;
      l.reseated = true;
      break;
    }
  }
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
  const flush = () => {
    if (group.length < 2) return;
    // Prefer a fan's coordinate if one is in range, else the median. With
    // several fans, use the one closest to where the group already sits.
    let target;
    const mid = group.reduce((s2, g) => s2 + g[axis], 0) / group.length;
    const near = fans
      .filter((f) => group.some((g) => Math.abs(g[axis] - f[axis]) <= opt.alignTol))
      .sort((a, b) => Math.abs(a[axis] - mid) - Math.abs(b[axis] - mid));
    if (near.length) target = near[0][axis];
    else {
      const vals = group.map((g) => g[axis]).sort((a, b) => a - b);
      target = vals[Math.floor(vals.length / 2)];
    }
    for (const g of group) {
      const limit = slideLimit(g, axis, opt);
      const next = Math.max(limit.lo, Math.min(limit.hi, target));
      const trial = { ...g, [axis]: next };
      if (!pointInPolygon(trial, polygon)) continue;
      if (g.kind === 'large' && dist(trial) + 1e-9 < opt.minWallDistance) continue;
      if (fans.some((f) => Math.hypot(trial.x - f.x, trial.y - f.y) < (f.r || 0) + opt.fanClearance)) continue;
      if (inAnyZone(trial, zones)) continue;
      g[axis] = next;
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
  if (light.kind === 'large' && light.span) {
    const s = light.span;
    if (light.axis === 'v') { const half = s.len * 0.34; return { lo: s.y - half, hi: s.y + half }; }
    const half = s.len * 0.34; return { lo: s.x - half, hi: s.x + half };
  }
  return { lo: -Infinity, hi: Infinity };
}
