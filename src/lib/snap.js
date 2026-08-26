// ---------------------------------------------------------------------------
// snap.js — where the cursor actually lands.
//
// Tracing an outline over a real drawing is only as good as its snapping. A
// click that lands two inches off a wall is worse than useless: the room reads
// as slightly wrong, the grid inherits it, and nothing on screen says so.
//
// So this is a proper CAD snap engine, not a nearest-point search:
//
//   end       a segment endpoint            — the wall corner you want
//   int       two segments crossing         — the INNER corner of a wall
//                                             junction, which is usually not
//                                             an endpoint of anything
//   mid       a segment midpoint
//   edge      nearest point on a segment    — anywhere along a wall
//   ortho     axis-aligned with the last point placed
//   orthoInt  where that axis line crosses a wall — "carry on until you hit
//             something", which is the single most useful snap when tracing
//   vertex    a point already placed in this outline
//   close     the first point, to shut the loop
//
// and three that come from what the USER has drawn rather than from the
// drawing, which is the whole of what an image has to offer:
//
//   align     lined up with a corner already placed
//   alignInt  where two such alignments cross — a point two corners agree on,
//             and what makes a hand-traced rectangle come out rectangular
//   grid      a round increment, once the scale is known
//
// Everything is in the source's PX SPACE. Tolerances arrive in px-space units
// (the caller divides screen pixels by the zoom), so the snap radius stays a
// constant size on screen however far in you are.
// ---------------------------------------------------------------------------

const EPS = 1e-9;

/** Distance to the cursor plus the handicap, both in px-space units. */
const cost = (c, tol) => c.d + (HANDICAP[c.as || c.kind] ?? 0) * tol;

// Lower wins, and ties inside a kind break on distance.
export const PRIORITY = {
  close: 0, vertex: 1, end: 2, int: 3, mid: 4, orthoInt: 5, alignInt: 6, edge: 7,
  align: 8, ortho: 9, grid: 10, free: 12,
};

/**
 * A HANDICAP per kind, in fractions of the snap radius, added to the true
 * distance to give each candidate a cost.
 *
 * Ranking on kind alone is wrong, and wrong in the case that matters most.
 * CAD walls OVERRUN each other at a junction: the two lines of a wall are
 * drawn corner to corner along its centreline, so they stick out past the wall
 * they meet. That leaves an endpoint half a wall thickness away from the room's
 * actual corner — and the actual corner is an INTERSECTION of two lines and an
 * endpoint of neither.
 *
 * With kind ranked absolutely, that stray endpoint captured the corner every
 * time, and every room came out exactly one wall thickness too big in each
 * direction. Measured on the sample plan: a room traced dead on its corners
 * came back 21'3" x 15'7" instead of 21'3" x 15'3".
 *
 * So the handicaps are small: at equal distance an endpoint still beats an
 * intersection, but an intersection under the cursor beats an endpoint half a
 * foot away. `edge` carries a real handicap because being somewhere along a
 * wall is the weakest claim there is — it must never outrank a corner you are
 * clearly reaching for.
 */
export const HANDICAP = {
  close: -1.0, vertex: 0, end: 0, int: 0.05, orthoInt: 0.05,
  mid: 0.35, edge: 0.6, ortho: 0.75, free: 10,
  // Drawn geometry rather than the drawing's. An alignment CROSSING is a real
  // point — two corners already placed agree on it — so it sits just behind a
  // wall crossing and ahead of a midpoint. A single alignment is a much weaker
  // claim and must never take a corner the cursor is plainly reaching for.
  //
  // The grid carries the SAME handicap as the bare axis point because it plays
  // the same part: it is the fallback the cursor lands on when nothing real is
  // in range, not a candidate competing at a fixed radius. See the block below.
  alignInt: 0.1, align: 0.7, grid: 0.75,
  // A LOOSE END: a line that stops in mid-air with nothing else touching it.
  // In a double-line wall drawn along its centreline, both faces overrun the
  // wall they meet and stop inside the cavity — so every junction leaves two
  // loose ends exactly half a wall thickness from the corner you are aiming
  // for. They are junction debris, never room corners, and they sit closer to
  // the cursor than the corner does. Demoted, but not disqualified: a wall end
  // at a doorway jamb is also a loose end and is occasionally what you want.
  looseEnd: 0.4,
};

