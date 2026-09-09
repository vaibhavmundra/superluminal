// ---------------------------------------------------------------------------
// region.js — A CLOSED PATH WITH AN INSIDE, AS A PRIMITIVE.
//
// WHAT IT IS FOR. A region is a closed path plus the questions only a closed
// path can answer: is this inside it, how much area is it, what is it with a
// foot taken off all round, and — the one the app keeps needing — where is the
// nearest place inside it a thing is allowed to be.
//
// THAT LAST ONE IS THE POINT OF THE PRIMITIVE. lib/point.js gives a point one
// kind of constraint, ON a path. This is the other kind the canvas already
// hand-rolls three times: `clampCoveMove` holds a cove off the plaster, the
// light in a chunk is clamped to its own cell, and `insideAnyRoom` is asked
// before half the tools will place anything. All three are "hold this inside
// that", and none of them could say so in one place before there was a region.
//
//   `{ pts: [...] }` — always closed. `closed` is not a property here; a region
//   that is not closed has no inside and is a path.
//
// --- WHAT IT COMPOSES ------------------------------------------------------
//
// IT IS A PATH AND IT SAYS SO. `translatePath` moves it, `asPathHost` hands its
// BOUNDARY over as a host — which is what a switchboard plate is held on, see
// `slideBoardTo`, and what a cove run round a room is a span of. So a region is
// not a rival to path.js; it is a path wearing one more question.
//
// THE SHAPE MATHS IS geometry.js's, ALL OF IT. `pointInPolygon`, `polygonArea`,
// `offsetPolygon`, `maxInset`, `distanceToBoundary`, `edges`,
// `nearestOnSegment`, `ensureCCW`. Nothing here re-derives any of it, and where
// a domain already has a better answer than the general one this file does not
// compete with it — see the note on `clampInside`.
//
// PURE. The unit is the caller's, as in point.js.
// ---------------------------------------------------------------------------

import {
  bbox, polygonArea, pointInPolygon, ensureCCW, offsetPolygon, maxInset,
  distanceToBoundary, edges, nearestOnSegment,
} from './geometry.js';
import { translatePath, pathAdapters } from './path.js';

export const REGION = 'region';

/** A region from a ring of points. Wound anti-clockwise, because half the
 *  geometry below is sign-sensitive and a caller should not have to know
 *  which half. */
export const makeRegion = (pts, rest = {}) => ({
  ...rest, pts: ensureCCW((pts ?? []).map((p) => ({ x: p.x, y: p.y }))),
});

/** Three points is the least that has an inside. */
export const isRegion = (r) => (r?.pts?.length ?? 0) >= 3;

/** Its boundary, as the host contract point.js and span.js ask for. ALWAYS
 *  closed — that is what makes it a region rather than a path. */
export const asPathHost = (r) => (isRegion(r)
  ? { id: r.id ?? null, pts: r.pts, closed: true } : null);

// --- WHAT ONLY A REGION CAN ANSWER ------------------------------------------

export const regionArea = (r) => (isRegion(r) ? Math.abs(polygonArea(r.pts)) : 0);
export const regionContains = (r, p) =>
  (isRegion(r) && !!p ? pointInPolygon(p, r.pts) : false);
export const regionBounds = (r) => bbox(r?.pts ?? []);

/** Its bounding-box centre. NOT a centroid, and not necessarily inside it:
 *  an L-shaped room's box centre can be in the notch. Use it as a handle —
 *  which is all `regionAdapters` uses it for — and not as a place to put
 *  anything. */
