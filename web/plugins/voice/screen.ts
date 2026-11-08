// The call's screen on this page (SHEP-51, core/screen.js): what the page shows, read as a screen reader would, as
// numbered things the voice agent can act on (click, type, select, scroll, a key, back, close), done here on this very
// page, on whatever device started the call. The voice agent's fallback for what its Shepherdr tools can't do.
// A ref stays with its element for the whole call (resetScreen at its start), so "e12" means the same button after a
// scroll; an element gone from the page is said to be gone, never guessed.
import * as S from '@core/screen.js'

type Node = { ref: string; role: string; name: string; depth: number; selected?: boolean; checked?: boolean; pressed?: boolean; expanded?: boolean; collapsed?: boolean; disabled?: boolean; focused?: boolean; current?: boolean; level?: number; value?: string; options?: string[]; scroll?: string }
export type Head = { app: string; shows: string }
/** what an action did: ok and its words, or why not; ask: a risky click held back until the person says yes */
export type ScreenAck = { ok: boolean; did?: string; why?: string; ask?: string; screen?: string }

let seq = 0
let refs = new WeakMap<Element, string>()
let els = new Map<string, WeakRef<Element>>()

/** a new call: refs start again at e1 */
export function resetScreen() {
  seq = 0
  refs = new WeakMap()
  els = new Map()
}

function refFor(el: Element) {
  let r = refs.get(el)
  if (!r) {
    r = `e${++seq}`
    refs.set(el, r)
    els.set(r, new WeakRef(el))
  }
  return r
}

const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'combobox', 'slider', 'treeitem', 'spinbutton'])
const LISTED = new Set([...INTERACTIVE, 'heading'])

function roleOf(el: Element): string {
  const r = el.getAttribute('role')?.trim().split(/\s+/)[0]
  if (r && r !== 'presentation' && r !== 'none' && r !== 'generic') return r
  const tag = el.tagName.toLowerCase()
  if (tag === 'button' || tag === 'summary') return 'button'
  if (tag === 'a' && el.hasAttribute('href')) return 'link'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'select') return 'combobox'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'dialog') return 'dialog'
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type
    if (t === 'hidden') return ''
    if (t === 'checkbox') return 'checkbox'
    if (t === 'radio') return 'radio'
    if (t === 'range') return 'slider'
    if (t === 'search') return 'searchbox'
    if (t === 'button' || t === 'submit' || t === 'reset') return 'button'
    return 'textbox'
  }
  if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox'
  return ''
}

const text = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label')
  if (label?.trim()) return text(label)
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    if (text(t)) return text(t)
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const l = el.labels?.[0]?.textContent
    if (text(l)) return text(l)
    if ('placeholder' in el && el.placeholder) return text(el.placeholder)
  }
  const own = text((el as HTMLElement).innerText ?? el.textContent)
  if (own) return own.slice(0, 120)
  const img = el.querySelector('img[alt]')?.getAttribute('alt')
  return text(el.getAttribute('title') ?? img ?? '')
}

function shown(el: Element) {
  const h = el as HTMLElement
  // SHEP-118: the full-screen call is the call's own, never the page the voice reads and acts on
  if (h.closest('[aria-hidden="true"], [inert], [data-call-screen]')) return false
  if (typeof h.checkVisibility === 'function') return h.checkVisibility({ visibilityProperty: true, opacityProperty: true } as CheckVisibilityOptions)
  return h.getClientRects().length > 0
}

function scrollable(el: Element) {
  if (!(el instanceof HTMLElement)) return false
  const o = getComputedStyle(el).overflowY
  return (o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 40
}

/** the box el shows in: the viewport cut by every scrolling box around it (null: none of it shows) */
function onScreen(el: Element) {
  const r = el.getBoundingClientRect()
  let top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight), left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth)
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (!scrollable(p) && getComputedStyle(p).overflow !== 'hidden') continue
    const b = p.getBoundingClientRect()
    top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); left = Math.max(left, b.left); right = Math.min(right, b.right)
  }
  return bottom - top >= 2 && right - left >= 2
}

/** the topmost open modal dialog: only it is listed (the rest can't be reached until it closes) */
function topDialog(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open], [role="alertdialog"]')].filter(shown)
  return all.at(-1) ?? null
}

function scrollWords(el: HTMLElement) {
  const max = el.scrollHeight - el.clientHeight
  const pct = max > 0 ? Math.round((el.scrollTop / max) * 100) : 0
  const more = [el.scrollTop > 4 ? 'more above' : '', el.scrollTop < max - 4 ? 'more below' : ''].filter(Boolean).join(', ')
  return `scrolled ${pct}%${more ? ` (${more})` : ''}`
}

