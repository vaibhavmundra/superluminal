// ---------------------------------------------------------------------------
// test-mag-track.mjs — A MAGNETIC TRACK AND THE MODULES CLIPPED INTO IT.
//
// FIVE CLAIMS, and every assertion below belongs to one of them:
//
//   1. A TRACK IS A CEILING SHAPE AND THE PIPELINE KNOWS IT. `role: 'track'`
//      survives being sealed, and — the part that would have been a silent
//      disaster — a track is NOT "built": it must never reach the cove chunker
//      as a pocket, re-cut the grid and appear in the schedule as tape.
//   2. AN OFFSET PRODUCES A SHAPE AND NOT AN OUTLINE. A run set out a foot
//      inside a guide has to be resizable and duplicable afterwards, so the
//      offset moves the shape's own dimensions and refuses rather than folds.
//   3. TWO BODIES CANNOT SHARE AN INCH OF EXTRUSION. A click that would overlap
//      is nudged to the nearest place the module fits, and a full run says so.
//   4. THE ALLOCATOR TAKES ITS COUNT FROM THE ROOM AND ITS POSITIONS FROM THE
//      GEOMETRY. The shortfall over what one diffuser is worth, rounded UP;
//      corners on a closed run; ends-then-seven-feet on an open one.
//   5. THE COUNT IS A FLOOR AND THE SEVEN-FOOT GAP IS A CEILING. Neither rule
//      ever overrides the other downward.
//
//   node tools/test-mag-track.mjs
// ---------------------------------------------------------------------------

import { outlineFt, sealShape, roleOf, isTrack, isBuilt, isGuide, isOpen,
         hitShape, canTakeGeometry, insetShape, handlesFor, lineShape, penShape,
         editablePath, moveShapeVertex,
         MIN_SPAN_FT } from '../src/lib/ceilingShapes.js';
import { TRACK_MODULES, MODULE_BY_ID, MODULE_SOON, moduleLenFt, moduleCapacity,
         moduleAt, moduleWatts, uAt, placeableU, placeModule, planDiffusers,
         diffuserSlots, diffuserCapacity, DIFFUSER_GAP_FT,
         moduleLenIn, DIFFUSER_LENGTHS_MM } from '../src/lib/magTrack.js';
import { netPerUnit, analyseSpace, FAMILY_BY_ID, PANEL_WATTS, COB_WATTS,
         TRACK_DIFFUSER_WATTS, TRACK_SPOT_WATTS } from '../src/lib/lumens.js';
import { pathLength } from '../src/lib/geometry.js';
import { asPathHost, makePath, pathU, pathAt, pathLengthOf } from '../src/lib/path.js';
import { projectShapeEditPx } from '../src/lib/fixtureProjection.js';
import { orthoLock } from '../src/lib/dragMove.js';
import { isConstrained, resolvePoint, pointsOn, pointAdapters }
  from '../src/lib/point.js';
import { moduleU } from '../src/features/fixtures/fixtureRules.js';
import { takeableGeometry } from '../src/features/ceiling-geometry/geometryRules.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const say = (t) => console.log('\n' + t);

const RECT = { kind: 'rect', x: 5.5, y: 4, wFt: 11, hFt: 8, rot: 0 };
const LINE = (len) => ({ kind: 'line', x: 0, y: 0, rot: 0,
                         pts: [{ x: 0, y: 0 }, { x: len, y: 0 }] });

say('-- 1. a track is a shape, and it is not built --');
{
  const t = sealShape({ ...RECT }, 'track');
  ok(t.role === 'track' && roleOf(t) === 'track', 'the role survives being sealed');
  ok(isTrack(t) && !isBuilt(t) && !isGuide(t), 'it is a track, and it is not built');
  /* THE ONE THAT WOULD HAVE BEEN SILENT. `isBuilt` is asked as "is this a cove"
     rather than "is this not a guide", so a role the file has not been told about
     falls out of the cove pipeline instead of into it. */
  ok(!isBuilt({ role: 'something-new' }), 'and neither is a role nobody has heard of');
  ok(isBuilt({ ...RECT }) && isBuilt({ role: 'cove' }),
    'a shape with no role is a cove, which is what every plan saved before roles holds');
  /* A GUIDE TAKEN AS A TRACK MUST NOT COME BACK A GUIDE. `sealShape` spreads the
     draft, so the role has to be stripped by the caller AND written by the seal;
     this is the second half. */
  const asTrack = sealShape({ kind: 'rect', wFt: 4, hFt: 4 }, 'track');
  ok(asTrack.role === 'track', 'sealing as a track writes the role (it wrote nothing before)');
}

say('-- 2. an offset produces a shape --');
{
  const inFt = insetShape(RECT, -1);
  ok(inFt.kind === 'rect' && near(inFt.wFt, 9) && near(inFt.hFt, 6),
    'a foot inside an 11 x 8 rectangle is 9 x 6 — both sides by 2g');
  ok(near(insetShape(RECT, 1).wFt, 13), '...and a foot outside is 13 wide');
  ok(insetShape(RECT, -5) === null, 'an offset that eats the shape is refused, not folded');
  const hex = { kind: 'polygon', sides: 6, x: 0, y: 0, rFt: 5 };
  /* THE CIRCUMRADIUS BY g / cos(PI/n) AND NOT BY g — an offset moves each EDGE
     by g, which is the apothem. Growing the circumradius by g instead leaves the
     line short on the flats and past it at the corners. */
  ok(near(insetShape(hex, -1).rFt, 5 - 1 / Math.cos(Math.PI / 6), 1e-9),
    'a hexagon insets on its apothem, not its circumradius');
  const line = LINE(12);
  ok(insetShape(line, -1) === line,
    'an open run is returned unchanged: a line has no inside to be a foot in from');
  const round = insetShape({ ...RECT, radiusFt: 1.5 }, -1);
  ok(near(round.radiusFt, 1.5), 'and the corner radius rides along, so the copy is resizable');
}

