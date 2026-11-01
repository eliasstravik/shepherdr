import { ClaudeReader } from '../common/readers/claude.ts'
import { CodexReader } from '../common/readers/codex.ts'
import type { LogEvent, Reader } from '../common/readers/types.ts'
import type { Message } from '../../shared/types.ts'
import type { CoreAgents } from './agents.ts'
import type { CoreStore } from './store.ts'
import type { CoreFiles } from './files.ts'
import type { AgentHook, CoreAgent } from './model.ts'
import { CoreNativeFile } from './native-file.ts'
import { CoreReviewReader } from './review-reader.ts'
import { chatMessages } from './chat.ts'
import { activityOf } from '../activity.ts'
import { guarded } from './guarded.ts'

interface Cursor { initialized?: boolean; loading?: boolean; gap?: boolean; caughtUp?: boolean; ended?: boolean; path: string; file: CoreNativeFile; reader?: Reader; reset?: () => void }
interface WaitingSnapshot { launch: string; started: number; path?: string; activity: number; waiting: boolean }
interface SavedMessage extends Message { source?: string }
interface CleanupReceipt { launch: string; receipt: string; seen: boolean; complete: boolean; offset?: number }

/** Native transcripts and explicit hooks only. No terminal reads or screen-status heuristics. */
export class CoreLogs {
  private revisions = new Map<string, number>()
  private waits = new Map<string, { launch: string; started: number; activity: number; revision: number; waiting: boolean }>()
  private hooks = new Map<string, Cursor>()
  private logs = new Map<string, Cursor>()
  private reading = new Map<string, Promise<void>>()
  private machines = new Map<string, number>()
  private next = 0
  private timer?: ReturnType<typeof setInterval>
  constructor(private readonly agents: CoreAgents, private readonly files: CoreFiles, private readonly store: CoreStore,
    private readonly changed: (chat: string) => void, private readonly error: (chat: string, message: string) => void,
    private readonly incoming: (chat: string, message: Message) => void = () => {}, private readonly observe: (agent: CoreAgent) => Promise<void> = async () => {},
    private readonly ended: (agent: CoreAgent, event: LogEvent) => void = () => {}) {}
  start() {
    const poll = () => { void guarded('Log poll', () => this.poll()) }
    if (!this.timer) this.timer = setInterval(poll, 500)
    poll()
  }
  stop() { clearInterval(this.timer); this.timer = undefined }
  async poll() {
    const jobs: Promise<void>[] = []
    const agents = this.agents.all()
    const turn = this.next++, spin = (list: CoreAgent[]) => { const first = turn % Math.max(1, list.length); return [...list.slice(first), ...list.slice(0, first)] }
    // Each poll reads only so many: agents with a card open take turns first, so a card closes within seconds, and every
    // other read stays with the rest, so many cards leave no agent unread.
    const waiting = spin(agents.filter(agent => agent.permission)), rest = spin(agents.filter(agent => !agent.permission))
    for (const agent of [...waiting.flatMap((agent, at) => at < rest.length ? [agent, rest[at]] : [agent]), ...rest.slice(waiting.length)]) {
      if (this.reading.has(agent.chat) || (this.machines.get(agent.machine) ?? 0) >= 4) continue
      this.machines.set(agent.machine, (this.machines.get(agent.machine) ?? 0) + 1)
      jobs.push(this.claim(agent).finally(() => this.machines.set(agent.machine, (this.machines.get(agent.machine) ?? 1) - 1)))
    }
    await Promise.all(jobs)
  }
  private async read(agent: CoreAgent) {
    try {
      try { await this.hook(agent) } catch (error) { this.error(agent.chat, (error as Error).message) }
      try { await this.observe(agent) } catch (error) { this.error(agent.chat, (error as Error).message) }
      const current = this.agents.get(agent.chat) ?? agent
      if (current.transcript) await this.transcript(current)
    } catch (error) { this.error(agent.chat, (error as Error).message) }
  }
  private claim(agent: CoreAgent) {
    const job = this.read(agent).finally(() => this.reading.delete(agent.chat))
    this.reading.set(agent.chat, job)
    return job
  }
  /** Reads this agent's records from now, for an answer that must not outrun what they already say: a read under way may have begun too early. */
  async catchUp(chat: string) {
    for (let running = this.reading.get(chat); running; running = this.reading.get(chat)) await running
    const agent = this.agents.get(chat)
    if (agent) await this.claim(agent)
  }

