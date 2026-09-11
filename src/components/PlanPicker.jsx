import React from 'react';
import { TIERS, tierHeadline } from '../lib/plans.js';

const BTN_BASE = 'text-[12px] px-3 py-[7px] rounded border cursor-pointer transition-colors duration-[120ms] w-full justify-center disabled:opacity-100 disabled:cursor-not-allowed';
const BTN_DEFAULT = 'border-border/10 bg-surface backdrop-blur-[5px] text-white hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3 disabled:hover:bg-surface disabled:hover:border-border/10';
const BTN_PRIMARY = 'lp-glow-btn border-transparent';

// Shared by the public pricing page and the in-editor paywall. Prices come from
// the billing endpoint because the server, using Vercel's country header, is the
// authority for whether Studio is ₹499 or $10.
export default function PlanPicker({ current = 'free', busyTier = null, compact = false,
                                     onChoose, unlimited = false, pricing = null }) {
  return (
    <div className={
      'grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] items-start max-[760px]:grid-cols-1 '
      + (compact ? 'gap-2.5 mt-[18px] mb-1.5' : 'gap-3.5 mb-[38px]')
    }>
      {TIERS.map((t) => {
        const isCurrent = t.slug === current;
        const featured = t.slug === 'studio';

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
            {featured && !isCurrent
              && <span className="absolute -top-[9px] left-4 bg-accent-gradient text-black rounded-full text-[9.5px] tracking-[0.07em] uppercase px-[9px] py-[3px]">Unlimited</span>}
            {isCurrent
              && <span className="absolute -top-[9px] left-auto right-4 bg-white text-black rounded-full text-[9.5px] tracking-[0.07em] uppercase px-[9px] py-[3px]">Your plan</span>}

            <h3 className="m-0 mb-2 text-[13px] tracking-[0.06em] uppercase text-subtle">{t.name}</h3>
            <div className="flex items-baseline gap-1 mb-2.5">
              {t.usd === 0 ? <b className="text-[30px] tracking-[-0.04em] tabular-nums">Free</b>
                : <><b className="text-[30px] tracking-[-0.04em] tabular-nums">{pricing?.display || '$10'}</b><span className="text-[12px] text-subtle">/month</span></>}
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

            {unlimited && current === 'admin' ? (
              <button className={BTN_BASE + ' ' + BTN_DEFAULT} disabled>Unmetered on your account</button>
            ) : t.usd === 0 ? (
              <button className={BTN_BASE + ' ' + BTN_DEFAULT} disabled>Included</button>
            ) : (
              <button className={BTN_BASE + ' ' + (featured ? BTN_PRIMARY : BTN_DEFAULT)}
                disabled={isCurrent || busyTier === t.slug}
                onClick={() => onChoose?.(t.slug)}>
                {isCurrent ? 'Current plan'
                  : busyTier === t.slug ? 'Opening…'
                  : `Choose ${t.name}`}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
