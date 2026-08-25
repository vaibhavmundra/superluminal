// ---------------------------------------------------------------------------
// chunking.js — the room minus its no-light zones, decomposed into rectangles.
//
// There is never exactly one right answer here. An L-shaped room can be cut
// into two rectangles two different ways; a room with a duct through the middle
// has half a dozen readings, and which one is right depends on how the space is
// actually used — something the geometry does not know and the person standing
// in the room does.
//
// So this module does not decide. It ENUMERATES: several genuinely different
// decompositions of the same space, each measured, each explainable. The caller
// (today a human clicking a card, tomorrow a model) picks one, and only then
// does planner.js lay a grid and place lights inside it.
//
// Pipeline
//   elementaryGrid   — wall lines and zone edges define a grid on which every
//                      cell is wholly free or wholly blocked, never partial
//   strategies       — each turns that grid into a set of rectangles by its own
//                      rule (biggest first, sliced vertically, squarest, ...)
//   mergePass        — two rectangles that together form one rectangle are one
//   dedupe           — strategies that landed on the same answer collapse
//   metrics + rank   — every option is measured, the field is compared, and one
//                      is recommended. Recommended, not imposed.
//
// Dependency direction is one-way: chunking -> geometry. Nothing here imports
// the planner, so the whole enumeration is testable in isolation and the
// planner can be handed a configuration from anywhere.
// ---------------------------------------------------------------------------

import { bbox, pointInPolygon } from './geometry.js';

const EPS = 1e-6;
const R6 = (v) => Math.round(v * 1e6) / 1e6;

// --- no-light zones ---------------------------------------------------------

/** Put a rectangle's corners in canonical order, whatever way it was dragged. */
export function normalizeZone(z) {
  return {
    x0: Math.min(z.x0, z.x1), x1: Math.max(z.x0, z.x1),
    y0: Math.min(z.y0, z.y1), y1: Math.max(z.y0, z.y1),
  };
}

export function pointInZone(p, z, pad = 0) {
  return p.x > z.x0 - pad && p.x < z.x1 + pad && p.y > z.y0 - pad && p.y < z.y1 + pad;
}

export function inAnyZone(p, zones, pad = 0) {
  for (const z of zones) if (pointInZone(p, z, pad)) return true;
  return false;
}

/** Drop zones too thin to matter and put the rest in canonical order. */
export function prepareZones(noLightZones = []) {
  return noLightZones.map(normalizeZone)
    .filter((z) => z.x1 - z.x0 > 0.1 && z.y1 - z.y0 > 0.1);
}

// --- the elementary grid ----------------------------------------------------

/**
 * Every wall line and every zone edge, crossed. Because the room is
 * rectilinear and all of its edges lie on those very lines, each resulting
 * elementary cell is either wholly inside the free space or wholly outside it —
 * never partial. That is what makes an exact rectangular cover possible at all.
 */
export function elementaryGrid(polygon, zones = []) {
  const box = bbox(polygon);
  const xs = new Set(), ys = new Set();
  for (const p of polygon) { xs.add(R6(p.x)); ys.add(R6(p.y)); }
  for (const z of zones) {
    for (const v of [z.x0, z.x1]) if (v > box.minX + EPS && v < box.maxX - EPS) xs.add(R6(v));
    for (const v of [z.y0, z.y1]) if (v > box.minY + EPS && v < box.maxY - EPS) ys.add(R6(v));
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const nx = X.length - 1, ny = Y.length - 1;
  const free = [];
  let freeArea = 0;
  for (let i = 0; i < Math.max(nx, 0); i++) {
    free.push([]);
    for (let j = 0; j < ny; j++) {
      const c = { x: (X[i] + X[i + 1]) / 2, y: (Y[j] + Y[j + 1]) / 2 };
      const ok = pointInPolygon(c, polygon) && !inAnyZone(c, zones) ? 1 : 0;
      free[i].push(ok);
      if (ok) freeArea += (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]);
    }
  }
  return { X, Y, nx, ny, free, freeArea, box, empty: nx < 1 || ny < 1 };
}

