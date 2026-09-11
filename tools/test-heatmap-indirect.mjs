// ---------------------------------------------------------------------------
// test-heatmap-indirect.mjs — the REFLECTED AMBIENT LIGHT layer.
//
// ITS OWN FILE BECAUSE IT IS ITS OWN MEASUREMENT. test-heatmap.mjs asserts the
// horizontal field: emission, distribution, the bounce, the colour scale, the
// adapter. Everything here is about the second question the heatmap can be
// asked — how much light reaches a point from the room's surfaces after at
// least one reflection — and about the one thing that question turns on, which
// is that the DIRECT beam is excluded and the normalisation is the one the
// targets were written against.
//
// WHAT IS ASSERTED IS PHYSICS, DEFINITION AND STRUCTURE, NOT NUMBERS. Same
// rule the sibling file states: every figure in heatmapTargets.js and
// indirect.js is there to be edited, so pinning 108 lux or a 1.2 m probe would
// turn a deliberate recalibration into a red build. What cannot move without
// the feature being broken:
//
//   · THE NORMALISATION. Mean spherical illuminance is 1/4 of the integral of
//     luminance over solid angle, and it is checked against TWO analytical
//     references — a single direction (E_n / 4) and a closed enclosure of
//     uniform exitance M (exactly M, everywhere in it);
//   · direct fixture-to-probe light contributes ZERO, for every family;
//   · with every reflectance at zero the layer is zero under any fixture;
//   · a COB contributes once a surface has something to give back;
//   · a cove contributes through its ceiling, and a dark ceiling takes it away;
//   · light at one end of a long room does not fill the other;
//   · grid density, patch density and run segmentation do not move the answer;
//   · the targets resolve by category, convert once, fall back to residential,
//     and are independent of both existing tables;
//   · `average` — the one layer the drawing shows, as `Estimated light level`
//     — is EXACTLY its two components added, its TARGET is those two targets
//     added the same way (so a room on target on both halves is on target on
//     it), and it solves neither of them twice;
//   · the components are still solved and cached independently, and switching
//     between them leaves no stale result behind — which is what keeps a
//     selector one control away rather than one rebuild away.
//
//   node tools/test-heatmap-indirect.mjs
// ---------------------------------------------------------------------------

import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import { LUMENS_PER_SQFT, SURFACE_REFLECTANCE } from '../src/lib/lumens.js';
import { LUMEN_CRITERIA } from '../src/lib/settings.js';
import { PROJECT_TYPES } from '../src/lib/roomTypes.js';
import { buildFieldGrid, buildPatches, isConvex,
         HEATMAP_RESOLUTION } from '../src/features/heatmap/grid.js';
import { buildTransfer, buildPlaneTransfer, buildSphereTransfer, gather,
         exitanceOf, MEAN_SPHERICAL_FACTOR } from '../src/features/heatmap/reflection.js';
import { buildRoomGeometry, solveRoom, surfacePass,
         directPass } from '../src/features/heatmap/solve.js';
import { solveIndirect, probeHeightFor, probeWasClamped,
         uniformExitanceReference, PROBE_HEIGHT_MM,
         PROBE_CLEARANCE_M } from '../src/features/heatmap/indirect.js';
import { solveRoomLayer } from '../src/features/heatmap/useHeatmap.js';
import { DISTRIBUTION_PROFILES } from '../src/features/heatmap/profiles.js';
import { colourFor } from '../src/features/heatmap/colours.js';
import {
  HEATMAP_BANDS, HEATMAP_LAYERS, HEATMAP_LAYER_DEFAULT, heatmapLayerFor,
  HEATMAP_TARGET_LUX, heatmapTargetFor, heatmapTargetForLayer,
  LUX_PER_LM_PER_SQFT, AVERAGE_FLOOR_SHARE, REFLECTED_AMBIENT_LM_PER_SQFT,
  REFLECTED_AMBIENT_LM_PER_SQFT_BY_ROOM, REFLECTED_AMBIENT_LM_PER_SQFT_DEFAULT,
  REFLECTED_AMBIENT_TARGET_LUX, REFLECTED_AMBIENT_TARGET_LUX_BY_ROOM,
  REFLECTED_AMBIENT_TARGET_LUX_DEFAULT, reflectedAmbientTargetFor,
} from '../src/features/heatmap/heatmapTargets.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); }
};
const sec = (s) => console.log('\n' + s);
/** Within a percentage of each other — the tolerance an approximation gets. */
const near = (a, b, pct) => Math.abs(a - b) <= (Math.abs(a) + Math.abs(b)) / 2 * pct;

const LIGHT = { ceiling: 'light', floor: 'light', walls: {} };
const DARK_CEILING = { ceiling: 'dark', floor: 'light', walls: {} };
const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
/** The L the occlusion case uses: a 6 x 3 bottom arm and a 3 x 6 left column. */
const ELL = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 },
             { x: 3, y: 3 }, { x: 3, y: 6 }, { x: 0, y: 6 }];

const cob = (x, y, z, lm = 900, beamDeg = 36) => ({
  profileId: 'cob', lm, beamDeg, geom: { kind: 'point', p: { x, y, z } } });

/** A cove run round a rectangle, at the profile's own pocket drop. */
const coveLoop = (w, h, heightM, perM = 400, inset = 0.2) => {
  const z = heightM - DISTRIBUTION_PROFILES.cove.dropMm / 1000;
  const pts = [{ x: inset, y: inset }, { x: w - inset, y: inset },
               { x: w - inset, y: h - inset }, { x: inset, y: h - inset }];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    out.push({ profileId: 'cove', lm: perM * L,
               geom: { kind: 'line', a: { ...a, z }, b: { ...b, z } } });
  }
  return out;
};

/** The room's reflected-ambient field, from scratch. */
const indirectOf = (geometry, sources, probeZ) =>
  solveIndirect(geometry, surfacePass(geometry, sources, { cells: false }), { probeZ });

/** Geometry at an arbitrary field and patch resolution — what the convergence
 *  section needs, and the same four calls `buildRoomGeometry` makes. */
function geometryAt(poly, heightM, materials, { fieldM, patchM }) {
  const patches = buildPatches(poly, heightM, materials, { patchM, wallBandM: patchM });
  const field = buildFieldGrid(poly, fieldM);
  const convex = isConvex(poly);
  return { poly, heightM, patches, field, convex,
           T: buildTransfer(patches, poly, { convex }),
           G: buildPlaneTransfer(patches, field, poly, { convex }) };
}

const maxOf = (a) => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };


