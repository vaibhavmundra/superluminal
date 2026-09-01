// The writer/reader contract planState.js's header is about: every field the
// editor keeps must survive a round trip, artDismissed included — which is what
// both saving and Ctrl+Z depend on.
import { serialiseEditor, applyEditor } from '../../src/lib/planState.js';

const state = {
  unitId: 'ft', scaleMode: 'door', refId: 'd1', customFt: null,
  measure: null, doorPick: 'd1', pxPerFt: 95, ceilingFt: 10,
  outlines: [{ id: 'o1' }], litIds: ['o1'], focusId: 'o1', selectedOutlineId: null,
  roomState: { status: 'done' }, projectType: 'residential', roomTypes: {}, pdfPage: null,
  detections: [{ id: 'b1' }], dismissed: [], bedVerdicts: {}, provider: 'judge',
  zones: [{ id: 'z1', x0: 0, y0: 0, x1: 1, y1: 1 }], doors: [{ id: 'd1' }],
  ceilingObjs: [], chunkPicks: {}, designPicks: {}, ceilingKinds: {},
  accentResults: {}, accentDismissed: ['a1'], manualAccents: [],
  surfaceResults: {}, surfaceDismissed: ['sf1'], manualSurfaces: [{ id: 'ms1' }],
  artDismissed: ['wall-7', 'wall-9'],
  wallResults: {}, runTrims: {}, renderRefs: {},
  layers: { spots: true }, zoom: 2, view: 'design',
};

const doc = serialiseEditor(state);
const json = JSON.parse(JSON.stringify(doc));       // through the jsonb column
console.log('artDismissed survives serialisation:', JSON.stringify(json.artDismissed));

const got = {};
const setter = (k) => (v) => { got[k] = typeof v === 'function' ? v(undefined) : v; };
const set = new Proxy({}, { get: (_, k) => setter(k) });
applyEditor(json, set);
console.log('applyEditor restores it       :', JSON.stringify(got.setArtDismissed));

// ...and a plan saved before the field existed reads as "nothing dismissed"
const old = { ...json };
delete old.artDismissed;
const got2 = {};
const set2 = new Proxy({}, { get: (_, k) => (v) => { got2[k] = v; } });
applyEditor(old, set2);
console.log('an older saved plan           :', JSON.stringify(got2.setArtDismissed));

const ok = JSON.stringify(got.setArtDismissed) === JSON.stringify(state.artDismissed)
  && JSON.stringify(got2.setArtDismissed) === '[]';
console.log(ok ? '\nround trip ok' : '\nROUND TRIP BROKEN');
process.exit(ok ? 0 : 1);
