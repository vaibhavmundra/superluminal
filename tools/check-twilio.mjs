// tools/check-twilio.mjs — the code did not arrive. Whose fault is it?
//
// THREE SYSTEMS HAVE TO AGREE for an SMS code to land, and when one of them does
// not, the app shows the same thing in every case: a code box, and no code. This
// walks the chain end to end so the silence becomes a sentence.
//
//   the app     →  asks Supabase for a code
//   Supabase    →  must have the phone provider ON and Twilio Verify configured
//   Twilio      →  must accept the destination, which means EITHER an approved
//                  Primary Customer Profile (Trust Hub) or the number sitting in
//                  the Verified Caller IDs list
//
// THE LAST LINK IS THE ONE THAT SURPRISES PEOPLE, and it is why this script is
// worth having. Upgrading off the trial is NOT enough on its own: until Twilio
// has approved the business-identity filing, a paid account refuses every
// unverified destination exactly as a trial one does. The account page says
// "Full", every credential is right, and the code still does not arrive.
//
//   node tools/check-twilio.mjs                     # config only, sends nothing
//   node tools/check-twilio.mjs +91 98765 43210     # …and really send one
//   node tools/check-twilio.mjs +91 98765 43210 --create
//                                                   # …signing the number up if
//                                                   #   no account has it yet
//
// Reads .env.local. The send goes through SUPABASE, not straight to Twilio, on
// purpose: it is the path the app takes, and testing anything else would prove
// something nobody asked about.
import fs from 'node:fs';
import path from 'node:path';
import { normalisePhone } from '../src/lib/profile.js';

const root = path.resolve(import.meta.dirname, '..');

function env() {
  const out = {};
  for (const f of ['.env.local', '.env']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] ??= m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return out;
}

const E = env();
const url = E.VITE_SUPABASE_URL
  || (E.SUPABASE_PROJECT_ID ? `https://${E.SUPABASE_PROJECT_ID}.supabase.co` : '');
const anon = E.VITE_SUPABASE_ANON_KEY || E.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const sid = E.TWILIO_ACCOUNT_SID || '';
const token = E.TWILIO_AUTH_TOKEN || '';
const argv = process.argv.slice(2);
const createUser = argv.includes('--create');
const phone = normalisePhone(argv.filter((a) => a !== '--create').join(' '));

const line = () => console.log('─'.repeat(64));
const ms = (t0) => `${Date.now() - t0}ms`;
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

