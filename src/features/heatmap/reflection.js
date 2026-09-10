// ---------------------------------------------------------------------------
// reflection.js — THE SHARED BOUNCE. One engine, every fitting.
//
// WHAT THIS REPLACES, AND WHY THE OLD THING COULD NOT DO IT. lib/lumens.js
// accounts for reflected light with `bounceOf` — a single coefficient per
// family: 80% of a cove's output at the ceiling times the ceiling's
// reflectance, and so on. That is the lumen method's shape and it is right for
// a budget, but it is a number per ROOM: it cannot say that the ceiling above
// the cove is bright and the far corner is not, which is the only question a
// heatmap asks. So the reflections here are computed patch by patch, and
// `bounceOf` is never applied on top of them — that would be the same bounced
// light counted twice.
//
// THE MODEL IS RADIOSITY, STOPPED EARLY.
//
//   1. Every emitter's DIRECT light lands on the patches (that is solve.js).
//   2. Each patch hands back its own reflectance times what landed on it, as a
//      LAMBERTIAN source at the patch's centre facing along the patch's normal.
//      A diffuse surface has no memory of where its light came from, which is
//      what makes this cheap and what makes it right.
//   3. That light lands on the other patches, and step 2 repeats.
//   4. A RECEIVER collects what every bounce sent it.
//
// STEP 4 IS WHERE THE TWO LAYERS PART, AND IT IS THE ONLY PLACE THEY DO. Steps
// 1 to 3 produce one vector — `exitance`, the lumens each surface hands back —
// and that vector is the whole of the light transport. `buildPlaneTransfer`
// gathers it as HORIZONTAL ILLUMINANCE on a plane, cosine and all;
// `buildSphereTransfer` gathers it as MEAN SPHERICAL ILLUMINANCE at a probe in
// the room's volume, solid angle only. Same light, two questions, one engine —
// which is why switching layers on the drawing costs a matrix and not a solve.
//
// AND IT IS BOUNDED, BY BOTH TESTS THE BRIEF ASKS FOR: a hard cap on the number
// of bounces, and a stop the moment a bounce is carrying less than a fixed
// fraction of what the first one carried. In a light room the third bounce is
// worth about 2% of the first; in a dark one the second is already under it.
//
// THE TRANSFER MATRIX IS GEOMETRY AND IS CACHED. `T` depends on the outline, the
// height and the finishes — never on where a fitting is — so dragging a
// downlight round a room re-runs steps 1, 3 and 4 and never step 2's geometry.
// See useHeatmap.js for where that cache lives and what invalidates it.
//
// PURE. No React, no canvas, no document.
// ---------------------------------------------------------------------------

import { blocked } from './grid.js';
import { soften } from './photometry.js';

/**
 * AT MOST THIS MANY BOUNCES, WHATEVER THE REFLECTANCES SAY — and it was three,
 * which was wrong and is worth recording as wrong.
 *
 * A WHITE ROOM DOES NOT CONVERGE IN THREE. This app's light finishes are 0.8 on
 * the ceiling and walls and 0.5 on the floor, which is an area-weighted average
 * around 0.73 — so each bounce carries nearly three quarters of the one before
 * it, and the third is still worth better than half the first. Stopping there
 * threw away about two fifths of the interreflected light, which in a coved room
 * is most of the light there is.
 *
 * SIXTEEN IS WHERE THE STOP BELOW ACTUALLY BITES. At 0.73 a bounce falls under
 * two per cent of the first at the thirteenth, so the cap is the belt and the
 * `BOUNCE_STOP` test is the braces — a dark room finishes in three or four and
 * a white one runs the distance. THE COST IS NOTHING: a bounce is one pass of
 * the transfer matrix, which for an ordinary room is fourteen thousand
 * multiplies, and sixteen of those is a quarter of a millisecond.
 */
export const MAX_BOUNCES = 16;
/** ...and stop earlier than that once a bounce carries less than this share of
 *  the first one. Two per cent of the first bounce is under one per cent of the
 *  answer, which is well inside what an approximation this coarse can claim. */
export const BOUNCE_STOP = 0.02;

