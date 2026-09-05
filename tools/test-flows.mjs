// ---------------------------------------------------------------------------
// test-flows.mjs — the fittings, looped, and the plate each loop runs off.
//
// THE ROOMS ARE LAID OUT BY THE REAL PLANNER rather than by hand-written
// fixtures, and that is deliberate: the whole claim of flows.js is that a row is
// already on the drawing and nothing is invented, so a test that invented its
// own rows would be testing a different module. planLights runs, its answer is
// converted to plan pixels the way App.jsx converts it, and the flows are
// checked against the grid it actually produced.
//
// 30.48 px/ft throughout, so a foot is 30.48px and the millimetres in
// electrical.js come out round — the same scale test-electrical.mjs uses.
//
//   node tools/test-flows.mjs
// ---------------------------------------------------------------------------

import { planLights } from '../src/lib/planner.js';
import { planFlows, loopPath, loopLegs, pathOf, cluster, flowSummary, FLOW_DEFAULTS }
  from '../src/lib/flows.js';
import { COUNTRIES, pointsFromFlows } from '../src/lib/switchboards.js';
import { planSwitchboards, planChunkBoards, bayWalls, wallRuns, asDrawn,
         px, SB_MM, servesBay, CHUNK_BOARD } from '../src/lib/electrical.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const PPF = 30.48;
const toPx = (p) => ({ x: p.x * PPF, y: p.y * PPF });
const rp = (c) => ({ ...c, x0: c.x0 * PPF, x1: c.x1 * PPF, y0: c.y0 * PPF, y1: c.y1 * PPF });

/** One room, laid out and converted, ready to hand to planFlows. */
function lay(polygonFt, { fixtures = [], zones = [] } = {}) {
  const res = planLights(polygonFt, fixtures, {}, zones);
  if (!res.ok) throw new Error('the layout failed: ' + res.reason);
  const b = { x0: Math.min(...polygonFt.map((p) => p.x)), y0: Math.min(...polygonFt.map((p) => p.y)),
              x1: Math.max(...polygonFt.map((p) => p.x)), y1: Math.max(...polygonFt.map((p) => p.y)) };
  return {
    res,
    room: { id: 'r1', polygonPx: polygonFt.map(toPx) },
    bays: [{ key: 'room', rect: rp(b) }],
    chunks: res.chunks.map((ch) => ({ ...rp(ch),
      xLines: ch.xLines.map((v) => v * PPF), yLines: ch.yLines.map((v) => v * PPF) })),
    cells: res.cells.map(rp),
    lights: res.lights.map((l) => ({ ...l, ...toPx(l) })),
  };
}

/** ...with a plate on a wall, so the loops have somewhere to run back to. */
function wire(g, extra = {}) {
  const cb = planChunkBoards({ room: g.room, bays: g.bays,
                               boards: extra.boards ?? [], pxPerFt: PPF });
  return planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: [...(extra.boards ?? []), ...cb.boards], owner: cb.owner, pxPerFt: PPF,
    ...extra,
  });
}

const ft = (v) => v / PPF;
const at = (n) => `(${ft(n.x).toFixed(1)},${ft(n.y).toFixed(1)})`;

console.log('-- a long room is rows down its length --');
{
  // 30 x 12 ft. The planner comes out 4 columns by 2 rows, so the rows run the
  // LONG way (x) and there are two of them, of four lamps each. Cut it the
  // other way and it would be four switches of two, in bands across the room.
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const ch = g.res.chunks[0];
  ok(g.res.chunks.length === 1 && ch.xLines.length === 5 && ch.yLines.length === 3,
    'the planner lays 4 columns x 2 rows on a 30x12 room');

  const { flows } = wire(g);
  const rows = flows.filter((f) => f.kind === 'row');
  ok(rows.length === 2, `two rows, so two flows (got ${rows.length})`);
  ok(rows.every((f) => f.count === 4), 'four lamps on each');
  ok(rows.every((f) => new Set(f.nodes.map((n) => n.y.toFixed(3))).size === 1),
    'and every lamp on one flow shares a y — the row runs along the length');
  ok(rows[0].nodes.every((n, i, a) => i === 0 || n.x >= a[i - 1].x)
    || rows[0].nodes.every((n, i, a) => i === 0 || n.x <= a[i - 1].x),
    'the loop walks the row in order rather than jumping about');
  ok(rows[0].label === 'Row 1' && rows[1].label === 'Row 2', 'and they are numbered');
}

console.log('\n-- one row is not called "Row 1 of 1" --');
{
  // 12 x 10 ft: one chunk, one row of two.
  const g = lay([{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }]);
  const { flows } = wire(g);
  const rows = flows.filter((f) => f.kind === 'row');
  ok(rows.length === 1 && rows[0].label === 'Downlights',
    `a single row is just the downlights (got ${rows.map((f) => f.label).join()})`);
}

console.log('\n-- the loop comes in at the end nearest its board --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  // A plate hard against the left end of the top wall, well past the middle, so
  // there is no tie to break.
  const board = {
    id: 'b-left', roomId: 'r1', role: 'door', servesShort: 'Door',
    point: { x: 20, y: 0 }, wall: { index: 0 },
    along: { x: 1, y: 0 }, inward: { x: 0, y: 1 }, alongPx: 23, deepPx: 8,
  };
  const { flows } = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: [board], owner: new Map([['room', 'b-left']]), pxPerFt: PPF,
  });
  const rows = flows.filter((f) => f.kind === 'row');
  ok(rows.every((f) => f.nodes[0].x < f.nodes[f.nodes.length - 1].x),
    'a board on the left end puts the first node on the left');
  ok(rows.every((f) => f.boardLabel === 'Door'), 'and the flow names the plate it runs off');

  const right = { ...board, id: 'b-right', point: { x: 580, y: 0 } };
  const { flows: f2 } = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: [right], owner: new Map([['room', 'b-right']]), pxPerFt: PPF,
  });
  ok(f2.filter((f) => f.kind === 'row')
    .every((f) => f.nodes[0].x > f.nodes[f.nodes.length - 1].x),
    '...and moving it to the right end turns every loop round');
}

console.log('\n-- the bedroom: either side of the bed, then its foot --');
{
  // 14 x 24 ft with a 6x7 bed, head against the top wall and centred, so there
  // is a band each side of it and a deep region past its foot.
  const bed = { id: 'bed', cls: 'bed', x0: 4, y0: 0, x1: 10, y1: 7 };
  const g = lay([{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 24 }, { x: 0, y: 24 }],
                { zones: [bed] });
  const { flows } = wire(g, { zones: [rp(bed)] });

  const sides = flows.find((f) => f.kind === 'bedsides');
  ok(!!sides && sides.count === 2, `the two bands beside the bed are ONE flow (got ${sides?.count})`);
  ok(!!sides && sides.nodes.every((n) => ft(n.y) < 7),
    'and both of its lamps are alongside the bed, not past it');
  ok(!!sides && new Set(sides.nodes.map((n) => n.x > g.room.polygonPx[1].x / 2)).size === 2,
    '...one on each side of it');

  const foot = flows.find((f) => f.kind === 'bedfoot');
  ok(!!foot && foot.count === 3, `the row past the foot is its own flow (got ${foot?.count})`);
  ok(!!foot && new Set(foot.nodes.map((n) => n.y.toFixed(3))).size === 1,
    'and it is one row — every lamp on the same line');
  const footY = ft(foot.nodes[0].y);
  ok(footY > 7 && footY < 16, `immediately past the bed and not across the room (y=${footY.toFixed(1)})`);

  // THE REST OF THE ROOM IS ROWS, and the rows run parallel to the foot of the
  // bed — NOT along the foot region's own long axis, which on a 14x17 remainder
  // would say "down the room" and give three switches of one lamp each.
  const rest = flows.filter((f) => f.kind === 'row');
  ok(rest.length === 1 && rest[0].count === 3,
    `the rest of the room is one further row of three (got ${rest.map((f) => f.count).join()})`);
  ok(rest.every((f) => new Set(f.nodes.map((n) => n.y.toFixed(3))).size === 1),
    'and it too runs parallel to the foot of the bed');
  ok(flows.filter((f) => f.kind === 'row' || f.kind === 'bedfoot' || f.kind === 'bedsides')
    .reduce((t, f) => t + f.count, 0) === g.lights.length,
    'every lamp in the room is on exactly one flow');
}

