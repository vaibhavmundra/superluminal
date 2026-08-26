// ---------------------------------------------------------------------------
// furniture.js — ask a vision model what furniture is on the plan, and turn
// what comes back into no-light zones.
//
// The only thing worth saying about a bed is that you do not put a downlight
// over it. Someone lying on their back looks straight up into it. So a bed is
// not a thing to be lit; it is a hole in the ceiling plan, which is exactly
// what a no-light zone already is. Detection therefore does not need any new
// planner concept — it needs a RECTANGLE IN IMAGE PIXELS, the same shape the
// user would have dragged by hand.
//
// Everything here is pure except detectFurniture(). The model is reached
// through /api/detect, never directly: the Roboflow key lives on the server
// and must not be in the bundle.
//
// COORDINATE SPACE. Roboflow reports boxes in the pixel space of the image it
// received, and echoes that size back under `image`. If the workflow resized
// on the way in, that is not the size of the file the user uploaded — so we
// rescale. Getting this wrong puts the bed in the wrong half of the room and
// looks, misleadingly, like a bad model rather than bad arithmetic.
// ---------------------------------------------------------------------------

import { pointInPolygon, bbox } from './geometry.js';

/** Classes worth asking for, and what each one means for a ceiling. */
export const DETECTABLE = [
  { id: 'bed',          label: 'Bed',          zone: true,  note: 'no downlight over a bed — glare when lying down' },
  { id: 'dining-table', label: 'Dining table', zone: false, note: 'usually WANTS a light — detected, never zoned' },
  { id: 'sofa',         label: 'Sofa',        zone: false, note: 'informational' },
  { id: 'toilet',       label: 'WC',          zone: false, note: 'informational' },
];

/** The ones we turn into no-light zones without being asked. */
export const ZONE_CLASSES = DETECTABLE.filter((d) => d.zone).map((d) => d.id);

export const FURNITURE_DEFAULTS = {
  minConfidence: 0.35,
  // A bed box that covers the whole room is a failed detection, not a big bed.
  maxAreaFrac: 0.60,
  // ...and one covering a few pixels is noise.
  minAreaFrac: 0.004,
  // Grown by this much on every side, in feet, before becoming a zone. A
  // detection traces the drawn mattress; the fitting above it should clear the
  // pillow too. Kept small — every inch here is ceiling you cannot light.
  padFt: 0.25,
};

// --- reading the response ---------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Does this object look like a detection? We check for geometry rather than
 * for a field name, because the output key is whatever the workflow author
 * called it and we do not want to hard-code someone's naming.
 */
const numArray = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);

export function looksLikePrediction(o) {
  if (!o || typeof o !== 'object') return false;
  const hasCentre = isNum(o.x) && isNum(o.y) && isNum(o.width) && isNum(o.height);
  const hasCorners = isNum(o.x1) && isNum(o.y1) && isNum(o.x2) && isNum(o.y2);
  const hasPoints = Array.isArray(o.points) && o.points.length >= 3;
  // Array forms. Different Roboflow blocks and different model families encode
  // a box as bbox/box/xyxy/xywh rather than as named fields, and a workflow
  // author does not choose which. Accepting all of them costs four lines and
  // saves a silent zero-detection run.
  const hasArray = numArray(o.bbox, 4) || numArray(o.box, 4)
    || numArray(o.xyxy, 4) || numArray(o.xywh, 4);
  return hasCentre || hasCorners || hasPoints || hasArray;
}

/**
 * Walk the whole response and gather every prediction in it, carrying down the
 * nearest enclosing `image` size. Workflow responses nest differently
 * depending on how the workflow was built (outputs[], a named field, a crop
 * step returning a list per crop) and we would rather not care.
 */
export function collectPredictions(payload) {
  const out = [];
  const walk = (node, imgSize) => {
    if (Array.isArray(node)) { for (const n of node) walk(n, imgSize); return; }
    if (!node || typeof node !== 'object') return;
    const size = node.image && isNum(node.image.width) && isNum(node.image.height)
      ? { w: node.image.width, h: node.image.height }
      : imgSize;
    if (looksLikePrediction(node)) { out.push({ pred: node, imgSize: size }); return; }
    for (const k of Object.keys(node)) {
      if (k === 'image') continue;
      walk(node[k], size);
    }
  };
  walk(payload, null);
  return out;
}

