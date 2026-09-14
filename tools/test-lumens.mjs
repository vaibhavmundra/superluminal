// tools/test-lumens.mjs — the ambient lumen model. Pure arithmetic, no drawing.
import { SURFACE_REFLECTANCE, LUMENS_PER_SQFT, LUMENS_PER_SQFT_DEFAULT,
         LUMENS_PER_WATT_DEFAULT, STRIP_WATTS_PER_M, STRIP_LOSS,
         STRIP_LUMENS_PER_WATT,
         FIXTURE_FAMILIES, FAMILY_BY_ID,
         reflectanceOf, surfaceAreas, lumensPerSqftFor, lumensPerWattFor,
         lumensRequired, bounceOf, unitOutput, wattsFor, analyseSpace, ftToM,
         AMBIENT_SHARE_MIN, ambientShare, ambientIsLow }
  from '../src/lib/lumens.js';

/* --- THE TABLE IS THE SPECIFICATION, SO THE TEST READS IT ------------------
   Every figure in lumens.js is there to be edited — that is the whole point of
   the file — and a test that hard-codes 0.9 turns a deliberate change of the
   light-surface reflectance into a red build. So what is asserted here is the
   SHAPE and the ARITHMETIC: that the three tones descend, that a weighted mean
   is weighted, that the loss comes off. The only literals left are the ones the
   brief itself fixes and that nothing should silently move — the lm/sqft
   targets, the two lumens-per-watt figures, the six distributions and the 20%
   strip loss. Change one of those on purpose and this file is the second place
   you change it, which is correct: they are the specification. */
const R = SURFACE_REFLECTANCE;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const at = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const sec = (s) => console.log('\n' + s);

/** 12 x 10, so 120 sqft of floor and 44 ft of perimeter. */
const ROOM = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }];
const LIGHT = { ceiling: 'light', floor: 'light', walls: {} };

sec('every constant the brief names is here and editable');
{
  // THE ORDER AND NOT THE VALUES — see the note at the top. A table where dark
  // reflects more than light is broken whatever the numbers are.
  for (const surface of ['ceiling', 'floor', 'wall']) {
    const t = R[surface];
    if (!(t.light >= t.medium && t.medium >= t.dark && t.dark > 0 && t.light <= 1)) {
      ok(`${surface} tones descend`, false, JSON.stringify(t));
    }
  }
  ok('every surface has three tones that descend', true);
  // Light and medium are one figure on a floor and that IS the specification,
  // not an omission — there is no 0.9 floor in a room people walk in.
  ok('a floor makes no distinction between light and medium',
    R.floor.light === R.floor.medium);
  ok('...and a wall does', R.wall.light > R.wall.medium);

  ok('residential and hospitality are 10', LUMENS_PER_SQFT.residential === 10
    && LUMENS_PER_SQFT.hotel === 10 && LUMENS_PER_SQFT.restaurant === 10);
  ok('commercial is 20', LUMENS_PER_SQFT.office === 20);
  ok('retail is 30, ahead of there being one', LUMENS_PER_SQFT.retail === 30);
  ok('a project nobody has a figure for takes the default',
    lumensPerSqftFor('nothing-like-this') === LUMENS_PER_SQFT_DEFAULT);

  ok('India is 75 lm/W', lumensPerWattFor('India') === 75);
  ok('...and so is IN', lumensPerWattFor('IN') === 75);
  ok('abroad is 100', lumensPerWattFor('United Kingdom') === LUMENS_PER_WATT_DEFAULT);
  ok('...and so is a country the plate registry knows but this table does not',
    lumensPerWattFor('United States') === LUMENS_PER_WATT_DEFAULT);
  // A plan whose country nobody filled in is not abroad — see the note on
  // `lumensPerWattFor` for why these two cases are separated.
  ok('a country nobody stated is the app\'s own default', lumensPerWattFor(null) === 75);
  ok('...and so is an empty one', lumensPerWattFor('  ') === 75);
}

