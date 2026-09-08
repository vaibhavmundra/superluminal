/**
 * THE PURE HALF OF features/electrical/.
 *
 * Which plates a space gets, which of them the drawing shows, what each one is,
 * what is on it, and the schedule they add up to. None of it needs React, a
 * canvas or a network — the memo adapters hold nothing but dependency arrays —
 * which is why it is out of the controller and can be checked here.
 *
 * The numbers follow tools/test-electrical.mjs: a 600x360 room at 30.48 px/ft,
 * so a 900mm door is 90px and 300mm is 30px.
 *
 *   node tools/test-electrical-domain.mjs
 */
import assert from 'node:assert/strict';
import {
  planBoardResults, planBayResults, planOutdoorFeeds, baysOfRoom,
  boardModeOf, applyMode, drawnBoards, ruleBoards, handBoards, heightOf,
  seatForClick,
} from '../src/features/electrical/boardRules.js';
import {
  buildBoardSheet, composeBoard, reorderUnits,
  newBoardPointId, newManualBoardId,
} from '../src/features/electrical/boardSheet.js';
import { countryFor } from '../src/lib/switchboards.js';
import { FACING_PLATES, heightsFor } from '../src/lib/electrical.js';

const PPF = 30.48;
const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const poly = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** A lit space: the shape the rules are handed. */
const space = (id, name, polygonPx, extra = {}) => ({
  id, outline: { name }, geo: { polygonPx },
  plan: { ok: true, polygonPx, zonesPx: [], ...(extra.plan ?? {}) },
  ...extra,
});

/** A 900mm door in the top wall of a room whose top edge is at y. */
const door = (x0, y, id = 'd1') => ({
  id, cls: 'door', conf: 0.99, rect: rect(x0, y - 18, x0 + 90, y + 90),
});

const BEDROOM = space('r1', 'Bedroom 1', poly(0, 0, 600, 360));
const DOORS = [door(180, 0)];

// --- the rules pass --------------------------------------------------------

{
  const out = planBoardResults({
    rooms: [BEDROOM], doors: DOORS, roomTypes: { r1: { type: 'bedroom' } },
    projectId: 'residential', pxPerFt: PPF,
  });
  assert.ok(out.r1, 'a lit space gets an entry');
  assert.ok(out.r1.boards.some((b) => b.role === 'door'),
    'the door rule runs on every space that has a door');
  // A bedroom in a home is asked all three rules; the other two have nothing to
  // work with here (no sconces, no bed) and say so rather than being skipped.
  assert.ok(out.r1.notes.length > 0, 'the rules that found nothing report why');
}

{
  // Not a bedroom: the door rule only. `bedside` and `facing` were never run,
  // so they contribute no plates and no notes of their own.
  const kitchen = space('r2', 'Kitchen', poly(0, 0, 600, 360));
  const all = planBoardResults({
    rooms: [kitchen], doors: [door(180, 0, 'd2')], roomTypes: { r2: { type: 'kitchen' } },
    projectId: 'residential', pxPerFt: PPF,
  });
  const bedroom = planBoardResults({
    rooms: [kitchen], doors: [door(180, 0, 'd2')], roomTypes: { r2: { type: 'bedroom' } },
    projectId: 'residential', pxPerFt: PPF,
  });
  assert.ok(all.r2.notes.length < bedroom.r2.notes.length,
    'a rule that was never run has nothing to say');
  assert.ok(all.r2.boards.every((b) => b.role === 'door' || b.rejected),
    'only the door rule placed anything');
}

{
  // A BALCONY GETS NO BOARD OF ITS OWN — an empty result with a sentence, and
  // not a missing key, which would read as "the pass has not run".
  const balcony = space('b1', 'Balcony', poly(600, 0, 800, 360));
  const out = planBoardResults({
    rooms: [BEDROOM, balcony], doors: DOORS,
    roomTypes: { r1: { type: 'bedroom' }, b1: { type: 'balcony' } },
    projectId: 'residential', pxPerFt: PPF,
  });
  assert.ok('b1' in out, 'the outdoor space has an entry');
  assert.deepEqual(out.b1.boards, []);
  assert.equal(out.b1.notes.length, 1);
  assert.match(out.b1.notes[0], /switched from the room it opens off/);
}