/**
 * PATCH TO PATCH — the fraction of the flux leaving p that arrives at q.
 *
 * THE POINT-TO-POINT FORM FACTOR:  cos(theta_p) * cos(theta_q) * A_q / (pi d^2)
 *
 * `pi` AND NOT `2 pi`, and that is the whole of what makes this a diffuse
 * transfer rather than a point source's. A Lambertian emitter of flux F has
 * peak intensity F/pi along its normal — see the normalisation note in
 * photometry.js, with n = 1 — so the illuminance it puts on q is
 * `(F/pi) cos(theta_p) cos(theta_q)/d^2` and the flux is that times q's area.
 * The `pi` is the Lambertian constant, not a fudge.
 *
 * COPLANAR AND BACK-FACING PAIRS FALL OUT ON THEIR OWN. Two floor patches see
 * each other edge-on, so `cos(theta_p)` is exactly zero; a wall patch behind
 * another wall faces away, so one of the two cosines is negative. Neither needs
 * a rule, which is why the floor's own reflected light cannot reach the floor
 * plane and why nothing has to remember that it must not.
 *
 * STORED AS `T[p * n + q]`, row per source patch, so a bounce is a walk down
 * one row at a time and stays in cache.
 */
export function buildTransfer(patches, polygonM, { convex = false } = {}) {
  const { n, px, py, pz, nx, ny, nz, area, radius } = patches;
  const T = new Float32Array(n * n);
  for (let p = 0; p < n; p++) {
    const ax = px[p], ay = py[p], az = pz[p];
    const anx = nx[p], any = ny[p], anz = nz[p];
    const ar = radius[p];
    for (let q = 0; q < n; q++) {
      if (q === p) continue;
      const dx = px[q] - ax, dy = py[q] - ay, dz = pz[q] - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!(d2 > 0)) continue;
      const d = Math.sqrt(d2);
      const ux = dx / d, uy = dy / d, uz = dz / d;
      const cp = ux * anx + uy * any + uz * anz;
      if (!(cp > 0)) continue;
      const cq = -(ux * nx[q] + uy * ny[q] + uz * nz[q]);
      if (!(cq > 0)) continue;
      /* THE WALLS ARE ASKED ONLY WHERE THEY CAN ANSWER ANYTHING. In a convex
         room every surface sees every other, so the test is skipped entirely —
         which is most plans, and it is the difference between a few thousand
         segment intersections and none. An L-shaped room is where one arm
         genuinely cannot light the other. */
      if (!convex && blocked(ax, ay, px[q], py[q], polygonM)) continue;
      T[p * n + q] = (cp * cq * area[q]) / (Math.PI * soften(d2, ar + radius[q]));
    }
  }

  /* --- EVERY ROW SUMS TO ONE, BECAUSE A CLOSED ROOM HAS NOWHERE ELSE TO PUT IT
     LIGHT LEAVING A SURFACE LANDS ON ANOTHER SURFACE. That is not a modelling
     choice, it is what "closed" means, and it fixes the row sums at exactly 1.
     What the arithmetic above actually produces is about 0.95, because a
     point-to-point form factor sampled at patch centres always loses a little —
     and 5% lost per bounce compounds: over the dozen bounces a white room takes
     to settle it costs an eighth of the interreflected light, which is a
     systematic error with no physical meaning at all.
     SO THE ROWS ARE NORMALISED, and the alternative was to make the patches
     finer, which costs the square. THE ONE PLACE THIS IS AN APPROXIMATION
     RATHER THAN A CORRECTION is a room where a wall blocks the view: the light
     that wall intercepted should land ON it, and normalising instead shares it
     among the patches that ARE visible. It is bounded by how much of a
     non-convex room is hidden from any one patch and it is the right direction
     to err — the alternative is losing that light entirely. Stated here rather
     than found later. */
  for (let p = 0; p < n; p++) {
    const row = p * n;
    let s = 0;
    for (let q = 0; q < n; q++) s += T[row + q];
    if (!(s > 0)) continue;
    const k = 1 / s;
    for (let q = 0; q < n; q++) if (T[row + q] > 0) T[row + q] *= k;
  }
  return T;
}