/** a scrolling part's name: its label, a chat's "messages", else the heading over it (the panel's "Artifacts") */
function scrollName(el: HTMLElement) {
  const own = text(el.getAttribute('aria-label'))
  if (own) return own
  if (el.querySelector('[data-msg]')) return 'messages'
  const heads = 'h1, h2, h3, [role="heading"]'
  for (let p: HTMLElement | null = el, i = 0; p && i < 5; p = p.parentElement, i++) {
    const h = [...p.querySelectorAll(heads)].find((x) => (p === el || !el.contains(x)) && shown(x) && text(x.textContent))
    if (h) return `${text(h.textContent).slice(0, 50)} list`
  }
  return 'list'
}

/** what is on screen now, in screen order: the things to act on, and how many more are off screen */
export function readScreen(): { nodes: Node[]; hidden: number; dialog: string } {
  const dialog = topDialog()
  const root = dialog ?? document.body
  const nodes: Node[] = []
  let hidden = 0
  const scrolls: Element[] = []
  const walk = (el: Element, depth: number) => {
    if (!shown(el)) return
    let d = depth
    if (el !== root && scrollable(el) && onScreen(el)) {
      nodes.push({ ref: refFor(el), role: 'scroll', name: scrollName(el as HTMLElement), depth, scroll: scrollWords(el as HTMLElement) })
      scrolls.push(el)
      d = depth + 1
    }
    const role = roleOf(el)
    if (LISTED.has(role)) {
      if (!onScreen(el)) {
        if (INTERACTIVE.has(role)) hidden++
      } else {
        const name = nameOf(el)
        // an unnamed heading tells nothing
        if (role !== 'heading' || name) nodes.push(describe(el, role, name, d))
      }
      // what is inside a button or link is its name
      if (INTERACTIVE.has(role) && role !== 'option') return
    }
    for (const c of el.children) walk(c, d)
  }
  for (const c of root.children) walk(c, 0)
  // the same name more than once (each row's Remove, Replace, Review): each says its row ("Remove, GH_TOKEN")
  const seen = new Map<string, number>()
  for (const n of nodes) if (n.role !== 'heading' && n.role !== 'scroll') seen.set(n.name, (seen.get(n.name) ?? 0) + 1)
  for (const n of nodes) {
    if (n.role === 'heading' || n.role === 'scroll' || (seen.get(n.name) ?? 0) < 2) continue
    const ctx = rowOf(elementOf(n.ref), n.name)
    if (ctx) n.name = `${n.name}, ${ctx}`
  }
  return { nodes: nodes.slice(0, 400), hidden, dialog: dialog ? text(dialog.getAttribute('aria-label')) || nameOf(dialog).slice(0, 60) || 'a dialog' : '' }
}

/** the words of the row a repeated button is in, without the buttons' own: what tells one Remove from another (a row
 *  is small: a part with more than a few buttons is a bar or a list, and says nothing about one of them) */
function rowOf(el: HTMLElement | null, name: string) {
  const CONTROLS = 'button, [role="button"], a, input, select, textarea, [role="tab"]'
  for (let p = el?.parentElement, i = 0; p && p !== document.body && i < 4; p = p.parentElement, i++) {
    if (p.querySelectorAll(CONTROLS).length > 4) return ''
    const bits: string[] = []
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest(CONTROLS) && text(n.textContent)) bits.push(text(n.textContent))
    const t = bits.join(' · ')
    if (t && t !== name) return t.slice(0, 50)
  }
  return ''
}

function describe(el: Element, role: string, name: string, depth: number): Node {
  const n: Node = { ref: refFor(el), role, name, depth }
  const a = (k: string) => el.getAttribute(k)
  if (a('aria-selected') === 'true') n.selected = true
  if (a('aria-checked') === 'true' || (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') && el.checked)) n.checked = true
  if (a('aria-pressed') === 'true') n.pressed = true
  if (a('aria-expanded') === 'true') n.expanded = true
  if (a('aria-expanded') === 'false') n.collapsed = true
  if (a('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled) n.disabled = true
  if (a('aria-current') && a('aria-current') !== 'false') n.current = true
  if (document.activeElement === el) n.focused = true
  if (role === 'heading') n.level = Number(a('aria-level') ?? el.tagName.slice(1)) || undefined
  if (el instanceof HTMLSelectElement) {
    n.value = el.selectedOptions[0]?.textContent?.trim() ?? ''
    n.options = [...el.options].map((o) => text(o.textContent))
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el instanceof HTMLInputElement && el.type === 'password') n.value = el.value ? '(hidden)' : ''
    else if (!(el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))) {
      n.value = el.value
      // a text box's name is its label, not what is typed in it
      if (n.name === el.value) n.name = el.placeholder || el.getAttribute('aria-label') || ''
    }
  }
  return n
}

/** the screen as words for the voice agent (core/screen.js screenText) */
export function screenNow(head: Head, find = '') {
  const r = readScreen()
  return S.screenText({ head: { ...head, dialog: r.dialog, size: `${innerWidth}×${innerHeight}` }, nodes: r.nodes, hidden: r.hidden, find })
}

/** the element a ref names, while it is still on the page */
export function elementOf(ref: string): HTMLElement | null {
  const el = els.get(ref)?.deref()
  return el instanceof HTMLElement && el.isConnected ? el : null
}

const pointer = (el: Element, type: string) => {
  const r = el.getBoundingClientRect()
  const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: type.endsWith('down') ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }
  el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init))
}

