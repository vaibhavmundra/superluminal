import React from 'react';
import PaletteButton from './PaletteButton.jsx';
import { LIGHT_TOOLS, LIGHT_ICON } from './LightPalette.jsx';
import { CEILING_GROUPS } from './CeilingPalette.jsx';
import { CEILING_BY_ID } from '../lib/ceilingObjects.js';

/* ---------------------------------------------------------------------------
   THE TOOLS, DOWN THE LEFT EDGE, BESIDE THE THING THEY ACT ON.
   They were two grids in the right-hand panel — Lighting, then Electrical
   elements — under a tab you had to be on, above a spaces list and a View
   disclosure. That put every act you can perform on the drawing in the same
   column as every fact ABOUT the drawing, and the column had to scroll.
   A tool is not a reading. It is a thing you pick up before you touch the
   plan, and it belongs on the edge of the plan: always there, never scrolled
   past, never competing with the space you are reading about. So the palettes
   come out of the panel and stack here, one on top of the other, in the order
   the work happens — what the ceiling IS, then what is mounted on it, then
   what the electrical drawing is about.
   ONE CELL SHAPE FOR ALL OF THEM, and it is the palettes' own (see
   PaletteButton): the artwork is the name, and shrinking it to a bare glyph
   would cost the one thing that made the palettes readable. The rail is as
   slim as that picture allows and not slimmer.
   NOTHING IS DECIDED HERE. Every press is handed straight back out, because
   which machine a tool arms and what it disarms on the way is the editor's
   business and there is exactly one place that knows it.
   --------------------------------------------------------------------------- */

/* THE RAIL IS 64px AND THE PICTURE NOW FILLS IT.
   IT WAS WIDENED AND PUT BACK, which is worth recording so it is not tried
   again: at 84px the column read as a second panel rather than as an edge, and
   the drawing is what this screen is for. The width was never what made the
   artwork small — the padding and the cell border were, and those are gone (see
   PaletteButton), so 64px of picture is half again what it used to be without
   taking anything from the plan. */

/* THE RULE BETWEEN THE GROUPS. A hairline and no heading: two words in this
   column would wrap, and the groups are told apart by their pictures long
   before anybody reads a label. Inset from both edges, because a divider that
   runs the full width of a black column reads as the column ending. */
const RULE = 'h-px mx-2 bg-border/15 my-1.5 flex-none';

/* --- THE CAPTION IN A 64px COLUMN --------------------------------------------
   Several of these names do not fit on two lines at the caption's size, and a
   label broken into "DIRECT / IONAL / SPOT" is worse than no label — it is the
   picture's name rendered as damage. So the ones that overflow get a shorter
   one, and the full name stays on the button's `title`, which is where somebody
   who does not recognise the artwork will look anyway.
   ONLY THE ONES THAT OVERFLOW. A map with an entry per tool would be a second
   set of names to keep in step with the first; this is a list of exceptions,
   and a tool not in it is called what it is called. */
const SHORT = {
  'No Light Zone': 'No light',
  'Reverse cove': 'Rev. cove',
  'Directional spot': 'Spot',
  'LED strip': 'Strip',
  'Cassette AC': 'Cassette',
  'Chandelier': 'Chand.',
  'Trap door': 'Trapdoor',
};
const short = (label) => SHORT[label] ?? label;

