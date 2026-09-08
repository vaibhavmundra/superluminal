// ---------------------------------------------------------------------------
// magTrack.js — A MAGNETIC TRACK, AND THE MODULES SOMEBODY CLIPS INTO IT.
//
// --- WHY THIS IS NOT track.js ----------------------------------------------
//
// track.js IS AN ARGUMENT THE ENGINE WINS. Its whole subject is ABSORPTION: a
// chunk is flipped to Track, the ordinary grid is laid out unchanged, a run is
// scored onto the row of fittings that gathers the most of them, and the ones it
// reaches stop being recessed downlights and become heads on the profile. Every
// figure in that file — three feet of reach, the dodge, the module joint — is
// about moving a fitting the engine had already placed.
//
// THIS FILE IS THE OPPOSITE ACT. Nothing is absorbed and nothing is scored. A
// person draws a line, says "that is a track", and then clips modules onto it
// one at a time. There is no grid to preserve, no row to keep step with, and no
// refusal: the profile goes where the geometry goes and the module goes where
// the click lands on it. It is the same relationship `manualCobs` has to the
// ambient grid — see the header of cob.js, which makes this argument at length.
//
// BOTH EXIST AND NEITHER IS A VERSION OF THE OTHER. One answers "this ceiling is
// a track ceiling, lay it out"; the other answers "there is a track HERE, with
// these modules on it". A single implementation would have to decide which of
// those a track is, and it is both.
//
// --- WHERE THE GEOMETRY LIVES, AND WHY IT IS NOT HERE ----------------------
//
// A MAGNETIC TRACK IS A CEILING SHAPE WITH `role: 'track'`. It is not a list of
// points in a store of its own, and that is the single most load-bearing
// decision in this feature. What it buys, all of it for free:
//
//   * EVERY PRIMITIVE DRAWS ONE. A line, a rectangle, a circle, an n-gon, a pen
//     path — the six the shape bar already offers.
//   * A GEOMETRY ALREADY ON THE DRAWING BECOMES ONE. Press a guide with the
//     track tool armed and the guide's outline is handed to the tool as its
//     draft. That branch is not written for tracks; it is the shape tool's.
//   * IT RESIZES BY ITS GRIPS AND DUPLICATES BY ITS OWN BUTTON. Double-click,
//     drag a corner, press duplicate — the contextual bar a committed shape
//     gets, unchanged.
//   * IT SNAPS, IT DRAGS, IT DELETES, IT SAVES.
//
// So this file holds no path arithmetic at all beyond reading one: the outline
// is `outlineFt(shape)`, and the offset a track is set out at is applied ONCE,
// when the shape is made (see `insetShape`), rather than resolved on every
// render. A track that has been committed is an ordinary shape at the position
// it was set out to, which is what makes it editable afterwards.
//
// WHAT LIVES HERE is the module catalogue, where a module sits on a run, and
// what a run of them is worth in lumens.
// ---------------------------------------------------------------------------

import { pathLength, pointAt, arcLengthAt, legs } from './geometry.js';
/* NO WATTAGE LIST IS IMPORTED HERE, AND THAT IS THE POINT — see the note on
   `watts` in `chooseDiffusers`. What a diffuser is sold at is a fact about a
   BRAND's catalogue, not about how many of them a room wants, and this file has
   no business holding a copy of it.
   `FAMILY_BY_ID` IS IMPORTED FOR ONE THING: a module's DEFAULT wattage, which is
   its family's — so the figure a hand-placed diffuser opens at is the same one
   the panel calls the default rather than a third copy of 18. */
import { FAMILY_BY_ID } from './lumens.js';

/**
 * THE MODULES, AND THERE ARE THREE.
 *
 * ONE ENTRY PER PRODUCT, AND EACH NAMES ITS OWN DISTRIBUTION rather than
 * carrying a copy of it. `family` is an id in FIXTURE_FAMILIES (lumens.js) and
 * `fixture` is a line in FIXTURES (boq.js) — so what a module DOES to a room and
 * what it costs are answered by the two files that already answer those
 * questions for every other fitting in the app. A module with its own split and
 * its own price here would be a third opinion about a product.
 *
 * --- THE DIFFUSER IS THE INTERESTING ONE -----------------------------------
 *
 * IT IS AN AMBIENT SOURCE AND NOT AN ACCENT ONE, which is why it maps to
 * `panel`. A track diffuser is a lens over a linear board: the light leaves a
 * surface that IS the ceiling, so none of it goes back up, and it spreads —
 * 70% at the walls, 30% at the floor. That distribution has been sitting in
 * lumens.js since it was written, with a note saying no tool placed one yet.
 * This is that tool.
 *
 * IT IS ALSO WHY A RUN OF THEM CHANGES A ROOM'S VERDICT. A spot puts 80% of its
 * output on the floor in a cone; a diffuser of the same wattage lights the whole
 * room. Four 18 W diffusers on a run is 72 W of genuinely ambient light, and the
 * Analysis panel will say so — which is the entire point of offering it beside
 * the spot rather than as another kind of spot.
 *
 * --- AND THE SPOT IS THE ONE THAT ALREADY EXISTED --------------------------
 *
 * `track-spot` is the catalogue line a directional fitting absorbed into a track
 * is bought as (see boq.js), and a hand-clipped one is the same product. It
 * takes `cob`'s distribution because that is what a recessed lamp and a track
 * spot have in common: a cone pointing down. Same argument the three COB layers
 * make about being one family — see `fixtureGroups` in
 * features/lighting-planner/lightingRules.js.
 *
 * --- THE WALL WASHER IS DECLARED AND NOT BUILT -----------------------------
 *
 * `soon: true`, and it is in the list rather than absent for CobMenu's reason:
 * a drawer that grew a third item later would be a menu somebody had already
 * learned the shape of. It is out of reach rather than missing, which is the
 * honest picture of a module this build does not answer for. It has no `family`
 * and no `fixture` on purpose — inventing its distribution before the product is
 * specified is how a number nobody chose ends up in a report.
 */
