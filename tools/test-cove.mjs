// ---------------------------------------------------------------------------
// test-cove.mjs — the cove ceiling, end to end.
//
// Five claims, and every assertion below belongs to one of them:
//
//   1. THE INSET IS THE TABLE. Not a ratio, not an interpolation — the five
//      steps, with the boundary cases pinned, because a boundary that drifts
//      changes a real band on a real ceiling.
//   2. THE COVE LINE CUTS THE GRID. The chunk it is drawn in becomes an inner
//      rectangle plus four pieces of band, they tile that chunk exactly, and no
//      cell straddles the line.
//   3. NOTHING CROWDS THE LINE. Two feet clear inside, one foot outside, for
//      every fitting the planner places — including after the alignment pass,
//      which is the one that used to be able to undo a placement rule.
//   4. THE LADDER STOPS AT THE FIRST RUNG THAT MEETS THE BRIEF, and a space it
//      cannot meet is reported rather than quietly under-lit.
//   5. A DARK CELL IS NOT AN UNSERVED ONE. The band outside a cove is laid out
//      and deliberately unlit, and that must not show up as a fault.
//
//   node tools/test-cove.mjs
// ---------------------------------------------------------------------------

import { coveOffsetFor, coveGeometry, bandFixtureFor, COVE_TOLERANCE,
         NARROW_BAND_FT, STRIP_OFFSET_FT, OFFSET_STEPS,
         OFFSET_MAX } from '../src/lib/cove.js';
// WHERE A COVE IS NOW DECIDED. cove.js is the detail; the choosing and the
// ladder live in ceilingDesign.js, so a test about what a cove DOES has to go
// through it. See tools/test-ceiling-design.mjs for the choosing itself.
import { planCeilingDesign, chunkKey, designChunking,
         optionsForChunk } from '../src/lib/ceilingDesign.js';
import { COVE_LUMENS_PER_FT } from '../src/lib/planner.js';
import { PLAN_OPTIONS, lumenCriteriaFor } from '../src/lib/settings.js';
import { planTaskSpots, rectDistance, SPOT_DEFAULTS } from '../src/lib/taskSpots.js';
import { FIXTURE_BY_ID } from '../src/lib/boq.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const say = (t) => console.log('\n' + t);

const box = (w, h) => ({
  polygonFt: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
  chunks: [{ x0: 0, y0: 0, x1: w, y1: h, w, h, area: w * h,
             key: chunkKey({ x0: 0, y0: 0, x1: w, y1: h }) }],
});

/**
 * ONE SPACE, ONE CHUNK, COVED. The room is a rectangle so its own outline gives
 * exactly one design chunk, which is the case every claim below is about: what a
 * cove does to the layout underneath it. `r.cove` is that chunk's report.
 */
const coved = (w, h, criteria, { zonesFt = [] } = {}) => {
  const b = box(w, h);
  const out = planCeilingDesign({
    polygonFt: b.polygonFt, zonesFt, designChunks: b.chunks,
    picks: { [b.chunks[0].key]: 'cove' },
    opt: PLAN_OPTIONS, criteria });
  return { plan: out.plan, cove: out.coves[0], parts: out.parts };
};

