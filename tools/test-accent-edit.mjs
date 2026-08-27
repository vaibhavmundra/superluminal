import { zonesFromFurniture, slideSconceTo, setRunEnd, alongWallAt } from '../src/lib/accentPlace.js';

// --- editing what the model proposed ---------------------------------------
//
// Both gestures are one-dimensional, and both are easiest to get wrong in the
// same way: a wall's own frame runs whichever way the polygon happened to wind,
// so "further along the wall" can be a SMALLER y. These check the invariants —
// stayed on the wall, never inverted, other end untouched — rather than world
// coordinates, which is the only way to write them without re-deriving the
// winding by hand every time.
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

console.log('\n-- a strip end slides along the run, and cannot cross the other --');
{
  const z = zonesFromFurniture([wardrobe], room).zones[0];
  const L0 = z.runLength;
  const t0 = alongWallAt(z.wall, z.run[0]).t, t1 = alongWallAt(z.wall, z.run[1]).t;
  ok(L0 > 0 && Math.abs(Math.abs(t1 - t0) - L0) < 1e-6, `starts at its derived length: ${L0.toFixed(2)}`);

  // Pull end 1 out past the wardrobe. This wall runs from (0,120) to (0,0), so
  // "further along it" is a SMALLER y — obvious in the wall's own frame and
  // invisible in world coordinates, which is exactly why the maths works there.
  const longer = setRunEnd(z, 1, { x: 60, y: 5 });
  ok(longer.runLength > L0, `end dragged out lengthens the run: ${longer.runLength.toFixed(2)}`);
  ok(near(longer.run[1].x, z.run[1].x), 'and the end stays on the wall line, not where the pointer was');
  ok(near(longer.run[0].x, z.run[0].x) && near(longer.run[0].y, z.run[0].y), 'the other end did not move');
  ok(longer.edited === true, 'marked as edited');

  // Drag end 1 back through end 0: it pins short instead of inverting.
  const crossed = setRunEnd(z, 1, { x: 0, y: -50 });
  ok(crossed.runLength >= 0.34, `dragging through the other end pins short: ${crossed.runLength.toFixed(2)}`);
  const ct0 = alongWallAt(crossed.wall, crossed.run[0]).t;
  const ct1 = alongWallAt(crossed.wall, crossed.run[1]).t;
  ok(ct1 > ct0, 'and the run never flips direction');

  // Both ends independently.
  const both = setRunEnd(setRunEnd(z, 0, { x: 0, y: 110 }), 1, { x: 0, y: 10 });
  ok(near(both.runLength, 100), `both ends editable: ${both.runLength}`);
  ok(near(both.run[0].x, z.run[0].x) && near(both.run[1].x, z.run[0].x),
    'and the run stays at its own offset off the wall, not walked onto it');
}

console.log('\n-- a rejected fitting is not editable geometry --');
{
  const marooned = zonesFromFurniture([{ type:'bed', rect:{x0:80,y0:45,x1:130,y1:80}, confidence:.5 }], room);
  ok(marooned.zones.every(z => z.rejected && !z.point), 'a refused sconce has no point to grab');
  ok(slideSconceTo(marooned.zones[0], {x:10,y:0}) === marooned.zones[0], 'and sliding it is a no-op');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail?1:0);
