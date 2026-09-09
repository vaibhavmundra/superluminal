import React, { useRef } from 'react';
import PaletteButton from './PaletteButton.jsx';
import RailFlyout from './RailFlyout.jsx';
import { TRACK_MODULES } from '../lib/magTrack.js';
import { LIGHT_TOOLS, LIGHT_ICON } from './LightPalette.jsx';
import { CEILING_GROUPS } from './CeilingPalette.jsx';
import { CEILING_BY_ID } from '../lib/ceilingObjects.js';

/* ---------------------------------------------------------------------------
   THE TOOLS, DOWN THE LEFT EDGE, BESIDE THE THING THEY ACT ON.

   FIVE CELLS NOW, AND THEY ARE CATEGORIES RATHER THAN FITTINGS. It held
   fourteen — a cell per product, in the order the work happens — and fourteen
   64px cells is a column taller than a laptop screen. So it scrolled, and a
   tool strip that scrolls has given up the one thing it was for: the positions
   are what people learn, and a position that moves is not one. Worse, the
   scroll had no bar (deliberately — see the note further down), so the eight
   cells past the fold were not merely awkward to reach, they were invisible.

   SPOTS, COVES, TRACKS, LAMPS, ELECTRICAL — the five things a lighting drawing
   is made of, which is also how anybody describes one out loud. Every fitting
   that used to have a cell is still one press further in, in a flyout hinged off
   its category (see RailFlyout), and the two cells that already worked that way
   — the COB's two gestures and the track's three modules — are now the rule
   rather than the exception.

   AND ONE THING IS GONE RATHER THAN MOVED: the No-Light Zone. It is not in any
   of the five categories because it is not a fitting, and it is not a sixth cell
   because the tool is being retired. `zoneEdit` and every machine behind it are
   untouched — a plan that already has zones still draws them and still has the
   layer switch to hide them — there is simply no longer a way to arm a new one.

   NOTHING IS DECIDED HERE. Every press is handed straight back out, because
   which machine a tool arms and what it disarms on the way is the editor's
   business and there is exactly one place that knows it.
   --------------------------------------------------------------------------- */

/* THE RAIL IS 86px, AND THE WIDTH IS THE CAPTION'S. At 64 — the width the old
   column of artwork wanted — "Electrical" does not fit on one line, and a
   category broken over two is a heading rendered as damage. The cells are five
   words and five marks now rather than fourteen photographs, so the extra 22px
   costs the drawing almost nothing and buys every label its own line.
   AS A CLASS AND NOT AN INLINE `style`, which matters for one reason: under
   960px the rail lies down across the top of the screen and wants the full
   width, and an inline width would beat the media query that says so. */

/* --- THE FIVE MARKS -------------------------------------------------------
   LINE ART AND NOT THE PHOTOGRAPHS THE FLYOUTS USE, which is the same split
   PaletteButton already draws inside itself. A cell whose subject is an OBJECT
   gets a picture of the object: a fan, a cassette, a downlight. A cell whose
   subject is a CATEGORY has no object to photograph — "Spots" is not a thing you
   can take a picture of — so it gets a symbol, at the weight the rest of this
   chrome is drawn at.
   AT THEIR OWN SIZE, WHICH IS THE ONE THING TO GET RIGHT. These files are
   16-35px of line work; stretched to fill an 86px square they would be a
   blurred smear of what they are. `h-[30px] w-auto` renders them at roughly the
   size they were drawn, and the varying widths are why the box centres rather
   than stretches. */
const MARK = {
  spots: '/icons/new_icons/spots.png',
  coves: '/icons/new_icons/cove.png',
  tracks: '/icons/new_icons/track.png',
  lamps: '/icons/new_icons/lamp.png',
  electrical: '/icons/new_icons/bolt.png',
};

/* --- ONE OF THE FIVE CELLS ------------------------------------------------
   NOT `PaletteButton`, AND THE REASON IS THE ARTWORK. That component scales its
   icon to the full width of the cell, which is exactly right for a photograph
   drawn to be scaled and exactly wrong for a 27px line drawing. The rest of it
   — the black ground, the caption under the mark, the ring when it is live —
   is reproduced here rather than parameterised, because a flag on that
   component saying "except do not size the picture" would be a flag about this
   one caller.
   SENTENCE CASE AND NOT THE CAPS THE FLYOUT CELLS USE. Those are captions under
   pictures; these are the five words the whole rail is, and small caps at 8.5px
   is a size for a label on a symbol rather than for a heading. */