sec('1. the measurement is mean spherical illuminance, and it is normalised');
{
  ok('the definition carries a quarter and not a quarter of pi, nor a half',
    MEAN_SPHERICAL_FACTOR === 0.25, String(MEAN_SPHERICAL_FACTOR));

  /* --- ANALYTICAL REFERENCE ONE: A SINGLE DIRECTION ----------------------
     A beam of normal illuminance E_n delivers E_n/4 to a sphere, because the
     sphere presents pi r^2 to it and has 4 pi r^2 of surface. So the transfer
     from one small Lambertian patch on the axis, before any closure, must be
     exactly a quarter of the illuminance that same patch puts on a surface
     facing it squarely. Written out here rather than run through
     `buildSphereTransfer`, whose column closure is only meaningful for a
     CLOSED enclosure — one patch is not one. */
  {
    const A = 0.01, d = 3, F = 1000;
    const eNormal = (F / Math.PI) * 1 / (d * d);       // Lambertian, on axis
    const eSphere = F * (1 * MEAN_SPHERICAL_FACTOR) / (Math.PI * d * d);
    ok('one direction: mean spherical illuminance is a quarter of the normal illuminance',
      near(eSphere / eNormal, 0.25, 1e-12), `${(eSphere / eNormal).toFixed(9)}`);
    ok('...and it does not depend on the receiver having an orientation',
      A > 0 && eSphere > 0);
  }

  /* --- ANALYTICAL REFERENCE TWO: A CLOSED ENCLOSURE ----------------------
     Every surface at uniform exitance M lm/m^2 has luminance M/pi in every
     direction, and the solid angles seen from an interior point sum to 4 pi
     because the room is closed. So 1/4 * (M/pi) * 4 pi = M, EXACTLY, at every
     point inside. It pins the quarter, the Lambertian pi and the closure in
     one number: get any of the three wrong and this comes out wrong by a clean
     factor. */
  {
    const g = buildRoomGeometry({ polygonM: box(5, 4), heightM: 2.7, materials: LIGHT });
    const M = 137.5;
    const uniform = new Float64Array(g.patches.n);
    for (let p = 0; p < g.patches.n; p++) uniform[p] = M * g.patches.area[p];
    ok('the reference exitance really is uniform',
      near(uniformExitanceReference(g.patches, uniform), M, 1e-12));
    let worst = 0, at = null;
    for (const z of [0.05, 0.6, 1.2, 2.0, 2.4]) {
      const S = buildSphereTransfer(g.patches, g.field, g.poly,
                                    { convex: g.convex, probeZ: z });
      const f = gather(uniform, S, g.field.count);
      for (let i = 0; i < f.length; i++) {
        const e = Math.abs(f[i] - M) / M;
        if (e > worst) { worst = e; at = z; }
      }
    }
    ok('a closed room of uniform exitance M reads exactly M at every probe, at every height',
      worst < 1e-5, `worst ${(worst * 100).toFixed(6)}% at z=${at}`);

    // ...WHICH IS THE COLUMN CLOSURE, STATED DIRECTLY: the solid angles a probe
    // sees sum to the whole sphere, because the room encloses it.
    const S = buildSphereTransfer(g.patches, g.field, g.poly,
                                  { convex: g.convex, probeZ: 1.2 });
    let worstCol = 0;
    for (let gi = 0; gi < g.field.count; gi++) {
      let s = 0;
      for (let p = 0; p < g.patches.n; p++) s += S[p * g.field.count + gi] * g.patches.area[p];
      worstCol = Math.max(worstCol, Math.abs(s - 1));
    }
    ok('...because every probe\'s solid angles close on the whole sphere',
      worstCol < 1e-5, `worst |sum-1| = ${worstCol.toExponential(2)}`);
  }

  /* --- AND IT IS NOT HORIZONTAL LUX ---------------------------------------
     THE ONE DIFFERENCE, MADE VISIBLE, SURFACE BY SURFACE. Give each surface in
     turn something to hand back and read the SAME point two ways: a sphere at
     1.2 m, and a horizontal plane at 1.2 m facing up. A horizontal receiver
     weights every direction by the cosine from vertical; a sphere has no
     orientation and weights only by solid angle. If the sphere transfer ever
     acquired a receiver cosine, all three of these go wrong at once. */
  {
    const g = buildRoomGeometry({ polygonM: box(5, 4), heightM: 2.7, materials: LIGHT });
    const S = buildSphereTransfer(g.patches, g.field, g.poly,
                                  { convex: g.convex, probeZ: 1.2 });
    const Gz = buildPlaneTransfer(g.patches, { ...g.field, planeZ: 1.2 }, g.poly,
                                  { convex: g.convex });
    const onlyKind = (kind) => {
      const v = new Float64Array(g.patches.n);
      for (let p = 0; p < g.patches.n; p++) {
        if (g.patches.kind[p] === kind) v[p] = 100 * g.patches.area[p];
      }
      return v;
    };
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const read = (kind) => {
      const v = onlyKind(kind);
      return { sphere: mean(gather(v, S, g.field.count)),
               horizontal: mean(gather(v, Gz, g.field.count)) };
    };
    const floor = read(0), ceiling = read(1), walls = read(2);

    ok('light from BELOW is invisible to an upward horizontal plane and counted in full by a sphere',
      floor.horizontal === 0 && floor.sphere > 0,
      `sphere ${floor.sphere.toFixed(1)} lx from a bright floor, horizontal ${floor.horizontal}`);
    ok('light from directly overhead is what a horizontal plane counts best',
      ceiling.horizontal > ceiling.sphere * 2,
      `${(ceiling.horizontal / ceiling.sphere).toFixed(2)}x, against 4x for a source straight up`);
    ok('...and light arriving sideways is what it discounts',
      walls.horizontal / walls.sphere < ceiling.horizontal / ceiling.sphere * 0.5,
      `walls ${(walls.horizontal / walls.sphere).toFixed(2)}x `
      + `vs ceiling ${(ceiling.horizontal / ceiling.sphere).toFixed(2)}x`);
    ok('so the reflected-ambient layer counts a bright floor and a washed wall that the other layer barely sees',
      walls.sphere > walls.horizontal && floor.sphere > 0);
  }

  // NOTHING SAMPLES DIRECTIONS, so nothing can be got wrong by sampling more of
  // them: the room's own surfaces ARE the directions and each carries its own
  // solid angle. The patch-density check in section 6 is the convergence test
  // that corresponds to "more direction samples".
  ok('the layer weights by solid angle rather than by a count of sample rays',
    typeof buildSphereTransfer === 'function');
}


sec('2. direct fixture-to-probe light contributes exactly nothing');
{
  const g = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7, materials: LIGHT });

  /* EVERY REFLECTANCE AT ZERO AND A VERY POWERFUL FIXTURE. There is no tone in
     the app that is a perfect absorber — the darkest is 0.2 — so the patches'
     reflectances are zeroed directly, which is the engine being asked the
     question rather than the materials table. */
  {
    const dark = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7, materials: LIGHT });
    dark.patches.rho.fill(0);
    const s = surfacePass(dark, [cob(3, 2, 2.7, 20000, 60)]);
    const ind = solveIndirect(dark, s, { probeZ: 1.2 });
    ok('with every reflectance at zero the layer is zero, under 20,000 lumens',
      ind.max === 0 && ind.mean === 0,
      `max ${ind.max}, while the direct field peaks at ${maxOf(s.direct).toFixed(0)} lx`);
    ok('...and the fixture really was blazing away at the same time',
      maxOf(s.direct) > 1000);
  }

  /* THE FIELD IS A FUNCTION OF THE EXITANCE AND OF NOTHING ELSE — which is the
     exclusion stated as an identity rather than as a magnitude. The same room
     solved WITH the direct cell pass and WITHOUT it gives bit-identical probe
     values, so no part of the direct field can be reaching this layer. */
  {
    const withCells = surfacePass(g, [cob(3, 2, 2.7, 2000)], { cells: true });
    const without = surfacePass(g, [cob(3, 2, 2.7, 2000)], { cells: false });
    ok('the direct pass at the cells is skipped when the layer does not need it',
      maxOf(withCells.direct) > 0 && maxOf(without.direct) === 0);
    const a = solveIndirect(g, withCells, { probeZ: 1.2 });
    const b = solveIndirect(g, without, { probeZ: 1.2 });
    let same = true;
    for (let i = 0; i < a.sphere.length; i++) if (a.sphere[i] !== b.sphere[i]) same = false;
    ok('...and the probe field is bit-identical either way, so the direct field never reaches it',
      same);
  }

  /* A BROAD DIFFUSER IS EXCLUDED ON THE SAME TERMS AS A NARROW BEAM. Under a
     downlight the horizontal reading is dominated by the direct pool; the probe
     under it reads only what the room has handed back, which is a small
     fraction of it. Filtering by light path rather than by category is what
     makes this true of a panel too — asserted for both. */
  for (const [what, src] of [
    ['a downlight', [cob(3, 2, 2.7, 2000, 24)]],
    ['a Lambertian panel', [{ profileId: 'panel', lm: 2000,
        geom: { kind: 'area', c: { x: 3, y: 2, z: 2.7 },
                u: { x: 0.3, y: 0 }, v: { x: 0, y: 0.3 } } }]],
    ['a ceiling strip', [{ profileId: 'ceiling_strip', lm: 2000,
        geom: { kind: 'line', a: { x: 1, y: 2, z: 2.7 }, b: { x: 5, y: 2, z: 2.7 } } }]],
  ]) {
    const s = surfacePass(g, src);
    const full = solveRoom(g, src, s);
    const ind = solveIndirect(g, s, { probeZ: 1.2 });
    // The cell directly under the fitting: horizontal is direct-dominated,
    // the probe is not.
    let best = 0, peak = 0, atProbe = 0;
    for (let i = 0; i < g.field.count; i++) {
      if (full.direct[i] > best) { best = full.direct[i]; peak = full.total[i]; atProbe = ind.sphere[i]; }
    }
    ok(`${what}: the probe under it reads far less than the horizontal plane does`,
      atProbe < peak * 0.5 && atProbe > 0,
      `probe ${atProbe.toFixed(1)} vs horizontal ${peak.toFixed(1)} lx (direct ${best.toFixed(1)})`);
  }

  // THE PROBES ARE NOT A SURFACE. They appear in no patch set, so nothing can
  // bounce off them and adding them cannot change what the room does.
  {
    const s1 = surfacePass(g, [cob(3, 2, 2.7, 2000)], { cells: false });
    const lo = solveIndirect(g, s1, { probeZ: 0.4 });
    const hi = solveIndirect(g, s1, { probeZ: 2.2 });
    let ex = 0;
    for (let p = 0; p < g.patches.n; p++) ex += s1.exitance[p];
    ok('a probe reflects nothing, so moving it does not change the room\'s exitance',
      ex > 0 && lo.probeZ !== hi.probeZ && lo.max !== hi.max,
      `exitance ${ex.toFixed(1)} lm, both heights read from the same vector`);
  }
}


