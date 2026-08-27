// ---------------------------------------------------------------------------
// boq.js — the drawing, counted.
//
// A lighting layout leaves the studio twice: once as a drawing, and once as a
// list of things to buy. The drawing is what this app has been about; this is
// the list. It is the same information seen from the other end, and the reason
// it is worth generating rather than typing is that a person counting fittings
// off a screen miscounts, and then orders 34 downlights for a job that needs 37.
//
// ONE ROW PER FITTING TYPE PER ROOM, plus a total. Not one row per fitting: a
// BOQ is a purchase order, and nobody buys downlight number seven. The per-room
// breakdown is there because that is how a site is wired and how a contractor
// prices it, and the totals are there because that is what gets ordered.
//
// WHAT COUNTS AS A LINE. Everything this app PLACES:
//
//   recessed downlight, small   7W   36 deg    the ambient grid's ordinary cell
//   recessed downlight, large  12W   60 deg    the one that serves a pair of cells
//   directional spot            5W   30 deg    aimed at a task surface
//   wall sconce                  -      -      accent, wattage by selection
//   LED strip                9.6 W/m    -      accent, billed in METRES
//
// AND WHAT DOES NOT GET A WATTAGE. A sconce is counted and left blank, because
// its lamp is a choice made when the fitting is chosen and a number invented
// here would travel into somebody's load calculation as though it were a
// specification. A dash is honest; 7W would not be. The same reasoning is why
// the strip IS given a W/m: tape is bought by the metre at a stated output, so
// 9.6 W/m is a default that can be true, whereas "a sconce" has no default.
//
// FANS, CHANDELIERS, AC UNITS AND TRAP DOORS are listed separately and NOT
// billed. They are on the drawing because they occupy ceiling — they are why
// the lights are where they are — but a lighting BOQ that quotes an air
// conditioner is a lighting BOQ nobody trusts. A chandelier is the awkward one
// and it goes here rather than above: it is a light, but it is a specified,
// chosen object whose lamping is not ours, so counting it and stopping is the
// only honest thing to do with it.
//
// PURE. No React, no DOM, no file writing. The three exporters read this.
// ---------------------------------------------------------------------------

import { FITTING_LUMENS } from './settings.js';

const MM_PER_FT = 304.8;
const M_PER_FT = 0.3048;

/**
 * The catalogue. Wattage and beam angle are the two things a schedule is asked
 * for and the two things a drawing cannot know, so they live here as stated
 * values rather than being derived from anything.
 *
 * `unit` is what the quantity means: 'nos' for a countable fitting, 'm' for
 * something bought by length. It exists because a BOQ that reports "12" for
 * strip lighting has told the reader nothing about whether that is twelve
 * pieces or twelve metres.
 */
export const FIXTURES = [
  { id: 'small',  label: 'Recessed downlight — small', unit: 'nos',
    watts: 7,  beam: 36, lumens: FITTING_LUMENS.small,
    note: 'ambient grid, one per cell' },
  { id: 'large',  label: 'Recessed downlight — large', unit: 'nos',
    watts: 12, beam: 60, lumens: FITTING_LUMENS.large,
    note: 'ambient grid, serves a pair of cells' },
  { id: 'spot',   label: 'Directional spot', unit: 'nos',
    // 450 lm at 5 W is the ordinary efficacy of a narrow-beam COB, and it is
    // STATED here for the same reason the wattage is: a drawing cannot know it.
    watts: 5,  beam: 30, lumens: 450,
    note: 'aimed at a task surface' },
  { id: 'sconce', label: 'Wall sconce', unit: 'nos',
    // NULL, NOT ZERO, and the difference matters downstream: zero would sum
    // into the connected load as a fitting that draws nothing, which is a
    // claim. Null means "not specified here", and the total says so.
    watts: null, beam: null, lumens: null,
    note: 'accent — wattage by fitting selection' },
  { id: 'strip',  label: 'LED strip', unit: 'm',
    // PER METRE, both of them, because that is how a strip is bought and how it
    // is specified. A total for "the strip" is meaningless without a length.
    watts: null, wattsPerM: 9.6, beam: null, lumens: null, lumensPerM: 850,
    note: 'accent — concealed cove / under-cabinet' },
];

