// ---------------------------------------------------------------------------
// THE FILE THAT HAS TO SURVIVE THE LOGIN STEP.
//
// The home page's whole promise is "drop a plan, see it lit". Signing in
// happens in the MIDDLE of that sentence, and the drawing is a File object in
// memory — it cannot go in a URL and it should not go in localStorage (a 30MB
// survey as a base64 string is both over the quota and a copy of somebody's
// drawing left on a shared machine).
//
// So it stays a module variable, which survives client-side navigation to
// /login and back because that is not a page load. A HARD reload does lose it,
// and the login page says so rather than pretending: "your drawing was not
// carried over, drop it again". One honest sentence beats a silent empty canvas.
// ---------------------------------------------------------------------------

let pending = null;   // { file, at }

export function stashUpload(file) {
  pending = file ? { file, at: Date.now() } : null;
}

/** Look without consuming — the login page uses this to name the file. */
export function peekUpload() {
  return pending?.file ?? null;
}

/** Take it, and clear it. A file must only ever be turned into one plan. */
export function takeUpload() {
  const f = pending?.file ?? null;
  pending = null;
  return f;
}

export function clearUpload() { pending = null; }
