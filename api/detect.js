// ---------------------------------------------------------------------------
// api/detect.js — the only place the detection keys exist.
//
// TWO PROVIDERS, ONE RESPONSE SHAPE. `provider` in the body picks between them:
//
//   'roboflow'  a trained open-vocabulary detector. Tight boxes when it commits
//               to one, and it often does not commit at all on a line drawing.
//   'openai'    a general vision model, asked in one call for the bed's bounds
//               as fractions of the image. It recognises a bed on a plan easily;
//               what it cannot do is measure, so it is asked for nothing but the
//               four edges and everything else is computed downstream.
//   'both'      run them concurrently and return both, so the browser can show
//               the two answers side by side. Costs two calls.
//
// Whichever runs, what comes back out of here is the SAME SHAPE — Roboflow's
// prediction format — because src/lib/furniture.js is the parser for both and
// duplicating it per provider is how the two routes would quietly diverge in
// feet. See src/lib/openaiDetect.js, which does that translation and is pure.
//
// The browser sends base64 and a class list; this forwards them to the
// provider and hands the raw response back. It deliberately does NOT parse the
// predictions: that lives in src/lib/furniture.js where it can be unit-tested
// without a network, and where changing it does not need a redeploy.
//
// Runs unchanged in two places — as a Vercel function in production, and as
// Vite dev middleware on localhost (see vite.config.js). That is why the body
// is read defensively: Vercel parses JSON for us, Vite does not.
// ---------------------------------------------------------------------------

import { buildRequest, textFromResponse, replyToPayload, DEFAULT_MODEL, DEFAULT_ARM } from '../src/lib/openaiDetect.js';

const DEFAULT_URL = 'https://serverless.roboflow.com/baibhav-mundra/workflows/general-segmentation-api-4';

// Roboflow has published two shapes for this route over time. If the
// configured one 404s we try the other before believing the workflow is gone,
// because "wrong URL shape" and "no such workflow" are the same status code
// and cost an hour to tell apart by hand.
function alternateUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/([^/]+)\/workflows\/([^/]+)\/?$/);
    if (m) return `${u.origin}/infer/workflows/${m[1]}/${m[2]}`;
    const n = u.pathname.match(/^\/infer\/workflows\/([^/]+)\/([^/]+)\/?$/);
    if (n) return `${u.origin}/${n[1]}/workflows/${n[2]}`;
  } catch { /* not a URL; caller will fail loudly enough */ }
  return null;
}

/**
 * Upstream error bodies are relayed to the browser because they are genuinely
 * useful for debugging a workflow. But a validation error from an API that
 * echoes the request back would relay OUR KEY with it, straight into someone's
 * devtools. So everything is scrubbed on the way out: any `api_key` field is
 * dropped, and any string containing the key is masked. Tested.
 */
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

/**
 * Logging. This call goes over someone else's network to someone else's model
 * and can fail in ways the browser cannot see, so every request says what it
 * sent, what came back, and how long it took. One line per phase, prefixed so
 * it greps out of a noisy dev server:
 *
 *   [detect a3f1] -> 184KB jpeg, classes="bed"
 *   [detect a3f1] <- 200 in 940ms via https://serverless.roboflow.com/...
 *   [detect a3f1] == 1 prediction: bed 0.87 @ 512x318 340x410
 *
 * Never log the key. Never log the base64 either — it is megabytes of noise.
 */
const log = (id, arrow, msg) => console.log(`[detect ${id}] ${arrow} ${msg}`);

/** Pull a short human summary out of whatever Roboflow returned. */
function summarise(parsed) {
  const found = [];
  const walk = (n, d = 0) => {
    if (d > 8 || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x, d + 1); return; }
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    if (num(n.x) && num(n.width)) {
      found.push(`${n.class ?? n.class_name ?? '?'} ${num(n.confidence) ? n.confidence.toFixed(2) : '-'}`
        + ` @${Math.round(n.x)}x${Math.round(n.y)} ${Math.round(n.width)}x${Math.round(n.height)}`);
      return;
    }
    if (Array.isArray(n.points) && n.points.length) {
      found.push(`${n.class ?? n.class_name ?? '?'} ${num(n.confidence) ? n.confidence.toFixed(2) : '-'} poly[${n.points.length}]`);
      return;
    }
    for (const k of Object.keys(n)) walk(n[k], d + 1);
  };
  walk(parsed);
  return found;
}

