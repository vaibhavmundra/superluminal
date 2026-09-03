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
 * `area` is in square feet, `renderPasses` is a count, and `plans` is a count of
 * DRAWINGS — null on every paid tier, which is what "no cap" means. `lifetime:
 * true` on free is the whole difference between the free tier and a cheap one:
 * it does not refresh, ever, so free is a trial with a drawing at the end of it
 * rather than a small monthly allowance somebody can live inside forever.
 *
 * `usd` is the headline price and the amount Razorpay is asked for is
 * `usd * 100` in the account's currency — see tools/razorpay-plans.mjs, which
 * is where a rupee price is set if the account cannot take dollars.
 *
 * --- WHY FREE IS METERED TWICE, AND ONLY FREE ----------------------------
 *
 * It used to be 3,000 sq ft and nothing else, and that is a promise nobody can
 * hold in their head. "You have 3,000 square feet" means nothing to somebody who
 * has not yet measured their drawing; they find out what it bought when the
 * server refuses the fourth room of the first flat, which is the worst possible
 * moment to learn the shape of a free tier.
 *
 * THREE FLOOR PLANS IS A PROMISE SOMEBODY CAN CHECK. It is countable before you
 * start, it maps onto the thing the app is actually for, and it survives being
 * repeated back — "I got three plans" is either true or it is a bug.
 *
 * SO THE AREA CEILING BECOMES A BACKSTOP RATHER THAN THE HEADLINE, and it is set
 * where it stops the case the plan count cannot: three plans is generous for
 * three flats and absurd for three hotel floors, so 15,000 sq ft is the line
 * past which "three plans" was never the offer being made. It is deliberately
 * high enough that an ordinary residential user never meets it — three 1,200 sq
 * ft flats is 3,600 — and low enough that the tier cannot be used to light a
 * tower for nothing.
 *
 * BOTH GATES ARE ENFORCED SERVER-SIDE and both refuse the same way. The count is
 * what the UI promises; the area is what protects it. Neither is checked in the
 * browser for anything but drawing a number — see the header of api/billing.js.
 */
