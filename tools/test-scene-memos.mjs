// Exercise the real adapters with dependency-aware useMemo/useCallback at their
// React import boundary, following test-recognition-lifecycle's VM approach.
// This checks invalidation contracts, not React's scheduling implementation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { PLAN_OPTIONS } from '../src/lib/settings.js';
import { enclosedZones } from '../src/features/scene/roomGeometry.js';

async function adapter(file, name = 'default') {
  const slots = []; let cursor = 0;
  const memoize = (fn, deps) => {
    const i = cursor++, old = slots[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
      slots[i] = { deps, value: fn() };
    }
    return slots[i].value;
  };
  const react = { useMemo: memoize, useCallback: (fn, deps) => memoize(() => fn, deps) };
  const url = new URL(`../src/features/scene/${file}.js`, import.meta.url);
  const mod = new SourceTextModule(await readFile(url, 'utf8'));
  await mod.link(async (specifier) => {
    const exports = specifier === 'react' ? react : await import(new URL(specifier, url));
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    });
  });
  await mod.evaluate();
  return (input) => { cursor = 0; return mod.namespace[name](input); };
}
const polygon = [{ x: 300, y: 200 }, { x: 540, y: 200 }, { x: 540, y: 400 }, { x: 300, y: 400 }];
const source = { kind: 'raster', w: 1200, h: 900, fromDu: (p) => p };
const outlines = [{ id: 'a', rectify: false, pointsDu: polygon }];
const litIds = ['a'];
const outlineHook = await adapter('useSceneSource', 'useSceneOutlines');
const outlineInput = { source, outlines, litIds };
const a = outlineHook(outlineInput).rooms;
const b = outlineHook({ ...outlineInput }).rooms;
assert.equal(a.outlinesPx, b.outlinesPx);
assert.equal(a.litOutlines, b.litOutlines);
assert.equal(a.enclosedZones, b.enclosedZones);
const unlit = outlineHook({ ...outlineInput, litIds: [] }).rooms;
assert.equal(a.outlinesPx, unlit.outlinesPx);
assert.equal(unlit.litOutlines.length, 0);
const architectureHook = await adapter('useSceneSource', 'useSceneArchitecture');
const vector = { ...source, drawing: { layers: [{ name: 'walls', count: 1 }] } };
const wallInput = { isVector: true, source: vector };
const walls = architectureHook(wallInput).architecture.wallLayerSet;
assert.equal(architectureHook({ ...wallInput }).architecture.wallLayerSet, walls);
assert.equal(architectureHook({ ...wallInput, isVector: false }).architecture.wallLayerSet, null);

const input = { source, pxPerFt: 20, outlines, ...a, enclosedZones, focusId: null,
  ceilingObjs: [], accentResults: {}, detections: [], dismissed: [], wallResults: {},
  useBoundingRect: false, doors: [], runTrims: {}, manualCoves: [], runsOff: [], zones: [],
  opt: PLAN_OPTIONS, chunkPicks: {}, roomTypes: {}, projectId: 'residential', designPicks: {},
  ceilingKinds: {}, ceilingShapes: [], lightMoves: {}, manualTracks: [], isAdmin: false };
const sceneHook = await adapter('usePlanScene');
const scene = sceneHook(input), same = sceneHook({ ...input });
for (const group of Object.keys(scene)) {
  for (const key of Object.keys(scene[group])) assert.equal(same[group][key], scene[group][key], `${group}.${key}`);
}
const focus = sceneHook({ ...input, focusId: 'a' });
assert.equal(focus.rooms.items, scene.rooms.items, 'focus does not re-layout');
assert.equal(focus.rooms.openRoom, scene.rooms.items[0]);
const option = sceneHook({ ...input, opt: { ...input.opt, unrelated: true } });
assert.equal(option.lightingGeometry.chunkOpt, scene.lightingGeometry.chunkOpt, 'unrelated option preserves chunk identity');
assert.equal(option.lightingGeometry.zoneList, scene.lightingGeometry.zoneList);
assert.notEqual(option.rooms.items, scene.rooms.items, 'the existing opt dependency still re-layouts');
const changed = sceneHook({ ...input, opt: { ...input.opt, fanClearance: 3 } });
assert.notEqual(changed.lightingGeometry.chunkOpt, scene.lightingGeometry.chunkOpt);
const scale = sceneHook({ ...input, pxPerFt: 10 });
assert.notEqual(scale.architecture.obstaclesPx, scene.architecture.obstaclesPx);
assert.equal(scale.rooms.planAreaSqft, scene.rooms.planAreaSqft * 4);

