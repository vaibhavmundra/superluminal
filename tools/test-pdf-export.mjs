// ---------------------------------------------------------------------------
// test-pdf-export.mjs — is every fitting on the drawing actually on the sheet?
//
// WHY THIS FILE EXISTS. There was no test of the PDF export at all, and what
// that hid was not a rounding error: THREE WHOLE POPULATIONS were missing from
// every sheet the app has ever produced. `plotToPDF` took the engine's layout,
// the ceiling objects, the accents and the spots — and had no parameter at all
// for the COBs somebody places one at a time, the arrays they set out on a
// geometry, or the magnetic track they draw and clip modules onto. On a plan
// laid out the way this app recommends (`autoLights` is off by default) those
// are the only lighting in the building, so the export was reliably empty of
// the whole design. It was reported as "the light fixtures are not showing up".
//
// It also ignored the layer switches outright, in both directions: it plotted
// the solver's grid whether or not the drawing was showing it, and plotted
// accents and spots onto sheets whose author had switched them off.
//
// WHAT IS ASSERTED IS THE MARKS ON THE PAGE, not the arguments going in. A
// plotter that accepts a list and quietly drops it is exactly the failure this
// is here to catch, so the PDF is generated, its content streams are inflated,
// and the drawing operators are counted. `useObjectStreams: false` — which
// pdfPlot sets, and says why — is what makes that possible.
//
// THE MEASURE IS A DELTA AGAINST AN EMPTY SHEET. Counting absolute operators
// would bind the test to how a fan or an arrowhead happens to be drawn; what
// matters is that handing the plotter a population puts MORE ink on the page,
// and that switching its layer off takes exactly that ink away again.
//
//   node tools/test-pdf-export.mjs
// ---------------------------------------------------------------------------

import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { plotToPDF, nightBase } from '../src/lib/pdfPlot.js';
/* THE SYMBOL TABLE IS THE DXF'S TOO — see settings.js. Read from its own home
   rather than through the plotter, so this cannot pass on a re-export that has
   drifted from what the other exporter uses. */
import { SYMBOL_FT, COB_DIA_IN } from '../src/lib/settings.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

const PPF = 30;                    // 30 px/ft, as in the other geometry scripts
const SOURCE = { w: 1200, h: 900, kind: 'raster' };
const POLY = [{ x: 60, y: 60 }, { x: 1140, y: 60 },
              { x: 1140, y: 840 }, { x: 60, y: 840 }];

/** A room with a layout in it, and nothing else on the ceiling. */
const bare = (plan = {}) => ({
  name: 'Living', outline: { name: 'Living' },
  plan: { ok: true, polygonPx: POLY, lightsPx: [], tracksPx: [], covesPx: [], ...plan },
});

/** Every list empty, so each case adds exactly one population. */
const EMPTY = {
  source: SOURCE, pxPerFt: PPF, rooms: [bare()],
  objects: [], accents: [], spots: [], coves: [],
  cobs: [], tracks: [], trackModules: [],
  title: 'test',
};

/**
 * THE SHEET'S OWN CONTENT, INFLATED. Every stream in the file, decompressed
 * where it is compressed and taken as-is where it is not — the page's drawing
 * operators are in there, and so is the title strip as a hex string.
 */
function content(bytes) {
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const a = m.index + m[0].length;
    const b = text.indexOf('endstream', a);
    if (b < 0) continue;
    const raw = buf.subarray(a, b);
    try { out += zlib.inflateSync(raw).toString('latin1') + '\n'; }
    catch { out += raw.toString('latin1') + '\n'; }
  }
  return out;
}

/** How many marks are on this page: strokes, rectangles and fills. */
const marks = (s) => ['S', 're', 'f'].reduce(
  (n, op) => n + (s.match(new RegExp(`\\b${op}\\b`, 'g')) || []).length, 0);

/** What the title strip says, decoded out of its hex string. */
function strip(s) {
  let txt = '';
  for (const h of s.match(/<[0-9A-Fa-f]{20,}>/g) ?? []) {
    txt += Buffer.from(h.slice(1, -1), 'hex').toString('latin1') + ' ';
  }
  return txt;
}

