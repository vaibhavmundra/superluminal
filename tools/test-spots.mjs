// ---------------------------------------------------------------------------
// test-spots.mjs — the secondary grid, and the spot that goes on it.
//
// The two examples this was built from are worth reproducing exactly, because
// they pin the whole rule: a spot lands at the MIDPOINT of the segment whose
// centre is nearest the surface, light-to-light before light-to-edge, and the
// arrow points at the surface's centre.
//
//   node tools/test-spots.mjs
// ---------------------------------------------------------------------------

import { secondaryGrid, placeTaskSpot, chunkFor, rectDistance,
         planTaskSpots, chandelierOver, segmentKey, groupSurfaces,
         SPOT_DEFAULTS, RUN_DEFAULTS } from '../src/lib/taskSpots.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// A 24 x 16 chunk with a 3 x 2 grid of lights at the cell centres.
const chunk = { x0: 0, y0: 0, x1: 24, y1: 16 };
const L = [];
[4, 12, 20].forEach((x) => [4, 12].forEach((y) => L.push({ id: `S${L.length}`, x, y, kind: 'small' })));
const room = [{x:0,y:0},{x:24,y:0},{x:24,y:16},{x:0,y:16}];
const base = { chunk, lights: L, polygon: room, fixtures: [], zones: [],
               opt: { fanClearance: 1, minWallDistance: 0, wallDistance: 0 } };

console.log('-- the grid --');
{
  const g = secondaryGrid(chunk, L);
  ok(g.lines.filter((l) => l.axis === 'h').length === 2, 'one horizontal line per row of lights');
  ok(g.lines.filter((l) => l.axis === 'v').length === 3, 'one vertical line per column');
  ok(g.lines.every((l) => (l.axis === 'h' ? l.a.x === 0 && l.b.x === 24 : l.a.y === 0 && l.b.y === 16)),
    'and every line runs out to the chunk outline');

  const ll = g.segments.filter((s) => s.kind === 'light-light');
  const le = g.segments.filter((s) => s.kind === 'light-edge');
  // rows: 2 adjacent pairs each = 4;  cols: 1 pair each = 3
  ok(ll.length === 7, `adjacent light pairs only, no skipping: ${ll.length}`);
  // rows: 2 ends each = 4;  cols: 2 ends each = 6
  ok(le.length === 10, `and each line's two ends reach the outline: ${le.length}`);
  ok(!g.segments.some((s) => s.length < 1.6), 'segments shorter than the floor are dropped');

  // Lights the aligner left a hair apart are ONE lane, not four.
  const wobbly = [{id:'a',x:4,y:4},{id:'b',x:12,y:4.07},{id:'c',x:20,y:3.94}];
  ok(secondaryGrid(chunk, wobbly).lines.filter((l) => l.axis === 'h').length === 1,
    'a row that is a hair out of true is still one row');
}

console.log('\n-- THE DINING EXAMPLE: midpoint between two lights on a row --');
{
  // A table sitting to the right of the middle column, between the two rows —
  // the same relationship as the worked example: the spot lands on the vertical
  // segment beside the table, not over it.
  const surface = { x0: 13, y0: 6, x1: 18, y1: 10 };   // centre 15.5, 8
  const r = placeTaskSpot(surface, base);
  ok(!!r.spot, `placed: ${r.rejected ?? 'yes'}`);
  ok(r.spot.via === 'light-light', 'via a light-to-light segment');
  ok(near(r.spot.x, 12) && near(r.spot.y, 8), `at the midpoint of the segment: ${r.spot.x},${r.spot.y}`);
  ok(near(Math.hypot(r.spot.aim.x, r.spot.aim.y), 1), 'the aim is a unit vector');
  ok(near(r.spot.aim.x, 1) && near(r.spot.aim.y, 0), 'pointing at the centre of the surface');
  ok(near(r.spot.target.x, 15.5) && near(r.spot.target.y, 8), 'and the target IS that centre');
}

console.log('\n-- THE LIVING-ROOM EXAMPLE: the vertical segment beside the table --');
{
  // A coffee table just right of the left-hand column, between the two rows.
  const surface = { x0: 5.5, y0: 6.5, x1: 10, y1: 9.5 };
  const r = placeTaskSpot(surface, base);
  ok(r.spot.via === 'light-light' && near(r.spot.x, 4) && near(r.spot.y, 8),
    `the nearest light-to-light midpoint wins: ${r.spot.x},${r.spot.y}`);
  ok(r.spot.aim.x > 0, 'and it aims right, at the table');
}

