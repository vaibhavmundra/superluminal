import React, { useState } from 'react';
import { PROJECT_TYPES } from '../lib/roomTypes.js';

// ---------------------------------------------------------------------------
// A PROJECT, NAMED AND CLASSIFIED BEFORE IT EXISTS.
//
// THE CATEGORY MOVED UP A LEVEL, and that is the substance of this component
// rather than the form itself. It used to be asked per PLAN, in a modal over the
// editor, the moment a drawing became readable — which is the wrong place twice
// over. It is wrong because a project is a building: the ground floor and the
// first floor of the same house are not a house and a hotel, so asking again per
// sheet is asking a question whose answer cannot have changed. And it is wrong
// because it interrupts. The user has just dropped a drawing and wants to see it
// lit; a taxonomy question at that moment is a toll booth.
//
// Asked here, it is asked once for every plan that will ever be in the project,
// at the only moment when the user is thinking about the project rather than
// about a drawing. The plan-level dialog still exists and still works — a plan in
// a project with no category set falls back to it — because there are older
// projects and there is the standalone editor, and a flow that only works when
// somebody came through the front door is not finished.
//
// NAME FIRST, autofocused. It is the field somebody is guaranteed to want to
// fill, and a category grid above it would make the form feel like a survey.
// ---------------------------------------------------------------------------

export default function NewProjectDialog({ onCreate, onCancel, busy = false }) {
  const [name, setName] = useState('');
  const [type, setType] = useState(null);

  const ready = name.trim().length > 0 && !!type && !busy;
  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    onCreate({ name: name.trim(), projectType: type });
  };

  return (
    <div className="modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <form className="modal wide" onSubmit={submit}>
        <h2>New project</h2>
        <p className="note" style={{ margin: '0 0 18px' }}>
          A project holds every plan for one building. The category decides what
          each space can be, and what lighting each kind of space gets — so it is
          asked once here rather than on every drawing.
        </p>

        <label className="auth-label" htmlFor="proj-name">Project name</label>
        <input id="proj-name" type="text" autoFocus value={name} placeholder="Mehta Residence, Ground Floor"
          onChange={(e) => setName(e.target.value)} />

        <div className="modal-gap" />

        <label className="auth-label">Category</label>
        <div className="proj-grid">
          {PROJECT_TYPES.map((p) => (
            <button key={p.id} type="button"
              className={'proj-btn' + (type === p.id ? ' on' : '')}
              aria-pressed={type === p.id}
              onClick={() => setType(p.id)}>
              <b>{p.label}</b>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
