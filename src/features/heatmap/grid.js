// ---------------------------------------------------------------------------
// grid.js — THE GEOMETRY THE SOLVER RUNS ON. Two grids and a set of patches.
//
// EVERYTHING HERE IS IN METRES AND THE CONVERSION HAPPENS ONCE. The drawing is
// held in plan pixels and the app's own dimensions are in feet; a photometric
// calculation is in metres or it is in nothing, because an inverse-square law
// with feet in the denominator produces lux that are out by 10.76. So the
// adapter multiplies by `metresPerPx` on the way in and this file never sees
// another unit.
//
// THE TWO GRIDS ARE NOT THE SAME GRID AND THAT IS THE POINT:
//
//   THE FIELD GRID is what gets coloured. 25-50 cm cells, one figure per cell,
//   and that figure is the AVERAGE over the cell rather than a reading at its
//   centre — nine points inside it, and the ones that fall outside the outline
//   dropped, so a cell at the wall reports the part of it that is floor and
//   counts for that fraction in any average. See FIELD_SUBSAMPLES, which
//   carries the whole argument: it is what makes the resolution unable to change
//   the brightness, which one sample at the centre could not manage.
//
//   THE PATCH SET is what the reflections run on. Every surface of the room —
//   floor, ceiling and each wall — tiled into patches about a metre across, each
//   with an area, a normal and its own reflectance. It is coarse on purpose:
//   interreflected light is smooth by nature, the transfer between patches costs
//   the square of their number, and a metre is finer than any feature diffuse
//   light has.
//
// PURE. No React, no canvas, no document.
// ---------------------------------------------------------------------------

import { bbox, pointInPolygon, polygonArea } from '../../lib/geometry.js';
import { SURFACE_REFLECTANCE } from '../../lib/lumens.js';
import { toneOf } from '../../lib/materials.js';

/** Feet to metres. The one conversion factor in the feature. */
export const M_PER_FT = 0.3048;

/* --- HOW COARSE EACH THING IS ---------------------------------------------
   TWO SETS OF FIGURES, because a heatmap has two audiences: the hand that is
   dragging a fitting and the eye that has stopped to read the answer. `fine` is
   the answer; `coarse` is what is drawn while something is moving, and it is
   the same solver at half the resolution — see useHeatmap.js.

   THE FIELD STEP IS INSIDE THE 25-50 cm THE BRIEF ASKS FOR. 0.35 m is about 14
   inches: fine enough that a 600 mm downlight pool has three cells across it,
   coarse enough that a 40 sqm room is 330 cells rather than 1,300. */
export const HEATMAP_RESOLUTION = {
  fine: { fieldM: 0.35, patchM: 0.9, wallBandM: 0.9 },
  /* --- THE COARSE PASS COARSENS THE FIELD AND NOT THE PATCHES -------------
     IT COARSENED BOTH AT FIRST, AND THAT WAS THE WRONG SAVING. Metre-and-a-half
     patches moved the answer by about a tenth — so letting go of a dragged
     fitting made every colour in the room shift, which reads as the tool
     changing its mind rather than as a preview sharpening. A preview that does
     not agree with the answer is worse than no preview.
     AND THE SAVING WAS IN THE WRONG PLACE ANYWAY. The bounce is a walk down a
     patch-by-patch matrix that is CACHED against the room's geometry — a drag
     does not rebuild it, so its size costs a drag nothing. What a drag pays for
     is the direct pass, which is every source against every FIELD CELL, and
     that is what halving the field step quarters. Same physics, a quarter of
     the per-frame work, and the colours barely move when the fine pass lands. */
  coarse: { fieldM: 0.7, patchM: 0.9, wallBandM: 0.9 },
};