/**
 * PATCH TO A POINT ON THE MEASUREMENT PLANE — illuminance per lumen leaving the
 * patch. The same form factor with the area taken off, because a point has none.
 *
 * ONE MATRIX FOR EVERY BOUNCE, WHICH IS WHY IT IS WORTH PRECOMPUTING. The
 * illuminance the plane receives is LINEAR in what leaves the patches, so the
 * bounces can be summed into one exitance vector first and this applied once at
 * the end — one pass rather than one per bounce. See `bounce` below.
 *
 * `G[p * m + g]`, row per patch, for `bounce`'s access pattern.
 */
export function buildPlaneTransfer(patches, field, polygonM, { convex = false } = {}) {
  const { n, px, py, pz, nx, ny, nz, radius } = patches;
  const { cx, cy, count } = field;
  const G = new Float32Array(n * count);
  const planeZ = field.planeZ ?? 0;
  for (let p = 0; p < n; p++) {
    const ax = px[p], ay = py[p], az = pz[p];
    const anx = nx[p], any = ny[p], anz = nz[p];
    const ar = radius[p];
    const row = p * count;
    for (let g = 0; g < count; g++) {
      const dx = cx[g] - ax, dy = cy[g] - ay, dz = planeZ - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!(d2 > 0)) continue;
      const d = Math.sqrt(d2);
      const uz = dz / d;
      const cp = (dx / d) * anx + (dy / d) * any + uz * anz;
      if (!(cp > 0)) continue;
      // THE PLANE'S NORMAL IS UP, so its cosine is just -uz. This is what makes
      // the answer HORIZONTAL illuminance rather than the light arriving from
      // any direction at all.
      const cq = -uz;
      if (!(cq > 0)) continue;
      if (!convex && blocked(ax, ay, cx[g], cy[g], polygonM)) continue;
      /* THE PATCH'S OWN EXTENT AND NOT THE CELL'S, and the difference is not
         cosmetic. `soften` is a correction for a SOURCE being too close to be a
         point — see photometry.js — and the source here is the patch. The cell
         is not a source, it is where the plane is being SAMPLED, and folding the
         sampling spacing into the softening made the answer depend on the grid:
         a floor cell beside a wall reads brighter on the fine grid than the
         coarse one purely because its own radius is smaller, which is the
         resolution dependence this whole feature is not allowed to have. */
      G[row + g] = (cp * cq) / (Math.PI * soften(d2, ar));
    }
  }
  return G;
}

/**
 * THE ¼ IN THE DEFINITION OF MEAN SPHERICAL ILLUMINANCE, AND WHERE IT COMES
 * FROM — because a factor nobody derived is a factor somebody will "fix".
 *
 * MEAN SPHERICAL ILLUMINANCE IS THE AVERAGE ILLUMINANCE OVER THE SURFACE OF AN
 * INFINITESIMAL IMAGINARY SPHERE at the point. A sphere of radius r has surface
 * area 4 pi r^2 and presents a projected area of pi r^2 to a beam from ANY
 * direction, so a beam of normal illuminance E_n delivers E_n * pi r^2 lumens
 * to it and the average over its surface is E_n / 4. Integrating over all
 * directions, with L the luminance arriving from each:
 *
 *     E_mean_spherical(p)  =  1/4 * INTEGRAL L(p, omega) d omega
 *
 * which is exactly the brief's formula. IT IS NOT HORIZONTAL LUX and it is not
 * an unweighted sum of directional samples: every direction is weighted by its
 * own SOLID ANGLE and by nothing else — no receiver cosine, because a sphere
 * has no orientation. That is the entire difference between this and
 * `buildPlaneTransfer` above, and it is one line in the loop.
 *
 * FROM A PATCH TO A PROBE, WRITTEN OUT. A Lambertian patch q of area A_q
 * emitting F_q lumens has luminance F_q / (pi A_q), and subtends solid angle
 * A_q cos(theta_q) / d^2 at the probe. So its share of the integral is
 * F_q cos(theta_q) / (pi d^2), and its share of the mean spherical illuminance
 * is a quarter of that. The area cancels, exactly as it does for the plane
 * transfer, which is why this matrix has the same shape and the same cost.
 */
export const MEAN_SPHERICAL_FACTOR = 0.25;