console.log('\n-- light-to-edge is a FALLBACK, never a competitor --');
{
  // A surface hard against the left wall. The nearest segment centre of all is
  // the edge segment at x=2, but a light-to-light pair must still win.
  const surface = { x0: 0.2, y0: 7, x1: 3, y1: 9 };
  const r = placeTaskSpot(surface, base);
  ok(r.spot.via === 'light-light',
    `a poor pair beats a good edge: chose ${r.spot.via} at ${r.spot.x},${r.spot.y}`);

  // Now block every light-to-light midpoint with ceiling objects and the edge
  // segments become the answer.
  const blockers = [{ x: 8, y: 4, r: 2 }, { x: 16, y: 4, r: 2 }, { x: 8, y: 12, r: 2 },
                    { x: 16, y: 12, r: 2 }, { x: 4, y: 8, r: 2 }, { x: 12, y: 8, r: 2 },
                    { x: 20, y: 8, r: 2 }];
  const r2 = placeTaskSpot(surface, { ...base, fixtures: blockers });
  ok(r2.spot?.via === 'light-edge', `with the pairs blocked it falls back: ${r2.spot?.via}`);
  // The nearest edge-segment centre — the stub between the wall and the first
  // light on the y=4 row, not some point level with the table.
  ok(near(r2.spot.x, 2) && near(r2.spot.y, 4), `to the edge segment's midpoint: ${r2.spot.x},${r2.spot.y}`);
}

console.log('\n-- the ambient rules apply to a spot too --');
{
  const surface = { x0: 9, y0: 5.5, x1: 15, y1: 11 };
  // A fan sitting exactly on the winning midpoint pushes the spot elsewhere.
  const r = placeTaskSpot(surface, { ...base, fixtures: [{ x: 12, y: 8, r: 1.5 }] });
  ok(r.spot && !(near(r.spot.x, 12) && near(r.spot.y, 8)), 'a ceiling object moves it off that segment');
  ok(r.spot && r.spot.aim, 'and it still finds somewhere');

  // A no-light zone does the same.
  const rz = placeTaskSpot(surface, { ...base, zones: [{ x0: 11, y0: 7, x1: 13, y1: 9 }] });
  ok(rz.spot && !(near(rz.spot.x, 12) && near(rz.spot.y, 8)), 'a no-light zone moves it too');

  // The wall rule bites, and says so.
  const walled = placeTaskSpot({ x0: 0.2, y0: 7, x1: 3, y1: 9 },
    { ...base, opt: { ...base.opt, wallDistance: 9 } });
  ok(!walled.spot && /ft to a wall/.test(walled.rejected),
    `an impossible wall rule refuses with a reason: "${walled.rejected}"`);

  // Everything blocked -> a sentence, not a silence.
  const dead = placeTaskSpot(surface, {
    ...base, fixtures: [{ x: 12, y: 8, r: 40 }] });
  ok(!dead.spot && /clearance/.test(dead.rejected), `and so does a blanket obstruction: "${dead.rejected}"`);
}

console.log('\n-- a spot standing on its own surface has nothing to aim at --');
{
  // A surface centred exactly on a light-to-light midpoint — the case the
  // dining example is NOT, and the one that would otherwise produce an arrow
  // with no direction to point in.
  const surface = { x0: 11.6, y0: 7.6, x1: 12.4, y1: 8.4 };
  const r = placeTaskSpot(surface, base);
  ok(r.spot && !(near(r.spot.x, 12) && near(r.spot.y, 8)),
    'the degenerate midpoint is refused and another segment is used');
  ok(r.spot && Math.hypot(r.spot.aim.x, r.spot.aim.y) > 0.99, 'so the arrow still has a direction');
}

console.log('\n-- odds and ends --');
{
  ok(rectDistance({ x: 0, y: 0 }, { x0: 3, y0: 4, x1: 5, y1: 6 }) === 5, 'rectDistance is a 3-4-5');
  ok(rectDistance({ x: 4, y: 5 }, { x0: 3, y0: 4, x1: 5, y1: 6 }) === 0, 'and zero inside');
  const chunks = [{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 }];
  ok(chunkFor({ x: 15, y: 5 }, chunks) === chunks[1], 'chunkFor finds the containing chunk');
  ok(chunkFor({ x: 30, y: 5 }, chunks) === chunks[1], 'and the nearest when nothing contains it');
  const lone = placeTaskSpot({ x0: 1, y0: 1, x1: 2, y1: 2 },
    { ...base, lights: [{ id: 'x', x: 12, y: 8 }] });
  ok(lone.spot?.via === 'light-edge' || /fewer than two lights/.test(lone.rejected ?? ''),
    'one light still yields its edge segments');
}


