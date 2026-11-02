import { CoreClient, CoreError } from './client.ts'
import type { CoreNotification, CoreSnapshot, CoreTerminal } from './protocol.ts'

export interface CoreView {
  connected: boolean
  /** Changes on every connection. A seq belongs only to that connection. */
  epoch: number
  seq: number
  terminals: ReadonlyMap<string, CoreTerminal>
  error?: string
}

/** One unfiltered subscription includes remote documents as well as terminals.
 * Every reconnect/missed invokes resync: documents are NOT included in core snapshots. */
export class CoreSession {
  private client?: CoreClient
  private stopped = false
  private connecting = false
  private retry?: ReturnType<typeof setTimeout>
  private watchdog?: ReturnType<typeof setInterval>
  private lastEvent = 0
  private attempt = 0
  private subscribers = new Set<(view: CoreView) => void>()
  private documents = new Set<(event: CoreNotification) => void>()
  private resyncs = new Set<() => void>()
  private view: CoreView = { connected: false, epoch: 0, seq: 0, terminals: new Map() }

  constructor(readonly path: string) {}
  get current(): CoreView { return this.view }
  onChange(fn: (view: CoreView) => void) { this.subscribers.add(fn); return () => { this.subscribers.delete(fn) } }
  onDocument(fn: (event: CoreNotification) => void) { this.documents.add(fn); return () => { this.documents.delete(fn) } }
  onResync(fn: () => void) { this.resyncs.add(fn); return () => { this.resyncs.delete(fn) } }

  async start() { if (this.client || this.connecting) return; this.stopped = false; await this.reconnect() }
  stop() {
    this.stopped = true
    clearTimeout(this.retry); clearInterval(this.watchdog)
    this.client?.close(); this.client = undefined
    this.view = { ...this.view, connected: false }; this.publish()
  }
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeout?: number): Promise<T> {
    if (!this.view.connected || !this.client) throw new CoreError('unavailable', 'Core is reconnecting; try again when connected')
    return this.client.call<T>(method, params, timeout)
  }
  async attach(...args: Parameters<CoreClient['attach']>) {
    if (!this.view.connected || !this.client) throw new CoreError('unavailable', 'Core is reconnecting')
    return this.client.attach(...args)
  }

  private async reconnect() {
    if (this.stopped || this.connecting) return
    this.connecting = true
    let client: CoreClient | undefined
    try {
      client = await CoreClient.open(this.path)
      if (this.stopped) { client.close(); return }
      this.client = client
      const events: CoreNotification[] = []
      let syncing = true
      client.onDisconnect(error => {
        if (this.client !== client || this.stopped) return
        this.client = undefined; this.offline(error)
      })
      const snapshot = await client.subscribe(event => {
        this.lastEvent = Date.now()
        if (syncing) {
          if (events.length >= 4096) throw new Error('Core snapshot event buffer overflow')
          events.push(event)
        } else this.event(event)
      })
      if (this.stopped || this.client !== client) return
      this.view = { connected: true, epoch: this.view.epoch + 1, seq: snapshot.seq, terminals: this.terminals(snapshot) }
      syncing = false
      for (const event of events) this.event(event)
      this.attempt = 0; this.lastEvent = Date.now()
      clearInterval(this.watchdog)
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastEvent > 45_000) client?.close()
      }, 5000)
      this.publish()
      for (const fn of this.resyncs) fn()
    } catch (error) {
      client?.close()
      this.client = undefined
      if (!this.stopped) this.offline(error instanceof Error ? error : new Error(String(error)))
    } finally { this.connecting = false }
  }

  private offline(error: Error) {
    clearInterval(this.watchdog); clearTimeout(this.retry)
    this.view = { ...this.view, connected: false, error: error.message }; this.publish()
    // API incompatibility needs an operator, not an endless retry loop.
    if (error instanceof CoreError && error.kind === 'incompatible') return
    const delay = Math.min(30_000, 250 * 2 ** Math.min(this.attempt++, 7))
    this.retry = setTimeout(() => void this.reconnect(), delay)
  }

  private terminals(snapshot: Pick<CoreSnapshot, 'terminals'>) {
    return new Map(snapshot.terminals.map(terminal => [terminal.address, terminal]))
  }

  private event(event: CoreNotification) {
    const p = event.params
    if (event.method === 'missed') {
      if (!Array.isArray(p.terminals)) throw new Error('Core missed notification has no snapshot')
      this.view = { ...this.view, seq: p.seq, terminals: this.terminals({ terminals: p.terminals }) }
      this.publish()
      for (const fn of this.resyncs) fn()
      return
    }
    if (event.method === 'heartbeat') return
    if (p.seq <= this.view.seq) return
    // Core supplies one combined sequence. A gap requires a new authoritative subscription.
    if (p.seq !== this.view.seq + 1) { this.client?.close(); return }
    this.view = { ...this.view, seq: p.seq }
    if (p.type === 'doc') { for (const fn of this.documents) fn(event); return }
    if (!p.terminal) return
    const terminals = new Map(this.view.terminals)
    const old = terminals.get(p.terminal)
    const data = p.data ?? {}
    switch (p.type) {
      case 'created': case 'restarted': terminals.set(p.terminal, data as unknown as CoreTerminal); break
      case 'removed': terminals.delete(p.terminal); break
      case 'labels':
        if (data.record) terminals.set(p.terminal, data.record as CoreTerminal)
        else if (old) terminals.set(p.terminal, { ...old, labels: data.labels as Record<string, string> })
        break
      case 'finished':
        if (old) terminals.set(p.terminal, { ...old, ...data, state: 'finished', foreground: null })
        break
      case 'lost':
        if (old) terminals.set(p.terminal, { ...old, ...data, pid: null, foreground: null })
        break
      case 'foreground':
        if (old) terminals.set(p.terminal, { ...old, foreground: p.data ?? null })
        break
      case 'turn':
        // data.state is the PROGRAM word the turn ended on, never terminal process liveness.
        if (old) terminals.set(p.terminal, { ...old, turn: data.turn as number })
        break
      case 'status': case 'size': case 'title': case 'keep':
        if (old) terminals.set(p.terminal, { ...old, ...data })
        break
      default: break // Additive future events cannot silently overwrite process/workflow state.
    }
    this.view = { ...this.view, terminals }; this.publish()
  }

  private publish() { for (const fn of this.subscribers) fn(this.view) }
}
