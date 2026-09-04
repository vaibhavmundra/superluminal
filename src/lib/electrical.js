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

import { edges, pointInPolygon, polygonArea, distanceToBoundary } from './geometry.js';
import { projectOntoWall } from './accentPlace.js';
import { openingPx, doorWidthAt, MM_PER_FT } from './doors.js';

/** The board itself, in millimetres. A 4-6 module plate, near enough. */
export const SB_MM = {
  // 300mm from the door's latch jamb to the NEAR edge of the plate.
  fromDoor: 300,
  // A `fromTv` WAS HERE, AND THEN A `fromBed`. The first meant "300mm past the
  // end of the TV unit" and went with the television hunt; the second meant
  // "300mm outboard of the line of the bed's side" and went with an attempt to
  // bracket the bed. The rule steps off nothing now — it lands ON the bed's
  // centreline — so there is no clearance for it to carry. See rule 3.
  along: 230,   // plate width, along the wall
  deep: 80,     // how far it stands off the wall, for the drawing
  // The plate's far edge must still clear the corner by this much, or it is a
  // switch jammed into a return and it does not get built.
  clearEnd: 100,
  /* AND THIS MUCH CLEAR OF ANY JOINERY, measured from the thing's own edge.
     Six inches, which is the number a site would give you: a switch closer than
     that to a wardrobe is behind its shutter when the shutter is open, and on a
     full-height unit it is behind the carcass altogether. The plate is not
     merely ON the wardrobe in that case — it is unreachable, which is a worse
     failure than being in an awkward place, because the drawing still shows a
     switch and the room does not have one.
     BOTH THE FOOTPRINT AND THE MARGIN COME FROM ONE NUMBER, applied as an
     inflation of the rectangle — see `keepOutsFor`. "No plate on the wardrobe"
     and "no plate within six inches of it" are the same statement about one
     rectangle, and writing them as two rules is how they come to disagree. */
  clearFurniture: 150,
};

/**
 * HOW HIGH OFF THE FINISHED FLOOR EACH KIND OF BOARD IS SET, in mm.
 *
 * A LIST PER ROLE AND NOT A NUMBER, because the television wall's board is
 * genuinely two plates at two heights — see FACING_PLATES, which says the same
 * thing about the count. The list's length IS the plate count for that role,
 * and a role whose board is one plate has a list of one.
 *
 * THE NUMBERS, AND WHERE THEY COME FROM:
 *   · 1200 is switch height — the plate a standing person reaches on the way
 *     past, which is what a board beside a door and a board for a bay both are.
 *     They light a piece of ceiling and they are operated from the doorway.
 *   · 700 is bedside height: reachable from the pillow, sitting up, which is
 *     the whole reason that plate exists where it does.
 *   · The television wall gets one of each. The lower plate is the one at the
 *     unit — the socket and its switch, at the height the equipment stands —
 *     and the upper one is at ordinary switch height for whatever is operated
 *     standing in front of it.
 *
 * IT IS A SPECIFICATION AND NOT A DRAWING, and this is a plan view, so nothing
 * on the canvas moves because of it: two plates at one point in plan are one
 * rectangle whether they are 500mm apart in elevation or not. It is here so the
 * schedule can say it, the card can show it, and the rules can ASK — "is this a
 * switch or is it a socket" is a question about height, and the balcony feed is
 * the first rule that will want to.
 */
export const SB_HEIGHT_MM = {
  door: [1200],
  bay: [1200],
  bedside: [700],
  facing: [700, 1200],
};

/* Switch height, in mm — under this a plate is equipment rather than a switch
   somebody flicks. Nothing filters on it yet; it is here so that when something
   does, the threshold is written down once. */
export const SB_SWITCH_MIN_MM = 600;

/**
 * The heights for one board, and the count of plates that implies.
 *
 * AN UNKNOWN ROLE TAKES SWITCH HEIGHT rather than nothing: a plate with no
 * height is a plate the schedule cannot issue, and a role this table has not
 * heard of is a rule somebody added — which will be a switch, because every
 * rule in this file places switches.
 */
export function heightsFor(role) {
  return SB_HEIGHT_MM[role] ?? [1200];
}

/**
 * HOW MANY PLATES THE TELEVISION WALL'S BOARD IS.
 *
 * TWO, STACKED IN ELEVATION — the socket and the switch above it, on the same
 * piece of wall at the same point in plan. It is a count and not a geometry:
 * this drawing is a view from above, so both plates are the one rectangle the
 * canvas draws, and the number exists so that what gets ORDERED is two.
 *
 * IT IS THE HEIGHT LIST'S LENGTH AND NOT A `2`, which is the whole reason the
 * table above comes first. The two facts are one fact — the board is two plates
 * BECAUSE it is a plate at 700 and a plate at 1200 — and while they were two
 * literals it was possible to add a third height and still order two plates.
 */
export const FACING_PLATES = SB_HEIGHT_MM.facing.length;


/** Blue, because the brief said blue and because nothing else on the plan is. */
export const SB_COLOUR = '#2563EB';

/* `SB_LOOSE` WAS HERE — red, for a plate nothing was switched from.
   THE STATE IT MARKED SHOULD NOT EXIST. It was invented for the hand-placed
   board: drop a plate on a wall, it switches nothing, so colour it red until
   somebody wires it. That made "unconfigured" a thing a drawing could show, and
   a drawing that can show an unfinished state will show it — a room of red
   plates is a to-do list on a deliverable.
   WHAT REPLACED IT IS THE THING ITSELF. A plate somebody drops on a wall is a
   SOCKET OUTLET — one socket, no switch — and a socket has never been allowed
   to exist without a switch (see `socketWithSwitch` in switchboards.js). So it
   wires itself, immediately, to the nearest board that can switch it, and that
   board grows the switch. There is no unconfigured second, so there is nothing
   to colour. See `placedBoards` below and section 0 of flows.js. */

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
  // HOW CLOSE THE HEAD OF THE BED HAS TO BE TO A WALL before that wall counts
  // as the headboard wall, in feet. THE SAME 2.0 AS bedGrid.js's `bedHeadGap`,
  // deliberately and not coincidentally: both are answering "is this bed pushed
  // against something", the flanking-lights rule already settled what that
  // number is, and two different answers to one question would mean a bed with
  // a headboard wall for the lights and none for the switches.
  bedHeadGapFt: 2.0,
  /* --- THE OUTDOOR SPACES' OWN THREE NUMBERS, all read by `innerSpaceFor`.
     HOW FAR TO STEP ACROSS A WALL to see whose room is behind it, in feet. A
     foot and a half clears a 230mm wall with its plaster and its skirting and
     stops well short of the far side of any corridor, which is the whole
     discrimination this number has to make: "the room on the other side of this
     wall" and not "the next room along". */
  outdoorReachFt: 1.5,
  /* WHAT COUNTS AS A LONG SIDE, as a fraction of the balcony's longest edge.
     Half takes both edges of a balcony that steps round a corner and still
     refuses its ends — which is the point of the rule, since a balcony's end
     touching a corridor is a neighbour by geometry and not by use. */
  outdoorLongFrac: 0.5,
  /* How many probes along each long side. Nine is enough to tell a wall a room
     stands fully behind from a corner it clips, and the answer is a weighted
     share rather than a yes, so a sample or two either way moves nothing. */
  outdoorSamples: 9,
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

// --- the room an outdoor space is switched from ------------------------------

/**
 * WHICH SPACE A BALCONY OPENS OFF, decided by its LONG SIDE.
 *
 * THE RULE, IN THE WORDS IT ARRIVED IN: the light connection for a balcony or a
 * terrace goes in the space its long side is connected to, and inside that
 * space it goes on the board nearest the balcony. The switch for the outside
 * belongs inside, because nobody steps out into the rain to turn it on and a
 * plate on an external wall is a detail that does not get built.
 *
 * WHY THE LONG SIDE AND NOT SIMPLY "THE NEAREST ROOM". A balcony is long and
 * narrow, and its two ends very often touch something — the next balcony along,
 * a shaft, a corridor that runs past it. Those are neighbours by geometry and
 * not by use: the room the balcony BELONGS to is the one behind its length,
 * which is where its door and its window are. So an edge's vote is worth its
 * own length, and only edges that are recognisably long sides get to vote at
 * all.
 *
 * IT PROBES RATHER THAN LOOKING FOR SHARED EDGES. Two rooms traced off a plan
 * do not share a polygon edge: they are the two inner faces of one wall, so
 * there is nine inches of nothing between them, and their edges are neither
 * collinear nor equal. Stepping across that gap perpendicular to the edge and
 * asking which polygon the far point is in is the only test that works on real
 * traced geometry — and it costs one point-in-polygon per sample.
 *
 * `reachFt` IS HOW THICK A WALL IS ALLOWED TO BE. A foot and a half clears a
 * 230mm wall with its finishes and does not reach across a corridor into the
 * room beyond, which is exactly the discrimination wanted. Without a scale it
 * falls back to a fraction of the room's own size, like everything else here.
 *
 * Returns `{ roomId, share, edge }` — `share` being how much of the long side
 * that room stands behind, in plan pixels, so a caller can tell a wall it is
 * fully behind from a corner it merely clips.
 */
