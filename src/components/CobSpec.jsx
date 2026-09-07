import React, { useCallback, useEffect, useState } from 'react';
import { BEAM_ANGLES, COB_WATT_RANGE } from '../lib/cob.js';

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

/** Its clearance from the foot of the stage. ShapeMenu's own figure — the two
 *  are never up together, so they sit in the same place rather than beside each
 *  other. That is enforced rather than hoped for: arming a COB closes the shape
 *  tool, and opening an array closes both (see `openArray` in App.jsx). Two bars
 *  at this figure would be two rows of buttons in one place, half of them about
 *  an object nobody is looking at. */
const BOTTOM = 26;

const CAP = 'text-[10.5px] leading-none tracking-[0.02em] text-black/55 px-1.5 select-none';
const VAL = 'text-[11.5px] leading-none text-black tabular-nums '
  + '[font-variant-numeric:tabular-nums] select-none';
const SEP = <span className="w-px h-5 bg-black/10 mx-1" aria-hidden="true" />;

const CHIP = 'px-[6px] py-[4px] text-[10.5px] rounded-[6px] border cursor-pointer '
  + 'tabular-nums leading-none transition-colors duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';
const CHIP_OFF = `${CHIP} text-black/70 border-transparent bg-transparent hover:bg-black/[0.07]`;
/* THE SAME BLACK CHIP THE SHAPE BAR LATCHES WITH, so a picked optic here and a
   picked shape there are visibly the same kind of state. */
const CHIP_ON = `${CHIP} text-white border-black bg-black hover:bg-black`;

const BTN = 'px-2.5 py-[5px] text-[11px] leading-none rounded-[6px] border '
  + 'cursor-pointer transition-colors duration-[120ms] whitespace-nowrap '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';
const BTN_QUIET = `${BTN} border-black/12 bg-transparent text-black/75 hover:bg-black/[0.07]`;
const BTN_SOLID = `${BTN} border-black bg-black text-white hover:bg-black/85`;

/* THE TICK AND THE CROSS, AND THEY ARE ShapeMenu's — same 36px cell, same
   glyphs, same green and red, because they are being asked the same question at
   the end of the same kind of gesture: keep what you just made, or throw it
   away. Two different pictures of one decision would say they were two
   decisions. */
const ICON = 'flex items-center justify-center w-9 h-9 rounded-[7px] '
  + 'border-0 bg-transparent cursor-pointer p-0 '
  + 'transition-colors duration-[120ms] hover:bg-black/[0.07] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black/40';
const TICK = 'M4 10.6 L8.2 14.6 L16 5.6';
const CROSS = 'M5 5 L15 15 M15 5 L5 15';
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
 * WHERE THE BAR SITS — centred over the stage, near its foot. Measured rather
 * than positioned, for ShapeMenu's two reasons: the stage is a scroll container,
 * so an absolutely positioned child scrolls away with the drawing; and this must
 * not be inside the <svg>, where the zoom would scale it.
 *
 * `null` while the stage has not been measured, which is one frame on mount.
 */