/** Placed on the ceiling, counted, and deliberately not billed. */
export const COORDINATION = [
  { id: 'fan',        label: 'Ceiling fan' },
  { id: 'chandelier', label: 'Chandelier / pendant' },
  { id: 'ac',         label: 'AC ceiling unit' },
  { id: 'trapdoor',   label: 'Trap door / access panel' },
];

export const FIXTURE_BY_ID = Object.fromEntries(FIXTURES.map((f) => [f.id, f]));
export const BILLED_IDS = FIXTURES.map((f) => f.id);

/**
 * The whole plan -> a schedule.
 *
 * Everything arrives in the spaces it already lives in, and this converts:
 * lights are per-room objects with a `kind`, accents are plan-pixel zones with
 * a `runLength` in pixels, ceiling objects are held in feet. `pxPerFt` is what
 * turns a strip's pixel run into metres, and without it the strips are counted
 * but not measured — which is the honest outcome of not having a scale.
 */
export function buildBOQ({ rooms = [], accents = [], spots = [], objects = [],
                           fans = [], pxPerFt = null, plan = null } = {}) {
  const lit = rooms.filter((r) => r.plan?.ok);

  // --- per room
  const byRoom = lit.map((r) => {
    const q = { small: 0, large: 0, spot: 0, sconce: 0, strip: 0 };

    for (const l of r.plan.lights) {
      if (l.kind === 'large') q.large++; else q.small++;
    }
    for (const s of spots) if (s.roomId === r.id) q.spot++;

    for (const z of accents) {
      if (z.roomId !== r.id || z.rejected) continue;
      if (z.type === 'sconce') q.sconce++;
      else if (z.type === 'strip') {
        // METRES, and a run with no length is still a run. A strip whose length
        // could not be derived is counted as a piece with zero metres rather
        // than dropped, because "there is a strip here" is the part the drawing
        // is sure about.
        q.strip += runMetres(z, pxPerFt) ?? 0;
      }
    }

    return {
      id: r.id,
      name: r.outline?.name || 'Space',
      areaSqft: r.plan.stats?.areaSqft ?? null,
      qty: q,
      // Strips counted as PIECES as well as metres: a contractor buys metres and
      // installs runs, and the number of runs is what tells him how many drivers
      // and how many end caps.
      stripRuns: accents.filter((z) => z.roomId === r.id && !z.rejected && z.type === 'strip').length,
    };
  });

  // --- the totals, which are what actually gets ordered
  const total = { small: 0, large: 0, spot: 0, sconce: 0, strip: 0 };
  let stripRuns = 0;
  for (const r of byRoom) {
    for (const k of Object.keys(total)) total[k] += r.qty[k];
    stripRuns += r.stripRuns;
  }

  const lines = FIXTURES.map((f) => {
    const qty = total[f.id] ?? 0;
    const load = f.unit === 'm'
      ? (f.wattsPerM != null ? qty * f.wattsPerM : null)
      : (f.watts != null ? qty * f.watts : null);
    return {
      ...f,
      qty: f.unit === 'm' ? round(qty, 2) : qty,
      pieces: f.id === 'strip' ? stripRuns : qty,
      load: load == null ? null : round(load, 1),
    };
  }).filter((l) => l.qty > 0 || l.pieces > 0);

  // --- the coordination items
  const coord = COORDINATION.map((c) => {
    let n = objects.filter((o) => o.kind === c.id).length;
    // The detector's red fan markers are fans too, and they are held somewhere
    // else entirely. A drawing with three detected fans and one placed by hand
    // has four fans on it.
    if (c.id === 'fan') n += fans.length;
    return { ...c, qty: n };
  }).filter((c) => c.qty > 0);

  // CONNECTED LOAD, over the lines that state a wattage. Reported with a count
  // of what it excludes rather than as a bare number, because a load figure
  // that quietly omits eight sconces is worse than no load figure: the reader
  // cannot tell it is incomplete.
  const stated = lines.filter((l) => l.load != null);
  const unstated = lines.filter((l) => l.load != null ? false : l.qty > 0);
  const watts = round(stated.reduce((s, l) => s + l.load, 0), 1);

  const areaSqft = round(byRoom.reduce((s, r) => s + (r.areaSqft ?? 0), 0), 1);

  return {
    plan: plan ?? null,
    pxPerFt,
    scaled: !!pxPerFt,
    rooms: byRoom,
    lines,
    coordination: coord,
    totals: {
      fittings: lines.filter((l) => l.unit === 'nos').reduce((s, l) => s + l.qty, 0),
      stripMetres: round(total.strip, 2),
      stripRuns,
      watts,
      unstated: unstated.map((l) => ({ id: l.id, label: l.label, qty: l.qty })),
      areaSqft,
      wattsPerSqft: areaSqft > 0 ? round(watts / areaSqft, 2) : null,
    },
  };
}

