// ---------------------------------------------------------------------------
// point.js — A POINT, AS A PRIMITIVE. Free, or held on another geometry.
//
// WHAT IT IS FOR. Everything you can touch on this canvas is one of three
// things, and until now only the middle one had a name:
//
//   A GEOMETRY      where something is. A point, a path, an outline.
//   AN ELEMENT      what is there, standing on a geometry. A spot, a
//                   directional spot, a switchboard plate, a diffuser.
//   A COLLECTION    a set of elements set out together. A row of spots, the
//                   diffusers on one magnetic run.
//
// This is the first geometry: THE POINT. It exists so that an element which is
// a point does not have to say again what a point does. Six things on this
// sheet are a point with a fitting drawn on it — a hand-placed downlight, a
// task spot, an art spot, a ceiling object, a switchboard plate, a module on a
// run — and every one of them arrived with its own answer to "how do you move
// it, hold it to an axis, copy it, delete it". lib/dragMove.js already unified
// the ARITHMETIC of that and hooks/useDrag.js the LIFECYCLE. What neither of
// them says is what a POINT is, and that is the gap an element keeps falling
// into: two of the six store a coordinate they cannot honour, and one of them
// is a fraction of a path with its whole constraint written out by hand.
//
// --- TWO KINDS, AND THEY ARE ONE FAMILY -------------------------------------
//
//   FREE      `{ x, y }` in the store's own unit. It goes where it is put.
//   ON A PATH `{ on: hostId, u }` — a FRACTION of another geometry, 0..1. It
//             goes only where that geometry goes, and `u` is the only thing
//             about its position that is recorded.
//
// `pointKind` reads the kind off the record rather than off a `type` field, so
// there is no third state where a point claims to be constrained and carries a
// coordinate anyway. A constrained point's `x`/`y` are written NULL and kept
// null: a stale coordinate beside a live `u` is a lie that survives a save, and
// the first reader to trust the wrong one puts a fitting where nobody put it.
//
// WHY A FRACTION AND NOT A DISTANCE. The argument is `clampU`'s and it is made
// at length in lib/magTrack.js: a host path is resized by its grips and
// duplicated onto a room of another size, and a point stored in feet from the
// corner falls off the end of a shortened run — silently, because a point with
// nowhere to sit is simply not drawn. Stored as a fraction the arrangement
// survives the edit and redistributes, which is the answer somebody dragging a
// grip is asking for. So the fraction is the RECORD and the position is a
// READOUT: `resolvePoint` is the only way to get one.
//
// --- WHAT IS NOT HERE, AND WHERE IT IS -------------------------------------
//
// THE SHAPES ARE geometry.js's. Where a path passes closest to a point, how
// long it is, what point sits a given distance along it: `arcLengthAt`,
// `pathLength`, `pointAt`. Nothing here re-derives any of that.
//
// THE GESTURE ARITHMETIC IS dragMove.js's. The slop, the delta measured from
// the press, the ortho lock and its named axis, the copy that restores its
// originals. `movePoints` and `copyPoints` are `applyDelta` and `forkCopy` with
// a point's constraint threaded through them, and they compute no positions of
// their own.
//
// THE LIFECYCLE IS useDrag.js's, and hooks/usePoint.js is this file bound to
// it. A press, a modifier read live off every frame, the fork, the release.
//
// WHAT IS HERE IS THE CONSTRAINT, ONCE. `at` resolves a point to a position and
// `to` puts a position back under the point's own rule — and because those are
// exactly the two adapters dragMove.js and useDrag.js already take, an element
// that is a point inherits move, ortho, copy and delete by handing over
// `pointAdapters` and writing no gesture code at all.
//
// --- THE ONE RULE THAT DECIDES THE OTHERS ----------------------------------
//
// A CONSTRAINED POINT TAKES ITS ALIGNMENT FROM ITS HOST AND FROM NOTHING ELSE.
// No ortho lock, no snap, no guide. Both of those would be false claims: the
// lock holds a WANTED position on the row through the press, and the snap puts
// it level with something on the sheet — and then the projection onto the host
// moves it off both, to wherever the path happens to run nearest. A guide drawn
// for an alignment the final point does not have is exactly the sin `orthoLock`
// refuses to commit for a modifier. `orthoFor` states the rule as a predicate,
// and hooks/usePoint.js is where it is enforced.
//
// A FREE POINT HONOURS BOTH, which is what "shift to constrain" means on this
// canvas and what every other draggable thing here already does.
//
// PURE. No React, no DOM, no store. Feet or pixels — the unit is the caller's
// and this file never learns which it has, exactly as dragMove.js does not.
// ---------------------------------------------------------------------------