export const TRACK_MODULES = [
  /* THE ARTWORK IS A PICTURE OF THE MODULE ON ITS RAIL, THROWING. It is the
     rail's own idiom — see PaletteButton: a cell whose subject is an OBJECT gets
     a photograph, and these are objects. What tells the three apart at 64px is
     the THROW rather than the body: a diffuser washes the whole width under it,
     a spot drops a cone, a washer throws sideways at a wall. Three renders of
     one extrusion, differing in the one thing that matters. */
  { id: 'diffuser', label: 'Diffuser', icon: '/icons/track_ambient.png',
    title: 'Track diffuser — a linear ambient module',
    /* ITS OWN FAMILY AND NOT `panel`'s. The two share a distribution and nothing
       else — see the note on `track_diffuser` in lumens.js — and sharing the
       family meant sharing the panel's 9-to-36 W chips, which is a control
       offering wattages this product is not sold at. */
    family: 'track_diffuser', fixture: 'track-diffuser',
    /* LENGTH IN INCHES, LIKE TRACK_DIMS_IN, and for its reason: a module has to
       sit on the carrier it clips into, so its length is geometry and its width
       is drawing. A diffuser is the long one — 600 mm is the ordinary module —
       and it is what decides how many will fit on a run. */
    /* NO FIXED LENGTH EITHER — SEE `DIFFUSER_LENGTHS_MM`. A diffuser's body
       grows with its wattage, because the LEDs and the heatsink have to go
       somewhere: 200 mm up to 15 W, 400 to 25, 600 above. It was a flat 24 in
       for everything, which drew a 5 W corner module as a two-foot bar — the
       right size for the biggest thing in the range and three times the right
       size for the smallest. `lenIn` is absent rather than zero so that anything
       reading it directly fails loudly instead of drawing a sliver; ask
       `moduleLenIn`. */
    wideIn: 1.5,
    /* NO WATTAGE HERE. It is the family's `defaultWatts` — see `moduleWatts` —
       because 18 W was already written down twice (in `PANEL_WATTS`' default and
       in the catalogue line) and a third copy is a third thing to forget when a
       brand's range changes. The ALLOCATOR does not use this figure at all: it
       solves for a wattage against the room. This is only what a diffuser placed
       BY HAND opens at. */
    beam: null },
  { id: 'spot', label: 'Spot', icon: '/icons/track_spot.png',
    title: 'Track spot — an aimed directional module',
    /* ITS OWN FAMILY AND NOT `cob`'s, for the diffuser's reason: the two share a
       cone on the floor and nothing else, and sharing the family meant sharing
       the recessed downlight's range. Today the two ranges hold the same five
       figures; a loaded catalogue is where they part. See `track_spot` in
       lumens.js. */
    family: 'track_spot', fixture: 'track-spot',
    lenIn: 6, wideIn: 1.5,
    /* NO WATTAGE HERE ANY MORE. It stated 5 W to override the `cob` family's
       7 W default — and now that a track spot has a family of its own, 5 W IS
       that family's default. One figure, in the table that holds every other
       family's. `moduleWatts` reads it.
       THE BEAM STAYS, because a family carries no optic: `split` is where the
       light goes and a beam angle is which reflector is in the fitting. 30
       degrees is what boq.js's `track-spot` line specifies. */
    beam: 30 },
  { id: 'washer', label: 'Washer', icon: '/icons/track_wall_washer.png',
    title: 'Track wall washer — not in this build yet',
    soon: true, family: null, fixture: null,
    lenIn: 8, wideIn: 1.5, watts: null, beam: null },
];

export const MODULE_BY_ID = Object.fromEntries(TRACK_MODULES.map((m) => [m.id, m]));

/** The ids nothing can be placed for yet — what the drawer greys out. */
export const MODULE_SOON = TRACK_MODULES.filter((m) => m.soon).map((m) => m.id);

