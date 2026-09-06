import React from 'react';
import PaletteButton from './PaletteButton.jsx';

// ---------------------------------------------------------------------------
// LightPalette — the three fittings you add by hand, as three symbols.
//
// THE SAME ARGUMENT AS CeilingPalette, and deliberately the same component
// shape: the symbol is the name. What differs is that these three do not share
// a gesture. A sconce is one click on a wall, a strip is two clicks that span a
// run, a spot is a drag that encloses the thing being lit, a cove is a drag
// along the wall it sits on — so the button has
// to say what it will ASK OF YOU as well as what it will place, which is what
// the line under the row is for. A palette whose buttons all look alike and
// behave differently is a palette that gets clicked once and abandoned.
//
// THE MARKS ARE ARTWORK NOW, shipped in /public/icons, exactly as CeilingPalette
// carries its three. They were the plan's own line symbols flattened into a
// 24-unit box — a run with end ticks, a crosshair standing off its wall, a
// circle with an arrow — which kept the palette and the drawing in lockstep but
// asked three hairlines to survive at button size. Beside a row of ceiling
// objects rendered as pictures they also read as the unfinished half of one
// palette, which is the thing that actually decided it.
//
// THE DIVERGENCE IS REAL AND WORTH NAMING: the plan keeps its line symbols, so
// a button and the mark it places are no longer the same drawing. What has to
// hold is weaker but still binding — the button has to stay recognisably the
// thing that lands on the sheet. Change a fitting's symbol on the canvas and
// look at this row before deciding you are done.
//
// THE GESTURE PICTURE BELOW IS STILL DRAWN, and stays drawn. It is not an icon:
// it is a diagram of a drag and its consequence, it has to match the marquee the
// zones tab draws, and it is rendered at 72x46 where hairlines are fine.
// ---------------------------------------------------------------------------

/**
 * `arms` IS WHICH MACHINE A BUTTON TALKS TO, and it exists because this row is
 * no longer one machine's palette.
 *
 * Four of these arm `addTool` — the hand-placing tools whose gestures produce
 * accent zones and task surfaces. The chandelier arms `armed`, the ceiling
 * OBJECT one-shot, because that is what a chandelier is to this app's geometry:
 * a thing with a diameter that reserves clearance and that the grid keeps off.
 * It moved here from CeilingPalette because it is a LIGHT — chosen, specified
 * and paid for with the strips and the sconces — and the row of obstacles was
 * never where anybody would look for one. See the note in CeilingPalette.
 *
 * `arms: 'object'` rather than a hard-coded `id === 'chandelier'` test at the
 * call site: the next decorative fitting to move across should be a line in
 * this table and nothing else.
 */
