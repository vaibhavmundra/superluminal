// ---------------------------------------------------------------------------
// fixtures.mjs — synthetic floor plans that look like real CAD output.
//
// Real drawings do not hand you room outlines. They hand you PAIRS of parallel
// lines per wall, running the full length of the wall and crossing each other
// at junctions, with a gap punched through both lines at every doorway. These
// helpers build exactly that, so the tests exercise the same mess the parser
// will meet in practice.
// ---------------------------------------------------------------------------

/**
 * A wall centreline plus thickness becomes two offset lines, each broken at
 * every door opening. `doors` are { at, width } measured along the wall.
 */
export function wall(x1, y1, x2, y2, t = 0.75, doors = [], layer = 'A-WALL') {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const out = [];
  // the spans of this wall that are solid, i.e. everything but the doors
  const cuts = [...doors].sort((a, b) => a.at - b.at);
  const spans = [];
  let cursor = 0;
  for (const d of cuts) {
    const a = d.at - d.width / 2, b = d.at + d.width / 2;
    if (a > cursor) spans.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < len) spans.push([cursor, len]);

  for (const side of [+t / 2, -t / 2]) {
    for (const [s0, s1] of spans) {
      out.push({
        x1: x1 + ux * s0 + nx * side, y1: y1 + uy * s0 + ny * side,
        x2: x1 + ux * s1 + nx * side, y2: y1 + uy * s1 + ny * side,
        layer,
      });
    }
  }
  return out;
}

/** A simple rectangular room, single-line walls. The trivial case. */
export function rectPlan(w = 10, h = 8) {
  return [
    { x1: 0, y1: 0, x2: w, y2: 0, layer: 'A-WALL' },
    { x1: w, y1: 0, x2: w, y2: h, layer: 'A-WALL' },
    { x1: w, y1: h, x2: 0, y2: h, layer: 'A-WALL' },
    { x1: 0, y1: h, x2: 0, y2: 0, layer: 'A-WALL' },
  ];
}

/** An L-shaped room, single-line. */
export function lPlan() {
  const pts = [[0, 0], [20, 0], [20, 12], [12, 12], [12, 20], [0, 20]];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], layer: 'A-WALL' });
  }
  return out;
}

/**
 * A 30 x 24 flat: four rooms off a cross wall, doors through every internal
 * wall and a front door in the west wall. Double-line walls throughout.
 */
export function flatPlan(t = 0.75) {
  return [
    // exterior, with a front door in the west wall
    ...wall(0, 0, 30, 0, t),
    ...wall(30, 0, 30, 24, t),
    ...wall(30, 24, 0, 24, t),
    ...wall(0, 24, 0, 0, t, [{ at: 18, width: 3.5 }]),
    // internal cross wall, a door into each room
    ...wall(14, 0, 14, 24, t, [{ at: 5, width: 3 }, { at: 19, width: 3 }]),
    ...wall(0, 12, 30, 12, t, [{ at: 6, width: 3 }, { at: 23, width: 3 }]),
  ];
}

/** The same flat, plus the clutter a real drawing carries. */
export function clutteredFlatPlan(t = 0.75) {
  return [
    ...flatPlan(t),
    // dimension line and its leaders, off to one side — dangling, must be pruned
    { x1: -4, y1: 0, x2: -4, y2: 24, layer: 'A-DIMS' },
    { x1: -4.5, y1: 0, x2: -3.5, y2: 0, layer: 'A-DIMS' },
    { x1: -4.5, y1: 24, x2: -3.5, y2: 24, layer: 'A-DIMS' },
    // a sofa: a closed loop INSIDE a room, on a furniture layer
    { x1: 3, y1: 3, x2: 9, y2: 3, layer: 'A-FURN' },
    { x1: 9, y1: 3, x2: 9, y2: 5.5, layer: 'A-FURN' },
    { x1: 9, y1: 5.5, x2: 3, y2: 5.5, layer: 'A-FURN' },
    { x1: 3, y1: 5.5, x2: 3, y2: 3, layer: 'A-FURN' },
    // a stray tick mark floating in a room, on the wall layer — dangling
    { x1: 20, y1: 20, x2: 21, y2: 20.5, layer: 'A-WALL' },
  ];
}

/** Two rooms whose shared wall is drawn with a sloppy 3" gap at the corner. */
export function sloppyPlan() {
  const t = 0.5;
  return [
    ...wall(0, 0, 20, 0, t),
    ...wall(20, 0, 20, 14, t),
    ...wall(20, 14, 0, 14, t),
    ...wall(0, 14, 0, 0, t),
    // internal wall that stops short of the north wall's inner face (13.75),
    // leaving a 2.4 inch gap that is slop, not a doorway
    ...wall(10, 0, 10, 13.55, t, [{ at: 4, width: 3 }]),
  ];
}
