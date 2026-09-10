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

// ===========================================================================
// THE SECOND LAYER — REFLECTED AMBIENT LIGHT, AND ITS OWN TARGET TABLE.
//
// A DIFFERENT MEASUREMENT, SO A DIFFERENT NUMBER. Everything above is
// HORIZONTAL ILLUMINANCE on a plane: direct light and bounced light together,
// with a cosine, judged against a maintained lux figure out of CIBSE and IES.
// The reflected-ambient layer measures REFLECTED MEAN SPHERICAL ILLUMINANCE at
// a probe — light arriving from every direction after at least one surface
// reflection, with the direct beam excluded — and there is no published
// maintained figure for that quantity in these spaces. So the two tables are
// separate, neither reads the other, and they are allowed to disagree.
//
// WHERE THESE FIGURES COME FROM, STATED PLAINLY. They are the RECEIVED
// LUMENS PER SQUARE FOOT references this practice already designs general
// illumination to — the same 10 / 20 / 30 that LUMENS_PER_SQFT carries in
// lib/lumens.js — converted once, at 10.7639104 lux per lm/ft², which is
// simply the number of square feet in a square metre. One received lumen per
// square foot IS 10.7639104 lux by definition of the units; nothing about the
// conversion is a lighting assumption.
//
// AND THEY ARE PRODUCT DEFAULTS RATHER THAN COMPLIANCE THRESHOLDS. There is no
// standard that says a residential space shall reach 108 lux of reflected mean
// spherical illuminance, and this file must not be read as claiming one. They
// are a chosen starting point, pending calibration against representative
// designs, and they are here as one table so that recalibrating is an edit to
// five numbers rather than a change to the engine.
//
// WHAT THIS IS NOT, AND IT IS THE SAME TRAP THE HEADER OF THIS FILE DESCRIBES:
// it is NOT a fixture-lumens-over-floor-area figure. `LUMENS_PER_SQFT` is a
// BUDGET — how many lumens to buy for a box of surfaces — and dividing a
// scheme's total output by its floor area does not give an illuminance anybody
// can measure. The reference below is on the RECEIVING side: lumens per square
// foot ARRIVING at a location, which is a flux density and therefore is lux.
// The two use the same round numbers because the practice does; they are not
// the same quantity and neither is derived from the other.
// ===========================================================================

/**
 * LUX PER RECEIVED LUMEN PER SQUARE FOOT. Square feet in a square metre, to the
 * seven figures the brief specifies. Exact by definition (0.3048 m to the foot),
 * and it is a constant rather than a literal at the two use sites so that the
 * table below and any future reader convert the same way.
 */
export const LUX_PER_LM_PER_SQFT = 10.7639104;

/**
 * THE DESIGN REFERENCE, IN RECEIVED LUMENS PER SQUARE FOOT, BY PROJECT.
 *
 * Keyed by the ids in PROJECT_TYPES (lib/roomTypes.js), and `retail` is here
 * for the reason LUMENS_PER_SQFT keeps it: a figure that was specified and then
 * silently dropped is a figure somebody has to find again.
 *
 * `educational` IS NOT IN THE SPECIFIED TABLE AND IS CARRIED ACROSS FROM THE
 * OFFICE FIGURE, which is exactly what LUMENS_PER_SQFT already does with it and
 * for the same reason: it has had no review of its own, and the commercial
 * figure is a better answer than a number nobody has looked at. Stated here so
 * the day somebody reviews it, this is the line to change.
 */
export const REFLECTED_AMBIENT_LM_PER_SQFT = {
  residential: 10,
  hotel: 10,
  restaurant: 10,
  office: 20,
  educational: 20,
  retail: 30,
};

/** For a project nobody has given a figure — the documented residential
 *  reference, and the same argument LUMENS_PER_SQFT_DEFAULT makes: the gentlest
 *  of them, because over-lighting a space nobody specified is the error that
 *  gets built. */
export const REFLECTED_AMBIENT_LM_PER_SQFT_DEFAULT = 10;

/**
 * ...AND THE SAME TABLE IN LUX, WHICH IS WHAT THE ENGINE COMPARES AGAINST.
 *
 * DERIVED RATHER THAN TYPED OUT, so the two can never drift: editing a
 * reference above moves the target, and there is no second place holding 107.64
 * that somebody could update by half. THE FULL PRECISION IS KEPT HERE and the
 * rounding happens at the point of display — 108, 215 and 323 — which is the
 * rule the rest of this file follows for the same reason.
 */
export const REFLECTED_AMBIENT_TARGET_LUX = Object.fromEntries(
  Object.entries(REFLECTED_AMBIENT_LM_PER_SQFT)
    .map(([id, lm]) => [id, lm * LUX_PER_LM_PER_SQFT]));

