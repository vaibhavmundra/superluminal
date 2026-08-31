// ---------------------------------------------------------------------------
// tvDetect.js — is there a television on the wall opposite the bed?
//
// A NARROW QUESTION, ON PURPOSE, and it exists because the broad one already
// has an answer. The furniture pass (accentPrompt.js) reads a `tv_unit` — the
// console the screen stands on — and rule 4 turns that into a strip. When it
// finds one, this file is never called: the electrical pass takes the strip's
// own wall and puts a board past the end of it.
//
// This is the fallback for the case that is genuinely common on a bedroom plan:
// the console is not drawn, or is drawn as an unlabelled sliver, and the only
// evidence for a television is the empty stretch of wall the bed is pointed at.
// A pass that has to find five kinds of furniture cannot afford to commit on
// that. A pass with one question and the bed already located can.
//
// SO THE BED IS THE PREMISE, not another thing to find. "Opposite the bed" is
// what makes a 200mm-deep rectangle a TV rather than a shelf, a radiator or a
// dressing table, and it is the whole reason this is not just one more entry in
// the furniture vocabulary.
//
// ONE ANSWER OR NONE. There is no plausible bedroom with two televisions facing
// one bed, and a pass that can return a list will eventually return a list.
//
// The parser is the furniture pass's, borrowed whole, so the units question —
// fractions, percent or pixels? — keeps having exactly one answer in this
// codebase. See accentPrompt.js's toPixels.
//
// PURE. No fetch, no browser.
// ---------------------------------------------------------------------------

import { extractJson, DEFAULT_MODEL } from './openaiDetect.js';
import { itemList, rectFromEntry, toPixels, describe, num } from './accentPrompt.js';

/** Same reasoning as taskSurfaces.js's cap: a ceiling, not a spend. */
const MAX_OUT = 8000;

export { DEFAULT_MODEL };

export const TV_TYPE = {
  id: 'tv', label: 'TV', colour: '#5C5C5C',
  plan: 'a long, very shallow rectangle drawn flat against a wall — much wider'
    + ' than it is deep, often only a line thickness or two of depth, and often'
    + ' the only thing on that stretch of wall.',
};

// --- the prompt -------------------------------------------------------------

export function buildTvPrompt({ room = null } = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const wFt = n(room?.widthFt), hFt = n(room?.heightFt), aFt = n(room?.areaSqft);

  const roomLine = typeof room?.name === 'string' && room.name.trim()
    ? `\nThe room is labelled "${room.name.trim().slice(0, 60)}" on the drawing.` : '';
  const sizeLine = wFt && hFt
    ? `\nIt measures roughly ${wFt.toFixed(1)} ft by ${hFt.toFixed(1)} ft (${Math.round(aFt || 0)} sq ft).` : '';

  return `You are looking at an architectural floor plan — a line drawing seen
from above, not a photograph. ONE room is in focus: it is in the middle of the
frame at full contrast, and the rest of the sheet around it has been faded back
so you can see it is a plan without being distracted by the other rooms. The
thin green line is the room's boundary. Work only inside it.${roomLine}${sizeLine}

THIS IS A BEDROOM AND THE BED IS YOUR STARTING POINT. In plan a bed is a plain
rectangle with pillows drawn as one or two smaller rectangles or ovals along one
short edge, often with a turned-down corner or a blanket line across it. The
pillow edge is the HEAD, and it is against a wall. The FOOT is the opposite
short edge, and the wall the foot points at is the wall a television goes on.

ONE QUESTION: is there a television on that wall?

What one looks like: ${TV_TYPE.plan}

It may be drawn on its own, or as a thin rectangle on the wall behind a slightly
deeper one — a console or TV unit — in which case the shallow one against the
wall is the screen and that is the one you want. The screen is roughly a third
to a half of that wall's length, and centred on it or on the bed.

NOT A TELEVISION, however similar:

  Anything on the wall the HEAD of the bed is against, or on either of the two
  side walls. A television faces the bed; a shelf behind the pillows does not.

  A wardrobe, which is drawn deep — two feet or more — with its doors or a
  diagonal hatch across it, and is usually as long as the wall.

  A dressing table or study table, which has a chair block at it.

  A window or a door, which break the wall line rather than sitting on it.

  The small grey circles, which are ceiling lights already laid out.

BE HONEST ABOUT NOT SEEING ONE. Plenty of bedrooms are drawn without a
television, and an empty wall opposite a bed is an empty wall. Returning null is
a correct and common answer, and it is much better than boxing a wardrobe to
have something to say. What is downstream of this is a socket and a switch on a
wall, so a confident wrong answer puts real fittings in the wrong place.

HOW TO ANSWER

Give the television a bounding box as FRACTIONS of the image, between 0 and 1,
where 0,0 is the top-left corner and 1,1 is the bottom-right. Answer in
fractions, not pixels — you do not need to work out any real-world size or count
any pixels. Just the four edges.

BOX THE SCREEN, TIGHTLY, and along the wall. The box's LENGTH is what will be
used to work out where the switchboard goes, so a box drawn round the screen and
the console and the gap between them puts the board in the wrong place. If only
the console is drawn, box the console.

Return ONLY a JSON object. No prose, no markdown fence, no explanation. Use null
for "tv" if there is no television on the wall the bed faces.

{"room":"<what this room is, in a word or two>",
 "tv":{"x0":0.00,"y0":0.00,"x1":0.00,"y1":0.00,"confidence":0.0,
       "note":"<how you recognised it, and which wall it is on, one short phrase>"},
 "notes":"<anything you saw but could not place, or an empty string>"}`;
}

