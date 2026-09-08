// Exercise the actual private effect bodies with controlled service responses.
// useEffect is captured at the module boundary; React scheduling itself is not
// reimplemented. No server/model calls or browser rasterization are needed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { mergeRoomProposals } from '../src/features/recognition/roomProposals.js';
import { rejectionSummary } from '../src/features/recognition/bedResults.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const source = { kind: 'raster', w: 1200, h: 900, toDu: (p) => p, fromDu: (p) => p };
const img = { el: {} }, wallLayerSet = new Set(['walls']);
const shot = { w: 600, h: 450, base64: 'pixels', mime: 'image/png' };

async function fixture(kind) {
  let effect, deps;
  const states = [], calls = [], actions = [];
  let outlines = [];
  const response = deferred();
  let snapshot = async () => shot;
  const exports = {
    useEffect: (fn, ds) => { effect = fn; deps = ds; },
    proposeOutlines: async (provider, opts) => {
      calls.push({ provider, ...opts }); opts.onMeta({ rejected: [] });
      return response.promise;
    },
    makeOutline: () => ({ id: 'proposed-id' }), mergeRoomProposals,
    OTHER_STROKE_PX: 0.75, WALL_WEIGHT_IN: 2,
    downscaleForDetection: (el) => { assert.equal(el, img.el); return shot; },
    detectDoors: (opts) => { calls.push(opts); return response.promise; },
    doorsFromPayload: (payload, opts) => {
      assert.deepEqual(opts.image, { w: 1200, h: 900 }); return payload;
    },
    detectBeds: (opts) => { calls.push(opts); return response.promise; },
    snapshotForDetection: (...args) => snapshot(...args),
    detectFurniture: () => assert.fail('the superseded whole-sheet pass ran'),
    detectionsToZones: () => assert.fail('the superseded decoder ran'),
    ZONE_CLASSES: ['bed'], wireProvider: (p) => p,
    BED_SOURCES: [], splitByProvider: () => {}, label: () => {}, rejectionSummary,
  };
  const text = await readFile(new URL(`../src/features/recognition/use${kind}Recognition.js`, import.meta.url), 'utf8');
  const mod = new SourceTextModule(text);
  await mod.link(() => new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }));
  await mod.evaluate();
  const docActions = {
    setRoomState: (s) => states.push(s),
    proposeOutlines: (update) => {
      const result = update(outlines); outlines = result.outlines;
      states.push(result.roomState); actions.push(['propose', result]);
    },
    replaceDoors: (items) => actions.push(['doors', items]),
    clearDoors: () => actions.push(['clearDoors']),
    clearBedVerdicts: () => actions.push(['clearBedVerdicts']),
    replaceDetections: (items) => actions.push(['detections', items]),
  };
  const inputs = { source, img, wallLayerSet, isVector: false, projectId: 'residential',
    restoring: { current: false }, readOnly: false,
    roomNonce: 0, doorNonce: 0, detectNonce: 0, provider: 'judge', pxPerFt: null,
    docActions, setDoorState: (s) => states.push(s), setDetectState: (s) => states.push(s),
    setBedSets: (v) => actions.push(['bedSets', v]),
  };
  return {
    response, states, calls, actions,
    start(patch = {}) { const args = { ...inputs, ...patch }; mod.namespace.default(args); return effect(); },
    get deps() { return deps; },
    setOutlines(value) { outlines = value; },
    setSnapshot(fn) { snapshot = fn; },
  };
}

