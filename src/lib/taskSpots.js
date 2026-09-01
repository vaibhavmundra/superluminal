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
// ...BUT NEAR COMES FIRST. That order holds among candidates that actually
// light the thing; it is not a licence to prefer a tidy fitting twelve feet
// away to an untidy one beside the table. Everything inside maxAimFt is
// considered before anything outside it, and a position outside it is placed
// only as an admitted compromise — see the cap note in placeTaskSpot.
//
// A candidate has to survive the same rules the ambient layer obeys — clear of
// the ceiling objects, clear of the walls, out of the no-light zones — because
// a spot is a fitting in the same ceiling and the reasons those rules exist do
// not care what the fitting is for.
//
// WITH ONE EXCEPTION, AND IT IS A BED. A bed is a no-light zone because a
// downlight fires into the eyes of somebody lying under it. A directional spot
// fires where it is pointed, and the ceiling over a bed is often the only place
// the wall behind that bed can be lit from. So a spot may stand there, and the
// grid reaches across a bed to offer it somewhere to stand — see
// SPOT_DEFAULTS.overBed and spotSpan. No other zone gives way to anything.
//
// AND IN A ROOM WITH A TRACK, A POSITION ON THE RAIL IS WORTH MORE THAN ITS
// DISTANCE SAYS. See SPOT_DEFAULTS.trackMissFt: a head that clips into a
// profile that is already there and a head three and a half feet off it are two
// different products, so the placer is told where the rails are rather than
// leaving it to the absorption pass to catch whatever it happens to produce.
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

  // A DIRECTIONAL SPOT MAY STAND OVER A BED. THE OTHER ZONES STILL REFUSE IT.
  //
  // A no-light zone is one rectangle in the code and two completely different
  // facts on site, and treating them as one is what put a spot across the room
  // from the wall it was meant to light.
  //
  //   · A HOLE. An enclosed room, a hand-drawn box, a reverse cove: there is no
  //     ceiling there, or a person has said nothing goes there. Nothing may be
  //     placed in one, ever, whatever it is aimed at.
  //   · A BED. There is ordinary plasterboard over a bed. The rule exists
  //     because of GLARE: a downlight fires straight down, and straight down
  //     from there is somebody's open eyes.
  //
  // A directional spot is not that fitting. It is a narrow beam turned at a
  // wall or a table, and its glare is where it POINTS — which is why the
  // fitting is drawn with an arrow. The one thing under it is its own trim.
  //
  // Refusing it there cost exactly the case the rule was written to protect: a
  // bed pushed against the head wall, art or panelling above it, and the only
  // piece of ceiling from which either can be lit is the ceiling over the
  // mattress. Every candidate in it was refused, and the fall-through found the
  // nearest position that was legal — the far side of the room, aimed at a wall
  // eleven feet away. A spot over the pillow pointing AT the headboard is the
  // design; a spot across the room pointing at it is nothing.
  //
  // Set false to go back to treating all zones alike.
  overBed: true,

  // WHAT IT COSTS A CANDIDATE THAT NO TRACK RAIL CAN CARRY, in feet of
  // apparent distance. Only ever charged in a room that HAS a track.
  //
  // The absorption pass in track.js pulls a finished spot onto the profile if
  // it lands within three feet of one, and that is the whole of the track's
  // influence on where a spot goes — which is to say the placer chooses
  // blind and the track either catches the answer or does not. In a room
  // whose ceiling IS a track that is the wrong way round: a directional head
  // on the rail is a module that clips into a profile that is already there,
  // and one three and a half feet off it is a separate recessed fitting, a
  // separate hole and a separate circuit. Two positions a foot apart on the
  // drawing, and one of them is a different specification.
  //
  // A SURCHARGE AND NOT A VETO, for the same reason shareSurchargeFt is one: a
  // rail that cannot be reached from anywhere near the thing being lit should
  // lose to a recessed spot that can. A foot and a half is enough that a
  // comparable off-rail alternative loses and a much better one still wins.
  trackMissFt: 1.5,
};

const EPS = 1e-9;

/** Distance from a point to a rectangle. Zero inside it. */
export function rectDistance(p, r) {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.hypot(dx, dy);
}

const centreOf = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

/**
 * IS THIS NO-LIGHT ZONE A BED?
 *
 * `cls` is what the furniture detector puts on the rectangle it produces, and
 * it is the only field that says WHY a zone exists — which is the thing
 * SPOT_DEFAULTS.overBed has to know. Everything else that becomes a zone
 * carries something else or nothing at all: an enclosed room is `cls: 'room'`,
 * a reverse cove is `kind: 'reverse-cove'`, and a box a person dragged on the
 * plan has neither. So the test is positive and narrow, and anything it cannot
 * identify stays a hole in the ceiling — which is the safe answer.
 */
export const isBedZone = (z) => z?.cls === 'bed';