import { pathLength, pointAt, arcLengthAt } from './geometry.js';
import { applyDelta, forkCopy } from './dragMove.js';

/** The two kinds, named once so no call site spells them. */
export const FREE = 'free';
export const ON_PATH = 'on-path';

/**
 * WHICH KIND THIS RECORD IS, READ OFF THE RECORD.
 *
 * A point is constrained when it names a host and free when it does not. There
 * is deliberately no `kind` field to disagree with the data: a record with a
 * host and a coordinate would have two positions and no rule for which wins.
 */
export const pointKind = (pt) => (pt?.on != null ? ON_PATH : FREE);

/** Is this point held on another geometry? */
export const isConstrained = (pt) => pointKind(pt) === ON_PATH;

/**
 * MAY THIS POINT BE HELD TO AN AXIS BY THE SHIFT KEY?
 *
 * Only a free one — see the rule in the header. Exported as a predicate rather
 * than inlined at the two places that ask, because it is the same fact the
 * snap gate reads and the two must not drift apart.
 */
export const orthoFor = (pt) => !isConstrained(pt);

/** A free point at a position. Takes `resolvePoint`'s own shape, so
 *  `freePoint(resolvePoint(pt, host))` is how a point comes off its host. */
export const freePoint = (at, rest = {}) => ({
  ...rest, on: null, u: null,
  x: Number.isFinite(at?.x) ? at.x : 0,
  y: Number.isFinite(at?.y) ? at.y : 0,
});

/** A point held on `hostId`, `u` of the way along it. `x`/`y` are nulled
 *  rather than left behind — see the header on stale coordinates. */
export const pointOn = (hostId, u, rest = {}) => ({
  ...rest, on: hostId, u: clampU(u), x: null, y: null,
});

/** A fresh id, minted for `newCobId`'s reason: an id is what every store and
 *  every selection is keyed by, so there is one minter and not five. */
export const newPointId = (seq = 0) => `pt-${Date.now().toString(36)}-${seq}`;

// --- THE PATH PARAMETER -----------------------------------------------------
//
// THESE THREE WERE lib/magTrack.js's, UNDER A MODULE'S NAME, and that file
// still exports them under it — a module clipped to a run IS a constrained
// point, and it was the first one. They are here because they are facts about a
// point on a path and about nothing electrical, and because the second element
// to need them should not have to import a track to get them.

/** A fraction of a path, held inside it. Everything that writes `u` goes
 *  through this: a `u` of 1.4 is a point off the end of its own host. */
export const clampU = (u) => Math.min(1, Math.max(0, Number(u) || 0));

/** The fraction of the path nearest a point — what a press on a host resolves
 *  to. `arcLengthAt` does the projection; this is only the division. */
export function uAt(pts, p, { closed = false } = {}) {
  const total = pathLength(pts, { closed });
  if (!(total > 0)) return 0;
  return clampU(arcLengthAt(pts, p, { closed }) / total);
}

/**
 * A FRACTION RESOLVED BACK TO A POSITION, with the direction the path is
 * heading there.
 *
 * `ux`/`uy` IS NOT DECORATION. Anything aimed or anything with a body needs it
 * — a directional spot points along the run it is on, a diffuser is 600 mm of
 * body lying ALONG the profile — and recovering it afterwards from a bare
 * coordinate means guessing which leg it came from.
 *
 * `null` where there is no path to sit on, which a caller reads as "not on the
 * drawing" rather than as a point at the origin.
 */
export function atU(pts, u, { closed = false } = {}) {
  const total = pathLength(pts, { closed });
  if (!(total > 0)) return null;
  const q = pointAt(pts, clampU(u) * total, { closed });
  return q ? { x: q.x, y: q.y, ux: q.ux, uy: q.uy } : null;
}

// --- RESOLVING, AND PUTTING BACK --------------------------------------------

/**
 * WHERE THIS POINT IS.
 *
 * A HOST IS `{ id, pts, closed }` and that shape is not invented here: it is
 * what `arrayOutline` in features/ceiling-geometry hands out and what a
 * magnetic run already is. Any geometry that can say those three things can
 * hold points, which is the whole of what "constrained on another geometry"
 * requires of the geometry.
 *
 * `null` FOR A POINT THAT CANNOT BE PLACED — a constrained one whose host has
 * been deleted, or a free one with no coordinate. The callers read it as "not
 * on the drawing", and an element that resolves to null must not be drawn:
 * substituting the origin would put a fitting in the corner of the sheet and
 * bill it.
 */
