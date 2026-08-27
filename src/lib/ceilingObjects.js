// ---------------------------------------------------------------------------
// ceilingObjects.js — the things already on the ceiling that the grid has to
// work around.
//
// THERE WAS ONLY EVER THE FAN, and the planner is built round it: a centre, a
// radius, `fanClearance` on top, and a soft anchor the grid tries to line up
// with. A chandelier and an AC cassette want exactly that treatment, and
// inventing a second kind of obstacle for them would mean a second path through
// every one of the seven places planner.js tests a fan.
//
// So they are not a second kind. Everything here resolves to { x, y, r } and
// goes in as `type: 'fan'`. The planner is not told the difference and does not
// need to be; only the canvas draws them apart.
//
// THE RADIUS IS CIRCUMSCRIBED, and that is the honest cost of the above. A fan
// and a chandelier are round, so their radius is theirs exactly. A rectangular
// cassette or trap door gets the circle that contains it — half its diagonal —
// which is right at the corners and generous along the flats. Two consequences
// worth knowing rather than discovering:
//
//   - rotation costs nothing. A circumscribed circle is the same circle at any
//     angle, so spinning a trap door on the drawing cannot move a light. That
//     is a feature: the angle is documentation, not geometry.
//   - a long thin object over-reserves. A 600 square cassette reserves a 1.5ft
//     radius, which is about right; a 2400 linear diffuser would reserve 4ft,
//     which is not. See the note in the README.
//
// Dimensions are held in FEET, never pixels. A fan found by the red-circle
// detector is measured in pixels and has to be, but anything placed by hand is
// a real object of a real size, and holding it in feet is what keeps it that
// size when the scale is corrected underneath it.
// ---------------------------------------------------------------------------

const MM = 1 / 304.8;

/**
 * The catalogue. `kind` is what it is; `id` is what the picker offers, which is
 * not the same thing — the two fan sweeps are one kind and two entries, because
 * "900 or 1200" is the whole of the choice a person makes about a fan.
 */
export const CEILING_TYPES = [
  { id: 'fan',        kind: 'fan',        label: 'Fan',        colour: '#DC2626',
    diaFt: 1200 * MM, sweepsMm: [900, 1200] },
  { id: 'chandelier', kind: 'chandelier', label: 'Chandelier', colour: '#B45309',
    diaFt: 900 * MM },
  { id: 'ac',         kind: 'ac',         label: 'AC unit',    colour: '#0F766E',
    wFt: 900 * MM, hFt: 900 * MM },
  { id: 'trapdoor',   kind: 'trapdoor',   label: 'Trap door',  colour: '#6D28D9',
    wFt: 600 * MM, hFt: 600 * MM },
];

/**
 * Round or rectangular, which is the only distinction any of the maths cares
 * about. A trap door and an AC cassette differ in what they are called, what
 * they are drawn as and what size they default to — and in nothing else.
 */
export const isRect = (o) => o?.kind === 'ac' || o?.kind === 'trapdoor';

export const CEILING_BY_ID = Object.fromEntries(CEILING_TYPES.map((t) => [t.id, t]));

/** A fan's sweep is the whole of the choice anyone makes about a fan. */
export const FAN_SWEEPS = [900, 1200];
export const sweepMm = (o) => Math.round((o.diaFt || 0) / MM);
export const withSweep = (o, mm) => ({ ...o, diaFt: mm * MM });

/** A new object of a catalogue type, at a point in FEET. */
export function makeCeilingObject(typeId, atFt) {
  const t = CEILING_BY_ID[typeId] || CEILING_TYPES[0];
  return {
    id: `co-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`,
    typeId: t.id,
    kind: t.kind,
    x: atFt.x, y: atFt.y,          // FEET, plan space
    diaFt: t.diaFt ?? null,        // fan, chandelier
    wFt: t.wFt ?? null,            // ac
    hFt: t.hFt ?? null,
    rot: 0,                        // radians, ac only
  };
}

/**
 * The clearance radius, in feet. See the header for why a rectangle gets the
 * circle round it rather than a rectangle of its own.
 */
