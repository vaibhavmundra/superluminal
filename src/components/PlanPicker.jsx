import React from 'react';
import { TIERS, tierHeadline } from '../lib/plans.js';

// The old `.btn` / `.btn.primary` classes, as Tailwind utilities. Split into
// two mutually-exclusive strings (rather than one merged string with both
// hover variants present) so Tailwind's generated CSS order can't decide
// which hover colour wins when both would otherwise apply.
const BTN_BASE = 'text-[12px] px-3 py-[7px] rounded border cursor-pointer transition-colors duration-[120ms] w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_DEFAULT = 'border-border/10 bg-surface backdrop-blur-[5px] text-white hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3 disabled:hover:bg-surface disabled:hover:border-border/10';
// THE FEATURED TIER'S BUTTON GLOWS, and it is the only paid act in the app that
// does. It was a flat gold fill, which put the ramp in three places on one card
// — the card's own `gradient-ring`, the "Most chosen" badge, and the button —
// so the eye had no way to tell which of them was the thing to press. The
// travelling stroke of `lp-glow-btn` (styles.css) reads as the button rather
// than as the card's decoration, and it is the same gesture the app uses at
// every other moment of commitment: upload a plan, light the spaces.
//
// `border-transparent` because BTN_BASE declares `border` for the width the
// other colourways need; left to `currentColor` that is a solid white 1px frame
// sitting on top of the gradient one. The ground, type and halo come from the
// shared class, so nothing here sets a colour.
const BTN_PRIMARY = 'lp-glow-btn border-transparent';

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
// column that has been taken away, and free is a real tier here — three floor
// plans, lit and exported, with the schedule. It is a floor, not bait.
//
// THE HEADLINE NUMBER IS NOT ALWAYS THE SAME KIND OF NUMBER. Free is sold on a
// count of DRAWINGS and the paid tiers on AREA (see TIERS in plans.js), so the
// figure in the box comes from `tierHeadline` rather than from `fmtSqft`. That
// fork is made once, in plans.js, because this card, the checkout summary, the
// paywall and the profile menu all print it and four independent guesses is how
// a visitor reads "15,000 sq ft" here and is refused at three plans.
// ---------------------------------------------------------------------------

export default function PlanPicker({ current = 'free', busyTier = null, compact = false,
                                     onChoose, need = null, unlimited = false }) {
  return (
    <div className={
      'grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] items-start max-[760px]:grid-cols-1 '
      + (compact ? 'gap-2.5 mt-[18px] mb-1.5' : 'gap-3.5 mb-[38px]')
    }>
      {TIERS.map((t) => {
        const isCurrent = !unlimited && t.slug === current;
        // THE TIER THAT ACTUALLY SOLVES THE PROBLEM IN FRONT OF THEM. When the
        // paywall opens because a 12,000 sq ft floor would not fit, the useful
        // recommendation is Pro and not "the popular one" — so the highlight is
        // computed from the shortfall rather than fixed in the markup.
        // A TIER THAT IS METERED ON DRAWINGS CANNOT COVER A SHORTFALL OF SQUARE
        // FEET, and free is now such a tier. Its 15,000 sq ft is a backstop and
        // not an offer, so comparing `need` against it would mark free as
        // "Fits this plan" for a 12,000 sq ft floor — an answer that is wrong
        // twice over, since the person reading it is already on free and is
        // being refused by the plan count as often as by the area.
        const covers = need == null || (t.usd > 0 && t.area >= need);
        const featured = need != null ? (covers && t.usd > 0
            && !TIERS.some((o) => o.usd > 0 && o.area >= need && o.usd < t.usd))
          : t.slug === 'pro';

        return (
          <article key={t.slug}
            className={
              'relative flex flex-col bg-surface backdrop-blur-[5px] rounded-lg border '
              + (compact ? 'pt-[15px] px-[14px] pb-[14px] ' : 'pt-5 px-[18px] pb-[18px] ')
              + (featured ? 'border-transparent gradient-ring ' : 'border-border/10 ')
              + (isCurrent ? 'bg-white/10 ' : '')
            }>
            {/* AN UNMETERED ACCOUNT IS NOT "ON" ANY OF THESE, so none of them is
                flagged as current and none of them is offered — a role-1 login
                staring at a "Choose Pro" button would be being sold something it
                already has more of. The cards stay visible because this is also
                the page an operator opens to check what customers see. */}
            {!unlimited && featured
              && <span className="absolute -top-[9px] left-4 bg-accent-gradient text-black rounded-full text-[9.5px] tracking-[0.07em] uppercase px-[9px] py-[3px]">{need != null ? 'Fits this plan' : 'Most chosen'}</span>}
            {!unlimited && isCurrent
              && <span className="absolute -top-[9px] left-auto right-4 bg-white text-black rounded-full text-[9.5px] tracking-[0.07em] uppercase px-[9px] py-[3px]">Your plan</span>}

            <h3 className="m-0 mb-2 text-[13px] tracking-[0.06em] uppercase text-subtle">{t.name}</h3>
            <div className="flex items-baseline gap-1 mb-2.5">
              {t.usd === 0 ? <b className="text-[30px] tracking-[-0.04em] tabular-nums">Free</b>
                : <><b className="text-[30px] tracking-[-0.04em] tabular-nums">${t.usd}</b><span className="text-[12px] text-subtle">/month</span></>}
            </div>
            <p className={'m-0 mb-3.5 text-[12px] text-muted leading-[1.55] min-h-[2.6em] ' + (compact ? 'hidden' : '')}>{t.blurb}</p>

            <div className="bg-white/5 border border-border/10 backdrop-blur-[5px] rounded py-[9px] px-[11px] mb-3.5">
              <b className="block text-[15px] tracking-[-0.02em] tabular-nums">{tierHeadline(t)}</b>
              <span className="text-[10.5px] text-subtle">{t.lifetime ? 'does not renew' : 'every month'}</span>
            </div>

            <ul className={'list-none m-0 mb-[18px] p-0 flex-1 flex flex-col gap-[7px] ' + (compact ? 'hidden' : '')}>
              {t.lines.map((l) => (
                <li key={l}
                  className="text-[12px] text-muted leading-[1.45] pl-[15px] relative before:content-[''] before:absolute before:left-[2px] before:top-[6px] before:w-[5px] before:h-[5px] before:rounded-full before:bg-border/25">
                  {l}
                </li>
              ))}
            </ul>

            {unlimited ? (
              <button className={BTN_BASE + ' ' + BTN_DEFAULT} disabled>Unmetered on your account</button>
            ) : t.usd === 0 ? (
              <button className={BTN_BASE + ' ' + BTN_DEFAULT} disabled>Included</button>
            ) : (
              <button className={BTN_BASE + ' ' + (featured ? BTN_PRIMARY : BTN_DEFAULT)}
                disabled={isCurrent || busyTier === t.slug}
                onClick={() => onChoose?.(t.slug)}>
                {isCurrent ? 'Current plan'
                  : busyTier === t.slug ? 'Opening…'
                  : need != null && !covers ? 'Not enough for this plan'
                  : `Choose ${t.name}`}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
