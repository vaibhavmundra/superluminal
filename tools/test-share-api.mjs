// ---------------------------------------------------------------------------
// test-share-api.mjs — the gate on a view link.
//
// THE SECOND FILE IN tools/ TESTING A SECURITY BOUNDARY rather than a geometry
// function, and it is here for the same reason test-admin-api.mjs is: this
// endpoint holds the service key, which bypasses row-level security entirely.
// Everywhere else in this app a mistake shows up as an empty list; here it shows
// up as one studio reading another's drawings, with nothing on screen to say so.
//
// WHAT IS ACTUALLY BEING TESTED is that the TOKEN decides the scope. A caller
// sends two things — a session and a plan id — and neither of them may widen
// what comes back. The dangerous case is not a stranger with no token; it is a
// person holding a perfectly good link to project A, asking for a plan in
// project B. That case is the reason `openPlan` re-derives the project from the
// token and filters the plan by it, and it is asserted below.
//
// `fetch` is stubbed, so this needs no key, no network and no database.
//
//   node tools/test-share-api.mjs
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'service-key-not-real';
process.env.SUPABASE_ANON_KEY = 'anon-key-not-real';
process.env.PUBLIC_SITE_URL = 'https://superluminal.test';

const { default: handler } = await import('../api/share.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

const TOKEN = 'abcdefghijklmnopqrstuvwx';
const PROJECT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PLAN = '11111111-2222-3333-4444-555555555555';
const OTHER_PLAN = '99999999-8888-7777-6666-555555555555';

/**
 * A fake Supabase holding exactly one link, one project and one plan. `plans`
 * honours the `project_id=eq.` filter, which is the whole point — a stub that
 * ignored it would pass the cross-project test while the real database failed
 * it, which is worse than no test.
 */
let asked = [];
function stub({ tokenValid = true, link = true, snapshot = null, status = 'ready',
                who = { id: 'user-1', email: 'reader@x.io' },
                owner = 'owner-1', shareRole = null } = {}) {
  asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return tokenValid
        ? { ok: true, status: 200, json: async () => who }
        : { ok: false, status: 401, json: async () => ({}), text: async () => 'bad jwt' };
    }
    asked.push(u);
    const json = (v) => ({ ok: true, status: 200, text: async () => JSON.stringify(v) });

    if (u.includes('/rest/v1/project_share_links')) {
      return json(link && u.includes(TOKEN) ? [{ token: TOKEN, project_id: PROJECT }] : []);
    }
    // The standing grant, if the fixture says this caller has one.
    if (u.includes('/rest/v1/project_shares')) {
      return json(shareRole ? [{ role: shareRole }] : []);
    }
    if (u.includes('/rest/v1/projects')) {
      return json(u.includes(PROJECT) ? [{ id: PROJECT, owner, name: 'Mehta Residence' }] : []);
    }
    if (u.includes('/rest/v1/plans')) {
      // The scope filter, honoured. Anything asking for a plan outside the
      // link's project gets nothing, exactly as PostgREST would answer.
      if (!u.includes(`project_id=eq.${PROJECT}`)) return json([]);
      if (u.includes(`id=eq.${OTHER_PLAN}`)) return json([]);
      return json([{ id: PLAN, project_id: PROJECT, name: 'Ground floor',
                     status, snapshot_path: snapshot, editor_state: { outlines: [] } }]);
    }
    return json([]);
  };
}

async function run({ method = 'POST', auth = 'Bearer tok', body = {}, url = '/api/share' } = {}) {
  let code = 0, out = '', type = '';
  const res = {
    statusCode: 0,
    setHeader(k, v) { if (String(k).toLowerCase() === 'content-type') type = v; },
    end(b) { out = b ?? ''; code = this.statusCode; },
  };
  await handler({ method, url, headers: auth ? { authorization: auth } : {}, body }, res);
  return { code, type, raw: out, body: type.includes('json') ? JSON.parse(out || '{}') : null };
}

// --- the refusals ----------------------------------------------------------

