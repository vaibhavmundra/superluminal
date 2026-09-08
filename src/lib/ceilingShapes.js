// ---------------------------------------------------------------------------
// ceilingShapes.js — a cove somebody DREW, and the geometry of one.
//
// A cove in cove.js is set out by the app: pick a chunk, take the inset from a
// table, and the band follows the chunk's own four sides. That is what a
// plasterer does when the detail is "cove this room", and it is a rectangle
// because a rectangle is what gets built when nobody has said otherwise.
//
// SOMEBODY HAS SAID OTHERWISE. A drawn shape is a designer putting a circle, a
// hexagon or a traced outline on the ceiling and saying "the pocket runs round
// THIS". Everything about it downstream is the same cove — a concealed strip,
// a higher ceiling inside it, a grid that stops at the line and starts again
// outside it — and the ONE thing that differs is that the line is no longer a
// rectangle.
//
// SO THE GRID STILL GETS A RECTANGLE, AND THAT IS NOT A COMPROMISE. A ceiling
// grid is set out on two axes; there is no such thing as a circular row of
// downlights, and there is no such thing as a plasterer setting the inner
// ceiling out to a curve on a lighting drawing. The rectangle the engine cuts
// on is the shape's own bounding box — the closest rectangle the shape fits in
// — so a circle 12 ft across is a 12 ft square as far as the layout is
// concerned, and a circle of tape on the drawing. Both statements are true and
// both are what would be built.
//
//   drawn shape   what is SEEN: the setting-out line, and the tape three
//                 inches outside it. Any closed outline at all.
//   its bbox      what is BUILT INTO THE GRID: inside is one grid, outside is
//                 the room's own, and no cell straddles the line. Exactly what
//                 a cove line does in cove.js.
//
// FEET, ALWAYS, IN THE PLAN'S OWN SPACE — the same space `ceilingObjs` live in,
// where a pixel is `ft * pxPerFt` from the origin of the drawing. A shape is a
// real object of a real size, and holding it in feet is what keeps it that size
// when the scale is corrected underneath it.
//
// PURE. No React, no DOM.
// ---------------------------------------------------------------------------

/**
 * WHAT CAN BE DRAWN. The order is the order of the floating menu, and it is
 * not alphabetical: the simplest mark first — a line is one stroke — and the pen
 * last, because it is the one that takes several clicks.
 *
 * `centred` IS THE GESTURE AND IT IS THE ONLY THING THAT SEPARATES THESE.
 * A rectangle is dragged corner to corner, the way every marquee in this app
 * already is. Everything with a radius is dragged from the MIDDLE, because a
 * circle has no corner to start at and pretending it has one (dragging its
 * bounding box) puts the thing you are drawing somewhere you are not pointing.
 */
export const SHAPE_TOOLS = [
  /* --- THE SIMPLEST COVE THERE IS, AND IT LEADS THE ROW ---------------------
     Everything below this draws an ISLAND: a pocket run round a piece of
     ceiling, with the room's own grid outside it. A line drawn wall to wall is
     the other cove there is — a slot straight across the slab, the kind that
     runs along one edge of a room or divides it in two — and it has no inside.

     FIRST BECAUSE IT IS THE PLAINEST, which is the same reasoning that used to
     put the rectangle here: a menu of primitives reads from the simplest mark to
     the most involved, and a line is one stroke where a rectangle is four. The
     pen stays last for the other half of that rule — it is the one that takes
     several clicks.

     `open` IS THE WHOLE DIFFERENCE and it is one flag rather than a family of
     its own, because everything else about the two kinds is identical: the same
     tape, the same billing by the metre. See `isOpen`.

     `spans` IS THE RULE THAT MAKES IT BUILDABLE. A slot has to land on something
     at both ends — plaster stops at a wall — so both endpoints are pinned to the
     room's outline. A line between two points in mid-air is a detail nobody can
     set out. */
  { id: 'line',     label: 'Line',      centred: false, open: true, spans: true },
  { id: 'rect',     label: 'Rectangle', centred: false },
  { id: 'square',   label: 'Square',    centred: true },
  { id: 'circle',   label: 'Circle',    centred: true },
  { id: 'triangle', label: 'Triangle',  centred: true },
  { id: 'polygon',  label: 'Polygon',   centred: true, asks: 'sides' },
  { id: 'pen',      label: 'Pen',       centred: false, path: true, canOpen: true },
];

export const SHAPE_BY_ID = Object.fromEntries(SHAPE_TOOLS.map((t) => [t.id, t]));

/** How many sides a polygon may have, and what it starts as. Three and four
 *  are their own tools, so the polygon starts at the first side count that is
 *  not already a button of its own. */
export const POLY_SIDES = { min: 3, max: 12, initial: 6 };

/**
 * THE SMALLEST SHAPE THAT IS A SHAPE. Below this a drag is a click that
 * wobbled, and committing one would leave a two-inch cove on the drawing that
 * has to be found before it can be deleted. Same reasoning — and roughly the
 * same figure — as the strip's own length floor.
 */
export const MIN_SPAN_FT = 1.5;

/** How far a corner may be rounded, as a fraction of the shape's smaller side.
 *  Half is a stadium; anything past it is the two fillets meeting and eating
 *  each other, which draws as a shape that stops responding to the slider. */
export const MAX_RADIUS_FRAC = 0.5;

