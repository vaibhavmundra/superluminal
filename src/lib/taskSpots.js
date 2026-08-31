// ---------------------------------------------------------------------------
// taskSpots.js — a directional spot aimed at a task surface.
//
// THE SECONDARY GRID. The ambient layer already put a light at the centre of
// every cell, and those lights fall into rows and columns. Draw a line through
// every one of them, horizontally and vertically, run each line out until it
// meets the chunk's own outline, and you have a second grid — invisible, laid
// over the first, whose lines pass through every fitting that is already there.
//
// It is not a new grid so much as the ambient grid's skeleton made explicit,
// and that is exactly why a spot belongs on it. A spot dropped at the point
// that happens to be nearest the coffee table would sit at some arbitrary
// offset from everything else on the ceiling and read as a mistake. A spot on
// the line between two downlights reads as part of the layout, because it IS
// on the layout's own geometry.
//
// WHERE ON IT. Two classes of segment, tried in this order:
//
//   1. between two ADJACENT LIGHTS on the same line. The midpoint of the one
//      whose centre is nearest the task surface.
//   2. between the OUTERMOST LIGHT on a line and the chunk's outline, same
//      rule. This is the fallback for a surface out at the edge of a room,
//      where there is no pair of lights on the near side of it.
//
// A candidate has to survive the same rules the ambient layer obeys — clear of
// the ceiling objects, clear of the walls, out of the no-light zones — because
// a spot is a fitting in the same ceiling and the reasons those rules exist do
// not care what the fitting is for.
//
// EVERYTHING HERE IS IN THE ROOM'S OWN FEET, the space planner.js works in.
// The caller converts.
//
// PURE. No React, no canvas.
// ---------------------------------------------------------------------------

import { pointInPolygon, distanceToBoundary } from './geometry.js';
import { surfaceDistance } from './planner.js';

export const SPOT_DEFAULTS = {
  // Two lights closer together than this do not have a segment worth standing
  // in the middle of.
  minSegment: 1.6,
  // HOW FAR ALONG ITS OWN SEGMENT A SPOT MAY SLIDE, as a fraction either side
  // of the midpoint. The midpoint is the home and stays the home — it is the
  // point that reads as deliberate, halfway between two fittings — but a
  // segment whose exact middle is unavailable is not a segment with nothing on
  // it. A bed covers one end of a run; the cove's clearance eats the outer
  // quarter of every run inside the line. Refusing the whole segment over
  // either of those threw away the nearest grid to the surface and left the
  // desk unlit, which is worse than a spot a foot off centre.
  //
  // 0.3 keeps the point inside the middle 60% of the run, so it can never
  // crowd the fitting or the edge at either end.
  slideSpan: 0.3,
  // How far a spot must stand off the surface it is aimed at. A spot ON the
  // table has no direction to point in, and the arrow is half the drawing.
  minStandoff: 0.75,
  // Coordinates within this of each other are the same row or column. The
  // ambient aligner already snapped the lights into rows; this only has to be
  // looser than the residue that leaves behind.
  alignTol: 0.15,
  // The wall rule, and it is 1 ft rather than the ambient layer's 5.
  //
  // This is why it was made a separate dial in the first place. 5 ft is what a
  // LARGE LIGHT keeps, because its cone lands on the wall and scallops it. A
  // spot is aimed at a table: it is a narrow beam pointed away from the wall,
  // and the wall behind it is not in the picture. Inheriting 5 ft refused
  // almost every candidate in a normal-sized living room — both coffee tables
  // in the worked example came back "closer than 5 ft to a wall" and got no
  // spot at all.
  //
  // A FOOT, NOT TWO. Two was the first cautious step away from five and it was
  // still a rule about a fitting this one is not: it kept a spot out of every
  // band of ceiling narrower than four feet, which is most of the places a task
  // surface actually sits — a desk against a wall, a counter, the ceiling
  // outside a cove line. A foot is the real constraint, which is the trim of
  // the fitting itself and the plasterboard edge behind it.
  //
  // Set to null to fall back to the ambient figure.
  wallDistance: 1.0,
  // A chandelier this close to a surface is already lighting it, so no spot is
  // added. Measured from the chandelier's own BODY to the surface's outline —
  // not centre to centre, which would let a five-foot fitting hang directly
  // over a table and still be counted as three feet away from it.
  chandelierNear: 3.0,
};

