// ---------------------------------------------------------------------------
// rooms.js — wall lines in, room polygons out.
//
// This is the part no library does for you. A DXF hands over a heap of
// unordered line segments; a room is a FACE of the planar graph those segments
// form, and getting from one to the other is four honest steps:
//
//   1. arrange   snap coincident endpoints, split every segment at every
//                crossing, and build a planar graph
//   2. close     bridge the door openings. A doorway is a GAP in the wall
//                line, and a gap means the free space of two rooms is one
//                region — the single reason naive face extraction returns one
//                enormous blob instead of a flat. See proposeBridges.
//   3. faces     walk the half-edges, always turning the same way, to trace
//                minimal cycles. Drop the outer face.
//   4. sift      a wall cavity is a face too, and so is a column, and so is
//                the gap inside a door jamb. Rooms are what survives.
//
// Everything here is in FEET and Y-up (DXF orientation). Nothing here knows
// about pixels, React, or the planner.
// ---------------------------------------------------------------------------

import { polygonArea, bbox, rectifyPolygon, pointInPolygon } from './geometry.js';

export const ROOM_DEFAULTS = {
  // Two points closer than this are the same point. 6mm: tighter than any
  // real drafting error, looser than floating-point noise from block
  // transforms.
  weldTol: 0.02,
  // A dangling wall end this close to another wall is sloppy drafting, not a
  // doorway — pull it over and join it. Kept SMALL, and kept collinear (see
  // maxWeldSkew): a generous reach welds the two faces of one wall to each
  // other across the cavity, which quietly swallows every doorway in the
  // drawing. 3 inches of slop, along the wall's own line, only.
  snapReach: 0.25,
  // How far off its own direction a wall may be extended to meet another. A
  // wall reaches along itself; it never reaches sideways.
  maxWeldSkew: (30 * Math.PI) / 180,
  // Door openings. Anything from a 2'0" WC door to a wide living/dining
  // opening. Above this a "gap" is more likely two unrelated wall ends.
  minGap: 1.2,
  maxGap: 7.0,
  // How far off straight a bridged gap may be. A door in a wall leaves two
  // collinear stubs; 35 degrees allows for splayed reveals and sloppy work
  // without inventing walls across a room.
  maxGapSkew: (35 * Math.PI) / 180,
  // What counts as a room once we have the faces.
  minRoomArea: 8.0,     // sqft
  minRoomSide: 1.8,     // ft — thicker than any wall, thinner than any corridor
  // Rectification, in feet rather than as a fraction of the room: predictable
  // across a 15 sqft WC and a 400 sqft hall alike.
  simplifyEps: 0.08,    // ft — jogs smaller than an inch are noise
  snapTol: 0.25,        // ft — walls within 3" of aligned are aligned
  // Sanity guard. A residential floor is a few thousand segments; far more
  // than this and we are being handed a whole site plan.
  maxSegments: 40000,
};

const EPS = 1e-9;

// --- a welded point set -----------------------------------------------------

/**
 * Point welding with a 3x3 cell sweep.
 *
 * Plain quantisation has a boundary bug: two points 1mm apart can straddle a
 * cell edge and never meet. Checking the neighbouring cells costs nine lookups
 * and removes the whole class of "the wall almost closed" failure.
 */
function makeWelder(tol) {
  const cell = Math.max(tol, 1e-9);
  const buckets = new Map();
  const pts = [];
  const key = (i, j) => i + ',' + j;
  return {
    pts,
    add(x, y) {
      const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const b = buckets.get(key(ci + di, cj + dj));
          if (!b) continue;
          for (const idx of b) {
            const p = pts[idx];
            if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return idx;
          }
        }
      }
      const idx = pts.length;
      pts.push({ x, y });
      const k = key(ci, cj);
      let b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(idx);
      return idx;
    },
  };
}

// --- splitting --------------------------------------------------------------

