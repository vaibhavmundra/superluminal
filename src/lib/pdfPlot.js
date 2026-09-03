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

import { PDFDocument, StandardFonts, rgb, PDFName, PDFOperator,
         moveTo, lineTo, appendBezierCurve, closePath, clipEvenOdd, endPath,
         pushGraphicsState, popGraphicsState, setGraphicsState,
         setFillingRgbColor, fill } from 'pdf-lib';
import { THROW_STYLE } from './settings.js';

/* --- TRUE VECTOR GRADIENTS, AND WHY THEY ARE WORTH THE PLUMBING -----------
   A night plan is a presentation drawing: the plan goes dark and the fittings
   glow, and the glow IS the drawing rather than an embellishment of it. Faking
   it with a rasterised overlay would be the softness problem back again — the
   whole reason we stopped printing the screen.
   PDF has had exactly what is needed since 1.3: axial (ShadingType 2) and
   radial (ShadingType 3) shadings, which map one-to-one onto SVG's
   linearGradient and radialGradient, painted with the `sh` operator inside a
   clip. pdf-lib has no API for them, but it does expose the object graph and
   the content stream, which is all this takes.
   MULTI-STOP RAMPS NEED A STITCHING FUNCTION. A Type 2 function interpolates
   between TWO colours; the accent ramp has five stops, so it is a Type 3
   function stitching four Type 2 pieces end to end. That is why `ramp()` exists
   rather than a single call.
   INSPECTING THE RESULT NEEDS `useObjectStreams: false` — with object streams on
   (pdf-lib's default) every dictionary is inside a compressed stream, and a
   shading that is definitely there looks absent. It cost me one wrong
   conclusion; the save below turns them off so the file stays greppable, at a
   few percent of size. */

/** '#rrggbb' -> [r, g, b] in 0..1, which is what a PDF colour array wants. */
const hex01 = (h) => {
  const v = parseInt(String(h).replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/** The accent ramp as offsets and colours, read from the one place it is authored. */
const RAMP = THROW_STYLE.stops.map((s) => ({
  at: parseFloat(s.at) / 100, c: hex01(s.color),
}));

/**
 * A stitching function over a list of stops. Registered and returned as a ref.
 *
 * Two stops is a plain Type 2 and needs no stitching; more than two becomes a
 * Type 3 whose `Bounds` are the interior stop offsets and whose `Encode` runs
 * each piece over its full 0..1 domain.
 */
function ramp(ctx, stops) {
  if (stops.length === 2) {
    return ctx.register(ctx.obj({
      FunctionType: 2, Domain: [0, 1], C0: stops[0].c, C1: stops[1].c, N: 1,
    }));
  }
  return ctx.register(ctx.obj({
    FunctionType: 3, Domain: [0, 1],
    Functions: stops.slice(0, -1).map((s, i) => ctx.obj({
      FunctionType: 2, Domain: [0, 1], C0: s.c, C1: stops[i + 1].c, N: 1,
    })),
    Bounds: stops.slice(1, -1).map((s) => s.at),
    Encode: stops.slice(0, -1).flatMap(() => [0, 1]),
  }));
}

/** Put a shading in the page's resources and hand back the name to paint it by. */
function shading(doc, page, dict) {
  const ctx = doc.context;
  const res = page.node.Resources();
  let all = res.lookup(PDFName.of('Shading'));
  if (!all) { all = ctx.obj({}); res.set(PDFName.of('Shading'), all); }
  const name = PDFName.of(`Sh${(shading.n = (shading.n || 0) + 1)}`);
  all.set(name, ctx.register(ctx.obj(dict)));
  return name;
}

/* A circle as four beziers. `sh` paints a region, so a round gradient needs a
   round CLIP — there is no "draw a circle with a gradient fill" operator.
   0.5523 is the usual kappa: the control-point distance that makes a cubic
   match a quarter arc to within a thousandth of the radius. */
/* BUILT WITH pdf-lib's OWN `moveTo`/`lineTo`/`appendBezierCurve` AND NOT WITH
   `PDFOperator.of(Ops.MoveTo, [x, y])`, WHICH IS THE TRAP I FELL INTO.
   An operator's arguments have to be PDF OBJECTS — pdf-lib's own `moveTo` wraps
   each number in `asPDFNumber` — and raw JS numbers do not fail loudly. They
   have no `sizeInBytes`, so the content stream's length comes out wrong and the
   whole stream is written EMPTY: no clip, no shading, and no black paper or
   linework either, because they shared the stream. The file still saved, still
   reloaded and still had every shading dictionary correctly registered in the
   page's resources, which is exactly what made it look like a gradient problem.
   It was an operator-argument problem, and the fix is to stop hand-rolling
   operators that the library already exports. */
const K = 0.5522847498;
function clipCircle(cx, cy, r) {
  const k = r * K;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
    closePath(),
  ];
}

const clipRect = (x, y, w, h) => [
  moveTo(x, y), lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h), closePath(),
];

