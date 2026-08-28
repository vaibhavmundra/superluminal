import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import App from '../App.jsx';
import { getPlan, updatePlan, fetchPlanFile, uploadSnapshot, recordRevision, touchPlanOpened }
  from '../lib/db.js';
import { getJob, subscribeJob, whenRowReady, retryUpload, releaseJob, provisionalPlan }
  from '../lib/uploads.js';
import { useAuth } from '../lib/auth.jsx';

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
// has no value, only where the strip ended up does. Flushed on beforeunload and
// on unmount, which is what catches "Back to Projects" clicked half a second
// after the last nudge.
// ---------------------------------------------------------------------------

const QUIET_MS = 1500;

export default function Planner() {
  const { planId } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { isAdmin } = useAuth();

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
    pending.current = payload;
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, QUIET_MS);
  }, [flush]);

  useEffect(() => {
    const bye = () => { if (pending.current) flush(); };
    window.addEventListener('beforeunload', bye);
    return () => { window.removeEventListener('beforeunload', bye); bye(); clearTimeout(timer.current); };
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

      const patch = {
        editor_state: payload.editorState,
        stats: payload.stats,
        status: payload.status,
        snapshot_path: snapshotPath,
      };
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
      <div className="page-centre">
        <div className="notice-card">
          <h2>This plan could not be opened</h2>
          <p>{err}</p>
          <button className="btn" onClick={() => nav('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!plan || !file) {
    return (
      <div className="page-centre">
        <div className="spinner" aria-label="Loading the drawing" />
        <p className="note">{plan ? 'Reading the drawing…' : 'Opening…'}</p>
      </div>
    );
  }

  return (
    <App
      key={plan.id}
      planName={plan.name}
      initialFile={file}
      initialProjectType={plan.project_type ?? null}
      initialPdfPage={plan.editor_state?.pdfPage ?? null}
      restore={plan.editor_state ?? null}
      saveState={saveState}
      uploadState={upload}
      isAdmin={isAdmin}
      onRetryUpload={() => retryUpload(planId)}
      onRename={rename}
      onPersist={onPersist}
      onMilestone={onMilestone}
      onBack={() => nav(plan.project_id ? `/projects/${plan.project_id}` : '/dashboard')}
    />
  );
}