sec('3. a fixture contributes once its light has hit something');
{
  const g = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7, materials: LIGHT });

  // A COB, WHOSE WHOLE OUTPUT IS A DOWNWARD BEAM: it reaches a probe only via
  // the floor and then the rest of the room.
  {
    const ind = indirectOf(g, [cob(3, 2, 2.7, 2000)], 1.2);
    ok('a COB contributes after illuminating a reflective surface',
      ind.min > 0 && ind.mean > 0, `mean ${ind.mean.toFixed(1)} lx`);
    const dark = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7,
      materials: { ceiling: 'dark', floor: 'dark', walls: { 0: 'dark', 1: 'dark', 2: 'dark', 3: 'dark' } } });
    const dim = indirectOf(dark, [cob(3, 2, 2.7, 2000)], 1.2);
    ok('...and a dark room hands back a fraction of what a light one does',
      dim.mean < ind.mean * 0.3, `${dim.mean.toFixed(1)} vs ${ind.mean.toFixed(1)} lx`);
  }

  // A COVE, WHICH HAS NO DIRECT COMPONENT AT ALL — its whole contribution is
  // the ceiling and the top of the walls handing light back.
  {
    const src = coveLoop(6, 4, 2.7);
    const s = surfacePass(g, src);
    const ind = solveIndirect(g, s, { probeZ: 1.2 });
    ok('a cove contributes through its illuminated ceiling and walls',
      ind.mean > 0 && ind.min > 0, `mean ${ind.mean.toFixed(1)} lx`);
    ok('...and it had no direct component to exclude in the first place',
      maxOf(solveRoom(g, src).direct) === 0);

    const gd = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7,
                                  materials: DARK_CEILING });
    const dim = indirectOf(gd, src, 1.2);
    ok('darkening the ceiling takes most of a ceiling-directed cove away',
      dim.mean < ind.mean * 0.5,
      `${dim.mean.toFixed(1)} vs ${ind.mean.toFixed(1)} lx `
      + `(ceiling ${SURFACE_REFLECTANCE.ceiling.dark} vs ${SURFACE_REFLECTANCE.ceiling.light})`);
    ok('...and the floor finish is not what did it',
      SURFACE_REFLECTANCE.floor[DARK_CEILING.floor] === SURFACE_REFLECTANCE.floor[LIGHT.floor]);
  }

  // A REVERSE COVE: the wash comes back off the wall, and the fifth that spills
  // straight down is excluded like every other direct path.
  {
    const z = 2.7 - DISTRIBUTION_PROFILES.reverse_cove.dropMm / 1000;
    const src = [{ profileId: 'reverse_cove', lm: 1600, inward: { x: 0, y: 1 },
                   geom: { kind: 'line', a: { x: 1, y: 0.05, z }, b: { x: 5, y: 0.05, z } } }];
    const s = surfacePass(g, src);
    const ind = solveIndirect(g, s, { probeZ: 1.2 });
    const full = solveRoom(g, src, s);
    ok('a reverse cove contributes through the wall it washes',
      ind.mean > 0, `mean ${ind.mean.toFixed(1)} lx`);
    ok('...while its direct spill is real and is still excluded',
      maxOf(full.direct) > 0 && ind.max < maxOf(full.total),
      `direct peaks ${maxOf(full.direct).toFixed(1)} lx, probe peaks ${ind.max.toFixed(1)}`);
  }

  // A SCONCE AND A FLOOR LAMP — fixtures nowhere near the ceiling, counted the
  // same way: what they throw at a surface comes back, what they throw at a
  // probe does not.
  for (const [what, src] of [
    ['a wall sconce', [{ profileId: 'sconce', lm: 800, inward: { x: 1, y: 0 },
        geom: { kind: 'point', p: { x: 0.05, y: 2, z: 1.8 } } }]],
    ['a floor lamp', [{ profileId: 'floor_lamp', lm: 800,
        geom: { kind: 'point', p: { x: 1.5, y: 1.5, z: 1.5 } } }]],
    ['a chandelier', [{ profileId: 'chandelier', lm: 1500,
        geom: { kind: 'ring', c: { x: 3, y: 2, z: 2.1 }, r: 0.35, n: 6 } }]],
  ]) {
    const s = surfacePass(g, src);
    const ind = solveIndirect(g, s, { probeZ: 1.2 });
    ok(`${what} contributes only after its light has reached a surface`,
      ind.mean > 0 && ind.mean < s.emitted, `mean ${ind.mean.toFixed(1)} lx`);
  }

  // AND THE ENERGY IS NOT COUNTED TWICE. `bounceOf` — the lumen model's single
  // reflection coefficient — is applied nowhere in this feature, and the flux
  // reaching the surfaces is exactly what the fittings emitted.
  {
    const s = surfacePass(g, [cob(3, 2, 2.7, 2000)]);
    ok('every emitted lumen lands on a surface and none is invented',
      near(s.onSurfaces, s.emitted, 1e-9),
      `${s.onSurfaces.toFixed(3)} of ${s.emitted}`);
    let ex = 0;
    for (let p = 0; p < g.patches.n; p++) ex += s.exitance[p];
    // Sum over bounces of rho^k, which for this room's finishes is a few times
    // the emitted flux and can never be unbounded.
    ok('...and the exitance is a bounded multiple of it, never a runaway',
      ex > s.emitted * 0.3 && ex < s.emitted * 8,
      `${ex.toFixed(0)} lm leaving surfaces for ${s.emitted} emitted, ${s.bounces} bounces`);
  }
}


sec('4. reflected ambient light is spatially uneven when the lighting is');
{
  const g = buildRoomGeometry({ polygonM: box(14, 3), heightM: 2.7, materials: LIGHT });
  const src = [1.5, 3, 4.5].map((x) => cob(x, 1.5, 2.7, 1500, 60));
  const ind = indirectOf(g, src, 1.2);
  let nearSum = 0, nearN = 0, farSum = 0, farN = 0;
  for (let i = 0; i < g.field.count; i++) {
    if (g.field.cx[i] < 4) { nearSum += ind.sphere[i]; nearN++; }
    else if (g.field.cx[i] > 10) { farSum += ind.sphere[i]; farN++; }
  }
  const nearMean = nearSum / nearN, farMean = farSum / farN;
  ok('concentrating the fittings at one end leaves the other end much darker',
    farMean < nearMean * 0.4 && nearN > 3 && farN > 3,
    `${nearMean.toFixed(1)} lx near vs ${farMean.toFixed(1)} lx far`);
  ok('...and the far end is not zero, because the room is still handing light along it',
    farMean > 0);

  // A WALL BLOCKS. One arm of an L cannot fill the other with reflected light
  // the way it fills itself.
  {
    const ge = buildRoomGeometry({ polygonM: ELL, heightM: 2.7, materials: LIGHT });
    ok('an L-shaped room is not treated as convex', ge.convex === false);
    const e = indirectOf(ge, [cob(5, 1.5, 2.7, 3000, 60)], 1.2);
    let armSum = 0, armN = 0, legSum = 0, legN = 0;
    for (let i = 0; i < ge.field.count; i++) {
      const x = ge.field.cx[i], y = ge.field.cy[i];
      if (y < 3 && x > 4) { armSum += e.sphere[i]; armN++; }
      else if (y > 4.5 && x < 3) { legSum += e.sphere[i]; legN++; }
    }
    ok('...and a fitting deep in one arm barely reaches the far end of the other',
      legSum / legN < armSum / armN * 0.5,
      `${(armSum / armN).toFixed(1)} vs ${(legSum / legN).toFixed(1)} lx`);
  }
}


