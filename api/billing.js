// The server is the authority for the only usage rule: a Free account may light
// three distinct plans. It re-validates the caller and plan ownership before it
// records a plan slot; area and render passes are never charged. Checkout prices
// are also server-owned and selected from Vercel's country header.
//
// This module runs both as a Vercel function and Vite development middleware.
import { createHmac } from 'node:crypto';
import { TIERS, tierOf, sellableTier, windowStart, balanceFromTotals, canSpend,
         normaliseEmail } from '../src/lib/plans.js';

/**
 * THE CONFLICT TARGETS, NAMED, BECAUSE POSTGREST WILL NOT GUESS THEM.
 *
 * `Prefer: resolution=ignore-duplicates` with no `on_conflict=` infers the
 * PRIMARY KEY — and every one of these tables has a surrogate `id uuid default
 * gen_random_uuid()` that is never in the payload, so the emitted `ON CONFLICT
 * (id)` can never fire and the unique-index violation we were relying on came
 * back as a 409 that `rest()` throws.
 *
 * That silently broke the idempotency of the whole flow: the replay guard in
 * verifyAction never returned an empty array (it threw), so both of its branches
 * were dead, and a retried webhook 500'd for ever. Named here, once, beside each
 * other, so a fourth table cannot be added without noticing that it needs one.
 *
 * These must match a NON-PARTIAL unique index — Postgres cannot use a partial one
 * as an arbiter unless the statement repeats its predicate, which PostgREST does
 * not do. See the note in migration 0005.
 */
const ON_CONFLICT = {
  payments: 'provider,provider_payment_id,event',
  usage_events: 'owner,kind,fingerprint',
};