const plot = async (over) => {
  const out = await plotToPDF({ ...EMPTY, ...over });
  const s = content(out.bytes);
  return { marks: marks(s), strip: strip(s), out };
};

// --- the populations, one at a time ----------------------------------------
//
// Each is handed to a plotter that has been given nothing else, so the delta
// against the empty sheet is that population's own ink and no one else's.

const BASE = (await plot({})).marks;

const CASES = [
  ['the engine grid, from the layout',
    { rooms: [bare({ lightsPx: [{ id: 'g1', kind: 'small', x: 200, y: 200 }] })] }],
  ['the absorbing track the design made',
    { rooms: [bare({ tracksPx: [{ closed: false,
        runs: [{ a: { x: 600, y: 200 }, b: { x: 900, y: 200 } }] }] })] }],
  ["a coved ceiling's setting-out line",
    { rooms: [bare({ covesPx: [{ key: 'c', line: [{ x: 700, y: 100 },
        { x: 1000, y: 100 }, { x: 1000, y: 300 }, { x: 700, y: 300 }] }] })] }],
  ['a ceiling object', { objects: [{ kind: 'fan', x: 300, y: 500, r: 60 }] }],
  ['an accent run', { accents: [{ id: 'z1', type: 'strip',
    run: [{ x: 100, y: 800 }, { x: 500, y: 800 }] }] }],
  ['a reverse cove, band and tape', { coves: [{ id: 'rc1',
    band: [{ x: 900, y: 700 }, { x: 1100, y: 700 },
           { x: 1100, y: 740 }, { x: 900, y: 740 }],
    run: [{ x: 900, y: 720 }, { x: 1100, y: 720 }] }] }],
  ['a directional spot', { spots: [{ id: 'sp1', x: 700, y: 500, angle: 0,
    target: { x: 820, y: 500 }, fixture: 'spot' }] }],
  // --- and the three that were not on the sheet at all
  ['a COB somebody placed by hand', { cobs: [{ id: 'c1', x: 300, y: 300, watts: 9 }] }],
  ["an array's lamps", { cobs: [{ id: 'a1|0', arrayId: 'a1', x: 350, y: 350 },
                                { id: 'a1|1', arrayId: 'a1', x: 390, y: 350 }] }],
  ['a magnetic track somebody drew', { tracks: [{ id: 'mt1', closed: false,
    pts: [{ x: 200, y: 600 }, { x: 600, y: 600 }] }] }],
  ['a module clipped onto it', { trackModules: [{ id: 'm1', x: 300, y: 600,
    kind: 'spot', lenIn: 6, wideIn: 1.5, ux: 1, uy: 0 }] }],
];

console.log('-- every population the drawing shows reaches the sheet --');
for (const [label, over] of CASES) {
  const { marks: n } = await plot(over);
  ok(n > BASE, `${label}: ${n - BASE} mark${n - BASE === 1 ? '' : 's'}`);
}

// --- a draft is not a fitting ----------------------------------------------
console.log('\n-- and a preview nobody has committed to is not --');
{
  /* The array bar's draft rides in the canvas's lamp list so that what you
     watch move is what the tick will keep. Nothing has been placed until it is
     ticked, and a sheet that plotted it would bill a run nobody ordered. */
  const real = await plot({ cobs: [{ id: 'c1', x: 300, y: 300 }] });
  const withDraft = await plot({ cobs: [{ id: 'c1', x: 300, y: 300 },
                                        { id: 'd1', x: 340, y: 300, draft: true }] });
  ok(withDraft.marks === real.marks, 'a draft lamp adds nothing to the plot');
  /* A fitting with no position is the other thing a store hands over — see
     `projected lists, not stores`: the document holds FEET, so a store reaches
     the plotter with `undefined` for x and y. Better nothing than NaN. */
  const noPos = await plot({ cobs: [{ id: 'c1', xFt: 10, yFt: 10 }] });
  ok(noPos.marks === BASE, 'and a record with no plan pixels is skipped, not plotted at NaN');
}