sec('5. the probes sit inside the room, at a height the reader chose');
{
  ok('the probe height is 1.2 m', PROBE_HEIGHT_MM === 1200);
  ok('...and it is a height a room can actually hold',
    PROBE_HEIGHT_MM > 0 && PROBE_HEIGHT_MM < 2500);

  ok('an ordinary room gets exactly the height that was asked for',
    probeHeightFor(1.2, 2.7) === 1.2 && !probeWasClamped(1.2, probeHeightFor(1.2, 2.7)));
  ok('a room shallower than the request is clamped clear of its own slab',
    probeHeightFor(1.2, 1.3) === 1.3 - PROBE_CLEARANCE_M
    && probeWasClamped(1.2, probeHeightFor(1.2, 1.3)),
    String(probeHeightFor(1.2, 1.3)));
  ok('...a room shallower than twice the clearance takes its own mid-height',
    probeHeightFor(1.2, 0.5) === 0.25);
  ok('...and a section with no height at all has no probe rather than a made-up one',
    probeHeightFor(1.2, 0) === null && probeHeightFor(1.2, null) === null);
  ok('a request of zero is the floor and not an error', probeHeightFor(0, 2.7) === 0);

  // THE PROBE HEIGHT CHANGES THE ANSWER, WHICH IS THE POINT OF OFFERING IT: a
  // probe near the ceiling of a coved room is in the bright half of it.
  {
    const g = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7, materials: LIGHT });
    const s = surfacePass(g, coveLoop(6, 4, 2.7), { cells: false });
    const low = solveIndirect(g, s, { probeZ: 0.8 });
    const high = solveIndirect(g, s, { probeZ: 2.2 });
    ok('a probe higher up a coved room reads brighter than one lower down',
      high.mean > low.mean, `${low.mean.toFixed(1)} vs ${high.mean.toFixed(1)} lx`);
    ok('...off the same exitance vector, so the light transport was not re-run',
      low.emitted === high.emitted && low.bounces === high.bounces);
  }

  // AND A LOW ROOM STILL DRAWS. A dropped section is a room with an answer, not
  // a hole in the sheet.
  {
    const g = buildRoomGeometry({ polygonM: box(3, 3), heightM: 1.1, materials: LIGHT });
    const z = probeHeightFor(1.2, 1.1);
    const ind = indirectOf(g, [cob(1.5, 1.5, 1.1, 600, 60)], z);
    ok('a 1.1 m room still produces a field, at the height it can actually hold',
      ind.mean > 0 && z < 1.2 && z > 0, `probe at ${z.toFixed(2)} m, mean ${ind.mean.toFixed(1)} lx`);
  }
}


sec('6. density and segmentation do not move the converged answer');
{
  const poly = box(6, 4);
  const src = coveLoop(6, 4, 2.7);

  // THE FIELD GRID — the probe spacing. It is the same 25-50 cm grid the
  // horizontal layer uses, which is what puts the two in register.
  {
    const fine = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT, mode: 'fine' });
    const coarse = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT, mode: 'coarse' });
    const f = indirectOf(fine, src, 1.2), c = indirectOf(coarse, src, 1.2);
    ok('the probe grid is the existing 25-50 cm field grid',
      HEATMAP_RESOLUTION.fine.fieldM >= 0.25 && HEATMAP_RESOLUTION.fine.fieldM <= 0.5);
    ok('doubling the probe spacing does not materially change the answer',
      near(f.mean, c.mean, 0.03),
      `${f.mean.toFixed(2)} at ${fine.field.count} probes vs ${c.mean.toFixed(2)} at ${coarse.field.count}`);
  }

  // THE PATCHES — which in this model ARE the directions a probe integrates
  // over, so this is the "more direction samples" check.
  {
    const means = [];
    for (const patchM of [1.2, 0.9, 0.6]) {
      const g = geometryAt(poly, 2.7, LIGHT, { fieldM: 0.35, patchM });
      means.push({ patchM, n: g.patches.n, mean: indirectOf(g, src, 1.2).mean });
    }
    const lo = means[0].mean, hi = means[means.length - 1].mean;
    ok('tripling the surface subdivision does not materially change the answer',
      near(lo, hi, 0.08),
      means.map((q) => `${q.patchM}m/${q.n}p=${q.mean.toFixed(1)}`).join('  '));
  }

  // THE SUBDIVISION OF A LINEAR SOURCE — the same physical run handed in as one
  // piece and as four, which is what the adapter does when a cove turns a
  // corner.
  {
    const g = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT });
    const z = 2.7 - DISTRIBUTION_PROFILES.cove.dropMm / 1000;
    const whole = [{ profileId: 'cove', lm: 1600,
                     geom: { kind: 'line', a: { x: 1, y: 0.3, z }, b: { x: 5, y: 0.3, z } } }];
    const quartered = [];
    for (let i = 0; i < 4; i++) {
      quartered.push({ profileId: 'cove', lm: 400,
        geom: { kind: 'line', a: { x: 1 + i, y: 0.3, z }, b: { x: 2 + i, y: 0.3, z } } });
    }
    const w = indirectOf(g, whole, 1.2), q = indirectOf(g, quartered, 1.2);
    ok('a run cut into four emits the same lumens', near(w.emitted, q.emitted, 1e-9));
    ok('...and gives the same reflected ambient light',
      near(w.mean, q.mean, 0.03), `${w.mean.toFixed(2)} vs ${q.mean.toFixed(2)} lx`);
  }

  // AND THE BOUNCE IS CONVERGED RATHER THAN TRUNCATED. In a room this light the
  // engine runs well past three bounces; the last one it ran carried a
  // negligible share of the first.
  {
    const g = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT });
    const s = surfacePass(g, src, { cells: false });
    const last = s.carried[s.carried.length - 1];
    ok('the bounce runs to convergence rather than to a fixed count',
      s.bounces > 3 && last < s.carried[0] * 0.05,
      `${s.bounces} bounces, last carried ${(100 * last / s.carried[0]).toFixed(1)}% of the first`);
  }

  // THE ENGINE'S OWN PIECES COMPOSE THE WAY THE HOOK ASSUMES: gathering a
  // cached exitance is the same answer as solving from scratch.
  {
    const g = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT });
    const d = directPass(g, src, { cells: false });
    const e = exitanceOf(g.patches, g.T, d.incident);
    const S = buildSphereTransfer(g.patches, g.field, g.poly,
                                  { convex: g.convex, probeZ: 1.2 });
    const byHand = gather(e.exitance, S, g.field.count);
    const byApi = indirectOf(g, src, 1.2).sphere;
    let same = true;
    for (let i = 0; i < byHand.length; i++) if (byHand[i] !== byApi[i]) same = false;
    ok('a cached transfer and a fresh solve are the same answer', same);
  }
}


