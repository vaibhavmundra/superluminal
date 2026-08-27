// ---------------------------------------------------------------------------
// bedFit.js — two detectors answer "where is the bed"; a third model decides
// which of the two answers is on the bed.
//
// WHY THERE IS A JUDGE AT ALL. A bed is the one detection that PUNCHES A HOLE
// IN THE CEILING. Everything else the plan finds is advisory — a sofa is
// noted, a dining table is noted — but a bed becomes a no-light zone, and a
// zone in the wrong place moves real fittings. So this is the one answer worth
// paying a second opinion for.
//
// The two detectors fail in opposite directions, which is exactly what makes
// the pair useful:
//
//   roboflow  a trained detector. When it commits, the box is tight — it is
//             tracing the mattress rectangle it was trained on. It frequently
//             does not commit at all on a line drawing, and when it is wrong it
//             is wrong about WHAT (a sofa boxed as a bed, a whole room boxed as
//             a bed) rather than about where.
//   openai    reads the plan the way a person does and almost always finds the
//             bed. What it cannot do is measure: the box drifts, spills into
//             the wardrobe, or takes in the side tables.
//
// Neither is reliably better, so choosing one up front is choosing which
// failure to accept. Asking is cheaper than choosing.
//
// THE JUDGE NEVER EMITS A COORDINATE. It picks a letter. This is the same rule
// the rest of the app is built on — the model recognises, the code decides —
// taken as far as it goes: a region absorbs the error a point propagates, and a
// CHOICE BETWEEN TWO REGIONS absorbs all of it. Whatever comes back, the
// rectangle that ends up on the plan is a rectangle a detector measured, not
// one the judge described. The worst case is that we use the wrong detector's
// box; there is no case where we use a box nobody drew.
//
// WHAT IT IS SHOWN. Two crops of the SAME room, made by the same roomSnapshot()
// that feeds the accent and task passes, differing in nothing but the
// rectangles drawn on them. Same crop, same wash, same ink, same colour — if
// the two images differed in any other way the model would have something to
// prefer that is not the geometry. See accentMask.js.
//
// WHEN IT IS NOT ASKED, which is most of the time:
//   * neither detector found a bed in this room — nothing to judge
//   * only one did — that answer is taken as it stands (there is no contest,
//     and inventing one by asking "is this really a bed?" is a different
//     question with a different failure mode)
//   * both did and they AGREE — same count, every box pairing above `agreeIou`.
//     Two names for one rectangle is not a disagreement, and asking a model
//     which of two identical boxes it prefers gets a confident answer to a
//     meaningless question.
//
// So the call fires only where the two genuinely differ, which on a normal
// bedroom plan is a minority of rooms.
//
// PURE. The crops are drawn in accentMask.js, the call is made through
// /api/accents, and both of those need a browser. Nothing here does.
// ---------------------------------------------------------------------------

import { extractJson, DEFAULT_MODEL } from './openaiDetect.js';
import { iou, rectCentre } from './furniture.js';
import { pointInPolygon } from './geometry.js';
import { num } from './accentPrompt.js';

export { DEFAULT_MODEL };

/**
 * The two answers, and the letter each is shown under.
 *
 * IDENTICAL COLOURS, on purpose. The obvious thing is to draw Roboflow in one
 * colour and GPT in another, and it is the wrong thing: the two images would
 * then differ in a way that has nothing to do with which box is on the bed, and
 * a preference for red over blue is not a preference we want to collect. The
 * letter is the only thing that distinguishes them, and the letter carries no
 * information about who drew what.
 */
export const BED_SOURCES = [
  { id: 'roboflow', letter: 'A', label: 'Roboflow' },
  { id: 'openai',   letter: 'B', label: 'GPT' },
];

// NOT PART OF THE UI PALETTE, and left red on purpose while everything else in
// this app went black and white. This colour is never shown to a person: it is
// the ink drawn on the two crops sent to the bed judge, and the only property
// that matters is that both images use the SAME one — see BED_SOURCES above. A
// restyle here is a change to a model input, with none of the reasons a restyle
// usually has.
export const BOX_COLOUR = '#DC2626';

export const BEDFIT_DEFAULTS = {
  // Above this, two boxes are the same box. Deliberately loose: the question is
  // "is this a disagreement worth paying to settle", not "are these identical".
  // Two detectors tracing the same mattress land at 0.85-0.95; one that has
  // taken in the bedside tables lands near 0.6, and that IS worth settling.
  agreeIou: 0.80,
  // Below this the judge's own answer is not acted on and the fallback is used.
  // A model that is 30% sure which image is better has told us the two are the
  // same, at which point the deterministic fallback is the better answer
  // because it is at least stable across runs.
  minConfidence: 0.35,
  // Who wins when the judge is not asked, or is asked and hedges. Roboflow,
  // because the case where both committed and neither is clearly better is the
  // case where Roboflow's box is the tighter of the two — that is the whole
  // description of that detector. Not a coin toss and not list order.
  fallback: 'roboflow',
};

// --- splitting one `both` response into two answers -------------------------

