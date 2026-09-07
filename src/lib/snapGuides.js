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
export function collectTargets({ rooms = [], objects = [], points = [],
                                 shapes = [], exclude = null } = {}) {
  /* `exclude` TAKES ONE ID, A LIST OF THEM, OR A SET. It was a single id
     compared with `===`, which was right while only one object could ever be
     dragged. A multi-selection moves as a group, and a group that can snap to
     its OWN members is a group that collapses on itself the moment two of them
     come within tolerance — every object in the drag has to be off the target
     list, not just the one under the pointer. Normalised here rather than at the
     call site so every caller keeps working unchanged. */
  const skip = exclude == null ? null
    : exclude instanceof Set ? exclude
    : new Set(Array.isArray(exclude) ? exclude : [exclude]);
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
    /* AND THE WALLS, WHICH ARE THE LINES ANYBODY IS ACTUALLY AIMING AT. The
       centre of a room is one alignment in each direction and it is the one
       people want least often: a fitting, a run or a corner is lined up with a
       WALL, and until now no source offered one. Every vertex of the outline
       contributes its own x and y, which for a rectangular room is the four
       walls and for an L is the six — the outline is traced on the inner face,
       so these are the faces themselves.
       DE-DUPED BY VALUE, because a rectangle's four corners would otherwise
       push eight targets describing four lines, and the tie-break in
       `snapPoint` would be choosing between two identical answers. */
    const seen = new Set();
    for (const q of poly) {
      for (const [axis, value, lo, hi] of
           [['x', q.x, b.y0, b.y1], ['y', q.y, b.x0, b.x1]]) {
        const tag = `${axis}:${value.toFixed(2)}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        out.push({ axis, value, span: [lo, hi], kind: 'room-edge', label: name });
      }
    }
  }

  /* WHATEVER THE CALLER IS ALREADY HOLDING. The pen's own points come in here:
     clicking out a rectangle means the fourth corner has to line up with the
     first, and no source above knows anything about a path that does not exist
     yet. `span` is the point itself, so the guide is drawn from the point it
     came from to the one being placed rather than across the whole sheet. */
  for (const q of points) {
    if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
    out.push({ axis: 'x', value: q.x, span: [q.y, q.y], kind: 'point',
               label: q.label ?? '' });
    out.push({ axis: 'y', value: q.y, span: [q.x, q.x], kind: 'point',
               label: q.label ?? '' });
  }

  /* --- THE GEOMETRY ALREADY ON THE CEILING -----------------------------
     THE LINES SOMEBODY DREW ARE THE LINES THEY ARE AIMING AT. A guide rectangle
     is drawn for one purpose — to set the next thing out against — and until
     this source existed the one geometry on the sheet that was there ON PURPOSE
     was the only geometry nothing could snap to: a second rectangle a foot
     inside the first had to be got right by eye, on a drawing where every wall
     nobody drew clicked into place.

     SHAPED LIKE `room-edge` AND NOT LIKE `point`, which is the whole reason it
     is its own source rather than a heap of vertices passed through `points`. A
     vertex target spans the point itself, so its guide is a stub a few pixels
     long and says nothing about what was lined up with. Every vertex here
     contributes its x and its y across the SHAPE'S OWN BOX, so the guide draws
     along the edge it came from — which is what makes it readable as "this line,
     this shape".

     DE-DUPED BY VALUE, exactly as the room's own edges are: a rectangle's four
     corners describe four lines and would otherwise push eight identical
     targets for the tie-break in `snapPoint` to choose between.

     `exclude` REACHES THIS TOO. A shape being dragged must not be able to align
     with itself, or the drag locks solid the moment it starts. */
  for (const sh of shapes) {
    const poly = sh?.pts;
    if (!poly?.length || (skip && skip.has(sh.id))) continue;
    const b = bboxOf(poly);
    const name = sh.label || 'geometry';
    const seen = new Set();
    for (const q of poly) {
      for (const [axis, value, lo, hi] of
           [['x', q.x, b.y0, b.y1], ['y', q.y, b.x0, b.x1]]) {
        const tag = `${axis}:${value.toFixed(2)}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        out.push({ axis, value, span: [lo, hi], kind: 'shape-edge', label: name });
      }
    }
  }

  for (const o of objects) {
    if (!o || (skip && skip.has(o.id))) continue;
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
/* A POINT THE GESTURE ITSELF PUT DOWN OUTRANKS EVERYTHING. When the fourth
   corner of a rectangle is within tolerance of both the first corner and a wall
   behind it, the first corner is what is meant — the path is the thing being
   drawn, and the wall is scenery. Below it, a room's own geometry beats an
   object somebody happened to place. */
/* A LINE SOMEBODY DREW OUTRANKS THE ROOM BEHIND IT. A guide exists to be set
   out against; a wall is there whether anybody wanted it or not. Below the
   path's own points, which are the thing being drawn. */
const RANK = { point: -1, 'shape-edge': 0, 'room-centre': 1, 'room-edge': 2,
               'object-centre': 3 };

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
