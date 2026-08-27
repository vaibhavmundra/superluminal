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
    <div className="sec">
      <h3>Accent lighting</h3>

      {!rooms.length ? (
        <p className="note">Light the plan first — accent zones are marked out on a room
          that already has its ambient layout.</p>
      ) : <>
        <select value={roomId ?? ''} onChange={(e) => onRoomChange(e.target.value)}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.outline.name || 'Room'}
              {r.plan?.ok ? ` · ${r.plan.lights.length} lights` : ' · no layout'}
            </option>
          ))}
        </select>

        {/* Not on the plan, and every mounting height depends on it. */}
        <div className="kv" style={{ marginTop: 8 }}>
          <span>Ceiling height</span>
          <b>
            <input type="number" min="7" max="20" step="0.5" value={ceilingFt}
              onChange={(e) => onCeilingChange(Number(e.target.value))}
              style={{ width: 54, padding: '2px 4px', fontSize: 11, textAlign: 'right' }} /> ft
          </b>
        </div>

        {/* THE IMAGE AS THE MODEL WILL SEE IT. Not a flourish: a crop that
            landed on the wrong room, or a mask that erased the wrong side,
            produces a confident answer about somewhere else, and there is
            nothing in a list of zones that could tell you so. */}
        {sent && (
          <div className="render-strip">
            <div className="render-thumb plan" title={`What gets sent — ${sent.w}x${sent.h}`}>
              <img src={sent.dataUrl} alt="the room as sent" />
            </div>
            <p className="note" style={{ margin: 0, flex: 1, minWidth: 120 }}>
              This is what gets sent — everything but this room erased.
            </p>
          </div>
        )}

        <button className="btn primary" style={{ marginTop: 10, width: '100%' }}
          disabled={!room || !room.plan?.ok || running}
          onClick={onRun}>
          {running ? 'Reading the room…' : zones.length ? 'Ask again' : 'Find accent zones'}
        </button>

        <details className="accent-rules">
          <summary>The rules the code applies</summary>
          <ol>{PLACEMENT_RULES.map((r) => (
            <li key={r.id}><b>{r.label}</b> — {r.does}.</li>
          ))}</ol>
          <p style={{ margin: '6px 0 0', fontSize: 10 }}>
            The model is only asked what furniture is in the room. These are
            applied here, the same way every time.
          </p>
        </details>

        {state.status === 'error' && (
          <p className="note warn" style={{ marginTop: 8 }}>{state.error}</p>
        )}

        {result && (
          <div style={{ marginTop: 10 }}>
            {result.notes && <p className="note">{result.notes}</p>}

            {/* WHAT IT SAW. First, and before the fittings, because when the
                answer is thin this is the line that explains it. */}
            <div className="kv"><span>Furniture found</span>
              <b>{result.furniture?.length ?? 0}</b></div>
            {(result.handled ?? []).map((f, i) => {
              const t = FURNITURE_BY_ID[f.type];
              return (
                <div className="furn-row" key={i}>
                  <span className="accent-dot" style={{ background: t?.colour || '#666' }} />
                  <span className="furn-name">{t?.label || f.type}</span>
                  <span className="furn-out">
                    {f.rule
                      ? (f.emitted ? `${f.emitted} fitting${f.emitted > 1 ? 's' : ''}` : 'rule 2 — left alone')
                      : 'no rule'}
                  </span>
                  <span className="furn-conf">{pct(f.confidence)}</span>
                </div>
              );
            })}

            {!result.furniture?.length && state.status === 'done' && (
              <p className="note warn" style={{ marginTop: 6 }}>
                It found no bed, wardrobe, TV unit, basin or sofa in this room. If
                there is one on the plan, check the crop above is the right room —
                the console carries the model's own words.
              </p>
            )}
            {result.furniture?.length > 0 && !zones.length && (
              <p className="note" style={{ marginTop: 6 }}>
                Furniture found, but no rule fires on it. That is a correct answer
                as often as not.
              </p>
            )}

            {zones.length > 0 && (
              <div className="kv" style={{ marginTop: 8 }}><span>Fittings</span>
                <b>{live.length} of {zones.length}{unplaceable.length ? ` · ${unplaceable.length} off-wall` : ''}</b></div>
            )}

            {zones.map((z) => {
              const t = TYPE_BY_ID[z.type];
              const off = dismissed.includes(z.id);
              return (
                <div className={'accent-row' + (off ? ' off' : '') + (z.rejected ? ' bad' : '')
                                + (z.id === selId ? ' on' : '')} key={z.id}
                  onClick={() => !z.rejected && onSelect?.(z.id === selId ? null : z.id)}
                  style={{ cursor: z.rejected ? 'default' : 'pointer' }}>
                  <div className="accent-head">
                    <span className="accent-dot" style={{ background: t?.colour || '#666' }} />
                    <b>{t?.label || z.type}</b>
                    <span className="accent-role">
                      {z.rejected ? 'not placed' : z.type === 'strip' ? 'run' : 'on the wall'}
                    </span>
                    <button className="btn tiny" title={off ? 'Put it back' : 'Not this one'}
                      onClick={() => onToggleZone(z.id)}>{off ? '↩' : '×'}</button>
                  </div>
                  {z.what && <div className="accent-what">{z.what}</div>}
                  {z.rejected
                    ? <div className="accent-why warn">{z.rejected}</div>
                    : z.why && <div className="accent-why">{z.why}</div>}
                  <div className="accent-meta">
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
              <p className="note warn" style={{ marginTop: 6 }}>
                {result.skipped.length} entr{result.skipped.length > 1 ? 'ies were' : 'y was'} dropped:
                {' '}{[...new Set(result.skipped.map((s) => s.reason))].join('; ')}.
              </p>
            )}

            {state.ms && <div className="kv"><span>Took</span><b>{(state.ms / 1000).toFixed(1)}s</b></div>}
            <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={onClear}>
              Clear these zones
            </button>
          </div>
        )}
      </>}
    </div>
  );
}
