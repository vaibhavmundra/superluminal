import React, { useRef, useState } from 'react';
import { RENDER_ACCEPT, RENDER_DEFAULTS } from '../lib/renderImage.js';

// The old `.btn` / `.btn.primary` classes, as Tailwind utilities — same split
// as PlanPicker.jsx, so a merged hover string never lets two hover colours
// both apply.
const BTN_BASE = 'text-[12px] px-3 py-[7px] rounded border cursor-pointer transition-colors duration-[120ms] disabled:cursor-not-allowed';
const BTN_DEFAULT = 'border-border bg-none text-white hover:text-black hover:bg-surface-2 hover:border-border-strong active:bg-surface-3  ';
/* WHITE, NOT THE RAMP. Reading a render is a step INSIDE a design that already
   exists — the spaces are lit, the schedule is written, and this pass goes back
   over one wall to mark what the photographs show. The ramp is spent on the acts
   that begin work, and there are three of those; this is a recompute, and a
   recompute in the loudest colour on the page competes with the drawing it is
   about to change. It also drops a `disabled:` gradient that never worked:
   `bg-*` sets background-COLOUR and cannot override a background-IMAGE, so a
   dead button kept the full ramp under it. `BTN_BASE` only sets the cursor for
   the disabled state, so the dimming is declared here with the colour it dims. */
