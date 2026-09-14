import React, { useEffect, useRef, useState } from 'react';
import { BEAM_ANGLES, COB_WATT_RANGE } from '../lib/cob.js';

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

   A SECTION WITH NOTHING IN IT IS NOT DRAWN, AND THERE IS NO EXCEPTION LEFT.
   An empty heading is a promise of rows that are not there. Ambient used to be
   the one exception because it carried the autoplace toggle — that switch is
   how a space with no lamps in it GETS some, so hiding it until there were some
   would have hidden the control behind its own effect. The checkbox has gone
   (see the heading block below), so the thing the exception was protecting is
   not there to protect, and an empty Ambient heading would now be exactly the
   broken promise the rule forbids.

   THESE TWO SECTIONS ARE THE SCHEME AND THEY ARE ALSO THE READOUT'S TWO
   FIGURES. Both come off the same `layer` on the same rows, and they are now the
   same split — they were not, while a third layer existed: this file drew an
   ACCENT section and Lumens.jsx folded it into the ambient figure before
   printing, so the list said three things and the readout said two. The layer
   has gone (see `layer` in lib/lumens.js), and one question is asked once: is
   this fitting washing the room, or is it pointed at something.
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

   A NEW FITTING SELECTION REPLACES THE OPEN DETAIL. Clicking lamp B after lamp
   A is not a request to compare two expanding forms; it is a new question, and
   the list answers it with B alone. Rows may still be opened together by hand,
   but the next press on a fitting closes those and opens only the selected row.

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

/* THE TWO LAYERS, IN THE ORDER A SCHEME IS DESIGNED IN. `always` is the one
   that draws its heading with nothing under it — see the note above.

   THERE WAS A THIRD, 'Accent', AND IT IS GONE. A chandelier, a pendant, a floor
   lamp, a sconce and a shelf strip were filed under it — every one of them a
   thing that lights the ROOM, and every one of them therefore already counted
   in the ambient figure the readout prints (the fold that did that addition is
   in `analyseSpace`). So the section was not a reading of anything; it was a
   drawer, and what it held was a chandelier's wattage, three rows below the
   fittings it belongs beside and in a heading nobody thought to open.
   TWO SECTIONS AND TWO LAYER VALUES, which is what stops a row existing that
   this list has no section to draw it in. See `layer` in lib/lumens.js. */
