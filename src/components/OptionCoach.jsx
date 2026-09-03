import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// OptionCoach — "that chip on the drawing is a control".
//
// THE PROBLEM IT SOLVES IS THAT THE ARROWS DO NOT LOOK LIKE ARROWS UNTIL YOU
// KNOW THEY ARE. The options pill is a white chip with a word in it and a
// chevron at each end, parked on a piece of ceiling; read cold it is a LABEL —
// the kind of leader-line callout a drawing is full of — and a label is not
// something you click. Everything downstream of the ceiling design (the cove,
// the track, the fittings, the schedule, the price) is chosen through those two
// glyphs, so a person who never reads them as buttons never sees that the app
// offered them a choice at all. That is the main act of the design screen going
// unnoticed, not a discoverability nicety.
//
// SO IT IS SAID IN WORDS, OFF THE DRAWING, WITH A LINE BACK TO THE THING BEING
// TALKED ABOUT. Two arrangements were tried before this one and both were worse
// for the same reason: a card ON the plan, over the pill, covers the ceiling
// somebody is being asked to look at — and the pill is only interesting IN
// PLACE, sitting on the piece of ceiling it decides. Off to the side with a
// leader line is how a drawing has always pointed at something without drawing
// on top of it.
//
// AND IT CARRIES ITS OWN COPY OF THE PILL. The card cannot say "click the
// arrows" and leave the reader to work out which of the marks on a floor plan
// is the one meant — so it shows the chip, with a pointer on the arrow it wants
// pressed. The label in the copy is the LIVE one, so the picture in the card and
// the control on the plan read as the same object seen twice, which is what the
// leader line is claiming.
//
// IT IS HTML AND NOT SVG, WHICH IS THE OPPOSITE OF THE PILL IT EXPLAINS. Being
// off the drawing means being outside the <svg> — anything inside it is clipped
// to the sheet and would be scaled by the zoom — and it also means the text can
// simply wrap, where an SVG card has to have its lines split by hand. The price
// is that the pill's position has to be found rather than known, which is what
// the measuring below is for.
// ---------------------------------------------------------------------------

/** The card's width. Fixed, because the copy is fixed and wrapping is CSS's. */
const W = 244;
/** Its clearance from the sheet, and the least it will accept from the stage. */
const GAP = 16;
const EDGE = 10;

/**
 * WHERE THE CARD GOES, GIVEN WHERE THE PILL AND THE SHEET ARE.
 *
 * OFF THE SHEET, ON WHICHEVER SIDE HAS ROOM FOR IT. The drawing is centred in a
 * scroll container with the right panel beside it, so on most plans there is a
 * margin on both sides and the right one is bigger; on a wide plan zoomed in
 * there may be no margin at all, and then the honest answer is to sit at the
 * edge of the stage and overlap the drawing a little rather than to disappear.
 *
 * `null` MEANS DO NOT DRAW, and there are two ways to get it: no pill in the
 * document, or a pill scrolled out of sight. A leader line to something off
 * screen is a line to nowhere.
 */
function place(pill, sheet, stage) {
  // The pill has to actually be in view. `>= 2` rather than `> 0` so a pill
  // sliced to a hairline by the stage's edge counts as gone.
  const shown = pill.bottom > stage.top + 2 && pill.top < stage.bottom - 2
    && pill.right > stage.left + 2 && pill.left < stage.right - 2;
  if (!shown) return null;

  const roomRight = stage.right - sheet.right;
  const roomLeft = sheet.left - stage.left;
  const fitsRight = roomRight >= W + GAP + EDGE;
  const fitsLeft = roomLeft >= W + GAP + EDGE;
  // Right by preference: the panel is on the right, so the margin between the
  // sheet and the panel is the gutter the eye already treats as "beside the
  // drawing". Left only when the right cannot take it.
  const side = fitsRight ? 'right' : fitsLeft ? 'left' : (roomRight >= roomLeft ? 'right' : 'left');

  const raw = side === 'right' ? sheet.right + GAP : sheet.left - GAP - W;
  const left = Math.min(Math.max(raw, stage.left + EDGE), stage.right - EDGE - W);
  return { side, left, pillY: (pill.top + pill.bottom) / 2, pillX: side === 'right' ? pill.right : pill.left };
}

/**
 * THE MINIATURE OF THE PILL, WITH A POINTER ON ITS RIGHT ARROW.
 *
 * DRAWN AT A FIXED SIZE IN ITS OWN SVG rather than scaled off the real one. It
 * is a PICTURE of the control, not the control — the reader needs to recognise
 * it, not to measure it — and a picture that shrank with the zoom would be a
 * legend that becomes unreadable exactly when the drawing is far away.
 *
 * THE CURSOR IS THE HALF THAT SAYS "CLICK". White filled with a dark outline,
 * which is macOS's own cursor, so it reads as a pointer rather than as an
 * arrowhead — and it sits just off the chevron rather than on top of it, since a
 * hint that covers the thing it is hinting at has undone itself.
 */
