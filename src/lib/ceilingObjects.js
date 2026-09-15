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
 * WHAT A DECORATIVE FITTING MAY BE SPECIFIED AT, in watts.
 *
 * PER TYPE, AND IN TWO DIFFERENT SHAPES, BECAUSE THEY ARE NOT ONE PRODUCT.
 *
 * A CHANDELIER IS A RANGE, for the reason `COB_WATT_RANGE` in lib/cob.js gives
 * at length and which applies here more strongly than it does there: it is a
 * fitting somebody CHOSE. Nobody orders a chandelier off a lighting schedule —
 * they buy the one they liked and tell you what it draws, which is why boq.js
 * counts these and does not bill them. It is several lamps in one body (the
 * heatmap models it as a ring of six elements — see `chandelier` in
 * features/heatmap/profiles.js) so its connected load is a multiple of a bare
 * lamp's and 55 W is an ordinary one. A chip list over that span would be this
 * app arguing with a product sheet it has never seen.
 *
 * A PENDANT AND A STANDARD LAMP ARE THREE BULBS, AND THAT IS THE WHOLE LIST.
 * Each is ONE lamp in ONE shade, and the lamp is bought as a lamp: 7, 9 or 12
 * watts. A slider from 3 to 24 over that was a control offering twenty-two
 * figures for a choice with three answers, and every one of the other nineteen
 * is a line nobody can order. `options` is what says so, and the panel draws
 * chips for it — see the three-way branch in SpaceAnalysis, which was already
 * written for exactly this distinction and had nothing routed into it.
 *
 * SO A TYPE CARRIES EITHER `options` OR `min`/`max`/`step`, NEVER BOTH, and
 * `wattRangeOf` / `wattOptionsOf` are the two readings of that. A type that
 * carried both would be two controls for one decision, and the panel would
 * silently pick whichever branch it tested first.
 *
 * THE FIGURES ARE CATALOGUE FIGURES AND ARE MEANT TO BE EDITED. They sit beside
 * the sizes for that reason: this table is where a decorative fitting's
 * specification lives, and the diameter and the load are two facts of the same
 * kind. Nothing derives them.
 *
 * WHOLE WATTS, like the COB's: a slider landing on 12.4 W is a control
 * pretending to a precision no product has.
 */
export const LAMP_WATTAGES = {
  /* SIX ARMS AT A BARE LAMP EACH, ROUGHLY, AND THAT IS THE TOP OF IT. */
  chandelier:    { min: 5, max: 55, step: 1, defaultWatts: 36 },
  /* ONE SHADE OVER A TABLE. The same `kind` as the chandelier and half its
     diameter — see the entry below — so it is half the fitting and nothing like
     the same load, and unlike the chandelier it is ONE bulb, which is what
     makes it a list of three rather than a span. */
  pendant:       { options: [7, 9, 12], defaultWatts: 9 },
  /* ONE BULB, PLUGGED IN. The same three, and its default is the figure every
     decorative fitting used to share — so the one type whose old wattage was
     never wrong keeps it. */
  standing_lamp: { options: [7, 9, 12], defaultWatts: 7 },
};

/**
 * WHAT THIS ONE FITTING DRAWS, and what it may be set to.
 *
 * KEYED BY `typeId` AND NOT BY `kind`, which is the whole reason a pendant can
 * differ from a chandelier at all: they are one `kind` on purpose (see the entry
 * below for the nine files that rely on it) and two entries in the picker, and
 * the load is one of the two things that actually differ between them.
 *
 * THE STORED FIGURE WINS AND IS ABSENT UNTIL SOMEBODY SETS ONE. A plan saved
 * before these existed holds no `watts` on any object, and reads its type's
 * default — which is what keeps an old plan's schedule correct rather than
 * zeroed. Same rule the shape's `role` follows: what is default does not ride
 * along in the file.
 */
/* FALLING BACK TO THE `kind`, WHICH IS NOT BELT AND BRACES. `typeId` has been
   written by `makeCeilingObject` since it existed, but a duplicate is built by
   spreading an original and a plan can be loaded from a file this build did not
   write — and an object that answered "not a lamp" would drop out of the
   schedule, out of the heatmap and out of the fixture list at once, silently.
   A `kind: 'chandelier'` with no type is a chandelier: the larger of the two is
   the safe reading, because it is the one that leaves the fitting visible. */
