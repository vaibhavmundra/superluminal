// ---------------------------------------------------------------------------
// detect.js — pull the annotations out of an uploaded plan image.
//   GREEN closed box/polyline -> area of interest
//   RED dotted circle         -> ceiling fan
// Works on hand-drawn or software-drawn marks; the green stroke need not be
// perfectly closed (we morphologically seal small gaps first).
// ---------------------------------------------------------------------------

import { rectifyPolygon, bbox, axisRect } from './geometry.js';

const MAX_DIM = 1400; // analysis resolution; results are scaled back up

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export const PRESETS = {
  green: { hue: [70, 175], sat: 0.22, val: 0.15, label: 'green' },
  red:   { hue: [-25, 20], sat: 0.30, val: 0.18, label: 'red' },
};

function inHue(h, range) {
  let [lo, hi] = range;
  if (lo < 0) return h >= 360 + lo || h <= hi;
  return h >= lo && h <= hi;
}

/** Draw the image into a canvas at analysis resolution and return pixel data. */
export function imageToPixels(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, scale };
}

export function colorMask({ data, w, h }, preset, tuning = {}) {
  const sat = tuning.sat ?? preset.sat;
  const val = tuning.val ?? preset.val;
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] < 40) continue;
    const { h: hh, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (s >= sat && v >= val && inHue(hh, preset.hue)) { mask[p] = 1; count++; }
  }
  return { mask, w, h, count };
}

// --- morphology -------------------------------------------------------------

function dilate(mask, w, h, r) {
  if (r <= 0) return mask;
  let cur = mask;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (cur[p]) continue;
        if ((x > 0 && cur[p - 1]) || (x < w - 1 && cur[p + 1]) ||
            (y > 0 && cur[p - w]) || (y < h - 1 && cur[p + w])) next[p] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

function erode(mask, w, h, r) {
  if (r <= 0) return mask;
  let cur = mask;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!cur[p]) continue;
        if ((x === 0 || !cur[p - 1]) || (x === w - 1 || !cur[p + 1]) ||
            (y === 0 || !cur[p - w]) || (y === h - 1 || !cur[p + w])) next[p] = 0;
      }
    }
    cur = next;
  }
  return cur;
}

/** Everything not reachable from the image border == enclosed by the stroke. */
function fillEnclosed(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (x < 0 || y < 0 || x >= w || y >= h || outside[p] || mask[p]) return;
    outside[p] = 1; stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p / w) | 0;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  const filled = new Uint8Array(w * h);
  for (let p = 0; p < filled.length; p++) filled[p] = outside[p] ? 0 : 1;
  return filled;
}

function components(mask, w, h, minSize = 1) {
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const stack = [s]; seen[s] = 1;
    const px = [];
    while (stack.length) {
      const p = stack.pop(); px.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    if (px.length >= minSize) out.push(px);
  }
  return out.sort((a, b) => b.length - a.length);
}
function largestComponent(mask, w, h) {
  const c = components(mask, w, h);
  return c.length ? c[0] : [];
}

/** Moore-neighbour boundary trace of a filled binary blob. */
function traceBoundary(mask, w, h) {
  let start = -1;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { start = p; break; }
  if (start < 0) return [];
  const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? mask[y * w + x] : 0;
  let cx = start % w, cy = (start / w) | 0;
  const sx = cx, sy = cy;
  let dir = 0;
  const out = [];
  const limit = w * h * 4;
  let guard = 0;
  do {
    out.push({ x: cx, y: cy });
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (at(nx, ny)) { cx = nx; cy = ny; dir = d; moved = true; break; }
    }
    if (!moved) break;
  } while ((cx !== sx || cy !== sy) && guard++ < limit);
  return out;
}

// --- public API -------------------------------------------------------------

