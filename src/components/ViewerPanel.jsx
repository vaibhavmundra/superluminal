import React from 'react';

// ---------------------------------------------------------------------------
// THE PANEL IN READ-ONLY MODE — what this drawing IS, rather than what to do to
// it.
//
// The editing panel is fourteen sections of controls: arm a fan, re-run the
// accents, re-pick a chunking, drag a strip. Not one of them means anything on
// somebody else's plan, and leaving them on screen disabled would be worse than
// removing them — a column of greyed-out buttons reads as a broken app, not as a
// deliberate boundary.
//
// SO THE PANEL BECOMES A READING. Same column, same measure, same type; it lists
// the spaces with their counts, the totals, and the layer switches — and then
// the exports, which are the one thing you genuinely came here to be able to do.
//
// THE LAYER SWITCHES STAY, AND THAT IS NOT AN INCONSISTENCY. They change what is
// DRAWN, not what is stored: `layers` is local component state that never
// reaches the database, and being able to turn the ambient grid off to look at
// the accents underneath is most of the value of looking at somebody's plan at
// all. A read-only screen forbids writes, not curiosity.
//
// CLICKING A SPACE FOCUSES IT ON THE CANVAS, which is the same gesture the
// editor has, minus the consequences.
// ---------------------------------------------------------------------------

const LAYER_ROWS = [
  ['plan', 'The drawing'],
  ['region', 'Space outlines'],
  ['cells', 'Ambient grid'],
  ['lights', 'Fittings'],
  ['labels', 'Labels'],
  ['accents', 'Accent lighting'],
  ['spots', 'Task lights'],
  ['objects', 'Ceiling objects'],
  ['zones', 'No-light zones'],
  ['dim', 'Dimensions'],
];

export default function ViewerPanel({
  rooms = [], totals, boq, layers, onToggleLayer,
  focusId = null, onFocus, surfaceCount = 0, accentCount = 0, spotCount = 0,
  isVector = false, onExport, onOpenBOQ,
}) {
  const laid = rooms.filter((r) => r.plan?.ok);

  return (
    <>
      <div className="sec">
        <h3>This plan</h3>
        {totals.rooms === 0 ? (
          <p className="note">
            No space on this drawing has a lighting layout yet — the user has
            uploaded it and stopped somewhere before the design.
          </p>
        ) : (
          <div className="viewer-tiles">
            <div className="viewer-tile"><b>{totals.rooms}</b><span>spaces lit</span></div>
            <div className="viewer-tile"><b>{totals.lights}</b><span>fittings</span></div>
            <div className="viewer-tile"><b>{Math.round(totals.areaSqft)}</b><span>sqft</span></div>
          </div>
        )}
        {totals.failed > 0 && (
          <p className="note warn" style={{ marginTop: 10 }}>
            {totals.failed} space{totals.failed > 1 ? 's' : ''} produced no layout.
          </p>
        )}
      </div>

      {!!laid.length && (
        <div className="sec">
          <h3>Spaces</h3>
          <div className="viewer-rooms">
            {laid.map((r) => (
              <button key={r.id}
                className={'viewer-room' + (focusId === r.id ? ' on' : '')}
                onClick={() => onFocus?.(focusId === r.id ? null : r.id)}>
                <span className="viewer-room-name">{r.outline?.name || 'Space'}</span>
                <span className="viewer-room-n">
                  {r.plan.lights.length} fitting{r.plan.lights.length === 1 ? '' : 's'}
                  {' · '}{Math.round(r.plan.stats.areaSqft)} sqft
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(surfaceCount > 0 || accentCount > 0 || spotCount > 0) && (
        <div className="sec">
          <h3>What the models found</h3>
          {/* THE THREE MODEL-PROPOSED LAYERS, counted. This is the closest thing
              on this screen to the question the console exists to answer — not
              "did they get a layout" but "did the accent pass and the task pass
              actually contribute anything on a real drawing". */}
          <div className="kv"><span>Accent fittings</span><b>{accentCount}</b></div>
          <div className="kv"><span>Task surfaces</span><b>{surfaceCount}</b></div>
          <div className="kv"><span>Task lights</span><b>{spotCount}</b></div>
        </div>
      )}

      <div className="sec">
        <h3>Layers</h3>
        <div className="viewer-layers">
          {LAYER_ROWS.map(([k, label]) => (
            <label className="check" key={k}>
              <input type="checkbox" checked={!!layers[k]} onChange={onToggleLayer(k)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="sec">
        <h3>Take it away</h3>
        <p className="note" style={{ marginTop: 2, marginBottom: 10 }}>
          The exports are the same files the user gets. Nothing here writes to
          their plan.
        </p>
        <button className="btn" style={{ width: '100%', marginBottom: 8 }}
          disabled={!boq || (!boq.lines?.length && !boq.rooms?.length)}
          onClick={onOpenBOQ}>
          Open the schedule
        </button>
        {/* ONE DXF, NOT TWO. The "Export for CAD" button that used to sit here
            produced a different drawing to the DXF button below it, and the
            operator on this screen has no way of knowing which one the designer
            meant. See the Export section in App.jsx. */}
        <div className="btnrow">
          <button className="btn" disabled={!totals.rooms} onClick={() => onExport('dxf')}>DXF</button>
          <button className="btn" onClick={() => onExport('svg')}>SVG</button>
          <button className="btn" onClick={() => onExport('png')}>PNG</button>
        </div>
        <p className="note" style={{ marginTop: 8 }}>
          The DXF is the drawing on screen, on <code>superluminal_</code> layers
          split by trade —{' '}
          {isVector
            ? 'in the original drawing\u2019s own units and origin.'
            : 'in feet, since this plan came from an image.'}
        </p>
      </div>
    </>
  );
}
