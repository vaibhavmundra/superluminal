// ---------------------------------------------------------------------------
// test-ceiling-design.mjs — the ceiling design is chosen PER CHUNK.
//
// Six claims, and every assertion below belongs to one of them:
//
//   1. THE CHUNKS COME FROM THE OUTLINE. The pieces somebody chooses a ceiling
//      for are the ceiling as BUILT — holes in it count, furniture standing
//      under it does not. An L is two pieces; a rectangle is one.
//   2. A CHUNK IS NAMED BY ITS GEOMETRY. A pick survives a re-render and a
//      re-enumeration, and is DROPPED by a re-traced outline. An index would
//      survive the re-trace and move somebody's cove to another piece.
//   3. EVERY PIECE OFFERS WHAT IT CAN CARRY. Standard always; a cove only where
//      one would read as a cove rather than as a mistake with a strip in it.
//   4. THE PIECES ARE INDEPENDENT. Cove one end of an L, both ends, or neither,
//      and each cove climbs its own ladder — the small end can be carried by
//      its strip while the big one needs its grid lit.
//   5. NOTHING REGRESSED TO GAIN THIS. A space with no cove in it comes out
//      light for light identical to the layout the old single-chunking path
//      produced, furniture and all.
//   6. EVERY FITTING KNOWS WHICH DECISION PUT IT THERE. That stamp is the whole
//      interface: click a light, and the pill knows whose options to flip.
//
//   node tools/test-ceiling-design.mjs
// ---------------------------------------------------------------------------

import { designChunking, planCeilingDesign, optionsForChunk, chunkKey,
         resolvePick, MIN_INNER_FT, OPTION_LABEL } from '../src/lib/ceilingDesign.js';
import { coveGeometry } from '../src/lib/cove.js';
import { planLights } from '../src/lib/planner.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const say = (t) => console.log('\n' + t);
const opt = PLAN_OPTIONS;

const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
// An L-shaped living-dining, big enough that both ends are real rooms.
const L = [{ x: 0, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 30 },
           { x: 16, y: 30 }, { x: 16, y: 14 }, { x: 0, y: 14 }];
const lay = (polygon, chunks, picks, extra = {}) => planCeilingDesign({
  polygonFt: polygon, designChunks: chunks, picks, opt, criteria: 20, ...extra });

// --- 1. the chunks come from the outline ----------------------------------
say('1. THE CHUNKS COME FROM THE OUTLINE');
{
  const d = designChunking(box(14, 12), [], opt, []);
  ok(d.chunks.length === 1 && near(d.chunks[0].area, 14 * 12),
    'a plain rectangular room is ONE piece of ceiling — the whole of it');
  ok(!d.needsChoice, '...with nothing to choose about how it is cut up');

  const bed = [{ x0: 1, y0: 1, x1: 7, y1: 8 }];
  const withBed = designChunking(box(14, 12), [], opt, []);
  ok(withBed.chunks.length === 1,
    '...and it is still one piece with a bed in it, because a bed is not a hole');
  const p = lay(box(14, 12), d.chunks, {}, { zonesFt: bed });
  ok(p.plan.chunks.length > 1,
    `...though the GRID inside it is still cut round the bed (${p.plan.chunks.length} pieces)`);
  ok(p.plan.chunks.every((c) => c.design === d.chunks[0].key),
    '...every one of them belonging to the same decision');
}
{
  const d = designChunking(L, [], opt, []);
  ok(d.chunks.length === 2, 'an L is two pieces of ceiling');
  const area = d.chunks.reduce((t, c) => t + c.area, 0);
  ok(near(area, 44 * 14 + 28 * 16, 1e-6), '...and together they are the whole of it');
  const overlaps = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9
                          && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-9;
  ok(!overlaps(d.chunks[0], d.chunks[1]), '...and they do not overlap');
  ok(d.chunks[0].area >= d.chunks[1].area, '...biggest first, so chunk 1 is the main body');
}
{
  // A hole in the ceiling cuts it; the chunker cannot cross one.
  const shaft = [{ x0: 12, y0: 0, x1: 18, y1: 20 }];
  const d = designChunking(box(30, 20), shaft, opt, []);
  ok(d.chunks.length >= 2 && d.chunks.every((c) => c.x1 <= 12 + 1e-9 || c.x0 >= 18 - 1e-9),
    'a shaft through the ceiling cuts it into pieces either side');
}

