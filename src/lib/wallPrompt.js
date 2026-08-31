// ---------------------------------------------------------------------------
// wallPrompt.js — THE RENDER PASS. Both prompts live in this file.
//
// ===========================================================================
//  IF YOU CAME HERE TO EDIT A PROMPT, IT IS ONE OF THESE TWO AND NOTHING ELSE:
//
//    PROMPT 01 -> `RENDER_PROMPT_01`   (further down, a plain string)
//    PROMPT 02 -> `gridPrompt02()`     (a template — the {braces} are filled in)
//
//  Nothing else in the app writes prompt text for this pass. api/accents.js
//  imports these two, so what ships is byte-for-byte what is read here.
// ===========================================================================
//
// WHAT THIS PASS IS FOR. A floor plan says where the furniture is. It does not
// say that there is a 5ft run of fluted panelling behind the bed, or three
// paintings over the console — those are on the WALLS, and a wall is a line in
// plan view. So this pass reads PHOTOGRAPHS (renders, views) of a space that
// the plan cannot answer for, and then puts what it found back onto the plan.
//
// TWO CALLS, AND THEY ARE DELIBERATELY NOT ONE.
//
//   01. The renders -> a list of wall-mounted things, described in ENGLISH.
//       "type / wall / location / dimension". No coordinates are asked for at
//       all, because a photograph has no coordinate system this app shares.
//       This is a RECOGNITION task and models are good at it.
//
//   02. The list + a gridded floor plan -> cell references.
//       This is the LOCALISATION task, and it is asked separately, of a
//       different image, with the answer to 01 pasted in as text. The grid is
//       there so the answer can only be wrong by whole feet: quantisation as
//       error control, the same argument as openaiDetect.js's `gridCells` arm,
//       except that here it wins because the thing being located is a run
//       along a wall rather than a box in the middle of a room.
//
// WHY SPLITTING THEM MATTERS, and it is the same lesson as accentPrompt.js's
// header: a model asked to recognise AND to measure in one breath does neither
// well, and when it fails you cannot tell which half failed. Split, an empty
// answer is diagnosable — the panel shows the English list from 01, so "it saw
// no panelling" and "it saw panelling and could not place it" are two different
// screens rather than one silence.
//
// PURE. No fetch, no canvas, no DOM. api/accents.js imports it server-side and
// tools/test-wall-pass.mjs imports it with no network at all.
// ---------------------------------------------------------------------------

import { extractJson } from './openaiDetect.js';

/**
 * THE MODEL FOR THIS PASS, and it is not the app's default on purpose.
 *
 * Every other vision call in this app looks at a LINE DRAWING — flat, black on
 * white, a handful of conventions. This one looks at RENDERS: soft lighting,
 * perspective, reflections, materials that differ from each other by texture
 * alone. Telling fluted panelling from a wallpaper with a vertical stripe is a
 * genuinely harder call than telling a wardrobe from a TV unit, and the second
 * call then has to hold a wall table, an anchor table and a self-check in its
 * head at once.
 *
 * So this pass gets the best model available and is allowed to think. Override
 * with OPENAI_WALL_MODEL on the server if a better one appears — the env var is
 * read in api/accents.js and listed in .env.example and vite.config.js.
 */
export const WALL_MODEL = 'gpt-5.5';

/**
 * Reasoning effort, passed straight through to the API.
 *
 * Set to null to omit the field entirely — which is what to do if a model ever
 * rejects it with a 400. It is a hint, not a requirement, and the pass works
 * without it.
 */
export const WALL_REASONING = 'high';

/**
 * THE OUTPUT CAP. Read the long note in accentPrompt.js before changing it: on
 * a reasoning model this is a budget for REASONING PLUS OUTPUT and the
 * reasoning is invisible, so a cap tuned close to the visible answer buys a
 * 200 OK with empty content — which every parser downstream reads as "found
 * nothing".
 *
 * PROMPT 02 gets far more than PROMPT 01 because it is asked for a WORKSHEET
 * before the JSON: a wall table, an anchor table, a line per element and a
 * self-check, and then the array. That is real output, not just thinking.
 */