sec('a family is where its light goes, and the splits add up');
{
  for (const f of FIXTURE_FAMILIES) {
    const t = f.split.ceiling + f.split.walls + f.split.floor;
    if (!at(t, 1)) ok(`${f.id} splits sum to 1`, false, String(t));
  }
  ok('every split sums to 1', true);
  ok('a cove throws at the slab', FAMILY_BY_ID.cove.split.ceiling === 0.8);
  ok('a reverse cove throws at the walls', FAMILY_BY_ID.reverse_cove.split.walls === 0.8);
  ok('a COB throws at the floor', FAMILY_BY_ID.cob.split.floor === 0.8);
  ok('a lamp throws everywhere', FAMILY_BY_ID.lamp.split.ceiling === 0.25
    && FAMILY_BY_ID.lamp.split.walls === 0.5 && FAMILY_BY_ID.lamp.split.floor === 0.25);
  // A sconce is a decorative fitting standing off a wall, not a slot washing
  // one — so it throws like a lamp and not like a reverse cove.
  ok('a sconce throws like a lamp',
    JSON.stringify(FAMILY_BY_ID.sconce.split) === JSON.stringify(FAMILY_BY_ID.lamp.split));
  ok('...and is specified at one wattage',
    FAMILY_BY_ID.sconce.watts.length === 1 && FAMILY_BY_ID.sconce.watts[0] === 7);
  ok('...which is therefore also its default', FAMILY_BY_ID.sconce.defaultWatts === 7);
  /* --- AND A LAMP IS SEVEN TOO, WHICH IT WAS NOT ---------------------------
     THE FAMILY HAD NO TOOL WHEN IT WAS WRITTEN, so its default was the middle
     of a range for a product nobody could place. There are three now — a
     chandelier, a pendant and a standing lamp, all placed by hand from the
     Lamps flyout — and all three are specified at 7 W.
     THE LIST IS UNTOUCHED, deliberately: 5, 9 and 12 W lamps exist and the
     panel still offers them per room. What changed is where a room STARTS. */
  ok('a decorative lamp is specified at 7 W', FAMILY_BY_ID.lamp.defaultWatts === 7);
  ok('...and the range it is chosen from is unchanged',
    FAMILY_BY_ID.lamp.watts.join(',') === '5,7,9,12');
  ok('tape is sold by the metre off one shared list',
    FAMILY_BY_ID.cove.watts === STRIP_WATTS_PER_M && FAMILY_BY_ID.cove.unit === 'm');
  ok('...and so are the other three strip families',
    ['reverse_cove', 'ceiling_strip', 'shelf_strip']
      .every((id) => FAMILY_BY_ID[id].watts === STRIP_WATTS_PER_M));
  ok('a COB is 3 to 12 W a piece',
    FAMILY_BY_ID.cob.watts.join() === '3,5,7,9,12' && FAMILY_BY_ID.cob.unit === 'nos');
  ok('every strip family starts at 5 W/m',
    ['cove', 'reverse_cove', 'ceiling_strip', 'shelf_strip']
      .every((id) => FAMILY_BY_ID[id].defaultWatts === 5));
  ok('every family has a default that is one of its options',
    FIXTURE_FAMILIES.every((f) => f.watts.includes(f.defaultWatts)));
}

sec('the walls are averaged by LENGTH, which is the whole point of it');
{
  const all = reflectanceOf(LIGHT, ROOM);
  ok('everything light', at(all.ceiling, R.ceiling.light) && at(all.floor, R.floor.light)
    && at(all.wall, R.wall.light));
  ok('...and the average is the plain mean of the three',
    at(all.avg, (R.ceiling.light + R.floor.light + R.wall.light) / 3));

  // Edge 0 is a 12ft wall out of 44ft of perimeter. The brief's own example:
  // some of the walls dark, the rest white, and the answer is the weighted mean.
  const one = reflectanceOf({ ...LIGHT, walls: { 0: 'dark' } }, ROOM);
  const want = (R.wall.dark * 12 + R.wall.light * 32) / 44;
  ok('one dark wall is weighted by its length', at(one.wall, want), String(one.wall));
  ok('...which is not the same as a quarter of the walls being dark',
    !at(one.wall, (R.wall.dark + R.wall.light * 3) / 4));

  // The same COUNT of walls, the short one instead — a plain average could not
  // tell these two rooms apart and they are not the same room.
  const short = reflectanceOf({ ...LIGHT, walls: { 1: 'dark' } }, ROOM);
  ok('a short dark wall costs less than a long one', short.wall > one.wall);

  ok('a room with no outline is every wall at the default',
    at(reflectanceOf(LIGHT, []).wall, R.wall.light));
  ok('a tone nobody recognises is the default',
    at(reflectanceOf({ ceiling: 'teal', floor: null, walls: {} }, ROOM).ceiling,
       R.ceiling.light));
}

sec('the surface a room has');
{
  const a = surfaceAreas(ROOM, 2700);
  ok('the floor is the polygon', at(a.floorSqft, 120));
  ok('the ceiling is the floor', at(a.ceilingSqft, 120));
  ok('the perimeter is walked once', at(a.perimeterFt, 44));
  ok('the height comes back in feet', at(a.heightFt, 2700 / 304.8));
  ok('the walls are perimeter x height', at(a.wallSqft, 44 * (2700 / 304.8)));
  ok('TOT_SF is all three', at(a.totalSqft, 240 + 44 * (2700 / 304.8)));

  // The height field is the reason a taller room asks for more, and this is the
  // assertion that says so.
  const tall = surfaceAreas(ROOM, 3600);
  ok('a taller room has more surface', tall.totalSqft > a.totalSqft);
  ok('a height of nothing is no walls', at(surfaceAreas(ROOM, 0).wallSqft, 0));
}

