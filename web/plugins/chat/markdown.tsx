// An agent's reply, drawn from markdown: a link to this app opens in it, any other in a new tab (kernel.ts catches
// the tap: SHEP-339; the app stays where it is), a code block has a copy
// button (the design system's code block), a tap on a bit of `code` copies it, and task names and #spaces are links
// that open them.
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { copyText } from '@client/copy.ts'
import { IC } from '@client/icons.ts'
import { go, notice, openTask, useSnap } from '@client/kernel.ts'
import type { Message, Snapshot } from '@shared/types.ts'
import { spacesOf, taskRef } from '@shared/view.ts'
import { parseTask } from '@core/mentions.js'

marked.setOptions({ gfm: true, breaks: false })

// a link goes to a new tab, never in place of the app; one to this app is caught by kernel.ts and opens in it.
// Without a browser (bun test) DOMPurify has no hooks: the module still loads, so a test's mock can keep its real exports.
if (DOMPurify.isSupported) DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A' || !node.getAttribute('href')) return
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

/** the reply as safe HTML: a copy button on each code block, and a bit of inline code copies when tapped. The marks
    go onto the sanitized elements themselves, never into the HTML as text, so nothing in the reply can turn into them.
    A link's or picture's title goes: nothing pops up on hover. `link`: called for each #space and task link. */
export function toHtml(text: string, link?: (a: HTMLAnchorElement, kind: 'space' | 'task', target: string) => void) {
  const root = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { RETURN_DOM: true, FORBID_ATTR: ['title'] }) as HTMLElement
  if (link)
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="#space="], a[href^="#task="]')) {
      const task = a.getAttribute('href')!.startsWith('#task=')
      link(a, task ? 'task' : 'space', decodeURIComponent(a.getAttribute('href')!.slice(task ? 6 : 7)))
    }
  for (const pre of root.querySelectorAll('pre')) {
    // the design system's code block: the code, and a copy button at its right
    const box = document.createElement('div')
    box.className = 'code block'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ib'
    btn.setAttribute('data-copy', '')
    btn.setAttribute('aria-label', 'Copy')
    btn.innerHTML = `<svg class="i" viewBox="0 0 20 20" aria-hidden="true">${IC.copy}</svg>`
    pre.replaceWith(box)
    box.append(pre, btn)
  }
  // #1442: a table cell holding a sentence keeps a readable width; the table scrolls sideways in its box instead
  for (const cell of root.querySelectorAll('td, th')) if ((cell.textContent ?? '').trim().length > 24) cell.classList.add('long')
  for (const code of root.querySelectorAll('code')) {
    // a bit of code inside a link is the link's
    if (code.closest('pre, a')) continue
    code.setAttribute('data-copy', '')
  }
  const h = root.innerHTML.trim()
  const one = h.match(/^<p>([\s\S]*)<\/p>$/)
  return one && !one[1].includes('<p>') ? one[1] : h
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
      if (el.tagName === 'BUTTON') el.setAttribute('aria-label', 'Copy')
    }, 1400),
  )
}

function onCopy(e: MouseEvent) {
  const el = (e.target as Element).closest('[data-copy]')
  if (!el || !e.currentTarget.contains(el)) return
  // dragging across code selects it; that is not a tap
  if (el.tagName === 'CODE' && getSelection()?.toString()) return
  e.stopPropagation()
  // a block's button sits in the bar over its code (SHEP-152: it looked beside itself, found nothing, copied nothing)
  const code = el.tagName === 'CODE' ? el : el.closest('.code')?.querySelector('pre')
  if (!code?.textContent) return
  void copyText(code.textContent.replace(/\n$/, ''), el).then((ok) => ok && copied(el))
}


const escMd = (t: string) => t.replace(/[\\\[\]]/g, (c) => `\\${c}`)

