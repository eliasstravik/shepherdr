import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { Duplex } from 'node:stream'
import { CORE_GENERATION, CORE_MINIMUM, FRAME, MAX_FRAME, FrameReader, coreVersionAccepted, encodeFrame, type CoreHello, type CoreNotification, type CoreSnapshot } from './protocol.ts'

export class CoreError extends Error {
  constructor(readonly kind: string, message: string, readonly hint?: string) { super(message); this.name = 'CoreError' }
}
/** Deliberate product refusal whose message is safe for the owning agent/human to read. */
export class Refusal extends Error {
  constructor(message: string) { super(message); this.name = 'Refusal' }
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
type Stream = { data(bytes: Buffer): void; close(reason: unknown): void }
export const CORE_ENVIRONMENT = ['XDG_RUNTIME_DIR', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME'] as const
export type CoreEnvironment = Partial<Record<typeof CORE_ENVIRONMENT[number], string | null>>
export type CoreEndpoint = string | { binary: string; session?: string; socket?: string; environment?: CoreEnvironment }
const REQUIRED = ['terminal.run', 'terminal.list', 'terminal.get', 'terminal.label', 'terminal.attach', 'terminal.send', 'terminal.wait', 'terminal.read', 'terminal.keys', 'terminal.interrupt', 'terminal.kill', 'events.subscribe', 'doc.get', 'doc.set', 'file.read', 'file.write', 'machine.exec', 'machine.list', 'server.status']
const otherGeneration = (what: string) => new CoreError('incompatible', `Shepherdr speaks herdr-core generation ${CORE_GENERATION}, and ${what}. Update Shepherdr, or run it on a generation ${CORE_GENERATION} core in its own session with --core-bin and --core-session.`)
const tooOld = (version: unknown) => new CoreError('incompatible', `Shepherdr needs herdr-core ${CORE_MINIMUM} or newer; this core is ${version}. Run hc update, then start Shepherdr again.`)
const lacking = (version: unknown, missing: string[]) => new CoreError('incompatible', `herdr-core ${version} lacks what Shepherdr needs: ${missing.join(', ')}. Update hc and Shepherdr, then start Shepherdr again.`)

/** One local Unix socket. No shell, SSH bridge, screen parsing, or retry of uncertain writes. */
export class CoreClient {
  private socket: Duplex
  private next = 0
  private pending = new Map<number, Pending>()
  private streams = new Map<number, Stream>()
  private closing = new Set<number>()
  private reader = new FrameReader()
  private plain = Buffer.alloc(0)
  private framed = false
  private ended = false
  private upgradeId = 0
  private notifications = new Set<(event: CoreNotification) => void>()
  private disconnects = new Set<(error: Error) => void>()
  private constructor(readonly path: string, socket: Duplex = connect(path), private readonly dispose?: () => void) {
    this.socket = socket
    this.socket.on('data', bytes => {
      try { this.receive(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)) } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
    this.socket.on('error', error => this.fail(new CoreError('unavailable', `Core connection failed: ${error.message}`)))
    this.socket.on('close', () => this.fail(new CoreError('disconnected', 'Core disconnected; refresh state before continuing')))
  }

  static async open(path: string): Promise<CoreClient> {
    const client = new CoreClient(path)
    return this.negotiate(client)
  }

  /** Remote helpers use their own documented hc connect, never SSH or an app listener.
   * The application server itself always uses open(localSocket). */
  static async endpoint(endpoint: CoreEndpoint): Promise<CoreClient> {
    if (typeof endpoint === 'string') return this.open(endpoint)
    const env = { ...process.env }
    delete env.HC_SOCKET; delete env.HC_TERMINAL_ID; delete env.HC_CORE_ID
    for (const key of CORE_ENVIRONMENT) if (endpoint.environment && Object.hasOwn(endpoint.environment, key)) {
      const value = endpoint.environment[key]
      if (value === null) delete env[key]
      else if (typeof value === 'string' && value.length <= 4096 && !value.includes('\0')) env[key] = value
      else throw new CoreError('incompatible', 'Invalid core endpoint environment')
    }
    if (endpoint.socket) env.HC_SOCKET = endpoint.socket
    if (endpoint.session) env.HC_SESSION = endpoint.session
    else delete env.HC_SESSION
    const child = spawn(endpoint.binary, ['connect'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
    const stream = new Duplex({
      read() { child.stdout.resume() },
      write(bytes, encoding, done) { child.stdin.write(bytes, encoding, done) },
      destroy(error, done) { child.stdin.destroy(); child.stdout.destroy(); done(error) },
    })
    child.stdout.on('data', bytes => { if (!stream.push(bytes)) child.stdout.pause() })
    child.stdout.on('end', () => stream.push(null))
    child.stdout.on('error', error => stream.destroy(error))
    child.stdin.on('error', error => stream.destroy(error))
    const client = new CoreClient('hc connect', stream, () => { if (child.exitCode === null) child.kill() })
    child.on('error', error => stream.destroy(error))
    child.on('exit', () => stream.destroy())
    return this.negotiate(client)
  }

  private static async negotiate(client: CoreClient): Promise<CoreClient> {
    try {
      // Only hello is sent in plain mode. Its reply switches parsing before buffered frames are consumed.
      client.upgradeId = client.next + 1
      // A core of another generation answers hello with this error, not with its own generation.
      const hello = await client.call<CoreHello>('hello', { generation: CORE_GENERATION, framed: true }).catch((error: Error) => {
        throw error instanceof CoreError && error.kind === 'unsupported_generation' ? otherGeneration(`this core does not (${error.hint || error.message})`) : error
      })
      if (hello.generation !== CORE_GENERATION) throw otherGeneration(`this core is ${hello.version}, generation ${hello.generation}`)
      if (!coreVersionAccepted(hello.version)) throw tooOld(hello.version)
      const missing = REQUIRED.filter(method => !hello.methods.includes(method))
      if (missing.length || !hello.framed) throw lacking(hello.version, hello.framed ? missing : [...missing, 'framed connections'])
      const schema = await client.call<{ info: { version: string }; methods: { name: string }[] }>('rpc.discover')
      if (!coreVersionAccepted(schema.info.version)) throw tooOld(schema.info.version)
      const undescribed = REQUIRED.filter(method => !schema.methods.some(item => item.name === method))
      if (undescribed.length) throw lacking(schema.info.version, undescribed)
      return client
    } catch (error) { client.close(); throw error }
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeout = 15_000, beforeResolve?: (value: T) => void): Promise<T> {
    if (this.ended) return Promise.reject(new CoreError('disconnected', 'Core connection is closed'))
    if (this.pending.size >= 256) return Promise.reject(new CoreError('busy', 'Too many pending core requests'))
    const id = ++this.next
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CoreError('uncertain', `Core ${method} did not answer; check state before retrying`))
      }, timeout)
      this.pending.set(id, { resolve: value => {
        try { beforeResolve?.(value as T); resolve(value as T) }
        catch (error) { reject(error) }
      }, reject, timer })
      try {
        const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
        this.write(this.framed ? encodeFrame(0, FRAME.data, bytes) : Buffer.concat([bytes, Buffer.from('\n')]))
      } catch (error) {
        this.pending.delete(id); clearTimeout(timer)
        reject(error)
      }
    })
  }

