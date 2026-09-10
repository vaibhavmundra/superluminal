// ---------------------------------------------------------------------------
// box.js — AN ORIENTED BOX, AS A PRIMITIVE. A centre, two extents, an angle.
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
// WHAT IT IS FOR. It is the geometry of everything you PLACE rather than draw:
// the fan and the chandelier, the AC cassette, the trapdoor, the door box, and
// the centred kinds the geometry bar draws — a rect, a circle, a hexagon. All
// of them are a thing AT a point with a size, and the size is a fact about the
// fitting rather than a second position.
//
//   `{ x, y, wFt, hFt, rot }` — centre, extents, radians.
//
// A CIRCLE IS NOT A PRIMITIVE, IT IS A KIND OF BOX. See `circlePts` in
// ceilingShapes.js, which derives seventy-two points from a radius: the RECORD
// is a centre and an extent, and the outline is a readout. Anything round is a
// box whose two extents are locked together — `uniform` below — which is also
// why a chandelier has no meaningful rotation and the AC cassette does.
//
// --- WHY THE ARITHMETIC IS HERE AND NOT WHERE IT WAS -----------------------
//
// `toLocal`, `toWorld`, `resizeFromCorner`, `rotateTo`, `clampFt`,
// `SIZE_LIMITS` and `ROTATE_SNAP` were lib/ceilingObjects.js's, and that file
// still exports them under the names its forty call sites use. They are FACTS
// ABOUT AN ORIENTED BOX and about nothing on a ceiling: the anchor being the
// opposite corner, Shift locking the aspect, Alt resizing about the centre,
// rotation measured from where the grab started and snapped only while Shift is
// held. The kind-aware half stayed behind, because it reads the catalogue:
// `isRect`, `isUniform`, `halfExtents`, `applyResize` and `radiusFt` are
// questions about a ceiling OBJECT and answer differently for a fan and an
// air-conditioner.
//
// --- WHAT IT COMPOSES ------------------------------------------------------
//
// ITS CENTRE IS A POINT. `boxAdapters` is point.js's own free-point rule, and
// a box constrained to a path — a plate that slides along a wall — is a
// constrained point that happens to carry an extent.
//
// ITS CORNERS ARE POINTS AND ITS OUTLINE IS A PATH. `cornerHandles` hands the
// grips out as point records and `asPathHost` hands the outline over as a
// closed host, so the resize grips ride the point primitive's gesture and
// anything can be held on a box's edge.
//
// MOVE, RESIZE AND ROTATE ARE THREE MODES OF ONE GESTURE, not three gestures.
// That is already how the ceiling object works — `moves: (d) => d.mode ===
// 'move'` in hooks/useDrag.js — and `boxMoves` is that predicate named here so
// the next box does not re-invent it. A frame that is not a translation
// resolves no lock, no snap and no delta, which is right: a corner being
// dragged is not a thing going anywhere, and a guide drawn for one would claim
// an alignment for a corner that is moving on its own.
//
// PURE. Feet or pixels; the unit is the caller's, as in point.js.
// ---------------------------------------------------------------------------

import { bbox } from './geometry.js';
import { freePoint } from './point.js';

export const BOX = 'box';

/** How small and how large a hand-dragged box may get. Ceiling objects' own
 *  figures, which are the only ones anybody has argued about. */
export const SIZE_LIMITS = { minFt: 0.5, maxFt: 12 };
export const clampFt = (v) =>
  Math.max(SIZE_LIMITS.minFt, Math.min(SIZE_LIMITS.maxFt, v));

/** A box. `uniform` locks the two extents together, which is what anything
 *  round is — see the header. */
export const makeBox = ({ x = 0, y = 0, wFt = 1, hFt = 1, rot = 0,
                          uniform = false, ...rest } = {}) => ({
  ...rest, x, y, wFt: clampFt(wFt), hFt: clampFt(uniform ? wFt : hFt),
  rot: rot || 0, ...(uniform ? { uniform: true } : {}),
});

export const isBox = (b) => Number.isFinite(b?.x) && Number.isFinite(b?.y)
  && (b?.wFt ?? 0) > 0 && (b?.hFt ?? 0) > 0;

/** A round box has one dimension, so a corner drag can only mean bigger or
 *  smaller. The kind-aware version of this question — is THIS ceiling object
 *  round — stays `isUniform` in lib/ceilingObjects.js, which reads the
 *  catalogue. */
export const isUniform = (b) => !!b?.uniform;

