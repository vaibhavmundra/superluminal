// ---------------------------------------------------------------------------
// test-roomtypes.mjs — the project question and what each answer entitles a
// room to.
//
// Two things worth testing here and they are not the obvious ones. The
// classifier's accuracy is a model's problem and cannot be asserted offline.
// What CAN be asserted is that the gates are a property of the vocabulary
// rather than a list of ids somewhere else, and that the synonym normaliser
// does not let a near-miss collapse into the wrong room — `office_chamber` and
// `office_workspace` share a word and are opposite answers.
//
//   node tools/test-roomtypes.mjs
// ---------------------------------------------------------------------------

import { PROJECT_TYPES, PROJECT_BY_ID, roomsFor, roomTypeIn, wantsAccents,
         wantsSpots, buildRoomTypePrompt, buildRoomTypeRequest, normaliseRoomType,
         roomTypeFromReply, targetAreaFor, fixtureFor,
         TARGET_AREA_BY_TYPE, FIXTURE_BY_TYPE } from '../src/lib/roomTypes.js';
import { DEFAULTS, resolveOptions, planLights } from '../src/lib/planner.js';
import { FIXTURE_BY_ID } from '../src/lib/boq.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

console.log('-- the five project types --');
ok(PROJECT_TYPES.map((p) => p.id).join(',')
   === 'residential,office,hotel,restaurant,educational',
  PROJECT_TYPES.map((p) => p.label).join(', '));
ok(PROJECT_TYPES.every((p) => p.rooms.length >= 8 && p.rooms.length <= 14),
  'each with a short list — a classifier picking one of nine beats one of thirty');
ok(PROJECT_TYPES.every((p) => p.rooms.every((r) => r.plan && r.label)),
  'and every type says what it looks like in plan');
ok(PROJECT_TYPES.every((p) => p.rooms.some((r) => r.id === 'toilet')
   && p.rooms.some((r) => r.id === 'other')),
  'toilet and other are in every vocabulary');

console.log('\n-- the gates are a property of the TYPE --');
{
  // Exactly the rule as stated: living, bedroom, office chamber, conference and
  // toilet get accents; all but the toilet also get task spots.
  const acc = ['bedroom', 'living_space'];
  for (const id of acc) ok(wantsAccents('residential', id) && wantsSpots('residential', id),
    `residential ${id}: accents and spots`);
  ok(wantsAccents('residential', 'toilet'), 'a toilet gets accents (its basin sconces)');
  ok(!wantsSpots('residential', 'toilet'),
    '...and NO directional spot — there is nothing in a WC to aim at, and one over a basin is glare in a mirror');
  for (const id of ['kitchen', 'balcony', 'corridor', 'store', 'foyer', 'other']) {
    ok(!wantsAccents('residential', id) && !wantsSpots('residential', id), `${id}: neither`);
  }
  ok(wantsAccents('office', 'office_chamber') && wantsSpots('office', 'office_chamber'),
    'office chamber: both');
  ok(wantsAccents('office', 'conference_room') && wantsSpots('office', 'conference_room'),
    'conference room: both');
  ok(!wantsAccents('office', 'office_workspace'),
    'open-plan workspace: neither — it is a ceiling of downlights and nothing else');
  ok(wantsAccents('hotel', 'guest_room') && wantsAccents('hotel', 'suite'),
    'a hotel guest room is a bedroom by another name');
  ok(wantsAccents('restaurant', 'dining_area'), 'and a dining area is a living space by another name');

  // Unknown anything means we know nothing, so we do nothing.
  ok(!wantsAccents('residential', 'nonsense') && !wantsAccents('nope', 'bedroom')
     && !wantsAccents(null, null), 'an unknown project or type is entitled to nothing');
}

console.log('\n-- the vocabulary is per project --');
{
  ok(roomsFor('office').some((r) => r.id === 'conference_room')
     && !roomsFor('residential').some((r) => r.id === 'conference_room'),
    'a flat cannot be classified as a conference room');
  ok(roomsFor('residential').some((r) => r.id === 'pooja_room')
     && !roomsFor('office').some((r) => r.id === 'pooja_room'),
    'and an office cannot be a pooja room');
  ok(roomTypeIn('residential', 'bedroom')?.label === 'Bedroom', 'lookup works');
  ok(roomTypeIn('residential', 'conference_room') === null, 'and returns null across projects');
}

