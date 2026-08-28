// ---------------------------------------------------------------------------
// openaiDetect.js — asking a general vision model where the beds are.
//
// WHY THIS EXISTS ALONGSIDE ROBOFLOW. The two providers fail in opposite
// directions, which is the whole argument for having both:
//
//   Roboflow  knows a box when it commits to one — the box is tight — but it is
//             an open-vocabulary detector looking at a LINE DRAWING, which is
//             not what it was trained on, so it often commits to nothing.
//   A VLM     recognises a bed on a plan easily, can read "MASTER BEDROOM"
//             printed next to it, and will tell you there are three of them.
//             What it CANNOT do is measure. Its encoder turns the plan into a
//             coarse grid of patch tokens and there is no spatial regression
//             head on the end; asked for pixel coordinates it produces
//             plausible numbers with an error of several percent of the image.
//
// Several percent sounds tolerable until you put it in feet. On a 20ft-wide
// bedroom photographed at 1600px, 5% is a foot — which is the difference
// between a zone that covers the bed and a zone that covers the bedside table
// and half the pillow. So the numbers cannot be taken at face value, and this
// module is mostly about ASKING IN A FORM THE MODEL CAN ACTUALLY ANSWER.
//
// THREE FORMS, TO BE MEASURED AND NOT GUESSED AT. See tools/eval-detect.mjs.
//
//   'bounds'      THE ONE THAT SHIPS. Plain image, one call, ask for the box as
//                 0..1 fractions of the image. Nothing is drawn on the image
//                 and nothing is asked of the model except "where is it" — the
//                 dimensions, the padding, the feet and the zone are all worked
//                 out locally from the fractions and the known px/ft, which is
//                 arithmetic we are better at than it is.
// The other two are kept for the eval only. Reach for them if — and only if —
// 'bounds' measures badly on your own plans; they cost a drawing step and a
// busier image, and a grid dense enough to be precise is dense enough to bury
// the furniture underneath it.
//
//   'gridPixels'  A LABELLED GRID is burned onto the image before sending, and
//                 it answers in pixels. The point is not the grid lines, it is
//                 the NUMBERS PRINTED NEXT TO THE BED: reading a label beats
//                 estimating a distance, and the model is being asked to do
//                 the thing it is good at (reading) instead of the thing it is
//                 bad at (measuring).
//   'gridCells'   Same overlay, but it answers in CELL REFERENCES — "the bed
//                 spans columns C to F, rows 4 to 6" — and we convert. This is
//                 quantisation as error control: the answer can only be wrong
//                 by whole cells, and we choose the cell size. Coarser than
//                 the truth by construction, never wildly wrong.
//
// WHAT ABOUT ASKING IT TO DRAW THE BOX AND FINDING THE COLOUR OURSELVES?
// Right instinct, wrong direction, and worth writing down because it is the
// first thing everyone suggests. The vision API is read-only: an image goes in
// and text comes out. The only way to get an image back is the image
// GENERATION model, which re-synthesises the whole picture — you would get a
// convincing floor plan that is not your floor plan, with the walls moved.
// Useless for measurement.
//
// The instinct is salvageable by turning it round: WE draw the candidates and
// the model picks. Our own pixel code (detect.js already has colour masks,
// morphology, connected components and boundary tracing) can propose the
// closed rectangles of line work inside a room, we outline each in its own
// colour, and the model answers "the blue one". Picking from a short list is
// a recognition task, which is its strong suit, and the box is then exactly as
// tight as our pixel code — no regression involved anywhere. That is the
// 'candidates' arm, and it is deliberately NOT built until the eval says the
// cheaper arms are not good enough. See "Known limits" in the README.
//
// EVERYTHING HERE IS PURE. No fetch, no browser. api/detect.js and
// tools/eval-detect.mjs both import it, so the prompt the eval measures is
// byte-for-byte the prompt production sends.
// ---------------------------------------------------------------------------

/** Default model. Overridable everywhere; `--list-models` in the eval says
 *  what a given key can actually see, which beats trusting this constant. */
