// ---------------------------------------------------------------------------
// chainScale.js — the scale, taken off a run of dimensions.
//
// A DIMENSION CHAIN IS A RULER THAT NEEDS NO GEOMETRY READ AT ALL.
//
// Along a wall, a plan carries a row of figures — 10'-0", 12'-6", 8'-0" — each
// one centred on the segment it describes. So the gap between the CENTRES of
// two neighbouring figures is half of one segment plus half of the next:
//
//     |<--- 10'-0" --->|<----- 12'-6" ----->|
//              *                  *
//              |<---- 11'-3" ---->|          = (10 + 12.5) / 2
//
// That is a length in feet and a length in pixels for the same span, which is
// the whole of a scale. No path data is read, no dimension line is located, and
// the two things being compared come from the same source — so an exporter that
// shifted every label by the same amount cancels out.
//
// AND IT CHECKS ITSELF. A chain of four figures yields three independent
// estimates that must agree. One label knocked off its segment — which is what
// happens when the text is too long for a short link — disagrees with its two
// neighbours and is dropped, rather than quietly dragging an average.
//
// PURE. Lines in, candidates out.
// ---------------------------------------------------------------------------

import { along, across, centreOf } from './dimText.js';

/** Same angle, to about a degree. */
const ROT_TOL = 0.02;
/**
 * How far off a shared line a figure may sit, in text heights.
 *
 * A DIMENSION CHAIN IS OFTEN STACKED, which is what makes this tight. When a
 * segment is too short for its own figure the figure goes on a SECOND row just
 * below the first — `floor_plan_dim_intelligence.pdf` has 25 figures on one row
 * and 3 more on another 14px under it, at a text height of 12.1. At the old 1.2
 * those two rows merged into one chain and produced spans between figures that
 * describe different things, which is not noise: it is a confident wrong answer.
 */
const OFFSET_TOL = 0.5;
/** A chain is at least this many figures — two gives one estimate and no check. */
export const MIN_LINKS = 2;
/** Neighbours further apart than this many times the expected span are not neighbours. */
const NEIGHBOUR_SLACK = 3;

/**
 * Group single dimensions into collinear chains.
 *
 * `entries` are { line, dim } with dim.kind === 'single'.
 */
export function findChains(entries) {
  const byRot = new Map();
  for (const e of entries) {
    const rot = e.line.rot || 0;
    let key = null;
    for (const k of byRot.keys()) if (Math.abs(k - rot) <= ROT_TOL) { key = k; break; }
    if (key === null) { key = rot; byRot.set(key, []); }
    byRot.get(key).push(e);
  }

  const chains = [];
  for (const [rot, group] of byRot) {
    const rows = [];
    for (const e of group) {
      const c = centreOf(e.line);
      const a = across(c, rot);
      const tol = Math.max(2, (e.line.h || 1) * OFFSET_TOL);
      const row = rows.find((r) => Math.abs(r.across - a) <= Math.max(tol, r.tol));
      if (row) { row.entries.push({ ...e, centre: c }); row.tol = Math.max(row.tol, tol); }
      else rows.push({ across: a, tol, entries: [{ ...e, centre: c }] });
    }
    for (const row of rows) {
      if (row.entries.length < MIN_LINKS) continue;
      row.entries.sort((p, q) => along(p.centre, rot) - along(q.centre, rot));
      chains.push({ rot, entries: row.entries });
    }
  }
  return chains;
}

/**
 * A chain -> one candidate per adjacent pair.
 *
 * THE PAIR IS THE UNIT AND NOT THE CHAIN, because a chain with one bad label in
 * the middle still has good pairs either side of it. Rejecting the whole row
 * would throw away evidence to avoid an outlier that the consensus step is
 * already built to drop.
 */
export function candidatesFromChain(chain) {
  const out = [];
  const { rot, entries } = chain;
  for (let i = 0; i < entries.length - 1; i++) {
    const p = entries[i], q = entries[i + 1];
    const expectFt = (p.dim.a + q.dim.a) / 2;
    const gapPx = Math.abs(along(q.centre, rot) - along(p.centre, rot));
    if (!(expectFt > 0) || !(gapPx > 0)) continue;
    const pxPerFt = gapPx / expectFt;
    // A NEIGHBOUR THAT IS MILES AWAY IS NOT ONE. Two chains on the same line —
    // one along the top of the plan and one along the bottom of a detail — would
    // otherwise be joined across the gap between them and produce a figure from
    // a span nothing measured.
    const others = out.length ? out[out.length - 1].pxPerFt : null;
    if (others && (pxPerFt > others * NEIGHBOUR_SLACK || pxPerFt < others / NEIGHBOUR_SLACK)) continue;
    out.push({
      pxPerFt,
      source: 'chain',
      detail: `${p.dim.raw} + ${q.dim.raw}`,
      spanFt: expectFt,
      spanPx: gapPx,
    });
  }
  return out;
}

/** Every chain on the sheet, as candidates. */
export function chainCandidates(entries) {
  return findChains(entries).flatMap(candidatesFromChain);
}