{
  // The guards, and the one skip that is not a decision.
  assert.deepEqual(planBoardResults({ rooms: [BEDROOM], pxPerFt: 0 }), {},
    'no scale, no pass at all');
  assert.deepEqual(planBoardResults({ rooms: [], pxPerFt: PPF }), {});
  const failed = { ...BEDROOM, id: 'r9', plan: { ok: false, polygonPx: [] } };
  assert.deepEqual(planBoardResults({ rooms: [failed], doors: DOORS, pxPerFt: PPF }), {},
    'a space the layout failed on is skipped, not given an empty result');
}

{
  // A rule that throws is reported and does not take the rest of the plan with
  // it. `plan.polygonPx` of the wrong shape is the cheapest way to make one.
  const seen = [];
  // A stand-in for the accent list that blows up for one space and not the
  // other — `filter` is the first thing the rules call with the room in hand.
  const boom = { filter: (fn) => { if (fn({ roomId: 'r1' })) throw new Error('boom'); return []; } };
  const hall = space('r2', 'Hall', poly(0, 400, 600, 760));
  const out = planBoardResults({
    rooms: [BEDROOM, hall], doors: [door(180, 0), door(180, 400, 'd3')],
    pxPerFt: PPF, accentZonesPx: boom,
    warn: (roomId, err) => seen.push([roomId, err.message]),
  });
  assert.deepEqual(seen, [['r1', 'boom']], 'the failure names its room');
  assert.ok(!('r1' in out), 'and the space it failed on gets no entry');
  assert.ok(out.r2, 'the space after it still ran');
}

{
  // The inputs are not written to.
  const doors = [door(180, 0)];
  const before = JSON.stringify(doors);
  planBoardResults({ rooms: [BEDROOM], doors, roomTypes: {}, pxPerFt: PPF });
  assert.equal(JSON.stringify(doors), before, 'the door list comes back untouched');
}

// --- the bays --------------------------------------------------------------

{
  assert.deepEqual(baysOfRoom({ plan: { ok: false } }), []);
  // No design chunk: the room's own bounding box, as one bay called 'room'.
  assert.deepEqual(baysOfRoom(BEDROOM),
    [{ key: 'room', rect: { x0: 0, y0: 0, x1: 600, y1: 360 } }]);
  // A design chunk is the bay, and its key travels with it.
  const chunked = space('r3', 'Living', poly(0, 0, 600, 360), {
    designChunksPx: [{ key: 'c0', rect: rect(0, 0, 300, 360) },
                     { key: 'c1', rect: rect(300, 0, 600, 360) }],
  });
  assert.deepEqual(baysOfRoom(chunked).map((b) => b.key), ['c0', 'c1']);
}

{
  // No bay plates outside, for the reason the rules pass skips a balcony.
  const balcony = space('b1', 'Balcony', poly(600, 0, 800, 360));
  const out = planBayResults({
    rooms: [balcony], pxPerFt: PPF, baysOf: baysOfRoom, ruleBoardsFor: () => [],
    projectId: 'residential', roomTypes: { b1: { type: 'balcony' } },
  });
  assert.deepEqual(out, {}, 'an outdoor space is skipped entirely');
  assert.deepEqual(planBayResults({ rooms: [BEDROOM], pxPerFt: 0, baysOf: baysOfRoom,
    ruleBoardsFor: () => [] }), {}, 'no scale, no bay pass');
}

