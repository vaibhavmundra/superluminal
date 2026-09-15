import React from 'react';
import StageBar from './StageBar.jsx';
import { HeightField } from './SwitchboardCard.jsx';

/* ---------------------------------------------------------------------------
   PointSpec — HOW HIGH THE POINT IS AND WHAT SWITCHES IT, WHILE IT IS IN HAND.

   IT IS FanSpec's ARGUMENT ABOUT THE TWO PROPERTIES A POINT HAS. A point is a
   cable brought out and left, and the whole of what site needs told about it is
   the height it comes out at and the rating it is switched at. Neither is a
   detail to tidy up afterwards: 1800 and 2200 are a geyser and an exhaust, and
   6A and 20A are a light switch and an appliance one. Those belong in front of
   you while you are choosing where the thing goes.

   IT IS ALWAYS ABOUT A POINT THAT EXISTS. Placing one SELECTS it — the sconce's
   own behaviour — so the bar is showing the thing that just landed rather than a
   standing choice for the next one. That is what lets the height be a typed
   number: there is a record to write it to, always, and no second place for the
   figure to live.

   THE HEIGHT FIELD IS THE WALL POINT'S ALONE, and its absence on a ceiling point
   is the statement. There is one height a point on a ceiling can be at, so a box
   there would be a control with one answer. See `heightOfPoint`.

   WHAT IS NOT HERE: A TICK, A BIN, OR A POSITION. A point is real the moment it
   is clicked and the way to remove one is to select it and press Delete — it is
   on the point primitive, so Delete, Option-copy and the drag all come from
   there and none of them is a form. See lib/point.js.
   --------------------------------------------------------------------------- */

/* THE CAPTION AND THE RULE ARE FanSpec's, DELIBERATELY AND EXACTLY — which are
   ModuleSpec's and CobSpec's before that. The bars stand in the same place, one
   at a time, and a control that read differently here would say this was a
   different kind of bar. NOTHING WRITTEN HERE EVER WRAPS: the bar grows sideways
   and never downwards, so a long caption is paid for in width across the
   drawing. */
const CAP = 'text-[10.5px] leading-none tracking-[0.02em] text-black/55 px-1.5 select-none';
const SEP = <span className="w-px h-5 bg-black/10 mx-1" aria-hidden="true" />;

/* --- THE INK FOR A FIELD THAT WOULD OTHERWISE INHERIT WHITE ----------------
   THE BAR IS A WHITE PILL AND THE PAGE'S `--text` IS WHITE. `HeightField`
   defaults to `currentColor`, which is correct on the near-black panel and the
   sheet it was written for and invisible here — the field shipped into this bar
   as a blank gap between two captions, with the number, the unit and the rule
   under it all painted white on white. Every other thing on this bar states a
   black ink for the same reason; this one has to be handed one because the
   control is shared. @see HeightField */
const INK = 'rgb(0 0 0 / 0.75)';

/* --- ...AND THE RATING, AS ONE CONTROL RATHER THAN A ROW OF FIVE -----------
   A DROPDOWN AND NOT CHIPS, AND THE COUNTRY IS WHY. The ratings are a list that
   belongs to the country — 6/16/20/32 in India, 15/20 in the United States, and
   a fifth number the day one is added to `switchRatings` — so the control has to
   hold a list of unknown length without taking the width of the bar. Five chips
   for India is already a third of the row; the same row said in one collapsed
   box is the whole of what a select is for. The chips remain the right shape for
   a fan's four sweeps, which is a fixed catalogue of four.

   `appearance-none` AND THE GLOBAL RULE IS WHY. styles.css dresses every
   `select` on this page for the dark panels — full width, a dark ground and
   white text — and a plain one dropped here would be a black bar across a white
   pill. The caret is drawn beside it rather than left to the UA, because the
   native one comes with the chrome this is removing.

   THE OPTIONS ARE STATED IN BLACK ON WHITE. The popup is the system's and takes
   its own colours on macOS, but not everywhere: without these the list inherits
   the page's white text and one platform's menu is blank.

   EVERY ONE OF THESE UTILITIES WINS OVER THAT SHEET, and not by specificity:
   styles.css is wrapped in `@layer base` precisely so that Tailwind's
   `@layer utilities` always outranks it — read the banner above its `@layer base
   {` for what that cost to learn. So the overrides below are ordinary classes
   and none of them needs `!important`.
   WHICH IS ALSO WHY THE HOVER BORDER IS STATED. The sheet's own
   `select:hover{border-color:...}` is a pale grey for a dark panel, and this
   control's plain `border-black` beats it outright — so without a `hover:` class
   the border would simply never respond. `backdrop-blur-none` is a real override
   in the same way: the global rule blurs what is behind the box, which here is
   the white bar itself.

   THE FOCUS RING IS THE APP'S AND IS LEFT ALONE — `input:focus,select:focus` in
   styles.css draws the accent halo every other select on this screen gets. A
   second black outline of this bar's own would be two rings on one control. */
