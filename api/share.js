// ---------------------------------------------------------------------------
// api/share.js — the view-only link, redeemed server-side.
//
// TWO DOORS IN ONE FILE, and they are answering two different callers.
//
//   POST  the app, either asking "what is behind this token" or creating a
//         named invitation. Both require a signed-in user; invitation also
//         proves project ownership before it writes or sends mail.
//   GET   a scraper, asking for the Open Graph card at /s/<token>. Requires
//         nothing, returns no rows — a title, a picture and a sentence.
//
// WHY THE TOKEN IS NOT AN RLS GRANT. Migration 0006 says it at length; the short
// version is that a policy cannot see a string that lives in the address bar,
// and the ways to make it able to (a session GUC, a custom claim) all end with a
// policy whose scope is set by the client. So the token is checked here, with
// the service key, exactly as api/admin.js checks a role — and for the same
// reason: the browser is not trusted to assert what it may read.
//
// WHY A SIGN-IN IS STILL REQUIRED for a link described as "anyone with the
// link". Because "anyone" is about who may be GIVEN the link, not about who may
// be anonymous while using it. A drawing is somebody's work and a link that
// leaks gets crawled, mirrored and indexed; a session is the difference between
// a reader who can be counted and rate-limited and one who cannot. It costs the
// recipient one six-digit code, once, and it is what makes the link safe enough
// to hand out at all. The Open Graph card below is the deliberate exception —
// a scraper has no session and never will, so it gets the three things a card
// needs and nothing that is not already on the card.
//
// WHAT A LINK NEVER GRANTS: any write. There is no action here that mutates
// anything, and adding one would need the whole question re-opened.
//
// Runs unchanged as a Vercel function and as Vite dev middleware — see
// vite.config.js — which is why the body is read defensively and why the URL is
// parsed rather than trusted to arrive pre-split.
// ---------------------------------------------------------------------------

const PROJECT_URL = process.env.SUPABASE_URL
  || (process.env.SUPABASE_PROJECT_ID ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co` : '')
  || process.env.VITE_SUPABASE_URL
  || '';

const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM_EMAIL
  || 'Super Luminal <share@superluminal.design>';

/** Where the app lives, for the absolute URLs a scraper needs. */
const SITE = (process.env.PUBLIC_SITE_URL || 'https://superluminal.design').replace(/\/+$/, '');

/** The bucket is public-read by design — see the storage note in 0001_init.sql. */
const publicUrl = (path) =>
  (path ? `${PROJECT_URL}/storage/v1/object/public/uploads/${path.split('/').map(encodeURIComponent).join('/')}` : null);

// The card columns, copied from src/lib/db.js for the reason given there: a list
// of plans must never drag `editor_state`, `design_json` and `boq_json` over the
// wire.
const PLAN_CARD_COLS =
  'id, project_id, owner, name, status, source_kind, file_name, storage_path, snapshot_path,'
  + ' width, height, px_per_ft, project_type, stats, created_at, updated_at';
const SHARE_COLS = 'id,project_id,email,role,invited_user,owner_email,created_at';

/**
 * THE ONE SENTENCE THE CARD SAYS, and it is the site's own. A share is still a
 * Super Luminal link before it is this project's link, and the person seeing it
 * in a chat window has very likely never heard of either.
 */
const OG_DESCRIPTION =
  'Lighting layouts used to take hours. Our trained AI models understand your space, '
  + 'the use case and create fully functional layouts in a matter of minutes.';

const OG_FALLBACK_IMAGE = `${SITE}/superluminal-og.jpg`;

// --- plumbing --------------------------------------------------------------

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function rest(path, { method = 'GET', body = null, headers = {} } = {}) {
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      ...(body == null ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`supabase ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  try { return text ? JSON.parse(text) : []; } catch { return []; }
}

const enc = encodeURIComponent;

const uuid = (v) =>
  (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v : null);