/** 107.64 lux — the residential reference, and what an unrecognised project
 *  gets. Derived from the same constant for the same reason. */
export const REFLECTED_AMBIENT_TARGET_LUX_DEFAULT =
  REFLECTED_AMBIENT_LM_PER_SQFT_DEFAULT * LUX_PER_LM_PER_SQFT;

/**
 * WHAT THIS SPACE IS AIMING AT ON THE REFLECTED-AMBIENT LAYER, in lux.
 *
 * BY PROJECT AND NOT BY ROOM TYPE, WHICH IS A DELIBERATE DIFFERENCE from
 * `heatmapTargetFor` above and is worth stating rather than leaving as an
 * omission. The horizontal table has a per-room override because a kitchen
 * worktop and a bedroom genuinely want different amounts of light ON THE TASK.
 * The specified reflected-ambient references are a per-project general-
 * illumination figure and nobody has reviewed a per-room breakdown of them; a
 * table invented here would be this file asserting a specification it does not
 * have. The signature takes `roomTypeId` anyway so that the day such a table is
 * reviewed it is an entry here and not a change at every call site.
 *
 * ONE PLACE FOR THE MAPPING, THE CONVERSION AND THE FALLBACK, which is what the
 * brief asks for and what makes recalibration an edit to this file alone.
 */
export const reflectedAmbientTargetFor = (projectId, _roomTypeId = null) =>
  REFLECTED_AMBIENT_TARGET_LUX[projectId] ?? REFLECTED_AMBIENT_TARGET_LUX_DEFAULT;

/**
 * HOW MUCH OF THE FLOOR'S HORIZONTAL ILLUMINANCE THE `average` LAYER ADDS.
 *
 * IT IS THE MEAN-SPHERICAL CONVERSION AND NOT A WEIGHTING. A sphere reads a
 * quarter of the normal illuminance of any beam it sits in — see
 * MEAN_SPHERICAL_FACTOR in reflection.js, which is the same number derived
 * from the same geometry — so a quarter of a horizontal lux figure IS the mean
 * spherical illuminance a sphere would read if all of that light arrived from
 * straight overhead. That is what puts both halves of `average` in the same
 * units and lets them be added at all.
 *
 * IT LIVES HERE, IN THE CONFIG, BECAUSE TWO THINGS HAVE TO USE IT AND THEY MUST
 * NOT BE ABLE TO DISAGREE — the VALUE (`solveAverage` in indirect.js) and the
 * TARGET (`heatmapTargetForLayer` below). They were separate for one revision
 * and the consequence was exactly what you would expect: the layer grew a term
 * that its target had never heard of, so every room read over target by
 * whatever a quarter of its horizontal figure came to. One constant, two
 * readers, and tools/test-heatmap-indirect.mjs asserts it is still the same
 * number reflection.js derives.
 */
export const AVERAGE_FLOOR_SHARE = 0.25;

/**
 * THE LAYERS THE HEATMAP CAN SHOW. Three, and the table is the whole of what
 * the legend's selector is built from — a fourth is an entry here, a line in
 * the resolver below, and nothing at all in the engine.
 *
 * `label` IS THE FULL NAME AND `short` IS WHAT FITS IN THE SELECTOR. The
 * existing view keeps the name it has always had on the card ("Estimated
 * illuminance"), which is what "preserve existing view names" asks for.
 *
 * `note` IS THE ONE SENTENCE THAT ANSWERS "WHAT AM I LOOKING AT" and it is a
 * TOOLTIP rather than a paragraph on the card — this app's rule is that a
 * control is its label, and the card already carries the measurement, the
 * height and the target in plain sight. The sentence is for the reader who
 * wants to know what a layer includes and excludes, which is the one thing the
 * name cannot say.
 *
 * --- `probe` AND `floor` ARE WHAT THE ENGINE READS, AND THEY ARE THE WHOLE
 *     INTERFACE BETWEEN THIS TABLE AND THE SOLVER ------------------------
 *
 *   `floor`  this layer needs the DIRECT illuminance at every grid cell — the
 *            expensive nine-sub-sample pass. False means the pass is skipped
 *            outright, which is what makes the reflected layer cheap.
 *
 *   `probe`  this layer is read at a point in the room's VOLUME rather than on
 *            the floor, so it needs a sphere transfer at a height — and so the
 *            legend shows the height control. One field for both, because a
 *            layer with a probe is exactly a layer with a height to set.
 *
 * A layer that wants neither is a layer with nothing to draw; a layer that
 * wants both is `average`, which is literally the sum of the other two.
 */