const EPS = 1e-9;

/** Distance from a point to a rectangle. Zero inside it. */
export function rectDistance(p, r) {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.hypot(dx, dy);
}

const centreOf = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

/** Group values that are within `tol` of each other, and return one per group. */
function lanes(values, tol) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(v - last.at) <= tol) { last.members.push(v); continue; }
    out.push({ at: v, members: [v] });
  }
  // The lane sits at the mean of what fell into it, so a row of lights that the
  // aligner left a hair apart still produces ONE line rather than four.
  for (const l of out) l.at = l.members.reduce((a, b) => a + b, 0) / l.members.length;
  return out;
}

/**
 * The centre of every cell in a chunk — the positions the ambient layer would
 * have used, whether or not it did. `xLines`/`yLines` are what the planner
 * writes onto a chunk when it grids it; a chunk that never got one has neither
 * and produces nothing, which is the honest answer.
 */
function cellCentres(chunk) {
  const X = chunk?.xLines, Y = chunk?.yLines;
  if (!X || !Y || X.length < 2 || Y.length < 2) return [];
  const out = [];
  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Y.length - 1; j++) {
      out.push({ x: (X[i] + X[i + 1]) / 2, y: (Y[j] + Y[j + 1]) / 2,
                 id: `cell-${i},${j}`, virtual: true });
    }
  }
  return out;
}

/**
 * The secondary grid for one chunk: its lines, and the segments along them.
 *
 * `lights` is every fitting inside the chunk. Containment rather than the
 * light's own `chunk` field on purpose — a large light sitting ON a chunk
 * boundary lights cells either side of it, and it is a real node on the grid of
 * both chunks.
 */
export function secondaryGrid(chunk, lights, opt = {}) {
  const o = { ...SPOT_DEFAULTS, ...opt };
  const found = lights.filter((l) =>
    l.x >= chunk.x0 - o.alignTol && l.x <= chunk.x1 + o.alignTol &&
    l.y >= chunk.y0 - o.alignTol && l.y <= chunk.y1 + o.alignTol);

  // A CHUNK WITH NO FITTINGS IN IT STILL HAS A GRID.
  //
  // The secondary grid is described above as the ambient layer's skeleton made
  // explicit — lines through the lights that are already there. That reading
  // quietly assumed there always ARE lights, and a cove broke it: where the
  // strip carries the space on its own the room has a full grid of cells and
  // not one downlight, so a desk in it got no spot at all and a sentence about
  // the chunk holding fewer than two lights.
  //
  // But a cell centre is WHERE A LIGHT WOULD HAVE GONE. It is the same
  // geometry, arrived at from the other end, so it makes the same skeleton and
  // a spot standing on it reads as part of the layout for exactly the reasons
  // in the header. So: the fittings where there are fittings, and the cells
  // they would have occupied where there are none.
  const inside = found.length ? found : cellCentres(chunk);

  const rows = lanes(inside.map((l) => l.y), o.alignTol);
  const cols = lanes(inside.map((l) => l.x), o.alignTol);

  const lines = [
    ...rows.map((r) => ({ axis: 'h', at: r.at, a: { x: chunk.x0, y: r.at }, b: { x: chunk.x1, y: r.at } })),
    ...cols.map((c) => ({ axis: 'v', at: c.at, a: { x: c.at, y: chunk.y0 }, b: { x: c.at, y: chunk.y1 } })),
  ];

  const segments = [];
  const build = (lane, axis) => {
    const on = inside
      .filter((l) => Math.abs((axis === 'h' ? l.y : l.x) - lane.at) <= o.alignTol)
      .sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    if (!on.length) return;
    const at = (v) => (axis === 'h' ? { x: v, y: lane.at } : { x: lane.at, y: v });
    const coord = (l) => (axis === 'h' ? l.x : l.y);
    const lo = axis === 'h' ? chunk.x0 : chunk.y0;
    const hi = axis === 'h' ? chunk.x1 : chunk.y1;

    const push = (v0, v1, kind, ends) => {
      if (Math.abs(v1 - v0) < o.minSegment) return;
      segments.push({ axis, kind, a: at(v0), b: at(v1),
                      mid: at((v0 + v1) / 2), length: Math.abs(v1 - v0), ends });
    };

    // light -> light, adjacent pairs only
    for (let i = 0; i < on.length - 1; i++) {
      push(coord(on[i]), coord(on[i + 1]), 'light-light', [on[i].id, on[i + 1].id]);
    }
    // outermost light -> the chunk's own outline
    push(lo, coord(on[0]), 'light-edge', ['edge', on[0].id]);
    push(coord(on[on.length - 1]), hi, 'light-edge', [on[on.length - 1].id, 'edge']);
  };
  rows.forEach((r) => build(r, 'h'));
  cols.forEach((c) => build(c, 'v'));

  return { lines, segments, lights: inside };
}

