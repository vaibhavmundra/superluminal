import React, { useEffect, useRef, useState } from 'react';
import { AUTOPLACE_AT_FRACTION, BEAM_ANGLES, COB_WATT_RANGE } from '../lib/cob.js';

/* ---------------------------------------------------------------------------
   IS THIS SPACE BRIGHT ENOUGH, AND WHAT IS MAKING IT SO.

   THE READOUT AND THEN THE WORKING. The answer — required, achieved and the two
   figures it is made of — is Lumens.jsx, at the top; the fittings under it are
   why. It moved out because it stopped being two lines of type and became an
   instrument.

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

   ...AND ONE THING SOLD BY THE PIECE BREAKS THAT RULE, WHICH IS WORTH STATING
   RATHER THAN DISCOVERING. A COB somebody placed by hand gets a row of its own.
   It is not an exception to the argument above, it is the argument: twelve grid
   COBs are one decision about COBs because the ENGINE made it once, for all of
   them, off the catalogue. A lamp put down by hand was specified as it was put
   down — that is the whole point of the bar on the drawing — so it is a thing
   you point at and specify on its own, exactly as a length of tape is.

   --- AND THE ROWS ARE IN THREE SECTIONS, WHICH IS A LIGHTING SCHEME ---------
   AMBIENT, TASK, ACCENT — the three layers every lighting designer works in, and
   the order they are worked in. What lights the room, what lights the thing you
   are doing, what lights the thing you are looking at. A flat list of eight rows
   is a parts list; these three headings are the design.

   WHICH LAYER A ROW IS IN IS NOT THIS FILE'S TO DECIDE — `row.layer` arrives
   with it, and lib/lumens.js says why a family has one and how a row overrides
   it. Worth knowing here: the two coves are AMBIENT, both of them; the recessed
   COB is TASK, grid and hand-placed alike, because it is a downlight; and a
   directional spot and an art spot are the same FAMILY in two different
   layers.

   A SECTION WITH NOTHING IN IT IS NOT DRAWN, with one exception. An empty
   heading is a promise of rows that are not there — except Ambient, which
   carries the autoplace toggle: that switch is how a space with no lamps in it
   GETS some, so hiding it until there are some would be hiding the control
   behind its own effect.

   THESE THREE SECTIONS ARE THE SCHEME; THE READOUT'S TWO FIGURES ARE THE
   READING. Both come off the same `layer` on the same rows, and they are not the
   same split: the readout folds ACCENT in with AMBIENT, because a sconce washing
   a wall puts its light in the room exactly as a cove does, where a downlight
   puts eighty percent of it at the floor. So this file groups by what a fitting
   is FOR and Lumens.jsx reads by where the light GOES. See `contributions` in
   lib/lumens.js, which is the one place that fold happens.
   THE TOTAL STILL COUNTS EVERYTHING. A room lit largely by its downlights is a
   lit room, and an achieved figure that ignored them would report a shortfall
   nobody could act on. What such a room shows is a low AMBIENT figure beside a
   met total, which is the part somebody can act on.

   --- AND A ROW IS CLOSED UNTIL IT IS ASKED ABOUT ----------------------------
   EACH FIXTURE IS ITS NAME UNTIL YOU CLICK IT. The controls under a row — a
   slider, eight beam chips, a wattage row, a contribution — are four lines
   apiece, and this panel now lists every length of tape and every lamp somebody
   placed separately. Open, a bedroom with a cove and nine placed COBs is fifty
   lines of controls nobody is currently using, and the three section headings
   that are the actual structure are pushed off the screen. Closed, the same room
   is a dozen lines you can read at a glance, and the one row you came for is one
   press away.

   THE QUANTITY STAYS ON THE CLOSED LINE and the rest does not. It is part of
   what the row IS — "Cove, 32 ft" — where a wattage is a decision about it.

   ...AND THE SELECTED FITTING'S ROW OPENS ITSELF AND SCROLLS INTO VIEW. Clicking
   a lamp on the drawing is a question, this panel is the answer, and an answer
   that is closed or below the fold has not been given. `highlight` is what
   arrives — see `analysisHighlight` in App.jsx for why it is a list of row keys
   rather than a fitting id — and the effect below opens those rows and brings
   the first of them into the panel's own scroller.

   WHAT IT MUST NOT DO IS CLOSE ANYTHING. Opening a row is the panel answering a
   question; closing one somebody opened by hand, because they then clicked a
   different lamp, is the panel taking something away that was not its to take.

   THE ARITHMETIC IS NOT IN THIS FILE. It is all in lib/lumens.js, along with
   every constant it reads — this draws what that returns. See the header there
   for the model.
   --------------------------------------------------------------------------- */

