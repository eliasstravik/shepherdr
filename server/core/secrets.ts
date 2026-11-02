import { line } from '../common/chatlines.ts'
import { machineName } from '../../shared/types.ts'
import { Refusal } from './client.ts'
import { randomUUID } from 'node:crypto'
import { Vault, SECRET_NAME, secretPages } from '../common/secrets.ts'
import { one, parseArgs } from '../common/args.ts'
import { findCoreSpace } from './space-names.ts'
import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'
import type { Action, Message, SecretAsk, SettingSection } from '../../shared/types.ts'

interface Request { id: string; chat: string; grant: string; ask: SecretAsk }
/** Vault values never enter snapshots, chat records or plaintext core docs. */
export class CoreSecrets {
  readonly vault: Vault
  constructor(private source: CoreSource) { this.vault = new Vault(source.config.home) }
  private chain(agent: CoreAgent) { return [agent.space, `m:${agent.machine}`, 'all'] }
  open(chat?: string) { return this.source.store.all<Request>('secret-request').filter(request => (!chat || request.chat === chat) && this.source.agents.get(request.chat)?.grant === request.grant) }
  reconcile(chat: string) {
    for (const request of this.source.store.all<Request>('secret-request').filter(request => request.chat === chat && (request.grant !== this.source.agents.get(chat)?.grant || this.source.tasks.finished(chat)))) {
      this.source.store.delete('secret-request', request.id)
      this.source.store.set(`message:${chat}`, request.id, { id: request.id, who: 'agent', text: request.grant === this.source.agents.get(chat)?.grant ? `The task is done, so the request for ${request.ask.name} is closed.` : `The request for ${request.ask.name} belonged to the previous session. Ask again if it is still needed.`, at: Date.now() })
      this.source.clearAlert(chat, `${request.ask.name} is no longer needed`)
    }
  }
  private name(level: string) { return level === 'all' ? 'Everywhere' : level.startsWith('m:') ? machineName(this.source.snapshot().machines, level.slice(2)) : this.source.space(level)?.name || level }
  private level(level: string) {
    if (level !== 'all' && !this.source.spaces().some(space => space.id === level || `m:${space.machine}` === level)) throw new Refusal('Choose an existing machine or space')
  }
  pages(settings: SettingSection[]) { return secretPages(settings, this.vault.names()) }
  /** Called only by the private, local operator socket, never the agent mailbox. */
  async operator(args: string[], stdin?: string) {
    const parsed = parseArgs(args), [command, verb, name] = parsed.words
    if (command !== 'secret' || !['set', 'rm', 'remove'].includes(verb!) || parsed.words.length !== 3 ||
      [...parsed.flags].some(flag => flag !== 'machine') || Object.keys(parsed.opts).some(key => key !== 'space') ||
      (parsed.opts.space?.length ?? 0) > 1 || parsed.flags.has('machine') && !!one(parsed, 'space'))
      throw new Refusal('Use secret set NAME [--machine | --space NAME] < file, or secret rm NAME [--machine | --space NAME]')
    if (!name || !SECRET_NAME.test(name)) throw new Refusal('Use an environment variable name, such as GITHUB_TOKEN')
    const machine = this.source.localMachineId(), selected = one(parsed, 'space')
    const space = selected ? findCoreSpace(this.source, machine, selected) : undefined
    if (selected && !space) throw new Refusal('Choose a space on the main machine')
    const level = space?.id ?? (parsed.flags.has('machine') ? `m:${machine}` : 'all')
    if (verb === 'set' && (typeof stdin !== 'string' || !stdin.replace(/[\r\n]+$/, ''))) throw new Refusal('Give the value on stdin: secret set NAME < file; never put it in command words')
    await this.act({ type: 'secret', level, name, value: verb === 'set' ? stdin! : null })
    return `${verb === 'set' ? 'Saved' : 'Removed'} ${name} for ${this.name(level)}.\n`
  }
  async cli(agent: CoreAgent, args: string[]) {
    const parsed = parseArgs(args), [, verb = 'list', name] = parsed.words
    if (agent.role === 'reviewer') throw new Refusal('Reviewers cannot use secrets')
    if (verb === 'list') return this.vault.visible(this.chain(agent)).map(item => `${item.name} (${this.name(item.level)})`).join('\n') || 'No secrets here yet.'
    if (verb === 'run' || verb === 'env') throw new Refusal(`This older helper cannot use secrets. Run the current authenticated command: ${this.source.agents.command(agent)} secret ${verb}. This replaces old helper paths remembered in the chat.`)
    if (verb !== 'ask') throw new Refusal('Use secret list, ask NAME --why TEXT, run NAME -- COMMAND, or env NAME --file .env. Add and remove values in Settings → Secrets.')
    if (!name || !SECRET_NAME.test(name)) throw new Refusal('Use an environment variable name, such as GITHUB_TOKEN')
    if (this.vault.visible(this.chain(agent)).some(item => item.name === name) && !parsed.flags.has('force')) throw new Refusal('That secret is already available; use it by name, or ask again with --force')
    const id = randomUUID(), ask: SecretAsk = { id, name, why: one(parsed, 'why'), levels: this.chain(agent).map(level => ({ id: level, label: this.name(level) })) }
    this.source.store.set('secret-request', id, { id, chat: agent.chat, grant: agent.grant, ask } satisfies Request)
    this.source.post(agent.chat, { id, who: 'agent', secret: ask, at: Date.now() })
    this.source.emit('alert', { id, from: this.source.space(agent.space)?.name || 'Shepherdr', title: `${name} needed`, body: ask.why || 'Give it in the masked box', go: { place: agent.space, task: this.source.tasks.forChat(agent.chat)?.id, focus: id }, ...(agent.role === 'task' ? { task: true } : {}) })
    return `Asked for ${name} in a masked box. End your turn; wait for the secret-saved line. Never ask for its value in chat.`
  }
  use(agent: CoreAgent, input: unknown) {
    if (agent.role === 'reviewer') throw new Refusal('Reviewers cannot use secrets')
    const names = (input as { names?: unknown })?.names
    if (!Array.isArray(names) || !names.length || names.length > 32 || names.some(name => typeof name !== 'string' || !SECRET_NAME.test(name))) throw new Refusal('Choose secret names, never values')
    const { found, missing } = this.vault.pick([...new Set(names)] as string[], this.chain(agent))
    if (missing.length) throw new Refusal(`No secret ${missing.join(', ')} here. Ask with shepherdr secret ask NAME --why TEXT.`)
    const secrets = Object.fromEntries(Object.entries(found).map(([name, item]) => [name, item.value]))
    if (Buffer.byteLength(JSON.stringify(secrets)) > 80_000) throw new Refusal('Use fewer secrets in one command')
    return { secrets }
  }
  async act(action: Extract<Action, { type: 'secret' | 'secret-saved' }>) {
    if (action.type === 'secret-saved') throw new Refusal('Save the secret through its masked box')
    this.level(action.level)
    if (action.card) {
      const request = this.source.store.get<Request>('secret-request', action.card.id)
      if (!request || request.chat !== action.card.chat || request.ask.name !== action.name || request.grant !== this.source.agents.get(request.chat)?.grant || !request.ask.levels.some(level => level.id === action.level)) throw new Refusal('This secret request belongs to an expired session or another scope')
    }
    // Given in Settings instead of its card, the secret still answers the card: every card it now reaches, as agents can ask at once.
    const requests = action.value === null ? [] : this.open().filter(open => open.ask.name === action.name && open.ask.levels.some(level => level.id === action.level))
    const result = this.vault.set(action.level, action.name, action.value === null ? null : action.value.replace(/[\r\n]+$/, ''))
    if (!result.ok) throw new Refusal(result.error || 'The secret could not be saved')
    for (const request of requests) {
      const saved = this.name(action.level), message = this.source.store.get<Message>(`message:${request.chat}`, request.id)
      this.source.saveAndDeliver(request.chat, `secret-saved-${request.id}`, line.secret(this.source.snapshot().user || 'You', action.name, saved), () => {
        this.source.store.delete('secret-request', request.id)
        if (message) this.source.store.set(`message:${request.chat}`, request.id, { ...message, secret: { ...request.ask, saved } })
      })
      this.source.clearAlert(request.chat, `${action.name} is saved`)
      this.source.emit('chat', request.chat)
    }
    this.source.emit('snapshot'); return { ok: true }
  }
}
