// ---------------------------------------------------------------------------
// geometry.js — THE GEOMETRY TOOLKIT. Everything here is unit-agnostic; the
// planner feeds it feet, the detector feeds it pixels, the canvas feeds it plan
// pixels, and none of them has to say which.
//
// WHAT BELONGS HERE AND WHAT DOES NOT. This file answers questions about POINTS,
// PATHS AND POLYGONS and knows nothing about what any of them are FOR. Its
// neighbours are the files that do:
//
//   ceilingShapes.js  what a SHAPE is — a kind, its parameters, how one is
//                     dragged out, hit, resized, given handles and named. A
//                     shape resolves to a path (`outlineFt`) and from there it
//                     is this file's business.
//   pen.js            what a PEN PATH is while it is being drawn — the axis
//                     lock, the closing tolerance, merging the two halves of a
//                     leg drawn in two goes.
//   snap.js /         where a point wants to LAND, which is a question about a
//   snapGuides.js     drawing and a pointer rather than about geometry.
//   dragMove.js       what a GESTURE does to a thing you have hold of.
//
// THE RULE FOR ADDING SOMETHING: if it would read the same with the word
// "ceiling", "cove", "track" or "lamp" deleted from its name, it goes here.
//
// ONE IMPLEMENTATION PER QUESTION, WHICH IS WHY `pathLength` IS HERE. It was
// written twice — `pathLengthFt` in ceilingShapes.js and `penLengthFt` in pen.js
// — with the two disagreeing about what `closed` means for a two-point path.
// Both now call this. That is the kind of redundancy this file exists to
// prevent: two answers to "how long is it" is two lengths on one schedule.
// ---------------------------------------------------------------------------

export const EPS = 1e-9;