console.log('\n-- a room with no bed is not given the bedroom treatment --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 24 }, { x: 0, y: 24 }]);
  const { flows } = wire(g, { zones: [{ id: 'z', cls: 'beam', x0: 0, y0: 0, x1: 1, y1: 1 }] });
  ok(!flows.some((f) => f.kind === 'bedsides' || f.kind === 'bedfoot'),
    'a rectangle with a hole in it has no bedsides and no foot');
  ok(flows.every((f) => f.kind === 'row'), 'just rows');
}

console.log('\n-- everything that is not a row is its own flow --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const P = (x, y) => ({ x: x * PPF, y: y * PPF });

  const { flows } = wire(g, {
    // TWO TRACKS, so two switches. The second one was put there to be a
    // different light.
    tracks: [
      { key: 'room', id: 't1', label: 'Magnetic track', short: 'Track',
        lengthFt: 8, runs: [{ a: P(2, 2), b: P(10, 2) }] },
      { key: 'room', id: 't2', label: 'Magnetic track', short: 'Track',
        lengthFt: 8, runs: [{ a: P(20, 10), b: P(28, 10) }] },
    ],
    accents: [
      { id: 'cove-r1-room', type: 'strip', kind: 'cove', roomId: 'r1', label: 'Cove LED strip',
        loop: [P(1, 1), P(29, 1), P(29, 11), P(1, 11)] },
      { id: 'rcove-1', type: 'strip', kind: 'reverse-cove', roomId: 'r1',
        label: 'Reverse cove', run: [P(4, 0.5), P(12, 0.5)] },
      { id: 'sc-l', type: 'sconce', group: 'bedside', roomId: 'r1',
        point: P(1, 4), what: 'left of the bed' },
      { id: 'sc-r', type: 'sconce', group: 'bedside', roomId: 'r1',
        point: P(1, 8), what: 'right of the bed' },
    ],
    objects: [
      { id: 'fan1', kind: 'fan', ...P(15, 6) },
      { id: 'trap1', kind: 'trapdoor', ...P(28, 1) },
      { id: 'ac1', kind: 'ac', ...P(28, 11) },
    ],
    spots: [
      // A pair over one table: within reach, so one flow.
      { id: 's1', roomId: 'r1', ...P(6, 6) },
      { id: 's2', roomId: 'r1', ...P(7, 6) },
      // ...and one at the far end, which is a different thing being lit.
      { id: 's3', roomId: 'r1', ...P(26, 6) },
    ],
  });

  const kinds = (k) => flows.filter((f) => f.kind === k);
  ok(kinds('track').length === 2, `two tracks are two flows (got ${kinds('track').length})`);
  ok(kinds('track').every((f) => f.count === 1),
    'and each is ONE node — the lamps are fed by the profile, not looped to it');
  ok(kinds('cove').length === 1 && kinds('cove')[0].count === 1, 'a cove is one flow');
  ok(kinds('reverse-cove').length === 1, 'a reverse cove is another');
  ok(kinds('bedside').length === 2 && kinds('bedside').every((f) => f.count === 1),
    `each bedside sconce is its own flow (got ${kinds('bedside').length})`);
  ok(kinds('object').length === 1 && kinds('object')[0].label === 'Fan',
    `the fan is switched on its own (got ${kinds('object').map((f) => f.label).join()})`);
  ok(!flows.some((f) => f.objectId === 'trap1'), 'a trap door is not wired');
  ok(!flows.some((f) => f.objectId === 'ac1'), 'and an AC cassette is not wired from here');
  const spots = kinds('spots');
  ok(spots.length === 2, `spots group by proximity, not by grid (got ${spots.length} groups)`);
  ok(spots.some((f) => f.count === 2) && spots.some((f) => f.count === 1),
    'the pair over the table is one flow and the far one is another');

  // THE COVE IS FED AT THE CORNER NEAREST ITS BOARD, not at corner zero.
  const cove = kinds('cove')[0];
  const board = cove.from;
  const corners = [P(1, 1), P(29, 1), P(29, 11), P(1, 11)];
  const best = corners.reduce((a, b) =>
    (Math.hypot(b.x - board.x, b.y - board.y) < Math.hypot(a.x - board.x, a.y - board.y) ? b : a));
  ok(near(cove.nodes[0].x, best.x, 1e-6) && near(cove.nodes[0].y, best.y, 1e-6),
    'the tape is fed at the corner nearest the plate');
}

console.log('\n-- the bedsides, and the plate under each of them --');
{
  // A 14x18 bedroom: bed against the top wall, a sconce on each side wall, and
  // the door in the LEFT wall down at the far end — so one bedside plate is
  // near the main board and one is a long way from it.
  const W = 18, H = 18;
  const bed = { id: 'bed', cls: 'bed', x0: 6, y0: 0, x1: 12, y1: 7 };
  const polyFt = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const room = { id: 'r1', polygonPx: polyFt.map(toPx) };
  const leaf = px(900, PPF);
  const doors = [{ id: 'd1', cls: 'door', conf: 0.99,
                   rect: { x0: -18, y0: 14 * PPF, x1: leaf, y1: 14 * PPF + leaf } }];
  const sconce = (id, xFt, what, wall, inward) => ({
    id, type: 'sconce', group: 'bedside', roomId: 'r1', what,
    point: toPx({ x: xFt, y: 3 }), along: { x: 0, y: 1 },
    inward, wall: { index: wall }, t: 3 * PPF,
  });
  const sconces = [
    sconce('sc-L', 0, 'left of the bed', 3, { x: 1, y: 0 }),
    sconce('sc-R', W, 'right of the bed', 1, { x: -1, y: 0 }),
  ];

  // BOTH FREE RULES, no vision call: the door plate and one plate per sconce.
  const sb = planSwitchboards({ room, rooms: [room], doors, roomTypes: {},
                                accentZones: sconces, pxPerFt: PPF,
                                rules: ['door', 'bedside'] });
  const live = sb.boards.filter((b) => !b.rejected && b.point);
  const beds = live.filter((b) => b.role === 'bedside');
  ok(beds.length === 2, `two bedside plates, one per sconce (got ${beds.length})`);
  ok(beds.every((b) => sconces.some((c) => c.id === b.fromId)),
    'each names the sconce it was placed for');
  // "BELOW THE SCONCE" IS THE SCONCE'S OWN PLAN POINT. A plan is a view from
  // above: a switch at 1200mm and a sconce at 1600mm on one wall are the same
  // point here and stacked in the room. An offset would move it ALONG the wall,
  // which is not below anything.
  ok(beds.every((b) => {
    const c = sconces.find((z) => z.id === b.fromId);
    return near(b.point.x, c.point.x, 1e-6) && near(b.point.y, c.point.y, 1e-6);
  }), 'and stands at that sconce\'s own point — below it on the wall');

  const main = live.find((b) => b.role === 'door');
  ok(!!main, 'the door plate is there too');
  ok(!servesBay(beds[0]) && servesBay(main),
    'a bedside plate cannot be a bay\'s switch; the door plate can');

  // THE BAY MUST ADOPT THE DOOR PLATE AND NOT A BEDSIDE ONE. This is the bug
  // this section exists for: a bedside plate is often on a longer wall and
  // nearer most of the floor, so a bay adopting "the board on my biggest wall"
  // switched the whole room's downlights from the head of the bed.
  const bays = [{ key: 'room', rect: rp({ x0: 0, y0: 0, x1: W, y1: H }) }];
  const cb = planChunkBoards({ room, bays, boards: live, pxPerFt: PPF });
  ok(cb.boards.length === 0, 'no bay plate is needed');
  ok(cb.owner.get('room') === main.id,
    'the bay adopts the DOOR plate, not a bedside one');

  const res = planLights(polyFt, [{ type: 'fan', kind: 'fan', x: 9, y: 13, r: 2 }],
                         {}, [bed]);
  const { flows } = planFlows({
    room, bays,
    chunks: res.chunks.map((ch) => ({ ...rp(ch),
      xLines: ch.xLines.map((v) => v * PPF), yLines: ch.yLines.map((v) => v * PPF) })),
    cells: res.cells.map(rp), lights: res.lights.map((l) => ({ ...l, ...toPx(l) })),
    zones: [rp(bed)], accents: sconces,
    objects: [{ id: 'fan1', kind: 'fan', ...toPx({ x: 9, y: 13 }) }],
    boards: live, owner: cb.owner, pxPerFt: PPF,
  });

  // ONE FLOW PER SCONCE, EACH ON ITS OWN PLATE.
  const bs = flows.filter((f) => f.kind === 'bedside');
  ok(bs.length === 2 && bs.every((f) => f.count === 1),
    `one flow per bedside sconce (got ${bs.length})`);
  ok(bs.every((f) => {
    const b = beds.find((x) => x.id === f.boardId);
    return b && b.fromId === f.nodes[0].id;
  }), 'and each runs off the plate placed for that very sconce');

  // A SCONCE AND ITS OWN PLATE ARE ONE POINT IN PLAN, so the loop between them
  // has no length and paints nothing. The flow is still the switch it is.
  ok(bs.every((f) => f.coincident), 'each says it has no wire to draw');
  ok(bs.every((f) => !/Q/.test(f.path)), 'and its path carries no leg');
  ok(flowSummary(flows).flows === flows.length,
    '...but it is counted as a switch all the same');

  // NOTHING ELSE RUNS OFF A BEDSIDE PLATE.
  const ambient = flows.filter((f) => f.kind !== 'bedside');
  ok(ambient.length > 0 && ambient.every((f) => f.boardId === main.id),
    'every other flow in the room is switched from the door plate');

  // THE FAN: ON THE MAIN BOARD, AND REACHED FROM THE FAR BEDSIDE TOO.
  const fan = flows.find((f) => f.kind === 'object');
  ok(!!fan && fan.boardId === main.id, 'the fan\'s own switch is on the main board');
  ok(!!fan.also, 'and it has a second point');
  const far = beds.reduce((a, b) =>
    (Math.hypot(b.point.x - main.point.x, b.point.y - main.point.y)
     > Math.hypot(a.point.x - main.point.x, a.point.y - main.point.y) ? b : a));
  ok(fan.also.boardId === far.id,
    'on the bedside plate FARTHER from the main board — the near one duplicates'
    + ' reach the room already has');
  ok(fan.also.path.startsWith('M') && !fan.also.path.includes('NaN'),
    'and that second leg draws');
  ok(flowSummary(flows).flows === flows.length,
    'two-way switching is one switch, not two — `also` is a field, not a flow');

  // A CHANDELIER IS NOT TWO-WAY SWITCHED FROM A BED. Nobody lies down and
  // reaches for the chandelier; the rule is about the fan.
  const { flows: f2 } = planFlows({
    room, bays,
    chunks: res.chunks.map((ch) => ({ ...rp(ch),
      xLines: ch.xLines.map((v) => v * PPF), yLines: ch.yLines.map((v) => v * PPF) })),
    cells: res.cells.map(rp), lights: res.lights.map((l) => ({ ...l, ...toPx(l) })),
    zones: [rp(bed)], accents: sconces,
    objects: [{ id: 'ch1', kind: 'chandelier', ...toPx({ x: 9, y: 13 }) }],
    boards: live, owner: cb.owner, pxPerFt: PPF,
  });
  ok(!f2.find((f) => f.kind === 'object').also, 'a chandelier gets one point');
}