function rectOf(grid, i0, i1, j0, j1) {
  const x0 = grid.X[i0], x1 = grid.X[i1], y0 = grid.Y[j0], y1 = grid.Y[j1];
  return { i0, i1, j0, j1, x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, area: (x1 - x0) * (y1 - y0) };
}

// --- decomposition primitives ----------------------------------------------

/**
 * Repeatedly claim the highest-scoring all-free rectangle until nothing is
 * left. `score` is the whole personality of a strategy: score by area and you
 * get the boldest possible pieces, score by area-times-squareness and you get
 * pieces whose own grids come out square.
 *
 * Every maximal free rectangle is enumerated (each has a free top-left anchor),
 * so the choice is over the real candidate set, not a sampled one.
 */
export function greedyDecompose(grid, score) {
  const { nx, ny, free } = grid;
  const claimed = free.map((col) => col.map(() => false));
  const isFree = (i, j) => free[i][j] === 1 && !claimed[i][j];
  const out = [];
  for (;;) {
    let best = null, bestScore = -Infinity;
    for (let i0 = 0; i0 < nx; i0++) {
      for (let j0 = 0; j0 < ny; j0++) {
        if (!isFree(i0, j0)) continue;
        let jMax = ny;   // the widest usable row-span shrinks as we extend right
        for (let i1 = i0; i1 < nx; i1++) {
          let j1 = j0;
          while (j1 < jMax && isFree(i1, j1)) j1++;
          jMax = j1;
          if (jMax === j0) break;
          const r = rectOf(grid, i0, i1 + 1, j0, jMax);
          const s = score(r);
          if (s > bestScore + 1e-12) { bestScore = s; best = r; }
        }
      }
    }
    if (!best) break;
    for (let i = best.i0; i < best.i1; i++) for (let j = best.j0; j < best.j1; j++) claimed[i][j] = true;
    out.push(best);
  }
  return out;
}

/**
 * Slice the space one way and one way only: 'v' takes full-height runs down
 * each column and merges columns whose runs match exactly; 'h' does the same
 * transposed. This is the decomposition a person draws by hand when they say
 * "just cut it into bays" — and for many rooms it is also the one with the
 * fewest pieces, because a single sweep never leaves an offcut.
 */
export function slabDecompose(grid, axis /* 'v' | 'h' */) {
  const { nx, ny, free } = grid;
  const vertical = axis === 'v';
  const A = vertical ? nx : ny;          // the axis we sweep along
  const B = vertical ? ny : nx;          // the axis a run extends along
  const at = vertical ? (a, b) => free[a][b] === 1 : (a, b) => free[b][a] === 1;
  const claimed = Array.from({ length: A }, () => new Array(B).fill(false));
  const out = [];
  for (let a = 0; a < A; a++) {
    let b = 0;
    while (b < B) {
      if (!at(a, b) || claimed[a][b]) { b++; continue; }
      let b1 = b;
      while (b1 < B && at(a, b1) && !claimed[a][b1]) b1++;
      // extend across the sweep axis, but only while the neighbour's run is
      // EXACTLY this run — a neighbour whose run is longer belongs to its own
      // piece, and splitting it here would just make an arbitrary seam
      let a1 = a + 1;
      while (a1 < A) {
        let ok = true;
        for (let k = b; k < b1 && ok; k++) if (!at(a1, k) || claimed[a1][k]) ok = false;
        if (!ok) break;
        if (b > 0 && at(a1, b - 1) && !claimed[a1][b - 1]) break;
        if (b1 < B && at(a1, b1) && !claimed[a1][b1]) break;
        a1++;
      }
      for (let aa = a; aa < a1; aa++) for (let k = b; k < b1; k++) claimed[aa][k] = true;
      out.push(vertical ? rectOf(grid, a, a1, b, b1) : rectOf(grid, b, b1, a, a1));
      b = b1;
    }
  }
  return out;
}

/**
 * Two rectangles that share a full edge and together form one rectangle are
 * one rectangle. Repeat until nothing merges. This never changes what is
 * covered — only how many pieces cover it — so it is always an improvement,
 * and it is what turns a column-by-column sweep into clean bays.
 */
