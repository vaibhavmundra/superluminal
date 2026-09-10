import { useMemo, useCallback } from 'react';
import {
  projectMagTracksPx, projectTrackModulesPx, projectArrayCobsPx,
  projectDraftArrayPx, projectSelectedArrayPathPx, projectManualCobsPx,
  projectCoveShapesPx, projectDraftShapePx, projectTrackDraftPx,
  projectTrackEditPx, projectShapeEditPx, projectPenDraftPx,
  projectSuggestedPointsPx,
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


/**
 * THE SUGGESTED GRID, AS ONE LIST OF POINTS.
 *
 * A STAGE OF ITS OWN AND NOT A LINE IN App, because it is a projection like
 * every other one in this file and App is the orchestrator: it decides the
 * ORDER these run in and who gets the answer, not how an answer is made. The
 * whole of the rule — which fields, which gate, what a mark's radius is — lives
 * in `projectSuggestedPointsPx`.
 *
 * `layers` IS THE DERIVED OBJECT AND NOT THE DOCUMENT'S. App narrows the layers
 * for the steps that take the sheet down to one subject — the wall editor drops
 * `lights` and `spots` — and a suggestion left snappable under one of those
 * would be an invisible target catching a corner aimed at a wall. Reading the
 * derived object gets that for free; reading `doc.layers` would not.
 *
 * ONE LIST FOR TWO READERS, which is the reason it is resolved once at all: the
 * canvas draws these and the snap engine aims at them, and a centre computed
 * twice is a ring the guide does not catch.
 */
export function useSceneSuggestProjections({ rooms, taskSpotsPx, pxPerFt, layers }) {
  const on = !!layers?.suggestGrid, ambient = !!layers?.lights, spots = !!layers?.spots;
  const suggestPointsPx = useMemo(
    () => projectSuggestedPointsPx(rooms, taskSpotsPx, pxPerFt, { on, ambient, spots }),
    [rooms, taskSpotsPx, pxPerFt, on, ambient, spots]);
  return { projections: { suggestPointsPx } };
}


export function useSceneManualProjections({ manualCobs, pxPerFt, ceilingMmFor }) {
  const manualCobsPx = useMemo(() => projectManualCobsPx(manualCobs, pxPerFt, ceilingMmFor), [manualCobs, pxPerFt, ceilingMmFor]);
  return { projections: { manualCobsPx } };
}


export function useSceneShapeProjections({
  ceilingShapes, rooms, pxPerFt, shapeDraft, addTool, trackPen, trackEditId, manualTracks,
  shapeMenuOn, shapeTool, covePen, shapeEditId
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

  /* THE SHAPE'S OWN POINT EDITOR. It takes precedence over the drawn track's
     when both are live, because pressing a shape closes the track editor
     anyway — see `shapePointerDown` — so the two cannot both be what the hand
     is on. */
  const shapeEditPx = useMemo(() => projectShapeEditPx(pxPerFt, shapeEditId, ceilingShapes), [pxPerFt, shapeEditId, ceilingShapes]);

  const penDraftPx = useMemo(() => projectPenDraftPx(pxPerFt, shapeMenuOn, shapeTool, covePen.pts, covePen.at, covePen.isEmpty), [pxPerFt, shapeMenuOn, shapeTool, covePen.pts, covePen.at, covePen.isEmpty]);
  return { projections: { coveShapesPx, draftShapePx, trackDraftPx, trackEditPx, shapeEditPx, penDraftPx } };
}
