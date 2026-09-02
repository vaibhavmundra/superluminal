import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import PlanCard from '../components/PlanCard.jsx';
import Pager from '../components/Pager.jsx';
import ViewingAs from '../components/ViewingAs.jsx';
import { adminUserProjects, adminUserPlans } from '../lib/admin.js';
import { when } from './Dashboard.jsx';

// ---------------------------------------------------------------------------
// ONE USER'S DASHBOARD, SEEN FROM OUTSIDE IT.
//
// THE SAME SHAPE AS Dashboard.jsx ON PURPOSE — the recent strip on top, the
// project grid under it, the same PlanCard with the same snapshot. The question
// this screen answers is "what is this person actually seeing", and answering it
// in a different layout with different components would mean the answer is only
// approximately the truth. Where the two files differ is where they must: the
// data comes from /api/admin instead of from RLS, and every control that would
// WRITE something is simply not here.
//
// WHY THIS IS NOT A `viewingAs` BRANCH INSIDE Dashboard.jsx. It was going to be,
// and that is the version that eventually leaks. Dashboard's queries have no
// owner filter — they select and let row-level security do the scoping — so a
// component that sometimes reads another account's rows is one bad conditional
// away from showing them to the wrong person, forever, silently. A separate
// route cannot make that mistake: it has no path to the user's own data at all.
//
// THE BANNER IS NOT DECORATION. See ViewingAs — a screen that looks exactly like
// your own dashboard but is full of somebody else's work is a trap without it.
// ---------------------------------------------------------------------------

const PER_PAGE = 24;
const RECENT = 6;

export default function AdminUserView() {
  const { userId } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    Promise.all([
      adminUserProjects({ userId, page, perPage: PER_PAGE }),
      // The recent strip is always the newest few across the whole account,
      // regardless of which page of projects is on screen — it answers "what were
      // they doing last", which has nothing to do with pagination.
      adminUserPlans({ userId, page: 1, perPage: RECENT }),
    ])
      .then(([d, p]) => { if (!alive) return; setData(d); setRecent(p.plans || []); setErr(''); })
      .catch((e) => { if (alive) { setErr(String(e.message || e)); setData({ projects: [] }); } });
    return () => { alive = false; };
  }, [userId, page]);

  const user = data?.user ?? null;
  const projects = data?.projects ?? null;

  return (
    <div className="grid grid-cols-[56px_1fr] h-full">
      <ProfileRail />
      <div className="overflow-y-auto pt-[26px] px-[30px] pb-[60px] w-full">
        <div className="w-full max-w-[1180px] mx-auto">
          <ViewingAs user={user} userId={userId} />

          <header className="flex items-end justify-between gap-5 mt-[6px] mb-[26px]">
            <div>
              <h1 className="m-0 text-[26px] tracking-[-0.03em]">Projects</h1>
              <p className="mt-[6px] mb-0 text-muted text-[12.5px]">
                {err ? 'Could not load'
                  : data == null ? 'Loading…'
                  : data.total
                    ? `${data.total} project${data.total === 1 ? '' : 's'}`
                    : 'This account has no projects yet.'}
              </p>
            </div>
          </header>

          {err && <p className="text-[11.5px] leading-[1.5] mt-2 text-danger-ink border-l-2 border-danger pl-[9px]">{err}</p>}

          {!!recent.length && (
            <section className="mb-[34px]">
              <h3 className="m-0 mb-3 text-[10px] tracking-[.11em] uppercase text-subtle">What they worked on last</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
                {recent.map((p) => (
                  <PlanCard key={p.id} plan={p} project={p.projects}
                    onOpen={() => nav(`/admin/plans/${p.id}`)} />
                ))}
              </div>
            </section>
          )}

          <section className="mb-[34px]">
            {projects?.length !== 0 && <h3 className="m-0 mb-3 text-[10px] tracking-[.11em] uppercase text-subtle">All projects</h3>}
            {projects == null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">{[0, 1, 2].map((i) => <div key={i} className="h-[150px] rounded-lg bg-surface-3 animate-[sl-breathe_1.6s_ease-in-out_infinite]" />)}</div>
            ) : projects.length === 0 ? (
              <p className="text-[11.5px] text-muted leading-[1.5] mt-2">
                Nothing here yet — this account has signed up but has not created a
                project or uploaded a drawing.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
                {projects.map((p) => (
                  <article key={p.id} className="flex flex-col bg-surface border border-border rounded-lg overflow-hidden cursor-pointer transition-[border-color,box-shadow,transform] duration-[120ms] [transition-timing-function:ease] hover:border-border-strong hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2" role="button" tabIndex={0}
                    onClick={() => nav(`/admin/users/${userId}/projects/${p.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') nav(`/admin/users/${userId}/projects/${p.id}`);
                    }}>
                    <div className="pt-[15px] pb-[13px] px-[14px] flex-1">
                      <h4 className="m-0 mb-1.5 text-[13.5px] tracking-[-0.01em]">{p.name}</h4>
                      <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-muted">
                        <span>{p.planCount} plan{p.planCount === 1 ? '' : 's'}</span>
                        <span className="text-faint">·</span>
                        <span>{when(p.updated_at)}</span>
                      </div>
                    </div>
                    {/* NO CARD FOOT. The user's own dashboard has a Delete here;
                        this screen reads and nothing else, and the surest way to
                        keep that true is for the button not to exist. */}
                  </article>
                ))}
              </div>
            )}
          </section>

          <Pager page={page} pages={data?.pages ?? null} total={data?.total ?? null}
            perPage={PER_PAGE} noun="project"
            onPage={(n) => {
              const p = new URLSearchParams(params);
              if (n === 1) p.delete('page'); else p.set('page', String(n));
              setParams(p);
            }} />
        </div>
      </div>
    </div>
  );
}