/**
 * CAN A FITTING STAND HERE? The ceiling's own rules, as one predicate.
 *
 * Pulled out of placeTaskSpot so that artSpots.js can ask the same question of
 * the same ceiling. It has to be the same code and not a faithful copy: these
 * five rules are the ones that decide whether a light is buildable — inside the
 * room, out of the no-light zones, clear of the fan's sweep, off the wall, off
 * the cove — and a second copy would be five chances for a spot aimed at a
 * painting to be legal by rules the ambient layer stopped obeying two commits
 * ago.
 *
 * `reasons` is an optional Set the caller passes in to collect WHY points were
 * refused, because "no spot appeared" is not something anybody can act on and
 * "every position is inside the fan's clearance" is.
 */
export function spotLegality({ polygon, zones = [], fixtures = [], coves = [],
                               clearance = 0, wallMin = 0, reasons = null } = {}) {
  const note = (s) => { reasons?.add(s); return false; };
  return (p) => {
    if (!pointInPolygon(p, polygon)) return note('outside the space');
    for (const z of zones) {
      if (p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1) {
        return note('inside a no-light zone');
      }
    }
    for (const f of fixtures) {
      if (surfaceDistance(f, p) < clearance - EPS) {
        return note('inside a ceiling object’s clearance');
      }
    }
    if (distanceToBoundary(p, polygon) + EPS < wallMin) {
      return note(`closer than ${wallMin} ft to a wall`);
    }
    // THE COVE'S OWN CLEARANCE. A spot is a downlight in the same ceiling, and
    // one crowding the pocket flattens the cove's glow exactly as an ambient
    // fitting would. Same figures, from the same place: see opt.coves.
    for (const cv of coves) {
      const within = p.x > cv.x0 && p.x < cv.x1 && p.y > cv.y0 && p.y < cv.y1;
      const need = within ? cv.inside : cv.outside;
      const dx = Math.max(cv.x0 - p.x, 0, p.x - cv.x1);
      const dy = Math.max(cv.y0 - p.y, 0, p.y - cv.y1);
      const d = (dx > 0 || dy > 0) ? Math.hypot(dx, dy)
        : Math.min(p.x - cv.x0, cv.x1 - p.x, p.y - cv.y0, cv.y1 - p.y);
      if (d < need - EPS) return note('crowding the cove');
    }
    return true;
  };
}

/**
 * Place one spot for one surface.
 *
 * Returns `{ spot }` or `{ rejected }` — a sentence, as everywhere else in this
 * app, because "no spot appeared" is not something a person can act on and
 * "every segment near it is inside a fan's clearance" is.
 */