export function resolvePoint(pt, host = null) {
  if (!isConstrained(pt)) {
    return Number.isFinite(pt?.x) && Number.isFinite(pt?.y)
      ? { x: pt.x, y: pt.y, ux: null, uy: null }
      : null;
  }
  return atU(host?.pts, pt.u, { closed: !!host?.closed });
}

/**
 * A WANTED POSITION, PUT BACK UNDER THIS POINT'S OWN RULE.
 *
 * THIS IS THE WHOLE PRIMITIVE. A free point takes the position. A constrained
 * one takes the fraction of its host nearest to it, which is what "movable only
 * in that geometry" means when the thing doing the moving is a pointer that
 * does not know about the geometry: the drag is resolved in the plane, exactly
 * as it is for everything else on this canvas, and the constraint is applied at
 * the moment of the WRITE. Nothing upstream has to be taught about hosts.
 *
 * `clamp` IS THE DOMAIN'S VETO, AND IT IS WHY THIS TAKES AN OPTION AT ALL. Two
 * diffusers cannot occupy the same foot of profile — see `placeableU` in
 * lib/magTrack.js, which is exactly this hook: it takes the wanted fraction and
 * returns the nearest one the body actually fits at, or `null` when the rest of
 * the run is full. `null` LEAVES THE POINT WHERE IT WAS, which is the only
 * honest answer to a drag with nowhere to land; moving it to the end of the run
 * instead would be putting a fitting somewhere nobody asked for.
 *
 * A CONSTRAINED POINT WITH NO HOST IS REFUSED rather than freed. Its host may
 * be missing because a lookup has not caught up yet, and quietly turning it
 * into a free point at the pointer would be an edit nobody made, to a record
 * that cannot be got back.
 */
export function constrainPoint(pt, want, host = null, { clamp = null } = {}) {
  if (!Number.isFinite(want?.x) || !Number.isFinite(want?.y)) return pt;
  if (!isConstrained(pt)) return { ...pt, x: want.x, y: want.y };
  if (!host?.pts?.length) return pt;
  const wanted = uAt(host.pts, want, { closed: !!host.closed });
  const u = clamp ? clamp(wanted, pt, host) : wanted;
  return u == null ? pt : { ...pt, on: host.id ?? pt.on, u: clampU(u) };
}

/**
 * THE TWO ADAPTERS dragMove.js AND useDrag.js ALREADY TAKE, filled in for a
 * point. `hostFor` is `(pt) => host | null` and is the caller's, because which
 * geometries exist and how they are indexed is not this file's business.
 *
 * HANDING THIS OVER IS THE WHOLE OF WHAT AN ELEMENT HAS TO DO to inherit the
 * gesture: `at` and `to` are the only two things those files ask about a
 * member's position, and both of them are now a point's own rule.
 *
 * `at` FALLS BACK TO THE ORIGIN AND THAT IS SAFE, WHICH IS WORTH SAYING
 * BECAUSE IT LOOKS LIKE IT IS NOT. `applyDelta` reads a base through `at`, adds
 * the delta and writes through `to` — and `to` REFUSES a constrained point
 * whose host is gone, returning it untouched. So the meaningless delta computed
 * from a fallback is discarded by the only line that could have stored it. The
 * one place it would matter is a press ON such a point, where the fallback
 * would become the gesture's anchor, and hooks/usePoint.js declines that press.
 */
export function pointAdapters(hostFor = null, { clamp = null } = {}) {
  return {
    at: (pt) => resolvePoint(pt, hostFor?.(pt)) ?? { x: 0, y: 0 },
    to: (pt, p) => constrainPoint(pt, p, hostFor?.(pt), { clamp }),
  };
}

// --- THE THREE VERBS --------------------------------------------------------
//
// EVERY ONE OF THEM IS dragMove.js'S FUNCTION WITH THE CONSTRAINT THREADED
// THROUGH, and none of them computes a position. They exist so that a caller
// who is NOT in a gesture — a keyboard nudge, a paste, a generator laying out a
// row — moves and copies points by the same rules a hand does. Two
// implementations of "move a point" is how the four rules got broken three
// times before dragMove.js existed.

