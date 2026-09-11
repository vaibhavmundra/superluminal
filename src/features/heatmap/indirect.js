// ---------------------------------------------------------------------------
// indirect.js — REFLECTED AMBIENT LIGHT. Probes in the room's volume, and the
// one measurement this whole layer is defined by.
//
// THE QUESTION IT ANSWERS, IN ONE SENTENCE: how much light reaches this
// location from the room's surfaces, after one or more reflections. Not how
// much lands on the floor, and not how much a fitting throws at it — the
// direct beam is excluded entirely, from every family, however broad.
//
// --- THE MEASUREMENT, STATED ONCE AND STATED HERE --------------------------
//
//     E_mean_spherical_indirect(p)  =  1/4 * INTEGRAL L_indirect(p, w) dw
//
// MEAN SPHERICAL ILLUMINANCE: the average illuminance over the surface of an
// infinitesimal imaginary sphere at the point, which is the quantity that
// describes how much light is arriving from ALL directions rather than onto
// one plane. `L_indirect` counts only paths that have reflected from at least
// one room surface. Directions are weighted by SOLID ANGLE and by nothing else
// — see MEAN_SPHERICAL_FACTOR in reflection.js for where the quarter comes
// from, and `buildSphereTransfer` for the arithmetic.
//
// WHAT IT IS DELIBERATELY NOT, because each of these is a plausible thing to
// mistake it for and each would read differently on the drawing:
//
//   NOT HORIZONTAL LUX. That is the other layer. A horizontal receiver weights
//   every direction by the cosine of its angle from vertical, so light arriving
//   from a washed wall barely counts; a sphere has no orientation and counts it
//   in full. This is the whole reason the layer exists.
//
//   NOT AN UNWEIGHTED SUM OF DIRECTIONAL SAMPLES. A sum over sample directions
//   with no solid angle in it is a number whose value depends on how many
//   samples were taken. Nothing here samples directions at all: the room's
//   surfaces ARE the directions, each carrying its own solid angle.
//
//   NOT SCALAR ILLUMINANCE UNDER A DIFFERENT NORMALISATION. "Scalar
//   illuminance" is the same integral, and the literature carries it with a
//   1/4 and occasionally with a 1/(4 pi) against luminance in different units.
//   One convention, written above, used by the engine and by the targets, and
//   checked against an analytical case — see `uniformExitanceReference` below
//   and tools/test-heatmap-indirect.mjs.
//
// --- HOW THE EXCLUSION OF DIRECT LIGHT IS EXACT ----------------------------
// IT IS NOT A FILTER, IT IS THE VECTOR. `surfacePass` in solve.js produces
// `exitance` — the lumens each surface hands back — and a lumen only enters
// that vector by LEAVING a surface, because the first bounce is `incident *
// rho`. So gathering exitance and nothing else is, by construction, gathering
// only paths with at least one reflection. There is no fixture family to
// special-case and no beam width to test: a COB, a cove, a panel and a
// chandelier are all excluded on the same terms, which is what "filter by
// light path, not by category" means in code.
//
// AND THE PROBES ARE NOT A SURFACE. They appear in no patch set, they are in
// no transfer matrix's source list, and nothing bounces off them. They are
// where the answer is read, and reading it changes nothing.
//
// PURE. No React, no canvas, no document.
// ---------------------------------------------------------------------------

import { buildSphereTransfer, gather } from './reflection.js';
import { AVERAGE_FLOOR_SHARE } from './heatmapTargets.js';

/**
 * WHERE THE PROBES SIT, IN MILLIMETRES ABOVE THE FLOOR.
 *
 * 1200 IS A CHOICE AND NOT A STANDARD, and saying so is the point of this
 * comment. It is roughly the height of a seated eye and of the middle of a
 * standing body, which is where "how bright does this room feel" is actually
 * asked. It is not quoted from a code.
 *
 * --- AND IT IS FIXED, WHICH IS A DECISION RATHER THAN A LIMITATION --------
 * THERE WAS A THREE-CHIP HEIGHT CONTROL IN THE LEGEND (`PROBE_HEIGHTS_MM`,
 * 800 / 1200 / 1700) AND IT IS GONE. A measurement height is a question about
 * photometric convention, and asking it of somebody laying out lights buys
 * them a decision they have no basis to make and a card three rows taller.
 * The engine never cared: `solveIndirect` takes a `probeZ` like it always did,
 * `probeHeightFor` still clamps it per room, and the whole of "make it
 * adjustable again" is a control that writes a different number here.
 *
 * READ ONCE, BY useHeatmap. Nothing else in the feature knows the figure.
 */
export const PROBE_HEIGHT_MM = 1200;

