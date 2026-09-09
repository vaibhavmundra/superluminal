// ---------------------------------------------------------------------------
// lumens.js — IS THIS SPACE BRIGHT ENOUGH, AND WHAT IS MAKING IT SO.
//
// THE WHOLE FILE IS EDITABLE CONSTANTS AND THE ARITHMETIC THAT READS THEM. Every
// number a lighting designer would argue about is a named export at the top of
// this file, in one place, with the reason it has the value it has. Nothing
// downstream hard-codes a reflectance, a target or a lumens-per-watt.
//
// THE MODEL, IN FOUR STEPS.
//
//   1. WHAT THE ROOM IS. Floor, ceiling and walls, each with a reflectance that
//      comes from the tone somebody chose in the Materials section. The walls
//      are a WEIGHTED AVERAGE by length, because one dark return in a white room
//      is not a third of that room. See `reflectanceOf`.
//
//   2. HOW MUCH SURFACE THERE IS. Floor + ceiling + the walls, and the walls are
//      the perimeter times the space's own ceiling height. This is TOT_SF, and
//      it is the reason the height field exists: a 2700 room and a 3600 room of
//      the same footprint are not the same room to light.
//
//   3. WHAT IS OWED.  LU_REQ x TOT_SF x (1 - AVG_REF).
//      The `(1 - AVG_REF)` is the part worth stating plainly: a dark room needs
//      MORE light than a white one of the same size, because its surfaces give
//      less of it back. A white room at 0.77 average asks for less than a
//      quarter of what its area alone would suggest; a dark one asks for most of
//      it.
//
//   4. WHAT IS DELIVERED. Every fitting on the ceiling belongs to a FAMILY, and
//      a family is defined by where its light goes — a cove throws 80% at the
//      slab, a reverse cove 80% at the walls, a COB 80% at the floor. What the
//      room gets back is the output times how much each of those three surfaces
//      returns:
//
//        net = output x (to_ceiling x ref_ceiling
//                      + to_walls   x ref_wall
//                      + to_floor   x ref_floor)
//
//      So the same 900 lumens is worth more in a white room than a dark one, and
//      a cove is worth more under a white slab than under a dark one. That is
//      the whole point of asking about the finishes first.
//
// WHAT THIS IS NOT. It is not a photometric calculation: there is no point
// grid, no inverse square, no luminaire IES file and no interreflection
// solution. It is the lumen method's shape, run on the numbers a designer can
// actually give you at sketch stage, and it is honest about being that.
// ---------------------------------------------------------------------------

import { toneOf } from './materials.js';
import { COUNTRIES, DEFAULT_COUNTRY } from './switchboards.js';
/* THE CONE A DOWNLIGHT CUTS ON THE FLOOR — one function, imported rather than
   re-derived. It is `2 x drop x tan(beam / 2)` and it lives in cob.js because
   that is where a beam angle is a thing somebody CHOOSES; this file needs the
   same number to turn one lamp's output into an illuminance, and two copies of
   a formula are two chances for the figure in this panel to disagree with the
   pool drawn under the fitting on the sheet. No cycle: cob.js knows nothing
   about this file. */
import { throwDiameterFt, DEFAULT_DROP_FT } from './cob.js';

const SQFT_PER_SQM = 10.7639104;
const M_PER_FT = 0.3048;
const MM_PER_FT = 304.8;

// --- 1. WHAT EACH SURFACE GIVES BACK ---------------------------------------

/**
 * REFLECTANCE BY SURFACE AND TONE.
 *
 * PER SURFACE AND NOT ONE TABLE FOR ALL THREE, because a floor is not a wall. A
 * light floor is a pale timber or a light stone and reads about 0.5; a light
 * WALL is emulsion and reads 0.9. There is no such thing as a 0.9 floor in a
 * room people walk in, which is why "light" and "medium" are the same figure
 * there — the tone chip still records what was chosen, and the arithmetic
 * simply does not distinguish them.
 */
export const SURFACE_REFLECTANCE = {
  ceiling: { light: 0.8, medium: 0.5, dark: 0.2 },
  floor: { light: 0.5, medium: 0.5, dark: 0.2 },
  wall: { light: 0.8, medium: 0.5, dark: 0.2 },
};

// --- 2. WHAT A SPACE IS OWED ------------------------------------------------

/**
 * AMBIENT LUMENS PER SQUARE FOOT OF TOTAL SURFACE, by project.
 *
 * KEYED BY THE PROJECT IDS THIS APP ACTUALLY HAS — see PROJECT_TYPES in
 * roomTypes.js — plus `retail`, which is not one of them yet and is here because
 * the figure was specified and a table that silently dropped it would lose it.
 *
 * `hotel` and `restaurant` are the hospitality pair and take the residential
 * figure; `office` is the commercial one. `educational` has had no review of its
 * own and takes the commercial figure rather than a number nobody has looked at.
 *
 * NOT THE SAME THING AS `LUMEN_CRITERIA` IN settings.js, and the two must not be
 * confused. That one is lumens per square foot of FLOOR, delivered by the grid,
 * and it is what the old whole-plan readout in the footer judges against. This
 * one is per square foot of TOTAL SURFACE and is multiplied by (1 - AVG_REF).
 * Different denominators, different question.
 */
export const LUMENS_PER_SQFT = {
  residential: 10,
  hotel: 10,
  restaurant: 10,
  office: 20,
  educational: 20,
  retail: 30,
};

/** For a project nobody has given a figure. The gentlest of the three, because
 *  over-lighting a space nobody specified is the error that gets built. */
export const LUMENS_PER_SQFT_DEFAULT = 10;

// --- 3. WHAT A WATT IS WORTH ------------------------------------------------