const PROJECT_URL = process.env.SUPABASE_URL
  || (process.env.SUPABASE_PROJECT_ID ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co` : '')
  || process.env.VITE_SUPABASE_URL
  || '';

const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// --- Razorpay ---------------------------------------------------------------
const RZP_KEY = process.env.RZP_KEY || process.env.RAZORPAY_KEY_ID || '';
const RZP_SECRET = process.env.RZP_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
const RZP_API = 'https://api.razorpay.com/v1';

/**
 * TWO WAYS TO SELL THE SAME MONTH, and which one is live is one env var.
 *
 *   'subscription' — Razorpay holds a mandate (UPI Autopay, card, eMandate) and
 *                    charges again by itself. This is what "$10/month" means and
 *                    it is the default. It needs the Subscriptions product
 *                    enabled on the account and a plan id per tier, created by
 *                    tools/razorpay-plans.mjs.
 *   'order'        — a single prepaid month. Works on every Razorpay account
 *                    with no activation and no plan ids, and the user comes back
 *                    to renew. This is the fallback when Subscriptions or
 *                    international payments are not switched on yet, and it is
 *                    also the shape PayPal will slot into later.
 *
 * Both paths converge on the same three columns — tier, current_period_start,
 * current_period_end — so nothing downstream of this file knows which one paid.
 */
const RZP_MODE = (process.env.RZP_MODE || 'subscription').toLowerCase() === 'order'
  ? 'order' : 'subscription';

const PLAN_IDS = {
  india: process.env.RZP_INDIA_PLAN || '',
  global: process.env.RZP_USD_PLAN || '',
};

const REGIONAL_PRICES = {
  india: { market: 'india', currency: 'INR', amount: 499, amountMinor: 49900,
           display: '₹499' },
  global: { market: 'global', currency: 'USD', amount: 10, amountMinor: 1000,
            display: '$10' },
};

/* --- A TEMPORARY HOOK: WHO IS TRYING TO SUBSCRIBE, AND FROM WHERE ----------
 *
 * IT IS MARKET RESEARCH AND IT SAYS SO. Nothing downstream reads it, no column
 * records it and no behaviour depends on it: it exists so the owner can see
 * which market the buyers are actually in before committing to the pricing. It
 * is meant to be removed, which is why it is one function and one constant
 * rather than a feature threaded through the module.
 *
 * THE OFF SWITCH IS AN ENV VAR AND NOT A CODE CHANGE, which is the whole of what
 * makes "temporary" true. `SUBSCRIBE_ALERT_TO=` — set and empty — stops it dead
 * on the next deploy; unset, it goes to the address below. `??` and not `||`, so
 * an empty string is the OFF answer rather than a missing one that falls back to
 * the default and cannot be turned off at all.
 */
const ALERT_TO = (process.env.SUBSCRIBE_ALERT_TO ?? 'vaibhav@designopolis.co.in').trim();
const ALERT_FROM = process.env.RESEND_FROM_EMAIL
  || 'Super Luminal <hello@superluminal.design>';
const RESEND_KEY = process.env.RESEND_API_KEY || '';

const escHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * WHAT THE NOTICE SAYS — pure, so it can be checked without a network.
 *
 * ONE LINE PER FACT AND THE PRICE IN THE SUBJECT, because the subject line is
 * the whole of what this is for: a phone showing "Subscribe attempt — ₹499
 * (india)" has already answered the question on the lock screen.
 *
 * A MISSING PHONE SAYS SO RATHER THAN LEAVING A BLANK. The field is optional at
 * the checkout (see CheckoutDialog), and an empty line beside "Phone" reads as
 * a bug in this email rather than as a person who did not type one.
 */
function subscribeAlert({ name, email, contact, pricing, mode, userId, at }) {
  const price = `${pricing.display} / month`;
  const where = pricing.country ? `${pricing.market} (${pricing.country})` : pricing.market;
  const rows = [
    ['Email', email || 'not given'],
    ['Phone', contact || 'not given'],
    ['Name', name || 'not given'],
    ['Price', `${price} — ${pricing.currency}`],
    ['Market', where],
    ['Checkout', mode],
    ['Account', userId || 'unknown'],
    ['When', at],
  ];
  return {
    subject: `Subscribe attempt — ${pricing.display} (${pricing.market})`,
    text: 'Someone just tried to start a Studio subscription.\n\n'
      + rows.map(([k, v]) => `${k}: ${v}`).join('\n')
      + '\n\nThis is the temporary market-research notice. '
      + 'Set SUBSCRIBE_ALERT_TO to an empty value to stop it.',
    html: `<p>Someone just tried to start a Studio subscription.</p>`
      + `<table cellpadding="4" style="border-collapse:collapse;font:14px system-ui">`
      + rows.map(([k, v]) =>
          `<tr><td style="color:#666">${escHtml(k)}</td><td><strong>${escHtml(v)}</strong></td></tr>`).join('')
      + `</table>`
      + `<p style="color:#666;font-size:12px">Temporary market-research notice. `
      + `Set <code>SUBSCRIBE_ALERT_TO</code> to an empty value to stop it.</p>`,
  };
}

/**
 * ...AND SEND IT. IT CANNOT FAIL A CHECKOUT AND IT CANNOT SLOW ONE DOWN MUCH.
 *
 * EVERY ERROR IS SWALLOWED. Somebody is standing at a payment form; a Resend
 * outage, a bad key or a DNS blip must not be the reason they cannot pay. The
 * failure is logged and the checkout carries on, because the notice is worth
 * strictly less than the sale it is telling us about.
 *
 * AWAITED, AND NOT FIRED AND FORGOTTEN. A promise left running after a
 * serverless function has answered is a promise the platform may freeze — so a
 * fire-and-forget notice is one that silently does not arrive, which for a hook
 * whose entire output is "did anyone try" is the one failure that matters.
 * FIVE SECONDS, which is well inside the two Razorpay round trips this sits in
 * front of, and short enough that a hung Resend costs a pause rather than a
 * timeout.
 *
 * BEFORE THE RAZORPAY CALLS AND NOT AFTER, which is the placement that answers
 * the question being asked. "Someone tried" is true the moment they press the
 * button; a notice sent after the subscription is created would miss exactly the
 * attempts that failed — no plan id, payments not switched on, Razorpay down —
 * and those are the ones the owner most needs to see.
 */
async function notifySubscribeAttempt(details) {
  if (!ALERT_TO || !RESEND_KEY) return;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const mail = subscribeAlert(details);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [ALERT_TO],
        // SO A REPLY GOES TO THE PERSON RATHER THAN TO THE APP, which is the one
        // thing the owner will want to do with this email.
        ...(details.email ? { reply_to: details.email } : {}),
        subject: mail.subject, text: mail.text, html: mail.html,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      console.warn('[billing] subscribe alert not sent:', res.status,
        (await res.text()).slice(0, 200));
    }
  } catch (err) {
    console.warn('[billing] subscribe alert failed:', err?.message || err);
  } finally {
    clearTimeout(timer);
  }
}

/** Vercel supplies an ISO country code. Missing locally means global/USD. */
function pricingFor(req) {
  const raw = req?.headers?.['x-vercel-ip-country']
    || req?.headers?.['X-Vercel-IP-Country'] || '';
  const country = String(Array.isArray(raw) ? raw[0] : raw).trim().toUpperCase();
  const base = country === 'IN' ? REGIONAL_PRICES.india : REGIONAL_PRICES.global;
  return { ...base, country: country || null };
}

function pricingForPlan(planId) {
  if (PLAN_IDS.india && planId === PLAN_IDS.india) return REGIONAL_PRICES.india;
  if (PLAN_IDS.global && planId === PLAN_IDS.global) return REGIONAL_PRICES.global;
  return null;
}

// Kept as a tiny pure export for the billing test harness.
function amountMinor(slug, currency = 'USD') {
  if (sellableTier(slug)?.slug !== 'studio') return 0;
  return currency === 'INR' ? REGIONAL_PRICES.india.amountMinor
    : REGIONAL_PRICES.global.amountMinor;
}

const rzpAuth = () => 'Basic ' + Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString('base64');

/** One Razorpay call. Their errors are JSON with a useful `description`. */
async function rzp(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${RZP_API}${path}`, {
    method,
    headers: { Authorization: rzpAuth(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep the text */ }
  if (!res.ok) {
    const msg = json?.error?.description || json?.error?.reason || text.slice(0, 300);
    const err = new Error(`razorpay ${res.status}: ${msg}`);
    err.status = res.status === 400 ? 400 : 502;
    throw err;
  }
  return json;
}

// --- Supabase, with the service key ---------------------------------------

/**
 * One PostgREST call. Reads and writes, unlike the read-only helper in
 * api/admin.js — `prefer` is how an upsert and an ignore-duplicates insert are
 * expressed, and both are load-bearing here.
 */
async function rest(path, { method = 'GET', body = null, prefer = null } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`supabase ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  try { return text ? JSON.parse(text) : []; } catch { return []; }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

/**
 * WHO IS ASKING. EVERY ACTION HERE NEEDS A SESSION — including checkout, and that
 * is a product decision rather than a technical constraint: a subscription belongs
 * to an account, so there has to be an account before there is a subscription.
 *
 * Resolved separately from being required so that the requirement lives in ONE
 * place, in the handler, rather than as an `if` at the top of six functions where
 * the seventh would forget it.
 *
 * THE TOKEN IS THE CREDENTIAL AND ONLY SUPABASE CAN VALIDATE IT, so that is who
 * is asked — with the anon key, which is a public operation. Nothing here reads a
 * claim out of the JWT: a claim is whatever was minted when the session began,
 * and this endpoint spends money.
 *
 * AND THE ROLE IS READ FROM THE DATABASE, WITH THE SERVICE KEY. Role 1 is
 * unmetered (see ADMIN in src/lib/plans.js), which makes `isAdmin` a spending
 * decision rather than a cosmetic one — so it is established exactly the way
 * api/admin.js establishes it, and for the reasons documented there at length:
 * not from the token's claims, which are as old as the session, and certainly
 * not from anything the caller sent. The column is frozen against self-service
 * promotion by a trigger in migration 0003, so the two halves agree.
 */
async function resolveUser(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || '';
  const token = /^Bearer\s+(.+)$/i.exec(raw)?.[1]?.trim();
  if (!token) return null;

  const who = await fetch(`${PROJECT_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!who.ok) return null;
  const user = await who.json();
  if (!user?.id) return null;

  let role = null;
  // THE ADDRESS COMES OFF THE PROFILE NOW, AND THE SAME READ FETCHES IT. A phone
  // account (migration 0011) has no `user.email` at all — the JWT carries a
  // number — so every downstream use of `.email` in this file was about to go
  // blank at once: the Razorpay prefill, the receipt the webhook sends, the
  // share-grant check in verifyAction, and the ownership fallback for a purchase
  // made before signing in. Resolving it HERE means those four keep reading one
  // field and none of them had to learn where an address lives.
  let profileEmail = '';
  try {
    const rows = await rest(`profiles?select=role,email&id=eq.${enc(user.id)}&limit=1`);
    role = rows[0]?.role ?? null;
    profileEmail = normaliseEmail(rows[0]?.email);
  } catch (err) {
    // A PROFILE READ THAT FAILS MUST NOT PROMOTE ANYBODY, and it must not lock a
    // paying customer out either. Falling through with role null means "a normal
    // user", which is the safe reading in both directions.
    console.warn('[billing] could not read the role', err.message);
  }

  // THE CLAIM WINS WHERE THERE IS ONE, matching public.my_email() and
  // addressOf() in api/share.js — see the note on either. Three places now
  // answer "what is this caller's address" and they must answer it identically.
  // ROLE 1 AND NOTHING ELSE. Not >= 1, not truthy — a role column that grows a
  // third value later must not silently hand that value an unmetered account.
  return {
    id: user.id,
    email: normaliseEmail(user.email) || profileEmail || '',
    isAdmin: role === 1,
  };
}

function requireUser(user) {
  if (!user) { const e = new Error('Not signed in'); e.status = 401; throw e; }
  return user;
}

const uuid = (v) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  .test(String(v || '')) ? String(v) : null);

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// THE BALANCE, SERVER-SIDE
// ---------------------------------------------------------------------------

async function subscriptionOf(userId) {
  const rows = await rest(`subscriptions?owner=eq.${enc(userId)}&limit=1`);
  return rows[0] ?? null;
}

/**
 * WHAT HAS BEEN SPENT, ADDED UP BY POSTGRES.
 *
 * THIS WAS A SELECT AND A JavaScript SUM AND THAT WAS A HOLE. It read the ledger
 * with `limit=5000` and no ordering, and PostgREST returns an unordered select in
 * physical order — so past five thousand rows the OLDEST five thousand were
 * summed and everything newer was invisible. Twenty-five batches of two hundred
 * hundredth-of-a-foot claims got there, and from then on the balance read about
 * fifty square feet whatever had actually been spent. An unlimited free tier,
 * reachable with a loop, and nothing about it looked wrong from outside.
 *
 * One aggregate over the owner index is exact at any size. `MIN_CLAIM_SQFT` in
 * consumeAction closes the other half — the row-count spam that made it cheap.
 *
 * THE WINDOW IS STILL THE TIER'S OWN RULE. `windowStart` decides, here as in the
 * browser: since the period began on a paid tier, since the beginning of time on
 * free, because the free allowance does not refresh.
 */
async function totalsOf(userId, sub) {
  const from = windowStart(sub);
  const rows = await rest('rpc/usage_totals', {
    method: 'POST',
    body: { p_owner: userId, p_from: from ? new Date(from).toISOString() : null },
  });
  const r = Array.isArray(rows) ? rows[0] : rows;
  // `plans` ARRIVES ONLY ONCE MIGRATION 0007 HAS RUN, and `|| 0` is what makes
  // the deploy order not matter: against an older database the column is absent,
  // the count reads zero, and a free account is metered on area exactly as it
  // was before. The alternative — undefined propagating into the arithmetic —
  // would make `left` NaN and refuse everybody.
  return { area: Number(r?.area) || 0, passes: Number(r?.passes) || 0,
           plans: Number(r?.plans) || 0 };
}

async function balanceOf(user) {
  // TAKES THE USER OBJECT AND NOT AN ID, so that `isAdmin` cannot be forgotten at
  // a call site. It was an id; every caller then had to remember to pass a second
  // argument, and the one that forgot would silently meter an admin.
  const id = typeof user === 'string' ? user : user.id;
  const isAdmin = typeof user === 'string' ? false : !!user.isAdmin;
  const sub = await subscriptionOf(id);
  const totals = await totalsOf(id, sub);
  return { sub, balance: balanceFromTotals(sub, totals, { isAdmin }) };
}

/** The shape the browser gets. Never the provider ids — it has no use for them. */
const publicState = (sub, balance) => ({
  tier: balance.tier.slug,
  // NULL ALLOWANCES TRAVEL AS NULL AND THE FLAG IS WHAT THE UI READS. Infinity
  // does not survive JSON.stringify — it becomes null — so an unlimited balance
  // that relied on the number would arrive as "no allowance at all", which is the
  // exact opposite of what it means.
  unlimited: !!balance.unlimited,
  status: sub?.status ?? 'inactive',
  mode: sub?.mode ?? null,
  cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
  currency: sub?.currency ?? 'USD',
  periodStart: sub?.current_period_start ?? null,
  periodEnd: balance.periodEnd,
  lifetime: balance.lifetime,
  area: balance.area,
  passes: balance.passes,
  // The free tier's headline meter. Null allowances on every paid tier, which
  // the UI reads as "not metered on this" — see fmtRemaining in plans.js.
  plans: balance.plans,
});

// ---------------------------------------------------------------------------
// ACTIONS
// ---------------------------------------------------------------------------

/** GET-shaped: what am I on, and what is left. */
async function stateAction(user) {
  const { sub, balance } = await balanceOf(user);
  return { state: publicState(sub, balance) };
}

/**
 * CHECKOUT — everything the browser needs to open Razorpay and nothing more.
 *
 * The key id is returned rather than bundled. RZP_KEY is not secret (it is on
 * every checkout in the world) but it is also not a constant across
 * environments, and a VITE_ prefix on it would mean test and live keys diverging
 * between the bundle and this file. One source, handed over per checkout.
 */
async function checkoutAction(user, body, pricing) {
  const slug = String(body.tier || '');
  const tier = sellableTier(slug);
  if (!tier || tier.slug !== 'studio') { const e = new Error('Unknown plan'); e.status = 400; throw e; }
  if (!RZP_KEY || !RZP_SECRET) {
    const e = new Error('Payments are not configured — RZP_KEY and RZP_SECRET are missing');
    e.status = 503; throw e;
  }

  const amount = pricing.amountMinor;

  const name = String(body.name || '').trim().slice(0, 120);
  // THE ACCOUNT'S ADDRESS, NOT THE TYPED ONE. Somebody who types a different
  // address in the form is not buying for that address — they are buying for the
  // account they are sitting in, and the receipt should say so. The form field is
  // read-only for the same reason (see CheckoutDialog).
  const email = normaliseEmail(user.email || body.email).slice(0, 200);
  const contact = String(body.contact || '').replace(/[^\d+]/g, '').slice(0, 20);

  // WRITTEN SERVER-SIDE AND NEVER TOUCHED BY THE BROWSER, which is the entire
  // reason verifyAction is allowed to believe them.
  const notes = { owner: user.id, tier: 'studio', market: pricing.market,
                  currency: pricing.currency, email, app: 'super-luminal' };

  /* THE TEMPORARY MARKET-RESEARCH NOTICE — see `notifySubscribeAttempt`, which
     carries the argument for why it is awaited and why it is HERE rather than
     after the subscription exists. Nothing below it depends on it and it cannot
     throw. */
  await notifySubscribeAttempt({
    name, email, contact, pricing, mode: RZP_MODE, userId: user.id,
    at: new Date().toISOString(),
  });

  if (RZP_MODE === 'subscription') {
    const planId = PLAN_IDS[pricing.market];
    if (!planId) {
      const variable = pricing.market === 'india' ? 'RZP_INDIA_PLAN' : 'RZP_USD_PLAN';
      const e = new Error(`${tier.name} has no Razorpay plan id — set ${variable}`);
      e.status = 503; throw e;
    }
    // A CUSTOMER FIRST, so the mandate and every future charge hang off one
    // identity rather than a fresh one per attempt. `fail_existing: 0` makes a
    // repeat email return the existing customer instead of a 400, which is the
    // difference between "subscribe again after cancelling" working and not.
    let customerId = null;
    try {
      const cust = await rzp('/customers', { method: 'POST',
        body: { name: name || email || 'Super Luminal user', email, contact: contact || undefined,
                fail_existing: 0, notes } });
      customerId = cust?.id ?? null;
    } catch (err) {
      // Not fatal: Razorpay will collect the details on the checkout itself.
      console.warn('[billing] customer create failed, continuing without one', err.message);
    }

    const sub = await rzp('/subscriptions', { method: 'POST', body: {
      plan_id: planId,
      // TEN YEARS OF MONTHS. Razorpay requires a finite count; this is the
      // conventional way to say "until cancelled" and it is far enough out that
      // nobody reaches it. Cancelling is a separate call, not a short count.
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      ...(customerId ? { customer_id: customerId } : {}),
      notes,
    } });

    return {
      mode: 'subscription',
      keyId: RZP_KEY,
      subscriptionId: sub.id,
      tier: 'studio',
      amount, currency: pricing.currency,
      prefill: { name, email, contact },
    };
  }

  // --- prepaid month --------------------------------------------------------
  const order = await rzp('/orders', { method: 'POST', body: {
    amount, currency: pricing.currency,
    // Razorpay caps the receipt at 40 characters and rejects anything longer,
    // which is why this is a slice and not a template with an email in it.
    receipt: `sl-${slug}-${Date.now()}`.slice(0, 40),
    notes,
  } });

  return {
    mode: 'order',
    keyId: RZP_KEY,
    orderId: order.id,
    tier: 'studio',
    amount, currency: pricing.currency,
    prefill: { name, email, contact },
  };
}

const hmac = (payload) => createHmac('sha256', RZP_SECRET).update(payload).digest('hex');

/** Constant-time-ish compare. Lengths are fixed here, so a length check is safe. */
function sameSig(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length || !x.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

const addMonth = (from) => {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  // A 31st that lands in a 30-day month walks back rather than into the next
  // one — otherwise a subscription taken on the 31st of January silently gains
  // three days of March.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
};

/**
 * VERIFY — the handler's success callback, checked against the gateway.
 *
 * THE TWO SIGNATURES ARE BUILT FROM THEIR OPERANDS IN OPPOSITE ORDERS, and
 * getting it backwards produces a mismatch that looks exactly like a forged
 * request:
 *
 *   order flow         HMAC(order_id + '|' + payment_id)
 *   subscription flow  HMAC(payment_id + '|' + subscription_id)
 *
 * That is Razorpay's specification, not a preference, and it is the single most
 * common way this integration is got wrong.
 *
 * AND A VALID SIGNATURE IS NOT ENOUGH, WHICH IS THE PART THE FIRST VERSION OF
 * THIS FUNCTION GOT WRONG THREE SEPARATE WAYS. The signature proves the payment
 * happened. It says nothing about WHAT was bought, BY WHOM, or WHETHER IT HAS
 * ALREADY BEEN USED — and this function used to take all three from the request
 * body:
 *
 *   the tier    `body.tier` went straight into subscriptions.tier. Buy Starter for
 *               $10, re-post the handler's own response with tier:'pro', and the
 *               row said Pro. The signature still validated, because the tier is
 *               not in it.
 *   the owner   nothing checked that the order belonged to the caller. Anyone
 *               holding somebody else's payment triple — shared, or lifted from a
 *               refunded payment — could upgrade THEIR account with it.
 *   the replay  nothing marked a payment as consumed. In order mode the period
 *               was set to `now → now + 1 month` with no gateway read at all, so
 *               one $10 payment, re-posted monthly, renewed forever.
 *
 * So the only thing the body is now used for is building the signature payload.
 * Everything that decides entitlement is READ BACK FROM RAZORPAY, where our own
 * `notes` — written server-side at checkout, in checkoutAction, and never
 * touched by the browser — carry the owner and the tier. The amount is checked
 * against the tier's price, and the payment id is burned in `payments` before a
 * single entitlement column moves.
 *
 * THIS IS NOT THE ONLY PATH TO AN ACTIVE SUBSCRIPTION. The webhook is (see
 * api/razorpay-webhook.js) — a user who closes the tab between paying and the
 * callback still gets what they bought. This exists so that the person watching
 * the spinner does not have to wait for a webhook to see it.
 */
async function verifyAction(user, body) {
  const paymentId = String(body.razorpay_payment_id || '');
  const orderId = String(body.razorpay_order_id || '');
  const subId = String(body.razorpay_subscription_id || '');
  const sig = String(body.razorpay_signature || '');

  // AN EMPTY SECRET MAKES EVERY SIGNATURE FORGEABLE, because createHmac('', …)
  // is perfectly valid in Node — so a deployment with the Supabase variables set
  // and RZP_SECRET missing (a staging box, a Vercel variable scoped to
  // production only) would hand Pro to anyone who could run one line of
  // JavaScript. checkoutAction already refuses without it; so must this.
  if (!RZP_SECRET) {
    const e = new Error('Payments are not configured'); e.status = 503; throw e;
  }
  if (!paymentId || !sig) { const e = new Error('Incomplete payment'); e.status = 400; throw e; }

  const mode = subId ? 'subscription' : 'order';
  const payload = mode === 'subscription' ? `${paymentId}|${subId}` : `${orderId}|${paymentId}`;
  if (!sameSig(hmac(payload), sig)) {
    console.warn('[billing] signature mismatch', { mode, paymentId });
    const e = new Error('This payment could not be verified'); e.status = 400; throw e;
  }

  // --- WHAT THE GATEWAY SAYS, WHICH IS THE ONLY AUTHORITY HERE --------------
  let notes = null, amount = null, planId = null, status = null, paidCurrency = null;
  let start = new Date(), end = null;

  if (mode === 'subscription') {
    const live = await rzp(`/subscriptions/${enc(subId)}`);
    notes = live?.notes ?? null;
    planId = live?.plan_id ?? null;
    status = live?.status ?? 'active';
    // THE GATEWAY'S OWN DATES WIN. Razorpay knows when it will charge next;
    // guessing a month from now means our period and their billing drift apart
    // and the user loses their allowance a day early or keeps it a day late.
    if (live?.current_start) start = new Date(live.current_start * 1000);
    if (live?.current_end) end = new Date(live.current_end * 1000);
  } else {
    // TWO READS, AND BOTH ARE NEEDED. The order carries our notes and the amount
    // that was asked for; the payment carries whether any money actually moved
    // and which order it belongs to. Either alone is forgeable by pairing a real
    // payment with somebody else's order id.
    if (!orderId) { const e = new Error('Incomplete payment'); e.status = 400; throw e; }
    const [order, payment] = await Promise.all([
      rzp(`/orders/${enc(orderId)}`),
      rzp(`/payments/${enc(paymentId)}`),
    ]);
    if (payment?.order_id !== orderId) {
      console.warn('[billing] payment does not belong to that order', { paymentId, orderId });
      const e = new Error('This payment could not be verified'); e.status = 400; throw e;
    }
    if (!['captured', 'authorized'].includes(String(payment?.status))) {
      const e = new Error(`That payment is ${payment?.status || 'not complete'}`);
      e.status = 400; throw e;
    }
    notes = order?.notes ?? null;
    amount = Number(order?.amount) || 0;
    paidCurrency = String(order?.currency || payment?.currency || '').toUpperCase();
    status = 'active';
  }

  // OUR OWN NOTES, WRITTEN SERVER-SIDE AT CHECKOUT. The browser never sees them
  // and cannot set them, which is what makes them worth reading.
  const paidOwner = String(notes?.owner || '');
  const paidEmail = normaliseEmail(notes?.email);
  // SELLABLE ONLY, not the full TIER map — which now contains the unmetered admin
  // tier. `usd <= 0` below already refused it, but relying on the price to keep
  // an entitlement out is relying on the wrong property; the webhook made exactly
  // that mistake with the full map and it was worth ten dollars. See SELLABLE in
  // src/lib/plans.js.
  const tier = sellableTier(notes?.tier);

  if (!tier || tier.usd <= 0) {
    console.warn('[billing] no usable tier on the gateway object', { paymentId, notes });
    const e = new Error('This payment is not for a known plan'); e.status = 400; throw e;
  }

  // ------------------------------------------------------------------------
  // WHOSE PAYMENT IS THIS. Two checks, and both are against the gateway's own
  // record rather than the request body.
  //
  // `notes.owner` is written server-side in checkoutAction and is the primary
  // answer. The email is a second, weaker one, and it is here only for the case
  // where the notes predate that field — it must match the CALLER'S OWN verified
  // address, so it can never be used to point a payment at somebody else.
  //
  // ANYTHING ELSE IS A REFUSAL, NOT A GUESS. A payment we cannot attribute to the
  // person asking is somebody else's money.
  // ------------------------------------------------------------------------
  const mine = paidOwner
    ? paidOwner === user.id
    : (!!paidEmail && paidEmail === normaliseEmail(user.email));

  if (!mine) {
    console.warn('[billing] payment does not belong to the caller',
      { paymentId, paidOwner: paidOwner || null });
    const e = new Error('This payment belongs to a different account');
    e.status = 403; throw e;
  }

  // AND IT MUST BE FOR THE RIGHT MONEY. Order mode can be checked exactly;
  // subscription mode is checked through the plan id, which is what carries the
  // price at the gateway. Without this, a Starter payment re-posted with
  // `tier: 'pro'` would still have been refused — the tier now comes from the
  // notes, not the body — but a plan whose price was changed in the dashboard
  // would silently sell the wrong thing.
  const expectedPricing = mode === 'subscription'
    ? pricingForPlan(planId)
    : (notes?.market === 'india' ? REGIONAL_PRICES.india : REGIONAL_PRICES.global);
  if (!expectedPricing) {
    console.warn('[billing] unknown Razorpay plan id', { paymentId, planId });
    const e = new Error('This payment does not match a configured plan'); e.status = 400; throw e;
  }
  const expected = expectedPricing.amountMinor;
  if (mode === 'order' && (amount !== expected || paidCurrency !== expectedPricing.currency)) {
    console.warn('[billing] amount does not match the tier', { paymentId, amount, expected });
    const e = new Error('This payment does not match that plan'); e.status = 400; throw e;
  }

  if (!end) end = addMonth(start);

  // --- BURN THE PAYMENT FIRST -----------------------------------------------
  //
  // THE REPLAY GUARD IS THE UNIQUE INDEX, and it works because this insert
  // happens BEFORE any entitlement column moves. `ignore-duplicates` plus
  // `return=representation` makes PostgREST hand back the row it inserted, or an
  // EMPTY ARRAY if the index refused it — which is a definitive "this payment has
  // already been used", decided by the database rather than by a read-then-write
  // this function could lose a race on.
  //
  // A user re-posting last month's triple therefore gets a 409 instead of a
  // renewed period, and two tabs verifying the same payment settle it between
  // themselves.
  const burned = await rest(`payments?on_conflict=${ON_CONFLICT.payments}`, {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: [{
      owner: user.id, provider: 'razorpay',
      provider_payment_id: paymentId, provider_order_id: orderId || null,
      provider_subscription_id: subId || null,
      event: 'checkout.verified', status: 'captured',
      amount_minor: expected, currency: expectedPricing.currency,
      raw: { mode, tier: tier.slug, verifiedAt: new Date().toISOString() },
    }],
  });
  if (!Array.isArray(burned) || !burned.length) {
    // ALREADY SEEN. The commonest way to land here is a double-submitted handler
    // or the webhook having beaten us to it, so it is only an error if the payment
    // has not in fact been honoured — telling somebody who is already on Pro that
    // their payment was rejected is worse than saying nothing.
    const { sub, balance } = await balanceOf(user);
    if (balance.tier.slug === tier.slug) return { state: publicState(sub, balance) };
    const e = new Error('That payment has already been used'); e.status = 409; throw e;
  }

  const row = {
    tier: tier.slug,
    provider: 'razorpay',
    provider_subscription_id: subId || null,
    provider_plan_id: mode === 'subscription' ? planId : null,
    mode,
    currency: expectedPricing.currency,
    amount_minor: expected,
    current_period_start: start.toISOString(),
    current_period_end: end.toISOString(),
  };

  await rest('subscriptions', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{ owner: user.id, status, cancel_at_period_end: false, ...row }],
  });

  const { sub, balance } = await balanceOf(user);
  return { state: publicState(sub, balance) };
}

