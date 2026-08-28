// tools/check-supabase.mjs — is it us, or is it them?
//
// "Sending…" that never comes back is one of two very different bugs, and they
// have opposite fixes: either the browser never got an answer from Supabase, or
// the answer came back and the client is sitting on it. This script cuts the app
// out entirely — plain fetch, no supabase-js, no React — so whichever it is
// becomes a fact rather than a theory.
//
//   node tools/check-supabase.mjs                 # config + reachability only
//   node tools/check-supabase.mjs you@studio.com  # …and actually send an OTP
//
// Reads .env.local itself. Prints timings, because a call that takes 40 seconds
// and then works is a different problem from one that fails in 200ms.
import fs from 'node:fs';
import path from 'node:path';

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
  || (E.VITE_SUPABASE_PROJECT_ID ? `https://${E.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '')
  || (E.SUPABASE_PROJECT_ID ? `https://${E.SUPABASE_PROJECT_ID}.supabase.co` : '');
const key = E.VITE_SUPABASE_ANON_KEY || E.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const email = process.argv[2] || null;

const ms = (t0) => `${Date.now() - t0}ms`;
const line = () => console.log('─'.repeat(64));

console.log('\nSUPABASE CHECK');
line();
console.log(`url            ${url || '(missing)'}`);
console.log(`anon key       ${key ? `${key.slice(0, 8)}… (${key.length} chars)` : '(missing)'}`);

if (!url || !key) {
  console.log('\nSTOP: the client cannot be built at all. Add VITE_SUPABASE_URL and'
    + '\nVITE_SUPABASE_ANON_KEY to .env.local (see .env.example), then restart vite.');
  process.exit(1);
}

// A JWT anon key carries the project ref in its payload. If that disagrees with
// the URL, every request 401s — and the message Supabase returns for it is
// famously unhelpful, so it is worth checking here rather than guessing.
try {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  const refInKey = payload.ref;
  const refInUrl = new URL(url).hostname.split('.')[0];
  console.log(`key project    ${refInKey}`);
  console.log(`url project    ${refInUrl}`);
  if (refInKey && refInUrl && refInKey !== refInUrl) {
    console.log('\n!! MISMATCH: the key belongs to a different project than the URL.');
  }
  console.log(`key role       ${payload.role}`);
  if (payload.role !== 'anon') {
    console.log('\n!! This is not the anon key. Do NOT ship a service_role key to the browser.');
  }
} catch { console.log('key project    (not a JWT — a publishable sb_… key, which is fine)'); }

line();

/** fetch with a hard ceiling, so this script cannot hang either. */
async function go(label, path, init = {}, limitMs = 30000) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), limitMs);
  try {
    const res = await fetch(url + path, {
      ...init,
      signal: ctl.signal,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const body = await res.text();
    console.log(`${label.padEnd(15)}${res.status} in ${ms(t0)}`);
    return { status: res.status, body };
  } catch (err) {
    const why = err.name === 'AbortError'
      ? `NO ANSWER in ${limitMs / 1000}s — the request hung`
      : `FAILED: ${err.message}`;
    console.log(`${label.padEnd(15)}${why} (${ms(t0)})`);
    return { status: 0, body: '', err };
  }
}

const health = await go('auth health', '/auth/v1/health', {}, 15000);
const settings = await go('auth settings', '/auth/v1/settings', {}, 15000);
const rest = await go('rest', '/rest/v1/', {}, 15000);

if (settings.status === 200) {
  try {
    const s = JSON.parse(settings.body);
    line();
    console.log('AUTH SETTINGS');
    console.log(`  email provider enabled   ${s.external?.email}`);
    console.log(`  new signups disabled     ${s.disable_signup}`);
    console.log(`  mailer autoconfirm       ${s.mailer_autoconfirm}`);
    if (s.external?.email === false) {
      console.log('\n!! Email is disabled for this project. Authentication → Providers → Email.');
    }
    if (s.disable_signup) {
      console.log('\n!! Signups are disabled, and signInWithOtp uses shouldCreateUser: true.'
        + '\n   A first-time email will be rejected. Authentication → Sign In / Providers.');
    }
  } catch { /* not json */ }
}

// The tables the app needs. A 404 here means the migration has not been run,
// which does not break the login but breaks the very next screen.
line();
const tbl = await go('plans table', '/rest/v1/plans?select=id&limit=1', {}, 15000);
if (tbl.status === 404) {
  console.log('\n!! No `plans` table — run supabase/migrations/0001_init.sql.');
} else if (tbl.status === 401) {
  console.log('   401 here is CORRECT: RLS refusing an anonymous read.');
}

if (!email) {
  line();
  console.log('\nNo email given, so no OTP was sent. To test the send:');
  console.log('  node tools/check-supabase.mjs you@studio.com\n');
  process.exit(0);
}

line();
console.log('BROWSER TEST 1 — IS A REQUEST EVEN BEING MADE?');
console.log('Do this one FIRST, because it decides which half of the problem you');
console.log('are in, and it costs nothing. A 30-second timeout from the app has');
console.log('exactly two causes: a request that left and got no answer, or a');
console.log('request that was never sent because the auth lock is wedged. The');
console.log('second one looks identical from the outside and no amount of');
console.log('restarting Supabase will touch it.\n');
console.log('  await navigator.locks.query()\n');
console.log('A lock named `lock:sb-' + new URL(url).hostname.split('.')[0] + '-auth-token` sitting in');
console.log('`held` while nothing is in flight IS the bug: every auth call is queued');
console.log('behind a holder that will never finish. Close the tab (not reload — the');
console.log('lock is per-origin, and a reload can inherit it), or open the app in a');
console.log('fresh window. Also check the console for "Multiple GoTrueClient');
console.log('instances detected", which is the dev-server version of the same thing.\n');
console.log('Then watch the Network tab and press the button. No POST to /auth/v1/otp');
console.log('at all = the lock. A POST that sits pending = the mailer, below.\n');

line();
console.log('BROWSER TEST 2 — paste this into the console on the app tab.');
console.log('It uses plain fetch: no supabase-js, no auth lock, no app code. If');
console.log('this returns and the app does not, the fault is in the client library');
console.log('or in our code. If this hangs too, the browser cannot reach the');
console.log('endpoint at all and nothing in the app is involved.\n');
console.log(`await fetch('${url}/auth/v1/otp', {`);
console.log("  method: 'POST',");
console.log(`  headers: { apikey: '${key}', 'Content-Type': 'application/json' },`);
console.log(`  body: JSON.stringify({ email: '${email}', create_user: true }),`);
console.log("}).then(r => r.text().then(t => console.log(r.status, t)))");
console.log("  .catch(e => console.error('FETCH FAILED', e));\n");

line();
console.log(`SENDING AN OTP to ${email}`);
console.log('This is the exact call signInWithOtp makes. If it takes 30 seconds,');
console.log('that is the whole bug — the browser is waiting on the same thing.\n');

const otp = await go('POST /otp', '/auth/v1/otp', {
  method: 'POST',
  body: JSON.stringify({ email, create_user: true }),
}, 60000);

console.log(`\nbody: ${otp.body.slice(0, 600) || '(empty)'}`);

line();
if (otp.status === 200) {
  console.log('\nTHE ENDPOINT IS FINE. An email should be arriving.');
  console.log('If the app still hangs, the bug is client-side, not here.');
  console.log('\nAnd check the email itself: Supabase\'s DEFAULT magic-link template sends');
  console.log('a LINK, not a code. For a six-digit code the template must contain');
  console.log('{{ .Token }} — Authentication → Emails → Magic Link.');
} else if (otp.status === 429) {
  console.log('\nRATE LIMITED. The built-in mailer allows only a handful of emails per');
  console.log('hour. Wait, or configure custom SMTP (Project Settings → Auth → SMTP).');
} else if (otp.status === 0) {
  console.log('\nNO ANSWER. The request left and nothing came back — which is exactly');
  console.log('what the app is experiencing. Almost always the mailer: Supabase waits');
  console.log('for the SMTP send before it answers, so a wedged SMTP config hangs the');
  console.log('HTTP call. Check Logs → Auth in the dashboard for this attempt.');
} else if (otp.status === 500) {
  console.log('\nSERVER ERROR — nearly always the mailer. Logs → Auth will name it.');
}
console.log();