/**
 * THE OUTPUT CAP, AND WHY IT IS 8000 FOR A REPLY THAT IS OFTEN 200 TOKENS LONG.
 *
 * `max_completion_tokens` on a reasoning model is a budget for REASONING PLUS
 * OUTPUT, and the reasoning is invisible. Set it to a number that looks generous
 * for the answer and the model thinks its way through the whole allowance, emits
 * nothing, and returns 200 OK with an empty `content`. Every parser downstream
 * reads that as "found nothing" — which is indistinguishable from a plan with no
 * beds in it.
 *
 * WE WATCHED THIS HAPPEN. A ten-bedroom resort sheet: the bed route (capped at
 * 1500) returned no beds on eight of ten room crops, and the furniture route
 * (capped at 3000) found the beds in those same crops on the same model. The
 * failures correlated perfectly with LATENCY — the calls that answered took 13
 * and 20 seconds, every call that came back empty took 21 to 26, and in the
 * furniture route the only two empty replies were the two slowest of the batch
 * at 47s. Slower means more reasoning; more reasoning means the budget is spent
 * before the answer starts.
 *
 * A CAP IS A CEILING, NOT A SPEND. Nothing is billed for headroom, so the number
 * should be far above the largest plausible reply rather than tuned close to it.
 * A cap that occasionally truncates is not a small inefficiency here — it is a
 * silent wrong answer.
 */
const MAX_OUT = 8000;

export const DEFAULT_MODEL = 'gpt-5.5';

/** Grid pitch in pixels of the image AS SENT. ~100px on a 1600px plan gives a
 *  16-column grid: fine enough that a cell is well under a bed, coarse enough
 *  that the labels stay readable after JPEG. */
export const DEFAULT_PITCH = 100;

/** The arm the app uses. The others exist so that this one had to win. */
export const DEFAULT_ARM = 'bounds';

export const ARMS = ['bounds', 'gridPixels', 'gridCells'];

// --- the grid ---------------------------------------------------------------

/**
 * Spreadsheet-style column labels: A..Z, then AA, AB...
 * Letters for columns and digits for rows on purpose — it makes "C4"
 * unambiguous, and it means a transposed answer is obvious rather than silent.
 */
