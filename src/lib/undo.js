// ---------------------------------------------------------------------------
// undo.js — Ctrl+Z for the whole editor, as a stack of saved plans.
//
// THE IDEA IS ONE LINE LONG BECAUSE planState.js ALREADY DID THE WORK. This app
// can already turn its sixty pieces of useState into one plain object
// (`serialiseEditor`) and put a person back exactly where they were from one
// (`applyEditor`) — that is what the database column is. An undo stack is the
// same pair pointed at memory instead of at Postgres: keep the object from
// before the change, and apply it.
//
// SO THERE IS NO COMMAND PATTERN HERE, and that is deliberate rather than lazy.
// The alternative — every mutation paired with its inverse — means forty
// handlers each carrying a second implementation of itself, and the day one of
// them is written wrong the app silently corrupts a plan while claiming to
// restore it. Snapshots cannot be wrong about the past: a snapshot IS the past.
// What they cost is memory, and the whole document is a few tens of kilobytes
// of JSON, of which the largest part is the model's own answers.
//
// WHAT AN UNDO STEP IS, AND WHY IT IS NOT "ONE STATE CHANGE".
//
// A drag emits state on every pointermove. Recorded literally, dragging one
// sconce four feet would fill the stack with forty steps that each move it an
// inch, and Ctrl+Z would stop meaning anything a person can predict. A step is
// therefore A GESTURE: changes are coalesced until the editor goes quiet for
// QUIET_MS, and the state from BEFORE the burst is what gets pushed. One drag,
// one undo. One click, one undo.
//
// AND THE VIEWPORT IS NOT PART OF IT. Zoom, pan, which layers are on, which
// space is selected — these are in the saved document because reopening a plan
// should put you back where you were looking, and they are excluded here for
// exactly the same reason: Ctrl+Z is asked by somebody who has just made a
// mistake, and scrolling is not one. So a pan does not consume an undo step,
// and undoing a real change does not throw the view somewhere else. See
// VIEW_FIELDS.
//
// PURE. No React. A history is a plain object the caller keeps in a ref.
// ---------------------------------------------------------------------------

/** How many steps back. Forty gestures is more than anybody re-does by hand. */
export const HISTORY_LIMIT = 40;

/**
 * HOW LONG THE EDITOR MUST BE QUIET FOR A BURST TO COUNT AS FINISHED, in ms.
 *
 * Long enough that the frames of one drag are one step, short enough that two
 * deliberate clicks are two steps. 400 ms is about the gap between a person
 * finishing a gesture and starting the next one; it is also short enough that
 * an undo pressed immediately after a change still has that change recorded.
 */
export const QUIET_MS = 400;

/**
 * THE FIELDS AN UNDO NEITHER NOTICES NOR RESTORES.
 *
 * `savedAt` is in here because it is a timestamp stamped on every
 * serialisation: without it every document would differ from every other one
 * and the stack would fill with steps that changed nothing.
 *
 * The rest are the viewport and the selection — see the header. They are top
 * level keys of the serialised document, except the three under `ui`, which are
 * listed as `ui.*` and handled by `strip`.
 */
export const VIEW_FIELDS = ['savedAt', 'focusId', 'selectedOutlineId', 'roomState',
                            'ui.layers', 'ui.zoom', 'ui.view'];

/** The document reduced to the part an undo is about. */
export function substantive(doc, ignore = VIEW_FIELDS) {
  if (!doc) return null;
  const out = { ...doc };
  const ui = { ...(out.ui ?? {}) };
  for (const f of ignore) {
    if (f.startsWith('ui.')) delete ui[f.slice(3)];
    else delete out[f];
  }
  out.ui = ui;
  return out;
}

/**
 * Are these two documents the same plan?
 *
 * STRINGIFY, AND IT IS THE RIGHT TOOL HERE. A key-by-key comparison would have
 * to know the shape of the document, which is the one thing this file
 * deliberately does not know — planState.js owns that, and a second opinion
 * about which fields matter is how the two drift apart. The cost is one pass
 * over a few tens of kilobytes, paid once per gesture and not per frame, which
 * is why the caller debounces before asking.
 */
export function sameDoc(a, b, ignore = VIEW_FIELDS) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(substantive(a, ignore)) === JSON.stringify(substantive(b, ignore));
}

/** A fresh, empty history. `base` is the document as it stands right now. */
export const newHistory = (base = null) => ({ past: [], future: [], base });

/** What the UI needs to know: whether either arrow is live. */
export const historyDepth = (h) => ({ past: h?.past.length ?? 0,
                                      future: h?.future.length ?? 0 });

/**
 * Record that the editor has settled on `doc`.
 *
 * The BASE — the document as it was before this burst — is what goes on the
 * stack, because that is the state Ctrl+Z has to return to. Returns true when a
 * step was actually recorded, so the caller can refresh a counter without
 * guessing.
 *
 * A NEW CHANGE DISCARDS THE REDO STACK, which is the ordinary contract of every
 * undo in every editor: once you have branched, the branch you did not take is
 * gone. Keeping it would mean a redo that reapplies a change made to a document
 * that no longer exists.
 */
export function record(h, doc, ignore = VIEW_FIELDS) {
  if (!h) return false;
  if (h.base == null) { h.base = doc; return false; }
  if (sameDoc(h.base, doc, ignore)) { h.base = doc; return false; }
  h.past.push(h.base);
  if (h.past.length > HISTORY_LIMIT) h.past.shift();
  h.future = [];
  h.base = doc;
  return true;
}

/**
 * One step back. Returns the document to apply, or null when there is nothing
 * to go back to.
 *
 * `current` is where the editor is now, and it goes onto the redo stack — not
 * `base`, which is the same thing by the time this is called, but taking it
 * from the caller means undo works even if a burst is still in flight.
 */
export function stepBack(h, current) {
  if (!h?.past.length) return null;
  const doc = h.past.pop();
  h.future.push(current);
  h.base = doc;
  return doc;
}

/** One step forward, on the same terms. */
export function stepForward(h, current) {
  if (!h?.future.length) return null;
  const doc = h.future.pop();
  h.past.push(current);
  if (h.past.length > HISTORY_LIMIT) h.past.shift();
  h.base = doc;
  return doc;
}
