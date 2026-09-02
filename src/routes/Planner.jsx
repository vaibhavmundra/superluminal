import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import App from '../App.jsx';
import { getPlan, getProject, updatePlan, fetchPlanFile, uploadSnapshot, uploadRender,
  recordRevision, touchPlanOpened, publicUrl } from '../lib/db.js';
import { getJob, subscribeJob, whenRowReady, retryUpload, releaseJob, provisionalPlan }
  from '../lib/uploads.js';
import { useAuth } from '../lib/auth.jsx';
import { useBilling } from '../lib/billing.jsx';
import Paywall from '../components/Paywall.jsx';
import { readDraft, saveDraft, clearDraft, pickRestore } from '../lib/draft.js';

// ---------------------------------------------------------------------------
// THE EDITOR, WITH A DATABASE BEHIND IT.
//
// App.jsx does not know Supabase exists, and that is deliberate: it is 3,000
// lines of geometry and it stays a pure editor over a File. This route is the
// only place that knows a plan has a row.
//
// TWO WAYS IN, AND THE FIRST ONE NEVER TOUCHES THE NETWORK.
//
//   A DROP. The dashboard started a background job (lib/uploads.js) and
//   navigated here on the next line. The job holds the very File the user chose,
//   so the drawing is parsed and segmenting within a frame of arriving — while
//   the bytes are still going up. There is no fetch, and nothing here waits.
//
//   A LINK. Someone opened /plans/<id> directly, or from a card. Then the row is
//   fetched and the drawing pulled out of the bucket, because there is no local
//   copy of either.
//
// THE ONE THING THAT MUST WAIT is a write. A drop navigates before the INSERT
// has landed, so for a second or two there is a plan on screen whose row does
// not exist yet — and an UPDATE against it would fail with "0 rows" and be
// reported as a save error. So every write awaits `whenRowReady`, which resolves
// as soon as the insert returns (not when the upload finishes) and resolves
// immediately for plans opened from a list.
//
// THE SAVE IS DEBOUNCED. Dragging a strip fires a state change per pointermove;
// writing on each would be a hundred requests for one gesture. 1.5 seconds of
// quiet, then one write, of the LATEST payload — an intermediate state mid-drag
// has no value, only where the strip ended up does. Flushed on pagehide and on
// unmount, which is what catches "Back to Projects" clicked half a second after
// the last nudge.
//
// AND IT IS ALSO WHERE THE MONEY IS. App.jsx does not know what a subscription
// is any more than it knows what Supabase is; it knows that lighting a space has
// to be CLAIMED and that a refused claim means do nothing. This route supplies
// the three functions that make a claim mean something, and it owns what the user
// sees when one is refused — the paywall opens OVER the editor, so ten traced
// rooms are still on screen behind it and closing it puts the user back exactly
// where they were. Sending them to /pricing would unmount the drawing.
//
// AND MIRRORED LOCALLY THE INSTANT IT ARRIVES. The debounce plus the round trip
// is a window — a second or two wide — in which the newest edit lives only in
// React state, and a reload inside it used to lose that edit. The unload flush
// does not close the window, because a fetch still in flight when the document
// goes away is cancelled by the browser: it lands sometimes, which is precisely
// what "sometimes I lose the lights the render pass placed" was. So every
// payload is written to localStorage synchronously (lib/draft.js) before the
// timer is even set, and deleted when the real write lands. A draft still
// present on open is evidence that the last write did not finish, and it wins.
// ---------------------------------------------------------------------------

const QUIET_MS = 1500;

/** serialiseEditor stamps every state it emits; this is that stamp as a number. */
const stampOf = (st) => {
  const t = Date.parse(st?.savedAt ?? '');
  return Number.isNaN(t) ? 0 : t;
};

