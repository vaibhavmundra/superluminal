import React from 'react';

/* ---------------------------------------------------------------------------
   THE READING. Four figures and a verdict, and it is an instrument panel.

   IT IS THE ONE THING SOMEBODY IS WATCHING WHILE THEY WORK. Every other line in
   this panel is a control or a note; this is the number the controls are being
   moved to change. Two 11.5px rows of grey type reported it in the same voice as
   the wattage beside them, which made the answer the quietest thing on the
   screen — so ACHIEVED is 52px of seven-segment digits and the rest is the
   working. See `--font-lcd` in styles.css for what the face is for.

   REQUIRED IS ABOVE IT AND SMALL, which is the right way round: a target is read
   once and a reading is watched. The big figure is only meaningful against it,
   so it is on screen — not so loud that the two compete.

   --- AND THE TOTAL IS SPLIT INTO THE LAYERS THAT MAKE IT --------------------
   A ROOM THAT REACHES ITS NUMBER ON SPOTS IS NOT A LIT ROOM. That is the whole
   reason the split is drawn: 4,285 lumens of task light and 3,000 of ambient
   adds up to a room over its target and reads, correctly, as a room lit wrongly.
   Nothing but the two figures side by side says that.

   THE SPLIT IS NOT THIS FILE'S ARITHMETIC — `byLayer` arrives on the analysis
   and is `achieved` broken up, always summing back to it. See lib/lumens.js.

   ACCENT IS DRAWN ONLY WHEN THERE IS SOME, and that is not a tidying-up: it is
   what keeps the three printed lines adding up to the big one. A room with a
   shelf strip in it has a third contribution, and hiding it would make the
   readout's own arithmetic wrong by the amount of the thing being hidden.

   --- THE VERDICT IS ABOUT THE BALANCE, NOT THE TOTAL -----------------------
   LOW MEANS THE AMBIENT LAYER IS NOT CARRYING THE ROOM, judged against what the
   ROOM needs rather than against what it got — see AMBIENT_SHARE_MIN. Whether
   the total is met is already said, in colour, by the big figure itself.

   JUDGED ON THE ROUNDED FIGURES, both of them, so the badge can never contradict
   the digits printed above it. The same rule the whole-plan readout follows.
   --------------------------------------------------------------------------- */

/* HOW MUCH OF A ROOM'S REQUIREMENT THE AMBIENT LAYER HAS TO CARRY BEFORE THE
   SCHEME IS SOUND. 0.7 is a working figure, not a standard — turn it up to
   demand a scheme that is mostly ambient, down to allow a heavily task-lit room
   to pass. It is measured against REQUIRED and not against ACHIEVED on purpose:
   against achieved, a room with ample ambient light would be marked LOW the
   moment somebody added spots to it, which is the opposite of the advice. */
export const AMBIENT_SHARE_MIN = 0.7;

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
   Overtime, which happens to ship an ss01 of its own for its own reasons, would
   quietly render somebody else's alternates. Reset wherever this face is asked
   for. `tabular-nums` is a different property and is unaffected. */
const LCD = "font-lcd tabular-nums [font-feature-settings:normal]";
const FIG = `${LCD} text-[13px] text-text shrink-0`;

export default function Lumens({ analysis }) {
  const { required, achieved, byLayer } = analysis;
  const { ambient = 0, task = 0, accent = 0 } = byLayer ?? {};

  const met = Math.round(achieved) >= Math.round(required);
  const low = Math.round(ambient) < Math.round(required) * AMBIENT_SHARE_MIN;

  return (
    <div className="rounded-lg bg-surface px-4 py-3.5">
      <div className={ROW}>
        <span className={LBL}>Lumens required</span>
        <span className={FIG}>{lm(required)}</span>
      </div>

      {/* --- THE READING ---------------------------------------------------
          RIGHT-ALIGNED, because it is a figure in a column of figures: the
          three lines under it are right-aligned and a 52px number starting
          from the left would be the one thing on the card off the grid.
          GREEN OR RED IS THE WHOLE OF "IS THERE ENOUGH LIGHT". Colour on the
          number itself rather than a sentence beneath it — the reading and the
          verdict on it are one fact, and this panel has room for one loud
          thing. `aria-label` because a colour is not readable aloud. */}
      <div className="mt-1.5 mb-3 text-right">
        <div aria-label={`${lm(achieved)} lumens achieved,`
          + ` ${met ? 'requirement met' : 'below requirement'}`}
          className={`${LCD} text-[52px] leading-[0.92] tracking-[0.01em] `
            + (met ? 'text-lcd' : 'text-danger')}>
          {lm(achieved)}
        </div>
        <div aria-hidden="true"
          className={'text-[9px] tracking-[0.18em] uppercase leading-none mt-1 '
            + (met ? 'text-lcd/50' : 'text-danger/60')}>
          Achieved
        </div>
      </div>

      {/* --- WHAT IT IS MADE OF, LAYER BY LAYER ---------------------------- */}
      <div className={ROW}>
        <span className={LBL}>Ambient lights contribution</span>
        <span className={FIG}>{lm(ambient)}</span>
      </div>
      <div className={ROW}>
        <span className={LBL}>Task lights contribution</span>
        <span className={FIG}>{lm(task)}</span>
      </div>
      {Math.round(accent) > 0 && (
        <div className={ROW}>
          <span className={LBL}>Accent lights contribution</span>
          <span className={FIG}>{lm(accent)}</span>
        </div>
      )}

      {/* --- AND WHETHER THE AMBIENT LAYER IS DOING ITS JOB -----------------
          A BADGE ON ITS OWN LINE, above a rule, because it is a judgement OF
          the three lines above rather than a fourth reading. It is stated in
          both directions: a verdict that only ever appears when something is
          wrong is a verdict you cannot trust the absence of. */}
      <div className="flex items-center justify-between gap-3 mt-3 pt-3
        border-t border-white/10">
        <span className={LBL}>Ambient lights contribution is</span>
        <span className={'text-[9.5px] tracking-[0.12em] uppercase leading-none '
          + 'px-2 py-[5px] rounded shrink-0 '
          + (low ? 'bg-danger text-white' : 'bg-lcd text-ink')}>
          {low ? 'Low' : 'Ok'}
        </span>
      </div>
    </div>
  );
}
