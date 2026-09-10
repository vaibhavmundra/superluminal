// ---------------------------------------------------------------------------
// test-heatmap.mjs — the estimated illuminance heatmap.
//
// WHAT IS ASSERTED HERE IS PHYSICS AND STRUCTURE, NOT NUMBERS. The same rule
// test-lumens.mjs states: every figure in heatmapTargets.js and profiles.js is
// there to be edited, so a test that pinned 150 lux or a cosine power of 1.6
// would turn a deliberate change into a red build. What cannot move without the
// feature being broken is asserted instead:
//
//   · emission is normalised, so SAMPLING CANNOT CHANGE THE LIGHT — not the
//     grid, not the segmentation of a run, not the sample count on a panel;
//   · a long room lit at one end is dimmer at the other;
//   · the same fittings redistributed cover better and emit exactly as much;
//   · two fittings add;
//   · a cove reaches the floor only through the ceiling, and a dark ceiling
//     takes most of it away;
//   · a floor finish moves the bounce and never the direct light;
//   · a wall blocks;
//   · the colour of a cell depends on its lux and its target and on nothing
//     else in the room;
//   · the target is a LUX figure of its own and is not either of the two
//     lumen budgets the app already had;
//   · the layer is off by default, and the field is painted under every mark
//     the drawing makes and takes no pointer.
//
//   node tools/test-heatmap.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import { FIXTURE_FAMILIES, FAMILY_BY_ID, LUMENS_PER_SQFT } from '../src/lib/lumens.js';
import { LUMEN_CRITERIA } from '../src/lib/settings.js';
import { LAYER_DEFAULTS } from '../src/lib/planState.js';
import { projectAccentZonesPx } from '../src/lib/planProjection.js';
import { fixtureGroups } from '../src/features/lighting-planner/lightingRules.js';
import { analyseSpace } from '../src/lib/lumens.js';
import { DISTRIBUTION_PROFILES, PROFILE_FOR_FAMILY, profileFor, profileForFamily,
         LINE_SEGMENT_M, AREA_SAMPLES } from '../src/features/heatmap/profiles.js';
import { powerForBeam, expandSource, emittedLumens, illuminanceFrom,
         intensityAlong, resolveLobe } from '../src/features/heatmap/photometry.js';
import { buildFieldGrid, buildPatches, isConvex, blocked,
         HEATMAP_RESOLUTION, M_PER_FT } from '../src/features/heatmap/grid.js';
import { buildRoomGeometry, solveRoom, directPass } from '../src/features/heatmap/solve.js';
import { MAX_BOUNCES, BOUNCE_STOP } from '../src/features/heatmap/reflection.js';
import { buildRoomEmitters, indexAnalysisRows,
         inwardOfRun } from '../src/features/heatmap/emitters.js';
import { colourFor, parseColour, readHeatmapPalette, heatmapOpacity,
         HEATMAP_OPACITY, HEATMAP_OPACITY_NIGHT } from '../src/features/heatmap/colours.js';
import { HEATMAP_BANDS, HEATMAP_PLANE, HEATMAP_TARGET_LUX,
         HEATMAP_TARGET_LUX_BY_ROOM, HEATMAP_TARGET_LUX_DEFAULT,
         heatmapTargetFor, heatmapBandFor } from '../src/features/heatmap/heatmapTargets.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); }
};
const sec = (s) => console.log('\n' + s);
/** Within a percentage of each other — the tolerance an approximation gets. */
const near = (a, b, pct) => Math.abs(a - b) <= (Math.abs(a) + Math.abs(b)) / 2 * pct;

const LIGHT = { ceiling: 'light', floor: 'light', walls: {} };
const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
/** The L this whole file uses for the occlusion cases: a 6 x 3 bottom arm and a
 *  3 x 6 left column, so a point deep in one arm cannot see deep into the other. */
const ELL = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 },
             { x: 3, y: 3 }, { x: 3, y: 6 }, { x: 0, y: 6 }];

const cob = (x, y, z, lm = 900, beamDeg = 36) => ({
  profileId: 'cob', lm, beamDeg, geom: { kind: 'point', p: { x, y, z } } });

/** The mean of a field over the cells a predicate accepts, plus the count. */
function meanWhere(geometry, arr, pred) {
  const f = geometry.field;
  let s = 0, n = 0;
  for (let g = 0; g < f.count; g++) {
    if (!pred(f.cx[g], f.cy[g])) continue;
    s += arr[g]; n++;
  }
  return { mean: n ? s / n : 0, n };
}
const meanOf = (arr, n) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[i];
  return n ? s / n : 0;
};


sec('1. the profile registry covers every family the lumen model counts');
{
  const missing = FIXTURE_FAMILIES.filter((f) => !profileForFamily(f.id));
  ok('every FIXTURE_FAMILIES id has a distribution profile',
    missing.length === 0, missing.map((f) => f.id).join(', '));

  const unknown = Object.entries(PROFILE_FOR_FAMILY)
    .filter(([fid, pid]) => !FAMILY_BY_ID[fid] || !DISTRIBUTION_PROFILES[pid]);
  ok('...and the map names no family or profile that does not exist',
    unknown.length === 0, JSON.stringify(unknown));

  let badShare = [], badShape = [], badLobe = [];
  for (const [id, p] of Object.entries(DISTRIBUTION_PROFILES)) {
    const sum = p.lobes.reduce((s, l) => s + (l.share ?? 1), 0);
    if (Math.abs(sum - 1) > 1e-9) badShare.push(`${id}=${sum}`);
    if (!['point', 'line', 'area', 'ring'].includes(p.shape)) badShape.push(id);
    for (const l of p.lobes) {
      if (!['beam', 'cosine', 'uniform'].includes(l.kind)) badLobe.push(`${id}:${l.kind}`);
      if (!['up', 'down', 'aim', 'inward', 'outward', 'omni'].includes(l.dir)) {
        badLobe.push(`${id}:${l.dir}`);
      }
    }
  }
  // A FAMILY WHOSE SHARES DO NOT SUM TO 1 IS CLAIMING LIGHT THAT GOES NOWHERE —
  // the same rule lumens.js states about `split`.
  ok('every profile\'s lobe shares sum to exactly 1', badShare.length === 0, badShare.join(', '));
  ok('...every shape is one the solver samples', badShape.length === 0, badShape.join(', '));
  ok('...and every lobe names a law and a direction the solver resolves',
    badLobe.length === 0, badLobe.join(', '));

  // NOT EVERY FIXTURE IS AN OMNIDIRECTIONAL POINT, which is the brief's own
  // rule and the easiest one to break by accident.
  const omniPoints = Object.values(DISTRIBUTION_PROFILES).filter(
    (p) => p.shape === 'point' && p.lobes.length === 1 && p.lobes[0].kind === 'uniform');
  ok('no family is modelled as a bare omnidirectional point',
    omniPoints.length === 0, omniPoints.map((p) => p.id).join(', '));

  // THE LINEAR FAMILIES ARE LINE SOURCES AND THE PANEL IS AN AREA, which is the
  // difference between "distributed" and "a point with a length written on it".
  for (const id of ['cove', 'reverse_cove', 'ceiling_strip', 'shelf_strip',
                    'track_diffuser', 'wall_washer']) {
    ok(`${id} is a distributed line source`, DISTRIBUTION_PROFILES[id].shape === 'line');
  }
  ok('a panel is an emitting AREA, sampled across its face',
    DISTRIBUTION_PROFILES.panel.shape === 'area' && AREA_SAMPLES >= 2);
  ok('a chandelier is several elements round its hanging position',
    DISTRIBUTION_PROFILES.chandelier.shape === 'ring'
    && DISTRIBUTION_PROFILES.chandelier.elements > 1);
  ok('a floor lamp throws up, down AND sideways',
    DISTRIBUTION_PROFILES.floor_lamp.lobes.length === 3
    && DISTRIBUTION_PROFILES.floor_lamp.lobes.some((l) => l.dir === 'up')
    && DISTRIBUTION_PROFILES.floor_lamp.lobes.some((l) => l.dir === 'down'));
  ok('a sconce may not emit through its wall',
    DISTRIBUTION_PROFILES.sconce.lobes.every((l) => l.clip === 'inward'));
  // A REVERSE COVE IS NOT ENTIRELY INDIRECT — the brief is explicit about it.
  ok('a reverse cove washes its wall AND spills downward',
    DISTRIBUTION_PROFILES.reverse_cove.lobes.some((l) => l.dir === 'outward')
    && DISTRIBUTION_PROFILES.reverse_cove.lobes.some((l) => l.dir === 'down'));
  ok('...and a cove throws only upward, so it is concealed by geometry',
    DISTRIBUTION_PROFILES.cove.lobes.every((l) => l.dir === 'up'));
  ok('the future wall washer is asymmetric, aimed, and marked unspecified',
    DISTRIBUTION_PROFILES.wall_washer.unspecified === true
    && DISTRIBUTION_PROFILES.wall_washer.lobes[0].dir === 'outward');
  ok('a profile nothing has heard of is null rather than guessed at',
    profileFor('no-such-thing') === null);
}


