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
          <button className="back" onClick={() => nav('/dashboard')}>
            <span aria-hidden="true">←</span> Back to Dashboard
          </button>

          <header className="page-head">
            <div className="page-title">
              {editing ? (
                <input className="title-input" autoFocus value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitName();
                    if (e.key === 'Escape') { setEditing(false); }
                  }} />
              ) : (
                <h1 className="editable" title="Click to rename"
                  onClick={() => { setDraftName(project?.name || ''); setEditing(true); }}>
                  {project?.name || 'Loading…'}
                </h1>
              )}
              <p className="page-sub">
                {plans == null ? 'Loading…'
                  : `${plans.length} plan${plans.length === 1 ? '' : 's'}`
                    + (project?.updated_at ? ` · updated ${when(project.updated_at)}` : '')}
              </p>
              {/* THE CATEGORY, SHOWN AND FIXABLE HERE. Every plan added to this
                  project inherits it, so a project that has none is quietly
                  sending each new drawing back to the plan-level dialog — worth
                  surfacing rather than leaving as an invisible property. */}
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
            <div className="btnrow">
              <button className="btn primary"
                onClick={() => fileRef.current?.click()}>Add a plan</button>
              <input ref={fileRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
                onChange={(e) => upload(e.target.files?.[0])} />
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
  );
}