/**
 * WHAT THIS CALLER ALREADY HAS, INDEPENDENTLY OF THE TOKEN — 'owner' | 'edit' |
 * 'view', or null for somebody whose only claim on this project is the link.
 *
 * THIS IS THE ANSWER THE LINK ROUTE NEEDS BEFORE IT DRAWS ANYTHING, and it is
 * the fix for a genuinely bad dead end. A link is a pointer to a project, not a
 * demotion: sending one to a person you have already made an EDITOR must not
 * drop them into a read-only viewer with no sign that the editor exists
 * somewhere else. So the endpoint says what they really are and the app sends
 * them to the ordinary route — /projects/:id, /plans/:id — where RLS gives them
 * exactly the access the share row granted. The token viewer is then what it
 * should always have been: the fallback for somebody with no grant at all.
 *
 * IT IS COMPUTED HERE RATHER THAN IN THE BROWSER because the browser cannot do
 * it. Resolving the token to a project id is the one thing only the service key
 * can do, and asking the client to make a second, RLS-scoped query afterwards is
 * a round trip and a window in which the two answers disagree.
 *
 * THE SAME TEST share_role() MAKES IN THE DATABASE, and deliberately written to
 * match it line for line: the invite is keyed on the ADDRESS, and `invited_user`
 * is a convenience a trigger fills in once that address has an account. Either
 * match is the grant. If these two ever drift, the app will offer somebody a
 * screen the policies then refuse to fill.
 */
async function grantFor(user, project) {
  if (user.id && user.id === project.owner) return 'owner';

  const addr = await addressOf(user);
  const clauses = [`invited_user.eq.${enc(user.id)}`];
  if (addr) clauses.push(`email.eq.${enc(addr)}`);

  let rows = [];
  try {
    rows = await rest(`project_shares?project_id=eq.${enc(project.id)}`
      + `&or=(${clauses.join(',')})&select=role&limit=2`);
  } catch (err) {
    // A LINK MUST STILL WORK IF THIS QUERY DOES NOT. The likeliest cause is a
    // deployment where migration 0006 has not been run yet, and the honest
    // degradation is "no standing grant" — which is the view-only path, and is
    // true for everybody on such a deployment anyway.
    console.warn('[share] could not read the grant — treating as link-only', err.message);
    return null;
  }
  if (!rows.length) return null;
  // 'edit' WINS, exactly as the order-by in share_role() does. The unique index
  // makes two rows impossible; this is here so a second grant path added later
  // cannot quietly downgrade somebody.
  return rows.some((r) => r.role === 'edit') ? 'edit' : 'view';
}

/**
 * THE CALLER'S ADDRESS, WHEREVER IT NOW LIVES — the server-side twin of
 * `public.my_email()` (migration 0011), and it has to agree with that function
 * exactly. Both answer the same question, and a grant this one can see but the
 * POLICY cannot is the worst possible disagreement: the endpoint offers somebody
 * a screen the database then refuses to fill, and the user gets an empty editor
 * with no error in it.
 *
 * THE JWT CLAIM FIRST, THE PROFILE ROW SECOND, in that order and for the reason
 * my_email() gives: an account that predates phone login proved its address by
 * receiving a code at it, and preferring the proved one keeps every existing
 * grant working unchanged. A phone account has no claim at all, and the row —
 * filled at the first export — is its only answer.
 *
 * AN EMPTY STRING IS A FINE ANSWER and means "no standing grant by address",
 * which for somebody holding a link is the view-only path and is correct.
 */
async function addressOf(user) {
  const claim = String(user?.email || '').trim().toLowerCase();
  if (claim) return claim;
  if (!user?.id) return '';
  try {
    const rows = await rest(`profiles?select=email&id=eq.${enc(user.id)}&limit=1`);
    return String(rows[0]?.email || '').trim().toLowerCase();
  } catch (err) {
    // SAME DEGRADATION AS grantFor'S OWN CATCH, and for the same reason: a link
    // must still work when this query does not.
    console.warn('[share] could not read the profile address', err.message);
    return '';
  }
}