console.log('\n-- a bay plate steps clear of a dedicated one --');
{
  const ROOM = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 360 }, { x: 0, y: 360 }];
  const room = { id: 'r1', polygonPx: ROOM };
  const along = px(SB_MM.along, PPF);
  // A bedside plate dead centre on the top wall — exactly where a bay plate
  // would want to go — and no door plate anywhere.
  const bedside = { id: 'bs', roomId: 'r1', role: 'bedside', fromId: 'sc',
    servesShort: 'Bedside', point: { x: 300, y: 0 },
    wall: { a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, index: 0 },
    along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
    alongPx: along, deepPx: px(SB_MM.deep, PPF) };
  const out = planChunkBoards({ room, boards: [bedside], pxPerFt: PPF,
    bays: [{ key: 'all', rect: { x0: 0, y0: 0, x1: 600, y1: 360 } }] });
  ok(out.boards.length === 1, 'the bay gets a plate of its own rather than the bedside');
  ok(out.owner.get('all') === out.boards[0].id, 'and it owns that one');
  const gap = Math.hypot(out.boards[0].point.x - 300, out.boards[0].point.y);
  ok(gap >= CHUNK_BOARD.gangPlates * along - 1e-6,
    `stepped clear along the wall (${(gap / along).toFixed(2)} plate widths,`
    + ` needs ${CHUNK_BOARD.gangPlates})`);
  ok(out.notes.length === 0, 'and it did not have to say anything about it');
}

console.log('\n-- a track owns the lamps it absorbed --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  // Two of the eight lamps pulled onto a profile, the way ceilingDesign stamps
  // them. They must leave the rows and be counted on the track instead.
  const lights = g.lights.map((l, i) => (i < 2 ? { ...l, track: 'room' } : l));
  const cb = planChunkBoards({ room: g.room, bays: g.bays, boards: [], pxPerFt: PPF });
  const { flows } = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights,
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF,
    tracks: [{ key: 'room', id: 't1', label: 'Magnetic track', short: 'Track',
               runs: [{ a: { x: 60, y: 90 }, b: { x: 360, y: 90 } }] }],
  });
  const track = flows.find((f) => f.kind === 'track');
  ok(track.absorbed === 2, `the profile carries its two modules (got ${track.absorbed})`);
  ok(flows.filter((f) => f.kind === 'row').reduce((t, f) => t + f.count, 0) === 6,
    'and those two are gone from the rows — six lamps left, not eight');
}

console.log('\n-- a directional spot on a track is NOT lit individually --');
{
  /* THE INVARIANT: one run of track, one connection to the switchboard, exactly.
     A magnetic profile is a busbar — fed once, at one end, everything clipped
     into it live from that feed — so a second wire to a head halfway along it is
     not a second circuit, it is a wire that cannot be installed.

     THE BUG THIS PINS. Section 1 of flows.js used to gather only the absorbed
     DOWNLIGHTS, and the directional spots fell through to section 5, which gave
     each of them a loop of its own. A track with two task heads on it came out
     with THREE connections and two arcs drawn from the middle of a rail nobody
     can tap. */
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const cb = planChunkBoards({ room: g.room, bays: g.bays, boards: [], pxPerFt: PPF });
  const TRACK = [{ key: 'room', id: 't1', label: 'Magnetic track', short: 'Track',
                   runs: [{ a: { x: 60, y: 90 }, b: { x: 360, y: 90 } }] }];
  // Two heads absorbed onto the profile — `track` is the stamp App.jsx puts on a
  // spot absorbPoints took — and one left recessed out on its own.
  const spots = [
    { id: 's1', x: 120, y: 90, track: 'room', target: { x: 120, y: 200 } },
    { id: 's2', x: 240, y: 90, track: 'room', target: { x: 240, y: 200 } },
    { id: 's3', x: 500, y: 300, target: { x: 500, y: 360 } },
  ];
  const { flows } = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF, tracks: TRACK, spots,
  });

  const track = flows.filter((f) => f.kind === 'track');
  ok(track.length === 1, `one run of track, one flow (got ${track.length})`);
  ok(track[0].boardId, 'and it does reach a switchboard');
  ok(track[0].absorbed === 2 && track[0].heads === 2,
    `both heads are counted as modules on the profile (got ${track[0].absorbed}/${track[0].heads})`);

  const spotFlows = flows.filter((f) => f.kind === 'spots');
  const wired = spotFlows.flatMap((f) => f.nodes.map((n) => n.id));
  ok(!wired.includes('s1') && !wired.includes('s2'),
    `neither head is on a loop of its own (got ${wired.join(', ') || 'none'})`);
  ok(wired.includes('s3'),
    'while the spot that is NOT on the track still gets its own connection');

  // ...AND EXACTLY ONE WIRE REACHES THE RAIL. Counted from the flows rather than
  // asserted about them: this is the sentence the feature is. `trackId` is on
  // the flow itself — `add` spreads `extra` — and it names the ENTRY, so one
  // piece of an open track is one row here.
  const toTrack = flows.filter((f) => f.trackId === 't1');
  ok(toTrack.length === 1,
    `exactly one connection lands on the profile (got ${toTrack.length})`);

  // A REFUSED HEAD IS NOT A MODULE. It is not on the ceiling at all, so counting
  // it on the profile would overstate what was bought.
  const withRefused = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF, tracks: TRACK,
    spots: [...spots, { id: 's4', x: 300, y: 90, track: 'room', rejected: 'no surface' }],
  }).flows.find((f) => f.kind === 'track');
  ok(withRefused.heads === 2, `a refused head is not counted (got ${withRefused.heads})`);

  // A TRACK WITH NO ENDS PRODUCES NO FLOW, so a spot stamped for it must not be
  // excluded on the strength of that stamp — a fitting with NO connection is a
  // worse answer than the extra one this whole section removes.
  const orphan = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF,
    tracks: [{ key: 'room', id: 't0', label: 'Magnetic track', runs: [] }],
    spots: [{ id: 's1', x: 120, y: 90, track: 'room', target: { x: 120, y: 200 } }],
  }).flows;
  ok(orphan.some((f) => f.nodes.some((n) => n.id === 's1')),
    'a head whose profile produced no flow keeps its own connection');
}

