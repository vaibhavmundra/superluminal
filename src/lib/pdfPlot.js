// ---------------------------------------------------------------------------
// pdfPlot.js — the lit drawing as a PDF, plotted rather than photographed.
//
// THIS REPLACES A PRINT OF THE SCREEN, AND THE DIFFERENCE IS THE WHOLE POINT.
//
// printSheet.js hands the browser the live `<svg>` and lets it print. That gets
// vector output for free and it was the right first move, but what it prints is
// a picture of a USER INTERFACE. The canvas carries marks that exist only to be
// looked at on a screen: `lp-glow` haloes, `lp-pulse` breathing, hover states
// that thicken a fitting under the pointer, selection frames, grab handles. On
// paper those are not effects, they are ink — a strip's glow is
// `max(lw * (S.stroke + boost) * 3, lw * 6)`, which lands at 1.1mm, nine times
// an AutoCAD hairline. That is why the print came out heavy: not because the
// hairlines were wrong (they measure 0.19mm) but because half the marks on the
// sheet were never hairlines at all.
//
// So this file does not read the SVG. It takes the GEOMETRY and plots it, which
// is exactly what exporters.js already does for DXF — same inputs, same split by
// trade, same decision that a drawing is made of linework and nothing else.
// Keeping the two side by side is deliberate: a PDF and a DXF of one plan that
// disagreed about where a fitting is would be worse than either being wrong.
//
// --- WHY pdf-lib, AND WHY IT IS WORTH THE BUNDLE --------------------------
//
// boqExport.js hand-writes its PDF and says why: a schedule is eight columns of
// Helvetica and jsPDF is 350KB to draw them. That reasoning does not survive
// contact with a drawing. What this needs is `embedPdf` — lifting the ORIGINAL
// imported page in as a vector object and drawing on top of it — and there is no
// hand-rolled version of that worth attempting.
//
// Measured at 555KB raw, 189KB gzipped, against an app already at 529KB gzipped.
// It buys the one thing the print path could never give: the plan itself stays
// VECTOR at any sheet size. The imported page is not re-rendered, re-rasterised
// or resampled — it is the same page objects, placed. Zoom into the PDF and the
// original drawing is as sharp as it was in the file you uploaded.
//
// --- SIZE AND SCALE -------------------------------------------------------
//
// THE SHEET IS THE SHEET IT CAME OFF. `source.pageSizePt` is the imported page's
// own size in points, threaded through pdfPlan.js and planSource.js for this.
// An A1 drawing goes back on an A1, so a 1:50 stays a 1:50 — the previous export
// fitted everything to A4, which silently rescaled every drawing that was not
// A4 to begin with and left no scale anywhere on the sheet to say so.
//
// A raster import has no sheet: an image knows pixels and nothing about the
// world. Those get a page derived from the drawing's real size at a named scale,
// which is the honest substitute — the plan measures what it measures, and the
// paper is whatever holds it.
// ---------------------------------------------------------------------------

/* WHAT IS LEFT OF THE pdf-lib SURFACE THIS FILE USES. Six imports went with the
   shadings — the object-graph names (`PDFName`, `PDFOperator`), the curve and
   clip operators, and the graphics-state call that carried their soft masks.
   What remains is a page, a font, a colour, and the handful of path operators
   the filled marks are built from. */
import { PDFDocument, StandardFonts, rgb,
         moveTo, lineTo, closePath,
         pushGraphicsState, popGraphicsState,
         setFillingRgbColor, fill } from 'pdf-lib';
import { SYMBOL_FT, COB_DIA_IN, AIM_FT } from './settings.js';
/* THE TRACK MODULES' REAL SIZES, in inches. Shared with the canvas and the DXF
   rather than restated, so a diffuser is the same body on all three. */
import { TRACK_DIMS_IN } from './track.js';

/* --- THE NIGHT SHEET'S GRADIENTS WERE HERE, AND THEY ARE GONE --------------
   A HALO ROUND EVERY FITTING IS A SCREEN EFFECT, AND THIS FILE EXISTS BECAUSE
   SCREEN EFFECTS DO NOT BELONG ON PAPER. The header above makes that argument
   about the print path it replaced — "what it prints is a picture of a USER
   INTERFACE ... `lp-glow` haloes, `lp-pulse` breathing" — and then this file
   reproduced two of them as true PDF shadings: a radial glow round each lamp and
   an axial ramp along each strip. They were asked for and they are removed.
   WHAT THEY WERE LAYERED ON TOP OF IS THE PROBLEM WITH THEM. A track diffuser is
   a slim rectangle 38 mm across; a radial gradient centred on it is a circle
   several times its size sitting over the one mark that says what the fitting
   is. The symbol is the drawing.
   THE MACHINERY WENT WITH THEM — the Type 2 and Type 3 shadings, the stitching
   function, the clip paths and the soft-mask graphics states, about 160 lines.
   It was the only implementation of PDF axial and radial shadings in this app,
   so it is worth knowing it existed and where: `git log -S paintShading --
   src/lib/pdfPlot.js` finds the revision that had it, and the note it carried
   explains every part of the object graph it built. */

/**
 * LINE WEIGHTS, IN POINTS, AND THERE ARE ONLY THREE.
 *
 * A drawing is legible because its weights are FEW and mean something, not
 * because each mark is tuned. 72 points to the inch, so 0.35pt is 0.12mm — an
 * AutoCAD hairline, and the thinnest line that survives a laser printer.
 *
 * The hierarchy is the drafting convention: the room's edge is the heaviest mark
 * because it is the thing everything else sits inside, fittings are hairlines
 * because there are hundreds of them, and setting-out lines are lighter still
 * because they are information rather than product.
 */
export const WEIGHT = {
  outline: 0.5,     // 0.18mm — a space's edge
  fitting: 0.35,    // 0.12mm — anything that gets ordered
  setout: 0.25,     // 0.09mm — track runs, cove centre lines, leaders
};

/** Everything is black. A plot is black on white; colour is a screen idea. */
const INK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
/* THE NIGHT SHEET'S TWO INKS. Paper goes to `--bg`, and the line work goes to a
   dim warm grey rather than white: on black, white hairlines read as brighter
   than the fittings, and the fittings are the subject. Same judgment PlanCanvas
   makes on the inverted ground — the plan is the ground, the lights are the
   figure. Literals because this file shares no stylesheet with the app. */
const NIGHT_PAPER = rgb(0, 0, 0);

/**
 * THE DRAWING'S INK, AND IT IS ONE COLOUR FOR EVERY MARK ON THE SHEET.
 *
 * WHITE ON A DARK SHEET, BLACK ON A LIGHT ONE. That is the whole rule and it
 * applies to the linework as much as to the fittings: room outlines, fans,
 * symbols, tape, the title strip. There WAS a second ink here — a dim warm grey
 * for the plan's linework, on the argument that "white hairlines read as
 * brighter than the fittings" — and it was wrong twice over. It made a dark
 * sheet's linework grey when it was asked to be white, and it split one decision
 * into two so that half the sheet could come out the wrong colour.
 *
 * AND BLACK WHENEVER THE HEATMAP IS ON, because the illuminance field is a
 * light-coloured wash and white marks on it are a drawing with nothing on it.
 */
