import { useMemo } from 'react';
import useAccentEditing from './useAccentEditing.js';
import useTaskSpots from './useTaskSpots.js';

/**
 * ROOM INTELLIGENCE, THE HAND-EDITING HALF.
 *
 * What a person does to what the model proposed: drag an accent run's end,
 * slide a sconce, trim a derived cove, delete a fitting, pick a directional
 * spot, delete the surface a spot was placed for. Same feature and the same
 * document boundary as `useRoomIntelligence`; a second hook only because of
 * where App can call it — see the note there.
 *
 * NO PERSISTENT STATE. One drag in flight, and every write is a document
 * action.
 */
export default function useRoomEditing({
  rooms, pxPerFt, zoom, svgPoint, svgRef, pressState,
  accentZonesPx, taskSpotsPx, manualAccents, manualCoves, manualSurfaces,
  addTool, zoneMode, setSel, setArmed, deleteShape, docActions,
}) {
  const accents = useAccentEditing({
    rooms, pxPerFt, zoom, svgPoint, svgRef, pressState,
    accentZonesPx, manualAccents, manualCoves,
    setSel, setArmed, deleteShape, docActions,
  });

  const spots = useTaskSpots({
    taskSpotsPx, manualSurfaces, addTool, zoneMode, setSel, setArmed, docActions,
  });

  const canvas = useMemo(() => ({
    accentDrag: accents.drag,
    onAccPointerDown: accents.accPointerDown,
    accPointerMove: accents.accPointerMove,
    accPointerUp: accents.accPointerUp,
    onSpotPointerDown: spots.spotPointerDown,
  }), [accents.drag, accents.accPointerDown, accents.accPointerMove,
       accents.accPointerUp, spots.spotPointerDown]);

  const commands = useMemo(() => ({
    updateAccentZone: accents.updateAccentZone,
    deleteAccent: accents.deleteAccent,
    deleteSpot: spots.deleteSpot,
  }), [accents.updateAccentZone, accents.deleteAccent, spots.deleteSpot]);

  const reset = useMemo(() => ({
    accentEditing: accents.resetAccentEditing,
  }), [accents.resetAccentEditing]);

  return { canvas, commands, reset };
}