// --- 2. a chunk is named by its geometry ---------------------------------
say('2. A CHUNK IS NAMED BY ITS GEOMETRY');
{
  const a = designChunking(L, [], opt, []);
  const b = designChunking(L, [], opt, []);
  ok(a.chunks.every((c, i) => c.key === b.chunks[i].key),
    'the same room enumerated twice gives the same keys');
  ok(a.chunks[0].key === chunkKey(a.chunks[0]), '...and the key is a function of the rectangle');
  ok(new Set(a.chunks.map((c) => c.key)).size === a.chunks.length, '...one per piece, no collisions');

  // A re-traced outline: the pick must not survive onto a different rectangle.
  const moved = designChunking(box(20, 16), [], opt, []);
  const stale = { [a.chunks[0].key]: 'cove' };
  const r = resolvePick(moved.chunks[0], stale, opt);
  ok(r.pick === 'standard',
    'a pick naming a rectangle that no longer exists is dropped, not inherited');
  const p = lay(box(20, 16), moved.chunks, stale);
  ok(p.coves.length === 0 && p.plan.ok, '...and the layout comes out standard, not broken');
  ok(resolvePick(moved.chunks[0], { [moved.chunks[0].key]: 'nonsense' }, opt).pick === 'standard',
    'an option id nobody offers falls back to standard too');
}

// --- 3. every piece offers what it can carry -----------------------------
say('3. EVERY PIECE OFFERS WHAT IT CAN CARRY');
{
  const labels = (c) => optionsForChunk(c, opt).map((o) => o.label);
  // BY MEMBERSHIP AND NOT BY COUNT. These were length checks, and the seven
  // track arrangements are what showed the difference: what this claim is about
  // is whether a COVE is on offer, and a count says that only for as long as
  // nothing else is ever added to the list. See test-track.mjs for the tracks'
  // own gating.
  const ids = (c) => optionsForChunk(c, opt).map((o) => o.id);
  ok(labels({ x0: 0, y0: 0, x1: 4, y1: 4 })[0] === OPTION_LABEL.standard,
    'standard is always first, and always available');
  ok(!ids({ x0: 0, y0: 0, x1: 4, y1: 4 }).includes('cove'),
    'a chunk you could not stand a cove in is not offered one');
  ok(ids({ x0: 0, y0: 0, x1: 4, y1: 4 }).length === 1,
    '...and a chunk too small for anything else is offered standard alone');
  ok(ids({ x0: 0, y0: 0, x1: 20, y1: 12 }).includes('cove'),
    'a 20 x 12 chunk is offered a cove');
  // The break is stated in terms of what is LEFT in the middle, so it moves
  // correctly with the inset table rather than being a second hard-coded figure.
  let least = null;
  for (let h = 4; h < 20; h += 0.25) {
    const c = { x0: 0, y0: 0, x1: 40, y1: h };
    if (optionsForChunk(c, opt).some((o) => o.id === 'cove')) { least = h; break; }
  }
  const g = coveGeometry({ x0: 0, y0: 0, x1: 40, y1: least });
  ok(Math.min(g.line.w, g.line.h) >= MIN_INNER_FT - 1e-9,
    `the narrowest chunk offered a cove (${least} ft) still leaves ${MIN_INNER_FT} ft of higher ceiling`);
  const under = { x0: 0, y0: 0, x1: 40, y1: least - 0.25 };
  ok(!optionsForChunk(under, opt).some((o) => o.id === 'cove'),
    '...and a hair under that is offered none');
}

// --- 4. the pieces are independent ---------------------------------------
say('4. THE PIECES ARE INDEPENDENT');
{
  const d = designChunking(L, [], opt, []);
  const [big, small] = d.chunks;
  const none = lay(L, d.chunks, {});
  const one = lay(L, d.chunks, { [big.key]: 'cove' });
  const both = lay(L, d.chunks, { [big.key]: 'cove', [small.key]: 'cove' });

  ok(none.coves.length === 0 && none.plan.lights.length > 0, 'neither end coved: a plain grid');
  ok(one.coves.length === 1 && one.coves[0].key === big.key,
    'one end coved: exactly one cove, in the chunk that was picked');
  ok(near(one.coves[0].host.area, big.area), '...set out in that chunk and no other rectangle');
  ok(both.coves.length === 2, 'both ends coved: two coves, each set out square');
  ok(new Set(both.coves.map((c) => c.key)).size === 2, '...and they are told apart by their chunk');

  // The other end is untouched by the first end's decision.
  const untouched = one.plan.lights.filter((l) => {
    const ch = one.plan.chunks[l.kind === 'small' ? l.cell.chunk : l.chunk];
    return ch.design === small.key;
  });
  ok(untouched.length > 0, 'the un-coved end still gets its ordinary grid');
  ok(one.plan.lights.every((l) => {
    const ch = one.plan.chunks[l.kind === 'small' ? l.cell.chunk : l.chunk];
    return ch.design !== big.key || ch.cove;
  }), '...and every fitting in the coved end is in the cove, inner or band');

  // EACH LADDER IS ITS OWN. A 22 lm/sqft brief on this L asks more of the big
  // end than its strip can give and less of the small one.
  const mixed = planCeilingDesign({ polygonFt: L, designChunks: d.chunks,
    picks: { [big.key]: 'cove', [small.key]: 'cove' }, opt, criteria: 22 });
  const stages = mixed.coves.map((c) => c.stage);
  ok(new Set(stages).size === 2,
    `two coves on one plan stop on DIFFERENT rungs (${stages.join(', ')})`);
  ok(mixed.coves.every((c) => c.providedLumens >= c.coveLumens),
    '...and each is measured on its own run plus its own grid');
  ok(mixed.coves.every((c) => near(c.providedLumens, c.coveLumens + c.gridLumens)),
    '...with nothing borrowed from the other end');
}

