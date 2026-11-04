// A list being scrolled shows its scrollbar (styles.css), and hides it again a moment after it stops.

/** how long a scrollbar stays after the list stops, in ms */
const LINGER = 900

/** Mark whatever scrolls with data-scrolling while it moves, and a moment after. */
export function watchScrolling() {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
  const moved = (e: Event) => {
    const el = e.target instanceof Element ? e.target : document.scrollingElement
    if (!el) return
    if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '')
    clearTimeout(timers.get(el))
    timers.set(el, setTimeout(() => el.removeAttribute('data-scrolling'), LINGER))
  }
  addEventListener('scroll', moved, { capture: true, passive: true })
}
