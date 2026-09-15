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
         px, SB_MM, servesBay, CHUNK_BOARD,
         LAMP_SOCKET_FT } from '../src/lib/electrical.js';

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
  /* 12 x 6 ft: one chunk, one row of two — and the SHAPE is the assertion's
     precondition rather than decoration. It was 12 x 10, which the planner
     lays 2 x 2 in, so the claim under test — that a lone row is labelled
     "Downlights" and not "Row 1 of 1" — was never reached: there were two rows
     and both were correctly numbered. A test whose setup no longer produces the
     case it is about passes or fails for reasons that have nothing to do with
     it. Halving the depth puts one row back. */
  const g = lay([{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 6 }, { x: 0, y: 6 }]);
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

  /* THE REST OF THE ROOM IS ROWS, and the rows run parallel to the foot of the
     bed — NOT along the remainder's own long axis, which on a 16 x 17 region
     would say "down the room" and give three switches of one lamp each. THAT is
     the claim, and it is what the width of each row checks.
     TWO ROWS AND NOT ONE. The count was written when the planner laid two rows
     below the bed and it lays three: the foot takes the first and two remain.
     The number is the planner's and moves with it; what must not move is that
     every one of them is a row ACROSS the room. */
  const rest = flows.filter((f) => f.kind === 'row');
  ok(rest.length === 2 && rest.every((f) => f.count === 3),
    `the rest of the room is two further rows of three (got ${rest.map((f) => f.count).join()})`);
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
  // A 14x18 bedroom: bed against the top wall, a sconce at each pillow, and the
  // door in the LEFT wall down at the far end — so one bedside plate is near the
  // main board and one is a long way from it.
  //
  // THE PLATES COME OFF THE BED AND NOT OFF THE SCONCES, which is what rule 2
  // does now: a foot clear of the mattress either side, on the headboard wall.
  // The bed runs x 6..12, so they land at x=5 and x=13 on the top wall — which
  // is exactly where accentPlace puts the sconces, so the sconces are put there
  // too and the pair coincides the way it does on a real plan.
  const W = 18, H = 18;
  const bed = { id: 'bed', cls: 'bed', x0: 6, y0: 0, x1: 12, y1: 7 };
  const polyFt = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const room = { id: 'r1', polygonPx: polyFt.map(toPx) };
  const leaf = px(900, PPF);
  const doors = [{ id: 'd1', cls: 'door', conf: 0.99,
                   rect: { x0: -18, y0: 14 * PPF, x1: leaf, y1: 14 * PPF + leaf } }];
  const sconce = (id, xFt, what) => ({
    id, type: 'sconce', group: 'bedside', roomId: 'r1', what,
    point: toPx({ x: xFt, y: 0 }), along: { x: 1, y: 0 },
    inward: { x: 0, y: 1 }, wall: { index: 0 }, t: xFt * PPF,
  });
  const sconces = [
    sconce('sc-L', 5, 'left of the bed'),
    sconce('sc-R', 13, 'right of the bed'),
  ];

  // BOTH FREE RULES, no vision call: the door plate and one plate at each
  // bedside. NOTHING IS HANDED THE SCONCES — that is the point of the rewrite:
  // the plates are there because there is a bed.
  const sb = planSwitchboards({ room, rooms: [room], doors, roomTypes: {},
                                bedRect: rp(bed), pxPerFt: PPF,
                                rules: ['door', 'bedside'] });
  const live = sb.boards.filter((b) => !b.rejected && b.point);
  const beds = live.filter((b) => b.role === 'bedside');
  ok(beds.length === 2, `two bedside plates, one per pillow (got ${beds.length})`);
  ok(beds.every((b) => near(b.point.y, 0, 1e-6)),
    'both on the headboard wall, not on the wall along the side of the bed');
  const xs = beds.map((b) => b.point.x).sort((a, b) => a - b);
  ok(near(xs[0], 5 * PPF, 1e-6) && near(xs[1], 13 * PPF, 1e-6),
    `a foot clear of the mattress either side (got ${xs.map((v) => (v / PPF).toFixed(2))})`);
  ok(beds.every((b) => !b.fromId), 'and neither is keyed to a fitting any more');

  // NO SCONCE, STILL TWO PLATES. This is the whole of what changed: deleting a
  // bedside light used to delete the switch under it, silently, because the
  // board was derived from the accent.
  const bare = planSwitchboards({ room, rooms: [room], doors, roomTypes: {},
                                 bedRect: rp(bed), pxPerFt: PPF,
                                 rules: ['door', 'bedside'] });
  ok(bare.boards.filter((b) => b.role === 'bedside' && !b.rejected).length === 2,
    'a bedroom with no sconces at all still has a plate at each bedside');

  // "BELOW THE SCONCE" IS THE SCONCE'S OWN PLAN POINT. A plan is a view from
  // above: a switch at 700mm and a sconce at 1600mm on one wall are the same
  // point here and stacked in the room. The two rules put them at the same
  // figure off the same box, so they still coincide — they are simply no longer
  // derived from each other.
  ok(sconces.every((c) => beds.some((b) => near(b.point.x, c.point.x, 1e-6)
    && near(b.point.y, c.point.y, 1e-6))),
    'and each stands at its sconce\'s own point — below it on the wall')

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
  // THE NEARER PLATE, WHICH IS THE ONE ON ITS OWN SIDE OF THE BED. The join
  // used to be `fromId`; the plate no longer comes from the sconce, so it is a
  // distance — and on this geometry it is not a close call: each sconce is ON
  // its own plate and 8ft from the other.
  ok(bs.every((f) => {
    const b = beds.find((x) => x.id === f.boardId);
    return b && near(b.point.x, f.nodes[0].x, 1e-6);
  }), 'and each runs off the plate at its own side of the bed');

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

  /* --- AND A PENDANT IS WIRED LIKE ONE AND NAMED LIKE ITSELF ---------------
     A PENDANT CARRIES `kind: 'chandelier'` ON PURPOSE — see ceilingObjects.js —
     which is what gets it onto the lighting circuit at all. The trap is that the
     gate and the NAME used to be the same lookup, so it would have been wired
     correctly and then written onto the schedule as a chandelier. The `typeId`
     is what tells them apart. */
  const { flows: f3 } = planFlows({
    room, bays,
    chunks: res.chunks.map((ch) => ({ ...rp(ch),
      xLines: ch.xLines.map((v) => v * PPF), yLines: ch.yLines.map((v) => v * PPF) })),
    cells: res.cells.map(rp), lights: res.lights.map((l) => ({ ...l, ...toPx(l) })),
    zones: [rp(bed)], accents: sconces,
    objects: [{ id: 'pd1', kind: 'chandelier', typeId: 'pendant', ...toPx({ x: 9, y: 13 }) }],
    boards: live, owner: cb.owner, pxPerFt: PPF,
  });
  const pd = f3.find((f) => f.kind === 'object');
  ok(!!pd, 'a pendant is on the lighting circuit, because the gate is the kind');
  ok(pd?.label === 'Pendant', `and it is called a pendant, not a chandelier (got ${pd?.label})`);
  ok(/^pendant —/.test(pd?.what ?? ''), 'the sentence under it follows the label');
  // ...AND ONE IN THE MIDDLE OF THE ROOM IS THE ROOM'S LIGHT. This one hangs at
  // (9,13), thirteen feet from the nearer bedside plate, so it takes the bay's
  // board like any other ceiling fitting. The bedside rule below is a REACH and
  // not a kind, which is what keeps these two apart.
  ok(pd?.boardId === main.id, 'a pendant out in the room is switched from the main board');

  /* --- A PENDANT HUNG AT A BEDSIDE TAKES THAT BEDSIDE'S PLATE --------------
     Two feet off the left-hand plate, which is where a reading pendant over a
     nightstand actually hangs. It is the same fitting as a sconce as far as the
     room is concerned, and the switch for it is the one you reach lying down. */
  const near2 = { id: 'pd2', kind: 'chandelier', typeId: 'pendant', ...toPx({ x: 5, y: 2 }) };
  const { flows: f4 } = planFlows({
    room, bays,
    chunks: res.chunks.map((ch) => ({ ...rp(ch),
      xLines: ch.xLines.map((v) => v * PPF), yLines: ch.yLines.map((v) => v * PPF) })),
    cells: res.cells.map(rp), lights: res.lights.map((l) => ({ ...l, ...toPx(l) })),
    zones: [rp(bed)], accents: sconces, objects: [near2],
    boards: live, owner: cb.owner, pxPerFt: PPF,
  });
  const bp = f4.find((f) => f.kind === 'object');
  const leftPlate = beds.reduce((a, b) => (b.point.x < a.point.x ? b : a));
  ok(bp?.boardId === leftPlate.id,
    'a pendant beside the bed runs off the plate at THAT bedside, not the door');
  ok(/at that bedside/.test(bp?.what ?? ''), `and the card says so: "${bp?.what}"`);
  ok(!bp?.assigned, 'and it is the rule doing it, not a stored hand assignment');

  /* --- AT A BEDSIDE IS A DISTANCE *AND* A WALL ----------------------------
     The reach alone would catch the pendant hanging two and a half feet past
     the FOOT of the bed, which is the room's own light on the room's own
     switch. `atBedside` asks the headboard wall as well — the wall the bedside
     plates themselves stand on, so nothing is re-derived and no wall index is
     compared across modules. */
  const withObjects = (objects, accents = sconces) => planFlows({
    room, bays,
    chunks: res.chunks.map((ch) => ({ ...rp(ch),
      xLines: ch.xLines.map((v) => v * PPF), yLines: ch.yLines.map((v) => v * PPF) })),
    cells: res.cells.map(rp), lights: res.lights.map((l) => ({ ...l, ...toPx(l) })),
    zones: [rp(bed)], accents, objects,
    boards: live, owner: cb.owner, pxPerFt: PPF,
  }).flows;

  // The bed runs y 0..7, so this hangs 2.5ft past its foot — inside the 3ft
  // reach, and nearer the bottom wall than the headboard.
  const footPend = withObjects([{ id: 'pd3', kind: 'chandelier', typeId: 'pendant',
                                  ...toPx({ x: 9, y: 9.5 }) }]);
  const fp = footPend.find((f) => f.kind === 'object');
  ok(fp?.boardId === main.id,
    'a pendant past the foot of the bed is the room\'s light, on the room\'s board');

  /* --- AND A SCONCE SOMEBODY PLACED BY HAND IS READ THE SAME WAY -----------
     THE CASE THIS EXISTS FOR. A hand-placed sconce carries no `group`, so it
     used to fall through to the wall-light grouping below and take whatever
     board the BAY runs off. On a plan where the main plate sits directly above a
     bedside one — the door beside the head of the bed, 1200 over 700 — that is a
     reading light wired to the switch by the door, with nothing on the drawing
     to say which of the two plates it landed on. */
  const handSconce = {
    id: 'sc-hand', type: 'sconce', roomId: 'r1', what: 'beside the bed',
    point: toPx({ x: 13, y: 0 }), along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
    wall: { index: 0 }, t: 13 * PPF,
  };
  const hand = withObjects([], [handSconce]);
  const hf = hand.find((f) => f.kind === 'bedside');
  const rightPlate = beds.reduce((a, b) => (b.point.x > a.point.x ? b : a));
  ok(!!hf && hf.nodes[0].id === 'sc-hand',
    'a hand-placed sconce at the bedside is a bedside flow, not a wall light');
  ok(hf?.boardId === rightPlate.id, 'and it runs off the plate at its own bedside');
  ok(!hand.some((f) => f.kind === 'wall'),
    'nothing is left over in the wall-light grouping');

  // ...and one on another wall is still an ordinary wall light on the bay board.
  const away = withObjects([], [{ ...handSconce, id: 'sc-far',
    point: toPx({ x: 0, y: 14 }), along: { x: 0, y: 1 }, inward: { x: 1, y: 0 },
    wall: { index: 3 }, t: 14 * PPF }]);
  const wl = away.find((f) => f.kind === 'wall');
  ok(!!wl && wl.boardId === main.id,
    'a sconce away from the bed is a wall light on the room\'s own board');
}