/**
 * PATCH TO A PROBE IN THE ROOM'S VOLUME — mean spherical illuminance per lumen
 * leaving the patch. `buildPlaneTransfer`'s sibling, and it is deliberately
 * written beside it: the two differ in one term and keeping them apart is how
 * they would come to differ in more.
 *
 * `probeZ` IS A HEIGHT ABOVE THE FLOOR AND IT IS THE ONLY THING THAT CHANGES
 * when the reader moves the measurement height. Nothing in `patches` or `T`
 * depends on it, which is what lets a height change reuse the whole of the
 * light transport and rebuild only this — see indirect.js.
 *
 * THE OCCLUSION TEST IS THE SAME PLAN-PROJECTION ONE, and it is still correct
 * at height: every wall in this model runs floor to slab, so what a probe at
 * 1.2 m cannot see is exactly what a point on the floor beneath it cannot see.
 *
 * --- AND THE COLUMNS ARE NORMALISED, FOR buildTransfer'S OWN REASON ---------
 * A POINT INSIDE A CLOSED ROOM SEES ROOM SURFACE IN EVERY DIRECTION. That is
 * not a modelling choice, it is what "closed" means, and it fixes the sum of
 * the patches' solid angles at exactly 4 pi — which in this matrix's terms is
 * `sum over p of S[p][g] * area[p] === 1` at every probe g. Patch-centre
 * sampling produces rather less than that, badly so for a probe within a patch
 * width of a surface, and the shortfall is a systematic dimming with no
 * physical meaning at all.
 *
 * SO THE COLUMN IS SCALED TO CLOSE, exactly as `buildTransfer` scales its rows,
 * and it is what makes the analytical case exact rather than approximate: a
 * room whose every surface has uniform exitance M lm/m^2 reads M lux at every
 * probe in it, which is the reference tools/test-heatmap-indirect.mjs checks.
 * THE ONE PLACE IT IS AN APPROXIMATION rather than a correction is the same
 * place: in a non-convex room the solid angle of the surfaces a probe cannot
 * see is shared among the ones it can, which is bounded by how much of the room
 * is hidden and is the right direction to err.
 */
export function buildSphereTransfer(patches, field, polygonM,
                                    { convex = false, probeZ = 0 } = {}) {
  const { n, px, py, pz, nx, ny, nz, area, radius } = patches;
  const { cx, cy, count } = field;
  const S = new Float32Array(n * count);
  for (let p = 0; p < n; p++) {
    const ax = px[p], ay = py[p], az = pz[p];
    const anx = nx[p], any = ny[p], anz = nz[p];
    const ar = radius[p];
    const row = p * count;
    for (let g = 0; g < count; g++) {
      const dx = cx[g] - ax, dy = cy[g] - ay, dz = probeZ - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!(d2 > 0)) continue;
      const d = Math.sqrt(d2);
      const cp = (dx / d) * anx + (dy / d) * any + (dz / d) * anz;
      // FACING AWAY IS NOT DIM, IT IS DARK — the cosine at the PATCH, which is
      // the only cosine in this transfer. There is no receiver cosine and no
      // receiver-facing test: a sphere faces every way at once, and adding one
      // here is how this quietly becomes horizontal lux again.
      if (!(cp > 0)) continue;
      if (!convex && blocked(ax, ay, cx[g], cy[g], polygonM)) continue;
      S[row + g] = (cp * MEAN_SPHERICAL_FACTOR) / (Math.PI * soften(d2, ar));
    }
  }

  /* THE CLOSURE, COLUMN BY COLUMN — see the note above. Two passes rather than
     one because the sum for a probe is spread down a column of a row-major
     matrix; accumulating it as the matrix is built would mean an m-long
     accumulator anyway, and this way the arithmetic is where its argument is. */
  const closure = new Float64Array(count);
  for (let p = 0; p < n; p++) {
    const row = p * count, a = area[p];
    for (let g = 0; g < count; g++) {
      const t = S[row + g];
      if (t > 0) closure[g] += t * a;
    }
  }
  for (let g = 0; g < count; g++) {
    closure[g] = closure[g] > 0 ? 1 / closure[g] : 0;
  }
  for (let p = 0; p < n; p++) {
    const row = p * count;
    for (let g = 0; g < count; g++) {
      if (S[row + g] > 0) S[row + g] *= closure[g];
    }
  }
  return S;
}

