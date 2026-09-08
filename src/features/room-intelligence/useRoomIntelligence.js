import { useMemo } from 'react';
import useRoomTypePass from './useRoomTypePass.js';
import useAccentPass from './useAccentPass.js';
import useSurfacePass from './useSurfacePass.js';
import useRenderPass from './useRenderPass.js';
import useWallMaterials from './useWallMaterials.js';

/**
 * ROOM INTELLIGENCE — everything this app asks a model ABOUT ONE ROOM.
 *
 * Four passes and one step, and they are one feature because they share a
 * subject and a picture. The subject is a single space with every other space
 * on the sheet erased; the picture is `roomSnapshot`'s crop of it, which the
 * classifier, the accent pass and the task-surface pass take turns at within a
 * single pipeline run rather than rendering three times. The render pass is the
 * odd one — it reads photographs rather than the drawing — but it puts its
 * answer back on the same crop with a 1ft grid on it, and the wall step is what
 * a person does to the same room by hand afterwards.
 *
 * THE DOCUMENT IS NOT SPLIT AND IS NOT COPIED. `usePlanDoc` remains the single
 * persistent boundary: the answers (`roomTypes`, `accentResults`,
 * `surfaceResults`, `wallResults`), the decisions taken against them
 * (`accentDismissed`, `surfaceDismissed`, `artDismissed`, `runsOff`,
 * `runTrims`), the fittings placed by hand (`manualAccents`, `manualSurfaces`,
 * `manualCoves`) and the stored render pointers (`renderRefs`) are all still
 * the document's, written through `docActions`. What lives here is the session:
 * which room is being asked about, whether a call is in flight, the crops, the
 * transcripts and the working copies of the uploaded views.
 *
 * TWO CALL SITES, AND THE SECOND ONE IS `useRoomEditing`. App's own ordering
 * decides it: the passes are needed by the lighting pipeline, which is defined
 * long before the pointer helpers and the ceiling-shape delete that the manual
 * accent gesture depends on. The scene feature is split across three calls for
 * the same reason. Nothing is shared between the two but the document.
 */
export default function useRoomIntelligence({
  source, img, wallLayerSet, pxPerFt, ceilingFt, projectId,
  rooms, focus, materials, accentResults, doors, renderRefs, renderStore,
  readOnly, onClaimPass, onReleasePass, docActions,
}) {
  const { computeRoomType } = useRoomTypePass({ source, img, wallLayerSet, projectId });

  const accents = useAccentPass({
    source, img, wallLayerSet, pxPerFt, ceilingFt, rooms, docActions,
  });

  const surfaces = useSurfacePass({ source, img, wallLayerSet, pxPerFt, docActions });

  const render = useRenderPass({
    source, img, wallLayerSet, pxPerFt, focus,
    accentResults, doors, renderRefs, renderStore,
    readOnly, onClaimPass, onReleasePass, docActions,
  });

  const walls = useWallMaterials({ rooms, materials, docActions });

  const canvas = useMemo(() => ({
    /* WHAT THE CANVAS IS HANDED WHILE THE WALL STEP IS OPEN, and the id on its
       own for the layer switches and the panel branches that only need to know
       whether the step is running. */
    wallEdit: walls.wallEditGeo,
    wallEditId: walls.wallEdit,
    onWallSegment: walls.pickWallSegment,
  }), [walls.wallEditGeo, walls.wallEdit, walls.pickWallSegment]);

  const panel = useMemo(() => ({
    accentRoom: accents.room,
    accentRoomId: accents.roomId, setAccentRoomId: accents.setRoomId,
    accentShot: accents.shot,
    surfaceRoomId: surfaces.roomId, setSurfaceRoomId: surfaces.setRoomId,
    renders: render.renders,
    wallShot: render.shot,
    wallTranscripts: render.transcripts,
    wallGrid: render.grid,
    wallPick: walls.wallPick, setWallPick: walls.setWallPick,
    /* THE SPACE THE WALL STEP IS ASKING ABOUT, as a room and not an id: the
       step's own panel prints its name and the mix of tones so far. */
    wallEditRoom: walls.wallEditRoom,
    materialsEdit: walls.materialsEdit, setMaterialsEdit: walls.setMaterialsEdit,
  }), [accents.room, accents.roomId, accents.setRoomId, accents.shot,
       surfaces.roomId, surfaces.setRoomId,
       render.renders, render.shot, render.transcripts, render.grid,
       walls.wallPick, walls.setWallPick, walls.wallEditRoom,
       walls.materialsEdit, walls.setMaterialsEdit]);

  const commands = useMemo(() => ({
    computeRoomType,
    computeAccents: accents.computeAccents, setAccentState: accents.setState,
    computeSurfaces: surfaces.computeSurfaces, setSurfaceState: surfaces.setState,
    computeWallItems: render.computeWallItems,
    runWallPass: render.runWallPass,
    addRenders: render.addRenders,
    setSurfaceTone: walls.setSurfaceTone,
    setWallTone: walls.setWallTone,
    pickWallSegment: walls.pickWallSegment,
    openWallEdit: walls.openWallEdit,
    closeWallEdit: walls.closeWallEdit,
  }), [computeRoomType, accents.computeAccents, accents.setState,
       surfaces.computeSurfaces, surfaces.setState,
       render.computeWallItems, render.runWallPass, render.addRenders,
       walls.setSurfaceTone, walls.setWallTone, walls.pickWallSegment,
       walls.openWallEdit, walls.closeWallEdit]);

  /* EACH PASS CARRIES ITS OWN roomId, and that is the whole reason there are
     three statuses rather than one. A failure on room A left its error banner
     sitting under room B's controls when the status was bare. */
  const status = useMemo(() => ({
    accent: accents.state,
    surface: surfaces.state,
    wall: render.state,
    running: accents.state.status === 'running'
      || surfaces.state.status === 'running'
      || render.state.status === 'running',
  }), [accents.state, surfaces.state, render.state]);

  /* FIVE RESETS AND NOT ONE, because `resetForNewPlan` did not run them
     together: they were interleaved with the recognition resets, the board
     stores and the hand-placed coves, and a reducer dispatch order is not
     something an extraction gets to tidy up. App calls these where the
     statements they replace stood. */
  const reset = useMemo(() => ({
    accentRoom: accents.resetAccentRoom,
    accentProposals: accents.resetAccentProposals,
    renders: render.resetRenders,
    renderState: render.resetRenderState,
    surfaces: surfaces.resetSurfaces,
  }), [accents.resetAccentRoom, accents.resetAccentProposals,
       render.resetRenders, render.resetRenderState, surfaces.resetSurfaces]);

  return { canvas, panel, commands, status, reset };
}
