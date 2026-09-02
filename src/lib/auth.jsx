// ---------------------------------------------------------------------------
// AUTH — a session, a listener, and one gate.
//
// EMAIL OTP AND NOTHING ELSE. No password to store, reset, or leak; no OAuth
// consent screen to explain to somebody who just wants to see their ceiling
// lit. Supabase calls it `signInWithOtp` and the six-digit code is verified in
// the same tab, which matters more than it sounds: a magic LINK opens a second
// tab, and the drawing the user just dropped is in the first one's memory. A
// code typed into the tab that already holds the file keeps the upload alive.
//
// THE GATE IS A ROUTE WRAPPER, NOT A REDIRECT INSIDE EVERY PAGE. `RequireAuth`
// renders nothing but its children once there is a session, sends an anonymous
// visitor to /login with where-they-were-going remembered, and — importantly —
// renders a WAIT while the session is still being read from storage. Skipping
// that third state is the classic bug: on a hard refresh of /dashboard the
// session takes a tick to load, the guard sees null, and the user is bounced to
// a login screen they are already logged in for.
// ---------------------------------------------------------------------------
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, supabaseReady, hasStoredSession } from './supabase.js';

// The old `.btn` / `.btn.primary` / `.btn.secondary` classes, as Tailwind
// utilities — same split as PlanPicker.jsx / RenderPassPanel.jsx.
const BTN_BASE = 'text-[12px] px-3 py-[7px] rounded border cursor-pointer transition-colors duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_PRIMARY = 'border-cta bg-cta text-white hover:bg-cta-hover hover:border-cta-hover disabled:hover:bg-surface disabled:hover:border-border';
const BTN_SECONDARY = 'border-border-strong bg-surface text-ink hover:bg-surface-2 hover:border-ink active:bg-surface-3';

const Ctx = createContext(null);

// ---------------------------------------------------------------------------
// NO AUTH CALL MAY HANG FOREVER, and this is here because one did.
//
// `signInWithOtp` is not a quick round trip: the server waits for the EMAIL TO
// BE SENT before it answers, so a wedged or rate-limited SMTP config leaves the
// HTTP request pending — and supabase-js has no timeout of its own. The button
// then sits on "Sending…" indefinitely, which is the single worst thing a form
// can do, because it looks identical to "working" and there is nothing to act on.
//
// A ceiling turns that into a sentence somebody can do something about. It is
// generous — 30 seconds — because a slow send that eventually works is a real
// thing and killing it at 5 seconds would be its own bug.
//
// AND IT ALSO CATCHES THE OTHER CAUSE. supabase-js serialises auth calls behind
// a Web Lock; if an earlier call is stuck holding it, later ones queue silently
// forever. Same symptom, different cause, same rescue — and the message says
// which by whether the network tab shows a pending request.
// ---------------------------------------------------------------------------
const LIMIT_MS = 30000;

const withLimit = (promise, what, ms = LIMIT_MS) => {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(
        `${what} got no answer in ${ms / 1000}s. The request is probably still `
        + 'pending — most often the email provider. Check Logs → Auth in the '
        + 'Supabase dashboard, and run `node tools/check-supabase.mjs <email>`.'
      )), ms);
    }),
  ]);
};

/**
 * Supabase's auth errors are terse and a few of them are actively misleading, so
 * the ones with a known cause get named. Anything unrecognised is passed through
 * verbatim rather than flattened into "something went wrong".
 */