/** a press as a finger or mouse does it: down, up, then the click */
export function press(el: HTMLElement) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  pointer(el, 'pointerdown'); pointer(el, 'mousedown')
  pointer(el, 'pointerup'); pointer(el, 'mouseup')
  el.click()
}

/** a key pressed where the focus is (or on el) */
export function key(k: string, el: Element | null = document.activeElement) {
  const at = el && el !== document.body ? el : document.body
  const name = k === 'Space' ? ' ' : k
  const init = { key: name, code: k === 'Space' ? 'Space' : k, bubbles: true, cancelable: true, composed: true }
  const go = at.dispatchEvent(new KeyboardEvent('keydown', init))
  at.dispatchEvent(new KeyboardEvent('keyup', init))
  return go
}

/** Enter or Space that would do something that can't be taken back: on a risky button, or in a dialog whose own
 *  button is (a Remove dialog's box submits on Enter). The words to ask the person, else ''. */
export function riskyEnter(k: string, at: Element | null) {
  if (k !== 'Enter' && k !== 'Space') return ''
  const el = at instanceof HTMLElement ? at : null
  if (el && S.risky(nameOf(el))) return `Press ${nameOf(el).slice(0, 80)}?`
  const dialog = el?.closest<HTMLElement>('[aria-modal="true"], [role="alertdialog"], dialog') ?? topDialog()
  if (!dialog) return ''
  const b = [...dialog.querySelectorAll<HTMLElement>('button, [role="button"]')].find((x) => shown(x) && S.risky(nameOf(x)))
  return b ? `Press ${nameOf(b).slice(0, 80)} in ${text(dialog.getAttribute('aria-label')) || 'the dialog'}?` : ''
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/**
 * A key as the person's keyboard would press it: the page's own handlers first (keydown), then what the browser would
 * do itself, which a made-up key event doesn't: Tab moves the focus, Enter or Space presses a focused button or link,
 * Page Up/Down, Home and End scroll. Says what happened.
 */
export function pressKey(k: string): string {
  const at = document.activeElement as HTMLElement | null
  const handled = !key(k, at)
  if (handled) return `Pressed ${k}`
  if (k === 'Tab') {
    const scope = topDialog() ?? document.body
    const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => shown(x) && onScreen(x))
    if (!all.length) return 'Pressed Tab: nothing on screen takes the focus'
    const next = all[(all.indexOf(at as HTMLElement) + 1) % all.length]
    next.focus()
    const r = roleOf(next)
    return `Pressed Tab: the focus is on the ${r || 'item'}${nameOf(next) ? ` "${nameOf(next).slice(0, 60)}"` : ''}`
  }
  if ((k === 'Enter' || k === 'Space') && at && at !== document.body) {
    const r = roleOf(at)
    if (['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'treeitem'].includes(r) && !(at instanceof HTMLInputElement && at.type === 'text')) {
      press(at)
      return `Pressed ${k} on the ${r}${nameOf(at) ? ` "${nameOf(at).slice(0, 60)}"` : ''}`
    }
  }
  if (['PageDown', 'PageUp', 'Home', 'End'].includes(k)) return scroll({ PageDown: 'down', PageUp: 'up', Home: 'top', End: 'bottom' }[k]!, null)
  return `Pressed ${k}; nothing on the page took it`
}

/** words put in a text box as typing would (React sees the change); the box's old words are replaced */
export function typeInto(el: HTMLElement, value: string) {
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  if (el.isContentEditable) {
    document.getSelection()?.selectAllChildren(el)
    document.execCommand('insertText', false, value)
    return true
  }
  return false
}

/** the main scrolling part of the screen: the biggest one showing (in the dialog when one is open) */
function mainScroller(): HTMLElement {
  const root = topDialog() ?? document.body
  let best: HTMLElement | null = null, area = 0
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (!scrollable(el) || !shown(el) || !onScreen(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height > area) { area = r.width * r.height; best = el }
  }
  return best ?? (document.scrollingElement as HTMLElement)
}

/** a scroll: the box the ref names (or the one around it), else the main one */
export function scroll(direction: string, el: HTMLElement | null) {
  let box: HTMLElement | null = el
  while (box && !scrollable(box)) box = box.parentElement
  const s = box ?? mainScroller()
  const before = s.scrollTop
  const step = Math.max(80, s.clientHeight * 0.8)
  const top = direction === 'top' ? 0 : direction === 'bottom' ? s.scrollHeight : direction === 'up' ? s.scrollTop - step : s.scrollTop + step
  s.scrollTo({ top, behavior: 'instant' as ScrollBehavior })
  // a list that loads more as it nears an end (a chat's older messages) hears it as a scroll
  s.dispatchEvent(new Event('scroll'))
  const name = s === document.scrollingElement ? 'the page' : `the ${scrollName(s)}`
  return s.scrollTop === before ? `${name} is already at the ${direction === 'up' || direction === 'top' ? 'top' : 'bottom'}` : `Scrolled ${name} ${direction === 'top' || direction === 'bottom' ? `to the ${direction}` : direction}, ${scrollWords(s)}`
}

export const nextFrame = (ms = 220) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms))