say('-- 3. two bodies cannot share an inch of extrusion --');
{
  const pts = outlineFt(RECT);
  const total = pathLength(pts, { closed: true });
  /* MEASURED FROM THE PRODUCT AND NOT FROM A LITERAL. This asserted "two-foot
     diffusers" and went stale the day a diffuser's length became a band of its
     wattage — see DIFFUSER_LENGTHS_MM. What is being tested is that the capacity
     is the length over the BODY, whatever the body currently is. */
  const bodyDef = moduleLenFt('diffuser');
  ok(moduleCapacity(total, 'diffuser') === Math.floor(total / bodyDef),
    `a ${total.toFixed(0)} ft ring holds ${Math.floor(total / bodyDef)} `
    + `${Math.round(bodyDef * 304.8)} mm diffusers`);
  ok(moduleCapacity(total, 'diffuser', 36) < moduleCapacity(total, 'diffuser', 5),
    '...and fewer of them at 36 W than at 5 W, because the body is longer');
  const taken = [];
  const us = [];
  for (let i = 0; i < 4; i++) {
    const u = placeableU(pts, 0.1, taken, 'diffuser', { closed: true });
    ok(u != null, `press ${i + 1} on the same spot still finds a place`);
    taken.push({ u, kind: 'diffuser' }); us.push(u);
  }
  const spread = us.map((u) => u * total).sort((a, b) => a - b);
  const gaps = spread.slice(1).map((v, i) => v - spread[i]);
  ok(gaps.every((g) => g >= moduleLenFt('diffuser') - 1e-9),
    'and no two of the four are closer than a module length');
  ok(near(us[0], 0.1), 'the first one lands exactly where the click did');
  ok(us.slice(1).every((u) => u !== 0.1), '...and the rest are nudged rather than stacked');

  // THE BODY STAYS ON AN OPEN RUN, whatever length it currently is.
  const four = outlineFt(LINE(4));
  const mid = placeableU(four, 0.5, [], 'diffuser', { closed: false });
  ok(near(mid, 0.5), 'a click at the middle of a 4 ft run is honoured');
  const end = placeableU(four, 0, [], 'diffuser', { closed: false });
  ok(near(end * 4, bodyDef / 2, 1e-6),
    'a click at the very end lands half a body in, so it is on the profile');
  /* A RUN WITH NO ROOM LEFT SAYS SO. Sized off the product rather than a
     literal: one 600 mm body either side of the centre of a run barely two
     bodies long leaves nowhere for a third. */
  const tight = outlineFt(LINE(moduleLenFt('diffuser', 36) * 2));
  const packed = [{ u: 0.25, kind: 'diffuser', watts: 36 },
                  { u: 0.75, kind: 'diffuser', watts: 36 }];
  ok(placeableU(tight, 0.5, packed, 'diffuser',
                { closed: false, watts: 36 }) === null,
    'and a run with no room left refuses rather than stacking');
}