function explain(error) {
  const msg = String(error?.message || error);
  const code = error?.status;
  // THE MAILER FAILED, AND THE APP IS NOT INVOLVED. Supabase returns this as a
  // 500 with a generic string for every SMTP failure there is — unverified
  // sender, wrong port, bad credentials, a broken Go template — so the message
  // alone is a dead end and the useful thing to say is WHERE the real error is
  // written down.
  if (/error sending .*(email|confirmation)/i.test(msg)) {
    return 'Supabase took the request but could not send the email. That is SMTP or '
      + 'template configuration on the project, not the app — the real error is in '
      + 'Logs → Auth in the dashboard. Usually: a sender address the SMTP provider '
      + 'has not verified, the wrong port or credentials, or a syntax error in the '
      + 'email template.';
  }
  if (code === 429 || /rate limit|too many/i.test(msg)) {
    return 'Too many codes requested. Supabase\'s built-in mailer allows only a few '
      + 'emails an hour — wait a few minutes, or configure custom SMTP.';
  }
  if (/signups not allowed|signup is disabled/i.test(msg)) {
    return 'This project has new sign-ups disabled, so a first-time email cannot be '
      + 'used. Enable them under Authentication → Sign In, or invite the user first.';
  }
  if (/invalid api key|jwt/i.test(msg)) {
    return 'The anon key was rejected. It may belong to a different project than '
      + 'VITE_SUPABASE_URL — `node tools/check-supabase.mjs` compares the two.';
  }
  if (/failed to fetch|network/i.test(msg)) {
    return 'The browser could not reach Supabase at all. Check VITE_SUPABASE_URL, '
      + 'and whether an extension or proxy is blocking the request.';
  }
  if (/token has expired|invalid.*(otp|token)/i.test(msg)) {
    return 'That code is wrong or has expired. Ask for a new one.';
  }
  return msg;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(!supabaseReady);   // no backend: never "loading"
  const [profile, setProfile] = useState(null);
  // "WE CANNOT CURRENTLY TELL", which is a third state and used to be missing.
  // True when a session exists in storage but no auth call has confirmed it —
  // the app then waits instead of concluding anything. See RequireAuth.
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    let settled = false;

    // THE LISTENER GOES FIRST, and that inversion is the fix.
    //
    // supabase-js fires this with INITIAL_SESSION once it has read storage, so
    // subscribing is itself the bootstrap — there is no need to await anything
    // to learn whether somebody is signed in. `getSession()` below is now only a
    // backstop for the case where that event never arrives.
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (!alive) return;
      settled = true;
      // A SIGN-OUT IS AN EVENT, NOT AN ABSENCE. Only these two events may clear
      // the session; every other path leaves it alone. That distinction is the
      // whole bug fix — see the note on the backstop.
      if (s) { setSession(s); setStalled(false); }
      else if (evt === 'SIGNED_OUT' || evt === 'USER_DELETED') { setSession(null); setStalled(false); }
      setReady(true);
      if (evt !== 'TOKEN_REFRESHED') console.log(`[auth] ${evt}`, s ? 'session' : 'no session');
    });

    // THE BACKSTOP, AND IT MUST NEVER SIGN ANYBODY OUT.
    //
    // This previously did `setSession(null)` when the read timed out, on the
    // reasoning that a failure was "true enough". It is not true at all: it
    // turned a slow network — or a wedged auth lock — into a logout, while a
    // perfectly good session sat in storage. That is the "randomly logged out"
    // bug, and it was ours rather than Supabase's.
    //
    // What a timeout actually means is "we could not find out". So it flips
    // `ready` (nothing may hang forever) and marks the state STALLED, which the
    // route guard renders as "reconnecting" rather than as a login screen.
    withLimit(supabase.auth.getSession(), 'Reading the session', 20000)
      .then(({ data }) => {
        if (!alive || !data?.session) return;
        settled = true;
        setSession(data.session);
        setStalled(false);
        setReady(true);
      })
      .catch((err) => {
        if (!alive) return;
        console.error('[auth] getSession did not answer — keeping the stored session', err);
        setReady(true);
        if (!settled && hasStoredSession()) setStalled(true);
      });

    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  /**
   * COME BACK AND TRY AGAIN.
   *
   * The trigger for the freeze is nearly always a tab that was put to sleep
   * mid-refresh: the browser suspends a background tab, the token request never
   * completes, and the auth lock is left held. Bounding the lock (see softLock)
   * stops that from being permanent, but somebody returning to the tab still
   * wants their session back without a reload — so returning to the tab is
   * itself the retry.
   *
   * `refreshSession` rather than `getSession` because a token that expired while
   * the tab slept is the common case, and a read would just hand back the stale
   * one.
   */
  const revalidate = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await withLimit(supabase.auth.refreshSession(), 'Refreshing', 15000);
      if (error) throw error;
      if (data?.session) { setSession(data.session); setStalled(false); }
    } catch (err) {
      console.warn('[auth] revalidate failed', err);
      // Still no clearing. If the refresh token is genuinely dead, Supabase
      // emits SIGNED_OUT through the listener and that is what signs us out.
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      if (stalled || !session) revalidate();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [stalled, session, revalidate]);

  // The profile row, for the name the avatar bubble takes its letter from. Read
  // separately from the session because auth.users is not readable from the
  // browser — `profiles` is the projection of it that RLS can talk about.
  useEffect(() => {
    if (!supabase || !session?.user) { setProfile(null); return; }
    let alive = true;
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { if (alive) setProfile(data ?? null); });
    return () => { alive = false; };
  }, [session?.user?.id]);

  const sendCode = useCallback(async (email) => {
    if (!supabase) throw new Error('Supabase is not configured — see .env.example');
    const t0 = Date.now();
    const { error } = await withLimit(supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      // shouldCreateUser: a first-time email is a sign-UP, and asking somebody
      // to register before they can see the plan they just uploaded is the
      // friction this flow exists to avoid.
      options: { shouldCreateUser: true },
    }), 'Sending the code');
    // TIMED, AND LOGGED EVEN ON SUCCESS. A send that takes eleven seconds is
    // working and about to become a support question; knowing that it is the
    // mailer and not the app is the difference between a fix and a rewrite.
    console.log(`[auth] otp requested in ${Date.now() - t0}ms`, error ? { error } : '');
    if (error) { console.error('[auth] signInWithOtp failed', error); throw new Error(explain(error)); }
  }, []);

  const verifyCode = useCallback(async (email, token) => {
    if (!supabase) throw new Error('Supabase is not configured — see .env.example');
    const { data, error } = await withLimit(supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    }), 'Checking the code');
    if (error) { console.error('[auth] verifyOtp failed', error); throw new Error(explain(error)); }
    return data.session;
  }, []);

  /**
   * THE ONE PLACE WHERE CLEARING THE SESSION IS CORRECT — and it still must not
   * be able to hang. Everything above goes to some lengths not to sign anybody
   * out by accident; the mirror of that is that when somebody actually asks, it
   * has to happen whether or not the network agrees. So the call is bounded and
   * the local state is cleared either way: a "Log out" that leaves you looking
   * signed in is its own kind of broken, and on a shared machine it is worse
   * than that.
   */
  const signOut = useCallback(async () => {
    try { await withLimit(supabase?.auth.signOut() ?? Promise.resolve(), 'Signing out', 8000); }
    catch (err) { console.warn('[auth] signOut did not confirm — clearing locally', err); }
    finally { setSession(null); setProfile(null); setStalled(false); }
  }, []);

  const saveName = useCallback(async (fullName) => {
    if (!supabase || !session?.user) return;
    const { data } = await supabase.from('profiles')
      .update({ full_name: fullName }).eq('id', session.user.id).select().maybeSingle();
    if (data) setProfile(data);
  }, [session?.user?.id]);

  const value = useMemo(() => {
    const user = session?.user ?? null;
    const name = profile?.full_name || user?.user_metadata?.full_name || '';
    return {
      ready, session, user, profile, stalled, revalidate,
      configured: supabaseReady,
      // ROLE 1 IS AN OWNER OF THIS APP, not a user of it. It unlocks the audit
      // overlays — what the segmenter and the bed detector actually decided —
      // which are working, not product, and belong to whoever is tuning the
      // models.
      //
      // THIS IS A UI GATE AND NOTHING MORE. `role` arrives from the profiles row
      // through RLS, so a user can only ever read their own; but a determined
      // person can set this to true in a console, and the answer to that is that
      // it reveals nothing they do not already have — the overlays draw
      // detections that are already in this browser's memory. Anything that
      // must actually be restricted belongs in a policy, not here.
      role: profile?.role ?? null,
      isAdmin: (profile?.role ?? null) === 1,
      displayName: name || user?.email || '',
      // The bubble's letter. Falls back through name → email → a dash, because
      // an empty circle looks like a loading state that never finishes.
      initial: (name || user?.email || '—').trim().charAt(0).toUpperCase(),
      sendCode, verifyCode, signOut, saveName,
    };
  }, [ready, session, profile, stalled, revalidate, sendCode, verifyCode, signOut, saveName]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/**
 * THE MIDDLEWARE, such as it is in a single-page app. Three states, and the
 * third one is the whole reason this is a component rather than an `if`.
 */
export function RequireAuth({ children }) {
  const { ready, user, configured, stalled, revalidate } = useAuth();
  const loc = useLocation();

  if (!configured) return <SetupNotice />;
  if (!ready) return <Waiting />;
  // THE THIRD STATE. There is a session in storage and we could not confirm it —
  // so say that, and offer to try again. Sending this person to /login would be
  // a lie, and it is the lie that produced "I keep getting randomly logged out".
  if (!user && stalled) return <Reconnecting onRetry={revalidate} />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return children;
}

function Reconnecting({ onRetry }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
      <div className="w-[min(460px,92%)] bg-surface border border-border rounded-lg p-6 text-center">
        <h2 className="m-0 mb-2.5 text-[18px] tracking-[-0.025em]">Reconnecting…</h2>
        <p className="m-0 mb-3.5 text-[12.5px] text-muted leading-[1.6]">
          You are signed in, but we could not reach Supabase to confirm it. Your work
          is not lost — this is a connection problem, not a sign-out.
        </p>
        <div className="flex gap-1.5 flex-wrap justify-center mt-[22px]">
          <button className={BTN_BASE + ' ' + BTN_PRIMARY} onClick={onRetry}>Try again</button>
          <button className={BTN_BASE + ' ' + BTN_SECONDARY} onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </div>
  );
}

function Waiting() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
      <div className="w-[26px] h-[26px] rounded-full border-2 border-border border-t-accent [animation:sl-spin_0.8s_linear_infinite]" aria-label="Loading" />
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
      <div className="w-[min(460px,92%)] bg-surface border border-border rounded-lg p-6 text-center">
        <h2 className="m-0 mb-2.5 text-[18px] tracking-[-0.025em]">Supabase is not configured</h2>
        <p className="m-0 mb-3.5 text-[12.5px] text-muted leading-[1.6]">
          Add <code className="font-sans text-[11px] bg-surface-3 px-1 py-px rounded-[3px]">VITE_SUPABASE_URL</code> and <code className="font-sans text-[11px] bg-surface-3 px-1 py-px rounded-[3px]">VITE_SUPABASE_ANON_KEY</code> to
          <code className="font-sans text-[11px] bg-surface-3 px-1 py-px rounded-[3px]"> .env.local</code>, then restart the dev server. See
          <code className="font-sans text-[11px] bg-surface-3 px-1 py-px rounded-[3px]"> .env.example</code> for the full list and why the VITE_ prefix
          matters here but nowhere else in this repo.
        </p>
      </div>
    </div>
  );
}
