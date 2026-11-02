import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'
import { CoreNativeFile } from './native-file.ts'
import type { PilotInventory } from '../../helper/core-pilot-inventory.ts'
import { pilotCaptureName } from '../../helper/core-pilot-records.ts'

interface Tail { path: string; identity: string; file: CoreNativeFile }
/** Usage is independent of chat visibility: sidechain/helper records still consume the shared allowance. */
export function pilotReportedUsage(file: string, text: string, offset: number, generation: string): { id: string; tokens: number } | undefined {
  let value
  try { value = JSON.parse(text) } catch { return }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  if (file.includes('/.claude/') && value.type === 'assistant') {
    const message = value.message, id = message?.id ?? value.uuid, usage = message?.usage
    if (typeof id !== 'string' || !id || id.length > 1024 || !usage || typeof usage !== 'object') return
    const parts = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].map(key => usage[key] ?? 0)
    if (parts.some(n => !Number.isSafeInteger(n) || n < 0)) return
    const tokens = parts.reduce((sum, n) => sum + n, 0)
    if (Number.isSafeInteger(tokens) && tokens > 0) return { id: `claude:${id}`, tokens }
  }
  if (file.includes('/.codex/') && value.type === 'event_msg' && value.payload?.type === 'token_count') {
    const tokens = value.payload.info?.last_token_usage?.total_tokens
    if (Number.isSafeInteger(tokens) && tokens > 0) return { id: `codex:${file}:${generation}:${offset}`, tokens }
  }
}
interface CaptureState { launch: string; root: string; at: number; after: number; next: number; tails: Map<string, Tail>; caughtUp: Set<string>; complete: boolean }
/** Reported, delayed usage only. Native helpers/reviewers share accounting; this is never a hard money/token cap. */
export class CorePilotUsage {
  private inflight = new Map<string, Promise<void>>()
  private polling?: Promise<void>
  private cursor = 0
  private states = new Map<string, CaptureState>()
  constructor(private source: CoreSource, private now: () => number = Date.now) {}
  observe(agent: CoreAgent) {
    if (this.source.quiescing) return Promise.resolve()
    const old = this.inflight.get(agent.launch)
    if (old) return old
    const work = this.observeNow(agent).finally(() => this.inflight.delete(agent.launch))
    this.inflight.set(agent.launch, work); return work
  }
  poll() {
    if (this.polling || this.source.quiescing) return this.polling ?? Promise.resolve()
    const records = this.source.store.all<CoreAgent>('pilot-capture').filter(agent => this.source.store.get<string>('pilot-usage-complete', agent.launch) !== agent.pilot?.captures)
    const next = records.length ? this.cursor++ % records.length : 0
    this.polling = (async () => { for (const agent of [...records.slice(next), ...records.slice(0, next)].slice(0, 4)) await this.observe(agent) })().finally(() => { this.polling = undefined })
    return this.polling
  }
  async drain() { await this.polling?.catch(() => {}); await Promise.allSettled([...this.inflight.values()]) }
  private async observeNow(agent: CoreAgent) {
    if (!agent.pilot || this.source.store.get<string>('pilot-usage-complete', agent.launch) === agent.pilot.captures) return
    const run = this.source.pilots.policy.get(agent.pilot.run)
    if (!run || run.place !== agent.space || run.machine !== agent.machine) return
    let state = this.states.get(agent.launch)
    if (!state || state.launch !== agent.launch || state.root !== agent.pilot.captures) {
      state = { launch: agent.launch, root: agent.pilot.captures, at: 0, after: 0, next: 0, tails: new Map(), caughtUp: new Set(), complete: false }; this.states.set(agent.launch, state)
    }
    if (state.complete || this.now() - state.at < 1000) return
    state.at = this.now()
    const finished = this.source.agents.terminal(agent)?.state === 'finished'
    const runtime = await this.source.agents.browserRuntime(agent.machine)
    const inventory = JSON.parse((await this.source.files.exec(agent.machine, [runtime.bun, join(runtime.root, 'helper/core-pilot-inventory.ts')], undefined,
      Buffer.from(JSON.stringify({ root: state.root, after: state.after })), 10)).toString()) as PilotInventory
    if (!inventory || !Array.isArray(inventory.files) || inventory.files.length > 128 || !Number.isSafeInteger(inventory.next) || inventory.next < state.after || typeof inventory.more !== 'boolean') throw Error('Invalid native capture inventory response')
    state.after = inventory.more ? inventory.next : 0
    for (const item of inventory.files) {
      const name = pilotCaptureName(item.file), path = join(state.root, name)
      if (!state.tails.has(name) || state.tails.get(name)!.identity !== item.identity) {
        if (!state.tails.has(name) && state.tails.size >= 10000) throw Error('Native usage file limit reached')
        if (typeof item.identity !== 'string' || !/^\d+:\d+:\d+$/.test(item.identity)) throw Error('Invalid capture generation')
        state.caughtUp.delete(path)
        state.tails.set(name, { path, identity: item.identity, file: new CoreNativeFile(path) })
      }
      // Codex can use its own native log without executing an extra command hook. Never inspect a terminal screen.
      if (agent.kind === 'codex' && !agent.transcript && item.session?.source === 'cli' && item.session.cwd === (this.source.tasks.forChat(agent.chat)?.folder ?? this.source.space(agent.space)?.folder) && name.startsWith('.codex/sessions/') && !name.includes('/subagents/')) {
        const current = this.source.agents.get(agent.chat)
        if (current?.launch === agent.launch && current.grant === agent.grant && !current.transcript) {
          current.transcript = path; this.source.store.set('agent', current.chat, current)
        }
      }
    }
    const tails = [...state.tails.values()]
    for (let count = 0; count < Math.min(4, tails.length); count++) {
      const tail = tails[state.next++ % tails.length]
      const batch = await tail.file.read(this.source.files, agent.machine, runtime.bun, () => {})
      if (batch.oversized) throw Error('A native usage record exceeded 64 MiB and was skipped; reported token totals may be incomplete')
      if (finished && !batch.more) state.caughtUp.add(tail.path)
      const usageLines = batch.lines.filter(line => line.text.includes('\"usage\"') || line.text.includes('token_count'))
      for (const line of usageLines) {
        const usage = pilotReportedUsage(tail.path, line.text, line.offset, tail.identity)
        if (!usage) continue
        const identity = createHash('sha256').update(usage.id).digest('hex')
        this.source.pilots.policy.usage(run.id, identity, usage.tokens)
      }
    }
    if (finished && !inventory.more && state.caughtUp.size === state.tails.size) { state.complete = true; state.tails.clear(); state.caughtUp.clear(); this.source.store.set('pilot-usage-complete', agent.launch, state.root) }
  }
}
