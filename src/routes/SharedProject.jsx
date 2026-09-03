import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import ProfileRail from '../components/ProfileRail.jsx';
import PlanCard from '../components/PlanCard.jsx';
import SharedBanner from '../components/SharedBanner.jsx';
import { when } from './Dashboard.jsx';
import { openSharedProject } from '../lib/sharing.js';
import { PROJECT_TYPES } from '../lib/roomTypes.js';

// ---------------------------------------------------------------------------
// A PROJECT, BEHIND A VIEW LINK.
//
// THE MIRROR OF routes/AdminUserProject.jsx, and the resemblance is the design
// rather than a coincidence. Both screens show somebody else's plans to somebody
// the RLS would refuse, both get their rows from a server endpoint that checked
// a credential the browser could not have faked, and both wear a banner saying
// whose work this is. The only difference is which credential: an admin's role
// there, a link token here.
//
// WHY THIS IS NOT /projects/:id WITH A FLAG. Because the token is not a grant —
// see the header of api/share.js. A person holding a link has no policy-visible
// relationship to the project at all, so the ordinary route's every query would
// come back empty for them. The rows have to arrive through the endpoint, which
// means a route that knows to ask it.
//
// AND WHY IT IS STILL BEHIND RequireAuth. Same answer: a link is handed out, and
// a session is what makes the reader countable. One six-digit code, once. See
// the endpoint's header for the full argument.
//
// THE SCREEN NOBODY WITH A REAL GRANT EVER SEES. A link is a POINTER to a
// project, not a demotion of whoever follows it — so if the person opening it
// is already on the share list, or owns the thing, they are sent straight to
// /projects/:id and this component unmounts before it draws. That matters most
// for an editor: landing them here would be a read-only viewer with no sign
// that their own editable copy exists one screen away, which is the worst kind
// of dead end because it looks like the feature working.
//
// THE ENDPOINT DECIDES, NOT THIS FILE. `grant` comes back from /api/share,
// computed with the service key against the same test share_role() makes in the
// database — see grantFor() there. Asking the browser to work it out would mean
// a second query whose answer can disagree with the one the policies will give
// a moment later.
// ---------------------------------------------------------------------------
export default function SharedProject() {
  const { token } = useParams();
  const nav = useNavigate();

  const [data, setData] = useState(null);        // { project, plans }
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    (async () => {
      try {
        const d = await openSharedProject(token);
        if (alive) setData(d);
      } catch (e) {
        if (alive) setErr(String(e.message || e));
      }
    })();
    return () => { alive = false; };
  }, [token]);

  if (err) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-[min(460px,92%)] bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8] border border-border/10 rounded-lg p-6 text-center">
          <h2 className="m-0 mb-2.5 text-lg tracking-[-0.025em]">This link could not be opened</h2>
          <p className="m-0 mb-3.5 text-[12.5px] text-muted leading-[1.6]">{err}</p>
          <button
            className="text-xs leading-[1.5] px-3 py-[7px] rounded border border-border/10 bg-surface backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3"
            onClick={() => nav('/dashboard')}>Go to your dashboard</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="lp-spin w-[26px] h-[26px]" aria-label="Opening the project" />
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">Opening…</p>
      </div>
    );
  }

  const { project, plans, grant } = data;

  // OWNER, EDITOR OR NAMED VIEWER — none of them belong on this screen. `replace`
  // rather than a push, so Back goes wherever they came from instead of bouncing
  // off the redirect and straight back into it. A named viewer is redirected too:
  // /projects/:id is already read-only for them (see ProjectDetail), and sending
  // them to the same place the dashboard's "Shared with me" card does is the
  // difference between one project and two that look like different things.
  if (grant) return <Navigate to={`/projects/${project.id}`} replace />;

  const category = PROJECT_TYPES.find((t) => t.id === project.project_type)?.label
    ?? project.project_type;

  return (
    <div className="grid grid-cols-[56px_1fr] h-full">
      {/* THE RAIL STAYS. Whoever is here is signed in, and stranding them on a
          page with no way to their own work would make a shared link feel like
          a dead end rather than a door. */}
      <ProfileRail />
      <div className="grid grid-rows-[auto_auto_minmax(0,1fr)] min-h-0">
        <SharedBanner projectName={project.name} />
        {/* THE SAME BAR AS THE PROJECT SCREEN'S, minus everything that writes.
            No rename, no "add a plan" — this is a reading. */}
        <div className="h-14 flex-none flex items-center px-[30px] bg-white/5 backdrop-saturate-[1.8] backdrop-blur-[5px] border-b border-border/10">
          <div className="w-full max-w-[1180px] mx-auto flex items-center gap-3 min-w-0">
            <span className="text-[13.5px] text-white py-[3px] px-1.5 max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap">
              {project.name}
            </span>
            {category && (
              <span className="font-sans text-[10.5px] px-[11px] py-[4px] rounded-full border border-border/10 bg-white text-black whitespace-nowrap flex-none">
                {category}
              </span>
            )}
            <div className="flex-1" />
            <span className="text-[11.5px] text-subtle whitespace-nowrap">View only</span>
          </div>
        </div>

        <div className="overflow-y-auto pt-[26px] px-[30px] pb-[60px] w-full">
          <div className="w-full max-w-[1180px] mx-auto">
            <header className="mt-[6px] mb-[26px]">
              <p className="m-0 text-[13px] text-muted">
                {`${plans.length} plan${plans.length === 1 ? '' : 's'}`}
                {project.updated_at ? ` · updated ${when(project.updated_at)}` : ''}
              </p>
            </header>

            {plans.length === 0 ? (
              <div className="w-full border-[1.5px] border-dashed border-border/10 rounded-[16px] text-center backdrop-blur-[5px] bg-surface py-[76px] px-14 max-[700px]:py-12 max-[700px]:px-6">
                <h2 className="m-0 mb-3 text-[22px] tracking-[-0.03em]">Nothing here yet</h2>
                <p className="mx-auto m-0 text-muted max-w-[52ch] text-[13.5px] leading-[1.65]">
                  No drawings have been added to this project yet. The link stays
                  live, so it is worth checking back.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
                {plans.map((p) => (
                  <PlanCard key={p.id} plan={p}
                    onOpen={() => nav(`/shared/${token}/plans/${p.id}`)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
