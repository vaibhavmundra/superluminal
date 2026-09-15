// ---------------------------------------------------------------------------
// test-wall-unit.mjs — the split AC on its wall, and the thing that feeds it.
//
// WHAT THIS FILE IS ABOUT IS THE TWO THINGS A PERSON ACTUALLY ASKED FOR:
// a unit that takes its ORIENTATION from the wall it lands on without anybody
// touching a rotation grip, and a feed that lands where the specification says
// it lands — behind the body if it is a point, a foot clear of it if it is a
// socket. The arithmetic is checked in service of those, not for itself.
//
//   node tools/test-wall-unit.mjs
// ---------------------------------------------------------------------------

import {
  WALL_UNIT_KINDS, isWallUnit, isSeated, FEED_SOCKET, FEED_POINT, AC_FEED,
  feedOf, AC_MIN_A, AC_AMPS, acRatings, acAmpsFor, AC_SOCKET_CLEAR_FT,
  seatWallUnit, nearestWallUnitSFt, resolveWallUnitPx, feedSFt, acLead,
} from '../src/lib/wallUnit.js';
import { wallHostFor, placedBoards, asOutlet, boardU, AC_BOARD_ROLE, AC_HEIGHT_MM }
  from '../src/lib/electrical.js';
import { COUNTRIES, composeSwitchboard } from '../src/lib/switchboards.js';
import { planSwitchboards, planChunkBoards } from '../src/lib/electrical.js';
import { makeWallUnit } from '../src/lib/ceilingObjects.js';
import { projectObstaclesPx } from '../src/lib/planProjection.js';
import { projectFlowsPx } from '../src/lib/electricalProjection.js';
import { projectElecPointsPx, wallPoint } from '../src/lib/elecPoints.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const deg = (r) => (r * 180) / Math.PI;

const PPF = 30.48;
const W = 20 * PPF, H = 12 * PPF;
// Wound clockwise in screen coordinates (y down), which is what the tracer emits.
const ROOM = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const HOST = wallHostFor(ROOM, PPF);
const AC = { id: 'a1', typeId: 'split_ac', kind: 'split_ac',
             wFt: 1000 / 304.8, hFt: 250 / 304.8 };
const BODY = AC.wFt * PPF;

console.log('\n-- what a wall unit is, and what says so --');
{
  ok(WALL_UNIT_KINDS.has('split_ac'), 'the split unit hangs on a wall');
  ok(!WALL_UNIT_KINDS.has('ac'),
    'and the CASSETTE does not — it is in the ceiling and the grid keeps off it');
  ok(isWallUnit({ kind: 'split_ac' }) && !isWallUnit({ kind: 'fan' }),
    'the kind is what answers');

  ok(isSeated({ sFt: 4 }) && !isSeated({ x: 3, y: 2 }),
    'and the RECORD says whether one is seated, not the catalogue');
  ok(!isSeated({ sFt: null }) && !isSeated({}),
    'a unit from before this existed is not seated, and that is not an error');
}

console.log('\n-- the orientation is the wall’s, and nobody turns a grip --');
{
  /* THE WHOLE COMPLAINT, AS AN ASSERTION. Four seats, one per wall, and the
     angle each comes back at is the angle of the plaster under it. */
  const walls = [
    { sFt: 5, name: 'the top wall' },
    { sFt: 20 + 3, name: 'the right wall' },
    { sFt: 20 + 12 + 5, name: 'the bottom wall' },
    { sFt: 20 + 12 + 20 + 3, name: 'the left wall' },
  ];
  const angles = walls.map((w) => {
    const seat = seatWallUnit(w.sFt, HOST, BODY);
    return seat ? Math.round(deg(seat.rot)) : null;
  });
  ok(angles.every((a) => a != null), 'every wall seats the unit');
  /* FOUR DIFFERENT ANGLES, NINETY APART. The exact four depend on which
     corner `wallRuns` starts at and which way it walks, which is not this
     file's business — what IS its business is that they are four distinct
     right angles and not one repeated. */
  const norm = angles.map((a) => ((a % 180) + 180) % 180);
  ok(new Set(norm).size === 2 && norm.every((a) => a === 0 || a === 90),
    `the four walls give two axes, ninety apart (${angles.join('°, ')}°)`);

  const seat = seatWallUnit(5, HOST, BODY);
  ok(near(Math.hypot(seat.along.x, seat.along.y), 1, 1e-9)
    && near(Math.hypot(seat.inward.x, seat.inward.y), 1, 1e-9),
    'the frame comes back as unit vectors');
  ok(near(seat.along.x * seat.inward.x + seat.along.y * seat.inward.y, 0, 1e-9),
    'and inward is square to the run');
}