// --- 1. the inset table ----------------------------------------------------
say('1. THE INSET IS THE TABLE');
// READ FROM THE TABLE, NOT PINNED TO IT. OFFSET_STEPS is a joinery figure and
// gets tuned — the 12 ft band became 15 ft the first week it was in use — so
// hard-coding its numbers here would mean every tuning arrives as a test
// failure, which trains people to edit the test. What must NOT change is the
// SHAPE of the rule, and that is what these check: the first band is open at
// its top, every band after it closes on its figure, and the inset never falls
// as the room grows.
{
  const E = 1e-6;
  const first = OFFSET_STEPS[0];
  ok(first.under != null, 'the first band is the open one — "less than N feet"');
  ok(coveOffsetFor(first.under - E) === first.offset
     && coveOffsetFor(first.under) !== first.offset,
    `under ${first.under} ft -> ${first.offset} ft, and ${first.under} itself is already the next band`);

  for (const step of OFFSET_STEPS.slice(1)) {
    const next = OFFSET_STEPS[OFFSET_STEPS.indexOf(step) + 1];
    const after = next ? next.offset : OFFSET_MAX;
    ok(coveOffsetFor(step.upTo) === step.offset,
      `up to and including ${step.upTo} ft -> ${step.offset} ft`);
    ok(coveOffsetFor(step.upTo + E) === after,
      `...and a hair over ${step.upTo} ft is already ${after} ft`);
  }
  const last = OFFSET_STEPS[OFFSET_STEPS.length - 1];
  ok(coveOffsetFor(last.upTo + 1) === OFFSET_MAX && coveOffsetFor(500) === OFFSET_MAX,
    `over ${last.upTo} ft -> ${OFFSET_MAX} ft, and it stops there however big the room`);

  let mono = true;
  for (let v = 1; v < 60; v += 0.25) if (coveOffsetFor(v + 0.25) < coveOffsetFor(v)) mono = false;
  ok(mono, 'the inset never shrinks as the room grows');
  ok(coveOffsetFor(14) === coveOffsetFor(14), 'the same room twice is the same band');
}

ok(bandFixtureFor(NARROW_BAND_FT - 0.01) === 'small-narrow'
   && bandFixtureFor(NARROW_BAND_FT) === 'small',
  `a band under ${NARROW_BAND_FT} ft takes the 5 W narrow lamp, ${NARROW_BAND_FT} and over the 7 W`);
ok(bandFixtureFor(2) === 'small-narrow' && bandFixtureFor(8) === 'small',
  'which means every 2/3/4 ft band is 5 W and every 6/8 ft band is 7 W');

// --- 2. the geometry -------------------------------------------------------
say('2. THE COVE LINE CUTS THE GRID');
{
  const g = coveGeometry({ x0: 0, y0: 0, x1: 20, y1: 14 });
  const K = coveOffsetFor(14), S = STRIP_OFFSET_FT;
  ok(g.offset === K, `a 20 x 14 rectangle takes its inset from the SHORTER side (14 -> ${K} ft)`);
  ok(g.line.x0 === K && g.line.y0 === K && g.line.x1 === 20 - K && g.line.y1 === 14 - K,
    'the line is that rectangle inset by that much on all four sides');
  ok(g.strip.x0 === K - S && g.strip.y0 === K - S
     && g.strip.x1 === 20 - K + S && g.strip.y1 === 14 - K + S,
    'the tape sits 3 in OUTSIDE that line, in the pocket, all the way round');
  ok(near(g.host.w, 20) && near(g.host.h, 14), 'the rectangle it was set out in travels with it');
  ok(STRIP_OFFSET_FT === 0.25, 'the tape offset is 3 in');
  ok(near(g.perimeterFt, 2 * (g.strip.w + g.strip.h)) && g.perimeterFt > 2 * (g.line.w + g.line.h),
    'the run billed is the tape\'s perimeter — longer than the line it hides behind');
  ok(g.band.length === 4, 'the band comes back as four rectangles the planner can take');

  // they tile the chunk exactly, and none of them overlaps another
  ok(g.strip.x0 > 0 && g.strip.y0 > 0 && g.strip.x1 < 20 && g.strip.y1 < 14,
    '...and still well inside the chunk, because the smallest inset is 2 ft');
  const area = g.band.reduce((s, b) => s + b.area, 0) + g.line.area;
  ok(near(area, 20 * 14, 1e-9), 'line + band = the whole chunk, to the square inch');
  const overlaps = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9
                          && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-9;
  const pieces = [g.line, ...g.band];
  let clash = false;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) if (overlaps(pieces[i], pieces[j])) clash = true;
  }
  ok(!clash, 'and no two pieces overlap — the corners belong to the horizontal runs');
}
ok(coveGeometry({ x0: 0, y0: 0, x1: 40, y1: 4 }) === null,
  'a chunk too narrow to inset gets NO cove rather than an inside-out one');

