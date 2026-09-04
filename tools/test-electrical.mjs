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
  headSide, facingWall, FACING_PLATES,
  slideBoardTo, plateAtS, wallPath, asDrawn,
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

console.log('\n-- the television wall: one mark, two plates, on the centreline --');
{
  // THE TELEVISION HUNT IS GONE. This rule used to read the strip along a
  // `tv_unit` the accent pass had found, and fall back to a vision call asking
  // whether there was a television opposite the bed. It now takes that wall as
  // a given and lands on the bed's own centreline — see the header of
  // planSwitchboards and rule 3.
  //
  // A 5.9ft bed, head against the top wall, sides at x=210 and x=390, so its
  // centreline is x=300. The wall it faces is the bottom one, y=360.
  const room = { id: 'o4', polygonPx: ROOM };
  const bed = { x0: 210, y0: 0, x1: 390, y1: 200, cls: 'bed' };
  const { boards, notes } = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF, bedRect: bed,
  });
  const face = boards.filter((b) => b.role === 'facing');
  ok(face.length === 1,
    `ONE board object, because in plan the two plates are one rectangle (got ${face.length})`);
  const f = face[0];
  ok(!f.rejected, 'and it is not refused on a wall this long');
  ok(f.plates === FACING_PLATES && f.plates === 2,
    `carrying two plates, stacked in elevation (got ${f.plates})`);
  ok(near(f.point.y, 360), 'on the wall the bed looks at, not the one behind it');
  ok(near(f.point.x, 300),
    `exactly where the bed's centreline meets it (got x=${f.point.x})`);
  ok(!f.clamped, 'nothing was moved to make it fit');
  ok(/centreline/.test(f.why), `and says so: "${f.why}"`);
  ok(!notes.some((n) => /television|TV/i.test(n)),
    'and nothing is said about a television, because nothing looked for one');
  ok(!boards.some((b) => b.role === 'tv'), 'no board has the retired tv role');

  // NOT A CLASH. Two board objects at one point would have `markClashes`
  // reporting a deliberate arrangement as a fault; one object carrying a count
  // cannot.
  ok(!f.clash, 'and the pair is not reported as two boards fighting over a wall');

  // STABLE IDS, because a deletion is stored against one. Adding a bedside
  // sconce must not renumber this plate.
  const withSconce = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF, bedRect: bed,
    accentZones: [{ id: 'acc-o4-0', type: 'sconce', group: 'bedside', what: 'left',
      point: { x: 166.8, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
      wall: { a: ROOM[0], b: ROOM[1], index: 0 }, t: 166.8 }],
  });
  ok(withSconce.boards.find((b) => b.role === 'facing')?.id === f.id,
    `it keeps its id when another rule fires (${f.id})`);
}

console.log('\n-- ...and when it cannot find the wall, it says so --');
{
  const room = { id: 'o4b', polygonPx: ROOM };
  const none = planSwitchboards({ room, rooms: [room], doors: [], pxPerFt: PPF });
  ok(!none.boards.some((b) => b.role === 'facing'), 'no bed, no board');
  ok(none.notes.some((n) => /no bed was found/i.test(n)), 'and it says why');

  // A bed adrift in the middle of the floor has no headboard wall, so there is
  // no wall facing one either. Same 2ft threshold bedGrid.js uses — at 30.48
  // px/ft that is 61px, and this bed is 90px (2.95ft) clear on all four sides.
  const adrift = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF,
    bedRect: { x0: 210, y0: 90, x1: 390, y1: 270, cls: 'bed' },
  });
  ok(!adrift.boards.some((b) => b.role === 'facing'), 'a bed adrift gets no board');
  ok(adrift.notes.some((n) => /not against a wall/i.test(n)),
    'and it says that rather than guessing');

  // The rule not asked for says nothing at all — the same contract the other two
  // keep, so a caller running the door alone does not print a bed note per space.
  const doorOnly = planSwitchboards({
    room, rooms: [room], doors: [door(180)], pxPerFt: PPF, rules: ['door'],
  });
  ok(!doorOnly.notes.some((n) => /bed/i.test(n)),
    'a rule that was not run has nothing to say about its input');
}

console.log('\n-- the headboard wall is read off the box, whichever side it is --');
{
  const room = { id: 'o4c', polygonPx: ROOM };
  // Head against the LEFT wall this time: the bed runs along x, its centreline
  // is y=180, and the wall it faces is the right-hand one at x=600.
  const { boards } = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF,
    bedRect: { x0: 0, y0: 90, x1: 200, y1: 270, cls: 'bed' },
  });
  const f = boards.find((b) => b.role === 'facing');
  ok(f && !f.rejected && f.plates === 2, 'still one board of two plates');
  ok(near(f.point.x, 600) && near(f.point.y, 180),
    `on the right-hand wall, on the bed's centreline (got ${f.point.x}, ${f.point.y})`);
}

