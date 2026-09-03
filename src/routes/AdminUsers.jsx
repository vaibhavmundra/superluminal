import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import Pager from '../components/Pager.jsx';
import { adminUsers } from '../lib/admin.js';
import { when } from './Dashboard.jsx';
import { occupationLabel } from '../lib/profile.js';

// ---------------------------------------------------------------------------
// EVERY USER OF THE APP, AND WHAT THEY HAVE MADE.
//
// THE THREE NUMBERS ARE THE WHOLE POINT, and they are deliberately not the same
// number three times. On an MVP the question is never "how many people signed
// up" — it is where each of them stopped:
//
//   projects   they made somewhere to put a drawing
//   plans      they actually uploaded one
//   ready      a plan got all the way to a finished layout
//
// A row reading 3 · 7 · 0 is a person who has uploaded seven drawings and never
// once got a lighting design out of the app, which is the single most useful
// row on this screen and is invisible in any single-number version of it. So the
// counts sit side by side, and `ready` is the one drawn in ink while the others
// are muted.
//
// A TABLE, NOT CARDS. Cards are for things you recognise by their picture — a
// plan has a drawing, so PlanCard shows it. A user is a row of numbers you scan
// down a column to compare, and putting that in a grid of tiles makes the
// comparison impossible for the sake of looking modern.
//
// THE PAGE IS IN THE URL, not in state. Someone looking at page four of the user
// list and opening a user in a new tab expects to come back to page four, and a
// bug report that says "the third row down" needs a link that still means that
// tomorrow. Same for the sort and the search.
// ---------------------------------------------------------------------------

const SORTS = [
  ['active', 'Last active'],
  ['plans', 'Most plans'],
  ['ready', 'Most finished'],
  ['projects', 'Most projects'],
  ['joined', 'Newest'],
  ['email', 'Email'],
];

const PER_PAGE = 20;