console.log('\n-- ONE SPOT LIGHTS ONE SURFACE --');
{
  // Two surfaces sitting either side of the same light-to-light segment. Placed
  // independently they would both take its midpoint and the drawing would show
  // one fitting aimed at two things.
  const left  = { x0: 1.5, y0: 6.5, x1: 3.5, y1: 9.5 };    // nearest: x=4 column mid (4,8)
  const right = { x0: 4.5, y0: 6.5, x1: 6.5, y1: 9.5 };    // same
  const solo = [placeTaskSpot(left, base), placeTaskSpot(right, base)];
  ok(near(solo[0].spot.x, 4) && near(solo[1].spot.x, 4)
     && near(solo[0].spot.y, 8) && near(solo[1].spot.y, 8),
    'placed one at a time they collide on the same midpoint — which is the bug');

  const both = planTaskSpots([left, right], base);
  ok(both.every((r) => r.spot), 'planned together, both still get a spot');
  const k = both.map((r) => segmentKey(r.spot.segment));
  ok(k[0] !== k[1], `and they are on different segments: ${k[0]} vs ${k[1]}`);
  ok(both.some((r) => near(r.spot.x, 4) && near(r.spot.y, 8)), 'one of them keeps the contested midpoint');

  // First pick goes to the LARGER surface, not to whichever was listed first.
  const small = { x0: 4.5, y0: 7.5, x1: 5.0, y1: 8.5 };
  const big   = { x0: 4.5, y0: 5.0, x1: 9.5, y1: 11.0 };
  const ranked = planTaskSpots([small, big], base);
  ok(near(ranked[1].spot.x, 4) && near(ranked[1].spot.y, 8),
    'the big one wins the contested segment even though it was listed second');
  ok(!(near(ranked[0].spot.x, 4) && near(ranked[0].spot.y, 8)), 'and the small one moves on');

  // Order is stable for equal areas, so the same input gives the same drawing.
  const a = planTaskSpots([left, right], base).map((r) => segmentKey(r.spot.segment));
  const b2 = planTaskSpots([left, right], base).map((r) => segmentKey(r.spot.segment));
  ok(a.join('|') === b2.join('|'), 'and the result is deterministic');
}

console.log('\n-- A CHANDELIER ALREADY LIGHTS IT --');
{
  const table = { x0: 10, y0: 6, x1: 14, y1: 10 };
  // Hanging right over it.
  const over = chandelierOver(table, [{ x: 12, y: 8, r: 1.5 }]);
  ok(!!over && over.distance === 0, 'a chandelier over the table counts');

  // 2ft clear of the outline: still counts at the 3ft rule.
  ok(!!chandelierOver(table, [{ x: 12, y: 12, r: 0 }]), 'and one 2 ft off the outline counts');
  // 4ft clear: does not.
  ok(!chandelierOver(table, [{ x: 12, y: 14, r: 0 }]), 'one 4 ft off does not');

  // MEASURED FROM THE BODY, not the centre — a wide fitting reaches further
  // than its centre suggests, which is the whole reason it counts.
  ok(!!chandelierOver(table, [{ x: 12, y: 15, r: 2.5 }]),
    'a wide chandelier counts from its rim, where a point at the same centre would not');
  ok(!chandelierOver(table, [{ x: 12, y: 15, r: 0 }]), '...and the same centre with no body does not');

  // The surface is SKIPPED, not refused, and the sentence says why.
  const res = planTaskSpots([table], { ...base, chandeliers: [{ x: 12, y: 8, r: 1.5 }] });
  ok(!res[0].spot && /chandelier/.test(res[0].skipped ?? ''),
    `skipped with a reason: "${res[0].skipped}"`);
  ok(!res[0].rejected, 'and it is a skip, not a rejection — different outcomes');

  // Its segment is NOT spent, so another surface may still use it.
  const other = { x0: 4.5, y0: 6.5, x1: 6.5, y1: 9.5 };
  const two = planTaskSpots([table, other], { ...base, chandeliers: [{ x: 12, y: 8, r: 1.5 }] });
  ok(two[1].spot && near(two[1].spot.x, 4) && near(two[1].spot.y, 8),
    'a skipped surface does not consume a segment');

  // A chandelier elsewhere in the room does not veto anything.
  const far = planTaskSpots([table], { ...base, chandeliers: [{ x: 2, y: 2, r: 1 }] });
  ok(!!far[0].spot, 'a chandelier across the room is irrelevant');
}

