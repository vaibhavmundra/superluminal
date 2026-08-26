// ---------------------------------------------------------------------------
// tools/probe-rooms.mjs — call the ROOM workflow for real and write down what
// it actually said.
//
//   node tools/probe-rooms.mjs                        # the FLOOR_PLAN_03 sample
//   node tools/probe-rooms.mjs path/to/plan.png
//
// Why this exists as a script rather than a browser tab. The parser in
// roomsDetect.js accepts several shapes on purpose — a list of {x,y}, a flat run
// of numbers, an RLE mask, a bare box — because a workflow's output shape is
// whatever its author wired up and there is no way to know from here which one
// this workflow uses. That is a defensible way to write the parser and a bad way
// to leave the knowledge: as soon as one real response has been seen, the shape
// is a fact rather than a hedge.
//
// So this prints THREE things, in order of how useful they are at 2am:
//
//   1. a type sketch of the response, one line per level
//   2. what roomsFromPayload made of it, and what it threw away and why
//   3. an SVG in .detect-debug/ with the polygons drawn over the plan, because
//      "the arithmetic is wrong" and "the model is wrong" look identical in a
//      list of numbers and completely different in a picture
//
// It reads .env.local itself, so it needs no shell setup. It never prints the
// key. Requires network, which the browser has and CI does not — hence a script
// you run rather than a test that runs itself.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { roomsFromPayload } from '../src/lib/roomsDetect.js';
import { bbox, polygonArea } from '../src/lib/geometry.js';

const DEFAULT_ROOMS_URL =
  'https://serverless.roboflow.com/baibhav-mundra/workflows/detect-and-count-objects-in-image';

// --- env, read by hand: no dotenv dependency for one file ------------------
function loadEnv(file = '.env.local') {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Width and height without decoding the image. PNG IHDR, JPEG SOFn. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: 'image/png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry the dimensions.
      if (marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), mime: 'image/jpeg' };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** A compact type sketch, so the shape is legible without scrolling. */
function sketch(node, depth = 0, key = '') {
  const pad = '  '.repeat(depth);
  if (Array.isArray(node)) {
    if (!node.length) return `${pad}${key}: []`;
    return `${pad}${key}: [${node.length} ×\n${sketch(node[0], depth + 1, '0')}\n${pad}]`;
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    const lines = keys.slice(0, 20).map((k) => sketch(node[k], depth + 1, k));
    return `${pad}${key}: {\n${lines.join('\n')}${keys.length > 20 ? `\n${pad}  …${keys.length - 20} more` : ''}\n${pad}}`;
  }
  if (typeof node === 'string') {
    return `${pad}${key}: ${node.length > 60 ? `str(${node.length}) "${node.slice(0, 24)}…"` : JSON.stringify(node)}`;
  }
  return `${pad}${key}: ${typeof node === 'number' ? `number(${node})` : typeof node}`;
}

const collapse = (text) => text.replace(/"[A-Za-z0-9+/=]{200,}"/g,
  (m) => `"<blob ${m.length} chars>"`);

// --- go --------------------------------------------------------------------
const env = { ...loadEnv(), ...process.env };
const key = env.ROBOFLOW_INFERENCE_KEY;
if (!key) {
  console.error('ROBOFLOW_INFERENCE_KEY is not in .env.local or the environment.');
  process.exit(1);
}
const url = env.ROBOFLOW_ROOMS_WORKFLOW_URL || DEFAULT_ROOMS_URL;
const file = process.argv[2] || 'public/samples/FLOOR_PLAN_03.png';
const buf = readFileSync(file);
const size = imageSize(buf);
if (!size) {
  console.error(`Could not read the dimensions of ${file} — PNG and JPEG only.`);
  process.exit(1);
}
const b64 = buf.toString('base64');

console.log(`→ ${file}  ${size.w}×${size.h}  ${(buf.length / 1024).toFixed(0)}KB  ${size.mime}`);
console.log(`→ ${url}`);

// The same two input shapes the server tries, in the same order, so that what
// this learns is true of the app and not just of this script.
const shapes = [
  { image: { type: 'base64', value: b64 } },
  { image: { type: 'base64', value: b64 }, classes: 'room' },
];

