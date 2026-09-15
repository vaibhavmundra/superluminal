// ---------------------------------------------------------------------------
// useFixtureGestures.js — THE FIVE DRAGS AND THE PRESSES THAT PLACE.
//
// A light slid inside its own cell, a ceiling object moved/resized/rotated, a
// hand-placed lamp, a whole array carried, and a module sliding along its run —
// plus the four branches of the canvas's pointer router that belong to this
// domain, and the one command (`openArray`) that is a gesture's.
//
// THE FEATURE'S FOURTH AND LAST CALL SITE, AND IT IS THE LOWEST BECAUSE OF WHAT
// IT NEEDS: `svgPoint`, `svgRef`, `pressState`, the geometry
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
import { select, selectMany, clear, groupFor } from '../../lib/selection.js';
/* WHICH MODIFIER GATHERS A SELECTION, IN ONE PLACE.
   ⌘ IS THE MAC ANSWER AND SHIFT WAS THE ONLY ONE HERE. Every Mac app adds to a
   discontiguous selection with Command; Shift is range-select. This canvas had
   Shift alone, so the key a Mac user actually reaches for did nothing — and on
   the object gesture it did worse than nothing, because ⌘-click fell through to
   the plain branch and REPLACED the selection somebody was building.
   BOTH ARE ACCEPTED rather than swapping one for the other: Shift is what this
   app has taught its users so far, and ctrl is the same gesture on a Windows
   keyboard. `altKey` is deliberately absent — it is the copy modifier on these
   drags (see `copy` on the COB's `useDrag`) and cannot also mean gather. */
const gathering = (e) => !!(e && (e.metaKey || e.shiftKey || e.ctrlKey));
import { canGrab, owns } from '../../lib/pressOwner.js';
import { snapPoint } from '../../lib/snapGuides.js';
import { clampLightMove } from '../../lib/planner.js';
import { newCobId, placeCob, recommendCob } from '../../lib/cob.js';
import { isTrack as shapeIsTrack } from '../../lib/ceilingShapes.js';
import { moduleWatts, placeModule, placeableU, newModuleId }
  from '../../lib/magTrack.js';
/* A MODULE IS A POINT HELD ON A PATH — see the header of lib/point.js and the
   note on `mod` below. The run comes from the geometry feature already shaped
   as a host; `pointsOn` is "which modules are on this run". */
import { pointsOn } from '../../lib/point.js';
import { WALL_POINT_ID, CEILING_POINT_ID, pointHostFor, nearestWallU,
         seatOnWalls, pointClampU, wallPoint, ceilingPoint, newPointIdIn }
  from '../../lib/elecPoints.js';
import { seatForClick } from '../electrical/boardRules.js';
import { asPathHost } from '../../lib/path.js';
import { usePointDrag } from '../../hooks/usePoint.js';
import {
  makeCeilingObject, makeWallUnit, typeOnWall, resizeFromCorner, rotateTo,
  halfExtents, isUniform, applyResize, withSweep, newCeilingObjectId,
  CEILING_BY_ID, boxAdapters, boxOrtho, boxMoves,
} from '../../lib/ceilingObjects.js';
/* A SPLIT UNIT IS HELD BY ITS WALL — where it is, which way it faces, and where
   its supply sits are all facts about the plaster. See lib/wallUnit.js. */
import { isWallUnit, isSeated, seatWallUnit, nearestWallUnitSFt,
         resolveWallUnitPx, AC_FEED } from '../../lib/wallUnit.js';
import { clampContext, lightKey, moduleU, nextArrayDraft,
         rollbackCobs, arrayLanded, cobObstacleBlocked } from './fixtureRules.js';