export function mergePass(grid, rects) {
  const list = rects.map((r) => ({ ...r }));
  for (let guard = 0; guard < 4000; guard++) {
    let did = false;
    search:
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const p = list[a], q = list[b];
        const sameCols = p.i0 === q.i0 && p.i1 === q.i1;
        const sameRows = p.j0 === q.j0 && p.j1 === q.j1;
        if (sameCols && (p.j1 === q.j0 || q.j1 === p.j0)) {
          const merged = rectOf(grid, p.i0, p.i1, Math.min(p.j0, q.j0), Math.max(p.j1, q.j1));
          list.splice(b, 1); list[a] = merged; did = true; break search;
        }
        if (sameRows && (p.i1 === q.i0 || q.i1 === p.i0)) {
          const merged = rectOf(grid, Math.min(p.i0, q.i0), Math.max(p.i1, q.i1), p.j0, p.j1);
          list.splice(b, 1); list[a] = merged; did = true; break search;
        }
      }
    }
    if (!did) break;
  }
  return list;
}

/** Biggest first, then reading order. Deterministic, and chunk 0 is the one
 *  that reads as the main body of the space. */
function inReadingOrder(rects) {
  return [...rects].sort((a, b) =>
    (b.area - a.area) || (a.y0 - b.y0) || (a.x0 - b.x0));
}

// --- what makes one rectangle better than another --------------------------

/** 0..1 — how close to square. A 6x6 chunk scores 1, a 30x3 corridor 0.1. */
export function squareness(r) {
  const lo = Math.min(r.w, r.h), hi = Math.max(r.w, r.h);
  return hi > 0 ? lo / hi : 0;
}

/**
 * 0..1 — how cleanly this rectangle's sides divide into the target cell. A
 * 24x18 chunk at a 6 ft target scores 1: its cells come out exactly 6x6 with
 * nothing stretched. A 15x15 chunk has to run 5 ft cells, so it scores lower.
 */
export function gridFitness(r, opt) {
  const t = opt.targetCell || 6;
  const fit = (s) => {
    const n = Math.max(1, Math.round(s / t));
    return Math.max(0, 1 - Math.abs(s / n - t) / t);
  };
  return (fit(r.w) + fit(r.h)) / 2;
}

/**
 * 0..1 — does this rectangle hold the fans it contains comfortably, or does an
 * edge cut through a blade circle? A fan near a chunk boundary is the awkward
 * case: the cells around it are split between two grids that know nothing about
 * each other, so neither can offer it a clean position.
 */
export function fanFitness(r, fans, opt) {
  const inside = fans.filter((f) => f.x > r.x0 && f.x < r.x1 && f.y > r.y0 && f.y < r.y1);
  if (!inside.length) return 0.5;   // neutral: no opinion either way
  let s = 0;
  for (const f of inside) {
    const need = (f.r || 0) + (opt.fanClearance ?? 2);
    const margin = Math.min(f.x - r.x0, r.x1 - f.x, f.y - r.y0, r.y1 - f.y);
    s += need > 0 ? Math.max(0, Math.min(1, margin / need)) : 1;
  }
  return s / inside.length;
}

/** A rough cell count without running the real partition — enough for a chip. */
function estimateCells(r, opt) {
  const t = opt.targetCell || 6;
  return Math.max(1, Math.round(r.w / t)) * Math.max(1, Math.round(r.h / t));
}

// --- the strategies ---------------------------------------------------------

/**
 * Each strategy is one honest opinion about how to read the space. They are
 * deliberately different in kind, not in tuning — two decompositions that
 * differ by a foot are not a choice, they are noise. Any that land on the same
 * answer are collapsed into one option afterwards.
 */