/**
 * One strip run, in metres.
 *
 * MEASURED FROM THE GEOMETRY, EVERY TIME. This used to prefer a `runFt` field
 * that App.jsx stamped onto the zone when the accent pass placed it, on the
 * reasoning that a length already converted to feet is the better source. It is
 * the worse source, and the bug it caused is the reason this comment is here:
 * dragging a strip's end updates `run` and `runLength` and cannot update
 * `runFt`, because the edit happens in plan pixels and knows nothing about the
 * scale. So a strip stretched from 3 ft to 12 ft went on reporting 3 ft in the
 * schedule and in the accent panel, for the rest of the session.
 *
 * `runLength` in plan pixels plus the live px/ft is the only pair that cannot go
 * stale, because neither half is a copy of anything. A strip on a drawing with
 * no scale is still a real strip of unknown length, and null says so.
 */
export function runMetres(zone, pxPerFt) {
  if (!Number.isFinite(zone?.runLength) || !(pxPerFt > 0)) return null;
  return (zone.runLength / pxPerFt) * M_PER_FT;
}

/**
 * WHAT A FITTING IS, for the card that comes up under the cursor.
 *
 * Reads the catalogue above and nothing else. The point of routing the tooltip
 * through here rather than writing the numbers into the canvas is that the
 * schedule and the tooltip then cannot disagree: a 7 W downlight is 7 W in both
 * places because there is one 7 in the codebase. A tooltip that says 9 W over a
 * fitting the BOQ bills at 7 is worse than no tooltip.
 *
 * `metres` is passed for a strip, which is the one fitting whose specification
 * depends on how long the run happens to be.
 */
export function specsFor(kind, { metres = null } = {}) {
  const f = FIXTURE_BY_ID[kind];
  if (!f) return null;
  const rows = [];
  if (f.unit === 'm') {
    rows.push(['Run', metres != null ? `${metres.toFixed(2)} m` : 'no scale']);
    if (f.wattsPerM != null) rows.push(['Rating', `${f.wattsPerM} W/m`]);
    if (f.wattsPerM != null && metres != null) {
      rows.push(['Load', `${round(metres * f.wattsPerM, 1)} W`]);
    }
    if (f.lumensPerM != null) rows.push(['Output', `${f.lumensPerM} lm/m`]);
  } else {
    // "set by fitting" and not a dash: a sconce has a wattage, it is simply not
    // ours to state, and a dash reads as "nobody filled this in".
    rows.push(['Wattage', f.watts != null ? `${f.watts} W` : 'set by fitting']);
    if (f.beam != null) rows.push(['Beam angle', `${f.beam}°`]);
    if (f.lumens != null) rows.push(['Output', `${f.lumens} lm`]);
  }
  return { id: f.id, label: f.label, note: f.note, rows };
}

export function round(n, dp = 0) {
  if (!Number.isFinite(n)) return null;
  const k = 10 ** dp;
  return Math.round(n * k) / k;
}

/** How a quantity reads on a schedule: an integer count, or metres to 2dp. */
export function fmtQty(line) {
  if (line.unit === 'm') return `${(line.qty ?? 0).toFixed(2)} m`;
  return String(line.qty ?? 0);
}

