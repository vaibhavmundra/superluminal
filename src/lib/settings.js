// ---------------------------------------------------------------------------
// settings.js — THE FILE TO EDIT.
//
// Everything here used to be a slider or a checkbox in the right-hand panel.
// They were dials that wanted setting once, correctly, not dials that wanted
// nudging per room — and a panel full of them made the twenty controls that
// matter impossible to find among the eighty that do not. So they live in code
// now: change a number here, reload, and the whole app follows.
//
// The planner's own dials are a separate list, documented line by line in
// planner.js DEFAULTS. Override any of them in OVERRIDES below rather than
// editing that file, so the reasoning behind each default stays readable next
// to it.
// ---------------------------------------------------------------------------

import { DEFAULTS, resolveOptions } from './planner.js';

/** Planner dials to change from their documented defaults. */
export const OVERRIDES = {
  fanClearance: 1.0,
  // targetArea: 50,        // sqft one cell should cover
  // minWallDistance: 5.0,  // ft a large light keeps from the nearest wall
};

export const PLAN_OPTIONS = resolveOptions({ ...DEFAULTS, ...OVERRIDES });

/**
 * What one fitting puts out, in lumens.
 *
 * This is the only place the layout meets the actual product. A "small" light
 * is one centred in a cell; a "large" one serves a pair of cells and is
 * correspondingly brighter. Change these to whatever is being specified and the
 * lm/sqft figure in the Result panel follows.
 */
export const FITTING_LUMENS = {
  small: 900,    // ~10-12W COB downlight
  large: 1600,   // ~18-20W
};

/**
 * HOW MUCH AMBIENT LIGHT A SPACE IS OWED, in lumens per square foot.
 *
 * This is the first number in the app that states the brief DIRECTLY. Every
 * other lever is a proxy for it — `targetArea` says "one 900 lm fitting per
 * 50 sqft", which IS 18 lm/sqft, but it says it in the currency of the grid
 * rather than in the currency of the standard. The proxy is fine while the only
 * thing being placed is a grid of identical downlights. It stops being fine the
 * moment a second kind of source is in the room: a cove delivers lumens by the
 * FOOT OF RUN, a grid delivers them by the CELL, and the only place those two
 * can be compared is here.
 *
 * Keyed by PROJECT type, because that is the question already asked of the user
 * before anything is laid out, and because the standards are written that way:
 *
 *   Residential and hospitality   20 lm/sqft   homes, hotels, restaurants —
 *                                              spaces people relax in, lit to
 *                                              be comfortable rather than to be
 *                                              worked in
 *   Commercial and institutional  50 lm/sqft   offices and schools — task light
 *                                              across the whole floor, and a
 *                                              standard somebody signs off
 *
 * 20 is a little above what the ordinary 50 sqft cell delivers (18), which is
 * the right way round: the criterion is the target and the grid is what tries
 * to meet it.
 *
 * AND OFFICE IS 36, NOT THE 50 THE STANDARD SAYS. THIS IS A CLIMBDOWN AND IS
 * WORTH READING AS ONE.
 *
 * Offices were never getting close. Every office space except a toilet was
 * gridded at the ordinary 50 sqft cell, which is 18 lm/sqft, against a criterion
 * of 50 — so the Result panel reported a shortfall of nearly three to one on
 * every plan, on every room, permanently. A criterion that is never once met is
 * not a standard being enforced, it is a number being ignored.
 *
 * The cell for an office is now 25 sqft (TARGET_AREA_BY_PROJECT in
 * roomTypes.js), which is the densest grid this engine lays without running into
 * `minLightSpacing`, and 36 is what that delivers: 900 lm over 25 sqft. Reaching
 * a true 50 needs an 18 sqft cell — a 4.2 ft side against a 3.9 ft minimum
 * spacing — at which point ordinary rooms start refusing to divide at all.
 *
 * SO THE HONEST STATEMENT IS THIS: 36 lm/sqft is what the app provides for an
 * office and now also what it claims, and it is below the commercial figure it
 * was taken from. The 50 is not wrong about offices; this engine cannot reach it
 * with a grid of 900 lm downlights, and the way to reach it is more lumens per
 * fitting or lumens as an INPUT to the layout — not a target left standing that
 * nothing can satisfy. `educational` is left at 50 deliberately: it has had no
 * such review, and quietly halving a figure nobody has looked at would be the
 * same mistake in the other direction.
 */
