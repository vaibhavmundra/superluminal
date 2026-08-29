import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import PlanCard from '../components/PlanCard.jsx';
import Pager from '../components/Pager.jsx';
import ViewingAs from '../components/ViewingAs.jsx';
import { adminUserPlans } from '../lib/admin.js';

// ---------------------------------------------------------------------------
// ONE PROJECT OF ONE USER'S — the plans in it, as they see them.
//
// The mirror of ProjectDetail.jsx with everything that writes taken out: no
// rename-in-place on the heading, no category picker, no upload, no delete. What
// is left is the grid of plan cards, and clicking one opens the READ-ONLY
// viewer rather than the editor.
//
// The plan count comes back with the page rather than being counted here,
// because it is the same `count=exact` header the pager already needs — one
// query answering two questions.
// ---------------------------------------------------------------------------

const PER_PAGE = 24;

export default function AdminUserProject() {
  const { userId, projectId } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    adminUserPlans({ userId, projectId, page, perPage: PER_PAGE })
      .then((d) => { if (alive) { setData(d); setErr(''); } })
      .catch((e) => { if (alive) { setErr(String(e.message || e)); setData({ plans: [] }); } });
    return () => { alive = false; };
  }, [userId, projectId, page]);

  const plans = data?.plans ?? null;

  return (
    <div className="shell">
      <ProfileRail />
      <div className="shell-body">
        <div className="shell-inner">
          <ViewingAs user={null} userId={userId} project={projectId} />

          <header className="page-head">
            <div>
              <button className="back small" onClick={() => nav(`/admin/users/${userId}`)}>
                <span aria-hidden="true">←</span> Their projects
              </button>
              <h1>{data?.project?.name ?? (data == null ? 'Loading…' : 'Project')}</h1>
              <p className="page-sub">
                {err ? 'Could not load'
                  : data == null ? 'Loading…'
                  : `${data.total ?? plans.length} plan${data.total === 1 ? '' : 's'}`
                    + (data.project?.project_type ? ` · ${data.project.project_type}` : '')}
              </p>
            </div>
          </header>

          {err && <p className="note err">{err}</p>}

          <section className="page-sec">
            {plans == null ? (
              <div className="skeleton-grid">{[0, 1, 2].map((i) => <div key={i} className="skel-card" />)}</div>
            ) : plans.length === 0 ? (
              <p className="note">No plans in this project.</p>
            ) : (
              <div className="card-grid plans">
                {plans.map((p) => (
                  <PlanCard key={p.id} plan={p} onOpen={() => nav(`/admin/plans/${p.id}`)} />
                ))}
              </div>
            )}
          </section>

          <Pager page={page} pages={data?.pages ?? null} total={data?.total ?? null}
            perPage={PER_PAGE} noun="plan"
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