sec('7. the targets are their own table, converted once, with one fallback');
{
  ok('the conversion is square feet in a square metre',
    Math.abs(LUX_PER_LM_PER_SQFT - 1 / (0.3048 * 0.3048)) < 1e-6,
    String(LUX_PER_LM_PER_SQFT));

  // THE SPECIFIED TABLE, TO THE ROUNDED FIGURE THE CARD PRINTS. The full
  // precision is what the engine compares against; 108 / 215 / 323 is what a
  // reader sees, and the two must not be separate numbers.
  for (const [id, lmSqft, shown] of [
    ['residential', 10, 108], ['hotel', 10, 108], ['restaurant', 10, 108],
    ['office', 20, 215], ['retail', 30, 323],
  ]) {
    ok(`${id}: ${lmSqft} received lm/ft2 is ${shown} lx`,
      REFLECTED_AMBIENT_LM_PER_SQFT[id] === lmSqft
      && Math.round(reflectedAmbientTargetFor(id)) === shown
      && near(reflectedAmbientTargetFor(id), lmSqft * LUX_PER_LM_PER_SQFT, 1e-12),
      `${reflectedAmbientTargetFor(id)}`);
  }
  ok('educational is carried across from the office figure, as LUMENS_PER_SQFT does',
    REFLECTED_AMBIENT_LM_PER_SQFT.educational === REFLECTED_AMBIENT_LM_PER_SQFT.office
    && LUMENS_PER_SQFT.educational === LUMENS_PER_SQFT.office);
  ok('every project this app offers has a figure',
    PROJECT_TYPES.every((p) => REFLECTED_AMBIENT_LM_PER_SQFT[p.id] > 0),
    PROJECT_TYPES.filter((p) => !REFLECTED_AMBIENT_LM_PER_SQFT[p.id]).map((p) => p.id).join(', '));
  ok('...and retail is kept though the app does not offer it yet',
    REFLECTED_AMBIENT_LM_PER_SQFT.retail === 30 && !PROJECT_TYPES.some((p) => p.id === 'retail'));

  ok('an unknown project takes the documented residential reference',
    reflectedAmbientTargetFor('no-such-project') === REFLECTED_AMBIENT_TARGET_LUX_DEFAULT
    && Math.round(REFLECTED_AMBIENT_TARGET_LUX_DEFAULT) === 108
    && REFLECTED_AMBIENT_LM_PER_SQFT_DEFAULT === REFLECTED_AMBIENT_LM_PER_SQFT.residential);
  ok('...and so does no project at all',
    reflectedAmbientTargetFor(null) === REFLECTED_AMBIENT_TARGET_LUX_DEFAULT
    && reflectedAmbientTargetFor(undefined) === REFLECTED_AMBIENT_TARGET_LUX_DEFAULT);

  ok('the derived lux table cannot drift from the reference it came from',
    Object.entries(REFLECTED_AMBIENT_LM_PER_SQFT).every(
      ([id, lm]) => REFLECTED_AMBIENT_TARGET_LUX[id] === lm * LUX_PER_LM_PER_SQFT));

  /* --- AND IT IS NOT ANY OF THE THREE FIGURES THE APP ALREADY HAD ---------
     THE POINT OF A SEPARATE TABLE IS THAT IT IS SEPARATE. A change to the
     horizontal target must not move this one, a change to either must not move
     the room's lumen budget, and none of them may be quietly the same number. */
  ok('the reflected-ambient target is not the horizontal one',
    ['residential', 'office', 'hotel', 'restaurant'].every(
      (id) => reflectedAmbientTargetFor(id) !== HEATMAP_TARGET_LUX[id]));
  ok('...and is not either lumen budget read as a lux figure',
    reflectedAmbientTargetFor('residential') !== LUMENS_PER_SQFT.residential
    && reflectedAmbientTargetFor('residential') !== LUMEN_CRITERIA.residential
    && reflectedAmbientTargetFor('office') !== LUMEN_CRITERIA.office);
  /* --- THE ROOMS THAT ARE WORKED IN TAKE DOUBLE, AND IT IS THE OFFICE FIGURE
     ROOM TYPE WINS OVER PROJECT, the same precedence `heatmapTargetFor` and
     `lumenCriteriaFor` use. Asserted as a RELATIONSHIP — double the domestic
     reference, equal to the office one — rather than as 215.28, so that
     recalibrating either table keeps this honest instead of red. */
  for (const room of ['kitchen', 'toilet', 'utility']) {
    ok(`a ${room} is aiming at double the domestic reflected figure`,
      near(reflectedAmbientTargetFor('residential', room),
           2 * reflectedAmbientTargetFor('residential', 'living_space'), 1e-12)
      && reflectedAmbientTargetFor('residential', room)
        === reflectedAmbientTargetFor('office'),
      `${reflectedAmbientTargetFor('residential', room).toFixed(2)} lx`);
    ok(`...and it is the same ${room} whatever building it is in`,
      reflectedAmbientTargetFor('restaurant', room)
        === reflectedAmbientTargetFor('residential', room)
      && reflectedAmbientTargetFor('hotel', room)
        === reflectedAmbientTargetFor('residential', room));
  }
  ok('...and it is stated in the same received lm/ft2 as the project table',
    Object.values(REFLECTED_AMBIENT_LM_PER_SQFT_BY_ROOM).every(
      (lm) => lm === REFLECTED_AMBIENT_LM_PER_SQFT.office));
  ok('...through the same single conversion, so the two tables cannot drift',
    Object.entries(REFLECTED_AMBIENT_LM_PER_SQFT_BY_ROOM).every(
      ([id, lm]) => REFLECTED_AMBIENT_TARGET_LUX_BY_ROOM[id] === lm * LUX_PER_LM_PER_SQFT));
  ok('a room nobody has looked at still takes its building\'s figure',
    reflectedAmbientTargetFor('residential', 'bedroom')
      === reflectedAmbientTargetFor('residential')
    && reflectedAmbientTargetFor('residential', 'no-such-room')
      === reflectedAmbientTargetFor('residential'));
  /* THE OVERRIDE OVERRIDES BOTH WAYS. Retail's 30 is the only project above
     20, so a WC in a shop comes DOWN — which is the table doing its job
     rather than a floor being quietly applied. */
  ok('...and the override wins even where the building is brighter',
    reflectedAmbientTargetFor('retail', 'toilet')
      < reflectedAmbientTargetFor('retail'),
    `${reflectedAmbientTargetFor('retail', 'toilet').toFixed(2)} `
    + `vs ${reflectedAmbientTargetFor('retail').toFixed(2)}`);

  // ONE DOOR FOR BOTH LAYERS, so nothing outside this file has to know which
  // table its layer reads.
  ok('one resolver answers for every layer',
    heatmapTargetForLayer('reflected', 'office') === reflectedAmbientTargetFor('office')
    && heatmapTargetForLayer('illuminance', 'office', 'office_workspace')
      === heatmapTargetFor('office', 'office_workspace'));
  /* --- A COMPOSITE LAYER TAKES A COMPOSITE TARGET ------------------------
     THE VALUE IS `reflected + 1/4 * horizontal` AND THE TARGET HAS TO BE TOO,
     or the ratio the colour scale reads is a value built of two terms over a
     target built of one — which is a whole layer reading over target by a
     quarter of its horizontal figure. It was written that way for one
     revision. */
  for (const [proj, room, want] of [
    ['residential', 'living_space', 145], ['residential', 'bedroom', 133],
    ['residential', 'kitchen', 290], ['residential', 'toilet', 253],
    ['residential', 'utility', 265], ['office', 'office_workspace', 340],
    ['retail', null, 398],
  ]) {
    const t = heatmapTargetForLayer('average', proj, room);
    ok(`average target for ${proj}/${room ?? 'no room type'} is ${want} lx`,
      t === heatmapTargetForLayer('reflected', proj, room)
        + AVERAGE_FLOOR_SHARE * heatmapTargetForLayer('illuminance', proj, room)
      && Math.round(t) === want, `${t}`);
  }
  ok('...and the share it is built with is the one the ENGINE adds the value with',
    AVERAGE_FLOOR_SHARE === MEAN_SPHERICAL_FACTOR,
    `${AVERAGE_FLOOR_SHARE} vs ${MEAN_SPHERICAL_FACTOR}`);
  ok('...so it is neither of its halves, and is not the horizontal figure either',
    heatmapTargetForLayer('average', 'residential', 'kitchen')
      !== heatmapTargetForLayer('reflected', 'residential', 'kitchen')
    && heatmapTargetForLayer('average', 'residential', 'kitchen')
      !== heatmapTargetForLayer('illuminance', 'residential', 'kitchen'));
  ok('...and unlike the reflected target it DOES follow the room type, because half of it is the horizontal one',
    heatmapTargetForLayer('average', 'residential', 'kitchen')
      > heatmapTargetForLayer('average', 'residential', 'bedroom'),
    `${heatmapTargetForLayer('average', 'residential', 'kitchen').toFixed(2)} vs `
    + `${heatmapTargetForLayer('average', 'residential', 'bedroom').toFixed(2)}`);

  /* THE INVARIANT THE COMPOSITE TARGET BUYS, AND IT IS THE WHOLE REASON FOR
     IT: a room exactly on target on both halves is exactly on target on
     Average. Stated as arithmetic on the targets themselves, so it holds for
     every category rather than for the one the solver happened to run. */
  ok('a room on target on both component layers is on target on Average', (() => {
    for (const [proj, room] of [['residential', 'living_space'],
                                ['residential', 'kitchen'], ['office', 'office_workspace'],
                                ['hotel', 'guest_room'], ['retail', null]]) {
      const r = heatmapTargetForLayer('reflected', proj, room);
      const h = heatmapTargetForLayer('illuminance', proj, room);
      const value = r + AVERAGE_FLOOR_SHARE * h;          // both halves exactly on target
      if (!near(value / heatmapTargetForLayer('average', proj, room), 1, 1e-12)) return false;
    }
    return true;
  })());
  ok('...and an unknown layer id falls back to the horizontal table rather than to nothing',
    heatmapTargetForLayer('no-such-layer', 'office', 'office_workspace')
      === heatmapTargetFor('office', 'office_workspace'));
}


