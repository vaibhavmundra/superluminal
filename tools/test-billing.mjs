// tools/test-billing.mjs — the till, which is the one part of this app where a
// bug is somebody else's money.
//
// WHAT THIS IS GUARDING, in the order the failures would hurt:
//
//   a lapsed subscription must read as free   — otherwise a halted card keeps
//                                               getting 50,000 sq ft a month
//   a live one must not read as free          — the mirror, and the one that
//                                               produces an angry email
//   the window must be the SUBSCRIPTION's     — a calendar reset hands a free
//                                               month to everybody who signed
//                                               up on the 31st
//   a fingerprint must be stable              — an outline nobody touched that
//                                               re-fingerprints is a silent
//                                               double charge on every re-light
//   ...and must move when the shape does      — or a re-traced plan is free
//   the two signatures are built in OPPOSITE  — the single most common way a
//   operand orders                              Razorpay integration is wrong
//   Jan 31 + 1 month must not reach March     — three free days a year, and a
//                                               period boundary that drifts
//
// No network. Everything here is pure, which is why plans.js is pure.

// SET BEFORE THE IMPORT. api/billing.js reads its configuration at module load
// — which is correct for a serverless function that is instantiated per cold
// start, and means a test that sets these afterwards is testing the defaults.
process.env.RZP_SECRET = 'test_secret_do_not_use';
process.env.RZP_KEY = 'rzp_test_key';
process.env.RZP_CURRENCY = 'USD';

const { TIER, TIERS, ADMIN, tierOf, sellableTier, windowStart, usageFrom, balanceFrom, balanceFromTotals,
        canSpend, fingerprintOutline, fingerprintPass, hash64, fmtSqft, fmtAllowance,
        fmtPlans, tierHeadline, fmtRemaining,
        normaliseEmail, MAX_CLAIM_SQFT, MIN_CLAIM_SQFT } = await import('../src/lib/plans.js');
const { __test: bill } = await import('../api/billing.js');
const { __test: hook } = await import('../api/razorpay-webhook.js');
const { createHmac } = await import('node:crypto');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (s) => console.log('\n' + s);

const iso = (d) => new Date(d).toISOString();
const DAY = 86400000;
const now = Date.now();

const subAt = (over = {}) => ({
  tier: 'pro', status: 'active', mode: 'subscription',
  current_period_start: iso(now - 5 * DAY),
  current_period_end: iso(now + 25 * DAY),
  ...over,
});

const ev = (kind, over = {}) => ({
  kind, created_at: iso(now - DAY),
  area_sqft: kind === 'layout' ? 1000 : null,
  units: 1, ...over,
});

// ---------------------------------------------------------------------------
section('the price list is internally consistent');
{
  ok('three tiers', TIERS.length === 3);
  ok('slugs are unique', new Set(TIERS.map((t) => t.slug)).size === 3);
  ok('free is free', TIER.free.usd === 0);
  ok('free does not refresh', TIER.free.lifetime === true);
  ok('paid tiers refresh', TIERS.filter((t) => t.usd > 0).every((t) => !t.lifetime));
  // A MORE EXPENSIVE TIER THAT BUYS LESS is not a pricing decision, it is a
  // typo, and it would be one nobody notices until a customer does the maths.
  const paid = TIERS.filter((t) => t.usd > 0).sort((a, b) => a.usd - b.usd);
  ok('price and area rise together',
    paid.every((t, i) => i === 0 || (t.area > paid[i - 1].area
      && t.renderPasses >= paid[i - 1].renderPasses)));
  ok('the stated numbers match the spec',
    TIER.free.area === 15000 && TIER.starter.area === 10000 && TIER.pro.area === 50000
    && TIER.starter.usd === 10 && TIER.pro.usd === 30
    && TIER.starter.renderPasses === 5 && TIER.pro.renderPasses === 20);

  // THE FREE TIER IS METERED ON DRAWINGS AND THE PAID ONES ARE NOT, which is
  // the fork every formatter and the whole of canSpend's first branch turn on.
  // `null` and not a large number: a cap of 999 is still a cap.
  ok('free is capped at three floor plans', TIER.free.plans === 3);
  ok('no paid tier caps plans', paid.every((t) => t.plans === null));

  // "EVERY TIER IS BIGGER THAN FREE" WAS ASSERTED HERE AND IS GONE, because it
  // is no longer true and no longer means anything. Free's 15,000 sq ft is a
  // BACKSTOP behind a three-drawing cap, not an allowance — Starter's 10,000 is
  // smaller and buys far more, because it refreshes every month and has no plan
  // limit at all. Comparing the two numbers compares two different kinds of
  // thing. What must hold is that the paid tiers are ordered among THEMSELVES,
  // which the assertion above this block already checks.
  ok('free is a lifetime backstop, not a monthly allowance',
    TIER.free.lifetime === true && paid.every((t) => !t.lifetime));
}