sec('what a space is owed');
{
  const ref = reflectanceOf(LIGHT, ROOM);
  const a = surfaceAreas(ROOM, 2700);
  const req = lumensRequired(10, a.totalSqft, ref.avg);
  ok('LU_REQ x TOT_SF x (1 - AVG_REF)',
    at(req, 10 * a.totalSqft * (1 - ref.avg)));
  // A SECOND, INDEPENDENT DERIVATION — the arithmetic written out longhand,
  // touching neither `surfaceAreas` nor `reflectanceOf`. That is what makes it a
  // check rather than a restatement of the line above, and it survives the
  // reflectance table being edited, which is what that table is for.
  const byHand = 10 * (120 + 120 + 44 * (2700 / 304.8))
    * (1 - (R.ceiling.light + R.floor.light + R.wall.light) / 3);
  ok('...and the whole of it is reproducible by hand', at(req, byHand), String(req));

  // The half of the model worth stating out loud: a dark room needs MORE.
  const dark = reflectanceOf({ ceiling: 'dark', floor: 'dark', walls: { 0: 'dark', 1: 'dark', 2: 'dark', 3: 'dark' } }, ROOM);
  ok('a dark room is owed more than a white one',
    lumensRequired(10, a.totalSqft, dark.avg) > req);
  ok('...and a commercial one more than a residential one',
    lumensRequired(20, a.totalSqft, ref.avg) > req);
}

sec('what a fitting gives back');
{
  const ref = reflectanceOf(LIGHT, ROOM);
  // A cove: four fifths of it at the ceiling and a fifth at the walls.
  ok('the bounce is the split against the reflectances',
    at(bounceOf(FAMILY_BY_ID.cove.split, ref),
       0.8 * R.ceiling.light + 0.2 * R.wall.light));
  ok('a COB in the same room gives back less than a cove',
    bounceOf(FAMILY_BY_ID.cob.split, ref) < bounceOf(FAMILY_BY_ID.cove.split, ref));

  // ...and the same COB gives back less again once the floor goes dark, which
  // is the whole reason the finishes are asked for before anything is placed.
  const darkFloor = reflectanceOf({ ...LIGHT, floor: 'dark' }, ROOM);
  ok('a dark floor costs a COB most of its worth',
    bounceOf(FAMILY_BY_ID.cob.split, darkFloor)
      < bounceOf(FAMILY_BY_ID.cob.split, ref));
  ok('...and costs a cove almost nothing',
    at(bounceOf(FAMILY_BY_ID.cove.split, darkFloor),
       bounceOf(FAMILY_BY_ID.cove.split, ref)));

  ok('output is watts x lumens per watt', at(unitOutput(FAMILY_BY_ID.cob, 7, 75), 525));
  ok('a fixed lumen figure wins over the wattage',
    at(unitOutput({ ...FAMILY_BY_ID.cob, lumens: 800 }, 7, 75), 800));

  // --- WHAT THE DETAIL EATS ------------------------------------------------
  // A strip is a reel driven from one end and buried in a pocket; a COB is a
  // finished luminaire. Specifying the first as though it were the second is the
  // mistake STRIP_LOSS exists to stop, so both halves are asserted: that the
  // deduction happens, and that it happens to nothing else.
  // --- WHAT THE TAPE ITSELF MAKES ------------------------------------------
  // A reel is a commodity and a downlight is not: the country figure is about
  // fittings, so tape states its own and ignores it.
  ok('tape is 100 lm/W', STRIP_LUMENS_PER_WATT === 100);
  ok('every strip family says so',
    ['cove', 'reverse_cove', 'ceiling_strip', 'shelf_strip']
      .every((id) => FAMILY_BY_ID[id].lumensPerWatt === STRIP_LUMENS_PER_WATT));
  ok('...and no finished luminaire does',
    ['cob', 'panel', 'lamp', 'sconce'].every((id) => !FAMILY_BY_ID[id].lumensPerWatt));
  // THE POINT OF THE OVERRIDE, in one pair: the same room, the same two
  // fittings, and only one of them is worth less in India.
  ok('a cove is the same in India and abroad',
    at(unitOutput(FAMILY_BY_ID.cove, 9, 75), unitOutput(FAMILY_BY_ID.cove, 9, 100)));
  ok('...where a COB is not',
    unitOutput(FAMILY_BY_ID.cob, 7, 75) < unitOutput(FAMILY_BY_ID.cob, 7, 100));

  // THE FIGURE IS THE SPECIFICATION'S TO SET — see the note at the top of this
  // file. What is asserted is that there IS one and that it is a fraction, not
  // what it happens to be this week.
  ok('there is a strip loss and it is a fraction',
    STRIP_LOSS > 0 && STRIP_LOSS < 1);
  ok('every strip family carries it',
    ['cove', 'reverse_cove', 'ceiling_strip', 'shelf_strip']
      .every((id) => FAMILY_BY_ID[id].loss === STRIP_LOSS));
  ok('...and no finished luminaire does',
    ['cob', 'panel', 'lamp', 'sconce'].every((id) => !FAMILY_BY_ID[id].loss));
  ok('it comes off the output',
    at(unitOutput(FAMILY_BY_ID.cove, 9, 75),
       9 * STRIP_LUMENS_PER_WATT * (1 - STRIP_LOSS)));
  // See STRIP_LOSS: `loss` describes the installation, not the reel, so it
  // applies to a stated product figure too. A family specified at its measured
  // installed output sets `loss: 0` rather than being deducted twice.
  ok('...off a fixed lumen figure as well',
    at(unitOutput({ ...FAMILY_BY_ID.cove, lumens: 1000 }, 9, 75),
       1000 * (1 - STRIP_LOSS)));
  ok('a family with no loss loses nothing',
    at(unitOutput({ ...FAMILY_BY_ID.cove, loss: 0 }, 9, 75),
       9 * STRIP_LUMENS_PER_WATT));

  ok('a wattage nobody offered falls back to the default',
    wattsFor('cob', { cob: 6 }) === FAMILY_BY_ID.cob.defaultWatts);
  ok('...and one that was offered is taken', wattsFor('cob', { cob: 12 }) === 12);
  ok('a family nobody knows has no wattage', wattsFor('gaslight', {}) === null);
  // THE STORE IS KEYED BY ROW AND NOT BY FAMILY, which is what lets two cove
  // runs in one room carry two different wattages.
  ok('a row is looked up by its own key',
    wattsFor('cove', { 'cove-a': 11, 'cove-b': 5 }, 'cove-a') === 11);
  ok('...and a row nobody has touched is at the default',
    wattsFor('cove', { 'cove-a': 11 }, 'cove-b') === FAMILY_BY_ID.cove.defaultWatts);
  ok('...and the family id is the key when the caller gives none',
    wattsFor('cob', { cob: 12 }) === 12);
}