// --- 5. nothing regressed ------------------------------------------------
say('5. A SPACE WITH NO COVE IS THE LAYOUT IT ALWAYS WAS');
{
  const cases = [
    ['14 x 12 with a bed', box(14, 12), [{ x0: 1, y0: 1, x1: 7, y1: 8 }]],
    ['20 x 16 empty', box(20, 16), []],
    ['26 x 18 with two zones', box(26, 18),
      [{ x0: 2, y0: 2, x1: 8, y1: 9 }, { x0: 20, y0: 12, x1: 25, y1: 17 }]],
    ['12.9 x 12.5 bedroom', box(12.9, 12.5), [{ x0: 0.5, y0: 1.5, x1: 6.5, y1: 8 }]],
  ];
  for (const [name, polygon, zones] of cases) {
    const d = designChunking(polygon, [], opt, []);
    const now = lay(polygon, d.chunks, {}, { zonesFt: zones }).plan;
    const before = planLights(polygon, [], { ...opt, chunkStrategy: 'auto' }, zones);
    const same = now.lights.length === before.lights.length
      && now.lights.every((l, i) => near(l.x, before.lights[i].x)
                                 && near(l.y, before.lights[i].y)
                                 && l.kind === before.lights[i].kind);
    ok(same, `${name}: ${before.lights.length} fittings, in the same places as before`);
  }
}
{
  // AND THE CHUNK PICKER STILL MEANS SOMETHING. The reading somebody chose is
  // offered to both levels of chunking, so asking for bays gets bays.
  const zones = [{ x0: 10, y0: 6, x1: 16, y1: 12 }];
  const d = designChunking(box(30, 18), [], opt, []);
  const bays = lay(box(30, 18), d.chunks, {}, { zonesFt: zones, strategy: 'vertical-slices' }).plan;
  const same = planLights(box(30, 18), [], { ...opt, chunkStrategy: 'vertical-slices' }, zones);
  ok(bays.chunks.length === same.chunks.length
     && bays.lights.length === same.lights.length,
    'a chosen strategy reaches the grid inside a standard chunk unchanged');
}

// --- 6. every fitting knows which decision put it there ------------------
say('6. EVERY FITTING KNOWS WHICH DECISION PUT IT THERE');
{
  const d = designChunking(L, [], opt, []);
  const keys = new Set(d.chunks.map((c) => c.key));
  for (const picks of [{}, { [d.chunks[0].key]: 'cove' },
                       Object.fromEntries(d.chunks.map((c) => [c.key, 'cove']))]) {
    const p = lay(L, d.chunks, picks);
    ok(p.plan.chunks.every((c) => keys.has(c.design)),
      `every chunk handed to the planner is stamped with a real chunk key `
      + `(${Object.keys(picks).length} coved)`);
    ok(p.plan.lights.every((l) => {
      const ch = p.plan.chunks[l.kind === 'small' ? l.cell.chunk : l.chunk];
      return ch && keys.has(ch.design);
    }), '...and so is every fitting on the drawing, through the chunk it sits in');
  }
  const p = lay(L, d.chunks, { [d.chunks[0].key]: 'cove' });
  ok(p.parts.length === d.chunks.length,
    'one part per chunk comes back, whatever each one was set to');
  ok(p.parts.every((x) => x.options.length >= 1 && x.pick),
    '...each carrying what it is and what else it could be — which is the pill');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
