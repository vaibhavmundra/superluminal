// ---------------------------------------------------------------------------
// outlineSources.js — the slot for automatic outline finding.
//
// Tracing by hand is the route that always works, so it is the one the UI
// offers. But an outline is just a list of points, and where those points came
// from is nobody's business downstream — so proposing them automatically is a
// registration, exactly as choosing a chunking is (see registerChunkSelector).
//
//   ({ source, layers, opts }) => [{ pointsPx, label, confidence, why }]
//
// `faces` below is the geometric reader: it arranges the wall lines into a
// planar graph, bridges the doorways and returns the faces. It is honest about
// what it needs — walls on their own layers — and on a drawing where the
// furniture shares layer 0 with the walls it will confidently return the
// dining table as a room. That is the failure a model is meant to fix, and
// when one is wired up it registers here and everything downstream is unchanged.
// ---------------------------------------------------------------------------

import { findRooms, doorHints, textHints } from './rooms.js';
import { wallSegments } from './dxf.js';
import { makeOutline } from './outline.js';

const SOURCES = new Map();

export function registerOutlineSource(name, fn) {
  if (typeof fn !== 'function') throw new Error('An outline source must be a function.');
  SOURCES.set(name, fn);
}
export function listOutlineSources() { return [...SOURCES.keys()]; }
export function hasOutlineSource(name) { return SOURCES.has(name); }

/**
 * Ask a registered source for outlines. Returns [] rather than throwing when
 * the source is missing or fails — an automatic proposal is a convenience, and
 * losing it must never cost the user the trace they can always do by hand.
 */
export async function proposeOutlines(name, ctx) {
  const fn = SOURCES.get(name);
  if (!fn) return { ok: false, reason: `No outline source called "${name}".`, outlines: [] };
  try {
    const out = await fn(ctx);
    return { ok: true, reason: '', outlines: out || [] };
  } catch (err) {
    return { ok: false, reason: String(err.message || err), outlines: [] };
  }
}

registerOutlineSource('faces', ({ source, layers, opts = {} }) => {
  const segs = wallSegments(source.drawing, [...layers]);
  const res = findRooms(segs, opts, {
    doorCentres: doorHints(source.drawing),
    texts: textHints(source.drawing),
  });
  return res.rooms.map((r) => {
    const o = makeOutline(r.polygon.map(source.toPx), { name: r.label });
    return {
      ...o,
      confidence: r.polygon.length <= 8 ? 'high' : 'low',
      why: `${r.polygon.length} corners, ${Math.round(r.areaSqft)} sq ft`,
    };
  });
});
