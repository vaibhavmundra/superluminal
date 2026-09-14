// ---------------------------------------------------------------------------
// useGeometryDerivations.js — THE MEMO ADAPTERS.
//
// Nothing but dependency arrays and the calls into geometryRules.js. Every
// arithmetic decision this file used to make inline is in that module now,
// where it is a function of its arguments and can be checked without a canvas;
// what is left here is when React is allowed to recompute each answer.
//
// THE ARRAYS ARE THE ONES App HAD, member for member. Where a body became a
// module import the array did not change: a module binding is stable for the
// life of the process, which is strictly more stable than the callback it
// replaced.
// ---------------------------------------------------------------------------
import { useCallback, useMemo } from 'react';
import { maxInset } from '../../lib/geometry.js';
import { ARRAY_SIDES } from '../../lib/cob.js';
import { SHAPE_GESTURE } from '../../components/ShapeMenu.jsx';
import {
  SHAPE_BY_ID, shapeFromDrag, penShape, penSpansOutline, bigEnough,
  isOpen as shapeIsOpen, outlineFt as shapeOutlineFt,
  MIN_SPAN_FT as SHAPE_MIN_SPAN_FT,
} from '../../lib/ceilingShapes.js';
import {
  roomForSlotAt, shapeUnderPoint, takeableGeometry, slotSpan, arrayOutlineFor,
  trackRefusals, groupTrackRefusals, shapeBarMode,
} from './geometryRules.js';