/**
 * LUMENS PER WATT, BY COUNTRY CODE — see COUNTRIES in switchboards.js for where
 * the codes come from.
 *
 * 75 in India and 100 elsewhere, and the gap is real rather than a hedge: the
 * mid-market Indian LED fitting is a 75 lm/W part, and specifying a project on
 * the 100 lm/W figure a European catalogue quotes is how a room comes out a
 * third short of what the drawing promised.
 *
 * A PROJECT-LEVEL OVERRIDE BELONGS HERE WHEN IT ARRIVES. Everything that reads
 * this goes through `lumensPerWattFor`, so one more argument on that function is
 * the whole of adding one.
 */
export const LUMENS_PER_WATT = { IN: 75 };
export const LUMENS_PER_WATT_DEFAULT = 100;

/**
 * WHAT A METRE OF TAPE MAKES PER WATT, AND IT IS 100 EVERYWHERE.
 *
 * THE COUNTRY FIGURE ABOVE IS ABOUT FITTINGS AND NOT ABOUT REELS, which is the
 * distinction this constant exists to make. A downlight is a housing, a driver,
 * a lens and a heatsink assembled by whoever is selling it, and the mid-market
 * Indian one really is a 75 lm/W part where the European one is 100. Tape is
 * not: it is a commodity reel of the same handful of LED packages, bought from
 * the same few makers, and 100 lm/W is what it does on any site in the world.
 * Specifying an Indian project's coves at 75 would under-read every one of them
 * by a quarter for no reason that exists in the product.
 *
 * IT IS A PER-FAMILY OVERRIDE AND NOT A SECOND GLOBAL, so a family that says
 * nothing still follows the country — see `unitOutput`. That is what keeps the
 * two facts separate: where the building is, and what the thing is made of.
 *
 * SEPARATE FROM `STRIP_LOSS`, AND BOTH APPLY. This is what leaves the reel; that
 * is what the driver, the run and the pocket eat on the way out. 100 lm/W less a
 * fifth is 80 delivered, and stating it as one number would hide which half a
 * better product or a shorter run would change.
 */
export const STRIP_LUMENS_PER_WATT = 100;

// --- 4. THE FITTINGS --------------------------------------------------------

/** The tape, by the metre. What a cove, a reverse cove and a run on the ceiling
 *  are all made of, which is why the three families share one list. */
export const STRIP_WATTS_PER_M = [5, 6.6, 9, 11];

/**
 * WHAT A RUN OF TAPE LOSES ON THE WAY OUT OF THE DETAIL — 20%, and it applies to
 * every family made of strip.
 *
 * A strip is not a finished luminaire: it is a metre rate on a reel, driven from
 * one end of a run and then buried in a pocket. The catalogue figure is the
 * LED's, and what reaches the plaster is less than it by a margin that sits
 * consistently around a fifth — driver efficiency, voltage drop down a long run,
 * and the diffuser or the lip of the cove itself. A COB's quoted output is
 * already what leaves the aperture; specifying a strip as though it were the
 * same kind of number is how a cove comes out visibly dimmer than the drawing
 * said.
 *
 * IT COMES OFF A FIXED `lumens` FIGURE TOO, and that is a choice rather than an
 * oversight: `loss` is a property of the INSTALLATION — the driver, the length
 * of the run, the pocket — and not of the reel. The day a real product is
 * specified here at its measured INSTALLED output, the honest thing is to set
 * `loss: 0` on that family rather than to leave the deduction applying twice.
 *
 * PER FAMILY AND NOT GLOBAL, which is what makes it editable in the useful
 * direction: a family with no `loss` loses nothing, so a fitting that needs a
 * different figure — or none — is one field on its own row.
 *
 * --- IT WAS 0.1, AGAINST EVERY WORD OF THE NOTE ABOVE ----------------------
 * THE VALUE AND ITS OWN SPECIFICATION DISAGREED FROM THE DAY BOTH WERE WRITTEN
 * — they arrived in the same commit. The prose says 20%, says "a fifth", and
 * works the figure through as "100 lm/W less a fifth is 80 delivered"; the
 * constant said 0.1. There was no comment anywhere arguing for 10%, and the
 * derivation above is specific about where the fifth goes: driver efficiency,
 * voltage drop down a long run, and the diffuser or the lip of the cove.
 * SO THE SPECIFICATION WINS, which is this file's standing rule — see the head
 * of the test file, which says the table IS the specification.
 * EVERY LENGTH OF TAPE ON EVERY PLAN NOW READS 11% LOWER than it did, and that
 * is the point rather than a side effect: a cove was being credited with light
 * the pocket eats. Nothing else in the model moves — no COB, panel, lamp or
 * sconce carries a `loss` at all.
 */
export const STRIP_LOSS = 0.2;

/** A recessed COB, per piece. */
export const COB_WATTS = [3, 5, 7, 9, 12];

/**
 * A PANEL OR DIFFUSER LIGHT, PER PIECE — the recessed flat panel.
 *
 * BACK TO THE FIVE IT WAS SPECIFIED WITH. It briefly carried 5, 6 and 7 W as
 * well, on the way to fixing the track diffuser's range — and those figures
 * belong to the TRACK DIFFUSER, which now has a family and a list of its own
 * (see TRACK_DIFFUSER_WATTS). A 600x600 recessed panel is not sold at 5 W;
 * leaving them here would have been this file guessing at the range of a product
 * no tool in the app places.
 *
 * STILL THE ONE STORE FOR ITS OWN FAMILY, and it still reaches the Analysis
 * panel's chips through `FIXTURE_FAMILIES` — see the note on
 * TRACK_DIFFUSER_WATTS, which sets out the whole arrangement and applies to
 * this list identically.
 */
