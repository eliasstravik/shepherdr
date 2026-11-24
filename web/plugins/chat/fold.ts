// Long text, folded. A long paste into the message box becomes a chip (its size and first words) instead of a wall of
// text in the box, as Claude's apps do; it opens to read, goes back into the box to edit, and its x takes it out. It is
// sent as text, exactly as pasted, after what you typed. In the chat a very long message shows its first lines and
// Show more; its words are all there (copy, and the browser's find, see them).
import { useSyncExternalStore } from 'react'

/** a paste this long becomes a chip: many lines (a log, a JSON) or many characters (one long line of JSON) */
export const PASTE_LINES = 25
export const PASTE_CHARS = 2500
/** a message this long shows folded in the chat */
export const FOLD_LINES = 30
export const FOLD_CHARS = 3000

export const linesOf = (t: string) => t.replace(/\n$/, '').split('\n').length

export const isLongPaste = (t: string) => !!t.trim() && (linesOf(t) >= PASTE_LINES || t.length >= PASTE_CHARS)
export const isLongMessage = (t: string) => linesOf(t) > FOLD_LINES || t.length > FOLD_CHARS

/** its size in words: lines when it has many, else characters */
export function sizeOf(t: string): string {
  const n = linesOf(t)
  if (n > 1) return `${n.toLocaleString('en-US')} lines`
  const c = t.length
  return c >= 1000 ? `${(c / 1000).toFixed(1).replace(/\.0$/, '')}k characters` : `${c} characters`
}

/** its first words, on one line */
export function peekOf(t: string, max = 80): string {
  const s = t.trim().replace(/\s+/g, ' ')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** what goes to the agent: your words, then each paste as it was pasted, a blank line between */
export function joined(typed: string, pastes: string[]): string {
  return [typed.trim(), ...pastes].filter((p) => p.trim()).join('\n\n')
}

/* ---------- a box's pastes, kept with its draft across reloads ---------- */

export type Paste = { id: string; text: string }
const KEY = 'shepherdr.pastes'
let all: Record<string, Paste[]> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
})()
const listeners = new Set<() => void>()
const none: Paste[] = []

export const getPastes = (key: string): Paste[] => all[key] ?? none
export function setPastes(key: string, fn: (ps: Paste[]) => Paste[]) {
  const next = fn(getPastes(key))
  all = { ...all }
  if (next.length) all[key] = next
  else delete all[key]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* too big to keep, or no storage: it stays for this page */
  }
  listeners.forEach((l) => l())
}
let n = 0
export const addPaste = (key: string, text: string) => setPastes(key, (ps) => [...ps, { id: `${Date.now().toString(36)}-${n++}`, text }])
export const dropPaste = (key: string, id: string) => setPastes(key, (ps) => ps.filter((p) => p.id !== id))

export function usePastes(key: string): Paste[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => getPastes(key),
    () => getPastes(key),
  )
}
