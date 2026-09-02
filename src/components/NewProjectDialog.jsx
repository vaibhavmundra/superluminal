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
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <form className="w-[min(620px,94vw)] bg-surface border border-border rounded-[14px] px-[22px] pt-[22px] pb-5 shadow-[0_18px_50px_rgba(20,20,40,.18)]" onSubmit={submit}>
        <h2 className="m-0 mb-1.5 text-[17px] tracking-[-0.01em]">New project</h2>
        <p className="text-[11.5px] text-muted leading-normal m-0 mb-[18px]">
          A project holds every plan for one building. The category decides what
          each space can be, and what lighting each kind of space gets — so it is
          asked once here rather than on every drawing.
        </p>

        <label className="text-[10px] tracking-[0.11em] uppercase text-subtle" htmlFor="proj-name">Project name</label>
        <input id="proj-name" type="text" autoFocus value={name} placeholder="Mehta Residence, Ground Floor"
          onChange={(e) => setName(e.target.value)} />

        <div className="h-[18px]" />

        <label className="text-[10px] tracking-[0.11em] uppercase text-subtle">Category</label>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          {PROJECT_TYPES.map((p) => (
            <button key={p.id} type="button"
              className={
                'flex flex-col items-start gap-0.5 px-3 py-[11px] rounded-[9px] cursor-pointer text-left transition-[border-color_.12s,background-color_.12s,transform_.08s] active:translate-y-px border ' +
                (type === p.id
                  ? 'border-accent bg-accent-soft shadow-[0_0_0_1px_var(--color-accent)_inset]'
                  : 'border-border bg-surface hover:border-ink hover:bg-surface-2')
              }
              aria-pressed={type === p.id}
              onClick={() => setType(p.id)}>
              <b className={type === p.id ? 'text-[13px] text-accent' : 'text-[13px]'}>{p.label}</b>
              <span className="text-[10.5px] text-subtle leading-[1.3]">{p.blurb}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" className="text-xs px-3 py-[7px] rounded border border-border-strong bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-ink active:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="text-xs px-3 py-[7px] rounded border border-cta bg-cta text-white cursor-pointer transition-colors duration-[120ms] hover:bg-cta-hover hover:border-cta-hover disabled:opacity-40 disabled:cursor-not-allowed" disabled={!ready}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
