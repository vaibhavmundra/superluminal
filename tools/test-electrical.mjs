// ---------------------------------------------------------------------------
// test-electrical.mjs — switchboards on a wall.
//
// Every number here is worked out by hand from a 600x360 room, a 900mm door and
// a 180mm wall, at 30.48 px/ft. That scale is chosen so the millimetres come out
// round: a 900mm opening is 90px, 300mm is 30px, a 230mm plate is 23px. The
// offsets are then readable in the assertions instead of hidden behind a
// conversion, and a failure names an arithmetic mistake rather than a vibe.
//
//   node tools/test-electrical.mjs
// ---------------------------------------------------------------------------

import {
  wallRuns, runFrame, wallFrame, doorCandidate, mergeDoors, assignDoors,
  entryDoor, latchEnd, halfPlaneArea, swingSides, planSwitchboards, px, SB_MM,
} from '../src/lib/electrical.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const PPF = 30.48;                       // 900mm = 90px, 300mm = 30px, 230mm = 23px
const ROOM = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 360 }, { x: 0, y: 360 }];
const GAP = px(SB_MM.fromDoor, PPF);     // 30
const HALF = px(SB_MM.along, PPF) / 2;   // 11.5

/** A 900mm door in the top wall: 180mm of wall above it, its swing below. */
const door = (x0, id = 'd1') => ({
  id, cls: 'door', conf: 0.99, rect: { x0, y0: -18, x1: x0 + 90, y1: 90 },
});

console.log('-- walls, merged into runs --');
{
  const runs = wallRuns(ROOM);
  ok(runs.length === 4, `a rectangle is four runs (got ${runs.length})`);
  ok(near(runs[0].length, 600), 'runs carry their own length');

  // The same rectangle with a mid-wall vertex and a half-degree kink in it.
  const kinked = [{ x: 0, y: 0 }, { x: 300, y: 1 }, { x: 600, y: 0 },
    { x: 600, y: 360 }, { x: 0, y: 360 }];
  ok(wallRuns(kinked).length === 4,
    `a 1px kink does not split a wall in two (got ${wallRuns(kinked).length})`);

  const bent = [{ x: 0, y: 0 }, { x: 300, y: 120 }, { x: 600, y: 0 },
    { x: 600, y: 360 }, { x: 0, y: 360 }];
  ok(wallRuns(bent).length === 5, 'a real bend is two walls, not one');
}

console.log('\n-- the inward normal is tested, not assumed --');
{
  const top = runFrame(wallRuns(ROOM)[0], ROOM);
  ok(near(top.inward.x, 0) && near(top.inward.y, 1), 'the top wall faces down into the room');
  const rev = [...ROOM].reverse();
  const flip = runFrame(wallRuns(rev).find((r) => near(r.a.y, 0) && near(r.b.y, 0)), rev);
  ok(near(flip.inward.x, 0) && near(flip.inward.y, 1),
    'and it still faces down when the polygon is wound the other way');
}

console.log('\n-- a door box, in its wall\'s frame --');
{
  const f = wallFrame(door(180).rect, wallRuns(ROOM)[0], ROOM);
  ok(near(f.t0, 180) && near(f.t1, 270), 't runs along the wall: 180 to 270');
  ok(near(f.nIn, 90), `90px of swing inside the room (got ${f.nIn})`);
  ok(near(f.nOut, 18), `18px of box in the wall (got ${f.nOut})`);
  ok(near(f.insideFrac, 90 / 108), 'insideFrac is the analytic form of rectCoverage');
  ok(near(f.wallThicknessPx, 18), 'and the wall thickness falls out of it for free');
}

