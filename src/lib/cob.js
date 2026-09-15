// ---------------------------------------------------------------------------
// cob.js — A RECESSED DOWNLIGHT PUT WHERE SOMEBODY WANTS ONE.
//
// EVERY OTHER FITTING IN THIS APP IS A CONSEQUENCE. The ambient grid is what
// the chunking makes of a ceiling; a task spot is where the secondary grid
// decides a lit surface can be served from; a cove is what a chunk IS. All of
// them are arguments the engine wins, and that is the right default — a plan
// laid out by somebody clicking is a plan with no rule behind it.
//
// It is the wrong ONLY setting. There is a beam over the dining table that is
// not on the drawing, a client who wants the pair over the console symmetrical
// to the console rather than to the room, a chunk the grid read one way and the
// designer reads the other. Refusing those is not rigour; it is an app that gets
// exported to CAD and finished somewhere else.
//
// SO THE RULE HERE IS: FULL CONTROL, WITH THE ENGINE STILL TALKING. A hand-
// placed COB goes exactly where the click lands — no snap, no clamp, no
// projection onto anything — and the specification it arrives with is the one
// the gridding engine would have installed in that cell. You are overruling
// WHERE, and you get WHAT for free until you overrule that too.
//
// WALLS AND BEDS ARE NOT CLAMPED, WHICH IS THE OTHER half of the same rule. The
// two places the layout merely advises against — hard against a wall, and over
// a bed — are drawn under the pointer as you go near them, and the click is
// honoured anyway. A ceiling object's reserved area is different: a downlight
// physically cannot share the fan sweep or cassette clearance, so that one is
// shown as disabled and refused by the gesture before this placement function
// is called.
//
// WHAT LIVES HERE is the specification a hand-placed lamp can carry, the reading
// of the engine's answer for a point, and the two warnings. What does not is any
// geometry: the room outlines, the cells and the beds are all handed in already
// in one space, because the caller is the only thing that knows which.
// ---------------------------------------------------------------------------

import { distanceToBoundary, offsetPolygon, pointsAlong, pointsAnchored,
         maxInset } from './geometry.js';
import { FIXTURE_BY_ID } from './boq.js';

/**
 * WHAT A HAND-PLACED COB MAY BE SPECIFIED AT, in watts.
 *
 * A RANGE AND NOT A LIST, which is the one place this fitting parts company with
 * every other in the app. Everything the engine places is bought off the
 * catalogue in boq.js — 5, 7 and 12 W, three products — because a schedule of
 * fittings nobody sells cannot be ordered from, and the engine has no business
 * inventing a lamp. A person specifying one by hand is in the opposite position:
 * they are holding a product sheet, and 3 to 55 W is the range an ordinary
 * recessed COB range is sold across. Refusing them 18 W because this app only
 * knows three numbers would be the tool arguing with the specification.
 *
 * WHOLE WATTS. A slider that lands on 12.4 W is a control pretending to a
 * precision the product does not have.
 */
export const COB_WATT_RANGE = { min: 3, max: 55, step: 1 };

/**
 * THE OPTICS, AND THESE *ARE* A LIST.
 *
 * A beam angle is not a dial — it is which reflector is in the fitting, and a
 * range sells the ones it sells. These eight are what the ordinary COB range
 * offers, and a slider between them would invite a specification (a 21-degree
 * lamp) that no order can be placed for.
 *
 * IN ORDER, TIGHTEST FIRST, because that is the order a catalogue prints them
 * in and the order somebody thinks about them in: how tight do I need this.
 */
export const BEAM_ANGLES = [6, 15, 24, 30, 36, 40, 45, 60];

/**
 * HOW CLOSE TO A WALL IS TOO CLOSE, in feet.
 *
 * ITS OWN NUMBER, AND NOT THE PLANNER'S `minWallDistance`. That one is 5 ft and
 * it is about a LARGE light — a fitting answering for two cells, which lands in
 * the middle of a room by construction and is wrong the moment it does not. A
 * single downlight two feet off a wall is not wrong at all; it is a wall washer,
 * and plenty of ceilings want one. What it is not is ambient light on a floor,
 * which is what somebody placing a COB usually means.
 *
 * 2 FT, WHICH IS THE FIGURE THE TRADE USES and is deliberately gentle. This band
 * is drawn under a pointer and never enforced (see the header), so the cost of
 * it being generous is that a warning shows where somebody meant it to — and the
 * cost of it being tight is a small room in which the whole ceiling is hatched,
 * at which point nobody reads it at all. Borrowing the planner's 5 ft would do
 * exactly that: a 10 ft bathroom would have no legal ceiling anywhere.
 */