// ---------------------------------------------------------------------------
section('which tier a row means');
{
  ok('no row is free', tierOf(null).slug === 'free');
  ok('an active pro row is pro', tierOf(subAt()).slug === 'pro');
  ok('authenticated counts as live', tierOf(subAt({ status: 'authenticated' })).slug === 'pro');

  // A PAID PERIOD IS OWED, WHATEVER WORD THE GATEWAY IS USING. These four
  // assertions are the ones that changed after the first version of tierOf
  // stranded people: `pending` is a RENEWAL being retried and `cancelled` is a
  // request not to be charged AGAIN — neither un-pays the month in progress.
  ok('pending keeps the month already paid for',
    tierOf(subAt({ status: 'pending' })).slug === 'pro');
  ok('halted keeps the month already paid for',
    tierOf(subAt({ status: 'halted' })).slug === 'pro');
  ok('cancelled keeps the month already paid for',
    tierOf(subAt({ status: 'cancelled' })).slug === 'pro');
  ok('cancel_at_period_end does not downgrade yet',
    tierOf(subAt({ cancel_at_period_end: true })).slug === 'pro');

  // ...AND THE DATE IS WHAT ENDS IT. Every one of those words, once the period
  // has run out, is free — including `active`, because a status is only ever as
  // fresh as the last event that reached us.
  const lapsed = { current_period_end: iso(now - DAY) };
  for (const st of ['active', 'pending', 'halted', 'cancelled', 'completed', 'expired']) {
    ok(`a lapsed period is free (${st})`, tierOf(subAt({ ...lapsed, status: st })).slug === 'free');
  }

  // NEVER PAID AT ALL is the one thing a status still decides on its own: a
  // subscription created and never authorised has no month to owe.
  ok('created is free', tierOf(subAt({ status: 'created' })).slug === 'free');
  ok('inactive is free', tierOf(subAt({ status: 'inactive' })).slug === 'free');
  ok('a row with no period end is free',
    tierOf({ tier: 'pro', status: 'active' }).slug === 'free');

  ok('a tier this build has never heard of is free',
    tierOf(subAt({ tier: 'platinum-hyperscale' })).slug === 'free');

  // THE ESCALATION, AS A TEST. `subscriptions.tier` is plain text with no CHECK,
  // and adding the unmetered admin tier to `TIER` briefly made 'admin' a value
  // the Razorpay webhook would accept out of a payment's notes — which the
  // browser sets. Ten dollars for unlimited. Both stops are asserted: a row that
  // says 'admin' pays out nothing, and 'admin' is not a sellable tier string.
  ok('a subscription row claiming to be admin is free',
    tierOf(subAt({ tier: 'admin' })).slug === 'free');
  ok('...and unmetered with it', !tierOf(subAt({ tier: 'admin' })).unlimited);
  ok('admin is not sellable', sellableTier('admin') === null);
  ok('nor is anything invented', sellableTier('platinum') === null);
  ok('but the real tiers are',
    ['free', 'starter', 'pro'].every((t) => sellableTier(t)?.slug === t));
  ok('a null or absent tier string is not sellable',
    sellableTier(null) === null && sellableTier(undefined) === null);
}

