// ---------------------------------------------------------------------------
// WHO THE PERSON IS, beyond an email address.
//
// TWO FIELDS, AND THEY ARE ASKED AT A DELIBERATE MOMENT — not at sign-up.
//
// The sign-in flow is one email and a six-digit code, and every extra field on
// it is a reason not to finish it. Somebody who has dropped a drawing and wants
// to see it lit will not fill in an occupation dropdown first; they will close
// the tab. So the questions are asked at the FIRST EXPORT instead, which is the
// one moment in this app where the value has already been delivered — the plan
// is lit, the schedule is counted, and the file is one click away. Asking then
// is a fair exchange rather than a toll booth, and the answer rate is the
// difference between the two.
//
// ASKED ONCE, EVER. Both fields land on `profiles`, the row every screen already
// reads (see src/lib/auth.jsx), so the second export never asks again — and
// neither does the second device, because the answer is on the row rather than
// in localStorage.
//
// THE PHONE IS A WHATSAPP NUMBER and is stored in E.164 — a leading `+`, a
// country code, and digits. Not because anything here dials it, but because a
// column holding "98765 43210", "+91 98765-43210" and "0091 9876543210" for
// three people in the same country is a column nobody can send a message from
// without cleaning it first, and the cleaning is much easier at the one point of
// entry than across ten thousand rows later.
// ---------------------------------------------------------------------------

/**
 * THE OCCUPATIONS, AND THE `id` IS WHAT THE COLUMN HOLDS.
 *
 * Slugs rather than the labels, for the reason every other enum in this repo is
 * a slug: the label is copy and copy gets edited. "Architect / Designer"
 * becoming "Architect or Designer" one afternoon must not split a segment in
 * two, and it would if the label were the stored value.
 *
 * ARCHITECT AND DESIGNER ARE ONE ENTRY on purpose. They are the same buyer for
 * this tool — somebody specifying lighting for a space they are drawing — and
 * splitting them would ask a question whose answer nobody here would act on
 * differently, at the cost of a fifth option on a dialog that has to be
 * answered in about four seconds.
 */
export const OCCUPATIONS = [
  { id: 'architect_designer', label: 'Architect / Designer' },
  { id: 'engineer',           label: 'Engineer' },
  { id: 'sales',              label: 'Sales' },
  { id: 'home_owner',         label: 'Home owner' },
  { id: 'other',              label: 'Other' },
];

export const OCCUPATION_BY_ID = Object.fromEntries(OCCUPATIONS.map((o) => [o.id, o]));

/** A stored value to something printable, or null if it is not one of ours. */
export const occupationLabel = (id) => OCCUPATION_BY_ID[String(id ?? '')]?.label ?? null;

/** A slug from outside, or null. The only way a form value becomes a column. */
export const occupationOf = (id) => (OCCUPATION_BY_ID[String(id ?? '')] ? String(id) : null);

/**
 * A TYPED NUMBER TO E.164, or null if it cannot be one.
 *
 * WHAT IS ACCEPTED IS DELIBERATELY WIDER THAN WHAT IS STORED. People type
 * spaces, brackets, hyphens and a leading 00; all of that is punctuation and
 * none of it is information, so it is stripped rather than rejected. What
 * cannot be guessed is the COUNTRY, so a number with no country code is refused
 * — quietly assuming one is how a lead ends up unreachable in a column that
 * looks perfectly well formed.
 *
 * `00` IS THE SAME THING AS `+`. It is how most of the world dials
 * internationally from a landline and how a good number of people write it
 * down; treating it as a typo would refuse a number that is completely correct.
 *
 * THE BOUNDS ARE THE ITU'S. E.164 allows at most 15 digits including the country
 * code, and the shortest real international number is around 8. Anything outside
 * that is a typo, and catching it here is worth far more than catching it in a
 * support conversation three weeks later.
 */
export function normalisePhone(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // The one meaningful character, then every digit. Order matters: `00` has to
  // be recognised before the zeros are swallowed by the digit sweep.
  const intl = s.startsWith('+') || /^00\d/.test(s);
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  if (!intl) return null;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** What to show in the field for a number already on the row. */
export const displayPhone = (p) => String(p ?? '');

/**
 * IS THERE ENOUGH ON THIS ROW TO STOP ASKING — and `null` means "we cannot yet
 * tell", which is NOT the same as "no".
 *
 * The profile is fetched a tick after the session (see AuthProvider), so there
 * is a window on every page load where it is null. Reading that as incomplete
 * would put the dialog in front of somebody who answered it months ago, every
 * time they reloaded and clicked Export quickly. The gate treats null as
 * complete for exactly that reason — see useContactGate.
 */
export function profileComplete(profile) {
  if (!profile) return null;
  return !!(normalisePhone(profile.phone) && occupationOf(profile.occupation));
}
