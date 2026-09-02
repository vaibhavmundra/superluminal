import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PlanPicker from './PlanPicker.jsx';
import CheckoutDialog from './CheckoutDialog.jsx';
import { useBilling } from '../lib/billing.jsx';
import { useAuth } from '../lib/auth.jsx';
import { TIER, fmtSqft } from '../lib/plans.js';

// ---------------------------------------------------------------------------
// THE WALL, AND WHERE IT IS ALLOWED TO STAND.
//
// This opens over the editor, at the moment a layout or a render pass was
// refused, and it has one job: say what was short, by how much, and offer the
// tier that fixes it — WITHOUT LOSING THE DRAWING. That last clause is the
// design constraint. The user has traced ten rooms; sending them to /pricing
// means a route change, an unmount, and a reload back into whatever the autosave
// managed to write. So the checkout happens inside this modal and closing it puts
// them back exactly where they were, with everything still on screen.
//
// IT NEVER APPEARS BEFORE THE WORK. The refusal comes from the server, after the
// claim, which means the user has already outlined the plan and seen the area
// they are asking for — and that is the only moment a price is a fair question.
// A wall in front of the upload would be asking for money before showing
// anything, which is the mistake the sign-in flow was carefully built to avoid.
// ---------------------------------------------------------------------------

export default function Paywall({ refusal, onClose }) {
  const { checkout, state } = useBilling();
  const { user } = useAuth();
  const nav = useNavigate();
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const isArea = refusal?.reason !== 'passes';
  // THE SHORTFALL AS THE PLAN NEEDS IT, not as the tier lists it. "You need
  // 1,600 more" is actionable; "you have used 2,400 of 3,000" is a statement
  // about the past.
  const need = isArea ? Math.ceil(refusal?.want ?? 0) : null;

  const pay = async (details) => {
    setBusy(true); setErr('');
    try {
      const out = await checkout({ tier: picked, details });
      if (out.ok) { setDone(true); setPicked(null); }
      else setPicked(null);              // dismissed the payment window
    } catch (e) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  };

  if (picked) {
    return (
      <CheckoutDialog
        tier={TIER[picked]}
        defaults={{ email: user?.email || '', signedIn: !!user }}
        busy={busy}
        error={err}
        onCancel={() => { if (!busy) { setPicked(null); setErr(''); } }}
        onPay={pay} />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-[min(760px,94vw)] bg-surface border border-border rounded-[14px] px-[22px] pt-[22px] pb-5 shadow-[0_18px_50px_rgba(20,20,40,.18)]">
        {done ? (
          <>
            <h2 className="mt-0 mb-[6px] text-[17px] tracking-[-0.01em]">You are on {TIER[state.tier]?.name ?? 'the new plan'}</h2>
            <p className="text-[11.5px] text-muted leading-[1.5] mt-0 mb-5">
              {fmtSqft(state.area.left)} available. Close this and light the plan —
              nothing has been lost.
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button className="text-[12px] py-[7px] px-3 rounded bg-cta text-white border border-cta cursor-pointer transition-colors duration-[120ms] hover:bg-cta-hover hover:border-cta-hover" onClick={onClose}>Back to the drawing</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mt-0 mb-[6px] text-[17px] tracking-[-0.01em]">{isArea ? 'This plan is larger than what is left' : 'No render passes left'}</h2>
            <p className="text-[11.5px] text-muted leading-[1.5] mt-0 mb-1">
              {isArea ? (
                <>
                  Lighting these spaces needs <b>{fmtSqft(refusal?.want ?? 0)}</b> and
                  you have <b>{fmtSqft(refusal?.left ?? 0)}</b> left
                  {state.lifetime ? ' on the free tier' : ' this month'}.
                  {' '}The outlines are safe — nothing has been discarded.
                </>
              ) : (
                <>
                  A render pass reads your interior views and marks what is on the
                  walls back onto the plan. {state.lifetime
                    ? 'The free tier does not include any.'
                    : `You have used all ${state.passes.allowed} this month.`}
                </>
              )}
            </p>

            <PlanPicker
              current={state.tier}
              busyTier={busy ? picked : null}
              compact
              need={need}
              onChoose={(slug) => { setErr(''); setPicked(slug); }} />

            {err && <p className="text-[11.5px] leading-[1.5] mt-2 text-danger-ink border-l-2 border-danger pl-[9px]">{err}</p>}

            <div className="flex justify-between gap-2 mt-6">
              <button className="text-[12px] py-[7px] px-3 rounded bg-surface text-ink border border-border-strong cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-ink active:bg-surface-3" onClick={() => nav('/pricing')}>
                See the full comparison
              </button>
              <button className="text-[12px] py-[7px] px-3 rounded border border-border bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3" onClick={onClose}>Not now</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
