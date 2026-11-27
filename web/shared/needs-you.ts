// Needs you, one rule for every view (SHEP-250): the web app's Tasks panel and its counts and badges, and the glance feed
// (the phone's widgets, lock screen card and watch) all list what this says, in this order. Before, the Tasks panel listed
// only tasks whose status was Needs you while the feed also listed an Assistant's unread message and a working task's
// alert, so one screen said "2 need you" over a panel with no Needs you at all.
//
// What waits on you, each thing once, a task at most once:
// - a card or wait of a task's agent (snapshot.needs: a question, a permission, a plan, a secret ask, a turn waiting);
// - a task whose status is Needs you with no such record;
// - a task's agent's own alert (herdr-task alert, or a helper's labelled herdr.task) while it stands (alertStands), a working task's too: that task is in Needs
//   you, not Working, until it goes;
// Only tasks are in it (SHEP-255): what isn't a task's goes to Chat and notifications, where it already shows. An
// Assistant's new message (SHEP-253; unreadChats lists those for a Chat badge, the glance feed's `unread`), an
// Assistant's own card, a helper's alert that is no task's (the VM sign-in helper's "Finish sign-in"), a machine's
// memory alert, an automation that failed (its row in Automations says so): none of them are rows, counts or badges here.
// Each leaves at the same moment everywhere: answered (its need goes), its alert over (its
// agent ended, its task done, 15 minutes old while its task does not wait on you, or its machine's memory back).
import { notifyOf } from './alerts.ts'
import type { Need, Place, Snapshot, Task } from './types.ts'

export type Alert = NonNullable<Snapshot['alerts']>[number]

export type Waiting = {
  /** stable while it lasts, the glance feed's item key: need:<chat>:<id>, task:<id>, alert:<id> */
  key: string
  type: 'need' | 'task' | 'alert'
  /** since when it waits (ms): the list goes oldest first */
  at: number
  /** the space its task belongs to */
  place?: string
  /** the task it is about: that task shows in Needs you, nowhere else */
  task: string
  need?: Need
  alert?: Alert
}

export type NeedsSnap = Pick<Snapshot, 'places' | 'tasks' | 'needs'> & Partial<Pick<Snapshot, 'alerts' | 'last' | 'read' | 'settings' | 'machines'>>

/** an agent's own alert is a moment, as in the app (a toast, once): Needs you lists it this long, then lets it go;
 *  longer while its task still waits on you (#1561: a guard's approval code it is stuck on) */
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
/** the task an alert is about: its own (service/push.ts agentAlerts), else its chat's */
const taskOfAlert = (snap: Pick<Snapshot, 'tasks'>, a: Alert) => (a.task ? snap.tasks.find((t) => t.id === a.task) : undefined) ?? taskOfChat(snap, a.chat)

/**
 * Is an agent's alert still something that waits: what reaches the person (notify), from a terminal still running (a
 * finished helper's is over), of a task not done, fresh, and for a memory alert, its machine still short of memory (its
 * last read; none: by age alone).
 */
export function alertStands(a: Alert | undefined | null, snap: Pick<NeedsSnap, 'tasks' | 'machines'>, now: number): boolean {
  if (!a?.notify || a.ended) return false
  const at = Number(a.at) || 0
  const task = taskOfAlert(snap, a)
  if (task && (task.archived || task.status === 'done')) return false
  // past its 15 minutes, it stands while its task still waits on you, a wait that began while it was fresh
  const waits = !!task && task.status === 'need' && !(task.needsAt && task.needsAt - at > ALERT_FRESH_MS)
  if (!(now - at < ALERT_FRESH_MS) && !waits) return false
  if (a.memory) {
    const m = (snap.machines ?? []).find((x) => (a.machine ? x.machine === a.machine && !x.here : x.here))
    const mem = (m?.stats?.health as { memory?: unknown } | undefined)?.memory
    if (typeof mem === 'number' && mem <= MEMORY_BACK_UNDER) return false
  }
  return true
}


/**
 * The tasks that wait on you, oldest first (ties by key), each once (its oldest). now: the clock alerts age by.
 */
export function needsYou(snap: NeedsSnap, now = Date.now()): Waiting[] {
  const out: Waiting[] = []
  const tasks = new Map<string, Task>(snap.tasks.map((t) => [t.id, t]))
  const open = (id?: string) => { const t = id ? tasks.get(id) : undefined; return !!t && !t.archived && t.status !== 'done' }
  const taken = new Set<string>()
  const add = (w: Waiting) => { if (taken.has(w.task)) return; taken.add(w.task); out.push(w) }
  // A task's oldest blocking card stands for it. Queued questions are individual items alongside its Working row.
  const needs = [...snap.needs].sort((a, b) => a.at - b.at)
  const forAssistant: Waiting[] = []
  for (const n of needs) {
    if (!n.task || !open(n.task)) continue
    const item: Waiting = { key: `need:${n.chat}:${n.id}`, type: 'need', at: n.at, place: n.place, task: n.task, need: n }
    if (n.assistantFirst) forAssistant.push(item)
    else if (n.question?.queued) out.push(item)
    else add(item)
  }
  const inferred = new Set(forAssistant.map((w) => w.task))
  for (const t of snap.tasks) if (t.status === 'need' && !t.archived && !inferred.has(t.id)) add({ key: `task:${t.id}`, type: 'task', at: t.at ?? 0, place: t.place, task: t.id })
  for (const a of snap.alerts ?? []) {
    const t = taskOfAlert(snap, a)
    if (!t || !alertStands(a, snap, now)) continue
    add({ key: `alert:${a.id}`, type: 'alert', at: Number(a.at) || 0, place: t.place, task: t.id, alert: a })
  }
  // An explicit handoff can stand for a task whose inferred wait is still in the list.
  for (const w of forAssistant) add(w)
  return out.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** each task's standing alert, its newest (#1561): its words show on its row, in it and in a toast */
export function taskAlerts(snap: Pick<NeedsSnap, 'tasks' | 'alerts' | 'machines'>, now = Date.now()): Map<string, Alert> {
  const out = new Map<string, Alert>()
  for (const a of snap.alerts ?? []) {
    const t = taskOfAlert(snap, a)
    if (!t || !alertStands(a, snap, now)) continue
    const had = out.get(t.id)
    if (!had || (Number(a.at) || 0) > (Number(had.at) || 0)) out.set(t.id, a)
  }
  return out
}

/** an alert's own words, without the "<task> · " its toast title starts with */
export const alertWhat = (a: Pick<Alert, 'title' | 'what'>) => a.what || a.title

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
export const waitingTasks = (ws: Waiting[]) => new Set(ws.filter((w) => !w.need?.question?.queued).map((w) => w.task))
