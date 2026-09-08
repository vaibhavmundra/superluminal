import { useCallback } from 'react';
import { outlineStats } from '../../lib/outline.js';

// ---------------------------------------------------------------------------
// LIGHTING A SPACE COSTS SOMETHING, AND THESE THREE ARE WHERE IT IS ASKED FOR.
//
// THEY SIT BELOW `pxPerFt`, AND THE POSITION IS LOAD-BEARING. A hook's
// dependency array is evaluated DURING RENDER, so `[..., pxPerFt]` a hundred
// lines above the `const pxPerFt` it names is a temporal-dead-zone
// ReferenceError on the first paint — which in React means the whole tree
// unmounts and the app is a white page. That is why the controller that
// composes this stands where it does in App, and why the scale is an input
// here rather than something this file goes and finds.
// ---------------------------------------------------------------------------
/**
 * THE TILL, AND THE TWO ACTS THAT PUT A DRAWING THROUGH IT.
 *
 * `onClaimLayout` is App's prop and is null in the standalone editor, in
 * read-only mode and in every test — see the note on it in App's props, and the
 * twenty-five scripts in tools/ that light plans in Node with no server
 * anywhere. Everything here degrades to exactly what it did before there was a
 * meter: the claim returns true and the work goes ahead.
 *
 * `setPickingId`, `setOutlinesOpen` AND `milestone` ARE HANDED IN. Which room's
 * chunking is being chosen, whether the tracer is up and the expensive save are
 * all App's — the first two are screens this feature leaves rather than owns,
 * and the third is the route's. This feature decides WHEN each happens, which
 * is the part that belongs to lighting a plan.
 */
export default function useLightingClaims({
  outlines, outlinesPx, pxPerFt, readOnly, onClaimLayout, docActions,
  setPickingId, setOutlinesOpen, milestone,
}) {
  /**
   * CLAIM THE SPACES ABOUT TO BE LIT, AND SAY WHETHER TO GO ON.
   *
   * Every route into a layout goes through here — the tracer's Light button, the
   * panel's "Light all N outlines", a single room confirmed by double-click, and
   * the pipeline itself. Four call sites and one gate, because a fifth route
   * added later that forgot to ask would be a free tier with no ceiling.
   *
   * SAFE TO CALL FROM ALL FOUR, because the claim is keyed on the geometry of
   * each space (see fingerprintOutline in lib/plans.js). Lighting one room and
   * then the whole plan charges the room once, not twice; a double click charges
   * once; a re-light of untouched outlines charges nothing at all.
   *
   * NO SCALE, NO CHARGE. `outlineStats` needs px/ft to produce an area, and
   * without one nothing is laid out either — there is no cost to meter and no
   * layout to refuse. Letting it through is not a hole; it is the only reading
   * that is not an error message in front of a drawing that was never going to
   * light.
   */
  const claimSpaces = useCallback(async (ids) => {
    if (!onClaimLayout || readOnly) return true;
    const wanted = new Set(ids);
    const spaces = [];
    for (const o of outlinesPx) {
      if (!wanted.has(o.id)) continue;
      const sqft = outlineStats(o, pxPerFt)?.areaSqft ?? 0;
      if (!(sqft > 0)) continue;
      // THE RESOLVED PIXEL POINTS, not the stored drawing units, and the two are
      // interchangeable here for one reason: `pointsPx` is a deterministic
      // function of `pointsDu` and the source, so it is just as stable across a
      // reload — and it is the list that is guaranteed to exist. A
      // detector-proposed outline has no `pointsPx` until the memo above builds
      // them, which is the same trap documented at `planAreaSqft`.
      spaces.push({ id: o.id, points: o.pointsPx ?? [], pxPerFt, sqft });
    }
    if (!spaces.length) return true;
    const verdict = await onClaimLayout({ spaces });
    return !!verdict?.ok;
  }, [onClaimLayout, readOnly, outlinesPx, pxPerFt]);

  /** Light everything traced or proposed. The primary act on the tracer screen. */
  const lightWholePlan = useCallback(async () => {
    if (!await claimSpaces(outlines.map((o) => o.id))) return;
    /* ONE ACT. Marking everything reviewed, lighting the lot, clearing the
       dirty list and dropping the focus are four writes and one decision — see
       PLAN_LIT, which also carries the note on why nothing is selected to begin
       with. The lit list is read off the document in there rather than from
       `outlines` here. */
    docActions.lightWholePlan();
    docActions.clearDirty();
    setPickingId(null);
    setOutlinesOpen(false);
  }, [outlines, claimSpaces, docActions, setPickingId, setOutlinesOpen]);

  const lightOneRoom = useCallback(async (id) => {
    if (!await claimSpaces([id])) return;
    docActions.lightOneRoom(id);
    setPickingId(null);
    setOutlinesOpen(false);
    // CONFIRMING THE SPACES IS ITS OWN DATAPOINT — "here is what the segmenter
    // proposed and here is what a person accepted" — and it is worth recording
    // whether or not the pipeline is ever run on it.
    //
    // THE BEAT IS THE POINT. `milestone` is reassigned on every render and reads
    // the state of the render it was assigned in, so calling it synchronously
    // here would record the state as it was BEFORE the four setters above. A
    // quarter of a second is far longer than a commit needs and short enough
    // that nothing else can have happened.
    setTimeout(() => milestone.current?.('outlines'), 250);
  }, [claimSpaces, docActions, setPickingId, setOutlinesOpen, milestone]);

  return { claimSpaces, lightWholePlan, lightOneRoom };
}
