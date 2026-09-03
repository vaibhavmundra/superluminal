import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import PlanCard from '../components/PlanCard.jsx';
import HowToLink from '../components/HowToLink.jsx';
import { when } from './Dashboard.jsx';
import { getProject, listPlans, renameProject, deletePlan, setProjectType,
         subscribePlans, coalesce } from '../lib/db.js';
import { myAccess } from '../lib/sharing.js';
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
  // 'owner' | 'edit' | 'view' | null, and undefined until it is known. This
  // screen is reachable by anybody the project is shared with — the route is the
  // same one the owner uses and RLS is what let them in — so every control on it
  // has to know which of the three is looking.
  const [access, setAccess] = useState(undefined);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [p, ps] = await Promise.all([getProject(projectId), listPlans(projectId)]);
      setProject(p); setPlans(ps);
      // AFTER THE ROW, NOT BESIDE IT. `myAccess` skips its query entirely when
      // it is told the owner, and the project row is where the owner comes
      // from — so sequencing these saves a round trip on the common case rather
      // than costing one.
      try { setAccess(await myAccess(projectId, p?.owner ?? null)); }
      catch (ex) {
        // Only reachable for somebody who is NOT the owner — myAccess answers
        // 'owner' without touching the network when it is told the owner id, and
        // that id is on the row we just read. So the safe way to be wrong here
        // is the least privileged one.
        console.warn('[project] could not read the share role — treating as view only', ex);
        setAccess('view');
      }
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

  // WHAT THIS VISITOR MAY DO. `undefined` — the first render, before the role
  // has come back — reads as the least privileged of the three, so a shared
  // viewer never sees a Delete link flash past on the way to not having one.
  const isOwner = access === 'owner';
  const canEdit = access === 'owner' || access === 'edit';

  const upload = useCallback(async (file) => {
    if (!file) return;
    // THE DROP TARGET IS THE WHOLE PAGE, so hiding the button is not enough:
    // a viewer can still drag a drawing onto a project they may only read, and
    // without this the upload would start, navigate to an editor, and fail on
    // the INSERT with a policy error several seconds later.
    if (!canEdit) {
      setErr('This project is shared with you for viewing, so drawings cannot be added to it.');
      return;
    }
    const ok = /\.(dxf|pdf)$/i.test(file.name)
      || (file.type || '').startsWith('image/')
      || file.type === 'application/pdf';
    if (!ok) { setErr('A DXF, a PDF or an image of a plan, please.'); return; }
    setErr('');
    // Into THIS project, explicitly — the automatic project only happens when
    // there is no context to put a drawing in, and here there is. The category
    // rides along from the project, so the editor never asks.
    const job = startPlanUpload(file, { projectId, projectType: project?.project_type ?? null });
    nav(`/plans/${job.planId}`);
  }, [projectId, project, nav, canEdit]);

  return (
    <div className="grid grid-cols-[56px_1fr] h-full">
      <ProfileRail />
      {/* A COLUMN, SO THE BAR CAN STAY WHILE THE PLANS SCROLL UNDER IT. The
          shell's second grid cell used to be the scrolling body itself; it is now
          a two-row grid — bar, then body — and the body keeps the scrolling and
          the drop handling. `min-height:0` on the column is what actually lets
          the body scroll: without it a grid item takes its content's height and
          the whole page scrolls instead, taking the bar with it. */}
      <div className="grid grid-rows-[auto_minmax(0,1fr)] min-h-0">
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
        <div className="h-14 flex-none flex items-center px-[30px] bg-white/5 backdrop-saturate-[1.8] backdrop-blur-[5px] border-b border-border/10">
          <div className="w-full max-w-[1180px] mx-auto flex items-center gap-3 min-w-0">
            <button className="border-0 bg-transparent text-[12px] text-subtle cursor-pointer py-1 px-0 inline-flex items-center gap-[7px] m-0 whitespace-nowrap transition-colors duration-[120ms] hover:text-white" onClick={() => nav('/dashboard')}>
              <span aria-hidden="true" className="text-[13px]">←</span> Back to Dashboard
            </button>
            <span className="w-px h-[15px] bg-border/10 flex-none [transform:rotate(15deg)]" aria-hidden="true" />
            {/* RENAMING IS AN ACT OF OWNERSHIP, and the RLS says so — the
                update policy on `projects` is owner-only even for an editor.
                A SPAN RATHER THAN A DISABLED BUTTON, which is the same call
                App.jsx makes for the plan name on the read-only sheet: the name
                is not a control here, and dressing it as a dead one invites the
                click that does nothing. */}
            {!isOwner ? (
              <span className="text-[13.5px] text-white py-[3px] px-1.5 max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap">
                {project?.name || 'Loading…'}
              </span>
            ) : editing ? (
              <input className="text-[13.5px] w-[26ch] py-[3px] px-1.5" autoFocus value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') { setEditing(false); }
                }} />
            ) : (
              <button className="border-0 bg-transparent text-[13.5px] text-white cursor-text py-[3px] px-1.5 rounded max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap transition-colors duration-[120ms] hover:bg-surface hover:backdrop-blur-[5px]" title="Rename this project"
                onClick={() => { setDraftName(project?.name || ''); setEditing(true); }}>
                {project?.name || 'Loading…'}
              </button>
            )}
            {/* WHOSE PROJECT THIS IS, IN THE BAR THAT NAMES IT. Everything on
                this screen looks identical to your own project — that is the
                point of sharing through the same routes — so the one thing that
                distinguishes them belongs next to the name, not in a footnote. */}
            {access && !isOwner && (
              <span className="font-sans text-[10px] px-2 py-[2px] rounded-full border border-border/10 bg-white/5 backdrop-blur-[5px] text-subtle whitespace-nowrap flex-none">
                Shared with you · {access === 'edit' ? 'can edit' : 'view only'}
              </span>
            )}
            <div className="flex-1" />
            {canEdit && (
              <button className="text-[12px] px-3 py-[7px] rounded border border-white bg-white text-black hover:bg-text hover:border-text cursor-pointer transition-colors duration-[120ms]"
                onClick={() => fileRef.current?.click()}>+ Add a plan</button>
            )}
            <input ref={fileRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
              onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </div>
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
          {/* THE NAME, THE BACK ARROW AND THE ACTION ALL LIVE IN THE BAR NOW.
              What is left here is the two things that describe the project
              rather than address it: how many plans and when it changed, and the
              category — which every plan added to this project inherits, so a
              project without one is quietly sending each new drawing back to the
              plan-level dialog. Worth surfacing, not worth a bar. */}
          <header className="flex items-end justify-between gap-5 mt-[6px] mb-[26px]">
            <div>
              <p className="m-0 text-[13px] text-muted">
                {plans == null ? 'Loading…'
                  : `${plans.length} plan${plans.length === 1 ? '' : 's'}`
                    + (project?.updated_at ? ` · updated ${when(project.updated_at)}` : '')}
              </p>
              {project && (
                <div className="flex items-center gap-2 flex-wrap mt-[9px]">
                  {project.project_type ? (
                    <span className="font-sans text-[10.5px] tabular-nums px-[11px] py-[4px] rounded-full border border-border/10 bg-white text-black whitespace-nowrap">
                      {PROJECT_TYPES.find((t) => t.id === project.project_type)?.label
                        ?? project.project_type}
                    </span>
                  ) : !isOwner ? (
                    /* THE CHOOSER IS `setProjectType`, WHICH IS AN UPDATE ON
                       `projects` — owner-only, editors included. A row of
                       category pills that all fail is worse than the absence of
                       a category, which is a thing only the owner can fix. */
                    <span className="text-[11.5px] text-muted leading-[1.5] m-0">
                      No category set on this project.
                    </span>
                  ) : (
                    <>
                      <span className="text-[11.5px] text-muted leading-[1.5] m-0">No category yet:</span>
                      {PROJECT_TYPES.map((t) => (
                        <button key={t.id} className="font-sans text-[10.5px] px-[11px] py-[4px] rounded-full border border-border/10 bg-white text-black whitespace-nowrap cursor-pointer transition-colors duration-[120ms] hover:bg-text" onClick={async () => {
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

          {err && <p className="text-[11.5px] text-danger leading-[1.5] mt-2 border-l-2 border-danger pl-[9px]">{err}</p>}

          {plans == null ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">{[0, 1, 2].map((i) => <div key={i} className="h-[150px] rounded-lg bg-white/5 border border-border/10 backdrop-blur-[5px] animate-[sl-breathe_1.6s_ease-in-out_infinite]" />)}</div>
          ) : plans.length === 0 && !canEdit ? (
            /* AN EMPTY PROJECT SOMEBODY SHARED. "Drop a floor plan" would be an
               invitation to do the one thing this visitor is not allowed to do,
               and a dashed drop zone that refuses drops is a broken-looking
               screen rather than a boundary. */
            <div className="w-full border-[1.5px] border-dashed border-border/10 rounded-[16px] text-center backdrop-blur-[5px] bg-surface py-[76px] px-14 max-[700px]:py-12 max-[700px]:px-6">
              <h2 className="m-0 mb-3 text-[22px] tracking-[-0.03em]">Nothing here yet</h2>
              <p className="mx-auto m-0 text-muted max-w-[52ch] text-[13.5px] leading-[1.65]">
                This project has been shared with you, but no drawings have been
                added to it yet.
              </p>
            </div>
          ) : plans.length === 0 ? (
            <div className={'w-full border-[1.5px] border-dashed border-border/10 rounded-[16px] text-center backdrop-blur-[5px] transition-[border-color,background] duration-150 py-[76px] px-14 max-[700px]:py-12 max-[700px]:px-6' + (over ? ' bg-white/10' : ' bg-surface')}>
              <h2 className="m-0 mb-3 text-[32px] tracking-[-0.035em] max-[700px]:text-[24px]">Drop a floor plan</h2>
              <p className="mx-auto mt-0 mb-[18px] text-muted max-w-[52ch] text-[14px] leading-[1.65]">
                Anywhere on this page. It joins this project
                {project?.project_type ? ' and inherits its category, so you will not be asked again' : ''}.
              </p>
              <div className="flex gap-1.5 flex-wrap justify-center mt-[22px]">
                <button className="text-[14px] px-[22px] h-field-h rounded-[8px] border border-white bg-white text-black hover:bg-text hover:border-text inline-flex items-center justify-center cursor-pointer transition-colors duration-[120ms]"
                  onClick={() => fileRef.current?.click()}>
                  Choose a DXF, PDF or image
                </button>
              </div>
              {/* BELOW THE BUTTON ROW RATHER THAN INSIDE IT. The row is centred
                  and wraps; a link as a fourth flex child would be treated as
                  another button and would sit on the same baseline as one. */}
              <HowToLink className="mt-3.5" />
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
              {plans.map((p) => (
                /* NO DELETE FOR ANYBODY BUT THE OWNER — including an editor.
                   PlanCard already draws no link when `onDelete` is null, and
                   the RLS delete policy on `plans` is owner-only, so this is the
                   UI agreeing with the database rather than deciding anything. */
                <PlanCard key={p.id} plan={p} onOpen={() => nav(`/plans/${p.id}`)}
                  onDelete={!isOwner ? null : async () => {
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