const inkFor = ({ night = false, heatmap = false } = {}) =>
  (heatmap ? INK : night ? WHITE : INK);

/**
 * THE GROUND, WHICH IS A COLOUR THIS SHEET HAS TO BE ABLE TO DRAW IN.
 *
 * A reverse cove is a filled slot with a strip down it, and the strip has to be
 * legible INSIDE the fill — so it is drawn in the paper's own colour rather
 * than in a second ink. That is the only mark on the sheet that needs this, and
 * it is why the ground is a named value rather than something the page merely
 * happens to be.
 */
const paperFor = ({ night = false } = {}) => (night ? NIGHT_PAPER : WHITE);

/**
 * THE DOT AND THE GAP, IN FEET — the DXF's own figures, so a dotted line means
 * the same length of ink in both files. See DOT_FT and GAP_FT in exporters.js
 * for why a short dash rather than a true zero-length dot.
 */
const DOT_FT = 0.05, GAP_FT = 0.10;

/**
 * THE PLAN, RE-RENDERED AND INVERTED, for the night sheet's base.
 *
 * Browser only — it needs a canvas — and separate from `plotToPDF` so the plot
 * itself stays testable without one.
 *
 * RE-RENDERED RATHER THAN REUSED. The editor holds the page at 2400px on the
 * long edge, which is 72 dpi on an A1: reusing it is the softness that started
 * all of this. `openPdf` takes a `longEdge`, so the page is rasterised again at
 * export, for the sheet it is actually going onto.
 *
 * CAPPED BY AREA, NOT BY EDGE, and the cap is Safari's. Chrome will hold a
 * 268MP canvas and Safari gives up around 16.7MP — so an edge-based cap that
 * looked fine in Chrome would hand Safari users a blank base with no error. 16MP
 * is 4700px on an A1's long edge, which is about 142 dpi there and 285 on an A3.
 *
 * WHY IT IS INVERTED HERE AND NOT WITH A BLEND MODE. The alternative is to embed
 * the original page as vector and lay a white rectangle over it in /Difference,
 * which inverts it and keeps it sharp at any zoom. It is a real option and it is
 * not taken: a transparency group with a blend mode is the part of PDF that
 * viewers and RIPs disagree about most, and a presentation sheet that comes out
 * inverted in Acrobat and positive on somebody's plotter is worse than a soft
 * one. Pixels are boring and they are the same everywhere.
 */
export async function nightBase(openPdf, file, pageNo,
                                { maxPixels = 16e6, fallback = null } = {}) {
  /* --- A RASTER IMPORT HAS NO PAGE TO RE-RENDER, AND THAT WAS THE BUG --------
     THIS FUNCTION WENT STRAIGHT TO `openPdf` WHATEVER IT WAS GIVEN. On an image
     upload — which is most plans — pdf.js cannot parse the file, the call
     threw, the caller's `.catch(() => null)` swallowed it, and the night sheet
     came out as a black page with the linework floating on it and NO PLAN AT
     ALL. Silently: nothing in the file, the console or the title strip said the
     drawing was missing.
     SO THE FALLBACK IS THE BITMAP THE CANVAS IS ALREADY SHOWING. App inverts the
     plan's pixels for the screen — see `invertedSrc` in usePlanSource, which
     does the same subtraction from 255 and says why it is done to the pixels
     rather than with a CSS filter — and that image IS the night plan. Handing it
     over is what makes the sheet the drawing the user is looking at.
     THE RE-RENDER IS STILL PREFERRED WHERE THERE IS A PAGE, because the editor
     holds the plan at 2400px on the long edge, which is 72 dpi on an A1 — the
     softness that started all of this. A PDF gets rasterised again for the sheet
     it is actually going onto; everything else gets the screen's own copy, which
     is a worse sheet than that and an infinitely better one than none. */
  const isPdf = !!file && (file.type === 'application/pdf'
    || /\.pdf$/i.test(file.name || ''));
  if (!isPdf || typeof openPdf !== 'function') return fallback;
  let doc = null;
  try {
    doc = await openPdf(file);
    const probe = await doc.render(pageNo || 1, { longEdge: 64 });
    const ratio = probe.w / probe.h;
    const longEdge = Math.round(Math.sqrt(maxPixels * Math.max(ratio, 1 / ratio)));
    const big = await doc.render(pageNo || 1, { longEdge });

    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = big.src; });
    const cv = document.createElement('canvas');
    cv.width = big.w; cv.height = big.h;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const frame = cx.getImageData(0, 0, cv.width, cv.height);
    const px = frame.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2];
    }
    cx.putImageData(frame, 0, 0);
    return { dataUrl: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
  } catch (err) {
    /* A PAGE THAT WILL NOT RE-RENDER FALLS BACK RATHER THAN FAILING, and it
       SAYS SO. The caller used to own this catch and turned it into `null`,
       which is how a missing plan became invisible — see the note above. */
    console.warn('[plot] the page could not be re-rendered for the night sheet', err);
    return fallback;
  } finally {
    doc?.destroy?.();
  }
}
const PT_PER_MM = 72 / 25.4;

/** Named sheets, long edge second, in points. Only used when there is no imported page. */
export const SHEETS = {
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
};

/**
 * SYMBOL SIZES IN FEET, TAKEN FROM THE DXF EXPORTER RATHER THAN INVENTED.
 *
 * I had guessed 0.33 and 0.22 here, which is a third smaller than the sheet
 * this app has always issued — and the guess was the real mistake rather than
 * the number. exporters.js already decided what a downlight looks like on a
 * drawing (0.29 ft radius, a large fitting 0.5, a narrow 5W lamp four fifths of
 * a small one), the canvas draws within a hundredth of the same, and a PDF that
 * disagreed with the DXF about the size of a fitting would be two drawings of
 * one design.
 */
/* THE SYMBOL SIZES ARE SHARED WITH THE DXF — see SYMBOL_FT in settings.js for
   the table and for why it is not held here any more. Re-exported because this
   file's own tests read it through the module they are testing. */
export { SYMBOL_FT, COB_DIA_IN, AIM_FT };


/* THE AIM TAIL MOVED TO settings.js, WITH ITS HEAD. It was two numbers here and
   two literals in exporters.js, and the head was drawn by this file alone — so
   the plot drew an arrow and the DXF drew a bare line on the one fitting whose
   direction is part of its specification. See AIM_FT there; it is re-exported
   above because this file's own tests read it through the module they test. */

/** The scales a lighting drawing is issued at, coarsest last. */
export const SCALES = [50, 100, 200];

/**
 * WHICH SHEET AND WHICH SCALE A RASTER PLAN GOES ON.
 *
 * Walked coarsest-scale-last so the drawing comes out as LARGE as will fit: a
 * plan that fits an A1 at 1:50 is issued at 1:50, not shrunk to 1:100 because
 * 1:100 also fits. Returns null when the plan will not fit A0 at 1:200, which is
 * a plan whose scale is wrong rather than a plan that needs bigger paper.
 */
