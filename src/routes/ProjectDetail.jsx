import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import PlanCard from '../components/PlanCard.jsx';
import { when } from './Dashboard.jsx';
import { getProject, listPlans, renameProject, deletePlan, setProjectType,
         subscribePlans, coalesce } from '../lib/db.js';
import { startPlanUpload } from '../lib/uploads.js';
import { PROJECT_TYPES } from '../lib/roomTypes.js';

// ---------------------------------------------------------------------------
// ONE PROJECT, AND THE PLANS IN IT.
//
// The name is editable in place rather than behind a dialog, because a project
// created automatically from a filename is a name nobody chose and the first
// thing anybody does here is fix it. A click on the heading is the whole
// interaction; blur or Enter commits, Escape reverts.
// ---------------------------------------------------------------------------
export default function ProjectDetail() {
  const { projectId } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState(null);
  const [plans, setPlans] = useState(null);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [p, ps] = await Promise.all([getProject(projectId), listPlans(projectId)]);
      setProject(p); setPlans(ps);
    } catch (e) { setErr(String(e.message || e)); setPlans([]); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribePlans(projectId, coalesce(load, 400)), [projectId, load]);

  const commitName = async () => {
    const name = draftName.trim();
    setEditing(false);
    if (!name || name === project?.name) return;
    try { setProject(await renameProject(projectId, name)); }
    catch (e) { setErr(String(e.message || e)); }
  };

  const upload = useCallback(async (file) => {
    if (!file) return;
    const ok = /\.(dxf|pdf)$/i.test(file.name)
      || (file.type || '').startsWith('image/')
      || file.type === 'application/pdf';
    if (!ok) { setErr('A DXF, a PDF or an image of a plan, please.'); return; }
    setErr('');
    // Into THIS project, explicitly — the automatic project only happens when
    // there is no context to put a drawing in, and here there is. The category
    // rides along from the project, so the editor never asks.
    const job = startPlanUpload(file, { projectId });
    nav(`/plans/${job.planId}`);
  }, [projectId, nav]);

  return (
    <div className="shell">
      <ProfileRail />
      {/* A COLUMN, SO THE BAR CAN STAY WHILE THE PLANS SCROLL UNDER IT. The
          shell's second grid cell used to be the scrolling body itself; it is now
          a two-row grid — bar, then body — and the body keeps the scrolling and
          the drop handling. `min-height:0` on the column is what actually lets
          the body scroll: without it a grid item takes its content's height and
          the whole page scrolls instead, taking the bar with it. */}
      <div className="shell-col">
        {/* THE SAME BAR AS THE EDITOR'S, and deliberately so. Both screens
            answer the same three questions in the same corner — where am I, how
            do I get back, what is the one thing to do here — and answering them
            in two different shapes made moving between the two screens feel like
            moving between two apps. Translucent white over a hairline, 56px, the
            back arrow and the name on the left and the primary action on the
            right.
            THE CONTENT IS HELD TO THE SAME MEASURE AS THE CARDS BELOW, so the
            back arrow lines up with the first card's left edge and the button
            with the last card's right edge. A bar whose contents run to the
            window edge over a centred grid reads as a different page. */}
        <div className="detail-bar">
          <div className="detail-bar-inner">
            <button className="back small" onClick={() => nav('/dashboard')}>
              <span aria-hidden="true">←</span> Back to Dashboard
            </button>
            <span className="sep" aria-hidden="true" />
            {editing ? (
              <input className="plan-name-input" autoFocus value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') { setEditing(false); }
                }} />
            ) : (
              <button className="plan-name" title="Rename this project"
                onClick={() => { setDraftName(project?.name || ''); setEditing(true); }}>
                {project?.name || 'Loading…'}
              </button>
            )}
            <div className="spacer" />
            <button className="btn primary"
              onClick={() => fileRef.current?.click()}>+ Add a plan</button>
            <input ref={fileRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
              onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </div>
      <div className="shell-body"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files?.[0]); }}
      >
        {/* THE BODY IS FULL WIDTH AND THE CONTENT IS CENTRED INSIDE IT,
            which is two jobs that were being done by one element. The body
            is the scroll container AND the drop target, so it has to fill
            the column — a max-width on it meant the right third of the page
            silently refused a dropped drawing. The measure belongs to the
            content: 1180px, centred, so it sits under the eye instead of
            hugging the rail on a wide display. */}
        <div className="shell-inner">
          {/* THE NAME, THE BACK ARROW AND THE ACTION ALL LIVE IN THE BAR NOW.
              What is left here is the two things that describe the project
              rather than address it: how many plans and when it changed, and the
              category — which every plan added to this project inherits, so a
              project without one is quietly sending each new drawing back to the
              plan-level dialog. Worth surfacing, not worth a bar. */}
          <header className="page-head">
            <div className="page-title">
              <p className="page-sub lead">
                {plans == null ? 'Loading…'
                  : `${plans.length} plan${plans.length === 1 ? '' : 's'}`
                    + (project?.updated_at ? ` · updated ${when(project.updated_at)}` : '')}
              </p>
              {project && (
                <div className="cat-row">
                  {project.project_type ? (
                    <span className="pill ok">
                      {PROJECT_TYPES.find((t) => t.id === project.project_type)?.label
                        ?? project.project_type}
                    </span>
                  ) : (
                    <>
                      <span className="note" style={{ margin: 0 }}>No category yet:</span>
                      {PROJECT_TYPES.map((t) => (
                        <button key={t.id} className="linkish" onClick={async () => {
                          try { setProject(await setProjectType(projectId, t.id)); }
                          catch (e) { setErr(String(e.message || e)); }
                        }}>{t.label}</button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </header>

          {err && <p className="note err">{err}</p>}

          {plans == null ? (
            <div className="skeleton-grid">{[0, 1, 2].map((i) => <div key={i} className="skel-card" />)}</div>
          ) : plans.length === 0 ? (
            <div className={'dropzone hero' + (over ? ' over' : '')}>
              <h2>Drop a floor plan</h2>
              <p>
                Anywhere on this page. It joins this project
                {project?.project_type ? ' and inherits its category, so you will not be asked again' : ''}.
              </p>
              <div className="btnrow centre">
                <button className="btn primary big"
                  onClick={() => fileRef.current?.click()}>
                  Choose a DXF, PDF or image
                </button>
              </div>
            </div>
          ) : (
            <div className="card-grid plans">
              {plans.map((p) => (
                <PlanCard key={p.id} plan={p} onOpen={() => nav(`/plans/${p.id}`)}
                  onDelete={async () => {
                    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
                    try { await deletePlan(p.id); load(); }
                    catch (e) { setErr(String(e.message || e)); }
                  }} />
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
