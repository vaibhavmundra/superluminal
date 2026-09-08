// ---------------------------------------------------------------------------
// useGeometryGestures.js — EVERY PRESS, MOVE AND RELEASE THIS DOMAIN OWNS.
//
// The two snaps, the press that draws, the press that picks a shape up, the
// shape's own drag, its resize grips, the borrowed-outline take, and a drawn
// track's points.
//
// WHY IT IS ITS OWN CALL. `snapTargets` is App's — it collects the rooms, the
// placed objects and the shapes already drawn, and it is what the ceiling
// objects, the lights and the COB also snap against — and it needs
// `coveShapesPx`, which this feature produces. So the projections have to be
// built before it and the gestures after it, and a hook's arguments are
// evaluated during render. Same ordering constraint the electrical feature
// resolves with `useBoardStep`; here it falls between the derivations and the
// pointer instead of before both.
//
// `useDrag` AND `usePen` ARE USED AND NOT REIMPLEMENTED. The shape's move is a
// `useDrag` with the same options it always had — including `copy`, which is
// Alt-drag — and the two pens are the session's. Nothing here does the
// grab-offset, the slop or the axis-lock arithmetic by hand; see
// lib/dragMove.js for the rules and hooks/useDrag.js for where they are spent.
// ---------------------------------------------------------------------------
import { useRef } from 'react';
import { useDrag } from '../../hooks/useDrag.js';
import { select } from '../../lib/selection.js';
import { canGrab } from '../../lib/pressOwner.js';
import { penAim } from '../../lib/pen.js';
import { snapPoint } from '../../lib/snapGuides.js';
import { COVE_GAP_FT, coveClearOfOutline } from '../../lib/cove.js';
import {
  penShape, clampCoveMove, canTakeGeometry, resizeShape, bigEnough, newShapeId,
  isBuilt as shapeIsBuilt, bboxFt as shapeBboxFt,
} from '../../lib/ceilingShapes.js';
import { shapeCanTranslate } from './geometryRules.js';

/** How long two presses on one thing count as a double. */
const DOUBLE_MS = 400;