console.log('\n-- synonyms, and the near-misses that must NOT collapse --');
{
  const N = (raw, p = 'residential') => normaliseRoomType(raw, p);
  ok(N('Living Room') === 'living_space' && N('living/dining') === 'living_space'
     && N('FAMILY LOUNGE') === 'living_space', 'living, dining, family and lounge are one type');
  ok(N('W.C.') === 'toilet' || N('wc') === 'toilet', 'a WC is a toilet');
  ok(N('powder room') === 'toilet' && N('ensuite bath') === 'toilet', 'and so are its aliases');
  ok(N('Master Bedroom') === 'bedroom' && N('bed room') === 'bedroom', 'bedroom variants');
  // THE ONE THAT MATTERS: two office types sharing a word, meaning opposite things.
  ok(normaliseRoomType('office_chamber', 'office') === 'office_chamber'
     && normaliseRoomType('office_workspace', 'office') === 'office_workspace',
    'office_chamber and office_workspace stay apart');
  ok(normaliseRoomType('cabin', 'office') === 'office_chamber', 'a cabin is a chamber');
  ok(normaliseRoomType('meeting room', 'office') === 'conference_room', 'a meeting room is a conference room');
  ok(N('spaceship') === null, 'and nonsense is nonsense');
}

console.log('\n-- reading the reply --');
{
  const r = roomTypeFromReply('{"type":"Master Bedroom","confidence":0.88,"why":"a bed and a wardrobe"}',
    { projectId: 'residential' });
  ok(r.type === 'bedroom' && r.matched && r.confidence === 0.88, `normalised and read: ${r.type}`);
  const bad = roomTypeFromReply('{"type":"submarine","confidence":0.9}', { projectId: 'residential' });
  ok(bad.type === 'other' && !bad.matched && bad.confidence === 0,
    'an unreadable answer becomes `other` with no confidence — a decision, not a hole');
  ok(!wantsAccents('residential', bad.type), 'and `other` is entitled to nothing');
  for (const junk of ['', 'not json', '{}', '{"type":null}', 'null']) {
    try {
      const j = roomTypeFromReply(junk, { projectId: 'residential' });
      if (j.type !== 'other') { ok(false, `junk ${JSON.stringify(junk)} -> ${j.type}`); }
    } catch (e) { ok(false, `threw on ${JSON.stringify(junk)}`); }
  }
  ok(true, 'five junk replies all fall back to `other` without throwing');
}

console.log('\n-- the prompt --');
{
  const t = buildRoomTypePrompt({ projectId: 'office',
    room: { name: 'CABIN 2', widthFt: 12, heightFt: 10, areaSqft: 120 } });
  ok(/THIS IS A OFFICE PROJECT/.test(t), 'the project type is stated up front');
  ok(/conference_room/.test(t) && !/pooja_room/.test(t),
    'and only that project vocabulary is offered');
  ok(/"CABIN 2"/.test(t) && /may be a room number/.test(t),
    "the drawing's own label is passed as evidence, and hedged");
  ok(/12\.0 ft by 10\.0 ft/.test(t) && /40 sq ft space is not a bedroom/.test(t),
    'size is given, with why it matters');
  // The regression the "everything came back as Other" run produced. The prompt
  // has to INVITE a commitment, and the image has to be sent at a detail the
  // furniture survives — `low` downsamples to 512px and loses it.
  ok(/COMMIT\./.test(t) && /Reach for "other" only when/.test(t),
    'the prompt asks it to commit, and rations `other`');
  ok(/Wrong is worse than unsure; unsure is much better than nothing/.test(t),
    'with the same restraint rule the rest of the app uses');
  let threw = null;
  try { buildRoomTypePrompt({ projectId: 'nope' }); } catch (e) { threw = e.message; }
  ok(/Unknown project type/.test(threw ?? ''), `an unknown project throws early: "${threw}"`);
}