export const MAX_OUT_RENDER = 8000;
export const MAX_OUT_GRID = 16000;

/** How many wall elements is more than a room has. Stated AND enforced. */
export const MAX_ELEMENTS = 24;

/** 1 cell = 1 ft. The scale the grid is drawn at and the scale PROMPT 02 is
 *  told about. One constant so the picture and the prompt cannot disagree. */
export const CELL_FT = 1;

// --- what this pass reads ---------------------------------------------------

/**
 * The vocabulary, and the whole of it.
 *
 * `colour` is what the filled cells are drawn in on the plan. Muted on purpose
 * — see the palette note in PlanCanvas.jsx: this is a READING of the room, not
 * a fitting, and it must not compete with the lighting for attention.
 */
export const WALL_TYPES = [
  { id: 'shelves',   label: 'Shelves',    short: 'shelf',  colour: '#7C6A58' },
  { id: 'painting',  label: 'Painting',   short: 'art',    colour: '#8A6D3B' },
  { id: 'wall_art',  label: 'Wall art',   short: 'art',    colour: '#8A6D3B' },
  { id: 'panelling', label: 'Panelling',  short: 'panel',  colour: '#5F6B57' },
  { id: 'wallpaper', label: 'Wallpaper',  short: 'paper',  colour: '#6B5B7B' },
];

export const WALL_IDS = WALL_TYPES.map((t) => t.id);
export const WALL_BY_ID = Object.fromEntries(WALL_TYPES.map((t) => [t.id, t]));

/**
 * The word the model used -> one of ours, or null.
 *
 * Generous in, strict out, exactly like normaliseType in accentPrompt.js. A
 * model that writes "wall panelling", "framed artwork" or "open shelving" has
 * SEEN the thing; filing is not something to lose a detection over.
 *
 * ORDER MATTERS. "wall art" contains "art" and "wall"; "wallpaper" contains
 * "wall". The specific tests run before the loose ones.
 */
export function normaliseWallType(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (WALL_IDS.includes(key)) return key;
  const s = key.replace(/_/g, ' ');
  if (/\bwall ?paper\b|\bwall covering\b/.test(s)) return 'wallpaper';
  if (/\bpanell?ing\b|\bpanel\b|\bslat\b|\bfluted\b|\bwainscot/.test(s)) return 'panelling';
  if (/\bshel(f|ves|ving)\b|\bniche\b|\bledge\b|\bbookcase\b/.test(s)) return 'shelves';
  if (/\bpainting\b|\bcanvas\b|\bportrait\b/.test(s)) return 'painting';
  if (/\bart\b|\bartwork\b|\bframe[ds]?\b|\bprint\b|\bmirror\b|\bmural\b|\btapestry\b/.test(s)) return 'wall_art';
  return null;
}

// ===========================================================================
// PROMPT 01 — the renders -> a list of wall elements, in English.
// ===========================================================================

/**
 * VERBATIM, and that is the point of it being a constant on its own.
 *
 * The body below is the question as it was written by the person who knows
 * what a good answer looks like. Everything the machine needs — the JSON-only
 * instruction, the exact key names, the shape — is appended AFTER it in
 * buildRenderPrompt(), so that tightening the machine half never means editing
 * the half that carries the intent, and vice versa.
 */
export const RENDER_PROMPT_01 = `Can you describe the position of only any decorative shelves, painting, wall art, panelling or wallpaper, in the room in terms of:
What it is -> "type" (decorative shelves, painting, wall art, panelling or wallpaper)
What wall it sits on (descriptive phrases relative to major objects of room like bed back wall or wall behind the dining, but don't use vague terms like right side wall or north wall) -> "wall"
Where it sits on that wall (descriptive phrases again relative to that wall or its major objects like 2 ft above the bed centered on the bed) -> "location"
It's own dimensions (it's three paintings in a row total size of the installation would be 2ft high and 5ft wide) -> "dimension"
Output an array of JSON object of such positions.`;

