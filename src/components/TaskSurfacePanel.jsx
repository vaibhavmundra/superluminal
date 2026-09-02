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
    <div className="border-t border-border pt-3.5 mt-2.5 first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0">
      <h3 className="m-0 mb-2.5 text-[10px] tracking-[0.11em] uppercase text-subtle">Task surfaces</h3>

      {!rooms.length ? (
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">Light the plan first — surfaces are found on a space that
          already has its ambient layout.</p>
      ) : <>
        <select value={roomId ?? ''} onChange={(e) => onRoomChange(e.target.value)}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.outline.name || 'Space'}</option>
          ))}
        </select>

        {/* One action, and it runs the whole plan — see AccentPanel. */}
        <button
          className="text-[12px] py-[7px] px-3 rounded border border-cta bg-cta text-white cursor-pointer transition-colors duration-[120ms] hover:bg-cta-hover hover:border-cta-hover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border mt-2 w-full"
          disabled={running} onClick={onRun}>
          {running ? 'Working…' : 'Recompute task surfaces for the plan'}
        </button>

        <details className="mt-2 text-[11px] text-muted">
          <summary className="cursor-pointer text-subtle text-[10.5px]">What counts as one</summary>
          <ul className="mt-[6px] pl-4">
            {SURFACE_TYPES.map((t) => (
              <li key={t.id} className="mb-[3px] leading-[1.4]">
                <b>{t.label}</b> — {t.context}.
              </li>
            ))}
          </ul>
          <p className="mt-[6px] text-[10px]">
            The qualifier is half the definition: a rectangle is only a coffee table
            because there is a sofa beside it.
          </p>
        </details>

        {state.status === 'error' && (
          <p className="text-[11.5px] leading-[1.5] mt-2 text-danger-ink border-l-2 border-danger pl-[9px]">{state.error}</p>
        )}

        {result && (
          <div className="mt-2.5">
            {result.notes && <p className="text-[11.5px] text-muted leading-[1.5] mt-2">{result.notes}</p>}

            {!found.length && state.status === 'done' && (
              <p className="text-[11.5px] text-muted leading-[1.5] mt-1.5">
                No task surface in this room. For a bedroom, a bathroom or a corridor
                that is the right answer.
              </p>
            )}

            {found.map((s) => {
              const t = SURFACE_BY_ID[s.type];
              const off = dismissed.includes(s.id);
              return (
                <div className={'rounded-[8px] border border-border bg-surface py-1.5 px-2 mt-1.5' + (off ? ' opacity-[0.42]' : '')} key={s.id}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-[2px] flex-none" style={{ background: t?.colour || '#666' }} />
                    <b className="text-[11px]">{t?.label || s.type}</b>
                    <button
                      className="rounded border border-border bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 py-0 px-[5px] text-[11px] leading-[1.5] ml-auto"
                      title={off ? 'Put it back' : 'Not one'}
                      onClick={() => onToggle(s.id)}>{off ? '↩' : '×'}</button>
                  </div>
                  {s.note && <div className={'text-[10.5px] text-muted mt-0.5 leading-[1.45]' + (off ? ' line-through' : '')}>{s.note}</div>}
                  {(() => {
                    // The spot is derived from the surface, so its outcome
                    // belongs on the surface's own row. A refusal is a sentence:
                    // "no spot appeared" is not something anyone can act on.
                    const sp = spots.find((q) => q.surfaceId === s.id);
                    if (off || !sp) return null;
                    // Three outcomes, and they are not the same thing. A SKIP
                    // is a decision already taken by the chandelier being
                    // there; a REJECTION is a problem to solve.
                    const why = 'text-[10.5px] mt-0.5 leading-[1.45] text-muted';
                    const whyWarn = 'text-[10.5px] mt-0.5 leading-[1.45] text-danger-ink';
                    if (sp.skipped) return <div className={why}>{sp.skipped}</div>;
                    if (sp.rejected) return <div className={whyWarn}>{sp.rejected}</div>;
                    // A SPOT IN A RUN STANDS WHERE IT DOES BECAUSE OF ITS
                    // NEIGHBOURS, not because of its own surface, and the panel
                    // has to say so — otherwise the one explanation on offer
                    // ("the middle of its own segment") is the one thing that
                    // is not true of it.
                    if (sp.run) {
                      return <div className={why}>Spot {sp.run.index + 1} of
                        {' '}{sp.run.of} in a run, all on one ceiling line
                        {sp.run.standoff < 0.05
                          ? ' through the group'
                          : ` ${sp.run.standoff.toFixed(1)} ft off the group`}.</div>;
                    }
                    // A SPOT PAST THE CAP IS ITS OWN OUTCOME, and it is neither
                    // of the two above. It is on the grid and it is aimed at the
                    // right thing, and it is doing so from far enough away that
                    // the beam grazes — which is a compromise somebody should
                    // either accept or fix by dragging it, not a detail to bury
                    // under the same sentence as an ordinary placement.
                    if (sp.far) {
                      return <div className={whyWarn}>Nothing on the grid
                        within reach of this surface — the nearest position that
                        works is {sp.aimFt?.toFixed(1)} ft away, so the beam
                        grazes rather than lights. Drag the spot if the ceiling
                        has somewhere better.</div>;
                    }
                    return <div className={why}>Spot on the secondary grid,
                      {sp.via === 'light-light'
                        ? ' between two lights' : ' between a light and the chunk edge'}
                      {sp.track ? ', clipped into the track' : ''}.</div>;
                  })()}
                  <div className="flex gap-2 flex-wrap mt-1 text-[9.5px] text-subtle">
                    {s.widthFt != null && (
                      <span>{s.widthFt.toFixed(1)} × {s.heightFt.toFixed(1)} ft</span>
                    )}
                    <span>{pct(s.confidence)}</span>
                  </div>
                </div>
              );
            })}

            {result.skipped?.length > 0 && (
              <p className="text-[11.5px] leading-[1.5] mt-1.5 text-muted border-l-2 border-border-strong pl-[9px]">
                {result.skipped.length} dropped:
                {' '}{[...new Set(result.skipped.map((x) => x.reason))].join('; ')}.
              </p>
            )}

            {found.length > 0 && (
              <div className="flex justify-between text-[11.5px] py-[3px] text-muted mt-2">
                <span>Kept</span><b className="text-ink tabular-nums">{live.length} of {found.length}</b></div>
            )}
            {state.ms && (
              <div className="flex justify-between text-[11.5px] py-[3px] text-muted">
                <span>Took</span><b className="text-ink tabular-nums">{(state.ms / 1000).toFixed(1)}s</b>
              </div>
            )}
            <button
              className="text-[12px] py-[7px] px-3 rounded border border-border bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed mt-1.5 w-full"
              onClick={onClear}>
              Clear
            </button>

            {found.length > 0 && (
              <>
                <div className="flex justify-between text-[11.5px] py-[3px] text-muted mt-1.5">
                  <span>Spots placed</span>
                  <b className="text-ink tabular-nums">{spots.filter((q) => q.x != null).length} of {live.length}
                    {spots.some((q) => q.skipped)
                      ? ` · ${spots.filter((q) => q.skipped).length} left to a chandelier` : ''}</b></div>
                <p className="text-[11.5px] text-muted leading-[1.5] mt-1.5">
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