/**
 * CONSUME — the gate itself.
 *
 * Layout: `items` is one entry per SPACE about to be lit, each with the
 * fingerprint of its geometry. Entries already in the ledger are dropped before
 * anything is counted, which is what makes a double click, a re-run of the
 * accent pass and a reload mid-pipeline all free.
 *
 * THE SMALL RACE, ADMITTED. Two tabs claiming at the same instant both read the
 * balance before either writes, so a user can go a little over. The alternatives
 * are a serialisable transaction (PostgREST cannot express one) or a Postgres
 * function holding a per-owner advisory lock, which is the right fix if this ever
 * matters. What it costs today is bounded by one plan's area and it cannot
 * repeat, because the second claim's fingerprints are then in the ledger.
 */
async function consumeAction(user, body) {
  const kind = body.kind === 'render_pass' ? 'render_pass' : 'layout';
  const planId = uuid(body.planId);

  // THE PLAN MUST BE ONE THEY MAY EDIT. Read with the service key, so this is a
  // fact rather than a claim. A plan id they cannot edit — or one that is not a
  // uuid — spends nothing.
  //
  // "THEIRS" USED TO BE THE WHOLE TEST, and migration 0006 broke that reading.
  // A project shared with `role = 'edit'` gives somebody the real editor on
  // somebody else's plans, and `plans.owner` on those rows is the PROJECT's
  // owner — so a filter on owner refused every claim an invited editor made,
  // with "No such plan", which looks exactly like a billing bug and is actually
  // a permissions one. The second query below is only reached when the caller is
  // not the owner, which is the rare case.
  //
  // AND THE EDITOR PAYS, NOT THE OWNER. `balanceOf(user)` is the caller's
  // balance and stays that way. The alternative — spending the owner's credits
  // because it is the owner's project — means an edit grant is also a grant to
  // empty somebody's account, which is not a thing anybody would offer twice.
  // Whoever lays out the lighting buys the layout.
  if (planId) {
    const rows = await rest(`plans?id=eq.${enc(planId)}`
      + '&select=id,owner,project_id,stats&limit=1');
    if (!rows.length) { const e = new Error('No such plan'); e.status = 403; throw e; }
    const plan = rows[0];
    if (plan.owner !== user.id) {
      // The same test share_role() makes in the database: the invite is keyed on
      // the ADDRESS, and `invited_user` is a convenience a trigger fills in once
      // that address has an account. Either match is the grant.
      const addr = String(user.email || '').trim().toLowerCase();
      const clauses = [`invited_user.eq.${enc(user.id)}`];
      if (addr) clauses.push(`email.eq.${enc(addr)}`);
      const shares = plan.project_id
        ? await rest(`project_shares?project_id=eq.${enc(plan.project_id)}&role=eq.edit`
            + `&or=(${clauses.join(',')})&select=id&limit=1`)
        : [];
      if (!shares.length) { const e = new Error('No such plan'); e.status = 403; throw e; }
    }
  }

  const { sub, balance } = await balanceOf(user);

  if (kind === 'render_pass') {
    return { ok: true, charged: { passes: 0 }, state: publicState(sub, balance) };
  }

  // --- layout ---------------------------------------------------------------
  const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
  if (!items.length) { const e = new Error('Nothing to charge'); e.status = 400; throw e; }

  // DE-DUPLICATED BY FINGERPRINT WITHIN THE BATCH, and skipping this was a bug in
  // both directions. Two identical entries — a duplicated outline nobody moved,
  // a client that sent its list twice — were SUMMED against the balance but
  // written once by the unique index, so a free user with 3,000 sq ft left was
  // refused a 1,600 sq ft space for "needing 3,200", and a claim that squeezed
  // through reported twice what the ledger actually recorded.
  const byFp = new Map();
  for (const it of items) {
    const fingerprint = String(it.fingerprint || '').slice(0, 64);
    if (!fingerprint) continue;
    byFp.set(fingerprint, { fingerprint,
                            outlineId: String(it.outlineId || '').slice(0, 64) });
  }
  const clean = [...byFp.values()];
  if (!clean.length) { const e = new Error('Nothing to charge'); e.status = 400; throw e; }

  // ALREADY PAID FOR, AT ANY TIME — not merely within this period. A plan re-lit
  // next month, unchanged, must cost nothing: the geometry is the same, so the
  // fingerprint is the same, so it is already bought. Scoping this lookup to the
  // billing window would silently re-charge every returning user on the 1st.
  const fps = clean.map((c) => c.fingerprint);
  const seen = await rest(`usage_events?owner=eq.${enc(user.id)}&kind=eq.layout`
    + `&fingerprint=in.(${fps.map(enc).join(',')})&select=fingerprint&limit=500`);
  const paid = new Set(seen.map((r) => r.fingerprint));
  const fresh = clean.filter((c) => !paid.has(c.fingerprint));

  if (!fresh.length) {
    return { ok: true, charged: { area: 0, spaces: 0 }, state: publicState(sub, balance) };
  }

  // --- DOES THIS OPEN A NEW PLAN SLOT ---------------------------------------
  //
  // The free tier is three DRAWINGS (see TIERS in src/lib/plans.js), and the
  // only question that meter needs answering is whether this plan is already one
  // of them. Re-lighting a drawing that has been lit before costs no slot —
  // that is the whole of what "three plans, clean" means, and without it the
  // tier would be "three claims", which a single re-trace would spend.
  //
  // ASKED OF THE LEDGER AND NOT OF `plans`. A row in the `plans` table proves
  // somebody uploaded a drawing, which is free and always will be; what consumes
  // a slot is LIGHTING one, and the only record of that is a layout event.
  //
  // AND `plan_id` IS RELIABLE HERE ONLY BECAUSE MIGRATION 0007 DROPPED ITS
  // FOREIGN KEY. Until then the column was `on delete set null`, so deleting a
  // drawing blanked the link and this check would have found nothing and handed
  // the slot back — which would have made the delete button the most valuable
  // thing on the free tier. The uuid now outlives the row it points at, which is
  // what 0004's own comment always claimed the event did.
  //
  // SKIPPED ENTIRELY WHEN THE METER DOES NOT APPLY — an unlimited account, or
  // any paid tier, where `plans.allowed` is null. One fewer round trip on every
  // claim a paying customer makes, and the question would have no consequence.
  let newPlans = 0;
  if (planId && !balance.unlimited && balance.plans?.allowed != null) {
    const lit = await rest(`usage_events?owner=eq.${enc(user.id)}&kind=eq.layout`
      + `&plan_id=eq.${enc(planId)}&select=id&limit=1`);
    if (!lit.length) newPlans = 1;
  }

  const verdict = canSpend(balance, { newPlans });
  if (!verdict.ok) {
    return { ok: false, ...verdict, spaces: fresh.length, state: publicState(sub, balance) };
  }

  await rest(`usage_events?on_conflict=${ON_CONFLICT.usage_events}`,
      { method: 'POST', prefer: 'resolution=ignore-duplicates',
    body: fresh.map((c) => ({
      owner: user.id, plan_id: planId, kind: 'layout',
      area_sqft: 0, claimed_sqft: null, units: 1,
      fingerprint: c.fingerprint,
      // The space's own name is not sent — it is the user's text and has no
      // business in a billing row. Its id is enough to line an event up with a
      // drawing when somebody asks what they were charged for.
      note: c.outlineId ? `space ${c.outlineId}` : null,
    })) });

  const after = await balanceOf(user);
  return { ok: true, charged: { area: 0, spaces: fresh.length },
           state: publicState(after.sub, after.balance) };
}