/**
 * The prompt as sent: the question above, plus the context the model cannot
 * see and the output contract the parser depends on.
 *
 * WHY THE ROOM'S SIZE IS GIVEN. "dimension" is the field the second call turns
 * into a run of cells, so a wildly wrong estimate there is a wildly wrong run
 * on the plan. A model that knows the room is 12ft x 14ft has something to
 * scale the wall against; without it, a 5ft painting and a 9ft one look the
 * same in a photograph.
 */
export function buildRenderPrompt({ room = null, views = 1 } = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const wFt = n(room?.widthFt), hFt = n(room?.heightFt), aFt = n(room?.areaSqft);

  const roomLine = typeof room?.name === 'string' && room.name.trim()
    ? ` It is labelled "${room.name.trim().slice(0, 60)}" on the drawing.` : '';
  const sizeLine = wFt && hFt
    ? ` The room measures roughly ${wFt.toFixed(1)} ft by ${hFt.toFixed(1)} ft`
      + ` (${Math.round(aFt || 0)} sq ft) on the floor plan — use that to judge how`
      + ` wide a wall is, and therefore how wide the things on it are.` : '';

  const viewLine = views > 1
    ? `You are looking at ${views} views of ONE room. They may overlap. Something`
      + ` visible in two views is ONE element, not two — describe it once.`
    : `You are looking at one view of a room.`;

  return `${viewLine} These are interior renders or photographs, not drawings.${roomLine}${sizeLine}

${RENDER_PROMPT_01}

Nothing free-standing. A bookshelf that stands on the floor still counts if it
is against a wall and reads as a wall feature; a coffee table, a rug, a curtain,
a TV, a mirror on a dressing table and a light fitting do not. If the room has
none of these, return an empty array — that is a correct answer.

Give "wall" and "location" as the descriptive phrases asked for above, in plain
words, tied to what is in the room. They are read by a second step that has the
FLOOR PLAN of this same room in front of it and has to work out which wall you
mean, so "the wall behind the bed" or "the wall the wardrobe is on" is usable
and "the north wall" or "the right-hand wall" is not.

Give "dimension" as the size of the WHOLE installation in feet, height and
width — if it is three paintings in a row, the width is from the left edge of
the first to the right edge of the third.

Return ONLY a JSON array. No prose, no markdown fence, no explanation.

[{"type":"panelling",
  "wall":"the wall behind the bed",
  "location":"full width of the bed wall, from the floor to about 4ft up",
  "dimension":"4ft high and 9ft wide",
  "confidence":0.0,
  "note":"<how you recognised it, one short phrase>"}]`;
}

/** The wire request for PROMPT 01. `renders` is a list — a couple of views of
 *  one room — and they all go in one message, because "is this the same
 *  painting seen twice" is a question only answerable with both in view. */
export function buildRenderRequest({ renders = [], room = null,
                                     model = WALL_MODEL, maxTokens = MAX_OUT_RENDER } = {}) {
  const list = renders.filter((r) => r?.base64);
  if (!list.length) throw new Error('No renders to look at.');
  const req = {
    model,
    max_completion_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        ...list.map((r) => ({
          type: 'image_url',
          image_url: { url: `data:${r.mime || 'image/jpeg'};base64,${r.base64}`, detail: 'high' },
        })),
        { type: 'text', text: buildRenderPrompt({ room, views: list.length }) },
      ],
    }],
  };
  // NO response_format HERE, and that is not an oversight. The answer is a
  // top-level ARRAY, and `json_object` forces an object — the model then wraps
  // it in a key it invents, which is a shape the parser has to guess at. A
  // bare array with the fence stripped is the more reliable contract, and
  // extractJson() has handled fences and preambles since the bed route.
  if (WALL_REASONING) req.reasoning_effort = WALL_REASONING;
  return req;
}

// --- reading PROMPT 01's reply ----------------------------------------------

const str = (v, n = 240) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v
  : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null));