/**
 * HOW FAR THE SPOT GRID REACHES, which is FURTHER THAN THE CHUNK when a bed is
 * pushed up against it.
 *
 * A chunk is what is left of the ceiling after the zones are subtracted, so a
 * bed against the head wall does not merely forbid fittings over itself — it
 * ENDS THE CHUNK at the foot of the mattress. Relaxing the legality rule alone
 * therefore changed nothing at all: the candidate positions are built from the
 * chunk's own bounds, and there were none over the bed to make legal. The line
 * nearest the head wall was still on the far side of six feet of bed.
 *
 * So a chunk lends its grid across any bed that ABUTS it: the lines run on to
 * the far edge of the mattress, and the light-to-outline segment at that end
 * reaches the head wall rather than stopping at the foot of the bed. That is
 * the one stretch of ceiling from which the wall behind a bed can be lit.
 *
 * IT IS A GRID AND NOT A PERMISSION. Every point on it still goes through
 * `spotLegality` — inside the room, off the walls, clear of the fans and the
 * cove, and inside a zone only if that zone is a bed and the caller allows it.
 * Extending the reach cannot make anything legal that was not; it can only
 * offer positions that were never on the table.
 *
 * ABUTTING, NOT MERELY NEARBY: the zone's edge has to be on the chunk's edge,
 * and the two have to overlap across it by more than a token amount. A bed at
 * the other end of the room shares no boundary with this chunk and lends it
 * nothing.
 */
export function spotSpan(chunk, zones = [], opt = {}) {
  const o = { ...SPOT_DEFAULTS, ...opt };
  const span = { x0: chunk.x0, x1: chunk.x1, y0: chunk.y0, y1: chunk.y1 };
  if (!o.overBed) return span;
  const tol = o.spanAbutTol ?? 0.25;
  const minOverlap = o.spanMinOverlap ?? 0.5;
  for (const z of zones) {
    if (!isBedZone(z)) continue;
    const overX = Math.min(chunk.x1, z.x1) - Math.max(chunk.x0, z.x0);
    const overY = Math.min(chunk.y1, z.y1) - Math.max(chunk.y0, z.y0);
    if (overX > minOverlap) {
      if (Math.abs(z.y1 - chunk.y0) <= tol) span.y0 = Math.min(span.y0, z.y0);
      if (Math.abs(z.y0 - chunk.y1) <= tol) span.y1 = Math.max(span.y1, z.y1);
    }
    if (overY > minOverlap) {
      if (Math.abs(z.x1 - chunk.x0) <= tol) span.x0 = Math.min(span.x0, z.x0);
      if (Math.abs(z.x0 - chunk.x1) <= tol) span.x1 = Math.max(span.x1, z.x1);
    }
  }
  return span;
}

/**
 * IS THIS POSITION ONE A TRACK RAIL COULD CARRY?
 *
 * The same question `absorbPoints` in track.js answers when it decides whether
 * to pull a finished fitting onto the profile, asked early enough to influence
 * where the fitting goes — see SPOT_DEFAULTS.trackMissFt. Perpendicular reach
 * only, and inside the run's own ends, because that is the move absorption
 * makes: a module slides straight onto the rail and keeps its position along it.
 *
 * Deliberately a LITTLE MEANER than the absorption pass: a candidate right on
 * the edge of the band would be scored as carried here and then refused there
 * for want of an inch of free profile, so the reach is shaded in by a foot.
 * Being wrong in this direction costs a preference; being wrong in the other
 * costs a spot that thought it was a track module and came out recessed.
 */
