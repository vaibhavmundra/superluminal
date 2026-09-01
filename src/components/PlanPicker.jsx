import React from 'react';
import { TIERS, fmtSqft } from '../lib/plans.js';

// ---------------------------------------------------------------------------
// THE THREE CARDS, in one component because they appear on two screens and a
// second copy would drift within a week.
//
//   /pricing        the whole page, cold, possibly to somebody not signed in
//   the paywall     the same three cards, inside a modal, mid-drawing
//
// WHAT MAKES THEM ONE COMPONENT RATHER THAN TWO SIMILAR ONES: the numbers. The
// area, the render passes and the price are not written here — they come from
// TIERS in src/lib/plans.js, which is also what api/billing.js refuses a layout
// against. A hand-typed "10,000 sq ft" on a pricing page is a promise nothing
// checks, and it is the promise a user quotes back when the server says no.
//
// PRO IS MARKED AND FREE IS NOT DIMMED. A greyed-out free column reads as a
// column that has been taken away, and free is a real tier here — 3,000 square
// feet is a whole flat, exported, with the schedule. It is a floor, not bait.
// ---------------------------------------------------------------------------

export default function PlanPicker({ current = 'free', busyTier = null, compact = false,
                                     onChoose, need = null }) {
  return (
    <div className={'plan-grid' + (compact ? ' compact' : '')}>
      {TIERS.map((t) => {
        const isCurrent = t.slug === current;
        // THE TIER THAT ACTUALLY SOLVES THE PROBLEM IN FRONT OF THEM. When the
        // paywall opens because a 12,000 sq ft floor would not fit, the useful
        // recommendation is Pro and not "the popular one" — so the highlight is
        // computed from the shortfall rather than fixed in the markup.
        const covers = need == null || t.area >= need;
        const featured = need != null ? (covers && t.usd > 0
            && !TIERS.some((o) => o.usd > 0 && o.area >= need && o.usd < t.usd))
          : t.slug === 'pro';

        return (
          <article key={t.slug}
            className={'plan-card' + (featured ? ' featured' : '') + (isCurrent ? ' current' : '')}>
            {featured && <span className="plan-flag">{need != null ? 'Fits this plan' : 'Most chosen'}</span>}
            {isCurrent && <span className="plan-flag now">Your plan</span>}

            <h3>{t.name}</h3>
            <div className="plan-price">
              {t.usd === 0 ? <b>Free</b> : <><b>${t.usd}</b><span>/month</span></>}
            </div>
            <p className="plan-blurb">{t.blurb}</p>

            <div className="plan-meter">
              <b>{fmtSqft(t.area)}</b>
              <span>{t.lifetime ? 'does not renew' : 'every month'}</span>
            </div>

            <ul className="plan-lines">
              {t.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>

            {t.usd === 0 ? (
              <button className="btn" disabled>
                {isCurrent ? 'Included' : 'Included'}
              </button>
            ) : (
              <button className={'btn' + (featured ? ' primary' : '')}
                disabled={isCurrent || busyTier === t.slug}
                onClick={() => onChoose?.(t.slug)}>
                {isCurrent ? 'Current plan'
                  : busyTier === t.slug ? 'Opening…'
                  : need != null && !covers ? `Not enough for this plan`
                  : `Choose ${t.name}`}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
