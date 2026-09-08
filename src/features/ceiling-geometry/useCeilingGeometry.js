// ---------------------------------------------------------------------------
// useCeilingGeometry.js — THE CEILING-GEOMETRY AUTHORING DOMAIN.
//
// WHAT IT IS. The coves, the guides and the magnetic-track RUNS are one store
// and one tool: six primitives, two pens, a tick, grips, a duplicate and a bin.
// A run is a ceiling shape with `role: 'track'` — see lib/magTrack.js for the
// argument — which is why there is no second store of paths and why everything
// here reads "shape" where a reader might expect three nouns. Beside them are
// the DRAWN tracks, which are a different thing with the same word on it: a
// path clicked out over the plan in `manualTracks`, with its own pen, its own
// point editor and its own refusal messages.
//
// `usePlanDoc` REMAINS THE PERSISTENT-DOCUMENT BOUNDARY. Two stores belong to
// this domain — `ceilingShapes` and `manualTracks` — and both are still the
// document's, read out of the `doc` App hands in and written through the
// supplied `docActions`. Nothing is copied here. What IS held here is the
// authoring session: which primitive is armed, where a drag started, what the
// pens have clicked out, which borrowed outline is being offset, which shape is
// showing its grips, and which track point is picked up. None of it is a fact
// about the plan and none of it survives a reopen. See `useGeometryState`.
//
// FOUR CALL SITES, AND APP'S OWN ORDERING DECIDES EVERY ONE OF THEM. A hook's
// arguments are evaluated during render, and this domain has readers and
// dependencies on both sides of it:
//
//   1. `useGeometryState` — the session. First, because `pressState` (the
//      canvas's arbitration table, lib/pressOwner.js) carries `shapeMenuOn`
//      and `shapeTool`, and `resetForNewPlan` calls three of its resets.
//
//   2. THIS CALL — every derived answer and the scene's shape projections.
//      Here, because the COB array's projections and its two commands read
//      `arrayOutline`, and they are built four hundred lines above anything
//      that could give this feature its stand-down list.
//
//   3. `useGeometryCommands` — every act that is not a pointer gesture. Below
//      `disarmAdd`, because arming this tool has to put six other machines
//      away and that list is App's.
//
//   4. `useGeometryGestures` — the pointer. Below `snapTargets`, which is
//      App's (the ceiling objects, the lights and the COB snap against it too)
//      and which needs `coveShapesPx` from this call.
//
// The electrical feature is split in two for the same reason and the scene
// feature across several.
//
// THE SCENE'S OWN SHAPE PROJECTIONS ARE CALLED FROM HERE, and that is the one
// cross-feature import in this file. `useSceneShapeProjections` is a public
// adapter of features/scene (see its README) and every one of its inputs but
// `rooms`, `pxPerFt` and the two document stores is private to this feature —
// the draft, both pens, the tool and the open track — so the call has to stand
// on this side of the line. Nothing else of scene's is touched.
// ---------------------------------------------------------------------------
import { useSceneShapeProjections } from '../scene/useSceneFixtureProjections.js';
import { useGeometryDerivations } from './useGeometryDerivations.js';

