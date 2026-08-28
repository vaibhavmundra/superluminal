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
    <div className="modal-wrap">
      <div className="modal wide">
        <h2>Which page is the plan?</h2>
        <p className="note" style={{ margin: '0 0 16px' }}>
          <b>{name}</b> has {pages} pages. Pick the floor plan — the others can be
          opened later as their own plans.
        </p>

        <div className="pdf-pages">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button key={n} className="pdf-page" onClick={() => onPick(n)}>
              <span className="pdf-thumb">
                {thumbs[n]
                  ? <img src={thumbs[n]} alt="" />
                  : <span className="pdf-thumb-wait" aria-hidden="true" />}
              </span>
              <span className="pdf-page-no">Page {n}</span>
            </button>
          ))}
        </div>

        <div className="modal-foot">
          <button className="btn secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
