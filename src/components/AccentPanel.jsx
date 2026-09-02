import React from 'react';
import { TYPE_BY_ID, FURNITURE_BY_ID } from '../lib/accentPrompt.js';
import { PLACEMENT_RULES } from '../lib/accentPlace.js';

// ---------------------------------------------------------------------------
// AccentPanel — pick a room, ask, look at what came back.
//
// A DROPDOWN HERE where the Rooms section above is a list, and the difference
// is not inconsistency. That list exists because every room on the plan is lit
// and every one is a thing you might want the numbers for. This is a question
// about ONE room at a time: the image that goes over the wire is one room with
// every other room erased, and the answer that comes back is about that room.
//
// THE FURNITURE IS SHOWN, not just the fittings, and that is the lesson from
// the run where this came back empty and nobody could say why. The model's job
// is recognition and the rules are applied in code, so an empty answer has
// exactly two possible causes — it found no furniture, or it found furniture no
// rule fires on — and listing what it found tells the two apart at a glance.
// A silence you can interrogate is a different thing from a silence.
// ---------------------------------------------------------------------------

const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

const SEC = 'border-t border-border pt-3.5 mt-2.5 first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0';
const SEC_H3 = 'm-0 mb-2.5 text-[10px] tracking-[0.11em] uppercase text-subtle';
const NOTE = 'text-[11.5px] text-muted leading-[1.5] mt-2';
const NOTE_WARN = 'text-[11.5px] leading-[1.5] text-muted border-l-2 border-border-strong pl-[9px]';
const NOTE_ERR = 'text-[11.5px] leading-[1.5] text-danger-ink border-l-2 border-danger pl-[9px]';
const KV = 'flex justify-between text-[11.5px] py-[3px] text-muted';
const KV_B = 'text-ink tabular-nums';
const BTN = 'text-xs leading-[1.5] px-3 py-[7px] rounded border border-border bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border';
const BTN_PRIMARY = 'text-xs leading-[1.5] px-3 py-[7px] rounded border border-cta bg-cta text-white cursor-pointer transition-colors duration-[120ms] hover:bg-cta-hover hover:border-cta-hover disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_TINY = 'border border-border rounded bg-surface text-ink cursor-pointer px-[5px] py-0 text-[11px] leading-[1.5] transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border';