export const PANEL_WATTS = [9, 12, 18, 24, 36];

/**
 * A TRACK DIFFUSER, PER PIECE — AND IT IS ITS OWN LIST BECAUSE IT IS ITS OWN
 * PRODUCT.
 *
 * IT SHARED `panel`'s AND THAT WAS WRONG ABOUT THE THING THAT MATTERS. The two
 * throw light identically — the `split` below is copied from it deliberately,
 * because in both the light leaves a face that is already the ceiling and
 * spreads — and that is the only thing they have in common. A recessed panel is
 * a 600x600 tile fixed into a grid ceiling; a track diffuser is a 600 mm
 * extrusion that clips into a busbar. They are two lines in a catalogue, two
 * lines in a schedule, and two ranges: the panel is sold from 9 to 36 W and the
 * diffuser range this project specifies is 5, 10 and 18.
 *
 * SO A SHARED DISTRIBUTION IS NOT A SHARED FAMILY. A family in this file is
 * defined by where its light goes AND by what it is — see the header of
 * FIXTURE_FAMILIES — and `borrowed` is the field that says "these numbers are
 * somebody else's", which is exactly the honest description of the split here.
 *
 * --- THREE FIGURES, AND THE ALLOCATOR IS BUILT ON THE LIST AND NOT ON THEM ---
 *
 * 5, 10 AND 18 IS WHAT THIS PROJECT SELLS TODAY. Nothing downstream assumes
 * three entries, or these three: `chooseDiffusers` in magTrack.js is handed this
 * array and searches whatever is in it — see its note on `watts`, which has no
 * default for precisely this reason. The day a brand's catalogue is loaded, THIS
 * is the array that gets replaced, and both consumers follow it:
 *
 *   THE PANEL'S CHIPS. `analyseSpace` copies it onto the row as `wattOptions`.
 *   THE ALLOCATOR. Corner wattages and balance wattages are both chosen out of
 *   it, largest-that-fits and smallest-that-finishes respectively.
 *
 * ASCENDING, because both of those searches read it in order.
 */
export const TRACK_DIFFUSER_WATTS = [5, 10, 18];

/**
 * A TRACK SPOT, PER PIECE — AND IT IS THE COB'S FIGURES IN ITS OWN ARRAY.
 *
 * THE SAME FIVE WATTAGES AND A SEPARATE LIST, which looks like duplication and
 * is the opposite. A recessed COB and a track spot are two products: one is cut
 * into plasterboard, one clips into a busbar, and boq.js already bills them as
 * two lines. That they are currently sold at the same five figures is a fact
 * about THIS project's catalogue and not a relationship between the products —
 * so the day a manufacturer's range is loaded and its track heads run 6, 12 and
 * 20 W against its downlights' 3 to 12, this array changes and `COB_WATTS` does
 * not.
 *
 * WRITTEN OUT RATHER THAN `= COB_WATTS`. An alias would make the two arrays the
 * same object, and then a catalogue loader replacing one would silently replace
 * the other — which is precisely the divergence this exists to allow. Copied on
 * purpose, with this note as the reason.
 *
 * THE BEAM ANGLES ARE SHARED AND ARE NOT HERE. An optic is a reflector, the
 * eight in `BEAM_ANGLES` (lib/cob.js) are what the trade sells, and a track head
 * takes the same ones. The panel offers that list to any row carrying a `beam`;
 * see SpaceAnalysis.
 */
export const TRACK_SPOT_WATTS = [3, 5, 7, 9, 12];

/** A floor or table lamp, per piece — and what a chandelier is counted as. */
export const LAMP_WATTS = [5, 7, 9, 12];

/** A wall sconce, and there is one figure rather than a list: a sconce is a
 *  decorative fitting specified at 7 W, not a wattage anybody picks per room.
 *  A single-entry list is still a list, so nothing downstream special-cases it —
 *  the panel simply prints the figure instead of offering a choice. */
export const SCONCE_WATTS = [7];

/**
 * A FAMILY IS DEFINED BY WHERE ITS LIGHT GOES, and by nothing else.
 *
 * `split` is the three fractions, and they are expected to sum to 1 — a family
 * that sums to less is claiming light that goes nowhere, which is a statement
 * about a fitting rather than about a room and does not belong here.
 *
 *   unit    'm' for anything sold by the metre, 'nos' for anything sold by the
 *           piece. It decides both the arithmetic and the row's wording.
 *   watts   the options offered in the panel, and `defaultWatts` the one a room
 *           starts on.
 *   lumens  a FIXED output that overrides watts x lm/W, per piece or per metre.
 *           Null everywhere today — set one here and that family stops caring
 *           what the lumens-per-watt figure is, which is what you want the day
 *           a real product is specified.
 *   loss    the fraction that never leaves the detail, absent meaning none. Only
 *           the strip families carry one — see STRIP_LOSS.
 *   lumensPerWatt
 *           what this family's watts are worth, where that is a fact about the
 *           PRODUCT rather than about the country. Absent means "ask the
 *           country" — see STRIP_LUMENS_PER_WATT and `lumensPerWattFor`.
 *
 *   layer   WHICH OF THE THREE JOBS A FITTING IS DOING — 'ambient', 'task' or
 *           'accent'. It is NOT the same question as `split`, and the two must
 *           not be collapsed: `split` is where the light physically goes, which
 *           is a fact about the product, and this is what it is FOR, which is a
 *           fact about the design. A recessed COB in a grid and a recessed COB
 *           aimed at a worktop are the same product throwing light the same way
 *           and they are two different layers of a lighting scheme — which is
 *           why a GROUP may override this, and the spots do. See `analyseSpace`.
 *
 *           THE COVES ARE AMBIENT, both of them, and that is stated rather than
 *           derived. A reverse cove washes a wall, which is a mark against
 *           calling it ambient, and it is ambient anyway: it is one of the two
 *           things in this app that can carry a room's general level on its own,
 *           and a lighting designer reading this panel is asking "what is
 *           lighting the room" before "what is lighting the pictures".
 *
 * THE SIX THE BRIEF NAMES ARE ALL HERE, INCLUDING ONE NOTHING PLACES YET.
 * `panel` has no tool behind it, so no row can currently be built from it — it
 * is in the table because the table is the specification, and a family added the
 * day its tool arrives is a family whose numbers were invented in a hurry.
 * `lamp` has no tool either but is not idle: a chandelier is routed to it, being
 * the one decorative fitting this app places and the only one of the six splits
 * that describes something throwing in every direction.
 */