/**
 * /api/detect's `both` route returns { result: { roboflow, openai } }, and the
 * ordinary path walks the whole thing at once so that dedupe() collapses two
 * boxes over one bed into one zone. That merge is exactly what has to NOT
 * happen here: the two answers are the two things being compared.
 *
 * `parse` is detectionsToZones, injected rather than imported so this file
 * stays free of the units question and the tests can drive it with a stub.
 */
export function splitByProvider(payload, parse, opts = {}) {
  const root = payload?.result ?? payload ?? {};
  const out = {};
  for (const s of BED_SOURCES) {
    const half = root[s.id];
    out[s.id] = half ? parse(half, opts) : { kept: [], rejected: [] };
  }
  return out;
}

/** Tag each candidate with who found it and give it a stable id. */
export function label(kept, provider) {
  return kept.map((k, i) => ({
    ...k,
    provider,
    id: `det-${provider === 'roboflow' ? 'rf' : 'oa'}-${i}-${Math.round(k.rect.x0)}-${Math.round(k.rect.y0)}`,
  }));
}

/** The candidates standing in this room. A bed belongs to the room it is in. */
export function bedsIn(list, polygonPx) {
  if (!polygonPx?.length) return list;
  return list.filter((d) => pointInPolygon(rectCentre(d.rect), polygonPx));
}

/**
 * Do the two answers amount to the same claim?
 *
 * Same count, and every box on one side pairs with an unused box on the other
 * above the threshold. Greedy pairing by best overlap: with one or two beds in
 * a room the greedy answer and the optimal answer are the same, and the
 * arrangement where they differ needs four beds in one room arranged so that
 * the best pairing is not the greedy one.
 */
export function sameAnswer(a, b, opts = {}) {
  const { agreeIou } = { ...BEDFIT_DEFAULTS, ...opts };
  if (a.length !== b.length) return false;
  if (!a.length) return true;
  const spare = b.slice();
  for (const x of a) {
    let best = -1, at = -1;
    for (let i = 0; i < spare.length; i++) {
      const v = iou(x.rect, spare[i].rect);
      if (v > best) { best = v; at = i; }
    }
    if (best < agreeIou) return false;
    spare.splice(at, 1);
  }
  return true;
}

/**
 * What kind of situation is this room in, and does it need a call?
 *
 * Returns the decision where one can be made without asking, and `ask: true`
 * where it cannot. Four outcomes, and naming them is most of the work — the
 * pipeline reads this rather than re-deriving "did anyone find anything" from
 * two array lengths at three different call sites.
 */
export function contestFor(a, b, opts = {}) {
  const o = { ...BEDFIT_DEFAULTS, ...opts };
  if (!a.length && !b.length) return { kind: 'none', ask: false, winner: [], pick: null, why: 'no bed in this room' };
  if (!a.length) return { kind: 'uncontested', ask: false, winner: b, pick: 'openai', why: 'only GPT found a bed here' };
  if (!b.length) return { kind: 'uncontested', ask: false, winner: a, pick: 'roboflow', why: 'only Roboflow found a bed here' };
  if (sameAnswer(a, b, o)) {
    const pick = o.fallback === 'openai' ? 'openai' : 'roboflow';
    return { kind: 'agreed', ask: false, winner: pick === 'openai' ? b : a, pick,
             why: 'both put the bed in the same place' };
  }
  return { kind: 'contest', ask: true, winner: null, pick: null,
           why: `${a.length} box${a.length === 1 ? '' : 'es'} vs ${b.length}, in different places` };
}

/** The judge's letter -> the list it chose. */
export function applyVerdict(a, b, verdict, opts = {}) {
  const o = { ...BEDFIT_DEFAULTS, ...opts };
  const fb = o.fallback === 'openai' ? 'openai' : 'roboflow';
  const weak = !verdict || !verdict.pick
    || (num(verdict.confidence) ?? 0) < o.minConfidence;
  const pick = weak ? fb : (verdict.pick === 'A' ? 'roboflow' : verdict.pick === 'B' ? 'openai' : verdict.pick);
  const chosen = pick === 'openai' ? b : a;
  return {
    pick, winner: chosen,
    fellBack: weak,
    confidence: weak ? 0 : Math.max(0, Math.min(1, num(verdict.confidence) ?? 0.5)),
    why: weak
      ? (verdict ? 'the judge was not sure enough to move the answer' : 'the judge could not be reached')
      : (verdict.why || ''),
  };
}

// --- the prompt -------------------------------------------------------------

/**
 * A bed as it is DRAWN, not as it is. Lifted verbatim from the furniture pass's
 * own vocabulary, because a judge working from a different description of a bed
 * to the detectors is a third opinion rather than a referee.
 */
export const BED_IN_PLAN =
  'a plain rectangle with pillows drawn as one or two smaller rectangles or ovals '
  + 'along one short edge, often with a turned-down corner or a blanket line across '
  + 'it. The pillow edge is the HEAD, and it is nearly always against a wall. A '
  + 'double bed is normally 5 to 6 ft wide and 6 to 7 ft long; a single is about 3 ft wide.';

