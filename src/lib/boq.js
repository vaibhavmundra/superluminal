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
//   track profile                -      -      the carrier, billed in METRES
//   track corner join            -      -      one per turn of a closed track
//   track spot, ambient         7W   36 deg    the grid's cell light, on a track
//   track spot, directional     5W   30 deg    an aimed spot, on a track
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
  { id: 'small-narrow', label: 'Recessed downlight — small, narrow beam', unit: 'nos',
    // THE SAME LAMP AS THE SPOT, IN THE GRID. 5 W at 30 degrees, in a wet room
    // whose cells are 18 sqft rather than 50 — a smaller cell wants a tighter
    // cone, and a 36-degree 7 W fitting over a 4ft cell spills onto the walls
    // instead of the floor. It is a separate LINE from `spot` and not a reuse of
    // it because the two are bought for different reasons and a schedule that
    // merges them cannot be read: a spot is aimed at a task surface, this is
    // ambient, and the electrician wiring a WC needs to know which.
    watts: 5, beam: 30, lumens: 450,
    note: 'ambient grid in a wet room, one per cell' },
  { id: 'spot',   label: 'Directional spot', unit: 'nos',
    // 450 lm at 5 W is the ordinary efficacy of a narrow-beam COB, and it is
    // STATED here for the same reason the wattage is: a drawing cannot know it.
    watts: 5,  beam: 30, lumens: 450,
    note: 'aimed at a task surface' },
  { id: 'art-spot', label: 'Directional spot — artwork, narrow beam', unit: 'nos',
    // A SEPARATE LINE AT 24 DEGREES, for the same reason `small-narrow` is a
    // separate line from this one: a schedule that merges two fittings with
    // different beam angles cannot be ordered from. The lamp and the wattage
    // are the same COB; the optic is not, and the optic is the specification.
    //
    // 24 rather than 30 because of what it is aimed at. A task spot lights a
    // plane you work at from three or four feet above it and the pool should be
    // wider than the desk. A picture is lit from a metre or more off the wall at
    // an angle, and the beam has to land ON the piece — a wider cone throws a
    // bright halo on the plaster around the frame and washes it out.
    watts: 5, beam: 24, lumens: 450,
    note: 'aimed at wall art — one per 2 ft of width' },
  // --- THE TRACK, AND WHY IT IS FOUR LINES AND NOT ONE ---------------------
  //
  // A track is a CARRIER plus MODULES, and a schedule that merged them could
  // not be ordered from: you buy the profile by the length, the corners by the
  // turn, and the modules by the number. Four lines is the least that can be
  // priced.
  //
  // THE MODULES ARE TWO LINES AND NOT FIVE. Everywhere else in this catalogue a
  // different beam angle earns its own line, because the optic is the
  // specification. A track module range is not shaped that way: it is an
  // ambient head and a directional head, and a 12 W 60-degree recessed
  // downlight absorbed into a track is bought as the ambient head — there is no
  // track equivalent of it to buy. So the two lines are the two products, and
  // the stated 7 W / 36 deg and 5 W / 30 deg are what those products are. It is
  // the one place where absorbing a fitting into a track changes what it
  // delivers, and it is stated here rather than hidden in the geometry.
  { id: 'track-profile', label: 'Track — profile', unit: 'm',
    // PASSIVE. The profile is a busbar in an extrusion: it draws nothing, the
    // heads clipped into it draw everything. `passive` says that, and the
    // difference from `watts: null` matters — null means "not specified here"
    // and lands the line in the schedule's list of omissions, which would read
    // as though somebody had forgotten to fill it in.
    watts: null, wattsPerM: null, passive: true, beam: null, lumens: null,
    note: 'carries the track heads — measured to the nearest metre' },
  { id: 'track-corner', label: 'Track — corner join', unit: 'nos',
    watts: null, passive: true, beam: null, lumens: null,
    note: 'moulded corner piece — one per turn of a closed track' },
  { id: 'track-ambient', label: 'Track spot — ambient', unit: 'nos',
    watts: 7, beam: 36, lumens: FITTING_LUMENS.small,
    note: 'ambient grid, clipped into a track' },
  { id: 'track-spot', label: 'Track spot — directional', unit: 'nos',
    watts: 5, beam: 30, lumens: 450,
    note: 'aimed at a surface, clipped into a track' },
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
  { id: 'reverse-cove', label: '8" reverse cove', unit: 'm',
    // THE SAME TAPE AND A DIFFERENT PRODUCT, which is the distinction a
    // schedule exists to make. What is bought here is not a length of strip: it
    // is a 200mm slot formed in the ceiling at the wall, with the tape at its
    // inner lip washing the wall below. The plasterboard, the shadow gap and the
    // setting-out are the item; the tape is a component of it.
    //
    // So it is billed by the metre like the strip — a slot is linear and is
    // priced that way — at the same rating, because it is the same tape in it.
    // Merging the two lines would tell a contractor to buy nine metres of strip
    // and nothing about the nine metres of ceiling detail that has to be built
    // to put it in.
    //
    // AND THE TOOLTIP READS THIS LINE. Same argument as everywhere else in this
    // file: the card under the pointer and the schedule cannot disagree,
    // because there is one place the words and the numbers come from.
    watts: null, wattsPerM: 9.6, beam: null, lumens: null, lumensPerM: 850,
    note: 'accent — washes a panelled or papered wall' },
];

