// ---------------------------------------------------------------------------
// test-switchboards.mjs — what is on the plate, in two countries.
//
// THE FLOWS ARE HAND-WRITTEN HERE and that is the opposite of what
// test-flows.mjs does. There, the whole claim was that a row is already on the
// drawing, so inventing rows would have tested a different module. Here the
// claim is that ONE FLOW IS ONE MODULE whatever the flow turned out to be —
// switchboards.js reads `kind`, `label` and `boardId` and nothing else — so a
// three-line object is the honest input and a full planner run would only be
// slower at producing it.
//
//   node tools/test-switchboards.mjs
// ---------------------------------------------------------------------------

import { COUNTRIES, DEFAULT_COUNTRY, LIGHT_MAX_A, countryFor, lightSwitchA,
         modulesFor, labelFor, socketWithSwitch, pointsFromFlows, packBoards,
         frameFor, composeSwitchboard, composeOutlet, addablePoints, tally }
  from '../src/lib/switchboards.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

const IN = COUNTRIES.IN;
const US = COUNTRIES.US;
const B = 'sb-r1-door';

/** n light flows onto board B. */
const lights = (n) => Array.from({ length: n }, (_, i) => ({
  id: `fl-${i}`, kind: 'row', label: 'Downlights', boardId: B,
}));
const fan = (id = 'fl-fan') => ({ id, kind: 'object', label: 'Fan', boardId: B });

const counts = (parts) => parts.boards.map((b) => b.size);
const labels = (board) => board.points.map((p) => p.label);
const howMany = (board, label) =>
  board.points.filter((p) => p.label === label).length;

console.log('\n-- the registry --');
{
  ok(countryFor('IN') === IN && countryFor('in') === IN, 'a code, either case');
  ok(countryFor(' India ') === IN, 'a name, with whitespace round it');
  ok(countryFor('usa') === US && countryFor('United States') === US, 'an alias, and a name');
  ok(countryFor(null) === COUNTRIES[DEFAULT_COUNTRY], 'nothing at all means India');
  ok(countryFor('Ruritania') === COUNTRIES[DEFAULT_COUNTRY],
    'and so does a country nobody has entered yet');
  ok(countryFor(undefined).code === 'IN', 'undefined, likewise');
}

console.log('\n-- the light switch is derived, not stored --');
{
  ok(lightSwitchA(IN) === 6, `India lights at 6A (got ${lightSwitchA(IN)})`);
  ok(lightSwitchA(US) === 15, `the US at 15A (got ${lightSwitchA(US)})`);
  for (const c of Object.values(COUNTRIES)) {
    ok(lightSwitchA(c) <= LIGHT_MAX_A,
      `${c.code}'s light switch is at or under ${LIGHT_MAX_A}A`);
  }
  // The rule, not the number: a country selling a 10A part should use it.
  const made = { ...IN, switchRatings: [6, 10, 16] };
  ok(lightSwitchA(made) === 10, 'the LARGEST rating under the line wins');
  const heavy = { ...IN, switchRatings: [20, 32] };
  ok(lightSwitchA(heavy) === 20, 'and with nothing under it, the smallest on sale');
}

console.log('\n-- module widths --');
{
  ok(modulesFor(IN, { kind: 'switch', amps: 6 }) === 1, 'India: a 6A switch is one module');
  ok(modulesFor(IN, { kind: 'switch', amps: 32 }) === 2, '...and a 32A switch is two');
  ok(modulesFor(IN, { kind: 'socket', amps: 6 }) === 2, '...a socket is two');
  ok(modulesFor(IN, { kind: 'fan' }) === 2, '...a fan regulator is two');
  ok(modulesFor(IN, { kind: 'usb' }) === 1 && modulesFor(IN, { kind: 'data' }) === 1
     && modulesFor(IN, { kind: 'blank' }) === 1, '...USB, data and blank are one each');
  ok(modulesFor(IN, { kind: 'nonesuch' }) === 1, 'an unknown kind still has a width');
  ok(US.switchRatings.every((a) => modulesFor(US, { kind: 'switch', amps: a }) === 1)
     && modulesFor(US, { kind: 'socket', amps: 15 }) === 1
     && modulesFor(US, { kind: 'fan' }) === 1, 'the US: one gang for everything');
  ok(labelFor(IN, { kind: 'switch', amps: 16 }) === '16A switch', 'a rated part says its rating');
  ok(labelFor(IN, { kind: 'fan' }) === 'Fan regulator', 'an unrated one does not');
}