console.log('\n-- left + right is TWO rails, and both get a connection --');
{
  /* THE BUG, REPORTED OFF A DRAWING: the right-hand rail had a wire and the
     left-hand one had nothing.

     `Track · left + right` is ONE entry in `tracks` carrying TWO runs, and they
     are two separate parallel rails — see TRACK_ARRANGEMENTS, where it is
     `closed: false`. The old loop ran once per ENTRY, so it drew one wire to
     whichever rail was nearer the board and left the other connected to nothing.

     track.js had already decided this and boq.js had already billed it: `pieces`
     is `closed ? 1 : runs.length`, described there as "two tracks with two sets
     of end caps and two feeds". The drawing was the only thing still saying one. */
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const cb = planChunkBoards({ room: g.room, bays: g.bays, boards: [], pxPerFt: PPF });
  const LR = [{
    key: 'room', id: 't1', label: 'Track · left + right', short: '02 SIDES',
    closed: false,
    runs: [{ a: { x: 120, y: 60 }, b: { x: 120, y: 300 }, side: 'left', axis: 'y' },
           { a: { x: 780, y: 60 }, b: { x: 780, y: 300 }, side: 'right', axis: 'y' }],
  }];
  // Two lamps on the left rail, one on the right, stamped the way ceilingDesign
  // does it — `track` plus the index of the run that took them.
  const lights = g.lights.map((l, i) => (
    i < 2 ? { ...l, track: 'room', trackRun: 0 }
      : i === 2 ? { ...l, track: 'room', trackRun: 1 } : l));
  const { flows } = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights,
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF, tracks: LR,
  });

  const track = flows.filter((f) => f.kind === 'track');
  ok(track.length === 2, `two rails, two flows (got ${track.length})`);
  ok(track.every((f) => f.boardId),
    'and BOTH reach a switchboard — this is the reported failure');
  const sides = track.map((f) => f.side).sort();
  ok(sides.join() === 'left,right', `one per side (got ${sides.join()})`);

  // EACH FEED IS ON ITS OWN RAIL, not both on the nearer one.
  const left = track.find((f) => f.side === 'left');
  const right = track.find((f) => f.side === 'right');
  ok(near(left.nodes[0].x, 120) && near(right.nodes[0].x, 780),
    `each feed sits on its own profile (got ${left.nodes[0].x} and ${right.nodes[0].x})`);
  ok(left.nodes[0].id !== right.nodes[0].id, 'and the two nodes are told apart');

  // THE MODULES GO WITH THE RAIL THAT TOOK THEM.
  ok(left.absorbed === 2 && right.absorbed === 1,
    `modules follow their own run index (got ${left.absorbed} and ${right.absorbed})`);
  ok(flows.filter((f) => f.kind === 'row').reduce((t, f) => t + f.count, 0)
    === g.lights.length - 3,
    'and all three are gone from the ambient rows');

  // A CLOSED CIRCUIT IS STILL ONE RAIL, FED ONCE. Four runs joined at their
  // corners are cut and jointed on site; a second feed into one would be a
  // second wire into the same busbar.
  const four = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF,
    tracks: [{ key: 'room', id: 't4', label: 'Track · 4 sides', closed: true,
               runs: [
                 { a: { x: 120, y: 60 }, b: { x: 780, y: 60 }, side: 'top' },
                 { a: { x: 780, y: 60 }, b: { x: 780, y: 300 }, side: 'right' },
                 { a: { x: 780, y: 300 }, b: { x: 120, y: 300 }, side: 'bottom' },
                 { a: { x: 120, y: 300 }, b: { x: 120, y: 60 }, side: 'left' }] }],
  }).flows.filter((f) => f.kind === 'track');
  ok(four.length === 1, `a four-sided circuit is one feed (got ${four.length})`);

  // A MODULE NAMING A RUN THIS TRACK NO LONGER HAS FALLS TO THE FIRST RAIL. It
  // must not fall to NONE: a module on no piece leaves `onTrack`, rejoins the
  // ambient rows, and is drawn as a recessed downlight sitting on a rail.
  const stray = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells,
    lights: g.lights.map((l, i) => (i === 0 ? { ...l, track: 'room', trackRun: 7 } : l)),
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF, tracks: LR,
  }).flows;
  ok(stray.filter((f) => f.kind === 'track').reduce((n, f) => n + f.absorbed, 0) === 1,
    'a module with an out-of-range run index is still on a rail');
  ok(stray.filter((f) => f.kind === 'row').reduce((t, f) => t + f.count, 0)
    === g.lights.length - 1,
    'and is not also counted in the rows');
}

console.log('\n-- a chunk whose stamp matches no bay is not silently unswitched --');
{
  // A planner chunk carries `design`: the key of the design chunk it came out
  // of. Where that key names no bay in the list — a design pass that declined
  // half way, a bay list from elsewhere — the chunk used to match nothing, and
  // its lamps appeared on NO flow at all. On a drawing whose only job is to say
  // what is switched from where, that is the worst available answer.
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const strays = g.chunks.map((ch) => ({ ...ch, design: 'a-key-no-bay-has' }));
  const cb = planChunkBoards({ room: g.room, bays: g.bays, boards: [], pxPerFt: PPF });
  const { flows } = planFlows({
    room: g.room, bays: g.bays, chunks: strays, cells: g.cells, lights: g.lights,
    boards: cb.boards, owner: cb.owner, pxPerFt: PPF,
  });
  ok(flows.reduce((t, f) => t + f.count, 0) === g.lights.length,
    `every lamp is still on a flow (got ${flows.reduce((t, f) => t + f.count, 0)}`
    + ` of ${g.lights.length})`);
  ok(flows.every((f) => f.bayKey === 'room'),
    'they fall back to the bay their chunk actually sits in');
}