export const TIERS = [
  {
    slug: 'free',
    name: 'Free',
    blurb: 'Three floor plans, lit and exported, at no cost.',
    usd: 0,
    lifetime: true,
    // THE HEADLINE. See above: countable before you start, and the number the
    // pricing page, the paywall and the profile menu all print.
    plans: 3,
    // THE BACKSTOP. Not advertised, because a second number on a free tier is a
    // second thing to explain and nobody who is meant to be on this tier will
    // ever meet it. It is stated plainly the moment it refuses, which is the
    // only moment it is worth knowing.
    area: 15000,
    renderPasses: 0,
    lines: [
      'Three floor plans, lit end to end',
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
    // NULL, NOT A BIG NUMBER. A paid tier is metered on area and on nothing
    // else; a cap of 999 would be a cap, and the first person to hit it would be
    // right to be annoyed. See balanceFromTotals, which reads null as "no cap".
    plans: null,
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
    plans: null,
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
 * being adjusted, and a three-drawing cap on that work means the person
 * debugging the accent pass runs out of allowance before lunch.
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
  plans: null,
  area: Infinity,
  renderPasses: Infinity,
  lines: ['Every feature', 'No plan limit', 'No area limit', 'No render-pass limit'],
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
  // DISTINCT DRAWINGS THAT HAVE BEEN LIT, which is the free tier's other meter.
  //
  // THIS COUNT IS ONLY HONEST BECAUSE MIGRATION 0007 DROPPED THE FOREIGN KEY ON
  // `plan_id`. It used to be `on delete set null`, so deleting a plan blanked the
  // link — and a count over a blanked column hands the slot back, which turns
  // "three plans" into "three at a time" and then into no limit at all for
  // anybody willing to press Delete between uploads. The uuid now stays put,
  // which is the same rule 0004 already applies to the square feet: the models
  // ran, the layout was drawn, and removing the drawing afterwards does not
  // un-run them.
  const seen = new Set();
  for (const ev of events) {
    if (!inWindow(ev, from)) continue;
    if (ev.kind === 'layout') {
      area += Number(ev.area_sqft) || 0;
      if (ev.plan_id) seen.add(ev.plan_id);
    } else if (ev.kind === 'render_pass') passes += Number(ev.units) || 0;
  }
  return { area: Math.max(0, area), passes: Math.max(0, passes), plans: seen.size };
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
export function balanceFromTotals(sub, totals = { area: 0, passes: 0, plans: 0 }, opts = {}) {
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
                 passes: Math.max(0, Number(totals.passes) || 0),
                 plans: Math.max(0, Number(totals.plans) || 0) };

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
      plans: { allowed: null, used: used.plans, left: null },
      periodEnd: null,
      lifetime: false,
    };
  }

  // A NULL CAP TRAVELS AS A NULL ALLOWANCE, exactly as an unlimited account's
  // does — same shape, same rendering, and `canSpend` reads the same `=== null`
  // for both. A paid tier is metered on area alone, and the alternative (a
  // `plans` key that is present on free and missing on Starter) would mean every
  // reader needing to know which tier it was looking at before it could format a
  // number.
  const planCap = Number.isFinite(tier.plans) ? tier.plans : null;

  return {
    tier,
    used,
    unlimited: false,
    area: { allowed: tier.area, used: used.area, left: Math.max(0, tier.area - used.area) },
    passes: { allowed: tier.renderPasses, used: used.passes,
              left: Math.max(0, tier.renderPasses - used.passes) },
    plans: { allowed: planCap, used: used.plans,
             left: planCap === null ? null : Math.max(0, planCap - used.plans) },
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
export function canSpend(balance, { area = 0, passes = 0, newPlans = 0 } = {}) {
  // BEFORE ANYTHING IS COMPARED. An unlimited balance carries null allowances, and
  // `null < 500` is false in JavaScript — so this would happen to work by
  // accident, which is the worst reason for it to work. Stated, it is a rule.
  if (balance.unlimited) return { ok: true };

  // THE PLAN COUNT IS CHECKED FIRST, and the order is the message. Somebody who
  // has lit their three free plans and opens a fourth is short of PLANS, not of
  // square feet — and if the area check ran first they would be told "this plan
  // needs 900 sq ft and you have 11,400 left", which is true, unhelpful, and
  // followed immediately by a refusal for a different reason.
  //
  // `newPlans` AND NOT `plans`, because the caller is not asking to spend a plan
  // — it is telling us whether this claim OPENS one. Re-lighting a drawing that
  // is already among the three costs nothing here, which is the whole of what
  // "three plans, clean" means: you keep working on them. Only api/billing.js
  // may answer that question, because only it can see the ledger.
  //
  // `cap.allowed != null` IS LOOSE ON PURPOSE, and it is the only loose equality
  // in this file. It has to catch two different absences with one test: NULL,
  // which every paid tier sends and means "not metered on this", and UNDEFINED,
  // which is what a browser that is one deploy behind the server gets back —
  // `publicState` did not carry a `plans` key before this change. Both mean
  // "there is no plan cap to check", and the strict version would have read the
  // second as a cap of zero and refused every claim on the app's own pricing
  // page. Contrast fmtSqft, where the two absences must NOT be conflated.
  const cap = balance.plans;
  if (newPlans > 0 && cap && cap.allowed != null && cap.left < newPlans) {
    return { ok: false, reason: 'plans', need: newPlans - cap.left,
             want: newPlans, left: cap.left, allowed: cap.allowed };
  }
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

/** "3 floor plans". Null is "no cap", for the same reason fmtSqft treats it so. */
export const fmtPlans = (n, unlimited = 'Unlimited') => (n === null ? unlimited
  : `${Math.round(Number(n) || 0)} floor plan${Math.round(Number(n) || 0) === 1 ? '' : 's'}`);

/**
 * THE ONE NUMBER A TIER IS SOLD ON, and there are two kinds of them now.
 *
 * Free is sold on a COUNT OF DRAWINGS and the paid tiers on AREA — see the note
 * on TIERS for why. This function is where that fork lives, and it exists so
 * that the pricing card, the paywall's card, the checkout summary and the
 * profile menu cannot each pick a different one. Getting it wrong in one of
 * those four is how a user reads "15,000 sq ft" on the card, lights three small
 * flats, and is refused with 11,000 apparently untouched.
 *
 * THE AREA BACKSTOP IS DELIBERATELY NOT IN HERE. It is not what free is being
 * sold on, it is what stops free being abused, and printing both on a card is
 * asking a visitor to reason about two meters before they have uploaded
 * anything. It is said in full at the one moment it matters, which is the
 * refusal — see Paywall.
 */
export const tierHeadline = (tier) => (tier.unlimited ? 'Unlimited'
  : Number.isFinite(tier.plans) ? fmtPlans(tier.plans)
  : fmtSqft(tier.area));

/** "3 floor plans" / "10,000 sq ft · 5 render passes" — an allowance in a line. */
export function fmtAllowance(tier) {
  if (tier.unlimited) return 'Unlimited';
  const bits = [tierHeadline(tier)];
  if (tier.renderPasses) bits.push(`${tier.renderPasses} render pass${tier.renderPasses === 1 ? '' : 'es'}`);
  return bits.join(' · ');
}

/**
 * WHAT IS LEFT, IN THE UNITS THIS ACCOUNT IS METERED IN — "2 of 3 plans left",
 * "7,400 sq ft left", "Unlimited".
 *
 * Takes the live BALANCE rather than the tier, because this is the running
 * figure rather than the offer, and it is what the profile rail and the pricing
 * page's usage strip both print. Same fork as tierHeadline, made once.
 */
export function fmtRemaining(balance) {
  if (!balance || balance.unlimited) return 'Unlimited';
  const p = balance.plans;
  if (p && p.allowed != null) {
    return `${p.left} of ${p.allowed} plan${p.allowed === 1 ? '' : 's'} left`;
  }
  return `${fmtSqft(balance.area?.left ?? 0)} left`;
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
