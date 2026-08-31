import React from 'react';

// ---------------------------------------------------------------------------
// BusyModal — the same box, saying what it is doing.
//
// EXTRACTED FROM ProjectTypeDialog rather than copied out of it, because the
// door search and the electrical pass are the same moment to a person: a thing
// they asked for, that takes a few seconds, that the rest of the screen cannot
// usefully be used during. Two copies of this markup would drift on the first
// styling change and the second wait would start looking like a different
// product from the first.
//
// SAME SIZE AS THE QUESTION IT REPLACES, deliberately — that is what the
// min-height on the busy row is for. The dialog must not jump when a grid of
// five buttons is swapped for one line of text; it is the same box, not a new
// screen. The two wrapper divs are ProjectTypeDialog's own, kept in step with
// it by hand.
//
// NO DISMISS, NO BACKDROP CLICK. Nothing here is cancellable yet, and a close
// button that stops the spinner without stopping the work is a lie.
// ---------------------------------------------------------------------------

export default function BusyModal({ line, note = null }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]">
      <div className="w-[min(520px,calc(100vw-40px))] bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8] border border-border/10 rounded-[14px] px-[22px] pt-[22px] pb-5 shadow-pop">
        <div className="flex items-center gap-[14px] py-[10px] px-0.5 min-h-[74px]">
          <div className="lp-spin w-[22px] h-[22px] flex-none" aria-hidden="true" />
          <div>
            <b className="text-sm block text-white">{line}</b>
            {note && <p className="text-[11.5px] text-muted leading-normal m-0 mt-1">{note}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
