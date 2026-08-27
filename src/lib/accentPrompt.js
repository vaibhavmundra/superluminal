// ---------------------------------------------------------------------------
// accentPrompt.js — asking a vision model what FURNITURE is in the room.
//
// Note what it is not asked. It is not asked where the lights go.
//
// THE MISTAKE THIS FILE IS THE FIX FOR, written down because it was expensive
// and because it is the obvious thing to do again. The first version asked the
// model to do three jobs in one call: identify the furniture, apply five house
// rules to it, and lay out the fixtures as boxes. Then, to stop it inventing
// work, the prompt said "where none of the rules applies, recommend NOTHING"
// and "an empty list is a valid and often correct answer".
//
// Those two sentences are a licence to bail out of all three jobs at once, and
// on a hard drawing the model took it. Rooms that had produced a scheme
// happily came back empty. The suppression was not the root cause though — it
// was the escape hatch that made the root cause silent. The root cause is that
// "identify a wardrobe on a line drawing" is genuinely hard, and a model that
// is unsure whether the rectangle is a wardrobe cannot half-apply rule 5. It
// has one bit to give and it gave zero.
//
// So the jobs are separated. THE MODEL RECOGNISES; THE CODE DECIDES. This file
// asks one question — what furniture is in this room and where — which is the
// question the bed detector next door already answers well, and phrased the
// same way. accentPlace.js then applies the five rules to the answer, in code,
// deterministically, every time. A wardrobe found is a strip, always, with no
// opportunity for taste.
//
// What that buys, beyond it working:
//   - the rules are now testable without a network
//   - "nothing came back" is diagnosable: the furniture list is on screen, so
//     you can see whether it found no wardrobe or found one and did nothing
//   - a sconce beside a bed is placed from the BED'S OWN GEOMETRY, at either
//     end of it, rather than from a box the model drew by eye
//
// THE TWO FIXTURES this eventually produces are a wall sconce and an LED
// strip. Both are placed by accentPlace.js and neither is mentioned to the
// model at all.
//
// PURE. No fetch, no browser. api/accents.js imports it, so the prompt that
// ships is the prompt that is read here.
// ---------------------------------------------------------------------------

import { extractJson, DEFAULT_MODEL } from './openaiDetect.js';

export { DEFAULT_MODEL };

export const ACCENT_TYPES = [
  // The same indigo the ambient downlights use (C.small in PlanCanvas). A
  // sconce IS a light, and on a lighting drawing the colour should say what a
  // thing is rather than which pass placed it — the shape already says that.
  { id: 'sconce', label: 'Wall sconce', short: 'sconce', role: 'fixture',
    mounts: 'wall',   colour: '#6366F1' },
  { id: 'strip',  label: 'LED strip',   short: 'strip',  role: 'target',
    mounts: 'object', colour: '#DC2626' },
];

export const ACCENT_IDS = ACCENT_TYPES.map((t) => t.id);
export const ROLE_BY_TYPE = Object.fromEntries(ACCENT_TYPES.map((t) => [t.id, t.role]));
export const TYPE_BY_ID = Object.fromEntries(ACCENT_TYPES.map((t) => [t.id, t]));

/**
 * WHAT THE MODEL IS ASKED FOR — and the whole of what it is asked for.
 *
 * `plan` is how the thing reads in an architectural drawing, and it is the part
 * that does the work. A model asked for "a wardrobe" on a line drawing has to
 * guess what a wardrobe looks like from above; told it is a long shallow
 * rectangle against a wall, often with a diagonal or a line of hanging rail
 * drawn in, it has something to match. openaiDetect.js's WHAT_IS_A_BED is the
 * same idea and the reason that detector works at all.
 */