console.log('\n-- the body stands OFF the plaster, into the room --');
{
  const o = { ...AC, sFt: 5 };
  const r = resolveWallUnitPx(o, HOST, PPF);
  const seat = seatWallUnit(5, HOST, BODY);
  const deep = (AC.hFt * PPF) / 2;
  ok(near(r.x, seat.point.x + seat.inward.x * deep, 1e-9)
    && near(r.y, seat.point.y + seat.inward.y * deep, 1e-9),
    'the centre is half the unit’s depth in from the wall line');
  /* AND THAT IS INSIDE THE ROOM. A body centred ON the wall would be drawn
     half inside the plaster; the test is that the centre is strictly within
     the outline, which is the thing a reader would notice was wrong. */
  ok(r.x > 0 && r.x < W && r.y > 0 && r.y < H,
    'and the centre is inside the room, not buried in the wall');
  ok(near(r.rot, seat.rot, 1e-9), 'and the rotation is the seat’s');
}

console.log('\n-- an unseated unit keeps its own coordinate, untouched --');
{
  const old = { ...AC, x: 7, y: 4, rot: 0.6 };
  const r = resolveWallUnitPx(old, HOST, PPF);
  ok(near(r.x, 7 * PPF) && near(r.y, 4 * PPF), 'feet times the scale, as before');
  ok(near(r.rot, 0.6), 'and the rotation somebody set by hand survives');
  ok(r.seat === null, 'and it has no seat, which is what marks it as the old kind');
  ok(resolveWallUnitPx({ ...AC }, HOST, PPF) === null,
    'a unit with neither a seat nor a coordinate resolves to nothing at all');
  ok(resolveWallUnitPx({ ...AC, sFt: 5 }, null, PPF) === null,
    '...and so does a seated one whose room has gone');
}

console.log('\n-- the pointer and the drag are ONE projection --');
{
  /* A POINTER NEAR THE TOP WALL COMES BACK ON THE TOP WALL, and the seat that
     distance resolves to is under the pointer. That round trip is the whole
     contract: place and drag both go through it, so they cannot disagree. */
  const p = { x: 8 * PPF, y: 0.4 * PPF };
  const sFt = nearestWallUnitSFt(p, HOST, BODY);
  ok(sFt != null, 'a pointer near a wall projects onto it');
  const seat = seatWallUnit(sFt, HOST, BODY);
  ok(near(seat.point.y, 0, 1e-6), 'and lands on the wall it was nearest');
  ok(Math.abs(seat.point.x - p.x) < 1e-6,
    'at the place along it the pointer actually pointed');

  /* AND IT IS HELD BACK FROM THE CORNER BY HALF A BODY. A pointer jammed into
     the corner cannot seat the unit hanging off the end of the wall. */
  const corner = nearestWallUnitSFt({ x: 0.05 * PPF, y: 0.2 * PPF }, HOST, BODY);
  const cs = seatWallUnit(corner, HOST, BODY);
  const halfFt = AC.wFt / 2;
  const alongFt = Math.min(cs.t, cs.seg.length - cs.t) / PPF;
  ok(alongFt >= halfFt - 1e-6,
    `the body cannot overhang a corner (${alongFt.toFixed(2)}ft clear, needs ${halfFt.toFixed(2)})`);
}

console.log('\n-- a POINT feed sits behind the unit, centred on it --');
{
  const o = { ...AC, sFt: 6, feed: FEED_POINT };
  ok(feedOf(o) === FEED_POINT, 'the record says which feed it has');
  ok(near(feedSFt(o, HOST, PPF), 6),
    'and a point is at the unit’s own distance — behind the body, centred');
}

