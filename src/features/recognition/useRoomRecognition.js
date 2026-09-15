import { useEffect } from 'react';
import { proposeOutlines } from '../../lib/outlineSources.js';
import { makeOutline } from '../../lib/outline.js';
import { OTHER_STROKE_PX, WALL_WEIGHT_IN } from '../../lib/settings.js';
import { mergeRoomProposals } from './roomProposals.js';

export default function useRoomRecognition({
  source, img, isVector, restoring, readOnly, roomNonce, wallLayerSet, docActions,
}) {
  // --- find the rooms -------------------------------------------------------
  //
  // The step that used to be the whole of the user's job. A segmentation model
  // reads the plan and proposes one polygon per room; the user drags the corners
  // that are wrong and lights the lot. Tracing by hand is still there, unchanged
  // and still exact, and it is what happens when this comes back empty — which
  // is why the failure path here is a message and not an error.
  //
  // IT RUNS ON UPLOAD, before the scale is known on an image. That is fine and
  // deliberate: a polygon is pixels, and pixels do not need a scale. The scale
  // only decides whether a polygon is a WC or a cupboard, and roomsFromPayload
  // falls back to a fraction of the sheet for that when there is no scale yet.
  // Waiting for the scale would mean the proposals appear after the user has
  // already started tracing over them.
  //
  // Not in the same effect as the bed detector, and not in the same request: two
  // workflows, two models, two answers, and one of them failing must not take
  // the other down with it.
  useEffect(() => {
    if (!source) return;
    // A REOPENED PLAN ALREADY HAS THIS ANSWER, and it has the user's corrections
    // on top of it. Re-running would cost a model call and throw those away.
    // The nonce is the user asking again, explicitly.
    if (restoring.current && roomNonce === 0) return;
    // READ-ONLY: never. This is a stored plan belonging to somebody else, and
    // re-running the rooms detector on it would spend a model call to recompute
    // an answer that is already in the row — and then hold a different one in
    // memory from the one the user is looking at on their own screen.
    if (readOnly) return;
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      docActions.setRoomState({ status: 'running' });
      const t0 = Date.now();
      let meta = null;
      const res = await proposeOutlines('roboflow-rooms', {
        source, img,
        // A DXF states its scale, so the area floor can be in feet from the
        // start. An image cannot, and passing the not-yet-measured scale would
        // be worse than passing none — it would apply a floor computed from a
        // number the user has not agreed to.
        pxPerFt: isVector ? source.pxPerFt : null,
        signal: ctl.signal,
        snapshotOpts: {
          stroke: OTHER_STROKE_PX,
          wallStroke: Math.max(1, (WALL_WEIGHT_IN / 12) * (source.pxPerFt || 20)),
          wallLayers: wallLayerSet,
        },
        onMeta: (m) => { meta = m; },
      });
      if (!alive) return;

      if (!res.ok) {
        console.warn('[rooms] failed:', res.reason);
        docActions.setRoomState({ status: 'error', error: res.reason, ms: Date.now() - t0 });
        return;
      }
      console.log(`[rooms] ${res.outlines.length} proposed`, { meta, outlines: res.outlines });

      // Merge, never replace. Anything traced by hand is the user's work and
      // outranks a proposal; re-running the detector must not delete it. The
      // previous run's proposals DO go, because they are the same answer to the
      // same question and keeping both would double every room.
      /* ONE ACTION FOR BOTH FIELDS, AND THE COUNT COMES BACK RATHER THAN OUT.
         This was a `let added` assigned from inside a `setState` updater and
         read by the `setRoomState` below it — which a reducer may not do,
         because React is free to invoke it twice. So the merge returns the pair
         and there is no side effect left to be invoked at all.
         IT RUNS AGAINST THE LATEST OUTLINES, which is the whole reason it is a
         function rather than a finished list: this lands when a network call
         returns, and this effect's dependencies are `[source, roomNonce]`, so a
         room traced by hand while the detector was thinking is not one frame
         stale in that closure — it is not in it. See ROOMS_PROPOSED. */
      const ms = Date.now() - t0;
      docActions.proposeOutlines((os) => {
        return mergeRoomProposals(os, {
          proposals: res.outlines, source, meta, ms,
          makeId: (points, name) => makeOutline(points, { name }).id,
        });
      });
    })();

    return () => { alive = false; ctl.abort(); };
    /* KEYED ON THE DRAWING, NOT ON THE SOURCE OBJECT.
     *
     * This used to be `[source, roomNonce]`, and `source` is rebuilt whenever
     * the unit dropdown changes — so picking centimetres instead of inches
     * spent a model call re-answering a question whose answer could not have
     * moved. The rooms in a drawing are the same rooms whatever you call the
     * units; only their measured size changes, and outlines are stored in
     * drawing units so that they survive exactly this.
     *
     * `source` is still READ inside the effect and is still correct when it
     * runs: the closure is rebuilt on every render, so whenever the geometry or
     * the nonce does change, the source in hand is the current one.
     *
     * THE NONCE IS STILL THE WAY TO ASK AGAIN. If a wrong unit ever did produce
     * a worse answer — the area floor below is computed from pxPerFt — "look
     * again" re-runs this deliberately, which is the right way round: an
     * explicit ask rather than a call on every keystroke of a dropdown. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.geometryKey, roomNonce]);

}