say('-- 4. the allocator: corners first, then the balance --');
{
  /* THE WORKED EXAMPLE THIS RULE WAS SPECIFIED AGAINST. 27 W wanted on a
     rectangle: four corners at 6.75 W each, nothing sold at or under that except
     5 W, so four 5 W — then 7 W of balance, and the smallest module that covers
     7 is a 10 W, in the middle of a rail. Four fives and a ten. */
  const CAT = FAMILY_BY_ID.track_diffuser.watts;
  ok(CAT === TRACK_DIFFUSER_WATTS && CAT.join() === '5,10,18',
    'the diffuser has its own catalogue: 5, 10, 18 — not the panel\'s 9 to 36');
  ok(FAMILY_BY_ID.track_diffuser.split.walls === FAMILY_BY_ID.panel.split.walls
    && FAMILY_BY_ID.track_diffuser.borrowed === 'panel',
    '...sharing the panel\'s distribution and saying so with `borrowed`');
  ok(MODULE_BY_ID.diffuser.family === 'track_diffuser',
    'and the module points at it rather than at `panel`');

  const RUN = { kind: 'rect', x: 0, y: 0, wFt: 7.3, hFt: 4.4, rot: 0 };
  const pts = outlineFt(RUN);
  const plan27 = planDiffusers(pts, { closed: true, needW: 27, watts: CAT });
  const at = (k) => plan27.filter((m) => m.kind === k);
  ok(at('corner').length === 4, '27 W: four corners');
  ok(at('corner').every((m) => m.watts === 5), '...at 5 W each — the largest under 6.75');
  ok(at('centre').length === 1 && at('centre')[0].watts === 10,
    '...and one 10 W at the centre of a rail for the 7 W balance');
  ok(plan27.reduce((a2, m) => a2 + m.watts, 0) === 30, 'thirty watts placed for 27 wanted');

  /* THE CASE THE ARITHMETIC WILL KEEP TRYING TO "IMPROVE". 17 W over four
     corners is 4.25 W each and nothing is sold below 5, so it is four 5 W
     modules — NOT the single 18 W that fits the number better. A ring lit at one
     point is not a design, and three watts is not worth it. */
  const plan17 = planDiffusers(pts, { closed: true, needW: 17, watts: CAT });
  ok(plan17.length === 4 && plan17.every((m) => m.watts === 5),
    '17 W is four 5 W modules at the corners, not one 18 W in the middle');
  ok(!plan17.some((m) => m.watts === 18), '...and specifically not an 18 W');

  ok(planDiffusers(pts, { closed: true, needW: 8, watts: CAT }).length === 4,
    'even 8 W buys the corners — they are never skipped to save a watt');
  const plan45 = planDiffusers(pts, { closed: true, needW: 45, watts: CAT });
  ok(plan45.filter((m) => m.kind === 'corner').every((m) => m.watts === 10),
    '45 W over four corners is 11.25 each, so the corners step up to 10 W');
  ok(plan45.reduce((a2, m) => a2 + m.watts, 0) >= 45, '...and the balance finishes the job');

  /* THE SLOT LADDER IS THE ORDER THE WATTS ARE SPENT IN, and the corners are
     first in it — which is what makes "corners first" structural rather than a
     rule somebody downstream has to remember. */
  const slots = diffuserSlots(pts, { closed: true });
  ok(slots.slice(0, 4).every((sl) => sl.kind === 'corner'),
    'the first four slots on a rectangle are its corners');
  ok(slots.length === diffuserCapacity(pts, { closed: true }),
    'and the capacity IS the slot count — one source, not two that can drift');
  /* THE BUG THAT MADE THE WORKED EXAMPLE FAIL: capacity was its own arithmetic
     and came out at 4, so the corners ate the whole allowance and the balance
     was never placed. */
  ok(diffuserCapacity(pts, { closed: true }) > 4,
    'a 7.3 x 4.4 ring has room past its corners — a short leg gets no centre, a long one does');
  const body = moduleLenFt('diffuser');
  const total = pathLength(pts, { closed: true });
  const bad = slots.some((x, i) => slots.slice(i + 1).some((y) => {
    const dd = Math.abs(x.u - y.u) * total;
    return Math.min(dd, total - dd) < body - 1e-9;
  }));
  ok(!bad, 'and no two slots are closer than a body — the ladder is filtered, not hoped');

  // A LEG TOO SHORT FOR A CENTRE DOES NOT GET ONE.
  const shortLeg = slots.filter((sl) => sl.kind === 'centre').map((sl) => sl.leg);
  ok(shortLeg.length === 2,
    `only the two 7.3 ft rails take a centre; the 4.4 ft ones are inside the `
    + `${DIFFUSER_GAP_FT} ft spacing and do not`);

  say('   ...and an open run');
  const line = outlineFt(LINE(24));
  const l17 = planDiffusers(line, { closed: false, needW: 17, watts: CAT });
  ok(l17.filter((m) => m.kind === 'corner').length === 2,
    "an open run's two corners are its ends");
  ok(near(l17[0].u * 24, body / 2, 1e-6)
    && near(l17[l17.length - 1].u * 24, 24 - body / 2, 1e-6),
    '...half a body in from each, so the module is on the profile and not off it');
  ok(l17.some((m) => m.kind === 'centre' && m.watts === 10),
    'and the 7 W balance lands mid-run at 10 W');

  say('   ...and the catalogue seam');
  ok(planDiffusers(pts, { closed: true, needW: 27 }).length === 0,
    'no catalogue, no allocation — the parameter has no default to fall back to');
  ok(planDiffusers(pts, { closed: true, needW: 27, watts: [] }).length === 0,
    'an empty catalogue places nothing');
  ok(planDiffusers(pts, { closed: true, needW: 27, watts: ['x', 0, -3] }).length === 0,
    'and an unusable one is dropped rather than trusted');
  /* A BRAND THAT SELLS SOMETHING ELSE ENTIRELY. Nothing assumes the list's
     length, its spacing, or that any figure this project knows is in it. */
  const odd = planDiffusers(pts, { closed: true, needW: 27, watts: [8, 16] });
  ok(odd.length >= 4 && odd.slice(0, 4).every((m) => [8, 16].includes(m.watts)),
    `a range of only 8 and 16 W answers out of its own list (${odd.map((m) => m.watts).join('+')})`);
  ok(planDiffusers(pts, { closed: true, needW: 0, watts: CAT }).length === 0,
    'and a room already over its criterion gets a bare profile');

  say('   ...and the room it all came from');
  /* END TO END AGAINST THE PANEL'S OWN ARITHMETIC: 11'3" x 8'5", 2700 mm, a spot
     array of three already on the ceiling. The first version of this allocator
     put 3,834 lm of diffuser into it for a shortfall of about 730. */
  const room = [{ x: 0, y: 0 }, { x: 11.25, y: 0 },
                { x: 11.25, y: 8.42 }, { x: 0, y: 8.42 }];
  const base = [{ key: 'sa', familyId: 'cob', count: 3, watts: 7 }];
  const before = analyseSpace({ polygonFt: room, ceilingMm: 2700, materials: null,
    projectId: 'home', groups: base });
  const perW = netPerUnit('track_diffuser', 1,
    { ref: before.ref, lumensPerWatt: before.lumensPerWatt });
  ok(perW > 0, `one watt of diffuser is worth ${Math.round(perW)} lm here`);
  const plan = planDiffusers(pts, { closed: true,
    needW: before.shortfall / perW, watts: CAT });
  const groups = [...base];
  for (const w of new Set(plan.map((m) => m.watts))) {
    groups.push({ key: `t${w}`, familyId: 'track_diffuser', watts: w,
                  count: plan.filter((m) => m.watts === w).length });
  }
  const after = analyseSpace({ polygonFt: room, ceilingMm: 2700, materials: null,
    projectId: 'home', groups });
  ok(after.achieved >= after.required, 'the room clears its criterion');
  const over = (after.achieved - after.required) / after.required;
  ok(over < 0.35, `overshooting by ${Math.round(over * 100)}% and not by 192%`);
  ok(plan.filter((m) => m.kind === 'corner').length === 4,
    '...with its four corners lit, which is what the whole rule is for');
}

