// ---------------------------------------------------------------------------
// useBoardStep.js — PUTTING SWITCHBOARDS ON WALLS BY HAND.
//
// THE FEATURE'S FIRST CALL SITE, AND APP'S OWN ORDERING DECIDES IT. `pressState`
// — the canvas's one arbitration table, see lib/pressOwner.js — carries this
// step's flag, and it is built four hundred lines above anything that could give
// this feature its geometry or its pointer. A hook's arguments are evaluated
// during render, so the step is asked for on its own, early, and the rest of the
// domain is composed later and handed the result. The room-intelligence feature
// is split across two calls for the same reason.
//
// A STEP, LIKE THE DOOR EDITOR AND THE ZONE EDITOR — it takes the panel over and
// stays open across placements, because somebody putting a board on one wall is
// usually putting one on three.
// ---------------------------------------------------------------------------
import { useCallback, useState } from 'react';
import { clear } from '../../lib/selection.js';

export function useBoardStep({ setSel, docActions }) {
  const [boardPlace, setBoardPlace] = useState(false);

  /* --- PUTTING SWITCHBOARDS ON WALLS BY HAND --------------------------------
     THE THIRD STEP ON THIS SCREEN, AND THE SAME SHAPE AS THE OTHER TWO. Like
     the door editor and the zone editor it empties the panel, owns the pointer
     and stays open until it is closed — and for the same reason all three do:
     what is being asked for is a GESTURE ON THE DRAWING, and the panel's job
     while it is being made is to say what the gesture is and get out of the way.

     IT STAYS OPEN ACROSS PLACEMENTS, which is the whole of why it is a step and
     not the one-shot the rest of the palette uses. A fan is dropped one at a
     time; boards come in threes, because a room has a door wall and two others
     somebody wants a switch on. A tool that disarmed after the first plate would
     mean going back to the palette between each one.

     STANDING EVERY OTHER GESTURE DOWN ON THE WAY IN IS APP'S HALF, exactly as it
     is for the wall step: one pointer pipeline, one owner, and App is the only
     place that knows all seven owners. What is here is the step itself. */
  const openBoardPlace = useCallback(() => {
    setBoardPlace(true);
    setSel(clear());
    /* THE WIRING LAYER COMES ON WITH IT. A plate placed on a sheet with the
       electricals switched off lands invisibly — the gesture appears to do
       nothing at all — and the entire point of the red plate is that somebody
       can see it is not connected yet. */
    docActions.setLayer('electrical', true);
  }, [setSel, docActions]);

  const closeBoardPlace = useCallback(() => setBoardPlace(false), []);

  return { boardPlace, setBoardPlace, openBoardPlace, closeBoardPlace };
}

export default useBoardStep;
