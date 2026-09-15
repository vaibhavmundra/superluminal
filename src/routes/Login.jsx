import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { peekUpload, takeUpload } from '../lib/pendingUpload.js';
import { startPlanUpload } from '../lib/uploads.js';
import { toE164, normalisePhone } from '../lib/profile.js';
import { DIAL_CODES, DEFAULT_ISO, splitDial, countryForDial, countryForIso, flagOf }
  from '../lib/dialCodes.js';
import Wordmark from '../components/Wordmark.jsx';

// ---------------------------------------------------------------------------
// A NUMBER, THEN SIX DIGITS. Two states in one component, because they are two
// halves of one sentence and a second route for the code would be a URL a user
// could land on with nothing to verify against.
//
// THE COUNTRY IS A SELECT AND THE NUMBER IS A BOX, which is the same pair the
// export dialog used to wear and is here for a reason that got STRONGER on the
// way up the funnel. A single text box pre-filled with `+91 ` reads as part of
// YOUR NUMBER rather than as a choice, so somebody in London types after it and
// sends a code to `+912079460958` — the wrong country, a plausible length, and
// nothing anywhere that can tell. That used to cost an unreachable lead. It now
// costs an ACCOUNT: the code goes to a number that is not theirs, so there is
// nothing to type back, and the failure looks exactly like a broken app. See
// src/lib/dialCodes.js.
//
// NO ACCENT ON THIS SCREEN, AND BOTH PRIMARIES ARE WHITE. The ramp is what the
// rest of the app spends on a DESIGN act — light the spaces, add a plan, close
// an outline — and signing in is not one of them however important it is. It is
// the turnstile in front of the work, and dressing it in the colour the work
// uses makes the turnstile look like the work. White is what this palette says a
// primary with when the accent would be a lie about the act; the two text
// actions under the code field are the same decision one step quieter.
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

  // PREFILLED WHERE THE CALLER ALREADY KNOWS THE NUMBER. Nothing sends one today;
  // it costs a few lines, and it means a link that does — an invite, a "sign in
  // as" from somewhere else — will not make somebody retype what was already on
  // screen. A passed number is E.164, so it splits cleanly into the two controls.
  const passed = normalisePhone(loc.state?.phone || '');
  const [iso, setIso] = useState(() =>
    countryForDial(splitDial(passed ?? '')?.dial)?.iso ?? DEFAULT_ISO);
  const [local, setLocal] = useState(() => splitDial(passed ?? '')?.national ?? '');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('phone');   // phone | code
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef(null);
  const handled = useRef(false);

  const from = loc.state?.from || '/dashboard';
  const waitingFile = peekUpload();
  const uploadName = loc.state?.upload || waitingFile?.name || null;

  const country = countryForIso(iso) ?? countryForIso(DEFAULT_ISO);
  // THE ONE STRING EVERYTHING DOWNSTREAM USES. The code is SENT to this and
  // VERIFIED against this, from the same expression — those two drifting apart
  // is an account nobody can ever sign in to, and deriving them separately is
  // the only way that happens.
  const phone = toE164(country.dial, local);

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

  /**
   * WHAT HAPPENS WHEN SOMEBODY PASTES A WHOLE INTERNATIONAL NUMBER into the
   * national box — which is the commonest way a wrong country code would be
   * dialled, because a pasted `+44 20 7946 0958` behind a select that still says
   * India produces `+914420…`.
   *
   * THE `+` OR `00` IS THE ONLY SIGNAL, and it has to be, because a bare
   * national number is genuinely ambiguous: `9876543210` splits perfectly well
   * as Iran's +98 followed by eight digits. Guessing a country from digits that
   * do not claim to carry one is exactly the class of silent error this whole
   * control exists to stop, so the split runs only when the text says it is
   * international.
   */
  const onLocal = (raw) => {
    setErr('');
    const intl = raw.trim().startsWith('+') || /^\s*00\d/.test(raw);
    if (intl) {
      const parts = splitDial(raw.replace(/\D/g, '').replace(/^00/, ''));
      const found = parts && countryForDial(parts.dial);
      if (found) { setIso(found.iso); setLocal(parts.national); return; }
    }
    setLocal(raw);
  };

  const submitPhone = async (e) => {
    e.preventDefault();
    if (!phone) return;
    setBusy(true); setErr('');
    try {
      await sendCode(phone);
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
    try { await verifyCode(phone, code); }        // the effect above takes it from here
    catch (ex) { setErr(String(ex.message || ex)); setBusy(false); }
  };

  return (
    <div className="min-h-full flex flex-col items-center">
      {/* BLACK, AND OPAQUE — not the 5% white glass the rest of this app wears.
          Two reasons, and the second is the binding one. The page's ground is
          #000 under a 24px graph-paper grid, and glass lets that grid run
          straight through the header and behind the wordmark. And the logo is a
          PLATED asset — white ink on an opaque black rectangle, chosen because
          it is a tenth the weight of the transparent cut (see Wordmark.jsx) —
          so anything but #000 behind it shows the plate as a box round the
          mark. The hairline underneath is then what separates the bar from the
          page rather than a change in tone. */}
      <div className="w-full h-14 flex items-center px-[22px] border-b border-border/10 bg-[var(--bg)]"><Wordmark /></div>

      <div className="w-[min(420px,92%)] m-auto bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8] border border-border/10 rounded-lg py-[30px] px-7 shadow-pop">
        {!configured ? (
          <>
            <h1 className="m-0 mb-2 text-[22px] tracking-[-0.03em] text-white">Supabase is not configured</h1>
            <p className="m-0 mb-[22px] text-muted text-[12.5px] leading-[1.6]">
              Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to
              <code> .env.local</code> and restart the dev server.
            </p>
          </>
        ) : stage === 'phone' ? (
          <>
            <h1 className="m-0 mb-2 text-[22px] tracking-[-0.03em] text-white">Sign in to start designing</h1>
            <p className="m-0 mb-[22px] text-muted text-[12.5px] leading-[1.6]">
              {uploadName
                ? <>We will text you a six-digit code, then open <b>{uploadName}</b>.</>
                : <>We will text you a six-digit code. No password to remember.</>}
            </p>
            <form onSubmit={submitPhone} className="flex flex-col gap-2">
              <label className="text-[10px] tracking-[0.11em] uppercase text-subtle" htmlFor="login-phone">Mobile number</label>
              <div className="flex gap-2 items-start">
                <select value={iso} aria-label="Country"
                  /* WIDE ENOUGH FOR "United Kingdom +44" AND NOT FOR EVERY NAME,
                     which is the honest compromise: a native select shows its
                     chosen option truncated to the control's width, and sizing
                     for "Bosnia & Herzegovina" would give a third of the card to
                     a control that is correct by default. The preview line
                     underneath always names the country in full, so nothing is
                     ever only half-said. */
                  className="flex-none w-[10.5rem] max-[420px]:w-[8.5rem] h-field-h text-[12.5px]"
                  onChange={(e) => { setIso(e.target.value); setErr(''); }}>
                  {DIAL_CODES.map((c) => (
                    /* THE FLAG, THE NAME AND THE CODE, in that order, and all
                       three are needed. The flag is the fast scan, the name is
                       what somebody searches for by typing into a native select,
                       and the code is the thing being chosen — a list of flags
                       alone is unreadable on a platform that renders them as
                       letter pairs. */
                    <option key={c.iso} value={c.iso}>
                      {flagOf(c.iso)} {c.name} +{c.dial}
                    </option>
                  ))}
                </select>
                <input id="login-phone" type="tel" autoFocus value={local}
                  className="flex-1 min-w-0 h-field-h px-3.5 py-0 text-[14px]"
                  placeholder="98765 43210" autoComplete="tel-national"
                  onChange={(e) => onLocal(e.target.value)} />
              </div>
              <p className="text-[11.5px] text-muted leading-[1.5] mt-0.5">
                {/* THE PREVIEW IS THE POINT OF THE WHOLE ARRANGEMENT. It shows
                    the exact number the code will be sent to, so a wrong country
                    is visible BEFORE the SMS goes rather than when it never
                    arrives — and it is where the trunk-zero rule announces
                    itself, since somebody who types `020 7946 0958` sees
                    `+442079460958` come back and can tell at a glance that the
                    zero was understood rather than swallowed. */}
                {phone
                  ? <>Code goes to <b className="text-text">{phone}</b> · {country.name}</>
                  : <>Your number without the country code — pick the country on the left.</>}
              </p>
              <button className="text-[14px] px-[22px] h-field-h rounded-[8px] border border-white bg-white text-black inline-flex items-center justify-center cursor-pointer transition-colors duration-[120ms] hover:bg-text hover:border-text disabled:opacity-100 disabled:cursor-not-allowed mt-2 w-full"
                type="submit" disabled={busy || !phone}>
                {busy ? 'Sending…' : 'Send the code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="m-0 mb-2 text-[22px] tracking-[-0.03em] text-white">Enter the code</h1>
            <p className="m-0 mb-[22px] text-muted text-[12.5px] leading-[1.6]">Sent to <b>{phone}</b>. It is good for an hour.</p>
            <form onSubmit={submitCode} className="flex flex-col gap-2">
              <label className="text-[10px] tracking-[0.11em] uppercase text-subtle" htmlFor="code">Six-digit code</label>
              {/* `type="text"` is not decoration: the stylesheet reaches fields by
                  attribute selector, and an input with no type attribute is
                  matched by none of them — it was styled by the browser, not by
                  us. inputMode is what actually summons the numeric keypad. */}
              <input id="code" ref={codeRef} type="text" inputMode="numeric"
                className="h-field-h px-3.5 py-0 text-[14px] tracking-[0.42em] text-center tabular-nums"
                autoComplete="one-time-code" maxLength={6} placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <button className="text-[14px] px-[22px] h-field-h rounded-[8px] border border-white bg-white text-black inline-flex items-center justify-center cursor-pointer transition-colors duration-[120ms] hover:bg-text hover:border-text disabled:opacity-100 disabled:cursor-not-allowed mt-2 w-full"
                type="submit" disabled={busy || code.length < 6}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
              <div className="flex justify-between gap-3 mt-3">
                <button type="button"
                  className="border-0 bg-transparent p-0 text-[11.5px] text-text cursor-pointer no-underline transition-colors duration-[120ms] hover:text-white hover:underline disabled:text-subtle disabled:cursor-default disabled:no-underline disabled:hover:text-subtle"
                  disabled={!!resendIn}
                  onClick={submitPhone}>
                  {resendIn ? `Resend in ${resendIn}s` : 'Resend the code'}
                </button>
                <button type="button"
                  className="border-0 bg-transparent p-0 text-[11.5px] text-text cursor-pointer no-underline transition-colors duration-[120ms] hover:text-white hover:underline disabled:text-subtle disabled:cursor-default disabled:no-underline disabled:hover:text-subtle"
                  onClick={() => { setStage('phone'); setCode(''); setErr(''); }}>
                  Use a different number
                </button>
              </div>
            </form>
          </>
        )}

        {err && <p className="text-[11.5px] text-danger leading-[1.5] mt-2 border-l-2 border-danger pl-[9px]">{err}</p>}

        {/* The honest sentence about the lost file — see pendingUpload.js. */}
        {loc.state?.upload && !waitingFile && !user && (
          <p className="text-[11.5px] text-muted leading-[1.5] mt-2">
            Your drawing was not carried over — the page reloaded. Sign in and drop it
            again from the dashboard.
          </p>
        )}
      </div>
    </div>
  );
}