say('-- 6. a diffuser is as long as its wattage --');
{
  /* IT WAS A FLAT 24 IN FOR EVERY DIFFUSER, so a run of 5 W corner modules drew
     as four two-foot slabs on a seven-foot rail — the right size for the biggest
     thing in the range and three times the right size for the smallest. */
  const mm = (w) => Math.round(moduleLenIn('diffuser', w) * 25.4);
  ok(mm(5) === 200 && mm(10) === 200 && mm(14) === 200, 'under 15 W is 200 mm');
  ok(mm(15) === 400 && mm(18) === 400 && mm(25) === 400, '15 through 25 W is 400 mm');
  ok(mm(26) === 600 && mm(36) === 600 && mm(200) === 600, 'above 25 W is 600 mm');
  /* THE BOUNDARIES FALL WHERE THEY WERE SPECIFIED. The table is keyed on the
     wattage each length STARTS at, so 15 and 25 need no epsilon to land on the
     right side — see DIFFUSER_LENGTHS_MM. */
  ok(mm(14.9) === 200 && mm(15) === 400, '14.9 W is short and 15 W is not');
  /* THE BANDS ARE KEYED ON WHOLE WATTS, which is what a module is specified in:
     the panel's chips are integers, the catalogue is integers, and
     `setTrackModuleSpec` rounds. So the boundary above 25 is 26 and there is no
     epsilon anywhere in the table. */
  ok(mm(25) === 400 && mm(26) === 600, '25 W is medium and 26 W is not');
  ok(DIFFUSER_LENGTHS_MM.every((b) => Number.isInteger(b.fromW)),
    '...and every boundary in the table is a whole watt');
  ok(DIFFUSER_LENGTHS_MM[0].fromW === 0,
    'the table starts at zero, so every positive wattage lands in a band');

  /* A MODULE THAT NAMES ITS OWN LENGTH KEEPS IT. A spot is a 6 in body at any
     wattage its range sells; only the diffuser's length is a function of output. */
  ok(moduleLenIn('spot') === 6 && moduleLenIn('spot', 36) === 6,
    'a spot is 6 in whatever it is specified at');
  ok(moduleLenIn('diffuser') === moduleLenIn('diffuser',
    FAMILY_BY_ID.track_diffuser.defaultWatts),
    'and a length asked for with no wattage uses the default a hand-placed one gets');

  /* THE CLEARANCE FOLLOWS THE BODY, on both sides. One figure for the lot would
     refuse a 200 mm stub a gap it fits in and let a 600 mm bar overlap one it
     does not. */
  const line = outlineFt(LINE(4));
  const small = placeableU(line, 0.5, [{ u: 0.25, kind: 'diffuser', watts: 5 }],
                           'diffuser', { closed: false, watts: 5 });
  ok(small != null, 'two 200 mm stubs both fit on a 4 ft run');
  const big = placeableU(line, 0.5, [{ u: 0.25, kind: 'diffuser', watts: 36 }],
                         'diffuser', { closed: false, watts: 36 });
  ok(big == null || Math.abs(big - 0.25) * 4 >= moduleLenIn('diffuser', 36) / 12 - 1e-9,
    '...and a 600 mm bar beside another one is either moved clear or refused');

  /* AND THE ALLOCATOR SPACES ITS LADDER ON THE BODY THE CORNERS WILL BE, which
     is what makes a 5 W plan fit slots a 36 W plan could not. */
  const ring = outlineFt({ kind: 'rect', x: 0, y: 0, wFt: 7.3, hFt: 4.4, rot: 0 });
  const plan = planDiffusers(ring, { closed: true, needW: 27,
                                     watts: FAMILY_BY_ID.track_diffuser.watts });
  const totalFt = pathLength(ring, { closed: true });
  const bad = plan.some((x, i) => plan.slice(i + 1).some((y) => {
    const dd = Math.abs(x.u - y.u) * totalFt;
    const gap = Math.min(dd, totalFt - dd);
    return gap < (moduleLenIn('diffuser', x.watts)
      + moduleLenIn('diffuser', y.watts)) / 24 - 1e-9;
  }));
  ok(!bad, 'no two modules in a plan overlap, measured at their own real lengths');
}

