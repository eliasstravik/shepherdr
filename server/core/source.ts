import { newRepository } from './new-repository.ts'
import { humanName } from './human-name.ts'
import { coreSpaceName } from './space-names.ts'
import { repositorySection } from '../common/space-settings.ts'
import { taskIdsSection } from '../common/task-ids.ts'
import { automaticTaskPrefix, setTaskIdSetting, taskSequence } from './id-settings.ts'
import { hostname, homedir } from 'node:os'
import { basename, join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Emitter, type Source, type SourceEvents } from '../source.ts'
import { modelCommand, nameProblem, slugify, type Action, type AddSpace, type Artifact, type Chat, type Folders, type Message, type Need, type Question, type Snapshot, type Status, type Task } from '../../shared/types.ts'
import { CoreSession } from './session.ts'
import { CoreStore } from './store.ts'
import { CoreFiles } from './files.ts'
import { CoreAgents } from './agents.ts'
import { CoreLogs } from './logs.ts'
import { Mailbox, type Grant, type MailRequest } from './mailbox.ts'
import { prepareHome } from './home.ts'
import type { CoreConfig } from './config.ts'
import { coreEnvironment } from './config.ts'
import type { AgentKind, CoreAgent, CoreSpace } from './model.ts'
import { CoreTasks } from './tasks.ts'
import { CoreCommands } from './commands.ts'
import { CoreTaskNews } from './news.ts'
import { CoreQuestions } from './questions.ts'
import { CoreScreens } from './screens.ts'
import { CoreFailedStarts } from './failed-starts.ts'
import { terminalBridge } from './terminal.ts'
import { CoreError, Refusal } from './client.ts'
import { toolHash } from './envelope.ts'
import { CLI_NAME, CoreSettings } from './settings.ts'
import { pickSpeed } from '../common/restart.ts'
import { CoreSecrets } from './secrets.ts'
import { CoreProviderRetries } from './provider-retries.ts'
import { CoreArtifacts } from './artifacts.ts'
import { CoreChat } from './chat.ts'
import { CoreActivity } from './activity.ts'
import { CoreWorktree } from './worktree.ts'
import { CorePlaces } from './places.ts'
import { CoreBrowsers } from './browsers.ts'
import { CoreVoice } from './voice.ts'
import { CoreHeartbeats } from './heartbeats.ts'
import { CoreHealth } from './health.ts'
import { CoreAutomations } from './automations.ts'
import { CoreGitHub } from './github.ts'
import { CorePlugins } from './plugins.ts'
import { CoreUnread } from './unread.ts'
import { CoreCards } from './cards.ts'
import { CorePilotMail } from './pilot-mail.ts'
import { askText, clip, lastReply, quickChoices, TITLE_MAX, BODY_MAX } from '../../shared/alerts.ts'
import { CANCELLED, hookEnd, logEnd, NativeEnds, STOPPED } from './native-ends.ts'
import { NATIVE_UNREADABLE, cardWords, nativeAnswer, nativeCards, nativeClosed, nativeReply, type NativeAsk, type PermissionAnswer } from './native-asks.ts'
import type { CorePluginUpdates } from './plugin-updates.ts'
import type { ActivityAsk, WorktreeAsk } from '../../shared/types.ts'

interface Machine { id: string; name: string; state: string; host?: string; version?: string; session?: string | null }
interface Permission { id: string; chat: string; grant: string; question: Question; expires: number; settled?: boolean; allow?: boolean; at?: number; native?: NativeAsk; tool?: string; hash?: string; turn?: string; sub?: string }
/** the most of an agent's last words a card with no question carries: its card shows a few lines */
const NEED_TEXT = 1000
interface PendingSend { id: string; chat: string; text: string; launch?: string; state: 'queued' | 'sending' | 'uncertain' | 'cancelled'; quiet?: boolean; work?: boolean }

/** Product state is Shepherdr's; terminals, machine commands, files and agent children are core's. */
export class CoreSource extends Emitter<SourceEvents> implements Source {
  readonly kind = 'live' as const
  quiescing = false
  private human = 'You'
  readonly core: CoreSession
  readonly store: CoreStore
  readonly files: CoreFiles
  readonly mailbox: Mailbox
  readonly agents: CoreAgents
  readonly logs: CoreLogs
  readonly voices: CoreVoice
  readonly heartbeats: CoreHeartbeats
  readonly health: CoreHealth
  readonly automations: CoreAutomations
  readonly github: CoreGitHub
  readonly browsers: CoreBrowsers
  readonly places: CorePlaces
  readonly news: CoreTaskNews
  readonly tasks: CoreTasks
  readonly questions: CoreQuestions
  readonly screens: CoreScreens
  readonly failedStarts: CoreFailedStarts
  readonly settings: CoreSettings
  readonly unread: CoreUnread
  readonly cards: CoreCards
  readonly pilots: CorePilotMail
  plugins: CorePlugins
  pluginUpdates?: CorePluginUpdates
  devices: () => string[] = () => []
  pushWarnings: () => string[] = () => []
  readonly secrets: CoreSecrets
  readonly providerRetries: CoreProviderRetries
  readonly artifacts: CoreArtifacts
  readonly chats: CoreChat
  readonly activities: CoreActivity
  readonly worktrees: CoreWorktree
  private local: { id: string; name: string }
  private machines: Machine[] = []
  private permissions = new Map<string, (answer: PermissionAnswer) => void>()
  private ends = new NativeEnds()
  private faults = new Map<string, string>()
  private hooks = new Map<Action['type'], (action: Action) => Promise<unknown>>()
  private recovery?: ReturnType<typeof setInterval>
  private recovering = false
  private sending = new Set<string>()
  private refreshing?: Promise<void>
  private discoveringHomes = new Set<string>()
  private born = Date.now()