export const WALL_CLEARANCE_FT = 2.0;

/** Whole watts, inside the range. Anything unreadable comes back as the
 *  catalogue's ordinary downlight rather than as a hole. */
export const clampWatts = (w) => {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return 7;
  return Math.min(COB_WATT_RANGE.max, Math.max(COB_WATT_RANGE.min, n));
};

/** The nearest optic this app will let anybody specify. A stored plan naming an
 *  angle that has since left `BEAM_ANGLES` comes back at the closest one that
 *  survives, which is the same rule `wattsFor` follows in lumens.js: a figure
 *  nothing sells resolves to one that does rather than to nothing. */
export const nearestBeam = (deg) => {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 36;
  return BEAM_ANGLES.reduce((best, b) =>
    (Math.abs(b - n) < Math.abs(best - n) ? b : best), BEAM_ANGLES[0]);
};

/**
 * HOW HIGH THE LAMP IS ABOVE WHAT IT LIGHTS, in feet, when nobody has said.
 *
 * 9 FT, AND IT IS THE SAME ASSUMPTION settings.js ALREADY MAKES — the three
 * stated pool diameters in THROW_STYLE were computed from it. Stated here rather
 * than left implicit so that a room WITH a ceiling height recorded uses its own
 * (which is now the ordinary case: see `ceilingMm`) and only a room without one
 * falls back to this.
 *
 * AND IT IS TO THE FLOOR, NOT TO A WORK PLANE. A downlight in a ceiling is
 * lighting the floor of the room; the same cone measured to a 2.5 ft counter
 * covers a good deal less. Every diameter this file produces is floor coverage.
 */
export const DEFAULT_DROP_FT = 9;

/** The pool a cone of `beam` degrees cuts on the floor `dropFt` below it.
 *
 *  ORDINARY TRIGONOMETRY, AND IT IS THE FORMULA settings.js WRITES OUT AND THEN
 *  CANNOT USE: a beam angle is the full angle between the two directions either
 *  side of the axis where intensity falls to half the on-axis peak, so the pool
 *  is `2 x drop x tan(beam / 2)`. That file states three answers instead of
 *  computing them because this app had no ceiling height when it was written.
 *  It has one now — per space — so a hand-placed lamp gets the formula. */
export const throwDiameterFt = (beam, dropFt = DEFAULT_DROP_FT) =>
  2 * dropFt * Math.tan((nearestBeam(beam) * Math.PI / 180) / 2);

/**
 * WHAT ONE SQUARE FOOT OF A GRID CELL IS OWED, in lumens.
 *
 * TEN, AND IT IS A SPECIFIED FIGURE RATHER THAN A DERIVED ONE. This app already
 * carries two other lumens-per-square-foot numbers and this is neither of them,
 * which is worth stating so the three are not merged by somebody tidying up:
 *
 *   LUMEN_CRITERIA (settings.js)   per sqft of FLOOR, per project — 20 for a
 *                                  home, 36 for an office. What the whole space
 *                                  is owed, delivered by everything in it.
 *   LUMENS_PER_SQFT (lumens.js)    per sqft of TOTAL SURFACE, multiplied by
 *                                  (1 - reflectance). What the verdict at the
 *                                  top of the Analysis panel judges against.
 *   this                           per sqft of ONE CELL, delivered by the ONE
 *                                  lamp standing in it.
 *
 * The third is a different question from the first two: not "is the room bright
 * enough" but "what size lamp belongs in a hole this far from the next hole".
 * A cell is a lamp's share of the ceiling, so its area times this is that lamp's
 * output, and the wattage follows from what a watt buys where the building is.
 *
 * IT IS DELIBERATELY BELOW THE ROOM CRITERION. A grid of downlights is not meant
 * to be the whole answer — there is a cove, there are the spots, there is
 * daylight — and a grid sized to carry a room on its own comes out glaring. The
 * Analysis panel is where the total is judged; this is where one lamp is chosen.
 */
export const CELL_LM_PER_SQFT = 20;

/**
 * HOW CLOSE A SPACE HAS TO BE BEFORE THE GRID IS OFFERED TO FINISH IT.
 *
 * AUTOPLACE IS A FINISHING MOVE AND NOT A STARTING ONE, and the fraction is what
 * says so. It fills every EMPTY cell in one press — see `autoplaceIn` in
 * features/fixtures/useFixtureCommands.js
 * — which is the right act at the end of a layout and the wrong one at the
 * beginning: a ceiling gets its coves, its spots and the lamps somebody wanted
 * exactly where they wanted them, and only then is "put one in every cell that
 * is still bare" a sentence anybody means. Offered on an empty ceiling it would
 * be a button that designs the room, and this app's whole argument is that the
 * grid is a starting point a person overrules rather than an answer.
 *
 * 80% OF WHAT THE SPACE IS OWED, measured on the Analysis panel's own required
 * and achieved figures — which count everything in the room, not just the
 * ambient layer. Below that there is too much still to decide for a blanket fill
 * to be the next move; at or above it what is left is gaps, and gaps are exactly
 * what this fills.
 *
 * IT GATES THE OFFER AND NOT THE ACT. A toggle already switched on stays visible
 * however the figure moves afterwards, or there would be no way to switch it
 * off — see the note at its call site.
 */
