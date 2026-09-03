// ---------------------------------------------------------------------------
// test-profile.mjs — the WhatsApp number and the occupation.
//
// TWO SMALL FUNCTIONS AND ONE OF THEM DECIDES WHAT GOES IN A COLUMN FOREVER.
// `normalisePhone` runs at the single point of entry, so whatever it lets
// through is what somebody will be trying to send a message to in six months —
// and whatever it wrongly refuses is a lead that never got captured because a
// form said no to a perfectly good number. Both directions are worth pinning
// down, which is what most of this file is.
//
// THE THIRD FUNCTION, `profileComplete`, HAS A THREE-VALUED ANSWER and the third
// value is the whole reason it is tested: `null` means "the row has not loaded
// yet", and the export gate must not read that as "incomplete" or it puts the
// dialog in front of somebody who answered it months ago.
//
//   node tools/test-profile.mjs
// ---------------------------------------------------------------------------

const { OCCUPATIONS, OCCUPATION_BY_ID, occupationLabel, occupationOf,
        normalisePhone, profileComplete } = await import('../src/lib/profile.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const section = (t) => console.log(`\n${t}`);

// --- the occupations -------------------------------------------------------

section('the occupations');
{
  ok(OCCUPATIONS.length === 5, 'five options');
  ok(new Set(OCCUPATIONS.map((o) => o.id)).size === 5, 'the slugs are unique');

  // THE SLUGS ARE THE CONTRACT. They are what the column holds and what the
  // CHECK constraint in migration 0008 lists, so a rename here is a migration —
  // this assertion is what makes that impossible to do by accident.
  ok(OCCUPATIONS.map((o) => o.id).join(',')
      === 'architect_designer,engineer,sales,home_owner,other',
    'and they are exactly the five the migration allows');

  ok(OCCUPATIONS.every((o) => o.label && o.label !== o.id), 'every one has a label');
  ok(occupationLabel('architect_designer') === 'Architect / Designer', 'a slug reads back');
  ok(occupationLabel('nonsense') === null, 'an unknown slug has no label');
  ok(occupationLabel(null) === null, 'and neither does nothing');

  // THE ONLY WAY A FORM VALUE BECOMES A COLUMN, which is why it is strict.
  ok(occupationOf('engineer') === 'engineer', 'a known slug passes through');
  ok(occupationOf('Engineer') === null, 'a label-cased one does not');
  ok(occupationOf('architect') === null, 'nor does half of one');
  ok(occupationOf(undefined) === null, 'nor does nothing');
  ok(OCCUPATION_BY_ID.other.label === 'Other', 'the lookup is built from the list');
}

// --- the number ------------------------------------------------------------

section('a typed number to E.164');
{
  // WHAT IS ACCEPTED IS WIDER THAN WHAT IS STORED. People type punctuation; it
  // is not information and it is stripped rather than refused.
  ok(normalisePhone('+919876543210') === '+919876543210', 'a clean number is unchanged');
  ok(normalisePhone('+91 98765 43210') === '+919876543210', 'spaces go');
  ok(normalisePhone('+91-98765-43210') === '+919876543210', 'hyphens go');
  ok(normalisePhone('+91 (98765) 43210') === '+919876543210', 'brackets go');
  ok(normalisePhone('  +91 98765 43210  ') === '+919876543210', 'so does the padding');

  // `00` IS HOW MOST OF THE WORLD DIALS INTERNATIONALLY. Refusing it would be
  // refusing a number that is completely correct.
  ok(normalisePhone('00919876543210') === '+919876543210', '00 is the same as +');
  ok(normalisePhone('0044 20 7946 0958') === '+442079460958', 'and it works anywhere');

  // THE COUNTRY IS THE ONE THING THAT CANNOT BE GUESSED. Assuming one is how a
  // lead ends up unreachable in a column that looks perfectly well formed.
  ok(normalisePhone('9876543210') === null, 'a bare national number is refused');
  ok(normalisePhone('098765 43210') === null, 'and so is a national trunk zero');

  // THE ITU'S OWN BOUNDS. 15 digits including the country code, and nothing real
  // is shorter than about 8.
  ok(normalisePhone('+1234567') === null, 'too short is refused');
  ok(normalisePhone('+1234567890123456') === null, 'and so is too long');
  ok(normalisePhone('+12345678') === '+12345678', 'eight digits is the floor and is allowed');
  ok(normalisePhone('+123456789012345') === '+123456789012345', 'fifteen is the ceiling');

  ok(normalisePhone('') === null, 'empty is nothing');
  ok(normalisePhone('   ') === null, 'and so is whitespace');
  ok(normalisePhone(null) === null, 'and so is null');
  ok(normalisePhone('+ph one') === null, 'letters are not a number');

  // THE OUTPUT SHAPE IS THE POINT OF ALL OF THIS: one leading +, digits, nothing
  // else, so a `tel:` href and a messaging API can both take it verbatim.
  const shaped = ['+91 98765 43210', '00919876543210', '+91-98765-43210']
    .map(normalisePhone);
  ok(shaped.every((v) => /^\+\d{8,15}$/.test(v)), 'everything stored matches E.164');
  ok(new Set(shaped).size === 1, 'and three spellings of one number are one string');
}

// --- is there enough on the row -------------------------------------------

section('whether to ask');
{
  const full = { phone: '+919876543210', occupation: 'engineer' };
  ok(profileComplete(full) === true, 'both answered is complete');

  ok(profileComplete({ ...full, phone: null }) === false, 'no number is incomplete');
  ok(profileComplete({ ...full, occupation: null }) === false, 'no occupation is incomplete');
  ok(profileComplete({}) === false, 'an empty row is incomplete');

  // A ROW CARRYING RUBBISH IS NOT ANSWERED. Somebody who got a national number
  // into the column before this validation existed should be asked again, not
  // treated as done — the number cannot be messaged.
  ok(profileComplete({ phone: '9876543210', occupation: 'engineer' }) === false,
    'an unreachable number does not count as answered');
  ok(profileComplete({ phone: '+919876543210', occupation: 'Architect' }) === false,
    'and neither does an occupation that is not one of ours');

  // THE THIRD VALUE, AND THE REASON THIS FUNCTION IS NOT A BOOLEAN. The profile
  // row arrives a tick after the session, so `null` is a state every page load
  // passes through. The gate checks `!== false` precisely so this case lets the
  // export through — asking a returning user the same two questions because
  // their row had not loaded yet is far worse than an occasional ungated export.
  ok(profileComplete(null) === null, 'a row that has not loaded is "do not know"');
  ok(profileComplete(undefined) === null, 'and so is one that is missing entirely');
  ok(profileComplete(null) !== false, '...which is what stops the gate firing on it');
}

console.log(fail ? `\n${fail} failed` : '\nprofile: all good');
process.exit(fail ? 1 : 0);
