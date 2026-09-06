// ---------------------------------------------------------------------------
// pen.js — clicking out a path, as geometry. No React, no state, no tool.
//
// THERE ARE TWO PENS ON THIS SCREEN AND THERE WILL BE MORE. The cove pen draws
// a closed outline of a piece of ceiling; the track pen draws an open,
// rectilinear carrier for fittings. They differ in three things — whether the
// path closes, whether a segment is locked to an axis, and what the finished
// points are handed to — and in nothing else. The clicking, the rubber band,
// the axis lock, the doubled point, the merge of two collinear segments and the
// "is this click on the first dot" test are one behaviour, and this file is it.
//
// FEET, PLAN SPACE, THROUGHOUT. A pen is a gesture over the drawing and the
// drawing's own unit is the plan's foot — the same space `penPts` was already
// kept in. Anything that needs a room's local feet converts at the point of
// use, which is what the room's `geo.toFt` is for.
//
// WHY THE LOCK IS A DIRECTION AND NOT A GRID. Snapping to a grid would put the
// point where the grid is; locking to an axis puts it where the pointer is, on
// the one line the last point can legally leave along. The first is a guess
// about what somebody meant, the second is a constraint they can see being
// applied while they aim.
// ---------------------------------------------------------------------------

/** Nothing shorter than this is a segment; it is a double-click that missed. */
export const MIN_SEG_FT = 0.25;

/**
 * `to`, PUT BACK ON THE HORIZONTAL OR VERTICAL THROUGH `from`.
 *
 * Whichever the gesture is more nearly already making, which is the rule every
 * drawing tool uses and the only one that does not fight the hand: a pointer
 * dragged mostly sideways wants a horizontal, and the moment it is dragged more
 * down than across it wants a vertical. The tie goes to the horizontal, which
 * is arbitrary and has to be decided by something.
 */
export function axisLock(from, to) {
  if (!from || !to) return to;
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
}

/**
 * WHERE THE NEXT CLICK WOULD LAND — the pointer, or the pointer locked to an
 * axis of the last point committed.
 *
 * The one function the rubber band and the click both go through, so what is
 * drawn under the cursor and what is committed by pressing cannot disagree.
 * That was worth a function on its own: a lock applied on commit but not while
 * aiming is a tool that moves your point after you have placed it.
 */
export function penAim(pts, at, { lock = false } = {}) {
  if (!at) return null;
  const last = pts.length ? pts[pts.length - 1] : null;
  return lock && last ? axisLock(last, at) : at;
}

/** Is `at` close enough to the path's first point to mean "close it"? */
export function penClosesAt(pts, at, tolFt, { min = 3 } = {}) {
  if (!at || pts.length < min) return false;
  return Math.hypot(at.x - pts[0].x, at.y - pts[0].y) < tolFt;
}

/** The path's length, walked point to point. */
export function penLengthFt(pts, { closed = false } = {}) {
  let ft = 0;
  for (let i = 1; i < pts.length; i += 1) {
    ft += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (closed && pts.length > 2) {
    ft += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  }
  return ft;
}

/**
 * THE PATH AS SEGMENTS, WITH COLLINEAR NEIGHBOURS MERGED.
 *
 * A locked pen makes doubled points easily — click, move a few inches along the
 * same wall, click — and two segments in a line are not two runs: they are one
 * run somebody drew in two goes. It matters beyond tidiness, because a track's
 * schedule counts PIECES: a run split in half by an accidental click would be
 * billed as two profiles with two sets of end caps and two feeds.
 *
 * Segments shorter than `minFt` are dropped rather than merged. A zero-length
 * one has no direction to compare with its neighbour, so it cannot be merged;
 * left in, it would be a run of nothing that the schedule counts as a piece.
 */
export function penSegments(pts, { closed = false, minFt = MIN_SEG_FT } = {}) {
  const path = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
  const out = [];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < minFt) continue;
    const prev = out[out.length - 1];
    // COLLINEAR IS A CROSS PRODUCT AGAINST A TOLERANCE IN FEET, not an equality
    // of angles: two segments a locked pen made are exactly collinear, and two
    // a free pen made are collinear when a person meant them to be.
    if (prev) {
      const ux = prev.b.x - prev.a.x, uy = prev.b.y - prev.a.y;
      const cross = Math.abs(ux * (b.y - a.y) - uy * (b.x - a.x)) / Math.hypot(ux, uy);
      const forward = ux * (b.x - a.x) + uy * (b.y - a.y) > 0;
      if (cross < 0.02 && forward) { prev.b = b; continue; }
    }
    out.push({ a, b: { ...b } });
  }
  return out;
}

/** How many corners the path turns — what a track's schedule buys as pieces. */
export function penCorners(pts, opt = {}) {
  const n = penSegments(pts, opt).length;
  return opt.closed ? n : Math.max(0, n - 1);
}

/**
 * A PATH PUT BACK ON ITS AXES, from `from` onwards.
 *
 * EDITING A RECTILINEAR PATH IS THE HARD HALF OF DRAWING ONE. Clicking it out
 * is easy — every point is locked to the one before it as it is placed — but
 * take a point OUT of the middle and the two that were either side of it are
 * suddenly joined by a diagonal, which is a run no track can be built as. So an
 * edit that changes the shape of the path has to re-square what it disturbed.
 *
 * FROM THE CUT ONWARDS AND NOT FROM THE START, because everything before it is
 * still square and re-deriving it could only move it. Each point takes the axis
 * its own segment is already more nearly on, which is `axisLock`'s rule and
 * therefore the same answer the pen would have given while drawing.
 *
 * IT CASCADES, AND THAT IS THE HONEST BEHAVIOUR. Squaring one leg moves its far
 * end, which un-squares the next; stopping after one would leave a diagonal
 * further down the path and call the job done.
 */
export function penRelock(pts, from = 1) {
  const out = pts.slice(0, Math.max(1, from));
  for (let i = out.length; i < pts.length; i += 1) {
    out.push(axisLock(out[i - 1], pts[i]));
  }
  return out;
}

/**
 * ONE POINT MOVED, WITH ITS TWO LEGS KEPT SQUARE.
 *
 * NOT `penRelock`, AND THE DIFFERENCE IS THE WHOLE OF WHY BOTH EXIST. Relocking
 * from a dragged corner would let it pull the entire tail of the path around
 * behind it — drag one corner of a C and the far leg swings — which is not
 * editing, it is redrawing. What a corner drag means in every orthogonal editor
 * there is: the corner moves, and the two legs meeting there FOLLOW it. So the
 * neighbour on the horizontal leg takes the new y and keeps its own x, the
 * neighbour on the vertical leg takes the new x and keeps its own y, and
 * nothing beyond those two is touched.
 *
 * A LEG'S AXIS IS READ FROM WHERE IT WAS, not from where the drag has got to. A
 * corner dragged far enough past its neighbour would otherwise flip which leg
 * is which mid-gesture, and the path would turn itself inside out under the
 * hand holding it.
 */
export function penMovePoint(pts, i, to) {
  if (i < 0 || i >= pts.length) return pts;
  const out = pts.map((p) => ({ ...p }));
  const carry = (k) => {
    if (k < 0 || k >= out.length) return;
    // Which way the leg between them ran BEFORE the drag.
    if (Math.abs(pts[k].x - pts[i].x) <= Math.abs(pts[k].y - pts[i].y)) out[k].x = to.x;
    else out[k].y = to.y;
  };
  carry(i - 1); carry(i + 1);
  out[i] = { x: to.x, y: to.y };
  return out;
}
