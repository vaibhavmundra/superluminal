// ---------------------------------------------------------------------------
// wallUnit.js — A BOX THAT HANGS ON A WALL, AND THE POINT THAT FEEDS IT.
//
// WHAT A WALL UNIT IS. A split air-conditioner's indoor unit is a metre of
// plastic screwed to the plaster at 2100mm. It is not on the ceiling, it is not
// free in the room, and it has no orientation of its own: it faces into the
// room because the wall behind it does. Everything about where it is and which
// way it points is a fact about the WALL, and the only thing a person chooses
// is which piece of plaster.
//
// SO IT IS THE SWITCHBOARD'S POSITION WITH THE CASSETTE'S BODY. It stores `sFt`
// — how far round this room's walls it sits — exactly as a plate does, and for
// the reason lib/point.js gives at length: a coordinate stored against a wall
// falls off that wall the moment the outline is re-traced, silently, because a
// thing with nowhere to sit is simply not drawn. `x`, `y` and `rot` are
// DERIVED, every frame, from the wall it is on.
//
// WHICH IS WHY THE ROTATION HANDLE GOES. It was the whole of the complaint the
// feature was built from: arm the unit, drop it, then reach for a grip and spin
// it until it lined up with the wall you meant. A rotation you have to perform
// after every placement is not a degree of freedom, it is a correction — and
// the correct angle was never in doubt, because there is only one angle a thing
// screwed to a wall can be at.
//
// THE RECORD DECIDES, NOT THE CATALOGUE. `isSeated` tests `sFt`, so a split
// unit saved before this existed keeps its stored `x`/`y` and stays exactly
// where it was put. There is no migration and nothing to go wrong on reopening
// an old plan: a unit either has a seat on a wall or it has a coordinate, never
// both, which is the same rule `isConstrained` states about a point.
//
// ...AND IT BRINGS ITS OWN SUPPLY. An air-conditioner is the one thing on this
// drawing that is useless without a dedicated circuit, so placing one places
// the thing it plugs into — see FEEDS below for the two shapes that can take
// and where each of them sits.
//
// PURE. No React, no canvas, no fetch.
// ---------------------------------------------------------------------------

import { add, mul, sub, dot, len } from './geometry.js';
import { wallRuns, wallPath, runFrame, roomScale } from './electrical.js';
import { isSeatedOnWall } from './ceilingObjects.js';

/* --- WHICH THINGS IN THE CATALOGUE HANG ON A WALL -------------------------
   ONE ENTRY, AND THE SET IS THE POINT OF IT. A geyser is the obvious second —
   it is already `offCeiling` and it is already screwed above a door — and the
   day it joins this is one line here rather than a `=== 'split_ac'` found in
   six files. A CASSETTE IS DELIBERATELY NOT IN IT: it is a grille IN the
   ceiling, it is the one air-conditioner the downlight grid has to keep clear
   of, and seating it on a wall would take it out of the ceiling it is in. */
export const WALL_UNIT_KINDS = new Set(['split_ac']);
export const isWallUnit = (o) => WALL_UNIT_KINDS.has(o?.kind);

/**
 * IS THIS ONE ACTUALLY SEATED? — the record's own answer, not the catalogue's.
 *
 * A unit placed since this file existed carries `sFt` and has NULL for `x`,
 * `y` and `rot`; one placed before it carries a coordinate and no seat. Both
 * are drawable and neither is broken, and nothing anywhere has to know which
 * era a plan came from — it asks the record. @see resolveWallUnitPx
 */
export const isSeated = isSeatedOnWall;