export const AUTOPLACE_AT_FRACTION = 0.8;

/**
 * THE TIGHTEST OPTIC THAT STILL COVERS THE CELL.
 *
 * "JUST FITS" MEANS THE SMALLEST ANGLE WHOSE POOL REACHES THE CELL'S SHORT SIDE,
 * and both halves of that are deliberate.
 *
 * THE SHORT SIDE, because a cone is round and a cell is not. Sized to the long
 * side, the pool overshoots the short one by the difference — and on a ceiling
 * that overshoot is not spare light, it is light on the walls. It is the same
 * argument `small-narrow` exists to make about a wet room, arrived at as a
 * consequence of the geometry rather than as a room-type exception.
 *
 * SMALLEST THAT REACHES, not nearest. A cone one size too wide spills; a cone
 * one size too narrow leaves a dark ring at the cell boundary where its
 * neighbour is also falling off. Given eight fixed optics, rounding UP is the
 * one of the two that never leaves a hole in the floor.
 *
 * THE WIDEST ON OFFER WHEN NOTHING REACHES — a very large cell under a low
 * ceiling. Returning null would mean a lamp with no optic; 60 degrees is the
 * widest thing the range sells, and the cell being under-covered is a fact about
 * the grid rather than something an optic can fix.
 */
export function beamThatFits(minSideFt, dropFt = DEFAULT_DROP_FT) {
  const drop = dropFt || DEFAULT_DROP_FT;
  const want = Number(minSideFt);
  if (!(want > 0)) return BEAM_ANGLES[0];
  for (const b of BEAM_ANGLES) if (throwDiameterFt(b, drop) >= want) return b;
  return BEAM_ANGLES[BEAM_ANGLES.length - 1];
}

/**
 * THE LAMP FOR ONE GRID CELL — the whole of the autoplace rule, in one place.
 *
 * TWO NUMBERS OUT OF THREE FACTS ABOUT THE CELL: how much floor it is, how
 * narrow it is, and how far the ceiling is above it. Nothing about the room's
 * type, nothing about the catalogue, no table of exceptions. That is the point
 * of it — the previous rule read one of three stated products off `FIXTURES` and
 * could therefore only ever answer 5, 7 or 12 W, which on most plans meant 7 W
 * everywhere and a recommendation nobody could tell from a broken control.
 *
 * `lumensPerWatt` IS WHERE THE BUILDING IS — 75 in India against 100 elsewhere,
 * see `lumensPerWattFor` in lumens.js. It has to be an argument rather than a
 * constant here: the same cell in Delhi and in Berlin wants a different WATTAGE
 * for the same light, and quoting the European figure on an Indian project is
 * how a room comes out a third short of what the drawing promised.
 */
export function autoSpec({ cellSqft, minSideFt, dropFt = DEFAULT_DROP_FT,
                           lumensPerWatt = 75 }) {
  const lm = Math.max(0, Number(cellSqft) || 0) * CELL_LM_PER_SQFT;
  return {
    watts: clampWatts(lm / (lumensPerWatt || 75)),
    beam: beamThatFits(minSideFt, dropFt),
  };
}