/**
 * A TOKEN, CHECKED FOR SHAPE BEFORE IT IS INTERPOLATED. 24 url-safe base64
 * characters is what the column default mints; anything else is not a token this
 * app issued and there is no reason to ask the database about it.
 */
const shareToken = (v) =>
  (typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null);

/** The signed-in caller, or a 401. Identity only — the token carries the access. */
async function requireUser(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(raw)?.[1]?.trim();
  if (!bearer) { const e = new Error('Not signed in'); e.status = 401; throw e; }

  const who = await fetch(`${PROJECT_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` },
  });
  if (!who.ok) { const e = new Error('Not signed in'); e.status = 401; throw e; }
  const user = await who.json();
  if (!user?.id) { const e = new Error('Not signed in'); e.status = 401; throw e; }
  return user;
}

/**
 * THE TOKEN TO A PROJECT, or a 404 — and 404 is the honest code for all three
 * ways this fails. A token that never existed, a link that was revoked and a
 * project that was deleted are indistinguishable to the person holding the URL,
 * and telling them apart would be telling a stranger which of their guesses was
 * closer.
 */
async function projectForToken(token) {
  const t = shareToken(token);
  if (!t) { const e = new Error('No such link'); e.status = 404; throw e; }

  const rows = await rest(`project_share_links?select=token,project_id,created_at`
    + `&token=eq.${encodeURIComponent(t)}&limit=1`);
  const link = rows[0];
  if (!link) { const e = new Error('No such link'); e.status = 404; throw e; }

  // `owner` IS IN THE SELECT so grantFor() can settle the commonest case — the
  // project's own owner following their own link — without a second query.
  const projects = await rest(`projects?select=id,owner,name,project_type,created_at,updated_at`
    + `&id=eq.${enc(link.project_id)}&limit=1`);
  const project = projects[0];
  if (!project) { const e = new Error('No such link'); e.status = 404; throw e; }
  return { link, project };
}

// --- the actions -----------------------------------------------------------

/**
 * What is behind the link: the project, every plan in it as a card, and — the
 * part the route acts on before it draws anything — what this caller ALREADY
 * has independently of the token. See grantFor().
 *
 * THE ROWS ARE STILL FETCHED FOR SOMEBODY WHO WILL BE REDIRECTED, and that is a
 * deliberate trade of one wasted query for one fewer round trip. Returning the
 * grant without the rows would mean a link-only visitor — the common case, the
 * one this endpoint exists for — pays for two requests so that an editor can
 * save part of one they are about to leave anyway.
 */
async function openProject(body, user) {
  const { project } = await projectForToken(body.token);
  const [plans, grant] = await Promise.all([
    rest(`plans?select=${enc(PLAN_CARD_COLS)}`
      + `&project_id=eq.${enc(project.id)}&order=updated_at.desc`),
    grantFor(user, project),
  ]);
  // `access` IS WHAT THE TOKEN CONFERS AND `grant` IS WHAT THE PERSON HOLDS.
  // Two fields because they are two different facts and the route needs both:
  // the first is always 'view' by construction, the second decides whether this
  // screen is the right one to be on at all.
  return { project, plans, access: 'view', grant };
}

/**
 * ONE PLAN, WHOLE — the jsonb included, because the read-only viewer restores
 * from `editor_state` exactly as the editor does.
 *
 * THE PROJECT IS RE-DERIVED FROM THE TOKEN AND THE PLAN IS CHECKED AGAINST IT.
 * Not the other way round: a caller who sends a valid token and somebody else's
 * plan id must get a 404, and the only way to guarantee that is for the token to
 * decide the scope and the plan id to be tested inside it.
 */