sec('every run is its own row');
{
  const many = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ key: 'cove-a', familyId: 'cove', count: 1, lengthFt: 20 },
             { key: 'cove-b', familyId: 'cove', count: 1, lengthFt: 12 },
             { key: 'rc-1', familyId: 'reverse_cove', count: 1, lengthFt: 9 },
             { key: 'cob', familyId: 'cob', count: 4 }],
    watts: { 'cove-b': 11 },
  });
  ok('two cove runs are two rows', many.rows.filter((r) => r.familyId === 'cove').length === 2);
  ok('...numbered so they can be told apart',
    many.rows[0].label === 'Cove 1' && many.rows[1].label === 'Cove 2');
  ok('...and a family with one row is not numbered',
    many.rows.find((r) => r.familyId === 'reverse_cove').label === 'Reverse cove');
  ok('each run carries its own length',
    Math.round(many.rows[0].lengthFt) === 20 && Math.round(many.rows[1].lengthFt) === 12);
  // The whole reason a run is a row: one wattage moves and the other does not.
  ok('...and its own wattage', many.rows[0].watts === 5 && many.rows[1].watts === 11);
  ok('four COBs are still one row',
    many.rows.filter((r) => r.familyId === 'cob').length === 1);
  ok('the rows come back in the table\'s order',
    many.rows.map((r) => r.familyId).join() === 'cove,cove,reverse_cove,cob');
  ok('achieved is the sum of every row',
    at(many.achieved, many.rows.reduce((t, r) => t + r.netLumens, 0)));
  ok('every row has a key of its own',
    new Set(many.rows.map((r) => r.key)).size === many.rows.length);
}

sec('a row states the default it would read with nothing stored');
{
  /* --- THE CHIP THAT COULD NOT BE PRESSED --------------------------------
     A ROW MAY OPEN SOMEWHERE OTHER THAN ITS FAMILY'S DEFAULT, and the spots
     are why: a directional spot and an ambient downlight are one FAMILY and
     two catalogue lines, 5 W against 7. `fixtureGroups` stamps the row's own
     `defaultWatts` and `wattsFor` honours it — but the WRITE has to know the
     same number, because "a choice back at the default stores nothing" is the
     rule every override in this app follows. It was being handed the family's
     7 regardless, so pressing 7 W on a Directional spot row read as "back to
     the default", deleted the override, and the row fell straight back to 5:
     one chip out of five that could not be chosen, and the most familiar
     figure of the five. So the row carries the answer. */
  const rowFor = (group, stored = {}) => analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [group], watts: stored,
  }).rows[0];

  const grid = rowFor({ key: 'cob', familyId: 'cob', count: 3 });
  ok('an ordinary row is at its family default',
    grid.defaultWatts === FAMILY_BY_ID.cob.defaultWatts);

  const SPOT = { key: 'spot', familyId: 'cob', count: 1, defaultWatts: 5 };
  const spot = rowFor(SPOT);
  ok('...and a row with a default of its own says so, not the family\'s',
    spot.defaultWatts === 5 && FAMILY_BY_ID.cob.defaultWatts !== 5,
    `${spot.defaultWatts} vs family ${FAMILY_BY_ID.cob.defaultWatts}`);
  ok('...which is the figure it opens at', spot.watts === 5);

  /* THE ROUND TRIP, WHICH IS WHERE THE FAULT ACTUALLY LIVED: every chip the
     family offers has to come back off the store as itself. `ROW_WATTS_SET` in
     usePlanDoc is the rule — a wattage equal to the default stores nothing —
     and this walks the whole list through it exactly as `setRowWatts` does. */
  const store = (row, w) => (w === row.defaultWatts ? {} : { [row.key]: w });
  const unreachable = FAMILY_BY_ID.cob.watts
    .filter((w) => rowFor(SPOT, store(spot, w)).watts !== w);
  ok('...and every wattage the family sells can be chosen on it',
    unreachable.length === 0, `unreachable: ${unreachable.join(', ')} W`);
}