/**
 * Placed on the plan, counted, and deliberately not billed.
 *
 * IT WAS "PLACED ON THE CEILING" AND TWO OF THESE ARE NOT. A split AC's indoor
 * unit is on a wall and a geyser is over a door; they are here for the reason
 * the other four are — somebody else supplies them, this drawing has to
 * coordinate with them, and a schedule that omits them is a schedule the
 * electrician has to be told about separately. What they do NOT do, unlike a
 * cassette or a hatch, is move a light: see `offCeiling` in ceilingObjects.js.
 */
export const COORDINATION = [
  { id: 'fan',        label: 'Ceiling fan' },
  { id: 'chandelier', label: 'Chandelier / pendant' },
  { id: 'ac',         label: 'AC cassette unit' },
  { id: 'split_ac',   label: 'Split AC indoor unit' },
  { id: 'geyser',     label: 'Geyser / water heater' },
  { id: 'trapdoor',   label: 'Trap door / access panel' },
];

export const FIXTURE_BY_ID = Object.fromEntries(FIXTURES.map((f) => [f.id, f]));
export const BILLED_IDS = FIXTURES.map((f) => f.id);

/**
 * WHAT A FITTING BECOMES WHEN A TRACK SWALLOWS IT.
 *
 * A recessed downlight and a track head are two products. They light the same
 * cell from the same point and an electrician orders them from different pages,
 * so the moment a fitting is absorbed into a track (see track.js) the line it
 * is bought on changes — and this is the one place that mapping lives, so the
 * drawing's tooltip, the schedule and the DXF cannot disagree about it.
 */
export const TRACK_FIXTURE = {
  small: 'track-ambient',
  large: 'track-ambient',
  'small-narrow': 'track-ambient',
  spot: 'track-spot',
  'art-spot': 'track-spot',
};

/** The track line for a fitting id, or the id unchanged when there is none. */
export const trackFixtureFor = (id) => TRACK_FIXTURE[id] ?? id;

/**
 * ONE TRACK RUN, IN WHOLE METRES.
 *
 * ROUNDED PER RUN AND NOT PER PLAN, because a run is what gets bought: profile
 * comes in lengths, is cut on site, and a 4.3 m track is a 5 m order however
 * many other tracks are on the drawing. Summing first and rounding once would
 * report a total nobody can turn into a purchase.
 *
 * AND NEVER DOWN TO ZERO. A track a metre and a half long is one metre of
 * profile by the arithmetic and one length of profile in the van; rounding a
 * real run out of existence is the one error this must not make.
 */
