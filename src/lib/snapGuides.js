// ---------------------------------------------------------------------------
// snapGuides.js — momentary alignment while something is being dragged.
//
// The kind of snapping that is worth having is not a grid. It is the thing
// every layout tool does: as a point comes within a few pixels of lining up
// with something MEANINGFUL, it clicks onto that line and the line briefly
// draws itself, so you can see what you just aligned to and why it moved.
//
// SHAPED FOR MORE OF THEM. Today two sources are wired up — the centre of a
// room, and the centre of another ceiling object. That is deliberately not
// special-cased anywhere below: a source is just a function that returns
// TARGETS, a target is `{ axis, value, span, kind, label }`, and everything
// after that is the same code however many sources there are. Adding edges,
// thirds, equal spacing, or the lights themselves is a new entry in
// `collectTargets` and nothing else.
//
// Each target carries a `span` — the extent along the OTHER axis of whatever it
// came from — so a guide can be drawn across the thing it belongs to rather
// than as a full-bleed line across the sheet. A line that stops at the room it
// is about says which room it is about.
//
// TOLERANCE IS IN SCREEN PIXELS, converted by the caller. Snapping that gets
// stickier as you zoom in is snapping that fights you: the whole point is that
// it engages when two things LOOK aligned, and how aligned they look is a
// property of the screen, not of the drawing.
//
// PURE. No React, no DOM.
// ---------------------------------------------------------------------------

export const SNAP_DEFAULTS = {
  // About a handle's width. Tight enough that it never fires by accident,
  // loose enough that you do not have to aim.
  tolScreenPx: 7,
};

const bboxOf = (poly) => {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

/**
 * Everything worth lining up with, in PLAN PIXELS.
 *
 * `exclude` is the id of whatever is being dragged: an object cannot be
 * asked to align with itself, and without this the drag would lock solid the
 * moment it started.
 */
export function collectTargets({ rooms = [], objects = [], exclude = null } = {}) {
  const out = [];

  for (const r of rooms) {
    const poly = r.polygonPx;
    if (!poly?.length) continue;
    const b = bboxOf(poly);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const name = r.name || 'space';
    out.push({ axis: 'x', value: cx, span: [b.y0, b.y1], kind: 'room-centre',
               label: `${name} centre` });
    out.push({ axis: 'y', value: cy, span: [b.x0, b.x1], kind: 'room-centre',
               label: `${name} centre` });
  }

  for (const o of objects) {
    if (!o || o.id === exclude) continue;
    const r = o.r || 0;
    out.push({ axis: 'x', value: o.x, span: [o.y - r, o.y + r], kind: 'object-centre',
               label: 'aligned' });
    out.push({ axis: 'y', value: o.y, span: [o.x - r, o.x + r], kind: 'object-centre',
               label: 'aligned' });
  }

  return out;
}

/**
 * Pull a point onto the nearest target on each axis independently.
 *
 * Independently, because the two axes are separate questions: a point can be
 * dead on a room's vertical centreline while being nowhere near anything
 * horizontally, and that is a real, useful, single-axis alignment. Requiring
 * both would make the snap almost never fire.
 *
 * Ties go to the closest, and a target that came from a room outranks one that
 * came from another object at equal distance — a room's centre is a fact about
 * the drawing, another object's position is just where somebody happened to put
 * it.
 */
const RANK = { 'room-centre': 0, 'object-centre': 1 };

export function snapPoint(p, targets, { tol = SNAP_DEFAULTS.tolScreenPx } = {}) {
  let bx = null, by = null;
  for (const t of targets) {
    const v = t.axis === 'x' ? p.x : p.y;
    const d = Math.abs(v - t.value);
    if (d > tol) continue;
    const slot = t.axis === 'x' ? bx : by;
    const better = !slot || d < slot.d - 1e-9
      || (Math.abs(d - slot.d) <= 1e-9 && (RANK[t.kind] ?? 9) < (RANK[slot.t.kind] ?? 9));
    if (!better) continue;
    if (t.axis === 'x') bx = { t, d }; else by = { t, d };
  }
  return {
    x: bx ? bx.t.value : p.x,
    y: by ? by.t.value : p.y,
    guides: [bx?.t, by?.t].filter(Boolean),
  };
}

/**
 * The line to draw for a guide, in plan pixels, with the span stretched a
 * little past whatever it came from so it reads as a guide rather than as an
 * edge of the thing.
 */
export function guideLine(g, pad = 0) {
  const [lo, hi] = g.span;
  return g.axis === 'x'
    ? { x1: g.value, y1: lo - pad, x2: g.value, y2: hi + pad }
    : { x1: lo - pad, y1: g.value, x2: hi + pad, y2: g.value };
}
