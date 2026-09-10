// ---------------------------------------------------------------------------
// photometry.js — THE LIGHT ITSELF. Lobes, candelas, and one transfer law.
//
// THERE IS ONE EQUATION IN THIS FEATURE AND IT IS `illuminanceFrom` below:
//
//     E  =  I(theta_emit) * cos(theta_incidence) / d^2
//
// the source's angular intensity, the inverse square, and the cosine of the
// receiving surface. Every fitting in the app goes through it — a downlight, a
// metre of cove tape, a sconce, a patch of ceiling handing light back — and
// that is the whole reason a new fitting needs no new algorithm. What differs
// between them is only `I(theta)`, and `I(theta)` is what a PROFILE describes.
//
// NORMALISATION IS THE PART THAT IS EASY TO GET WRONG, so it is stated once,
// here, and asserted in the test. A lobe is given LUMENS and has to answer in
// CANDELAS, and the constant between them is fixed by the requirement that the
// lobe emit exactly the lumens it was given:
//
//     cosine power n over a hemisphere      I0 = lm * (n + 1) / (2 * pi)
//     uniform over the whole sphere         I  = lm / (4 * pi)
//     uniform over a hemisphere (clipped)   I  = lm / (2 * pi)
//
// which is what makes SAMPLING FREE. A line source hands each of its N samples
// lm/N; each sample normalises its own share; the sum is the same light however
// large N is. Nothing about the segmentation can brighten a room, and that is a
// property of this arithmetic rather than a thing to remember.
//
// PURE. No React, no canvas, no document, no room — this file knows about a
// point, a direction and a lumen and nothing else.
// ---------------------------------------------------------------------------

import { LINE_SEGMENT_M, LINE_SEGMENTS_MIN, LINE_SEGMENTS_MAX,
         AREA_SAMPLES } from './profiles.js';

const TWO_PI = Math.PI * 2;
const FOUR_PI = Math.PI * 4;
const DEG = Math.PI / 180;

/**
 * THE COSINE POWER THAT MATCHES A STATED BEAM ANGLE.
 *
 * A BEAM ANGLE IS THE FULL ANGLE AT WHICH INTENSITY HAS FALLEN TO HALF, which
 * is the definition every catalogue uses and the reason this conversion exists
 * at all: `cos^n(beam/2) = 0.5`, so `n = ln(0.5) / ln(cos(beam/2))`.
 *
 * THIS IS WHAT REPLACES A HARD CONE. The old drawing marked a downlight's
 * throw as a disc of a stated diameter — see THROW_STYLE.diameterFtByWatt —
 * which is a fair symbol and a false statement about light: a real 36-degree
 * optic is still putting out a third of its peak at 25 degrees off axis, and
 * the whole point of a heatmap is the soft edge where two of them overlap.
 *
 * CLAMPED AT BOTH ENDS. A beam of 0 or 180 has no power that describes it, and
 * the 6-degree optic in BEAM_ANGLES gives n = 506, which is a legitimate
 * pinspot and is the top of the useful range for a double.
 */
export function powerForBeam(beamDeg) {
  const b = Number(beamDeg);
  if (!(b > 0) || !(b < 180)) return 1;
  const c = Math.cos((b / 2) * DEG);
  if (!(c > 1e-6) || c >= 1) return 600;
  return Math.min(600, Math.max(0.1, Math.log(0.5) / Math.log(c)));
}

/**
 * SOFTENING THE INVERSE SQUARE WHERE THE SOURCE IS NOT FAR AWAY.
 *
 * A POINT SOURCE IS ONLY A POINT SOURCE FROM A DISTANCE, and this feature has
 * one case where it plainly is not: a cove sits 150 mm under the slab it
 * throws at, and 1/d^2 at 150 mm against a patch a metre wide is not a physical
 * quantity, it is a division by nearly nothing. The standard rule is that a
 * point approximation holds beyond about five times the size of the thing, and
 * below that the honest reading is the distance between the two EXTENTS rather
 * than between their centres.
 *
 * SO d^2 IS FLOORED AT THE SUM OF THE TWO RADII, SQUARED. The source's own half
 * length (a segment of tape, half a panel) and the receiver's equivalent radius
 * (a patch, a grid cell). Both are already known and neither is invented.
 *
 * IT IS INERT WHERE IT DOES NOT APPLY, which is almost everywhere: a ceiling
 * downlight is 2.7 m off the floor and the floor cell's radius is 0.2 m, so the
 * floor is 1/180th changed by this — which is to say not at all.
 */
export const soften = (d2, rSum) => {
  const m = rSum * rSum;
  return d2 > m ? d2 : m;
};

