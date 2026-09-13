// ---------------------------------------------------------------------------
// dimText.js — the strings on a drawing, reassembled and read.
//
// THE TEXT ON A PLAN IS NOT IN LINES. A PDF's text layer is a bag of positioned
// runs, and where one run ends and the next begins is a decision the exporter
// made about kerning, not about meaning. On the sample sheet in this repo
// `"PROJECT NAME: DUPLEX AT"` arrives as one item and `K`, `M`, `B`, `D` arrive
// as four — so `18'-0" X 12'-0"` may well be five items, and a regex over raw
// items matches almost nothing. Everything here happens AFTER reassembly for
// that reason.
//
// THE INPUT IS ALREADY IN PLAN PIXELS. This module does no coordinate work
// beyond rotation: the caller converts from PDF page space to the raster's
// pixels, because that conversion belongs to whatever produced the text and
// there is more than one possible producer. A vision pass that reads a scanned
// plan would hand over the same shape and everything below would apply
// unchanged — which is the point of keeping it pure.
//
// Items in:  { str, x, y, w, h, rot }   x,y = baseline origin, rot in radians
// Lines out: { str, x, y, w, h, rot, items }
// ---------------------------------------------------------------------------

/** Two angles are the same run of text if they agree to about a degree. */
const ROT_TOL = 0.02;
/** How far off a shared baseline a run may sit, as a fraction of text height. */
const BASELINE_TOL = 0.6;
/**
 * The widest gap along the reading direction that is still ONE line, in heights.
 *
 * TIGHT, AND MEASURED OFF A REAL DRAWING. This was 1.8 — "about a couple of
 * spaces" — and on a densely dimensioned plan it was catastrophic: the figures
 * in a chain sit closer together than that, so `205` and `425` were glued into
 * one line reading `205 425`, which then parsed as a single 205 occupying the
 * width of both. Every span measured off it was wrong, and the whole sheet was
 * refused. On `floor_plan_dim_intelligence.pdf` the gaps between neighbouring
 * figures run from 0.54 to 11.8 heights, so NO threshold above about half a
 * height can separate them.
 *
 * WHAT HAS TO SURVIVE THE CUT is the other kind of gap: pdf.js splits a single
 * string wherever the text matrix moves, which is kerning and sub-pixel
 * positioning — those land at or near zero. So the two populations are 0-ish
 * against 0.5-and-up, and the line goes between them rather than at the widest
 * space a font might contain.
 */
const GAP_TOL = 0.35;

const dirOf = (rot) => ({ c: Math.cos(rot), s: Math.sin(rot) });

/** Distance along the reading direction. */
export const along = (p, rot) => { const { c, s } = dirOf(rot); return p.x * c + p.y * s; };
/** Distance across it — the baseline's own offset. */
export const across = (p, rot) => { const { c, s } = dirOf(rot); return -p.x * s + p.y * c; };

/** The mid-point of a run, which is what a dimension is centred on. */
export function centreOf(item) {
  const { c, s } = dirOf(item.rot || 0);
  return { x: item.x + (item.w / 2) * c, y: item.y + (item.w / 2) * s };
}

/**
 * Fragmented runs -> lines.
 *
 * Runs join when they share an angle, share a baseline, and are close enough
 * along that baseline. Nothing here looks at what the text SAYS: a line is a
 * typographic fact, and deciding it by content would join a room name to the
 * dimension underneath it whenever the two happened to be near.
 */
export function reassemble(items) {
  const live = (items || []).filter((i) => i && typeof i.str === 'string'
    && i.str.trim() !== '' && Number.isFinite(i.x) && Number.isFinite(i.y));
  if (!live.length) return [];

  // Bucket by angle first, then by baseline within the angle. Two passes rather
  // than one key, because the baseline tolerance is only meaningful once the
  // angle is fixed — `across` is measured in the run's own frame.
  const byRot = new Map();
  for (const it of live) {
    const rot = it.rot || 0;
    let key = null;
    for (const k of byRot.keys()) if (Math.abs(k - rot) <= ROT_TOL) { key = k; break; }
    if (key === null) { key = rot; byRot.set(key, []); }
    byRot.get(key).push(it);
  }

  const lines = [];
  for (const [rot, group] of byRot) {
    const rows = [];
    for (const it of group) {
      const a = across(it, rot);
      const tol = Math.max(1, (it.h || 1) * BASELINE_TOL);
      const row = rows.find((r) => Math.abs(r.across - a) <= Math.max(tol, r.tol));
      if (row) { row.items.push(it); row.tol = Math.max(row.tol, tol); }
      else rows.push({ across: a, tol, items: [it] });
    }

    for (const row of rows) {
      row.items.sort((p, q) => along(p, rot) - along(q, rot));
      // Walk the row and cut it wherever the gap is too wide to be a space.
      let run = [];
      const flush = () => { if (run.length) lines.push(lineFrom(run, rot)); run = []; };
      for (const it of row.items) {
        if (!run.length) { run = [it]; continue; }
        const prev = run[run.length - 1];
        const gap = along(it, rot) - (along(prev, rot) + (prev.w || 0));
        if (gap > Math.max(2, (it.h || 1) * GAP_TOL)) flush();
        run.push(it);
      }
      flush();
    }
  }
  return lines;
}

/**
 * One reassembled line. The string is joined with a space wherever the original
 * runs were separated by more than a hair, so `18'-0"` that arrived as three
 * items does not become `18 ' - 0 "` and lose its own pattern.
 */