const describe = (v) => {
  try { return JSON.stringify(v).slice(0, 200); } catch { return String(v).slice(0, 200); }
};

/** Whichever key it used for the list. Told to return a bare array; forgiving
 *  of the object a model wraps it in anyway. `beds` is in here because
 *  extractJson() normalises a bare top-level array to { beds: [...] }. */
export function elementList(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object') return [];
  for (const k of ['beds', 'elements', 'items', 'positions', 'features',
                   'wall_elements', 'objects', 'results']) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  return [];
}

/**
 * "2ft high and 5ft wide" -> 5. Best effort, and used ONLY as a check.
 *
 * The run of cells comes from PROMPT 02, which has the plan in front of it.
 * This is here so the panel can say "the model called it 5ft wide and then
 * drew it 11ft long", which is the one disagreement worth surfacing — it is
 * almost always the second call mis-reading the grid, and it is invisible
 * otherwise.
 */
export function widthFtFrom(dimension) {
  const s = String(dimension ?? '').toLowerCase().replace(/[’']/g, "'");
  const ft = String.raw`(?:ft|feet|foot|')`;
  // "5ft wide" / "wide 5 ft" / "width 5ft"
  let m = s.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${ft}?\s*(?:wide|width|long|across)`))
       || s.match(new RegExp(String.raw`(?:wide|width|long|across)\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*${ft}`));
  if (m) return +m[1];
  // "2ft x 5ft" — the SECOND number, because height is conventionally first
  // when a person writes "2ft high and 5ft wide" and h x w is the same order.
  m = s.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${ft}?\s*[x×by]+\s*(\d+(?:\.\d+)?)\s*${ft}`));
  if (m) return +m[2];
  return null;
}

/**
 * The reply -> wall elements. English only; no geometry anywhere in here.
 *
 * `id` is assigned by the caller, not here, because it has to carry the room
 * and this function does not know one.
 */
export function elementsFromReply(text) {
  // THE ARRAY HUNT FIRST, AND extractJson SECOND, because this prompt asks for
  // a top-level ARRAY and extractJson is built around an object.
  //
  // Concretely: given "Here is what I saw:" followed by a fenced array, the
  // shared parser strips no fence (its strip is anchored at the start of the
  // string), fails the direct parse, then finds a `{` and a `}` — the first and
  // last BRACES INSIDE THE ARRAY — and RETURNS whatever that slice parses to,
  // which is null. The array branch below it never runs. So a perfectly good
  // reply with one sentence in front of it reads as "found nothing".
  //
  // lastJsonArray() is bracket-balanced and string-aware, so it gets that case
  // right; extractJson stays as the fallback for the reply that came back as an
  // object with the list under a key.
  const arr = lastJsonArray(text);
  const list = Array.isArray(arr) ? arr : elementList(extractJson(text));
  const elements = [];
  const skipped = [];

  for (const e of list) {
    if (elements.length >= MAX_ELEMENTS) {
      skipped.push({ raw: describe(e), reason: `over the ${MAX_ELEMENTS}-element cap` });
      continue;
    }
    if (!e || typeof e !== 'object') {
      skipped.push({ raw: describe(e), reason: 'not an object' });
      continue;
    }
    const raw = e.type ?? e.what ?? e.kind ?? e.class ?? e.label ?? '';
    const type = normaliseWallType(raw);
    if (!type) {
      skipped.push({ raw: describe(e), reason: `"${String(raw).slice(0, 40) || '?'}" is not a wall element this pass reads` });
      continue;
    }
    const wall = str(e.wall ?? e.surface ?? e.on_wall);
    const location = str(e.location ?? e.position ?? e.where);
    const dimension = str(e.dimension ?? e.dimensions ?? e.size, 120);
    // A TYPE WITH NO WALL IS NOT PLACEABLE. The second call is given nothing to
    // reason from and will invent a wall to satisfy the request, which is worse
    // than the element being dropped here where the panel can say so.
    if (!wall) {
      skipped.push({ raw: describe(e), reason: 'no wall given, so nothing to place it against' });
      continue;
    }
    elements.push({
      type, wall, location, dimension,
      widthFt: widthFtFrom(dimension),
      note: str(e.note ?? e.reason, 160),
      confidence: Math.max(0, Math.min(1, num(e.confidence) ?? 0.7)),
    });
  }

  return { elements, skipped };
}