export function placeTaskSpot(surface, { chunk, lights, polygon, fixtures = [],
                                         zones = [], coves = [], usedSegments = null,
                                         opt = {} } = {}) {
  const o = { ...SPOT_DEFAULTS, ...opt };
  const wallMin = o.wallDistance ?? opt.minWallDistance ?? 0;
  const clearance = opt.fanClearance ?? 0;
  const centre = centreOf(surface);

  const grid = secondaryGrid(chunk, lights, o);
  if (!grid.segments.length) {
    return { rejected: 'This piece of ceiling has no grid to stand a spot on.' };
  }

  const reasons = new Set();
  const base = spotLegality({ polygon, zones, fixtures, coves, clearance, wallMin, reasons });
  const legal = (p) => {
    if (!base(p)) return false;
    // A spot standing ON its surface has no direction to point in. THE ONE RULE
    // THAT IS NOT SHARED, because it is about the thing being lit rather than
    // about the ceiling, and the art cluster next door has its own version of it.
    if (rectDistance(p, surface) < EPS && Math.hypot(p.x - centre.x, p.y - centre.y) < o.minStandoff) {
      reasons.add('directly over the surface, with nothing to aim at'); return false;
    }
    return true;
  };

  // Light-to-light first, exhausted before the edge fallback is considered at
  // all — the order is the rule, not a tie-break, so a poor pair beats a good
  // edge every time.
  for (const kind of ['light-light', 'light-edge']) {
    const ranked = grid.segments
      .filter((s) => s.kind === kind)
      .map((s) => ({ s, d: rectDistance(s.mid, surface) }))
      .sort((a, b) => a.d - b.d || a.s.length - b.s.length);
    for (const { s, d } of ranked) {
      // Spent by another surface. Not a rule about geometry, so it is checked
      // before the geometry — no point reporting "inside a clearance" about a
      // segment that was never available.
      if (usedSegments?.has(segmentKey(s))) { reasons.add('already used by another surface'); continue; }
      const p = standIn(s, o, legal, surface);
      if (!p) continue;
      const dx = centre.x - p.x, dy = centre.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        spot: {
          x: p.x, y: p.y,
          aim: { x: dx / len, y: dy / len },
          angle: Math.atan2(dy, dx),
          target: centre,
          via: kind, segment: s, distance: d,
          // How far off the middle of its own run it had to stand, in feet. 0
          // for the ordinary case, and worth carrying because a spot that slid
          // is a spot the drawing should be able to explain.
          slid: Math.hypot(p.x - s.mid.x, p.y - s.mid.y),
        },
        grid,
      };
    }
  }

  return {
    grid,
    rejected: reasons.size
      ? `Every segment near this surface is ${[...reasons].join(', or ')}.`
      : 'No segment near this surface is long enough to stand a spot in.',
  };
}

/**
 * Where on this segment the spot actually stands.
 *
 * The midpoint if it will have it, and otherwise the position nearest the
 * midpoint that is legal — ties going to whichever of the two sides is closer
 * to the surface, since a spot that had to move should move TOWARDS the thing
 * it is lighting. Returns null when nothing on the run works, which is the old
 * behaviour and still the right answer for a segment that is genuinely spent.
 */
function standIn(seg, o, legal, surface) {
  if (legal(seg.mid)) return seg.mid;
  const span = o.slideSpan;
  if (!(span > 0)) return null;
  const ax = seg.b.x - seg.a.x, ay = seg.b.y - seg.a.y;
  const at = (t) => ({ x: seg.a.x + ax * t, y: seg.a.y + ay * t });
  const N = 6;
  const tries = [];
  for (let k = 1; k <= N; k++) {
    const d = (k / N) * span;
    for (const t of [0.5 - d, 0.5 + d]) tries.push({ t, off: d, p: at(t) });
  }
  tries.sort((p, q) => (p.off - q.off)
    || (rectDistance(p.p, surface) - rectDistance(q.p, surface)));
  for (const c of tries) if (legal(c.p)) return c.p;
  return null;
}

/**
 * Is a chandelier already doing this job?
 *
 * A chandelier over a dining table IS the task light for it, and hanging a spot
 * beside one is specifying a fitting nobody will install. So the surface is
 * SKIPPED rather than refused — those are different outcomes and the panel says
 * so differently: a refusal is a problem to solve, a skip is a decision that
 * has already been made by the chandelier being there.
 */
export function chandelierOver(surface, chandeliers = [], opt = {}) {
  const o = { ...SPOT_DEFAULTS, ...opt };
  for (const c of chandeliers) {
    // Body edge to surface outline. A wide fitting reaches further than its
    // centre suggests, which is the whole reason it counts as lighting the
    // table underneath it.
    const d = rectDistance({ x: c.x, y: c.y }, surface) - (c.r || 0);
    if (d <= o.chandelierNear) return { chandelier: c, distance: Math.max(0, d) };
  }
  return null;
}

/**
 * Every surface in one chunk-space, each with its own spot.
 *
 * ONE SPOT LIGHTS ONE SURFACE. Placed independently, two surfaces near the same
 * pair of downlights would both pick that pair's midpoint and the drawing would
 * show one fitting apparently aimed at two things. So a segment is spent once:
 * whoever takes it first takes it, and the next surface moves on to its own
 * second choice.
 *
 * FIRST PICK GOES TO THE LARGEST SURFACE, and that is a real choice rather than
 * an accident of the order the model happened to list them in. A dining table
 * and a coffee table competing for one segment should be resolved in favour of
 * the dining table: it is the bigger commitment, it is harder to light from
 * somewhere else, and a compromise on the coffee table costs less.
 */
