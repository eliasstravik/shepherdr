// "/" in the message box (GitHub #1560, back from 3.1): while the whole message is one "/word" so far, the agent's
// own commands that match, its CLI's and (Claude Code) the person's own commands and skills, from /api/commands
// (core/slash.js). The same popup and keys as the # and @ list (mentions.tsx): Up/Down, Enter or Tab take one into
// the box, Escape closes, a tap takes one (the box keeps the keyboard). Whatever is sent goes to the agent as typed,
// except /model, which opens the agent picker (modelTyped).
import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import * as SL from '@core/slash.js'
import { Row } from '@client/ui.tsx'

const S = SL as any

export type Command = { name: string; about: string }

/* ---------- this chat's agent's commands: asked for when the list first opens, kept a minute ---------- */

const asked = new Map<string, number>()
const known = new Map<string, Command[]>()
const listeners = new Set<() => void>()

function load(chatKey: string) {
  if (Date.now() - (asked.get(chatKey) ?? 0) < 60_000) return
  asked.set(chatKey, Date.now())
  fetch(`api/commands?chat=${encodeURIComponent(chatKey)}`, { headers: { 'x-shepherdr': '1' } })
    .then((r) => r.json())
    .catch(() => ({ commands: [] }))
    .then((r: { commands?: Command[] }) => {
      known.set(chatKey, r?.commands ?? [])
      listeners.forEach((f) => f())
    })
}

function useCommands(chatKey: string, want: boolean): Command[] | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!want) return
    const on = () => tick((n) => n + 1)
    listeners.add(on)
    load(chatKey)
    return () => void listeners.delete(on)
  }, [chatKey, want])
  return known.get(chatKey) ?? null
}

/** the "/word" being typed while the whole message is one command so far, else null */
export const slashWord = (text: string): string | null => S.typing(text)

/** the commands that match what is typed: names that start with it first */
export const slashItems = (list: Command[] | null, word: string): Command[] => (list ? S.match(list, word) : [])

/** "/model" or "/model sonnet" alone in the box: the model it names ('' for none), else undefined. It never goes to
 *  the agent: it opens the agent picker, as 3.1's did */
export function modelTyped(text: string): string | undefined {
  const m = /^\/model(?:\s+(\S+))?\s*$/i.exec(text.trim())
  return m ? (m[1] ?? '') : undefined
}

/** the "/" list of a chat's message box: what it shows over the box, and its keys */
export function useSlash(chatKey: string, text: string, setText: (t: string) => void, ref: RefObject<HTMLTextAreaElement | null>) {
  const word = slashWord(text)
  const list = useCommands(chatKey, word !== null)
  const [shut, setShut] = useState<string | null>(null)
  const [at, setAt] = useState(0)
  const items = word === null ? [] : slashItems(list, word)
  // a bare "/" says the list is coming; a word nothing matches (a path, "/tmp") shows nothing
  const open = word !== null && text !== shut && (items.length > 0 || (word === '' && !list))
  useLayoutEffect(() => setAt(0), [word])
  const sel = Math.min(at, items.length - 1)
  const id = `sl-${chatKey.replace(/[^\w-]/g, '_')}`

  const pick = (c: Command | undefined) => {
    if (!c) return
    const now = `/${c.name} `
    setText(now)
    const el = ref.current
    if (!el) return
    el.focus()
    requestAnimationFrame(() => el.setSelectionRange(now.length, now.length))
  }
  /** true when the list took the key */
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing) return false
    const n = items.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (n) setAt((sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      // Enter on a command typed out in full sends it, as the CLI runs it
      if (!n || (e.key === 'Enter' && items[sel]?.name === word)) return false
      pick(items[sel])
    } else if (e.key === 'Escape') {
      setShut(text)
      e.stopPropagation()
    } else return false
    e.preventDefault()
    return true
  }

  const shown = open ? (
    <div className="pop mlist" role="listbox" id={id} aria-label="Commands">
      <div className="lab">Commands</div>
      {!items.length && <p className="hint">Looking for commands…</p>}
      {items.map((c, n) => (
        <Row
          key={c.name}
          id={`${id}-${n}`}
          role="option"
          aria-selected={n === sel}
          tabIndex={-1}
          label={`/${c.name}`}
          sub={c.about}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => n !== sel && setAt(n)}
          onClick={() => pick(c)}
        />
      ))}
    </div>
  ) : null

  return {
    list: shown,
    onKey,
    box: {
      'aria-controls': open ? id : undefined,
      'aria-activedescendant': open && items.length ? `${id}-${sel}` : undefined,
    },
  }
}

// for tests
export const _commands = { known, asked }