console.log('\n-- the tolerance is a dial --');
{
  const table = { x0: 10, y0: 6, x1: 14, y1: 10 };
  const c = [{ x: 12, y: 14, r: 0 }];   // 4 ft off the outline
  ok(!chandelierOver(table, c), 'outside the default 3 ft');
  ok(!!chandelierOver(table, c, { chandelierNear: 5 }), 'and inside a 5 ft rule');
}


console.log('\n-- the wall rule is the SPOT\'s, not the large light\'s --');
{
  // PINNED ONLY AS "LESS THAN THE AMBIENT RULE". The figure itself is a dial
  // and gets tuned — it went 5 -> 2 -> 1 as the cases came in — so what these
  // check is that a spot keeps its OWN rule and that the rule is the looser one.
  const WD = SPOT_DEFAULTS.wallDistance;
  ok(WD != null && WD < 5, `a spot keeps ${WD} ft, not the ambient light's 5`);

  // In a big room 5 ft does not refuse outright — it PUSHES the spot away from
  // the surface onto a segment further off, which is the quieter half of the
  // same bug.
  const table = { x0: 5.5, y0: 6.5, x1: 10, y1: 9.5 };
  const inherited = placeTaskSpot(table, { ...base, opt: { fanClearance: 1, minWallDistance: 5, wallDistance: null } });
  ok(inherited.spot && !(near(inherited.spot.x, 4) && near(inherited.spot.y, 8)),
    `inheriting 5 ft pushes it off the near segment to ${inherited.spot?.x},${inherited.spot?.y}`);
  const own = placeTaskSpot(table, { ...base, opt: { fanClearance: 1, minWallDistance: 5 } });
  ok(own.spot && near(own.spot.x, 4) && near(own.spot.y, 8),
    `the spot's own ${WD} ft keeps the near segment: ${own.spot?.x},${own.spot?.y}`);
  ok(rectDistance({ x: own.spot.x, y: own.spot.y }, table)
     < rectDistance({ x: inherited.spot.x, y: inherited.spot.y }, table),
    'so the spot ends up nearer what it is lighting');

  // In a room the size of the one in the worked example, 5 ft refuses the lot.
  const small = { x0: 0, y0: 0, x1: 13, y1: 10 };
  const smallRoom = [{x:0,y:0},{x:13,y:0},{x:13,y:10},{x:0,y:10}];
  const smallLights = [];
  [3.25, 9.75].forEach((x) => [2.5, 7.5].forEach((y) =>
    smallLights.push({ id: `S${smallLights.length}`, x, y })));
  const ctx = { chunk: small, lights: smallLights, polygon: smallRoom, fixtures: [], zones: [] };
  const t2 = { x0: 4, y0: 4, x1: 9, y1: 6 };
  const dead = placeTaskSpot(t2, { ...ctx, opt: { fanClearance: 1, minWallDistance: 5, wallDistance: null } });
  ok(!dead.spot && /5 ft to a wall/.test(dead.rejected ?? ''),
    `in a 13x10 room the ambient rule refuses everything: "${dead.rejected}"`);
  const alive = placeTaskSpot(t2, { ...ctx, opt: { fanClearance: 1, minWallDistance: 5 } });
  ok(!!alive.spot, `and ${WD} ft finds a spot — which is the bug this number fixes`);
}