/**
 * THE LAMP FOR A WHOLE CHUNK — the lowest its cells ask for, on both counts.
 *
 * A CHUNK IS ONE PIECE OF CEILING AND ONE PRODUCT. `autoSpec` above answers for
 * a CELL, and a chunk's cells are very often not all the same size: a grid
 * divides a room into whatever the walls and the furniture allow, so one flat
 * plane routinely comes out 1749x1574 in one box and 1710x1248 in the next.
 * Answering per cell puts a 6 W lamp beside an 8 W one in the same run of
 * plasterboard — two products, four feet apart, at the same height, which is
 * not a grid anybody would order or install.
 *
 * SO THE CHUNK IS SPECIFIED FOR ITS SMALLEST DEMAND, and both halves take the
 * lowest:
 *
 *   WATTAGE, because the error is not symmetrical. Sizing a run to its biggest
 *   cell over-lights every smaller one, and over-lighting is glare — a fault you
 *   see and cannot fix without changing lamps. Under-lighting is a shortfall the
 *   Analysis panel states in lumens, on the row, where somebody can decide about
 *   it.
 *
 *   BEAM, because "just fits the smallest dimension" said of a chunk is the
 *   smallest dimension IN it. The tightest cone keeps the light off the walls,
 *   which is what the rule was for; the cost is that a larger cell in the same
 *   chunk is covered less generously, and that is the same trade the wattage
 *   makes, in the same direction, for the same reason.
 *
 * COMPONENTWISE, so the answer can be a pair no single cell asked for — 6 W from
 * one box and 24 degrees from another. That is deliberate: it is the
 * conservative end of each axis rather than one cell's whole opinion, and
 * picking a single "smallest cell" would have to decide whether smallest means
 * area or short side, which are not the same box.
 *
 * `null` where the chunk has no usable cell, which the caller reads as "no
 * answer" rather than as a lamp of no wattage.
 */
export function chunkSpec(cells, chunk, { dropFt = DEFAULT_DROP_FT,
                                          lumensPerWatt = 75 } = {}) {
  let out = null;
  for (const c of cells ?? []) {
    if (c.chunk !== chunk || !(c.w > 0 && c.h > 0)) continue;
    const one = autoSpec({ cellSqft: c.w * c.h, minSideFt: Math.min(c.w, c.h),
                           dropFt, lumensPerWatt });
    out = out
      ? { watts: Math.min(out.watts, one.watts), beam: Math.min(out.beam, one.beam) }
      : one;
  }
  return out;
}

/**
 * WHAT THE GRIDDING ENGINE WOULD INSTALL AT THIS POINT.
 *
 * ONE RULE, AND IT IS `autoSpec`. What the bar recommends under the pointer and
 * what the autoplace toggle drops into every cell are the same two numbers from
 * the same three facts about the same cell — see the note there. That is not
 * tidiness: a recommendation that disagreed with what the toggle beside it
 * places would be this app holding two opinions about one hole in one ceiling,
 * which it has already done once and which is what this file's history is about.
 *
 * --- WHAT THIS REPLACED, TWICE, AND WHY THE THIRD ANSWER IS THE RULE ---------
 *
 * FIRST IT READ THE CATALOGUE. `FIXTURES` in boq.js holds three ambient
 * downlights, so the answer had three possible values, and since nearly every
 * cell on nearly every plan buys the first it read 7 W and 36 degrees wherever
 * you moved the pointer — indistinguishable from a control that was not wired
 * up.
 *
 * THEN IT DERIVED THE FIGURE FROM THE ROOM'S OWN CRITERION, which was worse in a
 * more interesting way: it displaced `fixtureForCell` in roomTypes.js, which is
 * a DESIGNED rule with the reasoning written beside it, and produced 6 W for a
 * bathroom where that rule says 5. A derived number that contradicts a designed
 * rule is not more precise; it is a second opinion in a place that should have
 * one. It was reverted.
 *
 * WHAT IS DIFFERENT NOW IS THAT THE RULE ITSELF CHANGED. `autoSpec` is not this
 * file second-guessing the catalogue — it is the specified rule for what belongs
 * in a grid cell, stated as a rule rather than as a table of products, and the
 * catalogue is what is now behind. So the derivation is the designed answer and
 * there is no second opinion to displace. If a bathroom should come out at 5 W
 * rather than at what its cell asks for, that is a change to CELL_LM_PER_SQFT or
 * a room-type exception ON TOP of it — one place, stated — and not a lookup
 * competing with it.
 *
 * --- THE CELL DECIDES, AND IT IS FOUND BY CONTAINMENT -----------------------
 *
 * Not by distance to a light: the engine's answer is a property of the PIECE OF
 * CEILING, not of the lamp standing in the middle of it, and a point three
 * quarters of the way to the edge of a cell is still in that cell. It reads
 * `gridCellsPx`, which survives the lights being switched off — so this answers
 * on a plan with no fittings placed at all, which is the ordinary state of this
 * app now and was the real cause of the 7 W bathroom.
 *
 * --- ...AND IT ASKS THE CEILING AND NOTHING ELSE ----------------------------
 *
 * AN `inForce` HOOK USED TO BE CONSULTED FIRST, and it was a link between
 * fittings dressed as a rule. It answered with the wattage and beam of whichever
 * hand-specified lamp was already standing in this chunk — so one lamp's figures
 * became the recommendation for every lamp placed near it, and a companion pass
 * (`reconcileCobSpecs`) wrote them onto the lamps already there. Place three in
 * a row, change one, and all three moved.
 *
 * BOTH ARE DELETED. A recommendation is a fact about the cell under the pointer
 * — its area, its short side, the drop — and a fitting somebody placed answers
 * for itself alone. An array is the one object that speaks for several lamps,
 * and it says so by being one.
 */
