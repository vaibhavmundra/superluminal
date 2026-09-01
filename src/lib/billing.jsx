import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState }
  from 'react';
import { supabase } from './supabase.js';
import { useAuth } from './auth.jsx';
import { FREE, TIER, fingerprintOutline, fingerprintPass } from './plans.js';

// ---------------------------------------------------------------------------
// THE BROWSER'S HALF OF THE TILL.
//
// EVERYTHING IN HERE IS A CACHE OF SOMEBODY ELSE'S DECISION. The tier, the
// square feet left, whether a layout may run — all of it is api/billing.js's
// answer, held here so the profile menu can print a number without a round trip.
// Nothing in this file is allowed to be the reason a layout goes ahead: the
// editor asks the server every time, and this state only decides what the screen
// says while it waits.
//
// That is worth being strict about because the temptation is the opposite. It
// would be very easy to check `area.left` locally, skip the request when it looks
// fine, and save 200ms — and then the check that matters lives in a React memo
// that anybody can edit in a console.
//
// SO THE CONTRACT IS: claim(), await, then act. The gate is a network call.
// ---------------------------------------------------------------------------

const Ctx = createContext(null);

/** The shape before the server has answered — free, and nothing spent. */
const BLANK = {
  tier: 'free', status: 'inactive', mode: null, cancelAtPeriodEnd: false,
  currency: 'USD', periodStart: null, periodEnd: null, lifetime: true,
  area: { allowed: FREE.area, used: 0, left: FREE.area },
  passes: { allowed: FREE.renderPasses, used: 0, left: FREE.renderPasses },
};