const H3 = 'mt-0 mx-0 mb-2.5 text-[10px] tracking-[0.11em] uppercase text-subtle';
const KV = 'flex justify-between items-baseline gap-2 text-[11.5px] py-[3px] '
  + 'tabular-nums [font-variant-numeric:tabular-nums]';
const LBL = 'text-muted';

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

/* THE THREE LAYERS, IN THE ORDER A SCHEME IS DESIGNED IN. `always` is the one
   that draws its heading with nothing under it — see the note above. */
const LAYERS = [
  { id: 'ambient', label: 'Ambient', always: true },
  { id: 'task', label: 'Task lights' },
  { id: 'accent', label: 'Accent' },
];

/* THE SECTION HEADING. Smaller and quieter than the panel's own `Analysis`
   heading, because these sit UNDER it — three headings at one weight would read
   as three panels rather than as one panel's parts. */
const SEC_H = 'text-[10px] tracking-[0.11em] uppercase text-subtle leading-none';

/* THE CHEVRON. Rotated rather than swapped for a second glyph, so the mark
   itself carries the state — a control that changes shape reads as two
   controls. */
const Caret = ({ open }) => (
  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
    className={'shrink-0 transition-transform duration-[120ms] '
      + (open ? 'rotate-90' : '')}
    fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 1.5 L7 5 L3.5 8.5" />
  </svg>
);

