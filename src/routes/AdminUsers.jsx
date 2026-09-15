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
              {/* `type="search"` IS NOT DECORATION, and its absence was the bug.
                  The stylesheet reaches fields by ATTRIBUTE SELECTOR — see the
                  block at the foot of styles.css and the same note in
                  Login.jsx — so an input with no type is matched by none of
                  them and kept whatever the utilities below said. Those said
                  `bg-surface-3` (#F2F2F2) and `text-ink` (#000): a light field
                  on a black page, which is the only one left on this screen.
                  Typed now, it inherits the app's own field: dark ground, white
                  text, the accent focus ring. The utilities that fought it are
                  gone rather than overridden. */}
              <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="Search name, email or phone" aria-label="Search users"
                className="w-[230px] text-[12.5px]" />
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
                  /* THE SELECTED TAB WAS `bg-ink`, WHICH IS #000 ON A BLACK
                     PAGE — a chip with no chip, leaving the white text to carry
                     the whole selected state. And the inactive hover flashed
                     `bg-surface-3` (#F2F2F2), a light-surface wash, right above
                     a table that is now properly black. Both become white at
                     low alpha, which is how every other surface on this chrome
                     says "raised". */
                  + (sort === k ? 'bg-white/10 text-white' : 'text-muted hover:bg-white/5 hover:text-white')
                }
                onClick={() => patch({ sort: k === 'active' ? null : k, page: null })}>
                {label}
              </button>
            ))}
          </div>

          {!err && (
            /* OPAQUE BLACK, AND THAT IS THE WHOLE FIX. `bg-surface` is
                rgba(255,255,255,.02) — two per cent white, which is glass, and
                the page's ground is #000 under a 24px graph-paper grid. So the
                grid ran straight through every row and the table read as
                mottled rather than as a surface. Glass is right for a panel
                floating over the drawing; a dense data table needs a ground of
                its own, or the ruling competes with the rules between the rows.
                The hairlines then drop to 10% white for the same reason they do
                everywhere else on this chrome — #EAEAEA at full strength is a
                light-surface border, and on black it draws harder than the
                content it separates. */
            <div className={'border border-border/10 rounded-lg overflow-hidden bg-black transition-opacity duration-150' + (busy ? ' opacity-60' : '')}>
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border/10 bg-black">User</th>
                    {/* WHO THEY ARE, WHICH IS WHY THE EXPORT DIALOG ASKS. A
                        number and an occupation collected and never looked at is
                        half a feature — this column is the other half, and it is
                        the reason a WhatsApp number is worth having at all. */}
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border/10 bg-black">Contact</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border/10 bg-black text-right w-[92px]">Projects</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border/10 bg-black text-right w-[92px]">Plans</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border/10 bg-black text-right w-[92px]">Ready</th>
                    <th className="text-left font-medium text-[10.5px] tracking-[.06em] uppercase text-subtle py-[10px] px-[14px] border-b border-border/10 bg-black">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {data == null
                    ? Array.from({ length: 6 }, (_, i) => (
                        <tr key={i} className="last:[&>td]:border-b-0"><td colSpan={6} className="p-0 border-b border-border/10 align-middle"><span className="block h-[47px] bg-[linear-gradient(90deg,#0A0A0A_25%,#1F1F1F_50%,#0A0A0A_75%)] bg-[length:400%_100%] animate-[skel_1.3s_ease-in-out_infinite]" /></td></tr>
                      ))
                    : rows.length === 0
                    ? <tr className="last:[&>td]:border-b-0"><td colSpan={6} className="py-[11px] px-[14px] border-b border-border/10 align-middle text-center text-subtle">
                        {q ? `Nobody matches “${q}”.` : 'No users yet.'}
                      </td></tr>
                    : rows.map((u) => (
                      <tr key={u.id} role="button" tabIndex={0}
                        /* `hover:bg-white/5` AND NOT THE #FDF2FE WASH. That pink
                           is the admin accent at light-surface strength and it
                           flashed a near-white band across a black table. The
                           magenta focus ring stays: a ring is a line, not a
                           fill, and it reads correctly on either ground. */
                        className="group cursor-pointer last:[&>td]:border-b-0 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C026D3] focus-visible:outline-offset-[-2px]"
                        onClick={() => nav(`/admin/users/${u.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') nav(`/admin/users/${u.id}`); }}>
                        <td className="py-[11px] px-[14px] border-b border-border/10 align-middle">
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden="true"
                              className="grid place-items-center w-[26px] h-[26px] rounded-full border border-border-strong bg-surface-3 text-muted text-[11.5px] flex-none [cursor:inherit] transition-[background,border-color,box-shadow] duration-[120ms] [transition-timing-function:ease] hover:bg-[#0060D9] hover:border-[#0060D9] hover:text-white group-hover:!border-[#C026D3] group-hover:!text-[#C026D3]">
                              {(u.full_name || u.email || u.phone?.replace(/^\+/, '') || '—')
                                .trim().charAt(0).toUpperCase()}
                            </span>
                            <div className="flex flex-col gap-[1px] min-w-0">
                              {/* NAME, THEN ADDRESS, THEN NUMBER — the same
                                  ladder `handle` climbs in src/lib/auth.jsx, and
                                  it is here for a reason phone login created. A
                                  fresh phone account has NO name and NO address:
                                  full_name is deliberately left null at sign-up
                                  (see migration 0011) because a number is not a
                                  name, and the address is not collected until
                                  the first export. Both of the old fallbacks are
                                  therefore empty, and every new user showed up
                                  in this list as "Unnamed" over a dash —
                                  unidentifiable, while we were holding the one
                                  thing that does identify them. */}
                              <b className="text-[12.5px] font-medium">
                                {u.full_name || u.email || u.phone || 'Unnamed'}
                              </b>
                              {/* The email is the identifier that actually
                                  matters in a support conversation, so it is
                                  always shown — even when it is also the name. */}
                              <span className="text-[11px] text-subtle overflow-hidden text-ellipsis whitespace-nowrap max-w-[34ch]">{u.email || '—'}</span>
                            </div>
                            {u.role === 1 && <span className="font-sans text-[9.5px] tracking-[.05em] uppercase py-0.5 px-1.5 rounded-full border border-[#F0ABFC] bg-[#FDF2FE] text-[#C026D3] whitespace-nowrap">admin</span>}
                          </div>
                        </td>
                        <td className="py-[11px] px-[14px] border-b border-border/10 align-middle">
                          <div className="flex flex-col gap-[1px] min-w-0">
                            {/* A `tel:` LINK AND NOT PLAIN TEXT, because the one
                                thing anybody does with this column is get in
                                touch — and the number is stored in E.164, which
                                is exactly what an href wants. It stops the row's
                                own click, or reaching for the phone would open
                                the user's account instead. */}
                            {/* `text-text` AND NOT `text-ink`, WHICH WAS INVISIBLE.
                                `--color-ink` is #000 and this table sits on the
                                app's near-black chrome, so the number rendered
                                black-on-black — and nobody noticed because
                                `profiles.phone` used to be the WhatsApp number
                                from the export gate, which exactly one account
                                had. Phone login puts a number on EVERY row, so a
                                latent bug became the whole column. */}
                            {u.phone
                              ? <a href={`tel:${u.phone}`} className="text-[12px] text-text no-underline hover:underline"
                                  onClick={(e) => e.stopPropagation()}>{u.phone}</a>
                              : <span className="text-[12px] text-faint">—</span>}
                            <span className="text-[11px] text-subtle whitespace-nowrap">
                              {occupationLabel(u.occupation) ?? 'not asked yet'}
                            </span>
                          </div>
                        </td>
                        <td className="py-[11px] px-[14px] border-b border-border/10 align-middle text-right w-[92px] text-subtle font-sans">{u.projects}</td>
                        <td className="py-[11px] px-[14px] border-b border-border/10 align-middle text-right w-[92px] text-subtle font-sans">{u.plans}</td>
                        {/* THE ONE NUMBER IN FULL STRENGTH. Zero is drawn muted
                            rather than bold, because a column of bold zeroes
                            shouts about the thing that did not happen.
                            
                            IT WAS `text-ink` AND THAT IS #000, so on this dark
                            table the meaningful counts were invisible and only
                            the zeroes could be read — the exact inverse of what
                            this comment claims the column does. Same cause as
                            the phone above. */}
                        <td className={'py-[11px] px-[14px] border-b border-border/10 align-middle text-right w-[92px] font-sans' + (u.plans_ready ? ' text-text font-medium' : ' text-subtle')}>
                          {u.plans_ready}
                        </td>
                        <td className="py-[11px] px-[14px] border-b border-border/10 align-middle text-subtle">
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
