import React, { useCallback, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { OCCUPATIONS, normalisePhone, occupationOf, profileComplete, toE164 } from '../lib/profile.js';
import { DIAL_CODES, DEFAULT_ISO, splitDial, countryForDial, countryForIso, flagOf }
  from '../lib/dialCodes.js';

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
  // asked for the occupation and not for both again. A stored number is E.164,
  // so it splits cleanly back into the two controls.
  const [iso, setIso] = useState(() => {
    const parts = splitDial(normalisePhone(profile?.phone) ?? '');
    return countryForDial(parts?.dial)?.iso ?? DEFAULT_ISO;
  });
  const [local, setLocal] = useState(() => {
    const parts = splitDial(normalisePhone(profile?.phone) ?? '');
    return parts?.national ?? '';
  });
  const [job, setJob] = useState(() => occupationOf(profile?.occupation));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const country = countryForIso(iso) ?? countryForIso(DEFAULT_ISO);
  const tidy = toE164(country.dial, local);
  const ready = !!tidy && !!job && !busy;

  /**
   * WHAT HAPPENS WHEN SOMEBODY PASTES A WHOLE INTERNATIONAL NUMBER into the
   * national box — which is the commonest way a wrong country code would get
   * stored, because a pasted `+44 20 7946 0958` behind a select that still says
   * India produces `+914420…`.
   *
   * THE `+` OR `00` IS THE ONLY SIGNAL, and it has to be, because a bare
   * national number is genuinely ambiguous: `9876543210` splits perfectly well
   * as Iran's +98 followed by eight digits. Guessing a country from digits that
   * do not claim to carry one is exactly the class of silent error this whole
   * control exists to stop, so the split runs only when the text says it is
   * international.
   */
  const onLocal = (raw) => {
    setErr('');
    const intl = raw.trim().startsWith('+') || /^\s*00\d/.test(raw);
    if (intl) {
      const parts = splitDial(raw.replace(/\D/g, '').replace(/^00/, ''));
      const found = parts && countryForDial(parts.dial);
      if (found) { setIso(found.iso); setLocal(parts.national); return; }
    }
    setLocal(raw);
  };

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
      <form className="w-[min(480px,94vw)] bg-black/80 backdrop-blur-lg backdrop-saturate-[1.8]
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
        {/* TWO CONTROLS AND NOT ONE TEXT BOX, and the reason is a trap the one
            box set. It was pre-filled with `+91 `, which reads as part of YOUR
            NUMBER rather than as a choice — so somebody in London types after it
            and stores `+912079460958`: wrong country, plausible length, and
            nothing anywhere can tell. A select is visibly a control, so it is
            visibly changeable, and it costs the majority who are in India
            exactly nothing. See src/lib/dialCodes.js. */}
        <div className="flex gap-2 items-start">
          <select value={iso} aria-label="Country"
            /* WIDE ENOUGH FOR "United Kingdom +44" AND NOT FOR EVERY NAME, which
               is the honest compromise: a native select shows its chosen option
               truncated to the control's width, and sizing for "Bosnia &
               Herzegovina" would give a third of the dialog to a control that is
               correct by default. The preview line underneath always names the
               country in full, so nothing is ever only half-said. */
            className="flex-none w-[11rem] max-[420px]:w-[8.5rem] text-[12.5px]"
            onChange={(e) => { setIso(e.target.value); setErr(''); }}>
            {DIAL_CODES.map((c) => (
              /* THE FLAG, THE NAME AND THE CODE, in that order, and all three
                 are needed. The flag is the fast scan, the name is what somebody
                 searches for by typing into a native select, and the code is the
                 thing being chosen — a list of flags alone is unreadable on a
                 platform that renders them as letter pairs. The closed control
                 is narrow, so it shows the flag and the code; the open list has
                 room for the name. */
              <option key={c.iso} value={c.iso}>
                {flagOf(c.iso)} {c.name} +{c.dial}
              </option>
            ))}
          </select>
          <input id="contact-phone" type="tel" autoFocus value={local}
            className="flex-1 min-w-0"
            placeholder="98765 43210" autoComplete="tel-national"
            onChange={(e) => onLocal(e.target.value)} />
        </div>
        <p className={`${NOTE} mt-1.5 mb-0`}>
          {/* THE PREVIEW IS THE POINT OF THE WHOLE ARRANGEMENT. It shows the
              exact string that will be stored, so a wrong country is visible
              BEFORE it is saved rather than when a message bounces — and it is
              where the trunk-zero rule announces itself, since somebody who
              types `020 7946 0958` sees `+442079460958` come back and can tell
              at a glance that the zero was understood rather than swallowed. */}
          {tidy
            ? <>Saved as <b className="text-text">{tidy}</b> · {country.name}</>
            : <>Your number without the country code — pick the country on the left.
                Pasting a full <code className="font-sans">+…</code> number works too.</>}
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