export const LUMEN_CRITERIA = {
  residential: 20,
  hotel: 20,        // hospitality
  restaurant: 20,   // hospitality
  // 900 lm over the 25 sqft office cell. DERIVED — see the long note above and
  // TARGET_AREA_BY_PROJECT in roomTypes.js. Change one, change the other.
  office: 36,       // commercial
  educational: 50,  // institutional
};

/** The fallback for a project type nobody has given a figure. The gentler of
 *  the two, because over-lighting a space nobody specified is the error that
 *  gets built and paid for. */
export const LUMEN_CRITERIA_DEFAULT = 20;

/**
 * THE TWO ROOMS THAT ARE NOT LIT LIKE THE REST OF THEIR BUILDING, and these are
 * the same two the grid already treats specially — see TARGET_AREA_BY_TYPE in
 * roomTypes.js. The figures here are DERIVED FROM THAT and must stay derived,
 * or the app would hold two different opinions about how bright a kitchen is:
 *
 *   kitchen   900 lm over a 25 sqft cell   = 36 lm/sqft
 *   toilet    450 lm over an 18 sqft cell  = 25 lm/sqft
 *
 * A toilet's number looks low next to a kitchen's and is correct: its cell is
 * small AND its fitting is the 5 W narrow lamp, which is the whole point of
 * FIXTURE_BY_TYPE.
 */
export const LUMEN_CRITERIA_BY_ROOM = { kitchen: 36, toilet: 25 };

/** What this space is owed. Room type wins where it has an opinion. */
export const lumenCriteriaFor = (projectId, roomTypeId) =>
  LUMEN_CRITERIA_BY_ROOM[roomTypeId]
  ?? LUMEN_CRITERIA[projectId]
  ?? LUMEN_CRITERIA_DEFAULT;

/**
 * How a DXF is rendered into a raster before being sent to the bed detector.
 *
 * Wall weight is in INCHES, not pixels, because px/ft varies from 6 on a site
 * plan to 40 on a single flat — a pixel value tuned on one drawing is wrong on
 * the next. Two inches closes the two faces of a 9in wall into a readable band
 * without the band growing inward far enough to eat the headboard of a bed
 * standing against it.
 */
export const WALL_WEIGHT_IN = 2;
export const OTHER_STROKE_PX = 1.6;

/** Red fan-marker detection on an image. */
/**
 * WHEN A PLAN IS TOO BIG TO ASK ABOUT ALL AT ONCE, in square feet of built area.
 *
 * The bed pass was designed to run once, on upload, against the whole sheet: one
 * call for however many bedrooms there are, answered before anybody has traced
 * anything. On a flat that is exactly right. On a 10-room resort floor it finds
 * nothing at all — each mattress is left with a few dozen pixels of a 1600px
 * image, and the model is being asked fifteen questions in one breath.
 *
 * Past this size the whole-sheet answer stops being trusted and every bedroom is
 * asked about on its own crop instead. It costs one call per bedroom and it is
 * the only version that works.
 *
 * 3000 SQFT IS A JUDGEMENT, NOT A MEASUREMENT — roughly a large 4BHK, or the
 * point at which a sheet stops being one home. The number that actually matters
 * is pixels-per-bed, but built area is what a user can reason about and what the
 * app knows exactly, so it is the dial.
 */
/* REMOVED: LARGE_PLAN_SQFT.
 *
 * It did two things and both were wrong. It skipped the whole-sheet bed pass on
 * a plan over 3000 sqft — which made every bedroom on that plan empty, which
 * made every bedroom get zoomed into, two model calls apiece, on a sheet where
 * the cheap pass had not been allowed to try. And it re-asked every bedroom on
 * a large plan regardless of whether anyone doubted the answer.
 *
 * The rule now has no size in it: the whole sheet goes to both detectors on
 * every plan and the judge settles the disagreement; a room is looked at on its
 * own only when the classifier has called it a bedroom and it has no bed. */