console.log('\n-- which door swings into this room --');
{
  const c = doorCandidate(door(180), ROOM, { pxPerFt: PPF });
  ok(c !== null && c.score > 0.8, 'a door swinging in is this room\'s door');
  ok(c.run.index === 0, 'and it belongs to the top wall');
  ok(c.double === false, 'one leaf, not two');

  const out = { id: 'd2', conf: 0.99, rect: { x0: 180, y0: -90, x1: 270, y1: 18 } };
  ok(doorCandidate(out, ROOM, { pxPerFt: PPF }) === null,
    'the same box swung the other way is not this room\'s door');

  // THE FLOATING BOX. A misfire boxing a wardrobe sits wholly inside the
  // outline and scores a perfect 1.00 on coverage alone. The straddle gate is
  // the only thing between it and a switchboard beside a wardrobe.
  const floating = { id: 'd3', conf: 0.99, rect: { x0: 240, y0: 150, x1: 330, y1: 258 } };
  ok(doorCandidate(floating, ROOM, { pxPerFt: PPF }) === null,
    'a box out in the middle of the floor never crosses a wall, so it is not a door');

  // 150px at this scale is a 1500mm "door".
  const huge = { id: 'd4', conf: 0.99, rect: { x0: 60, y0: -30, x1: 210, y1: 150 } };
  ok(doorCandidate(huge, ROOM, { pxPerFt: PPF }) === null,
    'a 1500mm "door" is refused once there is a scale to measure it with');
  ok(doorCandidate(huge, ROOM, {}) !== null,
    '...and admitted when there is not, rather than guessed at');
}

console.log('\n-- two boxes over one door --');
{
  const leaf = { id: 'a', conf: 0.9, rect: { x0: 180, y0: -18, x1: 198, y1: 72 } };
  const arc = { id: 'b', conf: 0.8, rect: { x0: 186, y0: -18, x1: 270, y1: 72 } };
  const m = mergeDoors([leaf, arc]);
  ok(m.length === 1, 'a leaf box and an arc box are one door');
  ok(near(m[0].rect.x0, 180) && near(m[0].rect.x1, 270), 'and the union is leaf-plus-swing');
  ok(mergeDoors([door(60, 'x'), door(420, 'y')]).length === 2,
    'two doors far apart on the same wall stay two doors');
}

console.log('\n-- who owns a door in a shared wall --');
{
  const upper = { id: 'up', polygonPx: ROOM };
  const lower = { id: 'lo', polygonPx: [{ x: 0, y: 360 }, { x: 600, y: 360 },
    { x: 600, y: 720 }, { x: 0, y: 720 }] };
  const into = { id: 's1', conf: 0.99, rect: { x0: 180, y0: 342, x1: 270, y1: 450 } };
  const { byRoom } = assignDoors([into], [upper, lower], { pxPerFt: PPF });
  ok(byRoom.get('lo').length === 1 && byRoom.get('up').length === 0,
    'a door in a shared wall belongs to the room it swings into');

  // A box drawn generously over BOTH swings reads the same from either side.
  // IT USED TO BE THROWN AWAY HERE, and that lost the only door a bedroom had:
  // `insideFrac` is a ratio, so a box poking equally into two rooms scores ~0.42
  // from both — one weak claim seen twice, not two strong ones. The tie now
  // keeps the door alive for both and lets entryDoor choose.
  const both = { id: 's2', conf: 0.99, rect: { x0: 180, y0: 315, x1: 270, y1: 405 } };
  const r2 = assignDoors([both], [upper, lower], { pxPerFt: PPF });
  ok(r2.byRoom.get('lo').length === 1 && r2.byRoom.get('up').length === 1,
    'an evenly-straddling box stays a candidate for both, rather than being dropped');
  ok(r2.byRoom.get('up')[0].shared?.length === 2,
    'and carries the tie it is part of, so the caller can say so');
  ok(r2.notes.length === 0,
    'assignDoors says nothing itself — it runs plan-wide and its notes reached every space');

  // A room that owns a door outright is not marked shared.
  ok(byRoom.get('lo')[0].shared === null, 'an unambiguous door carries no tie');
}

