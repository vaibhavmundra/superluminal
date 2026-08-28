// ---------------------------------------------------------------------------
// THE UPLOAD IS A BACKGROUND JOB, AND THE EDITOR DOES NOT WAIT FOR IT.
//
// It used to: drop a drawing, and the page sat on "Uploading…" until Supabase
// had the whole file, then navigated. That is the wrong shape for this app, and
// not by a little.
//
// EVERYTHING THE EDITOR DOES FIRST IS LOCAL. The File is already in memory. The
// DXF is parsed in the browser; a PDF is rendered in the browser; the raster is
// decoded in the browser. The room segmenter, the door pass and the furniture
// pass all send their own downscaled snapshot to their own endpoint and never
// touch the bucket. So the upload is not a prerequisite for a single thing the
// user is about to do — it is durability, running alongside. Blocking on it
// meant staring at a spinner while a 30MB survey crawled up, when the drawing
// could have been on screen and segmenting a second after the drop.
//
// AND THE ID COMES FROM THE CLIENT, which is what makes that possible. The
// editor needs a URL, a URL needs an id, and waiting for the database to mint
// one is a round trip before anything can be drawn. crypto.randomUUID() is
// exactly as unique as gen_random_uuid(); the server was only adding latency.
//
// TWO MILESTONES, NOT ONE, and the distinction is load-bearing. The ROW appears
// after one fast insert — from then on the autosave can write, so the user's
// tracing is being persisted while the drawing itself is still going up. The
// FILE lands whenever it lands; only reopening the plan later needs it. A job
// therefore reports `rowReady` separately from `done`.
//
// A MODULE-LEVEL REGISTRY holds the jobs, and that is deliberate rather than
// lazy: the job has to survive the navigation from the dashboard into the
// editor, and it has to hand the editor the very File the user chose — which
// cannot go in a URL and must not go to the bucket and back down again. React
// state cannot span that; a module singleton can, and the navigation is a route
// change rather than a page load.
// ---------------------------------------------------------------------------

import { createProject, getProject, insertPlanRow, uploadPlanFile, sanitise } from './db.js';

/** planId -> job */
const jobs = new Map();

const emit = (job) => { for (const fn of job.listeners) { try { fn(job); } catch { /* a listener is not the job's problem */ } } };

/**
 * Kick off everything the drop implies, and return immediately.
 *
 * The caller navigates to /plans/<job.planId> on the next line. Nothing here is
 * awaited by anyone except the parts of the app that genuinely need the row.
 */
export function startPlanUpload(file, { projectId = null, projectName = null, projectType = null } = {}) {
  const planId = crypto.randomUUID();

  const job = {
    planId,
    file,
    projectId,
    projectType,
    // 'creating' → the row is being inserted (fast)
    // 'uploading' → the row exists, the bytes are going up
    // 'done' | 'error'
    status: 'creating',
    error: null,
    plan: null,          // the real row, once inserted
    listeners: new Set(),
  };

  // Resolved when the ROW exists — not when the file has finished. Anything that
  // writes to the plan (the autosave, a milestone) awaits this and nothing more.
  job.rowReady = new Promise((resolve, reject) => {
    job._resolveRow = resolve;
    job._rejectRow = reject;
  });
  // Swallowed here so that a failure with no listener attached does not surface
  // as an unhandled rejection; every consumer awaits it inside its own try.
  job.rowReady.catch(() => {});

  jobs.set(planId, job);
  job.promise = run(job);
  return job;
}

async function run(job) {
  try {
    // 1. the project. Either the one we were given, or one named after the file.
    let project = job.projectId ? await getProject(job.projectId) : null;
    if (!project) {
      project = await createProject({
        name: job.projectName || sanitise(job.file.name),
        projectType: job.projectType,
      });
      job.projectId = project.id;
    }

    // 2. the row, at the id the URL already points at.
    const plan = await insertPlanRow({
      planId: job.planId,
      projectId: project.id,
      file: job.file,
      projectType: project.project_type ?? job.projectType ?? null,
    });
    job.plan = plan;
    job.projectId = project.id;
    job.projectType = plan.project_type ?? null;
    job.status = 'uploading';
    job._resolveRow(plan);
    emit(job);

    // 3. the bytes. Slow, and nothing on screen is waiting for them.
    const saved = await uploadPlanFile(plan, job.file);
    job.plan = saved;
    job.status = 'done';
    emit(job);
  } catch (err) {
    console.error('[upload] failed', err);
    job.error = err;
    // A ROW THAT EXISTS WITH NO FILE IS RECOVERABLE; a failure before it is not.
    // Which of the two happened decides whether the editor can still save.
    if (!job.plan) { job.status = 'error'; job._rejectRow(err); }
    else { job.status = 'error'; }
    emit(job);
  }
  return job;
}

export const getJob = (planId) => jobs.get(planId) ?? null;

export function subscribeJob(planId, fn) {
  const job = jobs.get(planId);
  if (!job) return () => {};
  job.listeners.add(fn);
  return () => { job.listeners.delete(fn); };
}

/**
 * Resolves once it is safe to write to this plan's row. Immediately when there
 * is no job for it — which is the case for every plan opened from a list, since
 * the row demonstrably already exists.
 */
export function whenRowReady(planId) {
  const job = jobs.get(planId);
  if (!job) return Promise.resolve(null);
  return job.rowReady;
}

/** Retry a failed upload. The row, if it got that far, is reused. */
export function retryUpload(planId) {
  const job = jobs.get(planId);
  if (!job || job.status !== 'error') return null;
  job.error = null;
  job.status = job.plan ? 'uploading' : 'creating';
  if (!job.plan) {
    job.rowReady = new Promise((res, rej) => { job._resolveRow = res; job._rejectRow = rej; });
    job.rowReady.catch(() => {});
  }
  emit(job);
  job.promise = job.plan
    ? uploadPlanFile(job.plan, job.file)
        .then((saved) => { job.plan = saved; job.status = 'done'; emit(job); return job; })
        .catch((err) => { job.error = err; job.status = 'error'; emit(job); return job; })
    : run(job);
  return job;
}

/**
 * Forget a finished job. Called by the editor when it unmounts, so a long
 * session does not accumulate every File the user has opened — a dozen 30MB
 * drawings held by a Map is a tab that gets killed for using too much memory.
 * A job still in flight is left alone.
 */
export function releaseJob(planId) {
  const job = jobs.get(planId);
  if (job && (job.status === 'done')) jobs.delete(planId);
}

/**
 * A row-shaped object for a plan whose insert has not landed yet, so the editor
 * has a name to show and an id to save against from the first frame.
 */
export function provisionalPlan(job) {
  return {
    id: job.planId,
    project_id: job.projectId ?? null,
    name: sanitise(job.file.name),
    file_name: job.file.name,
    project_type: job.projectType ?? null,
    editor_state: null,
    provisional: true,
  };
}
