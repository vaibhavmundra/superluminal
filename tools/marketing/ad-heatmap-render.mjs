// ---------------------------------------------------------------------------
// ad-heatmap-render.mjs — THE 8-SECOND MARKETING OVERLAY, ONE FRAME AT A TIME.
//
// A reverse cove spans the window wall, the field answers, and two spots are
// placed by a pointer between the bed and the wardrobe. The same pointer then
// switches on the electrical layer: four plates and their app-native wire
// routes arrive over the held lighting result. Raw RGBA leaves on stdout,
// 1000 x 1500, 30 fps, 240 frames, so ffmpeg can encode it with alpha:
//
//   node tools/marketing/ad-heatmap-render.mjs \
//     | ffmpeg -y -f rawvideo -pixel_format rgba -video_size 1000x1500 \
//         -framerate 30 -i - -c:v prores_ks -profile:v 4444 \
//         -pix_fmt yuva444p10le public/marketing_assets/electrical_overlay.mov
//
// EVERY NUMBER THAT MEANS SOMETHING COMES OUT OF THE APP. The lux field is the
// real solver (features/heatmap/solve.js + useHeatmap's solveRoomLayer), the
// five band colours and the fittings' paint are read off src/styles.css, the
// symbol sizes off lib/settings.js and the cove's width off lib/reverseCove.js.
// Nothing photometric and no colour is written down twice — which is the same
// rule colours.js states for the drawing, applied to a piece of marketing.
//
// THE ROOM IS THE ONE ALREADY DRAWN ON ad_background.png. Its wall faces were
// measured off that file rather than invented, so the field lands in register
// with the bed, the window, the door and the wardrobe somebody else drew. Move
// the background and ROOM below is what has to change with it.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const APP = path.resolve(HERE, '../..');
const BG_PNG = `${APP}/public/marketing_assets/ad_background.png`;
const TOGGLE_PNG = `${APP}/public/marketing_assets/electrical_toggle.png`;

const { buildRoomGeometry } = await import(`${APP}/src/features/heatmap/solve.js`);
const { solveRoomLayer } = await import(`${APP}/src/features/heatmap/useHeatmap.js`);
const { inwardOfRun } = await import(`${APP}/src/features/heatmap/emitters.js`);
const { M_PER_FT } = await import(`${APP}/src/features/heatmap/grid.js`);
const { heatmapTargetForLayer, HEATMAP_BANDS } =
  await import(`${APP}/src/features/heatmap/heatmapTargets.js`);
const { PROBE_HEIGHT_MM } = await import(`${APP}/src/features/heatmap/indirect.js`);
const { colourFor, HEATMAP_OPACITY_NIGHT } =
  await import(`${APP}/src/features/heatmap/colours.js`);
const { DISTRIBUTION_PROFILES } = await import(`${APP}/src/features/heatmap/profiles.js`);
const { DEFAULT_CEILING_MM } = await import(`${APP}/src/lib/materials.js`);
const { STRIP_WATTS_PER_M, STRIP_LUMENS_PER_WATT, STRIP_LOSS, LUMENS_PER_WATT } =
  await import(`${APP}/src/lib/lumens.js`);
const { COVE_BAND_STYLE, STRIP_STYLE, SYMBOL_FT } = await import(`${APP}/src/lib/settings.js`);
const { REVERSE_COVE } = await import(`${APP}/src/lib/reverseCove.js`);
const { throwDiameterFt } = await import(`${APP}/src/lib/cob.js`);
const { SB_COLOUR } = await import(`${APP}/src/lib/electrical.js`);
const { WIRE_CHAIN, WIRE_TWO_WAY } = await import(`${APP}/src/lib/flows.js`);
const R = await import(`${HERE}/ad-heatmap-raster.mjs`);

/* --- THE COLOURS, OFF THE STYLESHEET ------------------------------------- */
/* COMMENTS STRIPPED FIRST, and that is not tidiness: styles.css carries a
   parked palette inside a `/* ... *\/` block AND names these tokens in its
   prose, so a line-by-line read lands on a colour nobody chose. */
