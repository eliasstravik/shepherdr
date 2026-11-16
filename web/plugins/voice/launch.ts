// SHEP-238: Shepherdr opened straight into a voice call. A wake word on a phone opens the app at `?voice=1`; the
// manifest's launch_handler hands a launch to the window already open (launchQueue), else the page loads with it. Either
// way: one call starts, as the call button would; a call already on is only shown; the address loses `voice` so a
// reload or Back starts none. Where the browser wants a tap first (no sound or microphone without one), a big Start
// voice call button asks for it rather than failing silently.

export type LaunchDeps = {
  /** a call is on */
  inCall: () => boolean
  /** start the call (the call button's own start) */
  start: () => void
  /** bring the call that is on to the front */
  show: () => void
  /** the browser lets sound and the microphone start without a tap now */
  mayStart: () => boolean
  /** ask for the tap: the big Start voice call button */
  ask: () => void
  /** put this address in place of the one shown (history.replaceState) */
  replace: (url: string) => void
  /** the address shown now */
  here: () => string
  now: () => number
}

/** the launch wants a call: `voice=1` (or a bare `voice`) */
export function wantsCall(href: string) {
  const v = new URL(href, 'http://x/').searchParams.get('voice')
  return v === '' || v === '1' || v === 'true'
}

/** the address without `voice`, as a path the history takes; null when it has none */
export function withoutVoice(href: string) {
  const u = new URL(href, 'http://x/')
  if (!u.searchParams.has('voice')) return null
  u.searchParams.delete('voice')
  const q = u.searchParams.toString()
  return `${u.pathname}${q ? `?${q}` : ''}${u.hash}`
}

/** the same launch reaches the page twice (its address on load and the launch queue): the second is let go */
const TWICE_MS = 3000

/** handles launches into one page: call it with each launch's address; true when it wanted a call */
export function launcher(d: LaunchDeps) {
  let last = -Infinity
  return (href: string) => {
    // the address shown loses `voice` whatever happens next
    const clean = withoutVoice(d.here())
    if (clean !== null) d.replace(clean)
    if (!wantsCall(href)) return false
    const t = d.now()
    if (t - last < TWICE_MS) return true
    last = t
    if (d.inCall()) d.show()
    else if (d.mayStart()) d.start()
    else d.ask()
    return true
  }
}