/** Uniform grid over segment bboxes, so we only test pairs that could meet. */
function spatialPairs(segs, cellSize) {
  const buckets = new Map();
  segs.forEach((s, i) => {
    const i0 = Math.floor(Math.min(s.x1, s.x2) / cellSize);
    const i1 = Math.floor(Math.max(s.x1, s.x2) / cellSize);
    const j0 = Math.floor(Math.min(s.y1, s.y2) / cellSize);
    const j1 = Math.floor(Math.max(s.y1, s.y2) / cellSize);
    for (let a = i0; a <= i1; a++) {
      for (let b = j0; b <= j1; b++) {
        const k = a + ',' + b;
        let arr = buckets.get(k);
        if (!arr) { arr = []; buckets.set(k, arr); }
        arr.push(i);
      }
    }
  });
  const seen = new Set();
  const out = [];
  for (const arr of buckets.values()) {
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        const lo = Math.min(arr[a], arr[b]), hi = Math.max(arr[a], arr[b]);
        const k = lo * 1e7 + hi;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([lo, hi]);
      }
    }
  }
  return out;
}

function paramOfPointOnSeg(s, px, py) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return null;
  const t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
  return { t, dist: Math.hypot(px - cx, py - cy) };
}

/**
 * Split every segment at every crossing and at every other segment's endpoint
 * that lands on it. The endpoint case is what catches T-junctions (one wall
 * butting into another) and collinear overlaps (the same wall drawn twice),
 * neither of which a plain line-line intersection finds.
 */
function splitSegments(segs, tol) {
  const box = segs.length ? bbox(segs.flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }])) : null;
  if (!box) return [];
  const diag = Math.hypot(box.w, box.h) || 1;
  const cellSize = Math.max(diag / 80, tol * 20);

  const cuts = segs.map(() => []);
  const addCut = (i, t) => { if (t > EPS && t < 1 - EPS) cuts[i].push(t); };

  for (const [i, j] of spatialPairs(segs, cellSize)) {
    const a = segs[i], b = segs[j];
    const rx = a.x2 - a.x1, ry = a.y2 - a.y1;
    const sx = b.x2 - b.x1, sy = b.y2 - b.y1;
    const denom = rx * sy - ry * sx;
    const aLen = Math.hypot(rx, ry), bLen = Math.hypot(sx, sy);
    if (aLen < EPS || bLen < EPS) continue;

    if (Math.abs(denom) > EPS * aLen * bLen) {
      const qx = b.x1 - a.x1, qy = b.y1 - a.y1;
      const t = (qx * sy - qy * sx) / denom;
      const u = (qx * ry - qy * rx) / denom;
      const ta = tol / aLen, tb = tol / bLen;
      if (t >= -ta && t <= 1 + ta && u >= -tb && u <= 1 + tb) {
        addCut(i, t);
        addCut(j, u);
      }
    }

    // Endpoint-on-segment, both directions. Covers T-junctions and the
    // collinear-overlap case the determinant test above skips.
    for (const [seg, idx, other] of [[a, i, b], [b, j, a]]) {
      for (const p of [{ x: other.x1, y: other.y1 }, { x: other.x2, y: other.y2 }]) {
        const r = paramOfPointOnSeg(seg, p.x, p.y);
        if (r && r.dist <= tol) addCut(idx, r.t);
      }
    }
  }

  const out = [];
  segs.forEach((s, i) => {
    const ts = [0, ...cuts[i], 1].sort((p, q) => p - q);
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < EPS) continue;
      const x1 = s.x1 + (s.x2 - s.x1) * t0, y1 = s.y1 + (s.y2 - s.y1) * t0;
      const x2 = s.x1 + (s.x2 - s.x1) * t1, y2 = s.y1 + (s.y2 - s.y1) * t1;
      if (Math.hypot(x2 - x1, y2 - y1) < tol) continue;
      out.push({ x1, y1, x2, y2, layer: s.layer, kind: s.kind });
    }
  });
  return out;
}

// --- the graph --------------------------------------------------------------

