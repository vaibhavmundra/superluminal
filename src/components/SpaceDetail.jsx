import React, { useState } from 'react';
import { TONES, TONE_LABEL, CEILING_MM_MIN, CEILING_MM_MAX } from '../lib/materials.js';
import SpaceAnalysis from './SpaceAnalysis.jsx';

/* ---------------------------------------------------------------------------
   ONE SPACE, OPENED.

   The spaces list is a list and this is the room. Clicking a row REPLACES the
   list rather than expanding inside it, which is the one change that makes the
   panel readable: a room's height, its finishes and its illuminance are four
   decisions deep, and an accordion row holding them puts every other room on the
   plan between this one and the bottom of the screen.

   THE WAY BACK IS AT THE TOP AND IT IS THE FIRST THING. A view that replaces a
   list has to say what it replaced before it says anything about itself.

   --- WHAT IS ON SCREEN AT REST IS THE ANALYSIS -----------------------------
   THE HEIGHT AND THE FINISHES ARE SETTINGS: answered once, when a room is first
   looked at, and read many times after. The analysis is the opposite — it moves
   every time a fitting is placed, and it is what somebody comes back to this
   panel for. They had equal billing, three sections of similar height, and the
   thing that changes was below the fold on the two that do not.

   So the settings collapse to two lines and the analysis gets the column.

   THE MATERIALS ROW IS ITS OWN SUMMARY — "Default", or what differs; see
   `materialsSummary`. Under a dotted rule in the text's own colour, which is the
   oldest affordance there is for "this is a thing you can change" and costs no
   height at all, where a button would cost a whole row.

   AND OPENING IT REPLACES THE ANALYSIS RATHER THAN PUSHING IT DOWN. Setting the
   finishes is a job you finish; reading the level is a job you return to. Two
   jobs, one column, one at a time — the same trade the spaces list itself makes,
   and the reason this has a Done button rather than a disclosure triangle.
   --------------------------------------------------------------------------- */

const SEC = 'border-t border-border/10 pt-3.5 mt-3.5';
/* THE SETTINGS ROWS ARE TIGHTER THAN THE PANEL'S USUAL, and deliberately: they
   are two lines standing between the room's name and the thing the panel is for.
   `min-h` rather than padding, so a row is the height of the control in it
   rather than a pad around one. */
const ROW = 'flex items-center justify-between gap-2 min-h-[24px]';
const LBL = 'text-[11.5px] text-muted leading-[1.4]';
const VAL = 'text-[11.5px] text-text leading-[1.4] tabular-nums';

const BTN_SHAPE = 'leading-[1.5] rounded border cursor-pointer '
  + 'transition-colors duration-[120ms] disabled:opacity-[.45] '
  + 'disabled:cursor-not-allowed focus-visible:outline-2 '
  + 'focus-visible:outline-accent focus-visible:outline-offset-2';
const BTN_QUIET = 'bg-surface backdrop-blur-md text-white border-border/10 '
  + 'enabled:hover:bg-surface-2 enabled:hover:text-black enabled:hover:border-border-strong';
const BTN_FULL = `w-full text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_QUIET}`;
/* THE WAY OUT OF THE FINISHES, IN THE WHITE EVERY OTHER Done ON THIS SCREEN
   WEARS — the door step's, the zone step's, the wall step's. One idiom for "this
   job is finished". */
const BTN_DONE = `w-full text-[12px] px-3 py-[7px] ${BTN_SHAPE} `
  + 'bg-white text-black border-white hover:bg-text hover:border-text';
const BTN_BACK = 'border-0 bg-none text-[11.5px] text-subtle cursor-pointer p-0 '
  + 'inline-flex items-center gap-[6px] transition-colors duration-[120ms] '
  + 'hover:text-white';

/* A TONE CHIP. The same tile the property chips elsewhere in the panel wear —
   no ground at rest, the panel's own glass when it is the answer. */
const CHIP = 'px-[7px] py-[3px] font-sans text-[10px] rounded border cursor-pointer '
  + 'transition-colors duration-[120ms] disabled:opacity-[.45] '
  + 'disabled:cursor-not-allowed focus-visible:outline-2 '
  + 'focus-visible:outline-accent focus-visible:outline-offset-1';
const CHIP_OFF = `${CHIP} text-muted border-transparent enabled:hover:bg-white/5 `
  + 'enabled:hover:border-border/10';
const CHIP_ON = `${CHIP} text-text bg-white/5 border-border/10 backdrop-blur-md`;

function ToneRow({ label, value, onPick, disabled }) {
  return (
    <div className={`${ROW} mb-1.5`}>
      <span className={LBL}>{label}</span>
      <div className="flex gap-0.5 flex-none">
        {TONES.map((t) => (
          <button key={t} type="button" disabled={disabled}
            aria-pressed={value === t}
            className={value === t ? CHIP_ON : CHIP_OFF}
            onClick={() => onPick(t)}>{TONE_LABEL[t]}</button>
        ))}
      </div>
    </div>
  );
}

/** The height. A row and not a section: one number with one unit needs no
 *  heading over it — the field's label is the field. */
