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

/** Everything the canvas can have picked. */
export const SELECTION_KINDS = ['object', 'cob', 'array', 'module', 'light',
  'shape', 'board', 'flow', 'spot', 'acc', 'door'];

/**
 * WHICH KINDS CAN BE SEVERAL, AND WHY IT IS NOT ALL OF THEM.
 *
 * The register has always been able to HOLD a list — `selectMany` never cared
 * what kind it was given. What decides this list is the other half of a
 * multi-selection: whether the things can be DRAGGED as a group, because a
 * selection you can gather and then not move is a gesture that half works.
 *
 * The three here are the ones whose drag is already list-shaped: it takes
 * `members`, applies the same delta to each, and writes the lot back through
 * one list action (`updateCobs`, `updateArrays`, and the ceiling objects' own).
 * Adding a member to those is a change to the SELECTION and to nothing else.
 *
 * DELIBERATELY OUT, and each for its own reason rather than for want of effort:
 *
 *   light   is not a placed thing. It is one cell's share of a room's ambient
 *           level, and its drag commits ONE `moveLight(roomId, cellKey, dx, dy)`
 *           after clamping against the other lights in THAT room. A group
 *           spanning two rooms has no such call, and clamping members
 *           independently would let half a selection move and half refuse.
 *   module  rides a track at a parameter along it, through the point gesture
 *           rather than the list one. Several modules on one run share a
 *           constraint — they cannot pass through each other — so a group slide
 *           is a different gesture, not a bigger one.
 *
 * Both stay single, and a press on one clears any group rather than joining it.
 */
export const MULTI_KINDS = ['object', 'cob', 'array'];

/** Can this kind be held as several? */
export const isMultiKind = (kind) => MULTI_KINDS.includes(kind);

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
 * PICK SEVERAL — see MULTI_KINDS for which kinds this is offered for.
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

/**
 * ADD ONE TO THE SELECTION, OR TAKE IT OUT AGAIN — the Cmd-click gesture.
 *
 * THREE CASES, AND THE MIDDLE ONE IS THE WHOLE POINT.
 *   a different kind is held  the register replaces, exactly as `select` does.
 *                             Nothing can hold two kinds at once and this is
 *                             not the exception to that.
 *   the same kind is held     the id goes in if it is out and comes out if it
 *                             is in. This is the gesture.
 *   the last one comes out    the register clears. A selection of nought is
 *                             nothing picked — see `selectMany`.
 *
 * A KIND THAT CANNOT BE SEVERAL JUST SELECTS. Cmd-clicking a light or a module
 * picks that one thing, which is what the modifier would have done anyway if it
 * were not held. Refusing the press instead would make the key feel broken on
 * the two kinds where the answer is simply "one at a time".
 *
 * THE ORDER IS PRESERVED AND THE NEWEST GOES LAST, because `selectMany` takes
 * the last as the primary and the panels read the primary: with three picked,
 * "what wattage is this?" is honestly about the one you touched last.
 */
export function toggle(sel, kind, id) {
  assertKind(kind);
  if (id == null) return sel ?? NONE;
  if (!isMultiKind(kind)) return select(kind, id);
  if (!sel || sel.kind !== kind) return select(kind, id);
  const has = sel.ids.includes(id);
  const next = has ? sel.ids.filter((q) => q !== id) : [...sel.ids, id];
  return selectMany(kind, next);
}

/**
 * WHAT A PRESS ON `id` SHOULD DRAG — the group if it is one of them, else just
 * it. One rule, because it was about to be written out at three press handlers
 * and the three would have drifted.
 *
 * IT TAKES THE IDS AND NOT THE REGISTER, because that is what the press
 * handlers have: each reads its own `idsOf(sel, kind)` once, at the top of the
 * feature, and `idsOf` already answers EMPTY for a kind the register is not
 * holding — so the kind check this used to make was being made twice.
 *
 * PRESSING A MEMBER DRAGS ALL OF IT; pressing anything else makes that one
 * thing the selection. That is what makes a multi-selection worth having, and
 * it is also what stops a stale one biting: a press on something outside the
 * group replaces the group rather than moving a set nobody is thinking about
 * any more.
 */
export function groupFor(ids, id) {
  if (id == null) return [];
  const held = ids ?? [];
  return held.includes(id) ? held : [id];
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
