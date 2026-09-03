import React, { useCallback, useEffect, useState } from 'react';
import { listShares, addShare, setShareRole, removeShare, looksLikeEmail,
         getShareLink, createShareLink, revokeShareLink, shareUrl } from '../lib/sharing.js';

// ---------------------------------------------------------------------------
// SHARE THIS PROJECT.
//
// THE UNIT IS THE PROJECT, NOT THE PLAN, and the dialog opens from the editor
// anyway. That looks like a mismatch and is not one: a project is a building and
// a plan is one sheet of it, so "let my client see this" almost never means one
// floor — and a share list held per plan would have to be re-made every time
// somebody drops the next drawing in. The dialog says which project it is
// sharing, in the first line, so nobody has to infer it.
//
// TWO SECTIONS, IN THE ORDER PEOPLE REACH FOR THEM.
//
//   PEOPLE first, because a named grant is the one that survives: it is
//   revocable per person, it says who, and it can be an edit grant. The address
//   is typed before the role is chosen because that is the order the sentence
//   goes in — "share with X, who can Y".
//
//   A LINK second, and folded away until it is asked for. It is the blunt
//   instrument — view only, and whoever it reaches — and offering it with the
//   same weight as a named invite is how a link ends up in a WhatsApp group
//   because it was the nearer button.
//
// THE LINK IS NOT MINTED UNTIL SOMEBODY ASKS. A dialog that creates a live URL
// as a side effect of being opened is a dialog that has shared the project
// before the user decided to.
//
// EVERY WRITE IS OPTIMISTIC-FREE, deliberately. These are permissions: showing a
// person as an editor a beat before the database agrees, and then silently
// rolling it back, is the one place in this app where a hopeful UI would be a
// lie about who can read a drawing. Each action waits, and says "…" while it
// does.
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

const ROLES = [
  ['view', 'Can view', 'Full view access, and can export.'],
  ['edit', 'Can edit', 'Full edit access.'],
];

/**
 * A ROLE, AS A TWO-SIDED SWITCH rather than a `<select>`. There are two options
 * and each needs a sentence to be understood; a dropdown hides the second one
 * behind a click and gives neither any room to explain itself.
 */
