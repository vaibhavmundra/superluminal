// ---------------------------------------------------------------------------
// useGeometryState.js — THE AUTHORING SESSION, AND NOTHING ELSE.
//
// EVERY PIECE OF STATE IN HERE IS TRANSIENT AND NONE OF IT IS A FACT ABOUT THE
// PLAN. The shapes themselves, the drawn tracks and the modules on a run are
// the document's — `usePlanDoc` remains the single persistent boundary and
// nothing here duplicates any of it. What is held here is which primitive is
// armed, where a drag started, what the pen has clicked out so far, which
// borrowed outline is being offset, which shape is showing its grips and which
// track point is picked up. A plan reopened holding any of it would be a plan
// reopened mid-gesture.
//
// WHY THIS IS ITS OWN CALL, AND IT IS THE SAME ANSWER `useBoardStep` GIVES.
// `pressState` — the canvas's one arbitration table, see lib/pressOwner.js —
// carries `shapeMenuOn` and `shapeTool`, and it is built a thousand lines above
// anything that could give this feature its geometry, its pointer or its snap
// engine. `resetForNewPlan` is built two hundred lines below that and calls
// three of the resets. A hook's arguments are evaluated during render, so the
// session is asked for on its own, early, and the rest of the domain is
// composed later and handed the result.
//
// THE TWO PENS ARE ONE PEN TWICE and they live here rather than in the gesture
// module, because the reset needs them and the reset is early. See
// hooks/usePen.js: the two tools differ in the options they pass and in
// nothing else.
// ---------------------------------------------------------------------------
import { useCallback, useMemo, useState } from 'react';
import usePen from '../../hooks/usePen.js';
import { POLY_SIDES } from '../../lib/ceilingShapes.js';

