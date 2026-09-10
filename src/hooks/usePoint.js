// ---------------------------------------------------------------------------
// usePoint.js — THE POINT PRIMITIVE, BOUND TO THE CANVAS'S ONE DRAG LIFECYCLE.
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
//
// WHAT IT IS FOR. lib/point.js says what a point IS — free, or a fraction of
// another geometry — and hooks/useDrag.js already owns the lifecycle every
// draggable thing on this canvas goes through: the capture, the slop, the
// modifier read live off each frame, the copy fork, the snap-back, the release.
// This is the ten lines that join them, so that an element standing on a point
// gets move, shift-lock, option-copy and delete by declaring its store and its
// hosts, and writes NO gesture code.
//
// IT ADDS NOTHING TO THE LIFECYCLE AND THAT IS THE POINT. Everything below is
// either a `useDrag` option filled in from lib/point.js, or one of the three
// gates the primitive's own rule requires. If a gesture behaves oddly the
// answer is in one of those two files, not in this one.
//
// --- THE THREE GATES, AND WHY EACH ONE IS A GATE ---------------------------
//
//   1. NO ORTHO FOR A CONSTRAINED POINT. `ortho` is asked per frame and
//      answered by `orthoFor`. A point on a run is already held to one line;
//      holding the WANTED position to a second one moves it along the run to
//      wherever those two lines happen to be nearest each other, which is a
//      place the hand did not aim at and the row through the press does not
//      pass through. A free point honours shift, which is what "shift to
//      constrain" means everywhere else on this canvas.
//
//   2. NO SNAP FOR A CONSTRAINED POINT EITHER, and for the same reason one
//      level up. A snap puts the wanted position level with something on the
//      sheet; the projection onto the host then takes it off that alignment,
//      and the guide left behind claims a row the fitting is not on. So a
//      constrained drag never reaches the caller's `snap` at all — and it is
//      told, through `onSnapOff`, so it can put its guides away rather than
//      leave the last free drag's lines lying across the drawing.
//
//   3. A POINT THAT CANNOT BE PLACED CANNOT BE PRESSED. A constrained point
//      whose host is missing has no position — `resolvePoint` returns null —
//      and a gesture anchored on one would take the fallback origin for its
//      press position and throw the whole drawing at the corner of the sheet on
//      the first move. `down` declines, and returns null so the caller knows
//      the press was not taken.
//
// WHAT STAYS THE CALLER'S. Which points are selected and come along; where the
// hosts are indexed; what a twin's id looks like; the clearance rule that says
// two bodies cannot share a foot of profile. All four are facts about a domain
// and none of them is a fact about a point.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { makeDrag } from './useDrag.js';
import {
  isConstrained, orthoFor, resolvePoint, pointAdapters, deletePoints,
  pointsOn, newPointId,
} from '../lib/point.js';

/**
 * THE POINT GESTURE, WITHOUT REACT — so tools/test-point.mjs can drive a whole
 * drag with a fake pointer and no renderer, exactly as `makeDrag` is driven.
 *
 * `hostFor` — `(pt) => { id, pts, closed } | null`, the caller's index.
 * `setList` — the store's updater. With none, nothing is written and `onMove`
 *             is the frame, which is the shape six of the ten existing drags
 *             already have.
 * `clamp`   — `(u, pt, host) => u | null`, the domain's veto on where a
 *             constrained point may land. `placeableU` in lib/magTrack.js is
 *             one, and `null` leaves the point where it was.
 * `snap`    — free points only; `(p, axis, ctx) => p`, useDrag's own contract.
 * `onSnapOff` — called at the press of a constrained drag, so guides that
 *             belong to no live alignment can be put away.
 *
 * `at`/`to` ARE NOT ACCEPTED FROM THE CALLER, and that is the one option of
 * `useDrag`'s this hook takes away rather than fills in. How a point's position
 * is read and written IS the primitive — see `pointAdapters` — and a caller
 * that supplied its own pair would have a gesture that no longer honoured the
 * constraint while still calling itself a point. Everything else `useDrag`
 * takes is passed straight through.
 *
 * Returns `{ down, move, up, remove, removeOn, resolve }`.
 */