/** One prediction -> an axis-aligned rect in the space the model reported. */
export function rectFromPrediction(p) {
  if (isNum(p.x) && isNum(p.y) && isNum(p.width) && isNum(p.height)) {
    // Roboflow's x,y is the CENTRE of the box, not a corner.
    return { x0: p.x - p.width / 2, y0: p.y - p.height / 2,
             x1: p.x + p.width / 2, y1: p.y + p.height / 2 };
  }
  if (isNum(p.x1) && isNum(p.y1) && isNum(p.x2) && isNum(p.y2)) {
    return { x0: Math.min(p.x1, p.x2), y0: Math.min(p.y1, p.y2),
             x1: Math.max(p.x1, p.x2), y1: Math.max(p.y1, p.y2) };
  }
  // xyxy is corners; xywh and a bare bbox/box are top-left plus size, which is
  // NOT the same convention as the named x,y,width,height above (centre).
  if (numArray(p.xyxy, 4)) {
    const [a, b, c, d] = p.xyxy;
    return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
  }
  const arr = numArray(p.xywh, 4) ? p.xywh : (numArray(p.bbox, 4) ? p.bbox : (numArray(p.box, 4) ? p.box : null));
  if (arr) {
    const [x, y, w, h] = arr;
    return { x0: x, y0: y, x1: x + w, y1: y + h };
  }
  if (Array.isArray(p.points) && p.points.length >= 3) {
    // A segmentation mask. Its bounding box is what a rectangular zone can use;
    // the polygon itself is thrown away, and that is a real loss on a bed drawn
    // at an angle. See "Known limits" in the README.
    const b = bbox(p.points);
    return { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
  }
  return null;
}

export function className(p) {
  return String(p.class ?? p.class_name ?? p.label ?? '').trim().toLowerCase();
}

/**
 * Some models report 0..1 fractions rather than pixels. Left alone these look
 * like a 1x1 pixel speck and get thrown away by the area floor, which reads as
 * "found nothing" rather than "did not understand the units".
 */
export function isNormalised(r) {
  const vals = [r.x0, r.y0, r.x1, r.y1];
  return vals.every((v) => v >= 0 && v <= 1) && (r.x1 - r.x0) > 0 && (r.y1 - r.y0) > 0;
}

/** Rescale a rect from the model's image space into the uploaded file's. */
export function rescaleRect(r, from, to) {
  if (!from || !to || !from.w || !from.h) return r;
  if (from.w === to.w && from.h === to.h) return r;
  const sx = to.w / from.w, sy = to.h / from.h;
  return { x0: r.x0 * sx, y0: r.y0 * sy, x1: r.x1 * sx, y1: r.y1 * sy };
}

export function padRect(r, pad) {
  if (!pad) return r;
  return { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad };
}

export function clampRect(r, w, h) {
  return {
    x0: Math.max(0, Math.min(r.x0, w)), y0: Math.max(0, Math.min(r.y0, h)),
    x1: Math.max(0, Math.min(r.x1, w)), y1: Math.max(0, Math.min(r.y1, h)),
  };
}

export function rectCentre(r) {
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
}

// --- response -> zones ------------------------------------------------------

/**
 * The whole pipeline, as a pure function so it can be tested without a network.
 *
 *   payload   what /api/detect returned
 *   image     {w,h} of the file the user actually uploaded
 *   polygon   the lit region in image px, or null for "anywhere on the plan".
 *             A whole-floor plan has three bedrooms on it and only one of them
 *             is being lit; the other two beds are not obstacles here.
 */
export function detectionsToZones(payload, { image, polygon = null, classes = ZONE_CLASSES, ...o } = {}) {
  const opt = { ...FURNITURE_DEFAULTS, ...o };
  const want = new Set((classes || []).map((c) => String(c).toLowerCase()));
  const area = image.w * image.h;
  const kept = [], rejected = [];

  for (const { pred, imgSize } of collectPredictions(payload)) {
    const cls = className(pred);
    const conf = isNum(pred.confidence) ? pred.confidence : 1;
    const raw = rectFromPrediction(pred);
    if (!raw) continue;

    // Fractions are resolved against the FINAL image, so no further rescale.
    const box = isNormalised(raw)
      ? { x0: raw.x0 * image.w, y0: raw.y0 * image.h, x1: raw.x1 * image.w, y1: raw.y1 * image.h }
      : rescaleRect(raw, imgSize, image);
    const r = clampRect(box, image.w, image.h);
    const frac = ((r.x1 - r.x0) * (r.y1 - r.y0)) / area;
    const why = (reason) => rejected.push({ cls, conf, rect: r, reason });

    if (want.size && !want.has(cls)) { why('not a class we zone'); continue; }
    if (conf < opt.minConfidence) { why(`confidence ${conf.toFixed(2)} below ${opt.minConfidence}`); continue; }
    if (frac > opt.maxAreaFrac) { why(`covers ${Math.round(frac * 100)}% of the plan`); continue; }
    if (frac < opt.minAreaFrac) { why('too small to be furniture'); continue; }
    if (polygon && !pointInPolygon(rectCentre(r), polygon)) { why('outside the room being lit'); continue; }

    kept.push({ cls, conf, rect: r });
  }

  // Highest confidence first, so a de-dup keeps the best box.
  kept.sort((a, b) => b.conf - a.conf);
  return { kept: dedupe(kept), rejected };
}

/** Two boxes over the same bed is one bed. Drop the weaker of any heavy overlap. */
export function dedupe(items, iouLimit = 0.45) {
  const out = [];
  for (const it of items) {
    if (!out.some((k) => iou(k.rect, it.rect) > iouLimit)) out.push(it);
  }
  return out;
}

export function iou(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / (areaA + areaB - inter);
}

/**
 * Kept detections -> the {id,x0,y0,x1,y1} zone shape App.jsx already holds.
 * pxPerFt is needed only to apply padFt; without a scale yet, no padding.
 */
export function zonesFromDetections(kept, { pxPerFt = null, image, ...o } = {}) {
  const opt = { ...FURNITURE_DEFAULTS, ...o };
  const padPx = pxPerFt ? opt.padFt * pxPerFt : 0;
  return kept.map((k, i) => {
    const r = clampRect(padRect(k.rect, padPx), image.w, image.h);
    return {
      id: `det-${k.cls}-${i}-${Math.round(r.x0)}x${Math.round(r.y0)}`,
      x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
      source: 'detected', cls: k.cls, confidence: k.conf,
    };
  });
}

// --- the one impure function ------------------------------------------------

/**
 * POST the image to our own proxy. `base64` is the bare payload App.jsx
 * already keeps on the img object — no upload, no bucket, no public URL: the
 * bytes go straight from this browser to our function to Roboflow.
 */
export const PROVIDERS = [
  { id: 'roboflow', label: 'Roboflow', note: 'trained detector — tight boxes, often finds nothing on a line drawing' },
  { id: 'openai',   label: 'GPT',      note: 'reads the plan like a person; one call for the bounds, we do the maths' },
  { id: 'both',     label: 'Both',     note: 'two calls, both answers — overlapping boxes are de-duplicated' },
];
export const DEFAULT_PROVIDER = 'openai';

export async function detectFurniture({ base64, mime = 'image/png', classes = ZONE_CLASSES,
                                        endpoint = '/api/detect', signal,
                                        provider = DEFAULT_PROVIDER, w = null, h = null } = {}) {
  if (!base64) throw new Error('No image to look at.');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // w/h are the size of the image being SENT, not of the original. The
    // OpenAI route answers in fractions and needs them to resolve; nothing
    // else does, and the response declares its own space regardless.
    body: JSON.stringify({ image: base64, mime, classes: classes.join(', '), provider, w, h }),
    signal,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Detector returned non-JSON (${res.status}): ${text.slice(0, 180)}`); }
  if (!res.ok) throw new Error(json.error || `Detector failed (${res.status}).`);
  return json;
}

// --- browser-only: shrink before sending ------------------------------------

/**
 * Re-encode an <img> at a bounded size and return bare base64.
 *
 * Two reasons, both practical. A phone photo of a plan is 12MP and 8MB, which
 * a serverless function will refuse to accept and the model will downscale
 * anyway. And a smaller image is a faster, cheaper inference — this endpoint
 * bills by processing time.
 *
 * The returned coordinates are therefore in a DIFFERENT space to img.w/img.h.
 * That is fine and expected: the response echoes the size it saw and
 * rescaleRect() maps it back. Do not "fix" this by skipping the downscale.
 */
export function downscaleForDetection(el, maxDim = 1600, quality = 0.92) {
  const w0 = el.naturalWidth || el.width, h0 = el.naturalHeight || el.height;
  const s = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // A white ground: a transparent PNG flattened onto black turns a line
  // drawing into a negative, and the model has never seen one of those.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(el, 0, 0, w, h);
  const url = cv.toDataURL('image/jpeg', quality);
  return { base64: url.split(',')[1], mime: 'image/jpeg', w, h, scale: s };
}

// --- browser-only: making a DXF look like a plan ----------------------------

/**
 * Render a vector source to a raster the detector can read.
 *
 * A DXF states where its furniture is, but only if the drawing happens to name
 * its blocks — and across a stack of drawings from different offices it does
 * not. So the vector route joins the raster one here: the drawing is rendered
 * to a plain black-on-white image and goes through exactly the same detector,
 * on exactly the same code path, and produces exactly the same rectangles.
 *
 * Three things about this that are easy to get wrong:
 *
 *   1. RENDER THE DRAWING, NOT THE CANVAS. The live SVG on screen carries our
 *      own output — grid lines, lights, cells, zone rectangles, the region
 *      outline. Rasterizing that and sending it off feeds the model its own
 *      answers back. So this builds a fresh SVG from source.render and nothing
 *      else. Do not be tempted to reuse the canvas ref.
 *   2. KEEP THE FURNITURE LAYERS. The instinct is to render walls only, the way
 *      room extraction does. That would delete the very thing being looked for.
 *      Dimension and hatch layers are dropped because they are noise; anything
 *      that might be a bed is kept.
 *   3. THE PIXEL SPACE IS ALREADY RIGHT. vectorSource picked w/h and an exact
 *      pxPerFt, and every zone and region in the app is in that space. So this
 *      renders at that size when it can, and when the drawing is too big to
 *      send, the response's echoed size maps the boxes back as usual.
 */
const NOISE_LAYER = /(dim|dimension|annot|hatch|grid[-_]?line|centre|center|title|tile|paving|pattern)/i;

export function detectionSvg(source, {
  maxDim = 1600, stroke = 1.6, wallStroke = 1.6, wallLayers = null,
} = {}) {
  const layers = source.render || [];
  // Drop annotation and hatch, but never everything: a single-layer drawing
  // called "DIMENSIONS" would otherwise render as a blank page.
  const useful = layers.filter((l) => !NOISE_LAYER.test(l.layer));
  const draw = useful.length ? useful : layers;

  const s = Math.min(1, maxDim / Math.max(source.w, source.h));
  const w = Math.max(1, Math.round(source.w * s));
  const h = Math.max(1, Math.round(source.h * s));

  // WALLS HEAVY, EVERYTHING ELSE LIGHT.
  //
  // A published floor plan — the kind the detector was trained on — draws its
  // walls as solid poché bands and its furniture as fine line work. A raw CAD
  // export gives every entity the same hairline, so the drawing reads as a
  // wireframe rather than a plan, and the model has no sense of which lines
  // bound the space.
  //
  // True poché needs the wall's two faces paired up and the cavity filled, and
  // the fill entities (HATCH) never reach us at all. Stroking the wall layer
  // heavily is the cheap approximation: push it far enough and the two faces
  // thicken toward each other until the wall reads as a band.
  //
  // It is a knob and not a constant because only a real call to the detector
  // can say what weight works, and that experiment belongs to whoever can run
  // it. Too heavy is a real failure mode, not just a wasted setting: the band
  // grows inward and swallows the headboard of a bed pushed against the wall.
  const wallSet = wallLayers instanceof Set ? wallLayers
    : (Array.isArray(wallLayers) ? new Set(wallLayers) : null);

  const body = (list) => list.map((l) => {
    const paths = l.path ? `<path d="${l.path}"/>` : '';
    const circles = (l.circles || [])
      .map((c) => `<circle cx="${c.cx.toFixed(2)}" cy="${c.cy.toFixed(2)}" r="${c.r.toFixed(2)}"/>`)
      .join('');
    return paths + circles;
  }).join('');

  const walls = wallSet ? draw.filter((l) => wallSet.has(l.layer)) : [];
  const rest = wallSet ? draw.filter((l) => !wallSet.has(l.layer)) : draw;

  const group = (list, weight) => (list.length
    ? `<g fill="none" stroke="#000000" stroke-width="${(weight / s).toFixed(2)}"`
      + ` stroke-linecap="round" stroke-linejoin="round">${body(list)}</g>`
    : '');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${source.w} ${source.h}">`
    + `<rect x="0" y="0" width="${source.w}" height="${source.h}" fill="#ffffff"/>`
    // Walls first, so heavy strokes sit UNDER the furniture rather than over
    // it. A bed against a wall would otherwise lose its headboard.
    + group(walls, wallStroke)
    + group(rest, stroke)
    + `</svg>`;

  return {
    svg, w, h, scale: s,
    layers: draw.length, layerNames: draw.map((l) => l.layer),
    wallLayerNames: walls.map((l) => l.layer),
    stroke, wallStroke,
  };
}

export function rasterizeForDetection(source, opts = {}) {
  const { svg, w, h, scale, layers, wallLayerNames, stroke, wallStroke } = detectionSvg(source, opts);

  // A Blob rather than a data: URL. A floor plan is routinely tens of thousands
  // of segments, and percent-encoding a megabyte of path data is both slow and
  // liable to hit a URL length limit.
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(el, 0, 0, w, h);
        const out = cv.toDataURL('image/jpeg', 0.92);
        resolve({ base64: out.split(',')[1], mime: 'image/jpeg', w, h, scale, layers,
                  wallLayerNames, stroke, wallStroke });
      } catch (err) { reject(err); }
      finally { URL.revokeObjectURL(url); }
    };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterise the drawing for detection.')); };
    el.src = url;
  });
}