// ---------------------------------------------------------------------------
section('the window, and the free tier that has no window');
{
  ok('free counts from the beginning of time', windowStart(null) === null);
  ok('a lifetime tier ignores the period',
    windowStart({ tier: 'free', status: 'active', current_period_start: iso(now) }) === null);
  const s = subAt();
  ok('a paid tier counts from its own period start',
    windowStart(s) === s.current_period_start);
  // The point of the previous assertion: NOT the 1st of the month.
  ok('and that is not the calendar month',
    new Date(windowStart(s)).getUTCDate() !== 1
    || new Date(s.current_period_start).getUTCDate() === 1);
}

// ---------------------------------------------------------------------------
section('what has been spent');
{
  const s = subAt();
  const events = [
    ev('layout', { area_sqft: 1200 }),
    ev('layout', { area_sqft: 800 }),
    // BEFORE THE PERIOD BEGAN. Last month's spend, which must not count.
    ev('layout', { area_sqft: 9000, created_at: iso(now - 40 * DAY) }),
    ev('render_pass'),
    ev('render_pass'),
    ev('render_pass', { units: -1 }),          // one was refunded
  ];
  const u = usageFrom(s, events);
  ok('only this period is counted', u.area === 2000, `got ${u.area}`);
  ok('a refund nets off', u.passes === 1, `got ${u.passes}`);

  // ON FREE, THE SAME LIST COUNTS ENTIRELY — including the row from 40 days ago,
  // because the free allowance never refreshes. Same events, different answer,
  // and that asymmetry is the whole reason windowStart exists.
  const f = usageFrom(null, events);
  ok('free counts everything, forever', f.area === 11000, `got ${f.area}`);

  const b = balanceFrom(s, events);
  ok('the balance subtracts', b.area.left === TIER.pro.area - 2000);
  ok('passes too', b.passes.left === TIER.pro.renderPasses - 1);
  ok('a period end is reported', b.periodEnd === s.current_period_end);
  ok('free reports no period end', balanceFrom(null, []).periodEnd === null);

  // OVERSPEND CLAMPS AT ZERO rather than going negative. A negative balance
  // printed on a pricing page is a bug report; the small overage the race in
  // consumeAction admits is real and this is where it is absorbed.
  const over = balanceFrom(null, [ev('layout', { area_sqft: 99999 })]);
  ok('the balance never goes negative', over.area.left === 0);

  // THE SERVER'S PATH AND THE PURE PATH MUST AGREE. api/billing.js gets its
  // total from one Postgres aggregate rather than by summing rows here, and two
  // ways of computing the same balance is exactly the sort of pair that drifts.
  const viaTotals = balanceFromTotals(s, { area: 2000, passes: 1 });
  ok('totals and events give the same balance',
    viaTotals.area.left === b.area.left && viaTotals.passes.left === b.passes.left);
  ok('totals clamp a negative to zero',
    balanceFromTotals(s, { area: -5, passes: -2 }).area.used === 0);
  ok('missing totals read as nothing spent',
    balanceFromTotals(s, {}).area.used === 0);
}

// ---------------------------------------------------------------------------
section('may this be lit');
{
  // FREE, WITH 14,400 OF ITS 15,000 SQ FT BACKSTOP SPENT ACROSS ONE DRAWING.
  const b = balanceFromTotals(null, { area: 14400, passes: 0, plans: 1 });
  ok('600 left covers 500', canSpend(b, { area: 500 }).ok);

  // ALL OR NOTHING. There is no such thing as lighting a third of a room.
  const no = canSpend(b, { area: 2000 });
  ok('600 left refuses 2000', no.ok === false);
  ok('and says by how much', no.need === 1400, `got ${no.need}`);
  ok('and what was asked for', no.want === 2000);
  ok('and what is left', no.left === 600);
  ok('the reason is the area', no.reason === 'area');

  ok('exactly enough is enough', canSpend(b, { area: 600 }).ok);
  ok('one square foot too many is not', canSpend(b, { area: 601 }).ok === false);

  const nopass = canSpend(b, { passes: 1 });
  ok('free has no render passes', nopass.ok === false && nopass.reason === 'passes');

  const pro = balanceFrom(subAt(), []);
  ok('pro has passes', canSpend(pro, { passes: 20 }).ok);
  ok('but not twenty-one', canSpend(pro, { passes: 21 }).ok === false);

  ok('asking for nothing is allowed', canSpend(b, {}).ok);
}