export function sheetFor({ widthFt, heightFt, marginMm = 12 }) {
  for (const denom of SCALES) {
    for (const [name, [shortMm, longMm]] of Object.entries(SHEETS)) {
      // mm on paper per foot of building, at 1:denom (1 ft = 304.8mm)
      const mmPerFt = 304.8 / denom;
      const needW = widthFt * mmPerFt, needH = heightFt * mmPerFt;
      for (const [pw, ph] of [[longMm, shortMm], [shortMm, longMm]]) {
        if (needW <= pw - marginMm * 2 && needH <= ph - marginMm * 2) {
          return { name, scale: denom, widthMm: pw, heightMm: ph,
                   landscape: pw > ph, marginMm };
        }
      }
    }
  }
  return null;
}

/**
 * The transform from plan pixels to PDF points.
 *
 * TWO FLIPS IN ONE FUNCTION, and they are the thing to get right. Plan pixels
 * run right and DOWN from the top-left; PDF points run right and UP from the
 * bottom-left. Everything else here is a scale and a centring offset.
 */
function placer({ planW, planH, boxX, boxY, boxW, boxH }) {
  const k = Math.min(boxW / planW, boxH / planH);
  const w = planW * k, h = planH * k;
  const ox = boxX + (boxW - w) / 2;
  const oy = boxY + (boxH - h) / 2;
  return {
    k, width: w, height: h, x: ox, y: oy,
    /** One point, plan pixels -> PDF points. */
    p: (pt) => ({ x: ox + pt.x * k, y: oy + h - pt.y * k }),
    /** A length, plan pixels -> points. */
    len: (n) => n * k,
  };
}

/**
 * A closed or open run of plan-pixel points, as lines.
 *
 * `dash` IS A PATTERN IN POINTS or null for a solid line. A dotted line is the
 * drawing convention for "this is behind something", which is what a strip and a
 * cove's setting-out line both are — tape in a pocket, and a line the plasterer
 * works to. The DXF says the same thing with a layer linetype; on a sheet there
 * are no layers to hang it on, so it rides with the call.
 */
function polyline(page, T, pts, thickness, closed, color = INK, dash = null) {
  if (!pts || pts.length < 2) return;
  const q = pts.map(T.p);
  const opts = dash ? { thickness, color, dashArray: dash } : { thickness, color };
  for (let i = 0; i < q.length - 1; i++) {
    page.drawLine({ start: q[i], end: q[i + 1], ...opts });
  }
  if (closed) page.drawLine({ start: q[q.length - 1], end: q[0], ...opts });
}

/**
 * A FILLED POLYGON IN PLAN PIXELS, built in PAGE SPACE.
 *
 * Not `drawSvgPath`, for the reason the spot's arrowhead gives: that takes SVG's
 * y-down convention under its own matrix, so the shape's sense depends on a flip
 * you have to get right by reasoning, and the numbers in the content stream are
 * not where the mark is. Three or four page-space points are exactly where the
 * mark is, and a wrong one is visible in the file.
 */
function fillPoly(page, T, pts, color) {
  if (!pts || pts.length < 3) return;
  const q = pts.map(T.p);
  page.pushOperators(
    pushGraphicsState(),
    setFillingRgbColor(color.red, color.green, color.blue),
    moveTo(q[0].x, q[0].y),
    ...q.slice(1).map((pt) => lineTo(pt.x, pt.y)),
    closePath(), fill(),
    popGraphicsState(),
  );
}

/** A fitting's ring, and the filled dot that means "this one emits". */
function lamp(page, T, at, rPx, { dot = true, color = INK } = {}) {
  const c = T.p(at);
  const r = Math.max(T.len(rPx), 1.1);
  page.drawCircle({ x: c.x, y: c.y, size: r, borderWidth: WEIGHT.fitting,
                    borderColor: color });
  // A MARK, NOT A MEASUREMENT — the same reasoning the DXF exporter gives for
  // capping a chandelier's dot: the ring carries the real dimension and the dot
  // only says the fitting is a light, so it is drawn at one size everywhere.
  if (dot) page.drawCircle({ x: c.x, y: c.y, size: Math.min(r * 0.42, 1.6), color });
}

/**
 * A CEILING FAN, DRAWN AS A CEILING FAN.
 *
 * WHAT THIS REPLACES, and why it was wrong. Every round object that was not a
 * chandelier got a circle with a cross through it — the same mark the DXF puts
 * on the obstacles layer, and there for a reason that does not survive the trip
 * to paper: in CAD the cross is a SNAP TARGET, the point a fan is set out from,
 * and a circle alone gives a drafter nothing to grab. A PDF is not snapped to.
 * So on the sheet the cross bought nothing and cost the only thing that
 * mattered, which is that somebody reading the drawing can tell at a glance what
 * the object is. A circle with a plus in it is the universal symbol for "a
 * circle with a plus in it".
 *
 * THE SYMBOL IS THE SCREEN'S. PlanCanvas draws a fan as a hub with three blades
 * radiating from it at 120°, first blade at 30° — see the `fansPx` block there —
 * and a plot that disagreed with the editor about what a fan looks like would be
 * the same failure this whole file exists to avoid. What is added on paper is
 * the SWEEP CIRCLE, which the canvas leaves out because the dashed ring it draws
 * is clearance, a working overlay. On a sheet the swept envelope is a real
 * dimension and worth having.
 *
 * NOTHING IS FILLED, AND THAT IS THIS FILE'S GRAMMAR RATHER THAN A STYLE CHOICE.
 * A solid mark means "this emits" — it is what `lamp()`'s dot says and the only
 * thing it says. A fan does not emit, so solid blades would quietly file it with
 * the downlights, and a hub drawn as a filled dot would read as a fitting at the
 * centre of one. Outlines throughout; the hub is a small ring, which still gives
 * the eye the centre without claiming to be a lamp.
 *
 * THE BLADES ARE TAPERED PADDLES, not strokes. A thick line is a stick and three
 * sticks in a circle is a hazard symbol; a paddle that widens from root to tip
 * is what a blade is, and it is four line segments.
 *
 * BUILT IN PAGE POINTS AND NOT IN PLAN PIXELS, which is the opposite of the rule
 * the AC cassette follows two blocks down — so it is worth saying why the
 * exception is safe. That rule exists because a rotation carried across the Y
 * flip comes out MIRRORED, and a mirrored cassette is a wrong drawing. A fan
 * with three blades symmetric about their own axes is not: mirroring maps the
 * set of angles {30°, 150°, 270°} onto {90°, 210°, 330°}, which is the same
 * symbol turned 60°. Building in points instead means the small-scale floor
 * below applies to the circle and the blades together, rather than to the circle
 * alone — which is how you get blades poking out of their own sweep on a plan
 * plotted very small.
 */
