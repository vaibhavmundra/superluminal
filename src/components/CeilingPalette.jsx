import React from 'react';
import { CEILING_BY_ID } from '../lib/ceilingObjects.js';

// ---------------------------------------------------------------------------
// CeilingPalette — three symbols in a row, not a dropdown.
//
// A dropdown asks you to READ the words and then commit before you can see
// what you picked. These are drawn objects with drawn symbols, and the symbol
// IS the name — the mark on the button says what this button drops into the
// ceiling, so choosing is recognition rather than reading, and what you
// clicked is confirmed by what shows up under the cursor.
//
// THE MARKS ARE ARTWORK NOW, shipped in /public/icons rather than drawn here
// as SVG. They used to be the plan's own line symbols reduced to a 24-unit
// box, which kept palette and drawing in lockstep but asked three hairlines to
// survive at button size. The pictures read; the plan keeps its line symbols,
// which is a divergence to be aware of when either side changes — the button
// has to stay recognisably the thing that lands on the drawing.
//
// ONE BUTTON PER GESTURE, NOT ONE PER CATALOGUE TYPE. An AC cassette and a
// trap door are the same act — drop a rectangle somebody else owns into this
// ceiling, and keep the lights off it — and they were spending two of four
// slots to say so, at the same square-inside-a-square. They share a slot now.
// Which of the two it is stays a real distinction on the plan and in the
// schedule, so it is chosen the way a fan's sweep is: after the gesture, in the
// row under the palette, where a property belongs.
// ---------------------------------------------------------------------------

// THE CHANDELIER LEFT THIS ROW, and it is worth saying where it went and why,
// because it is still a ceiling OBJECT in every other respect — it has a
// diameter, it reserves clearance, the grid keeps off it, it is `armed` and
// dropped by the same one-shot as a fan.
//
// What it is NOT is somebody else's item. Everything else in this palette is a
// thing the ceiling has to accommodate: a fan, a cassette, a hatch — placed by
// another trade, and this app's interest in them is entirely negative, which is
// to keep light off them. A chandelier is a LIGHT. It is chosen, specified and
// paid for as part of the same scheme as the strips and the sconces, and it was
// sitting in the row for obstacles because the geometry of dropping it happened
// to match. It is in LightPalette now, where somebody looking for a decorative
// fitting would go to find one.
//
// TWO BUTTONS, SO TWO COLUMNS. A three-column grid with two items leaves a slot
// of dead air that reads as a missing tool.
const GROUPS = [
  { key: 'fan',        ids: ['fan'],                icon: '/icons/fan.png' },
  // The crossed square is the hatch, which is the half of this pair that has a
  // mark everyone already knows. A cassette is the other half and does not get
  // its grille here — see the note above about one button and two types.
  { key: 'rect',       ids: ['ac', 'trapdoor'],     icon: '/icons/trap.png',
    label: 'AC / Trap door' },
];

export default function CeilingPalette({ armed, onArm, disabled = false }) {
  return (
    <div className="grid grid-cols-2 gap-[5px] mt-2">
      {GROUPS.map((g) => {
        // Armed if ANY of the group's types is, so choosing "trap door" in the
        // row below keeps this button lit rather than appearing to disarm it.
        // A disarmed group arms its first type again — the chooser row is
        // where a second one is asked for, and it is on screen the moment this
        // is lit. `armed` remains a single type id either way: the grouping is
        // the palette's idea, and nothing downstream has to learn about it.
        const on = g.ids.includes(armed);
        const armId = (on && armed) || g.ids[0];
        const label = g.label ?? CEILING_BY_ID[g.ids[0]]?.label ?? g.key;
        return (
          <button key={g.key} type="button" disabled={disabled}
            className={
              'flex flex-col items-center gap-[4px] pt-[9px] px-0.5 pb-[6px] rounded-[8px] cursor-pointer transition-colors duration-[120ms] disabled:opacity-[.45] disabled:cursor-not-allowed text-accent border ' +
              /* NO INLINE COLOUR. A type's `colour` is the ink the GHOST is
                 drawn in on the plan — an obstacle is somebody else's object
                 and stays grey there — and it was doing double duty as the
                 glyph's colour here. Two jobs, one field: turning the palette
                 blue would have turned the ghost blue with it. `text-accent`
                 is what the armed border and the label read, and `colour`
                 means the one thing again. */
              /* ARMED TAKES THE ACCENT RAMP AS A 1px RING.
                 It was `border-current` plus an inset 1px shadow in the same
                 colour — two declarations painting one edge, in a flat hue,
                 because a border cannot hold a gradient.
                 `gradient-ring` is the utility that can: a `::before` inset to
                 the button, filled with `--gradient-accent` and masked to its
                 own 1px padding so only the rim survives. Defined in styles.css
                 beside the gradient it reads. `border-transparent` keeps the
                 button's SIZE identical armed and not — the border box is still
                 1px, it just stops painting, so nothing shifts when you arm it.
                 The ring is `pointer-events: none`, so it cannot eat the click
                 that disarms the button it is drawn on. */
              (on
                ? 'border-transparent bg-input-bg gradient-ring'
                : 'border-border/10 bg-surface backdrop-blur-md enabled:hover:bg-input-bg')
            }
            title={label}
            onClick={() => onArm(on ? null : armId)}>
            {/* alt="" ON PURPOSE: the label below is the accessible name, and a
                screen reader reading "fan" twice is worse than not drawing the
                picture for it at all. */}
            <img src={g.icon} alt="" width="40" height="40"
              className="w-10 h-10 object-contain select-none" draggable="false" />
            {/* SUBTLE AT REST, WHITE WHEN ARMED — and `text-ink` was the bug.
                Ink is #000000, which is right on paper and all but invisible on
                this panel's frosted glass over a black page: arming a fan made
                its name DISAPPEAR, which is the opposite of what a latched
                control should do. White is the strongest thing a dark panel can
                say, and it is what the panel's tabs and its checked boxes
                already say it with.
                `text-subtle` rather than `text-muted` for the resting state —
                #7A7A7A against #525252. The label is a caption under a picture
                that already names the thing; muted was competing with the
                artwork for the same job. */}
            <span className={'text-[9.5px] leading-[1.15] text-center tracking-[0.01em] '
              + (on ? 'text-white' : 'text-subtle')}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
