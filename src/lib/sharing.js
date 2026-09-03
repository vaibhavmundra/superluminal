// ---------------------------------------------------------------------------
// SHARING — the browser half of migration 0006.
//
// TWO MECHANISMS BEHIND ONE DIALOG, and the split is worth holding on to
// because it decides which half of this file a given call belongs in.
//
//   BY EMAIL, THROUGH RLS. `project_shares` rows are a real grant, so every
//   function in the first section is an ordinary supabase-js query and the
//   policies are what make it legal. There is no endpoint, no service key and
//   no second permission model — the invitee uses the same /projects/:id and
//   /plans/:id the owner does, and the database decides what happens there.
//
//   BY LINK, THROUGH THE SERVER. A token in an address bar is not something a
//   policy can see, so `/api/share` redeems it with the service key and hands
//   back rows. The second section is therefore fetch()es that look exactly like
//   src/lib/admin.js — same bearer token, same reasoning about who is trusted to
//   assert what. See the header of api/share.js.
//
// WHAT THIS FILE DOES NOT DO IS SEND AN EMAIL. Adding a share is a row, and the
// invitee finds the project waiting under "Shared with me" the next time they
// sign in. Wiring a transactional mailer in here would be a second delivery path
// to keep alive for something the app can already state on screen — the dialog
// tells the owner to send the link themselves, which is what people do anyway.
// ---------------------------------------------------------------------------
import { supabase } from './supabase.js';

const must = () => {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
};

const unwrap = ({ data, error }) => { if (error) throw error; return data; };

const SHARE_COLS = 'id, project_id, email, role, invited_user, owner_email, created_at';

/**
 * A SHAPE CHECK, NOT A VALIDATION. There is no way to know from here whether an
 * address exists, and the database cannot tell you either — the whole point of
 * inviting by email is that the account may not have been created yet. So this
 * only catches the typo that is obviously a typo, and everything else is the
 * owner's problem to notice when the person says they cannot see it.
 */
export const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());

// --- by email --------------------------------------------------------------

/** Everybody this project is shared with. Owner-only in practice — see the RLS. */
export async function listShares(projectId) {
  return unwrap(await must().from('project_shares')
    .select(SHARE_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })) || [];
}

/**
 * INVITE, OR CHANGE AN EXISTING INVITE'S ROLE — one call, because from the
 * owner's side those are the same act. Typing an address that is already on the
 * list and picking "Can edit" means "make them an editor", and an error saying
 * "already shared" would be the app refusing to do the obvious thing.
 *
 * `owner` and `email` are not sent: a trigger fills the first from the project
 * and lowercases the second, so sending them would only be a chance to disagree
 * with the row that ends up stored.
 */
export async function addShare(projectId, email, role = 'view') {
  return unwrap(await must().from('project_shares')
    .upsert({ project_id: projectId, email: String(email).trim().toLowerCase(), role },
            { onConflict: 'project_id,email' })
    .select(SHARE_COLS).single());
}

export async function setShareRole(id, role) {
  return unwrap(await must().from('project_shares')
    .update({ role }).eq('id', id).select(SHARE_COLS).single());
}

/** Used by the owner to revoke, and by the invitee to leave. Same policy. */
export async function removeShare(id) {
  unwrap(await must().from('project_shares').delete().eq('id', id));
}

/**
 * WHAT THE SIGNED-IN USER MAY DO HERE — 'owner' | 'edit' | 'view' | null.
 *
 * Called by every screen that can be reached by a non-owner, and the answer
 * decides whether the editor opens writable. NULL IS NOT "no": it is "no share
 * row", which for the project's owner is the normal state — hence `ownerId`,
 * which the caller already has on the row it just fetched and which saves this
 * from a second query in the common case.
 */
