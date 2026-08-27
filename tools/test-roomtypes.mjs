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
         roomTypeFromReply } from '../src/lib/roomTypes.js';

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

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
