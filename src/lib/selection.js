// ---------------------------------------------------------------------------
// selection.js — WHAT IS PICKED ON THE CANVAS, as one value.
//
// ONE SELECTION ON THIS CANVAS IS A RULE, AND IT USED TO BE A HABIT. Eleven
// pieces of useState held it — a COB, an array, a module, a light, a shape, a
// plate, a wire, a spot, an accent, a door, and the multi-selection of ceiling
// objects — and every handler that picked one of them was responsible for
// putting the other ten away by hand. Ninety-six sites did that, which means
// ninety-six chances to miss one; the twelfth selectable thing would have been
// ninety-six more. It shipped: two contextual bars stood on the drawing at once
// because a shape selection outlived the press that should have cleared it.
//
// SO THE REGISTER HOLDS AT MOST ONE KIND, and nothing can hold two. `select`
// does not clear the others as a courtesy — it REPLACES the register, so there
// is nowhere for a second selection to be. That is the whole of the idea, and
// it is why this is a value rather than a helper the handlers call: a rule the
// code cannot express is a rule somebody has to remember.
//
// AN UNKNOWN KIND THROWS. A typo in a kind name would otherwise select nothing
// and clear everything, which looks exactly like a click on empty plan — the
// most expensive kind of silence, because the gesture appears to work.
//
// TWO THINGS HERE EXIST FOR THE CALLER'S RE-RENDERS RATHER THAN FOR THE MODEL.
// `clear()` answers with the shared NONE and the functional forms answer with
// the register they were handed, so a clear that changes nothing is the same
// value and React stops there; `idsOf` answers with the STORED array or with
// one shared empty, never a fresh copy, because it is read every render and
// feeds dependency arrays that would otherwise churn on every frame.
//
// NOT IN HERE, AND THEY ONLY LOOK LIKE THEY BELONG: the tracer screen's
// `selectedOutlineId`, which is a different screen with a lifetime of its own
// and survives across canvas selections; and `selTrackPt`, which is a point
// INSIDE an open track editor — a sub-selection of something already picked,
// not a thing on the canvas competing for the register.
// ---------------------------------------------------------------------------

/** Everything the canvas can have picked. 'object' is the only multi kind. */
export const SELECTION_KINDS = ['object', 'cob', 'array', 'module', 'light',
  'shape', 'board', 'flow', 'spot', 'acc', 'door'];

/* ONE SHARED EMPTY ARRAY, so `idsOf` on a register of the wrong kind is the
   same reference every time it is asked. */
const NO_IDS = Object.freeze([]);

/** Nothing picked. The one value a cleared register ever takes. */
export const NONE = Object.freeze({ kind: null, id: null, ids: NO_IDS });

function assertKind(kind) {
  if (!SELECTION_KINDS.includes(kind)) {
    throw new Error(`selection: unknown kind ${JSON.stringify(kind)}`);
  }
}

/**
 * PICK ONE THING, which is also the act of dropping whatever was picked before.
 * A null id is a clear: every call site that used to write `setSelCobId(null)`
 * means the register is empty, not that the register is holding a cob of no id.
 */
export function select(kind, id) {
  assertKind(kind);
  if (id == null) return NONE;
  return { kind, id, ids: [id] };
}

/**
 * PICK SEVERAL, and only ceiling objects can be several — see `selObjIds` in
 * App.jsx for why Shift-clicking builds a list there and nowhere else.
 *
 * THE PRIMARY IS THE LAST ONE ADDED, because that is what the property panels
 * read: "what sweep is this fan?" is a question about ONE object, and with
 * three picked the honest answer is the one you touched last.
 *
 * AN EMPTY LIST IS NOTHING PICKED, not a register holding a kind with no
 * members — a selection of nought objects is what Escape leaves behind.
 */
export function selectMany(kind, ids) {
  assertKind(kind);
  const list = ids ?? [];
  if (!list.length) return NONE;
  return { kind, id: list[list.length - 1], ids: list };
}

/** Nothing picked. */
export function clear() {
  return NONE;
}

/** The picked id IF the register is holding that kind, and null otherwise. */
export function idOf(sel, kind) {
  assertKind(kind);
  return sel && sel.kind === kind ? sel.id : null;
}

/** The picked ids IF the register is holding that kind, and empty otherwise. */
export function idsOf(sel, kind) {
  assertKind(kind);
  return sel && sel.kind === kind ? sel.ids : NO_IDS;
}

/** Is this exact thing picked? */
export function isSelected(sel, kind, id) {
  assertKind(kind);
  if (!sel || sel.kind !== kind || id == null) return false;
  return sel.ids.includes(id);
}