/**
 * One call for either kind of plan. This is the seam that lets the detection
 * effect in App.jsx stop caring whether it is looking at a photo or a DXF.
 */
export function snapshotForDetection(source, img, opts = {}) {
  if (source?.kind === 'vector') return rasterizeForDetection(source, opts);
  if (img?.el) return Promise.resolve(downscaleForDetection(img.el));
  return Promise.reject(new Error('Nothing to look at.'));
}

// --- finding the visualisation the workflow sends back ----------------------

/**
 * Base64 magic prefixes. This is the discriminator that matters: a workflow
 * response is full of long base64-looking strings that are NOT images —
 * `rle_mask.counts` above all — and a walker that just looks for "a long
 * base64 string" renders one of those as a broken thumbnail. Decoding the
 * first few bytes is cheap and unambiguous.
 */
const IMAGE_MAGIC = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
  ['Qk0', 'image/bmp'],
];

/** Is this string base64 image data, and if so of what type? */
export function imageMimeOf(str) {
  if (typeof str !== 'string' || str.length < 64) return null;
  const s = str.startsWith('data:') ? (str.split(',')[1] || '') : str;
  for (const [magic, mime] of IMAGE_MAGIC) if (s.startsWith(magic)) return mime;
  return null;
}

/**
 * Pull every image out of a workflow response, biggest first.
 *
 * A segmentation workflow typically returns a rendered visualisation alongside
 * its predictions — the plan with the mask painted on. That picture is the
 * fastest way to tell a bad RENDER from a bad DETECTION, which is the one
 * question a wireframe DXF keeps raising, so it is worth surfacing rather than
 * discarding.
 *
 * Keys are ignored on purpose: the field could be called `visualization`,
 * `output_image`, `annotated` or anything else the workflow author typed. The
 * bytes decide.
 */
export function collectImages(payload) {
  const out = [];
  const seen = new Set();
  const walk = (node, key = '', depth = 0) => {
    if (depth > 10) return;
    if (typeof node === 'string') {
      const mime = imageMimeOf(node);
      if (mime && !seen.has(node)) {
        seen.add(node);
        const b64 = node.startsWith('data:') ? node.split(',')[1] : node;
        out.push({ key, mime, base64: b64, bytes: Math.floor(b64.length * 0.75) });
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${key}[${i}]`, depth + 1)); return; }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        // An RLE mask is run-length counts, not a picture. Skipping the whole
        // subtree is both faster and safer than relying on the magic check.
        if (k === 'rle_mask' || k === 'counts') continue;
        walk(node[k], k, depth + 1);
      }
    }
  };
  walk(payload);
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** The workflow's rendered visualisation, as something an <img> can show. */
export function visualisationFrom(payload) {
  const [best] = collectImages(payload);
  return best ? { url: `data:${best.mime};base64,${best.base64}`, key: best.key, bytes: best.bytes, mime: best.mime } : null;
}