  onNotification(fn: (event: CoreNotification) => void) { this.notifications.add(fn); return () => { this.notifications.delete(fn) } }
  onDisconnect(fn: (error: Error) => void) { this.disconnects.add(fn); return () => { this.disconnects.delete(fn) } }

  async subscribe(receive: (event: CoreNotification) => void): Promise<CoreSnapshot> {
    let buffer = Buffer.alloc(0)
    const snapshot = await this.call<CoreSnapshot>('events.subscribe', {}, 15_000, snapshot => {
      if (!snapshot.channel) throw new CoreError('protocol', 'Core gave no event channel')
      this.streams.set(snapshot.channel, {
        data: bytes => {
          buffer = Buffer.concat([buffer, bytes])
          let newline: number
          while ((newline = buffer.indexOf(10)) >= 0) {
            const line = buffer.subarray(0, newline)
            buffer = buffer.subarray(newline + 1)
            if (line.length) receive(JSON.parse(line.toString('utf8')) as CoreNotification)
          }
          if (buffer.length > MAX_FRAME) throw new Error('Oversized core event')
        },
        close: () => this.fail(new CoreError('disconnected', 'Core event stream closed')),
      })
    })
    return snapshot
  }

  async attach(terminal: string, receive: Stream, cols = 80, rows = 24, options: { observe?: boolean } = {}) {
    // The server sends the reply before the first paint. Register synchronously while parsing that reply.
    const result = await this.call<{ channel: number }>('terminal.attach', { terminal, cols, rows, ...options }, 15_000, result => {
      this.streams.set(result.channel, receive)
    })
    const channel = result.channel
    return {
      input: (bytes: Uint8Array) => {
        if (!this.streams.has(channel) || this.closing.has(channel) || this.ended) throw new CoreError('disconnected', 'Terminal stream is closed')
        if (bytes.length > 256 * 1024) throw new CoreError('slow', 'Terminal input is too large')
        // Core credits its output, not viewer input. The socket write bound handles backpressure here.
        this.write(encodeFrame(channel, FRAME.data, bytes))
      },
      resize: (cols: number, rows: number) => {
        if (![cols, rows].every(n => Number.isInteger(n) && n > 0 && n <= 65535)) throw new Error('Invalid terminal size')
        const bytes = Buffer.alloc(4); bytes.writeUInt16LE(cols); bytes.writeUInt16LE(rows, 2)
        this.write(encodeFrame(channel, FRAME.resize, bytes))
      },
      close: () => {
        if (!this.streams.has(channel) || this.closing.has(channel)) return
        // Already-sent output may precede the CLOSE acknowledgment. Drain it without killing other channels.
        this.closing.add(channel)
        if (!this.ended) this.write(encodeFrame(channel, FRAME.close, Buffer.alloc(0)))
      },
    }
  }

