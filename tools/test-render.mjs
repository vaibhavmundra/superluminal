// ---------------------------------------------------------------------------
// test-render.mjs — the components actually RENDER.
//
// WHY THIS FILE EXISTS, stated plainly because it is a gap that cost a session:
// a const initialised from `lw` was written ABOVE the line that declares `lw` in
// PlanCanvas. That is a temporal-dead-zone error which throws on the very first
// render — and it got all the way to the browser, because `vite build` compiles
// it happily (the reference is legal, the ORDER is not, and that is a runtime
// fact) and because not one of the thirty-six suites in this folder had ever
// rendered a component. Everything here was green.
//
// So this is the cheapest possible net under that whole class of bug: import the
// component the way the app does, hand it plausible props, and render it to a
// string. No DOM, no jsdom, no new dependency — `react-dom/server` is already
// here, and vite's own SSR loader does the JSX. It catches anything that throws
// while a component is being evaluated or rendered: a dead-zone reference, a
// typo in a hook, a null dereference on a prop the caller really does pass.
//
// IT IS A SMOKE TEST AND IT SHOULD STAY ONE. The assertions below check that the
// marks a room's design produces are PRESENT, not where they are or what they
// look like — geometry is asserted in test-track.mjs and friends, against the
// pure functions, which is where assertions about geometry belong. A render test
// that pinned coordinates would fail on every legitimate change to the drawing
// and would be deleted within a month.
//
//   node tools/test-render.mjs
// ---------------------------------------------------------------------------

import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { designChunking, planCeilingDesign } from '../src/lib/ceilingDesign.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);

// A dev server in middleware mode, purely as a JSX loader. `cacheDir` is moved
// out of the repo because the optimiser wants to clear it on start and has no
// business touching a checkout during a test.
const vite = await createServer({
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  cacheDir: path.join(os.tmpdir(), 'superluminal-render-test'),
  optimizeDeps: { noDiscovery: true, include: [] },
});
// react and react-dom/server are imported NORMALLY, above: they are CommonJS,
// and putting them through the SSR transform gets an ambiguous-syntax error.
// Vite externalises node_modules for SSR, so the component resolves the same
// copy and there is only ever one React.
const load = async (p) => (await vite.ssrLoadModule(p)).default;
const PlanCanvas = await load('/src/components/PlanCanvas.jsx');
const BOQView = await load('/src/components/BOQView.jsx');

const S = 40;                                    // px per foot
const opt = PLAN_OPTIONS;
const toPx = (p) => ({ x: p.x * S, y: p.y * S });
const rectPx = (r) => ({ ...r, x0: r.x0 * S, y0: r.y0 * S, x1: r.x1 * S, y1: r.y1 * S });
const corners = (R) => [{ x: R.x0, y: R.y0 }, { x: R.x1, y: R.y0 },
                        { x: R.x1, y: R.y1 }, { x: R.x0, y: R.y1 }].map(toPx);
const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

/**
 * ONE ROOM, BUILT THE WAY App.jsx BUILDS ONE. Deliberately the real pipeline and
 * not a hand-written fixture: a fixture drifts away from the shape the component
 * is actually handed, and then the test passes while the app throws.
 */
function room(polygonFt, pick = null) {
  const d = designChunking(polygonFt, [], opt, []);
  const key = d.chunks[0].key;
  const built = planCeilingDesign({
    polygonFt, designChunks: d.chunks, picks: pick ? { [key]: pick } : {},
    opt, criteria: 20,
  });
  const res = built.plan;
  const coves = built.coves.filter((c) => c.ok);
  return {
    id: 'r1', name: 'Space 1',
    plan: {
      ...res,
      polygonPx: polygonFt.map(toPx),
      chunksPx: res.chunks.map((ch) => ({
        ...rectPx(ch),
        xLines: ch.xLines.map((x) => x * S), yLines: ch.yLines.map((y) => y * S),
      })),
      cellsPx: res.cells.map(rectPx),
      lightsPx: res.lights.map((l) => ({ ...l, ...toPx(l),
        fixture: l.track ? 'track-ambient' : l.kind,
        design: res.chunks[l.kind === 'small' ? l.cell?.chunk : l.chunk]?.design ?? null,
        gridPx: l.gridPos ? toPx(l.gridPos) : null,
        centrePx: l.cell ? toPx({ x: l.cell.cx, y: l.cell.cy }) : null,
        coverPx: [] })),
      covesPx: coves.map((c) => ({ key: c.key, line: corners(c.line), offset: c.offset })),
      tracksPx: built.tracks.map((t) => ({
        key: t.key, id: t.id, closed: t.closed, corners: t.corners, pieces: t.pieces,
        lengthFt: t.lengthFt,
        runs: t.runs.map((rn) => ({ a: toPx(rn.a), b: toPx(rn.b), side: rn.side, axis: rn.axis })),
      })),
    },
    design: built.parts.map((p) => ({
      key: p.key, pick: p.pick,
      options: p.options.map((x) => ({ id: x.id, label: x.label })),
      rect: rectPx(p.chunk), wFt: p.chunk.w, hFt: p.chunk.h,
    })),
    coves,
    // The cove's tape, shaped as an accent zone exactly as App.jsx shapes it.
    accents: coves.map((c) => ({
      id: `cove-r1-${c.key}`, type: 'strip', kind: 'cove', roomId: 'r1',
      source: 'cove', fixture: 'strip', label: 'Cove LED strip',
      loop: corners(c.strip), runLength: c.perimeterFt * S,
      // `rect` because App.jsx sets one on every accent it passes. The fidelity
      // is the point of building the fixture from the real pipeline: a fixture
      // that is missing a field the app always sends tests a shape nobody ever
      // renders. (It did find a real fragility on the way in — see the note in
      // the accents block of PlanCanvas.)
      rect: rectPx(c.strip),
    })),
  };
}

