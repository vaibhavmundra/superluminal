// ---------------------------------------------------------------------------
// renderImage.js — turning somebody's renders into something sendable.
//
// THE FILE THAT ARRIVES IS NOT THE FILE THAT SHOULD GO. A render out of 3ds Max
// or Lumion is routinely 4000x2250 and eight megabytes of PNG; two of them
// base64-encoded is twenty-two megabytes on the wire, and api/accents.js
// refuses anything over four — as does Vercel, less politely, with a message
// that names neither image. So every render is decoded, drawn into a canvas at
// a sane size and re-encoded as JPEG before it goes anywhere near the network.
//
// WHY 1400px AND NOT MORE. The model's encoder cuts an image into patches and
// there is a ceiling on how many it will spend; past roughly this size the
// extra pixels are resampled away before the model ever sees them, so they cost
// upload time and body budget and buy nothing. It is the same number
// accentMask.js settled on for the plan crop, for the same reason.
//
// WHY JPEG AND NOT PNG. These are photographs of rooms — smooth gradients,
// soft shadows, no flat colour and no text to go crunchy. JPEG at 0.82 is
// perceptually indistinguishable here and a fifth of the bytes. (The plan crop
// is JPEG too, and that one is line work; the note in accentMask.js explains
// why it survives it.)
//
// THE BUDGET IS ENFORCED ACROSS THE SET, NOT PER IMAGE. Two images inside the
// per-image cap can still be over the body cap together, and that failure lands
// as a 413 that mentions neither. So fitAll() takes the whole set and steps the
// long edge down until the total fits, which is a slightly smaller picture
// rather than a failed pass.
//
// BROWSER ONLY. Canvas, Image, FileReader.
// ---------------------------------------------------------------------------

export const RENDER_DEFAULTS = {
  maxDim: 1400,
  quality: 0.82,
  /** What one render may weigh, decoded, after all of the above. */
  maxBytes: 1_600_000,
  /** And what the whole set may weigh. api/accents.js refuses over 4MB; this
   *  leaves room for the prompt and the JSON around it. */
  totalBytes: 3_400_000,
  /** More views than this is not more information — it is the same room from
   *  angles that disagree, and a longer list of duplicates to reconcile. */
  maxRenders: 6,
};

/** What this pass will accept. HEIC is deliberately absent: Chrome cannot
 *  decode it, so it would fail inside the canvas with a blank image rather
 *  than at the door with a sentence. */
export const RENDER_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

const isImage = (f) => !!f && /^image\/(png|jpe?g|webp)$/i.test(f.type || '');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('That file could not be read as an image.'));
    el.src = url;
  });
}

/** Bytes a base64 string decodes to. Base64 inflates by exactly a third. */
export const decodedBytes = (b64) => Math.floor((b64?.length || 0) * 0.75);

/**
 * One file -> a downscaled JPEG, base64, with the size it ended up.
 *
 * `maxDim` is the LONG edge, so a portrait render and a landscape one come back
 * with the same worst-case token cost.
 */
export async function shrinkRender(file, opts = {}) {
  const o = { ...RENDER_DEFAULTS, ...opts };
  if (!isImage(file)) throw new Error(`${file?.name || 'That file'} is not a PNG, JPEG or WebP.`);

  const url = URL.createObjectURL(file);
  let el;
  try { el = await loadImage(url); } finally { URL.revokeObjectURL(url); }

  const long = Math.max(el.naturalWidth, el.naturalHeight);
  // NEVER UPSCALE. A small render is a small render; blowing it up adds pixels
  // that carry no detail and a third more bytes to send them in.
  const s = long > o.maxDim ? o.maxDim / long : 1;
  const w = Math.max(1, Math.round(el.naturalWidth * s));
  const h = Math.max(1, Math.round(el.naturalHeight * s));

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // WHITE UNDERNEATH, because a PNG with transparency drawn straight onto a
  // fresh canvas and encoded as JPEG comes out with black where the alpha was.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(el, 0, 0, w, h);

  let quality = o.quality;
  let dataUrl = cv.toDataURL('image/jpeg', quality);
  let base64 = dataUrl.split(',')[1];
  // One quality step down if a busy render blew the per-image budget. Two would
  // be visible; one rarely is, and the alternative is refusing the render.
  if (decodedBytes(base64) > o.maxBytes) {
    quality = Math.max(0.6, quality - 0.15);
    dataUrl = cv.toDataURL('image/jpeg', quality);
    base64 = dataUrl.split(',')[1];
  }

  return {
    name: file.name || 'render', mime: 'image/jpeg',
    base64, dataUrl, w, h, quality,
    bytes: decodedBytes(base64),
    fromBytes: file.size ?? null,
    fromW: el.naturalWidth, fromH: el.naturalHeight,
  };
}

/**
 * A whole set of files -> a set that FITS.
 *
 * Shrinks each, then — if the total is still over the body budget — steps the
 * long edge down and does it again, up to three times. Three steps takes 1400
 * to 700, which is half the linear resolution and a quarter of the bytes; past
 * that the renders are too small to read materials off and the honest answer is
 * to say so rather than to send something useless.
 */
export async function fitAll(files, opts = {}) {
  const o = { ...RENDER_DEFAULTS, ...opts };
  const list = Array.from(files || []).slice(0, o.maxRenders);
  if (!list.length) return { renders: [], notes: [] };
  const notes = [];
  if ((files?.length ?? 0) > o.maxRenders) {
    notes.push(`Only the first ${o.maxRenders} views are sent — more than that is the`
      + ` same room from angles that disagree.`);
  }

  let maxDim = o.maxDim;
  let renders = [];
  for (let pass = 0; pass < 4; pass++) {
    renders = [];
    for (const f of list) renders.push(await shrinkRender(f, { ...o, maxDim }));
    const total = renders.reduce((n, r) => n + r.bytes, 0);
    if (total <= o.totalBytes) {
      if (pass > 0) {
        notes.push(`${renders.length} views is a lot of picture, so they were sent at`
          + ` ${maxDim}px rather than ${o.maxDim}px to stay inside the request limit.`);
      }
      return { renders, notes };
    }
    maxDim = Math.round(maxDim * 0.8);
  }
  notes.push('These renders are very large even after downscaling — the pass may be'
    + ' refused. Try sending two or three views rather than all of them.');
  return { renders, notes };
}