export function buildBedFitPrompt({ room = null, counts = null } = {}) {
  const where = room?.name ? ` The room is labelled "${room.name}".` : '';
  const size = room?.widthFt && room?.heightFt
    ? ` It measures about ${room.widthFt.toFixed(1)} x ${room.heightFt.toFixed(1)} ft.` : '';
  const tally = counts
    ? `\nIMAGE A has ${counts.a} rectangle${counts.a === 1 ? '' : 's'} drawn on it.`
      + ` IMAGE B has ${counts.b}.`
      + (counts.a === counts.b ? '' : ' They do not agree on how many beds are in this room, so part of your job is deciding which count is right.')
    : '';

  return `You are looking at TWO PICTURES OF THE SAME ROOM in an architectural floor plan.

They are the same crop of the same drawing. The ONLY difference between them is the RED RECTANGLES drawn on top. Each picture is one detector's answer to "where are the beds in this room". The letter in the top-left corner of each picture identifies it: A or B.${tally}

A BED IN PLAN IS: ${BED_IN_PLAN}${where}${size}

YOUR ONE JOB: say whether A or B is the better answer.

Judge on these, in this order of importance:

1. IS IT ON A BED. A rectangle sitting on a sofa, a wardrobe, a rug, a whole room or empty floor is a wrong answer no matter how neat it looks. This outranks everything below.
2. DID IT FIND ALL OF THEM. If the room clearly contains two beds and one picture boxes both while the other boxes one, the one that found both is better — unless its second rectangle is on something that is not a bed, in which case rule 1 wins.
3. DOES IT FIT. The rectangle should follow the drawn mattress: not cut it in half, not stop short of the foot, not swallow the bedside tables, the wardrobe or the walkway beside it. A box that is roughly right and a little generous beats one that is precise about the wrong object.
4. IS IT SQUARE TO THE BED. A bed drawn along a wall should be boxed along that wall.

NOT criteria: which picture looks tidier, which has fewer rectangles, which colour or line weight you prefer. Both are drawn identically on purpose.

YOU MUST PICK ONE. If they are close, pick the one that fits the mattress better and say so with a low confidence — that is what confidence is for. Do not answer "both", "neither", or "they are the same".

Answer with JSON and nothing else:

{"pick":"A","confidence":0.0-1.0,"why":"one short sentence naming what is wrong with the other one"}`;
}

export function buildBedFitRequest({ plans, room = null, counts = null,
                                     model = DEFAULT_MODEL, maxTokens = 800 } = {}) {
  if (!Array.isArray(plans) || plans.length < 2) {
    throw new Error('The bed-fit judge needs two images.');
  }
  const shot = (p, i) => ({
    type: 'image_url',
    image_url: {
      url: `data:${p.mime || 'image/jpeg'};base64,${p.base64}`,
      // HIGH, and this is not a place to economise. `low` downsamples to 512px,
      // which is enough to see that there is a rectangle and not enough to see
      // whether its edge is on the mattress or 8 inches past it — and that edge
      // is the entire question being asked. The room-type pass learned this the
      // expensive way: every room came back "other".
      detail: 'high',
    },
    // Not sent to the model; kept so a logged request is readable.
    _letter: BED_SOURCES[i]?.letter,
  });
  return {
    model,
    response_format: { type: 'json_object' },
    max_completion_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        // TEXT FIRST, then the images in letter order. The prompt refers to "the
        // first picture" only by the letter burned into its corner, so the order
        // here is belt and braces rather than load-bearing — but a model that
        // reads the instruction before it looks answers the question it was
        // asked more often than one that looks first.
        { type: 'text', text: buildBedFitPrompt({ room, counts }) },
        ...plans.slice(0, 2).map((p, i) => {
          const s = shot(p, i);
          delete s._letter;
          return s;
        }),
      ],
    }],
  };
}

// --- the reply --------------------------------------------------------------

/**
 * A letter, a confidence and a sentence. Anything else is a non-answer, and a
 * non-answer is reported as one rather than being coerced into a pick — the
 * caller has a deterministic fallback and needs to know to use it.
 */
export function bedFitFromReply(text) {
  const obj = extractJson(text);
  const raw = String(obj?.pick ?? obj?.choice ?? obj?.answer ?? obj?.better ?? '').trim();
  // "A", "a", "Image A", "picture B", "B is better".
  const m = raw.match(/\b([AB])\b/i) || raw.match(/^([AB])/i);
  const pick = m ? m[1].toUpperCase() : null;
  return {
    pick,
    matched: !!pick,
    // A confidence attached to an answer we could not read is a number about
    // nothing. Zeroed, so the caller's floor rejects it without a special case.
    confidence: pick ? Math.max(0, Math.min(1, num(obj?.confidence) ?? 0.6)) : 0,
    why: typeof obj?.why === 'string' ? obj.why.slice(0, 200)
      : typeof obj?.reason === 'string' ? obj.reason.slice(0, 200) : '',
  };
}