export const CHUNK_STRATEGIES = [
  {
    id: 'largest-first',
    label: 'Largest first',
    blurb: 'Claim the biggest rectangle that fits, then the next biggest. The main body of the room stays whole and the leftovers fall where they fall.',
    build: (g) => greedyDecompose(g, (r) => r.area),
  },
  {
    id: 'vertical-slices',
    label: 'Vertical slices',
    blurb: 'One sweep top to bottom: the space becomes full-height bays. Reads as a colonnade, and every light lines up in columns.',
    build: (g) => mergePass(g, slabDecompose(g, 'v')),
  },
  {
    id: 'horizontal-slices',
    label: 'Horizontal slices',
    blurb: 'One sweep left to right: the space becomes full-width courses. Reads as bands, and every light lines up in rows.',
    build: (g) => mergePass(g, slabDecompose(g, 'h')),
  },
  {
    id: 'squarest',
    label: 'Squarest pieces',
    blurb: 'Prefer pieces close to square. Each chunk then carries a near-square grid of its own, so no chunk has to stretch its cells to fit.',
    build: (g) => greedyDecompose(g, (r) => r.area * (0.35 + 0.65 * squareness(r))),
  },
  {
    id: 'grid-fit',
    label: 'Best grid fit',
    blurb: 'Prefer pieces whose sides divide cleanly into the target cell, so cells land on the size you asked for instead of near it.',
    build: (g, ctx) => greedyDecompose(g, (r) => r.area * (0.30 + 0.70 * gridFitness(r, ctx.opt))),
  },
  {
    id: 'around-fans',
    label: 'Around the fans',
    blurb: 'Prefer pieces that hold each fan well inside them, so no chunk edge cuts through a blade circle and splits a fan between two grids.',
    requiresFans: true,
    build: (g, ctx) => greedyDecompose(g, (r) => r.area * (0.40 + 0.60 * fanFitness(r, ctx.fans, ctx.opt))),
  },
];

// --- measuring an option ----------------------------------------------------

export function measureChunking(chunks, omitted, ctx) {
  const { grid, fans, opt } = ctx;
  const usedArea = chunks.reduce((s, c) => s + c.area, 0);
  const lostArea = omitted.reduce((s, c) => s + c.area, 0);
  const freeArea = grid.freeArea || usedArea + lostArea || 1;
  const sq = chunks.map(squareness);
  const gf = chunks.map((c) => gridFitness(c, opt));
  const held = fans.filter((f) => chunks.some((c) =>
    fanFitness(c, [f], opt) >= 0.999 && f.x > c.x0 && f.x < c.x1 && f.y > c.y0 && f.y < c.y1)).length;
  const placed = fans.filter((f) => chunks.some((c) =>
    f.x > c.x0 && f.x < c.x1 && f.y > c.y0 && f.y < c.y1)).length;
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  return {
    pieces: chunks.length,
    slivers: omitted.length,
    usedArea: R6(usedArea),
    lostArea: R6(lostArea),
    freeArea: R6(freeArea),
    coverage: freeArea > 0 ? usedArea / freeArea : 0,
    avgSquareness: mean(sq),
    worstSquareness: sq.length ? Math.min(...sq) : 0,
    cellFit: mean(gf),
    estCells: chunks.reduce((s, c) => s + estimateCells(c, opt), 0),
    largest: chunks.length ? R6(Math.max(...chunks.map((c) => c.area))) : 0,
    smallest: chunks.length ? R6(Math.min(...chunks.map((c) => c.area))) : 0,
    fansTotal: fans.length,
    fansHeldClear: held,
    fansOnAnEdge: placed - held,
    fansInASliver: fans.length - placed,
  };
}

/**
 * One number per option, so there is always something to recommend and always
 * a fallback when nobody chooses.
 *
 * Coverage dominates on purpose: area lost to slivers is ceiling left dark, and
 * no amount of tidiness buys that back. Everything after it is a matter of
 * taste, priced so that a genuinely better-proportioned option can win but a
 * marginally prettier one cannot beat covering the room.
 */
export const RANK_WEIGHTS = {
  coverage: 60,
  cellFit: 14,
  avgSquareness: 10,
  worstSquareness: 8,
  fans: 6,
  piecePenalty: 2.5,
};

export function scoreChunking(m, weights = RANK_WEIGHTS) {
  const fanScore = m.fansTotal ? m.fansHeldClear / m.fansTotal : 0.5;
  return weights.coverage * m.coverage
    + weights.cellFit * m.cellFit
    + weights.avgSquareness * m.avgSquareness
    + weights.worstSquareness * m.worstSquareness
    + weights.fans * fanScore
    - weights.piecePenalty * m.pieces;
}