console.log('\n-- an array of spots is one switch, whatever it is spaced at --');
{
  const ROOM = [{ x: 0, y: 0 }, { x: 24 * PPF, y: 0 },
                { x: 24 * PPF, y: 16 * PPF }, { x: 0, y: 16 * PPF }];
  const room = { id: 'r1', polygonPx: ROOM };
  const board = { id: 'bd', roomId: 'r1', role: 'door', servesShort: 'Door',
    heightsMm: [1200], point: { x: 12 * PPF, y: 0 }, wall: { index: 0 } };
  /** An array's lamps as `arrayLampsPx` leaves them: an id per lamp, all
   *  carrying the run's own id, in the order they were set out along it. */
  const run = (aid, gapFt, yFt, n = 4) => Array.from({ length: n }, (_, i) => ({
    id: `${aid}#${i}`, arrayId: aid, roomId: 'r1',
    x: (3 + i * gapFt) * PPF, y: yFt * PPF }));
  const wireUp = (lamps) => planFlows({ room, lamps, boards: [board], pxPerFt: PPF }).flows;

  /* --- THE PITCH MUST NOT DECIDE THE SWITCHING ---------------------------
     THIS IS THE BUG. An array went into the downlight section as loose
     hand-placed COBs and, with no grid under them, fell to the proximity
     fallback — which groups at `spotGroupFt`, six feet, and a run of downlights
     is spaced wider than that. Four lamps at eight feet came out as four
     clusters: four flows, four modules and four wires fanning out of one plate.
     Six feet is the right reach for RECOVERING a formation nobody recorded; an
     array has an id, so its membership is a fact and no distance may argue. */
  for (const gap of [2, 5.5, 8, 14]) {
    const flows = wireUp(run('a1', gap, 9));
    const arr = flows.filter((f) => f.kind === 'array');
    ok(arr.length === 1 && arr[0].count === 4,
      `at ${gap} ft pitch the array is one flow of four `
      + `(got ${arr.length} flow(s) of ${arr.map((f) => f.count).join()})`);
  }
  // ...AND IT IS NOT ALSO A ROW OR A STRAY. Left in `lamps`, the same fittings
  // would have been switched twice — once as the run and once by whatever cell
  // or cluster they fell into.
  const one = wireUp(run('a1', 8, 9));
  ok(one.length === 1, `and nothing else is switching them (got ${one.length} flows)`);
  ok(one[0].label === 'Spot array',
    `named as the schedule names it (got ${one[0].label})`);
  ok(one[0].arrayId === 'a1', 'and it names the run it is');

  // TWO RUNS ARE TWO SWITCHES, because they are two decisions — even overlapping,
  // which is what makes the id and not the distance the answer.
  const two = wireUp([...run('a1', 8, 5), ...run('a2', 8, 5.5)]);
  ok(two.filter((f) => f.kind === 'array').length === 2,
    `two runs laid over each other are still two switches (got ${two.length})`);

  /* ONE MODULE ON THE PLATE, which is what "one switch" has to mean by the time
     it reaches the schedule. Four before this fix. */
  const pts = pointsFromFlows(COUNTRIES.IN, one, 'bd');
  ok(pts.length === 1 && pts[0].kind === 'switch',
    `an array is one switch module (got ${pts.map((q) => q.kind).join()})`);

  /* THE LOOP TRACES THE RUN, in the order the lamps were set out, and comes in
     at the end nearest the plate — the same rule every other loop follows. */
  const walk = one[0].nodes.map((q) => Math.round(q.x / PPF));
  ok(walk.length === 4 && walk.every((v, i, a) => i === 0 || v > a[i - 1]),
    `the wire walks the run end to end rather than jumping about (${walk.join()})`);
}

