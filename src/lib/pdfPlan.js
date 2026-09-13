// ---------------------------------------------------------------------------
// pdfPlan.js — a PDF becomes a raster, and then it is an image like any other.
//
// WHY RENDER RATHER THAN READ THE VECTORS. A PDF is vector data, and it is
// tempting to pull the line work out and skip the detector entirely. That is a
// trap: a PDF's paths are a picture that happens to be made of strokes — a wall
// is two strokes, a dimension line is two strokes, a hatch is four hundred
// strokes, and the SHAPE of a stroke does not say which it is. Reading the paths
// would give us a worse image than rendering the page does, with a parser to
// maintain for the privilege.
//
// So we rasterise, and the entire raster pipeline — the room segmenter, the
// furniture pass, the door detector — applies unchanged. A PDF plan and a
// photographed plan are the same problem, and one of them happens to have
// perfectly crisp lines.
//
// WHAT A PDF DOES CARRY, and this file used to say it carried neither:
//
//   TEXT.    Every string with its own matrix. `3500` sits at an exact position,
//            not a guessed one — see `textRuns` below, and the feature that
//            reads a scale off it in features/dimension-intelligence.
//   LAYERS.  A CAD export keeps its optional content groups, names and all:
//            the sample sheet in this repo declares `KMBD Walls`, `KMBD Doors
//            and Windows`, `KMBD Hatch` and a dozen more. `layerNames` returns
//            them. Nothing consumes them yet.
//
// Neither changes the decision above — both are ANNOTATIONS on the raster
// rather than a replacement for it.
//
// WHAT IT STILL DOES NOT CARRY IS UNITS. A page states its size in points, which
// is the size of the PAPER and says nothing about what the drawing represents:
// an A1 at 1:50 and the same sheet at 1:100 are identical files as far as the
// page box is concerned. So a plan that does not dimension itself goes through
// the same door measurement as an image. Inferring feet from paper size would be
// a plausible number that is wrong, which is the worst kind.
//
// THE WORKER IS BUNDLED, not fetched from a CDN. pdf.js does its parsing off the
// main thread and needs its worker script; letting it default would either block
// the UI or reach for a version-matched file on the network, and this app is
// meant to work on a site-office laptop with no connection at all.
// ---------------------------------------------------------------------------

import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
/* NOT pdf.js's own getTextContent — it is unusable in Safari. The whole of
   why is in pdfText.js, which is where it can be tested. */
import { textContentOf } from './pdfText.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * How big to render. The long edge, in pixels.
 *
 * NOT AS BIG AS POSSIBLE. Every detector downscales its input anyway (see
 * snapshotForDetection), the canvas is held in memory as an ImageBitmap, and a
 * 6000px render of an A0 sheet is 140MB of RGBA for no additional line detail —
 * the strokes are already sub-pixel crisp at a quarter of that. 2400 is comfortably
 * above what the models see and well below what a laptop notices.
 */
const LONG_EDGE = 2400;

/** A page's natural size in CSS pixels at 1:1 (72dpi), for choosing a scale. */
const pageSize = (page) => {
  const v = page.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
};

/**
 * Open a PDF and keep it open. The document is held rather than closed after the
 * first render because the page picker needs thumbnails of every page and the
 * chosen page then needs a full render — three passes over one parse.
 *
 * Returns { pages, render, thumb, destroy }.
 */