  constructor(readonly config: CoreConfig) {
    super()
    const installation = prepareHome(config.home)
    this.store = new CoreStore(config.home)
    this.unread = new CoreUnread(this.store)
    this.local = this.store.get('meta', 'local') ?? { id: installation.id, name: hostname().split('.')[0] }
    this.core = new CoreSession(config.socket)
    this.files = new CoreFiles(this.core, machine => this.route(machine))
    this.mailbox = new Mailbox(config.home, this.core, machine => this.route(machine), (grant, request, id) => this.mail(grant, request, id))
    const changed = (chat: string) => { this.reconcilePermissions(chat); this.questions?.reconcile(chat); this.screens?.reconcile(chat); this.secrets?.reconcile(chat); this.emit('chat', chat); this.emit('snapshot'); void this.flush(chat); void this.tasks?.tick().catch(error => this.faults.set('queue', error.message)) }
    this.agents = new CoreAgents(config, installation, this.core, this.store, this.mailbox, machine => this.route(machine), changed, machine => this.machines.find(item => item.id === machine) ?? {})
    this.logs = new CoreLogs(this.agents, this.files, this.store, changed, (chat, message) => { this.faults.set(chat, message) }, (chat, message) => this.fresh(chat, message), agent => this.pilots.usage.observe(agent), (agent, event) => this.nativeEnded(agent, logEnd(event)))
    this.settings = new CoreSettings(this.store, this.files, () => this.spaces(), id => this.store.get<string>('name', `m:${id}`) || (id === this.local.id ? this.local.name : this.machineName(id) || id), () => { this.emit('snapshot'); this.plannedChanged() })
    this.agents.settings = this.settings
    this.agents.observed = (agent, event) => {
      if (event.event === 'PreToolUse' && event.use) this.ends.called(agent.launch, event.use, { tool: event.tool, hash: event.input, sub: event.agent })
      this.nativeEnded(agent, hookEnd(event))
    }
    this.places = new CorePlaces(this)
    this.tasks = new CoreTasks(this)
    this.news = new CoreTaskNews(this)
    this.pilots = new CorePilotMail(this)
    this.questions = new CoreQuestions(this)
    this.screens = new CoreScreens(this)
    this.failedStarts = new CoreFailedStarts(this)
    this.cards = new CoreCards(this)
    this.secrets = new CoreSecrets(this)
    this.providerRetries = new CoreProviderRetries(this)
    this.artifacts = new CoreArtifacts(this, installation.id)
    this.chats = new CoreChat(this, installation.id)
    this.activities = new CoreActivity(this)
    this.worktrees = new CoreWorktree(this)
    this.browsers = new CoreBrowsers(this, installation.id)
    this.automations = new CoreAutomations(this)
    this.github = new CoreGitHub(this)
    this.health = new CoreHealth(this)
    this.heartbeats = new CoreHeartbeats(this)
    this.voices = new CoreVoice(this)
    this.plugins = new CorePlugins(this)
    this.core.onChange(() => { this.agents.reconcile(); this.emit('snapshot'); for (const agent of this.agents.all()) { this.reconcilePermissions(agent.chat); this.questions.reconcile(agent.chat); this.screens.reconcile(agent.chat); this.secrets.reconcile(agent.chat); void this.flush(agent.chat) } })
    this.core.onDocument(event => { void this.mailbox.event(String(event.params.data?.name ?? ''), event.params.machine).catch(error => this.faults.set('mailbox', error.message)) })
    this.core.onResync(() => { void this.refresh().then(() => this.mailbox.resync()).catch(error => this.faults.set('core', error.message)) })
  }
  async start() {
    // A previous server's in-flight mailbox claim cannot be re-executed. Mark its cards honestly as interrupted.
    this.closeInterrupted()
    for (const pending of this.store.all<PendingSend>('pending-send')) {
      if (pending.state === 'sending') {
        pending.state = 'uncertain'; this.store.set('pending-send', pending.id, pending)
        if (pending.launch) this.deliveryNotice(pending, true)
        const message = this.store.get<Message>(`message:${pending.chat}`, pending.id)
        if (message) this.store.set(`message:${pending.chat}`, pending.id, { ...message, waiting: false, waitsFor: undefined })
      }
    }
    for (const agent of this.agents.all()) {
      agent.permission = this.openPermissions(agent)[0]?.id
      if (agent.state === 'blocked' && !agent.permission) agent.state = 'working'
      this.store.set('agent', agent.chat, agent)
    }
    await this.core.start(); await this.refresh(); this.human = await humanName(this.config.home, async () => (await this.files.exec(this.local.id, ['git', 'config', '--global', 'user.name'], undefined, undefined, 3)).toString('utf8')); this.tasks.recoverProviderFallbacks(); this.logs.start(); this.screens.start(); this.failedStarts.start(); this.automations.start(); this.health.start(); this.github.start()
    this.recovery = setInterval(() => {
      if (!this.quiescing) void this.pilots.lifecycle.tick().then(() => this.pilots.completion.tick()).catch(error => this.faults.set('pilot-lifecycle', error.message))
      if (!this.quiescing) { this.pilots.wakes.tick(); this.news.deliver() }
      if (!this.quiescing) void this.providerRetries.tick().catch(error => this.faults.set('provider-retry', error.message))
      if (!this.quiescing) void this.pilots.usage.poll().catch(error => this.faults.set('pilot-usage', error.message))
      if (this.connected()) { void this.refresh().then(() => this.mailbox.resync()).catch(error => this.faults.set('core', error.message)); void this.tasks.tick().catch(error => this.faults.set('queue', error.message)); return }
      if (this.recovering || this.core.current.error?.includes('requires core')) return
      this.recovering = true
      // Restart the configured, isolated core after a crash. This never updates binaries or stops holders.
      try {
        const child = Bun.spawn([this.config.binary, 'server', 'start'], { env: coreEnvironment(this.config), stdout: 'ignore', stderr: 'ignore' })
        const deadline = setTimeout(() => child.kill(), 10_000)
        void child.exited.finally(() => { clearTimeout(deadline); this.recovering = false })
      } catch { this.recovering = false }
    }, 5000)
  }
  connected() { return this.core.current.connected }
  machineConnected(machine: string) { return this.connected() && (machine === this.local.id || this.machines.some(item => item.id === machine && item.state === 'connected')) }
  machineIds() { return [this.local.id, ...this.machines.map(machine => machine.id)] }
  localMachineId() { return this.local.id }
  machineName(machine: string) { return machine === this.local.id ? undefined : this.machines.find(item => item.id === machine)?.name }
  registerAction(type: Action['type'], handler: (action: Action) => Promise<unknown>) { this.hooks.set(type, handler) }
  requirePlugin(name: string) { if (!this.plugins.has(name)) throw Error(`The ${name} plugin is off.`) }
  override emit<K extends keyof SourceEvents>(event: K, ...args: SourceEvents[K]) {
    if (event === 'alert' && this.plugins && !this.plugins.has('alerts')) return
    super.emit(event, ...args)
  }

  async route(machine: string): Promise<string | undefined> {
    if (machine === this.local.id) return undefined
    const remote = this.machines.find(item => item.id === machine)
    if (!remote) throw new Error('This machine is not connected through core')
    if (remote.state !== 'connected') throw new Error(`${remote.name} is reconnecting`)
    return remote.name
  }
  spaces() { return this.store.all<CoreSpace>('space').filter(space => !space.removed) }
  space(id: string) { const space = this.store.get<CoreSpace>('space', id); return space?.removed ? undefined : space }
  async refresh() {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshNow().finally(() => { this.refreshing = undefined })
    return this.refreshing
  }
  private async refreshNow() {
    const status = await this.core.call<{ core: { id: string; name: string } }>('server.status')
    this.local = status.core; this.store.set('meta', 'local', this.local)
    this.machines = (await this.core.call<{ machines: Machine[] }>('machine.list')).machines
    const homeId = `p:${this.local.id}:~`
    if (!this.space(homeId)) {
      const folder = (await this.files.exec(this.local.id, ['sh', '-c', 'printf %s "$HOME"'])).toString('utf8')
      this.store.set('space', homeId, { id: homeId, name: 'home', home: true, machine: this.local.id, folder, base: 'main', prefix: 'TASK', mode: 'regular', added: Date.now() } satisfies CoreSpace)
    }
    for (const machine of this.machines.filter(item => item.state === 'connected')) {
      const id = `p:${machine.id}:~`
      if (this.space(id) || this.discoveringHomes.has(machine.id)) continue
      this.discoveringHomes.add(machine.id)
      // A disconnected remote must never delay or fail the local application startup.
      void this.files.exec(machine.id, ['sh', '-c', 'printf %s "$HOME"']).then(bytes => {
        if (!this.machines.some(item => item.id === machine.id)) return
        this.store.set('space', id, { id, name: 'home', home: true, machine: machine.id, folder: bytes.toString('utf8'), base: 'main', prefix: 'TASK', mode: 'regular', added: Date.now() } satisfies CoreSpace)
        this.faults.delete(`machine:${machine.id}`); this.emit('snapshot')
      }).catch(error => {
        machine.state = 'unreachable'; this.faults.set(`machine:${machine.id}`, error.message); this.emit('snapshot')
      }).finally(() => this.discoveringHomes.delete(machine.id))
    }
    this.agents.reconcile(); this.emit('snapshot'); this.retryPending()
    this.settings.probe(this.local.id)
    for (const machine of this.machines.filter(item => item.state === 'connected')) this.settings.probe(machine.id)
  }