export function fmtWatts(line) {
  if (line.unit === 'm') return line.wattsPerM != null ? `${line.wattsPerM} W/m` : '—';
  return line.watts != null ? `${line.watts} W` : '—';
}

export function fmtBeam(line) {
  return line.beam != null ? `${line.beam}°` : '—';
}

/**
 * The schedule as a rectangular table — header row plus body rows, all strings.
 *
 * ONE SHAPE, THREE FILES. The CSV, the spreadsheet and the PDF are three
 * encodings of the same grid, and the moment each builds its own the three
 * drift: a column gets added to the CSV and not the PDF, a total is rounded
 * differently in the spreadsheet. So the table is built once, here, and the
 * exporters only know how to write a grid.
 */
export function boqTable(boq, { perRoom = true } = {}) {
  const rows = [];
  const money = null;   // no rates yet — see Known limits

  rows.push(['LIGHTING SCHEDULE']);
  if (boq.plan) rows.push([`Plan: ${boq.plan}`]);
  rows.push([`Rooms: ${boq.rooms.length}`,
             `Area: ${boq.totals.areaSqft ?? '—'} sqft`,
             boq.scaled ? `Scale: ${boq.pxPerFt.toFixed(2)} px/ft` : 'Scale: not set']);
  rows.push([]);

  rows.push(['Item', 'Description', 'Qty', 'Unit', 'Wattage', 'Beam', 'Load (W)', 'Notes']);
  boq.lines.forEach((l, i) => {
    rows.push([
      String(i + 1),
      l.label,
      l.unit === 'm' ? (l.qty ?? 0).toFixed(2) : String(l.qty ?? 0),
      l.unit,
      fmtWatts(l),
      fmtBeam(l),
      l.load == null ? '—' : String(l.load),
      l.id === 'strip' && l.pieces ? `${l.pieces} run${l.pieces === 1 ? '' : 's'} · ${l.note}` : l.note,
    ]);
  });

  rows.push([]);
  rows.push(['', 'Total fittings', String(boq.totals.fittings), 'nos', '', '',
             String(boq.totals.watts), '']);
  if (boq.totals.stripMetres > 0) {
    rows.push(['', 'Total LED strip', boq.totals.stripMetres.toFixed(2), 'm', '', '', '', '']);
  }
  if (boq.totals.unstated.length) {
    // THE EXCLUSION IS A NOTE, NOT A QUANTITY, and it took a rendered PDF to see
    // it: "6 × wall sconce" in the Qty column is a sentence in a column three
    // characters wide, and it came out as "6 × w..". It belongs where the other
    // sentences are.
    rows.push(['', 'Load excludes', '', '', '', '', '', boq.totals.unstated
      .map((u) => `${u.qty} × ${u.label.toLowerCase()}`).join(', ') + ' — wattage not specified']);
  }
  if (boq.totals.wattsPerSqft != null) {
    rows.push(['', 'Connected load', String(boq.totals.wattsPerSqft), 'W/sqft', '', '', '', '']);
  }

  if (boq.coordination.length) {
    rows.push([]);
    rows.push(['CEILING ITEMS — coordination only, not billed']);
    rows.push(['Item', 'Description', 'Qty', 'Unit', '', '', '', '']);
    boq.coordination.forEach((c, i) => {
      rows.push([String(i + 1), c.label, String(c.qty), 'nos', '', '', '', '']);
    });
  }

  if (perRoom && boq.rooms.length) {
    rows.push([]);
    rows.push(['SPACE BREAKDOWN']);
    rows.push(['Space', 'Area (sqft)', 'Small', 'Large', 'Spots', 'Sconces', 'Strip (m)', '']);
    for (const r of boq.rooms) {
      rows.push([
        r.name,
        r.areaSqft == null ? '—' : String(round(r.areaSqft, 1)),
        String(r.qty.small), String(r.qty.large), String(r.qty.spot),
        String(r.qty.sconce), r.qty.strip ? r.qty.strip.toFixed(2) : '—', '',
      ]);
    }
  }

  return rows;
}