console.log('\n-- a standing lamp is plugged in, not wired --');
{
  const ROOM = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 360 }, { x: 0, y: 360 }];
  const room = { id: 'r1', polygonPx: ROOM };
  /* THE DOOR BOARD IS AT SWITCH HEIGHT AND A LAMP MAY NOT USE IT — see
     LAMP_SOCKET_MAX_MM. It is here as the plate the lamp must NOT be wired to,
     and as the one a hand assignment can still name. */
  const board = { id: 'bd', roomId: 'r1', role: 'door', servesShort: 'Door',
    heightsMm: [1200],
    point: { x: 300, y: 0 }, rulePoint: { x: 300, y: 0 },
    wall: { a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, index: 0 } };
  /* ...and a lamp's own plate, at socket height, which is what one may use. */
  const sock = (y) => ({ id: 'sb-lamp', roomId: 'r1', role: 'lamp',
    servesShort: 'Lamp', heightsMm: [300], point: { x: 300, y } });
  const REACH = LAMP_SOCKET_FT * PPF;                      // 91.44px
  const lamp = (dy, id = 'sl1') => ({ id, kind: 'standing_lamp',
                                      typeId: 'standing_lamp', x: 300, y: dy });
  const run = (objects, { outlets = [], handPlates = [] } = {}) => planFlows({
    room, objects, outlets, handPlates, boards: [board], pxPerFt: PPF }).flows;

  /* --- THE LAMP NAMES ITS PLATE OUTRIGHT ---------------------------------
     NOT THROUGH `boardFor`, which is what every other fitting goes through. A
     ceiling's flow runs to whichever plate the rules say switches that ceiling;
     a lamp's runs to the plate it can actually plug into, which is a question
     about height and reach rather than about what switches what. */
  const inReach = run([lamp(30)], { handPlates: [sock(0)] });
  const fl = inReach.find((f) => f.kind === 'lamp');
  ok(!!fl, 'a lamp with a socket-height plate on the wall gets a flow');
  ok(fl?.boardId === 'sb-lamp', `...and it runs to that plate (got ${fl?.boardId})`);
  ok(fl?.label === 'Standing lamp',
    `named off the catalogue like the pendant is (got ${fl?.label})`);
  ok(fl?.objectId === 'sl1', 'and it names the object it is for');

  /* --- THE DOOR BOARD IS THE RIGHT DISTANCE AND THE WRONG PLATE -----------
     A LAMP THREE FEET FROM IT WAS BEING WIRED TO IT, and 1200mm is hand height
     for a switch — a flex up the wall to shoulder level. Only the distance was
     ever tested; the height is the other half. */
  ok(run([lamp(REACH - 5)]).find((f) => f.kind === 'lamp')?.boardId == null,
    'a lamp beside the door board is not wired to it — 1200mm is too high');

  /* --- NO PLATE AT ALL: A FLOW WITH NO BOARD, AND NOT NO FLOW -------------
     IT USED TO BE SKIPPED, and that quietly refused the manual case as well as
     the automatic one: a hand assignment is stored against a FLOW ID and is
     dragged from the WIRE, so a lamp with no flow can never be connected by
     hand at all. It gets a flow, with nothing on the other end, and says so. */
  const stranded = run([lamp(300)]).filter((f) => f.kind === 'lamp');
  ok(stranded.length === 1, 'a lamp with no usable plate still gets a flow');
  ok(stranded[0].boardId === null,
    `...and it names no board rather than the nearest one (got ${stranded[0].boardId})`);

  /* --- AND THREE FEET IS THE AUTOMATIC RULE ONLY --------------------------
     DRAG A LAMP'S WIRE ONTO A PLATE FIFTY FEET AWAY AND IT GOES THERE. The cap
     governs what the app does BY ITSELF — whether a socket has to go up, and
     which plate it picks unaided. An assignment is somebody saying outright
     which plate they mean, and it is resolved against every plate on the
     drawing, at any distance and at any height. */
  const far = run([lamp(300)]).find((f) => f.kind === 'lamp');
  const byHand = planFlows({ room, objects: [lamp(300)], boards: [board],
    boardPool: [board], assign: { [far.id]: 'bd' }, pxPerFt: PPF })
    .flows.find((f) => f.kind === 'lamp');
  ok(byHand?.boardId === 'bd',
    `a hand assignment reaches a plate the rule would not (got ${byHand?.boardId})`);
  ok(byHand?.assigned === true, '...and the wire is marked as somebody\'s own');

  /* --- A BARE SOCKET OUTLET IS NOT SOMETHING A LAMP MAY USE ---------------
     AND THIS ASSERTION IS THE REVERSE OF WHAT IT ONCE WAS. The rule briefly
     said an outlet in reach was the lamp's socket and the lamp therefore needed
     no wire of its own — which left the fitting with no mark, no module and no
     switch within three feet of it. An outlet is by definition the one plate
     with no switch ON it, and a socket a lamp cannot switch is not a socket a
     lamp can use. So it is skipped and the lamp is left wanting a plate, which
     is what makes the placement seat one. */
  const withSocket = run([lamp(300)],
    { outlets: [{ id: 'so1', x: 300, y: 300 + REACH / 2, amps: 6 }] });
  ok(withSocket.some((f) => f.kind === 'socket'),
    'the outlet still draws its own wire, as any outlet does');
  ok(withSocket.find((f) => f.kind === 'lamp')?.boardId == null,
    '...and the lamp is not served by it — an outlet has no switch to offer');

  /* --- THE PLATE A LAMP SEATS FOR ITSELF IS A `handPlate` -----------------
     AND IT IS A THIRD LIST FOR A REASON. `boards` is what a CEILING may fall
     back to and a hand-placed plate has never been in it; the outlets are
     handed in separately; and a lamp's plate is neither of those — it is a
     switchboard somebody's placement put on a wall. Without this input it fell
     through every list and the lamp could not find the very plate that had just
     been seated for it, which is exactly the bug this covers. */
  const mine = sock(360);
  const onMine = run([lamp(360 - REACH / 2)], { handPlates: [mine] });
  const ml = onMine.find((f) => f.kind === 'lamp');
  ok(!!ml, 'a lamp finds the plate its own placement seated');
  ok(ml?.boardId === 'sb-lamp', `...and its wire runs to it (got ${ml?.boardId})`);
  ok((ml?.legs?.length ?? 0) > 0 && !ml?.coincident,
    'and there is an actual wire drawn between the two');

  /* --- TWO LAMPS BESIDE EACH OTHER ARE TWO WIRES AND TWO PAIRS ------------
     ONE FLOW PER LAMP, WHICH IS THE WHOLE OF IT. A second lamp within reach of
     the same plate does not share the first one's socket — it needs its own,
     and it gets it as two more modules on that plate rather than as a second
     frame on the wall. A shared flow would have been one socket for two lamps,
     and a second plate would have been a frame nobody would build. */
  const pair = run([lamp(360 - REACH / 2, 'sl1'), lamp(360 - REACH / 3, 'sl2')],
    { handPlates: [mine] });
  const both = pair.filter((f) => f.kind === 'lamp');
  ok(both.length === 2, `two lamps are two flows (got ${both.length})`);
  ok(both.every((f) => f.boardId === 'sb-lamp'), '...both onto the one plate');
  const pairPts = pointsFromFlows(COUNTRIES.IN, both, 'sb-lamp');
  ok(pairPts.filter((q) => q.kind === 'socket').length === 2
     && pairPts.filter((q) => q.kind === 'switch').length === 2,
    `and that plate carries two sockets and two switches (got ${pairPts.length} points)`);

  /* --- WHAT THE PLATE OWES IT: A SOCKET AND ITS SWITCH -------------------
     THE ONLY FLOW THAT BRINGS ITS OWN SOCKET. Every other fitting is wired and
     needs a switch; a lamp is plugged in, so what it asks of the plate is
     somewhere to plug into. And NOT the board's spare socket, which is
     explicitly the one nobody has claimed — see the note in switchboards.js. */
  const pts = pointsFromFlows(COUNTRIES.IN, inReach.filter((f) => f.kind === 'lamp')
    .map((f) => ({ ...f, boardId: 'bd' })), 'bd');
  ok(pts.length === 2, `a lamp is two points on the plate (got ${pts.length})`);
  ok(pts.filter((q) => q.kind === 'switch').length === 1
     && pts.filter((q) => q.kind === 'socket').length === 1,
    'and they are a switch and a socket, in that order');
  ok(pts.every((q) => q.flowId === fl.id),
    'both carry the wire they are on, so picking either lights it');
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
  ok(asked.notes.length === 3, `every rule asked for reports (got ${asked.notes.length} notes)`);

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

