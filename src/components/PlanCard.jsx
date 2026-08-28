import React from 'react';
import { publicUrl } from '../lib/db.js';

const STATUS = {
  uploaded: { label: 'Not started', cls: '' },
  tracing: { label: 'Spaces traced', cls: '' },
  planning: { label: 'In progress', cls: 'ok' },
  ready: { label: 'Ready', cls: 'ok' },
  failed: { label: 'Upload failed', cls: 'bad' },
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
    <article className="card plan-card" role="button" tabIndex={0}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="plan-shot">
        {shot
          ? <img src={shot} alt="" loading="lazy" />
          : <div className="plan-shot-empty">{plan.source_kind === 'vector' ? 'DXF' : 'Plan'}</div>}
      </div>
      <div className="card-body">
        <h4>{plan.name}</h4>
        <div className="card-meta">
          {project?.name && <><span>{project.name}</span><span className="dotsep">·</span></>}
          <span className={'pill ' + st.cls}>{st.label}</span>
        </div>
        {!!s.lights && (
          <div className="card-stats">
            <span><b>{s.rooms}</b> spaces</span>
            <span><b>{s.lights}</b> fittings</span>
            <span><b>{Math.round(s.areaSqft)}</b> sqft</span>
          </div>
        )}
      </div>
      {onDelete && (
        <div className="card-foot">
          <button className="linkish danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