// ---------------------------------------------------------------------------
section('three floor plans, and the fourth is not one');
{
  // THE HEADLINE METER. Free is sold as three DRAWINGS; the area is a backstop
  // behind it. These are the assertions that stop the two being confused.
  const two = balanceFromTotals(null, { area: 2400, passes: 0, plans: 2 });
  ok('two lit leaves one', two.plans.left === 1 && two.plans.allowed === 3);
  ok('a third drawing is allowed', canSpend(two, { area: 900, newPlans: 1 }).ok);

  const three = balanceFromTotals(null, { area: 3600, passes: 0, plans: 3 });
  ok('three lit leaves none', three.plans.left === 0);

  // THE WHOLE POINT OF "CLEAN": the three you have are not frozen. Re-lighting
  // one of them is `newPlans: 0` and must cost nothing, or the tier is really
  // "three claims" and a single re-trace spends one.
  ok('re-lighting one of the three is still free',
    canSpend(three, { area: 900, newPlans: 0 }).ok);

  const fourth = canSpend(three, { area: 900, newPlans: 1 });
  ok('but a fourth drawing is refused', fourth.ok === false);
  ok('and the reason is the plan count, not the area', fourth.reason === 'plans');
  ok('and it says what the cap was', fourth.allowed === 3 && fourth.left === 0);

  // ORDER MATTERS IN THE REFUSAL. Somebody on their fourth drawing with plenty
  // of square feet left must be told they are out of PLANS. If the area check
  // ran first they would be told "this needs 900 sq ft and you have 11,400
  // left" — true, unhelpful, and followed by a refusal for another reason.
  ok('the plan count is reported before the area',
    canSpend(three, { area: 900, newPlans: 1 }).reason === 'plans');

  // AND THE BACKSTOP STILL BITES INSIDE THE THREE. Three hotel floors is what
  // the 15,000 exists to stop, and it has to refuse even though a slot is free.
  const huge = balanceFromTotals(null, { area: 14000, passes: 0, plans: 2 });
  const over = canSpend(huge, { area: 5000, newPlans: 1 });
  ok('a third drawing that busts the backstop is refused', over.ok === false);
  ok('and that refusal is about the area', over.reason === 'area');
  ok('and says the shortfall', over.need === 4000, `got ${over.need}`);

  // NO PAID TIER HAS A PLAN CAP, and `null` must not be compared as a quantity.
  const paid = balanceFromTotals(subAt(), { area: 0, passes: 0, plans: 40 });
  ok('a paid tier reports no plan allowance', paid.plans.allowed === null);
  ok('and no plan remainder either', paid.plans.left === null);
  ok('a fortieth drawing on pro is fine', canSpend(paid, { area: 900, newPlans: 1 }).ok);

  // NOR DOES AN UNMETERED ACCOUNT.
  const admin = balanceFromTotals(null, { area: 9e6, passes: 900, plans: 900 },
                                  { isAdmin: true });
  ok('an admin has no plan cap', admin.plans.allowed === null);
  ok('and is refused nothing', canSpend(admin, { area: 9e9, newPlans: 1 }).ok);

  // THE COUNT COMES OUT OF THE LEDGER BY DISTINCT DRAWING, not by row. Four
  // events across two plans is two plans — this is what makes re-lighting free.
  const events = [
    ev('layout', { area_sqft: 400, plan_id: 'plan-a' }),
    ev('layout', { area_sqft: 500, plan_id: 'plan-a' }),
    ev('layout', { area_sqft: 600, plan_id: 'plan-b' }),
    ev('render_pass', { plan_id: 'plan-c' }),
  ];
  const u = usageFrom(null, events);
  ok('four events across two drawings count as two', u.plans === 2, `got ${u.plans}`);
  ok('a render pass does not open a plan slot', u.plans === 2);

  // A NULL plan_id IS AN EVENT THAT NEVER KNEW ITS DRAWING — a pre-0007 row
  // whose plan was already deleted, or the standalone editor. It counts for area
  // and not for plans, and it must not blow up the Set.
  const orphan = usageFrom(null, [ev('layout', { area_sqft: 700, plan_id: null })]);
  ok('an event with no drawing counts area but no plan',
    orphan.area === 700 && orphan.plans === 0);
}