const CSS = fs.readFileSync(`${APP}/src/styles.css`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
/** The LAST live declaration of a custom property, which is what the cascade
 *  lands on — styles.css states the paper palette and then the night one. */
function token(name) {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g');
  let last = null, m;
  while ((m = re.exec(CSS))) last = m[1].trim();
  if (!last) throw new Error(`no token ${name}`);
  return last;
}
const hex = (s) => {
  const t = s.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16),
                 parseInt(m[1].slice(4, 6), 16)];
  m = /^rgba?\(([^)]+)\)$/i.exec(t);
  if (m) { const n = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [n[0], n[1], n[2]]; }
  throw new Error(`cannot read colour ${s}`);
};
const PALETTE = HEATMAP_BANDS.map((b) => ({ at: b.anchor, rgb: hex(token(b.token)) }));
const PAINT = {
  fill: hex(token('--lp-fixture-fill')),
  ink: hex(token('--lp-fixture-ink')),
  glow: hex(token('--lp-fixture-glow')),
  led: hex(token('--lp-fixture-led')),
  beam: hex(token('--lp-beam-angle-stroke')),
  accent: hex(token('--accent')),
  board: hex(SB_COLOUR),
  chain: hex(WIRE_CHAIN),
  twoWay: hex(WIRE_TWO_WAY),
};
const BEAM_ALPHA = (() => {
  const m = /rgba?\(([^)]+)\)/.exec(token('--lp-beam-angle-stroke'));
  const n = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : [];
  return n.length >= 4 ? n[3] : 1;
})();

/* --- THE SHEET AND THE ROOM ---------------------------------------------- */
const W = 1000, H = 1500, FPS = 30, FRAMES = 240;
/** The bedroom's inner faces, measured off ad_background.png. */
const ROOM = { x0: 229, y0: 470, x1: 912, y1: 1311 };
const PX_PER_FT = (ROOM.y1 - ROOM.y0) / 15;          // 15 ft the long way
const MPP = M_PER_FT / PX_PER_FT;                     // metres per plan pixel
const CEIL_M = DEFAULT_CEILING_MM / 1000;
const CEIL_FT = CEIL_M / M_PER_FT;
/** One sheet line-weight unit — max(w,h)/1500, capped at 1 screen px by hair(). */
const LW = Math.max(W, H) / 1500;
const hair = (w = 1) => Math.min(w * LW, Math.max(1, w));

const polyPx = [{ x: ROOM.x0, y: ROOM.y0 }, { x: ROOM.x1, y: ROOM.y0 },
                { x: ROOM.x1, y: ROOM.y1 }, { x: ROOM.x0, y: ROOM.y1 }];
const polyM = polyPx.map((p) => ({ x: p.x * MPP, y: p.y * MPP }));
const geo = buildRoomGeometry({
  polygonM: polyM, heightM: CEIL_M,
  materials: { ceiling: 'light', floor: 'light', walls: {} }, mode: 'fine' });
const TARGET = heatmapTargetForLayer('average', 'residential', 'bedroom');
const entry = { sig: 'ad', geometry: geo, surface: null, sphere: null, layers: {} };

/* --- THE FITTINGS -------------------------------------------------------- */
const LM_PER_M = STRIP_WATTS_PER_M[0] * STRIP_LUMENS_PER_WATT * (1 - STRIP_LOSS);
const SPOT_W = 9, SPOT_BEAM = 36;
const SPOT_LM = SPOT_W * LUMENS_PER_WATT.IN;
const COVE_Z = (() => {
  const p = DISTRIBUTION_PROFILES.reverse_cove;
  return Math.max(CEIL_M * 0.05, CEIL_M - p.dropMm / 1000);
})();
/** The slot's own depth off the wall, in plan pixels. */
const COVE_DEPTH = (REVERSE_COVE.widthIn / 12) * PX_PER_FT;
const SPOT_R = SYMBOL_FT.cob * PX_PER_FT;
const BEAM_R = (throwDiameterFt(SPOT_BEAM, CEIL_FT) / 2) * PX_PER_FT;
const SPOTS = [{ x: 457, y: 1208 }, { x: 685, y: 1208 }];

const coveSource = (x1) => {
  const a = { x: ROOM.x0 * MPP, y: ROOM.y0 * MPP };
  const b = { x: x1 * MPP, y: ROOM.y0 * MPP };
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(L > 1e-4)) return null;
  return { id: 'cove', profileId: 'reverse_cove', lm: LM_PER_M * L,
           inward: inwardOfRun(a, b, polyM),
           geom: { kind: 'line', a: { ...a, z: COVE_Z }, b: { ...b, z: COVE_Z } } };
};
const spotSource = (i, level) => (level > 0 ? {
  id: `spot${i}`, profileId: 'cob', lm: SPOT_LM * level, beamDeg: SPOT_BEAM,
  geom: { kind: 'point', p: { x: SPOTS[i].x * MPP, y: SPOTS[i].y * MPP, z: CEIL_M } },
} : null);

