// ---------------------------------------------------------------------------
// roomsDetect.js — ask a trained segmenter where the rooms are, and turn the
// answer into outlines a person can nudge.
//
// This is the step that used to be the whole of the user's job. Tracing a room
// by hand is exact and always works, and it is also four rooms x eight corners
// of clicking before anything can be lit. A segmentation model gets those
// polygons approximately right in one call, which is a different and better
// starting point: NEARLY RIGHT AND VISIBLY SO beats a blank plan, as long as
// the correction is a drag and not a re-trace. That proviso is the whole design
// — see OutlineTracer for the grips, and the note on rectification below.
//
// WHAT COMES BACK IS NOT TRUSTED. A mask boundary is a jagged thing with
// dozens of vertices that wanders across a doorway and sits a few inches off
// the wall face, and a segmenter on a line drawing will also hand you the
// whole sheet as one "room" if you let it. So every proposal is filtered on
// area, de-duplicated against the others, simplified, and squared up before
// anyone sees it. What survives is a rectilinear polygon of four to a dozen
// corners in the plan's own pixel space — the same thing a traced outline is,
// which is why nothing downstream needs to know the difference.
//
// EVERYTHING HERE IS PURE except detectRooms(). The model is reached through
// /api/detect, never directly: the key lives on the server.
//
// COORDINATE SPACE, again. The model answers in the pixel space of the image it
// received, which is the downscaled snapshot and not the file the user
// uploaded, and it echoes that size back under `image`. Every polygon is
// rescaled to the uploaded file's space on the way through. Getting this wrong
// puts a room in the wrong half of the plan and reads as a bad model rather
// than bad arithmetic.
// ---------------------------------------------------------------------------

import { bbox, polygonArea, douglasPeucker, ensureCCW, pointInPolygon, rectifyPolygon } from './geometry.js';
import { disjoin } from './roomBooleans.js';
import { collectPredictions, className, iou } from './furniture.js';

/** The class list sent when the workflow turns out to want one. */
export const ROOM_CLASSES = ['room'];

/**
 * Class names that carry no information. A workflow that labels every mask
 * "room" or "object" has told us nothing we did not already know, and using
 * that as the outline's NAME gives four rooms the same name. Anything not on
 * this list is a real answer — "kitchen", "bedroom", "bathroom" — and is worth
 * keeping, because a named room is worth more than "Room 3".
 */
const GENERIC = new Set(['room', 'rooms', 'object', 'objects', 'space', 'area',
                         'region', 'mask', 'polygon', 'segment', 'class', '0', 'none']);

export const ROOM_DEFAULTS = {
  // Deliberately low. A room the model was unsure about is still a better
  // starting point than a blank plan, and the user is looking at every one of
  // them before anything is lit. A confident wrong answer is the thing to fear
  // here, and confidence is no defence against that.
  minConfidence: 0.20,
  // A mask covering nearly the whole sheet is the sheet — the model has
  // outlined the drawing's border, or merged every room through the doorways
  // into one blob. Both are common on a line drawing and neither is a room.
  maxAreaFrac: 0.92,
  // ...and a mask covering a few pixels is a fitting, a label or noise.
  minAreaFrac: 0.004,
  // Once the scale is known, say it in feet instead: a WC is about 15 sqft and
  // a cupboard about 6, so this sits between them.
  minAreaSqft: 12,
  // Two masks over one room is one room. Rooms genuinely abut — they share
  // walls — so this is looser than the furniture de-dup: overlapping by half
  // is two rooms disagreeing about a wall, not two rooms.
  iouLimit: 0.55,
  // Simplification, in FEET, before the polygon is squared up. A mask boundary
  // steps a pixel at a time; below this it is describing the raster and not the
  // room. Four inches is small enough to keep a real nook and large enough to
  // throw away the staircase along a straight wall.
  simplifyFt: 0.33,
  // The same, as a fraction of the image diagonal, for when there is no scale
  // yet — which on an uploaded photo is the normal case at detection time.
  simplifyFrac: 0.004,
  // Squaring, in FEET. Walls within this of aligned are aligned. Looser than the
  // tolerance a HAND-TRACED outline gets, because a mask boundary is jittery in
  // a way a person's clicking is not.
  squareSnapFt: 0.5,
  squareSimplifyFt: 0.08,
  // How close two rooms' walls have to be before they are treated as the SAME
  // wall when one is subtracted from the other. A mask that stopped short of the
  // party wall is not an interior room, it is a bad outline.
  //
  // A FOOT AND A HALF, which sounds generous until you count what is in the gap:
  // a 9-inch wall, plus the inner mask falling short of its face, plus the outer
  // mask falling short of the other face. Anything tighter and an ensuite that
  // is plainly in the corner of a bedroom reads as floating in the middle of it,
  // which is the difference between a clean subtraction and a no-light zone.
  //
  // The snap applies only INSIDE the subtraction — the inner room's own outline
  // is never rewritten. So the outer room is carved a little generously and the
  // strip between them stays unlit, which is correct: that strip is the wall.
  shareWallFt: 1.5,
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// --- getting a polygon out of one prediction --------------------------------

/**
 * Points arrive in three encodings across Roboflow's blocks and model families,
 * and a workflow author does not choose which: a list of {x,y}, a list of
 * [x,y] pairs, or one flat run of numbers. Accepting all three costs ten lines
 * and saves a silent zero-room run.
 */
export function pointsToPolygon(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const first = points[0];
  if (first && typeof first === 'object' && isNum(first.x) && isNum(first.y)) {
    const out = points.filter((p) => p && isNum(p.x) && isNum(p.y)).map((p) => ({ x: p.x, y: p.y }));
    return out.length >= 3 ? out : null;
  }
  if (Array.isArray(first) && first.length >= 2) {
    const out = points.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))
      .map((p) => ({ x: p[0], y: p[1] }));
    return out.length >= 3 ? out : null;
  }
  if (isNum(first) && points.length >= 6 && points.length % 2 === 0) {
    const out = [];
    for (let i = 0; i < points.length; i += 2) {
      if (isNum(points[i]) && isNum(points[i + 1])) out.push({ x: points[i], y: points[i + 1] });
    }
    return out.length >= 3 ? out : null;
  }
  return null;
}

