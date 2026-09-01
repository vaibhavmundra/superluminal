// ---------------------------------------------------------------------------
// THE TIERS, AND THE ARITHMETIC OF WHAT IS LEFT.
//
// One module, imported by the browser AND by api/billing.js, for the reason
// every shared table in this repo is shared: the number on the pricing page and
// the number the server refuses a layout on must be the same number. Two copies
// of "10,000 sq ft" is a support ticket that says "it says I have credit".
//
// WHAT IS METERED, AND WHY IT IS AREA.
//
// The cost of a plan to us and its worth to the person drawing it move together
// with the same quantity: the built area. A 400 sq ft studio and a 40,000 sq ft
// hotel floor are the same number of clicks and two very different jobs, so
// clicks are the wrong meter; seats are worse, because a studio of three shares
// one login and a dealer's showroom has six salesmen who each open the app twice
// a month. Square feet are what the drawing is, what the invoice downstream is
// priced on, and — this is the part that matters — A NUMBER THIS APP ALREADY
// COMPUTES, in the outline phase, before anything is laid out. See
// `planAreaSqft` in App.jsx.
//
// CHARGED PER OUTLINE, NOT PER PLAN, AND THAT IS THE ONE PLACE THIS DEPARTS
// FROM THE OBVIOUS READING OF "a re-lit plan is charged again".
//
// Per plan, the rule punishes exactly the behaviour the app is built to invite:
// the segmenter proposes ten rooms, one of them is wrong, you drag two corners
// and re-light — and you are billed for the whole floor a second time because
// one wall moved a foot. Per outline, the fingerprint is the geometry OF THAT
// SPACE, so the nine rooms nobody touched are already paid for and the tenth is
// charged once. A plan taken back to the outlines and genuinely re-traced still
// costs its area again, because every fingerprint changed — which is the
// intent — and a plan re-lit unchanged costs nothing, because none did.
//
// It is also the only version that is safe to call from three places. Double
// clicks, a re-run of the accent pass, a reload mid-pipeline: all of them
// re-present fingerprints that are already in the ledger, and the unique index
// in migration 0004 turns each into a no-op instead of a second charge.
//
// RENDER PASSES ARE COUNTED, NOT MEASURED, because their cost has nothing to do
// with the size of the room — it is two vision calls whether the wall is nine
// feet or ninety.
// ---------------------------------------------------------------------------

/**
 * THE PRICE LIST.
 *
 * `area` is in square feet and `renderPasses` is a count. `lifetime: true` on
 * free is the whole difference between the free tier and a cheap one: it does
 * not refresh, ever, so 3,000 sq ft is a trial with a drawing at the end of it
 * rather than a small monthly allowance somebody can live inside forever.
 *
 * `usd` is the headline price and the amount Razorpay is asked for is
 * `usd * 100` in the account's currency — see tools/razorpay-plans.mjs, which
 * is where a rupee price is set if the account cannot take dollars.
 */
export const TIERS = [
  {
    slug: 'free',
    name: 'Free',
    blurb: 'Enough to light a flat and take the drawing away.',
    usd: 0,
    lifetime: true,
    area: 3000,
    renderPasses: 0,
    lines: [
      'Room detection, outlines and scale',
      'Ambient grid, accents and task spots',
      'DXF, XLSX, CSV, PDF, JSON, SVG and PNG export',
      'The full BOQ, per room and totalled',
    ],
  },
  {
    slug: 'starter',
    name: 'Starter',
    blurb: 'For one designer, working steadily.',
    usd: 10,
    lifetime: false,
    area: 10000,
    renderPasses: 5,
    lines: [
      'Everything in Free',
      '10,000 sq ft of layout every month',
      'AI Analyse your renders for lighting',
      'Unlimited projects and plans',
    ],
  },
  {
    slug: 'pro',
    name: 'Pro',
    blurb: 'For a practice, or a showroom quoting all day.',
    usd: 30,
    lifetime: false,
    area: 50000,
    renderPasses: 20,
    lines: [
      'Everything in Starter',
      '50,000 sq ft of layout every month',
      'AI Analyse your renders for lighting',
      'Priority on new fixture types',
    ],
  },
];