sec('the whole reading for one space');
{
  const empty = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
                               projectId: 'residential', country: 'India' });
  ok('nothing placed is nothing achieved', empty.achieved === 0);
  ok('...and no rows to show', empty.rows.length === 0);
  ok('...but it is still owed something', empty.required > 0);
  ok('...and it is the same figure the pieces give',
    at(empty.required, lumensRequired(lumensPerSqftFor('residential'),
      surfaceAreas(ROOM, 2700).totalSqft, reflectanceOf(LIGHT, ROOM).avg)));
  ok('...and it is short by the whole of it', at(empty.shortfall, empty.required));
  ok('...and it does not claim to be enough', empty.ok === false);

  const lit = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ familyId: 'cove', count: 1, lengthFt: 20 },
             { familyId: 'cob', count: 1, lengthFt: 0 }],
  });
  const ref = reflectanceOf(LIGHT, ROOM);
  const cove = lit.rows.find((r) => r.familyId === 'cove');
  const cob = lit.rows.find((r) => r.familyId === 'cob');
  ok('one row per family', lit.rows.length === 2);
  // 20 ft is 6.096 m, at the strip default and 75 lm/W, less what the detail
  // eats. THE LOSS IS THE HALF WORTH ASSERTING: it is the difference between
  // what a reel is sold as and what a cove actually puts on a ceiling.
  ok('the cove is billed by the metre, less the strip loss',
    at(cove.totalOutput,
       20 * 0.3048 * FAMILY_BY_ID.cove.defaultWatts * STRIP_LUMENS_PER_WATT
         * (1 - STRIP_LOSS), 1e-6),
    String(cove.totalOutput));
  ok('...and contributes its bounce',
    at(cove.netLumens, cove.totalOutput * bounceOf(FAMILY_BY_ID.cove.split, ref)));
  ok('the COB is billed by the piece', at(cob.totalOutput, 7 * 75));
  ok('achieved is the sum of the rows',
    at(lit.achieved, cove.netLumens + cob.netLumens));

  // The one control the panel offers, and the thing it has to move.
  const louder = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ familyId: 'cove', count: 1, lengthFt: 20 }],
    watts: { cove: 11 },
  });
  ok('turning the tape up raises the contribution',
    louder.rows[0].netLumens > cove.netLumens);
  ok('...and the row says which wattage it is on', louder.rows[0].watts === 11);

  // Abroad the same fitting is worth a third more, which is the whole reason
  // the country is an input at all.
  const abroad = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'United Kingdom',
    groups: [{ familyId: 'cob', count: 1, lengthFt: 0 }],
  });
  ok('a watt is worth more abroad',
    at(abroad.rows[0].totalOutput, 7 * 100));

  // A family with nothing in it is not a row saying nought.
  const zero = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT, projectId: 'residential',
    groups: [{ familyId: 'cob', count: 0, lengthFt: 0 },
             { familyId: 'cove', count: 1, lengthFt: 0 }],
  });
  ok('an empty group is dropped rather than drawn', zero.rows.length === 0);
  ok('a family nobody knows is ignored', analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT, projectId: 'residential',
    groups: [{ familyId: 'gaslight', count: 3 }],
  }).rows.length === 0);

  // A SHORT RUN AT THE DEFAULT DOES NOT CLEAR THE BAR, and it should not: a few
  // feet of tape at the lowest wattage is a detail, not a room's ambient layer.
  // The length is derived from what the room is owed rather than picked, so a
  // brighter tape or a smaller loss cannot quietly turn this into a pass.
  const owed = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
                              projectId: 'residential', country: 'India' }).required;
  const perFt = 0.3048 * FAMILY_BY_ID.cove.defaultWatts * STRIP_LUMENS_PER_WATT
    * (1 - STRIP_LOSS) * bounceOf(FAMILY_BY_ID.cove.split, reflectanceOf(LIGHT, ROOM));
  const thin = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ familyId: 'cove', count: 1, lengthFt: (owed / perFt) * 0.5 }],
  });
  ok('a short run at the default is reported as short', thin.ok === false);
  ok('...and by how much', at(thin.shortfall, thin.required - thin.achieved));

  const enough = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ familyId: 'cove', count: 1, lengthFt: 44 }],
    watts: { cove: 11 },
  });
  ok('enough light is reported as enough', enough.ok === true);
  ok('...and nothing is outstanding', enough.shortfall === 0);
}

