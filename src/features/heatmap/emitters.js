// ---------------------------------------------------------------------------
// emitters.js — THE ADAPTER. Everything this app already knows, turned into
// sources the solver can integrate.
//
// NOTHING IS INVENTED HERE AND NOTHING IS RE-DERIVED. Every figure comes from a
// list the drawing is already made from, and where two lists could answer the
// same question, the one that OWNS it answers:
//
//   HOW MANY LUMENS -> lib/lumens.js, through `analyseSpace`'s rows.
//        The row a fitting belongs to carries `totalOutput` — watts times the
//        family's lumens-per-watt, less the family's own loss — and dividing by
//        the row's quantity gives the fitting. That model is the one a designer
//        actually drives: the wattage chips in the Analysis panel write into
//        `fixtureWatts`, the country decides what a watt buys, and a
//        hand-placed lamp carries its own figure. Deriving lumens here would be
//        a second opinion about a number the panel is printing beside the
//        drawing.
//
//        WHAT IT IS NOT IS `netLumens`. That figure has `bounceOf` applied — the
//        lumen model's one-coefficient stand-in for reflection — and this
//        feature computes the reflections explicitly. Using both would count
//        the same bounced light twice, which the brief forbids and which would
//        be wrong anyway.
//
//        AND IT IS NOT `FIXTURE_BY_ID[...].lumens` EITHER, which is the BOQ
//        catalogue's own figure and disagrees with the lumen model — the
//        catalogue calls the ambient downlight 900 lm and the lumen model makes
//        a 7 W lamp at 75 lm/W worth 525. THAT DISAGREEMENT IS PRE-EXISTING and
//        is not this feature's to settle: `planTotals` reads the catalogue and
//        the Analysis panel reads the model, and they have differed since both
//        were written. What matters here is that ONE of them is chosen and
//        stated, and it is the model, because the model is the one that answers
//        for every family, responds to the wattage somebody set, and applies the
//        strip loss.
//
//   WHICH OPTIC -> the fitting itself. A beam angle is a reflector, it lives on
//        the lamp, and the row does not always carry one — the grid's `cob` row
//        has no beam because twelve lamps in a grid are one decision about
//        wattage and not about optics. So the beam is read off the fitting
//        (`c.beam`, `q.beam`, `FIXTURE_BY_ID[l.fixture].beam`) and the lumens
//        off the row, each from the thing that owns it.
//
//   WHERE IT IS -> the projected lists the canvas draws, in PLAN PIXELS,
//        converted to metres exactly once by `metresPerPx`.
//
//   HOW HIGH IT IS -> the space's own `ceilingMm` for anything at the slab, and
//        a documented family default for everything else. The app records no
//        fixture heights; see profiles.js, where every one of those defaults is
//        a named constant.
//
//   WHICH WAY IT FACES -> the geometry. A sconce's `inward` comes off the accent
//        placer, which already worked out which side of its wall is the room; a
//        linear run's wall is derived from the outline by stepping off the run
//        and asking which side is inside. Nothing here needs a new field.
//
// PURE. Plain lists in, plain sources out. No React, no canvas, no document.
// ---------------------------------------------------------------------------

import { pointInPolygon } from '../../lib/geometry.js';
import { FIXTURE_BY_ID } from '../../lib/boq.js';
import { MODULE_BY_ID, moduleLenFt } from '../../lib/magTrack.js';
import { M_PER_FT } from './grid.js';
import { profileFor, PROFILE_FOR_FAMILY, DISTRIBUTION_PROFILES,
         ART_AIM_MM } from './profiles.js';

/**
 * THE ROWS OF ONE SPACE'S ANALYSIS, INDEXED BY WHAT IDENTIFIES A FITTING.
 *
 * ROW KEYS ARE NOT FITTING IDS AND THE MAPPING IS THE FEATURE'S TO KNOW — see
 * `fixtureGroups` in features/lighting-planner/lightingRules.js, which decides
 * it. A hand-placed COB, an array, a track module and a length of tape are each
 * their own row and their key IS their id; the ambient grid is one row keyed
 * 'cob' for however many lamps it holds; the spots are keyed by catalogue line
 * and the sconces share one row. So a lookup by id, falling back to a lookup by
 * the shared key, answers for all of them.
 *
 * `perUnit` IS THE FITTING'S OWN OUTPUT: the row's total over its quantity,
 * which is metres for anything sold by the metre and a count for anything sold
 * by the piece. That division is the only arithmetic in this file.
 */
