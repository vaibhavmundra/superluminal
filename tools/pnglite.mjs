// ---------------------------------------------------------------------------
// pnglite.mjs — read a PNG, draw on it, write it back. No dependencies.
//
// The eval harness has to burn a labelled grid onto a floor plan before
// sending it, and draw result boxes onto a copy afterwards. In the browser
// that is four lines of canvas; in node it is normally a native image library.
//
// This is here so that `node tools/eval-detect.mjs plan.png` works on a fresh
// clone with nothing installed. The harness exists to answer one question in
// one evening — making it depend on a native build that has to compile first is
// how that evening goes instead. zlib is in node, and the rest of PNG is a
// length-prefixed chunk format and five row filters.
//
// Scope, deliberately: any non-interlaced PNG in — 1/2/4/8/16-bit, grey, RGB,
// indexed or with alpha — and 8-bit RGBA PNG out. 16-bit samples are truncated
// to their high byte, which is fine for a line drawing and wrong for anything
// that cares. Interlaced input throws rather than producing a scrambled
// picture that would be blamed on the model.
// ---------------------------------------------------------------------------

import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- CRC32, as the format requires -----------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// --- decode -----------------------------------------------------------------

/** Undo one row filter, in place, given the reconstructed row above. */
function unfilter(type, row, prev, bpp) {
  const n = row.length;
  switch (type) {
    case 0: break;
    case 1: for (let i = bpp; i < n; i++) row[i] = (row[i] + row[i - bpp]) & 0xff; break;
    case 2: if (prev) for (let i = 0; i < n; i++) row[i] = (row[i] + prev[i]) & 0xff; break;
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0;
        row[i] = (row[i] + ((a + b) >> 1)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      break;
    default: throw new Error(`Unknown PNG row filter ${type}.`);
  }
  return row;
}

/** PNG buffer -> { data: Uint8ClampedArray RGBA, w, h }. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('Not a PNG (bad signature).');

  let w = 0, h = 0, depth = 8, colorType = 6, interlace = 0;
  let palette = null, trns = null;
  const idat = [];

  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;

    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }

  if (interlace) throw new Error('Interlaced PNG is not supported. Re-save it without Adam7.');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}.`);
  if (depth < 8 && colorType !== 0 && colorType !== 3) {
    throw new Error(`A ${depth}-bit colour type ${colorType} PNG is not a legal file.`);
  }
  if (![1, 2, 4, 8, 16].includes(depth)) throw new Error(`Unsupported PNG bit depth ${depth}.`);

  // SUB-BYTE DEPTHS ARE NOT EXOTIC. Anything saved as an indexed PNG with 16
  // or fewer colours — which is what most tools produce for a line drawing —
  // comes out at 4 bits per pixel, so "8-bit only" would reject a large share
  // of real floor plans. Filtering still works on WHOLE BYTES (the spec pins
  // the filter unit to ceil(bits/8), minimum 1), so only the unpacking below
  // changes; the unfilter step above is untouched.
  const bits = channels * depth;                       // bits per pixel
  const sample = Math.max(1, depth / 8);               // bytes per sample, when >= 8
  const bpp = Math.max(1, Math.ceil(bits / 8));        // filter unit
  const stride = Math.ceil((w * bits) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const maxVal = (1 << depth) - 1;

  /** Sample `i` of pixel `x`, for any depth. */
  const readSample = (row, x, i) => {
    if (depth >= 8) return row[x * bpp + i * sample];  // 16-bit: high byte
    const bitPos = (x * channels + i) * depth;
    const byte = row[bitPos >> 3];
    const shift = 8 - depth - (bitPos & 7);
    return (byte >> shift) & maxVal;
  };

  const out = new Uint8ClampedArray(w * h * 4);
  let prev = null;
  for (let y = 0; y < h; y++) {
    const off = y * (stride + 1);
    const filter = raw[off];
    const row = unfilter(filter, raw.subarray(off + 1, off + 1 + stride), prev, bpp);
    prev = row;
    for (let x = 0; x < w; x++) {
      const c = (i) => readSample(row, x, i);
      const o = (y * w + x) * 4;
      let r, g, b, a = 255;
      if (colorType === 0) {
        // Grey below 8 bits is 0..maxVal, so stretch it to 0..255 rather than
        // rendering a 1-bit drawing as black on black.
        r = g = b = depth >= 8 ? c(0) : Math.round((c(0) * 255) / maxVal);
      } else if (colorType === 2) { r = c(0); g = c(1); b = c(2); }
      else if (colorType === 3) {
        const idx = c(0), i = idx * 3;
        r = palette[i]; g = palette[i + 1]; b = palette[i + 2];
        if (trns && idx < trns.length) a = trns[idx];
      } else if (colorType === 4) { r = g = b = c(0); a = c(1); }
      else { r = c(0); g = c(1); b = c(2); a = c(3); }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return { data: out, w, h };
}

// --- encode -----------------------------------------------------------------

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const head = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head), 0);
  return Buffer.concat([len, head, crc]);
}

