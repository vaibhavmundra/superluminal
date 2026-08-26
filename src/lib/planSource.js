// ---------------------------------------------------------------------------
// planSource.js — one interface, two kinds of plan.
//
// The whole app downstream of here works in IMAGE PIXELS plus a pxPerFt scale.
// That turned out to be the useful accident: a DXF can enter as a VIRTUAL
// IMAGE of exactly known scale, and chunking, the grid, the planner and every
// exporter carry on without knowing the difference.
//
//   raster  pixels are real pixels; pxPerFt is measured, guessed or estimated
//   vector  pixels are a viewport we chose; pxPerFt is EXACT, from the file
//
// The one fiddly part is handedness. DXF is Y-up, screens are Y-down, so
// everything crossing this boundary gets flipped — and a flip reverses polygon
// winding, so rooms are re-normalised on arrival to match exactly what the
// raster detector produces. Get that wrong and the geometry is subtly mirrored
// in ways that only show up as a wrong answer three stages later.
// ---------------------------------------------------------------------------

import { bbox, ensureCCW, axisRect } from './geometry.js';

// How wide we would like a vector drawing to render, and the pxPerFt band that
// keeps line weights and light glyphs sensible at either extreme.
const TARGET_PX = 1400;
const MIN_PX_PER_FT = 6;
const MAX_PX_PER_FT = 40;

/**
 * Wrap a parsed DXF as a plan source.
 *
 * `pad` leaves a margin so a wall on the extreme edge is not clipped by the
 * viewport, and so the room outline's stroke has somewhere to live.
 */
export function vectorSource(drawing, { name = 'drawing.dxf', padFt = 1 } = {}) {
  const f = drawing.units.toFeet;
  const b = drawing.bbox;
  const minXft = b.minX * f - padFt;
  const maxXft = b.maxX * f + padFt;
  const minYft = b.minY * f - padFt;
  const maxYft = b.maxY * f + padFt;
  const widthFt = Math.max(1e-6, maxXft - minXft);
  const heightFt = Math.max(1e-6, maxYft - minYft);

  const pxPerFt = Math.min(MAX_PX_PER_FT, Math.max(MIN_PX_PER_FT, TARGET_PX / widthFt));
  const w = Math.round(widthFt * pxPerFt);
  const h = Math.round(heightFt * pxPerFt);

  // feet (Y-up, drawing coords) <-> px (Y-down, screen coords)
  const toPx = (p) => ({ x: (p.x - minXft) * pxPerFt, y: (maxYft - p.y) * pxPerFt });
  const toFt = (p) => ({ x: p.x / pxPerFt + minXft, y: maxYft - p.y / pxPerFt });

  // px <-> RAW DRAWING UNITS. Anything the user draws on top of the plan is
  // stored in the drawing's own coordinates, not in pixels: the pixel space is
  // derived from the unit interpretation, so a traced outline held in pixels
  // would slide off its walls the moment the units were corrected. Held in
  // drawing units it is reinterpreted exactly as the walls are, and stays put.
  const toDu = (p) => {
    const ft = toFt(p);
    return { x: ft.x / f, y: ft.y / f };
  };
  const fromDu = (p) => toPx({ x: p.x * f, y: p.y * f });

  return {
    kind: 'vector',
    name,
    w, h, pxPerFt,
    widthFt, heightFt,
    unitLabel: drawing.units.label,
    unitId: drawing.units.id,
    unitSource: drawing.units.source,
    toPx, toFt, toDu, fromDu,
    drawing,
    render: renderLayers(drawing, toPx, pxPerFt),
    // The same line work as flat point pairs. `render` is path strings, which
    // draw fast but cannot be snapped to; the tracer needs real coordinates.
    segmentsPx: segmentsToPx(drawing, toPx),
    circlesPx: circlesToPx(drawing, toPx, pxPerFt),
  };
}