// --- POINTS AND VECTORS -----------------------------------------------------
//
// FIVE ONE-LINERS, AND THEY WERE WRITTEN OUT TWICE — byte for byte, in
// accentPlace.js and in electrical.js. Nothing was wrong with either copy and
// that is rather the point: a helper small enough to retype is a helper that
// gets retyped, and two files then hold two definitions of what a vector is
// until one of them acquires a guard the other has not. They live here now and
// both import them, which changes not one call site.
//
// `{x, y}` PLAIN OBJECTS, because that is what every other function in this
// file, on this canvas and in the planner already speaks.
export const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
export const add = (p, v) => ({ x: p.x + v.x, y: p.y + v.y });
export const mul = (v, k) => ({ x: v.x * k, y: v.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const len = (v) => Math.hypot(v.x, v.y);

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

/**
 * THE NEAREST POINT ON A SEGMENT, and how far along it that is.
 *
 * `t` IS RETURNED AS WELL AS THE POINT because half the callers want it: which
 * end of a run something is nearer, where along a wall a fitting seats, whether
 * a press landed on the middle of a leg or off its end. Clamped to [0,1], so
 * this is the segment and not the infinite line through it — `lineIntersect`
 * below is the other question.
 *
 * IT WAS WRITTEN THREE TIMES — here, in accentPlace.js and in electrical.js,
 * with the last two identical to each other and equivalent to this. This is the
 * one; both now import it.
 */
export function nearestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0
    : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

/** How far a point is from a segment. */
export function distToSegment(p, a, b) {
  const q = nearestOnSegment(p, a, b);
  return Math.hypot(p.x - q.x, p.y - q.y);
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


/**
 * A POLYGON'S SMALLER SIDE, which is what every tolerance in this app that has
 * to scale with a room is scaled by. Never zero, so it is safe to divide by:
 * a degenerate outline returns 1 rather than poisoning whatever it feeds.
 *
 * IT WAS `roomScale`, IN TWO FILES, one of which said "Same idea as
 * accentPlace" in its comment — which is a duplication that had already been
 * noticed and written down rather than removed. Named for what it measures
 * instead of for the one caller that named it first: a chunk and a cove have a
 * short side too.
 */
export function shortSide(pts) {
  const b = bbox(pts ?? []);
  return Math.min(b.w, b.h) || 1;
}

// --- PATHS ------------------------------------------------------------------

/**
 * HOW LONG A PATH IS, walked point to point.
 *
 * `closed` COUNTS THE LEG BACK TO THE FIRST POINT, and it is off by default
 * because an open path is the more conservative reading of a bare list: a caller
 * that forgets to say gets the length of what it can see, not a leg it never
 * drew.
 *
 * --- A CLOSED PATH OF TWO POINTS IS WALKED TWICE, AND THAT IS THE POINT ------
 *
 * THIS IS WHERE THE TWO OLD COPIES DISAGREED, and it is not a detail. The
 * `pathLengthFt` in ceilingShapes.js walked every edge of the ring including the
 * wrap, so a two-point loop came back as twice the run; `penLengthFt` in pen.js
 * added the closing leg only past three points, so the same input came back as
 * once. Merging them meant choosing, and the first version of this function
 * chose pen's — which silently halved a figure that test-open-cove.mjs asserts
 * outright ("...where a closed reading would double it").
 *
 * THE FULL WALK IS THE ONE THAT IS TRUE. "Closed" means the ring has an edge
 * from each point to the next and from the last back to the first; a two-gon has
 * two such edges, out and back, and its perimeter is twice its span. The
 * degenerate answer is the correct answer, and it is load-bearing: it is what
 * makes `runLengthFt` passing `closed: !isOpen(shape)` mean anything, because a
 * slot billed as a closed ring would be billed for twice the tape.
 */
export function pathLength(pts, { closed = false } = {}) {
  const p = pts ?? [];
  const n = p.length;
  if (n < 2) return 0;
  let out = 0;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = p[i], b = p[(i + 1) % n];
    out += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return out;
}

/** Every leg of a path, as {a, b, len} — the closing one included when asked. */
export function legs(pts, { closed = false } = {}) {
  const p = pts ?? [];
  const out = [];
  const n = closed && p.length > 2 ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > EPS) out.push({ a, b, len });
  }
  return out;
}

/** The point a given distance along a path, with the direction it is heading. */
export function pointAt(pts, dist, { closed = false } = {}) {
  const ls = legs(pts, { closed });
  if (!ls.length) return null;
  let want = dist;
  for (const l of ls) {
    if (want <= l.len || l === ls[ls.length - 1]) {
      const t = l.len > 0 ? Math.min(1, Math.max(0, want / l.len)) : 0;
      return {
        x: l.a.x + (l.b.x - l.a.x) * t,
        y: l.a.y + (l.b.y - l.a.y) * t,
        ux: (l.b.x - l.a.x) / l.len,
        uy: (l.b.y - l.a.y) / l.len,
      };
    }
    want -= l.len;
  }
  return null;
}

/**
 * N POINTS SPREAD ALONG A PATH — what an array of fittings is set out on.
 *
 * THREE ARRANGEMENTS AND THEY ARE NOT INTERCHANGEABLE, which is why the caller
 * says which rather than this guessing from the shape:
 *
 *   CLOSED  n equal steps round the loop, starting at the path's own first
 *           point. There are no ends to land on, so there is no question to
 *           answer: the spacing between the last and the first is the same as
 *           every other, which is the whole point of a run round a room.
 *
 *   OPEN, `ends` ON   the first and last land ON the ends of the path. You drew
 *           that line to say where the run goes, so its ends mean something —
 *           this is the arrangement somebody expects from "put four along here".
 *           One fitting has no pair of ends to sit on and takes the middle,
 *           which is the only reading of "one, along this line" there is.
 *
 *   OPEN, `ends` OFF  n equal cells with a fitting in the middle of each, so the
 *           gap at each end is half the gap between fittings. This is the GRID's
 *           own convention — see the planner — and it is what you want when the
 *           line is a strip of ceiling to be covered rather than a run to be
 *           terminated.
 *
 * ...AND EVERY POINT COMES WITH THE DIRECTION THE PATH IS HEADING THERE, because
 * anything aimed — a spot, a track head — needs it, and recovering it afterwards
 * from a bare list of points means guessing which leg each one came from.
 */
export function pointsAlong(pts, n, { closed = false, ends = true } = {}) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (!count) return [];
  const total = pathLength(pts, { closed });
  if (!(total > 0)) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    let d;
    if (closed) d = (total * i) / count;
    else if (!ends) d = (total * (i + 0.5)) / count;
    else if (count === 1) d = total / 2;
    else d = (total * i) / (count - 1);
    const at = pointAt(pts, d, { closed });
    if (at) out.push(at);
  }
  return out;
}

