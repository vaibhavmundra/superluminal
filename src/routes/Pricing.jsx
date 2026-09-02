import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Wordmark from '../components/Wordmark.jsx';
import PlanPicker from '../components/PlanPicker.jsx';
import CheckoutDialog from '../components/CheckoutDialog.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useBilling } from '../lib/billing.jsx';
import { TIER, fmtSqft } from '../lib/plans.js';

// The old bare `.btn` class, as Tailwind utilities — same split as
// PlanPicker.jsx / RenderPassPanel.jsx.
const BTN_BASE = 'text-[12px] px-3 py-[7px] rounded border cursor-pointer transition-colors duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_DEFAULT = 'border-border bg-surface text-ink hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 disabled:hover:bg-surface disabled:hover:border-border';

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
//
// A SUBSCRIPTION BELONGS TO AN ACCOUNT, so there has to be an account before
// there is a subscription. That is one screen of friction in front of the card,
// and it is bought back by everything downstream having exactly one owner to
// reason about: no purchase in limbo, no claim-by-email, no window in which money
// has moved and nobody holds what it bought.
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

  // Same figure feeds the bar's width and its colour — see the CSS this
  // replaces (`.usage-bar i[style*="width: 100%"]`), which turned the fill red
  // once the meter reads full.
  const usagePct = Math.min(100, (state.area.used / Math.max(1, state.area.allowed)) * 100);

  return (
    <div className="min-h-full flex flex-col">
      <header className="h-14 flex-none flex items-center gap-3.5 max-[640px]:gap-2 px-[22px] max-[640px]:px-3.5 border-b border-border bg-[rgba(255,255,255,0.72)] backdrop-blur-[12px] backdrop-saturate-[180%]">
        <Wordmark />
        <div className="flex-1" />
        <button className={BTN_BASE + ' ' + BTN_DEFAULT} onClick={() => nav('/')}>Upload a plan</button>
        {authReady && (user
          ? <button className={BTN_BASE + ' ' + BTN_DEFAULT} onClick={() => nav('/dashboard')}>Your projects</button>
          : <button className={BTN_BASE + ' ' + BTN_DEFAULT} onClick={() => nav('/login')}>Sign in</button>)}
      </header>

      <main className="flex-1 overflow-y-auto pt-5 px-[30px] pb-[70px] max-[760px]:pt-4 max-[760px]:px-[18px] max-[760px]:pb-[60px]">
        <div className="w-full max-w-[1180px] mx-auto">
          <header className="flex items-end justify-between gap-5 mt-1.5 mb-[30px] max-w-[66ch]">
            <div>
              <h1 className="m-0 text-[26px] tracking-[-0.03em]">Pay for the area you light</h1>
            </div>
          </header>

          {/* WHERE YOU STAND, and only for somebody who is signed in. A usage
              strip on a cold visit would be three zeroes and a bar at 0%, which
              is chrome pretending to be information. */}
          {user && (
            <section className="grid grid-cols-[auto_1fr_auto] max-[760px]:grid-cols-1 gap-[18px] max-[760px]:gap-3 items-center bg-surface border border-border rounded-lg px-[18px] py-4 mb-[26px]">
              <div>
                <b className="block text-[20px] tracking-[-0.03em] tabular-nums">{fmtSqft(state.area.left)}</b>
                <span className="text-[11px] text-subtle">{state.unlimited ? 'no limit' : `left of ${fmtSqft(state.area.allowed)}`}</span>
              </div>
              {/* AN UNLIMITED METER HAS NO BAR. A full-width blue bar would read
                  as "you have used everything" and an empty one as "you have used
                  nothing"; there is no honest position for a needle on a dial with
                  no end, so the dial goes. */}
              <div className={
                'rounded-full overflow-hidden '
                + (state.unlimited ? 'bg-border h-px self-center max-[760px]:self-stretch' : 'h-1.5 bg-surface-3')
              }>
                {!state.unlimited && (
                  <i className={
                    'block h-full rounded-full transition-[width] duration-300 '
                    + (usagePct >= 100 ? 'bg-danger' : 'bg-accent')
                  } style={{ width: `${usagePct}%` }} />
                )}
              </div>
              <div className="flex flex-col gap-[3px] text-right max-[760px]:text-left">
                <span className="text-[11.5px] text-muted">
                  <b className="text-ink">{TIER[state.tier]?.name ?? 'Free'}</b>
                  {state.unlimited ? ' · unmetered'
                    : state.lifetime ? ' · the free allowance does not refresh'
                    : endsOn ? ` · renews ${endsOn}` : ''}
                </span>
                {state.unlimited
                  ? <span className="text-[11.5px] text-muted">{Math.round(state.area.used).toLocaleString('en-IN')} sq ft
                      {' '}and {state.passes.used} render pass
                      {state.passes.used === 1 ? '' : 'es'} used</span>
                  : state.passes.allowed > 0 && (
                    <span className="text-[11.5px] text-muted">{state.passes.left} of {state.passes.allowed} render passes left</span>
                  )}
                {state.cancelAtPeriodEnd && (
                  <span className="text-[11.5px] text-danger-ink">Cancelled — runs until {endsOn}</span>
                )}
              </div>
            </section>
          )}

          {msg && <p className="text-[11.5px] leading-normal mt-2 bg-ok-soft border border-ok-line rounded text-ok py-[9px] px-[11px]">{msg}</p>}
          {err && <p className="text-[11.5px] leading-normal mt-2 text-danger-ink border-l-2 border-danger pl-[9px]">{err}</p>}

          <PlanPicker current={user ? state.tier : 'free'} busyTier={busy ? picked : null}
            unlimited={state.unlimited} onChoose={choose} />

          {/* --- HOW THE METER WORKS ---------------------------------------- */}
          <section className="mb-[34px]">
            <h3 className="mb-[18px]">How the meter works</h3>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[22px_30px]">
              <div>
                <h4 className="m-0 mb-1.5 text-[12.5px] tracking-[-0.01em]">What is measured</h4>
                <p className="m-0 text-xs leading-[1.65] text-muted">
                  The built area of the spaces you light — the sum of the outlines,
                  not the size of the sheet. A title block, a margin and a site plan
                  parked off to one side cost you nothing, which is why the same
                  building drawn on A1 and on A0 meters identically.
                </p>
              </div>
              <div>
                <h4 className="m-0 mb-1.5 text-[12.5px] tracking-[-0.01em]">When it is charged</h4>
                <p className="m-0 text-xs leading-[1.65] text-muted">
                  When a space is lit, once, at the area it had at that moment. The
                  outlines, the room detection, the scale, the BOQ and every export
                  format are not metered separately — they come with the layout.
                </p>
              </div>
              <div>
                <h4 className="m-0 mb-1.5 text-[12.5px] tracking-[-0.01em]">Fixing a wall does not cost twice</h4>
                <p className="m-0 text-xs leading-[1.65] text-muted">
                  Charging is per space, not per drawing. If the detector gets nine
                  rooms right and one wrong, you drag the corners on that one and
                  re-light: the nine are already paid for and only the room whose
                  geometry actually changed is charged again. Re-lighting a plan you
                  have not touched is free, this month or next year.
                </p>
              </div>
              <div>
                <h4 className="m-0 mb-1.5 text-[12.5px] tracking-[-0.01em]">Render passes are counted, not measured</h4>
                <p className="m-0 text-xs leading-[1.65] text-muted">
                  A render pass reads the interior views you already have and marks
                  the panelling, the art and the shelving back onto the plan. It
                  costs the same whether the wall is nine feet or ninety, so it is
                  counted per run. A pass that fails is given back.
                </p>
              </div>
              <div>
                <h4 className="m-0 mb-1.5 text-[12.5px] tracking-[-0.01em]">Running out mid-drawing</h4>
                <p className="m-0 text-xs leading-[1.65] text-muted">
                  Nothing is lost. The layout is refused before it runs, the outlines
                  stay exactly as you drew them, and the plan is waiting where you
                  left it once the allowance is there. There is no partial layout —
                  half a lit ceiling is worse than a clear refusal.
                </p>
              </div>
              <div>
                <h4 className="m-0 mb-1.5 text-[12.5px] tracking-[-0.01em]">The free allowance is once</h4>
                <p className="m-0 text-xs leading-[1.65] text-muted">
                  3,000 sq ft, not refreshed monthly. It is enough to take one real
                  flat all the way through — detection, layout, schedule, DXF — so
                  the decision to pay is made against a finished drawing rather than
                  a feature list.
                </p>
              </div>
            </div>
          </section>

          {user && state.tier !== 'free' && !state.unlimited && !state.cancelAtPeriodEnd && (
            <section className="mb-[34px]">
              <p className="text-[11.5px] text-muted leading-normal mt-2">
                <button className="border-0 bg-transparent text-[11.5px] text-danger-ink p-0 no-underline cursor-pointer hover:underline" onClick={async () => {
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
          defaults={{ email: user?.email || '', signedIn: !!user }}
          busy={busy}
          error={err}
          onCancel={() => { if (!busy) { setPicked(null); setErr(''); } }}
          onPay={pay} />
      )}
    </div>
  );
}