export function radiusFt(o) {
  if (isRect(o)) return Math.hypot(o.wFt || 0, o.hFt || 0) / 2;
  return (o.diaFt || 0) / 2;
}

/**
 * Feet -> the pixel-space obstacle the planner and the canvas both consume.
 *
 * `shape` is what tells the planner to measure to a face rather than to a
 * circle — see surfaceDistance in planner.js. `r` is still filled in for
 * everything, because it is what the canvas and the snap targets use for a
 * rough extent, and because a fixture with no shape must keep behaving as the
 * circle it always was.
 */
export function toObstaclePx(o, pxPerFt) {
  const s = pxPerFt || 1;
  return {
    ...o,
    x: o.x * s, y: o.y * s,
    r: radiusFt(o) * s,
    w: (o.wFt || 0) * s,
    h: (o.hFt || 0) * s,
    rot: o.rot || 0,
    shape: isRect(o) ? 'rect' : 'circle',
    source: 'placed',
  };
}

/** One line of size, for the panel. Feet-and-inches is how these are ordered. */
export function sizeLabel(o) {
  const mm = (ft) => Math.round(ft / MM);
  if (isRect(o)) return `${mm(o.wFt)} × ${mm(o.hFt)} mm`;
  return `${mm(o.diaFt)} mm ⌀`;
}

/** Clamp a hand-dragged dimension to something buildable. */
export const SIZE_LIMITS = { minFt: 0.5, maxFt: 12 };
export const clampFt = (v) =>
  Math.max(SIZE_LIMITS.minFt, Math.min(SIZE_LIMITS.maxFt, v));

// --- direct manipulation ----------------------------------------------------
//
// The gesture maths, kept here and kept PURE so it can be tested without a
// pointer. What "feels right" about dragging a handle is almost entirely
// arithmetic — which point stays still, what the modifier key does — and none
// of it is anything React should be deciding inline.
//
// THE ANCHOR IS THE OPPOSITE CORNER. That is the whole of why a resize feels
// direct rather than slippery: grab the bottom-right and the top-left does not
// move, so the object grows under your hand instead of sliding around beneath
// it. Resizing about the CENTRE — which is the easier thing to write, and what
// this did first — makes the object appear to run away from the pointer at half
// speed in the opposite direction. Alt is the modifier that asks for that
// behaviour deliberately.

const cosSin = (r) => ({ c: Math.cos(r || 0), s: Math.sin(r || 0) });

/** Local (object-frame) coordinates of a world point, about a centre. */
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

/**
 * A corner drag.
 *
 * `corner` is a sign pair — {sx: 1, sy: -1} is the top-right — and the corner
 * diagonally opposite it is what stays nailed down.
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
 * A rotate drag. FREE by default and snapped only while Shift is held, which
 * is the convention every editor shares — and the opposite of what this did
 * first, which quantised everything to 5 degrees and made fine adjustment
 * impossible for no benefit.
 *
 * The delta is measured from where the grab STARTED rather than from the
 * object's own axis, so the handle stays under the pointer instead of jumping
 * to it on the first move.
 */
export function rotateTo({ x, y }, pointerFt, { startRot = 0, startAngle = 0, snap = false } = {}) {
  const a = Math.atan2(pointerFt.y - y, pointerFt.x - x);
  let r = startRot + (a - startAngle);
  if (snap) r = Math.round(r / ROTATE_SNAP) * ROTATE_SNAP;
  // Normalised to (-PI, PI] so the readout never says 725 degrees.
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** The half-extents of an object's selection box, in feet. */
export function halfExtents(o) {
  if (isRect(o)) return { hw: (o.wFt || 0) / 2, hh: (o.hFt || 0) / 2 };
  const d = (o.diaFt || 0) / 2;
  return { hw: d, hh: d };
}

/** A round object has one dimension, so a corner drag is always uniform. */
export const isUniform = (o) => !isRect(o);

/** Apply a resize result back onto an object, respecting what it can be. */
export function applyResize(o, next) {
  if (isRect(o)) return { ...o, x: next.x, y: next.y, wFt: next.wFt, hFt: next.hFt };
  return { ...o, x: next.x, y: next.y, diaFt: clampFt(Math.max(next.wFt, next.hFt)) };
}