function RailCell({ mark, label, on, disabled, title, onClick }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      title={title ?? label} aria-expanded={on}
      /* EXACTLY ONE BACKGROUND CLASS IS EVER APPLIED, which is a bug fix and
         not a style. `bg-black` on the shell plus `bg-white/[0.10]` when live
         are two single-class utilities of identical specificity, so which one
         wins is decided by the ORDER TAILWIND EMITS THEM and not by the order
         they appear in the attribute — the live cell would have been black
         whatever this concatenation said. ShapeMenu's header tells the whole
         story of the last time this happened, where it made the armed tool
         invisible. The rule is always the same: make them alternatives, not
         layers — and the "off" case is `bg-transparent`, so the rail's own grey
         is what shows through rather than a second copy of it. */
      className={'w-full flex flex-col items-center justify-center gap-[7px] '
        + 'pt-[15px] pb-[13px] px-1 border-0 cursor-pointer '
        + 'transition-colors duration-[120ms] '
        + 'disabled:opacity-[.45] disabled:cursor-not-allowed '
        + 'focus-visible:outline-2 focus-visible:outline-accent '
        + 'focus-visible:outline-offset-[-2px] '
        + (on ? 'bg-white/[0.10]' : 'bg-transparent enabled:hover:bg-white/[0.06]')}>
      <img src={mark} alt="" className="h-[30px] w-auto select-none"
        draggable="false" />
      <span className={'text-[11px] leading-none tracking-[-0.01em] '
        + (on ? 'text-white' : 'text-faint')}>{label}</span>
    </button>
  );
}

/* --- THE CAPTION IN A 64px FLYOUT CELL --------------------------------------
   Several of these names do not fit on two lines at the caption's size, and a
   label broken into "DIRECT / IONAL / SPOT" is worse than no label — it is the
   picture's name rendered as damage. So the ones that overflow get a shorter
   one, and the full name stays on the button's `title`, which is where somebody
   who does not recognise the artwork will look anyway.
   ONLY THE ONES THAT OVERFLOW. A map with an entry per tool would be a second
   set of names to keep in step with the first; this is a list of exceptions,
   and a tool not in it is called what it is called. */
const SHORT = {
  'Reverse cove': 'Rev. cove',
  'Directional spot': 'Spot',
  'LED strip': 'Strip',
  'Cassette AC': 'Cassette',
  'Chandelier': 'Chand.',
  'Trap door': 'Trapdoor',
};
const short = (label) => SHORT[label] ?? label;

/* THE COB'S TWO GESTURES, and the artwork is the argument. Both marks are the
   COB's own symbol with the gesture drawn beside it — a cursor, or the run it
   steps along — so the pair says what each does without a sentence under it.
   IT LIVED IN CobMenu.jsx, WHICH IS GONE. That file was one cell's drawer;
   every cell has one now, so the panel is RailFlyout and the table is here with
   the other four groups' contents. */
export const COB_MODES = [
  { id: 'manual', label: 'Manual', icon: '/icons/new_icons/cob_manual.png',
    title: 'Manual — click the ceiling to place one at a time' },
  { id: 'array', label: 'Array', icon: '/icons/new_icons/cob_array.png',
    title: 'Array — a run of them, evenly spaced' },
];

/** Which fitting from LIGHT_TOOLS goes in which category. Ids, because the
 *  table those come from is ordered for a row that no longer exists. */
const IN_COVES = ['cove', 'strip'];
/* THE TWO CEILING DROPS FIRST AND THE WALL FITTING LAST, which is the order
   they differ in: a chandelier and a pendant are one fitting at two sizes — see
   ceilingObjects.js — and a sconce is the only one of the three that seats
   itself on a wall. */
const IN_LAMPS = ['chandelier', 'pendant', 'sconce'];
const IN_SPOTS = ['spot'];

/** THE CELLS WHOSE FLYOUT IS NOTHING BUT A PANEL, so this file owns whether it
 *  is showing. Spots and Tracks are the editor's — see `openOnly`. */
const OWN_PANEL = new Set(['coves', 'lamps', 'electrical']);