function buildGraph(segs, tol) {
  const welder = makeWelder(tol);
  const edgeSet = new Map();
  for (const s of splitSegments(segs, tol)) {
    const a = welder.add(s.x1, s.y1);
    const b = welder.add(s.x2, s.y2);
    if (a === b) continue;
    const k = Math.min(a, b) + '-' + Math.max(a, b);
    if (!edgeSet.has(k)) edgeSet.set(k, { a, b, kind: s.kind || 'wall' });
  }
  const nodes = welder.pts;
  const edges = [...edgeSet.values()];
  const adj = nodes.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
  return { nodes, edges, adj };
}

const other = (e, n) => (e.a === n ? e.b : e.a);

function dangleNodes(graph) {
  const out = [];
  graph.adj.forEach((list, n) => { if (list.length === 1) out.push(n); });
  return out;
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy, tol) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const denom = rx * sy - ry * sx;
  const aLen = Math.hypot(rx, ry), bLen = Math.hypot(sx, sy);
  if (aLen < EPS || bLen < EPS) return false;
  if (Math.abs(denom) <= EPS * aLen * bLen) return false;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  const ta = tol / aLen, tb = tol / bLen;
  // Strictly interior on the bridge, so touching a wall at its own endpoint
  // does not count as crossing it.
  return t > ta && t < 1 - ta && u > -tb && u < 1 + tb;
}

/**
 * Bridge the gaps.
 *
 * Two kinds, in this order:
 *   a) DRAFTING SLOP — a wall end that stops a few inches short of another
 *      wall. Pulled over and joined. This is not a doorway and must not be
 *      treated as one, or the room leaks through it.
 *   b) DOORWAYS — a pair of dangling ends facing each other across a
 *      door-width gap, with the wall continuing more or less straight through.
 *      Scored on length and straightness, matched greedily best-first.
 *
 * A bridge that would cross existing line work is rejected outright: that is
 * the check that stops a "gap" being closed straight across a room.
 */
