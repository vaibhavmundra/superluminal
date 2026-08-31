import React from 'react';
import { SURFACE_BY_ID, SURFACE_TYPES } from '../lib/taskSurfaces.js';

// ---------------------------------------------------------------------------
// TaskSurfacePanel — find the planes somebody works at.
//
// FINDING ONLY, for now. No fixture comes out of this and nothing is placed;
// the boxes go on the drawing so the reading can be judged before anything is
// built on top of it. That is deliberately the same order the accent pass was
// built in — see whether it can SEE the thing before deciding what to do about
// it — and it is the order that made the accent pass's one real failure
// (returning nothing) obvious instead of mysterious.
// ---------------------------------------------------------------------------

const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

export default function TaskSurfacePanel({
  rooms = [], roomId, onRoomChange,
  state = { status: 'idle' }, result = null,
  dismissed = [], onToggle, onClear, onRun, spots = [],
}) {
  const room = rooms.find((r) => r.id === roomId) || null;
  const running = state.status === 'running';
  const found = result?.surfaces ?? [];
  const live = found.filter((s) => !dismissed.includes(s.id));

  return (
    <div className="sec">
      <h3>Task surfaces</h3>

      {!rooms.length ? (
        <p className="note">Light the plan first — surfaces are found on a space that
          already has its ambient layout.</p>
      ) : <>
        <select value={roomId ?? ''} onChange={(e) => onRoomChange(e.target.value)}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.outline.name || 'Space'}</option>
          ))}
        </select>

        {/* One action, and it runs the whole plan — see AccentPanel. */}
        <button className="btn primary" style={{ marginTop: 8, width: '100%' }}
          disabled={running} onClick={onRun}>
          {running ? 'Working…' : 'Recompute task surfaces for the plan'}
        </button>

        <details className="accent-rules">
          <summary>What counts as one</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
            {SURFACE_TYPES.map((t) => (
              <li key={t.id} style={{ marginBottom: 3, lineHeight: 1.4 }}>
                <b>{t.label}</b> — {t.context}.
              </li>
            ))}
          </ul>
          <p style={{ margin: '6px 0 0', fontSize: 10 }}>
            The qualifier is half the definition: a rectangle is only a coffee table
            because there is a sofa beside it.
          </p>
        </details>

        {state.status === 'error' && (
          <p className="note err" style={{ marginTop: 8 }}>{state.error}</p>
        )}

        {result && (
          <div style={{ marginTop: 10 }}>
            {result.notes && <p className="note">{result.notes}</p>}

            {!found.length && state.status === 'done' && (
              <p className="note" style={{ marginTop: 6 }}>
                No task surface in this room. For a bedroom, a bathroom or a corridor
                that is the right answer.
              </p>
            )}

            {found.map((s) => {
              const t = SURFACE_BY_ID[s.type];
              const off = dismissed.includes(s.id);
              return (
                <div className={'accent-row' + (off ? ' off' : '')} key={s.id}>
                  <div className="accent-head">
                    <span className="accent-dot" style={{ background: t?.colour || '#666' }} />
                    <b>{t?.label || s.type}</b>
                    <button className="btn tiny" title={off ? 'Put it back' : 'Not one'}
                      onClick={() => onToggle(s.id)}>{off ? '↩' : '×'}</button>
                  </div>
                  {s.note && <div className="accent-why">{s.note}</div>}
                  {(() => {
                    // The spot is derived from the surface, so its outcome
                    // belongs on the surface's own row. A refusal is a sentence:
                    // "no spot appeared" is not something anyone can act on.
                    const sp = spots.find((q) => q.surfaceId === s.id);
                    if (off || !sp) return null;
                    // Three outcomes, and they are not the same thing. A SKIP
                    // is a decision already taken by the chandelier being
                    // there; a REJECTION is a problem to solve.
                    if (sp.skipped) return <div className="accent-why">{sp.skipped}</div>;
                    if (sp.rejected) return <div className="accent-why warn">{sp.rejected}</div>;
                    // A SPOT IN A RUN STANDS WHERE IT DOES BECAUSE OF ITS
                    // NEIGHBOURS, not because of its own surface, and the panel
                    // has to say so — otherwise the one explanation on offer
                    // ("the middle of its own segment") is the one thing that
                    // is not true of it.
                    if (sp.run) {
                      return <div className="accent-why">Spot {sp.run.index + 1} of
                        {' '}{sp.run.of} in a run, all on one ceiling line
                        {sp.run.standoff < 0.05
                          ? ' through the group'
                          : ` ${sp.run.standoff.toFixed(1)} ft off the group`}.</div>;
                    }
                    return <div className="accent-why">Spot on the secondary grid,
                      {sp.via === 'light-light'
                        ? ' between two lights' : ' between a light and the chunk edge'}.</div>;
                  })()}
                  <div className="accent-meta">
                    {s.widthFt != null && (
                      <span>{s.widthFt.toFixed(1)} × {s.heightFt.toFixed(1)} ft</span>
                    )}
                    <span>{pct(s.confidence)}</span>
                  </div>
                </div>
              );
            })}

            {result.skipped?.length > 0 && (
              <p className="note warn" style={{ marginTop: 6 }}>
                {result.skipped.length} dropped:
                {' '}{[...new Set(result.skipped.map((x) => x.reason))].join('; ')}.
              </p>
            )}

            {found.length > 0 && (
              <div className="kv" style={{ marginTop: 8 }}>
                <span>Kept</span><b>{live.length} of {found.length}</b></div>
            )}
            {state.ms && <div className="kv"><span>Took</span><b>{(state.ms / 1000).toFixed(1)}s</b></div>}
            <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={onClear}>
              Clear
            </button>

            {found.length > 0 && (
              <>
                <div className="kv" style={{ marginTop: 6 }}>
                  <span>Spots placed</span>
                  <b>{spots.filter((q) => q.x != null).length} of {live.length}
                    {spots.some((q) => q.skipped)
                      ? ` · ${spots.filter((q) => q.skipped).length} left to a chandelier` : ''}</b></div>
                <p className="note" style={{ marginTop: 6 }}>
                  One spot per surface, each at the middle of its own
                  secondary-grid segment. Surfaces of the same kind sitting side
                  by side are lit as a <b>run</b> instead — one ceiling line for
                  the group, never closer than 6 in apart — because two spots on
                  two different lines read as two unrelated decisions. A surface
                  with a chandelier within 3 ft of it is left alone. Turn on
                  <b> Secondary grid</b> under View to see the lines.
                </p>
              </>
            )}
          </div>
        )}
      </>}
    </div>
  );
}