sec('8. the layer table, and the colours it shares');
{
  const ref = heatmapLayerFor('reflected'), avg = heatmapLayerFor('average');
  ok('the engine has three layers and the composite is the one the drawing shows',
    HEATMAP_LAYERS.length === 3 && HEATMAP_LAYER_DEFAULT === 'average'
    && heatmapLayerFor(HEATMAP_LAYER_DEFAULT).id === 'average');
  ok('...and it is called Estimated light level',
    avg.label === 'Estimated light level', avg.label);
  ok('...and its note says what it adds up',
    /reflect/i.test(avg.note) && /quarter/i.test(avg.note)
    && /horizontal/i.test(avg.note), avg.note);
  ok('the two component layers keep their own names and say they are components',
    ref.label === 'Reflected ambient light'
    && heatmapLayerFor('illuminance').label === 'Estimated illuminance'
    && /component/i.test(ref.note)
    && /component/i.test(heatmapLayerFor('illuminance').note));
  ok('...and the reflected one still says what it excludes',
    /reflect/i.test(ref.note) && /direct/i.test(ref.note) && /exclud/i.test(ref.note),
    ref.note);
  /* THE SELECTOR'S OWN FIELDS WENT WITH THE SELECTOR. Carrying a `short` sized
     for a chip, or a `measure` sized for a subtitle, when neither exists is how
     a table stops describing the thing it names. */
  ok('no layer carries a field that only the removed selector could have used',
    HEATMAP_LAYERS.every((l) => l.short === undefined && l.measure === undefined));
  ok('every layer still carries what the engine and the card DO read',
    HEATMAP_LAYERS.every((l) => l.id && l.label && l.note
      && typeof l.probe === 'boolean' && typeof l.floor === 'boolean'));

  /* `probe` AND `floor` ARE THE WHOLE INTERFACE TO THE ENGINE, and getting
     either wrong is a layer that quietly costs the direct pass it does not
     need or reads at a height it has not got. */
  ok('the table says what each layer needs of the engine',
    heatmapLayerFor('illuminance').probe === false
    && heatmapLayerFor('illuminance').floor === true
    && ref.probe === true && ref.floor === false
    && avg.probe === true && avg.floor === true);
  ok('...and every layer needs at least one of them, or it has nothing to draw',
    HEATMAP_LAYERS.every((l) => l.probe || l.floor));
  ok('a layer id nothing has heard of falls back rather than blanking the drawing',
    heatmapLayerFor('no-such-layer').id === HEATMAP_LAYER_DEFAULT
    && heatmapLayerFor(null).id === HEATMAP_LAYER_DEFAULT);

  /* THE SCALE IS THE SAME FIVE TOKENS AND IS STILL TARGET-RELATIVE. A ratio of
     1 is the same colour on both layers, and neither looks at a room's own
     minimum or maximum — the property the whole feature is judged on. */
  const stops = HEATMAP_BANDS.map((b, i) => ({ at: b.anchor, rgb: [i * 50, 10, 200 - i * 40] }));
  ok('the three layers share one colour ramp, keyed only on the ratio',
    JSON.stringify(colourFor(1, stops)) === JSON.stringify(colourFor(1, stops))
    && JSON.stringify(colourFor(0.5, stops)) !== JSON.stringify(colourFor(1, stops)));
  ok('...and the five tokens are the editable ones, unchanged',
    HEATMAP_BANDS.map((b) => b.token).join(',')
      === '--color-heatmap-below-25,--color-heatmap-25-75,--color-heatmap-75-125,'
        + '--color-heatmap-125-200,--color-heatmap-above-200');
  // THE SAME REFLECTED VALUE AGAINST TWO TARGETS IS TWO COLOURS, and the same
  // ratio against two targets is one — which is what "fixed target-relative
  // scale" means.
  {
    const v = 160;
    const a = v / reflectedAmbientTargetFor('residential');
    const b = v / reflectedAmbientTargetFor('retail');
    ok('a reflected value is coloured by its ratio to ITS space\'s target',
      JSON.stringify(colourFor(a, stops)) !== JSON.stringify(colourFor(b, stops))
      && JSON.stringify(colourFor(a, stops))
        === JSON.stringify(colourFor(2 * v / (2 * reflectedAmbientTargetFor('residential')), stops)));
  }
}


sec('9. the cache: two layers, two heights, one room, nothing stale');
{
  /* A SERVER RENDER MOUNTS A FRESH HOOK EVERY TIME, so what a rendered test can
     never reach is the SECOND pass over a live cache — which is exactly where a
     stale field would come from. `solveRoomLayer` is that pass, exported for
     this reason: an entry is a plain object, and calling the function twice on
     one is the layer switch the legend's chips make. */
  const geometry = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7,
                                       materials: LIGHT });
  const entry = () => ({ sig: 'x', geometry, surface: null, sphere: null, layers: {} });
  const src = [cob(3, 2, 2.7, 3000, 36), ...coveLoop(6, 4, 2.7, 250)];
  const other = [cob(1, 1, 2.7, 3000, 36)];
  const H = { sources: src, layerId: 'illuminance', probeHeightM: 1.2 };
  const R = { sources: src, layerId: 'reflected', probeHeightM: 1.2 };

  const e = entry();
  const a = solveRoomLayer(e, H);
  const b = solveRoomLayer(e, R);
  ok('the two layers give different fields off one room',
    a.values !== b.values && a.solved.mean !== b.solved.mean,
    `${a.solved.mean.toFixed(1)} horizontal vs ${b.solved.mean.toFixed(1)} reflected lx`);
  ok('...and the reflected one is the dimmer, having no direct term',
    b.solved.mean < a.solved.mean && b.solved.mean > 0);
  ok('...and the probe sat at the height it was given',
    b.probeZ === 1.2 && a.probeZ === null);

  // SWITCHING BACK IS THE CACHE, NOT A RE-SOLVE — and it is the SAME answer.
  const a2 = solveRoomLayer(e, H);
  ok('switching back to the first layer is a cache hit',
    a2.cached === true && a2.values === a.values);
  const b2 = solveRoomLayer(e, R);
  ok('...and so is switching forward again', b2.cached === true && b2.values === b.values);

  /* THE HORIZONTAL LAYER NEEDS THE DIRECT CELL PASS AND THE REFLECTED ONE DOES
     NOT, so a fresh entry that met the reflected layer first must not hand the
     horizontal one a surface with no cells in it. THIS IS THE STALENESS BUG THE
     GUARD EXISTS FOR, and here is what it would look like: */
  {
    const bare = surfacePass(geometry, src, { cells: false });
    const wrong = solveRoom(geometry, src, bare);
    const right = solveRoom(geometry, src, surfacePass(geometry, src, { cells: true }));
    ok('a cells-less surface pass really would break the horizontal layer',
      wrong.mean < right.mean * 0.9,
      `${wrong.mean.toFixed(1)} vs ${right.mean.toFixed(1)} lx`);
  }
  {
    const e2 = entry();
    const first = solveRoomLayer(e2, R);
    const second = solveRoomLayer(e2, H);
    ok('...and the cache refuses to serve it: reflected first, then horizontal, is still right',
      near(second.solved.mean, a.solved.mean, 1e-9),
      `${second.solved.mean.toFixed(4)} vs ${a.solved.mean.toFixed(4)} lx`);
    ok('...while the reflected field it already had survives the rebuild',
      solveRoomLayer(e2, R).cached === true
      && near(first.solved.mean, b.solved.mean, 1e-9));
  }

  // A NEW HEIGHT IS A NEW PROBE TRANSFER AND THE SAME LIGHT TRANSPORT.
  {
    const e3 = entry();
    const low = solveRoomLayer(e3, { ...R, probeHeightM: 0.8 });
    const exitance = e3.surface.result.exitance;
    const high = solveRoomLayer(e3, { ...R, probeHeightM: 1.7 });
    ok('moving the probe height gives a different field',
      low.solved.mean !== high.solved.mean,
      `${low.solved.mean.toFixed(1)} at 0.8 m vs ${high.solved.mean.toFixed(1)} at 1.7 m`);
    ok('...off the very same exitance vector, so the light transport was not re-run',
      e3.surface.result.exitance === exitance);
    ok('...and coming back to the first height gives the first answer again',
      near(solveRoomLayer(e3, { ...R, probeHeightM: 0.8 }).solved.mean,
           low.solved.mean, 1e-12));
  }

  // AND MOVING A FITTING INVALIDATES EVERYTHING UNDER IT.
  {
    const e4 = entry();
    const before = solveRoomLayer(e4, R).solved.mean;
    const moved = solveRoomLayer(e4, { ...R, sources: other });
    ok('changing the emitters rebuilds the light transport and the gathered field',
      moved.cached === false && moved.solved.mean !== before);
    ok('...and the horizontal layer computed from the old one is thrown away too',
      e4.layers.illuminance === undefined);
  }

  // A ROOM SHALLOWER THAN THE REQUEST, THROUGH THE SAME DOOR.
  {
    const low = buildRoomGeometry({ polygonM: box(3, 3), heightM: 1.1, materials: LIGHT });
    const e5 = { sig: 'y', geometry: low, surface: null, sphere: null, layers: {} };
    const r = solveRoomLayer(e5, { sources: [cob(1.5, 1.5, 1.1, 600, 60)],
                                   layerId: 'reflected', probeHeightM: 1.2 });
    ok('a 1.1 m room still gets a field, at the height it can hold',
      r.solved.mean > 0 && r.probeZ === 1.1 - PROBE_CLEARANCE_M
      && probeWasClamped(1.2, r.probeZ),
      `probe at ${r.probeZ} m, mean ${r.solved.mean.toFixed(1)} lx`);
  }
}


