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
// ---------------------------------------------------------------------------

export default function ProjectTypeDialog({ planName, onPick }) {
  return (
    <div className="modal-wrap">
      <div className="modal">
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
      </div>
    </div>
  );
}