export const lampWattsOf = (o) => LAMP_WATTAGES[o?.typeId]
  ?? (o?.kind === 'chandelier' ? LAMP_WATTAGES.chandelier
    : o?.kind === 'standing_lamp' ? LAMP_WATTAGES.standing_lamp : null);

/**
 * THE TWO READINGS OF THAT ENTRY, AND A TYPE ANSWERS EXACTLY ONE OF THEM.
 *
 * `wattRangeOf` IS NULL FOR A FITTING SOLD AT THREE FIGURES, which is the whole
 * mechanism: the panel tests `wattRange` first and draws a slider for it, so a
 * pendant that still answered a range would keep the slider whatever else it
 * offered. See the three-way branch in SpaceAnalysis. Null is not an absence
 * here — it is the fitting saying "not a continuous choice".
 */
export const wattRangeOf = (o) => {
  const spec = lampWattsOf(o);
  return spec && !spec.options ? spec : null;
};
/** ...and the list, where the fitting is sold as a list. */
export const wattOptionsOf = (o) => lampWattsOf(o)?.options ?? null;

/**
 * WHAT THIS ONE FITTING IS SPECIFIED AT — the stored figure, held to what the
 * type can actually be.
 *
 * A STORED FIGURE OFF THE LIST IS SNAPPED TO THE NEAREST ONE ON IT, and that is
 * not defensive coding: a pendant saved while the slider existed holds any
 * whole number from 3 to 24, and a 14 W pendant reopened here would light three
 * chips none of which was latched — a control that cannot show its own state.
 * Snapping reports the nearest thing anybody can buy and is what the schedule
 * would have to bill anyway. NOTHING IS REWRITTEN ON THE DOCUMENT: the stored
 * 14 stays until somebody presses a chip, exactly as an out-of-range slider
 * value was clamped on read and not on disk.
 */
export const wattsOf = (o) => {
  const spec = lampWattsOf(o);
  if (!spec) return null;
  const w = Number(o?.watts);
  if (!Number.isFinite(w)) return spec.defaultWatts;
  if (spec.options) {
    return spec.options.reduce(
      (best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), spec.options[0]);
  }
  return Math.min(spec.max, Math.max(spec.min, w));
};

/** Is this object a light at all? The three the lighting schedule counts. */
export const isLamp = (o) => !!lampWattsOf(o);

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
  /* AND THIS ONE IS SEATED ON THE PLASTER RATHER THAN DROPPED ON THE PLAN.
     `onWall` IS NOT A SECOND `offCeiling`. That one says the GRID owes it
     nothing; this says the WALL decides where it is and which way it faces —
     see lib/wallUnit.js, which holds the whole of it. They happen to be true of
     the same entry today and they are not the same statement: a geyser is off
     the ceiling and is still dropped wherever somebody points.
     A CASSETTE IS NEITHER, and that is the line between the two air
     conditioners. It is a grille IN the ceiling, it is the one of the pair the
     downlight grid has to keep clear of, and seating it on a wall would take it
     out of the ceiling it is in. */
  { id: 'split_ac',   kind: 'split_ac',   label: 'Split AC',   colour: '#404040',
    wFt: 1000 * MM, hFt: 250 * MM, offCeiling: true, onWall: true },
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

/** Does the catalogue say this type is held by a wall? @see lib/wallUnit.js */
export const typeOnWall = (typeId) => !!CEILING_BY_ID[typeId]?.onWall;

/**
 * IS THIS RECORD SEATED ON A WALL? — a fact about the RECORD's shape, which is
 * why it lives beside the function that mints one rather than in wallUnit.js.
 *
 * `sFt` AND NOT A FLAG. A seated record has a distance round its room's walls
 * and NULL for `x`, `y` and `rot`; an unseated one has a coordinate and no
 * distance. The two are mutually exclusive by construction, so the presence of
 * the seat IS the answer and a boolean beside it would be a second answer
 * waiting to disagree — the same argument `isConstrained` makes about a point's
 * host. It is also what makes a plan saved before any of this existed keep
 * working: those units have coordinates, so they are not seated, so nothing
 * treats them as if they were.
 *
 * RE-EXPORTED BY lib/wallUnit.js under the same name, so a caller reasoning
 * about wall units asks that file for all of its verbs.
 */