export const LIGHT_TOOLS = [
  /* THE COVE IS FIRST, AND THE ORDER IS THE ORDER THE WORK HAPPENS IN. A
     reverse cove is not a fitting you mount on a ceiling, it is a change to
     what the ceiling IS — it re-cuts the grid, so every downlight after it is
     placed inside an answer this gesture gave. Offering it below the fittings
     would be offering to change the ceiling once somebody had finished laying
     out the lights on it. Same argument for the two hand-written cells that
     bracket it in the row.

     `surface: true` IS WHICH GROUP THE BUTTON SITS IN, not a second machine —
     it arms `addTool` like the fittings do. It exists so the two coves end up
     side by side: the row is drawn as [cove shape][surface tools][no-light
     zone][fittings], and without the flag the map would have put the reverse
     cove and the shape tool at opposite ends of the group they belong to. */
  /* THE TRACK, AND IT IS THE ONE TOOL HERE THAT PLACES NO FITTING. A track is
     a CARRIER: a profile clicked out across a ceiling that has already been
     laid out, which then swallows the downlights it can reach and turns them
     into modules on itself. Nothing about the grid changes — see the doctrine
     at the top of track.js — so it belongs with the fittings and not with the
     surface tools, even though it is drawn with a pen like the cove is. */
  { id: 'track',  label: 'Track', pen: true,
    stepTitle: 'Click out the run',
    hint: 'Click each corner. Runs lock square.',
    consequence: 'Lights within three feet clip onto it.' },
  { id: 'cove',   label: 'Reverse cove', surface: true,
    stepTitle: 'Span the wall the cove runs along',
    hint: 'Press at one end and drag along the wall.',
    consequence: 'It follows the wall you started on.' },
  { id: 'strip',  label: 'LED strip',
    hint: 'Click the two ends of the run.' },
  { id: 'sconce', label: 'Sconce',
    hint: 'Click a wall — the fitting seats itself on it.' },
  { id: 'spot',   label: 'Directional spot',
    hint: 'Drag a box round what it should light.',
    /* THE STEP'S HEADING. Only the two tools with a `GESTURE` carry one, and
       that is not a coincidence — arming either of them empties the panel down
       to a step (see the branch in App.jsx), and a step needs a line at the top
       saying what is being asked. It is an IMPERATIVE where `hint` is a
       description: the heading asks, the card under it explains. */
    stepTitle: 'Box what the spot should light',
    // WHAT HAPPENS NEXT, WHICH IS THE HALF NOBODY GUESSES. The other two tools
    // put a fitting where you click. This one does not put a fitting anywhere
    // you point: the box says what is being lit, and the placer then stands the
    // spot on the ceiling's own grid, off to one side, aimed back at the box.
    // Somebody who does not know that drags the box where they want the FITTING
    // — and gets a spot several feet away from it, which reads as a bug in the
    // app rather than as the feature it is.
    // SHORT, because the picture is carrying it. "On the ceiling nearby" cost a
    // fourth line in a card whose drawing already shows the fitting standing off
    // to the side; the sentence only has to name the surprise, not describe it.
    consequence: 'The spot lands nearby, aimed at it.' },
  { id: 'chandelier', label: 'Chandelier', arms: 'object',
    hint: 'Click the ceiling to drop it.',
    // WHY IT IS NOT SIMPLY "click to place". A chandelier reserves clearance
    // like a fan does, so the grid moves out of its way — which looks like the
    // lights having been deleted if you did not know it was coming.
    consequence: 'The ambient grid keeps clear of it.' },
];

/**
 * The picture on each button. Keyed by tool id, so the row and LIGHT_TOOLS
 * cannot fall out of step: a tool added without artwork renders no image rather
 * than a broken one — see the guard at the call site.
 */
export const LIGHT_ICON = {
  strip:  '/icons/led_strip.png',
  sconce: '/icons/sconce.png',
  spot:   '/icons/directional.png',
  chandelier: '/icons/chandelier.png',
  cove:   '/icons/reverse_cove.png',
  track:  '/icons/track.png',
};

/**
 * THE GESTURE, DRAWN. Only the spot has one, and that is the point rather than
 * an omission.
 *
 * The zones tab's own note makes the argument this borrows: "draw a box" is a
 * sentence about a GESTURE, and a sentence is a poor way to describe one — it
 * has to be read and then imagined. A picture of the marquee being dragged is
 * the gesture itself, at a glance.
 *
 * It earns the space here for a second reason the zone hint does not have: the
 * spot is the one tool whose RESULT is not where the gesture is. The box, the
 * pointer dragging its far corner, and the fitting standing off to the side with
 * its beam pointing back into the box are three marks saying the one thing a
 * sentence keeps failing to: you are not placing the light, you are naming what
 * the light is for.
 *
 * DELIBERATELY THE ZONE HINT'S OWN VISUAL LANGUAGE — the same 72x46 box, the
 * same dashed marquee with a live corner, the same pointer — because it is the
 * same gesture. Two different pictures of one drag would say they were two
 * different drags. What is added is the consequence, in the accent, drawn as
 * PlanCanvas draws a spot: a ring with a filled pupil and an arrow off its rim.
 */
/* EXPORTED, because the spot's card is now drawn in two places and must not
   become two drawings. Arming the spot from this palette empties the panel down
   to a step — the no-light zone's shape, see the branch in App.jsx — and that
   step shows this same picture at the same size. A copy over there would drift
   the first time the marquee or the stand-off fitting was retouched here, and
   the two would then disagree about what the gesture is. */
