#!/usr/bin/env node
// ---------------------------------------------------------------------------
// eval-detect.mjs — which detector actually finds the bed, and how far off is
// the box.
//
// WHY THIS RUNS BEFORE ANY UI WORK. Adding a second provider to the app is
// half a day and produces a feature that looks like it works. Whether it works
// is a different question, and the answer is a number: how far, in FEET, is the
// zone from the bed. A foot of error is the difference between a zone that
// covers the mattress and a zone that covers the nightstand and half a pillow,
// and you cannot see a foot by glancing at a screenshot. So: measure first,
// wire second, and let the numbers pick the arm.
//
// WHAT IT COMPARES
//
//   roboflow     The incumbent. Same call api/detect.js makes, same workflow.
//   bounds       OpenAI, plain image, one call, answer as 0..1 fractions of
//                the image. The one meant to ship: nothing drawn on the image,
//                and every dimension worked out locally from the fractions.
//   gridPixels   OpenAI, a labelled measuring grid burned onto the image,
//                answer in pixels read off the printed line numbers.
//   gridCells    OpenAI, same overlay, answer as cell references (C4..F6),
//                which we convert. Quantised, so bounded error by construction.
//
// See src/lib/openaiDetect.js for why those three and not others — in short, a
// vision model recognises a bed easily and cannot measure, so every arm is a
// different way of not asking it to measure.
//
// THE MEASUREMENT GOES THROUGH THE REAL PIPELINE. Every response, from either
// provider, is handed to detectionsToZones() out of src/lib/furniture.js — the
// same function App.jsx calls. So the confidence floor, the area rejects, the
// de-dup and the rescale from sent-size back to original pixels are all the
// production ones. A number this prints is a number the app would produce. If
// the eval and the app ever disagree, that is a bug in one of them, not a
// difference in methodology.
//
// USAGE
//
//   node tools/eval-detect.mjs plan.png                        all arms
//   node tools/eval-detect.mjs a.png b.png --arms gridCells,roboflow
//   node tools/eval-detect.mjs plan.png --repeat 3             variance
//   node tools/eval-detect.mjs plan.png --truth truth.json     IoU
//   node tools/eval-detect.mjs plan.png --px-per-ft 26.4       error in feet
//   node tools/eval-detect.mjs --list-models
//   node tools/eval-detect.mjs plan.png --replay .detect-eval/run-3
//
// Keys come from .env.local, the same file the dev server reads:
// OPENAI_API_KEY and ROBOFLOW_INFERENCE_KEY. Nothing is written to it.
//
// GROUND TRUTH. Without it this still runs and still writes the overlays, which
// is enough to eyeball a plan you have never tried before. With it you get IoU
// and an error in feet, which is the only thing that settles an argument.
// Either pass --truth file.json, or drop a sidecar next to the image called
// <name>.truth.json. Boxes are in ORIGINAL image pixels, corners not centres:
//
//   { "beds": [ { "x0": 412, "y0": 260, "x1": 690, "y1": 640 } ] }
//
// Read them off any image viewer that shows a cursor position. Ten minutes of
// this on five plans is what turns "seems decent" into a decision.
//
// TWO HONEST CAVEATS.
//
//   1. Images go up as PNG, not JPEG. The app sends JPEG at quality 0.92 and
//      this has no JPEG encoder (see tools/pnglite.mjs for why there are no
//      dependencies). PNG is the easier image of the two to read, so treat
//      these results as the OPTIMISTIC end. `--jpeg` will shell out to sips or
//      ImageMagick when either is installed, which closes the gap exactly.
//   2. A DXF is not an input here. The vector route renders in the browser
//      (rasterizeForDetection needs a canvas), so evaluate it by loading the
//      DXF in the app, clicking "Save both images" under "What the detector
//      saw", and running this on the PNG that lands in Downloads. That is the
//      real render, which is the point.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Raster } from './pnglite.mjs';
import * as oai from '../src/lib/openaiDetect.js';
import { detectionsToZones, iou } from '../src/lib/furniture.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// --- keys -------------------------------------------------------------------