stub();
let r = await run({ method: 'PUT' });
ok(r.code === 405, 'anything but GET or POST is refused');

stub();
r = await run({ auth: null, body: { action: 'project', token: TOKEN } });
ok(r.code === 401, 'no Authorization header → 401');
ok(asked.length === 0, '...and no query is sent to the database');

stub({ tokenValid: false });
r = await run({ body: { action: 'project', token: TOKEN } });
ok(r.code === 401, 'a session token Supabase rejects → 401');
ok(asked.length === 0, '...and still nothing is read');

stub();
r = await run({ body: { action: 'nonsense', token: TOKEN } });
ok(r.code === 400, 'an unknown action → 400');

// THE SHARE TOKEN IS CHECKED FOR SHAPE BEFORE IT IS INTERPOLATED. It goes into a
// PostgREST filter, so a token carrying a path or a comma must be turned away
// rather than escaped.
for (const bad of ['../../rest/v1/profiles?select=*', 'short', 'has spaces', 'a,b']) {
  stub();
  r = await run({ body: { action: 'project', token: bad } });
  ok(r.code === 404, `a malformed token (${JSON.stringify(bad.slice(0, 18))}) → 404`);
  ok(asked.length === 0, '...and it never reaches the database');
}

stub({ link: false });
r = await run({ body: { action: 'project', token: TOKEN } });
ok(r.code === 404, 'a revoked link → 404');

// --- the case this file exists for ----------------------------------------
//
// A VALID LINK TO ONE PROJECT, AND A PLAN ID FROM ANOTHER. If the handler ever
// looks the plan up by id alone, this returns somebody else's drawing to
// somebody holding an unrelated link.
stub();
r = await run({ body: { action: 'plan', token: TOKEN, planId: OTHER_PLAN } });
ok(r.code === 404, 'a plan outside the link’s project → 404');
const planQ = asked.find((u) => u.includes('/rest/v1/plans')) || '';
ok(planQ.includes(`project_id=eq.${PROJECT}`),
   '...because the query is scoped by the project the TOKEN names, not by the id sent');

stub();
r = await run({ body: { action: 'plan', token: TOKEN, planId: 'not-a-uuid' } });
ok(r.code === 400, 'a planId that is not a uuid → 400, never interpolated');

// --- and now a reader with a good link ------------------------------------

stub();
r = await run({ body: { action: 'project', token: TOKEN } });
ok(r.code === 200, 'a live link → 200');
ok(r.body.project?.name === 'Mehta Residence', 'the project comes back');
ok(r.body.access === 'view', 'and it says view, which is the only thing a link ever grants');
ok(r.body.grant === null,
   'a stranger holding the link has no standing grant, so the viewer is the right screen');
const listQ = asked.find((u) => u.includes('/rest/v1/plans')) || '';
ok(!listQ.includes('editor_state') && !listQ.includes('select=*'),
   'the plan LIST asks for card columns only — never the jsonb');

stub();
r = await run({ body: { action: 'plan', token: TOKEN, planId: PLAN } });
ok(r.code === 200 && r.body.plan?.id === PLAN, 'one plan inside the link’s project → 200');
ok(r.body.plan?.editor_state, 'and it is the WHOLE row, because the viewer restores from it');

// --- THE LINK DOES NOT DEMOTE ANYBODY --------------------------------------
//
// A link is a POINTER to a project. Somebody already on the share list who
// follows it must end up with the access their row grants — not capped at view
// because of the door they came through. The endpoint says what they really
// are; the routes redirect on it. Without this, sending one link to a team means
// silently telling every editor on it that they cannot edit.

stub({ shareRole: 'edit' });
r = await run({ body: { action: 'project', token: TOKEN } });
ok(r.body.grant === 'edit', 'an invited EDITOR following the link is reported as an editor');

stub({ shareRole: 'view' });
r = await run({ body: { action: 'project', token: TOKEN } });
ok(r.body.grant === 'view', 'an invited viewer is reported as a named viewer, not a stranger');

