import { CLI_NAME } from './settings.ts'
import { PILOT_BLOCKED, type SettingSection } from '../../shared/types.ts'
import { randomUUID } from 'node:crypto'
import type { CoreSource } from './source.ts'
import { matches, eventRules, type Happened } from '../common/trigger.ts'
import type { CorePilotRun } from './pilot-policy.ts'
import type { LogEvent } from '../common/readers/types.ts'

interface Wake { id: string; run: string; launch: string; at: number; reason: string; state: 'waiting' | 'queued' | 'delivered' | 'done' | 'uncertain'; text?: string; sent?: string }
/** A wake is bound to one private coordinator launch; reconnect never repeats an uncertain delivery. */
export class CorePilotWakes {
  constructor(private source: CoreSource) {}
  section(section: SettingSection): SettingSection {
    const place = section.level && this.source.space(section.level)
    if (section.name !== 'Autopilot' || !place) return section
    const run = this.source.pilots.policy.current(place.id) ?? this.source.pilots.policy.all().findLast(item => item.place === place.id)
    const zone = this.source.automations.zone(), next = run?.state === 'on' ? this.source.heartbeats.model.next(place.id, this.source.settings.get('heartbeat.when', place.id), zone) : undefined
    let instructions = ''
    try {
      const config = run?.state === 'on' ? run.config : this.source.settings.pilot(place.id)
      instructions = `Agent: ${CLI_NAME[config.harness.kind]}; reviewer: ${CLI_NAME[config.reviewer.kind]}.\nPermission profile: ${config.access === 'mac' ? 'Mac sandbox' : 'Linux isolated workspace'}. Coordinator reads project files; workers write only their own worktree. Git metadata is read-only; checkpoint through the checked product broker. Project files, including credentials stored there, are readable. ${config.access === 'mac' ? 'Host home and core socket are denied, not hidden; other processes stay visible, and an agent can read their environments, including a secret in use.' : 'Host home and core socket are hidden.'} No unrestricted fallback.\nNetwork: HTTPS to ${config.hosts.join(', ') || 'no hosts'}, measured as encrypted traffic. Application traffic is not inspected.\nAvailable secrets: ${config.secrets.join(', ') || 'none'}. Human approval: ${config.approvals.join(', ') || 'none'}.\nShared HTTPS allowance: ${config.traffic ? config.traffic / 1048576 + ' MiB' : 'off'}. Shared reported tokens: ${config.tokens || 'off'}; delayed, advisory and can overshoot, never a hard spending cap. Runtime: ${config.runtime ? config.runtime / 60000 + ' min' : 'off'}. Parallel tasks: ${config.parallel}. Repository SSH uses the checked account adapter with existing host trust. Host-command callbacks, dynamic account paths and custom Git remote programs require explicit adapters.`
    } catch (error) { instructions = (error as Error).message }
    const blocked = place.mode === 'autopilot' ? undefined : this.source.settings.pilotBlock(place.id)
    return { ...section, rows: [...(blocked ? [{ label: PILOT_BLOCKED, key: '', value: blocked, fixed: true }] : []), { label: 'Heartbeat', key: 'heartbeat.md', value: this.source.heartbeats.read(place), doc: true, instructions }, ...section.rows,
      { label: 'State', key: '', value: this.source.pilots.lifecycle.busy(place.id) || this.source.pilots.completion.busy(place.id) ? 'Changing coordinator; messages wait' : run?.error || (place.mode === 'autopilot' ? 'On' : 'Off'), fixed: true, group: 'Wake-up' },
      { label: 'Time zone', key: '', value: zone, fixed: true, group: 'Wake-up' },
      { label: 'Next', key: '', value: next ? new Date(next).toLocaleString('en-GB', { timeZone: zone }) : 'No scheduled wake', fixed: true, group: 'Wake-up' },
      { label: 'Last run', key: '', value: run?.last ? `${new Date(run.last.at).toLocaleString('en-GB', { timeZone: zone })} · ${run.last.reason} · ${run.last.outcome}` : 'No runs yet', fixed: true, group: 'Wake-up' },
      { label: 'Shared usage', key: '', value: `${run?.used ?? 0} reported tokens`, fixed: true, group: 'Access and limits' },
    ] }
  }
  private current(place: string) {
    const run = this.source.pilots.policy.current(place), agent = this.source.agents.get(place)
    if (!run || run.state !== 'on' || !agent?.pilot || agent.pilot.run !== run.id || !run.actors.some(actor => actor.role === 'coordinator' && actor.chat === place && actor.launch === agent.launch)) throw Error('Autopilot is not on for this space')
    this.source.pilots.policy.live(run.id)
    return { run, agent }
  }
  request(place: string, reason = 'Run now', text?: string) {
    const { run, agent } = this.current(place)
    const old = this.source.store.all<Wake>('pilot-wake').find(item => item.run === run.id && ['waiting', 'queued', 'delivered'].includes(item.state))
    if (old) return { queued: true }
    const wake: Wake = { id: `pilot-wake-${randomUUID()}`, run: run.id, launch: agent.launch, at: Date.now(), reason, state: 'waiting', text }
    this.source.store.set('pilot-wake', wake.id, wake)
    run.last = { at: wake.at, reason, outcome: 'Queued' }; this.source.store.set('pilot-run', run.id, run)
    this.source.emit('snapshot'); return { queued: true }
  }
  news(event: Happened, place: string) {
    const run = this.source.pilots.policy.current(place)
    if (run?.state !== 'on') return
    const line = `${event.event}${event.title ? `: ${event.title}` : ''}${event.branch ? ` (${event.branch})` : ''}${event.detail ? '\n' + event.detail : ''}`.slice(0, 4000)
    if (matches(eventRules(this.source.settings.get('heartbeat.on', place)), event)) {
      // News coalesces while a previous wake is pending; it is included in the next checklist wake.
      this.source.heartbeats.model.hold(place, line)
      this.source.store.set('pilot-news-pending', run.id, true)
      try { this.request(place, 'News') } catch { /* A failed limit leaves the wake stopped; lifecycle cleans up. */ }
    } else this.source.heartbeats.model.hold(place, line)
  }
  private outcome(run: CorePilotRun, wake: Wake, text: string, ended = false) {
    if (run.last?.at === wake.at) { run.last.outcome = text; if (ended) run.last.ended = Date.now(); this.source.store.set('pilot-run', run.id, run) }
    this.source.store.set('pilot-wake', wake.id, wake)
  }
  tick() {
    if (this.source.quiescing) return
    for (const run of this.source.pilots.policy.all()) {
      if (run.state !== 'on') continue
      const space = this.source.space(run.place), agent = this.source.agents.get(run.place)
      if (!space || this.source.pilots.lifecycle.busy(space.id) || !agent || agent.pilot?.run !== run.id) continue
      let valid = true
      try { this.source.pilots.policy.actor(run.id, this.source.pilots.actor(agent)) } catch { valid = false }
      if (!valid) continue
      for (const wake of this.source.store.all<Wake>('pilot-wake').filter(item => item.run === run.id && !['done', 'uncertain'].includes(item.state))) {
        if (wake.launch !== agent.launch) { wake.state = 'uncertain'; this.outcome(run, wake, 'Coordinator replaced; not repeated', true); continue }
        const delivery = this.source.store.get<{ state: string }>('pending-send', wake.id)
        if (wake.state === 'queued' && delivery?.state === 'uncertain') { wake.state = 'uncertain'; this.outcome(run, wake, 'Delivery interrupted; not repeated', true); continue }
        if (wake.state === 'queued' && !delivery) { wake.state = 'delivered'; this.outcome(run, wake, 'Received by agent') }
        if (wake.state === 'delivered') {
          const events = this.source.store.all<LogEvent>(`event:${run.place}`), received = events.findIndex(event => event.kind === 'user' && event.text === wake.sent)
          const end = received >= 0 && events.slice(received + 1).find(event => event.kind === 'turn-end')
          if (end) { wake.state = 'done'; this.outcome(run, wake, 'Finished', true) }
          continue
        }
        if (wake.state !== 'waiting' || agent.state !== 'idle' || this.source.agents.terminal(agent)?.state !== 'live') continue
        this.source.store.db.transaction(() => {
          const text = wake.text || this.source.heartbeats.model.beat(space.id, this.source.heartbeats.role(space))
          this.source.store.delete('pilot-news-pending', run.id)
          if (!text) { wake.state = 'done'; this.outcome(run, wake, 'Skipped: empty heartbeat checklist', true); return }
          wake.sent = `<heartbeat id="${wake.id}">${text}</heartbeat>`
          wake.state = 'queued'; this.source.store.set('pilot-wake', wake.id, wake)
          this.source.saveAndDeliver(space.id, wake.id, wake.sent, () => {}, true)
        })()
      }
      if (this.source.store.get('pilot-news-pending', run.id)) this.request(space.id, 'News')
      if (agent.state === 'idle' && this.source.heartbeats.model.due(space.id, this.source.settings.get('heartbeat.when', space.id), this.source.automations.zone())) this.request(space.id, 'Heartbeat')
    }
  }
}
