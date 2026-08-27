// ---------------------------------------------------------------------------
// accentPlace.js — a box from the model becomes a fitting on the drawing.
//
// This is the half the model does not do. It hands back a rough region; this
// turns the region into something buildable, and every number involved is
// computed here from geometry rather than estimated there.
//
// THE STRIP IS WHY THIS FILE EXISTS. A sconce is a point, and a box round a
// point is almost the answer already. A strip is a LINE, and a box round a line
// says nothing about where the line starts or stops — circle the wall behind a
// TV and you have six feet of wall and no run.
//
// So the model is asked to box THE OBJECT the strip runs along — the TV unit,
// the wardrobe, the vanity — and the run is derived from that object's own
// extent. Project the object onto the wall it stands against, and the projection
// IS the run: it starts where the wardrobe starts and stops where it stops,
// because that is what the tape does. The two numbers nobody could estimate
// come out of the drawing for free.
//
// EVERYTHING IS AFFINE, so this works in plan pixels or in feet without caring
// which — the caller picks the space and the answer comes back in it.
//
// PURE. No React, no canvas, no fetch.
// ---------------------------------------------------------------------------

import { edges, pointInPolygon } from './geometry.js';
import { FURNITURE_BY_ID, MAX_ZONES } from './accentPrompt.js';

export const PLACE_DEFAULTS = {
  // How far a box may sit from a wall and still be taken as belonging to it,
  // as a fraction of the room's smaller dimension. A sconce box the model drew
  // a bit shy of the wall is ordinary; a box out in the middle of the floor is
  // a mistake, and snapping that one across the room would produce a confident
  // fitting on a wall nobody pointed at.
  maxWallDistFrac: 0.28,
  // A run shorter than this is not a strip, it is a rounding error.
  minRunFrac: 0.04,
  // How far past the end of a bed a bedside sconce sits, as a fraction of the
  // bed's own width along the wall. A bedside table is about a quarter of a
  // double bed's width, and the sconce goes over it. Expressed as a fraction
  // rather than in feet so this file stays unit-free: it works in plan pixels
  // and in feet without being told which.
  bedsideOffsetFrac: 0.24,
  // The same for a basin, where the pair sits much closer in — flanking the
  // mirror rather than standing off past the counter.
  basinOffsetFrac: 0.10,
  // The nominal box drawn round a derived sconce, as a fraction of the piece it
  // came from. Only for display and for the placement round-trip; the point is
  // what matters.
  sconceBoxFrac: 0.14,
  // Pull the ends in slightly: tape stops short of the carcass end in practice,
  // and a run drawn to the exact corner reads as a mistake on a drawing.
  endInsetFrac: 0.04,
};