/**
 * Score the field, then say what each option is BEST at. A number tells you
 * which option won; a highlight tells you why you might disagree — which is the
 * whole point of showing the choice at all.
 */
export function rankChunkings(options, weights = RANK_WEIGHTS) {
  const scored = options.map((o) => ({ ...o, score: scoreChunking(o.metrics, weights) }));
  if (!scored.length) return scored;
  const bestOf = (pick, dir = 1) => {
    const vals = scored.map((o) => pick(o.metrics) * dir);
    const top = Math.max(...vals);
    return scored.filter((o, i) => vals[i] >= top - 1e-9);
  };
  const spread = (pick) => {
    const vals = scored.map((o) => pick(o.metrics));
    return Math.max(...vals) - Math.min(...vals);
  };
  const tag = (list, text) => { for (const o of list) o.highlights.push(text); };
  for (const o of scored) o.highlights = [];

  if (spread((m) => m.coverage) > 1e-6) tag(bestOf((m) => m.coverage), 'loses the least area');
  if (spread((m) => m.pieces) > 0) tag(bestOf((m) => m.pieces, -1), 'fewest pieces');
  if (spread((m) => m.cellFit) > 0.01) tag(bestOf((m) => m.cellFit), 'cells closest to target');
  if (spread((m) => m.avgSquareness) > 0.02) tag(bestOf((m) => m.avgSquareness), 'squarest pieces');
  if (spread((m) => m.fansHeldClear) > 0) tag(bestOf((m) => m.fansHeldClear), 'best around the fans');

  return scored.sort((a, b) => b.score - a.score || a.order - b.order);
}

// --- enumeration ------------------------------------------------------------

/**
 * All the ways this space can reasonably be read, measured and ranked.
 *
 * Returns { options, recommendedId, needsChoice, grid, freeArea }.
 * `needsChoice` is false when the space admits only one decomposition — a plain
 * rectangle with no zones has nothing to choose between, and asking would be
 * ceremony rather than a decision.
 */
export function enumerateChunkings(polygon, zones = [], opt = {}, fans = []) {
  const o = { targetCell: 6, minChunk: 1, fanClearance: 2, ...opt };
  const grid = elementaryGrid(polygon, zones);
  if (grid.empty || grid.freeArea <= 0) {
    return { options: [], recommendedId: null, needsChoice: false, grid, freeArea: 0 };
  }
  const ctx = { grid, opt: o, fans, zones, polygon };

  const seen = new Map();
  let order = 0;
  for (const strat of CHUNK_STRATEGIES) {
    if (strat.requiresFans && !fans.length) continue;
    let rects;
    try { rects = strat.build(grid, ctx); } catch { continue; }
    if (!rects || !rects.length) continue;
    rects = inReadingOrder(rects);
    // slivers are set aside, not lost: a chunk this thin does not deserve a
    // light, but the option is still judged on the area it gives up
    const chunks = [], omitted = [];
    for (const r of rects) (Math.min(r.w, r.h) > o.minChunk ? chunks : omitted).push(r);
    if (!chunks.length) continue;

    const key = signatureOf(chunks);
    if (seen.has(key)) {
      const first = seen.get(key);
      first.aliases.push(strat.id);
      first.aliasLabels.push(strat.label);
      continue;
    }
    seen.set(key, {
      id: strat.id,
      strategy: strat.id,
      label: strat.label,
      blurb: strat.blurb,
      aliases: [],
      aliasLabels: [],
      order: order++,
      signature: key,
      chunks: chunks.map(publicRect),
      omitted: omitted.map(publicRect),
      metrics: measureChunking(chunks, omitted, ctx),
    });
  }

  const options = rankChunkings([...seen.values()]);
  return {
    options,
    recommendedId: options.length ? options[0].id : null,
    // one option is not a choice, it is the answer
    needsChoice: options.length > 1,
    grid,
    freeArea: grid.freeArea,
  };
}