export const isSeatedOnWall = (o) => Number.isFinite(o?.sFt);

/**
 * ...AND ONE THAT HANGS ON A WALL, WHICH IS A DIFFERENT RECORD AND NOT A FLAG.
 *
 * `x`, `y` AND `rot` ARE WRITTEN NULL, AND THAT IS THE WHOLE DISCIPLINE. What
 * this record has is `sFt` — how far round its room's walls it sits — and the
 * three derived fields are resolved from that every frame. A stale coordinate
 * beside a live seat is a lie that survives a save, and the first reader to
 * trust the wrong one draws a metre of air-conditioner where nobody put one.
 * It is the rule `pointOn` states for a constrained point, said about a box.
 *
 * `rot: null` IS LOAD-BEARING TOO, and it is the half that answers the
 * complaint this was built for. There is no stored angle to rotate, so there is
 * no rotation grip and nothing to correct after a placement: the unit faces
 * into the room because the wall behind it does. @see seatWallUnit
 *
 * THE FEED COMES IN RATHER THAN DEFAULTING HERE. Which of the two supplies an
 * air-conditioner gets is wallUnit.js's decision (see AC_FEED), and this file
 * is the catalogue — it would have to import the electrical domain to know the
 * answer, which is a dependency the layout should not carry to place a box.
 */
export function makeWallUnit(typeId, { roomId, sFt, feed }) {
  const t = CEILING_BY_ID[typeId] || CEILING_TYPES[0];
  return {
    id: newCeilingObjectId(),
    typeId: t.id,
    kind: t.kind,
    roomId, sFt,                   // FEET, round this room's walls
    x: null, y: null, rot: null,   // DERIVED — see the note above
    diaFt: t.diaFt ?? null,
    wFt: t.wFt ?? null,
    hFt: t.hFt ?? null,
    feed,
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
/* `at` IS THE RESOLVED POSITION, FOR THE KINDS THAT DO NOT STORE ONE.
   A WALL UNIT HAS NO `x`, NO `y` AND NO `rot` IN THE STORE — it has a distance
   round its room's walls, and where that is depends on the walls, which are not
   this file's to know. So the caller resolves it (see `resolveWallUnitPx`) and
   hands the answer in; everything else about turning an object into an obstacle
   is the same for a unit on a wall as for a fan on a ceiling.
   PASSED IN RATHER THAN IMPORTED, deliberately. This file is the catalogue and
   it is imported by the planner; reaching from here into the electrical domain
   for a room's wall runs would drag that whole module into the layout's
   dependency graph to answer a question the layout never asks. */
export function toObstaclePx(o, pxPerFt, at = null) {
  const s = pxPerFt || 1;
  return {
    ...o,
    x: at ? at.x : o.x * s, y: at ? at.y : o.y * s,
    r: radiusFt(o) * s,
    w: (o.wFt || 0) * s,
    h: (o.hFt || 0) * s,
    rot: at ? at.rot : (o.rot || 0),
    /* WHETHER IT IS HELD BY A WALL, carried through so a reader holding only
       the pixel-space obstacle can tell — it is what decides whether the canvas
       draws a rotation grip, and whether a drag slides or floats. */
    onWall: !!at?.seat,
    seat: at?.seat ?? null,
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
  /* A SEATED BOX KEEPS ITS SEAT AND TAKES ONLY THE SIZE. `next` carries a
     centre the corner drag worked out in free space, and writing it would leave
     a wall unit holding a coordinate beside its `sFt` — two positions and no
     rule for which wins, which is the exact lie `makeWallUnit` writes three
     nulls to prevent. Resizing one is still a real thing to do: a 1400mm indoor
     unit is a 1400mm indoor unit, and where it sits is the wall's business
     either way. @see isSeatedOnWall */
    const at = isSeatedOnWall(o) ? {} : { x: next.x, y: next.y };
  if (isRect(o)) return { ...o, ...at, wFt: next.wFt, hFt: next.hFt };
  return { ...o, ...at, diaFt: clampFt(Math.max(next.wFt, next.hFt)) };
}