/**
 * ONE LOBE, RESOLVED: a direction, an angular law and a candela figure.
 *
 * The three `kind`s of profiles.js collapse to two shapes here — a cosine power
 * about an axis, and a constant — because a `beam` lobe is a cosine power whose
 * exponent came from the optic rather than from the table. That conversion is
 * the only thing `kind` decides, and it is done once per source rather than once
 * per grid cell.
 */
export function resolveLobe(lobe, { lm, beamDeg, axis, inward }) {
  const share = lobe.share ?? 1;
  const flux = lm * share;
  if (!(flux > 0)) return null;
  const clip = lobe.clip === 'inward' && inward ? inward : null;

  if (lobe.kind === 'uniform') {
    /* CLIPPED UNIFORM IS HALF A SPHERE AND SO IS TWICE AS BRIGHT. A sconce's
       diffuse lobe throws its whole output into the room rather than half of it
       into the wall, which is what the fitting does: the back of it is a
       backplate. */
    return { i0: flux / (clip ? TWO_PI : FOUR_PI), power: 0, axis: null, clip, flux };
  }
  const power = lobe.kind === 'beam' ? powerForBeam(beamDeg) : (lobe.power ?? 1);
  return { i0: (flux * (power + 1)) / TWO_PI, power, axis, clip, flux };
}

/**
 * WHAT THIS LOBE SENDS ALONG A UNIT DIRECTION, in candelas.
 *
 * ZERO BEHIND THE AXIS AND ZERO THROUGH THE WALL, and the two refusals are
 * different: the first is what a cosine law says (nothing goes backwards out of
 * a face), the second is what a backplate does. A lobe with neither — a bare
 * lamp in the middle of a room — answers the same figure in every direction.
 */
export function intensityAlong(L, dx, dy, dz) {
  if (L.clip) {
    const inw = L.clip.x * dx + L.clip.y * dy;
    if (!(inw > 0)) return 0;
  }
  if (!L.axis) return L.i0;
  const c = L.axis.x * dx + L.axis.y * dy + L.axis.z * dz;
  if (!(c > 0)) return 0;
  return L.i0 * (L.power === 1 ? c : Math.pow(c, L.power));
}

/**
 * ILLUMINANCE AT ONE POINT FROM ONE SAMPLE — the equation at the head of this
 * file, written out.
 *
 * `n` IS THE RECEIVING SURFACE'S NORMAL AND IS NOT OPTIONAL. On the measurement
 * plane it is straight up, and that is exactly why this is HORIZONTAL
 * illuminance: a lamp at 60 degrees off vertical delivers half of what the same
 * lamp delivers overhead at the same distance, and dropping the cosine is how a
 * heatmap comes out flat and wrong at the edges of a room. On a wall patch it
 * is the wall's own normal, which is what makes a wall wash a wall wash.
 *
 * `rSum` IS FOR `soften`, and the caller supplies it because only the caller
 * knows how big the two ends are.
 */
export function illuminanceFrom(sample, tx, ty, tz, nx, ny, nz, rSum) {
  const dx = tx - sample.x, dy = ty - sample.y, dz = tz - sample.z;
  const d2raw = dx * dx + dy * dy + dz * dz;
  if (!(d2raw > 0)) return 0;
  const d = Math.sqrt(d2raw);
  const ux = dx / d, uy = dy / d, uz = dz / d;
  // The cosine at the RECEIVER. Facing away is not dim, it is dark.
  const cosR = -(ux * nx + uy * ny + uz * nz);
  if (!(cosR > 0)) return 0;
  let I = 0;
  for (const L of sample.lobes) I += intensityAlong(L, ux, uy, uz);
  if (!(I > 0)) return 0;
  return (I * cosR) / soften(d2raw, rSum);
}

/* --- FROM A FITTING TO A SET OF SAMPLES -----------------------------------
   `expandSource` IS WHERE A SHAPE BECOMES ARITHMETIC, and it is the one place
   the "more samples must not mean more light" rule is enforced: the lumens are
   divided by the sample count BEFORE the lobes are resolved, so every sample
   normalises its own share and the total is fixed. Change LINE_SEGMENT_M or
   AREA_SAMPLES and the picture sharpens or softens; the brightness does not
   move. tools/test-heatmap.mjs asserts exactly that. */

/** How many pieces a run of this length is cut into. */
export const segmentsFor = (lengthM) => Math.min(
  LINE_SEGMENTS_MAX,
  Math.max(LINE_SEGMENTS_MIN, Math.round(lengthM / LINE_SEGMENT_M)));

