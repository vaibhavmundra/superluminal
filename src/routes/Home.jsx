import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { stashUpload } from '../lib/pendingUpload.js';
import { startPlanUpload } from '../lib/uploads.js';
import Wordmark from '../components/Wordmark.jsx';

// ---------------------------------------------------------------------------
// THE HOME PAGE, which is the upload screen with a promise over it.
//
// One sentence and one button. The sentence is a CLAIM ABOUT TIME — "in
// minutes" — because that is the thing this tool actually competes on, and the
// button is the same drop target the editor has always had, so there is exactly
// one gesture to learn and it is the first one you make.
//
// THE SIGN-IN IS DELIBERATELY DOWNSTREAM OF THE DROP. Asking for an email
// before showing what the app does is asking for trust nobody has yet; asking
// for it while a drawing is already being read is asking at the only moment the
// answer is obviously worth it. The file is held in memory across the login step
// (pendingUpload.js) and turned into a plan the instant there is a session.
// ---------------------------------------------------------------------------
export default function Home() {
  const nav = useNavigate();
  const { user, ready } = useAuth();
  const [over, setOver] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  const accept = useCallback(async (file) => {
    if (!file) return;
    const ok = /\.(dxf|pdf)$/i.test(file.name)
      || (file.type || '').startsWith('image/')
      || file.type === 'application/pdf';
    if (!ok) { setErr('That is not a drawing — a DXF, a PDF, or an image of a plan, please.'); return; }
    setErr('');

    // NOT SIGNED IN: hold the file and go and ask. The route is remembered as
    // the home page rather than the editor, because the plan it would open does
    // not exist yet — Login finishes the upload once it has a session.
    if (!user) {
      stashUpload(file);
      nav('/login', { state: { from: '/', upload: file.name } });
      return;
    }

    // STRAIGHT THROUGH. The job creates the project and the row and pushes the
    // bytes in the background; the editor works from this very File and does not
    // need any of it to have finished. See lib/uploads.js.
    const job = startPlanUpload(file);
    nav(`/plans/${job.planId}`);
  }, [user, nav]);

  return (
    <div className="home">
      <header className="home-top">
        <Wordmark />
        <div className="spacer" />
        {ready && (user
          ? <button className="btn" onClick={() => nav('/dashboard')}>Your projects</button>
          : <button className="btn" onClick={() => nav('/login')}>Sign in</button>)}
      </header>

      <main
        className={'home-main' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files?.[0]); }}
      >
        <h1 className="home-h1">Create lighting layouts<br />in minutes</h1>
        <p className="home-sub">
          Lighting layouts used to take hours. Our trained AI models understand your space, the use case and create fully functional layouts in a matter of minutes.
        </p>

        <div className="home-cta">
          <button className="btn primary big"
            onClick={() => inputRef.current?.click()}>
            + Upload a floor plan
          </button>
          <input ref={inputRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
            onChange={(e) => accept(e.target.files?.[0])} />
          <span className="home-hint">or drop it anywhere on this page · DXF, PDF or image</span>
        </div>

        {err && <p className="note err home-err">{err}</p>}
      </main>

      <footer className="home-foot">
        <span></span>
        <span></span>
      </footer>
    </div>
  );
}