export function indexAnalysisRows(analysis) {
  const by = new Map();
  for (const row of analysis?.rows ?? []) {
    const qty = row.metres != null ? row.metres : row.count;
    const perUnit = qty > 0 ? row.totalOutput / qty : 0;
    by.set(row.key, { ...row, qty, perUnit });
  }
  return by;
}

/** Lumens for one piece of a counted row, or one metre of a linear one. Zero
 *  where the room has no such row, which is a fitting the lumen model is not
 *  counting — and a heatmap that lit it would be brighter than the schedule. */
const perUnitOf = (rows, ...keys) => {
  for (const k of keys) {
    const r = k != null ? rows.get(k) : null;
    if (r && r.perUnit > 0) return r.perUnit;
  }
  return 0;
};

/**
 * WHICH SIDE OF A LINEAR RUN IS THE ROOM.
 *
 * A REVERSE COVE AND A SHELF STRIP BOTH THROW AT THE WALL THEY ARE ON, so both
 * need to know which way that is, and neither carries the answer: the reverse
 * cove records the wall it came off as a grid segment and the shelf strip
 * records a rectangle. What they both have is a run, and a run against a wall
 * has exactly one normal pointing into the room — which is a question the
 * outline can answer.
 *
 * THE SAME TEST `placeZone` USES, and deliberately so: step off the run by a
 * hair along each candidate normal and see which one lands inside. It is robust
 * to the polygon's winding, which nothing upstream guarantees.
 *
 * `null` FOR A RUN THAT IS NOT AGAINST ANYTHING — one drawn across the middle
 * of a ceiling, or one whose geometry is degenerate. A profile asked for a wall
 * direction it has not got falls back to straight down; see `axisOf` in
 * photometry.js, and the note there about why a guessed wall is worse than no
 * wall.
 */
export function inwardOfRun(a, b, polygonM) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (!(L > 1e-6) || !polygonM || polygonM.length < 3) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const n = { x: -dy / L, y: dx / L };
  const eps = Math.max(0.01, L * 0.02);
  const inA = pointInPolygon({ x: mid.x + n.x * eps, y: mid.y + n.y * eps }, polygonM);
  const inB = pointInPolygon({ x: mid.x - n.x * eps, y: mid.y - n.y * eps }, polygonM);
  // BOTH SIDES INSIDE MEANS IT IS NOT ON A WALL, and neither inside means the
  // run is not in this room at all. Either way there is no wall to face.
  if (inA === inB) return null;
  return inA ? n : { x: -n.x, y: -n.y };
}

/** A closed or open run of points, in metres, as the list of segments a line
 *  source is made of. A `loop` closes; a `run` does not. */
const legsOf = (pts, closed) => {
  const out = [];
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
  return out;
};

/**
 * EVERY EMITTER IN ONE ROOM.
 *
 * THE INVENTORY IS `fixtureGroups`' INVENTORY, FITTING BY FITTING. That function
 * decides what is on a ceiling for the purposes of the lumen model, and this
 * walks the same eight populations in the same order so that the heatmap and the
 * Analysis panel are talking about the same room. Anything it counts and this
 * misses would be light in the schedule and not on the drawing; anything this
 * adds that it does not count would be the reverse.
 *
 * Coordinates arrive in PLAN PIXELS and leave in METRES.
 */