console.log('\n-- the plate: adopted where there is one, placed where there is not --');
{
  const ROOM = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 360 }, { x: 0, y: 360 }];
  const room = { id: 'r1', polygonPx: ROOM };
  const doors = [{ id: 'd1', cls: 'door', conf: 0.99,
                   rect: { x0: 60, y0: -18, x1: 150, y1: 90 } }];
  const sb = planSwitchboards({ room, rooms: [room], doors, pxPerFt: PPF });
  const found = sb.boards.filter((b) => !b.rejected);
  ok(found.length === 1 && found[0].role === 'door', 'the door pass puts one plate beside the door');

  // ONE BAY WITH THAT DOOR IN IT: no second plate. This is the case that makes
  // the rule liveable — every plain bedroom is this case.
  const one = planChunkBoards({ room, bays: [{ key: 'all', rect: { x0: 0, y0: 0, x1: 600, y1: 360 } }],
                                boards: sb.boards, pxPerFt: PPF });
  ok(one.boards.length === 0, 'a bay whose own wall already carries a plate gets no new one');
  ok(one.owner.get('all') === found[0].id, '...it adopts the door board');

  // TWO BAYS: the far one has no board on any of its walls, so it gets one.
  const two = planChunkBoards({ room, boards: sb.boards, pxPerFt: PPF, bays: [
    { key: 'L', rect: { x0: 0, y0: 0, x1: 300, y1: 360 } },
    { key: 'R', rect: { x0: 300, y0: 0, x1: 600, y1: 360 } }] });
  ok(two.boards.length === 1 && two.boards[0].bayKey === 'R',
    `one new plate, on the bay that had none (got ${two.boards.map((b) => b.bayKey).join()})`);
  ok(two.owner.get('L') === found[0].id, 'the door\'s bay still adopts the door board');
  ok(two.boards[0].role === 'bay' && two.boards[0].servesShort === 'Bay',
    'and the new one knows what it is');

  // UNDER 25 SQFT: a nook borrows rather than getting a plate of its own.
  const small = planChunkBoards({ room, boards: sb.boards, pxPerFt: PPF, bays: [
    { key: 'big', rect: { x0: 0, y0: 0, x1: 600, y1: 240 } },
    // 4 x 4 ft = 16 sqft.
    { key: 'nook', rect: { x0: 0, y0: 240, x1: 4 * PPF, y1: 240 + 4 * PPF } }] });
  ok(small.boards.length === 0, 'a 16 sqft nook gets no plate of its own');
  ok(small.owner.get('nook') === found[0].id, '...it runs off the nearest one');

  // ...and just over it does. 6 x 6 ft = 36 sqft, in a corner with no board.
  const justOver = planChunkBoards({ room, boards: sb.boards, pxPerFt: PPF, bays: [
    { key: 'big', rect: { x0: 0, y0: 0, x1: 600, y1: 200 } },
    { key: 'bay', rect: { x0: 600 - 6 * PPF, y0: 360 - 6 * PPF, x1: 600, y1: 360 } }] });
  ok(justOver.boards.length === 1, 'a 36 sqft bay in a corner of its own does');

  // NO SCALE, NO PLATE. 300mm is not a distance without one.
  const none = planChunkBoards({ room, bays: [{ key: 'all', rect: { x0: 0, y0: 0, x1: 600, y1: 360 } }],
                                 boards: [], pxPerFt: null });
  ok(none.boards.length === 0 && none.notes.length === 1,
    'without a scale it refuses and says so');
}

console.log('\n-- the door decides, with no pass and no vision call --');
{
  // THIS IS THE PATH THE DRAWING ACTUALLY TAKES. planSwitchboards' three rules
  // need three different things: the door rule needs only the door boxes the
  // scale pass already found, while the bedside and TV rules need fittings the
  // accent pass places. So it is called with no accents and no TV — rules 2 and
  // 3 then contribute notes and no geometry, and rule 1 answers in full.
  const W = 16, H = 11;                      // ft
  const polyFt = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const room = { id: 'r1', polygonPx: polyFt.map(toPx) };
  const leaf = px(900, PPF);                 // a 900mm opening, 90px at this scale
  const gap = px(SB_MM.fromDoor, PPF);       // 300mm, 30px
  const half = px(SB_MM.along, PPF) / 2;     // a 230mm plate, 11.5px

  /** A 900mm door in the top wall, its near jamb `atFt` in from the left. */
  const inTopWall = (atFt) => [{ id: 'd', cls: 'door', conf: 0.99,
    rect: { x0: atFt * PPF, y0: -18, x1: atFt * PPF + leaf, y1: leaf } }];

  const derive = (doors) => planSwitchboards({
    room, rooms: [room], doors, roomTypes: {}, pxPerFt: PPF, rules: ['door'],
  });

  // A RULE THAT WAS NEVER RUN HAS NOTHING TO SAY. Handing rules 2 and 3 an
  // empty accent list is a different request: they answer, and their answer is
  // two sentences about fittings nobody has asked for yet.
  const asked = planSwitchboards({ room, rooms: [room], doors: inTopWall(2),
                                   roomTypes: {}, pxPerFt: PPF });
  ok(asked.notes.length === 2, `all three rules report (got ${asked.notes.length} notes)`);

  // The door 2ft in from the left: most of this room's floor is to its RIGHT,
  // so the hinge goes left, the latch right, and the plate steps right.
  const atLeft = derive(inTopWall(2));
  const b1 = atLeft.boards.filter((b) => !b.rejected && b.point);
  ok(b1.length === 1 && b1[0].role === 'door',
    `one board, from the door (got ${b1.length})`);
  ok(atLeft.notes.length === 0,
    `...and asking for the door alone says nothing else (got ${atLeft.notes.length} notes)`);
  ok(atLeft.boards.length === asked.boards.filter((b) => b.role === 'door').length,
    'the door board itself is identical either way');
  ok(b1[0].hingeConfidence === 'area',
    'the hinge was decided by measuring the floor either side, not guessed');
  ok(near(b1[0].point.x, 2 * PPF + leaf + gap + half),
    `the plate is 300mm past the LATCH jamb (x=${(b1[0].point.x / PPF).toFixed(2)}ft)`);
  ok(/latch jamb/.test(b1[0].why) && /% of this space's floor/.test(b1[0].why),
    'and it says which side the door opens to and why');

  // MIRROR THE DOOR AND THE PLATE MUST MIRROR WITH IT. If it did not, the rule
  // would be "step toward the middle of the wall" wearing the latch's name.
  const atRight = derive(inTopWall(W - 2 - leaf / PPF));
  const b2 = atRight.boards.filter((b) => !b.rejected && b.point)[0];
  ok(near(b2.point.x, (W - 2 - leaf / PPF) * PPF - gap - half),
    `a door at the far end puts its plate on the other side of the opening`
    + ` (x=${(b2.point.x / PPF).toFixed(2)}ft)`);
  // The claim is about which side of ITS OWN OPENING each plate sits on, not
  // about which is further right on the sheet. The first steps away from the
  // near corner and the second steps back toward it, and both are "toward the
  // floor" — which is the rule.
  const rightJamb = 2 * PPF + leaf, leftJamb2 = (W - 2 - leaf / PPF) * PPF;
  ok(b1[0].point.x > rightJamb && b2.point.x < leftJamb2,
    'each plate is on the latch side of its own opening — opposite hands');

  // THE BAY ADOPTS IT, so a plain bedroom has exactly one plate — and the loops
  // run back to that one, not to a bay plate at the middle of a wall.
  const bays = [{ key: 'room', rect: rp({ x0: 0, y0: 0, x1: W, y1: H }) }];
  const cb = planChunkBoards({ room, bays, boards: b1, pxPerFt: PPF });
  ok(cb.boards.length === 0, 'the bay makes no plate of its own');
  const res = planLights(polyFt, [], {}, []);
  const { flows } = planFlows({
    room, bays,
    chunks: res.chunks.map((ch) => ({ ...rp(ch),
      xLines: ch.xLines.map((v) => v * PPF), yLines: ch.yLines.map((v) => v * PPF) })),
    cells: res.cells.map(rp), lights: res.lights.map((l) => ({ ...l, ...toPx(l) })),
    boards: b1, owner: cb.owner, pxPerFt: PPF,
  });
  ok(flows.length > 0 && flows.every((f) => f.boardLabel === 'Door'),
    'and every flow in the room runs off the door board');
  ok(flows.every((f) => near(f.from.x, b1[0].point.x) && near(f.from.y, b1[0].point.y)),
    '...leaving the plate beside the door, which is where the wire starts');
}

console.log('\n-- which walls are a bay\'s own --');
{
  const ROOM = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 360 }, { x: 0, y: 360 }];
  const runs = wallRuns(ROOM);
  // The left half of the room: it abuts the top, left and bottom walls and not
  // the right one, which is 300px away.
  const walls = bayWalls({ x0: 0, y0: 0, x1: 300, y1: 360 }, runs, ROOM, 360, 20);
  ok(walls.length === 3, `three of the four walls are this bay's (got ${walls.length})`);
  ok(!walls.some((w) => near(w.run.a.x, 600) && near(w.run.b.x, 600)),
    'and the far wall is not one of them');
  ok(walls[0].overlap >= walls[walls.length - 1].overlap,
    'sorted by how much of the bay\'s edge each carries');
  // A NARROW BAY STILL OWNS THE WALL IT RUNS ALONG. `overlapFrac` is a fraction
  // of the BAY's edge, not of the wall's length — a band down the left of the
  // room genuinely does meet the top wall along the whole of its own 20px width,
  // and a switch at the top of that band is on the top wall.
  const band = bayWalls({ x0: 0, y0: 0, x1: 20, y1: 360 }, runs, ROOM, 360, 20);
  ok(band.some((w) => near(w.run.a.y, 0) && near(w.run.b.y, 0)),
    'a 20px band down the left of the room does meet the top wall');

  // WHAT `overlapFrac` IS ACTUALLY FOR: a wall the bay touches at one END only.
  // An L-shaped room, and the bay is its lower arm — which meets the corner of
  // the inner return and runs along none of it.
  const L = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 360 },
             { x: 200, y: 360 }, { x: 200, y: 700 }, { x: 0, y: 700 }];
  const arm = bayWalls({ x0: 0, y0: 360, x1: 200, y1: 700 }, wallRuns(L), L, 340, 20);
  const isReturn = (w) => near(w.run.a.y, 360) && near(w.run.b.y, 360);
  ok(!arm.some(isReturn),
    'the inner return, touched at one corner and run along not at all, is not the arm\'s wall');
  ok(arm.length === 3,
    `the arm's own three walls are (got ${arm.length})`);
}

