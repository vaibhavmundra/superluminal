import { useMemo, useCallback } from 'react';
import {
  projectMagTracksPx, projectTrackModulesPx, projectArrayCobsPx,
  projectDraftArrayPx, projectSelectedArrayPathPx, projectManualCobsPx,
  projectCoveShapesPx, projectDraftShapePx, projectTrackDraftPx,
  projectTrackEditPx, projectPenDraftPx,
} from '../../lib/fixtureProjection.js';
import { outlineFt as shapeOutlineFt } from '../../lib/ceilingShapes.js';

// Separate stages accept resolved inputs from App. Drafts are projections only;
// the gesture state and editing commands stay with their existing owners.
export function useSceneTrackProjections({ ceilingShapes, rooms, pxPerFt, trackFixtures }) {
  const magTracksPx = useMemo(() => projectMagTracksPx(ceilingShapes, rooms, pxPerFt), [ceilingShapes, rooms, pxPerFt]);

  const magTrackById = useMemo(
    () => Object.fromEntries(magTracksPx.map((t) => [t.id, t])), [magTracksPx]);

  const trackModulesPx = useMemo(() => projectTrackModulesPx(trackFixtures, magTrackById, pxPerFt), [trackFixtures, magTrackById, pxPerFt]);
  return { projections: { magTracksPx, magTrackById, trackModulesPx } };
}


export function useSceneArrayProjections({
  cobArrays, arrayOutline, pxPerFt, ceilingMmFor, cobDraftArray, selArrayId
}) {
  const arrayCobsPx = useMemo(() => projectArrayCobsPx(cobArrays, arrayOutline, pxPerFt, ceilingMmFor), [cobArrays, arrayOutline, pxPerFt, ceilingMmFor]);

  const draftArrayPx = useMemo(() => projectDraftArrayPx(cobDraftArray, arrayOutline, pxPerFt), [cobDraftArray, arrayOutline, pxPerFt]);

  const selArrayPathPx = useMemo(() => projectSelectedArrayPathPx(cobArrays, selArrayId, arrayOutline, pxPerFt), [cobArrays, selArrayId, arrayOutline, pxPerFt]);
  return { projections: { arrayCobsPx, draftArrayPx, selArrayPathPx } };
}


export function useSceneManualProjections({ manualCobs, pxPerFt, ceilingMmFor }) {
  const manualCobsPx = useMemo(() => projectManualCobsPx(manualCobs, pxPerFt, ceilingMmFor), [manualCobs, pxPerFt, ceilingMmFor]);
  return { projections: { manualCobsPx } };
}


export function useSceneShapeProjections({
  ceilingShapes, rooms, pxPerFt, shapeDraft, addTool, trackPen, trackEditId, manualTracks,
  shapeMenuOn, shapeTool, covePen
}) {
  const litShapeIds = useMemo(() => new Set(
    rooms.flatMap((r) => (r.coves ?? []).map((c) => c.shapeId).filter(Boolean))),
    [rooms]);

  const shapePts = useCallback((sh, grow = 0) => (pxPerFt
    ? shapeOutlineFt(sh, grow).map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt }))
    : []), [pxPerFt]);

  const coveShapesPx = useMemo(() => projectCoveShapesPx(ceilingShapes, litShapeIds, shapePts, pxPerFt), [ceilingShapes, litShapeIds, shapePts, pxPerFt]);

  const draftShapePx = useMemo(() => projectDraftShapePx(shapeDraft, shapePts, pxPerFt), [shapeDraft, shapePts, pxPerFt]);

  const trackDraftPx = useMemo(() => projectTrackDraftPx(pxPerFt, addTool, trackPen.pts, trackPen.at, trackPen.isEmpty), [pxPerFt, addTool, trackPen.pts, trackPen.at, trackPen.isEmpty]);

  const trackEditPx = useMemo(() => projectTrackEditPx(pxPerFt, trackEditId, manualTracks), [pxPerFt, trackEditId, manualTracks]);

  const penDraftPx = useMemo(() => projectPenDraftPx(pxPerFt, shapeMenuOn, shapeTool, covePen.pts, covePen.at, covePen.isEmpty), [pxPerFt, shapeMenuOn, shapeTool, covePen.pts, covePen.at, covePen.isEmpty]);
  return { projections: { coveShapesPx, draftShapePx, trackDraftPx, trackEditPx, penDraftPx } };
}