export function recommendCob(room, p, {
  dropFt = DEFAULT_DROP_FT, lumensPerWatt = 75,
} = {}) {
  const cells = room?.plan?.gridCellsPx ?? room?.plan?.cellsPx ?? [];

  if (p && cells.length) {
    const cell = cells.find((c) => p.x >= c.x0 && p.x <= c.x1
                                && p.y >= c.y0 && p.y <= c.y1);
    if (cell) {
      /* THE CHUNK'S ANSWER AND NOT THIS CELL'S. It was the cell's, and that was
         the bug: a run of downlights across one plane came out at two different
         wattages because two boxes of the grid were different sizes. See
         `chunkSpec`. */
      const ruled = chunkSpec(cells, cell.chunk, { dropFt, lumensPerWatt });
      if (ruled) return { ...ruled, cell, from: 'chunk' };
    }
  }

  /* NO CELL UNDER THE POINTER — a cove pocket, a hole, a chunk ceded to a fan,
     or a space whose layout failed outright. There is no area to size a lamp
     from, so the catalogue's ordinary downlight stands: it is what this app
     means by "a downlight" everywhere else, and a bar showing "—" is not a
     specification anybody can place a lamp on. */
  const f = FIXTURE_BY_ID.small;
  return { watts: f.watts, beam: f.beam, cell: null, from: 'default' };
}

// --- AN ARRAY OF LAMPS SET OUT ON A GEOMETRY --------------------------------
//
// THE GEOMETRY IS REFERENCED, NEVER COPIED, and that is the whole design. One
// rectangle on the ceiling is the cove's setting-out line AND the thing a run of
// spots is arranged a foot inside. If the array held its own copy of the points,
// the two would agree until somebody dragged the rectangle — and then the cove
// would move and the lamps would not. So an array stores WHICH geometry and WHAT
// IT DID TO IT, and the lamps are worked out afresh every time. Edit the shape
// and the array follows it, which is the thing that was asked for.
//
// WHICH IS ALSO WHY THE LAMPS ARE NOT IN `manualCobs`. A hand-placed lamp is a
// decision about a point and is stored as one. An array lamp is a consequence of
// a geometry, a count and an offset; storing the twelve points it currently
// works out to would be storing a memo and calling it a record.

/** Which side of a closed geometry an array sits on. `on` is the line itself. */
export const ARRAY_SIDES = [
  { id: 'in', label: 'Inside' },
  { id: 'on', label: 'On the line' },
  { id: 'out', label: 'Outside' },
];

/**
 * THE PATH AN ARRAY IS ACTUALLY SET OUT ON — the geometry, offset if asked.
 *
 * AN OPEN GEOMETRY IS NEVER OFFSET. A line has no inside: "a foot in from it"
 * names two paths, one either side, and nothing in the drawing says which one
 * was meant. So a line is used as drawn and the side control is not offered for
 * one — see `arrayAsks`.
 *
 * A ROOM OUTLINE IS THE SAME SHAPE OF THING AS A DRAWN ONE and goes through
 * here identically. What differs is only what it will ALLOW: outward is refused,
 * because outside a room's outline is the next flat. That is the caller's gate
 * (see `arrayAsks`), not this function's — this one offsets whatever it is given
 * in whichever direction it is told, and a caller that asks for the impossible
 * gets it.
 *
 * `null` WHEN THE OFFSET EATS THE SHAPE. `offsetPolygon` refuses rather than
 * folds — see its note — and an array on a path that does not exist is nothing
 * rather than a heap of lamps at the middle.
 */
export function arrayPath(outline, { closed = true, side = 'on', offsetFt = 0,
                                     dx = 0, dy = 0 } = {}) {
  const pts = outline ?? [];
  if (pts.length < 2) return null;
  const set = (!closed || side === 'on' || !(offsetFt > 0))
    ? pts
    : offsetPolygon(pts, side === 'out' ? offsetFt : -offsetFt);
  return shiftPts(set, dx, dy);
}

