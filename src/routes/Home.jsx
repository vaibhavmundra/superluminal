import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { stashUpload } from '../lib/pendingUpload.js';
import { startPlanUpload } from '../lib/uploads.js';
import Wordmark from '../components/Wordmark.jsx';
import LegalLinks from '../components/LegalLinks.jsx';
import HowToLink from '../components/HowToLink.jsx';
import ScheduleDemoButton from '../components/ScheduleDemoButton.jsx';
import HeroVideo from '../components/HeroVideo.jsx';

// ---------------------------------------------------------------------------
// THE HOME PAGE, which is the upload screen with a promise over it.
//
// One sentence and one button. The sentence is a CLAIM ABOUT TIME — "in
// minutes" — because that is the thing this tool actually competes on, and the
// button is the same drop target the editor has always had, so there is exactly
// one gesture to learn and it is the first one you make.
//
// AND THE CLAIM NOW HAS THE EVIDENCE BESIDE IT. The hero is two columns: the
// promise and the gesture on the left, eight silent seconds of the editor
// actually reading a plan and lighting it on the right (HeroVideo.jsx). Beside
// and not under, because a visitor who has to scroll to find out what the tool
// looks like has already decided it is a form. The recording is deferred until
// the page has loaded — it is a poster until then — so the thing that argues
// for the app cannot be the thing that makes it slow to arrive.
//
// THE WHOLE PAGE IS STILL THE DROP TARGET. The grid lives INSIDE <main>, which
// keeps its drag handlers and its two-pixel border: a drawing let go over the
// video lands in the app exactly as one let go over the headline does.
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
// drawing into the app, the answer to "what does it cost" is FREE FOR THE FIRST
// THREE FLOOR PLANS, and a row of dollar amounts under the upload button invites
// the visitor to price the tool before they have watched it light a single room.
// Those first three plans are the sales pitch; the prices are one word away in
// the header for anybody who wants them sooner.
//
// IT USED TO BE "the first three thousand square feet", and the change is worth
// noting because it is the same argument one level down. A visitor who has not
// measured their drawing cannot tell whether 3,000 sq ft is generous or nothing
// at all, so the old promise was a number that could only be understood after
// the thing it was meant to persuade them to do. Three plans is countable
// before you start. See TIERS in src/lib/plans.js.
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
      {/* BLACK, AND OPAQUE — not the 5% white glass every other bar in this app
          wears. The page's own ground is #000 with a 24px graph-paper grid drawn
          over it, and glass lets that grid run straight through the header and
          behind the wordmark. A logotype with ruled lines showing through it is
          a logotype nobody chose. And the logo is a PLATED asset — white ink on
          an opaque black rectangle, chosen because it is a tenth the weight of
          the transparent cut (see Wordmark.jsx) — so anything but #000 behind it
          shows the plate as a box round the mark. The hairline underneath is
          then what separates the bar from the page rather than a change in
          tone.

          `bg-[var(--bg)]` AND NOT `bg-bg`, WHICH IS A TRAP IN THIS STYLESHEET.
          There are two tokens a foot apart with almost the same name: `--bg` on
          `:root` is the page's ground and is #000000, while `--color-bg` in the
          `@theme` block — which is what Tailwind builds `bg-bg` out of — is
          #FAFAFA, a leftover from the light palette. `bg-bg` here would have
          painted the header very nearly white. Reading the page's own token
          also means the bar follows the ground if the ground ever moves. */}
      <header className="h-14 flex-none flex items-center gap-3.5 px-[22px] border-b border-border/10 bg-[var(--bg)]">
        <Wordmark />
        <div className="flex-1" />
        <button className="text-[12px] py-[7px] px-1.5 border-0 bg-transparent text-subtle cursor-pointer no-underline transition-colors duration-[120ms] hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 focus-visible:rounded-[3px]" onClick={() => nav('/pricing')}>Pricing</button>
        {ready && (user
          ? <button className="text-[12px] py-[7px] px-3 rounded border border-border/10 bg-surface backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3" onClick={() => nav('/dashboard')}>Your projects</button>
          : <button className="text-[12px] py-[7px] px-3 rounded border border-border/10 bg-surface backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3" onClick={() => nav('/login')}>Sign in</button>)}
      </header>

      <main
        className={'flex-1 flex items-center justify-center px-6 py-14 border-2 transition-colors duration-150' + (over ? ' border-border/10 bg-white/5 backdrop-blur-[5px]' : ' border-transparent')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files?.[0]); }}
      >
        {/* 5:6 AND NOT 1:1. The column carrying the picture is the wider of the
            two because the picture is a screen recording of a dense editor — a
            panel, a rail and a plan — and at half of 1180px its text is a
            texture rather than an interface. The words need less room than that
            to be read, and a headline set to 14 characters a line is fine.

            THE BREAKPOINT IS 960px, which is this app's one breakpoint (see the
            tool rail and the ceiling grid). Under it the grid becomes a single
            column, the words go back to centred — which is what a phone wants
            — and the recording sits under them at full width. */}
        <div className="w-full max-w-[1180px] mx-auto grid items-center gap-x-12 gap-y-10
          grid-cols-[minmax(0,5fr)_minmax(0,6fr)]
          [@media(max-width:960px)]:grid-cols-[minmax(0,1fr)]">
          <div className="flex flex-col items-center text-center
            [@media(max-width:960px)]:items-center [@media(max-width:960px)]:text-center">
            {/* SMALLER THAN IT WAS, because it is in half a page now. The old
                4.4vw was sized against the full width and would have run to five
                lines in this column; the clamp still grows with the window, just
                against the share of it this text actually owns. */}
            <h1 className="mb-[10px] text-[clamp(32px,3.6vw,54px)] leading-[1.06] tracking-[-0.035em] max-w-[16ch]">Create perfect lighting layouts, every time</h1>
            <p className="mb-[26px] text-subtle max-w-[44ch] text-lg leading-[1.6]">
              See light coverage as you design. Auto generates fully flexible electrical layouts in a click.
            </p>

            <div className="flex flex-col items-start gap-3 [@media(max-width:960px)]:items-center">
              <button className="lp-glow-btn text-[14px] py-0 px-0 w-[240px] rounded-[8px] h-field-h inline-flex items-center justify-center"
                onClick={() => inputRef.current?.click()}>
                + Upload a floor plan
              </button>
              <input ref={inputRef} type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
                onChange={(e) => accept(e.target.files?.[0])} />
              <ScheduleDemoButton />
              <span className="text-[11.5px] text-subtle">or drop it anywhere on this page · DXF, PDF or image</span>
              {/* UNDER THE DROP HINT, NOT BETWEEN IT AND THE BUTTON. The hint is the
                  second half of the button's own sentence — "upload one, or drop it
                  anywhere" — and a link wedged into the middle of that would break
                  one instruction into two. */}
              <HowToLink className="mt-1" />
            </div>

            {err && <p className="text-[11.5px] leading-[1.5] mt-2 text-danger border-l-2 border-danger pl-[9px] max-w-[48ch]">{err}</p>}
          </div>

          <HeroVideo />
        </div>
      </main>

      {/* THE FOOTER WAS TWO EMPTY SPANS held apart by `justify-between` — the
          shape of a footer with nothing in it yet. It now carries the two things
          a footer is for: who this is, and the documents that govern using it.
          `flex-wrap` because three links and a company name do not fit one line
          on a phone, and a footer that overflows horizontally is worse than one
          that takes two lines. */}
      <footer className="flex-none flex flex-wrap gap-y-2 items-center justify-between px-[22px] py-4 border-t border-border/10 text-[11px] text-subtle bg-surface backdrop-blur-[5px]">
        <span>© {new Date().getFullYear()} Zima Blue Private Limited</span>
        <LegalLinks />
      </footer>
    </div>
  );
}
