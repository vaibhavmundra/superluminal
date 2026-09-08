import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { roomSnapshot, requestAccents } from '../../lib/accentMask.js';
import { gridFor, anchorLines } from '../../lib/wallGrid.js';
import { fitAll, RENDER_DEFAULTS, renderBlob, renderRef, fetchRender }
  from '../../lib/renderImage.js';
import { wallElementsFrom, wallResultFrom, wallResultNoneSeen } from './passResults.js';

/**
 * THE RENDER PASS — uploads, references, transcripts and the two model calls.
 *
 * RenderPassPanel IS NO LONGER MOUNTED — see the note in App's Spaces list
 * where it used to be. Every handler and every piece of state that fed it is
 * intact and unchanged here, so putting the panel back is a matter of mounting
 * it against this interface; nothing has been dropped on the way across.
 *
 * WHAT IS SAVED IS NOT HERE. `wallResults` (the cells), `renderRefs` (the
 * storage keys) and `runTrims` (the lengths somebody changed by hand) are all
 * the document's, written through `docActions`. This owns the working copies
 * and the session: the bytes in memory, the status, the gridded crop and the
 * transcripts.
 */
export default function useRenderPass({
  source, img, wallLayerSet, pxPerFt, focus,
  accentResults, doors, renderRefs, renderStore,
  readOnly, onClaimPass, onReleasePass, docActions,
}) {
  // --- the render pass ------------------------------------------------------
  //
  // THE ONE PASS THAT DOES NOT READ THE DRAWING. Everything else in this app
  // starts from the plan; a plan is a horizontal cut and cannot say that there
  // is fluted panelling behind the bed. So this one takes PHOTOGRAPHS — renders,
  // views — of a space, reads the wall features off them in English, and then
  // puts that English back onto the plan against a 1ft grid. Two model calls,
  // both in wallPrompt.js, which is also where both prompts live.
  //
  // Keyed by outline id like the accent pass, and for the same reason: the
  // renders somebody uploaded for Bedroom 2 must still be there after they click
  // through to Bedroom 3 and back.
  const [renders, setRenders] = useState({});          // roomId -> [shrunk render]
  /**
   * WHERE THOSE RENDERS WENT. roomId -> [{ path, name, w, h, bytes, ... }].
   *
   * The pointers, and the half of the pair that is SAVED — see planState.js.
   * `renders` above is the working copy: base64 in memory, which is what goes to
   * the model and what the thumbnails draw. This is a storage key and ninety
   * bytes of description per view, which is what survives a reload.
   *
   * Two lists rather than one field with a mode, because they genuinely differ
   * in lifetime: a render dropped while the plan's row is still being inserted
   * has no path and works perfectly well for the pass, and a render restored
   * from the bucket has a path before its bytes have arrived.
   */
  const [wallState, setWallState] = useState({ status: 'idle', roomId: null });
  // The gridded crop, made eagerly so the panel can show it — same argument as
  // accentShot, one step stronger: a grid drawn the wrong way up is invisible in
  // a list of cell references and obvious in a thumbnail with numbers on it.
  const [wallShot, setWallShot] = useState(null);
  // WHAT WENT AND WHAT CAME BACK, per room, so the panel can put both on screen.
  //
  // NOT IN `wallResults`, AND THEREFORE NOT SAVED. The results are a few hundred
  // bytes of cells that must survive a reload; a transcript is several kilobytes
  // of prompt and worksheet per room, it describes ONE run rather than the state
  // of the plan, and it would be stale the moment anything was re-analysed. It
  // belongs to the session, like the renders it came from. See planState.js.
  const [wallTranscripts, setWallTranscripts] = useState({});
  /* THE LENGTHS SOMEBODY CHANGED BY HAND — run id -> { a, b } in FEET. In the
     document reducer beside the `wallResults` it qualifies; see `runTrims` there
     for why the EDIT is stored rather than the result, and RUN_TRIM_SET for the
     rule that a run dragged back to where the rule put it stores nothing. */

  // --- the render pass, room by room ----------------------------------------
  //
  // TWO CALLS AND THE JOIN BETWEEN THEM. See wallPrompt.js's header for why they
  // are two: recognition off a photograph and localisation on a plan are
  // different jobs, they fail differently, and asked together a failure in
  // either is one indistinguishable silence.

  /** The 1ft grid for the space the panel is looking at. Null with no scale. */
  const wallGrid = useMemo(
    () => (focus?.plan?.ok ? gridFor(focus.plan.polygonPx, pxPerFt) : null),
    [focus, pxPerFt]);

  /**
   * The ANCHORS block for PROMPT 02, built from what this app already knows.
   *
   * The prompt as written carries four anchors with their answers filled in by
   * hand — bed wall, window wall, door, TV unit. Filling those in per room per
   * plan is not a feature, so they are DERIVED: the accent pass has already told
   * us where the bed and the TV unit are in plan pixels, and the door detector
   * has already found the doors. Nothing that was not actually detected is
   * asserted; see anchorLines() for what the block says when nothing was.
   */
  const wallAnchors = useCallback((r, grid) => anchorLines({
    furniture: accentResults[r.id]?.furniture ?? [],
    // `doors` carry their rect in the SOURCE's pixels, which is the same space
    // the room polygons and the grid are in — see scaleFromDoor, which divides
    // one by the other to get px/ft. No conversion, and none wanted: a second
    // coordinate space here is a second thing to get the wrong way round.
    doors,
    grid,
  }), [accentResults, doors]);

  /**
   * The gridded crop, made ahead of the call so the panel can show it.
   *
   * Same argument as accentShot and one step stronger. The grid encodes a
   * coordinate system — [1,1] bottom-left, y counting UP — and a grid drawn the
   * wrong way up produces confident answers that are all mirrored. That is
   * invisible in a list of cell references and instantly obvious in a thumbnail
   * with the numbers running the wrong way.
   */
  useEffect(() => {
    if (!source || !focus?.plan?.ok || !wallGrid) { setWallShot(null); return; }
    let alive = true;
    (async () => {
      try {
        const shot = await roomSnapshot({
          source, img,
          polygonPx: focus.plan.polygonPx,
          lightsPx: focus.plan.lightsPx,
          wallLayers: wallLayerSet,
          grid: wallGrid,
        });
        if (alive) setWallShot({ ...shot, roomId: focus.id });
      } catch (err) {
        console.warn('[render pass] could not build the gridded crop:', err);
        if (alive) setWallShot(null);
      }
    })();
    return () => { alive = false; };
  }, [source, img, focus, wallLayerSet, wallGrid]);

  /**
   * THE PASS ITSELF, for one room. No state written in here — same rule as
   * computeAccents, and for the same reason.
   *
   * `onPhase` exists because this is the longest-running thing in the app by
   * some margin: two reasoning calls on high effort, one of them looking at
   * several photographs. A single "working…" for ninety seconds is
   * indistinguishable from a hang, and the two phases genuinely mean different
   * things to somebody waiting.
   */
  const computeWallItems = useCallback(async (r, views,
                                              { onPhase = () => {}, onCall = () => {} } = {}) => {
    const grid = gridFor(r.plan.polygonPx, pxPerFt);
    if (!grid) throw new Error('No 1ft grid could be laid in this space — is the scale set?');
    if (!views?.length) throw new Error('No renders to look at.');

    const roomInfo = {
      name: r.outline.name || null,
      widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
    };

    // --- PROMPT 01. The renders in, English out. No plan, no coordinates.
    onPhase('reading');
    const first = await requestAccents({
      plans: views, task: 'wallitems', room: roomInfo,
    });
    // REPORTED AS SOON AS IT LANDS, not returned at the end. If the SECOND call
    // then throws, this is the transcript that says whether the first one was
    // fine — which is the first question anybody asks about a failed run, and it
    // would be lost with the exception if both were handed back together.
    onCall('first', first.meta);
    const elements = wallElementsFrom({ res: first.result, roomId: r.id });

    // NOTHING SEEN IS AN ANSWER, AND IT SHORT-CIRCUITS. Sending an empty array
    // into PROMPT 02 would spend a second reasoning call to be told there is
    // nothing to place, and buildGridRequest refuses it for exactly that reason.
    if (!elements.length) {
      return { grid, shot: null, meta: { first: first.meta, second: null },
               result: wallResultNoneSeen({ first: first.result }) };
    }

    // --- PROMPT 02. The plan with a grid on it, plus that English, cells out.
    onPhase('gridding');
    const shot = await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet, grid,
    });

    onPhase('placing');
    const second = await requestAccents({
      plan: shot, task: 'wallgrid', room: roomInfo,
      elements, anchorLines: wallAnchors(r, grid), grid,
    });
    onCall('second', second.meta);

    return {
      grid, shot,
      meta: { first: first.meta, second: second.meta },
      result: wallResultFrom({ elements, first: first.result, second: second.result }),
    };
  }, [source, img, wallLayerSet, pxPerFt, wallAnchors]);

  /** The button. Shrinks whatever was dropped in, runs the pass, writes state. */
  const runWallPass = useCallback(async () => {
    const r = focus;
    const views = renders[r?.id] ?? [];
    if (!r?.plan?.ok || !views.length) return;

    // CHARGED BEFORE THE CALLS, AND GIVEN BACK IF THEY FAIL.
    //
    // Before, because this is the moment the money is committed — two vision
    // calls go out and a user who closes the tab has still spent them, so
    // charging on success would make an abandoned pass free.
    //
    // Given back, because a pass that comes back as a 500 has cost nobody
    // anything, and quietly keeping one of five is the sort of small theft that
    // produces a support email. The reversal is a second ledger row rather than
    // a deletion — see releaseAction in api/billing.js.
    //
    // A FRESH runId PER CLICK, so a retry after a failure is a new charge and
    // not a silently deduplicated no-op. The idempotency this key buys is only
    // against the same click arriving twice.
    let claim = null;
    if (onClaimPass && !readOnly) {
      const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      claim = await onClaimPass({ roomId: r.id, runId });
      if (!claim?.ok) return;
    }

    setWallState({ status: 'running', roomId: r.id, phase: 'reading' });
    // A FRESH TRANSCRIPT FOR THIS RUN, cleared up front rather than merged into.
    // Leaving the last run's second call sitting there while this run's first
    // call is still in flight is a dialog showing two halves of two different
    // runs, which is worse than showing nothing.
    setWallTranscripts((m) => ({ ...m, [r.id]: {} }));
    const record = (which, meta) => setWallTranscripts((m) => ({
      ...m,
      [r.id]: {
        ...(m[r.id] ?? {}),
        [which]: {
          model: meta?.model ?? null, ms: meta?.ms ?? null,
          usage: meta?.usage ?? null, bytes: meta?.bytes ?? null,
          sentImages: meta?.sentImages ?? meta?.images ?? 0,
          prompt: meta?.prompt ?? '',
          // `fullReply` where the route sent one — the render-pass tasks do —
          // and the 900-character head slice as the fallback, so a route that
          // has not been redeployed yet degrades to something rather than blank.
          reply: meta?.fullReply ?? meta?.reply ?? '',
        },
      },
    }));
    const t0 = Date.now();
    try {
      const out = await computeWallItems(r, views, {
        onPhase: (phase) => setWallState((st) =>
          (st.roomId === r.id ? { ...st, phase } : st)),
        onCall: record,
      });
      docActions.setWallResult(r.id, out.result);
      if (out.shot) setWallShot({ ...out.shot, roomId: r.id });
      setWallState({ status: 'done', roomId: r.id, ms: Date.now() - t0 });
      console.log(`[render pass] ${r.outline.name || r.id}:`,
        `${out.result.elements.length} element(s),`,
        `${out.result.elements.filter((e) => e.cells?.length).length} placed`,
        out.meta);
    } catch (err) {
      console.warn('[render pass] failed', err);
      // The pass is the thing that was bought and it did not happen. Fire and
      // forget: a failed release must not turn one error into two, and the
      // ledger is auditable either way.
      if (claim?.fingerprint) onReleasePass?.(claim.fingerprint);
      setWallState({ status: 'error', roomId: r.id, error: String(err.message || err),
                     ms: Date.now() - t0 });
    }
  }, [focus, renders, computeWallItems, onClaimPass, onReleasePass, readOnly, docActions]);

  /** Files in -> downscaled renders on the selected space. See renderImage.js
   *  for why nothing that arrives here is ever sent at the size it arrived. */
  const addRenders = useCallback(async (files) => {
    const r = focus;
    if (!r) return;
    setWallState({ status: 'running', roomId: r.id, phase: 'shrinking' });
    try {
      const have = renders[r.id] ?? [];
      const { renders: shrunk, notes } = await fitAll(files);
      // THE CAP IS RENDERIMAGE'S NUMBER, NOT A SECOND ONE HERE. fitAll() already
      // refuses more than this in a single drop; this is the same limit applied
      // to a drop that ARRIVES IN TWO GOES, and two constants that must agree
      // is one constant with a bug waiting in it.
      const kept = [...have, ...shrunk].slice(0, RENDER_DEFAULTS.maxRenders);
      setRenders((m) => ({ ...m, [r.id]: kept }));
      setWallState({ status: 'idle', roomId: r.id, notes });

      // --- and then, in the background, to the bucket ----------------------
      //
      // AFTER THE STATE, NOT BEFORE IT. The thumbnails and the Analyse button
      // are ready the moment the canvas has finished; making either of them
      // wait on an upload would put a spinner in front of a picture that is
      // already decoded and in memory for no benefit to the person looking at
      // it. And it must not be able to fail the drop: a bucket that refuses is
      // a render that is not KEPT, which is a smaller problem than a render
      // that cannot be USED.
      if (!renderStore?.put) return;
      const base = (renderRefs[r.id] ?? []).length;
      shrunk.forEach((v, i) => {
        // Only the ones that survived the cap above are worth storing.
        if (!kept.includes(v)) return;
        renderStore.put(renderBlob(v), { roomId: r.id, index: base + i })
          .then((path) => {
            if (!path) return;
            docActions.addRenderRef(r.id, renderRef(v, path));
          })
          .catch((err) => console.warn('[render pass] a view was not stored', err));
      });
    } catch (err) {
      setWallState({ status: 'error', roomId: r.id, error: String(err.message || err) });
    }
  }, [focus, renders, renderRefs, renderStore, docActions]);

  /**
   * THE VIEWS, BACK OUT OF THE BUCKET — for the space that is open, and no other.
   *
   * WHY LAZY. A flat of nine rooms with four views each is thirty-six JPEGs and
   * several megabytes; fetching all of them to open a plan would put that on the
   * critical path of every reload to populate drop targets nobody has looked at.
   * The refs are already restored, so the panel knows how many views a space has
   * before a single byte is fetched — this only pays for the one on screen.
   *
   * WHY IT NEVER OVERWRITES. `renders[id]` being present means either these
   * bytes are already here or somebody has just dropped new files in, and the
   * second one must win. So an id that already has a working copy is skipped
   * outright rather than merged.
   */
  const fetchingRenders = useRef(new Set());
  useEffect(() => {
    const id = focus?.id;
    const refs = id ? (renderRefs[id] ?? []) : [];
    if (!id || !refs.length || !renderStore?.url) return;
    if (renders[id]?.length || fetchingRenders.current.has(id)) return;
    fetchingRenders.current.add(id);
    let alive = true;
    (async () => {
      try {
        const back = [];
        for (const ref of refs) {
          const href = renderStore.url(ref.path);
          if (!href) continue;
          try { back.push(await fetchRender(href, ref)); }
          catch (err) { console.warn('[render pass] a stored view is missing', ref.path, err); }
        }
        if (alive && back.length) setRenders((m) => (m[id]?.length ? m : { ...m, [id]: back }));
      } finally {
        fetchingRenders.current.delete(id);
      }
    })();
    return () => { alive = false; };
  }, [focus?.id, renderRefs, renders, renderStore]);

  /* TWO RESETS AGAIN, AND FOR THE SAME REASON THE ACCENT PASS HAS TWO: the
     working copies, the stored pointers, the cells and the trims went out
     together, and the status and the crop went seven lines later with the
     hand-placed coves in between. */
  const resetRenders = useCallback(() => {
    setRenders({}); docActions.clearRenderRefs();
    docActions.clearWallResults(); setWallTranscripts({}); docActions.clearRunTrims();
  }, [docActions]);

  const resetRenderState = useCallback(() => {
    setWallState({ status: 'idle', roomId: null }); setWallShot(null);
  }, []);

  return {
    renders, state: wallState, shot: wallShot, transcripts: wallTranscripts,
    grid: wallGrid, anchorsFor: wallAnchors,
    computeWallItems, runWallPass, addRenders,
    resetRenders, resetRenderState,
  };
}
