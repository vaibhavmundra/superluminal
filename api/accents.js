// ---------------------------------------------------------------------------
// api/accents.js — the accent-lighting question, server side.
//
// A SECOND ENDPOINT AND NOT A THIRD `task` ON /api/detect, deliberately. The
// two questions have nothing in common but the key: detect sends one image and
// gets back boxes in one fixed shape that furniture.js parses; this sends a
// crop plus a handful of photographs and gets back a scheme. Folding it into
// detect.js would mean a fourth branch in a handler that already has three, and
// every one of them reading a different half of the body.
//
// WHAT IT DOES NOT DO is decide anything. It relays: builds the request from
// accentPrompt.js, posts it, parses the reply through zonesFromReply, hands
// back zones in the pixel space of the image it was given. It has no idea what
// a wall is, does not know the scale, and never sees the plan's own
// coordinates — mapping out of the crop is the browser's job, because the
// browser is what made the crop. See accentMask.js.
//
// Runs unchanged as a Vercel function and as Vite dev middleware, so the body
// is read defensively: Vercel parses JSON for us, Vite does not.
// ---------------------------------------------------------------------------

import { buildAccentRequest, furnitureFromReply, DEFAULT_MODEL } from '../src/lib/accentPrompt.js';
import { buildSurfaceRequest, surfacesFromReply } from '../src/lib/taskSurfaces.js';
import { buildRoomTypeRequest, roomTypeFromReply } from '../src/lib/roomTypes.js';
import { buildBedFitRequest, bedFitFromReply } from '../src/lib/bedFit.js';
import { textFromResponse } from '../src/lib/openaiDetect.js';

/*
 * ONLY THE JUDGE TALKS. Same reasoning as api/detect.js: this route serves
 * roomtype, furniture, surfaces and bedfit, and while the bed pipeline is the
 * thing being watched the other three bury it. `bedfit` is the judge, and the
 * judge is bed work. Set BED_LOG_ONLY to false to hear the rest.
 *
 * Keyed on the request id rather than a flag, because these calls run two at a
 * time and answer out of order.
 */
export const BED_LOG_ONLY = true;
const loudIds = new Set();
const markLoud = (id) => {
  loudIds.add(id);
  if (loudIds.size > 64) loudIds.delete(loudIds.values().next().value);
};
const log = (id, arrow, msg) => {
  if (BED_LOG_ONLY && !loudIds.has(id)) return;
  console.log(`[accents ${id}] ${arrow} ${msg}`);
};

/** Same rule as api/detect.js: an upstream that echoes the request back on a
 *  validation error must not hand the key to somebody's devtools. */
function scrub(node, key, depth = 0) {
  if (depth > 8) return '[deep]';
  if (typeof node === 'string') return key && node.includes(key) ? node.split(key).join('***') : node;
  if (Array.isArray(node)) return node.map((n) => scrub(n, key, depth + 1));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (/^(api[_-]?key|authorization|token|secret)$/i.test(k)) continue;
      out[k] = scrub(v, key, depth + 1);
    }
    return out;
  }
  return node;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Accept a bare base64 or a data: URL, so callers need not remember which. */
const bare = (s) => (typeof s === 'string' && s.startsWith('data:') && s.includes(',')
  ? s.split(',')[1] : s);

