// ---------------------------------------------------------------------------
// COUNTRY DIALLING CODES.
//
// WHY THIS FILE EXISTS AT ALL, when the phone field was one text input a moment
// ago: the input was pre-filled with `+91 `, and that was a trap rather than a
// convenience. Somebody in London opens the dialog, sees a country code already
// there, types their number after it, and stores `+912079460958` — the wrong
// country, a plausible length, and no validation anywhere that can tell. The
// number is silently unreachable and nobody finds out until a message bounces.
//
// A PRE-FILLED PREFIX READS AS PART OF YOUR NUMBER. A SELECT READS AS A CHOICE.
// That is the whole argument for the change: the two are equally quick for the
// majority who are in India, and only one of them is obviously wrong-looking to
// everybody else.
//
// THE LIST IS DATA AND IS DELIBERATELY COMPLETE. A curated dozen with an "other"
// escape hatch is the version that works until the first customer in a country
// nobody thought of, and "other" cannot carry a dial code.
//
// NO FLAG CHARACTERS ARE STORED. A flag emoji is two regional-indicator code
// points derived from the ISO letters, so `flagOf` computes them and this table
// stays a table of facts. Some platforms render them as letter pairs rather than
// flags, which is a perfectly good fallback and part of why the country's NAME
// is always shown beside it.
//
// DIAL CODES ARE NOT UNIQUE. +1 is the whole North American Numbering Plan, +7
// is Russia and Kazakhstan, +44 is the UK plus three Crown Dependencies, +262 is
// Réunion and Mayotte. The STORED value is identical whichever of them is shown,
// so this is cosmetic — and cosmetic here still matters, because a British user
// pasting a London number and seeing the select land on GUERNSEY concludes the
// form is broken and starts fighting it. `PRIMARY` below is the tiebreak, and it
// exists for that reaction rather than for correctness.
// ---------------------------------------------------------------------------