/**
 * HOW FAR ALONG A PATH IT PASSES CLOSEST TO A POINT.
 *
 * THE ARC LENGTH AND NOT THE POINT, because that is the coordinate the two
 * functions either side of this one speak: `pointAt` takes a distance and
 * `pointsAlong` steps in them. A caller that has a position and needs a
 * PARAMETER — "where on this ring is that corner" — had nothing to ask before
 * this, and every attempt to do it by index runs into the fact that a path and
 * the thing it was derived from very often have different point counts (a
 * rounded rectangle's outline has forty points and four corners).
 *
 * NEAREST ON THE PATH AND NOT NEAREST VERTEX. A corner projected onto the ring
 * a foot inside its own shape lands on the offset corner; projected onto a
 * fillet it lands at the middle of the arc. Both are the right answers and
 * neither is a vertex of the path.
 *
 * 0 WHERE THERE IS NO PATH, which the callers read as the start — there is no
 * honest parameter on a path of one point, and a null would have to be handled
 * at every call site to say the same thing.
 */
export function arcLengthAt(pts, p, { closed = false } = {}) {
  const ls = legs(pts, { closed });
  let best = null, run = 0;
  for (const l of ls) {
    const q = nearestOnSegment(p, l.a, l.b);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || d < best.d) {
      best = { d, s: run + Math.hypot(q.x - l.a.x, q.y - l.a.y) };
    }
    run += l.len;
  }
  return best ? best.s : 0;
}

/**
 * POINTS ON A PATH THAT ARE OBLIGED TO LAND ON GIVEN ANCHORS, plus `per` of
 * them in every span between two anchors.
 *
 * --- WHY THIS EXISTS BESIDE `pointsAlong` -----------------------------------
 *
 * `pointsAlong` DIVIDES THE PERIMETER, WHICH IS THE WRONG DIVISION FOR A SHAPE
 * WITH CORNERS. Four points equally spaced round an 11 x 8 rectangle land at the
 * top-left corner and then at 9.5 ft intervals, which is one third of the way
 * down the right-hand side, a foot short of the bottom-left corner, and
 * somewhere along the top. It is a correct reading of "four, evenly spaced" and
 * nobody looking at the drawing wants it: they drew a rectangle, and the four
 * places a lamp obviously goes on a rectangle are its corners.
 *
 * SO THE ANCHORS ARE DIVIDED INSTEAD. Every anchor gets a point, and each span
 * between two of them is cut into `per` equal parts. `per = 1` is the anchors
 * alone; `per = 2` adds the midpoint of every edge; `per = 3` the thirds. The
 * count is therefore not free — it is `anchors x per` on a closed path and
 * `(anchors - 1) x per + 1` on an open one — and that is the feature rather than
 * a limitation: those are the counts that can be set out from the geometry, and
 * the ones between them cannot.
 *
 * THE SPACING IS NOT UNIFORM AROUND THE WHOLE PATH, and it must not be. On an
 * 11 x 8 rectangle at `per = 2` the long edges get 5.5 ft between lamps and the
 * short ones 4 ft. Forcing one spacing everywhere is exactly what breaks the
 * corners, which is what this function exists to keep. Each EDGE is even in
 * itself, which is what reads as regular on a drawing.
 *
 * ANCHORS ARE PROJECTED, NOT MATCHED. They are handed in as positions and
 * resolved through `arcLengthAt`, so they do not have to be points of the path —
 * a shape's sharp corners can anchor a run set out on its offset ring, or on its
 * own rounded outline. Anything that projects to within a hair of a neighbour is
 * dropped: two anchors at one arc length would make a span of zero and stack
 * `per` fittings on one spot.
 *
 * SORTED BY ARC LENGTH rather than trusted in the order given. An anchor list
 * that runs the other way round the shape, or starts at a different corner, is
 * the same set of places on the same path; leaving it unsorted would produce
 * negative spans.
 */
