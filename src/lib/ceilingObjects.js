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

import { SIZE_LIMITS, clampFt, toLocal, toWorld, resizeFromCorner,
         ROTATE_SNAP, rotateTo, boxAdapters, boxOrtho, boxMoves } from './box.js';

const MM = 1 / 304.8;

/* --- THE SWEEPS A CEILING FAN IS SOLD AT ----------------------------------
   ABOVE THE CATALOGUE BECAUSE THE CATALOGUE USES IT, and it is one list rather
   than two for the reason any duplicated table eventually gives: the day a
   fifth size is added, the half that was not edited is the half somebody
   notices six months later. The fan's entry names this array; the bar at the
   foot of the drawing draws it; nothing else has a list of sweeps.

   THESE ARE THE FOUR REAL ONES. A sweep is a blade span in millimetres and it
   is what the product is ordered by — 600 over a small utility or a box room,
   900 and 1050 the two ordinary bedroom sizes, 1200 for a living room. A
   number between them is not a quieter version of its neighbour, it is nothing
   anybody can buy, which is why this is chips and not a slider — the same
   argument ModuleSpec makes about a diffuser's three wattages.

   900 IS THE DEFAULT AND IT IS THE COMMONEST FITTING, not the largest. The
   value seeded here is what an unedited fan measures and what the bar has
   latched before anybody touches it, and defaulting to the biggest sweep in
   the list means every ordinary room's fan is a correction. */
export const FAN_SWEEPS = [600, 900, 1050, 1200];
export const FAN_SWEEP_MM = 900;

/**
 * The catalogue. `kind` is what it is; `id` is what the picker offers, which is
 * not the same thing — a fan is one kind, one entry and FOUR SIZES, because the
 * sweep is a property of the fan you placed rather than four things to place.
 * See `FAN_SWEEPS` above, and FanSpec, which is where that choice is made.
 */