console.log('\n-- the image goes at a detail the furniture survives --');
{
  const req = buildRoomTypeRequest({ plan: { base64: 'x'.repeat(200), mime: 'image/jpeg' },
    projectId: 'residential', room: { name: 'BED 1' } });
  const img = req.messages[0].content.find((c) => c.type === 'image_url');
  ok(img.image_url.detail === 'high',
    `detail=${img.image_url.detail} — "low" downsamples to 512px, at which a bed is a grey rectangle and every room comes back "other"`);
}

console.log('\n-- how densely a type is lit, and what with --');
{
  ok(targetAreaFor('toilet') === 18, 'a toilet is gridded at 18 sqft a cell');
  ok(targetAreaFor('kitchen') === 25, 'a kitchen at 25');
  ok(targetAreaFor('bedroom') === null, 'and everything else takes the 50 sqft default');

  // THE TOLERANCE IS THE ONE EVERY OTHER CELL GETS. `areaTol` is a single
  // number applied to whatever `targetArea` is, so a toilet's acceptance band
  // is 18 +/- 25% = 13.5 to 22.5. This asserts it was not special-cased.
  const tol = DEFAULTS.areaTol;
  ok(tol === 0.25, `areaTol is still the shared +/-${tol * 100}%`);
  const lo = 18 * (1 - tol), hi = 18 * (1 + tol);
  ok(Math.abs(lo - 13.5) < 1e-9 && Math.abs(hi - 22.5) < 1e-9,
    `so a toilet cell is accepted between ${lo} and ${hi} sqft`);

  // AND IT ACTUALLY LAYS OUT. A target is only useful if real wet-room shapes
  // resolve against it: these are the sizes a toilet is actually drawn at.
  const opt = resolveOptions({ ...DEFAULTS, targetArea: 18 });
  const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  for (const [w, h, n] of [[4, 5, 1], [5, 7, 2], [6, 8, 3], [6, 10, 4], [3.5, 6, 1]]) {
    const r = planLights(rect(w, h), [], opt, []);
    ok(r.ok && r.lights.length === n,
      `${w} x ${h} ft toilet lays out as ${r.ok ? r.lights.length : 'FAILED'} light(s), wanted ${n}`);
  }

  // WHAT IT IS BOUGHT AS. The planner emits `small` for a toilet exactly as for
  // a bedroom — the kind is geometry — and the type maps it onto a product.
  ok(fixtureFor('toilet', 'small') === 'small-narrow',
    "a toilet's small light is the narrow-beam lamp");
  ok(fixtureFor('toilet', 'large') === 'large',
    '...and a large one is unchanged, because nothing said otherwise');
  ok(fixtureFor('bedroom', 'small') === 'small', 'every other room is untouched');
  ok(fixtureFor(undefined, 'small') === 'small',
    'and an unclassified space falls back to the kind rather than throwing');

  const nb = FIXTURE_BY_ID['small-narrow'];
  ok(nb && nb.watts === 5 && nb.beam === 30, '5 W at 30 degrees');
  ok(nb.unit === 'nos' && /grid/.test(nb.note),
    'catalogued as an ambient grid fitting, not as an aimed spot');

  // EVERY ID THIS MAP CAN PRODUCE MUST EXIST IN THE CATALOGUE. A typo here does
  // not throw — `buildBOQ` counts into a key nothing bills, the light vanishes
  // from the schedule, and the plan is short by however many wet rooms it has.
  for (const [type, kinds] of Object.entries(FIXTURE_BY_TYPE)) {
    for (const [kind, id] of Object.entries(kinds)) {
      ok(!!FIXTURE_BY_ID[id],
        `FIXTURE_BY_TYPE.${type}.${kind} points at a real catalogue line: ${id}`);
    }
  }
  // ...and every type it names must be a type the classifier can return.
  const everyType = new Set(PROJECT_TYPES.flatMap((p) => p.rooms.map((r) => r.id)));
  for (const type of Object.keys(FIXTURE_BY_TYPE)) {
    ok(everyType.has(type), `and at a type the classifier can actually return: ${type}`);
  }
  for (const type of Object.keys(TARGET_AREA_BY_TYPE)) {
    ok(everyType.has(type), `same for TARGET_AREA_BY_TYPE: ${type}`);
  }
}


console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