/**
 * The three lines of dotenv that are actually needed. A dependency for this
 * would be the only dependency in tools/, and `KEY=value` is not hard.
 */
function loadEnvLocal() {
  for (const name of ['.env.local', '.env']) {
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const v = m[2].replace(/^['"]|['"]$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  }
}

// --- args -------------------------------------------------------------------

const ARM_COLOURS = {
  roboflow:   [196, 62, 29, 255],    // rust
  bounds:     [30, 110, 200, 255],   // blue
  gridPixels: [22, 140, 90, 255],    // green
  gridCells:  [150, 60, 180, 255],   // violet
};
const ALL_ARMS = Object.keys(ARM_COLOURS);

function parseArgs(argv) {
  const o = {
    images: [], arms: ALL_ARMS, model: oai.DEFAULT_MODEL, pitch: oai.DEFAULT_PITCH,
    maxDim: 1600, repeat: 1, out: '.detect-eval', truth: null, pxPerFt: null,
    listModels: false, jpeg: false, replay: null, noJsonMode: false, quality: 92,
    pitchFt: null, pitchSet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--arms') o.arms = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--model') o.model = next();
    else if (a === '--pitch') { o.pitch = +next(); o.pitchSet = true; }
    else if (a === '--pitch-ft') o.pitchFt = +next();
    else if (a === '--max-dim') o.maxDim = +next();
    else if (a === '--repeat') o.repeat = +next();
    else if (a === '--out') o.out = next();
    else if (a === '--truth') o.truth = next();
    else if (a === '--px-per-ft') o.pxPerFt = +next();
    else if (a === '--quality') o.quality = +next();
    else if (a === '--list-models') o.listModels = true;
    else if (a === '--jpeg') o.jpeg = true;
    else if (a === '--no-json-mode') o.noJsonMode = true;
    else if (a === '--replay') o.replay = next();
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}. Try --help.`);
    else o.images.push(a);
  }
  const bad = o.arms.filter((x) => !ALL_ARMS.includes(x));
  if (bad.length) throw new Error(`Unknown arm(s): ${bad.join(', ')}. Known: ${ALL_ARMS.join(', ')}.`);
  return o;
}

const HELP = `
node tools/eval-detect.mjs <plan.png> [more.png ...] [options]

  --arms a,b        which of ${ALL_ARMS.join(', ')} (default all)
  --model ID        OpenAI model (default ${oai.DEFAULT_MODEL})
  --list-models     what this key can see, then exit
  --pitch N         grid pitch in px of the sent image (default ${oai.DEFAULT_PITCH})
  --pitch-ft N      grid pitch in FEET instead; needs --px-per-ft. This is
                    usually what you want — see the note on quantisation below
  --max-dim N       long edge the image is sent at (default 1600)
  --repeat N        run each arm N times to see the spread (default 1)
  --truth FILE      ground-truth boxes; or a <name>.truth.json sidecar
  --px-per-ft N     also report the error in feet, which is the number that matters
  --jpeg            send JPEG via sips/ImageMagick instead of PNG, matching the app
  --quality N       JPEG quality when --jpeg (default 92, matching the app)
  --no-json-mode    drop response_format, for a model that rejects it
  --replay DIR      re-run the metrics over a previous run's saved replies, no network
  --out DIR         where images and JSON land (default .detect-eval)
`;

// --- image prep -------------------------------------------------------------

function loadPlan(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(1, 4).toString('ascii') === 'PNG') return Raster.from(buf);
  // A JPEG in is the common case (a phone photo of a plan), and there is no
  // decoder here. Convert with whatever the machine has rather than refusing.
  for (const [bin, args] of [
    ['sips', ['-s', 'format', 'png', file, '--out', '/tmp/eval-detect-in.png']],
    ['magick', [file, '/tmp/eval-detect-in.png']],
    ['convert', [file, '/tmp/eval-detect-in.png']],
  ]) {
    try {
      execFileSync(bin, args, { stdio: 'ignore' });
      return Raster.from(fs.readFileSync('/tmp/eval-detect-in.png'));
    } catch { /* try the next one */ }
  }
  throw new Error(`${path.basename(file)} is not a PNG and no converter was found.`
    + ` Convert it first: sips -s format png "${file}" --out plan.png`);
}

/** The same bound the app applies before sending. */
function forSending(plan, maxDim) {
  const s = Math.min(1, maxDim / Math.max(plan.w, plan.h));
  if (s >= 1) return { img: plan, scale: 1 };
  return { img: plan.resize(Math.max(1, Math.round(plan.w * s)), Math.max(1, Math.round(plan.h * s))), scale: s };
}

const GRID = [70, 130, 200, 105];
const GRID_MAJOR = [40, 90, 170, 165];
const LABEL = [10, 40, 90, 255];
const PLATE = [255, 255, 255, 232];

/**
 * Burn the measuring grid on.
 *
 * The lines are the least important part. What makes this work — if it works —
 * is that there is a PRINTED NUMBER within a few centimetres of every bed
 * edge, so the model can read a coordinate instead of estimating one. Hence
 * the interior labels: an edge-only ruler still leaves it measuring inward
 * from the margin, which is the thing it is bad at.
 *
 * Kept deliberately light. Too heavy and the grid becomes the most salient
 * thing in the image and the furniture underneath stops being legible — which
 * would be a self-inflicted wound reported as a model failure.
 */
function drawGrid(img, spec, mode) {
  const r = img.clone();
  const every = (i, n) => i % n === 0;

  // LABEL DENSITY IS NOT COSMETIC. At a 2ft pitch on a 20px/ft plan the cells
  // are 40px and a label in every one buries the drawing under its own ruler —
  // the first version of this made the plan genuinely harder to read than the
  // bare image, which would have been reported as the model failing. So labels
  // are strided to whatever the pitch can carry, and the stride is derived
  // rather than guessed: a label needs its own width plus a gutter.
  const widest = Math.max(
    Raster.textWidth(spec.cols[spec.cols.length - 1].label + spec.rows.length, 2),
    Raster.textWidth(String(spec.cols[spec.cols.length - 1].x0), 2));
  const headStride = Math.max(1, Math.ceil((widest + 10) / spec.pitch));
  const major = Math.max(2, headStride * (mode === 'gridCells' ? 2 : 5));

  for (const c of spec.cols) r.vline(c.x0, 0, r.h - 1, every(c.i, major) ? GRID_MAJOR : GRID, 1);
  for (const row of spec.rows) r.hline(row.y0, 0, r.w - 1, every(row.i, major) ? GRID_MAJOR : GRID, 1);

  // Header strips. Centred in their cell when there is room, left-aligned when
  // there is not, and skipped entirely on the lines between strides.
  const head = (label, x, y) => r.text(label, x, y, LABEL, 2, PLATE);
  for (const c of spec.cols) {
    if (!every(c.i, headStride)) continue;
    const label = mode === 'gridCells' ? c.label : String(c.x0);
    const w = Raster.textWidth(label, 2);
    head(label, Math.min(r.w - w - 2, c.x0 + Math.max(2, (spec.pitch - w) / 2)), 4);
  }
  for (const row of spec.rows) {
    if (!every(row.i, headStride)) continue;
    const label = mode === 'gridCells' ? row.label : String(row.y0);
    head(label, 3, Math.min(r.h - Raster.textHeight(2) - 2,
                            row.y0 + Math.max(2, (spec.pitch - Raster.textHeight(2)) / 2)));
  }

  // Interior labels. THE WHOLE MECHANISM, in one loop: a reference printed
  // within a few centimetres of every bed edge, so the answer is something to
  // read rather than a distance to estimate. An edge-only ruler leaves the
  // model measuring inward from the margin, which is the thing it cannot do.
  const inStride = Math.max(1, Math.ceil((mode === 'gridCells' ? 74 : 170) / spec.pitch));
  for (const row of spec.rows) {
    if (!every(row.i, inStride)) continue;
    for (const c of spec.cols) {
      if (!every(c.i, inStride)) continue;
      if (!c.i && !row.i) continue;                       // the header already says 0
      const label = mode === 'gridCells' ? `${c.label}${row.label}` : `${c.x0}-${row.y0}`;
      r.text(label, c.x0 + 3, row.y0 + 3, [95, 115, 155, 205], 1, [255, 255, 255, 170]);
    }
  }
  if (mode !== 'gridCells') r.text('0-0', 3, 3, LABEL, 2, PLATE);
  return r;
}

/** PNG by default; JPEG when asked and a converter exists, matching the app. */
function encodeForSend(raster, { jpeg, quality }) {
  const png = raster.toPng();
  if (!jpeg) return { buf: png, mime: 'image/png' };
  const inF = '/tmp/eval-detect-send.png', outF = '/tmp/eval-detect-send.jpg';
  fs.writeFileSync(inF, png);
  for (const [bin, args] of [
    ['sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), inF, '--out', outF]],
    ['magick', [inF, '-quality', String(quality), outF]],
    ['convert', [inF, '-quality', String(quality), outF]],
  ]) {
    try { execFileSync(bin, args, { stdio: 'ignore' }); return { buf: fs.readFileSync(outF), mime: 'image/jpeg' }; }
    catch { /* next */ }
  }
  console.warn('  ! --jpeg asked for but no sips/ImageMagick found; sending PNG.');
  return { buf: png, mime: 'image/png' };
}

// --- providers --------------------------------------------------------------

async function callOpenAI({ arm, base64, mime, w, h, spec, opt }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set (looked in .env.local).');
  const body = oai.buildRequest({
    arm, base64, mime, w, h, spec, model: opt.model, jsonMode: !opt.noJsonMode,
  });
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`OpenAI ${res.status} in ${ms}ms: ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  return { ms, reply: oai.textFromResponse(json), usage: json.usage ?? null, raw: json };
}

/**
 * Roboflow through OUR OWN handler rather than through its URL. api/detect.js
 * is where the URL fallback, the size guard and the key scrubbing live, so
 * calling past it would be measuring a code path that does not ship.
 */
async function callRoboflow({ base64, mime, opt }) {
  if (!process.env.ROBOFLOW_INFERENCE_KEY) throw new Error('ROBOFLOW_INFERENCE_KEY is not set.');
  const { default: handler } = await import('../api/detect.js');
  const res = {
    statusCode: 200, body: '', headersSent: false,
    setHeader() {}, end(b) { this.body = b || ''; this.headersSent = true; },
  };
  const t0 = Date.now();
  await handler({ method: 'POST', body: { image: base64, mime, classes: 'bed' } }, res);
  const ms = Date.now() - t0;
  const json = JSON.parse(res.body || '{}');
  if (res.statusCode !== 200) throw new Error(`detect handler ${res.statusCode}: ${JSON.stringify(json).slice(0, 300)}`);
  return { ms, payload: json.result, meta: json.meta ?? null };
}

// --- metrics ----------------------------------------------------------------

/**
 * Greedy best-IoU matching, truth first. Greedy rather than optimal because
 * beds do not overlap each other, so the two answers coincide and greedy is
 * legible.
 */
function match(preds, truth) {
  const used = new Set();
  const rows = truth.map((t) => {
    let best = null, bestIou = 0;
    preds.forEach((p, i) => {
      if (used.has(i)) return;
      const v = iou(t, p.rect);
      if (v > bestIou) { bestIou = v; best = i; }
    });
    if (best != null && bestIou > 0) used.add(best);
    return { truth: t, pred: best == null ? null : preds[best], iou: bestIou };
  });
  return { rows, spurious: preds.filter((_, i) => !used.has(i)) };
}

/**
 * THE CEILING. A grid arm answers in whole cells, so its box is quantised
 * before the model has said anything — gridCells rounds outward on all four
 * sides, and no amount of model skill gets that back. Quantising the GROUND
 * TRUTH the same way gives the best IoU the arm could ever score.
 *
 * Printing it next to the result is what stops the table lying. "gridCells
 * 0.44" reads as a bad model; "gridCells 0.44, ceiling 0.44" says the model
 * was perfect and the METHOD is the limit, which is a completely different
 * conclusion and points at a completely different fix.
 */
function armCeiling(arm, truth, spec, scale) {
  if (arm !== 'gridCells' || !truth.length) return null;
  const q = truth.map((t) => {
    // Truth is in original pixels; the grid lives in the sent image's space.
    const r = { x0: t.x0 * scale, y0: t.y0 * scale, x1: t.x1 * scale, y1: t.y1 * scale };
    const snap = (v, arr, key0, key1) => {
      const cell = arr.find((c) => v >= c[key0] && v < c[key1]) ?? arr[arr.length - 1];
      return cell;
    };
    const a = snap(r.x0, spec.cols, 'x0', 'x1'), b = snap(r.x1 - 0.001, spec.cols, 'x0', 'x1');
    const c = snap(r.y0, spec.rows, 'y0', 'y1'), d = snap(r.y1 - 0.001, spec.rows, 'y0', 'y1');
    return { x0: a.x0 / scale, y0: c.y0 / scale, x1: b.x1 / scale, y1: d.y1 / scale };
  });
  const ious = truth.map((t, i) => iou(t, q[i]));
  return ious.reduce((a, b) => a + b, 0) / ious.length;
}

const centre = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function scoreArm(zones, truth, pxPerFt) {
  const preds = zones.map((z) => ({ rect: z.rect, conf: z.conf, cls: z.cls }));
  if (!truth.length) return { preds, found: preds.length, rows: [], spurious: [] };
  const { rows, spurious } = match(preds, truth);
  const hits = rows.filter((r) => r.iou >= 0.5).length;
  const ious = rows.map((r) => r.iou);
  const offsets = rows.filter((r) => r.pred).map((r) => dist(centre(r.truth), centre(r.pred.rect)));
  return {
    preds, found: preds.length, rows, spurious,
    recall: hits / truth.length,
    precision: preds.length ? hits / preds.length : 0,
    meanIou: ious.reduce((a, b) => a + b, 0) / (ious.length || 1),
    worstIou: ious.length ? Math.min(...ious) : 0,
    meanOffsetPx: offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : null,
    meanOffsetFt: offsets.length && pxPerFt
      ? offsets.reduce((a, b) => a + b, 0) / offsets.length / pxPerFt : null,
  };
}

// --- overlay ----------------------------------------------------------------

/**
 * The picture that makes a number arguable. Ground truth dashed black,
 * predictions in the arm's colour, and every box labelled with its confidence
 * and its IoU — because "0.42" tells you it is half a bed off and the picture
 * tells you WHICH half, which is the part that suggests the fix.
 */
function overlay(plan, { truth, score, arm, title }) {
  const r = plan.clone().fade(0.55);
  const col = ARM_COLOURS[arm];

  for (const t of truth) {
    r.strokeRect(Math.round(t.x0), Math.round(t.y0), Math.round(t.x1), Math.round(t.y1),
                 [20, 20, 20, 255], 2, 7);
  }
  score.preds.forEach((p) => {
    const b = p.rect;
    r.strokeRect(Math.round(b.x0), Math.round(b.y0), Math.round(b.x1), Math.round(b.y1), col, 3);
    const row = score.rows.find((x) => x.pred && x.pred.rect === b);
    const label = `${p.cls} ${(p.conf ?? 0).toFixed(2)}`
      + (row ? ` IOU ${row.iou.toFixed(2)}` : truth.length ? ' UNMATCHED' : '');
    const ty = Math.max(2, Math.round(b.y0) - Raster.textHeight(2) - 6);
    r.text(label, Math.round(b.x0) + 2, ty, col, 2, PLATE);
  });
  r.text(title, 8, 8, [0, 0, 0, 255], 3, PLATE);
  return r;
}

// --- run --------------------------------------------------------------------

async function listModels() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set (looked in .env.local).');
  const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const ids = (await res.json()).data.map((m) => m.id).sort();
  const likely = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|whisper|embedding|moderation|image/.test(id));
  console.log(`\n${likely.length} plausible vision-capable models:\n`);
  for (const id of likely) console.log(`  ${id}`);
  console.log(`\n(${ids.length} total. Pass one with --model.)\n`);
}

