// ---------------------------------------------------------------------------
// roomTypes.js — what kind of space is this, and what does that entitle it to?
//
// Everything downstream of the ambient grid is CONDITIONAL on the answer. A
// bedroom gets bedside sconces; a store cupboard gets nothing. A conference
// room gets a spot over the table; a toilet gets its basin sconces and no spot
// at all. Before this existed the user picked a room and pressed a button, one
// room at a time, and had to know themselves which passes were worth running.
//
// THE PROJECT TYPE COMES FIRST, and it is asked of the person rather than
// guessed. "Is this a flat or a hotel floor?" is a question a plan often cannot
// answer — twelve identical rooms off a corridor are a hotel, a hostel or a
// student block, and the lighting differs — and it is one question, once, that
// makes every classification after it much easier. A model told "this is an
// office" does not have to wonder whether the room with one desk is a study or
// a chamber.
//
// WHAT EACH TYPE IS ENTITLED TO is a property of the type, not a list of ids
// somewhere in App.jsx. `accent` and `spots` are the two gates, and putting
// them here means the rule and the vocabulary cannot drift apart.
//
// PURE. No fetch, no browser.
// ---------------------------------------------------------------------------

import { extractJson, DEFAULT_MODEL } from './openaiDetect.js';

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

export { DEFAULT_MODEL };

/** Shorthand: the four things a habitable, decorated room gets. */
const FULL = { accent: true, spots: true };
// A ROOM THAT MUST CONTAIN A BED. Not "might" — a bedroom with no bed in it is a
// failed detection, not an unusual bedroom, and that is exactly what makes this
// flag useful: it is the only place in the app that knows the difference between
// "we found nothing" and "we found nothing and that is impossible". The bed
// fallback in App.jsx reads it and asks again, room by room, on a crop.
//
// Held here rather than as a list of ids in the pipeline for the reason in this
// file's header: the vocabulary and the rules that act on it cannot be allowed
// to drift apart.
const SLEEPS = { bed: true };
const NONE = { accent: false, spots: false };
// A toilet gets its basin sconces and nothing aimed: there is no task surface
// in a WC that a directional spot would help with, and one over a basin is
// glare in a mirror.
const WET = { accent: true, spots: false };

const COMMON = [
  { id: 'toilet', label: 'Toilet', ...WET,
    plan: 'a small room with a WC drawn as a rounded oval-on-a-box, often a basin and sometimes a shower tray or a bath' },
  { id: 'corridor', label: 'Corridor', ...NONE,
    plan: 'a long narrow space connecting other rooms, with doors off it and no furniture' },
  { id: 'staircase', label: 'Staircase', ...NONE,
    plan: 'a run of parallel lines for the treads, usually with an arrow or a break line across them' },
  { id: 'store', label: 'Store', ...NONE,
    plan: 'a small room with no window and no fixtures, often with shelving lines against the walls' },
  { id: 'other', label: 'Other', ...NONE,
    plan: 'anything that is clearly none of the above' },
];

/**
 * The vocabulary, per project type.
 *
 * Deliberately SHORT lists. A classifier picking one of nine is a different and
 * much more reliable job than one picking from thirty, and a long tail of types
 * nobody acts on differently is a long tail of ways to be wrong for no benefit.
 */
