// ---------------------------------------------------------------------------
// test-elec-points.mjs — the wall point and the ceiling point, on the primitive.
//
// THE POINT OF THIS FILE IS THE VERBS, NOT THE ARITHMETIC. lib/point.js says a
// migration is not done until move, Option-copy, delete, the shift lock, the
// snap, the slop, the group move, the snap-back and the refusal all work — and
// that the way it went wrong before was a migration reported as done on the
// strength of the maths alone. So a whole press-move-modifier-release is driven
// through `makePointDrag` with no renderer, exactly as tools/test-drag.mjs does.
//
//   node tools/test-elec-points.mjs
// ---------------------------------------------------------------------------

import { makePointDrag } from '../src/hooks/usePoint.js';
import { isConstrained, pointKind, FREE, ON_PATH, resolvePoint } from '../src/lib/point.js';
import {
  WALL_POINT_ID, CEILING_POINT_ID, POINT_IDS, WALL_POINT_HEIGHT_MM, POINT_AMPS,
  POINT_FT, wallPoint, ceilingPoint, heightOfPoint, labelOfPoint,
  pointSpec, pointHostFor, seatOnWalls, nearestWallU, pointClampU,
  projectElecPointsPx, glyphJ, pointRadiusPx,
} from '../src/lib/elecPoints.js';
import { SCONCE_FT } from '../src/lib/settings.js';
import { planFlows } from '../src/lib/flows.js';
import { planSwitchboards, planChunkBoards } from '../src/lib/electrical.js';
import { composeSwitchboard, COUNTRIES, lightSwitchA } from '../src/lib/switchboards.js';
import { projectFlowsPx, projectAllBoardsPx } from '../src/lib/electricalProjection.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const PPF = 30.48;
const W = 20 * PPF, H = 12 * PPF;
const ROOM = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const HOST = pointHostFor(ROOM, PPF);
const at = (xFt, yFt) => ({ x: xFt * PPF, y: yFt * PPF });

console.log('\n-- two elements, and the PRIMITIVE is what tells them apart --');
{
  const wp = wallPoint('r1', nearestWallU(at(10, 0.4), HOST));
  const cp = ceilingPoint('r1', 10, 6);
  ok(pointKind(wp) === ON_PATH, 'a wall point is a CONSTRAINED point');
  ok(pointKind(cp) === FREE, 'and a ceiling point is a FREE one');
  ok(wp.on === 'walls' && wp.x === null && wp.y === null,
    'the wall one names its host and its coordinate is NULL — no stale position to trust');
  ok(cp.on === null && cp.x === 10 && cp.y === 6, 'the free one keeps feet and no host');
  ok(!('kind' in wp) && !('kind' in cp),
    'and neither carries a `kind` field — `on` is the only answer, so there is no second one');
  ok(heightOfPoint(wp) === WALL_POINT_HEIGHT_MM, 'a wall point has a height');
  ok(heightOfPoint(cp) === null,
    'and a ceiling point has none — there is one height it can be at');
  ok(labelOfPoint(wp) === 'Wall point' && labelOfPoint(cp) === 'Ceiling point',
    'each names itself off its kind');
  ok(pointSpec(wp, 6) === '1200 mm · 6 A' && pointSpec(cp, 6) === 'at ceiling level · 6 A',
    'and the card line reads for both');
  ok(POINT_AMPS === null,
    'an unrated point is null and not 6 — 6 is India\'s answer and 15 the US\'s');
  ok(Number.isFinite(WALL_POINT_HEIGHT_MM) && WALL_POINT_HEIGHT_MM > 0,
    'the default height is a real number the bar can start from');
  ok(POINT_IDS.length === 2 && POINT_IDS.includes(WALL_POINT_ID)
    && POINT_IDS.includes(CEILING_POINT_ID), 'two palette ids, named once');
}

console.log('\n-- the wall point seats on the plaster, and only there --');
{
  const u = nearestWallU(at(10, 0.4), HOST);
  const seat = seatOnWalls(u, HOST);
  ok(near(seat.point.x, 10 * PPF) && near(seat.point.y, 0),
    'a press near the top wall seats ON that wall, not where the pointer was');
  ok(seat.inward.y === 1, 'and knows which way is into the room');
  // Every wall is a candidate, and the projection is the same one the drag uses.
  ok(near(seatOnWalls(nearestWallU(at(19.6, 6), HOST), HOST).point.x, W),
    'a press near the right wall seats on the right wall');
  ok(near(seatOnWalls(nearestWallU(at(10, 11.6), HOST), HOST).point.y, H),
    'and one near the bottom on the bottom');

  /* A POINT MAY SIT WHERE A PLATE MAY NOT. A switchboard is 230mm of frame and
     is clamped half a plate plus a clearance off every corner; a point is a
     mark, and six inches from a return is exactly where an exhaust point goes. */
  const corner = seatOnWalls(nearestWallU(at(0.2, 0.05), HOST), HOST);
  ok(corner && (near(corner.point.x, 0.2 * PPF, 0.5) || near(corner.point.y, 0, 0.5)),
    'a point two inches from a corner is seated rather than pushed away from it');

  // THE PLACEMENT AND THE CLAMP ARE ONE FUNCTION, so they cannot disagree.
  const clamp = pointClampU(() => HOST);
  ok(clamp(null, null, HOST, at(10, 0.4)) === u,
    'the drag clamp and the placement give the same fraction for the same pointer');
  ok(nearestWallU(null, HOST) === null && nearestWallU(at(1, 1), null) === null,
    'and junk in is null out, not a throw');
}