console.log('\n-- a lamp a hand placed is a downlight in its cell\'s row --');
{
  /* THE SAME ROOM AND THE SAME POSITIONS, HANDED IN TWICE. Once as the
     planner's own answer, once as lamps somebody put there — stripped to
     `{id, x, y}`, so the cell each one is seated in is doing all the work. The
     claim is that the second is grouped exactly like the first: the grid is the
     formation whether the fitting came off it or was dropped onto it, and where
     a lamp came from is not a question the wiring asks. */
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const auto = wire(g).flows.filter((f) => f.kind === 'row');
  const lamps = g.lights.map((l, i) => ({ id: `cob-${i}`, roomId: 'r1', x: l.x, y: l.y }));
  const hand = wire({ ...g, lights: [] }, { lamps }).flows.filter((f) => f.kind === 'row');

  ok(auto.length === 2 && hand.length === 2,
    `hand-placed lamps come out as the same two rows (got ${hand.length})`);
  ok(hand.every((f) => f.count === 4), 'four lamps on each');
  ok(hand.map((f) => f.id).join() === auto.map((f) => f.id).join(),
    'with the same ids — the same chunks, the same row numbers, so a stored'
    + ' override still names the wire it was dragged onto');
  ok(hand.every((f) => new Set(f.nodes.map((n) => n.y.toFixed(3))).size === 1),
    'and each row still runs along the length rather than across it');
  ok(hand.every((f) => f.boardId), 'every one of them reaches a plate');
  ok(hand.every((f) => f.nodes.every((n) => n.what === 'a downlight')),
    'and each is called a downlight, which is what it is');

  // NOT CLUSTERED BY DISTANCE, which is the rule this is not. The lamps in one
  // row are about seven feet apart and the rows about six, so a 6 ft
  // single-link cluster would chain some or all of the eight into one flow.
  // Two rows of four is the answer; one switch for the room is not.
  ok(!hand.some((f) => f.count === 8), 'and the ceiling is not one flow of eight');
}