  close() { this.fail(new CoreError('closed', 'Core client closed')) }

  private write(bytes: Buffer) {
    if (this.ended) throw new CoreError('disconnected', 'Core connection is closed')
    if (this.socket.writableLength + bytes.length > MAX_FRAME * 2) {
      this.fail(new CoreError('slow', 'Core write buffer is full'))
      throw new CoreError('slow', 'Core write buffer is full')
    }
    this.socket.write(bytes)
  }

  private receive(bytes: Buffer) {
    if (this.framed) return this.reader.push(bytes, (channel, kind, payload) => this.frame(channel, kind, payload))
    this.plain = Buffer.concat([this.plain, bytes])
    const newline = this.plain.indexOf(10)
    if (newline < 0) { if (this.plain.length > MAX_FRAME) throw new Error('Oversized core greeting'); return }
    const line = this.plain.subarray(0, newline)
    const rest = this.plain.subarray(newline + 1)
    this.plain = Buffer.alloc(0)
    const response = JSON.parse(line.toString('utf8'))
    if (response.id === this.upgradeId && response.result?.framed === true) this.framed = true
    this.message(response)
    if (rest.length) this.receive(rest)
  }

  private frame(channel: number, kind: number, payload: Buffer) {
    if (channel === 0) {
      if (kind !== FRAME.data) throw new Error('Invalid core control frame')
      this.message(JSON.parse(payload.toString('utf8')))
      return
    }
    const stream = this.streams.get(channel)
    if (kind === FRAME.data) {
      if (this.closing.has(channel)) return
      this.deliver(channel, payload)
    } else if (kind === FRAME.close) {
      this.streams.delete(channel)
      this.closing.delete(channel)
      stream?.close(payload.length ? JSON.parse(payload.toString('utf8')) : null)
    } else if (kind === FRAME.credit) {
      if (payload.length !== 4) throw new Error('Invalid core credit')
    }
  }


  private deliver(channel: number, payload: Buffer) {
    if (this.ended) return
    try {
      const stream = this.streams.get(channel)
      if (!stream) throw new Error(`Unexpected core stream ${channel}`)
      stream.data(payload)
      const credit = Buffer.alloc(4); credit.writeUInt32LE(payload.length)
      this.write(encodeFrame(channel, FRAME.credit, credit))
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
  }

  private message(message: { id?: number; result?: unknown; error?: { message: string; data?: { kind?: string; hint?: string } } }) {
    if (message.id === undefined) { for (const fn of this.notifications) fn(message as unknown as CoreNotification); return }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id); clearTimeout(pending.timer)
    if (message.error) pending.reject(new CoreError(message.error.data?.kind ?? 'rpc', message.error.message, message.error.data?.hint))
    else pending.resolve(message.result)
  }

  private fail(error: Error) {
    if (this.ended) return
    this.ended = true
    this.socket.destroy()
    this.dispose?.()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    for (const stream of this.streams.values()) { try { stream.close({ reason: 'disconnected' }) } catch { /* finish all streams */ } }
    this.streams.clear()
    this.closing.clear()
    for (const fn of this.disconnects) fn(error)
  }
}
