import { machineName } from '../../shared/types.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { busy, judge, levels, meters, type Kind, type Sample, type Watch } from '../health.ts'
import type { MachineHealth } from '../../shared/types.ts'
import type { CoreSource } from './source.ts'
import { guarded } from './guarded.ts'

/** Bounded stateless sampling over core exec, never a per-machine service. */
export class CoreHealth {
  private timer?: ReturnType<typeof setInterval>
  private taking = new Map<string, Promise<void>>()
  private stopped = false
  private readonly script = readFileSync(join(import.meta.dir, '../../helper/core-health.ts'), 'utf8') + '\nconsole.log(JSON.stringify(await sample()))'
  constructor(private source: CoreSource) {}
  start() {
    this.stopped = false
    const refresh = () => { void guarded('Health sample', () => this.refresh()) }
    this.timer = setInterval(refresh, 30_000)
    refresh()
  }
  private active(task: ReturnType<CoreSource['tasks']['all']>[number]) {
    if (task.archived) return false
    const main = this.source.agents.get(task.chat), terminal = main && this.source.agents.terminal(main)
    if (task.pilot && main && terminal?.state !== 'finished' &&
      (terminal ? this.source.status(main) === 'work' : ['starting', 'working', 'blocked'].includes(main.state))) return true
    // Workflow remains Working when a native turn needs a human. Count current
    // activity, not that durable workflow label; unknown captures stay conservative.
    if (task.workflow === 'working' && !task.startError && terminal?.state !== 'finished' &&
      (!main || !terminal || this.source.tasks.view(task).status === 'work')) return true
    if (task.reservedAt && Date.now() - task.reservedAt < 60_000) return true
    return (task.reservedChats ?? []).some(chat => {
      const agent = this.source.agents.get(chat)
      return !!agent && this.source.agents.terminal(agent)?.state === 'live' && this.source.status(agent) === 'work'
    })
  }
  working(machine: string) { return this.source.tasks.all().filter(task => task.machine === machine && this.active(task)).length }
  room(machine: string, exclude?: string): string | undefined {
    const task = exclude ? this.source.tasks.get(exclude) : undefined
    if (task?.pilot) {
      let run
      try { run = this.source.pilots.policy.live(task.pilot) } catch (error) { return (error as Error).message }
      const active = this.source.tasks.all().filter(other => other.id !== exclude && other.pilot === run.id && this.active(other)).length
      if (active >= run.config.parallel) return `${active} Autopilot tasks are working (limit ${run.config.parallel})`
    }
    if (!this.source.machineConnected(machine)) return 'its machine is reconnecting'
    const sample = this.source.store.get<Sample>('health-sample', machine), limits = this.source.settings.machineLimits(machine)
    if (this.source.plugins?.has('health') !== false && (!sample || Date.now() - sample.at > 90_000)) return 'checking its machine’s health'
    const pressure = sample && this.source.plugins?.has('health') !== false && busy(sample, limits)
    if (pressure) return pressure === 'cpu' ? 'CPU load is over its start limit' : 'memory is over its start limit'
    const working = this.source.tasks.all().filter(task => task.id !== exclude && task.machine === machine && this.active(task)).length
    if (limits.max !== null && working >= limits.max) return `${working} tasks are working (limit ${limits.max})`
  }
  view(machine: string): MachineHealth | undefined {
    if (this.source.plugins?.has('health') === false) return
    const sample = this.source.store.get<Sample>('health-sample', machine)
    if (!sample) return
    const limits = this.source.settings.machineLimits(machine), watch = this.source.store.get<Partial<Record<Kind, Watch>>>('health-watch', machine) ?? {}
    const held = this.source.tasks.all().filter(task => task.machine === machine && task.workflow === 'queued' && task.capacity)
    return { engine: 'core', meters: meters(sample, limits, watch), herdr: this.source.machineConnected(machine), working: this.working(machine), max: limits.max ?? undefined, held: held.length, heldWhy: held.length ? this.room(machine) : undefined, at: new Date(sample.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: this.source.automations.zone() }) }
  }
  async refresh() {
    if (this.stopped || this.source.quiescing || this.source.plugins?.has('health') === false) return
    for (const machine of this.source.machineIds()) if (!this.taking.has(machine)) {
      const work = this.take(machine).catch(() => {}).finally(() => this.taking.delete(machine))
      this.taking.set(machine, work)
    }
    await Promise.allSettled([...this.taking.values()])
  }
  private async take(machine: string) {
    let sample = this.source.store.get<Sample>('health-sample', machine)
    if (this.source.machineConnected(machine)) {
      const bytes = await this.source.files.exec(machine, [await this.source.agents.bun(machine), '-e', this.script], undefined, undefined, 15)
      const fresh = JSON.parse(bytes.toString('utf8')) as Sample
      if (!Number.isFinite(fresh.cores) || fresh.cores < 1 || !Number.isFinite(fresh.load) || !Number.isFinite(fresh.memTotal) || fresh.memTotal <= 0 || !Number.isFinite(fresh.memUsed) || !Array.isArray(fresh.disks) || !Array.isArray(fresh.gpus)) throw Error('Machine returned an invalid health sample')
      sample = { ...fresh, at: Date.now() }
      this.source.store.set('health-sample', machine, sample)
    }
    if (!sample || this.stopped || this.source.quiescing || this.source.plugins?.has('health') === false) return
    const watch = this.source.store.get<Partial<Record<Kind, Watch>>>('health-watch', machine) ?? {}
    const { next, events } = judge(watch, levels(sample, this.source.machineConnected(machine), this.source.settings.machineLimits(machine)), Date.now())
    this.source.store.set('health-watch', machine, next)
    const home = this.source.spaces().find(space => space.machine === machine && space.home)
    if (home) for (const event of events) {
      const text = `${event.kind === 'herdr' ? 'core' : event.kind === 'cpu' ? 'CPU' : event.kind[0].toUpperCase() + event.kind.slice(1)} ${event.what === 'over' ? 'crossed its alert limit' : 'is back under its limit'}`
      const id = `health-${machine}-${event.kind}-${Date.now()}`
      this.source.post(home.id, { id, who: 'agent', at: Date.now(), card: { id, text, status: event.what === 'over' ? 'need' : 'work', health: { level: event.what === 'over' ? 'over' : 'ok', machine: machineName(this.source.snapshot().machines, machine) } } })
      const agent = this.source.agents.get(home.id)
      if (agent && this.source.agents.terminal(agent)?.state === 'live') this.source.saveAndDeliver(home.id, id + '-news', `<health>${text}. Current meters: ${JSON.stringify(meters(sample, this.source.settings.machineLimits(machine), next))}. Inspect the machine before changing tasks.</health>`, () => {}, true)
      await this.source.automations.event({ event: 'health' }, home.id)
    }
    this.source.emit('snapshot')
    void this.source.tasks.tick().catch(() => {})
    this.source.retryPending()
  }
  stop() { this.stopped = true; clearInterval(this.timer) }
  async drain() { await Promise.allSettled([...this.taking.values()]) }
}
