// ---------------------------------------------------------------------------
// solve.js — ONE ROOM, START TO FINISH. Direct light, then the bounce, then a
// field of lux.
//
// THE ORDER IS THE MODEL AND IT IS FOUR STEPS:
//
//   1. GEOMETRY. The outline in metres becomes a field grid (what gets
//      coloured) and a set of surface patches (what light bounces off), plus the
//      two transfer matrices between them. ALL OF IT DEPENDS ON THE ROOM AND
//      NONE OF IT ON THE FITTINGS, which is why it is a separate call with its
//      own cache — see `buildRoomGeometry` and useHeatmap.js.
//
//   2. DIRECT. Every emitter, expanded into samples by its profile, evaluated
//      at every live grid cell and at every patch. Walls block; the receiving
//      cosine applies; nothing is bounced yet.
//
//   3. REFLECTED. The patches hand back what landed on them, bounded — see
//      reflection.js.
//
//   4. THE FIELD. direct + reflected, in lux, one figure per cell. Kept as two
//      arrays as well as their sum, because the two answer different questions
//      and one of the verification checks is about the difference: changing a
//      floor finish must not move the direct component at all.
//
// WHAT IS DELIBERATELY NOT NORMALISED, AND WHAT IS. The direct illuminance at a
// cell is left exactly as the inverse square gives it — it is a point quantity
// and a true one, and scaling it to make a discretised energy balance close
// would corrupt a correct number to tidy an approximate one. The flux landing on
// the PATCHES is closed to what each source emits, because that IS an integral
// over metre-wide tiles and near a surface it can be out by a factor either
// way. See the closure note on `directPass`.
//
// PURE. No React, no canvas, no document.
// ---------------------------------------------------------------------------

import { pointInPolygon, distanceToBoundary } from '../../lib/geometry.js';
import { buildFieldGrid, buildPatches, isConvex, blocked,
         HEATMAP_RESOLUTION } from './grid.js';
import { buildTransfer, buildPlaneTransfer, bounce } from './reflection.js';
import { expandSource, illuminanceFrom } from './photometry.js';
import { profileFor } from './profiles.js';

/**
 * HOW MUCH OF THE PLANE TRANSFER MATRIX ONE ROOM MAY COST, in floats.
 *
 * `G` IS PATCHES TIMES CELLS AND BOTH ARE ALREADY CAPPED, so this is the third
 * guard and it is the one that binds: a 400 sqm hall at 0.35 m is 3,300 cells,
 * which against 600 patches would be two million floats — 8 MB for one room on a
 * plan that may hold eight. When the product is over budget the FIELD is
 * coarsened rather than the patches, because the patches are already the
 * coarsest thing in the model and a heatmap drawn at 70 cm on a hall is still a
 * heatmap. 400,000 floats is 1.6 MB.
 */
export const PLANE_TRANSFER_BUDGET = 400_000;

/**
 * A NUMERICAL BACKSTOP ON THE PATCH-FLUX CLOSURE — see `directPass`.
 *
 * IT IS NOT THE GUARD AGAINST A MISPLACED FITTING; `inRoom` below is. This is
 * only here so that a claim of almost exactly zero cannot become a division by
 * almost exactly nothing: forty is far past anything the near field asks for —
 * a cove segment against a metre-wide ceiling patch, the tightest case in the
 * model, resolves between a tenth and a half of its own output depending on
 * where the patch centres happen to fall.
 */
export const MAX_RECOVERY = 40;

/** How far outside the outline a fitting may sit and still count as being in
 *  the room, in metres. A wall fitting is held a millimetre off its own face and
 *  a traced outline is not to the millimetre; 50 mm is wider than either and
 *  narrower than a wall. */
export const IN_ROOM_TOL_M = 0.05;

/**
 * STEP 1 — everything about the room and nothing about its fittings.
 *
 * `signature` IS WHAT THE CACHE COMPARES and it is built here rather than by the
 * hook, because this is the file that knows which inputs the answer actually
 * depends on. A fitting moving must not invalidate it; a wall tone changing
 * must. See useHeatmap.js.
 */
export function buildRoomGeometry({ polygonM, heightM, materials, mode = 'fine' }) {
  const res = HEATMAP_RESOLUTION[mode] ?? HEATMAP_RESOLUTION.fine;
  const poly = polygonM ?? [];
  if (poly.length < 3 || !(heightM > 0)) return null;

  const patches = buildPatches(poly, heightM, materials, res);
  if (!patches || !patches.n) return null;

  let field = buildFieldGrid(poly, res.fieldM);
  if (!field || !field.count) return null;
  /* COARSEN THE FIELD UNTIL THE PLANE TRANSFER FITS. Stepping up by a quarter
     each time rather than solving for the step, because the cell count is not a
     smooth function of it — an outline can lose a whole row of cells to one
     nudge — and two or three tries settle it. */
  let step = field.step;
  for (let tries = 0; tries < 8; tries++) {
    if (patches.n * field.count <= PLANE_TRANSFER_BUDGET) break;
    step *= 1.25;
    const next = buildFieldGrid(poly, step);
    if (!next || !next.count) break;
    field = next;
  }

  const convex = isConvex(poly);
  const T = buildTransfer(patches, poly, { convex });
  const G = buildPlaneTransfer(patches, field, poly, { convex });
  return { poly, heightM, patches, field, convex, T, G, mode, res };
}