sec('2. emission is normalised, so sampling cannot change the light');
{
  // A LAMBERTIAN LOBE'S PEAK IS lm/pi AND A UNIFORM ONE'S IS lm/4pi. Both are
  // fixed by the requirement that the lobe emit what it was given, and both are
  // what makes every sample count below come out identical.
  const lam = resolveLobe({ share: 1, kind: 'cosine', power: 1 },
                          { lm: Math.PI, axis: { x: 0, y: 0, z: -1 } });
  ok('a Lambertian lobe peaks at lm/pi', near(lam.i0, 1, 1e-9), String(lam.i0));
  const uni = resolveLobe({ share: 1, kind: 'uniform' }, { lm: 4 * Math.PI });
  ok('a uniform lobe is lm/4pi in every direction', near(uni.i0, 1, 1e-9), String(uni.i0));
  const clip = resolveLobe({ share: 1, kind: 'uniform', clip: 'inward' },
                           { lm: 2 * Math.PI, inward: { x: 1, y: 0 } });
  ok('...and lm/2pi when a backplate halves the sphere', near(clip.i0, 1, 1e-9));
  ok('a clipped lobe sends nothing through its wall',
    intensityAlong(clip, -1, 0, 0) === 0 && intensityAlong(clip, 1, 0, 0) > 0);
  ok('a cosine lobe sends nothing behind its own face',
    intensityAlong(lam, 0, 0, 1) === 0 && intensityAlong(lam, 0, 0, -1) > 0);

  // THE BEAM ANGLE IS THE FULL ANGLE AT HALF INTENSITY — the catalogue's own
  // definition, which is what this conversion has to reproduce.
  for (const beam of [15, 24, 30, 36, 45, 60]) {
    const n = powerForBeam(beam);
    const half = Math.cos((beam / 2) * Math.PI / 180) ** n;
    ok(`a ${beam}-degree beam is at half intensity ${beam / 2} degrees off axis`,
      near(half, 0.5, 1e-6), String(half));
  }
  ok('a tighter optic is a higher power', powerForBeam(24) > powerForBeam(60));
  // SMOOTH AND NOT A DISC: a real optic is still doing something outside its
  // nominal cone, which is the whole reason two pools overlap softly.
  const wide = resolveLobe({ share: 1, kind: 'beam' },
    { lm: 1000, beamDeg: 36, axis: { x: 0, y: 0, z: -1 } });
  const at30 = intensityAlong(wide, Math.sin(30 * Math.PI / 180), 0, -Math.cos(30 * Math.PI / 180));
  ok('a 36-degree beam still throws well past 18 degrees off axis',
    at30 > 0 && at30 < intensityAlong(wide, 0, 0, -1) * 0.5);

  // AND THE PROPERTY THE WHOLE DESIGN TURNS ON, for every shape.
  const shapes = {
    point: { geom: { kind: 'point', p: { x: 0, y: 0, z: 2.7 } } },
    line1: { geom: { kind: 'line', a: { x: 0, y: 0, z: 2.7 }, b: { x: 1, y: 0, z: 2.7 } } },
    line9: { geom: { kind: 'line', a: { x: 0, y: 0, z: 2.7 }, b: { x: 9, y: 0, z: 2.7 } } },
    area: { geom: { kind: 'area', c: { x: 0, y: 0, z: 2.7 },
                    u: { x: 0.3, y: 0 }, v: { x: 0, y: 0.3 } } },
    ring: { geom: { kind: 'ring', c: { x: 0, y: 0, z: 2.1 }, r: 0.45, n: 6 } },
  };
  for (const [name, g] of Object.entries(shapes)) {
    const prof = name === 'area' ? DISTRIBUTION_PROFILES.panel
      : name.startsWith('line') ? DISTRIBUTION_PROFILES.ceiling_strip
      : name === 'ring' ? DISTRIBUTION_PROFILES.chandelier
      : DISTRIBUTION_PROFILES.cob;
    const sm = expandSource({ lm: 1234, beamDeg: 36, ...g }, prof);
    ok(`a ${name} source emits exactly the lumens it was given`,
      near(emittedLumens(sm), 1234, 1e-9), String(emittedLumens(sm)));
    ok(`  ...and is more than one sample where it has extent`,
      name === 'point' ? sm.length === 1 : sm.length > 1, String(sm.length));
  }
  ok('a run is cut at a target LENGTH, so long and short runs resolve alike',
    LINE_SEGMENT_M > 0 && LINE_SEGMENT_M <= 0.5);

  // THE ONE EQUATION, CHECKED AGAINST ITS CLOSED FORM.
  const s = expandSource({ lm: 1000, geom: shapes.point.geom },
                         { lobes: [{ share: 1, dir: 'down', kind: 'cosine', power: 1 }], loss: 0 });
  const E = illuminanceFrom(s[0], 0, 0, 0, 0, 0, 1, 0);
  ok('E under a Lambertian source is (2 lm / 2pi) / h^2',
    near(E, (1000 * 2 / (2 * Math.PI)) / (2.7 ** 2), 1e-9), String(E));
  // THE RECEIVING COSINE IS NOT OPTIONAL: horizontal illuminance falls off with
  // the third power of the cosine, not the second.
  const off = illuminanceFrom(s[0], 2.7, 0, 0, 0, 0, 1, 0);
  ok('...and at 45 degrees off it is that over 2^(3/2) x 2', near(off, E * (0.5 ** 1.5) ** 2 * 2, 0.02)
    || near(off, E * Math.cos(Math.PI / 4) ** 4, 0.02), String(off / E));
  ok('a surface facing away from a source is dark, not dim',
    illuminanceFrom(s[0], 0, 0, 0, 0, 0, -1, 0) === 0);
}


sec('3. a long room lit at one end is dimmer at the other');
{
  // THE CASE THE WHOLE FEATURE EXISTS FOR. 12 x 3 m — a room the existing lumen
  // budget cannot say anything about, because the budget is a total.
  const poly = box(12, 3);
  const geo = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT });
  const near4 = [cob(1.5, 0.75, 2.7), cob(1.5, 2.25, 2.7),
                 cob(3.0, 0.75, 2.7), cob(3.0, 2.25, 2.7)];
  const r = solveRoom(geo, near4);
  const lit = meanWhere(geo, r.total, (x) => x < 4);
  const far = meanWhere(geo, r.total, (x) => x > 8);
  ok('both ends have cells to compare', lit.n > 10 && far.n > 10);
  ok('the far end reads far dimmer than the lit end',
    far.mean < lit.mean * 0.4, `${lit.mean.toFixed(0)} vs ${far.mean.toFixed(0)} lx`);
  ok('...and the far end is not zero, because the room bounces',
    far.mean > 0, String(far.mean));
  // AND THE TOTAL SAYS NOTHING ABOUT IT, which is the point of having a map.
  ok('the room-wide mean would have hidden it',
    r.mean > far.mean * 1.5, `${r.mean.toFixed(0)} vs ${far.mean.toFixed(0)}`);
}


sec('4. redistributing the same fittings changes coverage and not output');
{
  const poly = box(12, 3);
  const geo = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT });
  const clustered = [cob(1.5, 0.75, 2.7), cob(1.5, 2.25, 2.7),
                     cob(3.0, 0.75, 2.7), cob(3.0, 2.25, 2.7)];
  const spread = [cob(1.5, 1.5, 2.7), cob(4.5, 1.5, 2.7),
                  cob(7.5, 1.5, 2.7), cob(10.5, 1.5, 2.7)];
  const a = solveRoom(geo, clustered), b = solveRoom(geo, spread);
  ok('the emitted lumen total is identical', a.emitted === b.emitted,
    `${a.emitted} vs ${b.emitted}`);
  ok('...and so is what reaches the room\'s surfaces',
    near(a.onSurfaces, b.onSurfaces, 0.05),
    `${a.onSurfaces.toFixed(0)} vs ${b.onSurfaces.toFixed(0)}`);
  // THE COVERAGE IS WHAT MOVED. Uniformity — the dimmest cell over the mean — is
  // the figure a designer would use, and it is what redistribution buys.
  const uA = a.min / a.mean, uB = b.min / b.mean;
  ok('spreading them out raises uniformity', uB > uA * 2,
    `${uA.toFixed(3)} -> ${uB.toFixed(3)}`);
  ok('...and lowers the brightest cell', b.max < a.max,
    `${a.max.toFixed(0)} -> ${b.max.toFixed(0)}`);
  ok('...while the room-wide mean barely moves', near(a.mean, b.mean, 0.2),
    `${a.mean.toFixed(0)} vs ${b.mean.toFixed(0)}`);
}


sec('5. overlapping fittings add light');
{
  const poly = box(5, 4);
  const geo = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT });
  const one = solveRoom(geo, [cob(2.5, 2, 2.7)]);
  const two = solveRoom(geo, [cob(2.5, 2, 2.7), cob(2.5, 2, 2.7)]);
  const m1 = meanOf(one.total, geo.field.count), m2 = meanOf(two.total, geo.field.count);
  ok('two fittings on one point are exactly twice one', near(m2, m1 * 2, 1e-9),
    `${m1.toFixed(1)} -> ${m2.toFixed(1)}`);
  // AND WHERE THEY MERELY OVERLAP, the overlap is brighter than either alone —
  // which is the thing the old throw pools could not show, because a group
  // opacity composites two discs as one.
  const left = solveRoom(geo, [cob(2.0, 2, 2.7)]);
  const right = solveRoom(geo, [cob(3.0, 2, 2.7)]);
  const both = solveRoom(geo, [cob(2.0, 2, 2.7), cob(3.0, 2, 2.7)]);
  let worst = 0;
  for (let g = 0; g < geo.field.count; g++) {
    worst = Math.max(worst, Math.abs(both.total[g] - (left.total[g] + right.total[g])));
  }
  ok('light is additive cell by cell, to within rounding', worst < 1e-9, String(worst));
  const mid = meanWhere(geo, both.total, (x, y) => Math.abs(x - 2.5) < 0.3 && Math.abs(y - 2) < 0.3);
  const midL = meanWhere(geo, left.total, (x, y) => Math.abs(x - 2.5) < 0.3 && Math.abs(y - 2) < 0.3);
  ok('...so the ground between two lamps is brighter than under either alone',
    mid.mean > midL.mean * 1.5, `${midL.mean.toFixed(0)} -> ${mid.mean.toFixed(0)}`);
}