console.log('\n-- EACH SURFACE AGAINST ITS OWN CHUNK --');
{
  // A living-dining room: one long space cut into two chunks of ceiling, each
  // with its own 3 x 2 grid. The coffee table is up in the first chunk, the
  // dining table down in the second — the exact plan that exposed the bug.
  const upper = { x0: 0, y0: 0,  x1: 24, y1: 16 };
  const lower = { x0: 0, y0: 16, x1: 24, y1: 32 };
  const lights = [];
  [4, 12, 20].forEach((x) => [4, 12, 20, 28].forEach((y) =>
    lights.push({ id: `S${lights.length}`, x, y, kind: 'small' })));
  const poly = [{x:0,y:0},{x:24,y:0},{x:24,y:32},{x:0,y:32}];
  const ctx = { chunks: [upper, lower], lights, polygon: poly, fixtures: [], zones: [],
                opt: { fanClearance: 1, minWallDistance: 0, wallDistance: 0 } };

  const coffee = { x0: 13, y0: 6,  x1: 18, y1: 10 };   // centre 15.5, 8
  const dining = { x0: 13, y0: 22, x1: 18, y1: 26 };   // centre 15.5, 24

  const res = planTaskSpots([coffee, dining], ctx);
  ok(res.every((r) => r.spot), `both placed: ${res.map((r) => r.rejected ?? r.skipped ?? 'ok').join(' / ')}`);
  ok(near(res[0].spot.x, 12) && near(res[0].spot.y, 8),
    `the coffee table takes its own chunk's midpoint: ${res[0].spot.x},${res[0].spot.y}`);
  ok(near(res[1].spot.x, 12) && near(res[1].spot.y, 24),
    `and the dining table takes ITS chunk's, not the coffee table's: ${res[1].spot.x},${res[1].spot.y}`);
  ok(res[1].spot.y >= lower.y0 && res[1].spot.y <= lower.y1,
    'the dining spot is inside the chunk the dining table is in');
  ok(rectDistance({ x: res[1].spot.x, y: res[1].spot.y }, dining) < 2,
    'and it stands right beside what it lights, not across the room');

  // THE BUG, reproduced: hand the whole room ONE chunk — the coffee table's,
  // which is what taking the first surface's chunk amounted to — and the dining
  // table's spot is thrown to the far end of the room.
  const oneChunk = planTaskSpots([coffee, dining], { ...ctx, chunks: null, chunk: upper });
  ok(oneChunk[1].spot && oneChunk[1].spot.y < lower.y0,
    `sharing one chunk strands it at y=${oneChunk[1].spot?.y}`);
  ok(rectDistance({ x: oneChunk[1].spot.x, y: oneChunk[1].spot.y }, dining)
     > rectDistance({ x: res[1].spot.x, y: res[1].spot.y }, dining) + 5,
    'far further from the table than the per-chunk answer — which is the bug');

  // A surface listed first must not decide anything for the others: reverse the
  // order and both answers are unchanged.
  const rev = planTaskSpots([dining, coffee], ctx);
  ok(near(rev[0].spot.x, 12) && near(rev[0].spot.y, 24)
     && near(rev[1].spot.x, 12) && near(rev[1].spot.y, 8),
    'and the order surfaces are listed in changes nothing');

  // The used-once rule still spans chunks — two surfaces in DIFFERENT chunks
  // can never contend, but two in the same one still do.
  const second = { x0: 4.5, y0: 22, x1: 6.5, y1: 26 };
  const three = planTaskSpots([coffee, dining, second], ctx);
  const keys = three.filter((r) => r.spot).map((r) => segmentKey(r.spot.segment));
  ok(new Set(keys).size === keys.length, 'no two spots share a segment');
}