export const FURNITURE_TYPES = [
  { id: 'bed', label: 'Bed', colour: '#7C3AED',
    plan: 'a plain rectangle with pillows drawn as one or two smaller rectangles or ovals along one short edge, often with a turned-down corner or a blanket line across it. The pillow edge is the HEAD, and it is nearly always against a wall.' },
  { id: 'wardrobe', label: 'Wardrobe', colour: '#DC2626',
    plan: 'a long, shallow rectangle flat against a wall — much wider than it is deep — often subdivided into shutter bays, sometimes with a diagonal line or an arc showing a door swing, or a thin line inside it for the hanging rail. Usually in a bedroom, sometimes in a dressing area.' },
  { id: 'tv_unit', label: 'TV unit', colour: '#EA580C',
    plan: 'a shallow rectangle against a wall, like a wardrobe but slimmer and shorter, usually DIRECTLY OPPOSITE a bed or a sofa. Often drawn with a thin rectangle on the wall behind it for the screen itself.' },
  { id: 'basin', label: 'Basin / vanity', colour: '#0891B2',
    plan: 'in a bathroom: a counter rectangle against a wall with an oval or a rounded square drawn inside it for the bowl, and often a tap mark on the wall side. The WC and the shower tray are not this.' },
  { id: 'sofa', label: 'Sofa', colour: '#6B7280',
    plan: 'a rectangle with a thicker band along one long edge for the back and smaller blocks at the ends for the arms, usually facing a TV or a coffee table. It is not a bed: no pillows along a short edge.' },
];

export const FURNITURE_IDS = FURNITURE_TYPES.map((f) => f.id);
export const FURNITURE_BY_ID = Object.fromEntries(FURNITURE_TYPES.map((f) => [f.id, f]));

/** How many pieces of furniture is more than a room has. */
/** How many moves is too many. Stated to the model AND enforced in the parser. */
export const MAX_ITEMS = 12;

/** Kept for the placement pass, which still caps what it emits. */
export const MAX_ZONES = 10;

// --- the prompt -------------------------------------------------------------

export function buildAccentPrompt({ room = null, ceilingFt = null } = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const wFt = n(room?.widthFt), hFt = n(room?.heightFt), aFt = n(room?.areaSqft);

  const roomLine = typeof room?.name === 'string' && room.name.trim()
    ? `\nThe room is labelled "${room.name.trim().slice(0, 60)}" on the drawing.` : '';
  const sizeLine = wFt && hFt
    ? `\nIt measures roughly ${wFt.toFixed(1)} ft by ${hFt.toFixed(1)} ft (${Math.round(aFt || 0)} sq ft), which should help you judge what a rectangle of a given size can be.` : '';

  const catalogue = FURNITURE_TYPES
    .map((f) => `  ${f.id}\n      ${f.plan}`).join('\n\n');

  return `You are looking at an architectural floor plan — a line drawing seen
from above, not a photograph. ONE room is in focus: it is in the middle of the
frame at full contrast, and the rest of the sheet around it has been faded back
so you can see it is a plan without being distracted by the other rooms. The
thin green line is the room's boundary. Work only inside it.${roomLine}${sizeLine}

YOUR JOB IS TO IDENTIFY THE FURNITURE. Nothing else. Do not think about
lighting, do not recommend fittings, do not suggest anything — other software
takes your answer and works the lighting out from it. You are the eyes.

Find every one of these that is inside this room:

${catalogue}

The small grey circles are ceiling lights already laid out. They are not
furniture. Ignore them, and ignore doors, windows, WCs, showers, dining tables,
chairs, rugs, plants and anything else not on the list above.

HOW TO ANSWER

Give each piece a bounding box as FRACTIONS of the image, between 0 and 1,
where 0,0 is the top-left corner and 1,1 is the bottom-right. Answer in
fractions, not pixels — you do not need to work out any real-world size or
count any pixels. Just the four edges.

BOX THE WHOLE PIECE, all four sides of it. Downstream the box's own extent is
used to work out how long a fitting runs and where either end of it falls, so a
box that clips half the wardrobe produces a fitting half the length of the
wardrobe. Err generous rather than tight — a box slightly too big is fine, a box
that stops short is not.

BE WILLING TO ANSWER. If a rectangle against a bedroom wall is long, shallow and
about the size of a wardrobe, it is a wardrobe — say so with a confidence that
reflects how sure you are. A moderate confidence on a real reading is far more
useful than silence: the confidence is carried through and shown to the person
using this, who can throw it out in one click. What you must NOT do is promote
something into a category to fill it out — a dining table is not a TV unit, a
daybed is not a bed. Wrong is worse than unsure; unsure is much better than
nothing.

If the room genuinely has none of these in it — an empty room, a corridor, a
utility — return an empty list. That is a correct answer too.

Return ONLY a JSON object. No prose, no markdown fence, no explanation.

{"room":"<what this room is, in a word or two>",
 "furniture":[{"type":"bed","x0":0.00,"y0":0.00,"x1":0.00,"y1":0.00,"confidence":0.0,
               "note":"<how you recognised it, one short phrase>"}],
 "notes":"<anything you saw but could not place, or an empty string>"}`;
}