/**
 * WHERE THE RUN HAS BEEN CARRIED TO, ON TOP OF THE GEOMETRY IT CAME FROM.
 *
 * THE OTHER HALF OF "the geometry is referenced, never copied". An array stores
 * WHICH geometry and WHAT IT DID TO IT, and this is one more entry in the second
 * list beside the count, the side and the distance — not a copy of the first.
 * Edit the rectangle and a translated array still follows it; the run keeps the
 * displacement somebody dragged it by.
 *
 * IT HAS TO EXIST BECAUSE THE ONE ALTERNATIVE IS WORSE. Dragging a run of lamps
 * could have moved the GEOMETRY under it, and on a drawn rectangle that would be
 * defensible — but the geometry is very often the ROOM'S OWN OUTLINE, and there
 * is no sense in which dragging four downlights moves a room. One rule for both
 * sources, and it is this one.
 *
 * `null` PASSES THROUGH UNTOUCHED so that a path that does not exist stays one:
 * `arrayPath` refuses an offset that eats the shape, and shifting nothing by
 * nothing must not turn that refusal into an empty list.
 *
 * SAME UNITS AS THE OUTLINE, which is the caller's business — every other
 * length in this file is stated in whichever space it was handed.
 */
export const shiftPts = (pts, dx = 0, dy = 0) => (
  !pts || (!dx && !dy) ? pts : pts.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })));

/**
 * WHERE THE LAMPS GO — the whole of an array, resolved.
 *
 * --- THE CORNERS DECIDE, WHEREVER THERE ARE ANY ------------------------------
 *
 * THIS USED TO DIVIDE THE PERIMETER AND IT WAS WRONG ON EVERY SHAPE WITH A
 * CORNER IN IT. Four lamps on an 11 x 8 rectangle came out at 9.5 ft intervals
 * measured round the outline: one on the top-left corner and the other three
 * stranded in the middle of three different edges. It is a faithful reading of
 * "four, evenly spaced" and it is not what anybody drawing a rectangle means —
 * they drew four corners, and four lamps go on them.
 *
 * SO A SHAPE WITH CORNERS IS SET OUT FROM THEM: every corner gets a lamp, and
 * each edge is then cut into equal parts. That makes the count step in the
 * geometry's own units — 4, 8, 12 on a rectangle; 6, 12, 18 on a hexagon; 3, 6,
 * 9 on a triangle — which is `arrayQuanta`, and it is why a number typed into
 * the bar is quantised rather than taken. The one shape that keeps the old
 * behaviour is the one that has no corners to keep: a circle. A straight line
 * keeps it too, because on a two-point path the two rules agree — see the note
 * there.
 *
 * `corners` COMES FROM THE CALLER AND IS NOT READ OFF `outline`, because it
 * cannot be: `outlineFt` hands back 72 points for a circle and ten per fillet
 * for a rounded rectangle, so counting the path's own points would say a circle
 * has 72 corners. See `cornersFt` in ceilingShapes.js, and `arrayOutline` in
 * App.jsx for the room-outline case, where every vertex is a corner.
 *
 * `ends` IS FOR AN OPEN PATH WITH NOTHING TO ANCHOR ON, and means what it means
 * in `pointsAlong`: the first and last lamp sit ON the ends of the line you
 * drew. That is the right default here for the reason it is the right default
 * there — you drew that line to say where the run goes, so its ends are a
 * statement. An anchored open path lands on its ends by construction (they are
 * corners), and a closed path has no ends and ignores it.
 */
export function arraySpots(outline, { closed = true, side = 'on', offsetFt = 0,
                                      count = 0, ends = true, dx = 0, dy = 0,
                                      corners = null } = {}) {
  const path = arrayPath(outline, { closed, side, offsetFt, dx, dy });
  if (!path) return [];
  const q = arrayQuanta(corners, closed);
  /* NOTHING TO ANCHOR ON — a circle, or a straight line. Spacing is free and
     `pointsAlong` is the whole answer; see `arrayQuanta` for why those two are
     the cases and not an omission. */
  if (q.free) return pointsAlong(path, count, { closed, ends });
  const n = quantiseCount(count, q);
  /* HOW MANY PER SPAN, WHICH IS ALWAYS A WHOLE NUMBER by the time it gets here:
     `quantiseCount` only ever returns a count the geometry can produce, so this
     division is exact. Stated as a division rather than carried alongside the
     count because the COUNT is what is stored and shown — `per` is a fact about
     it, and two stored numbers that have to agree eventually do not. */
  const per = closed ? n / q.base : (n - 1) / q.step;
  /* THE CORNERS MOVE WITH THE RUN. They are positions on the shape and the path
     has been carried by (dx, dy); projecting the old corners onto the new path
     would find the nearest EDGE of a ring that is no longer under them, which on
     a run dragged clear of its own shape is a different edge entirely. */
  return pointsAnchored(path, shiftPts(corners, dx, dy), per, { closed });
}