export function innerSpaceFor({ room, rooms = [], pxPerFt = null, opts = {} } = {}) {
  const o = { ...ELEC_DEFAULTS, ...opts };
  const poly = room?.polygonPx ?? [];
  const others = rooms.filter((r) => r.id !== room?.id && (r.polygonPx?.length ?? 0) >= 3);
  if (poly.length < 3 || !others.length) return null;

  const scale = roomScale(poly);
  const reach = pxPerFt > 0 ? o.outdoorReachFt * pxPerFt : scale * 0.15;
  const es = edges(poly).map(([a, b]) => ({ a, b, length: len(sub(b, a)) }));
  const longest = es.reduce((m, e) => Math.max(m, e.length), 0);
  if (!(longest > 0)) return null;
  // THE LONG SIDES, PLURAL AND NOT "THE LONGEST". A balcony that steps round a
  // corner has two edges behind the building and neither is the longer by much;
  // half the longest takes both and still refuses the ends.
  const sides = es.filter((e) => e.length >= o.outdoorLongFrac * longest);

  // Two maps rather than one with prefixed keys: how much of a long side a room
  // stands behind, and which side that was.
  const share = new Map();
  const sideOf = new Map();
  for (const e of sides) {
    const u = mul(sub(e.b, e.a), 1 / e.length);
    const n = { x: -u.y, y: u.x };
    // WHICH WAY IS OUT, asked of the polygon rather than assumed from the
    // winding. `wallRuns` and the placers do the same thing for the same
    // reason: a traced outline can be wound either way.
    const mid = add(e.a, mul(u, e.length / 2));
    const out = pointInPolygon(add(mid, mul(n, Math.max(1, reach * 0.05))), poly)
      ? { x: -n.x, y: -n.y } : n;
    // Samples inside the edge's own span, so a probe at a corner cannot vote
    // for the room round the corner.
    const N = Math.max(3, o.outdoorSamples);
    for (let i = 0; i < N; i++) {
      const t = ((i + 0.5) / N) * e.length;
      const p = add(add(e.a, mul(u, t)), mul(out, reach));
      const hit = others.find((r) => pointInPolygon(p, r.polygonPx));
      if (!hit) continue;
      const w = e.length / N;
      share.set(hit.id, (share.get(hit.id) ?? 0) + w);
      if (!sideOf.has(hit.id)) sideOf.set(hit.id, e);
    }
  }

  let best = null;
  for (const [roomId, v] of share) {
    if (!best || v > best.share) best = { roomId, share: v, edge: sideOf.get(roomId) };
  }
  return best;
}

/**
 * THE BOARD NEAREST A GIVEN SPACE, out of the ones offered.
 *
 * Distance from the plate to the space's own boundary, not to its centre: what
 * "nearest the balcony" means to somebody standing at the door is how far along
 * the wall they have to reach, and a plate beside the balcony door in a long
 * living room is nearer the balcony than one in the middle of that room even
 * though the centres say otherwise.
 *
 * `rulePoint` FIRST, for the reason `boardFor` in flows.js gives at greater
 * length: a plate can be dragged by hand, and that is a decision about where
 * the switch is reachable from rather than about what it switches. The wire
 * still runs to where the plate now is.
 */
export function nearestBoardTo(boards = [], polygonPx = []) {
  const live = boards.filter((b) => !b.rejected && b.point);
  if (!live.length || polygonPx.length < 3) return null;
  const at = (b) => distanceToBoundary(b.rulePoint ?? b.point, polygonPx);
  return live.reduce((a, b) => (at(b) < at(a) ? b : a));
}

// --- where a plate may not stand ---------------------------------------------

