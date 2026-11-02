import { screenText } from '../common/screen-card.ts'
import { Refusal } from './client.ts'
import type { CoreAgent } from './model.ts'
import type { CoreTerminal } from './protocol.ts'
import { CLI_NAME } from './settings.ts'
import type { CoreSource } from './source.ts'
import { guarded } from './guarded.ts'

export interface ResumeStart { chat: string; launch: string; message: string }

const POLL = 2000
/** Claude Code: "No conversation found with session ID: …". Codex: "ERROR: No saved session found with ID …". */
const LOST = /\bno (?:saved )?(?:conversation|session|rollout)\b.*\bfound\b|\b(?:conversation|session)\b.*\bnot found\b/i
export const FRESH_SESSION = 'Your earlier session is gone, so this is a new one that remembers none of it. Check what is already here and preserve existing work.'

/** An agent whose process ended before its session began stays starting for ever: its chat holds every message and a
 *  restart repeats the failure. Readiness stays the hooks' word; the screen only says why a finished start failed. */
export class CoreFailedStarts {
  private timer?: ReturnType<typeof setInterval>
  private seen = new Set<string>()
  private settling = new Set<string>()
  constructor(private readonly source: CoreSource) {}
  start() { this.timer = setInterval(() => { if (!this.source.quiescing) void guarded('Failed start check', () => this.tick()) }, POLL) }
  stop() { clearInterval(this.timer) }
  /** Its process ended and this hasn't yet said what that means: no one else should make news of it. */
  pending(agent: CoreAgent) { return agent.state === 'starting' && !agent.pilot && this.source.agents.terminal(agent)?.state === 'finished' }
  async tick() {
    if (!this.source.connected()) return
    const agents = this.source.agents
    for (const row of this.source.store.all<ResumeStart>('resume-start')) {
      const agent = agents.get(row.chat)
      if (agent?.launch !== row.launch || agent.state !== 'starting') this.source.store.delete('resume-start', row.launch)
    }
    const stopped = agents.all().filter(agent => this.pending(agent) && this.source.machineConnected(agent.machine))
    for (const launch of this.seen) if (!stopped.some(agent => agent.launch === launch)) this.seen.delete(launch)
    await Promise.allSettled(stopped.filter(agent => !this.settling.has(agent.launch)).map(async agent => {
      // Hooks are read every half second: a start that did report gets a poll to say so first.
      if (!this.seen.has(agent.launch)) { this.seen.add(agent.launch); return }
      this.settling.add(agent.launch)
      try { await this.settle(agent) } finally { this.settling.delete(agent.launch) }
    }))
  }
  private async settle(agent: CoreAgent) {
    const { agents, tasks } = this.source, task = tasks.forChat(agent.chat)
    if (task && tasks.busy(task.id)) return // the next poll looks again
    const terminal = agents.terminal(agent)!
    const words = terminal.reason === 'killed' ? '' : await this.words(terminal)
    const current = agents.get(agent.chat)
    if (current?.launch !== agent.launch || current.state !== 'starting') return
    // Stopped on purpose, or for a task that needs no agent now: it only must not hold the chat.
    if (terminal.reason === 'killed' || task && (task.archived || ['merged', 'closed'].includes(task.workflow))) return agents.update(agent, { state: 'idle' })
    try {
      if (current.session && terminal.exit_code !== 0 && LOST.test(words)) await this.fresh(current)
      else await this.fail(current, words.split('\n').filter(line => line.trim()).slice(-3).join(' ').slice(-240) || `It exited with code ${terminal.exit_code ?? terminal.signal ?? 'unknown'}.`)
    } catch (error) {
      if (error instanceof Refusal && task && tasks.busy(task.id)) return
      await this.fail(current, (error as Error).message).catch(() => {})
    }
  }
  private async words(terminal: CoreTerminal) {
    try { return screenText((await this.source.core.call<{ text: string }>('terminal.read', { terminal: terminal.address })).text) } catch { return '' }
  }
  private async fresh(agent: CoreAgent) {
    const { agents, tasks } = this.source, task = tasks.forChat(agent.chat)
    const message = this.source.store.get<ResumeStart>('resume-start', agent.launch)?.message ?? ''
    let started = true
    if (task) started = await tasks.startFresh(task.id, agent.launch, message)
    else {
      const space = this.source.space(agent.space)
      agents.update(agent, { session: undefined })
      if (!space) return agents.update(agent, { state: 'idle' })
      await agents.launch(space, agent.chat, agent.kind, message && `<restart>${FRESH_SESSION}</restart>\n\n${message}`, { model: agent.model, effort: agent.effort, speed: agent.speed })
    }
    // No room on its machine yet: it starts anew when its turn comes, with what it had to say saved for that start.
    if (!started) {
      if (message) this.source.store.set('pending-send', `session-gone-${agent.launch}`, { id: `session-gone-${agent.launch}`, chat: agent.chat, text: message, state: 'queued' })
      agents.update(agent, { state: 'idle' })
    }
    this.post(agent, 'session-gone', started ? 'Earlier session was gone, started a new one.' : 'Earlier session was gone, a new one starts when there is room.')
  }
  private async fail(agent: CoreAgent, why: string) {
    const task = this.source.tasks.forChat(agent.chat), text = `${CLI_NAME[agent.kind]} couldn’t start. ${why}`
    // Its reason first: the news of this one failure goes by what the task says when the agent stops holding the start.
    if (task && agent.role === 'task') await this.source.tasks.startFailed(task.id, text)
    this.source.agents.update(agent, { state: 'idle' })
    this.post(agent, 'start-failed', text)
  }
  private post(agent: CoreAgent, kind: string, text: string) {
    // A message, not a card: a card keeps to one line, and these words must all show on a phone.
    this.source.post(agent.chat, { id: `${kind}-${agent.launch}`, who: 'agent', text, at: Date.now() })
  }
}