export const trackMetres = (lengthFt) => (
  lengthFt > 0 ? Math.max(1, Math.round(lengthFt * M_PER_FT)) : 0);

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
                           pxPerFt = null, plan = null } = {}) {
  const lit = rooms.filter((r) => r.plan?.ok);

  // --- per room
  const byRoom = lit.map((r) => {
    // SEEDED FROM THE CATALOGUE, not from a list written out here. It was
    // written out here, and adding the four track lines is exactly the change
    // that would have left them silently missing from every room: a key absent
    // from this object is a key the totals loop below never sees.
    const q = Object.fromEntries(BILLED_IDS.map((id) => [id, 0]));

    // BY `fixture`, FALLING BACK TO `kind`. The planner only ever emits 'small'
    // and 'large' — those are geometry, not product — and the room's type then
    // decides which catalogue line a small light is bought as. See
    // FIXTURE_BY_TYPE in roomTypes.js. The fallback matters for a plan saved
    // before this existed, whose lights carry no `fixture` at all.
    for (const l of r.plan.lights) {
      const id = l.fixture || (l.kind === 'large' ? 'large' : 'small');
      if (q[id] == null) q[id] = 0;
      q[id]++;
    }
    // BY `fixture`, LIKE THE LIGHTS ABOVE. A spot aimed at a painting and one
    // aimed at a desk are the same symbol on the drawing and two different lines
    // on the schedule, and the spot itself is what knows which it is.
    for (const s of spots) {
      if (s.roomId !== r.id || s.rejected) continue;
      const id = s.fixture || 'spot';
      if (q[id] == null) q[id] = 0;
      q[id]++;
    }

    for (const z of accents) {
      if (z.roomId !== r.id || z.rejected) continue;
      if (z.type === 'sconce') q.sconce++;
      else if (z.type === 'strip') {
        // BY `fixture`, LIKE THE LIGHTS AND THE SPOTS. Every linear run on this
        // drawing is `type: 'strip'` — that is what makes the canvas, the
        // schedule and the DXF take all of them without knowing what a cove is —
        // and the PRODUCT is a separate question the run itself answers.
        const id = z.fixture || 'strip';
        if (q[id] == null) q[id] = 0;
        // METRES, and a run with no length is still a run. A strip whose length
        // could not be derived is counted as a piece with zero metres rather
        // than dropped, because "there is a strip here" is the part the drawing
        // is sure about.
        q[id] += runMetres(z, pxPerFt) ?? 0;
      }
    }

    // THE TRACKS. Not accents and deliberately not routed through the accent
    // list the coves use: a cove's deliverable IS a length of tape, so shaping
    // it as an accent zone was the honest thing to do. A track's deliverable is
    // a profile with heads in it, the heads are already counted above off the
    // lights themselves, and the profile is measured from the runs the ceiling
    // design produced. `r.tracks` is that, one entry per chunk that got one.
    for (const t of r.tracks ?? []) {
      q['track-profile'] += trackMetres(t.lengthFt ?? 0);
      q['track-corner'] += t.corners ?? 0;
    }

    return {
      id: r.id,
      name: r.outline?.name || 'Space',
      areaSqft: r.plan.stats?.areaSqft ?? null,
      qty: q,
      // Strips counted as PIECES as well as metres: a contractor buys metres and
      // installs runs, and the number of runs is what tells him how many drivers
      // and how many end caps.
      // PIECES PER PRODUCT. A contractor buys metres and installs runs, and the
      // number of runs is what tells him how many drivers and end caps — so it
      // has to be counted per line, not once for every linear thing on the plan.
      runsBy: (r.tracks ?? []).reduce((m, t) => {
        // A CLOSED TRACK IS ONE PIECE AND A PAIR OF PARALLEL RUNS IS TWO, which
        // is the same question `pieces` answers for a strip: how many end caps,
        // how many drivers, how many feeds. track.js decides it, because it is
        // the thing that knows whether the runs join up.
        m['track-profile'] = (m['track-profile'] ?? 0) + (t.pieces ?? 1);
        return m;
      }, accents.reduce((m, z) => {
        if (z.roomId !== r.id || z.rejected || z.type !== 'strip') return m;
        const id = z.fixture || 'strip';
        m[id] = (m[id] ?? 0) + 1;
        return m;
      }, {})),
    };
  });

  // --- the totals, which are what actually gets ordered
  // SEEDED FROM THE CATALOGUE AND SUMMED OVER WHAT THE ROOMS REPORTED, in that
  // order. It used to be seeded from a literal and summed over its own keys,
  // which meant a line the catalogue had and this literal did not was counted
  // per room and then dropped from the order — a failure that shows up as a
  // schedule quietly missing a product rather than as an error.
  const total = Object.fromEntries(BILLED_IDS.map((id) => [id, 0]));
  const runsBy = {};
  for (const r of byRoom) {
    for (const [k, n] of Object.entries(r.qty)) total[k] = (total[k] ?? 0) + n;
    for (const [k, n] of Object.entries(r.runsBy)) runsBy[k] = (runsBy[k] ?? 0) + n;
  }

  const lines = FIXTURES.map((f) => {
    const qty = total[f.id] ?? 0;
    // A PASSIVE LINE'S LOAD IS ZERO AND THAT IS A STATEMENT. See `passive` on
    // the track profile: null would put the line in the schedule's list of
    // omissions, telling the reader a figure is missing when the figure is nil.
    const load = f.passive ? 0
      : f.unit === 'm'
        ? (f.wattsPerM != null ? qty * f.wattsPerM : null)
        : (f.watts != null ? qty * f.watts : null);
    return {
      ...f,
      qty: f.unit === 'm' ? round(qty, 2) : qty,
      pieces: f.unit === 'm' ? (runsBy[f.id] ?? 0) : qty,
      load: load == null ? null : round(load, 1),
    };
  }).filter((l) => l.qty > 0 || l.pieces > 0);

  // --- the coordination items
  const coord = COORDINATION.map((c) => {
    // ONE SOURCE. There used to be two — these, and whatever the red-circle
    // detector found — and the schedule had to add them up. The detector is
    // gone; every fan on the ceiling is one somebody placed.
    const n = objects.filter((o) => o.kind === c.id).length;
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
      // ALL THE TAPE ON THE PLAN, over every line that is bought by the metre.
      // It was `total.strip` and that was the same number while there was one
      // linear line; with the reverse cove billed separately it would have gone
      // on reporting the strip alone and quietly dropped every metre of cove
      // from the summary the side panel prints.
      // ...AND NOT THE TRACK'S. A track profile is bought by the metre too, and
      // it is the second reason this figure cannot simply be "every linear
      // line": tape and extrusion are different orders from different
      // suppliers, and adding nine metres of track to the strip figure would
      // send somebody nine metres of the wrong product. `passive` is the test
      // because it is exactly the distinction — a linear LIGHT versus a linear
      // CARRIER — and it is already on the catalogue entry.
      stripMetres: round(lines.filter((l) => l.unit === 'm' && !l.passive)
        .reduce((n, l) => n + (l.qty ?? 0), 0), 2),
      stripRuns: lines.filter((l) => l.unit === 'm' && !l.passive)
        .reduce((n, l) => n + (l.pieces ?? 0), 0),
      // THE TRACK, ON ITS OWN TWO FIGURES. Metres and pieces, the same pair and
      // for the same reasons: a contractor buys the length and installs the
      // runs, and the number of runs is the number of feeds and end-cap sets.
      trackMetres: round(lines.filter((l) => l.id === 'track-profile')
        .reduce((n, l) => n + (l.qty ?? 0), 0), 0),
      trackRuns: lines.filter((l) => l.id === 'track-profile')
        .reduce((n, l) => n + (l.pieces ?? 0), 0),
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
  // A PROFILE AND A CORNER PIECE HAVE NO ELECTRICAL SPECIFICATION OF THEIR OWN,
  // and a card offering "Wattage: 0 W" over a length of extrusion invites the
  // reader to wonder what happened to the lamps. Say what the thing is instead.
  if (f.passive) {
    if (f.unit === 'm') {
      rows.push(['Run', metres != null ? `${metres.toFixed(2)} m` : 'no scale']);
    }
    rows.push(['Load', 'none — the heads draw']);
    return { id: f.id, label: f.label, note: f.note, rows };
  }
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
      l.unit === 'm' && l.pieces ? `${l.pieces} run${l.pieces === 1 ? '' : 's'} · ${l.note}` : l.note,
      // (every line bought by the metre reports its runs — the track included,
      //  which is why this tests the unit rather than the id)
    ]);
  });

  rows.push([]);
  rows.push(['', 'Total fittings', String(boq.totals.fittings), 'nos', '', '',
             String(boq.totals.watts), '']);
  if (boq.totals.stripMetres > 0) {
    rows.push(['', 'Total linear, all runs', boq.totals.stripMetres.toFixed(2), 'm', '', '', '', '']);
  }
  // THE TRACK ON ITS OWN ROW, for the reason `stripMetres` excludes it: tape and
  // extrusion are two orders from two suppliers, and one figure covering both
  // sends somebody the wrong product by the metre.
  if (boq.totals.trackMetres > 0) {
    rows.push(['', 'Total track profile', String(boq.totals.trackMetres), 'm', '', '',
               '', `${boq.totals.trackRuns} run${boq.totals.trackRuns === 1 ? '' : 's'}`]);
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
    // THE ART COLUMN IS THE TRAILING ONE, AND ONLY WHEN THERE IS ART. This
    // breakdown has always been eight columns wide with the last one blank —
    // the PDF's `rooms` layout reserves a share for it — so art spots go there
    // rather than widening a grid three exporters agree on. Omitted entirely on
    // a plan that never ran the render pass, because a column of zeros on every
    // schedule is a question the reader has to ask and answer for themselves.
    const artCol = boq.rooms.some((r) => (r.qty['art-spot'] ?? 0) > 0);
    const roomMetres = (r) => (r.qty.strip ?? 0) + (r.qty['reverse-cove'] ?? 0);
    rows.push(['Space', 'Area (sqft)', 'Small', 'Large', 'Spots', 'Sconces', 'Strip (m)',
               artCol ? 'Art spots' : '']);
    for (const r of boq.rooms) {
      rows.push([
        r.name,
        r.areaSqft == null ? '—' : String(round(r.areaSqft, 1)),
        String(r.qty.small), String(r.qty.large), String(r.qty.spot),
        // ALL THE TAPE IN THE ROOM, like the spreadsheet's column. This asks
        // "how much linear product goes in here", and a reverse cove is linear
        // product — it is a separate SCHEDULE line because it is a different
        // thing to order, not because it is in a different room.
        String(r.qty.sconce), roomMetres(r) ? roomMetres(r).toFixed(2) : '—',
        artCol ? String(r.qty['art-spot'] ?? 0) : '',
      ]);
    }

    // THE TRACK AS ITS OWN BLOCK, AND NOT TWO MORE COLUMNS ON THE ONE ABOVE.
    // That grid is eight columns wide and three exporters agree on the width —
    // the PDF's `rooms` layout reserves a share per column — so widening it to
    // carry a feature most plans do not use would cost every schedule some
    // legibility to serve a few. A block below it costs nothing on a plan with
    // no track, because it is not printed at all.
    if (boq.rooms.some((r) => (r.qty['track-profile'] ?? 0) > 0)) {
      rows.push([]);
      rows.push(['TRACK BY SPACE']);
      rows.push(['Space', 'Profile (m)', 'Corners', 'Ambient heads', 'Spot heads',
                 '', '', '']);
      for (const r of boq.rooms) {
        if (!(r.qty['track-profile'] ?? 0)) continue;
        rows.push([
          r.name,
          String(r.qty['track-profile'] ?? 0),
          String(r.qty['track-corner'] ?? 0),
          String(r.qty['track-ambient'] ?? 0),
          String(r.qty['track-spot'] ?? 0),
          '', '', '',
        ]);
      }
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
      txt(l.unit === 'm' && l.pieces
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

  // EVERY LINE BOUGHT BY THE METRE, added up. One line's cell was enough while
  // the strip was the only linear product; the reverse cove is a second, and a
  // "total" that silently means "total of the first one" is the worst kind of
  // wrong number to put in a spreadsheet somebody prices from.
  // ...AND `!l.passive` IS WHAT KEEPS THE TRACK OUT OF IT. A track profile is a
  // linear product and is not tape; see `stripMetres` in the totals.
  const metreRefs = boq.lines
    .map((l, i) => (l.unit === 'm' && !l.passive ? allRows[i] : null))
    .filter(Boolean);
  let metresRow = null;
  if (metreRefs.length) {
    metresRow = at();
    // NO UNIT COLUMN ON THE SUMMARY ROWS. `0.00" m"` already prints the unit, so
    // filling D as well reads "5.94 m   m". The rows inside the table keep their
    // Unit column because their formats do not carry one.
    rows.push([txt(''), txt('Total linear, all runs', 'bold'),
               fx(metreRefs.map((r2) => ref(2, r2)).join('+'),
                  boq.totals.stripMetres, 'metres')]);
  }

  const trackLine = boq.lines.findIndex((l) => l.id === 'track-profile');
  if (trackLine >= 0) {
    rows.push([txt(''), txt('Total track profile', 'bold'),
               fx(ref(2, allRows[trackLine]), boq.totals.trackMetres, 'num')]);
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
  // SAME CONDITIONAL COLUMN AS boqTable, and it has to be built as a spec here
  // rather than typed twice: this sheet computes its own totals and then CHECKS
  // them against the schedule, so a column added by hand in three places is a
  // column whose SUM() range or cross-check reference will eventually be one out.
  const artCol = boq.rooms.some((r) => (r.qty['art-spot'] ?? 0) > 0);
  // The same conditional treatment for the track, and here it CAN be two more
  // columns rather than a block of its own — this sheet's width is a spec, not a
  // fixed grid, and a spreadsheet column costs a reader nothing to scroll past.
  const trackCol = boq.rooms.some((r) => (r.qty['track-profile'] ?? 0) > 0);
  const RCOLS = [
    { head: 'Small',    id: 'small',     style: 'num',    w: 9 },
    { head: 'Large',    id: 'large',     style: 'num',    w: 9 },
    { head: 'Spots',    id: 'spot',      style: 'num',    w: 9 },
    ...(artCol ? [{ head: 'Art spots', id: 'art-spot', style: 'num', w: 11 }] : []),
    { head: 'Sconces',  id: 'sconce',    style: 'num',    w: 10 },
    // ALL THE TAPE IN THE ROOM, not just the line called `strip`. This column
    // answers "how much linear product goes in here", and a reverse cove is
    // linear product — it is only a separate SCHEDULE line because it is a
    // different thing to order, not because it is a different room.
    { head: 'Strip',    ids: ['strip', 'reverse-cove'], style: 'metres', w: 11, dp: 2 },
    // WHOLE METRES IN A PLAIN NUMBER COLUMN, not the `metres` style. That style
    // prints two decimals, which would claim a precision `trackMetres` has
    // already spent on purpose — and being a counted column rather than a metre
    // one is also what lets it join the cross-check below, since both sides are
    // integers and the float-equality problem the strip has does not arise.
    ...(trackCol ? [
      { head: 'Track (m)',   id: 'track-profile', style: 'num', w: 11 },
      { head: 'Ambient hds', id: 'track-ambient', style: 'num', w: 12 },
      { head: 'Spot hds',    id: 'track-spot',    style: 'num', w: 10 },
    ] : []),
  ];
  /** One column's quantity: a single line, or several summed. */
  const colQty = (q, c) => (c.ids ? c.ids.reduce((n2, id) => n2 + (q[id] ?? 0), 0) : (q[c.id] ?? 0));
  const rHead = rat();
  rrows.push([txt('Space', 'h'), txt('Area', 'hr'),
              ...RCOLS.map((c) => txt(c.head, 'hr'))]);
  const rFirst = rat();
  for (const r of boq.rooms) {
    rrows.push([
      txt(r.name, 'bold'), n(round(r.areaSqft, 0), 'area'),
      ...RCOLS.map((c) => n(c.dp != null ? round(colQty(r.qty, c), c.dp) : colQty(r.qty, c), c.style)),
    ]);
  }
  const rLast = rrows.length;
  const rTotal = rat();
  const colSum = (c) => `SUM(${colLetter(c)}${rFirst}:${colLetter(c)}${rLast})`;
  const tot = (c, v, s = 'totNum') => fx(colSum(c), v, s);
  const sum = (c) => boq.rooms.reduce((a, r) => a + colQty(r.qty, c), 0);
  rrows.push([
    txt('Total', 'totBold'),
    tot(1, boq.totals.areaSqft, 'totArea'),
    ...RCOLS.map((c, i) => tot(2 + i,
      c.dp != null ? round(sum(c), c.dp) : sum(c),
      c.style === 'metres' ? 'totMetres' : 'totNum')),
  ]);

  // THE CROSS-CHECK, and it is the reason this sheet is worth having as a sheet.
  // A BOQ whose breakdown disagrees with its total is worthless, and until now
  // that was a claim made by a unit test the reader cannot see. Here it is an
  // assertion the spreadsheet makes about itself, in front of them.
  const q = (id) => {
    const i = boq.lines.findIndex((l) => l.id === id);
    return i < 0 ? null : `${SHEET_SCHEDULE}!C${schedule.refs.allRows[i]}`;
  };
  // Every counted column checks itself against its own schedule line. The strip
  // is left out as it always was — it is metres here and metres there, and a
  // float equality between two roundings is a check that fails for no reason.
  const pairs = RCOLS
    .filter((c) => c.style !== 'metres')
    .map((c) => {
      const cell = q(c.id);   // the metre columns are excluded, so `id` is set
      return cell ? `${colLetter(2 + RCOLS.indexOf(c))}${rTotal}=${cell}` : null;
    })
    .filter(Boolean);
  rrows.push(gap());
  if (pairs.length) {
    rrows.push([txt('Check', 'bold'),
      { v: 'OK — matches the schedule', t: 's', s: 'check',
        f: `IF(AND(${pairs.join(',')}),"OK — matches the schedule","MISMATCH")` }]);
  }

  const lastCol = colLetter(1 + RCOLS.length);
  const byRoom = {
    name: SHEET_ROOMS,
    rows: rrows,
    merges: [`A1:${lastCol}1`, `A2:${lastCol}2`],
    freeze: rHead,
    cols: [26, 12, ...RCOLS.map((c) => c.w)],
    refs: { rHead, rFirst, rLast, rTotal },
  };

  return boq.rooms.length ? [schedule, byRoom] : [schedule];
}
