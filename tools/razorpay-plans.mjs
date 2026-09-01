#!/usr/bin/env node
// tools/razorpay-plans.mjs — create the two Razorpay plans, once.
//
// WHY THIS IS A SCRIPT AND NOT SOMETHING THE APP DOES ON DEMAND.
//
// A Razorpay plan is a permanent object with a price welded into it. There is no
// "update the amount" — changing what Starter costs means creating a NEW plan and
// leaving every existing subscriber on the old one, which is exactly the
// behaviour you want (nobody's price changes under them) and exactly the
// behaviour you must not get by accident. If the app created plans lazily, a
// deploy with a different number in src/lib/plans.js would silently mint a
// second Starter plan and the two would drift apart in the dashboard with nothing
// to say which was live.
//
// So it is deliberate, manual, and it prints the two lines to paste into the
// environment:
//
//   node tools/razorpay-plans.mjs                     # USD, from plans.js
//   node tools/razorpay-plans.mjs --currency INR --starter 89900 --pro 249900
//   node tools/razorpay-plans.mjs --dry               # show, create nothing
//
// It reads RZP_KEY and RZP_SECRET from the environment. `--dry` needs neither.
//
// IF IT FAILS WITH A MESSAGE ABOUT THE FEATURE NOT BEING ENABLED, the account
// does not have Subscriptions switched on — and that is not something to work
// around here. Set RZP_MODE=order instead: prepaid months, no plan ids, works on
// every account. See the header of api/billing.js.
import { readFileSync } from 'node:fs';
import { TIERS } from '../src/lib/plans.js';

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);

const dry = has('dry') || has('dry-run');
const currency = (flag('currency', process.env.RZP_CURRENCY || 'USD')).toUpperCase();

// .env.local IS READ HERE AND NOWHERE ELSE IN tools/, because this is the only
// script that needs a credential the dev server would normally have injected.
// Parsed rather than depended on: pulling in dotenv for eight lines of KEY=value
// is the same argument this repo makes about jsPDF in the BOQ exporter.
function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, '');
      if (v && !process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* not there, and that is fine — the environment may already have it */ }
}
loadEnvLocal();

const KEY = process.env.RZP_KEY || '';
const SECRET = process.env.RZP_SECRET || '';

/** The price for one tier, in minor units, from a flag or from plans.js. */
function amountFor(tier) {
  const given = flag(tier.slug);
  if (given) return Math.round(Number(given));
  const env = process.env[`RZP_AMOUNT_${tier.slug.toUpperCase()}`];
  if (env) return Math.round(Number(env));
  if (currency === 'USD') return Math.round(tier.usd * 100);
  return 0;
}

const paid = TIERS.filter((t) => t.usd > 0);
const wanted = paid.map((t) => ({ tier: t, amount: amountFor(t) }));

console.log(`\nSuper Luminal — Razorpay plans (${currency})\n`);
for (const { tier, amount } of wanted) {
  const major = (amount / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  console.log(`  ${tier.name.padEnd(8)} ${currency} ${major.padStart(10)}`
    + `   ${tier.area.toLocaleString('en-IN')} sq ft`
    + ` · ${tier.renderPasses} render passes / month`);
}
console.log('');

const missing = wanted.filter((w) => !w.amount || w.amount < 100);
if (missing.length) {
  console.error(`No price for ${missing.map((m) => m.tier.name).join(' and ')} in ${currency}.`);
  console.error(`Pass it in minor units, e.g. --currency INR`
    + ` ${missing.map((m) => `--${m.tier.slug} 89900`).join(' ')}\n`);
  process.exit(1);
}

if (dry) { console.log('--dry: nothing was created.\n'); process.exit(0); }

if (!KEY || !SECRET) {
  console.error('RZP_KEY and RZP_SECRET are not set (checked the environment and .env.local).\n');
  process.exit(1);
}
if (!/^rzp_(test|live)_/.test(KEY)) {
  console.warn(`Warning: RZP_KEY does not look like a Razorpay key id ("${KEY.slice(0, 12)}…").\n`);
}
// SAY WHICH ONE, LOUDLY. A live plan created while meaning to test is not
// reversible — Razorpay plans cannot be deleted — and the two key prefixes are
// one character apart.
console.log(KEY.startsWith('rzp_live_')
  ? '*** LIVE KEY — these plans will be real. ***\n'
  : 'Test key.\n');

const auth = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');

async function createPlan({ tier, amount }) {
  const res = await fetch('https://api.razorpay.com/v1/plans', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: 'monthly',
      interval: 1,
      item: {
        // THE NAME A CUSTOMER SEES ON THEIR BANK'S MANDATE SCREEN. It has to
        // stand alone there, with no logo and no context, which is why it is the
        // product and the tier rather than just "Starter".
        name: `Super Luminal — ${tier.name}`,
        amount,
        currency,
        description: `${tier.area.toLocaleString('en-IN')} sq ft of lighting layout`
          + ` and ${tier.renderPasses} render passes each month.`
          + ' A product of Designopolis.',
      },
      notes: { app: 'super-luminal', tier: tier.slug, by: 'Designopolis' },
    }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep the text */ }
  if (!res.ok) {
    throw new Error(json?.error?.description || text.slice(0, 300));
  }
  return json;
}

const out = [];
for (const w of wanted) {
  try {
    const plan = await createPlan(w);
    console.log(`  created  ${w.tier.name.padEnd(8)} ${plan.id}`);
    out.push([`RZP_PLAN_${w.tier.slug.toUpperCase()}`, plan.id]);
  } catch (err) {
    console.error(`  FAILED   ${w.tier.name.padEnd(8)} ${err.message}`);
    if (/not.*enabl|feature|not allowed/i.test(err.message)) {
      console.error('\n  Subscriptions look switched off on this account.');
      console.error('  Set RZP_MODE=order to sell prepaid months instead — that path'
        + '\n  needs no plan ids and no activation. See api/billing.js.\n');
    }
    process.exit(1);
  }
}

console.log('\nPaste these into .env.local and into the Vercel environment:\n');
for (const [k, v] of out) console.log(`${k}=${v}`);
console.log(`RZP_CURRENCY=${currency}`);
for (const w of wanted) console.log(`RZP_AMOUNT_${w.tier.slug.toUpperCase()}=${w.amount}`);
console.log('');
