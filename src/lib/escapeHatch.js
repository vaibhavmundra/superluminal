// ---------------------------------------------------------------------------
// escapeHatch.js — WHAT ESCAPE MEANS, EVERYWHERE, ONCE.
//
// Escape is the one key that has to work the same way on every screen: get me
// out of whatever I started. Somebody arms a fitting, changes their mind before
// placing it, and presses Escape — and that has to work whether the thing they
// armed was written last year or this morning.
//
// It used to be two hundred lines of branch chain in App.jsx plus seven
// components each binding their own window listener, one of them in CAPTURE
// with a stopPropagation to outrank the others. Ordering was emergent from bind
// order and phase, which is not an ordering anybody can read.
//
// --- THE RULE, IN ONE LINE -------------------------------------------------
//
//   Escape stands the whole editor down, UNLESS something has claimed it.
//
// That is the whole system. `standDown` is App's one function for "put every
// machine away"; a CLAIM is a process saying "I am mid-flow, this key is mine".
//
// --- WHY A STACK AND NOT A RANKING -----------------------------------------
//
// Its sister module pressOwner.js ranks its machines, because presses arrive at
// state where several owners can be set at once and precedence is the only way
// to settle it. Escape is not like that. Claims are pushed as processes BEGIN
// and popped as they end, so the order is chronological and the answer is
// always the same one: the last thing you started is the first thing you back
// out of. A stack says that; a ranking would need a number per claimant kept
// correct by hand.
//
// --- THE BROWSER NEVER SEES IT ---------------------------------------------
//
// Bound in CAPTURE on `window` and `preventDefault`ed unconditionally, because
// Safari does things with a bare Escape that have nothing to do with this app —
// leaving full screen, dismissing a native `<dialog>`, stopping page load. The
// capture phase is also what lets ONE listener replace the seven: nothing else
// gets the key, so nothing else has to be ordered against.
//
// THE ONE THING WE CANNOT STOP is Safari's own exit-from-fullscreen, which is
// not a cancelable event in every version. That is the browser's key and not
// ours; everything reachable from JavaScript is stopped here.
//
// --- TEXT ENTRY IS EXEMPT AND IT IS NOT A SPECIAL CASE ---------------------
//
// In a text field Escape means "revert what I typed in THIS box", which is a
// claim like any other — it is simply one the DOM makes for us. Those handlers
// sit on the input itself, so the guard is: if the key was aimed at a field,
// this module never saw it.
//
// PURE. No React, no JSX. The stack is a module-level array because there is
// one keyboard — see tools/test-escape.mjs.
// ---------------------------------------------------------------------------

/* --- CLAIMS AND SWEEPS, AND THE LINE BETWEEN THEM -------------------------
   TWO KINDS OF OPEN THING, and they want opposite treatment:

     A CLAIM is a MODAL — a dialog, a popover, a question standing in front of
     the app. Escape closes it AND STOPS THERE, because standing the whole
     editor down behind something somebody was only dismissing would be a press
     with two consequences, one of them invisible until the modal was gone.

     A SWEEP is CHROME — a rail flyout, a drawer, a menu. It is part of the
     editor rather than in front of it, so it goes WITH the stand-down: one
     press closes the drawer, disarms the tool and drops the selection, which is
     what "get me out of everything" means.

   The registry is here rather than in App because chrome lives all over the
   component tree, and a drawer three files deep cannot be closed by a function
   in App that has never heard of it. Both kinds register from where their state
   is, which is the only place that knows how to put it away. */

/** The live claims, oldest first. The last entry owns the next Escape. */
const claims = [];

/** The chrome to close whenever the editor stands down. Order is irrelevant. */
const sweeps = new Set();

/**
 * CLAIM ESCAPE FOR AS LONG AS A PROCESS IS RUNNING. Returns the release — call
 * it when the process ends, which for a React caller is the effect's cleanup.
 *
 * `handler` MAY DO NOTHING, and that is a real answer rather than a missing
 * one: "this flow does not exit on Escape" is exactly what some of them want to
 * say. What a claim always does is stop the stand-down.
 *
 * `label` is for tests and debugging only. Nothing branches on it.
 */
export function claimEscape(handler, label = '') {
  const entry = { handler, label };
  claims.push(entry);
  let released = false;
  return () => {
    // IDEMPOTENT. React can run a cleanup twice in StrictMode, and a release
    // that popped somebody else's claim the second time would be a process
    // silently losing its exemption.
    if (released) return;
    released = true;
    const i = claims.indexOf(entry);
    if (i >= 0) claims.splice(i, 1);
  };
}

