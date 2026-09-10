import React from 'react';
import { BEAM_ANGLES } from '../lib/cob.js';
import StageBar from './StageBar.jsx';

/* ---------------------------------------------------------------------------
   ModuleSpec — WHAT THE NEXT MODULE WILL BE, WHILE YOU ARE DECIDING WHERE ON
   THE RUN IT GOES.

   IT IS CobSpec's ARGUMENT SAID ABOUT A MODULE, and the argument is worth
   repeating rather than assuming: a specification chosen AFTER the fitting is
   on the drawing is a specification chosen in the right-hand panel, about a
   fitting somebody has already stopped looking at. A diffuser clipped onto a
   profile is a decision about that profile — three 18 W bodies or six 5 W stubs
   is the difference between two runs, not two rows in a schedule — so the two
   figures have to be in front of you at the moment of the press.

   AND IT IS NOT CobSpec. The two bars are the same shape and answer different
   questions: the downlight's wattage is a RANGE somebody sweeps (3 to 55 whole
   watts, hence a slider) and the engine has an opinion about it at the point
   under the cursor (hence the Recommended chip and the two "update" buttons);
   a track module is sold at three or five figures and nothing recommends one,
   because the allocator solves for a wattage only when it fills a whole run at
   once. Parameterising that component into answering both would be a component
   carrying a flag per difference — see the note on RailCell in ToolRail, which
   is the same call made about the same kind of near-miss.

   THE OPTIC ONLY WHERE THERE IS ONE. A diffuser is a lens over a linear board:
   it has no reflector to choose, and a row of beam angles on its bar would be a
   control offering something the product does not have. `beam` being null is
   what says so — see TRACK_MODULES.

   WHAT IS NOT HERE: A TICK AND A CROSS. The downlight bar carries them because
   a run of manual COBs is a batch somebody may throw away whole; a module is
   real the moment it is clicked, exactly as it was before this bar existed, and
   the way to remove one is to select it and press Delete. Offering a "discard"
   that had nothing to discard would be a button about a state this tool does
   not have.
   --------------------------------------------------------------------------- */

/* THE CAPTION, THE CHIPS AND THE RULE ARE CobSpec's, DELIBERATELY AND EXACTLY.
   The two bars stand in the same place, one at a time, and a chip that latched
   differently here would say the two were different kinds of control. */
const CAP = 'text-[10.5px] leading-none tracking-[0.02em] text-black/55 px-1.5 select-none';
const SEP = <span className="w-px h-5 bg-black/10 mx-1" aria-hidden="true" />;

/* `flex-none whitespace-nowrap` — see the note on CobSpec's CHIP, which this is
   a copy of. Nothing on this bar is wide enough to have shown it yet; the rule
   travels with the shape so the next label added here cannot. */
const CHIP = 'flex-none whitespace-nowrap '
  + 'px-[6px] py-[4px] text-[10.5px] rounded-[6px] border cursor-pointer '
  + 'tabular-nums leading-none transition-colors duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';
const CHIP_OFF = `${CHIP} text-black/70 border-transparent bg-transparent hover:bg-black/[0.07]`;
const CHIP_ON = `${CHIP} text-white border-black bg-black hover:bg-black`;

/**
 * `label` is the module's own name, which is the one word on this bar that is
 * not a control: with the flyout closed behind a rail cell it is the only thing
 * on screen saying WHICH of the three is armed.
 *
 * `wattList` is the family's range — see `moduleWattList` — and `beam` is null
 * for a module that has no optic to choose.
 */
export default function ModuleSpec({
  /* `lead` IS THE BAR'S NEAR END and `tail` its far one, both there whatever
     the middle is doing — see StageBar's three slots. */
  stage, lead = null, tail = null, label,
  watts, wattList = [], beam = null, onWatts, onBeam,
}) {
  return (
    <StageBar stage={stage} lead={lead} tail={tail} label={label}>
      <span className={CAP}>{label}</span>
      {SEP}

      {/* --- THE WATTAGE, AS THE FIGURES IT IS SOLD AT ----------------------
          CHIPS AND NOT THE DOWNLIGHT'S SLIDER, and the reason is the product:
          a track diffuser comes at 5, 10 and 18 W because the body grows with
          the output (see DIFFUSER_LENGTHS_MM), so 11 W is not a quieter version
          of 12 — it is nothing anybody can buy. A slider over three real
          figures would invite fifty-odd presses that all had to be rounded
          away. */}
      <span className={CAP}>Wattage</span>
      {wattList.map((w) => (
        <button key={w} type="button" aria-pressed={watts === w}
          className={watts === w ? CHIP_ON : CHIP_OFF}
          onClick={() => onWatts?.(w)}>{w} W</button>
      ))}

      {beam != null && (<>
        {SEP}
        <span className={CAP}>Beam</span>
        {BEAM_ANGLES.map((d) => (
          <button key={d} type="button" aria-pressed={beam === d}
            className={beam === d ? CHIP_ON : CHIP_OFF}
            onClick={() => onBeam?.(d)}>{d}°</button>
        ))}
      </>)}
    </StageBar>
  );
}
