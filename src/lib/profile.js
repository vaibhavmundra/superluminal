// ---------------------------------------------------------------------------
// WHO THE PERSON IS, beyond a phone number.
//
// THE TWO IDENTIFIERS TRADED PLACES, and everything in this file follows from
// that. Signing in is a phone number and a six-digit SMS code, so the NUMBER is
// now the account and arrives with the session; the EMAIL is the thing nobody
// has yet, and it is the one this file exists to collect.
//
// WHY AN EMAIL IS STILL ASKED FOR AT ALL, when the account no longer needs one:
// two things in this app can only be done with an address, and both of them
// matter more than the login did. A Razorpay receipt goes to an email (see
// api/razorpay-webhook.js), and a project shared with somebody is keyed on one
// (see migration 0006) — an invite is written against an address before the
// invitee has an account, which is the only reason invites work at all.
//
// TWO FIELDS, AND THEY ARE ASKED AT A DELIBERATE MOMENT — not at sign-up.
//
// The sign-in flow is one number and a six-digit code, and every extra field on
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
// THE PHONE HELPERS STAYED, AND THEY MOVED UP THE FUNNEL. They were written for
// the export dialog and are now what the LOGIN screen builds its E.164 number
// with — which makes them load-bearing in a way they were not before: a number
// this file mangles is now an account nobody can sign in to, rather than a lead
// nobody can message. They are unchanged, and the tests on them are the reason
// that is safe.
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
 * AN ADDRESS FROM OUTSIDE, OR NULL — the same contract as `occupationOf` above,
 * and named to match it: the only way a typed value becomes a column.
 *
 * NOT TO BE CONFUSED WITH `normaliseEmail` IN plans.js, which is a different
 * function with a deliberately different job, and the two are worth keeping
 * apart. That one only fixes the SPELLING — trim and lowercase, never rejects —
 * because it runs on the payment path, where refusing an address Razorpay has
 * already taken money against would be worse than storing an odd one. This one
 * is a GATE: it runs on a form, where the whole point is to catch the typo
 * while the person who made it is still looking at the screen.
 *
 * LOWERCASED, AND THAT IS THE LOAD-BEARING HALF. The local part of an address is
 * technically case-sensitive and in practice never is, but the SHARING tables do
 * not care what is technically true — `share_role()` compares
 * `lower(s.email)` against this column, and migration 0006's trigger lowercases
 * the invite on the way in. An address stored with a capital letter would be a
 * grant that silently never matches, which is the worst shape a permissions bug
 * can take: the owner sees the invite listed and the invitee sees nothing.
 *
 * THE SHAPE TEST IS THE SAME REGEX AS `looksLikeEmail` IN sharing.js,
 * deliberately and character for character. That one guards the invite box and
 * this one guards the export gate, and an address that one accepts and the other
 * refuses would be a share nobody can be invited to — with the two refusals
 * appearing on different screens a week apart, which is how a two-line
 * disagreement costs an afternoon.
 *
 * IT IS A SHAPE CHECK AND NOT A VALIDATION, and it cannot be anything more.
 * Nothing here can know whether an address receives mail; a confirmation round
 * trip is the only thing that could, and putting one in front of a download
 * would be a second login on the screen this app spent its whole design avoiding
 * one on.
 *
 * THE LENGTH CAP MATCHES THE COLUMN'S CONSUMERS. api/billing.js slices an
 * address to 200 characters before it reaches Razorpay; refusing it here rather
 * than truncating it there means the stored value and the sent value are the
 * same string.
 */
export function emailOf(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s.length > 200) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

/**
 * A TYPED NUMBER TO E.164, or null if it cannot be one.
 *
 * WHAT IS ACCEPTED IS DELIBERATELY WIDER THAN WHAT IS STORED. People type
 * spaces, brackets, hyphens and a leading 00; all of that is punctuation and
 * none of it is information, so it is stripped rather than rejected. What
 * cannot be guessed is the COUNTRY, so a number with no country code is refused
 * — quietly assuming one is how a lead ends up unreachable in a column that
 * looks perfectly well formed, and is now how somebody ends up unable to sign in.
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

/**
 * A COUNTRY CODE AND A NATIONAL NUMBER TO E.164, or null.
 *
 * This is what the login screen's two controls produce — a dial code chosen from
 * a list and digits typed into a box — and keeping it separate from
 * `normalisePhone` is deliberate: that one parses a WHOLE number somebody wrote
 * out, this one assembles a number from parts that are each already known.
 *
 * THE LEADING TRUNK ZERO IS DROPPED, and this is the one piece of real telephony
 * knowledge in the file. People write their number the way they would dial it at
 * home — `020 7946 0958` in the UK, `098765 43210` in India — and that leading
 * zero is a NATIONAL prefix that does not exist in the international form. Left
 * in, it produces `+4402079460958`: fifteen digits, passes every length check,
 * and unreachable. Twilio will refuse to text it, which is at least a visible
 * failure now that this number is the login.
 *
 * EXCEPT IN ITALY, WHERE THE ZERO IS PART OF THE NUMBER. +39 06 is Rome and
 * always has been — Italy kept its trunk digit when it went to fixed-format
 * numbers in 1998, and stripping it there breaks every landline in the country.
 * It is the one well-known exception and it is worth the special case; getting
 * it wrong in the other direction (never stripping) breaks a great many more
 * numbers than it saves.
 *
 * ONE ZERO, NOT ALL OF THEM. `^0+` would eat the front of a national number that
 * legitimately begins 00, and the international `00` prefix is not this
 * function's problem — it is handled where a pasted number is split.
 */
export function toE164(dial, local) {
  const d = String(dial ?? '').replace(/\D/g, '');
  let n = String(local ?? '').replace(/\D/g, '');
  if (d !== '39' && n.startsWith('0')) n = n.slice(1);
  if (!d || !n) return null;
  return normalisePhone(`+${d}${n}`);
}

/** What to show in the field for a number already on the row. */
export const displayPhone = (p) => String(p ?? '');

/**
 * IS THERE ENOUGH ON THIS ROW TO STOP ASKING — and `null` means "we cannot yet
 * tell", which is NOT the same as "no".
 *
 * THE PAIR IS NOW EMAIL AND OCCUPATION, where it used to be phone and
 * occupation. The number is no longer worth asking for: it is the account, it
 * arrives verified on the session, and migration 0011 mirrors it onto this row
 * at sign-up — asking somebody to type the number they just typed a code from
 * would read as a form that was not paying attention.
 *
 * The profile is fetched a tick after the session (see AuthProvider), so there
 * is a window on every page load where it is null. Reading that as incomplete
 * would put the dialog in front of somebody who answered it months ago, every
 * time they reloaded and clicked Export quickly. The gate treats null as
 * complete for exactly that reason — see useContactGate.
 */
export function profileComplete(profile) {
  if (!profile) return null;
  return !!(emailOf(profile.email) && occupationOf(profile.occupation));
}
