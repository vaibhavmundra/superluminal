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
import { textFromResponse } from '../src/lib/openaiDetect.js';

const log = (id, arrow, msg) => console.log(`[accents ${id}] ${arrow} ${msg}`);

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

  const planB64 = bare(body?.plan?.image);
  if (!planB64 || typeof planB64 !== 'string') {
    return send(400, { error: 'Expected { plan: { image: "<base64>" } }.' });
  }

  // The client downscales; this is the guard for when it did not. Base64
  // inflates by a third, and Vercel refuses a body over 4.5MB with a message
  // that says nothing about which image was the problem.
  const bytes = Math.floor(planB64.length * 0.75);
  if (bytes > 4_000_000) {
    log(id, '!!', `refused ${(bytes / 1e6).toFixed(1)}MB body`);
    return send(413, { error: `That image is ${(bytes / 1e6).toFixed(1)}MB after decoding. Downscale it before sending — the cap here is 4MB.` });
  }

  const w = Number(body?.plan?.w) > 0 ? Number(body.plan.w) : 1000;
  const h = Number(body?.plan?.h) > 0 ? Number(body.plan.h) : 1000;
  const model = body.model || process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL;
  // Coerced field by field, not accepted wholesale. Every other input on this
  // route is coerced (plan.w, ceilingFt, the render list); a `room` object taken
  // as given was the one hole, and a widthFt arriving as a string was an
  // unhandled throw inside the prompt builder rather than a 400.
  const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const rb = body.room && typeof body.room === 'object' && !Array.isArray(body.room) ? body.room : null;
  const room = rb ? {
    name: typeof rb.name === 'string' ? rb.name.slice(0, 60) : null,
    widthFt: numOrNull(rb.widthFt),
    heightFt: numOrNull(rb.heightFt),
    areaSqft: numOrNull(rb.areaSqft),
  } : null;
  const ceilingFt = Number(body.ceilingFt) > 0 ? Number(body.ceilingFt) : null;

  log(id, '->', `${(bytes / 1024).toFixed(0)}KB — room ${w}x${h}`
    + `, room="${room?.name ?? '?'}", ${model}`);

  const request = buildAccentRequest({
    plan: { base64: planB64, mime: body?.plan?.mime || 'image/jpeg' },
    room, ceilingFt, model,
  });

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
  const payload = furnitureFromReply(reply, { w, h });

  // The model's own words. A refusal, a hedge, or "none of the rules apply to
  // this room" is the single most useful thing on the wire when a run comes
  // back empty, and it is invisible in the parsed payload.
  log(id, '==', payload.furniture.length
    ? `${payload.furniture.length}: ${payload.furniture.map((f) => `${f.type} ${f.confidence.toFixed(2)}`).join(', ')}`
    : `no furniture. reply: ${reply.slice(0, 300)}`);
  if (payload.skipped.length) {
    log(id, '??', `${payload.skipped.length} dropped: ${payload.skipped.map((s) => s.reason).join('; ').slice(0, 240)}`);
  }

  return send(200, {
    meta: {
      id, model, ms, bytes,
      furniture: payload.furniture.length,
      skipped: payload.skipped.length,
      usage: json.usage ?? null,
      reply: reply.slice(0, 900),
    },
    result: payload,
  });
}
