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

const SEC = 'border-t border-border pt-3.5 mt-2.5 first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0';
const SEC_H3 = 'm-0 mb-2.5 text-[10px] tracking-[0.11em] uppercase text-subtle';
const NOTE = 'text-[11.5px] text-muted leading-[1.5] mt-2';
const BTN = 'text-xs leading-[1.5] px-3 py-[7px] rounded border border-border bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border';

export default function ViewerPanel({
  rooms = [], totals, boq, layers, onToggleLayer,
  focusId = null, onFocus, surfaceCount = 0, accentCount = 0, spotCount = 0,
  isVector = false, onExport, onOpenBOQ,
}) {
  const laid = rooms.filter((r) => r.plan?.ok);

  return (
    <>
      <div className={SEC}>
        <h3 className={SEC_H3}>This plan</h3>
        {totals.rooms === 0 ? (
          <p className={NOTE}>
            No space on this drawing has a lighting layout yet — the user has
            uploaded it and stopped somewhere before the design.
          </p>
        ) : (
          <div className="flex gap-2 mt-2.5">
            <div className="flex-1 py-[9px] px-2.5 rounded bg-surface-3 border border-border flex flex-col gap-px">
              <b className="text-[16px] leading-[1.1]">{totals.rooms}</b>
              <span className="text-[10.5px] text-subtle">spaces lit</span>
            </div>
            <div className="flex-1 py-[9px] px-2.5 rounded bg-surface-3 border border-border flex flex-col gap-px">
              <b className="text-[16px] leading-[1.1]">{totals.lights}</b>
              <span className="text-[10.5px] text-subtle">fittings</span>
            </div>
            <div className="flex-1 py-[9px] px-2.5 rounded bg-surface-3 border border-border flex flex-col gap-px">
              <b className="text-[16px] leading-[1.1]">{Math.round(totals.areaSqft)}</b>
              <span className="text-[10.5px] text-subtle">sqft</span>
            </div>
          </div>
        )}
        {totals.failed > 0 && (
          <p className="text-[11.5px] leading-[1.5] text-muted border-l-2 border-border-strong pl-[9px] mt-2.5">
            {totals.failed} space{totals.failed > 1 ? 's' : ''} produced no layout.
          </p>
        )}
      </div>

      {!!laid.length && (
        <div className={SEC}>
          <h3 className={SEC_H3}>Spaces</h3>
          <div className="flex flex-col gap-[3px] mt-2">
            {laid.map((r) => (
              <button key={r.id}
                className={'flex flex-col gap-px text-left py-[7px] px-[9px] rounded border cursor-pointer transition-colors duration-[120ms] hover:bg-surface-3 '
                  + (focusId === r.id ? 'bg-surface-3 border-accent' : 'bg-transparent border-transparent')}
                onClick={() => onFocus?.(focusId === r.id ? null : r.id)}>
                <span className="text-[12.5px] text-ink">{r.outline?.name || 'Space'}</span>
                <span className="text-[11px] text-subtle">
                  {r.plan.lights.length} fitting{r.plan.lights.length === 1 ? '' : 's'}
                  {' · '}{Math.round(r.plan.stats.areaSqft)} sqft
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(surfaceCount > 0 || accentCount > 0 || spotCount > 0) && (
        <div className={SEC}>
          <h3 className={SEC_H3}>What the models found</h3>
          {/* THE THREE MODEL-PROPOSED LAYERS, counted. This is the closest thing
              on this screen to the question the console exists to answer — not
              "did they get a layout" but "did the accent pass and the task pass
              actually contribute anything on a real drawing". */}
          <div className="flex justify-between text-[11.5px] py-[3px] text-muted"><span>Accent fittings</span><b className="text-ink tabular-nums">{accentCount}</b></div>
          <div className="flex justify-between text-[11.5px] py-[3px] text-muted"><span>Task surfaces</span><b className="text-ink tabular-nums">{surfaceCount}</b></div>
          <div className="flex justify-between text-[11.5px] py-[3px] text-muted"><span>Task lights</span><b className="text-ink tabular-nums">{spotCount}</b></div>
        </div>
      )}

      <div className={SEC}>
        <h3 className={SEC_H3}>Layers</h3>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-0.5 mt-2">
          {LAYER_ROWS.map(([k, label]) => (
            <label className="flex items-center gap-2 mb-[7px] text-muted cursor-pointer" key={k}>
              {/* `accent-white`, MATCHING THE EDITOR'S `CHECK` in App.jsx. This
                  is the same Layers list a viewer sees, and the same control
                  looking different depending on who opened the plan is the one
                  thing a read-only mirror of a panel must not do. */}
              <input type="checkbox" className="lp-check" checked={!!layers[k]} onChange={onToggleLayer(k)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className={SEC}>
        <h3 className={SEC_H3}>Take it away</h3>
        <p className="text-[11.5px] text-muted leading-[1.5] mt-0.5 mb-2.5">
          The exports are the same files the user gets. Nothing here writes to
          their plan.
        </p>
        <button className={BTN + ' w-full mb-2'}
          disabled={!boq || (!boq.lines?.length && !boq.rooms?.length)}
          onClick={onOpenBOQ}>
          Open the schedule
        </button>
        {/* ONE DXF, NOT TWO. The "Export for CAD" button that used to sit here
            produced a different drawing to the DXF button below it, and the
            operator on this screen has no way of knowing which one the designer
            meant. See the Export section in App.jsx. */}
        <div className="flex gap-[6px] flex-wrap">
          <button className={BTN} disabled={!totals.rooms} onClick={() => onExport('dxf')}>DXF</button>
          <button className={BTN} onClick={() => onExport('svg')}>SVG</button>
          <button className={BTN} onClick={() => onExport('png')}>PNG</button>
        </div>
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">
          The DXF is the drawing on screen, on <code className="font-sans text-[10px] bg-input-bg px-[3px] rounded-[3px] text-ink">superluminal_</code> layers
          split by trade —{' '}
          {isVector
            ? 'in the original drawing’s own units and origin.'
            : 'in feet, since this plan came from an image.'}
        </p>
      </div>
    </>
  );
}
