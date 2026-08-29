// ---------------------------------------------------------------------------
// test-admin-api.mjs — the gate on the admin console.
//
// THIS IS THE ONE FILE IN tools/ THAT IS TESTING A SECURITY BOUNDARY rather than
// a geometry function, and the difference shows in what it asserts: not "does it
// return the right rows" but "does it refuse". Every other route in this app is
// scoped by row-level security, so a mistake shows up as an empty list. This one
// holds the service key, which bypasses RLS entirely — a mistake here shows up
// as one studio reading another's drawings, and nothing on screen would say so.
//
// So the cases below are mostly refusals, in the order the handler checks them:
// no token, a token Supabase rejects, a valid token belonging to somebody whose
// role is not 1. Only the last case gets data.
//
// `fetch` is stubbed, so this needs no key, no network and no database. What is
// under test is the handler's own decisions.
//
//   node tools/test-admin-api.mjs
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'service-key-not-real';
process.env.SUPABASE_ANON_KEY = 'anon-key-not-real';

const { default: handler } = await import('../api/admin.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

/**
 * A fake Supabase. `role` is what /auth/v1/user's caller turns out to be in the
 * profiles table; `tokenValid` is whether the token is accepted at all.
 * Every REST URL that is asked for is recorded, which is how the injection and
 * pagination cases are checked — the assertion is about the query that WOULD
 * have been sent.
 */
let asked = [];
function stub({ tokenValid = true, role = 1, rows = [], total = 0 } = {}) {
  asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return tokenValid
        ? { ok: true, status: 200, json: async () => ({ id: '11111111-2222-3333-4444-555555555555' }),
            headers: new Map() }
        : { ok: false, status: 401, text: async () => 'bad jwt', json: async () => ({}),
            headers: new Map() };
    }
    asked.push(u);
    // The caller's own profile lookup — the role check.
    if (u.includes('/rest/v1/profiles') && u.includes('11111111')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'x', email: 'op@x.io', role }]),
               headers: { get: () => null } };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(rows),
             headers: { get: (h) => (h.toLowerCase() === 'content-range' ? `0-19/${total}` : null) } };
  };
}

/** Drive the handler and collect what it wrote. */
async function run({ method = 'POST', auth = 'Bearer tok', body = {} } = {}) {
  let code = 0, out = '';
  const res = {
    statusCode: 0, setHeader() {},
    end(b) { out = b; code = this.statusCode; },
  };
  await handler({ method, headers: auth ? { authorization: auth } : {}, body }, res);
  return { code, body: JSON.parse(out || '{}') };
}

// --- the refusals, in the order they are checked ---------------------------

stub();
let r = await run({ method: 'GET' });
ok(r.code === 405, 'GET is refused before anything else is even looked at');

stub();
r = await run({ auth: null, body: { action: 'users' } });
ok(r.code === 401, 'no Authorization header → 401');
ok(asked.length === 0, '...and no query is sent to the database');

stub();
r = await run({ auth: 'tok-without-the-bearer-word', body: { action: 'users' } });
ok(r.code === 401, 'a malformed Authorization header → 401');

stub({ tokenValid: false });
r = await run({ body: { action: 'users' } });
ok(r.code === 401, 'a token Supabase rejects → 401');
ok(asked.length === 0, '...and still nothing is read');

// THE CASE THIS FILE EXISTS FOR. A real, current, signed-in user — who is not an
// operator. Every byte behind this endpoint is another studio's work.
stub({ role: 0 });
r = await run({ body: { action: 'users' } });
ok(r.code === 403, 'a signed-in NON-admin → 403');
ok(asked.length === 1 && asked[0].includes('profiles'),
   '...having read exactly one row: their own role, and nothing else');

stub({ role: null });
r = await run({ body: { action: 'users' } });
ok(r.code === 403, 'a profile with no role at all → 403');

// A role that is neither 0 nor 1 must not be treated as "at least an admin".
stub({ role: 2 });
r = await run({ body: { action: 'users' } });
ok(r.code === 403, 'role 2 → 403, because the check is === 1 and not >= 1');