// --- THE FRAME --------------------------------------------------------------
//
// The gesture maths, kept PURE so it can be tested without a pointer. What
// "feels right" about dragging a handle is almost entirely arithmetic — which
// point stays still, what the modifier key does — and none of it is anything
// React should be deciding inline.
//
// THE ANCHOR IS THE OPPOSITE CORNER. That is the whole of why a resize feels
// direct rather than slippery: grab the bottom-right and the top-left does not
// move, so the box grows under your hand instead of sliding around beneath it.
// Resizing about the CENTRE — the easier thing to write, and what this did
// first — makes the box appear to run away from the pointer at half speed in
// the opposite direction. Alt is the modifier that asks for that deliberately.

const cosSin = (r) => ({ c: Math.cos(r || 0), s: Math.sin(r || 0) });

/** Local (box-frame) coordinates of a world point, about a centre. */
export function toLocal(p, centre, rot) {
  const { c, s } = cosSin(rot);
  const dx = p.x - centre.x, dy = p.y - centre.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** ...and back out again. */
export function toWorld(p, centre, rot) {
  const { c, s } = cosSin(rot);
  return { x: centre.x + p.x * c - p.y * s, y: centre.y + p.x * s + p.y * c };
}

/** The four corners in world space, each with the sign pair that names it —
 *  which is what `resizeFromCorner` takes. */
export function boxCorners(b) {
  if (!isBox(b)) return [];
  const out = [];
  for (const sy of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const p = toWorld({ x: (sx * b.wFt) / 2, y: (sy * b.hFt) / 2 },
        { x: b.x, y: b.y }, b.rot);
      out.push({ ...p, sx, sy });
    }
  }
  return out;
}

/** Its outline as a ring, wound so it reads as a path: top-left, top-right,
 *  bottom-right, bottom-left. */
export function boxOutline(b) {
  const c = boxCorners(b);
  if (c.length !== 4) return [];
  const at = (sx, sy) => c.find((q) => q.sx === sx && q.sy === sy);
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]
    .map((q) => ({ x: q.x, y: q.y }));
}

/** Its outline as the host contract point.js and span.js ask for, so a point
 *  can be held on a box's edge. Closed, because a box is. */
export const asPathHost = (b) => (isBox(b)
  ? { id: b.id ?? null, pts: boxOutline(b), closed: true } : null);

/** The axis-aligned box around a ROTATED one — what a hit test and a selection
 *  rectangle need, and not the same as `wFt` x `hFt` the moment `rot` is not
 *  zero. geometry.js's own `bbox`, so its fields are the ones every other
 *  extent on this canvas is read with. */
export const boxBounds = (b) => bbox(boxOutline(b));

/** Is a world point inside it? Asked in the box's OWN frame, which is the
 *  whole reason `toLocal` exists: testing a rotated box against its
 *  axis-aligned bounds picks it up in the corners it does not occupy. */
export function boxContains(b, p) {
  if (!isBox(b) || !p) return false;
  const l = toLocal(p, { x: b.x, y: b.y }, b.rot);
  return Math.abs(l.x) <= b.wFt / 2 && Math.abs(l.y) <= b.hFt / 2;
}

// --- MOVE, AND THE TWO ADAPTERS ---------------------------------------------

/**
 * THE ADAPTER PAIR, AND IT IS THE SIMPLEST OF THE FOUR: a box's position is its
 * centre, and moving one writes the centre. The extent and the angle are not
 * touched by a translation — which is the whole argument for a chandelier being
 * a point with a size rather than a shape.
 */
export function boxAdapters() {
  return {
    at: (b) => ({ x: b?.x ?? 0, y: b?.y ?? 0 }),
    to: (b, p) => ({ ...b, x: p.x, y: p.y }),
  };
}

/** A box move honours the shift lock — the same free translation a path and a
 *  region get. */
export const boxOrtho = () => true;

/** WHICH FRAMES OF THE GESTURE ARE A TRANSLATION. `useDrag`'s `moves`
 *  predicate, named here because all three modes come through one drag and only
 *  the first is a thing going anywhere. */
export const BOX_MODES = ['move', 'resize', 'rotate'];
export const boxMoves = (drag) => (drag?.mode ?? 'move') === 'move';

// --- ITS OWN VERBS: RESIZE AND ROTATE ---------------------------------------

/**
 * A CORNER DRAG.
 *
 * `corner` is a sign pair — `{ sx: 1, sy: -1 }` is the top-right — and the
 * corner diagonally opposite it is what stays nailed down.
 *
 * `uniform` locks the aspect ratio, which is Shift, and is FORCED for anything
 * round: a chandelier has one dimension, so a corner drag can only mean "bigger
 * or smaller" and offering to squash it into an ellipse would be offering
 * something the object cannot be.
 *
 * `fromCentre` is Alt: the centre stays and both sides grow.
 */