// ---------------------------------------------------------------------------
section('role 1 is unmetered');
{
  // NOT ON THE PRICE LIST. `TIERS` is what the pricing page maps over and what
  // the plan-creation script creates Razorpay plans for; an unsellable tier in
  // there would become a fourth card and a fourth plan.
  ok('admin is not in TIERS', !TIERS.some((t) => t.slug === 'admin'));
  ok('but is reachable by slug', TIER.admin === ADMIN);
  ok('and is flagged unlimited', ADMIN.unlimited === true);

  const spent = { area: 480000, passes: 300 };
  const b = balanceFromTotals(null, spent, { isAdmin: true });

  ok('the tier is admin whatever the row says', b.tier.slug === 'admin');
  ok('an admin with no subscription row at all is still unmetered',
    balanceFromTotals(null, spent, { isAdmin: true }).unlimited === true);
  ok('...and so is one whose subscription lapsed',
    balanceFromTotals(subAt({ status: 'halted', current_period_end: iso(now - DAY) }),
      spent, { isAdmin: true }).tier.slug === 'admin');

  // THE ALLOWANCES TRAVEL AS NULL. Infinity does not survive JSON.stringify — it
  // becomes null — so anything that relied on the number would arrive meaning the
  // exact opposite. Null is the value, deliberately, on both sides.
  ok('the allowance is null, not Infinity', b.area.allowed === null && b.passes.allowed === null);
  ok('and so is what is left', b.area.left === null && b.passes.left === null);
  ok('null survives a JSON round trip',
    JSON.parse(JSON.stringify(b)).area.left === null);
  ok('Infinity would not have',
    JSON.parse(JSON.stringify({ x: Infinity })).x === null);

  // USAGE IS STILL COUNTED. An unmetered account is not an unrecorded one — the
  // ledger is how the cost of the models is read back.
  ok('spend is still reported', b.used.area === 480000 && b.used.passes === 300);

  ok('nothing is refused', canSpend(b, { area: 9e9 }).ok);
  ok('not even a million render passes', canSpend(b, { passes: 1000000 }).ok);
  ok('and the short-circuit is explicit, not an accident of null comparison',
    canSpend(b, { area: 1 }).ok && b.area.left === null);

  // AND A NON-ADMIN IS UNAFFECTED, which is the assertion that would catch the
  // flag being defaulted the wrong way round.
  const normal = balanceFromTotals(null, { area: 14900, passes: 0, plans: 1 });
  ok('a normal user is still metered', normal.unlimited === false);
  ok('and still refused', canSpend(normal, { area: 500 }).ok === false);
  ok('the flag defaults to off', balanceFromTotals(null, spent).tier.slug === 'free');
  ok('and off is off even when explicitly false',
    balanceFromTotals(null, spent, { isAdmin: false }).unlimited === false);

  ok('an unlimited allowance formats as a word', fmtAllowance(ADMIN) === 'Unlimited');
  ok('and null square feet do too', fmtSqft(null) === 'Unlimited');
  ok('only null, though — undefined is a missing number', fmtSqft(undefined) === '0 sq ft');
  ok('...with the wording overridable', fmtSqft(null, 'No limit') === 'No limit');
  // THE ONE THING THAT MUST NOT REGRESS: zero is still zero. fmtSqft used to
  // return "0 sq ft" for null, and the fix must not have made a genuinely empty
  // balance read as unlimited.
  ok('but zero is still zero, not unlimited', fmtSqft(0) === '0 sq ft');
}

