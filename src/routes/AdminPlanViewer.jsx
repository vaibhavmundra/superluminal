import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import App from '../App.jsx';
import ViewingAs from '../components/ViewingAs.jsx';
import { adminPlan } from '../lib/admin.js';
import { fetchPlanFile } from '../lib/db.js';

// ---------------------------------------------------------------------------
// SOMEBODY ELSE'S PLAN, ON THE REAL CANVAS.
//
// The mirror of routes/Planner.jsx, and the differences are all subtractions:
//
//   the row      comes from /api/admin rather than from a select the caller's
//                RLS would refuse. Whole, jsonb included — `editor_state` IS the
//                drawing's interpretation and the viewer restores from it
//                exactly as the editor does.
//   the drawing  comes out of the `uploads` bucket by its public URL, which is
//                the same path fetchPlanFile already takes for the owner. The
//                bucket is public-read by design (see the storage note in
//                0001_init.sql), so no signed URL and no second permission model
//                — the permission that mattered was the one on the ROW, and it
//                has already been checked server-side.
//   the writes   are simply not passed. No onPersist, no onMilestone, no
//                onRename. App guards all three with `if (!fn) return`, so the
//                autosave never arms and no revision is ever appended.
//
// AND THEN `readOnly` ON TOP OF THAT, which is the part that matters: not
// passing the writers stops the app SAVING, but it would not stop it acting —
// the detectors would still fire on a plan that has no lit rooms, Delete would
// still take a fitting off the canvas, and the operator would be looking at a
// drawing that no longer matches the one the user has. See the prop's own note
// in App.jsx.
//
// WHY THE FILE IS FETCHED AT ALL, when there is a snapshot PNG sitting in the
// row. Because the snapshot is a picture and this screen is not a picture: hover
// a fitting and it must say what it is, open the BOQ and it must count what is
// there, hit Export and a DXF must come out in the drawing's own coordinates.
// All of that is computed from the drawing plus the state, which means the
// drawing has to be here.
// ---------------------------------------------------------------------------
export default function AdminPlanViewer() {
  const { planId } = useParams();
  const nav = useNavigate();

  const [row, setRow] = useState(null);      // { plan, owner, project }
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setRow(null); setFile(null); setErr('');
    (async () => {
      try {
        const d = await adminPlan(planId);
        if (!alive) return;
        setRow(d);
        // DELIBERATELY NOT touchPlanOpened. An operator looking at a drawing must
        // not move `last_opened_at` on it — that column is the user's own record
        // of when they were last in there, and quietly rewriting it from this
        // screen is both a write on a read-only page and a small lie in their
        // data.
        const f = await fetchPlanFile(d.plan);
        if (alive) setFile(f);
      } catch (e) {
        if (alive) setErr(String(e.message || e));
      }
    })();
    return () => { alive = false; };
  }, [planId]);

  if (err) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-[min(460px,92%)] bg-surface border border-border rounded-lg p-6 text-center">
          <h2 className="mt-0 mb-[10px] text-[18px] tracking-[-0.025em]">This plan could not be opened</h2>
          <p className="mt-0 mb-[14px] text-muted text-[12.5px] leading-[1.6]">{err}</p>
          <button className="text-[12px] py-[7px] px-3 rounded border border-border bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3" onClick={() => nav('/admin/users')}>Back to users</button>
        </div>
      </div>
    );
  }

  if (!row || !file) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-[26px] h-[26px] rounded-full border-2 border-border border-t-accent animate-[sl-spin_0.8s_linear_infinite]" aria-label="Loading the drawing" />
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">{row ? 'Reading their drawing…' : 'Opening…'}</p>
      </div>
    );
  }

  const { plan, owner, project } = row;

  return (
    // THE BANNER IS OUTSIDE THE EDITOR AND ABOVE IT. App fills its container and
    // owns its own top bar; wrapping rather than threading a banner prop through
    // 4,500 lines keeps the editor unaware that this mode exists beyond the one
    // flag it actually needs.
    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full">
      <ViewingAs flush user={owner} userId={plan.owner} plan={plan.id} project={project?.id} />
      {/* `[&>*]:h-full` rather than a class on App's own root: App.jsx is still
          on the old stylesheet (it converts last), so the stage stretches its
          child from out here and stops caring what that child is called. */}
      <div className="min-h-0 relative [&>*]:h-full">
        <App
          key={plan.id}
          readOnly
          planName={plan.name}
          initialFile={file}
          initialProjectType={plan.project_type ?? null}
          initialPdfPage={plan.editor_state?.pdfPage ?? null}
          restore={plan.editor_state ?? null}
          /* The audit overlays stay available — whoever is on this screen is by
             definition role 1, and "what did the detector actually decide" is
             most of the reason to be looking at somebody else's plan. */
          isAdmin
          onBack={() => nav(project?.id
            ? `/admin/users/${plan.owner}/projects/${project.id}`
            : `/admin/users/${plan.owner}`)}
        />
      </div>
    </div>
  );
}