/* --- THE TWO WAYS AN AIR-CONDITIONER IS FED -------------------------------
   A SOCKET, WHICH IS THE COMMON ONE AND THE DEFAULT. A 20A socket outlet on
   the wall beside the unit, with its switch on the board the bay runs off —
   the ordinary Indian specification for a split indoor unit, and what an
   installer expects to find.
   OR A POINT, WHICH IS THE OTHER HALF OF THE SAME TRADE. A cable brought out
   of the wall behind the unit and terminated there, switched from the same
   board. Chosen where the unit is hard-wired rather than plugged in.
   THEY ARE THE SAME DECISION AT TWO POSITIONS AND NOT TWO FEATURES, which is
   the whole reason they are one field: both are one connection at one rating
   switched from one board, and swapping between them moves the mark and
   changes nothing else. */
export const FEED_SOCKET = 'socket';
export const FEED_POINT = 'point';
export const FEEDS = [FEED_SOCKET, FEED_POINT];
export const AC_FEED = FEED_SOCKET;
/** The feed a record carries, with the default for one that has not said. */
export const feedOf = (o) => (o?.feed === FEED_POINT ? FEED_POINT : FEED_SOCKET);

/**
 * WHAT AN AIR-CONDITIONER IS SWITCHED AT, AND THE FLOOR UNDER IT.
 *
 * 20A IS THE ANSWER AND 16A IS THE FLOOR. A one-and-a-half-ton split unit
 * pulls something like 8 amps running and several times that for the half
 * second it starts, so it is given a circuit of its own at 20 — not because
 * the running load needs it but because the inrush and the cable run do. 16 is
 * where that stops being defensible: below it the socket is a general-purpose
 * one and the drawing would be specifying an appliance circuit that is not an
 * appliance circuit.
 *
 * A FLOOR AND NOT A FIXED FIGURE, because the size of the unit is not this
 * app's business. A 2-ton cassette on a long run is a 32A circuit on plenty of
 * jobs and the person drawing knows which; what the app is entitled to refuse
 * is the 6A light switch that would be a specification error rather than a
 * preference. @see acRatings
 */
export const AC_MIN_A = 16;
export const AC_AMPS = 20;

/**
 * THE RATINGS AN AC MAY BE SET TO IN THIS COUNTRY — the country's own list,
 * with everything under the floor taken out.
 *
 * THE COUNTRY'S LIST AND NOT A LIST OF OUR OWN, for `switchRatings`' reason:
 * 6/16/20/32 is India's answer and 15/20 is the United States'. Filtering the
 * real list is what keeps this correct in a country nobody has thought about
 * yet, where hard-coding [16, 20, 32] would offer three ratings that are not
 * sold.
 *
 * AND IF THE FLOOR TAKES EVERYTHING, THE TOP ONE SURVIVES. A country whose
 * every rating is under 16 would otherwise come back with an empty list and a
 * control with nothing in it — which is worse than the honest answer, which is
 * that the biggest thing sold there is what an air-conditioner goes on.
 */
export function acRatings(country) {
  const all = [...(country?.switchRatings ?? [])].sort((a, b) => a - b);
  if (!all.length) return [];
  const over = all.filter((a) => a >= AC_MIN_A);
  return over.length ? over : [all[all.length - 1]];
}

/** The default rating in this country, which is 20 where 20 is sold. */
export function acAmpsFor(country) {
  const rs = acRatings(country);
  if (!rs.length) return AC_AMPS;
  return rs.includes(AC_AMPS) ? AC_AMPS : rs[0];
}

/**
 * HOW FAR CLEAR OF THE AC's BODY ITS SOCKET STANDS, in feet.
 *
 * ONE FOOT, MEASURED FROM THE BODY AND NOT FROM ITS CENTRE, which is the only
 * reading that survives a change of unit size: a metre-wide indoor unit and a
 * 1.4m one both want the socket a foot clear of the casing, and a figure
 * measured from the centre would bury the socket behind the larger one.
 *
 * AND IT IS CLEAR ON PURPOSE. The socket has to be reachable with the unit
 * mounted and the plug has to go in — a socket under the body is a socket an
 * installer moves on site, which makes the drawing wrong rather than tight.
 */