export function colLabel(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

export function colIndex(label) {
  const s = String(label).trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The grid, as numbers. Shared by whoever draws it, so the overlay the eval
 * burns onto a JPEG and the overlay the browser will burn onto a canvas cannot
 * disagree about where column C is — which would be a silent, one-cell,
 * impossible-to-see error in every result.
 *
 * The last column and row are usually short. They are kept rather than merged:
 * a bed touching the right-hand edge has to be nameable.
 */
export function gridSpec({ w, h, pitch = DEFAULT_PITCH }) {
  const p = Math.max(8, Math.round(pitch));
  const cols = [];
  for (let i = 0, x = 0; x < w; i++, x += p) {
    cols.push({ i, label: colLabel(i), x0: x, x1: Math.min(w, x + p) });
  }
  const rows = [];
  for (let i = 0, y = 0; y < h; i++, y += p) {
    rows.push({ i, label: String(i + 1), y0: y, y1: Math.min(h, y + p) });
  }
  return { w, h, pitch: p, cols, rows };
}

/**
 * A cell range -> a rect in pixels. INCLUSIVE at both ends, because "columns C
 * to F" in English includes F. Off-by-one here is a whole cell of error, so
 * there is a test for exactly this.
 */
export function cellRangeToRect(range, spec) {
  const c0 = typeof range.colFrom === 'number' ? range.colFrom : colIndex(range.colFrom);
  const c1 = typeof range.colTo === 'number' ? range.colTo : colIndex(range.colTo);
  const r0 = Number(range.rowFrom) - 1;
  const r1 = Number(range.rowTo) - 1;
  if (c0 == null || c1 == null || !Number.isFinite(r0) || !Number.isFinite(r1)) return null;

  const lo = (v, arr) => arr[Math.max(0, Math.min(arr.length - 1, v))];
  const a = lo(Math.min(c0, c1), spec.cols), b = lo(Math.max(c0, c1), spec.cols);
  const c = lo(Math.min(r0, r1), spec.rows), d = lo(Math.max(r0, r1), spec.rows);
  return { x0: a.x0, y0: c.y0, x1: b.x1, y1: d.y1 };
}

/** "C4" / "c4" / "C 4" -> {col, row}. Tolerant, because models write both. */
export function parseCellRef(ref) {
  const m = String(ref).trim().match(/^([A-Za-z]+)\s*[-, ]?\s*(\d+)$/);
  if (!m) return null;
  const col = colIndex(m[1]);
  const row = Number(m[2]) - 1;
  return col == null || !Number.isFinite(row) ? null : { col, row };
}

// --- the prompts ------------------------------------------------------------

/**
 * What a bed IS, stated once and shared by every arm.
 *
 * Every clause here is load-bearing and was chosen for a failure it prevents:
 * the mattress rather than "the bed area" (otherwise the nightstands come
 * along); every bed on the sheet (a whole-floor plan has three bedrooms and
 * the app filters by room later — see detectionsToZones); and an explicit
 * permission to return nothing, because a model asked to find beds will find
 * beds, and a confident box over a sofa is worse than an empty answer.
 */
const WHAT_IS_A_BED = `You are looking at an architectural floor plan — a line drawing seen from
above, not a photograph. Find every BED on it.

A bed is the MATTRESS rectangle: usually a plain rectangle with pillows drawn
as one or two smaller rectangles or ovals along one short edge, and often a
turned-down corner or a blanket line across it. Report the mattress only.

Do NOT include:
- bedside tables, lamps or the rug beside the bed
- the wardrobe, dresser or study table in the same room
- sofas, daybeds in a living room, or a dining table

ONE BOX PER BED, never one box around two. Twin beds side by side, or a pair in
a hotel room, are TWO beds and want two boxes with the gap between them left
out. Boxing a pair as a single object is the commonest mistake on a plan like
this, and it is always wrong: the floor between two beds is ordinary ceiling.

Include EVERY bed on the whole drawing, even in rooms that look unimportant —
a plan can have three bedrooms and all of them matter.

If there is no bed on this drawing, return an empty list. An empty list is a
correct and useful answer. Do not promote a sofa or a table to a bed to avoid
returning nothing.`;

const OUTPUT_RULES = `Return ONLY a JSON object. No prose, no markdown fence, no explanation.`;

/**
 * The prompt for one arm.
 *
 * `room` is asked for in every arm and is pure profit: it is the one thing a
 * general model gives us that a box detector cannot, because it can READ the
 * text printed on the plan. "MASTER BEDROOM" next to the biggest bed is how
 * you would eventually tell a master from a kid's room without asking.
 */
export function buildPrompt(arm = DEFAULT_ARM, { w, h, spec = null } = {}) {
  if (arm === 'bounds') {
    return `${WHAT_IS_A_BED}

Give each bed's bounding box as FRACTIONS of the image size, between 0 and 1,
where 0,0 is the top-left corner of the image and 1,1 is the bottom-right.
The image is ${w} x ${h} pixels, but answer in fractions, not pixels — you do
not need to work out any real-world size or count any pixels. Just the four
edges of the box, as fractions. Everything else is calculated from them.

${OUTPUT_RULES}
{"beds":[{"x0":0.00,"y0":0.00,"x1":0.00,"y1":0.00,"confidence":0.0,"room":"<room name printed on the plan, or null>","note":"<how you recognised it, one short phrase>"}]}`;
  }

  if (arm === 'gridPixels') {
    return `${WHAT_IS_A_BED}

A measuring grid has been drawn over the image for you. Grid lines are every
${spec.pitch} pixels. Along the TOP edge the pixel x-coordinate of each line is
printed; along the LEFT edge the pixel y-coordinate is printed. 0,0 is the
top-left corner. The image is ${w} x ${h} pixels.

READ the printed numbers on the lines nearest each edge of the bed rather than
estimating a distance. If a bed edge falls between two lines, interpolate
between the two printed numbers.

${OUTPUT_RULES}
{"beds":[{"x0":0,"y0":0,"x1":0,"y1":0,"confidence":0.0,"room":"<room name printed on the plan, or null>","note":"<which grid lines you read, one short phrase>"}]}`;
  }

  if (arm === 'gridCells') {
    const lastCol = spec.cols[spec.cols.length - 1].label;
    const lastRow = spec.rows[spec.rows.length - 1].label;
    return `${WHAT_IS_A_BED}

A labelled grid has been drawn over the image. Columns are lettered A to
${lastCol} left to right, printed along the top edge. Rows are numbered 1 to
${lastRow} top to bottom, printed along the left edge. Each cell is
${spec.pitch} x ${spec.pitch} pixels.

Do NOT give pixel coordinates. Give the range of CELLS each bed covers, by
label — the first and last column it touches, and the first and last row.
Include a cell if any part of the mattress is inside it. Answer by reading the
printed labels at the edges of the grid.

${OUTPUT_RULES}
{"beds":[{"colFrom":"C","colTo":"F","rowFrom":4,"rowTo":6,"confidence":0.0,"room":"<room name printed on the plan, or null>","note":"<one short phrase>"}]}`;
  }

  throw new Error(`Unknown arm "${arm}". Expected one of: ${ARMS.join(', ')}.`);
}

// --- the request ------------------------------------------------------------

/**
 * The Chat Completions body. Chat Completions rather than Responses because
 * base64 image input on it is the best-trodden path of the two, and this call
 * is one turn with no state to carry.
 *
 * Two deliberate omissions. No `temperature`: the newer reasoning models
 * reject it outright, and a 400 from a parameter nobody needs is a bad way to
 * lose an evening. And `max_completion_tokens`, not `max_tokens`, for the same
 * reason.
 *
 * `json_object` mode is requested by default. The parser below still strips
 * fences and hunts for the first brace, because a mode that is refused must
 * degrade rather than fail.
 */
export function buildRequest({ arm = DEFAULT_ARM, base64, mime = 'image/jpeg', w, h, spec = null,
                               model = DEFAULT_MODEL, jsonMode = true, maxTokens = MAX_OUT } = {}) {
  if (!base64) throw new Error('No image to look at.');
  const prompt = buildPrompt(arm, { w, h, spec });
  return {
    model,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    max_completion_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } },
        { type: 'text', text: prompt },
      ],
    }],
  };
}