export function carriedByTrack(p, runs = [], opt = {}) {
  const o = { ...SPOT_DEFAULTS, ...opt };
  for (const run of runs) {
    if (!run?.a || !run?.b) continue;
    const reach = Math.max(0, (run.absorb ?? o.trackAbsorb ?? 3) - 1);
    const horizontal = Math.abs(run.b.y - run.a.y) <= Math.abs(run.b.x - run.a.x);
    const perp = horizontal ? Math.abs(p.y - run.a.y) : Math.abs(p.x - run.a.x);
    if (perp > reach + EPS) continue;
    const lo = horizontal ? Math.min(run.a.x, run.b.x) : Math.min(run.a.y, run.b.y);
    const hi = horizontal ? Math.max(run.a.x, run.b.x) : Math.max(run.a.y, run.b.y);
    const along = horizontal ? p.x : p.y;
    if (along >= lo - EPS && along <= hi + EPS) return true;
  }
  return false;
}

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

  // HOW FAR THE LINES AND THE END SEGMENTS REACH. The chunk's own bounds, plus
  // any bed pushed against them — see spotSpan for why the chunk alone is not
  // enough, and why lending the grid across a mattress cannot make a single
  // position legal that was not already.
  const span = spotSpan(chunk, opt.spanZones ?? [], o);

  const lines = [
    ...rows.map((r) => ({ axis: 'h', at: r.at, a: { x: span.x0, y: r.at }, b: { x: span.x1, y: r.at } })),
    ...cols.map((c) => ({ axis: 'v', at: c.at, a: { x: c.at, y: span.y0 }, b: { x: c.at, y: span.y1 } })),
  ];

  const segments = [];
  const build = (lane, axis) => {
    const on = inside
      .filter((l) => Math.abs((axis === 'h' ? l.y : l.x) - lane.at) <= o.alignTol)
      .sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    if (!on.length) return;
    const at = (v) => (axis === 'h' ? { x: v, y: lane.at } : { x: lane.at, y: v });
    const coord = (l) => (axis === 'h' ? l.x : l.y);
    const lo = axis === 'h' ? span.x0 : span.y0;
    const hi = axis === 'h' ? span.x1 : span.y1;
    const cLo = axis === 'h' ? chunk.x0 : chunk.y0;
    const cHi = axis === 'h' ? chunk.x1 : chunk.y1;

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
    push(cLo, coord(on[0]), 'light-edge', ['edge', on[0].id]);
    push(coord(on[on.length - 1]), cHi, 'light-edge', [on[on.length - 1].id, 'edge']);

    // ...AND ON ACROSS A BED, AS AN EXTRA CANDIDATE AND NOT A REPLACEMENT.
    //
    // The reach matters because of where a segment's MIDPOINT lands, and that
    // cuts both ways: extending the stub at the head end from "foot of the bed
    // → first light" to "head wall → first light" moves its middle several feet
    // towards the wall, which is the whole point for the wall — and would be a
    // loss for a desk sitting at the foot of the bed, whose best position was
    // the old middle. Replacing one with the other trades one surface's answer
    // for another's, which is not a fix.
    //
    // So both are offered and the ranking decides, per surface, on the only
    // thing that matters: which midpoint is nearer the thing being lit. They
    // overlap, and two spots landing on the overlap are held apart by
    // minSpotGap exactly as two spots on neighbouring segments always were.
    if (lo < cLo - EPS) push(lo, coord(on[0]), 'light-edge', ['bed-edge', on[0].id]);
    if (hi > cHi + EPS) {
      push(coord(on[on.length - 1]), hi, 'light-edge', [on[on.length - 1].id, 'bed-edge']);
    }
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
                               clearance = 0, wallMin = 0, overBed = false,
                               reasons = null } = {}) {
  const note = (s) => { reasons?.add(s); return false; };
  return (p) => {
    if (!pointInPolygon(p, polygon)) return note('outside the space');
    for (const z of zones) {
      // A BED IS THE ONE ZONE A DIRECTIONAL SPOT MAY CROSS, and only because
      // the caller said so. See SPOT_DEFAULTS.overBed: the glare rule that
      // makes a bed a no-light zone is a rule about a fitting firing straight
      // down, and this is not that fitting. Every other zone is a hole in the
      // ceiling or somebody's instruction, and neither of those cares what the
      // fitting is aimed at.
      if (overBed && isBedZone(z)) continue;
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
                                         taken = [], tracks = [], opt = {} } = {}) {
  const o = { ...SPOT_DEFAULTS, ...RUN_DEFAULTS, ...opt };
  const wallMin = o.wallDistance ?? opt.minWallDistance ?? 0;
  const clearance = opt.fanClearance ?? 0;
  const centre = centreOf(surface);

  // THE ZONES GO IN TWICE, TO TWO DIFFERENT QUESTIONS. `spanZones` asks which
  // of them lends this chunk a stretch of grid (a bed against it does); the
  // legality predicate below asks which of them a fitting may stand in (a bed,
  // if `overBed`). Same list, and it has to be the same list — a grid extended
  // over a bed the legality rule still refuses would offer nothing but
  // rejections, and the reverse would place a fitting on ceiling that has no
  // grid on it.
  const grid = secondaryGrid(chunk, lights, { ...o, spanZones: zones });
  if (!grid.segments.length) {
    return { rejected: 'This piece of ceiling has no grid to stand a spot on.' };
  }

  const reasons = new Set();
  const base = spotLegality({ polygon, zones, fixtures, coves, clearance, wallMin,
                              overBed: o.overBed, reasons });
  const legal = (p) => {
    if (!base(p)) return false;
    // A spot standing ON its surface has no direction to point in. THE ONE RULE
    // THAT IS NOT SHARED, because it is about the thing being lit rather than
    // about the ceiling, and the art cluster next door has its own version of it.
    if (rectDistance(p, surface) < EPS && Math.hypot(p.x - centre.x, p.y - centre.y) < o.minStandoff) {
      reasons.add('directly over the surface, with nothing to aim at'); return false;
    }
    // CLEAR OF THE FITTINGS ALREADY PLACED. The used-once ledger stops a second
    // spot taking the same SEGMENT, which is not the same as stopping it landing
    // six inches from one on the segment next door. Same floor as a run's, for
    // the same reason: two trims closer than that read as a collision.
    for (const t of taken) {
      if (Math.hypot(p.x - t.x, p.y - t.y) < o.minSpotGap - EPS) {
        reasons.add('within six inches of a spot that is already there'); return false;
      }
    }
    return true;
  };

  /** One chosen position, as the spot the caller gets back. */
  const made = (p, seg, kind, d, aimFt, far) => {
    const dx = centre.x - p.x, dy = centre.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: p.x, y: p.y,
      aim: { x: dx / len, y: dy / len },
      angle: Math.atan2(dy, dx),
      target: centre,
      via: kind, segment: seg, distance: d,
      // HOW FAR IT IS ACTUALLY AIMING, from the fitting to the thing it lights.
      // `distance` above is measured from the middle of the segment and was
      // only ever a ranking figure; this is the one the drawing and the panel
      // can quote, because it is measured from where the fitting ended up.
      aimFt,
      // PAST THE CAP, AND SAYING SO. See the note above the search: a spot
      // aiming further than maxAimFt is grazing rather than lighting, and it is
      // drawn because the alternative is nothing at all — not because it is
      // right. Absent on an ordinary spot, so `sp.far` reads as the exception
      // it is.
      ...(far ? { far: true } : {}),
      // How far off the middle of its own run it had to stand, in feet. 0
      // for the ordinary case, and worth carrying because a spot that slid
      // is a spot the drawing should be able to explain.
      slid: Math.hypot(p.x - seg.mid.x, p.y - seg.mid.y),
    };
  };

  // NEAR BEATS THE KIND OF SEGMENT, AND THAT IS A CHANGE FROM WHAT THIS DID.
  //
  // Light-to-light used to be exhausted before an edge segment was considered
  // at all, and the argument for that was about the DRAWING: a fitting halfway
  // between two downlights reads as part of the layout, and one on a stub out
  // to the wall reads less so. It is a good argument about two candidates
  // beside the same table. It is the wrong argument when the two candidates are
  // twelve feet apart, because then the choice is not "which of these reads
  // better" but "does this fitting light the thing it is for" — and a tidy spot
  // aiming across the room lights nothing.
  //
  // So the cap is the OUTER tier and the kind is the inner one: everything
  // inside maxAimFt is considered, light-to-light first exactly as before, and
  // a position past the cap is taken only when nothing inside it worked.
  //
  // A CAP AND NOT A VETO, deliberately. A run dissolves when no lane will take
  // it inside the cap, because it has somewhere to fall back to — its members
  // become singletons. A singleton has nowhere: the honest options are a spot
  // that grazes and admits it, or no spot at all, and a fitting a person can
  // see and drag is worth more than a sentence in a panel. So it is placed,
  // marked `far`, and the drawing says so.
  const rail = tracks.length ? (p) => carriedByTrack(p, tracks, o) : null;
  let far = null;

  for (const kind of ['light-light', 'light-edge']) {
    const ranked = grid.segments
      .filter((s) => s.kind === kind)
      .map((s) => {
        const d = rectDistance(s.mid, surface);
        // A CANDIDATE NO RAIL CAN CARRY COSTS EXTRA, in a room that has a
        // track. See SPOT_DEFAULTS.trackMissFt — on a track ceiling, a head on
        // the profile and a head three and a half feet off it are two different
        // products, not two positions.
        const miss = rail && !rail(s.mid) ? o.trackMissFt : 0;
        return { s, d, rank: d + miss };
      })
      .sort((a, b) => a.rank - b.rank || a.s.length - b.s.length);
    for (const { s, d } of ranked) {
      // Spent by another surface. Not a rule about geometry, so it is checked
      // before the geometry — no point reporting "inside a clearance" about a
      // segment that was never available.
      if (usedSegments?.has(segmentKey(s))) { reasons.add('already used by another surface'); continue; }
      const p = standIn(s, o, legal, surface);
      if (!p) continue;
      const aimFt = rectDistance(p, surface);
      if (aimFt > o.maxAimFt + EPS) {
        // The NEAREST of the far ones, not the first found: the ranking is per
        // kind, so the first light-light candidate past the cap can be further
        // out than an edge candidate this loop has not reached yet.
        if (!far || aimFt < far.aimFt) far = { p, s, kind, d, aimFt };
        continue;
      }
      return { spot: made(p, s, kind, d, aimFt, false), grid };
    }
  }

  if (far) {
    return { spot: made(far.p, far.s, far.kind, far.d, far.aimFt, true), grid };
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

// ---------------------------------------------------------------------------
// RUNS. Two spots are not two decisions.
//
// Everything above places ONE spot against the ambient grid, and the argument
// for where it goes is the header's: a spot on the layout's own geometry reads
// as deliberate. That argument was made about a spot and a ceiling. It was
// never made about a spot and ANOTHER SPOT, and the moment there are two the
// eye compares them to each other before it compares either to the downlights.
//
// A pair of coffee tables side by side is the case that showed it. Each table
// got the segment nearest itself; one landed on the row through the tables and
// the other on the row a full cell above, aiming a different way. Both legal,
// both on the grid, and together they read as two unrelated decisions about
// one piece of furniture — because that is what they were.
//
// SO PEER SURFACES ARE PLACED AS A RUN: one lane, chosen for the group, with
// every member's spot standing on it. Proximity beats grid membership at short
// range, and a run is the only arrangement that satisfies both — it is on the
// layout's geometry AND it is internally coherent.
//
// The run is ALL OR NOTHING. A lane that will not take every member is not a
// lane for this group, and if no lane will, the group dissolves and each
// surface goes back to the rules above unchanged. A tidy run that lights
// nothing properly is worse than a scattered pair that does.
// ---------------------------------------------------------------------------

export const RUN_DEFAULTS = {
  // SIX INCHES, and it is a FLOOR rather than a target. Roughly two trim
  // diameters on a 75mm spot, which is the distance at which two fittings stop
  // reading as a collision and start reading as a pair. Nothing aims for it —
  // members take their own nearest node and the spacing that falls out is the
  // furniture's own rhythm — but nothing may go under it.
  minSpotGap: 0.5,

  // COLINEAR ENOUGH TO BE A ROW, as a fraction of the smaller surface's short
  // side. Deliberately not alignTol: that figure is the residue the ambient
  // aligner leaves behind on a light, and two tables are not lights. Half the
  // short side is the honest reading of "these look like they are in a line" —
  // it scales with the furniture, so a pair of side tables has to be tidier
  // than a pair of dining tables to qualify.
  alignFrac: 0.5,

  // ADJACENT, NOT MERELY ALIGNED, as a multiple of the smaller member's own
  // span along the run. Two coffee tables eight inches apart are one object.
  // A coffee table and a dining table fourteen feet apart that happen to share
  // a y are two objects, and lighting them off one lane would drag one of them
  // across the room for the sake of a tidy drawing.
  gapFactor: 1.0,

  // THE HARD CAP, and the only thing that dissolves a run.
  //
  // Judged on aim distance rather than on the angle the fitting ends up at,
  // which was the other candidate. Angle is the truer measure of whether a
  // spot is doing its job, but it needs a ceiling height this module does not
  // have and it breaks more runs than it saves. Five feet is the distance past
  // which a narrow beam is grazing a table rather than lighting it, at every
  // ceiling height a domestic plan actually uses.
  maxAimFt: 5.0,

  // WHAT A SIBLING'S SEGMENT COSTS, in feet of apparent distance.
  //
  // Two members whose nearest nodes tie will both reach for the same segment,
  // and the six-inch floor then resolves it by sliding the second one along.
  // Sometimes that is exactly right — two tables with one pair of downlights
  // between them get a pair of spots in that gap, which is the detail a
  // designer would draw — and sometimes it is the old bug, two fittings a foot
  // apart splaying at tables eight feet apart.
  //
  // WHAT SEPARATES THE TWO IS HOW GOOD THE ALTERNATIVE IS, so this is a
  // surcharge and not a veto. It was a veto first: any unused segment beat a
  // shared one however bad it was, which sent the second table's spot out past
  // a downlight to a stub at the chunk edge rather than let it stand a foot
  // from its neighbour. A foot and a half is enough that a comparable
  // alternative wins and a much worse one does not.
  shareSurchargeFt: 1.5,
};

const shortSide = (s) => Math.min(s.x1 - s.x0, s.y1 - s.y0);
const spanAlong = (s, axis) => (axis === 'h' ? s.x1 - s.x0 : s.y1 - s.y0);
const gapAlong = (a, b, axis) => (axis === 'h'
  ? Math.max(a.x0 - b.x1, b.x0 - a.x1)
  : Math.max(a.y0 - b.y1, b.y0 - a.y1));

/**
 * Are these two surfaces members of the same run?
 *
 * Three tests, and all three have to pass. Same kind of thing, in a line, and
 * next to each other. The predicate UNDER-GROUPS ON PURPOSE: a run that should
 * have formed and did not is the behaviour this file had all along, while a
 * run that should not have formed drags a spot away from the thing it lights.
 */
function samePeer(a, b, axis, o) {
  // 1. THE SAME KIND OF THING. Grouping asserts "these two are one piece of
  //    furniture", and a desk beside a side table is not that. An untyped
  //    surface never groups at all — the type is the only evidence there is
  //    and its absence is not a reason to guess.
  if (!a.type || !b.type || a.type !== b.type) return false;

  const across = axis === 'h' ? 'y' : 'x';
  const ca = centreOf(a), cb = centreOf(b);

  // 2. IN A LINE, to within half the smaller one's short side.
  if (Math.abs(ca[across] - cb[across]) > o.alignFrac * Math.min(shortSide(a), shortSide(b))) {
    return false;
  }

  // 3. NEXT TO EACH OTHER. A negative gap means they overlap in this axis,
  //    which is as adjacent as it gets.
  const gap = gapAlong(a, b, axis);
  return gap <= o.gapFactor * Math.min(spanAlong(a, axis), spanAlong(b, axis));
}

/**
 * Sort the room's surfaces into runs and singletons.
 *
 * Returns `[{ axis, members: [index…] }]` covering every surface exactly once —
 * singletons carry `axis: null` and a single member, so the caller has one list
 * to walk rather than two.
 *
 * HORIZONTAL RUNS ARE LOOKED FOR FIRST and a surface joins at most one run.
 * With both axes tried on equal footing a square-ish pair sitting diagonally
 * could land in either, and which one it landed in would depend on the order
 * the model happened to list them. One fixed order is worth more here than a
 * cleverer rule, because the drawing has to come out the same twice.
 */
export function groupSurfaces(surfaces, opt = {}) {
  const o = { ...SPOT_DEFAULTS, ...RUN_DEFAULTS, ...opt };
  const used = new Array(surfaces.length).fill(false);
  const runs = [];

  for (const axis of ['h', 'v']) {
    const along = axis === 'h' ? 'x' : 'y';

    // By type, because a run is by definition all of one thing.
    const byType = new Map();
    surfaces.forEach((s, i) => {
      if (used[i] || !s?.type) return;
      if (!byType.has(s.type)) byType.set(s.type, []);
      byType.get(s.type).push(i);
    });

    for (const idx of byType.values()) {
      // ALONG THE AXIS, so "adjacent" is tested between neighbours rather than
      // between whichever two the list happened to put next to each other. A
      // chain of three tables is three surfaces each adjacent to the next, and
      // the ends need never have been adjacent to one another.
      idx.sort((a, b) => centreOf(surfaces[a])[along] - centreOf(surfaces[b])[along] || a - b);

      let chain = [idx[0]];
      const flush = () => { if (chain.length > 1) runs.push({ axis, members: [...chain] }); };
      for (let k = 1; k < idx.length; k++) {
        if (samePeer(surfaces[chain[chain.length - 1]], surfaces[idx[k]], axis, o)) {
          chain.push(idx[k]);
        } else { flush(); chain = [idx[k]]; }
      }
      flush();
    }
    for (const r of runs) for (const i of r.members) used[i] = true;
  }

  surfaces.forEach((_, i) => { if (!used[i]) runs.push({ axis: null, members: [i] }); });
  return runs;
}

/** How far a lane stands off a rectangle, measured across its own axis. */
function laneOffset(lane, box, axis) {
  return axis === 'h'
    ? Math.max(box.y0 - lane.at, 0, lane.at - box.y1)
    : Math.max(box.x0 - lane.at, 0, lane.at - box.x1);
}

/** The smallest rectangle containing all of them. */
function bboxOf(rects) {
  return rects.reduce((b, r) => ({
    x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0),
    x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}

/**
 * Try to stand the whole run on ONE lane. All of it or none of it.
 *
 * Members are placed in the order they sit along the lane, each taking the node
 * nearest its OWN surface — the midpoint of the best segment on that lane, with
 * the usual slide when the midpoint is unavailable. Nothing is evenly pitched
 * and nothing is centred on the group: the spacing that comes out is the
 * spacing of the furniture, which is the rhythm the room already has.
 *
 * The six-inch floor is enforced through the same `legal` predicate as every
 * other rule, so a member whose best node is already taken by its neighbour
 * SLIDES rather than failing — the nudge falls out of standIn for free.
 */
function runOnLane(lane, members, segs, o, legalBase, taken, rail = null) {
  const along = lane.axis === 'h' ? 'x' : 'y';
  const order = members
    .map((m) => ({ m, at: centreOf(m.s)[along] }))
    .sort((a, b) => a.at - b.at)
    .map((e) => e.m);

  const chosen = [];
  for (const m of order) {
    const centre = centreOf(m.s);
    const legal = (p) => {
      if (!legalBase(p)) return false;
      if (rectDistance(p, m.s) < EPS
          && Math.hypot(p.x - centre.x, p.y - centre.y) < o.minStandoff) return false;
      for (const t of taken) {
        if (Math.hypot(p.x - t.x, p.y - t.y) < o.minSpotGap - EPS) return false;
      }
      for (const c of chosen) {
        if (Math.hypot(p.x - c.p.x, p.y - c.p.y) < o.minSpotGap - EPS) return false;
      }
      return true;
    };

    // A SIBLING'S SEGMENT COSTS EXTRA. See shareSurchargeFt — the ranking is on
    // the surcharged distance, so a genuinely better segment elsewhere wins and
    // a far worse one does not.
    const spent = new Set(chosen.map((c) => segmentKey(c.s)));

    let got = null;
    for (const kind of ['light-light', 'light-edge']) {
      const ranked = segs
        .filter((s) => s.kind === kind)
        .map((s) => {
          const d = rectDistance(s.mid, m.s);
          // TWO SURCHARGES, ADDED, AND THEY ARE ABOUT DIFFERENT THINGS: one
          // says a sibling is already standing here, the other says no rail can
          // carry this. Both are preferences on the same scale, so they compose
          // — a node that is both taken and off the profile is worth three feet
          // less than it looks, which is the right answer.
          const miss = rail && !rail(s.mid) ? o.trackMissFt : 0;
          return { s, d,
                   rank: d + miss + (spent.has(segmentKey(s)) ? o.shareSurchargeFt : 0) };
        })
        .sort((a, b) => a.rank - b.rank || a.s.length - b.s.length);
      for (const { s, d } of ranked) {
        const p = standIn(s, o, legal, m.s);
        if (!p) continue;
        // THE HARD CAP, checked here rather than after the run is assembled, so
        // a member that cannot be served from this lane fails the lane at once
        // instead of dragging the other members through a placement that is
        // about to be thrown away.
        if (rectDistance(p, m.s) > o.maxAimFt + EPS) continue;
        got = { m, p, s, kind, d };
        break;
      }
      if (got) break;
    }
    if (!got) return null;
    chosen.push(got);
  }
  return chosen;
}

/**
 * Place a run of peer surfaces on one lane, or return null and let them go
 * their own ways.
 *
 * `members` are `{ s, i }` — the surface and its index in the caller's list.
 */
export function placeRun(members, axis, ctx = {}) {
  const o = { ...SPOT_DEFAULTS, ...RUN_DEFAULTS, ...(ctx.opt ?? {}) };
  const chunks = ctx.chunks?.length ? ctx.chunks : (ctx.chunk ? [ctx.chunk] : []);

  // ONE CHUNK, or no run. A chunk is a region of ceiling with its own grid, and
  // "one lane through the whole group" is meaningless when the group straddles
  // two grids. Members split across chunks fall back to the per-surface path,
  // which already knows how to handle exactly that.
  const chunk = chunkFor(centreOf(members[0].s), chunks);
  if (!chunk) return null;
  if (!members.every((m) => chunkFor(centreOf(m.s), chunks) === chunk)) return null;

  const wallMin = o.wallDistance ?? ctx.opt?.minWallDistance ?? 0;
  const clearance = ctx.opt?.fanClearance ?? 0;
  const legalBase = spotLegality({
    polygon: ctx.polygon, zones: ctx.zones ?? [], fixtures: ctx.fixtures ?? [],
    coves: ctx.coves ?? [], clearance, wallMin, overBed: o.overBed,
  });

  // The same two questions of the same list as in placeTaskSpot: which zones
  // lend this chunk grid, and which a fitting may stand in.
  const grid = secondaryGrid(chunk, ctx.lights ?? [], { ...o, spanZones: ctx.zones ?? [] });
  const rail = ctx.tracks?.length ? (p) => carriedByTrack(p, ctx.tracks, o) : null;
  const box = bboxOf(members.map((m) => m.s));

  // LANES PARALLEL TO THE GROUP'S OWN AXIS. A vertical lane serving a pair of
  // tables that run left-to-right gives a run of spots at right angles to the
  // run of furniture, which lights neither table from anywhere sensible.
  //
  // A LANE MAY RUN STRAIGHT THROUGH THE GROUP, and in a real room it usually
  // does. This asked for a minimum offset first, on the reasoning that a lane
  // crossing the surfaces gives every member a sideways aim — and it threw away
  // the only usable lane in the plan it was written for. The ambient row that
  // serves a seating zone runs THROUGH that zone, because that is where the
  // downlights for it went; the next row up was six and a half feet off the
  // tables, past the cap, so the pair dissolved every time and the drawing
  // never changed. The rule that idea was really reaching for is minStandoff,
  // which already refuses a point with nothing to aim at, one point at a time
  // and on the evidence rather than on a blanket ban.
  //
  // Nearest first: a lane further out than it needs to be is a lane grazing
  // every surface at a flatter angle for nothing — the same reasoning, and the
  // same ordering, as the art rows next door. A lane already further from the
  // group than the cap allows can serve nobody, so it is dropped here rather
  // than discovered member by member.
  //
  // AND A LANE A RAIL CAN CARRY WINS A TIE AND A LITTLE MORE, in a room with a
  // track: a run of directional heads on the profile is one circuit and one
  // piece of ironmongery, and the same run a yard off it is a row of separate
  // recessed fittings. Charged the same way and on the same scale as everything
  // else here — see SPOT_DEFAULTS.trackMissFt — so a rail out past the cap
  // still loses to a lane that can actually serve the group.
  const alongMid = axis === 'h' ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2;
  const lanes = grid.lines
    .filter((l) => l.axis === axis)
    .map((l) => {
      const off = laneOffset(l, box, axis);
      const at = axis === 'h' ? { x: alongMid, y: l.at } : { x: l.at, y: alongMid };
      return { l, off, rank: off + (rail && !rail(at) ? o.trackMissFt : 0) };
    })
    .filter((q) => q.off <= o.maxAimFt + EPS)
    .sort((a, b) => a.rank - b.rank || a.off - b.off);

  const taken = [...(ctx.taken ?? [])];

  for (const { l, off } of lanes) {
    const segs = grid.segments.filter((s) => s.axis === axis
      && Math.abs((axis === 'h' ? s.a.y : s.a.x) - l.at) <= o.alignTol);
    if (!segs.length) continue;
    const chosen = runOnLane(l, members, segs, o, legalBase, taken, rail);
    if (chosen) return { chosen, grid, lane: l, standoff: off };
  }
  return null;
}

/**
 * Every surface in one room, each with its own spot.
 *
 * PEER SURFACES GO UP AS A RUN, everything else one at a time. See the RUNS
 * header above for why a second spot changes what the first one has to satisfy.
 *
 * ONE SPOT LIGHTS ONE SURFACE. Placed independently, two surfaces near the same
 * pair of downlights would both pick that pair's midpoint and the drawing would
 * show one fitting apparently aimed at two things. So a segment is spent once:
 * whoever takes it first takes it, and the next surface moves on to its own
 * second choice.
 *
 * THE LEDGER IS SUSPENDED INSIDE A RUN, and only inside one. Its stated reason
 * is two fittings landing on one point, and the rule it actually implements is
 * one fitting per run of ceiling — which is coarser, and is what threw the
 * second coffee table onto a different row because six inches of a six-foot
 * segment had been taken. Within a run the real constraint is available: the
 * members are on a chosen lane by design and minSpotGap governs how close two
 * of them may get. Between unrelated surfaces the ledger stands, because two
 * spots six inches apart aiming at different things IS the bug it was written
 * for.
 *
 * FIRST PICK GOES TO THE LARGEST SURFACE, and that is a real choice rather than
 * an accident of the order the model happened to list them in. A dining table
 * and a coffee table competing for one segment should be resolved in favour of
 * the dining table: it is the bigger commitment, it is harder to light from
 * somewhere else, and a compromise on the coffee table costs less. A run is
 * ranked on the total area of its members, so a pair of coffee tables outranks
 * a single one — the run is the commitment, not any one table in it.
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
  const o = { ...SPOT_DEFAULTS, ...RUN_DEFAULTS, ...(ctx.opt ?? {}) };
  const area = (s) => Math.max(0, s.x1 - s.x0) * Math.max(0, s.y1 - s.y0);

  const usedSegments = new Set();
  const taken = [...(ctx.taken ?? [])];
  const out = new Array(surfaces.length);

  // CHANDELIER SKIPS FIRST, BEFORE ANYTHING IS GROUPED. A surface a chandelier
  // already lights is not going to be lit, and letting it into a run would let
  // it constrain the lane chosen for tables that ARE getting a fitting — a
  // vote cast by something that is not standing for election.
  const live = [];
  surfaces.forEach((s, i) => {
    const skip = chandelierOver(s, ctx.chandeliers, ctx.opt);
    if (skip) {
      out[i] = { skipped: `A chandelier is ${skip.distance.toFixed(1)} ft away and`
        + ` already lights this surface.` };
      return;
    }
    live.push({ s, i });
  });

  /** One surface, on its own, by the rules above. */
  const placeOne = ({ s, i }) => {
    const chunk = chunkFor(centreOf(s), chunks);
    if (!chunk) { out[i] = { rejected: 'This surface is not in any chunk of ceiling.' }; return; }
    let res = placeTaskSpot(s, { ...ctx, chunk, usedSegments, taken });

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
    //
    // AND A `far` SPOT COUNTS AS A REFUSAL FOR THIS PURPOSE. It is a position
    // in the right chunk that grazes its surface from beyond the cap, and the
    // whole reason the other chunks are consulted is that the right chunk
    // sometimes has nothing to offer. A compromise in the own chunk is not a
    // reason to stop looking — but it IS the answer unless one of the others
    // aims from closer, which is what the comparison below is for. Nothing
    // moves for the sake of moving.
    if (!res.spot || res.spot.far) {
      const centre = centreOf(s);
      const others = chunks
        .filter((c) => c !== chunk)
        .map((c) => ({ c, d: rectDistance(centre, c) }))
        .sort((a2, b2) => a2.d - b2.d);
      for (const { c } of others) {
        const alt = placeTaskSpot(s, { ...ctx, chunk: c, usedSegments, taken });
        if (!alt.spot) continue;
        if (res.spot && !(alt.spot.aimFt < res.spot.aimFt - EPS)) continue;
        res = { ...alt, spot: { ...alt.spot, viaChunk: 'nearest' } };
        // A nearer compromise is still a compromise: keep looking for a chunk
        // that can serve the surface inside the cap.
        if (!res.spot.far) break;
      }
    }

    if (res.spot) {
      usedSegments.add(segmentKey(res.spot.segment));
      taken.push({ x: res.spot.x, y: res.spot.y });
    }
    out[i] = res;
  };

  // THE UNITS OF THE DECISION: runs and singletons in one list, largest first.
  const units = groupSurfaces(live.map((e) => e.s), o).map((g) => ({
    axis: g.axis,
    members: g.members.map((k) => live[k]),
    weight: g.members.reduce((a, k) => a + area(live[k].s), 0),
    first: Math.min(...g.members.map((k) => live[k].i)),
  })).sort((a, b) => b.weight - a.weight || a.first - b.first);

  for (const u of units) {
    if (u.members.length > 1) {
      const run = placeRun(u.members, u.axis, { ...ctx, chunks, taken, opt: o });
      if (run) {
        run.chosen.forEach((c, k) => {
          const centre = centreOf(c.m.s);
          const dx = centre.x - c.p.x, dy = centre.y - c.p.y;
          const len = Math.hypot(dx, dy) || 1;
          out[c.m.i] = {
            spot: {
              x: c.p.x, y: c.p.y,
              aim: { x: dx / len, y: dy / len },
              angle: Math.atan2(dy, dx),
              target: centre,
              via: c.kind, segment: c.s, distance: c.d,
              // The same field a singleton carries, and never `far`: a run is
              // only ever assembled inside the cap — runOnLane refuses a member
              // past it and the lane fails — so a run member cannot be a
              // compromise of this kind. See the cap note in placeTaskSpot.
              aimFt: rectDistance(c.p, c.m.s),
              slid: Math.hypot(c.p.x - c.s.mid.x, c.p.y - c.s.mid.y),
              // WHAT THE DRAWING NEEDS TO EXPLAIN ITSELF. A spot that stands
              // where it does because of its neighbours rather than because of
              // its own surface should be able to say so.
              run: { axis: u.axis, index: k, of: run.chosen.length,
                     lane: { axis: run.lane.axis, at: run.lane.at,
                             a: run.lane.a, b: run.lane.b },
                     standoff: run.standoff },
            },
            grid: run.grid,
          };
          usedSegments.add(segmentKey(c.s));
          taken.push({ x: c.p.x, y: c.p.y });
        });
        continue;
      }
      // THE RUN DISSOLVED. No lane would take all of it inside the cap, so the
      // members stop being peers and become surfaces again — largest first,
      // exactly as if they had never been grouped. A tidy run that lights
      // nothing properly is worse than a scattered pair that does.
    }
    [...u.members].sort((a, b) => area(b.s) - area(a.s) || a.i - b.i).forEach(placeOne);
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
