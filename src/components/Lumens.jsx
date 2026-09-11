import React from 'react';

/* ---------------------------------------------------------------------------
   THE READING. Four figures, and it is an instrument panel.

   IT IS THE ONE THING SOMEBODY IS WATCHING WHILE THEY WORK. Every other line in
   this panel is a control or a note; this is the number the controls are being
   moved to change. Two 11.5px rows of grey type reported it in the same voice as
   the wattage beside them, which made the answer the quietest thing on the
   screen — so ACHIEVED is 52px of seven-segment digits and the rest is the
   working. See `--font-lcd` in styles.css for what the face is for.

   REQUIRED IS ABOVE IT AND SMALL, which is the right way round: a target is read
   once and a reading is watched. The big figure is only meaningful against it,
   so it is on screen — not so loud that the two compete.

   --- AND THE TOTAL IS SPLIT IN TWO -----------------------------------------
   A ROOM THAT REACHES ITS NUMBER ON DOWNLIGHTS IS NOT A LIT ROOM. That is the
   whole reason the split is drawn: 4,285 lumens of task light and 3,000 of
   ambient adds up to a room over its target and reads, correctly, as a room lit
   wrongly. Nothing but the two figures side by side says that.

   WHAT IS WASHING THE ROOM, AND WHAT IS BEING POINTED AT SOMETHING. That is the
   question, and it is now the same question the fixture list groups by: a sconce
   washes a wall and a pendant throws in every direction, while a recessed COB
   puts eighty percent of its output at the floor. There used to be a third layer
   — 'accent' — that this file folded into the ambient figure before printing it,
   so the reading and the grouping disagreed by one section. The layer has gone
   and the fold with it; see `layer` in lib/lumens.js for why.

   NEITHER FIGURE IS THIS FILE'S ARITHMETIC. `contributions` arrives on the
   analysis and is `achieved` broken in two, always summing back to it — see the
   note beside it in lib/lumens.js, which is also the one place that decides
   which layer feeds which figure.

   --- AND THERE IS NO VERDICT ON THE BALANCE --------------------------------
   THERE WAS ONE: a LOW/OK badge under a rule, firing when the ambient figure
   carried less than AMBIENT_SHARE_MIN of what the ROOM needed. It went when the
   split did and has not come back with it — the four figures are what was asked
   for, and a badge is a fifth thing that reads as a judgement rather than a
   reading. The ambient figure against `required` is the same fact, stated by
   two numbers somebody can compare themselves.

   JUDGED ON THE ROUNDED FIGURES, so the colour on the big number can never
   contradict the digits printed. The same rule the whole-plan readout follows.
   --------------------------------------------------------------------------- */

/* GROUPED THOUSANDS, PINNED TO en-US — the same rule and the same reason as in
   SpaceAnalysis: a lighting schedule is read by two people at once and a figure
   that groups as 12,34,567 on one machine is not the same number. */
const lm = (n) => Math.round(n).toLocaleString('en-US');

/* A LINE OF THE WORKING. Label left, figure right, and the figure is in the
   readout face — the small figures are the big one taken apart, so they are the
   same kind of number and read as one instrument rather than as a caption. */
const ROW = 'flex justify-between items-baseline gap-3 py-[3px]';
const LBL = 'text-[11.5px] text-faint leading-[1.5]';

/* THE FACE, AND THE ONE THING THAT HAS TO BE SWITCHED BACK OFF FOR IT. `body`
   turns on `ss01` for the whole app, because that is the stylistic set Neue
   Montreal wants (see styles.css) — and font features are inherited by NAME, so
   any face asked for here would quietly render somebody else's alternates if it
   happened to ship an ss01. Overtime did, which is why this reset arrived, and
   Digital-7 does not — so it is precautionary now rather than load-bearing. It
   stays: the cost is one declaration and the alternative is a readout whose
   digits change shape the day the face does. `tabular-nums` is a different
   property and is unaffected. */
const LCD = "font-lcd tabular-nums [font-feature-settings:normal]";
/* --- 16px AND 66px, AND THEY ARE 13 AND 52 SCALED BY THE FACE --------------
   THE FIGURES ARE SIZED TO THEIR DIGIT HEIGHT AND NOT TO THEIR EM. Every face
   spends a different share of the em on a digit, and this readout has now been
   set in two: Overtime's digits are 0.8240 em tall, Digital-7's are 0.6545, so
   the same `font-size` in the new face renders a quarter shorter. 13 and 52
   were chosen against Overtime and read small the moment the face changed.
   x1.2589 IS THE RATIO OF THOSE TWO HEIGHTS, which puts the digits back where
   they were rather than where a guess would land: 52 -> 65.5 -> 66px renders
   43.2px of digit against Overtime's 42.8, and 13 -> 16.4 -> 16px renders
   10.5px against 10.7. Both round to the nearest whole pixel, and 16 is the
   closer of the two candidates for the small one.
   SO A FACE SWAP MOVES THESE NUMBERS. If the readout is ever set in a third
   face, divide 42.8 by its digit height in em — that is what these are. */
const FIG = `${LCD} text-[16px] text-text shrink-0`;

export default function Lumens({ analysis }) {
  const { required, achieved, contributions } = analysis;
  const { ambient = 0, task = 0 } = contributions ?? {};

  const met = Math.round(achieved) >= Math.round(required);

  return (
    <div className="rounded-lg bg-surface px-4 py-3.5">
      <div className={ROW}>
        <span className={LBL}>Lumens required</span>
        <span className={FIG}>{lm(required)}</span>
      </div>

      {/* --- THE READING ---------------------------------------------------
          RIGHT-ALIGNED, because it is a figure in a column of figures: the
          three lines around it are right-aligned and a 52px number starting
          from the left would be the one thing on the card off the grid.
          GREEN OR RED IS THE WHOLE OF "IS THERE ENOUGH LIGHT". Colour on the
          number itself rather than a sentence beneath it — the reading and the
          verdict on it are one fact, and this panel has room for one loud
          thing. `aria-label` because a colour is not readable aloud. */}
      <div className="mt-1.5 mb-3 text-right">
        <div aria-label={`${lm(achieved)} lumens achieved,`
          + ` ${met ? 'requirement met' : 'below requirement'}`}
          className={`${LCD} text-[66px] leading-[0.92] tracking-[0.01em] `
            + (met ? 'text-lcd' : 'text-danger')}>
          {lm(achieved)}
        </div>
        <div aria-hidden="true"
          className={'text-[9px] tracking-[0.18em] uppercase leading-none mt-1 '
            + (met ? 'text-lcd/50' : 'text-danger/60')}>
          Achieved
        </div>
      </div>

      {/* --- WHAT IT IS MADE OF, AND THE TWO ADD BACK UP TO IT -------------
          NO THIRD LINE. There was an accent one, drawn only when there was
          something in it, on the reasoning that three printed figures had to add
          up to the big one. There is no third layer left to print — see the note
          at the top of this file. */}
      <div className={ROW}>
        <span className={LBL}>Ambient lights contribution</span>
        <span className={FIG}>{lm(ambient)}</span>
      </div>
      <div className={ROW}>
        <span className={LBL}>Task lights contribution</span>
        <span className={FIG}>{lm(task)}</span>
      </div>
    </div>
  );
}
