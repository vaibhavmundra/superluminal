// ---------------------------------------------------------------------------
// detect.js — pull the annotations out of an uploaded plan image.
//   RED dotted circle -> ceiling fan
//
// There used to be a second annotation: a GREEN closed loop round the area to
// light, morphologically sealed and flood-filled to recover the region. It is
// gone, and not because it did not work. It worked MOST of the time, which was
// the problem — a loop with a gap that the sealing bridged in the wrong place
// gave a region that looked perfectly plausible and was wrong, with nothing on
// screen to say so. It also demanded a round trip through an image editor
// before a plan could be uploaded at all. The outline is now traced in the app,
// over the plan, with the cursor snapping as it goes (see OutlineTracer and
// snap.js): less work than marking the image up was, and exact.
//
// The red circle stays. A fan is a fixture the layout has to work around AND a
// standard-sized object, so one mark answers two questions at once — where the
// fans are, and how many pixels there are to a foot.
// ---------------------------------------------------------------------------

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
  red: { hue: [-25, 20], sat: 0.30, val: 0.18, label: 'red' },
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
