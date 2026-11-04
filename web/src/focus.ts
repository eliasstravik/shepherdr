// A dialog keeps the keyboard: focus moves into it as it opens (unless something in it already took it), Tab and
// Shift+Tab go round inside it, and focus goes back to what had it once it closes. Esc stays with whoever handles it
// now (the app's keys, a menu, a box).
import { useLayoutEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** `focus: false`: it doesn't take the focus as it opens (a phone's sheet with a search box would bring the keyboard up) */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, { focus = true }: { focus?: boolean } = {}) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const all = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0)
    const frame = requestAnimationFrame(() => {
      if (!focus || el.contains(document.activeElement)) return
      ;(all()[0] ?? el).focus({ preventScroll: true })
    })
    const tab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = all()
      if (!list.length) return
      const at = document.activeElement
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey ? at === first || !el.contains(at) : at === last || !el.contains(at)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus({ preventScroll: true })
      }
    }
    addEventListener('keydown', tab)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('keydown', tab)
      // back to what opened it, unless the focus has gone on somewhere else meanwhile
      const now = document.activeElement
      if (opener?.isConnected && (!now || now === document.body || el.contains(now))) opener.focus({ preventScroll: true })
    }
  }, [])
}

// what takes typing: an arrow moves its caret and a key is a letter, not a checkbox's or a radio's
const TYPED = 'input:not([type=checkbox], [type=radio]), textarea, [contenteditable=true], [data-term-screen]'

/** The keyboard moved the focus, or the tasks' cursor (a place of its own, not the focus): that one's ring shows */
export const keysMoved = (what: 'focus' | 'cursor' = 'focus') => {
  document.documentElement.dataset.keys = what
}

/** Mark <html data-keys> while the keyboard moves the focus, for rings that keys should see and a mouse or finger
 *  shouldn't: from a Tab, or an arrow that took the focus somewhere, until a pointer is pressed or something is typed.
 *  A browser's own :focus-visible won't do: any key (Shift, ⌘ on the way to another app) turns it on for a clicked
 *  button, and it follows a script's focus after typing */
export function watchKeys() {
  const root = document.documentElement
  let arrow = false
  addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      arrow = /^(Arrow\w+|Home|End)$/.test(e.key)
      if (e.key === 'Tab') keysMoved()
      else if (!arrow && e.key !== 'Escape' && (e.target as Element).closest?.(TYPED)) delete root.dataset.keys
    },
    true,
  )
  addEventListener('keyup', () => (arrow = false), true)
  addEventListener('focusin', () => arrow && keysMoved(), true)
  addEventListener(
    'pointerdown',
    () => {
      arrow = false
      delete root.dataset.keys
    },
    true,
  )
}