function readTruth(imageFile, truthFile) {
  const pick = (obj, key) => {
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj?.beds)) return obj.beds;
    if (Array.isArray(obj?.[key])) return obj[key];
    if (Array.isArray(obj?.[key]?.beds)) return obj[key].beds;
    return null;
  };
  const base = path.basename(imageFile);
  if (truthFile && fs.existsSync(truthFile)) {
    const got = pick(JSON.parse(fs.readFileSync(truthFile, 'utf8')), base);
    if (got) return got;
  }
  const sidecar = imageFile.replace(/\.[^.]+$/, '') + '.truth.json';
  if (fs.existsSync(sidecar)) {
    const got = pick(JSON.parse(fs.readFileSync(sidecar, 'utf8')), base);
    if (got) return got;
  }
  return [];
}

/** A truth file may declare the drawing's scale; if it does, use it. */
function readTruthPxPerFt(imageFile, truthFile) {
  for (const f of [truthFile, imageFile.replace(/\.[^.]+$/, '') + '.truth.json']) {
    if (!f || !fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const v = j.pxPerFt ?? j[path.basename(imageFile)]?.pxPerFt;
      if (typeof v === 'number' && v > 0) return v;
    } catch { /* a malformed truth file is the caller's problem, not a crash here */ }
  }
  return null;
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d));