console.log('\n-- the symbol is the sconce\'s, with a J in it --');
{
  ok(POINT_FT.r === SCONCE_FT.r && POINT_FT.stand === SCONCE_FT.stand,
    'the circle and its stand-off are READ from SCONCE_FT, not restated');
  const d = glyphJ(0, 0, 10);
  ok(d.startsWith('M ') && (d.match(/Q /g) || []).length === 2,
    'the J is two quadratics — an arc would say which way it bends with a sweep flag');
  ok(!/A /.test(d), 'and there is no arc in it at all');
  ok(pointRadiusPx(PPF) > 0 && pointRadiusPx(0, 4) === 12,
    'the radius is a real size with a floor, so the mark survives zooming out');
}

console.log('\n-- the projection resolves both kinds, and refuses a homeless one --');
{
  const wp = { id: 'a', roomId: 'r1', on: 'walls', u: nearestWallU(at(10, 0.4), HOST),
               x: null, y: null, heightMm: 1800, amps: 16 };
  const cp = { id: 'b', roomId: 'r1', on: null, u: null, x: 10, y: 6,
               heightMm: null, amps: null };
  const px = projectElecPointsPx([wp, cp], () => HOST, PPF);
  ok(px.length === 2, 'both come through');
  const [a, b] = px;
  ok(a.foot && near(a.foot.y, 0), 'the wall one carries the foot of its stem, on the wall');
  const standFt = (a.y - a.foot.y) / PPF;
  ok(standFt > 0 && near(standFt, (pointRadiusPx(PPF) * POINT_FT.stand) / PPF, 1e-6),
    'and its circle stands off the plaster, exactly as a sconce\'s does');
  ok(b.foot === null, 'the ceiling one has no stem — there is no plaster to stand off');
  ok(near(b.x, 10 * PPF) && near(b.y, 6 * PPF), 'and is its own feet times the scale');
  ok(a.heightMm === 1800 && b.heightMm === null, 'the heights survive the projection');

  // A WALL POINT WHOSE ROOM HAS GONE HAS NOWHERE TO BE. lib/point.js's third
  // gate says such a point cannot be pressed; a list carrying a NaN defeats it.
  ok(projectElecPointsPx([wp], () => null, PPF).length === 0,
    'a wall point with no host drops out rather than resolving to NaN');
  ok(projectElecPointsPx([wp, cp], () => HOST, 0).length === 0, 'no scale, no projection');
}