console.log('\n-- ...and a SOCKET feed a foot clear of the body --');
{
  const o = { ...AC, sFt: 6, feed: FEED_SOCKET };
  ok(feedOf(o) === FEED_SOCKET && feedOf({}) === AC_FEED,
    'a record that has not said takes the default, which is the socket');
  const s = feedSFt(o, HOST, PPF);
  const gap = Math.abs(s - 6);
  ok(near(gap, AC.wFt / 2 + AC_SOCKET_CLEAR_FT, 1e-6),
    `half the body plus a foot from centre (${gap.toFixed(3)}ft)`);
  /* WHICH IS THE THING THAT WAS ASKED FOR, said the other way round: the gap
     between the socket and the EDGE of the casing is one foot exactly. */
  ok(near(gap - AC.wFt / 2, AC_SOCKET_CLEAR_FT, 1e-6),
    'which is one foot clear of the casing, which is the specification');

  /* AND IT TAKES THE SIDE THAT HAS PLASTER. A unit pushed hard against the
     left corner has no room to its left, so the socket goes right. */
  const tight = { ...AC, sFt: AC.wFt / 2, feed: FEED_SOCKET };
  const ts = feedSFt(tight, HOST, PPF);
  ok(ts > tight.sFt, 'a unit against a corner puts its socket on the open side');

  const far = { ...AC, sFt: 20 - AC.wFt / 2, feed: FEED_SOCKET };
  ok(feedSFt(far, HOST, PPF) < far.sFt,
    '...and one against the far corner puts it on the other open side');
}

console.log('\n-- the rating: 20A, and never a light switch --');
{
  ok(AC_AMPS === 20 && AC_MIN_A === 16, 'twenty by default, sixteen as the floor');
  const IN = acRatings(COUNTRIES.IN);
  ok(JSON.stringify(IN) === JSON.stringify([16, 20, 32]),
    `India offers 16, 20 and 32 and not the 6A light switch (${IN.join('/')})`);
  ok(!IN.includes(6), 'the floor is what takes the 6 out');
  ok(acAmpsFor(COUNTRIES.IN) === 20, 'and it opens at 20');

  const US = acRatings(COUNTRIES.US);
  ok(US.every((a) => a >= AC_MIN_A) && US.includes(20),
    `the United States offers what it sells over the floor (${US.join('/')})`);
  ok(acAmpsFor(COUNTRIES.US) === 20, 'and opens at 20 there too');

  /* A COUNTRY WITH NOTHING OVER THE FLOOR STILL ANSWERS. An empty control is
     worse than the honest answer, which is the biggest rating sold. */
  const small = acRatings({ switchRatings: [5, 10] });
  ok(JSON.stringify(small) === JSON.stringify([10]),
    'and a country with nothing over the floor offers its largest');
  ok(acRatings({}).length === 0 && acAmpsFor({}) === AC_AMPS,
    'a country with no list at all is empty rather than a throw');
}

