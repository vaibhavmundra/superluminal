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
import ShareDialog from '../components/ShareDialog.jsx';
import { useContactGate } from '../components/ContactGate.jsx';
import { myAccess } from '../lib/sharing.js';
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
  const { isAdmin, user } = useAuth();
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
  // THE PROJECT'S CATEGORY, AS A FALLBACK FOR THE PLAN'S, and the project row
  // it came out of — which the share dialog needs for its name. See the note by
  // the effect that fetches them.
  const [projectType, setProjectType] = useState(null);
  const [project, setProject] = useState(null);

  // --- WHOSE PLAN IS THIS, AND WHAT MAY I DO TO IT -------------------------
  //
  // 'owner' | 'edit' | 'view' | null, and undefined while we do not yet know.
  //
  // THE UNDEFINED STATE IS THE POINT. A plan reached from "Shared with me" is
  // fetched by exactly the same select as your own — RLS lets both through, and
  // the row does not say which one it was. So there is a window between the row
  // arriving and the access being known, and the editor must not be writable
  // during it: a viewer whose autosave armed for half a second would fire one
  // update the policies refuse, and the screen would open with a red "save
  // failed" on a plan they were only ever going to look at.
  //
  // A `null` answer on somebody else's plan is not "no access" — the select
  // already proved otherwise — it is a share that was revoked between the two
  // queries. It reads as view, which is the safe way to be wrong.
  //
  // SEEDED SYNCHRONOUSLY FOR A DROP, and that is not a micro-optimisation — it
  // is the rule this whole file is built on. `job`, `plan` and `file` are all
  // read with `useState(fn)` rather than in an effect precisely so a dropped
  // drawing paints the editor on the first frame; letting the access arrive one
  // effect later would put a spinner in front of every upload for no reason at
  // all, since a drop is your own drawing by construction.
  const [access, setAccess] = useState(() => (job ? 'owner' : undefined));
  const [shareOpen, setShareOpen] = useState(false);

  // THE TWO QUESTIONS IN FRONT OF THE FIRST DOWNLOAD — a WhatsApp number and an
  // occupation, asked once, ever. The hook owns the promise and the dialog; App
  // gets a plain async function it awaits before every export. See
  // components/ContactGate.jsx, and src/lib/profile.js for why this moment and
  // not the sign-up form.
  const { onBeforeExport, contactDialog } = useContactGate();

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
        // THE PROJECT, AND IT IS FETCHED UNCONDITIONALLY NOW.
        //
        // It used to be read only when the plan carried no `project_type`, for
        // the reason still worth keeping: the category is asked once per
        // BUILDING, so a plan without one is not a question — it is a plan that
        // was added before its project was classified, and reading the
        // project's answer here is what stops the editor asking again.
        //
        // What changed is that the share dialog needs the project's NAME to say
        // what it is about to share, and "this project" is a poor thing to read
        // in a dialog that grants somebody access to a building. It is one more
        // select of four small columns against a primary key, on a screen that
        // is already fetching a multi-megabyte drawing.
        if (row.project_id) {
          try {
            const proj = await getProject(row.project_id);
            if (alive) { setProject(proj ?? null); setProjectType(proj?.project_type ?? null); }
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

  // --- and what may I do to it ---------------------------------------------
  //
  // TWO CHEAP ANSWERS BEFORE THE QUERY. A drop is your own drawing by
  // construction — the row does not exist yet and you are the one uploading it —
  // and a plan whose `owner` is you needs no lookup either. Only the third case,
  // a row that came back through a share, costs a round trip, and it is the rare
  // one.
  useEffect(() => {
    if (job) { setAccess('owner'); return undefined; }
    const me = user?.id ?? null;
    if (!plan || !me) return undefined;
    if (plan.owner && plan.owner === me) { setAccess('owner'); return undefined; }
    // The standalone case: no project to hang a share on, so there is nothing
    // this could be but your own.
    if (!plan.project_id) { setAccess('owner'); return undefined; }

    let alive = true;
    setAccess(undefined);
    (async () => {
      try {
        const a = await myAccess(plan.project_id, plan.owner ?? null);
        // See the note on the state: a missing row here means the share went
        // away underneath us, and view is the safe way to be wrong.
        if (alive) setAccess(a ?? 'view');
      } catch (e) {
        console.warn('[planner] could not read the share role — opening read only', e);
        if (alive) setAccess('view');
      }
    })();
    return () => { alive = false; };
    // THE THREE FIELDS, NOT THE ROW. `plan` is replaced whenever a milestone
    // patches it or the name is edited, and depending on the object would
    // re-run this on every save — which for a shared editor means a query per
    // milestone AND a flash back through `undefined`, unmounting the editor
    // mid-write. Nothing but these three can change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, plan?.id, plan?.owner, plan?.project_id, user?.id]);

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

  // AND THE ACCESS IS A THIRD THING TO WAIT FOR, alongside the row and the
  // drawing. Rendering the editor before it is known would open a shared plan
  // writable for one frame — see the note on the state. In the overwhelmingly
  // common case (your own plan, or a drop) it is settled without a query and
  // this branch is never seen.
  if (!plan || !file || access === undefined) {
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

  // --- WHAT THIS SESSION MAY DO -------------------------------------------
  //
  // ONE BOOLEAN, AND EVERY WRITE HANGS OFF IT. A 'view' share gets the editor
  // with the writers simply not passed — the same subtraction routes/
  // AdminPlanViewer.jsx makes, and for the same reason: App guards all of them
  // with `if (!fn) return`, so the autosave never arms and no revision is ever
  // appended. `readOnly` on top of that is what stops it ACTING as well as
  // saving — the detectors, the tracer, Delete — see the prop's note in App.jsx.
  //
  // AN EDITOR GETS EVERYTHING AN OWNER GETS except the share button. Managing
  // who else can see a project is an act of ownership, the RLS says so, and a
  // button that opens a dialog whose every write will be refused is worse than
  // no button.
  const canEdit = access === 'owner' || access === 'edit';
  const isOwner = access === 'owner';

  return (
    <>
    {refusal && <Paywall refusal={refusal} onClose={() => setRefusal(null)} />}
    {/* OVER THE EDITOR, EXACTLY AS THE PAYWALL IS. Sending somebody to a
        settings screen to share the thing they are looking at would unmount the
        drawing; the dialog closes and the plan is still there, untouched. */}
    {shareOpen && plan.project_id && (
      <ShareDialog projectId={plan.project_id} projectName={project?.name ?? ''}
        onClose={() => setShareOpen(false)} />
    )}
    {/* ABOVE THE EDITOR AND ABOVE THE SHARE DIALOG, which is the right stacking:
        an export is only reachable from the panel underneath both. */}
    {contactDialog}
    <App
      key={plan.id}
      planName={plan.name}
      /* THE ROW'S ID AND NOT THE ROUTE'S PARAM, the same rule the claims above
         follow — except inverted, because here the two are interchangeable and
         the row is simply the more canonical of them. The editor uses it as a
         storage key and nothing else; see `planId` in App.jsx. */
      planId={plan.id ?? planId}
      initialFile={file}
      initialProjectType={plan.project_type ?? projectType}
      initialPdfPage={chosen.state?.pdfPage ?? null}
      restore={chosen.state}
      saveState={canEdit ? saveState : 'idle'}
      uploadState={upload}
      isAdmin={isAdmin}
      readOnly={!canEdit}
      onRetryUpload={() => retryUpload(planId)}
      onRename={canEdit ? rename : null}
      renderStore={canEdit ? renderStore : null}
      onClaimLayout={canEdit ? onClaimLayout : null}
      onClaimPass={canEdit ? onClaimPass : null}
      onReleasePass={canEdit ? releasePass : null}
      onPersist={canEdit ? onPersist : null}
      onMilestone={canEdit ? onMilestone : null}
      onShare={isOwner && plan.project_id ? () => setShareOpen(true) : null}
      /* GATED FOR A VIEWER TOO, and not only for whoever can edit. A 'view'
         share still has every export button — that is most of the point of
         being given one — so the question belongs there as much as here. */
      onBeforeExport={onBeforeExport}
      onBack={() => nav(plan.project_id ? `/projects/${plan.project_id}` : '/dashboard')}
    />
    </>
  );
}
