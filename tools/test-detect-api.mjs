// ---------------------------------------------------------------------------
// test-detect-api.mjs — the proxy, with the network stubbed out.
//
// This function is the only thing standing between a browser and our Roboflow
// key, so the things worth asserting are all refusals: no key, wrong method,
// oversized body, and — the one that would actually cost money — the key
// appearing anywhere in a response the client can read.
// ---------------------------------------------------------------------------

import handler from '../api/detect.js';

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log(`   FAIL  ${what}`); } };

const KEY = 'test-key-do-not-ship';
const OAI_KEY = 'sk-openai-key-do-not-ship';
const B64 = Buffer.from('x'.repeat(600)).toString('base64');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; this.headersSent = true; },
    json() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}
const req = (method, body) => ({ method, body });

async function run(r, env = {}, fetchImpl = null) {
  const saved = { ...process.env }, savedFetch = global.fetch;
  process.env.ROBOFLOW_INFERENCE_KEY = KEY;
  process.env.OPENAI_API_KEY = OAI_KEY;
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  const calls = [];
  global.fetch = fetchImpl || (async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ outputs: [] }) };
  });
  const res = mockRes();
  try { await handler(r, res); } finally { process.env = saved; global.fetch = savedFetch; }
  return { res, calls };
}

console.log('detect api — refusals');
{
  const { res: m } = await run(req('GET'));
  ok(m.statusCode === 405, 'GET is refused');

  const { res: o } = await run(req('OPTIONS'));
  ok(o.statusCode === 204, 'OPTIONS preflight is answered');

  const { res: nokey } = await run(req('POST', { image: B64 }), { ROBOFLOW_INFERENCE_KEY: null });
  ok(nokey.statusCode === 500, 'a missing key is a server error, not a silent pass');
  ok(/ROBOFLOW_INFERENCE_KEY/.test(nokey.json().error), 'and names the variable');

  const { res: noimg } = await run(req('POST', {}));
  ok(noimg.statusCode === 400, 'no image is a bad request');

  const { res: big } = await run(req('POST', { image: 'A'.repeat(8_000_000) }));
  ok(big.statusCode === 413, 'an oversized body is refused before it reaches Roboflow');
  ok(/[Dd]ownscale/.test(big.json().error), 'and says what to do about it');
}

console.log('detect api — what gets sent upstream');
{
  const { calls } = await run(req('POST', { image: B64, classes: 'bed' }));
  ok(calls.length === 1, 'one upstream call');
  ok(calls[0].body.api_key === KEY, 'the key is added server-side');
  ok(calls[0].body.inputs.image.type === 'base64', 'the image goes as base64 — no URL, no bucket');
  ok(calls[0].body.inputs.image.value === B64, 'and is passed through untouched');
  ok(calls[0].body.inputs.classes === 'bed', 'the class list is forwarded');

  // A caller that forgot to strip the data: prefix should still work.
  const { calls: c2 } = await run(req('POST', { image: `data:image/png;base64,${B64}` }));
  ok(c2[0].body.inputs.image.value === B64, 'a data: URL is stripped to bare base64');

  const { calls: c3 } = await run(req('POST', { image: B64 }));
  ok(c3[0].body.inputs.classes === 'bed', 'classes defaults to bed');

  const { calls: c4 } = await run(req('POST', { image: B64, classes: '   ' }));
  ok(c4[0].body.inputs.classes === 'bed', 'a blank class list falls back rather than asking for nothing');
}

console.log('detect api — the key never comes back out');
{
  const fail = async () => ({ ok: false, status: 500, text: async () => 'upstream exploded' });
  const { res } = await run(req('POST', { image: B64 }), {}, fail);
  ok(!res.body.includes(KEY), 'the key is absent from an error response');

  const echo = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ sent: { api_key: KEY } }) });
  const { res: r2 } = await run(req('POST', { image: B64 }), {}, echo);
  ok(r2.statusCode === 502, 'an upstream 400 is reported as a bad gateway');
  // Roboflow echoing our own payload back in an error is the realistic leak.
  ok(!r2.body.includes(KEY), 'and a key echoed by upstream is not relayed to the browser');
}

