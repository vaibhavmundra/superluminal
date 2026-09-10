// ---------------------------------------------------------------------------
// path.js — A PATH, AS A PRIMITIVE. The second geometry, and the HOST for the
//
// ===========================================================================
// INHERITING FROM THIS PRIMITIVE MEANS INHERITING THE WHOLE GESTURE — move,
// Option-copy, delete, the Shift ortho lock, the snap, the slop, the group
// move, the snap-back and the refusal — ALL OF IT, ALWAYS, unless the user
// says otherwise about that element in words. Migrating the arithmetic and
// leaving the verbs is not a migration. THE FULL CONTRACT AND THE CHECKLIST
// ARE AT THE TOP OF lib/point.js. Read it before migrating anything onto this.
// ===========================================================================
//
// first.
//
// WHAT IT IS FOR. See the header of lib/point.js for the three layers this
// belongs to and for what a primitive is here. This is the geometry a point can
// be held on, and it is the one the rest of the canvas already needed without
// having: a drawn track's `ptsFt`, a cove pen's path, a magnetic run's outline,
// a room's boundary and a wire's route are one thing wearing five names, and
// every constrained point on the sheet is held on one of them.
//
// A LINE IS NOT A SEPARATE PRIMITIVE, and that is worth saying because it is the
// obvious thing to build. A line is a path of two points. `legs`, `pathLength`,
// `arcLengthAt` and `pointAt` in geometry.js already answer for any n, and a
// two-point special case would fork all four to say nothing new.
//
// --- WHAT A PATH IS -------------------------------------------------------
//
//   `{ pts: [{x, y}, ...], closed }`
//
// OPEN OR CLOSED IS A PROPERTY AND NOT TWO KINDS, unlike the point's free and
// held. Every function here takes `closed` through to geometry.js, which has
// answered for both since it was written: a closed path's last leg runs back to
// its first point and an open one's does not, and there is no third behaviour to
// name. What DOES change with it is the minimum: a run needs two points and a
// circuit needs three — see `canRemoveVertex`, which is `deleteTrackPoint`'s
// rule lifted out of it.
//
// --- WHAT IT COMPOSES, AND WHAT COMPOSES IT -------------------------------
//
// ITS VERTICES ARE POINTS. `vertexPoints` hands them out as free point records,
// so the grips on a path being edited are the point primitive's own gesture —
// the same slop, the same shift lock, the same delete-lets-go-first. That is the
// whole payoff of having built the point first, and it is why `moveVertex` is
// the only vertex verb that needed writing: the rest is inherited.
//
// IT IS A HOST FOR POINTS AND SPANS. `asHost` is the three fields point.js
// asks for. Every constrained point in the app is held on one of these, and
// `pathU`/`pathAt` are that file's `uAt`/`atU` under names about a path.
//
// THE PEN IS NOT HERE AND IS NOT THIS. lib/pen.js is the GESTURE that clicks a
// path out — the rubber band, the axis lock while aiming, the doubled point,
// the "is this on the first dot" test. This is the path once it exists. The two
// verbs that are really pen arithmetic — `penMovePoint` and `penRelock` — are
// called rather than copied, so a rectilinear path edited through this file
// stays square by exactly the rule that drew it.
//
// PURE. Feet or pixels; the unit is the caller's, as in point.js.
// ---------------------------------------------------------------------------

import { pathLength, legs, bbox, douglasPeucker } from './geometry.js';
import { penMovePoint, penRelock, penSegments, penCorners, MIN_SEG_FT } from './pen.js';
import { atU, uAt, freePoint } from './point.js';

export const PATH = 'path';

/** A path from a list of points. `closed` is a property of the path and not a
 *  kind of path — see the header. */
export const makePath = (pts, { closed = false, ...rest } = {}) => ({
  ...rest, pts: (pts ?? []).map((p) => ({ x: p.x, y: p.y })), closed: !!closed,
});

/** Enough of a path to be one. Below this there is nothing to draw and nothing
 *  to hold a point on. */
export const isPath = (path) => (path?.pts?.length ?? 0) >= (path?.closed ? 3 : 2);

/**
 * THE THREE FIELDS point.js ASKS OF A HOST, and the reason this file exists
 * before span.js and region.js do. A path IS the host contract; this function
 * is here so that no call site has to know that, and so that a caller holding a
 * room or a magnetic run — neither of which is a `path` record — can hand one
 * over the same way.
 */
export const asPathHost = (path) => (isPath(path)
  ? { id: path.id ?? null, pts: path.pts, closed: !!path.closed } : null);

