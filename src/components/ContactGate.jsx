import React, { useCallback, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { OCCUPATIONS, normalisePhone, occupationOf, profileComplete } from '../lib/profile.js';

// ---------------------------------------------------------------------------
// TWO QUESTIONS, ASKED ONCE, IN FRONT OF THE FIRST EXPORT.
//
// WHY HERE AND NOT AT SIGN-UP is argued at length in src/lib/profile.js and is
// the whole design: the login is one email and a six-digit code, and every field
// added to it is a reason not to finish it. By the first export the plan is lit,
// the schedule is counted and the file is one click away — the value has already
// been delivered, so asking is an exchange rather than a toll booth.
//
// IT BLOCKS THE EXPORT, AND IT IS DISMISSIBLE. Those two together are the whole
// of the pressure this applies. Escape, the backdrop and Cancel all close it and
// the download simply does not happen; nothing is lost, the drawing is still
// there, and clicking Export again brings it straight back. A hard modal with no
// way out would be the version people close the tab on, and a "skip" button
// would be the version nobody fills in.
//
// EXPORTED AS A HOOK PLUS A DIALOG, because three screens need it — the editor,
// the shared read-only viewer, and whatever comes next — and each of them has to
// render the dialog inside its own tree while handing App a plain async
// function. Two copies of the promise plumbing is one copy too many.
// ---------------------------------------------------------------------------

const LABEL = 'text-[10px] tracking-[0.11em] uppercase text-subtle';
const NOTE = 'text-[11.5px] text-muted leading-[1.5]';
const BTN_WHITE = 'text-xs px-3 py-[7px] rounded border border-white bg-white text-black '
  + 'cursor-pointer transition-colors duration-[120ms] hover:bg-text hover:border-text '
  + 'disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_QUIET = 'text-xs px-3 py-[7px] rounded border border-border/10 bg-surface '
  + 'backdrop-blur-[5px] text-white cursor-pointer transition-colors duration-[120ms] '
  + 'hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3 '
  + 'disabled:opacity-40 disabled:cursor-not-allowed';

export function ContactDialog({ onSaved, onCancel }) {
  const { profile, saveContact } = useAuth();
  // PRE-FILLED FROM WHATEVER IS ALREADY THERE, because "incomplete" can mean one
  // of the two is answered — somebody who gave a number months ago should be
  // asked for the occupation and not for both again.
  const [phone, setPhone] = useState(profile?.phone || '+91 ');
  const [job, setJob] = useState(() => occupationOf(profile?.occupation));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const tidy = normalisePhone(phone);
  const ready = !!tidy && !!job && !busy;

  const submit = async (e) => {
    e?.preventDefault();
    if (!ready) return;
    setBusy(true); setErr('');
    try {
      // NORMALISED ON THE WAY IN, NEVER ON THE WAY OUT. `+91 98765 43210` and
      // `0091 98765-43210` are the same number and the column holds one of them
      // — see normalisePhone. Cleaning at the single point of entry is a great
      // deal easier than cleaning ten thousand rows later.
      await saveContact({ phone: tidy, occupation: job });
      onSaved?.();
    } catch (ex) {
      // THE EXPORT IS STILL WAITING, so a failure has to be shown here rather
      // than swallowed. The dialog stays open with the typed values intact and
      // the button says "Save and export" again — a retry is one click.
      setErr(friendly(ex));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel?.(); } }}>
      <form className="w-[min(480px,94vw)] bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8]
        border border-border/10 rounded-[14px] px-[22px] pt-[22px] pb-5 shadow-pop"
        onSubmit={submit}>

        <h2 className="m-0 mb-1.5 text-[17px] tracking-[-0.01em]">Before you download</h2>
        <p className={`${NOTE} m-0 mb-[18px]`}>
          {/* SAYS WHY, IN ONE LINE. A form that appears in front of a download
              with no explanation reads as a paywall; this one is answered in
              about four seconds and never appears again, and both of those facts
              are worth stating rather than leaving somebody to discover. */}
          Two things, once. We use them to reach you about the drawing and to work
          out what to build next — you will not be asked again.
        </p>

        <label className={LABEL} htmlFor="contact-phone">WhatsApp number</label>
        <input id="contact-phone" type="tel" autoFocus value={phone}
          placeholder="+91 98765 43210" autoComplete="tel"
          onChange={(e) => { setPhone(e.target.value); setErr(''); }} />
        <p className={`${NOTE} mt-1.5 mb-0`}>
          {/* THE COUNTRY CODE IS THE ONE THING THAT CANNOT BE GUESSED, so it is
              the one thing the hint insists on. `+91` is pre-filled because this
              is where most of the drawings come from — it is a starting point
              and not an assumption, and it selects and overtypes like any other
              text. */}
          With the country code, so a message actually reaches you.
        </p>

        <div className="h-[18px]" />

        <label className={LABEL}>What do you do?</label>
        {/* BUTTONS AND NOT A `<select>`. Five short options, and a dropdown hides
            four of them behind a click on the one dialog in the app that has to
            be finished in seconds. It is also the same control the project-type
            chooser uses, so it is not a new idiom on a screen nobody has seen
            before. */}
        {/* A THREE-WIDE GRID AND NOT `flex-wrap`. Five options at their natural
            widths wrap four-and-one, which orphans "Other" on a line of its own
            and reads as an afterthought rather than as the fifth choice. Fixed
            columns give 3 + 2, equal widths, and one obviously deliberate gap. */}
        <div className="grid grid-cols-3 gap-2 max-[420px]:grid-cols-2">
          {OCCUPATIONS.map((o) => {
            const on = job === o.id;
            return (
              <button key={o.id} type="button" aria-pressed={on} disabled={busy}
                className={'px-3 py-[8px] rounded-[9px] cursor-pointer text-[12.5px] text-center '
                  + 'bg-surface backdrop-blur-[5px] border transition-[border-color,background-color] '
                  + 'duration-[120ms] disabled:cursor-not-allowed '
                  + (on ? 'border-transparent gradient-ring text-white'
                        : 'border-border/10 text-text hover:bg-white/10')}
                onClick={() => { setJob(o.id); setErr(''); }}>
                {o.label}
              </button>
            );
          })}
        </div>

        {err && (
          <p className="text-[11.5px] text-danger leading-[1.5] mt-3 border-l-2 border-danger pl-[9px]">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" className={BTN_QUIET} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={BTN_WHITE} disabled={!ready}>
            {busy ? 'Saving…' : 'Save and export'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * THE GATE, AS A HOOK.
 *
 * Returns an async `onBeforeExport` to hand straight to App, and the dialog node
 * to render beside it. App awaits the function at the top of every export and
 * does nothing if it resolves false — see the note on the prop in App.jsx.
 *
 * A PROMISE HELD OPEN ACROSS A RENDER, which is the only slightly unusual thing
 * in here. The gate cannot answer synchronously because the answer is a person
 * filling in a form, so the resolver is parked in state and called by whichever
 * of the two buttons is pressed. `useState(() => …)` rather than a ref because
 * the dialog's presence IS the state — storing it in a ref would open the
 * promise without rendering anything to close it.
 *
 * NULL PROFILE MEANS "DO NOT KNOW", AND IT LETS THE EXPORT THROUGH. The profile
 * row is fetched a tick after the session, so there is a window on every page
 * load where it is null; treating that as "incomplete" would put this dialog in
 * front of somebody who answered it months ago, every time they reloaded and
 * clicked Export quickly. An occasional ungated export is a far better failure
 * than asking a returning user the same two questions again.
 */
export function useContactGate() {
  const { user, profile } = useAuth();
  const [ask, setAsk] = useState(null);      // { resolve } while the dialog is up

  const onBeforeExport = useCallback(() => {
    // NOT SIGNED IN IS NOT THIS DIALOG'S PROBLEM. The standalone editor and the
    // tests have no session and no profiles row to write to; there is nothing to
    // ask and nothing to save.
    if (!user) return true;
    if (profileComplete(profile) !== false) return true;
    return new Promise((resolve) => setAsk({ resolve }));
  }, [user, profile]);

  // RESOLVED OUTSIDE THE UPDATER, DELIBERATELY. Doing it as
  // `setAsk((a) => { a?.resolve(x); return null; })` reads better and is wrong
  // under StrictMode, which invokes a state updater twice in development to
  // surface exactly this: side effects hidden inside one. Resolving a promise
  // twice happens to be harmless, which is what makes the habit worth not
  // forming.
  const close = useCallback((answer) => {
    ask?.resolve(answer);
    setAsk(null);
  }, [ask]);

  const contactDialog = ask
    ? <ContactDialog onSaved={() => close(true)} onCancel={() => close(false)} />
    : null;

  return { onBeforeExport, contactDialog };
}

/** The one failure worth naming; everything else is passed through verbatim. */
function friendly(e) {
  const msg = String(e?.message || e);
  if (/column .*(phone|occupation).* does not exist/i.test(msg)) {
    return 'This deployment is missing the phone and occupation columns on '
      + 'profiles — see supabase/migrations/0008_profile_contact.sql.';
  }
  if (/violates row-level security|permission denied/i.test(msg)) {
    return 'Your session has expired — sign in again and the download will work.';
  }
  return msg;
}
