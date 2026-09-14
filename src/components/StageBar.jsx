import { useCallback, useEffect, useState } from 'react';

/* ---------------------------------------------------------------------------
   StageBar — THE WHITE PILL AT THE FOOT OF THE DRAWING, AND THERE IS ONLY ONE.

   IT WAS THE SAME TWENTY LINES IN TWO FILES. ShapeMenu and CobSpec both
   measured the stage, both fixed themselves to its bottom centre, both drew a
   white pill with a hairline and a shadow, and both stopped a pointer press
   from reaching the plan underneath. They were not similar bars, they were one
   bar with two sets of buttons in it — and the drift had already started: one
   had `px-1.5`, the other `px-2` and a `flex-wrap` nobody had given the first.

   AND THE THIRD CALLER IS WHAT FORCED IT OUT. The bar is now PERMANENT: the two
   scene buttons live at its right-hand end whatever else is in it, so a plan
   with no gesture running still has a bar. Rendering that from a third copy of
   the same pill would have made three.

   WHAT IT KNOWS IS WHERE IT SITS AND WHAT IT LOOKS LIKE, and nothing else. The
   buttons, the states and every latch are the caller's — see ShapeMenu for the
   four-state version of that argument.

   FIXED AND MEASURED, NOT ABSOLUTE, which is the one non-obvious part: the
   stage is a SCROLL container, so a child positioned inside it scrolls away
   with the drawing, and a child of the <svg> would be scaled by the zoom.

   *** THE CONTEXT MENU'S NON-NEGOTIABLE RULE: NOTHING ON THIS BAR EVER, EVER,
   *** EVER WRAPS. NO TEXT ON IT IS EVER TWO LINES.                         ***
   Read the banner over `className` in the component below before you put a
   word on any bar that stands here. It is enforced once, on the container,
   and it applies to every caller — CobSpec, ModuleSpec, FanSpec, ShapeMenu
   and whatever is written next.
   --------------------------------------------------------------------------- */

/** Its clearance from the foot of the stage. */
export const BOTTOM = 26;

/* --- ...AND FROM THE HEAD OF IT, WHICH IS WHERE THE COLUMN WANTS IT --------
   TWELVE AND NOT TWENTY-SIX, because it is the same twelve the floating light
   window uses: in the vertical column both are handed the canvas band, and a
   bar and a window that appear in the same slot have to appear in the SAME
   PLACE. See the window's `mt-[68px]` — 56 for the top bar, 12 into the band. */
export const TOP = 12;

/**
 * WHERE THE BAR SITS. Centred over the stage, near its foot — the position
 * every drawing tool in every editor has trained people to look at, and the one
 * place on this screen that is neither the sheet's middle nor the panel.
 *
 * `null` while the stage has not been measured, which is one frame on mount.
 */