/** Serialisable, comparison-friendly form — no grid indices, no back-refs. */
function publicRect(r) {
  return { x0: R6(r.x0), y0: R6(r.y0), x1: R6(r.x1), y1: R6(r.y1), w: R6(r.w), h: R6(r.h), area: R6(r.area) };
}

/** Two decompositions are the same decomposition if they cover the same
 *  rectangles, whatever order they were claimed in. */
export function signatureOf(chunks) {
  return chunks
    .map((c) => [c.x0, c.y0, c.x1, c.y1].map((v) => R6(v).toFixed(4)).join(','))
    .sort()
    .join(' | ');
}

/** Look an option up by id, tolerating a stale or unknown id. */
export function findChunking(options, id) {
  if (!options || !options.length) return null;
  return options.find((o) => o.id === id)
      || options.find((o) => o.aliases && o.aliases.includes(id))
      || null;
}

// ===========================================================================
// SELECTION — who decides, and how
//
// Today: a person clicks a card. Tomorrow: a model reads the same payload the
// card is drawn from and answers with an id. Both go through one interface, so
// the second is a registration, not a refactor.
//
// Wiring the model up later is one line at start-up:
//
//     import { registerChunkSelector, createClaudeChunkSelector } from './chunking.js';
//     registerChunkSelector('claude', createClaudeChunkSelector({ apiKey }));
//
// ...and then `selectChunking(options, { mode: 'claude', ctx })`. Nothing else
// in the app changes: the planner already takes a chosen id, the picker already
// renders whatever came back, and 'auto' remains the fallback when the model is
// unavailable, slow or wrong about the id.
// ===========================================================================

/**
 * A selector is `({ options, ctx, ...extra }) => { id, reason, confidence }`,
 * sync or async. It may only return an id that exists; anything else is treated
 * as a miss and falls back to the heuristic.
 */
const SELECTORS = new Map();

export function registerChunkSelector(name, fn) {
  if (typeof fn !== 'function') throw new Error('A chunk selector must be a function.');
  SELECTORS.set(name, fn);
  return name;
}
export function listChunkSelectors() { return [...SELECTORS.keys()]; }
export function hasChunkSelector(name) { return SELECTORS.has(name); }

/** The heuristic. Always registered, always the fallback, never the ceiling. */
registerChunkSelector('auto', ({ options }) => {
  const top = options[0];
  return {
    id: top ? top.id : null,
    reason: top
      ? `${top.label} scores highest${top.highlights?.length ? ` — ${top.highlights.join(', ')}` : ''}.`
      : 'Nothing to choose from.',
    confidence: options.length > 1
      && options[0].score - options[1].score < 2 ? 'low' : 'medium',
    by: 'auto',
  };
});

/**
 * Ask a selector for a configuration. Always resolves to a real option: an
 * unknown mode, a thrown error or an id that does not exist all fall back to
 * the heuristic, with `fellBack` set so the caller can say so.
 */
export async function selectChunking(options, { mode = 'auto', ...extra } = {}) {
  if (!options || !options.length) return { id: null, reason: 'No configurations.', by: mode, fellBack: false };
  const fallback = async (why) => {
    const auto = await SELECTORS.get('auto')({ options, ...extra });
    return { ...auto, by: 'auto', fellBack: true, fellBackBecause: why };
  };
  const fn = SELECTORS.get(mode);
  if (!fn) return fallback(`No selector registered as "${mode}".`);
  let pick;
  try { pick = await fn({ options, ...extra }); } catch (err) {
    return fallback(String(err?.message || err));
  }
  const chosen = findChunking(options, pick?.id);
  if (!chosen) return fallback(`Selector returned an unknown id (${JSON.stringify(pick?.id)}).`);
  return { id: chosen.id, reason: pick.reason || '', confidence: pick.confidence || 'medium',
           by: pick.by || mode, fellBack: false };
}

// --- the payload a model would read ----------------------------------------

/**
 * Everything needed to choose, and nothing else: no DOM, no pixels, no
 * functions, no cycles. This is deliberately the SAME data the picker cards are
 * drawn from — if a person can decide from the card, a model can decide from
 * this, and the two cannot drift apart.
 */
