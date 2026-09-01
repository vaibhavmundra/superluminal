// ---------------------------------------------------------------------------
// api/razorpay-webhook.js — the gateway talking to us, unprompted.
//
// A SEPARATE FILE FROM api/billing.js, AND THAT IS THE POINT. Every action in
// billing.js begins by proving there is a signed-in user; this endpoint has no
// user at all — Razorpay's servers call it, from an IP we do not know, about an
// account whose session ended twenty minutes ago. Its credential is the
// signature on the body and nothing else.
//
// Folding that into billing.js would mean one unauthenticated branch inside a
// handler whose whole contract is "the caller is verified first", which is the
// shape a serious mistake eventually takes. Two files, two doors, two different
// keys.
//
// WHY THIS EXISTS WHEN /verify ALREADY ACTIVATES A SUBSCRIPTION. Because
// /verify only runs if the browser is still there. Three things it cannot cover:
//
//   · the tab closed between paying and the callback — the money left the
//     account and nothing in our database knows
//   · NEXT month, and every month after. Nobody is watching when Razorpay
//     charges the mandate on the 20th; this is the only thing that rolls the
//     period forward and refreshes the allowance
//   · a card that stops working. `subscription.halted` is how a tier ends, and
//     an app that never hears it keeps giving away 50,000 sq ft a month
//
// So /verify is for the person watching the spinner, and this is the record.
// Both write the same three columns and both are idempotent, so it does not
// matter which arrives first.
//
// SET IT UP: Razorpay Dashboard → Settings → Webhooks → Add New Webhook
//   URL     https://<your-host>/api/razorpay-webhook
//   Secret  the same string as RZP_WEBHOOK_SECRET in the environment
//   Events  subscription.activated, subscription.charged, subscription.pending,
//           subscription.halted, subscription.cancelled, subscription.completed,
//           payment.captured
// ---------------------------------------------------------------------------
import { createHmac } from 'node:crypto';
import { sellableTier } from '../src/lib/plans.js';

/**
 * PREPAID MODE IS NOT A SECOND-CLASS PATH HERE, AND IT USED TO BE.
 *
 * The first version of this file handled only `subscription.*`, so with
 * RZP_MODE=order the ONLY route to an entitlement was /verify — and /verify only
 * runs if the browser is still on screen. A user who paid and closed the tab, or
 * whose verify request timed out (the message they get says "it will appear
 * within a minute", which was simply untrue), had their money taken and got
 * nothing. `payment.captured` is now handled for exactly that case.
 */
const ORDER_EVENTS = ['payment.captured', 'order.paid'];

/**
 * THE EVENTS THAT MEAN MONEY ARRIVED, AND ONLY THESE MAY GRANT A PERIOD.
 *
 * The first version of the park branch checked none of this. It sat before the
 * switch and fired for ANY signed event carrying a tier and an email, which for
 * an unclaimed anonymous subscription is every event Razorpay sends — so
 * `subscription.pending` (the renewal charge FAILED), `subscription.halted`,
 * `subscription.cancelled` and `payment.failed` each parked a fully paid month.
 * Buy Pro, let the card decline, sign in: a month nobody paid for, and
 * `cancelled` silently un-cancelled itself because the claim writes `status:
 * 'active'`.
 *
 * A period is now granted only where the gateway is telling us it took money.
 */
const PAID_EVENTS = ['subscription.charged', 'subscription.activated',
                     'payment.captured', 'order.paid'];

/** Did any money actually move? A payment entity, if present, must say so. */
const moneyMoved = (event, payEntity) => PAID_EVENTS.includes(event)
  && (!payEntity || ['captured', 'authorized'].includes(String(payEntity.status)));