// FAN_DETECT — REMOVED. It tuned the red-blob search (saturation threshold and
// blob linking distance) for a detector that no longer exists: fans are placed
// by hand from the ceiling palette, and the scale comes from a door. Colour is
// the least reliable signal on a drawing — a red dimension leader, a north
// arrow and a revision cloud are all round-ish and red-ish on some office's
// sheet — and an obstacle the user never placed is worse than no obstacle.
//
// `fanClearance` in PLAN_OPTIONS is unaffected and still does its job: it is
// about keeping a downlight away from a fan that IS on the ceiling, whoever put
// it there.

/**
 * Use the room's bounding rectangle instead of its traced outline. Only ever
 * useful for a sanity check on an L-shaped room; the outline is the point.
 */
export const SIMPLIFY_ROOM_TO_RECTANGLE = false;

/**
 * HOW AN LED STRIP IS DRAWN. Every number is a MULTIPLE OF THE SHEET'S LINE
 * WEIGHT, not a pixel count, and that is the whole reason this is tunable
 * safely: the line weight is `max(width, height) / 1500`, so a strip drawn at
 * `stroke: 2.4` looks the same on a 900px sketch and a 6000px survey. Put a
 * pixel value in here and it will look right on one plan and wrong on the next.
 *
 * `pulseMs` is the exception — it is a duration in milliseconds.
 *
 * Reload after changing anything here; nothing caches these.
 */
export const STRIP_STYLE = {
  /** The dotted run itself. 2.4 reads as tape; much past 4 and it is a duct. */
  stroke: 2.4,
  /** One dot, along the run. */
  dash: 3.2,
  /** The gap between dots. Roughly equal to `dash` gives an even tape. */
  gap: 5.0,

  /** How long one breath takes. A strip pulsates the way a spot does — the glow
   *  under it swells and fades — so this is the same kind of number as the
   *  downlights' 2.8s cycle, and matching them is the point. */
  pulseMs: 3000,

  /** The soft glow under the run — width, and how far the blur spreads. */
  glow: 9,
  glowBlur: 2.2,
  glowOpacity: 0.5,
  /** How far the glow swells and shrinks as it breathes, as a fraction of
   *  `glow`. 0.3 means it runs between 70% and 130% of its width. This is the
   *  strip's equivalent of a downlight halo scaling: the band gets fatter and
   *  thinner, never longer. */
  glowSwell: 0.3,

  /** The square end caps. Small: they mark the run's extent, they are not
   *  handles, and at grip size they were mistaken for handles. */
  cap: 3.4,

  /** Added to `stroke` and `glow` while the pointer is on the run. */
  hoverBoost: 0.6,
};

