// The on-screen keyboard. iOS doesn't shrink the page for it: it slides the whole page up, under the status bar.
// So the app takes the height of what's visible (window.visualViewport), keeps the page from scrolling, and tells
// the layout when the keyboard is up, so the phone can hide its bottom bar and put the message box on the keyboard.

/** a keyboard is taller than this; browser bars that come and go are shorter */
const KEYBOARD = 150

/** Feed it the visible size as it changes; it says whether the keyboard is up. Remembers the tallest height
 *  seen at each width (one per way the phone is turned). Turned with the keyboard up to a width not seen yet,
 *  it keeps the keyboard up until it closes and shows the full height there. */
export function keyboardWatch() {
  const full = new Map<number, number>()
  let width = 0
  let up = false
  return (w: number, h: number): boolean => {
    if (w !== width && up && !full.has(w)) full.set(w, h + KEYBOARD + 1)
    width = w
    const f = Math.max(full.get(w) ?? 0, h)
    full.set(w, f)
    return (up = f - h > KEYBOARD)
  }
}

/**
 * The parts marked data-kb glide from where they were to where the new size puts them, rather than jump: as the
 * keyboard comes up iOS has slid the page up under the status bar, so the header comes back down into view; as it goes
 * down, the chat and the message box follow it down. Lists pinned to their end stay pinned (they hear app-resized).
 */
function glide(vv: VisualViewport, apply: () => void) {
  const parts = [...document.querySelectorAll<HTMLElement>('[data-kb]')]
  const before = parts.map((p) => p.getBoundingClientRect().top - vv.offsetTop)
  apply()
  dispatchEvent(new Event('app-resized'))
  parts.forEach((p, i) => {
    const d = before[i] - (p.getBoundingClientRect().top - vv.offsetTop)
    if (p.isConnected && Math.abs(d) > 2) p.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
  })
}

/** Size the app to the visible area (--app-h on <html>) and report the keyboard as it opens and closes. */
export function watchViewport(onKeyboard: (up: boolean) => void) {
  const vv = window.visualViewport
  if (!vv) return
  const up = keyboardWatch()
  let was = false
  let width = vv.width
  const update = () => {
    // pinch-zoomed: the visible area is a magnified part of the page, not a smaller page
    if (Math.abs(vv.scale - 1) > 0.01) return
    // and only while typing, so a guessed full height after turning the phone can't keep the bar hidden
    const now = up(vv.width, vv.height) && !!document.activeElement?.matches('input, textarea, [contenteditable]')
    const apply = () => {
      document.documentElement.style.setProperty('--app-h', `${vv.height}px`)
      if (scrollY || vv.offsetTop) scrollTo(0, 0)
    }
    // the keyboard coming or going (not the phone turning): what moves glides
    const turned = vv.width !== width
    width = vv.width
    if (now !== was && !turned && !matchMedia('(prefers-reduced-motion: reduce)').matches) glide(vv, apply)
    else apply()
    if (now !== was) onKeyboard((was = now))
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  addEventListener('focusin', update)
  addEventListener('focusout', () => setTimeout(update))
  update()
}
