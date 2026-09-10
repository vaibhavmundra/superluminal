import React from 'react';
import { BEAM_ANGLES, COB_WATT_RANGE } from '../lib/cob.js';
import StageBar from './StageBar.jsx';

/* ---------------------------------------------------------------------------
   CobSpec — WHAT THE NEXT COB WILL BE, WHILE YOU ARE DECIDING WHERE IT GOES.

   THE SPECIFICATION HAS TO BE ON SCREEN AT THE MOMENT OF PLACING. Wattage and
   beam angle live in the analysis panel for every other fitting in this app, and
   that is right for a fitting you are READING about — twelve COBs, one decision.
   It is wrong for the one you are about to put down: by the time you have
   crossed to the panel, chosen, and come back, the cell you were over is not the
   cell you are over, and the recommendation the panel was showing was for
   somewhere else.

   AND IT IS AN ANSWER BEFORE IT IS A QUESTION. The bar opens on what the
   gridding engine would have installed at the point under the cursor, tagged as
   the engine's — so the ordinary case is that you read two figures, agree, and
   click. Everything else here is for the case where you do not.

   THE TWO BUTTONS ARE THE WHOLE DESIGN. A change to a wattage or an optic is
   ambiguous in exactly one way, and it is the way that matters: did you mean
   THIS lamp, or did you mean from now on. Guessing either would be wrong half
   the time, and asking is one press — so a change does not take effect at all
   until one of them is pressed. That is also what makes the slider safe to drag:
   nothing has happened yet, and letting go in the wrong place costs nothing.

   --- IT IS PINNED TO THE STAGE AND NOT TO THE POINTER, AND THAT IS A FIX ------

   The obvious build is FixtureTip's: a card at the cursor plus a small offset,
   flipping at the edges. It cannot work here, and the reason is worth writing
   down so it is not tried again. FixtureTip is `pointer-events: none` — nothing
   on it is ever pressed. This has a slider and ten buttons, so it has to be
   REACHED — and a card that sits at cursor+18 moves with the cursor: every step
   you take toward it, it takes away from you, and the gap stays 18px for ever.
   The controls would be visible and permanently untouchable.

   Every way of half-fixing that is worse than the pin. Freezing it when the
   pointer stops means it bolts again the instant you set off toward it. Freezing
   it while the pointer is inside its own footprint means a 250px dead zone and a
   card that jumps a screen's width when you leave one. Re-anchoring per grid
   cell means it hops on a boundary you cannot see.

   So it takes ShapeMenu's answer, which this app already argued for in exactly
   this situation: a control that talks back for the length of a gesture belongs
   in one place, in front of you, at the foot of the drawing. It is still
   contextual — every figure on it is about the point under the cursor and
   changes as the cursor moves — it simply does not chase the cursor around to
   say so. The ghost lamp under the pointer is what marks the spot.

   WHITE, LIKE ShapeMenu, AND FOR ITS REASON: the sheet is either white paper or
   an inverted black plan, and opaque white with a hairline and a shadow is the
   one treatment legible on both. Deliberately the same object one row up, so the
   two bars read as the same kind of thing rather than as two inventions.
   --------------------------------------------------------------------------- */

/* THE CLEARANCE AND THE PILL ARE StageBar's. This bar and the shape bar sit in
   exactly the same place, which is enforced rather than hoped for: arming a COB
   closes the shape tool, and opening an array closes both (see `openArray` in
   App.jsx). Two bars in one place would be two rows of buttons, half of them
   about an object nobody is looking at. */

const CAP = 'text-[10.5px] leading-none tracking-[0.02em] text-black/55 px-1.5 select-none';
const VAL = 'text-[11.5px] leading-none text-black tabular-nums '
  + '[font-variant-numeric:tabular-nums] select-none';
const SEP = <span className="w-px h-5 bg-black/10 mx-1" aria-hidden="true" />;

/* `whitespace-nowrap` AND `flex-none` TOGETHER, because either alone leaves the
   bug. StageBar is `flex-nowrap`, which stops the BAR wrapping and does nothing
   about a chip: a flex child still shrinks below its content by default, and a
   shrunk chip breaks its own label across two lines — "On the line" came out as
   two rows inside one button, which made that row of chips a different height
   from every other control on the bar. `flex-none` stops the shrink and
   `whitespace-nowrap` stops the break; the bar grows sideways instead, which is
   what the note on `flex-nowrap` in StageBar says it is for. */
const CHIP = 'flex-none whitespace-nowrap '
  + 'px-[6px] py-[4px] text-[10.5px] rounded-[6px] border cursor-pointer '
  + 'tabular-nums leading-none transition-colors duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';