// How close two things must be to count as touching, in px-space units.
const TOUCH = 0.75;

export const SNAP_LABEL = {
  close: 'close the outline', vertex: 'point', end: 'endpoint', int: 'intersection',
  mid: 'midpoint', orthoInt: 'wall on the axis', edge: 'on the wall',
  ortho: 'axis', free: 'free',
  align: 'lined up with a corner', alignInt: 'square with two corners',
  grid: 'on the grid',
};

// --- the index --------------------------------------------------------------

/**
 * Bucket segments into a uniform grid so a mousemove touches a handful of them
 * rather than all 1,656. Built once per drawing.
 */
export function buildSnapIndex(segments = [], circles = [], { cell = 64 } = {}) {
  const buckets = new Map();
  const put = (k, i) => {
    let a = buckets.get(k);
    if (!a) { a = []; buckets.set(k, a); }
    a.push(i);
  };
  segments.forEach((s, i) => {
    const i0 = Math.floor(Math.min(s.x1, s.x2) / cell), i1 = Math.floor(Math.max(s.x1, s.x2) / cell);
    const j0 = Math.floor(Math.min(s.y1, s.y2) / cell), j1 = Math.floor(Math.max(s.y1, s.y2) / cell);
    // A long wall spans many cells; that is fine and correct.
    for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) put(a + ',' + b, i);
  });
  const index = { cell, buckets, segments, circles };

  // Mark the loose ends, once per drawing. An endpoint is SUPPORTED if any
  // other segment has a point within TOUCH of it — another line ending there,
  // crossing it, or running through it. Anything else stops in mid-air.
  index.loose = segments.map((s) => {
    const check = (x, y) => {
      for (const j of near(index, x, y, TOUCH * 2)) {
        const o = segments[j];
        if (o === s) continue;
        const f = footOnSegment(o, { x, y });
        if (f && Math.hypot(f.x - x, f.y - y) <= TOUCH) return false;
      }
      return true;
    };
    return [check(s.x1, s.y1), check(s.x2, s.y2)];
  });
  return index;
}

/** Segment indices whose bounding box could come within `r` of (x, y). */
export function near(index, x, y, r) {
  const { cell, buckets } = index;
  const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell);
  const j0 = Math.floor((y - r) / cell), j1 = Math.floor((y + r) / cell);
  const out = new Set();
  for (let a = i0; a <= i1; a++) {
    for (let b = j0; b <= j1; b++) {
      const arr = buckets.get(a + ',' + b);
      if (arr) for (const i of arr) out.add(i);
    }
  }
  return [...out];
}

// --- geometry ---------------------------------------------------------------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function footOnSegment(s, p) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return null;
  let t = ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: s.x1 + t * dx, y: s.y1 + t * dy, t };
}

function crossing(a, b) {
  const rx = a.x2 - a.x1, ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1, sy = b.y2 - b.y1;
  const den = rx * sy - ry * sx;
  const la = Math.hypot(rx, ry), lb = Math.hypot(sx, sy);
  if (la < EPS || lb < EPS || Math.abs(den) <= EPS * la * lb) return null;
  const qx = b.x1 - a.x1, qy = b.y1 - a.y1;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x1 + t * rx, y: a.y1 + t * ry };
}

/**
 * The nearest grid point, or null when there is no grid.
 *
 * The origin matters: a grid anchored at the image's top-left corner is
 * arbitrary, whereas one anchored at the FIRST CORNER PLACED means every
 * dimension of the outline is a whole increment, which is the point of having
 * one. The caller decides.
 */
function gridPoint(p, gridPx, origin) {
  if (!(gridPx > 0)) return null;
  const ox = origin?.x || 0, oy = origin?.y || 0;
  return {
    x: Math.round((p.x - ox) / gridPx) * gridPx + ox,
    y: Math.round((p.y - oy) / gridPx) * gridPx + oy,
  };
}