const BTN_PRIMARY = 'border-white bg-white text-black hover:bg-text hover:border-text disabled:opacity-40';

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
  renders = [], stored = 0, onAddFiles, onRemoveRender, onClearRenders,
  shot = null, state = { status: 'idle' }, result = null,
  transcript = null, runCount = 0, trimmedRuns = [],
  onRun, onClear, onResetLengths,
}) {
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  const running = state.status === 'running';
  const elements = result?.elements ?? [];
  // AT LEAST ONE CALL HAS COME BACK. Offered while the pass is still running
  // too, on purpose: the first call lands a good half-minute before the second,
  // and being able to read what it said while the second one thinks is the
  // whole difference between a wait and a hang.

  // THE GAP BETWEEN "THIS SPACE HAS VIEWS" AND "THE VIEWS ARE HERE".
  // The paths come back with the plan; the JPEGs are fetched from the bucket
  // afterwards and only for the space that is open. For the second or two in
  // between, the honest thing to say is that they are coming — an empty drop
  // target under a room full of reverse coves reads as "the pass was lost".
  const waiting = !renders.length && stored > 0;

  // WHY THE BUTTON IS DISABLED, IN WORDS, AND ONLY THE FIRST REASON.
  // A disabled button with no explanation is the single most common way a
  // feature reads as broken. Only the first blocker is shown because fixing it
  // is the next action, and a list of three would be a list of two things that
  // are not yet anybody's problem.
  const blocked = !room ? 'Pick a space in the list above first.'
    : !room.plan?.ok ? 'Light this space first — the grid is laid inside its outline.'
    : !(pxPerFt > 0) ? 'Set the scale first. A 1ft grid needs to know what a foot is.'
    : !grid ? 'No grid could be laid in this space.'
    : waiting ? `Bringing back ${stored} saved view${stored > 1 ? 's' : ''}…`
    : !renders.length ? 'Add a render or two of this space.'
    : null;

  return (
    // A BLOCK INSIDE A SPACE, NOT A SECTION OF THE PANEL. It used to be a
    // top-level `.sec` with its own `h3` naming the room — which is what a
    // section describing whichever space is selected has to do, and what stops
    // being necessary the moment it lives inside that space's own row.
    <div className="mt-1.5">
      <h4 className="m-0 mb-[7px] text-[10px] font-normal tracking-[0.08em] uppercase text-subtle">Place lights according to renders</h4>


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
        className={
          'mt-2 p-2.5 rounded-[9px] text-center border border-border/10 border-dashed bg-input-bg '
          + 'flex flex-col items-center gap-2 transition-[border-color,background-color] duration-[120ms] '
          + (over ? 'border-accent bg-accent-soft ' : 'border-border ')
          + (running ? 'opacity-[.55]' : '')
        }
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!running) setOver(true); }}
        onDragLeave={(e) => { e.stopPropagation(); setOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation(); setOver(false);
          if (running || !room) return;
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length) onAddFiles?.(files);
        }}>
        <span className="text-[10.5px] text-subtle">{waiting
          ? `Bringing back ${stored} saved view${stored > 1 ? 's' : ''}…`
          : 'Drop renders here'}</span>
        <div className="flex gap-1.5 flex-wrap">
          <button className={BTN_BASE + ' ' + BTN_DEFAULT} disabled={running || !room}
            onClick={() => fileRef.current?.click()}>
            {renders.length ? 'Add another' : 'Choose files'}
          </button>
          {renders.length > 0 && (
            <button className={BTN_BASE + ' ' + BTN_DEFAULT} disabled={running} onClick={onClearRenders}>Clear</button>
          )}
        </div>
      </div>
      <input ref={fileRef} type="file" multiple accept={RENDER_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          // RESET THE INPUT. Without this, picking the same file twice in a row
          // fires no change event at all and the second add silently does
          // nothing — which reads as the upload being broken.
          e.target.value = '';
          if (files.length) onAddFiles?.(files);
        }} />

      {renders.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {renders.map((r, i) => (
            <div className="relative w-[62px] h-[62px] rounded-[7px] overflow-hidden border border-border bg-input-bg flex-none" key={i}
              title={`${r.name} — sent at ${r.w}×${r.h}, ${kb(r.bytes)}`}>
              <img src={r.dataUrl} alt={r.name} className="w-full h-full object-cover block" />
              {!running && (
                <button className="absolute top-0.5 right-0.5 w-[15px] h-[15px] p-0 leading-[13px] border-0 rounded-[4px] bg-[rgba(0,0,0,0.7)] text-white text-xs cursor-pointer hover:bg-danger" title="Remove this view"
                  onClick={() => onRemoveRender?.(i)}>×</button>
              )}
            </div>
          ))}
        </div>
      )}
      {renders.length > 0 && (
        <p className="text-[11.5px] text-muted leading-normal mt-1">
          {renders.length} view{renders.length > 1 ? 's' : ''}
          {/* SAID ONLY WHEN IT IS TRUE OF EVERY VIEW. "Saved with this space"
              next to a list where one of them is not saved is worse than
              silence — the one that would be lost is the one it reassures you
              about. A drop made while the plan's row was still being inserted
              is exactly that case. */}
          {stored >= renders.length && stored > 0 && ' · Saved with this space'}
        </p>
      )}
      {(state.notes ?? []).map((n, i) => (
        <p className="text-[11.5px] text-muted leading-normal border-l-2 border-border-strong pl-[9px] mt-1" key={i}>{n}</p>
      ))}

      {/* --- the gridded plan, as the model will see it ------------------- */}
      

      <button className={BTN_BASE + ' ' + BTN_PRIMARY + ' mt-2.5 w-full'}
        disabled={!!blocked || running} onClick={onRun}>
        {running ? (PHASE_SAY[state.phase] || 'Working…')
          : elements.length ? 'Analyse again' : 'Analyse renders'}
      </button>
      {blocked && !running && <p className="text-[11.5px] text-muted leading-normal mt-1.5">{blocked}</p>}
      {!blocked && !running && renders.length >= RENDER_DEFAULTS.maxRenders && (
        <p className="text-[11.5px] text-muted leading-normal mt-1.5">
          That is as many views as this pass sends.
        </p>
      )}

      {state.status === 'error' && (
        <p className="text-[11.5px] text-danger-ink leading-normal border-l-2 border-danger pl-[9px] mt-2">{state.error}</p>
      )}

      {/* --- how the run went, and nothing about what it found -----------
          The counts and the cards that used to be here are in the header's
          note. What is left answers only "did it work, and what do I do now". */}
      {result && (
        <div className="mt-2.5">
          {elements.length === 0 && state.status === 'done' && (
            <p className="text-[11.5px] text-muted leading-normal border-l-2 border-border-strong pl-[9px] mt-1.5">
              Nothing on the walls in these views — no shelves, art, panelling or
              wallpaper. If there plainly is, check the thumbnails above are the
              right space.
            </p>
          )}

          {/* THE SECOND CALL CAME BACK WITH NO ARRAY AT ALL. Different from an
              array that placed nothing, and different again from finding nothing
              on the walls — this one is a reply that ran out of tokens part-way
              through its worksheet, or wandered off. It leaves the drawing empty,
              which is indistinguishable from the other two unless it is said out
              loud. */}
          {result.placedNone && elements.length > 0 && (
            <p className="text-[11.5px] text-muted leading-normal border-l-2 border-border-strong pl-[9px] mt-1.5">
              It read the renders but the second call came back without a usable
              answer, so nothing is on the plan. Analysing again usually fixes it.
            </p>
          )}


          {result.skipped?.length > 0 && (
            <p className="text-[11.5px] text-muted leading-normal border-l-2 border-border-strong pl-[9px] mt-1.5">
              {result.skipped.length} entr{result.skipped.length > 1 ? 'ies were' : 'y was'} dropped:
              {' '}{[...new Set(result.skipped.map((s) => s.reason))].join('; ')}.
            </p>
          )}
          {state.ms && <div className="flex justify-between text-[11.5px] py-[3px] text-muted"><span>Took</span><b className="text-ink tabular-nums">{(state.ms / 1000).toFixed(1)}s</b></div>}
          {/* BACK TO THE RULE. The only edit this pass produces that a person
              made rather than a rule derived, so it is the only one there is
              anything to undo. Offered on the whole space rather than per run,
              because the runs are no longer listed — and because somebody who
              wants one back usually wants all of them back. */}
          {trimmedRuns.length > 0 && onResetLengths && (
            <button className={BTN_BASE + ' ' + BTN_DEFAULT + ' mt-1.5 w-full'}
              onClick={onResetLengths}>
              Reset {trimmedRuns.length} length{trimmedRuns.length === 1 ? '' : 's'} set by hand
            </button>
          )}
          <button className={BTN_BASE + ' ' + BTN_DEFAULT + ' mt-1.5 w-full'} onClick={onClear}>
            Clear these wall features
          </button>
        </div>
      )}
    </div>
  );
}
