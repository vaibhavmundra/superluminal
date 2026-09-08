import { useCallback, useMemo, useState } from 'react';
import { idOf, idsOf, selectMany } from '../../lib/selection.js';

/**
 * THE FITTING SESSION — everything about placing and manipulating a fixture
 * that does NOT survive a reopen, and the reads of the selection register that
 * are this feature's.
 *
 * THE FEATURE'S FIRST CALL SITE, AND IT IS EARLY BECAUSE `pressState` IS.
 * `armed` — the ceiling-object one-shot — is one of the seven machines in the
 * arbitration table (see lib/pressOwner.js), and that memo is built three
 * hundred lines below the state it reads; `resetForNewPlan` calls four of the
 * resets below that. A hook's arguments are evaluated during render, so the
 * session is asked for on its own, here, and the rest of the domain is composed
 * four times more further down. Same split `useGeometryState` and
 * `useBoardStep` make.
 *
 * NOTHING HERE IS THE DOCUMENT'S. `manualCobs`, `cobArrays`, `trackFixtures`,
 * `ceilingObjs`, `lightMoves` and `autoSpots` are all `usePlanDoc`'s and stay
 * there; what is held here is which drawer is open, which gesture is armed,
 * which specification the next click will use, which run the current row of
 * lamps belongs to, and the five drags in flight. A plan reopened holding any
 * of it would be a plan reopened mid-gesture.
 *
 * THE SELECTION REGISTER IS APP'S AND IS PASSED IN. There is one on this canvas
 * — see lib/selection.js — and six of its kinds are this feature's, so the
 * READS are here and the register is not. Same reason `selShapeId` stays in App
 * for the geometry feature: one store, many domains.
 */
