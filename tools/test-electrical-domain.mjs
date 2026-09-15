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
  seatForClick, lampSocketSeat,
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
  // A stand-in for the wardrobe list that blows up for one space and not the
  // other — `filter` is the first thing the rules call with the room in hand.
  // It used to be the ACCENT list; the rules read no fittings at all now, so
  // the joinery is what is left that arrives per room.
  const boom = { filter: (fn) => { if (fn({ roomId: 'r1' })) throw new Error('boom'); return []; } };
  const hall = space('r2', 'Hall', poly(0, 400, 600, 760));
  const out = planBoardResults({
    rooms: [BEDROOM, hall], doors: [door(180, 0), door(180, 400, 'd3')],
    pxPerFt: PPF, wardrobesPx: boom,
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

  /* THE TELEVISION WALL IS TWO BOARDS OF ONE PLATE EACH, and it used to be one
     board of two — see FACING_PAIR. So an override on either is the whole of
     that board's height, and the "primary height only" case it was written for
     no longer arises. The rule it encodes is unchanged and still tested: the
     override replaces the FIRST height and leaves any others alone, which is
     what keeps a multi-plate role from silently becoming a single-plate one. */
  const facing = { id: 'p3', role: 'facing', point: { x: 1, y: 2 } };
  const base = heightsFor('facing');
  assert.equal(base.length + heightsFor('facingSwitch').length, FACING_PLATES,
    'two plates on that wall, across the pair');
  const [socket] = applyMode([facing], { boardMode, boardHeights: { p3: 1500 } });
  assert.deepEqual(socket.heightsMm, [1500], 'the socket plate takes the typed height');
  const sw = { id: 'p4', role: 'facingSwitch', point: { x: 1, y: 2 } };
  const [onlySw] = applyMode([sw], { boardMode, boardHeights: { p4: 1100 } });
  assert.deepEqual(onlySw.heightsMm, [1100],
    'and the switch plate takes its own, independently');
  const multi = { id: 'p5', role: 'facing', heightsMm: [700, 1200], point: { x: 1, y: 2 } };
  const [kept] = applyMode([multi], { boardMode, boardHeights: { p5: 1500 } });
  assert.deepEqual(kept.heightsMm, [1500, 1200],
    'a board that does carry several keeps the rest of them');

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

// --- which pieces of ceiling are bays --------------------------------------
//
// THE PILL'S LIST AND THE SWITCHING'S LIST ARE NOT THE SAME LIST, and reading
// the wrong one cost every plan with the suggested grid switched off its second
// switchboard. `designChunksPx` is emptied then — correctly, a pill there would
// offer to re-cut a piece of ceiling with nothing on it to move — and how a
// ceiling is CUT does not depend on whether the engine placed anything in it.
{
  const cut = [{ key: 'a', rect: rect(0, 0, 300, 360) },
               { key: 'b', rect: rect(300, 0, 600, 360) }];
  const withCut = { ...BEDROOM, bayChunksPx: cut, designChunksPx: [] };
  assert.deepEqual(baysOfRoom(withCut).map((b) => b.key), ['a', 'b'],
    'the cut is read off bayChunksPx, which the grid being off does not empty');

  /* THE PILL'S LIST IS STILL A FALLBACK, for a room built by a caller that
     carries only it — every room in this file, and the reason nothing else here
     had to change. */
  assert.deepEqual(
    baysOfRoom({ ...BEDROOM, designChunksPx: cut }).map((b) => b.key), ['a', 'b'],
    'a room carrying only the old list still answers with its chunks');

  // AND NEITHER: the whole space is one bay, which is what a room the design
  // pass never cut has always been.
  assert.deepEqual(baysOfRoom(BEDROOM).map((b) => b.key), ['room'],
    'a room with no cut at all is one bay');
  assert.deepEqual(baysOfRoom({ ...BEDROOM, plan: { ok: false } }), [],
    'and a room that would not lay out has none');
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

// --- and one seated by a lamp rather than by a click -----------------------
//
// SAME PLATE, DIFFERENT QUESTION, which is why it is a second function beside
// `seatForClick` and not a flag on it. That one resolves "which piece of
// plaster did you mean"; this one resolves "this lamp has to be plugged in".
{
  const rooms = [BEDROOM, space('r2', 'Hall', poly(600, 0, 1200, 360))];
  // AT SOCKET HEIGHT: a plate above 750mm is not one a floor lamp plugs into,
  // and a fixture with no height defaults to switch height. See
  // LAMP_SOCKET_MAX_MM.
  const plate = (id, roomId, x, y, mm = 300) =>
    ({ id, roomId, heightsMm: [mm], point: { x, y } });

  // A PLATE IN REACH MEANS NOTHING TO DO. Three feet is 91.44px at this scale.
  assert.equal(
    lampSocketSeat({ x: 300, y: 180 },
      { rooms, plates: [plate('a', 'r1', 300, 240)], pxPerFt: PPF }),
    null, 'a lamp with a plate 60px away needs no socket of its own');

  // ...AND OUT OF REACH MEANS THE NEAREST WALL, HOWEVER FAR THAT IS. This is
  // the case `seatForClick` refuses — the middle of the room, ten feet from
  // anything — and refusing it here would leave a lamp with nowhere to plug in.
  const mid = lampSocketSeat({ x: 300, y: 180 },
    { rooms, plates: [plate('a', 'r1', 300, 400)], pxPerFt: PPF });
  assert.ok(mid, 'the middle of a room still gets a socket');
  assert.equal(mid.roomId, 'r1', 'on its own room\'s wall');
  assert.ok(Number.isFinite(mid.seat.sFt), 'stored as a distance round the walls');
  /* AND IT GOES ON THE WALL THE LAMP IS CLOSEST TO, which is the half of the
     rule `nearestSeat` answers: it projects the lamp onto every wall of the room
     that can hold a plate and the nearest one wins. BEDROOM is 600 x 360, so a
     lamp at (60, 180) is 60px from the left wall and 300 from the right, and the
     seat has to land on the left one. Read back as a POSITION rather than as a
     distance round the perimeter, because `sFt` is measured from wherever the
     outline happens to start and asserting it would be asserting the tracer's
     numbering rather than the rule. */
  const near = lampSocketSeat({ x: 60, y: 180 },
    { rooms, plates: [], pxPerFt: PPF });
  assert.ok(near, 'a lamp near the left wall gets a seat');
  {
    const seated = handBoards(BEDROOM, {
      manualBoards: [{ id: 'sl-sock', roomId: near.roomId, sFt: near.seat.sFt }],
      pxPerFt: PPF,
    })[0];
    assert.ok(seated?.point, 'and it resolves to a plate on the drawing');
    assert.ok(seated.point.x < 120,
      `on the wall it is closest to, not the far one (x=${seated.point.x})`);
  }

  // THE PARTY WALL'S FAR FACE IS NOT A PLATE THIS LAMP CAN REACH. A socket
  // 40px away through a wall is in the next room, and reach is physical.
  const across = lampSocketSeat({ x: 560, y: 180 },
    { rooms, plates: [plate('b', 'r2', 600, 180)], pxPerFt: PPF });
  assert.ok(across, 'a plate in the NEXT room does not satisfy this lamp');

  assert.equal(lampSocketSeat({ x: 2000, y: 2000 }, { rooms, pxPerFt: PPF }), null,
    'a lamp inside no room seats nothing');
  assert.equal(lampSocketSeat({ x: 300, y: 180 }, { rooms, pxPerFt: 0 }), null,
    'no scale, no seat');
  assert.equal(lampSocketSeat(null, { rooms, pxPerFt: PPF }), null, 'no point, no seat');

  /* A PLATE AT SWITCH HEIGHT DOES NOT COUNT, so a lamp beside the door board
     still gets a socket of its own rather than being wired up to hand height. */
  assert.ok(
    lampSocketSeat({ x: 300, y: 180 },
      { rooms, plates: [plate('door', 'r1', 300, 240, 1200)], pxPerFt: PPF }),
    'a board at 1200mm within reach does not save the lamp a socket');
}

// --- a standing lamp's plate, end to end -----------------------------------
//
// THE WHOLE CHAIN IN ONE PLACE, because it broke in the joins rather than in any
// one function. A lamp seats a plate; the plate has to be born a SWITCHBOARD so
// it can carry a switch; the lamp's flow has to land on it so a wire is drawn;
// and `pointsFromFlows` has to put a socket AND its switch there. Miss any one
// and the symptom is the same on screen: a plate with a lone socket on it, no
// wire to the lamp, and nothing at all for a second lamp beside the first.
{
  const rooms = [BEDROOM];
  const at = { x: 60, y: 180 };                    // near the left wall

  // 1. NOTHING IN REACH, SO A PLATE IS SEATED — and it carries the role that
  //    makes it a lamp's rather than an ordinary hand-dropped one.
  const seat = lampSocketSeat(at, { rooms, plates: [], pxPerFt: PPF });
  assert.ok(seat, 'a lamp out of reach of everything seats a plate');
  assert.equal(seat.role, 'lamp', 'and the seat says what it is for');

  const manualBoards = [{ id: 'sb-lamp', roomId: 'r1', sFt: seat.seat.sFt,
                          role: seat.role }];
  const raw = handBoards(BEDROOM, { manualBoards, pxPerFt: PPF });
  assert.equal(raw.length, 1, 'and it resolves to one plate on the drawing');

  // 2. IT IS BORN A SWITCHBOARD, NOT AN OUTLET. This is the defect: born an
  //    outlet it arrived with one socket, no switch, and no way to be a flow's
  //    board — so the lamp had no wire and no switch anywhere near it.
  const mode = boardModeOf(raw[0], { boardKinds: {}, country: IN });
  assert.equal(mode.outlet, false, 'a lamp\'s plate is born a switchboard');
  const plate = applyMode(raw, { boardMode: (b) => boardModeOf(b, { boardKinds: {}, country: IN }) })[0];
  assert.equal(plate.socketOnly, false, '...so nothing downstream treats it as a socket');
  assert.deepEqual(plate.heightsMm, [300],
    'and it sits at socket height, not at switch height');

  // ...while an ordinary hand-dropped plate is untouched by all of that.
  const plain = handBoards(BEDROOM,
    { manualBoards: [{ id: 'sb-hand', roomId: 'r1', sFt: 4 }], pxPerFt: PPF })[0];
  assert.equal(boardModeOf(plain, { boardKinds: {}, country: IN }).outlet, true,
    'a plate somebody dropped by hand is still born an outlet');
  assert.deepEqual(plain.heightsMm, [1200], '...at switch height');

  // 3. AN OVERRIDE STILL WINS. Ticking a lamp's plate over to an outlet is
  //    allowed; what it costs is the lamp's switch, which is the honest
  //    consequence of the tick rather than a state to prevent.
  assert.equal(
    boardModeOf(plate, { boardKinds: { 'sb-lamp': { outlet: true } }, country: IN }).outlet,
    true, 'and a person may still tick it across');

  // 4. THE PLATE CARRIES A SOCKET AND ITS SWITCH — one pair per lamp.
  const lampFlow = (id) => ({ id, kind: 'lamp', label: 'Standing lamp',
                              boardId: 'sb-lamp' });
  const one = composeBoard(plate, { country: IN, flowsPx: [lampFlow('f1')] });
  const kinds = one.boards[0].points.map((q) => q.kind).filter((k) => k !== 'blank');
  assert.deepEqual(kinds, ['switch', 'socket'],
    `one lamp is a switch and a socket, and nothing else (got ${kinds.join()})`);
  assert.equal(one.total, 3, 'three modules in India — a 1-module switch and a 2-module socket');

  // 5. NO SPARE SOCKET ON IT. Every other board gets one more socket than the
  //    drawing asked for; this plate EXISTS because somebody wanted a socket, so
  //    a spare would double a three-module frame for a floor lamp.
  assert.ok(!one.boards[0].points.some((q) => q.source === 'spare'),
    'a lamp\'s plate gets no spare socket');
  const spared = composeBoard(plain, { country: IN, flowsPx: [] });
  assert.ok(spared.boards[0].points.some((q) => q.source === 'spare'),
    '...and every other plate still does');

  // 6. A SECOND LAMP BESIDE THE FIRST NEEDS ANOTHER SWITCH AND SOCKET, and it
  //    gets them on the SAME plate rather than in a second frame — which is how
  //    it is built, and is what "another socket, not another board" means.
  const near = lampSocketSeat({ x: 60, y: 210 },
    { rooms, plates: [plate], pxPerFt: PPF });
  assert.equal(near, null, 'a second lamp within reach of that plate seats no new frame');
  const two = composeBoard(plate,
    { country: IN, flowsPx: [lampFlow('f1'), lampFlow('f2')] });
  const kinds2 = two.boards[0].points.map((q) => q.kind).filter((k) => k !== 'blank');
  assert.deepEqual(kinds2, ['switch', 'socket', 'switch', 'socket'],
    `two lamps are two pairs on one plate (got ${kinds2.join()})`);
  assert.equal(two.total, 6, 'six modules, and still one frame');

  // ...and a second lamp OUT of reach of it gets a frame of its own.
  const far = lampSocketSeat({ x: 540, y: 180 },
    { rooms, plates: [plate], lamps: [{ x: 60, y: 180 }], pxPerFt: PPF });
  assert.ok(far?.seat, 'a lamp across the room seats its own plate');
  assert.equal(far.role, 'lamp', '...also as a lamp\'s plate');

  /* --- ONE PLATE FOR TWO LAMPS FOUR FEET APART ---------------------------
     TWO WERE GOING UP WHERE ONE WOULD DO. Each plate was seated at the wall
     point nearest ITS OWN lamp, so the first ended up hard against the first
     lamp and out of reach of the second by the time it arrived. Seated between
     them it is inside the reach of both.
     BEDROOM is 600 x 360 at 30.48 px/ft, so three feet is 91.44px. Two lamps
     2ft off the left wall and 4ft apart: (61, 120) and (61, 242). */
  const A = { x: 61, y: 120 }, B = { x: 61, y: 242 };
  const first = lampSocketSeat(A, { rooms, plates: [], lamps: [A], pxPerFt: PPF });
  const seated = applyMode(handBoards(BEDROOM, {
    manualBoards: [{ id: 'sb-a', roomId: 'r1', sFt: first.seat.sFt, role: 'lamp' }],
    pxPerFt: PPF,
  }), { boardMode: (b) => boardModeOf(b, { boardKinds: {}, country: IN }) });
  const share = lampSocketSeat(B,
    { rooms, plates: seated, lamps: [A, B], pxPerFt: PPF });
  assert.ok(share?.slide, 'the second lamp slides the first plate rather than adding one');
  assert.equal(share.slide, 'sb-a', '...the plate that was already there');
  // AND THE SLID POSITION REACHES BOTH, which is the condition the move is
  // accepted on — a move that stranded the lamp it was already serving would be
  // no improvement, and the answer there is the second plate after all.
  const moved = applyMode(handBoards(BEDROOM, {
    manualBoards: [{ id: 'sb-a', roomId: 'r1', sFt: share.sFt, role: 'lamp' }],
    pxPerFt: PPF,
  }), { boardMode: (b) => boardModeOf(b, { boardKinds: {}, country: IN }) });
  const reach = 3 * PPF;
  for (const [n, q] of [['first', A], ['second', B]]) {
    assert.ok(Math.hypot(moved[0].point.x - q.x, moved[0].point.y - q.y) <= reach + 1e-6,
      `the moved plate is within three feet of the ${n} lamp`);
  }

  /* A PLATE SERVING NOBODY IS LEFT WHERE IT IS. Sharing means reaching this
     lamp AND the ones it already reaches; with nothing on it there is nothing
     to share, and sliding it would be moving a plate whose lamp the caller may
     simply not have handed us. */
  const orphan = lampSocketSeat({ x: 540, y: 180 },
    { rooms, plates: seated, lamps: [], pxPerFt: PPF });
  assert.ok(orphan?.seat, 'a plate serving no known lamp is not dragged across the room');
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
