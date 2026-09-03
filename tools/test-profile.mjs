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
        normalisePhone, toE164, profileComplete } = await import('../src/lib/profile.js');
const { DIAL_CODES, DEFAULT_ISO, splitDial, countryForDial, countryForIso, flagOf }
  = await import('../src/lib/dialCodes.js');

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

// --- the world, not just India ---------------------------------------------

section('the country list');
{
  ok(DIAL_CODES.length > 200, `${DIAL_CODES.length} countries, which is the point`);
  ok(new Set(DIAL_CODES.map((c) => c.iso)).size === DIAL_CODES.length,
    'every ISO code appears once');
  ok(DIAL_CODES.every((c) => /^\d{1,4}$/.test(c.dial)), 'every dial code is 1-4 digits');
  ok(DIAL_CODES.every((c) => c.name && c.iso.length === 2), 'every row has a name and an ISO');

  ok(countryForIso(DEFAULT_ISO)?.dial === '91', 'the default is India');
  ok(countryForIso('GB')?.dial === '44' && countryForIso('US')?.dial === '1'
     && countryForIso('AE')?.dial === '971' && countryForIso('SG')?.dial === '65',
    'and the ones most likely to turn up next are right');
  ok(countryForIso('gb')?.iso === 'GB', 'the lookup is case-insensitive');
  ok(countryForIso('ZZ') === null, 'an unknown ISO is null, not a guess');

  ok(flagOf('IN') === '🇮🇳' && flagOf('GB') === '🇬🇧', 'flags are derived from the letters');
}

section('splitting a pasted international number');
{
  // THE LONGEST MATCH WINS, which is the whole correctness requirement: `+1`
  // must not eat the front of `+1876`, and `+2` must never match `+262`.
  ok(splitDial('919876543210').dial === '91', 'India');
  ok(splitDial('442079460958').dial === '44', 'the UK');
  ok(splitDial('12125550123').dial === '1', 'a one-digit code');
  ok(splitDial('262692123456').dial === '262', 'and a three-digit one is not read as +2');
  ok(splitDial('971501234567').dial === '971', 'the UAE');

  ok(splitDial('442079460958').national === '2079460958', 'the rest is the national number');
  ok(splitDial('zzz') === null, 'nonsense splits to nothing');
  ok(splitDial('') === null, 'and so does nothing');

  // A SHARED DIAL CODE RESOLVES TO THE COUNTRY MOST PEOPLE TYPING IT MEAN, and
  // this is a real bug that was caught in the browser rather than a hypothetical
  // one: without the tiebreak, pasting a London number selected GUERNSEY —
  // first alphabetically among the four that share +44 — and a British user
  // reading that concludes the form is broken. The stored string was correct
  // throughout, which is exactly why only looking at it would have missed this.
  ok(countryForDial('44')?.iso === 'GB', '+44 is the United Kingdom, not Guernsey');
  ok(countryForDial('1')?.iso === 'US', '+1 is the United States, not Antigua');
  ok(countryForDial('7')?.iso === 'RU', '+7 is Russia, not Kazakhstan');
  ok(countryForDial('39')?.iso === 'IT', '+39 is Italy, not the Vatican');
  ok(countryForDial('262')?.iso === 'RE', '+262 is Réunion, not Mayotte');
  ok(countryForDial('971')?.iso === 'AE', 'an unshared code needs no tiebreak');
  ok(countryForDial('999') === null, 'and an unknown one is null');

  // THE DANGEROUS CASE, PINNED. A bare national number splits perfectly happily
  // — 9876543210 looks exactly like Iran's +98 followed by eight digits — which
  // is why the dialog only ever calls this when the text carries a + or a 00.
  ok(splitDial('9876543210')?.dial === '98',
    'a bare national number splits into SOMETHING, which is why the caller gates it');
}

section('assembling a number from the two controls');
{
  ok(toE164('91', '9876543210') === '+919876543210', 'India');
  ok(toE164('44', '2079460958') === '+442079460958', 'the UK');
  ok(toE164('1', '2125550123') === '+12125550123', 'the US');
  ok(toE164('971', '501234567') === '+971501234567', 'the UAE');
  ok(toE164('65', '81234567') === '+6581234567', 'Singapore');
  ok(toE164('61', '412345678') === '+61412345678', 'Australia');

  ok(toE164('44', '020 7946 0958') === '+442079460958', 'punctuation goes');

  // THE TRUNK ZERO. People write their number the way they dial it at home, and
  // that leading zero does not exist in the international form — left in it
  // produces a fifteen-digit number that passes every length check and reaches
  // nobody.
  ok(toE164('44', '02079460958') === '+442079460958', 'a UK trunk zero is dropped');
  ok(toE164('91', '09876543210') === '+919876543210', 'and an Indian one');
  ok(toE164('49', '030123456') === '+4930123456', 'and a German one');

  // EXCEPT IN ITALY, where the zero is part of the number and always has been.
  ok(toE164('39', '0612345678') === '+390612345678', 'Italy keeps its zero');
  ok(toE164('39', '3331234567') === '+393331234567', 'and its mobiles are unaffected');

  // ONE ZERO, NOT ALL OF THEM.
  ok(toE164('44', '0020794609') === '+44020794609', 'only the first zero goes');

  ok(toE164('91', '') === null, 'no number is nothing');
  ok(toE164('', '9876543210') === null, 'and no country is nothing');
  ok(toE164('91', '12') === null, 'too short is still refused');
  ok(toE164('91', '98765432109876543') === null, 'and so is too long');

  // THE ROUND TRIP. Anything the dialog assembles has to split back into the
  // same two controls, or reopening it would show somebody a different number
  // from the one they saved.
  for (const [d, n] of [['91', '9876543210'], ['44', '2079460958'],
                        ['1', '2125550123'], ['262', '692123456']]) {
    const e164 = toE164(d, n);
    const back = splitDial(e164.slice(1));
    ok(back.dial === d && back.national === n, `${e164} round-trips`);
  }
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
