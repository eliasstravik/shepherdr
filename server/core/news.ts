import { randomUUID } from 'node:crypto'
import { mergeWords } from './task-options.ts'
import type { CoreSource } from './source.ts'
import type { CoreTask } from './tasks.ts'
import type { CoreAgent } from './model.ts'

export interface StallCause { quietLife?: number; overReport?: number }
export type TaskNewsEvent = 'added' | 'ready' | 'merged' | 'closed' | 'failed' | 'stalled' | 'needs-you'
interface Notice {
  id: string; task: string; place: string; target: string; event: TaskNewsEvent; at: number; text: string
  launch?: string; state: 'waiting' | 'queued' | 'cancelled'
  observed: { workflow: string; attempt?: string; agent?: string; ready?: number; done?: number; startError?: string; life: number; report?: number; exit?: number | null; signal?: number | null; quietLife?: number; overReport?: number; eta?: number }
}
const life = (task: CoreTask, agent?: CoreAgent, statusAt: number | null = 0) => Math.max(agent?.started ?? 0, agent?.activityAt ?? 0, statusAt ?? 0, task.reportedAt ?? 0)
const overdue = (was: Notice['observed'], task: CoreTask, now: number) => was.overReport !== undefined && task.reportedAt === was.overReport && task.report?.eta === was.eta && was.eta !== undefined && now - was.overReport > (was.eta + Math.max(was.eta, 20)) * 60000
/** Each task's own Merge setting: what the coordinator tells the human must come from here, never a guess. */
const MERGE_NOTE = ' Its merge field is this task\'s own Merge setting: only "ask the human first" needs the human\'s yes; otherwise it merges without them.'
const words: Record<TaskNewsEvent, string> = { added: 'Added', ready: 'Ready to merge', merged: 'Merged', closed: 'Done', failed: 'Went wrong', stalled: 'Quiet for too long', 'needs-you': 'Needs you' }