/**
 * THE OPERATOR'S OWN TIER, AND IT IS NOT IN `TIERS`.
 *
 * Role 1 is an owner of this app rather than a customer of it (see the note in
 * src/lib/auth.jsx), and metering the people tuning the models is metering
 * ourselves: every plan an admin opens is a test, every render pass is a prompt
 * being adjusted, and a 3,000 sq ft ceiling on that work means the person
 * debugging the accent pass runs out of allowance on a Tuesday.
 *
 * DELIBERATELY ABSENT FROM `TIERS`, because `TIERS` is the price list — it is
 * what the pricing page maps over and what the plan-creation script creates
 * plans for. An unsellable tier in there would appear as a fourth card with no
 * price and would have a Razorpay plan created for it.
 *
 * `unlimited: true` IS THE FLAG THAT MATTERS and `area: Infinity` is only there
 * so that any arithmetic which reaches for it gets the right answer. Infinity
 * does not survive JSON — it serialises as null — so nothing on the wire ever
 * carries it: `publicState` sends `unlimited` and a null allowance, and the UI
 * prints a word instead of a number. See canSpend, which short-circuits before
 * either is read.
 */
export const ADMIN = {
  slug: 'admin',
  name: 'Admin',
  blurb: 'Unmetered. Role 1 is an owner of this app, not a customer of it.',
  usd: 0,
  lifetime: false,
  unlimited: true,
  area: Infinity,
  renderPasses: Infinity,
  lines: ['Every feature', 'No area limit', 'No render-pass limit'],
};

/**
 * TWO LOOKUPS, AND CONFUSING THEM WAS A PRIVILEGE ESCALATION.
 *
 * `TIER` includes the admin tier because the UI has to be able to name it — the
 * profile menu prints "Admin · unmetered". `SELLABLE` does not, and it is the one
 * every writer must validate against.
 *
 * ADDING ADMIN TO `TIER` MADE 'admin' A LIVE KEY, and the webhook was validating
 * an incoming tier string with `TIER[x] ? x : null` — out of the PAYMENT entity's
 * `notes`, which is set by the browser at Razorpay's checkout (this app sets one
 * itself, in billing.jsx). So the sequence was: patch the client to send
 * `notes: { tier: 'admin' }`, pay ten dollars for Starter, and the webhook wrote
 * `admin` into `subscriptions.tier` — a text column with no CHECK — where `tierOf`
 * read it back as unmetered. Ten dollars for unlimited, with `profiles.role` never
 * consulted.
 *
 * So: `SELLABLE` for anything arriving from outside, and `tierOf` below reads it
 * too, so that even a row already carrying 'admin' degrades to free. Two
 * independent stops, because the first one is one forgotten call site away from
 * being no stop at all.
 */
export const TIER = Object.fromEntries([...TIERS, ADMIN].map((t) => [t.slug, t]));
export const SELLABLE = Object.fromEntries(TIERS.map((t) => [t.slug, t]));

/**
 * A TIER STRING FROM OUTSIDE, OR NULL. The only way a webhook payload, a
 * gateway note or a stored row should ever become a tier.
 */
export const sellableTier = (slug) => SELLABLE[String(slug ?? '')] ?? null;

export const FREE = TIER.free;
export const PAID = TIERS.filter((t) => t.usd > 0);

/**
 * THE TIER A ROW MEANS — and the reason a missing row is not an error.
 *
 * Nobody is inserted into `subscriptions` at sign-up. A trigger that did it
 * would have to be back-filled for every existing account and would then be the
 * second place that decides what "free" is; absence is a perfectly good way to
 * say "has never paid", it needs no migration to be true of somebody who signed
 * up yesterday, and it cannot drift.
 *
 * THE ENTITLEMENT IS THE PAID PERIOD, NOT THE GATEWAY'S STATUS WORD — and
 * getting that backwards was a bug in the first version of this file worth
 * spelling out, because both directions of it hurt somebody.
 *
 * The first version allowed only `active`, `authenticated` and `trialing`, which
 * meant every other word Razorpay uses took the tier away the instant it
 * arrived. Two of those words are routine and neither means "unpaid":
 *
 *   pending    the RENEWAL failed and is being retried — a bank timeout, an
 *              expired card. The month already paid for is untouched. Treating
 *              it as free put a user who had lit 40,000 sq ft back on a 3,000
 *              sq ft lifetime allowance with 40,000 already spent, so every
 *              space on every drawing was refused, mid-job, over a charge the
 *              gateway had not even given up on.
 *   cancelled  somebody asked not to be charged again. cancelAction promises, in
 *              those words, that "the month you have paid for runs to its end" —
 *              and then the gateway's own cancellation event took it away the
 *              same afternoon. The app was contradicting its own copy.
 *
 * So the rule is the honest one: A PERIOD THAT HAS BEEN PAID FOR IS OWED, and
 * `current_period_end` is the only thing that decides. A status is disqualifying
 * only where it means the money never arrived at all — a subscription created
 * and never authorised. Everything else is settled by the date, which cannot be
 * stale in the dangerous direction: a period we failed to roll forward expires
 * on its own.
 */
