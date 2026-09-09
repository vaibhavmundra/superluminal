// ---------------------------------------------------------------------------
// useGeometryCommands.js — EVERY ACT ON A SHAPE OR A DRAWN RUN THAT IS NOT A
// POINTER GESTURE.
//
// Opening and closing the bar, throwing a draft away, the tick, picking a
// primitive, the offset control, duplicating, deleting, finishing a pen path
// open, finishing a drawn run, and the drawn-track point editor's four
// commands.
//
// THE DOCUMENT IS WRITTEN THROUGH `docActions` AND NOWHERE ELSE. The shapes,
// the drawn tracks and the modules on a run are `usePlanDoc`'s; nothing here
// keeps a copy of any of them.
//
// TWO HALVES ARE DELIBERATELY NOT HERE:
//
//   THE STAND-DOWN. `openShapeTool` arms a tool that owns every press on the
//   canvas, so it has to put the zone editor, the door editor, the switchboard
//   step and whatever is armed away on the way in. That is arbitration BETWEEN
//   features and App is the only place that knows all seven owners — so it is
//   handed in as `standDown` and called exactly where the block stood, below
//   the `!arm` return. Same split `openBoardPlace` already has.
//
//   THE DIFFUSER ALLOCATOR. Committing a magnetic track fills it, and what a
//   run is filled WITH is the module domain's question, not the geometry's —
//   it reads the space analysis, the family catalogue and the room's shortfall.
//   `allocateOnTrack` is handed in and called on the same line it was called
//   on before.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef } from 'react';
import { select, clear, idOf } from '../../lib/selection.js';
import { penSegments, penLengthFt, MIN_SEG_FT } from '../../lib/pen.js';
import { newModuleId } from '../../lib/magTrack.js';
/* A MODULE ON A RUN IS A POINT HELD ON A PATH, so "which modules are on this
   shape" is the point primitive's own query rather than a filter written here.
   See lib/point.js. */
import { pointsOn } from '../../lib/point.js';
/* THE PATH PRIMITIVE OWNS THE VERTEX EDITS. `moveVertex` is the verb for both
   point editors on this canvas, and `moveShapeVertex` is that verb plus the
   box primitive's frame transform — see its note in lib/ceilingShapes.js. */
import { makePath, moveVertex, removeVertex, canRemoveVertex }
  from '../../lib/path.js';
import {
  SHAPE_BY_ID, sealShape, insetShape, newShapeId, penShape, bigEnough,
  roleOf as shapeRoleOf, moveShapeVertex,
} from '../../lib/ceilingShapes.js';
import { offsetGapFt, trackPtsFromSegments } from './geometryRules.js';