// ===========================================================================
// PROMPT 02 — the list + a gridded plan -> cell references.
// ===========================================================================

/**
 * VERBATIM, with the {braces} left in as the fill-ins they are.
 *
 * Six placeholders, all filled by gridPrompt02() below:
 *   {ANCHOR_LINES}  the four ANCHORS bullets, built from what the app already
 *                   detected in this room — see anchorLines() in wallGrid.js
 *   {N}             feet per cell (CELL_FT)
 *   {ROWS} {COLS}   the grid actually drawn on the image
 *   {ELEMENTS}      PROMPT 01's array, pasted in
 *
 * THE WORKSHEET IS ASKED FOR AND THE PARSER EXPECTS IT. "Output these steps as
 * a short worksheet before the JSON" is not decoration — it is the self-check
 * in step 4 that catches an element placed on a wall coordinate that is not
 * that wall's, and asking for it visibly is what makes the model actually run
 * it. cellsFromReply() therefore reads the LAST array in the reply rather than
 * the first thing that parses, because everything before it is prose.
 */
export function gridPrompt02({ anchorLines = '', rows = 10, cols = 10,
                               cellFt = CELL_FT, elements = [] } = {}) {
  return `You are placing wall-mounted interior elements onto a gridded floor plan.

INPUTS

1. A floor plan image with a visible square grid.
2. SCALE: 1 cell = ${cellFt} ft.
3. ANCHORS (how the 3D descriptions map to the plan):
${anchorLines}
4. ELEMENTS: the JSON array at the end of this prompt.

COORDINATES

- Cell references are [x, y] where x = column, y = row.
- The bottom-left cell inside the room is [1, 1]. x increases to the right, y increases upward.
- Cells are counted inside the room's inner wall faces, ignoring wall thickness.

RULES
A. Every element here is mounted ON a wall. It therefore occupies a single line
of cells hugging that wall, not a rectangle in the middle of the room:

- Horizontal wall (top/bottom) -> constant y, varying x.
- Vertical wall (left/right) -> constant x, varying y.
  B. Use only the dimension that appears in plan view: the wall-parallel length
  (width). Ignore height. Depth/thickness collapses to 1 cell.
  C. Cell count = round(width_in_ft / ${cellFt}), minimum 1. If the computed run is
  longer than the wall, clamp it to the wall and say so.
  D. Vertical stacking in the real room is invisible in plan. Elements stacked on
  top of each other (e.g. three shelves one above the other) share the SAME
  start_cell and end_cell. Do not spread them out along the wall.
  E. Position along the wall using the location text plus the ANCHORS. If the text
  says "beside the TV toward the window", run the element from the TV side
  toward the window end of that wall.
  F. Elements on different walls must never share a wall coordinate.

PROCEDURE — output these steps as a short worksheet before the JSON.
Step 1. Wall table. For each wall of the room: id, orientation, its constant
coordinate, and its cell span. Example:
W1 top wall, horizontal, y = ${rows}, x from 1 to ${cols}.
Step 2. Anchor table. Locate each ANCHOR as a cell or cell range on a wall id.
Step 3. For each element: the wall id you assigned, why, and the cell count from
rule C.
Step 4. Self-check. Confirm for every element: start and end are on the same
wall line; the constant coordinate matches that wall; end - start + 1
equals the cell count; all cells are inside the room; no two elements on
the same wall overlap unless their descriptions say they do.
Step 5. Output the original array unchanged, with three fields added to each
object: "wall_ref" (wall id from Step 1), "start_cell", "end_cell".
Format cells as [x, y]. Nothing after the JSON.

Elements: ${JSON.stringify(elements, null, 2)}`;
}

