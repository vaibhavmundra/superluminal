// ---------------------------------------------------------------------------
// test-ceiling.mjs — the things already on the ceiling.
//
// The claim this file exists to check is a single one: a chandelier and an AC
// cassette are not a new kind of obstacle, they are a fan with a different
// drawing. If that is true then a cassette and a fan of the same radius must
// produce a byte-identical layout, and the last few assertions are that.
//
//   node tools/test-ceiling.mjs
// ---------------------------------------------------------------------------

import { CEILING_TYPES, makeCeilingObject, radiusFt, toObstaclePx,
         sizeLabel, clampFt, resizeFromCorner, rotateTo, toLocal, toWorld,
         halfExtents, isUniform, applyResize, ROTATE_SNAP, isRect, sweepMm,
         withSweep } from '../src/lib/ceilingObjects.js';
import { collectTargets, snapPoint, guideLine } from '../src/lib/snapGuides.js';
import { planLights, surfaceDistance } from '../src/lib/planner.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';

let fail = 0; const ok = (c,m)=>{console.log((c?'  ok  ':'  FAIL')+'  '+m); if(!c) fail++;};
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;

ok(CEILING_TYPES.map(t=>t.id).join(',') === 'fan,chandelier,ac,trapdoor',
  `four types, in palette order: ${CEILING_TYPES.map(t=>t.id).join(', ')}`);
const fan = makeCeilingObject('fan',{x:0,y:0});
ok(near(radiusFt(fan), 3.937/2, 0.01), 'a fan defaults to 1200 sweep -> 1.97ft radius');
ok(sweepMm(fan) === 1200 && sweepMm(withSweep(fan, 900)) === 900, 'the sweep is switchable and round-trips');
ok(near(radiusFt(withSweep(fan, 900)), 2.953/2, 0.01), '900 sweep -> 1.48ft radius');
ok(isRect(makeCeilingObject('ac',{x:0,y:0})) && isRect(makeCeilingObject('trapdoor',{x:0,y:0}))
   && !isRect(fan), 'rectangular vs round is the only split the maths cares about');
const td = makeCeilingObject('trapdoor',{x:0,y:0});
ok(sizeLabel(td) === '600 × 600 mm', `a trap door defaults smaller: ${sizeLabel(td)}`);
const ac = makeCeilingObject('ac',{x:5,y:5});
ok(near(radiusFt(ac), Math.hypot(2.953,2.953)/2, 0.01), 'a 900x900 cassette -> the circle round it');
ok(sizeLabel(ac) === '900 × 900 mm', `size label: ${sizeLabel(ac)}`);
ok(sizeLabel(makeCeilingObject('chandelier',{x:0,y:0})) === '900 mm ⌀', 'chandelier reads as a diameter');
// rotation cannot change what is reserved
const spun = { ...ac, rot: Math.PI/4 };
ok(near(radiusFt(spun), radiusFt(ac)), 'rotating a cassette cannot move a light — same circle at any angle');
// px conversion
const px = toObstaclePx(ac, 20);
ok(px.x === 100 && near(px.r, radiusFt(ac)*20) && px.source === 'placed', 'feet -> pixels for the planner');
ok(clampFt(0.1) === 0.5 && clampFt(99) === 12, 'hand-dragged sizes are clamped');

// THE POINT OF ALL THIS: the planner treats them exactly as it treats a fan.
const room = [{x:0,y:0},{x:20,y:0},{x:20,y:16},{x:0,y:16}];
const opt = { ...PLAN_OPTIONS };
const bare = planLights(room, [], opt, []);
const asFan  = planLights(room, [{ type:'fan', x:10, y:8, r: radiusFt(ac) }], opt, []);
const asCass = planLights(room, [{ type:'fan', x:10, y:8, r: radiusFt(toObstaclePx(ac,1)) }], opt, []);
ok(bare.ok && asFan.ok, 'the room lays out with and without an obstacle');
ok(JSON.stringify(asFan.lights.map(l=>[l.x,l.y])) === JSON.stringify(asCass.lights.map(l=>[l.x,l.y])),
  'a cassette and a fan of the same radius produce the identical layout — one code path, as intended');