function RolePicker({ value, onChange, disabled = false, compact = false }) {
  return (
    <div className={compact
      ? 'inline-flex gap-0.5 p-0.5 rounded border border-border/10 bg-surface backdrop-blur-md'
      : 'grid grid-cols-2 gap-2'}>
      {ROLES.map(([id, label, blurb]) => {
        const on = value === id;
        if (compact) {
          return (
            <button key={id} type="button" disabled={disabled} title={blurb}
              aria-pressed={on}
              className={'appearance-none border-0 cursor-pointer text-[11px] leading-[1.5] '
                + 'px-2 py-[3px] rounded transition-colors duration-[120ms] '
                + 'disabled:cursor-not-allowed '
                + (on ? 'bg-white text-black' : 'bg-transparent text-subtle hover:text-white')}
              onClick={() => !on && onChange(id)}>
              {id === 'edit' ? 'Edit' : 'View'}
            </button>
          );
        }
        return (
          <button key={id} type="button" disabled={disabled} aria-pressed={on}
            className={'flex flex-col items-start gap-0.5 px-3 py-[9px] rounded-[9px] '
              + 'cursor-pointer text-left bg-surface backdrop-blur-[5px] border '
              + 'transition-[border-color,background-color] duration-[120ms] '
              + (on ? 'border-transparent gradient-ring' : 'border-border/10 hover:bg-white/10')}
            onClick={() => onChange(id)}>
            <b className={on ? 'text-[12.5px] text-white' : 'text-[12.5px] text-text'}>{label}</b>
            <span className="text-[10.5px] text-subtle leading-[1.3]">{blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function ShareDialog({ projectId, projectName = '', onClose }) {
  const [shares, setShares] = useState(null);
  const [link, setLink] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('view');
  const [busy, setBusy] = useState('');          // '' | 'invite' | 'link' | a share id
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([listShares(projectId), getShareLink(projectId)]);
      setShares(s); setLink(l);
      // OPEN THE LINK SECTION IF THERE ALREADY IS ONE. Folding away a live URL
      // is how somebody forgets a project is publicly readable.
      if (l) setLinkOpen(true);
    } catch (e) { setErr(String(e.message || e)); setShares([]); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // ESCAPE CLOSES IT, and this is the only keyboard the dialog owns. The editor
  // underneath has a dozen shortcuts and every one of them would be wrong to
  // fire at a form — but the listener is on the document because the focus could
  // legitimately be on any of six controls in here.
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);

  const invite = async (e) => {
    e?.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!looksLikeEmail(addr) || busy) return;
    setBusy('invite'); setErr('');
    try {
      const row = await addShare(projectId, addr, role);
      setShares((list) => {
        const rest = (list || []).filter((s) => s.id !== row.id);
        return [...rest, row];
      });
      setEmail('');
    } catch (ex) {
      setErr(friendly(ex));
    } finally { setBusy(''); }
  };

  const changeRole = async (share, next) => {
    if (busy) return;
    setBusy(share.id); setErr('');
    try {
      const row = await setShareRole(share.id, next);
      setShares((list) => list.map((s) => (s.id === row.id ? row : s)));
    } catch (ex) { setErr(friendly(ex)); } finally { setBusy(''); }
  };

  const revoke = async (share) => {
    if (busy) return;
    setBusy(share.id); setErr('');
    try {
      await removeShare(share.id);
      setShares((list) => list.filter((s) => s.id !== share.id));
    } catch (ex) { setErr(friendly(ex)); } finally { setBusy(''); }
  };

  const makeLink = async () => {
    if (busy) return;
    setBusy('link'); setErr('');
    try { setLink(await createShareLink(projectId)); }
    catch (ex) { setErr(friendly(ex)); } finally { setBusy(''); }
  };

  const killLink = async () => {
    if (busy) return;
    if (!confirm('Turn off the view link? Anybody holding it loses access immediately.')) return;
    setBusy('link'); setErr('');
    try { await revokeShareLink(projectId); setLink(null); setCopied(false); }
    catch (ex) { setErr(friendly(ex)); } finally { setBusy(''); }
  };

  const copy = async () => {
    if (!link) return;
    const url = shareUrl(link.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // CLIPBOARD ACCESS IS NOT GUARANTEED — an insecure origin, a browser that
      // asks, a permission somebody denied. Selecting the field is the fallback
      // that always works and needs no permission at all.
      setErr('The clipboard was not available — the link is selected, so copy it by hand.');
      document.getElementById('share-link-field')?.select();
    }
  };

  const canInvite = looksLikeEmail(email) && !busy;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-[min(560px,94vw)] max-h-[88vh] overflow-y-auto bg-black/80 backdrop-blur-lg
        backdrop-saturate-[1.8] border border-border/10 rounded-[14px] px-[22px] pt-[22px] pb-5 shadow-pop"
        role="dialog" aria-modal="true" aria-label="Share this project">

        <h2 className="m-0 mb-1.5 text-[17px] tracking-[-0.01em]">Share this project</h2>
        <p className={`${NOTE} m-0 mb-[18px]`}>
          {projectName
            ? <>Everything in <b className="text-text font-normal">{projectName}</b> — every drawing in it, and every layout — is shared together.</>
            : <>Every drawing in this project, and every layout, is shared together.</>}
        </p>

        {/* --- BY EMAIL ---------------------------------------------------- */}
        <form onSubmit={invite}>
          <label className={LABEL} htmlFor="share-email">Invite by email</label>
          <div className="flex gap-2 items-start">
            <input id="share-email" type="email" autoFocus value={email}
              placeholder="client@studio.com" autoComplete="off"
              className="flex-1 min-w-0"
              onChange={(e) => { setEmail(e.target.value); setErr(''); }} />
            <button type="submit" className={BTN_WHITE + ' flex-none'} disabled={!canInvite}>
              {busy === 'invite' ? 'Sharing…' : 'Share'}
            </button>
          </div>
          <div className="h-2.5" />
          <RolePicker value={role} onChange={setRole} disabled={busy === 'invite'} />
          <p className={`${NOTE} mt-2 mb-0`}>
            {/* THE TWO THINGS THAT SURPRISE PEOPLE, BOTH SAID PLAINLY.
                No email goes out — the share is live immediately and the project
                is waiting under "Shared with me", but the owner still has to
                tell them it is there. And the grant is keyed on the ADDRESS
                (see migration 0006), so signing up with a different one is the
                one way this quietly does not work. */}
            Send them the link below. The
            project also appears under “Shared with me” on their dashboard, as
            long as they sign in with <em className="not-italic text-subtle">this
            address</em>.
          </p>
        </form>

        {/* --- WHO HAS IT --------------------------------------------------- */}
        <div className="border-t border-border/10 pt-3.5 mt-4">
          <h3 className={`${LABEL} block mb-2.5`}>
            Shared with {shares?.length ? `${shares.length} ${shares.length === 1 ? 'person' : 'people'}` : ''}
          </h3>
          {shares == null ? (
            <p className={NOTE}>Loading…</p>
          ) : shares.length === 0 ? (
            <p className={NOTE}>Nobody yet. This project is yours alone.</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {shares.map((s) => (
                <li key={s.id}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded border border-border/10
                    bg-white/5 backdrop-blur-md">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-white overflow-hidden text-ellipsis whitespace-nowrap">
                      {s.email}
                    </div>
                    {/* INVITED vs JOINED. `invited_user` is filled by a trigger
                        the moment that address has an account (see 0006), so
                        this is how the owner tells "they cannot find it" from
                        "they have not signed up yet". */}
                    <div className="text-[10.5px] text-subtle">
                      {s.invited_user ? 'Has an account' : 'Not signed up yet'}
                    </div>
                  </div>
                  <RolePicker compact value={s.role} disabled={busy === s.id}
                    onChange={(next) => changeRole(s, next)} />
                  <button type="button" disabled={busy === s.id}
                    className="border-0 bg-transparent p-0 text-[11.5px] text-danger cursor-pointer
                      hover:underline disabled:opacity-40 disabled:cursor-not-allowed flex-none"
                    onClick={() => revoke(s)}>
                    {busy === s.id ? '…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- BY LINK ------------------------------------------------------ */}
        <div className="border-t border-border/10 pt-3.5 mt-4">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <h3 className={`${LABEL} block`}>Anyone with the link</h3>
            {!linkOpen && (
              <button type="button" className={BTN_QUIET} onClick={() => setLinkOpen(true)}>
                Set one up
              </button>
            )}
          </div>

          {linkOpen && (
            <>
              
              {/* THE THING PEOPLE ASSUME WRONGLY, SAID BEFORE THEY ASSUME IT.
                  The link does not cap anybody: somebody on the list above who
                  follows it lands in the project with the access you gave them,
                  editor included. So one link works for everyone, and the list
                  above is what decides who can do what with it. */}
              

              {link ? (
                <>
                  <div className="flex gap-2 items-center">
                    <input id="share-link-field" type="text" readOnly value={shareUrl(link.token)}
                      className="flex-1 min-w-0 font-sans text-[11.5px]"
                      onFocus={(e) => e.target.select()} />
                    <button type="button" className={BTN_WHITE + ' flex-none'} onClick={copy}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="flex justify-end mt-2">
                    <button type="button" disabled={busy === 'link'}
                      className="border-0 bg-transparent p-0 text-[11.5px] text-danger cursor-pointer
                        hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={killLink}>
                      {busy === 'link' ? '…' : 'Turn off this link'}
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className={BTN_QUIET} disabled={busy === 'link'}
                  onClick={makeLink}>
                  {busy === 'link' ? 'Creating…' : 'Create a view link'}
                </button>
              )}
            </>
          )}
        </div>

        {err && (
          <p className="text-[11.5px] text-danger leading-[1.5] mt-3 border-l-2 border-danger pl-[9px]">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className={BTN_QUIET} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The two failures worth naming. Everything else is passed through, because a
 * flattened "something went wrong" on a permissions dialog is the worst place in
 * the app to lose the actual reason.
 */
function friendly(e) {
  const msg = String(e?.message || e);
  if (/that is your own address/i.test(msg)) return 'That is your own address — this project is already yours.';
  if (/violates row-level security|permission denied/i.test(msg)) {
    return 'Only the project’s owner can change who it is shared with.';
  }
  return msg;
}
