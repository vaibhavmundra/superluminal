import React, { useRef, useState } from 'react';
import { RENDER_ACCEPT, RENDER_DEFAULTS } from '../lib/renderImage.js';
import PromptTranscript from './PromptTranscript.jsx';

// ---------------------------------------------------------------------------
// RenderPassPanel — upload a couple of views of a space, get the wall features
// marked out on the plan.
//
// IT IS A CONTROL, NOT A REPORT, and it used to be both.
//
// Under the button was a card per wall element: the type, the cell count, the
// wall and location in the model's own words, the dimension, the confidence,
// and then a line for whatever fitting the element produced. Above them, five
// counts — features seen, features placed, reverse coves, shelf strips, art
// spots. Every one of those was real and was the right thing to have while the
// pass was being built: it is how you tell "it saw nothing" from "it saw it and
// could not place it", and how you check the rules fired.
//
// None of it is the user's business on a finished plan. The pass runs, and what
// it decided is ON THE DRAWING — a filled slot along the panelled wall, a run of
// tape in the shelving, a pair of spots at the picture. A panel that also
// enumerates the reasoning is asking somebody to audit a decision they did not
// know was being made, in a column of text beside the drawing that already shows
// it. It is the same argument that emptied the accent and task-surface panels
// into "Additional lighting", and the same answer: the DETECTORS still run and
// what they place is on the sheet and in the schedule; what went is the
// reporting.
//
// WHERE IT WENT, because none of it was thrown away: the counts and the cells
// are under Admin → "Show what was identified", beside the bed boxes and the
// task surfaces they are a sibling of, and the model's own words are one click
// away under "Show the prompts & replies" for anybody at all.
//
// WHAT STAYS IS ABOUT THE RUN, NOT ABOUT THE RESULTS. What was sent (the
// thumbnails and the gridded plan, because "it looked at the wrong room" is
// invisible everywhere else), whether it failed and how, how long it took, and
// the two ways out. Plus one line about the lengths, because a drag is the one
// thing here a person did rather than a rule.
// ---------------------------------------------------------------------------

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
  transcript = null, runCount = 0, trimmedRuns = [],
  onRun, onClear, onResetLengths,
}) {
  const fileRef = useRef(null);
  const [showTx, setShowTx] = useState(false);
  const [over, setOver] = useState(false);
  const running = state.status === 'running';
  const elements = result?.elements ?? [];
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
    // A BLOCK INSIDE A SPACE, NOT A SECTION OF THE PANEL. It used to be a
    // top-level `.sec` with its own `h3` naming the room — which is what a
    // section describing whichever space is selected has to do, and what stops
    // being necessary the moment it lives inside that space's own row.
    <div className="space-block">
      <h4>Place lights according to renders</h4>
      

      {/* --- the renders -------------------------------------------------
          A DROP TARGET AS WELL AS A BUTTON. A render arrives from a folder or
          another window and the gesture people already have for it is a drag;
          making them find a file picker for a file they are already holding is
          a step spent on nothing. The button stays because a drop target with
          no button is a feature nobody discovers, and because a drag is not
          available from every device.
          `stopPropagation` on all three, because the whole stage is a drop
          target for a FLOOR PLAN — without it, dropping a render here would
          load it as the drawing and throw the layout away. */}
      <div
        className={'drop-renders' + (over ? ' over' : '') + (running ? ' busy' : '')}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!running) setOver(true); }}
        onDragLeave={(e) => { e.stopPropagation(); setOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation(); setOver(false);
          if (running || !room) return;
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length) onAddFiles?.(files);
        }}>
        <span>Drop renders here</span>
        <div className="btnrow">
          <button className="btn" disabled={running || !room}
            onClick={() => fileRef.current?.click()}>
            {renders.length ? 'Add another' : 'Choose files'}
          </button>
          {renders.length > 0 && (
            <button className="btn" disabled={running} onClick={onClearRenders}>Clear</button>
          )}
        </div>
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

      {/* --- how the run went, and nothing about what it found -----------
          The counts and the cards that used to be here are in the header's
          note. What is left answers only "did it work, and what do I do now". */}
      {result && (
        <div style={{ marginTop: 10 }}>
          {elements.length === 0 && state.status === 'done' && (
            <p className="note warn" style={{ marginTop: 6 }}>
              Nothing on the walls in these views — no shelves, art, panelling or
              wallpaper. If there plainly is, check the thumbnails above are the
              right space; the prompts and replies are one click up.
            </p>
          )}

          {/* THE SECOND CALL CAME BACK WITH NO ARRAY AT ALL. Different from an
              array that placed nothing, and different again from finding nothing
              on the walls — this one is a reply that ran out of tokens part-way
              through its worksheet, or wandered off. It leaves the drawing empty,
              which is indistinguishable from the other two unless it is said out
              loud. */}
          {result.placedNone && elements.length > 0 && (
            <p className="note warn" style={{ marginTop: 6 }}>
              It read the renders but the second call came back without a usable
              answer, so nothing is on the plan. Analysing again usually fixes it.
            </p>
          )}


          {result.skipped?.length > 0 && (
            <p className="note warn" style={{ marginTop: 6 }}>
              {result.skipped.length} entr{result.skipped.length > 1 ? 'ies were' : 'y was'} dropped:
              {' '}{[...new Set(result.skipped.map((s) => s.reason))].join('; ')}.
            </p>
          )}
          {state.ms && <div className="kv"><span>Took</span><b>{(state.ms / 1000).toFixed(1)}s</b></div>}
          {/* BACK TO THE RULE. The only edit this pass produces that a person
              made rather than a rule derived, so it is the only one there is
              anything to undo. Offered on the whole space rather than per run,
              because the runs are no longer listed — and because somebody who
              wants one back usually wants all of them back. */}
          {trimmedRuns.length > 0 && onResetLengths && (
            <button className="btn" style={{ marginTop: 6, width: '100%' }}
              onClick={onResetLengths}>
              Reset {trimmedRuns.length} length{trimmedRuns.length === 1 ? '' : 's'} set by hand
            </button>
          )}
          <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={onClear}>
            Clear these wall features
          </button>
        </div>
      )}
    </div>
  );
}
