// ---------------------------------------------------------------------------
// doors.js — the scale, taken off a door.
//
// A drawing without a scale is a picture. Everything downstream — the cell
// area, the wall-distance rule, the fan clearance, every fitting position — is
// stated in feet, so px/ft is the first number the app needs and the one it
// used to ask a human for.
//
// A DOOR IS THE RULER THAT IS ALREADY ON THE PLAN. Its real width is one of
// three or four values in the entire built world: 750mm to a bathroom, 900mm to
// a room, 1200mm to a hall or a double leaf. Nothing else on a floor plan is
// that standard — a sofa is anything from 1500 to 2400, a bed is a choice, a
// wall is 4 inches or 9 inches or 12. So the door is the object worth detecting
// for this, and it is worth detecting rather than measuring because the user
// then never touches a ruler: they click a door and name it.
//
// WHY A BOX IS ENOUGH, AND WHAT SIDE OF IT COUNTS. A door in plan is a leaf
// plus a quarter-circle swing, and the swing's RADIUS IS THE LEAF LENGTH — so
// both sides of a clean detection box equal the door's clear width. They are
// never exactly equal, because the box also encloses whatever frame and wall
// the leaf is hinged into, and that lands on one axis and not the other. The
// SHORTER side is therefore the better estimate of the opening: the longer one
// is the one carrying the wall.
//
// In the sample plan the boxes come back 150x193, 120x115, 120x145, 105x95 —
// close to square, anisotropic by up to a quarter, and consistent with exactly
// that reading.
//
// THE MODEL NEVER STATES A LENGTH. It draws a box; the person names the door;
// the arithmetic happens here. Same division of labour as everywhere else in
// this app — the model recognises, the code measures — and it is what keeps a
// detector that is 20% wrong about a box from being 20% wrong about the scale
// of the whole drawing, because a person looking at the result can see that a
// flat has come out 90 ft wide.
//
// PURE. The call goes through /api/detect like every other detection.
// ---------------------------------------------------------------------------

import { collectPredictions, rectFromPrediction, className, isNormalised,
         rescaleRect, clampRect, iou } from './furniture.js';

/**
 * What a door can be, in millimetres.
 *
 * Three, and then "something else". Offering fifteen sizes would be offering a
 * choice nobody can make from a drawing: the point of this list is that a
 * person looking at a plan can tell a bathroom door from a room door from a
 * hall door at a glance, and cannot tell 850 from 900.
 */
export const DOOR_WIDTHS = [
  { mm: 750,  label: '750mm', note: 'bathroom / utility' },
  { mm: 900,  label: '900mm', note: 'bedroom / internal — the common one' },
  { mm: 1200, label: '1200mm', note: 'hall, entrance or a double leaf' },
];

export const MM_PER_FT = 304.8;

export const DOOR_DEFAULTS = {
  // A door the detector is less sure of than this is not something to hand
  // somebody as a ruler.
  minConfidence: 0.40,
  // A "door" wider than this fraction of the plan is a misfire — a whole room
  // boxed, or the sheet border.
  maxAreaFrac: 0.10,
  // ...and one this small is noise. Lower than the bed's floor: a door is a
  // small object and on a whole-floor sheet it is genuinely a few hundred
  // pixels out of millions.
  minAreaFrac: 0.0004,
  // A box this far from square is not a leaf-plus-swing. A clean door box is
  // 1:1 give or take the frame; 2:1 is two doors boxed together, or a corridor.
  maxAspect: 2.2,
  // Two boxes over one door is one door.
  iouLimit: 0.45,
};

/** The clear opening this box implies, in pixels. The SHORTER side — see above. */
export function openingPx(rect) {
  return Math.min(Math.abs(rect.x1 - rect.x0), Math.abs(rect.y1 - rect.y0));
}

/**
 * px/ft from one door box and the width the user says it is.
 *
 * The whole feature, in three lines. Everything else in this file is deciding
 * which boxes are worth offering and in what order.
 */
export function scaleFromDoor(rect, widthMm) {
  const px = openingPx(rect);
  const mm = Number(widthMm);
  if (!(px > 0) || !(mm > 0)) return null;
  return px / (mm / MM_PER_FT);
}

/** ...and back, so a picked door can say what it would make the scale. */
export function doorWidthAt(rect, pxPerFt) {
  if (!(pxPerFt > 0)) return null;
  return (openingPx(rect) / pxPerFt) * MM_PER_FT;
}

/**
 * The response -> the doors worth clicking on, in the ORIGINAL image's pixels.
 *
 * `image` is {w,h} of the file the user uploaded, which is not the size that was
 * sent — the client downscales to 1600px and the workflow may resize again on
 * the way in. The response declares the space it answered in and rescaleRect
 * maps back, exactly as it does for the bed. Getting this wrong would not move a
 * box slightly: it would scale every door by the downscale ratio and put the
 * whole drawing out by that factor, silently, because a wrong scale still looks
 * like a plan.
 */
