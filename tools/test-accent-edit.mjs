import { zonesFromFurniture, slideSconceTo, setRunEnd, moveRun, runSnaps,
         alongWallAt, RUN_EDIT } from '../src/lib/accentPlace.js';

// --- editing what the model proposed ---------------------------------------
//
// A SCONCE is one-dimensional: fixed to a wall, sliding along it. Its tests
// check invariants — stayed on the wall, clamped at the ends — rather than world
// coordinates, because a wall's own frame runs whichever way the polygon
// happened to wind and "further along the wall" can be a SMALLER y.
//
// A STRIP IS NOT one-dimensional any more, and that is what most of this file is
// about. Its ends used to be projected onto the wall the placement pass chose,
// which is the right gesture for a run that is on the right wall and the wrong
// length, and no use at all for the case people actually hit: the run is on the
// WRONG wall, because the furniture box it was derived from was off. Sliding an
// end along a line that is itself in the wrong place cannot fix that. So the end
// goes where the pointer goes, and every old constraint comes back as a SNAP.
//
//   node tools/test-accent-edit.mjs

let fail=0; const ok=(c,m)=>{console.log((c?'  ok  ':'  FAIL')+'  '+m); if(!c) fail++;};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

const room = [{x:0,y:0},{x:200,y:0},{x:200,y:120},{x:0,y:120}];
const bed = { type:'bed', rect:{ x0:70, y0:0, x1:130, y1:70 }, confidence:.9 };
const wardrobe = { type:'wardrobe', rect:{ x0:0, y0:20, x1:20, y1:100 }, confidence:.8 };

console.log('-- a sconce slides along its wall, and only along it --');
{
  const z = zonesFromFurniture([bed], room).zones[0];
  const before = { ...z.point };
  // Drag well off the wall, into the middle of the room.
  const moved = slideSconceTo(z, { x: 40, y: 60 });
  ok(near(moved.point.y, before.y), `it stayed on the wall: y ${moved.point.y}`);
  ok(near(moved.point.x, 40), `and slid to where the pointer was along it: x ${moved.point.x}`);
  ok(moved.edited === true, 'and is marked as moved by hand');
  ok(moved.mirrored === false, 'which breaks it out of its mirrored pair');

  // Past either end of the wall it clamps rather than running off the drawing.
  ok(near(slideSconceTo(z, { x: -80, y: 0 }).point.x, 0), 'clamped at the wall start');
  ok(near(slideSconceTo(z, { x: 900, y: 0 }).point.x, 200), 'clamped at the wall end');

  // The nominal box follows the point, so the hit area goes with it.
  const far = slideSconceTo(z, { x: 150, y: 0 });
  ok(near((far.rect.x0 + far.rect.x1) / 2, 150), 'its box follows the point');
}

console.log('\n-- a strip end goes WHERE YOU PUT IT --');
{
  const z = zonesFromFurniture([wardrobe], room).zones[0];
  const L0 = z.runLength;
  const t0 = alongWallAt(z.wall, z.run[0]).t, t1 = alongWallAt(z.wall, z.run[1]).t;
  ok(L0 > 0 && Math.abs(Math.abs(t1 - t0) - L0) < 1e-6, `starts at its derived length: ${L0.toFixed(2)}`);

  // THE WHOLE POINT. Drag an end into the middle of the room, nowhere near the
  // wall it was placed on, and it lands there. The old rule projected this back
  // onto the wall and the run never left it.
  const free = setRunEnd(z, 1, { x: 60, y: 55 });
  ok(near(free.run[1].x, 60) && near(free.run[1].y, 55),
    `it lands at the pointer: ${free.run[1].x},${free.run[1].y}`);
  ok(near(free.run[0].x, z.run[0].x) && near(free.run[0].y, z.run[0].y), 'the other end did not move');
  ok(free.edited === true, 'marked as edited');
  // The length is re-measured from the geometry, not carried over or projected
  // back onto a wall — which is what makes it right for a run that is now at an
  // angle to every wall in the room.
  ok(near(free.runLength, Math.hypot(free.run[1].x - free.run[0].x,
                                     free.run[1].y - free.run[0].y), 1e-9),
    `the length is the straight-line distance between the ends: ${free.runLength.toFixed(2)}`);

  // ...which means the run is no longer on a wall, and says so.
  ok(free.free === true, 'a run taken off the walls knows it is off them');
  ok(free.alongWall === null,
    'and drops its position-along-the-wall rather than reporting a number that means nothing');
}

