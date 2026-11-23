// A newer web app after a release (SHEP-337). The page stays open for days (a tab, the installed app), so the
// service says which build it serves (service/webbuild.ts) and a page on another one updates itself: at once when
// nothing would be lost, else a "New version · Update" chip does it on a tap. The draft and the place come back on
// their own (kept on the device, the URL); a mark left before the reload says "Updated to …" once after it, and stops a
// reload that brought the same old page back from trying again and again.

/** the version this page was built as: its index.html says (vite.config.ts; none under test) */
export const OWN_VERSION = typeof document === 'undefined' ? '' : (document.querySelector<HTMLMetaElement>('meta[name="shepherdr-version"]')?.content ?? '')

/** on screen and untouched this long counts as idle */
export const IDLE_AFTER = 60_000
/** a reload that brought the same page back: no new try by itself for this long (the chip still works) */
export const RETRY_AFTER = 10 * 60_000

export const MARK_KEY = 'shepherdr.updating'
export type Mark = { from: string; to: string; at: number }

/** what could be lost by reloading now */
export type Now = {
  /** something can't be picked up again (an upload on its way, dictation) */
  holds: number
  call: boolean
  /** a dialog, sheet or the settings window is open */
  modal: boolean
  /** words in a composer */
  composer: boolean
  hidden: boolean
  /** since the person last touched, typed or scrolled */
  idleMs: number
}

/** Reload by itself now? Only with nothing on the way or open, and the page hidden or left alone. */
export function safeNow(n: Now): boolean {
  if (n.holds > 0 || n.call || n.modal || n.composer) return false
  return n.hidden || n.idleMs >= IDLE_AFTER
}

/** A reload by itself is allowed unless the last one, a short while ago, brought the same build back. */
export function mayRetry(mark: Mark | null, build: string, now: number): boolean {
  return !mark || mark.from !== build || now - mark.at >= RETRY_AFTER
}

/** Right after a page load: did the update take? Then say so once; else keep the mark so it isn't tried again soon. */
export function afterLoad(mark: Mark | null, build: string, version: string, now: number): { said: string | null; keep: Mark | null } {
  if (!mark) return { said: null, keep: null }
  if (mark.from !== build) return { said: version ? `Updated to ${version}` : 'Updated to the newest version', keep: null }
  return { said: null, keep: now - mark.at < RETRY_AFTER ? mark : null }
}

export function readMark(): Mark | null {
  try {
    const m = JSON.parse(localStorage.getItem(MARK_KEY) ?? 'null') as Mark | null
    return m && typeof m.from === 'string' && typeof m.at === 'number' ? m : null
  } catch {
    return null
  }
}

export function writeMark(m: Mark | null) {
  try {
    if (m) localStorage.setItem(MARK_KEY, JSON.stringify(m))
    else localStorage.removeItem(MARK_KEY)
  } catch {
    /* private mode: no line after, and no guard against trying again */
  }
}
