import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Wordmark from '../components/Wordmark.jsx';
import PlanPicker from '../components/PlanPicker.jsx';
import CheckoutDialog from '../components/CheckoutDialog.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useBilling } from '../lib/billing.jsx';
import { TIER, fmtSqft } from '../lib/plans.js';

// ---------------------------------------------------------------------------
// THE PRICING PAGE, AND IT IS A PUBLIC ONE.
//
// NOT BEHIND RequireAuth, deliberately. A price a visitor cannot read without
// making an account is a price they will assume is bad, and this page is also the
// thing somebody forwards to whoever signs the cheque — a partner, a purchase
// department — who has no login and no reason to make one. So it renders cold,
// with the same three cards the paywall shows, and the only difference when
// somebody IS signed in is a strip saying where they stand.
//
// THE METER IS EXPLAINED ON THE PAGE, at length, low down. Square feet are an
// unusual thing to be billed in and the questions are predictable and identical:
// what counts, does fixing a wall cost me twice, what happens when I run out
// mid-drawing. Answering them here is cheaper than answering them one email at a
// time, and a metered plan whose rules are not written down is one nobody
// upgrades to.
//
// SIGN-IN IS DEFERRED UNTIL THE MOMENT OF PAYING, the same way the upload defers
// it: choosing a plan while signed out remembers the choice, sends you to /login,
// and reopens the checkout on the way back. The tier travels in the route's
// state — not in localStorage, which would still be there next week and would
// reopen a payment dialog nobody asked for.
// ---------------------------------------------------------------------------

export default function Pricing() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, ready: authReady } = useAuth();
  const { state, checkout, cancel, refresh } = useBilling();

  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // Coming back from /login with a tier in hand: pick up where we left off.
  useEffect(() => {
    const want = loc.state?.tier;
    if (want && user && TIER[want]) {
      setPicked(want);
      nav('.', { replace: true, state: null });
    }
  }, [loc.state, user, nav]);

  const choose = (slug) => {
    setErr(''); setMsg('');
    if (!user) {
      nav('/login', { state: { from: '/pricing', tier: slug } });
      return;
    }
    setPicked(slug);
  };

  const pay = async (details) => {
    setBusy(true); setErr('');
    try {
      const out = await checkout({ tier: picked, details });
      if (out.ok) {
        setPicked(null);
        setMsg(`You are on ${TIER[picked]?.name}. ${fmtSqft(out.state.area.left)} available.`);
      } else setPicked(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  };

  const endsOn = state.periodEnd
    ? new Date(state.periodEnd).toLocaleDateString(undefined,
        { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="home pricing">
      <header className="home-top">
        <Wordmark />
        <div className="spacer" />
        <button className="btn" onClick={() => nav('/')}>Upload a plan</button>
        {authReady && (user
          ? <button className="btn" onClick={() => nav('/dashboard')}>Your projects</button>
          : <button className="btn" onClick={() => nav('/login')}>Sign in</button>)}
      </header>

      <main className="pricing-main">
        <div className="shell-inner">
          <header className="page-head pricing-head">
            <div>
              <h1>Pay for the area you light</h1>
            </div>
          </header>

          {/* WHERE YOU STAND, and only for somebody who is signed in. A usage
              strip on a cold visit would be three zeroes and a bar at 0%, which
              is chrome pretending to be information. */}
          {user && (
            <section className="usage-strip">
              <div className="usage-num">
                <b>{fmtSqft(state.area.left)}</b>
                <span>left of {fmtSqft(state.area.allowed)}</span>
              </div>
              <div className="usage-bar">
                <i style={{ width: `${Math.min(100,
                  (state.area.used / Math.max(1, state.area.allowed)) * 100)}%` }} />
              </div>
              <div className="usage-side">
                <span>
                  <b>{TIER[state.tier]?.name ?? 'Free'}</b>
                  {state.lifetime
                    ? ' · the free allowance does not refresh'
                    : endsOn ? ` · renews ${endsOn}` : ''}
                </span>
                {state.passes.allowed > 0 && (
                  <span>{state.passes.left} of {state.passes.allowed} render passes left</span>
                )}
                {state.cancelAtPeriodEnd && (
                  <span className="warnish">Cancelled — runs until {endsOn}</span>
                )}
              </div>
            </section>
          )}

          {msg && <p className="note ok-note">{msg}</p>}
          {err && <p className="note err">{err}</p>}

          <PlanPicker current={user ? state.tier : 'free'} busyTier={busy ? picked : null}
            onChoose={choose} />

          {/* --- HOW THE METER WORKS ---------------------------------------- */}
          <section className="page-sec pricing-faq">
            <h3>How the meter works</h3>

            <div className="faq-grid">
              <div>
                <h4>What is measured</h4>
                <p>
                  The built area of the spaces you light — the sum of the outlines,
                  not the size of the sheet. A title block, a margin and a site plan
                  parked off to one side cost you nothing, which is why the same
                  building drawn on A1 and on A0 meters identically.
                </p>
              </div>
              <div>
                <h4>When it is charged</h4>
                <p>
                  When a space is lit, once, at the area it had at that moment. The
                  outlines, the room detection, the scale, the BOQ and every export
                  format are not metered separately — they come with the layout.
                </p>
              </div>
              <div>
                <h4>Fixing a wall does not cost twice</h4>
                <p>
                  Charging is per space, not per drawing. If the detector gets nine
                  rooms right and one wrong, you drag the corners on that one and
                  re-light: the nine are already paid for and only the room whose
                  geometry actually changed is charged again. Re-lighting a plan you
                  have not touched is free, this month or next year.
                </p>
              </div>
              <div>
                <h4>Render passes are counted, not measured</h4>
                <p>
                  A render pass reads the interior views you already have and marks
                  the panelling, the art and the shelving back onto the plan. It
                  costs the same whether the wall is nine feet or ninety, so it is
                  counted per run. A pass that fails is given back.
                </p>
              </div>
              <div>
                <h4>Running out mid-drawing</h4>
                <p>
                  Nothing is lost. The layout is refused before it runs, the outlines
                  stay exactly as you drew them, and the plan is waiting where you
                  left it once the allowance is there. There is no partial layout —
                  half a lit ceiling is worse than a clear refusal.
                </p>
              </div>
              <div>
                <h4>The free allowance is once</h4>
                <p>
                  3,000 sq ft, not refreshed monthly. It is enough to take one real
                  flat all the way through — detection, layout, schedule, DXF — so
                  the decision to pay is made against a finished drawing rather than
                  a feature list.
                </p>
              </div>
            </div>
          </section>

          {user && state.tier !== 'free' && !state.cancelAtPeriodEnd && (
            <section className="page-sec">
              <p className="note">
                <button className="linkish danger" onClick={async () => {
                  if (!confirm('Cancel at the end of this month?\n\n'
                    + 'You keep everything until ' + (endsOn || 'the period ends')
                    + ', and nothing you have drawn is affected.')) return;
                  try { await cancel(); await refresh(); setMsg('Cancelled. Your plan runs to the end of the period.'); }
                  catch (e) { setErr(String(e.message || e)); }
                }}>Cancel subscription</button>
                {' '}— the month you have paid for runs to its end.
              </p>
            </section>
          )}
        </div>
      </main>

      {picked && (
        <CheckoutDialog
          tier={TIER[picked]}
          defaults={{ email: user?.email || '' }}
          busy={busy}
          error={err}
          onCancel={() => { if (!busy) { setPicked(null); setErr(''); } }}
          onPay={pay} />
      )}
    </div>
  );
}
