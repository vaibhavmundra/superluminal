import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useBilling } from '../lib/billing.jsx';
import { stashUpload } from '../lib/pendingUpload.js';
import { startPlanUpload } from '../lib/uploads.js';
import Wordmark from '../components/Wordmark.jsx';
import CheckoutDialog from '../components/CheckoutDialog.jsx';
import { PAID, TIER, FREE, fmtSqft } from '../lib/plans.js';

// ---------------------------------------------------------------------------
// THE HOME PAGE, which is the upload screen with a promise over it.
//
// One sentence and one button. The sentence is a CLAIM ABOUT TIME — "in
// minutes" — because that is the thing this tool actually competes on, and the
// button is the same drop target the editor has always had, so there is exactly
// one gesture to learn and it is the first one you make.
//
// THE SIGN-IN IS DELIBERATELY DOWNSTREAM OF THE DROP. Asking for an email
// before showing what the app does is asking for trust nobody has yet; asking
// for it while a drawing is already being read is asking at the only moment the
// answer is obviously worth it. The file is held in memory across the login step
// (pendingUpload.js) and turned into a plan the instant there is a session.
//
// AND THE PRICE IS ON IT, IN ONE LINE, UNDER THE UPLOAD.
//
// A band and not a section, and it sits BELOW the drop target rather than beside
// it. The order is the argument: this page has one job, which is to get a drawing
// into the app, and a pricing block competing with the upload button would make
// the first decision on the page "how much" instead of "let me see it work".
// Underneath, it answers the question somebody asks on the way out — is this
// free, and what does it cost if it is not — without ever having been in the way.
//
// THE SUBSCRIBE BUTTONS GO STRAIGHT TO CHECKOUT. Not to /pricing, which would be
// a page in front of a decision already made: somebody who reads "$30 for 50,000
// sq ft" and clicks it has chosen. The details dialog opens on the spot, and the
// full comparison is a quieter link for anybody who has not.
// ---------------------------------------------------------------------------
export default function Home() {
  const nav = useNavigate();
  const { user, ready } = useAuth();
  const { checkout } = useBilling();
  const [over, setOver] = useState(false);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [payErr, setPayErr] = useState('');
  const [msg, setMsg] = useState('');
  const inputRef = useRef(null);

  /**
   * SIGNED OUT, THE CHOICE IS REMEMBERED AND THE USER IS SENT TO SIGN IN — and
   * they come back to /pricing rather than here, because that is the screen that
   * knows how to reopen a checkout. Landing them back on the home page would
   * mean finding the button again, which is the same "asking twice" this whole
   * flow is built to avoid.
   */
  const subscribe = useCallback((slug) => {
    setPayErr(''); setMsg('');
    if (!user) { nav('/login', { state: { from: '/pricing', tier: slug } }); return; }
    setPicked(slug);
  }, [user, nav]);

  const pay = useCallback(async (details) => {
    setBusy(true); setPayErr('');
    try {
      const out = await checkout({ tier: picked, details });
      if (out.ok) {
        setMsg(`You are on ${TIER[picked]?.name}. ${fmtSqft(out.state.area.left)} available.`);
        setPicked(null);
      } else setPicked(null);
    } catch (e) { setPayErr(String(e.message || e)); }
    finally { setBusy(false); }
  }, [checkout, picked]);

  const accept = useCallback(async (file) => {
    if (!file) return;
    const ok = /\.(dxf|pdf)$/i.test(file.name)
      || (file.type || '').startsWith('image/')
      || file.type === 'application/pdf';
    if (!ok) { setErr('That is not a drawing — a DXF, a PDF, or an image of a plan, please.'); return; }
    setErr('');

    // NOT SIGNED IN: hold the file and go and ask. The route is remembered as
    // the home page rather than the editor, because the plan it would open does
    // not exist yet — Login finishes the upload once it has a session.
    if (!user) {
      stashUpload(file);
      nav('/login', { state: { from: '/', upload: file.name } });
      return;
    }

    // STRAIGHT THROUGH. The job creates the project and the row and pushes the
    // bytes in the background; the editor works from this very File and does not
    // need any of it to have finished. See lib/uploads.js.
    const job = startPlanUpload(file);
    nav(`/plans/${job.planId}`);
  }, [user, nav]);

  return (
    <div className="home">
      <header className="home-top">
        <Wordmark />
        <div className="spacer" />
        <button className="btn" onClick={() => nav('/pricing')}>Pricing</button>
        {ready && (user
          ? <button className="btn" onClick={() => nav('/dashboard')}>Your projects</button>
          : <button className="btn" onClick={() => nav('/login')}>Sign in</button>)}
      </header>

      <main
        className={'home-main' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files?.[0]); }}
      >
        <h1 className="home-h1">Create lighting layouts<br />in minutes</h1>
        <p className="home-sub">
          Lighting layouts used to take hours. Our trained AI models understand your space, the use case and create fully functional layouts in a matter of minutes.
        </p>

        <div className="home-cta">
          <button className="btn primary big"
            onClick={() => inputRef.current?.click()}>
            + Upload a floor plan
          </button>
          <input ref={inputRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
            onChange={(e) => accept(e.target.files?.[0])} />
          <span className="home-hint">or drop it anywhere on this page · DXF, PDF or image</span>
        </div>

        {err && <p className="note err home-err">{err}</p>}
        {msg && <p className="note ok-note home-err">{msg}</p>}
        {payErr && <p className="note err home-err">{payErr}</p>}

        <div className="price-band">
          <span className="price-band-lead">
            Free for your first {fmtSqft(FREE.area)}. Then:
          </span>
          {PAID.map((t) => (
            <button key={t.slug} className="price-chip" onClick={() => subscribe(t.slug)}>
              <b>${t.usd}<i>/mo</i></b>
              <span>{fmtSqft(t.area)} a month</span>
              <em>Subscribe</em>
            </button>
          ))}
          <button className="linkish" onClick={() => nav('/pricing')}>
            How the meter works
          </button>
        </div>
      </main>

      {picked && (
        <CheckoutDialog
          tier={TIER[picked]}
          defaults={{ email: user?.email || '' }}
          busy={busy}
          error={payErr}
          onCancel={() => { if (!busy) { setPicked(null); setPayErr(''); } }}
          onPay={pay} />
      )}

      <footer className="home-foot">
        <span></span>
        <span></span>
      </footer>
    </div>
  );
}
