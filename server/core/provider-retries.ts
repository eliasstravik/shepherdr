import { providerError, PROVIDER_WAITS } from '../common/provider-error.ts'
import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'

export interface ProviderRetry { chat: string; launch: string; cut: string; tries: number; reason: string; due?: number; nudged?: number; over?: boolean; notified?: boolean }
/** Native ended-turn failures only. Intent and send receipts survive application restart. */
export class CoreProviderRetries {
  private running = false
  constructor(private source: CoreSource) {}
  get(agent: CoreAgent) {
    const row = this.source.store.get<ProviderRetry>('provider-retry', agent.chat)
    return row?.launch === agent.launch ? row : undefined
  }
  clear(chat: string) {
    const row = this.source.store.get<ProviderRetry>('provider-retry', chat)
    if (!row) return
    this.source.store.set('provider-ignored', chat, { launch: row.launch, cut: row.cut })
    this.source.store.delete('provider-retry', chat)
    const id = `provider-retry-${row.launch}-${row.cut}-${row.tries}`
    const pending = this.source.store.get<{ state: string }>('pending-send', id)
    if (pending?.state === 'queued') this.source.store.delete('pending-send', id)
    this.source.emit('snapshot')
  }
  private eligible(agent: CoreAgent) {
    const task = this.source.tasks.forChat(agent.chat)
    const terminal = this.source.agents.terminal(agent)
    return agent.role !== 'reviewer' && (!task || task.chat === agent.chat && task.workflow === 'working' && !task.archived && !this.source.tasks.busy(task.id)) &&
      !!this.source.space(agent.space) && !this.source.places.removing(agent.space) && this.source.machineConnected(agent.machine) &&
      terminal?.state === 'live' && (agent.pid === undefined || terminal.pid === agent.pid) && !this.source.openPermissions(agent).length &&
      !this.source.questions.open(agent.chat).length && !this.source.secrets.open(agent.chat).length &&
      !this.source.pilots.lifecycle.busy(agent.space) && !this.source.pilots.completion.busy(agent.space)
  }
  async tick(now = Date.now()) {
    if (this.running || this.source.quiescing || !this.source.connected()) return
    this.running = true
    try {
      for (const agent of this.source.agents.all()) {
        if (!this.eligible(agent)) continue
        // Snapshot must be caught up and ended, without outstanding native background work.
        const turn = this.source.logs.providerTurn(agent)
        if (!turn.complete) continue
        // Native Claude also reports provider auth failures as blocked. A caught-up, ended
        // provider error can recover; blocked without that evidence still waits for the human.
        if (this.source.agents.terminal(agent)?.status?.state === 'blocked' && !turn.cut) continue
        let row = this.get(agent)
        if (!turn.cut) { if (row) this.clear(agent.chat); continue }
        const ignored = this.source.store.get<{ launch: string; cut: string }>('provider-ignored', agent.chat)
        if (ignored?.launch === agent.launch && ignored.cut === turn.cut.id) continue
        if (row?.cut !== turn.cut.id) {
          const failure = providerError(turn.cut.text, turn.cut.code, turn.cut.status)
          const tries = (row?.tries ?? 0) + 1, wait = failure.passing && PROVIDER_WAITS[tries - 1]
          row = { chat: agent.chat, launch: agent.launch, cut: turn.cut.id, tries,
            reason: failure.passing && !wait ? `${failure.reason}, still after ${tries} tries` : failure.reason,
            ...(wait ? { due: now + wait } : { over: true }) }
          this.source.store.set('provider-retry', agent.chat, row); this.source.emit('snapshot')
        }
        if (row.over && !row.notified) {
          // Takeover itself records its durable one-shot intent before replacing any process.
          const task = this.source.tasks.forChat(agent.chat)
          let taken = false, error: string | undefined
          try { if (task && !agent.pilot) taken = await this.source.tasks.providerFallback(task.id, agent.launch, row.reason) }
          catch (failure) { error = (failure as Error).message }
          if (!taken) {
            const id = `provider-error-${agent.launch}-${row.cut}`
            this.source.post(agent.chat, { id, who: 'agent', card: { id, text: `Cut off by its provider: ${row.reason}. ${error ? 'The backup could not start. ' : ''}Write to carry on or restart the agent.` }, at: now })
            this.source.emit('alert', { id, from: 'Shepherdr', title: row.reason, body: error ? 'The backup could not start. Open the task to review its state.' : 'Write to carry on or restart the agent.', go: { place: agent.space, ...(task ? { task: task.id } : {}), focus: id }, ...(task ? { task: true } : {}) })
          }
          row.notified = true; this.source.store.set('provider-retry', agent.chat, row)
        }
        if (row.due !== undefined && row.due <= now) {
          const id = `provider-retry-${row.launch}-${row.cut}-${row.tries}`
          this.source.saveAndDeliver(agent.chat, id, `<shepherdr><provider-retry>Your last turn was cut off by the model's provider (${row.reason.toLowerCase()}). Carry on where you left off within your existing authorization.</provider-retry></shepherdr>`, () => {
            row!.nudged = now; delete row!.due; this.source.store.set('provider-retry', agent.chat, row!)
          }, true)
        }
      }
    } finally { this.running = false }
  }
}