/**
 * HOW MANY POINTS INSIDE ONE CELL THE DIRECT PASS SAMPLES, PER AXIS.
 *
 * A CENTRE SAMPLE WAS NOT ENOUGH, AND IT FAILED IN TWO SEPARATE WAYS. The brief
 * allows one to start with and says to refine where necessary; this is where.
 *
 *   THE FIELD IS PEAKED. A cell is supposed to hold the AVERAGE illuminance over
 *   its own patch of floor, and a downlight's direct contribution is the most
 *   peaked thing in the model — a 36-degree optic at 2.7 m is 290 lux under the
 *   lamp and a third of that a metre away. Sampled once, whether a cell lands
 *   on a lamp or between two of them changes its value by a factor of three.
 *
 *   AND A CELL AT THE WALL IS NOT ALL FLOOR. A grid is grown out to whole cells,
 *   so the ones at the edge hang over the outline — by a different amount at
 *   every step. Counting each of them as a whole cell of floor at its centre's
 *   value made the room's mean a function of how the outline happened to fall
 *   across the grid, which moved the answer by a tenth between the two
 *   resolutions. That is the one thing the brief forbids outright.
 *
 * THREE BY THREE FIXES BOTH. Nine points on the cell's own thirds is the
 * midpoint rule in two dimensions AND a coverage estimate: the ones that fall
 * outside the outline are dropped, so a boundary cell reports the average over
 * the part of it that is actually floor and counts for that fraction of a cell
 * in any average over the room. The two resolutions then agree to a per cent.
 * The inside test is done ONCE, when the grid is built, and not per source.
 *
 * THE REFLECTED HALF IS DELIBERATELY LEFT AT ONE SAMPLE. It arrives through the
 * plane transfer matrix, which is `patches x cells` and cached; supersampling it
 * would multiply the biggest array in the feature ninefold to smooth something
 * that is already smooth.
 */
export const FIELD_SUBSAMPLES = 3;

/** How many cells one room may cost, at most. A whole-floor plan can hold a
 *  400 sqft hall and a 9,000 sqft site plan traced by mistake, and a field grid
 *  is O(cells) while the reflections are O(patches^2) — so the guard is a real
 *  one rather than defensive decoration. A room over the cap is stepped coarser
 *  until it fits, which degrades the picture rather than the app. */
export const MAX_FIELD_CELLS = 4000;
/* SIX HUNDRED PATCHES IS A 1.4 MB TRANSFER MATRIX, and the matrix is the reason
   for the cap: it is patches SQUARED, cached per room, and a plan can hold eight
   of them. A room that would need more is tiled coarser, which softens the
   reflected half of a very large space and leaves the direct half untouched. */
export const MAX_PATCHES = 600;

/**
 * THE FIELD GRID FOR ONE ROOM.
 *
 * ONLY THE CELLS WHOSE CENTRE IS INSIDE THE OUTLINE, and each of those carries
 * the sub-sample mask and the coverage weight the solver needs — see
 * FIELD_SUBSAMPLES. The grid is grown out to WHOLE cells, so it overhangs the
 * outline; the overlay is clipped to the polygon rather than drawn to the grid's
 * own edge, and the weights are what keep the overhang out of any average.
 *
 * `step` MAY COME BACK COARSER THAN ASKED. A room that would cost more than
 * MAX_FIELD_CELLS is stepped up until it does not, and the step it was actually
 * given rides on the result — nothing downstream may assume the figure it
 * requested.
 */
