import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { stashUpload } from '../lib/pendingUpload.js';
import { startPlanUpload } from '../lib/uploads.js';
import Wordmark from '../components/Wordmark.jsx';
import HowToLink from '../components/HowToLink.jsx';

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
//
// AND THERE IS NO PRICE ON IT. There was, briefly — a band of tiers under the
// drop target — and it was one thing too many on a page with one job.
//
// The argument for putting it there was that somebody asks "what does this cost"
// on the way out. The argument against is stronger: this page exists to get a
// drawing into the app, the answer to "what does it cost" is FREE for the first
// three thousand square feet, and a row of dollar amounts under the upload button
// invites the visitor to price the tool before they have watched it light a single
// room. The first three thousand square feet are the sales pitch; the prices are
// one word away in the header for anybody who wants them sooner.
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
    <div className="min-h-full flex flex-col">
      <header className="h-14 flex-none flex items-center gap-3.5 px-[22px] border-b border-border/10 bg-white/5 backdrop-saturate-[1.8] backdrop-blur-[5px]">
        <Wordmark />
        <div className="flex-1" />
        <button className="text-[12px] py-[7px] px-1.5 border-0 bg-transparent text-subtle cursor-pointer no-underline transition-colors duration-[120ms] hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 focus-visible:rounded-[3px]" onClick={() => nav('/pricing')}>Pricing</button>
        {ready && (user
          ? <button className="text-[12px] py-[7px] px-3 rounded border border-border/10 bg-surface backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3" onClick={() => nav('/dashboard')}>Your projects</button>
          : <button className="text-[12px] py-[7px] px-3 rounded border border-border/10 bg-surface backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3" onClick={() => nav('/login')}>Sign in</button>)}
      </header>

      <main
        className={'flex-1 flex flex-col items-center justify-center text-center px-6 py-16 gap-1.5 border-2 transition-colors duration-150' + (over ? ' border-border/10 bg-white/5 backdrop-blur-[5px]' : ' border-transparent')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files?.[0]); }}
      >
        <h1 className="mb-[10px] text-[clamp(34px,4.4vw,72px)] leading-[1.04] tracking-[-0.035em] max-w-[22ch]">AI powered lighting layouts<br />in minutes</h1>
        <p className="mb-[26px] text-subtle max-w-[56ch] text-lg leading-[1.6]">
          Developed by lighting designers. Superluminal turns any floor plan into a functional lighting layout in minutes.
        </p>

        <div className="flex flex-col items-center gap-3">
          <button className="lp-glow-btn text-[14px] py-0 px-12 rounded-[8px] h-field-h inline-flex items-center justify-center"
            onClick={() => inputRef.current?.click()}>
            + Upload a floor plan
          </button>
          <input ref={inputRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
            onChange={(e) => accept(e.target.files?.[0])} />
          <span className="text-[11.5px] text-subtle">or drop it anywhere on this page · DXF, PDF or image</span>
          {/* UNDER THE DROP HINT, NOT BETWEEN IT AND THE BUTTON. The hint is the
              second half of the button's own sentence — "upload one, or drop it
              anywhere" — and a link wedged into the middle of that would break
              one instruction into two. */}
          <HowToLink className="mt-1" />
        </div>

        {err && <p className="text-[11.5px] leading-[1.5] mt-2 text-danger border-l-2 border-danger pl-[9px] max-w-[48ch]">{err}</p>}
      </main>

      <footer className="flex-none flex justify-between px-[22px] py-4 border-t border-border/10 text-[11px] text-subtle bg-surface backdrop-blur-[5px]">
        <span></span>
        <span></span>
      </footer>
    </div>
  );
}