console.log('\n-- THE WHOLE CHAIN: a press, a unit on a wall, a supply, a switch --');
{
  /* THE JOINS AND NOT THE ARITHMETIC. Everything above proves one function at
     a time; this drives the real sequence a press sets off — seat the unit,
     project it into plan pixels, seat its supply, and follow that supply
     through the flow pass onto a switchboard — because that is where a feature
     assembled out of correct pieces actually breaks. */
  const room = { id: 'r1', polygonPx: ROOM };
  const doors = [{ id: 'd1', cls: 'door', conf: 0.99,
                   rect: { x0: -18, y0: 2 * PPF, x1: 90, y1: 2 * PPF + 108 } }];
  const sb = planSwitchboards({ room, rooms: [room], doors, pxPerFt: PPF, rules: ['door'] });
  const live = sb.boards.filter((b) => !b.rejected && b.point);
  const bays = [{ key: 'room', rect: { x0: 0, y0: 0, x1: W, y1: H } }];
  const cb = planChunkBoards({ room, bays, boards: live, pxPerFt: PPF });
  const bayBoardId = cb.owner.get('room');
  const rooms = [{ id: 'r1', plan: { ok: true, polygonPx: ROOM, chunksPx: [], cellsPx: [],
                                     lightsPx: [], tracksPx: [], zonesPx: [] } }];

  // 1. THE PRESS. A pointer aimed at the top wall, eight feet along.
  //    `HOSTDIR` is that wall's own direction, used below to ask which END of
  //    the unit the lead leaves — a question that only means anything along it.
  const HOSTDIR = { x: 1, y: 0 };
  const p = { x: 8 * PPF, y: 0.5 * PPF };
  const sFt = nearestWallUnitSFt(p, HOST, BODY);
  const unit = makeWallUnit('split_ac', { roomId: 'r1', sFt, feed: FEED_SOCKET });
  ok(unit.x === null && unit.y === null && unit.rot === null,
    'the record stores a seat and NO coordinate, which is what kills the rotate grip');
  ok(Number.isFinite(unit.sFt), '...and the seat is the only position on it');

  // 2. THE PROJECTION, which is what the canvas draws.
  const [px1] = projectObstaclesPx([unit], PPF, () => HOST);
  ok(px1 && Number.isFinite(px1.x) && Number.isFinite(px1.y),
    'the projection resolves it to real plan pixels');
  ok(px1.onWall === true, 'and marks it as held by a wall, which is what hides the grip');
  ok(Math.abs(px1.y - (0 + (AC.hFt * PPF) / 2)) < 1e-6,
    'the body stands against the top wall, its own depth thick');
  ok(Math.abs(px1.rot % Math.PI) < 1e-9,
    `and takes that wall's angle with nobody turning anything (${Math.round(deg(px1.rot))}°)`);
  ok(Math.abs(px1.x - p.x) < 1e-6, 'at the place along the wall the press pointed');

  /* AND A UNIT ON A SIDE WALL COMES OUT SQUARE TO IT — the same record shape,
     a different wall, and no second gesture in between. */
  const side = makeWallUnit('split_ac', {
    roomId: 'r1', sFt: nearestWallUnitSFt({ x: W - 0.5 * PPF, y: 6 * PPF }, HOST, BODY),
    feed: FEED_SOCKET });
  const [px2] = projectObstaclesPx([side], PPF, () => HOST);
  ok(Math.abs(Math.abs(px2.rot) - Math.PI / 2) < 1e-9,
    'a unit on the side wall is square to THAT wall, from the same one press');

  // 3. THE SUPPLY. A socket, a foot clear, as a plate on the same walls.
  const socketSFt = feedSFt(unit, HOST, PPF);
  const [plate] = placedBoards(
    [{ id: 'mb1', roomId: 'r1', sFt: socketSFt, role: AC_BOARD_ROLE }],
    { polygonPx: ROOM, pxPerFt: PPF });
  ok(plate, 'the socket seats as a plate on the same walls');
  ok(plate.heightsMm[0] === AC_HEIGHT_MM,
    `and at the unit's own height, not above the skirting (${plate.heightsMm[0]}mm)`);
  ok(plate.servesShort === 'AC', 'and its card says what it is for');
  const gapFt = Math.hypot(plate.point.x - px1.x, plate.point.y - px1.y) / PPF;
  ok(gapFt > AC.wFt / 2, `and it is clear of the casing (${gapFt.toFixed(2)}ft from centre)`);

  // 4. THE FLOW. The socket is an outlet, so its SWITCH lands on the bay's board.
  const outlet = asOutlet(plate, 20);
  const boards = [...live, ...cb.boards];
  const flows = projectFlowsPx(rooms,
    (r) => (r.id === 'r1' ? live : []), (r) => (r.id === 'r1' ? cb.boards : []),
    { r1: { owner: cb.owner } }, [], [], [], {}, PPF,
    (r) => (r.id === 'r1' ? bays : []),
    [...boards, outlet], (r) => (r.id === 'r1' ? [outlet] : []), {}, {}, [], {}, []);
  const wire = flows.find((f) => f.kind === 'socket');
  ok(wire, 'the socket produces a wire of its own');
  ok(wire && wire.boardId === bayBoardId,
    'which runs to the board the room\u2019s BAY is switched from');
  const [sw] = composeSwitchboard({ country: 'IN', flows, boardId: bayBoardId }).boards;
  const made = sw.points.filter((q) => q.kind === 'switch' && q.source === 'design');
  ok(made.some((q) => q.amps === 20),
    'and that board grows a 20A switch for it, not a 6A light switch');
  ok(!sw.points.some((q) => q.kind === 'socket' && q.source === 'design'),
    'and no socket on the board — the socket is on the wall by the unit');

  // 5. THE FLEX BETWEEN THEM, which is the only part of this a reader sees.
  const leg = acLead(px1, plate);
  ok(leg, 'a socket-connected unit gets a lead drawn to its socket');
  /* IT LEAVES THE CASING AND NOT THE MIDDLE OF IT. The start is on the body's
     edge, so the distance from the unit's centre is exactly half its width. */
  ok(near(Math.hypot(leg.from.x - px1.x, leg.from.y - px1.y), (AC.wFt / 2) * PPF, 1e-6),
    'starting on the body\u2019s near edge, not out of the middle of it');
  /* AND IT LEAVES THE END THE SOCKET IS ON. Projected onto the wall, the start
     has to lie between the unit's centre and the plate — never the far side. */
  const along = HOSTDIR;
  const toPlate = (plate.point.x - px1.x) * along.x + (plate.point.y - px1.y) * along.y;
  const toStart = (leg.from.x - px1.x) * along.x + (leg.from.y - px1.y) * along.y;
  ok(toStart * toPlate > 0, 'and leaving the end of the unit the socket is on');
  ok(Math.abs(toStart) < Math.abs(toPlate),
    '...and stopping short of it, so the lead has a length to draw');
  const runFt = Math.hypot(leg.to.x - leg.from.x, leg.to.y - leg.from.y) / PPF;
  ok(runFt > 0.5 && runFt < AC_SOCKET_CLEAR_FT * 1.6,
    `and it is SHORT — about the foot of clearance (${runFt.toFixed(2)}ft)`);

  /* AND THERE IS NO LEAD FOR A POINT, which is not an omission: the point is
     behind the body, so the line would run from the unit to itself. */
  ok(acLead({ ...px1, feed: FEED_POINT }, plate) === null,
    'a point-connected unit draws no lead — there is nothing between them');
  ok(acLead(px1, null) === null && acLead({ ...px1, seat: null }, plate) === null,
    'and neither does a unit with no socket, or one with no seat');

  // 6. ...AND THE OTHER FEED, which is the same chain with the mark moved.
  const pointUnit = { ...unit, feed: FEED_POINT };
  const pSFt = feedSFt(pointUnit, HOST, PPF);
  ok(near(pSFt, unit.sFt),
    'switching to a point puts it behind the unit, centred — no other change');
  const ep = projectElecPointsPx(
    [wallPoint('r1', boardU(pSFt, HOST), { id: 'ep1', heightMm: AC_HEIGHT_MM, amps: 20 })],
    () => HOST, PPF);
  ok(ep.length === 1, 'the point resolves onto the same walls');
  ok(Math.hypot(ep[0].foot.x - px1.x, ep[0].foot.y - 0) < 1e-6,
    'and its foot is on the plaster the unit\u2019s own centre stands off');
  const pFlows = projectFlowsPx(rooms,
    (r) => (r.id === 'r1' ? live : []), (r) => (r.id === 'r1' ? cb.boards : []),
    { r1: { owner: cb.owner } }, [], [], [], {}, PPF,
    (r) => (r.id === 'r1' ? bays : []), boards, () => [], {}, {}, [], {}, ep);
  const pw = pFlows.find((f) => f.kind === 'point');
  ok(pw && pw.boardId === bayBoardId, 'and it runs to the same bay board');
  const [pb] = composeSwitchboard({ country: 'IN', flows: pFlows, boardId: bayBoardId }).boards;
  ok(pb.points.some((q) => q.kind === 'switch' && q.amps === 20),
    'and grows the same 20A switch there');
}

console.log(fail ? `\n${fail} failing` : '\nall good');
process.exit(fail ? 1 : 0);