/**
 * THE POOL A FITTING THROWS ON THE FLOOR — the wash under a downlight, sized in
 * FEET rather than in line weights, because it is not a symbol.
 *
 * Everything in STRIP_STYLE above is a multiple of the sheet's line weight, for
 * the reason stated there: a symbol is drawn to be READ and has to look the same
 * on a 900px sketch and a 6000px survey. A throw is the opposite kind of mark.
 * It is a claim about the room — "this lamp covers this much floor" — so it is
 * given in feet and scaled by `pxPerFt`, and a 6-foot pool measures six feet
 * when somebody scales it off the drawing.
 *
 * WHICH FITTINGS GET ONE, AND HOW BIG: `diameterFtByWatt`, keyed on the STATED
 * wattage in the boq.js catalogue — not on a list of fixture ids. The catalogue
 * is the one place a wattage lives, and a 7 W lamp is a 7 W lamp whether it is
 * recessed in the ceiling (`small`) or clipped into a track (`track-ambient`).
 * Listing ids here would mean this file and the schedule could disagree about
 * what a 7 W fitting is, and the next fitting added at 7 W would silently miss
 * its throw.
 *
 * WHERE THE THREE DIAMETERS COME FROM. A beam angle is the full angle between
 * the two directions either side of the axis where intensity falls to HALF the
 * on-axis peak, so the pool it cuts on a plane is ordinary trigonometry:
 *
 *     diameter = 2 x (mounting height - target plane) x tan(beam / 2)
 *
 * From a 9 ft ceiling to the FLOOR, against the beam angles in the catalogue:
 *
 *      5 W   30 deg   4.8 ft  ->  5
 *      7 W   36 deg   5.8 ft  ->  6
 *     12 W   60 deg  10.4 ft  -> 10
 *
 * SO THEY ARE STATED AND NOT COMPUTED, for one reason: this app has no ceiling
 * height. `heightFt` everywhere in it is a room's PLAN DEPTH. The 9 ft is an
 * assumption baked into these three numbers, and it is written down here rather
 * than left implicit so that the day a ceiling height exists, this is the block
 * that gets deleted in favour of the formula above.
 *
 * AND IT IS THE FLOOR, NOT THE WORK PLANE. The same 36 deg beam measured to a
 * 2.5 ft counter covers 4.2 ft, not 5.8. These pools are floor coverage.
 *
 * THE 5 W ROW IS THE ROUGH ONE. It is read as 30 degrees, which is what `spot`,
 * `small-narrow` and `track-spot` are. `art-spot` is also 5 W but 24 deg — a
 * 3.8 ft pool — so it is drawn about a foot generous. Splitting the key on beam
 * angle rather than on wattage is the fix if that ever matters; wattage is what
 * was asked for.
 *
 * THE COLOUR IS THE BRAND ACCENT, and the stops are duplicated from
 * `--accent-stops` in styles.css rather than read from it. A CSS custom property
 * holding a `linear-gradient()` cannot fill an SVG shape — SVG needs a real
 * gradient element with real stops — so the two lists have to be kept in step by
 * hand. Change one, change the other.
 */