export default function Planner() {
  const { planId } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { isAdmin } = useAuth();
  const { claimLayout, claimPass, releasePass } = useBilling();
  // The server's refusal, held so the paywall can say what was short by how
  // much. Null the rest of the time, which is nearly always.
  const [refusal, setRefusal] = useState(null);

  // Read once, synchronously, before the first paint: if this is a drop, the
  // file and a row-shaped placeholder are available immediately and the editor
  // can start on them. `useState(fn)` rather than an effect for exactly that
  // reason — an effect would give the user one frame of a spinner for no reason.
  const [job] = useState(() => getJob(planId));
  const [plan, setPlan] = useState(() => (job ? (job.plan ?? provisionalPlan(job)) : null));
  const [file, setFile] = useState(() => job?.file ?? loc.state?.file ?? null);
  const [upload, setUpload] = useState(() => (job ? job.status : null));
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState('idle');   // idle | dirty | saving | saved | error
  // THE PROJECT'S CATEGORY, AS A FALLBACK FOR THE PLAN'S. See the note by the
  // effect that fetches it.
  const [projectType, setProjectType] = useState(null);

  // READ ONCE, AT MOUNT, and before anything can overwrite it. A draft is only
  // ever interesting in comparison with the row that is about to arrive.
  const [draft] = useState(() => readDraft(planId));
  const warnedDraft = useRef(false);

  // --- the job, as it progresses --------------------------------------------
  useEffect(() => {
    if (!job) return;
    setUpload(job.status);
    const off = subscribeJob(planId, (j) => {
      setUpload(j.status);
      // The real row replaces the placeholder the moment the insert returns —
      // which is what gives Back to Projects somewhere to go.
      if (j.plan) setPlan((prev) => ({ ...(prev || {}), ...j.plan, provisional: false }));
      if (j.status === 'error' && !j.plan) {
        setErr(String(j.error?.message || j.error || 'The upload failed'));
      }
    });
    return off;
  }, [job, planId]);

  // Long sessions should not hold every drawing the user has opened.
  useEffect(() => () => releaseJob(planId), [planId]);

  // --- a plan opened from a link -------------------------------------------
  useEffect(() => {
    if (job) return;                       // a drop; nothing to fetch
    let alive = true;
    (async () => {
      try {
        const row = await getPlan(planId);
        if (!alive) return;
        setPlan(row);
        touchPlanOpened(planId);
        // THE CATEGORY IS ASKED ONCE PER BUILDING, so a plan that does not carry
        // one is not a question — it is a plan that was added before its
        // project was classified. `project_type` is stamped onto a plan row at
        // INSERT and never revisited, so the chooser on the project screen
        // leaves every existing plan's copy null. Reading the project's answer
        // here is what stops the editor asking again.
        if (!row.project_type && row.project_id) {
          try {
            const proj = await getProject(row.project_id);
            if (alive) setProjectType(proj?.project_type ?? null);
          } catch { /* the dialog is the fallback, and it still works */ }
        }
        if (!loc.state?.file) {
          const f = await fetchPlanFile(row);
          if (alive) setFile(f);
        }
      } catch (e) {
        if (alive) setErr(String(e.message || e));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, job]);

  // --- the debounce ---------------------------------------------------------
  const pending = useRef(null);
  const timer = useRef(null);
  const writing = useRef(false);
  // THE STAMP OF THE NEWEST editor_state THIS TAB HAS SUCCESSFULLY WRITTEN.
  // A milestone is slow — it renders a PNG and uploads it before it updates the
  // row — so the state it captured when it was fired can be several seconds old
  // by the time it writes, and an autosave that happened in between would be
  // overwritten by it. Comparing stamps is how a late milestone is stopped from
  // walking backwards over a newer save.
  const wroteAt = useRef(0);
  const planRef = useRef(null);
  planRef.current = plan;

  const flush = useCallback(async () => {
    const p = pending.current;
    const row = planRef.current;
    if (!p || !row || writing.current) return;
    pending.current = null;
    writing.current = true;
    setSaveState('saving');
    try {
      // THE ONLY PLACE THIS ROUTE BLOCKS. On a drop the first edits can easily
      // beat the insert; without this they would fail against a row that does
      // not exist yet.
      await whenRowReady(planId);

      const patch = { editor_state: p.editorState, stats: p.stats, status: p.status };
      const d = p.getDesign?.();
      // Only when there is one: a plan mid-trace has no layout, and writing null
      // over a design because somebody reopened the plan and moved a wall is data
      // loss with a helpful-looking cause.
      if (d?.design) { patch.design_json = d.design; patch.boq_json = d.boq ?? null; }
      if (d?.pxPerFt) patch.px_per_ft = d.pxPerFt;
      if (d?.width) { patch.width = d.width; patch.height = d.height; }
      if (d?.units) patch.units = d.units;
      if (d?.projectType) patch.project_type = d.projectType;

      await updatePlan(row.id, patch);
      wroteAt.current = Math.max(wroteAt.current, stampOf(p.editorState));
      // ONLY WHEN NOTHING NEWER IS ALREADY QUEUED. `pending.current` was
      // emptied at the top of this flush; if it has been refilled since, the
      // draft now describes an edit this write did not carry and deleting it
      // would reopen the very window this exists to close.
      if (!pending.current) clearDraft(planId);
      setSaveState('saved');
    } catch (e) {
      console.error('[planner] save failed', e);
      setSaveState('error');
      setErr(String(e.message || e));
    } finally {
      writing.current = false;
      if (pending.current) { clearTimeout(timer.current); timer.current = setTimeout(flush, 250); }
    }
  }, [planId]);

  const onPersist = useCallback((payload) => {
    // FIRST, AND SYNCHRONOUSLY. No await, no network, nothing that can be
    // cancelled by an unload. Everything below this line is best-effort.
    saveDraft(planId, payload.editorState);
    pending.current = payload;
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, QUIET_MS);
  }, [flush, planId]);

  useEffect(() => {
    const bye = () => { if (pending.current) flush(); };
    // PAGEHIDE, NOT ONLY BEFOREUNLOAD. beforeunload does not fire at all on a
    // backgrounded mobile tab that is later discarded, and neither event can
    // hold the document open for an async write — the draft in localStorage is
    // what actually guarantees the edit survives. These two just give the real
    // write its best chance to get out first.
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      window.removeEventListener('beforeunload', bye);
      bye(); clearTimeout(timer.current);
    };
  }, [flush]);

  /**
   * A MILESTONE, which is the expensive save: the PNG is rendered and uploaded
   * and a row is appended to plan_revisions. Called when something has actually
   * been achieved — the spaces were confirmed, the pipeline finished, a design
   * was exported — because those are the training corpus and a corpus of
   * autosaves would be 95% pointer-move noise.
   */
  const onMilestone = useCallback(async (kind, payload) => {
    const row = planRef.current;
    if (!row) return;
    try {
      setSaveState('saving');
      await whenRowReady(planId);
      const d = payload.getDesign?.() ?? {};
      let snapshotPath = row.snapshot_path ?? null;
      const blob = await payload.getSnapshot?.();
      if (blob) snapshotPath = await uploadSnapshot(row, blob);

      const patch = { snapshot_path: snapshotPath };
      // THE STATE ONLY IF IT IS STILL THE NEWEST. Everything above this line —
      // the design serialisation, the PNG, the upload — takes seconds, and the
      // autosave does not stop running while it happens. Writing the captured
      // state unconditionally is how a plan loses whatever was done during a
      // milestone's upload, which for a render pass run right after "light up
      // the space" is the entire render pass.
      const mine = stampOf(payload.editorState);
      if (mine >= wroteAt.current) {
        patch.editor_state = payload.editorState;
        patch.stats = payload.stats;
        patch.status = payload.status;
        wroteAt.current = mine;
      } else {
        console.warn('[planner] milestone state is behind the last save — '
          + 'writing the snapshot only');
      }
      if (d.design) { patch.design_json = d.design; patch.boq_json = d.boq ?? null; }
      if (d.pxPerFt) patch.px_per_ft = d.pxPerFt;
      if (d.width) { patch.width = d.width; patch.height = d.height; }
      if (d.units) patch.units = d.units;
      if (d.projectType) patch.project_type = d.projectType;
      await updatePlan(row.id, patch);
      setPlan((r) => (r ? { ...r, ...patch } : r));

      await recordRevision(row, {
        kind,
        editorState: payload.editorState,
        designJson: d.design ?? null,
        boqJson: d.boq ?? null,
        snapshotPath,
        stats: payload.stats,
      });
      setSaveState('saved');
    } catch (e) {
      console.error('[planner] milestone save failed', e);
      setSaveState('error');
    }
  }, [planId]);

  /**
   * THE BUCKET, FOR THE RENDER PASS — and the only Supabase this route hands
   * the editor.
   *
   * App.jsx stays a pure editor over a File (see the header): it knows how to
   * shrink a render and how to draw one, and nothing about where it lives. So
   * it gets two functions rather than a client. `put` returns the storage path,
   * which is what goes into editor_state; `url` turns one back into something
   * an <img> and a fetch can both use.
   *
   * NULL WHEN THERE IS NO ROW YET. On a drop the editor is running against a
   * provisional plan for a second or two; an upload against it would land under
   * "undefined/" and fail the storage policy. A render dropped in that window
   * simply is not stored, and the pass runs on it regardless.
   */
  const renderStore = useMemo(() => ({
    put: async (blob, meta) => {
      const row = planRef.current;
      if (!row || row.provisional) return null;
      await whenRowReady(planId);
      return uploadRender(row, blob, meta);
    },
    url: (path) => publicUrl(path),
  }), [planId]);

  /**
   * THE THREE CLAIM FUNCTIONS HANDED TO THE EDITOR.
   *
   * ALL THREE SWALLOW THEIR OWN FAILURES AND RETURN `{ ok: false }`, because the
   * editor calls them from inside click handlers that have already begun. A
   * rejected promise there is an unhandled rejection halfway through a state
   * transition; a `false` is a click that did nothing, which is what the user
   * should see when the till cannot be reached.
   *
   * A NETWORK FAILURE IS NOT A REFUSAL AND IS NOT SHOWN AS ONE. The paywall says
   * "buy more"; a timeout is not a reason to ask anybody for money, so it goes to
   * the error banner instead.
   */
  const onClaimLayout = useCallback(async ({ spaces }) => {
    try {
      // AWAIT THE ROW, FOR THE SAME REASON EVERY WRITE IN THIS FILE DOES.
      //
      // On a drop the plan id is minted in the browser (uploads.js) and the
      // editor opens on a provisional row while the INSERT is still in flight.
      // The claim checks ownership with `plans?id=eq.…&owner=eq.…`, which finds
      // nothing until that insert lands — so a DXF whose rooms were detected
      // instantly, lit by somebody quick, would be refused with "No such plan"
      // and would look for all the world like a billing bug. Same window, same
      // guard, same one line as `flush()`.
      await whenRowReady(planId);
      const row = planRef.current;
      // `planId` FROM THE ROUTE, NEVER FROM THE EDITOR. The plan id is what the
      // server checks ownership against, and it is not App.jsx's to know or to
      // send.
      const out = await claimLayout({ planId: row?.id ?? planId, spaces });
      if (out.ok) return { ok: true };
      setRefusal(out);
      return { ok: false };
    } catch (e) {
      console.error('[planner] the layout claim failed', e);
      setErr(String(e.message || e));
      return { ok: false };
    }
  }, [claimLayout, planId]);

  const onClaimPass = useCallback(async ({ roomId, runId }) => {
    try {
      await whenRowReady(planId);
      const row = planRef.current;
      const out = await claimPass({ planId: row?.id ?? planId, roomId, runId });
      if (out.ok) return { ok: true, fingerprint: out.fingerprint };
      setRefusal(out);
      return { ok: false };
    } catch (e) {
      console.error('[planner] the render-pass claim failed', e);
      setErr(String(e.message || e));
      return { ok: false };
    }
  }, [claimPass, planId]);

  const rename = useCallback(async (name) => {
    const row = planRef.current;
    if (!row || !name.trim() || name === row.name) return;
    setPlan((r) => ({ ...r, name }));               // optimistic: it is a text field
    try {
      await whenRowReady(planId);
      await updatePlan(row.id, { name: name.trim() });
    } catch (e) { setErr(String(e.message || e)); }
  }, [planId]);

  if (err && !plan) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-[min(460px,92%)] bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8] border border-border/10 rounded-lg p-6 text-center">
          <h2 className="m-0 mb-2.5 text-lg tracking-[-0.025em]">This plan could not be opened</h2>
          <p className="m-0 mb-3.5 text-[12.5px] text-muted leading-[1.6]">{err}</p>
          <button
            className="text-xs leading-[1.5] px-3 py-[7px] rounded border border-border/10 bg-surface backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3"
            onClick={() => nav('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!plan || !file) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="lp-spin w-[26px] h-[26px]" aria-label="Loading the drawing" />
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">{plan ? 'Reading the drawing…' : 'Opening…'}</p>
      </div>
    );
  }

  // WHICH STATE THIS OPENS ON. Normally the row. A draft that is newer than the
  // row means the last write did not complete — a reload inside the debounce, a
  // tab closed mid-request, a dropped connection — and it is the only copy of
  // that work in existence, so it wins. See lib/draft.js.
  const chosen = pickRestore(plan.editor_state ?? null, draft);
  if (chosen.from === 'draft' && !warnedDraft.current) {
    warnedDraft.current = true;
    console.log('[planner] restoring unsaved local work', {
      aheadMs: chosen.aheadMs, savedAt: chosen.state?.savedAt });
  }

  return (
    <>
    {refusal && <Paywall refusal={refusal} onClose={() => setRefusal(null)} />}
    <App
      key={plan.id}
      planName={plan.name}
      initialFile={file}
      initialProjectType={plan.project_type ?? projectType}
      initialPdfPage={chosen.state?.pdfPage ?? null}
      restore={chosen.state}
      saveState={saveState}
      uploadState={upload}
      isAdmin={isAdmin}
      onRetryUpload={() => retryUpload(planId)}
      onRename={rename}
      renderStore={renderStore}
      onClaimLayout={onClaimLayout}
      onClaimPass={onClaimPass}
      onReleasePass={releasePass}
      onPersist={onPersist}
      onMilestone={onMilestone}
      onBack={() => nav(plan.project_id ? `/projects/${plan.project_id}` : '/dashboard')}
    />
    </>
  );
}
