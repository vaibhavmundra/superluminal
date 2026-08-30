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
 */
export const LUMEN_CRITERIA = {
  residential: 20,
  hotel: 20,        // hospitality
  restaurant: 20,   // hospitality
  office: 50,       // commercial
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