export function useGeometryDerivations({
  state, rooms, pxPerFt, ceilingShapes, manualTracks, opt,
  selShapeId, addTool, cobMode, boardPlace, zoneMode, readOnly,
}) {
  const {
    shapeMenuOn, shapeTool, shapeRole, shapeSides, shapeAskSides,
    shapeSpan, shapeAt, shapeHeld, heldSrc, heldRoomId, heldOff, covePen,
  } = state;

  /* --- THE ROOM A SLOT IS BEING SPANNED IN ---------------------------------
     See `roomForSlotAt`: the room under the press, and failing that the
     nearest one its outline is within reach of. */
  const roomForSlot = useCallback(
    (pFt) => roomForSlotAt(rooms, pFt, pxPerFt), [rooms, pxPerFt]);

  /* --- THE SLOT IN FLIGHT, AND WHY IT IS REFUSED WHEN IT IS ------------------
     ONE MEMO ANSWERING BOTH, because the two are the same computation and a
     refusal is not an error state — it is the ordinary condition of a drag that
     has not reached a second wall yet. See `slotSpan`. */
  const lineSpan = useMemo(
    () => slotSpan({ shapeTool, shapeSpan, shapeAt, rooms, shapeRole }),
    [shapeTool, shapeSpan, shapeAt, rooms, shapeRole]);

  /* --- THE SHAPE THE GESTURE HAS MADE SO FAR --------------------------------
     A MEMO AND NOT A PIECE OF STATE, so there is exactly one place the live
     shape comes from and the preview on the drawing cannot drift from the thing
     the tick commits. It is the same argument `draftCove` makes one screen
     over: a preview built by separate code is a preview that eventually
     disagrees with the placement.

     `shapeHeld` WINS WHEN THERE IS ONE. The drag is over — the pointer came up
     — and what is on the drawing is the shape waiting for a tick. Recomputing
     it from `shapeSpan` and a pointer that has since moved elsewhere would make
     the shape follow the mouse after the gesture ended. */
  const shapeDraft = useMemo(() => {
    if (shapeHeld) return shapeHeld;
    if (!shapeMenuOn || !shapeTool) return null;
    if (shapeTool === 'pen') {
      // Closed the whole way through, including while it is being drawn: the
      // shape auto-closes, so a preview with a gap in it would be promising
      // something that cannot be committed.
      // THE PEN'S OWN AIMED POINT AND NOT `shapeAt`. `at` is the pointer with
      // the axis lock already applied, so the outline being drawn and the point
      // a click would commit are one value. See usePen.
      const pts = covePen.path;
      return pts.length >= 3 ? penShape(pts) : null;
    }
    if (!shapeSpan || !shapeAt) return null;
    /* --- A SLOT IS THE ONE DRAG WHOSE ENDS ARE NOT WHERE THE POINTER IS ------
       Both go on the WALL, and they are re-projected on every move rather than
       once at the press: the room's outline is what the run has to land on, so
       what is drawn while you drag is what would be built. A span that cannot
       be one — both ends on the same wall, or nothing left of the run — draws
       NOTHING, and the panel beside it says why. See `lineSpan`. */
    if (shapeTool === 'line') return lineSpan.shape;
    return shapeFromDrag(shapeTool, shapeSpan.aFt, shapeAt,
                         { sides: shapeSides, uniform: shapeSpan.uniform });
  }, [shapeHeld, shapeMenuOn, shapeTool, covePen.path, shapeAt, shapeSpan, shapeSides,
      lineSpan]);

  /** The shape the contextual bar is talking about. */
  const selShape = useMemo(
    () => ceilingShapes.find((q) => q.id === selShapeId) ?? null,
    [ceilingShapes, selShapeId]);

  /* WHICH OF THE FOUR THINGS THE BAR IS — see `shapeBarMode`, which carries the
     whole argument for the four states and for why `edit` is withheld while
     another machine on this canvas owns the next press. */
  const otherBar = !!addTool || boardPlace || zoneMode;
  const shapeMode = shapeBarMode({
    shapeMenuOn, shapeAskSides, shapeDraft, penEmpty: covePen.isEmpty,
    shapeSpan, shapeTool, selShape, otherBar,
  });

  /* WHAT THE TICK WOULD ACTUALLY COMMIT, which is not always what is drawn.
     The pen's preview carries the point under the CURSOR as a live vertex —
     that is what makes the rubber band a preview — and committing it would put
     a corner of the cove wherever the pointer happened to be resting. So the
     tick takes the clicked points and nothing else, and the preview keeps its
     extra vertex. Every other tool has no such distinction and this is the
     draft. */
  const shapeToCommit = useMemo(() => {
    if (shapeHeld) return shapeHeld;
    if (shapeMenuOn && shapeTool === 'pen') return penShape(covePen.pts);
    return shapeDraft;
  }, [shapeHeld, shapeMenuOn, shapeTool, covePen.pts, shapeDraft]);

  const canCommitShape = !!shapeToCommit && bigEnough(shapeToCommit);

  /**
   * WHAT THE SHAPE BAR MAY ASK ABOUT A BORROWED DRAFT.
   *
   * `null` UNLESS ONE IS HELD, which is what keeps the control off a shape
   * dragged out from scratch — that drag IS the position.
   *
   * AND NO SIDE ON AN OPEN PATH. A line has no inside: "a foot in from it" names
   * two paths and nothing in the drawing says which. `insetShape` returns an
   * open shape unchanged for exactly that reason, so offering the control would
   * be offering one that does nothing. Same call `arrayAsks` makes.
   */
  const heldAsks = useMemo(() => {
    if (!heldSrc || shapeIsOpen(heldSrc)) return null;
    const pts = shapeOutlineFt(heldSrc);
    return { sideId: heldOff.side, ft: heldOff.ft,
             /* NO SIDES AT ALL FOR A ROOM, AND THAT IS NOT THREE NARROWED TO
                ONE — it is a question that does not arise. Outside a room's
                outline is the next flat; ON it is the plaster, which the
                clearance rule refuses six inches later. Inwards is the only
                answer, so the bar prints the word and asks for the distance —
                see the empty case in ShapeMenu, and `takeGeometry`, which sets
                the draft in by the default foot on the way in. Every other
                source keeps all three: a track set out exactly on the guide
                that positioned it is the ordinary case there. */
             sides: heldRoomId ? [] : ARRAY_SIDES,
             // HOW FAR IN THE CONTROL MAY GO, from the geometry itself — see
             // `maxInset`, which bisects on the real offset rather than guessing
             // at an inradius, because an L-shaped outline has not got one.
             maxFt: Math.max(0, maxInset(pts) - SHAPE_MIN_SPAN_FT / 2) };
  }, [heldSrc, heldRoomId, heldOff]);

  /* --- FINISHING A PEN PATH OPEN, WHICH IS THE L-SHAPED COVE ----------------
     THE PEN HAS TWO ENDINGS NOW AND THEY MEAN DIFFERENT DETAILS. Clicking the
     first point closes the path, and a closed path is a pocket run round an
     island. Pressing Enter leaves it OPEN, and an open path is a slot across the
     ceiling — which is only buildable if it lands on plaster at both ends, so
     this is offered exactly when it does and not otherwise.

     THE MIDDLE POINTS ARE LEFT WHERE THEY WERE PUT. Only the two ENDS answer to
     the walls, and they are tested rather than projected — unlike the line's,
     which are dragged and can be snapped continuously. A click is a considered
     act; moving somebody's corner after they placed it is the tool arguing with
     them. See `penSpansOutline`.

     THE TOLERANCE IS IN PIXELS AND CONVERTED, the same rule the closing click
     follows: it is about how accurately a person can hit a wall on screen, which
     does not change when the drawing is scaled. */
  const openPenRoom = useMemo(() => {
    if (!shapeMenuOn || shapeTool !== 'pen' || covePen.pts.length < 2) return null;
    return roomForSlot(covePen.pts[0]);
  }, [shapeMenuOn, shapeTool, covePen.pts, roomForSlot]);

  const canFinishOpen = useMemo(() => {
    /* A GUIDE PATH IS FINISHED WHEN IT HAS TWO POINTS. The wall test below is
       the cove's — an open cove is a channel and both its ends have to reach the
       plaster or there is no end detail to build. A guide reaches nothing on
       purpose: a run of spots set out over a worktop stops where the worktop
       does. Same exemption `lineSpan` makes, for the same reason. */
    // A GUIDE OR A TRACK IS FINISHED WHEN IT HAS TWO POINTS. Same exemption
    // `lineSpan` makes, for its reason: neither is built into the plaster.
    if (shapeRole !== 'cove') return covePen.pts.length >= 2;
    if (!openPenRoom || !pxPerFt) return false;
    const tolFt = Math.max(8, pxPerFt * 0.5) / pxPerFt;
    return penSpansOutline(covePen.pts, openPenRoom.geo.polygonPlanFt, tolFt);
  }, [openPenRoom, covePen.pts, pxPerFt, shapeRole]);

  /* --- WHAT THE PANEL SAYS WHILE A COVE IS BEING DRAWN ---------------------
     ONE OBJECT DESCRIBING THE STEP, so the branch that renders it is a layout
     and not a decision tree. Null whenever the tool is not open, which is what
     switches the step off.

     THE TWO OPEN COVES CARRY A PICTURE AND THE CLOSED ONES DO NOT — see
     SHAPE_GESTURE for why. Dragging out a rectangle is a marquee; what nobody
     can guess is that a line has to land on a wall at both ends. */
  const coveDraw = useMemo(() => {
    if (!shapeMenuOn || readOnly) return null;
    /* --- A GUIDE HAS NO STEP, AND THAT IS LOAD-BEARING --------------------
       WHAT A STEP DOES HERE IS EMPTY THE PANEL. Returning anything from this
       memo replaces the whole right-hand column — the tab strip, the header and
       the space detail with it — because a cove is a gesture the panel cannot
       help with and the cards are what it says instead.

       THE GEOMETRY BAR OPENS ON A SPACE CLICK, and that click's other half is to
       open that space in the panel: its height, its finishes, its Analysis. A
       step here would take all of it away again at the same instant — one
       gesture doing a thing and undoing it, and the more useful half would be
       the one that lost.

       THERE IS ALSO NOTHING TO SAY. The three cards below explain a COVE: where
       its ends have to land, what a pocket does to the grid, what gets built.
       A guide has no consequence to warn anybody about — it is a line on the
       ceiling and it goes where you draw it — and the bar on the drawing
       already shows the six primitives. Which of the two roles is live is on
       the rail, latched. */
    /* NO STEP CARD FOR A GUIDE OR A TRACK. The card explains a cove's
       CONSEQUENCES — where its ends have to land, what a pocket does to the
       grid, what gets built — and neither of the other two has any: a line goes
       where you draw it, and a profile is screwed to the ceiling you drew it on.
       The bar on the drawing already shows the six primitives. */
    if (shapeRole !== 'cove') return null;
    if (!shapeTool) {
      return { title: 'Pick a shape for the cove', art: null,
               hint: 'The bar on the drawing has the primitives.', why: '' };
    }
    if (shapeTool === 'line') {
      return {
        title: 'Span the cove from wall to wall',
        art: SHAPE_GESTURE.line,
        hint: 'Press on one wall and drag to another. Both ends land on the plaster. Shift squares it up.',
        why: lineSpan.why,
      };
    }
    if (shapeTool === 'pen') {
      return {
        title: 'Click out the cove',
        art: SHAPE_GESTURE.pen,
        // BOTH ENDINGS IN ONE SENTENCE, because the difference between them is
        // the difference between two details and the pen is the one tool that
        // can draw either.
        hint: covePen.isEmpty
          ? 'Click each corner, Shift to square. Close it on the first point for a pocket, or land on a wall at both ends for a run.'
          : canFinishOpen
            ? 'Close it on the first point for a pocket, or double-click to finish the run.'
            : 'Close it on the first point for a pocket. To finish it open, land on a wall.',
        why: '',
      };
    }
    return {
      title: `Drag out the ${SHAPE_BY_ID[shapeTool]?.label?.toLowerCase() ?? 'shape'}`,
      art: null,
      hint: 'Press on the ceiling and drag. The pocket runs round what you draw.',
      why: '',
    };
  }, [shapeMenuOn, shapeTool, readOnly, lineSpan.why, covePen.isEmpty, canFinishOpen,
      shapeRole]);

  /**
   * THE PATH AN ARRAY IS SET OUT ON, in plan pixels — geometry or room outline.
   * See `arrayOutlineFor`.
   */
  const arrayOutline = useCallback(
    (geomId) => arrayOutlineFor(geomId, { rooms, ceilingShapes, pxPerFt }),
    [ceilingShapes, rooms, pxPerFt]);

  /** THE SHAPE UNDER A POINT ON THE PLAN, if any. See `shapeUnderPoint`. */
  const shapeAtPointer = useCallback(
    (pPx) => shapeUnderPoint(ceilingShapes, pPx, pxPerFt), [ceilingShapes, pxPerFt]);

  /** ...AND WHETHER THE TOOL IN HAND WOULD ACTUALLY TAKE IT. See
   *  `takeableGeometry`. */
  const geomUnder = useCallback(
    (pPx) => takeableGeometry(shapeAtPointer(pPx),
                              { addTool, cobMode, shapeMenuOn, shapeRole }),
    [shapeAtPointer, addTool, cobMode, shapeMenuOn, shapeRole]);

  /* --- WHY A DRAWN RUN IS NOT ON THE PLAN — see `trackRefusals`. */
  const trackNotes = useMemo(
    () => trackRefusals({ pxPerFt, manualTracks, rooms, opt }),
    [pxPerFt, manualTracks, rooms, opt]);

  const trackNoteLines = useMemo(() => groupTrackRefusals(trackNotes), [trackNotes]);

  return {
    roomForSlot, lineSpan, shapeDraft, selShape, shapeMode,
    shapeToCommit, canCommitShape, heldAsks, openPenRoom, canFinishOpen,
    coveDraw, arrayOutline, shapeAtPointer, geomUnder,
    trackNotes, trackNoteLines,
  };
}

export default useGeometryDerivations;
