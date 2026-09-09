import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeClaim } from '../hooks/useEscapeHatch.js';
import { TONES, TONE_LABEL, WALL_TONE_BLURB } from '../lib/materials.js';

/* ---------------------------------------------------------------------------
   WHAT THIS WALL IS FINISHED IN, ASKED WHERE IT WAS CLICKED.
   It is a popup and not a panel section for one reason: the subject is a
   particular wall, and a control three hundred pixels away from that wall in a
   column called "Materials" cannot say WHICH. Here the question is standing on
   its own answer.
   THE SENTENCES ARE THE POINT AND NOT DECORATION. "Medium" alone is a word
   somebody has to guess at; "medium wall finishes, wooden panelling, or
   wallpaper" is the same word with the examples that make it a decision. They
   live in materials.js so the three tones read the same everywhere.
   FIXED, AND CLAMPED. It is anchored to a click on a canvas that scrolls and
   zooms underneath it, so it takes the pointer's viewport coordinates and stays
   put — a popup that scrolls off with the drawing is a popup that has to be
   chased. Everything outside it dismisses it; so does Escape.
   --------------------------------------------------------------------------- */

const W = 244;
const GAP = 10;

export default function WallTonePopup({ at, tone, onPick, onClose }) {
  const box = useRef(null);
  const [pos, setPos] = useState({ left: at.x + GAP, top: at.y + GAP });

  // MEASURED, NOT GUESSED. The card's height depends on how the three sentences
  // wrap, which depends on the font — so where it has to flip is something only
  // the laid-out element knows. One synchronous pass before paint, so it never
  // appears in the wrong place first.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(GAP, Math.min(at.x + GAP, vw - W - GAP));
    const top = at.y + GAP + h > vh - GAP
      ? Math.max(GAP, at.y - GAP - h)
      : at.y + GAP;
    setPos({ left, top });
  }, [at.x, at.y]);

  /* A MODAL, SO IT CLAIMS THE KEY: closing the popup cannot also close the wall
     step behind it. This was a capture-phase listener with a `stopPropagation`
     — the same idea, spelt as a race against App's own handler, and the race is
     what the hatch removes. See src/lib/escapeHatch.js. */
  useEscapeClaim(true, () => onClose(), 'wall-tone');
  useEffect(() => {
    /* --- CLOSING ON A PRESS ELSEWHERE, WITHOUT A BACKDROP -------------------
       A transparent sheet over the page is the usual way to do this and it is
       the wrong way HERE, because the thing most likely to be pressed next is
       another wall — and a backdrop would swallow that press, so answering four
       walls would take eight clicks, every other one doing nothing visible.
       So the listener is on the window instead and the drawing stays live: a
       press on the next wall closes this card and opens that wall's in one go.
       CAPTURE, AND ORDER IS WHY IT WORKS. This runs before the segment's own
       handler, so the sequence is close-then-open and the open is the write that
       lands. Presses inside the card are ignored, or answering would close the
       card before the answer reached it. */
    const down = (e) => { if (!box.current?.contains(e.target)) onClose(); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [onClose]);

  return (
    <div ref={box} role="dialog" aria-label="Wall finish"
      style={{ left: pos.left, top: pos.top, width: W }}
      className="fixed z-[59] p-1 rounded-[10px] border border-border/15
        bg-ink-2/95 backdrop-blur-md shadow-[0_10px_34px_rgba(0,0,0,0.55)]">
      {TONES.map((t) => (
        <button key={t} type="button" aria-pressed={tone === t}
          className={'w-full text-left px-2.5 py-2 rounded-[7px] border cursor-pointer '
            + 'transition-colors duration-[120ms] block '
            + 'focus-visible:outline-2 focus-visible:outline-accent '
            + 'focus-visible:outline-offset-[-2px] '
            + (tone === t
              ? 'bg-white/10 border-border/20'
              : 'bg-transparent border-transparent hover:bg-white/5')}
          onClick={() => onPick(t)}>
          <span className="block text-[11.5px] leading-[1.35] text-white">
            {TONE_LABEL[t]}
          </span>
          <span className="block text-[10.5px] leading-[1.4] text-subtle mt-[2px]">
            {WALL_TONE_BLURB[t]}
          </span>
        </button>
      ))}
    </div>
  );
}