/**
 * WHAT A MODULE OPENS AT, in watts — and it is the family's figure wherever the
 * module has not stated its own.
 *
 * THE DIFFUSER STATES NOTHING AND TAKES `panel`'s DEFAULT, so the wattage a
 * hand-placed one arrives at is the same figure the Analysis panel calls the
 * default. The SPOT states 5 W and keeps it, because that is a different product
 * from the 7 W ambient downlight its family defaults to — see the note on it.
 *
 * IT IS A DEFAULT AND NOT A LIST. The allocator never reads this: it solves for
 * a wattage against the room, out of the catalogue it is handed. This is what
 * one module placed by a click starts life at, and what the row then shows.
 *
 * 7 W WHERE NOTHING IS KNOWN, which is this app's ordinary downlight and the
 * figure `clampWatts` in cob.js falls back to for the same reason: a fitting of
 * no wattage is not something a schedule can carry.
 */
export const moduleWatts = (kind) => {
  const m = MODULE_BY_ID[kind];
  if (m?.watts != null) return m.watts;
  return FAMILY_BY_ID[m?.family]?.defaultWatts ?? 7;
};

/**
 * HOW LONG A DIFFUSER IS, BY WATTAGE — in millimetres, and this table is the one
 * store of it.
 *
 * A BODY GROWS WITH ITS OUTPUT because the diodes and the heatsink have to go
 * somewhere. A 5 W module is a 200 mm stub; the same product at 36 W is a 600 mm
 * bar. Drawing them the same length — which this file did, at a flat 24 in for
 * everything — made a run of 5 W corner modules read as four two-foot slabs on a
 * seven-foot rail, which is what the drawing complained about.
 *
 * BANDS AND NOT A FORMULA. A range is manufactured in a few lengths and a
 * wattage falls into one of them; interpolating would produce a 317 mm module
 * nobody sells.
 *
 * KEYED ON THE WATTAGE EACH LENGTH STARTS AT, and the lookup is the LAST band at
 * or below the figure. Stated this way round because the boundaries then need no
 * epsilon and read as whole numbers: under 15 W is 200 mm, 15 through 25 is
 * 400 mm, 26 and up is 600 mm — which is exactly "less than 15, 15 to 25, above
 * 25" with no ambiguity about which side 15 and 25 fall on. An upper-bound table
 * has to decide whether its bound is inclusive and then say so twice.
 *
 * ASCENDING, and the first entry starts at 0 so the table is total: any positive
 * wattage lands in a band, and one off the top gets the longest body rather than
 * no answer.
 *
 * WHOLE WATTS, which is what a module is ever specified in — the panel's chips
 * are integers, a catalogue's range is integers, and `setTrackModuleSpec` rounds
 * what it is given. So the boundary above 25 is written as 26 and there is no
 * epsilon anywhere in the table.
 *
 * IT SORTS THIS OUT FOR THE FUTURE, which is the point of putting it here rather
 * than beside the drawing code. Everything that needs a body length asks
 * `moduleLenIn`: the canvas draws from it, the overlap test clears by it, and the
 * allocator spaces its slots on it. A brand whose 400 mm module runs to 30 W is
 * one edit to this array and nothing else.
 */
export const DIFFUSER_LENGTHS_MM = [
  { fromW: 0, mm: 200 },
  { fromW: 15, mm: 400 },
  { fromW: 26, mm: 600 },
];

/** Millimetres to inches, which is what TRACK_DIMS_IN and the canvas speak. */
const MM_PER_IN = 25.4;

/**
 * A MODULE'S LENGTH IN INCHES — the one answer, for every consumer.
 *
 * `watts` IS ONLY CONSULTED WHERE THE PRODUCT'S LENGTH DEPENDS ON IT, which
 * today is the diffuser and nothing else. A spot is a 6 in body at any wattage
 * the range sells and states `lenIn` outright; the wall washer likewise. So a
 * module that names its own length keeps it, and one that does not is looked up
 * in its band table.
 *
 * THE WATTAGE FALLS BACK TO THE MODULE'S DEFAULT when the caller has none — a
 * ghost under the pointer, a length asked for before anything is placed. That is
 * the same figure a hand-placed one arrives at, so the preview and the fitting
 * are the same size.
 */
export function moduleLenIn(kind, watts = null) {
  const m = MODULE_BY_ID[kind];
  if (m?.lenIn != null) return m.lenIn;
  if (!m) return 6;
  const w = Number(watts ?? moduleWatts(kind)) || 0;
  // THE LAST BAND AT OR BELOW THE WATTAGE. `reduce` rather than a reversed
  // `find` so the table is read in the order it is written.
  const band = DIFFUSER_LENGTHS_MM.reduce(
    (best, b) => (w >= b.fromW ? b : best), DIFFUSER_LENGTHS_MM[0]);
  return band.mm / MM_PER_IN;
}

/** The same, in feet, which is what the geometry below works in. */
export const moduleLenFt = (kind, watts = null) => (moduleLenIn(kind, watts) / 12);

