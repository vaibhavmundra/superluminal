// ---------------------------------------------------------------------------
// accentMask.js — the picture of ONE room that gets sent to the model.
//
// The whole plan is the wrong thing to send. On a four-bedroom sheet the room
// being asked about is maybe an eighth of the frame, so a box drawn as
// fractions of the WHOLE image resolves at eight times the error it needs to,
// and the model's attention is spread over seven rooms it was not asked about.
//
// So this crops to the room, washes out everything around it, and sends that.
// Two things fall out of the crop that are worth naming:
//
//   1. A fraction of a cropped image is worth far fewer feet than a fraction of
//      the sheet. Cropping for ATTENTION buys ACCURACY for nothing.
//   2. The room is unambiguous without a single label being burned onto the
//      drawing. openaiDetect.js's `gridPixels` arm lost because an overlay
//      dense enough to be precise buries the line work underneath it; a wash
//      that removes what is not being asked about adds no ink at all.
//
// WHAT IS DRAWN ON, and why each earns its place:
//   the room boundary   a thin green line, so "the room" is not left to be
//                       inferred from where the wash happens to stop
//   the ambient lights  small grey circles. Without them the model recommends a
//                       fitting where a downlight already hangs, and there is
//                       nothing in the picture to tell it not to.
// Nothing else. No wall labels, no grid, no dimension strings — the model is
// never asked to name a wall, so it never needs to read one.
//
// The mapping back out is `crop`, and it is returned with the image because a
// box in the model's coordinates is meaningless without it. See toPlanRect.
//
// BROWSER ONLY. Canvas and Image. The pure half — prompt, parsing — is in
// accentPrompt.js so that it can be read and tested without a DOM.
// ---------------------------------------------------------------------------

import { bbox } from './geometry.js';

export const MASK_DEFAULTS = {
  // How much of the surrounding plan to keep, as a fraction of the room's own
  // size. Enough that a fixture box drawn hard against a wall is not clipped by
  // the edge of the image, and enough to carry the context the wash leaves in.
  marginFrac: 0.10,
  // DIMMED, NOT ERASED, and this is a measured result rather than a preference.
  //
  // It was briefly 1 — everything outside the polygon painted flat white — on
  // the reasoning that a faint neighbouring wardrobe is a thing to be mistaken
  // for this room's, and that erasing it removes a whole class of wrong answer.
  // That reasoning is sound and the results were worse.
  //
  // The likely why: a room cut out of a white void gives the model nothing to
  // read the drawing's own conventions from. Wall poché, door swings, the
  // weight of a furniture line — all of it is calibrated against the rest of
  // the sheet, and a room in isolation is a handful of rectangles that could be
  // anything at any scale. The ghost is not context for its own sake; it is
  // what says "this is a floor plan, drawn like this".
  //
  // 0.88 leaves the neighbours as a whisper: legible as convention, too faint
  // to be mistaken for this room's furniture. Turned up before it is turned
  // down — if a fixture ever gets recommended in the flat next door, that is
  // the number to move, and it is worth checking the crop in the panel first.
  washAlpha: 0.88,
  // The sent image. Big enough that a small WC is still legible, capped so the
  // request stays comfortably inside the body limit.
  maxDim: 1400,
  minDim: 700,
  quality: 0.9,
};

/**
 * The crop rectangle, in PLAN PIXELS, for one room.
 *
 * Square-ish on purpose. A 20ft x 4ft corridor cropped to its own bounds is a
 * letterbox, and a letterbox is resized by the model's encoder into very few
 * patch tokens on the short axis — which is the same starvation the whole-sheet
 * crop was suffering from, only on one axis. Padding the short side toward the
 * long one costs some wasted frame and buys back the resolution.
 */
export function cropFor(polygonPx, { w, h }, { marginFrac = MASK_DEFAULTS.marginFrac } = {}) {
  const b = bbox(polygonPx);
  const mx = Math.max(b.w, b.h) * marginFrac;

  let x0 = b.minX - mx, x1 = b.maxX + mx;
  let y0 = b.minY - mx, y1 = b.maxY + mx;

  // Pad the short axis toward the long one, up to 1:1.
  const cw = x1 - x0, ch = y1 - y0;
  if (cw > ch) {
    const pad = (cw - ch) / 2;
    y0 -= pad; y1 += pad;
  } else if (ch > cw) {
    const pad = (ch - cw) / 2;
    x0 -= pad; x1 += pad;
  }

  // Clamp to the sheet. Clamping can un-square it again, and that is fine —
  // a room in the corner of the drawing has nothing beyond the edge to show.
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(w, x1); y1 = Math.min(h, y1);

  return { x0, y0, x1: Math.max(x0 + 1, x1), y1: Math.max(y0 + 1, y1) };
}

/** The SVG for a vector plan, cropped. Mirrors detectionSvg's weighting. */
function croppedVectorSvg(source, crop, outW, outH, { wallLayers = null, stroke = 1.6, wallStroke = 3 } = {}) {
  const cw = crop.x1 - crop.x0, ch = crop.y1 - crop.y0;
  const scale = outW / cw;
  const layers = source.render || [];
  const wallSet = wallLayers instanceof Set ? wallLayers
    : (Array.isArray(wallLayers) ? new Set(wallLayers) : null);

  const body = (list) => list.map((l) => {
    const p = l.path ? `<path d="${l.path}"/>` : '';
    const c = (l.circles || [])
      .map((q) => `<circle cx="${q.cx.toFixed(2)}" cy="${q.cy.toFixed(2)}" r="${q.r.toFixed(2)}"/>`).join('');
    return p + c;
  }).join('');

  const walls = wallSet ? layers.filter((l) => wallSet.has(l.layer)) : [];
  const rest = wallSet ? layers.filter((l) => !wallSet.has(l.layer)) : layers;
  const group = (list, weight) => (list.length
    ? `<g fill="none" stroke="#111111" stroke-width="${(weight / scale).toFixed(3)}"`
      + ` stroke-linecap="round" stroke-linejoin="round">${body(list)}</g>` : '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}"`
    + ` viewBox="${crop.x0.toFixed(2)} ${crop.y0.toFixed(2)} ${cw.toFixed(2)} ${ch.toFixed(2)}">`
    + `<rect x="${crop.x0}" y="${crop.y0}" width="${cw}" height="${ch}" fill="#ffffff"/>`
    + group(walls, wallStroke) + group(rest, stroke) + `</svg>`;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load the image.'));
    el.src = url;
  });
}

