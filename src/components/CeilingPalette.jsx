import React from 'react';
import { CEILING_BY_ID } from '../lib/ceilingObjects.js';
import PaletteButton from './PaletteButton.jsx';

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
/* --- IT IS THE ELECTRICAL ROW NOW, AND THE PAIR CAME APART -----------------
   THE CASSETTE AND THE TRAP DOOR SHARED A BUTTON, and the argument for it — one
   button per GESTURE, since both are "drop a rectangle somebody else owns into
   this ceiling" — was sound while there were four slots and two things to put in
   them. It stopped being sound the moment the row grew: the two are now sitting
   among four other items that each have a button of their own, so the one shared
   cell was the only place in the palette where picking the thing you wanted took
   two presses and a chooser row. The type chip under the palette went with it.

   AND THE SWITCHBOARD IS SECOND, DIRECTLY AFTER THE FAN. Not at the end, where a
   new tool naturally lands: it is the only item here that is the SUBJECT of the
   electrical drawing rather than a thing that drawing has to account for, and it
   is the one people will reach for repeatedly. The fan keeps the first slot
   because it is the item that changes the LAYOUT most.

   IT ARMS A DIFFERENT MACHINE, WHICH IS WHY `arms` EXISTS. Five of these drop a
   catalogue object at a point; the switchboard seats a plate on a WALL, and it
   takes over the panel while it is armed — the same shape LightPalette uses for
   the chandelier, and for the same reason: the row is a row of things to place,
   not a row of one machine's tools. */
export const CEILING_GROUPS = [
  { key: 'fan',        ids: ['fan'],       icon: '/icons/new_icons/fan.png' },
  /* LABELLED FOR WHAT IT PLACES, WHICH IS A SOCKET. It is a switchboard — one
     socket and no switch, the one composition allowed to have none — and calling
     the button "Switchboard" would promise the wrong thing twice: that something
     gets switched FROM it, and that there is a configuring step afterwards.
     There is not. It lands, it wires itself to the nearest board, and that board
     grows the switch. */
  { key: 'board',      ids: ['board'],     icon: '/icons/new_icons/switchboard.png',
    label: 'Socket', arms: 'board' },
  /* THE TWO POINTS, BESIDE THE SOCKET. All three are the electrical drawing's
     own subjects rather than things it has to accommodate, so they sit together
     and ahead of the plant. Both arm the ordinary one-shot — one press, one
     point, disarm — because that is the gesture.
     TWO CELLS AND NOT ONE WITH A CHOOSER, unlike the cassette and the trap door
     that used to share. Those two are the same act on the same surface; these
     are not: one snaps to the plaster and carries a height, the other goes on
     the ceiling and cannot have one. A shared cell would make the commonest
     thing here take two presses to say which surface you meant.
     LABELLED HERE BECAUSE THERE IS NO CATALOGUE ENTRY TO ASK. Neither is a
     ceiling object — no diameter, no clearance, and the grid owes them nothing —
     so they carry their own names the way the socket does. See
     lib/elecPoints.js. */
  { key: 'wallpoint',  ids: ['wallpoint'], icon: '/icons/new_icons/wall_point.png',
    label: 'Wall point' },
  { key: 'ceilingpoint', ids: ['ceilingpoint'],
    icon: '/icons/new_icons/ceiling_point.png', label: 'Ceiling point' },
  { key: 'ac',         ids: ['ac'],        icon: '/icons/new_icons/casette.png' },
  { key: 'split_ac',   ids: ['split_ac'],  icon: '/icons/new_icons/split.png' },
  // The crossed square, which is the mark everyone already knows for a hatch.
  { key: 'trapdoor',   ids: ['trapdoor'],  icon: '/icons/new_icons/trap.png' },
];

/**
 * `armed` is a catalogue id, or the string 'board' while the switchboard step is
 * open — the caller keeps those in two different pieces of state and passes
 * whichever is live, because to this row they are one question: which cell is
 * lit. `onArm` is handed the id and the machine, so the caller does not have to
 * test for a magic string of its own.
 */
export default function CeilingPalette({ armed, onArm, disabled = false }) {
  return (
    <div className="grid grid-cols-3 gap-[5px] mt-2">
      {CEILING_GROUPS.map((g) => {
        // Armed if ANY of the group's types is, so choosing "trap door" in the
        // row below keeps this button lit rather than appearing to disarm it.
        // A disarmed group arms its first type again — the chooser row is
        // where a second one is asked for, and it is on screen the moment this
        // is lit. `armed` remains a single type id either way: the grouping is
        // the palette's idea, and nothing downstream has to learn about it.
        const on = g.ids.includes(armed);
        const armId = (on && armed) || g.ids[0];
        // THE CATALOGUE NAMES ITSELF wherever there is a catalogue entry to ask.
        // The switchboard and the wall point have none — neither is a ceiling
        // object — so they are the two rows that carry their own label.
        const label = g.label ?? CEILING_BY_ID[g.ids[0]]?.label ?? g.key;
        return (
          /* THE CELL IS SHARED — see PaletteButton. What is left here is the
             only part that is this palette's: which id a press arms, and which
             machine it arms it on. */
          <PaletteButton key={g.key} icon={g.icon} label={label} on={on}
            disabled={disabled}
            onClick={() => onArm(on ? null : armId, g.arms ?? 'object')} />
        );
      })}
    </div>
  );
}