/**
 * GIVE THE KEY TO WHOEVER IS ON TOP. True if somebody took it, false if the
 * stack is empty — and false is what means "stand the editor down".
 */
export function fireEscape() {
  const top = claims[claims.length - 1];
  if (!top) return false;
  top.handler?.();
  return true;
}

/**
 * CLOSE THIS PIECE OF CHROME WHENEVER THE EDITOR STANDS DOWN. Returns the
 * release, exactly as `claimEscape` does.
 *
 * A sweep does NOT stop the stand-down — that is the whole difference. An open
 * drawer is not a reason to keep a tool armed.
 */
export function sweepOnEscape(handler) {
  sweeps.add(handler);
  return () => { sweeps.delete(handler); };
}

/**
 * EVERY PIECE OF CHROME, CLOSED. Called by the hatch on its way into the
 * stand-down — never on a press a claim took.
 *
 * OVER A COPY, because a handler that unmounts its own component would
 * otherwise mutate the set we are walking.
 */
export function sweepEscape() {
  for (const fn of [...sweeps]) fn?.();
}

/** The labels, oldest first. Tests and debugging; nothing branches on it. */
export const escapeClaims = () => claims.map((c) => c.label);

/** How many pieces of chrome are registered. Tests and debugging. */
export const escapeSweepCount = () => sweeps.size;

/** Everything dropped. For tests and for tearing a plan down. */
export const resetEscapeClaims = () => { claims.length = 0; sweeps.clear(); };

/* --- TWO QUESTIONS ABOUT THE TARGET, AND THEY ARE NOT THE SAME ONE ---------
   The guard three handlers used to carry — a tagName regex here, a chain of
   `instanceof` there — asked "is this an INPUT, SELECT or TEXTAREA" and used
   the answer for everything. That is one question doing the work of two, and
   the seam is where ⌘Z went missing:

     A WATTAGE SLIDER IS AN `<input>`. Click the one in the COB bar and it keeps
     focus. The old guard saw INPUT, stood down, and every ⌘Z after that fell
     through to Safari — where ⌘Z is Undo Close Tab, so it reopened a tab
     instead of undoing an edit. The undo BUTTON kept working, which is what
     made it look like a keyboard problem rather than a focus one.

   A slider owns the arrow keys. It does not own ⌘Z, because there is no text in
   it to undo. So:

     isTextEntry     TEXT IS BEING TYPED HERE. It owns the text-editing keys,
                     ⌘Z among them — undoing your typing is what you meant.
     isFormControl   A CONTROL HAS FOCUS. Plain-key shortcuts stand off (⌫ must
                     not delete a room while a spinner is focused), but the
                     editor's ⌘-shortcuts still belong to the editor.

   Both take anything, including a plain object, so the rules are testable
   without a DOM. */

/** Input types where a person is typing TEXT, so the field owns ⌘Z. */
const TEXT_INPUT = new Set(['text', 'search', 'email', 'url', 'tel', 'password',
                            'number', 'date', 'time', 'datetime-local', 'month', 'week']);

const tagOf = (el) => (el && typeof el === 'object' && typeof el.tagName === 'string'
  ? el.tagName.toUpperCase() : '');

/**
 * IS TEXT BEING TYPED HERE? Then the field owns the text-editing keys, ⌘Z
 * included, and no handler of ours may look at them.
 *
 * NOT `<select>`, and not a slider, a checkbox, a radio or a colour well: those
 * are controls you operate rather than write in, and nothing in them is
 * undoable. THIS IS THE ⌘Z BUG — see the note above.
 */
export function isTextEntry(el) {
  const tag = tagOf(el);
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    // NO `type` MEANS TEXT. That is the HTML default and the browser's own.
    const type = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
    return TEXT_INPUT.has(type);
  }
  return el?.isContentEditable === true;
}

/**
 * DOES A FORM CONTROL HAVE FOCUS? Any of them — the question the old guard was
 * really asking, and the right one for keys with no modifier: `f` is a letter
 * in a name box, `⌫` is a character in a spinner, and neither may reach the
 * drawing.
 */
export function isFormControl(el) {
  const tag = tagOf(el);
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return el?.isContentEditable === true;
}