console.log('detect api — auth and 404 handling');
{
  const denied = async () => ({ ok: false, status: 401, text: async () => '{}' });
  const { res } = await run(req('POST', { image: B64 }), {}, denied);
  ok(/rejected the key/.test(res.json().error), 'a 401 says the key was rejected, not "unknown error"');

  // A 404 is retried against the other documented URL shape before giving up.
  let seen = [];
  const notFound = async (url) => { seen.push(url); return { ok: false, status: 404, text: async () => '{}' }; };
  const { res: r404 } = await run(req('POST', { image: B64 }), {}, notFound);
  ok(seen.length === 2, 'a 404 is retried against the alternate URL shape');
  ok(seen[0] !== seen[1], 'and the retry is a different URL');
  ok(seen.some((u) => u.includes('/infer/workflows/')), 'one of them is the /infer/workflows/ form');
  ok(seen.some((u) => /\/[^/]+\/workflows\//.test(u.replace('/infer', ''))), 'the other is the short form');
  ok(r404.statusCode === 404, 'and a genuine 404 is still reported as one');

  // Anything that is not a 404 must NOT be retried — retrying a 500 doubles
  // the bill for no reason.
  let hits = 0;
  const flaky = async () => { hits++; return { ok: false, status: 500, text: async () => '{}' }; };
  await run(req('POST', { image: B64 }), {}, flaky);
  ok(hits === 1, 'a 500 is not retried');

  const { calls } = await run(req('POST', { image: B64 }), { ROBOFLOW_WORKFLOW_URL: 'https://example.com/w/workflows/x' });
  ok(calls[0].url === 'https://example.com/w/workflows/x', 'ROBOFLOW_WORKFLOW_URL overrides the default');
}

console.log('detect api — a raw stream body (Vite dev has no body parser)');
{
  async function* gen() { yield Buffer.from(JSON.stringify({ image: B64, classes: 'bed' })); }
  const streamReq = Object.assign(gen(), { method: 'POST' });
  const { calls } = await run(streamReq);
  ok(calls.length === 1 && calls[0].body.inputs.image.value === B64,
    'an unparsed stream body is read the same as a parsed one');

  async function* bad() { yield Buffer.from('not json'); }
  const { res } = await run(Object.assign(bad(), { method: 'POST' }));
  ok(res.statusCode === 400, 'a malformed stream body is a bad request');
}


// --- the second provider ----------------------------------------------------
//
// Everything asserted about the Roboflow leg has to hold for this one too, and
// the one that matters most is the last: a validation error from an API that
// echoes your request back would otherwise relay the key into devtools.

/** An OpenAI chat-completions response carrying `text` as the reply. */
const oaiOk = (text, usage = { prompt_tokens: 900, completion_tokens: 40 }) => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content: text } }], usage }),
});

console.log('detect api — the openai provider');
{
  const seen = [];
  const { res } = await run(req('POST', {
    image: B64, provider: 'openai', w: 800, h: 600,
  }), {}, async (url, init) => {
    seen.push({ url, init });
    return oaiOk('{"beds":[{"x0":0.25,"y0":0.5,"x1":0.5,"y1":0.75,"confidence":0.9,"room":"MASTER BEDROOM"}]}');
  });

  ok(seen.length === 1, `exactly one upstream call, got ${seen.length}`);
  ok(/api\.openai\.com/.test(seen[0].url), 'to OpenAI, not Roboflow');
  ok(seen[0].init.headers.Authorization === `Bearer ${OAI_KEY}`, 'with the key as a bearer token');
  ok(!JSON.stringify(seen[0].init.body).includes('api_key'), 'and not also in the body');

  const j = res.json();
  ok(res.statusCode === 200, `200, got ${res.statusCode}`);
  ok(j.result.predictions.length === 1, 'the bed comes back');
  const b = j.result.predictions[0];
  // 0.25..0.5 of 800 is 200..400, so a 200-wide box centred at 300.
  ok(Math.abs(b.x - 300) < 0.01 && Math.abs(b.width - 200) < 0.01,
    `fractions resolved against the sent size, got x=${b.x} w=${b.width}`);
  ok(j.result.image.width === 800, 'and the payload declares that space for rescaleRect');
  ok(j.meta.provider === 'openai' && j.meta.rooms[0] === 'MASTER BEDROOM',
    'the room name it read off the plan is relayed');
  ok(typeof j.meta.reply === 'string' && j.meta.reply.length,
    'and so is its own text, which is the only clue when a run comes back empty');
}