/**
 * THE BOUNCES — IN. What every surface of the room ends up handing back.
 *
 * `incident` is the DIRECT flux on each patch, in lumens, which solve.js has
 * already worked out. Everything from here is arithmetic on that vector.
 *
 * `exitance` IS THE ANSWER AND IT IS PER PATCH, IN LUMENS — the total each
 * surface sends back out across every bounce. IT IS ALSO THE ONE RESULT BOTH
 * LAYERS SHARE, which is why this is its own function rather than the first
 * half of `bounce`: the horizontal field and the reflected-ambient probes are
 * the SAME light gathered by two different receivers, and computing the light
 * transport twice to answer two questions about it would be the expensive half
 * of the feature done twice. See useHeatmap.js, which caches exactly this.
 *
 * EVERY LUMEN IN IT HAS REFLECTED AT LEAST ONCE, by construction: the first
 * bounce is `incident * rho`, so a lumen only enters this vector by leaving a
 * surface. That is not a filter applied afterwards — it is the definition of
 * the quantity, and it is what makes the reflected-ambient layer's exclusion of
 * direct light exact rather than approximate.
 *
 * Returns the accounting the legend and the tests read alongside it: how many
 * bounces were run, and what each carried.
 */
export function exitanceOf(patches, T, incident) {
  const n = patches.n, rho = patches.rho;
  const exitance = new Float64Array(n);
  let leaving = new Float64Array(n);
  let next = new Float64Array(n);

  let first = 0;
  for (let p = 0; p < n; p++) {
    leaving[p] = incident[p] * rho[p];
    first += leaving[p];
  }

  const carried = [];
  let bounces = 0;
  for (let k = 0; k < MAX_BOUNCES; k++) {
    let sum = 0;
    for (let p = 0; p < n; p++) sum += leaving[p];
    if (!(sum > 0)) break;
    carried.push(sum);
    bounces = k + 1;
    for (let p = 0; p < n; p++) exitance[p] += leaving[p];
    if (k === MAX_BOUNCES - 1) break;
    /* AND STOP WHEN THERE IS NOTHING LEFT TO SAY. The test is against the FIRST
       bounce rather than against an absolute figure, so it means the same thing
       in a bright hall and a dark cupboard: this bounce is worth less than two
       per cent of the light that started coming back, and the next one is worth
       a fraction of that. */
    if (k > 0 && sum < first * BOUNCE_STOP) break;
    next.fill(0);
    for (let p = 0; p < n; p++) {
      const f = leaving[p];
      if (!(f > 0)) continue;
      const row = p * n;
      for (let q = 0; q < n; q++) {
        const t = T[row + q];
        if (t > 0) next[q] += f * t;
      }
    }
    // The next bounce leaves each patch as its own reflectance times what just
    // landed on it. One swap rather than two allocations per bounce.
    const swap = leaving; leaving = next; next = swap;
    for (let p = 0; p < n; p++) leaving[p] *= rho[p];
  }

  return { exitance, bounces, carried, firstBounceLumens: first };
}

/**
 * ...AND OUT, THROUGH WHICHEVER RECEIVER IS ASKING.
 *
 * `X` IS A RECEIVER TRANSFER — `buildPlaneTransfer`'s G for horizontal lux, or
 * `buildSphereTransfer`'s S for mean spherical illuminance at a probe. Both are
 * `row per patch, column per cell` and both are LINEAR in what leaves the
 * patches, which is the property that lets the bounces be summed into one
 * exitance vector first and a receiver applied once at the end: one pass of the
 * big matrix rather than one per bounce, and one function rather than one per
 * layer.
 */
export function gather(exitance, X, m) {
  const out = new Float64Array(m);
  const n = exitance.length;
  for (let p = 0; p < n; p++) {
    const f = exitance[p];
    if (!(f > 0)) continue;
    const row = p * m;
    for (let g = 0; g < m; g++) {
      const t = X[row + g];
      if (t > 0) out[g] += f * t;
    }
  }
  return out;
}

/**
 * THE TWO OF THEM, FOR THE HORIZONTAL FIELD — the call solve.js has always
 * made, kept whole so that the layer added beside it changed nothing about it.
 */
export function bounce(patches, T, G, field, incident) {
  const r = exitanceOf(patches, T, incident);
  return { plane: gather(r.exitance, G, field.count), ...r };
}