const LAYERS = { lights: true, labels: true, cells: true, region: true,
                 zones: true, spots: true, accents: true, grid: true };

const draw = (r, extra = {}) => renderToStaticMarkup(React.createElement(PlanCanvas, {
  width: 1200, height: 900, pxPerFt: S, zoom: 1, layers: LAYERS, toPx,
  plans: [r], accents: r.accents ?? [], focusId: 'r1', selectedId: 'r1',
  onPickChunk: () => {}, onCycleOption: () => {}, ...extra,
}));

// --- 1. it renders at all ------------------------------------------------
say('1. THE CANVAS RENDERS');
{
  // THE ASSERTION THIS FILE EXISTS FOR. A dead-zone reference, a bad hook or a
  // null dereference all land here as a thrown error rather than as a blank
  // screen in somebody's browser.
  let html = null, err = null;
  try { html = draw(room(box(24, 18))); } catch (e) { err = e; }
  ok(!err, `a plain room renders without throwing${err ? `: ${err.message}` : ''}`);
  ok(html && html.startsWith('<svg'), 'and produces an svg');
  ok(html && html.includes('class="plan"'),
    'carrying the class the pointer-events rules key off');
  ok(html && html.length > 2000, `with the drawing in it: ${html?.length} chars`);

  let bare = null; err = null;
  try {
    bare = renderToStaticMarkup(React.createElement(PlanCanvas, {
      width: 800, height: 600, pxPerFt: 30, zoom: 1, plans: [], layers: {}, toPx,
    }));
  } catch (e) { err = e; }
  ok(!err && bare, 'and so does an empty canvas with no rooms and no layers on');
}

// --- 2. a track chunk puts its marks on the drawing ---------------------
say('2. A TRACK CHUNK DRAWS ITS PROFILE AND ITS HEADS');
{
  const r = room(box(24, 18), 'track-4');
  ok(r.plan.tracksPx.length === 1, 'the room carries a track');
  const html = draw(r);
  const heads = r.plan.lightsPx.filter((l) => l.track).length;
  ok(heads > 0, `with ${heads} heads absorbed onto it`);
  // The profile: a closed path. The heads: rects, where an ordinary downlight
  // would be a circle.
  ok((html.match(/<path/g) || []).length >= 2,
    'the profile is drawn as a path — body and hit band');
  ok((html.match(/<rect/g) || []).length >= heads,
    'and every head as a rect, not the circle a recessed downlight gets');
  ok(html.includes('pointer-events:stroke'),
    'the profile’s hit band is stroke-only, so it does not swallow its own chunk');
}

// --- 3. a cove chunk, and the click target that was broken --------------
say('3. A COVE CHUNK KEEPS A WAY BACK TO ITS OPTIONS');
{
  const r = room(box(24, 18), 'cove');
  ok(r.coves.length === 1, 'the room carries a cove');
  const html = draw(r);
  // THE BUG THIS PINS. The cove line is a polygon with `.hit` — interior live,
  // deliberately, because a cove that carries its chunk leaves no downlight to
  // click. The tape drawn over it must NOT be live over the same area.
  ok(/<polygon[^>]*class="hit"/.test(html),
    'the cove setting-out line is live over what it encloses — the way back');
  const strips = html.match(/<path[^>]*class="[^"]*hit[^"]*"[^>]*>/g) || [];
  ok(strips.length > 0, 'the tape has a hit target of its own');
  ok(strips.every((t) => /pointer-events:stroke/.test(t)),
    '...and every one of them is stroke-only, so none covers the cove line');
  ok(/class="lp-flow"/.test(html) && !/class="lp-flow hit"/.test(html),
    'the visible dotted tape itself is inert — the band beside it takes the clicks');
}

// --- 4. the option pill ------------------------------------------------
say('4. THE OPTION PILL RENDERS WHEN A CHUNK IS PICKED');
{
  const r = room(box(24, 18), 'cove');
  const html = draw(r, { optionPick: { roomId: 'r1', key: r.design[0].key } });
  ok(html.includes('COVE'), 'the pill names what the chunk is now');
  ok(html.includes('‹') && html.includes('›'),
    'with both arrows, because there is more than one option');
  const plain = draw(room(box(24, 18)));
  ok(!plain.includes('›'), 'and nothing is drawn when no chunk is picked');
}

// --- 5. the schedule renders too --------------------------------------
say('5. THE SCHEDULE RENDERS');
{
  const { buildBOQ } = await import('../src/lib/boq.js');
  const r = room(box(24, 18), 'track-4');
  const boq = buildBOQ({
    rooms: [{ id: 'r1', outline: { name: 'Space 1' },
              plan: { ok: true, stats: { areaSqft: 432 }, lights: r.plan.lightsPx },
              tracks: r.plan.tracksPx.map((t, i) => ({ ...t, ...r.coves[i] })) }],
    pxPerFt: S, plan: 'test',
  });
  let html = null, err = null;
  try { html = renderToStaticMarkup(React.createElement(BOQView, { boq })); }
  catch (e) { err = e; }
  ok(!err, `BOQView renders without throwing${err ? `: ${err.message}` : ''}`);
  ok(html && html.includes('Track'), 'and the track lines are on it');
}

await vite.close();
console.log('\n' + (fail ? `${fail} FAILED` : 'all good'));
process.exit(fail ? 1 : 0);
