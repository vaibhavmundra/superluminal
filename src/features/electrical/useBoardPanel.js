// ---------------------------------------------------------------------------
// useBoardPanel.js — THE PLATE SOMEBODY IS READING, AND WHAT CAN BE DONE TO IT.
//
// Everything in this file is about ONE plate — the selected one — except the
// sheet, which is every plate on the job and is here because it is composed by
// the same pair of functions the card uses. See boardSheet.js: one place works
// out what is on a plate, so the card and the schedule cannot disagree.
//
// WHAT IS STORED IS STILL THE DOCUMENT'S. Every command below writes through
// `docActions`; nothing here holds a copy of a board, a point, an order or a
// height.
// ---------------------------------------------------------------------------
import { useCallback, useMemo } from 'react';
import { clear, idOf, select } from '../../lib/selection.js';
import { heightOf } from './boardRules.js';
import { buildBoardSheet, composeBoard, newBoardPointId, reorderUnits } from './boardSheet.js';

/* --- WHAT IS ON THE PLATE -------------------------------------------------

   `sbCountry` IS DECLARED WELL ABOVE THIS, beside `boardMode` — see the note
   there. It used to be the first thing in this block, which is where it reads
   best and is no longer where it can go.

   THE PLATE SOMEBODY SELECTED, AND ONLY THAT ONE. Composing every board on the
   sheet would be a parts list for a drawing nobody is looking at; the card
   exists because a person clicked a rectangle and wants to know what is behind
   it, and that is one plate at a time.

   THE FLOWS ARE HANDED IN WHOLE and the composition filters them by board id.
   That is deliberate rather than lazy: a flow can name a SECOND plate as well
   as its own (two-way switching — see `also` in flows.js), so "the flows on
   this board" is not a partition of the list and cannot be pre-grouped
   without deciding, here, a question switchboards.js already answers. */