export const DEAD_STATUSES = ['created', 'inactive'];

export function tierOf(sub) {
  if (!sub) return FREE;
  // Never paid. Not "stopped paying" — those keep what they bought.
  if (DEAD_STATUSES.includes(sub.status)) return FREE;
  // NO PERIOD IS NO ENTITLEMENT. A row with a tier and no dates is a row written
  // by something that did not finish, and reading it as paid would be reading a
  // half-written record as a receipt.
  if (!sub.current_period_end) return FREE;
  if (Date.parse(sub.current_period_end) < Date.now()) return FREE;
  // SELLABLE, NOT TIER. `admin` is unmetered and is NOT something a subscription
  // row may claim to be — it comes from `profiles.role`, read server-side, and
  // from nowhere else. A row that says 'admin' is a row somebody got in through a
  // writer that forgot to validate, and it degrades to free here rather than
  // paying out. Same for any tier this build has never heard of.
  return sellableTier(sub.tier) ?? FREE;
}

/**
 * WHICH EVENTS COUNT AGAINST THE CURRENT ALLOWANCE.
 *
 * On a paid tier, the ones since the period began: the allowance refreshes, so
 * last month's 9,000 sq ft is history. On free it is every event there has ever
 * been, because the free allowance does not refresh — and that asymmetry is
 * exactly one `if`, which is why it lives here rather than in two call sites
 * that would each get it half right.
 *
 * NOTE THAT THE PERIOD IS THE SUBSCRIPTION'S, NOT THE CALENDAR MONTH. Somebody
 * who subscribes on the 20th gets their refresh on the 20th, which is also when
 * Razorpay charges them. A calendar reset would hand out a free month to
 * everybody who signed up on the 31st.
 */
export function windowStart(sub) {
  const tier = tierOf(sub);
  if (tier.lifetime) return null;                 // null = since the beginning
  return sub?.current_period_start ?? null;
}

const inWindow = (ev, from) => !from || Date.parse(ev.created_at ?? 0) >= Date.parse(from);

/**
 * WHAT HAS BEEN SPENT AND WHAT IS LEFT, from the ledger and nothing else.
 *
 * There is no `area_used` column anywhere in this schema and there must never
 * be one. The moment a running total is stored beside the events it was summed
 * from, there is a version of this app where the two disagree — this repo has
 * been bitten by precisely that once already (`runFt` on an accent zone, see the
 * BOQ section of the README) and the fix was to delete the cached number.
 *
 * `units` is signed so a refund is an event rather than a deletion: a render
 * pass charged and then failed writes -1, the ledger stays append-only, and the
 * history still shows both halves of what happened.
 */
export function usageFrom(sub, events = []) {
  const from = windowStart(sub);
  let area = 0, passes = 0;
  for (const ev of events) {
    if (!inWindow(ev, from)) continue;
    if (ev.kind === 'layout') area += Number(ev.area_sqft) || 0;
    else if (ev.kind === 'render_pass') passes += Number(ev.units) || 0;
  }
  return { area: Math.max(0, area), passes: Math.max(0, passes) };
}

export function balanceFrom(sub, events = [], opts = {}) {
  return balanceFromTotals(sub, usageFrom(sub, events), opts);
}

/**
 * THE SAME BALANCE FROM TOTALS SOMEBODY ELSE ADDED UP.
 *
 * api/billing.js does not sum the ledger in JavaScript, and the reason is a hole
 * the first version had: it read the events with `limit=5000` and no ordering,
 * so an owner with more than five thousand rows had the OLDEST five thousand
 * summed and everything newer was invisible. Twenty-five batches of two hundred
 * tiny claims was enough to reach that, and from then on the meter read about
 * fifty square feet no matter what was actually spent — an unlimited free tier,
 * reachable with a loop.
 *
 * The sum is now one aggregate in Postgres (`usage_totals` in migration 0004),
 * over the index, exact at any size. This function is the same arithmetic as
 * `balanceFrom` with that total handed in, so the two cannot disagree about what
 * a total MEANS.
 */
