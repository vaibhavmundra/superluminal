import assert from 'node:assert/strict';
import { buildWallLayerSet, buildPlanAreaSqft, buildLitOutlines, enclosedZones,
  buildChunkOpt, buildDrawnZones, buildFocus, buildOpenRoom } from '../src/features/scene/roomGeometry.js';
import { buildBedsPerRoom, buildDetectedZones } from '../src/features/scene/bedZones.js';
import { buildReverseCoves, buildShelfStrips, buildWardrobeZones,
  buildReverseCoveZones, buildZoneList } from '../src/features/scene/wallGeometry.js';
import { projectOutlinesPx, projectObstaclesPx, projectCeilingObstaclesPx,
  projectWardrobesPx } from '../src/lib/planProjection.js';
import { layoutRooms } from '../src/lib/layout.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';
import { manualReverseCove } from '../src/lib/reverseCove.js';

const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};
const repeat = (fn, input) => {
  freeze(input);
  const before = JSON.stringify(input), first = fn(input), second = fn(input);
  // Layout carries coordinate conversion functions, tested separately below.
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(input), before);
  return first;
};
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y },
  { x: x + w, y: y + h }, { x, y: y + h }];
const source = { kind: 'dxf', w: 1500, h: 900,
  fromDu: (p) => ({ x: p.x * 2 + 400, y: p.y * 2 + 300 }),
  drawing: { layers: [{ name: 'walls', count: 12 }, { name: 'dimensions', count: 4 }] } };
// Nonzero source transform AND nonzero room origin, so drawing units, plan
// pixels, plan feet and room feet cannot accidentally be interchanged.
const outlines = [
  { id: 'a', rectify: false, pointsDu: rect(0, 0, 120, 100), enclosingDu: [rect(90, 70, 20, 20)] },
  { id: 'b', rectify: false, pointsDu: rect(200, 0, 120, 100) },
];
const outlinesPx = repeat(({ source, outlines }) => projectOutlinesPx(source, outlines), { source, outlines });
assert.deepEqual(outlinesPx[0].pointsPx[0], { x: 400, y: 300 });
const litOutlines = repeat(buildLitOutlines, { outlinesPx, litIds: ['a', 'b'] });
assert.equal(litOutlines[0], outlinesPx[0]);
assert.equal(repeat(buildPlanAreaSqft, { outlinesPx, pxPerFt: 20 }), 240);
assert.equal(buildPlanAreaSqft({ outlinesPx, pxPerFt: null }), null);
assert.equal(buildPlanAreaSqft({ outlinesPx: [], pxPerFt: 20 }), null);
assert.deepEqual([...repeat(buildWallLayerSet, { source, isVector: true })], ['walls']);
assert.equal(buildWallLayerSet({ source, isVector: false }), null);
assert.equal(buildWallLayerSet({ source: null, isVector: true }), null);

const bedRect = { x0: 430, y0: 330, x1: 520, y1: 450 };
const accentResults = { a: { bedsFromAccentPass: [{ rect: bedRect }, {}], furniture: [
  { id: 'wa', type: 'wardrobe', rect: { x0: 400, y0: 460, x1: 500, y1: 500 } },
] }, gone: { furniture: [{ id: 'orphan', type: 'wardrobe', rect: bedRect }] } };
const bedsPerRoom = repeat(buildBedsPerRoom, { outlines, accentResults });
assert.equal(bedsPerRoom[0].roomId, 'a');
assert.equal(bedsPerRoom[0].id, 'bed-room-a-0');
const detectionInput = { source, pxPerFt: 20, bedsPerRoom, dismissed: [], detections: [
  { id: 'sheet-a', roomId: 'a', cls: 'bed', rect: bedRect },
  { id: 'judged-a', roomId: 'a', cls: 'bed', rect: bedRect, refound: true },
  { id: 'sheet-b', roomId: 'b', cls: 'bed', rect: { ...bedRect, x0: 830, x1: 920 } },
  { id: 'impossible', cls: 'bed', rect: { x0: 10, y0: 10, x1: 900, y1: 800 } },
] };
const detected = repeat(buildDetectedZones, detectionInput);
assert.deepEqual(detected.zones.map((z) => z.id), ['sheet-b', 'judged-a']);
assert.equal(detected.zones[1].judged, true);
assert.equal(detected.zones[1].closeUp, true);
assert.deepEqual(detected.diagnostics.map((d) => d.level), ['log', 'warn']);
// Existing detection projections use pixel containment for ownership; do not
// silently add roomId to this schema as part of an extraction.
assert.equal(detected.zones[1].roomId, undefined);
assert.equal(repeat(buildDetectedZones, { ...detectionInput, dismissed: ['judged-a'] }).zones.length, 1);
assert.deepEqual(buildDetectedZones({ ...detectionInput, source: null }).zones, []);
assert.equal(buildDetectedZones({ ...detectionInput, pxPerFt: 2 }).zones.length, 0);
assert.deepEqual(repeat(buildDetectedZones, { ...detectionInput, detections: [] }).zones, []);

const wardrobesPx = repeat(({ litOutlines, accentResults }) => projectWardrobesPx(litOutlines, accentResults), { litOutlines, accentResults });
assert.deepEqual(wardrobesPx.map((w) => [w.id, w.roomId]), [['wd-wa', 'a']]);
const wardrobeZones = repeat(buildWardrobeZones, { wardrobesPx });
const element = (id, type) => ({ id, type, cells: Array.from({ length: 8 }, (_, i) => ({ x: i + 2, y: 10 })),
  start: { x: 2, y: 10 }, end: { x: 9, y: 10 } });