export const PROJECT_TYPES = [
  {
    id: 'residential', label: 'Residential',
    blurb: 'A flat, a house, a villa',
    rooms: [
      { id: 'bedroom', label: 'Bedroom', ...FULL, ...SLEEPS,
        plan: 'a bed — a plain rectangle with pillows along one short edge — usually with a wardrobe against a wall' },
      { id: 'living_space', label: 'Living space', ...FULL,
        plan: 'the family space: sofas, a coffee table, a TV unit, or a dining table with chairs round it. Living, dining and family rooms are all this one type' },
      { id: 'kitchen', label: 'Kitchen', ...NONE,
        plan: 'counters running along the walls with a sink, a hob drawn as four small circles, and often an island' },
      { id: 'foyer', label: 'Foyer', ...NONE,
        plan: 'a small entrance space just inside the main door, sometimes with a shoe unit or a console' },
      { id: 'balcony', label: 'Balcony', ...NONE,
        plan: 'a space outside the building line, usually long and narrow with a railing drawn as a thin double line' },
      { id: 'utility', label: 'Utility', ...NONE,
        plan: 'a small service space with a washing machine or a sink, often off the kitchen' },
      { id: 'pooja_room', label: 'Pooja room', ...NONE,
        plan: 'a very small room, often with a raised platform or a niche drawn against one wall' },
      ...COMMON,
    ],
  },
  {
    id: 'office', label: 'Office',
    blurb: 'A workplace, a studio, a corporate floor',
    rooms: [
      { id: 'office_chamber', label: 'Office chamber', ...FULL,
        plan: 'a private room with ONE desk, a chair behind it and often two visitor chairs facing it' },
      { id: 'office_workspace', label: 'Workspace', ...NONE,
        plan: 'open plan: rows or clusters of identical desks, many of them' },
      { id: 'conference_room', label: 'Conference room', ...FULL,
        plan: 'one long table ringed by eight or more chairs, usually the only thing in its room' },
      { id: 'reception', label: 'Reception', ...NONE,
        plan: 'a counter near the entrance, often with a seating group in front of it' },
      { id: 'pantry', label: 'Pantry', ...NONE,
        plan: 'a small service space with a counter and a sink, sometimes a table' },
      { id: 'server_room', label: 'Server room', ...NONE,
        plan: 'a small room with racks drawn as a row of deep rectangles against a wall' },
      ...COMMON,
    ],
  },
  {
    id: 'hotel', label: 'Hotel',
    blurb: 'Guest floors, lobby, banquet',
    rooms: [
      { id: 'guest_room', label: 'Guest room', ...FULL, ...SLEEPS,
        plan: 'a bed with a wardrobe and usually its own toilet off it. One of many similar rooms along a corridor' },
      { id: 'suite', label: 'Suite', ...FULL, ...SLEEPS,
        plan: 'a guest room with a separate sitting area — a sofa and a coffee table as well as the bed' },
      { id: 'lobby', label: 'Lobby', ...FULL,
        plan: 'a large public space with a reception counter and loose seating groups' },
      { id: 'banquet', label: 'Banquet hall', ...FULL,
        plan: 'a large open hall, often with no fixed furniture at all, sometimes with round tables' },
      { id: 'back_of_house', label: 'Back of house', ...NONE,
        plan: 'service space: a kitchen, a laundry, a housekeeping store, plant' },
      ...COMMON,
    ],
  },
  {
    id: 'restaurant', label: 'Restaurant',
    blurb: 'Dining rooms, bar, café',
    rooms: [
      { id: 'dining_area', label: 'Dining area', ...FULL,
        plan: 'several tables with chairs round them, laid out across the floor' },
      { id: 'private_dining', label: 'Private dining', ...FULL,
        plan: 'one table in a room of its own' },
      { id: 'bar', label: 'Bar', ...FULL,
        plan: 'a long counter with stools along one side and bottle shelving behind it' },
      { id: 'kitchen', label: 'Kitchen', ...NONE,
        plan: 'a commercial kitchen: long runs of counter, ranges, and a wash area' },
      { id: 'waiting', label: 'Waiting', ...NONE,
        plan: 'a small seating area near the entrance, often with a host counter' },
      ...COMMON,
    ],
  },
  {
    id: 'educational', label: 'Educational',
    blurb: 'A school, a college, a training centre',
    rooms: [
      { id: 'classroom', label: 'Classroom', ...NONE,
        plan: 'rows of small desks all facing one end of the room' },
      { id: 'lecture_hall', label: 'Lecture hall', ...NONE,
        plan: 'a large room with tiered or curved rows of seating facing a podium' },
      { id: 'laboratory', label: 'Laboratory', ...NONE,
        plan: 'long benches in rows, often with sinks drawn along them' },
      { id: 'library', label: 'Library', ...FULL,
        plan: 'rows of shelving with reading tables between or beside them' },
      { id: 'office_chamber', label: 'Staff chamber', ...FULL,
        plan: 'a private room with one desk and a chair behind it' },
      { id: 'canteen', label: 'Canteen', ...FULL,
        plan: 'many tables with chairs, and usually a servery counter along one side' },
      ...COMMON,
    ],
  },
];

export const PROJECT_BY_ID = Object.fromEntries(PROJECT_TYPES.map((p) => [p.id, p]));

/** The room vocabulary for a project, and the lookup for one of its types. */
export const roomsFor = (projectId) => PROJECT_BY_ID[projectId]?.rooms ?? [];
export const roomTypeIn = (projectId, typeId) =>
  roomsFor(projectId).find((r) => r.id === typeId) ?? null;

/** The two gates. Unknown type means we know nothing, so we do nothing. */
export const wantsAccents = (projectId, typeId) => !!roomTypeIn(projectId, typeId)?.accent;
export const wantsSpots = (projectId, typeId) => !!roomTypeIn(projectId, typeId)?.spots;
/**
 * Should this kind of space contain a bed?
 *
 * Used for one thing: deciding that "no beds found here" is a CONTRADICTION
 * rather than a result. On a whole-floor plan both detectors routinely miss beds
 * — a six-bedroom villa downscaled to 1600px gives each mattress a few dozen
 * pixels — and the fallback re-asks on a crop of just that room.
 */
