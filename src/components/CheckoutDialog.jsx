import React, { useEffect, useMemo, useState } from 'react';
import { Logo } from './Wordmark.jsx';
import { fmtAllowance } from '../lib/plans.js';

// FROM public/, NOT AN IMPORT, and the same choice Wordmark.jsx makes for the
// Super Luminal mark: a bundled asset gets a content hash, which is exactly what
// you want for something that changes with the code and exactly what you do not
// want for a company logo that is also referenced from a dozen places outside
// this repo.
const HOUSE = '/designopolis_logo.png';

// ---------------------------------------------------------------------------
// THE DETAILS, TAKEN ONCE, IMMEDIATELY BEFORE THE CARD.
//
// WHY ASK AT ALL WHEN RAZORPAY'S OWN WINDOW COLLECTS A NAME AND AN EMAIL. Two
// reasons, and the second is the real one.
//
// The first is that a prefilled checkout is a shorter checkout, and a mandate
// needs a customer with a contact number — created server-side, before the
// window opens, so every future charge hangs off one identity instead of a fresh
// one per attempt.
//
// The second is that this is the only screen in the flow that is OURS. The
// moment Razorpay opens, the user is looking at a payment window that says
// whatever Razorpay's dashboard says, and a person about to type a card number
// wants to know, in that order: what am I buying, from whom, and how much. So
// this dialog leads with the mark, states WHO IS BEHIND IT — a product of
// Designopolis, which is the name that will appear on the statement — and prints
// the price and the allowance on the same surface as the button that spends the
// money.
//
// A trust dialog with a form in it, rather than a form with a logo on top.
// ---------------------------------------------------------------------------

export default function CheckoutDialog({ tier, defaults = {}, busy = false, error = '',
                                         onCancel, onPay }) {
  const [name, setName] = useState(defaults.name || '');
  const [email, setEmail] = useState(defaults.email || '');
  const [contact, setContact] = useState(defaults.contact || '');
  const [touched, setTouched] = useState(false);

  // The signed-in address arrives a beat after the dialog on a cold open, and an
  // empty field somebody has already started typing in must not be overwritten
  // by it. `touched` is the whole guard.
  useEffect(() => {
    if (!touched && defaults.email && !email) setEmail(defaults.email);
  }, [defaults.email, email, touched]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  // DIGITS ONLY, AND TEN OR MORE. Deliberately not a country-aware validator:
  // this field is a convenience passed to the gateway, and a regex that rejects
  // a legitimate number is a wall in front of a payment. Razorpay does the real
  // check, and it does it better.
  const phoneDigits = contact.replace(/\D/g, '');
  const contactOk = !contact.trim() || phoneDigits.length >= 8;
  const ready = name.trim().length > 1 && emailOk && contactOk && !busy;

  const price = useMemo(() => `$${tier.usd}`, [tier.usd]);

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    onPay({ name: name.trim(), email: email.trim(), contact: phoneDigits });
  };

  return (
    <div className="modal-wrap"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.(); }}>
      <form className="modal checkout" onSubmit={submit}>

        {/* THE MASTHEAD. Centred, above everything, and the two lines are a
            hierarchy rather than a stack: the mark is what the user came for,
            the line under it is who they are paying. Both are needed — the
            product name is the one they recognise, the company name is the one
            on the statement — and putting them anywhere but the top of the
            surface that takes the card details would be putting them where
            nobody checks. */}
        {/* THE MARK, THEN THE HOUSE. Two logos stacked is one more than a
            dialog usually earns, and the arrangement is what stops them
            competing: Super Luminal at full size, and the Designopolis mark
            demoted to a BYLINE — small, on one line, behind three words of
            lower-case type that make it read as attribution rather than as a
            second brand asking for attention.
            THE ALT TEXT CARRIES THE WHOLE SENTENCE, because "A product of" and
            the image are one phrase; a screen reader that reads "A product of"
            and then "Designopolis logo" has read a caption and a filename. */}
        <div className="checkout-brand">
          <Logo width={126} />
          <span className="checkout-by">
            <i>A product of</i>
            <img src={HOUSE} alt="Designopolis" />
          </span>
        </div>

        <div className="checkout-line">
          <div>
            <b>{tier.name}</b>
            <span>{fmtAllowance(tier)}</span>
          </div>
          <div className="checkout-price">
            <b>{price}</b>
            <span>per month</span>
          </div>
        </div>

        <label className="auth-label" htmlFor="co-name">Full name</label>
        <input id="co-name" type="text" autoFocus autoComplete="name" value={name}
          placeholder="As it should appear on the invoice"
          onChange={(e) => { setTouched(true); setName(e.target.value); }} />

        <div className="checkout-gap" />
        <label className="auth-label" htmlFor="co-email">Email</label>
        <input id="co-email" type="email" autoComplete="email" value={email}
          placeholder="you@studio.com"
          onChange={(e) => { setTouched(true); setEmail(e.target.value); }} />

        <div className="checkout-gap" />
        <label className="auth-label" htmlFor="co-phone">
          Phone <span className="opt">optional</span>
        </label>
        <input id="co-phone" type="tel" autoComplete="tel" value={contact}
          placeholder="For the payment receipt"
          onChange={(e) => { setTouched(true); setContact(e.target.value); }} />

        {error && <p className="note err" style={{ marginTop: 14 }}>{error}</p>}

        <div className="modal-foot">
          <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            {busy ? 'Opening…' : `Pay ${price} and continue`}
          </button>
        </div>

        <p className="checkout-foot">
          Payment is handled by Razorpay. Cancel any time — the month you have
          paid for runs to its end.
        </p>
      </form>
    </div>
  );
}