const CHIP_OFF = `${CHIP} text-black/70 border-transparent bg-transparent hover:bg-black/[0.07]`;
/* THE SAME BLACK CHIP THE SHAPE BAR LATCHES WITH, so a picked optic here and a
   picked shape there are visibly the same kind of state. */
const CHIP_ON = `${CHIP} text-white border-black bg-black hover:bg-black`;

/* --- "CHANGE", WHICH IS A WORD AND NOT A BUTTON ---------------------------
   THE ORDINARY CASE IS THAT YOU AGREE. The bar opens on what the engine would
   install at the point under the cursor, and for most lamps on most plans the
   right act is to read two figures and click the ceiling. A slider and eight
   optic chips standing open for that case is nine controls in the way of the
   one press anybody came to make — and worse, they made the bar long enough to
   reach across the drawing.
   SO THE CONTROLS ARE BEHIND A WORD, and the word is drawn as a word: type in
   the bar's own caption size with a dotted rule under it, which is what says
   "this is not just a label" without becoming a tenth button competing with
   the nine it opens. A solid underline would read as a link to somewhere else;
   dotted is the convention for a value you can edit in place. */
const LINK = 'flex-none whitespace-nowrap bg-transparent border-0 p-0 mx-1.5 '
  + 'text-[10.5px] leading-none tracking-[0.02em] cursor-pointer '
  + 'underline decoration-dotted decoration-from-font underline-offset-[3px] '
  + 'transition-colors duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';

/* THE TICK, AND IT IS ShapeMenu's — same 36px cell, same glyph, same green,
   because it is being asked the same question at the end of the same kind of
   gesture: keep what you just made. Two different pictures of one decision
   would say they were two decisions.
   THE CROSS THAT STOOD BESIDE IT IS GONE. It belonged to the manual run — see
   the block near the foot of this file — and there is no run to throw away. */
const ICON = 'flex items-center justify-center w-9 h-9 rounded-[7px] '
  + 'border-0 bg-transparent cursor-pointer p-0 '
  + 'transition-colors duration-[120ms] hover:bg-black/[0.07] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black/40';
const TICK = 'M4 10.6 L8.2 14.6 L16 5.6';
/* THE BIN, AND IT IS ShapeMenu's — same cell, same weight, same red. An array
   already on the drawing is offered the same two acts a committed shape is, so
   the picture of "remove this object" must not be a second invention. */
const BIN = 'M3.6 5.6h12.8M8 5.6V3.8h4v1.8M5.4 5.6l.8 10.6h7.6l.8-10.6';
const Glyph = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/**
 * `recommended` says the two figures showing are the engine's answer for the
 * point under the cursor and nobody has overruled them — it latches the chip,
 * and pressing it when it is not latched is the way back.
 *
 * `dirty`, `placed`, `space`, `onThis`, `onAll`, `onKeep` AND `onDiscard` WERE
 * HERE AND ARE GONE. The first three described a wattage change waiting on a
 * confirmation and a run of lamps waiting to be kept; neither thing exists any
 * more — a change on this bar is the choice from now on the moment it is made,
 * and a lamp is in the schedule the moment it is clicked. See the two blocks
 * further down where those controls stood.
 */