/**
 * The room, isolated, as a JPEG the model can read.
 *
 * Returns the base64 AND the crop it came from. Never return one without the
 * other: a box in this image's fractions cannot be put back on the plan without
 * the rectangle it was cropped from, and the two travelling separately is how
 * they end up out of step after a re-crop.
 */
export async function roomSnapshot({ source, img, polygonPx, lightsPx = [], wallLayers = null,
                                     opts = {} } = {}) {
  const o = { ...MASK_DEFAULTS, ...opts };
  if (!source || !polygonPx?.length) throw new Error('No room to look at.');

  const crop = cropFor(polygonPx, { w: source.w, h: source.h }, o);
  const cw = crop.x1 - crop.x0, ch = crop.y1 - crop.y0;

  // Upscale a small room, downscale a large one. A 6ft WC rendered at its own
  // pixel size is a postage stamp the model cannot read; the plan has no more
  // detail to give, but the encoder has more patches to spend on it.
  const long = Math.max(cw, ch);
  const s = long > o.maxDim ? o.maxDim / long : (long < o.minDim ? o.minDim / long : 1);
  const outW = Math.max(1, Math.round(cw * s));
  const outH = Math.max(1, Math.round(ch * s));

  const cv = document.createElement('canvas');
  cv.width = outW; cv.height = outH;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  // --- the plan itself
  if (source.kind === 'vector') {
    const svg = croppedVectorSvg(source, crop, outW, outH, {
      wallLayers,
      wallStroke: Math.max(2, (source.pxPerFt || 20) * (2 / 12)),
      stroke: Math.max(1, (source.pxPerFt || 20) * (0.6 / 12)),
    });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const el = await loadImage(url);
      ctx.drawImage(el, 0, 0, outW, outH);
    } finally { URL.revokeObjectURL(url); }
  } else {
    const el = img?.el || source.el;
    if (!el) throw new Error('Nothing to look at.');
    ctx.drawImage(el, crop.x0, crop.y0, cw, ch, 0, 0, outW, outH);
  }

  // --- the wash: everything that is not this room
  //
  // One even-odd path — the whole frame, then the room — so the fill lands in
  // the region between them. Two draws (wash everything, then redraw the room
  // on top) would double the JPEG's work and re-introduce a seam at the edge.
  const toC = (p) => ({ x: (p.x - crop.x0) * s, y: (p.y - crop.y0) * s });
  const poly = polygonPx.map(toC);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, outW, outH);
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fillStyle = `rgba(255,255,255,${o.washAlpha})`;
  ctx.fill('evenodd');
  ctx.restore();

  // --- the boundary
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(22,163,74,0.55)';
  ctx.lineWidth = Math.max(1.2, outW / 500);
  ctx.stroke();
  ctx.restore();

  // --- the ambient lights already laid out
  const r = Math.max(2.5, outW / 170);
  ctx.save();
  ctx.fillStyle = 'rgba(120,120,128,0.32)';
  ctx.strokeStyle = 'rgba(90,90,100,0.6)';
  ctx.lineWidth = Math.max(1, outW / 700);
  for (const l of lightsPx) {
    const p = toC(l);
    if (p.x < -r || p.y < -r || p.x > outW + r || p.y > outH + r) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, l.kind === 'large' ? r * 1.35 : r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  const url = cv.toDataURL('image/jpeg', o.quality);
  return {
    base64: url.split(',')[1], mime: 'image/jpeg', dataUrl: url,
    w: outW, h: outH, crop, scale: s,
  };
}

/**
 * A box in the sent image's pixels -> a box in PLAN pixels.
 *
 * The inverse of the crop, and the only place the two coordinate spaces meet.
 * `sent` is the size of the image the model answered about, which is not
 * necessarily the size in `crop` — see the upscale above.
 */
export function toPlanRect(rect, crop, sent) {
  const cw = crop.x1 - crop.x0, ch = crop.y1 - crop.y0;
  const fx = cw / (sent?.width || sent?.w || 1);
  const fy = ch / (sent?.height || sent?.h || 1);
  return {
    x0: crop.x0 + rect.x0 * fx, y0: crop.y0 + rect.y0 * fy,
    x1: crop.x0 + rect.x1 * fx, y1: crop.y0 + rect.y1 * fy,
  };
}

// --- the call ---------------------------------------------------------------

export async function requestAccents({ plan, room = null, ceilingFt = null,
                                       task = 'furniture',
                                       endpoint = '/api/accents', signal } = {}) {
  if (!plan?.base64) throw new Error('No plan image to send.');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan: { image: plan.base64, mime: plan.mime, w: plan.w, h: plan.h },
      room, ceilingFt, task,
    }),
    signal,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Accent route returned non-JSON (${res.status}): ${text.slice(0, 180)}`); }
  if (!res.ok) throw new Error(json.error || `Accent route failed (${res.status}).`);
  return json;
}
