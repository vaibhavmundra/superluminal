// ---------------------------------------------------------------------------
// roomBooleans.js — no two rooms may overlap.
//
// A segmenter does not know that rooms are disjoint. It hands back one mask per
// thing that looks like a room, and two of those routinely cover the same floor:
// an ensuite inside a bedroom, a utility inside a kitchen, or two masks that
// merged through a doorway and now share a strip. Left alone, the overlap is
// lit twice, counted twice in the lumens-per-square-foot, and exported as two
// polygons on top of each other.
//
// So the smaller room is subtracted from the larger. WHY A CELL GRID rather
// than a polygon clipper:
//
//   * everything downstream is rectilinear anyway. A general clipper's exact
//     answer would be squared up two stages later regardless, so the precision
//     buys nothing.
//   * a clipper's failure mode is a crash or a silently malformed ring on
//     touching or coincident edges — which is EXACTLY the input here, because
//     rooms share walls. A grid built from the polygons' own coordinates has no
//     degenerate case: every cell centre is strictly inside or strictly outside.
//   * it is fifty lines that can be read.
//
// The cost is that a diagonal edge becomes a staircase whose steps are as coarse
// as the coordinate spacing. That is why subtraction runs ONLY on the pair that
// actually overlaps, and only after simplification: an untouched room keeps its
// exact geometry, and a detected room is very nearly axis-aligned to begin with.
//
// THE HOLE. A room strictly inside another has a difference that is an annulus,
// and an annulus is not a simple polygon — there is nowhere for the planner to
// put it. Two things happen before we give up on that: coordinates are snapped
// so a mask that stopped three pixels short of a wall is treated as touching it
// (which is what almost every "interior" room really is), and failing that the
// caller is TOLD, so it can keep the outer room and mark the inner one as a
// no-light zone instead. Guessing a slit through the annulus would be inventing
// a wall that is not on the drawing.
// ---------------------------------------------------------------------------

import { bbox, polygonArea, pointInPolygon, ensureCCW, EPS } from './geometry.js';

export const BOOLEAN_DEFAULTS = {
  // Grid lines closer together than this are one line. Stops a one-pixel
  // difference between two masks' idea of a shared wall from becoming a
  // one-pixel sliver of room.
  mergePx: 0.75,
  // A ring smaller than this fraction of the outer room is debris from the
  // subtraction, not a piece of floor.
  minRingFrac: 0.02,
  // The most cells we will build. A pathological pair of 200-vertex masks would
  // otherwise be 40,000 point-in-polygon tests per cell.
  maxCells: 60_000,
};

const key = (p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

/** Sorted unique coordinates, with anything within `eps` treated as one. */
export function mergeCoords(values, eps) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1] > eps) out.push(v);
  }
  return out;
}

/**
 * Pull the points of `inner` onto `outer`'s coordinates where they are nearly
 * on them.
 *
 * This is the step that decides whether the common case works. A mask that
 * stops four pixels short of a wall is not an interior room — it is the same
 * room, badly outlined — and without this it produces a four-pixel ring of
 * floor around the ensuite, which is a hole, which cannot be represented. Snap
 * first and it shares the wall, and the difference is an ordinary L.
 *
 * It also aligns two siblings' idea of a shared wall, which is worth having for
 * its own sake.
 */
export function snapToward(inner, outer, tolPx) {
  if (!(tolPx > 0)) return inner;
  const xs = outer.map((p) => p.x), ys = outer.map((p) => p.y);
  const pull = (v, list) => {
    let best = v, bestD = tolPx;
    for (const c of list) {
      const d = Math.abs(c - v);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };
  return inner.map((p) => ({ x: pull(p.x, xs), y: pull(p.y, ys) }));
}

/**
 * How much of `b` lies inside `a`, as a fraction of b's area. Sampled on the
 * shared coordinate grid, so a shared wall does not read as an overlap.
 */
export function overlapFraction(a, b, opts = {}) {
  const eps = opts.mergePx ?? BOOLEAN_DEFAULTS.mergePx;
  const xs = mergeCoords([...a, ...b].map((p) => p.x), eps);
  const ys = mergeCoords([...a, ...b].map((p) => p.y), eps);
  if (xs.length < 2 || ys.length < 2) return 0;
  let inter = 0, bArea = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      if (!pointInPolygon(c, b)) continue;
      const area = (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      bArea += area;
      if (pointInPolygon(c, a)) inter += area;
    }
  }
  return bArea > 0 ? inter / bArea : 0;
}