  status(agent?: CoreAgent): Status {
    if (!this.connected()) return 'off'
    if (!agent) return 'idle'
    if (!this.machineConnected(agent.machine)) return 'off'
    if (this.secrets.open(agent.chat).length || this.questions.open(agent.chat).length || this.screens.open(agent.chat).length || this.openPermissions(agent).length) return 'need'
    const terminal = this.agents.terminal(agent)
    if (terminal?.state === 'finished') return 'idle'
    if (agent.pid && terminal?.pid !== agent.pid) return 'need'
    const word = terminal?.status?.state ?? agent.state
    if (word === 'blocked') return 'need'
    const provider = this.providerRetries.get(agent)
    if (provider) return provider.over ? 'need' : 'work'
    return word === 'working' || word === 'starting' ? 'work' : 'idle'
  }
  openPermissions(agent: CoreAgent) {
    return this.store.all<Permission>('permission').filter(item => item.chat === agent.chat && item.grant === agent.grant && !item.settled && item.expires > Date.now())
  }
  /** What an agent with no card last said: what its reply answers. */
  private lastWords(chat: string): Pick<Need, 'text' | 'reply'> {
    const last = lastReply({ key: chat, cli: '', messages: this.logs.messages(chat) })
    return last?.text ? { text: clip(last.text, NEED_TEXT), reply: last.id } : {}
  }
  /** Everything waiting on the human, oldest first: each agent's own open cards, and the plain waits with none. */
  private needs(tasks: Task[]): Need[] {
    const out: Need[] = []
    const sentAt = (chat: string, id: string) => this.store.get<Message>(`message:${chat}`, id)?.at
    const hidden = (chat: string) => { const task = this.tasks.forChat(chat); return !!task && !!tasks.find(view => view.id === task.id)?.archived }
    for (const agent of this.agents.all()) {
      if (!this.space(agent.space) || hidden(agent.chat)) continue
      const need = { chat: agent.chat, place: agent.space, ...(this.tasks.forChat(agent.chat) ? { task: this.tasks.forChat(agent.chat)!.id } : {}) }
      const card = (id: string, question: Question, at: number) => { if (!out.some(item => item.chat === agent.chat && item.id === id)) out.push({ ...need, id, at, question, tap: question.kind !== 'Plan' }) }
      for (const item of this.openPermissions(agent)) card(item.id, item.question, sentAt(agent.chat, `permission-${item.id}`) ?? item.at ?? 0)
      for (const item of this.questions.open(agent.chat)) card(item.id, item.question, sentAt(agent.chat, item.id) ?? 0)
      for (const item of this.screens.open(agent.chat)) card(item.id, item.question, item.at)
      for (const item of this.secrets.open(agent.chat)) out.push({ ...need, id: item.id, at: sentAt(agent.chat, item.id) ?? 0, secret: item.ask })
      // a task's own agent waits by its task's status, below
      const waits = need.task ? agent.chat !== this.tasks.get(need.task)!.chat && this.agents.terminal(agent)?.status?.state === 'blocked' : this.status(agent) === 'need'
      // a coordinator's turn ending is no wait, unless it ended on a question; the question's own time keeps its card still
      const asked = !need.task && this.status(agent) === 'idle' && this.tasks.lastWordsAsk(agent.chat)
      if ((waits || asked) && !out.some(item => item.chat === agent.chat)) {
        const words = this.lastWords(agent.chat)
        out.push({ ...need, id: 'attention', at: (asked && words.reply && sentAt(agent.chat, words.reply)) || (agent.activityAt ?? agent.started ?? 0), ...words })
      }
    }
    for (const view of tasks.filter(view => !view.archived)) {
      const task = this.tasks.get(view.id)!, sent = task.workflow === 'ready' && task.mergeQuestion ? this.store.get<Message>(`message:${task.chat}`, task.mergeQuestion) : undefined
      const question = sent?.question && this.cards.messages(task.chat, [sent])[0].question
      // a merge asked of the human keeps its pick and Send
      if (question && question.sent === undefined) out.push({ id: question.id, chat: task.chat, place: task.place, task: task.id, at: sent!.at ?? 0, question })
      else if (view.status === 'need' && !out.some(item => item.chat === task.chat)) out.push({ id: 'attention', chat: task.chat, place: task.place, task: task.id, at: this.agents.get(task.chat)?.activityAt ?? task.updatedAt ?? 0, text: view.sub, ...this.lastWords(task.chat) })
    }
    return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
  }
  snapshot(): Snapshot {
    const spaces = this.spaces()
    const asks: Record<string, string> = {}
    const tasks = this.tasks.all().filter(task => spaces.some(space => space.id === task.place)).map(task => this.tasks.view(task))
    const needs = this.needs(tasks)
    for (const need of needs) if (need.id !== 'attention') asks[need.chat] = need.id
    return {
      terminalTransport: 'core', name: 'Shepherdr', host: this.local.id, user: this.store.get<string>('setting', 'user') || this.human,
      ...this.places.present(spaces.map(space => ({ id: space.id, name: coreSpaceName(this, space), machine: space.machine, home: space.home,
        level: space.home ? space.machine === this.local.id ? 0 : 1 : 2, status: this.machineConnected(space.machine) ? this.status(this.agents.get(space.id)) : 'off', mode: space.mode, chat: space.id })),
      [{ id: `m:${this.local.id}`, machine: this.local.id, name: this.local.name, health: this.health.view(this.local.id), status: this.connected() ? 'idle' : 'off' },
        ...this.machines.map(machine => ({ id: `m:${machine.id}`, machine: machine.id, name: machine.name, health: this.health.view(machine.id), status: machine.state === 'connected' ? 'idle' as const : 'off' as const }))]),
      tasks, artifacts: this.artifacts.list().filter(artifact => spaces.some(space => space.id === artifact.place)), automations: this.automations.view(), asks, needs,
      settings: this.secrets.pages([...this.settings.sections(this.devices(), this.pushWarnings()).map(section => this.pilots.wakes.section(section)), this.plugins.section(this.pluginUpdates?.status()), { name: 'Machines', about: 'Every machine Shepherdr reaches, and how it is now.', rows: [
        { label: this.store.get<string>('name', `m:${this.local.id}`) || this.local.name, key: '', value: this.connected() ? 'Main · reachable' : "Main · can't reach", fixed: true },
        ...this.machines.map(machine => ({ label: this.store.get<string>('name', `m:${machine.id}`) || machine.name, key: '', value: this.machineConnected(machine.id) ? 'Reachable' : "Can't reach", fixed: true })),
      ] }, ...spaces.filter(space => !space.home).flatMap(space => [repositorySection(space.id, space.machine, space.base), taskIdsSection(space.id, space.machine, space.prefix, taskSequence(this.store, space).last + 1)])]),
      last: this.unread.last(), read: this.unread.read(),
    }
  }
  chatStatus(chat: string) { return this.status(this.agents.get(chat)) }
  chat(key: string): Chat | undefined {
    const agent = this.agents.get(key)
    if (!agent && !this.space(key) && !this.tasks.forChat(key)) return undefined
    const terminal = agent && this.agents.terminal(agent)
    const status = this.status(agent)
    const saved = this.cards.messages(key, this.logs.messages(key)), words = agent ? this.agentWords(agent) : this.plannedWords(key)
    // Saved as waiting until delivered; the chat says so only while something really keeps it out.
    const hold = saved.some(message => message.waiting) ? this.hold(key) : undefined
    const messages = saved.map(message => message.waiting ? { ...message, waiting: !!hold, waitsFor: hold?.waitsFor } : message)
    return { key, ...this.activities.chat(key, messages, terminal?.state === 'live' && status === 'work'), cli: CLI_NAME[words.kind as AgentKind], working: status === 'work',
      failed: this.store.all<PendingSend>('pending-send').filter(item => item.chat === key && item.state === 'uncertain').map(item => ({ cid: item.id, error: 'Delivery was interrupted; check the chat before sending again' })),
      finished: !!agent && terminal?.state === 'finished', agent: words }
  }
  /** what it was asked to run on and what its records say runs, with the names the catalog knows */
  private agentWords(agent: CoreAgent): NonNullable<Chat['agent']> {
    const kind = agent.kind, runtime = agent.runtime
    // a hook may report a model with its context size: claude-opus-5-5[1m]
    const label = (model?: string) => (model ? this.settings.findModel(kind, model, agent.space ?? '')?.label : undefined)
    const modelLabel = label(agent.model), runtimeLabel = label(runtime?.model?.replace(/\[.*\]$/, ''))
    return { kind, model: agent.model, ...(modelLabel ? { modelLabel } : {}), effort: agent.effort, speed: agent.speed, runtime: runtime && runtimeLabel ? { ...runtime, modelLabel: runtimeLabel } : runtime }
  }
  /** Settings changed: an open chat with no agent yet says what they will use now */
  private plannedChanged() {
    for (const chat of [...this.spaces().map(space => space.id), ...this.tasks.all().filter(task => !['merged', 'closed'].includes(task.workflow)).map(task => task.chat)]) if (!this.agents.get(chat)) this.emit('chat', chat)
  }
  /** no agent yet: what Settings will start it on. A task's own pick is no Setting: that stays what was asked for */
  private plannedWords(key: string): NonNullable<Chat['agent']> {
    const task = this.tasks.forChat(key), level = task?.place ?? key, own = task?.chat === key ? task : undefined
    const want = this.settings.agent(own ? 'task' : task ? 'reviewer' : this.space(key)?.mode === 'autopilot' ? 'autopilot' : 'coordinator', level)
    const { kind, model, effort } = own ?? (task ? { kind: task.review.kind, model: task.reviewerModel, effort: task.reviewerEffort } : want)
    const modelLabel = model ? this.settings.findModel(kind, model, level)?.label : undefined
    const words = { model, ...(modelLabel ? { modelLabel } : {}), effort }
    return kind === want.kind && model === want.model && effort === want.effort ? { kind, planned: words } : { kind, ...words }
  }
  /** What keeps a message out of this chat's agent now; {} is a machine out of reach. A working agent keeps nothing out: it takes it at once. */
  private hold(chat: string): { waitsFor?: Message['waitsFor'] } | undefined {
    const task = this.tasks.forChat(chat), space = this.space(chat) || task && this.space(task.place), agent = this.agents.get(chat)
    if (!space || !this.machineConnected(agent?.machine ?? space.machine)) return {}
    const terminal = agent && this.agents.terminal(agent)
    if (agent && (this.openPermissions(agent).length || this.screens.open(chat).length || terminal?.status?.state === 'blocked')) return { waitsFor: 'menu' }
    if (this.pilots.lifecycle.busy(space.id) || this.pilots.completion.busy(space.id) || task?.capacity) return { waitsFor: 'start' }
    if (!agent || agent.state === 'starting' || terminal?.state !== 'live') return { waitsFor: 'start' }
  }
  private agentKind(): AgentKind { return this.store.get<string>('setting', 'agent') === 'codex' ? 'codex' : 'claude' }
  post(chat: string, message: Message) {
    this.logs.outgoing(chat, message)
    this.emit('snapshot')
  }
  private fresh(chat: string, message: Message) {
    if (!this.unread.saw(chat, message.at) || !this.space(chat) || !message.at || message.at < this.born || message.card || message.question) return
    this.emit('alert', { id: message.id, from: 'Shepherdr', title: clip(this.store.get<string>('name', chat) || this.space(chat)!.name, TITLE_MAX), body: clip(message.text || 'New message', BODY_MAX), go: { place: chat, focus: message.id }, message: true })
  }
  forwardQuestion(chat: string, question: Question, answer?: string, outcome = 'Answered') {
    const task = this.tasks.forChat(chat)
    if (!task) return
    const id = `ask-${question.id}`, previous = this.store.get<Message>(`message:${task.place}`, id)
    this.post(task.place, { id, who: 'agent', at: previous?.at ?? Date.now(), card: { id, task: task.id, status: answer ? this.tasks.view(task).status : 'need', text: answer ? outcome : 'Needs you',
      ask: { chat, questions: [question], open: answer === undefined, answered: answer === undefined ? undefined : { where: 'task', text: answer } } } })
  }
  /** Cards a previous server held. The agent's own answer says only that it was refused; alone with that, it can give up on the work. */
  private closeInterrupted() {
    const denied = new Map<string, string[]>(), calls = new Set<string>()
    for (const permission of this.store.all<Permission>('permission')) {
      if (permission.settled) continue
      this.expirePermission(permission, 'Shepherdr restarted; ask again')
      // One line for a tool call: its first card may be answered already, with a later one still open.
      const call = permission.native?.head ?? permission.id
      if (this.agents.get(permission.chat)?.grant !== permission.grant || calls.has(call)) continue
      calls.add(call); denied.set(permission.chat, [...denied.get(permission.chat) ?? [], cardWords(permission.question, !!permission.native, permission.tool)])
    }
    for (const [chat, words] of denied) {
      const text = `Shepherdr restarted, so this was denied, though nobody refused it: ${words.join('; ')}. Ask again if it's still needed.`, id = `restart-denied-${randomUUID()}`
      this.saveAndDeliver(chat, id, `<restart>${text.replaceAll('<', '\\u003c')}</restart>`, () => this.post(chat, { id, who: 'agent', text, at: Date.now() }), true)
    }
  }
  private expirePermission(permission: Permission, reason: string) {
    if (permission.settled) return
    permission.settled = true; permission.allow = false; permission.question.sent = -1; permission.question.said = reason
    permission.question.closed = reason
    this.store.set('permission', permission.id, permission)
    this.settleAgent(permission)
    const message = this.store.get<Message>(`message:${permission.chat}`, `permission-${permission.id}`)
    this.post(permission.chat, { ...message, id: `permission-${permission.id}`, who: 'agent', question: permission.question, at: message?.at ?? Date.now() })
    this.forwardQuestion(permission.chat, permission.question, reason, 'No longer waiting')
    if (!permission.native || permission.native.head === permission.id) this.clearAlert(permission.chat, reason)
    if (permission.native) {
      this.replyNative(permission.native, nativeClosed(reason))
      for (const card of this.nativeRows(permission.native.head)) this.expirePermission(card, reason)
      return
    }
    this.permissions.get(permission.id)?.({ allow: false }); this.permissions.delete(permission.id)
  }
  /** A phone that showed this chat's card drops its alert and takes the new count, without a sound. */
  clearAlert(chat: string, reason: string) {
    const space = this.agents.get(chat)?.space, task = this.tasks.forChat(chat)
    if (space) this.emit('alert', { id: randomUUID(), from: 'Shepherdr', title: 'No longer waiting', body: reason, go: { place: space }, tag: chat, ...(task ? { task: true as const } : {}), clear: true })
  }
  /** The agent's record follows its open cards; what ended a card may already have moved its state on. */
  private settleAgent(permission: Permission) {
    const agent = this.agents.get(permission.chat)
    if (!agent || agent.grant !== permission.grant) return
    agent.permission = this.openPermissions(agent)[0]?.id
    if (agent.permission) agent.state = 'blocked'
    else if (agent.state === 'blocked') agent.state = 'working'
    this.store.set('agent', agent.chat, agent)
  }
  private nativeRows(head: string) { return this.store.all<Permission>('permission').filter(item => item.native?.head === head) }
  private replyNative(native: NativeAsk, reply: PermissionAnswer) {
    const head = this.store.get<Permission>('permission', native.head)
    if (head?.native) { head.native.reply ??= reply; this.store.set('permission', head.id, head) }
    this.permissions.get(native.head)?.(head?.native?.reply ?? reply); this.permissions.delete(native.head)
  }
  denyPermissions(agent: CoreAgent, reason: string) {
    for (const permission of this.store.all<Permission>('permission')) if (permission.chat === agent.chat && permission.grant === agent.grant && !permission.settled) this.expirePermission(permission, reason)
  }
  private nativeEnded(agent: CoreAgent, end?: ReturnType<typeof hookEnd>) {
    if (!end) return
    this.ends.ended(agent.launch, end)
    this.reconcilePermissions(agent.chat)
  }
  /** Oldest first: a tool result closes the longest-waiting card of that call. */
  private reconcilePermissions(chat: string) {
    const cards = this.store.all<Permission>('permission').filter(permission => permission.chat === chat && !permission.settled).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    for (const permission of cards) {
      if (this.store.get<Permission>('permission', permission.id)?.settled) continue
      const agent = this.agents.get(chat)
      const reason = permission.expires <= Date.now() ? 'Permission request expired' : agent?.grant !== permission.grant ? 'Session replaced; ask the agent for a fresh card'
        : this.agents.terminal(agent)?.state === 'finished' ? STOPPED
        : this.ends.over(agent.launch, permission, agent.kind)
      if (reason) this.expirePermission(permission, reason)
    }
  }