console.log('\n-- the arcs --');
{
  const A = { x: 0, y: 0 }, Bp = { x: 100, y: 0 }, Cp = { x: 200, y: 0 };
  const d = loopPath([A, Bp, Cp], { pxPerFt: PPF });
  ok(d.startsWith('M 0 0'), 'the path starts at the first fitting');
  ok((d.match(/Q/g) || []).length === 2, 'one quadratic per leg, not one spline through all');
  // The control point sits TWICE the wanted sag off the midpoint, because a
  // quadratic reaches half way to its control — so `bulge` is the visible peak.
  const sag = FLOW_DEFAULTS.bulge * 100 * 2;
  ok(d.includes(`Q 50 ${-sag}`), `the bow is ${FLOW_DEFAULTS.bulge * 100}% of the leg (got ${d})`);
  ok(!d.includes('NaN'), 'and no NaN anywhere in it');

  // Two legs travelling the same way bow the same way, so a row reads as one wire.
  const ys = [...d.matchAll(/Q [\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]));
  ok(ys.every((y) => Math.sign(y) === Math.sign(ys[0])), 'every leg of one loop bows the same side');

  // The board's leg is drawn flatter than the legs between fittings.
  const withBoard = loopPath([Bp, Cp], { from: { x: 0, y: 0 }, pxPerFt: PPF });
  const firstSag = Math.abs(Number(withBoard.match(/Q [\d.-]+ ([\d.-]+)/)[1]));
  ok(firstSag < sag, `the leg from the plate is flatter (${firstSag} < ${sag})`);

  // The cap bites on a long leg rather than bowing across the room.
  const long = loopPath([{ x: 0, y: 0 }, { x: 3000, y: 0 }], { pxPerFt: PPF });
  const bigSag = Math.abs(Number(long.match(/Q [\d.-]+ ([\d.-]+)/)[1]));
  // 0.01 rather than exact: the path rounds its coordinates to two places, which
  // is a drawing at 1/3000 of a foot and plenty.
  ok(near(bigSag, FLOW_DEFAULTS.maxBulgeFt * PPF * 2, 0.01),
    `a 100ft leg bows by the cap and no more (${(bigSag / 2 / PPF).toFixed(2)} ft)`);

  ok(loopPath([A], {}) === '', 'one fitting and no board is not a path');
  ok(loopPath([], {}) === '', 'and neither is nothing');
}

console.log('\n-- a socket outlet wires itself --');
{
  /* THE ONE PLATE WITH NO SWITCH ON IT. A socket dropped on a wall is a fitting
     rather than a board: it makes a flow of its own, back to the nearest plate
     that can switch something, and THAT plate grows the module. Everything else
     — the wire, its bends, dragging its end onto a different board — falls out
     of it being an ordinary flow. */
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const A = { id: 'sb-A', roomId: 'r1', role: 'door', servesShort: 'Door',
              point: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
              alongPx: 20, deepPx: 8 };
  const B = { id: 'sb-B', roomId: 'r1', role: 'bay', servesShort: 'Bay',
              point: { x: 30 * PPF, y: 12 * PPF }, along: { x: 1, y: 0 },
              inward: { x: 0, y: -1 }, alongPx: 20, deepPx: 8 };
  const outlet = { id: 'sb-hand-1', x: 2 * PPF, y: 0, amps: 16 };

  const { flows } = wire(g, { boards: [A, B], outlets: [outlet] });
  const so = flows.find((f) => f.kind === 'socket');
  ok(!!so, 'the outlet produced a flow of its own');
  ok(so.outletId === 'sb-hand-1', 'which names the outlet it is for');
  ok(so.id.endsWith('socket-sb-hand-1'), `and is named after it (${so.id})`);
  ok(so.count === 1 && so.nodes[0].x === outlet.x, 'one node, at the socket');
  ok(so.amps === 16, 'carrying the rating, so the switch is built to match');
  ok(so.boardId === A.id,
    `and it runs back to the NEAREST plate that can switch it (${so.boardId})`);
  ok(so.from.x === A.point.x && so.from.y === A.point.y, 'the wire leaves that plate');
  ok(so.legs.length === 1 && so.legs[0].feed, 'one leg, and it is a feed');

  // A SOCKET IS NOT SOMEWHERE A CEILING CAN BE SWITCHED FROM, which is what
  // keeps it out of `general` — but it is not in `boards` at all here, so what
  // this really guards is that adding one changed nothing about the rest.
  const bare = wire(g, { boards: [A, B] }).flows;
  ok(flows.length === bare.length + 1, 'and nothing else in the room gained a flow');
  ok(bare.every((f, i) => f.boardId
    === flows.filter((q) => q.kind !== 'socket')[i].boardId),
    '...nor changed the plate it runs off');

  // MOVED ONTO ANOTHER BOARD, which is the point of it being a flow: the switch
  // is a module on whichever plate the wire lands on, so it moves too.
  const moved = wire(g, { boards: [A, B], outlets: [outlet],
                          assign: { [so.id]: B.id } }).flows
    .find((f) => f.kind === 'socket');
  ok(moved.boardId === B.id && moved.assigned, 'its wire can be dragged onto another plate');
  ok(moved.amps === 16, 'and it takes its rating with it');

  ok(wire(g, { boards: [A, B], outlets: [{ id: 'x' }] }).flows
    .some((f) => f.kind === 'socket') === false,
    'an outlet with no position makes no flow rather than a flow at NaN');

  /* NOTHING IS EVER SWITCHED FROM A PLATE WITH NO SWITCH ON IT, and that is the
     invariant this file guards rather than the gesture. On the canvas, dropping
     a wire on an outlet CONVERTS it — so by the time this pass runs again the
     plate is a board and the assignment resolves. If that conversion ever failed
     to happen, an assignment naming a plate that is still in `outlets` must fall
     back to the rules rather than leaving an appliance fed by a socket. */
  const stray = wire(g, { boards: [A, B], boardPool: [A, B], outlets: [outlet],
                          assign: { 'fl-r1-row-0-1': outlet.id } }).flows;
  ok(stray.every((f) => f.boardId !== outlet.id),
    'an assignment naming a plate that is still an outlet is not honoured');
  ok(stray.every((f) => f.kind === 'socket' || f.boardId === A.id || f.boardId === B.id),
    '...it falls back to a plate that can actually switch it');
}

console.log('\n-- outlet and switchboard, converted both ways --');
{
  /* THE CONVERSION IS THE POINT AND IT REMOVES NOTHING. Stop treating a plate
     as an outlet and its flow simply stops being produced — so the wire is gone
     and the switch on the far board is gone with it, not because anything went
     and deleted them but because both were only ever a function of that flow.
     Treat it as one again and both are back. This section is that round trip,
     run through the pass rather than argued about.
     WHICH DIRECTION IS WHICH IS A UI QUESTION and is not this file's business:
     adding any point to an outlet converts it, and a button converts it back.
     What the pass sees is a plate in the `outlets` list or not in it. */
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const A = { id: 'sb-A', roomId: 'r1', role: 'door', servesShort: 'Door',
              point: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
              alongPx: 20, deepPx: 8 };
  const hand = { id: 'sb-hand-1', roomId: 'r1', role: 'placed', servesShort: 'Board',
                 point: { x: 20 * PPF, y: 0 }, along: { x: 1, y: 0 },
                 inward: { x: 0, y: 1 }, alongPx: 20, deepPx: 8 };
  const outlet = { id: hand.id, x: hand.point.x, y: hand.point.y, amps: 16 };

  // AS AN OUTLET: it is not a board the room may use, and it makes a flow.
  const asOut = wire(g, { boards: [A], outlets: [outlet] }).flows;
  const so = asOut.find((f) => f.kind === 'socket');
  ok(!!so && so.boardId === A.id, 'as an outlet it wires itself to the door board');
  ok(pointsFromFlows(COUNTRIES.IN, asOut, A.id).some(
    (p) => p.kind === 'switch' && p.amps === 16),
    '...and that board carries a 16A switch for it');
  ok(asOut.filter((f) => f.boardId === hand.id).length === 0,
    'and nothing at all is switched from the outlet');

  // AS A SWITCHBOARD: no flow of its own, and it is a plate like any other.
  const asBoard = wire(g, { boards: [A, hand], outlets: [] }).flows;
  ok(!asBoard.some((f) => f.kind === 'socket'), 'converted over, the outlet flow is gone');
  ok(!pointsFromFlows(COUNTRIES.IN, asBoard, A.id).some((p) => p.forOutlet),
    '...so the switch on the door board went with it');
  ok(asBoard.length === asOut.length - 1,
    'one fewer flow in the room, and it is that one');

  // AND BACK AGAIN, byte for byte — the conversion has no residue.
  const again = wire(g, { boards: [A], outlets: [outlet] }).flows;
  ok(again.map((f) => `${f.id}:${f.boardId}`).join() ===
     asOut.map((f) => `${f.id}:${f.boardId}`).join(),
    'and converting back puts the room back exactly as it was');
}

