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
import { projectSuggestedPointsPx } from '../src/lib/fixtureProjection.js';
import { collectTargets, snapPoint, guideLine } from '../src/lib/snapGuides.js';
import { pointKind, resolvePoint, FREE } from '../src/lib/point.js';

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
      /* THE CHUNKER'S OWN ANSWER, WHICH IS NOT THE SAME LIST AS `lightsPx`
         WHENEVER THE PLACEMENT IS SWITCHED OFF. layout.js sets these on every
         room it lays out, so a fixture without them is a shape the app never
         hands this component — the same argument the `rect` on the cove accent
         below already makes. The suggestion layer reads `gridLightsPx`, and
         with the field absent it would draw nothing and the test would pass by
         rendering an empty group. */
      gridCellsPx: res.cells.map(rectPx),
      gridChunksPx: res.chunks.map((ch) => ({
        ...rectPx(ch),
        xLines: ch.xLines.map((x) => x * S), yLines: ch.yLines.map((y) => y * S),
      })),
      gridLightsPx: res.lights.map((l) => ({ ...l, ...toPx(l),
        fixture: l.track ? 'track-ambient' : l.kind })),
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

/* `autoLights` IS IN HERE NOW AND WAS NOT BEFORE, which quietly meant every
   assertion about the placed ambient fittings was made against a canvas that
   had never drawn one: PlanCanvas reads `layers.lights && layers.autoLights`,
   and an absent key is falsy. App always hands over an object merged onto
   LAYER_DEFAULTS (see `layers` in useViewPrefs), so this is the shape the
   component is actually given. */
const LAYERS = { lights: true, autoLights: true, labels: true, cells: true,
                 region: true, zones: true, spots: true, accents: true, grid: true };

/** A directional spot as `projectTaskSpotsPx` leaves one, aimed to the right. */
const SPOT = { id: 'sp1', roomId: 'r1', fixture: 'spot', x: 10 * S, y: 8 * S,
               angle: 0, target: { x: 13 * S, y: 8 * S } };

/** The suggested grid, resolved the way App resolves it for the canvas AND for
 *  the snap engine — one list, so this test cannot pass on a shape the app
 *  never builds. */
const suggestFor = (r, on = true) =>
  projectSuggestedPointsPx([r], [SPOT], S, { on, ambient: true, spots: true });

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