export function useCeilingGeometry({
  // --- the session, composed at App's earlier call site --------------------
  state,
  // --- the scene ------------------------------------------------------------
  rooms, pxPerFt, opt,
  // --- the shared selection service ----------------------------------------
  selShapeId,
  // --- the other machines on this canvas, as facts ---------------------------
  addTool, cobMode, boardPlace, zoneMode, readOnly,
  // --- the document ----------------------------------------------------------
  doc,
}) {
  const { ceilingShapes, manualTracks } = doc;
  const {
    shapeMenuOn, shapeTool, shapeRole, shapeSides, shapeAskSides, shapeSpan,
    shapeEditId, shapeResize, shapeDrag, trackEditId, selTrackPt, trackGrip,
    geomHover, covePen, trackPen,
  } = state;

  const derivations = useGeometryDerivations({
    state, rooms, pxPerFt, ceilingShapes, manualTracks, opt,
    selShapeId, addTool, cobMode, boardPlace, zoneMode, readOnly,
  });
  const {
    roomForSlot, shapeDraft, selShape, shapeMode, shapeToCommit, canCommitShape,
    heldAsks, canFinishOpen, coveDraw, arrayOutline, shapeAtPointer, geomUnder,
    trackNotes, trackNoteLines,
  } = derivations;

  const { projections: { coveShapesPx, draftShapePx, trackDraftPx, trackEditPx, penDraftPx } } =
    useSceneShapeProjections({
      ceilingShapes, rooms, pxPerFt, shapeDraft, addTool, trackPen, trackEditId, manualTracks,
      shapeMenuOn, shapeTool, covePen
    });

  return {
    /** The committed shapes, and the one the contextual bar is talking about. */
    shapes: {
      all: ceilingShapes,
      selected: selShape,
      editId: shapeEditId,
      resizing: shapeResize,
      dragging: shapeDrag,
    },
    /** THE HIT TEST, ONCE. Both geometry-taking tools and the three hover cues
     *  ask the same two questions of the same tolerance — see `shapeAtPointer`
     *  and `geomUnder`. The COB array and the module tool are App's and reach
     *  them through here. `roomForSlot` is the third: which space a press on a
     *  wall was aimed at. */
    lookup: { at: shapeAtPointer, forTool: geomUnder, roomForSlot },
    /** THE PATH AN ARRAY IS SET OUT ON — geometry or room outline, one
     *  function for both. The fixture domain's entry into this one. */
    arrayOutline,
    /** THE DRAWN TRACKS: the path that is open, the point picked out of it, the
     *  grip in flight, and why a run that was refused is not on the plan. */
    tracks: {
      editId: trackEditId, selPt: selTrackPt, grip: trackGrip,
      notes: trackNotes, noteLines: trackNoteLines,
      penEmpty: trackPen.isEmpty,
    },
    /** What PlanCanvas draws. The handlers are the fourth call's — see
     *  `useGeometryGestures` — because they need the snap engine. */
    canvas: {
      coveShapes: coveShapesPx,
      draftShape: draftShapePx,
      penDraft: penDraftPx,
      trackDraft: trackDraftPx,
      trackEdit: trackEditPx,
      hoverId: geomHover,
      /* THE FITTINGS STAND DOWN AND THE GUIDES COME UP WHILE A PRIMITIVE IS
         ARMED. `shapeMenuOn` alone is not the condition: the bar also arrives
         unarmed on a click in a space (see `onCanvasClick`), and dimming a
         ceiling's worth of lamps because somebody selected a room would be the
         drawing reacting to a selection. It is the LIVE primitive that means
         "I am about to place geometry". */
      placingGeometry: shapeMenuOn && !!shapeTool,
      /* THE KEEP-OUT BAND, AND ONLY WHILE IT IS BEING MET. True while a cove is
         being drawn, moved or resized — the three states in which somebody is
         placing one and can be stopped by it. On a finished sheet it would be a
         rule drawn over a drawing for nobody to meet. */
      clampLive: (shapeMenuOn && shapeTool) || shapeDrag?.moved || shapeResize,
    },
    /** The floating bar on the drawing. See ShapeMenu. */
    bar: {
      mode: shapeMode, tool: shapeTool, sides: shapeSides, askSides: shapeAskSides,
      canCommit: canCommitShape, toCommit: shapeToCommit, offset: heldAsks,
    },
    /** The step that takes the right-hand column over while a cove is drawn. */
    panel: { coveDraw, canFinishOpen },
    /** The pens, whole — the keydown handler undoes and resets them directly
     *  rather than through a command that would only forward the call. */
    pens: { cove: covePen, track: trackPen },
    /** What is in flight, for the keydown handler's precedence and the cursor. */
    status: {
      menuOn: shapeMenuOn, tool: shapeTool, role: shapeRole,
      span: shapeSpan, draft: shapeDraft, penEmpty: covePen.isEmpty,
      geomHover,
    },
    /** What a fresh sheet takes away. Three members because
     *  `resetForNewPlan` did not run the statements together. */
    reset: state.reset,
  };
}

export default useCeilingGeometry;