function PillCopy({ label }) {
  return (
    <div className="relative mt-2.5 flex justify-center">
      <span className="inline-flex items-center gap-2 rounded-full bg-white
        border border-black/[0.16] shadow-[0_1px_2px_rgba(10,10,10,.10)]
        pl-2 pr-2 py-[3px] text-[10px] text-ink whitespace-nowrap">
        <span className="text-black/40 leading-none text-[11px]">&#8249;</span>
        <span className="tracking-[0.1em] uppercase">{label}</span>
        <span className="text-black/40 leading-none text-[11px]">&#8250;</span>
      </span>
      {/* ABSOLUTE, SO THE PILL'S OWN LAYOUT IS UNTOUCHED BY IT. The cursor hangs
          off the chip's bottom-right corner; in flow it would have made the row
          taller and pushed the chip off centre. */}
      <svg viewBox="0 0 13 18" width="15" height="21" aria-hidden="true"
        className="absolute pointer-events-none"
        style={{ left: 'calc(50% + 28px)', top: 8 }}>
        <g className="lp-coach-cursor">
          <path d="M0 0 L0 15 L4 11.2 L6.6 17.6 L9.4 16.4 L6.8 10.2 L12.4 10.2 Z"
            fill="#FFFFFF" stroke="#141414" strokeWidth="1.1" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}

/**
 * "DO NOT SHOW AGAIN".
 *
 * FILLED SOLID WITH THE TICK KNOCKED OUT, rather than a tick drawn inside an
 * empty box. On a white card a dark tick on white reads as a mark somebody made;
 * a filled black square reads as a SWITCH that has been thrown, which is what
 * this is — and it is the only black shape on the card, so the eye finds the one
 * thing on it that can be pressed.
 */
function Silence({ ticked, onSilence }) {
  return (
    <button type="button" onClick={onSilence} aria-pressed={ticked}
      className="mt-3 -mx-1 px-1 py-0.5 w-[calc(100%+8px)] bg-transparent border-0 rounded
        inline-flex items-center gap-2 cursor-pointer text-left
        focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1">
      <span aria-hidden="true"
        className={'flex-none w-[13px] h-[13px] rounded-[3px] grid place-items-center '
          + 'transition-colors duration-[120ms] '
          + (ticked ? 'bg-ink border border-ink' : 'bg-white border border-black/[0.34]')}>
        {ticked && (
          <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
            <path d="M2.6 6.3 L4.8 8.5 L9.2 3.6" fill="none" stroke="#FFFFFF"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-[10.5px] text-subtle">Do not show again</span>
    </button>
  );
}

/**
 * @param stage    the scroll container the drawing sits in — its visible box is
 *                 what "off the sheet but still on screen" is measured against
 * @param label    the option the pill is showing right now
 * @param ticked   has the checkbox just been pressed — see `coach` in App.jsx
 * @param onSilence what to do when it is
 */
export default function OptionCoach({ stage, label, ticked = false, onSilence }) {
  const [at, setAt] = useState(null);
  /* A CALLBACK REF AND NOT A `useRef`, WHICH IS THE FIX FOR A REAL BUG. The
     height below is measured by a ResizeObserver, and an effect with `[]` deps
     attached it on mount — when `at` was still null, the card was not rendered
     and `ref.current` was therefore null. The observer never attached, `cardH`
     stayed 0, and the card was positioned as though it had no height: it hung
     off the pill's own line instead of being centred on it, which put a needless
     kink in the leader line. A state-holding ref re-runs the effect on the
     render where the element actually appears. */
  const [cardEl, setCardEl] = useState(null);
  const [cardH, setCardH] = useState(0);

  /* --- FINDING THE PILL ----------------------------------------------------
     BY MEASURING IT, NOT BY RECOMPUTING IT. The pill's position is arithmetic
     over the chunk's rect, the sheet's scale and the zoom, and reproducing that
     here is how a callout ends up three inches from the thing it is calling out
     at 180%. `getBoundingClientRect` on the element itself cannot be wrong.

     THREE THINGS MOVE IT AND ALL THREE ARE WATCHED. Panning is a scroll on the
     stage (see the note on stageMouseDown in App.jsx — panning IS scrolling
     here); zooming resizes the <svg>, which no scroll or resize event on the
     window reports, hence the ResizeObserver; and the window itself can change
     under both. A poll would have covered all three and reported a stale
     position for up to a frame's interval every time.

     AND IT MEASURES ONCE MORE AFTER LAYOUT. The first pass runs before the
     browser has necessarily settled the sheet at its new size — arriving on this
     screen changes the stage's padding and the plan's zoom in the same commit —
     so an animation frame later it asks again. */
  const measure = useCallback(() => {
    const pill = document.querySelector('[data-pill-body]');
    const st = stage?.current;
    if (!pill || !st) { setAt(null); return; }
    const sheet = pill.ownerSVGElement?.getBoundingClientRect();
    if (!sheet) { setAt(null); return; }
    setAt(place(pill.getBoundingClientRect(), sheet, st.getBoundingClientRect()));
  }, [stage]);

  useEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure);
    const st = stage?.current;
    const svg = document.querySelector('[data-pill-body]')?.ownerSVGElement;
    st?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = svg && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measure) : null;
    if (ro && svg) ro.observe(svg);
    return () => {
      cancelAnimationFrame(raf);
      st?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
    // `label` IS IN HERE AS A PROXY FOR "THE PILL MAY HAVE MOVED". Flipping the
    // option can change which chunk carries the design and therefore where the
    // chip sits; the pill deliberately does not RESIZE with its label (see the
    // note on its width), so this is the only thing that can shift it.
  }, [measure, stage, label]);

  /* THE CARD'S OWN HEIGHT, MEASURED RATHER THAN ASSUMED, because it is the only
     way to centre it on the pill without hard-coding a number that the copy
     would then quietly outgrow. */
  useEffect(() => {
    if (!cardEl) return undefined;
    setCardH(cardEl.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setCardH(cardEl.offsetHeight));
    ro.observe(cardEl);
    return () => ro.disconnect();
  }, [cardEl]);

  if (!at) return null;

  /* --- CENTRED ON THE PILL, FULL STOP -------------------------------------
     THE CARD'S MIDDLE SITS ON THE PILL'S MIDDLE, so the leader between them is
     one horizontal line. That is the whole rule, and it is worth stating because
     the obvious refinement breaks it: clamping the card inside the stage — to
     stop it hanging off the top on a chunk near the edge of the sheet — moves it
     off the pill's line, and a leader that has to bend to find its own card
     stops reading as a pointer and starts reading as a diagram of plumbing. A
     drawing's leader is a straight line.

     THE ONLY LIMIT IS THE WINDOW, and it is there so the card cannot leave the
     screen altogether. It bites at most half a card's height, which is less than
     half the card, so the pill's line still crosses the card and the leader
     still lands on it. */
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const top = Math.min(Math.max(at.pillY - cardH / 2, EDGE), Math.max(EDGE, vh - EDGE - cardH));
  const right = at.side === 'right';
  const cardX = right ? at.left : at.left + W;

  return (
    <>
      {/* --- THE LEADER LINE ------------------------------------------------
          A FIXED, FULL-SCREEN, CLICK-THROUGH SVG. The line has to run from
          inside the sheet to outside it, so it cannot live in either: the plan's
          <svg> clips it at the sheet's edge, and the card would have to be as
          big as the gap. One overlay in viewport coordinates is the only surface
          both ends are on.

          ONE SEGMENT, HORIZONTAL, ALWAYS — see the note on `top`. The card is
          placed on the pill's own line precisely so that this can be a single
          straight run from the chip to the card. */}
      <svg className="fixed inset-0 w-screen h-screen pointer-events-none z-30"
        aria-hidden="true">
        <line x1={at.pillX} y1={at.pillY} x2={cardX} y2={at.pillY}
          stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1" />
        {/* THE END ON THE DRAWING GETS A DOT and the end on the card does not.
            One end of a leader points at something; the other is just where it
            is written down. */}
        <circle cx={at.pillX} cy={at.pillY} r="2.4" fill="#FFFFFF" fillOpacity="0.85" />
      </svg>

      <div ref={setCardEl} role="dialog" aria-label="Multiple options available"
        className="fixed z-30 rounded-[10px] bg-white border border-black/[0.10]
          shadow-[0_10px_30px_rgba(0,0,0,.34),0_1px_2px_rgba(0,0,0,.20)]
          pt-2.5 px-3 pb-2.5
          animate-[tip-in_.14s_ease-out] motion-reduce:animate-none"
        style={{ left: at.left, top, width: W }}>
        <h4 className="m-0 text-[12.5px] font-medium text-ink tracking-[-0.01em] leading-[1.3]">
          Multiple options available
        </h4>
        <p className="mt-1 mb-0 text-[10.5px] leading-[1.45] text-muted">
          Click on the arrows to toggle between different design options
        </p>
        <PillCopy label={(label || 'Standard').toUpperCase()} />
        <Silence ticked={ticked} onSilence={onSilence} />
      </div>
    </>
  );
}