for (const kind of ['Room', 'Door', 'Furniture']) {
  for (const gate of [{ source: null }, { readOnly: true }, { restoring: { current: true } }]) {
    const f = await fixture(kind);
    assert.equal(f.start(gate), undefined, `${kind} gate`);
    assert.equal(f.calls.length, 0); assert.equal(f.states.length, 0);
  }
  const f = await fixture(kind);
  const nonce = { Room: 'roomNonce', Door: 'doorNonce', Furniture: 'detectNonce' }[kind];
  const cleanup = f.start({ restoring: { current: true }, [nonce]: 1 });
  await tick();
  assert.equal(f.calls.length, 1, `${kind} explicit rerun on a restored plan`);
  cleanup(); assert.equal(f.calls[0].signal.aborted, true);
  const before = f.states.length;
  f.response.resolve(kind === 'Room' ? { ok: true, outlines: [] }
    : kind === 'Door' ? { doors: [], rejected: [], medianPx: null }
      : { kept: [], rejected: [], payload: {} });
  await tick();
  assert.equal(f.states.length, before, `${kind} ignores late success`);
  assert.equal(f.actions.length, 0, `${kind} does not commit stale answers`);
}
for (const gate of [{ isVector: true }, { projectId: null }, { img: null }]) {
  const f = await fixture('Door'); assert.equal(f.start(gate), undefined);
  assert.equal(f.calls.length, 0);
}
{
  const f = await fixture('Room'); const cleanup = f.start();
  assert.deepEqual(f.deps, [source, 0], 'rooms do not rerun for scale, tracing, or project type');
  assert.equal(f.calls[0].pxPerFt, null, 'raster/PDF rooms run before scale');
  const hand = { id: 'drawn-while-waiting', name: 'Kitchen', pointsDu: polygon };
  f.setOutlines([hand]);
  f.response.resolve({ ok: true, outlines: [{ pointsPx: polygon }] }); await tick();
  assert.equal(f.actions[0][1].outlines[0], hand, 'commit merges against latest user edits');
  assert.equal(f.states.at(-1).proposed, 0); cleanup();
}
{
  const f = await fixture('Room'); const vector = { ...source, kind: 'vector', pxPerFt: 30 };
  const cleanup = f.start({ source: vector, isVector: true });
  assert.equal(f.calls[0].pxPerFt, 30);
  assert.equal(f.calls[0].snapshotOpts.wallLayers, wallLayerSet);
  assert.equal(f.calls[0].snapshotOpts.wallStroke, 5);
  f.response.resolve({ ok: false, reason: 'unavailable' }); await tick();
  assert.equal(f.states.at(-1).error, 'unavailable'); cleanup();
}
{
  const f = await fixture('Door'); const cleanup = f.start();
  assert.deepEqual(f.deps, [source, img, false, 'residential', 0]);
  assert.equal(f.calls[0].base64, shot.base64);
  const found = [{ id: 'door-1' }];
  f.response.resolve({ doors: found, rejected: [], medianPx: 20 }); await tick();
  assert.deepEqual(f.actions, [['doors', found]]);
  assert.equal(f.states.at(-1).status, 'done'); cleanup();
}
{
  const f = await fixture('Furniture'); const cleanup = f.start(); await tick();
  assert.deepEqual(f.deps, [source, img, 0, 'judge'], 'scale changes do not launch a second bed request');
  assert.deepEqual(f.calls[0].image, { w: 1200, h: 900 });
  assert.equal(f.calls[0].w, 600); assert.equal(f.calls[0].polygon, null);
  assert.equal(f.calls[0].pxPerFt, null);
  const kept = [{ rect: { x0: 10.4, y0: 20.8, x1: 90, y1: 160 }, cls: 'bed' }];
  f.response.resolve({ kept, rejected: [], payload: { meta: { model: 'bed-filter' } } }); await tick();
  assert.deepEqual(f.actions, [['bedSets', null], ['clearBedVerdicts'],
    ['detections', [{ ...kept[0], id: 'bed-sheet-0-10-21' }]]]);
  assert.equal(f.states.at(-1).provider, 'bed-filter'); cleanup();
}
{
  const f = await fixture('Furniture'), pendingShot = deferred();
  f.setSnapshot(() => pendingShot.promise);
  const cleanup = f.start(); cleanup(); pendingShot.resolve(shot); await tick();
  assert.equal(f.calls.length, 0, 'cancelled snapshot never spends a model call');
}
for (const kind of ['Door', 'Furniture']) {
  for (const aborted of [false, true]) {
    const f = await fixture(kind); const cleanup = f.start(); await tick();
    const error = new Error('service failed');
    if (aborted) error.name = 'AbortError';
    f.response.reject(error); await tick();
    assert.equal(f.states.at(-1).status, aborted ? 'running' : 'error');
    assert.deepEqual(f.actions, !aborted && kind === 'Door' ? [['clearDoors']] : []);
    cleanup();
  }
}
console.log('recognition lifecycle — gates, payloads, ordering, latest merges, errors and cancellation passed');