console.log('\n-- the old constraint comes back as a snap --');
{
  const z = zonesFromFurniture([wardrobe], room).zones[0];
  const o = { polygon: room };

  // Collinear, a hair off: the axis catches it, so "just make it longer" still
  // produces a straight run without anyone aiming.
  const eps = RUN_EDIT.snapFt * 0.5;
  const along = setRunEnd(z, 1, { x: z.run[1].x + eps, y: 5 }, o);
  ok(along.snap === 'axis', `a near-collinear drag snaps to the axis: ${along.snap}`);
  ok(near(along.run[1].x, z.run[1].x), 'and comes back onto the run’s own line');
  ok(near(along.run[1].y, 5), '...while still going where you dragged it ALONG that line');

  // Near a wall — and not the wall it was placed on. The strip was taken off
  // the left wall; this lands an end on the bottom one.
  const other = setRunEnd(z, 1, { x: 60, y: RUN_EDIT.snapFt * 0.4 }, o);
  ok(other.snap === 'wall', `near a different wall it snaps to THAT wall: ${other.snap}`);
  ok(near(other.run[1].y, 0), 'landing exactly on it');

  // Out in the open, an orthogonal through the anchor keeps it square.
  const sq = setRunEnd(z, 1, { x: 60, y: z.run[0].y + RUN_EDIT.snapFt * 0.3 }, o);
  ok(sq.snap === 'ortho' || sq.snap === 'wall', `off the walls it still comes out square: ${sq.snap}`);

  // Genuinely off everything: no snap, and it says so rather than pretending.
  const loose = setRunEnd(z, 1, { x: 63, y: 47 }, o);
  ok(loose.snap === null, `a drag near nothing reports no snap: ${loose.snap}`);
  ok(near(loose.run[1].x, 63) && near(loose.run[1].y, 47), 'and lands untouched');

  // Without a polygon there is nothing to snap a wall to, and the axis still works.
  ok(setRunEnd(z, 1, { x: 60, y: RUN_EDIT.snapFt * 0.4 }).snap === null,
    'no room means no wall snapping, rather than a crash');
}

console.log('\n-- Shift is the old behaviour, on demand --');
{
  const z = zonesFromFurniture([wardrobe], room).zones[0];
  const locked = setRunEnd(z, 1, { x: 90, y: 30 }, { polygon: room, constrain: true });
  ok(locked.snap === 'axis', 'Shift pins the end to the run’s own axis');
  ok(near(locked.run[1].x, z.run[1].x), `however far off it the pointer is: x ${locked.run[1].x}`);
  ok(near(locked.run[1].y, 30), 'moving only along that axis');
  // The run stays exactly as straight as it started.
  const d0 = { x: z.run[1].x - z.run[0].x, y: z.run[1].y - z.run[0].y };
  const d1 = { x: locked.run[1].x - locked.run[0].x, y: locked.run[1].y - locked.run[0].y };
  ok(Math.abs(d0.x * d1.y - d0.y * d1.x) < 1e-6, 'so the direction is unchanged — a pure lengthen');
}

console.log('\n-- a run may not collapse --');
{
  const z = zonesFromFurniture([wardrobe], room).zones[0];
  // Dragged onto the other end. Radially clamped, which means the same thing
  // wherever the end has been taken — the old rule compared two positions along
  // one wall and only meant anything while both ends were still on it.
  const onTop = setRunEnd(z, 1, { ...z.run[0] });
  ok(onTop.runLength >= RUN_EDIT.minLenFt - 1e-9,
    `dragged onto the other end it stops short: ${onTop.runLength.toFixed(3)}`);
  ok(onTop.runLength <= RUN_EDIT.minLenFt + 1e-9, '...and no further than it has to');

  // Through it, from out in the open, is the same rule.
  const through = setRunEnd(setRunEnd(z, 1, { x: 60, y: 60 }), 1, { x: 0.05, y: 20.05 });
  ok(through.runLength >= RUN_EDIT.minLenFt - 1e-9, 'from any direction');

  // Both ends still move independently.
  const both = setRunEnd(setRunEnd(z, 0, { x: 0, y: 110 }, { polygon: room }),
                                       1, { x: 0, y: 10 }, { polygon: room });
  ok(near(both.runLength, 100), `both ends editable: ${both.runLength}`);
}