function proposeBridges(graph, opts, hints) {
  const { nodes, edges, adj } = graph;
  const tol = opts.weldTol;
  const bridges = [];
  const used = new Set();

  const wallDirAt = (n) => {
    const e = edges[adj[n][0]];
    const m = other(e, n);
    const d = { x: nodes[n].x - nodes[m].x, y: nodes[n].y - nodes[m].y };
    const len = Math.hypot(d.x, d.y) || 1;
    return { x: d.x / len, y: d.y / len };
  };

  const crossesAnything = (p, q, skipA, skipB) => {
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.a === skipA || e.b === skipA || e.a === skipB || e.b === skipB) continue;
      if (segmentsCross(p.x, p.y, q.x, q.y, nodes[e.a].x, nodes[e.a].y, nodes[e.b].x, nodes[e.b].y, tol)) return true;
    }
    return false;
  };

  const dangles = dangleNodes(graph);

  // (a) drafting slop: extend a dangling end onto a wall it nearly touches.
  //
  // The reach must be BOTH short and along the wall's own direction. Without
  // the direction test, the two parallel faces of a single wall are within
  // reach of each other, so every wall welds itself shut across its cavity and
  // the doorways in it stop being gaps at all. A wall extends along itself.
  for (const n of dangles) {
    const dir = wallDirAt(n);
    let best = null;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.a === n || e.b === n) continue;
      const r = paramOfPointOnSeg(
        { x1: nodes[e.a].x, y1: nodes[e.a].y, x2: nodes[e.b].x, y2: nodes[e.b].y },
        nodes[n].x, nodes[n].y);
      if (!r) continue;
      const t = Math.max(0, Math.min(1, r.t));
      const px = nodes[e.a].x + (nodes[e.b].x - nodes[e.a].x) * t;
      const py = nodes[e.a].y + (nodes[e.b].y - nodes[e.a].y) * t;
      const d = Math.hypot(nodes[n].x - px, nodes[n].y - py);
      if (d > opts.snapReach || d <= tol) continue;
      const skew = Math.acos(Math.max(-1, Math.min(1,
        ((px - nodes[n].x) / d) * dir.x + ((py - nodes[n].y) / d) * dir.y)));
      if (skew > opts.maxWeldSkew) continue;
      if (!best || d < best.d) best = { d, px, py, skew };
    }
    if (best) {
      bridges.push({ x1: nodes[n].x, y1: nodes[n].y, x2: best.px, y2: best.py,
                     kind: 'weld', lengthFt: best.d, skewDeg: (best.skew * 180) / Math.PI });
      used.add(n);
    }
  }

  // (b) doorways.
  const cands = [];
  const open = dangles.filter((n) => !used.has(n));
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const A = open[i], B = open[j];
      const p = nodes[A], q = nodes[B];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < opts.minGap || d > opts.maxGap) continue;

      const bridgeDir = { x: (q.x - p.x) / d, y: (q.y - p.y) / d };
      const da = wallDirAt(A), db = wallDirAt(B);
      // The wall should continue THROUGH the gap: at A the wall points the way
      // the bridge goes, at B it points back the way it came.
      const skewA = Math.acos(Math.max(-1, Math.min(1, da.x * bridgeDir.x + da.y * bridgeDir.y)));
      const skewB = Math.acos(Math.max(-1, Math.min(1, -(db.x * bridgeDir.x + db.y * bridgeDir.y))));
      if (skewA > opts.maxGapSkew || skewB > opts.maxGapSkew) continue;
      if (crossesAnything(p, q, A, B)) continue;

      // A door swing arc is strong evidence this really is a doorway rather
      // than two coincidentally facing wall ends.
      //
      // The arc is centred on the HINGE, which sits at one jamb — about half a
      // door width from the middle of the gap, plus the wall's own offset. And
      // a door swing has the radius of the door it swings, so an arc whose
      // radius matches the gap is the real confirmation. Testing the hinge
      // against the jamb node instead (the obvious thing) never matches:
      // the jamb node is on the wall FACE, the hinge is on its centreline.
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      const doorish = hints.doorCentres.some((c) => {
        if (Math.hypot(c.x - mx, c.y - my) > d / 2 + 0.75) return false;
        return c.r == null || Math.abs(c.r - d) < 1.5;
      });

      const skew = (skewA + skewB) / 2;
      cands.push({ A, B, d, skew, doorish,
                   score: d * (1 + 3 * skew) * (doorish ? 0.5 : 1) });
    }
  }
  cands.sort((x, y) => x.score - y.score);
  for (const c of cands) {
    if (used.has(c.A) || used.has(c.B)) continue;
    used.add(c.A); used.add(c.B);
    bridges.push({
      x1: nodes[c.A].x, y1: nodes[c.A].y, x2: nodes[c.B].x, y2: nodes[c.B].y,
      kind: c.doorish ? 'door' : 'opening',
      lengthFt: c.d, skewDeg: (c.skew * 180) / Math.PI,
    });
  }
  return bridges;
}

/** Strip dangling edges: dimension leaders, stray marks, hatch tails. */
function pruneDangles(graph) {
  const dead = new Set();
  let removed = 0;
  for (;;) {
    let any = false;
    const deg = graph.nodes.map(() => 0);
    graph.edges.forEach((e, i) => {
      if (dead.has(i)) return;
      deg[e.a]++; deg[e.b]++;
    });
    graph.edges.forEach((e, i) => {
      if (dead.has(i)) return;
      if (deg[e.a] === 1 || deg[e.b] === 1) { dead.add(i); removed++; any = true; }
    });
    if (!any) break;
  }
  const edges = graph.edges.filter((_, i) => !dead.has(i));
  const adj = graph.nodes.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
  return { graph: { nodes: graph.nodes, edges, adj }, removed };
}

// --- faces ------------------------------------------------------------------

