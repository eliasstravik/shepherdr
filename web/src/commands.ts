// The commands' shortcuts, live: each command's default keys (from its plugin) unless Settings › Shortcuts changed
// them (kept for the person in the settings file, every device alike), the one key handler that runs them, and the
// palette's recent picks (this device). Plain rules (chords, where they fire, clashes) are keys.ts'.
import { useSyncExternalStore } from 'react'
import { getState, registry, setDraft, subscribe, type Command } from './kernel.ts'
import { hasLayer } from './overlay.tsx'
import { chordOf, focusOf, held, here, isMac, mayFire } from './keys.ts'
import type { Task } from '@shared/types.ts'
import { taskChat } from '@shared/view.ts'

/** the person's changes (Settings › Shortcuts): a command's own list of keys (empty: none), and single letters on or off */
export interface KeyPrefs {
  keys: Record<string, string[]>
  letters: boolean
}

export const NO_PREFS: KeyPrefs = { keys: {}, letters: true }
export const prefsOf = (): KeyPrefs => getState().snap?.config?.shortcuts ?? NO_PREFS

/** a command's keys now, in this computer's spelling: changed, or its defaults */
export function keysOf(id: string, prefs = prefsOf(), mac = isMac()): string[] {
  const own = prefs.keys[id]
  const cmd = registry.commands.find((c) => c.id === id)
  return (own ?? cmd?.keys ?? []).map((k) => here(k, mac))
}

/** every command's keys now, by id */
export function bound(prefs = prefsOf(), mac = isMac()): Record<string, string[]> {
  return Object.fromEntries(registry.commands.map((c) => [c.id, keysOf(c.id, prefs, mac)]))
}

/** a command's keys, redrawn when they change */
export function useKeys(id: string): string[] {
  const get = () => JSON.stringify(keysOf(id))
  return JSON.parse(useSyncExternalStore(subscribe, get, get)) as string[]
}
export const usePrefs = (): KeyPrefs => {
  const get = () => getState().snap?.config?.shortcuts ?? NO_PREFS
  return useSyncExternalStore(subscribe, get, get)
}

export const available = (c: Command) => {
  try {
    return !c.when || c.when()
  } catch {
    return false
  }
}

/* ---------- recent picks: the palette shows them first ---------- */

const RECENT = 'shepherdr.recent'
let recent: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 30) : []
  } catch {
    return []
  }
})()
export const recents = () => recent
/** a palette row picked: "cmd:<id>", "space:<id>", "task:<id>", "art:<id>" */
export function used(key: string) {
  recent = [key, ...recent.filter((k) => k !== key)].slice(0, 30)
  try {
    localStorage.setItem(RECENT, JSON.stringify(recent))
  } catch {
    /* a private window */
  }
}

export function runCommand(c: Command, from: 'key' | 'palette' = 'palette') {
  if (from === 'palette') used(`cmd:${c.id}`)
  c.run()
}

/* ---------- the one key handler ---------- */

/** the first key of a sequence pressed ("G"), until the next key or a second and a half */
let pending: { chord: string; at: number } | null = null
const SEQ_MS = 1500

/** something drawn over the app takes the keys: a dialog, a menu, the palette, the settings window */
const covered = () => !!getState().ui.search || !!getState().ui.settings || hasLayer()

/** a key press: runs the command it is a shortcut for, if any may fire here. True when it was one (the caller stops
 *  the browser's own). */
export function handleKey(e: KeyboardEvent, mac = isMac()): boolean {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return false
  const chord = chordOf(e, mac)
  if (!chord) return false
  const focus = focusOf(e.target as Element | null)
  const prefs = prefsOf()
  const cmds = registry.commands
  const keys = bound(prefs, mac)
  // something over the app: only chords that hold a modifier (the palette's own Cmd+K closes it)
  const over = covered()
  const fires = (c: Command, k: string) => mayFire(k, focus, { terminal: c.terminal, letters: prefs.letters }) && !(over && !held(k)) && available(c)
  if (pending && e.timeStamp - pending.at < SEQ_MS) {
    const seq = `${pending.chord} ${chord}`
    pending = null
    const c = cmds.find((c) => keys[c.id].includes(seq) && fires(c, seq))
    if (c) {
      runCommand(c, 'key')
      return true
    }
  }
  pending = null
  const c = cmds.find((c) => keys[c.id].includes(chord) && fires(c, chord))
  if (c) {
    runCommand(c, 'key')
    return true
  }
  // the first key of a sequence: wait for the next
  if (cmds.some((c) => keys[c.id].some((k) => k.startsWith(`${chord} `) && fires(c, k)))) {
    pending = { chord, at: e.timeStamp }
    return true
  }
  return false
}

/** a terminal's own key handler asks: does this press belong to the app (Cmd+K, Ctrl+`)? Then it lets it pass. */
export function appTakes(e: KeyboardEvent | { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac = isMac()): boolean {
  const chord = chordOf(e, mac)
  if (!chord) return false
  const keys = bound(prefsOf(), mac)
  return registry.commands.some((c) => c.terminal && keys[c.id].includes(chord))
}

/** for tests: forget a half-typed sequence */
export const resetPending = () => void (pending = null)

/* ---------- what a command acts on ---------- */

/** the task in focus: the one whose message box has the cursor, else the one open in the pane, else the maximized one */
export function focusTask(): Task | undefined {
  const { snap, ui } = getState()
  if (!snap) return undefined
  const box = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null)?.closest?.('[data-box]')?.getAttribute('data-box') : null
  if (box) return snap.tasks.find((t) => taskChat(t) === box)
  const id = (ui.pane === 'tasks' && ui.task) || ui.max
  return id ? snap.tasks.find((t) => t.id === id) : undefined
}

/** the chat in focus: the focused task's, else the space's shown */
export function focusChat(): string | undefined {
  const { snap, ui } = getState()
  const t = focusTask()
  if (t) return taskChat(t)
  return snap?.places.find((p) => p.id === ui.at)?.chat
}

/** put the cursor in the message box of the chat in focus (Reply), with words to start it with */
export function focusBox(chat = focusChat(), start?: string) {
  if (!chat || typeof document === 'undefined') return false
  const box = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-box]')].find((b) => b.dataset.box === chat)
  if (!box) return false
  if (start !== undefined && !box.value.trim()) setDraft(chat, start)
  box.focus()
  requestAnimationFrame(() => box.setSelectionRange(box.value.length, box.value.length))
  return true
}

/** a part of the message box of the chat in focus (its agent line, its mic) */
export function boxPart(selector: string, chat = focusChat()): HTMLElement | null {
  if (!chat || typeof document === 'undefined') return null
  const box = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-box]')].find((b) => b.dataset.box === chat)
  return box?.closest('.cbox')?.querySelector<HTMLElement>(selector) ?? null
}
