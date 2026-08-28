// ---------------------------------------------------------------------------
// THE ONE CLIENT. Everything that talks to Supabase imports this module, and
// nothing anywhere else calls createClient — two clients in one tab means two
// auth listeners racing over the same refresh token, which shows up as a random
// sign-out on a long session and is very hard to see coming.
//
// THE KEYS ARE PUBLISHABLE AND THAT IS THE POINT. Everything else in this repo
// that touches an API key is server-side and deliberately unprefixed (see the
// header of .env.example). These two are the opposite: the anon key is designed
// to sit in a browser bundle, and the row-level-security policies in
// supabase/migrations are what actually protect the data. If a policy is
// missing, the key being public is the bug's amplifier, not its cause — so read
// 0001_init.sql before adding a table.
//
// NEVER put SUPABASE_SECRET_KEY (already in .env.local, used by nothing in the
// browser) behind a VITE_ prefix. That key bypasses RLS entirely.
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const raw = import.meta.env;

// Two ways to say the same thing, because .env.local already carries
// SUPABASE_PROJECT_ID for the server side and making somebody write the full
// URL a second time is how the two drift apart.
const url = raw.VITE_SUPABASE_URL
  || (raw.VITE_SUPABASE_PROJECT_ID ? `https://${raw.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const key = raw.VITE_SUPABASE_ANON_KEY || raw.VITE_SUPABASE_PUBLISHABLE_KEY || '';

/**
 * Whether the app can talk to a backend at all. Checked by the auth provider so
 * a missing .env.local produces one legible sentence on screen instead of a
 * stack trace from inside the SDK on every page.
 */
export const supabaseReady = !!(url && key);

/**
 * A LOCK THAT CANNOT DEADLOCK — CURRENTLY NOT WIRED IN. See the note at the
 * `lock:` option below for why it was reverted and what would justify enabling
 * it. Kept because the failure mode it describes is real and documented, not
 * because it is in use.
 *
 * supabase-js serialises auth calls behind a Web Lock so that two tabs cannot
 * refresh the same token at once. Sound idea, one nasty failure mode: if the
 * holder never finishes — a browser froze a background tab mid-refresh, a fetch
 * hung after its preflight — the lock is never released, and EVERY later auth
 * call waits on it forever. Not slowly. Forever, with no error. `getSession()`
 * hangs, `signInWithOtp()` hangs behind it, and the app looks logged out while
 * holding a perfectly good session.
 *
 * That is exactly what we saw: `/auth/v1/token` preflighted and then nothing,
 * and every auth call afterwards silent.
 *
 * So the wait is bounded. If the lock cannot be taken in LOCK_WAIT_MS we run
 * anyway, unlocked, and say so. The thing we give up is cross-tab
 * serialisation — two tabs could try to refresh at the same moment and one
 * could present an already-used refresh token. Supabase tolerates that (reuse
 * has a grace window), and a rare retry is a far better failure than a
 * permanent freeze.
 */
const LOCK_WAIT_MS = 4000;

async function softLock(name, acquireTimeout, fn) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return fn();          // Safari < 16, or a worker

  // `acquireTimeout === 0` is supabase saying "do not wait at all".
  if (acquireTimeout === 0) {
    let ran = false;
    const out = await locks.request(name, { ifAvailable: true }, async (held) => {
      if (!held) return undefined;
      ran = true;
      return fn();
    });
    if (ran) return out;
    throw new Error('Auth lock is busy');    // the shape supabase expects here
  }

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), acquireTimeout > 0
    ? Math.min(acquireTimeout, LOCK_WAIT_MS) : LOCK_WAIT_MS);
  try {
    return await locks.request(name, { mode: 'exclusive', signal: ctl.signal }, async () => fn());
  } catch (err) {
    if (err?.name === 'AbortError') {
      // The holder is wedged. Proceed rather than join it.
      console.warn(`[supabase] auth lock "${name}" did not free in `
        + `${LOCK_WAIT_MS}ms — continuing without it`);
      return fn();
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * ONE CLIENT PER TAB, AND THE GLOBAL IS WHY.
 *
 * In dev, Vite's HMR re-evaluates this module whenever anything it imports
 * changes — and a second `createClient` means a second GoTrueClient competing
 * for the same storage key and the same Web Lock as the first. Two clients
 * fighting over one lock is the other way to produce the freeze above, and it
 * only happens on a machine with the dev server running, which is the worst
 * kind of bug to chase. Hanging the instance off `globalThis` survives module
 * re-evaluation; the browser tab is the real lifetime here.
 *
 * If the console ever prints "Multiple GoTrueClient instances detected", this
 * is the line that has stopped working.
 */
const GLOBAL_KEY = '__superluminal_supabase_client__';

export const supabase = supabaseReady
  ? (globalThis[GLOBAL_KEY] ||= createClient(url, key, {
      auth: {
        // The OTP flow lands back in the same tab, so there is no code in a URL
        // to detect and detecting one would only ever be a false positive.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        // `lock: softLock` — REVERTED, DELIBERATELY, AND LEFT HERE UNUSED.
        //
        // It was added on a hypothesis (a wedged Web Lock) that the evidence did
        // not actually support: the OTP send was already failing BEFORE it went
        // in, so the lock was never the cause of that. Replacing supabase-js's
        // own locking with ours is an invasive change to the one subsystem that
        // must not be experimental, and it bought nothing measurable. Stock
        // behaviour is back.
        //
        // Turn it on only with evidence — specifically, a console warning from
        // softLock firing, or a pending /auth/v1/token request visible in the
        // Network tab while other auth calls sit silent. Not on a theory.
      },
      realtime: { params: { eventsPerSecond: 5 } },
    }))
  : null;

/**
 * IS THERE A SESSION IN STORAGE? Answered without touching the client, the lock
 * or the network — it is a localStorage read and nothing more.
 *
 * This exists to tell two very different states apart, which the app was
 * previously conflating with a bug's worth of consequences:
 *
 *   "this person is signed out"        -> send them to /login
 *   "we cannot currently tell"         -> wait, and say so
 *
 * A slow or wedged auth call must never produce the first answer. Being bounced
 * to a login screen while holding a valid session is the single most annoying
 * thing an app can do.
 */
export function hasStoredSession() {
  if (!supabaseReady) return false;
  try {
    const ref = new URL(url).hostname.split('.')[0];
    const raw = globalThis.localStorage?.getItem(`sb-${ref}-auth-token`);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed?.refresh_token || parsed?.access_token || parsed?.user);
  } catch { return false; }
}

/** The bucket the drawings and the design snapshots live in. Public read. */
export const BUCKET = 'uploads';

/** A storage path to a URL the <img> and the DXF fetch can both use. */
export function publicUrl(path) {
  if (!path || !supabase) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