// --- the layer switches -----------------------------------------------------
//
// THE SHEET IS THE DRAWING, ON PAPER. Each switch has to take away exactly the
// ink of the population it governs and leave everything else standing.

console.log('\n-- the sheet is what the drawing is showing --');
{
  const SCENE = {
    rooms: [bare({ lightsPx: [{ id: 'g1', kind: 'small', x: 200, y: 200 }] })],
    objects: [{ kind: 'fan', x: 300, y: 500, r: 60 }],
    coves: [{ id: 'rc1', run: [{ x: 900, y: 720 }, { x: 1100, y: 720 }] }],
    spots: [{ id: 'sp1', x: 700, y: 500, angle: 0, fixture: 'spot' }],
    cobs: [{ id: 'c1', x: 300, y: 300 }],
    tracks: [{ id: 'mt1', closed: false, pts: [{ x: 200, y: 600 }, { x: 600, y: 600 }] }],
    trackModules: [{ id: 'm1', x: 300, y: 600, kind: 'spot',
                     lenIn: 6, wideIn: 1.5, ux: 1, uy: 0 }],
  };
  const ALL = { lights: true, autoLights: true, spots: true,
                accents: true, objects: true };
  const on = await plot({ ...SCENE, layers: ALL });
  const off = async (key) => (await plot({ ...SCENE,
    layers: { ...ALL, [key]: false } })).marks;

  const grid = await plot({ rooms: SCENE.rooms, layers: ALL });
  const gridInk = grid.marks - BASE;

  ok(await off('autoLights') === on.marks - gridInk,
    "'autoLights' off takes the solver's grid and nothing else");
  ok(await off('lights') < await off('autoLights'),
    "...and 'lights' is the master: it takes the hand-placed fittings too");
  ok(await off('accents') < on.marks, "'accents' off takes the cove's tape");
  ok(await off('spots') < on.marks, "'spots' off takes the directional spot");
  ok(await off('objects') < on.marks, "'objects' off takes the fan");
  /* NO `layers` MEANS WITHHOLD NOTHING, which is not the same as the defaults a
     fresh document opens with — where `autoLights` is off. Merging LAYER_DEFAULTS
     in here would make a bare call silently drop the engine's grid. */
  ok((await plot({ ...SCENE })).marks === on.marks,
    'and a caller that mentions no layers gets everything it handed over');
}

// --- the count on the sheet -------------------------------------------------
console.log('\n-- the title strip counts what is on the paper --');
{
  /* IT COUNTED THE ENGINE'S GRID ALONE, which made it a lie in exactly the case
     the app recommends: a ceiling laid out entirely by hand reported "0
     fittings" under a drawing full of them. The count exists so a reader can
     check the sheet and the schedule are of the same design, and it cannot do
     that job while it describes a different population from the one drawn. */
  const SCENE = {
    rooms: [bare({ lightsPx: [{ id: 'g1', kind: 'small', x: 200, y: 200 },
                              { id: 'g2', kind: 'small', x: 260, y: 200 }] })],
    cobs: [{ id: 'c1', x: 300, y: 300 }, { id: 'c2', x: 340, y: 300 },
           { id: 'c3', x: 380, y: 300 }, { id: 'd', x: 420, y: 300, draft: true }],
    trackModules: [{ id: 'm1', x: 300, y: 600, kind: 'spot',
                     lenIn: 6, wideIn: 1.5, ux: 1, uy: 0 }],
    spots: [{ id: 'sp1', x: 700, y: 500, angle: 0, fixture: 'spot', hand: true }],
  };
  const ALL = { lights: true, autoLights: true, spots: true,
                accents: true, objects: true };
  const said = async (over) => {
    const { strip: s } = await plot({ ...SCENE, ...over });
    return /(\d+) fittings?/.exec(s)?.[1] ?? '(none)';
  };
  ok(await said({ layers: ALL }) === '7',
    '2 grid + 3 placed + 1 module + 1 spot = 7, and the draft is not counted');
  ok(await said({ layers: { ...ALL, autoLights: false } }) === '5',
    "...without the solver's grid, 5");
  ok(await said({ layers: { ...ALL, lights: false } }) === '1',
    "...with every fitting off, only the spot, which answers to 'spots'");
}

