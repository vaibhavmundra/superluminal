import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PlanPicker from './PlanPicker.jsx';
import CheckoutDialog from './CheckoutDialog.jsx';
import { useBilling } from '../lib/billing.jsx';
import { useAuth } from '../lib/auth.jsx';
import { TIER } from '../lib/plans.js';

export default function Paywall({ onClose }) {
  const { checkout, state } = useBilling();
  const { user } = useAuth();
  const nav = useNavigate();
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const pay = async (details) => {
    setBusy(true); setErr('');
    try {
      const out = await checkout({ tier: picked, details });
      if (out.ok) { setDone(true); setPicked(null); }
      else setPicked(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  };

  if (picked) {
    return (
      <CheckoutDialog tier={TIER[picked]} pricing={state.pricing}
        defaults={{ email: user?.email || '', signedIn: !!user }}
        busy={busy} error={err}
        onCancel={() => { if (!busy) { setPicked(null); setErr(''); } }}
        onPay={pay} />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(0,0,0,.34)] backdrop-blur-[3px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-[min(760px,94vw)] bg-surface border border-border rounded-[14px] px-[22px] pt-[22px] pb-5 shadow-[0_18px_50px_rgba(20,20,40,.18)]">
        {done ? (
          <>
            <h2 className="mt-0 mb-[6px] text-[17px] tracking-[-0.01em]">Studio is active</h2>
            <p className="text-[11.5px] text-muted leading-[1.5] mt-0 mb-5">
              You now have unlimited access. Close this and light the plan—nothing has been lost.
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button className="text-[12px] py-[7px] px-3 rounded bg-cta text-white border border-cta cursor-pointer transition-colors duration-[120ms] hover:bg-cta-hover hover:border-cta-hover" onClick={onClose}>Back to the drawing</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mt-0 mb-[6px] text-[17px] tracking-[-0.01em]">You have used your three free plans</h2>
            <p className="text-[11.5px] text-muted leading-[1.5] mt-0 mb-1">
              Everything you have already lit stays yours to edit, re-light and export.
              The outlines on this drawing are safe. Choose Studio to light unlimited plans.
            </p>

            <PlanPicker current={state.tier} busyTier={busy ? picked : null}
              compact pricing={state.pricing}
              onChoose={(slug) => { setErr(''); setPicked(slug); }} />

            {err && <p className="text-[11.5px] leading-[1.5] mt-2 text-danger-ink border-l-2 border-danger pl-[9px]">{err}</p>}

            <div className="flex justify-between gap-2 mt-6">
              <button className="text-[12px] py-[7px] px-3 rounded bg-surface text-ink border border-border-strong cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-ink active:bg-surface-3" onClick={() => nav('/pricing')}>
                See pricing and FAQs
              </button>
              <button className="text-[12px] py-[7px] px-3 rounded border border-border bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3" onClick={onClose}>Not now</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
