import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Wordmark from '../components/Wordmark.jsx';
import PlanPicker from '../components/PlanPicker.jsx';
import CheckoutDialog from '../components/CheckoutDialog.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useBilling } from '../lib/billing.jsx';
import { TIER } from '../lib/plans.js';

const BTN_BASE = 'text-[12px] px-3 py-[7px] rounded border cursor-pointer transition-colors duration-[120ms] disabled:opacity-100 disabled:cursor-not-allowed';
const BTN_DEFAULT = 'border-border/10 bg-surface backdrop-blur-[5px] text-white hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3 disabled:hover:bg-surface disabled:hover:border-border/10';

const FAQS = [
  ['What does Super Luminal help me do?',
    'It turns a floor plan into an accurate representation of how the lighting will work in each room, including fixture placement, beam behaviour, lighting analysis and the resulting bill of quantities.'],
  ['What is included for free?',
    'Your first three floor plans are free. Each one gets the full planning experience, lighting analysis, BOQ and exports—there is no reduced free version.'],
  ['What happens after three plans?',
    'Studio gives you unlimited access to the app for one monthly price. There is no square-footage allowance, render-pass allowance or per-export charge.'],
  ['Can I keep editing my free plans?',
    'Yes. The three plans you have already used remain yours to edit, re-light and export. Studio is required when you want to light another plan after those three.'],
  ['What does priority support mean?',
    'Studio questions and product issues move to the front of our support queue, so active project work gets a faster response.'],
  ['Can I cancel?',
    'Yes. Cancel at any time and Studio remains available until the end of the month you have already paid for.'],
];

export default function Pricing() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, profile, ready: authReady } = useAuth();
  const { state, checkout, cancel, refresh } = useBilling();
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

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
        setMsg('Studio is active. You now have unlimited access to Super Luminal.');
      } else setPicked(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  };

  const endsOn = state.periodEnd
    ? new Date(state.periodEnd).toLocaleDateString(undefined,
        { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const planUsed = Math.min(state.plans?.used ?? 0, state.plans?.allowed ?? 3);

  return (
    <div className="min-h-full flex flex-col">
      <header className="h-14 flex-none flex items-center gap-3.5 max-[640px]:gap-2 px-[22px] max-[640px]:px-3.5 border-b border-border/10 bg-[var(--bg)]">
        <Wordmark />
        <div className="flex-1" />
        <button className={BTN_BASE + ' ' + BTN_DEFAULT} onClick={() => nav('/')}>Upload a plan</button>
        {authReady && (user
          ? <button className={BTN_BASE + ' ' + BTN_DEFAULT} onClick={() => nav('/dashboard')}>Your projects</button>
          : <button className={BTN_BASE + ' ' + BTN_DEFAULT} onClick={() => nav('/login')}>Sign in</button>)}
      </header>

      <main className="flex-1 overflow-y-auto pt-5 px-[30px] pb-[70px] max-[760px]:pt-4 max-[760px]:px-[18px] max-[760px]:pb-[60px]">
        <div className="w-full max-w-[980px] mx-auto">
          <header className="mt-1.5 mb-[30px] max-w-[680px]">
            <h1 className="m-0 text-[28px] tracking-[-0.035em]">See the light before you build it</h1>
            <p className="mt-2 mb-0 text-[13px] leading-[1.65] text-muted">
              Super Luminal is focused on one thing: giving you an accurate representation
              of the lighting in your room. Light three plans free, then choose Studio for unlimited access.
            </p>
          </header>

          {user && (
            <section className="flex items-center justify-between gap-5 max-[640px]:items-start max-[640px]:flex-col bg-surface backdrop-blur-[5px] border border-border/10 rounded-lg px-[18px] py-4 mb-[26px]">
              <div>
                <b className="block text-[18px] tracking-[-0.02em]">
                  {state.unlimited ? 'Unlimited access' : `${planUsed} of 3 free plans used`}
                </b>
                <span className="text-[11px] text-subtle">
                  {state.unlimited
                    ? `Studio${endsOn ? ` · renews ${endsOn}` : ''}`
                    : 'No area, render or export limits on those plans'}
                </span>
              </div>
              {state.cancelAtPeriodEnd && (
                <span className="text-[11.5px] text-danger">Cancelled — available until {endsOn}</span>
              )}
            </section>
          )}

          {msg && <p className="text-[11.5px] leading-normal mt-2 bg-ok/10 backdrop-blur-[5px] border border-ok/20 rounded text-ok py-[9px] px-[11px]">{msg}</p>}
          {err && <p className="text-[11.5px] leading-normal mt-2 text-danger border-l-2 border-danger pl-[9px]">{err}</p>}

          <PlanPicker current={user ? state.tier : null} busyTier={busy ? picked : null}
            unlimited={state.unlimited} pricing={state.pricing} onChoose={choose} />

          <section className="mb-[34px] bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8] border border-border/10 rounded-lg px-[22px] pt-[18px] pb-[22px]">
            <h3 className="m-0 mb-[18px] text-[10px] tracking-[0.11em] uppercase text-subtle">Frequently asked questions</h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[22px_30px]">
              {FAQS.map(([question, answer]) => (
                <div key={question}>
                  <h4 className="m-0 mb-1.5 text-[12.5px] tracking-[-0.01em] text-white">{question}</h4>
                  <p className="m-0 text-xs leading-[1.65] text-muted">{answer}</p>
                </div>
              ))}
            </div>
          </section>

          {user && state.tier === 'studio' && !state.cancelAtPeriodEnd && (
            <section className="mb-[34px]">
              <p className="text-[11.5px] text-muted leading-normal mt-2">
                <button className="border-0 bg-transparent text-[11.5px] text-danger p-0 no-underline cursor-pointer hover:underline" onClick={async () => {
                  if (!confirm('Cancel at the end of this month?\n\n'
                    + 'You keep Studio until ' + (endsOn || 'the period ends') + '.')) return;
                  try { await cancel(); await refresh(); setMsg('Cancelled. Studio remains available until the end of the paid period.'); }
                  catch (e) { setErr(String(e.message || e)); }
                }}>Cancel subscription</button>
                {' '}— the month you have paid for runs to its end.
              </p>
            </section>
          )}
        </div>
      </main>

      {picked && (
        <CheckoutDialog tier={TIER[picked]} pricing={state.pricing}
          /* THE PROFILE ROW FIRST, as in Paywall.jsx — a phone account has no
             `user.email`, and the address the export gate collected is the one
             the receipt goes to anyway. */
          defaults={{ email: profile?.email || user?.email || '', signedIn: !!user }} busy={busy} error={err}
          onCancel={() => { if (!busy) { setPicked(null); setErr(''); } }} onPay={pay} />
      )}
    </div>
  );
}