export const CEILING_TYPES = [
  { id: 'fan',        kind: 'fan',        label: 'Fan',        colour: '#404040',
    diaFt: FAN_SWEEP_MM * MM, sweepsMm: FAN_SWEEPS },
  { id: 'chandelier', kind: 'chandelier', label: 'Chandelier', colour: '#404040',
    diaFt: 900 * MM },
  /* --- A PENDANT IS A CHANDELIER, AND THE `kind` SAYS SO ON PURPOSE --------
     IT IS A SECOND `id` ON THE FIRST `kind`, which is the split this table's
     header describes: `kind` is what a thing IS and `id` is what the picker
     offers. A pendant hangs off a ceiling, reserves clearance the grid keeps
     off, lights the table under it well enough to veto a task spot, lands on
     the DXF's `decorative` layer, glows on a night sheet and is counted as a
     lamp — every one of which this app already asks by testing `kind ===
     'chandelier'`, in nine separate files.
     SO A `kind: 'pendant'` WOULD BE NINE EDITS AND NINE CHANCES TO MISS ONE,
     and the symptom of missing one is silent: a fitting the grid lays a
     downlight straight through, or one absent from the schedule. The BOQ line
     was already written for this — `boq.js` calls it "Chandelier / pendant" —
     because the two are one item to anybody ordering them.
     WHAT IS ACTUALLY DIFFERENT IS THE SIZE, and that is the whole of it. 450mm
     against the chandelier's 900: half the diameter, so half the radius the
     layout keeps clear and a proportionally shorter reach when `chandelierOver`
     measures from its body to a worktop. */
  { id: 'pendant',    kind: 'chandelier', label: 'Pendant',    colour: '#404040',
    diaFt: 450 * MM },
  /* --- A STANDING LAMP, AND IT IS ON THE FLOOR ------------------------------
     THE THIRD DECORATIVE FITTING AND THE FIRST ONE THAT DOES NOT HANG. A
     chandelier and a pendant are the same `kind` because they differ only in
     size; a standard lamp differs in the one thing this table's geometry is
     about — where it is — so it is its own kind rather than a third diameter on
     the first one. It stands at 1500mm on the floor and hangs off nothing.

     `offCeiling`, FOR THE REASON THE SPLIT UNIT AND THE GEYSER CARRY IT: the
     grid does not move for a thing that is not on the ceiling. A downlight in
     the middle of a room is not obstructed by a lamp standing under it, and
     feeding one in as an obstacle would punch a hole in a layout for something
     that is not in its way. See the note over those two entries below.

     WHICH IS ALSO WHY IT NEEDS A SOCKET AND NOTHING ELSE HERE DOES. Every other
     fitting on this drawing is wired into a ceiling; a standard lamp is plugged
     in. See LAMP_SOCKET_FT in lib/electrical.js for the reach that decides
     whether it uses a plate already on the wall or gets one of its own.

     450mm IS THE SHADE, which is what a plan view of one shows and what the
     symbol is drawn to — see the standing-lamp branch in PlanCanvas. */
  { id: 'standing_lamp', kind: 'standing_lamp', label: 'Standing lamp',
    colour: '#404040', diaFt: 450 * MM, offCeiling: true },
  { id: 'ac',         kind: 'ac',         label: 'Cassette AC', colour: '#404040',
    wFt: 900 * MM, hFt: 900 * MM },
  /* --- AND TWO THINGS THAT ARE NOT ON THE CEILING AT ALL --------------------
     A SPLIT AC'S INDOOR UNIT AND A GEYSER ARE WALL-MOUNTED. They are in this
     catalogue because they are placed by the same gesture, drawn by the same
     code and ordered on the same schedule — and they are marked `offCeiling`
     because the one thing this file's geometry is FOR does not apply to them.

     `offCeiling` MEANS "THE GRID DOES NOT MOVE FOR THIS". Everything else here
     reserves clearance: a downlight cannot be under a fan, inside a cassette or
     over a hatch, so the planner is handed a circle and lays out around it. A
     split unit sits at 2100mm on a wall and a geyser above a toilet door, and a
     downlight in the middle of the ceiling is not obstructed by either. Feeding
     them in as obstacles would punch holes in a layout for objects that are not
     in its way — see `ceilingObstaclesPx` in
     features/scene/usePlanScene.js, which is the one place
     this flag is read.

     THEY ARE STILL DRAWN AND STILL SCHEDULED. What they are for is the
     ELECTRICAL drawing: a split AC and a geyser are each a dedicated circuit at
     a rating a lighting board does not carry, and putting them on the plan is
     how the person specifying the switchboards knows they are there. */
  { id: 'split_ac',   kind: 'split_ac',   label: 'Split AC',   colour: '#404040',
    wFt: 1000 * MM, hFt: 250 * MM, offCeiling: true },
  { id: 'geyser',     kind: 'geyser',     label: 'Geyser',     colour: '#404040',
    diaFt: 450 * MM, offCeiling: true },
  { id: 'trapdoor',   kind: 'trapdoor',   label: 'Trap door',  colour: '#404040',
    wFt: 600 * MM, hFt: 600 * MM },
];

/**
 * Round or rectangular, which is the only distinction any of the maths cares
 * about. A trap door and an AC cassette differ in what they are called, what
 * they are drawn as and what size they default to — and in nothing else.
 *
 * A SET AND NOT A CHAIN OF `||`. It was two comparisons and it is four kinds
 * now; a chain that has to be edited in step with the catalogue is a chain that
 * will one day be missing the newest entry, and the symptom of that is an
 * object drawn as a circle whose width and height are the only sizes it has.
 */
const RECT_KINDS = new Set(['ac', 'trapdoor', 'split_ac']);
export const isRect = (o) => RECT_KINDS.has(o?.kind);

/**
 * DOES THE CEILING GRID HAVE TO KEEP OFF THIS? Read off the catalogue rather
 * than off the object, so an object stored before the flag existed still
 * answers correctly, and so the answer lives in one table.
 */
