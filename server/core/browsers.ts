import { machineName } from '../../shared/types.ts'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { BrowserFrames, browserPacket } from './browser-protocol.ts'
import { browserNamespace, browserSession } from './browser-id.ts'
import type { CoreSource } from './source.ts'
import type { CoreTerminal } from './protocol.ts'
import type { BrowserDown, BrowserUp, BrowserNote } from '../../shared/browser.ts'
import { line } from '../common/chatlines.ts'
import type { Action } from '../../shared/types.ts'
import type { CoreClient } from './client.ts'
import { guarded } from './guarded.ts'

type Viewer = { send(raw: string): void; close(): void; buffered?(): number }
interface Record { id: string; task: string; chat: string; launch: string; machine: string; key: string; name: string; terminal?: string; pid?: number; config: string; root: string; bun: string; driver?: 'agent' | 'you' }
interface Hub { task: string; clients: Set<Viewer>; record?: Record; stream?: Awaited<ReturnType<CoreClient['attach']>>; connecting?: Promise<void>; epoch: string; pending: Map<string, { timer: ReturnType<typeof setTimeout>; resolve(): void; reject(error: Error): void }>; state?: string; frame?: string; stopping?: boolean; closing?: Promise<void>; closed?: CoreTerminal; lastWatch?: number }
const quote = (word: string) => `'${word.replaceAll("'", `'"'"'`)}'`

