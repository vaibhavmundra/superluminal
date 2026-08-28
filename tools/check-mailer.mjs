// tools/check-mailer.mjs — which layer is actually stalling?
//
// Supabase's OTP endpoint waits for the email to be SENT before it answers, so
// a mailer that stalls turns into an HTTP request that hangs, and the dashboard
// tells you nothing useful about why. This script cuts Supabase out completely
// and talks to the SMTP server itself, printing a timing for every step:
//
//   TCP connect → TLS handshake → 220 banner → EHLO → AUTH LOGIN
//
// WHERE IT STOPS IS THE ANSWER, and the four stalls mean four different things:
//
//   stalls at TCP connect     the port is blocked or wrong. Port 25 is blocked
//                             outbound by essentially every host including
//                             Supabase's. This is the one that produces a hang
//                             rather than an error, because nothing ever
//                             refuses — the packets are simply dropped.
//   stalls at TLS handshake   implicit-TLS/STARTTLS mismatch. 465 speaks TLS
//                             immediately; 587 starts in plaintext. Point one at
//                             the other and both sides wait for the other to
//                             talk first. Also a hang, never an error.
//   fails at AUTH             credentials. Fast, and it names itself (535).
//   passes everything         SMTP is fine and the stall is elsewhere — the
//                             template, or a Send Email Hook still enabled.
//
// A FAST FAILURE HERE IS GOOD NEWS. It means Supabase would also have failed
// fast, and a fast failure is a message you can read rather than a hang.
//
//   node tools/check-mailer.mjs                      # Resend defaults, port 465
//   node tools/check-mailer.mjs --port 587           # whatever the dashboard says
//   node tools/check-mailer.mjs --host smtp.x.com --port 465 --user u --pass p
//   node tools/check-mailer.mjs --domains            # ask Resend's API instead
//
// Reads RESEND_API_KEY from .env.local so the password is not in your shell
// history. Every step is bounded; this script cannot hang.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';

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
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const HOST = arg('host', 'smtp.resend.com');
const PORT = Number(arg('port', '465'));
// The literal word `resend` for every Resend account — not an email address, and
// not the API key. Putting either of those here is what a 535 means.
const USER = arg('user', 'resend');
const PASS = arg('pass', E.RESEND_API_KEY || '');
const STEP_MS = 12000;