const manual = manualReverseCove({ a: { x: 800, y: 500 }, b: { x: 1040, y: 500 },
  t0: 20, t1: 140, roomId: 'b', inward: { x: 0, y: -1 }, pxPerFt: 20, id: 'manual' });
const walls = { source, pxPerFt: 20, litOutlines, wallResults: {
  a: { elements: [element('panel', 'panelling'), element('shelf', 'shelves')] },
  gone: { elements: [element('orphan', 'panelling')] },
}, useBoundingRect: false, doors: [], runTrims: {}, runsOff: [],
manualCoves: [manual, { ...manual, id: 'orphan-manual', roomId: 'gone' }] };
const reverseCoves = repeat(buildReverseCoves, walls);
assert.deepEqual(reverseCoves.map((c) => [c.id, c.roomId]), [['rcove-panel-0', 'a'], ['manual', 'b']]);
assert.equal(reverseCoves[0].rect.y0, 300);
assert.ok(Math.abs(reverseCoves[0].rect.y1 - 300 - 20 * 8 / 12) < 1e-8);
assert.deepEqual(repeat(buildReverseCoves, { ...walls, runsOff: ['rcove-panel-0'] }).map((c) => c.id), ['manual']);
const shelfStrips = repeat(buildShelfStrips, walls);
assert.deepEqual(shelfStrips.map((s) => [s.id, s.roomId]), [['shelf-shelf-0', 'a']]);
assert.equal(shelfStrips[0].lengthFt, 8);
assert.deepEqual(repeat(buildShelfStrips, { ...walls, runsOff: ['shelf-shelf-0'] }), []);
const reverseCoveZones = repeat(buildReverseCoveZones, { reverseCoves });
const zones = [{ id: 'hand', roomId: 'b', x0: 960, y0: 430, x1: 990, y1: 460 }];
const zoneList = repeat(buildZoneList, { zones, detectedZones: detected.zones, wardrobeZones, reverseCoveZones });
assert.deepEqual(zoneList.map((z) => z.id), ['hand', 'sheet-b', 'judged-a', 'wd-wa', 'rcove-panel-0', 'manual']);
assert.ok(!zoneList.some((z) => z.id.startsWith('shelf-')));

const obstaclesPx = repeat(({ ceilingObjs, pxPerFt }) => projectObstaclesPx(ceilingObjs, pxPerFt), {
  ceilingObjs: [{ id: 'fan', kind: 'fan', x: 27, y: 20, diaFt: 4 },
    { id: 'ac', kind: 'split_ac', x: 23, y: 15, wFt: 3, hFt: 1 }], pxPerFt: 20,
});
assert.equal(obstaclesPx[0].x, 540);
const ceilingObstaclesPx = repeat(({ obstaclesPx }) => projectCeilingObstaclesPx(obstaclesPx), { obstaclesPx });
assert.deepEqual(ceilingObstaclesPx.map((o) => o.id), ['fan']);
const chunkOpt = repeat(buildChunkOpt, PLAN_OPTIONS);
const layoutInput = { source, pxPerFt: 20, litOutlines, useBoundingRect: false, ceilingObstaclesPx,
  zoneList, zones, reverseCoveZones, chunkOpt, chunkPicks: {}, opt: PLAN_OPTIONS, enclosedZones,
  roomTypes: {}, projectId: 'residential', designPicks: {}, ceilingKinds: {}, ceilingShapes: [],
  lightMoves: {}, manualTracks: [], isAdmin: false };
// Rectification's known point mutation is pinned in test-layout.mjs. These
// frozen, unrectified inputs exercise the scene's pure coordinate/ownership path.
const rooms = repeat(layoutRooms, layoutInput);
assert.equal(rooms.length, 2);
assert.deepEqual(rooms[0].geo.toFt({ x: 540, y: 400 }), { x: 7, y: 5 });
assert.deepEqual(rooms[1].geo.toPx({ x: 7, y: 5 }), { x: 940, y: 400 });
assert.equal(rooms[0].geo.fixturesFt.length, 1);
assert.equal(rooms[1].geo.fixturesFt.length, 0);
assert.ok(rooms[0].plan.zonesPx.some((z) => z.id === 'judged-a'));
assert.ok(!rooms[1].plan.zonesPx.some((z) => z.id === 'judged-a'));
assert.ok(rooms[0].plan.zonesPx.some((z) => z.id === 'encl-a-0'));
assert.ok(!rooms[1].plan.zonesPx.some((z) => z.id === 'encl-a-0'));
assert.deepEqual(repeat(buildDrawnZones, { zones, rooms, enclosedZones }).map((z) => z.id), ['hand', 'encl-a-0']);
assert.equal(buildFocus({ rooms, focusId: null }), rooms[0]);
assert.equal(buildOpenRoom({ rooms, focusId: null }), null);
assert.equal(buildFocus({ rooms, focusId: 'gone' }), rooms[0]);
assert.equal(buildOpenRoom({ rooms, focusId: 'gone' }), null);
assert.equal(buildOpenRoom({ rooms, focusId: 'b' }), rooms[1]);
assert.equal(buildFocus({ rooms: [], focusId: 'b' }), null);
console.log('scene: coordinate spaces, ownership, exclusions, diagnostics and frozen-input repeat calls passed');