/**
 * Trace the minimal cycles of the planar graph.
 *
 * At each node we arrive along an edge and leave along the FIRST edge
 * clockwise from the one we came in on. Turning the same way every time traces
 * minimal faces; interior faces come out counterclockwise (positive shoelace
 * area with Y up) and the outer face of each component comes out clockwise.
 * That sign is how the outer face is identified — no point-in-polygon needed.
 */
export function extractFaces(graph) {
  const { nodes, edges, adj } = graph;
  // outgoing half-edges per node, sorted by angle
  const outgoing = nodes.map(() => []);
  edges.forEach((e, i) => {
    outgoing[e.a].push({ to: e.b, edge: i, angle: Math.atan2(nodes[e.b].y - nodes[e.a].y, nodes[e.b].x - nodes[e.a].x) });
    outgoing[e.b].push({ to: e.a, edge: i, angle: Math.atan2(nodes[e.a].y - nodes[e.b].y, nodes[e.a].x - nodes[e.b].x) });
  });
  for (const list of outgoing) list.sort((a, b) => a.angle - b.angle);

  const indexAt = new Map();   // "from>to" -> position in outgoing[from]
  outgoing.forEach((list, n) => list.forEach((h, k) => indexAt.set(n + '>' + h.to, k)));

  const visited = new Set();
  const faces = [];
  const guard = edges.length * 4 + 16;

  for (const startNode of nodes.keys()) {
    for (const h of outgoing[startNode]) {
      const startKey = startNode + '>' + h.to;
      if (visited.has(startKey)) continue;
      const cycle = [];
      let from = startNode, to = h.to;
      let steps = 0;
      for (;;) {
        const key = from + '>' + to;
        if (visited.has(key)) break;
        visited.add(key);
        cycle.push(from);
        // leave `to` along the first edge clockwise from the way we came
        const list = outgoing[to];
        const back = indexAt.get(to + '>' + from);
        if (back === undefined || !list.length) break;
        const next = list[(back - 1 + list.length) % list.length];
        from = to;
        to = next.to;
        if (from === startNode && to === h.to) break;
        if (++steps > guard) break;
      }
      if (cycle.length >= 3) faces.push(cycle.map((n) => ({ x: nodes[n].x, y: nodes[n].y })));
    }
  }
  return faces;
}

// --- the public call --------------------------------------------------------

/**
 * Find the rooms.
 *
 * `segments` are wall lines in feet, Y-up. Returns the rooms plus a full
 * account of what was thrown away and why — because the honest answer to "why
 * didn't it find my kitchen" is a diagnostic, not a shrug.
 */
export function findRooms(segments, options = {}, hintsIn = {}) {
  const opts = { ...ROOM_DEFAULTS, ...options };
  const hints = { doorCentres: [], texts: [], ...hintsIn };

  if (!segments?.length) {
    return { ok: false, reason: 'No wall lines on the chosen layers.', rooms: [], diagnostics: null };
  }
  if (segments.length > opts.maxSegments) {
    return { ok: false, reason: `That is ${segments.length.toLocaleString()} line segments — more than this can arrange. Narrow the wall layers, or trim the drawing to one floor.`, rooms: [], diagnostics: null };
  }

  // 1. arrange
  const first = buildGraph(segments, opts.weldTol);
  // 2. close the gaps, then re-arrange with the bridges in place
  const bridges = proposeBridges(first, opts, hints);
  const graph2 = bridges.length
    ? buildGraph([...segments, ...bridges.map((b) => ({ ...b, kind: b.kind }))], opts.weldTol)
    : first;
  // 3. prune what cannot bound anything, then trace faces
  const { graph, removed } = pruneDangles(graph2);
  const faces = extractFaces(graph);

  // 4. sift
  const dropped = { outer: 0, tiny: 0, sliver: 0, degenerate: 0 };
  const rooms = [];
  for (const face of faces) {
    if (face.length < 3) { dropped.degenerate++; continue; }
    const signed = polygonArea(face);
    if (signed <= 0) { dropped.outer++; continue; }   // clockwise == outer face
    const area = signed;
    if (area < opts.minRoomArea) { dropped.tiny++; continue; }
    const b = bbox(face);
    if (Math.min(b.w, b.h) < opts.minRoomSide) { dropped.sliver++; continue; }

    const polygon = rectifyPolygon(face, { simplifyEps: opts.simplifyEps, snapTol: opts.snapTol });
    const rb = bbox(polygon);
    rooms.push({
      polygonRaw: face,
      polygon,
      areaSqft: Math.abs(polygonArea(polygon)),
      rawAreaSqft: area,
      bbox: rb,
      widthFt: rb.w,
      heightFt: rb.h,
      centroid: { x: (rb.minX + rb.maxX) / 2, y: (rb.minY + rb.maxY) / 2 },
    });
  }

  rooms.sort((a, b) => b.areaSqft - a.areaSqft);
  rooms.forEach((r, i) => { r.id = i + 1; r.label = labelFor(r, hints.texts); });

  return {
    ok: rooms.length > 0,
    reason: rooms.length ? '' : reasonForNoRooms(dropped, bridges, faces.length),
    rooms,
    diagnostics: {
      segmentsIn: segments.length,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      facesFound: faces.length,
      danglesPruned: removed,
      bridges,
      bridgeCounts: {
        weld: bridges.filter((b) => b.kind === 'weld').length,
        door: bridges.filter((b) => b.kind === 'door').length,
        opening: bridges.filter((b) => b.kind === 'opening').length,
      },
      dropped,
    },
  };
}

