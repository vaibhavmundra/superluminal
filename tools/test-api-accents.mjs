// ---------------------------------------------------------------------------
// test-api-accents.mjs — the endpoint that answers four different questions.
//
// THE GAP THIS FILLS. Every pure module here has a unit test and every one of
// them passed while the route 500'd on every successful room-type call: the
// prompt was right, the parser was right, and the handler then did
// `payload.skipped.length` on a payload that has no `skipped` array, because a
// room type is ONE answer and the other two tasks return lists. The server
// logged "bedroom 0.98" and the browser got an exception. Nothing that tests
// the pieces can catch a wrong assumption about the shape of the piece next
// door — only assembling the response can.
//
// `fetch` is stubbed, so this needs no key and no network. What is under test
// is everything between the reply arriving and the JSON going out.
//
//   node tools/test-api-accents.mjs
// ---------------------------------------------------------------------------

import handler from '../api/accents.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';

/** Answer every OpenAI call with this text, in the real envelope. */
let sent = null;
function stubOpenAI(text) {
  sent = null;
  globalThis.fetch = async (url, init) => ({
    ok: true, status: 200,
    text: async () => {
      sent = JSON.parse(init.body);
      return JSON.stringify({
        choices: [{ message: { content: text } }],
        usage: { total_tokens: 42 },
      });
    },
  });
}

/** Call the handler the way Vite's middleware does and collect the response. */
async function call(body) {
  let code = null, out = null;
  const res = { statusCode: 200, setHeader() {}, end(s) { code = this.statusCode; out = s; } };
  // Deliberately NOT wrapped in try/catch: a handler that throws is the bug
  // this file exists for, and swallowing it here would hide it again.
  await handler({ method: 'POST', body }, res);
  return { code, json: JSON.parse(out) };
}

const PLAN = { image: 'x'.repeat(400), mime: 'image/jpeg', w: 800, h: 800 };
const ROOM = { name: 'Room 3', widthFt: 12, heightFt: 10, areaSqft: 120 };

console.log('-- roomtype: one answer, not a list --');
{
  stubOpenAI('{"type":"bedroom","confidence":0.98,"why":"a bed and a wardrobe"}');
  const { code, json } = await call({ plan: PLAN, task: 'roomtype',
                                      projectId: 'residential', room: ROOM });
  ok(code === 200, `200, not a 500: ${code}`);
  ok(json.result?.type === 'bedroom' && json.result.confidence === 0.98,
    `the answer survives the round trip: ${json.result?.type} ${json.result?.confidence}`);
  ok(json.result.matched === true, 'and says it matched the vocabulary');
  ok(json.meta.task === 'roomtype' && json.meta.skipped === 0,
    'meta is assembled without assuming a `skipped` array exists');
  ok(typeof json.meta.reply === 'string', "and carries the model's own words");
}

console.log('\n-- an unreadable type is `other`, not an error --');
{
  stubOpenAI('{"type":"submarine","confidence":0.9}');
  const { code, json } = await call({ plan: PLAN, task: 'roomtype',
                                      projectId: 'residential', room: ROOM });
  ok(code === 200 && json.result.type === 'other' && json.result.matched === false,
    'still a 200, with `other` and matched=false');
  ok(json.result.confidence === 0, 'and no confidence — it was about a category we rejected');
}

console.log('\n-- furniture and surfaces still return lists --');
{
  stubOpenAI('{"furniture":[{"type":"bed","x0":0.1,"y0":0.1,"x1":0.5,"y1":0.6,"confidence":0.9},'
    + '{"type":"dining table","x0":0,"y0":0,"x1":0.1,"y1":0.1}]}');
  const a = await call({ plan: PLAN, task: 'furniture', room: ROOM, ceilingFt: 10 });
  ok(a.code === 200 && a.json.result.furniture.length === 1, 'furniture: one piece read');
  ok(a.json.meta.found === 1 && a.json.meta.skipped === 1,
    `meta counts both kept and dropped: found=${a.json.meta.found} skipped=${a.json.meta.skipped}`);

  stubOpenAI('{"surfaces":[{"type":"dining_table","x0":0.2,"y0":0.2,"x1":0.6,"y1":0.6,"confidence":0.8}]}');
  const b = await call({ plan: PLAN, task: 'surfaces', room: ROOM });
  ok(b.code === 200 && b.json.result.surfaces.length === 1, 'surfaces: one read');
  ok(b.json.meta.task === 'surfaces' && b.json.meta.found === 1, 'and its meta is right');
}

console.log('\n-- every task survives a reply it cannot parse --');
{
  for (const [task, extra] of [['roomtype', { projectId: 'residential' }],
                               ['furniture', {}], ['surfaces', {}]]) {
    stubOpenAI('I am afraid I cannot help with that.');
    const { code, json } = await call({ plan: PLAN, task, room: ROOM, ...extra });
    ok(code === 200 && json.result, `${task}: a refusal is a 200 with an empty result, not a throw`);
  }
}

