import React from 'react';

// ---------------------------------------------------------------------------
// Pager — previous, next, and where you are.
//
// NO NUMBERED PAGE LINKS. A window of numbers around the current page is the
// conventional thing and it is the wrong thing here: nobody on an admin console
// knows or cares that a particular account is on page 7, so the numbers are
// eleven click targets that all mean "somewhere else". What is actually wanted
// is the next page, the previous one, and a sentence saying how far through the
// list you are — and the sentence is the part that stops "next" feeling
// bottomless.
//
// IT RENDERS NOTHING ON A SINGLE PAGE. A pager under a list of six users is
// chrome describing a decision nobody has to make.
//
// `pages` MAY BE NULL, which is not the same as 1. It means the count did not
// come back — PostgREST returns "*" when the exact count was not asked for or
// timed out — and the honest response is to keep Next enabled and stop claiming
// a total, rather than to guess at one and strand somebody on page 3 of 3 with
// more rows behind it.
// ---------------------------------------------------------------------------
export default function Pager({ page, pages, total, perPage, noun = 'row', onPage }) {
  const known = Number.isFinite(pages) && pages != null;
  if (known && pages <= 1) return null;

  const first = (page - 1) * perPage + 1;
  const last = known && total != null ? Math.min(page * perPage, total) : page * perPage;

  const btn = 'font-sans text-xs leading-[1.5] py-[7px] px-3 rounded border border-border bg-surface text-ink cursor-pointer ' +
    'transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border';
  return (
    <nav className="flex items-center justify-center gap-4 mt-6 mb-2" aria-label="Pagination">
      <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Previous
      </button>
      <span className="text-xs text-subtle font-sans min-w-[16ch] text-center">
        {total != null
          ? <>{first}–{last} of {total} {noun}{total === 1 ? '' : 's'}</>
          : <>Page {page}</>}
      </span>
      <button className={btn} disabled={known && page >= pages} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </nav>
  );
}
