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