  async act(action: Action): Promise<unknown> {
    if (this.quiescing) throw new Error('Shepherdr is stopping; retry after it reconnects')
    const plugin = action.type.startsWith('artifact-') ? 'artifacts' : action.type === 'react' ? 'reactions' : action.type === 'browser-notes' ? 'browser' : ['keys', 'text'].includes(action.type) ? 'terminal' : action.type === 'call' ? 'voice' : action.type === 'autopilot-run' ? 'autopilot' : undefined
    if (plugin) this.requirePlugin(plugin)
    const handler = this.hooks.get(action.type)
    if (handler) return handler(action)
    if ('chat' in action && this.tasks.forChat(action.chat) && ['pin', 'archive', 'pause', 'stop', 'restart-info', 'restart', 'close', 'delete'].includes(action.type)) return this.tasks.act(action)
    switch (action.type) {
      case 'plugin': return this.plugins.act(action)
      case 'send': {
        if (!action.text.trim() && !action.attachments?.length) return {}
        const run = async () => {
          const task = this.tasks.forChat(action.chat)
          const space = this.space(action.chat) || task && this.space(task.place)
          if (!space) throw new Error('No such coordinator space')
          const prepare = async () => {
            this.providerRetries.clear(action.chat)
            const text = await this.chats.text(action, space.machine)
            if (modelCommand(text) !== undefined) throw new Error('/model would change every later agent on this device. Use Restart agent to change this one')
            const id = action.cid || randomUUID()
            this.store.db.transaction(() => {
              this.store.set('pending-send', id, { id, chat: action.chat, text, state: 'queued' } satisfies PendingSend)
              this.post(action.chat, { id, cid: action.cid, who: 'you', text, at: Date.now(), waiting: true })
            })()
            await this.flush(action.chat)
            const hold = this.store.get<Message>(`message:${action.chat}`, id)?.waiting ? this.hold(action.chat) : undefined
            return { ok: true, waiting: !!hold, waitsFor: hold?.waitsFor }
          }
          if (!task) return prepare()
          const result = await this.tasks.change(task.id, prepare)
          this.retry(action.chat)
          return result
        }
        return action.cid ? this.store.command(action.cid, action, run) : run()
      }
      case 'answer': {
        if (await this.tasks.answer(action.question, action.choice, action.chat)) return { ok: true }
        if (await this.questions.answer(action)) return { ok: true }
        if (await this.screens.answer(action)) return { ok: true }
        // What the records already say must win this tap, without a slow machine holding the tap up.
        const open = this.store.get<Permission>('permission', action.question)
        if (open && !open.settled) await Promise.race([this.logs.catchUp(action.chat), Bun.sleep(1500)])
        const permission = this.store.get<Permission>('permission', action.question)
        if (!permission || permission.chat !== action.chat || permission.settled) throw new Refusal(permission?.question.closed ? `This card has closed: ${permission.question.closed}` : 'This request is no longer waiting for an answer')
        if (permission.expires <= Date.now() || this.agents.get(action.chat)?.grant !== permission.grant) throw new Error('This permission belongs to an expired or replaced agent session')
        const native = permission.native, answer = native && nativeAnswer(permission.question, action)
        if (!native && action.choice !== 0 && action.choice !== 1) throw new Error('Choose Allow once or Deny')
        const allow = answer ? answer.allow : action.choice === 0
        permission.settled = true; permission.allow = allow; permission.question.sent = answer ? answer.sent : action.choice
        if (native && answer) { native.answer = permission.question.said = answer.said }
        this.store.set('permission', permission.id, permission)
        this.settleAgent(permission)
        const message = this.store.get<Message>(`message:${action.chat}`, `permission-${permission.id}`)
        this.post(action.chat, { ...message, id: `permission-${permission.id}`, who: 'agent', question: permission.question, at: message?.at ?? Date.now() })
        this.forwardQuestion(action.chat, permission.question, answer?.said ?? (allow ? 'Allow once' : 'Deny'))
        if (native && answer) {
          const cards = this.nativeRows(native.head)
          if (cards.some(card => !card.settled)) return { answered: true }
          this.replyNative(native, nativeReply(native, cards, answer.sent, action.note?.trim()))
          return { answered: true }
        }
        this.permissions.get(permission.id)?.({ allow }); this.permissions.delete(permission.id)
        return { answered: true }
      }
      case 'mode':
        if (action.mode === 'autopilot') { this.requirePlugin('autopilot'); return this.pilots.lifecycle.start(action.place, this.settings.pilot(action.place)) }
        if (action.mode !== 'regular') throw Error('Choose regular or Autopilot')
        return this.pilots.lifecycle.regular(action.place, action.keepWorkers)
      case 'autopilot-run': return this.pilots.wakes.request(action.place)
      case 'automation': return this.automations.act(action)
      case 'call': if (!this.chat(action.chat)) throw new Error('No such chat'); return {}
      case 'browser-notes': return this.browsers.notes(action)
      case 'artifact-send': case 'artifact-note': case 'artifact-say': case 'artifact-delete': return this.artifacts.act(action)
      case 'secret': case 'secret-saved': return this.secrets.act(action)
      case 'setting':
        if (action.key === 'space.base') {
          if (!action.place || !action.value) throw new Error('Choose a repository space and branch.')
          await this.places.setBase(action.place, action.value); return { ok: true }
        }
        if (action.key.startsWith('taskIds.')) {
          if (!action.place || this.places.removing(action.place)) throw new Error('Select a repository space in Settings.')
          setTaskIdSetting(this.store, action.place, action.key, action.value); this.emit('snapshot'); return { ok: true }
        }
        if (action.key === 'heartbeat.md') {
          const space = this.space(action.place || '')
          if (!space || typeof action.value !== 'string') throw Error('Choose this space and provide its heartbeat checklist')
          this.heartbeats.write(space, action.value); return {}
        }
        if (action.key.startsWith('plugin.')) {
          if (!this.pluginUpdates) throw Error('Plugin controls are disabled for this development preview')
          if (action.place && action.place !== 'all' || !['on', 'off'].includes(action.value || '')) throw Error('Plugins apply Everywhere; choose on or off')
          this.pluginUpdates.set(action.key.slice(7), action.value === 'on'); this.emit('snapshot'); return {}
        }
        this.settings.set(action.key, action.value, action.place || 'all'); return {}
      case 'keys': case 'text': {
        const agent = this.agents.get(action.chat)
        const terminal = agent && this.agents.terminal(agent)
        if (!terminal || terminal.state !== 'live') throw new Error('This terminal is stopped')
        if (action.type === 'keys') return this.core.call('terminal.keys', { terminal: terminal.address, keys: action.keys })
        const stream = await this.core.attach(terminal.address, { data() {}, close() {} }, terminal.cols, terminal.rows)
        stream.input(Buffer.from(action.text)); stream.close(); return {}
      }
      case 'read': if (this.unread.mark(action.chats)) this.emit('snapshot'); return {}
      case 'space-remove': return this.places.remove(action.place)
      case 'rename': case 'order': case 'move': case 'section': return this.places.act(action)
      case 'react': {
        const text = this.chats.reaction(action.chat, action.message, action.emoji), id = randomUUID()
        this.store.db.transaction(() => {
          this.store.set('pending-send', id, { id, chat: action.chat, text, state: 'queued' } satisfies PendingSend)
          this.post(action.chat, { id, who: 'you', text, at: Date.now(), waiting: true })
        })()
        await this.flush(action.chat); return {}
      }
      case 'restart-info': {
        const agent = this.agents.get(action.chat)
        return { ok: true, info: { role: 'coordinator', space: this.space(action.chat)?.name, on: { kind: agent?.kind ?? this.agentKind(), model: agent?.model, effort: agent?.effort, speed: agent?.speed }, onKnown: !!agent,
          onWords: agent?.kind ?? this.agentKind(), want: this.settings.agent(this.space(action.chat)?.mode === 'autopilot' ? 'autopilot' : 'coordinator', action.chat), clis: this.settings.clis(action.chat), working: agent?.state === 'working' } }
      }
      case 'restart': {
        if (this.space(action.chat)?.mode === 'autopilot') {
          const agent = this.agents.get(action.chat), kind = action.kind || agent?.kind
          if (kind !== 'claude' && kind !== 'codex') throw Error('Choose Claude Code or Codex')
          const choice = this.settings.checkedAgent(action.chat, { kind, model: action.model, effort: action.effort })
          await this.pilots.lifecycle.restart(action.chat, { ...choice, speed: pickSpeed(action.speed, agent?.speed) })
          if (action.save) this.settings.saveAgent('autopilot', action.chat, choice)
          return {}
        }
        if (this.agents.get(action.chat)?.pilot) throw new Error('Finish changing Autopilot mode before replacing this coordinator')
        const space = this.space(action.chat)
        if (!space) throw new Error('No such coordinator')
        const agent = this.agents.get(action.chat)
        const kind = action.kind || agent?.kind || this.agentKind()
        if (kind !== 'claude' && kind !== 'codex') throw new Error('Choose Claude Code or Codex')
        await this.pilots.lifecycle.regularRestart(space.id, { kind, model: action.model, effort: action.effort, speed: pickSpeed(action.speed, agent?.speed) }, action.save)
        return {}
      }
      default: throw new Error(`This rewrite slice has not implemented ${action.type} yet; see the parity checklist`)
    }
  }

