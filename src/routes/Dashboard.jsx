import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import PlanCard from '../components/PlanCard.jsx';
import NewProjectDialog from '../components/NewProjectDialog.jsx';
import { listProjects, recentPlans, createProject, deleteProject,
         subscribeProjects, subscribePlans, coalesce } from '../lib/db.js';
import { startPlanUpload } from '../lib/uploads.js';

// ---------------------------------------------------------------------------
// EVERY PROJECT. The top of the hierarchy, and the screen a returning user
// lands on.
//
// PROJECTS FIRST, THEN A RECENT STRIP. A project is the unit of work — a flat, a
// hotel, a floor — but the thing somebody coming back at 9am actually wants is
// the plan they had open at 6pm, which may be three clicks down. So the last few
// plans are lifted out and put on top, and both lists are live: the autosave in
// an editor tab reorders this one as it writes (see subscribePlans).
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const nav = useNavigate();
  const [projects, setProjects] = useState(null);
  const [recent, setRecent] = useState([]);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [ps, rs] = await Promise.all([listProjects(), recentPlans(6)]);
      setProjects(ps); setRecent(rs);
    } catch (e) { setErr(String(e.message || e)); setProjects([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // TWO SUBSCRIPTIONS, ONE REFETCH. A change to either table can change either
  // list — a plan being saved bumps its project's updated_at through a trigger —
  // and a refetch of two small selects is cheaper to reason about than patching
  // both lists from a payload.
  useEffect(() => {
    const bump = coalesce(load, 400);
    const a = subscribeProjects(bump);
    const b = subscribePlans(null, bump);
    return () => { a(); b(); };
  }, [load]);

  const upload = useCallback(async (file) => {
    if (!file) return;
    const ok = /\.(dxf|pdf)$/i.test(file.name)
      || (file.type || '').startsWith('image/')
      || file.type === 'application/pdf';
    if (!ok) { setErr('A DXF, a PDF or an image of a plan, please.'); return; }
    // No await, no spinner: the row and the bytes are a background job and the
    // editor works from this File. See lib/uploads.js.
    setErr('');
    const job = startPlanUpload(file);
    nav(`/plans/${job.planId}`);
  }, [nav]);

  return (
    <div className="grid grid-cols-[56px_1fr] h-full">
      <ProfileRail />
      <div className="overflow-y-auto pt-[26px] px-[30px] pb-[60px] w-full"
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
        <div className="w-full max-w-[1180px] mx-auto">
          <header className="flex items-end justify-between gap-5 mt-[6px] mb-[26px]">
            <div>
              <h1 className="m-0 text-[26px] tracking-[-0.03em]">Projects</h1>
              <p className="mt-1.5 mb-0 text-muted text-[12.5px]">
                {projects == null ? 'Loading…'
                  : projects.length ? `${projects.length} project${projects.length > 1 ? 's' : ''}`
                  : 'A project holds every plan for one building.'}
              </p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {/* SECONDARY, and the demotion is deliberate. On the empty screen the
                  act that matters is dropping a drawing — that is the black button,
                  in the middle, where the eye already is. Creating an empty project
                  first is the deliberate, tidier route, and a second black button
                  beside it would make the page ask which of two things you meant. */}
              <button className="text-[12px] px-3 py-[7px] rounded border border-border-strong bg-surface text-ink cursor-pointer transition-[background,border-color,color] duration-[120ms] hover:bg-surface-2 hover:border-ink active:bg-surface-3" onClick={() => setNewProject(true)}>
                <span className="text-[1.18em] leading-none relative top-[0.055em] mr-px" aria-hidden="true">+</span> New Project
              </button>
              <input ref={fileRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
                onChange={(e) => upload(e.target.files?.[0])} />
            </div>
          </header>

          {err && <p className="text-[11.5px] text-danger-ink leading-[1.5] mt-2 border-l-2 border-danger pl-[9px]">{err}</p>}

          {newProject && (
            <NewProjectDialog busy={creating}
              onCancel={() => setNewProject(false)}
              onCreate={async ({ name, projectType }) => {
                try {
                  setCreating(true);
                  const p = await createProject({ name, projectType });
                  nav(`/projects/${p.id}`);
                } catch (e) { setErr(String(e.message || e)); setCreating(false); setNewProject(false); }
              }} />
          )}

          {!!recent.length && (
            <section className="mb-[34px]">
              <h3 className="m-0 mb-3 text-[10px] tracking-[0.11em] uppercase text-subtle">Pick up where you left off</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
                {recent.map((p) => (
                  <PlanCard key={p.id} plan={p} project={p.projects} onOpen={() => nav(`/plans/${p.id}`)} />
                ))}
              </div>
            </section>
          )}

          {/* NO SECTION HEADING WHEN THERE IS NOTHING UNDER IT. "ALL PROJECTS"
              above an empty state labels a list that does not exist, and it was
              what pinned the invitation to the left margin under a column head —
              an empty screen's one job is to say what to do next, in the middle,
              at a size that reads as an invitation rather than as a placeholder. */}
          <section className={'mb-[34px]' + (projects?.length === 0 ? ' min-h-[min(58vh,560px)] flex items-center justify-center' : '')}>
            {projects?.length !== 0 && <h3 className="m-0 mb-3 text-[10px] tracking-[0.11em] uppercase text-subtle">All projects</h3>}
            {projects == null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">{[0, 1, 2].map((i) => <div key={i} className="h-[150px] rounded-lg bg-surface-3 animate-[sl-breathe_1.6s_ease-in-out_infinite]" />)}</div>
            ) : projects.length === 0 ? (
              <div className={'w-full border-[1.5px] border-dashed border-border-strong rounded-[16px] text-center transition-[border-color,background] duration-150 py-[76px] px-14 max-[700px]:py-12 max-[700px]:px-6' + (over ? ' bg-accent-soft' : ' bg-surface')}>
                <h2 className="m-0 mb-3 text-[32px] tracking-[-0.035em] max-[700px]:text-[24px]">Drop a floor plan</h2>
                <p className="mx-auto mt-0 mb-[18px] text-muted max-w-[52ch] text-[14px] leading-[1.65]">
                  Super Luminal finds the rooms, works out the scale from a door, and lays
                  out the lighting. A project is created for the drawing automatically —
                  or make one yourself to set its name and category first.
                </p>
                <div className="flex gap-1.5 flex-wrap justify-center mt-[22px]">
                  <button className="text-[14px] px-[22px] h-field-h rounded-[8px] border border-cta bg-cta text-white inline-flex items-center justify-center cursor-pointer transition-[background,border-color,color] duration-[120ms] hover:bg-cta-hover hover:border-cta-hover active:bg-surface-3"
                    onClick={() => fileRef.current?.click()}>
                    Choose a DXF, PDF or image
                  </button>
                  <button className="text-[14px] px-[22px] h-field-h rounded-[8px] border border-border-strong bg-surface text-ink inline-flex items-center justify-center cursor-pointer transition-[background,border-color,color] duration-[120ms] hover:bg-surface-2 hover:border-ink active:bg-surface-3" onClick={() => setNewProject(true)}>
                    <span className="text-[1.18em] leading-none relative top-[0.055em] mr-px" aria-hidden="true">+</span> New Project
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
                {projects.map((p) => (
                  <article key={p.id} className="bg-surface border border-border rounded-lg overflow-hidden cursor-pointer flex flex-col transition-[border-color,box-shadow,transform] duration-[120ms] hover:border-border-strong hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                    onClick={() => nav(`/projects/${p.id}`)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') nav(`/projects/${p.id}`); }}>
                    <div className="py-[13px] px-3.5 pt-[15px] flex-1">
                      <h4 className="m-0 mb-1.5 text-[13.5px] tracking-[-0.01em]">{p.name}</h4>
                      <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-muted">
                        <span>{p.planCount} plan{p.planCount === 1 ? '' : 's'}</span>
                        <span className="text-faint">·</span>
                        <span>{when(p.updated_at)}</span>
                      </div>
                    </div>
                    <div className="py-2 px-3.5 border-t border-border flex justify-end">
                      <button className="border-0 bg-transparent p-0 text-[11.5px] text-danger-ink cursor-pointer no-underline hover:underline" onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete “${p.name}” and every plan in it? This cannot be undone.`)) return;
                        try { await deleteProject(p.id); load(); }
                        catch (ex) { setErr(String(ex.message || ex)); }
                      }}>Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Relative time, coarse on purpose: "3 days ago" is more use than a date. */
export function when(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