sec('6. a cove is indirect, and a dark ceiling takes its light away');
{
  const poly = box(5, 4);
  const drop = DISTRIBUTION_PROFILES.cove.dropMm / 1000;
  const z = 2.7 - drop;
  const pts = [{ x: 0.3, y: 0.3 }, { x: 4.7, y: 0.3 }, { x: 4.7, y: 3.7 }, { x: 0.3, y: 3.7 }];
  const cove = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    // ALLOCATED BY LENGTH, which is what the adapter does per leg.
    cove.push({ profileId: 'cove', lm: 400 * L,
                geom: { kind: 'line', a: { ...a, z }, b: { ...b, z } } });
  }
  const geoL = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT });
  const geoD = buildRoomGeometry({ polygonM: poly, heightM: 2.7,
    materials: { ceiling: 'dark', floor: 'light', walls: {} } });
  const rl = solveRoom(geoL, cove), rd = solveRoom(geoD, cove);

  let anyDirect = 0;
  for (let g = 0; g < geoL.field.count; g++) anyDirect = Math.max(anyDirect, rl.direct[g]);
  ok('a fully concealed cove contributes nothing DIRECT to the plane',
    anyDirect === 0, String(anyDirect));
  ok('...and yet lights the room, through the ceiling', rl.mean > 0);
  ok('the whole of its output reaches the room\'s surfaces',
    near(rl.onSurfaces, rl.emitted, 0.02),
    `${rl.onSurfaces.toFixed(0)} of ${rl.emitted.toFixed(0)}`);
  ok('a dark ceiling cuts the cove\'s contribution to a fraction',
    rd.mean < rl.mean * 0.35, `${rl.mean.toFixed(0)} -> ${rd.mean.toFixed(0)} lx`);
  ok('...and it is still not zero, because the walls take some of it',
    rd.mean > 0, String(rd.mean));
  ok('a dark room settles in fewer bounces than a white one',
    rd.bounces < rl.bounces, `${rl.bounces} vs ${rd.bounces}`);
  ok('the bounce is bounded both ways', rl.bounces <= MAX_BOUNCES
    && rl.carried[rl.carried.length - 1] < rl.carried[0] * (BOUNCE_STOP * 2 + 1e-9)
    || rl.bounces === MAX_BOUNCES);

  // A REVERSE COVE IS NOT ENTIRELY INDIRECT, which the profile says and the
  // solve has to bear out: some of it comes straight down out of the slot.
  const rc = [{ profileId: 'reverse_cove', lm: 400 * 4.4,
                inward: { x: 0, y: 1 },
                geom: { kind: 'line', a: { x: 0.3, y: 0.15, z: 2.66 },
                        b: { x: 4.7, y: 0.15, z: 2.66 } } }];
  const rr = solveRoom(geoL, rc);
  const nearWall = meanWhere(geoL, rr.direct, (x, y) => y < 1);
  const across = meanWhere(geoL, rr.direct, (x, y) => y > 3);
  ok('a reverse cove spills DIRECT light onto the floor by its own wall',
    nearWall.mean > 0);
  ok('...and much less of it across the room',
    across.mean < nearWall.mean * 0.5,
    `${nearWall.mean.toFixed(1)} vs ${across.mean.toFixed(1)}`);
  ok('...and its wall wash comes back as reflected light',
    rr.mean > nearWall.mean);
}


sec('7. a floor finish moves the bounce and never the direct light');
{
  const poly = box(5, 4);
  const src = [cob(1.25, 1, 2.7), cob(3.75, 1, 2.7), cob(1.25, 3, 2.7), cob(3.75, 3, 2.7)];
  const a = solveRoom(buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT }), src);
  const b = solveRoom(buildRoomGeometry({ polygonM: poly, heightM: 2.7,
    materials: { ceiling: 'light', floor: 'dark', walls: {} } }), src);
  let worst = 0;
  for (let g = 0; g < a.direct.length; g++) {
    worst = Math.max(worst, Math.abs(a.direct[g] - b.direct[g]));
  }
  ok('a darker floor leaves the direct component bit-for-bit unchanged',
    worst === 0, String(worst));
  ok('...and does reduce the total, because less comes back up',
    b.mean < a.mean, `${a.mean.toFixed(0)} -> ${b.mean.toFixed(0)}`);
  // AND THE WALLS ARE PER EDGE, not an average — one dark accent wall is not a
  // slightly darker room.
  const oneDark = solveRoom(buildRoomGeometry({ polygonM: poly, heightM: 2.7,
    materials: { ceiling: 'light', floor: 'light', walls: { 0: 'dark' } } }), src);
  const allDark = solveRoom(buildRoomGeometry({ polygonM: poly, heightM: 2.7,
    materials: { ceiling: 'light', floor: 'light',
                 walls: { 0: 'dark', 1: 'dark', 2: 'dark', 3: 'dark' } } }), src);
  ok('darkening one wall costs less than darkening all four',
    oneDark.mean < a.mean && oneDark.mean > allDark.mean,
    `${a.mean.toFixed(0)} / ${oneDark.mean.toFixed(0)} / ${allDark.mean.toFixed(0)}`);
}


sec('8. walls block direct contributions');
{
  ok('a rectangle is convex and an L is not', isConvex(box(5, 4)) && !isConvex(ELL));
  ok('a sight line across the reflex corner of an L is blocked',
    blocked(5.5, 1.5, 1.5, 5.5, ELL));
  ok('...and one within a single arm is not', blocked(1, 1, 1, 5, ELL) === false);

  const geo = buildRoomGeometry({ polygonM: ELL, heightM: 2.7, materials: LIGHT });
  ok('the solver knows the room is not convex', geo.convex === false);
  // A LAMP DEEP IN THE BOTTOM ARM. The far end of the left column cannot see it.
  const lamp = { x: 5.4, y: 1.5 };
  const r = solveRoom(geo, [cob(lamp.x, lamp.y, 2.7, 1200, 60)]);
  /* --- THE INVARIANT, CELL BY CELL, AND NOT OVER A HAND-PICKED REGION -----
     THE REQUIREMENT IS EXACTLY THIS: a cell the lamp cannot see gets no direct
     light. Asserting it against a rectangle instead was how this test first
     failed for the right reason — the shadow boundary in an L is the ray THROUGH
     THE REFLEX CORNER, so a generous rectangle catches cells that genuinely do
     see the lamp round the corner point and reports real physics as a leak.
     `blocked` is the same predicate the solver uses, which is the point: the
     drawing and the check cannot disagree about where the shadow is. */
  /* WHOLLY HIDDEN AND NOT MERELY HIDDEN AT ITS CENTRE. The direct pass samples
     nine points inside each cell and tests each one for a wall — see
     FIELD_SUBSAMPLES — so a cell straddling the shadow's edge is PART lit, which
     is the truer answer and is deliberate. The invariant is therefore about
     cells no part of which can see the lamp. */
  const F = geo.field;
  let leaked = 0, litHidden = 0, litSeen = 0, nHidden = 0, nSeen = 0;
  for (let g = 0; g < F.count; g++) {
    let hid = 0, vis = 0;
    for (let u = 0; u < F.nSub; u++) {
      if (!F.subMask[g * F.nSub + u]) continue;
      const sx = F.cx[g] + F.subs[u][0], sy = F.cy[g] + F.subs[u][1];
      if (blocked(lamp.x, lamp.y, sx, sy, ELL)) hid++; else vis++;
    }
    if (hid && !vis) { nHidden++; if (r.direct[g] > 0) leaked++; litHidden += r.total[g]; }
    else if (vis) { nSeen++; litSeen += r.direct[g]; }
  }
  ok('there are cells on both sides of the wall', nHidden > 5 && nSeen > 5);
  ok('every cell the lamp cannot see gets NO direct light at all',
    leaked === 0, `${leaked} of ${nHidden}`);
  ok('...while the floor it can see does', litSeen / nSeen > 0);
  // AND A RAY THAT GRAZES THE REFLEX CORNER IS NOT BLOCKED, which is not a
  // tolerance failure — it is the shadow's own edge, and a model that closed it
  // would be drawing a wall that is not there.
  ok('...and a sight line through the reflex corner itself is open',
    blocked(5.4, 1.5, 0.175, 4.725, ELL) === false);
  const hiddenTotal = { mean: nHidden ? litHidden / nHidden : 0 };
  const hidden = { mean: 0 }, seen = { mean: litSeen / Math.max(1, nSeen) };
  void hidden; void seen;
  ok('...and it is still not black, because light turns the corner by bouncing',
    hiddenTotal.mean > 0, String(hiddenTotal.mean));
  // AND THE SAME LAMP IN A ROOM WITH NO WALL IN THE WAY reaches that floor.
  const open = buildRoomGeometry({ polygonM: box(6, 6), heightM: 2.7, materials: LIGHT });
  const ro = solveRoom(open, [cob(5.4, 1.5, 2.7, 1200, 60)]);
  const corner = meanWhere(open, ro.direct, (x, y) => y > 4.5 && x < 2.5);
  ok('...proving it is the wall and not the distance', corner.mean > 0,
    String(corner.mean));
}


sec('9. resolution and segmentation do not move the answer');
{
  const poly = box(6, 4);
  const src = [cob(1.5, 1, 2.7), cob(4.5, 1, 2.7), cob(1.5, 3, 2.7), cob(4.5, 3, 2.7)];
  const fine = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT, mode: 'fine' });
  const coarse = buildRoomGeometry({ polygonM: poly, heightM: 2.7, materials: LIGHT, mode: 'coarse' });
  ok('the coarse pass really is a coarser FIELD',
    fine.field.count > coarse.field.count * 2,
    `${fine.field.count} vs ${coarse.field.count} cells`);
  /* ...AND THE SAME PATCH SET, which is the whole point of the coarse mode — see
     HEATMAP_RESOLUTION. A preview that changed the reflections would shift every
     colour in the room the moment the hand let go. */
  ok('...and the same patches, so the bounce is the same bounce',
    fine.patches.n === coarse.patches.n, `${fine.patches.n} vs ${coarse.patches.n}`);
  const f = solveRoom(fine, src), c = solveRoom(coarse, src);
  ok('the emitted total is identical at both resolutions', f.emitted === c.emitted);
  ok('the mean illuminance agrees within a few per cent', near(f.mean, c.mean, 0.05),
    `${f.mean.toFixed(1)} vs ${c.mean.toFixed(1)} lx`);
  ok('the field grid is inside the 25-50 cm the brief asks for',
    HEATMAP_RESOLUTION.fine.fieldM >= 0.25 && HEATMAP_RESOLUTION.fine.fieldM <= 0.5);

  // THE SAME PHYSICAL RUN, CUT UP TWO DIFFERENT WAYS BY THE CALLER — which is
  // what the adapter does when a cove turns a corner. One 4 m source resolves
  // to 13 segments; four 1 m sources resolve to 3 each.
  const z = 2.7 - DISTRIBUTION_PROFILES.cove.dropMm / 1000;
  const whole = [{ profileId: 'cove', lm: 1600,
                   geom: { kind: 'line', a: { x: 1, y: 0.3, z }, b: { x: 5, y: 0.3, z } } }];
  const quartered = [];
  for (let i = 0; i < 4; i++) {
    quartered.push({ profileId: 'cove', lm: 400,
      geom: { kind: 'line', a: { x: 1 + i, y: 0.3, z }, b: { x: 2 + i, y: 0.3, z } } });
  }
  const w = solveRoom(fine, whole), q = solveRoom(fine, quartered);
  ok('a run split into four emits the same lumens', near(w.emitted, q.emitted, 1e-9));
  ok('...and lights the room the same, within a few per cent',
    near(w.mean, q.mean, 0.05), `${w.mean.toFixed(1)} vs ${q.mean.toFixed(1)} lx`);

  // AND THE FLOOR AREA IS THE TRUE AREA, not a count of whole cells — which is
  // what stops a room reading bright or dim purely from how its outline fell
  // across the grid.
  for (const step of [0.7, 0.9, 1.3]) {
    const p = buildPatches(poly, 2.7, LIGHT, { patchM: step, wallBandM: step });
    let floor = 0;
    for (let i = 0; i < p.n; i++) if (p.kind[i] === 0) floor += p.area[i];
    ok(`floor patches at ${step} m tile exactly 24 m2`, near(floor, 24, 1e-9),
      floor.toFixed(4));
  }
  const grid = buildFieldGrid(poly, 0.35);
  ok('the field grid reports the step it actually used', grid.step > 0);
  ok('...and its compact cell list matches its inside mask',
    grid.count === grid.inside.reduce((s, v) => s + v, 0)
    && grid.cx.length === grid.count);
}


