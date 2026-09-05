// ---------------------------------------------------------------------------
// switchboards.js — what is actually ON the plate, country by country.
//
// electrical.js answers WHERE a switchboard goes. This answers WHAT IT IS: how
// many modules wide, which switch is on it at which rating, where the sockets
// are, and how many blanks fill the frame out to a size you can buy. Those are
// two different questions and they belong in two files, because the first is
// geometry — a wall, a door, a bed — and the second is a parts list that
// changes completely the moment the project crosses a border.
//
// A COUNTRY IS DATA AND NOT A BRANCH. Everything that differs between India and
// the US is a value in COUNTRIES below: the unit ("module" against "gang"), the
// frame sizes you can order, the switch ratings that exist, and how many units
// each kind of point eats. Nothing downstream tests for a country code — it
// asks the country object — so the third country is an entry in that table and
// no edits anywhere else. That is the whole reason this file exists as a
// registry rather than as two functions with an `if` in them.
//
// FIFTEEN AMPS IS THE LINE, AND IT IS THE ONLY RULE THAT IS NOT PER-COUNTRY.
// A light, or a row of them, is switched at anything up to 15A — so the light
// switch is whatever the largest rating a country sells at or below fifteen is.
// India's ratings are 6/16/20/32 and the answer comes out 6A; the US sells
// 15/20 and the answer comes out 15A. Neither number is written down twice.
// See `lightSwitchA`.
//
// EVERY SOCKET NEEDS A SWITCH, and that is a fact about wiring rather than about
// layout: the switch does not have to be on the same plate, but it has to exist
// somewhere, and a schedule that counts sockets without counting their switches
// under-orders the job. So `socketWithSwitch` emits the pair, and every route
// that adds a socket goes through it.
//
// WHY THE SPARE PAIR. A room's board carries the switches its ceiling needs and
// then, in practice, one more socket than the drawing ever asked for — the one
// somebody plugs a lamp, a charger or a vacuum cleaner into. It is cheaper to
// have it on the plate on day one than to chase a wall later, so almost every
// board gets a low-power socket and its switch added on top of what the flows
// justify. It is marked `spare` so a caller can tell it apart from a point the
// design demanded.
//
// SPLITTING, NOT STRETCHING. A country's largest frame is a real ceiling: past
// eighteen modules in India there is no plate, there are two plates. So the
// points are packed into as many boards as they need, BALANCED rather than
// filled — nineteen modules is two boards of ten and nine (rounded up to twelve
// and twelve), not an eighteen and a one, because a lone switch in its own
// frame beside a full one is a thing nobody builds.
//
// AND THEN THE BLANKS. A board is only ever one of the sizes on the list, so
// five modules of points goes into a six-module frame and the sixth module is a
// blank plate. That is not padding for the drawing: it is a line item, it costs
// money, and the frame has a hole in it without one.
//
// PURE. No React, no canvas, no fetch, no database.
// ---------------------------------------------------------------------------

/**
 * THE LIGHTING THRESHOLD, in amps. A fitting or a row of them is switched at
 * this or below, whatever country it is in — see the header. It is a property
 * of what a light draws and not of where the building is, which is exactly why
 * it sits out here on its own instead of inside each country's entry.
 */
export const LIGHT_MAX_A = 15;

/**
 * WHAT CAN BE ON A PLATE, as kinds. The label is what a panel prints; `rated`
 * says whether an amperage means anything for it (a switch and a socket have
 * one, a data point does not).
 *
 * `other` IS A REAL ENTRY AND NOT A FALLBACK HOLE. Both countries' tables give
 * "other points" a size, so a kind this catalogue has not heard of still has a
 * width and still fills a frame — which is what stops an unknown point silently
 * costing zero modules and producing a board that does not fit its own contents.
 */
export const POINT_KINDS = {
  switch: { label: 'Switch', rated: true },
  socket: { label: 'Socket', rated: true },
  fan: { label: 'Fan regulator', rated: false },
  usb: { label: 'USB-C point', rated: false },
  data: { label: 'Data point', rated: false },
  blank: { label: 'Blank plate', rated: false },
  other: { label: 'Point', rated: false },
};

