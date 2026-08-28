// ---------------------------------------------------------------------------
// outline.js — a traced room outline, and what it takes to trust one.
//
// An outline is the points the user clicked, and nothing else is stored: the
// polygon the planner sees is DERIVED, so the right-angle correction can be
// turned off per outline and turned back on without losing the trace. That is
// the difference between a correction you can inspect and one you have to
// undo by re-drawing.
// ---------------------------------------------------------------------------

import { bbox, polygonArea, rectifyPolygon, ensureCCW } from './geometry.js';

// Rectification tolerances, in FEET. Absolute rather than a fraction of the
// room, so a 15 sqft WC and a 400 sqft hall are corrected by the same amount.
const SIMPLIFY_FT = 0.08;   // a jog smaller than an inch is a shaky hand
const SNAP_FT = 0.25;       // walls within 3 inches of aligned are aligned

let seq = 0;

export function makeOutline(pointsPx, { name = null } = {}) {
  seq += 1;
  return {
    id: `o${Date.now().toString(36)}${seq}`,
    name: name || null,
    pointsPx: pointsPx.map((p) => ({ x: p.x, y: p.y })),
    rectify: true,
  };
}

export function nextOutlineName(existing = []) {
  const used = new Set(existing.map((o) => o.name).filter(Boolean));
  for (let i = 1; i < 500; i++) {
    const n = `Space ${i}`;
    if (!used.has(n)) return n;
  }
  return 'Space';
}

/**
 * The polygon the rest of the app sees.
 *
 * Rectifying is on by default because the planner needs a rectilinear polygon
 * and a diagonal becomes a staircase either way — better to square it here,
 * visibly, than to have the grid do it silently later. `moved` is how far the
 * furthest corner travelled, which is what tells you whether the correction
 * was a tidy-up or a rewrite.
 */
export function resolveOutline(outline, pxPerFt) {
  // AN OUTLINE WITHOUT RESOLVED POINTS IS A CALLER'S MISTAKE, and it used to be
  // a fatal one: the points live in drawing units on the stored object and are
  // resolved into pixels by whoever is about to measure them, so a raw outline
  // arriving here reached ensureCCW(undefined) and threw. Throwing from geometry
  // called during a render unmounts the React tree — the app goes white, several
  // features away from the actual bug. An empty answer is wrong in a way that is
  // visible and survivable; a crash is neither.
  if (!outline?.pointsPx?.length) {
    console.warn('[outline] resolveOutline got no pointsPx — resolve pointsDu first', outline?.id);
    return { polygonPx: [], rawPx: [], rectified: false, movedFt: 0 };
  }
  const raw = ensureCCW(outline.pointsPx);
  if (!outline.rectify || raw.length < 4) {
    return { polygonPx: raw, rawPx: raw, rectified: false, movedFt: 0 };
  }
  const polygonPx = rectifyPolygon(raw, {
    simplifyEps: SIMPLIFY_FT * pxPerFt,
    snapTol: SNAP_FT * pxPerFt,
  });
  // How far the correction actually moved things: for each original corner,
  // the distance to the nearest corner of the result.
  let moved = 0;
  for (const p of raw) {
    let best = Infinity;
    for (const q of polygonPx) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    moved = Math.max(moved, best);
  }
  return { polygonPx, rawPx: raw, rectified: true, movedFt: moved / pxPerFt };
}

export function outlineStats(outline, pxPerFt) {
  const { polygonPx, rectified, movedFt, rawPx } = resolveOutline(outline, pxPerFt);
  const b = bbox(polygonPx);
  return {
    polygonPx, rawPx, rectified, movedFt,
    areaSqft: Math.abs(polygonArea(polygonPx)) / (pxPerFt * pxPerFt),
    widthFt: b.w / pxPerFt,
    heightFt: b.h / pxPerFt,
    corners: polygonPx.length,
    bbox: b,
    centroid: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
  };
}

// --- is this outline usable? -----------------------------------------------

function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

/**
 * Refuse an outline that cannot mean anything, and say which.
 *
 * A self-crossing polygon is the one that matters: the planner's
 * point-in-polygon test still returns answers for a figure-of-eight, they are
 * just nonsense, so it has to be caught here rather than three stages later.
 */
export function validateOutline(pointsPx, pxPerFt) {
  if (!pointsPx || pointsPx.length < 3) {
    return { ok: false, reason: 'An outline needs at least three corners.' };
  }

  // Crossings are checked BEFORE area, and the order is load-bearing: the
  // shoelace area of a figure-of-eight cancels to nearly zero, so testing area
  // first reports a bowtie as "too small to be a room" — a misleading reason
  // for a real problem, and one that sends the user off to zoom in when what
  // they need to do is undo past the crossing.
  const n = pointsPx.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges, which legitimately share a corner
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(pointsPx[i], pointsPx[(i + 1) % n],
                            pointsPx[j], pointsPx[(j + 1) % n])) {
        return { ok: false, reason: 'That outline crosses itself. Undo back past the crossing — a figure-of-eight has no inside for the planner to light.' };
      }
    }
  }

  const areaFt = Math.abs(polygonArea(pointsPx)) / (pxPerFt * pxPerFt);
  if (areaFt < 4) {
    return { ok: false, reason: `That encloses ${areaFt.toFixed(1)} sq ft — too small to be a room. Zoom in and trace it again.` };
  }
  return { ok: true, reason: '' };
}

/**
 * Present an outline in the shape the app already expects from the raster
 * detector — the same drop-in seam the DXF room reader used.
 */
export function regionFromOutline(outline, pxPerFt) {
  if (!outline) return null;
  const st = outlineStats(outline, pxPerFt);
  const b = st.bbox;
  return {
    ok: true,
    polygon: st.polygonPx,
    boundingRect: [
      { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY },
    ],
    source: 'traced',
    label: outline.name,
    areaSqft: st.areaSqft,
    warning: st.rectified && st.movedFt > 0.5
      ? `Squaring the outline moved a corner by ${(st.movedFt * 12).toFixed(0)} inches. If that is more than a tidy-up, turn the right-angle snap off for this room.`
      : '',
  };
}