  messages(chat: string): Message[] {
    return chatMessages(this.store.all<SavedMessage>(`message:${chat}`)
      .filter(message => !(message.who === 'you' && message.source === message.id && /^\s*<hc>[\s\S]*<\/hc>\s*$/.test(message.text ?? '')))
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map(({ source, ...message }) => message))
  }
  /** An ended native turn is Needs you only after current-log capture, with no recorded background work. */
  providerTurn(agent: CoreAgent): { complete: boolean; cut?: Extract<LogEvent, { kind: 'error' }> } {
    const cursor = this.logs.get(agent.chat)
    if (!cursor || cursor.path !== agent.transcript || !cursor.caughtUp || cursor.loading || cursor.gap || !cursor.ended) return { complete: false }
    const events = this.store.all<LogEvent>(`event:${agent.chat}`).filter(event => Number.isFinite(event.at) && event.at >= agent.started && event.at <= Date.now() + 60000).sort((a, b) => a.at - b.at)
    const activity = activityOf(events)
    if (activity.open || activity.jobs.length || !events.some(event => event.kind === 'turn-end')) return { complete: false }
    const last = events.findLast(event => event.kind === 'error' || event.kind === 'turn-start' || event.kind === 'user')
    const terminal = this.agents.terminal(agent)
    if (last?.kind === 'error' && (terminal?.status_ms ?? 0) > last.at && ['working', 'starting'].includes(terminal?.status?.state ?? '')) return { complete: false }
    return { complete: true, ...(last?.kind === 'error' ? { cut: last } : {}) }
  }
  waiting(agent: CoreAgent) {
    const cursor = this.logs.get(agent.chat)
    if (agent.role !== 'task') return false
    if (!cursor || cursor.path !== agent.transcript || cursor.caughtUp === undefined || cursor.loading && !cursor.gap) {
      const saved = this.store.get<WaitingSnapshot>('native-waiting', agent.chat)
      return !!saved?.waiting && saved.launch === agent.launch && saved.started === agent.started && saved.path === agent.transcript && (agent.activityAt ?? agent.started) <= saved.activity
    }
    if (!cursor.caughtUp || cursor.gap || !cursor.ended) return false
    const revision = this.revisions.get(agent.chat) ?? 0, old = this.waits.get(agent.chat)
    if (old?.launch === agent.launch && old.started === agent.started && old.activity === (agent.activityAt ?? agent.started) && old.revision === revision) return old.waiting
    const events = this.store.all<LogEvent>(`event:${agent.chat}`).filter(event => Number.isFinite(event.at) && event.at >= agent.started && event.at <= Date.now() + 60000)
    const activity = activityOf(events)
    const waiting = !!activity.turns.length && !activity.open && !activity.jobs.length
    this.store.set('native-waiting', agent.chat, { launch: agent.launch, started: agent.started, path: agent.transcript, activity: agent.activityAt ?? agent.started, waiting } satisfies WaitingSnapshot)
    this.waits.set(agent.chat, { launch: agent.launch, started: agent.started, activity: agent.activityAt ?? agent.started, revision, waiting })
    return waiting
  }
  outgoing(chat: string, message: Message) { this.store.set(`message:${chat}`, message.id, message); if (message.who !== 'you') this.incoming(chat, message); this.changed(chat) }

