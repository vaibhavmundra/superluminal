import { toObstaclePx } from './ceilingObjects.js';

// --- traced outlines --------------------------------------------------------
// Stored in the plan's own units and resolved into the current pixel space
// for use. On a DXF that indirection is load-bearing: correct the unit
// interpretation and the outline is reinterpreted exactly as the walls are,
// so it stays on its walls instead of sliding off them. On an image the pair
// is the identity — its pixels ARE its units — and the same code runs.
export function projectOutlinesPx(source, outlines) {
  if (!source) return [];
  return outlines.map((o) => ({
    ...o,
    pointsPx: o.pointsDu.map(source.fromDu),
    enclosingPx: o.enclosingDu ? o.enclosingDu.map((poly) => poly.map(source.fromDu)) : null,
  }));
}

/**
 * EVERY OBSTACLE ON THE CEILING, in plan pixels.
 *
 * One source since the red-circle detector was removed: the objects somebody
 * placed. They are held in FEET and converted here, which is what keeps them
 * the same real size when the scale is corrected underneath them.
 *
 * The planner is handed { x, y, r } and is not told what kind of thing it is
 * looking at — see the note in planner.js about why it calls them all fans.
 */
export function projectObstaclesPx(ceilingObjs, pxPerFt) {
  if (!pxPerFt) return [];
  return ceilingObjs.map((o) => toObstaclePx(o, pxPerFt));
}

/**
 * ...AND THE ONES THE GRID ACTUALLY HAS TO KEEP OFF.
 *
 * NOT ALL OF THEM, SINCE THE PALETTE GREW. A split AC's indoor unit hangs at
 * 2100mm on a wall and a geyser sits above a toilet door: both are placed on
 * this plan, both are drawn, both are on the schedule, and neither obstructs a
 * downlight in the middle of a ceiling. Handing them to the planner would
 * punch a hole in the layout for something that is not in its way — and
 * because clearance is circumscribed (see ceilingObjects.js), a 1000mm split
 * unit would reserve a two-and-a-half-foot radius of ceiling it is nowhere
 * near.
 *
 * ONE FLAG, ASKED OF THE CATALOGUE, and this is the only place it is read. The
 * full list stays whole for everything else — the canvas draws them, the
 * schedule counts them, the DXF and the plot carry them — because being off
 * the ceiling is a fact about clearance and about nothing else.
 */
export function projectCeilingObstaclesPx(obstaclesPx) {
  return obstaclesPx.filter((o) => !o.offCeiling);
}

/**
 * THE WARDROBES THE ACCENT PASS FOUND, in plan pixels, room by room.
 *
 * `accentResults[id].furniture` is what the RULES saw — the list the strips
 * and sconces were derived from, with this pass's own loose bed boxes already
 * swapped for the measured ones (see `computeAccents`). So a wardrobe in here
 * is a wardrobe the app has already acted on: it is the reason there is a
 * strip along that wall, and this is the same rectangle that produced it.
 *
 * OFF `litOutlines` AND NOT `rooms`, which is not a style preference — it is
 * the only ordering that works. `rooms` is computed FROM the zone list, and
 * the zone list is about to contain these; reading `rooms` here would be a
 * cycle. The results are keyed by the outline's own id, so there is nothing
 * `rooms` could add.
 */
export function projectWardrobesPx(litOutlines, accentResults) {
  const out = [];
  for (const o of litOutlines) {
    for (const f of accentResults[o.id]?.furniture ?? []) {
      if (f.type !== 'wardrobe' || !f.rect) continue;
      out.push({ id: `wd-${f.id}`, roomId: o.id, rect: f.rect });
    }
  }
  return out;
}
