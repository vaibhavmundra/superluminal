// ---------------------------------------------------------------------------
// taskSurfaces.js — where in this room does somebody actually DO something?
//
// Ambient light covers a ceiling evenly; accent light picks out a surface for
// the look of it. A TASK surface is neither: it is a horizontal plane where
// something happens — eating, meeting, writing, putting a cup down — and it
// wants its own light at its own level. That is the third layer of any real
// scheme and it is the one that has to be aimed at something specific.
//
// THIS PASS ONLY FINDS THEM. Nothing is placed and nothing is recommended; the
// boxes go on the drawing and what to do about them is the next decision.
//
// THE SAME SHAPE OF QUESTION as the furniture pass, in a different vocabulary,
// so it borrows that file's parser wholesale rather than growing a second one.
// The units question — fractions, percent or pixels? — is the one that costs a
// day when two parsers quietly disagree about it, and there is now exactly one
// place it is answered.
//
// PURE. No fetch, no browser.
// ---------------------------------------------------------------------------

import { extractJson, DEFAULT_MODEL } from './openaiDetect.js';
import { itemList, rectFromEntry, toPixels, describe, num } from './accentPrompt.js';

export { DEFAULT_MODEL };

/**
 * The vocabulary, and what each one looks like from above.
 *
 * `plan` is the part that does the work — the same lesson as the furniture
 * pass. A model asked for "a conference table" on a line drawing has to guess
 * what one looks like in plan; told it is a long table ringed by eight or more
 * chair blocks in a room off a corridor, it has something to match.
 *
 * `context` is the qualifier the user actually cares about and the reason these
 * four are not just "tables". A coffee table is only a coffee table because
 * there is a sofa beside it; the same rectangle alone in a corridor is a
 * console. Asking for the relationship rather than the object is what keeps a
 * side table out of the dining category.
 */
export const SURFACE_TYPES = [
  { id: 'coffee_table', label: 'Coffee table', colour: '#0EA5E9',
    context: 'must be the low table OUT IN FRONT of a sofa. A side or end table beside the sofa arm is NOT one',
    plan: 'a rectangle, oval or circle sitting in the open floor a couple of feet IN FRONT of a sofa, facing its long side, and roughly half to two-thirds the sofa\'s length. Its size is the tell: a coffee table is a piece of furniture you could put a tray on, several times the area of a side table.' },
  { id: 'dining_table', label: 'Dining table', colour: '#F59E0B',
    context: 'in a dining area or the dining end of a living room',
    plan: 'a rectangle, oval or circle ringed by four to eight chair blocks, drawn as small squares or curved shapes evenly spaced around its edge. The chairs are the giveaway.' },
  { id: 'conference_table', label: 'Conference table', colour: '#8B5CF6',
    context: 'in an office — a meeting or board room, usually a room of its own',
    plan: 'like a dining table but longer and with more chairs — eight or more — in a room that is clearly not a home. Often the only thing in its room.' },
  { id: 'executive_desk', label: 'Executive desk', colour: '#10B981',
    context: 'in a private office or cabin',
    plan: 'an L or a rectangle against or near one wall with a single chair on one side and often two visitor chairs opposite. One person sits at it, which is what separates it from a conference table.' },
];

export const SURFACE_IDS = SURFACE_TYPES.map((t) => t.id);
export const SURFACE_BY_ID = Object.fromEntries(SURFACE_TYPES.map((t) => [t.id, t]));

/** More than this in one room and it is not reading a room. */
export const MAX_SURFACES = 8;

// --- the prompt -------------------------------------------------------------

