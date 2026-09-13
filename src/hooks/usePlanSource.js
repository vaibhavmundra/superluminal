import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDXF, UNITS } from '../lib/dxf.js';
import { vectorSource, rasterSource } from '../lib/planSource.js';
import { openPdf, isPdf, pageToImg } from '../lib/pdfPlan.js';

// ---------------------------------------------------------------------------
// usePlanSource — the file behind the plan and the source it resolves to.
//
// `unitId` and `pdfPage` remain saved-plan fields in usePlanDoc. This hook owns
// their read boundary, just as useScale owns the saved scale choices: the
// document stays the persistence store and the dependency graph remains
// one-way. The other state here is session state around opening a raster, DXF,
// or one page of a PDF.
// ---------------------------------------------------------------------------
export default function usePlanSource({
  doc, docActions, initialPdfPage, resetForNewPlan, setBusy,
}) {
  const { unitId, pdfPage, layers } = doc;

  // TWO WAYS IN, one pipeline — and since the outline became something you
  // draw, the two have very nearly converged. BOTH kinds of plan are read for
  // rooms on upload and then corrected by hand over the drawing (see
  // OutlineTracer); the only thing a DXF still does for you is state its own
  // scale, where an image has to be measured first.
  const [img, setImg] = useState(null);          // raster: {src, el, w, h, base64, mime, name}
  const [dxf, setDxf] = useState(null);          // vector: {drawing, name}
  // A PDF IS NOT A THIRD KIND OF SOURCE. It is rendered to a raster and then it
  // IS a raster — `img` above holds the result and nothing downstream knows the
  // difference. What is held here is only what the raster cannot say for itself:
  // which page it came from (so a reopened plan renders the same one) and, while
  // a drawing set is being chosen from, the open document.
  const [pdfPick, setPdfPick] = useState(null);  // {name, pages, thumbs, doc} while asking

  /* THE PAGE'S OWN TEXT, IN THE PIXELS THE RASTER WAS RENDERED AT.
     A drawing that dimensions itself has already answered the question the door
     step asks, and the strings that say so are in the file — see `textRuns` in
     lib/pdfPlan.js and features/dimension-intelligence, which reads a scale off
     them. Held here beside `img` because it is a fact about THIS render at THIS
     size: the coordinates are only comparable to room outlines because both are
     in the same pixels, so the two must be produced and discarded together.
     NULL FOR EVERY OTHER ROUTE IN. A DXF states its scale outright and a
     photograph has no text layer at all; in both cases there is nothing here and
     the absence is the honest answer rather than an empty list to search. */
  const [planText, setPlanText] = useState(null);

  /* ...AND WHICH KIND OF FILE THAT ABSENCE CAME FROM.
     `planText` is empty for two completely different reasons and the difference
     is the whole of what a person needs told: a PHOTOGRAPH or a scan has no text
     to read and never will, while a PDF that came back with nothing is either an
     export without a text layer or a drawing that simply does not dimension
     itself. One of those is worth a sentence about the file and the other is
     worth a sentence about the drawing, and a single null cannot say either. */
  const [textKind, setTextKind] = useState(null);   // 'pdf' | 'image' | 'dxf'

  /**
   * Render one page of an open PDF and become a raster plan.
   *
   * `resetForNewPlan` runs AFTER the image is set, exactly as the image path
   * does, because the reset is what clears the previous drawing's outlines and
   * detections — doing it first would clear the state of a load that then fails
   * and leave the user with nothing instead of with what they had.
   */
  const openPdfPage = useCallback(async (doc, pageNo, name) => {
    setBusy('Rendering the page…');
    try {
      /* THE TEXT IS READ FIRST, AND THE ORDER IS DELIBERATE.
         It used to come after the render, which is the order a reader expects
         and the wrong one to depend on: rasterising drives the page proxy
         through a full operator-list pass and a canvas, and asking the same
         proxy for its text afterwards puts a second, different demand on
         whatever state that left behind. Both orders work here; only one of
         them cannot be disturbed by the other. Reading first costs nothing —
         the parse is already done — and removes the whole class of problem.

         AND IT MUST NOT BE ABLE TO FAIL THE LOAD. A page whose text cannot be
         read is an ordinary scan, and the plan still opens on the door step. */
      setBusy('Looking for dimensions…');
      let text = null;
      try { text = await doc.textRuns(pageNo); }
      catch (err) { console.warn('[pdf] textRuns threw', err); }
      console.log(`[pdf] text layer: ${text?.length ?? 0} runs on page ${pageNo}`);

      setBusy('Rendering the page…');
      const im = await pageToImg(await doc.render(pageNo), { name });
      setDxf(null);
      setImg(im);
      setPlanText(text?.length ? text : null);
      setTextKind('pdf');
      docActions.setPdfPage(pageNo);
      resetForNewPlan();
    } finally { setBusy(''); }
  }, [resetForNewPlan, docActions]);

  // Bumped on every PDF opened, so the thumbnail loop of an abandoned document
  // stops rendering into a picker nobody is looking at.
  const pdfRun = useRef(0);

  const loadPdf = useCallback(async (file) => {
    const run = ++pdfRun.current;
    setBusy('Reading the PDF…');
    let doc = null;
    try {
      doc = await openPdf(file);
      // A REOPENED PLAN DOES NOT ASK AGAIN. The page that was chosen last time
      // is part of what "this plan" means, so a drawing set opens on its plan
      // sheet rather than on its title page.
      const saved = initialPdfPage && initialPdfPage <= doc.pages ? initialPdfPage : null;
      if (doc.pages === 1 || saved) {
        await openPdfPage(doc, saved || 1, file.name);
        doc.destroy();
        return;
      }

      setPdfPick({ name: file.name, pages: doc.pages, thumbs: {}, doc });
      setBusy('');
      // ONE AT A TIME. A forty-sheet set rendered in parallel is forty canvases
      // of a document that is still being parsed; sequentially, the first
      // thumbnails appear immediately and the rest fill in while the user is
      // already looking.
      for (let n = 1; n <= doc.pages; n++) {
        if (pdfRun.current !== run) return;
        const t = await doc.thumb(n);
        if (pdfRun.current !== run) return;
        setPdfPick((prev) => (prev && prev.doc === doc
          ? { ...prev, thumbs: { ...prev.thumbs, [n]: t.src } } : prev));
      }
    } catch (err) {
      console.warn('[pdf] could not be read', err);
      // The dropzone's error slot. It is called `dxf` because the DXF parser was
      // the first thing that could fail to open; it is the load-error channel
      // for every route in.
      setDxf({ error: `That PDF could not be read — ${err.message || err}`, name: file.name });
      setImg(null);
      setPlanText(null); setTextKind(null);
    } finally { if (pdfRun.current === run) setBusy(''); }
  }, [initialPdfPage, openPdfPage]);

  const loadFile = useCallback((file) => {
    if (!file) return;
    console.log(`[plan] opening ${file.name}`, { type: file.type, bytes: file.size });
    // THREE WAYS IN, TWO PIPELINES. A PDF is rasterised and then travels the
    // image path exactly — see the header of pdfPlan.js for why it is not
    // treated as vector data despite being made of vectors.
    if (isPdf(file)) { loadPdf(file); return; }
    const isDxf = /\.dxf$/i.test(file.name) || file.type === 'application/dxf' || file.type === 'image/vnd.dxf';

    if (isDxf) {
      const reader = new FileReader();
      reader.onload = () => {
        setBusy('Reading the drawing…');
        // Parsing is synchronous and can take a moment on a big drawing, so
        // let the busy pill paint before we block on it.
        setTimeout(() => {
          try {
            const drawing = parseDXF(String(reader.result));
            if (!drawing.ok) { setDxf({ error: drawing.reason, name: file.name }); setImg(null); return; }
            setImg(null);
            setPlanText(null); setTextKind('dxf');
            setDxf({ drawing, name: file.name });
            resetForNewPlan();
          } finally { setBusy(''); }
        }, 20);
      };
      reader.readAsText(file);
      return;
    }

    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      const el = new Image();
      el.onload = () => {
        setDxf(null);
        // A PHOTOGRAPH HAS NO TEXT LAYER. Nothing to read a dimension out of, so
        // this route keeps the door step exactly as it was.
        setPlanText(null); setTextKind('image');
        setImg({ src, el, w: el.naturalWidth, h: el.naturalHeight, name: file.name,
                 base64: String(src).split(',')[1], mime: file.type });
        resetForNewPlan();
      };
      el.src = src;
    };
    reader.readAsDataURL(file);
  }, [resetForNewPlan, loadPdf]);

  // A DXF becomes a virtual image of exactly known scale, so the pixel-space
  // pipeline below it does not need to know which kind of plan it is looking at.
  const source = useMemo(() => {
    if (dxf?.drawing) {
      const chosen = unitId ? UNITS.find((u) => u.id === unitId) : null;
      const drawing = chosen
        ? { ...dxf.drawing, units: { ...chosen, source: 'chosen' } }
        : dxf.drawing;
      return vectorSource(drawing, { name: dxf.name });
    }
    if (img) return rasterSource(img);
    return null;
  }, [dxf, img, unitId]);
  const isVector = source?.kind === 'vector';

  /* THE INVERSION IS DONE TO THE PIXELS, NOT WITH A CSS FILTER, and that is a
     correction rather than a preference. A filter has to land on whichever
     element happens to be painting the plan, and this app paints it two
     different ways — an SVG `<image>` here, a Konva `<canvas>` on the tracing
     screen — so "it works" was true of one renderer at a time and false on
     screen. Reading the bitmap out, subtracting every channel from 255 and
     handing back the result is renderer-independent: whatever draws this image
     draws an inverted image, because the image IS inverted.
     ALPHA IS LEFT ALONE. Inverting it would turn a transparent margin opaque. */
  const [invertedSrc, setInvertedSrc] = useState(null);
  useEffect(() => {
    if (!layers.invert || isVector || !source?.el) { setInvertedSrc(null); return; }
    try {
      const cv = document.createElement('canvas');
      cv.width = source.w; cv.height = source.h;
      const cx = cv.getContext('2d');
      cx.drawImage(source.el, 0, 0, source.w, source.h);
      const frame = cx.getImageData(0, 0, source.w, source.h);
      const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2];
      }
      cx.putImageData(frame, 0, 0);
      setInvertedSrc(cv.toDataURL('image/png'));
    } catch (e) {
      // A cross-origin bitmap taints the canvas and `getImageData` throws. The
      // plan then simply shows as scanned rather than the screen breaking.
      console.warn('[app] the plan could not be inverted', e);
      setInvertedSrc(null);
    }
  }, [layers.invert, isVector, source]);

  return {
    img, setImg,
    dxf, setDxf,
    pdfPage, pdfPick, setPdfPick, pdfRun,
    planText, textKind,
    unitId,
    invertedSrc,
    loadFile, loadPdf, openPdfPage,
    source, isVector,
  };
}