/** { data RGBA, w, h } -> PNG buffer. Filter 0 throughout; zlib does the work. */
export function encodePng({ data, w, h }) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1);
    raw[o] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, o + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- a 5x7 bitmap font -----------------------------------------------------
//
// Only what a grid label needs: digits, capitals, and three bits of
// punctuation. Written out rather than loaded, because a font file is an asset
// to lose and this is 40 lines.

const FONT = {
  '0': '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  'A': '..#..|.#.#.|#...#|#...#|#####|#...#|#...#',
  'B': '####.|#...#|#...#|####.|#...#|#...#|####.',
  'C': '.###.|#...#|#....|#....|#....|#...#|.###.',
  'D': '####.|#...#|#...#|#...#|#...#|#...#|####.',
  'E': '#####|#....|#....|####.|#....|#....|#####',
  'F': '#####|#....|#....|####.|#....|#....|#....',
  'G': '.###.|#...#|#....|#.###|#...#|#...#|.###.',
  'H': '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  'I': '#####|..#..|..#..|..#..|..#..|..#..|#####',
  'J': '....#|....#|....#|....#|#...#|#...#|.###.',
  'K': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  'L': '#....|#....|#....|#....|#....|#....|#####',
  'M': '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  'N': '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  'O': '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  'P': '####.|#...#|#...#|####.|#....|#....|#....',
  'Q': '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  'R': '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  'S': '.###.|#...#|#....|.###.|....#|#...#|.###.',
  'T': '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  'U': '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  'V': '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  'W': '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  'X': '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  'Y': '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  'Z': '#####|....#|...#.|..#..|.#...|#....|#####',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
};

const GLYPH_W = 5, GLYPH_H = 7;

// --- a drawing surface ------------------------------------------------------

/**
 * The smallest useful raster: axis-aligned rectangles, axis-aligned lines, and
 * text. That is all a grid overlay and a box overlay need, and refusing to
 * grow past it keeps this file something you can read in one sitting.
 */
export class Raster {
  constructor({ data, w, h }) { this.data = data; this.w = w; this.h = h; }

  static from(buf) { return new Raster(decodePng(buf)); }
  static blank(w, h, rgba = [255, 255, 255, 255]) {
    const r = new Raster({ data: new Uint8ClampedArray(w * h * 4), w, h });
    r.fillRect(0, 0, w, h, rgba);
    return r;
  }

  toPng() { return encodePng(this); }
  clone() { return new Raster({ data: new Uint8ClampedArray(this.data), w: this.w, h: this.h }); }