export function balanceFromTotals(sub, totals = { area: 0, passes: 0 }, opts = {}) {
  // ADMIN OVERRIDES THE ROW, AND IT IS PASSED IN RATHER THAN READ FROM THE SUB.
  //
  // `isAdmin` comes from `profiles.role`, which lives on a different table from
  // `subscriptions` and — this is the part that matters — is read SERVER-SIDE
  // WITH THE SERVICE KEY in api/billing.js, exactly as api/admin.js reads it.
  // Never from a JWT claim, never from `useAuth().isAdmin`, which is a UI
  // convenience anybody can set in a console. This function is pure and simply
  // takes the answer; the one place that answer is established is the one place
  // it can be trusted.
  const tier = opts.isAdmin ? ADMIN : tierOf(sub);
  const used = { area: Math.max(0, Number(totals.area) || 0),
                 passes: Math.max(0, Number(totals.passes) || 0) };

  // NULL, NOT Infinity, AND NOT A BIG NUMBER. Null survives JSON, reads as "no
  // limit" to anything that formats it, and cannot be accidentally compared as
  // though it were a quantity — where a sentinel like MAX_SAFE_INTEGER would
  // quietly render as "9,007,199,254,740,991 sq ft left" the first time somebody
  // forgot to check the flag.
  if (tier.unlimited) {
    return {
      tier,
      used,
      unlimited: true,
      area: { allowed: null, used: used.area, left: null },
      passes: { allowed: null, used: used.passes, left: null },
      periodEnd: null,
      lifetime: false,
    };
  }

  return {
    tier,
    used,
    unlimited: false,
    area: { allowed: tier.area, used: used.area, left: Math.max(0, tier.area - used.area) },
    passes: { allowed: tier.renderPasses, used: used.passes,
              left: Math.max(0, tier.renderPasses - used.passes) },
    periodEnd: tier.lifetime ? null : (sub?.current_period_end ?? null),
    lifetime: !!tier.lifetime,
  };
}

/**
 * MAY THIS BE LIT — the whole gate, in one function, on both sides of the wire.
 *
 * ALL OR NOTHING, AND DELIBERATELY SO. 400 sq ft of allowance against a 2,000
 * sq ft claim is a refusal, not a partial layout: there is no such thing as
 * lighting a third of a room, and a half-drawn ceiling somebody has to notice is
 * worse than a clear "you need 1,600 more".
 */