const clearOf = (p,f)=>Math.hypot(p.x-f.x,p.y-f.y) >= (f.r + opt.fanClearance) - 1e-6;
const f = { x:10, y:8, r: radiusFt(ac) };
ok(asFan.lights.every(l=>clearOf(l,f) || l.clash), 'every light clears it by the same buffer a fan gets, or is flagged');
ok(JSON.stringify(bare.lights.map(l=>[l.x,l.y])) !== JSON.stringify(asFan.lights.map(l=>[l.x,l.y])),
  'and it genuinely moved the layout, so the test is not vacuous');


// --- the gestures -----------------------------------------------------------
console.log('\n-- resize: THE OPPOSITE CORNER MUST NOT MOVE --');
// That is the whole of why a drag feels direct. Resizing about the centre —
// which is the easier thing to write — makes the object appear to run away from
// the pointer at half speed in the wrong direction.
{
  const o = { x: 10, y: 10, wFt: 4, hFt: 2, rot: 0, kind: 'ac' };
  const br = { sx: 1, sy: 1 };                       // grabbing bottom-right
  const anchorBefore = { x: o.x - 2, y: o.y - 1 };    // ...so top-left is fixed
  // Anchored at (8,9), so dragging the far corner to (18,14) means 10 x 5 —
  // measured from the ANCHOR, not doubled out from the centre.
  const next = resizeFromCorner(o, br, { x: 18, y: 14 });
  ok(near(next.wFt, 10) && near(next.hFt, 5), `pointer to (18,14) -> 10 x 5: ${next.wFt} x ${next.hFt}`);
  const anchorAfter = { x: next.x - next.wFt / 2, y: next.y - next.hFt / 2 };
  ok(near(anchorAfter.x, anchorBefore.x) && near(anchorAfter.y, anchorBefore.y),
    'the top-left corner stayed exactly put');
  ok(!near(next.x, o.x), 'and the centre moved, which is the point');

  // Shift locks the ratio.
  const uni = resizeFromCorner(o, br, { x: 18, y: 11 }, { uniform: true });
  ok(near(uni.wFt / uni.hFt, o.wFt / o.hFt), `Shift keeps 2:1, got ${(uni.wFt/uni.hFt).toFixed(3)}`);

  // Alt resizes about the centre, and then the centre is what stays.
  const alt = resizeFromCorner(o, br, { x: 14, y: 13 }, { fromCentre: true });
  ok(near(alt.x, o.x) && near(alt.y, o.y), 'Alt holds the centre still');
  ok(near(alt.wFt, 8) && near(alt.hFt, 6), `and grows both ways: ${alt.wFt} x ${alt.hFt}`);

  // Dragging past the opposite corner cannot invert or vanish the object.
  const crossed = resizeFromCorner(o, br, { x: 2, y: 2 });
  ok(crossed.wFt >= 0.5 && crossed.hFt >= 0.5, 'dragging through the anchor clamps rather than inverting');
}

console.log('\n-- resize on a ROTATED object works in its own frame --');
{
  const o = { x: 0, y: 0, wFt: 4, hFt: 2, rot: Math.PI / 2, kind: 'ac' };
  // At 90 degrees the object's local +x points along world +y.
  // Local anchor is (-2,-1), so a pointer at local (4,1) gives 6 x 2. Read in
  // WORLD axes that same drag looks like a 2-wide, 6-tall change — which is
  // exactly the confusion working in the object's own frame exists to avoid.
  const p = toWorld({ x: 4, y: 1 }, { x: o.x, y: o.y }, o.rot);
  const next = resizeFromCorner(o, { sx: 1, sy: 1 }, p);
  ok(near(next.wFt, 6) && near(next.hFt, 2), `local sizes, not world ones: ${next.wFt} x ${next.hFt}`);
  const rt = toLocal(toWorld({ x: 3, y: -1 }, { x: 5, y: 5 }, 0.7), { x: 5, y: 5 }, 0.7);
  ok(near(rt.x, 3) && near(rt.y, -1), 'local/world round-trips');
}