function fan(page, T, at, rPx, color = INK) {
  const c = T.p(at);
  // The floor is the same idea as `lamp()`'s: below a certain size a symbol
  // stops being a symbol, and a fan that has collapsed to a dot is worse than
  // one drawn slightly too big.
  const R = Math.max(T.len(rPx), 2.4);

  // The sweep, at the weight anything orderable gets.
  page.drawCircle({ x: c.x, y: c.y, size: R, borderWidth: WEIGHT.fitting,
                    borderColor: color });

  // A BLADE IS LONG AND NARROW, and the first pass had it neither: a stubby
  // paddle a third of the sweep wide reads as a radiation trefoil rather than as
  // a fan. Full width at the tip is 0.23R here, the root is barely wider than
  // the hub it grows out of, and the tip stops just short of the sweep — which
  // is also true of the real thing.
  const hub = Math.max(R * 0.13, 0.8);
  const root = hub, tip = R * 0.9;
  const wRoot = R * 0.042, wTip = R * 0.115;

  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + Math.PI / 6;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Along the blade by `d`, across it by `w`.
    const at2 = (d, w) => ({ x: c.x + ca * d - sa * w, y: c.y + sa * d + ca * w });
    const q = [at2(root, -wRoot), at2(tip, -wTip), at2(tip, wTip), at2(root, wRoot)];
    for (let i = 0; i < 4; i++) {
      page.drawLine({ start: q[i], end: q[(i + 1) % 4],
                      thickness: WEIGHT.setout, color });
    }
  }

  // The hub last, so it sits over the blade roots that run into it.
  page.drawCircle({ x: c.x, y: c.y, size: hub, borderWidth: WEIGHT.setout,
                    borderColor: color });
}

/**
 * PLOT THE DRAWING.
 *
 * The inputs mirror `toSuperluminalDXF` deliberately — see the header. `file` is
 * the ORIGINAL upload, and it is what makes the plan vector: a PDF is embedded
 * page-for-page, anything else falls back to the raster the editor is showing.
 *
 * Returns a Uint8Array of the finished PDF plus what it decided, so the caller
 * can say "A1 at 1:50" rather than handing over a file and hoping.
 */
