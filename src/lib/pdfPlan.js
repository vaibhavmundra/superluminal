// ---------------------------------------------------------------------------
// pdfPlan.js — a PDF becomes a raster, and then it is an image like any other.
//
// WHY RENDER RATHER THAN READ THE VECTORS. A PDF is vector data, and it is
// tempting to treat it like the DXF path: pull the line work out and skip the
// detector entirely. That is a trap. A DXF carries LAYERS and UNITS — it says
// which lines are walls and how long a metre is — and a PDF carries neither. It
// is a picture that happens to be made of paths: a wall is two strokes, a
// dimension line is two strokes, a hatch is four hundred strokes, and nothing in
// the file distinguishes them. Reading the paths would give us a worse image
// than rendering the page does, with a parser to maintain for the privilege.
//
// So we rasterise, and the entire raster pipeline — the room segmenter, the
// furniture pass, the door detector that sets the scale — applies unchanged. A
// PDF plan and a photographed plan are the same problem, and one of them
// happens to have perfectly crisp lines.
//
// AND THEREFORE THE SCALE IS STILL MEASURED. A page states its size in points,
// which is the size of the PAPER and says nothing about what the drawing on it
// represents: an A1 sheet at 1:50 and the same sheet at 1:100 are identical
// files as far as the page box is concerned. So a PDF goes through the same door
// measurement as an image. Inferring feet from paper size would be a plausible
// number that is wrong, which is the worst kind.
//
// THE WORKER IS BUNDLED, not fetched from a CDN. pdf.js does its parsing off the
// main thread and needs its worker script; letting it default would either block
// the UI or reach for a version-matched file on the network, and this app is
// meant to work on a site-office laptop with no connection at all.
// ---------------------------------------------------------------------------

import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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

  return {
    pages: doc.numPages,
    render,
    thumb,
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
  };
}
