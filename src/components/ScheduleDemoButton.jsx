import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export const CALENDLY_URL =
  'https://calendly.com/hello-superluminal/30min?primary_color=1a1a1a';

const CALENDLY_SCRIPT = 'https://assets.calendly.com/assets/external/widget.js';
const CALENDLY_STYLES = 'https://assets.calendly.com/assets/external/widget.css';
const SCRIPT_ID = 'superluminal-calendly-script';
const STYLES_ID = 'superluminal-calendly-styles';

let calendlyLoad = null;

/** Load Calendly once for the whole browser session. Kept out of index.html so
 * tests and pages that never render the button do not acquire a third-party
 * dependency. Both button placements call this and share the same promise. */
export function loadCalendly() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Calendly requires a browser'));
  }
  if (window.Calendly?.initPopupWidget) return Promise.resolve(window.Calendly);
  if (calendlyLoad) return calendlyLoad;

  if (!document.getElementById(STYLES_ID)) {
    const link = document.createElement('link');
    link.id = STYLES_ID;
    link.rel = 'stylesheet';
    link.href = CALENDLY_STYLES;
    document.head.appendChild(link);
  }

  calendlyLoad = new Promise((resolve, reject) => {
    const failed = (message = 'The demo calendar could not be reached') => {
      document.getElementById(SCRIPT_ID)?.remove();
      calendlyLoad = null;
      reject(new Error(message));
    };
    const ready = () => (window.Calendly?.initPopupWidget
      ? resolve(window.Calendly)
      : failed('The demo calendar could not start'));
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', ready, { once: true });
      existing.addEventListener('error', failed, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = CALENDLY_SCRIPT;
    script.async = true;
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', failed, { once: true });
    document.head.appendChild(script);
  });
  return calendlyLoad;
}

const BASE = 'inline-flex items-center justify-center border '
  + 'bg-white text-black border-white cursor-pointer whitespace-nowrap '
  + 'transition-[background-color,border-color,transform] duration-150 '
  + 'hover:bg-text hover:border-text active:translate-y-px '
  + 'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 '
  + 'disabled:cursor-wait disabled:opacity-80';

/** The same action in two placements: a fixed sales affordance across the app,
 * and a full-size quiet companion to Upload on Home. */
export default function ScheduleDemoButton({ floating = false, inToolRail = false, className = '' }) {
  const [opening, setOpening] = useState(false);

  // Start loading on sight so a click can open the modal without a dead beat.
  useEffect(() => { loadCalendly().catch(() => {}); }, []);

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const calendly = await loadCalendly();
      calendly.initPopupWidget({ url: CALENDLY_URL });
    } catch {
      const tab = window.open(CALENDLY_URL, '_blank');
      if (tab) tab.opener = null;
      else window.location.assign(CALENDLY_URL);
    } finally {
      setOpening(false);
    }
  };

  const placement = floating
    ? `fixed bottom-4 z-[80] size-12 rounded-full p-0 shadow-[0_8px_28px_rgba(0,0,0,0.24)] border-black/10 ${inToolRail
      ? 'left-[19px] [@media(max-width:960px)]:left-auto [@media(max-width:960px)]:right-5 [@media(max-width:960px)]:bottom-5'
      : 'right-5'}`
    : 'h-field-h w-[240px] rounded-[8px] px-0 text-[14px]';

  return (
    <button type="button" className={`${BASE} ${placement} ${className}`}
      onClick={open} disabled={opening}
      aria-label={floating ? 'Schedule a demo call' : undefined}
      aria-busy={opening || undefined}
      title={floating ? 'Schedule a Demo' : undefined}>
      {floating ? (
        <>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
            className={`size-[22px] ${opening ? 'animate-pulse' : ''}`}>
            <path d="M20 11.5a7.5 7.5 0 0 1-8 7.48 8.7 8.7 0 0 1-3.18-.86L4 20l1.66-4.42A7.5 7.5 0 1 1 20 11.5Z"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="sr-only">{opening ? 'Opening calendar' : 'Schedule a Demo'}</span>
        </>
      ) : (opening ? 'Opening calendar…' : 'Schedule a Demo')}
    </button>
  );
}

/** One global mount covers every route. Home supplies the inline version beside
 * its primary action, so the fixed button deliberately stays off that page. */
export function FloatingScheduleDemoButton() {
  const { pathname } = useLocation();
  if (pathname === '/') return null;

  // The editor's 86px tool rail spans the full height on desktop. Centre the
  // 48px launcher in that rail (19px + 48px + 19px) on every route that hosts
  // the design canvas. On narrow screens the rail becomes a row, and the
  // responsive classes above restore the ordinary bottom-right placement.
  const inToolRail = /^\/plans\/[^/]+\/?$/.test(pathname)
    || /^\/shared\/[^/]+\/plans\/[^/]+\/?$/.test(pathname)
    || /^\/admin\/plans\/[^/]+\/?$/.test(pathname);
  return <ScheduleDemoButton floating inToolRail={inToolRail} />;
}
