// ---------------------------------------------------------------------------
// geometry.js — rectilinear polygon helpers. Everything here is unit-agnostic;
// the planner feeds it feet, the detector feeds it pixels.
// ---------------------------------------------------------------------------

export const EPS = 1e-9;

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function ensureCCW(pts) {
  return polygonArea(pts) < 0 ? [...pts].reverse() : pts;
}

export function pointInPolygon(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > pt.y) !== (yj > pt.y) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + EPS) + xi) inside = !inside;
  }
  return inside;
}

export function edges(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
  return out;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Straight-line distance to the nearest point on the boundary. */
export function distanceToBoundary(p, poly) {
  let best = Infinity;
  for (const [a, b] of edges(poly)) best = Math.min(best, distToSegment(p, a, b));
  return best;
}

/**
 * Axis clearance: how far you can travel from p along -axis and +axis before
 * hitting a wall. This is what "6 feet from the wall" actually means to a
 * human standing under the fitting — measured straight across, not diagonally.
 * Returns { neg, pos, min }.
 */
export function axisClearance(p, poly, axis /* 'x' | 'y' */) {
  const along = axis === 'x' ? 'x' : 'y';
  const across = axis === 'x' ? 'y' : 'x';
  let neg = Infinity, pos = Infinity;
  for (const [a, b] of edges(poly)) {
    const a1 = a[across], b1 = b[across];
    // only edges that straddle p's across-coordinate can be hit by the ray
    if (Math.min(a1, b1) - EPS > p[across] || Math.max(a1, b1) + EPS < p[across]) continue;
    const span = b1 - a1;
    let hit;
    if (Math.abs(span) < EPS) {
      // edge is parallel to the ray; use whichever endpoint is nearer
      hit = Math.abs(a[along] - p[along]) < Math.abs(b[along] - p[along]) ? a[along] : b[along];
    } else {
      const t = (p[across] - a1) / span;
      hit = a[along] + t * (b[along] - a[along]);
    }
    const d = hit - p[along];
    if (d >= -EPS) pos = Math.min(pos, Math.abs(d));
    if (d <= EPS) neg = Math.min(neg, Math.abs(d));
  }
  return { neg, pos, min: Math.min(neg, pos) };
}

/** Fraction of a rectangle's area that falls inside the polygon (sampled). */
export function rectCoverage(rect, poly, n = 6) {
  let hits = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = {
        x: rect.x0 + ((i + 0.5) / n) * (rect.x1 - rect.x0),
        y: rect.y0 + ((j + 0.5) / n) * (rect.y1 - rect.y0),
      };
      if (pointInPolygon(p, poly)) hits++;
    }
  }
  return hits / (n * n);
}

// --- simplification / rectification --------------------------------------

export function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = douglasPeucker(pts.slice(0, idx + 1), eps);
  const right = douglasPeucker(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** Snap a list of scalars into clusters and replace each with its cluster mean. */
export function snapScalars(values, tol) {
  const sorted = [...values].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array(values.length);
  let group = [sorted[0]];
  const flush = () => {
    const mean = group.reduce((s, g) => s + g.v, 0) / group.length;
    for (const g of group) out[g.i] = mean;
  };
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].v - group[group.length - 1].v <= tol) group.push(sorted[k]);
    else { flush(); group = [sorted[k]]; }
  }
  flush();
  return out;
}

/**
 * Turn an arbitrary closed polyline into a clean rectilinear (Manhattan)
 * polygon. Diagonal runs become staircases of one L; near-collinear walls get
 * merged. This is what makes "mostly 90 degrees" hand-drawn input usable.
 */
export function rectifyPolygon(pts, opts = {}) {
  const box = bbox(pts);
  const diag = Math.hypot(box.w, box.h);
  const simplifyEps = opts.simplifyEps ?? diag * 0.006;
  const snapTol = opts.snapTol ?? diag * 0.02;

  let p = douglasPeucker([...pts, pts[0]], simplifyEps);
  p = p.slice(0, -1);
  if (p.length < 4) return axisRect(box);

  // 1. every segment becomes H or V; diagonals become an L
  const stair = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    stair.push(a);
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    const minor = Math.min(dx, dy);
    if (minor > simplifyEps) {
      // genuine diagonal: insert a corner. Go along the dominant axis first,
      // which keeps the staircase hugging the original line.
      stair.push(dx >= dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    }
  }

  // 2. force each edge truly axis-aligned by averaging the minor coordinate
  for (let i = 0; i < stair.length; i++) {
    const a = stair[i], b = stair[(i + 1) % stair.length];
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
      const y = (a.y + b.y) / 2; a.y = y; b.y = y;
    } else {
      const x = (a.x + b.x) / 2; a.x = x; b.x = x;
    }
  }

  // 3. snap coordinates into clusters so near-aligned walls become aligned
  const xs = snapScalars(stair.map((s) => s.x), snapTol);
  const ys = snapScalars(stair.map((s) => s.y), snapTol);
  let q = stair.map((s, i) => ({ x: xs[i], y: ys[i] }));

  // 4. drop duplicates and collinear vertices
  q = dedupe(q);
  q = dropCollinear(q);
  if (q.length < 4 || Math.abs(polygonArea(q)) < box.w * box.h * 0.2) return axisRect(box);
  return ensureCCW(q);
}

function axisRect(box) {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}
export { axisRect };

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS) out.pop();
    else break;
  }
  return out;
}

function dropCollinear(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > EPS) out.push(b);
  }
  return out.length >= 4 ? out : pts;
}
