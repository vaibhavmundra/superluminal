// ---------------------------------------------------------------------------
// scale.js — working out pixels-per-foot.
//
// Three routes, in order of how little work they ask of you:
//   1. THE FAN ITSELF. You are already drawing the fan. A ceiling fan is a
//      standard object (1200mm sweep is the default almost everywhere), so the
//      red circle is a free ruler. Zero extra input.
//   2. REFERENCE OBJECT. Drag a line across a door leaf / sofa / bed / WC and
//      pick what it is. Common-sense scaling, with you in the loop.
//   3. AI ESTIMATE. Hand the plan to Claude and let it find a reference object
//      itself. Optional, needs an API key.
// ---------------------------------------------------------------------------

/** Real-world sizes in FEET. Metric equivalents in the label. */
export const REFERENCES = [
  { id: 'fan1200',   group: 'Fan',    label: 'Ceiling fan sweep — 1200mm',      ft: 3.94 },
  { id: 'fan1400',   group: 'Fan',    label: 'Ceiling fan sweep — 1400mm',      ft: 4.59 },
  { id: 'fan900',    group: 'Fan',    label: 'Ceiling fan sweep — 900mm',       ft: 2.95 },
  { id: 'door900',   group: 'Door',   label: 'Internal door — 900mm / 3\'0"',   ft: 3.00 },
  { id: 'door750',   group: 'Door',   label: 'Bathroom door — 750mm / 2\'6"',   ft: 2.50 },
  { id: 'door1050',  group: 'Door',   label: 'Entrance door — 1050mm / 3\'6"',  ft: 3.50 },
  { id: 'door1800',  group: 'Door',   label: 'Double door — 1800mm / 6\'0"',    ft: 6.00 },
  { id: 'sofa3',     group: 'Furniture', label: '3-seat sofa — 2100mm / 7\'0"', ft: 7.00 },
  { id: 'sofa2',     group: 'Furniture', label: '2-seat sofa — 1500mm / 5\'0"', ft: 5.00 },
  { id: 'bedking',   group: 'Furniture', label: 'King bed width — 1800mm / 6\'0"',  ft: 6.00 },
  { id: 'bedqueen',  group: 'Furniture', label: 'Queen bed width — 1500mm / 5\'0"', ft: 5.00 },
  { id: 'bedlen',    group: 'Furniture', label: 'Bed length — 2000mm / 6\'6"',  ft: 6.56 },
  { id: 'dining6',   group: 'Furniture', label: '6-seat dining table — 1800mm', ft: 6.00 },
  { id: 'chair',     group: 'Furniture', label: 'Dining chair — 450mm / 1\'6"', ft: 1.50 },
  { id: 'wc',        group: 'Sanitary', label: 'WC projection — 700mm / 2\'4"', ft: 2.33 },
  { id: 'basin',     group: 'Sanitary', label: 'Wash basin — 550mm / 1\'10"',   ft: 1.83 },
  { id: 'tub',       group: 'Sanitary', label: 'Bathtub — 1700mm / 5\'7"',      ft: 5.58 },
  { id: 'counter',   group: 'Kitchen', label: 'Counter depth — 600mm / 2\'0"',  ft: 2.00 },
  { id: 'fridge',    group: 'Kitchen', label: 'Fridge width — 700mm / 2\'4"',   ft: 2.33 },
  { id: 'car',       group: 'Other',  label: 'Car parking bay length — 5000mm', ft: 16.40 },
  { id: 'tread',     group: 'Other',  label: 'Stair tread — 275mm / 11"',       ft: 0.90 },
  { id: 'wall9',     group: 'Other',  label: 'Brick wall — 230mm / 9"',         ft: 0.75 },
  { id: 'custom',    group: 'Other',  label: 'Custom length…',                  ft: null },
];

// scaleFromFan / scaleFromFans — REMOVED WITH THE DETECTOR THAT FED THEM.
//
// The idea was sound and the input was not: a ceiling fan has a standard blade
// sweep, so a fan's drawn diameter is a ruler. But it required FINDING the fan,
// which meant trusting round red blobs on somebody else's drawing — and a wrong
// ruler is the worst failure this app has, because every room comes out the
// wrong size while still looking exactly like a plan. A door is standard too,
// and asking a person to point at one is a question anybody can answer
// correctly. See doors.js and the note in settings.js.

export function scaleFromReference(pixelLength, realFeet) {
  if (!pixelLength || !realFeet) return null;
  return pixelLength / realFeet;
}

export function describeScale(pxPerFt) {
  if (!pxPerFt) return '—';
  return `${pxPerFt.toFixed(2)} px/ft  ·  1 px = ${(12 / pxPerFt).toFixed(2)} in`;
}

/** Convert a polygon in image pixels to feet, origin at the polygon's min corner. */
export function toFeet(points, pxPerFt, origin) {
  return points.map((p) => ({ x: (p.x - origin.x) / pxPerFt, y: (p.y - origin.y) / pxPerFt }));
}
export function toPixels(points, pxPerFt, origin) {
  return points.map((p) => ({ x: p.x * pxPerFt + origin.x, y: p.y * pxPerFt + origin.y }));
}

// --- optional AI estimate ---------------------------------------------------

const AI_PROMPT = `You are looking at an architectural floor plan. Estimate its drawing scale.

Find ONE clearly identifiable object of standard real-world size. Prefer, in order:
1. A printed scale bar or a written dimension line
2. A door leaf or door swing arc (internal doors are typically 900mm / 3'0")
3. A sanitary fixture (WC projection 700mm, wash basin 550mm, bathtub 1700mm)
4. A bed (queen 1500mm wide, king 1800mm) or a sofa (3-seat 2100mm)
5. A car parking bay (5000 x 2500mm)

Measure that object in PIXELS on the image as given (its pixel width is
{{W}} and height is {{H}}). Then report.

Respond with ONLY a JSON object, no prose, no markdown fence:
{"object":"<what you measured>","realFeet":<number>,"pixelLength":<number>,"pxPerFoot":<number>,"confidence":"high|medium|low","note":"<one short sentence>"}`;

export async function estimateScaleWithAI({ apiKey, imageBase64, mediaType, width, height, model = 'claude-sonnet-4-5' }) {
  if (!apiKey) throw new Error('No API key set.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: AI_PROMPT.replace('{{W}}', width).replace('{{H}}', height) },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse the model response.');
  return JSON.parse(match[0]);
}