console.log('\n-- ids that survive an edit --');
{
  /* THE WHOLE REASON STABLE IDS EXIST. A hand assignment and a hand bend are
     stored against a flow id, so an id that renumbers when a light is added is
     an override that silently moves onto a wire nobody touched. This section is
     the guard: light a room, light it again with one more fitting in it, and
     the flows that did not change must still be called what they were. */
  const poly = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }];
  const g = lay(poly);
  const before = wire(g).flows;
  ok(before.every((f) => !/-\d+$/.test(f.id) || /row-/.test(f.id)),
    'no flow is named by a bare counter any more');
  ok(before.every((f) => f.id.startsWith(`fl-${g.room.id}-`)), 'every id names its room');
  ok(new Set(before.map((f) => f.id)).size === before.length, 'and no two collide');

  // The same room, laid out again: identical ids, in the same order.
  const again = wire(lay(poly)).flows;
  ok(again.map((f) => f.id).join() === before.map((f) => f.id).join(),
    'the same room lays out to the same ids');

  // A ROW IS NAMED BY ITS CHUNK AND ITS INDEX WITHIN THAT CHUNK, which is what
  // makes it survive a row appearing earlier in the bay.
  const rows = before.filter((f) => f.kind === 'row');
  ok(rows.every((f) => f.id.includes(`row-${f.chunk}-`)),
    'a row names the chunk it is a row of');

  // A FITTING NAMES THE FITTING. Add a fan and it is `object-<its id>`.
  const withFan = wire(g, { objects: [{ id: 'fan-xyz', kind: 'fan', ...toPx({ x: 15, y: 6 }) }] });
  const fan = withFan.flows.find((f) => f.kind === 'object');
  ok(fan?.id.endsWith('object-fan-xyz'), `the fan's flow names the fan (got ${fan?.id})`);
  // ...and adding it did not rename the rows that were already there.
  const stillThere = withFan.flows.filter((f) => f.kind === 'row').map((f) => f.id);
  ok(rows.every((f) => stillThere.includes(f.id)),
    'and putting a fan in the room renamed none of the existing wires');
}

console.log('\n-- a wire dragged onto another plate --');
{
  const poly = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }];
  const g = lay(poly);
  const A = { id: 'sb-A', roomId: 'r1', role: 'door', servesShort: 'Door',
              point: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
              alongPx: 20, deepPx: 8 };
  const B = { id: 'sb-B', roomId: 'r1', role: 'bay', servesShort: 'Bay',
              point: { x: 30 * PPF, y: 12 * PPF }, along: { x: 1, y: 0 },
              inward: { x: 0, y: -1 }, alongPx: 20, deepPx: 8 };
  const base = wire(g, { boards: [A, B] }).flows;
  const target = base[0];
  ok(!!target.boardId, 'to begin with the rules pick a plate');
  ok(target.assigned === false, 'and say it is theirs and not a hand\'s');

  const other = target.boardId === A.id ? B.id : A.id;
  const moved = wire(g, { boards: [A, B], assign: { [target.id]: other } }).flows;
  const m = moved.find((f) => f.id === target.id);
  ok(m.boardId === other, 'an assignment moves the wire onto the named plate');
  ok(m.assigned === true, '...and the flow says so, for the card');
  ok(m.from.x === (other === A.id ? A : B).point.x, 'the wire now leaves that plate');
  ok(moved.filter((f) => f.id !== target.id).every((f, i) =>
    f.boardId === base.filter((q) => q.id !== target.id)[i].boardId),
    'and no other wire in the room moved');

  // A NAME THAT NO LONGER RESOLVES FALLS BACK TO THE RULES, so deleting a board
  // un-assigns the wires that named it rather than leaving them fed by nothing.
  const gone = wire(g, { boards: [A, B], assign: { [target.id]: 'sb-deleted' } }).flows;
  const gf = gone.find((f) => f.id === target.id);
  ok(gf.boardId === target.boardId && !gf.assigned,
    'a board that is not there any more is not an assignment');

  // THE POOL IS WHAT AN ASSIGNMENT MAY NAME, and it is not the fallback list.
  const far = { ...A, id: 'sb-far', point: { x: -900, y: -900 } };
  const cross = wire(g, { boards: [A, B], boardPool: [A, B, far],
                          assign: { [target.id]: 'sb-far' } }).flows;
  ok(cross.find((f) => f.id === target.id).boardId === 'sb-far',
    'a plate in the pool can be named even though the rules would never pick it');
  ok(cross.filter((f) => f.id !== target.id).every((f) => f.boardId !== 'sb-far'),
    '...and the rules still never pick it');
}

console.log('\n-- a bend, through the pass --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const A = { id: 'sb-A', roomId: 'r1', role: 'door', servesShort: 'Door',
              point: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
              alongPx: 20, deepPx: 8 };
  const plain = wire(g, { boards: [A] }).flows[0];
  const bent = wire(g, { boards: [A], bends: { [plain.id]: { 1: 2 } } }).flows
    .find((f) => f.id === plain.id);
  ok(plain.legs.length > 1, 'the loop has more than one leg to bend');
  ok(bent.legs[0].d === plain.legs[0].d, 'the leg nobody touched is untouched');
  ok(bent.legs[1].d !== plain.legs[1].d, 'and the one that was nudged moved');
  ok(bent.legs[1].bend === 2, 'by the two feet it was given');
  ok(bent.path === pathOf(bent.legs), 'the whole path still comes from the legs');
  // A bend belongs to ONE wire.
  const neighbour = wire(g, { boards: [A], bends: { [plain.id]: { 1: 2 } } }).flows
    .find((f) => f.id !== plain.id);
  const clean = wire(g, { boards: [A] }).flows.find((f) => f.id !== plain.id);
  ok(!neighbour || neighbour.path === clean.path, 'and to no other');
}

console.log('\n-- the legs, one by one --');
{
  const A = { x: 0, y: 0 }, Bp = { x: 100, y: 0 }, Cp = { x: 200, y: 0 };
  const legs = loopLegs([Bp, Cp], { from: A, pxPerFt: PPF });
  ok(legs.length === 2, `two legs (got ${legs.length})`);
  ok(legs[0].feed && !legs[1].feed, 'the first is the feed and the rest are chain');
  ok(legs.map((l) => l.key).join() === '0,1', 'keyed by position in the chain');
  ok(legs.every((l) => l.d.startsWith('M ')), 'each leg is a path in its own right');
  ok(pathOf(legs) === loopPath([Bp, Cp], { from: A, pxPerFt: PPF }),
    'and the whole path is exactly the legs, joined');

  // The grip sits ON the wire — half way to the control point, which is where
  // a quadratic actually reaches.
  const l = legs[1];
  const cy = Number(l.q.match(/Q [\d.-]+ ([\d.-]+)/)[1]);
  ok(near(l.grip.y, cy / 2, 0.01), `the grip is on the curve, not on the control (${l.grip.y})`);
  ok(near(l.grip.x, 150, 0.01), 'and half way along it');
  ok(near(Math.hypot(l.normal.x, l.normal.y), 1), 'the normal is a unit vector');

  ok(loopLegs([A], {}).length === 0, 'one fitting and no board is no legs');
  ok(pathOf([]) === '', 'and no legs is no path');

  // A LOOP WITH NO BOARD IS ALL CHAIN. Nothing is a feed if there is nothing to
  // feed from, which is what the canvas needs to know not to paint one blue.
  ok(loopLegs([A, Bp], { pxPerFt: PPF }).every((g) => !g.feed),
    'no plate, no feed leg');
}