export function makePointDrag({
  get, set,
  point, capture, zoom,
  hostFor = null, setList,
  clamp = null,
  snap, onSnapOff,
  copy = true, mintId = newPointId,
  ortho = true,
  onDown, onMove, onCopy, onCommit, onRelease,
  ...rest
}) {
  const unit = pointAdapters(hostFor, { clamp });

  /** The member the gesture is anchored on, as it was at the press. After a
   *  copy fork `startAll` is re-keyed to the twins, and a twin carries its
   *  original's kind — so this keeps answering for the thing being dragged. */
  const anchorOf = (d) => (d?.startAll ? d.startAll[d.id] : null);

  const api = makeDrag({
    ...rest,
    get, set, point, capture, zoom, setList, copy, mintId,
    at: unit.at, to: unit.to,
    // GATE 1.
    ortho: (d) => ortho && orthoFor(anchorOf(d)),
    // GATE 2.
    snap: snap && ((p, axis, ctx) =>
      (isConstrained(anchorOf(ctx.drag)) ? p : snap(p, axis, ctx))),
    onDown, onMove, onCopy, onCommit, onRelease,
  });

  /**
   * GATE 3. The press, refused for a point with nowhere to be.
   *
   * `seed` is `useDrag`'s: `{ id, members, ...extra }`. Returns the gesture, or
   * `null` for a press not taken — a caller that has already called
   * `stopPropagation` on the strength of a press it did not get would be
   * swallowing the event for nothing, so this is worth returning.
   *
   * A PRESS WITH NO MEMBER IS DECLINED TOO, and that is a narrowing of
   * `useDrag`'s contract rather than a bug in it: that hook allows an anchorless
   * gesture on purpose, for the six drags whose frame is entirely the caller's.
   * This one moves POINTS out of a store, so a press naming none of them has
   * nothing to read, nothing to write and no anchor to measure from.
   */
  const down = (e, seed = {}) => {
    const anchor = (seed.members ?? []).find((m) => m.id === seed.id)
      ?? (seed.members ?? [])[0] ?? null;
    if (!anchor) return null;
    if (isConstrained(anchor) && !resolvePoint(anchor, hostFor?.(anchor))) return null;
    // GATE 2, at the press: a constrained drag will draw no guides, so any
    // still on screen from the last one have to go now rather than at the
    // release of a gesture that never touched them.
    if (isConstrained(anchor)) onSnapOff?.();
    return api.down(e, seed);
  };

  /**
   * DELETE, WITH THE GESTURE HOLDING IT LET GO FIRST.
   *
   * THE ORDER IS THE WHOLE FUNCTION. A drag whose member has been removed
   * writes it back on the next frame from `startAll` — `applyDelta` reads the
   * press-time snapshot, not the store — so the record comes back from the
   * dead, at the pointer, and the delete looks like it silently failed. This is
   * the hazard useDrag.js's own header names, and the `set` hatch it kept its
   * state externally for.
   *
   * IT ABANDONS THE GESTURE FOR ANY MEMBER OF THE GROUP and not only the one
   * under the pointer: the rest of a multi-selection are in `startAll` too, and
   * one of them coming back is the same bug in a place nobody is looking.
   */
  const remove = (ids) => {
    const kill = ids instanceof Set ? ids
      : new Set(Array.isArray(ids) ? ids : [ids]);
    if (!kill.size) return;
    const d = get?.();
    if (d && (kill.has(d.id) || (d.group ?? []).some((g) => kill.has(g)))) set(null);
    setList?.((l) => deletePoints(l, kill));
  };

  /**
   * EVERY POINT HELD ON ONE GEOMETRY, DELETED WITH IT.
   *
   * A HOST'S DELETE HAS TO SAY SOMETHING ABOUT WHAT WAS ON IT, and this is one
   * of the two honest answers — see `orphanPoints` in lib/point.js for the
   * other and for what is wrong with saying nothing: a constrained point whose
   * host is gone is not drawn, but it is still saved and still counted by
   * anything that bills the store rather than the drawing.
   *
   * WHICH POINTS THOSE ARE IS DECIDED INSIDE THE UPDATER and not before it, for
   * `fork`'s reason in useDrag.js: two writes can land before a re-render, so a
   * list read out here may already be a frame behind. The gesture, which cannot
   * be reached from inside an updater, is asked separately — and it is asked
   * about the HOST rather than about the ids, which is the same question one
   * step earlier.
   */
  const removeOn = (hostId) => {
    const d = get?.();
    const held = Object.values(d?.startAll ?? {})
      .some((pt) => isConstrained(pt) && pt.on === hostId);
    if (held) set(null);
    setList?.((l) => deletePoints(l, pointsOn(l, hostId).map((pt) => pt.id)));
  };

  return {
    ...api, down, remove, removeOn,
    /** Where a point is, for the caller's own drawing. The one reader of a
     *  constrained point's position, so `u` cannot be resolved two ways. */
    resolve: (pt) => resolvePoint(pt, hostFor?.(pt)),
  };
}

/**
 * THE SAME THING WITH ITS STATE IN REACT.
 *
 * `state` LETS THE CALLER OWN IT for `useDrag`'s reason, quoted there: a delete
 * declared hundreds of lines above the drag it has to abandon cannot name a
 * setter it reaches through this hook's return value. `remove` above is that
 * problem solved for a point, so most callers will not need the escape — but
 * the pair is accepted for the ones whose delete is somewhere else already.
 */
export function usePointDrag({ state, ...cfg }) {
  const own = useState(null);
  const [drag, setDrag] = state ?? own;
  const api = makePointDrag({ ...cfg, get: () => drag, set: setDrag });
  return { ...api, drag, set: setDrag };
}
