import { zonesFromDetections, plausibleBed } from '../../lib/furniture.js';

// Every no-light zone on the plan, whoever drew it.
//
// A DETECTION IS A PROPERTY OF THE IMAGE, not of a room. The bed detector runs
// on upload, before any boundary exists, and finds every bed on the sheet;
// which of them is an obstacle depends on which ceiling is being laid out, and
// that question is answered per room, below. So this list is unfiltered — it
// is what the canvas draws — and the planner sees only the subset that falls
// inside the room it is working on.

/**
 * THE BEDS THE ACCENT PASS THOUGHT IT SAW — FOR THE AUDIT PANEL ONLY.
 *
 * NOTHING DOWNSTREAM OF THIS PLACES A LIGHT. These boxes are deliberately not
 * in `detectedZones`, so they do not reach the chunking, the no-light zones,
 * or the sconce rule. Read the header of `detectedZones` for why; the short
 * version is that the accent pass is a question about furniture in general,
 * where a bed arrives as a side effect and its box only ever had to be roughly
 * right. A bed's rectangle decides where the ceiling lights are NOT, and a
 * second looser opinion about the same mattress competing with a measured one
 * is how one bed became several stacked zones.
 *
 * It is still counted, and that is the whole point of keeping it: an exclusion
 * you can see is a decision, an exclusion you cannot is a bug. If this number
 * is high on a plan where bed-filter found nothing, that is worth knowing.
 *
 * FROM THE OUTLINES, NOT FROM `rooms`, AND THAT IS NOT A STYLE CHOICE. The
 * first version read `rooms`, which crashed the app on load with "Cannot
 * access 'rooms' before initialization" — and the temporal dead zone was only
 * the symptom. `rooms` is the LAID-OUT plan, computed from `zoneList`, which
 * is computed from these very zones: a bed moves the fittings around it, so
 * the layout cannot be an input to the beds without the beds being an input to
 * themselves. Reordering the declarations would have swapped the crash for an
 * infinite loop or a stale render.
 */
export function buildBedsPerRoom({ outlines, accentResults }) {
  const out = [];
  for (const o of outlines) {
    const found = accentResults[o.id]?.bedsFromAccentPass;
    if (!found?.length) continue;
    found.forEach((f, i) => {
      if (!f.rect) return;
      out.push({
        id: `bed-room-${o.id}-${i}`, cls: 'bed', conf: f.confidence ?? 0.8,
        rect: f.rect, roomId: o.id, closeUp: true,
      });
    });
  }
  return out;
}

export function buildDetectedZones({ detections, dismissed, source, pxPerFt, bedsPerRoom }) {
  const diagnostics = [];
  if (!source) return { zones: [], diagnostics };
  /* THREE SOURCES, ONE WINNER PER SPACE, IN A STATED ORDER.
   *
   * TWO SOURCES, AND THE ACCENT PASS IS NOT ONE OF THEM.
   *
   *   1. `bed-filter`, THE WHOLE PLAN — one trained segmenter, one call. The
   *      primary path, and the answer for very nearly every bed.
   *   2. GPT ON ONE BEDROOM CROP — and ONLY where the classifier called a
   *      space a bedroom and bed-filter put nothing in it. Where it exists it
   *      is the answer to a question the primary pass got wrong, so it wins
   *      for its own space.
   *
   * THE ACCENT PASS IS DELIBERATELY EXCLUDED, and this is the rule, not a
   * tuning choice: a bed's rectangle decides where the ceiling lights are NOT,
   * which moves real fittings. The accent pass is a question about furniture in
   * general — a wardrobe, a TV unit, a sofa — where a bed comes back as a side
   * effect and its box only ever had to be roughly right, because all it was
   * used for was hanging sconces off. Letting a box drawn to that standard
   * into the chunking meant a second, looser opinion about the same mattress
   * silently competing with a measured one. `bedsPerRoom` still exists and is
   * still shown in the audit panel; it does not reach this list.
   *
   * Matched by `roomId`, which every per-room bed carries, so this is set
   * membership and not a point-in-polygon guess.
   */
  const judged = detections.filter((d) => d.refound && d.roomId);
  const judgedRooms = new Set(judged.map((d) => d.roomId));
  const sheet = detections.filter((d) => {
    if (d.refound) return false;                       // counted in `judged`
    return !(d.roomId && judgedRooms.has(d.roomId));
  });
  const live = [...sheet, ...judged].filter((d) => !dismissed.includes(d.id));
  if (judged.length) {
    diagnostics.push({ level: 'log', args: [`[beds] ${live.length} zones = ${sheet.length} from bed-filter`
      + ` + ${judged.length} from a GPT bedroom crop`
      + ` (${bedsPerRoom.length} accent-pass beds deliberately excluded)`] });
  }
  if (!live.length) return { zones: [], diagnostics };

  /**
   * THE PHYSICAL GATE, AND THIS IS THE RIGHT PLACE FOR IT.
   *
   * Every bed — from the whole-sheet pass, from a per-room re-ask, from a
   * reopened plan — becomes a no-light zone here and nowhere else, and by this
   * point the scale is known. So this is the one checkpoint that cannot be
   * bypassed by adding another detector later, and it re-runs if the scale is
   * corrected, which means a plan measured wrongly and then fixed does not
   * keep a set of beds sized for the wrong ruler.
   *
   * A LIGHT IS PLACED AROUND THESE RECTANGLES, so a wrong one is not a
   * cosmetic error: a box covering a whole bedroom moves every fitting in it.
   * The detector returning 121 beds on an 11-space plan is what this exists to
   * stop, and it stops it by knowing how big a bed is — see BED_FT.
   */
  const kept = [], tossed = [];
  for (const d of live) {
    const fit = plausibleBed(d.rect, pxPerFt);
    (fit.ok ? kept : tossed).push({ d, fit });
  }
  if (tossed.length) {
    diagnostics.push({ level: 'warn', args: [`[beds] rejected ${tossed.length} of ${live.length} as impossible`,
      tossed.slice(0, 12).map(({ d, fit }) => `${d.id}: ${fit.why}`)] });
  }
  const ok = kept.map(({ d }) => d);
  const zones = zonesFromDetections(ok, { image: { w: source.w, h: source.h }, pxPerFt })
    .map((z, i) => ({ ...z, id: ok[i].id,
                      closeUp: !!ok[i].closeUp || !!ok[i].refound,
                      judged: !!ok[i].refound }));
  return { zones, diagnostics };
}
