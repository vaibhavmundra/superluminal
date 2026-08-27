// ---------------------------------------------------------------------------
// test-bedfit.mjs — the bed-fit judge.
//
// The thing worth pinning is not the prompt. It is WHEN THE CALL IS NOT MADE:
// three of the four situations a room can be in are decided without asking, and
// a regression that makes the app ask anyway is invisible except on the bill.
// The other half is that a judge which fails, hedges, or answers in a way we
// cannot read must land on a defined, deterministic box rather than on none.
//
//   node tools/test-bedfit.mjs
// ---------------------------------------------------------------------------

import { BED_SOURCES, BEDFIT_DEFAULTS, splitByProvider, label, bedsIn,
         sameAnswer, contestFor, applyVerdict, bedFitFromReply,
         buildBedFitPrompt, buildBedFitRequest } from '../src/lib/bedFit.js';
import { dedupe } from '../src/lib/furniture.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

const box = (x0, y0, x1, y1, conf = 0.9) => ({ cls: 'bed', conf, rect: { x0, y0, x1, y1 } });
const ROOM = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];

console.log('-- the two answers are kept apart --');
{
  // The `both` route returns them under their own keys precisely so this is
  // possible. The ordinary path walks the whole thing and merges; this must not.
  const payload = { result: { roboflow: { predictions: ['RF'] }, openai: { predictions: ['OA'] } } };
  const seen = [];
  const out = splitByProvider(payload, (half) => {
    seen.push(half.predictions[0]);
    return { kept: [box(0, 0, 10, 10)], rejected: [] };
  });
  ok(seen.join(',') === 'RF,OA', `each half parsed once, in order: ${seen.join(',')}`);
  ok(out.roboflow.kept.length === 1 && out.openai.kept.length === 1, 'and both come back');

  // A provider that failed comes back null from the route, not missing.
  const half = splitByProvider({ result: { roboflow: null, openai: { p: 1 } } },
    () => ({ kept: [box(0, 0, 10, 10)], rejected: [] }));
  ok(half.roboflow.kept.length === 0 && half.openai.kept.length === 1,
    'a failed provider is an empty answer, not a crash');

  // Ids carry who found it, so a later merge cannot mix them up.
  const l = label([box(10, 10, 20, 20)], 'roboflow');
  ok(l[0].provider === 'roboflow' && l[0].id.includes('-rf-'), `tagged: ${l[0].id}`);
  ok(label([box(10, 10, 20, 20)], 'openai')[0].id !== l[0].id,
    'and the same box from the other detector gets a different id');
}

console.log('\n-- a bed belongs to the room it stands in --');
{
  const inside = label([box(50, 50, 110, 130)], 'roboflow');
  const outside = label([box(300, 50, 360, 130)], 'roboflow');
  ok(bedsIn([...inside, ...outside], ROOM).length === 1, 'only the one inside the polygon');
  ok(bedsIn(inside, null).length === 1, 'and with no polygon, everything');
}

console.log('\n-- when the two answers are the same answer --');
{
  const a = [box(50, 50, 110, 130)];
  ok(sameAnswer(a, [box(51, 50, 111, 131)]), 'a pixel apart is the same bed');
  ok(sameAnswer([], []), 'nothing and nothing agree');
  ok(!sameAnswer(a, [box(50, 50, 110, 130), box(10, 10, 40, 40)]),
    'a different COUNT is a disagreement even if one box matches');

  // A box that is merely GENEROUS — it took in the bedside tables — is still a
  // disagreement worth settling, even though de-dup would have collapsed it.
  const generous = box(38, 46, 124, 138);
  ok(!sameAnswer([box(50, 50, 110, 130)], [generous]),
    'a box that swallowed the side tables is a disagreement');

  // THE CASE THE JUDGE EXISTS FOR. One detector traces the mattress, the other
  // has drifted half a bed off it — the two overlap too little for de-dup to
  // treat them as one box, so the old `both` path kept BOTH and zoned their
  // union. Two-thirds of that union is floor, and the fittings that would have
  // lit it moved for nothing.
  const tight = box(50, 50, 110, 130);
  const drifted = box(80, 60, 140, 140);
  ok(!sameAnswer([tight], [drifted]), 'a box drifted half a bed over is a disagreement');
  ok(dedupe([tight, drifted]).length === 2,
    'and `both` would have kept them BOTH — which is the bug this replaces');
}

console.log('\n-- three of the four situations need no call --');
{
  const a = [box(50, 50, 110, 130)];
  const b = [box(120, 50, 180, 130)];

  const none = contestFor([], []);
  ok(none.kind === 'none' && !none.ask && none.winner.length === 0, 'no bed anywhere: nothing to ask');

  const onlyB = contestFor([], b);
  ok(onlyB.kind === 'uncontested' && !onlyB.ask && onlyB.pick === 'openai' && onlyB.winner === b,
    'only GPT committed: taken as it stands, no call');
  const onlyA = contestFor(a, []);
  ok(onlyA.kind === 'uncontested' && !onlyA.ask && onlyA.pick === 'roboflow',
    'only Roboflow committed: likewise');

  const agree = contestFor(a, [box(51, 51, 111, 131)]);
  ok(agree.kind === 'agreed' && !agree.ask, 'both found the same bed: no call');
  ok(agree.pick === BEDFIT_DEFAULTS.fallback,
    `and the tie goes to the documented fallback (${BEDFIT_DEFAULTS.fallback}), not to list order`);

  const fight = contestFor(a, b);
  ok(fight.kind === 'contest' && fight.ask && fight.winner === null,
    'genuinely different: THIS is the one that costs a call');
  ok(/different places/.test(fight.why), `and it says why: "${fight.why}"`);
}