export const AC_SOCKET_CLEAR_FT = 1;

/* --- the wall, as this file needs it -------------------------------------- */

/** The walls of a host, as runs, one closed path and a scale. Built per call. */
const pathOf = (host) => {
  const runs = wallRuns(host.polygonPx, host.opts);
  return { runs, ...wallPath(runs), scale: roomScale(host.polygonPx) };
};

/** `s` wrapped into the path, so arithmetic round a corner cannot fall off it. */
const wrap = (s, total) => ((s % total) + total) % total;

/**
 * THE RUN A DISTANCE FALLS ON, AND WHERE ALONG IT.
 *
 * `segs[last]` IS THE FALLBACK AND NOT AN ERROR PATH. `find` misses only when
 * `s` lands exactly on `total`, which wrapping makes vanishingly rare and not
 * impossible; taking the last segment there is the same answer one bit earlier.
 */
const segAt = (segs, s) =>
  segs.find((g) => s >= g.s0 && s < g.s0 + g.length) ?? segs[segs.length - 1];

/**
 * A DISTANCE ROUND THE WALLS -> WHERE THAT IS, WHICH WAY THE WALL RUNS, AND
 * WHICH WAY IS INTO THE ROOM.
 *
 * `bodyPx` IS THE UNIT'S WIDTH AND IT IS WHAT MAKES THIS NOT `plateAtS`. A
 * plate is 230mm and keeps half of that plus a clearance off each corner; an
 * indoor unit is a metre, so the run it stands on has to be a metre long and
 * the clamp is half a METRE off each end. Handing the plate's own clamp a
 * different width would have been the cheaper edit and the wrong one: the
 * figure it keeps is a plate's clearance from a return, which an appliance
 * does not have.
 *
 * A RUN TOO SHORT TO HOLD THE BODY IS SKIPPED, exactly as `plateAtS` skips one
 * too short to hold a plate — and if NO run can hold it the unit is seated
 * anyway, centred on the longest, because refusing to draw something somebody
 * placed is worse than drawing it overhanging a short return by an inch.
 */
export function seatWallUnit(sFt, host, bodyPx = 0) {
  if (!host?.polygonPx?.length || !(host.pxPerFt > 0)) return null;
  const { runs, segs, total, scale } = pathOf(host);
  if (!runs.length || !(total > 0)) return null;

  const half = Math.max(0, bodyPx) / 2;
  const holds = segs.filter((g) => g.length >= bodyPx);
  const s = wrap((Number.isFinite(sFt) ? sFt : 0) * host.pxPerFt, total);
  const at = segAt(segs, s);
  /* THE NEXT RUN ROUND THE LOOP THAT CAN HOLD IT, which is `plateAtS`'s own
     rule: a seat that lands on a 300mm return does not refuse, it walks on to
     the next piece of plaster big enough and sits there. */
  const seg = holds.length
    ? (at.length >= bodyPx ? at : (holds.find((g) => g.s0 > at.s0) ?? holds[0]))
    : segs.reduce((b, g) => (!b || g.length > b.length ? g : b), null);

  const f = runFrame(seg.run, host.polygonPx, scale);
  const lo = Math.min(half, seg.length / 2);
  const t = Math.min(Math.max(s - seg.s0, lo), Math.max(lo, seg.length - lo));
  return {
    point: add(f.origin, mul(f.u, t)),
    along: f.u, inward: f.inward,
    /* THE ANGLE THE BODY IS DRAWN AT, and it is the wall's and nothing else.
       The canvas draws a rectangle `wFt` wide by `hFt` deep and then rotates it
       about its centre — see the `rect` branch in PlanCanvas — so the rotation
       that puts the unit's WIDTH along the plaster is the direction of the run.
       Measured off the frame rather than off the polygon's winding, because
       `runFrame` settles which way is into the room by testing. */
    rot: Math.atan2(f.u.y, f.u.x),
    wall: { a: seg.run.a, b: seg.run.b, index: seg.run.index },
    seg, t, s, total,
  };
}