export const expectsBed = (projectId, typeId) => !!roomTypeIn(projectId, typeId)?.bed;

/**
 * WHAT ONE CELL SHOULD COVER, where it is not the usual 50 sqft.
 *
 * A kitchen wants about twice the light of a living space, and the only lever
 * this engine has for "more light" is a smaller cell: halve the area a cell
 * covers and you double the number of fittings over it, which doubles the
 * lumens landing on the floor. 25 sqft is 50 halved and nothing more subtle
 * than that.
 *
 * It is a PROXY and worth naming as one. The quantity the standards are written
 * in is lux, and this engine has never worked in lux — `targetArea: 50` is an
 * assertion, not a calculation, and 25 is the same assertion doubled. Rough
 * arithmetic on the current spec (900 lm over 50 sqft, a utilisation factor
 * around 0.7 and a maintenance factor of 0.8) puts a normal room near 100 lux
 * at the working plane, so a kitchen at 25 sqft lands near 200 — short of the
 * 300 a kitchen is usually specified at. Halving the cell is the change worth
 * making first because it is one number; getting to 300 honestly means making
 * lumens an INPUT to the layout rather than a figure the Result panel reports
 * afterwards, and that is a different piece of work.
 *
 * Two things to watch on a small kitchen, both consequences of the acceptance
 * band being sized for 50:
 *   * `areaTol` is ±25%, so at 25 the band is 18.75 to 31.25 sqft. An 8 x 10
 *     kitchen divides 2x2 into 20 sqft cells (inside, barely) or 1x3 into
 *     26.7 sqft cells at 2.4:1, which the squareness term dislikes. At 50 the
 *     room is large relative to the cell and there is always a comfortable
 *     division; at 25 the room's own quantisation starts to decide.
 *   * `minLightSpacing` is 3.9 ft. A galley narrow enough to want two columns
 *     of 5 ft cells is fine; one wanting two columns in 7 ft is not.
 *
 * Both are refusals with reasons attached rather than silent failures, so a
 * kitchen that comes out wrong will say why.
 */
export const TARGET_AREA_BY_TYPE = { kitchen: 25, toilet: 18 };

/** The override for a type, or null for "lit like anywhere else". */
export const targetAreaFor = (typeId) => TARGET_AREA_BY_TYPE[typeId] ?? null;

/**
 * WHICH CATALOGUE LINE A ROOM'S GRID LIGHTS ARE BOUGHT AS.
 *
 * The planner emits `small` and `large`, and those are GEOMETRY — a small light
 * is one centred in a cell, a large one serves a pair. Nothing about the layout
 * says what you buy, and the two questions have been conflated because for most
 * rooms there is only one answer.
 *
 * A toilet is where they come apart. Its cells are 18 sqft rather than 50, which
 * is a cell about 4.2 ft square, and a 36-degree 7 W fitting over a cell that
 * size throws most of its cone onto the walls. So the same position gets a
 * NARROWER, SMALLER lamp: 5 W at 30 degrees. The grid is unchanged — this maps a
 * light that already exists onto a different product.
 *
 * Keyed by the planner's kind so a type can override one and not the other. The
 * fallback is the kind itself, which is what every other room gets.
 */
export const FIXTURE_BY_TYPE = {
  toilet: { small: 'small-narrow' },
};

/** What to buy for a light of `kind` in a room of `typeId`. */
export const fixtureFor = (typeId, kind) =>
  FIXTURE_BY_TYPE[typeId]?.[kind] ?? kind;

// --- the prompt -------------------------------------------------------------

/**
 * One room, one word back.
 *
 * Deliberately tiny. This runs once per room on upload and the user is watching
 * a loading screen while it does, so it asks for the least that is useful: a
 * type, a confidence and a short reason. No boxes, no furniture list, nothing
 * that would make it slower than the wait it is holding up.
 */
