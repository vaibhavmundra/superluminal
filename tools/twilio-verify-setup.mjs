// tools/twilio-verify-setup.mjs — the one-time Twilio setup, and what to paste.
//
// WHAT SUPABASE NEEDS AND WHY IT IS NOT JUST THE CREDENTIALS. The Phone provider
// asks for three things, and the third is a SERVICE rather than a secret: a
// Verify Service is a resource on the Twilio account that owns the message
// template, the code length and the delivery channel. The account SID and auth
// token are what CREATE it; they are not a substitute for it.
//
// VERIFY RATHER THAN PROGRAMMABLE MESSAGING, which is the choice this script
// encodes. The other path — Supabase's plain "Twilio" provider — wants a Message
// Service SID, and a Messaging Service is not usable until it owns a sender,
// which means buying a phone number. Verify sends from Twilio's own pool, so it
// needs no number at all. It also matters for INDIA specifically: routing an
// ordinary A2P message to an Indian handset requires DLT registration of the
// sender and the template with a local operator, and Verify runs on
// infrastructure Twilio has already registered.
//
// IT IS IDEMPOTENT. An existing service with the same friendly name is reused
// and its SID printed again, so running this twice does not litter the account
// with services that each send slightly different messages.
//
//   node tools/twilio-verify-setup.mjs
//   node tools/twilio-verify-setup.mjs "Super Luminal"
//
// Reads .env.local. Writes nothing back — the SID is printed for you to paste,
// because the place it has to go is the Supabase dashboard rather than a file.
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
const sid = E.TWILIO_ACCOUNT_SID || '';
const token = E.TWILIO_AUTH_TOKEN || '';
const name = process.argv[2] || 'Super Luminal';

if (!sid || !token) {
  console.error('Need TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.local.');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
const twilio = (host, p, init = {}) => fetch(`https://${host}.twilio.com/${p}`, {
  ...init,
  headers: {
    Authorization: auth,
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(init.headers || {}),
  },
});

const line = () => console.log('─'.repeat(64));

// --- the account ------------------------------------------------------------
const acc = await twilio('api', `2010-04-01/Accounts/${sid}.json`);
if (!acc.ok) {
  console.error(`Twilio rejected the credentials: ${acc.status} `
    + `${(await acc.text()).slice(0, 200)}`);
  process.exit(1);
}
const account = await acc.json();
console.log(`account   ${account.friendly_name} (${account.type}, ${account.status})`);

// --- the service -------------------------------------------------------------
const list = await twilio('verify', 'v2/Services?PageSize=50');
if (!list.ok) {
  console.error(`Could not list Verify services: ${list.status} `
    + `${(await list.text()).slice(0, 200)}`);
  process.exit(1);
}
let service = ((await list.json()).services || []).find((s) => s.friendly_name === name);

if (service) {
  console.log(`service   ${service.friendly_name} — already existed, reusing it`);
} else {
  const made = await twilio('verify', 'v2/Services', {
    method: 'POST',
    body: new URLSearchParams({ FriendlyName: name, CodeLength: '6' }),
  });
  if (!made.ok) {
    console.error(`Could not create the Verify service: ${made.status} `
      + `${(await made.text()).slice(0, 300)}`);
    process.exit(1);
  }
  service = await made.json();
  console.log(`service   ${service.friendly_name} — created`);
}

// THE FRIENDLY NAME IS USER-FACING, and it is worth saying so out loud because
// nothing else in the setup is. Verify interpolates it into the message body, so
// this string is read by every person who ever signs in.
console.log(`message   "Your ${service.friendly_name} verification code is: 123456"`);
line();
console.log('Paste into Supabase → Authentication → Sign In / Providers → Phone:\n');
console.log('  Enable phone provider    on');
console.log('  SMS provider             Twilio Verify');
console.log(`  Twilio Account SID       ${sid}`);
console.log('  Twilio Auth Token        (the one in .env.local)');
console.log(`  Twilio Verify Service SID ${service.sid}`);
line();

if (account.type === 'Trial') {
  // THE ONE THING THAT WILL WASTE AN AFTERNOON IF IT IS NOT SAID HERE. Every
  // other piece of configuration can be correct and the code still never
  // arrives, with no error anywhere in the app — Supabase reports a send it
  // believes succeeded.
  console.log('⚠ This is a TRIAL account. Twilio will refuse to text any number that');
  console.log('  is not a Verified Caller ID, and the app cannot tell the difference');
  console.log('  between that and a code somebody simply has not typed yet. Add each');
  console.log('  number under Phone Numbers → Verified Caller IDs, or upgrade the');
  console.log('  account before anybody outside the room tries to sign in.');
  console.log('  `node tools/check-twilio.mjs` lists the ones already verified.');
}
