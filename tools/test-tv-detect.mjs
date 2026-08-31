// ---------------------------------------------------------------------------
// test-tv-detect.mjs — the one-question television pass.
//
// The thing worth locking down here is that "no television" and "a television I
// could not read" are DIFFERENT ANSWERS. The first is a correct and common
// reading of a bedroom; the second is a dropped box that somebody needs told
// about. A parser that collapses them makes an empty wall and a broken reply
// look identical from the outside.
//
//   node tools/test-tv-detect.mjs
// ---------------------------------------------------------------------------

import { buildTvPrompt, buildTvRequest, tvFromReply, TV_TYPE } from '../src/lib/tvDetect.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('-- reading a reply --');
{
  const reply = '```json\n' + JSON.stringify({
    room: 'bedroom',
    tv: { x0: 0.2, y0: 0.9, x1: 0.6, y1: 0.93, confidence: 0.82,
      note: 'shallow rectangle on the wall the foot of the bed faces' },
    notes: '',
  }) + '\n```';
  const p = tvFromReply(reply, { w: 1000, h: 800 });
  ok(p.tv !== null, 'a fenced reply parses');
  ok(near(p.tv.rect.x0, 200) && near(p.tv.rect.x1, 600),
    'fractions resolved against the sent width');
  ok(near(p.tv.rect.y0, 720) && near(p.tv.rect.y1, 744),
    'and against the sent height');
  ok(p.tv.unit === 'fraction', 'the unit it read is carried, not assumed');
  ok(near(p.tv.confidence, 0.82), 'confidence survives');
  ok(p.room === 'bedroom' && p.skipped.length === 0, 'room read, nothing dropped');
}

console.log('\n-- one answer or none --');
{
  const two = tvFromReply(JSON.stringify({
    tv: [{ x0: 0.2, y0: 0.9, x1: 0.6, y1: 0.93, confidence: 0.8 },
      { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.13, confidence: 0.7 }],
  }), { w: 1000, h: 1000 });
  ok(two.tv !== null && near(two.tv.rect.x0, 200),
    'a list where an object was asked for keeps the first entry, not both');

  const bare = tvFromReply(JSON.stringify({
    items: [{ x0: 0.2, y0: 0.9, x1: 0.6, y1: 0.93 }],
  }), { w: 1000, h: 1000 });
  ok(bare.tv !== null, 'an unprompted list key is still read');
}

console.log('\n-- "there is no television" is an answer --');
{
  for (const reply of ['{"room":"bedroom","tv":null,"notes":""}', '{"tv":null}', '{}']) {
    const p = tvFromReply(reply, { w: 800, h: 800 });
    ok(p.tv === null && p.skipped.length === 0,
      `null is a clean no, not a drop: ${reply}`);
  }
}

console.log('\n-- ...and a broken box is not --');
{
  const bad = tvFromReply('{"tv":{"confidence":0.9,"note":"on the far wall"}}', { w: 800, h: 800 });
  ok(bad.tv === null && bad.skipped.length === 1,
    'an entry with no readable box is reported as dropped, not as an empty wall');
  const flat = tvFromReply('{"tv":{"x0":0.2,"y0":0.5,"x1":0.2,"y1":0.5}}', { w: 800, h: 800 });
  ok(flat.tv === null && flat.skipped.length === 1, 'a zero-area box likewise');
}

console.log('\n-- junk does not throw --');
{
  for (const junk of ['', 'not json', '[]', '{"tv":3}', '{"tv":[]}', 'null']) {
    let threw = false, p = null;
    try { p = tvFromReply(junk, { w: 640, h: 480 }); } catch { threw = true; }
    ok(!threw && p && p.tv === null, `survives ${JSON.stringify(junk)}`);
  }
}

console.log('\n-- the prompt --');
{
  const t = buildTvPrompt({ room: { name: 'Bedroom 2', widthFt: 12, heightFt: 10.5, areaSqft: 126 } });
  ok(/THE BED IS YOUR STARTING POINT/.test(t), 'the bed is the premise, not a second search');
  ok(/the wall the foot points at/i.test(t), 'and the foot wall is named as the one to look at');
  ok(/Bedroom 2/.test(t), 'the drawing\'s own label is passed through');
  ok(/12\.0 ft by 10\.5 ft/.test(t), 'so is the size');
  ok(/FRACTIONS of the image/.test(t), 'boxes are asked for as fractions, like every other pass');
  ok(/BOX THE SCREEN, TIGHTLY/.test(t), 'and tightly, because its length decides where the board goes');
  ok(/Returning null is/.test(t), 'the model is told that "none" is a real answer');
  ok(/wardrobe/i.test(t) && /dressing table/i.test(t),
    'the two things most easily mistaken for one are named');
  ok(/socket and a switch/.test(t), 'and it is told what a wrong answer costs');
  ok(!/Bedroom 2/.test(buildTvPrompt({})), 'no room, no room line');
}

console.log('\n-- the request --');
{
  const req = buildTvRequest({ plan: { base64: 'AAAA', mime: 'image/png' }, room: null });
  ok(req.response_format.type === 'json_object', 'json mode');
  ok(typeof req.max_completion_tokens === 'number' && req.max_completion_tokens >= 8000,
    'a generous output cap, for the reason in taskSurfaces.js');
  ok(!('temperature' in req), 'no temperature — reasoning models 400 on it');
  const [img, txt] = req.messages[0].content;
  ok(img.image_url.url === 'data:image/png;base64,AAAA', 'the image goes as a data url');
  ok(img.image_url.detail === 'high', 'at high detail, because this is line work');
  ok(txt.type === 'text' && txt.text.length > 500, 'and the question follows it');
  let threw = false;
  try { buildTvRequest({ plan: {} }); } catch { threw = true; }
  ok(threw, 'no image is a throw, not a request with a broken url in it');
}

console.log('\n-- the vocabulary --');
{
  ok(TV_TYPE.id === 'tv', 'one type, and it is called tv');
  ok(/shallow/.test(TV_TYPE.plan), 'described by how it reads in plan, not by what it is');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