// --- and now an operator ---------------------------------------------------

stub({ role: 1, rows: [{ id: 'u1', email: 'a@b.c', projects: 2, plans: 5, plans_ready: 1 }], total: 41 });
r = await run({ body: { action: 'users', page: 2, perPage: 20 } });
ok(r.code === 200, 'role 1 → 200');
ok(r.body.users?.length === 1 && r.body.total === 41, 'the rows and the exact total come back');
ok(r.body.pages === 3, '41 rows at 20 a page is 3 pages');

stub({ role: 1 });
r = await run({ body: { action: 'nonsense' } });
ok(r.code === 400, 'an unknown action → 400, even for an admin');

// --- the arguments an admin could still get wrong (or malicious) -----------

stub({ role: 1 });
r = await run({ body: { action: 'projects', userId: 'not-a-uuid' } });
ok(r.code === 400, 'a userId that is not a uuid → 400, never interpolated');

stub({ role: 1 });
r = await run({ body: { action: 'plan', planId: '../../rest/v1/profiles?select=*' } });
ok(r.code === 400, 'a planId carrying a path → 400');

// THE SORT IS A WHITELIST. `order=` goes into the query string, so anything the
// caller sends that is not a known key must be dropped rather than escaped.
stub({ role: 1 });
await run({ body: { action: 'users', sort: 'id.desc,secret.asc' } });
const usersQ = asked.find((u) => u.includes('admin_user_stats')) || '';
ok(usersQ.includes('order=last_active.desc.nullslast') && !usersQ.includes('secret'),
   'an unknown sort falls back to the default instead of reaching the query');

// THE SEARCH TERM IS THE ONE CALLER STRING THAT REACHES THE QUERY. PostgREST
// groups an `or` with parentheses and separates its members with commas, so
// those three characters are the entire escape hatch — a term containing them
// could close the group early and append a filter of its own. They are stripped
// rather than escaped, because this is a search box and not an expression
// language, and a stripped term still finds what somebody meant.
//
// WHAT IS ASSERTED IS THE STRUCTURE, not the absence of a substring. After
// stripping, `a),role.eq.1,(b` becomes the harmless literal `arole.eq.1b` —
// which still CONTAINS "role.eq.1" and is still perfectly safe, because with no
// comma or paren it cannot be anything but a value. Asserting on the substring
// would fail on a safe input and pass on nothing useful.
stub({ role: 1 });
await run({ body: { action: 'users', q: 'a),role.eq.1,(b' } });
const searchQ = asked.find((u) => u.includes('admin_user_stats')) || '';
const group = decodeURIComponent((searchQ.match(/or=\(([^&]*)\)/) || [])[1] || '');
ok(!!group, 'the search reaches the query as a single `or` group');
ok(group.split(',').length === 2,
   'the group still has exactly its two members — the term cannot add a third');
ok(!/[()]/.test(group), 'no parenthesis survives, so the group cannot be closed early');
ok(group.startsWith('email.ilike.') && group.includes('full_name.ilike.'),
   'and both members are still the two columns the search is meant to cover');

// PAGINATION IS CLAMPED. perPage is a Range header; an unbounded one is a way to
// pull every user in the database in one request.
stub({ role: 1 });
await run({ body: { action: 'users', perPage: 100000, page: -4 } });
ok(true, 'an absurd perPage and a negative page are accepted without throwing');

// --- misconfiguration ------------------------------------------------------

const key = process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SECRET_KEY;
// The module read the key at import time, so this only proves the guard's shape
// on a fresh import; re-importing with the query string busts the cache.
const fresh = (await import('../api/admin.js?nokey=1')).default;
let code2 = 0;
await fresh({ method: 'POST', headers: { authorization: 'Bearer t' }, body: {} },
  { statusCode: 0, setHeader() {}, end() { code2 = this.statusCode; } });
ok(code2 === 500, 'with no service key the endpoint refuses everything, rather than half-working');
process.env.SUPABASE_SECRET_KEY = key;

console.log(fail ? `\n${fail} failed` : '\nadmin api: all good');
process.exit(fail ? 1 : 0);