export default function AccentPanel({
  rooms = [], roomId, onRoomChange, sent = null,
  state = { status: 'idle' }, result = null,
  dismissed = [], onToggleZone, onClear, onRun,
  ceilingFt, onCeilingChange, selId = null, onSelect,
  // Needed to say how long a run is. Derived on render rather than read off the
  // zone, because a stored length stops being true the moment somebody drags an
  // end — which is exactly what happened. See runMetres in boq.js.
  pxPerFt = null,
}) {
  const room = rooms.find((r) => r.id === roomId) || null;
  const running = state.status === 'running';
  const zones = result?.zones ?? [];
  const live = zones.filter((z) => !dismissed.includes(z.id) && !z.rejected);
  const unplaceable = zones.filter((z) => z.rejected);

  return (
    <div className={SEC}>
      <h3 className={SEC_H3}>Accent lighting</h3>

      {!rooms.length ? (
        <p className={NOTE}>Light the plan first — accent zones are marked out on a space
          that already has its ambient layout.</p>
      ) : <>
        <select value={roomId ?? ''} onChange={(e) => onRoomChange(e.target.value)}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.outline.name || 'Space'}
              {r.plan?.ok ? ` · ${r.plan.lights.length} lights` : ' · no layout'}
            </option>
          ))}
        </select>

        {/* Not on the plan, and every mounting height depends on it. */}
        <div className={KV + ' mt-2'}>
          <span>Ceiling height</span>
          <b className={KV_B}>
            <input type="number" min="7" max="20" step="0.5" value={ceilingFt}
              onChange={(e) => onCeilingChange(Number(e.target.value))}
              className="w-[54px]! px-1! py-0.5! text-[11px]! text-right!" /> ft
          </b>
        </div>

        {/* THE IMAGE AS THE MODEL WILL SEE IT. Not a flourish: a crop that
            landed on the wrong space, or a mask that erased the wrong side,
            produces a confident answer about somewhere else, and there is
            nothing in a list of zones that could tell you so. */}
        {sent && (
          <div className="flex gap-[6px] flex-wrap mt-2">
            <div className="relative w-[62px] h-[62px] rounded-[7px] overflow-hidden border border-accent-line bg-surface flex-none" title={`What gets sent — ${sent.w}x${sent.h}`}>
              <img src={sent.dataUrl} alt="the space as sent" className="w-full h-full object-contain block" />
            </div>
            <p className="text-[11.5px] text-muted leading-[1.5] m-0 flex-1 min-w-[120px]">
              This is what gets sent — everything but this space erased.
            </p>
          </div>
        )}

        <button className={BTN_PRIMARY + ' mt-2.5 w-full'}
          disabled={!room || !room.plan?.ok || running}
          onClick={onRun}>
          {running ? 'Reading the space…' : zones.length ? 'Ask again' : 'Find accent zones'}
        </button>

        <details className="mt-2 text-[11px] text-muted">
          <summary className="cursor-pointer text-subtle text-[10.5px]">The rules the code applies</summary>
          <ol className="mt-1.5 pl-[18px]">{PLACEMENT_RULES.map((r) => (
            <li className="mb-[3px] leading-[1.4]" key={r.id}><b className="text-ink">{r.label}</b> — {r.does}.</li>
          ))}</ol>
          <p className="mt-1.5 text-[10px]">
            The model is only asked what furniture is in the room. These are
            applied here, the same way every time.
          </p>
        </details>

        {state.status === 'error' && (
          <p className={NOTE_ERR + ' mt-2'}>{state.error}</p>
        )}

        {result && (
          <div className="mt-2.5">
            {result.notes && <p className={NOTE}>{result.notes}</p>}

            {/* WHAT IT SAW. First, and before the fittings, because when the
                answer is thin this is the line that explains it. */}
            <div className={KV}><span>Furniture found</span>
              <b className={KV_B}>{result.furniture?.length ?? 0}</b></div>
            {(result.handled ?? []).map((f, i) => {
              const t = FURNITURE_BY_ID[f.type];
              return (
                <div className="grid grid-cols-[8px_minmax(0,1fr)_auto_auto] gap-[7px] items-center py-[3px] text-[11px] border-b border-border last-of-type:border-b-0" key={i}>
                  <span className="w-2 h-2 rounded-[2px] flex-none" style={{ background: t?.colour || '#666' }} />
                  <span className="font-sans text-ink overflow-hidden text-ellipsis whitespace-nowrap">{t?.label || f.type}</span>
                  <span className="text-[10px] text-muted">
                    {f.rule
                      ? (f.emitted ? `${f.emitted} fitting${f.emitted > 1 ? 's' : ''}` : 'rule 2 — left alone')
                      : 'no rule'}
                  </span>
                  <span className="font-sans text-[9.5px] text-subtle">{pct(f.confidence)}</span>
                </div>
              );
            })}

            {!result.furniture?.length && state.status === 'done' && (
              <p className={NOTE_WARN + ' mt-1.5'}>
                It found no bed, wardrobe, TV unit, basin or sofa in this space. If
                there is one on the plan, check the crop above is the right space —
                the console carries the model's own words.
              </p>
            )}
            {result.furniture?.length > 0 && !zones.length && (
              <p className="text-[11.5px] text-muted leading-[1.5] mt-1.5">
                Furniture found, but no rule fires on it. That is a correct answer
                as often as not.
              </p>
            )}

            {zones.length > 0 && (
              <div className={KV + ' mt-2'}><span>Fittings</span>
                <b className={KV_B}>{live.length} of {zones.length}{unplaceable.length ? ` · ${unplaceable.length} off-wall` : ''}</b></div>
            )}

            {zones.map((z) => {
              const t = TYPE_BY_ID[z.type];
              const off = dismissed.includes(z.id);
              const bad = !!z.rejected;
              const on = z.id === selId;
              return (
                <div className={
                    'border rounded-[8px] py-[6px] px-2 mt-1.5 '
                    + (bad ? 'border-dashed ' : '')
                    + (on ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)] ' : (bad ? 'border-danger-line ' : 'border-border '))
                    + (bad ? 'bg-danger-soft' : 'bg-surface')
                    + (off ? ' opacity-[.42]' : '')
                  } key={z.id}
                  onClick={() => !z.rejected && onSelect?.(z.id === selId ? null : z.id)}
                  style={{ cursor: z.rejected ? 'default' : 'pointer' }}>
                  <div className="flex items-center gap-[6px]">
                    <span className="w-2 h-2 rounded-[2px] flex-none" style={{ background: t?.colour || '#666' }} />
                    <b className="font-sans text-[11px]">{t?.label || z.type}</b>
                    <span className="text-[9px] text-subtle border border-border rounded-full px-[5px] leading-[1.6] whitespace-nowrap">
                      {z.rejected ? 'not placed' : z.type === 'strip' ? 'run' : 'on the wall'}
                    </span>
                    <button className={BTN_TINY + ' ml-auto'} title={off ? 'Put it back' : 'Not this one'}
                      onClick={() => onToggleZone(z.id)}>{off ? '↩' : '×'}</button>
                  </div>
                  {z.what && <div className={'text-[11.5px] text-ink mt-[3px]' + (off ? ' line-through' : '')}>{z.what}</div>}
                  {z.rejected
                    ? <div className={'text-[10.5px] mt-0.5 leading-[1.45] text-danger-ink' + (off ? ' line-through' : '')}>{z.rejected}</div>
                    : z.why && <div className={'text-[10.5px] text-muted mt-0.5 leading-[1.45]' + (off ? ' line-through' : '')}>{z.why}</div>}
                  <div className="flex gap-2 flex-wrap mt-1 font-sans text-[9.5px] text-subtle tabular-nums">
                    {z.runLength != null && pxPerFt > 0 && (
                      <span>{(z.runLength / pxPerFt).toFixed(1)} ft run</span>
                    )}
                    {z.edited && <span>moved by hand</span>}
                    {z.mirrored && <span>mirrored</span>}
                    {z.group && <span>pair: {z.group}</span>}
                    <span>{pct(z.confidence)}</span>
                  </div>
                </div>
              );
            })}

            {result.skipped?.length > 0 && (
              <p className={NOTE_WARN + ' mt-1.5'}>
                {result.skipped.length} entr{result.skipped.length > 1 ? 'ies were' : 'y was'} dropped:
                {' '}{[...new Set(result.skipped.map((s) => s.reason))].join('; ')}.
              </p>
            )}

            {state.ms && <div className={KV}><span>Took</span><b className={KV_B}>{(state.ms / 1000).toFixed(1)}s</b></div>}
            <button className={BTN + ' mt-1.5 w-full'} onClick={onClear}>
              Clear these zones
            </button>
          </div>
        )}
      </>}
    </div>
  );
}