  /** Alpha-blend one pixel. `a` in 0..255. */
  px(x, y, [r, g, b, a = 255]) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    if (a >= 255) { this.data[o] = r; this.data[o + 1] = g; this.data[o + 2] = b; this.data[o + 3] = 255; return; }
    const t = a / 255, u = 1 - t;
    this.data[o] = r * t + this.data[o] * u;
    this.data[o + 1] = g * t + this.data[o + 1] * u;
    this.data[o + 2] = b * t + this.data[o + 2] * u;
    this.data[o + 3] = 255;
  }

  fillRect(x, y, w, h, rgba) {
    for (let j = Math.max(0, y | 0); j < Math.min(this.h, (y + h) | 0); j++) {
      for (let i = Math.max(0, x | 0); i < Math.min(this.w, (x + w) | 0); i++) this.px(i, j, rgba);
    }
  }

  /** Horizontal / vertical run. `dash` of 0 is solid; otherwise on/off in px. */
  hline(y, x0, x1, rgba, weight = 1, dash = 0) {
    for (let x = Math.min(x0, x1) | 0; x <= (Math.max(x0, x1) | 0); x++) {
      if (dash && Math.floor(x / dash) % 2) continue;
      for (let k = 0; k < weight; k++) this.px(x, y + k, rgba);
    }
  }

  vline(x, y0, y1, rgba, weight = 1, dash = 0) {
    for (let y = Math.min(y0, y1) | 0; y <= (Math.max(y0, y1) | 0); y++) {
      if (dash && Math.floor(y / dash) % 2) continue;
      for (let k = 0; k < weight; k++) this.px(x + k, y, rgba);
    }
  }

  strokeRect(x0, y0, x1, y1, rgba, weight = 2, dash = 0) {
    this.hline(y0, x0, x1, rgba, weight, dash);
    this.hline(y1 - weight + 1, x0, x1, rgba, weight, dash);
    this.vline(x0, y0, y1, rgba, weight, dash);
    this.vline(x1 - weight + 1, y0, y1, rgba, weight, dash);
  }

  /**
   * Area-average downscale. Not bilinear on purpose: a floor plan is thin dark
   * lines on white, and point or bilinear sampling at 1/4 scale drops whole
   * walls by landing between them. Averaging the source box keeps every line
   * as at least a grey smudge, which the detector can still see.
   *
   * Upscaling falls back to nearest, which is all the overlays need.
   */
  resize(tw, th) {
    const out = new Raster({ data: new Uint8ClampedArray(tw * th * 4), w: tw, h: th });
    const sx = this.w / tw, sy = this.h / th;
    for (let y = 0; y < th; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < tw; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let j = y0; j < Math.min(this.h, y1); j++) {
          for (let i = x0; i < Math.min(this.w, x1); i++) {
            const o = (j * this.w + i) * 4;
            r += this.data[o]; g += this.data[o + 1]; b += this.data[o + 2]; a += this.data[o + 3]; n++;
          }
        }
        const o = (y * tw + x) * 4;
        if (!n) { out.data[o + 3] = 255; continue; }
        out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n;
      }
    }
    return out;
  }

  /** Fade the whole image toward white, so drawn-on boxes read against it. */
  fade(amount = 0.55) {
    for (let i = 0; i < this.data.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        this.data[i + k] = this.data[i + k] + (255 - this.data[i + k]) * amount;
      }
      this.data[i + 3] = 255;
    }
    return this;
  }

  /** Width in px of `text` at `scale`, so a caller can right-align or centre. */
  static textWidth(text, scale = 2) {
    return String(text).length * (GLYPH_W + 1) * scale - scale;
  }
  static textHeight(scale = 2) { return GLYPH_H * scale; }

  /**
   * Text, optionally on an opaque plate. The plate is not decoration: a label
   * printed straight onto a floor plan lands on top of line work and becomes
   * unreadable exactly where the drawing is busiest, which is where the
   * furniture is.
   */
  text(str, x, y, rgba = [0, 0, 0, 255], scale = 2, plate = null) {
    const s = String(str).toUpperCase();
    if (plate) {
      const pad = scale;
      this.fillRect(x - pad, y - pad, Raster.textWidth(s, scale) + pad * 2,
                    Raster.textHeight(scale) + pad * 2, plate);
    }
    let cx = x;
    for (const ch of s) {
      const g = FONT[ch] || FONT[' '];
      const rows = g.split('|');
      for (let ry = 0; ry < rows.length; ry++) {
        for (let rx = 0; rx < rows[ry].length; rx++) {
          if (rows[ry][rx] !== '#') continue;
          this.fillRect(cx + rx * scale, y + ry * scale, scale, scale, rgba);
        }
      }
      cx += (GLYPH_W + 1) * scale;
    }
    return cx;
  }
}
