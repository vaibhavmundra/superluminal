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
// TWO SOURCES ARE REGISTERED, and they fail in opposite directions.
//
// `faces` is the geometric reader: it arranges the wall lines into a planar
// graph, bridges the doorways and returns the faces. It is honest about what it
// needs — walls on their own layers — and on a drawing where the furniture
// shares layer 0 with the walls it will confidently return the dining table as
// a room. It is exact when it works and nonsense when it does not, with little
// in between, and it needs a DXF.
//
// `roboflow-rooms` is the trained segmenter. It reads a PICTURE of the plan, so
// it works on a photo and on a DXF alike, and it does not care which layer
// anything is on. What it gives back is approximate: a boundary a few inches
// off the wall face, sometimes wandering through a doorway. That is the trade —
// approximately right everywhere beats exactly right sometimes, PROVIDED the
// correction is a drag rather than a re-trace. Which is why the grips in
// OutlineTracer are part of this feature and not a nicety attached to it.
// ---------------------------------------------------------------------------

import { findRooms, doorHints, textHints } from './rooms.js';
import { wallSegments } from './dxf.js';
import { makeOutline } from './outline.js';
import { snapshotForDetection } from './furniture.js';
import { detectRooms, roomsFromPayload, nameFromHints } from './roomsDetect.js';

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

/**
 * The trained room segmenter.
 *
 * Takes the plan, whatever kind it is, and hands back one proposal per room.
 * The snapshot is taken here rather than by the caller so that the two kinds of
 * plan converge before the network call — a DXF is rendered to a plain
 * black-on-white raster by exactly the code the bed detector uses, which is the
 * seam that lets everything below this line stop asking which route it is on.
 *
 * NOTHING HERE THROWS at the user. proposeOutlines catches, and a detector
 * being down has to cost the user nothing more than the tracing they were
 * doing before it existed.
 */
registerOutlineSource('roboflow-rooms', async ({ source, img, pxPerFt = null, signal = null,
                                                 snapshotOpts = {}, onMeta = null }) => {
  const shot = await snapshotForDetection(source, img, snapshotOpts);
  const payload = await detectRooms({
    base64: shot.base64, mime: shot.mime, signal,
    // The size SENT, not the size of the original — a model answering in
    // fractions resolves them against this, and roomsFromPayload rescales
    // whatever space the answer arrives in back to the uploaded file.
    w: shot.w, h: shot.h,
  });

  const image = { w: source.w, h: source.h };
  const { rooms, rejected } = roomsFromPayload(payload, { image, pxPerFt });

  // A DXF names its own rooms. Where a label sits inside a proposed polygon,
  // the draughtsman's word beats ours — see nameFromHints.
  const hints = source.kind === 'vector' && source.drawing
    ? textHints(source.drawing).map((t) => ({ ...source.toPx({ x: t.x, y: t.y }), text: t.text }))
    : [];

  onMeta?.({
    server: payload?.meta ?? null,
    proposed: rooms.length,
    rejected: rejected.map((r) => r.reason),
    sent: { w: shot.w, h: shot.h },
    of: image,
  });

  return rooms.map((r) => ({
    ...r,
    label: r.label || nameFromHints(r.pointsPx, hints) || null,
  }));
});