export function planTaskSpots(surfaces, ctx = {}) {
  // EACH SURFACE AGAINST ITS OWN CHUNK. This took one chunk for the whole room —
  // the one holding the FIRST surface — and that is wrong the moment a room has
  // two surfaces in different chunks, which a living-dining room always does.
  // The dining table was placed against the coffee table's grid and landed on a
  // segment at the far end of the room, metres from the thing it was aiming at,
  // while the pair of downlights either side of it went unused.
  //
  // A chunk is a region of ceiling with its own grid, so the segments available
  // to a surface are the ones in the chunk the surface actually sits in. There
  // is no sense in which the other chunk's lines were candidates.
  const chunks = ctx.chunks?.length ? ctx.chunks : (ctx.chunk ? [ctx.chunk] : []);
  const area = (s) => Math.max(0, s.x1 - s.x0) * Math.max(0, s.y1 - s.y0);
  const order = surfaces
    .map((s, i) => ({ s, i }))
    .sort((a, b) => area(b.s) - area(a.s) || a.i - b.i);

  const usedSegments = new Set();
  const out = new Array(surfaces.length);

  for (const { s, i } of order) {
    const skip = chandelierOver(s, ctx.chandeliers, ctx.opt);
    if (skip) {
      out[i] = { skipped: `A chandelier is ${skip.distance.toFixed(1)} ft away and`
        + ` already lights this surface.` };
      continue;
    }
    const centre = { x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 };
    const chunk = chunkFor(centre, chunks);
    if (!chunk) { out[i] = { rejected: 'This surface is not in any chunk of ceiling.' }; continue; }
    let res = placeTaskSpot(s, { ...ctx, chunk, usedSegments });

    // THE NEAREST GRID THAT WILL TAKE IT.
    //
    // A surface's own chunk is the right first answer and stays the only answer
    // in an ordinary room — see the note above about the dining table placed
    // against the coffee table's grid. But "its own chunk" and "a chunk a spot
    // can stand in" are not the same thing, and a cove is where they come
    // apart: a desk against the wall sits in the BAND outside the cove line,
    // which is three feet of ceiling with a wall on one side and the pocket on
    // the other. Nothing legal fits in it, and the honest consequence used to
    // be no spot at all.
    //
    // So a refusal falls through to the other chunks, nearest first, and the
    // first grid that will take a fitting gets it. The spot then stands just
    // inside the cove line and AIMS OUT at the desk, which is how the fitting
    // is drawn and how it would actually be installed. Nearest-first matters:
    // it is what keeps the spot beside the thing it is lighting rather than
    // wherever the first chunk in the list happens to be.
    if (!res.spot) {
      const others = chunks
        .filter((c) => c !== chunk)
        .map((c) => ({ c, d: rectDistance(centre, c) }))
        .sort((a2, b2) => a2.d - b2.d);
      for (const { c } of others) {
        const alt = placeTaskSpot(s, { ...ctx, chunk: c, usedSegments });
        if (!alt.spot) continue;
        res = { ...alt, spot: { ...alt.spot, viaChunk: 'nearest' } };
        break;
      }
    }

    if (res.spot) usedSegments.add(segmentKey(res.spot.segment));
    out[i] = res;
  }
  return out;
}

/** A segment's identity, for the used-once rule. */
export function segmentKey(seg) {
  const r = (v) => Math.round(v * 1000) / 1000;
  return `${seg.axis}:${r(seg.a.x)},${r(seg.a.y)}-${r(seg.b.x)},${r(seg.b.y)}`;
}

/** Which chunk holds this point? The one containing it, else the nearest. */
export function chunkFor(p, chunks) {
  let best = null;
  for (const c of chunks) {
    if (p.x >= c.x0 && p.x <= c.x1 && p.y >= c.y0 && p.y <= c.y1) return c;
    const d = rectDistance(p, c);
    if (!best || d < best.d) best = { c, d };
  }
  return best?.c ?? null;
}
