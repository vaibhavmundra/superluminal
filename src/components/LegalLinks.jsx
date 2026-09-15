import React from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_LINKS } from '../lib/legal.js';

// ---------------------------------------------------------------------------
// THE THREE LINKS, WHEREVER A FOOTER NEEDS THEM.
//
// A COMPONENT AND NOT THREE <Link>s TYPED TWICE, because they appear on the home
// page and on the login screen and will appear on the next public page somebody
// adds. Three copies of a list is how a fourth document gets added to two of
// them — and a legal page that exists but is not linked from everywhere it
// should be is the one failure mode this whole feature has.
//
// `<Link>` AND NOT `<a href>`. These are in-app routes; an anchor would reload
// the bundle to move between two static pages, and on the login screen it would
// also throw away a drawing somebody had already dropped (see pendingUpload.js).
// ---------------------------------------------------------------------------
export default function LegalLinks({ className = '' }) {
  return (
    <nav className={'flex items-center gap-3.5 ' + className} aria-label="Legal">
      {LEGAL_LINKS.map(({ to, label }) => (
        <Link key={to} to={to}
          className="text-[11px] text-subtle no-underline transition-colors duration-[120ms] hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 focus-visible:rounded-[3px]">
          {label}
        </Link>
      ))}
    </nav>
  );
}