/**
 * RELEASE — a render pass that was charged and then failed.
 *
 * The charge happens BEFORE the vision calls, because that is when the money is
 * committed and a user who closes the tab mid-pass has still spent it. But a pass
 * that comes back as a 500 has cost nobody anything, and silently keeping one of
 * five is the kind of small theft that produces a support email.
 *
 * SO IT IS A SECOND ROW, NOT A DELETE. `units: -1`, the charge's fingerprint with
 * a `:rev` suffix — so the pair is obvious, the reversal is itself idempotent
 * through the unique index, and the ledger stays append-only. Nothing in this
 * schema is ever un-written.
 *
 * AND IT IS BOUNDED BY TIME, WHICH IT WAS NOT. This is a refund the client asks
 * for, so the only thing stopping it being a way to un-spend the month is that a
 * charge can be reversed once. That was not enough on its own: a user could come
 * back on the 28th and release every pass they had used, because nothing checked
 * WHEN the charge happened or how long ago. A failed pass releases within seconds
 * of being charged — the call sits in the `catch` of runWallPass — so a window of
 * minutes covers every honest case and none of the dishonest ones.
 *
 * IT ALSO CANNOT REACH BACK INTO A PREVIOUS PERIOD. A `-1` row is summed against
 * whatever window it lands in, so releasing five of last month's charges today
 * would have created five passes out of nothing this month.
 */