console.log('\n-- PEER SURFACES GO UP AS A RUN --');
{
  // THE CASE FROM THE DRAWING: two coffee tables side by side in front of one
  // sofa. Placed independently each took the segment nearest itself and they
  // landed on two different rows, aiming two different ways.
  const A = { x0: 5,  y0: 7, x1: 9,  y1: 10, type: 'coffee_table' };
  const B = { x0: 10, y0: 7, x1: 14, y1: 10, type: 'coffee_table' };

  const g = groupSurfaces([A, B]);
  ok(g.length === 1 && g[0].members.length === 2 && g[0].axis === 'h',
    `they are one horizontal run: ${JSON.stringify(g)}`);

  const res = planTaskSpots([A, B], base);
  ok(res.every((r) => r.spot), `both placed: ${res.map((r) => r.rejected ?? 'ok').join(' / ')}`);
  ok(near(res[0].spot.y, res[1].spot.y),
    `ON ONE LANE: y=${res[0].spot.y} and y=${res[1].spot.y}`);
  ok(res.every((r) => r.spot.run && r.spot.run.of === 2),
    'and each one says it is standing in a run of two');
  ok(res[0].spot.run.lane.axis === 'h' && near(res[0].spot.run.lane.at, res[0].spot.y),
    'the lane it names is the one it is on');

  const gap = Math.hypot(res[0].spot.x - res[1].spot.x, res[0].spot.y - res[1].spot.y);
  ok(gap >= RUN_DEFAULTS.minSpotGap, `and they are ${gap.toFixed(2)} ft apart, over the six-inch floor`);

  // THE LANE STANDS OFF THE GROUP, so both arrows point the same way rather
  // than one of them skimming its own table sideways.
  ok(Math.sign(res[0].spot.aim.y) === Math.sign(res[1].spot.aim.y) && res[0].spot.aim.y !== 0,
    'both aim the same way across the lane');
  ok(res.every((r) => r.spot.y > 10 || r.spot.y < 7), 'no spot sits inside the group it lights');

  // Each still aims at ITS OWN table, and stands close enough to light it.
  ok(near(res[0].spot.target.x, 7) && near(res[1].spot.target.x, 12),
    'each aims at its own table, not at the pair');
  ok(rectDistance({ x: res[0].spot.x, y: res[0].spot.y }, A) <= RUN_DEFAULTS.maxAimFt
     && rectDistance({ x: res[1].spot.x, y: res[1].spot.y }, B) <= RUN_DEFAULTS.maxAimFt,
    'and both are inside the cap');

  // Order changes nothing, which is what makes it a drawing rather than a roll.
  const rev = planTaskSpots([B, A], base);
  ok(near(rev[0].spot.x, res[1].spot.x) && near(rev[1].spot.x, res[0].spot.x),
    'and the order they were listed in changes nothing');
}

console.log('\n-- the spacing is the FURNITURE\'S, not a fixed pitch --');
{
  // Two tables well apart along the same line: their spots should be well
  // apart too, not bunched at some computed pitch about the group centre.
  const A = { x0: 2,  y0: 7, x1: 6,  y1: 10, type: 'coffee_table' };
  const B = { x0: 9,  y0: 7, x1: 13, y1: 10, type: 'coffee_table' };
  const res = planTaskSpots([A, B], base);
  ok(res.every((r) => r.spot?.run), 'still one run');
  const spread = Math.abs(res[0].spot.x - res[1].spot.x);
  ok(spread > 4, `the spots are ${spread.toFixed(1)} ft apart because the tables are`);
  ok(res[0].spot.x < res[1].spot.x, 'and they are in the same order as the tables');
}

console.log('\n-- WHAT IS NOT A RUN --');
{
  const A = { x0: 5,  y0: 7, x1: 9,  y1: 10, type: 'coffee_table' };

  // Untyped surfaces never group. The type is the only evidence there is, and
  // its absence is not a reason to guess — which is also why every test above
  // this section, all of which pass bare rectangles, is unaffected.
  ok(groupSurfaces([{ ...A, type: undefined }, { x0: 10, y0: 7, x1: 14, y1: 10 }])
       .every((g) => g.members.length === 1),
    'two untyped rectangles are two surfaces, not a run');

  // Different kinds of thing.
  const desk = { x0: 10, y0: 7, x1: 14, y1: 10, type: 'executive_desk' };
  ok(groupSurfaces([A, desk]).every((g) => g.members.length === 1),
    'a coffee table and a desk that line up perfectly are still two objects');

  // Aligned but nowhere near each other: the gap is wider than the smaller
  // one's own span, so they are two objects that happen to share a y.
  const far = { x0: 19, y0: 7, x1: 23, y1: 10, type: 'coffee_table' };
  ok(groupSurfaces([A, far]).every((g) => g.members.length === 1),
    `aligned but ${far.x0 - A.x1} ft apart is not adjacent`);

  // Adjacent but out of line by more than half the smaller short side.
  const skew = { x0: 10, y0: 10.5, x1: 14, y1: 13.5, type: 'coffee_table' };
  ok(groupSurfaces([A, skew]).every((g) => g.members.length === 1),
    'and adjacent but out of line is not a row');

  // A chain of three, and the chain BREAKING at the one wide gap.
  const t = (x0, x1) => ({ x0, y0: 7, x1, y1: 10, type: 'coffee_table' });
  const three = groupSurfaces([t(1, 4), t(5, 8), t(9, 12)]);
  ok(three.length === 1 && three[0].members.length === 3, 'three in a row is one run of three');
  const broken = groupSurfaces([t(1, 4), t(5, 8), t(20, 23)]);
  ok(broken.length === 2
     && broken.some((g) => g.members.length === 2)
     && broken.some((g) => g.members.length === 1),
    `a wide gap ends the chain: ${broken.map((g) => g.members.length).join('+')}`);
}

