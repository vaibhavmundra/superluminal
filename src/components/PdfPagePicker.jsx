import React from 'react';

// ---------------------------------------------------------------------------
// WHICH PAGE IS THE PLAN?
//
// A single-page PDF is not asked about — it is opened. This exists for the
// common case that made PDF support worth doing properly: a drawing set. Six
// sheets, of which one is the floor plan and the others are elevations, a title
// page, a door schedule and a section. Silently taking page 1 would light the
// title block, and the failure would be baffling rather than obvious — the app
// would find no rooms in a page of text and say so as if the drawing were at
// fault.
//
// THUMBNAILS, NOT A NUMBER FIELD. Nobody knows which page of a set they want by
// index; they know it on sight. The thumbnails are rendered by the same code
// that renders the chosen page, at a twelfth of the size, so what is previewed
// is exactly what will be used — including the white background, which is where
// a transparent-page bug would otherwise hide until much later.
// ---------------------------------------------------------------------------

export default function PdfPagePicker({ name, pages, thumbs, onPick, onCancel }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]">
      <div className="w-[min(620px,94vw)] bg-surface border border-border rounded-[14px] pt-[22px] px-[22px] pb-5 shadow-[0_18px_50px_rgba(20,20,40,.18)]">
        <h2 className="m-0 mb-1.5 text-[17px] tracking-[-0.01em]">Which page is the plan?</h2>
        <p className="text-[11.5px] text-muted leading-normal m-0 mb-4">
          <b>{name}</b> has {pages} pages. Pick the floor plan — the others can be
          opened later as their own plans.
        </p>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(122px,1fr))] gap-2.5 max-h-[min(52vh,440px)] overflow-y-auto p-0.5">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button key={n}
              className="border border-border bg-surface rounded p-[7px] cursor-pointer flex flex-col gap-1.5 transition-colors duration-[120ms] hover:border-accent hover:bg-accent-soft"
              onClick={() => onPick(n)}>
              <span className="aspect-[1/1.35] bg-surface-3 border border-border rounded-[3px] grid place-items-center overflow-hidden">
                {thumbs[n]
                  ? <img src={thumbs[n]} alt="" className="w-full h-full object-contain block bg-white" />
                  : <span className="lp-spin block w-4 h-4 [--lp-spin-w:1.5px]" aria-hidden="true" />}
              </span>
              <span className="text-[10.5px] tracking-[0.06em] uppercase text-subtle text-center">Page {n}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            className="text-[12px] px-3 py-[7px] rounded border border-border-strong bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-ink active:bg-surface-3"
            onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