/** Where a ray from `from` along an axis meets a segment. */
function axisHit(s, from, axis) {
  if (axis === 'x') {                        // ray varies in x, y is fixed
    const y = from.y;
    const lo = Math.min(s.y1, s.y2), hi = Math.max(s.y1, s.y2);
    if (y < lo - 1e-9 || y > hi + 1e-9) return null;
    const dy = s.y2 - s.y1;
    if (Math.abs(dy) < EPS) return null;     // parallel to the ray
    const t = (y - s.y1) / dy;
    return { x: s.x1 + t * (s.x2 - s.x1), y };
  }
  const x = from.x;
  const lo = Math.min(s.x1, s.x2), hi = Math.max(s.x1, s.x2);
  if (x < lo - 1e-9 || x > hi + 1e-9) return null;
  const dx = s.x2 - s.x1;
  if (Math.abs(dx) < EPS) return null;
  const t = (x - s.x1) / dx;
  return { x, y: s.y1 + t * (s.y2 - s.y1) };
}

// --- the snap ---------------------------------------------------------------

/**
 * Resolve the cursor to a point.
 *
 * `ortho` constrains the result to share an x or a y with the last point
 * placed — walls are rectilinear, so this is on by default and is what makes a
 * traced outline come out clean rather than nearly clean. When it is on, only
 * candidates ON the constraint line are eligible, plus closing the loop, which
 * is always allowed because it is an explicit act.
 *
 * `alignTo` is the corners to line up with — the ones already placed in this
 * outline, and the ones in outlines already traced. `gridPx` and `gridOrigin`
 * add a round-increment fallback. Both are off unless the caller supplies them.
 *
 * Returns { x, y, kind, label, guide, align } — `guide` is the ortho line to
 * draw and `align` the corners the result lined up with, so the user can see
 * WHY the point went where it went.
 */
