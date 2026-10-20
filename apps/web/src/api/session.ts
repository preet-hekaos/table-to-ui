/** Where the session token lives for the tab. sessionStorage keeps it out of long-lived storage. */
const KEY = 'tableui.token'
const OPS_KEY = 'tableui.ops.token'

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch {
    /* storage unavailable: the user will simply sign in again */
  }
}

export const tokens = {
  get: () => read(KEY),
  set: (t: string | null) => write(KEY, t),
  getOps: () => read(OPS_KEY),
  setOps: (t: string | null) => write(OPS_KEY, t),
}

/** Studio preview: an embedded copy of the app runs as another role, against Test or Live, read-only.
 *  Read once from the page address so each preview frame keeps its own setting. */
function readPreview(): { role: string | null; env: string | null } {
  try {
    const q = new URLSearchParams(window.location.search)
    return { role: q.get('preview_role'), env: q.get('preview_env') }
  } catch {
    return { role: null, env: null }
  }
}
export const preview = readPreview()
