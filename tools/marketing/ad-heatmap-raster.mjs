// ---------------------------------------------------------------------------
// ad-heatmap-raster.mjs — a small software rasteriser, straight-alpha RGBA, 4x4 coverage.
// No dependencies: the frames leave as raw RGBA for ffmpeg to encode.
// ---------------------------------------------------------------------------

export function makeCanvas(W, H) {
  return { W, H, px: new Float32Array(W * H * 4) };
}

export function clear(cv) { cv.px.fill(0); }

/** Source-over, straight alpha. r/g/b in 0..255, a in 0..1. */
export function blend(cv, x, y, r, g, b, a) {
  if (!(a > 0)) return;
  if (x < 0 || y < 0 || x >= cv.W || y >= cv.H) return;
  const o = (y * cv.W + x) * 4;
  const px = cv.px;
  const da = px[o + 3];
  const na = a + da * (1 - a);
  if (!(na > 0)) { px[o + 3] = 0; return; }
  const w0 = a / na, w1 = da * (1 - a) / na;
  px[o] = r * w0 + px[o] * w1;
  px[o + 1] = g * w0 + px[o + 1] * w1;
  px[o + 2] = b * w0 + px[o + 2] * w1;
  px[o + 3] = na;
}

/** Axis-aligned rectangle with exact analytic edge coverage. */
export function fillRect(cv, x0, y0, x1, y1, c, alpha = 1) {
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(cv.W - 1, Math.ceil(x1) - 1);
  const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(cv.H - 1, Math.ceil(y1) - 1);
  for (let y = iy0; y <= iy1; y++) {
    const cy = Math.min(y + 1, y1) - Math.max(y, y0);
    if (!(cy > 0)) continue;
    for (let x = ix0; x <= ix1; x++) {
      const cx = Math.min(x + 1, x1) - Math.max(x, x0);
      if (!(cx > 0)) continue;
      blend(cv, x, y, c[0], c[1], c[2], alpha * cx * cy);
    }
  }
}

/**
 * Anything describable as "is this sub-sample inside, and how opaque".
 * `f(px,py)` returns 0..1. Sampled SS x SS on each pixel inside the bbox.
 */
export function fillShape(cv, bx0, by0, bx1, by1, f, c, alpha = 1, SS = 4) {
  const ix0 = Math.max(0, Math.floor(bx0)), ix1 = Math.min(cv.W - 1, Math.ceil(bx1));
  const iy0 = Math.max(0, Math.floor(by0)), iy1 = Math.min(cv.H - 1, Math.ceil(by1));
  const step = 1 / SS, half = step / 2, n = SS * SS;
  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      let s = 0;
      for (let j = 0; j < SS; j++) {
        const py = y + half + j * step;
        for (let i = 0; i < SS; i++) s += f(x + half + i * step, py);
      }
      if (s > 0) blend(cv, x, y, c[0], c[1], c[2], alpha * (s / n));
    }
  }
}

const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};

/** A stroked segment with round caps, i.e. a capsule of half-width r. */
export function fillCapsule(cv, ax, ay, bx, by, r, c, alpha = 1) {
  const bx0 = Math.min(ax, bx) - r - 1, bx1 = Math.max(ax, bx) + r + 1;
  const by0 = Math.min(ay, by) - r - 1, by1 = Math.max(ay, by) + r + 1;
  fillShape(cv, bx0, by0, bx1, by1,
    (px, py) => (distSeg(px, py, ax, ay, bx, by) <= r ? 1 : 0), c, alpha);
}

export function fillCircle(cv, cx, cy, r, c, alpha = 1) {
  if (!(r > 0)) return;
  fillShape(cv, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1,
    (px, py) => (Math.hypot(px - cx, py - cy) <= r ? 1 : 0), c, alpha);
}

/** A ring: a circle of radius r stroked w wide, centred on the radius. */
export function strokeCircle(cv, cx, cy, r, w, c, alpha = 1) {
  if (!(r > 0) || !(w > 0)) return;
  const ro = r + w / 2;
  fillShape(cv, cx - ro - 1, cy - ro - 1, cx + ro + 1, cy + ro + 1,
    (px, py) => (Math.abs(Math.hypot(px - cx, py - cy) - r) <= w / 2 ? 1 : 0), c, alpha);
}

/** A dotted ring, `count` dots of radius `dr` evenly spaced. `clip` drops the
 *  dots that fall outside a rectangle — a beam footprint is a claim on FLOOR,
 *  and half a ring lying on the joinery beyond the room reads as a mistake. */
export function dottedCircle(cv, cx, cy, r, dr, count, c, alpha = 1, phase = 0, clip = null) {
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (clip && (x < clip.x0 || x > clip.x1 || y < clip.y0 || y > clip.y1)) continue;
    fillCircle(cv, x, y, dr, c, alpha);
  }
}

/** Radial falloff disc — the halo under a lit fitting. `pow` shapes the edge. */
export function glowDisc(cv, cx, cy, r, c, alpha = 1, pow = 2.2) {
  if (!(r > 0)) return;
  fillShape(cv, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (px, py) => {
    const d = Math.hypot(px - cx, py - cy) / r;
    return d >= 1 ? 0 : Math.pow(1 - d, pow);
  }, c, alpha, 2);
}

/** A soft-edged capsule — the blurred band under a run of tape. */
export function glowCapsule(cv, ax, ay, bx, by, r, c, alpha = 1, core = 0.35) {
  const bx0 = Math.min(ax, bx) - r - 1, bx1 = Math.max(ax, bx) + r + 1;
  const by0 = Math.min(ay, by) - r - 1, by1 = Math.max(ay, by) + r + 1;
  fillShape(cv, bx0, by0, bx1, by1, (px, py) => {
    const d = distSeg(px, py, ax, ay, bx, by) / r;
    if (d >= 1) return 0;
    if (d <= core) return 1;
    const t = (d - core) / (1 - core);
    return (1 - t) * (1 - t);
  }, c, alpha, 2);
}

/** Even-odd polygon fill. */
export function fillPolygon(cv, pts, c, alpha = 1) {
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const p of pts) {
    if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x;
    if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y;
  }
  const inside = (px, py) => {
    let on = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > py) !== (b.y > py)
        && px < a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x)) on = !on;
    }
    return on ? 1 : 0;
  };
  fillShape(cv, bx0 - 1, by0 - 1, bx1 + 1, by1 + 1, inside, c, alpha);
}

/** A stroked open polyline with round joins. */
export function strokePolyline(cv, pts, w, c, alpha = 1) {
  for (let i = 1; i < pts.length; i++) {
    fillCapsule(cv, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, w / 2, c, alpha);
  }
}

/** Straight-alpha float canvas -> 8-bit RGBA bytes. */
export function toBytes(cv) {
  const out = Buffer.allocUnsafe(cv.W * cv.H * 4);
  const px = cv.px;
  for (let i = 0; i < cv.W * cv.H; i++) {
    const o = i * 4;
    const a = px[o + 3];
    out[o] = Math.max(0, Math.min(255, Math.round(px[o])));
    out[o + 1] = Math.max(0, Math.min(255, Math.round(px[o + 1])));
    out[o + 2] = Math.max(0, Math.min(255, Math.round(px[o + 2])));
    out[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  return out;
}