export function buildSurfacePrompt({ room = null } = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const wFt = n(room?.widthFt), hFt = n(room?.heightFt), aFt = n(room?.areaSqft);

  const roomLine = typeof room?.name === 'string' && room.name.trim()
    ? `\nThe room is labelled "${room.name.trim().slice(0, 60)}" on the drawing.` : '';
  const sizeLine = wFt && hFt
    ? `\nIt measures roughly ${wFt.toFixed(1)} ft by ${hFt.toFixed(1)} ft (${Math.round(aFt || 0)} sq ft), which should help you judge what a rectangle of a given size can be.` : '';

  const catalogue = SURFACE_TYPES
    .map((t) => `  ${t.id}\n      ${t.plan}\n      Only if: ${t.context}.`).join('\n\n');

  return `You are looking at an architectural floor plan — a line drawing seen
from above, not a photograph. ONE room is in focus: it is in the middle of the
frame at full contrast, and the rest of the sheet around it has been faded back
so you can see it is a plan without being distracted by the other rooms. The
thin green line is the room's boundary. Work only inside it.${roomLine}${sizeLine}

YOUR JOB IS TO FIND THE TASK SURFACES. A task surface is a horizontal plane
somebody actually does something at — eats, meets, works, sets a cup down. It is
not seating, not storage and not a bed.

Find every one of these that is inside this room:

${catalogue}

The "Only if" line matters as much as the shape. A rectangle is only a coffee
table because there is a sofa beside it; the same rectangle alone in a corridor
is a console and is not yours. Check the relationship before you call it.

NOT A TASK SURFACE, however table-like it looks:

  END AND SIDE TABLES. A small square, circle or rectangle tucked against the
  END of a sofa, or between two chairs, or beside a bed. These are the most
  common thing to get wrong here, because they are small tables next to
  seating and that sounds like the coffee-table rule. It is not: a coffee
  table sits OUT IN FRONT of the sofa's long side and is several times the
  area. A pair of matching small shapes flanking a sofa's two arms is a pair
  of end tables — that symmetry is the giveaway — and neither of them is
  yours.

  Also not yours: the small grey circles (ceiling lights already laid out),
  beds, sofas, wardrobes, chairs on their own, kitchen counters and islands,
  reception counters, WCs, basins, and anything else not on the list above.

HOW TO ANSWER

Give each surface a bounding box as FRACTIONS of the image, between 0 and 1,
where 0,0 is the top-left corner and 1,1 is the bottom-right. Answer in
fractions, not pixels — you do not need to work out any real-world size or
count any pixels. Just the four edges.

BOX THE SURFACE ITSELF, not the chairs around it. The table top is what will be
lit; the chairs are how you recognised it. A box drawn round the whole
arrangement is a box round the wrong thing.

THERE CAN BE MORE THAN ONE, and each one gets its own light downstream, so
splitting them matters. A living-dining room has a coffee table AND a dining
table; a large office can have several desks. Return each separately rather than
one box covering the group. But two end tables are not two coffee tables — see
above.

BE WILLING TO ANSWER. A moderate confidence on a real reading is far more useful
than silence — the number is carried through and shown to the person using this,
who can throw it out in one click. What you must NOT do is promote something
into a category to fill it out: an end table is not a coffee table, a bedside
table is not a coffee table, a kitchen island is not a dining table, a reception
counter is not a desk. Wrong is worse
than unsure; unsure is much better than nothing.

If the room has none of these in it — a bedroom, a bathroom, a corridor, a
store — return an empty list. That is a correct and common answer.

Return ONLY a JSON object. No prose, no markdown fence, no explanation.

{"room":"<what this room is, in a word or two>",
 "surfaces":[{"type":"dining_table","x0":0.00,"y0":0.00,"x1":0.00,"y1":0.00,
              "confidence":0.0,"note":"<how you recognised it, one short phrase>"}],
 "notes":"<anything you saw but could not place, or an empty string>"}`;
}

export function buildSurfaceRequest({ plan, room = null,
                                      model = DEFAULT_MODEL, maxTokens = 2000 } = {}) {
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
        { type: 'text', text: buildSurfacePrompt({ room }) },
      ],
    }],
  };
}

// --- the reply --------------------------------------------------------------

/**
 * The word the model used -> one of ours, or null.
 *
 * Generous in, strict out, same as the furniture pass. `conference` is checked
 * before `table` and `desk` because "conference table" and "boardroom desk"
 * both contain a word that would otherwise file them somewhere else, and
 * `coffee` before `table` for the same reason.
 */
export function normaliseSurface(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (SURFACE_IDS.includes(s.replace(/\s+/g, '_'))) return s.replace(/\s+/g, '_');
  if (/\b(coffee|centre|center|cocktail)\b/.test(s)) return 'coffee_table';
  if (/\b(conference|boardroom|board room|meeting)\b/.test(s)) return 'conference_table';
  if (/\b(executive|manager|md|director|cabin)\b/.test(s) || /\bdesk\b/.test(s)) return 'executive_desk';
  if (/\b(dining|dinner|breakfast|table)\b/.test(s)) return 'dining_table';
  return null;
}

/**
 * The reply -> surfaces in the pixel space of the image as sent.
 *
 * Nothing here knows about the plan's own pixels. The image was a crop of one
 * room, and mapping back out of it is the crop's business — accentMask.js.
 */
export function surfacesFromReply(text, { w = 1000, h = 1000 } = {}) {
  const obj = extractJson(text);
  const list = itemList(obj);
  const surfaces = [];
  const skipped = [];

  for (const z of list) {
    if (surfaces.length >= MAX_SURFACES) {
      skipped.push({ raw: describe(z), reason: `over the ${MAX_SURFACES}-surface cap` });
      continue;
    }
    const type = normaliseSurface(z?.type ?? z?.class ?? z?.label ?? z?.kind);
    if (!type) {
      skipped.push({ raw: describe(z), reason: `"${z?.type ?? '?'}" is not a task surface this pass reads` });
      continue;
    }
    const r0 = rectFromEntry(z);
    if (!r0) { skipped.push({ raw: describe(z), reason: 'no readable box in this entry' }); continue; }
    const r = toPixels(r0, w, h);
    if (!(r.x1 - r.x0 > 0 && r.y1 - r.y0 > 0)) {
      skipped.push({ raw: describe(z), reason: 'zero-area box' });
      continue;
    }
    surfaces.push({
      type,
      rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
      note: typeof z.note === 'string' ? z.note.slice(0, 160) : '',
      confidence: Math.max(0, Math.min(1, num(z.confidence) ?? 0.7)),
      unit: r.unit,
    });
  }

  return {
    image: { width: w, height: h },
    room: typeof obj?.room === 'string' ? obj.room.slice(0, 60) : null,
    notes: typeof obj?.notes === 'string' ? obj.notes.slice(0, 400) : '',
    surfaces,
    skipped,
  };
}