/** Do two axis-aligned rectangles share any area? */
function rectsOverlap(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * JOINERY -> THE PIECES OF WALL A PLATE MAY NOT STAND ON, in plan pixels.
 *
 * One rectangle in, one rectangle out, grown by `clearFurniture` on every side.
 * ON EVERY SIDE AND NOT ONLY ALONG THE WALL, which is worth saying because the
 * rule is usually described as "six inches either side". A wardrobe is drawn as
 * a footprint, its ends are where the shutters are, and its face is what a hand
 * meets — so the margin is wanted in every direction the plate could approach
 * from, and inflating the rectangle says that in one line instead of resolving
 * which axis is "along" for a piece of furniture whose wall we have not been
 * told.
 *
 * IT IS A GEOMETRIC TEST AND NOT A WALL ASSIGNMENT. The alternative — work out
 * which run the wardrobe is against, project it onto that run, and block an
 * interval — is more code and is wrong more often: a unit in a corner belongs
 * to two runs, and a projection onto the far wall of a narrow room blocks a
 * wall the wardrobe is nowhere near. A plate is a small rectangle standing on
 * its own wall; asking whether it overlaps this one answers the question for
 * every wall at once.
 *
 * Empty in, empty out — and with no scale there is no six inches to measure, so
 * the rectangles are used as they arrived rather than silently unmargined.
 */
export function keepOutsFor(rects = [], pxPerFt) {
  if (!rects.length) return [];
  const m = pxPerFt > 0 ? px(SB_MM.clearFurniture, pxPerFt) : 0;
  return rects
    .filter((r) => r && Number.isFinite(r.x0) && Number.isFinite(r.y1))
    .map((r) => ({ x0: Math.min(r.x0, r.x1) - m, y0: Math.min(r.y0, r.y1) - m,
                   x1: Math.max(r.x0, r.x1) + m, y1: Math.max(r.y0, r.y1) + m }));
}

/** Would this plate stand on something it has to keep off? */
function blocked(plate, keeps) {
  return !!plate && keeps.some((k) => rectsOverlap(plate.rect, k));
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
 * HOW MUCH WALL A PLATE NEEDS EITHER SIDE OF ITS CENTRE, in plan pixels.
 *
 * Half the plate plus the clearance its far edge must keep from a corner. The
 * two are always spent together — every position in this file is "can the plate
 * stand here without hanging into a return" — so they are added once here
 * rather than at each of the four places that used to.
 */
export function plateKeep(pxPerFt) {
  return px(SB_MM.along, pxPerFt) / 2 + px(SB_MM.clearEnd, pxPerFt);
}

/**
 * THE ROOM'S WALLS AS ONE CLOSED PATH, each run with its start distance.
 *
 * This is the coordinate a hand-moved board lives in. The alternative — a run
 * index and a distance along it — looked simpler and is not: `wallRuns` picks
 * its own starting corner and merges near-collinear edges, so an index is a
 * property of one particular reading of one particular polygon, and correcting
 * a traced corner silently renumbers every board on the plan. Arc length from
 * the same starting corner moves by the length of the wall that changed and no
 * more.
 *
 * IT IS A LOOP, and `plateAtS` treats it as one: the walls of a room close, so
 * dragging a plate off the end of the last wall puts it on the first.
 */
export function wallPath(runs = []) {
  let s = 0;
  const segs = [];
  for (const run of runs) { segs.push({ run, s0: s, length: run.length }); s += run.length; }
  return { segs, total: s };
}

/** Can this run take a plate at all? */
const holdsPlate = (seg, keep) => seg.length >= keep * 2;

/**
 * A DISTANCE ROUND THE WALLS -> A PLATE, ON WHICHEVER WALL CARRIES IT.
 *
 * THE PLATE TURNS BECAUSE THE FRAME DOES. Nothing here rotates anything: the
 * position picks a run, the run's own frame says which way is along it and which
 * way is into the room, and `plateAt` builds the rectangle in that frame. So a
 * board dragged past a corner comes out lying on the next wall, facing into the
 * room, because that is what its new wall's frame means — the same frame the
 * rules place every other board in.
 *
 * CLAMPED WITHIN THE RUN IT LANDS ON. A plate cannot straddle a corner, so the
 * last `keep` of every wall is not a position — drag through a corner and the
 * plate steps from one wall's clearance to the next one's rather than passing
 * smoothly through a place it could not be built. A run too short to hold a
 * plate is skipped entirely; the search walks forward to one that can, which is
 * what keeps a stored position usable after somebody re-traces the outline and
 * turns the wall it was on into a stub.
 */
export function plateAtS(sPx, runs, polygon, pxPerFt, scale, extra = {}) {
  const { segs, total } = wallPath(runs);
  if (!(total > 0) || !(pxPerFt > 0)) return null;
  const keep = plateKeep(pxPerFt);
  const usable = segs.filter((g) => holdsPlate(g, keep));
  if (!usable.length) return null;

  const sw = ((sPx % total) + total) % total;
  // The run this distance falls in, or — where that run cannot hold a plate —
  // the next one round the loop that can.
  const at = segs.find((g) => sw >= g.s0 && sw < g.s0 + g.length) ?? segs[segs.length - 1];
  const seg = holdsPlate(at, keep)
    ? at
    : (usable.find((g) => g.s0 > at.s0) ?? usable[0]);

  const f = runFrame(seg.run, polygon, scale);
  const t = clamp(sw - seg.s0, keep, seg.length - keep);
  return plateAt(add(f.origin, mul(f.u, t)), f, pxPerFt, {
    wall: { a: seg.run.a, b: seg.run.b, index: seg.run.index }, t, ...extra,
  });
}

/**
 * A POINTER -> HOW FAR ROUND THE WALLS THAT IS, in FEET.
 *
 * The whole of the drag gesture, and the one thing App.jsx calls: it does its
 * own `wallRuns`, so nothing outside this file has to know that a "wall" here is
 * a merged run of near-collinear edges rather than a polygon edge.
 *
 * FEET AND NOT PIXELS, because the answer is stored. Plan pixels are the outline
 * times the scale, so a board saved in pixels moves the day somebody corrects a
 * door width — see `runTrims`, which is stored in feet for the same reason.
 *
 * FREE ALONG THE WALLS AND NOWHERE ELSE. The pointer is projected onto every
 * wall that can hold a plate and the nearest wins, so the gesture is "which
 * piece of plaster do you mean" rather than "drag this rectangle wherever" — a
 * switchboard off its wall is not a thing, and a board floating in the middle of
 * a room is a mark nobody could build from.
 */
export function nearestSeat(p, { polygonPx = [], pxPerFt = 0, opts = {} } = {}) {
  if (!p || polygonPx.length < 3 || !(pxPerFt > 0)) return null;
  const o = { ...ELEC_DEFAULTS, ...opts };
  const runs = wallRuns(polygonPx, o);
  const scale = roomScale(polygonPx);
  const keep = plateKeep(pxPerFt);
  const { segs } = wallPath(runs);

  let best = null;
  for (const seg of segs) {
    if (!holdsPlate(seg, keep)) continue;
    const f = runFrame(seg.run, polygonPx, scale);
    const t = clamp(dot(sub(p, f.origin), f.u), keep, seg.length - keep);
    const at = add(f.origin, mul(f.u, t));
    const d = len(sub(p, at));
    if (!best || d < best.d) best = { d, at, sFt: (seg.s0 + t) / pxPerFt };
  }
  return best;
}

/**
 * ...AND THE ONE NUMBER A DRAG NEEDS. `slideBoardTo` is what App.jsx has always
 * called and it still means the same thing; the distance came out of it because
 * PLACING a board asks a question dragging one never has to — which of several
 * rooms did that click mean. A drag already knows its room.
 */
export function slideBoardTo(p, opts = {}) {
  return nearestSeat(p, opts)?.sFt ?? null;
}

/**
 * SOCKET OUTLETS — the one plate that is allowed to have no switch on it.
 *
 * THE EXCEPTION, AND WHY IT IS THE ONLY ONE. Every socket needs a switch; that
 * is a rule about wiring and switchboards.js enforces it in one place. What the
 * rule does NOT say is that the switch has to be on the same plate — and the
 * commonest thing in any real room is exactly that: a socket on a wall,
 * controlled from a board by the door. So an outlet on its own is not an
 * unfinished switchboard, it is a complete and ordinary fitting whose switch
 * lives somewhere else.
 *
 * WHICH MAKES IT A WALL FIXTURE AND NOT A BOARD. It behaves like a sconce: it is
 * placed where it is wanted, it wires itself to the nearest plate that can carry
 * it, and the wire can be dragged onto a different plate afterwards — at which
 * point the switch moves with it, because the switch is a MODULE that exists
 * because the flow lands there. See section 0 of flows.js for the flow, and
 * `pointsFromFlows` in switchboards.js for the module.
 *
 * A SEAT IS `{ id, roomId, sFt, amps }` — how far round this room's walls it
 * sits, in feet, and what it is rated at. Same coordinate as `boardMoves`, for
 * the same two reasons: a run index renumbers when a corner is re-traced and a
 * pixel moves when the scale is corrected. Everything else is derived here on
 * every render, exactly as a rule's board is.
 *
 * `socketOnly` IS WHAT THE REST OF THE APP READS. It is not in `boardPool`, so
 * no wire can be dragged onto it — a light cannot be switched from a socket —
 * and `servesBay` is false for its role, so no ceiling can fall back to it.
 */
export function placedBoards(seats = [], { polygonPx = [], pxPerFt = 0, opts = {} } = {}) {
  if (!seats.length || polygonPx.length < 3 || !(pxPerFt > 0)) return [];
  const o = { ...ELEC_DEFAULTS, pxPerFt, ...opts };
  const runs = wallRuns(polygonPx, o);
  const scale = roomScale(polygonPx);
  const out = [];
  for (const seat of seats) {
    const plate = plateAtS(seat.sFt * pxPerFt, runs, polygonPx, pxPerFt, scale);
    if (!plate) continue;
    out.push({
      id: seat.id,
      roomId: seat.roomId,
      role: 'placed',
      placed: true,
      serves: 'whatever is wired to it',
      servesShort: 'Board',
      why: 'Placed by hand on this wall.',
      heightsMm: SB_HEIGHT_MM.door,
      plates: 1,
      sFt: seat.sFt,
      ...plate,
    });
  }
  return out;
}

/**
 * THE SAME PLATE, AS A SOCKET OUTLET — one socket, no switch.
 *
 * A TRANSFORM AND NOT A KIND, WHICH IS THE POINT. Outlet and switchboard are two
 * states of ONE object and a person moves a plate between them: one press makes
 * a board a socket switched from somewhere else, and adding any point to a
 * socket makes it a board again. Building them as two different things — one
 * produced by `placedBoards`, the other by the rules — would mean a conversion
 * had to construct the other from scratch and get every field right, which is
 * how the two drift.
 *
 * SO EVERY PLATE ON THE DRAWING CAN BE ONE, including a board a RULE placed. The
 * geometry is unchanged: it is the same rectangle on the same piece of wall, and
 * what changes is what is on it, what it is called, how high it is set and —
 * the load-bearing part — that nothing can be switched from it any more. See
 * DEDICATED_ROLES: `servesBay` is false for `socket`, so a ceiling that used to
 * fall back to this plate falls back to the next one instead, by itself.
 *
 * `amps` IS THE SOCKET'S RATING and it travels into the flow, which is how the
 * switch on the far board gets built to match. See section 0 of flows.js.
 */
export function asOutlet(b, amps = null) {
  if (!b) return b;
  return {
    ...b,
    role: 'socket',
    socketOnly: true,
    amps,
    serves: 'a socket outlet',
    servesShort: 'Socket',
    why: 'A socket on this wall, switched from another board.',
    // SOCKET HEIGHT AND NOT SWITCH HEIGHT. 300mm is a general-purpose outlet
    // above skirting; the plate by the door is at 1200 because a hand reaches it
    // on the way past, and an outlet is not operated at all.
    heightsMm: [300],
    plates: 1,
  };
}

/**
 * The board as it is DRAWN, which is not always where the rule put it.
 *
 * A moved board keeps the rule's own geometry — see `moves` in planSwitchboards
 * for why — and carries where somebody dragged it to under `hand`. Everything
 * that draws or routes goes through this; everything that DECIDES (which bay
 * adopts which plate) deliberately does not.
 */
export function asDrawn(b) {
  return b?.hand ? { ...b, ...b.hand } : b;
}

/**
 * WHICH PLATE IS UNDER THIS POINT — the drop test for a wire dragged onto a
 * switchboard.
 *
 * IN THE PLATE'S OWN FRAME, and not against an axis-aligned bounding box. A
 * board is 230 x 80mm standing on a wall at whatever angle that wall runs, so
 * its bounding box on a diagonal wall is nearly twice its area and would claim
 * drops that visibly missed it. The plate already carries its own axes — see
 * `plateAt` — so the test is two dot products.
 *
 * A GENEROUS SLOP, DELIBERATELY. The target is 230mm long and 80mm deep, which
 * at a normal zoom is a rectangle a few pixels tall; asking somebody to land a
 * pointer inside it is asking them to miss. The slop is a fraction of a foot in
 * plan pixels rather than a pixel count, so it scales with the drawing.
 *
 * THE DEEPEST HIT WINS, which matters exactly where two plates clash — see
 * `markClashes`. Two boards at one spot are drawn on top of each other, and a
 * drop between them has to pick one; picking the one whose middle the pointer is
 * nearest is the only answer that responds to aiming.
 */
export function boardUnder(p, boards = [], { pxPerFt = 0, slopFt = 0.5 } = {}) {
  if (!p) return null;
  const slop = Math.max(4, slopFt * (pxPerFt || 0));
  let best = null, bestScore = Infinity;
  for (const b of boards) {
    if (!b?.point || !b.along || !b.inward) continue;
    const rel = sub(p, b.point);
    const a = dot(rel, b.along);
    const d = dot(rel, b.inward);
    const half = (b.alongPx ?? 0) / 2, deep = b.deepPx ?? 0;
    // How far outside the rectangle the point is, on each axis. Zero inside.
    const outA = Math.max(0, Math.abs(a) - half);
    const outD = Math.max(0, d < 0 ? -d : d - deep);
    if (outA > slop || outD > slop) continue;
    // Inside, prefer the plate whose centre the pointer is nearest; outside,
    // prefer the near miss. One score does both.
    const score = outA + outD + (Math.abs(a) + Math.abs(d - deep / 2)) * 1e-3;
    if (score < bestScore) { best = b; bestScore = score; }
  }
  return best;
}

/**
 * A LIST OF BOARDS, WITH THE ONES SOMEBODY DRAGGED CARRYING WHERE THEY DRAGGED
 * THEM TO.
 *
 * OVER THE FINISHED RULES AND NEVER INSTEAD OF THEM, and that ordering is the
 * whole design. Every rule has already run and already said why it put a plate
 * where it did; this adds a SECOND position to one board and marks which is
 * which. It does not interfere with any rule, and a board's role, what it
 * serves, how many plates it is and which fittings loop back to it are all
 * untouched — moving a plate along the plaster is a decision about where the
 * switch is reachable from, not about what it switches.
 *
 * THE RULE'S GEOMETRY IS KEPT, under the board's own keys, and the hand's goes
 * in `hand`. Two reasons, and the second is the load-bearing one:
 *   · the card can say what the rule wanted AND that somebody overrode it,
 *     rather than silently presenting a dragged position as a derivation; and
 *   · the pass that decides which bay adopts which plate reads the RULE
 *     position, so dragging a board does not re-cut the switching of the room
 *     underneath it. See `asDrawn` and the note on `ruleBoardsFor` in App.jsx.
 *
 * A REFUSED BOARD IS NOT MOVABLE. It has no position to override — the same
 * argument accentPlace's `slideSconceTo` makes — and letting a drag give it one
 * would resurrect a plate the rules declined to place, with none of the checks
 * that would have applied.
 *
 * SHARED BY BOTH PASSES. The rules place a board beside a door and a bed; the
 * chunk pass places one per piece of ceiling. Both draw plates on the same
 * drawing, so both have to answer to the same drag, and two copies of this
 * would be two chances to disagree about what a stored position means.
 */
export function applyMoves(boards = [], { moves, runs, polygon, pxPerFt, scale } = {}) {
  if (!moves || !boards.length) return boards;
  return boards.map((b) => {
    const sFt = moves[b.id];
    if (!Number.isFinite(sFt) || b.rejected || !b.point) return b;
    const hand = plateAtS(sFt * pxPerFt, runs, polygon, pxPerFt, scale);
    if (!hand) return b;
    return {
      ...b, hand, moved: true,
      /* WHERE THE RULE PUT IT, AS A POINT, and it is not the same claim as the
         geometry above it. `asDrawn` overwrites `point` with the hand's, so a
         pass reading a drawn board has no way back to the rule position — and
         one of them needs it: flows.js falls back to "the nearest general
         board" for a bay that adopted none, and that choice must not flip
         because somebody dragged a plate nearer. It reads `rulePoint`. */
      rulePoint: b.point,
      // THE RULE'S SENTENCE IS NOT THROWN AWAY, it is demoted. "Moved by hand"
      // on its own would leave somebody looking at a plate on the wrong wall
      // with no way to find out where it was supposed to be.
      shortWhy: 'moved by hand',
      why: `moved onto this wall by hand — the rule put it ${b.shortWhy || b.why || 'elsewhere'}`,
    };
  });
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
  /* THE RECTANGLES THIS PLATE MAY NOT STAND ON, already inflated by whatever
     margin they carry — see `keepOutsFor`. Empty by default, so a caller that
     knows of no joinery gets exactly the ladder this function had before. */
  keepOff = [],
}) {
  const gap = px(gapMm, pxPerFt);
  const along = px(SB_MM.along, pxPerFt);
  const need = gap + along + px(SB_MM.clearEnd, pxPerFt);
  const dir = awayFrom == null
    ? (fromT <= run.length / 2 ? 1 : -1)
    : Math.sign(fromT - awayFrom) || 1;

  /**
   * A PLATE AT `t` ON THIS RUN, AND IF THAT IS BLOCKED, THE FIRST CLEAR ONE
   * PAST IT — which is what a person does on site. A switch that lands on the
   * wardrobe does not become no switch; it becomes the same switch a foot
   * further along, on the plaster beside it.
   *
   * A WALK RATHER THAN A PROJECTION, in half-plate steps. What has to be true
   * is that the PLATE's own rectangle is clear, and the plate is built by
   * `plateAt` from a frame — so the honest test is to build it and look. The
   * step is half a plate because a smaller one only asks the same question
   * twice, and the walk is bounded by the wall's own usable length.
   *
   * IT STOPS AT THE CLEARANCE, NOT AT THE CORNER: `keep` is the same half-plate
   * plus corner clearance every other position in this file respects, so a
   * board slid past a wardrobe can never end up jammed into a return.
   */
  const walk = (f, r, t0, d, extra) => {
    const make = (t, more) => plateAt(add(f.origin, mul(f.u, t)), f, pxPerFt,
      { wall: { a: r.a, b: r.b, index: r.index }, t, ...extra, ...more });
    /* THE RULE'S OWN POSITION FIRST, UNTOUCHED. With nothing to keep off — the
       ordinary case, and every case before this parameter existed — this
       returns exactly what the rung used to return, at exactly the `t` the rule
       asked for. The clearance bounds below apply to the SEARCH and not to the
       answer, so a plate the rules put close to a corner stays where they put
       it rather than being quietly nudged by a function that was only asked
       about joinery. */
    const first = make(t0);
    if (!blocked(first, keepOff)) return first;

    const keep = plateKeep(pxPerFt);
    const lo = keep;
    const hi = r.length - keep;
    if (!(hi >= lo)) return null;
    const step = Math.max(along / 2, 1e-6);
    const moved = 'It was moved along the wall to clear the joinery.';
    for (let t = t0 + d * step; t >= lo && t <= hi; t += d * step) {
      const cand = make(t, {
        slid: true,
        note: extra?.note ? `${extra.note} ${moved}` : moved,
      });
      if (!blocked(cand, keepOff)) return cand;
    }
    return null;
  };

  /**
   * THE OTHER SIDE OF THE DOOR, PAST THE OPEN LEAF.
   *
   * `awayFrom` is the hinge jamb and `fromT` the latch jamb, so the distance
   * between them is the OPENING — which, on a single door, is the width of the
   * shutter that swings back along this wall. A board 300mm the other side of
   * the hinge is therefore behind that shutter whenever the door is open, which
   * is most of the time somebody is walking through it reaching for a switch.
   * Clearing the leaf and THEN the same 300mm puts it on plaster the door can
   * never cover.
   *
   * A DOUBLE DOOR MEASURES GENEROUS, and deliberately: each of its leaves is
   * about half the opening, so this clears both of them and a little more. The
   * error is in the direction of a switch that is definitely reachable.
   *
   * NOT A CLAMP AND NOT A GUESS: if the wall does not have leaf + 300mm + a
   * plate + its corner clearance, this rung declines like every other one and
   * the ladder goes on.
   */
  const pastSwing = () => {
    if (!allowHingeSide || awayFrom == null) return null;
    const leaf = Math.abs(fromT - awayFrom);
    const clear = leaf + gap;
    if (!roomOnRun(run, awayFrom, -dir, clear + along + px(SB_MM.clearEnd, pxPerFt))) return null;
    return walk(frame, run, awayFrom - dir * (clear + along / 2), -dir, {
      turnedCorner: false, pastSwing: true,
      note: 'It stands past the open leaf, on the hinge side.',
    });
  };

  /* WAS THERE ROOM ON THE LATCH SIDE AT ALL? The two ways this rung fails want
     two different second choices, and telling them apart is the whole of why
     this is a variable rather than an `if`.
       THE WALL RAN OUT — there is no plaster past the latch — and the answer is
       the one a person gives on site: round the corner, which is where that
       wall's plaster continues.
       THE WALL IS THERE AND SOMETHING IS ON IT — a wardrobe — and the corner is
       the wrong answer, because the corner may be six metres away down a wall
       that is perfectly good everywhere except beside the door. The other side
       of the same door is a step away and is the switch anybody would expect to
       find. So joinery sends the board across the opening first, and only tries
       the corner if that side is no good either. */
  const hadLatchSide = roomOnRun(run, fromT, dir, need);
  if (hadLatchSide) {
    const t = fromT + dir * (gap + along / 2);
    const at = walk(frame, run, t, dir, { turnedCorner: false });
    if (at) return at;
    const across = pastSwing();
    if (across) return across;
  }

  const tol = Math.max(1e-6, (scale ?? run.length) * 1e-3);
  const next = adjacentRun(runs, run, dir, tol);
  if (next && next.run.length >= need) {
    const f2 = runFrame(next.run, polygon, scale);
    const t = next.from === 0 ? gap + along / 2 : next.run.length - (gap + along / 2);
    const at = walk(f2, next.run, t, next.from === 0 ? 1 : -1, {
      turnedCorner: true,
      note: 'The wall runs out before the board does, so it turns the corner.',
    });
    if (at) return at;
  }

  // ...and for the wall-ran-out case, the hinge side comes after the corner
  // rather than before it. Same position, second in the order.
  if (!hadLatchSide) {
    const across = pastSwing();
    if (across) return across;
  }

  /* BEHIND THE OPEN LEAF, AND IT IS THE LAST RUNG FOR A REASON. Everything
     above has failed, which means this wall cannot give leaf + 300mm on the
     hinge side either — so the choice left is a switch the door covers or no
     switch at all, and a covered switch is one a person can still reach by
     closing the door behind them. It says what it is: `poor` puts the sentence
     on the plate's own card, which is where somebody deciding whether to accept
     it is looking. */
  if (allowHingeSide && awayFrom != null && roomOnRun(run, awayFrom, -dir, need)) {
    const t = awayFrom - dir * (gap + along / 2);
    const at = walk(frame, run, t, -dir, { turnedCorner: false, poor: 'behind the open leaf' });
    if (at) return at;
  }
  return null;
}

// --- the pass ----------------------------------------------------------------

const NO_SCALE = 'There is no scale on this drawing yet, so 300mm is not a'
  + ' distance it can measure. Pick a door and give it a width first.';

/**
 * WHICH END OF THE BED THE HEADBOARD IS AT, from the box and the room's bounds.
 *
 * bedGrid.js's `footGeometry` answers the same question and cannot be borrowed:
 * it needs the CHUNKS, because what it is really after is the region beyond the
 * foot and which pieces of ceiling cover it. This needs only the direction, so
 * it is the first half of that function and nothing else — the four gaps
 * between the bed and the room's bounding box, smallest wins, because a
 * headboard is not put in the middle of a room.
 *
 * The bounding box rather than the outline, for the reason given there: an
 * L-shaped bedroom's far wall in a given direction is not one edge, and the box
 * only has to say which side the bed is pushed against.
 *
 * Null when the answer would be a guess — no bed, or a bed adrift on the floor.
 */
export function headSide(bed, polygon, opts = {}) {
  const o = { ...ELEC_DEFAULTS, ...opts };
  if (!bed || polygon.length < 3) return null;
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs),
                minY: Math.min(...ys), maxY: Math.max(...ys) };
  // `axis` is the head-to-foot axis; `dir` points from the head toward the
  // foot, which is the direction the facing wall lies in.
  const sides = [
    { axis: 'x', dir: +1, gap: bed.x0 - box.minX },
    { axis: 'x', dir: -1, gap: box.maxX - bed.x1 },
    { axis: 'y', dir: +1, gap: bed.y0 - box.minY },
    { axis: 'y', dir: -1, gap: box.maxY - bed.y1 },
  ];
  const head = sides.reduce((a, b) => (b.gap < a.gap ? b : a));
  const limit = o.pxPerFt > 0 ? o.bedHeadGapFt * o.pxPerFt
    : o.bedHeadGapFt * (roomScale(polygon) / 10);
  if (head.gap > limit) return null;
  return head;
}