say('-- 7. a press on a track actually places a module --');
{
  /* --- THE WHOLE CHAIN, IN THE ORDER THE PRESS HANDLER RUNS IT --------------
     THIS IS HERE BECAUSE THE FEATURE SHIPPED BROKEN TWICE and both times the
     arithmetic was fine. Placing a module was unreachable: the geometry bar
     stays open while a module is armed, and the shape tool's take-branch — which
     only asked whether the bar was open — swallowed the press and turned the
     track into a fresh draft. Every function below was correct on its own.

     SO THE TEST FOLLOWS THE PRESS rather than testing the pieces: which tool
     owns it, what is under the pointer, where along the run that is, and what
     comes out. It is the sequence in `onZoneDown`, with the React state as plain
     variables. */
  const TRACK = sealShape({ kind: 'rect', x: 6, y: 4, wFt: 8, hFt: 5, rot: 0 }, 'track');
  const GUIDE = sealShape({ kind: 'rect', x: 6, y: 4, wFt: 10, hFt: 7, rot: 0 }, 'guide');
  const pts = outlineFt(TRACK);
  const closed = !isOpen(TRACK);

  /* STEP 1: WHO OWNS THE PRESS. With a module armed, the shape tool must NOT
     take the track — that is the bug, stated as a truth table. */
  const shapeState = { role: 'track', menuOpen: true, penEmpty: true };
  ok(canTakeGeometry({ ...shapeState, shape: TRACK, addTool: 'module' }) === false,
    'a module is armed, so the shape tool does not take the track — the press falls through');
  ok(canTakeGeometry({ ...shapeState, shape: GUIDE, addTool: 'module' }) === false,
    '...and it does not take a guide either: an armed tool owns the press');
  ok(canTakeGeometry({ ...shapeState, shape: GUIDE, addTool: null }) === true,
    'with nothing armed, pressing a guide DOES span a track from it');
  ok(canTakeGeometry({ ...shapeState, shape: TRACK, addTool: null }) === false,
    '...but pressing a track while drawing tracks does not — same role, so it selects');
  ok(canTakeGeometry({ ...shapeState, shape: GUIDE, addTool: null,
                       penEmpty: false }) === false,
    'and a pen path in flight owns its own clicks');
  ok(canTakeGeometry({ shape: GUIDE, role: 'track', menuOpen: false,
                       addTool: null }) === false,
    'a closed bar takes nothing at all');

  /* --- AND THE GUIDE BAR TAKES NOTHING EITHER -----------------------------
     THE BAR A PLAIN CLICK ON A SPACE RAISES. `onCanvasClick` opens it in the
     'guide' role with no primitive armed, so it is up for nearly the whole of
     ordinary use — and while "another role" was the whole test, that made every
     drawn cove and every magnetic track on the sheet unselectable: the press
     borrowed the outline instead. The modules clipped to that track kept their
     own handler and kept working, which is exactly how it was reported. */
  const COVE = sealShape({ kind: 'rect', x: 6, y: 4, wFt: 9, hFt: 6, rot: 0 }, 'cove');
  const guideBar = { role: 'guide', menuOpen: true, penEmpty: true, addTool: null };
  ok(canTakeGeometry({ ...guideBar, shape: COVE }) === false,
    'the guide bar does not borrow a cove — the press selects it');
  ok(canTakeGeometry({ ...guideBar, shape: TRACK }) === false,
    '...nor a track, which is how a run is picked up at all');
  ok(canTakeGeometry({ ...guideBar, shape: GUIDE }) === false,
    '...nor another guide, which was already true and stays true');
  /* THE TWO DIRECTIONS THE FLOW WAS DESIGNED IN ARE UNTOUCHED. */
  ok(canTakeGeometry({ shape: GUIDE, role: 'cove', menuOpen: true,
                       penEmpty: true, addTool: null }) === true,
    'a cove still spans from a guide');
  ok(canTakeGeometry({ shape: GUIDE, role: 'track', menuOpen: true,
                       penEmpty: true, addTool: null }) === true,
    'and a track still spans from one');

  /* THE CURSOR SAYS THE SAME SENTENCE. `takeableGeometry` drives the hover cue,
     and a line that lights up under a press that will not take it is a drawing
     that lies. */
  ok(takeableGeometry(COVE, { addTool: null, cobMode: null,
                              shapeMenuOn: true, shapeRole: 'guide' }) === null,
    'and the guide bar does not LIGHT a cove either — the cue and the press agree');
  ok(takeableGeometry(GUIDE, { addTool: null, cobMode: null,
                               shapeMenuOn: true, shapeRole: 'track' }) === GUIDE,
    '...while the track bar still lights the guide it would span from');

  /* STEP 2: IS A TRACK UNDER THE POINTER. `hitShape` is what the press runs, at
     the same converted tolerance. */
  const onRail = { x: 6, y: 1.5 };            // the middle of the top rail
  const offRail = { x: 6, y: 4 };             // the middle of the ring, on nothing
  const tolFt = 8 / 12;
  ok(hitShape(TRACK, onRail, tolFt), 'a press on the rail hits the track');
  ok(isTrack(TRACK), '...and it is a track, which is the only thing a module clips into');
  ok(!hitShape({ ...TRACK, wFt: 1, hFt: 1 }, { x: 40, y: 40 }, tolFt),
    'a press nowhere near it hits nothing');

  /* STEP 3 AND 4: WHERE ALONG THE RUN, AND DOES A BODY FIT THERE. */
  for (const kind of ['diffuser', 'spot']) {
    const taken = [];
    const placed = [];
    for (let i = 0; i < 3; i++) {
      const want = uAt(pts, onRail, { closed });
      const u = placeableU(pts, want, taken, kind,
                           { closed, watts: moduleWatts(kind) });
      ok(u != null, `${kind}: press ${i + 1} resolves to a place on the run`);
      const mod = placeModule({ on: TRACK.id, kind, u, seq: i });
      taken.push({ u, kind, watts: mod.watts });
      placed.push(mod);
    }
    ok(placed.length === 3, `three ${kind}s placed`);
    ok(placed.every((m) => m.on === TRACK.id && m.kind === kind),
      '...each on that run, of that kind');
    ok(new Set(placed.map((m) => m.id)).size === 3, '...with three distinct ids');
    ok(new Set(placed.map((m) => m.u)).size === 3,
      '...at three distinct places — nudged apart, not stacked');
    /* STEP 5: EACH RESOLVES BACK ONTO THE RAIL, which is what the canvas draws
       from. A module that resolved to nothing would be invisible — the exact
       symptom of "I cannot add them" even once the press worked. */
    for (const m of placed) {
      const at = moduleAt(pts, m.u, { closed });
      ok(at != null && Number.isFinite(at.x) && Number.isFinite(at.y),
        `a placed ${kind} resolves to a point on the rail`);
    }
  }

  /* STEP 6: AND THE ANALYSIS CAN SEE THEM. One row per module — the rule the
     panel groups by — so each carries a family the model knows. */
  for (const kind of ['diffuser', 'spot']) {
    const fam = MODULE_BY_ID[kind].family;
    ok(FAMILY_BY_ID[fam] != null, `a ${kind}'s family (${fam}) is in the model`);
    ok(FAMILY_BY_ID[fam].watts.includes(moduleWatts(kind)),
      `...and its default wattage is one the panel's chips offer`);
  }
  ok(MODULE_BY_ID.washer.family == null,
    'and the washer has no family, so no row can be built from it yet');
}