export default function useFixtureGestures({
  state, fixtures, cobTool,
  rooms, pxPerFt, zoom, opt, source, addTool, selAccId, overRoom,
  manualCobs, cobArrays, trackFixtures, ceilingObjs, elecPoints = [],
  svgPoint, svgRef, pressState,
  roomAt, insideAnyRoom, snapTargets, snapTol,
  arrayOutline, shapeAtPointer, geomUnder, geomHover, setGeomHover,
  clearShapeEdit, standDown,
  /* --- THE ELECTRICAL DRAWING'S ONE REACH INTO THIS FILE --------------------
     A STANDING LAMP IS PLUGGED IN AND NOTHING ELSE PLACED HERE IS, so it is the
     one fitting whose arrival can oblige a socket to appear. The rule that
     decides whether one is needed and which piece of wall it goes on belongs to
     the electrical domain and stays there — see `socketForLamp` in
     features/electrical/useBoardGestures.js. What crosses the boundary is a
     command, handed in, so this file states WHEN it is spent and knows nothing
     about plates, reach or walls.
     OPTIONAL, because the read-only panel and every caller that wires no
     electrical feature must still be able to place a lamp. Without it the lamp
     lands and no socket is seated, which is the same drawing somebody gets by
     placing one before this build. */
  socketForLamp = null,
  /* --- ...AND THE SECOND, WHICH IS THE AIR-CONDITIONER'S -------------------
     SAME SHAPE AND SAME ARGUMENT AS THE LAMP'S ABOVE. A split unit cannot work
     without a circuit, so placing one places its supply and sliding one brings
     that supply with it — but WHICH supply, where it sits and what it is rated
     at are the electrical domain's, and they stay there. See
     features/fixtures/useAcFeed.js; what crosses is two commands.
     OPTIONAL, for the lamp socket's reason: the unit still lands without them,
     with no supply beside it, which is a drawing somebody can finish by hand. */
  acFeed = null,
  /* EVERY ROOM'S WALLS — `roomId` -> host. What a wall unit is seated on, both
     when it is dropped and every frame it is dragged. @see buildWallHosts */
  wallHosts = null,
  docActions, setSel, guides, setGuides, setOverRoom, setAddAt, setOptionPick,
}) {
  const {
    lightDrag, setLightDrag,
    objDrag, setObjDrag, objMode, setObjMode, selObjIds, toggleSelObj, toggleSel,
    selCobIds, selArrayIds, selPointIds,
    armed, setArmed, ghost, setGhost, fanSweepMm,
    cobStanding, cobLock, setCobLock,
    setCobAt, cobDraftArray, setCobDraftArray,
    arrayDrag, setArrayDrag, trackMode, moduleSpec,
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
   * that panel (see `fixtureGroups`) and the row is where its wattage can
   * also be changed, so the two have to be looking at the same room.
   */
  const openArray = useCallback((id) => {
    /* STAND DOWN FIRST, SELECT SECOND — and the order is the whole of it.
       `standDown` clears the selection along with everything else, which is what
       the SHAPE BAR needs: selecting a shape is what puts that bar into its
       `edit` state (see `shapeMode`), so closing the tool is not enough on its
       own and the selection has to go too, or the bar comes straight back up
       over the array's. Selecting first meant the clear landed on the array we
       had just picked.
       IT ALSO PUTS THE TRACK MODULE AND THE CEILING-OBJECT ONE-SHOT AWAY. Those
       were three more lines here; they are in the list now, where every other
       opener on this screen reads them from. */
    standDown();
    // ONE SELECTION ON THIS CANVAS. Two things picked would be two things Delete
    // could mean, and taking the register is how this one stops being a list of
    // ten clears that had to be kept in step with the ten selections.
    setSel(select('array', id));
    const roomId = cobArrays.find((a) => a.id === id)?.roomId ?? null;
    if (roomId) { docActions.setFocusId(roomId); docActions.setView('spaces'); }
  }, [docActions, standDown, cobArrays, setSel]);

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

  /* --- A WALL UNIT'S WALL, AND THE THREE THINGS THE DRAG ASKS OF IT ---------
     ONE HOST PER ROOM, LOOKED UP RATHER THAN BUILT. `buildWallHosts` in the
     scene already walked every outline for this; asking it per frame per unit
     would re-walk them. */
  const wallHostOf = (o) => (o?.roomId ? (wallHosts?.get?.(o.roomId) ?? null) : null);
  /** Is this record one the plaster is holding? Both halves have to be true. */
  const onWall = (o) => isWallUnit(o) && isSeated(o);
  const seatedById = (id) => onWall(ceilingObjs.find((q) => q.id === id));
  /** A unit's body width in plan pixels — what the seat has to fit on a run. */
  const bodyPxOf = (o) => (o?.wFt || 0) * pxPerFt;

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
    /* --- THE PRIMITIVE'S OWN THREE ANSWERS, AND THEY WERE WRITTEN OUT HERE ---
       A CEILING OBJECT IS A BOX: a centre, two extents and an angle, with the
       centre as its position — which is exactly what box.js calls "a point with
       a size rather than a shape". So `at`/`to`, whether the shift lock applies,
       and which frames of this gesture are a translation are three facts about a
       BOX, and all three were spelled out inline: `{ x: o.x, y: o.y }`,
       `ortho: true`, `(d) => d.mode === 'move'`. Character for character the
       primitive's own, which is the worst kind of duplication — it agrees today
       and nothing makes it agree tomorrow.
       SO THEY COME FROM THE PRIMITIVE NOW, through ceilingObjects.js like the
       rest of this object's verbs. Nothing about the gesture changes; what
       changes is that adding a fourth mode to `BOX_MODES` is one edit rather
       than one edit and a search.
       WHAT IS STILL THIS FILE'S IS EVERYTHING BELOW: the snapper, the copy, and
       the resize and rotate branches in `onMove`. Those are kind-AWARE — a round
       object has no ratio to unlock and reads its limits off the catalogue — and
       they stay where the catalogue is. See the note at the foot of
       lib/ceilingObjects.js on which half of the box moved and which did not. */
    ...boxAdapters(),
    /* --- ...EXCEPT THAT A WALL UNIT IS NOT A FREE BOX ----------------------
       IT IS A CONSTRAINED POINT THAT HAPPENS TO CARRY AN EXTENT, which is what
       the header of lib/box.js says a plate sliding along a wall is. So the two
       adapters are overridden rather than the gesture being forked: `at` hands
       back where the wall actually put the body and `to` writes a DISTANCE
       ROUND THE WALLS instead of a coordinate. Everything else about the drag —
       the group, the slop, the copy, the snap-back — is untouched and has to
       be, because a row of three units dragged together is the same gesture as
       a row of three cassettes.
       THE PERPENDICULAR COMPONENT IS SIMPLY DISCARDED, and that IS the
       constraint: `nearestWallUnitSFt` projects whatever the pointer asked for
       onto the nearest piece of plaster that can hold the body, so dragging
       away from the wall slides the unit along it rather than lifting it off.
       FEET IN AND FEET OUT. This drag's point space is the record's own unit —
       see `boxAdapters` — and the wall projections work in plan pixels, so the
       scale is applied at this boundary and nowhere inside. */
    at: (o) => {
      if (!onWall(o)) return { x: o?.x ?? 0, y: o?.y ?? 0 };
      const r = resolveWallUnitPx(o, wallHostOf(o), pxPerFt);
      return r ? { x: r.x / pxPerFt, y: r.y / pxPerFt } : { x: 0, y: 0 };
    },
    to: (o, p) => {
      if (!onWall(o)) return { ...o, x: p.x, y: p.y };
      const sFt = nearestWallUnitSFt(
        { x: p.x * pxPerFt, y: p.y * pxPerFt }, wallHostOf(o), bodyPxOf(o));
      /* A DRAG WITH NOWHERE TO LAND LEAVES IT WHERE IT WAS, which is the point
         primitive's own refusal — see the third gate in hooks/usePoint.js. */
      return sFt == null ? o : { ...o, sFt };
    },
    setList: docActions.updateObjects,
    slopPx: 0,
    moves: boxMoves,
    /* A THING ALREADY HELD TO A WALL TAKES NO SHIFT LOCK. A second constraint
       would hold it to a row through the press as well, and the two together
       resolve to wherever those happen to cross — which is the argument
       `orthoFor` makes about a constrained point, said about a box. Asked per
       FRAME because that is the shape `useDrag` takes, so the answer is looked
       up off the drag's own primary. */
    ortho: (d) => boxOrtho() && !seatedById(d?.id),
    /* ...AND NO SNAP EITHER, AND FOR THE SAME REASON. A guide claiming an
       alignment the wall projection is then going to overrule is a guide that
       lies twice a second. */
    snap: (q, axis, { ids, drag: d }) =>
      (seatedById(d?.id) ? q : objSnapAt(q, axis, ids)),
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
    /* AND WHEN IT IS LET GO, ITS SUPPLY CATCHES UP. "Behind the unit" and "a
       foot clear of the casing" were stated as RULES rather than as starting
       positions, so a unit nudged six inches has to take its socket with it.
       ON COMMIT AND NOT PER FRAME, deliberately: this is a document write per
       call, and doing it on every move of the drag would be a socket re-seated
       sixty times a second and an undo history made of nothing else. See
       `slider writes once per gesture`, which is the same rule about a control.
       THE WHOLE GROUP, because a multi-selection drag moves all of them. */
    onCommit: (ids) => acFeed?.syncAll?.(ids ?? []),
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
    if (mode === 'move' && gathering(e)) {
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
    /* `groupFor` IS THE SAME RULE THE OTHER TWO PRESSES USE, and it was this
       expression written out — see lib/selection.js. A handle press is always
       singular (the grips are only drawn for one), so `mode` still decides
       whether the group is even asked for. */
    const group = mode === 'move' ? groupFor(selObjIds, id) : [id];
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

    /* ⌘-CLICK GATHERS AND STARTS NO DRAG, exactly as it does on a ceiling
       object — see the note at that branch for why one modifier can mean two
       things without either being ambiguous. Gather on the PRESS; the axis lock
       and the copy are modifiers held DURING a drag, and a press cannot yet
       know it is going to become one. */
    if (gathering(e)) { setArmed(null); toggleSel('cob', id); return; }

    /* PRESSING A MEMBER DRAGS ALL OF IT — `groupFor`, the same rule the object
       press uses. What made this possible without touching the gesture is that
       the drag already took a LIST: `members` was `[c]` with a note saying it
       was kept in the group shape so that adding one would be a change to the
       selection and nothing else. This is that change. */
    const group = groupFor(selCobIds, id);
    const members = group
      .map((q) => manualCobs.find((m) => m.id === q))
      .filter(Boolean);
    setSel(selectMany('cob', members.map((m) => m.id)));
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
    cob.down(e, { id, members });
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
    /* AND STOPPING THE PRESS IS ALSO WHAT KEEPS THE CLICK THE BROWSER
       SYNTHESISES ON RELEASE from being read as a press on bare plan — which
       would clear the selection and swap the array's bar for the space's
       geometry tools, forty milliseconds after opening it. See `barePress` in
       App.jsx: the canvas answers that question for itself, and a press stopped
       here never reaches the handler that would say yes. */
    e.stopPropagation();
    e.preventDefault();

    /* ⌘-CLICK GATHERS, AND DOES NOT OPEN THE BAR. Opening an array is the act
       of showing ONE array's specification — see `openArray` — and doing that
       while somebody is gathering three of them would put a bar about one of
       them over a selection of all three. */
    if (gathering(e)) { toggleSel('array', arrayId); return; }

    /* THE GROUP IS READ BEFORE `openArray` AND RESTORED AFTER IT, because that
       function ends in `setSel(select('array', id))` — deliberately singular,
       since opening an array is the act of showing ONE array's bar. Called in
       the middle of a group press it would collapse the very selection this
       press is about to drag, and the drag would carry twelve lamps while the
       drawing showed one picked. Its other two jobs — standing every other
       machine down, and focusing the space — are exactly what is wanted here,
       so it is called and then corrected rather than bypassed. */
    const group = groupFor(selArrayIds, arrayId);
    const members = group
      .map((q) => cobArrays.find((m) => m.id === q))
      .filter(Boolean);
    openArray(arrayId);
    if (members.length > 1) setSel(selectMany('array', members.map((m) => m.id)));
    array.down(e, { id: arrayId, members: members.length ? members : [a] });
  };

  const arrayPointerMove = (e) => { if (pxPerFt) array.move(e); };
  const arrayPointerUp = array.up;

  /* --- A MODULE, PICKED UP AND SLID ALONG ITS RUN ---------------------------

     ONE AXIS, AND IT IS NOT A CONSTRAINT THIS APP INVENTED — see `moduleU`,
     which carries the rule and the no-overlap clearance.

     THE SAME SLOP EVERY OTHER DRAG ON THIS CANVAS USES, so a press that only
     meant to select does not nudge a fitting three pixels — rule 1 in
     lib/dragMove.js.

     IT IS THE POINT PRIMITIVE'S GESTURE AND NOT A HAND-WRITTEN ONE. What a
     module has is not a position but a FRACTION of a path, and that IS
     lib/point.js's constrained point: the run is the host, `u` is the record,
     and `hostFor` plus `clamp` are the whole of what this drag has to say.
     Everything that used to be written out here — resolving the pointer,
     projecting it onto the run, refusing to write a `u` the body does not fit
     at — is `pointAdapters` and the three gates in hooks/usePoint.js.

     WHAT THE PRIMITIVE BRINGS THAT THIS DID NOT HAVE:
       the shift lock REFUSED rather than absent, because a point already held
       to a run must not also be held to a row through the press — see
       `orthoFor`;
       the snap refused for the same reason, so no guide claims an alignment
       the projection then leaves;
       a press on a module whose run has gone declined outright, instead of
       anchoring the gesture on a fallback origin;
       and ALT-COPY, which a module never had: a second diffuser along the run
       without a trip back to the rail. */
  const mod = usePointDrag({
    state: [moduleDrag, setModuleDrag],
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    zoom,
    /* THE RUN, AS THE THREE FIELDS A HOST IS. `magTrackById` is the geometry
       feature's projection and already carries `id`, `pts` and `closed`. */
    hostFor: (f) => asPathHost(magTrackById[f?.on]) ?? null,
    /* THE PRODUCT'S VETO, AND IT IS THE ONLY DOMAIN RULE LEFT IN THIS DRAG.
       Two bodies cannot share a foot of extrusion, so the wanted fraction is
       moved to the nearest one this body actually fits at — and `null` when
       the rest of the run is full, which leaves the module where it was rather
       than sliding it somewhere free. See `placeableU`.
       EXCLUDED RATHER THAN INCLUDED, because a module always clashes with
       itself. AND EACH BODY IS MEASURED AT ITS OWN WATTAGE: a 5 W diffuser is
       a 200 mm stub and an 18 W one a 400 mm bar. */
    clamp: (u, f, host) => placeableU(host.pts, u,
      pointsOn(trackFixtures, f.on).filter((q) => q.id !== f.id),
      f.kind, { closed: host.closed, watts: f.watts }),
    /* ONE PATCH PER FRAME, AND THE FRACTION IS THE ONLY THING WRITTEN. The
       hook hands back the whole updated list; what the document takes is the
       one field that changed, through the action it already had. A twin from an
       alt-copy is not in the store yet, so it is ADDED rather than patched. */
    setList: (fn) => {
      const next = fn(trackFixtures);
      const known = new Map(trackFixtures.map((q) => [q.id, q]));
      const fresh = next.filter((q) => !known.has(q.id));
      if (fresh.length) docActions.addTrackFixtures(fresh);
      for (const q of next) {
        const was = known.get(q.id);
        if (was && was.u !== q.u) docActions.patchTrackFixture(q.id, { u: q.u });
      }
    },
    copy: true,
    mintId: (n) => newModuleId(`c${trackFixtures.length + n}`),
    /* AND THE TWIN IS SELECTED, so the bar is showing the module the gesture is
       now carrying rather than the one it was picked up from — the same thing
       the cove shape's copy does. */
    onCopy: ({ ids }) => setSel(select('module', ids[0])),
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
    /* THE MEMBER IS NAMED NOW, AND IT HAS TO BE. The point gesture reads the
       record to know its kind and its host — a bare id tells it neither — and
       it DECLINES a press it cannot anchor, which is the third gate in
       hooks/usePoint.js. So the event is only swallowed if the press was
       actually taken; a module whose run has gone falls through instead of
       starting a drag that would throw it at the origin. */
    if (!mod.down(e, { id, members: [f] })) return;
    e.stopPropagation();
    e.preventDefault();
    setSel(select('module', id));
  };

  const modulePointerMove = (e) => { if (pxPerFt) mod.move(e); };
  const modulePointerUp = mod.up;

  /* --- A POINT, ON THE PRIMITIVE, BOTH KINDS THROUGH ONE GESTURE -----------
     THIS IS THE WHOLE OF WHAT EITHER ELEMENT HAS TO SAY ABOUT BEING DRAGGED,
     and that is the claim lib/point.js makes for itself. A wall point is a
     CONSTRAINED point — `on: 'walls'`, `u` a fraction of the room's perimeter,
     the same host a switchboard plate stands on — and a ceiling point is a FREE
     one. Nothing below tests which; the primitive reads the kind off the record
     and the two gates fall out:

       A WALL POINT TAKES NO SHIFT LOCK AND NO SNAP, because it is already held
       to a wall and a second constraint would move it along the plaster to
       wherever two lines happen to be nearest — see `orthoFor`.
       A CEILING POINT HONOURS BOTH, which is what "shift to constrain" means
       everywhere else on this canvas.

     ...and move, OPTION-COPY, delete, the slop, the group move, the snap-back
     and the refusal come with them. None of that is written here.

     ONE HOST PER ROOM, BUILT ONCE PER RENDER. `wallRuns` walks the outline, so
     asking per frame per point would re-walk it; a Map keyed on the room is the
     same shape `magTrackById` gives the module drag. */
  const pointHosts = new Map();
  const hostOfRoom = (roomId) => {
    if (!pointHosts.has(roomId)) {
      const poly = rooms.find((r) => r.id === roomId)?.plan?.polygonPx ?? [];
      pointHosts.set(roomId, pointHostFor(poly, pxPerFt));
    }
    return pointHosts.get(roomId) ?? null;
  };
  const pointHostFrom = (q) => hostOfRoom(q?.roomId);

  const pt = usePointDrag({
    point: svgPoint,
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    zoom,
    /* THE ROOM'S WALLS, WHICH IS ONLY EVER ASKED ABOUT A CONSTRAINED POINT —
       `pointAdapters` does not resolve a free one against a host. */
    hostFor: pointHostFrom,
    /* THE DOMAIN'S VETO, AND IT IS THE SAME PROJECTION THE PLACEMENT USES.
       `nearestWallU` is both, deliberately: a point may be dropped anywhere
       there is plaster and dragged anywhere there is plaster, and two copies of
       one projection is how those two answers stop agreeing. */
    clamp: pointClampU(pointHostFrom),
    /* FREE POINTS ONLY — the hook refuses to call this for a constrained one,
       which is gate 2. The ceiling point snaps to the same things every other
       free fitting on this canvas snaps to. */
    snap: (q, axis, { ids }) => objSnapAt(q, axis, ids),
    /* ONE WRITE PER FRAME, AND ONLY THE FIELDS THAT MOVED. The hook hands back
       the whole updated list; a twin from an Option-copy is not in the store
       yet, so it is ADDED, and everything else is PATCHED with whichever of the
       two coordinates its kind actually keeps. */
    setList: (fn) => {
      const next = fn(elecPoints);
      const known = new Map(elecPoints.map((q) => [q.id, q]));
      const fresh = next.filter((q) => !known.has(q.id));
      if (fresh.length) docActions.addElecPoints(fresh);
      for (const q of next) {
        const was = known.get(q.id);
        if (!was) continue;
        if (was.u !== q.u || was.x !== q.x || was.y !== q.y) {
          docActions.patchElecPoint(q.id, { u: q.u, x: q.x, y: q.y });
        }
      }
    },
    copy: true,
    mintId: (n) => newPointIdIn(elecPoints.length + n),
    /* AND THE TWIN IS WHAT KEEPS MOVING, the convention everywhere this gesture
       exists: drag, Option, release — and the one you just positioned is the one
       still selected, ready to be dragged again. */
    onCopy: ({ ids }) => setSel(selectMany('point', ids)),
  });

  const pointPointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    if (!canGrab(pressState) || !pxPerFt) return;
    const q = elecPoints.find((x) => x.id === id);
    if (!q) return;
    /* THE MEMBER IS NAMED, AND THE WHOLE SELECTION COMES WITH IT. The primitive
       reads the record to know its kind and its host — a bare id tells it
       neither — and it DECLINES a press it cannot anchor, which is gate 3. So
       the event is only swallowed if the press was actually taken; a wall point
       whose room has gone falls through rather than starting a drag that would
       throw it at the origin. */
    const ids = selPointIds.includes(id) ? selPointIds : [id];
    const members = elecPoints.filter((x) => ids.includes(x.id));
    if (!pt.down(e, { id, members })) return;
    e.stopPropagation();
    e.preventDefault();
    if (!selPointIds.includes(id)) setSel(select('point', id));
  };

  const pointPointerMove = (e) => { if (pxPerFt) pt.move(e); };
  const pointPointerUp = pt.up;

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
    const taken = pointsOn(trackFixtures, run.id);
    /* WHAT IS ON THE BAR IS WHAT LANDS. `moduleSpec` is the specification the
       bar at the foot of the drawing is showing — see ModuleSpec — and the
       fallback is the module's own default, which is what that bar opens at, so
       the two agree by construction rather than by coincidence. A press that
       placed the default while the bar read 18 W would make every figure on it
       a lie. */
    const watts = moduleSpec?.watts ?? moduleWatts(trackMode);
    /* CLEARED AT THE BODY THIS MODULE WILL ACTUALLY BE, and every module
       already on the run at its own — a 5 W diffuser is a 200 mm stub and an
       18 W one a 400 mm bar, so one clearance figure for the lot would refuse
       the small one a gap it fits and let the big one overlap. See
       `DIFFUSER_LENGTHS_MM`. THE CHOSEN WATTAGE AND NOT THE DEFAULT, for that
       same reason: the gap this module needs is the gap the body it is about to
       have needs. */
    const u = moduleU({ run, p, taken, kind: trackMode, watts });
    if (u == null) return true;   // the run is full — see `placeableU`
    docActions.addTrackFixtures([
      placeModule({ on: run.id, kind: trackMode, u, watts,
                    beam: moduleSpec?.beam ?? null,
                    seq: trackFixtures.length })]);
    /* AND THE PANEL GOES TO THE SPACE IT LANDED IN, on the first module of
       a run, for the reason the first COB of a run opens its space: a
       diffuser is an ambient source and the two figures at the top of the
       Analysis move as you clip them on, which is the only reason watching
       them is worth anything. */
    if (run.roomId && !pointsOn(trackFixtures, run.id).length) {
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

     AND THE ROOM'S OWN OUTLINE IS NO LONGER ONE, WHICH REVERSES A DECISION.
     The note here used to argue that a space's outline "is the geometry every
     plan has, and it needs no drawing first", so a press on bare ceiling took
     it. That is wrong, and it was wrong in the ordinary case rather than at the
     edges: a room's outline is traced on the PLASTER, every one of its vertices
     is a corner, and `arraySpots` is obliged to put a lamp on each — so the
     gesture answered "ring this room with spots" with four lamps jammed into
     the four corners of it. Nobody asks for that, and worse, nobody ASKED at
     all: the outline was taken by a press somebody made to choose a point.

     SO A PRESS ON BARE CEILING TAKES NOTHING NOW. The array is set out on a
     geometry you DRAW — the bar that arrives with this gesture is the geometry
     bar, in the guide role, exactly as the magnetic track's cell works (see the
     track drawer in App, and `openShapeTool`). Draw one, tick it, and the
     committed guide is handed straight to this draft; the count and the wattage
     are then asked about a path that exists.

     A SHAPE UNDER THE POINTER IS STILL TAKEN, and that is why the bar opens
     UNARMED. `takeableGeometry` offers any role to this gesture — a run of
     spots references a line and builds nothing from it — so a cove or a guide
     already on the drawing is a legitimate answer to "on what", and requiring a
     primitive first would mean arming a rectangle you are not going to draw in
     order to use an outline that is already there. Same argument the track's
     bar makes, in the same words.

     `arrayOutlineFor` STILL READS `room:` AND THAT IS DELIBERATE. Arrays saved
     before this change carry one, and a reader that dropped the prefix would
     make those runs vanish off the drawing. What stopped is MINTING them. */
  const arrayDown = (e, p, room, cobMode) => {
    if (!(addTool === 'cob' && cobMode === 'array')) return false;
    /* THE SAME HIT TEST THE CURSOR AND THE HIGHLIGHT RUN, which is what
       makes the press land on the line the pointer said it would — see
       `shapeAtPointer`. It was inline here, and a second copy of the
       tolerance is a hover that lights one thing and a press that takes
       another. */
    const hitSh = shapeAtPointer(p);
    /* NOTHING UNDER THE POINTER IS NOT AN ERROR AND NOT A FALLBACK EITHER — it
       is a press that has not chosen anything yet, and the bar over the drawing
       is already saying what to do about it. The press is still SWALLOWED: this
       gesture owns the canvas while it is armed, and letting it through would
       clear the selection or drop a lamp, neither of which anybody asked for. */
    if (!hitSh) return true;
    const geo = arrayOutline(hitSh.id);
    if (!geo) return true;
    setCobDraftArray((d) => nextArrayDraft(d, {
      geomId: hitSh.id, geo, roomId: room.id,
      watts: cobTool.show.watts, beam: cobTool.show.beam }));
    setSel(select('shape', hitSh.id));
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
    /* A fan/cassette clearance is a physical no-light area, not a preference.
       Test the click's final snapped point (rather than trusting the previous
       hover frame) and consume the press without writing a lamp. */
    if (cobObstacleBlocked({
      room, at, pxPerFt, clearanceFt: opt.fanClearance,
    })) return true;
    /* `cobOnce ?? cobStanding` WAS THE OVERRIDE and the one-shot half is gone
       with the button that set it — see useFixtureState. What is left is the
       standing choice, which is null until somebody moves a control on the bar
       and is cleared by the Recommended chip. */
    const override = cobStanding ?? null;
    const spec = override ?? recommendCob(room, at, basisFor(room));
    const lamp = placeCob({
      p: at, pxPerFt, roomId: room.id,
      watts: spec.watts, beam: spec.beam,
      spec: !!override, seq: manualCobs.length,
    });
    docActions.addCob(lamp);
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
       AND THE LAMP NO LONGER JOINS A `cobRun`. That list was read by the tick
       and the cross at the end of the bar and by nothing else; both are gone,
       and a lamp is in the schedule the moment this line writes it.
       ONLY ON THE FIRST. Re-focusing on every press would fight anybody who
       opened a different space mid-run to compare a figure. */
    if (!cobLock) {
      setCobLock(room.id);
      docActions.setFocusId(room.id);
      setOptionPick(null);
      docActions.setView('spaces');
    }
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
    /* --- A WALL POINT SEATS ON THE PLASTER, AND SO IT IS TAKEN FIRST --------
       AHEAD OF THE INSIDE-A-ROOM TEST, AND THAT IS THE POINT OF ITS POSITION. A
       wall point cannot be placed in the middle of a ceiling — it is a mark ON a
       wall — so the pointer is AIMED at the plaster, and a press that lands a
       hair outside the outline is the ordinary way to make one rather than a
       miss. The guard below would cancel it.
       `seatForClick` IS THE SOCKET TOOL'S OWN ANSWER and is asked here for
       exactly that reason: "snap to the plaster like the socket does" is one
       arbitration — which of several rooms did that click mean, and is it near
       enough to any wall to have meant one at all (four feet, else it is a miss
       and not a guess). What it hands back is a plate's seat, which is clamped
       off the corners; only its ROOM is taken, and the fraction is this
       element's own — see `nearestWallU`, which is both this point's placement
       and its drag clamp, so the two cannot disagree. */
    if (armed === WALL_POINT_ID) {
      const hit = wallPointSeatAt(p);
      if (hit) {
        /* AND IT IS SELECTED, which is what the hand-placed sconce does and for
           the reason it does it: the thing you just put down is the thing you
           are about to say something about. Here that is its HEIGHT, and the bar
           showing it is the bar for the point that just landed. */
        const made = wallPoint(hit.roomId, hit.u, { id: newPointIdIn(elecPoints.length) });
        docActions.addElecPoint(made);
        setSel(select('point', made.id));
      }
      // A MISS DISARMS, like every other one-shot: the tool is not left armed
      // over a drawing where the last press appeared to do nothing.
      setArmed(null); setGuides([]); setGhost(null);
      return true;
    }
    /* --- A WALL UNIT SEATS ON THE PLASTER, AND SO IT IS TAKEN HERE ---------
       AHEAD OF THE INSIDE-A-ROOM TEST, for the wall point's reason exactly: the
       pointer is AIMED at a wall, so a press that lands a hair outside the
       outline is the ordinary way to place one rather than a miss, and the
       guard below would cancel it.
       ONE PRESS AND NO SECOND GESTURE, WHICH IS THE WHOLE FEATURE. The unit
       lands on the nearest piece of plaster that can hold it and takes that
       wall's angle; there is nothing to rotate afterwards because there is no
       stored angle to rotate — see `makeWallUnit`.
       ...AND ITS SUPPLY LANDS WITH IT, in the same tick, which is what makes
       the pair one undo step. A socket by default, at the country's AC rating;
       both are changed from the bar at the foot of the drawing. */
    if (typeOnWall(armed)) {
      const hit = wallUnitSeatAt(p, armed);
      if (hit) {
        const made = makeWallUnit(armed, {
          roomId: hit.roomId, sFt: hit.sFt, feed: AC_FEED });
        docActions.addObject(made);
        acFeed?.place?.(made);
        /* AND IT IS SELECTED, which is the sconce's and the point's behaviour
           and is what puts the unit's own bar in front of somebody the moment
           the unit exists: the supply it just got is the thing they are most
           likely to want to say something about. */
        setSel(select('object', made.id));
      }
      // A MISS DISARMS, like every other one-shot.
      setArmed(null); setGuides([]); setGhost(null);
      return true;
    }
    // Outside every room: cancel, do not act. One branch, before anything
    // else, so there is no path by which a click out here places something.
    if (!insideAnyRoom(p)) {
      setArmed(null); setGhost(null); setGuides([]);
      setSel(clear());
      return true;
    }
    /* --- A CEILING POINT IS NOT A CEILING OBJECT ---------------------------
       IT RIDES THIS GESTURE AND NOT THIS CATALOGUE. Everything about the ACT is
       identical — one press on empty ceiling, inside a room, snapped, then
       disarm — so it arms through `armed` and comes through here like a fan.
       What differs is what gets written: a fan is a rectangle the grid has to
       keep off, and a point is lib/point.js's FREE point with a rating on it.
       `makeCeilingObject` would answer `undefined` and `addObject` would put a
       typeless object in the list every downstream reader iterates.
       THE WALL POINT IS NOT HERE, because it never reaches this line: a wall is
       not "empty ceiling", so it is taken at the top of this handler before the
       inside-a-room test that would refuse a click aimed at the plaster.
       THE STAMP IS THE MOMENT OF THE GESTURE. The id is minted in the reducer
       off it and the list's own length — see LIST_ADDED_MINTED — so two points
       dropped in the same second cannot collide. */
    if (armed === CEILING_POINT_ID) {
      const snapped = applySnap(p, null);
      const made = ceilingPoint(roomAt(snapped)?.id ?? null,
        snapped.x / pxPerFt, snapped.y / pxPerFt,
        { id: newPointIdIn(elecPoints.length) });
      docActions.addElecPoint(made);
      setSel(select('point', made.id));
      setArmed(null); setGuides([]); setGhost(null);
      return true;
    }
    if (armed) {
      const snapped = applySnap(p, null);
      let o = makeCeilingObject(armed, { x: snapped.x / pxPerFt, y: snapped.y / pxPerFt });
      if (o.kind === 'fan') o = withSweep(o, fanSweepMm);
      docActions.addObject(o);
      /* --- AND A STANDING LAMP BRINGS A SOCKET WITH IT ---------------------
         THE ONE PLACEMENT ON THIS CANVAS THAT WRITES TWICE, because a standard
         lamp is the one fitting here that is not wired into a ceiling: it has a
         lead, and a lamp out of reach of every plate is a lamp with nowhere to
         plug in. The command decides whether anything is needed — a plate
         already within reach means nothing is — so this line is unconditional
         and the answer is the rule's. See LAMP_SOCKET_FT in lib/electrical.js.
         AT THE SNAPPED POINT AND NOT THE RAW ONE, because that is where the
         lamp actually lands, and the reach is measured from the lamp.
         IN THE SAME TICK AS `addObject`, which is what makes the two one undo
         step rather than two — see QUIET_MS in lib/undo.js. */
      if (o.kind === 'standing_lamp') socketForLamp?.(snapped);
      setSel(select('object', o.id));
      setArmed(null);
      setGuides([]); setGhost(null); setGuides([]); setGhost(null);
    } else {
      setSel(clear());
    }
    return true;
  };

  /**
   * WHERE A WALL UNIT WOULD LAND, FROM A POINTER — the press and the preview
   * both ask this and nothing else asks it twice, which is `sconceGhostAt`'s
   * discipline and `wallPointSeatAt`'s below: a preview that APPROXIMATES the
   * placement is a preview that can disagree with it, and on a thing a metre
   * wide the disagreement is visible from across the room.
   *
   * `seatForClick` PICKS THE ROOM and applies the four-foot miss test — which
   * of several rooms did that click mean, and was it near enough to any wall to
   * have meant one at all. What it hands back is a PLATE's seat, clamped half a
   * plate off each corner; only its ROOM is taken, and the distance is this
   * element's own, because a metre of air-conditioner and 230mm of switch plate
   * do not fit the same pieces of wall. @see nearestWallUnitSFt
   */
  const wallUnitSeatAt = (p, typeId) => {
    const best = seatForClick(p, { rooms, pxPerFt });
    if (!best) return null;
    const host = wallHosts?.get?.(best.roomId) ?? null;
    if (!host) return null;
    const t = CEILING_BY_ID[typeId];
    const bodyPx = (t?.wFt || 0) * pxPerFt;
    const sFt = nearestWallUnitSFt(p, host, bodyPx);
    if (sFt == null) return null;
    const seat = seatWallUnit(sFt, host, bodyPx);
    return seat ? { roomId: best.roomId, sFt, seat, host, bodyPx, type: t } : null;
  };

  /* WHERE A WALL POINT WOULD LAND, FROM A POINTER — the press and the preview
     both ask this and nothing else asks it twice. That is the discipline
     `sconceGhostAt` keeps in App.jsx and the reason it is worth a function: a
     preview that is an APPROXIMATION of the placement is a preview that can
     disagree with it, and on this element it disagreed by the whole width of the
     room — the circle followed the cursor across the ceiling and the placed
     point appeared on plaster somewhere else.
     `seatForClick` PICKS THE ROOM and applies the four-foot miss test; the
     fraction and the frame are this element's own. */
  const wallPointSeatAt = (p) => {
    const best = seatForClick(p, { rooms, pxPerFt });
    if (!best) return null;
    const host = pointHostFor(
      rooms.find((r) => r.id === best.roomId)?.plan?.polygonPx ?? [], pxPerFt);
    const u = host ? nearestWallU(p, host) : null;
    if (u == null) return null;
    const seat = seatOnWalls(u, host);
    return seat ? { roomId: best.roomId, u, seat } : null;
  };

  // ARMED AND HOVERING. The guides have to appear BEFORE the click, not
  // after: their job is to tell you where the thing will land while you can
  // still move the pointer.
  const armedMove = (e) => {
    if (!(armed && source && pxPerFt)) return false;
    const p = svgPoint(e);
    /* A WALL POINT PREVIEWS ON THE PLASTER, AND SO IT IS TAKEN FIRST — ahead of
       the inside-a-room test for the same reason the press is: the pointer is
       AIMED at a wall, so it spends half its time a hair outside the outline,
       and the guard below would put the preview away exactly when it is wanted.
       THE GHOST CARRIES THE SEAT AND NOT A POSITION, so the canvas draws the
       stem, the circle and the J where the press will actually put them. */
    if (armed === WALL_POINT_ID) {
      const hit = wallPointSeatAt(p);
      setGhost(hit ? { typeId: armed, x: hit.seat.point.x, y: hit.seat.point.y,
                       seat: hit.seat } : null);
      if (guides.length) setGuides([]);
      return true;
    }
    /* A WALL UNIT PREVIEWS ON THE PLASTER, ahead of the inside-a-room test for
       the reason the press is: the pointer spends half its time a hair outside
       the outline, and the guard below would put the preview away exactly when
       it is wanted. THE GHOST CARRIES THE SEAT, so the canvas draws the body at
       the position AND THE ANGLE the press will actually use — which is the
       whole of what somebody is looking for before they commit. */
    if (typeOnWall(armed)) {
      const hit = wallUnitSeatAt(p, armed);
      setGhost(hit ? { typeId: armed, seat: hit.seat, bodyPx: hit.bodyPx,
                       x: hit.seat.point.x, y: hit.seat.point.y } : null);
      if (guides.length) setGuides([]);
      return true;
    }
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
    /* AND AT THE SWEEP THE PRESS WILL ACTUALLY USE. The ghost carried the
       catalogue's diameter and the press applied the standing sweep — see the
       `withSweep` line in `placeObject`, which this deliberately mirrors — so
       choosing 1200 on the bar left a 900 circle following the cursor. That is
       the same lie the ghost's COLOUR used to tell: a preview drawn at a size
       the click will not produce is a promise about where the thing lands that
       is off by a foot of diameter, and the fan's clearance circle is the one
       thing anybody is placing it by eye against. */
    let g = { x: snapped.x, y: snapped.y, typeId: armed };
    if (CEILING_BY_ID[armed]?.kind === 'fan') g = withSweep(g, fanSweepMm);
    setGhost(g);
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
      array: arrayDrag, module: moduleDrag, point: pt.drag,
    },
    move: {
      light: lightPointerMove, object: objPointerMove, cob: cobPointerMove,
      array: arrayPointerMove, module: modulePointerMove, point: pointPointerMove,
    },
    up: {
      light: lightPointerUp, object: objPointerUp, cob: cobPointerUp,
      array: arrayPointerUp, module: modulePointerUp, point: pointPointerUp,
    },
    /* THE POINTER ROUTER'S FIXTURE BRANCHES, each returning `true` when it has
       taken the event. */
    tool: { moduleDown, arrayDown, cobDown, objectDown, moduleMove, cobMove, armedMove },
    /* THE POINT'S OWN PAIR, handed out like every other element's. DELETE IS
       NOT HERE and it was: it is `fixtureCommands.points.removeSelected` now,
       beside every other kind's. The key that calls it is bound once in App's
       keydown effect, and this object is rebuilt every render — so a delete
       handed out from here could not be named in that effect's dependency
       array without re-binding the window listener on every frame, and naming
       it any other way is the stale closure that made Delete a no-op on a
       point somebody had just placed. */
    point: { down: pointPointerDown, move: pointPointerMove, up: pointPointerUp,
             dragging: !!pt.drag },
    commands: { openArray },
    draft: { array: cobDraftArray, setArray: setCobDraftArray },
  };
}
