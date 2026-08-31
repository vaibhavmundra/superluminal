// ---------------------------------------------------------------------------
// THE DATA LAYER. Every query in the app is a function in here, and the pages
// call these rather than building selects of their own.
//
// WHY THAT RULE EARNS ITS KEEP HERE SPECIFICALLY: the plan row carries three
// heavy jsonb columns — the editor state, the finished design, the schedule —
// and a card on the dashboard needs none of them. A `select('*')` on the
// project page is a list of eight plans each dragging a megabyte of geometry
// over the wire to render a filename. So the column lists are named, once,
// beside each other, where the difference between them is visible:
// PLAN_CARD_COLS for lists, and the full row only when a plan is opened.
//
// ONE OWNER COLUMN PER TABLE, and it is not redundant with the foreign key.
// `plans.owner` duplicates `projects.owner`, which offends normal form and buys
// an RLS policy that reads `owner = auth.uid()` instead of joining to projects
// on every single row read. The trigger in the migration keeps it honest.
// ---------------------------------------------------------------------------
import { supabase, BUCKET, publicUrl } from './supabase.js';

/** Enough to draw a plan card, and deliberately not one column more. */
const PLAN_CARD_COLS =
  'id, project_id, name, status, source_kind, file_name, storage_path, snapshot_path,'
  + ' width, height, px_per_ft, project_type, stats, created_at, updated_at, last_opened_at';

const PROJECT_COLS = 'id, name, project_type, created_at, updated_at';

const must = () => {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
};

/**
 * The signed-in user's id, FROM THE LOCAL SESSION.
 *
 * This was `auth.getUser()`, and that was the bug behind "stuck on uploading".
 * getUser is not a local read: it posts the JWT to /auth/v1/user to have it
 * validated, and it takes the auth lock while doing so. So every upload began
 * with a network round trip that could queue behind any other auth call — and
 * when it hung, it hung before a single byte had been sent, with the button
 * still saying "Uploading…" about a request that had not started.
 *
 * getSession reads what is already in memory. The token it returns is signed;
 * the server verifies it on the next request anyway, which is the only place
 * verification actually matters. Nothing here was ever made safer by asking.
 */
const uid = async () => {
  const { data } = await must().auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) throw new Error('Not signed in');
  return id;
};

const unwrap = ({ data, error }) => { if (error) throw error; return data; };

// --- projects --------------------------------------------------------------

export async function listProjects() {
  const rows = unwrap(await must()
    .from('projects')
    .select(`${PROJECT_COLS}, plans(count)`)
    .order('updated_at', { ascending: false }));
  // Supabase returns an aggregate as a one-element array of {count}. Flattened
  // here so no card has to know that.
  return (rows || []).map((p) => ({ ...p, planCount: p.plans?.[0]?.count ?? 0, plans: undefined }));
}

export async function getProject(id) {
  return unwrap(await must().from('projects').select(PROJECT_COLS).eq('id', id).single());
}

export async function setProjectType(id, projectType) {
  return unwrap(await must().from('projects')
    .update({ project_type: projectType }).eq('id', id).select(PROJECT_COLS).single());
}

export async function createProject({ name, projectType = null }) {
  // `owner` has a `default auth.uid()` in the migration, so it is not sent: one
  // less thing the client can get wrong, and one less reason to need the user id
  // before a write.
  return unwrap(await must().from('projects')
    .insert({ name: name || 'Untitled project', project_type: projectType })
    .select(PROJECT_COLS).single());
}

export async function renameProject(id, name) {
  return unwrap(await must().from('projects')
    .update({ name }).eq('id', id).select(PROJECT_COLS).single());
}

export async function deleteProject(id) {
  unwrap(await must().from('projects').delete().eq('id', id));
}

// --- plans -----------------------------------------------------------------

export async function listPlans(projectId) {
  return unwrap(await must().from('plans')
    .select(PLAN_CARD_COLS)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })) || [];
}

/** The dashboard's "recently worked on" strip. Across all projects. */
export async function recentPlans(limit = 6) {
  return unwrap(await must().from('plans')
    .select(`${PLAN_CARD_COLS}, projects(name)`)
    .order('updated_at', { ascending: false })
    .limit(limit)) || [];
}

/** The whole row, jsonb and all. Only ever called when a plan is opened. */
export async function getPlan(id) {
  return unwrap(await must().from('plans').select('*').eq('id', id).single());
}

export async function updatePlan(id, patch) {
  return unwrap(await must().from('plans')
    .update(patch).eq('id', id).select(PLAN_CARD_COLS).single());
}

export async function deletePlan(id) {
  unwrap(await must().from('plans').delete().eq('id', id));
}

export async function touchPlanOpened(id) {
  // Deliberately not awaited by callers and deliberately not `updated_at`:
  // opening a plan must not reorder the list the user is looking at.
  try { await must().from('plans').update({ last_opened_at: new Date().toISOString() }).eq('id', id); }
  catch { /* a failed timestamp is not worth a banner */ }
}