// --- 5. the suggested grid --------------------------------------------
say('5. THE SUGGESTED GRID PROPOSES WHAT AUTO PLACE LIGHTS WOULD PUT DOWN');
{
  const r = room(box(24, 18));
  const pts = suggestFor(r);
  const ambient = pts.filter((p) => p.of === 'ambient');
  const spots = pts.filter((p) => p.of === 'spot');
  ok(ambient.length === r.plan.gridLightsPx.length && ambient.length > 0,
    `one proposal per fitting the engine placed: ${ambient.length}`);
  ok(spots.length === 1, 'and one per directional spot');
  /* THE POINT PRIMITIVE'S OWN SHAPE, which is what lets the snap engine and
     anything else that speaks `point` take these without an adapter. */
  ok(pts.every((p) => pointKind(p) === FREE && p.on === null && p.u === null),
    'every entry is a FREE point');
  ok(pts.every((p) => {
    const at = resolvePoint(p);
    return at && Number.isFinite(at.x) && Number.isFinite(at.y) && p.r > 0;
  }), '...that resolves to a position and carries its symbol radius');
  ok(new Set(pts.map((p) => p.id)).size === pts.length,
    '...and the ids are unique, so a second room cannot collide with the first');
  ok(suggestFor(r, false).length === 0,
    'and the layer being off empties the list, so nothing invisible is snappable');

  /* --- A SPOT A HAND PUT DOWN IS NEVER A SUGGESTION ----------------------
     THE REGRESSION THIS GUARDS IS EXACT AND WAS REAL. `taskSpotsPx` used to
     hold nothing but the placer's answer, so this layer read the whole of it
     as "what the planner would do". An adjustable spot is two clicks on the
     ceiling and joins the same list on purpose — and because the suggestion
     layer takes precedence over the solid drawing of everything it covers, the
     fitting you had just placed came out as a dotted proposal.
     BOTH HALVES ARE CHECKED because either alone leaves a spot drawn twice or
     not at all: the projection must not offer it, and the canvas must draw it
     solid anyway. */
  const HAND = { ...SPOT, id: 'mspot-1', hand: true, x: 12 * S, y: 6 * S };
  const mixed = projectSuggestedPointsPx([r], [SPOT, HAND], S,
                                         { on: true, ambient: false, spots: true });
  ok(mixed.length === 1 && mixed[0].id === `sg-${SPOT.id}`,
    'the placer\'s spot is proposed and the hand-placed one is not');

  const withHand = draw(r, { layers: { ...LAYERS, suggestGrid: true },
                             taskSpots: [SPOT, HAND],
                             suggestPoints: suggestFor(r) });
  /* THE SOLID SYMBOL IS `url(#lp-core)` — the accent ramp every placed fitting
     is cut from, and the one thing a proposal never carries. With the layer on
     and one hand-placed spot on the sheet there has to be exactly one. */
  ok(/fill="url\(#lp-core\)"/.test(withHand),
    '...and the canvas still draws it as a fitting, in the accent, not dotted');
  ok(/fill="url\(#lp-throw\)"/.test(withHand),
    '...keeping its pool too, because it is placed and not proposed');

  const plain = draw(r, { taskSpots: [SPOT] });
  const sug = draw(r, { layers: { ...LAYERS, suggestGrid: true },
                        taskSpots: [SPOT], suggestPoints: pts });
  ok(sug.startsWith('<svg'), 'the canvas renders with the layer on');
  // The wash is the drawing's claim that a fitting is lighting that floor.
  ok(/fill="url\(#lp-throw\)"/.test(plain) && !/fill="url\(#lp-throw\)"/.test(sug),
    'no pool under a proposal — the placed drawing has them, this one does not');
  ok(/fill="url\(#lp-core\)"/.test(plain) && !/fill="url\(#lp-core\)"/.test(sug),
    '...and no fitting bodies either: the accent is for what is going in');
  const rings = (h) => (h.match(/<circle[^>]*stroke-dasharray/g) || []).length;
  ok(rings(sug) >= pts.length,
    `a dotted ring for every proposal: ${rings(sug)} for ${pts.length}`);
  /* THE INK IS ON THE GROUP AND THE DOTS ARE ON ITS CHILDREN, which is why
     this looks for the wrapper rather than for one circle carrying both. */
  const ghostGroup = /<g pointer-events="none" opacity="0\.8"[^>]*stroke="([^"]+)"/;
  ok(ghostGroup.exec(sug)?.[1] === '#000000',
    "drawn in the sheet's own ink on paper");
  const night = draw(r, { layers: { ...LAYERS, suggestGrid: true, invert: true },
                          taskSpots: [SPOT], suggestPoints: pts });
  ok(ghostGroup.exec(night)?.[1] === '#FFFFFF',
    '...and in white on the negative, which is the same rule the outlines take');

  /* --- AND THE CENTRES ARE REACHABLE, WHICH IS THE OTHER HALF ------------
     A PROPOSAL YOU CAN SEE AND CANNOT AIM AT IS A PICTURE. The whole point of
     resolving the layer once is that this list and the one the canvas drew are
     the same object, so these assertions are about the marks on the sheet and
     not about a parallel construction that happens to agree.

     AND THEY GO IN THROUGH THE FULL TARGET SET, exactly as App builds it —
     rooms, placed objects, drawn shapes AND lights. Testing the lights alone
     would pass on a `collectTargets` that dropped them the moment anything else
     was present, and "it snapped in isolation" is not the claim being made. */
  const asApp = (extra = {}) => collectTargets({
    rooms: [{ id: 'r1', name: 'Space 1', polygonPx: r.plan.polygonPx }],
    objects: [{ id: 'fan1', x: 5 * S, y: 5 * S, r: 2 * S }],
    shapes: [{ id: 'sh1', pts: [{ x: 2 * S, y: 2 * S }, { x: 6 * S, y: 2 * S },
                                { x: 6 * S, y: 6 * S }, { x: 2 * S, y: 6 * S }] }],
    lights: pts, ...extra,
  });
  const targets = asApp();
  ok(targets.filter((t) => t.kind === 'light-centre').length === pts.length * 2,
    'every centre offers an x and a y target, alongside every other source');
  const p0 = pts[0];
  const hit = snapPoint({ x: p0.x + 2, y: p0.y - 2 }, targets, { tol: 7 });
  ok(Math.abs(hit.x - p0.x) < 1e-9 && Math.abs(hit.y - p0.y) < 1e-9,
    'a corner dragged near a centre lands exactly on it');
  ok(hit.guides.length === 2 && hit.guides.every((g) => g.kind === 'light-centre'),
    '...and both guides say what it caught');
  /* THE GESTURE THE FEATURE WAS ASKED FOR: a rectangle spanned between two
     proposed centres comes out measuring the distance between them exactly. */
  const p1 = pts.find((q) => q.of === 'ambient' && q.x !== p0.x && q.y !== p0.y);
  const c0 = snapPoint({ x: p0.x - 3, y: p0.y + 3 }, targets, { tol: 7 });
  const c1 = snapPoint({ x: p1.x + 3, y: p1.y - 3 }, targets, { tol: 7 });
  ok(Math.abs((c1.x - c0.x) - (p1.x - p0.x)) < 1e-9
      && Math.abs((c1.y - c0.y) - (p1.y - p0.y)) < 1e-9,
    'a rectangle spanned between two centres is exactly their spacing');
  const miss = snapPoint({ x: p0.x + 400, y: p0.y + 400 }, targets, { tol: 7 });
  ok(miss.x === p0.x + 400 && miss.guides.length === 0,
    'and nothing is pulled from across the room');
  /* THE SPAN IS THE SYMBOL'S, so the guide draws across the ring you aimed at
     rather than as a stub of no length. */
  const gl = guideLine(hit.guides[0], 0);
  ok(Math.hypot(gl.x2 - gl.x1, gl.y2 - gl.y1) > 0,
    'the guide it draws spans the fitting it belongs to');
  /* AND A CENTRE THAT IS NOT ON THE SHEET IS NOT A TARGET, which is the same
     gate the drawing reads — see `suggestPointsPx`. */
  ok(!asApp({ lights: suggestFor(r, false) })
      .some((t) => t.kind === 'light-centre'),
    'with the layer off there is nothing to aim at');
}