/**
 * THE COUNTS THIS GEOMETRY CAN ACTUALLY PRODUCE.
 *
 * AN ARRAY ON A CLOSED SHAPE IS NOT A FREE NUMBER OF LAMPS, and that is the
 * whole of this. A rectangle has four places a lamp obviously goes; ask for four
 * and they are the corners, ask for eight and they are the corners and the
 * middle of each edge. Five is not a worse version of either — it is a run that
 * has stopped describing the rectangle, with one lamp on a corner and the rest
 * walking round out of step with every edge. See `pointsAnchored`, which is
 * where the arithmetic is.
 *
 * SO THE COUNT STEPS IN THE GEOMETRY'S OWN UNITS:
 *
 *   CLOSED, V CORNERS   V, 2V, 3V... A hexagon gives 6, 12, 18, 24; a triangle
 *                       3, 6, 9. `base` and `step` are both V, because the
 *                       smallest run that hits every corner IS one per corner.
 *   OPEN, V CORNERS     V, then V + (V-1) each time — an L with three points
 *                       gives 3, 5, 7. There are V-1 spans rather than V, so the
 *                       step is one per SPAN and the base is still one per
 *                       corner: `(V-1) x per + 1`.
 *
 * TWO KINDS OF GEOMETRY ARE FREE, AND BOTH ARE FREE FOR THE SAME REASON — there
 * is nowhere on them a lamp is obliged to sit:
 *
 *   A CIRCLE has no corners at all. `cornersFt` says so by returning nothing,
 *   which is a fact about a circle and not a missing case: every point on it is
 *   like every other, so any count is as true to the geometry as any other.
 *   A STRAIGHT LINE has two, and they are its ends — which is exactly what
 *   `pointsAlong` already lands on with `ends` set. Anchoring it would say the
 *   same thing and cost the one arrangement that is only reachable freely: a
 *   single lamp, in the middle of the line.
 *
 * `base: 4` ON A FREE GEOMETRY is what the bar opens on, and it is the figure
 * this tool has always opened on — see the press that picks a geometry.
 */
export function arrayQuanta(corners = null, closed = true) {
  const v = corners?.length ?? 0;
  if (v < 3) return { base: 4, step: 1, free: true };
  return closed ? { base: v, step: v, free: false }
                : { base: v, step: v - 1, free: false };
}

/**
 * THE NEAREST COUNT THE GEOMETRY CAN PRODUCE.
 *
 * IT ROUNDS RATHER THAN REFUSES, which is the rule this app follows everywhere a
 * stored figure meets a list that has since changed — see `nearestBeam` for the
 * same argument about an optic. A count arrives here from three places and none
 * of them can be trusted to be a multiple: a plan saved before the corners
 * mattered, a number typed into the bar, and an array whose geometry has been
 * edited from a hexagon into a rectangle under it. All three resolve to a run
 * that describes the shape rather than to no run at all.
 *
 * NEVER BELOW `base`. Fewer lamps than the shape has corners cannot hit them
 * all, so the smallest honest answer is one per corner.
 */
export const quantiseCount = (n, q) => {
  const want = Math.max(1, Math.round(Number(n) || 0));
  if (q.free) return want;
  if (want <= q.base) return q.base;
  const m = Math.max(1, Math.round((want - q.base) / q.step) + 1);
  return q.base + (m - 1) * q.step;
};

/**
 * WHAT THE BAR SHOULD ASK ABOUT THIS GEOMETRY, and what it must not offer.
 *
 * THE CONTROLS ARE A FACT ABOUT THE GEOMETRY, so they are worked out here rather
 * than by the bar reading flags off three different places. An open path gets a
 * count and nothing else; a closed one gets a side and a distance as well; and a
 * ROOM OUTLINE gets those with outward struck off.
 *
 * OUTWARD IS REFUSED ON A ROOM AND NOT MERELY DISCOURAGED. Outside a room's
 * outline is the next room, or the stairwell, or the outside of the building —
 * ceiling this drawing does not own and this plan cannot light. It is the one
 * offset that can produce lamps nobody can install.
 *
 * `maxOffsetFt` IS HOW FAR IN THE CONTROL MAY GO, and it comes from the geometry
 * itself — see `maxInset`, which bisects on the real offset rather than guessing
 * at an inradius, because an L-shaped room has not got one. Outward has no
 * limit worth stating: a ring can always grow.
 */