// --- THE PATH AS A PARAMETER SPACE ------------------------------------------
//
// POINT.JS'S TWO FUNCTIONS, UNDER NAMES ABOUT A PATH. They are aliased rather
// than wrapped for `penLengthFt`'s reason: a second implementation of the same
// division is how the first one drifts.

/** How far along, as a fraction, this path passes closest to a point. */
export const pathU = (path, p) => uAt(path?.pts, p, { closed: !!path?.closed });

/** The position at a fraction, with the direction the path is heading there. */
export const pathAt = (path, u) => atU(path?.pts, u, { closed: !!path?.closed });

/** Its length, walked point to point. */
export const pathLengthOf = (path) =>
  pathLength(path?.pts ?? [], { closed: !!path?.closed });

/** Its legs, and the corners a schedule buys as pieces — pen.js's, so a path
 *  drawn in two goes along one line is still counted as one run. */
export const pathSegments = (path, opt = {}) =>
  penSegments(path?.pts ?? [], { closed: !!path?.closed, ...opt });
export const pathCorners = (path, opt = {}) =>
  penCorners(path?.pts ?? [], { closed: !!path?.closed, ...opt });

// --- MOVE, AND THE TWO ADAPTERS ---------------------------------------------

/**
 * EVERY POINT BY ONE DELTA. A path move is a translation and nothing else: its
 * shape, its closure and its own parameter space are all untouched, so
 * everything held on it stays exactly where it was as a fraction — which is
 * what makes moving a run with six diffusers on it a single edit.
 */
export const translatePath = (path, { dx, dy }) => ({
  ...path, pts: (path?.pts ?? []).map((p) => ({ x: p.x + dx, y: p.y + dy })),
});

/**
 * THE ADAPTER PAIR, AND THE ANCHOR IS THE FIRST POINT.
 *
 * NOT THE CENTRE, WHICH IS THE TEMPTING ANSWER. A path's bounding-box centre
 * moves when its shape is edited and is not on the path at all for anything
 * L-shaped, so a delta measured from it would be measured from a place the
 * drawing does not have. The first point is a vertex of the record, it is
 * stable under every verb below except a reverse, and the pointer's offset
 * inside the path is already handled — `grabOffset` in dragMove.js keeps it, so
 * grabbing a path by its far end does not snap its start under the cursor.
 */
export function pathAdapters() {
  return {
    at: (path) => (path?.pts?.[0] ? { x: path.pts[0].x, y: path.pts[0].y }
      : { x: 0, y: 0 }),
    to: (path, p) => {
      const a = path?.pts?.[0];
      if (!a) return path;
      return translatePath(path, { dx: p.x - a.x, dy: p.y - a.y });
    },
  };
}

/** A path move honours the shift lock: it is a free translation in the plane,
 *  so holding it to the row through the press is a claim the drawing can keep.
 *  Contrast `orthoFor` in point.js, and `spanOrtho`. */
export const pathOrtho = () => true;

// --- ITS OWN VERBS ----------------------------------------------------------

/** Its vertices, as free points — the grips, as the point primitive's own
 *  records, so editing them is that gesture rather than a second one. The id
 *  carries the index, because a vertex has no identity of its own: it IS its
 *  position in the list, and a re-ordering verb below would invalidate any id
 *  minted for it. */
export const vertexPoints = (path) => (path?.pts ?? []).map((p, i) =>
  freePoint(p, { id: `${path.id ?? PATH}#${i}`, of: path.id ?? null, i }));

/** Which vertex a point id names, or null for anything else. */
export function vertexIndex(id) {
  const at = String(id ?? '').lastIndexOf('#');
  if (at < 0) return null;
  const i = Number(String(id).slice(at + 1));
  return Number.isInteger(i) && i >= 0 ? i : null;
}

/**
 * ONE VERTEX MOVED, ITS TWO LEGS KEPT SQUARE WHEN THE PATH IS RECTILINEAR.
 *
 * `lock` IS THE PATH'S OWN PROPERTY AND NOT THE MODIFIER. A drawn track is
 * orthogonal because a track can only be built that way — see `penMovePoint`,
 * which is what does the work here — while a cove outline traced off a plan is
 * not, and squaring one of its corners would be straightening a wall that is
 * not straight. So the caller says which kind of path it has, once, rather than
 * the hand deciding per drag.
 */
export const moveVertex = (path, i, to, { lock = false } = {}) => {
  if (!path?.pts?.length || i < 0 || i >= path.pts.length) return path;
  return { ...path, pts: lock ? penMovePoint(path.pts, i, to)
    : path.pts.map((p, k) => (k === i ? { x: to.x, y: to.y } : p)) };
};

