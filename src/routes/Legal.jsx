import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DOCS, ENTITY } from '../lib/legal.js';
import LegalLinks from '../components/LegalLinks.jsx';
import Wordmark from '../components/Wordmark.jsx';

// ---------------------------------------------------------------------------
// ONE SCREEN, THREE DOCUMENTS. The content lives in src/lib/legal.js — see the
// header there for why prose is kept out of JSX — and this file is only the
// shell it is read in.
//
// ONE COMPONENT AND THREE ROUTES, rather than one route with a `:slug` param.
// The parameterised version has to decide what to do about /legal/nonsense, and
// the honest answer is a 404 this app has no page for; three explicit routes in
// main.jsx cannot be asked the question, and each is one line.
//
// A MEASURE, NOT THE FULL WIDTH. Legal text is read in long paragraphs and a
// 1600px line is unreadable at any size — `max-w-[68ch]` is the same reason a
// book has margins. The page scrolls; nothing here is interactive, so there is
// no chrome to keep in view while reading.
// ---------------------------------------------------------------------------
export default function Legal({ doc }) {
  const d = DOCS[doc];

  // COMING FROM THE FOOTER MEANS ARRIVING MID-PAGE. A client-side route change
  // keeps the scroll position, so following "Privacy" from the foot of a long
  // home page opens this one somewhere in the middle of the third section. The
  // document also changes under the same component when somebody moves between
  // two of these, which is the second reason this is keyed on the slug.
  useEffect(() => { window.scrollTo(0, 0); }, [doc]);

  return (
    <div className="min-h-full flex flex-col">
      {/* THE SAME BAR AS EVERY OTHER PUBLIC PAGE — opaque #000 rather than the
          5% white glass, because the wordmark is a plated asset and the page's
          ground carries a graph-paper grid. `bg-[var(--bg)]` and not `bg-bg`:
          the two tokens are a foot apart in styles.css and one of them is
          #FAFAFA. See the note in Home.jsx. */}
      <header className="h-14 flex-none flex items-center gap-3.5 px-[22px] border-b border-border/10 bg-[var(--bg)]">
        <Link to="/" aria-label="Super Luminal home"><Wordmark /></Link>
      </header>

      <main className="flex-1 w-full max-w-[68ch] mx-auto px-[22px] py-12">
        <h1 className="m-0 mb-1.5 text-[26px] tracking-[-0.03em] text-white">{d.title}</h1>
        <p className="m-0 mb-7 text-[11px] tracking-[0.08em] uppercase text-subtle">
          {ENTITY.company}
        </p>

        <p className="m-0 mb-9 text-[13.5px] leading-[1.75] text-text">{d.intro}</p>

        {d.sections.map((s) => (
          <section key={s.h} className="mb-8">
            <h2 className="m-0 mb-2.5 text-[15px] tracking-[-0.01em] text-white">{s.h}</h2>
            {s.p.map((para, i) => (
              <p key={i} className="m-0 mb-2.5 text-[13px] leading-[1.75] text-muted last:mb-0">
                {para}
              </p>
            ))}
          </section>
        ))}
      </main>

      <footer className="flex-none flex flex-wrap gap-y-2 items-center justify-between px-[22px] py-4 border-t border-border/10 text-[11px] text-subtle bg-surface backdrop-blur-[5px]">
        <span>© {new Date().getFullYear()} {ENTITY.company}</span>
        <LegalLinks />
      </footer>
    </div>
  );
}