export function canSpend(balance, { area = 0, passes = 0 } = {}) {
  // BEFORE ANYTHING IS COMPARED. An unlimited balance carries null allowances, and
  // `null < 500` is false in JavaScript — so this would happen to work by
  // accident, which is the worst reason for it to work. Stated, it is a rule.
  if (balance.unlimited) return { ok: true };
  if (area > 0 && balance.area.left < area) {
    return { ok: false, reason: 'area', need: Math.ceil(area - balance.area.left),
             want: Math.ceil(area), left: Math.floor(balance.area.left) };
  }
  if (passes > 0 && balance.passes.left < passes) {
    return { ok: false, reason: 'passes', need: passes - balance.passes.left,
             want: passes, left: balance.passes.left };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// FINGERPRINTS
// ---------------------------------------------------------------------------

/**
 * A 64-BIT-ISH HASH, SYNCHRONOUS AND PURE.
 *
 * Not crypto.subtle, which is async and would make the fingerprint of an outline
 * a promise — and the call site is inside a click handler that already has four
 * awaits in it. Not a real cryptographic hash either, because this is an
 * IDEMPOTENCY KEY and not a secret: it decides whether two charge attempts are
 * the same charge attempt. Two independent 32-bit FNV-1a walks over the same
 * string, at different offset bases, concatenated — collisions matter only
 * within one owner's own ledger, and at that scale this is far more than enough.
 */
export function hash64(s) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = (a ^ c) >>> 0; a = (a * 0x01000193) >>> 0;
    b = (b + c) >>> 0; b = (b ^ (b << 5)) >>> 0; b = (b * 0x85ebca6b) >>> 0;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * THE FINGERPRINT OF ONE SPACE, AS IT IS ABOUT TO BE LIT.
 *
 * Four things go in, and each of them is in because changing it changes what is
 * being bought:
 *
 *   planId   — the same room traced in two drawings is two jobs.
 *   points   — the geometry. Nudge a corner and this is a different space.
 *   pxPerFt  — the scale. Same polygon, different building, different area.
 *   sqft     — rounded, so a scale change too small to move the area does not
 *              mint a new charge on floating-point noise alone.
 *
 * ROUNDED TO A TENTH OF A UNIT before hashing, because a drag is a stream of
 * sub-pixel values and an outline nobody meant to touch must not re-charge
 * because a pointermove landed on it. A tenth of a drawing unit is far below
 * anything that moves a wall.
 */
export function fingerprintOutline({ planId, points = [], pxPerFt = null, sqft = 0 }) {
  const geo = points.map((p) => `${round1(p.x)},${round1(p.y)}`).join(';');
  return hash64(`${planId ?? 'no-plan'}|${geo}|${round1(pxPerFt ?? 0)}|${Math.round(sqft)}`);
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** A render pass is charged per run, so its key is the run and not the room. */
export function fingerprintPass({ planId, roomId, runId }) {
  return hash64(`pass|${planId ?? 'no-plan'}|${roomId ?? 'no-room'}|${runId}`);
}

// ---------------------------------------------------------------------------
// FORMATTING — here because the pricing page, the paywall, the profile menu and
// the API's own refusal messages all print these, and four roundings of the same
// number is how a page ends up saying 9,999 in one place and 10k in another.
// ---------------------------------------------------------------------------

/**
 * NULL IS "UNLIMITED", NOT ZERO — and the distinction is the whole reason this
 * takes a second argument. An admin's remaining balance is null, and a screen
 * that printed "0 sq ft left" for the one account that can never run out would be
 * the most confusing possible reading of it.
 *
 * STRICTLY `=== null`, AND NOT `== null`. Undefined is a MISSING number — a field
 * that was not sent, a shape that changed — and it must read as zero, because the
 * failure directions are not symmetrical: an unlimited account shown a number is
 * a cosmetic bug, and a metered account shown "Unlimited" is a promise the server
 * will refuse to keep on the next claim.
 */
export const fmtSqft = (n, unlimited = 'Unlimited') => (n === null ? unlimited
  : `${Math.round(Number(n) || 0).toLocaleString('en-IN')} sq ft`);

export const fmtUsd = (n) => (Number(n) === 0 ? 'Free' : `$${Number(n)}`);

/** "10,000 sq ft · 5 render passes" — the one-line shape of an allowance. */
export function fmtAllowance(tier) {
  if (tier.unlimited) return 'Unlimited';
  const bits = [fmtSqft(tier.area)];
  if (tier.renderPasses) bits.push(`${tier.renderPasses} render pass${tier.renderPasses === 1 ? '' : 'es'}`);
  return bits.join(' · ');
}

/** The sane bounds of a single claim. Anything outside is a bug or a forgery. */
export const MAX_CLAIM_SQFT = 500000;

/**
 * AND THE FLOOR, WHICH EXISTS TO STOP THE LEDGER BEING USED AS A HAMMER.
 *
 * A claim of 0.01 sq ft is not a space. It is one row in an append-only table,
 * and two hundred of them per request was the cheap half of the overflow
 * described at `balanceFromTotals` — five thousand rows for fifty square feet.
 * The aggregate fixes the arithmetic; this stops the table growing for nothing.
 *
 * ONE SQUARE FOOT IS SAFELY BELOW ANYTHING REAL: rooms.js already discards
 * enclosed areas under 8 sq ft as too small to be a room, so nothing this
 * rejects was ever going to be lit.
 */
export const MIN_CLAIM_SQFT = 1;

/**
 * ONE MAILBOX, ONE SPELLING.
 *
 * The address recorded on a Razorpay order — and compared against the account's
 * own in verifyAction — goes through here first. "Savitri@Studio.com " and
 * "savitri@studio.com" are one mailbox, and a comparison that misses on case or a
 * trailing space is a payment refused as belonging to somebody else.
 *
 * It lives here, in the module the browser and the API already share, so that
 * both sides normalise identically rather than nearly identically.
 */
export const normaliseEmail = (e) => String(e ?? '').trim().toLowerCase();