say('-- and the catalogue --');
{
  ok(TRACK_MODULES.length === 3, 'three modules');
  ok(MODULE_BY_ID.diffuser.family === 'track_diffuser',
    'the diffuser is its own family and not the panel');
  ok(FAMILY_BY_ID.track_diffuser.split.ceiling === 0
    && FAMILY_BY_ID.track_diffuser.split.floor === 0.3,
    '...on the panel\'s distribution: 0% up, 70% at the walls, 30% at the floor');
  ok(PANEL_WATTS.join() === '9,12,18,24,36',
    'and the panel keeps the range it was specified with');
  /* THE SPOT HAS A FAMILY OF ITS OWN NOW, for the diffuser's reason: it shares
     the COB's cone and nothing else, and sharing the family meant sharing the
     recessed downlight's range. */
  ok(MODULE_BY_ID.spot.family === 'track_spot',
    'the spot is its own family and not the recessed COB');
  ok(FAMILY_BY_ID.track_spot.borrowed === 'cob'
    && FAMILY_BY_ID.track_spot.split.floor === FAMILY_BY_ID.cob.split.floor,
    "...on the COB's distribution, and saying so with `borrowed`");
  /* BOTH ARE TASK, AND THIS ASSERTION USED TO SAY THE OPPOSITE. It read
     "the task layer where the grid downlight is ambient", which was true of the
     table and wrong about the light: a recessed COB puts 80% of its output at
     the floor, and the line above this one is the assertion that a track spot
     shares exactly that distribution. Two fittings with one cone cannot be in
     two different layers. See the note on `cob` in lumens.js for what the
     mis-filing was doing to the ambient figure. */
  ok(FAMILY_BY_ID.track_spot.layer === 'task' && FAMILY_BY_ID.cob.layer === 'task',
    'and both are task light — they share the cone, so they share the layer');
  ok(FAMILY_BY_ID.track_diffuser.layer === 'ambient',
    '...where the diffuser on the same rail is ambient, which is why both exist');
  /* THE SAME FIVE WATTAGES IN A SEPARATE ARRAY. Not an alias: a catalogue loader
     replacing one must not silently replace the other, which is the whole point
     of the split. */
  ok(TRACK_SPOT_WATTS.join() === COB_WATTS.join(),
    'the track spot sells the same five wattages as the COB today');
  ok(TRACK_SPOT_WATTS !== COB_WATTS,
    '...in its own array, so a loaded catalogue can part them');
  ok(moduleWatts('spot') === FAMILY_BY_ID.track_spot.defaultWatts,
    'and 5 W is now that family\'s default rather than an override on the module');
  ok(MODULE_SOON.includes('washer') && !MODULE_BY_ID.washer.family,
    'and the wall washer is declared, out of reach, and has no invented numbers');
  ok(moduleLenFt('diffuser') > moduleLenFt('spot'),
    'a diffuser is the long body and a spot the short one');
  const m = placeModule({ on: 't1', kind: 'diffuser', u: 1.4 });
  ok(m.u === 1 && m.on === 't1', 'a placed module clamps its fraction');
  /* THE DEFAULT COMES OFF THE FAMILY AND IS NOT A THIRD COPY OF 18. The module
     states no wattage, so `moduleWatts` reads `panel`'s own default — the same
     figure the panel calls the default — and a catalogue that changes it is
     followed here without this file being touched. */
  ok(m.watts === FAMILY_BY_ID.track_diffuser.defaultWatts
    && moduleWatts('diffuser') === FAMILY_BY_ID.track_diffuser.defaultWatts,
    `a hand-placed diffuser opens at its family's default (${moduleWatts('diffuser')} W)`);
  const owned = placeModule({ on: 't1', kind: 'spot', u: 0.5,
                              gridCells: ['room|cell-1', 'room|cell-2'] });
  ok(owned.gridCells.join() === 'room|cell-1,room|cell-2',
    'a grid-derived track spot remembers every grid cell it replaces');
  /* AND THE SPOT KEEPS ITS OWN, because 5 W is a different PRODUCT from the 7 W
     ambient downlight its family defaults to. */
  ok(moduleWatts('spot') === 5 && FAMILY_BY_ID.cob.defaultWatts === 7,
    'the spot states 5 W and keeps it — a track spot is not the grid downlight');
  ok(moduleAt(outlineFt(RECT), 0, { closed: true }) != null
    && moduleAt([], 0.5, { closed: true }) === null,
    'a module on no path is nothing rather than a module at the origin');
  ok(MIN_SPAN_FT > 0, 'and the shape library still has a minimum span to refuse against');
}

// ---------------------------------------------------------------------------
say('THE RUN IS A PATH AND A MODULE IS A POINT HELD ON IT');
// The two primitives, doing the job this file used to do by hand. What is
// asserted is that they are the SAME answers — not that they exist.
{
  const pts = outlineFt(LINE(10));            // a straight 10 ft run
  const run = { id: 'r1', pts, closed: false, roomId: 'room-1' };
  const host = asPathHost(run);
  ok(host && host.id === 'r1' && host.closed === false && host.pts === pts,
    'a run IS a path host — the three fields, straight off the projection');
  ok(asPathHost(makePath(pts, { closed: false, id: 'r1' })).pts.length === pts.length,
    'and a path built from its points is the same host');

  const m = placeModule({ on: 'r1', kind: 'diffuser', u: 0.25, seq: 0 });
  ok(isConstrained(m),
    'a placed module reads as a CONSTRAINED POINT — it names its host in `on`');
  ok(m.x === undefined || m.x === null,
    'and carries no coordinate to disagree with its fraction');

  const at = resolvePoint(m, host);
  const legacy = moduleAt(pts, m.u, { closed: run.closed });
  ok(at && near(at.x, legacy.x) && near(at.y, legacy.y),
    '`resolvePoint` puts it exactly where `moduleAt` did — same arithmetic, one name');
  ok(near(at.ux, legacy.ux) && near(at.uy, legacy.uy),
    'direction included, which is what makes a diffuser lie ALONG the profile');
  ok(resolvePoint(m, null) === null,
    'and a module whose run has gone resolves to nothing, not to the origin');

  const list = [m, placeModule({ on: 'r1', kind: 'spot', u: 0.8, seq: 1 }),
    placeModule({ on: 'r2', kind: 'spot', u: 0.5, seq: 2 })];
  ok(pointsOn(list, 'r1').length === 2 && pointsOn(list, 'r2').length === 1,
    '"which modules are on this run" is the point primitive\'s own query');
}

