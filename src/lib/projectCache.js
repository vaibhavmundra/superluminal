// ---------------------------------------------------------------------------
// THE LAST KNOWN ANSWER TO THE TWO LIST SCREENS, IN LOCALSTORAGE.
//
//   the dashboard's projects, keyed by USER    — readProjectCache / saveProjectCache
//   one project's plans,      keyed by PROJECT — readPlansCache   / savePlansCache
//
// WHAT THIS IS FOR. Landing on /dashboard used to mean: download the bundle,
// mount React, wait for the session, and only THEN issue the two selects that
// decide what the page says. Every one of those steps is serial, and the user
// watched three grey rectangles breathe through all of them — on every visit,
// including the fiftieth visit to a list that had not changed since the
// forty-ninth.
//
// So the list is mirrored here on every successful load, and the page paints
// from it SYNCHRONOUSLY on mount. The fetch still happens — it is just no
// longer the thing standing between the user and their projects.
//
// WHY A STALE LIST IS SAFE HERE SPECIFICALLY. The dashboard already holds two
// realtime subscriptions (see subscribeProjects / subscribePlans in db.js), so
// a cache that is wrong is wrong for one round trip and then corrects itself
// without anybody clicking anything. The failure mode is a card that lingers a
// few hundred milliseconds after somebody deleted it in another tab, which is
// a far smaller lie than "Loading…" told to a person whose projects we already
// know.
//
// WHAT IS NOT IN HERE IS THE SHARE ROLE. ProjectDetail gates its Delete links
// and its drop target on `access`, and that value is deliberately `undefined`
// until the real answer arrives so a shared viewer never sees a Delete link
// flash past on the way to not having one. A cached role would reinstate that
// flash and, for somebody downgraded from edit to view since their last visit,
// would offer controls the policies then refuse. The plan CARDS paint from the
// cache; the controls on them wait. RLS was never the thing at risk — a UI that
// lies about what you may do was.
//
// KEYED BY USER ID, AND CLEARED ON SIGN-OUT — see auth.jsx. Both, not either.
// The key stops two accounts on one browser from reading each other's entries;
// the sign-out clear stops the NAMES of one person's buildings from sitting in
// storage after they have left a shared machine. A project name is a client's
// name often enough that this is the one part of the file worth being strict
// about — and the plan entries go with them, for the same reason and in the
// same call.
//
// NOTHING IN HERE THROWS. Private mode, a full quota and a corrupt entry are
// all "no cache", which is the state the app was in before this file existed
// and is therefore always survivable.
// ---------------------------------------------------------------------------

// Exported for the test, which asserts that two accounts on one browser cannot
// read each other's entries — a claim about the KEY, so the test needs the key.
export const PROJECTS_PREFIX = 'superluminal.projects.';
export const PLANS_PREFIX = 'superluminal.plans.';

// HOW MANY ENTRIES EACH PREFIX MAY KEEP, and the two numbers are different
// because the two keys are. There is one projects entry per ACCOUNT — a browser
// sees one, occasionally two — while there is one plans entry per PROJECT, and
// a studio opens dozens over a month. Without a cap the plans side would grow
// until the quota stopped it, which is a bad way to find a limit: the throw
// lands on whichever write happens to be next rather than on the one that was
// too much. Oldest-written go first.
const MAX_PROJECT_ENTRIES = 4;
const MAX_PLAN_ENTRIES = 8;

// A WEEK, and the number is not doing much work. An entry is rewritten on every
// visit, so the only ones that age out belong to an account this browser has
// stopped being used for — which is exactly what should be dropped.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const store = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

const keyFor = (userId) => `${PROJECTS_PREFIX}${userId}`;
const planKeyFor = (projectId) => `${PLANS_PREFIX}${projectId}`;

/**
 * Drop everything under `prefix` that is stale, corrupt, or surplus to `max`.
 * `keepKey` is the entry about to be written and is never counted or touched —
 * it holds one of the `max` slots, so the rest may fill `max - 1`.
 */
function prune(ls, prefix, keepKey, max) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (!k?.startsWith(prefix) || k === keepKey) continue;
    let at = 0;
    try { at = Date.parse(JSON.parse(ls.getItem(k))?.savedAt ?? '') || 0; } catch { /* corrupt */ }
    rows.push({ key: k, at });
  }
  rows.sort((a, b) => b.at - a.at);          // newest first
  const doomed = rows.filter((r, i) => !r.at || now - r.at > MAX_AGE_MS || i >= max - 1);
  for (const d of doomed) { try { ls.removeItem(d.key); } catch { /* ignore */ } }
}

/** The live body under `key`, or null if it is missing, corrupt or past its age. */
function readEntry(ls, key) {
  let raw = null;
  try { raw = ls.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const body = JSON.parse(raw);
    if (Date.now() - (Date.parse(body?.savedAt) || 0) > MAX_AGE_MS) return null;
    return { raw, body };
  } catch { return null; }
}

/**
 * What we last knew about this user's dashboard, or null.
 *
 * Returns `{ projects, shared }` with each list either an array or null — null
 * meaning "never cached", which the page renders as the skeleton it always did.
 * A first-ever visit is therefore unchanged, and correctly so: there is nothing
 * honest to show yet.
 */
export function readProjectCache(userId) {
  const ls = store();
  if (!ls || !userId) return null;
  const entry = readEntry(ls, keyFor(userId));
  if (!entry) return null;
  return {
    projects: Array.isArray(entry.body.projects) ? entry.body.projects : null,
    shared: Array.isArray(entry.body.shared) ? entry.body.shared : null,
  };
}

