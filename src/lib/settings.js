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
export const FAN_DETECT = { redSat: 0.30, link: 8 };

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
