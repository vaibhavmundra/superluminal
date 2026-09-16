// tools/test-project-cache.mjs — the dashboard's last known answer.
//
// WHAT THIS IS GUARDING. lib/projectCache.js exists so that landing on
// /dashboard paints the user's projects instead of three breathing rectangles:
// the list is mirrored into localStorage and the screen opens on it while the
// real fetch revalidates underneath. Four rules carry that, and every one of
// them fails quietly rather than loudly if it breaks:
//
//   an omitted list is not written  — a failed shares query must not cache []
//                                     over a real list and hide it next visit
//   two accounts are two entries    — one browser, two people, no bleed
//   a sign-out clears every entry   — project names are client names
//   nothing throws                  — private mode and a full quota are just
//                                     "no cache", which the app survives
import { readProjectCache, saveProjectCache, readCachedProject,
         readPlansCache, savePlansCache, clearCachedLists,
         PROJECTS_PREFIX, PLANS_PREFIX } from '../src/lib/projectCache.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (s) => console.log('\n' + s);

/** localStorage, in about as many lines as the real one's interesting parts. */
function fakeStorage({ quota = Infinity, throwOnGet = false } = {}) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => { if (throwOnGet) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => {
      const after = [...m.entries()].filter(([kk]) => kk !== k)
        .reduce((n, [kk, vv]) => n + kk.length + vv.length, 0) + k.length + v.length;
      if (after > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, v);
    },
    _map: m,
  };
}