sec('the total is split into the two layers a scheme is designed in');
{
  /* AMBIENT AND TASK ARE ONE FITTING EACH, so a figure landing in the wrong
     bucket cannot hide inside another row's contribution. A track spot borrows
     the COB and is the task layer; a floor lamp washes the room and is ambient.
     THERE WAS A THIRD, 'accent', AND THE LAMP WAS IN IT. It never reached the
     readout — this file's own next section folded it into the ambient figure
     before printing — so all it did was file a chandelier in a section of the
     fixture list away from everything else that lights a room, with its wattage
     control inside it. See `layer` in lib/lumens.js. */
  const two = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ key: 'cove', familyId: 'cove', count: 1, lengthFt: 20 },
             { key: 'spot', familyId: 'track_spot', count: 3 },
             { key: 'lamp', familyId: 'lamp', count: 2 }],
  });
  const netOf = (k) => two.rows.find((r) => r.key === k).netLumens;
  ok('a cove is the ambient figure...', at(two.contributions.ambient,
    netOf('cove') + netOf('lamp')));
  ok('...a decorative lamp is in it too, and not in a layer of its own',
    netOf('lamp') > 0 && two.contributions.ambient > netOf('cove'));
  ok('...and the track spot is the task figure', at(two.contributions.task, netOf('spot')));
  /* THE ONE PROPERTY THE GROUPING DEPENDS ON: the fixture list draws a section
     per layer, so figures that did not add back to the total would be a panel
     whose sections do not account for their own room. */
  ok('the two add back up to achieved',
    at(two.contributions.ambient + two.contributions.task, two.achieved));
  /* AND EVERY ROW IS IN EXACTLY ONE OF THEM, which is what stops a fitting
     going missing from a panel that claims to list the room. This is the
     assertion that would have caught the third layer's removal leaving a family
     behind: a row whose layer has no section is a fitting on the drawing, in
     the arithmetic, and nowhere in the list. */
  ok('every row is in one of the two layers',
    two.rows.every((r) => ['ambient', 'task'].includes(r.layer)));
  /* EVERY FAMILY, NOT JUST THE THREE ABOVE. The families are the table; a new
     one added with a layer the panel cannot draw is exactly the mistake. */
  ok('...and so is every family in the table',
    FIXTURE_FAMILIES.every((f) => ['ambient', 'task'].includes(f.layer)));
  ok('the decorative lamp family is ambient',
    FAMILY_BY_ID.lamp.layer === 'ambient');
  ok('...and so are the sconce and the shelf strip that shared its section',
    FAMILY_BY_ID.sconce.layer === 'ambient'
      && FAMILY_BY_ID.shelf_strip.layer === 'ambient');

  /* BOTH KEYS EXIST WHATEVER IS IN THE ROOM, so a caller can print a layer
     without first asking whether the room has one — a missing key would print
     as an empty figure rather than as a zero. */
  const bare = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
                              projectId: 'residential', country: 'India' });
  ok('an empty room still answers for both layers',
    bare.contributions.ambient === 0 && bare.contributions.task === 0);
}

sec('...and the readout prints those same two figures');
{
  /* WHAT WASHES THE ROOM AND WHAT IS POINTED AT SOMETHING. A downlight is task
     light — 80% of its output goes at the floor — and a sconce is not. The
     readout prints these two, and the fixture list now groups by the same two:
     one question, asked once. */
  const room = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ key: 'cove', familyId: 'cove', count: 1, lengthFt: 20 },
             { key: 'cob', familyId: 'cob', count: 12 },
             { key: 'lamp', familyId: 'lamp', count: 2 }],
  });
  const netOf = (k) => room.rows.find((r) => r.key === k).netLumens;
  /* THE ONE THAT WAS WRONG AND IS THE REASON THIS SECTION EXISTS. `cob` was
     filed as ambient, so a twelve-lamp grid and one cove reported the grid's
     output as the room's ambient level — and a room lit entirely by downlights
     could never read as short of ambient light. */
  ok('a recessed COB is task light', at(room.contributions.task, netOf('cob')));
  ok('...and not part of the ambient figure',
    room.contributions.ambient < netOf('cob'));
  /* A DECORATIVE LAMP IS AMBIENT LIGHT, which used to be a FOLD performed here
     and is now simply what the row says. The figure is identical either way —
     that is the point, and it is why removing the layer changed no arithmetic. */
  ok('a decorative lamp counts as ambient',
    at(room.contributions.ambient, netOf('cove') + netOf('lamp')));
  ok('the two add back up to achieved',
    at(room.contributions.ambient + room.contributions.task, room.achieved));

  /* AND A 10 ft REVERSE COVE AT 5 W/m IS ABOUT A THOUSAND LUMENS. The figure is
     asserted as a RANGE rather than a literal because every constant behind it
     is meant to be edited — 100 lm/W off the reel, a fifth lost in the pocket,
     and the room's own surfaces. What is being pinned is the ORDER: a metre of
     tape is hundreds of lumens, not thousands, so an arithmetic slip anywhere in
     that chain (a feet-for-metres, a percent-for-fraction) shows up here. */
  const cove = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ key: 'rc', familyId: 'reverse_cove', count: 1, lengthFt: 10 }],
  });
  ok('a 10 ft cove at 5 W/m is hundreds of lumens, not thousands',
    cove.achieved > 500 && cove.achieved < 1500,
    `got ${Math.round(cove.achieved)}`);
  ok('...and every one of them is ambient',
    at(cove.contributions.ambient, cove.achieved) && cove.contributions.task === 0);
}