// ---------------------------------------------------------------------------
say('THE DRAG: THE PRIMITIVE PROJECTS, `placeableU` VETOES');
// The module's drag is `usePointDrag` now, and the only domain rule left in it
// is the clearance. These are the two halves asserted separately, and then
// asserted to agree with the PLACING press — which is the whole point of
// splitting them: a click and a drag must land a module in the same place.
{
  const pts = outlineFt(LINE(10));
  const run = { id: 'r1', pts, closed: false };
  const host = asPathHost(run);
  const p = { x: 2.5, y: 0 };

  ok(near(pathU(host, p), 0.25), 'the primitive projects the pointer onto the run');
  ok(near(pathAt(host, 0.25).x, 2.5), 'and back again');

  /* `clamp` AS THE DRAG BUILDS IT — the product's veto, nothing else. */
  const clamp = (u, f, h) => placeableU(h.pts, u,
    pointsOn([], f.on).filter((q) => q.id !== f.id),
    f.kind, { closed: h.closed, watts: f.watts });
  const m = placeModule({ on: 'r1', kind: 'diffuser', u: 0.9, seq: 0 });
  const unit = pointAdapters(() => host, { clamp });
  const moved = unit.to(m, p);
  ok(near(moved.u, 0.25), 'so a drag to (2.5, 0) writes u = 0.25 and only u');
  ok(moved.on === 'r1', 'still on the same run');
  ok(near(moduleU({ run, p, taken: [], kind: m.kind, watts: m.watts }), moved.u),
    'and the PLACING press lands on the identical fraction — one answer, two gestures');

  /* A FULL RUN REFUSES, AND A REFUSAL LEAVES THE MODULE PUT. */
  const full = Array.from({ length: 40 }, (_, i) =>
    ({ id: `f${i}`, on: 'r1', kind: 'diffuser', u: i / 40, watts: 36 }));
  const busy = (u, f, h) => placeableU(h.pts, u,
    full.filter((q) => q.id !== f.id), f.kind, { closed: h.closed, watts: f.watts });
  const stuck = pointAdapters(() => host, { clamp: busy }).to(m, p);
  ok(near(stuck.u, 0.9),
    'a run with nowhere left leaves it exactly where it was, rather than sliding it free');

  /* A LOOKUP THAT ANSWERS BY `on`, which is what the drag's `hostFor` is. */
  const byHost = pointAdapters((f) => (f.on === 'r1' ? host : null), { clamp });
  ok(byHost.to({ ...m, on: 'gone' }, p).u === 0.9,
    'and a module whose run is missing is refused, not turned into a free point');
  ok(byHost.to({ ...m, on: 'gone' }, p).on === 'gone',
    'it keeps naming the run it lost rather than being quietly set free');
}

// ---------------------------------------------------------------------------
say('A SINGLE RUN CAN BE EDITED — the grip refusal was a COVE rule');
// A straight run had no grips at all, because `handlesFor` tested `isOpen`
// alone: a cove SLOT has its ends pinned to the plaster and must not be
// stretched, and a track's ends are pinned to nothing. `shapeCanTranslate` was
// already corrected for exactly this — the same mistake, one function over.
{
  const line = lineShape({ x: 0, y: 0 }, { x: 10, y: 0 });
  const run = { ...line, id: 'r1', role: 'track' };
  const guide = { ...line, id: 'g1', role: 'guide' };
  const slot = { ...line, id: 'c1' };                 // role defaults to cove

  ok(handlesFor(slot).length === 0,
    'a COVE slot still has no grips — its ends are on the plaster');
  /* AND A RUN GETS NO BOX GRIPS EITHER, WHICH IS THE POINT. A line's bounding
     box is degenerate, so its four corner grips land exactly on its two ends —
     on top of the vertex grips, painted later, taking every press. That is what
     put a resize cursor on the control that should have said "drag this
     point". A path is edited by its VERTICES; the box is not offered. */
  ok(handlesFor(run).length === 0,
    'a straight TRACK run offers no box grips — its handles are its two ends');
  ok(handlesFor(guide).length === 0, 'and neither does an open guide');
  ok(projectShapeEditPx(12, 'r1', [run]).pts.length === 2,
    '...it gets a vertex grip per end instead, which is what it never had');
  ok(handlesFor({ kind: 'rect', x: 0, y: 0, wFt: 4, hFt: 2 }).length === 8,
    'a BOX-parameterised rect is unchanged — four corners and four edges');
}