let payload = null, used = null;
for (const inputs of shapes) {
  const names = Object.keys(inputs).join('+');
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, inputs }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    console.error(`✗ could not reach it with inputs ${names}: ${err.message}`);
    break;
  }
  const text = await res.text();
  console.log(`← ${res.status} in ${Date.now() - t0}ms with inputs ${names}`);
  if (res.ok) {
    try { payload = JSON.parse(text); used = names; }
    catch { console.error('✗ 200 but the body is not JSON:', text.slice(0, 300)); }
    break;
  }
  // The key never appears in what we print, even if the API echoes it back.
  console.error(`  ${collapse(text).split(key).join('***').slice(0, 600)}`);
  if (res.status === 401 || res.status === 403) break;   // nothing else will help
}
if (!payload) process.exit(1);

mkdirSync('.detect-debug', { recursive: true });
writeFileSync('.detect-debug/rooms-payload.json', JSON.stringify(payload, null, 1));
writeFileSync('.detect-debug/rooms-payload.readable.json',
              collapse(JSON.stringify(payload, null, 1)));

console.log(`\n=== SHAPE (inputs that worked: ${used}) ===`);
console.log(sketch(payload, 0, 'response'));

// --- what the parser made of it -------------------------------------------
const image = { w: size.w, h: size.h };
const { rooms, rejected } = roomsFromPayload(payload, { image });

console.log(`\n=== PARSED: ${rooms.length} room${rooms.length === 1 ? '' : 's'} ===`);
for (const [i, r] of rooms.entries()) {
  const b = bbox(r.pointsPx);
  console.log(`  ${i + 1}. ${r.label ?? '(unnamed)'}  ${r.pointsPx.length} corners`
    + `  ${Math.round(b.w)}×${Math.round(b.h)}px at ${Math.round(b.minX)},${Math.round(b.minY)}`
    + `  ${(Math.abs(polygonArea(r.pointsPx)) / (image.w * image.h) * 100).toFixed(1)}% of the sheet`
    + `  [${r.why}]`);
}
if (rejected.length) {
  console.log(`\n=== DISCARDED: ${rejected.length} ===`);
  for (const r of rejected) console.log(`  - ${r.cls || '?'}: ${r.reason}`);
}
if (!rooms.length) {
  console.log('\nNothing parsed. The shape above is the thing to read: if the');
  console.log('predictions are there but carry neither `points` nor a box, look at');
  console.log('polygonFromPrediction in src/lib/roomsDetect.js — it is the list of');
  console.log('encodings we accept, and it is meant to grow.');
}

// --- the picture ----------------------------------------------------------
// The plan embedded rather than referenced, so the file can be opened from
// anywhere and mailed to anyone.
const COLS = ['#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#14B8A6'];
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${image.w}" height="${image.h}"`,
  ` viewBox="0 0 ${image.w} ${image.h}">`,
  `<image href="data:${size.mime};base64,${b64}" x="0" y="0"`,
  ` width="${image.w}" height="${image.h}" opacity="0.55"/>`,
  ...rooms.map((r, i) => {
    const c = COLS[i % COLS.length];
    const b = bbox(r.pointsPx);
    return `<polygon points="${r.pointsPx.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"`
      + ` fill="${c}" fill-opacity="0.14" stroke="${c}" stroke-width="${Math.max(2, image.w / 400)}"/>`
      + `<text x="${(b.minX + b.maxX) / 2}" y="${(b.minY + b.maxY) / 2}" fill="${c}"`
      + ` font-family="monospace" font-size="${Math.max(12, image.w / 45)}" text-anchor="middle">`
      + `${i + 1}. ${(r.label ?? 'room').replace(/[<&]/g, '')}</text>`;
  }),
  '</svg>',
].join('');
writeFileSync('.detect-debug/rooms-overlay.svg', svg);

console.log('\nWritten:');
console.log('  .detect-debug/rooms-payload.json           the raw response');
console.log('  .detect-debug/rooms-payload.readable.json  the same, blobs collapsed');
console.log('  .detect-debug/rooms-overlay.svg            the polygons over the plan');