export const GESTURE = {
  spot: (
    <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible" aria-hidden="true">
      {/* What is being lit: the box, and the corner the drag started from. */}
      <rect x="24" y="10" width="37" height="24" rx="2"
        fill="var(--accent)" fillOpacity="0.07"
        stroke="var(--text-subtle)" strokeWidth="1.4" strokeDasharray="4 3" />
      <circle cx="24" cy="10" r="2" fill="var(--text-subtle)" />
      {/* ...and the pointer dragging the far corner, tip ON it, so the two read
          as one gesture rather than as a box and an arrow. */}
      <g transform="translate(61 34)">
        <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
          fill="var(--accent)" stroke="#fff" strokeWidth="1.1"
          strokeLinejoin="round" />
      </g>
      {/* THE FITTING, OFF TO THE SIDE. At the middle of the left edge on
          purpose: the two corners are spoken for by the drag — one by its start
          dot, the other by the pointer — and a beam crossing either of them
          would read as part of the gesture instead of as its consequence. */}
      <g stroke="var(--accent)" strokeLinecap="round">
        <circle cx="7" cy="22" r="4.3" fill="#fff" strokeWidth="1.7" />
        <circle cx="7" cy="22" r="1.7" fill="var(--accent)" stroke="none" />
        <line x1="12" y1="22" x2="19.5" y2="22" strokeWidth="1.6" fill="none" />
        <path d="M20.6,22 L16.4,20 L16.4,24 Z" fill="var(--accent)" stroke="none" />
      </g>
    </svg>
  ),
  /* THE COVE'S GESTURE, AND IT EARNS A PICTURE FOR THE REASON THE SPOT DOES:
     the thing that is hard to guess is not where you press, it is where the
     drag is ALLOWED to go. The slot is locked to the wall the press landed on,
     so the end only ever slides along that wall — pull the pointer out into the
     room and the end stays on the line. A sentence has to say that in a clause
     nobody reads; two dots on one wall with the band between them and the
     pointer off the wall but the end still on it says it at a glance.

     THE WALL IS THE HEAVY LINE ALONG THE TOP and the band hangs INSIDE it, which
     is where a reverse cove actually sits — eight inches of ceiling at the wall,
     washing down it. Drawn in the accent because the tape is the thing being
     placed; the wall is the drawing's own ink. */
  cove: (
    <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible" aria-hidden="true">
      {/* The room, and the wall being coved along its top edge. */}
      <rect x="6" y="9" width="60" height="30" rx="1.5"
        fill="none" stroke="var(--text-subtle)" strokeWidth="1" strokeOpacity="0.45" />
      <line x1="6" y1="9" x2="66" y2="9" stroke="var(--text-subtle)" strokeWidth="2.2" />
      {/* The slot: the band, its inner lip, and the tape down the middle. */}
      <rect x="17" y="9" width="34" height="6" fill="var(--accent)" fillOpacity="0.18" />
      <line x1="17" y1="15" x2="51" y2="15" stroke="var(--accent)" strokeWidth="1.2" />
      <line x1="17" y1="12" x2="51" y2="12" stroke="var(--accent)" strokeWidth="1.6"
        strokeLinecap="round" />
      {/* Where the press landed, and where the drag has got to — both ON the
          wall, whatever the pointer is doing. */}
      <circle cx="17" cy="9" r="2.1" fill="var(--accent)" />
      <circle cx="51" cy="9" r="2.1" fill="#fff" stroke="var(--accent)" strokeWidth="1.5" />
      {/* ...and the pointer OFF the wall, out in the room, with the end left
          behind on the line. That gap is the whole instruction. */}
      <line x1="51" y1="9" x2="57" y2="27" stroke="var(--text-subtle)" strokeWidth="1"
        strokeDasharray="2 2.5" />
      <g transform="translate(55 26)">
        <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
          fill="var(--accent)" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" />
      </g>
    </svg>
  ),
  /* THE TRACK'S GESTURE. It earns a picture for a third reason again: the pen
     is the only tool on this panel that takes MORE THAN ONE CLICK, and a
     sentence saying so is read once and then forgotten halfway through the
     path. Three dots with the run bending through them says "keep clicking" at
     a glance, and the square corner says the segments lock.

     THE ABSORPTION IS THE OTHER HALF, and it is the half nobody guesses. Two
     downlights are drawn ON the profile with their grid positions ghosted
     beside them, which is the whole claim the tool makes: the layout did not
     change, the fittings slid onto the run. Without it a person expects a track
     to be a line and is surprised by their lights moving. */
  track: (
    <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible" aria-hidden="true">
      {/* The room. */}
      <rect x="5" y="7" width="62" height="32" rx="1.5"
        fill="none" stroke="var(--text-subtle)" strokeWidth="1" strokeOpacity="0.45" />
      {/* Where the fittings were, before the profile reached them. */}
      <g fill="none" stroke="var(--text-subtle)" strokeWidth="1" strokeOpacity="0.55">
        <circle cx="27" cy="18.5" r="2.4" strokeDasharray="1.6 1.6" />
        <circle cx="45" cy="30.5" r="2.4" strokeDasharray="1.6 1.6" />
      </g>
      {/* The run: two clicked corners and the leg between them, locked square. */}
      <path d="M15 13 L47 13 L47 34" fill="none" stroke="var(--accent)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {/* ...and the two heads, now on it. The short move each one made is the
          picture's point, so it is drawn. */}
      <g stroke="var(--text-subtle)" strokeWidth="0.9" strokeDasharray="1.5 1.5">
        <line x1="27" y1="18.5" x2="27" y2="13" />
        <line x1="45" y1="30.5" x2="47" y2="30.5" />
      </g>
      <g fill="var(--accent)">
        <circle cx="27" cy="13" r="2.6" />
        <circle cx="47" cy="30.5" r="2.6" />
      </g>
      {/* The points that were clicked, ringed the way the pen rings them. */}
      <g fill="#fff" stroke="var(--accent)" strokeWidth="1.4">
        <circle cx="15" cy="13" r="2.1" />
        <circle cx="47" cy="13" r="2.1" />
      </g>
    </svg>
  ),
};