console.log('detect api — an openai-only call needs no roboflow key');
{
  const { res } = await run(req('POST', { image: B64, provider: 'openai', w: 10, h: 10 }),
    { ROBOFLOW_INFERENCE_KEY: null }, async () => oaiOk('{"beds":[]}'));
  ok(res.statusCode === 200, `200 with no Roboflow key at all, got ${res.statusCode}`);
  ok(res.json().result.predictions.length === 0, 'and an honest empty answer is a 200, not an error');

  const { res: nokey } = await run(req('POST', { image: B64, provider: 'openai' }),
    { OPENAI_API_KEY: null }, async () => oaiOk('{"beds":[]}'));
  ok(nokey.statusCode === 500 && /OPENAI_API_KEY/.test(nokey.json().error),
    'a missing OpenAI key names the variable it wants');
}

console.log('detect api — the openai key never reaches the browser');
{
  // The failure mode this exists for: an upstream that includes the request it
  // received in its error body.
  const echo = async () => ({
    ok: false, status: 400,
    text: async () => JSON.stringify({
      // Three ways the key can come back: a named field, a nested header, and
      // — the one a key-dropping filter alone would miss — inside prose.
      error: { message: `invalid request for key ${OAI_KEY}`,
               echo: { headers: { Authorization: `Bearer ${OAI_KEY}` } } },
      api_key: OAI_KEY,
    }),
  });
  const { res } = await run(req('POST', { image: B64, provider: 'openai' }), {}, echo);
  ok(res.statusCode === 502, `relayed as a 502, got ${res.statusCode}`);
  ok(!res.body.includes(OAI_KEY), 'THE KEY IS NOT IN THE RESPONSE BODY');
  ok(/\*\*\*/.test(res.body), 'it was masked rather than the whole detail being dropped');

  const { res: unauth } = await run(req('POST', { image: B64, provider: 'openai' }), {},
    async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"bad key"}}' }));
  ok(unauth.statusCode === 401 && /OPENAI_API_KEY/.test(unauth.json().error),
    'a 401 says which key to check rather than "502"');
}

console.log('detect api — both providers at once');
{
  let rf = 0, oa = 0;
  const { res } = await run(req('POST', { image: B64, provider: 'both', w: 400, h: 400 }), {},
    async (url) => {
      if (/openai/.test(url)) { oa++; return oaiOk('{"beds":[{"x0":0.1,"y0":0.1,"x1":0.3,"y1":0.4}]}'); }
      rf++;
      return { ok: true, status: 200, text: async () => JSON.stringify({
        predictions: { image: { width: 400, height: 400 },
          predictions: [{ x: 80, y: 100, width: 80, height: 120, confidence: 0.7, class: 'bed' }] } }) };
    });
  ok(rf === 1 && oa === 1, `one call each, got roboflow=${rf} openai=${oa}`);
  const j = res.json();
  ok(j.result.roboflow && j.result.openai, 'both payloads come back under one root');
  ok(j.meta.roboflow && j.meta.openai, 'and both metas, so the browser can say which found what');
}

console.log('detect api — one provider down does not take the other with it');
{
  const { res } = await run(req('POST', { image: B64, provider: 'both', w: 400, h: 400 }), {},
    async (url) => {
      if (/openai/.test(url)) throw new Error('network is down');
      return { ok: true, status: 200, text: async () => JSON.stringify({
        predictions: { image: { width: 400, height: 400 },
          predictions: [{ x: 80, y: 100, width: 80, height: 120, confidence: 0.7, class: 'bed' }] } }) };
    });
  ok(res.statusCode === 200, `still a 200, got ${res.statusCode}`);
  const j = res.json();
  ok(j.result.roboflow, 'the provider that worked still returns its answer');
  ok(j.result.openai === null && j.meta.openai.error, 'and the one that did not is reported, not hidden');

  const { res: both } = await run(req('POST', { image: B64, provider: 'both' }), {},
    async () => { throw new Error('everything is down'); });
  ok(both.statusCode === 502, 'both failing is a 502');
}

console.log('detect api — `both` survives a missing roboflow key');
{
  // The setup DEFAULT_PROVIDER assumes: an OpenAI key and no Roboflow one.
  // Gating the whole request on the Roboflow key made `both` dead here, and
  // returned a 500 without ever calling the provider that would have answered.
  let oa = 0;
  const { res } = await run(req('POST', { image: B64, provider: 'both', w: 400, h: 400 }),
    { ROBOFLOW_INFERENCE_KEY: null }, async (url) => {
      if (/openai/.test(url)) { oa++; return oaiOk('{"beds":[{"x0":0.1,"y0":0.1,"x1":0.3,"y1":0.4}]}'); }
      throw new Error('roboflow should not have been called without a key');
    });
  ok(res.statusCode === 200, `200, got ${res.statusCode}`);
  ok(oa === 1, 'the OpenAI leg still runs');
  const j = res.json();
  ok(j.result.openai.predictions.length === 1, 'and its answer reaches the browser');
  ok(/ROBOFLOW_INFERENCE_KEY/.test(j.meta.roboflow.error),
    'while the missing key is reported as that leg failing, not as the request failing');

  // A roboflow-ONLY call with no key is still a plain 500.
  const { res: only } = await run(req('POST', { image: B64, provider: 'roboflow' }),
    { ROBOFLOW_INFERENCE_KEY: null });
  ok(only.statusCode === 500 && /ROBOFLOW_INFERENCE_KEY/.test(only.json().error),
    'and asking for roboflow alone without its key still names the variable');
}