export default function ToolRail({
  tool = null, objArmed = null, onPick,
  shapeOn = false, onShape = null,
  zoneOn = false, onZones = null,
  boardOn = false, onArmObject,
  disabled = false, objDisabled = false,
}) {
  const isOn = (t) => (t.arms === 'object' ? objArmed === t.id : tool === t.id);
  const surfaces = LIGHT_TOOLS.filter((t) => t.surface);
  const fittings = LIGHT_TOOLS.filter((t) => !t.surface);

  const cell = (t) => (
    <PaletteButton key={t.id} icon={LIGHT_ICON[t.id]} label={short(t.label)}
      on={isOn(t)} disabled={disabled}
      title={`${t.label} — ${t.hint}`}
      onClick={() => onPick(isOn(t) ? null : t.id, t.arms ?? 'tool')} />
  );

  return (
    /* ONE BLACK FIELD, AND THE BUTTONS DO NOT SIT ON IT — they are it. The rail
       was frosted glass with a column of bordered black cells on top, which is
       two grounds and a stack of boxes for a row of pictures. The rail, the
       buttons and the images are now the same black with nothing between them,
       so the symbols are the only thing the column draws. See PaletteButton.
       THE HAIRLINE ON THE RIGHT STAYS. It is the edge between the rail and the
       DRAWING, which is a real boundary — unlike the twelve it used to draw
       inside itself. */
    <nav aria-label="Design tools"
      /* --- NO SCROLLBAR, AND IT IS A LAYOUT BUG AND NOT A PREFERENCE ---------
         The list is taller than any screen, so this scrolls — and a classic
         scrollbar takes its width out of the CONTENT box. 16px off 64 leaves the
         buttons 48px wide, pinned at x=0 with a gutter down the right: the icons
         read as left-aligned in their own column, which is exactly what they
         were. Measured, not guessed — `clientWidth` was 48 against an
         `offsetWidth` of 64.
         HIDDEN RATHER THAN GUTTERED. `scrollbar-gutter: stable` would keep the
         icons centred by reserving the 16px on both sides, which is a quarter of
         the rail spent on nothing. A tool strip is a short fixed list you flick
         through, not a document you navigate; the wheel and the trackpad still
         work, and there is no position to keep track of. Both spellings, because
         the two engines have never agreed on this one. */
      className="w-[64px] flex-none pt-14 h-full overflow-y-auto overflow-x-hidden
        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
        border-r border-border/10 bg-black
        [@media(max-width:960px)]:w-full [@media(max-width:960px)]:h-auto
        [@media(max-width:960px)]:overflow-x-auto [@media(max-width:960px)]:overflow-y-hidden
        [@media(max-width:960px)]:border-r-0 [@media(max-width:960px)]:border-b">
      {/* NO GAP AND NO PADDING. A gap between full-bleed cells would put the
          rail's ground back between them as a stripe, which is the box this
          removed, drawn in negative. */}
      <div className="flex flex-col pb-6
        [@media(max-width:960px)]:flex-row [@media(max-width:960px)]:pb-0">
        {/* THE CEILING'S OWN SHAPE. It arms no placer — it opens a bar on the
            drawing, where its primitives live. See ShapeMenu. */}
        {onShape && (
          <PaletteButton icon="/icons/cove.png" label="Cove" title="Cove"
            on={shapeOn} disabled={disabled} onClick={onShape} />
        )}
        {surfaces.map(cell)}
        {/* THE ABSENCE OF LIGHT, and the one cell that is never disabled with
            the rest: the tools need a scale and a lit space before they can
            place anything at real size, and a zone is a box over the drawing. */}
        {onZones && (
          <PaletteButton icon="/icons/no_light_zone.png" label={short('No Light Zone')}
            title="No Light Zone — box out anything the light should keep off."
            on={zoneOn} onClick={onZones} />
        )}
        {fittings.map(cell)}

        <div className={RULE} aria-hidden="true" />

        {/* THE THINGS THE ELECTRICAL DRAWING IS ABOUT. Five drop a catalogue
            object at a point; the switchboard opens a step. The group says
            which machine it wants — see CeilingPalette. */}
        {CEILING_GROUPS.map((g) => {
          const board = g.arms === 'board';
          const on = board ? boardOn : g.ids.includes(objArmed);
          const armId = (on && !board && objArmed) || g.ids[0];
          const label = g.label ?? CEILING_BY_ID[g.ids[0]]?.label ?? g.key;
          return (
            <PaletteButton key={g.key} icon={g.icon} label={short(label)} on={on}
              title={label} disabled={objDisabled}
              onClick={() => onArmObject(on ? null : armId, g.arms ?? 'object')} />
          );
        })}
      </div>
    </nav>
  );
}