// --- 6. the schedule renders too --------------------------------------
// --- 6a. the two decorative lamps put their own marks on the sheet -------
say('6a. A PENDANT AND A STANDING LAMP DRAW THEIR OWN SYMBOLS');
{
  const r = room(box(24, 18));
  const obj = (id, typeId, kind, x, y) => ({
    id, typeId, kind, source: 'placed',
    x: x * S, y: y * S, r: 0.74 * S, diaFt: 0.74 * 2, w: 0, h: 0, rot: 0,
    shape: 'circle', offCeiling: kind === 'standing_lamp',
  });
  const L = { ...LAYERS, fan: true };
  /* A PENDANT AND A CHANDELIER SHARE A `kind` ON PURPOSE — see
     ceilingObjects.js — so the ONE thing that can tell their marks apart on a
     rendered sheet is the branch order in the canvas. That is what this pins:
     three fittings of one kind, three different drawings. */
  const pend = draw(r, { fansPx: [obj('pd', 'pendant', 'chandelier', 8, 8)], layers: L });
  const chan = draw(r, { fansPx: [obj('ch', 'chandelier', 'chandelier', 8, 8)], layers: L });
  const stand = draw(r, { fansPx: [obj('sl', 'standing_lamp', 'standing_lamp', 8, 8)],
                          layers: L,
                          fittingOutput: () => ({ watts: 7, lumens: 525 }) });
  ok(pend !== chan,
    'a pendant and a chandelier of the same kind do not draw the same mark');
  ok(stand !== pend, '...and a standing lamp draws a third thing again');

  /* THE POOL OF LIGHT IS WHAT SAYS "THIS EMITS", and it is the one mark both
     lamps have and no other object on this layer does. `lp-pulse` is the
     breathing class and `lp-glow` the ramp it is filled from — see the note by
     the grid's own pool. */
  const glows = (h) => (h.match(/lp-pulse/g) ?? []).length;
  ok(glows(pend) > 0 && pend.includes('url(#lp-glow)'),
    'a pendant carries a breathing pool of light');
  ok(glows(stand) > 0, '...and so does a standing lamp');
  ok(glows(chan) === glows(draw(r, { fansPx: [], layers: L })),
    'and a chandelier deliberately does not — it was not asked to change');

  /* THE BODY IS CUT FROM THE ACCENT RAMP, like every other fitting on the
     sheet, which is what takes the two of them off the objects' own white/amber
     compromise. See `emits`. */
  ok(pend.includes('url(#lp-core)') && stand.includes('url(#lp-core)'),
    'both lamps fill their body from the fitting ramp rather than from a flat ink');

  /* AND NO CLEARANCE RING ON THE ONE THAT RESERVES NOTHING. A standing lamp is
     off-ceiling: the grid does not move for it, so a dashed circle round it
     would be drawing a hole in a layout that has none. */
  const dashes = (h) => (h.match(/stroke-dasharray/g) ?? []).length;
  ok(dashes(stand) < dashes(pend),
    'a standing lamp draws no clearance ring and a pendant does');

  // THE CARD'S OWN NUMBERS ARE NOT IN THE MARKUP — a tooltip is raised by a
  // pointer and this is a static render — so what is asserted here is that
  // wiring the resolver changes nothing about the drawing and throws nothing.
  ok(stand.startsWith('<svg'),
    'and the sheet still renders with an output resolver wired');
}