// --- 2b. which piece of ceiling it goes in ---------------------------------
say('2b. THE COVE GOES IN A CHUNK, AND THE CHUNKS COME FROM THE OUTLINE');
{
  // An L-shaped living-dining: 26 x 14 across the top, 18 x 7 hanging below the
  // right-hand end. TWO pieces of ceiling, and that is the whole point — under
  // the old reading the room got ONE cove in whichever rectangle was biggest,
  // and a person who wanted the other end, or both ends, had no way to say so.
  const L = [{ x: 0, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 21 },
             { x: 8, y: 21 }, { x: 8, y: 14 }, { x: 0, y: 14 }];
  const d = designChunking(L, [], PLAN_OPTIONS, []);
  ok(d.chunks.length === 2, `${d.chunks.length} chunks, each one a piece of ceiling to decide about`);
  ok(d.chunks.every((c) => optionsForChunk(c, PLAN_OPTIONS).some((o) => o.id === 'cove')),
    '...and a cove is offered in every one of them, not just the biggest');
  const area = d.chunks.reduce((t, c) => t + c.area, 0);
  ok(near(area, 26 * 14 + 18 * 7, 1e-6), '...and together they are the whole ceiling');

  // THE ONE THAT MATTERS: furniture must not move the chunks. A bed pushed into
  // the middle of the top bay is not a hole in the ceiling.
  const bed = [{ x0: 9, y0: 1, x1: 16, y1: 7 }];
  const withBed = designChunking(L, bed, PLAN_OPTIONS, []);
  ok(withBed.chunks.length > d.chunks.length,
    'treated as a hole, a bed DOES cut the ceiling up — which is why it must not be one');
  const asBuilt = designChunking(L, [], PLAN_OPTIONS, []);
  ok(asBuilt.chunks.length === d.chunks.length
     && asBuilt.chunks.every((c, i) => c.key === d.chunks[i].key),
    '...and set out on the room as built they are the same chunks, bed or no bed');
}
{
  // A hole in the CEILING is a different thing and must still count.
  const room = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }];
  const shaft = [{ x0: 12, y0: 0, x1: 18, y1: 20 }];
  const d = designChunking(room, shaft, PLAN_OPTIONS, []);
  ok(d.chunks.every((c) => c.x1 <= 12 + 1e-9 || c.x0 >= 18 - 1e-9),
    'no chunk crosses a shaft that goes all the way through the ceiling');
}
{
  // A CHUNK CAN BE TOO NARROW TO BE WORTH COVING even when the geometry would
  // technically close: two 2 ft bands in a 5 ft chunk leave a one-foot ribbon.
  ok(!optionsForChunk({ x0: 0, y0: 0, x1: 20, y1: 5 }, PLAN_OPTIONS)
      .some((o) => o.id === 'cove'),
    'a 5 ft chunk is offered no cove — the higher ceiling left in the middle would be a ribbon');
  ok(optionsForChunk({ x0: 0, y0: 0, x1: 20, y1: 12 }, PLAN_OPTIONS)
      .some((o) => o.id === 'cove'),
    '...and a 12 ft one is');
}