console.log('\n-- a centreline in a corner is moved, not refused --');
{
  // THE ONE PLACE THIS FILE CLAMPS ON PURPOSE. Every other rule steps off a
  // thing and has somewhere else to go when the wall runs out; this rule IS the
  // centreline and has nowhere. A bedroom with no switch on its television wall
  // is a worse answer than a plate that says it moved.
  //
  // A narrow bed hard against the left of the top wall: centreline x=17, which
  // is inside half a plate plus its 100mm clearance (21.5px) of the corner.
  const room = { id: 'o4d', polygonPx: ROOM };
  const { boards } = planSwitchboards({
    room, rooms: [room], doors: [], pxPerFt: PPF,
    bedRect: { x0: 2, y0: 0, x1: 32, y1: 200, cls: 'bed' },
  });
  const f = boards.find((b) => b.role === 'facing');
  ok(f && !f.rejected, 'still a board');
  ok(f.clamped === true, 'and it says it was moved');
  ok(near(f.point.x, HALF + px(SB_MM.clearEnd, PPF)),
    `to half a plate plus its clearance off the corner (got x=${f.point.x})`);
  ok(/moved along/.test(f.why), `and why: "${f.why}"`);

  // A wall that cannot take a plate at all is refused with a sentence rather
  // than clamped into something that hangs off both ends.
  const slot = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 360 }, { x: 0, y: 360 }];
  const tiny = planSwitchboards({
    room: { id: 'o4e', polygonPx: slot }, rooms: [], doors: [], pxPerFt: PPF,
    bedRect: { x0: 5, y0: 0, x1: 35, y1: 200, cls: 'bed' },
  });
  const tf = tiny.boards.find((b) => b.role === 'facing');
  ok(tf?.rejected && /too short/.test(tf.rejected),
    `a 40px wall is refused with a sentence: "${tf?.rejected}"`);
}

console.log('\n-- a board moved by hand, along the walls of its space --');
{
  // ROOM is 600x360, wound (0,0) (600,0) (600,360) (0,360). wallRuns starts at a
  // genuine corner, so the runs come out top, right, bottom, left and the
  // perimeter reads 0..600 along the top, 600..960 down the right, 960..1560
  // back along the bottom, 1560..1920 up the left. KEEP is half a plate plus its
  // 100mm clearance: 21.5px.
  const room = { id: 'o8', polygonPx: ROOM };
  const KEEP = HALF + px(SB_MM.clearEnd, PPF);
  const base = { room, rooms: [room], doors: [door(180)], pxPerFt: PPF };
  const before = planSwitchboards(base).boards.find((b) => b.role === 'door');
  ok(before && !before.moved && !before.hand,
    'a board nobody touched carries no hand position');

  // 300px round the top wall.
  const at300 = planSwitchboards({ ...base, moves: { [before.id]: 300 / PPF } })
    .boards.find((b) => b.role === 'door');
  ok(near(at300.hand.point.x, 300) && near(at300.hand.point.y, 0),
    `it lands where it was dragged (got ${at300.hand.point.x}, ${at300.hand.point.y})`);
  ok(at300.moved === true && /moved onto this wall by hand/.test(at300.why),
    `and says it was moved: "${at300.why}"`);
  ok(/300mm past the latch jamb/.test(at300.why),
    'while still saying what the rule had wanted');
  ok(near(at300.point.x, before.point.x) && near(at300.point.y, before.point.y),
    'THE RULE POSITION IS KEPT — the pass that decides which bay adopts this'
    + ' plate must not see the drag');
  ok(near(asDrawn(at300).point.x, 300), 'and asDrawn is what hands over the drag');

  // ...and 700px round, which is 100px down the RIGHT-hand wall.
  const round = planSwitchboards({ ...base, moves: { [before.id]: 700 / PPF } })
    .boards.find((b) => b.role === 'door');
  const h = round.hand;
  ok(near(h.point.x, 600) && near(h.point.y, 100),
    `past the corner it is on the next wall (got ${h.point.x}, ${h.point.y})`);
  ok(near(h.along.x, 0) && near(h.along.y, 1),
    'THE PLATE TURNED WITH THE WALL — its along axis is now vertical');
  ok(near(h.inward.x, -1) && near(h.inward.y, 0),
    'and it faces back into the room, not out through the wall');
  ok(h.wall.index !== before.wall.index, 'and it knows it is on a different wall');

  // A PLATE CANNOT STRADDLE A CORNER. The last KEEP of every wall is not a
  // position, so a drag into one steps to the clearance rather than hanging the
  // plate round the return.
  const corner = planSwitchboards({ ...base, moves: { [before.id]: 598 / PPF } })
    .boards.find((b) => b.role === 'door');
  ok(near(corner.hand.t, 600 - KEEP),
    `dragged into a corner it stops a plate's clearance short (got t=${corner.hand.t})`);

  // THE WALLS CLOSE, so the coordinate is a loop and cannot be dragged off the
  // end of. 1920 is the whole perimeter; 1925 is 5px back onto the top wall.
  const wrapped = planSwitchboards({ ...base, moves: { [before.id]: 1925 / PPF } })
    .boards.find((b) => b.role === 'door');
  ok(near(wrapped.hand.point.y, 0) && near(wrapped.hand.t, KEEP),
    `a distance past the last wall comes round onto the first (got t=${wrapped.hand.t})`);

  // A REFUSED BOARD HAS NO POSITION TO OVERRIDE.
  const noScale = planSwitchboards({ ...base, pxPerFt: null, moves: { [before.id]: 300 } })
    .boards.find((b) => b.role === 'door');
  ok(noScale.rejected && !noScale.hand && !noScale.moved,
    'a refused board is not movable');
}