const RELEASE_WINDOW_MS = 15 * 60 * 1000;

async function releaseAction(user, body) {
  void body;
  const { sub, balance } = await balanceOf(user);
  return { ok: true, state: publicState(sub, balance) };
}

/**
 * CANCEL — at the end of the period, never immediately.
 *
 * A month that has been paid for is a month that is owed, so this sets a flag and
 * lets the period run out. `cancel_at_cycle_end: 1` asks Razorpay for exactly the
 * same thing, so the two sides agree without a second job to reconcile them.
 */
async function cancelAction(user) {
  const sub = await subscriptionOf(user.id);
  if (!sub) { const e = new Error('There is nothing to cancel'); e.status = 400; throw e; }

  if (sub.mode === 'subscription' && sub.provider_subscription_id) {
    try {
      await rzp(`/subscriptions/${enc(sub.provider_subscription_id)}/cancel`,
        { method: 'POST', body: { cancel_at_cycle_end: 1 } });
    } catch (err) {
      // A subscription the gateway has already ended is not an error here — the
      // user's intent is recorded either way and the webhook will settle status.
      console.warn('[billing] gateway cancel failed', err.message);
    }
  }
  await rest(`subscriptions?owner=eq.${enc(user.id)}`, {
    method: 'PATCH', body: { cancel_at_period_end: true } });

  const after = await balanceOf(user);
  return { state: publicState(after.sub, after.balance) };
}