/**
 * A run-length mask, reduced to its bounding rectangle.
 *
 * NOT to its contour, and the difference is worth stating. Tracing a boundary
 * out of a mask is a hundred lines that can only be tested against a real
 * response, and a room's bounding rectangle is already the right answer for
 * every rectangular room on the plan — which is most of them. So this is the
 * honest floor: an L-shaped room arrives as the rectangle around it and gets
 * one corner dragged in, rather than not arriving at all. If a real response
 * turns out to be RLE-only and the plans are full of L-shaped rooms, tracing
 * the contour properly is the upgrade, and it belongs here.
 *
 * COCO run-length is COLUMN-MAJOR and starts with a run of zeros.
 */
export function rectFromRle(rle) {
  if (!rle || typeof rle !== 'object') return null;
  const counts = Array.isArray(rle.counts) ? rle.counts : null;
  const size = Array.isArray(rle.size) && rle.size.length === 2 ? rle.size : null;
  if (!counts || !size || !counts.every(isNum) || !size.every(isNum)) return null;
  const [h, w] = size;
  if (!(w > 0 && h > 0)) return null;

  let idx = 0, on = false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const run of counts) {
    if (on && run > 0) {
      // The run covers linear indices [idx, idx+run). Column-major, so the
      // column is idx/h and the row is idx%h. A run can span columns.
      const a = idx, b = Math.min(idx + run, w * h) - 1;
      const c0 = Math.floor(a / h), c1 = Math.floor(b / h);
      minX = Math.min(minX, c0); maxX = Math.max(maxX, c1);
      if (c1 > c0) { minY = 0; maxY = h - 1; }          // spans a column break
      else { minY = Math.min(minY, a % h); maxY = Math.max(maxY, b % h); }
    }
    idx += run; on = !on;
    if (idx >= w * h) break;
  }
  if (!Number.isFinite(minX) || maxX < minX || maxY < minY) return null;
  return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1, w, h };
}