// --- the spreadsheet model --------------------------------------------------
//
// A SECOND, RICHER MODEL OF THE SAME SCHEDULE, and it earns the duplication.
//
// boqTable() above is a grid of strings, which is exactly right for a CSV and a
// PDF: both are pictures of a table and neither can compute anything. A
// spreadsheet is not a picture of a table. It is a table, and handing somebody
// one whose totals are typed-in text is handing them something they have to
// re-do before they can price it.
//
// THE UNITS HAVE TO LEAVE THE CELL TEXT for any of this to work. "7 W" and "36°"
// as strings are the whole reason nothing could be computed: a cell containing
// "7 W" cannot be multiplied. So the number goes in the cell and the unit goes
// in the NUMBER FORMAT — `0" W"` displays 7 as `7 W`, and `=C6*E6` works. This
// is how a real schedule is built and it is the single change that turns the
// export from a printout into a spreadsheet.
//
// AND THE TOTALS BECOME FORMULAS, which is more than a convenience. A SUM() over
// the line items is computed by Excel from the same cells the reader is looking
// at, so it cannot disagree with them — not even if the code above is wrong.
// Change a quantity in the sheet and the load, the totals and the W/sqft all
// follow. The per-room sheet then cross-checks itself against the schedule with
// a formula that says OK or MISMATCH out loud.
//
// TWO SHEETS, because one sheet cannot have two column layouts: `Description` in
// column B wants 30 characters and `Area` wants 8. Splitting them is also how
// anyone would build this by hand.
//
// Cells are { v, t, f, s }: value, type ('n' or 's'), an optional formula, and a
// style name resolved in boqExport.js. Nothing here knows what XML looks like.
// ---------------------------------------------------------------------------

const txt = (v, s = 'label') => ({ v: v == null ? '' : String(v), t: 's', s });
const n = (v, s = 'num') => (Number.isFinite(v) ? { v, t: 'n', s } : { v: '', t: 's', s });
const fx = (f, cached, s = 'num') => ({ v: Number.isFinite(cached) ? cached : '', t: 'n', f, s });
const gap = () => [];