console.log('\n-- every socket comes with a switch --');
{
  const pair = socketWithSwitch(IN, { amps: 16 });
  ok(pair.length === 2, 'a socket is two parts');
  ok(pair[0].kind === 'switch' && pair[1].kind === 'socket', 'switch first, then the outlet');
  ok(pair[0].amps === 16, 'and the switch is at the socket\'s own rating');
  ok(pair.reduce((s, p) => s + p.modules, 0) === 3, 'three modules in India');
  ok(socketWithSwitch(US, { amps: 15 }).reduce((s, p) => s + p.modules, 0) === 2,
    'two gangs in the US');
  ok(socketWithSwitch(IN)[0].amps === 6, 'and with no rating asked for, the light switch');
}

console.log('\n-- a flow is a switch, and a fan is a switch AND a regulator --');
{
  const pts = pointsFromFlows(IN, [...lights(2), fan()], B);
  /* THE FAN IS THE ONE FLOW THAT IS TWO POINTS. A regulator on its own means
     winding the speed to zero every time you leave the room; the switch turns it
     off and the regulator keeps the speed you liked. Three flows, four points. */
  ok(pts.length === 4, `three flows, four points (got ${pts.length})`);
  ok(pts.filter((p) => p.kind === 'switch').length === 3,
    'three of them switches — two rows and the fan\'s');
  ok(pts.filter((p) => p.kind === 'fan').length === 1, 'and one a regulator');
  ok(pts.filter((p) => p.forFan).length === 1, 'one switch says which is the fan\'s');
  ok(pts.every((p) => p.kind !== 'switch' || p.amps === 6), 'the switches are 6A');
  ok(pointsFromFlows(IN, [fan()], B).reduce((n, p) => n + p.modules, 0) === 3,
    'so a fan point is three modules in India');
  ok(pointsFromFlows(US, [fan()], B).reduce((n, p) => n + p.modules, 0) === 2,
    '...and two gangs in the US');

  // The count is flows and not fittings — the whole premise.
  const big = [{ id: 'f', kind: 'row', label: 'Downlights', boardId: B, count: 18 }];
  ok(pointsFromFlows(IN, big, B).length === 1, 'eighteen lamps on one row is one switch');

  // Somebody else's plate.
  ok(pointsFromFlows(IN, lights(3), 'sb-r1-bedside').length === 0,
    'a flow on another board is not on this one');
}

console.log('\n-- two-way switching is a switch, not a second regulator --');
{
  const far = 'sb-r1-bedside';
  const twoWay = [{ ...fan(), also: { boardId: far, boardLabel: 'Bedside' } }];
  const there = pointsFromFlows(IN, twoWay, far);
  ok(there.length === 1, 'the second plate gets a point');
  ok(there[0].kind === 'switch', '...and it is a switch');
  ok(there[0].modules === 1, '...one module, not the regulator\'s two');
  ok(pointsFromFlows(IN, twoWay, B).some((p) => p.kind === 'fan'),
    'while the plate that owns it still gets the regulator');
  ok(pointsFromFlows(IN, twoWay, B).length === 2,
    '...and the switch beside it, which the second plate does not duplicate');
}

