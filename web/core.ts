// One JSON-RPC line connection to herdr-core (`hc connect`): calls, and its live events.
import { EventEmitter } from 'node:events'

export class Core extends EventEmitter {
  private proc: import('bun').Subprocess<'pipe', 'pipe', 'ignore'> | null = null
  private next = 1
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: Timer }>()

  constructor(private log: (...a: unknown[]) => void) { super() }

  async start() {
    const proc = Bun.spawn(['hc', 'connect'], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
    this.proc = proc
    this.read(proc)
    proc.exited.then(() => {
      if (this.proc !== proc) return
      this.log('herdr-core link closed; reconnecting')
      for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error('core link closed')) }
      this.waiting.clear()
      setTimeout(() => this.start().catch(() => {}), 2000)
    })
    await this.call('hello', {})
    if (!this.events) this.follow()
  }

  // Every fact change, so the page follows the window within a moment. A subscribed link only
  // streams events, so it gets its own `hc connect`.
  private events: import('bun').Subprocess<'pipe', 'pipe', 'ignore'> | null = null
  private async follow() {
    const proc = Bun.spawn(['hc', 'connect'], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
    this.events = proc
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: {} }) + '\n')
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'events.subscribe', params: {} }) + '\n')
    proc.stdin.flush()
    let buf = ''
    const dec = new TextDecoder()
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.includes('"method"')) this.emit('event')
      }
    }
    this.events = null
    setTimeout(() => this.follow(), 2000)
  }

  private async read(proc: NonNullable<typeof this.proc>) {
    let buf = ''
    const dec = new TextDecoder()
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        let m: any
        try { m = JSON.parse(line) } catch { continue }
        if (m.id != null && this.waiting.has(m.id)) {
          const w = this.waiting.get(m.id)!
          this.waiting.delete(m.id)
          clearTimeout(w.timer)
          if (m.error) w.reject(new Error(m.error.message ?? 'core error')); else w.resolve(m.result)
        } else if (m.method) this.emit('event', m.params)
      }
    }
  }

  call(method: string, params: unknown, timeoutMs = 10000): Promise<any> {
    const proc = this.proc
    if (!proc) return Promise.reject(new Error('no core link'))
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (timeoutMs && this.waiting.delete(id)) reject(new Error(`${method}: no answer`)) }, timeoutMs || 2 ** 31 - 1)
      this.waiting.set(id, { resolve, reject, timer })
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      proc.stdin.flush()
    })
  }
}