/** Paint a registered shading through a clip, at an opacity, and restore. */
function paintShading(doc, page, clipOps, name, alpha) {
  const ops = [pushGraphicsState()];
  if (alpha != null && alpha < 1) {
    // `newExtGState` is the library's own way in, so the resources dictionary is
    // reached the way pdf-lib expects rather than mutated behind its back.
    const gn = page.node.newExtGState('Gs', doc.context.obj({
      Type: 'ExtGState', ca: alpha, CA: alpha,
    }));
    ops.push(setGraphicsState(gn));
  }
  // `sh` has no helper — it is the one operator here built by hand, and it is
  // safe because its single argument is already a PDFName.
  ops.push(...clipOps, clipEvenOdd(), endPath(),
           PDFOperator.of('sh', [name]), popGraphicsState());
  page.pushOperators(...ops);
}

/** A round glow: the accent ramp from a fitting outwards, as a radial shading. */
function glow(doc, page, cx, cy, r, alpha) {
  if (!(r > 0)) return;
  const name = shading(doc, page, {
    ShadingType: 3, ColorSpace: PDFName.of('DeviceRGB'),
    Coords: [cx, cy, 0, cx, cy, r],
    Function: ramp(doc.context, RAMP), Extend: [false, false],
  });
  paintShading(doc, page, clipCircle(cx, cy, r), name, alpha);
}

/**
 * A ramp along a two-point run, given a thickness in points.
 *
 * AXIS-ALIGNED RUNS GET AN AXIS-ALIGNED BAND, and a diagonal one gets its
 * bounding box. A rotated clip would need a `cm` transform around the shading
 * and its coordinates, which is real work for a case this app barely produces —
 * strips and coves are set out along walls. A diagonal strip therefore gets a
 * slightly generous glow rather than a wrong one, and the hairline on top is
 * still exactly where the tape is.
 */
function rampAlongRun(doc, page, T, run, thickPt, alpha) {
  const a = T.p(run[0]), b = T.p(run[run.length - 1]);
  const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const w = Math.max(Math.abs(b.x - a.x), horiz ? 0 : thickPt);
  const h = Math.max(Math.abs(b.y - a.y), horiz ? thickPt : 0);
  band(doc, page, {
    x: horiz ? x : x - thickPt / 2, y: horiz ? y - thickPt / 2 : y,
    w, h, along: horiz ? 'x' : 'y',
  }, alpha);
}