async function main() {
  loadEnvLocal();
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log(HELP); return; }
  if (opt.listModels) return listModels();
  if (!opt.images.length) { console.log(HELP); throw new Error('No image given.'); }

  const outDir = path.isAbsolute(opt.out) ? opt.out : path.join(ROOT, opt.out);
  fs.mkdirSync(outDir, { recursive: true });

  if (opt.replay) {
    console.log(`\n  REPLAY — reading recorded replies from ${opt.replay}. No API calls, no cost.`);
    console.log('  The fixtures in tools/eval-fixtures are SYNTHETIC and derived from the'
      + '\n  truth file: they prove the arithmetic and the overlays, not the model. For a real'
      + '\n  number, drop the --replay flag.');
  }

  const summary = [];

  for (const file of opt.images) {
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    const plan = loadPlan(file);
    const truth = readTruth(file, opt.truth);
    const { img: sent, scale } = forSending(plan, opt.maxDim);

    console.log(`\n${'='.repeat(72)}`);
    console.log(`${path.basename(file)}  ${plan.w}x${plan.h}`
      + `${scale < 1 ? ` -> sending ${sent.w}x${sent.h}` : ''}`
      + `  truth: ${truth.length ? `${truth.length} box(es)` : 'none — overlays only'}`);
    console.log('='.repeat(72));

    // PITCH IS A REAL-WORLD LENGTH, NOT A PIXEL COUNT — the same lesson the
    // wall stroke weight already learned. px/ft varies by an order of
    // magnitude between an apartment and a site plan, and the thing that
    // matters is how many FEET of error a cell is worth. A 100px cell is 5ft
    // on a 20px/ft plan, which is most of a bed: the gridCells arm cannot
    // possibly return a tight box at that pitch, and would be blamed for it.
    //
    // So when the scale is known, derive the pitch from it and aim for ~2ft.
    // Two feet is the compromise: the label still fits inside a cell at the
    // small text size, and the worst-case quantisation error is bounded at
    // one cell rather than most of the mattress.
    const truthPxPerFt = opt.pxPerFt ?? readTruthPxPerFt(file, opt.truth);
    let pitch = opt.pitch;
    if (opt.pitchFt || (!opt.pitchSet && truthPxPerFt)) {
      const wantFt = opt.pitchFt || 2;
      if (!truthPxPerFt) throw new Error('--pitch-ft needs --px-per-ft (or a pxPerFt in the truth file).');
      pitch = Math.max(16, Math.round(wantFt * truthPxPerFt * scale));
      console.log(`  grid pitch ${pitch}px = ${wantFt}ft at ${truthPxPerFt}px/ft`
        + `${scale < 1 ? ` (x${scale.toFixed(3)} downscale)` : ''}`);
    }
    const spec = oai.gridSpec({ w: sent.w, h: sent.h, pitch });

    for (const arm of opt.arms) {
      const needsGrid = arm === 'gridPixels' || arm === 'gridCells';
      // THE TWO GRID ARMS WANT DIFFERENT PITCHES, and this is the eval's first
      // real finding rather than a preference. gridPixels interpolates between
      // printed numbers, so a fine grid costs it nothing and helps. gridCells
      // rounds OUTWARD to whole cells — "include a cell if any part of the
      // mattress is in it" — so its box is inflated by up to one cell on every
      // side no matter how well the model reads. At 2ft that is a box 4ft too
      // wide, which is a worse answer than a slightly wobbly tight one.
      //
      // So gridCells is given a COARSER grid, where its labels are also
      // legible, and is understood as the arm that returns a reliable centre
      // and a fat box. For a no-light zone that trade is not obviously wrong —
      // over-covering a bed is the safe direction — which is exactly why it is
      // worth measuring instead of arguing about.
      const armSpec = needsGrid
        ? oai.gridSpec({ w: sent.w, h: sent.h,
                         pitch: arm === 'gridCells' ? Math.round(pitch * 2) : pitch })
        : spec;
      const toSend = needsGrid ? drawGrid(sent, armSpec, arm) : sent;
      const { buf, mime } = encodeForSend(toSend, opt);
      const base64 = buf.toString('base64');
      fs.writeFileSync(path.join(outDir, `${stem}-${arm}-sent.${mime === 'image/jpeg' ? 'jpg' : 'png'}`), buf);

      for (let run = 1; run <= opt.repeat; run++) {
        const tag = opt.repeat > 1 ? `${arm}#${run}` : arm;
        let payload = null, ms = 0, reply = null, usage = null, error = null;

        try {
          if (opt.replay) {
            const f = path.join(opt.replay, `${stem}-${tag}-reply.txt`);
            const j = path.join(opt.replay, `${stem}-${tag}-payload.json`);
            if (arm === 'roboflow') {
              if (!fs.existsSync(j)) throw new Error(`nothing recorded at ${j}`);
              payload = JSON.parse(fs.readFileSync(j, 'utf8'));
            } else {
              if (!fs.existsSync(f)) throw new Error(`nothing recorded at ${f}`);
              reply = fs.readFileSync(f, 'utf8');
              payload = oai.replyToPayload(reply, { w: sent.w, h: sent.h, spec: armSpec, arm });
            }
          } else if (arm === 'roboflow') {
            const r = await callRoboflow({ base64, mime, opt });
            ms = r.ms; payload = r.payload;
            fs.writeFileSync(path.join(outDir, `${stem}-${tag}-payload.json`), JSON.stringify(payload, null, 2));
          } else {
            const r = await callOpenAI({ arm, base64, mime, w: sent.w, h: sent.h, spec: armSpec, opt });
            ms = r.ms; reply = r.reply; usage = r.usage;
            fs.writeFileSync(path.join(outDir, `${stem}-${tag}-reply.txt`), reply);
            payload = oai.replyToPayload(reply, { w: sent.w, h: sent.h, spec: armSpec, arm });
            fs.writeFileSync(path.join(outDir, `${stem}-${tag}-payload.json`), JSON.stringify(payload, null, 2));
          }
        } catch (err) {
          error = String(err.message || err);
        }

        if (error) {
          console.log(`\n  ${pad(tag, 14)} FAILED  ${error}`);
          summary.push({ file: stem, arm: tag, error });
          continue;
        }

        // THE PRODUCTION PIPELINE, not a copy of it. `image` is the ORIGINAL
        // size; the payload declares the size the boxes are in; rescaleRect
        // bridges the two. This is exactly the arithmetic that, got wrong, puts
        // the bed in the top-left corner.
        const image = { w: plan.w, h: plan.h };
        const { kept, rejected } = detectionsToZones(payload, { image, polygon: null });
        const score = scoreArm(kept, truth, truthPxPerFt);
        const ceiling = needsGrid ? armCeiling(arm, truth, armSpec, scale) : null;

        // Only the OpenAI route carries room names; a Roboflow payload nests
        // `predictions` as an object three deep, so this must not assume an array.
        const rooms = Array.isArray(payload?.predictions)
          ? payload.predictions.map((p) => p.room).filter(Boolean) : [];
        console.log(`\n  ${pad(tag, 14)} ${ms ? `${ms}ms` : 'replayed'}`
          + `  kept ${kept.length}, rejected ${rejected.length}`
          + (usage ? `  tokens ${usage.prompt_tokens}+${usage.completion_tokens}` : '')
          + (rooms.length ? `  rooms: ${[...new Set(rooms)].join(' / ')}` : ''));
        for (const r of rejected) console.log(`       - dropped ${r.cls}: ${r.reason}`);
        if (truth.length) {
          for (const [i, row] of score.rows.entries()) {
            const off = row.pred ? dist(centre(row.truth), centre(row.pred.rect)) : null;
            console.log(`       bed ${i + 1}: IoU ${num(row.iou)}`
              + (off == null ? '  (not found)' : `  centre off by ${num(off, 0)}px`
                + (truthPxPerFt ? ` = ${num(off / truthPxPerFt)}ft` : '')));
          }
          if (score.spurious.length) console.log(`       ${score.spurious.length} extra box(es) matching nothing`);
          if (ceiling != null) {
            console.log(`       ceiling for this arm at a ${armSpec.pitch}px grid: IoU ${num(ceiling)}`
              + ` — a perfect answer scores no better than this`);
          }
        }

        fs.writeFileSync(path.join(outDir, `${stem}-${tag}-overlay.png`),
          overlay(plan, { truth, score, arm, title: `${stem} ${tag}` }).toPng());

        summary.push({
          file: stem, arm: tag, ms, kept: kept.length, rejected: rejected.length,
          recall: score.recall, precision: score.precision, meanIou: score.meanIou,
          worstIou: score.worstIou, offsetPx: score.meanOffsetPx, offsetFt: score.meanOffsetFt,
          tokens: usage ? usage.prompt_tokens + usage.completion_tokens : null,
          ceiling, pitch: needsGrid ? armSpec.pitch : null,
          rooms: [...new Set(rooms)],
        });
      }
    }
  }

  // --- the table ------------------------------------------------------------
  const hasTruth = summary.some((s) => s.meanIou != null);
  console.log(`\n${'='.repeat(72)}\nSUMMARY\n${'='.repeat(72)}`);
  console.log(`  ${pad('plan', 18)}${pad('arm', 14)}${pad('found', 7)}`
    + (hasTruth ? `${pad('meanIoU', 9)}${pad('ceiling', 9)}${pad('worst', 8)}${pad('off(ft)', 9)}` : '')
    + `${pad('ms', 7)}tokens`);
  for (const s of summary) {
    if (s.error) { console.log(`  ${pad(s.file, 18)}${pad(s.arm, 14)}FAILED  ${s.error.slice(0, 60)}`); continue; }
    console.log(`  ${pad(s.file, 18)}${pad(s.arm, 14)}${pad(s.kept, 7)}`
      + (hasTruth ? `${pad(num(s.meanIou), 9)}${pad(s.ceiling == null ? '—' : num(s.ceiling), 9)}`
                    + `${pad(num(s.worstIou), 8)}${pad(num(s.offsetFt), 9)}` : '')
      + `${pad(s.ms || '—', 7)}${s.tokens ?? '—'}`);
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n  images, replies and summary.json in ${path.relative(ROOT, outDir) || outDir}/`);
  if (!hasTruth) {
    console.log('  no ground truth, so no IoU. Open the overlays, or write a'
      + ' <name>.truth.json to get numbers.');
  }
  console.log();
}

main().catch((err) => { console.error(`\n${err.message}\n`); process.exit(1); });