/**
 * The wire request for PROMPT 02.
 *
 * The image is the SAME crop the accent pass sends — one room at full contrast,
 * the rest of the sheet washed back — with a 1ft grid drawn over the room and
 * the cell numbers labelled down two edges. See griddedRoomSnapshot in
 * wallGrid.js for why the labels are there: reading a number beats estimating
 * a distance, which is the whole argument for the grid arm in openaiDetect.js.
 */
export function buildGridRequest({ plan, elements = [], anchorLines = '',
                                   rows = 10, cols = 10, cellFt = CELL_FT,
                                   model = WALL_MODEL, maxTokens = MAX_OUT_GRID } = {}) {
  if (!plan?.base64) throw new Error('No gridded plan image to look at.');
  if (!elements.length) throw new Error('No elements to place.');
  const req = {
    model,
    max_completion_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url',
          image_url: { url: `data:${plan.mime || 'image/jpeg'};base64,${plan.base64}`, detail: 'high' } },
        { type: 'text', text: gridPrompt02({ anchorLines, rows, cols, cellFt, elements }) },
      ],
    }],
  };
  // NO response_format, AND HERE IT WOULD ACTIVELY BREAK THE PROMPT. Step 5
  // asks for a worksheet in prose and THEN the array; `json_object` forbids the
  // prose, which removes the self-check that is the reason for the worksheet.
  if (WALL_REASONING) req.reasoning_effort = WALL_REASONING;
  return req;
}

// --- reading PROMPT 02's reply ----------------------------------------------

/**
 * The LAST top-level JSON array in a reply, as text.
 *
 * extractJson() is wrong for this one reply and only this one. It hunts from
 * the first `{` to the last `}`, which on a worksheet-then-array reply spans
 * the prose as well and parses to nothing; and its array fallback runs from the
 * FIRST `[` — which is a cell reference inside the worksheet, not the answer.
 *
 * So: scan from the end, balance brackets, ignore anything inside a string.
 * Returns null rather than throwing, so a truncated reply is a diagnosable
 * "could not find the array" instead of a stack trace.
 */
// A FUNCTION DECLARATION, NOT A CONST. elementsFromReply() above calls it and
// is defined earlier in the file; declarations hoist and `const fn = () => {}`
// does not. Turn this into an arrow and the render pass's first call starts
// throwing a temporal-dead-zone error at runtime and nowhere else.
export function lastJsonArray(text) {
  const s = String(text ?? '');
  for (let end = s.lastIndexOf(']'); end >= 0; end = s.lastIndexOf(']', end - 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = end; i >= 0; i--) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '"') {
          // Count the backslashes before this quote: an odd number escapes it.
          let b = 0, j = i - 1;
          while (j >= 0 && s[j] === '\\') { b++; j--; }
          if (b % 2 === 0) inStr = false;
        }
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === ']' || c === '}') depth++;
      else if (c === '[' || c === '{') {
        depth--;
        if (depth === 0) {
          if (c !== '[') break;          // a bare object, not the array
          const slice = s.slice(i, end + 1);
          try { const v = JSON.parse(slice); if (Array.isArray(v)) return v; } catch { /* keep looking */ }
          break;
        }
      }
    }
  }
  return null;
}

/** "[3, 7]" in any of the shapes a model writes it. */
export function cellFrom(v) {
  if (Array.isArray(v) && v.length >= 2) {
    const x = num(v[0]), y = num(v[1]);
    return x != null && y != null ? { x: Math.round(x), y: Math.round(y) } : null;
  }
  if (v && typeof v === 'object') {
    const x = num(v.x ?? v.col ?? v.column), y = num(v.y ?? v.row);
    return x != null && y != null ? { x: Math.round(x), y: Math.round(y) } : null;
  }
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/g);
    if (m && m.length >= 2) return { x: Math.round(+m[0]), y: Math.round(+m[1]) };
  }
  return null;
}