export function buildTvRequest({ plan, room = null,
                                 model = DEFAULT_MODEL, maxTokens = MAX_OUT } = {}) {
  if (!plan?.base64) throw new Error('No plan image to look at.');
  return {
    model,
    response_format: { type: 'json_object' },
    max_completion_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url',
          image_url: { url: `data:${plan.mime || 'image/jpeg'};base64,${plan.base64}`, detail: 'high' } },
        { type: 'text', text: buildTvPrompt({ room }) },
      ],
    }],
  };
}

// --- the reply --------------------------------------------------------------

/**
 * The one entry, whatever shape it arrived in.
 *
 * The prompt asks for a single object under `tv`, and a model that has been
 * asked for lists all day will sometimes send one anyway. Both are read; the
 * list is truncated to its first readable entry rather than merged, because two
 * televisions facing one bed is a misreading and not a room.
 */
export function tvEntry(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const v = obj.tv ?? obj.television ?? obj.screen ?? null;
  if (Array.isArray(v)) return v.find((x) => x && typeof x === 'object') ?? null;
  if (v && typeof v === 'object') return v;
  if (v != null) return null;
  return itemList(obj).find((x) => x && typeof x === 'object') ?? null;
}

export function tvFromReply(text, { w = 1000, h = 1000 } = {}) {
  const obj = extractJson(text);
  const base = {
    image: { width: w, height: h },
    room: typeof obj?.room === 'string' ? obj.room.slice(0, 60) : null,
    notes: typeof obj?.notes === 'string' ? obj.notes.slice(0, 400) : '',
    tv: null,
    skipped: [],
  };

  const z = tvEntry(obj);
  // No entry at all is the answer "there is no television", which is a real
  // answer and not a dropped one. Nothing is skipped and nothing is reported.
  if (!z) return base;

  const r0 = rectFromEntry(z);
  if (!r0) {
    return { ...base, skipped: [{ raw: describe(z), reason: 'no readable box in this entry' }] };
  }
  const r = toPixels(r0, w, h);
  if (!(r.x1 - r.x0 > 0 && r.y1 - r.y0 > 0)) {
    return { ...base, skipped: [{ raw: describe(z), reason: 'zero-area box' }] };
  }
  return {
    ...base,
    tv: {
      type: 'tv',
      rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
      note: typeof z.note === 'string' ? z.note.slice(0, 160) : '',
      confidence: Math.max(0, Math.min(1, num(z.confidence) ?? 0.7)),
      unit: r.unit,
    },
  };
}