// --- the suggested grid is a proposal, not a fitting ------------------------
console.log('\n-- a proposal is not plotted as a fitting --');
{
  /* `spotIsPlaced` in PlanCanvas is the rule, and this is it: while the grid is
     being SUGGESTED the placer's own spots are dotted proposals, and only a
     spot a hand put down is a fitting. A sheet that plotted proposals solid
     would be issuing a drawing of fittings nobody has placed. */
  const SCENE = {
    rooms: [bare({ lightsPx: [{ id: 'g1', kind: 'small', x: 200, y: 200 }] })],
    spots: [{ id: 'auto', x: 700, y: 500, angle: 0, fixture: 'spot' },
            { id: 'hand', x: 800, y: 500, angle: 0, fixture: 'spot', hand: true }],
  };
  const ALL = { lights: true, autoLights: true, spots: true,
                accents: true, objects: true };
  const solid = await plot({ ...SCENE, layers: ALL });
  const proposed = await plot({ ...SCENE, layers: { ...ALL, suggestGrid: true } });
  ok(proposed.marks < solid.marks,
    'the suggested grid takes the engine grid and the derived spot off the sheet');
  ok(/1 fitting\b/.test(proposed.strip),
    '...and the one fitting left is the one a hand placed');
}

// --- the ink -----------------------------------------------------------------
console.log('\n-- one ink, every mark, and it follows the sheet --');
{
  /* WHITE ON A DARK SHEET, BLACK ON A LIGHT ONE, and it is the LINEWORK as much
     as the fittings — room outlines, fans, symbols, tape, the strip. There used
     to be a second ink here, a dim warm grey for the plan's lines, and it meant
     a dark sheet came out with grey linework when it was asked for white. */
  const colours = (s, op) => [...new Set(
    [...s.matchAll(new RegExp(`([\\d.]+) ([\\d.]+) ([\\d.]+) ${op}`, 'g'))]
      .map((m) => m.slice(1, 4).join(',')))];
  const SCENE = {
    rooms: [bare({ lightsPx: [{ id: 'g', kind: 'small', x: 200, y: 200 }] })],
    objects: [{ kind: 'fan', x: 300, y: 500, r: 60 }],
    accents: [{ id: 'z', type: 'strip', run: [{ x: 100, y: 800 }, { x: 500, y: 800 }] }],
    spots: [{ id: 's', x: 700, y: 500, angle: 0, fixture: 'spot' }],
    cobs: [{ id: 'c', x: 300, y: 300 }],
    layers: { lights: true, autoLights: true, spots: true, accents: true, objects: true },
  };
  const day = content((await plotToPDF({ ...EMPTY, ...SCENE })).bytes);
  const dark = content((await plotToPDF({ ...EMPTY, ...SCENE, night: true })).bytes);
  ok(colours(day, 'RG').join('|') === '0,0,0',
    `a light sheet is drawn in black and nothing else: ${colours(day, 'RG').join(' ')}`);
  ok(colours(dark, 'RG').includes('1,1,1') && !colours(dark, 'RG').includes('0.42,0.4,0.37'),
    `a dark sheet is drawn in white, with no grey left: ${colours(dark, 'RG').join(' ')}`);

  /* AND THE HEATMAP FORCES BLACK, because an illuminance field is a
     light-coloured wash. App resolves the sheet as `invert && !heatmap` — see
     `darkSheet` — so a heatmap plot arrives here as a LIGHT sheet: black marks
     on white paper. Forcing black ink while leaving the ground black was the
     other candidate and it is a blank page. */
  const heat = content((await plotToPDF({ ...EMPTY, ...SCENE,
    layers: { ...SCENE.layers, heatmap: true } })).bytes);
  ok(colours(heat, 'RG').join('|') === '0,0,0',
    `a heatmap sheet is drawn in black: ${colours(heat, 'RG').join(' ')}`);
  /* AND THE PLOTTER HOLDS THAT LINE ON ITS OWN. App decides the sheet, but a
     caller that asks for a dark sheet AND the heatmap must not get white marks:
     the ink rule is the module's, so it cannot be got wrong from outside. */
  const both = content((await plotToPDF({ ...EMPTY, ...SCENE, night: true,
    layers: { ...SCENE.layers, heatmap: true } })).bytes);
  ok(!colours(both, 'RG').includes('1,1,1'),
    'and the heatmap wins over the dark sheet inside the plotter too');
}