/**
 * The reply -> elements with a RUN OF CELLS each, in grid coordinates.
 *
 * Grid coordinates, not pixels: [1,1] is the bottom-left cell inside the room,
 * x right, y up, exactly as the prompt defines them. Turning that into plan
 * pixels is wallGrid.js's job, because the grid is what knows where it was
 * drawn — the same split as accentPrompt/accentMask, and for the same reason.
 *
 * WHAT IS ENFORCED HERE, because rule A is the one that gets broken:
 *   - a run must be on ONE line (same x, or same y). A diagonal is a
 *     misreading of "hugging that wall" and is rejected rather than drawn.
 *   - every cell must be inside the grid. Out of bounds is CLAMPED, not
 *     dropped, and the clamp is reported — a 9ft run on an 8ft wall is the
 *     model obeying rule C badly, not a wrong wall, and the wall is still right.
 */
export function cellsFromReply(text, { rows = 10, cols = 10 } = {}) {
  const arr = lastJsonArray(text);
  const placed = [];
  const skipped = [];
  if (!Array.isArray(arr)) return { placed, skipped, matched: false };

  for (const e of arr) {
    if (!e || typeof e !== 'object') { skipped.push({ raw: describe(e), reason: 'not an object' }); continue; }
    const a = cellFrom(e.start_cell ?? e.startCell ?? e.start);
    const b = cellFrom(e.end_cell ?? e.endCell ?? e.end) ?? a;
    if (!a || !b) {
      skipped.push({ raw: describe(e), reason: 'no readable start_cell / end_cell' });
      continue;
    }
    if (a.x !== b.x && a.y !== b.y) {
      skipped.push({ raw: describe(e), reason: 'start and end are not on one wall line (rule A)' });
      continue;
    }
    const clamp = (v, hi) => Math.max(1, Math.min(hi, v));
    const x0 = clamp(Math.min(a.x, b.x), cols), x1 = clamp(Math.max(a.x, b.x), cols);
    const y0 = clamp(Math.min(a.y, b.y), rows), y1 = clamp(Math.max(a.y, b.y), rows);
    const clamped = x0 !== Math.min(a.x, b.x) || x1 !== Math.max(a.x, b.x)
                 || y0 !== Math.min(a.y, b.y) || y1 !== Math.max(a.y, b.y);

    const cells = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y });

    placed.push({
      type: normaliseWallType(e.type) || null,
      wall: str(e.wall), location: str(e.location), dimension: str(e.dimension, 120),
      wallRef: str(e.wall_ref ?? e.wallRef, 24),
      start: { x: x0, y: y0 }, end: { x: x1, y: y1 },
      cells, clamped,
      confidence: Math.max(0, Math.min(1, num(e.confidence) ?? 0.7)),
      note: str(e.note, 160),
    });
  }
  return { placed, skipped, matched: placed.length > 0 };
}

/**
 * PROMPT 01's list and PROMPT 02's placements, joined back up.
 *
 * BY INDEX FIRST, because step 5 says "output the original array unchanged" and
 * a model that obeyed returns them in order. By type-and-wall second, for the
 * one that reordered or dropped one. Anything left unmatched keeps its English
 * and gets no cells — which is exactly what the panel needs to show: "found it,
 * could not place it" is a different failure from "did not find it".
 */
export function joinPlacements(elements, placed) {
  const used = new Set();
  const key = (e) => `${e.type}|${String(e.wall).toLowerCase().slice(0, 40)}`;
  return elements.map((e, i) => {
    let p = null;
    if (placed[i] && (!placed[i].type || placed[i].type === e.type) && !used.has(i)) {
      p = placed[i]; used.add(i);
    } else {
      const j = placed.findIndex((q, k) => !used.has(k) && key(q) === key(e));
      if (j >= 0) { p = placed[j]; used.add(j); }
    }
    return p ? { ...e, cells: p.cells, start: p.start, end: p.end,
                 wallRef: p.wallRef, clamped: p.clamped }
             : { ...e, cells: [], start: null, end: null, wallRef: '', clamped: false };
  });
}
