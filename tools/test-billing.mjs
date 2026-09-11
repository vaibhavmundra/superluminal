// Focused contract tests for the current product: three free plans, then one
// unlimited Studio subscription with server-selected regional pricing.
import { createHmac } from 'node:crypto';

process.env.RZP_SECRET = 'test_secret_do_not_use';
process.env.RZP_WEBHOOK_SECRET = 'hook_secret_do_not_use';
process.env.RZP_INDIA_PLAN = 'plan_india_test';
process.env.RZP_USD_PLAN = 'plan_usd_test';

const {
  TIERS, TIER, sellableTier, tierOf, balanceFromTotals, canSpend,
  fingerprintOutline, fingerprintPass, fmtAllowance, fmtRemaining, normaliseEmail,
} = await import('../src/lib/plans.js');
const { __test: billing } = await import(`../api/billing.js?test=${Date.now()}`);
const { __test: webhook } = await import(`../api/razorpay-webhook.js?test=${Date.now()}`);

let failures = 0;
const ok = (label, value) => {
  if (!value) failures += 1;
  console.log(`${value ? 'ok  ' : 'FAIL'} ${label}`);
};

console.log('\nplans and entitlements');
ok('only Free and Studio are offered',
  TIERS.length === 2 && TIERS[0].slug === 'free' && TIERS[1].slug === 'studio');
ok('Free includes exactly three plans', TIER.free.plans === 3);
ok('Studio is unlimited', TIER.studio.unlimited === true);
ok('priority support is included', TIER.studio.lines.includes('Priority support'));
ok('retired Starter subscriptions retain Studio access', sellableTier('starter') === TIER.studio);
ok('retired Pro subscriptions retain Studio access', sellableTier('pro') === TIER.studio);
ok('admin is not sellable', sellableTier('admin') === null);

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
ok('an active Studio period is Studio',
  tierOf({ tier: 'studio', status: 'active', current_period_end: future }).slug === 'studio');
ok('an expired Studio period is Free',
  tierOf({ tier: 'studio', status: 'active', current_period_end: past }).slug === 'free');

const free = balanceFromTotals(null, { area: 999999, passes: 999, plans: 2 });
ok('area is not metered', free.area.allowed === null && free.area.left === null);
ok('render passes are not metered', free.passes.allowed === null && free.passes.left === null);
ok('the third free plan is allowed', canSpend(free, { newPlans: 1 }).ok);
ok('a fourth plan is refused', canSpend(
  balanceFromTotals(null, { area: 0, passes: 0, plans: 3 }), { newPlans: 1 }).reason === 'plans');
ok('area and passes never refuse', canSpend(free, { area: 1e9, passes: 1e9 }).ok);
ok('Studio formats as unlimited access', fmtAllowance(TIER.studio).includes('Unlimited'));
ok('free remaining copy is plan-based', fmtRemaining(free) === '1 of 3 plans left');

console.log('\nregional checkout');
const india = billing.pricingFor({ headers: { 'x-vercel-ip-country': 'IN' } });
const global = billing.pricingFor({ headers: { 'x-vercel-ip-country': 'US' } });
const local = billing.pricingFor({ headers: {} });
ok('India receives ₹499', india.currency === 'INR' && india.amountMinor === 49900
  && india.display === '₹499');
ok('outside India receives $10', global.currency === 'USD' && global.amountMinor === 1000
  && global.display === '$10');
ok('local or missing country safely defaults to USD', local.currency === 'USD');
ok('India Razorpay plan maps to the India price',
  billing.pricingForPlan('plan_india_test').currency === 'INR');
ok('USD Razorpay plan maps to the global price',
  billing.pricingForPlan('plan_usd_test').currency === 'USD');
ok('unknown Razorpay plans are rejected', billing.pricingForPlan('plan_other') === null);
ok('Studio amounts are fixed in minor units',
  billing.amountMinor('studio', 'INR') === 49900 && billing.amountMinor('studio', 'USD') === 1000);

/* --- THE TEMPORARY MARKET-RESEARCH NOTICE --------------------------------
   IT IS MEANT TO BE REMOVED, so what is pinned is the two things that would be
   silently wrong if it were not: that BOTH markets produce one, and that the
   person's own details are in it. The sending is not tested — it is a `fetch`
   that swallows every error by design — but the body is pure and is. */
console.log('\nsubscribe alert (temporary hook)');
const alertOf = (pricing, over = {}) => billing.subscribeAlert({
  name: 'Asha Rao', email: 'asha@studio.in', contact: '919812345678',
  pricing, mode: 'subscription', userId: 'u-123', at: '2026-09-11T10:04:00.000Z',
  ...over });
const inAlert = alertOf(india);
const glAlert = alertOf(global);
ok('the ₹499 button produces a notice naming its market',
  inAlert.subject === 'Subscribe attempt — ₹499 (india)');
ok('...and so does the $10 one',
  glAlert.subject === 'Subscribe attempt — $10 (global)');
ok('the notice carries the email and the phone — the whole point of it',
  inAlert.text.includes('asha@studio.in') && inAlert.text.includes('919812345678'));
ok('...and says so plainly when no phone was typed',
  alertOf(global, { contact: '' }).text.includes('Phone: not given'));
ok('the country rides along with the market',
  inAlert.text.includes('india (IN)'));
/* THE HTML IS MAIL AND THE NAME IS TYPED BY THE PERSON, so it is escaped. */
ok('a typed name cannot inject markup into the email',
  !alertOf(global, { name: '<script>x</script>' }).html.includes('<script>'));

console.log('\nidentity and idempotency helpers');
const outline = { planId: 'p1', points: [[0, 0], [10, 0], [10, 10]], pxPerFt: 10, sqft: 100 };
ok('the same outline has the same fingerprint',
  fingerprintOutline(outline) === fingerprintOutline({ ...outline }));
ok('different render runs have different fingerprints',
  fingerprintPass({ planId: 'p', roomId: 'r', runId: '1' })
    !== fingerprintPass({ planId: 'p', roomId: 'r', runId: '2' }));
ok('emails are normalised', normaliseEmail(' Studio@Example.com ') === 'studio@example.com');

const payload = 'pay_test|sub_test';
const signature = createHmac('sha256', process.env.RZP_SECRET).update(payload).digest('hex');
ok('checkout signatures compare correctly', billing.sameSig(billing.hmac(payload), signature));
const hookBody = '{"event":"subscription.charged"}';
const hookSig = createHmac('sha256', process.env.RZP_WEBHOOK_SECRET)
  .update(hookBody).digest('hex');
ok('webhook signatures are verified', webhook.verified(hookBody, hookSig));
ok('only successful payment states count as money received',
  webhook.moneyMoved('subscription.charged', { status: 'captured' })
  && !webhook.moneyMoved('subscription.charged', { status: 'failed' })
  && !webhook.moneyMoved('subscription.activated', { status: 'failed' }));

console.log(failures ? `\n${failures} billing test(s) failed.\n` : '\nAll billing tests passed.\n');
process.exit(failures ? 1 : 0);
