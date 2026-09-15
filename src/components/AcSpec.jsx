import React from 'react';
import StageBar from './StageBar.jsx';

/* ---------------------------------------------------------------------------
   AcSpec — HOW THE AIR-CONDITIONER IS FED, WHILE THE AIR-CONDITIONER IS IN HAND.

   IT IS FanSpec's AND PointSpec's ARGUMENT ABOUT THE TWO DECISIONS AN INDOOR
   UNIT CARRIES. A split unit is not specified by its size — that is a product
   fact and the catalogue holds it — it is specified by what feeds it: a socket
   a foot clear of the casing, or a point brought out behind it, and the rating
   the circuit is taken at. Those two are the whole of what the electrical
   drawing needs told about the unit, and they belong in front of you while the
   unit is the thing you are looking at.

   WHAT IS NOT HERE, AND IT IS THE POINT OF THE WHOLE FEATURE: A ROTATION. A
   wall unit faces into the room because the wall behind it does, so there is no
   angle to set and nothing to correct after a placement. The bar that would
   have carried a rotation control carries the thing somebody actually has to
   decide instead. See lib/wallUnit.js.

   NOR A POSITION, NOR A SIZE, NOR A BIN. The unit slides along its wall by
   being dragged and comes off the drawing by being selected and Deleted — both
   inherited, neither a form.
   --------------------------------------------------------------------------- */

/* THE CAPTION, THE CHIPS AND THE RULE ARE FanSpec's AND PointSpec's,
   DELIBERATELY AND EXACTLY. The bars stand in the same place, one at a time,
   and a chip that latched differently here would say this was a different kind
   of control. NOTHING WRITTEN HERE EVER WRAPS — the bar grows sideways and
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

/* THE RATING DROPDOWN IS PointSpec's, DOWN TO THE CLASS. Same control, same
   ground, same global-stylesheet overrides — see the long note there for why
   each of them is needed and why none of them needs `!important`. Two selects
   on two bars that stand in the same place have to be one control. */
const SELECT = 'flex-none w-auto appearance-none cursor-pointer backdrop-blur-none '
  + 'pl-[7px] pr-[17px] py-[4px] text-[10.5px] leading-none rounded-[6px] '
  + 'border border-black/[0.18] bg-transparent text-black/80 tabular-nums '
  + 'transition-colors duration-[120ms] '
  + 'hover:bg-black/[0.05] hover:border-black/[0.28]';

/**
 * `feed` is 'socket' or 'point' — which supply this unit has. `amps` is what
 * that supply is rated at.
 *
 * `ratings` is the COUNTRY's list WITH THE FLOOR ALREADY APPLIED — see
 * `acRatings`, which takes the 6A light switch out of India's four. It arrives
 * filtered rather than being filtered here because the floor is a fact about
 * air-conditioners and this is a row of buttons.
 *
 * `onFeed` AND `onAmps` BOTH WRITE THROUGH THE UNIT and not through the fitting
 * on the wall, which is what keeps the two in step: swapping the feed moves the
 * mark and carries the rating across, and neither is something this component
 * knows how to do. @see useAcFeed
 */
export default function AcSpec({
  stage, lead = null, tail = null, placement = 'bottom', label = 'Split AC',
  feed = 'socket', amps = null, ratings = [], onFeed, onAmps,
}) {
  return (
    <StageBar stage={stage} lead={lead} tail={tail} label={label}
      placement={placement}>
      <span className={CAP}>{label}</span>
      {SEP}

      {/* --- WHAT IT CONNECTS TO, AS TWO CHIPS AND NOT A DROPDOWN ----------
          TWO ANSWERS IS A ROW AND NOT A LIST. The whole argument for the
          rating's dropdown is that the country decides how many entries there
          are and the bar cannot know; there are exactly two ways to connect an
          air-conditioner and there always will be, so both are shown latched
          and the choice costs one press instead of two. It is the same shape
          the fan's sweeps take, for the same reason.
          "CONNECTION" AND NOT "FEED". The field and the constants are still
          `feed` — renaming a stored field is a change to saved plans for no
          gain — but nobody drawing a plan calls it that, and the word on the
          bar is the one that has to be theirs. */}
      <span className={CAP}>Connection</span>
      <button type="button" aria-pressed={feed === 'socket'}
        className={feed === 'socket' ? CHIP_ON : CHIP_OFF}
        onClick={() => onFeed?.('socket')}>Socket</button>
      <button type="button" aria-pressed={feed === 'point'}
        className={feed === 'point' ? CHIP_ON : CHIP_OFF}
        onClick={() => onFeed?.('point')}>Wall point</button>
      {SEP}

      <span className={CAP}>Switch</span>
      {/* THE CARET IS OURS AND SITS OVER THE BOX'S OWN RIGHT PADDING, so it
          cannot be clicked past — `pointer-events-none` leaves the whole
          control, caret included, one target that opens the list. */}
      <span className="relative inline-flex items-center">
        {/* NO "AUTO" HERE, WHICH IS THE ONE PLACE THIS DIFFERS FROM PointSpec.
            A point nobody has rated is switched at whatever a light is switched
            at in this country, and that is a real answer for a point. An
            air-conditioner has no such fallback: it is on its own circuit at a
            stated rating, always, and an entry meaning "whatever a light gets"
            would be the 6A specification error the floor exists to refuse. */}
        <select className={SELECT} aria-label="Switch rating"
          value={Number.isFinite(amps) ? String(amps) : ''}
          onChange={(e) => onAmps?.(Number(e.target.value))}>
          {ratings.map((a) => (
            <option key={a} className="text-black bg-white" value={a}>{a} A</option>
          ))}
        </select>
        <span aria-hidden="true"
          className="pointer-events-none absolute right-[6px] text-[8px]
            leading-none text-black/45">▼</span>
      </span>
    </StageBar>
  );
}