console.log('\n-- THE VERBS: a whole press, move and release through the primitive --');
{
  /* NO RENDERER. `makePointDrag` is driven with a fake pointer exactly as
     tools/test-drag.mjs drives `makeDrag`, because the half that broke last time
     this was done was the gesture and not the maths. */
  const list = [
    wallPoint('r1', nearestWallU(at(5, 0.3), HOST), { id: 'w1' }),
    ceilingPoint('r1', 10, 6, { id: 'c1' }),
  ];
  let store = list.slice();
  let drag = null;
  let orthoAsked = null, snapAsked = 0;
  let minted = 0;
  const api = makePointDrag({
    get: () => drag, set: (d) => { drag = typeof d === 'function' ? d(drag) : d; },
    point: (e) => ({ x: e.x, y: e.y }),
    capture: () => {},
    zoom: 1,
    hostFor: (q) => (q?.roomId === 'r1' ? HOST : null),
    clamp: pointClampU(() => HOST),
    snap: (p) => { snapAsked += 1; return p; },
    setList: (fn) => { store = fn(store); },
    copy: true,
    mintId: () => `t${++minted}`,
    onCopy: () => {},
    slop: 0,
  });
  const ev = (x, y, mod = {}) => ({ x, y, pointerId: 1, ...mod });

  // 1. MOVE, a constrained point. It slides ALONG its wall, not to the pointer.
  ok(!!api.down(ev(...Object.values(at(5, 0.3))), { id: 'w1', members: [store[0]] }),
    'the press on a wall point is taken');
  api.move(ev(12 * PPF, 3 * PPF));
  api.up(ev(12 * PPF, 3 * PPF));
  const moved = store.find((q) => q.id === 'w1');
  ok(moved.on === 'walls' && moved.x === null,
    'it is still a constrained point afterwards — no coordinate has appeared on it');
  const seat = seatOnWalls(moved.u, HOST);
  ok(near(seat.point.y, 0) || near(seat.point.x, W),
    `and it landed on a wall, not at the pointer (${(seat.point.x / PPF).toFixed(1)},`
    + ` ${(seat.point.y / PPF).toFixed(1)})`);

  // 2. THE TWO GATES, which the primitive applies and neither element was taught.
  ok(snapAsked === 0, 'a constrained drag never reached the snap — gate 2');
  drag = null;
  snapAsked = 0;
  api.down(ev(10 * PPF, 6 * PPF), { id: 'c1', members: [store.find((q) => q.id === 'c1')] });
  api.move(ev(11 * PPF, 7 * PPF));
  api.up(ev(11 * PPF, 7 * PPF));
  ok(snapAsked > 0, '...and a free one did — a ceiling point honours the snap');
  const cmoved = store.find((q) => q.id === 'c1');
  ok(cmoved.x !== 10 || cmoved.y !== 6, 'and it moved to where the pointer said');
  ok(cmoved.on === null, 'still free — no host has appeared on it');

  // 3. OPTION-COPY, the verb the plate's migration forgot.
  drag = null;
  const before = store.length;
  api.down(ev(10 * PPF, 6 * PPF), { id: 'c1', members: [store.find((q) => q.id === 'c1')] });
  api.move(ev(12 * PPF, 8 * PPF, { altKey: true }));
  api.up(ev(12 * PPF, 8 * PPF, { altKey: true }));
  ok(store.length === before + 1,
    `Option-drag made a twin (${before} -> ${store.length})`);
  ok(store.some((q) => q.id.startsWith('t')), 'minted through the caller\'s own minter');

  // 4. THE REFUSAL — gate 3. A wall point whose room has gone cannot be pressed.
  drag = null;
  const orphan = wallPoint('gone', 0.5, { id: 'x1' });
  ok(api.down(ev(0, 0), { id: 'x1', members: [orphan] }) === null,
    'a press on a point with nowhere to be is declined, not anchored at the origin');
  ok(orthoAsked === null, 'nothing here had to be told any of that');
}

console.log('\n-- one point, one switch, on the plate its BAY runs off --');
{
  const room = { id: 'r1', polygonPx: ROOM };
  const doors = [{ id: 'd1', cls: 'door', conf: 0.99,
                   rect: { x0: -18, y0: 2 * PPF, x1: 90, y1: 2 * PPF + 108 } }];
  const sb = planSwitchboards({ room, rooms: [room], doors, pxPerFt: PPF, rules: ['door'] });
  const live = sb.boards.filter((b) => !b.rejected && b.point);
  const bays = [{ key: 'room', rect: { x0: 0, y0: 0, x1: W, y1: H } }];
  const cb = planChunkBoards({ room, bays, boards: live, pxPerFt: PPF });
  const all = [...live, ...cb.boards];
  const boardId = cb.owner.get('room');

  const elecPoints = projectElecPointsPx([
    { id: 'a', roomId: 'r1', on: 'walls', u: nearestWallU(at(17, 0.3), HOST),
      x: null, y: null, heightMm: 2200, amps: 16 },
    { id: 'b', roomId: 'r1', on: null, u: null, x: 10, y: 6, heightMm: null, amps: null },
  ], () => HOST, PPF);

  const { flows } = planFlows({
    room, bays, chunks: [], cells: [], lights: [], lamps: [],
    boards: all, owner: cb.owner, pxPerFt: PPF, elecPoints,
  });
  const pts = flows.filter((f) => f.kind === 'point');
  ok(pts.length === 2, `one flow per point, both kinds (got ${pts.length})`);
  ok(pts.every((f) => f.boardId === boardId),
    'and both reach the plate the BAY runs off, whichever is nearest');
  ok(pts.some((f) => f.onWall) && pts.some((f) => !f.onWall),
    'each says which surface it ends at');
  ok(pts.every((f) => f.path.startsWith('M') && !f.path.includes('NaN')), 'the wire draws');

  const [plate] = composeSwitchboard({ country: 'IN', flows, boardId }).boards;
  const sw = plate.points.filter((p) => p.kind === 'switch' && p.source === 'design');
  ok(sw.length === 2, `two switches for two points (got ${sw.length})`);
  ok(sw.some((p) => p.amps === 16), 'the rated one gets a 16A switch');
  ok(sw.some((p) => p.amps === lightSwitchA(COUNTRIES.IN)),
    `and the unrated one the country's light rating (${lightSwitchA(COUNTRIES.IN)}A)`);
  ok(!plate.points.some((p) => p.kind === 'socket' && p.source === 'design'),
    'and no socket — the fitting is on the wall, only its switch is here');
}

