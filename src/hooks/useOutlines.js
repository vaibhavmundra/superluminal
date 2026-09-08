import { useCallback, useRef } from 'react';
import { makeOutline, nextOutlineName } from '../lib/outline.js';

// ---------------------------------------------------------------------------
// useOutlines — traced spaces and the edits made to their geometry.
//
// The five saved fields stay in the document reducer, like the saved fields
// read by useScale and useViewPrefs. `outlinesOpen` deliberately stays in App:
// loading a plan, outline navigation and the lighting pipeline all write it,
// making it part of the composition root's shared workflow state.
// ---------------------------------------------------------------------------
export default function useOutlines({ doc, docActions, source }) {
  const { outlines, selectedOutlineId, litIds, dirtyIds, focusId } = doc;

  /* WHICH SPACES ARE LIT, READABLE FROM A CALLBACK — AND STILL A REF NOW THAT
     BOTH LISTS ARE IN THE REDUCER. `markChanged` runs inside the edit handlers
     and has to know whether the outline it is about to mark is already lit. It
     could not read `litIds` from inside the document reducer to decide whether
     to write `dirtyIds`: that is a decision taken while reducing, and React is
     free to invoke a reducer twice, so a rule that read one field to gate a
     write to another would be a rule running an unknown number of times. The
     ref keeps the DECISION at the call site and leaves the reducer with a plain
     `markDirty(id)`. Same pattern as `roomsRef` in
     features/lighting-planner/usePlanPipeline.js. */
  const litRef = useRef(litIds);
  litRef.current = litIds;

  const commitOutline = useCallback((pointsPx) => {
    if (!source) return;
    const o = makeOutline(pointsPx, { name: nextOutlineName(outlines) });
    const stored = { id: o.id, name: o.name, rectify: o.rectify,
                     detected: false, reviewed: true,
                     pointsDu: pointsPx.map(source.toDu) };
    docActions.addOutline(stored);
    docActions.setSelectedOutlineId(stored.id);   // highlight it; confirming is separate
  }, [source, outlines, docActions]);

  /**
   * A ROOM IS MARKED DIRTY ONLY IF IT IS LIT. An outline nobody has lit yet is
   * not a space whose answers have gone stale — it is a space with no answers,
   * which the tracer already reports as "not lit". Kept as a callback so the two
   * edit paths below cannot drift on the condition.
   */
  const markChanged = useCallback((id) => {
    if (!litRef.current.includes(id)) return;
    docActions.markDirty(id);
  }, [docActions]);

  const updateOutline = useCallback((id, patch) => {
    // `rectify` SQUARES THE POLYGON, so it moves corners and counts as a change.
    // A rename does not, and marking on one would offer a paid relight for
    // having typed a better name.
    if ('rectify' in patch) markChanged(id);
    docActions.patchOutline(id, patch);
  }, [markChanged, docActions]);

  /* ONE ACT, AND IT TOUCHES FIVE FIELDS. The lit list, the dirty list, the
     tracer's highlight and the panel's focus all refer to a space by id, so all
     four have to let go of it together — see OUTLINE_DELETED, which carries the
     reason the dirty list is filtered rather than left alone. */
  const deleteOutline = useCallback(
    (id) => docActions.deleteOutline(id), [docActions]);

  /**
   * Editing an outline's corners.
   *
   * All three go through the SAME conversion the tracer's own commits do: the
   * point arrives in pixels, it is stored in the plan's own units. That is what
   * keeps a nudged corner on its wall when the DXF's unit interpretation is
   * corrected afterwards — the alternative, storing what the grip was dragged
   * to, slides every correction off the drawing the moment the units change.
   *
   * Touching an outline marks it REVIEWED, which is the only thing that
   * distinguishes a proposal someone has looked at from one nobody has. It is
   * not the same as confirming it: it means the dashed line goes solid, because
   * the corner is now where a person put it.
   */
  const editPoints = useCallback((id, fn) => {
    if (!source) return;
    markChanged(id);
    /* THE CONVERSION RIDES IN WITH THE EDIT, and that is what keeps this
       honest: `source.fromDu`/`toDu` are a memo — derived state the document
       may not hold — so the reducer is handed a pure `pointsDu -> pointsDu`
       that has the conversion folded into it. See OUTLINE_POINTS_EDITED, which
       also says why the points must be read from the reducer's own state and
       not from here. */
    docActions.editOutlinePoints(id, (pointsDu) => {
      const next = fn(pointsDu.map(source.fromDu));
      return next ? next.map(source.toDu) : null;
    });
  }, [source, markChanged, docActions]);

  const movePoint = useCallback((id, index, pointPx) => {
    editPoints(id, (px) => px.map((p, i) => (i === index ? pointPx : p)));
  }, [editPoints]);

  const insertPoint = useCallback((id, index, pointPx) => {
    editPoints(id, (px) => [...px.slice(0, index), pointPx, ...px.slice(index)]);
  }, [editPoints]);

  const removePoint = useCallback((id, index) => {
    editPoints(id, (px) => (px.length > 3 ? px.filter((_, i) => i !== index) : px));
  }, [editPoints]);

  return {
    outlines, selectedOutlineId, litIds, dirtyIds, focusId,
    commitOutline, updateOutline, deleteOutline, editPoints,
    movePoint, insertPoint, removePoint,
  };
}