export default function ToolRail({
  tool = null, objArmed = null, onPick,
  shapeOn = false, onShape = null,
  boardOn = false, onArmObject,
  /* THE COB'S DRAWER, AND IT IS NOW THE SPOTS FLYOUT. `cobOpen` is whether that
     flyout is showing, `cobMode` which of its two gestures is armed, and the
     rail decides neither — see the note at the top of this file. It is handed
     `cobSoon` too: the gestures this build does not answer for yet, so the cell
     can be shown without pretending it does something.
     THE OPEN FLAG IS STILL THE COB'S, AND THAT IS DELIBERATE. The category's
     flyout and the COB's drawer are the same panel now, so a second piece of
     state saying "the Spots flyout is open" would be a second answer to one
     question — and the editor already owns this one. */
  cobOpen = false, cobMode = null, onCob = null, cobSoon = [],
  /* --- THE MAGNETIC TRACK ---------------------------------------------------
     ITS CELL OPENS THE GEOMETRY BAR AND NOT JUST A PANEL, which is the one
     category whose press does something on the drawing as well. A module has
     nowhere to go until there is a profile to clip it into, and the two ways of
     getting one are both the shape tool's — drag out a primitive, or press a
     guide already on the drawing and have its outline handed over. A flyout
     offering three fittings and no way to make a run would be a panel about
     nothing on a fresh plan.
     SO THE FLYOUT IS NOT WHAT THE CELL OPENS, AND THAT IS THE WHOLE OF THIS
     CATEGORY'S FLOW. It followed `trackOn` — the bar's own role — so pressing
     the cell put a geometry bar at the foot of the drawing AND three modules
     beside the rail, on a plan that very often had no profile to clip one into.
     Two panels for one press, one of them about nothing.
     `trackDrawer` IS WHEN IT SHOWS NOW: a run has been PRESSED on the drawing,
     or a module is already armed. So the order is the order of the work — draw
     the run, and the allocator fills it; hover the profile and the pointer turns
     into a plus; press it and the modules arrive beside the cell you learned
     they live behind. See `trackAdd` in features/fixtures/useFixtureState.js for
     why a pressed run is not the same fact as a selected one.
     WHICH ALSO RETIRES THE DISABLED STATE. Every cell in here is now shown only
     when there is something to clip onto, so "shown and out of reach" would be a
     picture of a precondition that is met by definition. `trackSoon` still greys
     the module this build does not answer for, which is a different claim. */
  /* `onTrack('close')` IS THE ONE MESSAGE THIS HANDLER TAKES BESIDES A PLAIN
     PRESS, and it exists because every OTHER cell needs a way to put this panel
     away — see `openOnly`. Called bare it toggles, which is the cell's own press;
     called with `'close'` it closes and is a no-op if the bar is already down,
     because a rule that says "put the others away" must never be able to OPEN
     one. The COB's handler has taken its four messages this way from the start. */
  trackOn = false, onTrack = null,
  trackDrawer = false, trackMode = null, onTrackPick = null, trackSoon = [],
  /* NO `onGeometry`. The guide primitives are the same bar the cove opens and
     they are reached by clicking a SPACE rather than by picking a tool up. */
  disabled = false, objDisabled = false,
}) {
  /* EACH FLYOUT MEASURES OFF ITS OWN CELL. They cannot be children of the
     cells — the rail clips its overflow, so a panel inside one would be cut off
     at the rail's edge and never seen. See RailFlyout. */
  const spotsRef = useRef(null);
  const covesRef = useRef(null);
  const trackRef = useRef(null);
  const lampsRef = useRef(null);
  const elecRef = useRef(null);

  /* WHICH FLYOUT IS SHOWING, and only the three that own no state of their own.
     Spots is `cobOpen` and Tracks is `trackOn`, both of which belong to the
     editor because pressing those cells arms or opens something out there; the
     other three open nothing but a panel, so the panel's own visibility is the
     whole of what there is to remember. */
  const [openId, setOpenId] = React.useState(null);

  /* --- ONE PANEL AT A TIME, AND IT IS ONE RULE NOW RATHER THAN FIVE ---------
     TWO PANELS STANDING OVER THE DRAWING IS TWO ANSWERS TO "WHAT DID I JUST
     PRESS", which the file has claimed since the flyouts were built — and the
     claim was not true. `openId` holds at most one id, so the three cells that
     live in it were exclusive for free; the other two are not in it, and closing
     them was left to each cell to remember on its own. Every cell did remember
     the COB (`onCob('close')` on the way in) and NO cell remembered the track,
     so with the Tracks flyout up, pressing Electrical left both panels open —
     and so did pressing Spots, which put a second one beside it.

     THE FIX IS NOT A SIXTH CLOSE IN FIVE PLACES. Four closes hand-written five
     times is a rule that exists only in the heads of the people who wrote it,
     which is how this one came to have a hole in it. This is the rule, once, and
     the next category obeys it by asking rather than by remembering.

     IT ASKS THE OTHER TWO TO CLOSE RATHER THAN CLOSING THEM, because it cannot:
     `cobOpen` is the editor's and the track's panel is the geometry bar in its
     own role, so closing either means putting a machine away out on the drawing
     and the editor is the only thing that knows what else goes with it. Both
     take `'close'` — see the note on `onTrack` in the props above. */
  const openOnly = (id) => {
    if (id !== 'spots') onCob?.('close');
    if (id !== 'tracks') onTrack?.('close');
    /* AND THE PRESS IS STILL A TOGGLE. `cur === id` is a second press on the
       cell whose panel is already up, which means close — the same thing it
       meant when this was `show`. A cell whose panel is the editor's is never
       stored here, so it falls to `null` and its own handler does the toggling. */
    setOpenId((cur) => (OWN_PANEL.has(id) && cur !== id ? id : null));
  };

  const isOn = (t) => (t.arms === 'object' ? objArmed === t.id : tool === t.id);
  const byId = (ids) => ids
    .map((id) => LIGHT_TOOLS.find((t) => t.id === id))
    .filter(Boolean);

  /* ONE FLYOUT CELL, and it is the palettes' own (see PaletteButton): the
     artwork is the name, and shrinking it to a bare glyph would cost the one
     thing that made the palettes readable. */
  const cell = (t) => (
    <PaletteButton key={t.id} icon={LIGHT_ICON[t.id]} label={short(t.label)}
      on={isOn(t)} disabled={disabled}
      title={`${t.label} — ${t.hint}`}
      onClick={() => onPick(isOn(t) ? null : t.id, t.arms ?? 'tool')} />
  );

  /* --- IS A CATEGORY CARRYING SOMETHING LIVE? -----------------------------
     THE CELL HAS TO SAY SO WITH ITS PANEL CLOSED. A flyout is a glance: you
     open it, press a fitting, and it goes away — and from that moment the only
     thing on screen saying which tool is in hand would be the drawing's own
     cursor. So a category reads as live while anything inside it is armed,
     which is what makes the five cells a legible answer to "what am I holding".
     `on` IS THEREFORE TWO THINGS AT ONCE — the panel is open, or something in
     it is armed — and that is correct rather than a conflation: both mean "this
     is the category you are working in". */
  const anyOn = (ids) => byId(ids).some(isOn);
  const spotsLive = cobOpen || !!cobMode || anyOn(IN_SPOTS);
  const covesLive = openId === 'coves' || shapeOn || anyOn(IN_COVES);
  /* AND `trackDrawer` IS IN THIS ONE, WHICH THE OTHER FOUR DO NOT NEED. Every
     other category's flyout is opened by pressing the cell, so "the panel is
     open" and "this cell was pressed" are the same fact; this one is opened by a
     press on the DRAWING, and without this the modules would hang off a cell
     that read as off. See the note on `trackDrawer` in the props. */
  const tracksLive = trackOn || trackDrawer || !!trackMode;
  const lampsLive = openId === 'lamps' || anyOn(IN_LAMPS);
  const elecLive = openId === 'electrical' || boardOn
    || CEILING_GROUPS.some((g) => !g.arms && g.ids.includes(objArmed));

  return (
    /* ONE GREY FIELD, AND THE CELLS DO NOT SIT ON IT — they are it. The rail,
       the buttons and the marks are one surface with nothing between them, so
       the five words and five symbols are the only thing the column draws.
       THE HAIRLINE ON THE RIGHT WENT WITH THE BLACK. It was the edge between a
       black rail and a black drawing, which needed drawing; #2F2F2F against the
       plan's black is that edge already, and a #EAEAEA line on top of it would
       be a border doing a job nothing needs done.
       AND THIS COLUMN IS THE ONLY THING WEARING THAT GREY. The bar along the
       foot of the stage is the drawing's own black — see the note on the
       editor's four surfaces in styles.css for why a rail earns a surface and a
       row of readings does not.
       AND IT NO LONGER SCROLLS. Five cells fit on any screen this app runs on,
       which is the whole argument for having five — so `overflow-y-auto`, and
       the hidden scrollbar that had to go with it, are gone. If a sixth category
       is ever added and the column overflows, the answer is not to put the
       scroller back; it is that there are too many categories. */
    <nav aria-label="Design tools"
      /* --- IT SPANS BOTH ROWS, WHICH IS THE WHOLE OF ITS HEIGHT -------------
         THE SHELL IS TWO COLUMNS AND TWO ROWS: the stage in the upper right and
         the bar along the foot under it. Left to auto-placement this column took
         the first row only, so the grey stopped level with that bar's top edge
         and the last 48px of the left edge was the page showing through — a
         notch out of the bottom of the rail that read as a rendering fault.
         `h-full` IS NOT WHAT DOES IT. That is 100% of the grid AREA, and the
         area was one row; the span is what makes the area the full height. Both
         are needed and neither is redundant.
         AND ONE ROW ON A NARROW SCREEN, where the shell is a single column and
         this lies down across the top of it — a span of two there would eat the
         stage's row. */
      className="w-[86px] flex-none row-span-2 pt-14 h-full overflow-hidden bg-chrome
        [@media(max-width:960px)]:row-span-1
        [@media(max-width:960px)]:w-full [@media(max-width:960px)]:h-auto
        [@media(max-width:960px)]:pt-0 [@media(max-width:960px)]:border-b">
      {/* NO GAP AND NO PADDING. A gap between full-bleed cells would put the
          rail's ground back between them as a stripe, which is the box this
          removed, drawn in negative. */}
      <div className="flex flex-col [@media(max-width:960px)]:flex-row">

        {/* --- SPOTS, AND IT IS FIRST BECAUSE IT IS THE FITTING -------------
            A lighting plan is mostly downlights: the recessed COB is the thing
            somebody reaches for without looking, and the directional spot is the
            same lamp aimed at something. Everything under this cell either
            changes what the ceiling IS or hangs something off it.
            NOT DISABLED WITH THE REST. `disabled` is "there is no scale and no
            lit space yet", which is the right guard on a placer; this cell
            places nothing, it opens a panel, and a panel that will not open is a
            cell nobody can find out the meaning of. The gestures inside take the
            guard instead. */}
        {onCob && (
          <div ref={spotsRef} className="flex-none">
            <RailCell mark={MARK.spots} label="Spots" on={spotsLive}
              title="Recessed COBs and directional spots"
              onClick={() => {
                /* THE CELL IS THE COB DRAWER'S OWN TOGGLE, which is what keeps
                   the two from disagreeing: `cobOpen` is the panel, and the
                   editor is what puts every other machine away when it opens.
                   `openOnly` shuts the other four first — including the track,
                   which this cell used to leave standing beside its own. */
                openOnly('spots');
                onCob(cobOpen ? 'close' : 'open');
              }} />
          </div>
        )}
        {onCob && cobOpen && (
          <RailFlyout anchor={spotsRef} label="Spots">
            {COB_MODES.map((m) => (
              <PaletteButton key={m.id} icon={m.icon} label={m.label} title={m.title}
                on={cobMode === m.id}
                disabled={disabled ? true : cobSoon.includes(m.id)}
                onClick={() => onCob(cobMode === m.id ? null : m.id)} />
            ))}
            {byId(IN_SPOTS).map(cell)}
          </RailFlyout>
        )}

        {/* --- COVES, AND THE FIRST CELL IN IT IS NOT A PLACER --------------
            ONE CELL FOR TWO ROLES' WORTH OF BAR, AND ONLY THE COVE IS IN THIS
            RAIL. The shape bar draws the same six primitives either way and
            `shapeRole` is the whole difference — what a committed shape BECOMES
            — but the two are asked for in different ways:
              COVE      an act you bring to a ceiling. Nothing on the drawing
                        suggests it, so it lives here, latched while it is open.
              GEOMETRY  what you set out IN a space, and the space is what says
                        which one. A click on a room raises it.
            THE OTHER TWO ARE THE FITTINGS THAT RUN IN A LINE — a reverse cove
            spanned along a wall, and a length of tape between two ends. They are
            the same KIND of thing as a cove, which is why they are behind the
            same word. */}
        {onShape && (
          <div ref={covesRef} className="flex-none">
            <RailCell mark={MARK.coves} label="Coves" on={covesLive}
              title="Coves, reverse coves and LED strip"
              onClick={() => openOnly('coves')} />
          </div>
        )}
        {onShape && openId === 'coves' && (
          <RailFlyout anchor={covesRef} label="Coves">
            <PaletteButton icon="/icons/new_icons/normal_cove.png" label="Cove" title="Cove"
              on={shapeOn} disabled={disabled} onClick={onShape} />
            {byId(IN_COVES).map(cell)}
          </RailFlyout>
        )}

        {/* --- TRACKS ------------------------------------------------------
            THE CELL OPENS THE GEOMETRY BAR AND NOTHING ELSE, which is the run
            being drawn. The flyout's three modules arrive later and off a press
            on the drawing — see the note on `trackDrawer` in the props above.
            NOT DISABLED WITH THE REST, for the Spots cell's reason. */}
        {onTrack && (
          <div ref={trackRef} className="flex-none">
            <RailCell mark={MARK.tracks} label="Tracks" on={tracksLive}
              title="Magnetic track"
              onClick={() => { openOnly('tracks'); onTrack(); }} />
          </div>
        )}
        {onTrackPick && trackDrawer && (
          <RailFlyout anchor={trackRef} label="Magnetic track">
            {TRACK_MODULES.map((m) => (
              /* `airy`, BECAUSE THESE THREE PICTURES REACH THE BOTTOM EDGE.
                 Each is a rail with a beam thrown downward off it, so the bright
                 part runs to the foot of the square and a caption tight under it
                 sits in the light. See PaletteButton. */
              <PaletteButton key={m.id} icon={m.icon} label={short(m.label)}
                title={m.title} airy on={trackMode === m.id}
                /* OUT OF REACH FOR TWO DIFFERENT REASONS, AND THEY ARE NOT
                   THE SAME REASON. `disabled` is "no scale and no lit space",
                   which is the guard on every placer in this rail; `trackSoon`
                   is a module this build does not answer for. Both come out as a
                   cell you can see and cannot press, which is the honest picture
                   of each. THE THIRD ONE IS GONE: "there is no run to clip onto"
                   is now the condition on the whole flyout rather than on its
                   cells — see the note on `trackDrawer` in the props above. */
                disabled={disabled || trackSoon.includes(m.id)}
                onClick={() => onTrackPick(m.id)} />
            ))}
          </RailFlyout>
        )}

        {/* --- LAMPS -------------------------------------------------------
            THE DECORATIVE FITTINGS: a chandelier dropped on the ceiling, a
            sconce seated on a wall. Neither is part of the ambient grid and both
            are chosen for how they look, which is what puts them behind one
            word rather than beside the downlights. */}
        <div ref={lampsRef} className="flex-none">
          <RailCell mark={MARK.lamps} label="Lamps" on={lampsLive}
            title="Chandeliers and sconces"
            onClick={() => openOnly('lamps')} />
        </div>
        {openId === 'lamps' && (
          <RailFlyout anchor={lampsRef} label="Lamps">
            {byId(IN_LAMPS).map(cell)}
          </RailFlyout>
        )}

        {/* --- ELECTRICAL --------------------------------------------------
            THE THINGS THE ELECTRICAL DRAWING IS ABOUT, and the things it has to
            account for, behind one word. Four drop a catalogue object at a
            point; the socket opens a step. The group says which machine it
            wants — see CeilingPalette. */}
        <div ref={elecRef} className="flex-none">
          <RailCell mark={MARK.electrical} label="Electrical" on={elecLive}
            title="Sockets, fans, air conditioners and hatches"
            onClick={() => openOnly('electrical')} />
        </div>
        {openId === 'electrical' && (
          <RailFlyout anchor={elecRef} label="Electrical">
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
          </RailFlyout>
        )}
      </div>
    </nav>
  );
}