{
  // A bay with no board on its own walls grows one; handed the door board, it
  // adopts it instead. Same room, same bay, two answers.
  const rules = planBoardResults({
    rooms: [BEDROOM], doors: DOORS, roomTypes: { r1: { type: 'bedroom' } },
    projectId: 'residential', pxPerFt: PPF,
  });
  const doorBoard = rules.r1.boards.filter((b) => b.role === 'door' && b.point);
  const alone = planBayResults({
    rooms: [BEDROOM], pxPerFt: PPF, baysOf: baysOfRoom, ruleBoardsFor: () => [],
  });
  const adopted = planBayResults({
    rooms: [BEDROOM], pxPerFt: PPF, baysOf: baysOfRoom, ruleBoardsFor: () => doorBoard,
  });
  assert.ok((alone.r1?.boards ?? []).length >= (adopted.r1?.boards ?? []).length,
    'a bay handed a plate on its own wall makes no more than one that was not');
}

// --- outdoor feeds ---------------------------------------------------------

{
  // A balcony along the whole of the bedroom's right-hand wall.
  const balcony = space('b1', 'Balcony', poly(600, 0, 700, 360));
  const near = { id: 'sb-near', point: { x: 600, y: 180 }, role: 'door' };
  const far = { id: 'sb-far', point: { x: 10, y: 180 }, role: 'door' };
  const feeds = planOutdoorFeeds({
    rooms: [BEDROOM, balcony], roomTypes: { b1: { type: 'balcony' } },
    projectId: 'residential', pxPerFt: PPF,
    boardsFor: (r) => (r.id === 'r1' ? [far, near] : []),
    bayBoardsFor: () => [],
  });
  assert.equal(feeds.b1.board.id, 'sb-near', 'the nearest plate in the inner room wins');
  assert.equal(feeds.b1.roomId, 'r1');
  assert.equal(feeds.b1.roomName, 'Bedroom 1');
  assert.ok(!('r1' in feeds), 'an indoor space is not fed from anywhere');

  // A socket outlet has no switch on it and cannot switch a balcony, however
  // near it is. Nearest AFTER the filter, not before.
  const socket = { ...near, socketOnly: true };
  const only = planOutdoorFeeds({
    rooms: [BEDROOM, balcony], roomTypes: { b1: { type: 'balcony' } },
    projectId: 'residential', pxPerFt: PPF,
    boardsFor: (r) => (r.id === 'r1' ? [far, socket] : []),
    bayBoardsFor: () => [],
  });
  assert.equal(only.b1.board.id, 'sb-far', 'the socket is skipped and the far board takes it');

  // Nowhere to feed from falls back to nothing at all, not to a wire to nowhere.
  const nothing = planOutdoorFeeds({
    rooms: [BEDROOM, balcony], roomTypes: { b1: { type: 'balcony' } },
    projectId: 'residential', pxPerFt: PPF,
    boardsFor: () => [], bayBoardsFor: () => [],
  });
  assert.deepEqual(nothing, {});
  assert.deepEqual(planOutdoorFeeds({ rooms: [BEDROOM], pxPerFt: 0 }), {});
}

// --- what a plate IS -------------------------------------------------------

const IN = countryFor('IN');

{
  // THE DEFAULT IS WHERE IT CAME FROM: a hand-placed plate is an outlet, a
  // rule's plate is a board, and `boardKinds` holds only what somebody changed.
  assert.deepEqual(boardModeOf({ id: 'a' }, { boardKinds: {}, country: IN }),
    { outlet: false, amps: 6 });
  assert.equal(boardModeOf({ id: 'a', placed: true }, { boardKinds: {}, country: IN }).outlet,
    true, 'a plate the tool placed starts as an outlet');
  assert.deepEqual(
    boardModeOf({ id: 'a', placed: true }, { boardKinds: { a: { outlet: false, amps: 16 } }, country: IN }),
    { outlet: false, amps: 16 }, 'an override beats where it came from');
  assert.deepEqual(boardModeOf(null, { boardKinds: {}, country: IN }), { outlet: false, amps: 6 },
    'no plate at all is answerable without throwing');
}