// Check the facade's ownership contract without invoking its private effects.
// These hook stubs retain state slots only; effect scheduling is tested above.
{
  const slots = [], effects = [], controllers = [], actions = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { return react.useState({ current: initial })[0]; },
    useCallback: (fn) => fn, useMemo: (fn) => fn(),
    useEffect: (fn) => effects.push(fn),
  };
  const commands = { refindBeds() {}, absorbBedRows() {}, lookAgainAtBeds() {}, computeBedFit() {} };
  const module = new SourceTextModule(await readFile(new URL('../src/features/recognition/usePlanRecognition.js', import.meta.url), 'utf8'));
  await module.link((specifier) => {
    const entries = specifier === 'react' ? react : { default: (args) => {
      controllers.push({ specifier, args });
      return { ...commands, bedLook: 'previous answer' };
    } };
    return new SyntheticModule(Object.keys(entries), function () {
      for (const [key, value] of Object.entries(entries)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  const docActions = Object.fromEntries(['clearDetections', 'setRoomState', 'clearDoors', 'setDoorPick', 'setProvider']
    .map((key) => [key, (...args) => actions.push([key, ...args])]));
  const doc = { provider: 'judge', projectType: 'residential', roomState: { status: 'done' },
    detections: [], roomTypes: {} };
  const render = (restoredPlan) => {
    cursor = 0; controllers.length = 0;
    return module.namespace.default({ doc, docActions, source, img, isVector: false,
      pxPerFt: null, wallLayerSet, restoredPlan, readOnly: true, useBoundingRect: false });
  };
  let result = render(true);
  assert.deepEqual(Object.keys(result), ['rooms', 'doors', 'furniture', 'status', 'commands', 'reset']);
  assert.equal(result.rooms.state, doc.roomState);
  assert.equal(result.furniture.provider, doc.provider);
  assert.equal(result.commands.setProvider, docActions.setProvider);
  assert.equal(result.commands.refindBeds, commands.refindBeds);
  assert.equal(result.commands.computeBedFit, commands.computeBedFit);
  assert.deepEqual(controllers.slice(0, 3).map((c) => c.specifier),
    ['./useRoomRecognition.js', './useDoorRecognition.js', './useFurnitureRecognition.js']);
  assert.ok(controllers.slice(0, 3).every((c) => c.args.readOnly && c.args.restoring.current));
  const savedStorage = globalThis.localStorage;
  const writes = [];
  globalThis.localStorage = {
    getItem: (key) => { assert.equal(key, 'lightPlanner.v1'); return '{"provider":"openai"}'; },
    setItem: (...args) => writes.push(args),
  };
  try { effects.forEach((fn) => fn()); }
  finally {
    if (savedStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedStorage;
  }
  assert.deepEqual(actions.pop(), ['setProvider', 'openai']);
  assert.deepEqual(writes, [['lightPlanner.v1', '{"provider":"judge"}']]);
  result.commands.rerunRooms(); result.commands.rerunDoors(); result.commands.rerunFurniture();
  result.reset.restoreDoorStatus({ status: 'done', count: 3 });
  result.reset.restoreFurnitureStatus({ status: 'running' });
  result = render(false);
  assert.equal(result.doors.state.count, 3);
  assert.equal(result.status.running, true);
  assert.ok(controllers.slice(0, 3).every((c) => c.args.restoring.current), 'restoration gate is lifetime-scoped');
  assert.equal(controllers[0].args.roomNonce, 1);
  assert.equal(controllers[1].args.doorNonce, 1);
  assert.equal(controllers[2].args.detectNonce, 1);
  result.reset.furniture(); result.reset.rooms(); result.reset.doors();
  assert.deepEqual(actions, [['clearDetections'], ['setRoomState', { status: 'idle' }],
    ['clearDoors'], ['setDoorPick', null]]);
  result = render(false);
  assert.equal(result.doors.state.status, 'idle');
  assert.equal(result.furniture.state.status, 'idle');
  assert.equal(controllers[2].args.detectNonce, 1, 'new-plan reset does not change the existing nonce semantics');
  assert.equal(result.furniture.bedLook, 'previous answer');
}
console.log('recognition facade — provider persistence, grouped commands, restoration and reset ownership passed');