/** A compact type sketch of a response, so its shape is legible in one line. */
function shapeOf(node, depth = 0) {
  if (depth > 5) return '…';
  if (Array.isArray(node)) {
    return node.length ? `[${node.length} × ${shapeOf(node[0], depth + 1)}]` : '[]';
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    if (!keys.length) return '{}';
    return `{${keys.slice(0, 12).map((k) => `${k}: ${shapeOf(node[k], depth + 1)}`).join(', ')}${keys.length > 12 ? ', …' : ''}}`;
  }
  if (typeof node === 'string') return node.length > 80 ? `str(${node.length})` : `"${node}"`;
  return typeof node;
}

/**
 * Collapse long base64-ish runs. A segmentation workflow will happily return a
 * mask PNG or a rendered visualisation, and logging that raw buries the one
 * field we actually need to see.
 */
function redactBlobs(text) {
  return text.replace(/"[A-Za-z0-9+/=]{200,}"/g, (m) => `"<blob ${m.length} chars>"`);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}


/**
 * The Roboflow leg, lifted out of the handler unchanged so that `both` can run
 * it concurrently with the other one. Everything about it — the two URL shapes,
 * the 404-only retry, the scrubbing — is as it was; only the return changed
 * from writing to the response to handing back a result.
 */
async function callRoboflow({ id, b64, key, classes, bytes, mime }) {
  const payload = {
    api_key: key,
    inputs: {
      image: { type: 'base64', value: b64 },
      classes,
    },
  };

  const configured = process.env.ROBOFLOW_WORKFLOW_URL || DEFAULT_URL;
  const candidates = [configured, alternateUrl(configured)].filter(Boolean);
  let last = null;

  for (const url of candidates) {
    const t0 = Date.now();
    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(55_000),
      });
    } catch (err) {
      log(id, '!!', `could not reach ${url}: ${err.message}`);
      last = { code: 502, body: { error: `Could not reach Roboflow: ${err.message}` } };
      continue;
    }

    const ms = Date.now() - t0;
    const text = await upstream.text();
    log(id, '<-', `${upstream.status} in ${ms}ms via ${url}`);

    if (upstream.ok) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const found = parsed ? summarise(parsed) : [];
      log(id, '==', found.length
        ? `${found.length} prediction${found.length > 1 ? 's' : ''}: ${found.slice(0, 8).join(' | ')}`
        : 'no predictions in the response');
      // A 200 with nothing in it is the confusing case, so say what the shape
      // was — usually it means the workflow output is named something else.
      if (parsed && !found.length) {
        // A 200 with nothing parseable is the case that costs hours, so dump
        // enough to identify the shape. Long base64 blobs (a mask PNG, an
        // annotated image) are collapsed so the real structure is readable
        // instead of being buried under a megabyte of data.
        log(id, '??', `nothing parseable. shape: ${shapeOf(parsed)}`);
        log(id, '??', `body: ${redactBlobs(text).slice(0, 1200)}`);
      }
      return {
        payload: parsed ?? text,
        meta: {
          provider: 'roboflow', ms, endpoint: url, classes,
          predictions: found.length, summary: found,
          // Present only when nothing parsed, so the browser console can show
          // what the server saw without anyone opening the terminal.
          ...(parsed && !found.length ? { unparsedShape: shapeOf(parsed) } : {}),
        },
      };
    }

    let detail;
    try { detail = JSON.parse(text); } catch { detail = { raw: text.slice(0, 500) }; }
    detail = scrub(detail, key);
    last = {
      code: upstream.status === 404 ? 404 : 502,
      body: {
        error: upstream.status === 401 || upstream.status === 403
          ? 'Roboflow rejected the key. Check ROBOFLOW_INFERENCE_KEY.'
          : `Roboflow returned ${upstream.status}.`,
        status: upstream.status,
        tried: url,
        detail,
      },
    };
    if (upstream.status !== 404) break;   // only a 404 is worth retrying elsewhere
  }

  log(id, '!!', `giving up: ${last?.body?.error ?? 'unknown'}`);
  return { error: last?.body?.error ?? 'Detection failed.', code: last?.code ?? 502, body: last?.body ?? { error: 'Detection failed.' } };
}