/**
 * A raster image, described the same way so callers need not branch.
 *
 * The empty `render`, `segmentsPx` and `circlesPx` are not padding: they are the
 * honest answer. An image has no line work, and none is manufactured for it —
 * see the align/grid snaps in snap.js for what the tracer leans on instead. Left
 * absent rather than empty, every consumer would need to know which kind of
 * plan it was holding, which is the branch this module exists to remove.
 *
 * `toDu`/`fromDu` are the identity. Their job on a DXF is to hold a traced
 * outline in the drawing's own units, so that correcting the unit interpretation
 * reinterprets the outline exactly as it reinterprets the walls. An image has no
 * units to correct — its pixels ARE the drawing — so the outline is held in
 * pixels and the pair collapses. Keeping them means App.jsx stores an outline
 * one way for both routes.
 */
export function rasterSource(img) {
  const same = (p) => ({ x: p.x, y: p.y });
  return {
    kind: 'raster',
    name: img.name,
    w: img.w, h: img.h,
    pxPerFt: null,          // measured elsewhere; not knowable from the file
    src: img.src,
    el: img.el,
    base64: img.base64,
    mime: img.mime,
    toDu: same, fromDu: same,
    render: [],
    segmentsPx: [],
    circlesPx: [],
  };
}

function segmentsToPx(drawing, toPx) {
  const f = drawing.units.toFeet;
  return drawing.segments.map((s) => {
    const a = toPx({ x: s.x1 * f, y: s.y1 * f });
    const b = toPx({ x: s.x2 * f, y: s.y2 * f });
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer: s.layer };
  });
}

function circlesToPx(drawing, toPx, pxPerFt) {
  const f = drawing.units.toFeet;
  return drawing.circles.map((c) => {
    const p = toPx({ x: c.cx * f, y: c.cy * f });
    return { cx: p.x, cy: p.y, r: c.r * f * pxPerFt, layer: c.layer };
  });
}

/**
 * Turn the drawing into one SVG path per layer, in px.
 *
 * One path per layer rather than one element per segment: a floor plan is
 * routinely tens of thousands of segments, and that many React nodes makes
 * panning treacle.
 */
function renderLayers(drawing, toPx, pxPerFt) {
  const f = drawing.units.toFeet;
  const byLayer = new Map();
  const get = (layer) => {
    let e = byLayer.get(layer);
    if (!e) { e = { layer, d: [], circles: [] }; byLayer.set(layer, e); }
    return e;
  };

  for (const s of drawing.segments) {
    const a = toPx({ x: s.x1 * f, y: s.y1 * f });
    const b = toPx({ x: s.x2 * f, y: s.y2 * f });
    get(s.layer).d.push(
      `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
  }
  for (const c of drawing.circles) {
    const p = toPx({ x: c.cx * f, y: c.cy * f });
    get(c.layer).circles.push({ cx: p.x, cy: p.y, r: c.r * f * pxPerFt });
  }

  return [...byLayer.values()]
    .map((e) => ({ layer: e.layer, path: e.d.join(''), circles: e.circles, count: e.d.length + e.circles.length }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Rooms arrive in feet, Y-up. Bring them into the source's px space.
 *
 * ensureCCW is applied AFTER the flip, in px space, because that is where the
 * raster detector leaves its polygons — matching it here is what lets a room
 * from a DXF and a region from a green marker be the same kind of thing.
 */
export function roomsToPx(rooms, source) {
  return rooms.map((r) => {
    const polygon = ensureCCW(r.polygon.map(source.toPx));
    const b = bbox(polygon);
    return {
      ...r,
      polygonPx: polygon,
      polygonRawPx: r.polygonRaw.map(source.toPx),
      boundingRectPx: axisRect(b),
      bboxPx: b,
      centroidPx: source.toPx(r.centroid),
    };
  });
}

/**
 * Present a chosen room in the shape the app already expects from the raster
 * detector: { ok, polygon, boundingRect }. This is the drop-in seam — nothing
 * downstream needs to know which route the outline came in by.
 */
export function regionFromRoom(room) {
  if (!room) return null;
  return {
    ok: true,
    polygon: room.polygonPx,
    boundingRect: room.boundingRectPx,
    source: 'dxf',
    label: room.label,
    areaSqft: room.areaSqft,
    warning: room.polygon.length > 12
      ? `${room.polygon.length} corners — if this room reads as more complicated than it is, the wall layers may include something that is not a wall.`
      : '',
  };
}
