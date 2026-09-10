import { useMemo } from 'react';
import useAccentEditing from './useAccentEditing.js';
import useTaskSpots from './useTaskSpots.js';

/**
 * ROOM INTELLIGENCE, THE HAND-EDITING HALF.
 *
 * What a person does to what the model proposed: drag an accent run's end,
 * slide a sconce, trim a derived cove, delete a fitting, pick a directional
 * spot, carry one that was placed by hand, delete the surface a spot was
 * placed for. Same feature and the same document boundary as
 * `useRoomIntelligence`; a second hook only because of where App can call it —
 * see the note there.
 *
 * NO PERSISTENT STATE. Two drags in flight — an accent run's and a hand-placed
 * spot's — and every write is a document action.
 */
export default function useRoomEditing({
  rooms, pxPerFt, zoom, svgPoint, svgRef, pressState, roomAt,
  accentZonesPx, taskSpotsPx, manualAccents, manualCoves, manualSurfaces,
  manualSpots, addTool, zoneMode, spotAiming, setSel, setArmed, setGuides,
  snapTargets, snapTol, deleteShape, docActions,
}) {
  const accents = useAccentEditing({
    rooms, pxPerFt, zoom, svgPoint, svgRef, pressState,
    accentZonesPx, manualAccents, manualCoves,
    setSel, setArmed, deleteShape, docActions,
  });

  /* THE SPOT'S DRAG TAKES THE POINTER, THE SNAP AND THE ROOM HIT TEST, which
     the accents above already needed for theirs. `snapTargets`, `snapTol` and
     `setGuides` are App's — the ceiling objects, the lights, the geometry and a
     dragged lamp all align against the same collector, so a spot catches the
     same lines rather than a second set — and `roomAt` is the hit test every
     drag on this canvas asks. See useTaskSpots. */
  const spots = useTaskSpots({
    taskSpotsPx, manualSpots, manualSurfaces, pxPerFt, zoom, svgPoint, svgRef,
    pressState, roomAt, addTool, zoneMode, aiming: spotAiming,
    setSel, setArmed, setGuides, snapTargets, snapTol, docActions,
  });

  const canvas = useMemo(() => ({
    accentDrag: accents.drag,
    onAccPointerDown: accents.accPointerDown,
    accPointerMove: accents.accPointerMove,
    accPointerUp: accents.accPointerUp,
    /* THE SPOT'S THREE, in the shape the accent's gesture already has: the
       press is a canvas prop and the move and the release are branches of
       App's own router, because a gesture in flight owns the pointer wherever
       it happens to be. */
    spotDrag: spots.drag,
    onSpotPointerDown: spots.spotPointerDown,
    spotPointerMove: spots.spotPointerMove,
    spotPointerUp: spots.spotPointerUp,
  }), [accents.drag, accents.accPointerDown, accents.accPointerMove,
       accents.accPointerUp, spots.drag, spots.spotPointerDown,
       spots.spotPointerMove, spots.spotPointerUp]);

  const commands = useMemo(() => ({
    updateAccentZone: accents.updateAccentZone,
    deleteAccent: accents.deleteAccent,
    deleteSpot: spots.deleteSpot,
  }), [accents.updateAccentZone, accents.deleteAccent, spots.deleteSpot]);

  const reset = useMemo(() => ({
    accentEditing: accents.resetAccentEditing,
    spotEditing: spots.resetSpotEditing,
  }), [accents.resetAccentEditing, spots.resetSpotEditing]);

  return { canvas, commands, reset };
}