const PROJECT_URL = process.env.SUPABASE_URL
  || (process.env.SUPABASE_PROJECT_ID ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co` : '')
  || process.env.VITE_SUPABASE_URL
  || '';
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WEBHOOK_SECRET = process.env.RZP_WEBHOOK_SECRET || '';
const CURRENCY = (process.env.RZP_CURRENCY || 'USD').toUpperCase();

const enc = encodeURIComponent;

async function rest(path, { method = 'GET', body = null, prefer = null } = {}) {
  const headers = {
    apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json', Accept: 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : []; } catch { return []; }
}

/**
 * THE RAW BYTES, WHICH ARE THE ONLY THING THE SIGNATURE IS OVER.
 *
 * A re-serialised body is a different string — different key order, different
 * spacing — and hashes to something else, so this must read the stream. It
 * usually can: Vite's middleware has not touched it, and neither has Vercel
 * until something reads `req.body`.
 *
 * THE FALLBACK IS A COMPROMISE AND IT IS DOCUMENTED RATHER THAN HIDDEN. Some
 * runtimes parse the body before the handler is entered, leaving the stream
 * empty; there `JSON.stringify(req.body)` is the best available reconstruction
 * and it does match, because Razorpay sends compact JSON and JavaScript
 * preserves an object's key order. If a signature ever fails here with a body
 * that is plainly correct, THIS is the paragraph to come back to — the fix is to
 * disable body parsing for this route, not to weaken the check.
 */
async function rawBody(req) {
  const chunks = [];
  try { for await (const c of req) chunks.push(c); } catch { /* already consumed */ }
  if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  if (typeof req.body === 'string') return req.body;
  return '';
}

function verified(raw, header) {
  if (!WEBHOOK_SECRET || !header) return false;
  const mine = createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
  const theirs = String(header);
  if (mine.length !== theirs.length) return false;
  let d = 0;
  for (let i = 0; i < mine.length; i++) d |= mine.charCodeAt(i) ^ theirs.charCodeAt(i);
  return d === 0;
}

/**
 * WHOSE SUBSCRIPTION IS THIS. Two ways, and the order matters.
 *
 * `notes.owner` is what we put there ourselves at checkout, so it is the
 * cheapest and most direct answer. The lookup by subscription id is the
 * fallback for an event about a subscription created before notes were set, or
 * one created by hand in the dashboard.
 *
 * NEVER BY EMAIL. An email in a webhook payload is a string the payer typed on a
 * checkout form; matching it to an account would let anyone attach their payment
 * to somebody else's login by typing their address.
 */
async function ownerOf(entity) {
  const fromNotes = entity?.notes?.owner;
  if (/^[0-9a-f-]{36}$/i.test(String(fromNotes || ''))) return String(fromNotes);
  const subId = entity?.id || entity?.subscription_id;
  if (subId) {
    const rows = await rest(`subscriptions?provider_subscription_id=eq.${enc(subId)}`
      + '&select=owner&limit=1');
    if (rows[0]?.owner) return rows[0].owner;
  }
  return null;
}

const secs = (n) => (n ? new Date(Number(n) * 1000).toISOString() : null);

const addMonth = (from) => {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString();
};

export default async function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };

  if (req.method !== 'POST') return send(405, { error: 'POST only' });
  if (!PROJECT_URL || !SERVICE_KEY) return send(503, { error: 'not configured' });

  const raw = await rawBody(req);
  const sig = req.headers?.['x-razorpay-signature'] || req.headers?.['X-Razorpay-Signature'];

  if (!verified(raw, sig)) {
    // 400 AND NOT 401, DELIBERATELY. Razorpay retries a 5xx and gives up on a
    // 4xx; a body we cannot verify will never verify on the second attempt
    // either, so asking to be called again is asking for a loop.
    console.warn('[webhook] signature rejected');
    return send(400, { error: 'bad signature' });
  }

  let evt = null;
  try { evt = JSON.parse(raw); } catch { return send(400, { error: 'bad json' }); }

  const event = String(evt?.event || '');
  const subEntity = evt?.payload?.subscription?.entity ?? null;
  const payEntity = evt?.payload?.payment?.entity ?? null;
  const entity = subEntity ?? payEntity;
  const owner = await ownerOf(subEntity ?? payEntity ?? {});

  // SELLABLE ONLY. `entity.notes` on a PAYMENT entity is set by the browser at
  // Razorpay's checkout, so validating against the full TIER map — which now
  // contains the unmetered admin tier — let a ten-dollar Starter payment park a
  // row whose tier was `admin`, to be copied into `subscriptions.tier` on the
  // first sign-in. See the note on SELLABLE in src/lib/plans.js.
  const tierSlug = sellableTier(entity?.notes?.tier)?.slug ?? null;

  // ACKNOWLEDGED EVEN WHEN IT IS NOT OURS. A 200 with `ignored` stops Razorpay
  // retrying an event about an account we cannot place — a subscription made by
  // hand in the dashboard, a test fired at the wrong environment — which would
  // otherwise arrive every few minutes for a day.
  if (!owner) {
    console.warn('[webhook] no owner for', event);
    return send(200, { ok: true, ignored: 'no owner' });
  }

  try {
    // THE AUDIT ROW FIRST, before any interpretation of the event. If the logic
    // below has a bug, what the gateway actually said is still on disk.
    //
    // AND IT IS ALSO THE IDEMPOTENCY GUARD. Razorpay retries until it gets a
    // 2xx, so every event here arrives several times. `ignore-duplicates` plus
    // `return=representation` makes PostgREST hand back the row it inserted or
    // an EMPTY ARRAY if the unique index refused it — so `fresh` below is a
    // definitive "this is the first time we have seen this event", decided by
    // the database. That matters for the prepaid branch, which EXTENDS a period:
    // an extension applied twice is a free month.
    const inserted = await rest(
      'payments?on_conflict=provider,provider_payment_id,event', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: [{
        owner, provider: 'razorpay',
        provider_payment_id: payEntity?.id ?? null,
        provider_order_id: payEntity?.order_id ?? null,
        provider_subscription_id: subEntity?.id ?? payEntity?.subscription_id ?? null,
        event, status: payEntity?.status ?? subEntity?.status ?? null,
        amount_minor: payEntity?.amount ?? null,
        currency: payEntity?.currency ?? CURRENCY,
        raw: evt,
      }] });
    const fresh = Array.isArray(inserted) && inserted.length > 0;

    const patch = { owner, provider: 'razorpay', mode: 'subscription' };

    switch (event) {
      // THE ONE THAT REFRESHES THE ALLOWANCE. A charge moves
      // current_period_start forward, and because usage is summed FROM that
      // timestamp (see windowStart in plans.js) the month's square feet come
      // back without a single row being deleted or a counter reset. The reset is
      // a side effect of the period moving, which is why there is no reset code
      // anywhere in this repo.
      case 'subscription.charged':
      case 'subscription.activated':
      case 'subscription.resumed':
      case 'subscription.updated': {
        patch.status = subEntity?.status || 'active';
        if (tierSlug) patch.tier = tierSlug;
        patch.provider_subscription_id = subEntity?.id ?? null;
        patch.provider_plan_id = subEntity?.plan_id ?? null;
        patch.current_period_start = secs(subEntity?.current_start) ?? new Date().toISOString();
        patch.current_period_end = secs(subEntity?.current_end)
          ?? addMonth(patch.current_period_start);
        // THE CANCELLATION FLAG IS ONLY EVER CLEARED BY MONEY ARRIVING, and
        // `subscription.updated` is not that. Razorpay fires `updated` when a
        // cancel_at_cycle_end is SCHEDULED — which is precisely what cancelAction
        // asks for — so clearing the flag here undid the user's own cancellation
        // seconds after they made it. The pricing page then re-offered "Cancel
        // subscription" and dropped the "runs until…" notice, so somebody who had
        // cancelled successfully was told they had not.
        if (event !== 'subscription.updated') patch.cancel_at_period_end = false;
        break;
      }

      // PENDING IS NOT YET A DOWNGRADE. Razorpay is retrying the charge and the
      // month may still be paid for; taking the tier away here would strand
      // somebody mid-drawing over a bank timeout. `halted` is the real end.
      case 'subscription.pending':
        patch.status = 'pending';
        break;

      case 'subscription.halted':
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired':
        patch.status = subEntity?.status || 'cancelled';
        // THE PERIOD IS LEFT WHERE IT IS, on purpose. tierOf() already treats a
        // non-live status as free, and a paid month that has been paid for should
        // run to its end rather than stopping the moment a future renewal was
        // cancelled. Truncating the date here would take away something that was
        // bought.
        break;

      default: {
        // --- THE PREPAID MONTH ------------------------------------------------
        //
        // A bare payment with no subscription behind it is order mode, and it
        // buys one month. Three things have to be true before it grants anything,
        // and each of them is a way this could otherwise be abused:
        //
        //   · the event is NEW (`fresh`) — a retried webhook must not extend the
        //     period a second time
        //   · our own notes name a tier — set server-side in checkoutAction and
        //     unreachable from the browser
        //   · the payment was actually captured
        //
        // EXTENDED FROM WHERE THE PERIOD ALREADY ENDS, not from now, so somebody
        // who renews three days early keeps those three days instead of donating
        // them. A lapsed period extends from today.
        const isOrderPayment = ORDER_EVENTS.includes(event)
          && !payEntity?.subscription_id && tierSlug
          && moneyMoved(event, payEntity);

        if (!isOrderPayment || !fresh) {
          return send(200, { ok: true, recorded: event, granted: false });
        }

        const existing = await rest(`subscriptions?owner=eq.${enc(owner)}`
          + '&select=current_period_end&limit=1');
        const have = Date.parse(existing[0]?.current_period_end ?? '');
        const from = Number.isFinite(have) && have > Date.now()
          ? new Date(have).toISOString() : new Date().toISOString();

        await rest('subscriptions', { method: 'POST',
          prefer: 'resolution=merge-duplicates', body: [{
            owner, provider: 'razorpay', mode: 'order',
            tier: tierSlug, status: 'active',
            currency: payEntity?.currency ?? CURRENCY,
            amount_minor: payEntity?.amount ?? null,
            current_period_start: new Date().toISOString(),
            current_period_end: addMonth(from),
            cancel_at_period_end: false,
          }] });

        console.log('[webhook]', event, '→ prepaid month for', tierSlug);
        return send(200, { ok: true, event, granted: true });
      }
    }

    await rest('subscriptions', { method: 'POST',
      prefer: 'resolution=merge-duplicates', body: [patch] });

    console.log('[webhook]', event, '→', patch.status, patch.tier ?? '(tier unchanged)');
    return send(200, { ok: true, event });
  } catch (err) {
    // 500 SO IT IS RETRIED. This is the one place a retry is what we want: the
    // signature was good, so the event is real, and losing it means a paying
    // customer on the free tier.
    console.error('[webhook] failed', err);
    return send(500, { error: 'could not record the event' });
  }
}

export const __test = { verified, addMonth, secs };