sec('10. the colour of a cell depends on its lux and its target, and nothing else');
{
  const stops = HEATMAP_BANDS.map((b, i) => ({ at: b.anchor, rgb: [i * 50, 10, 200 - i * 40] }));
  ok('a ratio at a band anchor is that band\'s colour exactly',
    HEATMAP_BANDS.every((b, i) => {
      const c = colourFor(b.anchor, stops);
      return c[0] === i * 50 && c[2] === 200 - i * 40;
    }));
  ok('between anchors it blends rather than steps',
    (() => {
      const a = colourFor(HEATMAP_BANDS[1].anchor, stops);
      const b = colourFor(HEATMAP_BANDS[2].anchor, stops);
      const mid = colourFor((HEATMAP_BANDS[1].anchor + HEATMAP_BANDS[2].anchor) / 2, stops);
      return mid[0] > Math.min(a[0], b[0]) && mid[0] < Math.max(a[0], b[0]);
    })());
  ok('below the scale it saturates at the first colour',
    colourFor(0, stops)[0] === colourFor(-5, stops)[0]
    && colourFor(0, stops)[0] === stops[0].rgb[0]);
  ok('above the scale it saturates at the last',
    colourFor(3, stops)[0] === colourFor(9999, stops)[0]
    && colourFor(9999, stops)[0] === stops[stops.length - 1].rgb[0]);
  ok('a colour is a pure function of the ratio — same ratio, same colour, always',
    JSON.stringify(colourFor(1.03, stops)) === JSON.stringify(colourFor(1.03, stops)));

  // THE STABILITY REQUIREMENT, STATED AS THE THING THAT WOULD BREAK IT. A scale
  // fitted to a room's own extremes would give the same lux two different
  // colours in two rooms; this one cannot, because it never sees an extreme.
  const target = 150;
  const dim = [40, 90, 150, 220];               // a "layout" whose max is 220
  const bright = [40, 90, 150, 220, 2000];      // ...and one whose max is 2000
  const colourOf = (lux) => colourFor(lux / target, stops).join(',');
  ok('identical lux keeps its colour when a brighter fitting is added elsewhere',
    dim.every((lux) => colourOf(lux) === colourOf(bright[dim.indexOf(lux)])));
  ok('...and 150 lx against a 150 lx target is always the on-target band',
    heatmapBandFor(150 / 150).id === '75-125');

  ok('the bands are the brief\'s five, in order, and cover every ratio',
    HEATMAP_BANDS.length === 5
    && HEATMAP_BANDS[0].from === 0
    && HEATMAP_BANDS[HEATMAP_BANDS.length - 1].to === null
    && HEATMAP_BANDS.every((b, i) => i === 0 || b.from === HEATMAP_BANDS[i - 1].to));
  ok('every band names a CSS custom property and no colour',
    HEATMAP_BANDS.every((b) => /^--color-heatmap-/.test(b.token)
      && !('colour' in b) && !('color' in b)));
  ok('the three middle anchors sit at their bands\' midpoints',
    HEATMAP_BANDS.slice(1, 4).every(
      (b) => Math.abs(b.anchor - (b.from + b.to) / 2) < 1e-9));
  /* AND THE TWO ENDS ANCHOR AT THEIR OWN ENDS, both deliberately — see the note
     on the table. The bottom one at ZERO is what gives the dark end of the scale
     any gradient at all: anchored at its midpoint it made everything under an
     eighth of target one flat colour, which is where a few feet of decorative
     tape lands, and adding one to a dark room changed nothing visible. */
  ok('the bottom band anchors at nothing-at-all, so the dark end has gradient',
    HEATMAP_BANDS[0].anchor === 0);
  ok('...and a cell at a tenth of target is no longer the same colour as zero',
    colourFor(0.1, stops).join(',') !== colourFor(0, stops).join(','));
  ok('...while everything in that band still reads as the band\'s own colour',
    (() => {
      const blue = stops[0].rgb, cyan = stops[1].rgb;
      const at = colourFor(0.24, stops);
      // Still nearer the band's own anchor than the next one's, at the very top
      // of the band — which is what "below 25% is deep blue" has to keep meaning.
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      return d(at, blue) <= d(at, cyan);
    })());
  ok('the open top anchors past its own floor rather than at a midpoint',
    HEATMAP_BANDS[4].anchor > HEATMAP_BANDS[4].from && HEATMAP_BANDS[4].to === null);
  ok('the anchors ascend', HEATMAP_BANDS.every((b, i) => i === 0
    || b.anchor > HEATMAP_BANDS[i - 1].anchor));
  ok('a ratio on a boundary belongs to the band above it',
    heatmapBandFor(0.25).id === '25-75' && heatmapBandFor(0.75).id === '75-125'
    && heatmapBandFor(1.25).id === '125-200' && heatmapBandFor(2).id === 'above-200');

  ok('a hex, a short hex and an rgb() all parse',
    JSON.stringify(parseColour('#1B3FA0')) === '[27,63,160]'
    && JSON.stringify(parseColour('#abc')) === '[170,187,204]'
    && JSON.stringify(parseColour('rgb(1 2 3)')) === '[1,2,3]'
    && parseColour('') === null && parseColour('teal') === null);
  ok('with no document there is no palette, and no invented fallback',
    readHeatmapPalette() === null);
  ok('a caller with no palette gets null rather than a default colour',
    colourFor(1, null) === null);
  ok('the overlay reads harder than a throw pool, and not so hard the symbols go',
    HEATMAP_OPACITY > 0.3 && HEATMAP_OPACITY < 0.75);
  /* --- AND THE NIGHT SHEET NEEDS MORE OF IT ------------------------------
     ALPHA OVER BLACK MULTIPLIES. On the inverted plan the ground is black, so a
     band at the paper opacity keeps only that fraction of its own value — the
     deep blue at 0.55 is (15, 35, 88), which is the ground. THE COLOURS DO NOT
     CHANGE and must not: the five bands mean five stated things and the legend
     states them, so what the ground moves is how much of it shows through. */
  ok('the night sheet gets a higher opacity than paper',
    HEATMAP_OPACITY_NIGHT > HEATMAP_OPACITY && HEATMAP_OPACITY_NIGHT <= 1);
  ok('...enough that the cold end of the scale survives a black ground',
    (() => {
      const blue = parseColour('#1B3FA0');
      const overBlack = blue.map((c) => c * HEATMAP_OPACITY_NIGHT);
      // The blue channel has to clear the ground by a wide margin, and the
      // band has to still read as blue rather than as grey.
      return overBlack[2] > 100 && overBlack[2] > overBlack[0] * 3;
    })());
  ok('...and the ground picks between the two figures',
    heatmapOpacity(false) === HEATMAP_OPACITY
    && heatmapOpacity(true) === HEATMAP_OPACITY_NIGHT);
  ok('...and it is the OPACITY that moves, never a colour', (() => {
    // The scale is a function of the ratio and the anchors only — there is no
    // ground argument anywhere in it, which is what makes green mean the same
    // ratio on paper and at night.
    const a = colourFor(1, stops), b = colourFor(1, stops);
    return colourFor.length === 2 && JSON.stringify(a) === JSON.stringify(b);
  })());

  /* --- AND THE TOKENS ARE THE ONLY PLACE THE COLOURS EXIST ----------------
     ASSERTED BY READING THE SOURCE, because that is the only way to assert it:
     the requirement is that no JavaScript in this feature holds a heatmap
     colour, and a value that is not there cannot be tested for by calling
     anything. Comments are stripped first — the notes in styles.css and the
     profiles table are allowed to NAME a colour in prose. */
  const dir = new URL('../src/features/heatmap/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => /\.jsx?$/.test(f));
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const hits = src.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hits) offenders.push(`${f}: ${hits.join(' ')}`);
  }
  ok('no file in features/heatmap holds a colour literal', offenders.length === 0,
    offenders.join('; '));
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  ok('...and all five tokens are declared in the theme block',
    HEATMAP_BANDS.every((b) => css.includes(`${b.token}:`)), 'src/styles.css');
}


sec('11. the target is a lux figure of its own, and not either lumen budget');
{
  ok('the measurement plane is named and it is the floor',
    HEATMAP_PLANE.id === 'floor' && HEATMAP_PLANE.heightM === 0
    && typeof HEATMAP_PLANE.label === 'string' && HEATMAP_PLANE.label.length > 0);
  ok('every project this app offers has a target',
    Object.keys(LUMENS_PER_SQFT).every((p) => HEATMAP_TARGET_LUX[p] > 0));
  ok('a project nobody has a figure for takes the default',
    heatmapTargetFor('nothing-like-this', null) === HEATMAP_TARGET_LUX_DEFAULT);
  ok('room type wins over project, the way lumenCriteriaFor already has it',
    heatmapTargetFor('residential', 'kitchen')
      === HEATMAP_TARGET_LUX_BY_ROOM.kitchen
    && HEATMAP_TARGET_LUX_BY_ROOM.kitchen !== HEATMAP_TARGET_LUX.residential);
  ok('an office asks for more than a flat', HEATMAP_TARGET_LUX.office > HEATMAP_TARGET_LUX.residential);
  ok('a bedroom asks for less than a kitchen',
    HEATMAP_TARGET_LUX_BY_ROOM.bedroom < HEATMAP_TARGET_LUX_BY_ROOM.kitchen);
  // THE WHOLE REASON THIS TABLE EXISTS. Neither existing figure is a lux
  // target: one is per square foot of total SURFACE, the other per square foot
  // of FLOOR, and both are LUMENS. If a future edit ever made them equal, that
  // would be a coincidence being mistaken for an identity.
  ok('it is not LUMENS_PER_SQFT, which is lumens per sqft of total surface',
    HEATMAP_TARGET_LUX.residential !== LUMENS_PER_SQFT.residential);
  ok('...and not LUMEN_CRITERIA, which is lumens per sqft of floor',
    HEATMAP_TARGET_LUX.residential !== LUMEN_CRITERIA.residential);
  ok('...and it is in the order of magnitude a lux target is',
    Object.values(HEATMAP_TARGET_LUX).every((v) => v >= 50 && v <= 1000));
}


