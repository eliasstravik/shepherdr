// Needs you, one rule for every view (SHEP-250): the web app's Tasks panel and its counts and badges, and the glance feed
// (the phone's widgets, lock screen card and watch) all list what this says, in this order. Before, the Tasks panel listed
// only tasks whose status was Needs you while the feed also listed an Assistant's unread message and a working task's
// alert, so one screen said "2 need you" over a panel with no Needs you at all.
//
// What waits on you, each thing once, a task at most once:
// - a card or wait of an agent (snapshot.needs: a question, a permission, a plan, a secret ask, a turn waiting);
// - a task whose status is Needs you with no such record;
// - an agent's own alert (herdr-task alert) while it stands (alertStands), a working task's too: that task is in Needs
//   you, not Working, until it goes;
// - an automation that didn't run, or didn't start its task.
// An Assistant's new message is not in it (SHEP-253): it is no task, so it stays in Chat (its unread dot and badge);
// unreadChats lists those for a Chat badge (the glance feed's `unread`).
// Each leaves at the same moment everywhere: answered (its need goes), its alert over (its
// agent ended, its task done, 15 minutes old, or its machine's memory back), the automation running again.
import { notifyOf } from './alerts.ts'
import type { Automation, Need, Place, Snapshot, Task } from './types.ts'

type Alert = NonNullable<Snapshot['alerts']>[number]

export type Waiting = {
  /** stable while it lasts, the glance feed's item key: need:<chat>:<id>, task:<id>, alert:<id>, auto:… */
  key: string
  type: 'need' | 'task' | 'alert' | 'auto'
  /** since when it waits (ms): the list goes oldest first */
  at: number
  /** the space it belongs to (a task's place, an automation's list) */
  place?: string
  /** the task it is about: that task shows in Needs you, nowhere else */
  task?: string
  need?: Need
  alert?: Alert
  auto?: Automation
}

export type NeedsSnap = Pick<Snapshot, 'places' | 'tasks' | 'needs'> & Partial<Pick<Snapshot, 'alerts' | 'last' | 'read' | 'settings' | 'automations' | 'machines'>>

/** an agent's own alert is a moment, as in the app (a toast, once): Needs you lists it this long, then lets it go */
export const ALERT_FRESH_MS = 15 * 60_000
/** a memory guard's alert is over once its machine's memory is back under this (herdr-task tick GUARD_BACK_UNDER) */
export const MEMORY_BACK_UNDER = 75

/** has the chat something you haven't read ('*': since when read marks are kept, anything older counts as read) */
export function unread(snap: Pick<Snapshot, 'last' | 'read'>, key: string | undefined): boolean {
  const last = key ? snap.last?.[key] : undefined
  if (!key || !last) return false
  return last > Math.max(snap.read?.[key] ?? 0, snap.read?.['*'] ?? 0)
}

/** the task a chat belongs to (a task's chats are <task id>/<agent>) */
const taskOfChat = (snap: Pick<Snapshot, 'tasks'>, chat?: string) =>
  chat?.includes('/') ? snap.tasks.find((t) => t.id === chat.slice(0, chat.lastIndexOf('/'))) : undefined

/**
 * Is an agent's alert still something that waits: what reaches the person (notify), from a terminal still running (a
 * finished helper's is over), of a task not done, fresh, and for a memory alert, its machine still short of memory (its
 * last read; none: by age alone).
 */
export function alertStands(a: Alert | undefined | null, snap: Pick<NeedsSnap, 'tasks' | 'machines'>, now: number): boolean {
  if (!a?.notify || a.ended || !(now - (Number(a.at) || 0) < ALERT_FRESH_MS)) return false
  const task = taskOfChat(snap, a.chat)
  if (task && (task.archived || task.status === 'done')) return false
  if (a.memory) {
    const m = (snap.machines ?? []).find((x) => (a.machine ? x.machine === a.machine && !x.here : x.here))
    const mem = (m?.stats?.health as { memory?: unknown } | undefined)?.memory
    if (typeof mem === 'number' && mem <= MEMORY_BACK_UNDER) return false
  }
  return true
}

/** an automation's key, as the Tasks panel's row has it */
export const autoKey = (a: Automation) => `auto:${a.machine ?? ''}:${a.listName}:${a.name}`

/**
 * Everything that waits on you, oldest first (ties by key), a task once (its oldest). now: the clock alerts age by.
 */
export function needsYou(snap: NeedsSnap, now = Date.now()): Waiting[] {
  const out: Waiting[] = []
  const tasks = new Map<string, Task>(snap.tasks.map((t) => [t.id, t]))
  const open = (id?: string) => { const t = id ? tasks.get(id) : undefined; return !!t && !t.archived && t.status !== 'done' }
  const taken = new Set<string>()
  const add = (w: Waiting) => { if (w.task) { if (taken.has(w.task)) return; taken.add(w.task) } out.push(w) }
  // a task's cards: its oldest stands for it (one row, one item)
  const needs = [...snap.needs].sort((a, b) => a.at - b.at)
  for (const n of needs) {
    if (n.task && !open(n.task)) continue
    add({ key: `need:${n.chat}:${n.id}`, type: 'need', at: n.at, place: n.place, ...(n.task ? { task: n.task } : {}), need: n })
  }
  for (const t of snap.tasks) if (t.status === 'need' && !t.archived) add({ key: `task:${t.id}`, type: 'task', at: t.at ?? 0, place: t.place, task: t.id })
  for (const a of snap.alerts ?? []) {
    if (!alertStands(a, snap, now)) continue
    const t = taskOfChat(snap, a.chat)
    add({ key: `alert:${a.id}`, type: 'alert', at: Number(a.at) || 0, ...(a.place ?? t?.place ? { place: a.place ?? t!.place } : {}), ...(t ? { task: t.id } : {}), alert: a })
  }
  for (const [place, autos] of Object.entries(snap.automations ?? {}))
    for (const a of autos) if (a.error) add({ key: autoKey(a), type: 'auto', at: a.runs?.[0]?.at ?? 0, place, auto: a })
  return out.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** the Assistants' chats with a new message you haven't read (their space not muted, no card of their own waiting):
 *  Chat's, never Needs you's (SHEP-253) */
export function unreadChats(snap: NeedsSnap): { chat: string; place: string; at: number }[] {
  const asking = new Set(snap.needs.map((n) => n.chat))
  const out: { chat: string; place: string; at: number }[] = []
  for (const p of snap.places as Place[]) {
    if (!p.chat || !unread(snap, p.chat) || asking.has(p.chat)) continue
    if (snap.settings && notifyOf({ settings: snap.settings }, p.id) === 'Off') continue
    out.push({ chat: p.chat, place: p.id, at: snap.last![p.chat] })
  }
  return out
}

/** the tasks in Needs you (they show there, in no other group) */
export const waitingTasks = (ws: Waiting[]) => new Set(ws.map((w) => w.task).filter((t): t is string => !!t))