/**
 * The OpenAI leg.
 *
 * Deliberately one call and no image preparation. Anything drawn onto the plan
 * first — a grid, a ruler, an origin marker — is a step that can be wrong, an
 * image that is busier than the one the model was trained to read, and a second
 * coordinate space to map back out of. The bounds come back as fractions of the
 * image, which need no mapping at all: a fraction is still correct after any
 * resize, so the downscale the browser already does costs nothing here.
 *
 * `w` and `h` are the size of the image as sent. They are not used to convert
 * anything — replyToPayload resolves the fractions against them and declares
 * the result's space, and furniture.js rescales to the original from there.
 */
async function askOpenAI({ id, b64, mime, w, h, arm, model }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: 'OPENAI_API_KEY is not set on the server.', code: 500 };

  const body = buildRequest({ arm, base64: b64, mime, w, h, model });
  const t0 = Date.now();
  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    log(id, '!!', `could not reach OpenAI: ${err.message}`);
    return { error: `Could not reach OpenAI: ${err.message}`, code: 502 };
  }

  const ms = Date.now() - t0;
  const text = await upstream.text();
  log(id, '<-', `openai ${upstream.status} in ${ms}ms (${model}, arm=${arm})`);

  if (!upstream.ok) {
    let detail;
    try { detail = JSON.parse(text); } catch { detail = { raw: text.slice(0, 500) }; }
    // Same rule as the Roboflow leg: an upstream that echoes the request back
    // on a validation error must not hand the key to devtools.
    detail = scrub(detail, key);
    return {
      code: upstream.status === 401 || upstream.status === 403 ? 401 : 502,
      error: upstream.status === 401 || upstream.status === 403
        ? 'OpenAI rejected the key. Check OPENAI_API_KEY.'
        : `OpenAI returned ${upstream.status}.`,
      detail, ms,
    };
  }

  let json;
  try { json = JSON.parse(text); } catch { return { error: 'OpenAI returned non-JSON.', code: 502, ms }; }
  const reply = textFromResponse(json);
  const payload = replyToPayload(reply, { w, h, arm });

  // The model's own words are relayed. A refusal, a hedge, or "I can see a bed
  // but it is drawn at an angle" is the single most useful thing on the wire
  // when a run comes back empty, and it is invisible in the parsed payload.
  log(id, '==', payload.predictions.length
    ? `${payload.predictions.length} bed(s): ${payload.predictions.map((b) =>
        `${b.room ?? 'room?'} ${b.confidence.toFixed(2)} ${Math.round(b.width)}x${Math.round(b.height)}`).join(' | ')}`
    : `no beds. reply: ${reply.slice(0, 300)}`);
  if (payload.skipped?.length) {
    log(id, '??', `${payload.skipped.length} entr(y/ies) had no readable box`);
  }

  return {
    payload, ms,
    meta: {
      provider: 'openai', model, arm, ms,
      predictions: payload.predictions.length,
      rooms: [...new Set(payload.predictions.map((b) => b.room).filter(Boolean))],
      skipped: payload.skipped?.length ?? 0,
      usage: json.usage ?? null,
      // The raw text, capped. Never the key, never the image.
      reply: reply.slice(0, 600),
    },
  };
}

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
  const key = process.env.ROBOFLOW_INFERENCE_KEY;

  const image = body.image;
  if (!image || typeof image !== 'string') {
    log(id, '!!', 'no image in body');
    return send(400, { error: 'Expected { image: "<base64>" }.' });
  }
  // Accept a data: URL too, so callers need not remember to strip the prefix.
  const b64 = image.includes(',') && image.startsWith('data:') ? image.split(',')[1] : image;

  // Vercel's request body cap is 4.5MB and base64 inflates by a third. The
  // client downscales before sending; this is the guard for when it did not.
  const bytes = Math.floor(b64.length * 0.75);
  if (bytes > 4_000_000) {
    log(id, '!!', `refused ${(bytes / 1e6).toFixed(1)}MB body`);
    return send(413, { error: `Image is ${(bytes / 1e6).toFixed(1)}MB after decoding. Downscale it before sending — the cap here is 4MB.` });
  }

  const classes = typeof body.classes === 'string' && body.classes.trim()
    ? body.classes.trim() : 'bed';

  const provider = ['roboflow', 'openai', 'both'].includes(body.provider) ? body.provider : 'roboflow';
  // The arm is NOT taken from the body. The two grid arms need a measuring grid
  // drawn onto the image before it is sent, and this endpoint sends the image it
  // was given — asking for one here would produce a model reading a grid that
  // does not exist, and cell references resolved against a spec nobody drew.
  // They live in tools/eval-detect.mjs, which does the drawing.
  const arm = DEFAULT_ARM;
  const model = body.model || process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL;

  // The size of the image as SENT. Only the OpenAI leg needs it, to resolve its
  // fractions. The 1000 fallback is exact rather than approximate, and it is
  // worth seeing why: a fraction resolved against 1000 and then rescaled by
  // orig/1000 in furniture.js is fraction x orig, whatever the aspect ratio. So
  // a client that forgets to send w/h still lands the box in the right place.
  const w = Number(body.w) > 0 ? Number(body.w) : 1000;
  const h = Number(body.h) > 0 ? Number(body.h) : 1000;

  // The key check waits until the EFFECTIVE provider is known, and it only
  // refuses a roboflow-only call. A `both` call on a deployment that has an
  // OpenAI key and no Roboflow one must still return the OpenAI answer — the
  // point of `both` is that one provider being unavailable is survivable, and
  // a missing key is the most ordinary way for one to be unavailable. Gating
  // the whole request on it made `both` dead on exactly the setup that
  // DEFAULT_PROVIDER assumes.
  if (!key && provider === 'roboflow') {
    return send(500, { error: 'ROBOFLOW_INFERENCE_KEY is not set on the server.' });
  }

  log(id, '->', `${(bytes / 1024).toFixed(0)}KB ${body.mime || 'image'}, classes="${classes}"`
    + `, provider=${provider}${provider !== 'roboflow' ? ` (${model}, ${arm})` : ''}`);

  // --- openai only ---------------------------------------------------------
  if (provider === 'openai') {
    const r = await askOpenAI({ id, b64, mime: body.mime || 'image/jpeg', w, h, arm, model });
    if (r.error) return send(r.code ?? 502, { error: r.error, detail: r.detail, id });
    return send(200, { meta: { id, ...r.meta, bytes }, result: r.payload });
  }

  // --- both, concurrently --------------------------------------------------
  //
  // Concurrently and not in sequence: they are independent calls to different
  // companies, and the whole point of running detection on upload is that the
  // answer is in before there is a boundary to apply it to. Serialising them
  // would double the window in which there is nothing to show.
  //
  // Either one failing is not fatal. A provider that is down must not stop the
  // other's answer reaching the browser, and must not stop anyone planning a
  // room by hand — so the failure is reported alongside the result instead of
  // replacing it.
  if (provider === 'both') {
    const [rf, oa] = await Promise.all([
      key
        ? callRoboflow({ id, b64, key, classes, bytes, mime: body.mime }).catch((e) => ({ error: String(e.message || e) }))
        // Not a call we need to make to learn the answer.
        : Promise.resolve({ error: 'ROBOFLOW_INFERENCE_KEY is not set on the server.' }),
      askOpenAI({ id, b64, mime: body.mime || 'image/jpeg', w, h, arm, model }).catch((e) => ({ error: String(e.message || e) })),
    ]);
    if (rf.error && oa.error) {
      return send(502, { error: `Both providers failed. Roboflow: ${rf.error} OpenAI: ${oa.error}`, id });
    }
    return send(200, {
      meta: {
        id, bytes, classes, provider: 'both',
        roboflow: rf.error ? { error: rf.error } : rf.meta,
        openai: oa.error ? { error: oa.error } : oa.meta,
      },
      // Both payloads under one root. collectPredictions() walks for geometry
      // rather than for a key, so it finds every prediction in here without
      // being told the shape — and dedupe() collapses the two providers'
      // boxes over one bed into one zone. That is the reason this is a
      // two-element object and not a merge done by hand.
      result: {
        roboflow: rf.error ? null : rf.payload,
        openai: oa.error ? null : oa.payload,
      },
    });
  }

  // --- roboflow only -------------------------------------------------------
  const rf = await callRoboflow({ id, b64, key, classes, bytes, mime: body.mime });
  if (rf.error) return send(rf.code ?? 502, { ...rf.body, id });
  return send(200, { meta: { id, provider: 'roboflow', ...rf.meta, bytes }, result: rf.payload });
}