console.log('\n-- A RUN THAT CANNOT BE SERVED DISSOLVES --');
{
  // Every lane that could serve this pair is blocked, so they stop being peers
  // and go back to being two surfaces placed by the old rules. A tidy run that
  // lights nothing is worse than a scattered pair that does.
  const A = { x0: 5,  y0: 7, x1: 9,  y1: 10, type: 'coffee_table' };
  const B = { x0: 10, y0: 7, x1: 14, y1: 10, type: 'coffee_table' };
  // Both horizontal lanes struck out. Only lanes PARALLEL to the group can host
  // it, so with the rows gone there is nowhere for a run to stand — and the
  // columns are still there for the members individually.
  const deadRows = [{ x0: 0, y0: 11, x1: 24, y1: 13 }, { x0: 0, y0: 3, x1: 24, y1: 5 }];
  const res = planTaskSpots([A, B], { ...base, zones: deadRows });
  ok(res.every((r) => !r.spot?.run), 'no run survived the obstructions');
  ok(res.every((r) => r.spot), 'but both members were still placed by the old path');
  ok(res.some((r) => !near(res[0].spot.y, res[1].spot.y)) || res[0].spot.x !== res[1].spot.x,
    'independently, as two surfaces rather than a row');

  // The cap alone is enough to dissolve one: squeeze the band shut and no lane
  // is both far enough off the group and near enough to light it.
  const tight = planTaskSpots([A, B], { ...base, opt: { ...base.opt, maxAimFt: 1.6 } });
  ok(tight.every((r) => !r.spot?.run), 'and so is a cap nothing can meet');
}

console.log('\n-- THE LEDGER STANDS OUTSIDE A RUN --');
{
  // Two surfaces that are NOT peers, contending for one segment. Nothing about
  // runs may relax this: two spots six inches apart aiming at different things
  // is the bug the used-once rule exists for.
  const left  = { x0: 1.5, y0: 6.5, x1: 3.5, y1: 9.5, type: 'coffee_table' };
  const desk  = { x0: 4.5, y0: 6.5, x1: 6.5, y1: 9.5, type: 'executive_desk' };
  const both = planTaskSpots([left, desk], base);
  ok(both.every((r) => r.spot), 'both placed');
  ok(segmentKey(both[0].spot.segment) !== segmentKey(both[1].spot.segment),
    'and still on different segments');
  const gap = Math.hypot(both[0].spot.x - both[1].spot.x, both[0].spot.y - both[1].spot.y);
  ok(gap >= RUN_DEFAULTS.minSpotGap, `${gap.toFixed(2)} ft apart, over the floor`);
}

console.log('\n-- A RUN IS RANKED ON THE WHOLE RUN --');
{
  // A pair of coffee tables against one bigger dining table. Either table alone
  // is smaller than the dining table; together they are the bigger commitment
  // and take first pick.
  const a = { x0: 2, y0: 6.5, x1: 5, y1: 9.5, type: 'coffee_table' };
  const b = { x0: 6, y0: 6.5, x1: 9, y1: 9.5, type: 'coffee_table' };
  const dining = { x0: 14, y0: 5, x1: 20, y1: 11, type: 'dining_table' };
  const res = planTaskSpots([dining, a, b], base);
  ok(res.every((r) => r.spot), `all three placed: ${res.map((r) => r.rejected ?? 'ok').join(' / ')}`);
  ok(res[1].spot.run && res[2].spot.run && near(res[1].spot.y, res[2].spot.y),
    'the pair is still a run');
  ok(!res[0].spot.run, 'and the dining table is not in it');
}

console.log('\n-- A CHANDELIER\'D SURFACE DOES NOT VOTE ON THE LANE --');
{
  const A = { x0: 5,  y0: 7, x1: 9,  y1: 10, type: 'coffee_table' };
  const B = { x0: 10, y0: 7, x1: 14, y1: 10, type: 'coffee_table' };
  // Over A and clear of B — the 3 ft rule is measured from the body, so the
  // chandelier has to be genuinely out of B's reach for this to test anything.
  const res = planTaskSpots([A, B], { ...base, chandeliers: [{ x: 5.5, y: 8.5, r: 0.5 }] });
  ok(!res[0].spot && /chandelier/.test(res[0].skipped ?? ''), 'the lit one is skipped');
  ok(res[1].spot && !res[1].spot.run,
    'and the other is placed alone, not as a run of one');
}