/** Durable task news uses saved workflow/native evidence, never screen contents or caller labels. */
export class CoreTaskNews {
  constructor(private source: CoreSource) {}
  /** Called inside the event producer's observation transaction. */
  record(task: CoreTask, event: TaskNewsEvent, at: number, stall?: StallCause) {
    const space = this.source.space(task.place)
    if (!space || task.archived) return
    const agent = this.source.agents.get(task.chat), terminal = agent && this.source.agents.terminal(agent)
    const baseObserved: Notice['observed'] = { workflow: task.workflow, attempt: task.launchAttempt, agent: agent?.launch, ready: task.readyAt, done: task.doneAt, startError: task.startError,
      life: life(task, agent, terminal?.status_ms), report: task.reportedAt, exit: terminal?.exit_code, signal: terminal?.signal, ...(event === 'stalled' ? { ...(stall ?? { quietLife: life(task, agent, terminal?.status_ms) }), eta: task.report?.eta } : {}) }
    const main = this.source.spaces().find(item => item.home && item.machine === this.source.localMachineId())
    const targets = new Set([space.id, ...(main ? [main.id] : [])])
    for (const target of targets) {
      const owner = this.source.space(target)
      if (!owner || owner.mode !== 'regular' || event === 'added') continue // Legacy regular coordinators do not echo creation news.
      const observed = { ...baseObserved }
      // One still-waiting observation of each kind suffices; newer evidence supersedes the older one.
      for (const old of this.source.store.all<Notice>('task-news')) if (old.task === task.id && old.target === target && old.event === event && old.state === 'waiting') {
        if (event === 'stalled' && this.valid(old, task, at)) {
          if (overdue(old.observed, task, at)) { observed.overReport = old.observed.overReport; observed.eta = old.observed.eta }
          if (old.observed.quietLife !== undefined && life(task, agent, terminal?.status_ms) <= old.observed.quietLife) observed.quietLife = Math.max(observed.quietLife ?? 0, old.observed.quietLife)
        }
        old.state = 'cancelled'; this.source.store.set('task-news', old.id, old)
      }
      const id = `task-news-${randomUUID()}`, summary = words[event]
      const text = JSON.stringify({ task: task.id, title: task.name, event, status: this.source.tasks.view(task).status, space: space.name, machine: task.machine, ...(event === 'ready' ? { merge: mergeWords(task.mergePolicy) } : {}) }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
      this.source.store.set('task-news', id, { id, task: task.id, place: task.place, target, event, at, state: 'waiting', observed, text } satisfies Notice)
      // Ordinary workflow changes already updated the row in the originating chat; failures/stalls have no change of their own.
      if (target !== space.id || ['failed', 'stalled', 'needs-you'].includes(event)) this.source.taskRow(target, task, { status: this.source.tasks.view(task).status, text: summary }, at)
    }
    // A machine-home or main-home Autopilot keeps its own configured wake rules, with the original space identity.
    for (const home of this.source.spaces().filter(item => item.home && item.mode === 'autopilot' && item.id !== space.id && (item.machine === task.machine || item.machine === this.source.localMachineId()))) {
      if (event !== 'closed') this.source.pilots.wakes.news({ event, title: task.name, branch: task.branch, space: space.name, ...(event === 'ready' ? { detail: `Merge: ${mergeWords(task.mergePolicy)}` } : {}) }, home.id)
    }
  }
  private valid(notice: Notice, task: CoreTask, now: number) {
    const agent = this.source.agents.get(task.chat), terminal = agent && this.source.agents.terminal(agent), was = notice.observed
    if (notice.event === 'added') return false // Retire an older waiting echo without replaying it.
    if (task.place !== notice.place || task.archived || task.workflow !== was.workflow || task.launchAttempt !== was.attempt || agent?.launch !== was.agent) return false
    if (notice.event === 'ready') return task.readyAt === was.ready && task.workflow === 'ready'
    if (notice.event === 'merged' || notice.event === 'closed') return task.doneAt === was.done
    if (notice.event === 'failed') return task.startError === was.startError && (task.startError || terminal?.state === 'finished' && terminal.exit_code === was.exit && terminal.signal === was.signal)
    if (notice.event === 'stalled') {
      const quiet = was.quietLife !== undefined && life(task, agent, terminal?.status_ms) <= was.quietLife
      const view = this.source.tasks.view(task)
      return terminal?.state === 'live' && view.status === 'work' && !view.waitsFor && (quiet || overdue(was, task, now))
    }
    if (notice.event === 'needs-you') return this.source.tasks.view(task).status === 'need'
    return true
  }
  deliver(now = Date.now()) {
    if (this.source.quiescing || !this.source.connected()) return
    const queued = new Set<string>()
    for (const notice of this.source.store.all<Notice>('task-news')) {
      if (notice.state !== 'waiting') {
        if (notice.at < now - 7 * 86400000) this.source.store.delete('task-news', notice.id)
        continue
      }
      const task = this.source.tasks.get(notice.task), target = this.source.space(notice.target), origin = this.source.space(notice.place)
      if (!task || !target || !origin || target.mode !== 'regular' || !this.valid(notice, task, now)) { notice.state = 'cancelled'; this.source.store.set('task-news', notice.id, notice); continue }
      if (!this.source.machineConnected(task.machine) || !this.source.machineConnected(target.machine) || this.source.tasks.busy(task.id) || this.source.pilots.lifecycle.busy(target.id) || this.source.pilots.completion.busy(target.id)) continue
      if (queued.has(target.id)) continue
      const agent = this.source.agents.get(target.id)
      if (!agent || agent.role !== 'coordinator' || agent.space !== target.id || agent.machine !== target.machine || agent.pilot || this.source.status(agent) !== 'idle' || this.source.agents.terminal(agent)?.state !== 'live') continue
      this.source.saveAndDeliver(target.id, notice.id, `<news>${notice.text}\nObserved product news, not a new human request. The task's live row in this chat already shows this. Reply only with a no-reply marker unless you have something to add that the row doesn't say; act only within existing authorization and your own task ownership. Main-home overview does not grant cross-space mutation authority.${notice.event === 'ready' ? MERGE_NOTE : ''}</news>`, () => {
        notice.state = 'queued'; notice.launch = agent.launch; this.source.store.set('task-news', notice.id, notice); queued.add(target.id)
      }, true)
    }
  }
}