export default async function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(405, { error: 'POST only.' });

  let body;
  try { body = await readBody(req); }
  catch { return send(400, { error: 'Body was not valid JSON.' }); }

  const id = Math.random().toString(16).slice(2, 6);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return send(500, { error: 'OPENAI_API_KEY is not set on the server.' });

  // ONE OR TWO PICTURES, read as a list either way. Three of the four tasks
  // send a single crop and always have; the bed-fit judge sends two of the same
  // room and compares them. Reading a list here rather than forking on the task
  // means the size guard below counts the WHOLE body, which is the number
  // Vercel refuses on — a per-image guard would have passed two 3MB crops and
  // then been rejected upstream with a message about neither of them.
  const rawImages = Array.isArray(body?.plans) && body.plans.length
    ? body.plans
    : (body?.plan ? [body.plan] : []);
  const images = rawImages
    .map((p) => ({ base64: bare(p?.image), mime: p?.mime || 'image/jpeg',
                   w: Number(p?.w) > 0 ? Number(p.w) : 1000,
                   h: Number(p?.h) > 0 ? Number(p.h) : 1000 }))
    .filter((p) => p.base64 && typeof p.base64 === 'string');

  if (!images.length) {
    return send(400, { error: 'Expected { plan: { image: "<base64>" } } or { plans: [...] }.' });
  }
  const planB64 = images[0].base64;

  // The client downscales; this is the guard for when it did not. Base64
  // inflates by a third, and Vercel refuses a body over 4.5MB with a message
  // that says nothing about which image was the problem.
  const bytes = images.reduce((n, p) => n + Math.floor(p.base64.length * 0.75), 0);
  if (bytes > 4_000_000) {
    log(id, '!!', `refused ${(bytes / 1e6).toFixed(1)}MB body (${images.length} image${images.length === 1 ? '' : 's'})`);
    return send(413, { error: `Those ${images.length === 1 ? 'image is' : 'images are'} ${(bytes / 1e6).toFixed(1)}MB after decoding. Downscale before sending — the cap here is 4MB for the whole request.` });
  }

  const w = images[0].w;
  const h = images[0].h;
  const model = body.model || process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL;
  // Coerced field by field, not accepted wholesale. Every other input on this
  // route is coerced (plan.w, ceilingFt, the render list); a `room` object taken
  // as given was the one hole, and a widthFt arriving as a string was an
  // unhandled throw inside the prompt builder rather than a 400.
  const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const rb = body.room && typeof body.room === 'object' && !Array.isArray(body.room) ? body.room : null;
  // WHICH QUESTION about the same picture. Three of the four send an identical
  // crop of one room; two of those get back a list of things with boxes on it
  // and differ only in vocabulary, one gets back a room type. The fourth —
  // `bedfit` — sends two copies of that crop with different rectangles drawn on
  // them and gets back a letter. A separate endpoint per question would be a
  // separate copy of the key handling, the scrubbing, the size guard and the
  // logging, four times over.
  const task = ['surfaces', 'roomtype', 'bedfit'].includes(body.task) ? body.task : 'furniture';
  const projectId = typeof body.projectId === 'string' ? body.projectId : null;

  const room = rb ? {
    name: typeof rb.name === 'string' ? rb.name.slice(0, 60) : null,
    widthFt: numOrNull(rb.widthFt),
    heightFt: numOrNull(rb.heightFt),
    areaSqft: numOrNull(rb.areaSqft),
  } : null;
  const ceilingFt = Number(body.ceilingFt) > 0 ? Number(body.ceilingFt) : null;

  if (task === 'bedfit') markLoud(id);
  log(id, '->', `${(bytes / 1024).toFixed(0)}KB${images.length > 1 ? ` x${images.length}` : ''} — room ${w}x${h}`
    + `, task=${task}${projectId ? `/${projectId}` : ''}`
    + `, room="${room?.name ?? '?'}", ${model}`);

  const plan = images[0];
  // A/B counts, so the prompt can say out loud that the two answers disagree on
  // how many beds there are. Coerced like everything else on this route.
  const cb = body.counts && typeof body.counts === 'object' ? body.counts : null;
  const counts = cb && Number.isFinite(Number(cb.a)) && Number.isFinite(Number(cb.b))
    ? { a: Number(cb.a), b: Number(cb.b) } : null;
  let request;
  try {
    request = task === 'roomtype' ? buildRoomTypeRequest({ plan, projectId, room })
      : task === 'surfaces' ? buildSurfaceRequest({ plan, room, model })
      : task === 'bedfit' ? buildBedFitRequest({ plans: images, room, counts, model })
      : buildAccentRequest({ plan, room, ceilingFt, model });
  } catch (err) {
    // An unknown project id reaches the prompt builder as a throw. That is a
    // caller error, not an upstream one, so it is a 400 rather than a 500.
    return send(400, { error: String(err.message || err), id });
  }

  const t0 = Date.now();
  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    log(id, '!!', `could not reach OpenAI: ${err.message}`);
    return send(502, { error: `Could not reach OpenAI: ${err.message}`, id });
  }

  const ms = Date.now() - t0;
  const text = await upstream.text();
  log(id, '<-', `openai ${upstream.status} in ${ms}ms`);

  if (!upstream.ok) {
    let detail;
    try { detail = JSON.parse(text); } catch { detail = { raw: text.slice(0, 500) }; }
    detail = scrub(detail, key);
    return send(upstream.status === 401 || upstream.status === 403 ? 401 : 502, {
      error: upstream.status === 401 || upstream.status === 403
        ? 'OpenAI rejected the key. Check OPENAI_API_KEY.'
        : `OpenAI returned ${upstream.status}.`,
      detail, ms, id,
    });
  }

  let json;
  try { json = JSON.parse(text); }
  catch { return send(502, { error: 'OpenAI returned non-JSON.', ms, id }); }

  const reply = textFromResponse(json);
  const payload = task === 'roomtype' ? roomTypeFromReply(reply, { projectId })
    : task === 'surfaces' ? surfacesFromReply(reply, { w, h })
    : task === 'bedfit' ? bedFitFromReply(reply)
    : furnitureFromReply(reply, { w, h });
  // The room-type task returns one answer rather than a list, so there is
  // nothing to count. Logged as the answer itself.
  const found = payload.furniture ?? payload.surfaces ?? null;

  // The model's own words. A refusal, a hedge, or "none of the rules apply to
  // this room" is the single most useful thing on the wire when a run comes
  // back empty, and it is invisible in the parsed payload.
  // An `other` is the one answer worth seeing the model's own words for: it is
  // either a genuinely unclassifiable space or a question it could not read, and
  // those need completely different fixes.
  if (task === 'roomtype' && (!payload.matched || payload.type === 'other')) {
    log(id, '??', `answered "${payload.type}" — raw reply: ${reply.slice(0, 300)}`);
  }
  // A judge that would not choose is the one failure this route cannot see from
  // the parsed payload — `pick: null` looks like any other empty answer — and it
  // is the one worth the raw reply, because "both look the same to me" and "I
  // could not read the images" need different fixes.
  if (task === 'bedfit' && !payload.matched) {
    log(id, '??', `the judge did not pick — raw reply: ${reply.slice(0, 300)}`);
  }
  log(id, '==', task === 'bedfit'
    ? `pick ${payload.pick ?? 'NONE'} ${payload.confidence.toFixed(2)}${payload.why ? ` — ${payload.why}` : ''}`
    : !found
    ? `${payload.type} ${payload.confidence?.toFixed(2)}${payload.matched ? '' : ' (UNMATCHED)'}`
    : found.length
      ? `${found.length}: ${found.map((f) => `${f.type} ${f.confidence.toFixed(2)}`).join(', ')}`
      : `nothing found. reply: ${reply.slice(0, 300)}`);
  if (payload.skipped?.length) {
    log(id, '??', `${payload.skipped.length} dropped: ${payload.skipped.map((s) => s.reason).join('; ').slice(0, 240)}`);
  }

  return send(200, {
    meta: {
      id, model, ms, bytes,
      task, found: found ? found.length : 1, images: images.length,
      // The room-type payload is ONE answer, not a list, so it has no `skipped`
      // array. Guarding the log line and not this one meant every successful
      // classification was logged and then threw on the way out — the server
      // said "bedroom 0.98" and the browser got a 500.
      skipped: payload.skipped?.length ?? 0,
      usage: json.usage ?? null,
      reply: reply.slice(0, 900),
    },
    result: payload,
  });
}
