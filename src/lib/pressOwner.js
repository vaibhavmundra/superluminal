// ---------------------------------------------------------------------------
// pressOwner.js — WHICH MACHINE OWNS THIS PRESS.
//
// The canvas has ONE pointer pipeline and seven machines that can own a press
// on it. The rule that arbitrates between them was a guard expression copied by
// hand into every handler that had to obey it, in variants that differed only
// by which terms they remembered:
//
//     if (addTool || zoneMode || armed) return
//     if (addTool || zoneMode || armed || boardPlace) return
//     if (addTool || zoneMode || armed || boardPlace || (shapeMenuOn && shapeTool)) return
//
// A variant missing one term is indistinguishable from a correct one by
// reading, and that is not a hypothetical: the track diffuser and the track
// spot were completely unplaceable because the shape tool's take-branch did not
// test `addTool`, so it swallowed every press aimed at a track. It was found by
// reading eight hundred lines of branch ordering, which is the wrong tool for
// the job. This is the rule in one place, as a function, with a truth table —
// see tools/test-press-owner.mjs.
//
// PURE. No React, no DOM, no events. It answers a question about STATE.
//
// --- THE PRECEDENCE, AND WHY EACH RANK IS WHERE IT IS ----------------------
//
// Read off the branch order of `onZoneDown` in App.jsx, which is the canvas's
// own pointerdown and the only place the order has ever actually existed. The
// reasons are the ones already stated inline there, carried across rather than
// paraphrased.
//
//   1. door   CONFIRMING THE DOORS OWNS THE WHOLE CANVAS. Before every other
//             branch, and it never falls through. This is a modal step — the
//             panel beside it holds one question and nothing else — so while it
//             is open a press on the plan cannot also select a space, arm a
//             fitting or start a no-light zone.
//
//   2. shape  DRAWING A COVE OWNS THE CANVAS TOO. Alongside the door editor
//             above and ahead of everything below it, for the same reason both
//             of those are where they are: while a primitive is armed a press
//             on the plan means one thing, and any path that lets a selection
//             or a ceiling object see it first is a path where the press does
//             two things.
//
//   3. board  THE SWITCHBOARD STEP OWNS THE CLICK OUTRIGHT, and it is the most
//             exclusive of the gestures below the two modal ones: while it is
//             open, a press on the plan means one thing and nothing else on the
//             canvas may see it. It does not disarm on a miss — the step's way
//             out is its Done button.
//
//   4. tool   AN ARMED TOOL OWNS THE NEXT CLICK, and any path that lets
//             selection or a ceiling object see it first is a path where the
//             click does two things.
//
//   5. object A ceiling-object gesture that started ON an object stopped the
//             event before it reached the canvas, so a press arriving here with
//             something armed hit the EMPTY ceiling: drop one, and disarm — the
//             way a shape tool returns to the pointer after you draw one shape.
//
//   6. zone   The last branch that claims anything. A no-light zone is boxed
//             over open ceiling and has nothing more specific to lose to.
//
//   7. grab   WHAT IS LEFT, and it is the whole of ordinary use: select a
//             space, pick up a fitting, drag a plate, let go of a selection.
//             Nothing on the drawing is grabbable while a tool is in hand.
//
// --- THE ONE THAT IS EASY TO GET WRONG ------------------------------------
//
// `shapeMenuOn` BEING TRUE DOES NOT MEAN THE SHAPE TOOL OWNS THE PRESS. The
// geometry bar stays open with no primitive armed — a rail cell and a space
// click both leave it that way — and in that state it owns nothing at all: the
// press falls straight through to the canvas, where it selects the space or
// lets go of a selection like any other press on bare plan. It is the LIVE
// primitive that means "I am about to place geometry". `shapeMenuOn && shapeTool`
// is the whole test, and the missing half of it is the diffuser bug.
//
// --- WHAT IS DELIBERATELY NOT IN HERE -------------------------------------
//
// `pxPerFt` AND `source` ARE NOT ARBITRATION. They ask "is there a drawing at
// all", which is a different question with a different answer when it fails —
// nothing happens, rather than somebody else's machine taking the press. They
// stay as their own checks at the call sites, next to this one.
//
// `objMode` AND `selAccId` reach `onZoneDown`'s object branch alongside `armed`,
// and they are not owners: with nothing armed that branch only CLEARS the
// selection, which is what a press on bare plan does anyway. Ranking them here
// would turn "a fan is selected" into a mode that swallows presses — which is
// exactly the bug `onCanvasClick` documents having removed.
//
// `dragging` IS ACCEPTED AND DELIBERATELY NOT RANKED. A gesture already in
// flight owns the pointer until it is released — but that rule is enforced by
// the branch order of the MOVE handler (`onZoneMove`), not by the press, and
// `onZoneDown` does not test it. Ranking it here would withhold the very
// handlers a drag in flight depends on. It is in the signature because callers
// have it and because the next person will look for it here; it changes no
// answer.
// ---------------------------------------------------------------------------

/** The roster. Every press on the canvas belongs to exactly one of these. */
export const MACHINES = ['door', 'board', 'zone', 'object', 'tool', 'shape', 'grab'];

/**
 * THE ORDER, HIGHEST FIRST — and it is not the roster's order, because the
 * roster is a list of names and this is a ranking. Read off `onZoneDown`.
 * `grab` is last and unconditional, which is what makes the answer total.
 */
export const PRECEDENCE = ['door', 'shape', 'board', 'tool', 'object', 'zone', 'grab'];

/**
 * WHICH MACHINE OWNS A PRESS IN THIS STATE. Always exactly one entry of
 * `MACHINES`, never null: a press that no machine claims is a press on bare
 * plan, and that is `grab`'s.
 *
 * `readOnly` IS A VETO AND NOT A MACHINE. A viewer may not edit, so nothing on
 * the sheet is grabbable — but the drawing still belongs to nobody in
 * particular, so the answer is still `grab` and the call sites keep their own
 * `readOnly` term. It is not in this signature for that reason.
 */
export function pressOwner({ doorEdit = false, boardPlace = false, zoneMode = false,
                             armed = null, addTool = null, shapeMenuOn = false,
                             shapeTool = null,
                             // Accepted, deliberately not ranked — see the note above.
                             dragging = false } = {}) {
  if (doorEdit) return 'door';
  // THE BAR OPEN IS NOT THE TOOL ARMED. See the note above; this line is the bug.
  if (shapeMenuOn && shapeTool) return 'shape';
  if (boardPlace) return 'board';
  if (addTool) return 'tool';
  if (armed) return 'object';
  if (zoneMode) return 'zone';
  return 'grab';
}

/** Does `machine` own the press in this state? */
export const owns = (state, machine) => pressOwner(state) === machine;

/**
 * IS ANYTHING ON THE DRAWING GRABBABLE RIGHT NOW? The question every fitting's
 * press handler and every withheld prop is actually asking. Nothing is, while a
 * tool is in hand.
 */
export const canGrab = (state) => pressOwner(state) === 'grab';