  cancelQueued(chat: string) {
    this.providerRetries.clear(chat)
    this.store.db.transaction(() => {
      for (const item of this.store.all<PendingSend>('pending-send').filter(item => item.chat === chat && item.state === 'queued')) {
        item.state = 'cancelled'; this.store.set('pending-send', item.id, item)
        const message = this.store.get<Message>(`message:${chat}`, item.id)
        if (message) this.store.set(`message:${chat}`, item.id, { ...message, waiting: false, waitsFor: undefined })
        if (!item.quiet) this.post(chat, { id: `cancelled-${item.id}`, who: 'agent', text: 'Stopped before your saved message was sent.', at: Date.now() })
      }
    })()
  }
  retryPending() {
    for (const chat of new Set(this.store.all<PendingSend>('pending-send').filter(item => item.state === 'queued').map(item => item.chat))) this.retry(chat)
  }
  retry(chat: string) {
    if (this.quiescing) return
    queueMicrotask(() => { if (!this.quiescing) void this.flush(chat) })
  }
  private async flush(chat: string) {
    if (this.quiescing || this.sending.has(chat) || !this.connected()) return
    this.sending.add(chat)
    let progressed = false
    try {
      const pending = this.store.all<PendingSend>('pending-send').filter(item => item.chat === chat && item.state === 'queued')
      for (const item of pending) {
        if (this.quiescing) return
        if (item.id.startsWith('provider-retry-') && !this.store.get('pending-send', item.id)) continue
        const task = this.tasks.forChat(chat)
        const space = this.space(chat) || task && this.space(task.place)
        if (!space) return
        if (this.pilots.lifecycle.busy(space.id) || this.pilots.completion.busy(space.id)) return
        if (task && this.tasks.busy(task.id)) return
        const agent = this.agents.get(chat)
        if (this.machines.some(machine => machine.id === (agent?.machine ?? space.machine) && machine.state !== 'connected')) return // Held until refresh sees it back.
        if (item.launch && (agent?.launch !== item.launch || this.agents.terminal(agent)?.state !== 'live')) { item.state = 'uncertain'; this.store.set('pending-send', item.id, item); this.deliveryNotice(item, true); continue }
        if (agent && (agent.state === 'starting' || this.openPermissions(agent).length)) return
        item.state = 'sending'; this.store.set('pending-send', item.id, item)
        try {
          if (!item.id.startsWith('provider-retry-')) this.providerRetries.clear(chat)
          if (task) await this.tasks.deliver(task.id, chat, item.text, !!item.launch && !item.work)
          else if (agent && this.agents.terminal(agent)?.state === 'live') await this.agents.send(chat, item.text)
          else {
            if (space.mode === 'autopilot' || agent?.pilot) throw new Error('This contained coordinator has stopped; change mode or explicitly restart its contained run before sending')
            const pick = this.settings.agent('coordinator', space.id)
            await this.agents.launch(space, chat, agent?.kind ?? pick.kind, item.text, agent ? { model: agent.model, effort: agent.effort, speed: agent.speed, resume: true } : { ...pick, resume: true })
          }
          progressed = true
          const message = this.store.get<Message>(`message:${chat}`, item.id)
          if (message) { this.store.set(`message:${chat}`, item.id, { ...message, waiting: false, waitsFor: undefined }); this.emit('chat', chat) }
        } catch (error) {
          if (error instanceof CoreError && ['blocked', 'status_mismatch', 'busy'].includes(error.kind)) {
            item.state = 'queued'; this.store.set('pending-send', item.id, item); this.emit('chat', chat); return
          }
          item.state = 'uncertain'; this.store.set('pending-send', item.id, item)
          if (item.launch) this.deliveryNotice(item, true)
          const message = this.store.get<Message>(`message:${chat}`, item.id)
          if (message) this.store.set(`message:${chat}`, item.id, { ...message, waiting: false, waitsFor: undefined })
          this.faults.set(chat, (error as Error).message)
          this.emit('chat', chat); return
        }
      }
    } finally {
      this.sending.delete(chat)
      if (progressed && this.store.all<PendingSend>('pending-send').some(item => item.chat === chat && item.state === 'queued')) this.retry(chat)
    }
  }