function HeightRow({ ceilingMm, onCeilingMm, disabled }) {
  /* THE FIELD HOLDS A DRAFT WHILE IT IS BEING TYPED IN, and that is not a
     nicety: the store clamps to a sane range, so a controlled input reading
     straight off it cannot be retyped. Select 2700, press 3, and the clamp turns
     it into 1500 before the second digit arrives. So the string somebody is
     typing lives here until they leave the field or press Enter. */
  const [draft, setDraft] = useState(null);
  return (
    <div className={ROW}>
      <label className={LBL} htmlFor="lp-ceiling-mm">Avg Ceiling Height</label>
      <span className="flex items-center gap-1.5 flex-none">
        <input id="lp-ceiling-mm" type="number" inputMode="numeric"
          disabled={disabled}
          min={CEILING_MM_MIN} max={CEILING_MM_MAX} step={50}
          value={draft ?? ceilingMm}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onCeilingMm(draft ?? ceilingMm); setDraft(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          /* SHORT AND SHALLOW: a fixed height rather than vertical padding, and
             the spinner suppressed. The arrows are twenty pixels of chrome on a
             field four digits wide, stepping a value nobody nudges — you type a
             ceiling height, you do not arrive at it. */
          className="w-[58px] h-[22px] text-right text-[11.5px] leading-none tabular-nums
            px-1.5 py-0 rounded border border-border/10 bg-input-bg text-text
            disabled:opacity-[.45] [appearance:textfield]
            [&::-webkit-outer-spin-button]:appearance-none
            [&::-webkit-inner-spin-button]:appearance-none
            focus-visible:outline-2 focus-visible:outline-accent
            focus-visible:outline-offset-1" />
        <span className="text-[10.5px] text-subtle">mm</span>
      </span>
    </div>
  );
}

export default function SpaceDetail({
  name, meta, ceilingMm, onCeilingMm, materials, materialsLabel, wallLabel,
  onTone, onConfigureWalls, onBack, analysis, onWatts,
  editing = false, onEdit, onDone, disabled = false,
}) {
  return (
    /* NO PADDING OF ITS OWN. The panel's scroller already sets the column's
       gutters; a second set here would indent this view a further 16px from
       every other thing the panel shows. */
    <div className="flex flex-col">
      <button type="button" className={`${BTN_BACK} self-start mb-3`} onClick={onBack}>
        <span aria-hidden="true">←</span> Back to Spaces
      </button>

      <div className="mb-3">
        <h2 className="m-0 text-[15px] leading-[1.3] tracking-[-0.02em] text-white
          overflow-hidden text-ellipsis">{name}</h2>
        {meta && <p className="m-0 mt-1 text-[10.5px] text-subtle tabular-nums">{meta}</p>}
      </div>

      {/* NO RULE BETWEEN THE NAME AND THE HEIGHT. A hairline there would be a
          separator between a thing and its own properties — the room's name and
          the room's height are one subject. The first rule in this column
          belongs where the subject actually changes, which is above the
          analysis. */}
      <HeightRow ceilingMm={ceilingMm} onCeilingMm={onCeilingMm} disabled={disabled} />

      {editing ? (
        <>
          <div className={`${ROW} mt-1 mb-1.5`}>
            <span className={LBL}>Materials</span>
          </div>
          <ToneRow label="Ceiling" value={materials.ceiling} disabled={disabled}
            onPick={(t) => onTone('ceiling', t)} />
          <ToneRow label="Floor" value={materials.floor} disabled={disabled}
            onPick={(t) => onTone('floor', t)} />
          {/* THE WALLS ARE A READING, NOT A CHOICE — there are four to a dozen of
              them and they are chosen on the drawing, one at a time. What sits
              here is what those choices came to. */}
          <div className={`${ROW} mb-1.5`}>
            <span className={LBL}>Walls</span>
            <span className={VAL}>{wallLabel}</span>
          </div>
          <button type="button" className={`${BTN_FULL} mt-2`} disabled={disabled}
            onClick={onConfigureWalls}>Configure walls</button>
          <button type="button" className={`${BTN_DONE} mt-1.5`}
            onClick={onDone}>Done</button>
        </>
      ) : (
        <>
          <div className={`${ROW} mt-0.5`}>
            <span className={LBL}>Materials</span>
            {/* THE DOTTED RULE IS THE AFFORDANCE, and `border-current` is what
                keeps it the text's own colour rather than a second one to keep
                in step. It costs no height, which is the whole reason this is a
                summary under a rule rather than a button on a row of its own. */}
            <button type="button" disabled={disabled}
              className="border-0 border-b border-dotted border-current bg-transparent
                p-0 pb-px text-[11.5px] leading-[1.4] text-muted cursor-pointer
                max-w-[62%] overflow-hidden text-ellipsis whitespace-nowrap
                transition-colors duration-[120ms] enabled:hover:text-white
                disabled:cursor-not-allowed
                focus-visible:outline-2 focus-visible:outline-accent
                focus-visible:outline-offset-2"
              title="Set what this space is finished in"
              onClick={onEdit}>{materialsLabel}</button>
          </div>

          {/* THE SECOND HALF READS THE FIRST. Every tone set above moves the
              number below it — that is the whole reason the finishes come first,
              and the reason both live on one screen rather than in two tabs. */}
          <div className={SEC}>
            <SpaceAnalysis analysis={analysis} onWatts={onWatts} disabled={disabled} />
          </div>
        </>
      )}
    </div>
  );
}