console.log('\n-- a bedroom is never left doorless by a tie --');
{
  // The exact shape that used to come back "No door box reads as swinging into
  // this space": a 101px box sitting 50px into the room either side of the wall.
  const BED = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const COR = [{ x: 0, y: 318 }, { x: 400, y: 318 }, { x: 400, y: 600 }, { x: 0, y: 600 }];
  const rooms = [{ id: 'A', name: 'Bedroom', polygonPx: BED },
    { id: 'B', name: 'Corridor', polygonPx: COR }];
  const even = { id: 'e', conf: 0.99, rect: { x0: 150, y0: 250, x1: 251, y1: 368 } };

  const { boards, notes } = planSwitchboards({
    room: rooms[0], rooms, doors: [even], pxPerFt: PPF,
  });
  const b = boards.find((x) => x.role === 'door');
  ok(b && !b.rejected, 'the bedroom gets its board');
  ok(near(b.point.y, 300), 'on the wall the door is in');
  ok(b.shared?.length === 2, 'the board records that the door was a tie');
  ok(!notes.some((n) => /door/.test(n)),
    'and the space is never told no door opens into it, which was not true');
  ok(notes.length === 2, `no lecture in the panel either — ${notes.length} notes, both about`
    + ' fittings this space does not have');
}

console.log('\n-- a door the gates refuse still gets its board --');
{
  // THE REQUIREMENT: a bedroom with a door on the plan gets a board beside it.
  // Each of these boxes fails a different gate outright — too flat, too small,
  // buried in the wall, standing off it — and the detector still called every
  // one a door. Refusing to place a board is not an available answer.
  const BED = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const rooms = [{ id: 'A', name: 'Bedroom', polygonPx: BED }];
  const boxes = {
    'buried in the wall': { x0: 150, y0: 296, x1: 251, y1: 322 },
    'a 400mm opening': { x0: 150, y0: 260, x1: 190, y1: 310 },
    'standing 19px off it': { x0: 150, y0: 180, x1: 251, y1: 281 },
  };
  for (const [what, rect] of Object.entries(boxes)) {
    const { boards } = planSwitchboards({
      room: rooms[0], rooms, doors: [{ id: 'd', conf: 0.99, rect }], pxPerFt: PPF,
    });
    const b = boards.find((x) => x.role === 'door');
    ok(b && !b.rejected && b.point, `a box ${what} still gets a board`);
    ok(b?.fellBack === true, '...through the fallback, and the board says so');
  }
}

console.log('\n-- the entry door, of two --');
{
  const bed = { id: 'bed', polygonPx: ROOM };
  const bath = { id: 'bath', polygonPx: [{ x: 0, y: -300 }, { x: 300, y: -300 },
    { x: 300, y: 0 }, { x: 0, y: 0 }] };
  const ensuite = doorCandidate(door(60, 'ensuite'), ROOM, { pxPerFt: PPF });
  const corridor = doorCandidate(door(420, 'corridor'), ROOM, { pxPerFt: PPF });
  const pick = entryDoor([ensuite, corridor], {
    rooms: [bed, bath], roomTypes: { bath: { type: 'toilet' } }, selfId: 'bed',
  });
  ok(pick.door.id === 'corridor', `the corridor door wins, not the ensuite (got ${pick.door.id})`);
  ok(/circulation/.test(pick.why), `and says why: "${pick.why}"`);
  ok(entryDoor([ensuite], { rooms: [bed, bath], selfId: 'bed' }).why === 'the only door into this space',
    'one door needs no rule');
}

console.log('\n-- cutting the room in two --');
{
  const SQ = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  ok(near(halfPlaneArea(SQ, { x: 50, y: 0 }, { x: 1, y: 0 }), 5000), 'half a square is half its area');
  ok(near(halfPlaneArea(SQ, { x: 50, y: 0 }, { x: -1, y: 0 }), 5000), 'and so is the other half');
  ok(near(halfPlaneArea(SQ, { x: -1, y: 0 }, { x: 1, y: 0 }), 10000), 'a cut outside keeps everything');
  ok(near(halfPlaneArea(SQ, { x: 101, y: 0 }, { x: 1, y: 0 }), 0), 'and past the far side, nothing');

  // THE CONCAVE CASE, which is the one this has to survive: Sutherland-Hodgman
  // hands back an outline with degenerate edges along the cut, and the area is
  // still right because those contribute nothing to the shoelace sum.
  const U = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 },
    { x: 70, y: 40 }, { x: 30, y: 40 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
  const whole = halfPlaneArea(U, { x: -1, y: 0 }, { x: 1, y: 0 });
  const left = halfPlaneArea(U, { x: 50, y: 0 }, { x: -1, y: 0 });
  const right = halfPlaneArea(U, { x: 50, y: 0 }, { x: 1, y: 0 });
  ok(near(whole, 7600), `a U is 10000 less its 40x60 notch (got ${whole})`);
  ok(near(left + right, whole), 'and the two halves of a concave room still sum to it');
}