export const newShapeId = () =>
  `cs-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;

/* THE KEEP-OUT RULE ITSELF LIVES IN cove.js, because it is a fact about coves
   rather than about shapes — see coveClearOfOutline. This file knows how to move
   a shape and asks that one whether the answer is allowed. */
import { coveClearOfOutline } from './cove.js';
/* SHIFT MEANS ONE THING IN THIS APP, and it is defined once. The cove pen and
   the track pen both lock through `axisLock`; the slot below reads the same
   function so a locked drag and a locked click cannot end up square to different
   things. */
import { axisLock } from './pen.js';
/* THE TOOLKIT. A shape resolves to a path — `outlineFt` — and everything past
   that point is geometry rather than shape: how long it is, where N points sit
   on it, what it looks like set in or out. See the header of geometry.js for the
   line between the two files. */
import { pathLength, sub, len } from './geometry.js';

// --- small vector helpers ---------------------------------------------------


const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Signed area. Positive is one winding, negative the other; which one it is
 *  does not matter, only that the sign tells outward from inward. */
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Rotate a list of points about a centre, then translate it there. */
const place = (pts, cx, cy, rot) => {
  const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
  return pts.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
};

const circlePts = (cx, cy, r, n = 72) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
};

/**
 * THE VERTICES OF A REGULAR N-GON, before rotation, at circumradius `r`.
 *
 * A SQUARE STARTS AT A CORNER AND EVERYTHING ELSE STARTS AT A POINT, which is
 * the one special case and it is worth stating rather than deriving. A regular
 * 4-gon with a vertex at the top is a DIAMOND; nobody drawing "square" means
 * that, so its first vertex is put at 135 degrees and the shape comes out
 * square to the drawing. A triangle, a pentagon and a hexagon all read right
 * point-up, which is where every other n starts.
 */
function regularPts(n, r) {
  const start = n === 4 ? (-Math.PI * 3) / 4 : -Math.PI / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/**
 * A POLYGON WITH ITS CORNERS ROUNDED, sampled as a polyline.
 *
 * A POLYLINE AND NOT AN SVG ARC, because everything downstream of this file
 * takes a list of points and nothing takes a path: the strip is billed by its
 * own length, the canvas draws it as a run of dots, and the exporters write it
 * into a DXF. One representation that every consumer already reads beats a
 * path string that each of them would have to parse.
 *
 * A TRUE CIRCULAR ARC AND NOT A QUADRATIC BEZIER THROUGH THE CORNER. The
 * Bezier is the two-line version of this and it was here first; it is within a
 * hair of an arc on a shallow turn and visibly long on a sharp one — 0.7% over
 * on an equilateral triangle's 120-degree corners, which is a strip billed 0.7%
 * long. The arc costs a centre and a sweep and is then exact at every angle.
 *
 * `t` — how far back along each edge the fillet starts — is clamped to half of
 * each adjacent edge, so two fillets on a short side cannot cross and turn the
 * shape inside out.
 */
function roundPolygon(pts, r, seg = 10) {
  if (!(r > 1e-6) || pts.length < 3) return pts;
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const d1 = sub(a, p), d2 = sub(b, p);
    const l1 = len(d1), l2 = len(d2);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push(p); continue; }
    const v1 = { x: d1.x / l1, y: d1.y / l1 }, v2 = { x: d2.x / l2, y: d2.y / l2 };
    const ang = Math.acos(clamp(v1.x * v2.x + v1.y * v2.y, -1, 1));
    // A straight-through vertex has nothing to round; a doubled-back one has
    // no bisector to round about.
    if (ang < 1e-3 || Math.PI - ang < 1e-3) { out.push(p); continue; }
    const half = ang / 2;
    const t = Math.min(r / Math.tan(half), l1 / 2, l2 / 2);
    const p1 = { x: p.x + v1.x * t, y: p.y + v1.y * t };
    const p2 = { x: p.x + v2.x * t, y: p.y + v2.y * t };
    // The centre sits on the bisector, far enough in that both tangent points
    // are `rho` away from it.
    const bis = norm({ x: v1.x + v2.x, y: v1.y + v2.y });
    const rho = t * Math.tan(half);
    const c = { x: p.x + bis.x * (t / Math.cos(half)),
                y: p.y + bis.y * (t / Math.cos(half)) };
    const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    // The short way round, always: the fillet turns through PI - ang, which is
    // never more than half a turn.
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let k = 0; k <= seg; k++) {
      const th = a1 + sweep * (k / seg);
      out.push({ x: c.x + Math.cos(th) * rho, y: c.y + Math.sin(th) * rho });
    }
  }
  return out;
}

/**
 * A POLYGON PUSHED OUTWARD BY `d`, vertex by vertex along its own bisector.
 *
 * Used for ONE thing: the tape, which sits three inches outside the line it
 * hides behind (see STRIP_OFFSET_FT in cove.js). At that distance a bisector
 * offset is exact on every convex corner and wrong only where a reflex corner
 * is tighter than the offset — which on a hand-traced outline is a couple of
 * pixels of overlap in the pocket, and on every shape the menu can draw is
 * impossible. The `0.25` floor on the cosine is what stops a near-doubled-back
 * vertex throwing a spike halfway across the room.
 *
 * THE REGULAR SHAPES DO NOT COME THROUGH HERE. A circle grows by growing its
 * radius and an n-gon by growing its circumradius — both exact — so this is the
 * pen's path and nothing else. See `outlineFt`.
 */
function offsetPolygon(pts, d) {
  if (!(Math.abs(d) > 1e-9) || pts.length < 3) return pts;
  const n = pts.length, sgn = signedArea(pts) >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const e1 = norm(sub(p, a)), e2 = norm(sub(b, p));
    const n1 = { x: e1.y * sgn, y: -e1.x * sgn };
    const n2 = { x: e2.y * sgn, y: -e2.x * sgn };
    const m = { x: n1.x + n2.x, y: n1.y + n2.y };
    const ml = len(m);
    if (ml < 1e-9) { out.push(p); continue; }
    const u = { x: m.x / ml, y: m.y / ml };
    const k = d / Math.max(0.25, u.x * n1.x + u.y * n1.y);
    out.push({ x: p.x + u.x * k, y: p.y + u.y * k });
  }
  return out;
}

// --- the shape itself -------------------------------------------------------

/** The corner radius this shape is allowed, given how big it is. */
export function maxRadiusFt(shape) {
  const b = bboxFt({ ...shape, radiusFt: 0 });
  return Math.max(0, Math.min(b.x1 - b.x0, b.y1 - b.y0) * MAX_RADIUS_FRAC);
}

/** Can this shape's corners be rounded at all? A circle has none. */
/** Can this shape's corners be rounded at all? A circle has none, and a slot's
 *  corners are where it turns rather than where it closes — rounding one would
 *  pull its ends off the walls they are pinned to. */
export const roundable = (shape) => shape?.kind !== 'circle' && !isOpen(shape);

/**
 * THE CLOSED OUTLINE, IN PLAN FEET.
 *
 * `grow` pushes it outward by that many feet, and it is how the tape is drawn:
 * the same call, three inches out. Growing a shape is NOT scaling it — a
 * hexagon offset by 3 in has the same corner angles and longer sides, where a
 * hexagon scaled up has neither — so each family grows the way its own geometry
 * says it does, and only the pen falls back to a generic polygon offset.
 *
 * THE CORNER RADIUS GROWS WITH IT, which is what keeps the pocket a constant
 * width all the way round a rounded corner. Offsetting a rounded shape without
 * it would put the tape 3 in from the flats and 3 in from a DIFFERENT centre on
 * the curves.
 */
/**
 * IS THIS A SLOT ACROSS THE CEILING RATHER THAN A POCKET ROUND A PIECE OF IT?
 *
 * Asked in a dozen places and answered here once. A `line` always is; a `pen`
 * path is whichever it was finished as — clicking the first point closes it,
 * and Enter with both ends on a wall leaves it open. See SHAPE_TOOLS.
 */
export const isOpen = (shape) =>
  shape?.kind === 'line' || (shape?.kind === 'pen' && !!shape.open);

export function outlineFt(shape, grow = 0) {
  if (!shape) return [];
  const g = grow || 0;
  const { x = 0, y = 0, rot = 0 } = shape;
  const rr = Math.max(0, shape.radiusFt || 0) + g;

  /* --- AN OPEN COVE IS ITS OWN LINE, AND `grow` DOES NOTHING TO IT ----------
     Every closed shape here has an inside and an outside, and `grow` is how the
     tape gets three inches outside the setting-out line. A slot has neither: the
     tape runs ALONG it, down the middle of the pocket, so there is nowhere for
     an offset to go. Offsetting it anyway would produce a second line three
     inches to one side — which side being an accident of the winding — and the
     drawing would carry two parallel runs for one detail.
     SO THE LINE IS THE TAPE, and everything that asks for the grown outline gets
     the same points back. The caller that draws both (see `coveShapesPx`) knows
     to draw one. */
  if (isOpen(shape)) return place(shape.pts ?? [], x, y, rot);

  if (shape.kind === 'circle') {
    return circlePts(x, y, Math.max(0.05, (shape.rFt || 0) + g), 72);
  }
  if (shape.kind === 'rect') {
    const w = Math.max(0.05, (shape.wFt || 0) + 2 * g);
    const h = Math.max(0.05, (shape.hFt || 0) + 2 * g);
    const box = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 },
                 { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
    return roundPolygon(place(box, x, y, rot), rr);
  }
  if (shape.kind === 'pen') {
    const pts = place(shape.pts ?? [], x, y, rot);
    if (pts.length < 3) return pts;
    return roundPolygon(offsetPolygon(pts, g), rr);
  }
  // square, triangle, polygon — one regular n-gon with three names.
  //
  // THE CIRCUMRADIUS GROWS BY `g / cos(PI/n)` AND NOT BY `g`. An offset moves
  // every EDGE out by g, which is the apothem; the distance from the centre to
  // a CORNER then grows by more, and by exactly that factor. Growing the
  // circumradius by g instead would leave the tape short of the line on the
  // flats and past it at the corners, which on a triangle is visible.
  const n = sidesOf(shape);
  const r = Math.max(0.05, (shape.rFt || 0) + g / Math.cos(Math.PI / n));
  return roundPolygon(place(regularPts(n, r), x, y, rot), rr);
}

/**
 * THE SHAPE'S CORNERS, IN PLAN FEET — and nothing else on its outline.
 *
 * WHY THIS CANNOT BE READ OFF `outlineFt`. That function returns a POLYLINE,
 * because everything downstream of this file takes a list of points: a circle
 * comes back as 72 of them, and any shape with a corner radius comes back with
 * ten per fillet. Counting the points in it would say a circle has 72 corners
 * and a rounded rectangle 40, which is the opposite of true — and the whole use
 * of this function is to answer "how many places on this shape is a lamp
 * OBLIGED to sit". See `arraySpots` in lib/cob.js.
 *
 * THE UNROUNDED CORNERS, DELIBERATELY. A rounded rectangle's sharp corner is
 * not ON its outline any more — the fillet cut it off — and this returns it
 * anyway, because the caller projects each of these onto the path it is actually
 * setting out on. Projected onto a fillet, a sharp corner lands at the middle of
 * the arc, which is exactly where the corner of a rounded rectangle reads as
 * being. Returning the two fillet ENDS instead would put two lamps either side
 * of a corner and none at it.
 *
 * `grow` IS NOT TAKEN, AND THAT IS THE SAME ARGUMENT. An array is set out on an
 * offset path and the caller offsets it; the corners of the offset ring are
 * where these project to. Growing them here would be a second offset rule to
 * keep in step with `offsetPolygon`'s.
 *
 * EMPTY FOR A CIRCLE, which is a fact about a circle and not a gap: there is
 * nowhere on it a lamp is obliged to sit, so a run on one is spaced freely.
 * That is what the caller reads an empty list as.
 *
 * AN OPEN SHAPE RETURNS ITS OWN POINTS, ends included. Both ends of a slot are
 * corners in the sense that matters here — they are places the run must reach —
 * which is the same statement `pointsAlong`'s `ends` option makes.
 */
export function cornersFt(shape) {
  if (!shape) return [];
  const { x = 0, y = 0, rot = 0 } = shape;
  if (isOpen(shape)) return place(shape.pts ?? [], x, y, rot);
  if (shape.kind === 'circle') return [];
  if (shape.kind === 'rect') {
    const w = Math.max(0.05, shape.wFt || 0), h = Math.max(0.05, shape.hFt || 0);
    return place([{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 },
                  { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }], x, y, rot);
  }
  if (shape.kind === 'pen') return place(shape.pts ?? [], x, y, rot);
  // square, triangle, polygon — one regular n-gon with three names.
  return place(regularPts(sidesOf(shape), Math.max(0.05, shape.rFt || 0)), x, y, rot);
}

/** How many sides this shape has, whatever it calls itself. */
export const sidesOf = (shape) => (
  shape.kind === 'triangle' ? 3
  : shape.kind === 'square' ? 4
  : clamp(Math.round(shape.sides || POLY_SIDES.initial), POLY_SIDES.min, POLY_SIDES.max));

/**
 * The outline's own length, which is what a strip is billed by.
 *
 * `closed` DEFAULTS TRUE because every shape in this file was a closed one when
 * it was written, and a run that does not come back to its start must not be
 * billed for the leg home — on an L across a room that leg is the diagonal, and
 * it is the longest part of what would be ordered.
 */
/* THE TOOLKIT'S, WITH THIS FILE'S DEFAULT KEPT. `pathLength` in geometry.js is
   the one implementation — see the note at the top of that file for why there
   used to be two and what that cost. What stays here is the DEFAULT: a shape's
   outline is a closed loop unless it says otherwise, which is the opposite of
   the toolkit's conservative reading of a bare list of points, and flipping it
   would silently shorten every cove on every plan by one leg. */
export const pathLengthFt = (pts, { closed = true } = {}) =>
  pathLength(pts, { closed });

/** How long a shape's tape is, whichever kind it is. */
export const runLengthFt = (shape) =>
  pathLengthFt(outlineFt(shape), { closed: !isOpen(shape) });

/** The box the shape fits in, in plan feet. */
export function bboxFt(shape, grow = 0) {
  const pts = outlineFt(shape, grow);
  if (!pts.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys),
           x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * THE RECTANGLE THE GRID IS CUT ON — the closest rectangle the shape fits in.
 *
 * THE BOUNDING BOX AND NOT AN INSCRIBED ONE, and the choice is the whole of
 * what this feature promises. Inscribed would keep every downlight strictly
 * inside the drawn outline and would shrink a circle's usable ceiling to 70%
 * of itself for no reason anybody asked for; the bounding box is what a
 * plasterer squares the inner ceiling up to, which is the thing being drawn.
 *
 * Rounded to a hundredth of a foot so that nudging a shape by a sub-pixel
 * amount does not mint a new chunk key and re-run the whole layout.
 */
export function coveRectFt(shape) {
  const b = bboxFt(shape);
  const r = (v) => Math.round(v * 100) / 100;
  return { x0: r(b.x0), y0: r(b.y0), x1: r(b.x1), y1: r(b.y1) };
}

/** How far a point is from a segment. */
function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/**
 * Is this point ON the shape?
 *
 * POINT-IN-POLYGON FOR A POCKET AND DISTANCE-TO-THE-LINE FOR A SLOT, and the
 * two are not interchangeable: a slot has no interior, so the containment test
 * answers false everywhere and an open cove would be an object nobody could
 * pick up. `tolFt` is the grab band either side of the line, which for a closed
 * shape is a grown outline and for this is what it says.
 */
export function hitShape(shape, pFt, tolFt = 0) {
  if (isOpen(shape)) {
    const pts = outlineFt(shape);
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSeg(pFt, pts[i], pts[i + 1]) <= Math.max(tolFt, 1e-6)) return true;
    }
    return false;
  }
  const pts = outlineFt(shape, tolFt);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > pFt.y) !== (b.y > pFt.y)
        && pFt.x < ((b.x - a.x) * (pFt.y - a.y)) / (b.y - a.y || 1e-12) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The same shape, somewhere else. */
export const movedShape = (shape, dxFt, dyFt) =>
  ({ ...shape, x: shape.x + dxFt, y: shape.y + dyFt });

/**
 * A COVE, STOPPED AT THE KEEP-OUT BAND ROUND THE ROOM'S WALLS.
 *
 * THE RULE IS `coveClearOfOutline` AND THIS IS THE SAME RULE FELT RATHER THAN
 * REPORTED. A shape drawn across a wall is refused as a cove — it stays on the
 * drawing, inert, and somebody has to work out why. A shape DRAGGED at a wall
 * should simply stop, the way the light in a cell stops at the edge of its own
 * band: the limit is then something you meet rather than something you are told
 * about afterwards.
 *
 * TWO PASSES, AND THE SECOND IS WHAT MAKES IT SLIDE.
 *
 *   1. Clamp against the room's own extent, inset by the gap, one axis at a
 *      time. On a rectangular room that is the whole answer and it is exact —
 *      push into a wall and the cove slides ALONG it, which is what a clamp
 *      should feel like.
 *   2. A room is not always rectangular, and its bounding box knows nothing
 *      about a notch: an L's inside corner is well within the box and is still a
 *      wall. So each axis is then walked back until it is legal — bisected, one
 *      axis at a time, x first and y against whatever x settled on. Testing the
 *      clamped position and giving up on failure was the version before this,
 *      and it did not slide: pushed at a notch the cove stopped dead where it
 *      was instead of travelling the three feet it could have.
 *
 * A shape too big for the room it is in has nowhere legal to go at all; it
 * stays where it was rather than being squeezed to fit.
 */
export function clampCoveMove(shape, want, polygon = [], gap = 0) {
  if (!polygon.length) return want;
  const b = bboxFt(shape);
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const lo = { x: Math.min(...xs) + gap, y: Math.min(...ys) + gap };
  const hi = { x: Math.max(...xs) - gap, y: Math.max(...ys) - gap };
  // The room may be narrower than the shape on an axis; then there is no legal
  // travel at all and `min` would come out above `max`.
  const axis = (k) => {
    const room = { min: lo[k] - b[`${k}0`], max: hi[k] - b[`${k}1`] };
    if (room.min > room.max) return 0;
    return Math.max(room.min, Math.min(room.max, want[k] - shape[k]));
  };
  const d = { x: axis('x'), y: axis('y') };
  const legal = (dx, dy) => coveClearOfOutline(
    { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy }, polygon, gap);
  if (legal(d.x, d.y)) return { x: shape.x + d.x, y: shape.y + d.y };
  // How much of a wanted travel is legal, with the other axis held. Fourteen
  // halvings settle it to under a hundredth of an inch on any real room.
  const walk = (dx, dy, along) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const t = (lo + hi) / 2;
      if (legal(along === 'x' ? dx * t : dx, along === 'y' ? dy * t : dy)) lo = t;
      else hi = t;
    }
    return lo;
  };
  const dx = d.x * walk(d.x, 0, 'x');
  const dy = d.y * walk(dx, d.y, 'y');
  return legal(dx, dy) ? { x: shape.x + dx, y: shape.y + dy }
                       : { x: shape.x, y: shape.y };
}

/**
 * CAN THIS SHAPE BE STRETCHED, or only scaled?
 *
 * IT IS A QUESTION ABOUT THE MODEL AND NOT ABOUT THE GESTURE. A rectangle has
 * two dimensions and a traced path has as many as it has points, so both can be
 * squashed. A circle has ONE — squashing it asks for an ellipse, which this app
 * has no way to hold, draw or bill — and a regular polygon has one for the same
 * reason: a hexagon with unequal sides is not a hexagon, it is a hand-traced
 * outline that happens to have six points, and if that is what somebody wants
 * the pen is the tool for it.
 *
 * THE SQUARE IS IN THE STRETCHY LIST AND IT IS THE INTERESTING CASE. It is
 * stored as a regular 4-gon, so on its own terms it should be uniform-only —
 * but a square stretched is a RECTANGLE, which is a shape this model already
 * has. So it converts rather than refusing. See `resizeShape`.
 */
export const stretchy = (shape) =>
  !isOpen(shape)
  && (shape?.kind === 'rect' || shape?.kind === 'pen' || shape?.kind === 'square');

/** The box the shape's own geometry fits in, WITHOUT its corner radius.
 *  Rounding a corner pulls the outline in a little — visibly so on a triangle's
 *  apex — and a resize measured off the rounded outline would therefore shrink
 *  the shape a fraction every time the radius was touched. */
const baseBox = (shape) => bboxFt({ ...shape, radiusFt: 0 });

/**
 * A CORNER OR AN EDGE, DRAGGED.
 *
 * `handle` is a sign pair in the bounding box's own axes — {sx: 1, sy: -1} is
 * the top-right corner, {sx: 1, sy: 0} the right edge — and THE SIDE OPPOSITE
 * IT STAYS NAILED DOWN. That one rule is the whole of why a resize feels direct
 * rather than slippery: grab the bottom-right and the top-left does not move,
 * so the shape grows under your hand instead of sliding away beneath it. It is
 * the same rule `resizeFromCorner` follows for a ceiling object, said about a
 * bounding box because that is what every shape here has in common.
 *
 * THE ANCHOR IS RECOMPUTED FROM THE SHAPE ON EVERY MOVE, which is safe
 * precisely because the anchor does not move: a resize leaves the opposite side
 * exactly where it was, so reading it back off the new shape gives the same
 * answer. That is what lets this be written straight into the list per frame,
 * with no start-of-gesture state to carry.
 *
 * `uniform` is Shift. A shape that cannot be stretched is uniform whether or not
 * Shift is held — see `stretchy`.
 *
 * THE CORNER RADIUS SURVIVES, which is the point of it being a property rather
 * than a shape of its own. It is clamped only where the geometry forces it: a
 * 3 ft radius on a shape dragged down to 4 ft across is two fillets meeting in
 * the middle, and the drawing would stop responding to the slider.
 */
export function resizeShape(shape, handle, pointerFt, { uniform = false } = {}) {
  const b = baseBox(shape);
  const w0 = Math.max(1e-6, b.x1 - b.x0), h0 = Math.max(1e-6, b.y1 - b.y0);
  const anchor = {
    x: handle.sx > 0 ? b.x0 : handle.sx < 0 ? b.x1 : (b.x0 + b.x1) / 2,
    y: handle.sy > 0 ? b.y0 : handle.sy < 0 ? b.y1 : (b.y0 + b.y1) / 2,
  };
  // An edge handle says nothing about the other axis, so that axis keeps what
  // it had — until a uniform scale below decides otherwise.
  const w = handle.sx ? Math.max(MIN_SPAN_FT, Math.abs(pointerFt.x - anchor.x)) : w0;
  const h = handle.sy ? Math.max(MIN_SPAN_FT, Math.abs(pointerFt.y - anchor.y)) : h0;
  let kx = w / w0, ky = h / h0;
  if (uniform || !stretchy(shape)) {
    // A CORNER TAKES THE BIGGER OF THE TWO so the shape follows the pointer
    // rather than lagging behind whichever axis moved less; an edge has only
    // one to take.
    const k = handle.sx && handle.sy ? Math.max(kx, ky) : (handle.sx ? kx : ky);
    kx = k; ky = k;
  }
  const w1 = w0 * kx, h1 = h0 * ky;
  // Where the new box has to land for the anchor side to have stayed put.
  const x0 = handle.sx > 0 ? anchor.x : handle.sx < 0 ? anchor.x - w1 : anchor.x - w1 / 2;
  const y0 = handle.sy > 0 ? anchor.y : handle.sy < 0 ? anchor.y - h1 : anchor.y - h1 / 2;

  let next;
  if (shape.kind === 'rect') {
    next = { ...shape, wFt: w1, hFt: h1 };
  } else if (shape.kind === 'square') {
    next = Math.abs(w1 - h1) < 1e-6
      ? { ...shape, rFt: w1 / Math.SQRT2 }
      // A SQUARE STRETCHED IS A RECTANGLE, and saying so is better than
      // refusing the drag or quietly keeping it square under the pointer. The
      // two are one family and the model already holds both; only the name
      // changes, and the name was never the thing being drawn.
      : { ...shape, kind: 'rect', wFt: w1, hFt: h1, rFt: null, sides: null };
  } else if (shape.kind === 'circle') {
    next = { ...shape, rFt: Math.max(w1, h1) / 2 };
  } else if (shape.kind === 'pen') {
    next = { ...shape, pts: (shape.pts ?? []).map((q) => ({ x: q.x * kx, y: q.y * ky })) };
  } else {
    // A regular n-gon, which kx and ky are equal for by construction above.
    next = { ...shape, rFt: (shape.rFt || 0) * kx };
  }

  // AND PLACED BY ITS OWN BOX, not by its centre. A triangle's centre is not the
  // middle of the box it fits in — its apex is further from the centre than its
  // base is — so anchoring on the centre would let the corner opposite the
  // handle creep as the shape grew.
  const lb = baseBox({ ...next, x: 0, y: 0 });
  const placed = { ...next, x: x0 - lb.x0, y: y0 - lb.y0 };
  return { ...placed, radiusFt: Math.min(placed.radiusFt || 0, maxRadiusFt(placed)) };
}

/**
 * THE HANDLES A SHAPE OFFERS, as sign pairs. Corners always; edges only where
 * the axes can move independently, because an edge handle on a circle would be
 * a grip that silently does the same thing as the corner beside it.
 */
export function handlesFor(shape) {
  /* A SLOT HAS NO GRIPS AT ALL, and that is not an omission. Its ends are pinned
     to the walls — see `spanOnOutline` — so a corner drag on its bounding box
     would pull them off the plaster, and a slot floating in the middle of a room
     is a detail nobody can build. It is moved and deleted; to change where it
     goes, draw it again. */
  if (isOpen(shape)) return [];
  const corners = [{ sx: -1, sy: -1 }, { sx: 1, sy: -1 },
                   { sx: 1, sy: 1 }, { sx: -1, sy: 1 }];
  if (!stretchy(shape)) return corners;
  return [...corners, { sx: 0, sy: -1 }, { sx: 1, sy: 0 },
                      { sx: 0, sy: 1 }, { sx: -1, sy: 0 }];
}

/** The frame the handles sit on: the shape's own box, radius excluded. */
export const frameFt = (shape) => baseBox(shape);

/**
 * THE SHAPE A DRAG HAS MADE SO FAR.
 *
 * `a` is where the press landed and `b` is where the pointer is. What that
 * pair MEANS is the tool's own business: a rectangle reads them as two
 * opposite corners, and everything else reads `a` as the centre and the
 * distance to `b` as the radius. See `centred` in SHAPE_TOOLS.
 *
 * `uniform` is Shift, and on a rectangle it means "square". On a shape that is
 * already regular it has nothing to say.
 */
export function shapeFromDrag(kind, aFt, bFt, { sides = POLY_SIDES.initial,
                                                uniform = false,
                                                radiusFt = 0 } = {}) {
  // A LINE IS THE ONE DRAG WHOSE TWO ENDS ARE BOTH REAL POINTS — not a corner
  // and its opposite, not a centre and a radius, but the two ends of the slot.
  if (kind === 'line') return lineShape(aFt, bFt);
  if (kind === 'rect') {
    let w = Math.abs(bFt.x - aFt.x), h = Math.abs(bFt.y - aFt.y);
    let cx = (aFt.x + bFt.x) / 2, cy = (aFt.y + bFt.y) / 2;
    if (uniform) {
      const s = Math.max(w, h);
      cx = aFt.x + Math.sign(bFt.x - aFt.x || 1) * s / 2;
      cy = aFt.y + Math.sign(bFt.y - aFt.y || 1) * s / 2;
      w = s; h = s;
    }
    return { kind: 'rect', x: cx, y: cy, wFt: w, hFt: h, rot: 0, radiusFt };
  }
  const r = Math.hypot(bFt.x - aFt.x, bFt.y - aFt.y);
  if (kind === 'circle') {
    return { kind: 'circle', x: aFt.x, y: aFt.y, rFt: r, rot: 0, radiusFt: 0 };
  }
  const n = kind === 'triangle' ? 3 : kind === 'square' ? 4
    : clamp(Math.round(sides), POLY_SIDES.min, POLY_SIDES.max);
  return { kind, x: aFt.x, y: aFt.y, rFt: r, sides: n, rot: 0, radiusFt };
}

/**
 * A PEN PATH, CLOSED WHETHER OR NOT SOMEBODY CLOSED IT.
 *
 * "Close the shape automatically if not closed" is the whole of the rule and it
 * is one line of geometry — the last point joins the first, because a cove is a
 * pocket and a pocket that does not meet itself is a detail that cannot be
 * built. What takes the space is the SANITISING either side of it: a duplicate
 * last click (the one that landed on the first point to close it by hand) has
 * to go, or the outline carries a zero-length edge that every offset and every
 * fillet then has to defend itself against.
 *
 * Stored about its own centroid rather than about the first click, so moving a
 * pen shape moves it the way every other shape moves — from the middle.
 */
export function penShape(ptsFt, { radiusFt = 0, open = false } = {}) {
  const pts = [];
  for (const p of ptsFt ?? []) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-4) continue;
    pts.push(p);
  }
  // The closing click, if there was one, is now the first point again.
  while (pts.length > 2
         && Math.hypot(pts[pts.length - 1].x - pts[0].x,
                       pts[pts.length - 1].y - pts[0].y) < 1e-4) pts.pop();
  /* TWO POINTS IS A SLOT AND THREE IS A POCKET. An open run only needs somewhere
     to start and somewhere to stop; a closed one needs an area, and two points
     enclose none. */
  if (pts.length < (open ? 2 : 3)) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return {
    kind: 'pen', x: cx, y: cy, rot: 0, radiusFt,
    ...(open ? { open: true } : null),
    pts: pts.map((p) => ({ x: p.x - cx, y: p.y - cy })),
  };
}

/**
 * A SLOT FROM ONE WALL TO ANOTHER — two points, and both of them are somebody
 * else's problem: this takes the pair it is given and shapes them. Where they
 * are allowed to be is `spanOnOutline`'s question, and it is asked before this
 * is called so that a refused span never becomes a shape at all.
 *
 * Held about its own centroid like a pen path, so it moves, hit-tests and draws
 * through the same code every other shape does.
 */
export function lineShape(aFt, bFt) {
  if (!aFt || !bFt) return null;
  if (Math.hypot(bFt.x - aFt.x, bFt.y - aFt.y) < 1e-4) return null;
  const cx = (aFt.x + bFt.x) / 2, cy = (aFt.y + bFt.y) / 2;
  return {
    kind: 'line', x: cx, y: cy, rot: 0, radiusFt: 0, open: true,
    pts: [{ x: aFt.x - cx, y: aFt.y - cy }, { x: bFt.x - cx, y: bFt.y - cy }],
  };
}

/** Big enough to be a shape? See MIN_SPAN_FT. */
export function bigEnough(shape) {
  if (!shape) return false;
  /* A SLOT IS MEASURED ALONG ITSELF AND NOT ACROSS ITS BOX. A cove running the
     length of one wall is a rectangle a foot high and twenty feet long as far as
     a bounding box is concerned, and the box test would refuse it for being thin
     — which is the one dimension a slot does not have. */
  if (isOpen(shape)) return runLengthFt(shape) >= MIN_SPAN_FT;
  const b = bboxFt(shape);
  return (b.x1 - b.x0) >= MIN_SPAN_FT && (b.y1 - b.y0) >= MIN_SPAN_FT;
}

/* ---------------------------------------------------------------------------
   PINNING A SLOT'S ENDS TO THE WALLS.

   A COVE THAT STOPS IN MID-AIR IS NOT A DETAIL. The pocket is formed in
   plasterboard and the board has to land on something: a slot runs wall to wall,
   or it runs to a bulkhead that is itself a wall. So both ends of an open cove
   are PROJECTED onto the room's outline rather than merely checked against it —
   the end goes where the wall is, not where the pointer was, which is the same
   move `placeZone` makes for a sconce and for the same reason. A tolerance would
   mean a cove that is nearly on the wall, which is a cove nobody can set out.

   AND THE TWO ENDS MUST BE ON DIFFERENT WALLS. Both on one wall is not a slot
   across the ceiling, it is a line lying along the plaster — which is a reverse
   cove, and this app already has a tool for that. Refusing it here is what stops
   the two details being drawn with the wrong one.
   --------------------------------------------------------------------------- */

/**
 * The closest point on a polygon's boundary, and which edge it landed on.
 *
 * `{ x, y, edge, dist }`, or null for a polygon that is not one. `edge` is the
 * index of the side it sits on — the run from point i to point i+1 — which is
 * what "a different wall" is asked against.
 */
export function projectOnOutline(pFt, polygonFt) {
  const poly = polygonFt ?? [];
  if (poly.length < 2 || !pFt) return null;
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const vx = b.x - a.x, vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    if (l2 < 1e-12) continue;
    const t = clamp(((pFt.x - a.x) * vx + (pFt.y - a.y) * vy) / l2, 0, 1);
    const q = { x: a.x + vx * t, y: a.y + vy * t };
    const d = Math.hypot(pFt.x - q.x, pFt.y - q.y);
    if (!best || d < best.dist) best = { x: q.x, y: q.y, edge: i, dist: d };
  }
  return best;
}

/**
 * WHERE A RAY LEAVES THE ROOM — the first wall it crosses, and which one.
 *
 * Only the locked span needs this, and it is the whole of why the lock can be
 * exact. Projecting a locked pointer onto the nearest wall would put the far end
 * NEAR the axis and ON the wall, which is not the same thing as on both: the run
 * would come out a degree or two off square, which on a ceiling detail is the
 * difference between a drawing and a drawing somebody has to correct. Walking
 * the ray out to the plaster gives a point that is exactly on the axis AND
 * exactly on the wall, because it is the intersection of the two.
 *
 * THE FIRST CROSSING AND NOT THE FURTHEST. An L-shaped room's outline can be
 * crossed twice by one ray; the cove stops at the first wall it meets, the way
 * the plasterboard would.
 *
 * `eps` KEEPS IT OFF ITS OWN STARTING WALL. `from` is a point already ON the
 * boundary, so the edge it sits on intersects at t = 0 — which is the ray
 * arriving rather than leaving.
 */
export function rayExit(from, dir, polygonFt) {
  const poly = polygonFt ?? [];
  if (poly.length < 2 || !dir) return null;
  const eps = 1e-6;
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-12) continue;               // parallel: never crosses
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
    const u = ((a.x - from.x) * dir.y - (a.y - from.y) * dir.x) / den;
    if (t <= eps || u < -1e-9 || u > 1 + 1e-9) continue;
    if (!best || t < best.t) {
      best = { t, x: from.x + dir.x * t, y: from.y + dir.y * t, edge: i };
    }
  }
  return best;
}

/**
 * BOTH ENDS OF A SLOT, PUT ON THE WALLS, or null if this span cannot be one.
 *
 * Takes the two points the pointer named and returns the pair that would
 * actually be built: `{ a, b, edgeA, edgeB }`. Null means refuse, and there are
 * three reasons — the ends came out on the same wall, the run that is left is
 * too short to be a run, or a locked run was aimed along the wall it started
 * from. All three are refusals a person can act on by moving the pointer, which
 * is why this is asked on every move and not only on release.
 *
 * `lock` IS SHIFT, AND IT IS THE SAME LOCK THE PEN HAS — horizontal or vertical,
 * whichever the drag is more nearly already making. See `axisLock`, which is
 * imported rather than reimplemented so the two tools cannot come to disagree
 * about what Shift means.
 */
export function spanOnOutline(aFt, bFt, polygonFt, { lock = false } = {}) {
  const a = projectOnOutline(aFt, polygonFt);
  if (!a) return null;

  let b;
  if (lock) {
    const to = axisLock(a, bFt);
    const d = { x: to.x - a.x, y: to.y - a.y };
    const l = Math.hypot(d.x, d.y);
    if (l < 1e-9) return null;
    /* A LOCKED RAY ALONG THE WALL IT STARTED ON IS NOT A SLOT. It would run to
       the far corner and be caught by whichever wall turns there — two different
       edges by the letter of the rule, and a line lying flat on the plaster in
       fact, which is a reverse cove. Refused here rather than let through on a
       technicality. */
    const w = poly2(polygonFt, a.edge);
    if (w && Math.abs((d.x / l) * w.x + (d.y / l) * w.y) > 0.999) return null;
    b = rayExit(a, { x: d.x / l, y: d.y / l }, polygonFt);
  } else {
    b = projectOnOutline(bFt, polygonFt);
  }

  if (!b || a.edge === b.edge) return null;
  if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SPAN_FT) return null;
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, edgeA: a.edge, edgeB: b.edge };
}

/** The unit direction of one edge of a polygon. */
function poly2(polygonFt, i) {
  const poly = polygonFt ?? [];
  if (i == null || i < 0 || i >= poly.length) return null;
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return l < 1e-9 ? null : { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/**
 * IS THIS PEN PATH A SLOT? Both ends on the outline, and enough of a run in
 * between — the L-shaped case, where the corners are wherever somebody put them
 * and only the two ends are answerable to the walls.
 *
 * `tolFt` IS REAL HERE WHERE IT IS NOT FOR A LINE, and the difference is the
 * gesture. A line is DRAGGED, so its ends can be projected onto the wall
 * continuously and land exactly on it. A pen path is CLICKED, and the clicks
 * that are not ends are free points in the middle of the room — projecting the
 * last one would move a corner somebody placed. So the path is offered as it was
 * drawn, and this says whether it may be finished open.
 */
export function penSpansOutline(ptsFt, polygonFt, tolFt) {
  const pts = ptsFt ?? [];
  if (pts.length < 2) return false;
  const a = projectOnOutline(pts[0], polygonFt);
  const b = projectOnOutline(pts[pts.length - 1], polygonFt);
  if (!a || !b) return false;
  return a.dist <= tolFt && b.dist <= tolFt
    && pathLengthFt(pts, { closed: false }) >= MIN_SPAN_FT;
}

/** A finished shape: whatever the draft was, plus an identity. */
/* --- WHAT A SHAPE IS FOR, WHICH IS NOT THE SAME AS WHAT IT IS ---------------
   EVERY SHAPE IN THIS FILE WAS A COVE, because the only way to draw one was the
   cove tool. That was never true of the geometry: a rectangle is a rectangle,
   and the ceiling design taking it up as a pocket is one thing you might do with
   it. Spots set out in an array round it, offset a foot inside it, is another —
   and the two have to be the SAME rectangle, or moving one will not move the
   other.

   SO A SHAPE CARRIES A ROLE, and the cove pipeline consumes only its own.

     cove    the layout takes it up: it cuts the grid, it grows a host chunk
             round itself, and it produces a length of tape.
     guide   it is geometry and nothing else. Nothing is billed from it and
             nothing is drawn on it; it is a line on the ceiling that other
             tools can measure from.

   'cove' IS THE ABSENT VALUE AND THAT IS DELIBERATE. Every shape ever saved
   predates this field, and every one of them is a cove — so the default has to
   be the one that keeps those plans reading as they did. It is also the rule
   this file's neighbours already follow for an option with a normal answer: a
   standard ceiling stores nothing (see `designPicks` in App.jsx), and neither
   does a cove. `role` appears in the record only when somebody drew a guide. */
/* --- THE ROLES, AND WHAT EACH ONE MEANS FOR THE PIPELINE --------------------
   THREE THINGS CAN BE DRAWN WITH ONE SET OF PRIMITIVES, and the outline is the
   only thing they have in common. What separates them is what the drawing DOES
   with it afterwards:

     cove    A PIECE OF BUILDING. Its setting-out line cuts the ceiling, no grid
             cell may straddle it, nothing may sit near it, and it is billed as
             tape by the metre. This is the default, and it is the default
             because it is the only role with consequences — a shape whose role
             was lost in a bad read should come back as the one the rest of the
             app already knows how to handle.
     guide   A LINE TO SET OUT FROM. Nothing is built on it and nothing is
             ordered for it; it exists so an array, a cove or a track can be
             positioned against something exact.
     track   A MAGNETIC TRACK PROFILE. A carrier: visible from the floor, billed
             by the metre with a corner join per turn, and carrying modules
             clipped along it by hand. See lib/magTrack.js.

   `isBuilt` IS THE TEST THE COVE PIPELINE ASKS, and it is stated as "is this a
   cove" rather than as "is this not a guide". The difference is which way a
   NEW role falls: written the other way, adding `track` silently fed every
   track shape into the chunker as a cove — a run of profile re-cutting the grid
   and appearing in the schedule as tape. A role this file has not been told
   about is not built. */
/* A MISSING ROLE IS A COVE AND AN UNRECOGNISED ONE IS ITSELF, which is the
   safe reading of each. Missing has to be a cove: every plan saved before roles
   existed holds shapes with no key, and they were coves. An unrecognised STRING
   is the opposite case — a newer build wrote a role this one has not been told
   about — and normalising it to 'cove' would quietly BUILD it, re-cutting the
   grid and billing tape for something nobody here can name. Returned as-is, it
   is not a cove, not a guide and not a track, and the pipeline leaves it
   alone. */
export const roleOf = (shape) => (shape?.role ? shape.role : 'cove');
export const isGuide = (shape) => roleOf(shape) === 'guide';
export const isTrack = (shape) => roleOf(shape) === 'track';
export const isBuilt = (shape) => roleOf(shape) === 'cove';

/* THE ROLE RIDES ALONG UNLESS IT IS THE DEFAULT, which keeps a plan's stored
   shapes as small as they were and is why `roleOf` reads a missing key as
   'cove'. IT WAS `role === 'guide' ? ... : {}` and that was a trap with exactly
   one role in it: sealing a draft as 'track' wrote no role at all and committed
   a cove. Anything but the default is written out. */
export const sealShape = (draft, role = 'cove') => ({
  ...draft, id: newShapeId(),
  ...(role && role !== 'cove' ? { role } : {}),
});

/**
 * MAY THIS PRESS TAKE THIS SHAPE AS THE SHAPE TOOL'S DRAFT?
 *
 * A PURE FUNCTION FOR A RULE THAT HAS NOW BEEN GOT WRONG TWICE, which is the
 * only reason it is not four lines inline in the press handler. It is a truth
 * table about which tool owns a press, and a truth table belongs somewhere it
 * can be enumerated — see tools/test-mag-track.mjs.
 *
 * --- THE BUG IT EXISTS TO STOP ---------------------------------------------
 *
 * THE GEOMETRY BAR STAYS OPEN WHILE A TRACK MODULE IS ARMED, deliberately: you
 * clip a diffuser on, then draw a second run, and the bar is how the second run
 * gets drawn. So `shapeMenuOn` is true at the moment somebody presses a track to
 * place a module on it — and the take-branch, which only asked whether the bar
 * was open and whether the shape was of another role, swallowed that press and
 * converted the track into a fresh draft. Nothing was ever placed. The diffuser
 * and the spot were both simply unreachable.
 *
 * --- SO: AN ARMED TOOL OWNS THE PRESS ---------------------------------------
 *
 * `addTool` IS THE WHOLE FIX AND IT IS THE CANVAS'S OLDEST RULE. Every branch of
 * the press handler is ordered by it — "a tool that is armed owns the next
 * click, and any path that lets selection or a ceiling object see it first is a
 * path where the click does two things". The shape tool is not exempt from that
 * simply because its bar is still on screen: a bar with no primitive picked owns
 * nothing.
 *
 * THE OTHER THREE CONDITIONS ARE THE ORIGINAL RULE, unchanged:
 *   the bar has to be OPEN, armed or not — pressing a guide with the bar merely
 *   open is how a magnetic track is spanned from one, and requiring a primitive
 *   first would mean arming a rectangle you are not going to draw;
 *   no PEN PATH may be in flight, because a click mid-path is a corner;
 *   and the shape must be of ANOTHER ROLE, or a press on bare ceiling inside an
 *   existing cove could not span a second one across it.
 *
 * --- ...AND A GUIDE BORROWS NOTHING -----------------------------------------
 *
 * THE FOURTH CONDITION, AND IT IS THE ONE THE THREE-ROLE WORLD NEEDED. "Another
 * role" was written when there were two of them and it read symmetrically on
 * purpose: a cove spans from a guide, and a guide could be traced off a cove.
 * With `track` added, and with the GUIDE bar being the one a plain click on a
 * space raises — unarmed, see `openShapeTool` and `onCanvasClick` — that
 * symmetry stopped being a nicety and became a canvas nobody could touch.
 *
 * WHAT IT COST. Click any room and the guide bar is up. From that moment every
 * press on a drawn cove and every press on a magnetic track was a press that
 * BORROWED its outline as a guide draft instead of selecting it: no cove could
 * be picked, none could be double-pressed for its grips, and no track could be
 * picked up — while the modules clipped along that track, which have a press
 * handler of their own, went on selecting perfectly. That is exactly how it was
 * reported, and it is one condition wide.
 *
 * AND IT IS THE HONEST RULE RATHER THAN A PATCH ON THE SYMPTOM. A guide is the
 * line something is set out FROM — the whole of what the role means. Borrowing a
 * cove's outline to make a guide out of it produces a setting-out line for
 * something that has already been set out, which is `duplicateShape` said
 * confusingly. Nothing is lost: a cove still spans from a guide, a track still
 * spans from one, and BOTH of those are the direction the flow was designed in.
 *
 * `takeableGeometry` IN features/ceiling-geometry/geometryRules.js CARRIES THE
 * SAME LINE, because it is the same sentence said to the cursor: the hover cue
 * and the press have to agree frame by frame or the drawing lights up a shape
 * the press will not take.
 */
export function canTakeGeometry({ shape, role = 'cove', menuOpen = false,
                                  addTool = null, penEmpty = true } = {}) {
  if (!shape || !menuOpen || addTool || !penEmpty) return false;
  if ((role || 'cove') === 'guide') return false;
  return roleOf(shape) !== (role || 'cove');
}

/**
 * THE SAME SHAPE, SET IN OR OUT BY A CONSTANT DISTANCE — as a SHAPE.
 *
 * `outlineFt(shape, grow)` ALREADY DOES THIS TO THE OUTLINE, and that is not
 * the same thing. An outline is a list of points: it can be drawn and it can be
 * measured, and it cannot be resized by its grips, duplicated, or given a
 * corner radius afterwards. A magnetic track set out a foot inside a guide has
 * to be all three, so what the offset produces has to be a shape.
 *
 * SO IT MOVES THE SHAPE'S OWN DIMENSIONS, and the arithmetic is `outlineFt`'s,
 * kept in step with it deliberately rather than re-derived:
 *
 *   rect      both sides by 2g, because an offset moves each of the four edges.
 *   circle    the radius by g, which is the whole of it.
 *   n-gon     the CIRCUMRADIUS by `g / cos(PI/n)` and not by g. An offset moves
 *             every EDGE out by g — that is the apothem — and the distance to a
 *             CORNER grows by exactly that factor. See the same note in
 *             `outlineFt`, which is where this figure comes from; growing the
 *             circumradius by g would leave the line short on the flats and past
 *             it at the corners, visibly so on a triangle.
 *   pen       through `offsetPolygon`, which is the real thing and refuses
 *             rather than folds — see its note.
 *
 * AN OPEN SHAPE IS RETURNED UNCHANGED, and that is the same answer `outlineFt`
 * gives: a line has no inside, so "a foot in from it" names two paths and
 * nothing in the drawing says which. The caller must not offer the control for
 * one — see `arrayAsks` in lib/cob.js, which makes the same call.
 *
 * `null` WHERE THE OFFSET EATS THE SHAPE, so a caller gets a refusal rather
 * than a shape turned inside out. A rectangle inset past half its short side
 * has no inside left, and `offsetPolygon` says so for a pen path.
 */
export function insetShape(shape, g) {
  if (!shape) return null;
  const d = Number(g) || 0;
  if (!d) return shape;
  if (isOpen(shape)) return shape;
  if (shape.kind === 'circle') {
    const r = (shape.rFt || 0) + d;
    return r > MIN_SPAN_FT / 2 ? { ...shape, rFt: r } : null;
  }
  if (shape.kind === 'rect') {
    const w = (shape.wFt || 0) + 2 * d, h = (shape.hFt || 0) + 2 * d;
    return (w > MIN_SPAN_FT && h > MIN_SPAN_FT) ? { ...shape, wFt: w, hFt: h } : null;
  }
  if (shape.kind === 'pen') {
    const pts = offsetPolygon(shape.pts ?? [], d);
    return pts?.length >= 3 ? { ...shape, pts } : null;
  }
  const n = sidesOf(shape);
  const r = (shape.rFt || 0) + d / Math.cos(Math.PI / n);
  return r > MIN_SPAN_FT / 2 ? { ...shape, rFt: r } : null;
}

/** One line of size, for the contextual menu. Feet, because a cove is set out
 *  in feet and the rest of this app's ceiling reads in them. */
export function sizeLabel(shape) {
  const b = bboxFt(shape);
  const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
  // A SLOT IS A LENGTH, not a box. "18.0 x 0.0 ft" is the bounding box of a
  // straight run and says nothing anybody wants to know about it.
  if (isOpen(shape)) return `${f(runLengthFt(shape))} ft run`;
  if (shape.kind === 'circle') return `${f((shape.rFt || 0) * 2)} ft ⌀`;
  return `${f(b.x1 - b.x0)} × ${f(b.y1 - b.y0)} ft`;
}