// --- 1. Twilio ---------------------------------------------------------------
console.log('\nTwilio');
let trial = false;
if (!sid || !token) {
  ok(false, 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not both in .env.local');
} else {
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const twilio = (host, p) => fetch(`https://${host}.twilio.com/${p}`,
    { headers: { Authorization: auth } });

  const acc = await twilio('api', `2010-04-01/Accounts/${sid}.json`);
  if (!acc.ok) {
    ok(false, `the credentials were rejected (${acc.status})`);
  } else {
    const a = await acc.json();
    trial = a.type === 'Trial';
    ok(true, `${a.friendly_name} — ${a.type}, ${a.status}`);

    const svcRes = await twilio('verify', 'v2/Services?PageSize=50');
    const services = svcRes.ok ? ((await svcRes.json()).services || []) : [];
    ok(services.length > 0, services.length
      ? `${services.length} Verify service(s): ${services.map((s) => `${s.friendly_name} ${s.sid}`).join(', ')}`
      : 'no Verify service exists — run `node tools/twilio-verify-setup.mjs`');

    if (E.TWILIO_VERIFY_SERVICE_SID) {
      ok(services.some((s) => s.sid === E.TWILIO_VERIFY_SERVICE_SID),
        `TWILIO_VERIFY_SERVICE_SID matches a real service (${E.TWILIO_VERIFY_SERVICE_SID})`);
    }

    // CAN THIS ACCOUNT TEXT A STRANGER? — and the honest answer is NOT the
    // account type, which is what this script originally checked and got wrong.
    //
    // An upgraded account still refuses every unverified destination until
    // Twilio has APPROVED A PRIMARY CUSTOMER PROFILE: the business identity
    // filing under Trust Hub. Until that clears review, "Full" and "Trial"
    // behave identically as far as your users are concerned, and the refusal
    // arrives as a 422 from Supabase rather than anything the app can see.
    //
    // So the question is asked as two facts that must BOTH be gathered: is
    // there an approved profile, and failing that, which numbers are verified.
    const profRes = await twilio('trusthub', 'v1/CustomerProfiles?PageSize=20');
    const profiles = profRes.ok ? ((await profRes.json()).results || []) : [];
    const approved = profiles.filter((p) => p.status === 'twilio-approved');

    const vRes = await twilio('api', `2010-04-01/Accounts/${sid}/OutgoingCallerIds.json?PageSize=50`);
    const verified = vRes.ok
      ? ((await vRes.json()).outgoing_caller_ids || []).map((v) => v.phone_number) : [];

    if (approved.length) {
      ok(true, `compliance profile approved (${approved[0].friendly_name}) — any number may be texted`);
    } else if (profiles.length) {
      // SUBMITTED BUT NOT CLEARED. Worth its own branch, because the thing to do
      // about it is "wait" rather than "go and fill something in", and those are
      // very different afternoons.
      ok(false, `compliance profile not approved yet — ${profiles
        .map((p) => `${p.friendly_name}: ${p.status}`).join(', ')}`);
      console.log('        until it clears review only verified caller ids receive messages');
    } else {
      ok(false, 'NO Primary Customer Profile — Twilio will refuse every unverified '
        + 'number, whatever the account type says');
      console.log('        Console → Compliance → Trust Hub. Reviewed by Twilio, takes days.');
    }

    if (!approved.length) {
      ok(verified.length > 0, verified.length
        ? `${verified.length} verified caller id(s): ${verified.join(', ')}`
        : 'and NO verified caller ids either — this account can text nobody at all');
      if (phone) {
        const hit = verified.some((v) => v.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        ok(hit, hit ? `${phone} is verified, so Twilio will text it`
          : `${phone} is NOT a verified caller id and there is no approved profile — `
            + 'the send will be refused');
      }
    } else if (trial) {
      // Belt and braces: an approved profile on a trial account is unusual but
      // the trial restriction is its own gate and still applies.
      ok(verified.length > 0, 'trial account — only verified caller ids receive messages');
    }
  }
}

// --- 2. Supabase -------------------------------------------------------------
console.log('\nSupabase');
if (!url || !anon) {
  ok(false, 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not both in .env.local');
} else {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } });
  if (!res.ok) {
    ok(false, `could not read auth settings (${res.status})`);
  } else {
    const s = await res.json();
    ok(s.external?.phone === true, s.external?.phone === true
      ? 'the phone provider is ON'
      : 'the phone provider is OFF — Authentication → Sign In / Providers → Phone');
    ok(!!s.sms_provider, `sms provider: ${s.sms_provider || '(none)'}`);
    if (s.sms_provider && s.sms_provider !== 'twilio_verify') {
      console.log(`  note  configured as "${s.sms_provider}" rather than twilio_verify —`);
      console.log('        the plain twilio provider needs a Message Service SID, which');
      console.log('        needs a purchased number. See tools/twilio-verify-setup.mjs.');
    }
    ok(s.disable_signup !== true, s.disable_signup === true
      ? 'sign-ups are DISABLED — a first-time number cannot be used'
      : 'sign-ups are allowed, so a new number creates an account');
  }
}

// --- 3. the real thing -------------------------------------------------------
if (phone && url && anon) {
  line();
  console.log(`sending a real code to ${phone} …`);
  const t0 = Date.now();
  // `create_user` DEFAULTS TO FALSE, AND IT USED TO DEFAULT TO TRUE. That was a
  // diagnostic with a side effect, which is the one thing a diagnostic must not
  // have: testing delivery to your own number SIGNED IT UP, leaving a phone-only
  // account holding it — and then `link-phone.mjs` correctly refused to attach
  // that number to the real account, because another user already had it. The
  // test broke the thing it was run to make possible.
  //
  // So a send now goes to an EXISTING account by default, and making one is an
  // explicit `--create`. The common case is testing your own number, which after
  // link-phone.mjs is an existing account anyway.
  const res = await fetch(`${url}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, create_user: createUser }),
  });
  const text = await res.text();
  if (res.ok) {
    console.log(`  Supabase accepted it in ${ms(t0)}${createUser ? ' (and created the account if new)' : ''}.`);
    console.log('  If nothing arrives, Supabase is not the problem — check Logs → Auth');
    console.log('  in the dashboard for what Twilio said back.');
  } else if (!createUser && /signups? not allowed|user not found/i.test(text)) {
    // NOT A FAILURE OF THE CHAIN, so it does not count against the exit code.
    console.log(`  No account has that number, and --create was not passed, so nothing`);
    console.log('  was sent. Attach it to an account first:');
    console.log('    node tools/link-phone.mjs you@example.com ' + phone);
    console.log('  …or pass --create to sign the number up as a new account.');
  } else {
    console.log(`  REFUSED in ${ms(t0)}: ${res.status} ${text.slice(0, 300)}`);
    bad++;
  }
} else if (!phone) {
  line();
  console.log('Pass a number to actually send one: node tools/check-twilio.mjs +91 98765 43210');
}

line();
console.log(bad ? `${bad} problem(s) above.` : 'Everything checks out.');
process.exit(bad ? 1 : 0);