export const FIXTURE_FAMILIES = [
  {
    id: 'cove', label: 'Cove', unit: 'm', layer: 'ambient',
    split: { ceiling: 0.8, walls: 0.2, floor: 0.0 },
    watts: STRIP_WATTS_PER_M, defaultWatts: 5, lumens: null, loss: STRIP_LOSS,
    lumensPerWatt: STRIP_LUMENS_PER_WATT,
  },
  {
    id: 'reverse_cove', label: 'Reverse cove', unit: 'm', layer: 'ambient',
    split: { ceiling: 0.0, walls: 0.8, floor: 0.2 },
    watts: STRIP_WATTS_PER_M, defaultWatts: 5, lumens: null, loss: STRIP_LOSS,
    lumensPerWatt: STRIP_LUMENS_PER_WATT,
  },
  {
    /* DIFFUSERS, PANEL LIGHTS AND A STRIP ON THE CEILING ARE ONE DISTRIBUTION
       AND TWO UNITS, which is why they are two entries sharing a `split`. What
       they have in common is that the light leaves a surface that is already the
       ceiling, so none of it goes back up. */
    id: 'ceiling_strip', label: 'Ceiling LED strip', unit: 'm', layer: 'ambient',
    split: { ceiling: 0.0, walls: 0.7, floor: 0.3 },
    watts: STRIP_WATTS_PER_M, defaultWatts: 5, lumens: null, loss: STRIP_LOSS,
    lumensPerWatt: STRIP_LUMENS_PER_WATT,
  },
  {
    id: 'panel', label: 'Diffuser / panel', unit: 'nos', layer: 'ambient',
    split: { ceiling: 0.0, walls: 0.7, floor: 0.3 },
    watts: PANEL_WATTS, defaultWatts: 18, lumens: null,
  },
  {
    /* --- THE TRACK DIFFUSER, AND IT IS NOT THE PANEL ---------------------
       ONE DISTRIBUTION, TWO PRODUCTS. The split is the panel's, character for
       character, because both are a lens over a board fixed flat to the ceiling:
       nothing goes up, most of it reaches the walls, the rest the floor. That is
       what `borrowed` says — these figures are somebody else's and are meant to
       stay in step with them.
       EVERYTHING ELSE IS DIFFERENT. A different extrusion, a different way of
       fixing, a different schedule line (`track-diffuser` in boq.js), and a
       different RANGE — see TRACK_DIFFUSER_WATTS. Filing it under `panel`
       offered a track run the panel's 9-to-36 W chips, which is a control
       showing wattages this product is not sold at.
       AND IT IS THE FAMILY WITH A TOOL BEHIND IT. `panel` still has none — the
       note at the head of this table says so — and this one is what the
       magnetic track's drawer places. See lib/magTrack.js. */
    id: 'track_diffuser', label: 'Track diffuser', unit: 'nos',
    borrowed: 'panel', layer: 'ambient',
    split: { ceiling: 0.0, walls: 0.7, floor: 0.3 },
    watts: TRACK_DIFFUSER_WATTS, defaultWatts: 10, lumens: null,
  },
  {
    /* --- TASK, AND IT USED TO SAY AMBIENT -----------------------------------
       THIS IS THE ONE THAT WAS WRONG, and it was wrong in the way that matters
       most: it is the fitting a plan is mostly made of, so its layer decided
       almost the whole of the ambient figure. A room with a twelve-lamp grid and
       a single cove reported about 4,500 lm of "ambient" of which the cove was
       1,000 — which is not a reading anybody can act on, and it was the reason a
       room lit entirely by downlights never showed as short of ambient light.
       THE SPLIT ABOVE IS THE ARGUMENT. 80% of a recessed COB's output goes at
       the FLOOR and none of it at the ceiling: it puts a cone on the work
       surface, which is the definition of task light. What washes a room is what
       throws at the ceiling and the walls — the coves, the strips, the panels,
       the sconces and the pendants — and every one of those is filed as ambient.
       WHICH MAKES THE TWO FIGURES MEAN SOMETHING. A low ambient figure beside a
       met total now says a room is reaching its number on downlights and has
       nothing lifting the surfaces, which is a real fault a designer fixes with
       a cove. Before this it could only show on a room with no lamps in it at
       all. */
    id: 'cob', label: 'Recessed COB', unit: 'nos', layer: 'task',
    split: { ceiling: 0.0, walls: 0.2, floor: 0.8 },
    watts: COB_WATTS, defaultWatts: 7, lumens: null,
  },
  {
    /* --- THE TRACK SPOT, AND IT IS NOT THE COB -----------------------------
       ONE DISTRIBUTION, TWO PRODUCTS — the same argument the track diffuser
       makes against `panel`, one row up. A recessed downlight and a track head
       both put a cone on the floor, so the split is the COB's character for
       character and `borrowed` says whose it is. Everything else differs: a
       different body, a different way of fixing, its own schedule line
       (`track-spot` in boq.js), and its own range.
       THE RANGE IS THE SAME FIVE FIGURES TODAY and is a separate array anyway —
       see TRACK_SPOT_WATTS for why that is not duplication.
       TASK, NOT AMBIENT. A track spot is aimed: it goes over the console, the
       worktop, the picture. The COB above is the ambient grid's own lamp and is
       filed as ambient; the same product aimed at a surface is the task layer,
       which is the distinction `layer` exists to draw. See the note on it in the
       header of this table. */
    id: 'track_spot', label: 'Track spot', unit: 'nos',
    borrowed: 'cob', layer: 'task',
    split: { ceiling: 0.0, walls: 0.2, floor: 0.8 },
    watts: TRACK_SPOT_WATTS, defaultWatts: 5, lumens: null,
  },
  {
    id: 'lamp', label: 'Floor / table lamp', unit: 'nos', layer: 'accent',
    split: { ceiling: 0.25, walls: 0.5, floor: 0.25 },
    watts: LAMP_WATTS, defaultWatts: 9, lumens: null,
  },
  {
    /* --- THE TWO THE BRIEF DID NOT NAME AT FIRST, AND THEY SAY SO -----------
       A sconce and a shelf strip are both things this app can already put on a
       drawing, so leaving them out would mean a fitting on the plan contributing
       nothing and appearing in no row — which reads as a bug, not as a gap in
       the specification.
       A SCONCE IS A LAMP AND NOT A COVE. It borrows the floor/table lamp's
       distribution, which is the right one for the same reason it is right
       there: a sconce is a decorative fitting with a shade or a diffuser, and it
       throws up at the ceiling and down at the floor as well as along the wall.
       It was on the reverse cove's split — all wall, a little floor — which is
       what a slot washing a wall does and not what a fitting standing off it
       does. `borrowed` says whose figures these are.
       ONE WATTAGE AND NOT A LIST: a sconce is specified at 7 W. See
       SCONCE_WATTS. */
    id: 'sconce', label: 'Wall sconce', unit: 'nos', borrowed: 'lamp', layer: 'accent',
    split: { ceiling: 0.25, walls: 0.5, floor: 0.25 },
    watts: SCONCE_WATTS, defaultWatts: 7, lumens: null,
  },
  {
    id: 'shelf_strip', label: 'Shelf LED strip', unit: 'm', borrowed: 'reverse_cove', layer: 'accent',
    split: { ceiling: 0.0, walls: 0.8, floor: 0.2 },
    watts: STRIP_WATTS_PER_M, defaultWatts: 5, lumens: null, loss: STRIP_LOSS,
    lumensPerWatt: STRIP_LUMENS_PER_WATT,
  },
];