console.log('\n-- the door opens toward the bulk of the floor --');
{
  const c = doorCandidate(door(180), ROOM, { pxPerFt: PPF });
  const sides = swingSides(c, ROOM);
  ok(near(sides.down, 225 * 360) && near(sides.up, 375 * 360),
    'the room is cut on the door\'s own centreline, not at a jamb');
  ok(near(sides.lead, (375 - 225) / 600), 'and the lead is scale-free');

  const { latchT, hingeT, confidence } = latchEnd(c, ROOM);
  ok(near(hingeT, 180) && near(latchT, 270),
    `hinge on the thin side (180), latch on the wide one (270) — got ${hingeT}/${latchT}`);
  ok(confidence === 'area', `decided on floor area (got ${confidence})`);

  const r2 = latchEnd(doorCandidate(door(330), ROOM, { pxPerFt: PPF }), ROOM);
  ok(near(r2.hingeT, 420) && near(r2.latchT, 330), 'and it mirrors when the door does');
}

console.log('\n-- an L-shaped room, where the wall alone cannot tell --');
{
  // 400px of top wall, 150 deep, with the right-hand third dropping to 600.
  // The door is DEAD CENTRE on that wall, so both ends of it are 155px away and
  // the old wall-run rule abstained. Two thirds of the floor is to the right.
  const L_ROOM = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 600 },
    { x: 250, y: 600 }, { x: 250, y: 150 }, { x: 0, y: 150 }];
  const centred = { id: 'L', conf: 0.99, rect: { x0: 155, y0: -18, x1: 245, y1: 90 } };
  const c = doorCandidate(centred, L_ROOM, { pxPerFt: PPF });
  ok(c !== null && c.run.index === 0, 'the door is on the long top wall');

  const sides = swingSides(c, L_ROOM);
  ok(near(sides.down, 30000) && near(sides.up, 97500),
    `the leg counts: ${sides.down} left, ${sides.up} right`);
  ok(sides.lead > 0.5, 'which is not close');

  const { latchT, hingeT, confidence } = latchEnd(c, L_ROOM);
  ok(confidence === 'area', `decided, where the wall rule abstained (got ${confidence})`);
  ok(near(hingeT, 155) && near(latchT, 245),
    'it opens INTO the leg — hinge against the short side, latch toward the floor');

  // The wall-run rule, run by hand on the same door, is a dead heat: both jambs
  // are 155px from an end. That is the whole reason this changed.
  const dEnd = (t) => Math.min(t, 400 - t);
  ok(near(dEnd(155), dEnd(245)), 'the wall alone genuinely cannot separate them');

  // Mirror the leg to the other side and the door turns round with it.
  const MIRROR = L_ROOM.map((p) => ({ x: 400 - p.x, y: p.y })).reverse();
  const m = latchEnd(doorCandidate(centred, MIRROR, { pxPerFt: PPF }), MIRROR);
  ok(near(m.hingeT, 245) && near(m.latchT, 155),
    'the floor moved, so the swing moved with it');
}

