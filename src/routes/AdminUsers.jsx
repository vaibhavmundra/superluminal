import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import Pager from '../components/Pager.jsx';
import { adminUsers } from '../lib/admin.js';
import { when } from './Dashboard.jsx';

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
    <div className="shell">
      <ProfileRail />
      <div className="shell-body">
        <div className="shell-inner">
          <header className="page-head">
            <div>
              <h1>Users</h1>
              <p className="page-sub">
                {err ? 'Could not load'
                  : data == null ? 'Loading…'
                  : `${data.total ?? rows.length} account${data.total === 1 ? '' : 's'}`
                    + ' · open one to see the app as they see it'}
              </p>
            </div>
            <form className="admin-search" onSubmit={(e) => {
              e.preventDefault();
              patch({ q: draft.trim() || null, page: null });
            }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="Search name or email" aria-label="Search users" />
              {q && (
                <button type="button" className="linkish"
                  onClick={() => patch({ q: null, page: null })}>Clear</button>
              )}
            </form>
          </header>

          {err && <p className="note err">{err}</p>}

          {/* THE SORT IS A ROW OF TABS AND NOT A <select>, because there are six
              of them and the one that is on is worth being able to see without
              opening anything. */}
          <div className="admin-sorts" role="tablist" aria-label="Sort users">
            {SORTS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={sort === k}
                className={sort === k ? 'on' : ''}
                onClick={() => patch({ sort: k === 'active' ? null : k, page: null })}>
                {label}
              </button>
            ))}
          </div>

          {!err && (
            <div className={'admin-table-wrap' + (busy ? ' busy' : '')}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th className="num">Projects</th>
                    <th className="num">Plans</th>
                    <th className="num">Ready</th>
                    <th>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {data == null
                    ? Array.from({ length: 6 }, (_, i) => (
                        <tr key={i} className="skel-row"><td colSpan={5}><span /></td></tr>
                      ))
                    : rows.length === 0
                    ? <tr><td colSpan={5} className="admin-empty">
                        {q ? `Nobody matches “${q}”.` : 'No users yet.'}
                      </td></tr>
                    : rows.map((u) => (
                      <tr key={u.id} role="button" tabIndex={0}
                        onClick={() => nav(`/admin/users/${u.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') nav(`/admin/users/${u.id}`); }}>
                        <td>
                          <div className="admin-who">
                            <span className="bubble sm" aria-hidden="true">
                              {(u.full_name || u.email || '—').trim().charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <b>{u.full_name || u.email || 'Unnamed'}</b>
                              {/* The email is the identifier that actually
                                  matters in a support conversation, so it is
                                  always shown — even when it is also the name. */}
                              <span>{u.email || '—'}</span>
                            </div>
                            {u.role === 1 && <span className="tag admin">admin</span>}
                          </div>
                        </td>
                        <td className="num muted">{u.projects}</td>
                        <td className="num muted">{u.plans}</td>
                        {/* THE ONE NUMBER IN INK. Zero is drawn muted rather
                            than bold, because a column of bold zeroes shouts
                            about the thing that did not happen. */}
                        <td className={'num' + (u.plans_ready ? ' strong' : ' muted')}>
                          {u.plans_ready}
                        </td>
                        <td className="muted">
                          {/* 'epoch' comes back for somebody who has made
                              nothing at all — the view coalesces to it so the
                              sort has something to order by. It is not a date
                              worth printing. */}
                          {!u.last_active || new Date(u.last_active).getFullYear() < 1980
                            ? <span className="dash">never</span>
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
