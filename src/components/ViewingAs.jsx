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
export default function ViewingAs({ user, userId, plan = null, project = null }) {
  const name = user?.full_name || user?.email || 'this user';
  return (
    <div className="viewing-as" role="status">
      <span className="viewing-dot" aria-hidden="true" />
      <div className="viewing-text">
        <b>Viewing {name}’s account</b>
        <span>
          {user?.email && user.email !== name ? <>{user.email} · </> : null}
          Read only — nothing on this screen can change their work.
        </span>
      </div>
      <div className="viewing-links">
        {(plan || project) && (
          <Link className="linkish" to={`/admin/users/${userId}`}>Their projects</Link>
        )}
        <Link className="linkish" to="/admin/users">All users</Link>
      </div>
    </div>
  );
}