/**
 * WHERE A MODULE SITS ON ITS RUN, and it is stored as a FRACTION of the path.
 *
 * `u` IN 0..1 RATHER THAN A DISTANCE IN FEET, and the trade is worth stating
 * because both readings are defensible and only one of them survives an edit.
 *
 * A DISTANCE IS WHAT THE PRODUCT IS. On site the profile is cut to length and a
 * module clips 3 ft from the corner, and it stays 3 ft from the corner whatever
 * else happens. That is the physical truth.
 *
 * A FRACTION IS WHAT THE DRAWING IS FOR. This track came out of the geometry
 * library: it is resized by its grips and duplicated onto a room of another
 * size, and both are ordinary things to do to it. Stored in feet, shrinking a
 * 12 ft run to 8 ft drops every module past the eighth foot off the end of it —
 * silently, because a module with nowhere to sit simply is not drawn. Stored as
 * a fraction the run keeps its arrangement and redistributes, which is the
 * answer somebody dragging a grip is asking for.
 *
 * SO THE FRACTION IS THE RECORD AND THE FEET ARE THE READOUT. The schedule bills
 * the modules it can see and the profile by its length; nothing downstream reads
 * `u` except this file.
 */
export const clampU = (u) => Math.min(1, Math.max(0, Number(u) || 0));

/** The fraction of the path nearest a point — what a click on a run resolves
 *  to. `arcLengthAt` does the projection; this is only the division. */
export function uAt(pts, p, { closed = false } = {}) {
  const total = pathLength(pts, { closed });
  if (!(total > 0)) return 0;
  return clampU(arcLengthAt(pts, p, { closed }) / total);
}

/**
 * A MODULE RESOLVED ONTO ITS RUN: where it is, and which way it lies.
 *
 * `ux`/`uy` IS THE DIRECTION THE PATH IS HEADING THERE, and it is not
 * decoration. A module is a body lying ALONG the profile — 600 x 38 mm for a
 * diffuser — so without it every module on a vertical run is drawn across the
 * run it is clipped into, which is a fitting that could not be installed.
 * track.js records the same fact as `trackAxis` and says the same thing about
 * it; this one carries the vector rather than an axis name because a drawn
 * track is not rectilinear and 'h' or 'v' cannot describe a diagonal.
 *
 * `null` where there is no path to sit on, which the caller reads as "not on
 * the drawing" rather than as a module at the origin.
 */
export function moduleAt(pts, u, { closed = false } = {}) {
  const total = pathLength(pts, { closed });
  if (!(total > 0)) return null;
  const q = pointAt(pts, clampU(u) * total, { closed });
  return q ? { x: q.x, y: q.y, ux: q.ux, uy: q.uy } : null;
}

/**
 * HOW MANY MODULES OF THIS KIND A RUN WILL TAKE.
 *
 * ONE PER MODULE LENGTH, WHICH IS A CAP AND NOT A LAYOUT. Nothing here places
 * modules — a person does, one click at a time — so this exists for the one
 * question the bar has to answer honestly: is there room for another. Two
 * diffusers cannot occupy the same foot of profile, and a run that has taken as
 * many as it physically holds should say so rather than accept a click that
 * stacks one on another.
 *
 * NO JOINT ALLOWANCE. track.js adds half an inch between two bodies because it
 * is deciding whether a fitting the engine placed can be absorbed without
 * overlapping one already there — a question about millimetres. This is a
 * ceiling of room on a run, and a figure of that precision would be a claim
 * about a product nobody has picked yet.
 */
export const moduleCapacity = (lengthFt, kind, watts = null) => (
  Math.max(0, Math.floor((Number(lengthFt) || 0)
    / Math.max(0.05, moduleLenFt(kind, watts)))));

/**
 * THE ARC DISTANCE BETWEEN TWO POSITIONS ON A RUN, in feet.
 *
 * WRAPPING ON A CLOSED PATH, which is the only reason this is a function. Two
 * modules either side of the join on a closed rectangle are inches apart on
 * site and 0.98 apart in `u`; subtracting the fractions would call that the
 * whole length of the run and let them overlap.
 */
const gapFt2 = (a, b, totalFt, closed) => {
  const d = Math.abs(a - b) * totalFt;
  return closed ? Math.min(d, totalFt - d) : d;
};