export const HEATMAP_LAYERS = [
  {
    id: 'illuminance',
    label: 'Estimated illuminance',
    short: 'Illuminance',
    measure: 'Horizontal lux',
    note: 'Horizontal illuminance on the measurement plane — direct fixture '
      + 'light and reflected light together.',
    probe: false, floor: true,
  },
  {
    id: 'reflected',
    label: 'Reflected ambient light',
    short: 'Reflected',
    measure: 'Reflected ambient',
    note: 'Light reaching this location after reflecting from room surfaces. '
      + 'Direct fixture light is excluded.',
    probe: true, floor: false,
  },
  {
    /**
     * AVERAGE — the reflected ambient at the probe, plus a quarter of the
     * horizontal illuminance on the floor beneath it.
     *
     * THE QUARTER IS NOT A WEIGHTING, IT IS A UNIT CONVERSION — see
     * AVERAGE_FLOOR_SHARE above, which is the one place it is written and is
     * read by the target as well as by the value. Both terms are therefore in
     * the same units and the sum is a mean spherical illuminance.
     *
     * AND ITS TARGET IS BUILT THE SAME WAY: the reflected target plus a
     * quarter of the horizontal one. See `heatmapTargetForLayer`, which
     * carries the argument for why it must be.
     *
     * IT DOES COUNT THE REFLECTED HALF TWICE, once properly and once as a
     * quarter of what reaches the floor, and that is a property of the formula
     * as specified rather than a bug in it: it is a deliberate blend that puts
     * the fitting back into a picture the reflected layer leaves out. Stated
     * here so nobody has to rediscover it from the arithmetic.
     */
    id: 'average',
    label: 'Average',
    short: 'Average',
    measure: 'Average',
    note: 'Reflected ambient light at this height, plus a quarter of the '
      + 'horizontal illuminance on the floor below it.',
    probe: true, floor: true,
  },
];

/** The layer a plan opens on: the one that was here first, so switching the
 *  heatmap on shows what it has always shown. */
export const HEATMAP_LAYER_DEFAULT = 'illuminance';

/** A layer by id, falling back to the default rather than to nothing — a stored
 *  preference naming a layer this build has dropped must not blank the drawing. */
export const heatmapLayerFor = (id) =>
  HEATMAP_LAYERS.find((l) => l.id === id)
  ?? HEATMAP_LAYERS.find((l) => l.id === HEATMAP_LAYER_DEFAULT);

/**
 * THE TARGET FOR A LAYER — the one door, so that no caller has to know which
 * table its layer reads. The whole point of this function is that the branch
 * lives here rather than in the engine or in the legend.
 *
 * --- A COMPOSITE LAYER TAKES A COMPOSITE TARGET, AND IT HAS TO ------------
 * `average` IS BUILT THE SAME WAY ITS VALUE IS:
 *
 *     target_average  =  target_reflected  +  1/4 * target_horizontal
 *
 * and that is not symmetry for its own sake, it is the only thing that makes
 * the colour mean anything. The band scale is a RATIO of value to target, so
 * the two have to be the same quantity built out of the same parts: give the
 * value a term the target has not got and every room reads over target by
 * whatever that term came to — which is precisely what happened when this
 * layer took the reflected target unmodified.
 *
 * THE INVARIANT IT BUYS, AND IT IS THE ONE TO REMEMBER: a room sitting exactly
 * on target on BOTH component layers sits exactly on target on Average. That
 * is asserted rather than hoped for; see tools/test-heatmap-indirect.mjs.
 *
 * IT THEREFORE VARIES BY ROOM TYPE where the reflected target does not — a
 * kitchen's horizontal figure is three times a bedroom's, and half of this
 * target is that figure. Nothing to reconcile: the composite inherits whatever
 * its two halves do, which is the point of composing it rather than tabulating
 * it.
 */
export const heatmapTargetForLayer = (layerId, projectId, roomTypeId) => {
  if (layerId === 'average') {
    return reflectedAmbientTargetFor(projectId, roomTypeId)
      + AVERAGE_FLOOR_SHARE * heatmapTargetFor(projectId, roomTypeId);
  }
  return layerId === 'reflected'
    ? reflectedAmbientTargetFor(projectId, roomTypeId)
    : heatmapTargetFor(projectId, roomTypeId);
};

/**
 * THE FIVE BANDS, AS RATIOS OF THE TARGET — the brief's own figures.
 *
 * ONE SCALE FOR BOTH LAYERS, and that is what makes the selector a change of
 * QUESTION rather than a change of instrument. `ratio` is the layer's own
 * measurement over the layer's own target — horizontal lux over the maintained
 * figure, or reflected mean spherical illuminance over the reflected-ambient
 * figure — so green means "within a quarter of what this space is aiming at"
 * on either, and the reader learns the scale once.
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