/**
 * THE WALL IN FRONT OF THE BED — the first run a ray from the foot crosses.
 *
 * A RAY AND NOT "THE OPPOSITE EDGE OF THE BOX", because on anything but a plain
 * rectangle those are different walls. Starting inside the room and going out,
 * the first wall the ray meets IS the one somebody standing at the foot of the
 * bed is looking at, whatever shape the room is; the box's far side is a
 * coordinate, and in an L it can be a wall in another part of the room.
 */
export function facingWall(bed, head, runs, polygon) {
  const c = centreOf(bed);
  const from = head.axis === 'x'
    ? { x: head.dir > 0 ? bed.x1 : bed.x0, y: c.y }
    : { x: c.x, y: head.dir > 0 ? bed.y1 : bed.y0 };
  const d = head.axis === 'x' ? { x: head.dir, y: 0 } : { x: 0, y: head.dir };

  let best = null;
  for (const run of runs) {
    // Ray (from + t*d) against segment (a + s*(b-a)), solved for both.
    const e = sub(run.b, run.a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;             // parallel: no crossing
    const w = sub(run.a, from);
    const t = (w.x * e.y - w.y * e.x) / den;
    const sAlong = (w.x * d.y - w.y * d.x) / den;
    if (t <= 1e-9 || sAlong < -1e-9 || sAlong > 1 + 1e-9) continue;
    if (!best || t < best.t) best = { run, t, hit: add(from, mul(d, t)) };
  }
  return best;
}

/**
 * One bedroom in, its switchboards out.
 *
 * Three rules, and every one of them reads something the drawing already knows:
 *
 *   1. the entry door        -> one board, 300mm past its latch jamb
 *   2. the bedside sconces   -> one board at each, on the sconce's own wall
 *   3. the wall facing the bed -> TWO boards, 300mm outboard of the bed's sides
 *
 * RULE 3 REPLACED A TELEVISION HUNT, and the reason is worth keeping. It used to
 * take the strip along the TV unit, or — when the accent pass had not found a
 * `tv_unit`, which was most of the time, because a console is often simply not
 * drawn — a vision call of its own asking whether there was a television on the
 * wall opposite the bed. Two model calls deep to answer a question whose answer
 * is "yes, put the plates there" in every bedroom anybody builds.
 *
 * SO IT IS TAKEN AS A GIVEN INSTEAD. The wall facing the bed gets two plates
 * whether or not a television was drawn on it, and somebody who does not want
 * them deletes one. That trade is the right way round: a plate nobody wanted is
 * one click to remove, and a plate that was never placed because a console was
 * not on the drawing is a missing switch nobody notices until site.
 *
 * Rule 2 still takes the ALREADY-PLACED fitting rather than re-deriving one
 * from the furniture box: a sconce is where accentPlace put it, including any
 * hand slide, and recomputing it would put a board on a wall the fitting it
 * feeds is not on. Rule 3 works off the BED BOX, which is the upload-time
 * furniture detection and costs nothing.
 */
export function planSwitchboards({
  room,
  rooms = [],
  doors = [],
  roomTypes = {},
  accentZones = [],
  /* THE BED, AS ONE BOX IN PLAN PIXELS. The upload-time furniture detection's
     answer for this room, picked by the caller — see `bedZoneIn` in bedGrid.js
     for how the largest of several is chosen. Rule 3 needs nothing else, and
     in particular needs no model call.
     A BOX AND NOT A ZONE LIST, unlike `doors` next door, which arrives whole
     and is assigned to rooms in here. The difference is that door assignment is
     genuinely hard — a door is IN a wall, so it belongs to two rooms and
     `assignDoors` exists to arbitrate — while a bed is standing in exactly one
     room and the caller already knows which. */
  bedRect = null,
  /* JOINERY THIS ROOM'S PLATES MUST KEEP OFF, as rectangles in plan pixels —
     today that is the wardrobes the accent pass found, handed in by the caller
     the way `bedRect` is. RAW RECTANGLES, NOT INFLATED ONES: the six inches of
     clear plaster either side is this file's rule, not the caller's, so the
     margin is applied in here (see `keepOutsFor`) and a second caller cannot
     arrive with a different idea of how much clearance a wardrobe wants.
     WHY A WARDROBE AT ALL. A switch plate on a wardrobe wall is not merely
     awkward: a full-height unit puts the plate behind the carcass, and an open
     shutter puts it behind the door. Either way the drawing shows a switch the
     room does not have — and unlike a plate near a corner, nobody notices on
     the sheet, because the wardrobe is not drawn on OUR drawing at all. */
  keepOff = [],
  pxPerFt = null,
  /* WHERE SOMEBODY DRAGGED A BOARD TO: board id -> distance round this room's
     walls, in feet. See `slideBoardTo` for the coordinate and why it is feet.

     A HAND OVERRIDE ON A DERIVED FITTING, which is a shape this app already has
     three of — `runTrims`, `accentDismissed`, `manualCoves`. The rules still run
     and still produce every board with its own reasoning; a move replaces the
     POSITION of one of them and nothing else. Its role, what it serves, how many
     plates it is and which fittings loop back to it are all untouched, which is
     the point: moving a plate along the plaster is a decision about where the
     switch is reachable from, not about what it switches. */
  moves = {},
  // WHICH OF THE THREE RULES TO RUN, and it exists because they do not all read
  // the same things. Door and facing want the door boxes and the bed box, both
  // found on arrival — no network, nothing to wait for. `bedside` wants a
  // fitting the ACCENT pass placed, and on a space that pass has not run for
  // there is nothing there to read.
  //
  // SO THE CALLER SAYS WHAT IT IS ASKING. Asking for a rule and getting a note
  // saying its input is absent is a useful answer; getting that note on every
  // space on the sheet whether anybody asked or not is noise. A rule that was
  // never run has nothing to say, and this is how it says nothing.
  //
  // ALL THREE ARE FREE NOW, which is what the retirement of the television pass
  // bought — see the header. The parameter stays because `bedside` genuinely has
  // a prerequisite, and because a caller that wants only the door rule (the
  // schedule's count, say) should be able to ask for only the door rule.
  rules = ['door', 'bedside', 'facing'],
  opts = {},
} = {}) {
  // `pxPerFt` INTO THE OPTIONS AS WELL AS ITS OWN ARGUMENT. `headSide` measures
  // a gap in feet and is exported on its own, so it reads its threshold out of
  // the options object like every other tolerance in this file rather than
  // taking a second scale parameter nobody would remember to pass.
  const o = { ...ELEC_DEFAULTS, pxPerFt, ...opts };
  const wants = new Set(rules);
  const polygon = room?.polygonPx ?? [];
  const boards = [];
  const notes = [];
  if (polygon.length < 3) return { boards, notes: ['This space has no outline to work from.'] };

  const scale = roomScale(polygon);
  const runs = wallRuns(polygon, o);
  const all = rooms.length ? rooms : [room];
  // The joinery, once, with its margin on — every rule below tests against
  // this rather than re-deriving a clearance of its own.
  const keeps = keepOutsFor(keepOff, pxPerFt);
  /* AN ID THAT SAYS WHICH BOARD IT IS, and it used to be a counter.
     THE COUNTER WAS FINE WHILE NOTHING OUTSIDE ONE RENDER KNEW THESE IDS. It is
     not fine now that a person can delete a plate: a dismissal has to be stored
     against something, and against `sb-o2-1` it would mean "whichever board
     happens to come second next time" — so placing one bedside sconce would
     silently move somebody's deletion from the plate they threw away onto the
     one they kept. `${role}` plus what the rule keyed off is stable under every
     edit that does not remove the thing the board is FOR. */
  const id = (tag) => `sb-${room.id}-${tag}`;
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
  if (!wants.has('door')) {
    // Nothing to do for the door, and nothing to say about it either.
  } else {
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
      id: id('door'), roomId: room.id, role: 'door',
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
        keepOff: keeps,
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
      /* THE LAST RESORT IS ALLOWED TO BE AWKWARD AND IS NOT ALLOWED TO BE
         UNREACHABLE. Its whole argument is that a board 300mm from the latch,
         clamped onto the wall, beats a sentence — and that argument holds
         against a corner and fails against a wardrobe: a plate behind a shutter
         is not a switch in an awkward place, it is a switch that was never
         built. The ladder above already tried every rung and every position
         along them, so reaching here with the clamp blocked means this door's
         walls genuinely have nowhere. That is a sentence. */
      if (blocked(placed, keeps)) {
        boards.push({ ...base,
          rejected: 'Every position beside this door is taken up by joinery,'
            + ' so there is no board here.' });
      } else {
      boards.push({
        ...base, ...placed,
        shortWhy: `${SB_MM.fromDoor}mm past the latch jamb`,
        why: `${SB_MM.fromDoor}mm past the latch jamb, on the side the door opens to`
          + (sides && sides.lead >= o.areaTie
            ? ` — ${Math.round(100 * Math.max(sides.up, sides.down) / sides.total)}%`
              + ' of this space\'s floor is that side of it'
            : confidence === 'double' ? ' — a double door, so the board clears its centre'
            : ' — the floor is even either side, so the leaf parks against the nearer corner')
          + (fellBack ? '. The nearest door box to this space was used.' : '')
          /* WHY IT IS NOT WHERE THE RULE SAYS, SAID IN THE RULE'S OWN
             SENTENCE. Two different departures, and they read differently on
             the drawing: `pastSwing` means the board is on the OTHER side of
             the opening — a reader looking for it 300mm past the latch will not
             find it there and needs to be told why — where `slid` means it is
             on the side they expect, further along. */
          + (placed.pastSwing
            ? '. The latch side is joinery, so the board is on the hinge side,'
              + ' clear of the leaf when the door is open'
            : placed.slid ? ' It stands clear of the joinery on that wall.' : ''),
      });
      }
    }
  }

  }

  // --- 2. the bedsides ------------------------------------------------------
  const sconces = !wants.has('bedside') ? []
    : accentZones.filter((z) => z.type === 'sconce' && z.group === 'bedside'
      && !z.rejected && z.point && z.inward && z.along);
  if (wants.has('bedside') && !sconces.length) {
    notes.push('No bedside sconces have been placed, so there are no boards beside the bed.');
  }
  for (const z of sconces) {
    const base = {
      // THE SCONCE'S OWN ID IN THE BOARD'S, which is what makes a bedside
      // dismissal stick to the bedside it was made about.
      id: id(`bedside-${z.id}`), roomId: room.id, role: 'bedside', fromId: z.id,
      serves: 'a bedside sconce', servesShort: 'Bedside',
    };
    if (!scaled) { boards.push({ ...base, rejected: NO_SCALE }); continue; }
    const at = plateAt(z.point, { u: z.along, inward: z.inward, origin: z.point }, pxPerFt,
      { wall: z.wall, t: z.t });
    /* NO SLIDE HERE, AND THAT IS THE DIFFERENCE BETWEEN THIS RULE AND THE
       DOOR'S. The door's board is "300mm from a thing", so a foot further along
       the same wall is the same board doing the same job. This one IS the
       sconce's position — a bedside switch is the switch you reach from the
       pillow — and a plate slid clear of a wardrobe is no longer beside the
       bed, it is a plate on a wall with a story attached. The honest answer is
       that this bedside cannot have one, said in a sentence somebody can act
       on. */
    if (blocked(at, keeps)) {
      boards.push({ ...base,
        rejected: 'The wall beside this bed is joinery where the switch would go,'
          + ' so there is no bedside board here.' });
      continue;
    }
    boards.push({
      ...base,
      ...at,
      shortWhy: `at the sconce ${z.what ?? 'beside the bed'}`,
      why: `at the sconce ${z.what ?? 'beside the bed'}`,
    });
  }

  // --- 3. the wall facing the bed -------------------------------------------
  //
  // ONE MARK ON THE PLAN, TWO PLATES ON THE WALL, ON THE BED'S OWN CENTRELINE.
  // See the header for what this replaced and why a television is no longer
  // something this file goes looking for.
  //
  // THE CENTRELINE, AND NOT THE BED'S SIDES. This bracketed the bed for a while
  // — one plate 300mm outboard of each side — and that was the wrong reading of
  // what these plates are for. They are the TV position: the socket and the
  // switch above it, on the wall the bed faces, at the middle of the bed,
  // because that is where the television goes and the television is aimed at
  // the middle of the bed. Two plates spread to the corners of the room would be
  // two switches next to nothing.
  //
  // SO THE POSITION IS `facingWall`'s HIT POINT, which is already exactly this:
  // that function casts from the middle of the bed's foot along the head-to-foot
  // axis, so where its ray lands IS where the centreline meets the wall in
  // front. Nothing here recomputes it.
  //
  // AND IT IS ONE BOARD OBJECT CARRYING `plates: 2`, which is the honest shape
  // for a plan. The two plates are stacked in ELEVATION — one above the other on
  // the same piece of wall — so in a view from above they are one rectangle at
  // one coordinate. Two board objects at one point would be: two identical
  // polygons painted on top of each other, only the last of which can be
  // hovered; `markClashes` reporting a deliberate arrangement as "two boards
  // want the same piece of wall"; and a Delete that removes the plate you can
  // see and leaves an identical one behind it. `plates` is where the second one
  // lives instead — the schedule counts it, the drawing draws the position.
  if (!wants.has('facing')) {
    // Not asked for, and nothing to say about it.
  } else if (!bedRect) {
    notes.push('No bed was found in this space, so there is no wall facing one.');
  } else {
    const base = {
      id: id('facing'), roomId: room.id, role: 'facing',
      // `plates` IS NOT SET HERE ANY MORE. It is stamped from the role's height
      // list on the way out — see `spec` at the end of this function — because
      // the count and the heights are one fact and were two literals.
      serves: 'the television wall',
      servesShort: 'Facing the bed',
    };
    const head = scaled && headSide(bedRect, polygon, o);
    const front = head && facingWall(bedRect, head, runs, polygon);
    if (!scaled) {
      boards.push({ ...base, rejected: NO_SCALE });
    } else if (!head) {
      notes.push('The bed is not against a wall on this plan, so there is no'
        + ' headboard wall to work from and no wall facing it.');
    } else if (!front) {
      notes.push('Nothing on this outline stands in front of the bed, so there'
        + ' is no wall facing it to board.');
    } else {
      const { run } = front;
      const frame = runFrame(run, polygon, scale);
      const tHit = dot(sub(front.hit, frame.origin), frame.u);

      // CLAMPED, AND THIS IS THE ONE PLACE IN THIS FILE THAT CLAMPS ON PURPOSE.
      // placeBoard refuses rather than clamping, and the note there is right for
      // every rule that steps OFF something: a board 300mm past a latch has
      // somewhere else to go — round the corner — and a plate jammed into a
      // return does not get built.
      //
      // This rule has nowhere else to go. The position is not "300mm from a
      // thing", it IS the centreline, and there is exactly one of those. A bed
      // whose centreline lands within half a plate of a corner is a real if odd
      // plan, and the answer to it is a plate as close to the centreline as the
      // wall allows, saying that it moved — not a bedroom with no switch on its
      // television wall.
      const half = px(SB_MM.along, pxPerFt) / 2;
      const keep = half + px(SB_MM.clearEnd, pxPerFt);
      // A wall shorter than one plate and its clearances cannot take a board at
      // all, and clamping into one would draw a plate hanging off both ends.
      if (run.length < keep * 2) {
        boards.push({ ...base,
          rejected: 'The wall facing the bed is too short to take a board.' });
      } else {
        const t = clamp(tHit, keep, run.length - keep);
        const moved = Math.abs(t - tHit) > 1e-6;
        const at = plateAt(add(frame.origin, mul(frame.u, t)), frame, pxPerFt, {
          wall: { a: run.a, b: run.b, index: run.index }, t, clamped: moved,
        });
        /* AND THIS RULE CANNOT STEP ASIDE EITHER, for the reason stated two
           paragraphs up about corners: the position is not "near" anything, it
           IS the bed's centreline, and there is one of those. A television wall
           whose centreline is a wardrobe is a real plan — a wall of fitted
           units with the bed facing it — and the answer to it is to say so,
           not to put the socket for the television a metre to one side of the
           television. */
        if (blocked(at, keeps)) {
          boards.push({ ...base,
            rejected: 'The wall facing the bed is joinery where the centreline'
              + ' meets it, so there is no board on it.' });
        } else {
        boards.push({
          ...base,
          ...at,
          shortWhy: 'on the bed\'s centreline',
          why: 'on the wall facing the bed, where the bed\'s centreline meets it'
            + (moved ? ' — moved along to clear the corner' : ''),
          ...(moved ? { poor: 'the centreline lands in a corner, so it was moved along' } : {}),
        });
        }
      }
    }
  }

  const moved = applyMoves(boards, { moves, runs, polygon, pxPerFt, scale });

  /* THE CLASH IS FOUND ON THE DRAWN GEOMETRY AND FOLDED BACK BY ID.
     `markClashes` compares where plates actually are, so it has to see the hand
     positions — but what it hands back is drawn boards, and a moved board has to
     keep BOTH of its positions on the way out. So only the clash it found is
     taken from its answer. By id and not by index: this file does not get to
     assume a pass it calls preserves array order. */
  const drawn = new Map(markClashes(moved.map(asDrawn), pxPerFt).map((d) => [d.id, d]));
  /* THE HEIGHTS GO ON HERE, ONCE, AND NOT AT THE FOUR PLACES A BOARD IS PUSHED.
     Every board carries a `role` from the moment it is made, and the height is a
     property of the role and of nothing else — so stamping it at the door of
     this function is both the shortest way to say it and the only way that
     cannot be forgotten by the fifth rule somebody writes. `plates` comes off
     the same list for the same reason; see FACING_PLATES.
     A REFUSED BOARD GETS ITS HEIGHT TOO. It has no position and never will, but
     it is still a plate of a known kind, and a note saying "no bedside board
     here" reads better beside the spec than without it. */
  const spec = (b) => {
    const heightsMm = heightsFor(b.role);
    return { ...b, heightsMm, plates: heightsMm.length };
  };
  return {
    boards: moved.map((b) => {
      const d = drawn.get(b.id);
      if (!b.hand) return spec(d ?? b);
      return spec({ ...b, clash: d?.clash ?? null, poor: d?.poor ?? b.poor });
    }),
    notes,
  };
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