export async function myAccess(projectId, ownerId = null) {
  const { data } = await must().auth.getSession();
  const me = data?.session?.user?.id;
  if (!me) return null;

  // OWNERSHIP IS SETTLED BEFORE THE SHARE TABLE IS TOUCHED, and it has to be.
  // The select policy on `project_shares` scopes an INVITEE to their own row —
  // but it gives the OWNER the whole list, so reading a role out of the first
  // row would tell an owner they are a viewer of their own project the moment
  // they share it with somebody. `ownerId` is the fast path (both callers have
  // the row in hand); the query below is the correctness one.
  let owner = ownerId;
  if (!owner) {
    const row = unwrap(await must().from('projects')
      .select('owner').eq('id', projectId).maybeSingle());
    owner = row?.owner ?? null;
  }
  if (owner && owner === me) return 'owner';

  const rows = unwrap(await must().from('project_shares')
    .select('role').eq('project_id', projectId).limit(1)) || [];
  return rows[0]?.role ?? null;
}

/**
 * EVERY PROJECT SOMEBODY ELSE SHARED WITH ME, for the dashboard's second list.
 *
 * The query goes through `project_shares` rather than through `projects` with a
 * `neq('owner', me)` filter, and the difference matters: this way the role and
 * the sharer's address come back in the same round trip, and the embedded
 * project is scoped by the projects policy so a revoked share cannot leave a
 * dangling card.
 */
export async function listSharedWithMe() {
  const { data } = await must().auth.getSession();
  const me = data?.session?.user?.id;
  if (!me) return [];

  const rows = unwrap(await must().from('project_shares')
    .select(`id, role, owner_email, created_at,
             projects ( id, name, project_type, owner, created_at, updated_at, plans(count) )`)
    .neq('owner', me)
    .order('created_at', { ascending: false })) || [];

  return rows
    // A share whose project came back null is one the projects policy refused —
    // which should not happen, and which is a missing card rather than a crash
    // if it ever does.
    .filter((r) => r.projects)
    .map((r) => ({
      ...r.projects,
      planCount: r.projects.plans?.[0]?.count ?? 0,
      plans: undefined,
      shareId: r.id,
      role: r.role,
      sharedBy: r.owner_email,
    }));
}

// --- by link ---------------------------------------------------------------

/** The live link for this project, or null. One per project, by construction. */
export async function getShareLink(projectId) {
  return unwrap(await must().from('project_share_links')
    .select('token, project_id, created_at')
    .eq('project_id', projectId).maybeSingle());
}

/** Mint one. The token is generated by the database — see the column default. */
export async function createShareLink(projectId) {
  return unwrap(await must().from('project_share_links')
    .insert({ project_id: projectId })
    .select('token, project_id, created_at').single());
}

/**
 * KILL IT. A delete rather than a flag, so a revoked token stops resolving
 * because there is nothing to resolve — see the note on the table.
 */
export async function revokeShareLink(projectId) {
  unwrap(await must().from('project_share_links').delete().eq('project_id', projectId));
}

/**
 * THE URL SOMEBODY ACTUALLY PASTES. `/s/<token>`, and it is short for a reason
 * beyond tidiness: that path is rewritten to api/share.js so a scraper gets the
 * Open Graph card and a person gets a redirect into the app. `/shared/<token>`,
 * which is where the redirect lands, is the SPA route and would give a scraper
 * the generic index.html — see vercel.json.
 */
export const shareUrl = (token) =>
  `${globalThis.location?.origin ?? 'https://superluminal.design'}/s/${token}`;

// --- redeeming a link ------------------------------------------------------

/**
 * The same call() as src/lib/admin.js, for the same reasons, against a different
 * door. The token is a bearer of view access and the session is a bearer of
 * identity; the endpoint wants both.
 */
async function call(action, body = {}) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in');

  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }),
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* fall through */ }

  if (!res.ok) {
    if (res.status === 404) throw new Error('This link is no longer live. Ask for a new one.');
    if (res.status === 401) throw new Error('Your session has expired — sign in again.');
    throw new Error(json?.error || `The share API answered ${res.status}`);
  }
  return json ?? {};
}

/** A token to { project, plans }. Plan cards only — no jsonb. */
export const openSharedProject = (token) => call('project', { token });

/** One plan out of a shared project, whole, because the viewer restores from it. */
export const openSharedPlan = (token, planId) => call('plan', { token, planId });