/* --- THE BACKGROUND'S OWN LINE WORK -------------------------------------
   THE FIELD GOES UNDER THE DRAWING, WHICH IS WHERE THE APP PUTS IT — see the
   note on HEATMAP_OPACITY_NIGHT, and HeatmapOverlay, which is a child of the
   plan's <svg> with every symbol and outline painted after it. This overlay is
   composited OVER a finished sheet instead, so the grout, the bed, the door
   leaf and the wardrobe inside the room are lifted back on top of the field
   using the background's own luminance as their alpha. Outside the room the
   overlay never touches anything, so the walls and the legend are untouched.

   DECODED BY ffmpeg RATHER THAN BY A PNG READER WRITTEN HERE, because ffmpeg
   is already the dependency this script's output goes through. */
const BG = (() => {
  const raw = path.join(os.tmpdir(), `ad-bg-${W}x${H}.raw`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', BG_PNG,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
  const b = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  if (b.length !== W * H * 4) {
    throw new Error(`${BG_PNG} is not ${W}x${H} — the overlay is set out on it`);
  }
  return b;
})();

/* THE PROVIDED CONTROL, NOT A REDRAW. The file is a full-canvas transparent
   overlay, so keep its authored typography, shadow and spacing and only replace
   the switch track/knob while it changes state. Bounds are discovered from its
   alpha rather than copied from the reference frame. */
const TOGGLE = (() => {
  const raw = path.join(os.tmpdir(), `ad-toggle-${W}x${H}.raw`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', TOGGLE_PNG,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
  const b = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  if (b.length !== W * H * 4) {
    throw new Error(`${TOGGLE_PNG} is not ${W}x${H} — it must match the composition`);
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (b[(y * W + x) * 4 + 3] <= 2) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { b, x0, y0, x1, y1 };
})();

function paintRaster(cv, image, alpha = 1) {
  for (let y = image.y0; y <= image.y1; y++) {
    for (let x = image.x0; x <= image.x1; x++) {
      const o = (y * W + x) * 4;
      const a = (image.b[o + 3] / 255) * alpha;
      if (a > 0.002) R.blend(cv, x, y, image.b[o], image.b[o + 1], image.b[o + 2], a);
    }
  }
}

/* --- THE TIMELINE -------------------------------------------------------- */
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.9 * Math.pow(t - 1, 2);
/** WHAT A HAND DRAGGING SOMETHING ACTUALLY DOES, and the reason the cove does
 *  not take `easeInOut`: a cubic over two seconds spends its first third and
 *  its last third barely moving, so a pull the length of a wall reads as three
 *  events — a creep, a dash, a crawl. Sine has the same soft ends and an even
 *  middle, which is one continuous pull. */
const easeInOutSine = (t) => 0.5 * (1 - Math.cos(Math.PI * t));
/** 0 before `a`, 1 after `b`, eased between. */
const span = (t, a, b, e = easeInOut) => (t <= a ? 0 : t >= b ? 1 : e((t - a) / (b - a)));

/* ONE POINTER, ONE UNBROKEN MOVE, AND THAT IS THE WHOLE STRUCTURE. It comes in
   off the left, drags the slot across the window wall, places two spots, then
   settles onto the electrical control and switches the room plan on. */
const T = {
  cursorIn: [0.00, 0.24],       // off the left edge, to the corner of the wall
  grab: 0.24,                   // ...and takes hold of the end of the slot
  coveIn: [0.22, 2.28],         // the drag itself — the cove follows the tip
  release: 2.28,
  /* AND THEN IT STANDS STILL. A quarter of a second of nothing moving is what
     makes the reading land: the slot is the full length of the wall, and the
     wardrobe and the door are still in the bottom band. Without the hold the
     pointer is already on its way down the room and nobody has read the
     problem the two spots are about to solve. */
  armIn: [2.56, 2.80],          // the spot tool comes onto the pointer
  legA: [2.54, 3.14],
  clickA: 3.14,
  lightA: [3.14, 3.50],
  legB: [3.28, 3.74],
  clickB: 3.74,
  lightB: [3.74, 4.10],
  legToggle: [4.08, 4.70],
  clickToggle: 4.82,
  toggleOn: [4.82, 5.10],
  legOut: [5.16, 5.62],
  boardsIn: 4.98,
  wiresIn: 5.08,
};

/** Where the tape sits inside the slot — and so where the pointer's tip has to
 *  be while it is dragging the end of it. */
const Y_TAPE = ROOM.y0 + COVE_DEPTH / 2;
/** The two ends of the drag, and the corner the pointer lets go at. */
const COVE_A = { x: ROOM.x0, y: Y_TAPE };
const COVE_B = { x: ROOM.x1, y: Y_TAPE };
const TOGGLE_KNOB_OFF = { x: 605, y: 1325 };
const TOGGLE_KNOB_ON = { x: 657, y: 1325 };
/** Off the left edge, clear of the sheet: the arrow's body reaches 39 px right
 *  of its own tip, so anything past -40 is still on camera. */
const OFF_IN = { x: -104, y: 316 };
const OFF = { x: 1086, y: 1516 };
const bez = (p0, c, p1, t) => {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
           y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
};
/** How far along the wall the slot has been pulled, 0..1 — read by the cove
 *  AND by the pointer, because during the drag they are the same number. */
const coveFrac = (t) => span(t, ...T.coveIn, easeInOutSine);
/** The growing end of the slot, in plan pixels. */
const coveEnd = (t) => ROOM.x0 + (ROOM.x1 - ROOM.x0) * coveFrac(t);

function cursorAt(t) {
  if (t <= T.cursorIn[1]) {
    return bez(OFF_IN, { x: 96, y: 438 }, COVE_A, span(t, ...T.cursorIn, easeOut));
  }
  // THE DRAG. The tip IS the end of the run: one number, so the slot cannot
  // arrive somewhere the hand is not.
  if (t <= T.release) return { x: coveEnd(t), y: Y_TAPE };
  if (t < T.legA[0]) return { ...COVE_B };
  if (t <= T.legA[1]) return bez(COVE_B, { x: 892, y: 906 }, SPOTS[0], span(t, ...T.legA));
  if (t < T.legB[0]) return { ...SPOTS[0] };
  if (t <= T.legB[1]) return bez(SPOTS[0], { x: 571, y: 1126 }, SPOTS[1], span(t, ...T.legB));
  if (t < T.legToggle[0]) return { ...SPOTS[1] };
  if (t <= T.legToggle[1]) {
    return bez(SPOTS[1], { x: 700, y: 1260 }, TOGGLE_KNOB_OFF,
      span(t, ...T.legToggle, easeInOut));
  }
  if (t < T.legOut[0]) return { ...TOGGLE_KNOB_OFF };
  if (t <= T.legOut[1]) {
    return bez(TOGGLE_KNOB_OFF, { x: 786, y: 1420 }, OFF,
      span(t, ...T.legOut, easeOut));
  }
  return null;
}

/**
 * HOW HARD THE BUTTON IS DOWN, 0..1 — one curve, five events.
 *
 * A PRESS THAT IS HELD IS NOT THE SAME MARK AS A CLICK, and the difference is
 * the thing a viewer reads as dragging: the pointer goes down at the corner,
 * STAYS down the whole length of the wall, and comes up at the far end. The two
 * spot and toggle clicks are the same curve over a tenth of a second.
 */
function pressAt(t) {
  if (t > T.grab - 0.07 && t < T.release + 0.13) {
    return Math.min(span(t, T.grab - 0.07, T.grab), 1 - span(t, T.release, T.release + 0.13));
  }
  let p = 0;
  for (const c of [T.clickA, T.clickB, T.clickToggle]) {
    p = Math.max(p, Math.min(span(t, c - 0.07, c), 1 - span(t, c, c + 0.15)));
  }
  return p;
}

/** Every place the button went down or came up, for the ring it leaves. */
const TAPS = [
  { t: T.grab, at: COVE_A }, { t: T.release, at: COVE_B },
  { t: T.clickA, at: SPOTS[0] }, { t: T.clickB, at: SPOTS[1] },
  { t: T.clickToggle, at: TOGGLE_KNOB_OFF, colour: PAINT.accent },
];

/* --- THE FIELD, AS THE OVERLAY PAINTS IT --------------------------------
   THE APP'S OWN PIPELINE, STEP FOR STEP: a ratio per cell with NaN outside the
   outline, two rings of nearest-live-neighbour bleed so the smooth scale has
   colour to blend with at the edge, then one pixel per cell stretched over the
   grid's own box and clipped to the room. See HeatmapOverlay.fieldImage. */
const BLEED = 2;
const GX = geo.field.nx, GY = geo.field.ny;
const BOX = {
  x0: geo.field.x0 / MPP, y0: geo.field.y0 / MPP,
  x1: geo.field.x1 / MPP, y1: geo.field.y1 / MPP,
};
const cellRGB = new Float32Array(GX * GY * 3);

function bakeField(values) {
  const val = new Float32Array(GX * GY).fill(NaN);
  for (let g = 0; g < geo.field.count; g++) {
    val[geo.field.at[g]] = TARGET > 0 ? values[g] / TARGET : 0;
  }
  for (let ring = 0; ring < BLEED; ring++) {
    const add = [];
    for (let j = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        const k = j * GX + i;
        if (!Number.isNaN(val[k])) continue;
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (jj < 0 || jj >= GY || ii < 0 || ii >= GX) continue;
            const v = val[jj * GX + ii];
            if (!Number.isNaN(v)) { s += v; n++; }
          }
        }
        if (n) add.push([k, s / n]);
      }
    }
    for (const [k, v] of add) val[k] = v;
  }
  for (let k = 0; k < GX * GY; k++) {
    const c = Number.isNaN(val[k]) ? PALETTE[0].rgb : colourFor(val[k], PALETTE);
    cellRGB[k * 3] = c[0]; cellRGB[k * 3 + 1] = c[1]; cellRGB[k * 3 + 2] = c[2];
  }
}