/**
 * ...AND BACK: A POINTER -> THE DISTANCE NEAREST IT, IN FEET.
 *
 * THE PLACEMENT AND THE DRAG ARE ONE PROJECTION, which is the discipline
 * `nearestWallU` and `nearestLampPlate` both keep and for the same reason: the
 * gesture that decides where a unit may be DROPPED and the one that decides
 * where it may be DRAGGED have to give the same answer, and two copies of one
 * projection is how they stop agreeing.
 *
 * EVERY RUN THAT CAN HOLD THE BODY IS A CANDIDATE, and a run that cannot is not
 * — so dragging along a wall past a 300mm return does not park the unit on the
 * return, it carries on to the plaster beyond it.
 */
export function nearestWallUnitSFt(p, host, bodyPx = 0) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  if (!host?.polygonPx?.length || !(host.pxPerFt > 0)) return null;
  const { segs, total, scale } = pathOf(host);
  if (!(total > 0)) return null;
  const half = Math.max(0, bodyPx) / 2;
  const holds = segs.filter((g) => g.length >= bodyPx);
  const pool = holds.length ? holds : segs;

  let best = null;
  for (const seg of pool) {
    const f = runFrame(seg.run, host.polygonPx, scale);
    const lo = Math.min(half, seg.length / 2);
    const raw = dot(sub(p, f.origin), f.u);
    const t = Math.min(Math.max(raw, lo), Math.max(lo, seg.length - lo));
    const d = len(sub(p, add(f.origin, mul(f.u, t))));
    if (!best || d < best.d) best = { d, sFt: (seg.s0 + t) / host.pxPerFt };
  }
  return best ? best.sFt : null;
}

/**
 * ONE UNIT, RESOLVED — the store's record plus where it actually is.
 *
 * THE CENTRE IS OFF THE PLASTER BY HALF THE UNIT'S DEPTH, which is the one
 * piece of arithmetic that has to happen here rather than in the canvas: `sFt`
 * names a point ON the wall, and what the drawing wants is the centre of a body
 * standing against it. A body centred on the wall line would be drawn half
 * inside the wall and half in the next room.
 *
 * `null` FOR A UNIT WITH NOWHERE TO BE — a seated one whose room has gone. The
 * point primitive's third gate says a thing that cannot be placed cannot be
 * pressed, and a list quietly carrying a NaN would defeat it. @see manualCobs
 *
 * A UNIT THAT IS NOT SEATED IS HANDED BACK ITS OWN COORDINATE, untouched. That
 * is the whole of the compatibility story: an old plan's split units are free
 * boxes and go on behaving as free boxes, with their stored rotation.
 */
export function resolveWallUnitPx(o, host, pxPerFt) {
  if (!o || !(pxPerFt > 0)) return null;
  if (!isSeated(o)) {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
    return { x: o.x * pxPerFt, y: o.y * pxPerFt, rot: o.rot || 0, seat: null };
  }
  const seat = seatWallUnit(o.sFt, host, (o.wFt || 0) * pxPerFt);
  if (!seat) return null;
  const deep = ((o.hFt || 0) * pxPerFt) / 2;
  return {
    x: seat.point.x + seat.inward.x * deep,
    y: seat.point.y + seat.inward.y * deep,
    rot: seat.rot,
    seat,
  };
}

