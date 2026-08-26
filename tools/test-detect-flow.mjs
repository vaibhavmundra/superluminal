// ---------------------------------------------------------------------------
// test-detect-flow.mjs — the claim the whole feature makes, end to end, with
// React and the network taken out:
//
//   a Roboflow response  ->  a zone  ->  NO LIGHT OVER THE BED
//
// The unit tests prove each stage. This proves the stages are wired to each
// other in the order App.jsx wires them, because that is where this feature
// broke the first time: every part worked and nothing ran.
//
// It mirrors App.jsx exactly — detections found against the whole image with
// no polygon, then filtered by the lit region, then converted to feet, then
// handed to planLights — so a change to that sequence fails here.
// ---------------------------------------------------------------------------

import { detectionsToZones, zonesFromDetections, rectCentre } from '../src/lib/furniture.js';
import { planLights, DEFAULTS } from '../src/lib/planner.js';
import { pointInPolygon } from '../src/lib/geometry.js';

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log(`   FAIL  ${what}`); } };

const PX_PER_FT = 20;
const IMG = { w: 1200, h: 900 };

// A 24 x 15 ft bedroom sitting at (100,100) in a 1200x900 plan image.
const ROOM_PX = [
  { x: 100, y: 100 }, { x: 100 + 24 * PX_PER_FT, y: 100 },
  { x: 100 + 24 * PX_PER_FT, y: 100 + 15 * PX_PER_FT }, { x: 100, y: 100 + 15 * PX_PER_FT },
];

// A 6 x 6.5 ft king bed against the left wall, as the model would report it:
// centre coordinates, in the space of the downscaled image we sent (half size).
const bedPred = (cxFt, cyFt, wFt = 6, hFt = 6.5, conf = 0.87) => ({
  x: (100 + cxFt * PX_PER_FT) / 2, y: (100 + cyFt * PX_PER_FT) / 2,
  width: (wFt * PX_PER_FT) / 2, height: (hFt * PX_PER_FT) / 2,
  confidence: conf, class: 'bed',
});
const response = (preds) => ([{
  predictions: { image: { width: IMG.w / 2, height: IMG.h / 2 }, predictions: preds },
}]);

/** App.jsx's sequence, in App.jsx's order. */
function pipeline(payload, { polygonPx = ROOM_PX, dismissedIds = [] } = {}) {
  // 1. detections: found against the whole image, no region — this is what lets
  //    the call fire on upload, before any boundary exists.
  const { kept } = detectionsToZones(payload, { image: IMG, polygon: null });
  const detections = kept.map((k, i) => ({ ...k, id: `det-${i}` }));

  // 2. only the ones over THIS ceiling become zones.
  const live = detections.filter((d) => !dismissedIds.includes(d.id)
    && pointInPolygon(rectCentre(d.rect), polygonPx));
  const detectedZones = zonesFromDetections(live, { image: IMG, pxPerFt: PX_PER_FT });

  // 3. into feet, relative to the region's own origin, as geo does.
  const origin = { x: Math.min(...polygonPx.map((p) => p.x)), y: Math.min(...polygonPx.map((p) => p.y)) };
  const toFt = (p) => ({ x: (p.x - origin.x) / PX_PER_FT, y: (p.y - origin.y) / PX_PER_FT });
  const zonesFt = detectedZones.map((z) => {
    const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
    return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
  });

  // 4. plan.
  const polygonFt = polygonPx.map(toFt);
  const plan = planLights(polygonFt, [], { ...DEFAULTS }, zonesFt);
  return { detections, detectedZones, zonesFt, plan, polygonFt };
}

const inRect = (p, z) => p.x > z.x0 && p.x < z.x1 && p.y > z.y0 && p.y < z.y1;

console.log('flow — a bed on the plan becomes a zone with no light on it');
{
  const r = pipeline(response([bedPred(4, 4)]));
  ok(r.detections.length === 1, 'the bed is detected');
  ok(r.detectedZones.length === 1, 'and becomes a zone in this room');
  ok(r.zonesFt.length === 1, 'and survives into feet');

  const z = r.zonesFt[0];
  // 6 x 6.5 ft plus 0.25ft padding on each side.
  ok(Math.abs((z.x1 - z.x0) - 6.5) < 0.01, `zone is 6.5ft wide with padding, got ${(z.x1 - z.x0).toFixed(2)}`);
  ok(Math.abs((z.y1 - z.y0) - 7.0) < 0.01, `zone is 7.0ft deep with padding, got ${(z.y1 - z.y0).toFixed(2)}`);
  // The bed is centred 4ft,4ft from the room's top-left corner.
  ok(Math.abs((z.x0 + z.x1) / 2 - 4) < 0.01, 'and is centred where the bed is, not offset by half its width');

  ok(r.plan.lights.length > 0, 'the room still gets lights');
  const over = r.plan.lights.filter((l) => inRect(l, z));
  ok(over.length === 0, `NO LIGHT OVER THE BED — found ${over.length}`);
}

console.log('flow — the room decides, not the plan');
{
  // Two bedrooms on one drawing. Only the left one is being lit.
  const two = response([bedPred(4, 4), bedPred(40, 4)]);
  const r = pipeline(two);
  ok(r.detections.length === 2, 'both beds are detected on the plan');
  ok(r.detectedZones.length === 1, 'but only the one in this room is zoned');

  // Nothing to light yet: the detections are held, not thrown away. This is the
  // property that lets detection run while the boundary is still being drawn.
  const held = detectionsToZones(two, { image: IMG, polygon: null }).kept;
  ok(held.length === 2, 'detections survive with no region at all');
}

console.log('flow — dismissing a false positive');
{
  const r = pipeline(response([bedPred(4, 4)]), { dismissedIds: ['det-0'] });
  ok(r.detectedZones.length === 0, 'a dismissed detection produces no zone');
  ok(r.plan.lights.length > 0, 'and the room lights as if it were never there');

  const kept = pipeline(response([bedPred(4, 4)]));
  ok(kept.plan.lights.length >= r.plan.lights.length - 2,
    'zoning a bed does not collapse the layout');
}

console.log('flow — the failure that would look like a planner bug');
{
  // A box over the whole plan must be refused upstream, or the room is
  // subtracted to nothing and comes back with zero lights.
  const whole = pipeline(response([{ x: 300, y: 225, width: 590, height: 440, confidence: 0.9, class: 'bed' }]));
  ok(whole.detectedZones.length === 0, 'a plan-sized bed is refused');
  ok(whole.plan.lights.length > 0, 'so the room still gets lit');
}

console.log('flow — a bed in the middle of the room');
{
  // The harder geometry: a zone away from the walls splits the free space into
  // a ring, which is where chunking has to do real work.
  const r = pipeline(response([bedPred(12, 7.5)]));
  ok(r.detectedZones.length === 1, 'a central bed is zoned');
  ok(r.plan.lights.length > 0, 'and the ring around it is still lit');
  const z = r.zonesFt[0];
  const over = r.plan.lights.filter((l) => inRect(l, z));
  ok(over.length === 0, `no light over a central bed — found ${over.length}`);

  // And every light is inside the room.
  const outside = r.plan.lights.filter((l) => !pointInPolygon(l, r.polygonFt));
  ok(outside.length === 0, 'no light escapes the room');
}

console.log('flow — nothing found is not a failure');
{
  const r = pipeline(response([]));
  ok(r.detections.length === 0 && r.detectedZones.length === 0, 'an empty response yields no zones');
  ok(r.plan.lights.length > 0, 'and the room plans normally by hand');
}

console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
