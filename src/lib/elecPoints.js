// ---------------------------------------------------------------------------
// elecPoints.js — THE POINT A CABLE ENDS AT, SWITCHED, AND WHERE IT SITS.
//
// TWO ELEMENTS, ONE PRIMITIVE, AND THE PRIMITIVE IS WHAT TELLS THEM APART.
//
//   A WALL POINT     is held ON THE WALLS. A geyser point, an exhaust, a
//                    chimney, a mirror light — brought out to the plaster at a
//                    stated HEIGHT and left there. It is drawn the way a sconce
//                    is drawn, because it is the same kind of thing on the same
//                    kind of wall: a stem off the plaster to a circle standing
//                    in the room. What is inside the circle is a J and not the
//                    sconce's cross, and that is the whole of the difference on
//                    the sheet.
//   A CEILING POINT  is FREE. It goes where it is put, on the ceiling, and it
//                    has no height because there is only one height a ceiling
//                    point can be at. No stem: the circle and the J, alone.
//
// THERE IS NO `kind` FIELD AND THERE MUST NOT BE. lib/point.js reads a point's
// kind off the record — `on != null` is constrained, and nothing else is — for
// the reason stated at length there: a record carrying both a host and a
// coordinate has two positions and no rule for which wins. A wall point IS a
// constrained point and a ceiling point IS a free one, so `pointKind` already
// answers the only question anybody asks, and a flag beside it would be a
// second answer waiting to disagree.
//
// WHAT THAT BUYS, AND IT IS THE WHOLE REASON THIS FILE IS SHAPED THIS WAY.
// Read the header of lib/point.js: an element on the primitive inherits MOVE,
// OPTION-COPY, DELETE, the SHIFT ortho lock, the SNAP, the SLOP, the GROUP
// MOVE, the SNAP-BACK and the REFUSAL — all of them, at once, with no gesture
// code of its own. And the two gates fall out correctly without either element
// being taught them: a wall point takes no shift lock and no snap because it is
// already held to a wall, and a ceiling point honours both because it is free.
//
// THE HOST IS THE ROOM'S WALLS, AND IT IS ALREADY BUILT. `wallHostFor` in
// electrical.js is what the switchboard plate stands on; a wall point stands on
// exactly the same path, so `u` means the same fraction of the same perimeter
// for both, and neither of them re-derives what a wall is.
//
// WHAT A WALL POINT DOES *NOT* INHERIT FROM THE PLATE IS ITS CLEARANCE. A plate
// is 230mm of frame and may not stand within half of that of a corner, nor on a
// run too short to hold one — see `plateClampU`. A point is a mark: it can sit
// anywhere there is plaster, including six inches from a return, which is
// exactly where an exhaust point goes. So it has its own projection and it is
// the simpler one.
//
// FEET AND FRACTIONS IN THE STORE, PIXELS IN THE PROJECTION, like every other
// fitting here. A free point keeps `xFt`/`yFt`; a constrained one keeps `u` and
// has its coordinate written NULL, which is the primitive's own rule.
//
// PURE. No React, no canvas, no fetch.
// ---------------------------------------------------------------------------

import { add, mul, sub, dot, len } from './geometry.js';
import { clampU, pointOn, freePoint, pointKind, isConstrained, ON_PATH }
  from './point.js';
import { wallRuns, wallPath, runFrame, roomScale, wallHostFor } from './electrical.js';
import { SCONCE_FT } from './settings.js';

export { isConstrained, pointKind, ON_PATH };

/* --- WHAT ARMS EACH OF THE TWO -------------------------------------------
   PALETTE IDS AND NOT CATALOGUE IDS. Neither of these is a ceiling object —
   no diameter, no clearance, not in CEILING_BY_ID — and they ride the same
   one-shot the fan does because the GESTURE is the same. The two places that
   would otherwise ask the catalogue about them test against these. */
export const WALL_POINT_ID = 'wallpoint';
export const CEILING_POINT_ID = 'ceilingpoint';
export const POINT_IDS = [WALL_POINT_ID, CEILING_POINT_ID];

