/** Copying words from a tap, the same on every device (SHEP-152). Every copy button and action goes through here.

    1. The clipboard API, started inside the tap itself: Safari (and others) forget the tap after an await or a timer.
    2. The old way: a hidden box with the words selected (iOS needs a real range and setSelectionRange) and
       execCommand('copy'), placed beside the button so a dialog that keeps focus in itself still lets it select.
    3. Neither worked (a plain http link, a frame without clipboard rights, a browser that says no): the words show
       selected in a small box with "Press and hold to copy" (touch) or "Press ⌘C", so the person can still copy them.

    It resolves true only when the words really reached the clipboard: a button says "Copied" only then. */

import { useEffect, useRef, useState } from 'react'

export type CopyEnv = {
  /** navigator.clipboard where the page may use it (a secure context), else undefined */
  clipboard?: { writeText(text: string): Promise<void> }
  /** the old way; true when the browser says it copied */
  exec(text: string, at: Element | null): boolean
  /** shows the words selected for the person to copy themselves */
  manual(text: string, at: Element | null): void
}

export function copyText(text: string, at: Element | null = null, env: CopyEnv = browser()): Promise<boolean> {
  const old = () => {
    if (env.exec(text, at)) return true
    env.manual(text, at)
    return false
  }
  let started: Promise<void> | null = null
  try {
    started = env.clipboard ? env.clipboard.writeText(text) : null
  } catch {
    started = null
  }
  if (!started) return Promise.resolve(old())
  return started.then(
    () => true,
    () => old(),
  )
}

/** a button's "Copied" for a moment, set only once the copy really worked. copy(text, key, e): key says which */
export function useCopy(ms = 1500) {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (text: string, key = 'copy', e?: { currentTarget: EventTarget | null }) => {
    const at = e?.currentTarget instanceof Element ? e.currentTarget : null
    return copyText(text, at).then((ok) => {
      if (!ok) return false
      setCopied(key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), ms)
      return true
    })
  }
  return { copied, copy }
}

function browser(): CopyEnv {
  const secure = typeof isSecureContext === 'undefined' || isSecureContext
  return { clipboard: secure ? navigator.clipboard : undefined, exec: execCopy, manual: showManual }
}

/** where the hidden box goes: beside the button, so a dialog that keeps focus inside itself lets it select */
const beside = (at: Element | null): HTMLElement => (at?.isConnected ? at.parentElement : null) ?? document.body

function execCopy(text: string, at: Element | null): boolean {
  if (typeof document === 'undefined' || !document.queryCommandSupported?.('copy')) return false
  const was = document.activeElement as HTMLElement | null
  const sel = getSelection()
  const ranges = sel ? Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i)) : []
  const area = document.createElement('textarea')
  area.value = text
  // readonly keeps a phone's keyboard down; 16px keeps iOS from zooming in
  area.readOnly = true
  area.contentEditable = 'true'
  area.setAttribute('aria-hidden', 'true')
  area.tabIndex = -1
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none'
  beside(at).append(area)
  let ok = false
  try {
    area.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(area)
    sel?.removeAllRanges()
    sel?.addRange(range)
    area.select()
    area.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    area.remove()
    sel?.removeAllRanges()
    for (const r of ranges) sel?.addRange(r)
    was?.focus?.({ preventScroll: true })
  }
  return ok
}

const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const mac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** the words the manual box says: what to press, on this device */
export function manualHint(coarse = touch(), apple = mac()) {
  return coarse ? 'Press and hold to copy' : apple ? 'Press ⌘C to copy' : 'Press Ctrl+C to copy'
}

let open: (() => void) | null = null

function showManual(text: string) {
  if (typeof document === 'undefined') return
  open?.()
  const was = document.activeElement as HTMLElement | null
  const box = document.createElement('div')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Copy')
  box.setAttribute('data-copy-manual', '')
  box.className =
    'fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-[480px] flex-col gap-2 rounded-xl bg-bg p-3 text-fg shadow-[0_8px_30px_rgb(0_0_0/0.18),inset_0_0_0_1px_var(--line2)]'
  const head = document.createElement('div')
  head.className = 'flex items-center gap-2 text-[0.8125rem] text-fg2'
  const hint = document.createElement('span')
  hint.className = 'flex-1'
  hint.textContent = manualHint()
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Done'
  close.className = 'rounded-full px-2.5 py-1 text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover'
  head.append(hint, close)
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = true
  area.rows = Math.min(6, Math.max(1, text.split('\n').length))
  area.className = 'w-full resize-none rounded-md bg-well p-2 font-mono text-[16px] text-fg outline-none sm:text-[0.8125rem]'
  box.append(head, area)
  const shut = () => {
    if (open !== shut) return
    open = null
    box.remove()
    removeEventListener('keydown', esc, true)
    was?.focus?.({ preventScroll: true })
  }
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      shut()
    }
  }
  close.addEventListener('click', shut)
  // the person copied it themselves: that is the copy, say so and go
  area.addEventListener('copy', () => {
    hint.textContent = 'Copied'
    setTimeout(shut, 700)
  })
  addEventListener('keydown', esc, true)
  // on the body, over everything: a menu that closes on the tap must not take it along
  document.body.append(box)
  open = shut
  area.focus({ preventScroll: true })
  area.select()
  area.setSelectionRange(0, text.length)
}
