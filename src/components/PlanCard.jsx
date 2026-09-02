import React from 'react';
import { publicUrl } from '../lib/db.js';

const STATUS = {
  uploaded: { label: 'Not started', cls: '' },
  tracing: { label: 'Spaces traced', cls: '' },
  planning: { label: 'In progress', cls: 'ok' },
  ready: { label: 'Ready', cls: 'ok' },
  failed: { label: 'Upload failed', cls: 'bad' },
};

// The old `.pill` / `.pill.ok` / `.pill.bad` classes, as Tailwind utilities.
const PILL_BASE = 'font-sans text-[10.5px] px-2 py-[3px] rounded-full border whitespace-nowrap tabular-nums';
const PILL_CLS = {
  '': 'border-border/10 bg-white/5 backdrop-blur-[5px] text-subtle',
  ok: 'border-ok/10 bg-ok/10 backdrop-blur-[5px] text-ok',
  bad: 'border-danger/10 bg-danger/10 backdrop-blur-[5px] text-danger',
};

/**
 * A PLAN, AS A CARD. The snapshot is the card — a lighting layout is a drawing,
 * and a list of filenames is the one presentation that throws away everything
 * the user made. Until a design exists there is nothing to show, so the tile
 * says so rather than showing a grey rectangle that looks like a failed image.
 */
export default function PlanCard({ plan, project = null, onOpen, onDelete = null }) {
  const st = STATUS[plan.status] || STATUS.uploaded;
  const shot = plan.snapshot_path ? publicUrl(plan.snapshot_path) : null;
  const s = plan.stats || {};

  return (
    <article
      className="relative flex flex-col bg-surface backdrop-blur-[5px] border border-border/10 rounded-lg overflow-hidden cursor-pointer pt-5 px-[18px] pb-[18px] transition-[border-color,background-color,box-shadow] duration-[120ms] [transition-timing-function:ease] hover:bg-white/10 hover:border-border/10 hover:shadow-pop focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      role="button" tabIndex={0}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="aspect-[4/3] bg-black/40 border-b border-border/10 grid place-items-center overflow-hidden">
        {shot
          ? <img src={shot} alt="" loading="lazy" className="w-full h-full object-cover block" />
          : <div className="text-[10px] tracking-[0.14em] uppercase text-faint">{plan.source_kind === 'vector' ? 'DXF' : 'Plan'}</div>}
      </div>
      <div className="py-[13px] px-[14px] flex-1">
        <h4 className="m-0 mb-1.5 text-[13.5px] tracking-[-0.01em]">{plan.name}</h4>
        <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-muted">
          {project?.name && <><span>{project.name}</span><span className="text-faint">·</span></>}
          <span className={PILL_BASE + ' ' + PILL_CLS[st.cls]}>{st.label}</span>
        </div>
        {!!s.lights && (
          <div className="flex gap-3.5 mt-2.5 text-[11px] text-muted">
            <span><b className="text-white tabular-nums">{s.rooms}</b> spaces</span>
            <span><b className="text-white tabular-nums">{s.lights}</b> fittings</span>
            <span><b className="text-white tabular-nums">{Math.round(s.areaSqft)}</b> sqft</span>
          </div>
        )}
      </div>
      {onDelete && (
        <div className="py-2 px-3.5 border-t border-border/10 flex justify-end">
          <button
            className="border-0 bg-transparent text-[11.5px] text-danger cursor-pointer p-0 no-underline hover:underline"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