/** Bilinear, the way a browser scales the one-pixel-per-cell image. */
function sampleField(px, py, out) {
  let u = (px - BOX.x0) / (BOX.x1 - BOX.x0) * GX - 0.5;
  let v = (py - BOX.y0) / (BOX.y1 - BOX.y0) * GY - 0.5;
  u = Math.max(0, Math.min(GX - 1, u));
  v = Math.max(0, Math.min(GY - 1, v));
  const i0 = Math.floor(u), j0 = Math.floor(v);
  const i1 = Math.min(GX - 1, i0 + 1), j1 = Math.min(GY - 1, j0 + 1);
  const fu = u - i0, fv = v - j0;
  for (let ch = 0; ch < 3; ch++) {
    const a = cellRGB[(j0 * GX + i0) * 3 + ch], b = cellRGB[(j0 * GX + i1) * 3 + ch];
    const c = cellRGB[(j1 * GX + i0) * 3 + ch], d = cellRGB[(j1 * GX + i1) * 3 + ch];
    out[ch] = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
}

function paintField(cv) {
  const c = [0, 0, 0];
  for (let y = ROOM.y0; y < ROOM.y1; y++) {
    for (let x = ROOM.x0; x < ROOM.x1; x++) {
      sampleField(x + 0.5, y + 0.5, c);
      R.blend(cv, x, y, c[0], c[1], c[2], HEATMAP_OPACITY_NIGHT);
    }
  }
  // ...and the sheet's own line work back on top of it.
  for (let y = ROOM.y0; y < ROOM.y1; y++) {
    for (let x = ROOM.x0; x < ROOM.x1; x++) {
      const o = (y * W + x) * 4;
      const r = BG[o], g = BG[o + 1], b = BG[o + 2];
      const a = Math.max(r, Math.max(g, b)) / 255;
      if (a > 0.01) R.blend(cv, x, y, r, g, b, a);
    }
  }
}

/* --- THE MARKS ----------------------------------------------------------- */
const breathe = (t, ms = STRIP_STYLE.pulseMs, swell = STRIP_STYLE.glowSwell) =>
  1 + swell * Math.sin((t * 1000 / ms) * Math.PI * 2);

function paintCove(cv, t, xEnd) {
  if (!(xEnd > ROOM.x0 + 0.5)) return;
  const yTape = Y_TAPE;
  const yLip = ROOM.y0 + COVE_DEPTH;
  const B = COVE_BAND_STYLE;
  // The slot: white, transparent, with the set-out lip heavier than the rest.
  R.fillRect(cv, ROOM.x0, ROOM.y0, xEnd, yLip, PAINT.fill, B.fillOpacity);
  R.fillRect(cv, ROOM.x0, ROOM.y0, xEnd, ROOM.y0 + hair(), PAINT.ink, B.edgeOpacity);
  R.fillRect(cv, xEnd - hair(), ROOM.y0, xEnd, yLip, PAINT.ink, B.edgeOpacity);
  R.fillRect(cv, ROOM.x0, yLip - hair(B.lipWeight), xEnd, yLip, PAINT.ink, B.lipOpacity);
  // The tape is lit, so it carries a soft band under the dots.
  const gw = LW * STRIP_STYLE.glow * breathe(t) / 2;
  R.glowCapsule(cv, ROOM.x0 + 2, yTape, xEnd - 2, yTape, gw, PAINT.glow,
                STRIP_STYLE.glowOpacity * 0.8);
  // ...and the dots themselves, which are the emitters.
  const wDot = hair(STRIP_STYLE.stroke);
  const k = wDot / (LW * STRIP_STYLE.stroke);
  const dash = LW * STRIP_STYLE.dash * k, gap = LW * STRIP_STYLE.gap * k;
  for (let x = ROOM.x0 + 1; x + dash <= xEnd - 1; x += dash + gap) {
    R.fillCapsule(cv, x + wDot / 2, yTape, x + dash - wDot / 2, yTape, wDot / 2, PAINT.led, 1);
  }
  /* --- THE END BEING HELD ------------------------------------------------
     THE GRIP IS DRAWN AND NOT IMPLIED. The pointer's tip is exactly here (see
     `cursorAt`), so the end of the slot gets the weight a dragged handle has:
     the full-height end stop at the cut, a brighter head where the tape is
     arriving, and a ring that says this is the thing being held. */
  if (xEnd < ROOM.x1 - 0.5) {
    R.glowDisc(cv, xEnd, yTape, 26, PAINT.glow, 0.5);
    R.fillRect(cv, xEnd - hair(1.8), ROOM.y0, xEnd, yLip, PAINT.ink, 1);
    R.strokeCircle(cv, xEnd, yTape, COVE_DEPTH * 0.42, hair(1.4), PAINT.ink, 0.8);
  }
}

function paintSpot(cv, t, i, appear) {
  if (!(appear > 0)) return;
  const s = SPOTS[i];
  const pop = easeOutBack(Math.min(1, appear));
  // The cone's footprint at the floor — the fitting's own claim on the room.
  const br = BEAM_R * (0.55 + 0.45 * easeOutQuint(Math.min(1, appear)));
  const dots = Math.max(24, Math.round((2 * Math.PI * br) / (LW * (STRIP_STYLE.dash + STRIP_STYLE.gap))));
  R.dottedCircle(cv, s.x, s.y, br, hair(1.1), dots, PAINT.beam,
                 BEAM_ALPHA * 0.8 * appear, 0, ROOM);
  // The halo that says it is lit.
  R.glowDisc(cv, s.x, s.y, SPOT_R * 3.6 * breathe(t, 2800, 0.16), PAINT.glow,
             0.42 * appear);
  // The aperture.
  const r = SPOT_R * Math.max(0.05, pop);
  R.fillCircle(cv, s.x, s.y, r, PAINT.fill, 1);
  R.strokeCircle(cv, s.x, s.y, r, hair(), PAINT.ink, 1);
}

/* --- THE ELECTRICAL REVEAL ----------------------------------------------
   The locations and routing follow ending_ref_frame.png. Paint follows the app:
   solid blue plates; white separation under every wire; blue feed legs, a grey
   chain between the two spots, and magenta on both legs of the two-way pair. */
const BOARDS = [
  { id: 'main', x0: 890, y0: 980, x1: 912, y1: 1036, delay: 0.00 },
  { id: 'bed-window', x0: 230, y0: 518, x1: 252, y1: 563, delay: 0.05 },
  { id: 'tv', x0: 890, y0: 761, x1: 912, y1: 806, delay: 0.10 },
  { id: 'bed-door', x0: 230, y0: 1014, x1: 252, y1: 1059, delay: 0.15 },
];
const MAIN = { x: 890, y: 1007 };
const FAR_BED = { x: 252, y: 540 };
const FAN = { x: 596, y: 795 };
const COVE_FEED = { x: 910, y: Y_TAPE };

const quadPath = (a, c, b, steps = 72) => Array.from({ length: steps + 1 }, (_, i) => {
  const p = i / steps, u = 1 - p;
  return { x: u * u * a.x + 2 * u * p * c.x + p * p * b.x,
           y: u * u * a.y + 2 * u * p * c.y + p * p * b.y };
});

const WIRES = [
  { id: 'cove', pts: quadPath(MAIN, { x: 824, y: 760 }, COVE_FEED, 96),
    colour: PAINT.board, start: 0.00, end: 0.84, width: 1.5 },
  { id: 'spots-feed', pts: quadPath(MAIN, { x: 772, y: 968 }, SPOTS[1], 72),
    colour: PAINT.board, start: 0.06, end: 0.78, width: 1.5 },
  { id: 'spots-chain', pts: quadPath(SPOTS[1], { x: 570, y: 1136 }, SPOTS[0], 64),
    colour: PAINT.chain, start: 0.44, end: 0.94, width: 1.05 },
  { id: 'two-way-window', pts: quadPath(FAR_BED, { x: 474, y: 566 }, FAN, 78),
    colour: PAINT.twoWay, start: 0.10, end: 0.92, width: 1.5 },
  { id: 'two-way-main', pts: quadPath(MAIN, { x: 778, y: 842 }, FAN, 72),
    colour: PAINT.twoWay, start: 0.16, end: 0.92, width: 1.5 },
];

function pathMetrics(pts) {
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x,
      pts[i].y - pts[i - 1].y));
  }
  return { lengths, total: lengths[lengths.length - 1] };
}
for (const wire of WIRES) wire.metric = pathMetrics(wire.pts);

