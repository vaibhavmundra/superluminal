import { useMemo } from 'react';
import { projectSurfacesPx, projectArtPiecesPx, projectTaskSpotsPx, projectAccentZonesPx, projectWallCellsPx } from '../../lib/planProjection.js';
export function useScenePlanProjections({
  rooms, surfaceResults, surfaceDismissed, manualSurfaces, wallResults, pxPerFt, artDismissed, opt,
  accentResults, accentDismissed, manualAccents, reverseCoves, shelfStrips, ceilingShapes,
  /* THE AIMED SPOTS SOMEBODY PUT DOWN, which come out of the same projection
     the placer's do — see the fourth pass in `projectTaskSpotsPx` for why they
     join that list rather than getting one of their own. */
  manualSpots = [],
}) {
  const surfacesPx = useMemo(() => projectSurfacesPx(rooms, surfaceResults, surfaceDismissed, manualSurfaces), [rooms, surfaceResults, surfaceDismissed, manualSurfaces]);

  const artPiecesPx = useMemo(() => projectArtPiecesPx(rooms, wallResults, pxPerFt, artDismissed), [rooms, wallResults, pxPerFt, artDismissed]);

  const taskSpotsPx = useMemo(
    () => projectTaskSpotsPx(rooms, surfacesPx, artPiecesPx, opt, manualSpots, pxPerFt),
    [rooms, surfacesPx, artPiecesPx, opt, manualSpots, pxPerFt]);

  const accentZonesPx = useMemo(() => projectAccentZonesPx(rooms, accentResults, accentDismissed, manualAccents, reverseCoves, shelfStrips, ceilingShapes, pxPerFt), [rooms, accentResults, accentDismissed, manualAccents, reverseCoves, shelfStrips,
      ceilingShapes, pxPerFt]);

  const wallCellsPx = useMemo(() => projectWallCellsPx(rooms, wallResults, pxPerFt), [rooms, wallResults, pxPerFt]);
  return { projections: { surfacesPx, artPiecesPx, taskSpotsPx, accentZonesPx, wallCellsPx } };
}