async function openPlan(body, user) {
  const { project } = await projectForToken(body.token);
  const planId = uuid(body.planId);
  if (!planId) { const e = new Error('Bad plan id'); e.status = 400; throw e; }

  const [rows, grant] = await Promise.all([
    rest(`plans?select=*&id=eq.${planId}&project_id=eq.${enc(project.id)}&limit=1`),
    grantFor(user, project),
  ]);
  const plan = rows[0];
  if (!plan) { const e = new Error('No such plan'); e.status = 404; throw e; }
  return { plan, project, access: 'view', grant };
}

/**
 * SEND THE NOTICE AFTER THE GRANT EXISTS. Email is delivery, not permission:
 * a temporary Resend failure must not roll back access the owner deliberately
 * granted, and the response says plainly when those two outcomes differ.
 */
async function sendInviteEmail({ email, role, project, user }) {
  if (!RESEND_KEY) throw new Error('Resend is not configured');

  const oneLine = (value) => String(value).replace(/[\r\n\t]+/g, ' ').trim();
  const inviter = oneLine(user?.user_metadata?.full_name || user?.email || 'Someone at your studio');
  const projectName = oneLine(project.name || 'a lighting project');
  const access = role === 'edit' ? 'view and edit' : 'view';
  const url = `${SITE}/projects/${encodeURIComponent(project.id)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        ...(user?.email ? { reply_to: user.email } : {}),
        subject: `${inviter} shared “${projectName}” with you`,
        text: `${inviter} invited you to ${access} “${projectName}” in Super Luminal.\n\n`
          + `Open the project: ${url}\n\nSign in with ${email} to use this invitation.`,
        html: `<p>${esc(inviter)} invited you to ${esc(access)} <strong>${esc(projectName)}</strong> in Super Luminal.</p>`
          + `<p><a href="${esc(url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">Open the project</a></p>`
          + `<p style="color:#666;font-size:13px">Sign in with ${esc(email)} to use this invitation.</p>`,
      }),
      signal: ctl.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`resend ${res.status}: ${raw.slice(0, 240)}`);
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* the 2xx is enough */ }
    return data?.id || null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A NAMED SHARE, CREATED SERVER-SIDE because it now has a server-side effect.
 * The service key bypasses RLS, so ownership is re-proved here before either a
 * row or an email is produced. Re-entering somebody already on the list may
 * update their role, but it does not send another "new invitation" email.
 */
async function invite(body, user) {
  const projectId = uuid(body.projectId);
  if (!projectId) { const e = new Error('Bad project id'); e.status = 400; throw e; }

  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    const e = new Error('A valid email address is required'); e.status = 400; throw e;
  }
  const role = body.role === 'edit' ? 'edit' : body.role === 'view' ? 'view' : null;
  if (!role) { const e = new Error('Bad share role'); e.status = 400; throw e; }

  const projects = await rest(`projects?select=id,owner,name&id=eq.${enc(projectId)}&limit=1`);
  const project = projects[0];
  if (!project || project.owner !== user.id) {
    const e = new Error('Only the project owner can share it'); e.status = 403; throw e;
  }
  if (email === String(user.email || '').trim().toLowerCase()) {
    const e = new Error('You already own this project'); e.status = 400; throw e;
  }

  const previous = await rest(`project_shares?project_id=eq.${enc(projectId)}`
    + `&email=eq.${enc(email)}&select=id&limit=1`);
  const rows = await rest(`project_shares?on_conflict=project_id,email&select=${SHARE_COLS}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: { project_id: projectId, email, role },
  });
  const share = rows[0];
  if (!share) throw new Error('The share was not created');

  if (previous.length) return { share, email: { sent: false, skipped: 'existing' } };

  try {
    const id = await sendInviteEmail({ email, role, project, user });
    return { share, email: { sent: true, id } };
  } catch (err) {
    console.error('[share] invitation email failed after the grant was created', err);
    return {
      share,
      email: { sent: false, error: 'delivery-failed' },
      warning: 'The project was shared, but the invitation email could not be sent.',
    };
  }
}

const ACTIONS = { project: openProject, plan: openPlan, invite };