say('6. THE SCHEDULE RENDERS');
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

  /* --- WHAT THE SHEET SHOWS AND WHAT IT DELIBERATELY DOES NOT -------------
     THE SPACE BREAKDOWN CAME OFF THE SCREEN (2026-09-11) and stayed in every
     export, which is a split only a render test can hold: `boqTable` still
     emits the block — tools/test-boq.mjs asserts that — and this asserts the
     page does not draw it. Either half alone would let the pair drift back
     together. */
  const sheet = renderToStaticMarkup(React.createElement(BOQView, {
    boq: buildBOQ({
      rooms: [{ id: 'r1', outline: { name: 'Living' },
                plan: { ok: true, stats: { areaSqft: 320 },
                        lights: [{ kind: 'small' }, { kind: 'small' }] } }],
      cobs: [{ roomId: 'r1', watts: 7, beam: 30 }],
      objects: [{ kind: 'chandelier' }, { kind: 'standing_lamp' }],
      pxPerFt: S, plan: 'test',
    }),
  }));
  ok(!/Space breakdown/i.test(sheet), 'the space-wise list is not on the screen');
  ok(/Other items/i.test(sheet), 'the coordination block is headed "Other items"');
  ok(!/Ceiling items/i.test(sheet), '...and not "Ceiling items"');
  ok(sheet.includes('Recessed COB downlight — 7 W, 30°'),
    'and a hand-placed COB is a line on the sheet at its own specification');
}

say('7. THE DECORATIVE FITTINGS GET THE CONTROL THEIR TYPE IS SOLD WITH');
{
  /* WHAT IS ON SCREEN, AND NOT WHAT THE DATA MERELY ALLOWS. The three-way
     branch in SpaceAnalysis — slider / printed figure / chips — is the thing
     these two requirements are ABOUT, so it is the thing asserted: a pendant
     that offered three options and still drew a slider would pass every check
     in test-lighting-planner and be the bug. */
  const SpaceAnalysis = await load('/src/components/SpaceAnalysis.jsx');
  const { analyseSpace } = await import('../src/lib/lumens.js');
  const { wattsOf, wattRangeOf, wattOptionsOf } = await import('../src/lib/ceilingObjects.js');

  const lampRow = (id, typeId) => ({
    key: id, familyId: 'lamp', count: 1, lengthFt: 0,
    label: typeId, watts: wattsOf({ typeId, kind: typeId }),
    wattRange: wattRangeOf({ typeId, kind: typeId }),
    wattOptions: wattOptionsOf({ typeId, kind: typeId }),
  });
  const draw = (row) => renderToStaticMarkup(React.createElement(SpaceAnalysis, {
    analysis: analyseSpace({
      polygonFt: box(20, 14), ceilingMm: 2700,
      materials: { ceiling: 'light', floor: 'light', walls: 'light' },
      projectId: 'residential', country: 'India', groups: [row], watts: {},
    }),
    onWatts: () => {}, highlight: [row.key],
  }));

  const chand = draw(lampRow('ch1', 'chandelier'));
  ok(/type="range"/.test(chand), 'a chandelier gets the slider');
  ok(/max="55"/.test(chand), '...that reaches 55 W');

  for (const typeId of ['pendant', 'standing_lamp']) {
    const html = draw(lampRow(typeId, typeId));
    ok(!/type="range"/.test(html), `a ${typeId} gets no slider`);
    const chips = [...html.matchAll(/>(\d+)W</g)].map((m) => Number(m[1]));
    ok(String(chips) === '7,9,12',
      `...it gets 7W, 9W and 12W and nothing else (got ${chips.join('/') || 'none'})`);
  }
}

await vite.close();
console.log('\n' + (fail ? `${fail} FAILED` : 'all good'));
process.exit(fail ? 1 : 0);