export default function CobSpec({
  stage, watts, beam, recommended = false,
  /* THE ARRAY BEING SET OUT, or null in manual mode. It carries what has been
     picked and what may be asked about it — see `arrayAsks` in lib/cob.js, which
     decides the controls from the GEOMETRY rather than leaving this bar to work
     it out from three flags. */
  array = null,
  /* THE TWO SCENE BUTTONS, DRAWN AT THE FAR END. See the note on `tail` in
     ShapeMenu: they say which DRAWING you are looking at, they belong to no
     contextual bar in particular, and they are on whichever one happens to be up
     so that there is never a second pill beside this one saying it. */
  tail = null,
  /* ...AND THE VIEW SWITCHES AT THE NEAR END, on the same terms: whatever this
     bar is currently doing, `lead` is there. See StageBar's three slots. */
  lead = null,
  onWatts, onBeam, onRecommended,
  onCount, onSide, onOffset, onPlaceArray, onDeleteArray,
}) {
  /* IS THE SPECIFICATION OPEN? Component state and not the caller's, because
     nothing outside this bar has an opinion about it: it is not a fact about
     the drawing, it does not survive the tool being put down, and no other
     control on this screen changes with it. The bar is unmounted the moment
     the gesture ends, which closes it for free. */
  const [specOpen, setSpecOpen] = React.useState(false);
  /* --- THE ONE BAR IN TWO TENSES ------------------------------------------
     `array.editing` SAYS THE RUN ALREADY EXISTS, and everything that differs
     between the two follows from that one fact rather than from a second
     component.

     A DRAFT IS BEING SET OUT: it needs a tick, and the wattage and optic
     showing are what the NEXT thing placed will be — so the Recommended chip
     and the two "update" buttons are about a decision still to come.

     A PLACED RUN IS BEING EDITED: there is nothing to confirm (every control
     writes straight through, see `setArrayShape`), the wattage and optic ARE
     this array's, and the one act left is to remove it. Offering "Update all
     next" here would be a button about future lamps sitting on a bar about
     twelve that are already in the schedule.

     ONE COMPONENT AND NOT TWO, because the middle of the bar — a count, a side,
     a distance, a wattage, eight optics — is identical in both, and two copies
     of it would be two bars to keep in step. */
  const editing = !!array?.editing;
  /* WHAT THE TICK IS, WORKED OUT HERE AND DRAWN AT THE END OF THE BAR. A
     variable rather than a branch down there because the two states are one
     decision — is this run being made, or has it been made — and reading it
     beside `editing` is where that decision already lives. `null` until a
     geometry has been taken: there is nothing to place and nothing to delete. */
  const arrayAction = !array?.picked ? null : (editing ? (
    /* THE RUN IS ALREADY ON THE DRAWING, so the act at the end of the bar is
       the only one left: take it off. The geometry it was set out on stays — it
       was there first, and it is very often a cove's own setting-out line. */
    <button type="button" title="Delete this array" className={ICON}
      style={{ color: '#b3261e' }} onClick={() => onDeleteArray?.()}>
      <Glyph d={BIN} />
    </button>
  ) : (
    /* KEEP THEM. The same tick the shape bar commits with, for the same act:
       what is on the drawing is a preview until somebody says yes. */
    <button type="button" title="Place these spots" className={ICON}
      style={{ color: '#0a7d3c' }} onClick={() => onPlaceArray?.()}>
      <Glyph d={TICK} />
    </button>
  ));

  /* --- THE TWO SPECIFICATION CONTROLS, BUILT ONCE ------------------------
     THEY APPEAR IN TWO PLACES NOW and they are one control each. Manual placing
     keeps them behind "Change"; a PLACED array shows them outright, because
     that bar is already the post-placement one and its whole subject is the run
     you have selected. Written as values rather than repeated in two branches
     for the reason the header gives about one component and not two: two copies
     of a slider and eight chips are two things to keep in step. */
  const wattControl = (<>
    {/* A SLIDER AND NOT FIFTY-THREE CHIPS. The optics are a product list and
        every one of them is a press worth having; 3 to 55 whole watts is a
        range, and a range is a thing you sweep to. See COB_WATT_RANGE. */}
    <span className={CAP}>Wattage</span>
    <input type="range" aria-label="Wattage"
      min={COB_WATT_RANGE.min} max={COB_WATT_RANGE.max} step={COB_WATT_RANGE.step}
      value={watts}
      className="w-[128px] mx-1 accent-black cursor-pointer"
      onChange={(e) => onWatts?.(Number(e.target.value))} />
    <span className={`${VAL} w-[38px] text-right`}>{watts} W</span>
  </>);

  /** THE OPTIC, AS THE EIGHT THAT ARE SOLD. */
  const beamControl = (<>
    <span className={CAP}>Beam</span>
    {BEAM_ANGLES.map((d) => (
      <button key={d} type="button" aria-pressed={beam === d}
        className={beam === d ? CHIP_ON : CHIP_OFF}
        onClick={() => onBeam?.(d)}>{d}°</button>
    ))}
  </>);

  return (
    /* IT CARRIED `flex-wrap` AND A 92vw CAP, AND BOTH ARE GONE. This is the
       longest bar in the app — a count, a side, a distance, a wattage and eight
       optics — so it was the one that hit the cap and split, and a contextual
       bar in two rows is a bar whose buttons move under your finger as you use
       it. It grows sideways instead; see the note on `flex-nowrap` in StageBar. */
    <StageBar stage={stage} lead={lead} tail={tail} label="Downlight">

      {/* --- WHAT THE ARRAY IS BEING SET OUT ON, AND HOW ------------------
          AHEAD OF THE SPECIFICATION, because it is the question that comes
          first: an array has to know its geometry before "7 W at 45 degrees" is
          about anything. The wattage and beam controls below are shared with
          manual placing and read exactly the same — one array is one decision
          about a run of lamps, which is why it is also one row in the Analysis.

          NOTHING PICKED YET IS THE ONE PLACE THIS BAR ASKS A QUESTION IN WORDS.
          Every other state of it is controls, because a control is its own
          label; here there is nothing to control until something on the drawing
          has been chosen, and a bar of dead inputs would not say that. */}
      {array && (<>
        {!array.picked ? (
          /* "OR THE SPACE" CAME OUT OF THIS SENTENCE because that gesture is
             gone: a press on bare ceiling used to take the room's own outline
             and put a lamp in each of its corners, and it now takes nothing
             (see `arrayDown`). A line telling somebody to do a thing the app
             no longer does is worse than no line. */
          <span className={CAP}>Draw or press a geometry to set out on</span>
        ) : (<>
          {/* THE GEOMETRY'S NAME WAS HERE AND IT IS GONE. It read "Rectangle" —
              the name of the primitive the run is set out on — and it was the
              one thing on this bar that was neither a control nor a number: the
              shape is on the drawing, highlighted, directly above the bar, and
              a word repeating what you are looking at is a caption on a picture
              you can see. A control is its own label; so is a shape. */}
          <span className={CAP}>Spots</span>
          {/* --- IT STEPS IN THE GEOMETRY'S OWN UNITS -----------------------
              `min` AND `step` ARE THE SHAPE'S, NOT 1 AND 1. A run on a closed
              shape is set out from its corners — every corner gets a lamp and
              each edge is then divided — so the counts a rectangle can produce
              are 4, 8, 12 and the ones a hexagon can are 6, 12, 18. See
              `arrayQuanta` in lib/cob.js.
              THE ARROWS ARE THEREFORE THE WHOLE CONTROL, and no caption is
              needed to say so: pressing up on a hexagon goes 6 to 12, which
              states the rule better than a sentence would. A browser steps from
              `min` in multiples of `step`, which is exactly the sequence.
              TYPING IS STILL FREE and is caught on the way in — the handler
              quantises, because a typed 7 has to become a run that exists. */}
          <input type="number" min={array.countMin ?? 1} max="200"
            step={array.countStep ?? 1} value={array.count}
            aria-label="How many spots"
            className="w-[52px] mx-1 px-1.5 py-[3px] text-[11.5px] tabular-nums
              rounded-[6px] border border-black/12 bg-transparent text-black
              focus-visible:outline-2 focus-visible:outline-offset-[-2px]
              focus-visible:outline-black/40"
            onChange={(e) => onCount?.(Number(e.target.value))} />
          {/* THE SIDE AND THE DISTANCE, AND ONLY WHERE THEY MEAN SOMETHING.
              An open path has no inside — "a foot in from a line" names two
              paths and nothing says which — so `arrayAsks` withholds both for
              one, and a room outline is offered them with OUTWARD struck off:
              outside a room's outline is the next flat. */}
          {array.side && (<>
            {SEP}
            {array.sides.map((sd) => (
              <button key={sd.id} type="button" aria-pressed={array.sideId === sd.id}
                className={array.sideId === sd.id ? CHIP_ON : CHIP_OFF}
                onClick={() => onSide?.(sd.id)}>{sd.label}</button>
            ))}
            {array.sideId !== 'on' && (<>
              <input type="number" min="0" step="0.25"
                max={array.maxOffsetFt > 0 ? array.maxOffsetFt.toFixed(2) : undefined}
                value={array.offsetFt} aria-label="Offset in feet"
                className="w-[58px] ml-1.5 px-1.5 py-[3px] text-[11.5px] tabular-nums
                  rounded-[6px] border border-black/12 bg-transparent text-black
                  focus-visible:outline-2 focus-visible:outline-offset-[-2px]
                  focus-visible:outline-black/40"
                onChange={(e) => onOffset?.(Number(e.target.value))} />
              <span className={CAP}>ft</span>
            </>)}
          </>)}
          {/* THE TICK USED TO STAND HERE and it is at the foot of this file
              now — see `arrayAction`. It was in the middle of its own bar, with
              the optics after it, which put the act that ENDS the gesture
              before two controls that are still part of making it. */}
        </>)}
        {SEP}
      </>)}

      {/* WHOSE SPECIFICATION THIS IS, AND IT IS A CONTROL RATHER THAN A TAG.
          Latched while the engine's answer is in force, which is what "we
          recommend this" looks like when it is true. Once something is standing
          instead, the same chip is the way back — the alternative was a second
          button called something like "Reset", which is a word for the thing
          this already is. */}
      {/* --- MANUAL PLACING: THE ANSWER, THEN A WAY TO ARGUE WITH IT ------
          `!array` AND NOT `!editing`, WHICH IS A NARROWING. The chip says the
          two figures showing are the engine's answer FOR THE POINT UNDER THE
          CURSOR and that nobody has overruled them — a sentence about the next
          lamp you click down. An array is not clicked down lamp by lamp: it is
          one act on a path, committed by the tick, and every one of its spots
          is the same figure.

          THE FIGURES ARE READ OUT BESIDE THE CHIP, WHICH IS THE POINT OF THIS
          BLOCK. "8 W · 36°" is the whole of what the bar has to say in the
          ordinary case, and it used to be spread across a slider, a number and
          eight chips — so the answer everybody agrees with was the hardest
          thing on the bar to read, and the bar was long enough to reach across
          the drawing. Two figures and a word is the state; the controls that
          change it come out only when somebody says so.

          THE CHIP IS STILL A CONTROL AND NOT A TAG. Latched while the engine's
          answer is in force, which is what "we recommend this" looks like when
          it is true; once something is standing instead, the same chip is the
          way back. The alternative was a second button called Reset, which is a
          word for the thing this already is. */}
      {!array && (<>
        <button type="button" aria-pressed={recommended} disabled={recommended}
          className={(recommended ? CHIP_ON : CHIP_OFF)
            + (recommended ? ' cursor-default' : ' border-black/12')}
          onClick={() => onRecommended?.()}>Recommended</button>
        <span className={`${VAL} ml-1.5 tabular-nums`}>{watts} W · {beam}°</span>
        <button type="button" className={LINK} aria-expanded={specOpen}
          style={{ color: specOpen ? '#000' : 'rgba(0,0,0,0.55)' }}
          onClick={() => setSpecOpen((o) => !o)}>Change</button>
        {specOpen && (<>
          {SEP}
          {wattControl}
          {SEP}
          {beamControl}
        </>)}
      </>)}

      {/* --- AND A PLACED ARRAY SHOWS THEM OUTRIGHT ------------------------
          NO "CHANGE" HERE, AND THE ASYMMETRY IS THE POINT. Manual placing hides
          the controls because the ordinary act is to agree and click the
          ceiling — the specification is in the way of the gesture. A selected
          array is not mid-gesture: it is on the drawing, and its wattage and
          optic are the reason you pressed it. Hiding them would put a press in
          front of the only thing that bar is for.
          AND NOTHING WHILE ONE IS BEING SET OUT. The wattage is answered
          afterwards, on the run — see the note in `placeArray`; what the
          placing bar is for is the two things that decide the RUN, how many and
          where against the line. */}
      {array && (<>
        {editing && (<>{wattControl}{SEP}</>)}
        {beamControl}
      </>)}

      {/* --- THE RUN'S OWN CONTROLS WERE HERE AND THEY ARE GONE ----------
          A COUNT, A CEILING'S NAME, A TICK AND A CROSS — "Space 1 · 1 placed",
          keep, throw away. All four described a RUN of manual lamps as a thing
          with a beginning and an end that had to be committed, and it never was
          one: every lamp is real the moment it is clicked, written straight
          through the reducer and in the schedule before the pointer has moved.
          So the tick kept what was already kept, and the cross was an undo with
          a worse name standing permanently on the bar — which is what made it
          the one press here that destroyed work.
          UNDO IS THE UNDO. Ctrl-Z takes back a lamp, or ten, in the order they
          were placed, and it is the gesture everybody already has. Putting the
          tool down is Escape or the next thing you reach for in the rail, which
          is how every other tool on this screen is put down. */}

      {/* --- THE ARRAY'S OWN ACT, AND IT IS THE LAST THING IN THIS SLOT ------
          A TICK ENDS A GESTURE, so it goes where the gesture ends: after every
          control that is still part of making the thing, and immediately before
          the rule that divides this slot from the scene switches. It sat in the
          middle — between the side chips and the optics — which read as though
          the optics were something else the bar also happened to have, rather
          than as the last question before you commit. The shape bar has always
          put its tick here; this is the same bar, in the same place, at the end
          of the same kind of gesture, and the two had no business disagreeing.
          THE BIN TAKES THE SAME POSITION for a run already on the drawing. It is
          the one act left on that bar, and an act that finishes with the object
          belongs where the act that finishes making one does. */}
      {arrayAction && (<>
        {SEP}
        {arrayAction}
      </>)}
    </StageBar>
  );
}