async function authHeader() {
  // Supabase unconfigured is a legible sentence rather than a TypeError from
  // inside the SDK — the same courtesy src/lib/supabase.js extends everywhere
  // else it is reachable without a backend.
  if (!supabase) throw new Error('Supabase is not configured — see .env.example');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * One call to /api/billing.
 *
 * A NON-2xx IS THROWN AND A `{ok:false}` IS NOT. The difference is the whole
 * ergonomics of the gate: "you have run out" is a normal answer that the editor
 * renders as a paywall, and "the server is down" is an exception. Collapsing
 * them means either an exception for the commonest case in the product or a
 * silent free layout when the network fails.
 */
export async function billingCall(action, body = {}) {
  const res = await fetch('/api/billing', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Billing failed (${res.status})`);
  return json;
}

// ---------------------------------------------------------------------------
// RAZORPAY'S SCRIPT
// ---------------------------------------------------------------------------

const RZP_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let rzpLoad = null;

/**
 * LOADED ON DEMAND, ONCE, AND NOT IN index.html.
 *
 * A payment script in the document head is 60KB and a third-party connection on
 * every visit to a page whose job is to lay out a ceiling. Almost nobody in a
 * given session is buying anything. So it is fetched the moment somebody opens
 * the checkout dialog — which is a beat they are already spending typing their
 * name — and the promise is memoised so opening the dialog twice does not add a
 * second copy.
 */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (rzpLoad) return rzpLoad;
  rzpLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = RZP_SRC;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay)
      : reject(new Error('The payment window could not start')));
    s.onerror = () => {
      // CLEARED ON FAILURE, so a retry actually retries. A memoised rejected
      // promise is a button that stays broken until the tab is reloaded, which
      // on a flaky connection is most of them.
      rzpLoad = null;
      reject(new Error('The payment window could not be reached'));
    };
    document.head.appendChild(s);
  });
  return rzpLoad;
}

// ---------------------------------------------------------------------------

export function BillingProvider({ children }) {
  const { user, ready: authReady } = useAuth();
  const [state, setState] = useState(BLANK);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  // TRUE ON EVERY MOUNT, AND SETTING IT IN THE EFFECT IS THE WHOLE FIX.
  //
  // This was `useRef(true)` with a cleanup that set it false and nothing that
  // ever set it back — which StrictMode's development double-mount turns into a
  // provider that is permanently dead. The cleanup runs, `alive.current` is
  // false, the effect re-runs, and every setState below is guarded on a flag
  // that will never be true again: the balance is fetched, thrown away, and the
  // profile menu says "Free · 3,000 sq ft left" for a Pro account for the rest
  // of the session. Only in dev, which is worse — it makes the one feature you
  // cannot test in production the one you cannot test locally either.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!user) { setState(BLANK); setReady(true); return BLANK; }
    try {
      const out = await billingCall('state');
      if (alive.current) { setState(out.state); setErr(''); setReady(true); }
      return out.state;
    } catch (e) {
      // NOT FATAL, AND NOT A DOWNGRADE EITHER. A failed read of the balance
      // leaves whatever was last known on screen; the claim itself will fail
      // honestly if the server really is unreachable, and that is the moment to
      // say so. Blanking to free here would tell a paying user they are on the
      // free tier because one fetch timed out — the same mistake auth.jsx
      // documents at length about sign-outs.
      console.warn('[billing] could not read the balance', e);
      if (alive.current) { setErr(String(e.message || e)); setReady(true); }
      return null;
    }
  }, [user]);

  useEffect(() => { if (authReady) refresh(); }, [authReady, refresh]);

  /**
   * CLAIM THE SPACES ABOUT TO BE LIT.
   *
   * `spaces` is one entry per outline, with its own fingerprint, so the ledger
   * charges per space and a room nobody touched is never paid for twice. See the
   * long note in src/lib/plans.js for why that is the unit.
   *
   * Returns the server's verdict verbatim. The caller renders it; it does not
   * re-decide it.
   */
  const claimLayout = useCallback(async ({ planId, spaces }) => {
    const items = (spaces || [])
      .filter((s) => Number(s.sqft) > 0)
      .map((s) => ({
        outlineId: s.id,
        sqft: s.sqft,
        fingerprint: fingerprintOutline({ planId, points: s.points, pxPerFt: s.pxPerFt, sqft: s.sqft }),
      }));
    if (!items.length) return { ok: true, charged: { area: 0, spaces: 0 } };
    const out = await billingCall('consume', { kind: 'layout', planId, items });
    if (out.state && alive.current) setState(out.state);
    return out;
  }, []);

  /** One render pass. `runId` is minted per click, so a retry is a new charge. */
  const claimPass = useCallback(async ({ planId, roomId, runId }) => {
    const fingerprint = fingerprintPass({ planId, roomId, runId });
    const out = await billingCall('consume', { kind: 'render_pass', planId, fingerprint });
    if (out.state && alive.current) setState(out.state);
    return { ...out, fingerprint };
  }, []);

  /** Give one back, because it failed. See releaseAction in api/billing.js. */
  const releasePass = useCallback(async (fingerprint) => {
    if (!fingerprint) return;
    try {
      const out = await billingCall('release', { fingerprint });
      if (out.state && alive.current) setState(out.state);
    } catch (e) { console.warn('[billing] release failed', e); }
  }, []);

  /**
   * THE PURCHASE, END TO END.
   *
   * Four steps and the middle two belong to Razorpay: ask our server for a
   * subscription or an order, open their window on it, hand the signed result
   * back for verification, refresh. `details` is what the dialog collected.
   *
   * THE HANDLER RESOLVES THIS PROMISE rather than navigating. A checkout that
   * routes somewhere on success cannot be used from the paywall in the middle of
   * the editor — which is the place it matters most, because the user is three
   * clicks into a drawing and must land back exactly there.
   */
  const checkout = useCallback(async ({ tier, details = {} }) => {
    const t = TIER[tier];
    if (!t) throw new Error('Unknown plan');

    const [Razorpay, order] = await Promise.all([
      loadRazorpay(),
      billingCall('checkout', { tier, ...details }),
    ]);

    return new Promise((resolve, reject) => {
      const opts = {
        key: order.keyId,
        name: 'Super Luminal',
        description: `${t.name} — ${t.area.toLocaleString('en-IN')} sq ft a month`,
        // A PRODUCT OF DESIGNOPOLIS, and it belongs here as well as on our own
        // dialog: the Razorpay window is the moment a card number is typed, and
        // the name on it has to be one the payer recognises from their statement.
        notes: { by: 'Designopolis' },
        prefill: {
          name: details.name || order.prefill?.name || '',
          email: details.email || order.prefill?.email || '',
          contact: details.contact || order.prefill?.contact || '',
        },
        theme: { color: '#0070F3' },
        // Razorpay wants ONE of these two and is unhappy given both: a
        // subscription carries its own amount from the plan, an order carries it
        // from the order.
        ...(order.mode === 'subscription'
          ? { subscription_id: order.subscriptionId }
          : { order_id: order.orderId, amount: order.amount, currency: order.currency }),
        handler: async (resp) => {
          try {
            const out = await billingCall('verify', { tier, ...resp });
            if (alive.current) setState(out.state);
            resolve({ ok: true, state: out.state });
          } catch (e) {
            // PAID BUT UNVERIFIED IS NOT "FAILED", and the wording has to say so.
            // The webhook will land within seconds and activate it anyway, so the
            // worst honest description is "we have it, the screen is behind".
            reject(new Error(
              `The payment went through but we could not confirm it here (${e.message}). `
              + 'It will appear within a minute — reload if it does not.'));
          }
        },
        modal: {
          ondismiss: () => resolve({ ok: false, dismissed: true }),
        },
      };
      const rz = new Razorpay(opts);
      rz.on('payment.failed', (e) => {
        reject(new Error(e?.error?.description || 'The payment did not go through'));
      });
      rz.open();
    });
  }, []);

  const cancel = useCallback(async () => {
    const out = await billingCall('cancel');
    if (out.state && alive.current) setState(out.state);
    return out.state;
  }, []);

  const value = useMemo(() => ({
    ready, err, state,
    tier: TIER[state.tier] ?? FREE,
    paid: state.tier !== 'free',
    refresh, claimLayout, claimPass, releasePass, checkout, cancel,
  }), [ready, err, state, refresh, claimLayout, claimPass, releasePass, checkout, cancel]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBilling() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBilling outside BillingProvider');
  return v;
}