const LAYERS = [
  { id: 'ambient', label: 'Ambient', always: true },
  { id: 'task', label: 'Task lights' },
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

/* --- THE SWITCH, AND IT IS HEROICONS' EYE ---------------------------------
   THE TWO PATHS ARE COPIED IN RATHER THAN INSTALLED. `@heroicons/react` is a
   dependency and a build step for two glyphs, and this app already draws every
   other mark it needs — the caret above, the whole plan canvas — as inline SVG.
   These are the 24/outline `eye` and `eye-slash`, unaltered, at the stroke this
   panel's other marks use.

   TWO GLYPHS AND NOT ONE ROTATED, which is the opposite of the caret beside
   them and is the right way round for a different reason. A caret says OPEN or
   SHUT about the thing under it, and the same arrow turned is the plainest way
   to say that. This says ON or OFF about the fitting itself, and a struck-out
   eye is a mark people already read as off — the slash IS the meaning, so there
   is a second glyph to draw. */
const EYE = 'M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5'
  + 'c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5'
  + ' 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z';
const EYE_PUPIL = 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z';
const EYE_SLASH = 'M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244'
  + ' 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12'
  + ' 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774'
  + 'M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65'
  + 'm0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88';

/**
 * ON OR OFF, FOR ONE FITTING.
 *
 * ITS OWN BUTTON AND NOT PART OF THE ROW'S, which the markup has to be careful
 * about: the row name is already a full-width button that opens the row, and a
 * button inside a button is invalid and does not receive its own clicks. So the
 * two are siblings in a flex line and the name takes `flex-1`.
 *
 * IT SAYS WHICH STATE IT IS IN, NOT WHICH ONE IT WILL GO TO. An eye means this
 * light is on; pressing it switches the light off and the glyph becomes the
 * struck-out one. That is the way every visibility control anybody has used
 * behaves, and the alternative — showing the eye you are about to get — reads
 * backwards on a panel where nine rows are listed together.
 */
const OffSwitch = ({ on, disabled, onToggle }) => (
  <button type="button" disabled={disabled} aria-pressed={!on}
    aria-label={on ? 'Switch this fitting off' : 'Switch this fitting on'}
    onClick={onToggle}
    className={'shrink-0 bg-transparent border-0 p-0 leading-none '
      + 'cursor-pointer disabled:cursor-default disabled:opacity-40 '
      + 'focus-visible:outline-2 focus-visible:outline-accent '
      + 'focus-visible:outline-offset-2 '
      + (on ? 'text-subtle enabled:hover:text-text'
            : 'text-danger enabled:hover:text-danger')}>
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round">
      {on ? (<><path d={EYE} /><path d={EYE_PUPIL} /></>) : <path d={EYE_SLASH} />}
    </svg>
  </button>
);

/**
 * THE WATTAGE SLIDER, AND IT WRITES ONCE PER GESTURE RATHER THAN ONCE PER PIXEL.
 *
 * THE BUG THIS EXISTS TO FIX: A CHANDELIER'S SLIDER COULD NOT BE DRAGGED. You
 * could click a point on the track and the value jumped there, and you could
 * not take hold of the thumb and move it — which is the exact signature of the
 * failure, because a click is ONE write and a drag is fifty.
 *
 * WHY A DRAG AND A CLICK DIFFER. A decorative fitting is a CEILING OBJECT, so
 * its wattage is stored on the object — see `patchObject` — and `ceilingObjs`
 * is an input to the layout: `projectObstaclesPx` rebuilds, the `rooms` memo
 * re-lays out every space on the plan, the heatmap is rebuilt behind it and the
 * document is queued for saving. That is the right answer to "the plan changed"
 * and a catastrophic one to run per pointer-move. The main thread never gets
 * back to the pointer, the browser's own thumb-tracking is starved, and the
 * control reads as broken. One click completes the rebuild and looks fine.
 * IT IS NOT THE WATTAGE THAT INVALIDATES THE LAYOUT — a 44 W chandelier is the
 * same obstacle as a 36 W one — but the memo cannot know that, and narrowing
 * its dependency to "the geometric part of every object" would be a second,
 * cleverer projection to keep in step with the first.
 *
 * THIS IS THE SAME ANSWER ShapeMenu'S RadiusControl ALREADY GIVES, and its
 * header carries the same diagnosis in the same words — a native range emits
 * scores of changes in one drag and writing through on each "eventually starves
 * the pointer event that would finish the drag". Two controls, one failure, one
 * fix: keep the thumb and the readout LOCAL, commit on release.
 *
 * WHY THIS ONE KEEPS THE NATIVE INPUT AND THAT ONE DOES NOT. RadiusControl
 * suppresses the browser's drag and tracks the pointer itself because it needed
 * a live preview drawn on the ceiling under it. Nothing here needs that: with
 * `onChange` writing only to local state, the native drag is no longer starved
 * and works exactly as the platform intends, keyboard and assistive input
 * included — which is a control with less code in it, not more.
 *
 * THE COMMIT IS ON THE WINDOW AND NOT ON THE INPUT. A thumb dragged past the
 * end of the track releases the pointer over whatever is next to it, so an
 * `onPointerUp` on the input misses the release that matters most — the one at
 * either extreme. `blur` catches the window losing focus mid-drag.
 *
 * AND THE PROP WINS WHENEVER THIS IS NOT THE THING WRITING. `live` is what says
 * a gesture is in flight; without it, the re-render that a neighbouring control
 * causes would snap the thumb back to the stored figure under the finger.
 *
 * ...WHICH ALSO MAKES A DRAG ONE UNDO STEP. Fifty writes were fifty entries in
 * the history, so undoing a wattage change meant pressing undo until it
 * stopped. That was never a separate bug — it is this one, seen from the other
 * side.
 */
function WattSlider({ range, watts, disabled, onCommit }) {
  const [draft, setDraft] = useState(watts);
  /* ONE REF AND NOT FOUR PIECES OF STATE. The window listeners below are
     registered once and must read the CURRENT draft, wattage and handler when
     they fire; a value closed over at registration would be the one from the
     render that installed them. */
  const box = useRef({ draft: watts, watts, onCommit, live: false });
  box.current.watts = watts;
  box.current.onCommit = onCommit;

  /* THE STORED FIGURE, WHENEVER NOTHING IS BEING DRAGGED. This is what makes
     the control follow an undo, a plan being reloaded, or the same fitting
     being changed from somewhere else. */
  useEffect(() => {
    if (box.current.live) return;
    box.current.draft = watts;
    setDraft(watts);
  }, [watts]);

  useEffect(() => {
    const finish = () => {
      const b = box.current;
      if (!b.live) return;
      b.live = false;
      if (b.draft !== b.watts) b.onCommit?.(b.draft);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
    };
  }, []);

  /* THE KEYBOARD COMMITS ON KEY-UP, which is the same rule said about the other
     input device: an arrow key held down repeats, and one write per repeat is
     the same storm by a different route. It never sets `live`, so the effect
     above keeps following the document between presses. */
  const keyCommit = () => {
    const b = box.current;
    if (b.draft !== b.watts) b.onCommit?.(b.draft);
  };

  return (
    <div className="flex items-center gap-2 mb-1">
      <input type="range" aria-label="Wattage" disabled={disabled}
        min={range.min} max={range.max}
        step={range.step ?? COB_WATT_RANGE.step}
        value={draft}
        className="flex-1 min-w-0 accent-white cursor-pointer
          disabled:opacity-[.45] disabled:cursor-not-allowed"
        onPointerDown={() => { box.current.live = true; }}
        onChange={(e) => {
          const v = Number(e.target.value);
          box.current.draft = v;
          setDraft(v);
        }}
        onKeyUp={keyCommit}
        /* THE LAST FALLBACK, for assistive input that changes the value and
           moves away without either a pointer release or a key-up. */
        onBlur={() => { if (!box.current.live) keyCommit(); }} />
      {/* THE DRAFT AND NOT THE STORED FIGURE, so the number under the thumb is
          the number the thumb is on while it is moving. */}
      <span className="text-[11.5px] text-text tabular-nums w-[38px] text-right">
        {draft} W
      </span>
    </div>
  );
}

/* --- IS THERE A WATTAGE TO CHANGE ON THIS ROW? -----------------------------
   ONE DEFINITION, BECAUSE TWO PLACES ASK. The card below draws the wattage in
   whichever of three shapes the row wants, and the vertical column asks a
   different question of the same fact: is this fitting worth 109px of a 9:16
   frame at all? A range is a slider and two or more options are chips; a single
   catalogue wattage is a figure nobody can press, and a window whose only
   control is inert is a window that should not have opened.
   IT IS THE PANEL'S OWN RULE, lifted out of the branch that was already making
   it — see the wattage block in the row, and `FixtureSpec`. */
export const wattsChangeable = (row) => !!row?.wattRange
  || (row?.wattOptions?.length ?? 0) > 1;

/* ---------------------------------------------------------------------------
   ONE FITTING, THREE CONTROLS, ONE ROW — the bar at the head of the column.

   IT WAS THIS WHOLE PANEL WITH `onlyHighlighted` ON, then a four-row card, and
   both were the same mistake at different sizes: a 9:16 frame cannot spend a
   hundred pixels on a readout. A row here carries a name, a count, a
   disclosure, a contribution in lumens and a floor reading in lux — twelve
   lines of answer where the column has room for three questions.

   SO IT IS A THIN BAR AND EVERYTHING ON IT IS A CONTROL. What it draws, where
   it throws, and whether it is lit. No name: you pressed the fitting, it is
   ringed on the drawing directly under this, and a caption repeating what you
   are looking at is the thing this app removes everywhere else. No lumens: that
   figure is on the analysis card at the foot of the column, where the room's
   whole budget is, and printing it twice is two places for one number to be
   read from.

   DROPDOWNS AND NOT CHIPS, which is what makes it one row. Eight optics is
   eight keys and a wattage list is four or five more: thirteen buttons is a bar
   as wide as the screen, or two rows, and this bar is one row by rule. A closed
   `<select>` is the width of its own answer.

   THE SAME PARTS THE PANEL USES for the eye — `OffSwitch`, down to the glyph
   pair and the tone it takes when the light is out. */

/* --- A FIGURE AND TWO ARROWS, AND IT IS THE SMALLEST OF THE THREE ---------
   CHIPS, THEN A DROPDOWN, NOW THIS. Eight optics as chips is eight keys and a
   bar as wide as the screen. A `<select>` closed is the width of its own
   answer, which was the point of it — except that a native select is never just
   its answer: it carries the platform's own chrome, a disclosure glyph and the
   padding around it, so "30°" arrives eighty pixels wide. In a 380px column
   that is two controls and there is no room for the third.

   SO THE VALUE IS TYPE AND THE CONTROL IS TWO 9px ARROWS beside it — about
   forty pixels all in, and the figure is more legible than it was inside a
   select. It is the shape of a number field's spinner, which is what makes it
   read as adjustable without a caption.

   IT STEPS THROUGH A LIST AND DOES NOT DO ARITHMETIC. A wattage is which
   product is in the fitting and a beam angle is which reflector — see
   BEAM_ANGLES — so up is "the next one they sell", not "one more watt". The
   ends are ends: the arrow disables rather than wrapping, because wrapping from
   60° to 6° on a press is a control that can undo a decision by overshooting.

   UP IS MORE, which is why the lists it is handed have to be ascending. */
const ARROW = 'flex h-[9px] w-[13px] items-center justify-center border-0 '
  + 'bg-transparent p-0 leading-none cursor-pointer text-faint '
  + 'enabled:hover:text-white disabled:opacity-30 disabled:cursor-default '
  + 'focus-visible:outline-1 focus-visible:outline-accent';

function Stepper({ label, value, options, disabled = false, onPick, unit = '' }) {
  const i = options.indexOf(value);
  const step = (d) => {
    const next = options[(i < 0 ? 0 : i) + d];
    if (next != null && next !== value) onPick?.(next);
  };
  const end = (d) => disabled || i < 0 || options[i + d] == null;
  return (
    <span className="flex flex-none items-center gap-1">
      <span className="text-[11.5px] tabular-nums text-text whitespace-nowrap">
        {value}{unit}
      </span>
      {/* THE PAIR IS ONE CONTROL AND THEY STACK, so the two together are no
          taller than the figure beside them and no wider than a glyph. */}
      <span className="flex flex-col">
        <button type="button" className={ARROW} disabled={end(1)}
          aria-label={`${label} up`} onClick={() => step(1)}>
          <svg width="7" height="5" viewBox="0 0 7 5" aria-hidden="true"
            fill="currentColor"><path d="M3.5 0 L7 5 H0 Z" /></svg>
        </button>
        <button type="button" className={ARROW} disabled={end(-1)}
          aria-label={`${label} down`} onClick={() => step(-1)}>
          <svg width="7" height="5" viewBox="0 0 7 5" aria-hidden="true"
            fill="currentColor"><path d="M3.5 5 L0 0 H7 Z" /></svg>
        </button>
      </span>
    </span>
  );
}

/** A list with the current value in it, in order. See its caller. */
const withValue = (list, v) => (list.includes(v) || v == null
  ? list : [...list, v].sort((a, b) => a - b));

/** The wattages a row can be set to, as a list even where it is stored as a
 *  range: a stepper has to enumerate. The step is the product's own. */
function wattChoices(row) {
  if (!row?.wattRange) return row?.wattOptions ?? [];
  const { min, max, step } = row.wattRange;
  const at = step > 0 ? step : 1;
  const out = [];
  for (let w = min; w <= max + 1e-9; w += at) out.push(+w.toFixed(3));
  return out;
}

export function FixtureSpec({ row, disabled = false, onWatts, onBeam = null,
                              onToggleOff = null }) {
  /* THE STORED FIGURE IS ALWAYS IN THE LIST, AND SORTED. A wattage set from
     the bar on the drawing, or by a plan made before this family's list
     changed, is not necessarily one of the steps — and a stepper that cannot
     find its own value has no idea which way is up: both arrows would be ends.
     Folding it in gives it a place in the order, so the next press moves to a
     real product from wherever the fitting happens to be. */
  const watts = withValue(wattChoices(row), row.watts);
  const beams = withValue(BEAM_ANGLES, row.beam);
  const unit = row.unit === 'm' ? '/m' : '';
  return (
    <div className="flex h-full items-center gap-3 overflow-hidden">
      <Stepper label="Wattage" value={row.watts} options={watts} unit={`W${unit}`}
        disabled={disabled} onPick={(w) => onWatts?.(w)} />
      {row.beam != null && onBeam && (
        <Stepper label="Beam angle" value={row.beam} options={beams} unit="°"
          disabled={disabled} onPick={(d) => onBeam(d)} />
      )}
      {onToggleOff && (
        <span className="ml-auto flex items-center">
          <OffSwitch on={!row.off} disabled={disabled}
            onToggle={() => onToggleOff(!row.off)} />
        </span>
      )}
    </div>
  );
}

export default function SpaceAnalysis({ analysis, onWatts, onBeam = null,
                                        onToggleOff = null,
                                        highlight = [], autoplace = null,
                                        onAutoplace = null, disabled = false,
                                        compact = false, onlyHighlighted = false }) {
  const { rows } = analysis;
  const lit = new Set(highlight ?? []);
  const shownRows = onlyHighlighted && lit.size
    ? rows.filter((row) => lit.has(row.key))
    : rows;

  /* WHICH ROWS ARE OPEN. Local, because it is a fact about how somebody is
     reading this panel right now and nothing outside it has any business
     knowing — the one outside influence is `highlight`, and a new highlight
     REPLACES the open set. Keyed by row key, so a row that stops existing takes
     its entry out of use rather than opening some other fitting. */
  /* SEEDED FROM THE SELECTION, AND NOT LEFT TO THE EFFECT BELOW TO OPEN. The
     effect is what handles the selection CHANGING while the panel is up; this
     is the panel arriving with one already made — press a chandelier on the
     drawing and open the space, and its row is open on the first paint rather
     than one frame later. Same set, same rule, one render earlier. */
  const [open, setOpen] = useState(() => new Set(highlight ?? []));
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
    /* REPLACE, because selecting a different fitting makes that fitting the
       sole subject of the panel. Anything opened by an earlier selection or by
       hand closes here; manual multi-open remains available until the next
       selection arrives. */
    setOpen(new Set(keys));
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
     do — see the Done button on every one of them.

     `gridReady` AND `showAutoplace` WERE COMPUTED HERE and are gone with the
     checkbox they gated. The whole of the argument above is kept because it is
     the answer to "when should this be offered", and that question survives the
     control: `AUTOPLACE_AT_FRACTION` in lib/cob.js is still the figure, and
     `autoplace`/`onAutoplace` are still taken as props so the caller need not
     change. Nothing in this file presses them now. */

  return (
    <>
      {!compact && <h3 className={H3}>Analysis</h3>}

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
        const mine = shownRows.filter((r) => (r.layer ?? 'ambient') === L.id);
        if (!mine.length) return null;
        return (
          <section key={L.id} className={compact ? 'mt-0' : 'mt-4 first-of-type:mt-3'}>
            {/* THE AUTOPLACE CHECKBOX WAS HERE, ON THE AMBIENT HEADING, and it
                is gone by request rather than by argument. It sat with the rows
                it produced — the grid's lamps are the ambient layer's, so a
                switch that filled one section from the heading of another would
                have been the one control on this panel you could not follow —
                and that reasoning is kept here because it is where the control
                goes back if it ever does.
                THE COMMAND BEHIND IT IS UNTOUCHED. `setAutoplace` and
                `autoplaceIn` in features/fixtures/useFixtureCommands.js still
                exist, still take back only the lamps that are still the rule's
                answer, and are still what the space's stored flag drives. What
                has gone is this panel's way of pressing it. */}
            {!compact && (
              <div className="mb-1">
                <h4 className={SEC_H}>{L.label}</h4>
              </div>
            )}
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
          {/* THE NAME AND THE SWITCH ARE SIBLINGS, and they have to be: the
              name is a full-width button and a button cannot contain another
              one. `items-center` on the line rather than `items-baseline`,
              because an icon has no baseline to sit on — the text inside the
              name button still aligns to its own. */}
          <div className="flex items-center gap-2">
          <button type="button" aria-expanded={open.has(row.key)}
            onClick={() => toggle(row.key)}
            className={'flex-1 min-w-0 flex items-baseline justify-between gap-2 '
              + 'bg-transparent border-0 p-0 cursor-pointer text-left '
              + 'focus-visible:outline-2 focus-visible:outline-accent '
              + 'focus-visible:outline-offset-2 '
              + (open.has(row.key) ? 'mb-1' : '')}>
            {/* AN OFF FITTING'S NAME STANDS DOWN, and that is the only other
                mark the state gets. Nine rows is a list you scan, and the
                figures under a closed row are not on screen to tell you which
                one is dark — the eye beside it is, but it is 14px and to the
                right. The tone is the same one this panel already uses for a
                figure that is working rather than an answer. */}
            <span className={'flex items-center gap-1.5 min-w-0 text-[11.5px] leading-[1.4] '
              + (row.off ? 'text-subtle'
                 : lit.has(row.key) ? 'text-white' : 'text-text')}>
              <Caret open={open.has(row.key)} />
              <span className="truncate">{row.label}</span>
            </span>
            <span className="text-[10.5px] text-subtle tabular-nums shrink-0">
              {quantity(row)}
            </span>
          </button>
          {onToggleOff && (
            <OffSwitch on={!row.off} disabled={disabled}
              onToggle={() => onToggleOff(row, !row.off)} />
          )}
          </div>
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
            <WattSlider range={row.wattRange} watts={row.watts} disabled={disabled}
              onCommit={(w) => onWatts(row, w)} />
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