  private async mail(grant: Grant, request: MailRequest, requestId: string): Promise<unknown> {
    if (this.quiescing) throw new Error('Shepherdr is stopping; retry after it reconnects')
    const agent = this.agents.get(grant.chat)
    const terminal = agent && this.agents.terminal(agent)
    if (!agent || agent.launch !== grant.session || agent.grant !== grant.id || terminal?.state !== 'live' || agent.pid && terminal.pid !== agent.pid) throw new Error('This session is no longer active')
    if (agent && this.store.get<CoreSpace>('space', agent.space)?.removed) throw new Error('This space was removed; add it again before using its product commands')
    if (request.action === 'pilot') return this.pilots.mail(agent, grant, request, requestId)
    // Contained calls use their private run/actor binding and checked product brokers. UI controls remain unoffered.
    if (agent.pilot) {
      if (request.action === 'cli') return this.pilots.commands.cli(agent, grant, (request.args as { args: string[] }).args)
      if (request.action === 'secret') return this.pilots.commands.secret(agent, request.args)
      throw new Error('This operation is outside the contained product command profile')
    }
    if (request.action === 'cli') {
      const input = request.args as { args?: unknown }
      if (!Array.isArray(input.args) || !input.args.every(arg => typeof arg === 'string')) throw new Error('Invalid command words')
      const args = input.args as string[]
      if (!args.length || args[0] === 'help' || args.includes('--help')) return { out: `Shepherdr standalone core commands (authenticated agent session):
  show [--space NAME | --machine] [--section NAME] | models [claude|codex]
  set KEY VALUE | unset KEY [--space NAME | --machine] (regular coordinator, when the human asks)
  alert TITLE [--body WHY] [--task ID]
  space list | space add PATH [--name NAME] | space rename NAME NEW_NAME | space remove NAME
  space set base BRANCH --space NAME
  task add TITLE --brief FULL_BRIEF [--desc FULL_BRIEF] [--agent claude|codex] [--model ID] [--effort LEVEL]
    [--reviewer claude|codex] [--reviewer-model ID] [--reviewer-effort LEVEL] [--set KEY=VALUE]
    [--space NAME] [--base BRANCH] [--later] [--after ID,ID]
  task list [--archived] [--space NAME] [--after next] | task show ID [--from nextFrom --revision REV]
  task chat ID [--limit 1..100] [--before CURSOR]
  task start ID [MESSAGE] | task tell ID TEXT
  task queue ID --after ID,ID|none | task stop ID
  task pause|pin|unpin|unarchive ID (coordinator only, when the human asks)
  task close|delete ID [--force] (coordinator only; force may discard held work on delete)
  task review-more ID (coordinator only; one more review round once all are used)
  status ID TEXT --done 0..100 --left 5m|1h20m
  ask TITLE --choice LABEL --choice LABEL | plan [ID] --title TITLE --step TEXT --step TEXT
  review ID | pr ID | checks ID [--comments [--offset N] [--from nextFrom]]
  ready ID --summary TEXT [--facts TEXT]
  merge ID (follows the task's Merge setting; only "ask the human first" needs their yes on its card)
  heartbeat [SPACE] | heartbeat set [SPACE] < FILE
  automation add NAME --task TITLE --brief TEXT --when "FREQ=MINUTELY;INTERVAL=30" | --on EVENTS [--space NAME]
  automation edit|list|pause|resume|run|remove NAME
  todo ID | task close ID
  artifact new FILE --title TITLE | update ID [FILE] [--data JSON] | check FILE | show ID | list | remove ID
  secret list | secret ask NAME --why TEXT [--force]
  secret run NAME [NAME …] -- COMMAND | secret env NAME [NAME …] --file .env
Use hc for starting, messaging and waiting on core child agents. Never use a web URL or legacy helper for core commands.
`, code: 0 }
      if (args[0] === 'secret') {
        if (!grant.actions.includes('secret')) throw new Error('This session has no secret permission')
        return { out: await this.secrets.cli(agent, args) + '\n', code: 0 }
      }
      if (args[0] === 'artifact') {
        this.requirePlugin('artifacts')
        if (!grant.actions.includes('artifact')) throw new Error('This session has no artifact permission')
        return { out: await this.artifacts.cli(agent, args, typeof (input as { cwd?: unknown }).cwd === 'string' ? (input as { cwd: string }).cwd : this.space(agent.space)!.folder), code: 0 }
      }
      if (args[0] === 'heartbeat') {
        const stdin = (input as { stdin?: unknown }).stdin
        if (stdin !== undefined && typeof stdin !== 'string') throw new Error('Invalid heartbeat input')
        return { out: this.heartbeats.cli(agent, args, stdin) + '\n', code: 0 }
      }
      if (args[0] === 'automation') return { out: await this.automations.cli(agent, args) + '\n', code: 0 }
      const common = await new CoreCommands(this).cli(agent, grant, args)
      if (common) return common
      if (args[0] === 'ask' || args[0] === 'plan') return { out: `Asked: ${this.questions.create(grant, args)}\n`, code: 0 }
      if (args[0] === 'space') return { out: await this.places.cli(agent, args) + '\n', code: 0 }
      return this.tasks.cli(grant, args)
    }
    if (request.action === 'secret') return this.secrets.use(agent, request.args)
    if (request.action !== 'permission') throw new Error('This command is not connected in this rewrite slice')
    const { cancel, gone } = request.args as { cancel?: unknown; gone?: unknown }
    if (typeof cancel === 'string' && /^[a-f0-9-]{36}$/.test(cancel)) { this.cancelPermission(grant, cancel, gone === true ? STOPPED : CANCELLED); return {} }
    return this.requestPermission(agent, grant, request, requestId)
  }