function lineFrom(run, rot) {
  let str = '';
  for (let i = 0; i < run.length; i++) {
    const it = run[i];
    if (i > 0) {
      const prev = run[i - 1];
      const gap = along(it, rot) - (along(prev, rot) + (prev.w || 0));
      if (gap > Math.max(1, (it.h || 1) * 0.22)) str += ' ';
    }
    str += it.str;
  }
  const first = run[0];
  const last = run[run.length - 1];
  const w = (along(last, rot) + (last.w || 0)) - along(first, rot);
  return {
    str: str.replace(/\s+/g, ' ').trim(),
    x: first.x, y: first.y, w, h: Math.max(...run.map((i) => i.h || 0), 1),
    rot, items: run.length,
  };
}

// --- reading a length -------------------------------------------------------

const MM_PER_FT = 304.8;

/**
 * WHAT A BARE NUMBER MEANS IS A FACT ABOUT THE PLAN, NOT ABOUT THE NUMBER.
 *
 * `3600` is millimetres and `18` is feet, and no rule applied to one string can
 * tell which a `120` is. But a drawing is internally consistent — a practice
 * dimensions a whole sheet in one unit — so the question is answered once, over
 * every bare number found, and then applied to all of them.
 *
 * The median is what decides, because a title block's `07` and a sheet number
 * must not drag the answer. Above 100 the drawing is in millimetres: a room or
 * a chain segment of 100ft+ is rarer than one of 100mm+ by a wide margin.
 */
export function inferBareUnit(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return 'ft';
  const med = nums[Math.floor(nums.length / 2)];
  return med >= 100 ? 'mm' : 'ft';
}

/** feet-and-inches: 18'-6", 18' 6", 18'6", 18' */
const FT_IN = /(\d{1,3})\s*['’]\s*[-–]?\s*(\d{1,2})?\s*(?:\d\/\d)?\s*["”]?/;
/** a number with an explicit unit: 18ft, 3.6m, 3600mm */
const UNITED = /(\d{1,6}(?:\.\d+)?)\s*(mm|cm|m|ft|feet|')\b/i;
/** a bare number */
const BARE = /(\d{1,6}(?:\.\d+)?)/;

const toFeet = (v, unit) => {
  switch (unit) {
    case 'mm': return v / MM_PER_FT;
    case 'cm': return (v * 10) / MM_PER_FT;
    case 'm': return (v * 1000) / MM_PER_FT;
    default: return v;
  }
};

/**
 * Read ONE length out of a fragment. `bare` is the unit a naked number takes.
 * Returns feet, or null.
 */
export function readLength(text, bare = 'ft') {
  const s = String(text || '').trim();
  if (!s) return null;

  const fi = s.match(FT_IN);
  if (fi && /['’]/.test(fi[0])) {
    const ft = Number(fi[1]);
    const inch = fi[2] ? Number(fi[2]) : 0;
    if (Number.isFinite(ft) && inch < 12) return ft + inch / 12;
  }
  const un = s.match(UNITED);
  if (un) {
    const v = Number(un[1]);
    const u = un[2].toLowerCase();
    if (Number.isFinite(v)) return toFeet(v, u === 'feet' || u === "'" ? 'ft' : u);
  }
  const b = s.match(BARE);
  if (b) {
    const v = Number(b[1]);
    if (Number.isFinite(v) && v > 0) return toFeet(v, bare);
  }
  return null;
}

/** The separator in `18 x 12` — an x, a cross, or a by. */
const PAIR_SPLIT = /\s*(?:[xX×✕]|\bby\b)\s*/;

/**
 * Read a line as a dimension.
 *
 * Three answers: a PAIR (`18'-0" X 12'-0"` — a room saying its own size), a
 * SINGLE (`3600` — one link of a chain), or nothing.
 *
 * A pair is worth far more than two singles and is kept as one thing for that
 * reason: the two numbers are a cross-check on each other, and splitting them
 * would throw the check away. See roomScale.js.
 */
export function readDimension(line, bare = 'ft') {
  const raw = String(line?.str ?? line ?? '').trim();
  if (!raw) return null;
  // A plan is full of numbers that are not lengths. Anything carrying a letter
  // that is not a unit or a separator is a name, a code or a note.
  if (/[@#%]|\b(?:no|rev|sheet|scale|dwg|date)\b/i.test(raw)) return null;

  const parts = raw.split(PAIR_SPLIT).filter((p) => p.trim() !== '');
  if (parts.length === 2) {
    const a = readLength(parts[0], bare);
    const b = readLength(parts[1], bare);
    if (a > 0 && b > 0) return { kind: 'pair', a, b, raw };
  }
  const one = readLength(raw, bare);
  // A LENGTH HAS TO BE MOSTLY NUMBER. `Space 12` reads as 12 through the bare
  // branch otherwise, and a room label would become a ruler.
  if (one > 0 && /^[\s\d.,'’"”\-–xX×]+(?:mm|cm|m|ft|feet)?$/i.test(raw)) {
    return { kind: 'single', a: one, b: null, raw };
  }
  return null;
}

/** Every bare number in a set of lines, for inferBareUnit. */
export function bareNumbers(lines) {
  const out = [];
  for (const l of lines || []) {
    const s = String(l?.str ?? l ?? '');
    if (/['’"”]|\b(?:mm|cm|m|ft|feet)\b/i.test(s)) continue;   // states its own unit
    for (const m of s.matchAll(/\b(\d{1,6}(?:\.\d+)?)\b/g)) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > 0) out.push(v);
    }
  }
  return out;
}
