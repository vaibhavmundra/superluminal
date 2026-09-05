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
 * not alphabetical: rectangle first because it is the one everybody reaches
 * for, the pen last because it is the one that takes several clicks.
 *
 * `centred` IS THE GESTURE AND IT IS THE ONLY THING THAT SEPARATES THESE.
 * A rectangle is dragged corner to corner, the way every marquee in this app
 * already is. Everything with a radius is dragged from the MIDDLE, because a
 * circle has no corner to start at and pretending it has one (dragging its
 * bounding box) puts the thing you are drawing somewhere you are not pointing.
 */
export const SHAPE_TOOLS = [
  { id: 'rect',     label: 'Rectangle', centred: false },
  { id: 'square',   label: 'Square',    centred: true },
  { id: 'circle',   label: 'Circle',    centred: true },
  { id: 'triangle', label: 'Triangle',  centred: true },
  { id: 'polygon',  label: 'Polygon',   centred: true, asks: 'sides' },
  { id: 'pen',      label: 'Pen',       centred: false, path: true },
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

// --- small vector helpers ---------------------------------------------------

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
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
export const roundable = (shape) => shape?.kind !== 'circle';

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
export function outlineFt(shape, grow = 0) {
  if (!shape) return [];
  const g = grow || 0;
  const { x = 0, y = 0, rot = 0 } = shape;
  const rr = Math.max(0, shape.radiusFt || 0) + g;

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

/** How many sides this shape has, whatever it calls itself. */
export const sidesOf = (shape) => (
  shape.kind === 'triangle' ? 3
  : shape.kind === 'square' ? 4
  : clamp(Math.round(shape.sides || POLY_SIDES.initial), POLY_SIDES.min, POLY_SIDES.max));

/** The outline's own length, which is what a strip is billed by. */
export function pathLengthFt(pts) {
  let l = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    l += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return l;
}

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

/** Is this point inside the shape? Point-in-polygon on its own outline. */
export function hitShape(shape, pFt, tolFt = 0) {
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
  shape?.kind === 'rect' || shape?.kind === 'pen' || shape?.kind === 'square';

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
export function penShape(ptsFt, { radiusFt = 0 } = {}) {
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
  if (pts.length < 3) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return {
    kind: 'pen', x: cx, y: cy, rot: 0, radiusFt,
    pts: pts.map((p) => ({ x: p.x - cx, y: p.y - cy })),
  };
}

/** Big enough to be a shape? See MIN_SPAN_FT. */
export function bigEnough(shape) {
  if (!shape) return false;
  const b = bboxFt(shape);
  return (b.x1 - b.x0) >= MIN_SPAN_FT && (b.y1 - b.y0) >= MIN_SPAN_FT;
}

/** A finished shape: whatever the draft was, plus an identity. */
export const sealShape = (draft) => ({ ...draft, id: newShapeId() });

/** One line of size, for the contextual menu. Feet, because a cove is set out
 *  in feet and the rest of this app's ceiling reads in them. */
export function sizeLabel(shape) {
  const b = bboxFt(shape);
  const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
  if (shape.kind === 'circle') return `${f((shape.rFt || 0) * 2)} ft ⌀`;
  return `${f(b.x1 - b.x0)} × ${f(b.y1 - b.y0)} ft`;
}