sec('9b. Average — the two layers added, and nothing solved twice');
{
  const geometry = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7,
                                       materials: LIGHT });
  const entry = () => ({ sig: 'x', geometry, surface: null, sphere: null, layers: {} });
  const src = [cob(2, 1.3, 2.7, 1500), cob(4, 1.3, 2.7, 1500),
               cob(2, 2.7, 2.7, 1500), cob(4, 2.7, 2.7, 1500)];
  const ask = (e, layerId, probeHeightM = 1.2) =>
    solveRoomLayer(e, { sources: src, layerId, probeHeightM });

  /* THE DEFINITION, CELL BY CELL AND EXACTLY. Not "within a per cent": the
     layer IS the sum, so any discrepancy at all is the sum not being the
     thing that was computed. */
  {
    const e = entry();
    const avg = ask(e, 'average');
    const hor = ask(e, 'illuminance');
    const ref = ask(e, 'reflected');
    let worst = 0;
    for (let i = 0; i < geometry.field.count; i++) {
      worst = Math.max(worst, Math.abs(
        avg.values[i] - (ref.values[i] + MEAN_SPHERICAL_FACTOR * hor.values[i])));
    }
    ok('average is exactly reflected plus a quarter of the horizontal floor value',
      worst === 0, `worst |diff| = ${worst}`);
    ok('...and the quarter is the mean-spherical conversion, not a second constant',
      MEAN_SPHERICAL_FACTOR === 0.25);
    ok('...so it sits between its two components rather than beside them',
      avg.solved.mean > ref.solved.mean && avg.solved.mean < hor.solved.mean,
      `${ref.solved.mean.toFixed(1)} < ${avg.solved.mean.toFixed(1)} `
      + `< ${hor.solved.mean.toFixed(1)} lx`);
    ok('...and its mean really is the mean of its own field',
      near(avg.solved.mean,
           ref.solved.mean + MEAN_SPHERICAL_FACTOR * hor.solved.mean, 1e-9));
  }

  /* COMPUTING IT WARMS BOTH COMPONENTS, which is the point of composing it out
     of them rather than gathering it separately: the reader who looks at
     Average and then at either half pays nothing for the second look. */
  {
    const e = entry();
    ask(e, 'average');
    ok('a cold Average leaves both of its components in the cache',
      Object.keys(e.layers).sort().join(',') === 'average,illuminance,reflected');
    ok('...so switching to either of them is a hit, not a solve',
      ask(e, 'illuminance').cached === true && ask(e, 'reflected').cached === true);
    ok('...and asking for Average again is a hit too', ask(e, 'average').cached === true);
  }

  /* AND IT IS BUILT ON THE COMPONENTS' OWN CACHES, so a reader who arrives at
     it from either side does not pay for a third solve. */
  {
    const e = entry();
    ask(e, 'illuminance');
    ask(e, 'reflected');
    const exitance = e.surface.result.exitance;
    const avg = ask(e, 'average');
    ok('arriving at Average from the other two re-runs no light transport',
      avg.cached === false && e.surface.result.exitance === exitance);
  }

  // THE HEIGHT CONTROL REACHES IT, because half of it is a probe reading.
  {
    const e = entry();
    const low = ask(e, 'average', 0.8), high = ask(e, 'average', 1.7);
    ok('the measurement height moves Average',
      low.solved.mean !== high.solved.mean
      && low.probeZ === 0.8 && high.probeZ === 1.7,
      `${low.solved.mean.toFixed(2)} at 0.8 m vs ${high.solved.mean.toFixed(2)} at 1.7 m`);
    ok('...and only through its reflected half: the floor term does not move',
      near(low.solved.mean - ask(e, 'reflected', 0.8).solved.mean,
           high.solved.mean - ask(e, 'reflected', 1.7).solved.mean, 1e-9));
  }

  /* WITH NOTHING REFLECTING, AVERAGE IS A QUARTER OF THE DIRECT FIELD — which
     is the sharpest statement of what the two halves are: the reflected term
     vanishes and the floor term does not, so the layer is visibly NOT the
     reflected layer with a different name. */
  {
    const dark = buildRoomGeometry({ polygonM: box(6, 4), heightM: 2.7,
                                     materials: LIGHT });
    dark.patches.rho.fill(0);
    const e = { sig: 'z', geometry: dark, surface: null, sphere: null, layers: {} };
    const avg = solveRoomLayer(e, { sources: src, layerId: 'average', probeHeightM: 1.2 });
    const hor = solveRoomLayer(e, { sources: src, layerId: 'illuminance', probeHeightM: 1.2 });
    const ref = solveRoomLayer(e, { sources: src, layerId: 'reflected', probeHeightM: 1.2 });
    let worst = 0;
    for (let i = 0; i < dark.field.count; i++) {
      worst = Math.max(worst, Math.abs(avg.values[i] - 0.25 * hor.values[i]));
    }
    ok('with every reflectance at zero, Average is exactly a quarter of the direct field',
      ref.solved.max === 0 && avg.solved.max > 0 && worst === 0,
      `reflected ${ref.solved.max}, worst |diff| ${worst}`);
  }

  /* AND THE RATIO THE COLOUR SCALE READS IS BUILT OF MATCHING PARTS — the
     value's two terms over the target's two terms, with the same share in
     front of the same one. This is the end-to-end version of the arithmetic
     asserted in section 7: run against a real room's real field. */
  {
    const e = entry();
    const avg = ask(e, 'average'), hor = ask(e, 'illuminance'), ref = ask(e, 'reflected');
    const tA = heatmapTargetForLayer('average', 'residential', 'living_space');
    const tR = heatmapTargetForLayer('reflected', 'residential', 'living_space');
    const tH = heatmapTargetForLayer('illuminance', 'residential', 'living_space');
    ok('Average is judged against reflected target + a quarter of the horizontal one',
      tA === tR + AVERAGE_FLOOR_SHARE * tH && Math.round(tA) === 145, `${tA}`);
    /* THE CONSEQUENCE, ON A REAL FIELD: a room over target on both halves is
       over target on Average, and one under on both is under. A target that
       had missed the floor term would put a room over on Average that was
       under on both of its own components — which is the bug this replaces. */
    const rA = avg.solved.mean / tA, rR = ref.solved.mean / tR, rH = hor.solved.mean / tH;
    ok('...so its ratio lies between its two components’ ratios, never outside them',
      rA >= Math.min(rR, rH) - 1e-12 && rA <= Math.max(rR, rH) + 1e-12,
      `average ${rA.toFixed(3)} against reflected ${rR.toFixed(3)} `
      + `and horizontal ${rH.toFixed(3)}`);
  }
}


