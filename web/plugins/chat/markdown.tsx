// An agent's reply, drawn from markdown: links open in a new tab (the app stays where it is), a code block has a copy
// button in its corner (like ChatGPT and Claude), and a tap on a bit of `code` (a command, a path, a branch) copies it.
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, type MouseEvent } from 'react'
import { copyText } from '@client/copy.ts'
import { goPlace, openTask, useSnap } from '@client/kernel.ts'
import * as MNs from '@core/mentions.js'
import { forMarkdown, hasMention, parseMention, parseTask, stateOf, taskStateOf, TITLE, useReach } from './mentions.tsx'
const shortTitle = (MNs as any).short as (t: string) => string

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
export function toHtml(text: string, mention?: (a: HTMLAnchorElement, name: string, target: string, kind: 'space' | 'task') => void) {
  const root = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { RETURN_DOM: true, FORBID_ATTR: ['title'] }) as HTMLElement
  if (mention) for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="#space="], a[href^="#task="]')) {
    const task = a.getAttribute('href')!.startsWith('#task=')
    mention(a, (a.textContent ?? '').replace(/^[#@]/, ''), decodeURIComponent(a.getAttribute('href')!.slice(task ? 6 : 7)), task ? 'task' : 'space')
  }
  for (const pre of root.querySelectorAll('pre')) {
    const box = document.createElement('div')
    box.className = 'code'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-copy', '')
    btn.setAttribute('aria-label', 'Copy code')
    // our own two icons, fixed strings, and the window's words beside them
    btn.innerHTML = `${COPY}${DONE}<span class="copy">Copy</span><span class="done">Copied</span>`
    // as the window's code block: a bar over it with its language ("code" when it names none) and Copy
    const head = document.createElement('div')
    head.className = 'code-head'
    const lang = document.createElement('span')
    lang.textContent = /\blanguage-([\w+#.-]+)/.exec(pre.querySelector('code')?.className ?? '')?.[1] ?? 'code'
    head.append(lang, btn)
    pre.replaceWith(box)
    box.append(head, pre)
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
  // a block's button sits in the bar over its code (SHEP-152: it looked beside itself, found nothing, copied nothing)
  const code = el.tagName === 'CODE' ? el : el.closest('.code')?.querySelector('pre')
  if (!code?.textContent) return
  void copyText(code.textContent.replace(/\n$/, ''), el).then((ok) => ok && copied(el))
}

/** chat: the chat it is in, so a #-mention of a space (core/mentions.js) draws as a chip, open or locked */
export function Markdown({ text, chat }: { text: string; chat?: string }) {
  if (chat && hasMention(text)) return <WithMentions text={text} chat={chat} />
  return <Plain text={text} />
}

function Plain({ text }: { text: string }) {
  const html = useMemo(() => toHtml(text), [text])
  return <div className="prose-reply" onClick={onCopy} dangerouslySetInnerHTML={{ __html: html }} />
}

const CHIP = 'inline-flex max-w-full items-baseline rounded-md px-1.5 align-baseline whitespace-nowrap no-underline'
const LOCK = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="size-3 shrink-0 self-center mr-1"><path fill-rule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z" clip-rule="evenodd"/></svg>'

function WithMentions({ text, chat }: { text: string; chat: string }) {
  const snap = useSnap()
  const got = useReach(chat)
  const states = new Map<string, ReturnType<typeof stateOf>>()
  for (const m of text.matchAll(/\[#([^\]\n]{1,80})\]\(space:([^)\s]+)\)/g)) states.set(m[2], stateOf(parseMention(m[1], m[2]), snap, got))
  const tasks = new Map<string, ReturnType<typeof taskStateOf>>()
  for (const m of text.matchAll(/\[@([^\]\n]{1,80})\]\(task:([^)\s]+)\)/g)) tasks.set(m[2], taskStateOf(parseTask(m[2]), snap, got, chat))
  const key = [...states].map(([t, s]) => `${t}:${s.ok}:${s.machine}:${s.place?.id ?? ''}`).join('|') + '|' +
    [...tasks].map(([t, s]) => `${t}:${s.ok}:${s.task?.id ?? ''}:${s.task?.status ?? ''}:${s.task?.report?.progress ?? ''}:${s.task?.name ?? ''}`).join('|')
  const html = useMemo(() => toHtml(forMarkdown(text), (a, name, target, kind) => {
    if (kind === 'task') return a.replaceWith(taskChip(parseTask(target).ref, tasks.get(target) ?? taskStateOf(parseTask(target), snap, got, chat)))
    const s = states.get(target) ?? stateOf(parseMention(name, target), snap, got)
    const chip = document.createElement(s.ok ? 'button' : 'span')
    const words = document.createElement('span')
    words.className = 'truncate'
    const b = document.createElement('span')
    b.className = 'font-medium'
    b.textContent = `#${name}`
    words.append(b)
    if (s.machine) { const w = document.createElement('span'); w.className = 'opacity-70'; w.textContent = ` · ${s.machine}`; words.append(w) }
    if (s.ok) {
      chip.setAttribute('type', 'button')
      chip.setAttribute('data-mention', 'open')
      chip.setAttribute('data-place', s.place!.id)
      chip.setAttribute('aria-label', `Open space ${name} on ${s.machine}`)
      chip.className = `${CHIP} bg-accent/12 text-accent hover:bg-accent/20`
    } else {
      chip.setAttribute('data-mention', 'locked')
      chip.setAttribute('aria-label', `${name}: ${s.why}`)
      chip.className = `${CHIP} bg-fg/6 text-fg3`
      chip.innerHTML = LOCK
    }
    chip.append(words)
    a.replaceWith(chip)
  }), [text, key])
  const click = (e: MouseEvent) => {
    const t = (e.target as Element).closest('[data-task]')
    if (t && e.currentTarget.contains(t)) { e.stopPropagation(); return openTask(t.getAttribute('data-task')!) }
    const el = (e.target as Element).closest('[data-place]')
    if (el && e.currentTarget.contains(el)) { e.stopPropagation(); return goPlace(el.getAttribute('data-place')!) }
    onCopy(e)
  }
  return <div className="prose-reply" onClick={click} dangerouslySetInnerHTML={{ __html: html }} />
}

const TASK_CHIP = 'inline-flex max-w-full items-baseline gap-1 rounded-md py-px pr-1.5 pl-1 align-baseline whitespace-nowrap no-underline'

/** a task's chip in an agent's reply, as mentions.tsx TaskChip draws it in the person's words */
function taskChip(ref: string, s: ReturnType<typeof taskStateOf>) {
  const chip = document.createElement(s.ok ? 'button' : 'span')
  const words = document.createElement('span')
  words.className = 'truncate'
  const b = document.createElement('span')
  b.className = 'font-medium'
  b.textContent = s.ok ? ref : `@${ref}`
  words.append(b)
  if (s.task) {
    const w = document.createElement('span'), title = document.createElement('span')
    if (s.ok) w.className = 'text-fg2'
    title.className = TITLE
    title.textContent = shortTitle(s.task.name)
    w.append(' · ', title)
    words.append(w)
  }
  if (s.ok) {
    const t = s.task!
    chip.setAttribute('type', 'button')
    chip.setAttribute('data-mention', 'open')
    chip.setAttribute('data-task', t.id)
    chip.setAttribute('aria-label', `Open task ${ref}: ${t.name}`)
    chip.className = `${TASK_CHIP} bg-accent/12 text-accent hover:bg-accent/20`
    const dot = document.createElement('span')
    dot.className = `dot ${t.status} size-3 self-center`
    const p = t.report?.progress
    if (t.status === 'work' && p !== undefined) dot.style.setProperty('--p', `${Math.max(4, p)}%`)
    dot.setAttribute('role', 'img')
    dot.setAttribute('aria-label', t.status)
    chip.append(dot)
  } else {
    chip.setAttribute('data-mention', 'locked')
    chip.setAttribute('aria-label', `${ref}: ${s.why}`)
    chip.className = `${TASK_CHIP} bg-fg/6 text-fg3`
    chip.innerHTML = LOCK.replace(' mr-1', '')
  }
  chip.append(words)
  return chip
}