/** A band of ramp along a run: an axial shading, clipped to the band. */
function band(doc, page, { x, y, w, h, along = 'x' }, alpha) {
  if (!(w > 0) || !(h > 0)) return;
  const name = shading(doc, page, {
    ShadingType: 2, ColorSpace: PDFName.of('DeviceRGB'),
    Coords: along === 'x' ? [x, y, x + w, y] : [x, y, x, y + h],
    Function: ramp(doc.context, RAMP), Extend: [true, true],
  });
  paintShading(doc, page, clipRect(x, y, w, h), name, alpha);
}

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
/* THE NIGHT SHEET'S TWO INKS. Paper goes to `--bg`, and the line work goes to a
   dim warm grey rather than white: on black, white hairlines read as brighter
   than the fittings, and the fittings are the subject. Same judgment PlanCanvas
   makes on the inverted ground — the plan is the ground, the lights are the
   figure. Literals because this file shares no stylesheet with the app. */
const NIGHT_PAPER = rgb(0, 0, 0);
const NIGHT_LINE = rgb(0.42, 0.40, 0.37);

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
export async function nightBase(openPdf, file, pageNo, { maxPixels = 16e6 } = {}) {
  if (!file) return null;
  const doc = await openPdf(file);
  try {
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
  } finally {
    doc.destroy?.();
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
export const SYMBOL_FT = { small: 0.29, large: 0.5, narrow: 0.8, spot: 0.3 };

/**
 * HOW FAR THE NIGHT GLOW REACHES, as a multiple of the symbol.
 *
 * It was 2.6 — the canvas's own figure — and on paper that was wrong for a
 * reason the screen hides. On screen the pool is a soft breathing wash at a
 * tenth opacity over a plan you are scrolling around; on an A1 it is a 5mm ball
 * of ink per lamp, forty of them, and the fitting inside it stops being
 * findable. The lamp read as enormous, which is exactly what it was.
 *
 * 1.5 keeps the gradient — the thing that makes a night sheet a night sheet —
 * while leaving the SYMBOL as the mark that says where the fitting is. One
 * number, here, if it wants to bloom more.
 */
export const GLOW_REACH = 1.5;

/**
 * THE AIM TAIL, in feet: where it starts (clear of the body) and how far it
 * runs. Both from exporters.js, and the reasoning there is worth keeping: the
 * tail is drawn to a FIXED length rather than all the way to what it lights,
 * because a line that reaches the surface reads as a line to somewhere else.
 */
export const AIM_FT = { start: 0.42, reach: 1.2 };

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

/** A closed or open run of plan-pixel points, as lines. */
function polyline(page, T, pts, thickness, closed, color = INK) {
  if (!pts || pts.length < 2) return;
  const q = pts.map(T.p);
  for (let i = 0; i < q.length - 1; i++) {
    page.drawLine({ start: q[i], end: q[i + 1], thickness, color });
  }
  if (closed) page.drawLine({ start: q[q.length - 1], end: q[0], thickness, color });
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
  coves = [], file = null, pageNo = null, title = 'Lighting plan',
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
  const line = night ? NIGHT_LINE : INK;
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
  if (!night && !planIsVector && source.base64 && /png/i.test(source.mime || 'png')) {
    const img = await doc.embedPng(`data:image/png;base64,${source.base64}`);
    page.drawImage(img, { x: T.x, y: T.y, width: T.width, height: T.height });
  }

  // --- the linework, by trade, in the DXF's order -------------------------
  for (const r of rooms) polyline(page, T, r?.plan?.polygonPx, WEIGHT.outline, true, line);

  for (const o of objects) {
    if (o.kind === 'chandelier') {
      // A chandelier emits, so on a night sheet it glows like the rest of them.
      if (night) {
        const c = T.p(o);
        glow(doc, page, c.x, c.y, Math.max(T.len((o.r || 0) * 2.6), 3), 0.55);
      }
      lamp(page, T, o, o.r || 0, { color: line });
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
      if (night) {
        const c = T.p(l);
        glow(doc, page, c.x, c.y, Math.max(T.len(rPx * GLOW_REACH), 2), 0.5);
      }
      lamp(page, T, l, rPx, { color: line });
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
          thickness: WEIGHT.fitting, color: line,
        });
      }
    }
  }

  for (const z of accents) {
    if (z?.rejected) continue;
    if (z?.run?.length >= 2) {
      /* A STRIP IS LINEAR PRODUCT, so on a night sheet it takes the ramp ALONG
         its length — the same direction the canvas grades it, and the same
         reason: across a strip the ramp resolves over a fingernail of drawing
         and reads as a dirty edge. The band is a few points thick because a
         gradient needs an area to be painted into; the hairline on top is what
         actually says where the tape is. */
      if (night) rampAlongRun(doc, page, T, z.run, 2.4, 0.7);
      polyline(page, T, z.run, WEIGHT.fitting, false, line);
      continue;
    }
    if (z?.rect) {
      const a = T.p({ x: z.rect.x0, y: z.rect.y1 });   // y1 is the lower edge in plan px
      const w = T.len(z.rect.x1 - z.rect.x0), h = T.len(z.rect.y1 - z.rect.y0);
      if (night) band(doc, page, { x: a.x, y: a.y, w, h, along: w >= h ? 'x' : 'y' }, 0.7);
      page.drawRectangle({ x: a.x, y: a.y, width: w, height: h,
                           borderWidth: WEIGHT.fitting, borderColor: line });
    }
  }

  // A reverse cove is a band with a tape down it: the band is what the plasterer
  // builds and the tape is what gets ordered, so both are drawn — the band at
  // setting-out weight, the run at fitting weight.
  for (const c of coves) {
    if (c?.rect) {
      const a = T.p({ x: c.rect.x0, y: c.rect.y1 });
      const w = T.len(c.rect.x1 - c.rect.x0), h = T.len(c.rect.y1 - c.rect.y0);
      // THE SLOT IS THE ONE MARK ON THIS SHEET WITH A REAL WIDTH — eight inches
      // of ceiling — so its band is the rect itself rather than an invented
      // thickness, and the ramp runs along the slot the way the light does.
      if (night) band(doc, page, { x: a.x, y: a.y, w, h, along: w >= h ? 'x' : 'y' }, 0.8);
      page.drawRectangle({ x: a.x, y: a.y, width: w, height: h,
                           borderWidth: WEIGHT.setout, borderColor: line });
    }
    if (c?.run?.length >= 2) polyline(page, T, c.run, WEIGHT.fitting, false, line);
  }

  for (const sp of spots) {
    // A REFUSED FITTING IS NOT ON THE SHEET. The canvas returns null for these
    // and the DXF skips them; a plot that drew them would show fittings the
    // placer declined to place.
    if (sp.rejected) continue;
    const rPx = (pxPerFt > 0 ? pxPerFt : 12) * SYMBOL_FT.spot;
    if (night) {
      const c = T.p(sp);
      glow(doc, page, c.x, c.y, Math.max(T.len(rPx * GLOW_REACH), 2), 0.5);
    }
    lamp(page, T, sp, rPx, { color: line });

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
      page.drawLine({ start: a, end: b, thickness: WEIGHT.fitting, color: line });
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
      const hl = Math.max(s0 * 0.66, 2), hw = hl * 0.42;
      const n = { x: -dir.y, y: dir.x };            // the aim's left normal
      const back = { x: b.x - dir.x * hl, y: b.y - dir.y * hl };
      const [rr, gg, bb] = [0, 0, 0].map((_, i) => (night ? [0.42, 0.40, 0.37][i] : 0));
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

  // --- the title strip ----------------------------------------------------
  //
  // WHAT A DRAWING HAS TO CARRY TO BE ONE. A sheet with no scale on it is a
  // picture: the first thing anybody does with a plan is measure something off
  // it, and they cannot without this line. The count is here for the same
  // reason a schedule has a total — it is the check that the sheet and the
  // schedule are of the same design.
  const lamps = rooms.reduce((n, r) => n + (r?.plan?.lightsPx?.length || 0), 0);
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