// --- the Open Graph card ---------------------------------------------------

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * THE PICTURE IS THE WORK, and that is the whole point of doing this per-token
 * rather than letting index.html's generic card stand. A plan's `snapshot_path`
 * is the finished layout as a PNG — the same image the plan cards on the
 * dashboard are drawn from — so the card in somebody's chat window shows the
 * lighting rather than a logo.
 *
 * THE NEWEST FINISHED PLAN WINS, and 'ready' is preferred over merely having a
 * snapshot: a project part-way through has snapshots of half-lit drawings, and
 * the card should be the best thing in the project rather than the most recent
 * thing. Falls back to any snapshot, and then to the site's own card, so a
 * project with nothing designed yet still produces a valid link rather than a
 * card with a broken image in it.
 */
async function cardImage(projectId) {
  const cols = 'id,status,snapshot_path,updated_at';
  const ready = await rest(`plans?select=${cols}&project_id=eq.${encodeURIComponent(projectId)}`
    + `&status=eq.ready&snapshot_path=not.is.null&order=updated_at.desc&limit=1`);
  if (ready[0]?.snapshot_path) return { url: publicUrl(ready[0].snapshot_path), type: 'image/png' };

  const any = await rest(`plans?select=${cols}&project_id=eq.${encodeURIComponent(projectId)}`
    + `&snapshot_path=not.is.null&order=updated_at.desc&limit=1`);
  if (any[0]?.snapshot_path) return { url: publicUrl(any[0].snapshot_path), type: 'image/png' };

  return { url: OG_FALLBACK_IMAGE, type: 'image/jpeg' };
}

/**
 * THE PAGE A SCRAPER GETS, AND THE PAGE A PERSON GETS, are the same document —
 * and that is a deliberate choice over the usual user-agent sniff.
 *
 * Sniffing means maintaining a list of crawler strings forever, and getting it
 * wrong in the quiet direction: a new preview bot that is not on the list gets
 * the redirect, follows it, finds the SPA's generic card, and the share looks
 * broken in exactly the client's chat window. So instead every caller gets the
 * meta tags, and the humans among them are moved on by a redirect the scrapers
 * do not run — a script first, and a `<meta refresh>` behind it for a browser
 * with JavaScript off.
 *
 * THE VISIBLE BODY IS NOT DECORATION. It is what a person sees for the ~100ms
 * before the redirect fires, and what they are left looking at if both
 * mechanisms are blocked — so it carries the project name and a real link
 * rather than the word "Redirecting".
 */
function ogPage({ token, title, image, imageType, canonical }) {
  const to = `${SITE}/shared/${encodeURIComponent(token)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · Super Luminal</title>
<meta name="description" content="${esc(OG_DESCRIPTION)}" />
<link rel="canonical" href="${esc(canonical)}" />
<link rel="icon" type="image/png" href="${SITE}/favicon.png" />

<meta property="og:type" content="article" />
<meta property="og:site_name" content="Super Luminal" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(OG_DESCRIPTION)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:secure_url" content="${esc(image)}" />
<meta property="og:image:type" content="${esc(imageType)}" />
<meta property="og:image:alt" content="${esc(title)} — the lighting layout, as laid out in Super Luminal." />
<meta property="og:locale" content="en_US" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(OG_DESCRIPTION)}" />
<meta name="twitter:image" content="${esc(image)}" />

<meta http-equiv="refresh" content="0; url=${esc(to)}" />
<style>
  html,body{margin:0;height:100%;background:#0b0b0d;color:#e1dccd;
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  main{height:100%;display:grid;place-items:center;text-align:center;padding:24px}
  h1{font-size:19px;letter-spacing:-.02em;margin:0 0 8px}
  p{margin:0 0 18px;color:#8b8b8b;font-size:12.5px}
  a{color:#e1dccd}
</style>
</head>
<body>
<main><div>
  <h1>${esc(title)}</h1>
  <p>Opening this lighting layout in Super Luminal…</p>
  <p><a href="${esc(to)}">Continue</a></p>
</div></main>
<script>location.replace(${JSON.stringify(to)});</script>
</body>
</html>`;
}