console.log('\n-- the socket outlet, and the switch it puts somewhere else --');
{
  /* THE ONE EXCEPTION TO "EVERY SOCKET NEEDS A SWITCH", AND IT DOES NOT BREAK
     THE RULE. The socket is on a wall and its switch is on a board; both exist,
     they are just not on the same plate. `composeOutlet` builds the plate with
     the socket, and `pointsFromFlows` builds the module on whichever board the
     outlet's wire lands on. */
  const out = composeOutlet({ country: 'IN', amps: 16, switchedFrom: 'Door' });
  ok(out.outlet === true, 'it says it is an outlet, so the card can read it apart');
  ok(out.boards.length === 1, 'one frame, always — a single socket never splits');
  const b = out.boards[0];
  ok(howMany(b, '16A socket') === 1, 'with the socket on it');
  ok(howMany(b, '16A switch') === 0 && howMany(b, '6A switch') === 0,
    '...and no switch at all, which is the whole of the exception');
  ok(b.used === 2 && b.size === 2, `two modules in a two-module frame (got ${b.used}/${b.size})`);
  ok(howMany(b, 'Blank plate') === 0, 'so there is nothing to blank out');
  ok(out.switchedFrom === 'Door', 'and it names the board its switch is on');
  ok(composeOutlet({}).amps === lightSwitchA(IN),
    'with no rating asked for, the country\'s low-power one');
  ok(composeOutlet({ country: 'US' }).boards[0].used === 1, 'one gang in the US');

  /* AND THE CONVERSION KEEPS THE RATING. Add a point to a 16A outlet and it
     becomes a switchboard — but the socket that was on the wall is still the
     socket that is on the wall. The change is about where the SWITCH lives, and
     re-rating it on the way through would be the conversion quietly editing
     something it was not asked to. */
  const converted = composeSwitchboard({ country: 'IN', flows: [], boardId: 'x',
                                         spareAmps: 16 });
  ok(howMany(converted.boards[0], '16A socket') === 1,
    'converted into a switchboard, its socket is still 16A');
  ok(howMany(converted.boards[0], '16A switch') === 1,
    '...and the switch that appears beside it matches');
  ok(converted.outlet === false, 'and the answer says which of the two it is');
  ok(composeSwitchboard({ country: 'IN', flows: [], boardId: 'x' })
    .boards[0].points.some((p) => p.label === '6A socket'),
    'while a board nobody converted keeps the low-power default');

  // ...AND THE OTHER HALF: the module on the board the wire runs to.
  const soFlow = { id: 'fl-so', kind: 'socket', label: '16A socket',
                   boardId: B, amps: 16, outletId: 'sb-hand-1' };
  const pts = pointsFromFlows(IN, [soFlow], B);
  ok(pts.length === 1 && pts[0].kind === 'switch',
    'the board the outlet wires to gets a SWITCH');
  ok(pts[0].amps === 16, '...at the outlet\'s own rating and not at the light rating');
  ok(pts[0].forOutlet === true, '...marked as the outlet\'s');
  ok(pts[0].modules === 1, 'one module — the socket is over there, on the wall');
  // The whole plate, so the exception is visible in context.
  const host = composeSwitchboard({ country: 'IN', flows: [...lights(1), soFlow], boardId: B });
  ok(howMany(host.boards[0], '16A switch') === 1, 'and it lands on the composed board');
  ok(howMany(host.boards[0], '16A socket') === 0,
    'without a second socket appearing on the board with it');
}

console.log('\n-- frames you can buy --');
{
  ok(frameFor(IN, 5) === 6, 'five modules go in a six-module frame');
  ok(frameFor(IN, 6) === 6, 'six go in a six');
  ok(frameFor(IN, 7) === 8, 'seven go in an eight');
  ok(frameFor(IN, 13) === 18, 'thirteen go in an eighteen');
  ok(frameFor(US, 3) === 3, 'three gangs is a three-gang box');
  ok(IN.boardSizes.every((s, i, a) => i === 0 || s > a[i - 1]), 'the sizes are ascending');
  ok(US.boardSizes.every((s, i, a) => i === 0 || s > a[i - 1]), '...in both countries');
}

