import { bedsIn } from '../../lib/bedFit.js';
import { iou } from '../../lib/furniture.js';

export function rejectionSummary(rejected) {
  if (!rejected.length) return null;
  const tally = new Map();
  for (const r of rejected) {
    // The reason without its measurement, so "10.6ft across" and
    // "8.8ft across" tally as one cause rather than as two.
    const key = String(r.reason).replace(/^[\d.]+ *(ft|sqft)/, '…').replace(/^[\d.]+:1/, '…:1');
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return { n: rejected.length, top, topCount: n };
}

/**
 * TAKE A BATCH OF PER-ROOM BED ANSWERS AND MAKE THEM THE PLAN'S BEDS.
 *
 * Extracted because two callers need identical behaviour and a second copy of
 * this would drift within a week: the pipeline's bedroom pass, and the admin
 * "Look again" button. Both have to apply the same three rules, and each one
 * exists because of a specific way this went wrong:
 *
 *   CONTAINMENT — a crop carries a margin, so a room's picture routinely
 *   includes its neighbour's bed. One call came back with four beds labelled
 *   ROOM 8 and ROOM 9. Unattributed, they double-count and let a room test as
 *   "has a bed" on somebody else's mattress.
 *
 *   DEDUPE — a room can be asked again when it already holds a bed, so the
 *   same mattress arrives twice. iou 0.45, the same limit the whole-sheet
 *   merge uses.
 *
 *   `existing` IS PASSED IN rather than read from state, because the pipeline
 *   calls this mid-run when its own setDetections has not rendered yet. A
 *   React update is not visible until the next render and neither caller gets
 *   one in the middle of its loop.
 *
 * The physical gate is NOT here: it lives in refindBeds (right after the crop
 * is mapped back to plan pixels) and again in detectedZones. This is about
 * whose bed it is, not whether it is one.
 */
export function collectBedRows(rows, existing) {
  const found = [];
  const verdicts = {};
  for (const row of rows) {
    if (!row || row.error) continue;
    const winner = row.rec.winner || [];
    const poly = row.poly;
    const mine = poly ? bedsIn(winner, poly) : winner;
    const already = poly ? bedsIn(existing, poly) : [];
    const fresh = mine.filter((d) => !already.some((e) => iou(d.rect, e.rect) > 0.45));
    for (const d of fresh) found.push({ ...d, roomId: row.id, contest: row.rec.kind });
    verdicts[row.id] = {
      kind: row.rec.kind, pick: row.rec.pick, asked: row.rec.asked,
      confidence: row.rec.confidence ?? 0, why: row.rec.why || '',
      fellBack: !!row.rec.fellBack, failed: !!row.rec.failed,
      refound: true,
      counts: { roboflow: row.a.length, openai: row.b.length },
      kept: mine.length, fresh: fresh.length,
    };
  }
  return { found, verdicts };
}
