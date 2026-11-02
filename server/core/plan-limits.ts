import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CliLimits, CliLimitsRead, MachineLimits } from '../../shared/types.ts'
import type { CoreSource } from './source.ts'
import { guarded } from './guarded.ts'

type Cli = keyof MachineLimits
const CLIS: Cli[] = ['claude', 'codex']
const EVERY = 10 * 60_000

/** Anything that isn't what the helper promises counts as not read: a number on the screen is always one a CLI gave. */
function valid(value: unknown): CliLimits | undefined {
  const limits = value as CliLimits | null | undefined
  if (limits === undefined || limits === null) return undefined
  if (limits.state === 'signed-out' || limits.state === 'no-plan') return { state: limits.state }
  if (limits.state === 'unknown') return { state: 'unknown', why: String(limits.why).slice(0, 120) }
  const windows = limits.state === 'ok' && Array.isArray(limits.windows) ? limits.windows : []
  if (!windows.length || windows.some(window => typeof window.name !== 'string' || !Number.isFinite(window.used) || window.used < 0)) return { state: 'unknown', why: "Couldn't read its answer" }
  return limits
}

/** A read that didn't work keeps the last good numbers, marked by the age they came with: never replaced by a guess. */
export function nextRead(previous: CliLimitsRead | undefined, fresh: CliLimits, at: number): CliLimitsRead {
  if (fresh.state === 'unknown' && previous?.state === 'ok') return { ...previous, failed: fresh.why }
  return { ...fresh, at }
}

/** Bounded stateless reads over core exec, as health's samples are: never a per-machine service, never through an agent. */
export class CorePlanLimits {
  private timer?: ReturnType<typeof setInterval>
  private taking = new Map<string, Promise<void>>()
  private stopped = false
  private readonly script = readFileSync(join(import.meta.dir, '../../helper/core-plan-limits.ts'), 'utf8') + '\nconsole.log(JSON.stringify(await read()))'
  constructor(private source: CoreSource) {}
  private on() { return !this.stopped && !this.source.quiescing && this.source.plugins?.has('limits') !== false }
  start() {
    this.stopped = false
    const refresh = () => { void guarded('Plan limits', () => this.refresh()) }
    this.timer = setInterval(refresh, EVERY)
    refresh()
  }
  view(machine: string): MachineLimits | undefined {
    if (this.source.plugins?.has('limits') === false) return
    return this.source.store.get<MachineLimits>('plan-limits', machine)
  }
  /** fresher: leave a machine read this many ms ago alone. */
  async refresh(fresher = 0) {
    if (!this.on()) return
    for (const machine of this.source.machineIds()) {
      const held = this.source.store.get<MachineLimits>('plan-limits', machine)
      const last = Math.max(0, ...CLIS.map(cli => held?.[cli]?.at ?? 0))
      if (this.taking.has(machine) || !this.source.machineConnected(machine) || (fresher && Date.now() - last < fresher)) continue
      const work = this.take(machine).catch(() => {}).finally(() => this.taking.delete(machine))
      this.taking.set(machine, work)
    }
    await Promise.allSettled([...this.taking.values()])
  }
  private async take(machine: string) {
    let found: Partial<Record<Cli, unknown>> | undefined
    try {
      found = JSON.parse((await this.source.files.exec(machine, [await this.source.agents.bun(machine), '-e', this.script], undefined, undefined, 90)).toString('utf8'))
    } catch {}
    if (!this.on()) return
    const held = this.source.store.get<MachineLimits>('plan-limits', machine), at = Date.now(), next: MachineLimits = {}
    const lost: CliLimits = { state: 'unknown', why: "Couldn't reach this machine's CLIs" }
    for (const cli of CLIS) {
      const fresh = found ? valid(found[cli]) : held && !held[cli] ? undefined : lost
      if (fresh) next[cli] = nextRead(held?.[cli], fresh, at)
    }
    this.source.store.set('plan-limits', machine, next)
    this.source.emit('snapshot')
  }
  stop() { this.stopped = true; clearInterval(this.timer) }
  async drain() { await Promise.allSettled([...this.taking.values()]) }
}
