import { randomUUID } from 'node:crypto'
import { timeWords, nextWords, eventWords, eventRules } from '../common/trigger.ts'
import { one, parseArgs, type Parsed } from '../common/args.ts'
import { askText, quickChoices, clip, TITLE_MAX, BODY_MAX } from '../../shared/alerts.ts'
import { Refusal } from './client.ts'
import { findCoreSpace } from './space-names.ts'
import { kindOf } from './settings.ts'
import type { CoreAgent } from './model.ts'
import type { CoreSource } from './source.ts'
import type { Grant } from './mailbox.ts'

/** Common ordinary-agent commands. Scope always comes from the current private launch. */
export class CoreCommands {
  constructor(private source: CoreSource) {}
  private current(agent: CoreAgent, grant: Grant) {
    const now = this.source.agents.get(grant.chat)
    if (agent.pilot || agent.chat !== grant.chat || !now || now.machine !== agent.machine || now.launch !== grant.session || now.grant !== grant.id || now.machine !== grant.machine || now.launch !== agent.launch || now.grant !== agent.grant || now.space !== agent.space || now.role !== agent.role || !this.source.space(now.space)) throw new Refusal('This ordinary session is no longer current')
  }
  private level(agent: CoreAgent, parsed: Parsed, fallback: string) {
    const named = one(parsed, 'space')
    if (parsed.flags.has('machine') && named) throw new Refusal('Choose --machine or --space, not both')
    const space = named ? findCoreSpace(this.source, agent.machine, named) : undefined
    if (named && !space) throw new Refusal('Choose a space on your machine')
    if (agent.role !== 'coordinator' && (space && space.id !== agent.space || parsed.flags.has('machine'))) throw new Refusal('A task reads its own space settings')
    return space?.id ?? (parsed.flags.has('machine') ? `m:${agent.machine}` : fallback)
  }
  async cli(agent: CoreAgent, grant: Grant, args: string[]) {
    if (!['show', 'models', 'set', 'unset', 'alert'].includes(args[0])) return undefined
    this.current(agent, grant)
    const parsed = parseArgs(args), [command, ...words] = parsed.words
    const result = (out: string) => {
      if (Buffer.byteLength(JSON.stringify({ out, code: 0 })) > 80_000) throw new Refusal('This response is too large; choose a CLI or a settings section explicitly')
      return { out: out + '\n', code: 0 }
    }
    if (command === 'alert') {
      this.source.requirePlugin('alerts')
      if (agent.role === 'reviewer') throw new Refusal('A reviewer reports findings in its final reply')
      if (parsed.flags.size || Object.keys(parsed.opts).some(key => !['body', 'task'].includes(key))) throw new Refusal('Use alert TITLE [--body WHY] [--task ID]')
      const title = words.join(' '), body = one(parsed, 'body') || '', target = one(parsed, 'task')
      if (!title.trim() || title.length > 240 || body.length > 4000) throw new Refusal('Give a short alert title and body')
      const task = target ? this.source.tasks.resolve(grant, target) : this.source.tasks.forChat(agent.chat)
      if (target && (!task || !this.source.tasks.list(grant, !!task.archived).some(item => item.id === task.id))) throw new Refusal('This session cannot read that task')
      if (task?.archived) throw new Refusal('Unarchive this task before alerting about it')
      const owner = task && this.source.agents.get(task.chat), status = task && this.source.tasks.view(task).status
      const question = owner && this.source.openPermissions(owner).at(-1)?.question || task && (this.source.questions.open(task.chat).at(-1) ?? this.source.screens.open(task.chat).at(-1))?.question
      const about = task && question ? askText(task.id, question) : undefined
      this.source.emit('alert', { id: randomUUID(), from: about ? 'Shepherdr' : this.source.store.get<string>('name', agent.space) || this.source.space(agent.space)!.name,
        title: about?.title || clip(title, TITLE_MAX), body: clip(about ? [about.body, [title, body].filter(Boolean).join(': ')].join('\n') : body, BODY_MAX),
        go: { place: task?.place ?? agent.space, ...(task ? { task: task.id } : {}), ...(question ? { focus: question.id } : {}) },
        ...(task && (agent.role === 'task' || !!question || status === 'need' || status === 'ready') ? { tag: task.id, task: true as const } : {}),
        ...(task && question ? { card: { chat: task.chat, question: question.id, choices: quickChoices(question) } } : {}) })
      return result('Alert sent')
    }
    if (Object.keys(parsed.opts).some(key => !['space', 'section'].includes(key)) || [...parsed.flags].some(key => key !== 'machine')) throw new Refusal('Use --space NAME or --machine for settings')
    if (command === 'models') {
      if (words.length > 1 || one(parsed, 'section')) throw new Refusal('Use models [claude|codex] [--space NAME]')
      const kind = words[0] && kindOf(words[0])
      if (words[0] && !kind) throw new Refusal('Choose Claude Code or Codex')
      const level = this.level(agent, parsed, agent.space)
      return result(JSON.stringify(this.source.settings.clis(level).filter(cli => !kind || cli.kind === kind), null, 2))
    }
    if (command === 'show') {
      if (words.length) throw new Refusal('Use show [--space NAME | --machine] [--section NAME]')
      return result(this.source.settings.describe(this.level(agent, parsed, agent.space), one(parsed, 'section')))
    }
    if (agent.role !== 'coordinator') throw new Refusal('Only a regular coordinator changes settings when the human asks')
    if (one(parsed, 'section') || !words[0] || command === 'unset' && words.length !== 1 || command === 'set' && words.length < 2) throw new Refusal('Use set KEY VALUE or unset KEY [--machine | --space NAME]')
    const [key, ...values] = words
    if (key === 'space.base') {
      if (command !== 'set' || !one(parsed, 'space') || parsed.flags.size || values.length !== 1) throw new Refusal('Use set space.base BRANCH --space NAME')
      return result(await this.source.places.cli(agent, ['space', 'set', 'base', values[0]!, '--space', one(parsed, 'space')!]))
    }
    const level = this.level(agent, parsed, 'all')
    this.source.settings.set(key!, command === 'unset' ? null : values.join(' '), level)
    // Private instruction text must not be echoed into command output, chat or reports.
    const value = this.source.settings.get(key!, level)
    const trigger = key === 'heartbeat.when' ? ` In words: ${timeWords(value, this.source.automations.zone())}. Next: ${nextWords(value, this.source.automations.zone()).join(', ') || 'off'}.` : key === 'heartbeat.on' ? ` In words: ${eventWords(eventRules(value))}.` : ''
    return result(`${key}: ${command === 'unset' ? 'own value removed; inherited value applies' : 'saved'} (${level}).${key!.endsWith('.instructions') ? ' Used at the next start or restart.' : ''}${trigger}`)
  }
}
