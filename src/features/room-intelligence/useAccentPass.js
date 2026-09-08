import { useCallback, useEffect, useMemo, useState } from 'react';
import { roomSnapshot, requestAccents } from '../../lib/accentMask.js';
import { accentResultFrom } from './passResults.js';

/**
 * THE ACCENT PASS, AND ONLY THE SESSION SIDE OF IT.
 *
 * What the MODEL proposed is the document's (`accentResults`), the dismissals
 * that qualify it are the document's (`accentDismissed`) and the fittings
 * placed by hand are a third list of the document's again (`manualAccents`).
 * Nothing here duplicates any of the three. What is here is what belongs to
 * this sitting: which room the panel is asking about, whether a run is in
 * flight, and the crop that goes over the wire.
 */
export default function useAccentPass({
  source, img, wallLayerSet, pxPerFt, ceilingFt, rooms, docActions,
}) {
  // --- accent lighting ------------------------------------------------------
  // A SECOND QUESTION ABOUT A ROOM THAT ALREADY HAS A CEILING. Everything above
  // is the ambient layer: a grid, and a light at the centre of every cell. This
  // is the layer that goes on top of it — coves, sconces, picture lights, strips
  // — and it is asked ROOM BY ROOM rather than plan-wide, because the image that
  // goes over the wire is one room with every other room on the sheet erased.
  //
  // Keyed by outline id throughout, so switching rooms in the panel does not
  // lose the answer the last one gave.
  const [accentRoomId, setAccentRoomId] = useState(null);
  // The pass's answers — roomId -> parsed reply, boxes in PLAN px — are in the
  // document reducer, with the dismissals that qualify them. See usePlanDoc.js.
  // Carries its own roomId. Everything else here is keyed by room, and a bare
  // status was the odd one out: a failure on room A left its error banner sitting
  // under room B's controls, over a button still offering to run.
  const [accentState, setAccentState] = useState({ status: 'idle', roomId: null });
  // The image that is actually sent. Held in state rather than made at call
  // time so the panel can show it: "what did it look at" is the first question
  // whenever an answer is strange, and a crop that is off the room or washed
  // out the wrong way is invisible in a list of zones.
  const [accentShot, setAccentShot] = useState(null);

  // --- accent lighting, room by room ----------------------------------------
  //
  // THE MODEL IS NEVER ASKED FOR A COORDINATE. It is asked for a REGION — a
  // rough box round the wall a cove runs along, or round the painting a spot
  // should graze — and the placement of the fitting inside that region is
  // arithmetic done here, later, by code that can measure. That is the whole
  // architecture of this feature and the reason it can work at all where
  // asking for the bed's exact bounds could not: a box 20% too big still
  // contains the right wall, so the several-percent error that makes a point
  // useless is simply absorbed. See the header of accentPrompt.js.
  //
  // Nothing is placed yet. This step produces the zones and draws them; turning
  // a zone into a fixture is the next one.
  const accentRoom = useMemo(
    () => rooms.find((r) => r.id === accentRoomId) || rooms[0] || null,
    [rooms, accentRoomId]);

  /**
   * The picture that goes over the wire, made ahead of the call.
   *
   * Eagerly and not at call time, for two reasons. The panel shows it, and "what
   * did it actually look at" is the first question whenever an answer is odd —
   * a crop that missed the room or a wash that came out the wrong way round is
   * invisible in a list of zones and obvious in a thumbnail. And it re-renders
   * when the LAYOUT changes, not just when the room does, because the ambient
   * lights are drawn onto it: send yesterday's crop and the model is being told
   * about downlights that have since moved.
   */
  useEffect(() => {
    if (!source || !accentRoom?.plan?.ok) { setAccentShot(null); return; }
    let alive = true;
    (async () => {
      try {
        const shot = await roomSnapshot({
          source, img,
          polygonPx: accentRoom.plan.polygonPx,
          lightsPx: accentRoom.plan.lightsPx,
          wallLayers: wallLayerSet,
        });
        if (alive) setAccentShot({ ...shot, roomId: accentRoom.id });
      } catch (err) {
        console.warn('[accents] could not build the room crop:', err);
        if (alive) setAccentShot(null);
      }
    })();
    return () => { alive = false; };
  }, [source, img, accentRoom, wallLayerSet]);

  /**
   * ACCENTS FOR ONE ROOM, without touching state.
   *
   * Pulled out of the button handler because the pipeline needs the same work
   * for a room the panel is not looking at. A handler that reads `accentRoom`
   * and writes `accentResults` cannot be reused for the fourth room of six
   * while the panel is showing the first, and the alternative — driving the
   * panel's state from the pipeline to make the handler fire — is a loop
   * waiting to happen.
   */
  const computeAccents = useCallback(async (r, { reuseShot = null, beds = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
    });
    const payload = await requestAccents({
      plan: shot,
      room: {
        name: r.outline.name || null,
        widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
      },
      ceilingFt,
    });
    /* AND EVERYTHING AFTER THE CALL IS ARITHMETIC — see passResults.js, which
       carries the whole argument: out of the crop's coordinate space and back
       onto the plan, whose bed the sconces actually hang off, and why the rules
       run in code rather than in the prompt. */
    return {
      shot,
      meta: payload.meta,
      result: accentResultFrom({ res: payload.result, room: r, shot, beds, pxPerFt }),
    };
  }, [source, img, wallLayerSet, pxPerFt, ceilingFt]);

  /* THE TWO RESETS, IN THE TWO PLACES THE OLD `resetForNewPlan` MADE THEM.
     They are separate members and not one call because they were not adjacent:
     the room and its stored answers went early, the status and the crop went
     nine lines later, and a reducer dispatch order is not something an
     extraction gets to tidy up. See the reset group in useRoomIntelligence. */
  const resetAccentRoom = useCallback(() => {
    setAccentRoomId(null); docActions.clearAccentResults();
  }, [docActions]);

  const resetAccentProposals = useCallback(() => {
    setAccentState({ status: 'idle', roomId: null });
    docActions.clearAccentDismissed(); setAccentShot(null);
  }, [docActions]);

  return {
    roomId: accentRoomId, setRoomId: setAccentRoomId,
    room: accentRoom,
    state: accentState, setState: setAccentState,
    shot: accentShot,
    computeAccents,
    resetAccentRoom, resetAccentProposals,
  };
}