/**
 * THE COUNTRIES.
 *
 * ADD ONE BY ADDING AN ENTRY. The shape is the contract and every field is
 * required except `moduleOverrides`:
 *
 *   code            the key, and what gets stored on the project row
 *   name            what a panel prints
 *   aliases         everything a human might have typed into that column,
 *                   lower-cased — see `countryFor`, which is deliberately
 *                   forgiving because this value is free text in a database
 *   unit/units      "module"/"modules", "gang"/"gangs" — the word the UI uses
 *   boardSizes      the frames you can actually order, ascending. The last one
 *                   is the ceiling that forces a split.
 *   switchRatings   the switch amperages sold there, ascending
 *   modules         units eaten, by point kind
 *   moduleOverrides units eaten by one kind AT ONE RATING, keyed `kind:amps`.
 *                   India's 32A switch is the only member so far and it is why
 *                   this field exists: a 32A switch is physically wider than a
 *                   6A one, and that is a fact about the part rather than about
 *                   the kind.
 *
 * THE ADDITIONAL POINTS ARE NOT LISTED PER COUNTRY because they are the same
 * three everywhere — USB-C, data, blank. See `addablePoints`, which composes
 * them with the country's own switches and sockets.
 */
export const COUNTRIES = {
  IN: {
    code: 'IN',
    name: 'India',
    aliases: ['in', 'ind', 'india', 'bharat'],
    unit: 'module',
    units: 'modules',
    boardSizes: [1, 2, 3, 4, 6, 8, 12, 18],
    switchRatings: [6, 16, 20, 32],
    modules: {
      switch: 1,
      socket: 2,
      fan: 2,
      usb: 1,
      data: 1,
      blank: 1,
      other: 1,
    },
    moduleOverrides: { 'switch:32': 2 },
  },
  US: {
    code: 'US',
    name: 'United States',
    aliases: ['us', 'usa', 'united states', 'united states of america', 'america'],
    unit: 'gang',
    units: 'gangs',
    boardSizes: [1, 2, 3, 4],
    switchRatings: [15, 20],
    // ONE GANG FOR EVERYTHING, and it is not laziness in the table: a US device
    // box holds one device, whatever the device is, and a duplex receptacle is
    // one device. The uniformity is the fact.
    modules: {
      switch: 1,
      socket: 1,
      fan: 1,
      usb: 1,
      data: 1,
      blank: 1,
      other: 1,
    },
  },
};

/** What a project with nothing in its country column is taken to be. */
export const DEFAULT_COUNTRY = 'IN';

/**
 * A country column into a country, and it never returns nothing.
 *
 * FORGIVING ON PURPOSE. This value arrives from a database column somebody may
 * have typed by hand — "India", "in", "  IN  ", null — and the cost of getting
 * it wrong is a plate with the wrong parts on it rather than an error anybody
 * would notice. So codes, names and aliases all match, case and whitespace are
 * ignored, and anything unrecognised falls to the default rather than to null:
 * a board with India's modules on a project nobody classified is the answer the
 * brief asked for, and a board with no modules at all is not an answer.
 */
export function countryFor(code) {
  const want = String(code ?? '').trim().toLowerCase();
  if (want) {
    for (const c of Object.values(COUNTRIES)) {
      if (c.code.toLowerCase() === want) return c;
      if (c.name.toLowerCase() === want) return c;
      if (c.aliases.includes(want)) return c;
    }
  }
  return COUNTRIES[DEFAULT_COUNTRY];
}

/**
 * THE SWITCH A LIGHT GETS, in amps — the largest rating at or below the
 * lighting threshold. Derived and not stored, so a country that starts selling
 * a 10A switch needs one number added to `switchRatings` and nothing else.
 *
 * A COUNTRY WITH NO RATING UNDER THE LINE takes its smallest, because a light
 * still has to be switched by something and the smallest switch on sale is the
 * least wrong answer available.
 */
export function lightSwitchA(country) {
  const under = country.switchRatings.filter((a) => a <= LIGHT_MAX_A);
  return under.length ? Math.max(...under) : Math.min(...country.switchRatings);
}

