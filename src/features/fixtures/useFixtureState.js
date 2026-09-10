import { useCallback, useMemo, useState } from 'react';
import { idOf, idsOf, selectMany } from '../../lib/selection.js';
import { FAN_SWEEP_MM } from '../../lib/ceilingObjects.js';

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
  /* THE SWEEP THE NEXT FAN WILL BE, SEEDED FROM THE CATALOGUE and not written
     out here: the default is a fact about the product — see FAN_SWEEP_MM — and
     a second copy of it in the chrome is a copy that drifts. It is state
     because it is STICKY: set the bar to 1050 and the next three fans are
     1050 too, which is the same one-shot-tool-with-a-standing-choice the COB's
     wattage has. */
  const [fanSweepMm, setFanSweepMm] = useState(FAN_SWEEP_MM);

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

     ONE SPECIFICATION SLOT, AND THERE WERE THREE. `cobDraft` held what the
     slider was showing and governed nothing until one of two buttons promoted
     it — to `cobOnce` ("Update this", one lamp then gone) or to `cobStanding`
     ("Update all next"). All three lifetimes existed to answer a question the
     bar was asking and no longer asks: did you mean THIS lamp or every lamp
     from now on. A change made on a bar you opened in order to make it is not
     ambiguous, so it is the standing choice the moment it is made and the two
     buttons are gone — see CobSpec, and the handlers in App.

     `cobStanding` IS THE ONE THAT SURVIVED, and it is the one that had to: a
     draft that governs nothing is only useful when something can promote it,
     and a one-shot is only reachable through a button that no longer exists.
     Null means "ask the engine", which is the default and what the bar opens
     on; the Recommended chip is what puts it back, and so is putting the tool
     down — see `reset.cobGesture` for why an override does not outlive one
     arming of the tool. */
  const [cobOpen, setCobOpen] = useState(false);
  const [cobMode, setCobMode] = useState(null);
  const [cobStanding, setCobStanding] = useState(null);
  /* --- THE LAMPS PUT DOWN SINCE THE TOOL WAS PICKED UP, AND THEY ARE NOT
     TRACKED ANY MORE. This was a list of ids scoped to one arming of the tool,
     and the only thing that ever read it was the pair of controls at the end of
     the bar: a count ("Space 1 · 1 placed"), a tick that kept the run and a
     cross that took it off the drawing again.

     THE RUN WAS NEVER PENDING, WHICH IS WHY THEY WENT. A lamp is written
     through the reducer the moment it is clicked — on the drawing, in the
     analysis, in the schedule — deliberately, because a tool where twenty
     fittings are invisible until you confirm them is a tool you cannot judge a
     ceiling with. So the tick kept what was already kept, and the cross was an
     undo with a worse name, standing permanently on the bar and reaching back
     over as many lamps as the run held. Ctrl-Z is the undo, one lamp at a time
     and in the order they were placed, and it is the gesture everybody has.

     `cobLock` BELOW IS NOT THIS AND DID NOT GO WITH IT. That one is what stops
     the second lamp of a run landing in the next room, which is a rule about
     placing rather than a record of what was placed. */
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

     THE WAY TO THE NEXT ROOM IS TO PUT THE TOOL DOWN AND PICK IT UP. Escape,
     or the rail cell, or reaching for anything else: all of them run
     `disarmAdd`, which clears this along with the rest of the gesture, and the
     next press locks onto whichever ceiling it lands in. It used to be the
     tick's second job, and that button is gone — see the block above.

     NOT SAVED: it is a fact about a gesture in flight. */
  const [cobLock, setCobLock] = useState(null);
  /* THE ARRAY BEING SET UP, which is a gesture and not a record: which geometry
     is picked, and what the bar is currently asking about it. It becomes an
     entry in `cobArrays` when the tick is pressed, and is thrown away
     otherwise. */
  const [cobDraftArray, setCobDraftArray] = useState(null);
  /* --- THE ADJUSTABLE SPOT BETWEEN ITS TWO CLICKS --------------------------
     `{ xFt, yFt, roomId, aim }` OR NULL, and null is the ordinary state. The
     gesture is place-then-aim: the first click fixes the BODY, every pointer
     move afterwards turns it, and the second click locks the angle and writes
     the fitting. This is the fitting during the half of the gesture where its
     position is settled and its direction is not.

     A GESTURE AND NOT A RECORD, which is why it is here and not in the
     document. There is nothing to save: a spot half-aimed when somebody closes
     the tab is a spot nobody placed, and reopening the plan into the middle of
     a gesture would be a drawing asking a question its author has forgotten.
     `disarmAdd` clears it, so Escape and the rail put it away with the tool.

     `aim` IS SEEDED AND NOT LEFT NULL. The pointer is on the body at the
     instant of the first click, so there is no direction to compute from it —
     `atan2(0, 0)` is zero, which is at least a real angle — and a spot drawn
     with no arrow for the one frame before the pointer moves reads as the
     click having failed. */
  const [spotAim, setSpotAim] = useState(null);
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
  /* --- WHICH RUN'S DRAWER IS OPEN, AND WHY IT IS NOT `selTrackId` -----------
     A PRESS ON A RUN OPENS THE MODULE DRAWER, and being selected is not the
     same fact. `commitShape` selects the shape it has just landed — that is how
     the geometry bar becomes the new object's contextual menu — so a drawer
     following the selection alone would fly open the instant a track was drawn,
     over a run that has just been filled by the allocator and that nobody has
     asked to add anything to. What opens it is the ACT: hover the profile, see
     the plus, press it. See `shapePointerDown`, which is the one place that
     writes this, and the ToolRail call site, which reads it against
     `selTrackId` — so a selection moved elsewhere closes the drawer for free.
     NULL FOR A PRESS ON ANYTHING ELSE, which is why the write is unconditional
     rather than guarded at the call site: pressing a cove has to CLOSE this. */
  const [trackAdd, setTrackAdd] = useState(null);
  /* WHAT THE NEXT MODULE WILL BE, and it is the COB draft's idea said about a
     module: the specification has to be on screen at the moment of placing, not
     in a panel about a fitting already on the run. Null while nothing is armed;
     set to the module's own defaults when one is (see the ToolRail call site),
     which is what makes the bar an answer before it is a question. */
  const [moduleSpec, setModuleSpec] = useState(null);
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
    module: () => { setTrackMode(null); setModuleSpec(null); },
    /* THE COB BAR — `disarmAdd`'s half of this feature. `cobAt` is the point
       the bar was answering for, so it has to go with the tool, and `cobLock`
       is the ceiling this arming of it claimed.

       --- `cobStanding` GOES WITH THE TOOL NOW, AND IT USED TO SURVIVE --------
       THE ARGUMENT FOR KEEPING IT WAS THIS, and it is worth recording because it
       is a good argument that turns out to be answering the wrong question: a
       wattage set on the bar is a standing decision about this session's
       fittings rather than about this arming of the tool, so somebody who sets
       24 W, places four, reaches for the strip tool and comes back is still
       placing 24 W lamps — and having to say so again would make the control
       mean "the next few".

       WHAT BEATS IT IS THAT THE RECOMMENDATION IS PER CELL. `recommendCob` is
       asked about the ROOM AND THE POINT the pointer is over — the cell's size,
       the ceiling height, the room's own basis — so the engine's answer is not
       one figure for the session, it is a different figure in every space and
       often in every cell. A standing override therefore outlives the reason it
       was made: 24 W was right for the cell it was chosen over, and carrying it
       into a bathroom two spaces away silently discards an answer the engine was
       never asked to give. The bar reads out the figures in force, which is true
       and is no help — what it reads out is the override, so the recommendation
       is not on screen to disagree with.

       SO THE DEFAULT IS THE ENGINE'S, EVERY TIME THE TOOL IS PICKED UP, and an
       override is a decision about the run you are placing now. Setting 24 W and
       placing four is unaffected; the override survives every one of those
       clicks, because putting the tool DOWN is what clears it.

       THE ARRAY BEING SET UP GOES WITH THE TOOL for its own reason. It is a
       geometry picked and a count half-typed — a gesture, not a record — and one
       left behind would reappear over a different plan the next time the tool
       was armed. The arrays already PLACED are untouched: those are fittings. */
    cobGesture: () => {
      setCobAt(null); setCobLock(null);
      setCobStanding(null);
      setCobDraftArray(null);
    },
    /* THE HALF-AIMED SPOT, CLEARED WITH THE TOOL. Its own entry rather than a
       line in `cobGesture`, because the two are different tools: putting the
       COB down must not throw away a spot mid-aim and vice versa. `disarmAdd`
       calls both, which is right — it puts EVERY placer down. */
    spotGesture: () => setSpotAim(null),
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
    cobStanding, setCobStanding,
    cobLock, setCobLock, cobAt, setCobAt,
    cobDraftArray, setCobDraftArray,
    spotAim, setSpotAim,
    selArrayId, arrayDrag, setArrayDrag,
    trackMode, setTrackMode, trackAdd, setTrackAdd,
    moduleSpec, setModuleSpec,
    selModuleId, moduleDrag, setModuleDrag,
    selLightId, lightDrag, setLightDrag,
    reset,
  };
}
