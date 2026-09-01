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
        defaults={{ email: user?.email || '' }}
        busy={busy}
        error={err}
        onCancel={() => { if (!busy) { setPicked(null); setErr(''); } }}
        onPay={pay} />
    );
  }

  return (
    <div className="modal-wrap"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal paywall">
        {done ? (
          <>
            <h2>You are on {TIER[state.tier]?.name ?? 'the new plan'}</h2>
            <p className="note" style={{ margin: '0 0 20px' }}>
              {fmtSqft(state.area.left)} available. Close this and light the plan —
              nothing has been lost.
            </p>
            <div className="modal-foot">
              <button className="btn primary" onClick={onClose}>Back to the drawing</button>
            </div>
          </>
        ) : (
          <>
            <h2>{isArea ? 'This plan is larger than what is left' : 'No render passes left'}</h2>
            <p className="note" style={{ margin: '0 0 4px' }}>
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

            {err && <p className="note err">{err}</p>}

            <div className="modal-foot spread">
              <button className="btn secondary" onClick={() => nav('/pricing')}>
                See the full comparison
              </button>
              <button className="btn" onClick={onClose}>Not now</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
