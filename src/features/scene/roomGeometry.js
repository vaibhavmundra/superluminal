import { outlineStats } from '../../lib/outline.js';
import { classifyLayers } from '../../lib/dxf.js';
import { bbox } from '../../lib/geometry.js';

// Which layers are walls, for the detector's render. classifyLayers already
// works this out for room extraction; the same answer decides which lines get
// drawn heavy. On APT_01 it picks "KMBD Walls" out of a drawing whose other
// 1656 entities all sit on layer 0.
export function buildWallLayerSet({ isVector, source }) {
  if (!isVector || !source?.drawing?.layers) return null;
  const { wallLayers } = classifyLayers(source.drawing.layers);
  return wallLayers.length ? new Set(wallLayers) : null;
}

/**
 * THE BUILT AREA, in square feet — the sum of the spaces, not the sheet.
 *
 * The sheet is the wrong measure and it would be the easy one: it includes the
 * title block, the margins and whatever site plan is sitting off to the side,
 * so the same building drawn on A1 and A0 would be two different sizes. The
 * spaces are what the models are being asked about.
 *
 * Null until there is a scale, which on a raster means until a door has been
 * measured. Everything that reads this treats null as "not known yet" rather
 * than as small — see the note on the bed pass.
 */
export function buildPlanAreaSqft({ outlinesPx, pxPerFt }) {
  // `outlinesPx`, NOT `outlines`, AND THE DIFFERENCE BLANKED THE SCREEN.
  //
  // An outline is STORED in drawing units — `pointsDu` — and resolved into
  // pixels by the outlinesPx memo above. Everything that measures one goes
  // through that resolved list; the raw one is the storage format. A
  // detector-proposed outline in particular has no `pointsPx` at all (see
  // where `made.push` builds them), so handing a raw outline to outlineStats
  // reaches `ensureCCW(undefined)` and throws — during render, which in React
  // means the whole tree unmounts and the app is a white page.
  //
  // It surfaced at the strangest possible moment: this memo returns null until
  // there is a scale, so the crash landed the instant somebody set a door's
  // width. Two features away from its cause.
  if (!pxPerFt || !outlinesPx.length) return null;
  let a = 0;
  for (const o of outlinesPx) a += outlineStats(o, pxPerFt)?.areaSqft ?? 0;
  return a || null;
}

// Only the three settings that genuinely shape a decomposition are in this
// dependency list, so moving an unrelated slider does not re-enumerate and
// cannot invalidate a choice that is still perfectly valid.
export function buildChunkOpt({ targetArea, minChunk, minChunkArea, fanClearance }) {
  return { targetArea, minChunk, minChunkArea, fanClearance };
}

// What the canvas draws: every zone, whoever it belongs to. The planner sees
// the per-room subsets above; this is only for the eye.

// THE PLAN-WIDE `coved` LIST IS GONE WITH THE SECTION IT FED. A cove is now
// described inside its own space's row in the Spaces list, which reads
// `r.cove` directly — so a list of every coved space on the plan is a
// derivation with nothing left to derive it for.

/**
 * The zones that are DRAWN, which is not the same set as the zones that are
 * OBEYED.
 *
 * `zoneList` is what the planner gets: hand-drawn zones plus whatever the bed
 * detector found, because a light over a bed is wrong whether or not anybody
 * was shown a rectangle about it. What goes on screen is the hand-drawn ones
 * and the enclosed spaces — the first because the user put them there and has
 * to be able to see and remove them, the second because it is a fact about
 * the plan's own geometry.
 *
 * The bed zones are neither. They are the visible half of a pipeline that
 * runs two detectors and a judge over the plan before anyone sees it, and
 * they were being drawn as if they were part of the design — a hatched box
 * across the bed, on a sheet handed to a client, explaining a decision nobody
 * asked about. The zone still moves the fittings. It just stops arguing.
 */
export function buildDrawnZones({ zones, rooms, enclosedZones }) {
  return [...zones, ...rooms.flatMap((r) => enclosedZones(r.outline))];
}

/** The room the right-hand panel and the chunk picker are talking about. */
export function buildFocus({ rooms, focusId }) {
  return rooms.find((r) => r.id === focusId) || rooms[0] || null;
}

/* --- THE SPACE THE PANEL IS OPENED ON, WHICH IS NOT `focus` ---------------
   `focus` falls back to the first room so that the drawing always has
   something to talk about; the detail view must not. Opening a space is a
   deliberate act and closing it puts the list back, so a fallback here would
   make "Back to Spaces" a button that goes nowhere. */
export function buildOpenRoom({ rooms, focusId }) {
  return (focusId ? rooms.find((r) => r.id === focusId) ?? null : null);
}

/**
 * A room that sits wholly inside another becomes a NO-LIGHT ZONE in the outer
 * one.
 *
 * Subtracting it would be better and is what happens whenever the geometry
 * allows (see roomBooleans.js) — but an annulus is not a polygon the planner
 * can lay a grid inside, and the alternative to this is a ceiling laid over a
 * room that is not the room being lit. The zone is keyed to the OUTER room
 * only: put it in the global list and the inner room would find a no-light
 * zone covering the whole of itself and come back with no lights at all.
 */
export function enclosedZones(outline) {
  if (!outline?.enclosingPx?.length) return [];
  return outline.enclosingPx.map((poly, i) => {
    const b = bbox(poly);
    return { id: `encl-${outline.id}-${i}`, source: 'enclosed', cls: 'room',
             x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
  });
}


export function buildLitOutlines({ outlinesPx, litIds }) {
  return outlinesPx.filter((o) => litIds.includes(o.id));
}
