// An agent's reply, drawn from markdown: links open in a new tab (the app stays where it is), a code block has a copy
// button in its corner (like ChatGPT and Claude), and a tap on a bit of `code` (a command, a path, a branch) copies it.
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, type MouseEvent } from 'react'

marked.setOptions({ gfm: true, breaks: false })

// a link goes to a new tab, never in place of the app
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A' || !node.getAttribute('href')) return
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

const svg = (d: string[], cls: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" class="${cls}">${d.map((x) => `<path d="${x}"/>`).join('')}</svg>`
const COPY = svg(
  [
    'M5.5 3.5A1.5 1.5 0 0 1 7 2h2.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 1 .439 1.061V9.5A1.5 1.5 0 0 1 12 11V8.621a3 3 0 0 0-.879-2.121L9 4.379A3 3 0 0 0 6.879 3.5H5.5Z',
    'M4 5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 14h5a1.5 1.5 0 0 0 1.5-1.5V8.621a1.5 1.5 0 0 0-.44-1.06L7.94 5.439A1.5 1.5 0 0 0 6.878 5H4Z',
  ],
  'copy',
)
const DONE = svg(['M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z'], 'done')

/** the reply as safe HTML: a copy button on each code block, and a bit of inline code copies when tapped. The marks
    go onto the sanitized elements themselves, never into the HTML as text, so nothing in the reply can turn into them.
    A link's or picture's title goes: nothing pops up on hover */
export function toHtml(text: string) {
  const root = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { RETURN_DOM: true, FORBID_ATTR: ['title'] }) as HTMLElement
  for (const pre of root.querySelectorAll('pre')) {
    const box = document.createElement('div')
    box.className = 'code'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-copy', '')
    btn.setAttribute('aria-label', 'Copy code')
    // our own two icons, fixed strings
    btn.innerHTML = COPY + DONE
    pre.replaceWith(box)
    box.append(btn, pre)
  }
  for (const code of root.querySelectorAll('code')) {
    // a bit of code inside a link is the link's
    if (code.closest('pre, a')) continue
    code.setAttribute('data-copy', '')
  }
  keepIdsWhole(root)
  const h = root.innerHTML.trim()
  const one = h.match(/^<p>([\s\S]*)<\/p>$/)
  return one && !one[1].includes('<p>') ? one[1] : h
}

/** a task's id (GTM-15) never breaks at its hyphen onto two lines */
const ID = /\b[A-Z][A-Z0-9]*-\d+\b/g

function keepIdsWhole(root: HTMLElement) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const hits: Text[] = []
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if ((n.nodeValue ?? '').search(ID) >= 0 && !n.parentElement?.closest('pre, code')) hits.push(n as Text)
  for (const t of hits) {
    const text = t.nodeValue!
    const out = document.createDocumentFragment()
    let at = 0
    for (const m of text.matchAll(ID)) {
      out.append(text.slice(at, m.index))
      const id = document.createElement('span')
      id.className = 'whitespace-nowrap'
      id.textContent = m[0]
      out.append(id)
      at = m.index + m[0].length
    }
    out.append(text.slice(at))
    t.replaceWith(out)
  }
}

/** copy words: the clipboard where the page may use it, the old way on a plain http link */
export function copyText(text: string) {
  if (navigator.clipboard && isSecureContext) return navigator.clipboard.writeText(text).catch(() => fallback(text))
  fallback(text)
  return Promise.resolve()
}

function fallback(text: string) {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.append(area)
  area.select()
  try {
    document.execCommand('copy')
  } finally {
    area.remove()
  }
}

const shown = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/** a code block's button, or a bit of inline code, says it copied for a moment (to a screen reader too) */
function copied(el: Element) {
  el.setAttribute('data-copied', '')
  if (el.tagName === 'BUTTON') el.setAttribute('aria-label', 'Copied')
  clearTimeout(shown.get(el))
  shown.set(
    el,
    setTimeout(() => {
      el.removeAttribute('data-copied')
      if (el.tagName === 'BUTTON') el.setAttribute('aria-label', 'Copy code')
    }, 1400),
  )
}

function onCopy(e: MouseEvent) {
  const el = (e.target as Element).closest('[data-copy]')
  if (!el || !e.currentTarget.contains(el)) return
  // dragging across code selects it; that is not a tap
  if (el.tagName === 'CODE' && getSelection()?.toString()) return
  e.stopPropagation()
  const code = el.tagName === 'CODE' ? el : el.parentElement?.querySelector('pre')
  if (!code?.textContent) return
  copyText(code.textContent.replace(/\n$/, ''))
  copied(el)
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => toHtml(text), [text])
  return <div className="prose-reply" onClick={onCopy} dangerouslySetInnerHTML={{ __html: html }} />
}