const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p, v) => ({ x: p.x + v.x, y: p.y + v.y });
const mul = (v, k) => ({ x: v.x * k, y: v.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (v) => Math.hypot(v.x, v.y);

const corners = (r) => [
  { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
];
const centre = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

function distToSegment(p, a, b) {
  const d = sub(b, a), l2 = dot(d, d);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return len(sub(p, add(a, mul(d, t))));
}

/**
 * Which wall does this box belong to?
 *
 * Scored on the distance from the box's own nearest corner, not from its
 * centre. A wardrobe is a deep box: its centre can be three feet off the wall
 * it is pushed against while its back is touching, and centre-distance would
 * hand it to whichever wall the room happened to be narrow towards.
 */
export function nearestWall(rect, polygon) {
  const cs = corners(rect);
  const c = centre(rect);
  let best = null;
  edges(polygon).forEach(([a, b], i) => {
    if (len(sub(b, a)) < 1e-9) return;
    const d = Math.min(...cs.map((p) => distToSegment(p, a, b)));
    if (!best || d < best.dist) best = { a, b, index: i, dist: d, centreDist: distToSegment(c, a, b) };
  });
  return best;
}

/**
 * The wall a STRIP should be taken off — which is not simply the nearest one.
 *
 * A strip runs along the LONG side of the thing it is concealed in. A wardrobe
 * is eight feet of carcass and two feet of depth; the tape goes along the eight.
 *
 * Nearest-wall alone gets that wrong, and gets it wrong most often exactly where
 * furniture actually lives: in a corner. A wardrobe pushed into a corner touches
 * two walls at distance zero, the tie is broken by whichever edge the polygon
 * happens to list first, and half the time that is the short wall — so the run
 * comes out two feet long instead of eight, against a wall the wardrobe merely
 * brushes. It looks like a bad model and it is bad arithmetic.
 *
 * So: only walls running PARALLEL to the object's long axis are candidates, and
 * the nearest of those wins. Falls back to the plain nearest wall when none is
 * parallel — a diagonal wall, or a square object with no long axis to speak of —
 * because a run on the wrong axis still beats no run at all.
 */
export function wallForRun(rect, polygon) {
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  // Axis-aligned boxes and rectilinear rooms, so the long axis is x or y. A
  // near-square object has no meaningful long side; treat it as untied and let
  // distance decide, which is what the fallback does.
  const square = Math.abs(w - h) < Math.max(w, h) * 0.12;
  if (square) return nearestWall(rect, polygon);

  const longIsX = w > h;
  const cs = corners(rect);
  let best = null;
  edges(polygon).forEach(([a, b], i) => {
    const d = sub(b, a), L = len(d);
    if (L < 1e-9) return;
    // How much of this wall's direction lies along the object's long axis.
    const along = Math.abs(longIsX ? d.x / L : d.y / L);
    if (along < 0.7) return;                       // more across than along
    const dist = Math.min(...cs.map((p) => distToSegment(p, a, b)));
    if (!best || dist < best.dist) {
      best = { a, b, index: i, dist, centreDist: distToSegment(centre(rect), a, b) };
    }
  });
  return best || nearestWall(rect, polygon);
}

/** The room's smaller side, for scaling the tolerances above. */
function roomScale(polygon) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
}

/**
 * A box, a room -> the box's footprint expressed IN THE WALL'S OWN FRAME.
 *
 * `t0..t1` is the extent along the wall — where the object starts and stops.
 * `n0..n1` is how far off the wall it stands. That change of basis is the whole
 * trick: in the wall's frame a strip is an interval and a sconce is a number,
 * and both of them are things the drawing already knows.
 */
export function projectOntoWall(rect, wall) {
  const d = sub(wall.b, wall.a);
  const L = len(d);
  const u = { x: d.x / L, y: d.y / L };          // along the wall
  const nvec = { x: -u.y, y: u.x };              // off it
  const ts = [], ns = [];
  for (const p of corners(rect)) {
    const v = sub(p, wall.a);
    ts.push(dot(v, u));
    ns.push(dot(v, nvec));
  }
  return {
    u, n: nvec, origin: wall.a, wallLength: L,
    t0: Math.min(...ts), t1: Math.max(...ts),
    n0: Math.min(...ns), n1: Math.max(...ns),
  };
}

/**
 * Place one zone.
 *
 * Returns a `run` (two points) for a strip, a `point` for a sconce, or a
 * `rejected` reason. A rejection is a SENTENCE and not a silent drop: a box the
 * model put in the middle of the floor is a thing the user needs told, and the
 * alternative — snapping it to whichever wall happens to be nearest — is a
 * confident fitting nobody asked for.
 */
export function placeZone(zone, polygon, opts = {}) {
  const o = { ...PLACE_DEFAULTS, ...opts };
  const scale = roomScale(polygon);
  // A sconce goes on the wall its box straddles; a strip goes along the object's
  // long side, so the two ask different questions of the geometry. See
  // wallForRun.
  const wall = zone.type === 'strip'
    ? wallForRun(zone.rect, polygon)
    : nearestWall(zone.rect, polygon);
  if (!wall) return { ...zone, rejected: 'This room has no usable wall to place against.' };

  const maxDist = scale * o.maxWallDistFrac;
  if (wall.dist > maxDist) {
    return { ...zone, wall, rejected: zone.type === 'sconce'
      ? 'That box is out in the middle of the floor — a sconce has to be on a wall.'
      : 'That box is not against any wall, so there is no run to take off it.' };
  }

  const p = projectOntoWall(zone.rect, wall);

  if (zone.type === 'sconce') {
    // A sconce is a POINT ON THE WALL. The wall decides how far out, which is
    // not at all; the box decides where along.
    //
    // TWO WAYS OF SAYING WHERE ALONG, and the difference matters. A zone with a
    // `side` came from a rule and its box is the FURNITURE — so the point is a
    // fixed step past the furniture's own end, which is what "either side of
    // the bed" actually means and is symmetric by construction. A zone without
    // one is a bare box, and the middle of it is the best reading available.
    const t = zone.side
      ? (zone.side < 0
          ? p.t0 - (p.t1 - p.t0) * (zone.offsetFrac ?? o.bedsideOffsetFrac)
          : p.t1 + (p.t1 - p.t0) * (zone.offsetFrac ?? o.bedsideOffsetFrac))
      : (p.t0 + p.t1) / 2;
    const tc = Math.max(0, Math.min(p.wallLength, t));
    const point = add(p.origin, mul(p.u, tc));

    // WHICH WAY IS INTO THE ROOM. The wall's normal is perpendicular to it, but
    // whether it points inward or outward depends on the polygon's winding,
    // which nothing upstream guarantees. So it is tested rather than assumed:
    // step off the wall by a hair and see which side is inside.
    //
    // The symbol needs it. A wall fitting is drawn standing off its wall — the
    // stem touches the wall and the body sits in the room — and a symbol drawn
    // to the wrong side of the line ends up in the wall, or in next door.
    const eps = Math.max(1e-6, scale * 1e-3);
    const inward = pointInPolygon(add(point, mul(p.n, eps)), polygon)
      ? p.n : { x: -p.n.x, y: -p.n.y };
    // A nominal box round the derived point, so the canvas has something to
    // draw and the panel something to measure. The point is the answer.
    const half = Math.max((p.t1 - p.t0) * (o.sconceBoxFrac ?? 0.14), 1e-6);
    const a2 = add(add(p.origin, mul(p.u, tc - half)), mul(p.n, -half));
    const b2 = add(add(p.origin, mul(p.u, tc + half)), mul(p.n, half));
    const rect = zone.side ? {
      x0: Math.min(a2.x, b2.x), y0: Math.min(a2.y, b2.y),
      x1: Math.max(a2.x, b2.x), y1: Math.max(a2.y, b2.y),
    } : zone.rect;
    return { ...zone, rect, wall, point, t: tc, inward, along: p.u,
             clamped: Math.abs(tc - t) > 1e-9,
             alongWall: { t0: p.t0, t1: p.t1 } };
  }

  // A STRIP. The run is the object's own extent along the wall — which is the
  // pair of numbers a box could never give and an object always can.
  const raw = p.t1 - p.t0;
  if (raw < scale * o.minRunFrac) {
    return { ...zone, wall, rejected: 'That object is too short to run a strip along.' };
  }
  const inset = raw * o.endInsetFrac;
  const t0 = Math.max(0, p.t0 + inset);
  const t1 = Math.min(p.wallLength, p.t1 - inset);
  // Concealed against the object's face nearest the wall — behind the TV unit,
  // under the wardrobe — which is where tape actually goes.
  const off = Math.min(Math.abs(p.n0), Math.abs(p.n1));
  const at = (t) => add(add(p.origin, mul(p.u, t)), mul(p.n, off));
  return {
    ...zone, wall,
    run: [at(t0), at(t1)],
    runLength: t1 - t0,
    alongWall: { t0, t1 },
  };
}

/**
 * Place every zone, then make the pairs match.
 *
 * SYMMETRY IS ENFORCED AFTER THE FACT and it is not a nicety. Two sconces
 * either side of a bed are two independent boxes drawn by eye, so they snap to
 * two slightly different heights along the wall — and four inches out of line
 * is the single most visible failure this whole feature can produce. Nobody
 * looks at a drawing and checks whether a strip is the right length; everybody
 * sees a crooked pair.
 *
 * The rule is only applied to a pair on the SAME wall. Two sconces the model
 * grouped across different walls are not a mirror pair, whatever it called
 * them, and averaging their positions would put both of them somewhere neither
 * belongs.
 */
export function placeZones(zones, polygon, opts = {}) {
  const placed = zones.map((z) => placeZone(z, polygon, opts));

  const groups = new Map();
  for (const z of placed) {
    if (!z.group || z.rejected || !z.point) continue;
    if (!groups.has(z.group)) groups.set(z.group, []);
    groups.get(z.group).push(z);
  }
  for (const [, members] of groups) {
    if (members.length !== 2) continue;
    const [a, b] = members;
    if (a.wall.index !== b.wall.index) continue;
    // Same wall, so the same distance along it from either end: mirror them
    // about the midpoint of the pair.
    const mid = (a.t + b.t) / 2;
    const half = Math.abs(a.t - b.t) / 2;
    for (const [z, sign] of [[a, a.t <= b.t ? -1 : 1], [b, b.t < a.t ? -1 : 1]]) {
      const t = mid + sign * half;
      const p = projectOntoWall(z.rect, z.wall);
      z.t = t;
      z.point = add(p.origin, mul(p.u, t));
      z.along = p.u;
      z.mirrored = true;
    }
  }
  return placed;
}

// --- the house rules --------------------------------------------------------

/**
 * THE RULES, AS CODE.
 *
 * These were in the prompt, stated to the model, and trusted. That was the
 * mistake accentPrompt.js's header describes: it made "identify the furniture"
 * and "apply the rule" one indivisible act, so a model unsure about the first
 * silently declined to do the second, and a room that should have produced a
 * scheme produced nothing at all.
 *
 * Here they are deterministic. A wardrobe found is a strip, always. The model
 * never sees them and has no opportunity to exercise taste over them, which is
 * the point — a house style that varies run to run is not a house style.
 *
 * `emit` returns zone SPECS. Each is turned into a real fitting by placeZones
 * below, so a rule never has to know what a wall is.
 */
export const PLACEMENT_RULES = [
  {
    id: 1, see: 'bed', label: 'a bed',
    does: 'a sconce on both sides, as a symmetric pair',
    emit: (item, o) => flankingSconces(item, o.bedsideOffsetFrac, 'bedside', 'rule 1 — a bed'),
  },
  {
    id: 2, see: 'sofa', label: 'a sofa',
    does: 'nothing. Never a sconce beside a sofa',
    // The only prohibition, and the only rule that emits nothing. It is here
    // rather than absent so that a sofa on the plan produces a VISIBLE "seen,
    // and deliberately left alone" — an absence you can see is a decision, an
    // absence you cannot is a bug.
    emit: () => [],
  },
  {
    id: 3, see: 'basin', label: 'a bathroom basin',
    does: 'a sconce on both sides, as a symmetric pair',
    emit: (item, o) => flankingSconces(item, o.basinOffsetFrac, 'basin', 'rule 3 — a basin'),
  },
  {
    id: 4, see: 'tv_unit', label: 'a TV unit',
    does: 'an LED strip, and only a strip — never a sconce',
    emit: (item) => [{ type: 'strip', rect: item.rect, group: null,
                       what: 'the TV unit', why: 'rule 4 — a TV unit takes a strip and never a sconce' }],
  },
  {
    id: 5, see: 'wardrobe', label: 'a wardrobe',
    does: 'an LED strip',
    emit: (item) => [{ type: 'strip', rect: item.rect, group: null,
                       what: 'the wardrobe', why: 'rule 5 — a wardrobe takes a strip' }],
  },
];

export const RULE_BY_FURNITURE = Object.fromEntries(PLACEMENT_RULES.map((r) => [r.see, r]));

/**
 * A pair of sconces either side of a piece, derived from the piece itself.
 *
 * THIS IS WHY THE FURNITURE IS WORTH ASKING FOR. "A sconce on both sides of the
 * bed" is not something to eyeball — it is a bed rectangle, the wall its head
 * is against, and two points a fixed distance past either end of it. All three
 * are in the drawing already. The old version had the model draw those two
 * boxes, which meant two independent guesses that then had to be mirrored back
 * into line; this way they are symmetric by construction and the mirroring
 * pass has nothing left to correct.
 *
 * Emitted as small boxes straddling the wall rather than as finished points, so
 * they go through exactly the same placement and rejection path as everything
 * else. A bed floating in the middle of the room is then refused with the same
 * sentence, from the same code, instead of quietly producing two sconces on
 * whichever wall happened to be nearest.
 */
function flankingSconces(item, offsetFrac, group, why) {
  return [
    { type: 'sconce', side: -1, offsetFrac, rect: item.rect, group,
      what: `left of the ${FURNITURE_BY_ID[item.type]?.label.toLowerCase() ?? item.type}`, why },
    { type: 'sconce', side: +1, offsetFrac, rect: item.rect, group,
      what: `right of the ${FURNITURE_BY_ID[item.type]?.label.toLowerCase() ?? item.type}`, why },
  ];
}

/**
 * Furniture in, fittings out.
 *
 * Every piece is reported back whether it produced anything or not, under
 * `handled`, so the panel can say "sofa — seen, rule 2 says nothing" instead of
 * leaving a silence for the user to interpret. That reporting is most of the
 * reason the "it returns nothing" failure was hard to diagnose the first time.
 */
export function zonesFromFurniture(furniture, polygon, opts = {}) {
  const o = { ...PLACE_DEFAULTS, ...opts };
  const specs = [];
  const handled = [];

  for (const item of furniture) {
    const rule = RULE_BY_FURNITURE[item.type];
    if (!rule) { handled.push({ ...item, rule: null, emitted: 0 }); continue; }
    const made = rule.emit(item, o) || [];
    handled.push({ ...item, rule: rule.id, ruleDoes: rule.does, emitted: made.length });
    for (const m of made) {
      if (specs.length >= MAX_ZONES) break;
      specs.push({ ...m, from: item.type, confidence: item.confidence });
    }
  }

  return { zones: placeZones(specs, polygon, o), handled };
}

// --- editing what came back --------------------------------------------------
//
// The model's answer is a STARTING POINT, not a verdict. It reads the furniture
// off a plan and the rules turn that into fittings, and both of those steps are
// going to be wrong sometimes in ways only the person looking at the drawing can
// see — the wardrobe runs behind a beam, the bedside table is not where the plan
// says. So every fitting is editable, and an edited one is marked so nothing
// downstream tries to be helpful about it.
//
// BOTH GESTURES ARE ONE-DIMENSIONAL, and that is the whole design. A sconce
// mounts on a wall and a strip runs along one; neither can leave its wall
// without becoming a different thing. So a drag projects onto the wall's own
// line and slides along it, which means the fitting cannot be dragged into the
// middle of the room, cannot go crooked, and cannot come off the surface it is
// fixed to. You get exactly the freedom that exists in the real fitting.

const dotp = (a, b) => a.x * b.x + a.y * b.y;

/** Where a point falls along a wall, as a distance from the wall's start. */
export function alongWallAt(wall, p) {
  const d = sub(wall.b, wall.a), L = len(d);
  if (L < 1e-9) return { t: 0, L: 0, u: { x: 1, y: 0 } };
  const u = { x: d.x / L, y: d.y / L };
  return { t: dotp(sub(p, wall.a), u), L, u };
}

/** Slide a sconce along its own wall. Clamped to the wall's ends. */
export function slideSconceTo(zone, p) {
  // A REFUSED FITTING IS NOT EDITABLE GEOMETRY. It has a wall — that is how it
  // worked out it was too far from one — but it has no position, and letting a
  // drag give it one would resurrect a fitting the placement pass declined to
  // make, with none of the checks that would have applied.
  if (!zone?.wall || zone.rejected || !zone.point) return zone;
  const { t, L, u } = alongWallAt(zone.wall, p);
  const tc = Math.max(0, Math.min(L, t));
  const point = add(zone.wall.a, mul(u, tc));
  const { hw } = { hw: Math.max((zone.rect.x1 - zone.rect.x0) / 2, 1e-6) };
  return {
    ...zone, t: tc, point, edited: true,
    // A hand-moved sconce is no longer half of a symmetric pair — it is where
    // somebody put it. Clearing the flag stops the mirroring pass claiming
    // credit for a position it did not choose, and stops a later re-run
    // silently pulling it back.
    mirrored: false,
    rect: {
      x0: point.x - hw, y0: point.y - hw,
      x1: point.x + hw, y1: point.y + hw,
    },
  };
}

/**
 * Move one end of a strip run.
 *
 * `which` is 0 or 1. The end slides along the run's own line, so the run stays
 * straight and stays on its wall while its EXTENT becomes whatever you say —
 * which is the point: the derived length came off the furniture's footprint,
 * and the footprint is a guess at where the joinery actually ends.
 *
 * The two ends may not cross. Dragging one through the other pins it a hair
 * short instead, because a run of negative length is not a thing and a run that
 * silently flips its own direction is worse.
 */
export function setRunEnd(zone, which, p, { minLen = 0.35 } = {}) {
  if (!zone?.wall || zone.rejected || !zone.run) return zone;
  const { t, L, u } = alongWallAt(zone.wall, p);
  const other = alongWallAt(zone.wall, zone.run[which === 0 ? 1 : 0]).t;
  let tc = Math.max(0, Math.min(L, t));
  if (which === 0) tc = Math.min(tc, other - minLen);
  else tc = Math.max(tc, other + minLen);
  tc = Math.max(0, Math.min(L, tc));

  // Keep the run on the same offset off the wall it was placed at, so dragging
  // an end cannot quietly walk the tape off the joinery face it is concealed in.
  const off = zone.run[which];
  const base = alongWallAt(zone.wall, off);
  const perp = sub(off, add(zone.wall.a, mul(base.u, base.t)));

  const moved = add(add(zone.wall.a, mul(u, tc)), perp);
  const run = which === 0 ? [moved, zone.run[1]] : [zone.run[0], moved];
  return {
    ...zone, run, edited: true,
    runLength: Math.abs(alongWallAt(zone.wall, run[1]).t - alongWallAt(zone.wall, run[0]).t),
    alongWall: { t0: Math.min(tc, other), t1: Math.max(tc, other) },
  };
}