const install = (opts) => { globalThis.localStorage = fakeStorage(opts); return globalThis.localStorage; };
const A = 'user-aaaa', B = 'user-bbbb';
const PROJ = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Project ${i}`, planCount: i }));

// --- the round trip --------------------------------------------------------
section('A list written is a list read back');
{
  install();
  ok('nothing cached reads as null', readProjectCache(A) === null);

  saveProjectCache(A, { projects: PROJ(3), shared: [] });
  const got = readProjectCache(A);
  ok('projects come back', got?.projects?.length === 3, JSON.stringify(got?.projects?.length));
  ok('names survive the round trip', got.projects[1].name === 'Project 1');
  ok('planCount survives', got.projects[2].planCount === 2);
  ok('an empty shared list is an empty array, not null', Array.isArray(got.shared) && got.shared.length === 0);
}

// --- the partial write, which is the whole reason it takes an object -------
section('An omitted list leaves the stored one alone');
{
  install();
  saveProjectCache(A, { projects: PROJ(2), shared: [{ id: 's1', name: 'Theirs' }] });
  // THE SHARES QUERY 404s — which really happens, before migration 0006 has run —
  // and the dashboard sets shared to []. It must NOT cache that.
  saveProjectCache(A, { projects: PROJ(4), shared: undefined });
  const got = readProjectCache(A);
  ok('the refreshed list is stored', got.projects.length === 4);
  ok('the untouched list is preserved', got.shared?.length === 1, JSON.stringify(got.shared));

  // And the mirror image: own projects failed, shares came back.
  saveProjectCache(A, { projects: undefined, shared: [] });
  const after = readProjectCache(A);
  ok('a failed projects query does not blank the cache', after.projects.length === 4);
  ok('an explicit empty shared list DOES get written', after.shared.length === 0);
}

// --- two accounts, one browser --------------------------------------------
section('Two accounts cannot read each other');
{
  install();
  saveProjectCache(A, { projects: PROJ(3) });
  saveProjectCache(B, { projects: PROJ(1) });
  ok("A sees only A's", readProjectCache(A).projects.length === 3);
  ok("B sees only B's", readProjectCache(B).projects.length === 1);
  ok('two keys, one per account',
    [...globalThis.localStorage._map.keys()].filter((k) => k.startsWith(PROJECTS_PREFIX)).length === 2);
  ok('an unknown id reads as null', readProjectCache('user-cccc') === null);
  ok('no id reads as null', readProjectCache(undefined) === null);
}

// --- one project out of the dashboard's cache ------------------------------
section('The project row the dashboard already had');
{
  install();
  saveProjectCache(A, {
    projects: [{ id: 'proj-1', name: 'Mine', project_type: 'residential' }],
    shared: [{ id: 'proj-2', name: 'Theirs', project_type: 'hotel', role: 'view' }],
  });
  ok('found in the own list', readCachedProject(A, 'proj-1')?.name === 'Mine');
  ok('found in the shared list too', readCachedProject(A, 'proj-2')?.name === 'Theirs');
  ok('the category comes with it', readCachedProject(A, 'proj-2')?.project_type === 'hotel');
  ok('an unknown project is null', readCachedProject(A, 'proj-9') === null);
  ok('no project id is null', readCachedProject(A, undefined) === null);
  ok("another account cannot reach it", readCachedProject(B, 'proj-1') === null);
}

// --- the plans list --------------------------------------------------------
section("One project's plans");
{
  install();
  const PLANS = (n) => Array.from({ length: n }, (_, i) => ({
    id: `pl${i}`, name: `Plan ${i}`, status: 'designed',
    snapshot_path: `shots/${i}.png`, stats: { rooms: 3, lights: 12 },
  }));

  ok('nothing cached reads as null', readPlansCache('proj-1') === null);
  savePlansCache('proj-1', PLANS(4));
  const got = readPlansCache('proj-1');
  ok('the list comes back', got?.length === 4);
  ok('the snapshot path survives — it is what the card draws', got[2].snapshot_path === 'shots/2.png');
  ok('the counts survive', got[0].stats.lights === 12);
  ok('an empty project caches as an empty list', savePlansCache('proj-2', []) && readPlansCache('proj-2').length === 0);
  ok('two projects do not mix', readPlansCache('proj-1').length === 4);

  // NO MERGE SEMANTICS: one query, one list. A missing list is a caller bug and
  // is refused rather than written as null over a good entry.
  ok('a non-array is refused', savePlansCache('proj-1', undefined) === false);
  ok('and the good entry is untouched', readPlansCache('proj-1').length === 4);
  ok('no project id is refused', savePlansCache(undefined, PLANS(1)) === false);
}

// --- the cap ---------------------------------------------------------------
section('Plan entries do not grow without limit');
{
  const ls = install();
  const one = [{ id: 'pl0', name: 'Plan 0' }];
  for (let i = 0; i < 12; i++) savePlansCache(`proj-${i}`, one);
  const kept = [...ls._map.keys()].filter((k) => k.startsWith(PLANS_PREFIX));
  ok('at most eight plan entries survive', kept.length <= 8, `kept ${kept.length}`);
  ok('the newest is among them', kept.includes(`${PLANS_PREFIX}proj-11`));

  // AND IT IS THE OLDEST THAT GOES. Written in a loop the stamps can share a
  // millisecond, so the one under test is backdated by hand.
  install();
  savePlansCache('old-one', one);
  const key = `${PLANS_PREFIX}old-one`;
  const body = JSON.parse(globalThis.localStorage.getItem(key));
  body.savedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();   // an hour ago
  globalThis.localStorage.setItem(key, JSON.stringify(body));
  for (let i = 0; i < 8; i++) savePlansCache(`fresh-${i}`, one);
  ok('the oldest entry is the one evicted', readPlansCache('old-one') === null);
  ok('a fresh one is still there', readPlansCache('fresh-7')?.length === 1);

  // The projects side has its own, smaller cap — one entry per ACCOUNT.
  const ls2 = install();
  for (let i = 0; i < 9; i++) saveProjectCache(`user-${i}`, { projects: PROJ(1) });
  ok('at most four account entries survive',
    [...ls2._map.keys()].filter((k) => k.startsWith(PROJECTS_PREFIX)).length <= 4);
}

// --- sign-out --------------------------------------------------------------
section('A sign-out takes every account with it');
{
  install();
  globalThis.localStorage.setItem('superluminal.draft.plan-1', '{"keep":true}');
  saveProjectCache(A, { projects: PROJ(3) });
  saveProjectCache(B, { projects: PROJ(2) });
  savePlansCache('proj-1', [{ id: 'pl0', name: 'Plan 0' }]);
  clearCachedLists();
  ok('A is gone', readProjectCache(A) === null);
  ok('B is gone too', readProjectCache(B) === null);
  ok('the plans go with them', readPlansCache('proj-1') === null);
  ok('a draft is not collateral', globalThis.localStorage.getItem('superluminal.draft.plan-1') !== null);

  // THE SKIP-IDENTICAL-WRITES SHORTCUT MUST NOT SURVIVE A CLEAR. If it did, the
  // first write after signing back in would be skipped as "same as last time"
  // and the cache would stay empty until something changed.
  saveProjectCache(A, { projects: PROJ(3) });
  ok('a write straight after a clear still lands', readProjectCache(A)?.projects.length === 3);
}

// --- the write storm -------------------------------------------------------
section('An unchanged list is not rewritten');
{
  const ls = install();
  saveProjectCache(A, { projects: PROJ(3), shared: [] });
  const key = `${PROJECTS_PREFIX}${A}`;
  const first = JSON.parse(ls.getItem(key)).savedAt;

  // The refetch an editor's autosave triggers in another tab: same list, again.
  saveProjectCache(A, { projects: PROJ(3), shared: [] });
  ok('an identical body leaves the stamp alone', JSON.parse(ls.getItem(key)).savedAt === first);

  saveProjectCache(A, { projects: PROJ(4), shared: [] });
  ok('a changed body is written', JSON.parse(ls.getItem(key)).projects.length === 4);

  // AND THE SKIP MUST NOT SURVIVE THE ENTRY GOING AWAY — the bug a module-level
  // memo of the last body would have had. Storage cleared, same list, must land.
  ls.removeItem(key);
  saveProjectCache(A, { projects: PROJ(4), shared: [] });
  ok('a write after the entry vanished still lands', readProjectCache(A)?.projects.length === 4);
}

// --- age -------------------------------------------------------------------
section('A stale entry is not offered');
{
  const ls = install();
  saveProjectCache(A, { projects: PROJ(3) });
  const key = `${PROJECTS_PREFIX}${A}`;
  const body = JSON.parse(ls.getItem(key));
  body.savedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();   // eight days
  ls.setItem(key, JSON.stringify(body));
  ok('a week-old entry reads as null', readProjectCache(A) === null);
}

// --- nothing throws --------------------------------------------------------
section('Every failure is just "no cache"');
{
  install({ quota: 40 });                       // smaller than one entry
  ok('a full quota returns false, not a throw', saveProjectCache(A, { projects: PROJ(9) }) === false);
  ok('and reads back as null', readProjectCache(A) === null);

  install({ throwOnGet: true });                // private mode / blocked storage
  ok('a throwing read is null', readProjectCache(A) === null);

  globalThis.localStorage = undefined;
  ok('no storage at all reads null', readProjectCache(A) === null);
  ok('no storage at all writes false', saveProjectCache(A, { projects: PROJ(1) }) === false);
  ok('no storage, no plans either', readPlansCache('proj-1') === null);
  ok('no storage, no plans write', savePlansCache('proj-1', []) === false);
  ok('no storage, readCachedProject is null', readCachedProject(A, 'proj-1') === null);
  ok('clearing without storage does not throw', (() => { try { clearCachedLists(); return true; } catch { return false; } })());

  install();
  ok('a corrupt entry is null, not a crash', (() => {
    globalThis.localStorage.setItem(`${PROJECTS_PREFIX}${A}`, '{not json');
    return readProjectCache(A) === null;
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
