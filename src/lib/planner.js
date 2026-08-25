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
//   4. matching   — pairs of adjacent cells (within a chunk) get a LARGE light
//                   on their shared edge; leftovers get a SMALL light at their
//                   centre. Zone edges count as walls for the wall-distance rule.
//   5. align      — snap light coordinates into shared rows/columns, across
//                   chunk boundaries too
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
  alignTol: 1.25,         // ft — lights within this get snapped into a row/column
  fanClearance: 2.0,      // ft — keep lights this far outside the fan's blade circle
  fanAnchorWeight: 1.0,   // how hard each chunk's grid tries to line up with the fan
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

  // reward: a cut line or a cell centre landing on a soft anchor (the fan)
  let bonus = 0;
  for (const a of softAnchors) {
    if (a < lo - 1e-6 || a > hi + 1e-6) continue;
    let best = Infinity;
    for (let k = 0; k <= n; k++) best = Math.min(best, Math.abs(lo + k * size - a));
    for (let k = 0; k < n; k++) best = Math.min(best, Math.abs(lo + (k + 0.5) * size - a));
    bonus += opt.fanAnchorWeight * Math.max(0, 1 - best / (opt.targetCell * 0.5));
  }
  return bonus - penalty;
}

export function partitionAxis(hardAnchors, softAnchors, opt) {
  // dedupe + sort the hard anchors, dissolving anything narrower than minBand
  const uniq = [...new Set(hardAnchors.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const kept = [uniq[0]];
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] - kept[kept.length - 1] >= opt.minBand) kept.push(uniq[i]);
    else if (i === uniq.length - 1) kept[kept.length - 1] = uniq[i]; // never lose the far wall
  }
  if (kept.length < 2) kept.push(uniq[uniq.length - 1]);

  const lines = [kept[0]];
  for (let i = 0; i < kept.length - 1; i++) {
    const lo = kept[i], hi = kept[i + 1], W = hi - lo;
    const base = Math.max(1, Math.round(W / opt.targetCell));
    let bestN = base, bestScore = -Infinity;
    for (const n of new Set([base - 1, base, base + 1].filter((n) => n >= 1))) {
      const s = scoreSplit(lo, hi, n, softAnchors, opt);
      if (s > bestScore) { bestScore = s; bestN = n; }
    }
    const size = W / bestN;
    for (let k = 1; k <= bestN; k++) lines.push(lo + k * size);
  }
  return [...new Set(lines.map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
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
    ch.xLines = partitionAxis([ch.x0, ch.x1], softX, opt);
    ch.yLines = partitionAxis([ch.y0, ch.y1], softY, opt);
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
  const solve = (subset) => {
    const mEdges = [];
    for (const cand of subset) {
      const [lc, rc] = (cand.a.i + cand.a.j) % 2 === 0 ? [cand.a, cand.b] : [cand.b, cand.a];
      if (!Lidx.has(lc.id) || !Ridx.has(rc.id)) continue;
      mEdges.push({ l: Lidx.get(lc.id), r: Ridx.get(rc.id), w: cand.w, id: cand });
    }
    return maxWeightMatching(Lidx.size, Ridx.size, mEdges);
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
    for (const subset of [candidates.filter((c) => c.vertical), candidates.filter((c) => !c.vertical)]) {
      if (!subset.length) continue;
      const alt = solve(subset);
      if (alt.length === matched.length && tidiness(alt) < tidiness(matched)) matched = alt;
    }
  }

  const used = new Set();
  const lights = [];
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
    const { p, clash } = placeSmall(c, polygon, fans, zones, opt);
    lights.push({ id: `S${lights.length}`, kind: 'small', x: p.x, y: p.y,
                  cells: [c.id], cell: c, locked: false, nudged: p.x !== c.cx || p.y !== c.cy, clash });
  }

  // 6. alignment pass — cluster into rows and columns, across chunks too
  alignAxis(lights, 'x', polygon, opt, fans, zones, wallDist);
  alignAxis(lights, 'y', polygon, opt, fans, zones, wallDist);

  const served = new Set();
  for (const l of lights) for (const cid of l.cells) served.add(cid);
  const stats = {
    chunks: chunks.length,
    omittedChunks: omitted.length,
    cells: cells.length,
    served: served.size,
    unserved: cells.length - served.size,
    nudged: lights.filter((l) => l.nudged).length,
    clashes: lights.filter((l) => l.clash).length,
    large: lights.filter((l) => l.kind === 'large').length,
    small: lights.filter((l) => l.kind === 'small').length,
    fans: fans.length,
    avgCell: cells.reduce((s, c) => s + (c.w + c.h) / 2, 0) / cells.length,
    areaSqft: Math.abs(polygonArea(polygon)),
  };
  return { ok: true, chunks, omittedChunks: omitted, zones, cells, lights, stats, opt };
}

/**
 * Where to put a small light inside its cell. Normally dead centre; if that
 * sits inside the fan's exclusion circle (zones can't happen — cells live
 * entirely outside them), take the nearest point in the cell that clears
 * everything. Only if nothing clears do we settle for the least-bad point
 * and flag a clash.
 */
function placeSmall(cell, polygon, fans, zones, opt) {
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
  if (violation(base) === 0) return { p: base, clash: false };

  const ix = cell.w * 0.16, iy = cell.h * 0.16;
  const x0 = cell.x0 + ix, x1 = cell.x1 - ix;
  const y0 = cell.y0 + iy, y1 = cell.y1 - iy;
  const N = 11;
  let best = null, bestD = Infinity, fallback = null, fallbackV = Infinity;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const q = {
        x: x1 > x0 ? x0 + (i / (N - 1)) * (x1 - x0) : cell.cx,
        y: y1 > y0 ? y0 + (j / (N - 1)) * (y1 - y0) : cell.cy,
      };
      if (!pointInPolygon(q, polygon)) continue;
      const v = violation(q);
      if (v < fallbackV) { fallbackV = v; fallback = q; }
      if (v > 0) continue;
      const dCentre = Math.hypot(q.x - base.x, q.y - base.y);
      if (dCentre < bestD) { bestD = dCentre; best = q; }
    }
  }
  if (best) return { p: best, clash: false };
  return { p: fallback || base, clash: true };
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
      const limit = slideLimit(g, axis);
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

function slideLimit(light, axis) {
  if (light.kind === 'small' && light.cell) {
    const c = light.cell;
    const pad = Math.min(c.w, c.h) * 0.22;
    return axis === 'x' ? { lo: c.x0 + pad, hi: c.x1 - pad } : { lo: c.y0 + pad, hi: c.y1 - pad };
  }
  if (light.kind === 'large' && light.span) {
    const s = light.span;
    if (light.axis === 'v') { const half = s.len * 0.34; return { lo: s.y - half, hi: s.y + half }; }
    const half = s.len * 0.34; return { lo: s.x - half, hi: s.x + half };
  }
  return { lo: -Infinity, hi: Infinity };
}
