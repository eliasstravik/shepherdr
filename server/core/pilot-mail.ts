import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'
import type { Grant, MailRequest } from './mailbox.ts'
import { CorePilotPolicy, type PilotActor } from './pilot-policy.ts'
import { CorePilotCompletion } from './pilot-completion.ts'
import { CorePilotWakes } from './pilot-wakes.ts'
import { CorePilotLifecycle } from './pilot-lifecycle.ts'
import { CorePilotUsage } from './pilot-usage.ts'
import { CorePilotCommands } from './pilot-commands.ts'
import { pilotHook } from './pilot-hook.ts'

/** Private actor/lease accounting dispatch. Product launch and managed-task commands are not exposed yet. */
export class CorePilotMail {
  readonly completion: CorePilotCompletion
  readonly wakes: CorePilotWakes
  readonly lifecycle: CorePilotLifecycle
  readonly usage: CorePilotUsage
  readonly commands: CorePilotCommands
  readonly policy: CorePilotPolicy
  constructor(private source: CoreSource) { this.policy = new CorePilotPolicy(source.store); this.commands = new CorePilotCommands(source); this.usage = new CorePilotUsage(source); this.lifecycle = new CorePilotLifecycle(source); this.wakes = new CorePilotWakes(source); this.completion = new CorePilotCompletion(source) }
  actor(agent: CoreAgent): PilotActor {
    if (!agent.pilot) throw Error('This is not a contained agent')
    const run = this.policy.get(agent.pilot.run)
    if (!run || run.place !== agent.space || run.machine !== agent.machine) throw Error('This contained session belongs to another space or machine')
    const task = this.source.tasks.forChat(agent.chat)
    if (agent.role !== 'coordinator' && !task || agent.role === 'coordinator' && agent.chat !== run.place) throw Error('This is not the run’s recorded agent')
    if (task && (task.place !== run.place || task.machine !== run.machine || task.pilot !== run.id)) throw Error('This task belongs to another space or machine')
    return { chat: agent.chat, launch: agent.launch, role: agent.role, task: task?.id }
  }
  async mail(agent: CoreAgent, grant: Grant, request: MailRequest, id: string): Promise<unknown> {
    if (!agent.pilot || agent.grant !== grant.id || agent.launch !== grant.session || agent.machine !== grant.machine) throw Error('This session has no contained launch identity')
    const actor = this.actor(agent), input = request.args as { op?: unknown; bytes?: unknown; input?: unknown; id?: unknown }
    if (!input || typeof input.op !== 'string') throw Error('Invalid contained operation')
    if (input.op === 'cancel') {
      if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id)) throw Error('Invalid permission cancellation identity')
      // Cancellation only denies this authenticated grant's own request, even after its run has stopped.
      this.source.cancelPermission(grant, input.id)
      return {}
    }
    const runId = agent.pilot.run
    if (input.op === 'lease') {
      // terminal.run can publish its process before its response lets the app bind the private actor.
      const deadline = Math.min(request.expires, Date.now() + 10_000)
      for (;;) {
        const run = this.policy.get(runId), current = this.source.agents.get(agent.chat)
        const terminal = current && this.source.agents.terminal(current)
        if (this.source.quiescing || current?.launch !== agent.launch || current.grant !== grant.id || current.pilot?.run !== runId || terminal?.state !== 'live' || current.pid && current.pid !== terminal.pid) throw Error('This contained launch was replaced, stopped or the app is stopping')
        if (run?.actors.some(saved => saved.chat === actor.chat && saved.launch === actor.launch && saved.role === actor.role && saved.task === actor.task)) break
        if (!run || !['starting', 'on', 'workers'].includes(run.state) || !current.pilot?.pending || Date.now() >= deadline) throw Error('This contained launch has no confirmed private actor binding')
        await Bun.sleep(50)
      }
      this.policy.actor(runId, actor)
      const current = this.source.agents.get(agent.chat)!
      if (current.pilot?.pending) { current.pilot.pending = false; this.source.store.set('agent', current.chat, current) }
      return {}
    }
    this.policy.actor(runId, actor)
    if (input.op === 'traffic') {
      const used = this.policy.traffic(runId, actor, input.bytes as number), limit = this.policy.get(runId)?.config.traffic
      return { used, ...(limit ? { left: limit - used } : {}) }
    }
    if (input.op !== 'hook') throw Error('Unknown contained operation')
    if (this.source.store.get(`permission-cancel:${grant.id}`, id)) return { allow: false }
    const event = pilotHook(input.input, id, agent.kind, agent.pilot.home, agent.pilot.captures)
    const raw = input.input as Record<string, unknown>
    if (event.event === 'PermissionRequest' && (JSON.stringify(raw.tool_input, null, 2)?.length ?? 0) > 16_000) throw Error('Native permission input is too large to show in full; review it in Terminal')
    this.source.agents.hook(agent, event)
    if (event.event !== 'PermissionRequest') return {}
    const answer = await this.source.requestPermission(agent, grant, { ...request, args: { id, tool: event.tool, input: raw.tool_input, agent: event.agent, turn: event.turn, at: event.at } }, id)
    // A response may have been waiting while the human stopped this run.
    try { this.policy.actor(runId, actor) } catch { return { allow: false } }
    return answer
  }
}