// --- the request ------------------------------------------------------------

export function buildAccentRequest({ plan, room = null, ceilingFt = null,
                                     model = DEFAULT_MODEL, maxTokens = 3000 } = {}) {
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
        { type: 'text', text: buildAccentPrompt({ room, ceilingFt }) },
      ],
    }],
  };
}

// --- the reply --------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v
  : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null));

/** Whichever key it used for the list. Told "furniture"; forgiving of the rest.
 *  'beds' is in here because extractJson() — shared with the bed route —
 *  normalises a bare top-level array to { beds: [...] }, so without it a reply
 *  that is just an array parses to nothing and reports nothing dropped. */
function itemList(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object') return [];
  for (const k of ['furniture', 'items', 'objects', 'predictions', 'detections', 'zones', 'beds']) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  return [];
}

/**
 * One entry -> a corner rect in the pixel space of the image AS SENT.
 *
 * The prompt asks for flat x0/y0/x1/y1, like the bed route does. Everything
 * below that is a shape a model produces when it ignores the ask.
 *
 * ARRAY FORMS ARE AMBIGUOUS and are resolved BY NAME, never by inspection:
 * [0.1, 0.2, 0.3, 0.4] cannot be told apart as corners or as top-left+size.
 *
 * WHERE THIS DIFFERS FROM openaiDetect.js, and why that is not a drift: there,
 * `box` and `bbox` are read as top-left+size, which is right THERE because that
 * prompt never asks for a field called `box` — it asks for flat x0/y0/x1/y1 —
 * so an array under `box` is an unprompted COCO-ism and COCO means xywh. HERE
 * the prompt names the field `box` and spells its contents out as x0/y0/x1/y1,
 * so an array under it is that object flattened, in that order, and reading it
 * as xywh would shrink every zone. `bbox` and `xywh` are names this prompt
 * never uses either way, so they follow the sibling exactly.
 */