export default function AdminUsers() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page')) || 1);
  const sort = SORTS.some(([k]) => k === params.get('sort')) ? params.get('sort') : 'active';
  const q = params.get('q') || '';

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  // The search box is local and the URL is committed on submit. Rewriting the
  // query string on every keystroke would put twelve entries in the back stack
  // for one word and fire twelve requests to match.
  const [draft, setDraft] = useState(q);

  useEffect(() => { setDraft(q); }, [q]);

  const patch = useCallback((next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || v === undefined) p.delete(k); else p.set(k, String(v));
    }
    setParams(p, { replace: false });
  }, [params, setParams]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    adminUsers({ page, perPage: PER_PAGE, sort, q })
      .then((d) => { if (alive) { setData(d); setErr(''); } })
      .catch((e) => { if (alive) { setErr(String(e.message || e)); setData(null); } })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [page, sort, q]);

  const rows = data?.users ?? [];

  return (
    <div className="grid grid-cols-[56px_1fr] h-full">
      <ProfileRail />
      <div className="overflow-y-auto pt-[26px] px-[30px] pb-[60px] w-full">
        <div className="w-full max-w-[1180px] mx-auto">
          <header className="flex items-end justify-between gap-5 mt-[6px] mb-[26px]">
            <div>
              <h1 className="m-0 text-[26px] tracking-[-0.03em]">Users</h1>
              <p className="mt-[6px] mb-0 text-muted text-[12.5px]">
                {err ? 'Could not load'
                  : data == null ? 'Loading…'
                  : `${data.total ?? rows.length} account${data.total === 1 ? '' : 's'}`
                    + ' · open one to see the app as they see it'}
              </p>
            </div>
            <form className="flex items-center gap-2.5" onSubmit={(e) => {
              e.preventDefault();
              patch({ q: draft.trim() || null, page: null });
            }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="Search name or email" aria-label="Search users"
                className="w-[230px] py-[7px] px-[11px] rounded border border-border-strong bg-surface-3 text-[12.5px] text-ink focus:outline-none focus:border-ink focus:bg-surface" />
              {q && (
                <button type="button" className="border-0 bg-transparent text-[11.5px] text-accent cursor-pointer p-0 no-underline hover:underline"
                  onClick={() => patch({ q: null, page: null })}>Clear</button>
              )}
            </form>
          </header>

          {err && <p className="text-[11.5px] leading-[1.5] mt-2 text-danger-ink border-l-2 border-danger pl-[9px]">{err}</p>}

          {/* THE SORT IS A ROW OF TABS AND NOT A <select>, because there are six
              of them and the one that is on is worth being able to see without
              opening anything. */}
          <div className="flex gap-1 flex-wrap mb-4" role="tablist" aria-label="Sort users">
            {SORTS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={sort === k}
                className={
                  'border border-transparent bg-transparent text-[12px] py-[5px] px-[10px] rounded-full cursor-pointer '
                  + (sort === k ? 'bg-ink text-white' : 'text-muted hover:bg-surface-3 hover:text-ink')
                }
                onClick={() => patch({ sort: k === 'active' ? null : k, page: null })}>
                {label}
              </button>
            ))}
          </div>

          {!err && (
            <div className={'border border-border rounded-lg overflow-hidden bg-surface transition-opacity duration-150' + (busy ? ' opacity-60' : '')}>
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border bg-surface-2">User</th>
                    {/* WHO THEY ARE, WHICH IS WHY THE EXPORT DIALOG ASKS. A
                        number and an occupation collected and never looked at is
                        half a feature — this column is the other half, and it is
                        the reason a WhatsApp number is worth having at all. */}
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border bg-surface-2">Contact</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border bg-surface-2 text-right w-[92px]">Projects</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border bg-surface-2 text-right w-[92px]">Plans</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border bg-surface-2 text-right w-[92px]">Ready</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border bg-surface-2">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {data == null
                    ? Array.from({ length: 6 }, (_, i) => (
                        <tr key={i} className="last:[&>td]:border-b-0"><td colSpan={6} className="p-0 border-b border-border align-middle"><span className="block h-[47px] bg-[linear-gradient(90deg,#F2F2F2_25%,#FFFFFF_50%,#F2F2F2_75%)] bg-[length:400%_100%] animate-[skel_1.3s_ease-in-out_infinite]" /></td></tr>
                      ))
                    : rows.length === 0
                    ? <tr className="last:[&>td]:border-b-0"><td colSpan={6} className="py-[11px] px-[14px] border-b border-border align-middle text-center text-subtle">
                        {q ? `Nobody matches “${q}”.` : 'No users yet.'}
                      </td></tr>
                    : rows.map((u) => (
                      <tr key={u.id} role="button" tabIndex={0}
                        className="group cursor-pointer last:[&>td]:border-b-0 hover:bg-[#FDF2FE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C026D3] focus-visible:outline-offset-[-2px]"
                        onClick={() => nav(`/admin/users/${u.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') nav(`/admin/users/${u.id}`); }}>
                        <td className="py-[11px] px-[14px] border-b border-border align-middle">
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden="true"
                              className="grid place-items-center w-[26px] h-[26px] rounded-full border border-border-strong bg-surface-3 text-muted text-[11.5px] flex-none [cursor:inherit] transition-[background,border-color,box-shadow] duration-[120ms] [transition-timing-function:ease] hover:bg-[#0060D9] hover:border-[#0060D9] hover:text-white group-hover:!border-[#C026D3] group-hover:!text-[#C026D3]">
                              {(u.full_name || u.email || '—').trim().charAt(0).toUpperCase()}
                            </span>
                            <div className="flex flex-col gap-[1px] min-w-0">
                              <b className="text-[12.5px] font-medium">{u.full_name || u.email || 'Unnamed'}</b>
                              {/* The email is the identifier that actually
                                  matters in a support conversation, so it is
                                  always shown — even when it is also the name. */}
                              <span className="text-[11px] text-subtle overflow-hidden text-ellipsis whitespace-nowrap max-w-[34ch]">{u.email || '—'}</span>
                            </div>
                            {u.role === 1 && <span className="font-sans text-[9.5px] tracking-[.05em] uppercase py-0.5 px-1.5 rounded-full border border-[#F0ABFC] bg-[#FDF2FE] text-[#C026D3] whitespace-nowrap">admin</span>}
                          </div>
                        </td>
                        <td className="py-[11px] px-[14px] border-b border-border align-middle">
                          <div className="flex flex-col gap-[1px] min-w-0">
                            {/* A `tel:` LINK AND NOT PLAIN TEXT, because the one
                                thing anybody does with this column is get in
                                touch — and the number is stored in E.164, which
                                is exactly what an href wants. It stops the row's
                                own click, or reaching for the phone would open
                                the user's account instead. */}
                            {u.phone
                              ? <a href={`tel:${u.phone}`} className="text-[12px] text-ink no-underline hover:underline"
                                  onClick={(e) => e.stopPropagation()}>{u.phone}</a>
                              : <span className="text-[12px] text-faint">—</span>}
                            <span className="text-[11px] text-subtle whitespace-nowrap">
                              {occupationLabel(u.occupation) ?? 'not asked yet'}
                            </span>
                          </div>
                        </td>
                        <td className="py-[11px] px-[14px] border-b border-border align-middle text-right w-[92px] text-subtle font-sans">{u.projects}</td>
                        <td className="py-[11px] px-[14px] border-b border-border align-middle text-right w-[92px] text-subtle font-sans">{u.plans}</td>
                        {/* THE ONE NUMBER IN INK. Zero is drawn muted rather
                            than bold, because a column of bold zeroes shouts
                            about the thing that did not happen. */}
                        <td className={'py-[11px] px-[14px] border-b border-border align-middle text-right w-[92px] font-sans' + (u.plans_ready ? ' text-ink font-medium' : ' text-subtle')}>
                          {u.plans_ready}
                        </td>
                        <td className="py-[11px] px-[14px] border-b border-border align-middle text-subtle">
                          {/* 'epoch' comes back for somebody who has made
                              nothing at all — the view coalesces to it so the
                              sort has something to order by. It is not a date
                              worth printing. */}
                          {!u.last_active || new Date(u.last_active).getFullYear() < 1980
                            ? <span className="text-subtle">never</span>
                            : when(u.last_active)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <Pager page={page} pages={data?.pages ?? null} total={data?.total ?? null}
            perPage={PER_PAGE} noun="user"
            onPage={(n) => patch({ page: n === 1 ? null : n })} />
        </div>
      </div>
    </div>
  );
}
