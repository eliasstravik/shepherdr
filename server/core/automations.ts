import { findCoreSpace } from './space-names.ts'
import { randomUUID } from 'node:crypto'
import { Automations, type Automation, type Template } from '../automations.ts'
import { mergeWords } from './task-options.ts'
import { eventRules, timeRule, triggerWords, validZone, OWN_ZONE, matches, type Happened } from '../common/trigger.ts'
import { one, parseArgs } from '../common/args.ts'
import { TITLE_MAX, type Action } from '../../shared/types.ts'
import { Refusal } from './client.ts'
import { kindOf } from './settings.ts'
import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'
import type { TaskNewsEvent, StallCause } from './news.ts'
import { guarded } from './guarded.ts'

const checked = <T>(run: () => T): T => { try { return run() } catch (error) { throw new Refusal((error as Error).message) } }

interface Run { id: string; automation: string; place: string; at: number; timed: boolean; state: 'queued' | 'starting' | 'done'; task?: string; error?: string }
interface Seen { at?: number; id: string; place: string; workflow: string; status: string; failure?: string; quietLife?: number; overReport?: number }

/** Product schedules persist beside task records; all task launches still go through core. */
export class CoreAutomations {
  readonly model: Automations
  private timer?: ReturnType<typeof setInterval>
  private active = new Set<Promise<unknown>>()
  private busy = new Set<string>()
  private processing?: Promise<void>
  private scanning = false
  private stopped = false
  constructor(private source: CoreSource) {
    this.model = new Automations({ read: () => source.store.get<Automation[]>('meta', 'automations') ?? [], write: list => source.store.set('meta', 'automations', list) })
  }
  zone() { const zone = this.source.settings.get('time.zone'); return validZone(zone) ? zone : OWN_ZONE }
  view() { return Object.fromEntries(this.source.spaces().map(space => [space.id, this.model.view(space.id, this.zone())])) }
  start() {
    this.stopped = false
    // A crash after launch may have made a task: never launch the same claimed run again.
    for (const run of this.source.store.all<Run>('automation-run')) if (run.state === 'starting') {
      const task = this.source.tasks.all().find(task => task.automation === run.id)
      this.finish(run, task ? { task: task.id } : { error: 'Run interrupted; inspect tasks before running again' })
    }
    const scan = () => { void guarded('Automation scan', () => this.scan()) }
    this.timer = setInterval(scan, 5000)
    this.source.on('snapshot', () => { if (!this.scanning) queueMicrotask(scan) })
    scan()
  }
  private finish(run: Run, result: { task?: string; error?: string }) {
    Object.assign(run, result, { state: 'done' })
    this.source.store.set('automation-run', run.id, run)
    const automation = this.model.list.find(item => item.id === run.automation)
    if (automation) {
      const row = automation.runs?.find(row => row.at === run.at)
      if (row) { delete row.error; Object.assign(row, result) }
      this.model.save()
    }
    this.source.emit('snapshot')
  }
  async fire(automation: Automation, timed = false, queued?: Run) { return this.launch(automation, this.claim(automation, timed, queued)) }
  private claim(automation: Automation, timed: boolean, queued?: Run) {
    if (this.stopped || this.source.quiescing) throw new Refusal('Shepherdr is stopping; retry after reconnecting')
    if (this.busy.has(automation.id)) throw new Refusal('This automation is already starting a task')
    this.busy.add(automation.id)
    const run: Run = queued ? { ...queued, at: Date.now(), state: 'starting' } : { id: randomUUID(), automation: automation.id, place: automation.place, at: Date.now(), timed, state: 'starting' }
    const { last, timed: was, runs, on } = automation
    // Claim and advance its time cursor before any remote work. A lost response cannot launch it twice.
    try {
      this.source.store.db.transaction(() => {
        this.source.store.set('automation-run', run.id, run)
        this.model.fired(automation, { error: 'Starting; inspect tasks if interrupted' }, run.at, timed)
      })()
    } catch (error) {
      // Nothing was claimed: still due, and not left starting for ever.
      Object.assign(automation, { last, timed: was, runs, on })
      this.busy.delete(automation.id)
      throw error
    }
    this.source.emit('snapshot')
    return run
  }
  private async launch(automation: Automation, run: Run) {
    const work = (async () => {
      try {
        const space = this.source.space(automation.place)
        if (!space || space.home) throw new Refusal('Its repository space is gone')
        const pick = automation.task.agent, kind = pick?.kind ? kindOf(pick.kind) : undefined
        if (pick?.kind && !kind) throw new Refusal('Choose Claude Code or Codex')
        const task = await this.source.tasks.addInSpace(space, { title: automation.task.title, brief: automation.task.desc || automation.task.title, kind, model: pick?.model, effort: pick?.effort, automation: run.id })
        this.finish(run, { task: task.id })
        return { task: task.id }
      } catch (error) { this.finish(run, { error: (error as Error).message }); throw error }
      finally { this.busy.delete(automation.id); queueMicrotask(() => { void this.nextQueued() }) }
    })()
    this.active.add(work)
    try { return await work } finally { this.active.delete(work) }
  }
  private enqueue(event: Happened, place: string) {
    if (!this.source.space(place) || this.source.places.removing(place)) return
    this.source.pilots?.wakes.news(event, place)
    for (const automation of this.model.on(event, place)) {
      const own = this.source.space(automation.place), from = this.source.space(place)
      const allowed = automation.trigger.on?.some(rule =>
        (own?.machine === from?.machine || !!rule.space) && matches([{ ...rule, space: rule.space ?? (event.event === 'health' ? undefined : own?.name) }], { ...event, space: event.space ?? from?.name }))
      if (!allowed) continue
      const run: Run = { id: randomUUID(), automation: automation.id, place: automation.place, at: Date.now(), timed: false, state: 'queued' }
      this.source.store.set('automation-run', run.id, run)
    }
  }
  async event(event: Happened, place: string) {
    this.record(event, place)
    return this.nextQueued()
  }
  /** Internal producers can atomically save their observation and its durable rule runs. */
  record(event: Happened, place: string) { this.source.store.db.transaction(() => this.enqueue(event, place))() }
  private nextQueued() { return guarded('Automation queue', () => this.processQueue()) }
  private processQueue(): Promise<void> {
    if (this.processing) return this.processing
    if (this.stopped || this.source.quiescing || !this.source.connected()) return Promise.resolve()
    const work = (async () => {
      for (const run of this.source.store.all<Run>('automation-run').filter(run => run.state === 'queued')) {
        if (this.stopped || this.source.quiescing) return
        if (this.busy.has(run.automation)) continue
        const automation = this.model.list.find(item => item.id === run.automation)
        if (!automation) { this.finish(run, { error: 'Automation removed before this queued event ran' }); continue }
        if (!automation.on || !this.source.space(automation.place) || this.source.places.removing(automation.place)) continue
        // A claim that fails ends this pass: the next would only wait out the same lock.
        const claimed = this.claim(automation, false, run)
        try { await this.launch(automation, claimed) } catch {}
      }
    })()
    this.processing = work.finally(() => { this.processing = undefined })
    return this.processing
  }
  async scan(now = Date.now()) {
    if (this.stopped || this.scanning || this.source.quiescing || !this.source.connected()) return
    this.scanning = true
    try {
      for (const task of this.source.tasks.all()) {
        if (!this.source.space(task.place) || this.source.places.removing(task.place) || task.archived || this.source.tasks.busy(task.id) || !this.source.machineConnected(task.machine)) continue
        const previous = this.source.store.get<Seen>('automation-seen', task.id), view = this.source.tasks.view(task), status = view.status
        const agent = this.source.agents.get(task.chat), terminal = agent && this.source.agents.terminal(agent)
        if (agent && this.source.failedStarts?.pending(agent)) continue
        const attempt = task.launchAttempt ?? agent?.launch
        const failure = task.startError && !['merged', 'closed', 'merging'].includes(task.workflow) ? `start:${attempt ? attempt + ':' : ''}${task.startError}` : task.workflow === 'working' && terminal?.state === 'finished' &&
          (terminal.exit_code != null && terminal.exit_code !== 0 || terminal.signal != null) ? `${agent!.launch}:${terminal.reason}:${terminal.exit_code}:${terminal.signal}` : undefined
        const next: Seen = { at: previous && previous.status !== status ? now : previous?.at, id: task.id, place: task.place, workflow: task.workflow, status, failure, quietLife: previous?.quietLife, overReport: previous?.overReport }
        const events: Exclude<TaskNewsEvent, 'closed'>[] = []
        if (!previous && !task.automation) events.push('added')
        if (previous?.workflow !== task.workflow && task.workflow === 'ready') events.push('ready')
        else if (previous?.workflow !== task.workflow && task.workflow === 'merged') events.push('merged')
        else if (failure && failure !== previous?.failure) events.push('failed')
        else if (previous && previous.status !== status && status === 'need' && !failure) events.push('needs-you')
        let stall: StallCause | undefined
        if (status === 'work' && !view.waitsFor && terminal?.state === 'live' && agent) {
          const life = Math.max(agent.started, agent.activityAt ?? 0, terminal.status_ms ?? 0, task.reportedAt ?? 0)
          if (next.quietLife !== undefined && life > next.quietLife) delete next.quietLife
          const quiet = now - life >= 20 * 60000 && next.quietLife === undefined
          const eta = task.report?.eta, report = task.reportedAt
          const over = eta !== undefined && report !== undefined && report !== next.overReport && now - report > (eta + Math.max(eta, 20)) * 60000
          if (quiet || over) {
            stall = { quietLife: quiet ? life : undefined, overReport: over ? report : undefined }
            if (quiet) next.quietLife = life
            if (over) next.overReport = report
            events.push('stalled')
          }
        }
        this.source.store.db.transaction(() => {
          this.source.store.set('automation-seen', task.id, next)
          for (const event of events) {
            this.enqueue({ event, title: task.name, branch: task.branch, space: this.source.space(task.place)?.name, ...(event === 'ready' ? { detail: `Merge: ${mergeWords(task.mergePolicy)}` } : {}) }, task.place)
            if (event !== 'added' || events.length === 1) this.source.news?.record(task, event, now, stall)
          }
          if (previous?.workflow !== task.workflow && task.workflow === 'closed') this.source.news?.record(task, 'closed', now)
        })()
      }
      this.source.news?.deliver(now)
      void this.nextQueued()
      for (const automation of this.model.dueNow(this.zone())) if (this.source.space(automation.place) && !this.source.places.removing(automation.place) && !this.busy.has(automation.id)) {
        // Outside the launch's guard: a failed claim ends this scan, or each due rule would wait out the same lock in turn.
        const run = this.claim(automation, true)
        void guarded('Automation run', () => this.launch(automation, run))
      }
    } finally { this.scanning = false }
  }
  async act(action: Extract<Action, { type: 'automation' }>) {
    const run = async () => {
      if (!this.source.space(action.place) || this.source.space(action.place)?.home) throw new Refusal('Choose a repository space')
      const automation = this.model.find(action.place, action.name)
      if (!automation) throw new Refusal(`No automation “${action.name}” here`)
      if (this.busy.has(automation.id)) throw new Refusal('This automation is starting a task; wait before changing it')
      if (action.op === 'run') return this.fire(automation)
      if (action.op === 'remove') this.model.remove(action.place, action.name)
      else if (action.op === 'pause' || action.op === 'resume') this.model.pause(action.place, action.name, action.op === 'resume')
      else throw new Refusal('Choose pause, resume, run or remove')
      this.source.emit('snapshot'); return { ok: true }
    }
    return action.cid ? this.source.store.command(action.cid, action, run) : run()
  }
  async cli(agent: CoreAgent, args: string[]) {
    if (agent.role !== 'coordinator') throw new Refusal('Only a coordinator can manage automations')
    const parsed = parseArgs(args.slice(1)), [op = 'list', ...rest] = parsed.words, name = rest.join(' '), requested = one(parsed, 'space')
    const space = requested ? findCoreSpace(this.source, agent.machine, requested) : this.source.space(agent.space)
    if (op === 'list') return this.model.list.filter(item => { const s = this.source.space(item.place); return s?.machine === agent.machine && (!requested || s.id === space?.id) }).map(item => `${item.name} · ${triggerWords(item.trigger, this.zone())} · adds “${item.task.title}”${item.on ? '' : ' · paused'} · ${JSON.stringify(item.runs ?? [])}`).join('\n') || 'No automations.'
    if (!space || space.home) throw new Refusal('Choose a repository space with --space NAME')
    if (!name.trim() || name.length > 120) throw new Refusal('Give the automation a name of at most 120 characters')
    if (op === 'add' || op === 'edit') {
      const was = this.model.find(space.id, name)
      if (was && this.busy.has(was.id)) throw new Refusal('This automation is starting a task; wait before changing it')
      const when = one(parsed, 'when'), on = one(parsed, 'on'), title = one(parsed, 'task'), brief = one(parsed, 'brief')
      if (title !== undefined && (!title.trim() || title.length > TITLE_MAX)) throw new Refusal(`Write a task title of at most ${TITLE_MAX} characters`)
      if (brief && brief.length > 100_000) throw new Refusal('The brief is too long')
      const kind = one(parsed, 'agent'), model = one(parsed, 'model'), effort = one(parsed, 'effort')
      if (kind && !kindOf(kind)) throw new Refusal('Choose Claude Code or Codex')
      const pick: Template['agent'] = kind || model || effort ? { kind, model, effort } : undefined
      if (op === 'add') {
        checked(() => this.model.add({ place: space.id, name, trigger: { ...(when && when !== 'off' ? { time: timeRule(when) } : {}), ...(on ? { on: eventRules(on) } : {}) }, task: { title: title || '', desc: brief, agent: pick } }))
      } else checked(() => this.model.edit(space.id, name, { name: one(parsed, 'name'), time: when === undefined ? undefined : when === 'off' ? 'off' : timeRule(when), on: on === undefined ? undefined : eventRules(on), task: { ...(title !== undefined ? { title } : {}), ...(brief !== undefined ? { desc: brief } : {}), ...(pick ? { agent: pick } : {}) } }))
      this.source.emit('snapshot'); return `Saved: ${one(parsed, 'name') || name}`
    }
    if (!['pause', 'resume', 'run', 'remove'].includes(op)) throw new Refusal('Use automation add|edit|list|pause|resume|run|remove')
    return JSON.stringify(await this.act({ type: 'automation', place: space.id, name, op: op as 'pause' | 'resume' | 'run' | 'remove' }))
  }
  stop() { this.stopped = true; clearInterval(this.timer) }
  async drain() { await this.processing?.catch(() => {}); await Promise.allSettled([...this.active]) }
}