export default function useFixtureState({ sel, setSel }) {
  // --- things already on the ceiling ---------------------------------------
  // THE ONLY LIST OF THEM, NOW. There used to be two: this one, and whatever the
  // red-circle detector found. That detector is gone — see the note in
  // settings.js — and with it the last reason for a fan to exist in two places
  // measured in two units.
  //
  // These are held in FEET. A fan the detector found has to be pixels because
  // that is all it knows; an object someone placed is a real thing of a real
  // size, and feet is what keeps it that size when the scale is corrected
  // underneath it.
  //
  // To the planner they are all one thing — see ceilingObjects.js.
  const [objType, setObjType] = useState('fan');
  const [fanSweepMm, setFanSweepMm] = useState(1200);

  /* THE SELECTION IS A LIST FOR CEILING OBJECTS, because Shift-clicking builds
     one, and they are the only kind that can be several — see `selectMany`.

     `selObjId` IS THE PRIMARY — the most recently added — and it is what the
     property panels read. "What sweep is this fan?" and "is this an AC or a
     trapdoor?" are questions about ONE object, and with three selected the
     honest answer is the one you touched last; the CHANGE those panels make is
     applied to everything selected of the right kind, which is what a
     properties panel does everywhere else.

     THERE IS NO `setSelObjId` ANY MORE and it is not missed. It existed to say
     "this one object and nothing else" in one call; `select('object', id)` is
     that sentence, and it says the "nothing else" part about the whole canvas
     rather than about this list. */
  const selObjIds = idsOf(sel, 'object');
  const selObjId = idOf(sel, 'object');
  /** Add an object to the selection, or take it out if it is already in. */
  const toggleSelObj = useCallback((id) => setSel((cur) => {
    const ids = idsOf(cur, 'object');
    return selectMany('object',
      ids.includes(id) ? ids.filter((q) => q !== id) : [...ids, id]);
  }), [setSel]);
  const [objDrag, setObjDrag] = useState(null);   // {id, mode, ...} while dragging

  // TWO SEPARATE THINGS, and conflating them was half of why this felt wrong.
  //
  // `objMode` is the editing CONTEXT: handles are shown, objects can be picked
  // up. `armed` is a one-shot — the next click on empty ceiling drops an object
  // of that type, and then it disarms itself.
  //
  // One flag could not be both. It meant the tool that let you MOVE something
  // was the same tool that placed a new one on any click, so a click that
  // missed by a pixel added an object instead of selecting one.
  const [objMode, setObjMode] = useState(false);
  const [armed, setArmed] = useState(null);       // a type id, or null
  const [ghost, setGhost] = useState(null);       // where an armed object would land

  /* WHICH ONE IS PICKED, so Delete has something to act on. Its own selection
     and not `selAccId`: an accent zone is a strip or a sconce out of the accent
     machinery, and filing a COB in that list would mean Delete looking for it in
     three stores that have never heard of it. */
  const selCobId = idOf(sel, 'cob');

  /* --- THE COB DRAWER, AND WHAT THE NEXT LAMP WILL BE ------------------------
     ALL TRANSIENT. None of this is saved: it is which cell of the rail is open,
     which of its gestures is armed, and the specification the next click will
     use — and a plan reopened holding a half-made intention would be a plan that
     places a lamp somebody decided about last week.

     THE THREE SPECIFICATION SLOTS ARE THREE DIFFERENT LIFETIMES, which is the
     whole of the two buttons on the card:

       cobDraft     what the slider and the chips are showing. It has no effect
                    on anything until one of the buttons is pressed, which is
                    what makes dragging the slider free.
       cobOnce      "Update this" — one lamp, then gone.
       cobStanding  "Update all next" — every lamp from now until it is cleared
                    by the Recommended chip.

     Null in all three means "ask the engine", which is the default and the thing
     the card opens on. */
  const [cobOpen, setCobOpen] = useState(false);
  const [cobMode, setCobMode] = useState(null);
  const [cobDraft, setCobDraft] = useState(null);
  const [cobOnce, setCobOnce] = useState(null);
  const [cobStanding, setCobStanding] = useState(null);
  /* --- THE LAMPS PUT DOWN SINCE THE TOOL WAS PICKED UP -----------------------
     A LIST OF IDS, AND IT IS WHAT THE TICK AND THE CROSS ON THE BAR ACT ON.
     Placing is immediate — a lamp appears the moment it is clicked, it is on the
     drawing, it is in the analysis — and that is deliberate: a tool where twenty
     fittings are invisible until you confirm them is a tool you cannot judge the
     ceiling with. What the two buttons decide is whether the RUN stays.

     SCOPED TO THIS ARMING OF THE TOOL AND NOT TO THE PLAN, which is the whole
     safety of the cross. "Reject all placements" has to mean the ones just made,
     not every COB anybody ever placed on this drawing — a button that could take
     out last week's work in one press does not belong beside a button you press
     twenty times a minute. Cleared when the tool is put down, so the next run
     starts empty and the cross can never reach back past it.

     NOT SAVED. It is a fact about a gesture in flight, and a plan reopened
     holding one would offer to throw away lamps from a session that ended. */
  const [cobRun, setCobRun] = useState([]);
  /* --- THE SPACE THE RUN BELONGS TO -----------------------------------------
     SET BY THE FIRST LAMP AND HELD UNTIL THE RUN ENDS. Placing a downlight is
     not really an act on a POINT — it is an act on a CEILING: the recommendation
     comes from that ceiling's cells, the analysis that has to move while you
     work is that space's, and the row of lamps you are lining up is a row in one
     room. A run that wandered across a doorway would be one gesture editing two
     spaces, with the panel able to show only one of them.

     SO THE FIRST PRESS CHOOSES THE ROOM AND THE REST OF THE RUN IS INSIDE IT.
     Clicks on any other ceiling place nothing — and, more importantly, SAY they
     will place nothing before they are spent: the pointer goes back to an arrow,
     the ghost lamp and the guides come off, and the bar stops answering for
     wherever the cursor is. A rule you discover by pressing is a bug; a rule the
     cursor states is a boundary.

     THE WAY TO THE NEXT ROOM IS THE TICK, which is what gives that button its
     second job. Keep the run, and the tool re-arms unlocked on the next press;
     the cross does the same having thrown the run away. Both were already the
     way out — this is what they are the way out OF.

     NOT SAVED, like `cobRun` beside it: it is a fact about a gesture in flight. */
  const [cobLock, setCobLock] = useState(null);
  /* THE ARRAY BEING SET UP, which is a gesture and not a record: which geometry
     is picked, and what the bar is currently asking about it. It becomes an
     entry in `cobArrays` when the tick is pressed, and is thrown away
     otherwise. */
  const [cobDraftArray, setCobDraftArray] = useState(null);
  /* --- THE ARRAY THAT IS OPEN ------------------------------------------------
     ITS OWN SELECTION, beside `selCobId` rather than inside it, and the reason
     is what a press on one of its lamps MEANS. A hand-placed COB is a fitting
     and clicking it selects that fitting; an array lamp is not a fitting at all
     — it is one of twelve consequences of a count and an offset, and there is
     nothing about it on its own that anybody can change. So the press has to
     resolve to the ARRAY, and the bar it opens has to be the array's.

     WHICH IS ALSO WHY IT CANNOT BE FILED UNDER `selCobId`. That id is looked up
     in `manualCobs` by Delete, by the analysis highlight and by the drag — three
     lookups that would all miss, because an array's lamps are a memo (see
     `arrayCobsPx`) and were never in that store.

     TRANSIENT. A selection is a fact about what somebody is looking at. */
  const selArrayId = idOf(sel, 'array');
  /* THE ARRAY BEING CARRIED, for one press. Same snapshot-at-the-press rule
     every other drag on this canvas follows — see rule 2 in lib/dragMove.js.
     DECLARED HERE AND HANDED TO hooks/useDrag.js rather than held inside it,
     because `deleteArray` has to be able to abandon a gesture carrying the run
     it is removing, and it is a `useCallback` two thousand lines above the
     hook. See the note on `state` there. */
  const [arrayDrag, setArrayDrag] = useState(null);
  /* WHERE THE POINTER IS ON THE PLAN, and only that. It is what the
     recommendation and the two warnings are computed from — the bar that shows
     them is pinned to the foot of the stage and needs no position of its own,
     which is the whole of why this is one point rather than two. See CobSpec for
     the card at the cursor that this replaced and why it could not work.
     NULL OFF THE CEILING, so the guides draw nothing out there and the engine
     falls back to the catalogue. */
  const [cobAt, setCobAt] = useState(null);

  /* THE DRAWER, AND WHICH MODULE IS ARMED. Transient, exactly as the COB's two
     are: which cell of the rail is open and what the next press will clip in.
     There is no `trackOpen` beside it any more: the rail cell's latch is the
     geometry bar's own role (`shapeRole === 'track'`) and the drawer follows the
     SELECTED RUN, so both were state that had to be kept in step with something
     already true. See the cell at the ToolRail call site. */
  const [trackMode, setTrackMode] = useState(null);
  /* WHICH MODULE IS HELD, AND THE SLIDE IN FLIGHT.
     A DIFFUSER THE ALLOCATOR PUT DOWN IS A PROPOSAL AND NOT A DECISION — it
     answered "how much light" from the room's shortfall and "where" from the
     geometry, and neither of those is a claim about the console being under it.
     So it has to be movable, and the only direction it CAN move is along the run:
     a module clips anywhere on a profile and nowhere across one. That is why the
     drag writes a fraction rather than a point. */
  const selModuleId = idOf(sel, 'module');
  const [moduleDrag, setModuleDrag] = useState(null);

  /* WHICH LIGHT IS PICKED, as `${outlineId}|${cellKey}` — the same pairing the
     store is keyed on, flattened, because a selection is one value. */
  const selLightId = idOf(sel, 'light');
  const [lightDrag, setLightDrag] = useState(null);
  /* NOTHING HERE REMEMBERS WHETHER THE DRAG MOVED, AND A REF USED TO. A press
     on a light does NOT capture the pointer (see `lightPointerDown`), so a
     release that lands back on the fitting produces a click on the fitting —
     which opens the pill, exactly as it always did — and a release that lands
     anywhere ELSE produces a click on the canvas. That second click was being
     read as "a press on empty plan" and dropping the selection, so the drop
     recorded that it had happened and `onCanvasClick` consumed the flag.
     THE CANVAS ANSWERS IT NOW, FOR EVERY GESTURE AT ONCE. `lightPointerDown`
     stops the press, so the press never reaches the <svg>'s own handler, so
     `barePress` in App.jsx is false and the click is not one on the plan —
     however far the pointer travelled before it was let go. */

  /* --- THE FOUR RESETS, AND WHY THEY ARE FOUR ------------------------------
     `resetForNewPlan` and `disarmAdd` do NOT run these statements together:
     the objects go in one block with `clearObjects`, the light drag twenty
     lines below with `clearLightMoves`, the armed one-shot below that, and the
     module block with `clearTrackFixtures`. App calls each where the statements
     it replaces stood, so the reducer sees the same dispatches in the same
     order, and the `docActions.clear*` halves stay at the call site beside them
     — the document boundary is not crossed from inside the session.

     MEMOISED for the reason `usePen` memoises its own return, quoted there: a
     fresh object every render makes `resetForNewPlan` — which names it in its
     dependency array — a fresh callback every render too, and that one is
     handed to `usePlanSource`. */
  const reset = useMemo(() => ({
    objects: () => { setObjMode(false); setObjDrag(null); },
    lightMoves: () => setLightDrag(null),
    armed: () => { setArmed(null); setGhost(null); },
    module: () => setTrackMode(null),
    /* THE COB BAR AND THE HALF-MADE CHANGE ON IT — `disarmAdd`'s half of this
       feature. `cobAt` is the point the bar was answering for, so it has to go
       with the tool; `cobDraft` is a slider position nobody committed and
       `cobOnce` was aimed at a lamp that is no longer about to be placed.
       `cobStanding` DELIBERATELY SURVIVES. "Update all next" is a standing
       decision about this session's fittings, not about this arming of the tool
       — somebody who sets 24 W, places four, reaches for the strip tool and
       comes back is still placing 24 W lamps, and having to say so again would
       make the button mean "update the next few". The card says which is in
       force every time it opens, so nothing is hidden.
       THE ARRAY BEING SET UP GOES WITH THE TOOL. It is a geometry picked and a
       count half-typed — a gesture, not a record — and one left behind would
       reappear over a different plan the next time the tool was armed. The
       arrays already PLACED are untouched: those are fittings. */
    cobGesture: () => {
      setCobAt(null); setCobDraft(null); setCobOnce(null);
      setCobRun([]); setCobLock(null);
      setCobDraftArray(null);
    },
  }), []);

  /* LISTED MEMBER BY MEMBER RATHER THAN SPREAD, so a reader can see exactly
     what the session is. `armed` — the ceiling-object one-shot — is one of the
     seven machines `pressState` arbitrates between; see lib/pressOwner.js. */
  return {
    objType, setObjType, fanSweepMm, setFanSweepMm,
    selObjIds, selObjId, toggleSelObj,
    objDrag, setObjDrag, objMode, setObjMode,
    armed, setArmed, ghost, setGhost,
    selCobId,
    cobOpen, setCobOpen, cobMode, setCobMode,
    cobDraft, setCobDraft, cobOnce, setCobOnce, cobStanding, setCobStanding,
    cobRun, setCobRun, cobLock, setCobLock, cobAt, setCobAt,
    cobDraftArray, setCobDraftArray,
    selArrayId, arrayDrag, setArrayDrag,
    trackMode, setTrackMode, selModuleId, moduleDrag, setModuleDrag,
    selLightId, lightDrag, setLightDrag,
    reset,
  };
}