export function useGeometryGestures({
  state, commands, geometry,
  rooms, pxPerFt, ceilingShapes, roomAt, svgPoint, svgRef, pressState, addTool,
  docActions, setSel, setGuides, snapTargets, snapTol,
}) {
  const {
    shapeMenuOn, shapeTool, shapeRole, shapeSpan, shapeHeld, shapeDrag,
    shapeResize, trackGrip, geomHover, covePen, trackPen,
    setShapeMenuOn, setShapeTool, setShapeSpan, setShapeAt, setShapeHeld,
    setHeldSrc, setHeldOff, setShapeDrag, setShapeEditId, setShapeResize,
    setGeomHover, setTrackEditId, setSelTrackPt, setTrackGrip,
  } = state;
  const { abandonShape, finishOpenCove, finishTrack } = commands;
  const { at: shapeAtPointer, forTool: geomUnder, roomForSlot } = geometry.lookup;
  const { draft: shapeDraft } = geometry.status;
  const { canFinishOpen } = geometry.panel;

  /* THE CLICK A CAPTURED POINTER RETARGETS IS NOT THIS FILE'S PROBLEM ANY MORE.
     Every press below stops the event, and that is the whole of what any of
     them has to do: the canvas answers "was this press on bare plan?" for
     itself, in its own capture phase, and a press stopped here never reaches
     the handler that would say yes. See `barePress` in App.jsx — it used to be
     a flag each of these handlers raised by hand, and the ones that forgot were
     the selections that flickered. */

  /* THE LAST PRESS ON A SHAPE, for telling a second one from a first.
     A REF AND A TIMESTAMP RATHER THAN `onDoubleClick`, and the reason is the
     same one `barePress` exists for: the press captures the pointer to the
     <svg>, and a captured pointer retargets the compatibility mouse events that
     follow — so a `dblclick` handler on the shape's own path is a handler that
     may never be called. Two presses on the same shape inside the platform's
     own double-click window is the thing being detected anyway; this measures it
     directly instead of asking for it through an event that has been moved. */
  const lastShapePress = useRef({ id: null, t: 0 });

  /**
   * A PEN POINT, SNAPPED, WITH THE GUIDES TO SAY WHY.
   *
   * THE SAME BLUE DOTTED LINES THE TRACER DRAWS, and pointed at the same
   * targets — the space outlines and the objects on them. Clicking out a run
   * along a wall is the same problem as clicking out the wall was: a point a
   * hair off the line it was aimed at is wrong in exactly the way a traced
   * corner is, and a guide is the only thing on screen that says the aim has
   * been taken. Without them the pen was the one placing tool on this screen
   * with no alignment feedback at all.
   *
   * THE LOCK IS APPLIED FIRST AND THE SNAP SECOND, and the order is the whole
   * of the tricky part. The pen decides which axis a segment runs along; the
   * snap may then only move the point ALONG that axis. Snapping first would let
   * a wall three feet away pull the point off the line the pen had locked it
   * to, and the segment would come out crooked or the lock would silently be
   * undone.
   *
   * ...AND NO GUIDE IS DRAWN FOR THE FROZEN AXIS. Same rule `applySnap` states
   * in App: a guide is a claim that the point took an alignment, and drawing one
   * for a coordinate the lock is about to overwrite would be a line that lies
   * about where the point is going.
   */
  /* A PLAIN FUNCTION, LIKE `applySnap` AND FOR ITS REASON: it is only ever
     called from a pointer handler, so there is nothing for a memo to buy
     and `snapTol` reads the live zoom rather than a captured one. */
  const penSnap = (rawPx, pen) => {
    const raw = { x: rawPx.x / pxPerFt, y: rawPx.y / pxPerFt };
    const aim = penAim(pen.pts, raw, { lock: pen.locked });
    const last = pen.pts[pen.pts.length - 1];
    // WHICH COORDINATE THE LOCK FROZE, read off the answer rather than
    // re-derived: the pen already decided, and asking again is a second rule
    // that can disagree with the first.
    const lock = (pen.locked && last)
      ? (Math.abs(aim.y - last.y) < 1e-9 ? 'y' : 'x') : null;
    const at = { x: aim.x * pxPerFt, y: aim.y * pxPerFt };
    /* THE PATH'S OWN POINTS ARE TARGETS, which is what makes clicking out a
       rectangle possible: the fourth corner lines up with the first, and no
       source in `collectTargets` knows anything about a path that is still
       being drawn. THE LAST POINT IS LEFT OUT — the segment in flight starts
       there, so on a locked pen it is already exactly aligned on one axis and
       offering it would jam the free axis onto it too, which is a pen that
       cannot leave the point it is standing on. */
    const own = pen.pts.slice(0, -1).map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt }));
    const r = snapPoint(at, snapTargets(null, own), { tol: snapTol() });
    setGuides(r.guides.filter((g) => g.axis !== lock));
    return { x: (lock === 'x' ? at.x : r.x) / pxPerFt,
             y: (lock === 'y' ? at.y : r.y) / pxPerFt };
  };

  /**
   * A CORNER OF ONE OF THE FIVE DRAGGED PRIMITIVES, SNAPPED, IN PLAN FEET.
   *
   * THE PEN HAD GUIDES AND THE MARQUEE DID NOT, and there was no argument for
   * the difference — only that the pen was wired up later. Dragging out a
   * rectangle a foot inside another one is the single most common thing anybody
   * does with the geometry tool, and by eye at any zoom it is a guess. So the
   * anchor and the moving corner both go through the same engine everything else
   * on this screen uses, and the blue dotted lines say what was caught.
   *
   * NO LOCK IS PASSED, and that is the one place this differs from `penSnap`.
   * Shift on a primitive does not freeze an axis — it makes the shape UNIFORM
   * (a square, a circle, an equilateral triangle), which `shapeFromDrag` applies
   * to the pair of points AFTER this — so there is no frozen coordinate for a
   * guide to lie about. Squaring up a rectangle whose corner has snapped is
   * exactly what somebody holding Shift asked for.
   *
   * IT SNAPS THE POINTER AND NOT THE RESULT. A slot's ends are then projected
   * onto the room's outline by `spanOnOutline`, and a circle is fitted into the
   * box the two corners make; in both the snap decides where the DRAG is, which
   * is the thing the guides are drawn about.
   */
  const shapeSnapFt = (rawPx) => {
    if (!pxPerFt) return { x: 0, y: 0 };
    const r = snapPoint(rawPx, snapTargets(null), { tol: snapTol() });
    setGuides(r.guides);
    return { x: r.x / pxPerFt, y: r.y / pxPerFt };
  };

  /**
   * TAKE A GEOMETRY ALREADY ON THE DRAWING AS THE TOOL'S DRAFT.
   *
   * A FUNCTION AND NOT A BRANCH, because two different presses arrive at it. With
   * a primitive armed the press lands on the <svg> and comes through
   * `shapeToolDown`; with the bar merely OPEN the shape's own grab band answers
   * first and stops the event, so it comes through `shapePointerDown`. Same act,
   * same result, and one copy of it — the alternative was the same eight lines in
   * two handlers, which is how they come to disagree about whether the role is
   * stripped.
   *
   * IT ALWAYS TAKES THE EVENT, which is also what stops the click the browser
   * synthesises on release being read as a press on bare plan — that would clear
   * the selection and swap this bar for the space's own, forty milliseconds after
   * the draft appeared. See `barePress` in App.jsx.
   */
  const takeGeometry = (e, took) => {
    const { id: _id, role: _role, ...draft } = took;
    e.preventDefault();
    e.stopPropagation();
    setShapeSpan(null); setShapeAt(null); setGuides([]); setGeomHover(null);
    /* THE SOURCE IS KEPT AND THE OFFSET IS RESET. Kept, because every later
       change to the distance is computed from it rather than from the last
       answer — see `heldSrc`. Reset to "on the line", because the first thing to
       be sure of is that the right geometry was taken, and the only arrangement
       that shows that unambiguously is the one drawn on it. The distance is
       carried at a foot so choosing a side is one press. */
    setHeldSrc(draft);
    setHeldOff({ side: 'on', ft: 1 });
    setShapeHeld(draft);
    return true;
  };

  /**
   * PICKING ONE UP OFF THE SHEET.
   *
   * The same two-part gesture every other object on this canvas has: the press
   * selects, and the drag only becomes a MOVE once the pointer has gone past a
   * threshold.
   */
  const shapePointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    /* A TOOL IN HAND WINS, the same rule every selectable thing on this canvas
       follows — and the SHAPE TOOL is in that list, which is the one that is
       easy to miss. Somebody spanning a second cove across the first is aiming
       at the ceiling, not at the shape in the way, and without this the press
       would be swallowed here and the new shape would never start. The caller
       withholds the handler for exactly the same set (so the grab area is not
       even drawn); this is the local reading of it. */
    if (!canGrab(pressState)) return;
    /* --- THE BAR IS OPEN, AND THIS SHAPE IS ONE THE ROLE WOULD TAKE ---------
       THEN THE PRESS TAKES IT RATHER THAN SELECTING IT. This is the same act
       `shapeToolDown` performs; which handler gets it depends only on whether a
       primitive is armed, because an armed primitive is what makes the caller
       withhold this handler (and the grab band with it). With the bar open and
       unarmed the band is live and answers first, so the take has to happen here
       too — see `takeGeometry`, which is the one copy of it.
       THE CUE HAS ALREADY SAID SO. `geomHover` lit this line and turned the
       cursor into a hand the moment the pointer reached it, so a press that
       borrows an outline instead of selecting it is signposted rather than
       surprising.
       AND `canTakeGeometry` IS THE WHOLE TEST, WHICH IT HAD TO BECOME. It read
       as "any shape of another role", and the GUIDE bar is the one a plain click
       on a space raises — so after any click on any room, every press on a cove
       and every press on a track borrowed its outline instead of selecting it.
       Selecting a drawn cove, double-pressing one for its grips and picking up a
       magnetic track were all unreachable, while the modules clipped to that
       track went on selecting normally. See that function: a guide takes
       nothing. */
    if (!shapeTool) {
      const sh = ceilingShapes.find((q) => q.id === id);
      if (canTakeGeometry({ shape: sh, role: shapeRole, menuOpen: shapeMenuOn,
                            addTool, penEmpty: covePen.isEmpty })) {
        takeGeometry(e, sh); return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    /* A SECOND PRESS ON THE SAME SHAPE ASKS FOR ITS DIMENSIONS. The first
       selected it; this one goes a level in. Any other shape's press cancels
       the grips — they belong to one shape and showing them on two would be
       eight handles that could each mean either. */
    const now = Date.now(), prev = lastShapePress.current;
    const again = prev.id === id && now - prev.t < DOUBLE_MS;
    lastShapePress.current = { id, t: now };
    setShapeEditId(again ? id : (cur) => (cur === id ? cur : null));
    // A press on a shape is an act on THAT shape, so the bar becomes its
    // contextual menu — see `shapeMode`.
    setShapeMenuOn(false); setShapeTool(null); abandonShape();
    setSel(select('shape', id));
    const src = ceilingShapes.find((q) => q.id === id);
    if (!src || !pxPerFt) return;
    // AND THE HIGHLIGHT GOES WITH THE PRESS. The move handler stops tracking for
    // the length of a drag, so a value left behind would keep the cursor a hand
    // over a shape that is already moving.
    setGeomHover(null);
    shape.down(e, { id, members: [src] });
  };

  /* --- A COVE SHAPE'S WHOLE GESTURE -----------------------------------------

     HELD IN FEET, like a ceiling object and for its reason: a shape somebody
     drew is a real thing of a real size and must survive a scale correction.

     THE ROOM STOPS IT, AND THAT CONSTRAINT LIVES IN `to`. A cove may not come
     within six inches of the plaster — see coveClearOfOutline — and the honest
     way to say that during a drag is to have the shape stop, not to let it go
     anywhere and refuse it once the pointer is up. `clampCoveMove` slides it
     along the wall it reached, and along a notch the bounding box knows nothing
     about. THE ROOM IS THE ONE IT IS IN NOW, resolved from where the shape
     currently sits rather than from where the pointer is: a cove being pushed at
     a wall must not be handed the room on the other side of it half way through.

     A GUIDE IS NOT KEPT OFF THE PLASTER, AND A COVE IS. `clampCoveMove` holds a
     shape clear of the outline because a pocket four inches from the wall leaves
     four inches of board between them and nobody can build that. A guide is not
     built. It is a line to set out FROM — and the most useful place to put one
     is very often exactly on the wall, or a foot inside it, which is the one
     position the cove's rule exists to forbid. Applying it to a guide would make
     the tool refuse the thing it is for. Hence `shapeIsBuilt`.

     SHIFT LOCKS THE TRANSLATION TO ONE AXIS. The modifier is read live by
     `useDrag`, so it may be pressed before or during the move; whichever axis
     has travelled farther wins. There is still no snap: a cove is positioned
     against the room's own geometry by the clamp, while a guide or magnetic
     track follows the pointer on the locked horizontal or vertical line.

     ITS THRESHOLD IS A FRACTION OF THE DRAWING — a floor of three screen pixels
     or 12% of a foot, whichever is larger, converted into feet because that is
     the unit this gesture speaks. Shared with the light drag, which is the other
     one measured against the plan rather than the screen. */
  const shape = useDrag({
    state: [shapeDrag, setShapeDrag],
    point: (e) => { const p = svgPoint(e); return { x: p.x / pxPerFt, y: p.y / pxPerFt }; },
    capture: (e) => svgRef.current?.setPointerCapture?.(e.pointerId),
    at: (o) => ({ x: o.x, y: o.y }),
    to: (o, q) => {
      const room = roomAt({ x: o.x * pxPerFt, y: o.y * pxPerFt });
      const at = (shapeIsBuilt(o) && room?.geo?.polygonPlanFt)
        ? clampCoveMove(o, q, room.geo.polygonPlanFt, COVE_GAP_FT) : q;
      return { ...o, x: at.x, y: at.y };
    },
    setList: docActions.updateShapes,
    ortho: true,
    moved: (from, p) => Math.hypot(p.x - from.x, p.y - from.y)
      >= Math.max(3, pxPerFt * 0.12) / pxPerFt,
    /* ALT LEAVES A COPY BEHIND, AND THE MODIFIER IS READ LIVE — every word of the
       long note on the COB's own drag applies here unchanged, so it is not
       repeated. The short of it: "Alt then drag" and "drag then Alt" are one
       gesture, the ORIGINAL is put back where it was picked up, the TWIN is what
       keeps moving, and once made it stays made whether or not Alt is let go. */
    copy: true,
    mintId: () => newShapeId(),
    onCopy: ({ ids }) => setSel(select('shape', ids[0])),
  });

  const shapePointerMove = (e) => {
    if (!shape.drag || !pxPerFt) return;
    /* --- A SLOT DOES NOT MOVE, AND THAT IS THE HONEST ANSWER -----------------
       Both its ends are on the plaster — that is what makes it buildable, see
       `spanOnOutline` — so there is no direction it can be dragged in that
       leaves it a cove. Sliding it along its own two walls is not a translation
       and every other direction pulls it off them.
       IT IS STOPPED HERE RATHER THAN CLAMPED, because `clampCoveMove` is the
       keep-off-the-plaster rule and a slot is deliberately ON the plaster: it
       would find the shape already illegal and refuse every pixel, which is a
       drag that judders rather than one that plainly does nothing. The band is
       still grabbable, because grabbing it is how it is SELECTED and deleted.
       AND IT IS THE CALLER'S GUARD, NOT THE HOOK'S. Where an object's drag is
       deliberately constrained the constraint belongs beside the object, and
       this one is absolute: the whole frame is declined. */
    if (!shapeCanTranslate(ceilingShapes.find((q) => q.id === shape.drag.id))) return;
    shape.move(e);
  };
  const shapePointerUp = shape.up;

  /**
   * A GRIP ON THE FRAME, PRESSED.
   *
   * NO SLOP AND NO `live` FLAG, which every other drag on this canvas has. Those
   * exist to stop a click that wobbles from writing a hand position onto
   * something a rule had placed — but a grip is not a thing you click, it is a
   * thing you drag, and a press on one that goes nowhere resizes the shape to
   * exactly the size it already is. There is nothing to protect against.
   */
  /* --- A DRAWN TRACK'S POINTS, PICKED UP AND MOVED --------------------------
     THE SAME SHAPE AS `shapeHandleDown` DIRECTLY BELOW, and deliberately: a
     grip is a grip. The press selects the point and takes the pointer; stopping
     the event is also what keeps the click it synthesises on release from being
     read as a press on bare plan, which would close the path being edited on
     every drag. See `barePress` in App.jsx.

     THE POINT MOVES WITH ITS TWO LEGS. See `penMovePoint`: the corner goes
     where the pointer is and the two neighbours follow it onto their own axes,
     so a path that was square stays square without the far end of the run
     swinging about behind the hand. */
  const trackPointDown = (e, id, i) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    setTrackEditId(id); setSelTrackPt(i);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setTrackGrip({ id, i });
  };

  /** ...and dragged. Written straight into the list on every move, exactly as a
   *  shape's resize is: the answer depends only on where the pointer is now. */
  const trackGripMove = (e) => {
    if (!trackGrip || !pxPerFt) return;
    const p = svgPoint(e);
    const at = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    commands.moveTrackPoint(trackGrip, at);
  };

  const shapeHandleDown = (e, id, handle) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    // The click this press will synthesise lands on the <svg> once the pointer
    // is captured, and must not read as a press on bare plan — which the
    // `stopPropagation` above is already the whole of. See `barePress`.
    e.stopPropagation();
    setSel(select('shape', id)); setShapeEditId(id);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setShapeResize({ id, handle });
  };

  /**
   * ...AND DRAGGED. Written straight into the list on every move, exactly as a
   * shape's own drag is, and for the reason `resizeShape` gives: the side
   * opposite the grip does not move, so reading the shape back off the list each
   * frame gives the same anchor it gave last frame. There is no start-of-gesture
   * geometry to carry, which is what makes this three lines instead of thirty.
   */
  const shapeResizeMove = (e) => {
    if (!shapeResize || !pxPerFt) return;
    const p = svgPoint(e);
    const at = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    /* THE UPDATER FORM, because a resize is per-frame: two pointermoves can
       land before a re-render and the second must see the first. See
       LIST_UPDATED in usePlanDoc. */
    docActions.updateShapes((l) => l.map((q) => {
      if (q.id !== shapeResize.id) return q;
      const next = resizeShape(q, shapeResize.handle, at, { uniform: e.shiftKey });
      /* A GRIP MAY NOT PUSH THE COVE INTO THE KEEP-OUT BAND EITHER. Growing a
         shape is a move of one of its sides, and the six inches off the plaster
         is a rule about where the cove IS, not about how it got there. There is
         nothing to slide along here — a resize has one degree of freedom and it
         is already at its limit — so the side simply stops. */
      const room = roomAt({ x: q.x * pxPerFt, y: q.y * pxPerFt });
      const poly = room?.geo?.polygonPlanFt;
      if (poly && !coveClearOfOutline(shapeBboxFt(next), poly, COVE_GAP_FT)) return q;
      return next;
    }));
  };

  /**
   * THE PRESS THAT DRAWS. Returns true when it has taken the event, so the
   * handler below it can stop reading rather than testing the same conditions a
   * second time.
   *
   * TWO GESTURES BEHIND ONE TOOL. The five primitives are a drag — press,
   * span, release — and the pen is a run of separate clicks that ends on the
   * first point. Nothing about the two can be shared beyond this branch, which
   * is why the split is here and not four levels down.
   */
  const shapeToolDown = (e) => {
    if (!shapeMenuOn || !pxPerFt) return false;
    const p = svgPoint(e);
    /* --- A GEOMETRY ALREADY ON THE DRAWING IS SOMETHING TO SPAN FROM --------
       THE WHOLE POINT OF A GUIDE IS THAT SOMETHING GETS BUILT ON IT, and until
       this branch existed nothing could be: you drew a line to set out from,
       reached for the cove tool, and then had to drag a second rectangle over
       the first by eye — on the one drawing where the geometry to match was
       already there and exact. So a press on a geometry of the OTHER role hands
       that geometry to the tool as its draft. See `geomUnder` for why "the other
       role" and not "any shape".

       IT ARRIVES AS A HELD DRAFT AND NOT AS A COMMITTED COVE, which is what
       makes this one branch rather than a feature: the bar goes to its `draw`
       state, showing the size and a tick and a cross, and `commitShape` does the
       rest exactly as it does for a shape somebody dragged out. A cove is a
       piece of building — see the note there — so it gets its confirmation
       whether the outline was drawn or borrowed.

       THE ID AND THE ROLE ARE STRIPPED, AND BOTH MATTER. The id, because
       `sealShape` mints a fresh one and a draft carrying the source's would
       commit a second shape claiming to be the first. The role, because
       `sealShape` spreads the draft and only ADDS `role: 'guide'` — so a guide
       copied with its role intact would come back a guide however the tool was
       armed, which is this branch failing silently at the one thing it does.

       AND THE GUIDE STAYS WHERE IT IS. It was a setting-out line before the
       press and it is one after: the cove is a new shape on the same outline,
       and consuming the line that positioned it would take away the thing the
       next detail is set out from.

       NOT WHILE A PEN PATH IS OPEN. A click mid-path is a corner, and a corner
       is not a press anything else may take — the same rule every in-flight
       gesture on this canvas owns its pointer by. */
    /* --- AND AN ARMED TOOL OWNS THIS PRESS ---------------------------------
       `canTakeGeometry` IS THE WHOLE TEST AND IT IS NOT INLINE ANY MORE. It read
       `covePen.isEmpty && geomUnder(p)` here, and `geomUnder` answers for
       whichever tool is in hand — so with a track MODULE armed it returned the
       track under the pointer and this branch converted it into a fresh draft.
       The press never reached the module branch below: the diffuser and the spot
       were unreachable, which is what was reported. See the note on that
       function for the rule and tools/test-mag-track.mjs for the truth table. */
    const took = shapeAtPointer(p);
    if (canTakeGeometry({ shape: took, role: shapeRole, menuOpen: shapeMenuOn,
                          addTool, penEmpty: covePen.isEmpty })) {
      return takeGeometry(e, took);
    }
    /* NOTHING WAS TAKEN. With no primitive armed the bar is merely OPEN — the
       state a rail cell and a space click both leave it in — and this press is
       not its business: it falls through to the canvas, where it selects the
       space or lets go of a selection like any other press on bare plan. */
    if (!shapeTool) return false;
    e.preventDefault();
    /* THE PRESS IS ABOUT TO DRAW, so the highlight goes — here rather than in
       the two branches below. The move handler stops tracking for the length of a
       gesture (a span owns the pointer, and a pen with points down draws a band
       instead), so a shape lit up a pixel before the press would stay lit for the
       whole of it, claiming a press already spent on something else. */
    setGeomHover(null);
    const at = shapeTool === 'pen'
      // THE POINT THE GUIDES ARE PROMISING. `penSnap` is what the rubber band
      // was drawn from a moment ago, so running it again on the press is the
      // only way the click can land where the preview said it would.
      ? penSnap(p, covePen)
      // ...AND THE SAME RULE FOR THE FIVE DRAGGED PRIMITIVES. The anchor of a
      // marquee is a corner somebody aimed at a line; see `shapeSnapFt`.
      : shapeSnapFt(p);
    if (shapeTool === 'pen') {
      // A NEW PATH REPLACES WHATEVER WAS HELD, exactly as a new span does
      // below: the first click of a second outline means "not that one, this
      // one". Without it the held shape would keep winning in `shapeDraft` and
      // the clicks would appear to do nothing at all.
      if (shapeHeld && covePen.isEmpty) setShapeHeld(null);
      /* A DOUBLE-CLICK FINISHES THE RUN OPEN, which is what the track pen does
         and what every pen in every drawing tool does. It was Enter and a button
         only, and a gesture everybody already has in their hands should not have
         to be found on a keyboard.
         `detail > 1` AND NOT AN `onDoubleClick` HANDLER, for the reason the
         track pen gives: the second click of a double lands on the same pixel as
         the first, so the hook would refuse it as a zero-length segment — and
         "refused" and "finished" are different answers. */
      if (e.detail > 1) {
        if (canFinishOpen) finishOpenCove();
        return true;
      }
      /* CLICKING THE FIRST POINT CLOSES IT, which is the gesture everybody
         already knows from Figma — and the shape closes on its own anyway, so
         this is a way to say "done" rather than the only way to get a closed
         path. The tolerance is in PIXELS and converted, not in feet: it is
         about how accurately a person can hit a dot on screen, which does not
         change when the drawing is scaled. */
      const closeFt = Math.max(6, pxPerFt * 0.4) / pxPerFt;
      /* THE PEN ANSWERS WHICH OF THE TWO THINGS THE CLICK WAS, rather than this
         branch testing the first point itself and the hook testing it again on
         the way in. Two tests of one question is how they come to disagree. */
      if (covePen.add(at, { shiftHeld: e.shiftKey, tolFt: closeFt }) === 'closed') {
        setShapeHeld(penShape(covePen.pts));
        // THE PATH GOES WITH IT. `penDraft` and the held shape are two drawings
        // of the same outline, and leaving both up would draw it twice — the
        // dots and the rubber band over the shape they made.
        covePen.reset(); setShapeAt(null);
        return true;
      }
      setShapeAt(at);
      return true;
    }
    // A NEW SPAN REPLACES WHATEVER WAS HELD. Pressing on the plan with a shape
    // waiting for its tick means "not that one, this one" — the alternative is
    // a press that does nothing until you have found the cross.
    setShapeHeld(null);
    /* THE ROOM IS DECIDED AT THE PRESS AND HELD FOR THE WHOLE DRAG, and only a
       slot needs it. Re-deciding it per move would let a drag that strayed over
       a doorway re-target the neighbouring room halfway through, so the end you
       had already placed would jump to a wall of a room you were not drawing
       in. One press, one room. */
    const roomId = shapeTool === 'line' ? (roomForSlot(at)?.id ?? null) : null;
    setShapeSpan({ aFt: at, uniform: e.shiftKey, roomId });
    setShapeAt(at);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    return true;
  };

  /* --- THE DRAWN TRACK'S PEN ------------------------------------------------
     THE TWO HALVES OF THE `addTool === 'track'` BRANCHES App's pointer router
     holds. The router is App's — it is the arbitration between seven machines —
     and what a press and a move MEAN for this pen is this feature's. */
  const trackPenPress = (e, p) => {
    e.preventDefault();
    /* `detail > 1` IS THE DOUBLE-CLICK, and it finishes the run rather than
       placing a fourth point on top of the third. The second click of a
       double lands on the same pixel as the first, so the hook would refuse
       it as a zero-length segment anyway — but "refused" and "finished" are
       different answers and the gesture has to give the second one. */
    if (e.detail > 1) { finishTrack(); return; }
    /* CLICKING THE FIRST POINT CLOSES THE RUN, which is the gesture the
       cove pen already answers and the one everybody tries on a rectangle.
       The tolerance is in PIXELS and converted, not in feet: it is about
       how accurately a person can hit a dot on screen, which does not
       change when the drawing is scaled. */
    const closeFt = Math.max(6, pxPerFt * 0.4) / pxPerFt;
    if (trackPen.add(penSnap(p, trackPen), { tolFt: closeFt }) === 'closed') {
      finishTrack(true);
    }
  };

  /* THE TRACK'S RUBBER BAND, and it is the pen's own aimed point that gets
     drawn — the pointer with the axis lock already on it. Nothing is shown
     before the first click, because a locked segment has to be locked TO
     something. */
  const trackPenMove = (raw) => { trackPen.move(penSnap(raw, trackPen)); };

  /* --- THE CANVAS ROUTER'S FOUR GEOMETRY BRANCHES --------------------------
     EACH RETURNS TRUE WHEN IT HAS TAKEN THE MOVE, the idiom `shapeToolDown`
     already uses on the press. The ORDER between them is App's, because the
     branches in between are other machines' — the branch bodies are this
     feature's, and they are the same bodies in the same order. */

  /* THE SPAN, WHILE IT IS BEING DRAWN. `shapeAt` is the only thing that
     moves — the anchor was fixed at the press — and the shape itself is a
     memo over the pair. Shift is read live rather than at the press, so
     holding it halfway through a rectangle squares it up under your hand.
     AHEAD OF EVERY OTHER BRANCH, matching the press. */
  const spanMove = (e) => {
    if (shapeSpan && shapeMenuOn && shapeTool && pxPerFt) {
      const p = svgPoint(e);
      // SNAPPED, AND THE GUIDES SAY WHY — see `shapeSnapFt`. The far corner of a
      // marquee is aimed at a line as much as the near one was.
      setShapeAt(shapeSnapFt(p));
      if (shapeSpan.uniform !== e.shiftKey) {
        setShapeSpan((d) => (d ? { ...d, uniform: e.shiftKey } : d));
      }
      return true;
    }
    return false;
  };

  /* --- A PRIMITIVE IS ARMED AND NOTHING IS BEING DRAWN YET ---------------
     THE ONE THING WORTH KNOWING IN THIS STATE is whether the next press would
     drag out a new shape or take the geometry already under the pointer — see
     the branch at the top of `shapeToolDown`, whose `covePen.isEmpty` gate
     this mirrors exactly. Nothing else on this canvas is live here (every grab
     handler is withheld while a primitive is armed), so this owns the move.

     AFTER THE SPAN AND BEFORE THE PEN'S RUBBER BAND, and both halves of that
     are the gate. A span is a gesture in flight and owns the pointer, so a
     drag passing over a guide must not light it up. A pen with no points down
     has nothing to draw a band from and CAN still take a geometry, so it wants
     the cue; a pen mid-path cannot, and falls through to the band below. */
  const hoverMove = (e) => {
    if (shapeMenuOn && pxPerFt && covePen.isEmpty
        && !shapeResize && !shapeDrag && !trackGrip) {
      const h = geomUnder(svgPoint(e));
      const id = h?.id ?? null;
      if (id !== geomHover) setGeomHover(id);
      /* IT ONLY OWNS THE MOVE WHEN A PRIMITIVE IS ARMED. Unarmed, the bar is
         merely open — the state a rail cell and a space click both leave it in —
         and every grab handler on this canvas is live underneath it. Returning
         here would swallow the moves that drag a shape, resize one by its grips
         or slide a track's point. */
      if (shapeTool) return true;
    }
    return false;
  };

  /* THE PEN'S RUBBER BAND. No press to wait for — the path is a run of
     clicks — so the segment from the last point to the pointer is drawn
     whenever there is a point to draw it from. */
  const penMove = (e) => {
    if (shapeMenuOn && shapeTool === 'pen' && pxPerFt) {
      // SHIFT IS READ LIVE, exactly as the drag primitives read it: holding it
      // halfway along a segment straightens that segment under your hand rather
      // than only affecting the next one. The pen is handed a point that is
      // already snapped — see `penSnap` — so the guides on screen, the rubber
      // band and the click all describe one place.
      covePen.move(penSnap(svgPoint(e), covePen), e.shiftKey);
      return true;
    }
    return false;
  };

  /** The three gestures already in flight, in the order the router had them. */
  const dragMove = (e) => {
    // A TRACK POINT BEING DRAGGED, with the rest of the in-flight gestures and
    // for their reason: a gesture that has the pointer owns it until it is
    // released, whatever else is armed.
    if (trackGrip) { trackGripMove(e); return true; }
    // A GRIP ON A SHAPE'S FRAME, ahead of the shape's own drag: a gesture
    // already in flight owns the pointer until it is released, and these two
    // start from the same press on the same object.
    if (shapeResize) { shapeResizeMove(e); return true; }
    if (shapeDrag) { shapePointerMove(e); return true; }
    return false;
  };

  /* A SPAN LET GO IS A SHAPE HELD, NOT A SHAPE PLACED. The draft is frozen
     where the pointer left it and the bar turns into a tick and a cross; see
     `commitShape` for why a cove is confirmed rather than dropped. Anything
     too small to be a shape is simply forgotten — a click that wobbled is a
     click, and leaving a two-inch cove on the drawing to be hunted down is
     the worse of the two ways to be wrong. */
  const spanUp = () => {
    if (shapeSpan) {
      const held = shapeDraft;
      setShapeSpan(null);
      /* THE GUIDES GO WITH THE GESTURE, whichever way it ended. `abandonShape`
         clears them on the throw-away path; a shape that is KEPT would otherwise
         be left standing beside the dotted lines that helped place it, and a
         guide that outlives its drag is a drawn line. */
      setGuides([]);
      if (held && bigEnough(held)) setShapeHeld(held); else abandonShape();
      return true;
    }
    return false;
  };

  const gestureUp = () => {
    /* A TRACK POINT IS LET GO, and there is nothing to commit: `trackGripMove`
       wrote every frame straight into the list, exactly as a shape's resize
       does, so the release only has to put the gesture away. The path is
       re-measured on each write, so the schedule is already right. */
    if (trackGrip) { setTrackGrip(null); return true; }
    if (shapeResize) { setShapeResize(null); return true; }
    if (shapeDrag) { shapePointerUp(); return true; }
    return false;
  };

  return {
    shapePointerDown, shapeHandleDown, trackPointDown,
    shapeToolDown, trackPenPress, trackPenMove,
    spanMove, hoverMove, penMove, dragMove, spanUp, gestureUp,
  };
}

export default useGeometryGestures;