stub({ owner: 'user-1' });
r = await run({ body: { action: 'project', token: TOKEN } });
ok(r.body.grant === 'owner', 'the project’s own owner following their own link is the owner');
ok(!asked.some((u) => u.includes('project_shares')),
   '...settled from the project row, without asking the share table');

// THE GRANT IS KEYED ON THE ADDRESS, exactly as share_role() is in the database:
// an invite written before that address had an account still has to match.
stub({ shareRole: 'edit' });
await run({ body: { action: 'project', token: TOKEN } });
const grantQ = decodeURIComponent(asked.find((u) => u.includes('project_shares')) || '');
ok(grantQ.includes('invited_user.eq.user-1') && grantQ.includes('email.eq.reader@x.io'),
   'both the user id and the lowercased address are tested');

stub({ who: { id: 'user-1', email: 'READER@X.io' }, shareRole: 'view' });
await run({ body: { action: 'project', token: TOKEN } });
ok(decodeURIComponent(asked.find((u) => u.includes('project_shares')) || '')
     .includes('email.eq.reader@x.io'),
   'a mixed-case session address is lowercased before it is matched');

stub({ shareRole: 'edit' });
r = await run({ body: { action: 'plan', token: TOKEN, planId: PLAN } });
ok(r.body.grant === 'edit', 'and the same is true opening one plan through the link');

// --- the Open Graph card ---------------------------------------------------

stub({ snapshot: 'owner/plan/snapshot.png' });
r = await run({ method: 'GET', auth: null, url: `/api/share?token=${TOKEN}` });
ok(r.code === 200 && r.type.includes('text/html'), 'the card needs no session — a scraper has none');
ok(r.raw.includes('<meta property="og:title" content="Mehta Residence" />'),
   'the project’s name is the title');
ok(r.raw.includes('/storage/v1/object/public/uploads/owner/plan/snapshot.png'),
   'the finished layout’s snapshot is the picture');
ok(/og:image" content="https:\/\//.test(r.raw),
   'and the image url is ABSOLUTE — a relative one is a card with no picture, silently');
ok(r.raw.includes('superluminal.test/shared/' + TOKEN),
   'a real browser is redirected on to the app route');
ok(!r.raw.includes('editor_state'), 'and the card carries no row data at all');

// THE DEV PATH. In production vercel.json rewrites /s/:token to ?token=…; on
// localhost the same handler is mounted at /s and the token is the path.
stub({ snapshot: 'owner/plan/snapshot.png' });
r = await run({ method: 'GET', auth: null, url: `/${TOKEN}` });
ok(r.code === 200 && r.raw.includes('Mehta Residence'),
   'the token is also read from the path, so localhost and Vercel agree');

// NO SNAPSHOT ANYWHERE IN THE PROJECT: the card still has to be valid.
stub({ snapshot: null });
r = await run({ method: 'GET', auth: null, url: `/api/share?token=${TOKEN}` });
ok(r.code === 200 && r.raw.includes('superluminal.test/superluminal-og.jpg'),
   'a project with nothing designed yet falls back to the site’s own card');

stub({ link: false });
r = await run({ method: 'GET', auth: null, url: '/api/share?token=' + TOKEN });
ok(r.code === 404 && r.raw.includes('no longer live'),
   'a dead link is a 404 AND a page — "404" in a chat preview says nothing');
ok(r.raw.includes('noindex'), '...and it asks not to be indexed');

// --- misconfiguration ------------------------------------------------------

const key = process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SECRET_KEY;
const fresh = (await import('../api/share.js?nokey=1')).default;
let code2 = 0;
await fresh({ method: 'POST', headers: { authorization: 'Bearer t' }, body: {} },
  { statusCode: 0, setHeader() {}, end() { code2 = this.statusCode; } });
ok(code2 === 500, 'with no service key the endpoint refuses everything, rather than half-working');
process.env.SUPABASE_SECRET_KEY = key;

console.log(fail ? `\n${fail} failed` : '\nshare api: all good');
process.exit(fail ? 1 : 0);