/** How many modules (or gangs) one point eats. See `moduleOverrides`. */
export function modulesFor(country, point) {
  const kind = point?.kind ?? 'other';
  const byRating = point?.amps != null
    ? country.moduleOverrides?.[`${kind}:${point.amps}`] : undefined;
  return byRating ?? country.modules[kind] ?? country.modules.other ?? 1;
}

/** "6A switch", "Fan regulator", "Blank plate" — one point, in words. */
export function labelFor(country, point) {
  const spec = POINT_KINDS[point?.kind] ?? POINT_KINDS.other;
  if (spec.rated && point?.amps != null) return `${point.amps}A ${spec.label.toLowerCase()}`;
  return spec.label;
}

/** A point, with its width and its name worked out once. */
function point(country, p) {
  const full = { kind: 'other', amps: null, source: 'design', ...p };
  return { ...full, modules: modulesFor(country, full), label: labelFor(country, full) };
}

/**
 * A SOCKET AND THE SWITCH THAT CONTROLS IT, as a pair.
 *
 * ONE FUNCTION AND NOT TWO CALL SITES, because "every socket needs a switch" is
 * the kind of rule that survives exactly as long as there is one place that can
 * break it. The spare pair, the panel's "add a socket" and anything later that
 * wants an outlet all come through here, so a socket without a switch is not a
 * thing this file can produce.
 *
 * THE SWITCH IS AT THE SOCKET'S OWN RATING, which is what a switched socket is:
 * a 16A outlet is not controlled by a 6A switch. The two are ordered switch-
 * first because that is how a plate reads left to right on site.
 */
export function socketWithSwitch(country, { amps = null, source = 'design', what = null } = {}) {
  const a = amps ?? lightSwitchA(country);
  return [
    point(country, { kind: 'switch', amps: a, source, what: what ?? 'its socket', pairs: true }),
    point(country, { kind: 'socket', amps: a, source, what }),
  ];
}

/**
 * WHAT THE FLOWS COMING INTO THIS BOARD ARE, AS POINTS ON IT.
 *
 * A FLOW IS ONE SWITCH — that is flows.js's whole premise, and this is where it
 * is cashed in. A row of six downlights, a cove, a track, the pair of bedsides:
 * each is one module at the light rating, because each is one thing somebody
 * turns on. Nothing here counts fittings.
 *
 * A FAN IS THE EXCEPTION AND IT IS TWO POINTS: A SWITCH AND A REGULATOR.
 *
 * IT USED TO BE THE REGULATOR ALONE, on the reasoning that you do not switch a
 * fan, you set it — and that is how a modular regulator is sold, with an off
 * position at the bottom of its travel. It is not how boards are built. A fan
 * point is a switch and a regulator side by side: the switch is what turns it
 * on and off, and the regulator is what the speed is left set to between times,
 * so that turning the fan on tomorrow gives you the speed you liked yesterday.
 * A plate with a regulator and no switch means winding the speed down to zero
 * every time you leave the room.
 *
 * THREE MODULES IN INDIA, TWO GANGS IN THE US — the switch at the light rating
 * (nothing about a ceiling fan is above 15A) and then the regulator's own width.
 *
 * NOT COUNTRY-VARYING, AND THIS IS WHERE IT WOULD BECOME SO. Both countries
 * build a fan point the same way today, and inventing a `fanSwitch` flag for
 * COUNTRIES that both entries would set to true is a knob nobody can populate.
 * If a country turns up whose regulators integrate the switch, that flag goes in
 * the table and this branch reads it — the same shape `moduleOverrides` has.
 *
 * THE SWITCH JOINS THE SWITCH ROW AND THE REGULATOR FOLLOWS IT, which falls out
 * of `composeSwitchboard`'s existing ordering rather than needing anything here:
 * the design's switches first, then its regulators, then the sockets. That IS
 * how a plate is laid out — a row of rockers, then the knobs, then the outlets —
 * so the fan's two modules are not adjacent and should not be.
 *
 * A TWO-WAY POINT IS A SWITCH AND NOT A SECOND REGULATOR. `also` on a flow is
 * the same switch reached from a second plate (see flows.js), so when THIS
 * board is the second plate it gets a plain switch module. Ordering a fan two
 * regulators because it can be operated from the bed is precisely the miscount
 * flows.js wrote `also` to avoid, and it would come back here if this branch
 * copied the kind across.
 */
