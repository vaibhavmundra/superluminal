// ---------------------------------------------------------------------------
// useFixtureGestures.js — THE FIVE DRAGS AND THE PRESSES THAT PLACE.
//
// A light slid inside its own cell, a ceiling object moved/resized/rotated, a
// hand-placed lamp, a whole array carried, and a module sliding along its run —
// plus the four branches of the canvas's pointer router that belong to this
// domain, and the one command (`openArray`) that is a gesture's.
//
// THE FEATURE'S FOURTH AND LAST CALL SITE, AND IT IS THE LOWEST BECAUSE OF WHAT
// IT NEEDS: `svgPoint`, `svgRef`, `pressState`, `shapeTook`, the geometry
// feature's hit tests and App's `snapTargets` are all defined above it and
// below the scene, and a hook's arguments are evaluated during render. Every
// one of the five is a `useDrag` and every press is a plain function, so
// nothing between the earlier call sites and this one calls any of them.
//
// THE LIFECYCLE IS hooks/useDrag.js AND THE ARITHMETIC IS lib/dragMove.js —
// the press slop, the line measured from the anchor rather than from the last
// frame, the axis re-decided every frame, and Option leaving a copy behind.
// What is stated at each call site below is only what is a fact about THAT
// fitting.
//
// EACH ROUTER BRANCH RETURNS `true` WHEN IT HAS TAKEN THE EVENT, which is the
// idiom the geometry feature's branches already use, and for the same reason:
// the ORDER between them is App's, because other machines' branches sit in
// between and only App knows the precedence.
// ---------------------------------------------------------------------------
import { useCallback } from 'react';
import { useDrag } from '../../hooks/useDrag.js';
import { select, selectMany, clear } from '../../lib/selection.js';
import { canGrab, owns } from '../../lib/pressOwner.js';
import { snapPoint } from '../../lib/snapGuides.js';
import { clampLightMove } from '../../lib/planner.js';
import { newCobId, placeCob, recommendCob } from '../../lib/cob.js';
import { isTrack as shapeIsTrack } from '../../lib/ceilingShapes.js';
import { moduleWatts, placeModule } from '../../lib/magTrack.js';
import {
  makeCeilingObject, resizeFromCorner, rotateTo, halfExtents, isUniform,
  applyResize, withSweep, newCeilingObjectId,
} from '../../lib/ceilingObjects.js';
import { clampContext, lightKey, moduleU, nextArrayDraft,
         rollbackCobs, arrayLanded } from './fixtureRules.js';

