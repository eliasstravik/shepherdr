// Search in a chat, like WhatsApp and Slack: a bar over the messages finds words in them, newest first. Every match is
// marked; the arrows (or Enter and Shift+Enter) step through them, each one brought into view (opened, if folded) and
// lit up. Esc or the x closes it.
import { useEffect, useMemo, useRef } from 'react'
import { getState, setUI, useStore, useUI } from '@client/kernel.ts'
import { DownIcon, ic, IconButton, roundBtn, SearchIcon, XIcon } from '@client/ui.tsx'
import { findIn } from './days.ts'
import { jumpTo } from './reply.ts'

export function openFind(chat: string) {
  setUI({ find: { chat, q: getState().ui.find?.chat === chat ? getState().ui.find!.q : '', id: null }, menu: false, taskMenu: false, plus: null, pick: null })
}

export const closeFind = () => setUI({ find: null })

const highlights = () => (CSS as unknown as { highlights?: Map<string, unknown> }).highlights

/** mark every place the words are in this chat's messages' words (where the browser can: the CSS highlight API) */
function mark(chat: string, q: string) {
  const reg = highlights()
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!reg || !H) return
  const w = q.trim().toLowerCase()
  if (!w) return void reg.delete('find')
  const ranges: Range[] = []
  for (const el of document.querySelectorAll(`[data-chat="${CSS.escape(chat)}"][data-msg] [data-text]`)) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent!.toLowerCase()
      for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + w.length)) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + w.length)
        ranges.push(r)
      }
    }
  }
  reg.set('find', new H(...ranges))
}

export function FindBar({ chatKey }: { chatKey: string }) {
  const f = useUI((u) => (u.find?.chat === chatKey ? u.find : null))
  const msgs = useStore((s) => s.chats[chatKey]?.messages)
  const input = useRef<HTMLInputElement>(null)
  const q = f?.q ?? ''
  const found = useMemo(() => findIn(msgs ?? [], q), [msgs, q])
  // the match looked at (the newest until you step): by its id, so a reply coming in doesn't move you
  const current = f?.id && found.includes(f.id) ? f.id : (found.at(-1) ?? null)
  const pos = current ? found.indexOf(current) : -1
  useEffect(() => {
    if (f) input.current?.focus({ preventScroll: true })
  }, [!!f])
  // marks follow the words and the chat (a reply coming in, a reply opened); closed, they go
  useEffect(() => {
    if (!f) return void highlights()?.delete('find')
    const t = setTimeout(() => mark(chatKey, q), 60)
    return () => clearTimeout(t)
  }, [!!f, q, msgs, current])
  useEffect(() => () => void highlights()?.delete('find'), [])
  // the match being looked at comes into view; while typing, once the words settle
  useEffect(() => {
    if (!current) return
    const t = setTimeout(() => jumpTo(chatKey, current), 200)
    return () => clearTimeout(t)
  }, [current, q])
  if (!f) return null
  /** 1: an older match, -1: a newer one, around the ends */
  const step = (by: 1 | -1) => found.length && setUI({ find: { ...f, id: found[(pos - by + found.length) % found.length] } })
  return (
    <div className="mx-auto w-full max-w-read shrink-0 px-4 pt-2">
      <div role="search" className="round-box flex items-center gap-1 bg-bg p-1.5 pl-3 shadow-box has-[input:focus]:shadow-box-focus">
        <SearchIcon className={`${ic} text-fg3`} />
        <input
          ref={input}
          name="find"
          type="search"
          aria-label="Search in this chat"
          placeholder="Search in this chat"
          autoComplete="off"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setUI({ find: { ...f, q: e.target.value, id: null } })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              step(e.shiftKey ? -1 : 1)
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              closeFind()
            }
          }}
          className="h-[34px] min-w-0 flex-1 bg-transparent px-1.5 outline-none placeholder:text-fg3 phone:h-11 phone:text-[1rem] [&::-webkit-search-cancel-button]:hidden"
        />
        {q.trim() ? (
          <span role="status" className="shrink-0 px-1 text-[0.75rem] whitespace-nowrap text-fg2 tabular-nums phone:text-[0.8125rem]">
            {found.length ? `${pos + 1} of ${found.length}` : 'No matches'}
          </span>
        ) : null}
        <IconButton label="Older match" disabled={found.length < 2} className={roundBtn} onClick={() => step(1)}>
          <DownIcon className={`${ic} rotate-180`} />
        </IconButton>
        <IconButton label="Newer match" disabled={found.length < 2} className={roundBtn} onClick={() => step(-1)}>
          <DownIcon className={ic} />
        </IconButton>
        <IconButton label="Close search" className={roundBtn} onClick={closeFind}>
          <XIcon className={ic} />
        </IconButton>
      </div>
    </div>
  )
}