export const THROW_STYLE = {
  /**
   * Stated wattage -> the pool's DIAMETER in feet. A wattage absent from here
   * draws no pool at all, which is how a sconce and a strip opt out: the
   * catalogue leaves their wattage null on purpose, and a coverage claim for a
   * fitting whose wattage nobody will state is a claim nobody can check.
   */
  diameterFtByWatt: { 5: 5, 7: 6, 12: 10 },
  /** How strongly the wash reads over the plan beneath it. */
  opacity: 0.1,
  /**
   * THE SAME PAINT ON A TASK SURFACE, and stronger than the floor pools on
   * purpose. A pool is a claim about a large area of floor and has to stay out
   * of the plan's way; a lit surface is one discrete object — a counter, a desk,
   * a dining table — being called out as the thing a spot was placed FOR, and at
   * 0.1 over the plan's own line work it did not read as lit at all.
   */
  litSurfaceOpacity: 0.22,
  /**
   * The accent ramp, running OUTWARDS FROM THE LAMP. `at` is a fraction of the
   * pool's RADIUS — 0% is directly under the fitting, 100% is the rim — because
   * light falls off from its source, not across the sheet. Every pool is
   * therefore lit identically wherever on the plan it sits.
   *
   * This list is the brand accent as authored, and it mirrors about its middle:
   * dark, light, dark. Read outwards from a centre that draws a soft ring.
   * REVERSE IT for a centre-bright pool that fades to the accent's deepest tone
   * at the edge — that is the only change needed, here, and the drawing follows.
   */
  stops: [
    { at: '0%',   color: '#c2a987' },
    { at: '25%',  color: '#efd5b2' },
    { at: '50%',  color: '#fef1dd' },
    { at: '75%',  color: '#efd5b2' },
    { at: '100%', color: '#c2a987' },
  ],

  /**
   * THE SAME RAMP FOR A FITTING'S OWN BODY — brightest at the middle, falling
   * to the accent's deepest tone at the rim. What you see looking up at a lit
   * aperture, and it replaces the flat white the symbols used to be filled with.
   *
   * IT IS THE BRIGHT HALF OF `stops`, NOT A REVERSAL OF IT. Reversing a list
   * that already mirrors about its centre just produces the opposite mirror —
   * bright core, dark ring, bright rim — which is a target, not a lamp. So this
   * is the ramp read from its middle outwards: `stops`' 50% becomes 0% here, and
   * its 100% stays 100%. Monotonic, which is the whole requirement.
   *
   * THE MIDPOINT SITS AT 55% RATHER THAN 50%, and that is a drawing decision
   * rather than arithmetic. These are small marks — a downlight body is under a
   * foot across on a plan — and a bright core that gives up at the halfway line
   * reads as a grey dot at any sensible zoom. Widening it keeps the fitting
   * looking lit rather than smudged.
   *
   * KEEP IT MONOTONIC. Anything that brightens again on the way out puts a ring
   * in every fitting on the sheet, which is exactly the artefact `lp-lit` in
   * PlanCanvas exists to record.
   */
  coreStops: [
    { at: '0%',   color: '#fef1dd' },
    { at: '55%',  color: '#efd5b2' },
    { at: '100%', color: '#c2a987' },
  ],

  /**
   * THE RAMP WITH ITS NEAR-WHITE CORE TAKEN OUT — for a LINE that has to stay
   * visible from end to end.
   *
   * `stops` is a fill ramp and its middle is #fef1dd, which is four percent off
   * white. Painted into an area that is fine: the shape is read by its extent
   * and the pale middle is the highlight. Stroked onto a THIN LINE over a white
   * plan it is a hole — the room selection outline was drawn with `stops` and
   * simply disappeared along the middle of its top and bottom edges, which is
   * the one thing a selection marker must never do.
   *
   * So this is the same mirror between the ramp's two DEEPER tones. It still
   * grades, and it still returns to where it started so a closed outline has no
   * seam where it joins, but its lightest point is #efd5b2 and stays legible.
   *
   * USE THIS FOR ANY STROKE LONG ENOUGH TO HOLD A GRADIENT — a room outline, and
   * nothing else so far. Line work too thin to grade takes the single CORE_RIM
   * tone instead; see the note on it in PlanCanvas.
   */
  inkStops: [
    { at: '0%',   color: '#c2a987' },
    { at: '50%',  color: '#efd5b2' },
    { at: '100%', color: '#c2a987' },
  ],

  /**
   * THE RIM TONE FOR LINE WORK, stated rather than derived.
   *
   * It used to be read off the last entry of `coreStops`, on the reasoning that
   * a ring should continue the body's own edge outwards. That held while there
   * was one palette. With two it stops holding: on a white plan the body wants
   * to END at the brand amber and the ring round it has to be DARKER than that
   * to be an outline at all, so the two figures are no longer the same number
   * and pretending they are would flatten every fitting on a day-mode sheet.
   */
  rim: '#c2a987',

  /**
   * ---------------------------------------------------------------------
   * THE LIGHT-GROUND PALETTE — the same three ramps in amber.
   * ---------------------------------------------------------------------
   *
   * WHY THERE ARE TWO. Everything above is cream: #fef1dd through #c2a987, which
   * is right over the black page and over an inverted scan, and which is four
   * percent off white when the plan is a WHITE SCAN. In day mode the fittings
   * were pale marks on pale paper — legible in the sense that the pixels differ,
   * unreadable in the sense that matters.
   *
   * AMBER ONLY, AND THAT WAS THE INSTRUCTION'S OWN SUGGESTION: a ramp built from
   * one hue at three depths rather than a swap between a gradient and a flat
   * colour. It is also the easier thing to be right about — every id in the
   * canvas stays a gradient, so nothing that PAINTS with these has to know which
   * palette is in force. See the `RAMP` pick in PlanCanvas: the stops move, the
   * ids do not.
   *
   * THE DEPTHS RUN THE OTHER WAY ROUND FROM THE CREAM SET, and that is the whole
   * point rather than an inconsistency. On black, "bright" means light, so the
   * body's core is the palest tone. On white, light IS the ground — so the core
   * is the saturated brand amber and the rim goes deeper still, which is the
   * ordinary way a filled symbol is drawn on paper.
   *
   *   #ffe4a3   the lightest — a body's core, still clearly amber on white
   *   #ffc94d   the middle
   *   #ffb900   the brand accent, and where a body ENDS
   *   #cc8f00   deeper than any of them: line work, rings, arrows
   */
  day: {
    stops: [
      { at: '0%',   color: '#cc8f00' },
      { at: '25%',  color: '#ffb900' },
      { at: '50%',  color: '#ffe4a3' },
      { at: '75%',  color: '#ffb900' },
      { at: '100%', color: '#cc8f00' },
    ],
    coreStops: [
      { at: '0%',   color: '#ffe4a3' },
      { at: '55%',  color: '#ffc94d' },
      { at: '100%', color: '#ffb900' },
    ],
    inkStops: [
      { at: '0%',   color: '#cc8f00' },
      { at: '50%',  color: '#ffb900' },
      { at: '100%', color: '#cc8f00' },
    ],
    rim: '#cc8f00',
  },
};