console.log('\n-- a lamp standing on no cell falls back to proximity --');
{
  /* 16 x 14 ft WITH A BED IN IT, which is how a real ceiling comes to have a
     patch with no grid on it: the bed is a no-light zone, so the chunker cuts
     round it and there are no cells over the mattress at all. A hand can still
     drop a lamp there — nothing stops it, and the ceiling over a bed is often
     the only place the wall behind it can be lit from — so that lamp has no row
     to be in and has to be switched some other way. */
  const g = lay([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 14 }, { x: 0, y: 14 }],
    { zones: [{ x0: 5, y0: 0, x1: 11, y1: 7, cls: 'bed' }] });
  const off = (x, y, id) => ({ id, roomId: 'r1', x: x * PPF, y: y * PPF });
  const onGrid = (p) => g.cells.some((c) => p.x >= c.x0 && p.x <= c.x1
                                         && p.y >= c.y0 && p.y <= c.y1);

  // TWO OVER THE BED WITHIN REACH OF EACH OTHER, ONE OVER IT BEYOND REACH, and
  // a fourth out on the ordinary ceiling to prove the two rules do not mix.
  const a = off(5.5, 0.5, 'cob-a'), b = off(6.5, 1.5, 'cob-b');
  const c = off(10.5, 6.5, 'cob-c'), d = off(2, 3, 'cob-d');
  ok(![a, b, c].some(onGrid) && onGrid(d),
    'the three over the bed stand on no cell; the fourth stands on one');

  const { flows, notes } = wire({ ...g, lights: [] }, { lamps: [a, b, c, d] });
  const stray = flows.filter((f) => f.kind === 'lamps');
  ok(stray.length === 2, `two clusters over the bed, so two flows (got ${stray.length})`);
  ok(stray.some((f) => f.count === 2) && stray.some((f) => f.count === 1),
    'the pair within 6 ft is one switch and the far one is its own');
  ok(stray.every((f) => f.boardId), 'and both reach a plate');
  ok(!notes.some((n) => n.includes('belongs to no chunk')),
    'none of them was silently dropped with a note');

  /* AND THE ONE ON THE GRID IS ROWED, not clustered — even though it is 5.1 ft
     from `a` and would have joined that cluster on distance alone. Seating
     comes first, which is the whole order of the rule. */
  const rows = flows.filter((f) => f.kind === 'row');
  ok(rows.length === 1 && rows[0].count === 1,
    `the lamp on a cell is a row of its own (got ${rows.length} rows)`);
  ok(!stray.some((f) => f.nodes.some((n) => n.id === 'cob-d')),
    'and it is not in either cluster, though it is within reach of one');

  // A ROOM THE CHUNKER CUT AND A ROOM IT DID NOT ARE THE SAME RULE. With no
  // grid at all every lamp is a stray, and the pair is still one switch.
  const bare = planFlows({ room: g.room, bays: g.bays, pxPerFt: PPF,
                           lamps: [a, b, c] });
  ok(bare.flows.filter((f) => f.kind === 'lamps').length === 2,
    'with no grid at all, the same two clusters');
}