export const FAMILY_BY_ID = Object.fromEntries(FIXTURE_FAMILIES.map((f) => [f.id, f]));

// --- the arithmetic ---------------------------------------------------------

/**
 * THE THREE REFLECTANCES AND THEIR AVERAGE.
 *
 * The walls are weighted by LENGTH and not by count — every wall in a space is
 * the same height, so length share is area share, and one dark 2ft return must
 * not count for as much as a dark 20ft living-room wall.
 *
 * `avg` IS THE PLAIN MEAN OF THE THREE SURFACES and deliberately not weighted by
 * their areas. It is the figure the brief specifies, and the two readings differ
 * most in exactly the room where the answer matters least — a tall narrow space,
 * where the walls dominate the surface and the average would collapse onto the
 * wall tone alone.
 */
export function reflectanceOf(materials, polygonFt) {
  const ceiling = SURFACE_REFLECTANCE.ceiling[toneOf(materials?.ceiling)];
  const floor = SURFACE_REFLECTANCE.floor[toneOf(materials?.floor)];

  const walls = materials?.walls ?? {};
  let sum = 0, total = 0;
  const poly = polygonFt ?? [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) continue;
    sum += SURFACE_REFLECTANCE.wall[toneOf(walls[i])] * len;
    total += len;
  }
  // A room with no usable outline is every wall at the default, which is the
  // only honest reading of "we do not know where the walls are".
  const wall = total > 0 ? sum / total : SURFACE_REFLECTANCE.wall.light;

  return { ceiling, floor, wall, avg: (ceiling + floor + wall) / 3 };
}

/**
 * FLOOR, CEILING AND WALLS IN SQUARE FEET.
 *
 * The walls are the perimeter times the height, with nothing taken out for doors
 * and windows. That is deliberate at this stage: an opening is a hole in the
 * wall AND a source of light, and subtracting one without accounting for the
 * other would make a room with a glazed wall read as needing less light than the
 * same room with a solid one.
 */
export function surfaceAreas(polygonFt, ceilingMm) {
  const poly = polygonFt ?? [];
  let perimeterFt = 0, twiceArea = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    perimeterFt += Math.hypot(b.x - a.x, b.y - a.y);
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const floorSqft = Math.abs(twiceArea) / 2;
  const heightFt = (Number(ceilingMm) || 0) / MM_PER_FT;
  const wallSqft = perimeterFt * heightFt;
  return {
    perimeterFt, heightFt,
    floorSqft,
    // ONE SLAB, NOT THE SLAB MINUS ITS COVES. A dropped band is still ceiling and
    // still reflects; the detail changes where the light comes from, which the
    // families above already account for, and not how much surface there is.
    ceilingSqft: floorSqft,
    wallSqft,
    totalSqft: floorSqft * 2 + wallSqft,
  };
}

/** What one square foot of total surface is owed, by project. */
export const lumensPerSqftFor = (projectId) =>
  LUMENS_PER_SQFT[projectId] ?? LUMENS_PER_SQFT_DEFAULT;