  private async lines(chat: string, machine: string, cursor: Cursor, receive: (lines: { text: string; offset: number }[]) => void) {
    const bun = await this.agents.bun(machine)
    // Bound each poll so a long history does not starve hooks or other chats.
    for (let count = 0; count < 4; count++) {
      const batch = await cursor.file.read(this.files, machine, bun, () => { cursor.reader?.reset?.(cursor.path); cursor.reset?.() })
      if (batch.oversized) {
        cursor.gap = true
        const text = 'A native log record exceeds the 64 MiB display limit and was skipped. Later records will still load.'
        this.error(chat, text)
        this.outgoing(chat, { id: 'native-log-record-limit', who: 'agent', text, at: Date.now() })
      }
      cursor.initialized = true; cursor.loading = batch.more
      cursor.caughtUp = !batch.more && cursor.file.complete
      if (batch.lines.length) receive(batch.lines)
      if (!batch.more) break
    }
  }

  private async hook(agent: CoreAgent) {
    let cursor = this.hooks.get(agent.chat)
    if (!cursor || cursor.path !== agent.hook) { cursor = { path: agent.hook, file: new CoreNativeFile(agent.hook) }; this.hooks.set(agent.chat, cursor) }
    await this.lines(agent.chat, agent.machine, cursor, lines => {
      for (const line of lines) {
        let event: AgentHook
        try { event = JSON.parse(line.text) } catch { continue }
        if (typeof event.id !== 'string' || typeof event.event !== 'string' || !Number.isFinite(event.at)) continue
        this.agents.hook(agent, event)
      }
    })
  }
  cleanupComplete(agent: CoreAgent, receipt: string) {
    const saved = this.store.get<CleanupReceipt>('task-cleanup-receipt', agent.chat)
    return saved?.launch === agent.launch && saved.receipt === receipt && saved.complete
  }
  private async transcript(agent: CoreAgent) {
    let cursor = this.logs.get(agent.chat)
    if (!cursor || cursor.path !== agent.transcript) {
      cursor = { path: agent.transcript!, file: new CoreNativeFile(agent.transcript!), reader: agent.transcriptFormat === 'codex-exec' ? new CoreReviewReader() : agent.kind === 'claude' ? new ClaudeReader() : new CodexReader() }
      this.logs.set(agent.chat, cursor)
    }
    cursor.reset = () => {
      cursor!.caughtUp = false; cursor!.ended = false; cursor!.gap = false; this.waits.delete(agent.chat); if (cursor!.initialized) this.store.delete('native-waiting', agent.chat)
      const receipt = this.store.get<CleanupReceipt>('task-cleanup-receipt', agent.chat)
      if (receipt?.launch === agent.launch && !receipt.complete) { receipt.seen = false; delete receipt.offset; this.store.set('task-cleanup-receipt', agent.chat, receipt) }
    }
    await this.lines(agent.chat, agent.machine, cursor, lines => {
      const receipt = this.store.get<CleanupReceipt>('task-cleanup-receipt', agent.chat)
      let count = 0
      this.store.db.transaction(() => {
        if (receipt?.launch === agent.launch && !receipt.complete) {
          // A private unpredictable response token binds this exact command to a
          // later captured native turn end, without trusting hook idle or clocks.
          for (const line of lines) {
            if (line.text.includes(receipt.receipt)) { receipt.seen = true; receipt.offset = line.offset }
            const events = cursor!.reader!.parse([line], cursor!.path); count += events.length
            for (const event of events) {
              this.apply(agent, event)
              if (receipt.seen && receipt.offset !== undefined && line.offset >= receipt.offset && event.kind === 'turn-end') receipt.complete = true
            }
          }
          this.store.set('task-cleanup-receipt', agent.chat, receipt)
        } else {
          const events = cursor!.reader!.parse(lines, cursor!.path); count = events.length
          for (const event of events) this.apply(agent, event)
        }
      })()
      if (count) this.changed(agent.chat)
    })
  }
  private apply(agent: CoreAgent, event: LogEvent) {
    const current = this.agents.get(agent.chat)
    if (!current || current.launch !== agent.launch || current.grant !== agent.grant) return
    agent = current
    const currentObservation = Number.isFinite(event.at) && event.at >= Math.max(agent.started, agent.activityAt ?? 0) && event.at <= Date.now() + 60000
    if (Number.isFinite(event.at) && event.at > 0 && event.at <= Date.now() + 60000 && event.at > (agent.activityAt ?? agent.started)) {
      agent.activityAt = event.at; this.store.set('agent', agent.chat, agent)
    }
    this.store.set(`event:${agent.chat}`, event.id + ':' + event.kind, event)
    this.revisions.set(agent.chat, (this.revisions.get(agent.chat) ?? 0) + 1)
    this.ended(agent, event)
    agent = this.agents.get(agent.chat) ?? agent
    if (event.kind === 'turn-end' && Number.isFinite(event.at) && event.at >= agent.started && event.at <= Date.now() + 60000) { const cursor = this.logs.get(agent.chat); if (cursor && cursor.path === agent.transcript) cursor.ended = true }
    if (event.kind === 'runtime' && Number.isFinite(event.at) && event.at >= agent.started && event.at <= Date.now() + 60000 && (agent.runtime?.source !== 'session' || event.at >= agent.runtime.at)) {
      // a hook's time is when it fired, often after the turn it reports, so any record beats a hook; a whole record
      // names model and effort; speed only ever comes in Codex's thread settings
      agent.runtime = event.replace ? { ...(agent.runtime?.speed ? { speed: agent.runtime.speed } : {}), ...event.runtime } : { ...agent.runtime, ...event.runtime }
      this.store.set('agent', agent.chat, agent); this.changed(agent.chat)
    }
    if (event.kind === 'session') { agent.session = event.sessionId; this.store.set('agent', agent.chat, agent) }
    if (currentObservation && (event.kind === 'turn-start' || event.kind === 'turn-end')) {
      if (!agent.permission) { agent.state = event.kind === 'turn-start' ? 'working' : 'idle'; this.store.set('agent', agent.chat, agent) }
    }
    if (event.kind !== 'user' && event.kind !== 'agent') return
    if (event.kind === 'user' && /^\s*<restart>/.test(event.text)) return
    if (event.kind === 'agent' && /^\s*<no-reply>[\s\S]*<\/no-reply>\s*$/.test(event.text)) return
    const kind = `message:${agent.chat}`
    if (event.kind === 'user') {
      const delivery = this.store.all<{ id: string; chat: string; launch?: string; text: string; state: string }>('pending-send').find(item => item.chat === agent.chat && (!item.launch || item.launch === agent.launch) && item.state === 'sending' && item.text === event.text)
      if (delivery) {
        this.store.delete('pending-send', delivery.id); this.store.delete(kind, `delivery-${delivery.id}`)
        const optimistic = this.store.get<SavedMessage>(kind, delivery.id)
        if (optimistic) { this.store.set(kind, delivery.id, { ...optimistic, source: event.id, waiting: false, waitsFor: undefined }); return }
      }
      const previous = this.store.all<SavedMessage>(kind).filter(message => message.who === 'you')
      if (previous.some(message => message.source === event.id)) return
      const optimistic = previous.find(message => !message.source && message.text === event.text && Math.abs((message.at ?? 0) - event.at) < 120_000)
      if (optimistic) {
        this.store.set(kind, optimistic.id, { ...optimistic, source: event.id, waiting: false, waitsFor: undefined })
        this.store.delete('pending-send', optimistic.id)
        return
      }
      if (/^\s*<(?:hc|github|news|answer|review|review-failed|go|queue|restart|mode|heartbeat|shepherdr|artifact-sent|artifact-note|artifact-comment|browser-notes|browser|health)\b/.test(event.text)) return
    }
    const message = { id: event.id, who: event.kind === 'user' ? 'you' as const : 'agent' as const, text: event.text, at: event.at, source: event.id } satisfies SavedMessage
    this.store.set(kind, event.id, message)
    if (event.kind === 'agent' && chatMessages([message]).length) this.incoming(agent.chat, message)
  }
}