{
  const boardMode = (b) => boardModeOf(b, { boardKinds: {}, country: IN });
  const plate = { id: 'p1', role: 'door', point: { x: 1, y: 2 } };

  // Not an outlet: the mode's rating rides along and `socketOnly` is stated.
  const [asBoard] = applyMode([plate], { boardMode, boardHeights: {} });
  assert.equal(asBoard.socketOnly, false);
  assert.equal(asBoard.amps, 6);
  assert.deepEqual(plate, { id: 'p1', role: 'door', point: { x: 1, y: 2 } },
    'the plate handed in is not written to');

  // THE HEIGHT IS APPLIED AFTER THE MODE, so it survives the outlet transform —
  // which sets 300 of its own and would otherwise overwrite it.
  const placed = { id: 'p2', role: 'socket', placed: true, point: { x: 1, y: 2 } };
  const [outlet] = applyMode([placed], { boardMode, boardHeights: {} });
  assert.equal(outlet.socketOnly, true);
  const [raised] = applyMode([placed], { boardMode, boardHeights: { p2: 900 } });
  assert.equal(raised.heightsMm[0], 900, 'the typed height beats the outlet default');
  assert.equal(raised.heightSet, true);

  // THE PRIMARY HEIGHT ONLY. The wall facing a bed is two plates at two
  // heights; an override replaces the first and leaves the rest alone.
  const facing = { id: 'p3', role: 'facing', point: { x: 1, y: 2 } };
  const base = heightsFor('facing');
  assert.equal(base.length, FACING_PLATES);
  const [twoPlate] = applyMode([facing], { boardMode, boardHeights: { p3: 1500 } });
  assert.equal(twoPlate.heightsMm.length, FACING_PLATES,
    'a two-plate board does not silently become a one-plate board');
  assert.deepEqual(twoPlate.heightsMm, [1500, ...base.slice(1)]);

  // A height that is not a number is no override at all.
  const [ignored] = applyMode([facing], { boardMode, boardHeights: { p3: null } });
  assert.equal(ignored.heightSet, undefined);
}

{
  // `heightOf` — the override, then the rule, then the last-resort 1200.
  assert.equal(heightOf({ heightsMm: [900, 1200] }), 900);
  assert.equal(heightOf({ role: 'facing' }), heightsFor('facing')[0]);
  assert.equal(heightOf(null), heightsFor(undefined)[0] ?? 1200);
}

// --- which plates are on the drawing ---------------------------------------

{
  const list = [
    { id: 'a', point: { x: 0, y: 0 } },
    { id: 'b', point: { x: 1, y: 1 }, rejected: true, why: 'no wall' },
    { id: 'c', point: null },
    { id: 'd', point: { x: 2, y: 2 } },
  ];
  assert.deepEqual(drawnBoards(list, { boardsOff: ['d'] }).map((b) => b.id), ['a'],
    'rejected, pointless and dismissed plates are all off the drawing');

  // The rule reading drops the sockets as well: a socket cannot switch a bay.
  const boardMode = (b) => ({ outlet: b.id === 'a', amps: 6 });
  assert.deepEqual(ruleBoards(list, { boardsOff: [], boardMode }).map((b) => b.id), ['d'],
    'a plate turned into a socket stops owning a piece of ceiling');
  assert.deepEqual(drawnBoards(list, {}).map((b) => b.id), ['a', 'd'],
    'no dismissal list at all is none dismissed');
}

{
  // The hand-placed plates: filtered by room AND by the dismissal list, then
  // seated on that room's own walls by `placedBoards`.
  const manualBoards = [
    { id: 'm1', roomId: 'r1', sFt: 4 },
    { id: 'm2', roomId: 'other', sFt: 4 },
    { id: 'm3', roomId: 'r1', sFt: 8 },
  ];
  const got = handBoards(BEDROOM, { manualBoards, boardsOff: ['m3'], pxPerFt: PPF });
  assert.deepEqual(got.map((b) => b.id), ['m1'],
    'another room\'s plates and the dismissed one are both out');
  assert.ok(got[0].point, 'and the survivor is seated on a wall');
  assert.deepEqual(handBoards({ id: 'r1', plan: null }, { manualBoards, pxPerFt: PPF }).length, 0,
    'a room with no outline seats nothing');
}