/**
 * A SOURCE PLUS ITS PROFILE -> THE SAMPLES THE SOLVER INTEGRATES OVER.
 *
 * Each sample is `{ x, y, z, lobes, radius }`. `radius` is the sample's own
 * half-extent, which `soften` needs and which differs by shape: half a segment
 * for a line, half the sample cell for an area, and nothing at all for a point.
 *
 * THE AXES ARE RESOLVED HERE AND NOT PER CELL. A lobe names a direction — see
 * the vocabulary in profiles.js — and turning 'outward, 60 degrees below
 * horizontal' into a unit vector needs the fitting's wall normal, which is the
 * source's business and is settled once for all of its samples.
 */
export function expandSource(src, profile) {
  if (!profile || !(src.lm > 0)) return [];
  const lossKept = 1 - (profile.loss ?? 0);
  const beamDeg = src.beamDeg ?? profile.defaultBeam ?? null;
  const inward = src.inward ?? null;
  const outward = inward ? { x: -inward.x, y: -inward.y } : null;

  /** A lobe's direction as a unit 3-vector, from its name. */
  const axisOf = (lobe) => {
    switch (lobe.dir) {
      case 'up': return { x: 0, y: 0, z: 1 };
      case 'down': return { x: 0, y: 0, z: -1 };
      case 'omni': return null;
      case 'aim': return src.aim ?? { x: 0, y: 0, z: -1 };
      case 'inward':
      case 'outward': {
        const h = lobe.dir === 'inward' ? inward : outward;
        /* NO WALL, NO WALL DIRECTION. A fitting of a wall family whose wall
           could not be worked out falls back to straight down rather than
           picking an arbitrary compass bearing — a sconce thrown at a guessed
           wall is worse than a sconce thrown at the floor, because it is a
           confident statement about the wrong surface. */
        if (!h) return { x: 0, y: 0, z: -1 };
        const e = (lobe.elevDeg ?? 0) * DEG;
        const c = Math.cos(e);
        return { x: h.x * c, y: h.y * c, z: Math.sin(e) };
      }
      default: return { x: 0, y: 0, z: -1 };
    }
  };

  const lobesFor = (lm) => profile.lobes
    .map((lobe) => resolveLobe(lobe, { lm, beamDeg, axis: axisOf(lobe), inward }))
    .filter(Boolean);

  const g = src.geom;
  if (g.kind === 'point') {
    const lobes = lobesFor(src.lm * lossKept);
    return lobes.length ? [{ ...g.p, lobes, radius: src.radius ?? 0 }] : [];
  }

  if (g.kind === 'line') {
    const { a, b } = g;
    const L = Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
    const n = segmentsFor(L);
    const per = (src.lm * lossKept) / n;
    const lobes = lobesFor(per);
    if (!lobes.length) return [];
    const half = L / (2 * n);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push({
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
        // ONE SET OF LOBE OBJECTS SHARED BY EVERY SEGMENT. They are read-only
        // and identical — same share, same axis, same candela figure — so
        // building N copies would be N times the allocation for one answer.
        lobes, radius: half,
      });
    }
    return out;
  }

  if (g.kind === 'area') {
    const k = AREA_SAMPLES;
    const per = (src.lm * lossKept) / (k * k);
    const lobes = lobesFor(per);
    if (!lobes.length) return [];
    const out = [];
    // `u` and `v` are HALF-extents, so the sample offsets run -1..+1 across
    // them and the outermost samples sit inside the face rather than on its rim.
    const r = Math.hypot(g.u.x, g.u.y) / k + Math.hypot(g.v.x, g.v.y) / k;
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) {
        const su = k === 1 ? 0 : -1 + (2 * i) / (k - 1);
        const sv = k === 1 ? 0 : -1 + (2 * j) / (k - 1);
        // Pulled in by (k-1)/k so the samples represent equal sub-areas of the
        // face instead of straddling its edge.
        const fu = su * ((k - 1) / k), fv = sv * ((k - 1) / k);
        out.push({
          x: g.c.x + g.u.x * fu + g.v.x * fv,
          y: g.c.y + g.u.y * fu + g.v.y * fv,
          z: g.c.z, lobes, radius: r / 2,
        });
      }
    }
    return out;
  }

  if (g.kind === 'ring') {
    const n = Math.max(1, g.n | 0);
    const per = (src.lm * lossKept) / n;
    const lobes = lobesFor(per);
    if (!lobes.length) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TWO_PI;
      out.push({ x: g.c.x + Math.cos(a) * g.r, y: g.c.y + Math.sin(a) * g.r,
                 z: g.c.z, lobes, radius: g.r / 2 });
    }
    return out;
  }

  return [];
}

/** What one expanded source actually emits, in lumens — the sum of its samples'
 *  lobes. Read by the tests and by the legend's accounting, and it is the figure
 *  that must not move when the sampling changes. */
export const emittedLumens = (samples) => samples.reduce(
  (s, sm) => s + sm.lobes.reduce((t, L) => t + L.flux, 0), 0);