/**
 * THE GLINT ROUND A SELECTED ROOM — a short bright arc that runs the outline
 * once when you pick a space, the way a highlight travels across something as
 * it catches the light.
 *
 * EVERY KNOB IS HERE, which is the point of the block. The effect is split
 * across two files by necessity — the geometry is measured in PlanCanvas off the
 * room's own polygon, the animation runs in styles.css — and the first version
 * had the duration in the stylesheet and the arc length in the component, so
 * tuning it meant editing both and guessing which one owned what. Now the
 * component reads these values and hands the timing to CSS as inline animation
 * properties, exactly the way STRIP_STYLE hands over the strips' breath.
 *
 * `ms` IS ONE FULL LAP, not a fade. It is the time the arc takes to travel the
 * whole perimeter, so a big room and a small one both take this long and the
 * glint reads as the same gesture on either — which is why it is a duration and
 * not a speed.
 */
export const GLINT_STYLE = {
  /** One lap, in milliseconds. 1000 read as a twitch; this is a sweep. */
  ms: 2200,

  /**
    * SYMMETRIC, AND THAT IS THE FIX FOR "TOO QUICK". The first curve here was
    * `cubic-bezier(.33,.08,.24,1)`, which front-loads badly: measured in the
    * browser it covered 79% of the perimeter in the first HALF of its run, so
    * the arc darted away and then crawled home. Lengthening `ms` does not help
    * that — it stretches the crawl and leaves the dart — because what read as
    * quick was the acceleration, not the duration.
    * ease-in-out puts the halfway point at halfway: it leaves gently, holds an
    * even pace down the long walls and settles into the corner it started from.
    * `linear` is the honest alternative and reads mechanical.
    */
  ease: 'cubic-bezier(.42,0,.58,1)',

  /** How many laps. 1 is a glint. 2 starts to look like a loading spinner, and
   *  `infinite` is a marquee — the outline underneath is what actually marks the
   *  selection, so this only ever has to say "you just picked this one". */
  laps: 1,

  /** The travelling arc's LENGTH, as a fraction of the room's perimeter. 0.14
   *  is about a seventh of the way round: long enough to read as a sweep of
   *  light rather than a dot, short enough that you can see it move. */
  arc: 0.14,

  /** Its width, in the sheet's line weights — like everything else drawn as a
   *  symbol. Twice the outline's 1.6 so it reads as sitting ON the outline. */
  weight: 3.2,

  /**
   * The arc's colour, DERIVED from the accent ramp's brightest stop rather than
   * typed again — a glint is a highlight, so it should be the lightest thing the
   * accent has, and if that stop is ever retuned this follows it.
   *
   * It is a knob anyway because it is the one value here that might legitimately
   * want to leave the ramp: #fef1dd is four percent off white, so on a pale scan
   * the arc is carried almost entirely by its MOTION. That is the intent — a
   * glint you can see parked is a highlight that has outstayed its welcome — but
   * if it needs to read harder, this is the line to change.
   */
  color: THROW_STYLE.coreStops[0].color,
};