console.log('\n-- the composition, India --');
{
  // Two rows of light and a fan, which is the brief's own example.
  const parts = composeSwitchboard({ country: 'IN', flows: [...lights(2), fan()], boardId: B });
  ok(parts.boards.length === 1, 'one frame');
  const b = parts.boards[0];
  ok(howMany(b, '6A switch') === 4,
    'four 6A switches — two rows, the fan\'s, and the spare socket\'s'
    + ` (got ${howMany(b, '6A switch')})`);
  ok(howMany(b, 'Fan regulator') === 1, 'one fan regulator, at two modules');
  ok(howMany(b, '6A socket') === 1, 'one spare socket');
  ok(b.used === 8, `eight modules of points (got ${b.used})`);
  ok(b.size === 8, `in an eight-module frame (got ${b.size})`);
  ok(howMany(b, 'Blank plate') === 0, 'which it fills exactly, so there is no blank');
  ok(b.points.reduce((s, p) => s + p.modules, 0) === b.size,
    'the parts add up to the frame exactly');
  /* THE ORDER A PLATE IS BUILT IN: a row of rockers, then the knobs, then the
     outlets. The fan's switch joins the rockers and its regulator follows them,
     which is how a real plate is laid out and is not an accident — see the
     ordering in composeSwitchboard. */
  ok(labels(b).indexOf('Fan regulator') > labels(b).indexOf('6A switch'),
    'the regulator sits after the switches');
  ok(labels(b).lastIndexOf('6A socket') === labels(b).length - 1,
    'and the socket is last');
}

console.log('\n-- the composition, the US --');
{
  const parts = composeSwitchboard({ country: 'US', flows: [...lights(2), fan()], boardId: B });
  ok(parts.country.code === 'US', 'the US registry answered');
  // ACROSS BOTH BOXES, because five gangs does not fit in one — see below. A
  // count off `boards[0]` would be counting half a switchboard.
  const all = parts.boards.flatMap((b) => b.points);
  const every = (label) => all.filter((p) => p.label === label).length;
  ok(every('15A switch') === 4, `four 15A switches (got ${every('15A switch')})`);
  ok(every('Fan regulator') === 1 && every('15A socket') === 1,
    'one regulator and the spare outlet');
  ok(parts.total === 6, `six gangs of devices (got ${parts.total})`);
  ok(parts.boards.length === 2,
    `which is past the four-gang ceiling, so it is two boxes (got ${parts.boards.length})`);
  ok(counts(parts).every((s) => s <= 4), 'and neither is bigger than a four-gang');
  ok(parts.boards.every((b) => b.points.reduce((s, p) => s + p.modules, 0) === b.size),
    'both are filled out with blanks');
}

console.log('\n-- no spare, when the caller says so --');
{
  const parts = composeSwitchboard({ country: 'IN', flows: lights(2), boardId: B, spare: false });
  const b = parts.boards[0];
  ok(b.used === 2 && b.size === 2, 'two switches, a two-module frame, nothing else');
  ok(howMany(b, '6A socket') === 0, 'and no socket appeared on it');
  ok(howMany(b, 'Blank plate') === 0, 'nor a blank, because the frame is full');
}

console.log('\n-- added by hand --');
{
  const parts = composeSwitchboard({
    country: 'IN', flows: lights(1), boardId: B,
    extras: [{ id: 'e1', kind: 'socket', amps: 16 }, { id: 'e2', kind: 'data' }],
  });
  const b = parts.boards[0];
  ok(howMany(b, '16A socket') === 1, 'the 16A socket is on the plate');
  ok(howMany(b, '16A switch') === 1, '...and it brought its own switch');
  ok(howMany(b, 'Data point') === 1, 'the data point is there too');
  ok(b.points.filter((p) => p.extraId === 'e1').length === 2,
    'the socket and its switch share one id, so one press removes both');
  ok(b.points.filter((p) => p.extraId === 'e2').length === 1, 'and the data point has its own');
  // 1 light + spare pair (3) + 16A pair (3) + data (1) = 8
  ok(b.used === 8 && b.size === 8, `eight modules, an eight-module frame (got ${b.used}/${b.size})`);
}