// --- 3. nothing crowds the line -------------------------------------------
say('3. NOTHING CROWDS THE LINE');
const clearanceOf = (p, line) => {
  const dx = Math.max(line.x0 - p.x, 0, p.x - line.x1);
  const dy = Math.max(line.y0 - p.y, 0, p.y - line.y1);
  if (dx > 0 || dy > 0) return { d: Math.hypot(dx, dy), inside: false };
  return { d: Math.min(p.x - line.x0, line.x1 - p.x, p.y - line.y0, line.y1 - p.y), inside: true };
};
const checkClearance = (r, label) => {
  const line = r.cove.line;
  let worstIn = Infinity, worstOut = Infinity;
  for (const l of r.plan.lights) {
    const { d, inside } = clearanceOf(l, line);
    if (inside) worstIn = Math.min(worstIn, d); else worstOut = Math.min(worstOut, d);
  }
  ok(!(worstIn < PLAN_OPTIONS.coveInside - 1e-6),
    `${label}: nothing inside the line is closer than ${PLAN_OPTIONS.coveInside} ft `
    + `(closest ${worstIn === Infinity ? 'n/a' : worstIn.toFixed(2)})`);
  ok(!(worstOut < PLAN_OPTIONS.coveOutside - 1e-6),
    `${label}: nothing outside it is closer than ${PLAN_OPTIONS.coveOutside} ft `
    + `(closest ${worstOut === Infinity ? 'n/a' : worstOut.toFixed(2)})`);
};

// --- the ladder ------------------------------------------------------------
say('4. THE LADDER STOPS AT THE FIRST RUNG THAT MEETS THE BRIEF');
const run = (w, h, criteria, extra = {}) => coved(w, h, criteria, extra);

{
  // A long thin residential space: a lot of perimeter for very little floor, so
  // the cove is more than enough on its own. This is the case the whole feature
  // is FOR — a room that ends up with no downlights at all.
  const r = run(30, 10, 20);
  const geo = r.cove;
  ok(geo.stage === 'cove', `30 x 10 at 20 lm/sqft: the cove carries it alone (${Math.round(geo.coveLumens)} lm against ${Math.round(geo.requiredLumens)} owed)`);
  ok(r.plan.lights.length === 0, '...so not one downlight is placed in that chunk');
  ok(geo.sufficient, '...and it is reported as meeting the brief');
  ok(near(geo.coveLumens, geo.perimeterFt * COVE_LUMENS_PER_FT),
    `...at the stated ${COVE_LUMENS_PER_FT} lm per foot of run`);
  ok(geo.requiredLumens < COVE_TOLERANCE * geo.coveLumens,
    `...which is the ${COVE_TOLERANCE}x rule and nothing else`);
  checkClearance(r, '30 x 10');
}
{
  // A BIG SQUARISH ROOM is where a cove runs out on its own: perimeter grows
  // with the side and the floor it has to light grows with the square of it.
  const r = run(24, 20, 20);
  ok(r.cove.stage === 'inner', '24 x 20 at 20 lm/sqft: the cove is short, so the grid inside it is lit');
  ok(r.plan.lights.length > 0, '...and there are fittings');
  ok(r.plan.lights.every((l) => {
    const ch = r.plan.chunks[l.kind === 'small' ? l.cell.chunk : l.chunk];
    return ch.cove === 'inner';
  }), '...every one of them inside the cove line, none in the band');
  ok(r.cove.sufficient, '...and that reaches the figure');
  checkClearance(r, '24 x 20');
}
{
  // The same room as an OFFICE. 50 lm/sqft is two and a half times the brief,
  // so both the middle and the band have to be lit — and the band is 4 ft, so
  // it takes the narrow lamp.
  const r = run(20, 14, 50);
  ok(r.cove.stage === 'band', '20 x 14 at 50 lm/sqft: the band outside the cove is lit too');
  const inBand = r.plan.lights.filter((l) => {
    const ch = r.plan.chunks[l.kind === 'small' ? l.cell.chunk : l.chunk];
    return ch.cove === 'band';
  });
  ok(inBand.length > 0, `...${inBand.length} fittings out there`);
  ok(r.cove.bandFixture === 'small-narrow',
    '...on the 5 W narrow line, because a 4 ft band is under the 6 ft break');
  ok(!r.cove.sufficient,
    '...and it STILL does not reach 50 lm/sqft, which is said out loud rather than hidden');
  checkClearance(r, '20 x 14 office');
}
{
  const r = run(60, 45, 20);
  ok(r.cove.stage === 'band' && r.cove.bandFixture === 'small',
    'a 60 x 45 hall takes the 8 ft band, which is over the break, so the 7 W lamp');
  ok(r.cove.sufficient, '...and with everything lit it meets 20 lm/sqft');
  checkClearance(r, '60 x 45');
}