/**
 * One screen action (core/screen.js screenParams' answer), done on this page, then the screen read again.
 * close and back are the app's own (closeTop, back), passed in. A click on a risky button is held until confirmed.
 */
export async function screenAction(p: Record<string, unknown>, head: () => Head, app: { back(): string | null; closeTop(): string | null }): Promise<ScreenAck> {
  const q = S.screenParams(p) as { error?: string; do: string; ref: string; text: string; direction: string; submit: boolean; find: string; confirmed: boolean }
  const after = async (did: string): Promise<ScreenAck> => { await nextFrame(); return { ok: true, did, screen: screenNow(head(), q.find) } }
  const no = (why: string): ScreenAck => ({ ok: false, why, screen: screenNow(head(), q.find) })
  if (q.error) return no(q.error)
  if (q.do === 'look') return { ok: true, screen: screenNow(head(), q.find) }
  if (q.do === 'back') {
    const did = app.back()
    return did ? after(did) : no('there is nothing to go back to')
  }
  if (q.do === 'close') {
    const did = app.closeTop()
    return did ? after(did) : no('nothing is open over the screen to close')
  }
  if (q.do === 'key') {
    const held = riskyEnter(q.text, document.activeElement)
    if (held && !q.confirmed) return { ok: false, ask: held, screen: '' }
    return after(pressKey(q.text))
  }
  const el = q.ref ? elementOf(q.ref) : null
  if (q.ref && !el) return no(`${q.ref} isn't on the screen any more: here is what is`)
  if (q.do === 'scroll') return after(scroll(q.direction, el))
  const role = roleOf(el!)
  const name = nameOf(el!)
  const called = `${role || 'item'}${name ? ` "${name.slice(0, 80)}"` : ''}`
  if (q.do === 'click') {
    if ((el as HTMLButtonElement).disabled || el!.getAttribute('aria-disabled') === 'true') return no(`the ${called} is disabled`)
    if (S.risky(name) && !q.confirmed) return { ok: false, ask: `Press ${name.slice(0, 80)}?`, screen: '' }
    press(el!)
    return after(`Pressed the ${called}`)
  }
  if (q.do === 'type') {
    if (el instanceof HTMLInputElement && el.type === 'password') return no('that field is for a secret: secrets go in the masked box, never by voice')
    if (!typeInto(el!, q.text)) return no(`the ${called} isn't a text field`)
    if (q.submit) {
      const held = riskyEnter('Enter', el)
      if (held && !q.confirmed) return { ok: false, ask: `${held} (the text is typed in already)`, screen: '' }
      key('Enter', el)
    }
    return after(`Typed into the ${called}${q.submit ? ' and pressed Enter' : ''}`)
  }
  if (q.do === 'select') {
    if (!(el instanceof HTMLSelectElement)) {
      // a custom list: open it; the voice agent then clicks the choice. Anything else isn't a list (select never
      // presses a button: a risky one would go round the yes)
      if (!['combobox', 'listbox', 'button'].includes(role) || (role === 'button' && el!.getAttribute('aria-haspopup') === null && el!.getAttribute('aria-expanded') === null)) return no(`the ${called} isn't a list to pick from: click it instead`)
      if (S.risky(name) && !q.confirmed) return { ok: false, ask: `Press ${name.slice(0, 80)}?`, screen: '' }
      press(el!)
      return after(`Opened the ${called}: click the choice next`)
    }
    const want = q.text.toLowerCase()
    const o = [...el.options].find((x) => text(x.textContent).toLowerCase() === want) ?? [...el.options].find((x) => text(x.textContent).toLowerCase().includes(want))
    if (!o) return no(`the ${called} has no choice "${q.text}"`)
    el.value = o.value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return after(`Picked "${text(o.textContent)}" in the ${called}`)
  }
  return no('the screen can\'t do that')
}
