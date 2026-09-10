// ---------------------------------------------------------------------------
// THE DESIGN LANGUAGE, AS UTILITY STRINGS.
//
// These were `.btn`, `.note`, `.kv`, `.pill`, `.sec` and their neighbours in
// styles.css — the classes this file uses forty and fifty times each, which is
// exactly why they are named here rather than typed out at every use.
//
// EVERY VARIANT IS BUILT FROM A SHAPE THAT DOES NOT SET WHAT THE VARIANT SETS,
// and that is not tidiness, it is the only thing that works. `BTN + ' bg-cta'`
// does NOT give a black button: Tailwind resolves two utilities that touch the
// same property by their order in the GENERATED STYLESHEET, not by their order
// in the class attribute, and `bg-surface` is emitted after `bg-accent` — so
// the base wins and the variant silently does nothing. It cost a real bug: the
// save pill stayed white and the primary button stayed grey while both looked
// correct in the source. So colour lives on the variants and never on a shape
// they share, and a size override gets its own shape rather than an append.
//
// `leading-[1.5]` IS NOT DECORATION EITHER. Tailwind's `text-xs` ships a
// line-height of its own (1rem), and `.btn` never set one — it inherited body's
// 1.5. Take the override away and every button loses 2px of height, which you
// only notice as a row of them failing to line up with the input beside it.
// ---------------------------------------------------------------------------

/* --- buttons. A shape, a size, and one of three colourways. --------------- */
const BTN_SHAPE = 'leading-[1.5] rounded border cursor-pointer '
  + 'transition-[background-color,border-color,color] duration-[120ms] '
  + 'disabled:opacity-100 disabled:cursor-not-allowed';
const BTN_QUIET = 'bg-surface text-white border-border/10 hover:bg-surface-2 hover:text-black '
  + 'hover:border-border-strong active:bg-surface-3 '
  + 'disabled:hover:bg-surface disabled:hover:border-border';
/* THE PRIMARY BUTTON IS THE `cta` TOKEN. Not the accent — the accent means
   "this is the live thing", and a page with three blue buttons on it has
   stopped saying that. */
const BTN_CTA = 'bg-cta text-white border-cta hover:bg-cta-hover hover:border-cta-hover';

/* WHITE FILL, BLACK TEXT — the loudest answer a panel on a black ground can
   give, and the same colourway Share wears in the header. It is for a STEP'S
   WAY OUT: a screen that has taken the whole panel over has exactly one thing
   to press when you are done with it, and the `cta` blue is a shade of the
   ground it sits on rather than a break from it. Hover goes to `text` (the
   off-white) so the press is felt without the label ever leaving black. */
const BTN_WHITE = 'bg-white text-black border-white '
  + 'hover:bg-text hover:border-text active:bg-text';

const BTN = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_FULL = `${BTN} w-full`;
const BTN_PRIMARY = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_CTA}`;
const BTN_EXIT = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_WHITE}`;
/* `BTN_ACCENT` WAS HERE — the accent-filled button. Its only user was the
   "+ Add a No Light Zone" toggle in the old zones tab, and that tab is a step
   now: the button that starts it is a cell in the light palette (which latches
   with the palette's own gradient ring), and the way out of it is `BTN_PRIMARY`
   like every other step's answer. Nothing else on this screen ever wanted a
   filled accent — the accent means "this is the live thing", and a panel with
   three of them has stopped saying that. */