console.log('\n-- splitting, and it is balanced --');
{
  // Nineteen modules of switches: past India's eighteen.
  const parts = composeSwitchboard({
    country: 'IN', flows: lights(16), boardId: B, spare: false,
    extras: [{ id: 'e1', kind: 'socket', amps: 6 }],
  });
  ok(parts.total === 19, `nineteen modules in all (got ${parts.total})`);
  ok(parts.split && parts.boards.length === 2, 'so it is two boards');
  ok(parts.boards.every((b) => b.size <= 18), 'neither past the largest frame');
  ok(parts.boards.every((b) => b.used >= 8),
    `and neither is a stub — used ${parts.boards.map((b) => b.used).join(' + ')}`);
  ok(parts.boards.every((b) => b.points.reduce((s, p) => s + p.modules, 0) === b.size),
    'each frame is filled out with blanks');
}

console.log('\n-- packing on its own --');
{
  const wide = (m) => ({ kind: 'switch', modules: m });
  const bins = packBoards(IN, Array.from({ length: 20 }, () => wide(1)));
  ok(bins.length === 2 && bins.every((b) => b.used === 10),
    `twenty ones split ten and ten (got ${bins.map((b) => b.used).join(' + ')})`);
  const one = packBoards(IN, [wide(1)]);
  ok(one.length === 1 && one[0].used === 1, 'one point is one board');
  ok(packBoards(IN, []).length === 1, 'and nothing at all is still one board');
  const huge = packBoards(US, Array.from({ length: 9 }, () => wide(1)));
  ok(huge.length === 3 && huge.every((b) => b.used === 3),
    `nine gangs over three boxes (got ${huge.map((b) => b.used).join(' + ')})`);
}

console.log('\n-- what the panel can offer --');
{
  const add = addablePoints(IN);
  ok(add.filter((p) => p.kind === 'switch').length === IN.switchRatings.length,
    'a switch per rating');
  ok(add.filter((p) => p.kind === 'socket').length === IN.switchRatings.length,
    'a socket per rating');
  ok(add.find((p) => p.kind === 'switch' && p.amps === 32).modules === 2,
    'the 32A switch prints two modules');
  ok(add.find((p) => p.kind === 'socket' && p.amps === 6).modules === 3,
    'and a socket prints three — the pair\'s width, which is what it costs');
  ok(['usb', 'data', 'blank'].every((k) => add.some((p) => p.kind === k)),
    'USB, data and blank are offered');
  ok(addablePoints(US).every((p) => p.modules <= 2), 'and in the US nothing is wider than a pair');
}

console.log('\n-- the tally --');
{
  const parts = composeSwitchboard({ country: 'IN', flows: lights(3), boardId: B });
  const rows = tally(parts.boards[0]);
  const sw = rows.find((r) => r.label === '6A switch');
  ok(sw.count === 4, `three rows plus the spare socket's switch (got ${sw.count})`);
  ok(sw.modules === 4, 'four modules between them');
  ok(rows.reduce((s, r) => s + r.modules, 0) === parts.boards[0].size,
    'and the tally accounts for the whole frame');
}

console.log('\n-- nothing at all --');
{
  const parts = composeSwitchboard({});
  ok(parts.boards.length === 1, 'no flows still composes a plate');
  ok(parts.country.code === 'IN', '...in the default country');
  ok(parts.total === 3, '...carrying the spare socket and its switch');
}

console.log(fail ? `\n${fail} failing` : '\nall good');
process.exit(fail ? 1 : 0);