// --- a board per piece of ceiling --------------------------------------------

export const CHUNK_BOARD = {
  // A PIECE OF CEILING THIS BIG IS SWITCHED ON ITS OWN, in square feet. Below
  // it a bay is a nook, an alcove or the band outside a cove, and nobody puts a
  // plate on the wall for three downlights over a wardrobe — it goes on the
  // board next door. 25 sqft is a 5x5 piece of ceiling.
  minSqft: 25,
  // How close a wall has to come to a bay before it is THAT BAY'S wall, in
  // millimetres. One wall thickness, near enough: a bay sharing a boundary with
  // its neighbour is not touching the wall behind it.
  touchMm: 600,
  // ...and how much of the bay's own edge that wall has to run along, as a
  // fraction of it. A wall clipping a corner of the bay is not its wall either.
  overlapFrac: 0.30,
  // A NEW PLATE LANDING THIS CLOSE TO ONE ALREADY THERE IS THAT PLATE, in plate
  // widths. Two boards a hand's breadth apart on the same wall is not a
  // drawing anybody builds from; on site they are one plate with more modules
  // in it, and that is what adopting means here.
  gangPlates: 1.8,
};

/**
 * CAN THIS BOARD BE A BAY'S GENERAL SWITCH?
 *
 * NO FOR A DEDICATED PLATE, and getting this wrong is not a near miss. A
 * bedside board exists to switch the one sconce above it, and the pair on the
 * wall facing the bed exists to switch whatever stands on that wall; neither is
 * "the switch for this piece of ceiling". Let a bay adopt one and the row of
 * downlights over the whole room comes on from a plate at the head of the bed —
 * while the board beside the door, which is the room's actual switch, is left
 * feeding nothing.
 *
 * IT IS A ROLE TEST AND NOT A DISTANCE TEST for the same reason `fromId` is: a
 * bedside plate is often the nearest board to most of the room, so anything
 * measured in feet gets this backwards in exactly the rooms it matters in.
 */