/**
 * A CARD FOR A LINK THAT IS NOT LIVE. Still 404 — the status code is what stops
 * a dead share being indexed — but still a page, because "404" in a chat preview
 * says nothing and this says what happened.
 */
function gonePage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>This link is no longer live · Super Luminal</title>
<meta name="robots" content="noindex" />
<style>html,body{margin:0;height:100%;background:#0b0b0d;color:#e1dccd;
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  main{height:100%;display:grid;place-items:center;text-align:center;padding:24px}
  h1{font-size:19px;letter-spacing:-.02em;margin:0 0 8px}
  p{margin:0;color:#8b8b8b;font-size:12.5px}a{color:#e1dccd}</style>
</head><body><main><div>
<h1>This link is no longer live</h1>
<p>It was revoked, or the project was deleted. Ask whoever sent it for a new one.</p>
<p><a href="${SITE}/">Super Luminal</a></p>
</div></main></body></html>`;
}

// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  const sendJson = (code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  const sendHtml = (code, html, cache) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', cache);
    res.end(html);
  };

  if (!PROJECT_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('[share] not configured — need SUPABASE_SECRET_KEY, an anon key and a project URL');
    if (req.method === 'GET') return sendHtml(500, gonePage(), 'no-store');
    return sendJson(500, { error: 'Sharing is not configured on this deployment.' });
  }

  // --- the card ------------------------------------------------------------
  if (req.method === 'GET') {
    // THE TOKEN ARRIVES TWO WAYS AND BOTH ARE REAL. In production vercel.json
    // rewrites /s/:token to this handler with ?token=…; in dev the middleware is
    // mounted at /s and the token is the path. Reading both is one line and
    // saves a whole class of "works locally, 404s on Vercel".
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('token')
      || decodeURIComponent(url.pathname.replace(/^\/+(?:s\/)?/, '').split('/')[0] || '');
    try {
      const { project } = await projectForToken(token);
      const image = await cardImage(project.id);
      // A SHORT SHARED CACHE AND NO PRIVATE ONE. The card is the same for every
      // caller, so letting a CDN hold it for a minute takes the scraper stampede
      // that follows a paste in a busy channel down to one origin hit — and a
      // minute is short enough that revoking a link is still effectively
      // immediate.
      return sendHtml(200, ogPage({
        token: shareToken(token),
        title: project.name || 'Lighting layout',
        image: image.url,
        imageType: image.type,
        canonical: `${SITE}/s/${encodeURIComponent(shareToken(token))}`,
      }), 'public, max-age=0, s-maxage=60');
    } catch (err) {
      if ((err?.status || 500) >= 500) console.error('[share] card failed', err);
      return sendHtml(err?.status === 404 ? 404 : 500, gonePage(), 'no-store');
    }
  }

  // --- the app -------------------------------------------------------------
  if (req.method !== 'POST') return sendJson(405, { error: 'POST only' });

  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const run = ACTIONS[body.action];
    if (!run) return sendJson(400, { error: 'Unknown action' });

    const t0 = Date.now();
    const out = await run(body, user);
    // WHO OPENED WHAT. A view-only link is still a door into somebody's work,
    // and a door with no log is a door nobody can answer questions about.
    console.log(`[share] ${user.email} ${body.action}`
      + (body.token ? ` token=${String(body.token).slice(0, 8)}…` : '')
      + (body.projectId ? ` project=${body.projectId}` : '')
      + (body.planId ? ` plan=${body.planId}` : '')
      + ` ${Date.now() - t0}ms`);
    return sendJson(200, out);
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[share] failed', err);
    return sendJson(status, {
      error: status === 401 ? 'Not signed in'
        : status === 404 ? 'No such link'
        : String(err?.message || err),
    });
  }
}