export function pointsAnchored(pts, anchors, per, { closed = false } = {}) {
  const total = pathLength(pts, { closed });
  if (!(total > 0)) return [];
  const raw = (anchors ?? []).map((a) => arcLengthAt(pts, a, { closed }))
    .sort((a, b) => a - b);
  const at = raw.filter((s, i) => i === 0 || s - raw[i - 1] > EPS * 10);
  if (at.length < (closed ? 3 : 2)) return [];
  const m = Math.max(1, Math.floor(per) || 1);
  const wrap = (s) => ((s % total) + total) % total;
  const out = [];
  const spans = closed ? at.length : at.length - 1;
  for (let i = 0; i < spans; i++) {
    const s0 = at[i];
    // THE LAST SPAN OF A CLOSED PATH RUNS BACK TO THE FIRST ANCHOR, the long way
    // round the end of the path — which is why it is `+ total` and then wrapped
    // rather than a second loop.
    const s1 = i + 1 < at.length ? at[i + 1] : at[0] + total;
    const step = (s1 - s0) / m;
    for (let k = 0; k < m; k++) {
      const q = pointAt(pts, closed ? wrap(s0 + step * k) : s0 + step * k, { closed });
      if (q) out.push(q);
    }
  }
  /* AND THE FAR END OF AN OPEN PATH, which no span starts at. Each span above
     contributes its own start and not its end, so on a closed loop every anchor
     is covered by construction; an open one is a span short at the finish. It is
     the same statement `pointsAlong`'s `ends` option makes — you drew that line
     to say where the run goes, so both of its ends mean something. */
  if (!closed) {
    const q = pointAt(pts, at[at.length - 1], { closed });
    if (q) out.push(q);
  }
  return out;
}

// --- OFFSETTING A CLOSED POLYGON --------------------------------------------

/**
 * A POLYGON SET IN OR OUT BY A CONSTANT DISTANCE.
 *
 * WHAT IT IS FOR: one drawn rectangle is the cove's setting-out line AND the
 * thing a run of spots is arranged around, a foot inside it or a foot outside.
 * The two must be the same geometry or they will not stay parallel when either
 * is edited — which is the whole argument for having a toolkit rather than each
 * tool carrying its own idea of "a bit further in".
 *
 * BY OFFSETTING THE EDGES AND INTERSECTING THEM, not by pushing each vertex
 * along the bisector. The two agree on a convex corner and part company on a
 * reflex one, where the bisector method folds the corner inside out. Offsetting
 * the edges is also the definition — the offset of a polygon is the set of
 * points a fixed distance from it — so the corner falls out of the arithmetic
 * rather than being a case to handle.
 *
 * SIGN: POSITIVE IS OUTWARD, negative inward, whatever the winding of what you
 * hand in. `ensureCCW` settles the winding first so the interior is always to
 * the left of each directed edge and the inward normal is always (-dy, dx);
 * without that the same call would push a clockwise rectangle the wrong way.
 *
 * IT REFUSES RATHER THAN FOLDS. Set a polygon in far enough and it eats itself:
 * the edges cross and what comes back is a bow-tie that no longer resembles the
 * thing you offset. Detecting that in full means clipping the result against
 * itself, which is a great deal of machinery for a case whose only honest answer
 * is "that is too far in". Two cheaper tests catch it:
 *
 *   AN EDGE THAT HAS TURNED ROUND. When a polygon collapses, the first thing
 *   that happens is that some edge's offset runs PAST its neighbours and ends up
 *   pointing the other way. Comparing each new edge's direction with the old
 *   one's is exact for that, and it is what actually fires.
 *   THE AREA LOSING ITS SIGN, as a backstop for the exact-collapse case where
 *   every point lands on top of every other and no edge has a direction left to
 *   compare.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS REFUSE A SLIVER. A 6 ft shape set in 2.99
 * ft is a valid two-inch band, and somebody who typed 2.99 meant it. An earlier
 * version threw away any result under a fifth of the original area, which made
 * the usable limit depend on the aspect ratio — a 10x6 rectangle stopped at 2.87
 * where the geometry says 3 — and that is a rule pretending to be a measurement.
 *
 * A SPIKE IS CLAMPED, not refused. A very sharp corner offset outward runs its
 * miter out towards infinity — mathematically right and useless on a drawing —
 * so the new vertex is held to `miter` times the distance from the old one. Four
 * is the usual limit; it starts to bite at about 30 degrees.
 */
