// ---------------------------------------------------------------------------
// electrical.js — a door, a room and a set of fittings become switchboards.
//
// THE HARD PART IS THE DOOR, and not for the reason it looks.
//
// A detected door box encloses the leaf PLUS its quarter-circle swing, so in
// the wall's own frame it is an L x L square with one corner at the hinge (see
// doors.js's header). Reflect that square about its own mid-line and you get
// the identical square. THE BOX IS INVARIANT UNDER THE HINGE FLIP: no hinge
// information survives in it, exactly, however it is measured.
//
// SO THE ROOM DECIDES, NOT THE BOX. A door opens into the bulk of the space and
// parks its leaf against the smaller side — that is what a door is for, and an
// open leaf standing out in the middle of the floor is a door hung backwards.
// Everyone has met one.
//
// Which makes this an AREA test, and an exact one. Cut the room polygon on the
// line through the door, perpendicular to its wall. One side gets more floor:
//
//   THE HINGE GOES ON THE SIDE WITH LESS, so the open leaf tucks against the
//   near return and leaves the main space clear. The latch — and with it the
//   switchboard — is on the side with more, which is also the side your hand is
//   on as you walk in.
//
// WHAT THIS REPLACED, because the wrong version is the instructive one. It used
// to hinge toward the nearer end of the DOOR'S OWN WALL. That is a proxy for
// the same idea and it is wrong wherever a room is not a rectangle: it measures
// along one wall and cannot see that the floor turns a corner behind it, so on
// an L-shaped room it abstained exactly where the answer was obvious. It
// survives here only as the tie-break, for a door dead centre in a square room
// where there genuinely is no bigger side.
//
// There was also a sampling test over the two candidate swings, and it was
// worse than useless. The two quarter-discs occupy the SAME square — the door's
// own box, pushed inward — and differ only by a reflection, so they scored alike
// everywhere except where the boundary cut through that box, and THERE it
// preferred the hinge AWAY from the intruding return, which is the opposite of
// how a door is hung. The area rule reads that same case correctly, so the
// sampling is gone rather than kept as a second opinion.
//
// RUNS, NOT EDGES. Everything measures along a WALL RUN — consecutive polygon
// edges merged while they stay within a few degrees of each other. geometry.js's
// dropCollinear only drops vertices below EPS, so a three-inch pilaster jog
// survives as its own twelve-pixel "wall"; measure against that and every clamp
// bites immediately, on a wall that is not a wall.
//
// A REFUSAL IS A SENTENCE, on the object, in the style of accentPlace.js. A
// board nobody can fit is a thing the user needs told; a board silently snapped
// somewhere else is a confident fitting nobody asked for.
//
// PLAN PIXELS throughout — the same space as doors.js's rects, outline
// pointsPx and accentPlace's placed zones. Millimetres arrive as millimetres
// and are converted here, once, and only when there is a scale to convert with.
//
// PURE. No React, no canvas, no fetch.
// ---------------------------------------------------------------------------

import { edges, pointInPolygon, polygonArea } from './geometry.js';
import { projectOntoWall } from './accentPlace.js';
import { openingPx, doorWidthAt, MM_PER_FT } from './doors.js';

/** The board itself, in millimetres. A 4-6 module plate, near enough. */
export const SB_MM = {
  // 300mm from the door's latch jamb to the NEAR edge of the plate.
  fromDoor: 300,
  // The same clear distance past the end of a TV unit.
  fromTv: 300,
  along: 230,   // plate width, along the wall
  deep: 80,     // how far it stands off the wall, for the drawing
  // The plate's far edge must still clear the corner by this much, or it is a
  // switch jammed into a return and it does not get built.
  clearEnd: 100,
};

/** Blue, because the brief said blue and because nothing else on the plan is. */
export const SB_COLOUR = '#2563EB';

export const ELEC_DEFAULTS = {
  // How far two consecutive edges may turn and still be one wall.
  runAngleTol: 3,
  // A door box must STRADDLE the boundary. Both of these are fractions of the
  // opening. Without them a detector misfire boxing a wardrobe sits wholly
  // inside the room, scores a perfect 1.00, and beats every real door.
  straddleOut: 0.04,
  straddleIn: 0.35,
  // Leaf-and-swing is near-square IN THE WALL'S FRAME. Beyond doubleAt it is
  // two leaves boxed together, which doors.js's maxAspect deliberately admits.
  squareLo: 0.55,
  squareHi: 2.40,
  doubleAt: 1.60,
  // Plausible door widths, in mm. Only checked when there is a scale.
  minMm: 600,
  maxMm: 1400,
  maxDoubleMm: 2000,
  // A door cannot be most of its own wall.
  fitsRunFrac: 0.90,
  // How far a box may sit from a wall and still be taken as being ON it, as a
  // fraction of the opening. Only used by the fallback pass, where the question
  // is no longer "is this a door" but "which wall is this door on".
  reachFrac: 0.60,
  // ...and the wall has to be long enough to be one.
  minRunFrac: 1.50,
  // Two rooms this close on the same door means the answer is "cannot tell".
  contestGap: 0.15,
  // How much of the room's floor has to be on one side of the door before that
  // side counts as "the bulk of it", as a fraction of the whole. At 0.10 the
  // winning side needs 55% of the floor — a door 45% of the way along the wall
  // of a plain rectangle is the boundary case, and it is genuinely a toss-up.
  areaTie: 0.10,
  // The tie-break's own tie-break: a door this close to the middle of its run
  // has no nearer end to hinge toward either.
  guessFrac: 0.05,
};