export function useGeometryState() {
  /* --- EDITING A DRAWN TRACK'S POINTS ----------------------------------------
     WHICH PATH IS OPEN, WHICH OF ITS POINTS IS PICKED, AND THE DRAG IN FLIGHT.
     Three pieces rather than one for the reason the shape editor keeps three:
     they have three different lifetimes. The path stays open while somebody
     moves four corners in a row; the selection survives a drag and is what
     Delete acts on; the drag lives for one press.

     THE PATH IS OPENED BY A DOUBLE CLICK ON THE RAIL and closed by Escape or by
     a press on empty plan, which is the same two-stage back-out every other
     selection on this canvas has. */
  const [trackEditId, setTrackEditId] = useState(null);
  const [selTrackPt, setSelTrackPt] = useState(null);
  const [trackGrip, setTrackGrip] = useState(null);

  /* --- THE GEOMETRY UNDER THE POINTER, WHILE SOMETHING CAN TAKE IT ----------
     A SHAPE ID, AND IT IS ONLY EVER SET WHILE A TOOL CAN ACTUALLY USE ONE. Two
     tools take a geometry rather than a point — the shape tool, which spans a
     cove from a guide already drawn, and the COB array, which sets a run out on
     one — and until this existed neither said so before the press. Both showed a
     crosshair over a line they were about to swallow, and the array drew a ghost
     lamp at the pointer that was never going to be placed there.

     ONE PIECE OF STATE FOR THREE CUES, which is why it is a state and not three
     tests at three call sites: the cursor turns into a pointer, the ghost lamp
     goes, and the geometry's own stroke comes up to full weight. All three are
     saying the same sentence — "press here and you get THIS line" — and they
     have to agree frame by frame.

     TRANSIENT, and cleared with whatever tool set it. A highlight left on a
     shape after the tool was put down is a shape claiming to be selectable by a
     press that would do something else. */
  const [geomHover, setGeomHover] = useState(null);

  /* --- COVES SOMEBODY DREW ---------------------------------------------------
     THE SHAPES THEMSELVES ARE THE DOCUMENT'S — a list of shapes in plan feet,
     held in feet so that correcting the scale underneath them does not resize
     them. See ceilingShapes.js for what one is and why its bounding box is what
     the grid gets cut on.

     THE REST OF THIS BLOCK IS THE GESTURE, and it is all transient. `shapeTool`
     is which primitive is armed, `shapeSpan` is where the drag started,
     `penPts` is the path so far, and `shapeAt` is the pointer — none of it is
     saved, because a half-drawn shape is not a thing a plan can be reopened
     holding. */
  /* IS THE FLOATING BAR OPEN? Separate from `shapeTool` because the bar opens
     BEFORE a shape has been chosen — pressing the cove button in the panel puts
     the menu on the drawing, and choosing a primitive from it is the next act.
     A single piece of state would make "open with nothing picked" impossible to
     say. */
  const [shapeMenuOn, setShapeMenuOn] = useState(false);
  const [shapeTool, setShapeTool] = useState(null);        // a SHAPE_TOOLS id
  /* WHAT THE BAR IS DRAWING FOR — 'cove' or 'guide'. THE BAR ITSELF IS THE SAME
     BAR, which is the whole of this: the six primitives, the gestures, the
     grips, the tick and the cross were all built for the cove tool and none of
     them was ever ABOUT coves. What differs is only what the drawing becomes
     once it is committed, and that is one field on the shape. See `roleOf` in
     ceilingShapes.js. Transient — a shape carries its own role once sealed. */
  const [shapeRole, setShapeRole] = useState('cove');
  const [shapeSides, setShapeSides] = useState(POLY_SIDES.initial);
  const [shapeAskSides, setShapeAskSides] = useState(false);
  const [shapeSpan, setShapeSpan] = useState(null);        // { aFt, uniform }
  /* --- THE TWO PENS, WHICH ARE ONE PEN TWICE ---------------------------------
     `penPts` AND ITS RUBBER BAND USED TO LIVE LOOSE HERE, beside the shape
     drag's state, and adding a second pen for the track would have meant a
     second point list, a second live segment and a second undo kept in step by
     hand. They are one hook now — see hooks/usePen.js — and the two tools
     differ in the two options they pass and in nothing else.

     THE COVE PEN CLOSES AND IS FREE-ANGLED, because a cove is an OUTLINE: the
     path has to come back to where it started or it encloses nothing, and a
     ceiling is not obliged to be rectilinear. Shift locks a segment square for
     the walls that are.

     THE TRACK PEN IS OPEN AND ALWAYS LOCKED, because a track is a RUN: it goes
     from somewhere to somewhere and stops, and a profile is set out along the
     building. There is no shift to hold — every segment is square, which is
     what makes an L or a C the natural thing to draw and a diagonal impossible
     to draw by accident. */
  const covePen = usePen({ lock: 'shift', closes: true });
  /* IT CLOSES TOO, WHICH THE FIRST VERSION OF THIS GOT WRONG. The argument for
     an open-only pen was that a track is a RUN — it goes from somewhere to
     somewhere and stops — and that is true of most of them and not of the one
     everybody draws first, which is a rectangle round a room. Clicking the
     first point again placed a second point on top of it and left the loop
     open. A track is closed when somebody closes it. */
  const trackPen = usePen({ lock: 'always', closes: true });
  const [shapeAt, setShapeAt] = useState(null);            // feet, plan space
  /* THE SHAPE THE DRAG LEFT BEHIND, waiting for the tick. A released drag does
     NOT commit — see the note on `commitShape` — so this is where it sits in
     between, and it is the one piece of the gesture that survives the pointer
     coming up. */
  const [shapeHeld, setShapeHeld] = useState(null);
  /* --- A DRAFT TAKEN FROM A GEOMETRY, AND HOW FAR OFF IT IS BEING SET -------
     TWO PIECES BECAUSE THE ANSWER IS RECOMPUTED AND NOT ACCUMULATED. `heldSrc`
     is the borrowed outline exactly as it was found, untouched for the life of
     the gesture; `heldOff` is the side and the distance the bar is showing. The
     draft is `insetShape(heldSrc, ...)` of the pair, worked out afresh on every
     change — so sweeping the distance from 1 ft to 2 ft and back lands on the
     original rather than on a shape that has been offset three times.

     IT IS ONLY EVER SET FOR A BORROWED DRAFT. A shape dragged out with a
     primitive has no source geometry to be offset FROM: the drag IS the
     position, and offering "a foot inside" of it would be asking about the wrong
     thing. `heldSrc` null is what withholds the control — see the shape bar.

     WHY THE CONTROL EXISTS AT ALL: a magnetic track set out a foot inside a
     guide is the ordinary case, and the whole reason to draw the guide first.
     It applies to a cove borrowed from a guide identically, because it is the
     same act — see `insetShape`. */
  const [heldSrc, setHeldSrc] = useState(null);
  /* ...AND WHETHER WHAT WAS BORROWED IS A ROOM. A space's outline can be taken
     the same way a guide's can — that is how a cove is set out six inches off
     the plaster all the way round — and it is the one source with a side that
     means nothing: OUTSIDE a room's outline is the next flat. The id rather
     than a flag, because the room is the thing that was pressed and a later
     reader will want to know which one. See `heldAsks`. */
  const [heldRoomId, setHeldRoomId] = useState(null);
  const [heldOff, setHeldOff] = useState({ side: 'on', ft: 1 });
  const [shapeDrag, setShapeDrag] = useState(null);        // moving one already there
  /* WHICH SHAPE IS SHOWING ITS HANDLES, and it is NOT the same thing as which
     one is selected. Selection is one press and gets the contextual bar — the
     corner radius, the copy, the bin. Dimensions are a second press on the same
     shape, and they get grips.

     TWO STATES BECAUSE THEY ARE TWO DEPTHS, and putting the grips on plain
     selection would mean eight handles appearing round a twenty-foot cove every
     time somebody clicked it to check its radius — grips over the drawing, over
     the fittings inside it, for a gesture nobody asked to make. It is the same
     depth a double-click buys everywhere else: select the thing, then get at
     what it is made of. */
  const [shapeEditId, setShapeEditId] = useState(null);
  const [shapeResize, setShapeResize] = useState(null);    // { id, handle }

  /* --- WHAT A FRESH SHEET TAKES AWAY ---------------------------------------
     THREE MEMBERS AND NOT ONE, because `resetForNewPlan` did not run these
     statements together: the shapes went in one block, the tool's own state
     twenty lines below it with the light moves in between, and the tracks below
     that. App calls each where the statements it replaces stood, so the reducer
     sees the same dispatches in the same order.

     THE DOCUMENT'S HALF IS APP'S. `clearShapes` and `clearTracks` are
     `docActions` calls and stay at the call site beside these — the boundary is
     not crossed from in here. */
  /* AND THE DRAWN COVES, for the reason the hand-placed slots go: a shape is
     set out in ONE plan's feet, and carrying it onto a fresh sheet would put a
     cove at whatever coordinates it happened to be drawn at. */
  const resetShapes = useCallback(() => {
    setShapeDrag(null);
    setShapeEditId(null); setShapeResize(null);
  }, []);

  const resetShapeTool = useCallback(() => {
    setShapeMenuOn(false); setShapeTool(null);
    setShapeSpan(null); covePen.reset(); setShapeAt(null); setShapeHeld(null);
    setShapeAskSides(false);
  }, [covePen]);

  // AND THE DRAWN TRACKS, which go for the same reason the shapes do: a path
  // is clicked out in ONE plan's feet.
  const resetTracks = useCallback(() => { trackPen.reset(); }, [trackPen]);

  /* MEMOISED FOR THE REASON usePen MEMOISES ITS OWN RETURN, quoted there: a
     fresh object every render makes `resetForNewPlan` — which names this in its
     dependency array — a fresh callback every render too, and that one is
     handed to `usePlanSource`. It changes when the pens change, which is
     exactly what the array it replaces (`[covePen, trackPen]`) said. */
  const reset = useMemo(
    () => ({ shapes: resetShapes, shapeTool: resetShapeTool, tracks: resetTracks }),
    [resetShapes, resetShapeTool, resetTracks]);

  return {
    /** The two members `pressState` carries. See lib/pressOwner.js. */
    press: { shapeMenuOn, shapeTool },
    /** What a fresh sheet takes away, in the three groups App calls them in. */
    reset,
    /** The pens, whole. The keydown handler and the rail reach them through
     *  this; nothing reimplements what hooks/usePen.js already does. */
    covePen, trackPen,
    /** The highlight, which the COB and module tools also drive — see
     *  `geomHover`. App's own add-tool move handlers set it. */
    geomHover, setGeomHover,

    /* --- THE INTERNAL HANDOFF ----------------------------------------------
       Everything below is this feature's own working state, handed to the two
       later calls (`useCeilingGeometry`, `useGeometryGestures`) rather than
       read by App. It is listed rather than spread so that a reader can see
       exactly what the session is. */
    trackEditId, setTrackEditId,
    selTrackPt, setSelTrackPt,
    trackGrip, setTrackGrip,
    shapeMenuOn, setShapeMenuOn,
    shapeTool, setShapeTool,
    shapeRole, setShapeRole,
    shapeSides, setShapeSides,
    shapeAskSides, setShapeAskSides,
    shapeSpan, setShapeSpan,
    shapeAt, setShapeAt,
    shapeHeld, setShapeHeld,
    heldSrc, setHeldSrc,
    heldRoomId, setHeldRoomId,
    heldOff, setHeldOff,
    shapeDrag, setShapeDrag,
    shapeEditId, setShapeEditId,
    shapeResize, setShapeResize,
  };
}

export default useGeometryState;