/**
 * STEP 2 — the direct pass, for one room.
 *
 * TWO ACCUMULATIONS FROM ONE WALK OVER THE SOURCES, and they are different
 * quantities: ILLUMINANCE at the grid cells, which is what gets coloured, and
 * FLUX at the patches, which is what gets bounced. Doing them in one pass is not
 * only cheaper — it is what guarantees the two halves of the answer are about
 * the same set of fittings.
 *
 * THE PATCH FLUX IS CLOSED TO THE SOURCE'S OWN LUMENS, PER SOURCE. Same
 * argument as the row normalisation in reflection.js and it is worth restating
 * because it is the one thing holding the near field together: A ROOM IS
 * CLOSED, so every lumen a fitting emits lands on some surface of it. That
 * fixes the total, and what patch-centre sampling gets wrong is only the
 * DISTRIBUTION — so the pattern is kept and the total is corrected.
 *
 * THE COVE IS WHAT FORCED IT AND IT IS WORTH BEING SPECIFIC. A concealed strip
 * sits 150 mm under the slab it throws at, so 95% of a segment's light lands
 * within half a metre of the point directly above it — a distribution a metre-
 * wide patch sampled at its centre cannot begin to resolve. Uncorrected, the
 * arithmetic found about a quarter of the cove's output and the other three
 * quarters vanished: a coved room came out three quarters dark. `soften` in
 * photometry.js keeps that from becoming a division by nearly nothing; this is
 * what puts the light back where it went.
 *
 * SCALING DOWN NEEDS NO GUARD AND SCALING UP NEEDS ONE. Down is energy
 * conservation: nothing may deliver more than it emits, ever. Up is a
 * correction for under-resolution, and it is only legitimate while the room
 * really does enclose the source — see `inRoom` in the body, which is the guard,
 * and `MAX_RECOVERY`, which is only a numerical backstop behind it.
 */