const SELECT = 'flex-none w-auto appearance-none cursor-pointer backdrop-blur-none '
  + 'pl-[7px] pr-[17px] py-[4px] text-[10.5px] leading-none rounded-[6px] '
  + 'border border-black/[0.18] bg-transparent text-black/80 tabular-nums '
  + 'transition-colors duration-[120ms] '
  + 'hover:bg-black/[0.05] hover:border-black/[0.28]';

/** "Auto" is a real answer and cannot be an absence — see the note at the call. */
const AUTO = 'auto';

/**
 * `onWall` decides whether the height row is drawn at all — see the note above.
 * `heightMm` and `amps` are the values in force: the selected point's, or the
 * standing choice the next one will take.
 *
 * `ratings` is the COUNTRY's list and is a prop rather than an import, because
 * 6/16/20/32 is India's answer and 15/20 is the United States'. It must be the
 * RESOLVED country's `switchRatings` — App's own `country` prop is an ISO code
 * or a name, and reaching for `.switchRatings` on a string is how this arrived
 * showing nothing but Auto. @see sbCountry
 *
 * `amps === null` means "whatever a light is switched at here", which is a real
 * state and takes its own entry rather than being drawn as nothing selected.
 */
export default function PointSpec({
  stage, lead = null, tail = null, placement = 'bottom',
  onWall = true, heightMm, amps = null, ratings = [], onHeight, onAmps,
}) {
  const label = onWall ? 'Wall point' : 'Ceiling point';
  return (
    <StageBar stage={stage} lead={lead} tail={tail} label={label}
      placement={placement}>
      <span className={CAP}>{label}</span>
      {SEP}

      {onWall && (
        <>
          {/* AN INPUT AND NOT CHIPS, WHICH IS THE SWITCHBOARD'S OWN CONTROL —
              `HeightField`, imported rather than reimplemented. The height of a
              point is a DECISION and not a choice from a list: 1800 for a
              geyser, 2150 for one particular chimney hood, whatever the joinery
              drawing says. A row of six chips answers six of those and makes
              every other number unreachable, which is a control that refuses
              the commonest case.
              TWO NUMBER BOXES FOR ONE NUMBER IS TWO PLACES for the step, the
              units and the empty-string rule to drift, which is exactly why
              that component is exported.
              THE CAPTION SAYS WHAT THE BOX IS AND THE FIELD SAYS WHAT THE
              NUMBER MEANS. "Height" alone is a figure with no datum — 1800 from
              the floor and 1800 from the ceiling are different holes in
              different walls — so the field keeps its own "mm above FFL", which
              is the same wording the panel and the sheet print for the same
              number. The unit is said once, beside the box, which is FanSpec's
              rule about a caption said once rather than on every chip. */}
          <span className={CAP}>Height</span>
          <HeightField mm={heightMm} ink={INK} onChange={(mm) => onHeight?.(mm)} />
          {SEP}
        </>
      )}

      <span className={CAP}>Switch</span>
      {/* THE CARET IS OURS AND SITS OVER THE BOX'S OWN RIGHT PADDING, so it
          cannot be clicked past — `pointer-events-none` leaves the whole
          control, caret included, one target that opens the list. */}
      <span className="relative inline-flex items-center">
        <select className={SELECT} aria-label="Switch rating"
          value={amps == null ? AUTO : String(amps)}
          onChange={(e) => onAmps?.(e.target.value === AUTO ? null : Number(e.target.value))}>
          {/* "AUTO" IS A REAL ANSWER AND NOT AN ABSENCE. A point nobody has
              rated is switched at whatever a light is switched at in this
              country — 6A in India, 15A in the United States — and that is a
              decision the drawing carries, so it is an entry in the list rather
              than an empty box. It is FIRST because it is what a point is born
              with. */}
          <option className="text-black bg-white" value={AUTO}>Auto</option>
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