/** Room types a bedroom door leads INTO rather than in from. */
const SECONDARY = new Set(['toilet', 'balcony', 'store', 'utility', 'pooja_room']);

// --- small vector helpers, kept local so this file stays affine and pure -----

const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p, v) => ({ x: p.x + v.x, y: p.y + v.y });
const mul = (v, k) => ({ x: v.x * k, y: v.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (v) => Math.hypot(v.x, v.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const centreOf = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

/** Millimetres to plan pixels. The one place the two unit systems meet. */
export function px(mm, pxPerFt) {
  return (mm / MM_PER_FT) * pxPerFt;
}

/** The room's smaller side, for scaling the tolerances. Same idea as accentPlace. */
export function roomScale(polygon) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
}

// --- walls -------------------------------------------------------------------

/**
 * Consecutive near-collinear edges, merged into the walls a person would name.
 *
 * Starts the walk at a genuine corner rather than at vertex 0, so a wall that
 * happens to straddle the polygon's first vertex comes back as one run and not
 * as two stubs — which is the case that puts a board 40mm from a corner.
 *
 * Each candidate edge is compared against the run's FIRST direction, not its
 * last, so a long shallow curve cannot accumulate its way into one "straight"
 * wall three degrees at a time.
 */
export function wallRuns(polygon, opts = {}) {
  const o = { ...ELEC_DEFAULTS, ...opts };
  const es = edges(polygon).filter(([a, b]) => len(sub(b, a)) > 1e-9);
  const n = es.length;
  if (!n) return [];

  const dir = es.map(([a, b]) => {
    const d = sub(b, a), L = len(d);
    return { x: d.x / L, y: d.y / L };
  });
  const tol = Math.cos((o.runAngleTol * Math.PI) / 180);

  let start = -1;
  for (let i = 0; i < n; i++) {
    if (dot(dir[i], dir[(i - 1 + n) % n]) < tol) { start = i; break; }
  }
  // No corner anywhere: a traced circle, or a single edge. Every edge is its own
  // run — wrong-ish, but bounded, and better than one run that wraps the polygon.
  if (start < 0) {
    return es.map(([a, b], i) => ({ a, b, index: i, indices: [i], length: len(sub(b, a)) }));
  }

  const runs = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const [a, b] = es[i];
    if (cur && dot(dir[i], dir[cur.index]) >= tol) {
      cur.b = b;
      cur.indices.push(i);
    } else {
      if (cur) runs.push(cur);
      cur = { a, b, index: i, indices: [i] };
    }
  }
  if (cur) runs.push(cur);
  return runs.map((r) => ({ ...r, length: len(sub(r.b, r.a)) }));
}

/**
 * A run's own frame, with the inward normal TESTED rather than assumed.
 *
 * Polygon winding is not guaranteed anywhere upstream, so which way the normal
 * points is a question and not a convention. Probed at the run's MIDPOINT: the
 * one parameter on a straight wall that is never a vertex, never clamped, and
 * never the placement point itself — where pointInPolygon is a coin flip,
 * because the point lies exactly on the edge it is being tested against.
 */
export function runFrame(run, polygon, scale = 1) {
  const d = sub(run.b, run.a), L = len(d) || 1;
  const u = { x: d.x / L, y: d.y / L };
  const nvec = { x: -u.y, y: u.x };
  const eps = Math.max(1e-6, scale * 1e-3);
  const mid = add(run.a, mul(u, L / 2));
  const inside = pointInPolygon(add(mid, mul(nvec, eps)), polygon);
  return {
    u, n: nvec,
    inward: inside ? nvec : { x: -nvec.x, y: -nvec.y },
    sign: inside ? 1 : -1,
    origin: run.a,
    wallLength: L,
  };
}

/**
 * A box, a run -> the box in that wall's frame, plus how much of it is in the
 * room and how much is in the wall.
 *
 * `insideFrac` is the analytic limit of geometry.js's rectCoverage on a straight
 * wall: no sampling, and it hands back the wall thickness for free. A box that
 * swings into the room comes back near L/(L+thickness); one that swings away
 * comes back near zero.
 */
export function wallFrame(rect, run, polygon, scale = 1) {
  const f = runFrame(run, polygon, scale);
  const p = projectOntoWall(rect, run);
  const s = f.sign;
  const nIn = s > 0 ? p.n1 : -p.n0;
  const nOut = s > 0 ? -p.n0 : p.n1;
  return {
    ...p,
    inward: f.inward, sign: s,
    nIn, nOut,
    tExt: p.t1 - p.t0,
    nExt: p.n1 - p.n0,
    insideFrac: nIn / Math.max(1e-9, nIn + Math.max(0, nOut)),
    wallThicknessPx: Math.max(0, nOut),
  };
}

/** Distance from a point to a segment. geometry.js keeps its copy private. */
function distToSegment(p, a, b) {
  const d = sub(b, a), l2 = dot(d, d);
  const t = l2 === 0 ? 0 : clamp(dot(sub(p, a), d) / l2, 0, 1);
  return len(sub(p, add(a, mul(d, t))));
}

/** The run that continues from this one, in the given direction along it. */
function adjacentRun(runs, run, dir, tol) {
  const at = dir > 0 ? run.b : run.a;
  for (const q of runs) {
    if (q === run) continue;
    if (dir > 0 && len(sub(q.a, at)) <= tol) return { run: q, from: 0 };
    if (dir < 0 && len(sub(q.b, at)) <= tol) return { run: q, from: 1 };
  }
  return null;
}

// --- which door opens into this room ----------------------------------------

/**
 * The best wall of this room for this door, or null if it is not this room's.
 *
 * Gates first, score second. The gates are what stop a wardrobe becoming a
 * door; the score only ranks the walls that survive them.
 */
export function doorCandidate(door, polygon, opts = {}) {
  const o = { ...ELEC_DEFAULTS, ...opts };
  const pxPerFt = o.pxPerFt ?? null;
  const scale = o.scale ?? roomScale(polygon);
  const L = openingPx(door.rect);
  if (!(L > 0)) return null;

  // RELAXED: the question is no longer "is this box a door" — something
  // upstream already decided that — but only "which wall of this room is it
  // on". So the shape and width gates come off and all that is left is reach.
  // See the fallback in planSwitchboards for when this is used and why.
  const relax = !!o.relax;

  let best = null;
  for (const run of wallRuns(polygon, o)) {
    if (!relax && run.length < o.minRunFrac * L) continue;
    const f = wallFrame(door.rect, run, polygon, scale);
    const dist = distToRun(door.rect, run);
    const ratio = f.tExt / Math.max(1e-9, f.nExt);
    const double = ratio > o.doubleAt;

    if (relax) {
      if (dist > o.reachFrac * L) continue;      // not on this wall
      if (f.nIn <= 0) continue;                  // the room is not on the swing side
    } else {
      // It has to cross the boundary — out through the wall, and in over the floor.
      if (f.nOut < o.straddleOut * L) continue;
      if (f.nIn < o.straddleIn * L) continue;
      // ...and be leaf-shaped in THIS wall's frame, not in the image's axes.
      if (ratio < o.squareLo || ratio > o.squareHi) continue;
      if (pxPerFt) {
        const mm = doorWidthAt(door.rect, pxPerFt);
        if (mm == null || mm < o.minMm || mm > (double ? o.maxDoubleMm : o.maxMm)) continue;
      }
      if (f.tExt > o.fitsRunFrac * run.length) continue;
    }

    // One number ranks the walls, and a stable tie-break settles the rest:
    // the wall on which the box looks most like one opening. Mirrors the
    // ordering idiom in doors.js. Relaxed, nearness leads instead — the box is
    // a door already, so the only question left is which wall it sits on.
    const cand = {
      door, run, frame: f, double, L, dist, relaxed: relax,
      score: f.insideFrac, tExtErr: Math.abs(f.tExt - L),
    };
    const better = !best ? true
      : relax ? (cand.dist < best.dist - 1e-9
        || (cand.dist < best.dist + 1e-9 && cand.score > best.score))
      : (cand.score > best.score + 1e-9
        || (cand.score > best.score - 1e-9 && cand.tExtErr < best.tExtErr));
    if (better) best = cand;
  }
  return best;
}

/** How far a box sits from a wall, measured from its nearest corner. */
function distToRun(rect, run) {
  return Math.min(...cornersOf(rect).map((p) => distToSegment(p, run.a, run.b)));
}

/**
 * Two boxes over one door, merged.
 *
 * doors.js de-dups at iou 0.45, which lets a box round the leaf and a box round
 * the arc both survive — they barely overlap. Unioned rather than dropped,
 * because leaf-plus-arc IS the box this file wants.
 */
export function mergeDoors(doors = []) {
  const out = [];
  for (const d of doors) {
    if (!d?.rect) continue;
    const L = openingPx(d.rect);
    const c = centreOf(d.rect);
    const hit = out.find((q) => {
      const overlap = d.rect.x0 < q.rect.x1 && q.rect.x0 < d.rect.x1
        && d.rect.y0 < q.rect.y1 && q.rect.y0 < d.rect.y1;
      return overlap || len(sub(c, centreOf(q.rect))) < 0.5 * Math.max(L, openingPx(q.rect));
    });
    if (!hit) { out.push({ ...d }); continue; }
    hit.rect = {
      x0: Math.min(hit.rect.x0, d.rect.x0), y0: Math.min(hit.rect.y0, d.rect.y0),
      x1: Math.max(hit.rect.x1, d.rect.x1), y1: Math.max(hit.rect.y1, d.rect.y1),
    };
    hit.conf = Math.max(hit.conf ?? 0, d.conf ?? 0);
    hit.merged = (hit.merged ?? 1) + 1;
  }
  return out;
}

/**
 * Every door, offered to the rooms that could plausibly own it.
 *
 * SHARED, NOT DROPPED, and this is the correction to how it used to work.
 *
 * The old version insisted on exactly one owner: if the top two rooms scored
 * within `contestGap` it called the door contested and threw it away for BOTH.
 * That is defensible when the two claims are strong and equal, and a disaster
 * everywhere else, because the score it compared — `insideFrac`, the straddle
 * ratio — is a RATIO, and a ratio has thrown away the magnitude that separates
 * the two rooms in the first place. A box that pokes 50px into the room either
 * side of a wall scores 0.42 from both, which is not "two equally good claims";
 * it is one weak claim seen twice. Dropping it lost the only door a bedroom
 * had, and the space came back with a note saying no door opened into it —
 * which was not true, and was not something the note let anybody find out.
 *
 * So a door that cannot be separated stays a candidate for every room in the
 * tie, carrying `shared` with the ids it is tied between. Picking between them
 * is `entryDoor`'s job, and `entryDoor` has evidence this function does not:
 * what is on the other side of the wall, and what kind of room that is. A board
 * on the likely side of an ambiguous door beats no board at all, and it says on
 * the board which it was.
 *
 * NO NOTES FROM HERE. This runs once per room over the WHOLE plan, so anything
 * it pushed was reported in every space's panel — three identical sentences
 * about doors elsewhere on the drawing, under a bedroom. What is worth saying
 * is said per room, by the caller, about that room's own door.
 */
export function assignDoors(doors, rooms, opts = {}) {
  const o = { ...ELEC_DEFAULTS, ...opts };
  const byRoom = new Map(rooms.map((r) => [r.id, []]));

  for (const d of mergeDoors(doors)) {
    const scored = [];
    for (const r of rooms) {
      const c = doorCandidate(d, r.polygonPx, { ...o, scale: roomScale(r.polygonPx) });
      if (c) scored.push({ roomId: r.id, cand: c });
    }
    scored.sort((a, b) => b.cand.score - a.cand.score);
    if (!scored.length) continue;

    const tied = scored.filter((x) => scored[0].cand.score - x.cand.score < o.contestGap);
    for (const x of tied) {
      byRoom.get(x.roomId).push({
        ...x.cand,
        shared: tied.length > 1 ? tied.map((y) => y.roomId) : null,
      });
    }
  }
  return { byRoom, notes: [] };
}

/** A door box's centre, reflected to the far side of its own wall. */
function acrossTheWall(cand) {
  const c = centreOf(cand.door.rect);
  const f = cand.frame;
  const v = sub(c, f.origin);
  const nComp = dot(v, f.n);
  return sub(c, mul(f.n, 2 * nComp));
}

/**
 * Of this room's doors, the one you come IN through.
 *
 * A bedroom routinely has three: the corridor door, the ensuite door and the
 * balcony door. All three swing in, all three score alike, and the main board
 * belongs beside exactly one of them. So the box is mirrored across its own
 * wall and the question becomes what is on the other side — nothing named is
 * circulation, and circulation is the way in.
 */
export function entryDoor(cands, { rooms = [], roomTypes = {}, selfId = null } = {}) {
  if (!cands?.length) return null;
  const scored = cands.map((cand) => {
    const m = acrossTheWall(cand);
    const host = rooms.find((r) => r.id !== selfId && pointInPolygon(m, r.polygonPx)) ?? null;
    const type = host ? roomTypes[host.id]?.type ?? null : null;
    const rank = !host ? 0 : SECONDARY.has(type) ? 2 : 1;
    return { cand, host, type, rank };
  });
  // What is on the other side first, because it is the strongest thing known
  // about a door. Then a door this room owns outright ahead of one it is tied
  // for — an unambiguous door is better evidence than an ambiguous one even
  // when both point the same way. Then the wider opening.
  scored.sort((a, b) => a.rank - b.rank
    || (a.cand.shared ? 1 : 0) - (b.cand.shared ? 1 : 0)
    || b.cand.L - a.cand.L);
  const top = scored[0];
  const why = scored.length === 1
    ? 'the only door into this space'
    : top.rank === 0
      ? 'it opens onto circulation rather than into another space'
      : top.rank === 1
        ? 'every door here opens into another space, so the widest was taken'
        : 'the doors here only open onto a toilet or a balcony, so the widest was taken';
  return { ...top.cand, why, leadsTo: top.host?.id ?? null, leadsToType: top.type };
}

// --- the swing ---------------------------------------------------------------

/**
 * The floor on one side of a line, exactly.
 *
 * Sutherland-Hodgman against a single half-plane. On a concave room the clipped
 * outline can come back with degenerate edges running out and back along the
 * cut; those contribute nothing to the shoelace sum, so the AREA is right even
 * where the outline is not a shape anybody would draw. Area is all this is for.
 */
export function halfPlaneArea(polygon, origin, dir) {
  const side = (p) => (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out.length < 3 ? 0 : Math.abs(polygonArea(out));
}

/**
 * The room, cut on the door's own centreline, perpendicular to its wall.
 *
 * `up` is the floor beyond the door along the wall's +u direction and `down` is
 * the floor behind it. Cut at the door's MIDPOINT rather than at a jamb, so the
 * same line is used whichever way the answer comes out — cutting at the jamb
 * being tested would hand the door's own width to one side and bias the result
 * by a leaf.
 *
 * `lead` is how decisive the split is, as a fraction of the whole floor. It is
 * the number the rule actually turns on, and it is scale-free: a bedsit and a
 * ballroom with the same proportions give the same lead.
 */
export function swingSides(cand, polygon) {
  const f = cand.frame;
  const mid = (f.t0 + f.t1) / 2;
  const cut = add(f.origin, mul(f.u, mid));
  const up = halfPlaneArea(polygon, cut, f.u);
  const down = halfPlaneArea(polygon, cut, { x: -f.u.x, y: -f.u.y });
  const total = up + down;
  return { cut, mid, up, down, total, lead: total > 0 ? Math.abs(up - down) / total : 0 };
}

/**
 * Which end of the opening is the latch.
 *
 * The jambs are re-derived from `openingPx` about the box's midpoint rather
 * than read off the box's ends, because the box picks up frame and wall on one
 * axis (doors.js:17-27) and the opening is the shorter side by definition.
 *
 * Then the floor decides. See this file's header for why it is the floor and
 * not the wall.
 */
export function latchEnd(cand, polygon, opts = {}) {
  const o = { ...ELEC_DEFAULTS, ...opts };
  const { run, frame: f, L } = cand;
  const mid = (f.t0 + f.t1) / 2;

  // Two leaves meeting in the middle: both ends are hinges and the latch is the
  // centre. There is nothing to infer and no side to prefer.
  if (cand.double) return { latchT: mid, hingeT: null, confidence: 'double', sides: null };

  const lo = mid - L / 2, hi = mid + L / 2;
  const sides = swingSides(cand, polygon);

  if (sides.lead >= o.areaTie) {
    // Open toward the floor: latch on the wide side, hinge on the thin one.
    const openUp = sides.up > sides.down;
    return { latchT: openUp ? hi : lo, hingeT: openUp ? lo : hi, confidence: 'area', sides };
  }

  // A dead heat on floor — a door in the middle of the wall of a square room,
  // where both sides really are the same room. Fall back to the wall itself:
  // hinge toward the nearer corner, so the leaf parks against the return rather
  // than in the doorway. This also keeps the board stepping toward the middle
  // of the wall, where there is room for it.
  const dEnd = (t) => Math.min(t, run.length - t);
  const first = dEnd(lo) >= dEnd(hi);
  return {
    latchT: first ? lo : hi,
    hingeT: first ? hi : lo,
    confidence: Math.abs(dEnd(lo) - dEnd(hi)) < o.guessFrac * run.length ? 'guess' : 'convention',
    sides,
  };
}

// --- putting a plate on a wall -----------------------------------------------

/** The plate itself: a point on a wall becomes a rectangle standing off it. */
function plateAt(point, frame, pxPerFt, extra = {}) {
  const halfA = px(SB_MM.along, pxPerFt) / 2;
  const deep = px(SB_MM.deep, pxPerFt);
  const c = add(point, mul(frame.inward, deep / 2));
  const cs = [];
  for (const sa of [-1, 1]) {
    for (const sd of [-1, 1]) {
      cs.push(add(add(c, mul(frame.u, sa * halfA)), mul(frame.inward, (sd * deep) / 2)));
    }
  }
  return {
    point, centre: c,
    rect: {
      x0: Math.min(...cs.map((p) => p.x)), y0: Math.min(...cs.map((p) => p.y)),
      x1: Math.max(...cs.map((p) => p.x)), y1: Math.max(...cs.map((p) => p.y)),
    },
    alongPx: halfA * 2, deepPx: deep,
    along: frame.u, inward: frame.inward,
    ...extra,
  };
}

/** Is there room on this run, from `t`, going `dir`, for gap + plate + clearance? */
function roomOnRun(run, t, dir, need) {
  const end = dir > 0 ? run.length : 0;
  return (end - t) * dir >= need;
}

/**
 * A board beside something, with somewhere else to go when it does not fit.
 *
 * The ladder, in the order a person would try it: past the latch jamb; round
 * the corner, which is what actually happens on site; behind the open leaf,
 * marked as the poor answer it is; and then a sentence.
 *
 * NOT A CLAMP. accentPlace clamps a sconce to the end of its wall and says so,
 * and for a sconce that is a small error. A switch plate clamped to a corner is
 * jammed against a return with no plaster round it, and it does not get built.
 */
export function placeBoard({
  run, frame, runs, polygon, pxPerFt, fromT, awayFrom = null, gapMm, scale,
  allowHingeSide = true,
}) {
  const gap = px(gapMm, pxPerFt);
  const along = px(SB_MM.along, pxPerFt);
  const need = gap + along + px(SB_MM.clearEnd, pxPerFt);
  const dir = awayFrom == null
    ? (fromT <= run.length / 2 ? 1 : -1)
    : Math.sign(fromT - awayFrom) || 1;

  if (roomOnRun(run, fromT, dir, need)) {
    const t = fromT + dir * (gap + along / 2);
    return plateAt(add(frame.origin, mul(frame.u, t)), frame, pxPerFt,
      { wall: { a: run.a, b: run.b, index: run.index }, t, turnedCorner: false });
  }

  const tol = Math.max(1e-6, (scale ?? run.length) * 1e-3);
  const next = adjacentRun(runs, run, dir, tol);
  if (next && next.run.length >= need) {
    const f2 = runFrame(next.run, polygon, scale);
    const t = next.from === 0 ? gap + along / 2 : next.run.length - (gap + along / 2);
    return plateAt(add(f2.origin, mul(f2.u, t)), f2, pxPerFt, {
      wall: { a: next.run.a, b: next.run.b, index: next.run.index }, t,
      turnedCorner: true,
      note: 'The wall runs out before the board does, so it turns the corner.',
    });
  }

  if (allowHingeSide && awayFrom != null && roomOnRun(run, awayFrom, -dir, need)) {
    const t = awayFrom - dir * (gap + along / 2);
    return plateAt(add(frame.origin, mul(frame.u, t)), frame, pxPerFt, {
      wall: { a: run.a, b: run.b, index: run.index }, t, turnedCorner: false,
      poor: 'behind the open leaf',
    });
  }
  return null;
}

// --- the pass ----------------------------------------------------------------

const NO_SCALE = 'There is no scale on this drawing yet, so 300mm is not a'
  + ' distance it can measure. Pick a door and give it a width first.';

/**
 * One bedroom in, its switchboards out.
 *
 * Three rules, and every one of them reads something the drawing already knows:
 *
 *   1. the entry door        -> one board, 300mm past its latch jamb
 *   2. the bedside sconces   -> one board at each, on the sconce's own wall
 *   3. the TV unit's strip   -> one board 300mm past the end of the run
 *
 * Rules 2 and 3 take the ALREADY-PLACED fitting rather than re-deriving one
 * from the furniture box. A sconce is where accentPlace put it, including any
 * hand slide; and a strip's wall came from wallForRun, which disagrees with
 * nearestWall in a corner on purpose. Recomputing either would put a board on a
 * wall the fitting it feeds is not on.
 */
export function planSwitchboards({
  room,
  rooms = [],
  doors = [],
  roomTypes = {},
  accentZones = [],
  tvRect = null,
  pxPerFt = null,
  opts = {},
} = {}) {
  const o = { ...ELEC_DEFAULTS, ...opts };
  const polygon = room?.polygonPx ?? [];
  const boards = [];
  const notes = [];
  if (polygon.length < 3) return { boards, notes: ['This space has no outline to work from.'] };

  const scale = roomScale(polygon);
  const runs = wallRuns(polygon, o);
  const all = rooms.length ? rooms : [room];
  let seq = 0;
  const id = () => `sb-${room.id}-${seq++}`;
  const scaled = pxPerFt > 0;

  // --- 1. the door ----------------------------------------------------------
  //
  // A BEDROOM WITH A DOOR ON THE PLAN GETS A BOARD BESIDE IT. That is the whole
  // requirement, and everything below exists to honour it rather than to have
  // opinions about it.
  //
  // Two passes, because the first one is allowed to be picky and the second one
  // is not. `assignDoors` applies the real gates — is this box leaf-shaped, is
  // it a plausible width, does it cross this room's wall with its swing on the
  // floor — and on a clean drawing every door clears them. When none does, the
  // gates have refused a door that is plainly there, and refusing to place a
  // board is the wrong answer to that: the detector already decided the box is
  // a door, so the only question left is WHICH WALL it is on. The relaxed pass
  // asks exactly that and nothing else.
  const { byRoom } = assignDoors(doors, all, { ...o, pxPerFt });
  let mine = byRoom.get(room.id) ?? [];
  let fellBack = false;
  if (!mine.length && doors.length) {
    const near = [];
    for (const d of mergeDoors(doors)) {
      const c = doorCandidate(d, polygon, { ...o, pxPerFt, scale, relax: true });
      if (c) near.push(c);
    }
    near.sort((a, b) => a.dist - b.dist || b.score - a.score);
    if (near.length) { mine = [near[0]]; fellBack = true; }
  }

  if (!mine.length) {
    notes.push(doors.length
      ? 'No door on this plan is anywhere near this space, so there is no board beside one.'
      : 'No doors were detected on this plan, so there is no board beside a door.');
  } else {
    const entry = entryDoor(mine, { rooms: all, roomTypes, selfId: room.id });
    const { latchT, hingeT, confidence, sides } = latchEnd(entry, polygon, o);
    const base = {
      id: id(), roomId: room.id, role: 'door',
      serves: 'the entry door', servesShort: 'Door',
      hingeConfidence: confidence, doorId: entry.door.id,
      leadsTo: entry.leadsTo, shared: entry.shared ?? null, fellBack,
    };
    if (!scaled) {
      boards.push({ ...base, rejected: NO_SCALE });
    } else {
      // The board is placed toward the latch, and the latch is on the side the
      // door opens to — which is the side with the floor. See latchEnd.
      const placed = placeBoard({
        run: entry.run, frame: entry.frame, runs, polygon, pxPerFt,
        fromT: latchT, awayFrom: hingeT, gapMm: SB_MM.fromDoor, scale,
      })
        // LAST RESORT: put it on the wall anyway. Every rung of placeBoard's
        // ladder having failed means the door and its returns fill the wall,
        // which on a real drawing means the wall run was mis-read rather than
        // that the room has nowhere for a switch. A board 300mm from the latch,
        // clamped onto the wall it belongs to, is worth more than a sentence.
        ?? plateAt(
          add(entry.frame.origin, mul(entry.frame.u,
            clamp(latchT + Math.sign(latchT - (hingeT ?? 0) || 1) * px(SB_MM.fromDoor, pxPerFt),
              0, entry.run.length))),
          entry.frame, pxPerFt,
          { wall: { a: entry.run.a, b: entry.run.b, index: entry.run.index },
            t: latchT, clamped: true });
      boards.push({
        ...base, ...placed,
        shortWhy: `${SB_MM.fromDoor}mm past the latch jamb`,
        why: `${SB_MM.fromDoor}mm past the latch jamb, on the side the door opens to`
          + (sides && sides.lead >= o.areaTie
            ? ` — ${Math.round(100 * Math.max(sides.up, sides.down) / sides.total)}%`
              + ' of this space\'s floor is that side of it'
            : confidence === 'double' ? ' — a double door, so the board clears its centre'
            : ' — the floor is even either side, so the leaf parks against the nearer corner')
          + (fellBack ? '. The nearest door box to this space was used.' : ''),
      });
    }
  }

  // --- 2. the bedsides ------------------------------------------------------
  const sconces = accentZones.filter((z) => z.type === 'sconce' && z.group === 'bedside'
    && !z.rejected && z.point && z.inward && z.along);
  if (!sconces.length) {
    notes.push('No bedside sconces have been placed, so there are no boards beside the bed.');
  }
  for (const z of sconces) {
    const base = {
      id: id(), roomId: room.id, role: 'bedside', fromId: z.id,
      serves: 'a bedside sconce', servesShort: 'Bedside',
    };
    if (!scaled) { boards.push({ ...base, rejected: NO_SCALE }); continue; }
    boards.push({
      ...base,
      ...plateAt(z.point, { u: z.along, inward: z.inward, origin: z.point }, pxPerFt,
        { wall: z.wall, t: z.t }),
      shortWhy: `at the sconce ${z.what ?? 'beside the bed'}`,
      why: `at the sconce ${z.what ?? 'beside the bed'}`,
    });
  }

  // --- 3. the TV ------------------------------------------------------------
  const strip = accentZones.find((z) => z.type === 'strip' && z.from === 'tv_unit'
    && !z.rejected && z.wall && z.run?.length === 2);
  if (strip) {
    const base = {
      id: id(), roomId: room.id, role: 'tv', fromId: strip.id,
      serves: 'the television', servesShort: 'TV',
    };
    if (!scaled) {
      boards.push({ ...base, rejected: NO_SCALE });
    } else {
      const run = runs.find((r) => r.indices.includes(strip.wall.index))
        ?? { ...strip.wall, index: strip.wall.index, indices: [strip.wall.index],
             length: len(sub(strip.wall.b, strip.wall.a)) };
      const frame = runFrame(run, polygon, scale);
      // Re-express the strip's own extent on the RUN, which may be longer than
      // the edge its wall came from.
      const p0 = dot(sub(strip.run[0], frame.origin), frame.u);
      const p1 = dot(sub(strip.run[1], frame.origin), frame.u);
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      // Step off whichever end has more wall left, so it clears the TV rather
      // than sliding toward the corner behind it.
      const fromT = lo >= run.length - hi ? lo : hi;
      const placed = placeBoard({
        run, frame, runs, polygon, pxPerFt,
        fromT, awayFrom: fromT === lo ? hi : lo, gapMm: SB_MM.fromTv, scale,
        allowHingeSide: false,
      });
      boards.push(placed
        ? { ...base, ...placed, shortWhy: `${SB_MM.fromTv}mm beyond the TV`,
            why: `${SB_MM.fromTv}mm beyond the end of the TV unit` }
        : { ...base, rejected: 'The TV unit fills its wall, so there is nowhere beside it for a board.' });
    }
  } else if (tvRect) {
    // No strip, but a TV was found by the fallback pass. Place off the box itself.
    const base = {
      id: id(), roomId: room.id, role: 'tv', from: 'tv-pass',
      serves: 'the television', servesShort: 'TV',
    };
    if (!scaled) {
      boards.push({ ...base, rejected: NO_SCALE });
    } else {
      let best = null;
      for (const run of runs) {
        const f = wallFrame(tvRect, run, polygon, scale);
        const d = Math.min(...cornersOf(tvRect).map((p) => distToSegment(p, run.a, run.b)));
        if (!best || d < best.d) best = { run, f, d };
      }
      if (!best || best.d > scale * 0.28) {
        boards.push({ ...base, rejected: 'The TV is out in the middle of the floor, so there is no wall to board.' });
      } else {
        const { run, f } = best;
        const fromT = f.t0 >= run.length - f.t1 ? f.t0 : f.t1;
        const placed = placeBoard({
          run, frame: f, runs, polygon, pxPerFt,
          fromT, awayFrom: fromT === f.t0 ? f.t1 : f.t0, gapMm: SB_MM.fromTv, scale,
          allowHingeSide: false,
        });
        boards.push(placed
          ? { ...base, ...placed, shortWhy: `${SB_MM.fromTv}mm beyond the TV`,
              why: `${SB_MM.fromTv}mm beyond the end of the TV` }
          : { ...base, rejected: 'The TV fills its wall, so there is nowhere beside it for a board.' });
      }
    }
  } else {
    notes.push('No TV was found opposite the bed, so there is no board beside one.');
  }

  return { boards: markClashes(boards, pxPerFt), notes };
}

/**
 * Two plates in the same place, said out loud rather than quietly moved.
 *
 * IT HAPPENS, and it is not a bug in the placement: a door close to the head of
 * the bed puts its board 300mm past the latch and the bed's puts one a foot
 * past the mattress, and on a narrow wall those are the same 230mm of plaster.
 * Both positions are what was asked for.
 *
 * SO NEITHER MOVES. The 300mm and the "exactly where the sconce is" are the
 * rules; a pass that quietly slid one of them to make the drawing tidy would be
 * answering a question nobody asked, and the person reading it would never know
 * the two had ever been in conflict. Ganging them into one plate, moving one
 * along, or dropping one are all real answers — and all three are decisions
 * about the job rather than about the geometry. So the clash is marked, both
 * boards stay, and the drawing shows the problem.
 */
export function markClashes(boards, pxPerFt) {
  if (!(pxPerFt > 0)) return boards;
  const gap = px(SB_MM.along, pxPerFt);
  const live = boards.filter((b) => !b.rejected && b.point);
  const hit = new Map();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.wall?.index !== b.wall?.index) continue;
      if (len(sub(a.point, b.point)) >= gap) continue;
      hit.set(a.id, (hit.get(a.id) ?? []).concat(b.id));
      hit.set(b.id, (hit.get(b.id) ?? []).concat(a.id));
    }
  }
  if (!hit.size) return boards;
  return boards.map((b) => (hit.has(b.id) ? {
    ...b,
    clash: hit.get(b.id),
    poor: b.poor ?? 'this board and the one next to it want the same piece of wall',
  } : b));
}

function cornersOf(r) {
  return [
    { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
  ];
}