/**
 * HOW HIGH A WALL POINT IS SET, in mm, until somebody sets it.
 *
 * 1200 IS THE APP'S OWN ANSWER FOR A PLATE IT HAS NOT HEARD OF — see
 * `heightsFor` in electrical.js, which falls back to exactly this and gives the
 * reason. It is a DEFAULT and not a figure, and that matters more here than
 * anywhere else in this app: a geyser point is at 1800, a chimney at 2100, an
 * exhaust at 2200, a shaver at 1050. It starts somewhere so a point dropped and
 * forgotten is still buildable, and the expectation is that it gets changed.
 *
 * A CEILING POINT HAS NO HEIGHT AT ALL, and that is not the same as having this
 * one. There is one height a point on a ceiling can be at, so a number there
 * would be a field nobody can answer differently — see `heightOfPoint`.
 */
export const WALL_POINT_HEIGHT_MM = 1200;

/* `POINT_HEIGHTS_MM` WAS HERE — a list of six heights for a row of chips, and
   it went because the control did. The height of a point is a DECISION and not a
   choice from a list: 1800 for a geyser, 2150 for one particular chimney hood,
   whatever the joinery drawing says. Six chips answer six of those and make
   every other number unreachable. It is typed now, through the switchboard's own
   `HeightField` — see PointSpec. */

/**
 * ...AND WHAT EITHER IS SWITCHED AT, until somebody says.
 *
 * `null` MEANS "THE COUNTRY'S LIGHT RATING" and is a null rather than a 6,
 * because 6 is India's answer and 15 is the United States'. The flow carries the
 * null straight through and `pointsFromFlows` resolves it — see `lightSwitchA`.
 */
export const POINT_AMPS = null;

/**
 * THE SYMBOL, AND IT IS THE SCONCE'S.
 *
 * `SCONCE_FT` IS READ AND NOT RESTATED. A wall point is a stem off the plaster
 * to a circle standing in the room, which is the mark a sconce already has on
 * this drawing and in the DXF — see settings.js, and `exporters.js`, which
 * draws it from the same three numbers. Two symbols that are meant to be the
 * same size and are written down twice are two symbols that stop being the same
 * size the first time one of them is tuned.
 *
 * WHAT DIFFERS IS THE GLYPH INSIDE, and that is the only thing this file adds:
 * the sconce carries a cross through its circle and a point carries a J.
 */
export const POINT_FT = {
  r: SCONCE_FT.r,
  stand: SCONCE_FT.stand,
  // The J, as fractions of the circle's own radius. See `glyphJ`.
  j: { top: -0.46, drop: 0.16, hook: 0.46, right: 0.22, left: 0.30 },
};

/** The circle's radius in plan pixels, with a floor so it survives zooming out. */
export const pointRadiusPx = (pxPerFt, lw = 0) =>
  Math.max((pxPerFt || 12) * POINT_FT.r, lw * 3);

/**
 * THE J, AS A PATH, ABOUT A CENTRE.
 *
 * TWO QUADRATICS AND NOT AN ARC. A quadratic says which way it bends by where
 * its control point is; an arc says it with a sweep flag, which is one
 * character and the single easiest thing on an SVG path to get backwards. This
 * reads down the right of the circle, round the bottom and back up to the left,
 * which is a J.
 */
export function glyphJ(cx, cy, r) {
  const g = POINT_FT.j;
  const x = cx + r * g.right;
  return `M ${x} ${cy + r * g.top}`
    + ` L ${x} ${cy + r * g.drop}`
    + ` Q ${x} ${cy + r * g.hook} ${cx} ${cy + r * g.hook}`
    + ` Q ${cx - r * g.left} ${cy + r * g.hook} ${cx - r * g.left} ${cy + r * g.drop}`;
}

// --- the two records --------------------------------------------------------

/**
 * A WALL POINT — the primitive's constrained point, with a height on it.
 *
 * `pointOn` NULLS THE COORDINATE, which is lib/point.js's rule and not a
 * convenience: a stale `x` beside a live `u` is a lie that survives a save, and
 * the first reader to trust the wrong one puts a fitting where nobody put it.
 */
