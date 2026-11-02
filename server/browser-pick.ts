// What Mark up learns about the element you tapped. These run inside the page (Runtime.callFunctionOn on the
// node under your finger), so they are plain JavaScript that only uses what every page has.
import type { BrowserPick } from '../shared/browser.ts'

/** runs with `this` as the node at the tapped point; returns a BrowserPick without url, shot and thumb */
export const describe = function (this: Node, tapX: number, tapY: number) {
  const el = (this.nodeType === 1 ? this : this.parentElement) as HTMLElement | null
  if (!el) return null
  const doc = el.ownerDocument
  const win = doc.defaultView!
  const IDS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-component']
  const one = (s: string | null | undefined, n: number) => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n - 1)}…` : t
  }
  const esc = (s: string) => (win.CSS?.escape ? win.CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'))
  // class names a build made up (css-1x2y3z, sc-AbCdE, _a1b2c3) say nothing about the code
  const made = (c: string) => c.length > 40 || /^(css|sc|jsx|emotion|svelte)-/.test(c) || /^_?[a-zA-Z]{0,3}[-_]?[a-zA-Z0-9]{5,}$/.test(c) && /\d/.test(c) && !/-\d+$/.test(c)
  const classes = (e: Element) => [...e.classList].filter((c) => !made(c) && !c.includes(':') && !c.includes('[') && !c.includes('/'))
  const idOf = (e: Element) => (e.id && !/\d{3,}|^[:«]/.test(e.id) ? e.id : '')
  const seg = (e: Element) => {
    const tag = e.tagName.toLowerCase()
    const id = idOf(e)
    if (id) return `#${esc(id)}`
    for (const a of IDS) {
      const v = e.getAttribute(a)
      if (v && v.length < 80) return `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`
    }
    const c = classes(e).slice(0, 2)
    return tag + c.map((x) => `.${esc(x)}`).join('')
  }
  const unique = (sel: string) => {
    try {
      return doc.querySelectorAll(sel).length === 1
    } catch {
      return false
    }
  }
  const nth = (e: Element, s: string) => {
    const p = e.parentElement
    if (!p) return s
    const same = [...p.children].filter((x) => x.tagName === e.tagName)
    return same.length > 1 ? `${s}:nth-of-type(${same.indexOf(e) + 1})` : s
  }
  // the element alone, or by its place among its siblings; else with its parents in front, one at a time, until
  // the selector finds it alone (or five parents say no more)
  const me = seg(el)
  const mine = [me, nth(el, me)]
  const alone = (prefix: string[]) => mine.map((m) => [...prefix, m].join(' > ')).find(unique)
  const prefix: string[] = []
  let selector = alone(prefix)
  for (let cur = el.parentElement, i = 0; !selector && cur && cur !== doc.documentElement && i < 5; cur = cur.parentElement, i++) {
    prefix.unshift(seg(cur))
    selector = alone(prefix)
  }
  selector ??= [...prefix, mine[1]].join(' > ')

  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role')
  const kind = role ?? ({ a: 'link', img: 'image', textarea: 'textarea', select: 'select' } as Record<string, string>)[tag] ?? tag
  const own = one(el.innerText ?? el.textContent, 120)
  const input = el as HTMLInputElement
  const label =
    el.getAttribute('aria-label') ||
    el.getAttribute('alt') ||
    (tag === 'input' || tag === 'textarea' ? input.placeholder || input.name : '') ||
    el.getAttribute('title') ||
    (own.length <= 40 ? own : '')
  const element = tag === 'input' ? `input[type=${input.type || 'text'}]${label ? ` "${one(label, 40)}"` : ''}` : `${kind}${label ? ` "${one(label, 40)}"` : ''}`

  const attrs: string[] = []
  for (const a of [...IDS, 'name', 'type', 'href', 'for', 'src']) {
    const v = el.getAttribute(a)
    if (v && !(a === 'type' && tag !== 'input' && tag !== 'button')) attrs.push(`${a}="${one(v, 80)}"`)
  }
  const a11y: string[] = []
  if (role) a11y.push(`role=${role}`)
  for (const a of ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-expanded', 'aria-pressed', 'aria-checked', 'aria-disabled']) {
    const v = el.getAttribute(a)
    if (v) a11y.push(`${a}="${one(v, 60)}"`)
  }

  const cs = win.getComputedStyle(el)
  const styles: string[] = []
  const add = (k: string, v: string, skip?: (v: string) => boolean) => v && !skip?.(v) && styles.push(`${k} ${v}`)
  const zero = (v: string) => /^(0px ?)+$/.test(v)
  add('color', cs.color)
  add('background', cs.backgroundColor, (v) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent')
  add('font', `${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()}`)
  add('padding', cs.padding, zero)
  add('margin', cs.margin, zero)
  if (parseFloat(cs.borderTopWidth) > 0) add('border', `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`)
  add('radius', cs.borderRadius, zero)
  if (/flex|grid|none/.test(cs.display)) add('display', cs.display)
  if (/flex|grid/.test(cs.display)) add('gap', cs.gap, (v) => v === 'normal' || zero(v))
  add('opacity', cs.opacity, (v) => v === '1')
  add('shadow', cs.boxShadow, (v) => v === 'none')

  const frame = win !== win.top
  let fixed = false
  for (let e: Element | null = el; e; e = e.parentElement) {
    const p = win.getComputedStyle(e).position
    if (p === 'fixed' || p === 'sticky') {
      fixed = true
      break
    }
  }

  // React keeps its tree on the element: the components around it, nearest last (named ones only)
  let react = ''
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  if (key) {
    const names: string[] = []
    let f = (el as unknown as Record<string, { type?: unknown; return?: unknown }>)[key] as { type?: { displayName?: string; name?: string } | string; return?: unknown } | undefined
    for (let i = 0; f && i < 40 && names.length < 5; i++, f = f.return as typeof f) {
      const t = f.type
      const n = t && typeof t !== 'string' ? t.displayName || t.name : ''
      if (n && /^[A-Z][A-Za-z0-9]+$/.test(n) && n.length > 2 && names[0] !== n) names.unshift(n)
    }
    react = names.join(' > ')
  }

  const r = el.getBoundingClientRect()
  const nearby = own ? '' : one(el.parentElement?.innerText, 100)
  return {
    element,
    selector,
    text: own && own !== label ? own : own.length > 40 ? own : '',
    nearby,
    classes: one([...el.classList].join(' '), 200),
    attrs: attrs.join(' '),
    a11y: a11y.join(' '),
    styles: styles.join('; '),
    react,
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    // a frame scrolls on its own: its pin stays where you tapped
    at: { x: Math.round(tapX + (fixed || frame ? 0 : win.scrollX)), y: Math.round(tapY + (fixed || frame ? 0 : win.scrollY)) },
    fixed: fixed || frame,
    frame,
  } satisfies Omit<BrowserPick, 'url'>
}

/** the box of the element at the point (the hover outline in Mark up) */
export const boxOf = function (this: Node) {
  const el = (this.nodeType === 1 ? this : this.parentElement) as Element | null
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
}