const rectPoly = (r) => [
  { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
];

/**
 * One prediction -> a polygon in whatever space the model answered in, plus
 * the size of that space when the prediction itself declares one (a mask
 * carries its own dimensions, which need not match the enclosing `image`).
 */
export function polygonFromPrediction(p) {
  const pts = pointsToPolygon(p.points)
    || pointsToPolygon(p.polygon)
    || pointsToPolygon(p.segmentation)
    || pointsToPolygon(p.contour);
  if (pts) return { pts, space: null, from: 'points' };

  for (const key of ['rle_mask', 'mask', 'rle']) {
    const r = rectFromRle(p[key]);
    if (r) return { pts: rectPoly(r), space: { w: r.w, h: r.h }, from: 'rle' };
  }

  // A plain box. The weakest answer the model can give and still be useful:
  // a rectangle the size of the room, which for most rooms is the room.
  if (isNum(p.x) && isNum(p.y) && isNum(p.width) && isNum(p.height)) {
    return {
      pts: rectPoly({ x0: p.x - p.width / 2, y0: p.y - p.height / 2,
                      x1: p.x + p.width / 2, y1: p.y + p.height / 2 }),
      space: null, from: 'box',
    };
  }
  if (isNum(p.x1) && isNum(p.y1) && isNum(p.x2) && isNum(p.y2)) {
    return {
      pts: rectPoly({ x0: Math.min(p.x1, p.x2), y0: Math.min(p.y1, p.y2),
                      x1: Math.max(p.x1, p.x2), y1: Math.max(p.y1, p.y2) }),
      space: null, from: 'box',
    };
  }
  return null;
}

/**
 * Some models answer in 0..1 fractions rather than pixels. Left alone a room
 * comes out one pixel across and is thrown away by the area floor, which reads
 * as "found nothing" rather than "did not understand the units".
 *
 * The test is deliberately strict — EVERY coordinate inside the unit square
 * AND the polygon spanning a sensible fraction of it. A genuine pixel polygon
 * living entirely within the top-left corner of a large image would otherwise
 * be blown up to fill the plan.
 */
export function isNormalisedPolygon(pts) {
  if (!pts.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return false;
  const b = bbox(pts);
  return b.w > 0.01 && b.h > 0.01;
}

export function rescalePolygon(pts, from, to) {
  if (!from || !to || !from.w || !from.h) return pts;
  if (from.w === to.w && from.h === to.h) return pts;
  const sx = to.w / from.w, sy = to.h / from.h;
  return pts.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

const clampPoly = (pts, w, h) => pts.map((p) => ({
  x: Math.max(0, Math.min(p.x, w)), y: Math.max(0, Math.min(p.y, h)),
}));

// --- payload -> proposals ---------------------------------------------------

/**
 * Reading order, so the names are stable and mean something.
 *
 * Sorting on y alone puts two rooms side by side in whichever order their
 * centroids happen to fall, which flips between runs of the same plan. So rows
 * are BANDED first — anything within a tenth of the plan's height is on the
 * same row — and then ordered left to right, which is how a person reads a
 * plan and therefore how "Room 2" gets to mean the same room twice.
 */
function readingOrder(items, image) {
  const band = Math.max(1, image.h * 0.10);
  // Off the polygon and not off a centroid computed earlier: carving a room
  // moves its middle, and an order computed before the carve puts the rooms in
  // an order the finished plan does not have.
  const mid = (it) => { const b = bbox(it.pointsPx); return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; };
  return [...items].map((it) => ({ it, m: mid(it) })).sort((a, b) => {
    const ra = Math.round(a.m.y / band), rb = Math.round(b.m.y / band);
    return ra - rb || a.m.x - b.m.x;
  }).map((x) => x.it);
}

/**
 * The whole pipeline, as a pure function so it can be tested without a network.
 *
 *   payload   what /api/detect returned for task 'rooms'
 *   image     {w,h} of the file the user actually uploaded
 *   pxPerFt   the scale, when it is known. Only used for the area floor and
 *             the simplification tolerance, both of which have a sane
 *             fallback — detection runs on upload, and on an image the scale
 *             is not set until later.
 *
 * Returns { rooms, rejected }. `rejected` carries the reason per discarded
 * mask, because "the detector found nothing" and "the detector found the
 * drawing border six times" need telling apart, and only one of them is worth
 * a message on screen.
 */
export function roomsFromPayload(payload, { image, pxPerFt = null, ...o } = {}) {
  const opt = { ...ROOM_DEFAULTS, ...o };
  const area = image.w * image.h;
  const diag = Math.hypot(image.w, image.h);
  const simplifyPx = pxPerFt ? opt.simplifyFt * pxPerFt : diag * opt.simplifyFrac;

  const kept = [], rejected = [];

  for (const { pred, imgSize } of collectPredictions(payload)) {
    const got = polygonFromPrediction(pred);
    if (!got) continue;

    const cls = className(pred);
    const conf = isNum(pred.confidence) ? pred.confidence : 1;

    // Fractions resolve against the FINAL image, so no further rescale. A mask
    // that declared its own size is rescaled from that; everything else from
    // whatever `image` block enclosed it in the response.
    const inPx = isNormalisedPolygon(got.pts)
      ? got.pts.map((p) => ({ x: p.x * image.w, y: p.y * image.h }))
      : rescalePolygon(got.pts, got.space || imgSize, image);

    const pts = clampPoly(inPx, image.w, image.h);
    const rawArea = Math.abs(polygonArea(pts));
    const frac = rawArea / area;
    const b = bbox(pts);
    const rect = { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
    const why = (reason) => rejected.push({ cls, conf, rect, reason, from: got.from });

    if (conf < opt.minConfidence) { why(`confidence ${conf.toFixed(2)} below ${opt.minConfidence}`); continue; }
    if (frac > opt.maxAreaFrac) { why(`covers ${Math.round(frac * 100)}% of the sheet — that is the drawing, not a room`); continue; }
    if (frac < opt.minAreaFrac) { why('too small to be a room'); continue; }
    if (pxPerFt) {
      const sqft = rawArea / (pxPerFt * pxPerFt);
      if (sqft < opt.minAreaSqft) { why(`${sqft.toFixed(1)} sq ft — smaller than a WC`); continue; }
    }

    kept.push({
      cls, conf, rect, from: got.from, pts,
      centroid: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      rawCorners: pts.length,
    });
  }

  // THE ENVELOPE. A mask that has other masks inside it is the sheet, not a
  // room: the model has outlined the drawing's border, or merged every room
  // through the doorways into one blob. Both are the most common bad answer a
  // segmenter gives on a line drawing, and both are confident, so confidence is
  // no defence.
  //
  // The test is containment and not area, because area is a guess about how
  // tightly the plan was cropped — a single-room drawing can legitimately fill
  // 70% of its own image — whereas "this outline has three rooms inside it" is
  // not a guess. Two is the threshold: one room inside another is a real
  // arrangement (an ensuite inside a bedroom's bounding box, an L-shaped living
  // room whose box swallows the kitchen), three is a floor plan.
  const boxArea = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
  const engulfs = (a, b) => {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (w <= 0 || h <= 0) return false;
    return (w * h) / Math.max(1e-9, boxArea(b)) >= 0.9;
  };
  const standing = [];
  for (const k of kept) {
    const inside = kept.filter((o) => o !== k && engulfs(k.rect, o.rect));
    const biggest = Math.max(0, ...inside.map((o) => boxArea(o.rect)));
    if (inside.length >= 2 && boxArea(k.rect) >= biggest * 1.8) {
      rejected.push({ ...k, reason: `encloses ${inside.length} other rooms — that is the whole plan, not a room` });
      continue;
    }
    standing.push(k);
  }

  // Biggest first for the de-dup, not most confident. Two masks over one room
  // usually differ by one of them stopping at a doorway; the one that took in
  // the whole room is the better starting point, and confidence does not say
  // which that was.
  standing.sort((a, b) => boxArea(b.rect) - boxArea(a.rect));
  const unique = [];
  for (const k of standing) {
    const clash = unique.find((u) => iou(u.rect, k.rect) > opt.iouLimit);
    if (clash) { rejected.push({ ...k, reason: 'overlaps a room already found' }); continue; }
    unique.push(k);
  }

  // --- simplify, square up, then make them disjoint -----------------------
  //
  // SQUARED HERE, and this is a reversal worth explaining. Rectifying used to be
  // left to the outline, where it is derived from the stored points and can be
  // switched off per room — which is the right design for a HAND-TRACED outline,
  // because the points the user clicked are the record and the squared version
  // is an opinion about them.
  //
  // It is the wrong design for a proposal that is about to be edited by hand.
  // The grips sit on the stored points, so with squaring derived you drag a
  // corner and watch the correction get squared away underneath you — the point
  // moves, the polygon does not, and there is nothing on screen to explain it.
  // Baking it means what you see is what you drag: move one corner of a
  // rectangle and two edges go slack, which is what a corner handle has meant
  // in every drawing program ever written. The per-room `square` switch is still
  // there to re-apply it on demand.
  const shaped = unique.map((k) => {
    const closed = [...k.pts, k.pts[0]];
    let simple = douglasPeucker(closed, simplifyPx).slice(0, -1);
    if (simple.length < 4) simple = rectPoly(k.rect);
    const squared = rectifyPolygon(simple, pxPerFt
      ? { simplifyEps: opt.squareSimplifyFt * pxPerFt, snapTol: opt.squareSnapFt * pxPerFt }
      : { simplifyEps: diag * 0.004, snapTol: diag * 0.012 });
    return { ...k, simplifiedFrom: k.pts.length, pointsPx: ensureCCW(squared) };
  });

  // NO TWO ROOMS MAY OVERLAP. Squaring first is not just tidiness: it puts every
  // edge on an axis and every near-shared wall on the same coordinate, which is
  // what makes the subtraction below exact instead of approximate. See
  // roomBooleans.js for what happens when a room sits wholly inside another.
  const carved = disjoin(shaped, {
    // With no scale yet, a fraction of the diagonal stands in for the feet. On a
    // 1042x1642 plan that is about 49px, which is a foot and a half at any
    // plausible scale for a plan of that size.
    snapPx: pxPerFt ? opt.shareWallFt * pxPerFt : diag * 0.025,
  });

  // A room the others cover almost entirely was never a room. It goes on the
  // discarded list with its reason rather than being kept as an overlapping
  // remnant — see disjoin.
  const disjointed = [];
  for (const k of carved) {
    if (k.dropped) rejected.push({ cls: k.cls, conf: k.conf, rect: k.rect, reason: k.note });
    else disjointed.push(k);
  }

  const rooms = readingOrder(disjointed, image).map((k, i) => {
    return {
      pointsPx: k.pointsPx,
      label: cleanName(k.cls),
      confidence: k.conf,
      score: k.conf,
      from: k.from,
      // The rooms that sit wholly inside this one and could not be subtracted
      // from it. The caller turns these into no-light zones, so that a ceiling
      // is never laid over a room that is not this one even when the geometry
      // could not say so.
      enclosingPx: k.enclosing ?? null,
      carved: k.carved ?? 0,
      areaSqft: pxPerFt ? Math.abs(polygonArea(k.pointsPx)) / (pxPerFt * pxPerFt) : null,
      why: `${k.from === 'points' ? 'mask' : k.from === 'rle' ? 'mask bounds' : 'box'}`
        + `, ${k.simplifiedFrom} corners in, ${k.pointsPx.length} out`
        + (isNum(k.conf) ? `, ${Math.round(k.conf * 100)}% sure` : '')
        + (k.note ? `, ${k.note}` : ''),
      note: k.note ?? '',
      order: i,
    };
  });

  return { rooms, rejected };
}

/**
 * A class name worth showing, or null.
 *
 * Drawings label their rooms in capitals, and "MASTER BEDROOM" shouting out of
 * a 300px panel is worse than the information is good — so it is title-cased.
 * A SHORT all-caps token is left alone, because "WC" is a word and "Wc" is not.
 */
export function cleanName(cls) {
  const s = String(cls || '').trim();
  if (!s || GENERIC.has(s.toLowerCase())) return null;
  return s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase()
      ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Name the rooms from text already on the drawing.
 *
 * A DXF usually labels its rooms, and "Kitchen" beside the sink is worth more
 * than "Room 2" — it is the draughtsman's own answer, so it beats anything a
 * model or a counter can produce. Only labels whose insertion point falls
 * INSIDE the polygon are used, and the shortest one wins: a room typically
 * carries a name and an area note, and "Kitchen" is the name.
 *
 * hints: [{ x, y, text }] in the SAME PX SPACE as the polygons.
 */
export function nameFromHints(pointsPx, hints) {
  if (!hints?.length) return null;
  const inside = hints.filter((t) => t.text && pointInPolygon({ x: t.x, y: t.y }, pointsPx));
  if (!inside.length) return null;
  const named = inside
    .map((t) => String(t.text).trim())
    .filter((t) => t.length > 1 && t.length < 24 && /[a-z]/i.test(t) && !/^\d/.test(t))
    .sort((a, b) => a.length - b.length);
  return named[0] ? cleanName(named[0]) : null;
}

// --- the one impure function ------------------------------------------------

/**
 * POST the plan snapshot to our own proxy, asking the rooms question.
 *
 * Same shape and same rules as detectFurniture(): the bytes go from this
 * browser to our function to Roboflow, the key never enters the bundle, and a
 * failure is reported rather than thrown at the user — tracing by hand is
 * always available and must never be blocked by a detector being down.
 */
export async function detectRooms({ base64, mime = 'image/jpeg', endpoint = '/api/detect',
                                    signal, w = null, h = null,
                                    classes = ROOM_CLASSES } = {}) {
  if (!base64) throw new Error('No image to look at.');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, mime, task: 'rooms', classes: classes.join(', '), w, h }),
    signal,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Room detector returned non-JSON (${res.status}): ${text.slice(0, 180)}`); }
  if (!res.ok) throw new Error(json.error || `Room detector failed (${res.status}).`);
  return json;
}