export function useStageRect(stage) {
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

/** The hairline between two groups of keys in the bar. */
export const SEP = <span className="w-px h-5 bg-black/10 mx-0.5" aria-hidden="true" />;

/* --- ...AND THE TWO THAT DIVIDE THE BAR ITSELF -----------------------------
   THE THREE SLOTS ARE NOT THE SAME KIND OF BOUNDARY AS THE ONES INSIDE THEM,
   and until this existed they were drawn as though they were. A rule inside the
   middle separates a count from a side from an optic — three questions about
   one gesture. These two separate the gesture from what the DRAWING SHOWS and
   from WHERE YOU ARE, which are not part of it at all: the same hairline at the
   same spacing said the Suggested Grid capsule was one more control in the row,
   and on a long bar the eye had nothing to group by.

   DARKER AND FURTHER OUT, which is the whole of the change. `black/25` against
   `black/10` is visible without becoming a line in its own right — this is
   still punctuation, not a border — and the margin is what does most of the
   work: pushed out from `mx-0.5` to `mx-2`, the two standing switches read as
   sitting apart from the middle rather than at the ends of it.

   NOT EXPORTED. A caller reaching for this would be drawing a slot boundary
   inside its own slot, which is the confusion this exists to remove; `SEP` is
   the one every bar uses for its own groups. */
const GROUP_SEP = <span className="w-px h-5 bg-black/25 mx-2" aria-hidden="true" />;

/* --- THE TWO SCENE BUTTONS' OWN SHAPE --------------------------------------
   TYPE AND NOT A MARK, because they are the only things in this bar that are
   not about the next press on the drawing: everything else here arms a tool or
   answers for a gesture, and these two LEAVE — to the wiring, or to the
   schedule. A glyph would file them with the keys beside them.
   THE INERT ONE IS `disabled` AND STILL DRAWN, which is the honest picture of
   a scene this build does not have: out of reach rather than absent, the same
   rule the COB drawer's unbuilt gesture follows. */
export const SCENE = 'flex items-center h-9 px-2.5 rounded-[7px] border-0 '
  + 'bg-transparent cursor-pointer text-[11.5px] leading-none tracking-[-0.01em] '
  + 'text-black/75 whitespace-nowrap transition-colors duration-[120ms] '
  + 'enabled:hover:bg-black/[0.07] enabled:hover:text-black '
  + 'disabled:opacity-100 disabled:cursor-not-allowed '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';

/* --- THE SAME KEY ON THE OTHER GROUND -------------------------------------
   THE BLACK FOOTER HAD ITS OWN SWITCH AND IT DID NOT WORK. `FooterSwitch` in
   App drew a WHITE track in both states and moved a black knob along it, so on
   and off differed by fourteen pixels of knob position and nothing else —
   nobody could tell at a glance whether the heatmap was on. This is that
   control's ONE remaining difference from the bar's: the ground it stands on.

   IT IS THE MIRROR AND NOT A NEW DESIGN. On the white bar the track carries the
   state (ink when on, a whisper of ink when off) and the knob is the GROUND's
   colour. Said on black, the ink is white and the ground is black, so the pair
   swaps and the reading is identical: a bright pill is on, a dim one is off.
   Same 34x20 track, same 14px knob, same travel. It is the rule `Mark` in
   ShapeMenu follows for a symbol on a latched chip, said about a switch. */
const TONE = {
  light: { btn: SCENE,
           on: 'bg-black', off: 'bg-black/[0.13]', knob: 'bg-white' },
  dark: { btn: 'flex items-center h-9 px-2.5 rounded-[7px] border-0 '
            + 'bg-transparent cursor-pointer text-[11.5px] leading-none '
            + 'tracking-[-0.01em] text-faint whitespace-nowrap '
            + 'transition-colors duration-[120ms] '
            + 'enabled:hover:bg-white/[0.07] enabled:hover:text-white '
            + 'disabled:opacity-100 disabled:cursor-not-allowed '
            + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
            + 'focus-visible:outline-accent',
          on: 'bg-white', off: 'bg-white/[0.18]', knob: 'bg-black' },
};

/* --- A SCENE THAT IS A STATE RATHER THAN A DESTINATION ---------------------
   THE OTHER TAIL BUTTONS LEAVE and this one does not: the wiring is drawn over
   the layout you are already looking at, so the honest picture of it is a
   switch that is visibly on or off, not a word you press and then have to look
   at the drawing to find out what happened.

   POSITION AND COLOUR CARRY THE STATE; the visible label says what the switch
   controls and `aria-checked` says its state to assistive technology. Keeping
   ON and OFF out of the track makes these compact controls easier to scan. */
export function SceneSwitch({ label, on = false, title = null, onClick,
                              tone = 'light' }) {
  const t = TONE[tone] ?? TONE.light;
  return (
    <button type="button" role="switch" aria-checked={on} title={title ?? undefined}
      className={`${t.btn} gap-2`} onClick={onClick}>
      {label}
      <span aria-hidden="true"
        className={'relative flex-none block w-[34px] h-[20px] rounded-full '
          + 'transition-colors duration-150 '
          + (on ? t.on : t.off)}>
        {/* `left` AND NOT A TRANSFORM keeps the knob's travel independent of
            any transform a caller might apply to the complete switch. */}
        <span className={'absolute top-[3px] w-[14px] h-[14px] rounded-full '
          + t.knob + ' '
          + 'shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] duration-150 '
          + (on ? 'left-[17px]' : 'left-[3px]')} />
      </span>
    </button>
  );
}

/**
 * `stage` is the scroll container to centre on. `tail` is drawn at the right
 * end after a rule, separated from `children` because it is the part that is
 * there whatever the bar is currently doing.
 *
 * `lead` IS THAT SAME ARGUMENT AT THE OTHER END. It holds the switches that are
 * about what the DRAWING SHOWS rather than about the next press on it, and like
 * the tail it is there whatever the bar is doing — so it cannot be part of
 * `children`, which is the contextual middle and is replaced wholesale every
 * time a different tool claims the bar.
 *
 * THE THREE SLOTS ARE THE BAR'S WHOLE GRAMMAR, left to right: what is drawn,
 * what the next press does, where you are. Two rules, and the reader gets the
 * grouping without a caption on any of them.
 */
export default function StageBar({ stage, className = '', label = null,
                                   lead = null, tail = null, children = null,
                                   placement = 'bottom' }) {
  const box = useStageRect(stage);
  if (!box) return null;

  const atTop = placement === 'top';

  return (
    <div
      /* --- ONE ROW, WHATEVER IS IN IT -----------------------------------
         `flex-nowrap` IS STATED RATHER THAN LEFT TO THE DEFAULT, because it is
         a rule about this bar and not an accident of flexbox: a contextual bar
         that wraps is a bar whose buttons move to a different line as you use
         it — the tick you were about to press is suddenly under the wattage
         slider — and the position people have learned is the CENTRE of one row.
         The downlight bar carried `flex-wrap` and a 92vw cap for exactly the
         case this forbids; it grows sideways now. */
      /* ===================================================================
         ||                                                               ||
         ||   NOTHING IN THIS BAR EVER WRAPS. NO TEXT ON IT IS EVER TWO   ||
         ||   LINES. NOT A CAPTION, NOT A READOUT, NOT A CHIP, NOT A      ||
         ||   LABEL ADDED IN SIX MONTHS BY SOMEBODY WHO HAS NOT READ      ||
         ||   THIS. EVER.                                                 ||
         ||                                                               ||
         =====================================================================
         `whitespace-nowrap` IS HERE, ON THE BAR, AND NOT ON THE THINGS INSIDE
         IT — because `white-space` INHERITS. One declaration on the container
         is the rule for every descendant it will ever have, including the ones
         nobody has written yet; a class per label is a rule that holds until
         the first label somebody forgets it on. "Sweep (mm)" broke over two
         lines and "7 W · 30°" broke after the middle dot, both inside a bar
         that already said `flex-nowrap` — because that governs the FLEX ITEMS
         and says nothing whatever about the text inside one.
         WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE. This bar is one row,
         centred on the drawing, and its height is whatever its tallest child
         is. One caption breaking in two makes the whole bar taller, which
         moves every control on it — including the one under the finger that is
         reaching for it. It is the same argument `flex-nowrap` makes two lines
         down and it is the same bug: a control that is not where it was a
         moment ago.
         THE BAR GROWS SIDEWAYS INSTEAD. That is the trade and it is settled —
         if a bar gets too wide, the answer is fewer or shorter labels on it,
         never a second line. */
      className={'fixed z-30 flex flex-nowrap items-center gap-0.5 rounded-[11px] '
        + 'whitespace-nowrap '
        + 'bg-white border border-black/[0.10] shadow-[0_6px_24px_rgba(0,0,0,0.22)] '
        + 'px-1.5 py-1.5 '
        /* --- `top` IS A POSITION AND NOTHING ELSE ----------------------
           IT USED TO BE A SECOND BAR. `placement="top"` rethemed the pill dark,
           fixed it at the column's 380, gave it a 109px floor and squared its
           top corners, because it was hanging off the bottom of the top bar as
           chrome. It is a floating bar over the drawing now, in the same slot
           the light window takes, and it looks like the bar it is everywhere
           else: white, shrink-wrapped, rounded all round. The one thing that
           changes with placement is which edge it is measured from. */
        + className}
      style={{ left: (box.left + box.right) / 2,
               ...(atTop
                 ? { top: box.top + TOP }
                 : { bottom: Math.max(12, window.innerHeight - box.bottom + BOTTOM) }),
               transform: 'translateX(-50%)' }}
      /* THE BAR MUST NOT START A GESTURE ON THE PLAN. The stage's own pointer
         handlers are on the SVG, so a press here never reaches them — but the
         canvas-wide click that clears the selection is on the document, and a
         press that both pressed a button and deselected the shape the button
         acts on is a press with two meanings. */
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label ?? undefined}>
      {lead}
      {/* THE RULES ONLY WHERE THERE ARE TWO GROUPS TO SEPARATE, and each one
          asks about everything to its RIGHT rather than about its immediate
          neighbour — otherwise a bar with a lead and a tail and no tool in the
          middle draws no rule at all between the two things it is holding. On a
          bar with nothing but the tail, a rule would be a hairline against the
          left edge.
          AND THEY ARE `GROUP_SEP` AND NOT `SEP`: these two are the boundaries of
          the bar's three slots, not divisions inside one. See the note there. */}
      {lead && (children || tail) ? GROUP_SEP : null}
      {children}
      {tail && children ? GROUP_SEP : null}
      {tail}
    </div>
  );
}
