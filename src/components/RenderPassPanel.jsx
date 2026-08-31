import React, { useRef, useState } from 'react';
import { WALL_BY_ID } from '../lib/wallPrompt.js';
import { RENDER_ACCEPT, RENDER_DEFAULTS } from '../lib/renderImage.js';
import PromptTranscript from './PromptTranscript.jsx';

// ---------------------------------------------------------------------------
// RenderPassPanel — upload a couple of views of a space, get the wall features
// marked out on the plan.
//
// THE SHAPE OF THIS PANEL IS AN ARGUMENT ABOUT WHAT WENT WRONG WHEN IT DOES.
// The pass is two model calls in a row and either can fail, so a single
// "nothing found" would be four different problems wearing one face: no
// renders worth reading, PROMPT 01 saw nothing, PROMPT 02 could not find the
// wall, or the plan has no scale so there was never a grid to place anything
// on. Every one of those needs a different thing done about it.
//
// So the panel shows, in order: WHAT WAS SENT (two thumbnails and the gridded
// plan, because "it looked at the wrong room" is invisible in a list of
// results), WHAT IT SAW (the English from PROMPT 01, always, even for elements
// that were never placed), and WHERE IT PUT IT (the cells, from PROMPT 02).
// An element with words and no cells is a legible, actionable state — the
// second call could not tie that wall to the drawing — and it is the state
// that would otherwise silently vanish.
//
// IT IS THE SAME LESSON AS AccentPanel's furniture list, one step harder,
// because here the two halves are two separate calls and the join between them
// can fail on its own.
// ---------------------------------------------------------------------------