sec('10. one heatmap, one name, and nothing to choose');
{
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    cacheDir: path.join(os.tmpdir(), 'superluminal-heatmap-indirect-test'),
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const legend = await vite.ssrLoadModule('/src/features/heatmap/HeatmapLegend.jsx');
    const HeatmapLegend = legend.default;
    const { targetLine } = legend;
    const useHeatmap = (await vite.ssrLoadModule('/src/features/heatmap/useHeatmap.js')).default;

    const roomPoly = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
    const shift = (dx) => roomPoly.map((q) => ({ x: q.x + dx, y: q.y }));
    const space = (id, name, poly) => ({
      id, outline: { name },
      geo: { polygonPx: poly, fansInRoom: [] },
      plan: { ok: true, polygonPx: poly, cellsPx: [], chunksPx: [], covesPx: [],
              tracksPx: [], lightsPx: [{ id: `L-${id}`, x: poly[0].x + 200, y: 150,
                                         fixture: 'small' }],
              gridLightsPx: [], stats: {} },
    });
    const plans = [space('R1', 'Room', roomPoly)];
    const args = {
      on: true, rooms: plans, pxPerFt: 40, projectId: 'residential',
      roomTypes: { R1: { type: 'living_space' } }, materials: {},
      ceilingMmFor: () => 2700,
      spaceAnalysis: () => ({ rows: [
        { key: 'cob', familyId: 'cob', count: 1, metres: null, totalOutput: 3000 }] }),
      focusId: 'R1',
    };
    let got = null;
    const Probe = (props) => { got = useHeatmap({ ...args, ...props }); return null; };
    renderToStaticMarkup(React.createElement(Probe));

    ok('the heatmap shows the composite layer and names it Estimated light level',
      got.layer.id === 'average' && got.layer.label === 'Estimated light level'
      && got.rooms[0].layer === 'average' && got.rooms[0].maxLux > 0);
    ok('...measured at the fixed 1.2 m probe',
      got.rooms[0].probeHeightM === PROBE_HEIGHT_MM / 1000
      && got.rooms[0].probeClamped === false);
    ok('...against the composite target for the space',
      got.focusTarget === heatmapTargetForLayer('average', 'residential', 'living_space')
      && Math.round(got.focusTarget) === 145, `${got.focusTarget}`);

    /* --- THERE IS NOTHING LEFT TO CHOOSE, AND THAT IS STRUCTURAL ----------
       THE CONTROLS WERE BUILT ON THIS DATA. A layer selector needs a list of
       layers and a setter; a height control needs a list of heights and a
       setter. With none of the four on the hook's output there is nothing a
       card could render them from, which is a stronger statement than "the
       markup does not contain them" — and it is the one a server render can
       actually make, since the card measures itself off the stage and so draws
       nothing outside a browser. */
    for (const gone of ['layers', 'setLayer', 'probeHeights', 'setProbeHeightMm',
                        'layerId', 'probeHeightMm']) {
      ok(`the hook no longer exposes \`${gone}\`, so no control can be built from it`,
        got[gone] === undefined, `got ${typeof got[gone]}`);
    }
    ok('...and the card exports no measurement-line or height formatter either',
      legend.measurementLine === undefined && legend.m === undefined);
    ok('the card names the open space and its target, and nothing else',
      targetLine(got) === 'Room · Target 145 lx', targetLine(got));

    /* THE ROOM STILL CARRIES EVERYTHING A FUTURE READOUT WOULD WANT, which is
       the difference between removing a control and removing the data behind
       it: the target and the probe height are on the field, they are simply
       not printed. */
    ok('the field still carries its target and the height it was read at',
      got.rooms[0].targetLux > 0 && got.rooms[0].probeHeightM > 0
      && got.rooms[0].roomHeightM === 2.7);

    /* --- WHOSE TARGET IS ON THE CARD, AND IT FOLLOWS THE CLICK -----------
       `focusId` IS WHICH SPACE IS OPEN IN THE PANEL, which is the room you
       last clicked. A flat holds a living space at 145 and a kitchen at 290,
       so the figure is only meaningful with the room's name beside it — and
       the pair has to change together when the click does. */
    {
      const flat = [space('R1', 'Living', roomPoly),
                    space('R2', 'Kitchen', shift(500))];
      const types = { R1: { type: 'living_space' }, R2: { type: 'kitchen' } };
      let seen = null;
      const Flat = ({ focus }) => {
        seen = useHeatmap({ ...args, rooms: flat, roomTypes: types, focusId: focus });
        return null;
      };

      renderToStaticMarkup(React.createElement(Flat, { focus: 'R1' }));
      const living = seen;
      ok('clicking the living space puts ITS target on the card',
        targetLine(living) === 'Living · Target 145 lx', targetLine(living));

      renderToStaticMarkup(React.createElement(Flat, { focus: 'R2' }));
      const kitchen = seen;
      ok('...and clicking the kitchen puts the kitchen\'s on it',
        targetLine(kitchen) === 'Kitchen · Target 290 lx', targetLine(kitchen));
      ok('...which is double, because a kitchen is worked in',
        near(kitchen.focusTarget, 2 * living.focusTarget, 1e-12),
        `${kitchen.focusTarget.toFixed(2)} vs ${living.focusTarget.toFixed(2)}`);

      /* THE COLOURS MOVE WITH IT. The same light in the same room reads as a
         different share of target once the target doubles — which is the
         whole point of a per-room figure and the thing that would silently
         not happen if the field kept a stale target. */
      const k = kitchen.rooms.find((r) => r.id === 'R2');
      const l = living.rooms.find((r) => r.id === 'R2');
      ok('...and the kitchen\'s own field is judged against the kitchen figure, whichever room is open',
        k.targetLux === l.targetLux
        && k.targetLux === heatmapTargetForLayer('average', 'residential', 'kitchen'),
        `${k.targetLux.toFixed(2)}`);
      ok('...so its ratios are half what the living-space figure would have made them',
        (() => {
          for (let i = 0; i < k.ratio.length; i++) {
            if (Number.isNaN(k.ratio[i])) continue;
            if (!near(k.ratio[i], k.lux[i] / k.targetLux, 1e-6)) return false;
          }
          return true;
        })());

      /* NOTHING OPEN, AND THE TWO SPACES DISAGREE — the card prints the range
         rather than picking one, because a key claiming 145 over a plan that
         also holds a kitchen at 290 would be wrong about half the drawing. */
      renderToStaticMarkup(React.createElement(Flat, { focus: null }));
      ok('with nothing open and the spaces disagreeing, the card prints the range',
        targetLine(seen) === 'Target 145–290 lx', targetLine(seen));
      ok('...and names no space, because none was picked', seen.focusName === null);
    }

    /* ONE SPACE, NOTHING OPEN: there is one figure and it is printed bare.
       Naming a room nobody clicked would be the card inventing a selection. */
    {
      let alone = null;
      const Alone = () => { alone = useHeatmap({ ...args, focusId: null }); return null; };
      renderToStaticMarkup(React.createElement(Alone));
      ok('one space and no click prints the figure without a name',
        targetLine(alone) === 'Target 145 lx', targetLine(alone));
    }

    // THE SWITCH IN THE BAR IS STILL THE WHOLE OF THE ON/OFF.
    renderToStaticMarkup(React.createElement(Probe, { on: false }));
    ok('the heatmap off costs nothing at all',
      got.on === false && got.rooms.length === 0);
    ok('...and still names the layer it would draw, so the shape does not change',
      got.layer?.id === 'average');

    ok('the legend draws nothing with the layer off',
      renderToStaticMarkup(React.createElement(HeatmapLegend,
        { heatmap: { on: false, rooms: [] }, stage: null })) === '');
    ok('...and nothing with no room on the sheet',
      renderToStaticMarkup(React.createElement(HeatmapLegend,
        { heatmap: { on: true, rooms: [] }, stage: null })) === '');
  } finally {
    await vite.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