sec('12. the adapter reads the app\'s own lists and invents nothing');
{
  const S = 40;                                  // px per foot, as the canvas has it
  const metresPerPx = M_PER_FT / S;
  const ftPx = (ft) => ft * S;
  // A 20 x 13 ft room — about 6.1 x 4.0 m.
  const polygonPx = [{ x: 0, y: 0 }, { x: ftPx(20), y: 0 },
                     { x: ftPx(20), y: ftPx(13) }, { x: 0, y: ftPx(13) }];
  const room = {
    id: 'R1', outline: { name: 'Living' },
    geo: { polygonPx, fansInRoom: [{ kind: 'chandelier', x: ftPx(10), y: ftPx(6.5), r: ftPx(1.5) }] },
    plan: { ok: true, lightsPx: [
      { id: 'L1', x: ftPx(5), y: ftPx(4), fixture: 'small' },
      { id: 'L2', x: ftPx(15), y: ftPx(4), fixture: 'small' },
      { id: 'L3', x: ftPx(5), y: ftPx(9), fixture: 'small' },
      { id: 'L4', x: ftPx(15), y: ftPx(9), fixture: 'small' },
    ] },
  };
  /* THE ROWS `analyseSpace` WOULD HAVE PRODUCED. Written out rather than run
     through the whole pipeline, because what is under test is the MAPPING from
     a row to a fitting — which row key belongs to which population — and that
     is a fact about `fixtureGroups`' conventions rather than about a layout. */
  const analysis = { rows: [
    { key: 'cob', familyId: 'cob', count: 4, metres: null, totalOutput: 2100, beam: null },
    { key: 'spot', familyId: 'cob', count: 1, metres: null, totalOutput: 375, beam: null },
    { key: 'cv1', familyId: 'cove', count: 1, metres: 10, totalOutput: 4000, beam: null },
    { key: 'sconce', familyId: 'sconce', count: 2, metres: null, totalOutput: 1120, beam: null },
    { key: 'lamp', familyId: 'lamp', count: 1, metres: null, totalOutput: 675, beam: null },
    { key: 'mcob-1', familyId: 'cob', count: 1, metres: null, totalOutput: 900, beam: 24 },
  ] };
  const rows = indexAnalysisRows(analysis);
  ok('a counted row\'s per-unit output is its total over its count',
    rows.get('cob').perUnit === 525);
  ok('a linear row\'s per-unit output is its total over its METRES',
    rows.get('cv1').perUnit === 400);

  const sources = buildRoomEmitters({
    room, analysis, metresPerPx, ceilingMm: 2700,
    accentZones: [
      { id: 'cv1', roomId: 'R1', type: 'strip', kind: 'cove',
        loop: [{ x: ftPx(2), y: ftPx(2) }, { x: ftPx(18), y: ftPx(2) },
               { x: ftPx(18), y: ftPx(11) }, { x: ftPx(2), y: ftPx(11) }] },
      { id: 'sc1', roomId: 'R1', type: 'sconce',
        point: { x: 0, y: ftPx(6) }, inward: { x: 1, y: 0 } },
      { id: 'sc2', roomId: 'R1', type: 'sconce',
        point: { x: ftPx(20), y: ftPx(6) }, inward: { x: -1, y: 0 } },
      { id: 'nope', roomId: 'OTHER', type: 'strip', kind: 'cove', loop: [] },
    ],
    taskSpots: [
      { id: 'sp1', roomId: 'R1', fixture: 'spot', x: ftPx(3), y: ftPx(3),
        target: { x: ftPx(6), y: ftPx(6) } },
      { id: 'sp2', roomId: 'R1', fixture: 'spot', rejected: 'no room' },
    ],
    manualCobs: [{ id: 'mcob-1', roomId: 'R1', xFt: 10, yFt: 3,
                   x: ftPx(10), y: ftPx(3), watts: 12, beam: 24 }],
    arrayCobs: [], magTracks: [], trackModules: [],
  });

  /* --- EVERY POSITION ARRIVES IN PLAN PIXELS, AND THE ADAPTER PROVES IT ----
     THIS IS A REGRESSION TEST FOR A REAL BUG. The hook was handed `manualCobs`
     — the document's own store, which holds `xFt`/`yFt` and no `x` at all —
     instead of `manualCobsPx`, the projection that puts pixels on. The adapter
     read `undefined`, placed the lamp at NaN, and every hand-placed spot
     contributed exactly nothing to the field. NOTHING THREW: a NaN source fails
     every comparison in the solver, so it delivered no light and produced no
     error, and the only symptom was a fitting on the drawing that the heatmap
     did not know about.
     SO THE ADAPTER REFUSES A SOURCE WITHOUT A POSITION, and this is what says
     so. A caller can get the list wrong again; it cannot do it silently. */
  const feetOnly = buildRoomEmitters({
    room: { ...room, geo: { ...room.geo, fansInRoom: [] },
            plan: { ok: true, lightsPx: [] } },
    analysis, metresPerPx, ceilingMm: 2700,
    manualCobs: [{ id: 'mcob-1', roomId: 'R1', xFt: 10, yFt: 3, watts: 12, beam: 24 }],
  });
  ok('a fitting with feet and no pixels produces no emitter at all',
    feetOnly.length === 0, JSON.stringify(feetOnly));
  const withPixels = buildRoomEmitters({
    room: { ...room, geo: { ...room.geo, fansInRoom: [] },
            plan: { ok: true, lightsPx: [] } },
    analysis, metresPerPx, ceilingMm: 2700,
    manualCobs: [{ id: 'mcob-1', roomId: 'R1', xFt: 10, yFt: 3,
                   x: ftPx(10), y: ftPx(3), watts: 12, beam: 24 }],
  });
  ok('...and the same fitting projected produces one, at a real position',
    withPixels.length === 1 && Number.isFinite(withPixels[0].geom.p.x)
    && Number.isFinite(withPixels[0].geom.p.y), JSON.stringify(withPixels));
  ok('...which puts light on the floor rather than nowhere', (() => {
    const g = buildRoomGeometry({
      polygonM: polygonPx.map((q) => ({ x: q.x * metresPerPx, y: q.y * metresPerPx })),
      heightM: 2.7, materials: LIGHT });
    return solveRoom(g, withPixels).max > 50 && solveRoom(g, feetOnly).max === 0;
  })());
  ok('NOT ONE EMITTER ANYWHERE IN THE ROOM IS AT A NON-FINITE POSITION',
    sources.every((q) => {
      const gg = q.geom;
      const fin = (pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)
        && Number.isFinite(pt.z);
      return gg.kind === 'point' ? fin(gg.p)
        : gg.kind === 'line' ? fin(gg.a) && fin(gg.b)
        : gg.kind === 'ring' ? fin(gg.c) && Number.isFinite(gg.r) : fin(gg.c);
    }));

  const byProfile = {};
  for (const s of sources) byProfile[s.profileId] = (byProfile[s.profileId] ?? 0) + 1;
  ok('the four grid downlights arrive as points', byProfile.cob >= 4);
  ok('a refused task spot produces no emitter', byProfile.spot === 1);
  ok('the two sconces arrive', byProfile.sconce === 2);
  ok('the chandelier arrives as a ring and not as the floor lamp',
    byProfile.chandelier === 1 && !byProfile.floor_lamp);
  ok('the cove arrives as one line source per leg of its loop',
    byProfile.cove === 4, JSON.stringify(byProfile));
  ok('a run in another room is ignored',
    sources.every((s) => s.lm > 0));

  // WHICH FIGURES CAME FROM WHERE. The lumens are the ROW's, the optic is the
  // FITTING's — see the header of emitters.js.
  const grid = sources.filter((s) => s.profileId === 'cob' && s.beamDeg === 36);
  ok('a grid lamp takes its lumens from the row and its beam from the catalogue',
    grid.length === 4 && grid.every((s) => s.lm === 525));
  const placed = sources.find((s) => s.profileId === 'cob' && s.beamDeg === 24);
  ok('a hand-placed lamp takes its own beam and its own row\'s output',
    placed && placed.lm === 900);
  const spot = sources.find((s) => s.profileId === 'spot');
  ok('a spot is AIMED, at the point the placer chose',
    spot.aim && spot.aim.z < 0 && spot.aim.x > 0 && spot.aim.y > 0);
  ok('...and its aim is a unit vector',
    near(Math.hypot(spot.aim.x, spot.aim.y, spot.aim.z), 1, 1e-9));

  /* --- A SPOT A HAND PUT DOWN IS THE SAME FITTING TO THIS FEATURE ----------
     ASSERTED BECAUSE IT WAS REPORTED MISSING, and the report was about the
     GESTURE rather than about the field: the rail's card still described the
     box-drag that had been retired for two clicks (see LightPalette), so the
     drag placed nothing and there was nothing for the heatmap to show. The
     field itself was always right, and this is what says so.
     `hand: true` AND NO `surfaceId`, which is the shape `projectTaskSpotsPx`'s
     fourth pass produces — a body in feet, an aim angle, and a target six feet
     along it. It shares the `spot` row with the placer's own spots, which is
     what `fixtureGroups` does with it. */
  const handSpot = {
    id: 'mspot-1', roomId: 'R1', fixture: 'spot', hand: true,
    x: ftPx(10), y: ftPx(6.5),
    target: { x: ftPx(16), y: ftPx(6.5) }, angle: 0,
  };
  const handSrc = buildRoomEmitters({
    /* NO GRID AND NO PENDANT, so what is under test is the spot on its own. The
       room fixture above deliberately carries both. */
    room: { ...room, geo: { ...room.geo, fansInRoom: [] },
            plan: { ok: true, lightsPx: [] } },
    analysis, metresPerPx, ceilingMm: 2700, taskSpots: [handSpot] });
  ok('a hand-placed spot becomes an emitter like any other',
    handSrc.length === 1 && handSrc[0].profileId === 'spot'
    && handSrc[0].lm === 375 && handSrc[0].beamDeg === 30,
    JSON.stringify(handSrc));
  ok('...aimed down and along the angle it was turned to',
    handSrc[0].aim.x > 0.4 && Math.abs(handSrc[0].aim.y) < 1e-9
    && handSrc[0].aim.z < -0.5);
  const handGeo = buildRoomGeometry({
    polygonM: polygonPx.map((p) => ({ x: p.x * metresPerPx, y: p.y * metresPerPx })),
    heightM: 2.7, materials: LIGHT });
  const handField = solveRoom(handGeo, handSrc);
  ok('...and it shows on the field: a bright spot on an otherwise dark floor',
    handField.max > 60 && handField.max > handField.min * 10,
    `${handField.min.toFixed(1)} to ${handField.max.toFixed(1)} lx`);
  // AND IT LANDS WHERE THE ARROW POINTS, not under the fitting — the one thing
  // about a directional spot that a heatmap can get visibly wrong.
  const aimAt = { x: 16 * M_PER_FT, y: 6.5 * M_PER_FT };
  const under = { x: 10 * M_PER_FT, y: 6.5 * M_PER_FT };
  const nearAim = meanWhere(handGeo, handField.direct,
    (x, y) => Math.hypot(x - aimAt.x, y - aimAt.y) < 0.6);
  const nearBody = meanWhere(handGeo, handField.direct,
    (x, y) => Math.hypot(x - under.x, y - under.y) < 0.6);
  ok('...at the point it is aimed at rather than beneath itself',
    nearAim.mean > nearBody.mean * 2,
    `aim ${nearAim.mean.toFixed(1)} vs body ${nearBody.mean.toFixed(1)} lx`);

  // HEIGHTS. The slab from the space, everything else from the profile.
  const h = 2.7;
  ok('a downlight is at the slab', near(grid[0].geom.p.z, h, 1e-9));
  const coveSrc = sources.find((s) => s.profileId === 'cove');
  ok('a cove is a documented drop below it',
    near(coveSrc.geom.a.z, h - DISTRIBUTION_PROFILES.cove.dropMm / 1000, 1e-9));
  const sc = sources.find((s) => s.profileId === 'sconce');
  ok('a sconce is at its own documented height',
    near(sc.geom.p.z, DISTRIBUTION_PROFILES.sconce.heightMm / 1000, 1e-9));
  ok('...and carries the inward normal the placer worked out',
    sc.inward && Math.abs(sc.inward.x) === 1);
  const ch = sources.find((s) => s.profileId === 'chandelier');
  ok('a pendant hangs a documented drop below the slab',
    near(ch.geom.c.z, h - DISTRIBUTION_PROFILES.chandelier.dropMm / 1000, 1e-9));
  ok('...with a radius taken from the object\'s own diameter', ch.geom.r > 0.2);

  /* --- AND A STANDING LAMP STANDS, WHICH IS THE OTHER HALF OF ONE FAMILY ----
     THE SAME `lamp` ROW AND A DIFFERENT PROFILE. A pendant and a floor lamp are
     one accounting family — one split, one row in the schedule — and two
     distributions, because one hangs 600mm under the slab and the other stands
     1500mm off the floor. That is the split this table's header calls "keyed by
     what a thing IS rather than by its family".
     READ OFF `objectsInRoom` AND NOT `fansInRoom`, WHICH IS THE BUG THIS
     GUARDS. A standing lamp is off-ceiling, so it is filtered out of the
     obstacle list before a layout ever sees it — a pass reading that list could
     not have found one, and the lamp would have lit nothing while appearing on
     the drawing. */
  const stand = buildRoomEmitters({
    room: { ...room,
      geo: { ...room.geo, fansInRoom: [],
             objectsInRoom: [{ kind: 'standing_lamp', x: ftPx(4), y: ftPx(4),
                               r: ftPx(0.74) }] },
      plan: { ok: true, lightsPx: [] } },
    analysis: { rows: [{ key: 'lamp', familyId: 'lamp', count: 1, metres: null,
                         totalOutput: 525, beam: null }] },
    metresPerPx, ceilingMm: 2700,
  });
  const sl = stand.find((q) => q.profileId === 'floor_lamp');
  ok('a standing lamp is an emitter, and it takes the floor lamp\'s profile', !!sl);
  ok('...a POINT and not a ring, because a 450mm shade is not a metre-wide one',
    sl?.geom.kind === 'point');
  ok('...at its own documented height above the FLOOR',
    near(sl.geom.p.z, DISTRIBUTION_PROFILES.floor_lamp.heightMm / 1000, 1e-9),
    `${sl.geom.p.z} m`);
  ok('...carrying the whole of the lamp row\'s per-piece output', sl.lm > 0);
  // AND NOTHING AT ALL WHERE THE OBJECT LIST ONLY HAS THE OBSTACLES IN IT: the
  // fallback keeps a caller that hands in `fansInRoom` alone lighting its
  // pendants, and a standing lamp was never in that list to begin with.
  ok('a room whose object list is empty lights no lamp',
    !buildRoomEmitters({
      room: { ...room, geo: { ...room.geo, fansInRoom: [], objectsInRoom: [] },
        plan: { ok: true, lightsPx: [] } },
      analysis: { rows: [{ key: 'lamp', familyId: 'lamp', count: 1, metres: null,
                           totalOutput: 525, beam: null }] },
      metresPerPx, ceilingMm: 2700,
    }).some((q) => q.profileId === 'floor_lamp' || q.profileId === 'chandelier'));

  // LENGTH ALLOCATION. The loop's four legs are 16, 9, 16 and 9 ft, so the two
  // long legs must carry the lumens the two short ones do not.
  const legs = sources.filter((s) => s.profileId === 'cove').map((s) => s.lm).sort((a, b) => a - b);
  ok('a cove\'s output is allocated by LENGTH, leg by leg',
    near(legs[3] / legs[0], 16 / 9, 1e-6), legs.join('/'));
  const totalCove = legs.reduce((a, b) => a + b, 0);
  const perimeterM = 2 * (16 + 9) * M_PER_FT;
  ok('...and the legs add up to the run\'s own metre rate',
    near(totalCove, 400 * perimeterM, 1e-6), `${totalCove.toFixed(1)} lm`);

  // A FAMILY THE LUMEN MODEL IS NOT COUNTING LIGHTS NOTHING. The track wall
  // washer has no output specified, so no row exists and no emitter is built.
  const withWasher = buildRoomEmitters({
    room, analysis, metresPerPx, ceilingMm: 2700,
    magTracks: [{ id: 't1', roomId: 'R1' }],
    trackModules: [{ id: 'm1', on: 't1', kind: 'washer', x: 0, y: 0, ux: 1, uy: 0 }],
  });
  ok('an unspecified module contributes no light and does not throw',
    withWasher.every((s) => s.profileId !== 'wall_washer'));

  // A DIFFUSER IS A BODY ALONG THE RUN and a track spot is a point on it.
  const withTrack = buildRoomEmitters({
    room, analysis: { rows: [
      { key: 'd1', familyId: 'track_diffuser', count: 1, metres: null, totalOutput: 1000 },
      { key: 's1', familyId: 'track_spot', count: 1, metres: null, totalOutput: 500 }] },
    metresPerPx, ceilingMm: 2700,
    magTracks: [{ id: 't1', roomId: 'R1' }],
    trackModules: [
      { id: 'd1', on: 't1', kind: 'diffuser', x: ftPx(8), y: ftPx(6), ux: 1, uy: 0, watts: 18 },
      { id: 's1', on: 't1', kind: 'spot', x: ftPx(12), y: ftPx(6), ux: 1, uy: 0, watts: 5, beam: 30 }],
  });
  const dif = withTrack.find((s) => s.profileId === 'track_diffuser');
  const tsp = withTrack.find((s) => s.profileId === 'track_spot');
  ok('a track diffuser is a line lying ALONG its run',
    dif && dif.geom.kind === 'line' && dif.geom.b.x > dif.geom.a.x
    && near(dif.geom.a.y, dif.geom.b.y, 1e-9));
  ok('a track spot is a point on it', tsp && tsp.geom.kind === 'point');

  // WHICH WAY A RUN FACES, worked out from the outline rather than stored.
  const polyM = polygonPx.map((p) => ({ x: p.x * metresPerPx, y: p.y * metresPerPx }));
  const onBottom = inwardOfRun({ x: 1, y: 0.05 }, { x: 4, y: 0.05 }, polyM);
  ok('a run along the bottom wall faces up into the room',
    onBottom && onBottom.y > 0.99, JSON.stringify(onBottom));
  ok('a run across the middle of the room faces nothing at all',
    inwardOfRun({ x: 1, y: 2 }, { x: 4, y: 2 }, polyM) === null);

  // AND THE WHOLE THING SOLVES.
  const geo = buildRoomGeometry({ polygonM: polyM, heightM: 2.7, materials: LIGHT });
  const solved = solveRoom(geo, sources);
  ok('the assembled room solves to a plausible field',
    solved.mean > 20 && solved.mean < 2000, `${solved.mean.toFixed(0)} lx`);
  ok('...and its emitted total is the sum of the sources',
    near(solved.emitted, sources.reduce((s, q) => s + q.lm, 0), 1e-6));
  const dp = directPass(geo, sources);
  ok('...with the direct pass never delivering more than was emitted',
    dp.onSurfaces <= dp.emitted * (1 + 1e-9),
    `${dp.onSurfaces.toFixed(1)} of ${dp.emitted.toFixed(1)}`);
}