// ---------------------------------------------------------------------------
section('one mailbox, one spelling');
{
  // The address on a Razorpay order is compared against the account's own in
  // verifyAction, so a comparison that misses on case or a trailing space is a
  // payment refused as belonging to somebody else.
  ok('lower-cased', normaliseEmail('Savitri@Studio.com') === 'savitri@studio.com');
  ok('trimmed', normaliseEmail('  a@b.co  ') === 'a@b.co');
  ok('both at once', normaliseEmail('  SAVITRI@Studio.COM ') === 'savitri@studio.com');
  ok('null is an empty string, not "null"', normaliseEmail(null) === '');
  ok('undefined too', normaliseEmail(undefined) === '');
  ok('and it is idempotent',
    normaliseEmail(normaliseEmail(' X@Y.Z ')) === normaliseEmail(' X@Y.Z '));
}

// ---------------------------------------------------------------------------
section('fingerprints — the difference between one charge and two');
{
  const pts = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 0, y: 100 }];
  const base = { planId: 'plan-a', points: pts, pxPerFt: 12, sqft: 833 };
  const fp = fingerprintOutline(base);

  ok('a fingerprint is 16 hex characters', /^[0-9a-f]{16}$/.test(fp), fp);
  ok('the same space fingerprints the same', fingerprintOutline({ ...base }) === fp);

  // THE ASSERTION THAT THE WHOLE PER-OUTLINE SCHEME RESTS ON. If this fails,
  // every re-light charges for every room again.
  ok('a re-light of untouched geometry is the same charge',
    fingerprintOutline({ ...base, points: pts.map((p) => ({ ...p })) }) === fp);

  // AND SUB-0.1 JITTER MUST NOT MINT A NEW CHARGE. A drag is a stream of
  // sub-pixel values and an outline brushed by a pointermove is not a new space.
  ok('floating-point noise is rounded away',
    fingerprintOutline({ ...base,
      points: pts.map((p) => ({ x: p.x + 0.02, y: p.y - 0.03 })) }) === fp);

  ok('a moved corner is a new charge',
    fingerprintOutline({ ...base,
      points: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 100 }, { x: 0, y: 100 }],
      sqft: 972 }) !== fp);
  ok('a changed scale is a new charge',
    fingerprintOutline({ ...base, pxPerFt: 24, sqft: 208 }) !== fp);
  ok('the same room in another drawing is a new charge',
    fingerprintOutline({ ...base, planId: 'plan-b' }) !== fp);
  ok('a different area alone is a new charge',
    fingerprintOutline({ ...base, sqft: 900 }) !== fp);

  // No plan id yet — a drop whose insert has not landed. It must still produce a
  // usable key rather than a crash or an empty string.
  ok('a missing plan id still fingerprints',
    /^[0-9a-f]{16}$/.test(fingerprintOutline({ points: pts, pxPerFt: 12, sqft: 800 })));
  ok('no points still fingerprints', /^[0-9a-f]{16}$/.test(fingerprintOutline({ planId: 'p' })));

  // A RENDER PASS IS KEYED ON THE RUN, so a retry after a failure is a new
  // charge rather than a silently deduplicated no-op.
  const p1 = fingerprintPass({ planId: 'p', roomId: 'r', runId: 'run-1' });
  ok('a pass is keyed on the run',
    p1 !== fingerprintPass({ planId: 'p', roomId: 'r', runId: 'run-2' }));
  ok('and is stable within one run',
    p1 === fingerprintPass({ planId: 'p', roomId: 'r', runId: 'run-1' }));
  ok('and differs per room',
    p1 !== fingerprintPass({ planId: 'p', roomId: 'r2', runId: 'run-1' }));

  // A CHEAP COLLISION SWEEP. Not proof, but a hash that collides on a thousand
  // neighbouring rectangles would be one that silently forgives charges.
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    seen.add(fingerprintOutline({ planId: 'p', pxPerFt: 12, sqft: 100 + i,
      points: [{ x: 0, y: 0 }, { x: i, y: 0 }, { x: i, y: 80 }] }));
  }
  ok('2000 neighbouring spaces do not collide', seen.size === 2000, `got ${seen.size}`);
  ok('hash64 is deterministic', hash64('abc') === hash64('abc'));
  ok('hash64 separates near-identical strings', hash64('abc') !== hash64('abd'));
}

