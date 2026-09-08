// ---------------------------------------------------------------------------
// useBoardGestures.js — THE PLATE AND THE WIRE, UNDER A POINTER.
//
// Two `useDrag` instances and the handlers round them. Both gestures are held
// entirely in this feature's own transient state — `boardDrag` and `flowDrag` —
// because neither is a fact about the plan: one is a distance being chosen and
// the other a wire being aimed, and both are gone the moment the pointer is
// released. What they COMMIT goes through `docActions` like everything else.
// ---------------------------------------------------------------------------
import { useCallback, useState } from 'react';
import { useDrag } from '../../hooks/useDrag.js';
import { boardUnder, slideBoardTo } from '../../lib/electrical.js';
import { canGrab } from '../../lib/pressOwner.js';
import { select } from '../../lib/selection.js';
import { seatForClick } from './boardRules.js';
import { newManualBoardId } from './boardSheet.js';

export function useBoardGestures({
  rooms, pxPerFt, svgPoint, svgRef, pressState, setSel, docActions,
  flowsPx, allBoardsPx, setBoardOutlet,
}) {
  const [boardDrag, setBoardDrag] = useState(null);   // {id, roomId, origin, live}
  /* THE GESTURE IN FLIGHT: `{ id, kind, key, origin, live, at, overId }`.
     `kind` is 'board' or 'bend'; `at` is where the pointer is now, and `overId`
     the plate a board drag would land on. Both are here rather than in
     `flowBoards` because a re-assignment written per pointermove would re-order
     the loop, re-compose two switchboards and repaint the panel on every frame
     of the drag — see the note on `boardPointerMove`, which writes per move for
     the opposite reason. A BEND does write per move: it changes one arc and
     nothing downstream reads it. */
  const [flowDrag, setFlowDrag] = useState(null);

  /* --- REMOVING A SWITCHBOARD ------------------------------------------------
     THE ONLY EDIT THERE IS ON A BOARD, and that is not a gap in the feature —
     it is what a derived fitting can be. A plate's position is a rule: 300mm
     past the latch jamb, at the sconce, 300mm outboard of the bed. Dragging one
     would put it somewhere no rule says, and the drawing would then be claiming
     a switch position nobody can account for. What a person genuinely knows
     better than the rule is whether the switch is WANTED — see the note on the
     facing-wall rule in electrical.js for why two plates are placed and then
     offered up for deletion rather than hunted for and sometimes missed.

     BY ID INTO `boardsOff`, not by removing anything: the boards are a memo, so
     a plate taken out of the list is back on the next render. Same machinery as
     a dismissed accent. */
  /* --- A PLATE'S WHOLE GESTURE ----------------------------------------------

     THE CONSTRAINT IS THE GESTURE, AND IT STAYS IN THE CALLER. `slideBoardTo`
     projects the pointer onto every wall of that room that can hold a plate and
     the nearest wins, so what this drag means is "which piece of plaster do you
     mean" rather than "drag this rectangle wherever". A switchboard off its wall
     is not a thing. That is why no store is handed to the hook: what is written
     is not a position but a distance along an outline, and `onMove` is the only
     place that can say so.

     WRITTEN STRAIGHT INTO `boardMoves`, ON EVERY MOVE, and that is deliberate
     rather than lazy. The chain it re-runs — the board rules, the bay boards,
     the flows — is pure geometry over a handful of objects and does NOT reach
     the planner, so the layout is not recomputed; and the alternative (a live
     position held in the drag and committed on release) would leave the wires
     hanging off the plate's old position for the whole gesture. The derived
     cove's end-drag already writes its trim per move for the same reason.

     ITS THRESHOLD IS A FRACTION OF THE DRAWING, like the cove shape's and the
     light's, with a 12 px/ft fallback so a plan with no scale yet still has one.
     Without it a click that wobbles one pixel writes a hand position onto a
     board that was exactly where the rule put it, and the plate is then marked
     "moved by hand" for the life of the plan. */
  const board = useDrag({
    state: [boardDrag, setBoardDrag],
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    moved: (from, p) => Math.hypot(p.x - from.x, p.y - from.y)
      >= Math.max(3, (pxPerFt || 12) * 0.12),
    onMove: (p, { drag: d }) => {
      const r = rooms.find((q) => q.id === d.roomId);
      const poly = r?.plan?.polygonPx;
      if (!poly?.length) return;
      const sFt = slideBoardTo(p, { polygonPx: poly, pxPerFt });
      if (sFt == null) return;
      /* WHICH STORE THIS LANDS IN IS DECIDED IN THE REDUCER, and on a
         per-frame path that is not a style preference: read from here it would
         be the membership as of the render that QUEUED the write, which is a
         frame behind. See BOARD_SLID, which also carries the reason a
         hand-placed plate has no `boardMoves` entry of its own. */
      docActions.slideBoard(d.id, sFt);
    },
  });

  const boardPointerDown = (e, id, roomId) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    /* AND EVERYTHING ELSE GOES THROUGH THE ROUTER. This was a hand-written
       variant — `addTool || zoneMode || armed` — and it was missing three of the
       seven machines, the switchboard placing step among them. See
       lib/pressOwner.js, whose whole subject is that a variant missing one term
       is indistinguishable from a correct one by reading. */
    if (!canGrab(pressState)) return;
    e.preventDefault();
    // ONE SELECTION ON THIS CANVAS. A plate and a fitting both picked would be
    // two things Delete could mean.
    setSel(select('board', id));
    /* AND THE PANEL COMES WITH IT. Selecting a plate puts its composition in the
       panel — see the Switchboard section — and that section lives in the Design
       tab, so a click made from the BOQ or the spaces list would otherwise open
       a card on a surface nobody can see. The tab follows the selection because
       the selection is what the tab is now about.
       NOT FROM `admin`, WHICH IS NOT A STEP IN THIS WORK. It is a different
       audience's tab and yanking an operator out of it because they clicked the
       drawing would lose whatever they were reading. */
    docActions.requestDesignView();
    /* NO ROOM, NO DRAG, AND STILL A SELECTION. A plate the board pass produced
       outside any space has no outline to slide along, so there is nothing for
       the gesture to resolve the pointer to — but it is still a thing you can
       pick and read the card of. */
    if (roomId) board.down(e, { id, roomId });
  };

  const boardPointerMove = board.move;
  const boardPointerUp = board.up;

  /* --- A WIRE, PICKED ------------------------------------------------------
     ONE PRESS SELECTS THE WHOLE LOOP. A flow is one switch — its legs are how
     that switch reaches its lamps — so picking "the third arc" would be picking
     a piece of drawing rather than a piece of the design. The grips then appear
     on every leg, which is what makes "adjust any one of them" possible without
     a leg ever being a selectable object of its own. */
  const flowPointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    // A TOOL IN HAND WINS, exactly as it does for a plate: somebody placing a
    // fitting across a wire is aiming at the drawing, not at the wire. THROUGH
    // THE ROUTER, like the grip below it — see lib/pressOwner.js.
    if (!canGrab(pressState)) return;
    e.preventDefault();
    // ONE SELECTION ON THIS CANVAS.
    setSel(select('flow', id));
  };

  /* --- A WIRE'S GRIP: ITS WHOLE GESTURE -------------------------------------

     ONE PRESS, TWO KINDS, AND THEY COMMIT AT OPPOSITE ENDS OF THE GESTURE.

     A BEND WRITES PER MOVE. It is the perpendicular distance from the leg's own
     chord, minus what the rule already bows it by — so what is stored is the
     DELTA the hand added and a leg's own length still drives the rest. In feet,
     like every other stored hand position in this file. AGAINST THE LEG AS IT IS
     DRAWN RIGHT NOW, which includes the bend applied so far: that is what makes
     the grip track the pointer instead of doubling its movement. `base` is the
     rule's bow and the pointer's offset from the chord IS the new total, so the
     delta is one subtraction and not an accumulation.

     THE END AT THE PLATE COMMITS ON THE DROP. Nothing is written until then —
     `at` is carried for the rubber band and `overId` for the ring round the
     plate it would land on — because writing per move would re-order the loop,
     re-compose two switchboards and repaint the panel on every frame. A board
     SLIDE writes per move precisely because it does none of those things.

     SO NO STORE IS HANDED TO THE HOOK. Neither kind writes a member's position:
     one writes an override in a map and the other writes nothing at all until
     `onCommit`.

     ITS THRESHOLD IS THE PLATE'S, and for the plate's reason: a click that
     wobbles writes a hand value onto something that was exactly where the rule
     put it, and the wire is then marked as moved for the life of the plan. */
  const flow = useDrag({
    state: [flowDrag, setFlowDrag],
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    moved: (from, p) => Math.hypot(p.x - from.x, p.y - from.y)
      >= Math.max(3, (pxPerFt || 12) * 0.12),
    onMove: (p, { drag: d }) => {
      const f = flowsPx.find((q) => q.id === d.id);
      if (!f) return;
      if (d.kind === 'board') {
        const over = boardUnder(p, allBoardsPx, { pxPerFt });
        flow.set((cur) => (cur ? { ...cur, at: p, overId: over?.id ?? null } : cur));
        return;
      }
      const leg = [...(f.legs ?? []), ...(f.also?.legs ?? [])]
        .find((l) => l.key === d.key);
      if (!leg || !(pxPerFt > 0)) return;
      const off = (p.x - leg.mid.x) * leg.normal.x + (p.y - leg.mid.y) * leg.normal.y;
      const bendFt = (off - leg.base) / pxPerFt;
      docActions.setFlowBend(d.id, d.key, bendFt);
    },
    /* THE DROP IS THE COMMIT, for a board drag. A release over nothing is a
       gesture abandoned and leaves the wire where it was — NOT an
       un-assignment, because "let go over empty floor" is what a person does
       when they change their mind, and reading it as "disconnect this" would
       lose the plate they had picked deliberately last week.
       A DROP ON THE PLATE IT WAS ALREADY ON CLEARS THE OVERRIDE rather than
       storing it, which is the way back: dragging a wire home puts it back
       under the rules instead of pinning it to the answer the rules currently
       give. */
    onCommit: (ids, d) => {
      if (d.kind !== 'board' || !d.overId) return;
      const f = flowsPx.find((q) => q.id === d.id);
      const home = !f?.assigned && f?.boardId === d.overId;
      /* A WIRE DROPPED ON A SOCKET OUTLET CONVERTS IT, in the same gesture.
         An outlet is one socket and no switch — that is the definition — so
         "this appliance is switched from that plate" is a statement that the
         plate is not an outlet any more, exactly as pressing "+ 16A switch" on
         one is. Refusing the drop instead would be refusing a gesture whose
         meaning is not in doubt; converting it is the reading that does what
         the person plainly meant.
         WHAT THEY GET IS A BOARD SERVING THAT APPLIANCE: the switch for the
         flow, plus the socket that was on the wall and its own switch — see
         `spareAmps`, which is why the rating survives. */
      const target = allBoardsPx.find((b) => b.id === d.overId);
      if (target?.socketOnly) setBoardOutlet(target, false);
      docActions.setFlowBoard(d.id, d.overId, home);
    },
  });

  /**
   * A GRIP ON A WIRE, PRESSED — the end at the plate, or one leg's own bow.
   *
   * THE POINTER IS CAPTURED AND THE WORK HAPPENS IN THE MOVE, which is the
   * shape every drag on this canvas has. See `flow` above for the two kinds.
   */
  const flowGripDown = (e, id, kind, key) => {
    if (e.button != null && e.button !== 0) return;
    // AND EVERYTHING ELSE GOES THROUGH THE ROUTER — see lib/pressOwner.js. This
    // was `addTool || zoneMode || armed`, three machines short.
    if (!canGrab(pressState)) return;
    e.preventDefault();
    setSel(select('flow', id));
    const p = svgPoint(e);
    // `at` IS WHERE THE END IS BEING HELD, for the rubber band, and it starts at
    // the press. `overId` is the plate it would land on, and there is not one yet.
    flow.down(e, { id, kind, key, at: p, overId: null });
  };

  const flowPointerMove = flow.move;
  const flowPointerUp = flow.up;

  /** @see seatForClick — one click seats a plate on the nearest wall. */
  const placeBoardAt = useCallback((p) => {
    const best = seatForClick(p, { rooms, pxPerFt });
    if (!best) return;
    /* WHERE IT IS, AND NOTHING ABOUT WHAT IT IS. It is a socket outlet at the
       country's low-power rating because that is the DEFAULT for a hand-placed
       plate — see `boardMode` — and defaults are not written down. Both are
       changed in the panel afterwards: a checkbox for which of the two things it
       is, and a chip for the rating. */
    docActions.addManualBoard({ id: newManualBoardId(), roomId: best.roomId, sFt: best.seat.sFt });
  }, [rooms, pxPerFt, docActions]);

  return {
    boardDrag, setBoardDrag, flowDrag, setFlowDrag,
    boardPointerDown, boardPointerMove, boardPointerUp,
    flowPointerDown, flowGripDown, flowPointerMove, flowPointerUp,
    placeBoardAt,
  };
}

export default useBoardGestures;
