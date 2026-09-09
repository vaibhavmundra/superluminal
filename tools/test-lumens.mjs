// tools/test-lumens.mjs — the ambient lumen model. Pure arithmetic, no drawing.
import { SURFACE_REFLECTANCE, LUMENS_PER_SQFT, LUMENS_PER_SQFT_DEFAULT,
         LUMENS_PER_WATT_DEFAULT, STRIP_WATTS_PER_M, STRIP_LOSS,
         STRIP_LUMENS_PER_WATT,
         FIXTURE_FAMILIES, FAMILY_BY_ID,
         reflectanceOf, surfaceAreas, lumensPerSqftFor, lumensPerWattFor,
         lumensRequired, bounceOf, unitOutput, wattsFor, analyseSpace }
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

sec('the total is split into the layers a scheme is designed in');
{
  /* AMBIENT, TASK AND ACCENT ARE ONE FITTING EACH, so a figure landing in the
     wrong bucket cannot hide inside another row's contribution. A track spot
     borrows the COB and is the task layer; a floor lamp is accent. */
  const three = analyseSpace({
    polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
    projectId: 'residential', country: 'India',
    groups: [{ key: 'cove', familyId: 'cove', count: 1, lengthFt: 20 },
             { key: 'spot', familyId: 'track_spot', count: 3 },
             { key: 'lamp', familyId: 'lamp', count: 2 }],
  });
  const netOf = (k) => three.rows.find((r) => r.key === k).netLumens;
  ok('the ambient row is the ambient figure', at(three.byLayer.ambient, netOf('cove')));
  ok('...the task row the task figure', at(three.byLayer.task, netOf('spot')));
  ok('...and the accent row the accent figure', at(three.byLayer.accent, netOf('lamp')));
  /* THE ONE PROPERTY THE READOUT DEPENDS ON: it prints the three under the
     total, so three figures that did not add back to it would be a card
     contradicting its own arithmetic. */
  ok('the three add back up to achieved',
    at(three.byLayer.ambient + three.byLayer.task + three.byLayer.accent,
      three.achieved));

  /* ALL THREE KEYS EXIST WHATEVER IS IN THE ROOM, so a caller can print a layer
     without first asking whether the room has one — a missing key would print
     as an empty figure rather than as a zero. */
  const bare = analyseSpace({ polygonFt: ROOM, ceilingMm: 2700, materials: LIGHT,
                              projectId: 'residential', country: 'India' });
  ok('an empty room still answers for all three layers',
    bare.byLayer.ambient === 0 && bare.byLayer.task === 0
      && bare.byLayer.accent === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
