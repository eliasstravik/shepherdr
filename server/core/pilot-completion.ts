import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'

interface Completion { run: string; place: string; launch: string; at: number; evidence?: string; keepWorkers?: boolean; reason?: string; cause?: string; state: 'pending' | 'changing' | 'done' | 'uncertain'; error?: string }
/** Durable intent precedes revocation. A lost response cannot repeat a regular coordinator launch. */
export class CorePilotCompletion {
  private active?: Promise<void>
  constructor(private source: CoreSource) {}
  busy(place: string) { return this.source.store.all<Completion>('pilot-completion').some(intent => intent.place === place && ['pending', 'changing'].includes(intent.state)) }
  queueReturn(id: string, keepWorkers = false, reason = 'Autopilot off', report?: string) {
    const run = this.source.pilots.policy.get(id)
    if (!run) throw Error('No such Autopilot run')
    const previous = this.source.store.get<Completion>('pilot-completion', id)
    const intent: Completion = previous && ['pending', 'changing'].includes(previous.state) ? { ...previous, keepWorkers: !!previous.keepWorkers && keepWorkers }
      : { run: id, place: run.place, launch: this.source.agents.get(run.place)?.launch || '', at: Date.now(), reason, cause: run.error, keepWorkers, state: 'pending' }
    this.source.store.db.transaction(() => {
      this.source.store.set('pilot-completion', id, intent)
      if (report !== undefined) {
        if (!this.source.store.get<{ text: string }>('pilot-progress', id)?.text) this.source.store.set('pilot-progress', id, { text: `Stopped: ${report}`, at: intent.at })
        run.last = { at: intent.at, reason: 'Stopped by coordinator', outcome: report.slice(0, 160), ended: intent.at }
        this.source.store.set('pilot-run', id, run)
      }
      this.source.pilots.lifecycle.revoke(id, !!intent.keepWorkers)
    })()
    this.source.emit('snapshot')
    return intent
  }
  request(agent: CoreAgent, evidence: string) {
    if (agent.role !== 'coordinator' || !agent.pilot) throw Error('Only this run’s coordinator can finish it')
    const run = this.source.pilots.policy.actor(agent.pilot.run, this.source.pilots.actor(agent))
    if (typeof evidence !== 'string' || !evidence.trim() || Buffer.byteLength(evidence) > 20000) throw Error('Use shepherdr complete "goal evidence"; keep it under 20 KiB')
    this.source.store.db.transaction(() => {
      const at = Date.now(), intent: Completion = { run: run.id, place: run.place, launch: agent.launch, at, evidence: evidence.trim(), state: 'pending' }
      this.source.store.set('pilot-completion', run.id, intent)
      this.source.store.set('pilot-progress', run.id, { text: intent.evidence!, at })
      const stopped = this.source.pilots.lifecycle.revoke(run.id)
      stopped.last = { at, reason: 'Goal complete', outcome: `Finished: ${intent.evidence!.slice(0, 160)}`, ended: at }
      this.source.store.set('pilot-run', run.id, stopped)
    })()
    this.source.emit('snapshot')
    return 'Goal evidence saved. Autopilot is stopping; this chat will return to a regular coordinator.'
  }
  stop(agent: CoreAgent, reason: string) {
    if (agent.role !== 'coordinator' || !agent.pilot) throw Error('Only this run’s coordinator can stop it')
    const run = this.source.pilots.policy.actor(agent.pilot.run, this.source.pilots.actor(agent))
    if (typeof reason !== 'string' || !reason.trim() || Buffer.byteLength(reason) > 20000) throw Error('Use mode regular --why "reason"; keep it under 20 KiB')
    const why = reason.trim()
    // Reuse the durable return intent, preserving cleanup/restart recovery and never claiming goal success.
    this.queueReturn(run.id, false, why, why)
    return 'Stop requested. Autopilot is stopping its owned workers; this chat will return to a regular coordinator.'
  }
  tick() {
    if (this.active || this.source.quiescing) return this.active ?? Promise.resolve()
    this.active = this.process().finally(() => { this.active = undefined })
    return this.active
  }
  private async process() {
    for (const intent of this.source.store.all<Completion>('pilot-completion')) {
      if (this.source.quiescing || !['pending', 'changing'].includes(intent.state)) continue
      const agent = this.source.agents.get(intent.place), current = this.source.pilots.policy.current(intent.place)
      if (current && current.id !== intent.run || agent?.pilot && agent.pilot.run !== intent.run) {
        intent.state = 'uncertain'; intent.error = 'A newer run replaced this completion; it was not stopped'; this.save(intent); continue
      }
      const owner = this.source.pilots.policy.get(intent.run)
      if (agent && !agent.pilot && agent.started >= intent.at && (owner?.state === 'stopped' || intent.keepWorkers && owner?.state === 'workers')) {
        const terminal = this.source.agents.terminal(agent)
        intent.state = terminal ? 'done' : 'uncertain'
        if (!terminal) intent.error = 'Regular coordinator start is unconfirmed; check Terminal before retrying'
        this.save(intent); continue
      }
      if (!this.source.machineConnected(this.source.pilots.policy.get(intent.run)?.machine || '') || this.source.pilots.lifecycle.busy(intent.place)) continue
      intent.state = 'changing'; this.save(intent)
      try {
        await this.source.pilots.lifecycle.regular(intent.place, !!intent.keepWorkers, intent.run)
        intent.state = 'done'; this.save(intent)
      } catch (error) {
        const owner = this.source.pilots.policy.get(intent.run), latest = this.source.agents.get(intent.place)
        const cleanupPending = latest?.pilot?.run === intent.run && (['stopping', 'failed', 'workers'].includes(owner?.state || '') || this.source.quiescing || !this.source.machineConnected(owner?.machine || ''))
        intent.state = cleanupPending ? 'pending' : 'uncertain'; intent.error = `${intent.evidence ? 'Goal evidence is saved; c' : 'C'}oordinator change needs attention: ${(error as Error).message}`; this.save(intent)
      }
    }
  }
  private save(intent: Completion) {
    if (intent.state === 'done' && intent.error) {
      const run = this.source.pilots.policy.get(intent.run)
      if (run?.error === intent.error) {
        if (intent.cause) run.error = intent.cause; else delete run.error
        this.source.store.set('pilot-run', run.id, run)
      }
      delete intent.error
    }
    this.source.store.set('pilot-completion', intent.run, intent)
    if (intent.error) {
      const run = this.source.pilots.policy.get(intent.run)
      if (run) { run.error = intent.error; this.source.store.set('pilot-run', run.id, run) }
    }
    this.source.emit('snapshot')
    if (intent.state === 'done') this.source.retry(intent.place)
  }
  async drain() { await this.active }
}