export function useGeometryCommands({
  state, geometry, docActions, ceilingShapes, manualTracks, trackFixtures,
  setSel, setGuides, allocateOnTrack, standDown,
}) {
  const { toCommit: shapeToCommit } = geometry.bar;
  const { canFinishOpen } = geometry.panel;
  const {
    shapeMenuOn, shapeTool, shapeRole, covePen, trackPen,
    setShapeMenuOn, setShapeTool, setShapeRole, setShapeAskSides,
    setShapeSpan, setShapeAt, setShapeHeld, setHeldSrc, setHeldOff,
    setShapeDrag, setShapeEditId, setShapeResize, setGeomHover,
    setTrackEditId, setSelTrackPt, setTrackGrip, heldSrc,
  } = state;

  /* --- DRAWING A COVE ---------------------------------------------------------
     THE SAME SHAPE AS THE OTHER STEPS ON THIS SCREEN — it owns the pointer, it
     stays open across placements, and it puts every other gesture away on the
     way in — with one difference that is worth naming rather than discovering:
     its controls are on the DRAWING and not in the panel. See ShapeMenu for why.

     `abandonShape` IS THE HALF-MADE GESTURE AND NOTHING ELSE. Closing the whole
     tool has to forget the draft too, so `closeShapeTool` calls it; the cross in
     the bar calls only this, because throwing a shape away is not the same act
     as putting the pen down. */
  const abandonShape = useCallback(() => {
    setShapeSpan(null); covePen.reset(); setShapeAt(null); setShapeHeld(null);
    // AND THE BORROWED SOURCE WITH IT. It exists for the length of one held
    // draft; left behind, the offset control would appear over a shape dragged
    // out from scratch and offer to set it in from a geometry it never came from.
    setHeldSrc(null);
    setShapeAskSides(false); setGuides([]);
  }, [covePen, setShapeSpan, setShapeAt, setShapeHeld, setHeldSrc,
      setShapeAskSides, setGuides]);

  const closeShapeTool = useCallback(() => {
    setShapeMenuOn(false); setShapeTool(null); setShapeDrag(null);
    // ...AND THE GEOMETRY IT WAS OFFERING TO TAKE. See `geomHover`.
    setGeomHover(null);
    abandonShape();
  }, [abandonShape, setShapeMenuOn, setShapeTool, setShapeDrag, setGeomHover]);

  /** ...and the grips, which belong to a shape rather than to the tool. Taken
   *  off wherever the drawing is about to be about something else. */
  const clearShapeEdit = useCallback(() => {
    setShapeEditId(null); setShapeResize(null);
  }, [setShapeEditId, setShapeResize]);

  const openShapeTool = useCallback((role = 'cove', { arm = true } = {}) => {
    /* THREE ROLES NOW, AND THE LIST IS NOT WRITTEN OUT HERE. It was
       `role === 'guide' ? 'guide' : 'cove'`, which silently turned every role it
       had not heard of into a cove — so opening the bar for a magnetic track
       committed a pocket. `roleOf` is the one place that knows the roles; asking
       it means a fourth one is a change to that file and not to this line. */
    setShapeRole(shapeRoleOf({ role }));
    /* ARMED ON THE RECTANGLE, NOT ON NOTHING. Opening with no primitive picked
       was a bar that looked ready and answered no press — you had to notice
       that one more click was owed before the drawing would respond, which is
       the kind of step nobody sees until they have already tried. The rectangle
       is the default for the reason it is first in the row: it is the one
       everybody reaches for, and picking any other is one press either way.

       ...UNLESS NOBODY ASKED TO DRAW, WHICH IS THE ONE EXEMPTION AND IT MATTERS.
       The bar also arrives as a consequence of clicking a space — see
       `onCanvasClick` — and that click was about the SPACE. Arming a placer on
       it would give one press two meanings and the second one would bite
       immediately: click a room to select it, click the room next door to select
       THAT, and instead of a selection you would have dragged out a rectangle.
       So the bar opens showing its primitives with none of them live, and the
       press that arms one is a press somebody made for that purpose. */
    setShapeMenuOn(true); setShapeTool(arm ? 'rect' : null);
    abandonShape();
    /* AND THE ARRAY'S BAR GOES, ARMED OR NOT. This one is above the `!arm`
       return on purpose: the unarmed bar is what a click on a space raises, and
       it lands in exactly the place the array's bar is standing — see
       `openArray` for why one is the limit. Nothing else in the takeover below
       has to happen for an unarmed bar, but this does. */
    setSel(clear());
    /* THE TAKEOVER BELOW BELONGS TO ARMING AND NOT TO OPENING, which is why it
       stops here when nothing was armed. Everything under this line exists to
       make this tool the sole owner of the next press; a bar showing six
       primitives with none of them live owns no press at all, and putting away
       somebody's zone editor or their half-placed switchboard because they
       clicked a room would be a click with two meanings — the very thing the
       note below is about. */
    if (!arm) return;
    clearShapeEdit();
    /* ONE POINTER PIPELINE, ONE OWNER — the same clearing `openZoneEdit` and
       `openBoardPlace` do. A press with two tools armed is a press with two
       meanings, and this one draws across the whole ceiling rather than at a
       point, so it is the least forgiving of the three about sharing.
       THE LIST IS APP'S, because App is the only place that knows every owner.
       See the note at the head of this file. */
    standDown();
  }, [abandonShape, clearShapeEdit, standDown, setSel,
      setShapeRole, setShapeMenuOn, setShapeTool]);

  /**
   * SET THE BORROWED DRAFT IN OR OUT — the one control a borrowed shape gets.
   *
   * RECOMPUTED FROM THE SOURCE EVERY TIME, never applied to the current draft.
   * `insetShape` is not reversible in the accumulating sense — a rectangle set
   * in a foot and then out a foot is the original, but a pen path offset twice
   * has been through the bisector solver twice and has drifted — so the source
   * is the only safe thing to measure from. See `heldSrc`.
   *
   * A REFUSAL LEAVES THE DRAFT WHERE IT WAS. `insetShape` returns null when the
   * offset eats the shape, and the honest reading of that is "not that far":
   * the control stops moving rather than the preview vanishing.
   */
  const setHeldOffset = useCallback((patch) => {
    setHeldOff((cur) => {
      const next = { ...cur, ...patch };
      if (!heldSrc) return next;
      const g = offsetGapFt(next);
      const made = insetShape(heldSrc, g);
      if (!made) return cur;
      setShapeHeld(made);
      return next;
    });
  }, [heldSrc, setHeldOff, setShapeHeld]);

  const finishOpenCove = useCallback(() => {
    if (!canFinishOpen) return;
    const shape = penShape(covePen.pts, { open: true });
    if (!shape) return;
    // THE PATH GOES WITH IT, exactly as it does when the pen closes: the held
    // shape and the pen's own dots are two drawings of one outline.
    setShapeHeld(shape);
    covePen.reset(); setShapeAt(null);
  }, [canFinishOpen, covePen, setShapeHeld, setShapeAt]);

  /* A NEW TRACK HAS TO BE ALLOCATED FROM THE COMMITTED PLAN, NOT FROM THE
     render in which the tick was pressed. Adding the shape is a reducer
     dispatch; `spaceAnalysis` in that same event still describes the previous
     ceiling. In particular, converting a guide line could therefore ask the
     old room for its shortfall and decide that the new rail needed no
     diffusers. Keep the id until the shape is visible in `ceilingShapes`, then
     run the allocator once from the following render. Clearing before the call
     also makes this safe under React's development-mode effect replay. */
  const pendingTrackAllocation = useRef(null);
  useEffect(() => {
    const id = pendingTrackAllocation.current;
    if (!id) return;
    const shape = ceilingShapes.find((q) => q.id === id);
    if (!shape) return;
    pendingTrackAllocation.current = null;
    allocateOnTrack(shape);
  }, [ceilingShapes, allocateOnTrack]);

  /**
   * KEEP IT. The tick, and the only way a shape gets onto the drawing.
   *
   * A RELEASED DRAG DOES NOT COMMIT, which is the one place this tool departs
   * from every other marquee in the app, and it is what the brief asked for.
   * The reason it is right: a cove is a piece of BUILDING, not a box round a
   * bed — it changes what the ceiling is, it re-cuts the grid and it re-runs
   * the layout — so it gets a confirmation, and the drag can be redone as many
   * times as it takes before anybody says yes.
   *
   * AND THE TOOL PUTS ITSELF DOWN, WHICH IS THE OPPOSITE OF WHAT IT DID FIRST.
   * It stayed armed, on the switchboard step's reasoning: plates come in
   * threes, so a tool that disarms after the first one costs a press between
   * each. That reasoning does not survive contact with this tool, for a reason
   * specific to it — WHILE A PRIMITIVE IS ARMED, NOTHING ON THE SHEET CAN BE
   * PICKED UP. The armed tool owns every press on the canvas, and it has to: a
   * new cove may well be spanned across an existing one. So the shape that had
   * just been committed could not be selected, could not be given a corner
   * radius and could not be moved. The tick appeared to place something and
   * then leave it inert.
   *
   * So the tick lands the shape, SELECTS it, and hands the bar over to it as
   * that shape's contextual menu — which is also the order the brief describes:
   * click the tick, then set the corner radius on the thing you just drew.
   * Another cove is one press on the palette, which is a fair price for the
   * thing that was actually in the way.
   */
  const commitShape = useCallback(() => {
    if (!shapeToCommit || !bigEnough(shapeToCommit)) return;
    const shape = sealShape(shapeToCommit, shapeRole);
    if (shapeRoleOf(shape) === 'track') pendingTrackAllocation.current = shape.id;
    docActions.addShape(shape);
    closeShapeTool();
    // ONE SELECTION ON THIS CANVAS, exactly as picking one off the sheet does.
    setSel(select('shape', shape.id));
    // A track is filled after this reducer write is visible; see the pending
    // allocation effect above.
  }, [docActions, shapeToCommit, shapeRole, closeShapeTool, setSel]);

  /** Pick a primitive off the bar. The polygon is the one that asks a question
   *  first, because "how many sides" has no sensible default to assume. */
  const pickShapeTool = useCallback((id) => {
    abandonShape();
    setShapeTool((t) => (t === id ? null : id));
    if (id !== shapeTool && SHAPE_BY_ID[id]?.asks === 'sides') setShapeAskSides(true);
  }, [abandonShape, shapeTool, setShapeTool, setShapeAskSides]);

  const duplicateShape = useCallback((id) => {
    const src = ceilingShapes.find((q) => q.id === id);
    if (!src) return;
    // HALF A FOOT DOWN AND ACROSS, so the copy is visibly a second object rather
    // than a shape that appears not to have been copied at all. The same offset
    // a duplicate gets in every editor, for the same reason.
    // THE ID IS MINTED OUT HERE and not inside the updater: an updater has to be
    // pure, React is entitled to run it twice, and a `setSel` in the
    // middle of one would be selecting whichever of the two copies it ran last.
    const copy = { ...src, id: newShapeId(), x: src.x + 0.5, y: src.y + 0.5 };
    docActions.addShape(copy);
    setSel(select('shape', copy.id));
    /* --- AND A TRACK BRINGS ITS MODULES WITH IT ---------------------------
       COPYING A RUN AND LEAVING ITS FITTINGS BEHIND WOULD NOT BE A COPY. A
       magnetic track is a profile with modules clipped into it, and "duplicate"
       said of one means the second run is the same run — same length, same three
       diffusers at the same places along it. That is the whole reason to
       duplicate rather than draw a second one and clip six modules onto it by
       hand.
       THE FRACTIONS COPY UNCHANGED, WHICH IS WHY THEY ARE FRACTIONS. A module is
       stored as a proportion of its run (see `clampU`), so the arrangement
       survives onto a copy of any length — and it will be another length the
       moment somebody drags a grip on it. Stored in feet the copy would be
       right until it was resized and then quietly shed its far modules.
       NOTHING HAPPENS FOR A COVE OR A GUIDE, because neither carries a module —
       the filter is empty and the write is skipped. */
    const mods = pointsOn(trackFixtures, id);
    if (mods.length) {
      docActions.addTrackFixtures(mods.map((f, i) => ({
        ...f, id: newModuleId(`d${i}`), on: copy.id,
      })));
    }
  }, [docActions, ceilingShapes, trackFixtures, setSel]);

  const deleteShape = useCallback((id) => {
    docActions.removeShape(id);
    setSel((cur) => (idOf(cur, 'shape') === id ? clear() : cur));
    setShapeEditId((cur) => (cur === id ? null : cur));
    /* AND THE MODULES GO WITH THE RUN THEY WERE CLIPPED INTO. A module with no
       profile is not a fitting anybody can install, and an orphan in the store
       would be an entry nothing draws and nothing can reach to delete — it would
       simply sit in every saved plan for ever. `trackModulesPx` also drops one
       whose run has gone, which is the belt to this braces. */
    docActions.dropTrackModules(id);
  }, [docActions, setSel, setShapeEditId]);

  /* --- FINISHING A DRAWN TRACK ------------------------------------------------
     A RUN ENDS WHEN SOMEBODY SAYS IT DOES, and that is the one way the track pen
     differs from the cove pen as a GESTURE rather than as a setting. A cove
     path closes on its own first point, so the last click both places a point
     and says "done"; an open run has no such click to borrow — the point you
     want last looks exactly like a point in the middle — so there has to be a
     separate act. There are three of them, all saying the same thing: Enter, a
     double-click, and the button on the step. Three ways in because a pen is
     held with one hand and the mouse is the other, and which one is free
     depends on where in the path you are.

     THE TOOL STAYS ARMED. Finishing a run is not finishing with the tool, for
     the reason the step gives generally: this panel is the screen while it is
     open, and a tool that put itself away after one run would empty and refill
     the screen under somebody who was drawing three.

     TWO POINTS IS THE MINIMUM AND IT IS NOT ARBITRARY. One point is a click, not
     a run — and `penSegments` drops anything shorter than a few inches, so a
     path of two points a hair apart finishes as nothing at all rather than as a
     profile of no length. */
  const finishTrack = useCallback((closed = false) => {
    // THE GUIDES GO WITH THE GESTURE. They are momentary by definition — see
    // the note over them in PlanCanvas — and a dotted line left on the sheet
    // after the run is finished is a drawn line, which is the one thing they
    // must never become.
    setGuides([]);
    const segs = penSegments(trackPen.pts, { minFt: MIN_SEG_FT, closed });
    if (!segs.length) { trackPen.reset(); return; }
    const pts = trackPtsFromSegments(segs, closed);
    /* THE ID IS MINTED IN THE REDUCER, from the list's own length, and the
       timestamp is passed in so the reducer stays a pure function of its
       arguments — see LIST_ADDED_MINTED. Same format as before. */
    docActions.addTrack({ ptsFt: pts, closed, lengthFt: penLengthFt(pts, { closed }) },
      Date.now().toString(36));
    trackPen.reset();
  }, [docActions, trackPen, setGuides]);

  /**
   * A WHOLE DRAWN RUN, TAKEN OFF THE PLAN.
   *
   * IT PUTS THE LIGHTS BACK, AND THERE IS NOTHING HERE THAT DOES SO. That is
   * the point worth stating: a track never moved a light out of the layout, it
   * only carried one that was already there — see the doctrine at the top of
   * track.js — so removing the path is the whole of the undo. The layout memo
   * re-runs with one fewer entry in `manualTracks`, the absorption that
   * relabelled those fittings simply does not happen, and every one of them is
   * back on its own grid position as a recessed downlight. Same as deleting a
   * cove, and for a simpler reason: a cove had to re-cut the grid to be
   * removed, and this only has to stop being consulted.
   */
  const deleteTrack = useCallback((id) => {
    docActions.removeTrack(id);
    setTrackEditId(null); setSelTrackPt(null); setTrackGrip(null);
  }, [docActions, setTrackEditId, setSelTrackPt, setTrackGrip]);

  /**
   * A POINT TAKEN OUT, AND THE PATH PUT BACK ON ITS AXES BEHIND IT.
   *
   * Removing a corner leaves the two points that were either side of it joined
   * by a diagonal, and a track cannot be built along one — so the tail is
   * re-squared from the cut. See `penRelock` for why it cascades.
   *
   * Below the minimum the whole track goes instead — see the guard.
   */
  const deleteTrackPoint = useCallback((id, i) => {
    const t = manualTracks.find((q) => q.id === id);
    if (!t) return;
    /* A CIRCUIT NEEDS THREE POINTS AND A RUN NEEDS TWO. Below that there is no
       path left to have, so the whole track goes rather than being left as a
       line doubled back on itself — which is what a two-point closed loop is —
       and the editor closes with it, because there is nothing to keep open.
       THE RULE IS `canRemoveVertex`'S NOW — the path primitive states both
       minima, and it was this guard lifted into lib/path.js. */
    const whole = makePath(t.ptsFt, { closed: !!t.closed });
    if (!canRemoveVertex(whole)) { deleteTrack(id); return; }
    /* AND NO RELOCK ON THE WAY OUT EITHER. This re-squared the tail from the
       cut, which is right only if the path has to be orthogonal — and a track
       may be angular. A delete that straightened three legs nobody touched
       would be the same surprise a move that dragged two neighbours was. */
    const pts = removeVertex(whole, i).pts;
    docActions.patchTrack(id, { ptsFt: pts,
      lengthFt: penLengthFt(pts, { closed: !!t.closed }) });
    setSelTrackPt(null);
  }, [docActions, manualTracks, deleteTrack, setSelTrackPt]);

  /**
   * OPENING A PATH FROM A RAIL SOMEBODY CLICKED.
   *
   * The canvas hands over the track's `key`, which for a drawn run IS the
   * manual track's id — stamped in the layout pass — so this is a lookup rather
   * than a hit test. Guarded anyway: a key that matches nothing would open an
   * editor with no points in it, which reads as the feature being broken.
   */
  const openTrackEdit = useCallback((key) => {
    if (!manualTracks.some((t) => t.id === key)) return;
    setTrackEditId(key); setSelTrackPt(null);
  }, [manualTracks, setTrackEditId, setSelTrackPt]);

  /** A CORNER, MOVED. Written straight into the list on every frame, exactly as
   *  a shape's resize is: the answer depends only on where the pointer is now.
   *  THE POINT MOVES WITH ITS TWO LEGS. See `penMovePoint`: the corner goes
   *  where the pointer is and the two neighbours follow it onto their own axes,
   *  so a path that was square stays square without the far end of the run
   *  swinging about behind the hand. */
  const moveTrackPoint = useCallback((grip, at) => {
    /* WHICH STORE THIS VERTEX BELONGS TO, off the grip. One point editor serves
       a drawn track and a `pen` or `line` ceiling shape — see
       `projectShapeEditPx` — and BOTH edits are the path primitive's
       `moveVertex`. The only difference is where the result is written and, for
       a shape, that its points are held in its own frame: `moveShapeVertex`
       carries that half. */
    if (grip.of === 'shape') {
      const sh = ceilingShapes.find((q) => q.id === grip.id);
      if (!sh) return;
      /* NO RELOCK, AND THAT IS THE WHOLE OF WHAT A POINT EDIT MEANS. This
         passed `lock: isTrack(sh)`, on the assumption that a magnetic profile
         can only be built in orthogonal pieces. It can be angular, so the
         assumption was wrong — and the lock was doing something worse than
         constraining the shape: `penMovePoint` carries the two NEIGHBOURING
         vertices onto the dragged one's axes, so dragging one point moved two
         others. Editing one point of a path moves ONE point. The outline tracer
         behaves this way and it is the behaviour anybody expects.
         `moveVertex` still takes the lock and `penMovePoint` still implements
         it — see lib/path.js. Nothing on this canvas asks for it now. */
      const next = moveShapeVertex(sh, grip.i, at);
      docActions.updateShapes((l) => l.map((q) => (q.id === grip.id ? next : q)));
      return;
    }
    const held = manualTracks.find((t) => t.id === grip.id);
    if (!held) return;
    /* AND THE SAME FOR A DRAWN TRACK, for the same reason: one point pressed,
       one point moved. */
    const pts = moveVertex(makePath(held.ptsFt, { closed: !!held.closed }),
      grip.i, at).pts;
    docActions.patchTrack(grip.id, { ptsFt: pts, lengthFt: penLengthFt(pts) });
  }, [docActions, manualTracks, ceilingShapes]);

  /** Shut the point editor. One place, because three keys and a press reach it. */
  const closeTrackEdit = useCallback(() => {
    setTrackEditId(null); setSelTrackPt(null); setTrackGrip(null);
  }, [setTrackEditId, setSelTrackPt, setTrackGrip]);


  /* --- THE RAIL'S TWO CELLS ------------------------------------------------
     ONE CELL FOR TWO ROLES' WORTH OF BAR, and the latch is the bar's own role
     rather than a second piece of state kept in step with it. Pressing a
     latched cell is "close"; pressing the other is "make this a track instead",
     and switching the bar over is what somebody asking for that means. Plain
     functions and not callbacks, because that is what they were as inline
     arrows at the call site — memoising them would change a prop's identity and
     nothing asked for that. */
  const coveOn = shapeMenuOn && shapeRole === 'cove';
  const trackOn = shapeMenuOn && shapeRole === 'track';
  const toolbar = {
    coveOn, trackOn,
    toggleCove: () => (coveOn ? closeShapeTool() : openShapeTool('cove')),
    toggleTrack: () => (trackOn ? closeShapeTool() : openShapeTool('track', { arm: false })),
  };

  return {
    toolbar,
    abandonShape, closeShapeTool, clearShapeEdit, openShapeTool,
    setHeldOffset, finishOpenCove, commitShape, pickShapeTool,
    duplicateShape, deleteShape,
    finishTrack, deleteTrack, deleteTrackPoint, openTrackEdit, closeTrackEdit,
    moveTrackPoint,
  };
}

export default useGeometryCommands;