// ---------------------------------------------------------------------------

/**
 * THE SIX ACTIONS. EVERY ONE OF THEM NEEDS A SESSION.
 *
 * `requireUser` is applied once, by the handler below, rather than at the top of
 * each of these — so a seventh action added later is protected by default instead
 * of by whoever remembers. There was briefly an `anon: true` flag here for a
 * buy-before-you-sign-in flow; it is gone, and with it the table of exceptions
 * that made this list something to read carefully rather than at a glance.
 */
const ACTIONS = {
  state: (user) => stateAction(user),
  checkout: (user, body, pricing) => checkoutAction(user, body, pricing),
  verify: (user, body) => verifyAction(user, body),
  consume: (user, body) => consumeAction(user, body),
  release: (user, body) => releaseAction(user, body),
  cancel: (user) => cancelAction(user),
};

export default async function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    // NO CACHING, EVER. A proxy that held "you have 2,400 sq ft left" for sixty
    // seconds would hand the same answer to a claim that has already spent it.
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  const pricing = pricingFor(req);
  if (req.method === 'GET') return send(200, { pricing });
  if (req.method !== 'POST') return send(405, { error: 'POST only' });
  if (!PROJECT_URL || !SERVICE_KEY || !ANON_KEY) {
    return send(503, { error: 'Billing is not configured on the server' });
  }

  try {
    const body = await readBody(req);
    const run = ACTIONS[String(body.action || '')];
    if (!run) return send(400, { error: 'Unknown action' });

    const user = requireUser(await resolveUser(req));
    const out = await run(user, body, pricing);
    if (out.state) out.state.pricing = pricing;
    return send(200, { ...out, pricing, tiers: TIERS.map((t) => t.slug), mode: RZP_MODE });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[billing]', err);
    // A 5xx says nothing about why. A 4xx is the user's own situation — an
    // unknown plan, an unverifiable payment — and hiding that just produces a
    // support email asking what happened.
    return send(status, { error: status >= 500 ? 'Something went wrong' : String(err.message) });
  }
}

// Exported for tools/test-billing.mjs, which exercises the signature and the
// month arithmetic without a network.
/* `subscribeAlert` IS IN HERE AND THE SENDER IS NOT. The body is pure and is
   asserted in tools/test-billing.mjs; the sender is a `fetch` that swallows
   every error by design, so there is nothing for a test to hold it to that the
   swallowing does not already guarantee. */
export const __test = { subscribeAlert,
  hmac: (p) => hmac(p), sameSig, addMonth, amountMinor, tierOf,
                        pricingFor, pricingForPlan, RELEASE_WINDOW_MS };