export function snapAt(index, cursor, opts = {}) {
  const {
    tol = 10, last = null, points = [], ortho = false,
    layers = null, enable = null,
    // Corners to line up with, and the grid to land on. Both are the user's own
    // geometry rather than the drawing's, which is what makes tracing over a
    // plain image accurate — see the align/grid block below.
    alignTo = [], gridPx = 0, gridOrigin = null,
  } = opts;
  const on = (kind) => !enable || enable[kind] !== false;
  const visible = (s) => !layers || layers.has(s.layer);

  const cands = [];
  const add = (kind, p, extra) => {
    if (!p || !on(kind)) return;
    cands.push({ kind, x: p.x, y: p.y, d: dist(p, cursor), ...extra });
  };

  // --- the outline being traced ------------------------------------------
  const first = points[0] || null;
  if (first && points.length >= 3 && dist(first, cursor) <= tol) {
    add('close', first);
  }
  for (let i = 1; i < points.length; i++) {
    if (dist(points[i], cursor) <= tol) add('vertex', points[i]);
  }

  // --- the drawing --------------------------------------------------------
  //
  // Everything below works on the segments that pass WITHIN TOLERANCE of the
  // cursor, not everything in the query box. That is not an optimisation, it
  // is the correct set: the foot of the perpendicular is the closest point on
  // a segment, so any segment with a snappable point inside `tol` necessarily
  // has its foot inside `tol` too.
  //
  // It also keeps the pairwise intersection pass sane. Crossings are O(k^2),
  // and `tol` grows as you zoom OUT — so filtering first is what stops a dense
  // drawing from stalling the cursor at low zoom. Measured: filtering on the
  // foot distance took 600 snaps over 4,000 segments from 700ms to under 20ms.
  const ids = near(index, cursor.x, cursor.y, tol * 2);
  const segs = [];
  for (const i of ids) {
    const s = index.segments[i];
    if (!visible(s)) continue;
    const foot = footOnSegment(s, cursor);
    if (!foot || dist(foot, cursor) > tol) continue;
    segs.push(s);
    add('edge', foot);
    const ends = [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
    const loose = index.loose?.[i] || [false, false];
    for (let k = 0; k < 2; k++) {
      if (dist(ends[k], cursor) <= tol) {
        // Reported as an endpoint either way; only its ranking differs.
        add('end', ends[k], loose[k] ? { as: 'looseEnd' } : null);
      }
    }
    const mid = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    if (dist(mid, cursor) <= tol) add('mid', mid);
  }
  // Circle centres — a column or a column grid is usually drawn as one.
  for (const c of index.circles || []) {
    if (layers && !layers.has(c.layer)) continue;
    const p = { x: c.cx, y: c.cy };
    if (dist(p, cursor) <= tol) add('end', p);
  }
  // Crossings. The inner corner of a wall junction is a crossing of two lines
  // and an endpoint of neither, so without this the most useful point on the
  // whole drawing is unsnappable.
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = crossing(segs[i], segs[j]);
      if (p && dist(p, cursor) <= tol) add('int', p);
    }
  }

  // --- what the user has drawn --------------------------------------------
  //
  // An image carries no line work, and none is invented for it: the geometry
  // worth respecting is the geometry being drawn. A corner lines up with a
  // corner already placed, and where two of those alignments CROSS is a point
  // both of them agree on — which is the difference between a hand-traced
  // rectangle and a nearly rectangular quadrilateral.
  //
  // The DXF route gets this too, and wants it: a room whose far wall is drawn
  // short, or is buried under furniture on layer 0, still has a corner that
  // should be square with the one before it.
  const alignX = [], alignY = [];
  for (const p of alignTo) {
    if (Math.abs(p.x - cursor.x) <= tol) alignX.push(p);
    if (Math.abs(p.y - cursor.y) <= tol) alignY.push(p);
  }
  if (!ortho || !last) {
    for (const p of alignX) add('align', { x: p.x, y: cursor.y }, { align: [p] });
    for (const p of alignY) add('align', { x: cursor.x, y: p.y }, { align: [p] });
    // Only the alignments already within tolerance are paired, so this is a
    // handful of points squared, not every corner on the plan squared.
    for (const p of alignX) {
      for (const q of alignY) add('alignInt', { x: p.x, y: q.y }, { align: [p, q] });
    }
    // The grid is a CONSTRAINT, not another candidate to be weighed. Turning on
    // a six-inch grid means every corner lands on it unless something real is
    // nearer — so it stands in for the free cursor rather than competing at a
    // fixed radius, which is why there is no tolerance test here.
    const g = gridPoint(cursor, gridPx, gridOrigin);
    if (g) add('grid', g);
  }

  // --- ortho --------------------------------------------------------------
  let guide = null;
  if (ortho && last) {
    // Whichever axis the cursor is closer to holding.
    const axis = Math.abs(cursor.x - last.x) >= Math.abs(cursor.y - last.y) ? 'x' : 'y';
    const onAxis = axis === 'x' ? { x: cursor.x, y: last.y } : { x: last.x, y: cursor.y };
    guide = { axis, from: last };

    // Carry on along the axis until a wall stops you.
    for (const s of segs) {
      const p = axisHit(s, last, axis);
      if (p && dist(p, cursor) <= tol) add('orthoInt', p);
    }
    // The axis fixes one coordinate; with a grid on, it rounds the other, so
    // the edge comes out a whole number of increments long. Same fallback,
    // same handicap — the grid replaces the bare axis point rather than
    // arguing with it.
    const gAxis = gridPoint(onAxis, gridPx, gridOrigin);
    if (gAxis) {
      add('grid', axis === 'x' ? { x: gAxis.x, y: onAxis.y } : { x: onAxis.x, y: gAxis.y });
    } else {
      add('ortho', onAxis);
    }

    // Carry along the axis until it squares up with a corner already placed.
    // With the right-angle lock on this is the snap that closes a rectangle
    // exactly, on a drawing that has nothing at that corner to snap to.
    for (const p of (axis === 'x' ? alignX : alignY)) {
      const q = axis === 'x' ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
      if (dist(q, cursor) <= tol) add('alignInt', q, { align: [p] });
    }

    // Only points actually on the constraint line survive — otherwise the
    // ortho lock is a suggestion rather than a lock.
    const keep = cands.filter((c) => c.kind === 'close'
      || (axis === 'x' ? Math.abs(c.y - last.y) < 1e-6 : Math.abs(c.x - last.x) < 1e-6));
    if (keep.length) {
      keep.sort((a, b) => cost(a, tol) - cost(b, tol)
        || PRIORITY[a.kind] - PRIORITY[b.kind]);
      return { ...keep[0], label: SNAP_LABEL[keep[0].kind], guide };
    }
    return { ...onAxis, kind: 'ortho', label: SNAP_LABEL.ortho, guide };
  }

  if (!cands.length) {
    return { x: cursor.x, y: cursor.y, kind: 'free', label: SNAP_LABEL.free, guide: null };
  }
  cands.sort((a, b) => cost(a, tol) - cost(b, tol)
    || PRIORITY[a.kind] - PRIORITY[b.kind]);
  return { ...cands[0], label: SNAP_LABEL[cands[0].kind], guide: null };
}