/** Browser traffic uses a core child on its owning machine and the existing local core socket. */
export class CoreBrowsers {
  private hubs = new Map<string, Hub>()
  private timer: ReturnType<typeof setInterval>
  private stopped = false
  private scanning = false
  private lastScan = 0
  constructor(private source: CoreSource, private installation: string) {
    const reconcile = () => { void guarded('Browser check', () => this.reconcile()) }
    this.timer = setInterval(reconcile, 5000)
    source.core.onChange(reconcile)
  }
  private hub(task: string) {
    let hub = this.hubs.get(task)
    if (!hub) { hub = { task, clients: new Set(), epoch: randomUUID(), pending: new Map() }; this.hubs.set(task, hub) }
    return hub
  }
  attach(id: string, client: Viewer) {
    if (!this.source.tasks.get(id) || this.stopped || this.source.quiescing || this.source.plugins?.has('browser') === false) {
      client.send(JSON.stringify({ type: 'error', message: 'This task’s browser is unavailable', gone: true }))
      client.close()
      return { message(_raw: string) {}, end() {} }
    }
    const hub = this.hub(id)
    if (!hub.clients.size) hub.lastWatch = 0
    hub.clients.add(client)
    if (hub.state) client.send(hub.state)
    if (hub.frame) client.send(hub.frame)
    void this.connect(hub).catch(error => this.error(hub, error.message))
    return {
      message: (raw: string) => {
        if (this.source.quiescing || this.stopped || hub.stopping || this.source.plugins?.has('browser') === false) return this.error(hub, 'Browser controls are unavailable; reopen the browser after it reconnects')
        if (Buffer.byteLength(raw) > 128 * 1024) return this.error(hub, 'Browser control exceeds the size limit')
        let message: BrowserUp
        try { message = JSON.parse(raw) } catch { return }
        // Controls are never replayed after a dropped attach, including mouse and keyboard input.
        if (!hub.stream) return this.error(hub, 'Browser disconnected; wait for it to reconnect before trying the action again')
        void this.send(hub, { type: 'input', message }).catch(error => this.error(hub, error.message))
      },
      end: () => {
        hub.clients.delete(client)
        if (!hub.clients.size && hub.stream) {
          void this.send(hub, { type: 'unwatch' }).catch(() => {}) // Lease expires if the connection was lost.
          hub.frame = undefined; hub.lastWatch = 0
        }
      },
    }
  }
  async notes(action: Extract<Action, { type: 'browser-notes' }>): Promise<unknown> {
    return action.cid ? this.source.store.command('browser-notes-' + action.cid, action, () => this.notesNow(action)) : this.notesNow(action)
  }
  private async notesNow(action: Extract<Action, { type: 'browser-notes' }>) {
    const task = this.source.tasks.forChat(action.chat)
    if (!task || task.chat !== action.chat || ['merged', 'closed'].includes(task.workflow)) throw Error('This task’s browser is no longer available')
    if (!Array.isArray(action.notes) || !action.notes.length || action.notes.length > 50) throw Error('Send between one and 50 browser notes')
    const notes: BrowserNote[] = [], attachments: string[] = []
    for (const note of action.notes) {
      if (!note?.pick || typeof note.comment !== 'string' || typeof note.pick.element !== 'string' || typeof note.pick.selector !== 'string' || !note.pick.box || ![note.pick.box.x, note.pick.box.y, note.pick.box.w, note.pick.box.h].every(Number.isFinite)) throw Error('Invalid browser note')
      let shot: string | undefined
      if (typeof note.pick.shot === 'string') {
        shot = this.source.chats.uploadName(action.chat, note.pick.shot)
        if (shot && !attachments.includes(note.pick.shot)) attachments.push(note.pick.shot)
      }
      notes.push({ comment: note.comment.slice(0, 10000), pick: { ...note.pick, shot, thumb: undefined } })
    }
    if (attachments.length > 20) throw Error('Send at most 20 note screenshots at once')
    const text = line.browserNotes(this.source.snapshot().user || 'You', { url: String(action.url || '').slice(0, 4096), title: action.title?.slice(0, 512), viewport: action.viewport }, notes)
    return this.source.act({ type: 'send', cid: action.cid, chat: action.chat, text, attachments, human: true })
  }
  private error(hub: Hub, message: string, gone = false) { this.broadcast(hub, { type: 'error', message, gone }) }
  private broadcast(hub: Hub, message: BrowserDown) {
    const raw = JSON.stringify(message)
    if (message.type === 'state') hub.state = raw
    if (message.type === 'frame') hub.frame = raw
    for (const client of hub.clients) {
      if (message.type === 'frame' && (client.buffered?.() ?? 0) > 2 * 1024 * 1024) continue
      if ((client.buffered?.() ?? 0) > 4 * 1024 * 1024) { client.close(); hub.clients.delete(client); continue }
      try { client.send(raw) } catch { hub.clients.delete(client); try { client.close() } catch {} }
    }
  }
  private async send(hub: Hub, input: unknown, timeout = 15_000) {
    if (!hub.stream || !hub.record) throw Error('Browser relay is disconnected')
    if (hub.pending.size >= 64) throw Error('Browser controls are busy; retry the action')
    const id = randomUUID()
    const packet = browserPacket(hub.record.key, 'up', { id, input }) + '\n'
    if (Buffer.byteLength(packet) > 240 * 1024) throw Error('Browser control exceeds the size limit')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        hub.pending.delete(id)
        reject(Error('A browser action was not confirmed. Check the page before trying it again.'))
      }, timeout)
      hub.pending.set(id, { timer, resolve, reject })
      try { hub.stream!.input(Buffer.from(packet)) }
      catch (error) { clearTimeout(timer); hub.pending.delete(id); reject(error) }
    })
  }

  private watch(hub: Hub, viewing = true) {
    const task = this.source.tasks.get(hub.task), agent = task && this.source.agents.get(task.chat)
    if (!task || !agent) return
    hub.lastWatch = Date.now()
    const setting = this.source.settings.get('browser.idleClose', task.place), minutes = parseFloat(setting)
    void this.send(hub, { type: viewing ? 'watch' : 'configure', epoch: hub.epoch, user: this.source.snapshot().user, working: this.source.chatStatus(task.chat) === 'work', idle: Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null }).catch(error => this.error(hub, error.message))
  }
  private async connect(hub: Hub, idle = false) {
    if (hub.connecting) return hub.connecting
    if (this.stopped || this.source.quiescing || hub.stopping || this.source.plugins?.has('browser') === false || !hub.clients.size && !idle || !this.source.connected()) return
    if (hub.stream) { if (!hub.lastWatch || Date.now() - hub.lastWatch >= 5000) this.watch(hub, !!hub.clients.size); return }
    hub.connecting = this.start(hub)
    try { await hub.connecting } finally { hub.connecting = undefined }
  }
  private async start(hub: Hub, cleanup = false) {
    const task = this.source.tasks.get(hub.task)
    if (!task || !cleanup && (['merged', 'closed'].includes(task.workflow) || task.archived)) return this.error(hub, 'The browser closed with the task.', true)
    const agent = this.source.agents.get(task.chat)
    if (!cleanup && !agent?.browser) throw Error('Restart this task agent to provision its shared browser')
    if (!this.source.machineConnected(task.machine)) throw Error('The browser’s machine is reconnecting')
    let record = this.source.store.get<Record>('browser-relay', task.id)
    if (!cleanup && record && record.launch !== agent!.launch) throw Error('The browser belongs to an earlier agent start; close it before restarting')
    if (!record) {
      if (!agent?.browser) throw Error('This task has no browser binding')
      const runtime = await this.source.agents.browserRuntime(task.machine)
      const session = browserSession(task.chat)
      const profile = task.machine === this.source.localMachineId() ? join(this.source.config.home, 'browser', session) : join(dirname(runtime.root), 'browser', session)
      if (agent.browser.namespace !== browserNamespace(this.installation) || agent.browser.session !== session || agent.browser.profile !== profile) throw Error('This agent has a different browser binding; restart it before opening its browser')
      const id = randomUUID(), key = randomBytes(32).toString('hex'), config = join(runtime.sessions, id + '.browser.json')
      const input = { key, session, namespace: agent.browser.namespace, profile, bin: runtime.bin, host: machineName(this.source.snapshot().machines, task.machine) }
      const script = `const f=require('node:fs'),p=require('node:path'),x=JSON.parse(await Bun.stdin.text());f.mkdirSync(p.dirname(x.path),{recursive:true,mode:0o700});const s=f.lstatSync(p.dirname(x.path));if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)||f.realpathSync(p.dirname(x.path))!==p.dirname(x.path))throw Error('Browser launch directory must be private');f.writeFileSync(x.path,JSON.stringify(x.config),{flag:'wx',mode:0o600})`
      await this.source.files.exec(task.machine, [runtime.bun, '-e', script], undefined, Buffer.from(JSON.stringify({ path: config, config: input })))
      record = { id, key, config, task: task.id, chat: task.chat, launch: agent.launch, machine: task.machine, root: runtime.root, bun: runtime.bun,
        name: `sb-${createHash('sha256').update(this.installation + task.id).digest('hex').slice(0, 16)}` }
      this.source.store.set('browser-relay', task.id, record)
    }
    hub.record = record
    const matches = [...this.source.core.current.terminals.values()].filter(terminal => terminal.labels['shepherdr.browser'] === record.id && terminal.labels['shepherdr.installation'] === this.installation && terminal.state === 'live' && (!record.terminal || terminal.address === record.terminal))
    if (matches.length > 1) throw Error('Browser start is ambiguous; cleanup was refused')
    let terminal = matches[0]
    if (!terminal && record.terminal) {
      const previous = this.source.core.current.terminals.get(record.terminal)
      if (!previous || previous.state !== 'finished' || record.pid !== undefined && previous.pid !== record.pid) throw Error('Previous browser exit is unconfirmed; reconnect before replacing it')
    }
    if (!terminal) {
      const previousDriver = record.driver
      const on = await this.source.route(task.machine), candidate = agent && this.source.agents.terminal(agent), parent = candidate?.state === 'live' ? candidate : undefined
      terminal = await this.source.core.call<CoreTerminal>('terminal.run', {
        argv: ['sh', '-c', `stty raw -echo && exec ${quote(record.bun)} ${quote(join(record.root, 'helper/core-browser.ts'))} ${quote(record.config)}`],
        on, cwd: task.folder, parent: on ? parent?.address.slice(on.length + 1) : parent?.address,
        outlive_parent: true, no_notify: true, name: record.name,
        labels: { 'shepherdr.installation': this.installation, 'shepherdr.role': 'browser', 'shepherdr.space': task.place, 'shepherdr.task': task.id, 'shepherdr.browser': record.id },
        env: { SHEPHERDR_CHAT: '', SHEPHERDR_SECRET_FILE: '', SHEPHERDR_CORE_CREDENTIAL: '', SHEPHERDR_URL: '' },
      }, 45_000)
      record.terminal = terminal.address; record.pid = terminal.pid ?? undefined
      this.source.store.set('browser-relay', task.id, record)
      if (previousDriver === 'you' && this.source.agents.get(record.chat)?.launch === record.launch) {
        const resumed = record
        this.source.saveAndDeliver(record.chat, `browser-restart-${record.id}-${terminal.pid}`, '<browser>The shared browser relay restarted and the browser is handed back. Snapshot the page before driving it again.</browser>', () => { resumed.driver = 'agent'; this.source.store.set('browser-relay', resumed.task, resumed) }, true)
      }
    }
    if (record.pid && record.pid !== terminal.pid) throw Error('Browser relay process identity changed')
    record.terminal = terminal.address; record.pid = terminal.pid ?? undefined; this.source.store.set('browser-relay', task.id, record)
    const frames = new BrowserFrames(record.key, value => {
      const event = value as { type: string; message?: BrowserDown; id?: string; ok?: boolean; error?: string; text?: string }
      if (event.type === 'down' && event.message) {
        if (event.message.type === 'state' && ['agent', 'you'].includes(event.message.driver)) { record.driver = event.message.driver; this.source.store.set('browser-relay', record.task, record) }
        this.broadcast(hub, event.message)
      }
      else if (event.type === 'ack' && event.id) {
        const pending = hub.pending.get(event.id)
        if (pending) { clearTimeout(pending.timer); hub.pending.delete(event.id); if (event.ok) pending.resolve(); else pending.reject(Error(event.error || 'The browser action failed')) }
      } else if (event.type === 'tell' && event.text && event.id && /^[a-f0-9-]{36}$/.test(event.id)) {
        if (this.source.agents.get(record.chat)?.launch === record.launch && this.source.agents.terminal(this.source.agents.get(record.chat)!)?.state === 'live' && !this.source.store.get('browser-news', event.id)) {
          const id = event.id
          this.source.saveAndDeliver(record.chat, id, `<browser>${event.text}</browser>`, () => this.source.store.set('browser-news', id, { launch: record.launch, at: Date.now() }), true)
        }
        void this.send(hub, { type: 'received-news', news: event.id }).catch(() => {})
      }
    })
    hub.epoch = randomUUID()
    const stream = await this.source.core.attach(terminal.address, {
      data: bytes => { try { frames.push(bytes) } catch { hub.stream?.close(); hub.stream = undefined; this.error(hub, 'Browser relay authentication or framing failed; reconnect its panel') } },
      close: () => {
        hub.stream = undefined; hub.frame = undefined
        if (hub.state) { const state = JSON.parse(hub.state); this.broadcast(hub, { ...state, connected: false }) }
        for (const pending of hub.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('Browser disconnected; controls were not replayed')) }
        hub.pending.clear()
        if (!hub.stopping && !this.stopped) this.error(hub, 'Browser disconnected; reconnecting. Unconfirmed controls will not be replayed.')
      },
    }, 80, 24)
    if (this.stopped || (hub.stopping || this.source.quiescing) && !cleanup) { stream.close(); return }
    hub.stream = stream
    if (!cleanup) this.watch(hub, !!hub.clients.size)
  }
  private reconcile() {
    if (this.stopped || this.source.quiescing) return
    for (const record of this.source.store.all<Record>('browser-relay')) {
      const task = this.source.tasks.get(record.task)
      if (!task || !this.source.machineConnected(record.machine)) continue
      if (['merged', 'closed'].includes(task.workflow) || task.archived || this.source.plugins?.has('browser') === false) void this.close(record.task, task.workflow === 'merged' || task.workflow === 'closed').catch(() => {})
      else void this.connect(this.hub(task.id), true).catch(() => {})
    }
    if (this.source.plugins?.has('browser') !== false && Date.now() - this.lastScan >= 30_000 && !this.scanning) void guarded('Browser check', () => this.detectAgentBrowsers())
    for (const hub of this.hubs.values()) if (hub.clients.size) void this.connect(hub).catch(error => this.error(hub, error.message))
  }
  /** Recover agent-only browser use from the wrapper's own usage mark, through core only. */
  async detectAgentBrowsers() {
    this.scanning = true; this.lastScan = Date.now()
    try {
      const candidates = this.source.tasks.all().filter(task => !['merged', 'closed'].includes(task.workflow) && !task.archived && this.source.machineConnected(task.machine) && !this.source.store.get('browser-relay', task.id))
      const machines = new Set(candidates.map(task => task.machine))
      await Promise.all([...machines].map(async machine => {
        const tasks = candidates.filter(task => task.machine === machine).flatMap(task => {
          const browser = this.source.agents.get(task.chat)?.browser
          return browser ? [{ id: task.id, mark: browser.profile + '.used' }] : []
        })
        if (!tasks.length) return
        const bun = await this.source.agents.bun(machine)
        const script = `const f=require('node:fs'),x=JSON.parse(await Bun.stdin.text());process.stdout.write(JSON.stringify(x.filter(t=>{try{return f.statSync(t.mark).isFile()}catch{return false}}).map(t=>t.id)))`
        const used = JSON.parse((await this.source.files.exec(machine, [bun, '-e', script], undefined, Buffer.from(JSON.stringify(tasks)))).toString('utf8')) as string[]
        for (const id of used) if (tasks.some(task => task.id === id) && !this.stopped && !this.source.quiescing) await this.connect(this.hub(id), true)
      }).map(promise => promise.catch(() => {})))
    } finally { this.scanning = false }
  }
  async close(task: string, forget = false, track?: (terminal: CoreTerminal) => void) {
    const record = this.source.tasks.get(task)
    if (!this.source.store.get('browser-relay', task) && (!record || !this.source.agents.get(record.chat)?.browser)) return
    const hub = this.hub(task)
    if (hub.closing) { await hub.closing; if (hub.closed) track?.(hub.closed); return }
    hub.closed = undefined
    hub.closing = this.closeNow(task, hub, forget)
    try { await hub.closing; if (hub.closed) track?.(hub.closed) } finally { hub.closing = undefined }
  }
  private async closeNow(task: string, hub: Hub, forget: boolean) {
    hub.stopping = true
    try {
      await hub.connecting?.catch(() => {})
      if (!hub.stream) await this.start(hub, true)
      if (!hub.stream) throw Error('The browser could not confirm cleanup; reconnect its machine and retry')
      const terminal = hub.record?.terminal && this.source.core.current.terminals.get(hub.record.terminal)
      if (!terminal || hub.record?.pid !== terminal.pid) throw Error('Browser cleanup process identity is unconfirmed')
      await this.send(hub, { type: 'close', forget }, 45_000)
      hub.closed = { ...terminal }
      this.source.store.delete('browser-relay', task)
      this.error(hub, 'The browser closed with the task.', true)
      // The acknowledged relay may close its attach before the command promise resumes.
      hub.stream?.close(); hub.stream = undefined
      for (const client of hub.clients) client.close()
      this.hubs.delete(task)
    } finally { hub.stopping = false }
  }

  stop() {
    this.stopped = true; clearInterval(this.timer)
    for (const hub of this.hubs.values()) { hub.stream?.close(); for (const pending of hub.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('Browser disconnected; controls were not replayed')) }; for (const client of hub.clients) client.close() }
    this.hubs.clear()
  }
}