  cancelPermission(grant: Grant, id: string, reason = CANCELLED) {
    const now = Date.now(), kind = `permission-cancel:${grant.id}`
    for (const item of this.store.all<{ id: string; at: number }>(kind)) if (now - item.at > 24 * 60 * 60_000) this.store.delete(kind, item.id)
    if (!this.store.get(kind, id) && this.store.all(kind).length >= 10_000) throw Error('Too many cancelled permission requests in this session')
    this.store.set(kind, id, { id, at: now })
    const permission = this.store.get<Permission>('permission', id)
    if (permission?.grant === grant.id && permission.chat === grant.chat) this.expirePermission(permission, reason)
  }

  /** Internal dispatch after authenticating the current launch; cancellation always wins a later answer. */
  requestPermission(agent: CoreAgent, grant: Grant, request: MailRequest, requestId: string): Promise<unknown> | PermissionAnswer {
    const input = request.args as { id?: string; tool?: string; input?: unknown; at?: number; agent?: string; turn?: string }
    if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id) || input.id !== requestId) throw new Error('Invalid permission request identity')
    if (this.store.get(`permission-cancel:${grant.id}`, input.id)) return { allow: false }
    const previous = this.store.get<Permission>('permission', input.id)
    if (previous && (previous.grant !== grant.id || previous.chat !== grant.chat)) throw new Error('Permission id belongs to another session')
    if (previous?.settled) return previous.native?.reply ?? { allow: previous.allow === true }
    const native = agent.kind === 'claude' ? nativeCards(input.tool, input.input, input.id, agent.permissionMode) : undefined
    if (native && !native.questions.length) return NATIVE_UNREADABLE
    const questions = native?.questions ?? [{ id: input.id, title: `${agent.kind === 'claude' ? 'Claude Code' : 'Codex'} asks to use ${String(input.tool || 'a tool').slice(0, 100)}`,
      kind: 'Question' as const, choices: [{ label: 'Allow once' }, { label: 'Deny' }], to: grant.chat, noNote: true,
      screen: JSON.stringify(input.input, null, 2)?.slice(0, 16_000) }]
    const rows = questions.map((question): Permission => ({ id: question.id, chat: grant.chat, grant: grant.id, question, expires: request.expires, at: Number.isFinite(input.at) ? input.at : Date.now(), tool: input.tool, hash: toolHash(input.input), turn: input.turn, sub: input.agent, ...(native ? { native: { ...native.native, head: input.id! } } : {}) }))
    const permission = rows[0], question = permission.question
    // Posting a card reconciles it, and after a reconnect its end can be on record already: the wait comes first.
    const answered = new Promise<PermissionAnswer>(resolve => {
      const timer = setTimeout(() => {
        this.expirePermission(permission, 'Permission request expired')
      }, Math.max(1, request.expires - Date.now() - 1000))
      this.permissions.set(input.id!, answer => { clearTimeout(timer); resolve(answer) })
    })
    agent.state = 'blocked'; agent.permission = input.id; this.store.set('agent', agent.chat, agent)
    for (const row of rows) this.store.set('permission', row.id, row)
    const waiting = () => !this.store.get<Permission>('permission', input.id!)?.settled
    for (const row of rows) {
      if (!waiting()) return answered
      this.post(grant.chat, { id: `permission-${row.id}`, who: 'agent', question: row.question, at: Date.now() })
      if (waiting()) this.forwardQuestion(grant.chat, row.question)
    }
    if (!waiting()) return answered
    const task = this.tasks.forChat(grant.chat)
    this.emit('alert', { id: input.id, from: 'Shepherdr', ...(native ? askText(task?.id || this.space(agent.space)?.name || 'Shepherdr', question) : { title: question.title, body: 'Waiting for your permission' }), go: { place: agent.space, focus: input.id }, tag: grant.chat,
      card: { chat: grant.chat, question: input.id, choices: native ? quickChoices(question) : question.choices.map((choice, index) => ({ label: choice.label, choice: index })) } })
    return answered
  }

  async folders(machine: string, path: string): Promise<Folders> {
    // a refusal reaches the screen as its own words: bun's report of an uncaught throw holds the script and its paths
    const script = `const f=require('node:fs'),p=require('node:path'),o=require('node:os'),c=require('node:child_process');try{const raw=process.argv.at(-1),home=f.realpathSync(o.homedir()),target=p.resolve(raw==='~'?home:raw.startsWith('~/')?p.join(home,raw.slice(2)):raw);let x={path:target,exists:f.existsSync(target),dir:false,repo:null,entries:[]};let near=target;while(!f.existsSync(near))near=p.dirname(near);const real=f.realpathSync(near);if(real!==home&&!real.startsWith(home+p.sep))throw Error('Choose a folder in your home.');if(x.exists){x.dir=f.statSync(real).isDirectory();if(x.dir){let g=c.spawnSync('git',['-C',real,'rev-parse','--show-toplevel'],{encoding:'utf8'});x.repo=g.status===0?g.stdout.trim():null;x.entries=f.readdirSync(real,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith('.')).slice(0,200).map(e=>({name:e.name,path:p.join(real,e.name),repo:f.existsSync(p.join(real,e.name,'.git'))}));}}console.log(JSON.stringify(x))}catch(e){process.stderr.write(e.message);process.exit(1)}`
    const result = JSON.parse((await this.files.exec(machine, [await this.agents.bun(machine), '-e', script, '--', path])).toString('utf8')) as Folders
    for (const entry of result.entries) entry.added = this.spaces().some(space => space.machine === machine && space.folder === entry.path)
    result.added = this.spaces().some(space => space.machine === machine && space.folder === result.repo)
    return result
  }
  async addSpace(request: AddSpace) {
    const folder = await this.folders(request.machine, request.path)
    if (request.create && !folder.repo) await newRepository(this.files, request.machine, await this.agents.bun(request.machine), folder.path)
    const repo = await this.folders(request.machine, folder.path)
    if (!repo.repo) throw new Error('Choose a git repository')
    try { await this.tasks.git.head({ machine: request.machine, folder: repo.repo }) }
    catch { throw new Error('The repository needs a first commit before it can become a space') }
    const saved = this.store.all<CoreSpace>('space')
    const existing = saved.find(space => space.machine === request.machine && space.folder === repo.repo)
    if (existing) {
      if (this.places.removing(existing.id)) throw Error('This space is being removed; retry shortly')
      if (existing.removed) {
        const display = request.name || this.store.get<string>('name', existing.id) || existing.name
        const problem = nameProblem(display, this.places.names(request.machine, existing.id))
        if (problem) throw Error(problem)
        if (request.name) this.store.set('name', existing.id, request.name)
        delete existing.removed; this.store.set('space', existing.id, existing); this.emit('snapshot'); this.retry(existing.id)
      }
      return { place: existing.id }
    }
    const name = request.name || slugify(basename(repo.repo))
    const problem = nameProblem(name, this.places.names(request.machine))
    if (problem) throw new Error(problem)
    const id = `p:${request.machine}:${name}`
    const base = (await this.files.exec(request.machine, ['git', 'symbolic-ref', '--short', 'HEAD'], repo.repo)).toString().trim()
    const concurrent = this.store.all<CoreSpace>('space').find(space => space.machine === request.machine && (space.folder === repo.repo || space.id === id))
    if (concurrent) { if (concurrent.folder === repo.repo && !concurrent.removed) return { place: concurrent.id }; throw Error('This space name was reserved by another request; retry with another name') }
    const changedName = nameProblem(name, this.places.names(request.machine))
    if (changedName) throw Error(changedName)
    this.store.set('space', id, { id, machine: request.machine, name, folder: repo.repo, base, prefix: automaticTaskPrefix(this.store, request.machine, name), mode: 'regular', added: Date.now() } satisfies CoreSpace)
    this.emit('snapshot'); return { place: id }
  }
  watch(_chats: string[], _terms: string[]) {}
  private deliveryNotice(item: PendingSend, uncertain = false) {
    if (item.quiet && !uncertain || item.id.startsWith('restart-denied-')) return
    this.post(item.chat, { id: `delivery-${item.id}`, who: 'agent', text: item.quiet ? 'Browser handoff was not confirmed. Check with the agent before letting it use the browser.' : uncertain
      ? 'Shepherdr could not confirm delivery of your saved answer. Check with the agent before answering again; it will not be sent to a replacement session.'
      : 'Shepherdr saved your answer and is waiting for the agent to receive it.', at: Date.now() })
  }
  /** The card's change and its delivery queue entry commit together before any transport effect. */
  saveAndDeliver(chat: string, id: string, text: string, save: () => void, quiet = false, work = false) {
    const agent = this.agents.get(chat)
    if (!agent) throw new Error('The card’s agent session is missing')
    this.store.db.transaction(() => {
      save()
      this.store.set('pending-send', id, { id, chat, text, launch: agent.launch, state: 'queued', quiet, ...(work ? { work } : {}) } satisfies PendingSend)
      this.deliveryNotice({ id, chat, text, launch: agent.launch, state: 'queued', quiet })
    })()
    queueMicrotask(() => { void this.flush(chat) })
  }
  voice(chat: string, out: Parameters<CoreVoice['open']>[1]) {
    try { this.requirePlugin('voice'); return this.voices.open(chat, out) }
    catch (error) { out.send(JSON.stringify({ type: 'error', message: (error as Error).message })); out.close(); return { audio(_data: ArrayBuffer) {}, end() {} } }
  }
  browser(task: string, client: Parameters<CoreBrowsers['attach']>[1]) { return this.browsers.attach(task, client) }
  terminal(chat: string, ws: Parameters<typeof terminalBridge>[2]) {
    if (!this.plugins.has('terminal')) { ws.close(); return { message(_raw: string) {}, end() {} } }
    return terminalBridge(this, chat, ws)
  }
  async worktree(ask: WorktreeAsk) { this.requirePlugin('worktree'); return this.worktrees.ask(ask) }
  async activity(ask: ActivityAsk) { return this.activities.ask(ask) }
  async artifact(id: string, version?: number) { if (!this.plugins.has('artifacts')) return; try { return this.artifacts.page(id, version) } catch { return undefined } }
  async artifactThumb(id: string, dark: boolean) { if (!this.plugins.has('artifacts')) return null; try { return this.artifacts.thumb(id, dark) } catch { return null } }
  async upload(chat: string, name: string, data: Uint8Array) { return this.chats.upload(chat, name, data) }
  async attachment(chat: string, path: string) { return this.chats.attachment(chat, path) }
  async drain() { this.quiescing = true; this.screens.stop(); this.failedStarts.stop(); this.pluginUpdates?.stop(); await this.pluginUpdates?.drain(); this.plugins.stop(); this.voices.stop(); this.automations.stop(); this.github.stop(); this.health.stop(); await this.github.drain(); await this.health.drain(); await this.automations.drain(); await this.pilots.usage.drain(); await this.pilots.lifecycle.drain(); await this.pilots.completion.drain(); return this.tasks.drain() }
  stop() { clearInterval(this.recovery); this.screens.stop(); this.failedStarts.stop(); this.pluginUpdates?.stop(); this.plugins.stop(); this.voices.stop(); this.health.stop(); this.automations.stop(); this.github.stop(); this.logs.stop(); this.browsers.stop(); this.core.stop() }
}
