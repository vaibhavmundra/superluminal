import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from './Wordmark.jsx';

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
  const { initial, displayName, user, signOut } = useAuth();
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
    <aside className="rail">
      {/* THE STACKED WORDMARK IS WHAT MAKES A 56px RAIL POSSIBLE. A horizontal
          logotype would need three times this width; two lines fit the column
          the rail already is, so the asset being stacked is a piece of luck
          worth using rather than working around. */}
      {/* <Link to="/dashboard" className="rail-mark" title="Dashboard" aria-label="Dashboard">
        <Logo width={38} />
      </Link> */}

      <div className="rail-spacer" />

      <div className="rail-account" ref={wrapRef}>
        {open && (
          <div className="rail-menu" role="menu">
            <div className="rail-who">
              <b>{displayName || 'Signed in'}</b>
              {user?.email && displayName !== user.email && <span>{user.email}</span>}
            </div>
            <button role="menuitem" onClick={() => { setOpen(false); nav('/dashboard'); }}>
              All projects
            </button>
            <button role="menuitem" onClick={() => { setOpen(false); nav('/'); }}>
              New plan
            </button>
            <div className="rail-sep" />
            <button role="menuitem" className="danger"
              onClick={async () => { setOpen(false); await signOut(); nav('/', { replace: true }); }}>
              Log out
            </button>
          </div>
        )}
        <button className={'bubble' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu" aria-expanded={open}
          title={displayName || 'Account'}>
          {initial}
        </button>
      </div>
    </aside>
  );
}