const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.round(n / 1000)}KB`);

const PHASE_SAY = {
  shrinking: 'Downscaling the renders…',
  reading: 'Reading the renders…',
  gridding: 'Drawing the grid…',
  placing: 'Placing them on the plan…',
};

export default function RenderPassPanel({
  room = null, grid = null, pxPerFt = null,
  renders = [], onAddFiles, onRemoveRender, onClearRenders,
  shot = null, state = { status: 'idle' }, result = null,
  transcript = null,
  onRun, onClear,
}) {
  const fileRef = useRef(null);
  const [showTx, setShowTx] = useState(false);
  const running = state.status === 'running';
  const elements = result?.elements ?? [];
  const placed = elements.filter((e) => e.cells?.length);
  // AT LEAST ONE CALL HAS COME BACK. Offered while the pass is still running
  // too, on purpose: the first call lands a good half-minute before the second,
  // and being able to read what it said while the second one thinks is the
  // whole difference between a wait and a hang.
  const hasTx = !!(transcript?.first || transcript?.second);

  // WHY THE BUTTON IS DISABLED, IN WORDS, AND ONLY THE FIRST REASON.
  // A disabled button with no explanation is the single most common way a
  // feature reads as broken. Only the first blocker is shown because fixing it
  // is the next action, and a list of three would be a list of two things that
  // are not yet anybody's problem.
  const blocked = !room ? 'Pick a space in the list above first.'
    : !room.plan?.ok ? 'Light this space first — the grid is laid inside its outline.'
    : !(pxPerFt > 0) ? 'Set the scale first. A 1ft grid needs to know what a foot is.'
    : !grid ? 'No grid could be laid in this space.'
    : !renders.length ? 'Add a render or two of this space.'
    : null;

  return (
    <div className="sec">
      <h3>Render pass{room ? ` · ${room.outline?.name || 'Space'}` : ''}</h3>
      <p className="note" style={{ marginTop: 2 }}>
        The plan cannot show what is ON the walls. Upload a couple of views of
        this space and the panelling, shelving and art get marked out on it.
      </p>

      {/* --- the renders ------------------------------------------------- */}
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button className="btn" disabled={running || !room}
          onClick={() => fileRef.current?.click()}>
          {renders.length ? 'Add another view' : 'Add renders'}
        </button>
        {renders.length > 0 && (
          <button className="btn" disabled={running} onClick={onClearRenders}>Clear</button>
        )}
      </div>
      <input ref={fileRef} type="file" multiple accept={RENDER_ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          // RESET THE INPUT. Without this, picking the same file twice in a row
          // fires no change event at all and the second add silently does
          // nothing — which reads as the upload being broken.
          e.target.value = '';
          if (files.length) onAddFiles?.(files);
        }} />

      {renders.length > 0 && (
        <div className="render-strip" style={{ marginTop: 8 }}>
          {renders.map((r, i) => (
            <div className="render-thumb" key={i}
              title={`${r.name} — sent at ${r.w}×${r.h}, ${kb(r.bytes)}`}>
              <img src={r.dataUrl} alt={r.name} />
              {!running && (
                <button className="render-x" title="Remove this view"
                  onClick={() => onRemoveRender?.(i)}>×</button>
              )}
            </div>
          ))}
        </div>
      )}
      {renders.length > 0 && (
        <p className="note" style={{ marginTop: 4 }}>
          {renders.length} view{renders.length > 1 ? 's' : ''} ·
          {' '}{kb(renders.reduce((n, r) => n + r.bytes, 0))} after downscaling
          {renders.some((r) => r.fromW > r.w) && ' (originals are not sent)'}
        </p>
      )}
      {(state.notes ?? []).map((n, i) => (
        <p className="note warn" key={i} style={{ marginTop: 4 }}>{n}</p>
      ))}

      {/* --- the gridded plan, as the model will see it ------------------- */}
      {shot && (
        <div className="render-strip" style={{ marginTop: 8 }}>
          <div className="render-thumb plan" title={`The gridded plan — ${shot.w}×${shot.h}`}>
            <img src={shot.dataUrl} alt="the space, gridded" />
          </div>
          <p className="note" style={{ margin: 0, flex: 1, minWidth: 120 }}>
            {grid
              ? <>The second call gets this: {grid.cols} × {grid.rows} cells,
                  {' '}{grid.cellWFt.toFixed(2)} ft each. Cell [1,1] is bottom-left.</>
              : 'No grid on this space.'}
          </p>
        </div>
      )}

      <button className="btn primary" style={{ marginTop: 10, width: '100%' }}
        disabled={!!blocked || running} onClick={onRun}>
        {running ? (PHASE_SAY[state.phase] || 'Working…')
          : elements.length ? 'Analyse again' : 'Analyse renders'}
      </button>
      {/* WHAT WAS ACTUALLY ASKED, one click under the button that asks it.
          Both prompts are written to be tuned — see wallPrompt.js — and half of
          the second one is filled in at runtime from this room's grid, this
          room's anchors and the first call's answer, so the file on disk is not
          the question that got asked. Directly under Analyse because that is
          where somebody is standing when they want it: they have just read an
          answer they do not believe. */}
      {hasTx && (
        <button className="btn" style={{ marginTop: 6, width: '100%' }}
          onClick={() => setShowTx(true)}>
          Show the prompts &amp; replies
        </button>
      )}
      {showTx && (
        <PromptTranscript transcript={transcript} roomName={room?.outline?.name || null}
          onClose={() => setShowTx(false)} />
      )}
      {blocked && !running && <p className="note" style={{ marginTop: 6 }}>{blocked}</p>}
      {!blocked && !running && renders.length >= RENDER_DEFAULTS.maxRenders && (
        <p className="note" style={{ marginTop: 6 }}>
          That is as many views as this pass sends.
        </p>
      )}

      {state.status === 'error' && (
        <p className="note err" style={{ marginTop: 8 }}>{state.error}</p>
      )}

      {/* --- what came back ---------------------------------------------- */}
      {result && (
        <div style={{ marginTop: 10 }}>
          <div className="kv"><span>Wall features seen</span><b>{elements.length}</b></div>
          {elements.length > 0 && (
            <div className="kv"><span>Placed on the plan</span>
              <b>{placed.length} of {elements.length}</b></div>
          )}

          {elements.length === 0 && state.status === 'done' && (
            <p className="note warn" style={{ marginTop: 6 }}>
              Nothing on the walls in these views — no shelves, art, panelling or
              wallpaper. If there plainly is, check the thumbnails above are the
              right space; the console carries the model&apos;s own words.
            </p>
          )}

          {elements.map((e, i) => {
            const t = WALL_BY_ID[e.type];
            const on = e.cells?.length > 0;
            return (
              <div className={'wall-row' + (on ? '' : ' off')} key={i}>
                <div className="accent-head">
                  <span className="accent-dot" style={{ background: t?.colour || '#666' }} />
                  <b>{t?.label || e.type}</b>
                  <span className="accent-role">
                    {on ? `${e.cells.length} cell${e.cells.length > 1 ? 's' : ''}` : 'not placed'}
                  </span>
                </div>
                <div className="accent-what">{e.wall}</div>
                {e.location && <div className="accent-why">{e.location}</div>}
                <div className="accent-meta">
                  {e.dimension && <span>{e.dimension}</span>}
                  {on && <span>{e.wallRef || 'wall'} · [{e.start.x},{e.start.y}]→[{e.end.x},{e.end.y}]</span>}
                  <span>{pct(e.confidence)}</span>
                </div>
                {/* THE ONE DISAGREEMENT WORTH SURFACING. PROMPT 01 said how wide
                    it is and PROMPT 02 drew how long it is; when those differ by
                    more than a couple of feet it is almost always the second
                    call reading the grid wrong, and nothing else on screen
                    would ever say so. */}
                {on && e.widthFt != null && Math.abs(e.cells.length - e.widthFt) > 2 && (
                  <div className="accent-why warn">
                    Called {e.widthFt} ft wide but drawn {e.cells.length} cells long.
                  </div>
                )}
                {e.clamped && (
                  <div className="accent-why warn">Longer than the wall — clamped to it.</div>
                )}
                {!on && (
                  <div className="accent-why warn">
                    Seen in the render, but the second call could not tie that
                    wall to this drawing.
                  </div>
                )}
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
            Clear these wall features
          </button>
        </div>
      )}
    </div>
  );
}