/** A1-style column letter. Duplicated from boqExport for the formulas' sake. */
export function colLetter(i) {
  let s = '', x = i + 1;
  while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

export const SHEET_SCHEDULE = 'Schedule';
export const SHEET_ROOMS = 'By space';

export function boqSheets(boq) {
  // --- sheet 1: the schedule
  const rows = [];
  const at = () => rows.length + 1;          // the 1-based row a push would land on
  const ref = (col, row) => `${colLetter(col)}${row}`;

  rows.push([txt('LIGHTING SCHEDULE', 'title')]);
  rows.push([txt(boq.plan ? `Plan: ${boq.plan}` : 'Lighting schedule', 'sub')]);
  // THE THREE FACTS, ONE PER ROW, IN COLUMNS B AND C.
  //
  // They were one row of label/value pairs across A..F, and a LibreOffice render
  // showed why that does not work: column A is the 4-character `#` column, so
  // "Rooms" came out as "Room", and `20.00 px/ft` in the 8-wide Beam column came
  // out as `###`. A cell whose value does not fit its column shows hashes, which
  // is a spreadsheet telling you it has given up. Stacked in the two widest
  // columns, they always fit — and it reads like a document header rather than
  // like a row of a table that is not there.
  const meta = [['Rooms', n(boq.rooms.length, 'subNum')],
                ['Area', n(boq.totals.areaSqft, 'area')],
                ['Scale', boq.scaled ? n(boq.pxPerFt, 'scale') : txt('not set', 'sub')]];
  for (const [label, cell] of meta) rows.push([txt(''), txt(label, 'sub'), cell]);
  rows.push(gap());

  const headRow = at();
  rows.push([
    txt('#', 'h'), txt('Description', 'h'), txt('Qty', 'hr'), txt('Unit', 'hc'),
    txt('Rating', 'hr'), txt('Beam', 'hr'), txt('Load', 'hr'), txt('Notes', 'hi'),
  ]);

  const firstLine = at();
  const nosRows = [], allRows = [];
  boq.lines.forEach((l, i) => {
    const r = at();
    allRows.push(r);
    if (l.unit === 'nos') nosRows.push(r);
    const rating = l.unit === 'm' ? l.wattsPerM : l.watts;
    const ratingStyle = l.unit === 'm' ? 'wattM' : 'watt';
    // NO RATING, NO LOAD — and the test is ISNUMBER rather than `=""`.
    //
    // A sconce's rating cell shows an em dash, because a blank there reads as
    // "nobody filled this in" whereas the dash says "deliberately not
    // specified". `IF(E9="",…)` is false against an em dash, so the formula went
    // on to compute `6 × "—"` and the cell showed #VALUE!. ISNUMBER does not
    // care what the cell says, only whether there is a number in it to multiply,
    // which is the actual question. SUM() then skips the empty result either
    // way, so the total is right without anyone having to know that.
    const loadFx = `IF(ISNUMBER(${ref(4, r)}),${ref(2, r)}*${ref(4, r)},"")`;
    rows.push([
      n(i + 1, 'idx'),
      txt(l.label, 'bold'),
      n(l.unit === 'm' ? l.qty : l.qty, l.unit === 'm' ? 'metres' : 'num'),
      txt(l.unit, 'unit'),
      rating == null ? txt('—', 'unitC') : n(rating, ratingStyle),
      l.beam == null ? txt('—', 'unitC') : n(l.beam, 'beam'),
      fx(loadFx, l.load, 'load'),
      txt(l.id === 'strip' && l.pieces
        ? `${l.pieces} run${l.pieces === 1 ? '' : 's'} · ${l.note}` : l.note, 'noteI'),
    ]);
  });

  const totalRow = at();
  // A RANGE WHERE THE ROWS ARE CONTIGUOUS, which they always are in practice.
  // `SUM(C6:C9)` is what a person would write, and — the part that matters — a
  // row inserted inside it is picked up automatically, where `SUM(C6,C7,C8,C9)`
  // would silently ignore it.
  const sumOf = (col, list) => {
    if (!list.length) return '0';
    const contiguous = list.every((r, i) => i === 0 || r === list[i - 1] + 1);
    return contiguous && list.length > 1
      ? `SUM(${ref(col, list[0])}:${ref(col, list[list.length - 1])})`
      : `SUM(${list.map((r) => ref(col, r)).join(',')})`;
  };
  rows.push([
    txt('', 'tot'),
    txt('Total', 'totBold'),
    fx(sumOf(2, nosRows), boq.totals.fittings, 'totNum'),
    txt('nos', 'totUnit'),
    txt('', 'tot'), txt('', 'tot'),
    fx(sumOf(6, allRows), boq.totals.watts, 'totLoad'),
    txt('', 'tot'),
  ]);

  const stripRow = boq.lines.find((l) => l.id === 'strip')
    ? allRows[boq.lines.findIndex((l) => l.id === 'strip')] : null;
  let metresRow = null;
  if (stripRow) {
    metresRow = at();
    // NO UNIT COLUMN ON THE SUMMARY ROWS. `0.00" m"` already prints the unit, so
    // filling D as well reads "5.94 m   m". The rows inside the table keep their
    // Unit column because their formats do not carry one.
    rows.push([txt(''), txt('Total LED strip', 'bold'),
               fx(`${ref(2, stripRow)}`, boq.totals.stripMetres, 'metres')]);
  }

  // The area now lives in C4 — see the meta block above.
  const areaRef = ref(2, 4);
  rows.push([txt(''), txt('Connected load', 'bold'),
    fx(`IF(${areaRef}>0,${ref(6, totalRow)}/${areaRef},"")`, boq.totals.wattsPerSqft, 'wpsf')]);

  if (boq.totals.unstated.length) {
    rows.push([txt(''), txt('Load excludes', 'bold'), null, null, null, null, null,
      txt(boq.totals.unstated.map((u) => `${u.qty} × ${u.label.toLowerCase()}`).join(', ')
        + ' — wattage is set when the fitting is chosen', 'caveatI')]);
  }

  let coordHead = null;
  if (boq.coordination.length) {
    rows.push(gap());
    rows.push([txt('CEILING ITEMS', 'section')]);
    rows.push([txt('Coordination only — on the drawing because they occupy ceiling, and not billed.', 'sub')]);
    coordHead = at();
    rows.push([txt('#', 'h'), txt('Description', 'h'), txt('Qty', 'hr'), txt('Unit', 'hc'),
               txt('', 'h'), txt('', 'h'), txt('', 'h'), txt('', 'h')]);
    boq.coordination.forEach((c, i) => {
      rows.push([n(i + 1, 'idx'), txt(c.label, 'bold'), n(c.qty, 'num'), txt('nos', 'unit')]);
    });
  }

  const schedule = {
    name: SHEET_SCHEDULE,
    rows,
    merges: [`A1:H1`, `A2:H2`],
    freeze: headRow,
    // Wide enough for the widest FORMATTED value each column can hold, which is
    // not the same as the widest raw number — `0.32` is four characters and
    // `0.32 W/sqft` is eleven, and the column has to fit the second one.
    cols: [4.5, 32, 11, 7, 11, 8, 11, 40],
    refs: { headRow, firstLine, totalRow, metresRow, allRows, nosRows, coordHead },
  };

  // --- sheet 2: the room breakdown, which checks itself
  const rrows = [];
  const rat = () => rrows.length + 1;
  rrows.push([txt('BY SPACE', 'title')]);
  rrows.push([txt('How a site is wired and how a contractor prices it.', 'sub')]);
  rrows.push(gap());
  const rHead = rat();
  rrows.push([txt('Space', 'h'), txt('Area', 'hr'), txt('Small', 'hr'), txt('Large', 'hr'),
              txt('Spots', 'hr'), txt('Sconces', 'hr'), txt('Strip', 'hr')]);
  const rFirst = rat();
  for (const r of boq.rooms) {
    rrows.push([
      txt(r.name, 'bold'), n(round(r.areaSqft, 0), 'area'),
      n(r.qty.small, 'num'), n(r.qty.large, 'num'), n(r.qty.spot, 'num'),
      n(r.qty.sconce, 'num'), n(round(r.qty.strip, 2), 'metres'),
    ]);
  }
  const rLast = rrows.length;
  const rTotal = rat();
  const colSum = (c) => `SUM(${colLetter(c)}${rFirst}:${colLetter(c)}${rLast})`;
  const tot = (c, v, s = 'totNum') => fx(colSum(c), v, s);
  const sum = (k) => boq.rooms.reduce((a, r) => a + (r.qty[k] ?? 0), 0);
  rrows.push([
    txt('Total', 'totBold'),
    tot(1, boq.totals.areaSqft, 'totArea'),
    tot(2, sum('small')), tot(3, sum('large')), tot(4, sum('spot')),
    tot(5, sum('sconce')), tot(6, round(sum('strip'), 2), 'totMetres'),
  ]);

  // THE CROSS-CHECK, and it is the reason this sheet is worth having as a sheet.
  // A BOQ whose breakdown disagrees with its total is worthless, and until now
  // that was a claim made by a unit test the reader cannot see. Here it is an
  // assertion the spreadsheet makes about itself, in front of them.
  const q = (id) => {
    const i = boq.lines.findIndex((l) => l.id === id);
    return i < 0 ? null : `${SHEET_SCHEDULE}!C${schedule.refs.allRows[i]}`;
  };
  const pairs = [[2, 'small'], [3, 'large'], [4, 'spot'], [5, 'sconce']]
    .map(([c, id]) => { const cell = q(id); return cell ? `${colLetter(c)}${rTotal}=${cell}` : null; })
    .filter(Boolean);
  rrows.push(gap());
  if (pairs.length) {
    rrows.push([txt('Check', 'bold'),
      { v: 'OK — matches the schedule', t: 's', s: 'check',
        f: `IF(AND(${pairs.join(',')}),"OK — matches the schedule","MISMATCH")` }]);
  }

  const byRoom = {
    name: SHEET_ROOMS,
    rows: rrows,
    merges: ['A1:G1', 'A2:G2'],
    freeze: rHead,
    cols: [26, 12, 9, 9, 9, 10, 11],
    refs: { rHead, rFirst, rLast, rTotal },
  };

  return boq.rooms.length ? [schedule, byRoom] : [schedule];
}