/** The unshared edges of a kept-cell set, as directed segments. */
function boundarySegments(keep, xs, ys) {
  const nx = xs.length - 1, ny = ys.length - 1;
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : keep[i * ny + j]);
  const segs = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!keep[i * ny + j]) continue;
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
      // Wound so that the outside is always on the left of travel, which makes
      // every ring close without having to know which is body and which is hole.
      if (!at(i, j - 1)) segs.push([{ x: x0, y: y0 }, { x: x1, y: y0 }]);
      if (!at(i + 1, j)) segs.push([{ x: x1, y: y0 }, { x: x1, y: y1 }]);
      if (!at(i, j + 1)) segs.push([{ x: x1, y: y1 }, { x: x0, y: y1 }]);
      if (!at(i - 1, j)) segs.push([{ x: x0, y: y1 }, { x: x0, y: y0 }]);
    }
  }
  return segs;
}

/** Chain directed segments into closed rings. */
function chainRings(segs) {
  const byStart = new Map();
  for (const s of segs) {
    const k = key(s[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(s);
  }
  const rings = [];
  let guard = segs.length + 8;
  while (guard-- > 0) {
    let seed = null;
    for (const list of byStart.values()) if (list.length) { seed = list.pop(); break; }
    if (!seed) break;
    const ring = [seed[0]];
    let cur = seed[1];
    const startKey = key(seed[0]);
    let steps = segs.length + 8;
    while (steps-- > 0) {
      if (key(cur) === startKey) break;
      ring.push(cur);
      const list = byStart.get(key(cur));
      if (!list || !list.length) break;      // open chain: give up on this ring
      // At a pinch point two segments start here. Take the one that turns most
      // sharply, which is what keeps a figure-of-eight from being traced as one
      // ring through its own crossing.
      const from = { x: cur.x - ring[ring.length - 2 <= 0 ? 0 : ring.length - 2].x,
                     y: cur.y - ring[ring.length - 2 <= 0 ? 0 : ring.length - 2].y };
      let pick = 0;
      if (list.length > 1) {
        let best = -Infinity;
        list.forEach((s, idx) => {
          const to = { x: s[1].x - cur.x, y: s[1].y - cur.y };
          const cross = from.x * to.y - from.y * to.x;
          if (cross > best) { best = cross; pick = idx; }
        });
      }
      cur = list.splice(pick, 1)[0][1];
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function dropCollinear(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const same = (Math.abs(b.x - a.x) < EPS && Math.abs(b.y - a.y) < EPS);
    if (Math.abs(cross) > EPS && !same) out.push(b);
  }
  return out.length >= 4 ? out : pts;
}

/**
 * outer minus inners.
 *
 * Returns
 *   { ok: true,  pointsPx, holes: 0, pieces, droppedFrac, areaFrac }
 *   { ok: false, reason }                                        — nothing usable
 *   { ok: false, reason: 'hole', holes, pointsPx }               — an annulus:
 *       the body ring IS returned so a caller can see it, but it does not
 *       describe the room and must not be used as the outline. The caller is
 *       expected to keep the outer room and treat the inner as a no-light zone.
 */
export function subtractPolygons(outer, inners, opts = {}) {
  const o = { ...BOOLEAN_DEFAULTS, ...opts };
  const live = (inners || []).filter((p) => p && p.length >= 3);
  if (!outer || outer.length < 3) return { ok: false, reason: 'no outer polygon' };
  if (!live.length) return { ok: true, pointsPx: outer, holes: 0, pieces: 1, droppedFrac: 0, areaFrac: 1 };

  const snapped = o.snapPx ? live.map((p) => snapToward(p, outer, o.snapPx)) : live;
  const all = [outer, ...snapped];
  const xs = mergeCoords(all.flatMap((p) => p.map((q) => q.x)), o.mergePx);
  const ys = mergeCoords(all.flatMap((p) => p.map((q) => q.y)), o.mergePx);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return { ok: false, reason: 'degenerate grid' };
  if (nx * ny > o.maxCells) return { ok: false, reason: `${nx * ny} cells is too many to subtract` };

  const keep = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      if (!pointInPolygon(c, outer)) continue;
      let cut = false;
      for (const inn of snapped) if (pointInPolygon(c, inn)) { cut = true; break; }
      if (!cut) keep[i * ny + j] = 1;
    }
  }

  const outerArea = Math.abs(polygonArea(outer));
  const rings = chainRings(boundarySegments(keep, xs, ys))
    .map((r) => dropCollinear(r))
    .map((r) => ({ pts: r, area: Math.abs(polygonArea(r)) }))
    .filter((r) => r.area > outerArea * o.minRingFrac)
    .sort((a, b) => b.area - a.area);

  // CONSUMED, and told apart from a failure on purpose. "Nothing is left of this
  // room" is a correct answer that the caller acts on by dropping the room;
  // lumping it in with "the subtraction did not work" left a room holding
  // whatever it had before the last cut, still lying on top of another room.
  if (!rings.length) return { ok: false, reason: 'empty' };

  const body = rings[0];
  // A ring inside the body is a hole; a ring outside it is a separate piece the
  // subtraction cut off. They are different problems and only one is fatal.
  let holes = 0, pieces = 1, dropped = 0;
  for (const r of rings.slice(1)) {
    const c = centroid(r.pts);
    if (pointInPolygon(c, body.pts)) holes++;
    else { pieces++; dropped += r.area; }
  }

  const pointsPx = ensureCCW(body.pts);
  if (holes) {
    return { ok: false, reason: 'hole', holes, pointsPx,
             areaFrac: body.area / outerArea };
  }
  return {
    ok: true, pointsPx, holes: 0, pieces,
    droppedFrac: dropped / outerArea,
    areaFrac: body.area / outerArea,
  };
}

function centroid(pts) {
  const b = bbox(pts);
  const mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  // A bounding-box centre can fall outside an L. Walk to a point that does not.
  if (pointInPolygon(mid, pts)) return mid;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const m = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    for (const d of [[0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01]]) {
      const q = { x: m.x + d[0] * b.w, y: m.y + d[1] * b.h };
      if (pointInPolygon(q, pts)) return q;
    }
  }
  return mid;
}

/**
 * Make a set of rooms disjoint, largest first.
 *
 * LARGEST FIRST is the whole policy. A small room inside a big one is a real
 * room and the big one is the one whose boundary is wrong, so the big one gives
 * way — subtract the other way round and the ensuite disappears into the
 * bedroom, which is the answer nobody wants. It also means each room is only
 * ever eroded by rooms smaller than itself, so the operation terminates and the
 * order does not depend on which mask happened to be more confident.
 *
 * rooms: [{ pointsPx, ... }] — carried through untouched apart from pointsPx
 * and the fields added: `carved`, `enclosing`, `note`, and `dropped` for a room
 * that other rooms cover so completely there is nothing left to light. The
 * caller is expected to filter `dropped` out and report its `note`.
 */
export function disjoin(rooms, opts = {}) {
  const o = { ...BOOLEAN_DEFAULTS, minOverlapFrac: 0.02, minKeptFrac: 0.35, ...opts };
  const order = [...rooms]
    .map((r, i) => ({ r, i, area: Math.abs(polygonArea(r.pointsPx)) }))
    .sort((a, b) => b.area - a.area);

  const out = order.map(({ r }) => ({ ...r }));

  for (let a = 0; a < out.length; a++) {
    if (out[a].dropped) continue;
    const cut = [];
    for (let b = a + 1; b < out.length; b++) {
      if (out[b].dropped) continue;
      const frac = overlapFraction(out[a].pointsPx, out[b].pointsPx, o);
      if (frac > o.minOverlapFrac) cut.push({ idx: b, frac });
    }
    if (!cut.length) continue;

    // ONE AT A TIME, biggest bite first.
    //
    // Subtracting the lot in one call was simpler and wrong: a bedroom that
    // overlaps the hall by a strip AND has an ensuite in the middle of it fails
    // as a whole because of the ensuite, and the strip — which subtracts
    // perfectly well — is lost with it. Then the caller is handed BOTH rooms as
    // "enclosed" and lays a no-light zone over the hall, which is not inside it.
    //
    // Per-cut, each room that can be subtracted is, and only the ones that
    // genuinely cannot are reported. The cost is one grid per cut, and there are
    // never many.
    const originalArea = Math.abs(polygonArea(out[a].pointsPx));
    let current = out[a].pointsPx;
    const enclosing = [];
    const failed = [];
    let carved = 0, offcuts = 0, consumed = false;

    // EVERY SUBTRACTION THAT SUCCEEDS IS APPLIED. There used to be a per-cut
    // area guard here — refuse a subtraction that leaves too little — and it was
    // the subtlest bug in this file: a subtraction that worked but was rejected
    // on area fell through both branches below, so it was neither applied nor
    // recorded, and two rooms came out still overlapping with a note claiming
    // one had been subtracted. The guard belongs at the end, on the total, where
    // it can do something honest about it.
    for (const c of [...cut].sort((x, y) =>
        Math.abs(polygonArea(out[y.idx].pointsPx)) - Math.abs(polygonArea(out[x.idx].pointsPx)))) {
      const res = subtractPolygons(current, [out[c.idx].pointsPx], o);
      if (res.ok) {
        current = res.pointsPx;
        carved++;
        offcuts += Math.max(0, res.pieces - 1);
      } else if (res.reason === 'empty') {
        consumed = true;
        break;
      } else if (res.reason === 'hole') {
        enclosing.push(out[c.idx].pointsPx);
      } else {
        failed.push(res.reason);
      }
    }

    if (consumed) {
      out[a] = { ...out[a], dropped: true,
                 note: 'covered entirely by other rooms' };
      continue;
    }

    // What is left of a room that other rooms almost entirely cover is not a
    // room — it is a duplicate the overlap de-dup did not catch, or a mask over
    // a whole wing of the plan. DROPPED rather than kept: keeping it is the one
    // outcome that breaks the promise this module exists to make, because the
    // part that could not be subtracted is still lying on top of another room.
    const kept = Math.abs(polygonArea(current)) / Math.max(originalArea, 1e-9);
    if (kept < o.minKeptFrac) {
      out[a] = { ...out[a], dropped: true,
                 note: `${Math.round((1 - kept) * 100)}% of this room is covered by other rooms` };
      continue;
    }

    const notes = [];
    if (carved) notes.push(`${carved} room${carved > 1 ? 's' : ''} subtracted`);
    if (offcuts) notes.push(`${offcuts} offcut${offcuts > 1 ? 's' : ''} dropped`);
    if (enclosing.length) notes.push(`${enclosing.length} room${enclosing.length > 1 ? 's' : ''} sit${enclosing.length > 1 ? '' : 's'} wholly inside this one`);
    if (failed.length) notes.push(`could not be subtracted (${failed.join('; ')})`);

    out[a] = {
      ...out[a],
      pointsPx: current,
      carved,
      enclosing: enclosing.length ? enclosing : undefined,
      note: notes.join(', '),
    };
  }

  return out;
}