/**
 * ONE PROJECT OUT OF THE DASHBOARD'S CACHE, own list or shared, or null.
 *
 * ProjectDetail's header waits on `getProject()` for a row the previous screen
 * already had in hand — `listProjects()` returns the whole of PROJECT_COLS, and
 * the card the user clicked was drawn from it. So the name and the category can
 * be right on the first frame, and on a hard refresh too, which is the part
 * router state could not have done.
 *
 * DISPLAY FIELDS ONLY, AND THE CALLER MUST TREAT IT THAT WAY. `owner` is on this
 * row and it is tempting to hand it to myAccess() to settle ownership without a
 * round trip. Don't: that turns a stale row into a privilege decision. See the
 * note on the share role at the top of this file.
 */
export function readCachedProject(userId, projectId) {
  if (!projectId) return null;
  const cached = readProjectCache(userId);
  if (!cached) return null;
  return [...(cached.projects || []), ...(cached.shared || [])]
    .find((p) => p?.id === projectId) ?? null;
}

/**
 * Mirror one or both lists.
 *
 * AN OMITTED FIELD LEAVES THE STORED ONE ALONE, and that is the whole reason
 * this takes an object rather than two arguments. The dashboard settles its two
 * queries independently on purpose — a sharing error must not blank the user's
 * own projects — so the caller passes only what actually came back. Writing
 * `shared: []` because the shares table 404'd would cache the failure and hide
 * a real list on the next visit.
 *
 * AN IDENTICAL BODY IS NOT REWRITTEN, AND THE COMPARISON IS AGAINST STORAGE
 * rather than against a memo of what we last wrote. An editor open in another
 * tab saves every 1.5 seconds, each save is an event on both feeds, and each
 * event coalesces into a refetch that lands back here — so most calls carry a
 * list nothing has changed. A module-level "last body" would be cheaper by one
 * read and would be WRONG: it survives the storage being cleared underneath it,
 * and the first write after that would be skipped as a duplicate of something
 * no longer there. The read was happening anyway for the merge.
 */
export function saveProjectCache(userId, { projects, shared } = {}) {
  const ls = store();
  if (!ls || !userId) return false;
  const key = keyFor(userId);

  // One read, used for both the merge and the compare. An entry that is corrupt
  // or past its age counts as nothing: `prev` goes null, so neither list is
  // carried forward from it and the skip below cannot fire.
  const prev = readEntry(ls, key);

  const next = JSON.stringify({
    savedAt: new Date().toISOString(),
    projects: projects ?? (Array.isArray(prev?.body.projects) ? prev.body.projects : null),
    shared: shared ?? (Array.isArray(prev?.body.shared) ? prev.body.shared : null),
  });
  // The stamp differs on every call, so compare what is under it.
  if (prev && stripStamp(prev.raw) === stripStamp(next)) return true;

  try {
    prune(ls, PROJECTS_PREFIX, key, MAX_PROJECT_ENTRIES);
    ls.setItem(key, next);
    return true;
  } catch { return false; }   // quota, private mode — the page is fine without us
}

/** One project's plan list as we last saw it, or null for "never cached". */
export function readPlansCache(projectId) {
  const ls = store();
  if (!ls || !projectId) return null;
  const entry = readEntry(ls, planKeyFor(projectId));
  return Array.isArray(entry?.body.plans) ? entry.body.plans : null;
}

/**
 * Mirror one project's plans.
 *
 * NO MERGE SEMANTICS HERE, and the asymmetry with saveProjectCache is not an
 * oversight: that one mirrors TWO independently-settled queries and has to be
 * told which of them actually answered. This is one query and one list, so an
 * absent list is a caller bug rather than a partial success, and it is refused
 * rather than quietly written as null.
 *
 * THE CARDS ARE MOSTLY PICTURE, which is why this is worth more here than the
 * row data suggests. PlanCard builds its `<img src>` from `snapshot_path`
 * (a public URL, no signing round trip) — so a cached row means the browser can
 * start fetching the thumbnails on the first frame instead of after the select.
 */
export function savePlansCache(projectId, plans) {
  const ls = store();
  if (!ls || !projectId || !Array.isArray(plans)) return false;
  const key = planKeyFor(projectId);
  const prev = readEntry(ls, key);
  const next = JSON.stringify({ savedAt: new Date().toISOString(), plans });
  if (prev && stripStamp(prev.raw) === stripStamp(next)) return true;
  try {
    prune(ls, PLANS_PREFIX, key, MAX_PLAN_ENTRIES);
    ls.setItem(key, next);
    return true;
  } catch { return false; }
}

const stripStamp = (s) => s.replace(/"savedAt":"[^"]*",/, '');

/**
 * BOTH PREFIXES, AND EVERY ACCOUNT'S ENTRY RATHER THAN JUST THE ONE SIGNING
 * OUT. Somebody leaving a shared machine should not have to trust that we got
 * the key right — and plan names are the same kind of thing as project names,
 * so they leave in the same call. Drafts are NOT touched: they are unsaved work,
 * they are keyed by plan rather than by person, and lib/draft.js ages them out
 * on its own terms.
 */
export function clearCachedLists() {
  const ls = store();
  if (!ls) return;
  const doomed = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k?.startsWith(PROJECTS_PREFIX) || k?.startsWith(PLANS_PREFIX)) doomed.push(k);
  }
  for (const k of doomed) { try { ls.removeItem(k); } catch { /* ignore */ } }
}