function reasonForNoRooms(dropped, bridges, faces) {
  if (!faces) return 'Those lines never close into a loop — nothing encloses a room. Check that the wall layers are the right ones.';
  if (dropped.sliver && !dropped.tiny) return 'Every enclosed area found was thinner than a corridor — that usually means the wall layers selected are hatching or dimension lines rather than walls.';
  if (dropped.tiny) return 'The enclosed areas found were all too small to be rooms. If this drawing is in different units, set them above.';
  return 'Found enclosed areas but none of them look like rooms. Try adding a layer, or widening the door-gap limit if the openings are unusually wide.';
}

/**
 * Name a room from the drawing's own text.
 *
 * Dimension strings sit inside rooms too, so anything that is mostly digits,
 * feet-and-inches marks or a bare area figure is rejected. Of what is left the
 * biggest text wins, because that is the convention every draughtsman uses.
 */
function labelFor(room, texts) {
  if (!texts?.length) return null;
  const inside = texts.filter((t) => pointInPolygon({ x: t.x, y: t.y }, room.polygon));
  if (!inside.length) return null;
  const wordy = inside.filter((t) => {
    const s = t.text.trim();
    if (s.length < 3) return false;
    const letters = (s.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) return false;
    if (/^[\d\s'"×x.,\-\/]+$/.test(s)) return false;             // 12'-6" x 10'-0"
    if (/^\d[\d\s.,]*(sq|sft|sqft|m2|sqm)\b/i.test(s)) return false; // 148 SQFT
    return letters / s.length > 0.4;
  });
  const pool = wordy.length ? wordy : [];
  if (!pool.length) return null;
  pool.sort((a, b) => (b.h || 0) - (a.h || 0));
  return pool[0].text.replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Door-swing arcs, as hints for gap bridging. A door leaf is 2-4 ft. */
export function doorHints(drawing) {
  const f = drawing.units.toFeet;
  const centres = [];
  for (const a of drawing.arcs || []) {
    const r = a.r * f;
    if (r >= 1.8 && r <= 4.5) centres.push({ x: a.cx * f, y: a.cy * f, r });
  }
  for (const ins of drawing.inserts || []) {
    if (/door|shutter/i.test(ins.name)) centres.push({ x: ins.x * f, y: ins.y * f, r: null });
  }
  return centres;
}

/** Text entities in feet, for room naming. */
export function textHints(drawing) {
  const f = drawing.units.toFeet;
  return (drawing.texts || []).map((t) => ({ x: t.x * f, y: t.y * f, h: (t.h || 0) * f, text: t.text }));
}