/**
 * WHERE A MODULE CAN ACTUALLY GO, GIVEN WHAT IS ALREADY ON THE RUN.
 *
 * TWO BODIES CANNOT OCCUPY THE SAME INCH OF PROFILE. That is not a rule this
 * app is imposing on a designer — it is a fact about an extrusion — which is
 * what makes it different from every other clamp cob.js argues against. A
 * hand-placed COB may go two feet from a wall because a wall washer is a real
 * detail; two diffusers in the same 600 mm is not a detail, it is a drawing that
 * cannot be built.
 *
 * SO THE CLICK IS NUDGED RATHER THAN REFUSED, and that is the half that matters.
 * A press that silently does nothing reads as a broken tool — the whole
 * argument in ShapeMenu's `canCommit` note — and a press that stacks a module on
 * another reads as working until somebody counts. Scanning outward from where
 * the click landed lands the module at the nearest place it fits, which is what
 * somebody clicking into a gap between two modules meant anyway.
 *
 * OUTWARD IN BOTH DIRECTIONS, IN HALF-MODULE STEPS. Half a module is fine enough
 * that the nudge is never more than it has to be and coarse enough that a full
 * run is found to be full in a few dozen tries rather than a few thousand.
 *
 * THE BODY STAYS ON AN OPEN RUN. Its ends are cut, so a module centred at the
 * very end would hang half off the profile; the scan is clamped to half a module
 * in from each. A closed run has no ends and is not clamped.
 *
 * `null` WHEN THE RUN IS FULL, which the caller reads as "no room" — a press
 * that places nothing because there is genuinely nowhere left is the one case
 * where nothing happening is the right answer, and the count on the bar is what
 * says why.
 */
export function placeableU(pts, want, taken = [], kind = 'spot',
                           { closed = false, watts = null } = {}) {
  const total = pathLength(pts, { closed });
  if (!(total > 0)) return null;
  /* THE BODY BEING PLACED AND EVERY BODY ALREADY THERE ARE MEASURED AT THEIR OWN
     WATTAGE. A diffuser's length is a band of its output — see
     `DIFFUSER_LENGTHS_MM` — so a 5 W stub needs a third of the clearance a 36 W
     bar does, and `taken` carries each module's own figure. Sizing everything at
     one length (which this did) refused a 5 W module a gap it fits in and let a
     36 W one overlap a gap it does not. */
  const halfMine = moduleLenFt(kind, watts) / 2;
  const lo = closed ? 0 : Math.min(0.5, halfMine / total);
  const hi = closed ? 1 : Math.max(0.5, 1 - halfMine / total);
  /* ALREADY IN RANGE GOES THROUGH UNTOUCHED, and that is not a micro-
     optimisation. `((u % 1) + 1) % 1` on 0.1 gives 0.10000000000000009: a click
     that lands on a clear stretch of profile would have its module placed a
     hair away from where it was aimed, for no reason at all. The modulo is only
     needed for a scan step that has run past an end. */
  const wrap = (u) => {
    if (!closed) return Math.min(hi, Math.max(lo, u));
    return u >= 0 && u < 1 ? u : ((u % 1) + 1) % 1;
  };
  const clear = (u) => !taken.some((t) => gapFt2(u, t.u, total, closed)
    < halfMine + moduleLenFt(t.kind, t.watts) / 2 - 1e-9);
  const step = halfMine / total;
  const start = wrap(clampU(want));
  if (clear(start)) return start;
  for (let k = 1; k * step <= 1; k++) {
    for (const u of [wrap(start + k * step), wrap(start - k * step)]) {
      if (clear(u)) return u;
    }
  }
  return null;
}

/** A fresh id for a module clipped onto a run. One minter, for `newCobId`'s
 *  reason: an id is what every store and every selection is keyed by. */
export const newModuleId = (seq = 0) =>
  `mtm-${Date.now().toString(36)}-${seq}`;

// --- THE DIFFUSER ALLOCATOR -------------------------------------------------
//
// WHAT IT IS FOR. Every other module on a track is put there by hand, one click
// at a time, and that is right for a fitting somebody is AIMING — a spot goes
// over the console because that is where the console is. A diffuser is not aimed
// at anything. It is ambient light, and the only question worth asking about how
// many a run carries is the one the Analysis panel already asks about the room:
// is this space bright enough yet.
//
// --- THE RULE IS CORNERS FIRST, AND IT IS NOT A TIE-BREAK -------------------
//
// A RUN OF PROFILE ROUND A RECTANGLE IS LIT AT ITS CORNERS OR IT IS NOT LIT.
// That is the design fact this file kept failing to encode. Two earlier versions
// both got it wrong from opposite ends:
//
//   THE FIRST held the wattage at 18 W and rounded the COUNT up to the
//   rectangle's corner quantum. A 95 sqft bedroom short of about 730 lm got four
//   18 W diffusers — 3,834 lm, two and a half times what it asked for.
//
//   THE SECOND solved count and wattage together for the least overshoot, which
//   fixed the over-lighting and threw the corners away: the same room got ONE
//   24 W module in the middle of one leg, on a four-cornered ring. Arithmetically
//   perfect and not a lighting design.
//
// SO THE CORNERS ARE SPENT FIRST AND THE BALANCE IS SPENT AFTER. Given a
// requirement in WATTS — the shortfall divided by what a watt is worth in this
// room — a closed run with V corners takes:
//
//   V MODULES, ONE PER CORNER, at the largest wattage in the catalogue that does
//   not overshoot when multiplied by V. 27 W wanted over four corners is 6.75 W
//   each, and the largest thing sold at or under that is 5 W, so it is 5 W.
//
//   THEN THE BALANCE, one module at a time, at the smallest wattage that
//   finishes it, each landing at the centre of a leg that has not been used yet.
//   20 W of corners against 27 W wanted leaves 7 W, and the smallest module that
//   covers 7 is 10 W, in the middle of the longest rail. Four fives and a ten.
//
// AND THE CORNERS ARE NEVER SKIPPED TO SAVE A WATT. 17 W over four corners is
// 4.25 W each and nothing is sold below 5 — so it is four 5 W modules, 20 W, and
// not the single 18 W module that fits the number better. A ring lit at one point
// is a ring nobody would draw, and three watts is not worth it. This is stated
// because it is the case the arithmetic will keep trying to "improve".
//
// AN OPEN RUN HAS TWO CORNERS AND THEY ARE ITS ENDS. Same rule, V = 2: a length
// of profile with a dark foot at each end reads as unfinished, and the ends are
// where a person looking at the drawing expects to see a module. The balance then
// fills inward.