export const OFF_CEILING = new Set(
  CEILING_TYPES.filter((t) => t.offCeiling).map((t) => t.kind));
export const offCeiling = (o) => OFF_CEILING.has(o?.kind);

export const CEILING_BY_ID = Object.fromEntries(CEILING_TYPES.map((t) => [t.id, t]));

/* A fan's sweep is the whole of the choice anyone makes about a fan. The list
   and the default are at the top of this file, above the catalogue that seeds
   itself from them. */
export const sweepMm = (o) => Math.round((o.diaFt || 0) / MM);
export const withSweep = (o, mm) => ({ ...o, diaFt: mm * MM });

/** A new object of a catalogue type, at a point in FEET. */
/**
 * A FRESH ID FOR A CEILING OBJECT, and it is its own export because there are
 * now two ways to bring one into existence: placing it from the palette, and
 * Option-dragging an existing one to leave a copy behind. A duplicate cannot
 * reuse `makeCeilingObject` — that builds a DEFAULT object of a type, and a copy
 * has to carry the size and rotation the original was edited to — but it must
 * mint its id exactly the same way, or the two routes drift and the day one of
 * them collides is the day two objects share a React key and a BOQ line.
 *
 * TIME PLUS A RANDOM TAIL. The timestamp alone is not enough: duplicating twice
 * inside one millisecond is a keyboard repeat away, and `Date.now()` has nothing
 * to say about it.
 */
export const newCeilingObjectId = () =>
  `co-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;

export function makeCeilingObject(typeId, atFt) {
  const t = CEILING_BY_ID[typeId] || CEILING_TYPES[0];
  return {
    id: newCeilingObjectId(),
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
    // CARRIED THROUGH, so a consumer holding only the pixel-space obstacle can
    // still tell whether the grid owes it anything. See the note by the two
    // wall-mounted entries in the catalogue.
    offCeiling: offCeiling(o),
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
/* --- THE ORIENTED BOX IS lib/box.js's NOW ---------------------------------
   WHAT MOVED AND WHY. Seven of the things that stood here were facts about a
   box with a centre, two extents and an angle, and about nothing on a ceiling:
   the anchor being the opposite corner, Shift locking the aspect, Alt resizing
   about the centre, rotation measured from the grab and snapped only while
   Shift is held. A fan, a chandelier, an air-conditioner, a door box and the
   centred kinds the geometry bar draws are all one primitive, so the primitive
   holds the arithmetic — see the header of lib/box.js.

   WHAT STAYED IS THE KIND-AWARE HALF, below. `isRect`, `isUniform`,
   `halfExtents`, `applyResize` and `radiusFt` all read this file's catalogue,
   and they answer differently for a fan and an air-conditioner.

   RE-EXPORTED UNDER THE NAMES THE CALL SITES ALREADY USE, for `penLengthFt`'s
   reason: renaming them at forty of them would be a change about nothing. */
/* AND THE MOVE ADAPTERS WITH THEM, which is the half that had been left behind.
   A CEILING OBJECT IS A BOX AND ITS POSITION IS ITS CENTRE, so `at`/`to`,
   "does this modifier apply" and "which frames of the gesture are a
   translation" are three facts about a box and not three about a chandelier —
   see `boxAdapters`, `boxOrtho` and `boxMoves` in box.js. They were spelled out
   inline in the object drag, character for character, which is the divergence
   this whole re-export exists to prevent: two copies of one rule, and the day
   `boxMoves` learns a fourth mode only one of them hears about it.
   THROUGH THIS FILE AND NOT IMPORTED DIRECTLY BY THE GESTURE, for the reason
   the seven above are re-exported: the callers ask ceilingObjects.js what a
   ceiling object does, and reaching past it to the primitive for three of its
   verbs and not the other seven would be an inconsistency with no argument
   behind it. */
export { SIZE_LIMITS, clampFt, toLocal, toWorld, resizeFromCorner,
         ROTATE_SNAP, rotateTo, boxAdapters, boxOrtho, boxMoves };

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