// --- the plan underneath a dark sheet ---------------------------------------
console.log('\n-- a dark sheet carries the INVERTED plan, not a blank page --');
{
  /* THE EXPORT HAS TO BE THE DRAWING ON SCREEN. A white plan with black lines is
     showing as a black plan with white lines, and the sheet has to say the same
     thing — so what goes underneath a night sheet is the inverted bitmap.
     WHAT WENT WRONG: `nightBase` re-renders the imported PDF PAGE, and every
     other kind of import — an image, which is most plans — threw on the way in.
     The caller's `.catch(() => null)` swallowed it, and the sheet came out as a
     black page with the linework floating on it and no plan at all. Nothing
     anywhere said the drawing was missing. */
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf'
    + 'FcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const FALLBACK = { dataUrl: PNG, w: 1200, h: 900 };
  let tried = false;
  const openPdf = async () => { tried = true; throw new Error('not a pdf'); };

  /* AN IMAGE IMPORT TAKES THE CANVAS'S OWN COPY, and does not go near pdf.js:
     asking a PDF reader to parse a JPEG is how this failed in the first place,
     so the kind of file is tested rather than the exception it throws. */
  ok(await nightBase(openPdf, { name: 'plan.jpg', type: 'image/jpeg' }, 1,
       { fallback: FALLBACK }) === FALLBACK && !tried,
    'a raster plan uses the inverted bitmap the canvas is showing');
  ok(await nightBase(openPdf, null, 1, { fallback: FALLBACK }) === FALLBACK,
    '...and so does a sheet with no file behind it at all');

  /* A PDF STILL GETS RE-RENDERED — the editor's copy is 2400px on the long edge,
     which is 72 dpi on an A1 — but a page that will not render FALLS BACK rather
     than taking the plan off the sheet. */
  tried = false;
  /* The warning this path prints is the POINT of it — a plan that cannot be
     re-rendered used to vanish in silence — so it is muted here rather than
     removed, to keep the run readable. */
  const warn = console.warn; console.warn = () => {};
  const fellBack = await nightBase(openPdf,
    { name: 'plan.pdf', type: 'application/pdf' }, 1, { fallback: FALLBACK });
  console.warn = warn;
  ok(fellBack === FALLBACK && tried,
    'a PDF is re-rendered first, and falls back if the page will not render');
  ok(await nightBase(openPdf, { name: 'plan.jpg' }, 1) === null,
    'and with nothing to fall back to it says so rather than inventing a plan');

  /* AND IT LANDS. The base is an image XObject on the page — a plot that
     resolved the right bitmap and then failed to draw it would look identical
     to the bug this closes. */
  const withPlan = await plotToPDF({ ...EMPTY, night: true, base: FALLBACK });
  const without = await plotToPDF({ ...EMPTY, night: true, base: null });
  const imgs = (bytes) => (Buffer.from(bytes).toString('latin1')
    .match(/\/Subtype\s*\/Image/g) || []).length;
  ok(imgs(withPlan.bytes) === 1, `the inverted plan is on the sheet: ${imgs(withPlan.bytes)}`);
  ok(imgs(without.bytes) === 0, '...and a sheet with no base has no image on it');
  ok(/no plan image/.test(strip(content(without.bytes))),
    '...which the title strip says out loud rather than leaving blank');
}

