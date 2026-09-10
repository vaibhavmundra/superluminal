import { useCallback, useState } from 'react';
import { useDrag } from '../../hooks/useDrag.js';
import { slideSconceTo, setRunEnd, moveRun, RUN_EDIT } from '../../lib/accentPlace.js';
import { RUN_TRIM } from '../../lib/reverseCove.js';
import { DRAG_SLOP_PX } from '../../lib/dragMove.js';
import { canGrab } from '../../lib/pressOwner.js';
import { select, clear } from '../../lib/selection.js';

/**
 * MANUAL ACCENT EDITING — the gesture, and the three ways of deleting a run.
 *
 * NOTHING PERSISTENT IS HELD HERE. Every write goes to the document: a zone the
 * pass proposed is edited in `accentResults`, one placed by hand is edited in
 * `manualAccents`, a derived run's length is stored as a TRIM, and a deletion
 * is a removal, a switch-off or a dismissal depending on which of those the run
 * is. What this owns is the drag in flight, which is gone the moment the
 * pointer is released.
 *
 * CROSS-DOMAIN INPUTS, ALL EXPLICIT. The pointer, the press router, the
 * selection and the ceiling-shape delete all belong to other parts of the
 * editor and are handed in by App; nothing here reaches for them.
 */
export default function useAccentEditing({
  rooms, pxPerFt, zoom, svgPoint, svgRef, pressState,
  accentZonesPx, manualAccents, manualCoves,
  setSel, setArmed, deleteShape, docActions,
}) {
  // Editing what the model proposed. A fitting is a starting point, not a
  // verdict — see the note in accentPlace.js.
  const [accDrag, setAccDrag] = useState(null);   // {roomId, id, mode}

  /**
   * Editing an accent fitting.
   *
   * Everything here is in PLAN PIXELS, unlike the ceiling objects, and it is
   * worth knowing why the two differ. A ceiling object is a real thing of a
   * real size that someone placed, so it is held in feet and survives a scale
   * correction. An accent fitting is DERIVED — from a box the model drew on a
   * crop, projected onto a wall that is itself in plan pixels — so pixels are
   * the space it already lives in, and converting to feet and back would only
   * add two roundings to every drag.
   */
  /**
   * APPLY AN EDIT TO ONE ACCENT FITTING, WHEREVER IT LIVES.
   *
   * ONE ACTION, BECAUSE IT IS ONE ACT. An accent fitting lives in two stores —
   * `accentResults[roomId].zones` for the ones the pass produced, `manualAccents`
   * for the ones placed with the palette — and the write has to FOLLOW THE ZONE
   * rather than assume the store, which is the fix for a real bug: a hand-placed
   * strip could not be moved at all. See ACCENT_ZONE_UPDATED in
   * hooks/usePlanDoc.js for the whole argument and for why `fn` may be a
   * function in an action.
   *
   * `fn` must be pure: it can be invoked more than once for one edit.
   */
  const updateAccentZone = useCallback(
    (roomId, id, fn) => docActions.updateAccentZone(roomId, id, fn),
    [docActions]);

  /**
   * The tolerances, converted once per drag.
   *
   * accentPlace quotes them in feet — a snap should be the same size on a site
   * plan at 6 px/ft as on a flat at 40 — and everything here is in plan pixels,
   * so this is the one place the two meet.
   */
  const runOpts = (roomId, e) => {
    const r = rooms.find((q) => q.id === roomId);
    return {
      polygon: r?.plan?.polygonPx ?? null,
      snap: RUN_EDIT.snapFt * (pxPerFt || 1),
      minLen: RUN_EDIT.minLenFt * (pxPerFt || 1),
      // Shift pins the end to the run's existing axis: the old wall-slide
      // behaviour, on demand rather than as the only option.
      constrain: !!e?.shiftKey,
    };
  };

  /* --- AN ACCENT RUN'S WHOLE GESTURE ----------------------------------------

     THE ONE THAT WRITES A RELATIVE DELTA ON PURPOSE, and it is the exception
     rule 2 in lib/dragMove.js is about — so it is worth saying why it is not a
     violation. `moveRun` is handed the pointer and the PREVIOUS pointer, and
     `last` advances every frame. That is because a run is not moved to a point:
     it is projected onto whichever wall of its room can hold it, and the answer
     is a fresh projection each frame rather than an offset from a snapshot. A
     press-anchored delta would have nothing to add itself to.

     WHICH IS ALSO WHY NO STORE IS HANDED TO THE HOOK. An accent zone lives in
     one of two stores and the write has to follow the zone — see
     `updateAccentZone`, which is the fix for a real bug — so `onMove` is the
     write and there is no `at`/`to` to give.

     ITS THRESHOLD IS ITS OWN, in two ways. It has a FLOOR of two plan pixels,
     so a strip on a site plan at 6 px/ft does not need a five-foot drag to
     start; and it applies to the BODY drag only. The ends and the sconce slide
     have grips of their own under the pointer, so there is no click meaning for
     a threshold to protect — where a press on a strip's body both selects it and
     arms the move, and every plain click on one would otherwise translate the
     run by whatever fraction of a pixel the hand wobbled, and mark it `edited`
     for it: a fitting claiming to have been moved by hand when nobody moved it.

     EVERYTHING IN PLAN PIXELS, unlike the ceiling objects. A ceiling object is a
     real thing of a real size that someone placed, so it is held in feet and
     survives a scale correction. An accent fitting is DERIVED — from a box the
     model drew on a crop, projected onto a wall that is itself in plan pixels —
     so pixels are the space it already lives in, and converting to feet and back
     would only add two roundings to every drag. */
  const acc = useDrag({
    state: [accDrag, setAccDrag],
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    moved: (from, p, d) => d.mode !== 'move'
      || Math.hypot(p.x - from.x, p.y - from.y) >= Math.max(2, DRAG_SLOP_PX / (zoom || 1)),
    onMove: (p, { drag: d, event: e }) => {
      // --- a derived run: the ends write a TRIM, and nothing else moves.
      if (d.derived) {
        const { trimId, horizontal, axis, base } = d.derived;
        if (!base || !(pxPerFt > 0)) return;
        // Only the along-wall component of the pointer counts. A cove is on its
        // wall and stays there, so the across component is not a degree of
        // freedom — dragging away from the wall shortens nothing.
        const v = axis?.origin && axis?.unit
          ? (p.x - axis.origin.x) * axis.unit.x + (p.y - axis.origin.y) * axis.unit.y
          : horizontal ? p.x : p.y;
        // Shift is the FINE drag here — the opposite hand of the same key on an
        // ordinary strip, where it locks the axis. There is no axis to lock on a
        // run that only moves along one, so the modifier is spent on the thing
        // there is a use for: the exact position, off the setting-out increment.
        const step = e?.shiftKey ? 0 : RUN_TRIM.snapFt;
        const round = (ft) => (step > 0 ? Math.round(ft / step) * step : ft);
        /* THE CONVERSION IS HERE AND THE SPARSE RULE IS NOT. Getting from a
           pointer position to a length needs `pxPerFt`, which is derived and
           cannot live in the document; what a stored trim MEANS — and that a run
           dragged back to where the rule put it stores nothing — is the
           reducer's. See RUN_TRIM_SET. */
        if (d.mode === 'end0') docActions.setRunTrim(trimId, 'a', round((v - base.lo) / pxPerFt));
        else docActions.setRunTrim(trimId, 'b', round((base.hi - v) / pxPerFt));
        return;
      }

      const o = runOpts(d.roomId, e);
      updateAccentZone(d.roomId, d.id, (z) => {
        if (d.mode === 'slide') return slideSconceTo(z, p);
        if (d.mode === 'end0') return setRunEnd(z, 0, p, o);
        if (d.mode === 'end1') return setRunEnd(z, 1, p, o);
        if (d.mode === 'move') return moveRun(z, p, d.last, o);
        return z;
      });
      // The body drag is relative, so the cursor it measures from advances.
      if (d.mode === 'move') acc.set((cur) => (cur ? { ...cur, last: p } : cur));
    },
    onRelease: (d) => {
      // A derived run keeps no per-gesture state on itself — the trim is the
      // whole of it — so there is nothing to tidy up.
      if (d.derived) return;
      // The snap indicator is a property of the GESTURE, not of the fitting, so
      // it goes when the gesture does. Left on the zone it would draw a guide
      // line through a strip nobody is touching.
      updateAccentZone(d.roomId, d.id, (z) => (z.snap ? { ...z, snap: null } : z));
    },
  });

  const accPointerDown = (e, roomId, id, mode) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    /* AND EVERYTHING ELSE GOES THROUGH THE ROUTER. This handler had no guard of
       its own at all: the caller withheld it while a tool was armed, which left
       a no-light zone being boxed across a strip, the switchboard step and the
       door editor all having their presses swallowed here. See
       lib/pressOwner.js — this is the one rule, and it answers `grab` in exactly
       the states where a fitting is meant to be pickable. */
    if (!canGrab(pressState)) return;
    // A DERIVED RUN HAS NO BODY DRAG. A reverse cove is a slot at a wall and a
    // shelf strip is inside joinery: neither can be picked up and moved
    // somewhere else, because neither is a thing somebody placed. Only the ends
    // move, and they only move along the run's own axis. The canvas does not
    // offer the body handle for these, and this is the second half of that —
    // belt and braces on the one gesture that would silently do nothing.
    const derived = accentZonesPx.find((z) => z.id === id && z.derived);
    if (derived && mode !== 'end0' && mode !== 'end1') {
      // ...but it is still SELECTABLE, and it has to be: without a body handle
      // there would be nothing on it to click, and a fitting you cannot select
      // is one you cannot find the grips of.
      e.stopPropagation();
      e.preventDefault();
      setSel(select('acc', id)); setArmed(null);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    setSel(select('acc', id));
    setArmed(null);
    acc.down(e, {
      id, roomId, mode,
      // WHERE THE POINTER WAS LAST. It advances with the pointer, because a run
      // must move by the DELTA and not jump to centre itself under the cursor —
      // grab a strip near one end and it stays grabbed near that end. The
      // gesture's own `from` does not advance, because that is what the
      // threshold is measured from.
      last: svgPoint(e),
      // Carried on the GESTURE, not looked up per frame. The item is rebuilt by
      // a memo on every trim, so a fresh lookup mid-drag would read the base off
      // the run the last frame produced and the end would run away from the
      // pointer.
      derived: derived
        ? { trimId: derived.trimId, horizontal: derived.horizontal,
            axis: derived.axis, base: derived.base }
        : null,
    });
  };

  const accPointerMove = acc.move;
  const accPointerUp = acc.up;

  /* --- DELETING A RUN, AND THERE ARE THREE KINDS OF IT ----------------------
     EVERY LINEAR THING ON THIS DRAWING IS AN ACCENT ZONE — that is what lets
     the canvas, the schedule and the DXF take a cove, a reverse cove, a shelf
     run and a hand-drawn strip without any of them knowing what a cove is. It
     is also why deleting one is three different acts, and why doing the wrong
     one is SILENT: every store here is applied somewhere else, so filing a
     deletion in the wrong list leaves the run on the sheet and nothing to say
     why.

       A HAND-PLACED FITTING IS REMOVED. It has no generator to come back from,
       so dismissing it would leave an id suppressing something that no longer
       exists for the life of the plan.

       A DERIVED RUN — a reverse cove, a shelf strip — IS SWITCHED OFF in
       `runsOff`, which is read where the RUN is built and not where its tape
       is. This is the case that was broken: both were falling through to
       `accentDismissed`, which is only ever applied to the accent pass's own
       zones, so Delete on a reverse cove wrote an id nothing reads and left
       the slot on the drawing. A hand-placed one is in `manualCoves` and is
       removed from there instead, by the first rule.

       AND AN ACCENT THE PASS PROPOSED IS DISMISSED, which has to persist: the
       pass can run again and must not put the same fitting back.

     A DRAWN COVE'S TAPE IS A FOURTH CASE and deletes the SHAPE — see the
     branch. A cove the ceiling design derived is the one thing here with
     nothing to delete: it is not a fitting somebody placed, it is what a coved
     ceiling IS, and the way to remove it is to stop that chunk being a cove. */
  const deleteAccent = useCallback((id) => {
    const zone = accentZonesPx.find((z) => z.id === id);
    if (manualAccents.some((z) => z.id === id)) {
      docActions.removeAccent(id);
    } else if (zone?.derived && zone.trimId) {
      const gone = zone.trimId;
      if (manualCoves.some((c) => c.id === gone)) {
        docActions.removeCove(gone);
      } else {
        docActions.dropRun(gone);
      }
    } else if (zone?.source === 'cove' && zone.shapeId) {
      /* A DRAWN COVE'S TAPE IS A HANDLE ON THE SHAPE. The run is not an
         object in its own right — it is what the shape produces — so Delete
         on it removes the shape, which is the only thing there is to remove
         and what somebody pressing the key over a cove they drew means. The
         shape's own selection reaches the same function; two handles, one
         act. */
      deleteShape(zone.shapeId);
    } else {
      docActions.dismissAccent(id);
    }
    setSel(clear());
  }, [accentZonesPx, manualAccents, manualCoves, deleteShape, setSel, docActions]);

  const resetAccentEditing = useCallback(() => { setAccDrag(null); }, []);

  return {
    drag: accDrag,
    updateAccentZone, deleteAccent,
    accPointerDown, accPointerMove, accPointerUp,
    resetAccentEditing,
  };
}