console.log('\n-- and the lamps are counted as modules on the plate --');
{
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const lamps = g.lights.map((l, i) => ({ id: `cob-${i}`, roomId: 'r1', x: l.x, y: l.y }));
  const { flows } = wire({ ...g, lights: [] }, { lamps });
  const boardId = flows[0]?.boardId;
  const units = pointsFromFlows(COUNTRIES.IN, flows, boardId);
  ok(units.length === flows.filter((f) => f.boardId === boardId).length,
    `one switch module per flow on that plate (got ${units.length})`);
  ok(units.every((u) => u.kind === 'switch'), 'and every one of them is a switch');
  ok(flowSummary(flows).fittings === lamps.length,
    `every lamp on the ceiling is on a flow (got ${flowSummary(flows).fittings}`
    + ` of ${lamps.length})`);
}

console.log('\n-- a hand re-plugs an input --');
{
  /* ONE INPUT, MANY OUTPUTS. `links` is fitting id -> the fitting its input now
     comes from, so re-plugging is a map write and a second wire into one
     fitting is not expressible. See `relink` in flows.js. */
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const board = { id: 'b1', point: { x: 0, y: 6 * PPF }, serves: 'room', servesShort: 'Door' };
  const plain = wire(g, { boards: [board] });
  const rows = plain.flows.filter((f) => f.nodes.length > 1);
  ok(rows.length >= 2, `${rows.length} multi-fitting flows to work with`);

  const [A, B] = rows;
  const parent = A.nodes[0].id, child = B.nodes[0].id;
  const before = { a: A.count, b: B.count };

  const one = wire(g, { boards: [board], links: { [child]: parent } });
  const a2 = one.flows.find((f) => f.nodes.some((n) => n.id === parent));
  const b2 = one.flows.find((f) => f.id === B.id);
  ok(a2.count === before.a + 1, `the parent's flow gained one (${before.a} -> ${a2.count})`);
  ok(b2.count === before.b - 1, `the child's old flow lost one (${before.b} -> ${b2.count})`);
  ok(!b2.nodes.some((n) => n.id === child), 'and no longer carries it');

  /* THE CHILD SITS IMMEDIATELY AFTER ITS PARENT, because the drawn chain is the
     wire: the loop reaches the parent, then the fitting looped off it. */
  const idx = a2.nodes.findIndex((n) => n.id === parent);
  ok(a2.nodes[idx + 1]?.id === child, 'and it is seated directly after its parent');
  ok(a2.path && a2.legs.length === a2.nodes.length,
    're-seating re-paths the flow rather than leaving the old arcs');

  /* A SUBTREE TRAVELS WITH ITS PARENT — a wire does not come apart in the
     middle because its far end was re-plugged. */
  const third = B.nodes[1].id;
  const chain = wire(g, { boards: [board], links: { [child]: parent, [third]: child } });
  const a3 = chain.flows.find((f) => f.nodes.some((n) => n.id === parent));
  const i3 = a3.nodes.findIndex((n) => n.id === parent);
  ok(a3.nodes[i3 + 1]?.id === child && a3.nodes[i3 + 2]?.id === third,
    'a chain of two arrives in order, parent then child then grandchild');

  /* A FLOW EVERY FITTING LEFT IS NO FLOW — keeping it would put a module on a
     plate for a switch that controls nothing, and flowSummary bills for it. */
  const all = Object.fromEntries(B.nodes.map((n) => [n.id, parent]));
  const drained = wire(g, { boards: [board], links: all });
  ok(!drained.flows.some((f) => f.id === B.id), 'a flow nothing is left on disappears');
  ok(drained.flows.length === plain.flows.length - 1, '...and the count drops by exactly one');

  /* CYCLES ARE DROPPED QUIETLY. Two ordinary drags can make one, and a modal in
     the middle of a gesture is not the answer. */
  const loop = wire(g, { boards: [board], links: { [child]: parent, [parent]: child } });
  ok(loop.flows.length === plain.flows.length, 'a cycle leaves the flows exactly as they were');

  /* AND THE WAY BACK COSTS NOTHING, which is the point of overriding the RESULT
     rather than disabling the rules: no entry, no effect. */
  const undone = wire(g, { boards: [board], links: {} });
  ok(undone.flows.length === plain.flows.length
     && undone.flows.every((f, i) => f.count === plain.flows[i].count),
    'unlinking restores the rules exactly, with no state to unwind');

  ok(wire(g, { boards: [board], links: { [child]: 'no-such-fitting' } })
       .flows.length === plain.flows.length,
    'a link to a fitting that is not on this ceiling is ignored');

  /* CUTTING ONE LINK RETURNS ITS FITTING AND KEEPS WHAT HANGS OFF IT — the
     guarantee the unlink badge on a leg makes. The badge cuts the input of the
     fitting the wire runs TO; that fitting goes back to its own switch, and
     everything IT feeds keeps feeding from it, because those are separate
     entries that name it and cutting this one does not touch them. */
  {
    const both = wire(g, { boards: [board], links: { [child]: parent, [third]: child } });
    const joined = both.flows.find((f) => f.nodes.some((n) => n.id === parent));
    ok(joined.nodes.some((n) => n.id === third),
      'with both links, the grandchild rides along into the parent\'s flow');

    // …now the badge on the parent->child leg is pressed. Only that entry goes.
    const cut = wire(g, { boards: [board], links: { [third]: child } });
    const homeOf = (id) => cut.flows.find((f) => f.nodes.some((n) => n.id === id));
    const back = homeOf(child);
    ok(back.id === B.id, 'the cut fitting is back on the flow the rules gave it');
    ok(!homeOf(parent).nodes.some((n) => n.id === child),
      '...and off the one it had been linked into');
    ok(homeOf(third) === back,
      'and the fitting IT feeds came back with it — outward flows are intact');
    ok(back.nodes.findIndex((n) => n.id === third)
       === back.nodes.findIndex((n) => n.id === child) + 1,
      '...still seated directly after it');
  }
}