export function useBoardPanel({
  rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames, sbCountry,
  switchboardsPx, flowsPx, selBoardId, selFlowId, setSel,
  boardPoints, boardOrders, docActions,
}) {
  /**
   * THE PLATE THE PANEL IS SHOWING — the one somebody picked, or failing that
   * the one the picked WIRE runs to.
   *
   * THE FALLBACK IS THE WHOLE OF "CLICK A WIRE, SEE ITS SWITCH". Selecting a
   * wire clears the board selection (one selection on this canvas), so without
   * this the card would close at the exact moment there was something in it
   * worth looking at — and the module that ought to light up would not be on
   * screen to light. Falling back to the wire's own board means clicking any
   * loop on the drawing opens the plate it is switched from, with its module
   * filled in.
   *
   * AND PICKING A MODULE KEEPS `selBoardId`, which is why the explicit
   * selection comes first rather than the two being merged. A two-way point on
   * plate X belongs to a flow whose board is plate Y; pressing it must not throw
   * you over to Y's card, because X is the plate you are reading.
   */
  const selBoard = useMemo(() => {
    const byFlow = selFlowId
      ? flowsPx.find((f) => f.id === selFlowId)?.boardId ?? null
      : null;
    const want = selBoardId ?? byFlow;
    return want ? switchboardsPx.find((b) => b.id === want) ?? null : null;
  }, [switchboardsPx, selBoardId, selFlowId, flowsPx]);

  /**
   * PICK A WIRE FROM ITS MODULE — the other direction of the same selection.
   *
   * IT DOES NOT CLEAR `selBoardId`, and that is the one thing separating it from
   * `flowPointerDown`. Pressing a module is a gesture made INSIDE the card, so
   * closing the card would take away the surface the gesture was made on; a
   * press on the drawing has no such problem and clears everything, as every
   * other selection there does.
   *
   * PRESSING THE LIT ONE AGAIN LETS GO. A module is the only place in this app
   * where the selected thing and the control for it are the same object, so
   * without a toggle there would be no way to put a wire down again without
   * finding somewhere empty to click.
   */
  const pickFlow = useCallback((id) => {
    setSel((cur) => (idOf(cur, 'flow') === id ? clear() : select('flow', id)));
  }, [setSel]);

  /* The points somebody added to THIS plate. Its own memo because it is a
     dependency of the composition, and `boardPoints[id]` computed inline would
     be a fresh array reference on every render of a component that re-renders
     on every pointermove. */
  const selBoardExtras = useMemo(
    () => (selBoardId ? boardPoints[selBoardId] ?? [] : []),
    [boardPoints, selBoardId]);

  /** @see composeBoard — the card's own parts list, with the wire ids on it. */
  const selBoardParts = useMemo(() => composeBoard(selBoard, {
    country: sbCountry, flowsPx, extras: selBoardExtras,
    order: selBoard ? boardOrders[selBoard.id] ?? [] : [],
    withFlowId: true,
  }), [selBoard, sbCountry, flowsPx, selBoardExtras, boardOrders]);

  /** @see reorderUnits — move a pair along the plate. */
  const reorderBoardUnit = useCallback((key, toIndex) => {
    const id = selBoard?.id;
    const units = selBoardParts?.units;
    if (!id || !units) return;
    const moved = reorderUnits(units, key, toIndex);
    if (!moved) return;
    docActions.setBoardOrder(id, moved.order);
    /* AND THE THING JUST MOVED IS WHAT IS SELECTED, where it is on a wire. The
       card lights the dropped unit by its own key — see `movedKey` there, which
       is what a unit with no flow needs — and this is the other half of it: the
       wire goes green on the drawing at the same moment, so the two views do not
       disagree about what was just touched. */
    const flowId = units[moved.from]?.flowId ?? null;
    if (flowId) setSel(select('flow', flowId));
  }, [selBoard, selBoardParts, docActions, setSel]);

  /**
   * A PLATE IS A SOCKET OUTLET, OR IT IS A SWITCHBOARD.
   *
   * TWO ONE-WAY ACTIONS AND NOT A TOGGLE, and that is a UI decision the panel
   * makes rather than one this function knows about: going TO an outlet is a
   * press of "Single socket outlet", and coming BACK is a consequence of adding
   * any point to one. The two directions are not symmetrical, and the checkbox
   * that used to pretend they were is what people found confusing about it.
   *
   * NOTHING IS MOVED, ADDED OR DELETED HERE, and that is the whole reason this
   * is three lines. It writes one flag; everything the change is FOR then
   * happens because the derivation reads that flag:
   *
   *   · the plate composes as one socket instead of a board full of switches
   *   · it produces an outlet flow — so a wire appears, running to the nearest
   *     board, and THAT board grows a switch for it
   *   · `servesBay` is false for a socket, so anything that used to be switched
   *     from it falls back to the next plate by itself
   *   · it drops out of the pool a dragged wire may be dropped on
   *
   * Set it the other way and all four reverse, in the same way and for the same
   * reason: the flow stops being produced, so the wire and the far board's
   * switch simply are not there any more. Nothing had to go and remove them.
   *
   * BACK TO NOTHING RATHER THAN TO A VALUE, when the flag matches what the plate
   * was born as. Same rule `resetBoard` follows: an entry that only restates the
   * default is a plate marked "changed by hand" for ever, and one that would
   * stop following its own default if that default ever moved.
   */
  const setBoardOutlet = useCallback((b, outlet) => {
    if (!b) return;
    // WHAT IT WAS BORN AS, off the plate itself: hand-placed plates are outlets
    // and everything a rule put on a wall is a board. `placed` survives the
    // outlet transform (see `asOutlet`), so it is readable in either state.
    const born = !!b.placed;
    docActions.setBoardOutlet(b.id, outlet, born);
  }, [docActions]);

  /** Re-rate the selected plate's socket. Its switch follows, wherever it is. */
  const setBoardAmps = useCallback(
    (id, amps) => docActions.setBoardAmps(id, amps), [docActions]);

  const setBoardHeight = useCallback(
    (id, mm) => docActions.setBoardHeight(id, mm), [docActions]);

  /** @see buildBoardSheet — every plate on the job, grouped by space. */
  const boardSheet = useMemo(() => buildBoardSheet({
    rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames,
    country: sbCountry, flowsPx, boardPoints, boardOrders,
  }), [rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames,
       sbCountry, flowsPx, boardPoints, boardOrders]);

  /** A point added by hand, onto the selected plate. See `boardPoints`. */
  const addBoardPoint = useCallback((p) => {
    if (!selBoardId) return;
    /* ADDING A POINT TO A SOCKET OUTLET IS HOW ONE STOPS BEING ONE, and that is
       the whole of the conversion now — there is no checkbox.

       AN OUTLET IS "ONE SOCKET AND NOTHING ELSE". That is not a setting that
       happens to be true of it, it is the definition — so pressing "+ 16A
       switch" on one is not a request that needs reconciling with a mode flag,
       it is a statement that this plate is not an outlet any more. A checkbox
       beside these buttons would have been a second way to say the same thing,
       and two controls for one fact disagree the first time somebody uses the
       one you did not expect.
       THE FLIP AND THE POINT LAND TOGETHER, in one gesture, so the plate a
       person is looking at is the plate they asked for. */
    if (selBoard?.socketOnly) setBoardOutlet(selBoard, false);
    docActions.addBoardPoint(selBoardId,
      { id: newBoardPointId(), kind: p.kind, amps: p.amps ?? null, label: p.label });
  }, [selBoardId, selBoard, setBoardOutlet, docActions]);

  const removeBoardPoint = useCallback((pid) => {
    if (!selBoardId) return;
    docActions.removeBoardPoint(selBoardId, pid);
  }, [selBoardId, docActions]);

  /**
   * PUT A PLATE BACK WHERE THE RULE WANTED IT.
   *
   * BACK TO NOTHING RATHER THAN TO THE RULE'S NUMBER, which is the same
   * distinction `runTrims` makes when a run is dragged back to its derived
   * length: a board with no entry in this map is a board the rules own, and one
   * carrying its own rule position as a hand position would be marked "moved by
   * hand" for ever and would stop following the door it was placed off.
   *
   * NO CALLER AT THE MOMENT, DELIBERATELY KEPT. The way back used to be a "put
   * back" button in the Spaces list, and that list is a list of rooms again —
   * see the note where the switchboard readout was. The undo itself is a rule
   * about `boardMoves`, not about that button, so it stays here for whatever
   * offers it next; deleting it would mean rediscovering the paragraph above.
   */
  const resetBoard = useCallback((id) => docActions.resetBoard(id), [docActions]);

  const deleteBoard = useCallback((id) => {
    /* TWO VERBS, AND THE SAME DISTINCTION `accentDismissed` MAKES. A rule's
       board is DERIVED, so "not this one" cannot be expressed by removing it —
       the next render puts it straight back — and the answer is a dismissal that
       has to persist. A hand-placed board has no rule to come back from, so
       dismissing one would leave an id in `boardsOff` for the life of the plan,
       suppressing something that no longer exists. It is removed instead. */
    docActions.deleteBoard(id);
    setSel((cur) => (idOf(cur, 'board') === id ? clear() : cur));
  }, [docActions, setSel]);

  return {
    selBoard, selBoardExtras, selBoardParts, boardSheet, heightOf,
    pickFlow, reorderBoardUnit, setBoardOutlet, setBoardAmps, setBoardHeight,
    addBoardPoint, removeBoardPoint, resetBoard, deleteBoard,
  };
}

export default useBoardPanel;