/**
 * HOW FAR APART TWO DIFFUSERS MAY BE, in feet.
 *
 * SEVEN, AND IT IS A CAP ON SPACING RATHER THAN A COUNT. A 600 mm diffuser at
 * nine feet lights a pool of floor narrower than seven feet at full strength;
 * what makes seven the figure is that the falloff from two of them overlaps at
 * about that distance, which is the argument the ambient grid's own spacing
 * rests on. Wider and the floor between them reads as a gap.
 *
 * IT SETS THE CEILING ON THE COUNT AND NEVER THE FLOOR — except at the corners,
 * which are spent before any of this is asked. It used to RAISE a count of two
 * on a twenty-four foot run to five, and the room had asked for two diffusers'
 * worth of light. A run longer than the light it needs has gaps in it.
 */
export const DIFFUSER_GAP_FT = 7;

/**
 * THE PLACES ON A RUN A DIFFUSER GOES, IN THE ORDER THEY ARE SPENT.
 *
 * CORNERS, THEN LEG CENTRES, THEN THE GAPS BETWEEN. One ordered list rather than
 * three rules, so "corners first" is a property of the data and not something
 * the caller has to remember — see `planDiffusers`, which walks it.
 *
 *   `corner`  ONE PER TURN OF A CLOSED RUN, or one per END of an open one. A
 *             body cannot straddle a corner — it is a rigid 600 mm extrusion —
 *             so the position is half a body INTO the leg that follows it. That
 *             is as near the corner as a module can physically be, and centring
 *             one on the corner itself (which an earlier version did, borrowing
 *             the spot array's rule) leaves half of it hanging off the rail.
 *   `centre`  THE MIDDLE OF EACH LEG, longest leg first, which is where the
 *             balance goes. Longest first because that is the leg with the
 *             largest dark stretch between its two corners.
 *   `fill`    THE QUARTER POINTS, for a run that wants more than a corner and a
 *             centre per leg. Ordered by leg length again.
 *
 * EVERY SLOT CARRIES ITS `leg`, so a caller can tell which rail a module is on
 * without projecting it back onto the path.
 */