say('   the arithmetic, checked against the catalogue');
{
  const r = run(20, 14, 50);
  const stamped = r.plan.lights.map((l) => {
    const ch = r.plan.chunks[l.kind === 'small' ? l.cell.chunk : l.chunk];
    return ch.coveFixture ?? l.kind;
  });
  const sum = stamped.reduce((t, id) => t + (FIXTURE_BY_ID[id]?.lumens ?? 0), 0);
  ok(near(sum, r.cove.gridLumens, 1e-6),
    `the reported grid figure is the sum of the catalogue's own lumens (${sum} lm)`);
  ok(near(r.cove.providedLumens, r.cove.coveLumens + r.cove.gridLumens),
    'and what is delivered is the cove plus the grid, nothing else');
}

// --- 5. dark is not unserved ----------------------------------------------
say('5. A DARK CELL IS NOT AN UNSERVED ONE');
{
  const r = run(30, 10, 20);
  const st = r.plan.stats;
  ok(st.dark > 0, `the cove-only space has ${st.dark} cells laid out and deliberately unlit`);
  ok(st.unserved === 0, '...and NONE of them counts as unserved');
  ok(st.ceded === 0 && st.clashes === 0, '...nor as ceded, nor as a clash');
  ok(st.cells === st.dark + st.served + st.ceded + st.unserved,
    '...the four numbers still account for every cell exactly once');
}