/** [ISO 3166-1 alpha-2, name, dialling code without the +]. */
export const DIAL_CODES = [
  ['AF', 'Afghanistan', '93'], ['AL', 'Albania', '355'], ['DZ', 'Algeria', '213'],
  ['AD', 'Andorra', '376'], ['AO', 'Angola', '244'], ['AG', 'Antigua & Barbuda', '1'],
  ['AR', 'Argentina', '54'], ['AM', 'Armenia', '374'], ['AW', 'Aruba', '297'],
  ['AU', 'Australia', '61'], ['AT', 'Austria', '43'], ['AZ', 'Azerbaijan', '994'],
  ['BS', 'Bahamas', '1'], ['BH', 'Bahrain', '973'], ['BD', 'Bangladesh', '880'],
  ['BB', 'Barbados', '1'], ['BY', 'Belarus', '375'], ['BE', 'Belgium', '32'],
  ['BZ', 'Belize', '501'], ['BJ', 'Benin', '229'], ['BM', 'Bermuda', '1'],
  ['BT', 'Bhutan', '975'], ['BO', 'Bolivia', '591'], ['BA', 'Bosnia & Herzegovina', '387'],
  ['BW', 'Botswana', '267'], ['BR', 'Brazil', '55'], ['BN', 'Brunei', '673'],
  ['BG', 'Bulgaria', '359'], ['BF', 'Burkina Faso', '226'], ['BI', 'Burundi', '257'],
  ['KH', 'Cambodia', '855'], ['CM', 'Cameroon', '237'], ['CA', 'Canada', '1'],
  ['CV', 'Cape Verde', '238'], ['KY', 'Cayman Islands', '1'],
  ['CF', 'Central African Republic', '236'], ['TD', 'Chad', '235'], ['CL', 'Chile', '56'],
  ['CN', 'China', '86'], ['CO', 'Colombia', '57'], ['KM', 'Comoros', '269'],
  ['CG', 'Congo', '242'], ['CD', 'Congo (DRC)', '243'], ['CR', 'Costa Rica', '506'],
  ['CI', 'Côte d’Ivoire', '225'], ['HR', 'Croatia', '385'], ['CU', 'Cuba', '53'],
  ['CY', 'Cyprus', '357'], ['CZ', 'Czechia', '420'], ['DK', 'Denmark', '45'],
  ['DJ', 'Djibouti', '253'], ['DM', 'Dominica', '1'], ['DO', 'Dominican Republic', '1'],
  ['EC', 'Ecuador', '593'], ['EG', 'Egypt', '20'], ['SV', 'El Salvador', '503'],
  ['GQ', 'Equatorial Guinea', '240'], ['ER', 'Eritrea', '291'], ['EE', 'Estonia', '372'],
  ['SZ', 'Eswatini', '268'], ['ET', 'Ethiopia', '251'], ['FJ', 'Fiji', '679'],
  ['FI', 'Finland', '358'], ['FR', 'France', '33'], ['GF', 'French Guiana', '594'],
  ['PF', 'French Polynesia', '689'], ['GA', 'Gabon', '241'], ['GM', 'Gambia', '220'],
  ['GE', 'Georgia', '995'], ['DE', 'Germany', '49'], ['GH', 'Ghana', '233'],
  ['GI', 'Gibraltar', '350'], ['GR', 'Greece', '30'], ['GL', 'Greenland', '299'],
  ['GD', 'Grenada', '1'], ['GP', 'Guadeloupe', '590'], ['GU', 'Guam', '1'],
  ['GT', 'Guatemala', '502'], ['GG', 'Guernsey', '44'], ['GN', 'Guinea', '224'],
  ['GW', 'Guinea-Bissau', '245'], ['GY', 'Guyana', '592'], ['HT', 'Haiti', '509'],
  ['HN', 'Honduras', '504'], ['HK', 'Hong Kong', '852'], ['HU', 'Hungary', '36'],
  ['IS', 'Iceland', '354'], ['IN', 'India', '91'], ['ID', 'Indonesia', '62'],
  ['IR', 'Iran', '98'], ['IQ', 'Iraq', '964'], ['IE', 'Ireland', '353'],
  ['IM', 'Isle of Man', '44'], ['IL', 'Israel', '972'], ['IT', 'Italy', '39'],
  ['JM', 'Jamaica', '1'], ['JP', 'Japan', '81'], ['JE', 'Jersey', '44'],
  ['JO', 'Jordan', '962'], ['KZ', 'Kazakhstan', '7'], ['KE', 'Kenya', '254'],
  ['KI', 'Kiribati', '686'], ['KW', 'Kuwait', '965'], ['KG', 'Kyrgyzstan', '996'],
  ['LA', 'Laos', '856'], ['LV', 'Latvia', '371'], ['LB', 'Lebanon', '961'],
  ['LS', 'Lesotho', '266'], ['LR', 'Liberia', '231'], ['LY', 'Libya', '218'],
  ['LI', 'Liechtenstein', '423'], ['LT', 'Lithuania', '370'], ['LU', 'Luxembourg', '352'],
  ['MO', 'Macao', '853'], ['MG', 'Madagascar', '261'], ['MW', 'Malawi', '265'],
  ['MY', 'Malaysia', '60'], ['MV', 'Maldives', '960'], ['ML', 'Mali', '223'],
  ['MT', 'Malta', '356'], ['MH', 'Marshall Islands', '692'], ['MQ', 'Martinique', '596'],
  ['MR', 'Mauritania', '222'], ['MU', 'Mauritius', '230'], ['YT', 'Mayotte', '262'],
  ['MX', 'Mexico', '52'], ['FM', 'Micronesia', '691'], ['MD', 'Moldova', '373'],
  ['MC', 'Monaco', '377'], ['MN', 'Mongolia', '976'], ['ME', 'Montenegro', '382'],
  ['MA', 'Morocco', '212'], ['MZ', 'Mozambique', '258'], ['MM', 'Myanmar', '95'],
  ['NA', 'Namibia', '264'], ['NR', 'Nauru', '674'], ['NP', 'Nepal', '977'],
  ['NL', 'Netherlands', '31'], ['NC', 'New Caledonia', '687'], ['NZ', 'New Zealand', '64'],
  ['NI', 'Nicaragua', '505'], ['NE', 'Niger', '227'], ['NG', 'Nigeria', '234'],
  ['KP', 'North Korea', '850'], ['MK', 'North Macedonia', '389'], ['NO', 'Norway', '47'],
  ['OM', 'Oman', '968'], ['PK', 'Pakistan', '92'], ['PW', 'Palau', '680'],
  ['PS', 'Palestine', '970'], ['PA', 'Panama', '507'], ['PG', 'Papua New Guinea', '675'],
  ['PY', 'Paraguay', '595'], ['PE', 'Peru', '51'], ['PH', 'Philippines', '63'],
  ['PL', 'Poland', '48'], ['PT', 'Portugal', '351'], ['PR', 'Puerto Rico', '1'],
  ['QA', 'Qatar', '974'], ['RE', 'Réunion', '262'], ['RO', 'Romania', '40'],
  ['RU', 'Russia', '7'], ['RW', 'Rwanda', '250'], ['WS', 'Samoa', '685'],
  ['SM', 'San Marino', '378'], ['SA', 'Saudi Arabia', '966'], ['SN', 'Senegal', '221'],
  ['RS', 'Serbia', '381'], ['SC', 'Seychelles', '248'], ['SL', 'Sierra Leone', '232'],
  ['SG', 'Singapore', '65'], ['SK', 'Slovakia', '421'], ['SI', 'Slovenia', '386'],
  ['SB', 'Solomon Islands', '677'], ['SO', 'Somalia', '252'], ['ZA', 'South Africa', '27'],
  ['KR', 'South Korea', '82'], ['SS', 'South Sudan', '211'], ['ES', 'Spain', '34'],
  ['LK', 'Sri Lanka', '94'], ['KN', 'St Kitts & Nevis', '1'], ['LC', 'St Lucia', '1'],
  ['VC', 'St Vincent', '1'], ['SD', 'Sudan', '249'], ['SR', 'Suriname', '597'],
  ['SE', 'Sweden', '46'], ['CH', 'Switzerland', '41'], ['SY', 'Syria', '963'],
  ['TW', 'Taiwan', '886'], ['TJ', 'Tajikistan', '992'], ['TZ', 'Tanzania', '255'],
  ['TH', 'Thailand', '66'], ['TL', 'Timor-Leste', '670'], ['TG', 'Togo', '228'],
  ['TO', 'Tonga', '676'], ['TT', 'Trinidad & Tobago', '1'], ['TN', 'Tunisia', '216'],
  ['TR', 'Türkiye', '90'], ['TM', 'Turkmenistan', '993'], ['TC', 'Turks & Caicos', '1'],
  ['UG', 'Uganda', '256'], ['UA', 'Ukraine', '380'],
  ['AE', 'United Arab Emirates', '971'], ['GB', 'United Kingdom', '44'],
  ['US', 'United States', '1'], ['UY', 'Uruguay', '598'], ['UZ', 'Uzbekistan', '998'],
  ['VU', 'Vanuatu', '678'], ['VA', 'Vatican City', '39'], ['VE', 'Venezuela', '58'],
  ['VN', 'Vietnam', '84'], ['VG', 'British Virgin Islands', '1'],
  ['VI', 'US Virgin Islands', '1'], ['YE', 'Yemen', '967'], ['ZM', 'Zambia', '260'],
  ['ZW', 'Zimbabwe', '263'],
].map(([iso, name, dial]) => ({ iso, name, dial }));