export function resizeFromCorner({ wFt, hFt, x, y, rot = 0 }, corner, pointerFt,
                                 { uniform = false, fromCentre = false } = {}) {
  const { c, s } = cosSin(rot);
  const u = { x: c, y: s }, v = { x: -s, y: c };
  const centre = { x, y };

  if (fromCentre) {
    const l = toLocal(pointerFt, centre, rot);
    let w = clampFt(Math.abs(l.x) * 2), h = clampFt(Math.abs(l.y) * 2);
    if (uniform) {
      const k = Math.max(w / wFt, h / hFt);
      w = clampFt(wFt * k); h = clampFt(hFt * k);
    }
    return { x, y, wFt: w, hFt: h };
  }

  // The corner that must not move, in world space.
  const anchor = {
    x: centre.x + u.x * (-corner.sx * wFt / 2) + v.x * (-corner.sy * hFt / 2),
    y: centre.y + u.y * (-corner.sx * wFt / 2) + v.y * (-corner.sy * hFt / 2),
  };
  const d = { x: pointerFt.x - anchor.x, y: pointerFt.y - anchor.y };
  let w = clampFt((d.x * u.x + d.y * u.y) * corner.sx);
  let h = clampFt((d.x * v.x + d.y * v.y) * corner.sy);
  if (uniform) {
    const k = Math.max(w / wFt, h / hFt);
    w = clampFt(wFt * k); h = clampFt(hFt * k);
  }
  return {
    wFt: w, hFt: h,
    x: anchor.x + u.x * (corner.sx * w / 2) + v.x * (corner.sy * h / 2),
    y: anchor.y + u.y * (corner.sx * w / 2) + v.y * (corner.sy * h / 2),
  };
}

/** Shift-snap increment while rotating, in radians. 15 degrees, as everywhere. */
export const ROTATE_SNAP = (15 * Math.PI) / 180;

/**
 * A ROTATE DRAG. FREE by default and snapped only while Shift is held, which is
 * the convention every editor shares — and the opposite of what this did first,
 * which quantised everything to 5 degrees and made fine adjustment impossible
 * for no benefit.
 *
 * The delta is measured from where the grab STARTED rather than from the box's
 * own axis, so the handle stays under the pointer instead of jumping to it on
 * the first move.
 */
export function rotateTo({ x, y }, pointerFt, { startRot = 0, startAngle = 0,
                                                snap = false } = {}) {
  const a = Math.atan2(pointerFt.y - y, pointerFt.x - x);
  let r = startRot + (a - startAngle);
  if (snap) r = Math.round(r / ROTATE_SNAP) * ROTATE_SNAP;
  // Normalised to (-PI, PI] so the readout never says 725 degrees.
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Apply a resize result back, keeping a round box round. The kind-aware
 *  version — which reads a ceiling object's catalogue entry to decide — stays
 *  `applyResize` in lib/ceilingObjects.js. */
export const applyBoxResize = (b, next) => (isUniform(b)
  ? { ...b, x: next.x, y: next.y,
      wFt: clampFt(Math.max(next.wFt, next.hFt)),
      hFt: clampFt(Math.max(next.wFt, next.hFt)) }
  : { ...b, x: next.x, y: next.y, wFt: next.wFt, hFt: next.hFt });

/** Its four corner grips, as point records — so the resize handles ride the
 *  point primitive's gesture rather than a second one. The sign pair rides
 *  along, because that is what `resizeFromCorner` is given. */
export const cornerHandles = (b) => boxCorners(b).map((q) =>
  freePoint(q, { id: `${b.id ?? BOX}#${q.sx > 0 ? 'r' : 'l'}${q.sy > 0 ? 'b' : 't'}`,
    of: b.id ?? null, corner: { sx: q.sx, sy: q.sy } }));

/** The rotation grip, a fixed distance off the top edge in the box's own
 *  frame — so it stays above the box however far the box is turned. */
export const rotateHandle = (b, offFt = 1) => (isBox(b)
  ? freePoint(toWorld({ x: 0, y: -(b.hFt / 2 + offFt) },
      { x: b.x, y: b.y }, b.rot),
    { id: `${b.id ?? BOX}#rot`, of: b.id ?? null })
  : null);

/** A box hosts nothing by default, so a delete of one carries nothing. Stated
 *  rather than omitted: all four primitives answer this question, and an absent
 *  answer reads as one nobody got round to. Anything held on its EDGE is found
 *  through `asPathHost` and is the caller's to carry. */
export const dependentsOfBox = () => ({ points: [], spans: [] });