/**
 * `objArmed` IS THE CEILING-OBJECT ONE-SHOT, alongside `tool` which is the
 * hand-placing one. Two pieces of state rather than one because they are two
 * different machines with two different lifetimes — see `arms` above — and this
 * row is the one place both are on screen, so it is the one place that has to
 * ask which of them a button is lit by.
 */
/**
 * `shapeOn` / `onShape` AND `zoneOn` / `onZones` ARE THE TWO CELLS THAT ARE NOT
 * TOOLS, and they come in as their own props rather than as rows in
 * `LIGHT_TOOLS` because neither one arms a placer.
 *
 * Every entry in that table arms a tool and then waits for a gesture on the
 * canvas with the panel still standing. These two open a STEP: the cove shape
 * tool hands the drawing its own bar (see ShapeMenu), and the no-light zone
 * empties the panel down to an instruction and a list, the way confirming the
 * doors does. Folding them into the table would have meant a `kind` field on
 * five rows that do not need one, and an `onPick` that sometimes arms and
 * sometimes navigates.
 *
 * THEY WERE A "CEILING" SECTION OF THEIR OWN, ABOVE THIS ONE, and the split did
 * not survive being looked at. The argument for it was that a cove and a zone
 * are statements about the SURFACE where the rest of the row is things mounted
 * on it — which is true, and is a reason to put them FIRST, not a reason to put
 * a heading between them. Two headings meant two palettes, and somebody
 * laying out light had to know which of them owned "keep the light off this"
 * before they could look for it. One section, ordered surface-first.
 *
 * Each renders only when it is wired. The read-only panel passes neither, and a
 * palette with dead buttons on it would be a claim that an operator can draw on
 * somebody else's plan.
 */
