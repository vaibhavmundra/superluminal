import React from 'react';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// THE BANNER THAT SAYS THIS IS NOT YOURS.
//
// Every admin screen looks almost exactly like the screen a user sees, which is
// the whole point of them and also the whole danger: a dashboard full of
// somebody else's projects is indistinguishable from your own until you read a
// project name and do not recognise it. So the banner is not a courtesy, it is
// the thing that stops a support conversation being conducted about the wrong
// account.
//
// IT IS MAGENTA AND IT IS AT THE TOP. Magenta because the editor's audit
// overlays already use it for "working, not product" and the operator's
// surfaces should read as one thing; at the top because a warning below the
// content is a warning you meet after you have already believed the content.
//
// AND IT CARRIES THE WAY BACK. A person who has drilled three levels into
// somebody else's account needs one obvious exit, and the browser's Back button
// is not it after six clicks.
// ---------------------------------------------------------------------------
/**
 * `flush` IS THE ADMIN VIEWER'S VARIANT, and it exists because that banner is
 * not a card on a page — it is the top edge of a full-height editor shell. So
 * it drops the margin and the radius and keeps one border, on the bottom, which
 * is the rule between it and the drawing below. Everywhere else the banner sits
 * inside a padded page and the boxed version is right.
 */
export default function ViewingAs({ user, userId, plan = null, project = null, flush = false }) {
  const name = user?.full_name || user?.email || 'this user';
  const linkish = 'border-0 bg-transparent p-0 cursor-pointer text-[11.5px] text-[#C026D3] no-underline hover:underline';
  return (
    <div
      className={'flex items-center gap-[11px] px-3.5 py-2.5 border-[#F0ABFC] bg-[#FDF2FE] '
        + (flush ? 'border-0 border-b border-solid' : 'mb-[22px] rounded border')}
      role="status"
    >
      <span
        className="w-2 h-2 rounded-full bg-[#C026D3] flex-none animate-[viewing-pulse_2.4s_ease-in-out_infinite] motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-px min-w-0 flex-1">
        <b className="text-[12.5px] text-ink">Viewing {name}’s account</b>
        <span className="text-[11.5px] text-muted">
          {user?.email && user.email !== name ? <>{user.email} · </> : null}
          Read only — nothing on this screen can change their work.
        </span>
      </div>
      <div className="flex gap-3.5 flex-none">
        {(plan || project) && (
          <Link className={linkish} to={`/admin/users/${userId}`}>Their projects</Link>
        )}
        <Link className={linkish} to="/admin/users">All users</Link>
      </div>
    </div>
  );
}