export function buildRoomEmitters({
  room, analysis, metresPerPx, ceilingMm,
  accentZones = [], taskSpots = [], manualCobs = [], arrayCobs = [],
  magTracks = [], trackModules = [],
}) {
  const rows = indexAnalysisRows(analysis);
  const h = (Number(ceilingMm) || 0) / 1000;
  if (!(h > 0) || !(metresPerPx > 0)) return [];
  const M = metresPerPx;
  const toM = (p) => ({ x: p.x * M, y: p.y * M });
  const polyM = (room.geo?.polygonPx ?? []).map(toM);
  const out = [];
  let seq = 0;
  /* --- A SOURCE WITH NO POSITION IS DROPPED, NOT PLACED AT THE ORIGIN ------
     THIS EXISTS BECAUSE THE ADAPTER WAS ONCE HANDED THE WRONG LIST. Every
     population here arrives in PLAN PIXELS, resolved out of a store held in
     FEET — `manualCobsPx` has `x`/`y`, `manualCobs` has `xFt`/`yFt` and no
     `x` at all — and reading the store put every hand-placed lamp at NaN. A NaN
     source throws nothing: it fails every comparison in the solver, delivers no
     light anywhere, and shows up as a fitting somebody placed that the heatmap
     simply does not know about. Silent, and reported as the tool not working.
     SO THE GUARD IS HERE RATHER THAN AT THE CALL SITE. The call site can be got
     wrong again; this cannot be got round, and tools/test-heatmap.mjs asserts
     that a feet-only fitting produces no emitter rather than a broken one. */
  const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && Number.isFinite(p.z);
  const placed = (g) => (g.kind === 'point' ? finite(g.p)
    : g.kind === 'line' ? finite(g.a) && finite(g.b)
    : g.kind === 'ring' ? finite(g.c) && Number.isFinite(g.r)
    : g.kind === 'area' ? finite(g.c) : false);
  const push = (src) => {
    if (!placed(src.geom) || !(src.lm > 0)) return;
    out.push({ id: `hm-${seq++}`, ...src });
  };

  /** A point fitting at the slab. */
  const atCeiling = (p) => ({ ...toM(p), z: h });

  /** A profile's own mounting height, in metres above the floor, clamped into
   *  the room. A 1800 mm sconce in a 1500 mm ceiling is a data fault, not a
   *  sconce in the slab. */
  const mountZ = (profile) => {
    const mm = profile.heightMm ?? null;
    if (mm != null) return Math.min(h * 0.95, mm / 1000);
    const drop = (profile.dropMm ?? 0) / 1000;
    return Math.max(h * 0.05, h - drop);
  };

  /* --- 1. THE AMBIENT GRID -------------------------------------------------
     `plan.lightsPx` IS EMPTY WHEN THE ENGINE'S GRID IS OFF and that is the
     right behaviour rather than a thing to work around: `layers.autoLights`
     reaches the layout itself (see AUTO_GRID in lib/layout.js), so a space with
     the suggestion switched off has no placed fittings — and a heatmap of
     fittings nobody has placed would be a claim about a ceiling that is still
     empty. The suggestion layer draws them dotted for exactly that reason.
     THE OPTIC COMES OFF THE CATALOGUE LINE and the lumens off the row: a 7 W
     36-degree lamp in a living space, a 5 W 30-degree one in a wet room, a 12 W
     60-degree one over a pair of cells. See FIXTURES in lib/boq.js. */
  const gridLm = perUnitOf(rows, 'cob');
  if (gridLm > 0) {
    for (const l of room.plan?.lightsPx ?? []) {
      if (!Number.isFinite(l?.x) || !Number.isFinite(l?.y)) continue;
      push({ profileId: 'cob', lm: gridLm,
             beamDeg: FIXTURE_BY_ID[l.fixture]?.beam ?? null,
             geom: { kind: 'point', p: atCeiling(l) } });
    }
  }

  /* --- 2. THE AIMED SPOTS --------------------------------------------------
     A DIRECTIONAL SPOT IS THE ONE FITTING THAT DOES NOT LIGHT THE FLOOR UNDER
     ITSELF, which is the whole reason it has an arrow on the drawing. It stands
     off and lights something else, so its lobe is aimed at the point the placer
     already worked out — `target`, the same point the arrow is drawn towards.
     AN ART SPOT AIMS AT A WALL AND A TASK SPOT AT THE PLANE. `target` is a plan
     position in both cases and says nothing about height; a picture hangs at
     ART_AIM_MM and a worktop is at the plane, so the aim's third component comes
     from the profile. See profiles.js.
     A REFUSED SPOT HAS NO POSITION. The placer answers for every surface it was
     asked about, including the ones it turned down, and those carry a reason and
     no geometry — see `projectTaskSpotsPx`. */
  for (const sp of taskSpots) {
    if (sp.roomId !== room.id || sp.rejected || sp.x == null) continue;
    const art = sp.fixture === 'art-spot';
    const lm = perUnitOf(rows, art ? 'art-spot' : 'spot');
    if (!(lm > 0)) continue;
    const profileId = art ? 'art_spot' : 'spot';
    const p = atCeiling(sp);
    const t = sp.target ? toM(sp.target) : { x: p.x, y: p.y };
    const aimZ = art ? Math.min(h * 0.9, ART_AIM_MM / 1000) : 0;
    const dx = t.x - p.x, dy = t.y - p.y, dz = aimZ - p.z;
    const d = Math.hypot(dx, dy, dz);
    push({ profileId, lm,
           beamDeg: FIXTURE_BY_ID[sp.fixture]?.beam ?? null,
           geom: { kind: 'point', p },
           aim: d > 1e-6 ? { x: dx / d, y: dy / d, z: dz / d }
                         : { x: 0, y: 0, z: -1 } });
  }

  /* --- 3. THE COBs A HAND PUT DOWN, AND 4. THE ARRAYS ---------------------
     EACH CARRIES ITS OWN WATTAGE AND OPTIC, which is why each is its own row —
     see the note on `manualCobs` in lightingRules.js. So the lumens come from
     the row keyed by the fitting's own id, and an array's row is keyed by the
     ARRAY: twelve lamps on one ring are one decision at one wattage, and the
     row's `perUnit` is already that decision divided by twelve. */
  for (const c of manualCobs) {
    if (c.roomId !== room.id) continue;
    const lm = perUnitOf(rows, c.id);
    if (!(lm > 0)) continue;
    push({ profileId: 'cob', lm, beamDeg: c.beam ?? null,
           geom: { kind: 'point', p: atCeiling(c) } });
  }
  for (const c of arrayCobs) {
    if (c.roomId !== room.id) continue;
    const lm = perUnitOf(rows, c.arrayId);
    if (!(lm > 0)) continue;
    push({ profileId: 'cob', lm, beamDeg: c.beam ?? null,
           geom: { kind: 'point', p: atCeiling(c) } });
  }

  /* --- 5. THE MODULES ON A MAGNETIC TRACK --------------------------------
     A DIFFUSER IS A BODY LYING ALONG THE RUN AND A SPOT IS A POINT ON IT, and
     the difference is the difference between the two products: a diffuser is a
     600 mm lens whose length grows with its wattage (see DIFFUSER_LENGTHS_MM),
     so it is a LINE source set out along the profile's own direction at the
     module's own position — which `ux, uy` already carry, because the drawing
     needs them to lay the body along the run rather than across it.
     THE WASHER PASSES THROUGH AND LIGHTS NOTHING. Its family is null in
     lib/magTrack.js, so no row exists for it, so `perUnitOf` answers zero —
     which is the same silence the schedule keeps about it. The profile is
     written and waiting; see `wall_washer` in profiles.js. */
  const trackIds = new Set(magTracks.filter((t) => t.roomId === room.id).map((t) => t.id));
  for (const q of trackModules) {
    if (!trackIds.has(q.on)) continue;
    const m = MODULE_BY_ID[q.kind];
    const familyId = m?.family ?? null;
    if (!familyId) continue;
    const lm = perUnitOf(rows, q.id);
    if (!(lm > 0)) continue;
    const profileId = PROFILE_FOR_FAMILY[familyId];
    const profile = profileFor(profileId);
    if (!profile) continue;
    const p = atCeiling(q);
    if (profile.shape === 'line') {
      const lenM = moduleLenFt(q.kind, q.watts) * M_PER_FT;
      const ux = Number.isFinite(q.ux) ? q.ux : 1, uy = Number.isFinite(q.uy) ? q.uy : 0;
      const uL = Math.hypot(ux, uy) || 1;
      const hx = (ux / uL) * (lenM / 2), hy = (uy / uL) * (lenM / 2);
      push({ profileId, lm, beamDeg: q.beam ?? null,
             geom: { kind: 'line',
                     a: { x: p.x - hx, y: p.y - hy, z: p.z },
                     b: { x: p.x + hx, y: p.y + hy, z: p.z } } });
    } else {
      push({ profileId, lm, beamDeg: q.beam ?? null,
             geom: { kind: 'point', p } });
    }
  }

  /* --- 6. EVERY RUN OF TAPE, AND 7. THE SCONCES --------------------------
     ONE LIST, FOUR FAMILIES, ROUTED BY `kind` — which is exactly how
     `fixtureGroups` routes them into the lumen model, and it is routing by
     INSTALLATION rather than by product name. A cove is concealed and throws at
     the slab; a reverse cove is a slot washing the wall beside it; a shelf strip
     is in joinery; anything else is an exposed run on the ceiling. All four are
     the same tape on a reel, and that is precisely why the name cannot decide
     the distribution.

     THE LUMENS ARE PER METRE and the row is keyed by the run's own id, because
     a length of tape is a thing you point at and specify on its own. Each leg of
     a polygonal run becomes its own line source carrying its share by LENGTH —
     which is what "allocate output by length" means, and it is what makes an
     L-shaped cove brighter over its long arm than a straight one of half the
     total. */
  for (const z of accentZones) {
    if (z.roomId !== room.id || z.rejected) continue;

    if (z.type === 'sconce') {
      const lm = perUnitOf(rows, 'sconce');
      if (!(lm > 0)) continue;
      const at = z.point ?? { x: (z.rect?.x0 + z.rect?.x1) / 2, y: (z.rect?.y0 + z.rect?.y1) / 2 };
      if (!Number.isFinite(at?.x) || !Number.isFinite(at?.y)) continue;
      const profile = DISTRIBUTION_PROFILES.sconce;
      /* THE PLACER ALREADY KNOWS WHICH WAY IS INTO THE ROOM — see `inward` in
         `placeZone`, which tests it the same way rather than trusting the
         polygon's winding. It is a unit vector in plan pixels, which is a unit
         vector in metres too: scaling both axes by the same factor does not turn
         a direction. */
      const inward = Number.isFinite(z.inward?.x) ? { x: z.inward.x, y: z.inward.y } : null;
      push({ profileId: 'sconce', lm, inward,
             geom: { kind: 'point', p: { ...toM(at), z: mountZ(profile) } } });
      continue;
    }
    if (z.type !== 'strip') continue;

    const familyId = z.kind === 'cove' ? 'cove'
      : z.kind === 'reverse-cove' ? 'reverse_cove'
      : z.kind === 'shelf' ? 'shelf_strip'
      : 'ceiling_strip';
    const perM = perUnitOf(rows, z.id);
    if (!(perM > 0)) continue;
    const profileId = PROFILE_FOR_FAMILY[familyId];
    const profile = profileFor(profileId);
    if (!profile) continue;
    const z0 = mountZ(profile);

    const ptsPx = z.loop ?? z.run ?? null;
    if (!ptsPx || ptsPx.length < 2) continue;
    const pts = ptsPx.map(toM);
    // `loop` CLOSES AND `run` DOES NOT, and `open` is the third case: a slot
    // drawn from wall to wall arrives as a `loop` that must not be closed, or
    // an L-shaped run would carry a spurious leg back across the room. Same
    // flag the canvas reads — see `projectAccentZonesPx`.
    const closed = !!z.loop && !z.open && pts.length > 2;
    for (const [a, b] of legsOf(pts, closed)) {
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(L > 1e-4)) continue;
      const inward = inwardOfRun(a, b, polyM);
      push({ profileId, lm: perM * L, inward,
             geom: { kind: 'line', a: { ...a, z: z0 }, b: { ...b, z: z0 } } });
    }
  }

  /* --- 8. THE CHANDELIERS ------------------------------------------------
     COUNTED AS `lamp` BY THE LUMEN MODEL, which is what routes a pendant into
     the one family whose split describes something throwing in every direction —
     see `fixtureGroups`. So the lumens come from the 'lamp' row and the
     DISTRIBUTION comes from the chandelier profile rather than the floor lamp's,
     because a pendant hangs and a floor lamp stands. This is the case
     profiles.js's header calls "the caller knows better than the family".
     A RING AND NOT A POINT. The object records a diameter and no element
     positions, so the documented broad-source approximation is a ring of bare
     lamps at the object's own radius — see `chandelier` in profiles.js for why
     a metre-wide fitting collapsed to its centre reads as a spotlight. */
  /* `objectsInRoom` AND NOT `fansInRoom`, WHICH IS WHAT LETS THE STANDING LAMP
     INTO THIS SECTION AT ALL. The obstacle list has the off-ceiling objects
     filtered out of it, so a lamp standing on the floor was never in it and this
     pass could not have found one — see `objectsInRoom` in lib/layout.js.
     Falling back to the obstacles keeps a room laid out by a caller that hands
     in only that list lighting its pendants as before. */
  const objects = room.geo?.objectsInRoom ?? room.geo?.fansInRoom ?? [];
  const pendants = objects.filter((f) => f.kind === 'chandelier');
  if (pendants.length) {
    const lm = perUnitOf(rows, 'lamp');
    const profile = DISTRIBUTION_PROFILES.chandelier;
    if (lm > 0) {
      for (const f of pendants) {
        if (!Number.isFinite(f?.x) || !Number.isFinite(f?.y)) continue;
        const c = toM(f);
        push({ profileId: 'chandelier', lm,
               geom: { kind: 'ring', c: { ...c, z: mountZ(profile) },
                       r: Math.max(0.05, (f.r ?? 0) * M), n: profile.elements } });
      }
    }
  }

  /* --- 9. THE STANDING LAMPS ---------------------------------------------
     THE SAME ACCOUNTING ROW AND A DIFFERENT DISTRIBUTION, which is the split
     profiles.js's header describes and the reason that table is keyed by profile
     rather than by family. A standard lamp is counted as `lamp` like a pendant
     is — one family, one split, one row in the schedule — and it throws from
     somewhere else entirely: 1500mm off the FLOOR rather than 600mm under the
     slab. `floor_lamp` is the entry that says so, and it has been in that table
     since it was written with nothing placing it.
     A POINT AND NOT A RING. The chandelier above is a ring because a metre-wide
     fitting collapsed to its centre reads as a spotlight; a 450mm shade at
     1500mm is small next to the distances that matter and its own radius is
     inside the solver's own sampling, so the honest approximation is the point
     the profile already asks for.
     ITS HEIGHT COMES OFF THE PROFILE, through `mountZ`, which reads `heightMm`
     for a mount measured from the floor and `dropMm` for one measured down from
     the slab. Nothing here knows which — that is the whole of what the profile
     is for. See LAMP_MM in profiles.js. */
  const standing = objects.filter((f) => f.kind === 'standing_lamp');
  if (standing.length) {
    const lm = perUnitOf(rows, 'lamp');
    const profile = DISTRIBUTION_PROFILES.floor_lamp;
    if (lm > 0) {
      for (const f of standing) {
        if (!Number.isFinite(f?.x) || !Number.isFinite(f?.y)) continue;
        const c = toM(f);
        push({ profileId: 'floor_lamp', lm,
               geom: { kind: 'point', p: { ...c, z: mountZ(profile) } } });
      }
    }
  }

  return out;
}

/** The room's outline in metres — the one conversion every caller of the solver
 *  needs and the one place it is written, so a heatmap cannot be computed on a
 *  polygon the overlay is not drawn against. */
export const polygonInMetres = (room, metresPerPx) =>
  (room?.geo?.polygonPx ?? []).map((p) => ({ x: p.x * metresPerPx, y: p.y * metresPerPx }));
