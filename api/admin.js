// ---------------------------------------------------------------------------
// api/admin.js — the operator's console, and the only place the service key is
// allowed to answer a question on somebody else's behalf.
//
// THE WHOLE POINT OF THIS FILE IS THAT THE BROWSER IS NOT TRUSTED.
//
// `useAuth().isAdmin` decides whether a link appears in the rail. That is a UI
// convenience and nothing more — the comment in src/lib/auth.jsx says as much,
// and it is right: anybody can set a boolean in a console. So every request that
// arrives here is checked from scratch, in this order, and any failure is a flat
// refusal with no detail:
//
//   1. There is a bearer token.
//   2. Supabase says that token belongs to a real, current user (verified by
//      asking /auth/v1/user with the ANON key — the token is the credential, and
//      this is the call that actually validates the signature and the expiry).
//   3. That user's `profiles.role` is 1, read WITH THE SERVICE KEY. Not from the
//      JWT, not from anything the caller sent. The column is also frozen against
//      self-service promotion by a trigger (migration 0003), so the two halves
//      agree: a user cannot grant themselves the role, and asserting it buys
//      nothing.
//
// Only after all three does the service key touch any data. The key bypasses RLS
// entirely — that is why it exists and why it must never be reachable any other
// way — so the three checks above ARE the access control for every row this file
// can see.
//
// WHY NOT RLS POLICIES FOR ADMINS INSTEAD. Because every query in src/lib/db.js
// relies on RLS alone for its scoping: `listProjects()` has no `where owner =`
// clause, it just selects and trusts the policy. Punching an admin-shaped hole
// in that policy would make the admin's OWN dashboard silently list every user's
// projects. The read that crosses accounts is a different question asked by a
// different screen, so it gets a different door.
//
// Runs unchanged in two places — a Vercel function in production, Vite dev
// middleware on localhost (see vite.config.js) — which is why the body is read
// defensively: Vercel parses JSON, Vite does not.
// ---------------------------------------------------------------------------

const PROJECT_URL = process.env.SUPABASE_URL
  || (process.env.SUPABASE_PROJECT_ID ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co` : '')
  // Last resort. The browser-side name is the same project; it is only ever a
  // URL, never a credential, so reading it here is not a leak in either
  // direction.
  || process.env.VITE_SUPABASE_URL
  || '';

const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// The card columns, copied from src/lib/db.js for the reason given there: a list
// of plans must never drag `editor_state`, `design_json` and `boq_json` over the
// wire. Those three are routinely megabytes each and a page of twenty plans
// would be a hundred-megabyte response to print twenty filenames.
const PLAN_CARD_COLS =
  'id, project_id, owner, name, status, source_kind, file_name, storage_path, snapshot_path,'
  + ' width, height, px_per_ft, project_type, stats, created_at, updated_at, last_opened_at';

const PER_PAGE_MAX = 100;

/** Read the body whichever way it arrived. */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

/**
 * One PostgREST call with the service key.
 *
 * `count` asks for the exact total in the Content-Range header, which is what
 * pagination needs and what a naive `select` cannot tell you: the page you got
 * back says nothing about how many pages there are.
 */
async function rest(path, { count = false, range = null } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: 'application/json',
  };
  if (count) headers.Prefer = 'count=exact';
  if (range) headers.Range = range;

  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, { headers });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`supabase ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  let rows = [];
  try { rows = text ? JSON.parse(text) : []; } catch { rows = []; }
  // "0-19/347" — the total is what is after the slash, and it is "*" when the
  // count was not asked for.
  const cr = res.headers.get('content-range') || '';
  const total = Number((cr.split('/')[1] ?? '').trim());
  return { rows, total: Number.isFinite(total) ? total : null };
}

/**
 * WHO IS ASKING, AND MAY THEY. Returns the caller's profile row, or throws.
 *
 * The two calls are deliberately not merged. The first VALIDATES the token —
 * only Supabase can do that, and it is the one thing a forged request cannot
 * fake. The second reads the role from the database rather than from the token's
 * claims, because a claim is whatever was minted when the session began and the
 * role can be revoked between then and now.
 */
