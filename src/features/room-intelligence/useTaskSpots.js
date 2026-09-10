import { useCallback, useState } from 'react';
import { useDrag } from '../../hooks/useDrag.js';
import { snapPoint } from '../../lib/snapGuides.js';
import { canGrab } from '../../lib/pressOwner.js';
import { select, clear } from '../../lib/selection.js';

/**
 * MANUAL TASK SPOTS — picking one, carrying one that was placed by hand, and
 * deleting the reason a derived one exists.
 *
 * NO STATE BUT THE DRAG IN FLIGHT. A spot is derived: from a task surface the
 * pass found, from one drawn by hand, or from a piece of art the render pass
 * read off a photograph. The selection belongs to the editor and every write is
 * a document action, so the only thing here that outlives a call is the gesture
 * holding a fitting — and that is gone the moment the pointer is released.
 */
export default function useTaskSpots({
  taskSpotsPx, manualSpots = [], manualSurfaces, pxPerFt, zoom, svgPoint, svgRef,
  pressState, roomAt, addTool, zoneMode, aiming, setSel, setArmed, setGuides,
  snapTargets, snapTol, docActions,
}) {
  const [spotDrag, setSpotDrag] = useState(null);

  // --- carrying a spot somebody placed and aimed themselves ------------------

  /**
   * WHERE A SPOT BEING DRAGGED LANDS, once the shift lock has had its say.
   *
   * THE SAME TARGETS EVERYTHING ELSE ON THIS CANVAS ALIGNS TO — the walls, the
   * placed objects, the geometry somebody drew and the suggested centres, which
   * is `snapTargets`, App's own collector. A spot over a worktop is set out
   * against the room and against the fittings around it, so it catches the same
   * lines a ceiling object catches rather than a second, weaker set written for
   * this one fitting.
   *
   * AND THE FROZEN AXIS TAKES NO SNAP AND DRAWS NO GUIDE. A guide is a claim
   * that the point took an alignment, and one drawn for an axis a modifier was
   * holding still would be taking credit for the modifier's work. The same
   * three lines as `applySnap` in features/fixtures and `cobSnapAt` in
   * useCobTool, in the same order and for the same reason: the lock is applied
   * before this and snapping first would pull the point off the line the
   * modifier had just held it to.
   */
  const spotSnapAt = (p, axis, exclude) => {
    const r = snapPoint(p, snapTargets(exclude), { tol: snapTol() });
    setGuides(r.guides.filter((g) => g.axis !== axis));
    return { x: axis === 'x' ? p.x : r.x, y: axis === 'y' ? p.y : r.y };
  };

  /* --- A HAND-PLACED SPOT'S WHOLE GESTURE ------------------------------------

     PLAN FEET AT THE STORE AND PLAN PIXELS AT THE POINTER, exactly as the
     hand-placed COB is held: `manualSpots` keeps `xFt`/`yFt` so that correcting
     the scale moves the fitting WITH the drawing rather than off it. `at` is
     that conversion, and there is no `to` because the write is not a list
     assignment — see `onMove`.

     NO STORE IS HANDED TO THE HOOK. One spot moves at a time and the document
     already has the verb for it: `patchSpot`, whose note in usePlanDoc says
     outright that an aimed spot is "patched when it is dragged". A `setList`
     would need a whole-list action that nothing else wants.

     THE LIFECYCLE IS hooks/useDrag.js AND THE ARITHMETIC IS lib/dragMove.js —
     the slop that keeps a click a click, the delta measured from the press
     rather than from the last frame, the axis re-decided every frame. What is
     left here is the four things that are facts about an AIMED SPOT. */
  const spot = useDrag({
    state: [spotDrag, setSpotDrag],
    point: svgPoint,
    /* THE POINTER IS CAPTURED ON THE SVG, as every other fitting's drag
       captures it: a spot dragged toward the edge of the sheet routinely
       releases outside the six inches of group the press landed on, and without
       capture that release is somebody else's event and the drag never ends. */
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    at: (o) => ({ x: o.xFt * pxPerFt, y: o.yFt * pxPerFt }),
    zoom,
    ortho: true,
    snap: (p, axis, { ids }) => spotSnapAt(p, axis, ids),
    /* THE BODY MOVES AND THE AIM DOES NOT, and they are two separate answers
       the hand gave: carrying a fitting across the ceiling does not turn it.
       Nothing here writes `aim`, and the aim POINT is derived from the angle
       rather than stored — see `HAND_AIM_FT` in planProjection — so the arrow
       travels with the body still pointing the way it was set. */
    onMove: (p, { drag: d }) => {
      if (!(pxPerFt > 0)) return;
      docActions.patchSpot(d.id, { xFt: p.x / pxPerFt, yFt: p.y / pxPerFt });
    },
    /* A SPOT DROPPED OFF EVERY CEILING GOES BACK WHERE IT CAME FROM — the rule
       `rollbackCobs` states for a lamp, on the same argument: a fitting is a
       hole in a ceiling, and one carried off the plan is a slip of the hand
       rather than a decision. The drop position is read back out of the store
       instead of being carried on the gesture, because the moves have already
       written it there. */
    onCommit: (ids, d) => {
      const base = d.startAll[d.id];
      const now = manualSpots.find((q) => q.id === d.id);
      if (!base || !now || !(pxPerFt > 0)) return;
      if (roomAt({ x: now.xFt * pxPerFt, y: now.yFt * pxPerFt })) return;
      docActions.patchSpot(d.id, { xFt: base.xFt, yFt: base.yFt });
    },
    // The guides are a property of the GESTURE, not of the fitting.
    onRelease: () => setGuides([]),
  });

  // --- picking a spot, and deleting one ---------------------------------------

  /**
   * A CLICK ON A DIRECTIONAL SPOT PICKS IT, AND A DRAG CARRIES A HAND-PLACED
   * ONE.
   *
   * Same gesture, same shape and the same three lines as `accPointerDown` — one
   * selection at a time, and arming a tool is cancelled — because a person
   * should not have to know which kind of fitting they are pointing at to know
   * what clicking it does.
   *
   * A DERIVED SPOT STILL DOES NOT MOVE, and that is the whole of the rule this
   * handler used to state as "NO DRAG". Where a spot placed FOR something goes
   * is a consequence of what it lights and of the grid it stands on, so one
   * dragged by hand would be a fitting the placer no longer explains — the
   * arrow, the segment, the track absorption and the panel's account of it would
   * all still describe the position it was dragged away from. Moving the SURFACE
   * is how you move that spot.
   *
   * A HAND-PLACED SPOT HAS NO PLACER TO CONTRADICT. Its position is where the
   * first click landed and its angle is where the second one locked it, and
   * `projectTaskSpotsPx` puts it through none of the passes: no segment, no
   * grid, no absorption, nothing to fall out of step. So the reason for refusing
   * the drag is absent exactly where the fitting is one somebody positioned, and
   * `hand` — stamped by the projection rather than inferred — is the test. Same
   * split as the delete below, which removes a hand-placed spot outright and
   * dismisses the FINDING behind a derived one.
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
       spot is placed by CLICKING open ceiling and then clicking again to aim it;
       the pens place a point on press, and a press stolen from a pen is a corner
       that never lands. A press that starts on an existing spot is a press on a
       fitting a few pixels across, and selecting it is what somebody meant. */
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

    /* --- AND THEN IT MAY BE A MOVE ----------------------------------------
       ARMING THE DRAG COSTS THE CLICK NOTHING. Nothing at all happens before
       the slop — no write, no guides — so a press that never travels three
       screen pixels is still the selection above and only that. See
       `movedEnough` in lib/dragMove.js.

       THE SPOT STEP MAY CARRY ONE TOO, and that is the point rather than an
       oversight: the tool stays armed after a spot is placed (spots come in
       threes over a worktop), so refusing the drag while it is in hand would
       mean putting the tool down to nudge the fitting just placed. Nothing is
       ambiguous about it — the placing gesture is two CLICKS on open ceiling,
       and this press never reached the canvas.

       NOT BETWEEN THE TWO CLICKS. While an aim is live the arrow on screen
       belongs to a fitting that does not exist yet (see `spotAim`), and two
       gestures reading one pointer would turn one spot while moving another.
       The press still selects; only the drag is withheld.

       `canGrab` IS ASKED FOR EVERYTHING BUT THIS TOOL, so the four machines the
       guard above does not name — the door editor, the shape tool, the
       switchboard step, an armed ceiling object — cannot have a fitting dragged
       out from under them. */
    if (!sp?.hand || aiming || !(pxPerFt > 0)) return;
    if (!spotStepExempt && !canGrab(pressState)) return;
    const m = manualSpots.find((q) => q.id === id);
    /* WHO IS MOVING AND WHAT THEY LOOKED LIKE — the STORE entry and not the
       projected one, because feet are what a patch writes and pixels are what
       `at` converts them to. One spot today, kept in the group shape anyway so
       that adding a multi-selection is a change to the SELECTION and not to
       this gesture. */
    if (m) spot.down(e, { id, members: [m] });
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
    /* THE GESTURE HOLDING IT IS ABANDONED FIRST. Delete is reachable from the
       keyboard while a pointer is still down on the fitting — the same reason
       `deleteArray`, `deleteModule` and `deleteShape` each own their drag state
       — and a drag whose member has gone would go on patching an id the
       document no longer has. */
    setSpotDrag(null);
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
      return;
    }
    /* --- AND A HAND-PLACED ONE IS REMOVED RATHER THAN DISMISSED -----------
       THE TWO BRANCHES ABOVE ARE ABOUT A FINDING. A spot on a task surface or
       a picture is DERIVED — the placer made it, and the way to be rid of it
       is to take away the thing it was made for, which is what dismissing a
       surface or a picture does. Delete the spot itself and the next render
       puts it straight back.
       A HAND-PLACED SPOT HAS NOTHING BEHIND IT. The entry IS the fitting, the
       same way a `manualCobs` entry is — see `manualSpots` in usePlanDoc — so
       Delete means delete. `hand` is stamped by the projection rather than
       inferred from the absence of the other two ids, because "no surface and
       no wall" is also what a refusal looks like. */
    if (sp.hand) docActions.removeSpot(sp.id);
    /* `setSel` IS IN THE ARRAY AND WAS NOT, and nothing about when this
       callback is rebuilt has changed: it is App's `useState` setter, handed in
       rather than declared here, and a setter's identity is stable for the life
       of the component. `setSpotDrag` is this hook's own and just as stable. */
  }, [taskSpotsPx, manualSurfaces, docActions, setSel]);

  /* A NEW PLAN DROPS THE GESTURE, exactly as `resetAccentEditing` does beside
     it: loading a file replaces every fitting on the drawing, and a drag still
     holding an id from the last one would patch a spot the document no longer
     has the moment the pointer moved. */
  const resetSpotEditing = useCallback(() => { setSpotDrag(null); }, []);

  return {
    spotPointerDown,
    spotPointerMove: spot.move,
    spotPointerUp: spot.up,
    drag: spotDrag,
    deleteSpot,
    resetSpotEditing,
  };
}
