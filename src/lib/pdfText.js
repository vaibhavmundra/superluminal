// ---------------------------------------------------------------------------
// pdfText.js — a PDF page's text content, read in a way Safari can run.
//
// ONE FUNCTION, IN ITS OWN FILE, FOR TWO REASONS. It is the workaround for a
// browser bug that cost a long hunt and must not be quietly undone; and
// pdfPlan.js cannot be imported outside a browser (pdf.js reaches for DOMMatrix
// at module load), so anything left in there is untestable. This has no imports
// at all, which is what lets the suite hold it to account.
//
// --- WHAT IS WRONG WITH pdf.js's OWN getTextContent() ----------------------
//
// Its body, as shipped in pdfjs-dist 6.2.108, is:
//
//     const readableStream = this.streamTextContent(params);
//     for await (const value of readableStream) { ... }
//
// `for await ... of` over a ReadableStream requires
// `ReadableStream.prototype[Symbol.asyncIterator]`. Chrome and Firefox ship it.
// WEBKIT NEVER HAS — so in Safari that line throws
//
//     TypeError: undefined is not a function (near '...value of readableStream...')
//
// on EVERY PDF, for every user, every time.
//
// WHY IT IS SO HARD TO SEE. Nothing about it looks like a browser bug from the
// outside. The page still renders perfectly, because rendering does not go
// through this path. The file is plainly full of text. The only symptom is that
// a drawing covered in dimensions is reported as having none — so it reads as a
// problem with the DRAWING, and the app cheerfully says so.
//
// THE FIX IS TO PULL THE STREAM BY HAND. `streamTextContent` is public API and
// returns an ordinary ReadableStream; `getReader()` is supported everywhere.
// What follows is the same accumulation pdf.js performs, minus the one piece of
// syntax Safari lacks.
//
// AND NOT A POLYFILL ON THE PROTOTYPE. Patching a platform built-in to satisfy
// one caller changes every other script on the page, and leaves the next person
// to meet this with no way to know that a plan-loading module did it.
// ---------------------------------------------------------------------------

/**
 * Collect a page's text content.
 *
 * `page` is a pdf.js PDFPageProxy — anything with `streamTextContent()`.
 * Returns `{ items, styles, lang }`, the shape `getTextContent()` would have.
 */
export async function textContentOf(page) {
  const stream = page.streamTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
  });
  const out = { items: [], styles: Object.create(null), lang: null };
  const reader = stream.getReader();
  // A for(;;) rather than a while-with-assignment, because the loop has two
  // exits — the stream ending, and a chunk that carries nothing.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    out.lang ??= value.lang ?? null;
    if (value.styles) Object.assign(out.styles, value.styles);
    if (value.items?.length) out.items.push(...value.items);
  }
  return out;
}
