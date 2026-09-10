// ---------------------------------------------------------------------------
// heatmapTargets.js — WHAT "ON TARGET" MEANS ON THE HEATMAP, AND NOTHING ELSE.
//
// THIS FILE EXISTS BECAUSE NEITHER EXISTING TARGET IS A LUX FIGURE. Both were
// read before this was written, and both were rejected for the same reason —
// they are LUMEN budgets, and the heatmap colours an ILLUMINANCE:
//
//   LUMENS_PER_SQFT (lib/lumens.js)      lumens per square foot of TOTAL ROOM
//                                        SURFACE, multiplied by (1 - avg
//                                        reflectance). 10 for residential. It
//                                        answers "how many lumens does this box
//                                        of surfaces need buying for it", which
//                                        is not a quantity a light meter reads.
//
//   LUMEN_CRITERIA (lib/settings.js)     lumens per square foot of FLOOR, 20 for
//                                        residential. Closer — same denominator
//                                        as an illuminance — and still not one:
//                                        it is lumens DELIVERED by the grid over
//                                        the floor area, with nothing said about
//                                        where they land, no reflected component
//                                        and no cosine. Dividing it by anything
//                                        to get lux would be inventing a
//                                        utilisation factor and calling it a
//                                        standard.
//
// SO THE HEATMAP HAS ITS OWN TARGET, IN LUX, AND IT IS DELIBERATELY SEPARATE.
// Nothing here is read by the room budget and nothing there is read by this.
// The two are allowed to disagree: one asks whether enough light has been
// bought, this asks where it lands. Making them agree would mean changing one
// of them to suit the other, which is the thing not to do.
//
// THE FIGURES ARE MAINTAINED ILLUMINANCES on the horizontal plane, the middle of
// the ranges CIBSE and IES publish for these spaces. They are round numbers on
// purpose: a heatmap is a planning instrument and a target quoted to the lux
// would imply a precision this approximation has no claim to.
// ---------------------------------------------------------------------------

/**
 * THE MEASUREMENT PLANE, NAMED, because a lux figure without one means nothing.
 *
 * THE FLOOR AND NOT THE WORKING PLANE, and that is a choice worth stating. Most
 * published targets are quoted at 0.7–0.8 m — a desk, a worktop — and the honest
 * reason this app starts at the floor is that the floor is the one plane every
 * space in it actually has: a bedroom, a foyer and a balcony have no working
 * plane, and inventing one for them would be the heatmap asserting furniture
 * nobody drew. `heightM` is here rather than assumed at zero so that the day a
 * working plane is offered it is one entry in this table and one field in the
 * legend, not an axis threaded through the solver.
 */
export const HEATMAP_PLANE = { id: 'floor', label: 'Floor level', heightM: 0 };

/**
 * TARGET LUX BY PROJECT, keyed by the ids in PROJECT_TYPES (lib/roomTypes.js).
 *
 * `retail` is here and is not a project this app offers yet — the same courtesy
 * LUMENS_PER_SQFT extends it, and for the same reason: a figure that was
 * specified and then silently dropped is a figure somebody has to find again.
 */
export const HEATMAP_TARGET_LUX = {
  residential: 150,
  hotel: 150,
  restaurant: 150,
  office: 500,
  educational: 300,
  retail: 300,
};

/** For a project nobody has given a figure. The gentlest, for the reason
 *  LUMENS_PER_SQFT_DEFAULT gives: over-lighting a space nobody specified is the
 *  error that gets built. */
export const HEATMAP_TARGET_LUX_DEFAULT = 150;

/**
 * THE ROOMS THAT ARE NOT LIT LIKE THE REST OF THEIR BUILDING.
 *
 * ROOM TYPE WINS OVER PROJECT, exactly as `lumenCriteriaFor` already has it: a
 * kitchen in a flat is a kitchen before it is residential. Only the types that
 * genuinely differ are listed — a room absent from here takes its project's
 * figure, which is the honest reading of "nobody has looked at this one".
 *
 * The keys are room type ids from PROJECT_TYPES. Several projects share a type
 * id (`kitchen` is residential and restaurant; `office_chamber` is office and
 * educational) and one entry serves both, which is the point of keying on the
 * type rather than on the pair.
 */
