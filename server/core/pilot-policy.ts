import { randomUUID } from 'node:crypto'
import type { CoreStore } from './store.ts'
import type { AgentKind } from './model.ts'
import { Refusal } from './client.ts'
import type { PilotAccess } from '../../helper/core-pilot-mac.ts'

/** The permission profiles as the human reads them in Settings. */
export const PILOT_ACCESS: Record<PilotAccess, string> = { isolated: 'Isolated workspace', mac: 'Mac sandbox', 'mac-ports': 'Mac sandbox with local ports' }
export interface PilotHarness { kind: AgentKind; model?: string; effort?: string; speed?: string }
export interface CorePilotConfig {
  harness: PilotHarness
  reviewer: PilotHarness
  hosts: string[]
  secrets: string[]
  approvals: string[]
  /** Absent in runs saved before the Mac profile, which were all Isolated workspace. */
  access?: PilotAccess
  parallel: number
  traffic?: number
  tokens?: number
  runtime?: number
}
export interface PilotActor { chat: string; launch: string; role: 'coordinator' | 'task' | 'reviewer'; task?: string }
export interface CorePilotRun {
  id: string
  place: string
  machine: string
  started: number
  state: 'starting' | 'on' | 'workers' | 'stopping' | 'stopped' | 'failed'
  config: CorePilotConfig
  tasks: string[]
  actors: PilotActor[]
  traffic: number
  used: number
  error?: string
  last?: { at: number; reason: string; outcome: string; ended?: number }
}
export function pilotHosts(input: string[]) {
  if (!Array.isArray(input) || input.length > 128 || input.some(host => typeof host !== 'string' || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host))) throw new Refusal('Use exact public HTTPS host names, without URLs, wildcards or local addresses')
  if (input.some(host => /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$|\.home\.arpa$/i.test(host))) throw new Refusal('Private and reserved network hosts are outside the isolated permission profile')
  return [...new Set(input.map(host => host.toLowerCase()))]
}
function configuration(input: CorePilotConfig): CorePilotConfig {
  const harness = (value: PilotHarness) => {
    if (!value || !['claude', 'codex'].includes(value.kind) || [value.model, value.effort].some(word => word !== undefined && (typeof word !== 'string' || word.length > 512))) throw new Refusal('Choose Claude Code or Codex and its model/effort')
    return { kind: value.kind, model: value.model, effort: value.effort }
  }
  if (!input || !Number.isSafeInteger(input.parallel) || input.parallel < 1 || input.parallel > 200) throw new Refusal('Choose 1 to 200 parallel tasks')
  for (const [key, max] of [['traffic', 1_000_000 * 1_048_576], ['tokens', 1_000_000_000], ['runtime', 10080 * 60_000]] as const) {
    const value = input[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > max)) throw new Refusal(`Invalid shared ${key} allowance`)
  }
  if (!Array.isArray(input.secrets) || input.secrets.length > 128 || input.secrets.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))) throw new Refusal('List available secrets by environment name')
  if (!Array.isArray(input.approvals) || input.approvals.some(value => value !== 'merge')) throw new Refusal('Human approval can require merge, or none')
  if (input.access !== undefined && !['isolated', 'mac', 'mac-ports'].includes(input.access)) throw new Refusal('Choose an offered permission profile')
  return { access: input.access, harness: harness(input.harness), reviewer: harness(input.reviewer), hosts: pilotHosts(input.hosts), secrets: [...new Set(input.secrets)], approvals: [...new Set(input.approvals)],
    parallel: input.parallel, traffic: input.traffic, tokens: input.tokens, runtime: input.runtime }
}

