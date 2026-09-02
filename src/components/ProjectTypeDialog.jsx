import React from 'react';
import { PROJECT_TYPES } from '../lib/roomTypes.js';

// ---------------------------------------------------------------------------
// ProjectTypeDialog — one question, once, before anything else happens.
//
// ASKED RATHER THAN GUESSED, and that is the point. Twelve identical rooms off a
// corridor are a hotel floor, a hostel or a student block; a plan cannot tell
// you which, and the lighting differs in each. It is one click, and it makes
// every room classification after it dramatically easier — a model told "this is
// an office" does not have to wonder whether the room with one desk is a study
// or a chamber.
//
// NO DISMISS AND NO DEFAULT. Every path after this reads the answer, so a
// skipped dialog would mean a pipeline that either guesses or stops. There is no
// close button and no backdrop click, which is a thing to be sparing with and is
// earned here: the question is unavoidable and answering it costs one click.
//
// IT ALSO HOLDS THE DOOR SEARCH, and that is a deliberate use of a moment that
// was going to be spent anyway. Looking for doors takes a couple of seconds and
// has to finish before the tracer is useful, because the doors are how the scale
// gets set. Landing the user on an empty tracer and popping the doors in
// underneath them a beat later is the worse version of the same wait: they will
// have started clicking. So the dialog stays up and says what it is doing, and
// the user arrives at a screen that is finished.
//
// `busy` is the line to show; falsy means the question is still being asked.
// ---------------------------------------------------------------------------

export default function ProjectTypeDialog({ planName, onPick, busy = null, note = null }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]">
      <div className="w-[min(520px,calc(100vw-40px))] bg-surface border border-border rounded-[14px] px-[22px] pt-[22px] pb-5 shadow-[0_18px_50px_rgba(20,20,40,.18)]">
        {busy ? (
          <div className="flex items-center gap-[14px] py-[10px] px-0.5 min-h-[74px]">
            <div className="w-[22px] h-[22px] flex-none rounded-full border-2 border-border border-t-accent animate-[sl-spin_.7s_linear_infinite]" aria-hidden="true" />
            <div>
              <b className="text-sm block">{busy}</b>
              {note && <p className="text-[11.5px] text-muted leading-normal m-0 mt-1">{note}</p>}
            </div>
          </div>
        ) : (<>
          <h2 className="m-0 mb-1.5 text-[17px] tracking-[-0.01em]">What are you planning?</h2>
          <p className="text-[11.5px] text-muted leading-normal m-0 mb-3.5">
            {planName ? <><b>{planName}</b> — </> : null}
            this decides what each space can be, and what lighting each kind of
            space gets.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
            {PROJECT_TYPES.map((p) => (
              <button key={p.id} className="flex flex-col items-start gap-0.5 px-3 py-[11px] border border-border rounded-[9px] bg-surface cursor-pointer text-left transition-[border-color_.12s,background-color_.12s,transform_.08s] hover:border-ink hover:bg-surface-2 active:translate-y-px" onClick={() => onPick(p.id)}>
                <b className="text-[13px]">{p.label}</b>
                <span className="text-[10.5px] text-subtle leading-[1.3]">{p.blurb}</span>
              </button>
            ))}
          </div>
        </>)}
      </div>
    </div>
  );
}