export function buildRoomTypePrompt({ projectId, room = null } = {}) {
  const project = PROJECT_BY_ID[projectId];
  if (!project) throw new Error(`Unknown project type "${projectId}".`);
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const wFt = n(room?.widthFt), hFt = n(room?.heightFt), aFt = n(room?.areaSqft);

  const label = typeof room?.name === 'string' && room.name.trim()
    // The drawing's OWN text, where it has any. A plan that says "MASTER
    // BEDROOM" has already answered the question, and passing the label is
    // free — rooms.js read it out of the DXF on the way in.
    ? `\n\nThe drawing labels this space "${room.name.trim().slice(0, 60)}". That is strong evidence, though not proof — the label may be a room number, a level marker or plain wrong.`
    : '';
  const size = wFt && hFt
    ? `\n\nIt measures roughly ${wFt.toFixed(1)} ft by ${hFt.toFixed(1)} ft (${Math.round(aFt || 0)} sq ft). Size matters here: a 40 sq ft space is not a bedroom whatever else is drawn in it.`
    : '';

  const list = project.rooms
    .map((r) => `  ${r.id}\n      ${r.plan}`).join('\n');

  return `You are looking at one room of an architectural floor plan — a line
drawing seen from above. The room in focus is in the middle of the frame at full
contrast, bounded by the thin green line; the rest of the sheet is faded back so
you can see it is a plan. Ignore the small grey circles, which are ceiling lights
already laid out.

THIS IS A ${project.label.toUpperCase()} PROJECT (${project.blurb.toLowerCase()}).

Say which ONE of these the space is:

${list}${label}${size}

Pick the single best fit. If two are close, pick the one the FURNITURE supports
rather than the one the size suggests — a small room with a bed in it is a
bedroom, not a store.

COMMIT. Nearly every room on a plan IS one of the things on that list, and a
moderate confidence on a real reading is far more useful than a shrug: the
number is carried through and shown to the person using this, who can see it and
disagree. Reach for "other" only when the space genuinely is none of them — a
shaft, a duct, a void, a bare rectangle with nothing in it — and never because
you are torn between two that are on the list. If you are torn, pick one and say
0.5.

What you must NOT do is force a room into a category that contradicts what is
drawn in it. Wrong is worse than unsure; unsure is much better than nothing.

Return ONLY a JSON object. No prose, no markdown fence.

{"type":"<one id from the list>","confidence":0.0,"why":"<one short phrase — what you saw>"}`;
}

export function buildRoomTypeRequest({ plan, projectId, room = null,
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
          // HIGH, not low. This was `low` to make a per-room call cheap, and
          // `low` downsamples to 512px — at which a masked room crop keeps its
          // walls and loses its FURNITURE, so a bed is a grey rectangle. The
          // model then cannot see the one thing the question turns on and
          // answers `other` for every room in the plan, which is exactly what it
          // did. Classification is a looking task; do not economise on the
          // looking.
          image_url: { url: `data:${plan.mime || 'image/jpeg'};base64,${plan.base64}`, detail: 'high' } },
        { type: 'text', text: buildRoomTypePrompt({ projectId, room }) },
      ],
    }],
  };
}

// --- the reply --------------------------------------------------------------

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Whatever it said -> one of ours, or null.
 *
 * Generous in, strict out. A model that answers "Living Room" or "living/dining"
 * has read the plan correctly and differs only in punctuation, and losing that
 * to a string comparison would be losing a right answer to a formatting rule.
 */
export function normaliseRoomType(raw, projectId) {
  if (!raw) return null;
  const ids = roomsFor(projectId).map((r) => r.id);
  const s = String(raw).trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if (ids.includes(s)) return s;
  const loose = s.replace(/_/g, ' ');
  // Longest id first, so `office_chamber` is tried before `office_workspace`
  // cannot match and before any bare substring wins by accident.
  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    if (loose.includes(id.replace(/_/g, ' '))) return id;
  }
  if (/\b(living|family|drawing|dining|lounge)\b/.test(loose) && ids.includes('living_space')) return 'living_space';
  if (/\b(wc|bath|washroom|powder|restroom|lavatory|shower|ensuite)\b/.test(loose) && ids.includes('toilet')) return 'toilet';
  if (/\b(bed|master|guest)\b/.test(loose) && ids.includes('bedroom')) return 'bedroom';
  if (/\b(cabin|chamber|manager|principal|md)\b/.test(loose) && ids.includes('office_chamber')) return 'office_chamber';
  if (/\b(meeting|board)\b/.test(loose) && ids.includes('conference_room')) return 'conference_room';
  if (/\b(passage|lobby corridor|hall way|hallway)\b/.test(loose) && ids.includes('corridor')) return 'corridor';
  return null;
}

export function roomTypeFromReply(text, { projectId } = {}) {
  const obj = extractJson(text);
  const type = normaliseRoomType(obj?.type ?? obj?.room ?? obj?.label, projectId);
  return {
    // `other` rather than null, so a room that could not be read is still a
    // decision the pipeline can act on rather than a hole it has to test for.
    type: type ?? 'other',
    matched: !!type,
    // ZERO WHEN NOTHING MATCHED, whatever number the model volunteered. Its
    // confidence was about a category we then rejected; carrying it forward
    // would display as "90% sure this is Other", which is a confident-sounding
    // claim about the one case where we know nothing at all.
    confidence: type
      ? Math.max(0, Math.min(1, num(obj?.confidence) ?? 0.6))
      : 0,
    why: typeof obj?.why === 'string' ? obj.why.slice(0, 160) : '',
  };
}
