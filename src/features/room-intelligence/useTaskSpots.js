import { useCallback } from 'react';
import { select, clear } from '../../lib/selection.js';

/**
 * MANUAL TASK SPOTS — picking one, and deleting the reason it exists.
 *
 * NO STATE AT ALL. A spot is derived: from a task surface the pass found, from
 * one drawn by hand, or from a piece of art the render pass read off a
 * photograph. The selection belongs to the editor and every write is a
 * document action, so there is nothing for this to hold.
 */
export default function useTaskSpots({
  taskSpotsPx, manualSurfaces, addTool, zoneMode, setSel, setArmed, docActions,
}) {
  // --- picking a spot, and deleting one ---------------------------------------

  /**
   * A CLICK ON A DIRECTIONAL SPOT PICKS IT.
   *
   * Same gesture, same shape and the same three lines as `accPointerDown` — one
   * selection at a time, and arming a tool is cancelled — because a person
   * should not have to know which kind of fitting they are pointing at to know
   * what clicking it does.
   *
   * NO DRAG. A spot is not dragged and this is not a stub for one: where it goes
   * is a consequence of what it lights and of the grid it stands on, and a spot
   * moved by hand would be a fitting the placer no longer explains — the arrow,
   * the segment, the track absorption and the panel's account of it would all
   * still describe the position it was dragged away from. Moving the SURFACE is
   * how you move the spot.
   *
   * AND IT SELECTS THE SPACE. Clicking a fitting in a room the panel is not
   * describing and having the panel stay on the last room is the disagreement
   * the canvas selection exists to prevent — the same argument as
   * `pickChunkOptions`.
   */
  const spotPointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    /* A TOOL IN HAND WINS, AND SO DOES A ZONE BEING DRAWN. While something is
       armed for placement the next click belongs to the ceiling underneath —
       somebody dropping a strip beside a spot, or boxing a no-light zone across
       it, is aiming at the drawing and not at the fitting in the way. So this
       does not intercept, and the click falls through to the canvas exactly as
       if the fitting were not there.

       EXCEPT THE SPOT TOOL ITSELF, and that exception is what makes a spot
       deletable. Arming the spot opens a STEP that stays open until Done is
       pressed (see `stepTool`), so for the whole of the time somebody is placing
       spots, every spot on the drawing was unselectable — place one, notice it
       is wrong, and there was no way to pick it up. Worse than nothing
       happening: Delete then fell past every branch below to the SPACE, and took
       the room out of the layout.

       IT IS SAFE FOR THIS TOOL AND NOT FOR THE OTHERS BECAUSE OF THE GESTURE. A
       spot is placed by DRAGGING a box over open ceiling; the pens place a point
       on press, and a press stolen from a pen is a corner that never lands. A
       press that starts on an existing spot is a press on a fitting a few pixels
       across, and selecting it is what somebody meant. Dragging a box that
       happens to cover one still works — start it anywhere but on the fitting. */
    /* THE EXEMPTION HAS A NAME, so it cannot be read as a guard that forgot a
       term. `pressOwner` says the TOOL owns this press — see lib/pressOwner.js
       — and this handler departs from that answer deliberately, for the reason
       above. The departure is one flag wide and everything else still obeys. */
    const spotStepExempt = addTool === 'spot';
    if ((!spotStepExempt && addTool) || zoneMode) return;
    e.stopPropagation();
    e.preventDefault();
    setSel(select('spot', id));
    setArmed(null);
    const sp = taskSpotsPx.find((q) => q.id === id);
    if (sp?.roomId) docActions.setFocusId(sp.roomId);
  };

  /**
   * DELETE A SPOT — WHICH MEANS DELETING THE THING IT WAS PLACED FOR.
   *
   * A spot is not a fitting somebody positioned; it is what the placer does
   * about a surface or a piece of art. So there is no "the spot" to remove
   * independently of its reason: suppress the fitting and leave the reason, and
   * the plan holds a surface that is invisible on the sheet (the boxes came off
   * the drawing long ago), silently holding a segment of the secondary grid
   * against a fitting that no longer exists, and re-appearing as a refusal in
   * the panel. The reason is what a person is actually deleting.
   *
   * THREE SOURCES, THREE VERBS, and they are the verbs this app already uses —
   * see the note in the accent branch of the keydown handler for the argument:
   *
   *   · A HAND-PLACED SURFACE is removed. It has no generator to come back
   *     from, so dismissing it would leave an id suppressing something that no
   *     longer exists for the life of the plan.
   *   · A DETECTED SURFACE is dismissed. The pass can run again and must not
   *     put it back — "the model proposed this and I said no" is a decision, and
   *     it persists.
   *   · A PIECE OF ART is dismissed by element id, which takes the WHOLE ROW
   *     with it. Deliberately: artSpots.js places a row as one formation, all of
   *     it or none, because two spots lighting one picture are one decision.
   *     Deleting one of a pair would leave a lopsided half of a design nobody
   *     drew. The wall element itself stays — the render pass saw a painting and
   *     it is still there; what changed is that it is not being lit.
   *
   * EITHER WAY THE SEGMENT GOES BACK TO THE CEILING, which is why this deletes
   * the source rather than filtering the output: the room re-places, and another
   * surface that lost that segment can now have it. A fitting elsewhere may move
   * as a result. That is not a side effect to be suppressed — it is the layout
   * being correct about a ceiling that now has one less thing to light.
   */
  const deleteSpot = useCallback((id) => {
    const sp = taskSpotsPx.find((q) => q.id === id);
    setSel(clear());
    if (!sp) return;
    if (sp.surfaceId) {
      if (manualSurfaces.some((sf) => sf.id === sp.surfaceId)) {
        docActions.removeSurface(sp.surfaceId);
      } else {
        docActions.dismissSurface(sp.surfaceId);
      }
      return;
    }
    if (sp.wallId) {
      docActions.dismissArt(sp.wallId);
    }
    /* `setSel` IS IN THE ARRAY AND WAS NOT, and nothing about when this
       callback is rebuilt has changed: it is App's `useState` setter, handed in
       rather than declared here, and a setter's identity is stable for the life
       of the component. */
  }, [taskSpotsPx, manualSurfaces, docActions, setSel]);

  return { spotPointerDown, deleteSpot };
}