export function pointsFromFlows(country, flows = [], boardId = null) {
  const a = lightSwitchA(country);
  const out = [];
  for (const f of flows) {
    if (boardId && f.boardId === boardId) {
      /* A SOCKET OUTLET'S SWITCH, AND IT LANDS HERE BECAUSE THE WIRE DOES.
         An outlet is a plate on a wall with one socket and no switch — the one
         switchboard allowed to have none, see `placedBoards` in electrical.js —
         and this is where "every socket needs a switch" is honoured for it. The
         module is a SWITCH and not a switch-and-socket pair: the socket is over
         there, on the wall, and ordering a second one here because its switch is
         here would put an outlet on the wrong plate.

         AT THE OUTLET'S OWN RATING. A 16A socket is not controlled by a 6A
         switch, and the flow carries the rating precisely so this does not have
         to guess. Move the wire to another board and the switch moves with it,
         at the same rating, because both are derived from where the flow lands. */
      if (f.kind === 'socket') {
        out.push(point(country, { kind: 'switch', amps: f.amps ?? a, flowId: f.id,
                                  what: f.label, forOutlet: true }));
      } else if (f.kind === 'object' && f.label === 'Fan') {
        // BOTH, AND IN THIS ORDER. See the header: the switch turns it on, the
        // regulator is what the speed is left set to.
        out.push(point(country, { kind: 'switch', amps: a, flowId: f.id,
                                  what: f.label, forFan: true }));
        out.push(point(country, { kind: 'fan', flowId: f.id, what: f.label }));
      } else {
        out.push(point(country, { kind: 'switch', amps: a, flowId: f.id, what: f.label }));
      }
    } else if (boardId && f.also?.boardId === boardId) {
      out.push(point(country, {
        kind: 'switch', amps: a, flowId: f.id, twoWay: true,
        what: `${f.label} — second point`,
      }));
    }
  }
  return out;
}

/**
 * PACK POINTS INTO FRAMES YOU CAN BUY.
 *
 * BALANCED, NOT FILLED. The obvious algorithm — pour into a frame until it
 * overflows, start another — gives you an 18 and a 1 for nineteen modules, and
 * nobody has ever built that: two boards side by side on one wall are made the
 * same size. So the count of boards is settled first (`ceil(total / largest)`)
 * and the points are then spread over that many, aiming at an even share.
 *
 * THE TARGET IS A PREFERENCE AND THE MAXIMUM IS A LAW. A point may push a board
 * past the even share when the alternative is stranding it, but nothing ever
 * pushes one past the country's largest frame — and a board never starts with
 * an overflow, so a single point wider than the target still lands somewhere.
 */
export function packBoards(country, points) {
  const sizes = country.boardSizes;
  const max = sizes[sizes.length - 1];
  const total = points.reduce((s, p) => s + p.modules, 0);
  const want = Math.max(1, Math.ceil(total / max));
  const target = Math.ceil(total / want);

  const bins = [];
  let cur = [];
  let used = 0;
  for (const p of points) {
    const overMax = used + p.modules > max;
    const overTarget = used + p.modules > target;
    const roomToSplit = bins.length < want - 1;
    if (used > 0 && (overMax || (overTarget && roomToSplit))) {
      bins.push({ points: cur, used });
      cur = []; used = 0;
    }
    cur.push(p); used += p.modules;
  }
  if (cur.length || !bins.length) bins.push({ points: cur, used });
  return bins;
}

/** The smallest frame on sale that holds this many units. */
export function frameFor(country, used) {
  return country.boardSizes.find((s) => s >= used) ?? country.boardSizes[country.boardSizes.length - 1];
}