export async function plotToPDF({
  source, pxPerFt, rooms = [], objects = [], accents = [], spots = [],
  coves = [],
  /* --- THE FITTINGS A HAND PUT DOWN, AND THEY WERE NOT ON THE SHEET --------
     THREE WHOLE POPULATIONS WERE MISSING FROM EVERY PDF. This function took the
     engine's layout (`rooms`), the ceiling objects, the accents and the spots —
     and nothing at all for the COBs somebody places one at a time, the arrays
     they set out on a geometry, or the magnetic track they draw and clip
     modules onto. Those are not a detail of the layout: they are the fittings a
     designer chose, they survive every re-grid, and on a plan laid out the way
     this app actually recommends (see `autoLights`, off by default) they are the
     ONLY lighting on the ceiling. So the export was reliably empty of the whole
     design and full of an engine grid the drawing was not even showing.
     `cobs` IS THE CANVAS'S OWN COMBINED LIST — the hand-placed lamps and every
     array's lamps together, because on the ceiling they are the same fitting.
     Draft entries are skipped: a bar that is still asking has not placed
     anything. See the `manualCobs` prop in App.jsx.
     ALREADY IN PLAN PIXELS, the contract every list here arrives under: this
     file plots geometry and does not compute it. They are held in FEET in the
     document, so it is the `*Px` projections that belong here and never the
     stores — a store hands this `undefined` coordinates and the marks vanish
     without a word. */
  cobs = [], tracks = [], trackModules = [],
  /* --- WHICH LAYERS ARE ON ------------------------------------------------
     THE SHEET IS WHAT THE DRAWING IS SHOWING, and until this existed the plot
     ignored the layer switches outright: it drew the engine's grid whether or
     not `autoLights` was on, and drew every accent and spot on a sheet whose
     author had switched them off. Both halves of that are wrong in the same
     way — the export is supposed to be the drawing, on paper.
     THE PREDICATES ARE THE CANVAS'S, TAKEN RATHER THAN RE-DERIVED — see
     `autoLights` and `spotIsPlaced` in PlanCanvas, which is where the
     interaction between `lights`, `autoLights`, `spots` and `suggestGrid` is
     actually decided. A second reading of those four flags is a second answer
     that can disagree with the screen.
     `null` MEANS DRAW WHAT YOU WERE GIVEN, which is the honest default for a
     plotter: a caller that has not mentioned layers has not asked for anything
     to be withheld. Every call site in the app passes the live set. */
  layers = null,
  file = null, pageNo = null, title = 'Lighting plan',
  marginMm = 12,
  /* NIGHT: THE PRESENTATION SHEET. Black paper, the plan inverted underneath,
     and the fittings drawn as the accent ramp glowing — which is what the
     editor's night view is for, on paper. `base` is what `nightBase` produced;
     without one the sheet still comes out (black, with the linework) rather
     than failing, because a missing base is a worse drawing and not a broken
     export. */
  night = false, base = null,
} = {}) {
  if (!source?.w || !source?.h) throw new Error('There is no drawing to plot.');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // --- the sheet ----------------------------------------------------------
  // The imported page's own size wins. `pageSizePt` is already in points, which
  // is the unit a PDF page is measured in, so there is no conversion and no
  // rounding: an A1 import comes back an A1 to the point.
  const imported = source.pageSizePt;
  let sheetNote = null;
  let pageW, pageH;
  if (imported?.w > 0 && imported?.h > 0) {
    pageW = imported.w; pageH = imported.h;
    sheetNote = `${Math.round(pageW / PT_PER_MM)} × ${Math.round(pageH / PT_PER_MM)} mm — as imported`;
  } else if (pxPerFt > 0) {
    const fit = sheetFor({ widthFt: source.w / pxPerFt, heightFt: source.h / pxPerFt, marginMm });
    const [wMm, hMm] = fit ? [fit.widthMm, fit.heightMm] : SHEETS.A1;
    pageW = wMm * PT_PER_MM; pageH = hMm * PT_PER_MM;
    sheetNote = fit ? `${fit.name} at 1:${fit.scale}` : 'A1 — the plan does not fit a named scale';
  } else {
    // No sheet and no scale: the plan's own proportions on A3, and the note says
    // so rather than printing a ratio nobody can rely on.
    const long = 420 * PT_PER_MM, short = 297 * PT_PER_MM;
    const wide = source.w >= source.h;
    pageW = wide ? long : short; pageH = wide ? short : long;
    sheetNote = 'A3 — no scale set, so this drawing is not to scale';
  }

  const page = doc.addPage([pageW, pageH]);
  /* ONE INK, EVERY MARK. `line` and the fittings' colour were two values and
     are one: see `inkFor`. `heatmap` comes off the layer set like every other
     switch this sheet obeys. */
  const heatmapOn = !!(layers || {}).heatmap;
  const ink = inkFor({ night, heatmap: heatmapOn });
  const line = ink;
  /* THE GROUND, which the reverse cove's tape is drawn in so it reads inside
     the fill. See `paperFor`. */
  const paper = paperFor({ night });

  // FULL BLEED, BEFORE ANYTHING ELSE. A night sheet's ground is the drawing's
  // ground: margins left white would frame the plan in a white border, which is
  // the one thing that would make it read as a screenshot.
  if (night) {
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: NIGHT_PAPER });
  }
  const m = marginMm * PT_PER_MM;
  // The title strip's height is taken off the bottom of the drawing area, so the
  // plan is never laid over its own annotation.
  const strip = 26;
  const T = placer({
    planW: source.w, planH: source.h,
    boxX: m, boxY: m + strip, boxW: pageW - m * 2, boxH: pageH - m * 2 - strip,
  });

  /* --- WHAT IS ON, AND IT IS THE CANVAS'S OWN ARITHMETIC -------------------
     `LAYER_DEFAULTS` is not merged over: a missing `layers` means "withhold
     nothing" (see the parameter), and that is a different answer from the
     defaults a fresh document opens with — where `autoLights` is OFF. Merging
     them would make a bare call silently drop the engine's grid. */
  const L = { lights: true, autoLights: true, suggestGrid: false,
              spots: true, accents: true, objects: true, ...(layers || {}) };
  /* THE ENGINE'S GRID. `lights` is the master over every fitting, `autoLights`
     narrows it to the layout the solver computed, and the suggested grid
     replaces it with dotted proposals — which are a way of LOOKING at a
     ceiling and not a fitting anybody has placed, so they are not plotted at
     all. PlanCanvas states this as one line and this is that line. */
  const showAuto = L.lights && L.autoLights && !L.suggestGrid;
  /* AND THE FITTINGS A HAND PUT DOWN ANSWER TO `lights` ALONE. They survive
     every re-grid and the solver's own switch has nothing to say about them. */
  const showPlaced = L.lights;
  /* A SPOT'S RULE IS THE ONE THAT IS NOT A PLAIN FLAG — `spotIsPlaced` in
     PlanCanvas, verbatim: while the grid is being SUGGESTED the placer's own
     spots are proposals and only a hand-placed one is a fitting. */
  const spotShows = (sp) => L.spots && (!L.suggestGrid || !!sp?.hand);

  /** Inches of real fitting -> plan pixels, which is the space every list here
   *  arrives in. The track modules are the only marks on this sheet quoted in
   *  inches; see TRACK_DIMS_IN. */
  const inchPx = (n) => ((pxPerFt > 0 ? pxPerFt : 12) / 12) * n;
  /** Feet -> plan pixels, for the symbol radii. */
  const ftPx = (n) => (pxPerFt > 0 ? pxPerFt : 12) * n;
  /* THE DOT PATTERN, IN POINTS, CONVERTED ONCE. Quoted in FEET so it is the
     same length of ink at every scale — a pattern stated in points would be
     three times as coarse on an A3 as on an A1 of the same plan. Floored, so a
     site plan at a coarse scale still dots rather than going solid. */
  const dotted = [DOT_FT, GAP_FT].map((ft) => Math.max(T.len(ftPx(ft)), 0.4));

  // --- the plan underneath ------------------------------------------------
  //
  // EMBEDDED, NOT RE-RENDERED. `embedPdf` copies the page's own content stream
  // and resources into this document, so what lands on the sheet is the original
  // drawing's vectors — not a picture of them at whatever resolution the editor
  // happened to rasterise for the screen (2400px on the long edge, which is 72
  // dpi on an A1 and the real reason the old print looked soft).
  let planIsVector = false;
  /* NIGHT TAKES THE INVERTED RASTER AND SAYS SO. There is no way to invert an
     embedded page's colours without a blend mode — see the note on `nightBase`
     for why that road is not taken — so the night sheet trades the vector plan
     for a re-rendered one at the sheet's own resolution. The day sheet keeps
     the vector. It is the one place the two modes genuinely differ in what they
     can promise, and the title strip reports which you got. */
  if (night && base?.dataUrl) {
    const img = await doc.embedPng(base.dataUrl);
    page.drawImage(img, { x: T.x, y: T.y, width: T.width, height: T.height });
  }
  const isPdfFile = !night && file && (file.type === 'application/pdf'
    || /\.pdf$/i.test(file.name || ''));
  if (isPdfFile) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const idx = Math.max(0, (pageNo ?? source.pageNo ?? 1) - 1);
      const [embedded] = await doc.embedPdf(bytes, [idx]);
      page.drawPage(embedded, { x: T.x, y: T.y, width: T.width, height: T.height });
      planIsVector = true;
    } catch (err) {
      // A page that will not embed — an encrypted file, a broken xref — must not
      // take the whole plot with it. The raster below is the same drawing at a
      // lower resolution, which is a worse sheet and not a missing one.
      console.warn('[plot] the original page could not be embedded', err);
    }
  }
  /* --- THE SAME FAULT ONE MODE OVER: A JPEG PLAN WAS NOT DRAWN EITHER -------
     THE TEST WAS `/png/i.test(source.mime || 'png')`, so a JPEG upload — which
     is what a photographed or scanned drawing usually is — failed it and the day
     sheet came out with the linework on blank paper. The `|| 'png'` is the tell:
     it was written to make a missing mime type pass, and a mime type that was
     present and not PNG then fell through with nothing to catch it.
     pdf-lib EMBEDS BOTH, so the format is a choice of call and not a
     capability. Wrapped, for the reason the page embed above is: a bitmap that
     will not embed must not take the whole plot with it. */
  if (!night && !planIsVector && source.base64) {
    try {
      const jpeg = /jpe?g/i.test(source.mime || '');
      const img = jpeg
        ? await doc.embedJpg(`data:image/jpeg;base64,${source.base64}`)
        : await doc.embedPng(`data:image/png;base64,${source.base64}`);
      page.drawImage(img, { x: T.x, y: T.y, width: T.width, height: T.height });
    } catch (err) {
      console.warn('[plot] the plan bitmap could not be embedded', err);
    }
  }

  // --- the linework, by trade, in the DXF's order -------------------------
  for (const r of rooms) polyline(page, T, r?.plan?.polygonPx, WEIGHT.outline, true, line);

  for (const o of L.objects ? objects : []) {
    /* --- A STANDING LAMP, AND IT WAS BEING PLOTTED AS A CEILING FAN ---------
       IT HAD NO BRANCH AT ALL, so it fell through to the `else` below — which
       this file's own note says is "the fan branch rather than a default", and
       warns that a fifth round kind "wants its own symbol here and not this
       one". A standing lamp is that fifth kind, and a plan came out with a fan
       drawn where somebody had put a floor lamp.
       THE SYMBOL IS THE SCREEN'S AND THE DXF'S, part for part: the shade as a
       circle, four strokes THROUGH its rim on the diagonals, and the lamp inside
       it as a small circle with a cross. Each mark is a different claim — see
       the standing-lamp branch in PlanCanvas — and the diagonals are what
       distinguish a thing standing on the floor from a pendant hanging off the
       ceiling, on a sheet where both are circles seen from above.
       AT THE OBJECT'S OWN SIZE. A standing lamp is resizable and its shade is a
       real dimension somebody set; drawing it at a fixed diameter would be the
       sheet contradicting the drawing it came from. The catalogue's default is a
       450 mm shade — see `standing_lamp` in ceilingObjects.js. */
    if (o.kind === 'standing_lamp') {
      const c = T.p(o);
      const R = T.len(o.r || 0);
      if (!(R > 0)) continue;
      page.drawCircle({ x: c.x, y: c.y, size: R * 0.86,
                        borderWidth: WEIGHT.fitting, borderColor: ink });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        const ux = Math.cos(a), uy = Math.sin(a);
        page.drawLine({
          start: { x: c.x + ux * R * 0.58, y: c.y + uy * R * 0.58 },
          end:   { x: c.x + ux * R * 1.34, y: c.y + uy * R * 1.34 },
          thickness: WEIGHT.fitting, color: ink });
      }
      const ri = R * 0.34;
      page.drawCircle({ x: c.x, y: c.y, size: ri,
                        borderWidth: WEIGHT.fitting, borderColor: ink });
      for (let k = 0; k < 2; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const ux = Math.cos(a) * ri, uy = Math.sin(a) * ri;
        page.drawLine({ start: { x: c.x - ux, y: c.y - uy },
                        end: { x: c.x + ux, y: c.y + uy },
                        thickness: WEIGHT.fitting, color: ink });
      }
      continue;
    }
    if (o.kind === 'chandelier') {
      // A chandelier emits, so on a night sheet it glows like the rest of them.
      // A DECORATIVE LAMP IS A LIGHT, so it takes the fitting ink rather than
      // the plan's linework. The fan and the two boxes below are ceiling
      // OBJECTS and keep the linework — a fan is not lit. See `inkFor`.
      lamp(page, T, o, o.r || 0, { color: ink });
      continue;
    }
    if (o.w > 0 && o.h > 0 && (o.kind === 'ac' || o.kind === 'trapdoor')) {
      // Rotated in PIXELS, corner by corner — the same rule the DXF exporter
      // states: an angle carried across a Y flip comes out mirrored, four
      // points cannot.
      const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
        const lx = (sx * o.w) / 2, ly = (sy * o.h) / 2;
        return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
      });
      polyline(page, T, pts, WEIGHT.fitting, true, line);
    } else {
      // EVERYTHING ROUND THAT IS NOT A CHANDELIER IS A FAN. The catalogue in
      // ceilingObjects.js has exactly four kinds and the three above are the
      // other three, so this is the fan branch rather than a default — and if a
      // fifth round kind is ever added, it wants its own symbol here and not
      // this one, because it will not be a fan.
      fan(page, T, o, o.r || 0, line);
    }
  }

  for (const r of rooms) {
    /* --- THE COVE'S SETTING-OUT LINE, AND IT WAS NOT PLOTTED ---------------
       THE ONE MARK A COVED CEILING LEAVES, MISSING FROM THE SHEET. `plan.covesPx`
       is the line the plasterer sets out to, and on a chunk whose cove carries
       the whole ambient load it is the only thing the design put on that piece
       of ceiling — the canvas says exactly this where it draws them. The tape
       reached the sheet (it is an accent run) and the pocket it sits in did not,
       so a reverse-coved room plotted as a bare line floating in a room.
       UNDER `accents`, WHICH IS THE SWITCH IT ANSWERS TO ON SCREEN: a cove is
       accent lighting, and its band and its tape go on and off together. */
    if (L.accents) {
      /* A COVE IS TWO DOTTED LINES: this one, and the tape. Both are concealed
         — the pocket is a line the plasterer works to and the strip sits inside
         it — and dotted is the drawing convention for a thing that is behind
         something. The tape arrives as an accent run and is dotted there, so
         between them a coved chunk reads as the pocket and the product in it
         rather than as one solid rectangle that could be anything. */
      for (const cv of r?.plan?.covesPx || []) {
        polyline(page, T, cv.line, WEIGHT.setout, true, ink, dotted);
      }
    }
    if (!showAuto) continue;
    for (const t of r?.plan?.tracksPx || []) {
      if (t.closed) polyline(page, T, t.runs.map((rn) => rn.a), WEIGHT.setout, true, line);
      else for (const rn of t.runs) polyline(page, T, [rn.a, rn.b], WEIGHT.setout, false, line);
    }
    for (const l of r?.plan?.lightsPx || []) {
      /* NO `l.r` FALLBACK ANY MORE, because a light has no `r`. The planner
         pushes `{id, kind, x, y, cells, ...}` and nothing else — see planner.js
         — so `l.r ||` was dead code in front of a guessed number, and the
         guessed number was what made the fittings the wrong size. The radius is
         SYMBOL_FT now, which is the DXF's. */
      const nar = (l.fixture || l.kind) === 'small-narrow' ? SYMBOL_FT.narrow : 1;
      const rFt = (l.kind === 'large' ? SYMBOL_FT.large : SYMBOL_FT.small) * nar;
      const rPx = (pxPerFt > 0 ? pxPerFt : 12) * rFt;
      lamp(page, T, l, rPx, { color: ink });
      /* THE BAR THROUGH A LARGE FITTING IS ITS ORIENTATION, NOT DECORATION, and
         it was missing. A large light sits ON a grid line rather than in a cell,
         and which line is the thing the layout decided — so the bar lies along
         that axis and runs past the ring, exactly as it does on the canvas and
         in the DXF. Without it the sheet cannot say which way a linear fitting
         runs, which is the one thing somebody setting it out needs. */
      if (l.kind === 'large') {
        const c = T.p(l);
        const bar = T.len(rPx * 1.7);
        page.drawLine({
          start: l.axis === 'v' ? { x: c.x, y: c.y - bar } : { x: c.x - bar, y: c.y },
          end:   l.axis === 'v' ? { x: c.x, y: c.y + bar } : { x: c.x + bar, y: c.y },
          thickness: WEIGHT.fitting, color: ink,
        });
      }
    }
  }

  for (const z of L.accents ? accents : []) {
    if (z?.rejected) continue;
    /* --- THE REVERSE COVE'S TAPE IS DRAWN WITH ITS SLOT, NOT HERE -----------
       IT WAS IN BOTH LISTS AND WAS BEING DRAWN TWICE. `projectAccentZonesPx`
       publishes a reverse cove's tape as an ordinary accent run so the schedule
       bills it by the metre, and `coves` carries the same run again with the
       slot it sits in. Two identical solid lines on top of each other was
       invisible; two DIFFERENT lines is not — the slot's tape is drawn in the
       paper's colour so it reads inside the fill, and an ink-coloured copy of it
       from this loop would sit on top and cancel that. One mark, drawn where the
       thing it belongs to is drawn. */
    if (z?.kind === 'reverse-cove') continue;
    if (z?.run?.length >= 2) {
      /* A STRIP IS LINEAR PRODUCT, so on a night sheet it takes the ramp ALONG
         its length — the same direction the canvas grades it, and the same
         reason: across a strip the ramp resolves over a fingernail of drawing
         and reads as a dirty edge. The band is a few points thick because a
         gradient needs an area to be painted into; the dotted line on top is
         what actually says where the tape is. */
      /* AND THE TAPE ITSELF IS A DOTTED LINE. Tape is never in the open — it is
         in a pocket, a slot, or under a shelf — and dotted is the drawing
         convention for a thing that is behind something. The DXF has said this
         from the beginning with a layer linetype (see `SL_LINETYPE`); the sheet
         said it with a continuous polyline, which on somebody else's drawing
         reads as a pipe or a setting-out line. */
      polyline(page, T, z.run, WEIGHT.fitting, false, ink, dotted);
      continue;
    }
    if (z?.rect) {
      const a = T.p({ x: z.rect.x0, y: z.rect.y1 });   // y1 is the lower edge in plan px
      const w = T.len(z.rect.x1 - z.rect.x0), h = T.len(z.rect.y1 - z.rect.y0);
      page.drawRectangle({ x: a.x, y: a.y, width: w, height: h,
                           borderWidth: WEIGHT.fitting, borderColor: ink });
    }
  }

  // A reverse cove is a band with a tape down it: the band is what the plasterer
  // builds and the tape is what gets ordered, so both are drawn — the band at
  // setting-out weight, the run at fitting weight.
  /* --- A REVERSE COVE IS A FILLED SLOT WITH A STRIP DOWN IT ----------------
     IT WAS AN OUTLINE, AND AN OUTLINE IS THE WRONG CLAIM. A reverse cove is a
     slot CUT INTO the ceiling — eight inches of it, the one mark on this sheet
     with a real width — and a hairline rectangle says "a line here" where the
     drawing means "this much ceiling is gone". Filled solid in the fitting's own
     ink, so on a day sheet it is a black slot and on a night sheet a white one.
     AND THE TAPE INSIDE IT IS DRAWN IN THE PAPER'S COLOUR, which is the only way
     it can be read at all: a strip in the same ink as the fill it sits inside is
     a strip that is not on the drawing. So the slot is ink and the product in it
     is the ground showing through — dotted, like every other run of tape. */
  for (const c of L.accents ? coves : []) {
    if (c?.band?.length >= 3) {
      /* A hand-placed slot follows the wall, so its four real corners win over
         the axis-aligned bounding box. The screen and DXF use the same polygon;
         a plotted diagonal cove must not turn back into a large rectangle. */
      fillPoly(page, T, c.band, ink);
    } else if (c?.rect) {
      const a = T.p({ x: c.rect.x0, y: c.rect.y1 });
      const w = T.len(c.rect.x1 - c.rect.x0), h = T.len(c.rect.y1 - c.rect.y0);
      // The ramp still runs along the slot the way the light does, under the
      // fill, so a night sheet keeps the gradient that makes it a night sheet.
      page.drawRectangle({ x: a.x, y: a.y, width: w, height: h, color: ink });
    }
    if (c?.run?.length >= 2) {
      polyline(page, T, c.run, WEIGHT.fitting, false, paper, dotted);
    }
  }

  for (const sp of spots) {
    if (!spotShows(sp)) continue;
    /* --- A SPOT WITH NOWHERE TO BE IS NOT ON THE SHEET, AND `rejected` IS NOT
       THE WHOLE OF THAT. It was the only test here, and it let through the
       other kind of position-less record — which crashed the export outright:
       "`options.x` must be of type `number`, but was actually of type `NaN`".
       `projectTaskSpotsPx` emits ONE ENTRY PER TASK SURFACE whether or not the
       placer found somewhere to stand, because the panel has to be able to say
       why a surface got nothing. A refusal carries `rejected`; a surface the
       placer SKIPPED carries `skipped` and no reason — and neither carries an
       `x`. So one skipped surface anywhere in the plan reached `lamp`, `T.p`
       turned undefined into NaN, and pdf-lib — which validates, where SVG
       silently ignores a bad attribute — threw and took the whole download
       with it. A refused fitting is not on the sheet and neither is one that
       was never placed; what they have in common is the position, so that is
       what is tested.
       `Number.isFinite` AND NOT `!= null`, and the difference is real: a record
       can arrive holding NaN rather than nothing, and NaN is not null.
       THE SAME EXPRESSION THE TITLE STRIP ALREADY COUNTS BY — see `lamps` at
       the foot of this function, which has always had the position test. Its
       own note says it is "counted off the same gates that drew them", and the
       gate that DREW them was one condition short of the one that counted. */
    if (sp.rejected || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
    const rPx = (pxPerFt > 0 ? pxPerFt : 12) * SYMBOL_FT.spot;
    lamp(page, T, sp, rPx, { color: ink });

    /* THE AIM, AND IT WAS NOT DRAWING AT ALL. I read the direction off
       `sp.aimAt`, which no spot has: the planner gives every directional
       fitting `sp.target` (the point it lights) and `sp.angle` (the same thing
       as a bearing). So the condition was never true and the arrow was silently
       absent from every sheet — the drawing said "downlight" about a fitting
       whose whole point is that it is aimed.
       A TAIL TO A FIXED LENGTH, then a head. The length and the standoff are the
       DXF's, for its stated reason — a tail that reaches the surface reads as a
       line to somewhere rather than as an aim. The DXF stops there because a CAD
       reader infers direction from the layer and the geometry; a PDF is read by
       eye, so this one gets an actual arrowhead. */
    const to = sp.target ? T.p(sp.target) : null;
    const dir = to
      ? (() => { const c = T.p(sp); const dx = to.x - c.x, dy = to.y - c.y;
                 const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; })()
      : (Number.isFinite(sp.angle)
          // The canvas's own reading: `angle` is measured in PLAN space, where y
          // runs down, so its sine flips on the way onto a page where y runs up.
          ? { x: Math.cos(sp.angle), y: -Math.sin(sp.angle) }
          : null);
    if (dir) {
      const c = T.p(sp);
      const s0 = T.len((pxPerFt > 0 ? pxPerFt : 12) * AIM_FT.start);
      const s1 = T.len((pxPerFt > 0 ? pxPerFt : 12) * AIM_FT.reach);
      const a = { x: c.x + dir.x * s0, y: c.y + dir.y * s0 };
      const b = { x: c.x + dir.x * s1, y: c.y + dir.y * s1 };
      page.drawLine({ start: a, end: b, thickness: WEIGHT.fitting, color: ink });
      /* A FILLED HEAD, BUILT IN PAGE SPACE — not with `drawSvgPath`.
         `drawSvgPath` was the first attempt and it is the wrong tool twice
         over. It takes SVG's y-down convention and lays the path under its own
         translate/scale matrix, so the arrow's sense depends on a flip you have
         to get right by reasoning; and because the emitted coordinates are
         local to that matrix, there is no way to check the result by reading the
         file — the numbers in the stream are not where the mark is. Three
         page-space points, on the other hand, are exactly where the mark is, and
         a wrong one is visible in the content stream.
         Two thirds of the standoff long, because at hairline weight an open V
         disappears and a solid head is what reads. */
      const hl = Math.max(s0 * AIM_FT.headFrac, 2), hw = hl * AIM_FT.headWideFrac;
      const n = { x: -dir.y, y: dir.x };            // the aim's left normal
      const back = { x: b.x - dir.x * hl, y: b.y - dir.y * hl };
      /* THE HEAD IS FILLED IN THE FITTING'S INK — it used to re-derive the
         night linework's grey here, which is now the PLAN's colour and not the
         spot's. One source for the answer, so the arrow cannot come out a
         different colour from the fitting it belongs to. */
      const [rr, gg, bb] = [ink.red, ink.green, ink.blue];
      page.pushOperators(
        pushGraphicsState(),
        setFillingRgbColor(rr, gg, bb),
        moveTo(b.x, b.y),                            // the tip, on the tail's end
        lineTo(back.x + n.x * hw, back.y + n.y * hw),
        lineTo(back.x - n.x * hw, back.y - n.y * hw),
        closePath(), fill(),
        popGraphicsState(),
      );
    }
  }

  /* --- THE MAGNETIC TRACK SOMEBODY DREW, AND WHAT IS CLIPPED ONTO IT -------
     NOT `plan.tracksPx`, WHICH IS A DIFFERENT OBJECT, and the two are easy to
     conflate because both are called a track. That list is the ABSORBING track
     — what the ceiling design made of a chunk, rebuilt every time a fan moves —
     and it answers to the solver's switch above. This is a profile a person drew
     and modules they clipped on, which is the same relationship `cobs` has to
     the ambient grid: it survives every re-grid, and it answers to `lights`.
     THE CARRIER AT SETTING-OUT WEIGHT, because that is what it is: a rail
     screwed to the slab, which the fittings are ordered against separately. Same
     weight the absorbing rail is plotted at, so one track does not read heavier
     than another for having been drawn by hand. */
  if (showPlaced) {
    for (const t of tracks) {
      if (!(t?.pts?.length >= 2)) continue;
      /* THE CARRIER STAYS ON THE PLAN'S LINEWORK and does not take the
         fitting's ink, which is the same call the DXF makes by putting it on its
         own layer: a profile is a rail screwed to the slab, set out and fixed
         before any head goes near it. It is not a light. What clips into it
         is. */
      polyline(page, T, t.pts, WEIGHT.setout, !!t.closed, line);
    }
    /* A MODULE IS A BODY LYING ALONG THE PROFILE, drawn to its real size — six
       inches for a spot, up to twenty-four for a diffuser (see
       `DIFFUSER_LENGTHS_MM`). `ux`/`uy` is which way the run is heading there,
       and without it every module on a vertical run comes out ACROSS the rail it
       clips into: a fitting that could not be installed. Rotated corner by
       corner in PIXELS rather than by an angle, the rule this file already
       states for the AC units — an angle carried across a Y flip comes out
       mirrored, four points cannot.
       THE BODY AND NOT THE CANVAS'S CIRCLE FOR A SPOT MODULE, and it is the one
       place this sheet departs from the screen on purpose. On screen a spot
       module is a disc because the eye needs a lamp there; on a plot it is six
       measurable inches of profile, which is what an installer sets out and what
       the DXF already draws on its own track-fixtures layer. A PDF and a DXF of
       one plan that disagreed about a fitting would be worse than either being
       wrong — see the head of this file. */
    for (const m of trackModules) {
      if (!Number.isFinite(m?.x) || !Number.isFinite(m?.y)) continue;
      /* --- A DIFFUSER IS A BODY; AN AIMED HEAD IS A LAMP ---------------------
         THE TWO MODULES ARE TWO DIFFERENT DRAWINGS, and the last revision drew
         both as bodies, which was right about the diffuser and wrong about the
         spot. A diffuser IS a long sleek rectangle — 200 to 600 mm of extrusion
         lying along the rail — and that is what it is on screen and what an
         installer measures. A track spot is a head on a gimbal: it is the same
         fitting as a recessed COB with the ceiling taken away, so it gets the
         COB's symbol, which is what the screen draws for it too.
         NO ARROW ON IT, and that is not an omission. A directional spot carries
         an aim this drawing can state because the second click stored one; a
         track head is aimed on site by hand and the drawing knows no angle for
         it. An arrow here would be the sheet inventing a direction. */
      if (m.kind === 'diffuser') {
        const along = inchPx(m?.lenIn ?? TRACK_DIMS_IN.head.len);
        const across = inchPx(m?.wideIn ?? TRACK_DIMS_IN.head.wide);
        if (!(along > 0) || !(across > 0)) continue;
        const ux = Number.isFinite(m.ux) ? m.ux : 1;
        const uy = Number.isFinite(m.uy) ? m.uy : 0;
        const n = Math.hypot(ux, uy) || 1;
        const cx = ux / n, cy = uy / n;
        /* Rotated corner by corner in PIXELS — the rule this file states for the
           AC units: an angle carried across a Y flip comes out mirrored, four
           points cannot. Without the run's direction every module on a vertical
           rail is drawn ACROSS the rail it clips into. */
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
          const lx = (sx * along) / 2, ly = (sy * across) / 2;
          return { x: m.x + lx * cx - ly * cy, y: m.y + lx * cy + ly * cx };
        });
        polyline(page, T, pts, WEIGHT.fitting, true, ink);
        continue;
      }
      lamp(page, T, m, ftPx(SYMBOL_FT.cob), { color: ink });
    }
  }

  /* --- AND THE LAMPS SOMEBODY PLACED ONE AT A TIME -------------------------
     LAST OF THE FITTINGS, so a hand-placed lamp over an engine cell reads on
     top of it rather than under — the canvas's own stacking, and the honest one:
     what a person placed is the design and what the solver proposed is the
     background it was designed against.
     A DRAFT IS NOT A FITTING. The array bar's preview rides in the canvas's
     list so that what you watch move is what the tick will keep; nothing has
     been placed until it is ticked, and a sheet that plotted the preview would
     bill a run nobody committed to. */
  if (showPlaced) {
    for (const c of cobs) {
      if (c?.draft || !Number.isFinite(c?.x) || !Number.isFinite(c?.y)) continue;
      const rPx = ftPx(SYMBOL_FT.cob);
      lamp(page, T, c, rPx, { color: ink });
    }
  }

  // --- the title strip ----------------------------------------------------
  //
  // WHAT A DRAWING HAS TO CARRY TO BE ONE. A sheet with no scale on it is a
  // picture: the first thing anybody does with a plan is measure something off
  // it, and they cannot without this line. The count is here for the same
  // reason a schedule has a total — it is the check that the sheet and the
  // schedule are of the same design.
  /* EVERY FITTING THAT IS ACTUALLY ON THIS SHEET, and it used to be the
     engine's grid alone. That made the count a lie in exactly the case the app
     recommends: a ceiling laid out entirely by hand reported "0 fittings" under
     a drawing full of them, and a sheet with the solver's grid switched off
     reported a number for marks it had not drawn. The check the count exists to
     support — that the sheet and the schedule are of the same design — cannot be
     made with either.
     COUNTED OFF THE SAME GATES THAT DREW THEM, so the figure can only ever
     describe what is on the paper. */
  const lamps = (showAuto
      ? rooms.reduce((n, r) => n + (r?.plan?.lightsPx?.length || 0), 0) : 0)
    + (showPlaced ? cobs.filter((c) => !c?.draft
        && Number.isFinite(c?.x) && Number.isFinite(c?.y)).length : 0)
    + (showPlaced ? trackModules.filter((m) => Number.isFinite(m?.x)).length : 0)
    + spots.filter((sp) => spotShows(sp) && !sp?.rejected
        && Number.isFinite(sp?.x)).length;
  const bits = [title, sheetNote];
  if (pxPerFt > 0) bits.push(`${(source.w / pxPerFt).toFixed(1)} × ${(source.h / pxPerFt).toFixed(1)} ft`);
  bits.push(`${lamps} fitting${lamps === 1 ? '' : 's'}`);
  bits.push(night
    ? (base ? `night · plan at ${Math.round(base.w)}px` : 'night · no plan image')
    : (planIsVector ? 'plan embedded as vector' : 'plan embedded as image'));
  page.drawText(bits.filter(Boolean).join('   ·   '), {
    x: m, y: m + 8, size: 7, font, color: line,
  });

  return {
    bytes: await doc.save({ useObjectStreams: false }),
    sheetNote, planIsVector,
    pageMm: { w: pageW / PT_PER_MM, h: pageH / PT_PER_MM },
  };
}