// ---------------------------------------------------------------------------
say('AND ITS VERTICES ARE THE PATH PRIMITIVE\'S POINTS');
{
  const run = { ...lineShape({ x: 0, y: 0 }, { x: 10, y: 0 }), id: 'r1', role: 'track' };

  const host = editablePath(run);
  ok(host && host.id === 'r1' && host.pts.length === 2,
    'a run whose geometry is a point list hands over an editable path host');
  ok(near(host.pts[0].x, 0) && near(host.pts[1].x, 10),
    'in WORLD feet — the stored points are in the shape\'s own frame');
  ok(near(pathLengthOf(host), 10), 'and the path primitive measures it');
  ok(editablePath({ kind: 'rect', x: 0, y: 0, wFt: 4, hFt: 2 }) === null,
    'a BOX-parameterised shape has no vertices to edit — a rect resizes instead');
  ok(editablePath({ kind: 'circle', x: 0, y: 0, rFt: 3 }) === null,
    'and a circle does not offer its seventy-two derived outline points as grips');

  const moved = moveShapeVertex(run, 1, { x: 14, y: 3 });
  const after = editablePath(moved);
  ok(near(after.pts[1].x, 14) && near(after.pts[1].y, 3),
    'a vertex lands exactly where the pointer asked, in world feet');
  ok(near(after.pts[0].x, 0) && near(after.pts[0].y, 0),
    'and the other end does not budge — the centre is NOT re-derived, or the '
    + 'drawing would crawl away from the grip');
  ok(moveShapeVertex(run, 9, { x: 1, y: 1 }) === run, 'an index off the end changes nothing');
  /* ONE POINT PRESSED, ONE POINT MOVED — the default, and what the canvas asks
     for. A track may be ANGULAR, so nothing is re-squared: the run goes diagonal
     and its other end stays exactly where it was. */
  const angled = editablePath(moveShapeVertex(run, 1, { x: 14, y: 6 })).pts;
  ok(near(angled[1].x, 14) && near(angled[1].y, 6), 'the pressed point goes where it is asked');
  ok(near(angled[0].x, 0) && near(angled[0].y, 0),
    'and the OTHER point does not move — a track run may be angular');
  ok(!near(angled[0].y, angled[1].y), 'so the run really is diagonal afterwards');
  ok(moveShapeVertex({ kind: 'rect', x: 0, y: 0, wFt: 4, hFt: 2 }, 0, { x: 1, y: 1 }).wFt === 4,
    'and a box-parameterised shape is returned untouched rather than half-edited');

  /* THE LOCK, WHICH IS THE PATH'S OWN PROPERTY AND NOT A MODIFIER. */
  const bent = { ...penShape([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    { open: true }), id: 'p1', role: 'track', x: 0, y: 0, rot: 0 };
  /* `penShape` RE-CENTRES ITS POINTS ABOUT THE SHAPE'S OWN CENTRE, so the world
     coordinates are not the ones it was given. What matters is what MOVED. */
  const was = editablePath(bent).pts;
  const sq = editablePath(moveShapeVertex(bent, 1, { x: 12, y: 3 }, { lock: true })).pts;
  ok(near(sq[1].x, 12) && near(sq[1].y, 3), 'the dragged vertex goes where it is asked');
  ok(near(sq[0].y, 3) && near(sq[2].x, 12),
    'and a LOCKED move carries both neighbouring legs with it — path.moveVertex, '
    + 'which is penMovePoint, not a second copy of it');

  const free = editablePath(moveShapeVertex(bent, 1, { x: 12, y: 3 })).pts;
  ok(near(free[1].x, 12) && near(free[1].y, 3), 'unlocked, the same vertex moves...');
  ok(near(free[0].x, was[0].x) && near(free[0].y, was[0].y)
    && near(free[2].x, was[2].x) && near(free[2].y, was[2].y),
    '...and its neighbours are left exactly where they were');
}

// ---------------------------------------------------------------------------
say('SHIFT HOLDS A PATH POINT TO A STRAIGHT LINE');
// The two steps `trackGripMove` takes, in order: `orthoLock` decides where the
// pointer is ALLOWED to be, measured from where the vertex was at the PRESS,
// and `moveShapeVertex` then writes it. The order is load-bearing — the other
// way round, the path's own relock would move the point off the line the
// modifier had just held it to.
{
  const run = { ...lineShape({ x: 0, y: 0 }, { x: 10, y: 0 }), id: 'r1', role: 'track' };
  const anchor = editablePath(run).pts[1];            // the end being dragged: (10, 0)

  /* HELD SIDEWAYS: 6 across beats 3 down, so `y` is frozen at the press value
     and the end travels along the row it started on. */
  const across = orthoLock({ x: 16, y: 3 }, anchor, true);
  ok(near(across.at.x, 16) && near(across.at.y, 0), 'the wanted point is put back on the row...');
  ok(across.axis === 'y', '...and the frozen axis is NAMED, so nothing draws a guide for it');
  const pulled = editablePath(moveShapeVertex(run, 1, across.at)).pts;
  ok(near(pulled[1].x, 16) && near(pulled[1].y, 0),
    'so a shift-drag on a straight run changes its LENGTH and nothing else');
  ok(near(pulled[0].x, 0) && near(pulled[0].y, 0), 'and the far end does not move');

  /* HELD DOWNWARDS: 9 down beats 4 across, so `x` freezes instead. */
  const down = orthoLock({ x: 14, y: 9 }, anchor, true);
  ok(near(down.at.x, 10) && near(down.at.y, 9) && down.axis === 'x',
    'and the other axis wins when it has travelled further — re-decided, not latched');

  const free = orthoLock({ x: 16, y: 3 }, anchor, false);
  ok(near(free.at.x, 16) && near(free.at.y, 3) && free.axis === null,
    'without the key the point goes where the pointer is');
}

// ---------------------------------------------------------------------------
say('...AND THE CANVAS IS GIVEN THE SAME POINT EDITOR A DRAWN TRACK GETS');
{
  const run = { ...lineShape({ x: 0, y: 0 }, { x: 10, y: 0 }), id: 'r1', role: 'track' };
  const rect = { kind: 'rect', id: 'r2', x: 0, y: 0, wFt: 4, hFt: 2 };

  const ed = projectShapeEditPx(12, 'r1', [run, rect]);
  ok(ed && ed.of === 'shape' && ed.id === 'r1',
    'the editor record says WHICH STORE the vertex belongs to');
  ok(ed.pts.length === 2 && near(ed.pts[1].x, 120),
    'and carries its points in plan PIXELS, like the drawn track\'s');
  ok(ed.closed === false, 'an open run is open');
  ok(projectShapeEditPx(12, 'r2', [run, rect]) === null,
    'a rect gets no point editor — nothing to write a moved vertex back to');
  ok(projectShapeEditPx(12, null, [run]) === null && projectShapeEditPx(0, 'r1', [run]) === null,
    'and none with nothing selected or no scale');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