const BTN_SECOND = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} bg-surface text-white `
  + 'border-border-strong hover:bg-surface-2 hover:border-ink active:bg-surface-3 hover:text-black';
/* The wider one, which is the loading panel's; and the two small ones. */
const BTN_MID = `text-[12px] px-3.5 py-[7px] ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_TINY = `text-[11px] px-[5px] py-0 ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_NUDGE = `text-[11px] px-[7px] py-px ml-2 ${BTN_SHAPE} ${BTN_QUIET}`;
/* THE THREE EXPORTS, AS CHIPS IN THE PANEL'S HEADER. They were `BTN` in a
   section of their own; three format names beside a Share button want the
   smaller shape, and `BTN_TINY`'s `py-0` is a chip for sitting inside a table
   row rather than for standing next to one. */
const BTN_EXPORT = `text-[11px] px-2 py-[4px] ${BTN_SHAPE} ${BTN_QUIET}`;
/* The schedule's three exports: a block, its label above its explanation. */
const BOQ_SHAPE = `text-[12px] w-full text-left px-2.5 py-2 block ${BTN_SHAPE} `
  + '[&>b]:block [&>b]:text-[12px] [&>span]:block [&>span]:text-[10px] '
  + '[&>span]:opacity-70 [&>span]:mt-px [&>span]:whitespace-normal';
/* ONE COLOURWAY FOR ALL THREE, and `BTN_BOQ_CTA` is gone with the distinction.
   Excel was the filled one on the reasoning that it is what most people want —
   but these three are not a primary and two alternatives, they are the SAME act
   in three file formats, and which one somebody wants is a fact about the office
   they work in rather than a recommendation this panel gets to make. A row of
   three identical blocks says "pick your format"; two quiet and one filled says
   "take the Excel", to a quantity surveyor who has asked for a CSV.
   IT WAS ALSO INVISIBLE. `BTN_CTA` is the `cta` token, which is #000000 — a
   black block on a black panel, findable only by its border, while the two
   underneath it were legible glass. So the "recommended" option was the one you
   could not read. */
const BTN_BOQ = `${BOQ_SHAPE} ${BTN_QUIET}`;

/* --- notes. ATTENTION, NOT ALARM: most of the warnings in this file are
   guidance — "set the scale first", "light a space first" — and rendering all
   of them in red spent the one loud colour on sentences that are not alarms.
   So the default is quiet: ink, with a rule down the left saying "read this".
   `NOTE_ERR` is the red one, and it is for something that actually failed.
   `N`/`NW`/`NE` are the margin-less shapes, for the sites that set their own. */
const N = 'text-[11.5px] text-muted leading-[1.5]';
const NW = `${N} border-l-2 border-border-strong pl-[9px] ml-0`;
const NE = 'text-[11.5px] leading-[1.5] text-danger-ink border-l-2 border-danger pl-[9px]';
const NOTE = `${N} mt-2`;
const NOTE_WARN = `${NW} mt-2`;
const CODE = 'font-sans text-[10px] bg-input-bg px-[3px] rounded-[3px] text-text';

/* --- the status pills in the top bar. */
const PILL_SHAPE = 'font-sans text-[10.5px] px-2 py-[3px] rounded-full border '
  + 'whitespace-nowrap tabular-nums';
/* --- ONE SHAPE FOR EVERY STATE OF THE SAVE PILL, AND IT SITS ON WHITE ------
   THE THREE WERE THREE DIFFERENT PILLS ONCE — 5% glass, a pale green wash, a
   pale red one — so the thing in the corner of the bar changed SHAPE as well as
   wording every time it changed state, which is two announcements for one fact.
   That was fixed by giving all three one solid white ground and moving only the
   ink.

   THE TOP BAR IS WHITE NOW, so a white pill on it is a pill with no edges: the
   ground has to come back, and it comes back as the WASHES the app already has
   for exactly this — `--color-ok-soft` over `--color-ok-line`, and the same
   pair in red. One shape, one position, one width class; the hue moves, which
   is the original decision intact with a ground it can be seen on.

   UPPERCASE, AND ONLY HERE. These are one- and two-word STATES rather than
   sentences — a badge, read at a glance from the corner of the eye — where
   `PILL_VIEW` below carries a phrase and would be shouting. */
const PILL_STATE = `${PILL_SHAPE} uppercase tracking-[0.08em]`;
const PILL = `${PILL_STATE} border-border bg-surface-3 text-muted`;
const PILL_OK = `${PILL_STATE} border-ok-line bg-ok-soft text-ok`;
const PILL_BAD = `${PILL_STATE} border-danger-line bg-danger-soft text-danger-ink`;
/* THE OPERATOR'S PILL IS THE ONE THAT IS DELIBERATELY LOUD, and it keeps the
   magenta wash it always had — it reads on white, which is what it is on. */
const PILL_VIEW = `${PILL_SHAPE} border-op-line bg-op-soft text-op`;
const PILL_RETRY = `${PILL_BAD} cursor-pointer hover:bg-danger-line`;

/* TABULAR FIGURES WHEREVER A NUMBER IS READ DOWN A COLUMN. Not a nicety in
   this face: its proportional `1` is half the width of its `0`. */
const KV_SHAPE = 'flex justify-between text-[11.5px] py-[3px] '
  + '[&>b]:text-ink [&>b]:tabular-nums';
const KV = `${KV_SHAPE} text-muted`;
const KV_HEAD = `${KV_SHAPE} text-subtle`;
/* THE SAME ROW ON NO GROUND AT ALL. The admin ledger used to sit in a #F2F2F2
   card, which is where `KV`'s dark label and near-black `<b>` were legible; the
   card is gone, so both halves of the row are white on the panel's own dark
   ground. It restates the shape rather than appending overrides to `KV`,
   because `[&>b]:text-ink` and `[&>b]:text-white` in one class list are decided
   by the order Tailwind emits them in, not the order they are written. */
const KV_ADMIN = 'flex justify-between text-[11.5px] py-[3px] text-white '
  + '[&>b]:text-white [&>b]:tabular-nums';
const N_ADMIN = 'text-[11.5px] text-white leading-[1.5]';
const BTNROW = 'flex gap-1.5 flex-wrap';

/* --- a section and its heading. `first-of-type:` carries the rule that the
   first section in the panel has no line above it; the admin section states
   its own edge and margin, as its own rule always did. */
const SEC = 'border-t border-border/10 pt-3.5 mt-2.5 '
  + 'first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0';
/* IT IS THE FIRST THING IN THE ADMIN TAB NOW, and it used to be the last thing
   in the Export section — a magenta-ruled footnote hung below three file-format
   buttons. The rule and the 20px above it were the separation that nesting
   needed; at the top of a tab of its own they are a hairline under nothing and
   a gap over nothing. `first-of-type` cancels all three, exactly as `SEC` does,
   so the block still states its own edge wherever it is not first. */
const SEC_ADMIN = 'border-t border-border-strong pt-3.5 mt-5 '
  + 'first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0';
/* `mt-0 mx-0 mb-*` and not `m-0 mb-*`: the shorthand and the longhand touch
   the same property, which is the ordering trap described at the top. */
const H3_SHAPE = 'mt-0 mx-0 text-[10px] tracking-[0.11em] uppercase';
const H3 = `${H3_SHAPE} mb-2.5 text-subtle`;
const H3_FLUSH = `${H3_SHAPE} mb-0 text-subtle`;
const H3_ADMIN = `${H3_SHAPE} mb-2.5 text-[#C026D3]`;
/* A DISCLOSURE, IN THE OPERATOR HUE. Same construction as the View section's —
   the browser owns open/closed, keyboard and screen reader, and the chevron is
   an `::after` rotated on `[open]` — but sized and coloured for a sub-block
   inside a section rather than for a section heading of its own. */
const DISCLOSE_ADMIN = `[&>summary]:cursor-pointer [&>summary]:list-none
  [&>summary]:flex [&>summary]:items-center [&>summary]:gap-1.5
  [&>summary]:text-[11px] [&>summary]:tracking-[0.08em] [&>summary]:uppercase
  [&>summary]:text-[#C026D3] [&>summary]:select-none
  [&>summary::-webkit-details-marker]:hidden
  [&>summary]:after:content-[''] [&>summary]:after:ml-auto
  [&>summary]:after:w-1.5 [&>summary]:after:h-1.5
  [&>summary]:after:border-r-[1.5px] [&>summary]:after:border-b-[1.5px]
  [&>summary]:after:border-[#C026D3] [&>summary]:after:transition-transform
  [&>summary]:after:duration-[120ms]
  [&>summary]:after:[transform:rotate(45deg)_translate(-2px,-2px)]
  [&[open]>summary]:after:[transform:rotate(225deg)_translate(-1px,-1px)]`;
/* `accent-white` AND NOT `accent-accent`. `accent-color` is the one property a
   native checkbox exposes, and it sets the BOX — the tick is then drawn by the
   browser in whatever contrasts with it. So a white box gets a near-black tick
   for free, which is the whole ask, and it needs no `appearance-none` and no
   hand-drawn SVG check. Verified in the browser rather than assumed: at 4x zoom
   #fff renders a white box with a dark tick, where the amber it replaces
   rendered an amber box with the same dark tick.
   THE UNCHECKED BOX IS THE UA'S OWN, and stays that way deliberately. Nothing
   here declares `color-scheme`, so it is the light-mode control — a white box
   with a grey border — which is already the right thing beside a checked white
   one on this panel's dark ground. */
/* THE LABEL'S LAYOUT ONLY. The box itself is `.lp-check` in styles.css, which
   owns its size, its border and its tick — `accent-color` could not be made to
   say what colour the tick is, so the control is drawn there instead. The
   `[&>input]:*` utilities that used to live here are gone with it: two places
   setting one control's size is one place too many. */
const CHECK = 'flex items-center gap-2 mb-[7px] text-muted cursor-pointer';

/* --- THE UNDO/REDO SHELL, and it is the only thing left using this.
   The name is historical: it dressed the Design/BOQ tab pair too, and that pair
   is now the right panel's own three-tab strip.
   GLASS, LIKE EVERY OTHER PIECE OF CHROME ON THIS SCREEN. It was `bg-surface-3`
   — #F2F2F2, an opaque near-white pill — which is a light-panel token sitting on
   a dark bar: it read as a bright slab with two invisible icons in it. The
   panel's own glass is what the top bar, the appearance switch and the name
   field all wear, and this is the last of the four to get it.
   `border-border/10` rather than `border-border` for the same reason: #EAEAEA at
   full strength is a bright outline round a translucent thing. */
/* THE GROUP AROUND UNDO AND REDO, AND ITS ONE CALLER IS THE WHITE TOP BAR.
   It was a glass chip — 5% white over a `border-border/10` hairline — which is
   a chip you can only see on a dark ground. On white, 5% white is nothing and a
   tenth of #EAEAEA is nothing; the shape has to come from the app's own light
   surfaces instead. */
const TABS = 'inline-flex gap-0.5 p-0.5 rounded border border-border bg-surface-3';
const TAB_SHAPE = 'appearance-none border-0 cursor-pointer text-[11.5px] leading-[1.5] '
  + 'tracking-[0.01em] py-1 rounded transition-[background-color,color] duration-[120ms]';
/* `TAB` AND `TAB_ON` WERE HERE. They dressed the Design/BOQ pill pair in the top
   bar, which is now the panel's three-tab strip — see PTAB below. `TAB_SHAPE`
   stays: the undo/redo and plan-appearance switches are built on it, which is
   why the shape outlived the pair that used it as a pill. */
const ICON_SHAPE_TAB = 'px-2 inline-flex items-center justify-center leading-[0] [&>svg]:block';
/* WHITE WHEN THERE IS SOMETHING TO DO, GREY WHEN THERE IS NOT — and for these
   two "active" is exactly `enabled`. The pair is the only thing on screen that
   says this plan HAS a history, and its disabled state says how much of one, so
   the difference between the two has to be legible at 15px.
   A COLOUR RATHER THAN `opacity-35`, which is what this was. Opacity dims the
   whole button — its hover ground included — and on a translucent shell that
   compounds into a smudge; `text-subtle` greys the one thing that should grey.
   THE HOVER IS A GROUND, NOT A COLOUR SHIFT, since the icon is already white.
   Gated on `enabled:` so a dead button does not light up under the pointer. */
/* INK WHEN THERE IS SOMETHING TO DO, GREY WHEN THERE IS NOT — and for these two
   "active" is exactly `enabled`. The pair is the only thing on screen that says
   this plan HAS a history, and its disabled state says how much of one, so the
   difference between them has to be legible at 15px. Both inverted with the bar:
   white ink on a white bar was the pair vanishing outright. */
const STEP = `${TAB_SHAPE} ${ICON_SHAPE_TAB} bg-transparent text-ink `
  + 'enabled:hover:bg-ink/[0.07] disabled:text-border-strong disabled:cursor-default';
/* `STEP_ON` WAS HERE — the same shell latched on, for an icon button that is a
   state rather than an action. The sun/moon switch was its only user, and that
   switch now says its state with the accent RAMP on the live icon instead of
   with a pill behind it (see the block over the canvas). `STEP` stays: undo and
   redo are actions, and they never had an on state to draw. */

/* --- a row in a list of spaces or objects. */
/* `border-transparent` IS ON THE OFF-STATE, not on the shape: `ROW_ON` sets
   border-colour too, and two utilities on one property is the ordering trap. */
/* THE ROW IS A TILE, and it is the SAME tile as the two readouts under Result —
   `bg-white/5`, a `border-border/10` hairline, `rounded`, over `backdrop-blur-md`.
   Named once so the two cannot drift apart: a space row and a stat readout that
   are nearly the same object read as a mistake rather than as a family.

   `border` (THE WIDTH) STAYS ON THE SHAPE and the colour on the states, which is
   the split that makes this editable at all. With the width dropped from the
   shape, `ROW_ON`'s border colour had nothing to paint and the row looked as
   though it were refusing to take a border. */
const ROW_TILE = 'bg-white/5 border-border/10 backdrop-blur-md';
const ROW_EDGE = 'rounded mb-3 border';
/* Resting: no edge at all, and the tile arrives on hover. */
const ROW_OFF = 'border-transparent hover:bg-white/5 hover:border-border/10 '
  + 'hover:backdrop-blur-md';
/* Open: the tile stays put, and it wraps the render-pass block with it. */
/* `ROW_ON` WAS HERE — the tile a row wore while it was OPEN. Nothing opens
   inside a row any more: picking a space replaces the list with the space (see
   SpaceDetail), so a row has exactly one state and `ROW_OFF` above is it. */
/* `ROW` AND THEN `ROW_TIGHT` WERE HERE, and the ceiling-object list was the
   only caller either of them ever had. `ROW` went when those rows lost their
   delete button and carried one line; `ROW_TIGHT` went with the list itself.
   Nothing else in this panel is a one-line row: the Spaces list is an accordion
   on `ROW_FLUSH`, and the chips below are chips. */
const ROW_FLUSH = `p-0 overflow-hidden ${ROW_EDGE}`;
/* THE HEAD PAINTS NOTHING. It is the click target inside the tile; a background
   of its own would cover the tile it sits in and leave the blur nothing to
   blur. */
const ROW_PICK = 'px-1.5 py-2 rounded cursor-pointer '
  + 'focus:outline-none focus-visible:outline-2 focus-visible:outline-accent '
  + 'focus-visible:outline-offset-1';

/* --- A PROPERTY CHIP: a fan's sweep, or which rectangle a hatch is.
   THE SAME TILE AS A SPACE ROW, built from the same two constants rather than
   from a lookalike. These were `bg-input-bg` when latched and `bg-surface`
   otherwise — and `--input-bg` is #FFFFFF, so the picked chip was a solid white
   pill in a panel of frosted glass over black. It read as a form control
   borrowed from another app, which is roughly what it was: the pair predates the
   panel's tile idiom and never got moved onto it.
   Sharing ROW_TILE and ROW_OFF is the point. A chip and a space row are the same
   KIND of thing — a small surface you pick — and two nearly-identical surfaces
   that differ slightly read as a mistake rather than as a family. Same argument
   the ROW_TILE comment makes about the Result readouts.
   ONE PAIR FOR BOTH ROWS. The sweep picker and the AC/trap picker were two
   copies of one long class string, and they had already drifted — one of them
   had picked up a `border-border/10` the other never got. Two copies of a style
   is one copy too many for exactly this reason. */
const PROP_SHAPE = 'flex-1 px-0 py-[3px] font-sans text-[10px] rounded border '
  + 'cursor-pointer transition-colors duration-[120ms]';
const PROP_OFF = `${PROP_SHAPE} text-muted ${ROW_OFF}`;
const PROP_ON = `${PROP_SHAPE} text-text ${ROW_TILE}`;
const PICK_SHAPE = 'grid grid-cols-[minmax(0,1fr)_auto] gap-[7px] items-center w-full '
  + 'border-0 bg-none p-0 text-left';
const PICK = `${PICK_SHAPE} cursor-[inherit]`;
/* `PICK_BTN` — the same grid with its own pointer — WENT WITH THE
   CEILING-OBJECT LIST. It was the shape for a row that is ITSELF the button;
   every remaining user of this grid sits inside a row that handles the click,
   which is what `cursor-[inherit]` above is for. */
const NAME = 'font-sans text-[11px] text-text overflow-hidden text-ellipsis whitespace-nowrap';
const META = 'flex justify-between items-center gap-1.5 text-[10px] text-subtle mt-[3px] '
  + 'tabular-nums [&>span]:flex [&>span]:items-center [&>span]:gap-[5px]';
const RTYPE = 'font-sans text-[9px] tracking-[0.02em] bg-surface backdrop-blur-md text-subtle '
  + 'rounded-[4px] px-[5px] py-px mr-[5px]';
/* `ICON_SHAPE`, `ICON` AND `ICON_ON` WERE HERE — the 26px icon button in a
   spaces row, and the two colourways it wore at rest and while its row was
   open. Their one user was the chunking button, which went with the accordion
   and with the grid it was a reading of. See AUTO_GRID and the note in the
   spaces list. `.lp-chunk-btn` in styles.css is what painted the ramp on hover
   and is likewise unreferenced from here; it stays, because putting the button
   back is putting these three lines back. */


/* --- THE PANEL'S OWN TAB STRIP, and its current tab is WHITE.
   An underline strip like the Edit tabs below it, and deliberately not the
   pill-shaped TABS pair in the top bar: this is a tab strip INSIDE a panel, and
   two different tab idioms three inches apart would read as two different kinds
   of control.
   WHITE AND NOT THE ACCENT. Everything warm on this app is now the accent ramp
   — the fittings, the pools, the strips, the rails — and an amber underline in
   the panel was one more warm mark competing with the drawing for the same
   meaning. The page's ground is black, so white is the strongest thing a panel
   can say with, and it says only this: you are here. */
const PTAB_SHAPE = 'appearance-none border-0 bg-transparent cursor-pointer '
  /* BIGGER THAN THE EDIT TABS BELOW, and that is the hierarchy being said out
     loud rather than a size preference. This strip names the STEP you are in —
     the three things this app does — and the strip under it names a category of
     tool within one of them. They were both 11px, so the panel opened with two
     tab rows of equal weight and no clue which was the outer one. */
  + 'text-[13px] px-0 py-[6px] mr-[18px] last:mr-0 border-b-2 whitespace-nowrap '
  /* NO `-mb-px`. It pulled the tab's own underline down by a pixel so it would
     sit ON the container's hairline and cover it. The hairline is gone (see the
     strip itself), so the nudge has nothing to align to and would just lift the
     underline off its baseline. */
  + 'transition-[color,border-color] duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 '
  + 'focus-visible:rounded-[3px]';
const PTAB = `${PTAB_SHAPE} text-subtle border-transparent hover:text-text`;
const PTAB_ON = `${PTAB_SHAPE} text-white border-b-white`;

/* --- ONE LINE OF ONE OF THE CHROME'S MENUS ---------------------------------
   THE PANEL'S SECTIONS BECAME MENUS, and a menu item is a different control
   from anything already in this file: full-bleed to the panel's edges so the
   hover reads as a row rather than as a chip, two lines high because the second
   line is the sentence the section used to carry as a paragraph, and no border
   of its own — a stack of bordered rows in a 250px panel is a wall.

   THE NAME AND THE NOTE ARE ONE PRESS, WHICH IS WHY THE NOTE IS INSIDE THE
   BUTTON. It describes what pressing does; a caption beside a control is a
   thing you read and then have to aim past. */
const MENU_ITEM = 'w-full flex flex-col items-start gap-[3px] text-left '
  + 'px-3 py-[7px] border-0 bg-transparent cursor-pointer '
  + 'text-[12px] leading-[1.35] transition-colors duration-[120ms] '
  + 'enabled:hover:bg-white/[0.07] disabled:opacity-[.4] '
  + 'disabled:cursor-not-allowed '
  + 'focus-visible:outline-2 focus-visible:outline-accent '
  + 'focus-visible:outline-offset-[-2px]';
const MENU_NOTE = 'text-[10.5px] leading-[1.3] text-subtle';

/* THE HEADING OVER A GROUP INSIDE ONE. Quieter and smaller than `H3`, because
   these sit inside a panel that is already one subject — see Admin's groups. */
const MENU_H = 'text-[9.5px] tracking-[0.12em] uppercase text-subtle '
  + 'px-3 pt-1.5 pb-1 leading-none';

export {
  BTN_SHAPE, BTN_QUIET, BTN_CTA, BTN_WHITE, BTN, BTN_FULL, BTN_PRIMARY,
  BTN_EXIT, BTN_SECOND, BTN_MID, BTN_TINY, BTN_NUDGE, BTN_EXPORT, BOQ_SHAPE,
  BTN_BOQ, N, NW, NE, NOTE, NOTE_WARN, CODE, PILL_SHAPE, PILL_STATE, PILL,
  PILL_OK, PILL_BAD, PILL_VIEW, PILL_RETRY, KV_SHAPE, KV, KV_HEAD, KV_ADMIN,
  N_ADMIN, BTNROW, SEC, SEC_ADMIN, H3_SHAPE, H3, H3_FLUSH, H3_ADMIN,
  DISCLOSE_ADMIN, CHECK, TABS, TAB_SHAPE, ICON_SHAPE_TAB, STEP, ROW_TILE,
  ROW_EDGE, ROW_OFF, ROW_FLUSH, ROW_PICK, PROP_SHAPE, PROP_OFF, PROP_ON,
  PICK_SHAPE, PICK, NAME, META, RTYPE, PTAB_SHAPE, PTAB, PTAB_ON,
  MENU_ITEM, MENU_NOTE, MENU_H,
};