export const wallPoint = (roomId, u, rest = {}) =>
  pointOn('walls', u, { roomId, heightMm: WALL_POINT_HEIGHT_MM,
                        amps: POINT_AMPS, ...rest });

/**
 * ...AND A CEILING POINT — the primitive's free point, with no height.
 *
 * `heightMm: null` AND NOT A NUMBER. See WALL_POINT_HEIGHT_MM: a ceiling point
 * is at ceiling level and there is nothing else it could be at, so a figure here
 * would be a property nobody can answer differently and a card would have to
 * print it anyway.
 */
export const ceilingPoint = (roomId, xFt, yFt, rest = {}) =>
  freePoint({ x: xFt, y: yFt }, { roomId, heightMm: null,
                                  amps: POINT_AMPS, ...rest });

/** Only a wall point has one. @see WALL_POINT_HEIGHT_MM */
export const heightOfPoint = (p) => (isConstrained(p)
  ? (Number.isFinite(p?.heightMm) ? p.heightMm : WALL_POINT_HEIGHT_MM)
  : null);

/** What the palette, the card and the schedule call one. */
export const labelOfPoint = (p) => (isConstrained(p) ? 'Wall point' : 'Ceiling point');

/** "1800 mm · 16 A", or just the rating where there is no height to state. */
export function pointSpec(p, fallbackAmps = null) {
  const h = heightOfPoint(p);
  const a = Number.isFinite(p?.amps) ? p.amps : fallbackAmps;
  const bits = [h != null ? `${h} mm` : 'at ceiling level', a ? `${a} A` : null];
  return bits.filter(Boolean).join(' · ');
}

// --- where a wall point sits ------------------------------------------------

/**
 * THE HOST, WHICH IS THE PLATE'S HOST. @see wallHostFor
 *
 * RE-EXPORTED RATHER THAN REBUILT so that `u` means the same fraction of the
 * same perimeter for a point as it does for a switchboard, and so that a corner
 * somebody re-traces moves both by the same amount.
 */
export const pointHostFor = wallHostFor;

/** The walls of a host, as runs and as one closed path. Built once per call. */
const pathOf = (host) => {
  const runs = wallRuns(host.polygonPx, host.opts);
  return { runs, ...wallPath(runs), scale: roomScale(host.polygonPx) };
};

/**
 * A FRACTION OF THE WALLS -> WHERE THAT IS, AND WHICH WAY IS INTO THE ROOM.
 *
 * `plateAtS` WOULD NOT DO, and the two differences are the two things a plate
 * has that a point does not: it clamps the position half a plate plus a
 * clearance off each corner, and it SKIPS a run too short to hold a plate
 * entirely. A point may sit six inches from a return — which is where an
 * exhaust point goes — and on a 300mm return if that is where somebody put it.
 *
 * `inward` IS WHAT THE SYMBOL NEEDS and is why this returns a frame rather than
 * a coordinate: the circle stands OFF the plaster into the room, exactly as a
 * sconce's does, and a symbol drawn to the wrong side of the wall line ends up
 * inside the wall or in the next room. `runFrame` settles it by testing rather
 * than by assuming a winding.
 */
export function seatOnWalls(u, host) {
  if (!host?.polygonPx?.length) return null;
  const { runs, segs, total, scale } = pathOf(host);
  if (!runs.length || !(total > 0)) return null;
  const s = clampU(u) * total;
  const seg = segs.find((g) => s >= g.s0 && s < g.s0 + g.length) ?? segs[segs.length - 1];
  const f = runFrame(seg.run, host.polygonPx, scale);
  const t = Math.min(Math.max(s - seg.s0, 0), seg.length);
  return {
    point: add(f.origin, mul(f.u, t)),
    along: f.u, inward: f.inward,
    wall: { a: seg.run.a, b: seg.run.b, index: seg.run.index },
    t, s,
  };
}

/**
 * ...AND BACK: A POINTER -> THE FRACTION NEAREST IT.
 *
 * THE PLACEMENT AND THE CLAMP ARE ONE FUNCTION, which is the same discipline
 * `nearestLampPlate` keeps for the same reason: the gesture that decides where a
 * point may be DROPPED and the one that decides where it may be DRAGGED have to
 * give the same answer, and two copies of one projection is how they stop.
 *
 * EVERY WALL IS A CANDIDATE, unlike the plate's `nearestSeat`, which drops any
 * run too short to hold a frame. See `seatOnWalls`.
 */