console.log('\n-- a dead heat falls back to the wall, and says so --');
{
  const c = doorCandidate(door(255), ROOM, { pxPerFt: PPF });
  ok(near(swingSides(c, ROOM).lead, 0), 'a door dead centre in a rectangle splits it evenly');
  ok(latchEnd(c, ROOM).confidence === 'guess',
    `so it is a guess, and is labelled one (got ${latchEnd(c, ROOM).confidence})`);

  // Off centre enough for the wall to have an opinion, but not enough for the
  // floor: the middle rung of the ladder.
  const c2 = doorCandidate(door(230), ROOM, { pxPerFt: PPF });
  ok(swingSides(c2, ROOM).lead < 0.10, 'a 46/54 split is not a majority worth acting on');
  const off = latchEnd(c2, ROOM);
  ok(off.confidence === 'convention',
    `near-even floor falls back to the wall (got ${off.confidence})`);
  ok(near(off.hingeT, 230) && near(off.latchT, 320),
    'hinging toward the nearer corner, as it always did');
}

console.log('\n-- the board itself --');
{
  const room = { id: 'o1', polygonPx: ROOM };
  const { boards } = planSwitchboards({ room, rooms: [room], doors: [door(180)], pxPerFt: PPF });
  const b = boards.find((x) => x.role === 'door');
  ok(b && !b.rejected, 'a door yields a board');
  ok(near(b.t, 270 + GAP + HALF), `plate centre at ${270 + GAP + HALF} (got ${b.t})`);
  ok(near(b.point.y, 0), 'and it sits on the wall line');
  ok(near(b.rect.x0, 270 + GAP), 'its near edge is exactly 300mm past the latch jamb');
  ok(near(b.rect.y1 - b.rect.y0, px(SB_MM.deep, PPF)), 'it stands 80mm off the wall');
  ok(b.turnedCorner === false && !b.poor, 'no corner turned, no compromise');
  ok(/latch jamb/.test(b.why), `and it says what it did: "${b.why}"`);
}

console.log('\n-- when the wall runs out, turn the corner --');
{
  // A 140px wall: barely longer than the door, with the latch 40px from the end.
  const NARROW = [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 360 }, { x: 0, y: 360 }];
  const room = { id: 'o2', polygonPx: NARROW };
  const tight = { id: 't', conf: 0.99, rect: { x0: 10, y0: -18, x1: 100, y1: 90 } };
  const { boards } = planSwitchboards({ room, rooms: [room], doors: [tight], pxPerFt: PPF });
  const b = boards.find((x) => x.role === 'door');
  ok(b && !b.rejected, 'still a board');
  ok(b.turnedCorner === true, 'it turned the corner rather than clamping to it');
  ok(near(b.point.x, 140), 'onto the wall the latch side runs into');
  ok(near(b.point.y, GAP + HALF),
    `300mm down from the corner (expected ${GAP + HALF}, got ${b.point.y})`);
}

console.log('\n-- the bedside boards ARE the sconces --');
{
  const room = { id: 'o3', polygonPx: ROOM };
  const sconce = (x, what) => ({
    id: `acc-o3-${what}`, type: 'sconce', group: 'bedside', what,
    point: { x, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
    wall: { a: ROOM[0], b: ROOM[1], index: 0 }, t: x,
  });
  const { boards } = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF,
    accentZones: [sconce(166.8, 'left of the bed'), sconce(433.2, 'right of the bed')],
  });
  const beds = boards.filter((b) => b.role === 'bedside');
  ok(beds.length === 2, 'two sconces, two boards');
  ok(near(beds[0].point.x, 166.8) && near(beds[1].point.x, 433.2),
    'each one exactly where its sconce is, not near it');
  ok(beds.every((b) => !b.rejected), 'and neither is refused');

  const one = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF,
    accentZones: [sconce(166.8, 'left'), { ...sconce(433.2, 'right'), rejected: 'no wall' }],
  });
  ok(one.boards.filter((b) => b.role === 'bedside').length === 1,
    'a refused sconce is not a fitting, so it gets no board');
}