/**
 * HOW FAR BELOW THE SLAB A PROBE IS KEPT, in metres.
 *
 * A ROOM SHALLOWER THAN THE REQUESTED HEIGHT IS A REAL CASE AND NOT A DATA
 * FAULT: a plan holds a dropped ceiling section, a loft, a service void, and a
 * 1.2 m probe in a 1.0 m volume is a probe in the slab. Refusing to draw those
 * rooms would leave holes in the sheet; drawing them at the requested height
 * would put a measurement point outside the room it claims to measure. So the
 * height is CLAMPED into the volume and the effective figure rides on the
 * result, which is what lets the legend say what it actually measured.
 *
 * 300 mm IS ENOUGH TO BE IN THE ROOM. A probe closer than that to a metre-wide
 * ceiling patch is inside the patch's own near field, where a point-to-patch
 * form factor stops meaning very much — `soften` keeps it finite and the
 * column closure keeps it honest, but the reading stops being about the room
 * and starts being about the tile above it.
 */
export const PROBE_CLEARANCE_M = 0.3;

/**
 * THE PROBE HEIGHT THIS ROOM ACTUALLY GETS, in metres above its floor.
 *
 * `null` FOR A ROOM WITH NO HEIGHT AT ALL, which the caller drops — there is no
 * volume to put a probe in and no honest figure to invent.
 *
 * AND THE CEILING NEVER PUSHES A PROBE BELOW THE MIDDLE OF THE ROOM. In a
 * 500 mm void `height - clearance` is 200 mm, which is nearer the floor than
 * the slab and is a worse answer than the obvious one; in a 200 mm one it is
 * negative and would put the probe under the floor. Halfway up is the point in
 * any volume that is unambiguously inside it, so it is the floor of the clamp
 * rather than a separate case — which also keeps this one expression.
 *
 * THE REQUEST STILL WINS WHERE IT FITS. A reader asking for 0.8 m in a 2.7 m
 * room gets 0.8 m and not 1.35: the mid-height is a floor on how far the
 * CEILING may push the probe down, not a floor on the reader's own choice.
 */
export function probeHeightFor(requestedM, roomHeightM) {
  const h = Number(roomHeightM);
  if (!(h > 0)) return null;
  const want = Math.max(0, Number(requestedM) || 0);
  return Math.min(want, Math.max(h - PROBE_CLEARANCE_M, h / 2));
}

/** Was this room's probe height pulled down to fit? The legend says so rather
 *  than quietly printing a height nobody asked for. */
export const probeWasClamped = (requestedM, effectiveM) =>
  Number.isFinite(effectiveM) && effectiveM < (Number(requestedM) || 0) - 1e-9;

/**
 * THE ANALYTICAL REFERENCE THE NORMALISATION IS CHECKED AGAINST.
 *
 * A CLOSED ROOM WHOSE EVERY SURFACE HAS UNIFORM EXITANCE M lm/m^2 HAS MEAN
 * SPHERICAL ILLUMINANCE EXACTLY M AT EVERY POINT INSIDE IT. The derivation is
 * three lines and is worth having here rather than in a test: a Lambertian
 * surface of exitance M has luminance M/pi in every direction, so L is M/pi
 * everywhere on the enclosure; the integral of d omega over all directions from
 * an interior point is 4 pi, because the enclosure is closed; so
 * 1/4 * (M/pi) * 4 pi = M.
 *
 * IT PINS THE WHOLE CONVENTION IN ONE NUMBER — the quarter, the Lambertian pi,
 * and the closure of the solid angles. Get any of the three wrong and this
 * comes out wrong by a clean factor. tools/test-heatmap-indirect.mjs runs it
 * against the real patch set of a real room.
 *
 * Takes the exitance in LUMENS PER PATCH, which is the engine's own unit, and
 * hands back the uniform lm/m^2 it corresponds to — or null where the surfaces
 * are not in fact uniform, which is every real room and is why this is a
 * reference rather than a shortcut.
 */
export function uniformExitanceReference(patches, exitance, tol = 1e-6) {
  const n = patches?.n ?? 0;
  if (!n) return null;
  let m0 = null;
  for (let p = 0; p < n; p++) {
    const m = exitance[p] / patches.area[p];
    if (m0 == null) { m0 = m; continue; }
    if (Math.abs(m - m0) > tol * Math.max(1, Math.abs(m0))) return null;
  }
  return m0;
}