sec('a length of tape, derived end to end from the five constants');
{
  /* --- THE WHOLE CHAIN, ONE LINK AT A TIME -------------------------------
     THE FIGURE WAS DISPUTED, so what is asserted here is not the answer but the
     DERIVATION: five constants, four multiplications, and a re-derivation of
     each step from the exported pieces rather than from a literal. If any one
     link is edited on purpose these still pass; if one is edited by accident, or
     a unit is mixed up, exactly one of them fails and names the link. */
  const L_FT = 10, W_PER_M = 5;
  const fam = FAMILY_BY_ID.reverse_cove;

  const metres = ftToM(L_FT);
  ok('a. 10 ft is 3.048 m', at(metres, 3.048, 1e-9));
  ok('   ...and NOT 32.8 — the conversion is not inverted', metres < L_FT);

  const perM = unitOutput(fam, W_PER_M, lumensPerWattFor('India'));
  ok('b. tape ignores the country figure',
    at(perM, W_PER_M * STRIP_LUMENS_PER_WATT * (1 - STRIP_LOSS)));
  ok('   ...so a 5 W/m metre leaves the reel at 500 lm',
    at(W_PER_M * STRIP_LUMENS_PER_WATT, 500));
  ok('   ...and the pocket takes a fifth of it', at(STRIP_LOSS, 0.2));
  ok('   ...leaving 400 lm to the metre', at(perM, 400));

  const output = perM * metres;
  ok('c. ten feet of it is 1,219 lm out of the detail',
    Math.round(output) === 1219, `got ${Math.round(output)}`);

  const ref = reflectanceOf(LIGHT, ROOM);
  const b = bounceOf(fam.split, ref);
  ok('d. a reverse cove throws at the WALLS, not the ceiling',
    fam.split.walls === 0.8 && fam.split.ceiling === 0);
  ok('   ...so the bounce is 0.8 of the wall plus 0.2 of the floor',
    at(b, 0.8 * ref.wall + 0.2 * ref.floor));

  const net = output * b;
  const a = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ key: 'rc', familyId: 'reverse_cove', count: 1, lengthFt: L_FT }],
  });
  ok('e. and the model agrees with the four steps above',
    at(a.achieved, net), `${Math.round(a.achieved)} vs ${Math.round(net)}`);
  /* THE ONE THAT WOULD HAVE CAUGHT A STRAY CONSTANT. Nothing is added to a room
     beyond the rows it was handed — no floor, no minimum, no allowance. */
  ok('f. nothing is added that was not handed in',
    at(a.achieved, a.rows[0].netLumens) && a.rows.length === 1);

  /* AND IT IS LINEAR IN THE WATTAGE, chip for chip. A per-watt figure that
     drifts between chips is the shape every "a stray N is being added" report
     takes, so it is pinned rather than argued about. */
  const perWatt = STRIP_WATTS_PER_M.map((w) => {
    const r = analyseSpace({
      polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
      projectId: 'residential', country: 'India',
      groups: [{ key: 'rc', familyId: 'reverse_cove', count: 1, lengthFt: L_FT }],
      watts: { rc: w },
    });
    return r.achieved / w;
  });
  ok('g. every catalogue wattage gives the same lumens per watt',
    perWatt.every((v) => at(v, perWatt[0], 1e-9)),
    perWatt.map((v) => v.toFixed(2)).join(' / '));

  /* --- AND WHICH FINISH ACTUALLY MOVES IT, WHICH IS WORTH ASSERTING -------
     THE CEILING TONE CANNOT MOVE A REVERSE COVE, and that surprises people
     enough to be worth stating as a property rather than left to be discovered
     from a panel that looks broken: the fitting throws nothing at the ceiling,
     so a ceiling reflectance has nothing of its light to hand back. The WALLS
     are 80% of it. Both directions are asserted, because the day a reverse cove
     is given a ceiling share this test is the one that has to be updated. */
  const withDarkCeiling = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700,
    materials: { ceiling: 'dark', floor: 'light', walls: {} },
    projectId: 'residential', country: 'India',
    groups: [{ key: 'rc', familyId: 'reverse_cove', count: 1, lengthFt: L_FT }],
  });
  ok('h. a dark ceiling does not change a reverse cove at all',
    at(withDarkCeiling.achieved, a.achieved));
  ok('   ...though it does raise what the room is owed',
    withDarkCeiling.required > a.required);
  const withDarkWalls = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700,
    materials: { ceiling: 'light', floor: 'light',
                 walls: { 0: 'dark', 1: 'dark', 2: 'dark', 3: 'dark' } },
    projectId: 'residential', country: 'India',
    groups: [{ key: 'rc', familyId: 'reverse_cove', count: 1, lengthFt: L_FT }],
  });
  ok('   ...and dark walls cut it by most of itself',
    withDarkWalls.achieved < a.achieved * 0.45);
}

