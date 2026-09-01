import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { peekUpload, takeUpload } from '../lib/pendingUpload.js';
import { startPlanUpload } from '../lib/uploads.js';
import Wordmark from '../components/Wordmark.jsx';

// ---------------------------------------------------------------------------
// EMAIL, THEN SIX DIGITS. Two states in one component, because they are two
// halves of one sentence and a second route for the code would be a URL a user
// could land on with nothing to verify against.
//
// THE UPLOAD FINISHES HERE, and that is the point of the whole screen. Somebody
// who dropped a plan on the home page is mid-task; landing them on a dashboard
// after signing in would make them find and re-drop the file they already
// chose. So the moment there is a session, a pending file becomes a plan and the
// editor opens on it — the login was a step in the middle of an upload, not a
// destination.
// ---------------------------------------------------------------------------
export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, ready, sendCode, verifyCode, configured } = useAuth();

  // PREFILLED WHERE THE CALLER ALREADY KNOWS THE ADDRESS. Nothing sends one today;
  // it costs one line, and it means a link that does — an invite, a "sign in as"
  // from somewhere else — will not make somebody retype what was already on
  // screen.
  const [email, setEmail] = useState(() => String(loc.state?.email || ''));
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('email');   // email | code
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef(null);
  const handled = useRef(false);

  const from = loc.state?.from || '/dashboard';
  const waitingFile = peekUpload();
  const uploadName = loc.state?.upload || waitingFile?.name || null;

  // A session appearing — from this form or from another tab — is the trigger
  // for everything that happens next. `handled` guards against the double
  // invocation StrictMode makes in dev, which would otherwise create the plan
  // twice and leave a duplicate nobody asked for.
  useEffect(() => {
    if (!ready || !user || handled.current) return;
    handled.current = true;
    (async () => {
      const file = takeUpload();
      if (!file) {
        // WHERE THEY WERE HEADING, AND ANY TIER THAT CAME WITH IT.
        //
        // Buying no longer requires signing in at all (see routes/Pricing.jsx), so
        // the common path through here carries no tier — the purchase is already
        // paid for and waiting, and /api/billing hands it over on the next state
        // call. The slug is still forwarded because a link can carry one, and
        // because it costs one line to not lose it. Route state and not storage:
        // storage would still be there next week and would reopen a payment dialog
        // nobody asked for.
        const to = from === '/' ? '/dashboard' : from;
        const tier = loc.state?.tier ?? null;
        nav(to, { replace: true, state: tier ? { tier } : null });
        return;
      }
      // The drop resumes as a background job, exactly as it would have from the
      // dashboard — the sign-in was a step in the middle of an upload, and the
      // user should land in the editor rather than watching a progress bar for
      // the file they chose two minutes ago.
      const job = startPlanUpload(file);
      nav(`/plans/${job.planId}`, { replace: true });
    })();
  }, [ready, user, from, nav, loc.state]);

  useEffect(() => {
    if (!resendIn) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const submitEmail = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setErr('');
    try {
      await sendCode(email);
      setStage('code');
      setResendIn(45);
      setTimeout(() => codeRef.current?.focus(), 60);
    } catch (ex) { setErr(String(ex.message || ex)); }
    finally { setBusy(false); }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    if (code.trim().length < 6) return;
    setBusy(true); setErr('');
    try { await verifyCode(email, code); }        // the effect above takes it from here
    catch (ex) { setErr(String(ex.message || ex)); setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="auth-top"><Wordmark /></div>

      <div className="auth-card">
        {!configured ? (
          <>
            <h1>Supabase is not configured</h1>
            <p className="auth-sub">
              Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to
              <code> .env.local</code> and restart the dev server.
            </p>
          </>
        ) : stage === 'email' ? (
          <>
            <h1>Sign in to start designing</h1>
            <p className="auth-sub">
              {uploadName
                ? <>We will email you a six-digit code, then open <b>{uploadName}</b>.</>
                : <>We will email you a six-digit code. No password to remember.</>}
            </p>
            <form onSubmit={submitEmail} className="auth-form">
              <label className="auth-label" htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" autoFocus required
                placeholder="you@studio.com" value={email}
                onChange={(e) => setEmail(e.target.value)} />
              <button className="btn primary big" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Send the code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>Enter the code</h1>
            <p className="auth-sub">Sent to <b>{email}</b>. It is good for an hour.</p>
            <form onSubmit={submitCode} className="auth-form">
              <label className="auth-label" htmlFor="code">Six-digit code</label>
              {/* `type="text"` is not decoration: the stylesheet reaches fields by
                  attribute selector, and an input with no type attribute is
                  matched by none of them — it was styled by the browser, not by
                  us. inputMode is what actually summons the numeric keypad. */}
              <input id="code" ref={codeRef} className="otp" type="text" inputMode="numeric"
                autoComplete="one-time-code" maxLength={6} placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <button className="btn primary big" type="submit" disabled={busy || code.length < 6}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
              <div className="auth-alt">
                <button type="button" className="linkish" disabled={!!resendIn}
                  onClick={submitEmail}>
                  {resendIn ? `Resend in ${resendIn}s` : 'Resend the code'}
                </button>
                <button type="button" className="linkish"
                  onClick={() => { setStage('email'); setCode(''); setErr(''); }}>
                  Use a different email
                </button>
              </div>
            </form>
          </>
        )}

        {err && <p className="note err">{err}</p>}

        {/* The honest sentence about the lost file — see pendingUpload.js. */}
        {loc.state?.upload && !waitingFile && !user && (
          <p className="note">
            Your drawing was not carried over — the page reloaded. Sign in and drop it
            again from the dashboard.
          </p>
        )}
      </div>
    </div>
  );
}
