// ---------------------------------------------------------------------------
// THE LOCAL DRAFT — the thing that survives a reload the network did not.
//
// WHY THIS EXISTS. The autosave in routes/Planner.jsx is debounced by a second
// and a half, and that debounce is correct: dragging a strip fires a state
// change per pointermove and writing each one would be a hundred requests for
// one gesture. But it means there is always a window, up to QUIET_MS plus the
// round trip, in which the newest edit exists only in React state.
//
// A reload inside that window loses it. `beforeunload` was supposed to cover
// this and DOES NOT, for a reason worth writing down: the flush is async — it
// awaits whenRowReady and then a supabase-js call — and a fetch that is still
// in flight when the document unloads is CANCELLED by the browser. The request
// leaves, sometimes, depending on how far it got. Which is exactly the shape of
// the bug this was written for: "sometimes when I reload I lose the lights the
// render pass placed". Not always. Sometimes. The render pass is simply the
// last thing anybody does before reloading, so it is the change most often
// sitting in the window when the page goes away.
//
// SO THE WRITE IS MADE SYNCHRONOUS AND LOCAL. Every payload the editor hands
// the route is mirrored into localStorage on the spot — no await, no network,
// nothing to cancel — and deleted again the moment the real write to Postgres
// lands. On open, if a draft is still there and is NEWER than what came back
// from the database, the draft is what the editor restores.
//
// A LEFTOVER DRAFT IS THEREFORE EVIDENCE, not noise: it means the last write
// did not complete. Preferring it is the whole point.
//
// WHY NOT sendBeacon / fetch(keepalive). Both were considered. sendBeacon
// cannot set an Authorization header, and keepalive caps the body at 64KB —
// an editor_state with forty outlines and a few hundred detections goes past
// that, and the failure would be silent and size-dependent, which is a worse
// bug than the one being fixed. localStorage has neither limit in practice and
// costs nothing.
//
// WHAT IS NOT KEPT. Only `editor_state`. The design and the BOQ are derived
// from it by the editor on the next render, and the snapshot is a thumbnail.
// One object, the same one planState.js defines, and nothing invented here.
// ---------------------------------------------------------------------------

const PREFIX = 'superluminal.draft.';

// Old drafts are dead weight, not history — anything this age has either been
// saved properly long ago or belongs to a plan that no longer exists.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;   // a fortnight
const MAX_DRAFTS = 8;

const store = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

const keyFor = (planId) => `${PREFIX}${planId}`;

/** Every draft key currently in storage, newest-first, with its stamp. */
function allDrafts(ls) {
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    let at = 0;
    try { at = Date.parse(JSON.parse(ls.getItem(k))?.savedAt ?? '') || 0; } catch { /* corrupt */ }
    out.push({ key: k, at });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Drop drafts that are too old or too many, never touching `keepKey`.
 * Called before a write, so a long-lived browser does not accumulate a draft
 * for every plan the user has ever opened.
 */
function prune(ls, keepKey) {
  const now = Date.now();
  const rows = allDrafts(ls);
  const doomed = rows.filter((r, i) =>
    r.key !== keepKey && (i >= MAX_DRAFTS || !r.at || now - r.at > MAX_AGE_MS));
  for (const d of doomed) { try { ls.removeItem(d.key); } catch { /* ignore */ } }
  return doomed.length;
}

/**
 * Mirror one editor state. SYNCHRONOUS AND NEVER THROWS — this runs on the same
 * tick as a pointermove handler and on the unload path, and an exception here
 * must not be able to break either.
 */
export function saveDraft(planId, editorState) {
  const ls = store();
  if (!ls || !planId || !editorState) return false;
  const key = keyFor(planId);
  const body = JSON.stringify({ planId, savedAt: editorState.savedAt ?? new Date().toISOString(),
                                editorState });
  try { ls.setItem(key, body); return true; }
  catch {
    // Almost always the 5MB quota, and almost always because of OTHER plans'
    // drafts. Clear them and try once more; if it still will not fit, this plan
    // simply does not get the safety net and the debounced save is what it was
    // before. Not worth a banner.
    try {
      for (const r of allDrafts(ls)) if (r.key !== key) ls.removeItem(r.key);
      ls.setItem(key, body);
      return true;
    } catch { return false; }
  }
}

/** The draft for a plan, or null. Corrupt JSON reads as absent. */
export function readDraft(planId) {
  const ls = store();
  if (!ls || !planId) return null;
  try {
    const raw = ls.getItem(keyFor(planId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.editorState || (d.planId && d.planId !== planId)) return null;
    return d;
  } catch { return null; }
}

/** Called when the real write lands. The draft has done its job. */
export function clearDraft(planId) {
  const ls = store();
  if (!ls || !planId) return;
  try { ls.removeItem(keyFor(planId)); prune(ls, keyFor(planId)); } catch { /* ignore */ }
}

const stampOf = (s) => {
  const t = Date.parse(s?.savedAt ?? '');
  return Number.isNaN(t) ? 0 : t;
};

/**
 * WHICH STATE THE EDITOR SHOULD OPEN ON.
 *
 * Both stamps are written by serialiseEditor in a browser, so on the machine
 * that made the draft they came off the same clock and are directly comparable.
 *
 * TIES GO TO THE ROW, and that matters more than it looks: a draft whose stamp
 * equals the row's IS the row — the write succeeded and only the delete was
 * missed (a tab killed in the half-second between). Preferring the row there
 * keeps a successful save from being re-applied as if it were unsaved work.
 *
 * A draft with no stamp at all is not trusted over a row that has one.
 */
export function pickRestore(rowState, draft) {
  const d = draft?.editorState ?? null;
  if (!d) return { state: rowState ?? null, from: 'row' };
  if (!rowState) return { state: d, from: 'draft', aheadMs: 0 };
  const dt = stampOf(d), rt = stampOf(rowState);
  if (!dt || dt <= rt) return { state: rowState, from: 'row' };
  return { state: d, from: 'draft', aheadMs: dt - rt };
}

export const DRAFT_PREFIX = PREFIX;
