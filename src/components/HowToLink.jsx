import React, { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// "LEARN HOW TO USE" — the walkthrough, one line under the thing it explains.
//
// ONE COMPONENT BECAUSE IT APPEARS IN THREE PLACES and they are the same moment
// in three screens: under the home page's upload button, and under the "choose a
// drawing" button on both empty states. Somebody who has just been handed a drop
// target and does not know what happens next is the only person who wants this
// link, so it sits exactly where that hesitation happens — and a second copy of
// the URL is a second thing to forget when the video is re-cut.
//
// IT PLAYS HERE RATHER THAN SENDING YOU AWAY, and that is the whole point of
// the change. It used to be a plain link to youtube.com, and every one of the
// three places it appears is a screen where somebody is MID-TASK — a file
// chosen, a project just made, a drop target under the cursor. Handing them a
// new tab at that moment means either losing the page they were on or coming
// back to it cold. A player over the top keeps the screen behind it and closes
// back onto exactly what they were doing.
//
// IT IS STILL A REAL LINK UNDERNEATH. `<a href>` with the watch URL, so the
// gestures a link owes you all work — middle-click, ⌘-click, copy link address —
// and only a plain left click is intercepted to open the player instead. A
// `<button>` here would silently break all three. The modifier check is what
// makes that true rather than nearly true.
//
// QUIET BY DEFAULT. It sits directly beneath the one act each of these screens
// exists for, and the accent ramp is spoken for by that button — a second warm
// mark under it would make the page ask which of the two it meant. Subtle type
// that goes white under the pointer is the same treatment the back arrows and
// the menu items get, and the icon carries the recognition on its own.
// ---------------------------------------------------------------------------

const VIDEO_ID = 'zHTkpmv6fB4';
/** Where a real click, a middle-click or a ⌘-click still goes. */
const WATCH = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
/**
 * ...AND WHAT THE PLAYER LOADS.
 *
 * `youtube-nocookie.com` RATHER THAN `youtube.com`, which is the privacy-
 * preserving host for exactly this: it does not set tracking cookies until
 * somebody actually presses play. The page it is embedded in is our own
 * marketing screen, so there is no reason for a visitor who never watches to
 * pick up anything at all.
 *
 * `autoplay=1` IS EARNED HERE and would not be anywhere else. Nothing on this
 * page moves on its own; the player exists only because somebody clicked the
 * words "Learn how to use", so starting the thing they asked for is the whole
 * of what they asked for. `rel=0` keeps the end card to this channel instead of
 * offering somebody else's video, and `modestbranding=1` drops the watermark.
 */
const EMBED = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`
  + '?autoplay=1&rel=0&modestbranding=1&playsinline=1';

/**
 * THE YOUTUBE BADGE, DRAWN RATHER THAN LOADED, for the reason every other icon
 * in this app is: it takes `currentColor` with it, so one element decides both
 * the type and the mark, and it stays sharp at any density.
 *
 * WHITE — WHICH MEANS THE PLAY TRIANGLE IS A HOLE, NOT A SHAPE. The real badge
 * is a red rounded rectangle with a white triangle knocked out of it, and the
 * obvious translation to one colour — a white box with a white triangle on it —
 * is a white box. So the whole glyph is ONE path with `fillRule="evenodd"`: the
 * outer rounded rect and the triangle are two subpaths in the same fill, and the
 * even-odd rule punches the second out of the first. The ground shows through
 * the triangle, whatever the ground happens to be.
 */
function YouTubeMark() {
  return (
    <svg viewBox="0 0 28 20" width="19" height="14" aria-hidden="true"
      className="block flex-none">
      <path fill="currentColor" fillRule="evenodd" d="
        M11.2 0h5.6c2.6 0 4.4.1 5.5.2 1.1.1 1.9.3 2.4.6.6.3 1 .8 1.3 1.5.3.7.5 1.7.6 3
        .1 1.3.1 2.5.1 3.6v2.2c0 1.1 0 2.3-.1 3.6-.1 1.3-.3 2.3-.6 3-.3.7-.7 1.2-1.3 1.5
        -.5.3-1.3.5-2.4.6-1.1.1-2.9.2-5.5.2h-5.6c-2.6 0-4.4-.1-5.5-.2-1.1-.1-1.9-.3-2.4-.6
        -.6-.3-1-.8-1.3-1.5-.3-.7-.5-1.7-.6-3C0 13.9 0 12.7 0 11.6V9.4c0-1.1 0-2.3.1-3.6
        .1-1.3.3-2.3.6-3C1 2.1 1.4 1.6 2 1.3c.5-.3 1.3-.5 2.4-.6C5.5.1 7.3 0 9.9 0h1.3z
        M11.1 5.7v8.6L18.6 10l-7.5-4.3z" />
    </svg>
  );
}

/**
 * @param className extra utilities from the caller — the three sites want
 *   different margins above, and a margin baked in here would be wrong at two
 *   of them.
 */
export default function HowToLink({ className = '' }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);

  /* ESCAPE, AND ONLY WHILE IT IS OPEN. Bound on the document rather than on the
     card, because the focus can legitimately be inside the <iframe> — which is
     another origin, so no keydown from in there ever reaches us. A listener on
     the card would work exactly until somebody clicked the video, which is the
     first thing they will do.
     THE CLOSE BUTTON TAKES FOCUS ON OPEN for the other half of the same
     problem: focus left on the link behind the scrim is focus in a part of the
     page the scrim has taken away. */
  useEffect(() => {
    if (!open) return;
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', key);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', key);
  }, [open]);

  return (
    <>
      <a href={WATCH} target="_blank" rel="noopener noreferrer"
        className={'inline-flex items-center gap-2 mt-4 text-[11.5px] text-subtle no-underline '
          + 'cursor-pointer transition-colors duration-[120ms] hover:text-white '
          + 'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 '
          + 'focus-visible:rounded-[3px] ' + className}
        onClick={(e) => {
          /* A PLAIN LEFT CLICK OPENS THE PLAYER; ANYTHING ELSE IS THE LINK'S OWN
             BUSINESS. ⌘/ctrl/shift/alt-click and middle-click are all requests
             for a new tab or window, and a `preventDefault` on those is the bug
             every hand-rolled in-page link has — the modifier is ignored and the
             app decides where you go instead of you. `button !== 0` never fires
             here (a middle-click raises `auxclick`, not `click`) and is left in
             as the belt to the braces. */
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          setOpen(true);
        }}>
        <YouTubeMark />
        Learn how to use
      </a>

      {open && (
        /* THE SCRIM IS DARKER THAN THIS APP'S DIALOGS AND THAT IS DELIBERATE.
           The others sit behind a form and want the screen to stay legible
           underneath; this sits behind a VIDEO, and every stop of contrast the
           surround gives up is a stop the picture loses. `z-[80]` puts it over
           the account menu's `z-[70]` — the rail is on every screen this link
           appears on, and a menu left open behind a player would draw over it. */
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 backdrop-blur-[5px] p-5"
          role="dialog" aria-modal="true" aria-label="Learn how to use Super Luminal"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          {/* THE CARD IS THE APP'S DIALOG, at the width a 16:9 picture wants.
              `min(920px,100%)` and an aspect box under it, so the player is
              always exactly 16:9 and the card never has a black band in it. */}
          <div className="w-[min(920px,100%)] bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8]
            border border-border/10 rounded-[14px] p-3 shadow-pop">
            <div className="flex items-center gap-3 px-1 pt-0.5 pb-2.5">
              <span className="inline-flex items-center gap-2 text-[12.5px] text-white">
                <YouTubeMark />
                Learn how to use
              </span>
              <div className="flex-1" />
              {/* Small, quiet, and the LAST thing in the header rather than the
                  first: the picture is the subject and the way out is furniture. */}
              {/* A WHITE FOCUS RING HERE TOO, and not because this one was
                   amber — left alone it falls through to the global
                   `:focus-visible` in styles.css, which is #0070F3. Two controls
                   an inch apart in the same header, one ringed white and one
                   ringed blue, is worse than either. */}
              <a href={WATCH} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-subtle no-underline transition-colors duration-[120ms]
                  hover:text-white focus-visible:outline-2 focus-visible:outline-white
                  focus-visible:outline-offset-2 focus-visible:rounded-[3px]">
                Open on YouTube ↗
              </a>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)}
                aria-label="Close"
                className="border-0 bg-transparent text-subtle cursor-pointer leading-[0] p-1 rounded
                  transition-colors duration-[120ms] hover:text-white hover:bg-white/10
                  focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-1">
                <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor"
                  strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
            {/* MOUNTED ONLY WHILE OPEN, WHICH IS ALSO HOW PLAYBACK STOPS. There
                is no API call to pause a cross-origin player without loading
                YouTube's own iframe library; removing the element ends the video,
                the network traffic and the audio in one go. Closing the card has
                to actually stop the sound, and this is what makes that true. */}
            <div className="relative w-full aspect-video overflow-hidden rounded-[8px] bg-black">
              <iframe
                className="absolute inset-0 w-full h-full border-0"
                src={EMBED}
                title="Learn how to use Super Luminal"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