console.log('\n-- the whole run moves, which is what a wrong wall needs --');
{
  const z = zonesFromFurniture([wardrobe], room).zones[0];
  const L0 = z.runLength;
  const [a0, b0] = z.run;

  // Straight across the room. Length and direction are rigid.
  const far = moveRun(z, { x: 140, y: 60 }, { x: 40, y: 60 });
  ok(near(far.runLength, L0), `length is unchanged: ${far.runLength.toFixed(2)}`);
  ok(near(far.run[0].x - a0.x, 100) && near(far.run[1].x - b0.x, 100),
    'and both ends moved by the same delta');
  ok(near(far.run[0].y - a0.y, 0), 'by the POINTER delta, so the run does not jump under the cursor');
  ok(far.edited === true, 'marked as edited');

  // THE WALL IT NOW BELONGS TO IS RE-DERIVED. Left on the wall the model
  // originally chose, a run dragged across the room keeps claiming a wall it is
  // nowhere near — the stale state that made the constrained drag feel broken.
  const across = moveRun(z, { x: 200, y: 60 }, { x: 0, y: 60 }, { polygon: room });
  ok(across.wall && near(across.wall.a.x, 200) && near(across.wall.b.x, 200),
    'dragged to the far wall, that is the wall it reports');
  ok(across.snap === 'wall', 'and it lands ON it rather than beside it');

  // A run at an angle to every wall is not sheared onto one.
  const angled = { ...z, run: [{ x: 40, y: 40 }, { x: 80, y: 70 }], wall: z.wall };
  const slid = moveRun(angled, { x: 41, y: 41 }, { x: 40, y: 40 }, { polygon: room });
  ok(slid.snap === null, 'a run parallel to nothing snaps to nothing');
  ok(near(slid.runLength, Math.hypot(40, 30)), '...and keeps its length exactly');

  // Shift turns wall snapping off, for placing a cove deliberately off the wall.
  const held = moveRun(z, { x: 0.2, y: 60 }, { x: 0, y: 60 }, { polygon: room, constrain: true });
  ok(held.snap === null, 'Shift moves it without the wall grabbing it back');
}

console.log('\n-- what the canvas draws the guide from --');
{
  const z = zonesFromFurniture([wardrobe], room).zones[0];
  const anchor = z.run[0];
  const dir = { x: z.run[1].x - anchor.x, y: z.run[1].y - anchor.y };
  const hits = runSnaps({ x: anchor.x + RUN_EDIT.snapFt * 0.3, y: 40 }, anchor, dir, room);
  ok(hits.length > 0, `candidates come back nearest-first: ${hits.map((h) => h.kind).join(', ')}`);
  ok(hits[0].kind === 'axis', 'and a collinear drag prefers the axis over a wall at the same distance');
  ok(hits.every((h) => h.dist <= RUN_EDIT.snapFt), 'nothing outside the tolerance is offered');
  ok(runSnaps({ x: 100, y: 60 }, anchor, dir, room).length === 0,
    'and a point in open floor is offered nothing at all');
}

console.log('\n-- a rejected fitting is not editable geometry --');
{
  const marooned = zonesFromFurniture([{ type:'bed', rect:{x0:80,y0:45,x1:130,y1:80}, confidence:.5 }], room);
  ok(marooned.zones.every(z => z.rejected && !z.point), 'a refused sconce has no point to grab');
  ok(slideSconceTo(marooned.zones[0], {x:10,y:0}) === marooned.zones[0], 'and sliding it is a no-op');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail?1:0);