console.log('\n-- the TV board comes off the strip, not off a fresh guess --');
{
  const room = { id: 'o4', polygonPx: ROOM };
  const strip = {
    id: 'acc-o4-2', type: 'strip', from: 'tv_unit',
    run: [{ x: 210, y: 360 }, { x: 390, y: 360 }],
    wall: { a: ROOM[2], b: ROOM[3], index: 2 },
    alongWall: { t0: 210, t1: 390 },
  };
  const { boards } = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF, accentZones: [strip],
  });
  const tv = boards.find((b) => b.role === 'tv');
  ok(tv && !tv.rejected, 'a TV strip yields a board');
  ok(near(tv.point.y, 360), 'on the TV\'s own wall — the one the strip is on');
  ok(near(Math.min(Math.abs(tv.point.x - 210), Math.abs(tv.point.x - 390)), GAP + HALF),
    `300mm clear of one end of the unit (got x=${tv.point.x})`);
  ok(/beyond the end of the TV/.test(tv.why), `and says so: "${tv.why}"`);
}

console.log('\n-- two plates in the same place are marked, not tidied away --');
{
  const room = { id: 'o7', polygonPx: ROOM };
  // A door whose latch is at 150, so its board lands at 191.5 — and a bedside
  // sconce at 170, a foot clear of a bed whose head is right beside the door.
  const sconce = (x) => ({
    id: `acc-o7-${x}`, type: 'sconce', group: 'bedside', what: 'left of the bed',
    point: { x, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
    wall: { a: ROOM[0], b: ROOM[1], index: 0 }, t: x,
  });
  const tight = { id: 'n', conf: 0.99, rect: { x0: 60, y0: -18, x1: 150, y1: 90 } };
  const { boards } = planSwitchboards({
    room, rooms: [room], doors: [tight], pxPerFt: PPF, accentZones: [sconce(170)],
  });
  const [d, s1] = [boards.find((b) => b.role === 'door'), boards.find((b) => b.role === 'bedside')];
  ok(d.clash?.includes(s1.id) && s1.clash?.includes(d.id), 'both ends of a clash know about it');
  ok(near(d.t, 150 + GAP + HALF) && near(s1.point.x, 170),
    'and NEITHER has moved — the 300mm and the sconce are both what was asked for');
  ok(/same piece of wall/.test(d.poor), `it says what is wrong: "${d.poor}"`);

  // Far enough apart, and it is not a clash.
  const clear = planSwitchboards({
    room, rooms: [room], doors: [tight], pxPerFt: PPF, accentZones: [sconce(400)],
  });
  ok(clear.boards.every((b) => !b.clash), 'boards a plate-width apart are left alone');

  // Same distance, different wall: not a clash either.
  const other = planSwitchboards({
    room, rooms: [room], doors: [tight], pxPerFt: PPF,
    accentZones: [{ ...sconce(170), wall: { a: ROOM[2], b: ROOM[3], index: 2 },
      point: { x: 170, y: 360 }, inward: { x: 0, y: -1 } }],
  });
  ok(other.boards.every((b) => !b.clash), 'and two boards on different walls never clash');
}

console.log('\n-- no scale, no millimetres --');
{
  const room = { id: 'o5', polygonPx: ROOM };
  const { boards } = planSwitchboards({
    room, rooms: [room], doors: [door(180)], pxPerFt: null,
  });
  ok(boards.length >= 1, 'the boards are still reported');
  ok(boards.every((b) => /no scale/i.test(b.rejected || '')),
    'every one refused with a sentence, rather than arithmetic on a null');
}

console.log('\n-- silence is never the answer --');
{
  const room = { id: 'o6', polygonPx: ROOM };
  const { boards, notes } = planSwitchboards({ room, rooms: [room], doors: [], pxPerFt: PPF });
  ok(boards.length === 0, 'nothing to go on, so no boards');
  ok(notes.length === 3, `three notes, one per rule that found nothing (got ${notes.length})`);
  ok(notes.every((n) => /\.$/.test(n)), 'and each one is a sentence');
  for (const junk of [undefined, {}, { room: { id: 'x', polygonPx: [] } }]) {
    let threw = false;
    try { planSwitchboards(junk); } catch { threw = true; }
    ok(!threw, `junk input does not throw: ${JSON.stringify(junk) ?? 'undefined'}`);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