export function buildFieldGrid(polygonM, step) {
  const poly = polygonM ?? [];
  if (poly.length < 3 || !(step > 0)) return null;
  const b = bbox(poly);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  if (!(w > 0) || !(h > 0)) return null;

  /* STEP UP UNTIL IT FITS, RATHER THAN CLAMPING THE COUNT. Capping nx and ny
     would stretch the cells into rectangles on a long room and put the samples
     somewhere other than where the overlay says they are; growing the step
     keeps them square and keeps the picture true, coarser. */
  let s = step;
  while (Math.ceil(w / s) * Math.ceil(h / s) > MAX_FIELD_CELLS) s *= 1.25;

  const nx = Math.max(1, Math.ceil(w / s));
  const ny = Math.max(1, Math.ceil(h / s));
  const xs = new Float64Array(nx), ys = new Float64Array(ny);
  for (let i = 0; i < nx; i++) xs[i] = b.minX + (i + 0.5) * s;
  for (let j = 0; j < ny; j++) ys[j] = b.minY + (j + 0.5) * s;

  const inside = new Uint8Array(nx * ny);
  let n = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (pointInPolygon({ x: xs[i], y: ys[j] }, poly)) { inside[j * nx + i] = 1; n++; }
    }
  }
  /* --- ...AND THE SAME CELLS AGAIN AS A FLAT LIST OF THE LIVE ONES ---------
     TWO VIEWS OF ONE GRID, AND BOTH ARE NEEDED. `inside` over `nx * ny` is what
     the OVERLAY wants: it paints a rectangle of pixels and has to know which of
     them are in the room. The solver wants the opposite — it iterates the cells
     that exist, in a tight loop, and stepping over the dead ones inside a
     matrix multiply is a branch per patch per cell for no answer.
     `at` MAPS THE COMPACT INDEX BACK, so the overlay can read the field. It is
     the one link between the two and it is built here rather than derived twice.
     `radius` IS A CELL'S EQUIVALENT DISC, for `soften` — the same figure a patch
     carries and for the same reason. */
  const cx = new Float64Array(n), cy = new Float64Array(n);
  const at = new Int32Array(n);
  let k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!inside[j * nx + i]) continue;
      cx[k] = xs[i]; cy[k] = ys[j]; at[k] = j * nx + i; k++;
    }
  }
  /* THE SUB-SAMPLE OFFSETS, FROM THE STEP THIS GRID ACTUALLY GOT. Held on the
     grid rather than recomputed in the solver because the solver would have to
     ask the grid for its step to derive them, and two places deriving one set of
     offsets is two places that can disagree about where a cell was sampled. */
  const sub = FIELD_SUBSAMPLES;
  const subs = [];
  for (let j = 0; j < sub; j++) {
    for (let i = 0; i < sub; i++) {
      subs.push([((i + 0.5) / sub - 0.5) * s, ((j + 0.5) / sub - 0.5) * s]);
    }
  }
  /* --- WHICH SUB-SAMPLES ARE ACTUALLY ON THE FLOOR ------------------------
     ONCE, HERE, AND NOT PER SOURCE. It is a `pointInPolygon` per sub-sample per
     cell — nine tests a cell — and the answer depends only on the outline, so
     paying for it inside the direct pass would be paying for it once per
     fitting. `subMask` is the flat answer, `subN` the count and `weight` the
     fraction of the cell that is floor, which is what any average over the room
     has to weight by. See FIELD_SUBSAMPLES.
     A CELL WITH NO SUB-SAMPLE INSIDE KEEPS ITS CENTRE, which is a real case on a
     sliver of a traced outline: the centre is inside by construction — that is
     how the cell got into this list — so falling back to it is the one answer
     that cannot be empty. */
  const nSub = subs.length;
  const subMask = new Uint8Array(n * nSub);
  const subN = new Int32Array(n);
  const weight = new Float64Array(n);
  for (let g = 0; g < n; g++) {
    let c = 0;
    for (let u = 0; u < nSub; u++) {
      if (pointInPolygon({ x: cx[g] + subs[u][0], y: cy[g] + subs[u][1] }, poly)) {
        subMask[g * nSub + u] = 1; c++;
      }
    }
    subN[g] = c;
    weight[g] = c > 0 ? c / nSub : 1;
  }
  return {
    nx, ny, step: s, xs, ys, inside, count: n, cx, cy, at,
    subs, nSub, subMask, subN, weight,
    // THE BOX THE GRID ACTUALLY COVERS, which is the bbox grown out to whole
    // cells. The overlay maps its image onto exactly this, so a cell centre on
    // screen is the point that was sampled.
    x0: b.minX, y0: b.minY, x1: b.minX + nx * s, y1: b.minY + ny * s,
    cellArea: s * s,
    // WHICH PLANE THIS IS. Zero is the floor — see HEATMAP_PLANE — and it is a
    // field on the grid rather than a constant in the solver so that a working
    // plane is a different grid rather than a different solver.
    planeZ: 0,
  };
}