export function arrayAsks(outline, { closed = true, isRoom = false,
                                     corners = null } = {}) {
  /* WHAT THE COUNT MAY BE, AND IT IS A FACT ABOUT THE CORNERS. The control is a
     number box either way; what changes is what it steps in — see
     `arrayQuanta`. Handed out here with everything else the bar asks so that
     the bar draws what it is given rather than working out from a flag whether
     this particular shape has corners. */
  const q = arrayQuanta(corners, closed);
  const counts = { countMin: q.base, countStep: q.step, countBase: q.base };
  if (!closed) {
    return { count: true, side: false, offset: false, sides: [], maxOffsetFt: 0,
             ...counts };
  }
  const sides = isRoom ? ARRAY_SIDES.filter((s) => s.id !== 'out') : ARRAY_SIDES;
  return {
    count: true, side: true, offset: true, sides,
    maxOffsetFt: maxInset(outline ?? []),
    ...counts,
  };
}

/**
 * IS THIS POINT INSIDE THE BAND NOTHING SHOULD SIT IN — and how far in.
 *
 * `distanceToBoundary` MEASURES TO THE NEAREST EDGE OF THE POLYGON, which is
 * what "too near a wall" means in an L-shaped room: the inside corner of the L
 * is two walls and the fitting is close to both. A per-wall test would have had
 * to decide which wall it was about.
 *
 * Returns null where there is nothing to be near — no outline, or no scale to
 * turn feet into pixels — rather than a false, because "not too close" and "we
 * cannot say" are different answers and the drawing shows nothing for either.
 */
export function wallClearance(p, polygonPx, pxPerFt) {
  if (!p || !polygonPx?.length || !(pxPerFt > 0)) return null;
  const ft = distanceToBoundary(p, polygonPx) / pxPerFt;
  return ft < WALL_CLEARANCE_FT ? { ft, limitFt: WALL_CLEARANCE_FT } : null;
}

/**
 * THE BED UNDER THE POINT, if there is one.
 *
 * A BED IS THE ONE OBSTACLE ON THIS DRAWING THAT IS ABOUT A PERSON RATHER THAN
 * ABOUT A CEILING. A fan is a thing a light would foul; a bed is a place
 * somebody lies on their back and looks straight up, and a downlight over it is
 * glare in the eye of whoever is in it. That is why the grid keeps off one (see
 * bedGrid.js) and why this is worth drawing rather than leaving to the placer's
 * judgement — the rule is invisible on a plan, and a spot dropped over a
 * mattress looks perfectly reasonable until somebody is under it.
 *
 * `zonesPx` IS THE ROOM'S OWN NO-LIGHT LIST, which carries every kind of zone;
 * `cls === 'bed'` is what the rest of this app already tests for one. Other
 * zones are not drawn here on purpose — a no-light box somebody drew by hand is
 * a box they drew ON PURPOSE, and warning them about their own instruction is
 * noise.
 */
export function bedUnder(p, zonesPx = []) {
  if (!p) return null;
  for (const z of zonesPx) {
    if (z.cls !== 'bed') continue;
    const r = z.rect ?? z;
    if (r.x0 == null) continue;
    if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) return r;
  }
  return null;
}

/**
 * WHERE A HAND-PLACED COB LANDS: exactly where the click was.
 *
 * A FUNCTION AND NOT A LINE AT THE CALL SITE, because it is the one place the
 * "no clamping" rule can be broken, and it should take a deliberate edit to
 * break it. Everything the caller knows — the wall band, the bed, the snap
 * guides the strip tool uses — is deliberately not passed in.
 *
 * PLAN FEET AND NOT PIXELS, for the reason `manualCoves` and `manualTracks` are
 * both in feet: a plan reopened after its scale has been corrected has its
 * fittings where they were SET OUT, not where they happened to be on screen.
 */
/** A fresh id for a hand-placed lamp.
 *
 *  ONE MINTER FOR BOTH WAYS A LAMP COMES INTO EXISTENCE — a press on the ceiling
 *  and an Option-drag copy — because an id is what every store, every selection
 *  and every analysis row is keyed by, and two formats would be two things to
 *  recognise. `seq` only has to separate lamps minted inside the same
 *  millisecond, which is what a copy and its original are. */
export const newCobId = (seq = 0) => `mcob-${Date.now().toString(36)}-${seq}`;

export function placeCob({ p, pxPerFt, roomId, watts, beam, spec = false, seq = 0 }) {
  return {
    id: newCobId(seq),
    roomId,
    xFt: p.x / pxPerFt,
    yFt: p.y / pxPerFt,
    watts: clampWatts(watts),
    beam: nearestBeam(beam),
    /* WHETHER THIS LAMP WAS SPECIFIED OR INHERITED, and it is kept because the
       two are different facts about the drawing. A COB placed on the engine's
       own recommendation agrees with the ceiling around it; one somebody dialled
       up to 24 W is a decision, and the analysis row is where they will go
       looking for it. Nothing enforces anything on it — it is a record. */
    spec: !!spec,
  };
}