sec('a fitting somebody switched off');
{
  const groups = [{ key: 'cob@c1', familyId: 'cob', count: 4 }];
  const lit = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India', groups });
  const off = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ ...groups[0], off: true }] });

  ok('a. it contributes nothing at all', off.achieved === 0, `${off.achieved}`);
  ok('   ...where the same row lit contributes something', lit.achieved > 0);

  /* THE ROW HAS TO SURVIVE, and this is the assertion that says why the model
     zeroes rather than skips: the row is where the switch to turn the fitting
     back ON lives, so a `continue` would make an off lamp unreachable. */
  const row = off.rows.find((r) => r.key === 'cob@c1');
  ok('b. ...but the row is still there, with its count and its wattage',
    !!row && row.count === 4 && row.watts > 0, JSON.stringify(row));
  ok('   ...and it says so', row?.off === true);
  ok('   ...and a lit row does not', lit.rows[0].off === false);

  /* WHAT THE HEATMAP ASKS FOR. `indexAnalysisRows` divides `totalOutput` by the
     quantity, so this is the figure one off lamp lights a cell with. */
  ok('c. its per-fitting output is zero, which is what the heatmap reads',
    row?.totalOutput === 0 && row?.netLumens === 0);
  ok('   ...and it claims no floor lux either', !row?.floorLux);

  // ...and switching one of two off leaves exactly the other one's light.
  const two = [{ key: 'a', familyId: 'cob', count: 1 },
               { key: 'b', familyId: 'cob', count: 1 }];
  const both = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India', groups: two });
  const one = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [two[0], { ...two[1], off: true }] });
  ok('d. switching one of two off halves the room', at(one.achieved, both.achieved / 2));
}

sec('is the ambient layer carrying the room');
{
  /* THE RATIO IS THE SPECIFICATION AND IT IS ASSERTED AS ONE — see the note at
     the top of this file. What is tested around it is the ARITHMETIC: that the
     line is where the constant says, that it is measured against the TOTAL, and
     that an empty room is not judged at all. */
  ok('a. the threshold is a fraction somebody can move',
    AMBIENT_SHARE_MIN > 0 && AMBIENT_SHARE_MIN <= 1, `${AMBIENT_SHARE_MIN}`);

  // The figures from the readout this rule was asked for: 3,000 and 4,285.
  ok('b. 3,000 ambient against 4,285 task is low', ambientIsLow({ ambient: 3000, task: 4285 }));
  ok('   ...and it is 41% of the total, not of anything else',
    at(ambientShare({ ambient: 3000, task: 4285 }), 3000 / 7285));

  /* EXACTLY ON THE LINE IS NOT LOW, which is the one boundary worth pinning:
     the rule is "less than", so a scheme that is exactly the minimum passes. */
  const onTheLine = { ambient: AMBIENT_SHARE_MIN * 1000, task: 1000 - AMBIENT_SHARE_MIN * 1000 };
  ok('c. exactly the minimum is not low', !ambientIsLow(onTheLine));
  ok('   ...and a hair under it is', ambientIsLow({ ...onTheLine, ambient: onTheLine.ambient - 1 }));

  ok('d. all ambient is never low', !ambientIsLow({ ambient: 500, task: 0 }));
  ok('   ...and no ambient always is', ambientIsLow({ ambient: 0, task: 500 }));

  /* AN EMPTY ROOM IS NOT A BALANCE THAT IS WRONG. `null` is what stops the badge
     being drawn at all — nought over nought is a room with no fittings in it,
     and OK would be the wrong one of the two to guess. */
  ok('e. a room with no light in it is not judged',
    ambientShare({ ambient: 0, task: 0 }) === null);
  ok('   ...and neither is one with no contributions at all',
    ambientShare(undefined) === null && ambientShare({}) === null);

  /* JUDGED ON THE ROUNDED FIGURES, both of them, so the badge can never
     contradict the digits printed beside it. */
  ok('f. it rounds before it divides, like the digits the panel prints',
    at(ambientShare({ ambient: 699.6, task: 300.4 }), 700 / 1000));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
