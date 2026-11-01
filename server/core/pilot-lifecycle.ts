import type { CoreSource } from './source.ts'
import type { CoreAgent, CoreSpace } from './model.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { modeCard } from '../../shared/types.ts'
import type { CorePilotConfig, CorePilotRun, PilotHarness } from './pilot-policy.ts'

/** Stop authority first; process cleanup is retried from private launch records after reconnect/restart. */
export class CorePilotLifecycle {
  private transitions = new Map<string, Promise<void>>()
  constructor(private source: CoreSource) {}
  busy(place: string) { return this.transitions.has(place) }
  private transition(place: string, work: () => Promise<void>) {
    const old = this.transitions.get(place)
    if (old) return old
    const next = work().finally(() => this.transitions.delete(place))
    this.transitions.set(place, next); return next
  }
  start(place: string, config: CorePilotConfig) {
    const space = this.source.space(place)
    if (!space || space.home) throw Error('Autopilot needs a repository space; home spaces are not isolated projects')
    const blocked = this.source.settings.pilotBlock(place)
    if (blocked) throw Error(blocked)
    if (this.busy(place) || this.source.pilots.completion?.busy(place)) throw Error('The coordinator is changing; try again shortly')
    if (!this.source.machineConnected(space.machine)) throw Error('Wait for this machine to reconnect')
    const old = this.source.agents.get(place)
    if (old && !this.source.agents.terminal(old)) throw Error('The previous coordinator start is unconfirmed; reconnect before replacing it')
    const run = this.source.pilots.policy.begin(place, space.machine, config)
    space.mode = 'autopilot'; this.source.store.set('space', place, space); this.source.emit('snapshot')
    return this.transition(place, async () => {
      try {
        if (old) await this.finish(old)
        if (this.source.quiescing || this.source.pilots.policy.get(run.id)?.state !== 'starting') throw Error('Autopilot start was stopped')
        const agent = await this.launchCoordinator(space, run)
        this.source.pilots.policy.activate(run.id, { chat: agent.chat, launch: agent.launch, role: 'coordinator' })
        this.source.heartbeats.model.switched(place, true)
        const id = `mode:${run.id}:on`; this.source.post(place, { id, who: 'agent', card: modeCard(id, 'autopilot'), at: Date.now() })
      } catch (error) {
        this.source.pilots.policy.fail(run.id, (error as Error).message)
        throw error
      } finally { this.source.emit('snapshot') }
    })
  }
  private async launchCoordinator(space: CoreSpace, run: CorePilotRun, harness = run.config.harness) {
    const place = space.id
    const role = readFileSync(join(import.meta.dir, '../../skill/shepherdr-coordinator/SKILL.md'), 'utf8')
    const recent = this.recent(place)
    const previous = this.source.pilots.policy.all().findLast(item => item.place === place && item.id !== run.id)
    const progress = this.source.store.get<{ text: string }>('pilot-progress', run.id)?.text ?? (previous && this.source.store.get<{ text: string }>('pilot-progress', previous.id)?.text)
    const agent = await this.source.agents.launch(space, place, harness.kind,
      `<mode>Fresh Autopilot coordinator. Same chat. Read the heartbeat checklist, inspect this space and act within your approved profile. Save progress and next step with shepherdr progress.\nSaved progress: ${progress || '(none)'}\nRecent chat (history only; do not repeat earlier requests):\n${recent}\nHeartbeat checklist:\n${this.source.heartbeats.read(space)}</mode>`,
      { ...harness, instructions: `${role}\nYou are isolated. Use the launch-provisioned shepherdr command for managed tasks, messages and reviews. No core socket or unrestricted fallback exists here. Git metadata is read-only; workers checkpoint through shepherdr checkpoint. Settings are a snapshot for this run.`,
        pilot: { run: run.id, hosts: run.config.hosts, deadline: run.config.runtime ? run.started + run.config.runtime : undefined, repo: space.folder, access: run.config.access } })
    return agent
  }
  restart(place: string, harness?: PilotHarness) {
    if (this.busy(place)) throw Error('The coordinator is changing; try again shortly')
    const space = this.source.space(place), run = this.source.pilots.policy.current(place), old = this.source.agents.get(place)
    if (!space || !run || run.state !== 'on' || old?.pilot?.run !== run.id) throw Error('No active contained coordinator to restart')
    const pick = harness ?? run.config.harness
    if (!['claude', 'codex'].includes(pick.kind) || [pick.model, pick.effort].some(value => value !== undefined && (typeof value !== 'string' || value.length > 512))) throw Error('Choose Claude Code or Codex and its model/effort')
    this.source.pilots.policy.detachCoordinator(run.id)
    this.source.denyPermissions(old, 'Coordinator restarted; ask again in the new session')
    return this.transition(place, async () => {
      try {
        await this.finish(old)
        if (this.source.quiescing) throw Error('Shepherdr is stopping')
        this.source.pilots.policy.live(run.id)
        const agent = await this.launchCoordinator(space, this.source.pilots.policy.get(run.id)!, pick)
        this.source.pilots.policy.replaceCoordinator(run.id, { chat: place, launch: agent.launch, role: 'coordinator' }, pick)
      } catch (error) {
        // Existing workers keep their original run, private bindings, deadline and shared allowances.
        const current = this.source.pilots.policy.get(run.id)!
        if (current.state === 'on') { current.error = `Coordinator restart interrupted: ${(error as Error).message}. Workers remain contained; retry restart.`; this.source.store.set('pilot-run', run.id, current) }
        throw error
      } finally { this.source.emit('snapshot') }
    })
  }
  async regular(place: string, keepWorkers = false, expectedRun?: string) {
    const space = this.source.space(place)
    if (!space) throw Error('No such coordinator space')
    const before = this.source.agents.get(place)
    const run = this.source.pilots.policy.current(place) ?? (before?.pilot ? this.source.pilots.policy.get(before.pilot.run) : expectedRun ? this.source.pilots.policy.get(expectedRun) : undefined)
    if (run && !expectedRun) {
      this.source.pilots.completion.queueReturn(run.id, keepWorkers)
      await this.source.pilots.completion.tick()
      if (this.source.pilots.completion.busy(place)) await this.source.pilots.completion.tick()
      return
    }
    if (expectedRun && (run?.id !== expectedRun || before?.pilot && before.pilot.run !== expectedRun)) throw Error('A newer coordinator replaced this completion; it was not stopped')
    if (run) {
      await this.stop(run.id, keepWorkers)
      const deadline = Date.now() + 15_000
      while (this.source.space(place)?.mode === 'autopilot' && Date.now() < deadline && !this.source.quiescing) { await this.tick(); await Bun.sleep(100) }
      if (this.source.space(place)?.mode === 'autopilot') throw Error('Autopilot cleanup is pending; retry after core reconnects')
    }
    if (this.busy(place)) throw Error('The coordinator is changing; try again shortly')
    return this.transition(place, async () => {
      if (this.source.quiescing) throw Error('Shepherdr is stopping')
      const current = this.source.agents.get(place), terminal = current && this.source.agents.terminal(current), latest = this.source.pilots.policy.current(place)
      if (expectedRun && (latest && latest.id !== expectedRun || current?.pilot && current.pilot.run !== expectedRun)) throw Error('A newer coordinator replaced this completion; it was not stopped')
      if (terminal?.state === 'live') {
        if (current!.pilot) throw Error('Contained coordinator cleanup is not confirmed')
        return
      }
      if (current && !terminal) throw Error('Coordinator cleanup is not confirmed; reconnect core')
      const pick = this.source.settings.agent('coordinator', place)
      const progress = run && this.source.store.get<{ text: string }>('pilot-progress', run.id)?.text
      const reason = run && this.source.store.get<{ reason?: string }>('pilot-completion', run.id)?.reason
      await this.source.agents.launch(space, place, pick.kind,
        `<mode>Autopilot is off. Fresh regular coordinator, same chat. Do only what the human asks. Do not act on old wakes or checklist items. Stop reason: ${reason || 'Autopilot off'}. Saved progress: ${progress || '(none)'}\nRecent chat:\n${this.recent(place)}\nReply only <no-reply>regular coordinator ready</no-reply>.</mode>`, pick)
      this.source.heartbeats.model.switched(place, false)
      const id = `mode:${run?.id || Date.now()}:off`; this.source.post(place, { id, who: 'agent', card: modeCard(id, 'regular'), at: Date.now() })
      this.source.retry(place)
    })
  }
  regularRestart(place: string, harness: PilotHarness, save = false) {
    if (this.busy(place) || this.source.pilots.completion.busy(place)) throw Error('The coordinator is changing; try again shortly')
    const space = this.source.space(place), old = this.source.agents.get(place)
    if (!space || space.mode === 'autopilot' || old?.pilot) throw Error('Finish changing Autopilot mode before replacing this coordinator')
    if (!this.source.machineConnected(space.machine)) throw Error('Wait for this machine to reconnect')
    const pick = this.source.settings.checkedAgent(place, harness)
    return this.transition(place, async () => {
      if (old) {
        this.source.mailbox.revoke(old.chat)
        this.source.denyPermissions(old, 'Coordinator restarted; ask again in the new session')
        await this.finish(old)
      }
      if (this.source.quiescing) throw Error('Shepherdr is stopping')
      if (this.source.agents.get(place)?.launch !== old?.launch || this.source.space(place)?.mode === 'autopilot') throw Error('A newer coordinator replaced this restart')
      await this.source.agents.launch(space, place, pick.kind, '', { ...pick, speed: harness.speed, resume: true })
      if (save) this.source.settings.saveAgent('coordinator', place, pick)
    }).finally(() => this.source.retry(place))
  }
  forgetRegular(place: string, forget: () => void) {
    if (this.busy(place) || this.source.pilots.completion.busy(place)) throw Error('The coordinator is changing; try again shortly')
    const space = this.source.space(place), old = this.source.agents.get(place)
    if (!space || space.mode === 'autopilot' || old?.pilot || this.source.pilots.policy.all().some(run => run.place === place && run.state !== 'stopped')) throw Error('Turn Autopilot off and finish its cleanup before removing this space')
    return this.transition(place, async () => {
      if (old) {
        this.source.mailbox.revoke(old.chat)
        this.source.denyPermissions(old, 'Space removed; add it again before asking a fresh question')
        await this.finish(old)
      }
      if (this.source.quiescing) throw Error('Shepherdr is stopping')
      if (this.source.agents.get(place)?.launch !== old?.launch) throw Error('A newer coordinator replaced this removal')
      forget()
    })
  }
  private recent(place: string) {
    return this.source.logs.messages(place).filter(message => message.text).slice(-20).map(message => `${message.who}: ${message.text!.slice(0, 4000)}`).join('\n').slice(-32000)
  }
  private async finish(agent: CoreAgent) {
    const terminal = this.source.agents.terminal(agent)
    if (!terminal || !this.source.machineConnected(agent.machine)) throw Error('Process cleanup is not confirmed; reconnect core')
    if (agent.pid !== undefined && terminal.pid !== agent.pid) throw Error('Coordinator process identity changed')
    const identity = { address: terminal.address, pid: terminal.pid, created: terminal.created_ms }
    if (terminal.state === 'finished') return
    await this.source.core.call('terminal.kill', { terminal: identity.address })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const current = this.source.agents.terminal(agent)
      if (!this.source.machineConnected(agent.machine) || !current) break
      if (current.address !== identity.address || current.pid !== identity.pid || current.created_ms !== identity.created) throw Error('Coordinator process identity changed')
      if (current.state === 'finished') return
      await Bun.sleep(100)
    }
    throw Error('Coordinator cleanup is pending; retry after core reconnects')
  }

  revoke(id: string, keepWorkers = false) {
    const stopped = this.source.pilots.policy.stop(id, keepWorkers)
    this.denyPermissions(stopped)
    return stopped
  }
  stop(id: string, keepWorkers = false) {
    const run = this.revoke(id, keepWorkers)
    return this.transition(run.place, () => this.cleanup(id))
  }
  private records(run: CorePilotRun) {
    const all = [...this.source.store.all<CoreAgent>('pilot-capture'), ...this.source.agents.all()]
    return [...new Map(all.filter(agent => agent.pilot?.run === run.id && agent.space === run.place && agent.machine === run.machine).map(agent => [agent.launch, agent])).values()]
  }
  private denyPermissions(run: CorePilotRun) {
    for (const agent of this.records(run)) if (run.state !== 'workers' || agent.role === 'coordinator') this.source.denyPermissions(agent, 'Autopilot stopped this agent')
  }
  private async cleanup(id: string) {
    const run = this.source.pilots.policy.get(id)
    if (!run || !['workers', 'stopping', 'failed'].includes(run.state)) return
    this.denyPermissions(run)
    if (!this.source.machineConnected(run.machine)) return // Absence in a disconnected snapshot is never proof of exit.
    let pending = false
    const records = this.records(run)
    for (const agent of records) {
      const latest = this.source.pilots.policy.get(id)!
      if (latest.state === 'workers' && agent.role !== 'coordinator') continue
      const terminal = this.source.agents.terminal(agent)
      if (!terminal) { pending = true; continue } // An uncertain terminal.run can still publish its holder.
      if (terminal.state === 'finished') continue
      if (agent.pid !== undefined && terminal.pid !== agent.pid) throw Error('Contained process identity changed; cleanup is not confirmed')
      pending = true
      await this.source.core.call('terminal.kill', { terminal: terminal.address })
    }
    const latest = this.source.pilots.policy.get(id)!
    const mutating = latest.state !== 'workers' && latest.tasks.some(task => this.source.tasks.busy(task))
    const appeared = this.records(latest).some(agent => !records.some(old => old.launch === agent.launch))
    if (pending || latest.state !== run.state || mutating || appeared) return
    if (latest.state !== 'workers') this.source.pilots.policy.stopped(id)
    const space = this.source.space(run.place)
    // Do not replace a newer run or start an unrestricted agent as an automatic recovery side effect.
    if (space && this.source.pilots.policy.current(space.id)?.id !== id && this.source.pilots.policy.current(space.id)) return
    if (space?.mode === 'autopilot') {
      space.mode = 'regular'; this.source.store.set('space', space.id, space)
      this.source.emit('snapshot')
    }
  }
  async tick() {
    for (const run of this.source.pilots.policy.all()) {
      if (run.state === 'starting' && !this.busy(run.place)) this.source.pilots.policy.fail(run.id, 'Autopilot start was interrupted; cleanup is pending before a fresh start')
      if (['on', 'workers'].includes(run.state)) {
        try { this.source.pilots.policy.live(run.id) } catch { /* Private policy persists the limit failure. */ }
      }
      if (this.source.pilots.policy.get(run.id)!.state === 'failed') this.source.pilots.completion?.queueReturn(run.id, false, run.error || 'Autopilot stopped')
      if (['workers', 'stopping', 'failed'].includes(this.source.pilots.policy.get(run.id)!.state)) await this.transition(run.place, () => this.cleanup(run.id))
    }
  }
  async drain() { await Promise.allSettled([...this.transitions.values()]) }
}