console.log('\n-- the caller errors that must not become 500s --');
{
  stubOpenAI('{}');
  const bad = await call({ plan: PLAN, task: 'roomtype', projectId: 'atlantis', room: ROOM });
  ok(bad.code === 400 && /Unknown project type/.test(bad.json.error),
    `an unknown project is a 400 with a reason: ${bad.code}`);
  const none = await call({ task: 'roomtype', projectId: 'residential' });
  ok(none.code === 400, 'and a missing image is a 400');
}

console.log('\n-- an upstream failure is relayed, not thrown --');
{
  globalThis.fetch = async () => ({
    ok: false, status: 429, text: async () => '{"error":{"message":"rate limit"}}',
  });
  const { code, json } = await call({ plan: PLAN, task: 'roomtype',
                                      projectId: 'residential', room: ROOM });
  ok(code === 502 && /OpenAI returned 429/.test(json.error), `502 with the status: ${json.error}`);
  ok(!JSON.stringify(json).includes(process.env.OPENAI_API_KEY), 'and the key is not in the body');
}


console.log('\n-- bedfit: two pictures in, one letter out --');
{
  stubOpenAI('{"pick":"B","confidence":0.88,"why":"A stops short of the foot of the bed"}');
  const A = { image: 'a'.repeat(400), mime: 'image/jpeg', w: 900, h: 900 };
  const B = { image: 'b'.repeat(400), mime: 'image/jpeg', w: 900, h: 900 };
  const { code, json } = await call({ plans: [A, B], task: 'bedfit', room: ROOM,
                                      counts: { a: 1, b: 2 } });
  ok(code === 200, `200: ${code}`);
  ok(json.result?.pick === 'B' && json.result.confidence === 0.88, 'the letter survives the round trip');
  ok(json.result.matched === true && /foot of the bed/.test(json.result.why),
    "and the judge's own sentence with it");
  ok(json.meta.task === 'bedfit' && json.meta.images === 2, 'meta says two images went out');
  // The same shape hole that produced the roomtype 500: a bedfit payload has no
  // `skipped` array and no list to count either.
  ok(json.meta.skipped === 0 && json.meta.found === 1,
    'and is assembled without assuming a list or a `skipped` array');

  const imgs = sent.messages[0].content.filter((c) => c.type === 'image_url');
  ok(imgs.length === 2, 'BOTH images reached OpenAI, not just the first');
  ok(imgs[0].image_url.url.includes('aaa') && imgs[1].image_url.url.includes('bbb'),
    'in the order they were given');
  ok(/do not agree on how many/i.test(sent.messages[0].content[0].text),
    'and the count mismatch reached the prompt');
}

console.log('\n-- a judge that will not choose is a 200, not a crash --');
{
  stubOpenAI('I think they are equally good.');
  const A = { image: 'a'.repeat(400), mime: 'image/jpeg', w: 900, h: 900 };
  const { code, json } = await call({ plans: [A, A], task: 'bedfit', room: ROOM });
  ok(code === 200 && json.result.pick === null && json.result.matched === false,
    'reported as a non-answer, so the browser can take its fallback');
  ok(json.result.confidence === 0, 'with no confidence attached');
}

console.log('\n-- one image where two are needed --');
{
  stubOpenAI('{"pick":"A"}');
  const A = { image: 'a'.repeat(400), mime: 'image/jpeg', w: 900, h: 900 };
  const { code, json } = await call({ plans: [A], task: 'bedfit', room: ROOM });
  ok(code === 400 && /two images/i.test(json.error),
    `a caller error, not a 500 and not a silent one-image comparison: ${code} ${json.error}`);
}

console.log('\n-- the size guard counts the WHOLE body --');
{
  stubOpenAI('{"pick":"A"}');
  // Two images that each pass a per-image guard and together do not. Vercel
  // refuses on the body, so this must too — and must name the real reason.
  const big = { image: 'z'.repeat(3_600_000), mime: 'image/jpeg', w: 900, h: 900 };
  const { code, json } = await call({ plans: [big, big], task: 'bedfit' });
  ok(code === 413, `413: ${code}`);
  ok(/2 images|images are/.test(json.error), `and says both were counted: "${json.error}"`);

  // One image of the same size is fine, which is what makes the above a sum
  // rather than a lowered ceiling.
  const one = await call({ plan: big, task: 'roomtype', projectId: 'residential' });
  ok(one.code === 200, `one of them alone still goes through: ${one.code}`);
}

console.log('\n-- `plan` and `plans` are the same wire --');
{
  stubOpenAI('{"type":"bedroom","confidence":0.9}');
  const viaList = await call({ plans: [PLAN], task: 'roomtype', projectId: 'residential' });
  ok(viaList.code === 200 && viaList.json.result.type === 'bedroom',
    'a single-image task reads a one-element list');
  ok(viaList.json.meta.images === 1, 'and counts it as one');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