export function rectFromEntry(z) {
  if (!z || typeof z !== 'object') return null;
  const b = z.box && typeof z.box === 'object' && !Array.isArray(z.box) ? z.box : z;

  const x0 = num(b.x0), y0 = num(b.y0), x1 = num(b.x1), y1 = num(b.y1);
  if (x0 != null && y0 != null && x1 != null && y1 != null) {
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }

  const four = (v) => Array.isArray(v) && v.length === 4 && v.every((n) => num(n) != null);
  const corners = [z.box, b.box, b.xyxy, b.corners].find((v) => four(v));
  if (corners) {
    const [a, c, d, e] = corners.map(num);
    return { x0: Math.min(a, d), y0: Math.min(c, e), x1: Math.max(a, d), y1: Math.max(c, e) };
  }
  const xywh = [b.bbox, b.xywh].find((v) => four(v));
  if (xywh) {
    const [a, c, d, e] = xywh.map(num);
    return { x0: a, y0: c, x1: a + d, y1: c + e };
  }

  const cx = num(b.x), cy = num(b.y), bw = num(b.width ?? b.w), bh = num(b.height ?? b.h);
  if (cx != null && cy != null && bw != null && bh != null) {
    return { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
  }
  return null;
}

/**
 * Fractions, percent or pixels -> pixels of the image as sent.
 *
 * The tolerant band and the clamp are not politeness. A strip box flush against
 * the left wall comes back as x0 = -0.01; a strict `every value in [0,1]` test
 * would reinterpret the whole box as PIXELS and produce a 0.4px-wide zone that
 * the area floor throws away. The zone vanishes and the UI blames the model.
 */
function toPixels(r, w, h) {
  const hi = Math.max(...[r.x0, r.y0, r.x1, r.y1].map(Math.abs));
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  if (hi <= 1.05) {
    return { x0: clamp01(r.x0) * w, y0: clamp01(r.y0) * h,
             x1: clamp01(r.x1) * w, y1: clamp01(r.y1) * h, unit: 'fraction' };
  }
  if (hi <= 100.5) {
    return { x0: clamp01(r.x0 / 100) * w, y0: clamp01(r.y0 / 100) * h,
             x1: clamp01(r.x1 / 100) * w, y1: clamp01(r.y1 / 100) * h, unit: 'percent' };
  }
  return { x0: Math.max(0, Math.min(w, r.x0)), y0: Math.max(0, Math.min(h, r.y0)),
           x1: Math.max(0, Math.min(w, r.x1)), y1: Math.max(0, Math.min(h, r.y1)), unit: 'pixel' };
}

/** A rejected entry as a STRING. Never as an object — see openaiDetect.js. */
const describe = (v) => {
  try { return JSON.stringify(v).slice(0, 200); } catch { return String(v).slice(0, 200); }
};

/**
 * The reply -> FURNITURE in the pixel space of the image as sent.
 *
 * Nothing here knows about the plan's own pixels, let alone feet, and nothing
 * here knows what a sconce is. The image that went over the wire was a crop of
 * one room, and mapping back out of it is the crop's business (accentMask.js);
 * turning a wardrobe into a strip is the rules' business (accentPlace.js).
 * Keeping both out of here is what lets this be tested with a string.
 */
export function furnitureFromReply(text, { w = 1000, h = 1000 } = {}) {
  const obj = extractJson(text);
  const list = itemList(obj);
  const furniture = [];
  const skipped = [];

  for (const z of list) {
    if (furniture.length >= MAX_ITEMS) {
      skipped.push({ raw: describe(z), reason: `over the ${MAX_ITEMS}-item cap` });
      continue;
    }

    // Synonyms are normalised rather than refused. "TV console" and "media
    // unit" are the same rectangle as "tv_unit", and throwing one away over a
    // word is a piece of furniture lost to vocabulary rather than to sight.
    const raw = String(z?.type ?? z?.class ?? z?.label ?? z?.kind ?? '')
      .trim().toLowerCase().replace(/[\s-]+/g, '_');
    const type = normaliseType(raw);
    if (!type) {
      skipped.push({ raw: describe(z), reason: `"${raw || '?'}" is not furniture this pass reads` });
      continue;
    }

    const r0 = rectFromEntry(z);
    if (!r0) { skipped.push({ raw: describe(z), reason: 'no readable box in this entry' }); continue; }

    const r = toPixels(r0, w, h);
    if (!(r.x1 - r.x0 > 0 && r.y1 - r.y0 > 0)) {
      skipped.push({ raw: describe(z), reason: 'zero-area box' });
      continue;
    }

    furniture.push({
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
    furniture,
    skipped,
  };
}

/**
 * The word the model used -> one of ours, or null.
 *
 * Deliberately generous on the way in and strict on the way out. A model that
 * writes "double bed", "wardrobe/closet" or "TV console" has SEEN the thing;
 * the only question is what to file it under, and filing is not something to
 * lose a detection over. `sofa` is checked before `bed` because "sofa bed"
 * contains both and is a sofa.
 */
export function normaliseType(raw) {
  if (!raw) return null;
  if (FURNITURE_IDS.includes(raw)) return raw;
  const s = raw.replace(/_/g, ' ');
  if (/\b(sofa|couch|settee|loveseat|sectional)\b/.test(s)) return 'sofa';
  if (/\b(bed|mattress)\b/.test(s) && !/\b(bedside|side table|bed side)\b/.test(s)) return 'bed';
  if (/\b(wardrobe|closet|almirah|armoire|cupboard|dresser)\b/.test(s)) return 'wardrobe';
  if (/\b(tv|television|media|entertainment)\b/.test(s)) return 'tv_unit';
  if (/\b(basin|vanity|washbasin|sink|lavatory counter|counter)\b/.test(s)) return 'basin';
  return null;
}