/**
 * ONE SWITCHBOARD POSITION, COMPOSED.
 *
 * IN: the flows that come back to this plate, whatever a person added to it by
 * hand, and the country. OUT: one or more frames, each a size you can order,
 * each with its points in reading order and its blanks already in place.
 *
 * THE ORDER IS THE ORDER A PLATE IS BUILT IN, and it is deliberate rather than
 * incidental: the switches the design asked for first (a person reaching for
 * the light switch by the door is reaching for the leftmost module), then the
 * fan's regulator, then the sockets and anything added by hand, then the
 * blanks. Sorting by module width, or by amperage, would put the fan regulator
 * in the middle of the light switches and make the plate unreadable in exactly
 * the way a real one is not.
 *
 * `spare` IS ON BY DEFAULT AND IT IS AN ARGUMENT rather than a constant, for
 * the "almost" in "almost every switchboard": the caller knows things this file
 * does not — that this plate is a single-purpose one, that the room already has
 * four sockets — and the one thing that must not happen is a socket appearing
 * on a plate somebody explicitly composed without one.
 */
export function composeSwitchboard({
  country: code = DEFAULT_COUNTRY,
  flows = [],
  boardId = null,
  // Points somebody added in the panel: `[{ kind, amps }]`, in the order they
  // added them. Stored against the board id by the caller — see App.jsx.
  extras = [],
  spare = true,
  /* THE RATING OF THE PLATE'S OWN SOCKET. Null means the country's low-power
     one, which is what almost every board wants and what this always used to be.

     IT EXISTS BECAUSE A BOARD CAN HAVE BEEN AN OUTLET. Check the box on a 16A
     socket outlet and it becomes a switchboard — and the socket that was on the
     wall is still the socket that is on the wall, at sixteen amps. Composing it
     with the default 6A spare would quietly re-rate somebody's air-conditioner
     point on the way through a conversion that was supposed to be about where
     the SWITCH lives. */
  spareAmps = null,
} = {}) {
  const country = typeof code === 'string' ? countryFor(code) : (code ?? COUNTRIES[DEFAULT_COUNTRY]);
  const a = lightSwitchA(country);

  const design = pointsFromFlows(country, flows, boardId);
  const switches = design.filter((p) => p.kind !== 'fan');
  const fans = design.filter((p) => p.kind === 'fan');

  const added = [];
  for (const e of extras) {
    // A SOCKET ADDED BY HAND STILL BRINGS ITS SWITCH. The panel offers "socket"
    // as one thing to add because that is what a person means; the rule that
    // it is two modules of switch-and-outlet is this file's, and it is applied
    // in the one place that knows it.
    const made = e?.kind === 'socket'
      ? socketWithSwitch(country, { amps: e.amps, source: 'added' })
      : [point(country, { ...e, source: 'added' })];
    /* AND THE PAIR CARRIES ONE ID BETWEEN THEM. `extraId` is what the panel's
       remove button acts on, and a socket is one press to add — so it has to be
       one press to take away. Stamping it out here rather than inside
       `socketWithSwitch` keeps that function about wiring and this loop about
       what a person did. */
    for (const p of made) added.push({ ...p, extraId: e?.id ?? null });
  }

  const spares = spare
    ? socketWithSwitch(country, { amps: spareAmps ?? a, source: 'spare',
                                  what: 'a spare outlet' })
    : [];

  const wanted = [...switches, ...fans, ...spares, ...added];
  const bins = packBoards(country, wanted);

  const boards = bins.map((bin, i) => {
    const size = frameFor(country, bin.used);
    const blanks = Math.max(0, size - bin.used);
    return {
      index: i,
      size,
      used: bin.used,
      unit: country.unit,
      units: country.units,
      points: [
        ...bin.points,
        ...Array.from({ length: blanks }, () => point(country, { kind: 'blank', source: 'fill' })),
      ],
    };
  });

  return {
    country,
    // NOT AN OUTLET, SAID OUT LOUD. The card reads this to decide which of two
    // plates it is drawing, and `composeOutlet` says the opposite — so the field
    // is present on both answers rather than absent on one, which is the
    // difference between a check and a guess about undefined.
    outlet: false,
    boards,
    // The whole position, whether it came out as one frame or three.
    total: wanted.reduce((s, p) => s + p.modules, 0),
    amps: spareAmps ?? a,
    lightSwitchA: a,
    split: boards.length > 1,
  };
}