console.log('\n-- a bend is a delta on the rule --');
{
  const A = { x: 0, y: 0 }, Bp = { x: 100, y: 0 };
  const plain = loopLegs([Bp], { from: A, pxPerFt: PPF })[0];
  const bent = loopLegs([Bp], { from: A, pxPerFt: PPF, bends: { 0: 1 } })[0];
  ok(near(bent.base, plain.base), 'the rule\'s own bow is unchanged by a nudge');
  ok(bent.bend === 1, 'the leg reports the nudge it is carrying');
  ok(near(bent.grip.y - plain.grip.y, plain.normal.y * PPF, 0.01),
    'and one foot of bend moves the arc one foot along its normal');
  // ZERO IS "HOWEVER THE RULE BOWS IT", which is what makes a stored bend safe
  // to keep while the fittings move.
  ok(loopLegs([Bp], { from: A, pxPerFt: PPF, bends: {} })[0].d === plain.d,
    'no entry is no change at all');
  // THE CAP IS ON THE RULE ONLY. A leg somebody dragged is a request to put it
  // somewhere the rule would not.
  const long = loopLegs([{ x: 3000, y: 0 }], { from: A, pxPerFt: PPF, bends: { 0: 5 } })[0];
  ok(long.base < 5 * PPF && Math.abs(long.grip.y) > 5 * PPF,
    'a hand bend is not capped the way the rule is');

  // KEY SPACES DO NOT COLLIDE: the second feed of a two-way switch has its own.
  const pref = loopLegs([Bp], { from: A, pxPerFt: PPF, keyPrefix: 'a', bends: { 0: 1 } })[0];
  ok(pref.key === 'a0' && pref.bend === 0,
    'a leg keyed a0 does not pick up the bend stored against 0');
}

console.log('\n-- proximity groups --');
{
  const P = (x, y) => ({ x, y });
  const g = cluster([P(0, 0), P(5, 0), P(100, 0), P(103, 0), P(104, 0)], 10);
  ok(g.length === 2, `two groups (got ${g.length})`);
  ok(g.map((s) => s.length).sort().join() === '2,3', 'of two and three');
  // SINGLE LINK, so a chain of hops holds together even though the ends do not.
  const chain = cluster([P(0, 0), P(9, 0), P(18, 0), P(27, 0)], 10);
  ok(chain.length === 1, 'a chain of hops is one group, even end to end');
  ok(cluster([], 10).length === 0, 'nothing groups into nothing');
}

console.log('\n-- a space with no plate anywhere --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const { flows, notes } = planFlows({
    room: g.room, bays: g.bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: [], owner: new Map(), pxPerFt: PPF,
  });
  ok(flows.length === 2, 'the fittings are still looped');
  ok(flows.every((f) => f.boardId === null && f.from === null),
    'they just have nothing to run back to');
  ok(flows.every((f) => f.path.startsWith('M')), 'and the loops still draw');
  ok(notes.length === 1 && /no switchboard/.test(notes[0]), 'which is said out loud');
}

console.log('\n-- the summary --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const { flows } = wire(g);
  const s = flowSummary(flows);
  ok(s.flows === 2 && s.fittings === 8, `two flows, eight fittings (got ${s.flows}, ${s.fittings})`);
  ok(s.boards.size === 1 && [...s.boards.values()][0] === 2,
    'both on one plate, which is therefore a two-module board');
  ok(flowSummary([]).flows === 0, 'and nothing summarises to nothing');
}

console.log('\n-- a dragged plate moves the wire and NOT the switching --');
{
  // THE REQUIREMENT THIS GUARDS, in one section. A board can be dragged along
  // its space's walls; when it is, the drawing and the wire follow it and
  // nothing else does. `planChunkBoards` decides which bay is switched from
  // which plate BY GEOMETRY — a bay adopts a board standing on one of its own
  // walls and makes itself a new one when none does — so a drag that reached
  // that decision would take the switch off the ceiling it was switching and
  // grow a replacement plate. Which is the opposite of what dragging one is for.
  const ROOM = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 360 }, { x: 0, y: 360 }];
  const room = { id: 'r9', polygonPx: ROOM };
  const doors = [{ id: 'd1', cls: 'door', conf: 0.99,
                   rect: { x0: 60, y0: -18, x1: 150, y1: 90 } }];
  const bays = [{ key: 'L', rect: { x0: 0, y0: 0, x1: 300, y1: 360 } },
                { key: 'R', rect: { x0: 300, y0: 0, x1: 600, y1: 360 } }];

  const rules = planSwitchboards({ room, rooms: [room], doors, pxPerFt: PPF });
  const door = rules.boards.find((b) => b.role === 'door');
  const settled = planChunkBoards({ room, bays, boards: rules.boards, pxPerFt: PPF });
  ok(settled.owner.get('L') === door.id, 'to begin with, the left bay runs off the door plate');

  // Now drag that plate most of the way down the RIGHT-hand wall — 800px round
  // the perimeter, which is 200px down a wall the left bay does not touch.
  const moves = { [door.id]: 800 / PPF };
  const dragged = planSwitchboards({ room, rooms: [room], doors, pxPerFt: PPF, moves });
  const d = dragged.boards.find((b) => b.role === 'door');
  ok(d.moved && near(d.hand.point.x, 600) && near(d.hand.point.y, 200),
    `the plate is where it was dropped (got ${d.hand.point.x}, ${d.hand.point.y})`);

  // THE OWNERSHIP PASS IS FED THE RULE POSITIONS — see ruleBoardsFor in App.jsx
  // — so it cannot see the drag and its answer is byte-identical.
  const after = planChunkBoards({ room, bays, boards: dragged.boards, pxPerFt: PPF, moves });
  ok(after.owner.get('L') === settled.owner.get('L')
    && after.owner.get('R') === settled.owner.get('R'),
    'and every bay is still switched from the plate it was switched from');
  ok(after.boards.length === settled.boards.length,
    `no replacement plate appeared (${settled.boards.length} -> ${after.boards.length})`);

  // ...AND THE WIRE DOES FOLLOW IT. planFlows is handed the DRAWN boards, so
  // the arc runs back to where the plate now is.
  const g = lay([{ x: 0, y: 0 }, { x: ft(600), y: 0 },
                 { x: ft(600), y: ft(360) }, { x: 0, y: ft(360) }]);
  const flows = planFlows({
    room, bays, chunks: g.chunks, cells: g.cells, lights: g.lights,
    boards: dragged.boards.map(asDrawn), owner: after.owner, pxPerFt: PPF,
  }).flows;
  const off = flows.find((f) => f.boardId === door.id);
  ok(off && near(off.from.x, 600) && near(off.from.y, 200),
    `the wire starts at the dragged plate, not at the rule's (got ${off?.from.x}, ${off?.from.y})`);

  // A BAY PLATE IS DRAGGABLE TOO, because on the drawing it is a switchboard
  // like any other and a cursor that offers a drag must not then refuse one.
  const bay = settled.boards[0];
  const bayMoved = planChunkBoards({
    room, bays, boards: rules.boards, pxPerFt: PPF,
    moves: { [bay.id]: 100 / PPF },
  });
  const bm = bayMoved.boards.find((b) => b.id === bay.id);
  ok(bm?.moved && near(bm.hand.point.x, 100) && near(bm.hand.point.y, 0),
    `a bay plate follows the drag as well (got ${bm?.hand.point.x}, ${bm?.hand.point.y})`);
  ok(bayMoved.owner.get('R') === settled.owner.get('R'),
    'and its bay still runs off it');
}

console.log('\n-- nothing at all --');
{
  ok(planFlows({}).flows.length === 0, 'no room, no flows');
  ok(planFlows({ room: { id: 'x', polygonPx: [] } }).flows.length === 0, 'no outline, no flows');
}

console.log(fail ? `\n${fail} failing` : '\nall good');
process.exit(fail ? 1 : 0);