console.log('\n-- a fitting stood on its own --');
{
  /* `null` IS THE THIRD STATE: absent means the rules decide, a fitting id means
     fed from that fitting, and null means DETACHED — its own switch, straight
     off the plate. See `relink`. */
  const g = lay([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const board = { id: 'b1', point: { x: 0, y: 6 * PPF }, serves: 'room', servesShort: 'Door' };
  const plain = wire(g, { boards: [board] });
  const row = plain.flows.filter((f) => f.nodes.length > 2)[0];
  const ids = row.nodes.map((n) => n.id);
  const one = ids[1];

  const cut = wire(g, { boards: [board], links: { [one]: null } });
  const own = cut.flows.find((f) => f.nodes[0]?.id === one);
  ok(!!own, 'the detached fitting heads a flow of its own');
  ok(cut.flows.length === plain.flows.length + 1,
    'which is one MORE switch than before — a flow is one switch, so the plate gains a module');

  /* THE CHAIN IS CUT, NOT PICKED AT. Everything from the detach point onward
     goes with it: those fittings' inputs come from it and cutting ITS input
     said nothing about theirs. The row keeps only what was upstream. */
  const rest = cut.flows.find((f) => f.id === row.id);
  ok(rest.count === 1 && rest.nodes[0].id === ids[0],
    'the row keeps only what was before the cut');
  ok(own.nodes.map((n) => n.id).join() === ids.slice(1).join(),
    'and everything after it travelled, in the same order');
  ok(!rest.nodes.some((n) => ids.slice(1).includes(n.id)),
    '...so the wire does not close up across the gap');

  /* STRAIGHT OFF THE PLATE: it keeps the board that switches that ceiling, and
     it is drawn running back to it. */
  ok(own.boardId === row.boardId, 'it is switched from the same plate the row is');
  ok(own.from && own.legs[0]?.feed, 'and its first leg is the feed off that plate');
  ok(!own.assigned, 'nobody moved it there by hand, so it is not marked as moved');

  /* THE ID IS MINTED FROM THE FITTING, so a board reassignment or a bend can key
     on it and survive a re-grid. */
  ok(own.id.includes(one) && own.id !== row.id, `its id names the fitting — ${own.id}`);

  /* CUTTING THE LAST LEG TAKES ONE FITTING, which is the same rule and not a
     special case — there is simply nothing after it. */
  const tail = wire(g, { boards: [board], links: { [ids[ids.length - 1]]: null } });
  const solo = tail.flows.find((f) => f.nodes[0]?.id === ids[ids.length - 1]);
  ok(solo.count === 1, 'detaching the far end of a row takes just that fitting');

  /* TWO CUTS, THREE SWITCHES. The segments are independent. */
  const twice = wire(g, { boards: [board], links: { [ids[1]]: null, [ids[2]]: null } });
  ok(twice.flows.length === plain.flows.length + 2, 'two cuts make two more switches');
  ok(twice.flows.find((f) => f.nodes[0]?.id === ids[1]).count === 1,
    '...and the first segment stops where the second begins');

  /* A RE-PLUGGED FITTING IS NOT DRAGGED ALONG BY A CUT. It said outright where
     its input comes from, which outranks where it happens to sit in a row. */
  const pinned = wire(g, { boards: [board],
    links: { [ids[1]]: null, [ids[2]]: ids[0] } });
  const seg = pinned.flows.find((f) => f.nodes[0]?.id === ids[1]);
  ok(!seg.nodes.some((n) => n.id === ids[2]),
    'a fitting wired into another chain stays there when an earlier wire is cut');
  ok(pinned.flows.find((f) => f.id === row.id).nodes.some((n) => n.id === ids[2]),
    '...on the flow its own link named');

  /* WHAT IT FEEDS COMES WITH IT — the hand-drawn case, spliced in behind it. */
  const fed = wire(g, { boards: [board],
    links: { [ids[1]]: null, [ids[0]]: ids[1] } });
  const carry = fed.flows.find((f) => f.nodes[0]?.id === ids[1]);
  ok(carry.nodes[1]?.id === ids[0],
    'a fitting looped off the detached one rides onto the new switch behind it');

  /* AND THE WAY BACK IS STILL FREE — no entry, no effect. */
  const undone = wire(g, { boards: [board], links: {} });
  ok(undone.flows.length === plain.flows.length,
    'removing the entry puts it back under the rules with nothing to unwind');
  ok(wire(g, { boards: [board], links: { 'no-such-fitting': null } }).flows.length
     === plain.flows.length, 'detaching something that is not on this ceiling does nothing');
}

console.log('\n-- nothing at all --');
{
  ok(planFlows({}).flows.length === 0, 'no room, no flows');
  ok(planFlows({ room: { id: 'x', polygonPx: [] } }).flows.length === 0, 'no outline, no flows');
}

console.log(fail ? `\n${fail} failing` : '\nall good');
process.exit(fail ? 1 : 0);
