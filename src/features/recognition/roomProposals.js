import { bbox } from '../../lib/geometry.js';
import { iou } from '../../lib/furniture.js';
import { nextOutlineName } from '../../lib/outline.js';

// Read the latest document outlines at commit time. The existing ID factory is
// supplied by the controller so geometry, naming and counts remain testable.
export function mergeRoomProposals(os, { proposals, source, meta, ms, makeId }) {
  // MERGE, NEVER REPLACE, and the rule is about work rather than about
  // provenance: anything the user has TOUCHED survives, whether they drew
  // it or dragged a corner of it. Only untouched proposals go, because they
  // are the same answer to the same question and keeping both would double
  // every room.
  //
  // This matters more than it looks. The effect re-runs whenever the plan
  // source changes, and correcting a DXF's unit interpretation on the
  // tracer screen changes it — so without this, choosing the right units
  // after nudging four rooms would silently throw the nudges away.
  const kept = os.filter((o) => !o.detected || o.reviewed);

  // ...which means a re-run can propose a room the user has already
  // corrected. Drop a proposal that lands on top of an outline that is
  // already there rather than stacking two outlines on one room.
  const existing = kept.map((o) => {
    const b = bbox(o.pointsDu.map(source.fromDu));
    return { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
  });

  // Names are handed out against a list that grows as we go, so two rooms
  // cannot both come out "Room 1". A label from the drawing or the model
  // wins when it is not already taken — "Kitchen" is worth more than
  // "Room 2" — and the counter fills in the rest.
  const seen = kept.map((o) => ({ name: o.name }));
  const made = [];
  for (const prop of proposals) {
    const b = bbox(prop.pointsPx);
    const rect = { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
    if (existing.some((e) => iou(e, rect) > 0.5)) continue;
    const taken = new Set(seen.map((u) => u.name).filter(Boolean));
    const name = prop.label && !taken.has(prop.label)
      ? prop.label : nextOutlineName(seen);
    seen.push({ name });
    existing.push(rect);
    made.push({
      id: makeId(prop.pointsPx, name),
      name,
      // ALREADY SQUARE. roomsFromPayload rectified it, so the stored
      // points ARE the polygon and a grip moves what you can see. Leaving
      // this on would square the correction away under the user's hand.
      // The per-room switch stays available to re-apply it.
      rectify: false,
      detected: true, reviewed: false,
      confidence: prop.confidence ?? null,
      why: prop.why || '',
      note: prop.note || '',
      pointsDu: prop.pointsPx.map(source.toDu),
      // Rooms that sit wholly inside this one and could not be subtracted
      // from it. Held in the plan's own units like everything else, so a
      // unit correction moves them with the walls.
      enclosingDu: prop.enclosingPx
        ? prop.enclosingPx.map((poly) => poly.map(source.toDu)) : null,
    });
  }
  return {
    outlines: [...kept, ...made],
    roomState: {
      status: 'done', ms,
      // What is on screen, not what came back: a proposal that landed on
      // a room the user had already corrected was not added, and
      // reporting it as found would have them looking for an outline that
      // is not there.
      proposed: made.length,
      returned: proposals.length,
      dropped: meta?.rejected?.length ?? 0,
      meta,
    },
  };
}