// ---------------------------------------------------------------------------
section('the two Razorpay signatures, and their opposite operand orders');
{
  const SECRET = 'test_secret_do_not_use';
  const sign = (p) => createHmac('sha256', SECRET).update(p).digest('hex');

  const paymentId = 'pay_ABC123';
  const orderId = 'order_XYZ789';
  const subId = 'sub_QRS456';

  // THE SPECIFICATION, RESTATED AS A TEST:
  //   order        HMAC(order_id + '|' + payment_id)
  //   subscription HMAC(payment_id + '|' + subscription_id)
  ok('the order signature is order|payment',
    bill.hmac(`${orderId}|${paymentId}`) === sign(`${orderId}|${paymentId}`));
  ok('the subscription signature is payment|subscription',
    bill.hmac(`${paymentId}|${subId}`) === sign(`${paymentId}|${subId}`));

  // AND THE TWO ARE NOT INTERCHANGEABLE. This is the assertion that catches the
  // classic mistake, which is to reuse one builder for both flows.
  ok('the orders are not interchangeable',
    bill.hmac(`${orderId}|${paymentId}`) !== bill.hmac(`${paymentId}|${orderId}`));

  ok('a matching signature verifies',
    bill.sameSig(sign(`${paymentId}|${subId}`), sign(`${paymentId}|${subId}`)));
  ok('a forged signature does not',
    bill.sameSig(sign(`${paymentId}|${subId}`), sign(`${paymentId}|sub_OTHER`)) === false);
  ok('an empty signature does not', bill.sameSig(sign('x'), '') === false);
  ok('a truncated signature does not',
    bill.sameSig(sign('x'), sign('x').slice(0, 40)) === false);
  ok('null does not', bill.sameSig(null, null) === false);
}

// ---------------------------------------------------------------------------
section('the webhook signature');
{
  process.env.RZP_WEBHOOK_SECRET = 'hook_secret';
  const { __test: h2 } = await import('../api/razorpay-webhook.js?fresh=1');
  const raw = '{"event":"subscription.charged","payload":{}}';
  const good = createHmac('sha256', 'hook_secret').update(raw, 'utf8').digest('hex');
  ok('a signed body verifies', h2.verified(raw, good));
  ok('a tampered body does not', h2.verified(raw + ' ', good) === false);
  ok('a wrong secret does not',
    h2.verified(raw, createHmac('sha256', 'nope').update(raw).digest('hex')) === false);
  ok('no signature at all does not', h2.verified(raw, '') === false);
  ok('seconds become an iso string', h2.secs(1756684800) === new Date(1756684800000).toISOString());
  ok('no timestamp is null, not 1970', h2.secs(null) === null);
}

// ---------------------------------------------------------------------------
section('a month, added');
{
  const m = (s) => bill.addMonth(new Date(s)).toISOString().slice(0, 10);
  ok('mid-month is unremarkable', m('2026-03-14T00:00:00Z') === '2026-04-14');
  // THE ONE THAT MATTERS. A 31st that lands in a shorter month must walk BACK to
  // the last day, not forward into the month after — otherwise a subscription
  // taken on 31 January silently gains three days of March, every year.
  ok('31 Jan becomes 28 Feb', m('2026-01-31T00:00:00Z') === '2026-02-28');
  ok('and 29 Feb in a leap year', m('2028-01-31T00:00:00Z') === '2028-02-29');
  ok('31 Mar becomes 30 Apr', m('2026-03-31T00:00:00Z') === '2026-04-30');
  ok('December rolls the year', m('2026-12-15T00:00:00Z') === '2027-01-15');
  ok('30 Nov becomes 30 Dec', m('2026-11-30T00:00:00Z') === '2026-12-30');
}