/**
 * MOVE POINTS BY ONE DELTA, FROM THE SNAPSHOTS TAKEN AT THE PRESS.
 *
 * ONE DELTA, EVERY POINT'S OWN CONSTRAINT. A mixed selection — two free points
 * and one on a run — moves as one gesture: the free ones translate, and the
 * constrained one slides to the place on ITS OWN host nearest to where the
 * delta would have taken it. That is the only group semantics that keeps both
 * promises; translating a constrained point off its host would break the
 * constraint, and refusing the whole drag would make a selection unmovable
 * because of one member.
 */
export const movePoints = (list, startAll, delta, hostFor = null, opt = {}) =>
  applyDelta(list, startAll, delta, pointAdapters(hostFor, opt));

/**
 * OPTION-DRAG: LEAVE THE ORIGINALS AND CARRY ON WITH TWINS.
 *
 * A TWIN OF A CONSTRAINED POINT IS ON THE SAME HOST, because that is what "a
 * copy of this point on this line" means — you alt-drag a spot along a track to
 * get a second spot on the track. Landing the twin on a DIFFERENT geometry is a
 * decision about what the host means for that element, so it is not the
 * primitive's to make: a domain that wants it re-hosts the twin in `onCopy`.
 */
export const copyPoints = (list, startAll, delta, mintId, hostFor = null, opt = {}) =>
  forkCopy(list, startAll, delta, mintId, pointAdapters(hostFor, opt));

/**
 * DELETE. Takes an id, a list of them, or a Set — `collectTargets` normalises
 * its `exclude` the same way and for the same reason: every caller that grew a
 * multi-selection had to convert, and the conversion is one line in one place.
 *
 * IT IS ONLY HALF OF A DELETE, AND THE OTHER HALF IS THE GESTURE. Removing the
 * point a pointer is holding leaves a drag pointing at a record that no longer
 * exists, and the next frame writes it back — the four deletes useDrag.js's own
 * header names had to grow an escape hatch for exactly this. `remove` in
 * hooks/usePoint.js is this function with that hatch pulled.
 */
export function deletePoints(list, ids) {
  const kill = ids instanceof Set ? ids
    : new Set(Array.isArray(ids) ? ids : [ids]);
  return (list ?? []).filter((pt) => !kill.has(pt?.id));
}

/** The points held on one geometry — what a host's own delete has to deal
 *  with, and what a host redistributes when its grips are dragged. */
export const pointsOn = (list, hostId) =>
  (list ?? []).filter((pt) => isConstrained(pt) && pt.on === hostId);

/**
 * WHAT A DELETE OR A COPY OF THIS POINT CARRIES: nothing.
 *
 * STATED RATHER THAN OMITTED, because all five primitives answer this question
 * and an absent answer reads as one nobody got round to — see
 * `dependentsOfPath`, which is the same question for a geometry that DOES hold
 * things. A point is the bottom of the graph: nothing is held on one.
 */
export const dependentsOfPoint = () => ({ points: [], spans: [] });

/**
 * THE POINTS WHOSE HOST IS GONE.
 *
 * A DELETED HOST DOES NOT DELETE WHAT WAS ON IT, and that is the hazard this
 * exists to name. A constrained point with no host resolves to `null`, so it is
 * not drawn — but it is still in the store, still saved, and still counted by
 * anything that bills a list rather than the drawing. So a host's delete asks
 * this and decides: take them with it, or set them free with `detachPoint`
 * BEFORE the host goes, while there is still a position to keep.
 *
 * `hasHost` is `(hostId) => bool` — the caller's index, after the removal.
 */
export const orphanPoints = (list, hasHost) =>
  (list ?? []).filter((pt) => isConstrained(pt) && !hasHost?.(pt.on));

/**
 * FREE -> HELD. `at` is where the point should land on the host; with none it
 * lands nearest to where it already was, which is what dropping a point onto a
 * line means.
 */
export function attachPoint(pt, host, at = null) {
  if (!host?.pts?.length) return pt;
  const p = at ?? resolvePoint(pt, host);
  if (!p) return pt;
  return pointOn(host.id, uAt(host.pts, p, { closed: !!host.closed }), pt);
}

/** HELD -> FREE, at the position it was holding. A point whose host cannot
 *  place it has no position to keep and is returned unchanged: freeing it to
 *  the origin would move it while claiming to release it. */
export function detachPoint(pt, host) {
  const p = resolvePoint(pt, host);
  return p ? freePoint(p, pt) : pt;
}