async function requireAdmin(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || '';
  const token = /^Bearer\s+(.+)$/i.exec(raw)?.[1]?.trim();
  if (!token) { const e = new Error('Not signed in'); e.status = 401; throw e; }

  const who = await fetch(`${PROJECT_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!who.ok) { const e = new Error('Not signed in'); e.status = 401; throw e; }
  const user = await who.json();
  if (!user?.id) { const e = new Error('Not signed in'); e.status = 401; throw e; }

  const { rows } = await rest(
    `profiles?select=id,email,full_name,role&id=eq.${encodeURIComponent(user.id)}&limit=1`);
  // ROLE 1 AND NOTHING ELSE. Not >= 1, not truthy — a role column that grows a
  // third value later must not silently hand that value the keys to every
  // account in the database.
  if (rows[0]?.role !== 1) { const e = new Error('Not allowed'); e.status = 403; throw e; }
  return rows[0];
}

const clampPage = (b) => {
  const page = Math.max(1, Math.floor(Number(b.page) || 1));
  const perPage = Math.min(PER_PAGE_MAX, Math.max(1, Math.floor(Number(b.perPage) || 20)));
  return { page, perPage, from: (page - 1) * perPage, to: page * perPage - 1 };
};

/** A uuid, or nothing. Interpolated into a PostgREST filter, so it is checked. */
const uuid = (v) =>
  (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v : null);

// --- the actions -----------------------------------------------------------

/**
 * EVERY USER, WITH THE THREE NUMBERS. One query against admin_user_stats — see
 * the migration for why the counting happens in the database and not here.
 */
async function listUsers(b) {
  const { page, perPage, from, to } = clampPage(b);

  // Sort. A whitelist rather than a passthrough: this string goes into the query
  // and "order by whatever the client said" is how a filter becomes an injection.
  const SORTS = {
    active: 'last_active.desc.nullslast',
    plans: 'plans.desc',
    ready: 'plans_ready.desc',
    projects: 'projects.desc',
    joined: 'created_at.desc',
    email: 'email.asc',
  };
  const order = SORTS[b.sort] || SORTS.active;

  let filter = '';
  const q = typeof b.q === 'string' ? b.q.trim() : '';
  if (q) {
    // `or=(email.ilike.*x*,full_name.ilike.*x*)`. Commas and parens would break
    // out of the filter grouping, so they are stripped rather than escaped —
    // this is a search box, not an expression language.
    const safe = encodeURIComponent(q.replace(/[(),*]/g, ''));
    filter = `&or=(email.ilike.*${safe}*,full_name.ilike.*${safe}*)`;
  }

  const { rows, total } = await rest(
    `admin_user_stats?select=*&order=${order}${filter}`,
    { count: true, range: `${from}-${to}` });

  return { users: rows, page, perPage, total, pages: total == null ? null : Math.ceil(total / perPage) };
}

/** One user's projects, newest first, with the plan count each card prints. */
async function listUserProjects(b) {
  const owner = uuid(b.userId);
  if (!owner) { const e = new Error('Bad user id'); e.status = 400; throw e; }
  const { page, perPage, from, to } = clampPage({ ...b, perPage: b.perPage || 24 });

  const [{ rows, total }, profile] = await Promise.all([
    rest(`projects?select=id,name,project_type,created_at,updated_at,plans(count)`
       + `&owner=eq.${owner}&order=updated_at.desc`,
      { count: true, range: `${from}-${to}` }),
    rest(`profiles?select=id,email,full_name,role&id=eq.${owner}&limit=1`),
  ]);

  return {
    user: profile.rows[0] ?? null,
    // Supabase returns an aggregate as a one-element array of {count}, exactly as
    // it does for the user's own dashboard. Flattened here so no card has to know.
    projects: rows.map((p) => ({ ...p, planCount: p.plans?.[0]?.count ?? 0, plans: undefined })),
    page, perPage, total, pages: total == null ? null : Math.ceil(total / perPage),
  };
}

/**
 * One user's plans — the whole account when `projectId` is absent, which is what
 * the "recently worked on" strip wants, and one project's when it is present.
 */
async function listUserPlans(b) {
  const owner = uuid(b.userId);
  if (!owner) { const e = new Error('Bad user id'); e.status = 400; throw e; }
  const projectId = b.projectId ? uuid(b.projectId) : null;
  if (b.projectId && !projectId) { const e = new Error('Bad project id'); e.status = 400; throw e; }
  const { page, perPage, from, to } = clampPage({ ...b, perPage: b.perPage || 24 });

  const scope = projectId ? `&project_id=eq.${projectId}` : '';
  const { rows, total } = await rest(
    `plans?select=${encodeURIComponent(PLAN_CARD_COLS)},projects(name)`
    + `&owner=eq.${owner}${scope}&order=updated_at.desc`,
    { count: true, range: `${from}-${to}` });

  let project = null;
  if (projectId) {
    const r = await rest(`projects?select=id,name,project_type,created_at,updated_at`
      + `&id=eq.${projectId}&owner=eq.${owner}&limit=1`);
    project = r.rows[0] ?? null;
  }

  return { plans: rows, project, page, perPage, total,
           pages: total == null ? null : Math.ceil(total / perPage) };
}

/**
 * ONE PLAN, WHOLE — the jsonb included, because this is what the read-only
 * viewer restores from and `editor_state` IS the drawing's interpretation.
 *
 * The only action here that returns a heavy row, and the only one called for a
 * single record at a time. It also returns the owner's profile so the viewer can
 * say whose plan is on screen without a second round trip.
 */
async function getPlanFull(b) {
  const planId = uuid(b.planId);
  if (!planId) { const e = new Error('Bad plan id'); e.status = 400; throw e; }

  const { rows } = await rest(`plans?select=*&id=eq.${planId}&limit=1`);
  const plan = rows[0];
  if (!plan) { const e = new Error('No such plan'); e.status = 404; throw e; }

  const [owner, project] = await Promise.all([
    rest(`profiles?select=id,email,full_name&id=eq.${encodeURIComponent(plan.owner)}&limit=1`),
    plan.project_id
      ? rest(`projects?select=id,name&id=eq.${encodeURIComponent(plan.project_id)}&limit=1`)
      : Promise.resolve({ rows: [] }),
  ]);

  return { plan, owner: owner.rows[0] ?? null, project: project.rows[0] ?? null };
}

const ACTIONS = {
  users: listUsers,
  projects: listUserProjects,
  plans: listUserPlans,
  plan: getPlanFull,
};

// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  const send = (code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    // A console reading live account data has no business in any cache, least of
    // all a shared one.
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'POST') return send(405, { error: 'POST only' });

  if (!PROJECT_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('[admin] not configured — need SUPABASE_SECRET_KEY, an anon key and a project URL');
    return send(500, { error: 'The admin console is not configured on this deployment.' });
  }

  try {
    const admin = await requireAdmin(req);
    const body = await readBody(req);
    const run = ACTIONS[body.action];
    if (!run) return send(400, { error: 'Unknown action' });

    const t0 = Date.now();
    const out = await run(body);
    // WHO LOOKED AT WHAT. Reading another person's drawings is a privileged act
    // and privileged acts leave a trace, even in an MVP where the trace is only
    // a function log.
    console.log(`[admin] ${admin.email} ${body.action}`
      + (body.userId ? ` user=${body.userId}` : '')
      + (body.planId ? ` plan=${body.planId}` : '')
      + ` ${Date.now() - t0}ms`);
    return send(200, out);
  } catch (err) {
    const status = err?.status || 500;
    // 401 and 403 say nothing more than that. Anything else is ours and is worth
    // reading in the logs.
    if (status >= 500) console.error('[admin] failed', err);
    return send(status, { error: status === 401 ? 'Not signed in'
      : status === 403 ? 'Not allowed'
      : String(err?.message || err) });
  }
}
