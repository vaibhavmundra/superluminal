import React, { useRef } from 'react';
import PaletteButton from './PaletteButton.jsx';
import CobMenu, { COB_MODES } from './CobMenu.jsx';
import TrackMenu from './TrackMenu.jsx';
import { TRACK_MODULES } from '../lib/magTrack.js';
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

/* EVERY GESTURE IN THE DRAWER, for the one case where none of them can be had:
   no scale, or no space laid out. The drawer still opens — see the cell — and
   both cells in it are visibly out of reach, which is the honest picture. */
const COB_ALL = COB_MODES.map((m) => m.id);
/** ...and the same for the track's three, for the same reason. */
const TRACK_ALL = TRACK_MODULES.map((m) => m.id);

/* --- THERE IS NO GEOMETRY CELL IN THIS RAIL, AND THAT IS DELIBERATE ---------
   IT HAD ONE, UNDER THE COVE, and it was removed. The argument for it was that
   the two open one bar and draw one set of shapes, so they belong beside each
   other. What that missed is that they are not reached the same way.

   A COVE IS A THING YOU DECIDE TO ADD. You pick it up off the rail like every
   other fitting in this column, because nothing on the drawing tells you to —
   it is an act you bring to the ceiling.

   GEOMETRY IS WHAT YOU SET OUT IN A SPACE, and the space is what says which
   one. Clicking a room IS the request: it names the ceiling, it puts the panel
   on that ceiling, and the primitives arrive on the drawing at the same moment.
   A rail cell for it was a second door into the same room, and a worse one —
   pressed with no space chosen it armed a rectangle over whichever room the
   panel had fallen back to.

   SO THE BAR HAS EXACTLY ONE WAY IN, AND IT IS CLICKING A SPACE. A space can be
   clicked in two places and both raise it unarmed: the room itself on the
   drawing (`onCanvasClick`) and its row in the panel's list (`pickSpace`), both
   in App.jsx. See `shapeRole` there for what a committed shape becomes.
   Escape and reaching for any other tool are the ways out; there is no cell to
   un-press, because there is no cell. */