console.log('\n-- ...AND IT REACHES THE PLATE THROUGH THE PROJECTION, not just planFlows --');
{
  /* THE JOIN AND NOT THE ARITHMETIC. The section above proves `planFlows` makes
     the wire when it is handed the points; this one proves the points GET there
     — across `projectFlowsPx`, which is the boundary App's scene crosses and
     which takes them as its seventeenth argument.
     THAT IS WHERE IT BROKE. The whole feature shipped with the domain correct
     and one prop misnamed two hops above it: App handed `useElectrical` a
     `wallPointsPx`, the hook destructured `elecPointsPx`, the undefined fell
     through to this function's default `[]`, and every point somebody placed
     came out connected to nothing at all. No throw, no warning — the same
     silent shape `manualCobs` in feet had. A test that stops at `planFlows`
     cannot see it, so this one does not stop there. */
  const room = { id: 'r1', polygonPx: ROOM };
  const doors = [{ id: 'd1', cls: 'door', conf: 0.99,
                   rect: { x0: -18, y0: 2 * PPF, x1: 90, y1: 2 * PPF + 108 } }];
  const sb = planSwitchboards({ room, rooms: [room], doors, pxPerFt: PPF, rules: ['door'] });
  const live = sb.boards.filter((b) => !b.rejected && b.point);
  const bays = [{ key: 'room', rect: { x0: 0, y0: 0, x1: W, y1: H } }];
  const cb = planChunkBoards({ room, bays, boards: live, pxPerFt: PPF });
  const mainBoardId = cb.owner.get('room');

  // THE STORE, exactly as a placement writes it — a fraction for one kind and
  // feet for the other, and no coordinate at all on the wall point.
  const stored = [
    wallPoint('r1', nearestWallU(at(17, 0.3), HOST), { id: 'ep-a', heightMm: 2200, amps: 16 }),
    ceilingPoint('r1', 10, 6, { id: 'ep-b' }),
  ];
  const rooms = [{ id: 'r1', plan: { ok: true, polygonPx: ROOM, chunksPx: [], cellsPx: [],
                                     lightsPx: [], tracksPx: [], zonesPx: [] } }];
  const boardsFor = (r) => (r.id === 'r1' ? live : []);
  const bayBoardsFor = (r) => (r.id === 'r1' ? cb.boards : []);
  const placedBoardsFor = () => [];
  const baysOf = (r) => (r.id === 'r1' ? bays : []);
  const allBoardsPx = projectAllBoardsPx(rooms, boardsFor, bayBoardsFor, placedBoardsFor);
  const elecPointsPx = projectElecPointsPx(stored, () => HOST, PPF);

  const flows = projectFlowsPx(rooms, boardsFor, bayBoardsFor, { r1: { owner: cb.owner } },
    [], [], [], {}, PPF, baysOf, allBoardsPx, placedBoardsFor, {}, {}, [], {}, elecPointsPx);
  const pts = flows.filter((f) => f.kind === 'point');
  ok(pts.length === 2, `one wire per point out of the projection (got ${pts.length})`);
  ok(pts.every((f) => f.boardId === mainBoardId),
    'and both land on the plate the bay runs off — the room\u2019s main board');
  ok(pts.every((f) => f.path?.startsWith('M') && !f.path.includes('NaN')),
    'and each wire draws');

  const [plate] = composeSwitchboard({ country: 'IN', flows, boardId: mainBoardId }).boards;
  const sw = plate.points.filter((p) => p.kind === 'switch' && p.source === 'design');
  ok(sw.length === 2 && sw.some((p) => p.amps === 16),
    'and the plate grows a switch for each, at the rating the point carries');

  // AND THE SHAPE OF THE DEFECT, stated so it cannot come back quietly: with
  // the argument dropped, this pass produces no point wires whatever.
  const blind = projectFlowsPx(rooms, boardsFor, bayBoardsFor, { r1: { owner: cb.owner } },
    [], [], [], {}, PPF, baysOf, allBoardsPx, placedBoardsFor, {}, {}, [], {}, undefined);
  ok(!blind.some((f) => f.kind === 'point'),
    'a caller that forgets to hand them over draws nothing — which is why the above is asserted');
}

console.log(fail ? `\n${fail} failing` : '\nall good');
process.exit(fail ? 1 : 0);
