import { useEffect } from 'react';
import { detectDoors, doorsFromPayload } from '../../lib/doors.js';
import { downscaleForDetection } from '../../lib/furniture.js';

export default function useDoorRecognition({
  source, img, isVector, projectId, restoring, readOnly, doorNonce, docActions, setDoorState,
}) {
  // --- find the doors -------------------------------------------------------
  //
  // THE SCALE COMES FIRST AND FROM A DOOR. Everything downstream is stated in
  // feet, so px/ft is the first number this app needs, and a door is the only
  // object on a floor plan whose real width is standard enough to read it off:
  // 750 to a bathroom, 900 to a room, 1200 to a hall. See src/lib/doors.js.
  //
  // GATED ON THE PROJECT TYPE, which is not an arbitrary place to hang it. The
  // dialog is a moment the user is already spending, the search takes a couple
  // of seconds, and its answer has to be on screen before the tracer is useful
  // — landing them on an empty tracer and popping doors in underneath them a
  // beat later is the worse version of the same wait, because by then they have
  // started clicking.
  //
  // NOT ON A DXF. A drawing states its own scale in its own units; there is
  // nothing to measure and nothing to guess, and asking a detector would be
  // asking a worse source than the one already in the file.
  useEffect(() => {
    if (!source || isVector || !projectId) return;
    if (!img?.el) return;
    // A REOPENED PLAN ALREADY HAS THIS ANSWER, and it has the user's corrections
    // on top of it. Re-running would cost a model call and throw those away.
    // The nonce is the user asking again, explicitly.
    if (restoring.current && doorNonce === 0) return;
    // READ-ONLY: never. This is a stored plan belonging to somebody else, and
    // re-running the doors detector on it would spend a model call to recompute
    // an answer that is already in the row — and then hold a different one in
    // memory from the one the user is looking at on their own screen.
    if (readOnly) return;
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      setDoorState({ status: 'running' });
      const t0 = Date.now();
      try {
        const shot = downscaleForDetection(img.el);
        const payload = await detectDoors({
          base64: shot.base64, mime: shot.mime, signal: ctl.signal });
        if (!alive) return;
        // Against the ORIGINAL image, not the downscaled one that was sent. The
        // response declares the space it answered in and doorsFromPayload maps
        // back — get this wrong and every door is out by the downscale ratio,
        // which is not a wonky box, it is the whole drawing at the wrong scale,
        // silently, because a wrong scale still looks like a plan.
        const { doors: found, rejected, medianPx } = doorsFromPayload(payload,
          { image: { w: source.w, h: source.h } });
        console.log(`[doors] ${found.length} found, ${rejected.length} rejected`
          + `, median opening ${medianPx ? medianPx.toFixed(0) : '—'}px`, { found, rejected });
        docActions.replaceDoors(found);
        setDoorState({ status: 'done', count: found.length, rejected,
                       ms: Date.now() - t0, meta: payload?.meta ?? null });
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        // SURVIVABLE, and that is the whole reason the fallback still exists.
        // No doors means the user measures something by hand, which is what
        // they did before this feature.
        console.warn('[doors] failed:', err);
        docActions.clearDoors();
        setDoorState({ status: 'error', error: String(err.message || err), ms: Date.now() - t0 });
      }
    })();

    return () => { alive = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, img, isVector, projectId, doorNonce]);

}