/**
 * THE PROBE FIELD FOR ONE ROOM — reflected mean spherical illuminance, in lux,
 * one figure per live cell of the field grid.
 *
 * `surface` IS A `surfacePass` RESULT AND IS NOT RECOMPUTED HERE. That is the
 * whole architecture of this layer in one parameter: the light transport
 * belongs to the room and its fittings, this file only chooses where to read
 * it. Passing a cached one is what makes a height change cost a matrix.
 *
 * `S` IS THE ONLY THING THAT DEPENDS ON THE HEIGHT, so it is built here and
 * cached by the caller against the height it was built for — see useHeatmap.js.
 * It may also be handed in, for the same reason `surface` may be.
 *
 * THE GRID IS THE EXISTING FIELD GRID AND ITS CELLS ARE THE PROBE POSITIONS,
 * lifted to `probeZ`. That is deliberate rather than convenient: it is already
 * the 25-50 cm horizontal grid the brief asks for, it is already clipped to the
 * outline, and using it is what puts the two layers in exact register so that
 * switching between them compares like with like. What the overlay draws is
 * still a plan — the probes are at height and the drawing says so in the
 * legend, because a floor plan has nowhere else to put them.
 *
 * THE CELL COVERAGE WEIGHTS ARE USED FOR THE MEAN AND NOT FOR THE VALUES. A
 * cell at the wall is part floor and part wall in plan, so its share of any
 * average over the room is that fraction — the same argument `solveRoom` makes.
 * The probe itself is a point and is whole wherever it is.
 */
export function solveIndirect(geometry, surface, { probeZ = 0, S = null } = {}) {
  const { field, patches, poly, convex } = geometry;
  const m = field.count;
  const transfer = S ?? buildSphereTransfer(patches, field, poly, { convex, probeZ });
  const sphere = gather(surface.exitance, transfer, m);

  const w = field.weight;
  let sum = 0, wsum = 0, min = Infinity, max = 0;
  for (let g = 0; g < m; g++) {
    sum += sphere[g] * w[g]; wsum += w[g];
    if (sphere[g] < min) min = sphere[g];
    if (sphere[g] > max) max = sphere[g];
  }
  return {
    field, sphere, probeZ, S: transfer,
    mean: wsum > 0 ? sum / wsum : 0, min: m ? min : 0, max,
    /* THE SAME ACCOUNTING THE HORIZONTAL SOLVE CARRIES, so the two layers can
       be compared on what they were made of. `emitted` is what the fittings put
       out; `onSurfaces` is what reached a surface; the difference between
       either of those and this field is exactly the direct light this layer
       excludes, which is a thing worth being able to check. */
    emitted: surface.emitted, onSurfaces: surface.onSurfaces,
    bounces: surface.bounces, carried: surface.carried,
  };
}


/**
 * AVERAGE — the reflected ambient at the probe, plus a quarter of the
 * horizontal illuminance on the floor beneath it.
 *
 *     E_average(p)  =  E_mean_spherical_indirect(p)  +  1/4 * E_horizontal(floor)
 *
 * THE QUARTER COMES FROM heatmapTargets.js AND NOT FROM HERE, and the import
 * direction is the point rather than an accident. It is physically
 * `MEAN_SPHERICAL_FACTOR` — a sphere reads a quarter of the normal illuminance
 * of any beam it sits in, so a quarter of a horizontal lux figure is the mean
 * spherical illuminance a sphere would read if all of that light came from
 * straight overhead — but it is ALSO half of the definition of the layer's
 * TARGET, and the target is config. Two copies of it is two places to edit and
 * one of them will be missed: that already happened once, and the symptom was
 * a layer whose value carried a term its target had never heard of, so every
 * room read over target by a quarter of its horizontal figure. One constant,
 * read by the value here and by `heatmapTargetForLayer` there.
 *
 * IT IS A BLEND AND NOT A BETTER PHYSICS. The horizontal term already contains
 * the reflected light that reached the floor, so that light is counted twice —
 * once as it actually arrives at the probe, and once as a quarter of what
 * lands underneath it. That is what the definition asks for: a picture that
 * puts the fitting back into a reading the reflected layer deliberately leaves
 * out. It is not a total mean spherical illuminance and must not be presented
 * as one. THE TARGET IS BLENDED THE SAME WAY, so the double count is in both
 * halves of the ratio and the colour still means what the legend says.
 *
 * AND IT COSTS TWO GATHERS AND AN ADD. Both terms come off the SAME surface
 * pass — `total` from the plane transfer, `sphere` from the probe transfer —
 * so nothing here re-runs the light transport, and computing this layer leaves
 * both of its components warm in the cache for the reader who switches to one
 * of them next. See `solveRoomLayer` in useHeatmap.js.
 */
export function solveAverage(field, { sphere, total }) {
  const m = field.count;
  const value = new Float64Array(m);
  for (let g = 0; g < m; g++) value[g] = sphere[g] + AVERAGE_FLOOR_SHARE * total[g];

  /* THE MEAN IS AREA-WEIGHTED for `solveRoom`'s reason: a cell at the wall is
     part floor and part wall in plan, so its share of any average over the
     room is that fraction. The min and the max are not, because they are not
     averages. */
  const w = field.weight;
  let sum = 0, wsum = 0, min = Infinity, max = 0;
  for (let g = 0; g < m; g++) {
    sum += value[g] * w[g]; wsum += w[g];
    if (value[g] < min) min = value[g];
    if (value[g] > max) max = value[g];
  }
  return { field, value, mean: wsum > 0 ? sum / wsum : 0, min: m ? min : 0, max };
}