export async function openPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({
    data: bytes,
    // A floor plan is line work. Neither of these carries any, and both are
    // ways for a hostile file to do more than draw.
    isEvalSupported: false,
    disableFontFace: false,
  }).promise;

  /** Render one page (1-based) to a PNG data URL plus everything rasterSource wants. */
  const render = async (pageNo, { longEdge = LONG_EDGE } = {}) => {
    const page = await doc.getPage(pageNo);
    const nat = pageSize(page);
    const scale = longEdge / Math.max(nat.w, nat.h);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');

    // WHITE FIRST. A PDF page's background is nothing at all, and a transparent
    // background becomes black the moment this is drawn into a JPEG, sent to a
    // detector, or composited by a model's preprocessing. Every plan in this app
    // is dark ink on light paper; this makes that true of PDFs too.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;

    const src = canvas.toDataURL('image/png');
    return {
      src,
      base64: src.split(',')[1],
      mime: 'image/png',
      w: canvas.width,
      h: canvas.height,
      pageNo,
      pageSizePt: nat,
    };
  };

  /** A small render, for choosing between pages. */
  const thumb = (pageNo) => render(pageNo, { longEdge: 320 });

  /**
   * The page's TEXT, positioned in the same pixels `render` produces.
   *
   * THE ONE THING A PDF SAYS ABOUT ITSELF THAT A PHOTOGRAPH CANNOT. The note at
   * the top of this file is about LINE WORK and stands: a wall stroke and a
   * dimension-line stroke are indistinguishable, so the drawing is rasterised.
   * Text is the exception, and it is not a close call — a run carries its string
   * and its matrix, so `3500` sits at an exact position rather than a guessed
   * one. A drawing that dimensions itself has therefore already answered the
   * question the door step asks. See features/dimension-intelligence.
   *
   * THE SAME `longEdge` AS THE RENDER, and that is not a detail: these
   * coordinates are compared against room outlines found on the rendered image,
   * so a different scale here would be a different space and every comparison
   * would be wrong by the ratio — silently, because the numbers would still look
   * like positions on a plan.
   *
   * COMPOSING THE TWO MATRICES IS DONE HERE, NOT BY `pdfjs.Util`.
   * It is six multiply-adds, and depending on a library's incidental export for
   * them bought nothing and cost a whole failure mode: `Util.transform` was
   * called in the loop BELOW the try/catch, so if that export were ever missing
   * — a different build, a bundler that dropped it, a version bump — every item
   * would throw on the first one, the throw would surface as "this PDF has no
   * text layer", and the drawing would be reported as undimensioned rather than
   * as broken. The arithmetic is the stable thing; the export is not.
   *
   * The viewport's matrix is what carries the page rotation and the Y flip, so
   * the composition order matters: viewport ∘ item, never the other way round.
   */
  const textRuns = async (pageNo, { longEdge = LONG_EDGE } = {}) => {
    const page = await doc.getPage(pageNo);
    const nat = pageSize(page);
    const scale = longEdge / Math.max(nat.w, nat.h);
    const viewport = page.getViewport({ scale });
    let content = null;
    try {
      content = await textContentOf(page);
    } catch (err) {
      /* A page with no text layer is the ordinary case for a scan, not a fault —
         but it is NOT the same as the call failing, and reporting both as an
         empty list is how a real failure gets read as "this drawing has no
         dimensions". The caller shows one of those to a person. */
      console.warn('[pdf] reading the text layer failed', err);
      return [];
    }
    const raw = content?.items?.length ?? 0;
    const runs = [];
    /** viewport ∘ item, in the order PDF matrices compose. */
    const compose = (v, t) => [
      v[0] * t[0] + v[2] * t[1],
      v[1] * t[0] + v[3] * t[1],
      v[0] * t[2] + v[2] * t[3],
      v[1] * t[2] + v[3] * t[3],
      v[0] * t[4] + v[2] * t[5] + v[4],
      v[1] * t[4] + v[3] * t[5] + v[5],
    ];
    for (const it of content.items || []) {
      // Marked-content entries ride in this list too and carry no string.
      if (typeof it.str !== 'string' || it.str.trim() === '') continue;
      if (!Array.isArray(it.transform) || it.transform.length < 6) continue;
      const m = compose(viewport.transform, it.transform);
      const h = Math.hypot(m[2], m[3]);
      runs.push({
        str: it.str,
        x: m[4],
        y: m[5],
        w: (it.width || 0) * scale,
        h: h > 0 ? h : (it.height || 0) * scale,
        rot: Math.atan2(m[1], m[0]),
      });
    }
    /* THE TWO COUNTS, BECAUSE THEY FAIL DIFFERENTLY. `raw` zero means the page
       carries no text at all — a scan, or an export that outlined its type.
       `raw` high with `runs` zero means every item was blank, which is a
       stripped text layer: present, positioned, and saying nothing. */
    if (!runs.length) console.warn(`[pdf] page ${pageNo}: ${raw} text items, none usable`);
    return runs;
  };

  /**
   * The CAD layer names this page was exported with, if any.
   *
   * Optional content groups survive an AutoCAD or Revit export and carry the
   * layer's own name — `KMBD Walls`, `KMBD Doors and Windows`. Nothing reads
   * this yet; it is returned because `openPdf` is the only place that holds the
   * parsed document, and finding out later would mean parsing the file twice.
   */
  const layerNames = async () => {
    try {
      const cfg = await doc.getOptionalContentConfig();
      return (cfg.getOrder() || [])
        .map((id) => (typeof id === 'string' ? cfg.getGroup(id)?.name ?? null : null))
        .filter(Boolean);
    } catch { return []; }
  };

  return {
    pages: doc.numPages,
    render,
    thumb,
    textRuns,
    layerNames,
    destroy: () => { try { doc.destroy(); } catch { /* already gone */ } },
  };
}

/** Is this file one? Checked by extension AND type, because neither is reliable
 *  on its own: a file dragged out of some mail clients arrives with no type at
 *  all, and a few tools hand over `application/octet-stream`. */
export const isPdf = (file) =>
  /\.pdf$/i.test(file?.name || '') || file?.type === 'application/pdf';

/**
 * Turn a rendered page into the `img` shape App.jsx holds for a raster plan.
 * Decoding into an <img> element is not optional — the fan detector reads pixels
 * out of `img.el` via a canvas, and PlanCanvas draws it.
 */
export async function pageToImg(rendered, { name }) {
  const el = new Image();
  await new Promise((res, rej) => { el.onload = res; el.onerror = rej; el.src = rendered.src; });
  return {
    src: rendered.src, el, w: rendered.w, h: rendered.h,
    name, base64: rendered.base64, mime: rendered.mime,
    /* THE PAGE'S REAL SIZE IN POINTS, CARRIED FORWARD. `render` has always
       computed it — it is how the render scale is chosen — and it was dropped
       here, which meant the app knew the sheet it came off and then forgot.
       The PDF export needs it to put the drawing back on the same sheet: a plan
       imported from an A1 is an A1 drawing, and fitting it to A4 because that is
       the only size anybody wrote down is how a 1:50 becomes a 1:141. */
    pageSizePt: rendered.pageSizePt ?? null,
    pageNo: rendered.pageNo ?? null,
  };
}