// --- the plan underneath a light sheet --------------------------------------
console.log('\n-- and a light sheet carries the plan whatever format it came in --');
{
  /* THE SAME FAULT ONE MODE OVER. The raster embed tested
     `/png/i.test(source.mime || 'png')`, so a JPEG upload — a photographed or
     scanned drawing, which is most of them — failed it and the day sheet came
     out with the linework on blank paper. The `|| 'png'` is the tell: it was
     there to let a MISSING mime type through, and a mime type that was present
     and not PNG then had nothing to catch it. */
  const PNG_64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8'
    + 'z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  /* A REAL JPEG, OFF THE DISK. A hand-typed literal was the first attempt and
     pdf-lib refused it — correctly: its embedder parses the frame header for the
     image's dimensions, so a payload that merely looks like base64 is not a
     test of anything. One of the sample plans shipped with the app is the honest
     fixture, and it is the same KIND of file a user uploads. */
  const JPG_64 = readFileSync(
    new URL('../public/samples/FLOOR_PLAN_03_NEW_MODEL.jpg', import.meta.url)
  ).toString('base64');
  const imgs = (bytes) => (Buffer.from(bytes).toString('latin1')
    .match(/\/Subtype\s*\/Image/g) || []).length;
  const sheet = async (mime, base64) => imgs((await plotToPDF({ ...EMPTY,
    source: { ...SOURCE, mime, base64 } })).bytes);

  ok(await sheet('image/png', PNG_64) === 1, 'a PNG plan is embedded');
  ok(await sheet('image/jpeg', JPG_64) === 1, 'a JPEG plan is embedded too');
  /* A MISSING MIME TYPE STILL READS AS PNG, which is what the old `|| 'png'`
     was protecting and the one behaviour worth keeping from it. */
  ok(await sheet(undefined, PNG_64) === 1, '...and one with no mime type is read as PNG');
  /* AND A BITMAP THAT WILL NOT EMBED DOES NOT TAKE THE SHEET WITH IT — the rule
     the page embed above it already follows. */
  const warn2 = console.warn; console.warn = () => {};
  const broken = await plotToPDF({ ...EMPTY,
    source: { ...SOURCE, mime: 'image/png', base64: 'not-a-bitmap' } });
  console.warn = warn2;
  ok(broken.bytes.length > 0 && imgs(broken.bytes) === 0,
    'a corrupt bitmap loses the plan, not the plot');
}

// --- no screen effects -------------------------------------------------------
console.log('\n-- and no halo round anything --');
{
  /* A GRADIENT ROUND A FITTING IS A SCREEN EFFECT. This file's own header makes
     that argument about the print path it replaced — the `lp-glow` haloes and
     the `lp-pulse` breathing — and then reproduced two of them as true PDF
     shadings. A radial gradient centred on a 38 mm diffuser is a circle several
     times the size of the one mark that says what the fitting is.
     ASSERTED ON THE FILE rather than on the absence of a call, because a
     shading is an object graph: a `sh` operator, a soft mask, a /ShadingType
     dictionary. If any of the three comes back, so has the halo. */
  const s = content((await plotToPDF({ ...EMPTY, night: true,
    rooms: [bare({ lightsPx: [{ id: 'g', kind: 'small', x: 200, y: 200 }] })],
    cobs: [{ id: 'c', x: 300, y: 300 }],
    trackModules: [{ id: 'm', x: 300, y: 600, kind: 'diffuser',
                     lenIn: 24, wideIn: 1.5, ux: 1, uy: 0 }],
    accents: [{ id: 'z', type: 'strip', run: [{ x: 100, y: 800 }, { x: 500, y: 800 }] }],
    layers: { lights: true, autoLights: true, spots: true, accents: true, objects: true },
  })).bytes);
  for (const [what, rx] of [['shading paints (sh)', /\bsh\b/g],
                            ['soft masks', /\/SMask/g],
                            ['shading dictionaries', /ShadingType/g]]) {
    ok((s.match(rx) || []).length === 0, `no ${what} on a dark sheet`);
  }
}

