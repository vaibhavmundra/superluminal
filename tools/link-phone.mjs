// tools/link-phone.mjs — give an existing account a phone number to sign in with.
//
// WHY THIS EXISTS. Migration 0011 made the login a phone number, and every
// account created before it has an email and nothing else. Those people are not
// locked out because their data moved — it did not move at all — they are locked
// out because the front door changed and nobody cut them a key. This cuts the
// key.
//
// IT WRITES TO auth.users AND THAT IS THE WHOLE POINT. Setting the number on
// `public.profiles` looks like it should work and does nothing: profiles is a
// projection that RLS can talk about, and GoTrue authenticates against
// auth.users.phone. The trigger from 0011 mirrors the value back down to the
// profile by itself, so this writes one column and both end up right.
//
// THE USER ID NEVER CHANGES, which is the property that makes this safe. Every
// project, plan and share is keyed on it, so adding a number is genuinely
// additive — the account keeps its email, and either identifier signs in.
//
//   node tools/link-phone.mjs --list
//   node tools/link-phone.mjs alice@studio.com +91 98765 43210
//   node tools/link-phone.mjs alice@studio.com "+9198765 43210" --dry-run
//
// Reads .env.local itself. Needs SUPABASE_SECRET_KEY — the service key, which
// bypasses RLS and can write auth.users. Never put it in a VITE_ variable.
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
const key = E.SUPABASE_SECRET_KEY || '';

if (!url || !key) {
  console.error('Need VITE_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.');
  process.exit(1);
}

const admin = (p, init = {}) => fetch(`${url}/auth/v1/admin/${p}`, {
  ...init,
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  },
});

/** EVERY USER, PAGED. There are tens of these, not thousands — a filter that
 *  GoTrue may or may not support on a given version is not worth the risk. */
async function allUsers() {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const res = await admin(`users?page=${page}&per_page=200`);
    if (!res.ok) throw new Error(`admin/users ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const users = body?.users ?? [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const rest = args.filter((a) => a !== '--dry-run');

const users = await allUsers();

if (!rest.length || rest[0] === '--list') {
  console.log(`${users.length} accounts\n`);
  const w = Math.max(5, ...users.map((u) => (u.email || '').length));
  for (const u of users.sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))) {
    console.log(`  ${String(u.email || '—').padEnd(w)}  ${u.phone ? `+${String(u.phone).replace(/^\+/, '')}` : '(no number)'}`);
  }
  const without = users.filter((u) => !u.phone).length;
  console.log(`\n${without} of ${users.length} cannot sign in yet — they have no number.`);
  process.exit(0);
}

const wanted = String(rest[0]).trim().toLowerCase();
// EVERY REMAINING ARGUMENT IS THE NUMBER. `+91 98765 43210` is four argv
// entries to a shell that was not given quotes, and rejecting that would be
// rejecting the way anybody would actually type it.
const phone = normalisePhone(rest.slice(1).join(' '));

if (!phone) {
  console.error('That number is not E.164. It needs a country code: +91 98765 43210');
  process.exit(1);
}

const user = users.find((u) => String(u.email || '').toLowerCase() === wanted)
  || users.find((u) => u.id === rest[0]);

if (!user) {
  console.error(`No account with the address ${wanted}. \`--list\` prints them all.`);
  process.exit(1);
}

// ALREADY SOMEBODY ELSE'S IS THE ONE FAILURE WORTH CATCHING HERE rather than
// letting GoTrue phrase it. A number is unique across auth.users, so this would
// come back a 422 with a message about a "phone_change" constraint that does not
// obviously mean "that number is in use by another account".
const clash = users.find((u) => u.id !== user.id
  && String(u.phone || '').replace(/^\+/, '') === phone.replace(/^\+/, ''));
if (clash) {
  console.error(`${phone} already signs in as ${clash.email || clash.id}.`);
  process.exit(1);
}

console.log(`${user.email || user.id}`);
console.log(`  id     ${user.id}`);
console.log(`  phone  ${user.phone ? `+${String(user.phone).replace(/^\+/, '')} → ${phone}` : phone}`);

if (dry) { console.log('\n--dry-run, nothing written.'); process.exit(0); }

// `phone_confirm: true` IS THE LOAD-BEARING FLAG. Without it the number is
// recorded as unconfirmed and GoTrue will refuse to let it sign in — which looks
// exactly like the code never arriving, and is the one mistake worth not making
// silently. We are asserting the number on the operator's authority, which is
// the same authority the service key already represents.
const res = await admin(`users/${user.id}`, {
  method: 'PUT',
  body: JSON.stringify({ phone, phone_confirm: true }),
});

if (!res.ok) {
  console.error(`\nFailed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

console.log('\nLinked. They can now sign in with that number, and with their email as before.');
console.log('On a TRIAL Twilio account the number must also be a Verified Caller ID,');
console.log('or the code will never be sent — `node tools/check-twilio.mjs` lists them.');