export const HEATMAP_TARGET_LUX_BY_ROOM = {
  bedroom: 100,
  guest_room: 100,
  suite: 100,
  kitchen: 300,
  pantry: 200,
  utility: 200,
  toilet: 150,
  corridor: 100,
  staircase: 150,
  store: 100,
  balcony: 75,
  pooja_room: 150,
  foyer: 100,
  office_workspace: 500,
  conference_room: 500,
  reception: 300,
  server_room: 200,
  classroom: 300,
  lecture_hall: 300,
  laboratory: 500,
  library: 500,
  canteen: 200,
  dining_area: 150,
  private_dining: 150,
  bar: 150,
  waiting: 200,
  lobby: 200,
  banquet: 200,
  back_of_house: 200,
};

/** What this space is aiming at, in lux on the measurement plane. Room type
 *  wins where it has an opinion — the same precedence `lumenCriteriaFor` uses. */
export const heatmapTargetFor = (projectId, roomTypeId) =>
  HEATMAP_TARGET_LUX_BY_ROOM[roomTypeId]
  ?? HEATMAP_TARGET_LUX[projectId]
  ?? HEATMAP_TARGET_LUX_DEFAULT;

/**
 * THE FIVE BANDS, AS RATIOS OF THE TARGET — the brief's own figures.
 *
 * `token` IS THE WHOLE OF EACH BAND'S COLOUR and it names a CSS custom property
 * declared in the `@theme` block of src/styles.css. Nothing in this feature
 * holds a hex value: see colours.js, which reads these five properties off the
 * document and is the only place a colour is resolved at all.
 *
 * `anchor` IS WHERE THE BAND'S COLOUR IS AT FULL STRENGTH, and it is what makes
 * the ramp continuous without the bands losing their meaning. The three middle
 * bands anchor at their MIDPOINT, so a value squarely inside one reads as that
 * band's colour and a value on a boundary reads as a blend of the two it is
 * between — which is what "smoothly blend between documented colour anchors"
 * asks for, and is the honest picture of a figure this approximate.
 *
 * THE TWO END BANDS ANCHOR AT THEIR OWN ENDS INSTEAD, and neither is arbitrary.
 * The open top has no midpoint to have, so 2.5 is stated: a quarter again past
 * the band's floor, which is where a room genuinely over its target lands.
 *
 * AND THE BOTTOM BAND ANCHORS AT ZERO, WHICH WAS A REAL FIX. It sat at 0.125
 * like a midpoint, and the consequence was a FLAT FLOOR to the scale: every cell
 * under an eighth of target came out the same deep blue, so on a 150 lux target
 * the whole range from nothing at all up to 19 lux was one colour. A decorative
 * run — a few feet of 5 W tape, which is a couple of hundred lumens — lands
 * squarely in that dead zone, and adding one to a dark room visibly changed
 * nothing. The band still means what it says (everything in it reads cold and
 * short) and the dark end now has gradient in it, which is exactly where
 * somebody is asking whether a small fitting is doing anything at all.
 *
 * BELOW ZERO AND ABOVE THE LAST ANCHOR THE SCALE SATURATES rather than running
 * off into a colour nothing has defined. `to: null` is the open top.
 */
export const HEATMAP_BANDS = [
  { id: 'below-25',  from: 0,    to: 0.25, anchor: 0,
    token: '--color-heatmap-below-25',  label: 'Below 25%' },
  { id: '25-75',     from: 0.25, to: 0.75, anchor: 0.5,
    token: '--color-heatmap-25-75',     label: '25–75%' },
  { id: '75-125',    from: 0.75, to: 1.25, anchor: 1.0,
    token: '--color-heatmap-75-125',    label: '75–125%' },
  { id: '125-200',   from: 1.25, to: 2.0,  anchor: 1.625,
    token: '--color-heatmap-125-200',   label: '125–200%' },
  /* See the note above on why this one is not a midpoint. */
  { id: 'above-200', from: 2.0,  to: null, anchor: 2.5,
    token: '--color-heatmap-above-200', label: 'Above 200%' },
];

/**
 * WHICH BAND A RATIO IS IN. Half-open intervals, so a value exactly on a
 * boundary belongs to the band ABOVE it — the same convention the labels read
 * as ("25–75%" starts at 25). Only the legend and the tests ask this; the
 * renderer asks for a colour instead, which is a blend rather than a band.
 */
export const heatmapBandFor = (ratio) => {
  const r = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  for (const b of HEATMAP_BANDS) {
    if (b.to == null || r < b.to) return b;
  }
  return HEATMAP_BANDS[HEATMAP_BANDS.length - 1];
};
