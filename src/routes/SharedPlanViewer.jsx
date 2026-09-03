import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import App from '../App.jsx';
import SharedBanner from '../components/SharedBanner.jsx';
import { useContactGate } from '../components/ContactGate.jsx';
import { openSharedPlan } from '../lib/sharing.js';
import { fetchPlanFile } from '../lib/db.js';

// ---------------------------------------------------------------------------
// ONE PLAN, BEHIND A VIEW LINK, ON THE REAL CANVAS.
//
// routes/AdminPlanViewer.jsx WITH ONE WORD CHANGED, and every note in that file
// applies here unaltered — the row arrives whole from a server endpoint because
// `editor_state` IS the drawing's interpretation and the viewer restores from it
// exactly as the editor does; the drawing itself comes out of the public
// `uploads` bucket, because the permission that mattered was the one on the ROW
// and it has already been checked; the writers are simply not passed, so the
// autosave never arms; and `readOnly` on top of that is what stops the editor
// ACTING as well as saving.
//
// THE TWO REAL DIFFERENCES:
//
//   NO isAdmin. The audit overlays exist for whoever is tuning the detectors and
//   there is no version of a client link where "what did the bed detector
//   decide" belongs on screen.
//
//   THE BANNER IS THE QUIET ONE. See SharedBanner for why this is not magenta.
//
// AND LIKE routes/SharedProject.jsx, NOBODY WITH A REAL GRANT EVER SEES IT. If
// the endpoint says this caller is the owner, an editor, or a named viewer, they
// go to /plans/:id — the ordinary editor, which opens with exactly the access
// their share row grants and nothing more. A link points at a project; it does
// not take rights away from the person following it.
//
// WHY THE FILE IS FETCHED AT ALL, when the row carries a snapshot PNG: because
// this screen is not a picture. Hover a fitting and it says what it is, open the
// BOQ and it counts what is there, hit Export and a DXF comes out in the
// drawing's own coordinates — all computed from the drawing plus the state,
// which means the drawing has to be here.
// ---------------------------------------------------------------------------
export default function SharedPlanViewer() {
  const { token, planId } = useParams();
  const nav = useNavigate();

  const [row, setRow] = useState(null);          // { plan, project }
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');

  // ASKED HERE TOO, AND THIS IS ARGUABLY THE BEST PLACE IN THE APP FOR IT.
  // Somebody on this screen followed a link, signed up to read it, and is now
  // downloading a drawing — a brand new account with nothing on its profile,
  // taking a file away. See components/ContactGate.jsx.
  const { onBeforeExport, contactDialog } = useContactGate();

  useEffect(() => {
    let alive = true;
    setRow(null); setFile(null); setErr('');
    (async () => {
      try {
        const d = await openSharedPlan(token, planId);
        if (!alive) return;
        setRow(d);
        // AND STOP HERE IF THEY ARE ABOUT TO BE REDIRECTED. The fetch below pulls
        // the whole drawing out of the bucket — routinely megabytes — and a
        // grant-holder is leaving this screen the moment React renders again, so
        // downloading it would be paying for a file twice and delaying the
        // redirect by however long the larger of the two takes.
        if (d.grant) return;
        // DELIBERATELY NOT touchPlanOpened, for the reason AdminPlanViewer gives:
        // `last_opened_at` is the owner's own record of when THEY were last in
        // there, and a visitor rewriting it is both a write on a read-only page
        // and a small lie in somebody else's data. It would also be refused —
        // the update policy does not know this token exists.
        const f = await fetchPlanFile(d.plan);
        if (alive) setFile(f);
      } catch (e) {
        if (alive) setErr(String(e.message || e));
      }
    })();
    return () => { alive = false; };
  }, [token, planId]);

  if (err) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-[min(460px,92%)] bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8] border border-border/10 rounded-lg p-6 text-center">
          <h2 className="m-0 mb-2.5 text-lg tracking-[-0.025em]">This plan could not be opened</h2>
          <p className="m-0 mb-3.5 text-[12.5px] text-muted leading-[1.6]">{err}</p>
          <button
            className="text-xs leading-[1.5] px-3 py-[7px] rounded border border-border/10 bg-surface backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3"
            onClick={() => nav(`/shared/${token}`)}>Back to the project</button>
        </div>
      </div>
    );
  }

  // BEFORE THE WAIT FOR THE FILE, NOT AFTER IT. See the header. The effect above
  // does not even start that download for somebody who is leaving, so this
  // branch has to come first or the screen would sit on a spinner waiting for a
  // fetch that is never going to happen. `replace` so Back does not bounce off
  // the redirect and straight back into it.
  if (row?.grant) return <Navigate to={`/plans/${row.plan.id}`} replace />;

  if (!row || !file) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="lp-spin w-[26px] h-[26px]" aria-label="Loading the drawing" />
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">{row ? 'Reading the drawing…' : 'Opening…'}</p>
      </div>
    );
  }

  const { plan, project } = row;

  return (
    // THE BANNER IS OUTSIDE THE EDITOR AND ABOVE IT. App fills its container and
    // owns its own top bar; wrapping rather than threading a banner prop through
    // 8,000 lines keeps the editor unaware that this mode exists beyond the one
    // flag it actually needs.
    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full">
      {contactDialog}
      <SharedBanner projectName={project?.name ?? ''} planName={plan.name}
        backTo={`/shared/${token}`} />
      <div className="min-h-0 relative [&>*]:h-full">
        <App
          key={plan.id}
          readOnly
          planName={plan.name}
          initialFile={file}
          initialProjectType={plan.project_type ?? project?.project_type ?? null}
          initialPdfPage={plan.editor_state?.pdfPage ?? null}
          restore={plan.editor_state ?? null}
          onBeforeExport={onBeforeExport}
          onBack={() => nav(`/shared/${token}`)}
        />
      </div>
    </div>
  );
}