/**
 * THE DEFAULT SELECTION, and it is a default rather than an assumption — which
 * is exactly the distinction the old `+91 ` prefix failed to make. Most drawings
 * come from India, so the select opens there and the common case is one field to
 * fill; every other country is one keystroke away in a control that visibly IS a
 * control.
 */
export const DEFAULT_ISO = 'IN';

/**
 * THE LONGEST DIAL CODE THAT MATCHES, so `+1` does not eat the front of `+1876`
 * and `+2` never matches `+262`. Used when somebody PASTES a full international
 * number into the national-number box, which is the commonest way a wrong
 * country code would otherwise get stored.
 *
 * Built once, as a Set of the codes rather than a map to countries: the split is
 * the only thing that has to be exact, and which of the seventeen `+1` countries
 * to display afterwards is a cosmetic choice made separately.
 */
const CODES = new Set(DIAL_CODES.map((c) => c.dial));
const MAX_DIAL = Math.max(...[...CODES].map((c) => c.length));

/** Digits to { dial, national }, or null if no known country starts them. */
export function splitDial(digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  for (let n = Math.min(MAX_DIAL, d.length); n >= 1; n--) {
    const head = d.slice(0, n);
    if (CODES.has(head)) return { dial: head, national: d.slice(n) };
  }
  return null;
}

/**
 * WHICH COUNTRY TO SHOW FOR A SHARED DIAL CODE.
 *
 * Only the five codes in this list are ambiguous, and picking a winner for each
 * is a judgment about who is most likely to be typing it rather than a fact
 * about telephony. Everything else falls through to the single match.
 *
 * Without it the answer is whichever row happens to come first alphabetically —
 * Guernsey for +44, Antigua for +1 — which is the correct number attached to a
 * country the user has never been to.
 */
const PRIMARY = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 262: 'RE' };

/** The country to display for a dial code — see PRIMARY on ambiguity. */
export const countryForDial = (dial) => {
  const d = String(dial ?? '');
  const preferred = PRIMARY[d];
  if (preferred) {
    const hit = DIAL_CODES.find((c) => c.iso === preferred);
    if (hit) return hit;
  }
  return DIAL_CODES.find((c) => c.dial === d) ?? null;
};

export const countryForIso = (iso) =>
  DIAL_CODES.find((c) => c.iso === String(iso).toUpperCase()) ?? null;

/**
 * TWO REGIONAL INDICATOR SYMBOLS, computed rather than stored. 0x1F1E6 is 🇦 and
 * 'A' is 0x41, so the offset is 0x1F1A5. A platform with no flag font renders
 * the letter pair instead, which is why the name is always shown beside it.
 */
export const flagOf = (iso) => String(iso).toUpperCase().replace(/[A-Z]/g,
  (ch) => String.fromCodePoint(0x1F1A5 + ch.charCodeAt(0)));