/**
 * A SOCKET OUTLET, COMPOSED — the one plate with no switch on it.
 *
 * IT IS NOT `composeSwitchboard` WITH ARGUMENTS, AND THAT IS DELIBERATE. Every
 * path through that function adds a switch to a socket, because that is the rule
 * it exists to enforce; a flag that switched the rule off would put the one case
 * that may break it inside the function that must not. This is a different
 * object — a wall fixture with a socket in it — and it says so by being its own
 * function.
 *
 * THE SWITCH IS NOT MISSING, IT IS ELSEWHERE. `switchedFrom` is what the card
 * prints so the plate can account for itself: the board the outlet's wire runs
 * to has a module for it, at this same rating. Null while nothing has been
 * worked out yet, which reads as "not yet" rather than as "none".
 *
 * ONE FRAME, ALWAYS. A single socket is two modules in India and one gang in the
 * US, and both are frames you can buy, so there is never a blank and never a
 * split. The shape of the answer matches composeSwitchboard's so the same card
 * draws both.
 */
export function composeOutlet({ country: code = DEFAULT_COUNTRY, amps = null,
                                switchedFrom = null } = {}) {
  const country = typeof code === 'string' ? countryFor(code) : (code ?? COUNTRIES[DEFAULT_COUNTRY]);
  const a = amps ?? lightSwitchA(country);
  const sock = point(country, { kind: 'socket', amps: a, source: 'outlet' });
  const size = frameFor(country, sock.modules);
  const blanks = Math.max(0, size - sock.modules);
  return {
    country,
    outlet: true,
    amps: a,
    switchedFrom,
    boards: [{
      index: 0,
      size,
      used: sock.modules,
      unit: country.unit,
      units: country.units,
      points: [sock, ...Array.from({ length: blanks },
        () => point(country, { kind: 'blank', source: 'fill' }))],
    }],
    total: sock.modules,
    lightSwitchA: lightSwitchA(country),
    split: false,
  };
}

/**
 * WHAT THE PANEL CAN OFFER TO ADD, for this country.
 *
 * EVERY SWITCH RATING AND EVERY SOCKET RATING, plus the three points that are
 * the same everywhere. Generated from the country rather than listed, so the
 * day a rating is added to `switchRatings` it appears in the panel with the
 * right width printed on it and no second edit.
 *
 * A SOCKET'S WIDTH HERE IS THE PAIR'S WIDTH, because that is what pressing the
 * button actually costs the plate — see `socketWithSwitch`. Printing "2
 * modules" beside a control that adds three of them is a panel that lies about
 * the one number it exists to show.
 */
export function addablePoints(country) {
  const out = [];
  for (const amps of country.switchRatings) {
    const p = { kind: 'switch', amps };
    out.push({ ...p, label: labelFor(country, p), modules: modulesFor(country, p) });
  }
  for (const amps of country.switchRatings) {
    const p = { kind: 'socket', amps };
    out.push({
      ...p,
      label: labelFor(country, p),
      modules: socketWithSwitch(country, { amps }).reduce((s, q) => s + q.modules, 0),
    });
  }
  for (const kind of ['usb', 'data', 'blank']) {
    const p = { kind, amps: null };
    out.push({ ...p, label: labelFor(country, p), modules: modulesFor(country, p) });
  }
  return out;
}

/**
 * THE COMPOSITION AS A LIST OF LINES — "2 x 6A switch", "1 x Fan regulator".
 *
 * BY LABEL, WHICH IS BY KIND AND RATING TOGETHER, because that is the unit a
 * schedule orders in: two 6A switches are two of one thing, and a 6A and a 16A
 * are two different things that happen to be the same width.
 */
export function tally(board) {
  const seen = new Map();
  for (const p of board.points) {
    const row = seen.get(p.label) ?? { label: p.label, kind: p.kind, count: 0, modules: 0 };
    row.count += 1;
    row.modules += p.modules;
    seen.set(p.label, row);
  }
  return [...seen.values()];
}
