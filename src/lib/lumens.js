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
 */
export const STRIP_LOSS = 0.1;

/** A recessed COB, per piece. */
export const COB_WATTS = [3, 5, 7, 9, 12];

/** A panel or diffuser, per piece. Not offered by any tool yet — see the note
 *  on `panel` below. */
export const PANEL_WATTS = [9, 12, 18, 24, 36];

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
    id: 'cove', label: 'Cove', unit: 'm',
    split: { ceiling: 0.8, walls: 0.2, floor: 0.0 },
    watts: STRIP_WATTS_PER_M, defaultWatts: 5, lumens: null, loss: STRIP_LOSS,
    lumensPerWatt: STRIP_LUMENS_PER_WATT,
  },
  {
    id: 'reverse_cove', label: 'Reverse cove', unit: 'm',
    split: { ceiling: 0.0, walls: 0.8, floor: 0.2 },
    watts: STRIP_WATTS_PER_M, defaultWatts: 5, lumens: null, loss: STRIP_LOSS,
    lumensPerWatt: STRIP_LUMENS_PER_WATT,
  },
  {
    /* DIFFUSERS, PANEL LIGHTS AND A STRIP ON THE CEILING ARE ONE DISTRIBUTION
       AND TWO UNITS, which is why they are two entries sharing a `split`. What
       they have in common is that the light leaves a surface that is already the
       ceiling, so none of it goes back up. */
    id: 'ceiling_strip', label: 'Ceiling LED strip', unit: 'm',
    split: { ceiling: 0.0, walls: 0.7, floor: 0.3 },
    watts: STRIP_WATTS_PER_M, defaultWatts: 5, lumens: null, loss: STRIP_LOSS,
    lumensPerWatt: STRIP_LUMENS_PER_WATT,
  },
  {
    id: 'panel', label: 'Diffuser / panel', unit: 'nos',
    split: { ceiling: 0.0, walls: 0.7, floor: 0.3 },
    watts: PANEL_WATTS, defaultWatts: 18, lumens: null,
  },
  {
    id: 'cob', label: 'Recessed COB', unit: 'nos',
    split: { ceiling: 0.0, walls: 0.2, floor: 0.8 },
    watts: COB_WATTS, defaultWatts: 7, lumens: null,
  },
  {
    id: 'lamp', label: 'Floor / table lamp', unit: 'nos',
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
    id: 'sconce', label: 'Wall sconce', unit: 'nos', borrowed: 'lamp',
    split: { ceiling: 0.25, walls: 0.5, floor: 0.25 },
    watts: SCONCE_WATTS, defaultWatts: 7, lumens: null,
  },
  {
    id: 'shelf_strip', label: 'Shelf LED strip', unit: 'm', borrowed: 'reverse_cove',
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
export function wattsFor(familyId, chosen, key = familyId) {
  const f = FAMILY_BY_ID[familyId];
  if (!f) return null;
  const w = Number(chosen?.[key]);
  return f.watts.includes(w) ? w : f.defaultWatts;
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
    const w = wattsFor(family.id, watts, key);
    const totalOutput = qty * unitOutput(family, w, lumensPerWatt);
    const bounce = bounceOf(family.split, ref);
    rows.push({
      key, familyId: family.id, label: family.label, unit: family.unit,
      count: g.count ?? 0, lengthFt: g.lengthFt ?? 0, metres: perMetre ? qty : null,
      watts: w, wattOptions: family.watts, split: family.split,
      totalOutput, bounce, netLumens: totalOutput * bounce,
    });
  }

  /* NUMBERED ONLY WHERE THERE IS SOMETHING TO TELL APART. One cove in a room is
     "Cove"; three are "Cove 1", "Cove 2", "Cove 3". A room's only run carrying a
     1 after it would be the panel counting for the sake of counting. */
  const per = {};
  for (const r of rows) per[r.familyId] = (per[r.familyId] ?? 0) + 1;
  const seen = {};
  for (const r of rows) {
    if (per[r.familyId] < 2) continue;
    seen[r.familyId] = (seen[r.familyId] ?? 0) + 1;
    r.label = `${r.label} ${seen[r.familyId]}`;
  }

  const achieved = rows.reduce((s, r) => s + r.netLumens, 0);
  return {
    ref, areas, luReq, required, lumensPerWatt, rows, achieved,
    shortfall: Math.max(0, required - achieved),
    ok: achieved >= required,
  };
}