/**
 * THE DESIGN OPTIONS PICKER — the pill that names what a piece of ceiling is and
 * flips it through what else it could be.
 *
 * IT IS A CONTROL, NOT A FITTING, and that is why it gets a block of its own
 * rather than riding on THROW_STYLE like everything else warm on the sheet. The
 * pools, the strips, the rails and the fitting bodies are all the same claim —
 * "this is lighting" — and they share one ramp so they cannot drift apart. The
 * pill is a different kind of thing: it is a button, it sits ON the drawing
 * rather than being part of it, and it is the one warm mark somebody is meant to
 * reach for. So it is allowed its own colour, and now has one.
 *
 * WHITE, WITH AN ACCENT EDGE. A white chip reads as a control at a glance where
 * a gradient-filled one read as another piece of the drawing — which it was,
 * because it was painted from the drawing's own ramp. The edge is what keeps it
 * from vanishing: this app's plans are white, and an unstroked white pill on a
 * white sheet is a floating word.
 *
 * THE INK IS BLACK AND HAS TO STAY LEGIBLE ON `fill`. That coupling is the one
 * trap in here. The label was white back when the pill was amber, and white on
 * the accent ramp was invisible; black on white is the current pairing. Push
 * `fill` dark and the ink has to come back up in the SAME edit, or the pill goes
 * blank.
 */
const RAMP_RIM = THROW_STYLE.coreStops[THROW_STYLE.coreStops.length - 1].color;

export const PILL_STYLE = {
  /** The body. A flat CSS colour — see `stops` to make it a ramp instead. */
  fill: '#FFFFFF',

  /**
   * A ramp along the pill's length INSTEAD of the flat `fill`, as {at,color}
   * stops. `null` keeps it flat, which is the default.
   *
   * Set it to `THROW_STYLE.stops` to get back the gradient pill this replaced.
   * When it is set the fill is drawn from ONE gradient spanning the whole
   * control, so the arrow ends and the body cannot show a seam between them.
   */
  stops: null,

  /** The edge, and the whole reason a white pill is visible. */
  edge: RAMP_RIM,
  /** Its weight, in the sheet's line weights. */
  edgeWeight: 1.4,

  /** The label and the two arrow glyphs. Must contrast with `fill`. */
  ink: '#000000',
  /** The arrows a touch back from the label — they are the quieter half. */
  arrowInk: 0.85,

  /**
   * THE DASHED RECTANGLE BEHIND IT — which piece of ceiling the pill is talking
   * about. A separate mark from the pill, and deliberately still on the accent:
   * it belongs to the DRAWING (it says where the design lands), where the pill
   * belongs to the interface. It is here because they are one widget to tune.
   */
  region: {
    fill: RAMP_RIM,
    fillOpacity: 0.045,
    edge: RAMP_RIM,
    weight: 1.8,
    /** Applied to the whole rectangle, edge included. */
    opacity: 0.7,
  },
};

/**
 * THE 8" REVERSE COVE BAND — the slot formed in the ceiling at a wall, with the
 * tape at its inner lip washing the wall below.
 *
 * IT IS A BAND AND NOT A LINE, which is the whole reason it has a style block:
 * eight inches is the specification, so the mark is a filled rectangle with a
 * dimension you can scale off, where every other accent on this sheet is a run.
 * A COMPLETE FILL, transparent enough that the plan's own line work reads
 * through it — the wall, the door jamb, whatever the slot is set out against are
 * the edges it gets dimensioned from, and a solid band would hide them.
 *
 * THE RAMP RUNS ALONG THE BAND, not across it. Same reasoning as the strips and
 * the track rails: this is linear product, billed by the metre, so the gradient
 * follows its length. Across the 8 inches it would grade over about a fingernail
 * of drawing and read as a flat tone with a dirty edge.
 */
export const COVE_BAND_STYLE = {
  /** How much of the plan shows through the band. */
  fillOpacity: 0.30,
  /** The band's own outline — the extent of the slot. */
  edgeOpacity: 0.55,
  /**
   * THE INNER LIP, drawn heavier than the rest of the outline because it is the
   * edge that gets SET OUT: the wall side of the band is the wall, and this is
   * the line a builder measures to. Weight is in the sheet's line weights.
   */
  lipWeight: 1.8,
  lipOpacity: 0.9,
};