console.log('\n-- the verdict picks a list, never a rectangle --');
{
  const a = [box(50, 50, 110, 130)];
  const b = [box(120, 50, 180, 130)];

  const A = applyVerdict(a, b, { pick: 'A', confidence: 0.9, why: 'B is on the wardrobe' });
  ok(A.pick === 'roboflow' && A.winner === a, 'A is Roboflow');
  ok(A.why === 'B is on the wardrobe', 'and the judge’s sentence travels with it');
  const B = applyVerdict(a, b, { pick: 'B', confidence: 0.8, why: '' });
  ok(B.pick === 'openai' && B.winner === b, 'B is GPT');

  // Whatever it says, the box on the plan is a box a DETECTOR measured. There
  // is no path here that constructs a rectangle from the judge's words.
  ok(A.winner[0] === a[0] && B.winner[0] === b[0],
    'the winner is one of the two lists by identity — nothing is re-derived');

  const weak = applyVerdict(a, b, { pick: 'B', confidence: 0.1, why: 'hard to say' });
  ok(weak.pick === BEDFIT_DEFAULTS.fallback && weak.fellBack,
    `a hedge below the floor falls back to ${BEDFIT_DEFAULTS.fallback}`);
  ok(/not sure enough/.test(weak.why), `and says so instead of quoting the hedge: "${weak.why}"`);

  const dead = applyVerdict(a, b, null);
  ok(dead.winner === a && dead.fellBack && /could not be reached/.test(dead.why),
    'a judge that never answered still yields a bed, and admits it');
  ok(dead.confidence === 0, 'with no confidence attached to it');
}

console.log('\n-- reading the letter back --');
{
  ok(bedFitFromReply('{"pick":"A","confidence":0.82,"why":"B cuts the bed in half"}').pick === 'A',
    'plain JSON');
  ok(bedFitFromReply('```json\n{"pick":"B","confidence":0.6}\n```').pick === 'B', 'fenced');
  ok(bedFitFromReply('{"choice":"Image B","confidence":0.7}').pick === 'B', 'a letter inside a sentence');
  ok(bedFitFromReply('{"pick":"b"}').pick === 'B', 'lower case');
  ok(bedFitFromReply('{"pick":"A"}').confidence === 0.6, 'a missing confidence gets a middling default');

  const junk = bedFitFromReply('they look about the same to me');
  ok(!junk.matched && junk.pick === null, 'a non-answer is reported as one');
  ok(junk.confidence === 0, 'with zero confidence, so the caller’s floor rejects it without a special case');
  // ...and that zero is what makes the fallback fire.
  ok(applyVerdict([box(0,0,1,1)], [box(2,2,3,3)], junk).fellBack, 'which is what makes the fallback fire');

  // "C" is not an option and must not be coerced into one.
  ok(bedFitFromReply('{"pick":"neither"}').pick === null, 'a refusal is not silently rounded to A');
}

console.log('\n-- what actually goes on the wire --');
{
  const one = { base64: 'AAA', mime: 'image/jpeg' };
  let threw = false;
  try { buildBedFitRequest({ plans: [one] }); } catch { threw = true; }
  ok(threw, 'one image is not a contest, and fails loudly');

  const req = buildBedFitRequest({ plans: [one, { base64: 'BBB', mime: 'image/jpeg' }],
    room: { name: 'Bed 1', widthFt: 12, heightFt: 10 }, counts: { a: 1, b: 2 } });
  const parts = req.messages[0].content;
  ok(parts[0].type === 'text', 'the instruction comes before the pictures');
  const imgs = parts.filter((p) => p.type === 'image_url');
  ok(imgs.length === 2, 'two images, never three');
  ok(imgs.every((i) => i.image_url.detail === 'high'),
    'BOTH at high detail — `low` downsamples to 512px and the edge of the box IS the question');
  ok(imgs[0].image_url.url.includes('AAA') && imgs[1].image_url.url.includes('BBB'),
    'in letter order');
  ok(!JSON.stringify(req).includes('_letter'), 'and no scratch fields leak onto the wire');
  ok(req.response_format?.type === 'json_object', 'JSON mode');

  const p = parts[0].text;
  ok(p.includes('Bed 1') && p.includes('12.0 x 10.0'), 'the room is named and measured in the prompt');
  ok(/do not agree on how many/i.test(p), 'and a count mismatch is called out rather than left to be noticed');
  ok(!/do not agree on how many/i.test(buildBedFitPrompt({ counts: { a: 1, b: 1 } })),
    '...only when the counts actually differ');
  ok(/pillow/i.test(p), 'it says what a bed looks like in plan');
  ok(/YOU MUST PICK ONE/.test(p) && /Do not answer "both"/.test(p),
    'and forbids the non-answer, which is the reply that would otherwise cost a call for nothing');
  ok(/NOT criteria/.test(p) && /tidier/.test(p),
    'and rules out the things the two pictures share on purpose');
}

console.log('\n-- the letters --');
{
  ok(BED_SOURCES.map((s) => s.letter).join('') === 'AB', 'A is Roboflow, B is GPT');
  ok(BED_SOURCES.every((s) => !('colour' in s)),
    'and neither carries a colour — identical ink is what keeps the comparison about the geometry');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