/**
 * WHAT A WATT BUYS, GIVEN WHERE THE BUILDING IS.
 *
 * `country` is free text out of the project row, so the match is the forgiving
 * one the plates already use — code, name or alias, case-insensitively, off the
 * same COUNTRIES table.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS GO THROUGH `countryFor`. That helper
 * answers India for anything it has never heard of, which is right for a
 * switchboard — you have to draw SOME plate, and the Indian one is this app's
 * default — and wrong here: a project that says "United Kingdom" would be
 * specified at 75 lm/W, silently, and come out a third short of what the sheet
 * promised.
 *
 * SO THE TWO CASES ARE SEPARATED. Nothing said at all is a plan whose country
 * nobody has filled in, which on an India-first product is India. Something said
 * that this table does not carry a figure for is abroad, and abroad is 100.
 */
export function lumensPerWattFor(country) {
  const want = String(country ?? '').trim().toLowerCase();
  if (!want) return LUMENS_PER_WATT[DEFAULT_COUNTRY] ?? LUMENS_PER_WATT_DEFAULT;
  for (const [code, c] of Object.entries(COUNTRIES)) {
    if (LUMENS_PER_WATT[code] == null) continue;
    if (c.code.toLowerCase() === want || c.name.toLowerCase() === want
        || c.aliases.includes(want)) return LUMENS_PER_WATT[code];
  }
  return LUMENS_PER_WATT_DEFAULT;
}

/** LU_REQ x TOT_SF x (1 - AVG_REF), and nothing else. */
export const lumensRequired = (luReq, totalSqft, avgRef) =>
  luReq * totalSqft * (1 - avgRef);

/**
 * HOW MUCH OF A FITTING'S OUTPUT THE ROOM ACTUALLY GETS BACK — the coefficient
 * in the header's formula, on its own so it can be shown as well as used.
 */
export const bounceOf = (split, ref) =>
  (split.ceiling * ref.ceiling) + (split.walls * ref.wall) + (split.floor * ref.floor);

/**
 * HOW BRIGHT THE FLOOR IS DIRECTLY UNDER ONE FITTING, in lux.
 *
 * A DIFFERENT QUESTION FROM EVERY OTHER FIGURE IN THIS FILE, and that is why it
 * is worth having. Everything else here is a room-wide LUMEN budget: how much
 * light a space is owed and how much of it comes back off the surfaces. This is
 * a local INTENSITY — stand under this lamp and read a book. A designer
 * specifying a downlight wants both, and they move in opposite directions when
 * the optic changes: tighten a 45-degree lamp to 24 and its contribution to the
 * room does not move at all while the pool under it more than doubles in
 * brightness. A panel that showed only the first would report that change as
 * nothing happening.
 *
 * PER FITTING AND NOT PER ROW. It is an intensity, so twelve of them do not make
 * it twelve times brighter — they make twelve pools. The count belongs to the
 * lumen figures beside it.
 *
 * THE DIRECT SHARE ONLY — `split.floor`, which is 0.8 for a COB. What lands on
 * the floor under the lamp is what the lamp throws down; the rest of the output
 * goes to the walls and comes back as ambient, which is exactly what
 * `bounceOf` above is for and must not be counted twice.
 *
 * OVER THE POOL AND NOT OVER THE ROOM. The area is the cone's footprint at the
 * floor — the same circle drawn under the fitting on the drawing — so the figure
 * is what a meter would read under it rather than an average over a floor most
 * of which that lamp never reaches.
 *
 * WHAT IT IS NOT is a photometric calculation. There is no candela distribution
 * here, and a real beam does not deliver its lumens evenly across a disc and
 * nothing outside it — the edge of the cone is by definition where intensity has
 * fallen to half. It is the lumen method's shape again, said about one fitting,
 * and it is honest about being that: an average over the pool, good to a
 * sensible figure rather than to a decimal place.
 *
 * `null` where the fitting has no stated optic, which is every family sold by
 * the metre and every lamp nobody has specified a beam for. A number cannot be
 * invented for those and a blank line is the honest reading.
 */
export function floorLuxOf({ output, split, beam, heightFt }) {
  if (!(beam > 0) || !(output > 0)) return null;
  const drop = heightFt > 0 ? heightFt : DEFAULT_DROP_FT;
  const dFt = throwDiameterFt(beam, drop);
  if (!(dFt > 0)) return null;
  const areaSqM = sqftToSqm(Math.PI * (dFt / 2) ** 2);
  if (!(areaSqM > 0)) return null;
  return (output * (split?.floor ?? 0)) / areaSqM;
}

/**
 * What a family's chosen wattage is worth, per piece or per metre.
 *
 * A fixed `lumens` on the family wins over the wattage: it is a real product's
 * real output, and a lumens-per-watt figure is a stand-in for not having one.
 *
 * A FAMILY'S OWN `lumensPerWatt` WINS OVER THE COUNTRY'S, because it is a fact
 * about the product: tape is 100 lm/W wherever it is bought, where a downlight
 * is not. See STRIP_LUMENS_PER_WATT. A family that says nothing follows the
 * country, which is every finished luminaire.
 *
 * `loss` COMES OFF WHATEVER THAT PRODUCED — see STRIP_LOSS for what it is, and
 * for why it applies to the fixed figure as well. A family with no `loss` loses
 * nothing, which is again every finished luminaire.
 */
export const unitOutput = (family, watts, lumensPerWatt) =>
  (family.lumens ?? (Number(watts) || 0) * (family.lumensPerWatt ?? lumensPerWatt))
  * (1 - (family.loss ?? 0));

