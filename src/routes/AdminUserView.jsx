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
    <div className="shell">
      <ProfileRail />
      <div className="shell-body">
        <div className="shell-inner">
          <ViewingAs user={user} userId={userId} />

          <header className="page-head">
            <div>
              <h1>Projects</h1>
              <p className="page-sub">
                {err ? 'Could not load'
                  : data == null ? 'Loading…'
                  : data.total
                    ? `${data.total} project${data.total === 1 ? '' : 's'}`
                    : 'This account has no projects yet.'}
              </p>
            </div>
          </header>

          {err && <p className="note err">{err}</p>}

          {!!recent.length && (
            <section className="page-sec">
              <h3>What they worked on last</h3>
              <div className="card-grid plans">
                {recent.map((p) => (
                  <PlanCard key={p.id} plan={p} project={p.projects}
                    onOpen={() => nav(`/admin/plans/${p.id}`)} />
                ))}
              </div>
            </section>
          )}

          <section className="page-sec">
            {projects?.length !== 0 && <h3>All projects</h3>}
            {projects == null ? (
              <div className="skeleton-grid">{[0, 1, 2].map((i) => <div key={i} className="skel-card" />)}</div>
            ) : projects.length === 0 ? (
              <p className="note">
                Nothing here yet — this account has signed up but has not created a
                project or uploaded a drawing.
              </p>
            ) : (
              <div className="card-grid">
                {projects.map((p) => (
                  <article key={p.id} className="card project-card" role="button" tabIndex={0}
                    onClick={() => nav(`/admin/users/${userId}/projects/${p.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') nav(`/admin/users/${userId}/projects/${p.id}`);
                    }}>
                    <div className="card-body">
                      <h4>{p.name}</h4>
                      <div className="card-meta">
                        <span>{p.planCount} plan{p.planCount === 1 ? '' : 's'}</span>
                        <span className="dotsep">·</span>
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