/**
 * A VERTEX TAKEN OUT — but only while there is a path left afterwards.
 *
 * A CIRCUIT NEEDS THREE POINTS AND A RUN NEEDS TWO, which is `deleteTrackPoint`'s
 * guard lifted here so the next path editor does not have to rediscover it.
 * Below the minimum the answer is not a shorter path, it is no path: a two-point
 * closed loop is a line doubled back on itself, and a one-point open one is not
 * a run. `canRemoveVertex` says so separately, because the CALLER has to decide
 * what happens instead — the drawn track deletes itself, and something else may
 * refuse.
 */
export const canRemoveVertex = (path) =>
  (path?.pts?.length ?? 0) > (path?.closed ? 3 : 2);

export function removeVertex(path, i, { lock = false } = {}) {
  if (!canRemoveVertex(path) || i < 0 || i >= path.pts.length) return path;
  const cut = [...path.pts.slice(0, i), ...path.pts.slice(i + 1)];
  /* AND THE TAIL IS RE-SQUARED FROM THE CUT. Taking a point out of the middle
     of a rectilinear path joins its two neighbours with a diagonal, and a track
     cannot be built along one. `penRelock` cascades, which is the honest
     behaviour — see its note. */
  return { ...path, pts: lock ? penRelock(cut, Math.max(1, i)) : cut };
}

/**
 * A VERTEX PUT IN, ON THE LEG NEAREST A POINT.
 *
 * WHERE IT GOES IS DERIVED AND NOT ASKED FOR, because the only honest answer to
 * "add a point here" on a path is "on the leg you clicked, at the place you
 * clicked" — inserting at an index the caller guessed puts a kink in a leg
 * nobody pointed at. The leg is found by walking the legs in order, which is
 * the same walk `arcLengthAt` does.
 */
export function insertVertex(path, at) {
  const pts = path?.pts;
  if (!pts?.length || !Number.isFinite(at?.x)) return path;
  const ls = legs(pts, { closed: !!path.closed });
  if (!ls.length) return path;
  let best = null;
  ls.forEach((l, i) => {
    const t = Math.max(0, Math.min(1,
      ((at.x - l.a.x) * (l.b.x - l.a.x) + (at.y - l.a.y) * (l.b.y - l.a.y))
      / (l.len * l.len)));
    const q = { x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t };
    const d = Math.hypot(q.x - at.x, q.y - at.y);
    if (!best || d < best.d) best = { d, i, q };
  });
  if (!best) return path;
  const out = [...pts];
  out.splice(best.i + 1, 0, best.q);
  return { ...path, pts: out };
}

/** Closed, and open again. A path of two points cannot close — see `isPath`. */
export const closePath = (path) =>
  ((path?.pts?.length ?? 0) >= 3 ? { ...path, closed: true } : path);
export const openPath = (path) => ({ ...path, closed: false });

/** Reversed — which changes nothing about the drawing and everything about the
 *  parameter space, so anything held on it moves. The callers that need it are
 *  the ones fixing a run drawn the wrong way round, and they have to re-map
 *  what is on it: `u` becomes `1 - u`. */
export const reversePath = (path) => ({ ...path, pts: [...(path?.pts ?? [])].reverse() });
export const reverseU = (u) => 1 - u;

/** Fewer points, same line — geometry.js's own, so a traced outline simplified
 *  here comes out exactly as the tracer's does. */
export const simplifyPath = (path, epsilon = MIN_SEG_FT) => ({
  ...path, pts: douglasPeucker(path?.pts ?? [], epsilon),
});

/** Its extent, for a selection box or a hit test. */
export const pathBounds = (path) => bbox(path?.pts ?? []);

/**
 * WHAT A DELETE OR A COPY OF THIS PATH CARRIES WITH IT.
 *
 * THE ONE EDGE THE APP ALREADY WRITES DOWN IS `dropTrackModules`, hard-coded
 * inside `deleteShape`, and this is that edge stated as a question any host can
 * be asked. Everything held on a path — the points, the spans — has no position
 * without it: `resolvePoint` returns null, so it is not drawn, but it is still
 * in the store and still counted by anything that bills a list rather than a
 * drawing.
 *
 * IT RETURNS IDS AND DELETES NOTHING. What to do with them is the caller's and
 * it is not always the same act: a deleted run takes its modules, while a
 * duplicated one gives its copies to the twin — see `duplicateShape`, whose
 * best behaviour is exactly that.
 */
export function dependentsOfPath(path, { points = [], spans = [] } = {}) {
  const id = path?.id ?? null;
  if (id == null) return { points: [], spans: [] };
  return {
    points: points.filter((pt) => pt?.on === id).map((pt) => pt.id),
    spans: spans.filter((sp) => sp?.on === id).map((sp) => sp.id),
  };
}
