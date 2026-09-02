import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useBilling } from '../lib/billing.jsx';
import { fmtSqft } from '../lib/plans.js';

// ---------------------------------------------------------------------------
// THE RAIL. Fifty-six pixels wide, and it holds two things: the mark at the top
// and the account at the bottom.
//
// WHY A BUBBLE WITH ONE LETTER AND NOT A NAME. This is the only chrome on a
// screen whose subject is a grid of drawings, and a name in a sidebar is a
// second column of text competing with the thing the user came to look at. One
// letter is recognisable at a glance, is the same width for everybody, and needs
// no truncation logic — and the full name is one click away, at the top of the
// menu, which is where somebody who wants to check which account they are in
// will look anyway.
//
// THE BUBBLE IS THE ACCENT, and it is the one place on these screens that gets
// to be one. The rule for #0070F3 in this app is "the live thing, the thing you
// are touching" — and on a page whose subject is a grid of drawings, the account
// is the only genuinely interactive object in the chrome. A grey circle in a grey
// rail reads as a label; a blue one reads as a control.
//
// THE MENU IS A POPOVER, dismissed by Escape, by a click anywhere else, and by
// choosing something. All three, because a menu that only closes on its own
// button is a menu that gets left open behind a dialog.
// ---------------------------------------------------------------------------
export default function ProfileRail() {
  const { initial, displayName, user, signOut, isAdmin } = useAuth();
  const { state, tier } = useBilling();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <aside className="flex flex-col items-center gap-2.5 border-r border-border bg-surface pt-[18px] pb-3.5">
      {/* HOME, AT THE TOP, AND IT IS A HOUSE RATHER THAN THE WORDMARK.
          The stacked logotype used to live here and was commented out, which
          left the rail's top empty and the admin door — a thing most people
          never see — as the first mark on the page. A rail with nothing at the
          top reads as a rail that failed to load.
          A HOUSE AND NOT THE MARK, because the two say different things. A
          logo in the corner is branding and is only incidentally a link; every
          screen in this app already carries the wordmark somewhere it belongs.
          What this position is FOR is the way out, and the icon everybody
          already reads as "the way out to the start" is a house.
          IT IS GREY UNTIL IT IS TOUCHED, like the admin door under it. Blue in
          this rail is spoken for by the account bubble — the one genuinely
          interactive object in the chrome — and two blues would say neither. */}
      <Link to="/dashboard"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] text-subtle transition-colors duration-[120ms] hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        title="Dashboard" aria-label="Dashboard">
        {/* Drawn rather than loaded, for the reason the mark is: it takes the
            ink colour with it and stays sharp at any density. */}
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true">
          <path d="M3.4 10.2 12 3.5l8.6 6.7" />
          <path d="M5.4 9v10.1a1.4 1.4 0 0 0 1.4 1.4h10.4a1.4 1.4 0 0 0 1.4-1.4V9" />
          <path d="M9.9 20.5v-5.4a1.2 1.2 0 0 1 1.2-1.2h1.8a1.2 1.2 0 0 1 1.2 1.2v5.4" />
        </svg>
      </Link>

      {/* THE ADMIN DOOR, and it is the only thing that has ever earned a place
          in the middle of this rail.

          VISIBLE ONLY TO ROLE 1, and that is a courtesy rather than a control:
          the console it opens asks /api/admin, which re-checks the role
          server-side against the database on every single request. Hiding the
          link stops it cluttering everybody else's rail; it is not what stops
          anybody else reading the data. See the header of api/admin.js.

          MAGENTA, NOT THE ACCENT. #0070F3 on these screens means "the live
          thing, the thing you are touching", and it is already spoken for by
          the account bubble below. The audit overlays in the editor's panel
          already use magenta for exactly this idea — working, not product — so
          the operator's surfaces read as one thing across the app. */}
      {isAdmin && (
        <Link to="/admin/users"
          className="flex h-8 w-8 items-center justify-center rounded-[8px] mt-2 text-subtle transition-colors duration-[120ms] hover:bg-[#FDF2FE] hover:text-[#C026D3]"
          title="Users (admin)" aria-label="Users (admin)">
          {/* Three figures. Drawn rather than loaded for the same reason the
              lit-aperture mark is: it takes the ink colour with it and stays
              sharp at any density. */}
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none"
            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M15.5 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H5.9A3.4 3.4 0 0 0 2.5 18.4V20" />
            <circle cx="9" cy="7.6" r="3.4" />
            <path d="M21.5 20v-1.6a3.4 3.4 0 0 0-2.6-3.3" />
            <path d="M16 4.2a3.4 3.4 0 0 1 0 6.6" />
          </svg>
        </Link>
      )}

      <div className="flex-1" />

      <div className="relative" ref={wrapRef}>
        {open && (
          <div className="absolute bottom-0 left-11 z-20 flex w-[210px] flex-col gap-0.5 rounded-lg border border-border bg-surface p-1.5 shadow-pop" role="menu">
            <div className="flex flex-col gap-0.5 border-b border-border pt-2 px-[9px] pb-2.5 mb-1">
              <b className="text-[12.5px]">{displayName || 'Signed in'}</b>
              {user?.email && displayName !== user.email && (
                <span className="text-[11px] text-subtle overflow-hidden text-ellipsis">{user.email}</span>
              )}
              {/* THE BALANCE, WHERE THE ACCOUNT ALREADY IS. It belongs in this
                  menu rather than in the editor's chrome: a number that ticks
                  down beside a drawing is a meter running, and a meter running is
                  the wrong thing to have in somebody's peripheral vision while
                  they work. Here it is one click away, next to the name it
                  belongs to, and only when somebody went looking. */}
              <span className="text-[10.5px] text-subtle tracking-[0.02em] tabular-nums mt-[3px]">
                {state.unlimited
                  ? `${tier.name} · unmetered`
                  : `${tier.name} · ${fmtSqft(state.area.left)} left`}
              </span>
            </div>
            <button role="menuitem"
              className="text-left border-0 bg-transparent text-[12.5px] py-[7px] px-[9px] rounded cursor-pointer text-ink hover:bg-surface-3"
              onClick={() => { setOpen(false); nav('/dashboard'); }}>
              All projects
            </button>
            <button role="menuitem"
              className="text-left border-0 bg-transparent text-[12.5px] py-[7px] px-[9px] rounded cursor-pointer text-ink hover:bg-surface-3"
              onClick={() => { setOpen(false); nav('/'); }}>
              New plan
            </button>
            <button role="menuitem"
              className="text-left border-0 bg-transparent text-[12.5px] py-[7px] px-[9px] rounded cursor-pointer text-ink hover:bg-surface-3"
              onClick={() => { setOpen(false); nav('/pricing'); }}>
              Plan &amp; usage
            </button>
            {isAdmin && (
              <button role="menuitem"
                className="text-left border-0 bg-transparent text-[12.5px] py-[7px] px-[9px] rounded cursor-pointer text-ink hover:bg-surface-3"
                onClick={() => { setOpen(false); nav('/admin/users'); }}>
                Users (admin)
              </button>
            )}
            <div className="h-px bg-border my-1" />
            <button role="menuitem"
              className="text-left border-0 bg-transparent text-[12.5px] py-[7px] px-[9px] rounded cursor-pointer text-danger-ink hover:bg-danger-soft"
              onClick={async () => { setOpen(false); await signOut(); nav('/', { replace: true }); }}>
              Log out
            </button>
          </div>
        )}
        <button
          className={'w-8 h-8 rounded-full border text-[13px] cursor-pointer grid place-items-center transition-colors duration-[120ms] ' +
            (open ? 'bg-ink border-ink text-white' : 'bg-accent border-accent text-white hover:bg-accent-hover hover:border-accent-hover')}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu" aria-expanded={open}
          title={displayName || 'Account'}>
          {initial}
        </button>
      </div>
    </aside>
  );
}