sec('12b. a hand-placed run belongs to the space it is DRAWN over');
{
  /* --- THE BUG THIS SECTION EXISTS FOR ------------------------------------
     A STRIP IS TWO CLICKS AND THE FIRST ONE IS SNAPPED. `snapPlacing` pulls
     onto walls, corners and existing fittings, so a run aimed at the edge of a
     space can have its opening pixel resolve into the space NEXT DOOR — and
     `roomId` was stamped from that pixel and never revisited, while the run was
     DRAWN at its own coordinates. The fitting appeared in one room and was
     counted in another: the schedule billed it next door, the Analysis panel
     reported the room you had just lit as ACHIEVED 0, and the heatmap coloured
     it dark. Three readers, all correct, one wrong fact underneath.
     ASSERTED THROUGH THE REAL PROJECTION AND THE REAL LUMEN MODEL, because that
     is where the fault was and where the fix is — see the note on `homeOf` in
     projectAccentZonesPx. The heatmap only ever read what those two said. */
  const S = 40, ftPx = (ft) => ft * S;
  const mkRoom = (id, x0, y0, x1, y1) => {
    const poly = [{ x: ftPx(x0), y: ftPx(y0) }, { x: ftPx(x1), y: ftPx(y0) },
                  { x: ftPx(x1), y: ftPx(y1) }, { x: ftPx(x0), y: ftPx(y1) }];
    return { id, outline: { name: id }, coveStrips: [],
             geo: { polygonPx: poly, fansInRoom: [],
                    polygonFt: poly.map((p) => ({ x: p.x / S, y: p.y / S })) },
             plan: { ok: true, polygonPx: poly, lightsPx: [], lights: [], chunksPx: [] } };
  };
  const hall = mkRoom('hall', 0, 0, 9, 10), kitchen = mkRoom('kitchen', 10, 0, 19, 10);
  const rooms = [hall, kitchen];
  // Drawn across the kitchen; stamped against the hall, as a snapped first
  // click produces.
  const a = { x: ftPx(11), y: ftPx(2) }, b = { x: ftPx(18), y: ftPx(2) };
  const strip = { id: 'man-1', type: 'strip', roomId: 'hall', source: 'placed',
    label: 'LED strip', run: [a, b], runLength: Math.hypot(b.x - a.x, b.y - a.y),
    rect: { x0: a.x, y0: a.y, x1: b.x, y1: b.y } };

  const zones = projectAccentZonesPx(rooms, {}, [], [strip], [], [], [], S);
  ok('the run is re-homed onto the space its centre is over',
    zones.length === 1 && zones[0].roomId === 'kitchen', JSON.stringify(zones[0]?.roomId));
  ok('...without mutating the stored zone', strip.roomId === 'hall');

  const opts = { accentZonesPx: zones, taskSpotsPx: [], cobArrays: [], arrayCobsPx: [],
                 magTracksPx: [], trackModulesPx: [], manualCobs: [], pxPerFt: S };
  const seen = {};
  for (const r of rooms) {
    const g = fixtureGroups(r, opts);
    seen[r.id] = analyseSpace({
      polygonFt: r.geo.polygonFt, ceilingMm: 2700, materials: LIGHT,
      projectId: 'residential', country: 'India', groups: g, watts: {} });
  }
  ok('the space it is drawn in no longer reports ACHIEVED 0',
    seen.kitchen.achieved > 0, String(Math.round(seen.kitchen.achieved)));
  ok('...and the neighbour is no longer credited with it',
    seen.hall.achieved === 0, String(Math.round(seen.hall.achieved)));
  ok('...and the heatmap follows, because it reads the same rows', (() => {
    const polyM = kitchen.geo.polygonPx.map((p) => ({ x: p.x * (M_PER_FT / S), y: p.y * (M_PER_FT / S) }));
    const g = buildRoomGeometry({ polygonM: polyM, heightM: 2.7, materials: LIGHT });
    const src = buildRoomEmitters({ room: kitchen, analysis: seen.kitchen,
      metresPerPx: M_PER_FT / S, ceilingMm: 2700, accentZones: zones });
    return src.length === 1 && solveRoom(g, src).mean > 0;
  })());

  /* AND A RUN OVER NO SPACE AT ALL KEEPS THE HOME IT HAD, so a threshold run or
     one left outside a re-traced outline does not vanish off the drawing. */
  const stray = { ...strip, id: 'man-2',
    run: [{ x: ftPx(30), y: ftPx(30) }, { x: ftPx(34), y: ftPx(30) }],
    rect: { x0: ftPx(30), y0: ftPx(30), x1: ftPx(34), y1: ftPx(30) } };
  const strayZones = projectAccentZonesPx(rooms, {}, [], [stray], [], [], [], S);
  ok('a run whose centre is over no space keeps its stored home',
    strayZones.length === 1 && strayZones[0].roomId === 'hall');
  /* ...AND A RUN WHOSE STORED HOME HAS BEEN RE-TRACED AWAY IS RECOVERED, which
     is the other half of resolving at the read: the live test is against the
     RESOLVED home, so standing over a space that exists is enough. */
  const orphan = { ...strip, id: 'man-3', roomId: 'gone-away' };
  const orphanZones = projectAccentZonesPx(rooms, {}, [], [orphan], [], [], [], S);
  ok('...and one whose stored home is gone is recovered by where it stands',
    orphanZones.length === 1 && orphanZones[0].roomId === 'kitchen');
  ok('a deleted run is still deleted',
    projectAccentZonesPx(rooms, {}, ['man-1'], [strip], [], [], [], S).length === 0);
  // A SCONCE IS UNAFFECTED: `placeZone` already resolves it against a room's own
  // polygon, so its `point` lands in the room it was placed against.
  const sconce = { id: 'man-s', type: 'sconce', roomId: 'kitchen',
    point: { x: ftPx(19), y: ftPx(5) }, inward: { x: -1, y: 0 },
    rect: { x0: ftPx(18.5), y0: ftPx(4.5), x1: ftPx(19), y1: ftPx(5.5) } };
  ok('a sconce on its own wall keeps its room', (() => {
    const z = projectAccentZonesPx(rooms, {}, [], [sconce], [], [], [], S);
    return z.length === 1 && z[0].roomId === 'kitchen';
  })());
}