export function detectRegion(pix, tuning = {}) {
  const seal = tuning.seal ?? 3;
  const { mask, w, h, count } = colorMask(pix, PRESETS.green, tuning);
  if (count < 40) return { ok: false, reason: 'No green outline found. Try lowering the colour threshold, or draw the box in a stronger green.' };

  // How big SHOULD the enclosed area be? At least most of the green stroke's
  // own bounding box. If it comes out far smaller, the outline has a gap and
  // the fill has leaked — so retry with progressively stronger sealing.
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const x = p % w, y = (p / w) | 0;
    if (x < gx0) gx0 = x; if (x > gx1) gx1 = x;
    if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
  }
  const targetArea = Math.max(1, (gx1 - gx0) * (gy1 - gy0));

  const ladder = [...new Set([seal, 6, 10, 16, 24, 34])].filter((v) => v >= seal).sort((a, b) => a - b);
  let comp = [], usedSeal = seal, leaked = true;
  for (const r of ladder) {
    const sealed = erode(dilate(mask, w, h, r), w, h, Math.max(0, r - 1));
    const cand = largestComponent(fillEnclosed(sealed, w, h), w, h);
    usedSeal = r;
    if (cand.length > comp.length) comp = cand;
    if (comp.length >= targetArea * 0.62) { leaked = false; break; }
  }
  const areaFrac = comp.length / (w * h);
  if (areaFrac < 0.004) {
    return { ok: false, reason: 'The green mark does not enclose an area. Make sure the box is a closed loop.' };
  }

  const blob = new Uint8Array(w * h);
  for (const p of comp) blob[p] = 1;
  const raw = traceBoundary(blob, w, h);
  if (raw.length < 8) return { ok: false, reason: 'Could not trace the green outline.' };

  // Trace is at analysis resolution — scale back to original image pixels.
  const inv = 1 / pix.scale;
  const scaled = raw.map((p) => ({ x: p.x * inv, y: p.y * inv }));
  const polygon = rectifyPolygon(scaled);
  return {
    ok: true,
    polygon,
    boundingRect: axisRect(bbox(scaled)),
    rawTrace: scaled,
    areaFrac,
    pixelCount: count,
    usedSeal,
    warning: leaked
      ? `The green outline looks broken — the enclosed area is only ${Math.round((comp.length / targetArea) * 100)}% of the marked box even after sealing ${usedSeal}px. Close the loop and re-upload.`
      : null,
  };
}

/**
 * Find every round red marker on the plan. A room can have several fans, so
 * this returns all of them — red text and dimension strings are still rejected
 * by the roundness test, and specks far smaller than the biggest marker are
 * dropped so stray dots don't become phantom fans.
 */
export function detectFans(pix, tuning = {}) {
  const link = tuning.link ?? 8; // dilation needed to join the dots of a dotted circle
  const { mask, w, h, count } = colorMask(pix, PRESETS.red, tuning);
  if (count < 15) return { ok: false, fans: [], reason: 'No red pixels found.' };

  const joined = dilate(mask, w, h, link);
  const blobs = components(joined, w, h, 40);
  if (!blobs.length) return { ok: false, fans: [], reason: 'No red fan marker found.' };

  const found = [];
  let rejected = 0;
  for (const comp of blobs.slice(0, 24)) {
    const inComp = new Uint8Array(w * h);
    for (const p of comp) inComp[p] = 1;
    let sx = 0, sy = 0, n = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const pts = [];
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p] || !inComp[p]) continue;
      const x = p % w, y = (p / w) | 0;
      sx += x; sy += y; n++; pts.push([x, y]);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (n < 25) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    const cx = sx / n, cy = sy / n;
    const d = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    const spread = mean > 0 ? sd / mean : 1;                 // 0 = perfect ring
    const fill = n / (Math.PI * ((bw + bh) / 4) ** 2);        // ring is thin, text is not
    if (!(aspect >= 0.62 && spread <= 0.45 && fill <= 0.95)) { rejected++; continue; }
    const sorted = [...d].sort((a, b) => a - b);
    found.push({ cx, cy, r: sorted[Math.floor(sorted.length * 0.85)], n, spread });
  }
  if (!found.length) {
    return { ok: false, fans: [],
      reason: rejected
        ? 'Red marks were found but none of them are round — the fan needs to be a circle.'
        : 'No red fan marker found.' };
  }

  // Fans on one plan are the same fitting, so anything far smaller than the
  // biggest round mark is a speck, not a fan.
  const rMax = Math.max(...found.map((f) => f.r));
  const kept = found.filter((f) => f.r >= rMax * 0.45);
  const inv = 1 / pix.scale;
  const fans = kept
    .map((f) => ({ x: f.cx * inv, y: f.cy * inv, r: Math.max(f.r, 3) * inv,
                   pixelCount: f.n, roundness: 1 - f.spread }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return { ok: true, fans, dropped: found.length - kept.length };
}

/** Single-fan convenience wrapper — returns the largest marker. */
export function detectFan(pix, tuning = {}) {
  const res = detectFans(pix, tuning);
  if (!res.ok) return { ok: false, reason: res.reason };
  const best = res.fans.reduce((a, b) => (b.r > a.r ? b : a));
  return { ok: true, ...best };
}
