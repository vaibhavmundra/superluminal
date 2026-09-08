/**
 * BED-FIT ADJUDICATION, AS A FUNCTION OF ITS ARGUMENTS.
 *
 * Two detectors read the same sheet and neither is trusted over the other. The
 * ASKING is a model call and belongs to the pipeline; what is here is the part
 * that has no call in it — turning a batch of per-room answers into the two
 * things the document stores: one verdict per space, and one merged list of
 * beds with each box attributed to the room that won it.
 *
 * SEPARATE FROM THE VERDICT ITSELF, which is lib/bedFit.js: `contestFor` says
 * whether the two readings disagree enough to be worth asking about and
 * `applyVerdict` says who won. This is the fold over the rooms, and it is the
 * part that used to sit inline in `runPipeline` where it could not be read
 * without reading four hundred lines of sequencing around it.
 */
import { dedupe } from '../../lib/furniture.js';

/**
 * @param rows  one entry per judged space: { id, name, a, b, rec }, where `a`
 *              and `b` are that room's boxes from each detector and `rec` is
 *              `contestFor`/`applyVerdict`'s record.
 * @param all   { a, b } — the WHOLE sheet's boxes from each detector, so the
 *              ones in no traced room can be found.
 */
export function absorbContest(rows, { a: A = [], b: B = [] } = {}) {
  const verdicts = {};
  const won = [];
  const claimed = new Set();
  for (const r of rows) {
    verdicts[r.id] = {
      kind: r.rec.kind, pick: r.rec.pick, asked: r.rec.asked,
      confidence: r.rec.confidence ?? 0, why: r.rec.why || '',
      fellBack: !!r.rec.fellBack, failed: !!r.rec.failed,
      counts: { roboflow: r.a.length, openai: r.b.length },
    };
    for (const d of [...r.a, ...r.b]) claimed.add(d.id);
    for (const d of (r.rec.winner || [])) won.push({ ...d, roomId: r.id, contest: r.rec.kind });
  }

  // BEDS IN NO TRACED ROOM. Nothing judged these — there was no room to
  // isolate and no ceiling for them to affect — so they keep the behaviour
  // they have always had: both readings merged, overlaps de-duplicated.
  // Dropping them instead would silently remove boxes the user can see on
  // the canvas today, on a plan where they simply have not drawn that room
  // yet.
  const loose = [...A, ...B].filter((d) => !claimed.has(d.id));
  for (const d of dedupe(loose)) won.push({ ...d, roomId: null, contest: 'unjudged' });

  return { verdicts, won };
}
