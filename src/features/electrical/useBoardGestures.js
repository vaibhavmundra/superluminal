// ---------------------------------------------------------------------------
// useBoardGestures.js — THE PLATE AND THE WIRE, UNDER A POINTER.
//
// Two `useDrag` instances and the handlers round them. Both gestures are held
// entirely in this feature's own transient state — `boardDrag` and `flowDrag` —
// because neither is a fact about the plan: one is a distance being chosen and
// the other a wire being aimed, and both are gone the moment the pointer is
// released. What they COMMIT goes through `docActions` like everything else.
// ---------------------------------------------------------------------------
import { useCallback, useRef, useState } from 'react';
import { useDrag } from '../../hooks/useDrag.js';
import { boardUnder, boardGap, wallHostFor, boardAsPoint, boardAdapters,
         boardU } from '../../lib/electrical.js';
import { uAt } from '../../lib/point.js';
import { canGrab } from '../../lib/pressOwner.js';
import { select } from '../../lib/selection.js';
import { seatForClick, lampSocketSeat, boardSeatWrites } from './boardRules.js';
import { newManualBoardId } from './boardSheet.js';

export function useBoardGestures({
  rooms, pxPerFt, svgPoint, svgRef, pressState, setSel, docActions,
  flowsPx, allBoardsPx, setBoardOutlet, obstaclesPx = [], flowLinks = {},
  flowTwoWays = {},
}) {
  const [boardDrag, setBoardDrag] = useState(null);   // {id, roomId, origin, live}
  /* THE GESTURE IN FLIGHT: `{ id, kind, key, origin, live, at, overId, overKind }`.
     `kind` is 'board', 'bend' or 'node'; `at` is where the pointer is now, and
     `overId` the plate a board drag would land on — or, for a node drag, the
     fitting it would be looped off OR the plate it would be two-wayed from,
     which is what `overKind` says. It is carried rather than re-derived on the
     drop because the drawing has already told the person which of the two is
     armed, and a drop that resolved the target a second time could disagree
     with the ring they were looking at. See `targetFor`.
     A NODE DRAG IS THE BOARD DRAG'S TWIN, and it now says two things rather than
     one: dropped on a fitting it carries an INPUT somewhere else, and dropped on
     a plate it gives the SWITCH a second end. Neither is a second input — see
     the drop in `onCommit`.
     Both drags are here rather than in
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
  /* --- THE PLATES THIS GESTURE IS WORKING ON, AS POINTS -------------------
     `useDrag` MOVES AND FORKS A LIST, and a plate does not live in one: a
     hand-placed plate is a `manualBoards` entry, a rule board's hand position is
     a `boardMoves` value, and the two are told apart in the reducer on purpose.
     So the list handed to the hook is the gesture's own — the members it picked
     up, as point records — and `setList` below is the one place it is turned
     back into dispatches. Everything between the two is the primitive's.
     A REF AND NOT STATE, because `setList` takes an UPDATER and two moves can
     fire before a re-render; a value read out of a render would be a frame
     behind the one the last write produced. */
  const seats = useRef([]);

  /** The room's walls, as the host a plate is a point on. @see wallHostFor */
  const hostOf = useCallback((roomId) => {
    const r = rooms.find((q) => q.id === roomId);
    return wallHostFor(r?.plan?.polygonPx ?? [], pxPerFt);
  }, [rooms, pxPerFt]);

  /** One plate, as the point the primitive moves. */
  const seatOf = useCallback((b, roomId) => {
    const host = hostOf(roomId);
    if (!host) return null;
    /* `sFt` WHERE THE PLATE HAS ONE AND THE PROJECTION WHERE IT HAS NOT. A
       hand-placed plate stores its distance round the walls; a rule board's
       position came out of its own rule and it stores none, so the only answer
       is where it actually stands — which is `uAt`, the primitive's own
       projection, and exact because the plate is on the wall by construction. */
    const u = Number.isFinite(b?.sFt)
      ? boardU(b.sFt, host)
      : uAt(host.pts, b?.point ?? { x: 0, y: 0 }, { closed: true });
    return { ...boardAsPoint({ id: b?.id, sFt: 0 }, host), u,
             id: b?.id, roomId, role: b?.role ?? null, host };
  }, [hostOf]);

  const board = useDrag({
    state: [boardDrag, setBoardDrag],
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    moved: (from, p) => Math.hypot(p.x - from.x, p.y - from.y)
      >= Math.max(3, (pxPerFt || 12) * 0.12),
    /* --- THE PRIMITIVE'S OWN PAIR, AND EVERY VERB THAT COMES WITH THEM ------
       THIS IS WHAT WAS MISSING. `slideBoardTo` had already been routed through
       `constrainPoint`, so the plate's ARITHMETIC was the primitive's — and the
       gesture still was not, because it wrote its answer in `onMove` and handed
       `useDrag` no `at`, no `to`, no `setList` and no `copy`. Those four are
       where Option-copy, the group move and the snap-back live, so the plate
       inherited none of them. Migrating the maths and not the gesture is
       migrating the half nobody can see. */
    at: (m) => boardAdapters(m.host).at(m),
    to: (m, p) => ({ ...m, ...boardAdapters(m.host).to(m, p) }),
    /* OPTION-COPY, WHICH IS THE WHOLE POINT OF INHERITING. `useDrag` reads the
       modifier live off each frame and calls `forkCopy` once — see RULE 4 there
       — so the original goes back to where it was picked up and the twin is
       what keeps moving, exactly as it does for a ceiling object. */
    copy: true,
    mintId: () => newManualBoardId(),
    /**
     * THE ONE PLACE A POINT BECOMES A DISPATCH — the deciding half of which is
     * `boardSeatWrites`, pure and in boardRules.js so a whole Option-copy can
     * be driven in a test with no renderer. What is left here is spending it.
     *
     * WHICH STORE A SLIDE LANDS IN IS DECIDED IN THE REDUCER, and on a
     * per-frame path that is not a style preference: read from here it would be
     * the membership as of the render that QUEUED the write, which is a frame
     * behind. See BOARD_SLID, which also carries the reason a hand-placed plate
     * has no `boardMoves` entry of its own. So this asks for a slide and does
     * not care where it goes.
     *
     * A RECORD THAT WAS NOT THERE BEFORE IS A TWIN, and a twin is always a
     * HAND-PLACED plate whatever it was copied from: there is no second door in
     * the room and no second bay, so a duplicate of either is simply a plate
     * somebody put on a wall. THE LAMP ROLE IS THE ONE THAT CARRIES OVER —
     * copying a standing lamp's socket to make a second one should give another
     * socket at 300mm and not a switch plate at 1200 — and it is named rather
     * than passed through for that reason.
     */
    setList: (fn) => {
      const before = seats.current;
      seats.current = fn(before);
      for (const w of boardSeatWrites(before, seats.current)) {
        if (w.kind === 'add') docActions.addManualBoard(
          { id: w.id, roomId: w.roomId, sFt: w.sFt, ...(w.role ? { role: w.role } : {}) });
        else docActions.slideBoard(w.id, w.sFt);
      }
    },
    /* THE TWIN IS WHAT IS SELECTED, which is the convention everywhere this
       gesture exists: Option, drag, release — and the plate you just positioned
       is the one in hand, ready to be moved again or given its points. */
    onCopy: ({ ids }) => { if (ids?.[0]) setSel(select('board', ids[0])); },
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
       pick and read the card of. A room whose walls cannot hold a plate is the
       same case and `seatOf` answers null for it. */
    if (!roomId) return;
    const seat = seatOf(allBoardsPx.find((b) => b.id === id), roomId);
    if (!seat) return;
    /* THE MEMBERS ARE WHAT THE HOOK MOVES AND FORKS, and handing none was the
       other half of the omission: `startAll` was empty, so there was nothing
       for a copy to clone even once `copy` was on. One plate today — a
       multi-select of plates would seed several and move as one gesture, which
       the primitive already does and this file does not yet offer. */
    seats.current = [seat];
    board.down(e, { id, roomId, members: [seat] });
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
  /* WHICH FITTING IS UNDER THE POINTER — the twin of `boardUnder`, for the
     other kind of thing an input can terminate at.
     THE POPULATION IS THE WIRED FITTINGS AND NOT EVERY FITTING ON THE CEILING,
     and that is the honest set rather than a shortcut: a fitting no flow reaches
     has no input to feed anything from, so offering it as a drop target would be
     offering a connection that cannot exist. `flowsPx` nodes are exactly the
     fittings that are on a wire.
     THE SLOP IS A FOOT AND A HALF, with a four-pixel floor for the same reason
     `boardUnder` has one: a radius stated in plan units collapses to nothing
     when somebody zooms out, and a drop that only lands at one zoom is a
     gesture people stop trusting. A fitting is a small mark and its own symbol
     is often smaller than the wire running through it, so the target is
     deliberately wider than the glyph.
     NEAREST WINS, so two fittings a few inches apart resolve to the one the
     pointer is actually closer to rather than to whichever was drawn first. */
  const nodeUnder = useCallback((p, exclude = null) => {
    if (!p) return null;
    const slop = Math.max(4, 1.5 * (pxPerFt || 12));
    let best = null, bestD = Infinity;
    for (const f of flowsPx) {
      for (const n of f.nodes ?? []) {
        if (!n || n.id == null || n.id === exclude) continue;
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d <= slop && d < bestD) { best = n; bestD = d; }
      }
    }
    return best;
  }, [flowsPx, pxPerFt]);

  /* --- ...AND WHAT A FITTING'S GRIP MAY NOW LAND ON, WHICH IS TWO THINGS -----
     THE TWO DROPS ARE DIFFERENT SENTENCES ABOUT THE SAME WIRE. Onto a FITTING
     it means "loop that one off this one" — a second output, which is free (see
     `relink` in flows.js). Onto a PLATE it means "and this switch is reached
     from there as well" — two-way switching, which is not an input at all: the
     fitting still has exactly one, and what gained a second end is the SWITCH.
     That is the whole reason one grip can honestly mean both.

     NEAREST WINS, AND IT HAD TO. A bedside sconce and the plate that switches it
     are THE SAME POINT on a plan — that is what a `coincident` flow is — so a
     rule of "fittings first, plates if nothing" would have made every bedside
     plate on the drawing unreachable by this gesture, and "plates first" would
     have taken looping one sconce off another away. Both populations are hit
     tested with their own shape and slop (a plate is a rectangle on a wall, a
     fitting a point on the ceiling), and then the two candidates are compared.

     TO THE PLATE'S BODY AND NOT TO ITS ANCHOR, WHICH IS THE PART THAT MAKES THE
     COMPARISON MEAN ANYTHING. `b.point` is where a plate is SEATED, and the
     coincident sconce sits on exactly that point — so distance-to-anchor against
     distance-to-fitting is two numbers that move together and never separate,
     and the fitting would win at every pixel rather than only at the tie. See
     `boardGap`: zero anywhere on the plate, so aiming an inch INTO it picks the
     plate while the sconce on its corner is a real distance away.

     A TIE GOES TO THE FITTING, and now only an exact tie reaches that line —
     the one pixel where the sconce and the plate's seat coincide. Linking is the
     older gesture and the one that reads off the ceiling, and the ring on the
     drawing says which of the two is armed before the drop either way. */
  const targetFor = useCallback((p, exclude = null) => {
    const node = nodeUnder(p, exclude);
    const board = boardUnder(p, allBoardsPx, { pxPerFt });
    if (!node && !board) return null;
    if (!board) return { id: node.id, kind: 'node' };
    if (!node) return { id: board.id, kind: 'board' };
    const dn = Math.hypot(node.x - p.x, node.y - p.y);
    const db = boardGap(p, board)?.gap ?? Infinity;
    return db < dn ? { id: board.id, kind: 'board' } : { id: node.id, kind: 'node' };
  }, [nodeUnder, allBoardsPx, pxPerFt]);

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
      /* A FITTING'S OWN INPUT, BEING CARRIED. Same shape as the board drag above
         — a rubber band in transient state and one write on the drop — because
         it is the same act: an input is being taken off whatever fed it and put
         on something else. The only difference is what it may land on, and it
         may now land on two kinds of thing: see `targetFor`. */
      if (d.kind === 'node') {
        const over = targetFor(p, d.key);
        flow.set((cur) => (cur
          ? { ...cur, at: p, overId: over?.id ?? null, overKind: over?.kind ?? null }
          : cur));
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
      /* THE GRIP IS AN OUTPUT, AND THE DROP LANDS ON AN INPUT. That sentence is
         the whole direction of this gesture and it is worth being exact about,
         because the obvious reading is the wrong way round.
         WHAT IS IN YOUR HAND is a wire leaving `d.key` — that fitting's output,
         of which it may have any number. WHERE IT LANDS is `d.overId`'s single
         input socket. So the write is `overId's input := key`, and NOT `key's
         input := overId`: dragging from a light to a fan does not re-feed the
         light, it feeds the FAN off the light. Written the other way it looks
         almost right on a two-fitting chain and is exactly backwards on every
         longer one, which is the sort of error that survives a demo.
         ONE INPUT IS WHY THIS IS AN ASSIGNMENT AND NOT AN APPEND. Whatever fed
         the target before is simply replaced — there is no list to add to, and
         no second wire to disconnect first.
         DROPPED ON SOMETHING THIS FITTING ALREADY FEEDS, THE LINK GOES. Same
         way back the plate drag has: dragging a wire home puts the target back
         under the rules rather than pinning it to the answer they currently
         give. The unlink badge is the discoverable half of the same action.
         A RELEASE OVER NOTHING CHANGES NOTHING, exactly as for a plate. "Let go
         over empty ceiling" is what somebody does when they change their mind,
         and reading it as "disconnect this" would throw away a chain they drew
         deliberately. */
      if (d.kind === 'node') {
        if (!d.overId || !d.key) return;
        /* --- DROPPED ON A PLATE: THE SWITCH GAINS A SECOND END ---------------
           NOT AN INPUT, WHICH IS WHY THIS DOES NOT BREAK THE RULE ABOVE. The
           fitting still has exactly one wire feeding it; what has two ends now
           is the SWITCH that operates it, which is the flow. So this writes
           `flowTwoWays` — keyed on the flow — and leaves `flowLinks` alone.
           THE FLOW AND NOT THE FITTING, even though a fitting is what is in
           your hand. Two-way switching is a fact about a circuit: looping one
           lamp of a row off a second plate and not the other five is not a
           thing a wireman can build, and the row is switched as one.
           AND THE SAME DROP TAKES IT OFF AGAIN, exactly as the link does and
           the plate drag does. Dropping on the plate it is already two-wayed
           from is the way back to one way — which matters more here than for
           the other two, because this is the gesture people will trip into by
           aiming at a sconce and hitting its plate. The magenta leg is what
           tells them it happened; this is how they undo it without a menu. */
        if (d.overKind === 'board') {
          if (flowTwoWays?.[d.id] === d.overId) docActions.clearFlowTwoWay(d.id);
          else docActions.setFlowTwoWay(d.id, d.overId);
          return;
        }
        if (flowLinks?.[d.overId] === d.key) docActions.clearFlowLink(d.overId);
        else docActions.setFlowLink(d.overId, d.key);
        return;
      }
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
    // the press. `overId` is what it would land on, and there is not one yet —
    // `overKind` is seeded beside it so the shape of the drag record is the same
    // on the first frame as on every later one.
    flow.down(e, { id, kind, key, at: p, overId: null, overKind: null });
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

  /**
   * ...AND THE SAME PLATE, SEATED BY A LAMP RATHER THAN BY A CLICK.
   *
   * A STANDARD LAMP IS PLUGGED IN AND NOTHING ELSE ON THIS DRAWING IS, so it is
   * the one fitting whose placement can oblige the electrical drawing to grow.
   * `lampSocketSeat` decides both halves — whether anything is in reach, and
   * which piece of wall it goes on if not — and this spends the answer.
   *
   * THE SAME `manualBoards` LIST AND THE SAME KIND OF PLATE, deliberately.
   * A socket the lamp asked for and a socket somebody dropped by hand are the
   * same object: it is drawn the same, it can be dragged along its wall, re-rated,
   * converted to a full switchboard or deleted, and it wires itself and grows its
   * switch on the nearest board by the ordinary route (section 0 of flows.js).
   * Deriving it instead would have meant a fourth source of plates for five
   * readers to remember, and a socket that reappeared every time somebody deleted
   * it.
   *
   * WHICH MAKES IT A DECISION AND NOT A DERIVATION, and that is the honest
   * description: the lamp is where somebody put it, the socket is where it had to
   * go, and from then on both are theirs to move. Moving the lamp afterwards does
   * not chase the socket around — see the note in the README on the same choice
   * for `manualBoards`.
   *
   * ONE DISPATCH IN THE SAME TICK AS THE LAMP'S, which is what makes the pair one
   * undo step: the history coalesces a burst of changes into the state from
   * before it, so placing a lamp and getting its socket is one Ctrl+Z. See
   * QUIET_MS in lib/undo.js.
   */
  const socketForLamp = useCallback((p) => {
    /* THE OTHER LAMPS ARE PART OF THE QUESTION, not just this one. A plate
       seated hard against the lamp that asked for it is out of reach of the
       next lamp four feet away, and two plates go up where one between them
       would have served both — so the rule is handed everything standing in
       the room and may answer "slide the one that is there" instead of
       "add another". See `lampPlateToShare`. */
    const lamps = obstaclesPx.filter((o) => o.kind === 'standing_lamp');
    const best = lampSocketSeat(p, { rooms, plates: allBoardsPx, lamps, pxPerFt });
    if (!best) return null;
    /* MOVING A PLATE IS THE SAME WRITE A DRAG MAKES, which is what keeps this
       to one mechanism: `sFt` is a distance round the room's walls and
       `slideBoard` is what a hand dragging a plate along them writes. Nothing
       here knows whether the plate is a lamp's or somebody's. */
    if (best.slide) { docActions.slideBoard(best.slide, best.sFt); return best.slide; }
    const id = newManualBoardId();
    /* THE ROLE IS THE LOAD-BEARING FIELD AND IT USED TO BE MISSING. Without it
       the plate came out of `placedBoards` as an ordinary hand-dropped board —
       born a socket outlet, at switch height, with no switch on it and no way
       for the lamp's wire to land on it. The role is what makes it a lamp's
       plate: socket height, born a switchboard, no spare socket, and named for
       what it serves. See LAMP_BOARD_ROLE in lib/electrical.js. */
    docActions.addManualBoard({
      id, roomId: best.roomId, sFt: best.seat.sFt, role: best.role });
    return id;
  }, [rooms, allBoardsPx, obstaclesPx, pxPerFt, docActions]);

  return {
    boardDrag, setBoardDrag, flowDrag, setFlowDrag,
    boardPointerDown, boardPointerMove, boardPointerUp,
    flowPointerDown, flowGripDown, flowPointerMove, flowPointerUp,
    placeBoardAt, socketForLamp,
  };
}

export default useBoardGestures;