// --- the symbols ------------------------------------------------------------
console.log('\n-- each fitting is the symbol it was asked to be --');
{
  const ALL = { lights: true, autoLights: true, spots: true,
                accents: true, objects: true };
  const dash = (s) => /\[[\d.\s]+\]\s*[\d.]+ d/.test(s);
  const one = async (over) => content((await plotToPDF({ ...EMPTY, layers: ALL, ...over })).bytes);

  /* AN LED STRIP IS A SINGLE DOTTED LINE. Tape is never in the open — it is in
     a pocket, a slot or under a shelf — and dotted is the drawing convention for
     a thing that is behind something. The DXF has said so from the beginning
     with a layer linetype; the sheet used to hand over a continuous polyline,
     which on somebody else's drawing reads as a pipe. */
  ok(dash(await one({ accents: [{ id: 'z', type: 'strip',
    run: [{ x: 100, y: 800 }, { x: 500, y: 800 }] }] })), 'an LED strip is dotted');
  /* A COVE IS TWO DOTTED LINES: the pocket and the tape in it. */
  ok(dash(await one({ rooms: [bare({ covesPx: [{ key: 'c',
      line: [{ x: 700, y: 100 }, { x: 1000, y: 100 },
             { x: 1000, y: 300 }, { x: 700, y: 300 }] }] })] })),
    "a cove's setting-out line is dotted too");
  /* ...AND A FITTING IS NOT. A dotted ring would say the lamp is concealed. */
  ok(!dash(await one({ cobs: [{ id: 'c', x: 300, y: 300 }] })), 'a COB is solid');

  /* A REVERSE COVE IS A FILLED SLOT WITH THE TAPE SHOWING THROUGH IT. Eight
     inches of ceiling is an area, not a line; and a strip in the same ink as the
     fill it sits inside is a strip that is not on the drawing, so it is drawn in
     the ground's colour. */
  const rc = await one({ coves: [{ id: 'rc',
    band: [{ x: 900, y: 700 }, { x: 1100, y: 700 },
           { x: 1100, y: 740 }, { x: 900, y: 740 }],
    run: [{ x: 900, y: 720 }, { x: 1100, y: 720 }] }] });
  ok(/0 0 0 rg/.test(rc), 'the slot is filled, not outlined');
  ok(/1 1 1 RG/.test(rc) && dash(rc),
    '...and its tape is a dotted line in the opposite colour');

  /* A STANDING LAMP HAD NO BRANCH AND FELL THROUGH TO THE FAN. This file's own
     note warned that a fifth round kind "wants its own symbol here and not this
     one", and a plan came out with a fan drawn where somebody put a floor lamp. */
  const lamp = await one({ objects: [{ kind: 'standing_lamp', x: 300, y: 500, r: 22 }] });
  const fan = await one({ objects: [{ kind: 'fan', x: 300, y: 500, r: 22 }] });
  ok(marks(lamp) !== marks(fan) && marks(lamp) > marks(await one({})),
    'a standing lamp is its own symbol and not a fan');

  /* A DIFFUSER IS A BODY AND AN AIMED HEAD IS A LAMP — two different fittings
     and two different drawings. A diffuser is 200-600 mm of extrusion lying
     along the rail; a track spot is a recessed COB with the ceiling taken away,
     so it gets the COB's ring. A circle is four beziers in a PDF, which is how
     the two are told apart here. */
  const dif = await one({ trackModules: [{ id: 'm', x: 300, y: 600,
    kind: 'diffuser', lenIn: 24, wideIn: 1.5, ux: 1, uy: 0 }] });
  const spot = await one({ trackModules: [{ id: 'm', x: 300, y: 600,
    kind: 'spot', lenIn: 6, wideIn: 1.5, ux: 1, uy: 0 }] });
  ok((dif.match(/\bc\b/g) || []).length === 0, 'a track diffuser is a rectangle, no curves');
  ok((spot.match(/\bc\b/g) || []).length >= 8, 'and a track spot is a ring with a dot in it');
}

// --- the symbols' real sizes ------------------------------------------------
console.log('\n-- a fitting is drawn at the size it is bought at --');
{
  /* A FOUR INCH DOWNLIGHT, WHICH IS WHAT IT WAS ASKED TO BE. It was 0.29 ft of
     RADIUS — a seven inch fitting — and at that size a dense ceiling plots as a
     field of blobs rather than a schedule of holes. `SYMBOL_FT` is in
     settings.js because the DXF reads the same table: a PDF and a DXF of one
     plan that disagreed about a fitting's size would be worse than either being
     wrong. */
  ok(SYMBOL_FT.cob * 24 === COB_DIA_IN,
    `the COB trim is ${(SYMBOL_FT.cob * 24).toFixed(1)} in across`);
  ok(SYMBOL_FT.cob === SYMBOL_FT.spot && SYMBOL_FT.cob === SYMBOL_FT.small,
    'a placed lamp, a spot and the grid’s own lamp are one trim');
  /* AND THE TWO GRID FITTINGS STAY TOLD APART BY SIZE. `large` is the 12 W
     fitting on a grid line and `small` the 7 W one in a cell; a drawing that
     made them one size would lose the only thing that says which is which. */
  ok(SYMBOL_FT.large > SYMBOL_FT.small,
    `a large fitting is still bigger: ${(SYMBOL_FT.large * 24).toFixed(1)} in`);
}