// --- the upload, which is three writes and has to be all three -------------

const EXT = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase();

export const sanitise = (name) =>
  name.replace(/\.[^.]+$/, '').replace(/[^\w\s-]/g, '').trim() || 'Untitled plan';

/** What kind of file this is, in the terms the `plans` row uses. */
export function kindOf(file) {
  const isDxf = /\.dxf$/i.test(file.name);
  const isPdfFile = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  return {
    isDxf, isPdf: isPdfFile,
    sourceKind: isDxf ? 'vector' : isPdfFile ? 'pdf' : 'raster',
    mime: file.type
      || (isDxf ? 'application/dxf' : isPdfFile ? 'application/pdf' : 'application/octet-stream'),
    ext: (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase(),
  };
}

/**
 * Insert the row for a plan whose id was decided by the CLIENT.
 *
 * That inversion is what lets the app navigate before the network answers: the
 * editor needs a URL, a URL needs an id, and waiting for the database to mint
 * one means waiting for a round trip before anything can be drawn. A v4 uuid
 * from crypto.randomUUID() is exactly as unique as gen_random_uuid(); the only
 * thing the server was providing was the delay.
 */
export async function insertPlanRow({ planId, projectId, file, projectType = null }) {
  const k = kindOf(file);
  return unwrap(await must().from('plans').insert({
    id: planId,
    project_id: projectId,
    name: sanitise(file.name),
    file_name: file.name,
    mime: k.mime,
    bytes: file.size,
    source_kind: k.sourceKind,
    status: 'uploaded',
    project_type: projectType,
  }).select('*').single());
}

/** Push the drawing itself, and record where it landed. */
export async function uploadPlanFile(plan, file) {
  const owner = await uid();
  const k = kindOf(file);
  const path = `${owner}/${plan.id}/source.${k.ext}`;
  const { error } = await must().storage.from(BUCKET)
    .upload(path, file, { upsert: true, contentType: k.mime, cacheControl: '3600' });
  if (error) throw error;
  return unwrap(await must().from('plans')
    .update({ storage_path: path }).eq('id', plan.id).select('*').single());
}

// createPlanFromFile — REMOVED, and worth a note where it was.
//
// It did the whole sequence in one await: project, row, upload, then hand back a
// plan. Every caller therefore had to sit on a spinner until the last byte of a
// 30MB survey had landed before it could navigate — and none of them needed any
// of it, because the editor works from the local File. lib/uploads.js does the
// same three steps as a background job with a client-minted id, and the pages
// navigate on the next line. The pieces it used are exported above
// (insertPlanRow, uploadPlanFile) so there is one sequence, in one place.

/**
 * The drawing, back out of the bucket and into the shape App.jsx already knows
 * how to read — a File, exactly as if it had just been dropped on the page.
 * That is what keeps the restore path honest: there is one loader, and a
 * reopened plan goes through the same parse as a fresh one.
 */
export async function fetchPlanFile(plan) {
  if (!plan?.storage_path) throw new Error('This plan has no drawing stored');
  const url = publicUrl(plan.storage_path);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read the drawing (${res.status})`);
  const blob = await res.blob();
  const name = plan.file_name || plan.storage_path.split('/').pop();
  const type = plan.mime || blob.type
    || (/\.dxf$/i.test(name) ? 'application/dxf'
      : /\.pdf$/i.test(name) ? 'application/pdf' : 'image/png');
  return new File([blob], name, { type });
}

/**
 * A RENDER, KEPT — at exactly the size it was sent to the model.
 *
 * TWO REASONS, and the second one is the bigger one.
 *
 *   IT COMES BACK. The renders used to live in React state and nowhere else, so
 *   reopening a plan showed a space whose reverse coves and art spots were all
 *   still there with no picture to explain where any of them came from, and
 *   re-running the pass meant finding the files again.
 *
 *   IT IS THE CORPUS. A render paired with the JSON the model returned for it,
 *   and with the design that was laid out afterwards, is one training row. The
 *   pixels have to be the ones the model actually saw or the pair is a lie —
 *   which is why this stores the DOWNSCALED JPEG out of renderImage.js and not
 *   the eight-megabyte original. Same bytes, same 1400px long edge, same
 *   quality step, as went up to the API.
 *
 * NEVER UPSERTED. Each upload gets its own timestamped key, so re-uploading a
 * view is a new object rather than a silent overwrite of the one an earlier
 * pass was trained against.
 */
export async function uploadRender(plan, blob, { roomId, index = 0 }) {
  const owner = plan.owner || await uid();
  // Outline ids are minted client-side and a room can be renamed; neither is
  // safe in a storage key, so the key carries a sanitised copy and the mapping
  // back to the space lives in editor_state where it can be corrected.
  const safe = String(roomId || 'room').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'room';
  const path = `${owner}/${plan.id}/renders/${safe}/${Date.now().toString(36)}-${index}.jpg`;
  const { error } = await must().storage.from(BUCKET)
    .upload(path, blob, { upsert: false, contentType: 'image/jpeg',
                          cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

/** Everything stored for one plan, for the analytics side. Newest first. */
export async function listRenders(plan) {
  const owner = plan.owner || await uid();
  const root = `${owner}/${plan.id}/renders`;
  const out = [];
  const rooms = unwrap(await must().storage.from(BUCKET).list(root, { limit: 200 }));
  for (const r of rooms ?? []) {
    if (r.id) continue;                       // a file at the root; there are none
    const files = unwrap(await must().storage.from(BUCKET)
      .list(`${root}/${r.name}`, { limit: 200, sortBy: { column: 'name', order: 'desc' } }));
    for (const f of files ?? []) out.push({ roomKey: r.name, path: `${root}/${r.name}/${f.name}`,
                                            bytes: f.metadata?.size ?? null,
                                            at: f.created_at ?? null });
  }
  return out;
}

/** The finished design, as a PNG beside its drawing. */
export async function uploadSnapshot(plan, blob) {
  // NOT `plan.owner`. While a background upload is still in flight the editor is
  // working from a provisional row that has an id and little else, and a path
  // beginning "undefined/" fails the storage policy in a way that reads as a
  // permissions bug rather than as a missing field.
  const owner = plan.owner || await uid();
  const path = `${owner}/${plan.id}/snapshot.png`;
  const { error } = await must().storage.from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'image/png', cacheControl: '60' });
  if (error) throw error;
  return path;
}

// --- the append-only trail -------------------------------------------------

/**
 * A REVISION IS NOT A BACKUP, it is the training corpus.
 *
 * `plans` holds the current state and is overwritten all day by the autosave.
 * What a model would want to learn from is the sequence: what the segmenter
 * proposed, what the user moved, what the planner then laid out. So a row is
 * appended here at the milestones that mean something — outlines confirmed, the
 * pipeline finished, a design exported — and never on an idle autosave, or the
 * table would be 95% keystrokes.
 */
export async function recordRevision(plan, { kind, editorState = null, designJson = null,
                                             boqJson = null, snapshotPath = null, stats = null }) {
  return unwrap(await must().from('plan_revisions').insert({
    plan_id: plan.id,
    // Omitted deliberately: revisions_set_owner fills it from the plan, which is
    // the only source that cannot disagree with the row it belongs to.
    kind,
    editor_state: editorState,
    design_json: designJson,
    boq_json: boqJson,
    snapshot_path: snapshotPath,
    stats,
  }).select('id, created_at').single());
}

export async function listRevisions(planId, limit = 50) {
  return unwrap(await must().from('plan_revisions')
    .select('id, kind, snapshot_path, stats, created_at')
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })
    .limit(limit)) || [];
}

// --- realtime --------------------------------------------------------------

/**
 * WHY REALTIME AND NOT A REFETCH. The dashboard and the project page are lists
 * that change from somewhere else: the autosave in the planner tab, a second
 * window, a phone. Polling those lists is a request every few seconds forever
 * for a change that happens twice an hour; a subscription is one socket that
 * says nothing until something happens.
 *
 * The callback is handed the raw payload rather than a patched list, because
 * only the page knows whether an UPDATE it just caused should re-sort its own
 * cards under the user's cursor.
 */
export function subscribeProjects(onChange) {
  if (!supabase) return () => {};
  const ch = supabase.channel('projects-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/**
 * DELIBERATELY UNFILTERED, and `projectId` only names the channel.
 *
 * The obvious version filters on `project_id=eq.…` and is subtly broken: a
 * DELETE event carries only the primary key under the default replica identity,
 * so it has no project_id to match and the filter silently swallows it — a
 * deleted plan stays on screen until a reload. RLS already scopes the stream to
 * the user's own rows, and a studio has tens of plans, not millions, so the
 * unfiltered stream is small and correct. See the note at the end of
 * supabase/migrations/0001_init.sql.
 */
export function subscribePlans(projectId, onChange) {
  if (!supabase) return () => {};
  const ch = supabase.channel(`plans-feed-${projectId || 'all'}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/**
 * A REFETCH THAT CANNOT STAMPEDE.
 *
 * The autosave in an editor tab writes every 1.5 seconds while somebody drags a
 * fitting, and each write is an event on both feeds — so a naive
 * `subscribe(load)` turns one user nudging a downlight into two selects per
 * second on every other open window. The lists are not urgent to a quarter of a
 * second; they are urgent to "before the user notices". 400ms of coalescing is
 * the whole difference.
 */
export function coalesce(fn, ms = 400) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export { publicUrl };