function useStageRect(stage) {
  const [box, setBox] = useState(null);
  const measure = useCallback(() => {
    const el = stage?.current;
    setBox(el ? el.getBoundingClientRect() : null);
  }, [stage]);
  useEffect(() => {
    measure();
    const el = stage?.current;
    window.addEventListener('resize', measure);
    el?.addEventListener('scroll', measure);
    // The stage changes width when the panel does, and neither of the two
    // listeners above fires for that.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      el?.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, stage]);
  return box;
}

/**
 * `recommended` says the two figures showing are the engine's answer for the
 * point under the cursor and nobody has overruled them. `dirty` says there is a
 * change waiting on one of the two buttons. `placed` is how many lamps this run
 * of the tool has put down, which is what the tick and the cross act on, and
 * `space` is the name of the ceiling it has claimed — null until the first lamp
 * lands. See `cobLock` in App.jsx.
 */
export default function CobSpec({
  stage, watts, beam, recommended = false, dirty = false,
  placed = 0, space = null,
  /* THE ARRAY BEING SET OUT, or null in manual mode. It carries what has been
     picked and what may be asked about it — see `arrayAsks` in lib/cob.js, which
     decides the controls from the GEOMETRY rather than leaving this bar to work
     it out from three flags. */
  array = null,
  onWatts, onBeam, onRecommended, onThis, onAll, onKeep, onDiscard,
  onCount, onSide, onOffset, onPlaceArray, onDeleteArray,
}) {
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
  const box = useStageRect(stage);
  if (!box) return null;

  return (
    <div
      className="fixed z-30 flex items-center flex-wrap gap-y-1 max-w-[92vw]
        rounded-[11px] bg-white border border-black/[0.10]
        shadow-[0_6px_24px_rgba(0,0,0,0.22)] px-2 py-1.5"
      style={{ left: (box.left + box.right) / 2,
               bottom: Math.max(12, window.innerHeight - box.bottom + BOTTOM),
               transform: 'translateX(-50%)' }}
      /* NOTHING IN HERE IS A PRESS ON THE PLAN. The bar floats over the drawing,
         so without this a press on a beam chip would also be the press that
         places a fitting — under the bar. Same guard ShapeMenu carries. */
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}>

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
          <span className={CAP}>Click a geometry, or the space, to set out on</span>
        ) : (<>
          <span className={CAP}>{array.label}</span>
          {SEP}
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
          {SEP}
          {editing ? (
            /* THE RUN IS ALREADY ON THE DRAWING, so the act at the end of the
               bar is the only one left: take it off. The geometry it was set out
               on stays — it was there first, and it is very often a cove's own
               setting-out line. */
            <button type="button" title="Delete this array" className={ICON}
              style={{ color: '#b3261e' }} onClick={() => onDeleteArray?.()}>
              <Glyph d={BIN} />
            </button>
          ) : (
            /* KEEP THEM. The same tick the shape bar commits with, for the same
               act: what is on the drawing is a preview until somebody says
               yes. */
            <button type="button" title="Place these spots" className={ICON}
              style={{ color: '#0a7d3c' }} onClick={() => onPlaceArray?.()}>
              <Glyph d={TICK} />
            </button>
          )}
        </>)}
        {SEP}
      </>)}

      {/* WHOSE SPECIFICATION THIS IS, AND IT IS A CONTROL RATHER THAN A TAG.
          Latched while the engine's answer is in force, which is what "we
          recommend this" looks like when it is true. Once something is standing
          instead, the same chip is the way back — the alternative was a second
          button called something like "Reset", which is a word for the thing
          this already is. */}
      {!editing && (<>
        <button type="button" aria-pressed={recommended} disabled={recommended}
          className={(recommended ? CHIP_ON : CHIP_OFF)
            + (recommended ? ' cursor-default' : ' border-black/12')}
          onClick={() => onRecommended?.()}>Recommended</button>
        {SEP}
      </>)}

      {/* --- THE WATTAGE, AS A SLIDER --------------------------------------
          A SLIDER AND NOT FIFTY-THREE CHIPS. The optics below are a product list
          and every one of them is a press worth having; 3 to 55 whole watts is a
          range, and a range is a thing you sweep to. See COB_WATT_RANGE. */}
      <span className={CAP}>Wattage</span>
      <input type="range" aria-label="Wattage"
        min={COB_WATT_RANGE.min} max={COB_WATT_RANGE.max} step={COB_WATT_RANGE.step}
        value={watts}
        className="w-[128px] mx-1 accent-black cursor-pointer"
        onChange={(e) => onWatts?.(Number(e.target.value))} />
      <span className={`${VAL} w-[38px] text-right`}>{watts} W</span>

      {SEP}

      {/* --- THE OPTIC, AS THE EIGHT THAT ARE SOLD ------------------------- */}
      <span className={CAP}>Beam</span>
      {BEAM_ANGLES.map((d) => (
        <button key={d} type="button" aria-pressed={beam === d}
          className={beam === d ? CHIP_ON : CHIP_OFF}
          onClick={() => onBeam?.(d)}>{d}°</button>
      ))}

      {/* --- WHICH LAMPS THE CHANGE IS ABOUT -------------------------------
          ONLY ONCE THERE IS A CHANGE. Two buttons standing on an untouched bar
          would be two things to decide about before placing a fitting that
          needed no decision at all — and the ordinary press here is the one on
          the ceiling, not on this. */}
      {dirty && !editing && (<>
        {SEP}
        <button type="button" className={BTN_QUIET} onClick={() => onThis?.()}>
          Update this
        </button>
        <button type="button" className={`${BTN_SOLID} ml-1.5`} onClick={() => onAll?.()}>
          Update all next
        </button>
      </>)}

      {/* --- AND THE RUN ITSELF: KEEP IT, OR THROW IT AWAY -----------------
          GREYED UNTIL THERE IS A RUN TO DECIDE ABOUT, which is ShapeMenu's own
          rule for the same pair: a tick that silently does nothing is worse than
          one that visibly cannot yet. The count is printed beside them because
          the cross is the one press on this bar that destroys work, and it has
          to say how much — "throw away" is a different proposition at one lamp
          and at nineteen.
          BOTH END THE RUN. The tick keeps the lamps and puts the tool down; the
          cross takes them off the drawing and puts the tool down. Neither is a
          pause: there is no state in which some lamps are placed and others are
          pending, because every lamp was real the moment it was clicked. */}
      {/* THE RUN, AND IT IS MANUAL PLACING'S. An array is committed by its own
          tick above — it is one act, not a run of them — so a count of loose
          lamps and a cross that throws them away would be about nothing here. */}
      {!array && (<>
      {SEP}
      {/* WHAT THE TICK AND THE CROSS ARE ABOUT, WHICH IS A COUNT AND A CEILING.
          The count because the cross destroys work and has to say how much —
          "throw away" is a different proposition at one lamp and at nineteen.
          The NAME because from the first lamp onward every other ceiling on the
          sheet is dead to this tool (see `cobLock`), and the one thing that
          makes a dead click legible in advance is knowing which room the run
          belongs to. It is a fact, not an instruction: the pointer already
          refuses out there, and this says why. */}
      <span className={`${CAP} tabular-nums`}>
        {space ? `${space} · ` : ''}{placed} placed
      </span>
      <button type="button" title="Keep these placements" disabled={!placed}
        className={ICON}
        style={{ color: '#0a7d3c', opacity: placed ? 1 : 0.35,
                 cursor: placed ? 'pointer' : 'not-allowed' }}
        onClick={() => onKeep?.()}>
        <Glyph d={TICK} />
      </button>
      <button type="button" title="Throw these placements away" disabled={!placed}
        className={ICON}
        style={{ color: '#b3261e', opacity: placed ? 1 : 0.35,
                 cursor: placed ? 'pointer' : 'not-allowed' }}
        onClick={() => onDiscard?.()}>
        <Glyph d={CROSS} />
      </button>
      </>)}
    </div>
  );
}