/**
 * The wattage in force for one row, given whatever the room has chosen.
 *
 * `key` IS NOT THE FAMILY, AND THAT IS THE POINT. A room holds one COB decision
 * and four separate cove runs — a bedroom's perimeter cove and the drop over the
 * bed are two lengths of tape somebody specifies independently — so the store is
 * keyed by whatever the caller says identifies a ROW. For a counted family that
 * is the family id; for a run it is the run's own id. See `analyseSpace`.
 *
 * A WATTAGE THE FAMILY DOES NOT OFFER IS THE DEFAULT, which is what makes a
 * stored figure safe to keep: edit the options in this file and a plan that
 * named one you have since removed comes back at the new default rather than at
 * a number nothing sells.
 */
export function wattsFor(familyId, chosen, key = familyId, fallback = null) {
  const f = FAMILY_BY_ID[familyId];
  if (!f) return null;
  const w = Number(chosen?.[key]);
  if (f.watts.includes(w)) return w;
  /* A ROW MAY START SOMEWHERE OTHER THAN ITS FAMILY'S DEFAULT, and the spots are
     why. A directional spot and an ambient downlight are one FAMILY here — same
     recessed lamp, same distribution — and two different catalogue lines: 5 W at
     30 degrees against 7 W at 36. They were one row at one wattage until the
     Analysis grew its three sections and split them, and a spot row opening at
     the grid's 7 W would be the panel stating a figure the schedule contradicts.
     IGNORED UNLESS THE FAMILY SELLS IT, like every stored choice — see the note
     above. A fallback nothing offers is not a licence to invent a product. */
  if (fallback != null && f.watts.includes(Number(fallback))) return Number(fallback);
  return f.defaultWatts;
}

export const ftToM = (ft) => ft * M_PER_FT;
export const sqftToSqm = (sqft) => sqft / SQFT_PER_SQM;

/**
 * THE WHOLE READING FOR ONE SPACE.
 *
 * `groups` is what is actually on this ceiling, already counted by the caller:
 * `[{ key, familyId, count, lengthFt }]`. Counting belongs to whoever knows what
 * a cove strip and a task spot are; the arithmetic belongs here, and keeping the
 * two apart is what makes this file testable without a drawing.
 *
 * ONE GROUP IS ONE ROW, AND WHAT A ROW IS IS THE CALLER'S DECISION. A length of
 * tape is a thing you point at on the drawing and specify on its own, so each
 * run comes in as its own group; twelve COBs are one decision about COBs and
 * come in as one. `key` is what carries that: it is the row's identity, what its
 * chosen wattage is stored against, and it defaults to the family for a caller
 * that does not care.
 *
 * A GROUP WITH NOTHING IN IT IS DROPPED. A row saying "0 COBs, 0 lumens" is a
 * fitting the room does not have, and the panel would grow one per family the
 * moment anything was placed.
 *
 * ...AND WHERE A FAMILY HAS SEVERAL ROWS THEY ARE NUMBERED. "Cove" twice in a
 * list is two rows you cannot tell apart, and the wattage chips under them make
 * that a question of which one you are about to change.
 */
/**
 * WHAT ONE FITTING OF A FAMILY IS WORTH TO A ROOM, in lumens on the useful side
 * of the bounce.
 *
 * IT IS `analyseSpace`'s OWN PER-ROW ARITHMETIC, FACTORED — `unitOutput` times
 * `bounceOf`, which is exactly what `netLumens` divided by the quantity is. It
 * is pulled out rather than reimplemented because the one caller that needs it
 * is INVERTING the panel: the diffuser allocator asks "how many of these does
 * this room still want", and the only defensible answer is the model's own
 * figure. A second formula would be a second opinion about a shortfall the
 * panel is about to print.
 *
 * `ref` AND `lumensPerWatt` COME FROM AN `analyseSpace` RESULT, both of them, so
 * the marginal figure is computed against the same surfaces and the same country
 * as the total it is going to be compared with. Passing the room instead would
 * mean re-deriving the reflectances here, which is the drift this exists to
 * avoid.
 *
 * 0 FOR A FAMILY NOTHING IS KNOWN ABOUT, which a caller reads as "cannot say"
 * and must not divide by. A family with no output would otherwise make the
 * allocator ask for infinitely many.
 */
export function netPerUnit(familyId, watts, { ref, lumensPerWatt } = {}) {
  const family = FAMILY_BY_ID[familyId];
  if (!family || !ref) return 0;
  const out = unitOutput(family, watts, lumensPerWatt);
  return out > 0 ? out * bounceOf(family.split, ref) : 0;
}

