import { useMemo } from 'react';
import { projectObstaclesPx, projectCeilingObstaclesPx, projectWardrobesPx } from '../../lib/planProjection.js';
import { layoutRooms } from '../../lib/layout.js';
import { buildPlanAreaSqft, buildChunkOpt, buildDrawnZones, buildFocus, buildOpenRoom } from './roomGeometry.js';
import { buildBedsPerRoom, buildDetectedZones } from './bedZones.js';
import { buildReverseCoves, buildShelfStrips, buildWardrobeZones, buildReverseCoveZones, buildZoneList } from './wallGeometry.js';

// Derived values only. Keep the individual memo boundaries: a focus change or
// an unrelated option must not recreate layout geometry or invalidate picks.
export default function usePlanScene({
  source, pxPerFt, outlines, outlinesPx, litOutlines, enclosedZones, focusId, ceilingObjs,
  accentResults, detections, dismissed, wallResults, useBoundingRect, doors, runTrims, manualCoves,
  runsOff, zones, opt, chunkPicks, roomTypes, projectId, designPicks, ceilingKinds, ceilingShapes,
  lightMoves, manualTracks, isAdmin, autoLights
}) {
  // THE RED-CIRCLE FAN DETECTOR IS GONE.
  //
  // It scanned the raster for round red blobs, called each one a ceiling fan,
  // and — for a while — used their blade circles as the drawing's RULER. Both
  // halves of that have been retired. The scale comes from a door, which is a
  // thing that is actually standard; and a fan is now placed by hand from the
  // ceiling palette, in feet, like every other object on the ceiling.
  //
  // The reason to delete it rather than leave it switched off: it was guessing
  // from COLOUR, which is the least reliable signal on a drawing — a red
  // dimension leader, a north arrow, a revision cloud, a hatched WC are all
  // round-ish and red-ish on some office's sheet. A detector nobody trusts
  // still fills a state array that eight other things read from, and it
  // silently placed obstacles the user never asked for.
  //
  // What stays is everything downstream: `fanClearance`, the chunker's
  // preference for holding an obstacle clear, `cellIsAwkward`. Those never cared
  // where an obstacle came from — planner.js calls them "fans" because that was
  // the first kind it met.
  const obstaclesPx = useMemo(() => projectObstaclesPx(ceilingObjs, pxPerFt), [ceilingObjs, pxPerFt]);

  const ceilingObstaclesPx = useMemo(() => projectCeilingObstaclesPx(obstaclesPx), [obstaclesPx]);

  const planAreaSqft = useMemo(() => buildPlanAreaSqft({ outlinesPx, pxPerFt }), [outlinesPx, pxPerFt]);

  const bedsPerRoom = useMemo(() => buildBedsPerRoom({ outlines, accentResults }), [outlines, accentResults]);

  const detectedZones = useMemo(() => {
    const result = buildDetectedZones({ detections, dismissed, source, pxPerFt, bedsPerRoom });
    for (const { level, args } of result.diagnostics) console[level](...args);
    return result.zones;
  }, [detections, dismissed, source, pxPerFt, bedsPerRoom]);

  const reverseCoves = useMemo(() => buildReverseCoves({ source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,
      manualCoves, runsOff }), [source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,
      manualCoves, runsOff]);

  const wardrobesPx = useMemo(() => projectWardrobesPx(litOutlines, accentResults), [litOutlines, accentResults]);

  const wardrobeZones = useMemo(() => buildWardrobeZones({ wardrobesPx }), [wardrobesPx]);

  const reverseCoveZones = useMemo(() => buildReverseCoveZones({ reverseCoves }), [reverseCoves]);

  const shelfStrips = useMemo(() => buildShelfStrips({ source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,
      runsOff }), [source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,
      runsOff]);

  const zoneList = useMemo(() => buildZoneList({ zones, detectedZones, wardrobeZones, reverseCoveZones }), [zones, detectedZones, wardrobeZones, reverseCoveZones]);

  const chunkOpt = useMemo(() => buildChunkOpt({
    targetArea: opt.targetArea, minChunk: opt.minChunk,
    minChunkArea: opt.minChunkArea, fanClearance: opt.fanClearance,
  }), [opt.targetArea, opt.minChunk, opt.minChunkArea, opt.fanClearance]);

  /**
   * THE WHOLE PLAN, ROOM BY ROOM.
   *
   * This used to be six hooks in a column — region, geo, chunking, the chosen
   * chunking, the layout — each holding the one room being lit. They are one
   * loop now, and the reason is not tidiness: a floor plan's rooms arrive
   * together from the detector, so they are laid out together, and a per-room
   * value cannot live in a hook when the number of rooms is not known until the
   * detector answers.
   *
   * The pipeline inside the loop is UNCHANGED, deliberately. Each room is still
   * an outline resolved to a polygon, a polygon converted into its own local
   * feet space with its own origin, a decomposition enumerated on that space and
   * a layout computed inside the chosen one. Feeding the planner a room-local
   * space rather than a plan-wide one is what keeps eight rooms eight
   * independent problems: nothing about room 3's layout can perturb room 4's,
   * and the numbers the planner sees are the same numbers it saw when there was
   * only ever one room. The plan-wide coordinates the exporters need are
   * recovered from the pixel space instead — see exporters.js.
   *
   * WHAT DID CHANGE is the chunking choice. With one room, an ambiguous
   * decomposition was worth stopping the world for; with eight, stopping eight
   * times is not a choice, it is an interrogation. So an unanswered room takes
   * the recommendation and says so, and the picker is somewhere to go rather
   * than a gate to get through.
   */
  /* `autoLights` IS IN HERE WITH THE GEOMETRY AND NOT IN A LAYER PROP, and it
     is the one input on this list that is a VIEW answer rather than a fact
     about the plan. It has to be: the switch turns the gridding engine on and
     off (see AUTO_GRID in layout.js), so flipping it is a different layout of
     the same rooms, and a memo that did not name it would go on serving the
     answer from before the press. What that costs is a re-layout per flip,
     which is the same cost a re-chunk or a moved fan already pays. */
  const rooms = useMemo(() => layoutRooms({
    source, pxPerFt, litOutlines, useBoundingRect, ceilingObstaclesPx, zoneList,
    zones, reverseCoveZones, chunkOpt, chunkPicks, opt, enclosedZones, roomTypes,
    projectId, designPicks, ceilingKinds, ceilingShapes, lightMoves, manualTracks,
    isAdmin, autoLights,
  }), [source, pxPerFt, litOutlines, useBoundingRect, ceilingObstaclesPx, zoneList, zones,
      reverseCoveZones, chunkOpt, chunkPicks, opt, enclosedZones, roomTypes, projectId,
      designPicks, ceilingKinds, ceilingShapes, lightMoves, manualTracks, isAdmin,
      autoLights]);

  const drawnZones = useMemo(() => buildDrawnZones({ zones, rooms, enclosedZones }), [zones, rooms, enclosedZones]);

  const focus = useMemo(() => buildFocus({ rooms, focusId }), [rooms, focusId]);

  const openRoom = useMemo(() => buildOpenRoom({ rooms, focusId }), [rooms, focusId]);

  return {
    rooms: { items: rooms, focus, openRoom, litOutlines, planAreaSqft },
    architecture: { obstaclesPx, ceilingObstaclesPx },
    furnishings: { bedsPerRoom, detectedZones, wardrobesPx, shelfStrips },
    lightingGeometry: { reverseCoves, wardrobeZones, reverseCoveZones, zoneList, drawnZones, chunkOpt },
  };
}
