// ---------------------------------------------------------------------------
// admin.js — the browser half of the operator's console.
//
// FOUR FUNCTIONS AND ONE POST. Everything goes through /api/admin because the
// admin check has to happen somewhere the user cannot reach, and that is the
// server. Nothing in this file is a permission check; the `isAdmin` flag decides
// whether a LINK is drawn, and the endpoint decides whether an answer comes
// back. If those two ever disagree the endpoint wins, which is the correct way
// round — see the header of api/admin.js.
//
// THE TOKEN IS READ FROM THE LOCAL SESSION, not from `auth.getUser()`, for the
// same reason src/lib/db.js does: getUser is a network round trip that takes the
// auth lock, and this is a read of something already in memory. The server
// validates the token on arrival, which is the only place validation counts.
// ---------------------------------------------------------------------------
import { supabase } from './supabase.js';

async function call(action, body = {}) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in');

  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }),
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* fall through */ }

  if (!res.ok) {
    // 403 IS NOT AN ERROR TO DRESS UP. It means the person is signed in and is
    // not an owner of this app, and the honest sentence is shorter than any
    // paraphrase of it.
    if (res.status === 403) throw new Error('This is an admin-only screen.');
    if (res.status === 401) throw new Error('Your session has expired — sign in again.');
    throw new Error(json?.error || `The admin API answered ${res.status}`);
  }
  return json ?? {};
}

/** Every user, paginated, with their project / plan / ready-plan counts. */
export const adminUsers = ({ page = 1, perPage = 20, sort = 'active', q = '' } = {}) =>
  call('users', { page, perPage, sort, q });

/** One user's projects, as their own dashboard would list them. */
export const adminUserProjects = ({ userId, page = 1, perPage = 24 }) =>
  call('projects', { userId, page, perPage });

/** One user's plans — the whole account, or one project's when `projectId` is given. */
export const adminUserPlans = ({ userId, projectId = null, page = 1, perPage = 24 }) =>
  call('plans', { userId, projectId, page, perPage });

/** One plan, whole — jsonb included, because the viewer restores from it. */
export const adminPlan = (planId) => call('plan', { planId });