export function diffuserSlots(pts, { closed = false, gapFt = DIFFUSER_GAP_FT,
                                     bodyFt = null } = {}) {
  const ls = legs(pts, { closed });
  const total = ls.reduce((a, l) => a + l.len, 0);
  if (!(total > 0)) return [];
  /* THE BODY THE LADDER IS SPACED ON, AND THE CALLER SAYS HOW LONG IT IS.
     A diffuser's length depends on its wattage and the wattage is not known
     until the plan is made — see `planDiffusers`, which decides the corner
     wattage from the LEG COUNT (which needs no ladder) and then builds the
     ladder at that body's length. Left to itself this defaults to the module's
     own default wattage, which is the right answer for anybody asking "where
     could modules go on this run" without a plan in hand. */
  const body = bodyFt ?? moduleLenFt('diffuser');
  const starts = [];
  let run = 0;
  for (const l of ls) { starts.push(run); run += l.len; }
  const at = (i, ft) => (starts[i] + ft) / total;

  /* --- THE CANDIDATE LADDER, IN PRIORITY ORDER --------------------------
     CORNERS, THEN LEG CENTRES, THEN QUARTERS, THEN EIGHTHS. Built as candidates
     and filtered below rather than emitted directly, because the ladder's own
     rungs collide: on a 7.3 ft leg the corner sits a foot in and the quarter
     point at 1.8 ft, which is ten inches apart for a two-foot body. */
  const cand = [];
  if (closed) {
    for (let i = 0; i < ls.length; i++) {
      if (ls[i].len >= body) cand.push({ u: at(i, body / 2), kind: 'corner', leg: i });
    }
  } else {
    /* AN OPEN RUN'S TWO CORNERS ARE ITS ENDS. A length of profile with a dark
       foot at each end reads as unfinished, and those are the two places a
       person looking at the drawing expects a module. */
    const last = ls.length - 1;
    if (ls[0].len >= body) cand.push({ u: at(0, body / 2), kind: 'corner', leg: 0 });
    if (ls[last].len >= body) {
      cand.push({ u: at(last, ls[last].len - body / 2), kind: 'corner', leg: last });
    }
  }
  // LONGEST LEG FIRST for everything after the corners: that is the leg with the
  // largest dark stretch between two of them, so it is the one worth filling.
  const order = ls.map((l, i) => i).sort((p, q) => ls[q].len - ls[p].len);
  /* A LEG SHORTER THAN THE SPACING FIGURE GETS NO CENTRE, which is the job
     `gapFt` does now that the COUNT comes from the wattage. Seven feet is about
     what a diffuser covers before the floor between two of them reads as a gap —
     so a 4 ft rail between two lit corners does not want a third module in the
     middle of it, and a 7.3 ft one does. */
  for (const i of order) {
    if (ls[i].len >= Math.max(body * 2, gapFt)) {
      cand.push({ u: at(i, ls[i].len / 2), kind: 'centre', leg: i });
    }
  }
  for (const frac of [0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
    for (const i of order) {
      if (ls[i].len >= body * 3) {
        cand.push({ u: at(i, ls[i].len * frac), kind: 'fill', leg: i });
      }
    }
  }

  /* --- AND THE FILTER, WHICH IS WHAT MAKES "CORNERS FIRST" STRUCTURAL -------
     GREEDY, IN PRIORITY ORDER, DROPPING ANYTHING A BODY CANNOT CLEAR. Because
     the corners come first in the candidate list they are never the rung that
     gets dropped — a centre or a quarter yields to them and not the other way
     round. That is this file's whole doctrine expressed as an ordering rather
     than as a special case somewhere downstream.
     WRAPPING ON A CLOSED RUN: two slots either side of the join are inches apart
     on site and 0.98 apart in `u`. See `gapFt2`. */
  const keep = [];
  for (const c of cand) {
    const u = clampU(c.u);
    if (keep.some((k) => gapFt2(u, k.u, total, closed) < body - 1e-9)) continue;
    keep.push({ ...c, u });
  }
  return keep;
}

/**
 * HOW MANY DIFFUSERS THIS RUN WOULD SENSIBLY CARRY.
 *
 * IT IS THE NUMBER OF SLOTS, AND NOTHING ELSE. It used to be its own arithmetic
 * — a per-leg minimum of the physical limit and the spacing limit — and the two
 * answers drifted: the slot list said eight and the cap said four, so the four
 * corners consumed the whole allowance and the BALANCE never got placed. A 27 W
 * requirement on a rectangle came out as four 5 W modules and no 10 W centre,
 * which is the one worked example this feature was specified against.
 *
 * ONE SOURCE, THEREFORE. `diffuserSlots` already refuses a slot a body cannot
 * clear and already withholds a centre from a leg too short to want one, so the
 * capacity is a property of that list rather than a second opinion about it.
 */
export function diffuserCapacity(pts, opt = {}) {
  return diffuserSlots(pts, opt).length;
}

/**
 * THE WHOLE ALLOCATION: which module goes where, and at what wattage.
 *
 * ONE FUNCTION RETURNING `[{ u, watts, kind }]`, and it replaced a pair that
 * chose a count and then placed it. The pair could not express the answer this
 * rule produces — four 5 W modules at the corners AND a 10 W in the middle of a
 * rail is two wattages on one run — and a planner that has to return one figure
 * for the lot is a planner that cannot put the corners first.
 *
 * `needW` IS IN WATTS AND NOT LUMENS, which is what makes the corner arithmetic
 * readable: "27 W over four corners is 6.75 W each" is the sentence the rule is
 * written in. The caller divides the room's shortfall by what a watt is worth
 * there — see `netPerUnit` in lumens.js, which is the panel's own arithmetic, so
 * nothing here re-derives a lumen.
 *
 * `watts` IS THE CATALOGUE AND HAS NO DEFAULT. What a diffuser is sold at is a
 * fact about a brand — 5, 10 and 18 today, see TRACK_DIFFUSER_WATTS — and this
 * function's subject is "how many, at which of the sizes it comes in". The sizes
 * are an input. A caller that forgets them gets nothing placed, which is loud;
 * a built-in default would have let a loaded catalogue move the panel's chips
 * while the allocator went on solving against the old figures.
 *
 * NOTHING IS ASSUMED ABOUT THE LIST beyond positive numbers — not its length,
 * its spacing, nor that any figure this project knows is in it.
 */
export function planDiffusers(pts, { closed = false, needW = 0, watts,
                                     gapFt = DIFFUSER_GAP_FT } = {}) {
  const want = Math.max(0, Number(needW) || 0);
  const list = (Array.isArray(watts) ? watts.filter((w) => Number(w) > 0) : [])
    .map(Number).sort((p, q) => p - q);
  if (!(want > 0) || !list.length) return [];
  const ls = legs(pts, { closed });
  const total = ls.reduce((acc, l) => acc + l.len, 0);
  if (!(total > 0)) return [];

  /* --- THE CORNER WATTAGE IS DECIDED FIRST, AND IT HAS TO BE ----------------
     A DIFFUSER'S LENGTH IS A BAND OF ITS WATTAGE, so the ladder cannot be spaced
     until the wattage is known — and the wattage cannot be chosen from the
     ladder without circularity. It does not need to be: the CORNER COUNT is a
     property of the legs, and every corner carries the same figure.

     HOW MANY CORNERS THERE ARE, measured against the SMALLEST body in the
     catalogue. A leg that can host the shortest module can host a corner, and
     asking at the longest would strike a short leg's corner off for a size it is
     never going to be given. */
  const shortest = moduleLenFt('diffuser', list[0]);
  const cornerLegs = closed
    ? ls.filter((l) => l.len >= shortest).length
    : (ls.length && ls[0].len >= shortest ? 1 : 0)
      + (ls.length && ls[ls.length - 1].len >= shortest ? 1 : 0);
  if (!cornerLegs) return [];

  /* THE LARGEST THAT DOES NOT OVERSHOOT ACROSS ALL THE CORNERS, and the SMALLEST
     in the catalogue when even that overshoots. The second half is the "17 W is
     still four 5 W modules" rule: the corners are not skipped to land on a
     number, because a ring lit at one point is not a design. */
  const share = want / cornerLegs;
  const perCorner = [...list].reverse().find((w) => w <= share + 1e-9) ?? list[0];

  /* AND NOW THE LADDER, SPACED ON THE BODY THE CORNERS WILL ACTUALLY BE. */
  const slots = diffuserSlots(pts, { closed, gapFt,
                                     bodyFt: moduleLenFt('diffuser', perCorner) });
  if (!slots.length) return [];

  const out = [];
  /* EVERY ACCEPTED MODULE IS CLEARED AGAINST WHAT IS ALREADY DOWN, at both
     bodies' real lengths. The ladder's own filter used one length for everything,
     which is right while the corners are being spent — they are all the same
     figure — and wrong the moment a 600 mm balance module lands next to a 200 mm
     corner. So the ladder proposes and this disposes. */
  const fits = (u, w) => !out.some((m) => gapFt2(u, m.u, total, closed)
    < moduleLenFt('diffuser', w) / 2 + moduleLenFt('diffuser', m.watts) / 2 - 1e-9);

  for (const sl of slots) {
    if (sl.kind !== 'corner') continue;
    if (fits(sl.u, perCorner)) out.push({ u: sl.u, watts: perCorner, kind: 'corner' });
  }

  /* THEN THE BALANCE, ONE MODULE AT A TIME, at the smallest wattage that
     finishes it — or the largest when the balance is more than one module can
     carry, in which case the loop goes round again. Each lands at the next
     unspent slot, which is a leg CENTRE before it is a quarter point: see
     `diffuserSlots`.
     A SLOT THE BODY DOES NOT FIT IS SKIPPED AND NOT DROPPED FROM THE PLAN. A
     600 mm module that will not clear its neighbours moves to the next rung
     down the ladder rather than the run coming out short. */
  let left = want - out.reduce((acc, m) => acc + m.watts, 0);
  for (const sl of slots) {
    if (left <= 1e-9) break;
    if (sl.kind === 'corner') continue;
    const w = list.find((q) => q >= left - 1e-9) ?? list[list.length - 1];
    if (!fits(sl.u, w)) continue;
    out.push({ u: sl.u, watts: w, kind: sl.kind });
    left -= w;
  }
  return out.sort((p, q) => p.u - q.u);
}

/**
 * A MODULE, AS IT IS STORED.
 *
 * THE TRACK AND THE FRACTION ARE THE WHOLE RECORD, plus the specification it was
 * placed at. Nothing about WHERE it is on the drawing is kept, for the reason an
 * array keeps no lamp positions — see `cobArrays` in App.jsx: the geometry is
 * the record and a stored point is a memo that goes stale the moment somebody
 * drags a grip.
 *
 * IT CARRIES ITS OWN WATTAGE AND OPTIC rather than looking them up, which is
 * what makes them survive the catalogue being retuned under a finished plan —
 * the same rule `placeCob` follows. The default comes from the module.
 */
export function placeModule({ trackId, kind, u, watts = null, beam = null,
                              gridCells = null, seq = 0 }) {
  const m = MODULE_BY_ID[kind] ?? MODULE_BY_ID.spot;
  return {
    id: newModuleId(seq),
    trackId, kind: m.id, u: clampU(u),
    watts: watts ?? moduleWatts(m.id), beam: beam ?? m.beam,
    ...(gridCells?.length ? { gridCells: [...gridCells] } : {}),
  };
}
