import React from 'react';

/* ---------------------------------------------------------------------------
   IS THIS SPACE BRIGHT ENOUGH, AND WHAT IS MAKING IT SO.

   TWO NUMBERS AND THEN THE WORKING. Required and achieved are the answer and go
   first; the fittings under them are why.

   WHAT A ROW IS DEPENDS ON WHAT THE FITTING IS, and lib/lumens.js decides it —
   this file draws whatever it is handed. Anything sold by the METRE gets a row
   of its own per run, because a length of tape is a thing you point at and
   specify on its own: a bedroom's perimeter cove and the drop over the bed are
   two runs at two wattages. Anything sold by the piece gets one row for the lot,
   because twelve COBs are one decision about COBs and twelve identical lines is
   a list nobody reads.

   THE WATTAGE IS CHOSEN HERE AND NOWHERE ELSE, which is what makes the section
   worth having. Every other readout in this app reports; this one reports and
   then hands you the one control that moves the number, beside the number. Press
   9W/m on the cove and the contribution, the total and the verdict all move
   together.

   THE ARITHMETIC IS NOT IN THIS FILE. It is all in lib/lumens.js, along with
   every constant it reads — this draws what that returns. See the header there
   for the model.
   --------------------------------------------------------------------------- */

const H3 = 'mt-0 mx-0 mb-2.5 text-[10px] tracking-[0.11em] uppercase text-subtle';
const KV = 'flex justify-between items-baseline gap-2 text-[11.5px] py-[3px] '
  + 'tabular-nums [font-variant-numeric:tabular-nums]';
const LBL = 'text-muted';
const N = 'text-[11.5px] text-muted leading-[1.5]';

const CHIP = 'px-[6px] py-[2px] font-sans text-[10px] rounded border cursor-pointer '
  + 'tabular-nums transition-colors duration-[120ms] disabled:opacity-[.45] '
  + 'disabled:cursor-not-allowed focus-visible:outline-2 '
  + 'focus-visible:outline-accent focus-visible:outline-offset-1';
const CHIP_OFF = `${CHIP} text-muted border-transparent enabled:hover:bg-white/5 `
  + 'enabled:hover:border-border/10';
const CHIP_ON = `${CHIP} text-text bg-white/5 border-border/10 backdrop-blur-md`;

/* GROUPED THOUSANDS, AND THE GROUPING IS PINNED. `toLocaleString()` with no
   argument follows the browser, so the same plan reads 1,469 on one machine and
   1,469 on another but 12,34,567 against 1,234,567 the moment a figure gets
   large. A lighting schedule is read by two people at once; the number has to
   be the same number. */
const lm = (n) => Math.round(n).toLocaleString('en-US');

/** How much of a family there is, in the unit it is bought in. Feet, because
 *  every other length in this panel is feet — the metres the arithmetic runs on
 *  are lib/lumens.js's business, not the reader's. */
const quantity = (row) => (row.unit === 'm'
  ? `${Math.round(row.lengthFt)} ft`
  : `${row.count}`);

export default function SpaceAnalysis({ analysis, onWatts, disabled = false }) {
  const { required, achieved, rows, ok, shortfall } = analysis;

  return (
    <>
      <h3 className={H3}>Analysis</h3>

      <div className={KV}>
        <span className={LBL}>Ambient lumens required</span>
        <span className="text-text">{lm(required)}</span>
      </div>
      <div className={KV}>
        <span className={LBL}>Ambient lumens achieved</span>
        <span className="text-text">{lm(achieved)}</span>
      </div>

      {/* THE VERDICT IS COMPUTED AND NOT ASSERTED, and it is judged on the
          ROUNDED figures so it can never contradict the two lines above it — the
          same rule the whole-plan readout in the footer follows. */}
      {rows.length === 0 ? (
        <p className={`${N} mt-2`}>No lights placed in the room.</p>
      ) : ok ? (
        <p className={`${N} mt-2`}>The space has sufficient ambient illumination.</p>
      ) : (
        <p className="text-[11.5px] leading-[1.5] text-muted border-l-2
          border-border-strong pl-[9px] mt-2">
          {lm(shortfall)} lumens short.
        </p>
      )}

      {/* --- WHAT IS MAKING IT SO, FAMILY BY FAMILY ------------------------
          A rule above each rather than a card round each: these are readings of
          one room, not four objects, and four boxes in a 340px column would read
          as four subjects. */}
      {rows.map((row) => (
        <div key={row.key} className="border-t border-border/10 pt-2.5 mt-2.5">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[11.5px] text-text leading-[1.4]">{row.label}</span>
            <span className="text-[10.5px] text-subtle tabular-nums">{quantity(row)}</span>
          </div>
          {/* ONE OPTION IS NOT A CHOICE, SO IT IS NOT DRAWN AS ONE. A sconce is
              specified at 7 W and nothing else — see SCONCE_WATTS — and a single
              latched chip is a control that cannot do anything, which is worse
              than no control: it invites the press that changes nothing. The
              figure still has to be on screen, because it is what the
              contribution below is computed from, so it is printed. */}
          {row.wattOptions.length < 2 ? (
            <div className={KV}>
              <span className={LBL}>Wattage</span>
              <span className="text-text">
                {row.watts} W{row.unit === 'm' ? '/m' : ''}
              </span>
            </div>
          ) : (
            <div className="flex gap-0.5 flex-wrap mb-1">
              {row.wattOptions.map((w) => (
                <button key={w} type="button" disabled={disabled}
                  aria-pressed={row.watts === w}
                  className={row.watts === w ? CHIP_ON : CHIP_OFF}
                  onClick={() => onWatts(row, w)}>
                  {w}W{row.unit === 'm' ? '/m' : ''}
                </button>
              ))}
            </div>
          )}
          <div className={KV}>
            <span className={LBL}>Contribution</span>
            <span className="text-text">{lm(row.netLumens)} lm</span>
          </div>
        </div>
      ))}
    </>
  );
}