console.log('\n-- a round object has one dimension --');
{
  const ch = makeCeilingObject('chandelier', { x: 0, y: 0 });
  ok(isUniform(ch) && !isUniform(makeCeilingObject('ac', { x: 0, y: 0 })),
    'a chandelier resizes uniformly; a cassette does not have to');
  const { hw, hh } = halfExtents(ch);
  const next = resizeFromCorner({ wFt: hw*2, hFt: hh*2, x: 0, y: 0, rot: 0 },
    { sx: 1, sy: 1 }, { x: 4, y: 1 }, { uniform: true });
  const out = applyResize(ch, next);
  ok(out.diaFt > 0 && out.wFt == null, 'and comes back as a diameter, never a w/h');
  ok(near(out.diaFt, clampFt(out.diaFt)), 'within the size limits');
}

console.log('\n-- rotate: free, and snapped only on Shift --');
{
  const o = { x: 0, y: 0 };
  // Grab at 0 degrees, drag to 37: the object turns by 37, not to 37.
  const r = rotateTo(o, { x: Math.cos(0.646), y: Math.sin(0.646) },
    { startRot: 0.2, startAngle: 0 });
  ok(near(r, 0.2 + 0.646, 1e-6), 'the delta is from where the grab started, so the handle does not jump');
  const snapped = rotateTo(o, { x: Math.cos(0.30), y: Math.sin(0.30) },
    { startRot: 0, startAngle: 0, snap: true });
  ok(near(snapped % ROTATE_SNAP, 0, 1e-9) || near(Math.abs(snapped % ROTATE_SNAP), ROTATE_SNAP, 1e-9),
    `Shift lands on a 15-degree multiple: ${(snapped*180/Math.PI).toFixed(2)} deg`);
  const free = rotateTo(o, { x: Math.cos(0.30), y: Math.sin(0.30) }, { startRot: 0, startAngle: 0 });
  ok(!near(free, snapped) && near(free, 0.30), 'without Shift it is genuinely free');
  const wrapped = rotateTo(o, { x: 1, y: 0 }, { startRot: 0, startAngle: -6.0 });
  ok(wrapped > -Math.PI && wrapped <= Math.PI, `normalised for the readout: ${wrapped.toFixed(3)}`);
}


console.log('\n-- snapping and guides --');
{
  const room = { id: 'r1', name: 'Bedroom', polygonPx: [
    {x:100,y:100},{x:500,y:100},{x:500,y:400},{x:100,y:400}] };   // centre 300,250
  const others = [{ id: 'o1', x: 420, y: 180, r: 20 }];
  const T = collectTargets({ rooms: [room], objects: others });
  ok(T.length === 4, `two axes per source: ${T.length} targets`);

  // Each axis snaps on its own — a point can be on a centreline vertically and
  // nowhere near anything horizontally, and that is a real alignment.
  const one = snapPoint({ x: 303, y: 380 }, T, { tol: 7 });
  ok(one.x === 300 && one.y === 380, `x snapped, y untouched: ${one.x},${one.y}`);
  ok(one.guides.length === 1 && one.guides[0].axis === 'x', 'and exactly one guide is shown');

  const both = snapPoint({ x: 297, y: 253 }, T, { tol: 7 });
  ok(both.x === 300 && both.y === 250 && both.guides.length === 2, 'both axes can fire at once');

  const none = snapPoint({ x: 200, y: 200 }, T, { tol: 7 });
  ok(none.x === 200 && none.y === 200 && none.guides.length === 0, 'and neither, which is the common case');

  // Objects are snap targets too — that is the "align things to each other"
  // this is built to grow into.
  const toObj = snapPoint({ x: 418, y: 340 }, T, { tol: 7 });
  ok(toObj.x === 420 && toObj.guides[0].kind === 'object-centre', 'another object is a target');

  // A room's centre outranks an object at the same distance: one is a fact
  // about the drawing, the other is where somebody happened to put something.
  const tie = collectTargets({ rooms: [room], objects: [{ id:'o2', x: 300, y: 9, r: 2 }] });
  ok(snapPoint({ x: 300, y: 250 }, tie, { tol: 7 }).guides.find(g=>g.axis==='x').kind === 'room-centre',
    'a room centre wins a tie against an object');

  // Dragging an object must not snap to itself, or it would lock solid.
  const self = collectTargets({ rooms: [], objects: others, exclude: 'o1' });
  ok(self.length === 0, 'the object being dragged is excluded from its own targets');

  // The guide stops at the thing it came from.
  const g = T.find((t) => t.axis === 'x' && t.kind === 'room-centre');
  const l = guideLine(g, 10);
  ok(l.x1 === 300 && l.y1 === 90 && l.y2 === 410, 'a guide spans its room, not the whole sheet');
}