sec('13. the layer, the ordering, the legend and the pointer');
{
  ok('the heatmap layer exists and is OFF by default',
    'heatmap' in LAYER_DEFAULTS && LAYER_DEFAULTS.heatmap === false);

  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    cacheDir: path.join(os.tmpdir(), 'superluminal-heatmap-test'),
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = async (p) => (await vite.ssrLoadModule(p)).default;
  const PlanCanvas = await load('/src/components/PlanCanvas.jsx');
  const HeatmapOverlay = await load('/src/features/heatmap/HeatmapOverlay.jsx');
  const HeatmapLegend = await load('/src/features/heatmap/HeatmapLegend.jsx');
  const HeatmapSwitch = await load('/src/features/heatmap/HeatmapSwitch.jsx');
  const useHeatmap = await load('/src/features/heatmap/useHeatmap.js');

  /* --- WHERE THE FIELD SITS IN THE PAINT ORDER ---------------------------
     SVG HAS NO Z-INDEX: it paints in document order, so "under every mark we
     make" is a statement about the position of one element in the markup and is
     exactly what a rendered string can be asked. A sentinel is handed in as the
     layer so the assertion does not depend on the overlay producing anything —
     in Node it produces nothing, having no canvas to paint into. */
  const sentinel = React.createElement('g', { id: 'HEATMAP-HERE' });
  const roomPoly = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const plans = [{
    id: 'R1', outline: { name: 'Room' },
    geo: { polygonPx: roomPoly, fansInRoom: [] },
    plan: { ok: true, polygonPx: roomPoly, cellsPx: [], chunksPx: [], covesPx: [],
            tracksPx: [], lightsPx: [{ id: 'L1', x: 200, y: 150, fixture: 'small' }],
            gridLightsPx: [], stats: {} },
  }];
  const layers = { ...LAYER_DEFAULTS, lights: true, region: true, autoLights: true };
  const canvasProps = {
    src: null, width: 400, height: 300, plans, pxPerFt: 40, zoom: 1,
    layers, measure: null, manualCobs: [], taskSpots: [], accents: [],
    heatmapLayer: sentinel, heatmapOn: true,
  };
  const markup = renderToStaticMarkup(React.createElement(PlanCanvas, canvasProps));
  const iField = markup.indexOf('HEATMAP-HERE');
  /* THE REGION OUTLINE AND NOT JUST ITS POINTS. The same point list appears in
     the canvas's own clipPath, which lives in `defs` at the very top of the
     document — so a bare search for the polygon finds the clip and proves
     nothing. The STROKED one is the outline. */
  const iOutline = markup.search(
    /<polygon points="0,0 400,0 400,300 0,300" fill="none" stroke/);
  const iFitting = markup.indexOf('cx="200"');
  ok('the field is in the drawing at all', iField > 0);
  ok('...the room outline and a fitting are both drawn', iOutline > 0 && iFitting > 0);
  ok('...and the field is painted BEFORE the room outline, so the outline reads over it',
    iOutline > iField, `${iField} / ${iOutline}`);
  ok('...and before the fittings, so the symbols read over it',
    iFitting > iField, `${iField} / ${iFitting}`);

  // THE POOLS STAND DOWN. Same canvas, heatmap off, and the throw gradient is
  // back — which is what makes the suppression a real behaviour rather than a
  // prop nothing reads.
  const off = renderToStaticMarkup(React.createElement(
    PlanCanvas, { ...canvasProps, heatmapOn: false,
                  layers: { ...layers, autoLights: true } }));
  const on = renderToStaticMarkup(React.createElement(
    PlanCanvas, { ...canvasProps, heatmapOn: true,
                  layers: { ...layers, autoLights: true } }));
  ok('the decorative throw pools are drawn when the heatmap is off',
    off.includes('url(#lp-throw)'));
  ok('...and are gone when it is on', !on.includes('url(#lp-throw)'));

  ok('the overlay draws nothing without a palette',
    renderToStaticMarkup(React.createElement(HeatmapOverlay,
      { heatmap: { on: true, rooms: [], palette: null } })) === '');
  ok('the switch is the bar\'s own capsule and says ON or OFF',
    (() => {
      const m = renderToStaticMarkup(React.createElement(HeatmapSwitch, { on: true }));
      return m.includes('Heatmap') && m.includes('role="switch"')
        && m.includes('aria-checked="true"') && m.includes('>ON<');
    })());
  ok('the legend draws nothing with the layer off',
    renderToStaticMarkup(React.createElement(HeatmapLegend,
      { heatmap: { on: false, rooms: [] }, stage: null })) === '');

  /* THE OVERLAY, WITH A CANVAS TO PAINT INTO. A twenty-line stand-in for the
     three DOM calls `fieldImage` makes, which is what lets the paint path — the
     bleed, the colour lookup, the clip and the pointer rule — be asserted
     without a browser or a new dependency. */
  const painted = [];
  globalThis.document = {
    documentElement: {},
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        createImageData: (w, hh) => ({ data: new Uint8ClampedArray(w * hh * 4), width: w, height: hh }),
        putImageData: (img) => painted.push(img),
      }),
      toDataURL: () => 'data:image/png;base64,STUB',
    }),
  };
  try {
    const palette = HEATMAP_BANDS.map((b, i) => ({ at: b.anchor, rgb: [i * 40, 60, 120], id: b.id }));
    const nx = 4, ny = 3;
    const ratio = new Float32Array(nx * ny).fill(NaN);
    const inside = new Uint8Array(nx * ny);
    // A 2 x 2 island of live cells, so the bleed has somewhere to bleed to.
    for (const k of [1, 2, 5, 6]) { ratio[k] = 1; inside[k] = 1; }
    const room = { id: 'R1', nx, ny, ratio, inside, polygonPx: roomPoly,
                   boxPx: { x0: 0, y0: 0, x1: 400, y1: 300 } };
    /* WRAPPED IN AN <svg>, WHICH IS NOT DECORATION. React tracks the namespace
       it is rendering in, and `clipPath` is an SVG element that does not exist
       in HTML — rendered as a root it warns about its own casing. In the app it
       is always a child of the drawing's <svg>; the test has to be too. */
    const paint = (props) => renderToStaticMarkup(React.createElement('svg', null,
      React.createElement(HeatmapOverlay, props)));
    const m = paint({ heatmap: { on: true, rooms: [room], palette } });
    ok('the overlay paints one image per room, clipped to its own outline',
      m.includes('<image') && m.includes('clip-path="url(#heatclip-R1)"')
      && m.includes('preserveAspectRatio="none"'));
    ok('...and it takes no pointer, so selection and panning reach through it',
      /<g pointer-events="none"/.test(m));
    ok('...at the paper opacity on a paper ground',
      m.includes(`opacity="${HEATMAP_OPACITY}"`));
    // AND IT IS VISIBLE ON THE NIGHT SHEET, which one figure for both grounds
    // could not manage — see the note on `heatmapOpacity`.
    const mn = paint({ heatmap: { on: true, rooms: [room], palette }, night: true });
    ok('...and at the higher one on the night sheet',
      mn.includes(`opacity="${HEATMAP_OPACITY_NIGHT}"`)
      && !mn.includes(`opacity="${HEATMAP_OPACITY}"`));
    ok('...with the very same five colours, because the scale is not a mark',
      (() => {
        const rgba = (s2) => s2.match(/<image[^>]*/)[0];
        // The image itself is identical: the field, the box and the bitmap do
        // not depend on the ground, only the alpha it is composited at.
        return rgba(m).replace(String(HEATMAP_OPACITY), '') === rgba(mn).replace(String(HEATMAP_OPACITY_NIGHT), '');
      })());
    ok('...and onto the box the field was sampled over',
      m.includes('width="400"') && m.includes('height="300"'));
    ok('the field really was written into a bitmap', painted.length > 0
      && painted[0].width === nx && painted[0].height === ny,
      `${painted.length} paints`);
    // THE BLEED: the live island's colour is pushed out past the outline, so a
    // smooth scale has something to blend with other than transparency.
    const alpha = [];
    for (let k = 0; k < nx * ny; k++) alpha.push(painted[0].data[k * 4 + 3]);
    ok('...with colour bled past the live cells for the smooth scale to use',
      alpha.filter((a) => a > 0).length > 4, alpha.join(','));

    /* AND THE HOOK, END TO END. `useEffect` does not run in a server render, so
       the palette stays null and the mode stays coarse — which is all this
       needs: what is under test is that the field comes out as LUX OVER TARGET
       with nothing normalised to the room. */
    let got = null;
    const Probe = () => {
      got = useHeatmap({
        on: true, rooms: plans, pxPerFt: 40, projectId: 'residential',
        roomTypes: { R1: { type: 'living_space' } }, materials: {},
        ceilingMmFor: () => 2700,
        spaceAnalysis: () => ({ rows: [
          { key: 'cob', familyId: 'cob', count: 1, metres: null, totalOutput: 525 }] }),
        focusId: 'R1',
      });
      return null;
    };
    renderToStaticMarkup(React.createElement(Probe));
    ok('the hook returns a field for the room', got?.on && got.rooms.length === 1);
    const f = got.rooms[0];
    ok('...carrying the space\'s own target', f.targetLux
      === heatmapTargetFor('residential', 'living_space'));
    ok('...and the ratio is lux over that target, cell by cell', (() => {
      for (let k = 0; k < f.ratio.length; k++) {
        if (Number.isNaN(f.ratio[k])) { if (!Number.isNaN(f.lux[k])) return false; continue; }
        if (!near(f.ratio[k], f.lux[k] / f.targetLux, 1e-6)) return false;
      }
      return true;
    })());
    ok('...with nothing outside the outline given a value',
      f.ratio.some((v) => Number.isNaN(v)) && f.ratio.some((v) => !Number.isNaN(v)));
    /* THE BOX IS THE GRID'S OWN EXTENT AND NOT THE ROOM'S BOUNDING BOX, which
       is worth asserting rather than assuming: the grid is grown out to WHOLE
       cells, so it overhangs the outline by up to one cell on each far edge.
       That is what the clip path is for, and an overlay drawn to the bbox
       instead would put the field a cell out of register with the floor. */
    const cellPx = f.stepM / (M_PER_FT / 40);
    ok('...and a box in PLAN PIXELS that covers the room and overhangs by at most a cell',
      f.boxPx.x0 === 0 && f.boxPx.y0 === 0
      && f.boxPx.x1 >= 400 && f.boxPx.x1 < 400 + cellPx
      && f.boxPx.y1 >= 300 && f.boxPx.y1 < 300 + cellPx,
      `${JSON.stringify(f.boxPx)} cell=${cellPx.toFixed(1)}px`);
    /* --- A HAND-PLACED LED STRIP, THROUGH THE HOOK, END TO END -----------
       THE WHOLE CHAIN AND NOT THE ADAPTER ON ITS OWN, because this was reported
       as making no difference and the adapter alone could not have told me
       whether it did. `projectAccentZonesPx` is what the palette's two clicks
       reach — a `type: 'strip'` zone with a `run`, a `runLength` in PIXELS and
       NO `kind` at all, which is what routes it to the `ceiling_strip` family
       rather than to a cove (see `fixtureGroups`). So the zone here is written
       exactly as App.jsx writes one, and what is asserted is that the field
       moves. */
    let withStrip = null, without = null;
    const stripZone = {
      id: 'man-abc', type: 'strip', roomId: 'R1', source: 'placed',
      label: 'LED strip',
      run: [{ x: 60, y: 150 }, { x: 340, y: 150 }], runLength: 280,
      rect: { x0: 60, y0: 150, x1: 340, y1: 150 },
    };
    const stripRow = {
      key: 'man-abc', familyId: 'ceiling_strip', count: 1,
      // 280 px at 40 px/ft is 7 ft, which is 2.13 m of tape at the family's
      // own 400 lm/m installed — see STRIP_LUMENS_PER_WATT and STRIP_LOSS.
      metres: 280 / 40 * M_PER_FT, totalOutput: 280 / 40 * M_PER_FT * 400,
    };
    const StripProbe = ({ zones, rows }) => {
      const r = useHeatmap({
        on: true, rooms: plans, pxPerFt: 40, projectId: 'residential',
        roomTypes: { R1: { type: 'living_space' } }, materials: {},
        ceilingMmFor: () => 2700,
        spaceAnalysis: () => ({ rows }),
        accentZonesPx: zones, focusId: 'R1',
      });
      if (zones.length) withStrip = r; else without = r;
      return null;
    };
    renderToStaticMarkup(React.createElement(StripProbe, { zones: [], rows: [] }));
    renderToStaticMarkup(React.createElement(StripProbe,
      { zones: [stripZone], rows: [stripRow] }));
    const dark = without.rooms[0], lit = withStrip.rooms[0];
    ok('an empty room reads as no light at all', dark.maxLux === 0);
    ok('a hand-placed LED strip lights the room',
      lit.maxLux > 0 && lit.meanLux > 0,
      `mean ${lit.meanLux.toFixed(1)} max ${lit.maxLux.toFixed(1)} lx`);
    ok('...by a share of the target big enough to change a band',
      lit.meanLux / lit.targetLux > 0.15,
      `${(100 * lit.meanLux / lit.targetLux).toFixed(0)}% of target`);
    ok('...and it is the ceiling-strip family, so its light goes DOWN', (() => {
      // A cove of the same run would reach the plane only through the ceiling.
      // This one is an exposed run: most of it arrives direct, which is the
      // whole distinction the `kind`-less zone is routed on.
      const g = buildRoomGeometry({
        polygonM: roomPoly.map((q) => ({ x: q.x * (M_PER_FT / 40), y: q.y * (M_PER_FT / 40) })),
        heightM: 2.7, materials: LIGHT });
      const asStrip = buildRoomEmitters({
        room: plans[0], analysis: { rows: [stripRow] },
        metresPerPx: M_PER_FT / 40, ceilingMm: 2700, accentZones: [stripZone] });
      const asCove = buildRoomEmitters({
        room: plans[0], analysis: { rows: [{ ...stripRow, familyId: 'cove' }] },
        metresPerPx: M_PER_FT / 40, ceilingMm: 2700,
        accentZones: [{ ...stripZone, kind: 'cove' }] });
      const a = solveRoom(g, asStrip), b = solveRoom(g, asCove);
      return asStrip[0].profileId === 'ceiling_strip'
        && asCove[0].profileId === 'cove'
        && a.emitted === b.emitted
        && solveRoom(g, asStrip).direct.some((v) => v > 0)
        && b.direct.every((v) => v === 0)
        && a.mean > b.mean;
    })());
    ok('...and taking it away puts the room back exactly as it was',
      dark.meanLux === 0);

    ok('a moving hand gets the coarse pass', got.mode === 'coarse');
    ok('...and the switch off costs nothing at all', (() => {
      let idle = null;
      const Off = () => { idle = useHeatmap({ on: false, rooms: plans, pxPerFt: 40 }); return null; };
      renderToStaticMarkup(React.createElement(Off));
      return idle && idle.on === false && idle.rooms.length === 0;
    })());
  } finally {
    delete globalThis.document;
    await vite.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