/** The assistant text out of a Chat Completions response. */
export function textFromResponse(json) {
  const c = json?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => p?.text ?? '').join('');
  return '';
}

// --- the reply -> the shape furniture.js already reads ----------------------

/**
 * Pull the JSON out of whatever came back. A fence, a preamble, a trailing
 * apology — all survivable. The brace hunt is last-resort and greedy from the
 * first `{` to the last `}` so a nested object is not truncated.
 */
export function extractJson(text) {
  if (!text) return null;
  const stripped = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/,'');
  // A top-level array is normalised to { beds: [...] } here rather than being
  // handed on bare, so both parse paths below return the same shape. Two
  // return shapes from one function is how a caller ends up correct on the
  // fenced case and wrong on the unfenced one.
  const wrap = (v) => (Array.isArray(v) ? { beds: v } : v);
  const tryParse = (s) => { try { return wrap(JSON.parse(s)); } catch { return null; } };
  const direct = tryParse(stripped.trim());
  if (direct) return direct;
  const a = stripped.indexOf('{'), b = stripped.lastIndexOf('}');
  if (a >= 0 && b > a) return tryParse(stripped.slice(a, b + 1));
  const c = stripped.indexOf('['), d = stripped.lastIndexOf(']');
  if (c >= 0 && d > c) {
    return tryParse(stripped.slice(c, d + 1));
  }
  return null;
}