export function doorsFromPayload(payload, { image, ...o } = {}) {
  const opt = { ...DOOR_DEFAULTS, ...o };
  const area = Math.max(1, image.w * image.h);
  const kept = [], rejected = [];

  for (const { pred, imgSize } of collectPredictions(payload?.result ?? payload)) {
    const cls = className(pred);
    const conf = Number.isFinite(pred.confidence) ? pred.confidence : 1;
    const raw = rectFromPrediction(pred);
    if (!raw) continue;

    const box = isNormalised(raw)
      ? { x0: raw.x0 * image.w, y0: raw.y0 * image.h, x1: raw.x1 * image.w, y1: raw.y1 * image.h }
      : rescaleRect(raw, imgSize, image);
    const r = clampRect(box, image.w, image.h);
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const frac = (w * h) / area;
    const aspect = Math.max(w, h) / Math.max(1e-9, Math.min(w, h));
    const why = (reason) => rejected.push({ cls, conf, rect: r, reason });

    // THE CLASS IS NOT REQUIRED TO BE 'door'. This workflow answers one
    // question and everything it returns is its answer to it; a workflow whose
    // author named the class `0`, `object` or nothing at all is not returning
    // something else. A class that is positively something else — a wall, a
    // window — is dropped.
    if (cls && !/^(door|doors|0|object|item)$/i.test(cls)) { why(`class "${cls}" is not a door`); continue; }
    if (conf < opt.minConfidence) { why(`confidence ${conf.toFixed(2)} below ${opt.minConfidence}`); continue; }
    if (frac > opt.maxAreaFrac) { why(`covers ${(frac * 100).toFixed(1)}% of the plan`); continue; }
    if (frac < opt.minAreaFrac) { why('too small to be a door'); continue; }
    if (aspect > opt.maxAspect) { why(`${aspect.toFixed(1)}:1 is not a leaf and a swing`); continue; }

    kept.push({ cls: cls || 'door', conf, rect: r, openingPx: openingPx(r) });
  }

  // Confidence first so the de-dup keeps the better box, then de-dup, and only
  // THEN the display order below.
  kept.sort((a, b) => b.conf - a.conf);
  const unique = [];
  for (const d of kept) {
    if (!unique.some((u) => iou(u.rect, d.rect) > opt.iouLimit)) unique.push(d);
  }

  // THE ORDER IS THE OFFER. The user is about to pick one of these as the ruler
  // for the entire drawing, so the first one their eye lands on should be the
  // most typical, not the most confident — a confident detection of the one odd
  // door on the sheet is a worse ruler than an ordinary one. So they are ranked
  // by how close they are to the MEDIAN opening: the door that agrees with the
  // most other doors is the safest thing to measure.
  const med = median(unique.map((d) => d.openingPx));
  const ranked = unique
    .map((d, i) => ({ ...d, i, off: Math.abs(d.openingPx - med) }))
    .sort((a, b) => a.off - b.off || b.conf - a.conf || a.i - b.i)
    .map((d, rank) => ({
      cls: d.cls, conf: d.conf, rect: d.rect, openingPx: d.openingPx,
      id: `door-${Math.round(d.rect.x0)}-${Math.round(d.rect.y0)}`,
      typical: rank === 0,
    }));

  return { doors: ranked, rejected, medianPx: med };
}

export function median(vals) {
  const v = (vals || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * A sanity read on a scale, for the panel to show.
 *
 * The one failure mode this feature has is the user naming the wrong door — a
 * 750 called a 1200 — and the result of that is not a subtle error, it is a flat
 * that comes out 60% too big. Nobody can see that in a px/ft number. Everybody
 * can see it in "this plan measures 62 x 98 ft", which is why the tracer shows
 * that line and why this returns the numbers for it.
 */
export function planSizeFt(source, pxPerFt) {
  if (!source || !(pxPerFt > 0)) return null;
  return { widthFt: source.w / pxPerFt, heightFt: source.h / pxPerFt };
}

/** The other doors, measured against the scale one door just set. */
export function agreementAt(doors, pxPerFt) {
  if (!(pxPerFt > 0)) return [];
  return (doors || []).map((d) => ({
    id: d.id,
    mm: (d.openingPx / pxPerFt) * MM_PER_FT,
  }));
}

// --- the call ---------------------------------------------------------------

export async function detectDoors({ base64, mime = 'image/jpeg', endpoint = '/api/detect',
                                    signal } = {}) {
  if (!base64) throw new Error('No image to look at.');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, mime, task: 'doors', classes: 'door' }),
    signal,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Door detector returned non-JSON (${res.status}): ${text.slice(0, 180)}`); }
  if (!res.ok) throw new Error(json.error || `Door detector failed (${res.status}).`);
  return json;
}