export function regionCentre(r) {
  const b = regionBounds(r);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** How far inside a point is, or how far outside — negative when outside, so
 *  one number answers both questions. */
export function clearanceIn(r, p) {
  if (!isRegion(r) || !p) return 0;
  const d = distanceToBoundary(p, r.pts);
  return regionContains(r, p) ? d : -d;
}

/** The region with `d` taken off all round, as a ring of points — the pocket
 *  a cove runs in, the band a fitting has to stay inside. geometry.js's own
 *  offset, so a rounded outline keeps its corners. */
export const insetRegion = (r, d) =>
  (isRegion(r) ? offsetPolygon(r.pts, -Math.abs(d)) : []);

/** How far in this region can be taken before it closes up on itself — what
 *  says whether an inset is possible at all. */
export const regionMaxInset = (r, opt = {}) =>
  (isRegion(r) ? maxInset(r.pts, opt) : 0);

/**
 * THE NEAREST PLACE INSIDE THIS REGION A POINT IS ALLOWED TO BE.
 *
 * THE THIRD CONSTRAINT KIND, and the one point.js does not have: `on` holds a
 * point to a path, and this holds it inside an outline. A light clamped to its
 * own cell and a fitting kept off the plaster are the same act, and it is worth
 * saying what makes a clamp feel right — the limit is something you MEET, not
 * something you are told about afterwards. Pushed at a wall the point stops
 * against it and slides ALONG it, because only the offending component is taken
 * away.
 *
 * ALREADY LEGAL GOES THROUGH UNTOUCHED, which is not an optimisation: pushing
 * a point that is comfortably inside onto some computed interior position would
 * move it for no reason, and a drag that nudges what it is not clamping is a
 * drag nobody can aim.
 *
 * OTHERWISE IT IS PROJECTED ONTO THE NEAREST EDGE AND STEPPED IN, along that
 * edge's own inward normal. That is exact for the case that matters — a point
 * held against one wall — and approximate in an inside corner, where the
 * honest answer is that two walls are being met at once and the caller gets the
 * nearer of them.
 *
 * IT DOES NOT REPLACE `clampCoveMove`, AND MUST NOT BE USED WHERE THAT IS. That
 * function clamps a SHAPE with an extent off the plaster and does it in two
 * passes with a bisection, precisely because a box's corner meets a notch its
 * centre knows nothing about — see its own note. This is the POINT case, which
 * is that question's degenerate one. When box.js's extent is folded in, the two
 * become one function; until then the shape version is the real pass and this
 * one is not a substitute for it.
 */
export function clampInside(p, r, { gap = 0 } = {}) {
  if (!isRegion(r) || !p) return p;
  if (clearanceIn(r, p) >= gap) return p;
  let best = null;
  for (const [a, b] of edges(r.pts)) {
    const q = nearestOnSegment(p, a, b);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || d < best.d) best = { d, q, a, b };
  }
  if (!best) return p;
  /* THE INWARD NORMAL OF THAT EDGE. The ring is anti-clockwise — `makeRegion`
     sees to it — so the inside is to the LEFT of a->b, and the left normal of
     (dx, dy) is (-dy, dx). Without the winding fixed this pushes half the
     points out of the region it is holding them in. */
  const dx = best.b.x - best.a.x, dy = best.b.y - best.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / len, y: dx / len };
  return { x: best.q.x + n.x * gap, y: best.q.y + n.y * gap };
}

// --- MOVE, AND THE TWO ADAPTERS ---------------------------------------------

/** A region translates like the path it is — `translatePath`, so a region and
 *  a path moved by the same delta move identically, and anything held on the
 *  boundary keeps its fraction. */
export const translateRegion = translatePath;

/**
 * THE ADAPTER PAIR — path.js's, unchanged.
 *
 * ITS ANCHOR IS THE FIRST POINT AND NOT THE CENTRE, for the reason
 * `pathAdapters` gives and for one more of this file's own: a region's box
 * centre may not be inside it, so a delta measured from there is measured from
 * a place the drawing does not have. `regionCentre` stays a handle for drawing
 * and hit tests.
 */
export const regionAdapters = pathAdapters;

/** A region move honours the shift lock — a free translation in the plane, the
 *  same answer `pathOrtho` gives. */
export const regionOrtho = () => true;

/**
 * WHAT A DELETE OR A COPY OF THIS REGION CARRIES.
 *
 * TWO SETS AND THEY ARE NOT THE SAME QUESTION. Points and spans held ON the
 * boundary have no position without it — the switchboard plate on a room's
 * outline, a cove run round it — and they go with it, exactly as a path's do.
 * Points merely INSIDE it are a different matter: a downlight in a room is not
 * held by the room, and deleting a region that happens to be over it must not
 * take it. So `inside` is returned SEPARATELY and is for a caller that has
 * decided the region owns its contents — a chunk owns the lights in its cell,
 * a room does not own the furniture.
 */
export function dependentsOfRegion(r, { points = [], spans = [] } = {}) {
  const id = r?.id ?? null;
  return {
    points: id == null ? []
      : points.filter((pt) => pt?.on === id).map((pt) => pt.id),
    spans: id == null ? []
      : spans.filter((sp) => sp?.on === id).map((sp) => sp.id),
    inside: points.filter((pt) => pt?.on == null && regionContains(r, pt))
      .map((pt) => pt.id),
  };
}