export default function ToolRail({
  tool = null, objArmed = null, onPick,
  shapeOn = false, onShape = null,
  zoneOn = false, onZones = null,
  boardOn = false, onArmObject,
  /* THE ONE CELL WITH A DRAWER UNDER IT. `cobOpen` is whether the drawer is
     showing, `cobMode` which of its two gestures is armed, and the rail decides
     neither — see the note at the top of this file. It is handed `cobSoon` too:
     the gestures this build does not answer for yet, so the drawer can show the
     cell without pretending it does something. */
  cobOpen = false, cobMode = null, onCob = null, cobSoon = [],
  /* --- THE MAGNETIC TRACK, AND ITS DRAWER IS NOT OPENED BY ITS CELL ---------
     THIS IS WHERE IT PARTS COMPANY WITH THE COB. That cell's two entries are
     GESTURES — place a lamp, or set a run of them out — and either is available
     the moment the cell is pressed, so the drawer belongs to the press. These
     three are MODULES, and a module has nowhere to go until there is a profile
     to clip it into. A drawer offering three fittings with no run on the drawing
     is three controls that cannot do anything.
     SO THE CELL OPENS THE GEOMETRY BAR AND NOTHING ELSE: draw a run, or press a
     guide already on the drawing to span one. `trackOn` is that latch.
     AND THE DRAWER OPENS WHEN A RUN IS SELECTED. `trackDrawer` is the caller's
     answer to "is there a track in hand" — see `onTrack` at the call site — so
     the three modules appear at the moment they become placeable and not
     before. It still hangs off this cell, because that is where somebody has
     learned a drawer lives. */
  trackOn = false, onTrack = null,
  trackDrawer = false, trackMode = null, onTrackPick = null, trackSoon = [],
  /* NO `onGeometry`. The guide primitives are the same bar the cove opens and
     they are reached by clicking a SPACE rather than by picking a tool up — see
     the note above `ToolRail` on why this rail has no cell for them. */
  disabled = false, objDisabled = false,
}) {
  /* THE DRAWER MEASURES OFF THIS BUTTON. It cannot be a child of it — the rail
     clips its own overflow, so a drawer inside would be cut off at the rail's
     edge and never seen. See CobMenu. */
  const cobRef = useRef(null);
  const trackRef = useRef(null);
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
        {/* THE RECESSED COB, AND IT IS FIRST BECAUSE IT IS THE FITTING.
            Everything under it in this column changes what the ceiling IS or
            hangs something off it; this is the downlight — the thing a lighting
            plan is mostly made of, and the one somebody reaches for without
            looking. The rest of the rail is in the order the work happens; the
            work happens after you have decided you are placing downlights.
            IT OPENS RATHER THAN ARMS. Two gestures, one fitting — see CobMenu.
            NOT DISABLED WITH THE REST. `disabled` is "there is no scale and no
            lit space yet", which is the right guard on a placer; this cell
            places nothing, it opens a drawer, and a drawer that will not open is
            a cell nobody can find out the meaning of. The two gestures inside it
            take the guard instead. */}
        {onCob && (
          /* THE WRAPPER IS THERE TO BE MEASURED, and `[&>button]:w-full` is what
             keeps it invisible. Every other cell is a direct child of the flex
             column and stretches to the rail's 64px on its own; a cell inside a
             div does not, because a <button> sizes to its content whatever its
             display is. Without the rule this one cell would be narrower than
             the eleven under it. */
          <div ref={cobRef} className="flex-none [&>button]:w-full">
            <PaletteButton icon="/icons/recessed_cob.png" label="COB"
              title="Recessed COB" on={cobOpen}
              onClick={() => onCob(cobOpen ? 'close' : 'open')} />
          </div>
        )}
        {onCob && cobOpen && (
          <CobMenu anchor={cobRef} mode={cobMode}
            disabled={disabled ? COB_ALL : cobSoon}
            onPick={(m) => onCob(m)} />
        )}

        {/* --- THE MAGNETIC TRACK, AND IT SITS WITH THE COB ---------------
            TWO DRAWERS, TOGETHER, AT THE TOP OF THE COLUMN. They are the two
            cells in this rail that open instead of arming, and the two fittings
            a lighting plan is mostly made of — a hole in the ceiling and a
            profile on it. Keeping them adjacent is what says the drawer is a
            KIND of cell rather than a quirk of the downlight.
            IT OPENS THE GEOMETRY BAR AND NOT THE DRAWER, which the rail does
            not know: a module needs a run to clip into, so this cell's whole job
            is to put the primitives in front of you. The three modules arrive
            when a run is selected. See `onTrack` at the call site.
            NOT DISABLED WITH THE REST, for the COB cell's reason — this cell
            places nothing, and the three cells in the drawer take the guard
            instead. */}
        {onTrack && (
          <div ref={trackRef} className="flex-none [&>button]:w-full">
            <PaletteButton icon="/icons/track.png" label="Track"
              title="Magnetic track" on={trackOn} onClick={onTrack} />
          </div>
        )}
        {onTrackPick && trackDrawer && (
          <TrackMenu anchor={trackRef} mode={trackMode}
            disabled={disabled ? TRACK_ALL : trackSoon}
            onPick={onTrackPick} />
        )}

        {/* THE CEILING'S OWN SHAPE. It arms no placer — it opens a bar on the
            drawing, where its primitives live. See ShapeMenu.
            AND IT IS THE ONLY SHAPE CELL IN THIS RAIL. The bar's other role —
            geometry to set out from, built into nothing — used to sit directly
            under this one and does not any more: it is raised by clicking a
            SPACE. See the note above `ToolRail`. */}
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