/**
 * EVERY SURFACE OF THE ROOM, TILED — what the reflections bounce off.
 *
 * ONE LIST AND NOT THREE, because the transfer between patches does not care
 * which surface a patch belongs to: a form factor is a form factor, and keeping
 * floor, ceiling and walls in one array is what makes the bounce a single
 * matrix-vector product. `kind` rides along for the two callers that do care —
 * the floor patches are the ones whose reflected light must not be counted onto
 * the floor plane, and the walls are the ones that carry a per-edge reflectance.
 *
 * COPLANAR PAIRS NEED NO SPECIAL CASE, and that is worth knowing rather than
 * discovering: the transfer is proportional to the cosine at each end, and two
 * patches on the same plane see each other edge-on, so the cosine is zero and
 * the term vanishes on its own. Floor to floor, ceiling to ceiling and two
 * patches on one wall all fall out for free.
 *
 * `rho` IS LOCAL, WHICH IS THE WHOLE REASON THE WALLS ARE PER EDGE. A room with
 * one dark accent wall is not a room with a slightly darker average: the cove
 * over that wall gives back a fifth of what the same cove gives back over
 * emulsion, and an averaged reflectance cannot say so. The tones come from the
 * same SURFACE_REFLECTANCE table lib/lumens.js reads, so the two models cannot
 * disagree about what a dark wall is.
 */
export function buildPatches(polygonM, heightM, materials, opt = {}) {
  const poly = polygonM ?? [];
  if (poly.length < 3 || !(heightM > 0)) return null;
  const step0 = opt.patchM ?? HEATMAP_RESOLUTION.fine.patchM;
  const band0 = opt.wallBandM ?? step0;

  const b = bbox(poly);
  const walls = materials?.walls ?? {};
  const rhoFloor = SURFACE_REFLECTANCE.floor[toneOf(materials?.floor)];
  const rhoCeil = SURFACE_REFLECTANCE.ceiling[toneOf(materials?.ceiling)];

  /* ONE STEP FOR EVERY SURFACE, GROWN UNTIL THE WHOLE SET FITS. The bounce is
     O(patches^2), so the guard has to be on the total rather than per surface —
     a long thin room is mostly wall and would sail past a floor-only check. */
  let step = step0, band = band0, patches = null;
  for (let tries = 0; tries < 12; tries++) {
    patches = tilePatches(poly, b, heightM, step, band, walls, rhoFloor, rhoCeil);
    if (patches.length <= MAX_PATCHES) break;
    step *= 1.3; band *= 1.3;
  }

  const p = patches;
  const n = p.length;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const nx = new Float64Array(n), ny = new Float64Array(n), nz = new Float64Array(n);
  const area = new Float64Array(n), rho = new Float64Array(n);
  const kind = new Uint8Array(n);        // 0 floor, 1 ceiling, 2 wall
  const radius = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = p[i];
    px[i] = q.p.x; py[i] = q.p.y; pz[i] = q.p.z;
    nx[i] = q.n.x; ny[i] = q.n.y; nz[i] = q.n.z;
    area[i] = q.area; rho[i] = q.rho;
    kind[i] = q.kind === 'floor' ? 0 : q.kind === 'ceiling' ? 1 : 2;
    // THE PATCH'S OWN HALF-SIZE, as the radius of the disc of the same area.
    // It is what softens the inverse square when a source sits closer to a
    // patch than the patch is wide — see `soften` in photometry.js — and it is
    // stored rather than recomputed because the transfer matrix asks for it
    // O(n^2) times.
    radius[i] = Math.sqrt(q.area / Math.PI);
  }
  return { n, px, py, pz, nx, ny, nz, area, rho, kind, radius, step, band, heightM };
}