// --- seating one by hand ---------------------------------------------------

{
  const other = space('r2', 'Hall', poly(600, 0, 1200, 360));
  const rooms = [BEDROOM, other];
  // A press just inside the shared wall: every room bids and the closest wins,
  // rather than the answer depending on which side of the line the pixel fell.
  const left = seatForClick({ x: 598, y: 180 }, { rooms, pxPerFt: PPF });
  assert.ok(left, 'a press near a wall seats a plate');
  assert.ok(Number.isFinite(left.seat.sFt), 'and what is stored is a distance round the walls');

  // TOO FAR FROM ANY WALL IS A MISS AND NOT A GUESS.
  const middle = seatForClick({ x: 300, y: 180 }, { rooms, pxPerFt: PPF });
  assert.equal(middle, null, 'the middle of a room is not near enough to any wall');
  assert.equal(seatForClick({ x: 0, y: 0 }, { rooms, pxPerFt: 0 }), null, 'no scale, no seat');
  assert.equal(seatForClick({ x: 0, y: 0 }, { rooms: [], pxPerFt: PPF }), null);
  assert.equal(seatForClick({ x: 0, y: 0 },
    { rooms: [{ id: 'z', plan: { polygonPx: [] } }], pxPerFt: PPF }), null,
  'a room with no outline does not bid');
}

// --- what is on a plate ----------------------------------------------------

{
  assert.equal(composeBoard(null, { country: IN }), null);

  const flowsPx = [
    { id: 'f1', boardId: 'b1', kind: 'grid', rows: 2, boardLabel: 'SB1' },
    { id: 'f2', outletId: 'o1', boardId: 'b1', boardLabel: 'SB1' },
  ];
  const board = composeBoard({ id: 'b1', amps: 16 }, { country: IN, flowsPx });
  assert.equal(board.outlet, false, 'a switchboard is not composed as an outlet');
  assert.ok(board.total > 0, 'and it has modules on it');
  assert.ok(board.units.length > 0);

  // AN OUTLET IS COMPOSED BY THE OTHER FUNCTION, and says where its switch went.
  const outlet = composeBoard({ id: 'o1', socketOnly: true, amps: 16 }, { country: IN, flowsPx });
  assert.equal(outlet.outlet, true);
  assert.equal(outlet.switchedFrom, 'SB1');
  // THE WIRE ID GOES ON THE SOCKET ITSELF, and only for the card. The sheet is
  // a parts list and has nothing to light; the panel picks a wire from a module.
  assert.equal(outlet.boards[0].points[0].flowId, null,
    'the sheet does not ask for the wire id — only the card does');
  const carded = composeBoard({ id: 'o1', socketOnly: true, amps: 16 },
    { country: IN, flowsPx, withFlowId: true });
  assert.equal(carded.boards[0].points[0].flowId, 'f2',
    'the card gets the wire, so the socket lights with everything else on it');

  // `spareAmps` SURVIVES A CONVERSION: the socket that was on the wall keeps
  // its rating on the way through.
  const rated = composeBoard({ id: 'b1', amps: 16 }, { country: IN, flowsPx: [] });
  const plain = composeBoard({ id: 'b1', amps: 6 }, { country: IN, flowsPx: [] });
  assert.notDeepEqual(rated.units, plain.units, 'a 16A spare is not a 6A spare');
}

// --- the schedule ----------------------------------------------------------

