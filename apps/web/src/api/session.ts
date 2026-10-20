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