// --- 6. a task surface in a room the cove carries alone --------------------
say('6. A TASK SPOT STILL LANDS IN A ROOM WITH NO DOWNLIGHTS');
{
  // The case from the field: a coved bedroom the strip carries on its own, with
  // a desk against the wall — out in the band, where nothing can stand.
  const W = 12.9, H = 12.5;
  const room = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const bed = [{ x0: 0.5, y0: 1.5, x1: 6.5, y1: 8 }];
  const r = coved(W, H, 20, { zonesFt: bed });
  ok(r.cove.stage === 'cove' && r.plan.lights.length === 0,
    'the cove carries this bedroom — not one downlight in it');

  const desk = { x0: W - 2.6, y0: 0.4, x1: W - 0.4, y1: 2.6 };
  const ctx = {
    chunks: r.plan.chunks, lights: r.plan.lights, polygon: room,
    fixtures: [], chandeliers: [], zones: r.plan.zones ?? [],
    coves: r.plan.opt.coves, opt: PLAN_OPTIONS };
  const L = r.cove.line;
  const offCove = (p) => {
    const within = p.x > L.x0 && p.x < L.x1 && p.y > L.y0 && p.y < L.y1;
    const dx = Math.max(L.x0 - p.x, 0, p.x - L.x1), dy = Math.max(L.y0 - p.y, 0, p.y - L.y1);
    const d = (dx > 0 || dy > 0) ? Math.hypot(dx, dy)
      : Math.min(p.x - L.x0, L.x1 - p.x, p.y - L.y0, L.y1 - p.y);
    return { d, need: within ? PLAN_OPTIONS.coveInside : PLAN_OPTIONS.coveOutside };
  };
  const toWall = (p) => Math.min(p.x, W - p.x, p.y, H - p.y);

  const res = planTaskSpots([desk], ctx)[0];
  ok(!!res.spot, `a spot is placed anyway${res.spot ? '' : ' — ' + (res.rejected || res.skipped)}`);
  if (res.spot) {
    const p = res.spot;
    const c = offCove(p);
    ok(c.d >= c.need - 1e-6,
      `...standing ${c.d.toFixed(2)} ft off the cove line, clear of the pocket like any other fitting`);
    ok(toWall(p) >= SPOT_DEFAULTS.wallDistance - 1e-6,
      `...and ${toWall(p).toFixed(2)} ft off the wall, which is its own rule and not the ambient one`);
    const aimsAt = Math.abs(Math.atan2(p.target.y - p.y, p.target.x - p.x) - p.angle) < 1e-9;
    ok(aimsAt, '...pointing at the desk');
    const inBed = p.x > bed[0].x0 && p.x < bed[0].x1 && p.y > bed[0].y0 && p.y < bed[0].y1;
    ok(!inBed, '...and not over the bed');
    // WITH THE 1 FT RULE THE BAND ITSELF WILL TAKE IT, which is the better
    // answer: the fitting ends up beside the desk rather than out in the middle
    // of the room aiming across it.
    ok(rectDistance(p, desk) < 6, `...beside the desk, ${rectDistance(p, desk).toFixed(1)} ft from it`);
  }
}
{
  // THE FALL-THROUGH IS STILL THE SAFETY NET, and it has to be tested on a case
  // that genuinely needs it — so the wall rule is wound back up until the band
  // the desk sits in cannot take a fitting at all. The spot must then come off
  // the nearest piece of ceiling that can, rather than not exist.
  const W = 12.9, H = 12.5;
  const room = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const r = coved(W, H, 20);
  const desk = { x0: W - 2.6, y0: 0.4, x1: W - 0.4, y1: 2.6 };
  const res = planTaskSpots([desk], {
    chunks: r.plan.chunks, lights: r.plan.lights, polygon: room,
    fixtures: [], chandeliers: [], zones: [], coves: r.plan.opt.coves,
    opt: { ...PLAN_OPTIONS, wallDistance: 3 } })[0];
  ok(!!res.spot, 'with a 3 ft wall rule the band is unusable, and a spot is placed all the same');
  ok(res.spot?.viaChunk === 'nearest',
    '...off the nearest piece of ceiling that could take it');
  const L = r.cove.line;
  ok(res.spot && res.spot.x > L.x0 && res.spot.x < L.x1
     && res.spot.y > L.y0 && res.spot.y < L.y1,
    '...which is the ceiling inside the cove line');
}

{
  // ...and the ordinary room is untouched: a midpoint is still a midpoint.
  const room = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }];
  const chunk = { x0: 0, y0: 0, x1: 24, y1: 16 };
  const lights = [{ id: 'a', x: 6, y: 8 }, { id: 'b', x: 18, y: 8 }];
  const table = { x0: 10, y0: 10, x1: 14, y1: 13 };
  const res = planTaskSpots([table], { chunks: [chunk], lights, polygon: room,
    fixtures: [], chandeliers: [], zones: [], opt: PLAN_OPTIONS })[0];
  ok(res.spot && near(res.spot.x, 12) && near(res.spot.y, 8),
    'with real lights and nothing in the way the spot is still the plain midpoint');
  ok(res.spot && res.spot.slid === 0 && !res.spot.viaChunk,
    '...unslid, and in the surface\'s own chunk');
}

// --- the criteria table ---------------------------------------------------
say('   and what each kind of building is owed');
ok(lumenCriteriaFor('residential') === 20 && lumenCriteriaFor('hotel') === 20
   && lumenCriteriaFor('restaurant') === 20, 'residential and hospitality: 20 lm/sqft');
ok(lumenCriteriaFor('office') === 50 && lumenCriteriaFor('educational') === 50,
  'commercial and institutional: 50 lm/sqft');
ok(lumenCriteriaFor('residential', 'kitchen') === 36
   && lumenCriteriaFor('residential', 'toilet') === 25,
  'a kitchen and a toilet keep their own figures, whatever the building is');
ok(lumenCriteriaFor('office', 'kitchen') === 36,
  '...including in an office, where the room type still wins');

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