export function offsetPolygon(pts, dist, { miter = 4 } = {}) {
  const poly = ensureCCW(dedupe(pts ?? []));
  if (poly.length < 3) return null;
  if (Math.abs(dist) < EPS) return poly.map((p) => ({ ...p }));

  const n = poly.length;
  // Each edge, pushed along its inward/outward normal. CCW means the interior is
  // to the left, so (-dy, dx) points IN and a positive `dist` must go the other
  // way — hence the sign here rather than at every use below.
  const moved = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < EPS) return null;
    const nx = (dy / len) * dist, ny = (-dx / len) * dist;
    moved.push({ a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny } });
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = moved[(i - 1 + n) % n], cur = moved[i];
    const hit = lineIntersect(prev.a, prev.b, cur.a, cur.b);
    // PARALLEL NEIGHBOURS HAVE NO CORNER TO FIND — two collinear edges, or a
    // hairpin. The offset endpoint is where the corner already is.
    const want = hit ?? cur.a;
    const from = poly[i];
    const reach = Math.hypot(want.x - from.x, want.y - from.y);
    const cap = Math.abs(dist) * miter;
    if (reach > cap && reach > EPS) {
      out.push({ x: from.x + ((want.x - from.x) / reach) * cap,
                 y: from.y + ((want.y - from.y) / reach) * cap });
    } else out.push(want);
  }

  // AN EDGE THAT HAS TURNED ROUND MEANS THE SHAPE HAS EATEN ITSELF — see above.
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const c = out[i], d = out[(i + 1) % n];
    if ((b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) < -EPS) return null;
  }
  if (Math.sign(polygonArea(out)) !== Math.sign(polygonArea(poly))) return null;
  return out;
}

/** Where two infinite lines cross, or null when they never do. */
function lineIntersect(a1, a2, b1, b2) {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < EPS) return null;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / den;
  return { x: a1.x + dx1 * t, y: a1.y + dy1 * t };
}

/**
 * HOW FAR IN A POLYGON CAN BE SET BEFORE IT COLLAPSES, roughly — what a control
 * offering an inward offset should stop at.
 *
 * A BISECTION ON `offsetPolygon` ITSELF rather than an inradius formula, and
 * that is the point: an L-shaped room has no inradius worth the name, and the
 * only definition of "too far" that cannot disagree with the offset actually
 * drawn is the offset actually drawn. Twenty steps is a thousandth of the
 * bounding box, which is finer than anybody can type.
 */
export function maxInset(pts, { steps = 20 } = {}) {
  const box = bbox(ensureCCW(dedupe(pts ?? [])));
  let lo = 0, hi = Math.max(box.w, box.h) / 2;
  if (!(hi > 0)) return 0;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (offsetPolygon(pts, -mid)) lo = mid; else hi = mid;
  }
  return lo;
}