const line = () => console.log('─'.repeat(64));
const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(5)}ms`;
const ok = (what, extra = '') => console.log(`  ${at()}  ✓ ${what}${extra ? `   ${extra}` : ''}`);
const bad = (what, why) => console.log(`  ${at()}  ✗ ${what}\n           ${why}`);

/** Any step, with a ceiling, so a stall is reported rather than waited on. */
function bounded(label, ms, work) {
  return Promise.race([
    work(),
    new Promise((_, rej) => setTimeout(
      () => rej(Object.assign(new Error(`STALLED — no answer in ${ms / 1000}s`), { stalled: true, label })),
      ms,
    )),
  ]);
}

/** Read until a complete SMTP reply (the last line has a space after the code). */
function reply(sock, ms = STEP_MS) {
  return bounded('reply', ms, () => new Promise((res, rej) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        sock.removeListener('data', onData);
        res({ code: Number(last.slice(0, 3)), text: buf.trim() });
      }
    };
    sock.on('data', onData);
    sock.once('error', rej);
    sock.once('close', () => rej(new Error('the server closed the connection')));
  }));
}

const say = async (sock, cmd, redact) => {
  console.log(`           → ${redact ? cmd.replace(/ .*/, ' …') : cmd}`);
  sock.write(`${cmd}\r\n`);
  return reply(sock);
};

async function smtp() {
  console.log('\nMAILER CHECK');
  line();
  console.log(`host           ${HOST}`);
  console.log(`port           ${PORT}  ${PORT === 465 ? '(implicit TLS)' : PORT === 587 ? '(STARTTLS)' : PORT === 25 ? '— BLOCKED OUTBOUND ALMOST EVERYWHERE' : '(unusual)'}`);
  console.log(`username       ${USER}${USER.includes('@') ? '   !! an email address here is the classic 535' : ''}`);
  console.log(`password       ${PASS ? `${PASS.slice(0, 6)}… (${PASS.length} chars)` : '(missing — put RESEND_API_KEY in .env.local or pass --pass)'}`);
  if (!PASS) { console.log('\nSTOP: no password to try.\n'); process.exit(1); }
  if (PORT === 25) {
    console.log('\n!! PORT 25 IS THE ANSWER, almost certainly. It is blocked outbound by');
    console.log('   Supabase and by every mainstream host. Blocked, not refused — so the');
    console.log('   connection below will stall for as long as you let it, and that is');
    console.log('   exactly what your login screen is doing. Use 465.');
  }
  line();

  let sock;
  const implicit = PORT === 465 || PORT === 2465;
  try {
    sock = await bounded('connect', STEP_MS, () => new Promise((res, rej) => {
      const s = implicit
        ? tls.connect({ host: HOST, port: PORT, servername: HOST }, () => res(s))
        : net.connect({ host: HOST, port: PORT }, () => res(s));
      s.once('error', rej);
    }));
    ok(implicit ? 'TCP connect + TLS handshake' : 'TCP connect');
  } catch (err) {
    bad(implicit ? 'TCP connect + TLS handshake' : 'TCP connect', err.message);
    console.log('\n' + (err.stalled
      ? 'THIS IS YOUR BUG. Nothing refused the connection and nothing accepted it —\n'
        + 'the packets are being dropped. Supabase is doing exactly this, which is\n'
        + `why the request hangs instead of erroring. Wrong port (${PORT}), a blocked\n`
        + 'port, or the wrong host. Try 465.'
      : /EAI_AGAIN|ENOTFOUND/.test(err.message)
        ? `THE HOSTNAME DOES NOT RESOLVE: ${err.message}\nEither it is misspelled, or the machine running this has no DNS. Note\nthat a DNS failure is FAST — so if Supabase were failing this way it\nwould error rather than hang, and this is not what your app is hitting.`
        : `The connection was refused: ${err.message}\nSomething answered and said no. Check the host and port.`) + '\n');
    process.exit(1);
  }

  try {
    const banner = await reply(sock);
    ok(`banner ${banner.code}`, banner.text.split('\n')[0].slice(0, 44));

    let r = await say(sock, `EHLO check-mailer.local`);
    ok(`EHLO ${r.code}`);

    if (!implicit) {
      if (!/STARTTLS/i.test(r.text)) {
        bad('STARTTLS', `the server did not offer it on port ${PORT}`);
        console.log('\nIf this port does not do STARTTLS it probably wants implicit TLS.\n'
          + 'Use 465 instead.\n');
        process.exit(1);
      }
      r = await say(sock, 'STARTTLS');
      ok(`STARTTLS ${r.code}`);
      sock = await bounded('tls upgrade', STEP_MS, () => new Promise((res, rej) => {
        const t = tls.connect({ socket: sock, servername: HOST }, () => res(t));
        t.once('error', rej);
      }));
      ok('TLS handshake');
      r = await say(sock, `EHLO check-mailer.local`);
      ok(`EHLO (encrypted) ${r.code}`);
    }

    r = await say(sock, 'AUTH LOGIN');
    if (r.code !== 334) { bad(`AUTH LOGIN ${r.code}`, r.text); process.exit(1); }
    r = await say(sock, Buffer.from(USER).toString('base64'), true);
    if (r.code !== 334) { bad(`username rejected (${r.code})`, r.text); process.exit(1); }
    r = await say(sock, Buffer.from(PASS).toString('base64'), true);

    line();
    if (r.code === 235) {
      console.log('\nSMTP IS COMPLETELY FINE. Host, port, TLS and credentials all work, so');
      console.log('whatever is hanging is NOT the connection Supabase makes to Resend.');
      console.log('\nWhat is left, in order:');
      console.log('  1. A Send Email Hook still enabled and pointing at nothing.');
      console.log('     Authentication → Hooks. GoTrue waits on that HTTP call the same');
      console.log('     way it waits on SMTP, and there is no email function in api/.');
      console.log('  2. The sender address. Resend refuses to send FROM an unverified');
      console.log('     domain — `node tools/check-mailer.mjs --domains` will say whether');
      console.log('     designopolis.co.in is verified. That fails fast rather than');
      console.log('     hanging, but it is the next wall regardless.');
      console.log('  3. The template. Authentication → Emails → Magic Link must contain');
      console.log('     {{ .Token }} or there will be no six digits to type.\n');
    } else {
      bad(`AUTH rejected (${r.code})`, r.text);
      console.log('\nCREDENTIALS, and this is good news — it is fast and specific rather');
      console.log('than a hang. For Resend the username is the literal word `resend` and');
      console.log('the password is the API key beginning `re_`. Putting the email address');
      console.log('or the key in the username field is what produces a 535.\n');
    }
    sock.end();
  } catch (err) {
    bad(err.label || 'SMTP conversation', err.message);
    console.log('\n' + (err.stalled
      ? 'A STALL MID-CONVERSATION is a TLS mismatch: one side is speaking\n'
        + 'plaintext and the other is waiting for TLS, so both wait forever.\n'
        + `Port ${PORT} was treated as ${implicit ? 'implicit TLS' : 'STARTTLS'} — try the other.`
      : err.message) + '\n');
    process.exit(1);
  }
}

/** Resend's own API: does the key work, and is the sender domain verified? */
async function domains() {
  console.log('\nRESEND DOMAINS');
  line();
  if (!PASS) { console.log('No RESEND_API_KEY in .env.local.\n'); process.exit(1); }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${PASS}` }, signal: ctl.signal,
    });
    const body = await res.text();
    console.log(`status ${res.status} in ${at()}\n`);
    if (res.status === 401) {
      console.log('The API key was rejected. If the SMTP password in the Supabase');
      console.log('dashboard is this same string, that is the whole bug.\n');
      return;
    }
    let parsed; try { parsed = JSON.parse(body); } catch { console.log(body.slice(0, 500)); return; }
    const list = parsed.data || [];
    if (!list.length) {
      console.log('NO DOMAINS AT ALL. Resend will only send from onboarding@resend.dev,');
      console.log('and only to the address that owns the Resend account. Set that as the');
      console.log('sender in Supabase to test the flow end to end.\n');
      return;
    }
    for (const d of list) {
      const good = d.status === 'verified';
      console.log(`  ${good ? '✓' : '✗'} ${d.name}   ${d.status}${d.region ? `   ${d.region}` : ''}`);
      if (!good) {
        console.log(`      Not verified, so Resend will refuse every send FROM ${d.name}.`);
        console.log('      Either finish the DNS records, or set Supabase\'s sender to');
        console.log('      onboarding@resend.dev to test the login flow now.');
      }
    }
    console.log('\nThe sender address in Supabase (Project Settings → Authentication →');
    console.log('SMTP → Sender email) must be on a domain marked verified above.\n');
  } catch (err) {
    console.log(err.name === 'AbortError'
      ? 'No answer from api.resend.com in 15s.\n'
      : `Failed: ${err.message}\n`);
  } finally { clearTimeout(timer); }
}

if (flag('domains')) await domains(); else await smtp();