console.log('\n-- a spot with nowhere to be does not take the download with it --');
{
  /* THE WHOLE EXPORT DIED ON ONE OF THESE: "`options.x` must be of type
     `number`, but was actually of type `NaN`", thrown by pdf-lib out of the
     fitting symbol and caught in App.jsx as "[export] the plot failed".
     `projectTaskSpotsPx` emits ONE ENTRY PER TASK SURFACE whether or not the
     placer found anywhere to stand, so the panel can say why a surface got
     nothing. A refusal carries `rejected`; a SKIPPED surface carries `skipped`
     and no reason — and neither carries an `x`. The plotter tested `rejected`
     alone, so the skipped one reached the symbol, the transform turned
     undefined into NaN, and pdf-lib — which validates, where SVG silently
     ignores a bad attribute — threw. One skipped surface anywhere in a plan was
     enough to make the PDF button do nothing at all.
     EVERY SPOT IN THIS FILE CARRIED A POSITION, which is exactly why the suite
     never saw it. So these three do not. */
  const CASES = [
    ['skipped — no reason and no position',
      { id: 'sp-skip', surfaceId: 'sf1', fixture: 'spot', skipped: true }],
    ['refused, which was the only case guarded',
      { id: 'sp-rej', surfaceId: 'sf2', fixture: 'spot', rejected: 'nowhere to stand' }],
    ['a record holding NaN rather than nothing',
      { id: 'sp-nan', surfaceId: 'sf3', fixture: 'spot', x: NaN, y: NaN }],
  ];
  for (const [label, sp] of CASES) {
    let threw = null, n = null;
    try { n = (await plot({ spots: [sp] })).marks; }
    catch (e) { threw = e.message; }
    ok(!threw, `${label}: the sheet still renders${threw ? ` — ${threw}` : ''}`);
    // ...AND IT PUTS NOTHING ON THE PAGE. Surviving by drawing a fitting at the
    // origin would be the worse fix: a lamp on the sheet that is not in the
    // building, in a corner, with an arrow pointing off it.
    ok(n === BASE, `...and adds no ink: ${n} vs ${BASE}`);
  }

  /* AND A REAL SPOT BESIDE THEM IS STILL DRAWN. The guard has to drop the empty
     records and nothing else — a plot that survived this by skipping the whole
     population would pass every assertion above and lose every aimed fitting on
     the drawing. */
  const mixed = await plot({ spots: [
    { id: 'sp-skip', surfaceId: 'sf1', fixture: 'spot', skipped: true },
    { id: 'sp1', x: 700, y: 500, angle: 0, target: { x: 820, y: 500 }, fixture: 'spot' },
  ] });
  const alone = await plot({ spots: [
    { id: 'sp1', x: 700, y: 500, angle: 0, target: { x: 820, y: 500 }, fixture: 'spot' },
  ] });
  ok(mixed.marks > BASE, `the placed spot beside it is still drawn: ${mixed.marks} vs ${BASE}`);
  ok(mixed.marks === alone.marks,
    `and drawn exactly as it is on its own: ${mixed.marks} vs ${alone.marks}`);
  /* THE TITLE STRIP AGREES, which is the check the count exists for: the sheet
     and the schedule are of the same design. It has always applied the position
     test — the gate that DREW the fittings was the one condition short. */
  ok(/\b1 fitting\b/.test(mixed.strip),
    `and the count says one fitting, not two: "${mixed.strip.trim()}"`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