export default function LightPalette({ tool, objArmed = null, onPick, disabled = false,
                                       shapeOn = false, onShape = null,
                                       zoneOn = false, onZones = null }) {
  const isOn = (t) => (t.arms === 'object' ? objArmed === t.id : tool === t.id);
  const live = LIGHT_TOOLS.find(isOn);
  /* THE ROW IN TWO HALVES — see `surface` on the cove. Filtered rather than
     sliced by index so adding a second surface tool is one field. */
  const surfaces = LIGHT_TOOLS.filter((t) => t.surface);
  const fittings = LIGHT_TOOLS.filter((t) => !t.surface);
  const cell = (t) => (
    /* THE CELL IS SHARED — see PaletteButton. What is left here is this
       palette's own part: which of the two machines a press arms. */
    <PaletteButton key={t.id} icon={LIGHT_ICON[t.id]} label={t.label}
      on={isOn(t)} disabled={disabled}
      title={`${t.label} — ${t.hint}`}
      onClick={() => onPick(isOn(t) ? null : t.id, t.arms ?? 'tool')} />
  );
  return (
    <>
      {/* SEVEN CELLS IN A THREE-WIDE GRID — everything you can put on a
          ceiling by hand, in one row rather than in two sections with a heading
          between them. See the note on `onShape`/`onZones` for why the split
          came out.

          THE ORDER IS SURFACE FIRST, FITTINGS AFTER. The three cells that say
          what the ceiling IS — the cove shape tool, the reverse cove, the
          no-light zone — fill the first line; the four things you mount on it
          follow. That is the order the work happens in, and it happens to make
          the two hand-written cells and the table's first row one clean line.

          THREE COLUMNS AND NOT SEVEN, which leaves two holes at the end and is
          worth them: seven columns shrinks every button to fit the narrowest
          panel and makes the artwork — the whole point of a palette whose
          symbols are its names — too small to recognise. */}
      <div className="grid grid-cols-3 gap-[5px] mt-2">
        {/* THE CEILING'S OWN SHAPE. It does not arm a placer: it opens a bar on
            the DRAWING, which is where its primitives live. See ShapeMenu. */}
        {onShape && (
          <PaletteButton icon="/icons/cove.png" label="Cove" title="Cove"
            on={shapeOn} disabled={disabled} onClick={onShape} />
        )}
        {surfaces.map(cell)}
        {/* THE ABSENCE OF LIGHT, and the one cell here that is not `disabled`
            with the rest: the tools need a scale and a lit space before they can
            place anything at real size, and a zone is a box over the drawing —
            it needs neither. */}
        {onZones && (
          <PaletteButton icon="/icons/no_light_zone.png" label="No Light Zone"
            title="No Light Zone — box out anything the light should keep off."
            on={zoneOn} onClick={onZones} />
        )}
        {fittings.map(cell)}
      </div>
      {/* WHAT THE ARMED TOOL WANTS FROM YOU. Only while one is armed: three
          gesture descriptions on screen at rest is a manual, and one at the
          moment it applies is an instruction.
          
          A PICTURE WHERE THERE IS ONE, AND THE SENTENCE OTHERWISE. Not a
          fallback to be filled in later — a hint card is worth its space where
          the gesture is hard to imagine or its result lands somewhere
          surprising, and "click a wall" is neither. The card also drops the
          tool's NAME, which the sentence version needs and it does not: the
          button directly above it is visibly pressed, and its own label is
          two lines up. */}
      {/* THE CARD BRANCH IS ALL BUT UNREACHABLE NOW, AND IT STAYS. Arming a
          tool that HAS a gesture is what opens the step in App.jsx — same test,
          `GESTURE[id]` — and that step replaces this panel, palette and all. So
          in practice the sentence below is what renders (strip, sconce,
          chandelier) and the card is what the step draws. It is kept because
          the two tests are one decision recorded in two places rather than one:
          the day a gesture tool is deliberately left out of the step, this is
          the explanation it falls back to, and a palette that then said nothing
          about the hardest gesture on it would be the worse failure. */}
      {live && (GESTURE[live.id] ? (
        <div className="flex flex-col items-center gap-2 pt-3.5 px-4 pb-3 rounded-lg border border-border bg-input-bg text-center mt-2">
          {GESTURE[live.id]}
          <p className="m-0 text-[11px] leading-[1.5] text-muted max-w-[30ch]">
            {live.hint}{live.consequence ? ` ${live.consequence}` : ''}
            <br /><span className="text-subtle"><b>Esc</b> to put it away.</span>
          </p>
        </div>
      ) : (
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">
          <b>{live.label}.</b> {live.hint} <b>Esc</b> to put it away.
        </p>
      ))}
    </>
  );
}
