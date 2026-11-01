import { randomUUID } from 'node:crypto'
import { one, parseArgs } from '../common/args.ts'
import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'
import type { Grant } from './mailbox.ts'
import { Refusal } from './client.ts'

/** Only authenticated contained launches enter here. No caller-supplied actor, run, machine or cwd grants authority. */
export class CorePilotCommands {
  constructor(private source: CoreSource) {}
  private run(agent: CoreAgent) {
    if (!agent.pilot) throw new Refusal('This is not a contained session')
    return this.source.pilots.policy.actor(agent.pilot.run, this.source.pilots.actor(agent))
  }
  secret(agent: CoreAgent, input: unknown) {
    const run = this.run(agent), names = (input as { names?: unknown })?.names
    if (agent.role === 'reviewer' || !Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !run.config.secrets.includes(name))) throw new Refusal('This secret is outside this run’s approved access profile; ask the human')
    return this.source.secrets.use(agent, input)
  }
  async cli(agent: CoreAgent, grant: Grant, args: string[]) {
    if (!Array.isArray(args) || args.length > 256 || args.some(word => typeof word !== 'string' || word.length > 65536)) throw new Refusal('Invalid contained command')
    const parsed = parseArgs(args), words = parsed.words, [command, op] = words
    const run = this.run(agent)
    this.source.pilots.policy.command(run.id, this.source.pilots.actor(agent), words)
    const text = (value: unknown) => ({ out: (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n', code: 0 })
    if (command === 'help') return text('Contained Shepherdr: show, models, heartbeat, progress [TEXT], complete EVIDENCE, mode regular --why REASON, task add/list/show/chat/start/tell/queue/review-more/stop/pause/pin/unpin/unarchive/close/delete, status, checkpoint MESSAGE, review, ready, pr, checks, merge, ask, plan, alert, secret list/ask/run/env, artifact new/update/check/list/show/remove. Every action stays inside this run’s profile; changing earlier tasks requires explicit task start.')
    if (command === 'show') return text(this.source.settings.describe(agent.space))
    if (command === 'models') return text(this.source.settings.clis(agent.space))
    if (command === 'heartbeat') return text(this.source.heartbeats.cli(agent, ['heartbeat']))
    if (command === 'progress') {
      if (words.length > 1) {
        if (agent.role !== 'coordinator') throw new Refusal('Only this run’s coordinator saves shared progress')
        const body = words.slice(1).join(' ')
        if (Buffer.byteLength(body) > 32000) throw new Refusal('Keep saved progress under 32 KiB')
        this.source.store.set('pilot-progress', run.id, { text: body, at: Date.now() })
      }
      return text(this.source.store.get<{ text: string }>('pilot-progress', run.id)?.text || 'No saved progress yet.')
    }
    if (command === 'complete') {
      if (words.length !== 2) throw new Refusal('Use shepherdr complete "goal evidence"')
      return text(this.source.pilots.completion.request(agent, words[1]))
    }
    if (command === 'mode') {
      if (words.length !== 2 || op !== 'regular' || parsed.flags.size || Object.keys(parsed.opts).some(key => key !== 'why')) throw new Refusal('Use mode regular --why "reason" for your own run')
      return text(this.source.pilots.completion.stop(agent, one(parsed, 'why') || ''))
    }
    if (command === 'secret') {
      if (agent.role === 'reviewer') throw new Refusal('Reviewers cannot use secrets')
      if (op === 'list') return text(this.source.secrets.vault.visible([agent.space, `m:${agent.machine}`, 'all']).filter(item => run.config.secrets.includes(item.name)).map(item => item.name).join('\n') || 'No approved secrets here yet.')
      if (!run.config.secrets.includes(words[2])) throw new Refusal('That secret is outside this run’s approved access profile; ask the human')
      return text(await this.source.secrets.cli(agent, args))
    }
    if (command === 'ask' || command === 'plan') return text(`Asked: ${this.source.questions.create(grant, args)}`)
    if (command === 'alert') {
      this.source.requirePlugin('alerts')
      const id = randomUUID(), title = words.slice(1).join(' ')
      if (!title || title.length > 240 || (one(parsed, 'body')?.length ?? 0) > 4000) throw new Refusal('Give a short alert title and body')
      this.source.emit('alert', { id, from: this.source.space(agent.space)?.name || 'Shepherdr', title, body: one(parsed, 'body') || '', go: { place: agent.space, task: this.source.tasks.forChat(agent.chat)?.id }, ...(agent.role === 'task' ? { task: true } : {}) })
      return text('Alert sent')
    }
    if (command === 'artifact') {
      this.source.requirePlugin('artifacts')
      if (!['list', 'show'].includes(op) && !grant.actions.includes('artifact')) throw new Refusal('This session has no artifact permission')
      return text(await this.source.artifacts.cli(agent, args, this.source.tasks.forChat(agent.chat)?.folder ?? this.source.space(agent.space)!.folder))
    }
    if (command === 'task' && op === 'add') return this.source.tasks.cli(grant, args)
    if (command === 'task' && op === 'list') return text(this.source.tasks.listPage(this.source.tasks.list(grant, parsed.flags.has('archived'), one(parsed, 'space')).filter(task => task.place === run.place && task.machine === run.machine && (agent.role === 'coordinator' || task.pilot === run.id && run.tasks.includes(task.id))), one(parsed, 'after')))
    const target = command === 'checkpoint' ? this.source.tasks.forChat(agent.chat) : this.source.tasks.resolve(grant, command === 'task' ? words[2] : op)
    if (command === 'task' && op === 'start' && agent.role === 'coordinator' && target?.place === run.place && target.machine === run.machine) return this.source.tasks.cli(grant, args)
    if (command === 'task' && ['show', 'chat'].includes(op) && agent.role === 'coordinator' && target?.place === run.place && target.machine === run.machine) {
      if (op === 'show') return this.source.tasks.cli(grant, args)
      const limit = Number(one(parsed, 'limit') || 20)
      return text(this.source.tasks.chatPage(target, limit, one(parsed, 'before')))
    }
    if (!target || target.pilot !== run.id || !run.tasks.includes(target.id) || target.place !== run.place || target.machine !== run.machine) throw new Refusal('This run does not own that task')
    if (command === 'task' && op === 'show') return this.source.tasks.cli(grant, args)
    if (command === 'task' && op === 'chat') {
      const limit = Number(one(parsed, 'limit') || 20)
      return text(this.source.tasks.chatPage(target, limit, one(parsed, 'before')))
    }
    if (agent.role === 'task' && target.chat !== agent.chat) throw new Refusal('A worker may change only its own task')
    if (command === 'task' && op === 'review-more' && !this.source.pilots.policy.owns(run.id, target.id)) throw new Refusal('This task is outside your run')
    if (command === 'checkpoint') {
      const message = words.slice(1).join(' ')
      if (agent.role !== 'task' || !message.trim() || Buffer.byteLength(message) > 16000) throw new Refusal('Give a checkpoint message for your own task')
      return this.source.tasks.change(target.id, async () => {
        if (this.source.tasks.get(target.id)?.workflow !== 'working') throw new Refusal('This task is not currently working')
        const repo = { machine: target.machine, folder: target.folder }
        await this.source.tasks.git.run(repo, ['add', '--all'])
        if (await this.source.tasks.git.clean(repo)) return text('No changes to checkpoint')
        await this.source.tasks.git.run(repo, ['commit', '-F', '-'], 30, message)
        return text(`Checkpoint: ${await this.source.tasks.git.head(repo)}`)
      })
    }
    if ((command === 'merge' || command === 'task' && op === 'merge') && run.config.approvals.includes('merge') && target.mergePolicy !== 'ask') throw new Refusal('This run requires the human’s exact-head merge approval')
    return this.source.tasks.cli(grant, args)
  }
}