/** App-private ownership and accounting. Callers supply authenticated actors, never an actor from a request body. */
export class CorePilotPolicy {
  constructor(private store: CoreStore) {}
  all() { return this.store.all<CorePilotRun>('pilot-run') }
  get(id: string) { return this.store.get<CorePilotRun>('pilot-run', id) }
  current(place: string) { return this.all().findLast(run => run.place === place && ['starting', 'on', 'stopping', 'failed'].includes(run.state)) }
  private save(run: CorePilotRun) { this.store.set('pilot-run', run.id, run); return run }
  begin(place: string, machine: string, config: CorePilotConfig, now = Date.now()) {
    if (!place || !machine || !Number.isSafeInteger(now) || now < 0) throw new Refusal('Invalid Autopilot start')
    if (this.current(place)) throw new Refusal('This space already has an Autopilot run; stop it before replacing it')
    return this.save({ id: randomUUID(), place, machine, config: configuration(config), started: now, state: 'starting', tasks: [], actors: [], traffic: 0, used: 0 })
  }
  private require(id: string) { return this.get(id) ?? (() => { throw new Refusal('No such Autopilot run') })() }
  activate(id: string, actor: PilotActor) {
    const run = this.require(id)
    if (run.state !== 'starting' || actor.role !== 'coordinator' || actor.chat !== run.place || actor.task || !actor.launch) throw new Refusal('This run is not waiting for that coordinator')
    run.actors = [{ ...actor }]; run.state = 'on'; return this.save(run)
  }
  detachCoordinator(id: string) {
    const run = this.live(id)
    if (run.state !== 'on') throw new Refusal('Only an active Autopilot coordinator can restart')
    run.actors = run.actors.filter(actor => actor.role !== 'coordinator')
    run.error = 'Coordinator restart in progress; workers remain contained'
    return this.save(run)
  }
  replaceCoordinator(id: string, actor: PilotActor, harness: PilotHarness) {
    const run = this.live(id)
    if (run.state !== 'on' || actor.role !== 'coordinator' || actor.chat !== run.place || actor.task || !actor.launch) throw new Refusal('This run is not waiting for that coordinator')
    run.config = configuration({ ...run.config, harness })
    run.actors = [...run.actors.filter(old => old.role !== 'coordinator'), { ...actor }]
    delete run.error; return this.save(run)
  }
  claim(id: string, task: string, active: number, now = Date.now()) {
    const run = this.require(id)
    this.check(run, now)
    if (run.state !== 'on') throw new Refusal('Autopilot is not accepting new tasks')
    if (run.tasks.includes(task)) return run // Product retry; no second slot is consumed.
    if (!task || !Number.isSafeInteger(active) || active < 0 || active >= run.config.parallel) throw new Refusal('Autopilot is at its maximum parallel tasks; wait for one to finish')
    run.tasks.push(task); return this.save(run)
  }
  bind(id: string, actor: PilotActor) {
    const run = this.require(id)
    if (!['starting', 'on', 'workers'].includes(run.state) || !actor.chat || !actor.launch || !actor.task || !run.tasks.includes(actor.task) || !['task', 'reviewer'].includes(actor.role)) throw new Refusal('This run does not own that agent')
    // A restarted chat replaces its own earlier binding. Other run members survive.
    run.actors = [...run.actors.filter(old => old.chat !== actor.chat), { ...actor }]; return this.save(run)
  }
  actor(id: string, actor: PilotActor, now = Date.now()) {
    const run = this.require(id)
    if (!run.actors.some(saved => saved.chat === actor.chat && saved.launch === actor.launch && saved.role === actor.role && saved.task === actor.task)) throw new Refusal('This agent session does not belong to that Autopilot run')
    this.check(run, now)
    if (run.state === 'workers' && actor.role === 'coordinator') throw new Refusal('This Autopilot coordinator is stopped')
    return run
  }
  live(id: string, now = Date.now()) { const run = this.require(id); this.check(run, now); return run }
  private check(run: CorePilotRun, now: number) {
    if (!['on', 'workers'].includes(run.state)) throw new Refusal(run.error || 'Autopilot is stopped')
    const why = run.config.runtime && now - run.started >= run.config.runtime ? 'Autopilot reached its shared runtime limit'
      : run.config.traffic && run.traffic >= run.config.traffic ? 'Autopilot reached its shared HTTPS allowance'
      : run.config.tokens && run.used >= run.config.tokens ? 'Autopilot reached its shared reported token allowance' : undefined
    if (why) { run.state = 'failed'; run.error = why; this.save(run); throw new Refusal(why) }
  }
  traffic(id: string, actor: PilotActor, bytes: number, now = Date.now()) {
    const run = this.actor(id, actor, now)
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 256 * 1024 || !Number.isSafeInteger(run.traffic + bytes)) throw new Refusal('Invalid HTTPS traffic reservation')
    if (run.config.traffic && bytes > run.config.traffic - run.traffic) {
      run.state = 'failed'; run.error = 'Autopilot reached its shared HTTPS allowance'; this.save(run); throw new Refusal(run.error)
    }
    run.traffic += bytes; return this.save(run).traffic
  }
  /** Reader event counters can increase, repeat and arrive late. Persist only the positive delta. */
  usage(id: string, identity: string, tokens: number) {
    const run = this.require(id)
    if (!identity || identity.length > 1024 || !Number.isSafeInteger(tokens) || tokens < 0) throw new Refusal('Invalid reported token observation')
    return this.store.db.transaction(() => {
      const old = this.store.get<number>(`pilot-usage:${id}`, identity) ?? 0
      if (tokens <= old) return run.used
      if (!Number.isSafeInteger(run.used + tokens - old)) throw new Refusal('Reported token total is too large')
      run.used += tokens - old; this.store.set(`pilot-usage:${id}`, identity, tokens); this.save(run)
      return run.used
    })()
  }
  stop(id: string, keepWorkers = false) {
    const run = this.require(id)
    // A delayed/repeated stop must never loosen an earlier decision or revive authority.
    if (['stopped', 'stopping', 'failed'].includes(run.state) || run.state === 'workers' && keepWorkers) return run
    const retain = keepWorkers && run.state === 'on'
    run.state = retain ? 'workers' : 'stopping'
    if (retain) run.actors = run.actors.filter(actor => actor.role !== 'coordinator')
    return this.save(run)
  }
  stopped(id: string) {
    const run = this.require(id)
    if (!['stopping', 'failed', 'stopped'].includes(run.state)) throw new Refusal('Stop this run before confirming cleanup')
    run.state = 'stopped'; return this.save(run)
  }
  fail(id: string, reason: string) {
    const run = this.require(id)
    if (run.state === 'stopped') return run
    run.state = 'failed'; run.error = String(reason).slice(0, 2000); return this.save(run)
  }
  owns(id: string, task: string) { return !!this.get(id)?.tasks.includes(task) }
  command(id: string, actor: PilotActor, args: string[], now = Date.now()) {
    const run = this.actor(id, actor, now)
    if (!Array.isArray(args) || args.length > 256 || args.some(word => typeof word !== 'string' || word.length > 65536)) throw new Refusal('Invalid command words')
    const [command, op] = args
    if (['help', 'show', 'models', 'progress'].includes(command)) return run
    if (command === 'mode' && op === 'regular' && actor.role === 'coordinator' && run.state === 'on') return run
    if (command === 'heartbeat' && !op || command === 'complete' && actor.role === 'coordinator' || command === 'checkpoint' && actor.role === 'task') return run
    if (command === 'secret' && ['list', 'ask', 'run', 'env'].includes(op)) return run // Secret names are separately checked against the run snapshot.
    if (command === 'task' && ['list', 'show', 'chat'].includes(op)) return run
    if (command === 'task' && ['delete', 'archive', 'unarchive', 'pin', 'unpin'].includes(op) && actor.role === 'coordinator') return run
    if (command === 'task' && op === 'add' && actor.role === 'coordinator' && run.state === 'on') return run
    if (command === 'task' && op === 'start' && actor.role === 'coordinator' && run.state === 'on') return run
    if (command === 'task' && op === 'review-more' && actor.role === 'coordinator') return run // CoreTasks refuses any other role too.
    if (command === 'task' && ['tell', 'stop', 'pause', 'queue', 'edit', 'close'].includes(op) && actor.role !== 'reviewer') return run // Target must separately pass owns().
    if (['status', 'ready', 'todo', 'pr', 'checks', 'review'].includes(command) && actor.role !== 'reviewer') return run
    if (command === 'merge' || command === 'task' && op === 'merge') {
      if (actor.role !== 'reviewer') return run // Exact-head approval remains enforced by CoreTasks, plus the run's merge policy.
    }
    if (['ask', 'plan', 'alert'].includes(command)) return run
    if (command === 'artifact' && ['list', 'show'].includes(op)) return run
    if (command === 'artifact' && ['new', 'update', 'check', 'rm', 'remove', 'delete'].includes(op) && actor.role !== 'reviewer') return run
    throw new Refusal('This action needs the human; the isolated permission profile does not allow it')
  }
}
