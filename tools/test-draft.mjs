// tools/test-draft.mjs — the local draft, which is the only copy of the last
// second and a half of anybody's work.
//
// WHAT THIS IS GUARDING. lib/draft.js exists because a reload inside the
// autosave's debounce used to lose the edit that was in it — reported as "after
// the render has been analysed and the lights have been placed, when I reload
// the drawing I lose the lights placed by render pass". The rules it has to get
// right are small and all of them are load-bearing:
//
//   a newer draft wins        — the write did not land; this is the only copy
//   a tie goes to the row     — the write DID land, only the delete was missed
//   an older draft is ignored — a leftover from a session already saved over
//   nothing ever throws       — this runs on the unload path
import { saveDraft, readDraft, clearDraft, pickRestore, DRAFT_PREFIX }
  from '../src/lib/draft.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (s) => console.log('\n' + s);

/** localStorage, in about as many lines as the real one's interesting parts. */
function fakeStorage({ quota = Infinity } = {}) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    setItem: (k, v) => {
      const after = [...m.entries()].filter(([kk]) => kk !== k)
        .reduce((n, [kk, vv]) => n + kk.length + vv.length, 0) + k.length + v.length;
      if (after > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, v);
    },
    _map: m,
  };
}

const stateAt = (iso, extra = {}) => ({ savedAt: iso, v: 3, outlines: [{ id: 'o1' }], ...extra });

// ---------------------------------------------------------------------------
section('a draft round trip');
{
  globalThis.localStorage = fakeStorage();
  const st = stateAt('2026-08-31T10:00:00.000Z', { wallResults: { o1: { elements: [{ id: 'we-0' }] } } });
  ok('writes', saveDraft('plan-1', st) === true);
  const got = readDraft('plan-1');
  ok('reads back the same state', JSON.stringify(got.editorState) === JSON.stringify(st));
  ok('carries the stamp', got.savedAt === st.savedAt);
  ok('and the render pass came with it', got.editorState.wallResults.o1.elements[0].id === 'we-0');
  clearDraft('plan-1');
  ok('clearing removes it', readDraft('plan-1') === null);
  ok('and leaves nothing behind',
    ![...globalThis.localStorage._map.keys()].some((k) => k.startsWith(DRAFT_PREFIX)));
}

section('which state opens');
{
  const row = stateAt('2026-08-31T10:00:00.000Z');

  const newer = { editorState: stateAt('2026-08-31T10:00:09.000Z') };
  const a = pickRestore(row, newer);
  ok('a newer draft wins — the write never landed', a.from === 'draft' && a.aheadMs === 9000);

  const tie = { editorState: stateAt('2026-08-31T10:00:00.000Z') };
  ok('a tie goes to the row — the write landed, the delete did not',
    pickRestore(row, tie).from === 'row');

  const older = { editorState: stateAt('2026-08-31T09:59:00.000Z') };
  ok('an older draft is ignored', pickRestore(row, older).from === 'row');

  ok('no draft is just the row', pickRestore(row, null).from === 'row');
  ok('no row and a draft opens the draft', pickRestore(null, newer).from === 'draft');
  ok('neither opens nothing', pickRestore(null, null).state === null);

  ok('an unstamped draft is not trusted over a stamped row',
    pickRestore(row, { editorState: { outlines: [] } }).from === 'row');
  ok('a stamped draft beats an unstamped row',
    pickRestore({ outlines: [] }, newer).from === 'draft');
}

section('storage that says no');
{
  // The quota is the realistic failure, and it is nearly always OTHER plans.
  globalThis.localStorage = fakeStorage({ quota: 400 });
  const big = stateAt('2026-08-31T10:00:00.000Z', { pad: 'x'.repeat(200) });
  saveDraft('old-plan', stateAt('2026-08-01T10:00:00.000Z', { pad: 'y'.repeat(150) }));
  const wrote = saveDraft('plan-2', big);
  ok('makes room by dropping the other plans', wrote === true);
  ok('and the wanted draft is the one that is there', !!readDraft('plan-2'));
  ok('the evicted one is gone', readDraft('old-plan') === null);

  // Still no room even alone: give up quietly rather than throw on an unload.
  globalThis.localStorage = fakeStorage({ quota: 10 });
  let threw = null;
  let out = null;
  try { out = saveDraft('plan-3', big); } catch (e) { threw = e; }
  ok('does not throw when it cannot fit', !threw, String(threw));
  ok('and says so', out === false);
}

section('no storage at all');
{
  delete globalThis.localStorage;             // Safari private mode, SSR, a worker
  let threw = null;
  try {
    saveDraft('plan-4', stateAt('2026-08-31T10:00:00.000Z'));
    readDraft('plan-4');
    clearDraft('plan-4');
  } catch (e) { threw = e; }
  ok('every call is survivable', !threw, String(threw));
}

section('corrupt entries');
{
  globalThis.localStorage = fakeStorage();
  globalThis.localStorage.setItem(`${DRAFT_PREFIX}plan-5`, '{not json');
  ok('a half-written draft reads as absent', readDraft('plan-5') === null);
  globalThis.localStorage.setItem(`${DRAFT_PREFIX}plan-6`,
    JSON.stringify({ planId: 'somebody-else', editorState: stateAt('2026-08-31T10:00:00.000Z') }));
  ok('a draft for another plan is not handed over', readDraft('plan-6') === null);
}

console.log(`\n${fail ? `${fail} FAILED, ` : ''}${pass} passed`);
if (fail) process.exit(1);
console.log('all good');