console.log('\n-- the drag itself: a pointer becomes a distance round the walls --');
{
  const KEEP = HALF + px(SB_MM.clearEnd, PPF);
  const opt = { polygonPx: ROOM, pxPerFt: PPF };

  // Just inside the top wall, a third of the way along: the top wall is nearest.
  ok(near(slideBoardTo({ x: 200, y: 8 }, opt) * PPF, 200),
    'the nearest wall wins, and the distance is measured along it');

  // Just inside the right-hand wall: 600 along the top plus 150 down the right.
  ok(near(slideBoardTo({ x: 592, y: 150 }, opt) * PPF, 750),
    'on the next wall round it keeps counting');

  // OUT IN THE MIDDLE OF THE FLOOR IS STILL A WALL POSITION. A switchboard off
  // its wall is not a thing, so the pointer is projected rather than followed.
  const mid = slideBoardTo({ x: 300, y: 120 }, opt) * PPF;
  ok(near(mid, 300), `a pointer off the wall projects onto the nearest one (got ${mid})`);

  // THE CORNER ITSELF IS NOT A POSITION. A pointer in one is nearest to whichever
  // wall's clearance point is closer — here the right-hand wall's, 19.5px away
  // against the top wall's 20.6px — so the answer is never a distance at which a
  // plate would hang round the return. Which wall wins is not the assertion; the
  // clearance is.
  const inCorner = slideBoardTo({ x: 599, y: 2 }, opt) * PPF;
  ok(near(inCorner, 600 + KEEP),
    `a pointer in a corner lands on the nearer wall's clearance (got ${inCorner})`);
  const cornerT = plateAtS(inCorner, wallRuns(ROOM), ROOM, PPF, 360).t;
  ok(cornerT >= KEEP - 1e-6, `and a plate there clears the corner (t=${cornerT})`);

  // FEET, NOT PIXELS — the answer is stored, and plan pixels move with the
  // scale. Same reasoning as runTrims.
  ok(near(slideBoardTo({ x: 200, y: 8 }, opt), 200 / PPF),
    'the answer is in feet');

  // A wall too short for a plate is not offered at all: this 40px-wide slot has
  // two long walls and two that cannot hold a board.
  const slot = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 360 }, { x: 0, y: 360 }];
  const onSlot = slideBoardTo({ x: 20, y: 4 }, { polygonPx: slot, pxPerFt: PPF });
  const plate = plateAtS(onSlot * PPF, wallRuns(slot), slot, PPF, 40);
  ok(plate && (near(plate.point.x, 0) || near(plate.point.x, 40)),
    `a 40px end wall is skipped for one that can hold a plate (got x=${plate?.point.x})`);

  ok(slideBoardTo({ x: 1, y: 1 }, { polygonPx: ROOM, pxPerFt: 0 }) === null,
    'no scale, no answer — 230mm is not a distance it can measure');
  ok(slideBoardTo(null, opt) === null, 'and no pointer is no answer either');
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