export function nearestWallU(p, host) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  if (!host?.polygonPx?.length) return null;
  const { segs, total, scale } = pathOf(host);
  if (!(total > 0)) return null;
  let best = null;
  for (const seg of segs) {
    const f = runFrame(seg.run, host.polygonPx, scale);
    const t = Math.min(Math.max(dot(sub(p, f.origin), f.u), 0), seg.length);
    const at = add(f.origin, mul(f.u, t));
    const d = len(sub(p, at));
    if (!best || d < best.d) best = { d, u: clampU((seg.s0 + t) / total) };
  }
  return best?.u ?? null;
}

/**
 * THE DOMAIN'S VETO, in the shape `pointAdapters` takes.
 *
 * IT IGNORES THE FRACTION IT IS HANDED AND PROJECTS THE POSITION ITSELF, for
 * the reason `plateClampU` gives: "the nearest point on the path" and "the
 * nearest point on any wall" are different answers on a polygon with a return
 * in it, and the second is the one a hand is asking for.
 */
export const pointClampU = (hostFor) => (_wanted, pt, host, want) =>
  nearestWallU(want, host ?? hostFor?.(pt));

// --- the projection ---------------------------------------------------------

/**
 * ONE POINT, RESOLVED — the store's record plus where it actually is.
 *
 * A CONSTRAINED ONE IS RESOLVED AGAINST ITS ROOM'S WALLS and a free one is its
 * own feet times the scale. Both come out with `x`/`y` in plan pixels and the
 * record's own fields carried through, so a consumer never has to ask which
 * kind it is holding in order to draw it — only to decide whether to draw the
 * stem.
 *
 * `null` FOR A POINT WITH NOWHERE TO BE, which is a wall point whose room has
 * gone. lib/point.js's third gate says a point that cannot be placed cannot be
 * pressed, and a list that quietly carried a NaN would defeat it.
 */
export function resolveElecPoint(p, host, pxPerFt) {
  if (!p) return null;
  const r = pointRadiusPx(pxPerFt);
  if (isConstrained(p)) {
    const seat = host ? seatOnWalls(p.u, host) : null;
    if (!seat) return null;
    const stand = r * POINT_FT.stand;
    return {
      ...p, r,
      // THE CIRCLE STANDS OFF THE WALL, and `x`/`y` are the CIRCLE — which is
      // what a reader clicks and what a wire should run to. `seat` is the foot
      // of the stem, kept beside it so the symbol can draw the stem without
      // re-deriving the wall.
      x: seat.point.x + seat.inward.x * stand,
      y: seat.point.y + seat.inward.y * stand,
      foot: seat.point, along: seat.along, inward: seat.inward, wall: seat.wall,
      heightMm: heightOfPoint(p),
    };
  }
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { ...p, r, x: p.x * (pxPerFt || 1), y: p.y * (pxPerFt || 1),
           foot: null, heightMm: null };
}

/**
 * THE WHOLE STORE, PROJECTED — feet and fractions in, plan pixels out.
 *
 * `hostFor` IS THE CALLER'S INDEX, because the walls are the scene's and not
 * this file's: App holds the rooms, so it answers "which host does this point's
 * room have" and nothing here has to learn what a room is.
 *
 * A READER HANDED THE RAW STORE READS `undefined` AND DRAWS NOTHING, with no
 * throw and no warning — see the note on `manualCobs`. That is why this exists
 * and why every consumer of a POSITION takes its answer.
 */
export function projectElecPointsPx(points = [], hostFor, pxPerFt = 0) {
  if (!(pxPerFt > 0)) return [];
  const out = [];
  for (const p of points) {
    const resolved = resolveElecPoint(p, isConstrained(p) ? hostFor?.(p) : null, pxPerFt);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** A fresh id. One minter, for `newCobId`'s reason. */
export const newPointIdIn = (seq = 0) => `ep-${Date.now().toString(36)}-${seq}`;