{
  const roomA = space('r1', 'Bedroom 1', poly(0, 0, 600, 360));
  const roomB = space('r2', '', poly(600, 0, 1200, 360));
  const empty = space('r3', 'Store', poly(0, 400, 100, 500));
  const big = { id: 'big', point: { x: 0, y: 0 } };
  const small = { id: 'small', socketOnly: true, amps: 6, point: { x: 1, y: 1 } };
  const boardNames = new Map([['big', 'SB1'], ['small', 'SB2'], ['bay', 'SB10'],
                              ['hand', 'SB9']]);
  const groups = buildBoardSheet({
    rooms: [roomA, roomB, empty],
    boardsFor: (r) => (r.id === 'r1' ? [big, small] : []),
    bayBoardsFor: (r) => (r.id === 'r2' ? [{ id: 'bay', point: { x: 2, y: 2 } }] : []),
    placedBoardsFor: (r) => (r.id === 'r2'
      ? [{ id: 'hand', socketOnly: true, amps: 6, point: { x: 3, y: 3 } }] : []),
    boardNames, country: IN,
    flowsPx: [{ id: 'f1', boardId: 'big', kind: 'grid', rows: 3, boardLabel: 'SB1' }],
    boardPoints: {}, boardOrders: {},
  });
  assert.deepEqual(groups.map((g) => g.roomId), ['r1', 'r2'],
    'a space with no plates is not a group');
  assert.equal(groups[1].name, 'Space', 'an unnamed space still has a heading');
  // ASCENDING BY SIZE: the socket outlet is the smaller part and comes first.
  assert.deepEqual(groups[0].plates.map((p) => p.id), ['small', 'big']);
  assert.equal(groups[0].plates[0].name, 'SB2');
  assert.equal(groups[0].plates[0].modules, groups[0].plates[0].composition.total);
  assert.equal(groups[0].plates[0].heightMm, heightOf(small));
  // ...AND BY NAME WHERE TWO ARE THE SAME SIZE, numerically, so SB9 precedes
  // SB10 rather than following it.
  assert.deepEqual(groups[1].plates.map((p) => p.name), ['SB9', 'SB10']);

  const unnamed = buildBoardSheet({
    rooms: [roomA], boardsFor: () => [big], bayBoardsFor: () => [],
    placedBoardsFor: () => [], boardNames: new Map(), country: IN, flowsPx: [],
  });
  assert.equal(unnamed[0].plates[0].name, '—', 'a plate with no number still prints');
}

// --- arranging the modules on one ------------------------------------------

{
  const units = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  // Dropping to the RIGHT loses the slot the unit vacated, or a unit dragged
  // one place right would land back where it started.
  assert.deepEqual(reorderUnits(units, 'a', 1), { order: ['a', 'b', 'c', 'd'], from: 0 },
    'dropping into the slot it came out of is not a move');
  assert.deepEqual(reorderUnits(units, 'a', 2), { order: ['b', 'a', 'c', 'd'], from: 0 },
    'one place right is the index PAST the neighbour, measured with it still in');
  assert.deepEqual(reorderUnits(units, 'a', 0), { order: ['a', 'b', 'c', 'd'], from: 0 });
  // Dropping to the LEFT is the plain index.
  assert.deepEqual(reorderUnits(units, 'd', 1), { order: ['a', 'd', 'b', 'c'], from: 3 });
  assert.deepEqual(reorderUnits(units, 'd', 99), { order: ['a', 'b', 'c', 'd'], from: 3 },
    'a drop past the end clamps to the end');
  assert.deepEqual(reorderUnits(units, 'a', -5), { order: ['a', 'b', 'c', 'd'], from: 0 });
  assert.equal(reorderUnits(units, 'zzz', 1), null,
    'a key that is not in the list stores no arrangement at all');
  assert.equal(reorderUnits([], 'a', 0), null);
  assert.deepEqual(units.map((u) => u.key), ['a', 'b', 'c', 'd'], 'the list is not written to');
}

// --- the ids ---------------------------------------------------------------

{
  // AN ID PER PRESS, so two 16A sockets on one plate are removable one at a time.
  const a = newBoardPointId();
  const b = newBoardPointId();
  assert.match(a, /^bp-/);
  assert.notEqual(a, b);
  assert.match(newManualBoardId(), /^sb-hand-/);
  assert.notEqual(newManualBoardId(), newManualBoardId());
}

console.log('electrical-domain: ok');