export function chunkingPayload(options, ctx = {}) {
  const { polygon = [], zones = [], fans = [], opt = {} } = ctx;
  const round = (v) => R6(v);
  return {
    units: 'feet',
    room: {
      outline: polygon.map((p) => ({ x: round(p.x), y: round(p.y) })),
      noLightZones: zones.map((z) => ({ x0: round(z.x0), y0: round(z.y0), x1: round(z.x1), y1: round(z.y1) })),
      fans: fans.map((f) => ({ x: round(f.x), y: round(f.y), bladeRadius: round(f.r || 0) })),
    },
    intent: {
      targetCellFt: opt.targetCell ?? 6,
      minChunkFt: opt.minChunk ?? 1,
      fanClearanceFt: opt.fanClearance ?? 2,
      minWallDistanceFt: opt.minWallDistance ?? 5,
    },
    options: options.map((o) => ({
      id: o.id,
      label: o.label,
      rationale: o.blurb,
      chunks: o.chunks.map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, w: c.w, h: c.h })),
      omittedSlivers: o.omitted.map((c) => ({ w: c.w, h: c.h, area: c.area })),
      metrics: {
        pieces: o.metrics.pieces,
        coverage: +o.metrics.coverage.toFixed(4),
        areaLostSqft: o.metrics.lostArea,
        cellFit: +o.metrics.cellFit.toFixed(3),
        avgSquareness: +o.metrics.avgSquareness.toFixed(3),
        worstSquareness: +o.metrics.worstSquareness.toFixed(3),
        estimatedCells: o.metrics.estCells,
        fansHeldClear: o.metrics.fansHeldClear,
        fansOnAChunkEdge: o.metrics.fansOnAnEdge,
      },
      heuristicScore: +(o.score ?? 0).toFixed(2),
      heuristicHighlights: o.highlights || [],
    })),
    heuristicRecommendation: options.length ? options[0].id : null,
  };
}

export const CHUNKING_PROMPT = `You are laying out ambient ceiling lighting for a room.

The room, minus any no-light zones, has been decomposed into rectangular chunks
several different ways. Each chunk will get its own near-square grid of cells,
and each cell one light, so the decomposition decides how the finished layout
reads from the floor.

Pick the ONE option that will light this room best. What matters, roughly in
order:

1. Do not waste ceiling. Area that ends up in an omitted sliver gets no light.
2. Read as one deliberate layout. Few large pieces beat many small ones, and
   pieces that line up across the room beat pieces that stagger.
3. Cells near the target size, and near square. A chunk that has to stretch its
   cells shows it.
4. Keep fans well inside a chunk. A chunk edge through a blade circle splits the
   fan between two grids and neither can offer it a clean position.
5. Respect how the space is used. A long chunk along the room's main axis reads
   as intentional; one cut across it reads as an accident.

The heuristic score and highlights are a starting point, not an instruction —
disagree with them if the geometry says so, and say why.

Respond with ONLY a JSON object, no prose, no markdown fence:
{"id":"<one of the option ids>","reason":"<one or two sentences>","confidence":"high|medium|low"}`;

export function buildChunkingPrompt(payload, prompt = CHUNKING_PROMPT) {
  return `${prompt}\n\n${JSON.stringify(payload, null, 2)}`;
}

/**
 * A ready-made model-backed selector. Implemented, tested against the same
 * interface as 'auto', and deliberately NOT registered — nothing calls a model
 * until someone decides it should. Registering it is the one line in the
 * comment block above.
 */
export function createClaudeChunkSelector({ apiKey, model = 'claude-sonnet-4-5', fetchImpl } = {}) {
  return async function claudeChunkSelector({ options, ctx = {} }) {
    if (!apiKey) throw new Error('No API key set.');
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error('No fetch available in this environment.');
    const body = {
      model,
      max_tokens: 500,
      messages: [{ role: 'user', content: buildChunkingPrompt(chunkingPayload(options, ctx)) }],
    };
    const res = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const text = (json.content || []).map((c) => c.text || '').join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse the model response.');
    const out = JSON.parse(match[0]);
    return { id: out.id, reason: out.reason, confidence: out.confidence, by: 'claude' };
  };
}