export function analyseSpace({
  polygonFt, ceilingMm, materials, projectId, country,
  groups = [], watts = {},
}) {
  const ref = reflectanceOf(materials, polygonFt);
  const areas = surfaceAreas(polygonFt, ceilingMm);
  const luReq = lumensPerSqftFor(projectId);
  const required = lumensRequired(luReq, areas.totalSqft, ref.avg);
  const lumensPerWatt = lumensPerWattFor(country);

  const rows = [];
  for (const g of groups) {
    const family = FAMILY_BY_ID[g.familyId];
    if (!family) continue;
    const perMetre = family.unit === 'm';
    const qty = perMetre ? ftToM(g.lengthFt ?? 0) : (g.count ?? 0);
    if (!(qty > 0)) continue;
    const key = g.key ?? family.id;
    /* --- A GROUP MAY STATE ITS OWN WATTAGE, AND ONE KIND OF FITTING DOES -----
       `watts` here is the room's store of overrides, keyed by row — the right
       shape for everything the ENGINE placed, because the fitting itself has no
       opinion and the room's choice is the only record there is. A COB somebody
       placed by hand is the other way round: it was specified at the moment it
       was put down, the figure is ON the fitting the way `manualCoves` carry
       their own geometry, and there is nothing for a room-level store to hold.
       So a group that states a wattage is believed, and the store is not asked.
       See `manualCobs` in App.jsx. */
    const w = g.watts != null ? Number(g.watts)
      : wattsFor(family.id, watts, key, g.defaultWatts ?? null);
    const perUnit = unitOutput(family, w, lumensPerWatt);
    const totalOutput = qty * perUnit;
    const bounce = bounceOf(family.split, ref);
    rows.push({
      key, familyId: family.id,
      /* ...AND ITS OWN NAME. A family's label is what the FAMILY is called, and
         that is what almost every row wants. It is not what a row wants when two
         rows of one family are two different things to a reader — twelve COBs
         the grid laid out, and one COB somebody put over the console — and
         calling both "Recessed COB" would make the numbering below the only way
         to tell them apart, which is a worse label than either. */
      label: g.label ?? family.label,
      unit: family.unit,
      count: g.count ?? 0, lengthFt: g.lengthFt ?? 0, metres: perMetre ? qty : null,
      watts: w, wattOptions: family.watts, split: family.split,
      /* THE TWO THINGS A ROW CAN CARRY THAT THE FAMILY CANNOT ------------------
         `wattRange` is a CONTINUOUS choice where the family offers a list, and
         `beam` is an optic. Both belong to a hand-placed fitting and to nothing
         else: the engine buys off the catalogue, where three wattages and three
         beam angles are the three products, and a slider over a catalogue would
         be a control that produces order lines nobody can fill. Null on every
         other row, and the panel draws neither. See lib/cob.js. */
      wattRange: g.wattRange ?? null,
      beam: g.beam ?? null,
      /* WHICH OF THE THREE JOBS THIS ROW IS DOING. The family's answer unless
         the caller knows better, and for two rows it does: a directional spot
         and an art spot are both the COB family — same lamp, same distribution
         — and they are the task layer and the accent layer respectively. Only
         the thing that knows what a fitting is FOR can say that, and that is the
         caller. See the note on `layer` in FIXTURE_FAMILIES. */
      layer: g.layer ?? family.layer ?? 'ambient',
      totalOutput, bounce, netLumens: totalOutput * bounce,
      /* AND WHAT ONE OF THEM PUTS ON THE FLOOR, where the fitting has an optic
         to say it with. Null on everything sold by the metre and on any lamp
         nobody has specified a beam for — see `floorLuxOf`, which explains why
         this is a different KIND of number from the two beside it and why it is
         per fitting rather than per row. Computed from the space's own ceiling
         height, so the same lamp reads brighter in a low room. */
      floorLux: perMetre ? null : floorLuxOf({
        output: perUnit, split: family.split,
        beam: g.beam ?? null, heightFt: areas.heightFt,
      }),
    });
  }

  /* NUMBERED ONLY WHERE THERE IS SOMETHING TO TELL APART. One cove in a room is
     "Cove"; three are "Cove 1", "Cove 2", "Cove 3". A room's only run carrying a
     1 after it would be the panel counting for the sake of counting.
     BY LABEL AND NOT BY FAMILY, which is the same question asked of what is
     actually on screen. Two rows of one family that are called different things
     — the grid's COBs and a COB placed by hand — are already told apart, and
     numbering them would say they were a series when they are not. */
  const per = {};
  for (const r of rows) per[r.label] = (per[r.label] ?? 0) + 1;
  const seen = {};
  for (const r of rows) {
    if (per[r.label] < 2) continue;
    const base = r.label;
    seen[base] = (seen[base] ?? 0) + 1;
    r.label = `${base} ${seen[base]}`;
  }

  const achieved = rows.reduce((s, r) => s + r.netLumens, 0);

  /* --- AND THE SAME TOTAL, SPLIT THE WAY THE SCHEME IS DESIGNED -------------
     WHAT LIGHTS THE ROOM AND WHAT LIGHTS THE WORK ARE TWO FIGURES, and a
     readout that only gives their sum cannot say the one thing a lighting
     designer wants said: that a room reaching its number on spots is not a lit
     room. `achieved` is these three added up, always — the split groups the
     rows, it does not change the arithmetic.
     ALL THREE KEYS ARE PRESENT AT 0, so a caller can print a layer without
     first asking whether the room has one. See `layer` on the rows above for
     which fitting is in which. */
  const byLayer = { ambient: 0, task: 0, accent: 0 };
  for (const r of rows) byLayer[r.layer] = (byLayer[r.layer] ?? 0) + r.netLumens;

  /* --- ...AND THE TWO FIGURES THE READOUT PRINTS, WHICH ARE NOT THE THREE ---
     ACCENT LIGHT IS AMBIENT LIGHT AS FAR AS A ROOM'S LEVEL GOES. A sconce
     washes a wall, a pendant throws in every direction, a shelf strip lifts a
     recess — none of them is aimed at a work surface, and all of that light ends
     up in the room the same way a cove's does. The THREE layers are still what a
     scheme is designed in, and the fixture list groups by them; the READING is
     "how much of this room is being washed, and how much is being pointed at
     something", which is two figures.
     SO THE GROUPING AND THE ACCOUNTING ARE BOTH HERE, and neither is derived in
     a component. A panel adding two of the three together would be a second
     place that decides what ambient means. */
  const contributions = {
    ambient: byLayer.ambient + byLayer.accent,
    task: byLayer.task,
  };

  return {
    ref, areas, luReq, required, lumensPerWatt, rows, achieved,
    byLayer, contributions,
    shortfall: Math.max(0, required - achieved),
    ok: achieved >= required,
  };
}