/* PLATES THAT SWITCH ONE THING AND CANNOT BE FALLEN BACK TO FOR A CEILING.
   A bedside plate switches its own sconce and a facing plate its own television.
   A SOCKET OUTLET IS THE THIRD, AND THE STRONGEST CASE OF THE THREE: the other
   two at least have a switch on them, where an outlet has none at all — a row of
   downlights whose nearest plate is a socket would come out switched from a
   thing with nothing to press. */
export const DEDICATED_ROLES = new Set(['bedside', 'facing', 'socket']);
export const servesBay = (b) => !DEDICATED_ROLES.has(b?.role);

/** Rect corners, and its centre. Local because a bay is a rect and nothing more. */
const rectCorners = (r) => [
  { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
];
const rectCentre = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

/**
 * WHICH WALLS ARE THIS BAY'S OWN — the run, where the bay sits along it, and
 * how much of the bay's edge it carries.
 *
 * Measured off the bay's four corners rather than off its edges, because a run
 * is a segment in the room's frame and a bay is axis-aligned in the same frame:
 * project the corners and the span falls out, distance and all. `overlap` is the
 * span that is actually ON the run — a bay reaching past the end of a wall
 * cannot hang a board off the part that is not there.
 */
export function bayWalls(rect, runs, polygon, scale = 1, touch = Infinity, opts = {}) {
  const o = { ...CHUNK_BOARD, ...opts };
  const cs = rectCorners(rect);
  const out = [];
  for (const run of runs) {
    const frame = runFrame(run, polygon, scale);
    const ts = cs.map((p) => dot(sub(p, frame.origin), frame.u));
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    const dist = Math.min(...cs.map((p) => distToSegment(p, run.a, run.b)));
    const on = Math.min(t1, run.length) - Math.max(t0, 0);
    out.push({ run, frame, t0, t1, dist, span: t1 - t0, overlap: Math.max(0, on) });
  }
  return out
    .filter((w) => w.dist <= touch && w.overlap >= o.overlapFrac * w.span)
    .sort((a, b) => b.overlap - a.overlap || b.run.length - a.run.length);
}

/**
 * ONE BOARD PER BAY OF CEILING, and most bays do not get a new one.
 *
 * THE RULE IS "A BAY IS SWITCHED FROM ITS OWN WALL", not "every bay gets a
 * plate", and the difference is most of this function. A bedroom is one bay
 * with a door in it: the board beside that door IS the bay's board, and putting
 * a second plate four feet along the same wall would be drawing a switch nobody
 * would ever wire. So an existing board — the one beside the door, the one at a
 * bedside, the one past the TV — is ADOPTED whenever it stands on a wall this
 * bay actually abuts, within the bay's own stretch of it. A new plate appears
 * only where a bay has no board on any of its walls, which is what happens in a
 * living-dining room cut into two bays with one door.
 *
 * SMALL BAYS DO NOT GET ONE AT ALL. Under `minSqft` a bay borrows the nearest
 * board there is, because that is what borrowing means on site: the alcove runs
 * off the plate by the door with everything else.
 *
 * `owner` is the answer everything downstream actually wants: bay key -> board
 * id. The boards are the by-product.
 *
 * PLAN PIXELS in, plan pixels out, same as the rest of this file. `bays` are
 * `{ key, rect }` and nothing more — a design chunk, a planner chunk or a
 * hand-drawn rectangle are all the same question to this pass.
 */
export function planChunkBoards({
  room, bays = [], boards = [], pxPerFt = null,
  /* THE SAME JOINERY THE RULES PASS KEEPS OFF, and it has to be told separately
     because this is a separate pass over the same walls. A bay plate is a
     switchboard on the drawing — same rectangle, same blue — so a bay plate on
     a wardrobe is exactly the fault the rules pass now avoids, arrived at by a
     different route. Raw rectangles, margin applied in here. */
  keepOff = [],
  /* A BAY PLATE CAN BE DRAGGED TOO, and it has to be: on the drawing it is a
     switchboard like any other, so a cursor that says "grab me" over one and a
     plate that then refuses to move is worse than no drag at all.
     THE MOVES ARE APPLIED TO WHAT THIS PASS MAKES AND NOT TO WHAT IT IS GIVEN.
     `boards` arrives already at its rule positions on purpose — see
     `ruleBoardsFor` in App.jsx — because this pass decides which bay adopts
     which plate by which plate stands on the bay's own walls, and that decision
     must not follow a drag. */
  moves = {}, opts = {},
} = {}) {
  const o = { ...ELEC_DEFAULTS, ...CHUNK_BOARD, ...opts };
  const polygon = room?.polygonPx ?? [];
  const owner = new Map();
  const made = [];
  const notes = [];
  if (polygon.length < 3 || !bays.length) return { boards: made, owner, notes };
  if (!(pxPerFt > 0)) {
    return { boards: made, owner, notes: [NO_SCALE] };
  }

  const scale = roomScale(polygon);
  const runs = wallRuns(polygon, o);
  const keeps = keepOutsFor(keepOff, pxPerFt);
  const along = px(SB_MM.along, pxPerFt);
  const end = px(SB_MM.clearEnd, pxPerFt) + along / 2;
  const touch = px(o.touchMm, pxPerFt);
  const gang = o.gangPlates * along;
  const sqft = (r) => Math.abs((r.x1 - r.x0) * (r.y1 - r.y0)) / (pxPerFt * pxPerFt);

  // Every board that exists, growing as this pass adds to it, so the second bay
  // along a wall adopts what the first one put there.
  //
  // A DEDICATED PLATE IS IN THE LIST FOR GANGING AND NOT FOR ADOPTING. It still
  // has to be seen — a new bay plate must not land on top of a bedside one, and
  // the gang test below is what stops that — but it can never BE a bay's board.
  // See servesBay.
  const live = boards.filter((b) => !b.rejected && b.point).map((b) => ({ ...b }));
  // KEYED BY THE BAY, NOT BY A COUNTER, for the reason the rules pass gives at
  // greater length: these ids are what a deletion is stored against, and a
  // counter makes a stored deletion mean "whichever bay comes second".
  const id = (tag) => `sb-${room.id}-${tag}`;

  // BIGGEST FIRST, so the plate goes on the wall of the bay that most needs one
  // and the small bays adopt it, rather than the order of the list deciding.
  const big = bays.filter((b) => sqft(b.rect) >= o.minSqft)
    .sort((a, b) => sqft(b.rect) - sqft(a.rect));
  const small = bays.filter((b) => sqft(b.rect) < o.minSqft);

  for (const bay of big) {
    const walls = bayWalls(bay.rect, runs, polygon, scale, touch, o);
    // A board already standing on one of this bay's own walls, inside the
    // bay's own stretch of it. `+ along` of slack at each end, because a plate
    // half a plate past the boundary is still the plate for this bay.
    let adopted = null;
    for (const w of walls) {
      for (const b of live) {
        if (!servesBay(b)) continue;
        if (b.wall?.index == null || !w.run.indices.includes(b.wall.index)) continue;
        const t = dot(sub(b.point, w.frame.origin), w.frame.u);
        if (t < w.t0 - along || t > w.t1 + along) continue;
        const d = Math.abs(t - dot(sub(rectCentre(bay.rect), w.frame.origin), w.frame.u));
        if (!adopted || d < adopted.d) adopted = { board: b, d };
      }
      if (adopted) break;
    }
    if (adopted) { owner.set(bay.key, adopted.board.id); continue; }

    // No board on any of its walls. Put one on the wall it shares most of its
    // edge with, opposite the middle of the bay — which is where a hand reaches
    // for it — clamped into the bay's own stretch and off the corners.
    const w = walls[0] ?? nearestWall(bay.rect, runs, polygon, scale);
    if (!w || w.run.length < 2 * end) {
      // Nowhere on this bay's walls for a plate. It borrows, like a small bay.
      small.push(bay);
      continue;
    }
    const mid = dot(sub(rectCentre(bay.rect), w.frame.origin), w.frame.u);
    const lo = Math.max(end, Math.min(w.t0, w.run.length - end));
    const hi = Math.min(w.run.length - end, Math.max(w.t1, end));
    const t = clamp(mid, Math.min(lo, hi), Math.max(lo, hi));
    const point = add(w.frame.origin, mul(w.frame.u, t));

    // ...AND IF THAT LANDS ON TOP OF A PLATE ALREADY THERE, one of two things
    // happens. An eligible plate IS this bay's plate. A DEDICATED one — a
    // bedside, a TV — is a plate the bay may not use and may not sit on either,
    // so the bay's own plate steps clear of it along the wall and stays its own
    // board. Two plates in the same 230mm is the one outcome neither branch
    // permits.
    const clash = live.find((b) => b.wall?.index != null
      && w.run.indices.includes(b.wall.index) && len(sub(b.point, point)) < gang);
    if (clash && servesBay(clash)) { owner.set(bay.key, clash.id); continue; }
    let at = point, tAt = t;
    if (clash) {
      const tc = dot(sub(clash.point, w.frame.origin), w.frame.u);
      // Away from the dedicated plate, and toward whichever end has the room.
      const dir = tc <= w.run.length / 2 ? 1 : -1;
      tAt = clamp(tc + dir * gang, end, Math.max(end, w.run.length - end));
      at = add(w.frame.origin, mul(w.frame.u, tAt));
    }

    /* ...AND IF IT LANDS ON JOINERY, THE SAME STEP ALONG THE WALL. The bay's
       plate is wanted "opposite the middle of the bay, where a hand reaches for
       it", which is a preference and not a position — so unlike the bedside and
       the television wall, this one genuinely can move and still be the thing
       it was. It walks toward whichever end of the wall has more room, in
       half-plate steps, exactly as `placeBoard` does.
       A BAY WHOSE WALL IS ALL WARDROBE BORROWS, which is a path this pass
       already has for "nowhere on its walls for a plate" — see the run-length
       test above. No new outcome, no new sentence to write: the bay's lights
       run off the nearest board, which is what happens to every small bay. */
    if (keeps.length) {
      const stepPx = Math.max(along / 2, 1e-6);
      const dir = tAt <= w.run.length / 2 ? 1 : -1;
      let clearAt = null;
      for (let ts = tAt; ts >= end && ts <= w.run.length - end; ts += dir * stepPx) {
        const cand = plateAt(add(w.frame.origin, mul(w.frame.u, ts)), w.frame, pxPerFt, {});
        if (!blocked(cand, keeps)) { clearAt = { ts, at: cand.point }; break; }
      }
      if (!clearAt) { small.push(bay); continue; }
      tAt = clearAt.ts; at = clearAt.at;
    }

    // The last resort, and it is a sentence rather than a plate on top of
    // somebody else's: a wall with a dedicated board and no room beside it.
    //
    // THE EPSILON IS NOT COSMETIC. The step above aims for exactly `gang`, and
    // `gang` is a product of two floats while the distance back is a square
    // root of two more — so the step landed a fifteenth of a nanometre short of
    // its own target and this branch threw away a perfectly good plate. A
    // clearance test must not reject the position that was computed to satisfy
    // it.
    if (clash && len(sub(at, clash.point)) < gang - 1e-6) {
      notes.push(`This bay's only wall already carries a ${clash.servesShort || 'dedicated'}`
        + ' board with no room beside it, so its lights run off the nearest board instead.');
      small.push(bay);
      continue;
    }

    const board = {
      id: id(`bay-${bay.key}`), roomId: room.id, role: 'bay', bayKey: bay.key,
      // Switch height, from the same table the rules pass reads. A bay board is
      // the switch for a piece of ceiling, operated standing.
      heightsMm: heightsFor('bay'), plates: heightsFor('bay').length,
      serves: bay.label ? `the ${bay.label}` : 'the lights in this bay',
      servesShort: 'Bay',
      shortWhy: `${Math.round(sqft(bay.rect))} sqft of ceiling, switched on its own`,
      why: `this bay is ${Math.round(sqft(bay.rect))} sqft and no board stands on any`
        + ' of its own walls, so it gets one — opposite the middle of the bay',
      ...plateAt(at, w.frame, pxPerFt,
        { wall: { a: w.run.a, b: w.run.b, index: w.run.index }, t: tAt }),
    };
    live.push(board);
    made.push(board);
    owner.set(bay.key, board.id);
  }

  // The small bays, and the big ones with nowhere to stand: nearest board wins
  // — the nearest one that can be a bay's board, which is not the same thing.
  // A nook beside a bed borrows the plate by the DOOR, not the one at the
  // pillow.
  const general = live.filter(servesBay);
  for (const bay of small) {
    if (!general.length) {
      notes.push('There is no board in this space for its bays to run off.');
      break;
    }
    const c = rectCentre(bay.rect);
    // `rulePoint` FIRST, for the reason flows.js's own fallback gives: which
    // plate a small bay borrows is a decision, and a decision must not follow a
    // drag. Boards nobody moved carry no `rulePoint` and are unchanged.
    const near = (b) => len(sub(b.rulePoint ?? b.point, c));
    const best = general.reduce((a, b) => (near(b) < near(a) ? b : a));
    owner.set(bay.key, best.id);
  }

  /* THE MOVES GO ON AT THE END, ONTO THE PLATES THIS PASS MADE.
     After `owner` is settled, which is the point: everything above has decided
     which bay is switched from which plate, by geometry, at the rule positions.
     This adds the hand position to the bay plates so the drawing and the wire
     follow the drag while the switching does not. See `applyMoves`. */
  return {
    boards: applyMoves(made, { moves, runs, polygon, pxPerFt, scale }),
    owner, notes,
  };
}

/** The wall this rectangle is nearest, whatever it overlaps. The last resort. */
function nearestWall(rect, runs, polygon, scale) {
  const cs = rectCorners(rect);
  let best = null;
  for (const run of runs) {
    const d = Math.min(...cs.map((p) => distToSegment(p, run.a, run.b)));
    if (!best || d < best.dist) {
      const frame = runFrame(run, polygon, scale);
      const ts = cs.map((p) => dot(sub(p, frame.origin), frame.u));
      best = { run, frame, dist: d, t0: Math.min(...ts), t1: Math.max(...ts) };
    }
  }
  return best;
}