export function directPass(geometry, sources) {
  const { field, patches, poly, convex } = geometry;
  const m = field.count, n = patches.n;
  const direct = new Float64Array(m);
  const incident = new Float64Array(n);
  const scratch = new Float64Array(n);
  let emitted = 0, onSurfaces = 0;

  for (const src of sources) {
    const profile = profileFor(src.profileId);
    /* A FITTING THIS TABLE HAS NEVER HEARD OF IS DROPPED, NOT GUESSED AT. The
       brief's rule, restated as code: do not model every non-COB fixture as an
       omnidirectional point source. A missing profile is a missing
       specification, and the honest heatmap of a fitting nobody has specified is
       no light rather than invented light. */
    if (!profile) continue;
    const samples = expandSource(src, profile);
    if (!samples.length) continue;

    for (const sm of samples) {
      let claimed = 0;
      for (let p = 0; p < n; p++) {
        const E = illuminanceFrom(sm, patches.px[p], patches.py[p], patches.pz[p],
                                  patches.nx[p], patches.ny[p], patches.nz[p],
                                  sm.radius + patches.radius[p]);
        if (!(E > 0)) { scratch[p] = 0; continue; }
        if (!convex && blocked(sm.x, sm.y, patches.px[p], patches.py[p], poly)) {
          scratch[p] = 0; continue;
        }
        const f = E * patches.area[p];
        scratch[p] = f;
        claimed += f;
      }
      let lm = 0;
      for (const L of sm.lobes) lm += L.flux;
      emitted += lm;
      /* --- CLOSURE ONLY WHERE CLOSURE IS TRUE -------------------------------
         THE ARGUMENT FOR SCALING A SOURCE UP IS THAT THE ROOM IS CLOSED, so it
         holds exactly while the source is IN the room. A fitting that is not —
         one whose room was misattributed, or a wall fitting whose wall could
         not be worked out — has no such guarantee, and multiplying its stray
         light until it accounts for its whole output would turn a data fault
         into a confident bright patch on somebody's drawing. Those keep what
         they actually delivered and no more, which reads as a fitting doing very
         little: the honest picture of one nobody can place.
         TESTED PER SAMPLE AND NOT PER SOURCE, because a run can cross a
         threshold: half a strip inside the room closes against the room, and the
         half hanging over the corridor does not. */
      const inRoom = (sm.z > -IN_ROOM_TOL_M)
        && (sm.z < geometry.heightM + IN_ROOM_TOL_M)
        && (pointInPolygon({ x: sm.x, y: sm.y }, poly)
            || distanceToBoundary({ x: sm.x, y: sm.y }, poly) < IN_ROOM_TOL_M);
      const k = claimed > 0 && lm > 0
        ? (inRoom ? Math.min(MAX_RECOVERY, lm / claimed) : Math.min(1, lm / claimed))
        : 1;
      for (let p = 0; p < n; p++) {
        if (scratch[p] > 0) { incident[p] += scratch[p] * k; onSurfaces += scratch[p] * k; }
      }

      /* --- AND THE PLANE, AVERAGED ACROSS EACH CELL RATHER THAN SAMPLED AT
             ITS CENTRE ------------------------------------------------------
         A CELL IS AN AVERAGE OVER ITS OWN PATCH OF FLOOR, and a downlight's
         direct contribution is peaked enough that one sample makes the answer
         depend on where the grid happened to fall. See FIELD_SUBSAMPLES, which
         carries the whole argument and the figure.
         THE OCCLUSION TEST IS PER SUB-SAMPLE TOO, which is not pedantry: the
         shadow edge in an L-shaped room runs through cells, and averaging four
         points across a cell that straddles it is a truer answer than declaring
         the whole cell lit or dark on its centre. */
      const { subs, nSub, subMask, subN } = field;
      for (let g = 0; g < m; g++) {
        const gx = field.cx[g], gy = field.cy[g];
        const row = g * nSub, take = subN[g];
        let acc = 0;
        if (take === 0) {
          // The degenerate cell — see the note on `subMask`. Its centre is the
          // only point known to be on the floor.
          const E = illuminanceFrom(sm, gx, gy, field.planeZ, 0, 0, 1, sm.radius);
          if (E > 0 && (convex || !blocked(sm.x, sm.y, gx, gy, poly))) direct[g] += E;
          continue;
        }
        for (let u = 0; u < nSub; u++) {
          if (!subMask[row + u]) continue;
          const sx = gx + subs[u][0], sy = gy + subs[u][1];
          const E = illuminanceFrom(sm, sx, sy, field.planeZ, 0, 0, 1, sm.radius);
          if (!(E > 0)) continue;
          // THE WALL IS WHAT MAKES THIS A ROOM AND NOT A FIELD. A fitting in one
          // arm of an L cannot light the other arm's floor, and a heatmap that
          // said otherwise would be worse than no heatmap: it would claim
          // coverage nobody can build.
          // PER SUB-SAMPLE, which is not pedantry: a shadow edge runs THROUGH
          // cells, and averaging nine points across one that straddles it is a
          // truer answer than declaring the whole cell lit or dark.
          if (!convex && blocked(sm.x, sm.y, sx, sy, poly)) continue;
          acc += E;
        }
        if (acc > 0) direct[g] += acc / take;
      }
    }
  }
  return { direct, incident, emitted, onSurfaces };
}

/**
 * STEPS 2 TO 4 — the whole room, given its geometry and what is on its ceiling.
 *
 * `direct`, `reflected` AND `total` ARE ALL RETURNED. The sum is what gets
 * coloured; the two parts are what make the model checkable, and two of the
 * verification cases are about them specifically — a floor finish may move the
 * reflected component and may not touch the direct one, and a concealed cove
 * must contribute nothing direct at all.
 */
export function solveRoom(geometry, sources) {
  const { field, patches, T, G } = geometry;
  const m = field.count;
  const { direct, incident, emitted, onSurfaces } = directPass(geometry, sources);
  const bounced = bounce(patches, T, G, field, incident);
  const total = new Float64Array(m);
  for (let g = 0; g < m; g++) total[g] = direct[g] + bounced.plane[g];

  /* --- THE MEAN IS AREA-WEIGHTED, AND THAT IS NOT A REFINEMENT ------------
     A CELL AT THE WALL IS PART FLOOR AND PART WALL. Averaging every cell equally
     counts the overhang as floor, and how much overhang there is depends on the
     step — so the plain mean of a room moved by a tenth between the two
     resolutions while every cell in it was unchanged. `field.weight` is the
     fraction of each cell that is inside the outline; see FIELD_SUBSAMPLES.
     THE MIN AND THE MAX ARE NOT WEIGHTED, because they are not averages: the
     dimmest cell in the room is the dimmest cell in the room whatever share of
     it is floor. */
  const w = field.weight;
  let sum = 0, wsum = 0, min = Infinity, max = 0;
  for (let g = 0; g < m; g++) {
    sum += total[g] * w[g]; wsum += w[g];
    if (total[g] < min) min = total[g];
    if (total[g] > max) max = total[g];
  }
  return {
    field, direct, reflected: bounced.plane, total,
    mean: wsum > 0 ? sum / wsum : 0, min: m ? min : 0, max,
    /* THE ACCOUNTING, and it is not decoration: `emitted` is what the fittings
       put out and is the figure that must not move when the sampling changes,
       and `bounces` is what the engine actually ran. Both are asserted by
       tools/test-heatmap.mjs and neither is shown in the UI. */
    emitted, onSurfaces,
    bounces: bounced.bounces, carried: bounced.carried,
  };
}
