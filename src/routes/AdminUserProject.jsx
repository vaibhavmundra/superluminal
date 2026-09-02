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
    <div className="grid grid-cols-[56px_1fr] h-full">
      <ProfileRail />
      <div className="overflow-y-auto pt-[26px] px-[30px] pb-[60px] w-full">
        <div className="w-full max-w-[1180px] mx-auto">
          <ViewingAs user={null} userId={userId} project={projectId} />

          <header className="flex items-end justify-between gap-5 mt-[6px] mb-[26px]">
            <div>
              <button className="border-0 bg-transparent text-[12px] text-muted cursor-pointer py-1 px-0 inline-flex items-center gap-[7px] m-0 whitespace-nowrap hover:text-ink" onClick={() => nav(`/admin/users/${userId}`)}>
                <span aria-hidden="true" className="text-[13px]">←</span> Their projects
              </button>
              <h1 className="m-0 text-[26px] tracking-[-0.03em]">{data?.project?.name ?? (data == null ? 'Loading…' : 'Project')}</h1>
              <p className="mt-[6px] mb-0 text-muted text-[12.5px]">
                {err ? 'Could not load'
                  : data == null ? 'Loading…'
                  : `${data.total ?? plans.length} plan${data.total === 1 ? '' : 's'}`
                    + (data.project?.project_type ? ` · ${data.project.project_type}` : '')}
              </p>
            </div>
          </header>

          {err && <p className="text-[11.5px] leading-[1.5] mt-2 text-danger-ink border-l-2 border-danger pl-[9px]">{err}</p>}

          <section className="mb-[34px]">
            {plans == null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">{[0, 1, 2].map((i) => <div key={i} className="h-[150px] rounded-lg bg-surface-3 animate-[sl-breathe_1.6s_ease-in-out_infinite]" />)}</div>
            ) : plans.length === 0 ? (
              <p className="text-[11.5px] text-muted leading-[1.5] mt-2">No plans in this project.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">

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
