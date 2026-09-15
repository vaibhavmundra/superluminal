import { useEffect } from 'react';
import { detectBeds, detectFurniture, detectionsToZones, snapshotForDetection, ZONE_CLASSES, wireProvider } from '../../lib/furniture.js';
import { BED_SOURCES, splitByProvider, label as labelBeds } from '../../lib/bedFit.js';
import { OTHER_STROKE_PX, WALL_WEIGHT_IN } from '../../lib/settings.js';
import { rejectionSummary } from './bedResults.js';

export default function useFurnitureRecognition({
  source, img, restoring, readOnly, detectNonce, provider, pxPerFt, wallLayerSet,
  docActions, setDetectState, setBedSets,
}) {
  // --- find the bed ---------------------------------------------------------
  // A bed is the one piece of furniture whose position CHANGES THE CEILING: you
  // do not put a downlight over it, because whoever is lying there looks
  // straight up into the fitting.
  //
  // BOTH ROUTES IN COME THROUGH HERE. A photo is downscaled; a DXF is rendered
  // to a plain black-on-white raster first. After that neither this effect nor
  // anything downstream knows which it was looking at — same detector, same
  // rectangles, same zones. A DXF *could* be read directly when it names its
  // blocks, but across drawings from different offices it usually does not, so
  // one path that always works beats two that each work sometimes.
  //
  // Fires on load, before any boundary exists: detection needs only the plan,
  // so by the time there is a region to light the answer is already in. It is
  // fire-and-forget — a detector being down must not stop anyone planning a
  // room by hand.
  useEffect(() => {
    if (!source) return;
    // A REOPENED PLAN ALREADY HAS THIS ANSWER, and it has the user's corrections
    // on top of it. Re-running would cost a model call and throw those away.
    // The nonce is the user asking again, explicitly.
    if (restoring.current && detectNonce === 0) return;
    // READ-ONLY: never. This is a stored plan belonging to somebody else, and
    // re-running the beds detector on it would spend a model call to recompute
    // an answer that is already in the row — and then hold a different one in
    // memory from the one the user is looking at on their own screen.
    if (readOnly) return;
    // A BIG PLAN DOES NOT GET ASKED ALL AT ONCE. Over LARGE_PLAN_SQFT the answer
    // to this question is reliably "no beds" — fifteen mattresses at forty pixels
    // each — and every bedroom is asked about on its own crop in the pipeline
    // instead. Spending 25 seconds and a call to be told nothing is worse than
    // not asking.
    //
    // ON THE FIRST UPLOAD THIS IS STILL FALSE, and deliberately: the area is not
    // knowable until there is a scale, which on a raster means until a door has
    // been measured — after this effect has run. So the first pass happens, the
    // pipeline supersedes it per room, and any re-run (the nonce, or a reopened
    // plan) is correctly skipped. Better one wasted call than a bed pass that
    // waits for the tracer on every plan, large or small.
    /* ================= THE WHOLE-PLAN BED PASS ==========================
     *
     * ONE CALL TO ONE TRAINED SEGMENTER — the `bed-filter` workflow — and this
     * is the primary path for every bed on every plan.
     *
     * It replaces three arrangements in a row, each of which was a way of
     * compensating for a detector that could not resolve a bed on a whole sheet:
     * the general-segmentation workflow asked for `bed` (whose boxes enclosed
     * whole twin PAIRS at 17 pixels to the foot), then GPT contested against it,
     * then two SAMPLES of GPT contested against each other with an arbiter to
     * settle them. A model that draws the mattress correctly the first time
     * makes all of that an expensive way to agree with itself. On the
     * FLOOR_PLAN_03 sample it returns one tight box with the nightstands
     * outside it.
     *
     * NO SECOND OPINION AND NO JUDGE. `bedSets` stays null, which is what keeps
     * the contest machinery dormant rather than deleted.
     *
     * THE SIZE GATE STILL RUNS, here and again in detectedZones. A better
     * detector is not a reason to stop measuring what came back; that gate is
     * what caught the twin-pair boxes and it costs nothing when the boxes are
     * right.
     *
     * The superseded implementation is below this block's `return`, intact.
     */
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      setDetectState({ status: 'running' });
      const t0 = Date.now();
      try {
        const shot = await snapshotForDetection(source, img, {
          stroke: OTHER_STROKE_PX,
          // Two inches, always. See WALL_WEIGHT_IN in settings.js.
          wallStroke: Math.max(1, (WALL_WEIGHT_IN / 12) * (source.pxPerFt || 20)),
          wallLayers: wallLayerSet,
        });
        if (!alive) return;
        console.log(`[beds] whole plan -> bed-filter: sending ${shot.w}x${shot.h}`
          + ` of ${source.w}x${source.h}${shot.layers ? ` (${shot.layers} layers)` : ''}`);

        // No polygon: find every bed on the sheet now, and let the room filter
        // attribute them later. pxPerFt is null on a raster until a door has
        // been measured, in which case the gate simply does not run here —
        // detectedZones applies it once the scale exists.
        const image = { w: source.w, h: source.h };
        const { kept, rejected, payload } = await detectBeds({
          base64: shot.base64, mime: shot.mime, signal: ctl.signal,
          w: shot.w, h: shot.h, image, polygon: null, pxPerFt,
        });
        if (!alive) return;
        if (payload?.meta) console.log('[beds] server:', payload.meta);
        console.log(`[beds] bed-filter found ${kept.length} bed(s) on the whole plan`
          + `${rejected.length ? `, rejected ${rejected.length}` : ''}`,
          { kept, rejected });

        // NULL, DELIBERATELY. There is no second answer to contest, so the
        // judge has nothing to arbitrate. Setting this to null is what leaves
        // the contest path dormant instead of removed.
        setBedSets(null);
        docActions.clearBedVerdicts();
        docActions.replaceDetections(kept.map((k, i) => ({
          ...k, id: `bed-sheet-${i}-${Math.round(k.rect.x0)}-${Math.round(k.rect.y0)}`,
        })));

        // THE REASONS, NOT JUST THE COUNT. A size gate that quietly drops every
        // box on a plan is indistinguishable from a detector that found nothing,
        // and the two want completely different fixes.
        //
        // NOT FILTERED TO cls === 'bed' any more: this workflow answers one
        // question, so its class name is whatever its author called the project
        // and everything it returns is a bed. Filtering on the name here is how
        // the panel would report zero rejections on a run that rejected
        // everything.
        const whyRejected = rejectionSummary(rejected);
        setDetectState({
          status: 'done', rejected, whyRejected, ms: Date.now() - t0,
          meta: payload?.meta ?? null, count: kept.length, kind: source.kind,
          provider: 'bed-filter', sets: null,
        });
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        console.warn('[beds] bed-filter failed:', err);
        setDetectState({ status: 'error', error: String(err.message || err), ms: Date.now() - t0 });
      }
    })();

    return () => { alive = false; ctl.abort(); };

    /* ============ THE SUPERSEDED WHOLE-PLAN PASS, COMMENTED OUT ==========
     * Intact below the return so it can be switched back on in one edit. It
     * asked BOTH detectors (general-segmentation + GPT) about the entire sheet
     * and contested them. Kept because the `provider` switch, `bedSets` and the
     * judge all still exist and this is the only caller that fed them.
     */
    /* eslint-disable no-unreachable */

    {  /* SCOPED so its `alive`/`ctl` do not collide with the live pass above.
       * The braces are the only edit to this block; everything inside is as it
       * was. */
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      setDetectState({ status: 'running' });
      const t0 = Date.now();
      try {
        const shot = await snapshotForDetection(source, img, {
          stroke: OTHER_STROKE_PX,
          // Two inches, always. See WALL_WEIGHT_IN in settings.js.
          wallStroke: Math.max(1, (WALL_WEIGHT_IN / 12) * (source.pxPerFt || 20)),
          wallLayers: wallLayerSet,
        });
        if (!alive) return;
        console.log(`[detect] ${source.kind}: sending ${shot.w}x${shot.h} of ${source.w}x${source.h}`
          + `${shot.layers ? ` (${shot.layers} layers)` : ''}`
          + `${shot.wallLayerNames?.length ? `, walls@${shot.wallStroke}px on [${shot.wallLayerNames.join(', ')}]` : ''}`
          + `, classes=${ZONE_CLASSES.join(',')}`);

        const payload = await detectFurniture({
          base64: shot.base64, mime: shot.mime, classes: ZONE_CLASSES, signal: ctl.signal,
          // The size SENT, not the size of the original. The GPT route answers
          // in fractions of the image it was given and needs this to resolve
          // them; rescaleRect maps the result back afterwards as ever.
          // `judge` is two calls and a decision, and the decision is not made
          // here — the wire only knows about `both`.
          provider: wireProvider(provider), w: shot.w, h: shot.h,
        });
        if (!alive) return;
        if (payload?.meta) console.log('[detect] server:', payload.meta);

        // No polygon here on purpose: find everything on the plan now, and let
        // the room filter it later.
        const image = { w: source.w, h: source.h };
        // pxPerFt is null on a raster until a door has been measured, in which
        // case the gate simply does not judge — detectedZones applies it later.
        const { kept, rejected } = detectionsToZones(payload, { image, polygon: null, pxPerFt });
        console.log(`[detect] kept ${kept.length}, rejected ${rejected.length}`, { kept, rejected });

        // THE SAME RESPONSE, READ TWICE AND DIFFERENTLY. Above: everything at
        // once, de-duplicated, which is what goes on the canvas the moment
        // detection lands and what every non-judged run has always used. Below:
        // the two halves kept apart, because the judge's whole question is which
        // of them is right and a merge has already answered it.
        //
        // Both, and not one or the other, so there is something on screen before
        // the pipeline runs and the judged answer REPLACES it rather than being
        // the only thing that ever appears. A detector that lands while the user
        // is still tracing outlines should show its work.
        let sets = null;
        if (provider === 'judge') {
          sets = {};
          const split = splitByProvider(payload, (half) =>
            detectionsToZones(half, { image, polygon: null, pxPerFt }));
          for (const src of BED_SOURCES) sets[src.id] = labelBeds(split[src.id].kept, src.id);
          console.log('[detect] judged sets:',
            BED_SOURCES.map((x) => `${x.label} ${sets[x.id].length}`).join(', '));
        }
        setBedSets(sets);
        docActions.clearBedVerdicts();

        docActions.replaceDetections(kept.map((k, i) => ({ ...k, id: `det-${i}-${Math.round(k.rect.x0)}-${Math.round(k.rect.y0)}` })));
        // THE REASONS, NOT JUST THE COUNT. A size gate that quietly drops every
        // box on a plan is indistinguishable from a detector that found nothing,
        // and the two want completely different fixes. This is the difference
        // between reading server logs for twenty minutes and reading one line in
        // the panel.
        const whyRejected = rejectionSummary(rejected.filter((r) => r.cls === 'bed'));
        setDetectState({
          status: 'done', rejected, whyRejected, ms: Date.now() - t0,
          meta: payload?.meta ?? null, count: kept.length, kind: source.kind,
          provider,
          sets: sets ? Object.fromEntries(BED_SOURCES.map((x) => [x.id, sets[x.id].length])) : null,
        });
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        console.warn('[detect] failed:', err);
        setDetectState({ status: 'error', error: String(err.message || err), ms: Date.now() - t0 });
      }
    })();

    return () => { alive = false; ctl.abort(); };
    }  /* end of the superseded pass */
    // `provider` is a dependency because switching provider is a deliberate act
    // whose whole purpose is to see the other answer — waiting for a second
    // click would just be a click. The nonce is the explicit re-run.
    //
    // KEYED ON THE DRAWING AND NOT ON THE SOURCE OBJECT, for the reason set out
    // at the foot of useRoomRecognition: `source` is rebuilt by the unit
    // dropdown, and a bed is in the same place whatever the ruler says. `img`
    // goes with it — for a raster the geometry key IS the decoded bitmap, so
    // naming both would be saying one thing twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.geometryKey, detectNonce, provider]);

}