function pointOnPath(wire, d) {
  const { pts, metric: { lengths, total } } = wire;
  const at = Math.max(0, Math.min(total, d));
  let lo = 0, hi = lengths.length - 1;
  while (lo + 1 < hi) {
    const m = (lo + hi) >> 1;
    if (lengths[m] <= at) lo = m; else hi = m;
  }
  const a = pts[lo], b = pts[Math.min(lo + 1, pts.length - 1)];
  const L = Math.max(1e-6, lengths[Math.min(lo + 1, lengths.length - 1)] - lengths[lo]);
  const p = (at - lengths[lo]) / L;
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

function partialPath(wire, progress) {
  const cap = wire.metric.total * Math.max(0, Math.min(1, progress));
  const out = [wire.pts[0]];
  for (let i = 1; i < wire.pts.length && wire.metric.lengths[i] < cap; i++) out.push(wire.pts[i]);
  if (cap > 0) out.push(pointOnPath(wire, cap));
  return out;
}

function paintWire(cv, wire, progress, alpha) {
  if (!(progress > 0) || !(alpha > 0)) return;
  const path = partialPath(wire, progress);
  R.strokePolyline(cv, path, hair(wire.width + 2.2), [255, 255, 255], 0.90 * alpha);

  const cap = wire.metric.total * Math.min(1, progress);
  const dash = wire.width > 1.2 ? 2.4 : 2.0;
  const gap = wire.width > 1.2 ? 4.8 : 3.9;
  for (let d = 0; d < cap; d += dash + gap) {
    const a = pointOnPath(wire, d), b = pointOnPath(wire, Math.min(cap, d + dash));
    R.fillCapsule(cv, a.x, a.y, b.x, b.y, hair(wire.width) / 2, wire.colour, alpha);
  }
}

function paintElectrical(cv, t) {
  const phase = t - T.wiresIn;
  for (const wire of WIRES) {
    const progress = span(phase, wire.start, wire.end, easeOut);
    const alpha = span(phase, wire.start, Math.min(wire.end, wire.start + 0.30), easeOut);
    paintWire(cv, wire, progress, alpha);
  }

  for (const board of BOARDS) {
    const q = span(t, T.boardsIn + board.delay, T.boardsIn + board.delay + 0.42, easeOutQuint);
    if (!(q > 0)) continue;
    const cx = (board.x0 + board.x1) / 2, cy = (board.y0 + board.y1) / 2;
    const scale = 0.78 + 0.22 * q;
    const hw = ((board.x1 - board.x0) / 2) * scale;
    const hh = ((board.y1 - board.y0) / 2) * scale;
    R.fillRect(cv, cx - hw - 1, cy - hh - 1, cx + hw + 1, cy + hh + 1,
      [255, 255, 255], q);
    R.fillRect(cv, cx - hw, cy - hh, cx + hw, cy + hh, PAINT.board, q);
  }
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function paintToggle(cv, t) {
  paintRaster(cv, TOGGLE);
  const on = span(t, ...T.toggleOn, easeInOut);
  if (!(on > 0)) return;

  const y = TOGGLE_KNOB_OFF.y;
  const track = mix([217, 217, 217], PAINT.accent, on);
  R.fillCapsule(cv, TOGGLE_KNOB_OFF.x, y, TOGGLE_KNOB_ON.x, y, 17, track, 1);
  R.glowDisc(cv, (TOGGLE_KNOB_OFF.x + TOGGLE_KNOB_ON.x) / 2, y, 38,
    PAINT.accent, 0.12 * on, 1.8);

  const cx = TOGGLE_KNOB_OFF.x + (TOGGLE_KNOB_ON.x - TOGGLE_KNOB_OFF.x) * on;
  const press = pressAt(t);
  const r = 12 * (1 - 0.07 * press);
  R.fillCircle(cv, cx + 1.5, y + 2, r + 1, [0, 0, 0], 0.18);
  R.fillCircle(cv, cx, y, r, [255, 255, 255], 1);
}

/** The macOS arrow, tip at the origin, in its own 14 x 22 units. */
const ARROW = [[0, 0], [0, 19.8], [4.8, 15.1], [7.7, 21.7], [10.8, 20.3],
               [7.9, 13.8], [13.7, 13.4]];
const CURSOR_SCALE = 2.85;

function paintCursor(cv, t, p) {
  if (!p) return;
  /* NO FADE IN. It arrives from off the sheet — see OFF_IN — so it slides on
     rather than materialising, which is the one entrance that does not read as
     an effect. It fades only on the way out, once it is past the door. */
  const fade = 1 - span(t, T.legOut[1] - 0.16, T.legOut[1]);
  if (!(fade > 0.01)) return;
  // Pressed, the pointer sits down into the sheet — held all the way across.
  const S = CURSOR_SCALE * (1 - 0.13 * pressAt(t));
  const pts = ARROW.map(([x, y]) => ({ x: p.x + x * S, y: p.y + y * S }));
  R.glowDisc(cv, p.x + 4 * S, p.y + 10 * S, 10 * S, [0, 0, 0], 0.38 * fade, 1.5);
  R.fillPolygon(cv, pts, PAINT.ink, fade);
  R.strokePolyline(cv, [...pts, pts[0]], hair(2), [0, 0, 0], fade);
}

function paintArmed(cv, t, p) {
  // The tool, armed and travelling: the draft ring the canvas draws while a
  // fitting is on the pointer and not yet placed.
  if (!p) return;
  const up = span(t, ...T.armIn, easeOut);
  const gone = span(t, T.clickB - 0.02, T.clickB + 0.06);
  /* ...and it stands down for a beat after each click, so the ring is not
     drawn over the aperture it just became. */
  const just = Math.max(1 - span(t, T.clickA, T.clickA + 0.2) + span(t, T.clickA + 0.2, T.clickA + 0.34), 0);
  const a = up * (1 - gone) * 0.75 * Math.min(1, just);
  if (!(a > 0.01)) return;
  R.dottedCircle(cv, p.x, p.y, SPOT_R * 1.5, hair(1.2), 12, PAINT.ink, a, t * 1.6);
}

function paintTap(cv, t) {
  for (const tap of TAPS) {
    const d = (t - tap.t) / 0.36;
    if (d < 0 || d > 1) continue;
    R.strokeCircle(cv, tap.at.x, tap.at.y, 6 + easeOut(d) * 38,
                   hair(2.4) * (1 - d) + 0.4, tap.colour ?? PAINT.glow,
                   0.7 * (1 - d) * (1 - d));
  }
}

/* --- THE PASS ------------------------------------------------------------ */
const cv = R.makeCanvas(W, H);
const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) {
  const t = f / FPS;
  const xEnd = coveEnd(t);
  const lA = span(t, ...T.lightA, easeOutQuint);
  const lB = span(t, ...T.lightB, easeOutQuint);

  const sources = [coveSource(xEnd), spotSource(0, lA), spotSource(1, lB)].filter(Boolean);
  const { values } = solveRoomLayer(entry,
    { sources, layerId: 'average', probeHeightM: PROBE_HEIGHT_MM / 1000 });
  bakeField(values);

  R.clear(cv);
  paintField(cv);
  paintCove(cv, t, xEnd);
  paintSpot(cv, t, 0, lA > 0 ? span(t, T.clickA, T.clickA + 0.3, easeOut) : 0);
  paintSpot(cv, t, 1, lB > 0 ? span(t, T.clickB, T.clickB + 0.3, easeOut) : 0);
  paintElectrical(cv, t);
  paintToggle(cv, t);
  paintTap(cv, t);
  const p = cursorAt(t);
  paintArmed(cv, t, p);
  paintCursor(cv, t, p);

  fs.writeSync(1, R.toBytes(cv));
  if (f % 25 === 0) process.stderr.write(`frame ${f}/${FRAMES}\n`);
}
process.stderr.write(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
