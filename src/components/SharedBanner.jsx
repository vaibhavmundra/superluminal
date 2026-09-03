import React from 'react';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// THE BANNER ON A SHARED LINK.
//
// THE SAME JOB AS ViewingAs AND A DELIBERATELY DIFFERENT COLOUR. Both banners
// say "this screen is not yours", and both sit on top of a shell that is
// pixel-for-pixel the real thing. The magenta one means OPERATOR — it is the
// same warm signal the editor's audit overlays use, and it should stay rare and
// slightly alarming, because the person seeing it is looking at somebody's
// account without being invited into it.
//
// This is the ordinary case: somebody was handed a link and followed it. That is
// not an alarm, it is a state, so it takes the app's own glass and says what is
// true in one line. Using the operator's magenta here would train people to read
// it as decoration, which would cost exactly when it matters.
//
// FLUSH TO THE TOP EDGE, no radius, one hairline underneath — the same variant
// ViewingAs takes on the admin viewer, and for the same reason: this is the top
// edge of a full-height shell rather than a card on a padded page.
// ---------------------------------------------------------------------------
export default function SharedBanner({ projectName = '', planName = null, backTo = null }) {
  return (
    <div className="flex items-center gap-[11px] px-[30px] py-2 bg-white/5 backdrop-saturate-[1.8]
      backdrop-blur-[5px] border-b border-border/10" role="status">
      <span className="w-2 h-2 rounded-full bg-white/50 flex-none" aria-hidden="true" />
      <div className="flex flex-col gap-px min-w-0 flex-1">
        <b className="text-[12px] text-white font-normal overflow-hidden text-ellipsis whitespace-nowrap">
          {planName
            ? <>Shared with you · {planName}</>
            : <>Shared with you{projectName ? <> · {projectName}</> : null}</>}
        </b>
        <span className="text-[11px] text-subtle">
          View only — nothing you do on this screen is saved, and nothing here is yours to change.
        </span>
      </div>
      <div className="flex gap-3.5 flex-none">
        {backTo && (
          <Link className="border-0 bg-transparent p-0 cursor-pointer text-[11.5px] text-subtle no-underline hover:text-white"
            to={backTo}>All plans</Link>
        )}
        <Link className="border-0 bg-transparent p-0 cursor-pointer text-[11.5px] text-subtle no-underline hover:text-white"
          to="/dashboard">Your dashboard</Link>
      </div>
    </div>
  );
}