export default function useFixtureGestures({
  state, fixtures, cobTool,
  rooms, pxPerFt, zoom, opt, source, addTool, selAccId, overRoom,
  manualCobs, cobArrays, trackFixtures, ceilingObjs,
  svgPoint, svgRef, pressState, shapeTook,
  roomAt, insideAnyRoom, snapTargets, snapTol,
  arrayOutline, shapeAtPointer, geomUnder, geomHover, setGeomHover,
  clearShapeEdit, standDown,
  docActions, setSel, guides, setGuides, setOverRoom, setAddAt, setOptionPick,
}) {
  const {
    lightDrag, setLightDrag, lightMoved,
    objDrag, setObjDrag, objMode, setObjMode, selObjIds, toggleSelObj,
    armed, setArmed, ghost, setGhost, fanSweepMm,
    cobOnce, setCobOnce, cobStanding, setCobRun, cobLock, setCobLock,
    setCobAt, cobDraftArray, setCobDraftArray,
    arrayDrag, setArrayDrag, trackMode, setTrackMode,
    moduleDrag, setModuleDrag,
  } = state;
  const basisFor = fixtures.cob.basisFor;
  const arrayCobsPx = fixtures.arrays.lampsPx;
  const magTrackById = fixtures.tracks.byId;

  /* --- ONE LIGHT'S WHOLE GESTURE --------------------------------------------

     NO POINTER CAPTURE, AND THIS IS THE ONE DRAG ON THIS CANVAS THAT REFUSES
     IT — which is why `capture` is simply not given to the hook. Every other
     one captures to the <svg> so the gesture survives leaving the thing it
     started on, but capture RETARGETS the click the browser synthesises on
     release, and a click on a light already means something: it opens that
     chunk's ceiling options. Capture would send that click to the canvas
     instead, and the pill — the way this app's main decision is made — would
     stop opening on a press that had merely wobbled.
     IT COSTS NOTHING HERE. The svg carries the move and up handlers itself, so
     a drag that leaves the fitting is still tracked; and the fitting can only
     travel ±20% of one cell, so there is no version of this gesture that leaves
     the sheet. Capture buys the other drags something this one does not need.

     NOTHING IS WRITTEN UNTIL THE DROP, which is the opposite of what the ceiling
     objects and the cove shapes do, and the difference is what it costs. Those
     write per move and the layout memo re-runs — which for them is a re-chunk
     and a re-grid, expensive but survivable. A light's own position is INSIDE
     that layout: committing per frame would re-run `planLights` for the room on
     every pointer event, and `planLights` runs its placement up to four times
     and then two alignment passes. That is a solver in a mousemove. So the
     gesture carries the live position, the canvas draws the fitting there (see
     `movingLight`), and the store is written once in `onCommit`. What is lost is
     the neighbours re-aligning live; what is gained is a drag that keeps up with
     the pointer. So there is no store to hand the hook.

     THE CLAMP RUNS PER FRAME EVEN SO, and it is the constraint that makes this
     gesture what it is — so it stays in the caller. It is the cheap half — a
     band, four predicates and a walk back along one segment — and the light has
     to STOP at the edge while you are still pushing, or the box drawn on the
     drawing is decoration.

     ITS THRESHOLD IS A FRACTION OF THE DRAWING, shared with the cove shape and
     the plate. Here it is doing something it does nowhere else: a click on a
     light already means "open this chunk's ceiling options", so a press that
     does not travel is still a click, the pill still opens, and only a press
     that travels becomes a move. */
  const light = useDrag({
    state: [lightDrag, setLightDrag],
    point: svgPoint,
    at: (o) => ({ x: o.x, y: o.y }),
    moved: (from, p) => Math.hypot(p.x - from.x, p.y - from.y)
      >= Math.max(3, pxPerFt * 0.12),
    onMove: (q, { drag: d }) => {
      const r = rooms.find((z) => z.id === d.roomId);
      const l = r?.plan?.lightsPx?.find((z) => z.cellKey === d.cellKey);
      if (!l?.cell) return;
      const want = { x: (q.x - r.geo.origin.x) / pxPerFt,
                     y: (q.y - r.geo.origin.y) / pxPerFt };
      const at = clampLightMove(l.cell, want, {
        ...clampContext(r, opt),
        // Every OTHER light in the space. The dragged one is excluded by cell
        // rather than by identity: it is a different object each render.
        others: r.plan.lights.filter((z) => z.cell?.id !== l.cell.id),
      });
      if (!at) return;
      light.set((cur) => (cur ? { ...cur, at: r.geo.toPx(at) } : cur));
    },
    /**
     * LETTING GO, WHICH IS THE ONLY WRITE.
     *
     * A PRESS THAT NEVER TRAVELLED WRITES NOTHING, which is the hook's own rule
     * and exactly what is wanted here: it was a click on a light, which already
     * means something, and storing an offset of zero for it would mark the
     * fitting "moved by hand" for the life of the plan, pinning it out of the
     * alignment pass for a gesture nobody made.
     */
    onCommit: (ids, d) => {
      if (!pxPerFt) return;
      lightMoved.current = true;
      const r = rooms.find((z) => z.id === d.roomId);
      const l = r?.plan?.lightsPx?.find((z) => z.cellKey === d.cellKey);
      if (!l?.cell) return;
      const ft = { x: (d.at.x - r.geo.origin.x) / pxPerFt,
                   y: (d.at.y - r.geo.origin.y) / pxPerFt };
      docActions.moveLight(d.roomId, d.cellKey, ft.x - l.cell.cx, ft.y - l.cell.cy);
    },
  });

  /**
   * PICKING A LIGHT UP.
   *
   * THE PRESS SELECTS AND THE DRAG MOVES, with the slop between them — see
   * `light` above for why the threshold is carrying more weight here than
   * anywhere else on this canvas.
   */
  const lightPointerDown = (e, roomId, l) => {
    if (e.button != null && e.button !== 0) return;
    if (!canGrab(pressState)) return;
    if (!l.bandPx || !l.cellKey || !pxPerFt) return;
    e.preventDefault();
    e.stopPropagation();
    // ONE SELECTION ON THIS CANVAS.
    setSel(select('light', lightKey(roomId, l.cellKey)));
    clearShapeEdit();
    lightMoved.current = false;
    /* THE MEMBER IS SYNTHETIC, and that is the honest shape of this one. A light
       is not a row in a list the drag can write to — it is one cell's share of
       the ambient level, identified by its cell — so what the hook is given is
       the position it was picked up at, keyed by `cellKey`. That is enough for
       the grab offset and for the anchor, which is all this gesture needs from
       it: nothing here applies a delta to a store. */
    light.down(e, {
      id: l.cellKey, members: [{ id: l.cellKey, x: l.x, y: l.y }],
      roomId, cellKey: l.cellKey,
      // WHERE THE FITTING IS BEING HELD, in plan pixels. The canvas draws it
      // here for the length of the gesture — see `movingLight`.
      at: { x: l.x, y: l.y },
    });
  };

  const lightPointerMove = (e) => { if (pxPerFt) light.move(e); };
  const lightPointerUp = light.up;

  /**
   * OPEN AN ARRAY, AND CLOSE EVERYTHING ELSE THAT WANTS THE SAME SPACE.
   *
   * ONE CONTEXTUAL BAR AT A TIME, AND IT IS NOT A PREFERENCE. Both bars on this
   * drawing are `position: fixed`, centred over the stage, 26px off its foot —
   * see BOTTOM in CobSpec and in ShapeMenu, which deliberately share the figure
   * on the argument that the two are never up together. Two of them up IS two
   * rows of buttons in one place: the second draws over the first, and half the
   * controls somebody can see belong to an object they are not looking at.
   *
   * SO OPENING ONE IS ALSO AN ACT OF CLOSING, and the LIST of what has to go is
   * App's rather than this feature's — it names the zone editor, the door
   * editor, the switchboard step, both geometry bars and whatever hand tool is
   * armed, which is arbitration between seven owners. It is handed in as
   * `standDown` and called on the line the block stood on. Same split
   * `openShapeTool` already has.
   *
   * IT ALSO PUTS THE PANEL ON THE SPACE THE RUN IS IN, which is what every other
   * fitting's press does through `analysisHighlight` — an array is one row in
   * that panel (see `roomFixtureGroups`) and the row is where its wattage can
   * also be changed, so the two have to be looking at the same room.
   */
  const openArray = useCallback((id) => {
    // ONE SELECTION ON THIS CANVAS. Two things picked would be two things Delete
    // could mean, and taking the register is how this one stops being a list of
    // ten clears that had to be kept in step with the ten selections.
    setSel(select('array', id));
    /* THE SHAPE BAR GOES WITH THE SHAPE. Selecting a shape is what puts the bar
       into its `edit` state — see `shapeMode` — so clearing the tool is not
       enough on its own; the selection has to go too, which the line above now
       does, or the bar comes straight back up over the array's. */
    standDown();
    setTrackMode(null);
    setArmed(null); setGhost(null);
    const roomId = cobArrays.find((a) => a.id === id)?.roomId ?? null;
    if (roomId) { docActions.setFocusId(roomId); docActions.setView('spaces'); }
  }, [docActions, standDown, cobArrays, setSel, setTrackMode, setArmed, setGhost]);

  /**
   * Snap a point, publish the guides for it, and hand back where it landed.
   *
   * `lock` IS THE COORDINATE A SHIFT-DRAG HAS FROZEN — 'x' or 'y', or null for
   * an unconstrained drag. Two things follow from it and both matter.
   *
   * THE FROZEN COORDINATE SURVIVES THE SNAP. Snapping is free to pull a point
   * anywhere within tolerance, so without this a straight drag would come off
   * its line the moment it passed something worth aligning to — Shift promises a
   * straight line and the snap does not get to break that promise. The other
   * axis is snapped as usual, which is the combination actually wanted: slide
   * along the row, catch the next cassette's centre, stay exactly on the line.
   *
   * AND NO GUIDE IS DRAWN FOR IT. A guide is a claim that the drag has taken an
   * alignment; drawing one for an axis we are about to override would be a line
   * that lies about where the object is going.
   */
  const applySnap = (ptPx, excludeId, lock = null) => {
    const r = snapPoint(ptPx, snapTargets(excludeId), { tol: snapTol() });
    setGuides(r.guides.filter((g) => g.axis !== lock));
    return { x: lock === 'x' ? ptPx.x : r.x, y: lock === 'y' ? ptPx.y : r.y };
  };

  /**
   * WHERE A DRAGGED OBJECT LANDS, once the shift lock has had its say.
   *
   * A CEILING OBJECT IS HELD IN FEET AND THE SNAPPER SPEAKS PIXELS, so this is
   * the round trip and the exclusion list, and nothing else. The two rules this
   * used to state — the line measured from the press rather than the last frame,
   * and the axis re-decided every frame instead of latched on the first pixel —
   * are stated once in lib/dragMove.js and enforced once in hooks/useDrag.js,
   * which hands the point here already locked.
   *
   * IT SERVES THE ORDINARY MOVE AND THE FIRST MOVE OF AN OPTION-COPY ALIKE,
   * because "hold Shift to go straight" has to mean the same thing whichever of
   * the two you are doing — and holding both modifiers at once (copy, in a
   * straight line) is the gesture that lays out a row.
   */
  const objSnapAt = (ftPt, axis, excludeId) => {
    const r = applySnap({ x: ftPt.x * pxPerFt, y: ftPt.y * pxPerFt }, excludeId, axis);
    return { x: r.x / pxPerFt, y: r.y / pxPerFt };
  };

  /* --- A CEILING OBJECT'S WHOLE GESTURE -------------------------------------

     ONE PRESS, THREE MEANINGS, AND ONLY ONE OF THEM IS A TRANSLATION. `moves`
     is that distinction: move carries the members and may leave a copy behind;
     resize and rotate act on one object's own frame and are handled in `onMove`
     below, where the arithmetic that is theirs already lives. Their handles are
     only drawn when exactly one thing is selected (see PlanCanvas), so they can
     only ever mean `[id]`.

     HELD IN FEET, because a ceiling object is a real thing of a real size that
     somebody placed and it has to survive a scale correction. So `point` is in
     feet too, and the snapper's pixels are `objSnapAt`'s round trip.

     NO SLOP, AND IT IS THE ONLY DRAG HERE BESIDES THE DOOR BOX WITH NONE.
     Selecting a ceiling object is a press with a handle under it or Shift held,
     never a bare press that might have been a nudge, so there is no click
     meaning for a threshold to protect. `slopPx: 0`. */
  const obj = useDrag({
    state: [objDrag, setObjDrag],
    point: (e) => { const p = svgPoint(e); return { x: p.x / pxPerFt, y: p.y / pxPerFt }; },
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    at: (o) => ({ x: o.x, y: o.y }),
    to: (o, q) => ({ ...o, x: q.x, y: q.y }),
    setList: docActions.updateObjects,
    slopPx: 0,
    moves: (d) => d.mode === 'move',
    ortho: true,
    snap: (q, axis, { ids }) => objSnapAt(q, axis, ids),
    copy: true,
    mintId: () => newCeilingObjectId(),
    /* THE TWIN IS WHAT KEEPS MOVING, which is the convention everywhere this
       gesture exists and the one that makes a row of cassettes possible: drag,
       Option, release — and the thing you just positioned is the one still
       selected, ready to be dragged again. */
    onCopy: ({ ids }) => setSel(selectMany('object', ids)),
    /* RESIZE AND ROTATE, WHICH ARE NOT TRANSLATIONS AND SO GET NO DELTA. Both
       are singular and both read the object as it was at the PRESS — rule 2
       again: resizing from a live value compounds each frame's rounding into a
       cassette that creeps as you drag its corner. */
    onMove: (ftPt, { drag: d, event: e }) => {
      if (d.mode === 'move') return;
      /* THE GUIDES ARE DROPPED HERE AND NOT INSIDE THE UPDATER. They are a
         property of the GESTURE — see `onRelease` — and clearing them was a
         `setGuides([])` sitting inside the `setCeilingObjs` updater, which a
         reducer may not carry: React is free to invoke it twice. The condition
         read `guides` from this closure either way, so lifting it out changes
         nothing except that the write happens once. */
      if (guides.length) setGuides([]);
      docActions.updateObjects((os) => os.map((o) => {
        if (o.id !== d.id) return o;
        const base = d.startAll[d.id];
        if (!base) return o;
        if (d.mode === 'resize') {
          const { hw, hh } = halfExtents(base);
          const next = resizeFromCorner(
            { wFt: hw * 2, hFt: hh * 2, x: base.x, y: base.y, rot: base.rot || 0 },
            d.corner, ftPt,
            // Shift locks the ratio; a round object has no ratio to unlock. Alt
            // resizes about the centre instead of the opposite corner.
            { uniform: e.shiftKey || isUniform(base), fromCentre: e.altKey });
          return applyResize(o, next);
        }
        if (d.mode === 'rotate') {
          return { ...o, rot: rotateTo(o, ftPt, {
            startRot: d.startRot, startAngle: d.startAngle, snap: e.shiftKey }) };
        }
        return o;
      }));
    },
    // The guides are a property of the GESTURE, not of the object.
    onRelease: () => setGuides([]),
  });

  const objPointerDown = (e, id, mode, corner = null) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    if (!pxPerFt) return;
    e.stopPropagation();
    e.preventDefault();

    /* SHIFT-CLICK BUILDS THE SELECTION AND STARTS NO DRAG, and that separation
       is what lets one modifier do two jobs without either being ambiguous.
       Shift on a PRESS adds or removes an object; Shift during a DRAG holds it
       to one axis. A press cannot yet know whether it will become a drag, so
       guessing here would mean either a click that sometimes nudged the object
       or an axis lock you could not engage without first deselecting something.
       Split by gesture instead: Shift-click to gather them up, then press
       WITHOUT Shift on any member to drag the group, adding Shift mid-drag for
       the straight line. Both modifiers are still available for the group. */
    if (mode === 'move' && e.shiftKey) {
      setObjMode(true); setArmed(null); setGuides([]); setGhost(null);
      toggleSelObj(id);
      return;
    }

    const o = ceilingObjs.find((q) => q.id === id);
    if (!o) return;
    setObjMode(true);
    setArmed(null); setGuides([]); setGhost(null);

    /* PRESSING A MEMBER OF THE SELECTION DRAGS ALL OF IT; pressing anything
       else makes that one thing the selection. This is the rule that makes a
       multi-selection worth having — gather four cassettes, then move them as
       one — and it is also what stops a stale selection biting: a press on an
       object that is not in the group replaces the group rather than dragging a
       set the user has stopped thinking about.

       A HANDLE IS ALWAYS SINGULAR. Resize and rotate act on one object's own
       frame, and the handles are only drawn when exactly one thing is selected
       (see PlanCanvas), so a resize press can only ever mean `[id]`. */
    const group = mode === 'move' && selObjIds.includes(id) ? selObjIds : [id];
    setSel(selectMany('object', group));

    const pressPx = svgPoint(e);
    const ft = { x: pressPx.x / pxPerFt, y: pressPx.y / pxPerFt };
    /* WHO IS MOVING, AND WHERE THEY ALL WERE WHEN IT STARTED — the hook takes
       the snapshots from `members`. What rides along on top of them is the two
       numbers a ROTATION needs, which have no meaning for the other two modes
       and are cheaper to take once than to re-derive per frame. */
    obj.down(e, {
      id, members: ceilingObjs.filter((q) => group.includes(q.id)),
      mode, corner,
      startRot: o.rot || 0,
      startAngle: Math.atan2(ft.y - o.y, ft.x - o.x),
    });
  };

  const objPointerMove = (e) => { if (pxPerFt) obj.move(e); };
  const objPointerUp = obj.up;

  /* --- A LAMP'S WHOLE GESTURE ------------------------------------------------

     THE LIFECYCLE IS hooks/useDrag.js AND THE ARITHMETIC IS lib/dragMove.js.
     What is left here is the six things that are facts about a DOWNLIGHT, and
     nothing else — which is why this is worth reading as the shape every drag
     on this canvas now has.

     PLAN FEET AT THE STORE AND PLAN PIXELS AT THE POINTER, which is why `at`
     and `to` exist at all: `manualCobs` holds `xFt`/`yFt` so that a scale
     correction does not move a lamp (see the store's own note), and the pointer
     only ever speaks pixels. */
  const cob = useDrag({
    point: svgPoint,
    /* THE POINTER IS CAPTURED ON THE SVG, exactly as the object drag captures
       it: a lamp dragged toward the edge of the sheet routinely releases outside
       the element the press landed on, and without capture that release is
       somebody else's event and the drag never ends. */
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    at: (o) => ({ x: o.xFt * pxPerFt, y: o.yFt * pxPerFt }),
    to: (o, q) => ({ ...o, xFt: q.x / pxPerFt, yFt: q.y / pxPerFt,
                     roomId: roomAt(q)?.id ?? o.roomId,
                     /* MOVING A LAMP ADOPTS IT. It is no longer where the rule
                        put it, so switching autoplace off must not take it
                        away — see `autoplaceCobs`. */
                     auto: false }),
    setList: docActions.updateCobs,
    zoom,
    ortho: true,
    snap: (q, axis, { ids }) => cobTool.snapAt(q, axis, ids),
    copy: true,
    mintId: (n) => newCobId(`c${n}`),
    /* THE TWIN IS WHAT KEEPS MOVING, which is the convention everywhere this
       gesture exists and the one that makes a row of lamps possible: drag,
       Option, release — and the thing you just positioned is the one still
       selected, ready to be dragged again. */
    onCopy: ({ ids, twinOf, drag }) => setSel(select('cob', twinOf[drag.id] ?? ids[0])),
    /* A LAMP DROPPED OFF EVERY CEILING GOES BACK WHERE IT CAME FROM, and that is
       the one thing this drag does on release beyond clearing the gesture. See
       `rollbackCobs`. */
    onCommit: (ids, d) => docActions.replaceCobs(rollbackCobs({
      list: manualCobs, ids, startAll: d.startAll, pxPerFt, roomAt })),
    // The guides are a property of the GESTURE, not of the lamp.
    onRelease: () => setGuides([]),
  });

  /**
   * PICKING UP A COB SOMEBODY PLACED — and it can be MOVED, which is a reversal.
   *
   * IT USED TO BE SELECTION ONLY, and the note here argued that a fitting which
   * could be nudged by a press meant to select it would quietly undo the one act
   * it exists to record. The argument was about a press that acts immediately;
   * it is answered by the drag slop rather than by refusing the gesture. A press
   * that never travels three screen pixels is still a click and still only
   * selects; past that it is a move, because somebody has visibly asked for one.
   * See `movedEnough` in lib/dragMove.js.
   *
   * WHAT IT DOES NOT DO IS RESIZE OR ROTATE. A downlight is a round hole of a
   * size the catalogue decides and it has no orientation, so the frame of grips
   * a ceiling object carries would be three controls that cannot do anything.
   * Position is the whole of what a person chooses about one.
   *
   * NOT WHILE ANY TOOL IS ARMED, and this one has no exemption of the sort the
   * spot grants itself. The COB's own gesture is a press on open ceiling that
   * places a lamp, so a press stolen by the lamp already there would make the
   * one thing somebody does twenty times in a row fail the moment two of them
   * were near each other. Put the tool down to pick one up — which is one press
   * on the cell that is latched right in front of them.
   */
  const cobPointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    // `!pxPerFt` IS NOT ARBITRATION and stays its own check: it asks whether
    // there is a drawing at all, which fails to nothing rather than to somebody
    // else's machine.
    if (!canGrab(pressState) || !pxPerFt) return;
    /* --- A LAMP THAT BELONGS TO AN ARRAY IS NOT A LAMP YOU CAN PICK UP -------
       The canvas draws the hand-placed lamps and every array's lamps in ONE list
       — on the ceiling they are the same fitting, see the note at the call site
       — so this handler receives both, and the id is the only thing that says
       which. A hand-placed one is in `manualCobs`; an array's is a memo worked
       out from a geometry and a count, and there is nothing about it on its own
       to select or to move.
       SO THE PRESS RESOLVES TO THE ARRAY. That is what somebody aiming at one of
       twelve lamps on a ring has actually got hold of, and the array is a thing
       with a specification, a count and a position. See `arrayGrab`. */
    const own = arrayCobsPx.find((q) => q.id === id);
    if (own) { arrayGrab(e, own.arrayId); return; }
    const c = manualCobs.find((q) => q.id === id);
    if (!c) return;
    e.stopPropagation();
    e.preventDefault();
    setSel(select('cob', id));
    setArmed(null);
    /* THE SPACE AND THE TAB ARE NOT SET HERE. Selecting a fitting reveals it in
       the Analysis, and that is one behaviour shared by every fitting on this
       canvas — so it lives in one effect over `analysisHighlight` rather than
       being written out in this handler and the three like it. */

    /* WHO IS MOVING AND WHAT THEY LOOKED LIKE. One lamp today, because a COB
       has no multi-selection; kept in the group shape anyway so that adding one
       is a change to the SELECTION and not to this gesture. The hook takes the
       capture, the grab offset, the press anchor and the snapshots from here —
       see hooks/useDrag.js. */
    cob.down(e, { id, members: [c] });
  };

  const cobPointerMove = (e) => { if (pxPerFt) cob.move(e); };
  const cobPointerUp = cob.up;

  /* --- AN ARRAY: OPENED BY ITS LAMPS, CARRIED BY ANY OF THEM -----------------

     ONE PRESS, TWO ANSWERS, AND THE SLOP DECIDES WHICH. A press that never
     travels is a click and only opens the array; past three screen pixels it is
     a move, because somebody has visibly asked for one. That is rule 1 in
     lib/dragMove.js and it is what lets one gesture both select and drag without
     a click that wobbles quietly shifting a run of twelve lamps.

     WHAT MOVES IS THE ARRAY AND NOT THE GEOMETRY UNDER IT. See `shiftPts` in
     lib/cob.js: an array records which geometry it is set out on and what it did
     to it, and a displacement is one more entry in the second list. The
     rectangle keeps its position, the cove drawn on it keeps its position, and
     editing the rectangle still carries the run with it — which is the thing the
     reference was for.

     THE SIMPLEST OF THE FIVE, and what is left at the call site says so: a
     displacement, the shift lock, and one rule about where it may be let go. The
     displacement is `dxFt`/`dyFt` on the array itself, in feet, so `at` and `to`
     are the pixel round trip and nothing more.

     NO SNAP AT ALL, WHICH IS A DECISION AND NOT AN OMISSION. No guide is drawn
     for the frozen axis, and none is drawn for the free one either: an array is
     set out on a geometry, and a dotted line claiming it had found an alignment
     of its own would be a claim about the wrong object. */
  const array = useDrag({
    state: [arrayDrag, setArrayDrag],
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    at: (o) => ({ x: (o.dxFt || 0) * pxPerFt, y: (o.dyFt || 0) * pxPerFt }),
    to: (o, q) => ({ ...o, dxFt: q.x / pxPerFt, dyFt: q.y / pxPerFt }),
    setList: docActions.updateArrays,
    zoom,
    /* SHIFT HOLDS IT TO ONE AXIS, from the anchor rather than from the last
       frame, so a run nudged sideways stays exactly level with where it was —
       which is the whole reason anybody reaches for the modifier here. */
    ortho: true,
    /**
     * LETTING GO OF A RUN.
     *
     * A RUN DROPPED OFF EVERY CEILING GOES BACK WHERE IT CAME FROM — the lamp
     * drag's own rule (see the COB's `onCommit`), said about twelve at once and
     * there for its reason rather than as a tidy-up. An array's `roomId` is what
     * the Analysis counts it under, what its pools are clipped to and what its
     * ceiling height is read from; carried clear of that room it would be a row
     * of fittings drawn in the hall, counted in the bedroom, and clipped to a
     * polygon they are nowhere near — visible on the sheet and absent from every
     * reading of it. See `arrayLanded` for why any one lamp inside a room is
     * enough.
     */
    onCommit: (ids, d) => {
      const own = arrayCobsPx.filter((c) => c.arrayId === d.id);
      if (arrayLanded({ lamps: own, roomAt })) return;
      const base = d.startAll[d.id];
      docActions.patchArray(d.id, { dxFt: base?.dxFt || 0, dyFt: base?.dyFt || 0 });
    },
  });

  const arrayGrab = (e, arrayId) => {
    const a = cobArrays.find((q) => q.id === arrayId);
    if (!a || !pxPerFt) return;
    e.stopPropagation();
    e.preventDefault();
    /* THE PRESS IS SPOKEN FOR, so the click the browser synthesises on release
       is not read as a press on bare plan — which would clear the selection and
       swap the array's bar for the space's geometry tools, forty milliseconds
       after opening it. Same flag every grip on this canvas sets. */
    shapeTook.current = true;
    openArray(arrayId);
    array.down(e, { id: arrayId, members: [a] });
  };

  const arrayPointerMove = (e) => { if (pxPerFt) array.move(e); };
  const arrayPointerUp = array.up;

  /* --- A MODULE, PICKED UP AND SLID ALONG ITS RUN ---------------------------

     ONE AXIS, AND IT IS NOT A CONSTRAINT THIS APP INVENTED — see `moduleU`,
     which carries the rule and the no-overlap clearance.

     THE SAME SLOP EVERY OTHER DRAG ON THIS CANVAS USES, so a press that only
     meant to select does not nudge a fitting three pixels — rule 1 in
     lib/dragMove.js.

     NO STORE IS HANDED TO THE HOOK, AND THAT IS THE POINT OF THIS ONE. What a
     module has is not a position but a FRACTION of a path, so there is no `at`
     and no `to`: the hook resolves the pointer, and `onMove` turns it into a `u`
     the same way the placing press does. The constraint stays in the caller
     because the constraint is the whole of what a module is. */
  const mod = useDrag({
    state: [moduleDrag, setModuleDrag],
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    zoom,
    onMove: (p, { drag }) => {
      const f = trackFixtures.find((q) => q.id === drag.id);
      const run = f ? magTrackById[f.trackId] : null;
      if (!run) return;
      /* EXCLUDED RATHER THAN INCLUDED, because a module always clashes with
         itself. */
      const taken = trackFixtures.filter(
        (q) => q.trackId === f.trackId && q.id !== f.id);
      const u = moduleU({ run, p, taken, kind: f.kind, watts: f.watts });
      if (u == null) return;   // the rest of the run is full — leave it where it is
      docActions.patchTrackFixture(f.id, { u });
    },
  });

  const modulePointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    /* THE SECOND NAMED EXEMPTION ON THIS CANVAS, alongside the spot's.
       `pressOwner` says the TOOL owns this press — see lib/pressOwner.js — and
       this handler departs from that answer on purpose: you clip six modules
       onto a run, and a press stolen by the module already there would make the
       one thing somebody does repeatedly fail the moment two were near each
       other. It returns WITHOUT stopping the event, so the press falls through
       to the canvas and places the next one. */
    const moduleRunExempt = addTool === 'module';
    if (moduleRunExempt) return;        // a press with the tool in hand PLACES one
    /* AND EVERYTHING ELSE GOES THROUGH THE ROUTER. This was a hand-written
       variant — `addTool || zoneMode || armed || boardPlace` — and it was
       missing two of the seven machines: the door editor and an armed cove
       primitive both had their presses swallowed here. That is the exact class
       of bug lib/pressOwner.js exists for, and this is now the one rule with the
       one exemption above it declared by name. `!pxPerFt` is not arbitration and
       stays its own check. */
    if (!canGrab(pressState) || !pxPerFt) return;
    const f = trackFixtures.find((q) => q.id === id);
    if (!f) return;
    e.stopPropagation();
    e.preventDefault();
    /* THE PRESS IS SPOKEN FOR, so the click the browser synthesises on release is
       not read as one on bare plan — which would clear the selection and swap
       whatever bar is up for the space's own. */
    shapeTook.current = true;
    setSel(select('module', id));
    mod.down(e, { id });
  };

  const modulePointerMove = (e) => { if (pxPerFt) mod.move(e); };
  const modulePointerUp = mod.up;

  /* --- A MODULE CLIPS INTO A TRACK, AND ONLY INTO A TRACK --------------------
     AHEAD OF THE ROOM TEST, AND THAT IS THE POINT OF ITS POSITION. Every other
     tool asks "is there a ceiling here" first, because every other tool puts a
     fitting ON a ceiling. A module goes on a PROFILE: the run is the thing that
     has to be under the pointer, and a profile drawn across a threshold is one
     object whose middle may be over a doorway. Asking about the room first would
     refuse a press on the one thing the press is about.

     A PRESS ANYWHERE ELSE DOES NOTHING AND DOES NOT DISARM, which is the COB's
     third exemption said about a module: you clip six of these onto a run, and a
     tool that had to be re-armed after a stray click on the ceiling beside it
     would be a trip to the rail per module. The cursor has already said the
     press is dead out there — see `geomHover`, which is what turns the pointer
     into a hand over a run and leaves it an arrow everywhere else.

     WHERE ALONG THE RUN IS WHERE THE CLICK LANDED, projected onto the path and
     then moved to the nearest place the body fits — see `moduleU`. Two modules
     cannot occupy the same inch of extrusion, and that is a fact about the
     product rather than a rule this app is imposing. */
  const moduleDown = (e, p) => {
    if (addTool !== 'module') return false;
    const hit = shapeAtPointer(p);
    const run = hit && shapeIsTrack(hit) ? magTrackById[hit.id] : null;
    if (!run || !trackMode) return true;
    e.preventDefault();
    const taken = trackFixtures.filter((f) => f.trackId === run.id);
    /* CLEARED AT THE BODY THIS MODULE WILL ACTUALLY BE, and every module
       already on the run at its own — a 5 W diffuser is a 200 mm stub and an
       18 W one a 400 mm bar, so one clearance figure for the lot would refuse
       the small one a gap it fits and let the big one overlap. See
       `DIFFUSER_LENGTHS_MM`. */
    const u = moduleU({ run, p, taken, kind: trackMode,
                        watts: moduleWatts(trackMode) });
    if (u == null) return true;   // the run is full — see `placeableU`
    docActions.addTrackFixtures([
      placeModule({ trackId: run.id, kind: trackMode, u, seq: trackFixtures.length })]);
    /* AND THE PANEL GOES TO THE SPACE IT LANDED IN, on the first module of
       a run, for the reason the first COB of a run opens its space: a
       diffuser is an ambient source and the two figures at the top of the
       Analysis move as you clip them on, which is the only reason watching
       them is worth anything. */
    if (run.roomId && !trackFixtures.some((f) => f.trackId === run.id)) {
      docActions.setFocusId(run.roomId); setOptionPick(null); docActions.setView('spaces');
    }
    return true;
  };

  /* --- THE ARRAY PICKS A GEOMETRY RATHER THAN PLACING A LAMP -----------
     THE SAME TOOL AND A DIFFERENT QUESTION. Manual mode asks "where"; the
     array asks "on what", and the answer is a thing already on the drawing.
     So the press selects rather than places, and everything the bar goes on
     to ask — how many, which side, how far — is about the thing it selected.

     A SHAPE UNDER THE POINTER WINS OVER THE ROOM IT IS IN, which is the
     most-specific-first rule this canvas follows everywhere. A guide drawn
     inside a room is always also inside that room's outline; without the
     ordering the smaller of the two targets could never be hit.

     AND THE ROOM'S OWN OUTLINE IS A GEOMETRY. It is the one every plan has,
     it is what you offset from to ring a room with downlights, and it needs
     no drawing first. `room:` says which list to look in — see
     `arrayOutline`. */
  const arrayDown = (e, p, room, cobMode) => {
    if (!(addTool === 'cob' && cobMode === 'array')) return false;
    /* THE SAME HIT TEST THE CURSOR AND THE HIGHLIGHT RUN, which is what
       makes the press land on the line the pointer said it would — see
       `shapeAtPointer`. It was inline here, and a second copy of the
       tolerance is a hover that lights one thing and a press that takes
       another. */
    const hitSh = shapeAtPointer(p);
    const geomId = hitSh ? hitSh.id : `room:${room.id}`;
    const geo = arrayOutline(geomId);
    if (!geo) return true;
    setCobDraftArray((d) => nextArrayDraft(d, {
      geomId, geo, roomId: room.id,
      watts: cobTool.show.watts, beam: cobTool.show.beam }));
    setSel(select('shape', hitSh ? hitSh.id : null));
    return true;
  };

  /* --- A RECESSED COB, EXACTLY WHERE THE CLICK LANDED -------------------
     NO SNAP TO THE DRAWING, NO PROJECTION, NO CLAMP, and the absence of all
     three is the feature rather than an omission — see the header of lib/cob.js.
     The sconce seats itself on a wall and the strip snaps to a guide, because in
     both cases the geometry is what the fitting IS. A downlight is a hole in a
     ceiling, and somebody who has aimed at a point has said everything there is
     to say about where it goes.
     THE SPECIFICATION IS RESOLVED AT THE CLICK AND NOT OFF THE BAR. Same
     stack the bar reads — one-shot, then standing, then the engine — but
     asked of THIS point, because the pointer moves between the last render
     and the press, and a lamp specified for the cell next door would be the
     bar and the drawing disagreeing about what was just placed.
     THE TOOL STAYS ARMED, and the one-shot is spent. */
  const cobDown = (e, p, room) => {
    if (addTool !== 'cob') return false;
    /* THE RUN OWNS ONE CEILING. A press on any other one places nothing and
       says nothing — it does NOT disarm, and it does not move the run: the
       cursor has already said this click was dead (see `inside` in the move
       handler), and a stray press near a doorway must not silently start
       laying lamps in the next flat. */
    if (cobLock && room.id !== cobLock) return true;
    const sn = cobTool.snap(p);
    const at = { x: sn.x, y: sn.y };
    const override = cobOnce ?? cobStanding ?? null;
    const spec = override ?? recommendCob(room, at, basisFor(room));
    const lamp = placeCob({
      p: at, pxPerFt, roomId: room.id,
      watts: spec.watts, beam: spec.beam,
      spec: !!override, seq: manualCobs.length,
    });
    docActions.addCob(lamp);
    /* AND IT JOINS THE RUN, which is what the tick and the cross on the bar
       act on. See `cobRun`. */
    setCobRun((r) => [...r, lamp.id]);
    /* --- THE FIRST LAMP CHOOSES THE SPACE, AND OPENS IT ----------------
       The lock is what stops the rest of the run wandering into the next
       room — see `cobLock`. Opening the space is the other half of the same
       thought: a run of downlights is an argument about how bright one
       ceiling is, and the panel has to be showing THAT ceiling's Analysis
       for the argument to be watchable. Every lamp placed after this moves
       the two figures at the top of it while you watch, which is the only
       reason the section is worth having.
       THE SPACES TAB AND NOT THE DESIGN ONE, because that is where a space's
       own detail lives — its finishes, its height, and the Analysis with a
       row per placed lamp. The Design tab holds the palettes, which are
       about the drawing rather than about this room.
       ONLY ON THE FIRST. Re-focusing on every press would fight anybody who
       opened a different space mid-run to compare a figure. */
    if (!cobLock) {
      setCobLock(room.id);
      docActions.setFocusId(room.id);
      setOptionPick(null);
      docActions.setView('spaces');
    }
    if (cobOnce) setCobOnce(null);
    return true;
  };

  // A ceiling-object gesture that started on an object stopped this event
  // before it got here, so reaching this point means the EMPTY ceiling was
  // hit. Armed: drop one, and disarm — the way a shape tool returns to the
  // pointer after you draw one shape. Not armed: deselect.
  const objectDown = (e) => {
    if (!((owns(pressState, 'object') || objMode || selAccId) && source && pxPerFt)) {
      return false;
    }
    const p = svgPoint(e);
    // Outside every room: cancel, do not act. One branch, before anything
    // else, so there is no path by which a click out here places something.
    if (!insideAnyRoom(p)) {
      setArmed(null); setGhost(null); setGuides([]);
      setSel(clear());
      return true;
    }
    if (armed) {
      const snapped = applySnap(p, null);
      let o = makeCeilingObject(armed, { x: snapped.x / pxPerFt, y: snapped.y / pxPerFt });
      if (o.kind === 'fan') o = withSweep(o, fanSweepMm);
      docActions.addObject(o);
      setSel(select('object', o.id));
      setArmed(null);
      setGuides([]); setGhost(null); setGuides([]); setGhost(null);
    } else {
      setSel(clear());
    }
    return true;
  };

  // ARMED AND HOVERING. The guides have to appear BEFORE the click, not
  // after: their job is to tell you where the thing will land while you can
  // still move the pointer.
  const armedMove = (e) => {
    if (!(armed && source && pxPerFt)) return false;
    const p = svgPoint(e);
    const inside = insideAnyRoom(p);
    if (inside !== overRoom) setOverRoom(inside);
    if (!inside) {
      // No ghost and no guides off the ceiling: nothing is going to land
      // there, so nothing should be promised.
      if (ghost) setGhost(null);
      if (guides.length) setGuides([]);
      return true;
    }
    const snapped = applySnap(p, null);
    setGhost({ x: snapped.x, y: snapped.y, typeId: armed });
    return true;
  };

  /* --- IS A MODULE ABOUT TO LAND ON A RUN? --------------------------
     THE ONLY THING WORTH SAYING WHILE THIS TOOL IS ARMED. A module goes on
     a profile, so the pointer's whole job is to distinguish "over a run"
     from "over the ceiling", and it does it with the cues `geomHover`
     drives: the cursor becomes a hand and the run's own stroke comes up. No
     ghost is drawn because nothing lands at the pointer.
     AHEAD OF THE COB AND IT RETURNS, because a module reads none of what the
     COB branch maintains — there is no cell to recommend a wattage from
     and no wall band to warn about. */
  const moduleMove = (raw) => {
    if (addTool !== 'module') return false;
    const h = geomUnder(raw);
    const hid = h?.id ?? null;
    if (hid !== geomHover) setGeomHover(hid);
    setAddAt(raw);
    return true;
  };

  const cobMove = (raw, inside) => {
    if (addTool !== 'cob') return false;
    /* --- IS THE ARRAY ABOUT TO TAKE A GEOMETRY? -----------------------
       THE ARRAY TOOL DOES NOT PLACE A LAMP AT THE POINTER — it picks the
       line the run is set out on — so over a geometry the ghost lamp is a
       promise the press will not keep, and the crosshair is aimed at a point
       the press will not use. Both are exchanged for a pointer and a lit
       stroke on the line itself; see `geomHover`.
       NOT IN MANUAL MODE, where a press really does put a lamp at the point
       and a geometry under it is scenery. `geomUnder` answers `null` there
       by construction. */
    const h = geomUnder(raw);
    const hid = h?.id ?? null;
    if (hid !== geomHover) setGeomHover(hid);
    /* THE SNAPPED POINT, NOT THE RAW ONE — the same rule the strip tool's
       press states: the ghost under the cursor is a promise about where the
       click will land, and a click that lands anywhere else makes every
       future indicator a lie. `snap` is what the press runs too. */
    const sn = inside ? cobTool.snap(raw) : null;
    const at = sn ? { x: sn.x, y: sn.y } : raw;
    setGuides(sn?.guides ?? []);
    setCobAt(inside ? at : null);
    setAddAt(at);
    return true;
  };

  return {
    canvas: {
      onLightPointerDown: lightPointerDown,
      onObjPointerDown: objPointerDown,
      onCobPointerDown: cobPointerDown,
      onArrayPathDown: arrayGrab,
      onModulePointerDown: modulePointerDown,
    },
    /* THE FIVE GESTURES IN FLIGHT, and the move/up pair for each. They are
       members rather than one router because the ORDER between them is App's:
       the door editor, the accents, the plates and the wires all have branches
       in between, and only App knows the precedence. */
    drag: {
      light: lightDrag, object: objDrag, cob: cob.drag,
      array: arrayDrag, module: moduleDrag,
    },
    move: {
      light: lightPointerMove, object: objPointerMove, cob: cobPointerMove,
      array: arrayPointerMove, module: modulePointerMove,
    },
    up: {
      light: lightPointerUp, object: objPointerUp, cob: cobPointerUp,
      array: arrayPointerUp, module: modulePointerUp,
    },
    /* THE POINTER ROUTER'S FIXTURE BRANCHES, each returning `true` when it has
       taken the event. */
    tool: { moduleDown, arrayDown, cobDown, objectDown, moduleMove, cobMove, armedMove },
    commands: { openArray },
    draft: { array: cobDraftArray, setArray: setCobDraftArray },
  };
}
