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
    <div className="modal-wrap">
      <div className="modal">
        {busy ? (
          <div className="modal-busy">
            <div className="modal-spin" aria-hidden="true" />
            <div>
              <b>{busy}</b>
              {note && <p className="note" style={{ margin: '4px 0 0' }}>{note}</p>}
            </div>
          </div>
        ) : (<>
          <h2>What are you planning?</h2>
          <p className="note" style={{ margin: '0 0 14px' }}>
            {planName ? <><b>{planName}</b> — </> : null}
            this decides what each space can be, and what lighting each kind of
            space gets.
          </p>
          <div className="proj-grid">
            {PROJECT_TYPES.map((p) => (
              <button key={p.id} className="proj-btn" onClick={() => onPick(p.id)}>
                <b>{p.label}</b>
                <span>{p.blurb}</span>
              </button>
            ))}
          </div>
        </>)}
      </div>
    </div>
  );
}