console.log('\n-- THE PLAN THIS WAS BUILT FOR: two coffee tables, one sofa --');
{
  // Straight off the drawing, at 62 px per foot. Worth pinning exactly, because
  // it is the case that came back WRONG TWICE: once because the spots were
  // placed independently, and once because the run was refused the only lane
  // that could carry it.
  //
  // The ambient grid here is two columns by two rows, and the row that serves
  // the seating zone runs THROUGH the tables — which is where the downlights
  // for that zone went. The next row up is 6.4 ft off them, past the cap. So a
  // rule that a lane must stand clear of the group leaves this pair with no
  // lane at all.
  const F = (px) => +(px / 62).toFixed(3);
  const ch = { x0: F(428), y0: F(201), x1: F(1228), y1: F(1237),
               xLines: [F(428), F(828), F(1228)], yLines: [F(201), F(719), F(1237)] };
  const lts = [];
  [628, 1028].forEach((x) => [460, 978].forEach((y) =>
    lts.push({ id: `S${lts.length}`, x: F(x), y: F(y), kind: 'small' })));
  const poly = [{ x: F(390), y: F(195) }, { x: F(1270), y: F(195) },
                { x: F(1270), y: F(1245) }, { x: F(390), y: F(1245) }];
  const A = { x0: F(632), y0: F(855), x1: F(808), y1: F(1030), type: 'coffee_table' };
  const B = { x0: F(825), y0: F(855), x1: F(995), y1: F(1030), type: 'coffee_table' };
  const ctx = { chunks: [ch], lights: lts, polygon: poly, fixtures: [], zones: [],
                coves: [], opt: { fanClearance: 1.0 } };

  const res = planTaskSpots([A, B], ctx);
  ok(res.every((r) => r.spot?.run), `a run formed: ${res.map((r) => r.rejected ?? 'ok').join(' / ')}`);
  ok(near(res[0].spot.y, res[1].spot.y), `on one line: y=${res[0].spot.y.toFixed(2)}`);
  ok(near(res[0].spot.y, F(978), 0.01), 'and it is the row that runs through the tables');

  const gap = Math.hypot(res[0].spot.x - res[1].spot.x, res[0].spot.y - res[1].spot.y);
  ok(gap >= RUN_DEFAULTS.minSpotGap, `${(gap * 12).toFixed(0)} in apart, over the six-inch floor`);
  ok(gap < 2, 'and TOGETHER — a pair in the gap between the tables, which is the detail asked for');
  ok(res[0].spot.x < res[1].spot.x, 'in the same order as the tables');

  // Each still points at its own table and stands close enough to light it.
  ok(near(res[0].spot.target.x, (A.x0 + A.x1) / 2) && near(res[1].spot.target.x, (B.x0 + B.x1) / 2),
    'each aims at its own table');
  ok(rectDistance({ x: res[0].spot.x, y: res[0].spot.y }, A) <= RUN_DEFAULTS.maxAimFt
     && rectDistance({ x: res[1].spot.x, y: res[1].spot.y }, B) <= RUN_DEFAULTS.maxAimFt,
    'and both are well inside the cap');

  // THE OLD ANSWER, for the record: placed independently they went to two
  // different lines — one on the row, one halfway up a column.
  // Strip the types and nothing groups, which is the behaviour this file had
  // before runs existed: the ledger sends the second table off the row it
  // wanted and onto a column, half the room away from its neighbour.
  const solo = planTaskSpots([{ ...A, type: undefined }, { ...B, type: undefined }], ctx);
  ok(solo.every((r) => r.spot) && !near(solo[0].spot.y, solo[1].spot.y),
    `ungrouped they land on two different lines: y=${solo[0].spot.y.toFixed(2)}`
    + ` and y=${solo[1].spot.y.toFixed(2)} — which is the drawing that started this`);
  const soloGap = Math.hypot(solo[0].spot.x - solo[1].spot.x, solo[0].spot.y - solo[1].spot.y);
  ok(soloGap > gap * 3, `and ${soloGap.toFixed(1)} ft apart instead of ${gap.toFixed(1)}`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