const planHook = await adapter('useScenePlanProjections', 'useScenePlanProjections');
const planInput = { rooms: scene.rooms.items, surfaceResults: {}, surfaceDismissed: [], manualSurfaces: [],
  wallResults: {}, pxPerFt: 20, artDismissed: [], opt: PLAN_OPTIONS, accentResults: {},
  accentDismissed: [], manualAccents: [], reverseCoves: [], shelfStrips: [], ceilingShapes: [] };
const projected = planHook(planInput).projections;
const dismissed = planHook({ ...planInput, artDismissed: ['art'] }).projections;
assert.equal(projected.surfacesPx, dismissed.surfacesPx);
assert.notEqual(projected.artPiecesPx, dismissed.artPiecesPx);
assert.notEqual(projected.taskSpotsPx, dismissed.taskSpotsPx);
assert.equal(projected.accentZonesPx, dismissed.accentZonesPx);

const electricalHook = await adapter('useSceneElectricalProjections', 'useSceneElectricalProjections');
const none = () => [], board = { id: 'board', roomId: 'a', role: 'door', point: { x: 300, y: 300 }, wall: { index: 3 } };
const electricalInput = { rooms: scene.rooms.items, boardsFor: () => [board], bayBoardsFor: none,
  placedBoardsFor: none, bayResults: {}, obstaclesPx: [], accentZonesPx: [], taskSpotsPx: [],
  outdoorFeeds: {}, pxPerFt: 20, baysOf: none, flowBoards: {}, flowBends: {}, layers: { electrical: true }, doorEdit: false };
const electrical = electricalHook(electricalInput).projections;
const hidden = electricalHook({ ...electricalInput, layers: { electrical: false } }).projections;
assert.equal(hidden.allBoardsPx, electrical.allBoardsPx);
assert.equal(hidden.flowsPx, electrical.flowsPx);
assert.equal(hidden.boardNames, electrical.boardNames);
assert.equal(hidden.boardNames.get('board'), 'SB1');
assert.notEqual(hidden.switchboardsPx, electrical.switchboardsPx);

const file = 'useSceneFixtureProjections';
const manualHook = await adapter(file, 'useSceneManualProjections');
const manualInput = { manualCobs: [{ id: 'cob', roomId: 'a', xFt: 20, yFt: 12, beam: 36 }], pxPerFt: 20, ceilingMmFor: () => 2700 };
const lamps = manualHook(manualInput).projections.manualCobsPx;
assert.equal(lamps[0].x, 400);
assert.equal(manualHook({ ...manualInput }).projections.manualCobsPx, lamps);
assert.equal(manualHook({ ...manualInput, pxPerFt: 10 }).projections.manualCobsPx[0].x, 200);
const trackHook = await adapter(file, 'useSceneTrackProjections');
const trackInput = { ceilingShapes: [], rooms: scene.rooms.items, pxPerFt: 20, trackFixtures: [] };
const tracks = trackHook(trackInput).projections;
const modules = trackHook({ ...trackInput, trackFixtures: [] }).projections;
assert.equal(tracks.magTracksPx, modules.magTracksPx);
assert.equal(tracks.magTrackById, modules.magTrackById);
assert.notEqual(tracks.trackModulesPx, modules.trackModulesPx);
const arrayHook = await adapter(file, 'useSceneArrayProjections');
const arrayInput = { cobArrays: [], arrayOutline: () => null, pxPerFt: 20,
  ceilingMmFor: manualInput.ceilingMmFor, cobDraftArray: null, selArrayId: null };
const arrays = arrayHook(arrayInput).projections;
assert.equal(arrayHook({ ...arrayInput, selArrayId: 'other' }).projections.arrayCobsPx, arrays.arrayCobsPx);
const shapeHook = await adapter(file, 'useSceneShapeProjections');
const pen = { pts: [], at: null, isEmpty: true };
const shapeInput = { ceilingShapes: [], rooms: scene.rooms.items, pxPerFt: 20,
  shapeDraft: null, addTool: null, trackPen: pen, trackEditId: null, manualTracks: [],
  shapeMenuOn: false, shapeTool: null, covePen: pen };
const shapes = shapeHook(shapeInput).projections;
const pointer = shapeHook({ ...shapeInput, trackPen: { ...pen, at: { x: 10, y: 20 } } }).projections;
assert.equal(shapes.coveShapesPx, pointer.coveShapesPx, 'pointer moves do not rebuild committed shapes');
console.log('scene memos: source, layout, focus, chunk options and all projection stages passed');