// ---------------------------------------------------------------------------
section('the price in minor units');
{
  ok('USD falls back to the dollar figure', bill.amountMinor('starter') === 1000);
  ok('and for pro', bill.amountMinor('pro') === 3000);
  ok('an unknown tier is zero', bill.amountMinor('nonsense') === 0);

  // A NON-USD CURRENCY WITH NO EXPLICIT PRICE MUST RETURN 0, which checkoutAction
  // turns into a legible refusal. The alternative — charging ₹1,000 because the
  // dollar price was 10 — is a 92% discount nobody authorised.
  process.env.RZP_CURRENCY = 'INR';
  const { __test: inr } = await import('../api/billing.js?fresh=inr');
  ok('INR with no price set refuses rather than guessing', inr.amountMinor('starter') === 0);
  process.env.RZP_AMOUNT_STARTER = '89900';
  const { __test: inr2 } = await import('../api/billing.js?fresh=inr2');
  ok('and uses the rupee price when given', inr2.amountMinor('starter') === 89900);
  delete process.env.RZP_AMOUNT_STARTER;
  process.env.RZP_CURRENCY = 'USD';
}

// ---------------------------------------------------------------------------
section('bounds and formatting');
{
  ok('the claim ceiling is generous but finite',
    MAX_CLAIM_SQFT > TIER.pro.area && Number.isFinite(MAX_CLAIM_SQFT));
  // BELOW THE FLOOR IS NOT A SPACE, and the floor has to sit under anything
  // rooms.js would keep (it discards enclosed areas under 8 sq ft) and above the
  // hundredth-of-a-foot rows that were used to flood the ledger.
  ok('the claim floor is under a real room', MIN_CLAIM_SQFT < 8);
  ok('and above ledger dust', MIN_CLAIM_SQFT > 0.01);
  ok('the release window is minutes, not days',
    bill.RELEASE_WINDOW_MS > 60000 && bill.RELEASE_WINDOW_MS < 24 * 3600 * 1000);
  ok('sqft is grouped', fmtSqft(10000).includes('10,000'));
  ok('and rounded', fmtSqft(1234.7) === fmtSqft(1235));
  // NULL IS NOW "UNLIMITED" RATHER THAN ZERO — see the role-1 section. NaN and
  // undefined must still read as zero, because those are a missing number rather
  // than an absent limit, and the two must not be conflated.
  ok('NaN is 0, not NaN', fmtSqft(NaN) === '0 sq ft');
  // UNDEFINED IS ZERO, NOT UNLIMITED, and the asymmetry is deliberate: a missing
  // field must never be read as "no limit", because that is a promise the server
  // will refuse to keep on the very next claim.
  ok('undefined is 0, not unlimited', fmtSqft(undefined) === '0 sq ft');
  ok('an allowance names both meters',
    fmtAllowance(TIER.pro).includes('50,000') && fmtAllowance(TIER.pro).includes('20 render'));
  ok('free mentions no passes it does not have',
    !fmtAllowance(TIER.free).includes('render'));

  // THE FORK. Free is sold on a count of drawings and the paid tiers on area,
  // and `tierHeadline` is the one place that decides which — four screens print
  // it, and four independent guesses is how a visitor reads "15,000 sq ft" on a
  // card and is refused at three plans.
  ok('free leads with the plan count', tierHeadline(TIER.free) === '3 floor plans');
  ok('and never with the backstop', !tierHeadline(TIER.free).includes('15,000'));
  ok('a paid tier still leads with area', tierHeadline(TIER.starter) === '10,000 sq ft');
  ok('unmetered is a word', tierHeadline(ADMIN) === 'Unlimited');
  ok('the allowance line follows it', fmtAllowance(TIER.free) === '3 floor plans');

  ok('one plan is singular', fmtPlans(1) === '1 floor plan');
  ok('and none is plural', fmtPlans(0) === '0 floor plans');
  ok('null is unlimited, as everywhere else', fmtPlans(null) === 'Unlimited');

  // `fmtRemaining` IS THE RUNNING FIGURE and takes the balance rather than the
  // tier — the profile rail and the pricing strip both print it, so they cannot
  // disagree about which meter this account is on.
  ok('free counts down in drawings',
    fmtRemaining(balanceFromTotals(null, { area: 900, passes: 0, plans: 1 }))
      === '2 of 3 plans left');
  ok('a paid tier counts down in square feet',
    fmtRemaining(balanceFromTotals(subAt(), { area: 1000, passes: 0, plans: 9 }))
      === '49,000 sq ft left');
  ok('unmetered says so',
    fmtRemaining(balanceFromTotals(null, {}, { isAdmin: true })) === 'Unlimited');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