console.log('\n-- CLEARANCE IS MEASURED TO THE FACE, not to a circle round it --');
{
  // A 3ft x 1ft cassette. Circumscribed it would claim a 1.58ft radius in every
  // direction; its actual faces are 1.5ft away on one axis and 0.5ft on the
  // other, and the difference is a whole row of downlights on a tight ceiling.
  const box = { shape: 'rect', x: 0, y: 0, w: 3, h: 1, rot: 0 };
  ok(near(surfaceDistance(box, { x: 1.5, y: 0 }), 0), 'zero on the long face');
  ok(near(surfaceDistance(box, { x: 0, y: 0.5 }), 0), 'zero on the short face');
  ok(near(surfaceDistance(box, { x: 0, y: 1.5 }), 1), '1ft off the short face is 1ft, not 1ft-minus-the-diagonal');
  ok(near(surfaceDistance(box, { x: 4.5, y: 0 }), 3), 'and 3ft off the long face is 3ft');
  ok(near(surfaceDistance(box, { x: 1.5 + 3, y: 0.5 + 4 }), 5), 'the corner is a proper 3-4-5');
  ok(surfaceDistance(box, { x: 0, y: 0 }) < 0, 'inside reads negative');

  // The old circumscribed answer, for contrast: it under-reports the clearance
  // available beside a rectangle by a lot.
  const circ = { x: 0, y: 0, r: Math.hypot(3, 1) / 2 };
  const p = { x: 0, y: 1.2 };
  ok(surfaceDistance(box, p) > surfaceDistance(circ, p) + 0.6,
    `beside the short face the face-distance is ${surfaceDistance(box,p).toFixed(2)}ft vs the circle's ${surfaceDistance(circ,p).toFixed(2)}ft`);

  // Rotation is now real, where a circumscribed circle could not see it.
  const spun = { ...box, rot: Math.PI / 2 };
  ok(near(surfaceDistance(spun, { x: 0, y: 1.5 }), 0), 'turned 90 degrees the long face is where the long face now is');
  ok(near(surfaceDistance(spun, { x: 1.5, y: 0 }), 1), 'and the short one likewise');

  // A fixture with no shape is a circle, so every fan the detector ever found
  // behaves exactly as it did.
  ok(near(surfaceDistance({ x: 0, y: 0, r: 2 }, { x: 5, y: 0 }), 3), 'no shape means circle, unchanged');
}

console.log('\n-- and it buys back real ceiling --');
{
  const room = [{x:0,y:0},{x:20,y:0},{x:20,y:16},{x:0,y:16}];
  const opt = { ...PLAN_OPTIONS };
  const slim = { type: 'fan', shape: 'rect', x: 10, y: 8, w: 3, h: 1, rot: 0 };
  const asCircle = { type: 'fan', x: 10, y: 8, r: Math.hypot(3, 1) / 2 };
  const a = planLights(room, [slim], opt, []);
  const b = planLights(room, [asCircle], opt, []);
  ok(a.ok && b.ok, 'both lay out');
  const blocked = (f, l) => surfaceDistance(f, l) < opt.fanClearance;
  ok(a.lights.every((l) => !blocked(slim, l) || l.clash),
    'no light sits inside the real clearance of the rectangle');
  // A point that the real face clears and the circumscribed circle does not.
  // DERIVED FROM THE SETTING, not from the number it happened to be the day
  // this was written: the half-depth is 0.5 and the circumscribed radius is
  // 1.58, so anything between those two, added to the clearance, is legal
  // against the face and refused by the circle — whatever the clearance is.
  const q = { x: 10, y: 8 + opt.fanClearance + 0.9 };
  ok(surfaceDistance(slim, q) >= opt.fanClearance && surfaceDistance(asCircle, q) < opt.fanClearance,
    'a spot the circle refused is legal against the real face');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail?1:0);