export default function SpaceAnalysis({ analysis, onWatts, onBeam = null,
                                        highlight = [], autoplace = null,
                                        onAutoplace = null, disabled = false }) {
  const { required, achieved, rows } = analysis;
  const lit = new Set(highlight ?? []);

  /* WHICH ROWS ARE OPEN. Local, because it is a fact about how somebody is
     reading this panel right now and nothing outside it has any business
     knowing — the one outside influence is `highlight`, and that only ever
     ADDS. Keyed by row key, so a row that stops existing takes its entry out of
     use rather than opening some other fitting. */
  const [open, setOpen] = useState(() => new Set());
  const rowRefs = useRef({});
  /* WHAT WE LAST ANSWERED FOR. The effect below must run when the SELECTION
     changes and not on every render — the rows re-render on every keystroke of
     a wattage slider, and re-scrolling the panel under somebody's hand while
     they drag one would be unusable. */
  const answered = useRef('');

  const key = (highlight ?? []).join('|');
  useEffect(() => {
    if (!key) { answered.current = ''; return; }
    if (key === answered.current) return;
    answered.current = key;
    const keys = key.split('|');
    setOpen((cur) => {
      /* ADD, NEVER REPLACE — see the note at the top of this file. */
      const next = new Set(cur);
      for (const k of keys) next.add(k);
      return next;
    });
    /* AFTER THE OPEN HAS PAINTED, or the row is still one line high and the
       scroll lands short of it. One frame is enough: `setOpen` above is
       committed by the time a rAF callback runs. */
    const id = requestAnimationFrame(() => {
      const el = rowRefs.current[keys[0]];
      if (!el) return;
      /* `nearest` SCROLLS THE PANEL AND NOT THE PAGE, and it does nothing at all
         when the row is already in view — which is the common case and the one
         where a scroll would read as the panel twitching for no reason.
         SMOOTH UNLESS THE MACHINE ASKS OTHERWISE. The rest of this app states
         that in CSS (`motion-reduce:`); there is no stylesheet for a scroll, so
         the same question is asked directly. */
      const still = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [key]);

  const toggle = (k) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  /* --- IS THE GRID WORTH OFFERING TO FINISH? ------------------------------
     AUTOPLACE IS A FINISHING MOVE — see AUTOPLACE_AT_FRACTION in lib/cob.js for
     the whole argument. Until the space is most of the way there, filling every
     bare cell in one press is not the next thing anybody wants.
     A TOGGLE ALREADY ON STAYS OFFERED whatever the figure does afterwards. It
     has to: switching autoplace on adds lamps, which moves `achieved`, and a
     control that vanished at the moment it took effect would be a control you
     could not undo. Hiding the way out is the one thing this app's steps never
     do — see the Done button on every one of them. */
  const gridReady = required > 0 && achieved >= required * AUTOPLACE_AT_FRACTION;
  const showAutoplace = !!onAutoplace && (autoplace || gridReady);

  return (
    <>
      <h3 className={H3}>Analysis</h3>

      {/* THE READOUT IS NOT IN THIS VIEW AT ALL NOW. Required, achieved and the
          two figures that make it up are Lumens.jsx, and it is on the window's
          OTHER view — the one this list is reached from. A readout above a list
          of forty rows is a readout you scroll away from; see the note in
          SpaceDetail on why the two swap rather than stack.
          WHAT IS HERE IS THE WORKING, which is what this file was always for:
          the rows, the three sections, and the one control that moves the
          figure. */}

      {/* --- WHAT IS MAKING IT SO, LAYER BY LAYER AND ROW BY ROW ------------
          A rule above each row rather than a card round each: these are readings
          of one room, not four objects, and four boxes in a 340px column would
          read as four subjects. The section headings are the only structure. */}
      {LAYERS.map((L) => {
        const mine = rows.filter((r) => (r.layer ?? 'ambient') === L.id);
        const carries = L.always && showAutoplace;
        if (!mine.length && !carries) return null;
        return (
          <section key={L.id} className="mt-4 first-of-type:mt-3">
            {/* THE HEADING, AND WHATEVER THAT LAYER CAN BE SWITCHED ON.
                SPACE-BETWEENED rather than stacked: the toggle is a control OVER
                this section and belongs on its line, and a heading with a lone
                switch under it reads as the first row of the list. */}
            <div className="flex items-center justify-between gap-2 mb-1">
              <h4 className={SEC_H}>{L.label}</h4>
              {L.id === 'ambient' && showAutoplace && (
                /* --- AUTOPLACE, ON THE AMBIENT HEADING ---------------------
                    IT SITS WITH THE ROWS IT PRODUCES. The lamps it puts down are
                    the ambient grid's — one per cell, at the cell's own wattage
                    and optic — so they are listed under this heading, and a
                    switch that filled one section from the heading of another
                    would be the one control on this panel you could not follow.
                    A CHECKBOX AND NOT A BUTTON, because it is reversible and it
                    is a STATE of the space rather than an act: switching it off
                    takes back the lamps that are still the rule's answer, and
                    leaves alone every one that has since been moved or
                    re-specified. See `autoplaceIn` in
                    features/fixtures/useFixtureCommands.js. */
                <label className="flex items-center gap-1.5 text-[10.5px] text-muted
                  cursor-pointer select-none shrink-0">
                  <input className="lp-check" type="checkbox" disabled={disabled}
                    checked={!!autoplace}
                    onChange={(e) => onAutoplace(e.target.checked)} />
                  Autoplace
                </label>
              )}
            </div>
            {mine.map((row) => (
        <div key={row.key}
          ref={(el) => { rowRefs.current[row.key] = el; }}
          /* THE ONE THAT IS SELECTED ON THE DRAWING, IN WHITE. A press on a
             fitting is a question — "what is this, and what is it doing to the
             room" — and this panel is the answer; without a mark, a plan with
             nine placed lamps gives nine identical rows and no way to tell which
             one was just clicked. WHITE because that is what "current" means
             everywhere else in this panel (see the tab strip), and a TINT rather
             than a border so the row lights up in place instead of boxing
             itself. */
          className={'border-t border-border/10 pt-2.5 mt-2.5 '
            + (lit.has(row.key)
              ? '-mx-2 px-2 rounded bg-white/10 border-transparent' : '')}>
          {/* THE NAME IS THE CONTROL. A whole-width button rather than a caret
              you have to hit: the row is one line of type in a 340px column, and
              a nine-pixel target beside it would be the only thing on this panel
              you have to aim at. The caret is a MARK of state, not the handle.
              `aria-expanded` because that is the whole of what this button says,
              and the region it opens is the rest of the row. */}
          <button type="button" aria-expanded={open.has(row.key)}
            onClick={() => toggle(row.key)}
            className={'w-full flex items-baseline justify-between gap-2 '
              + 'bg-transparent border-0 p-0 cursor-pointer text-left '
              + 'focus-visible:outline-2 focus-visible:outline-accent '
              + 'focus-visible:outline-offset-2 '
              + (open.has(row.key) ? 'mb-1' : '')}>
            <span className={'flex items-center gap-1.5 min-w-0 text-[11.5px] leading-[1.4] '
              + (lit.has(row.key) ? 'text-white' : 'text-text')}>
              <Caret open={open.has(row.key)} />
              <span className="truncate">{row.label}</span>
            </span>
            <span className="text-[10.5px] text-subtle tabular-nums shrink-0">
              {quantity(row)}
            </span>
          </button>
          {open.has(row.key) && (<>
          {/* --- THE WATTAGE, IN WHICHEVER OF ITS THREE SHAPES THE ROW WANTS --
              A RANGE IS A SLIDER, AND ONLY A HAND-PLACED FITTING HAS ONE. The
              chips are a product LIST — five wattages because five products —
              and every one of them is a press worth having. A COB somebody
              placed may be anything from 3 to 55 W (see COB_WATT_RANGE), and a
              row of chips for that is a scrolling wall of numbers in a 340px
              column. It is the same control the bar on the drawing offers while
              the lamp is being placed, in the place you come back to it.
              ONE OPTION IS NOT A CHOICE, SO IT IS NOT DRAWN AS ONE. A sconce is
              specified at 7 W and nothing else — see SCONCE_WATTS — and a single
              latched chip is a control that cannot do anything, which is worse
              than no control: it invites the press that changes nothing. The
              figure still has to be on screen, because it is what the
              contribution below is computed from, so it is printed.
              AND OTHERWISE THE CHIPS, which is every family the engine buys. */}
          {row.wattRange ? (
            <div className="flex items-center gap-2 mb-1">
              <input type="range" aria-label="Wattage" disabled={disabled}
                min={row.wattRange.min} max={row.wattRange.max}
                step={row.wattRange.step ?? COB_WATT_RANGE.step}
                value={row.watts}
                className="flex-1 min-w-0 accent-white cursor-pointer
                  disabled:opacity-[.45] disabled:cursor-not-allowed"
                onChange={(e) => onWatts(row, Number(e.target.value))} />
              <span className="text-[11.5px] text-text tabular-nums w-[38px] text-right">
                {row.watts} W
              </span>
            </div>
          ) : row.wattOptions.length < 2 ? (
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

          {/* --- THE OPTIC ---------------------------------------------------
              ONLY WHERE THERE IS ONE TO CHANGE, which is a hand-placed fitting
              and nothing else — everything the engine puts down is a catalogue
              line whose beam angle IS the line (see FIXTURES in boq.js), and
              offering to change it here would be offering to order a product
              that does not exist. It changes no figure in this panel: a beam
              angle decides where light lands, not how much of it there is, and
              the lumen model is about how much. It is here because this is where
              somebody comes back to a fitting they placed, and the optic is half
              of what they specified. */}
          {row.beam != null && onBeam && (<>
            <div className="flex items-baseline justify-between gap-2 mb-1 mt-1">
              <span className={`${LBL} text-[11.5px]`}>Beam angle</span>
              <span className="text-[11.5px] text-text tabular-nums">{row.beam}°</span>
            </div>
            <div className="flex gap-0.5 flex-wrap mb-1">
              {BEAM_ANGLES.map((d) => (
                <button key={d} type="button" disabled={disabled}
                  aria-pressed={row.beam === d}
                  className={row.beam === d ? CHIP_ON : CHIP_OFF}
                  onClick={() => onBeam(row, d)}>{d}°</button>
              ))}
            </div>
          </>)}
          {/* --- THE TWO READINGS, AND THEY ARE DIFFERENT KINDS OF NUMBER ---
              THE CONTRIBUTION is what this row gives the ROOM: its whole output,
              times how much of that the surfaces hand back. It is what the two
              figures on the readout are made of, and naming the one it feeds is
              what stops "Contribution" reading as "contribution to something on
              this row".
              ILLUMINATION ON FLOOR is what ONE of them puts under itself, in
              lux — a local intensity, not a share of a budget. It earns its
              place beside the first because the two move independently: tighten
              a lamp from 45 degrees to 24 and the room gets exactly the same
              lumens while the pool underneath more than triples. A panel showing
              only the first would report that as nothing happening.
              PER FITTING, AND IT SAYS SO. Twelve lamps do not make it twelve
              times brighter, they make twelve pools — so on a row that counts
              more than one, the figure is qualified rather than left to be read
              as a total. See `floorLuxOf` in lumens.js. */}
          {/* --- AND IT NAMES THE FIGURE THIS ROW FEEDS ---------------------
              IT SAID "Contribution to ambient" ON EVERY ROW, and that became a
              flat contradiction the day the recessed COB was filed as task light
              (see the note on `cob` in lumens.js): a downlight's row claimed to
              contribute to ambient while its lumens went into the task total
              above it. A reader adding the rows up to check the card would find
              the card wrong — and would be right, about the labels.
              THE SAME FOLD THE READOUT USES, and it is read off `contributions`
              rather than reimplemented: ambient and accent rows feed the ambient
              figure, task rows feed the task one. Two places deciding what
              ambient means is how they come to disagree. */}
          <div className={KV}>
            <span className={LBL}>
              Contribution to {row.layer === 'task' ? 'task' : 'ambient'}
            </span>
            <span className="text-text">{lm(row.netLumens)} lm</span>
          </div>
          {row.floorLux != null && (
            <div className={KV}>
              <span className={LBL}>
                Illumination on floor{row.count > 1 ? ', each' : ''}
              </span>
              <span className="text-text">{lm(row.floorLux)} lx</span>
            </div>
          )}
          </>)}
        </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
