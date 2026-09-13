// ---------------------------------------------------------------------------
// roomScale.js — the scale, taken off a room that states its own size.
//
// A LABEL INSIDE AN OUTLINE IS THE STRONGEST RULER ON THE SHEET, and the app
// already has both halves of it. `BEDROOM 18'-0" X 12'-0"` sits inside a
// polygon the room detector proposed on upload — and that detector runs BEFORE
// the scale is known, deliberately: see the header of useRoomRecognition, "a
// polygon is pixels, and pixels do not need a scale". So the outline is on
// screen, in pixels, at the moment this question is asked.
//
// WHY IT BEATS EVERY OTHER ROUTE: `18 X 12` IS TWO ESTIMATES, NOT ONE.
// One string gives px/ft twice — once against the room's width, once against
// its height — and the two must agree. That single division confirms, all at
// once, that the number was parsed correctly, that the text belongs to THIS
// room, and which way round the room is read. Nothing in the door route has a
// check like it: there, one detector box and one guess at 750-vs-900 are the
// whole of the evidence.
//
// WHAT IT CANNOT SEE, and it matters for the schedule. A stated `18'-0"` is
// almost always the CLEAR INTERNAL dimension, wall face to wall face, while the
// detector's polygon may sit on centrelines. On an 18ft room with 9in walls
// that is about 4% — one direction, every room, and invisible because the plan
// still looks right. It is not corrected here: the offset is constant across a
// sheet, so it shows up as a uniform disagreement against a chain, and solving
// for it wants evidence this module does not have on its own. `spread` in the
// verdict is what makes it visible.
//
// PURE. Pairs and polygons in, candidates out.
// ---------------------------------------------------------------------------

import { pointInPolygon, polygonArea } from '../../lib/geometry.js';
import { centreOf } from './dimText.js';

/** The two ratios from one label must agree this closely to be believed. */
export const AGREE_TOL = 0.04;
/** Below this the outline is not a rectangle and its extent is not its size. */
export const MIN_RECTANGULARITY = 0.86;

/**
 * A polygon's extent along its OWN axis, not along the page's.
 *
 * `outlineStats` uses an axis-aligned bounding box, which is right for what it
 * does and wrong here: a room on an angled wing has a box bigger than the room
 * in both directions, so both ratios come out low and a perfectly good label is
 * rejected for a reason that has nothing to do with the text.
 *
 * THE LONGEST EDGE SETS THE ANGLE. Rooms are overwhelmingly rectangular and
 * their longest wall is their orientation; a weighted circular mean over every
 * edge is more defensible in the abstract and less predictable in practice,
 * because a run of short jogs can outvote the wall that actually defines the
 * room.
 */
export function orientedExtent(pts) {
  if (!pts || pts.length < 3) return null;
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!best || d > best.d) best = { d, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  if (!best) return null;
  const c = Math.cos(best.ang), s = Math.sin(best.ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of pts) {
    const u = p.x * c + p.y * s;
    const v = -p.x * s + p.y * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const w = u1 - u0, h = v1 - v0;
  const area = Math.abs(polygonArea(pts));
  return { w, h, rot: best.ang, rectangularity: w * h > 0 ? area / (w * h) : 0 };
}

/**
 * One stated pair against one outline.
 *
 * BOTH PAIRINGS ARE TRIED because `18 X 12` does not say which way round it is
 * read, and a room drawn tall is as common as one drawn wide. The pairing whose
 * two ratios agree more closely is the right one — and if neither agrees, the
 * label does not belong to this outline and nothing is returned.
 */
export function matchPair(dim, ext) {
  if (!ext || !(ext.w > 0) || !(ext.h > 0)) return null;
  if (!(dim?.a > 0) || !(dim?.b > 0)) return null;

  const score = (fa, fb) => {
    const r1 = ext.w / fa, r2 = ext.h / fb;
    const mean = (r1 + r2) / 2;
    return { pxPerFt: mean, disagree: Math.abs(r1 - r2) / mean, r1, r2 };
  };
  const direct = score(dim.a, dim.b);
  const swapped = score(dim.b, dim.a);
  const best = direct.disagree <= swapped.disagree ? direct : swapped;
  const flipped = best === swapped;
  if (!(best.pxPerFt > 0) || best.disagree > AGREE_TOL) return null;
  return { ...best, flipped };
}

/**
 * Every stated room dimension that lands inside an outline, as candidates.
 *
 * `entries` are { line, dim } with dim.kind === 'pair'.
 * `outlines` are { id, pts } in the same pixel space as the text.
 */
export function roomCandidates(entries, outlines) {
  const out = [];
  const polys = (outlines || []).filter((o) => (o?.pts?.length ?? 0) >= 3);
  if (!polys.length) return out;

  // One outline may hold a name AND a size, and two different sizes inside one
  // room means one of them is not about that room — so the best-agreeing label
  // wins the outline rather than both being counted.
  const bestFor = new Map();
  for (const e of entries) {
    const c = centreOf(e.line);
    const host = polys.find((o) => pointInPolygon(c, o.pts));
    if (!host) continue;
    const ext = orientedExtent(host.pts);
    if (!ext || ext.rectangularity < MIN_RECTANGULARITY) continue;
    const m = matchPair(e.dim, ext);
    if (!m) continue;
    const prev = bestFor.get(host.id);
    if (!prev || m.disagree < prev.m.disagree) bestFor.set(host.id, { e, m, ext, host });
  }

  for (const { e, m, host } of bestFor.values()) {
    out.push({
      pxPerFt: m.pxPerFt,
      source: 'room',
      detail: `${e.dim.raw} in ${host.name || host.id}`,
      roomId: host.id,
      disagree: m.disagree,
      flipped: m.flipped,
    });
  }
  return out;
}