/** The tiling itself, split out only so the fit-to-budget loop above can call it
 *  repeatedly without duplicating any of it. */
function tilePatches(poly, b, heightM, step, band, walls, rhoFloor, rhoCeil) {
  const out = [];

  /* THE FLOOR AND THE CEILING ARE THE SAME TILING AT TWO HEIGHTS, which is not
     a shortcut: they are the same polygon, so a patch that exists on one exists
     on the other, and using one loop is what guarantees the two surfaces have
     the same area. `polygonArea` is then used to correct that area, because a
     count of whole cells whose centres fall inside always differs from the true
     figure — see below. */
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const cx = Math.max(1, Math.ceil(w / step)), cy = Math.max(1, Math.ceil(h / step));
  const sx = w / cx, sy = h / cy;
  const cells = [];
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const x = b.minX + (i + 0.5) * sx, y = b.minY + (j + 0.5) * sy;
      if (pointInPolygon({ x, y }, poly)) cells.push({ x, y });
    }
  }
  if (!cells.length) cells.push({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

  /* THE AREAS ARE SCALED TO THE TRUE FLOOR AREA. A tiling by centre-inside test
     over-counts a convex room and under-counts a spiky one by up to half a cell
     all the way round the perimeter, and the reflected light is proportional to
     the area it lands on — so a room would come back a few per cent bright or
     dim purely as a function of how its outline happened to fall across the
     grid. Normalising the total removes that, and it is the same reason the
     wall bands below are sized by division rather than by ceiling. */
  const trueFloor = Math.abs(polygonArea(poly));
  const cellArea = trueFloor > 0 ? trueFloor / cells.length : sx * sy;

  for (const c of cells) {
    out.push({ kind: 'floor', p: { x: c.x, y: c.y, z: 0 },
               n: { x: 0, y: 0, z: 1 }, area: cellArea, rho: rhoFloor });
    out.push({ kind: 'ceiling', p: { x: c.x, y: c.y, z: heightM },
               n: { x: 0, y: 0, z: -1 }, area: cellArea, rho: rhoCeil });
  }

  /* THE WALLS, EDGE BY EDGE, DIVIDED ALONG AND UP. `bands` is at least one, so a
     low room still has a wall, and the divisions are exact — length over count
     rather than a fixed step with a remainder — so the tiles cover the wall
     with nothing left over and no overlap.

     THE INWARD NORMAL IS TESTED RATHER THAN DERIVED FROM THE WINDING, because
     nothing upstream guarantees a winding: `regionFromOutline` can hand back
     either, and a wall whose normal points out of the room reflects light into
     the flat next door. The test is the same one `placeZone` uses — step off the
     face by a hair and ask whether that point is inside. */
  const bands = Math.max(1, Math.round(heightM / band));
  const bandH = heightM / bands;
  for (let e = 0; e < poly.length; e++) {
    const a = poly[e], c = poly[(e + 1) % poly.length];
    const dx = c.x - a.x, dy = c.y - a.y;
    const L = Math.hypot(dx, dy);
    if (!(L > 1e-6)) continue;
    const ux = dx / L, uy = dy / L;
    let n = { x: -uy, y: ux };
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const eps = Math.max(1e-4, L * 1e-3);
    if (!pointInPolygon({ x: mid.x + n.x * eps, y: mid.y + n.y * eps }, poly)) {
      n = { x: -n.x, y: -n.y };
    }
    const along = Math.max(1, Math.round(L / step));
    const segL = L / along;
    const rho = SURFACE_REFLECTANCE.wall[toneOf(walls[e])];
    for (let i = 0; i < along; i++) {
      const t = (i + 0.5) * segL;
      for (let k = 0; k < bands; k++) {
        out.push({
          kind: 'wall', wall: e,
          /* THE PATCH SITS A HAIR INSIDE ITS OWN WALL. On the face exactly, the
             visibility test below would find the patch's own edge between it and
             everything else in the room and call the whole wall shadowed. The
             offset is a millimetre of a metre-wide patch and changes no
             distance that matters. */
          p: { x: a.x + ux * t + n.x * 1e-3, y: a.y + uy * t + n.y * 1e-3,
               z: (k + 0.5) * bandH },
          n: { x: n.x, y: n.y, z: 0 },
          area: segL * bandH, rho,
        });
      }
    }
  }
  return out;
}

/**
 * IS THIS ROOM CONVEX? — asked once, and it decides whether anything has to be
 * tested for visibility at all.
 *
 * IN A CONVEX ROOM EVERYTHING SEES EVERYTHING, so the whole occlusion question
 * disappears and with it the cost of asking it — which on a rectangular room, of
 * which every plan is mostly made, is the difference between a few thousand
 * segment tests and none. An L-shaped room is where a wall genuinely blocks a
 * fitting from a piece of floor, and that is the room this returns false for.
 *
 * BY THE SIGN OF THE CROSS PRODUCT AT EVERY CORNER, with a tolerance, because a
 * traced outline is full of corners that are straight to within a rounding
 * error and a strict test calls them all reflex.
 */
export function isConvex(polygonM) {
  const p = polygonM ?? [];
  if (p.length < 4) return true;
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** How close to either end of a sight line a crossing is ignored, in metres.
 *  Five millimetres: wider than the millimetre a wall patch is held off its own
 *  face, and narrower than anything that could be a real obstruction. */
export const EDGE_EPS_M = 0.005;

/**
 * DOES A SOLID WALL STAND BETWEEN THESE TWO POINTS?
 *
 * A TWO-DIMENSIONAL TEST FOR A THREE-DIMENSIONAL QUESTION, AND IT IS THE RIGHT
 * ONE. Every wall in this model runs floor to slab: it is the room's own
 * boundary, extruded. So a sight line is blocked exactly when its plan
 * projection crosses an edge of the outline, whatever the two heights are —
 * there is no lintel to duck under and no partition to see over.
 *
 * THE TOLERANCE IS AT THE ENDS AND NOT IN THE MIDDLE. Both endpoints are on or
 * inside the polygon — a wall patch is a millimetre off its own face, a fitting
 * is inside the room — so a crossing found within a whisker of either end is
 * the endpoint's own edge rather than an obstruction. A strict test would report
 * every wall patch as invisible from everywhere.
 */
export function blocked(ax, ay, bx, by, poly) {
  const rx = bx - ax, ry = by - ay;
  const len = Math.hypot(rx, ry);
  if (!(len > EDGE_EPS_M)) return false;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sx = q.x - p.x, sy = q.y - p.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) continue;         // parallel: no single crossing
    const t = ((p.x - ax) * sy - (p.y - ay) * sx) / den;
    if (t <= 0 || t >= 1) continue;
    /* THE TOLERANCE IS A REAL DISTANCE AND NOT A FRACTION OF THE LINE, which is
       the one thing this test got wrong the first time it was written. A wall
       patch sits a millimetre off its own face, so the crossing with that face
       is at t = 0.001/len — which a fixed parametric epsilon calls a genuine
       obstruction on a long sight line and a genuine obstruction on a short one.
       Measured in metres, a millimetre is a millimetre either way. */
    const along = t * len;
    if (along < EDGE_EPS_M || along > len - EDGE_EPS_M) continue;
    const u = ((p.x - ax) * ry - (p.y - ay) * rx) / den;
    if (u < 0 || u > 1) continue;
    return true;
  }
  return false;
}