/**
 * Whichever key it used for the list. Told to call it `beds`, but a model that
 * decides on `predictions` or `objects` is not wrong enough to throw away, and
 * a bare array is fine too.
 */
export function bedList(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object') return [];
  for (const k of ['beds', 'predictions', 'objects', 'detections', 'items', 'results', 'boxes']) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  // A single bed returned unwrapped.
  return Object.keys(obj).some((k) => /^(x0|colFrom|x)$/.test(k)) ? [obj] : [];
}

/** A rejected entry as a short string. Never as an object — see replyToPayload. */
function describe(v) {
  try { return JSON.stringify(v).slice(0, 200); } catch { return String(v).slice(0, 200); }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numArray4 = (v) => Array.isArray(v) && v.length === 4 && v.every((n) => num(n) != null);
const num = (v) => (isNum(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null));

/**
 * One reply entry -> a corner rect in the pixel space of the image AS SENT.
 * Accepts the three arm shapes plus the near-misses models actually produce:
 * `bbox`/`box` arrays, `cells:["C4","F6"]`, and centre-plus-size.
 */
export function rectFromReply(b, spec) {
  if (!b || typeof b !== 'object') return null;

  // Cell references, in any of the forms the prompt could be misread into.
  if (b.colFrom != null && b.rowFrom != null) {
    return cellRangeToRect({ colFrom: b.colFrom, colTo: b.colTo ?? b.colFrom,
                             rowFrom: b.rowFrom, rowTo: b.rowTo ?? b.rowFrom }, spec);
  }
  if (Array.isArray(b.cells) && b.cells.length) {
    const refs = b.cells.map(parseCellRef).filter(Boolean);
    if (!refs.length) return null;
    const cs = refs.map((r) => r.col), rs = refs.map((r) => r.row);
    return cellRangeToRect({ colFrom: Math.min(...cs), colTo: Math.max(...cs),
                             rowFrom: Math.min(...rs) + 1, rowTo: Math.max(...rs) + 1 }, spec);
  }

  const x0 = num(b.x0), y0 = num(b.y0), x1 = num(b.x1), y1 = num(b.y1);
  if (x0 != null && y0 != null && x1 != null && y1 != null) {
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }

  // ARRAY FORMS ARE AMBIGUOUS and are resolved BY NAME, exactly as
  // furniture.js resolves them: `xyxy` is corners, `bbox`/`box` is top-left
  // plus size. There is no way to tell [10,20,30,50] apart by inspection, and
  // a clever heuristic here that disagreed with the sibling parser would make
  // the same array mean two different things in two files — which is worse
  // than either convention. The prompt asks for named x0/y0/x1/y1, so these
  // are fallbacks for a model that ignored it, not the main road.
  const xyxy = [b.xyxy].find((v) => numArray4(v));
  if (xyxy) {
    const [a, c, d, e] = xyxy.map(num);
    return { x0: Math.min(a, d), y0: Math.min(c, e), x1: Math.max(a, d), y1: Math.max(c, e) };
  }
  const xywh = [b.bbox, b.box, b.xywh].find((v) => numArray4(v));
  if (xywh) {
    const [a, c, d, e] = xywh.map(num);
    return { x0: a, y0: c, x1: a + d, y1: c + e };
  }

  const cx = num(b.x), cy = num(b.y), bw = num(b.width), bh = num(b.height);
  if (cx != null && cy != null && bw != null && bh != null) {
    return { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
  }
  return null;
}

/**
 * A reply -> EXACTLY the payload shape api/detect.js already relays from
 * Roboflow, so furniture.js parses it with no changes at all: the centre form
 * under a `predictions` array, with the size of the image the boxes are in
 * declared as a sibling `image`.
 *
 * That sameness is the point of this whole file. Every guard downstream — the
 * confidence floor, the >60% and <0.4% area rejects, the in-room filter, the
 * IoU de-dup, the 0.25ft pad, the rejection list in the sidebar — applies to
 * the OpenAI route for free and cannot drift, because it is not duplicated.
 *
 * `room` and `note` ride along unused. Nothing downstream reads them yet; they
 * are what a later "which of these is the master bedroom" question is made of,
 * and they cost nothing to carry.
 */
export function replyToPayload(text, { w, h, spec = null, arm = DEFAULT_ARM } = {}) {
  const obj = extractJson(text);
  const list = bedList(obj);
  const predictions = [];
  const skipped = [];

  for (const b of list) {
    const r = rectFromReply(b, spec || gridSpec({ w, h }));
    // `raw` is a STRING, not the object. furniture.js's collectPredictions()
    // walks for geometry rather than for a key, so a rejected entry left here
    // as an object gets re-examined downstream and can come back as a
    // prediction — which makes this list a lie about what did not become a
    // zone. Flattening it to text makes it inert.
    if (!r) { skipped.push({ raw: describe(b), reason: 'no readable box in this entry' }); continue; }

    // UNITS. Only this module knows the arm was asked for fractions, so the
    // resolution happens here rather than being left to furniture.js.
    //
    // The gate used to be `every value within [0, 1]`, and that was a silent
    // bug with teeth: a bed flush against the left wall comes back as
    // x0 = -0.004, one value falls outside, the whole box is reinterpreted as
    // PIXELS, and a 0.35px-wide box is dropped downstream as "too small to be
    // furniture". The bed vanishes and the UI blames the detector. So the test
    // is now a tolerant band and the values are CLAMPED, which is the answer
    // the model meant.
    //
    // Percent is handled for the same reason. A bounds reply of
    // {17, 30, 39, 62} can only be percent — read as pixels it is a bed 22px
    // wide on a 1600px plan, which the area floor would throw away, reported as
    // "found nothing" rather than "wrong units". That is exactly the failure
    // this whole units block exists to prevent.
    const vals = [r.x0, r.y0, r.x1, r.y1];
    const hi = Math.max(...vals.map(Math.abs));
    let unit = 1;                                     // pixels
    if (arm === 'bounds') {
      if (hi <= 1.05) unit = 0;                       // fractions
      else if (hi <= 100.5) unit = 100;               // percent
    }
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const s = unit === 0
      ? { x0: clamp01(r.x0) * w, y0: clamp01(r.y0) * h, x1: clamp01(r.x1) * w, y1: clamp01(r.y1) * h }
      : unit === 100
        ? { x0: clamp01(r.x0 / 100) * w, y0: clamp01(r.y0 / 100) * h,
            x1: clamp01(r.x1 / 100) * w, y1: clamp01(r.y1 / 100) * h }
        : r;

    const width = s.x1 - s.x0, height = s.y1 - s.y0;
    if (!(width > 0 && height > 0)) { skipped.push({ raw: describe(b), reason: 'zero-area box' }); continue; }

    predictions.push({
      // Roboflow's convention: x,y is the CENTRE. Getting this wrong puts the
      // zone half a bed off and looks like a bad model rather than bad
      // arithmetic — furniture.js has a test for it, and so does this.
      x: s.x0 + width / 2,
      y: s.y0 + height / 2,
      width,
      height,
      confidence: num(b.confidence) ?? num(b.score) ?? 0.75,
      // ALWAYS 'bed'. The prompt asks about nothing else, so whatever word the
      // model volunteered is a description, not a class — and a reply of
      // "double bed" or "bed (king)" set as the class is rejected downstream
      // as "not a class we zone", which is a detection thrown away over a
      // synonym. Its own word is kept as `label`, where nothing filters on it.
      class: 'bed',
      label: b.class ?? b.label ?? null,
      room: b.room ?? null,
      note: b.note ?? null,
      unit: unit === 0 ? 'fraction' : unit === 100 ? 'percent' : 'pixel',
    });
  }

  return { image: { width: w, height: h }, predictions, skipped, arm };
}