console.log('detect api — an unknown provider falls back rather than failing');
{
  const seen = [];
  await run(req('POST', { image: B64, provider: 'gemini' }), {}, async (url) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => '{"outputs":[]}' };
  });
  ok(seen.length === 1 && /roboflow/.test(seen[0]),
    'a provider we do not have goes to the default, not to a crash');
}

console.log('detect api — the rooms task');
{
  // A different workflow, not a different class list. The one thing that would
  // silently break the feature is the rooms question reaching the furniture
  // workflow, which would answer it — with beds.
  const { calls, res } = await run(req('POST', { image: B64, task: 'rooms' }));
  ok(calls.length === 1, 'one upstream call for a rooms request');
  ok(/detect-and-count-objects-in-image/.test(calls[0].url),
    `the rooms workflow is the one called (got ${calls[0].url})`);
  ok(res.json().meta.task === 'rooms', 'the response says which question was asked');

  // Inputs are discovered, not assumed: image alone first.
  ok(Object.keys(calls[0].body.inputs).join() === 'image',
    `image alone goes first (got ${Object.keys(calls[0].body.inputs).join('+')})`);

  // ...and a 4xx that reads as "wrong inputs" retries with the class list.
  const tried = [];
  const { res: retried } = await run(req('POST', { image: B64, task: 'rooms', classes: 'room' }), {},
    async (url, init) => {
      const inputs = Object.keys(JSON.parse(init.body).inputs).join('+');
      tried.push(inputs);
      if (inputs === 'image') {
        return { ok: false, status: 400, text: async () => '{"detail":"missing input: classes"}' };
      }
      return { ok: true, status: 200, text: async () => '{"outputs":[]}' };
    });
  ok(tried.join(' -> ') === 'image -> image+classes',
    `a 400 on the narrow shape retries with the class list (got ${tried.join(' -> ')})`);
  ok(retried.statusCode === 200, 'and the second shape being accepted is a success');

  // A rejected key is final: it must not be retried against every input shape.
  const auth = [];
  const { res: bad } = await run(req('POST', { image: B64, task: 'rooms' }), {},
    async (url, init) => {
      auth.push(Object.keys(JSON.parse(init.body).inputs).join('+'));
      return { ok: false, status: 401, text: async () => '{"message":"Unauthorized"}' };
    });
  ok(auth.length === 1, `a 401 is not retried against other input shapes (${auth.length} calls)`);
  ok(bad.statusCode === 401 && /ROBOFLOW_INFERENCE_KEY/.test(bad.json().error),
    'and it names the variable to check');

  // The env override, so a workflow can be repointed without a deploy.
  const { calls: over } = await run(req('POST', { image: B64, task: 'rooms' }),
    { ROBOFLOW_ROOMS_WORKFLOW_URL: 'https://example.com/ws/workflows/mine' });
  ok(over[0].url === 'https://example.com/ws/workflows/mine',
    `ROBOFLOW_ROOMS_WORKFLOW_URL is honoured (got ${over[0].url})`);

  // ...and it must not repoint the bed detector with it.
  const { calls: fur } = await run(req('POST', { image: B64, provider: 'roboflow' }),
    { ROBOFLOW_ROOMS_WORKFLOW_URL: 'https://example.com/ws/workflows/mine' });
  ok(!/example\.com/.test(fur[0].url),
    'the rooms URL does not leak into the furniture route');

  // And the key never reaches the client, on this route as on the others.
  const { res: echo } = await run(req('POST', { image: B64, task: 'rooms' }), {},
    async (url, init) => ({
      ok: false, status: 422,
      text: async () => JSON.stringify({ error: 'bad request', echo: JSON.parse(init.body) }),
    }));
  ok(!echo.body.includes(KEY), 'an upstream that echoes the request back does not leak the key');
}

console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
