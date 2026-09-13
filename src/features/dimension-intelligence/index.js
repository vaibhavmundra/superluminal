// ---------------------------------------------------------------------------
// dimension-intelligence — the scale, read off a drawing that already states it.
//
// A plan uploaded to this app has, until now, had to be MEASURED: the door
// detector finds openings, the user names one, and the width of a door leaf
// becomes the ruler for the whole building. That works on any drawing, which is
// why it stays. But a great many drawings already carry the answer, written on
// them by the person who drew them, and asking someone to point at a door on a
// sheet dimensioned end to end is asking them to do arithmetic the sheet has
// already done.
//
// TWO PATTERNS, which is what uploaded plans actually contain:
//
//   CHAINS      a row of figures along a wall. The gap between two neighbouring
//               figures is half of one plus half of the next — a length in feet
//               and a length in pixels, from the text layer alone, with no
//               geometry read at all. See chainScale.js.
//
//   ROOM SIZES  `18'-0" X 12'-0"` inside a room. The outline is already on
//               screen in pixels (the detector runs before the scale is known),
//               so the stated size and the drawn size are directly comparable —
//               and because it is a PAIR, it checks itself. See roomScale.js.
//
// WHAT IT IS WORTH. Both beat the door route on accuracy, not just on clicks:
// doors.js records that its detector boxes come back "anisotropic by up to a
// quarter", and on top of that a person is guessing 750 against 900 against
// 1200 by eye. A written dimension is the architect's own number.
//
// THE TEXT SOURCE IS AN ARGUMENT AND NOT AN IMPORT. Everything here is pure and
// takes positioned text runs in PLAN PIXELS; pdfPlan.js supplies them from a
// PDF's own text layer today. A vision pass reading a scanned plan would hand
// over the same shape and none of this would change, which is the point.
// ---------------------------------------------------------------------------

import { reassemble, readDimension, bareNumbers, inferBareUnit } from './dimText.js';
import { chainCandidates } from './chainScale.js';
import { roomCandidates } from './roomScale.js';
import { consensus } from './consensus.js';

export { reassemble, readDimension, inferBareUnit } from './dimText.js';
export { findChains, chainCandidates } from './chainScale.js';
export { orientedExtent, matchPair, roomCandidates } from './roomScale.js';
export { consensus, TOL, MIN_AGREE } from './consensus.js';

/**
 * Read the scale off a drawing.
 *
 * `textItems` — positioned runs in plan pixels: { str, x, y, w, h, rot }.
 * `outlines`  — the room polygons, { id, name, pts }, in the same pixels.
 *               Optional: chains resolve without them.
 *
 * Returns the verdict from consensus(), with `lines` and `candidates` alongside
 * so a caller can say WHAT it read and not only what it concluded.
 */
export function readScale({ textItems, outlines } = {}) {
  const lines = reassemble(textItems);
  if (!lines.length) {
    return { ...consensus([]), lines: [], candidates: [] };
  }

  // The unit a naked number takes is decided once, over the whole sheet. See
  // inferBareUnit — a drawing is dimensioned in one unit, and no rule applied
  // to a single string can tell 3600mm from 3600ft.
  const bare = inferBareUnit(bareNumbers(lines));

  const entries = [];
  for (const line of lines) {
    const dim = readDimension(line, bare);
    if (dim) entries.push({ line, dim });
  }

  const singles = entries.filter((e) => e.dim.kind === 'single');
  const pairs = entries.filter((e) => e.dim.kind === 'pair');

  const candidates = [
    ...chainCandidates(singles),
    ...roomCandidates(pairs, outlines),
  ];

  const verdict = consensus(candidates);
  return {
    ...verdict,
    bareUnit: bare,
    lines,
    candidates,
    /* COULD A LATER ROOM OUTLINE STILL CHANGE THIS ANSWER?
       The caller has to hold the door step back while the answer may still
       arrive — room sizes cannot be scored until the segmenter's polygons land,
       a beat after the plan does. But waiting is only right when there is
       something to wait FOR: a sheet with no `18 X 12` anywhere on it has
       nothing a polygon could unlock. */
    pairsFound: pairs.length,
  };
}

/**
 * What gets SAVED when a plan's scale was read this way.
 *
 * Small on purpose: this rides in the plan row beside the other scale settings
 * (see `scale` in lib/planState.js), and the evidence is worth keeping only in
 * the summary that lets somebody understand the number later. The full
 * candidate list is a debugging artefact and stays in memory.
 */
export function statedRecord(verdict) {
  if (!verdict?.ok) return null;
  return {
    pxPerFt: verdict.pxPerFt,
    confidence: verdict.confidence,
    spread: verdict.spread,
    from: verdict.used.map((c) => ({ source: c.source, detail: c.detail })).slice(0, 8),
    at: new Date().toISOString(),
  };
}
