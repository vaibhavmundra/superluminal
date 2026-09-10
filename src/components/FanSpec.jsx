import React from 'react';
import { FAN_SWEEPS } from '../lib/ceilingObjects.js';
import StageBar from './StageBar.jsx';

/* ---------------------------------------------------------------------------
   FanSpec — WHAT SIZE THE FAN IS, AT THE MOMENT THE FAN IS IN HAND.

   IT IS ModuleSpec's ARGUMENT ABOUT THE ONE PROPERTY A FAN HAS. A ceiling fan
   is bought by its sweep and by nothing else: 600 over a utility, 900 or 1050
   in a bedroom, 1200 in a living room. That is not a detail to tidy up
   afterwards — it is a foot and a half of diameter either way, it is the
   circle the downlight grid has to keep clear of (see `radiusFt` and the
   clearance the planner reserves), and it decides whether the ceiling has room
   for the fan AND a light beside it. A size that large a consequence has to be
   in front of you while you are choosing where the thing goes.

   IT WAS IN THE RIGHT-HAND COLUMN AND THAT IS WHY IT MOVED. The palette that
   placed a fan went to the rail; the sweep row stayed behind in the Design
   panel, which left the one property of the tool you are holding on the other
   side of the screen from the tool — and, once the drawer is closed over it,
   out of sight entirely. The same journey the downlight's wattage and the
   module's made, for the same reason and to the same place. There is no second
   copy of it in the panel: two controls for one decision is the mistake the
   retired "AC or trap door" chips made.

   ONE BAR AND TWO TENSES. Armed, it says what the NEXT fan will be; with a fan
   selected, it says what THAT fan is and changes it. The chips are the same
   either way because the question is — `setSweep` writes the standing choice
   and every selected fan at once, which is what makes the two tenses one
   control rather than two that happen to look alike.

   WHAT IS NOT HERE: A TICK, A BIN, OR A SECOND ROW. A fan is real the moment
   it is clicked and the way to remove one is to select it and press Delete,
   exactly as ModuleSpec argues. Its position, size beyond the sweep and
   rotation are handles on the object itself — a fan is a box on the drawing
   with grips, not a form.
   --------------------------------------------------------------------------- */

/* THE CAPTION, THE CHIPS AND THE RULE ARE ModuleSpec's, DELIBERATELY AND
   EXACTLY — which are CobSpec's before that. The three bars stand in the same
   place, one at a time, and a chip that latched differently here would say
   this was a different kind of control.

   AND NOTHING WRITTEN HERE EVER WRAPS. "Sweep (mm)" came out as two lines and
   made the whole bar taller, which moves every control on it sideways and up.
   The rule is enforced once, on StageBar's container, where `white-space`
   inherits down to every word any bar will ever hold — see the banner there.
   It is NOT restated on these classes, deliberately: a copy per label is a
   rule that lasts until the first label somebody forgets. What is on YOU when
   you add a word to this bar is that it be SHORT — the bar grows sideways and
   never downwards, so a long caption is paid for in width across the drawing. */
const CAP = 'text-[10.5px] leading-none tracking-[0.02em] text-black/55 px-1.5 select-none';
const SEP = <span className="w-px h-5 bg-black/10 mx-1" aria-hidden="true" />;

const CHIP = 'flex-none whitespace-nowrap '
  + 'px-[6px] py-[4px] text-[10.5px] rounded-[6px] border cursor-pointer '
  + 'tabular-nums leading-none transition-colors duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';
const CHIP_OFF = `${CHIP} text-black/70 border-transparent bg-transparent hover:bg-black/[0.07]`;
const CHIP_ON = `${CHIP} text-white border-black bg-black hover:bg-black`;

/**
 * `sweepMm` is the sweep in force — the selected fan's, or the standing choice
 * the next one will take. `sweeps` defaults to the catalogue's list; it is a
 * prop only so a test can drive the component without the catalogue.
 *
 * `lead` and `tail` are the bar's two standing ends, passed straight through —
 * see StageBar's three slots.
 */
export default function FanSpec({
  stage, lead = null, tail = null, label = 'Fan',
  sweepMm, sweeps = FAN_SWEEPS, onSweep,
}) {
  return (
    <StageBar stage={stage} lead={lead} tail={tail} label={label}>
      <span className={CAP}>{label}</span>
      {SEP}

      {/* --- THE SWEEP, AS THE SIZES IT IS SOLD AT -------------------------
          THE UNIT IS SAID ONCE, on the caption, and not four times on four
          chips. Four buttons reading "600 mm" through "1200 mm" spend a third
          of the bar's width restating something the row already establishes;
          `tabular-nums` is what keeps the bare figures in a straight line as
          they change. */}
      <span className={CAP}>Sweep (mm)</span>
      {sweeps.map((mm) => (
        <button key={mm} type="button" aria-pressed={sweepMm === mm}
          className={sweepMm === mm ? CHIP_ON : CHIP_OFF}
          onClick={() => onSweep?.(mm)}>{mm}</button>
      ))}
    </StageBar>
  );
}