/**
 * WHERE THIS UNIT'S FEED SITS, as a distance round the same walls.
 *
 * TWO ANSWERS, AND THE FEED IS WHICH. A POINT goes BEHIND the unit, on the same
 * `sFt` it is centred on: the cable comes out of the plaster the body then
 * covers, which is exactly why a point is chosen over a socket — nothing shows.
 * A SOCKET goes a foot CLEAR of the casing, because a plug has to go into it
 * with the unit hanging there.
 *
 * WHICH SIDE THE SOCKET TAKES IS DECIDED BY THE WALL AND NOT BY A CONVENTION.
 * It goes on whichever side still has plaster: a unit set hard against a return
 * with four feet of wall the other way gets its socket on the four-foot side,
 * which is the only place an electrician would put it. Ties go clockwise, which
 * is arbitrary and only has to be consistent.
 *
 * AND IT IS AN ARC LENGTH, so a socket that does not fit on this run turns the
 * corner rather than falling off the end — the same property `plateAtS` relies
 * on and the reason both of these are `sFt` and not a coordinate.
 */
export function feedSFt(o, host, pxPerFt) {
  if (!o || !isSeated(o) || !(pxPerFt > 0)) return null;
  if (feedOf(o) === FEED_POINT) return o.sFt;
  const bodyPx = (o.wFt || 0) * pxPerFt;
  const seat = seatWallUnit(o.sFt, host, bodyPx);
  if (!seat) return null;
  const needPx = bodyPx / 2 + AC_SOCKET_CLEAR_FT * pxPerFt;
  /* HOW MUCH PLASTER IS LEFT EACH WAY ON THIS RUN, measured from where the
     unit actually ended up rather than from where it was asked for — the seat
     may have walked it onto another run entirely. */
  const ahead = seat.seg.length - seat.t;
  const behind = seat.t;
  const dir = ahead >= needPx ? 1 : (behind >= needPx ? -1 : (ahead >= behind ? 1 : -1));
  return wrap(seat.s + dir * needPx, seat.total) / pxPerFt;
}

/**
 * THE FLEX FROM A UNIT TO ITS SOCKET — two points, in plan pixels.
 *
 * AN AIR-CONDITIONER IS PLUGGED IN, and this is the line that says so. Without
 * it a unit and the socket a foot away are two marks that happen to be near
 * each other; the lead is what says the second is THERE BECAUSE OF the first,
 * which is the whole reason the socket was put where it was put.
 *
 * HERE AND NOT IN THE CANVAS, for the reason `nearestWallUnitSFt` is one
 * function rather than two: the drawing's idea of where the lead runs and the
 * rule's idea of where the socket is have to come from one expression, or a
 * change to `AC_SOCKET_CLEAR_FT` moves the socket and leaves the line behind.
 * It is also the half of this feature nobody can check by reading — see
 * tools/test-wall-unit.mjs, which drives it.
 *
 * FROM THE BODY'S NEAR EDGE AND NOT ITS CENTRE, so the flex leaves the casing
 * instead of appearing out of the middle of it; and TO THE PLATE'S MIDDLE,
 * which is where a flex actually lands on one.
 *
 * WHICH WAY IS ALONG THE WALL AND NOT ACROSS THE ROOM. The direction is decided
 * on the WALL LINE between the two seats, so a unit whose socket turned a corner
 * still gets a lead leaving the correct end of it.
 *
 * `null` WHERE THERE IS NOTHING TO DRAW — no seat, no plate, or a POINT feed.
 * That last one is not an omission: a point is centred behind the body, so the
 * lead would be a line from the unit to itself, and the absence of any visible
 * connection is the honest picture of a cable coming out of covered plaster.
 */
export function acLead(unitPx, platePx) {
  const seat = unitPx?.seat;
  if (!seat?.along || !platePx?.point || !platePx?.inward) return null;
  if (feedOf(unitPx) !== FEED_SOCKET) return null;
  const a = seat.along;
  const d = sub(platePx.point, seat.point);
  const dir = dot(d, a) >= 0 ? 1 : -1;
  const half = (unitPx.w || 0) / 2;
  return {
    from: { x: unitPx.x + a.x * dir * half, y: unitPx.y + a.y * dir * half },
    to: add(platePx.point, mul(platePx.inward, (platePx.deepPx || 0) / 2)),
  };
}