/** Task names and #spaces as links: a picked `[#shop](space:…)` or `[@Fix login](task:SHOP-2…)`, a task's key the agent wrote
 *  (shown as the task's title, never its id) and a #space the list has. Code is left alone. */
export function linked(text: string, snap: Snapshot | null, mentions: Message['mentions'] = []): string {
  if (!snap) return text
  const tasks = new Map<string, { id: string; title: string }>()
  for (const t of snap.tasks) tasks.set(taskRef(t), { id: t.id, title: t.name })
  for (const m of mentions ?? []) tasks.set(m.ref, { id: m.task, title: m.title })
  const spaces = new Map(spacesOf(snap).map((p) => [p.name.toLowerCase(), p.id]))
  // outside code spans and blocks only
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => {
      if (i % 2) return part
      return part
        .replace(/\[#([^\]\n]+)\]\(space:([^)\s]+)\)/g, (_, name: string, target: string) => `[#${escMd(name)}](#space=${encodeURIComponent(target)})`)
        .replace(/\[@([^\]\n]+)\]\(task:([^)\s]+)\)/g, (_, words: string, target: string) => {
          // SHEP-322: the task its target names (its key there); its words are its title (an older one's, its key)
          const t = tasks.get(parseTask(target).ref) ?? tasks.get(words)
          return `[${escMd(t?.title ?? (/^[A-Z][A-Z0-9]*-\d+$/.test(words) ? 'a task' : words))}](#task=${encodeURIComponent(t?.id ?? target)})`
        })
        .replace(/(^|[^\w\[/=#-])([A-Z][A-Z0-9]*-\d+)\b(?!\]\()/g, (all, pre: string, ref: string) => {
          const t = tasks.get(ref)
          return t ? `${pre}[${escMd(t.title)}](#task=${encodeURIComponent(t.id)})` : all
        })
        .replace(/(^|[\s(])#([\w.-]+)\b(?!\]\()/g, (all, pre: string, name: string) => {
          const id = spaces.get(name.toLowerCase())
          return id ? `${pre}[#${name}](#space=${encodeURIComponent(id)})` : all
        })
    })
    .join('')
}

/** an agent's words, formatted; `mentions`: the tasks the server found named in them */
export function Markdown({ text, mentions, plain }: { text: string; mentions?: Message['mentions']; plain?: boolean }) {
  const snap = useSnap()
  const html = useMemo(
    () =>
      toHtml(plain ? text : linked(text, snap, mentions), (a, kind, target) => {
        a.removeAttribute('target')
        a.removeAttribute('rel')
        a.removeAttribute('href')
        a.className = 'lk'
        a.setAttribute('role', 'link')
        a.setAttribute('tabindex', '0')
        a.setAttribute(kind === 'task' ? 'data-task' : 'data-place', target)
      }),
    [text, snap?.tasks, snap?.places, mentions, plain],
  )
  const open = (e: MouseEvent) => {
    const el = (e.target as Element).closest('[data-task], [data-place]')
    if (!el || !e.currentTarget.contains(el)) return onCopy(e)
    e.stopPropagation()
    const task = el.getAttribute('data-task')
    if (task) return snap?.tasks.some((t) => t.id === task) ? openTask(task) : notice('That task is not in your lists here.')
    const place = el.getAttribute('data-place')!
    return snap?.places.some((p) => p.id === place) ? go(place) : notice('That space is not in your list here.')
  }
  return <div className="md" onClick={open} dangerouslySetInnerHTML={{ __html: html }} />
}

/** your own words as you typed them, with their web addresses as links (one to this app opens in it) */
export function withLinks(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>"]+)/).flatMap((part, i): ReactNode[] => {
    if (i % 2 === 0) return part ? [part] : []
    // a full stop, comma or bracket at the end is the sentence's
    const end = part.match(/[.,;:!?)\]'"]+$/)?.[0] ?? ''
    const url = end ? part.slice(0, -end.length) : part
    return [
      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
      ...(end ? [end] : []),
    ]
  })
}
