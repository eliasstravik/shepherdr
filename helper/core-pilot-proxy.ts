// OUTSIDE containment, in one core-owned agent wrapper. Unix-only listener; all product authority is fixed by backend.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect, type Socket, type NetConnectOpts } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { Transform } from 'node:stream'
import { chmodSync, lstatSync, realpathSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { setMaxListeners } from 'node:events'
import { pilotPublicAddress } from './core-pilot-sandbox.ts'
import { PilotTlsGuard } from './core-pilot-tls.ts'
import type { PilotRecords } from './core-pilot-records.ts'

export interface PilotProxyBackend {
  cli(args: string[], stdin: string | undefined, id: string, signal: AbortSignal): Promise<unknown>
  secret(names: string[], id: string, signal: AbortSignal): Promise<unknown>
  hook(input: unknown, id: string, signal: AbortSignal): Promise<unknown>
  lease(signal: AbortSignal): Promise<void>
  reserve(bytes: number, signal: AbortSignal): Promise<void>
}
export class PilotProxy {
  private sockets = new Set<Socket>()
  private closing = new AbortController()
  private active = 0
  private handshakes = 0
  private path?: string
  private inode?: number
  private server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 15_000, headersTimeout: 15_000 }, (req, res) => { void this.mail(req, res) })
  constructor(private hosts: string[], private records: PilotRecords, private backend: PilotProxyBackend,
    private dns: (host: string, options: { all: true }) => Promise<LookupAddress[]> = lookup, private tcp: (options: NetConnectOpts) => Socket = connect) {
    setMaxListeners(32, this.closing.signal)
    this.server.on('error', () => { this.closing.abort(); for (const socket of this.sockets) socket.destroy() })
    this.server.on('connection', socket => {
      if (this.closing.signal.aborted || this.sockets.size >= 16) { socket.destroy(); return }
      this.track(socket)
    })
    this.server.on('connect', (req, client, head) => { void this.https(req, client as Socket, head) })
    this.server.on('clientError', (_error, socket) => socket.destroy())
  }
  private track(socket: Socket) { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); socket.on('error', () => {}) }
  async listen(socket: string) {
    if (this.path) throw Error('The isolated gateway is already listening')
    const path = resolve(socket), parent = dirname(path), stat = lstatSync(parent)
    let occupied = false
    try { lstatSync(path); occupied = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || realpathSync(parent) !== parent || occupied) throw Error('Use an unused socket in a private owned real directory')
    await new Promise<void>((done, fail) => {
      const error = (error: Error) => { this.server.off('listening', ready); fail(error) }
      const ready = () => { this.server.off('error', error); done() }
      this.server.once('error', error); this.server.once('listening', ready); this.server.listen(path)
    })
    try { chmodSync(path, 0o600); this.path = path; this.inode = lstatSync(path).ino }
    catch (error) { await this.close(); throw error }
  }
  private reply(res: ServerResponse, value: unknown, error?: string) {
    if (res.destroyed || res.writableEnded) return
    let body = JSON.stringify(error ? { ok: false, error: error.slice(0, 4000) } : { ok: true, value })
    if (Buffer.byteLength(body) > 1_048_576) { error = 'Isolated command response is too large'; body = JSON.stringify({ ok: false, error }) }
    res.statusCode = error ? 400 : 200; res.setHeader('content-type', 'application/json'); res.end(body)
  }
  private async mail(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST' || req.url !== '/mail' || this.closing.signal.aborted || this.active >= 8) { res.setHeader('connection', 'close'); this.reply(res, undefined, 'This isolated gateway is unavailable or the request is not allowed'); req.resume(); return }
    this.active++
    const cancel = new AbortController(), stop = () => cancel.abort()
    const disconnected = () => { if (!res.writableEnded) cancel.abort() }
    this.closing.signal.addEventListener('abort', stop, { once: true }); res.on('close', disconnected)
    const timer = setTimeout(() => req.destroy(Error('Command body timed out')), 5000)
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const part of req) {
        const bytes = Buffer.from(part); size += bytes.length
        if (size > 1_048_576) throw Error('Isolated command request is too large')
        chunks.push(bytes)
      }
      clearTimeout(timer); cancel.signal.throwIfAborted()
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!input || !/^[a-f0-9-]{36}$/.test(input.id) || typeof input.action !== 'string') throw Error('Invalid isolated request identity')
      let answer: unknown
      switch (input.action) {
        case 'capture': answer = this.records.write(input.args); break
        case 'cli': {
          const args = input.args?.args, stdin = input.args?.stdin
          if (!Array.isArray(args) || args.length > 256 || args.some(word => typeof word !== 'string' || word.length > 65536) || stdin !== undefined && (typeof stdin !== 'string' || Buffer.byteLength(stdin) > 65536)) throw Error('Invalid isolated command words/input')
          answer = await this.backend.cli(args, stdin, input.id, cancel.signal); break
        }
        case 'secret': {
          const names = input.args?.names
          if (!Array.isArray(names) || names.length > 128 || names.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))) throw Error('Use valid secret names')
          answer = await this.backend.secret(names, input.id, cancel.signal); break
        }
        case 'hook': answer = await this.backend.hook(input.args, input.id, cancel.signal); break
        default: throw Error('Only isolated product commands, hooks and native captures are available')
      }
      this.reply(res, answer)
    } catch (error) { if (!res.headersSent) res.setHeader('connection', 'close'); this.reply(res, undefined, (error as Error).message || 'Isolated command failed'); req.resume() }
    finally { clearTimeout(timer); this.active--; this.closing.signal.removeEventListener('abort', stop); res.off('close', disconnected) }
  }
  private async https(req: IncomingMessage, client: Socket, head: Buffer) {
    const match = req.url?.match(/^([a-z0-9.-]+):443$/i), host = match?.[1].toLowerCase()
    if (!host || !this.hosts.includes(host) || this.closing.signal.aborted || this.handshakes >= 8 || head.length > 256 * 1024) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    this.handshakes++
    const cancel = new AbortController(), stop = () => cancel.abort()
    this.closing.signal.addEventListener('abort', stop, { once: true }); client.once('close', stop)
    let upstream: Socket | undefined, established = false, ended = false
    const flows: Transform[] = []
    const end = () => { if (ended) return; ended = true; cancel.abort(); for (const flow of flows) flow.destroy(); upstream?.destroy(); client.destroy(); this.closing.signal.removeEventListener('abort', stop) }
    try {
      await this.backend.lease(cancel.signal)
      const addresses = await this.dns(host, { all: true })
      if (!addresses.length || addresses.length > 64 || addresses.some(address => !pilotPublicAddress(address.address))) throw Error('Private/local destinations are outside this permission profile')
      cancel.signal.throwIfAborted()
      const address = addresses.find(address => address.family === 4) ?? addresses[0]
      upstream = this.tcp({ host: address.address, port: 443, signal: cancel.signal }); this.track(upstream)
      const peer = upstream
      client.on('error', end); client.once('close', end); peer.on('error', end); peer.once('close', () => { if (!established || !peer.readableEnded) end() })
      peer.setTimeout(60_000, end); client.setTimeout(60_000, end)
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(() => { peer.destroy(); fail(Error('HTTPS connection timed out')) }, 10_000)
        peer.once('error', error => { clearTimeout(timer); fail(error) })
        peer.once('connect', () => { clearTimeout(timer); done() })
      })
      cancel.signal.throwIfAborted()
      const guard = new PilotTlsGuard(host)
      const handshakeTimer = setTimeout(() => guard.destroy(Error('TLS ClientHello timed out')), 10_000)
      void guard.ready.finally(() => clearTimeout(handshakeTimer)).catch(() => {})
      guard.on('error', end)
      const meter = (incoming = false) => new Transform({ transform: (chunk, _encoding, done) => {
        const bytes = Buffer.from(chunk)
        if (bytes.length > 256 * 1024) { done(Error('HTTPS chunk exceeded its bound')); return }
        void (async () => {
          if (incoming) await guard.ready
          for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
            const part = bytes.subarray(offset, offset + 64 * 1024)
            await this.backend.reserve(part.length, cancel.signal)
            cancel.signal.throwIfAborted()
          }
        })().then(() => done(null, bytes), error => done(error))
      } })
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); established = true
      const outgoing = meter(), incoming = meter(true)
      flows.push(guard, outgoing, incoming)
      outgoing.on('error', end); incoming.on('error', end)
      guard.pipe(outgoing).pipe(peer); peer.pipe(incoming).pipe(client)
      // Queue the parser's initial bytes before later socket data; the same meter preserves their order.
      if (head.length) guard.write(head)
      client.pipe(guard)
    } catch { if (established) client.destroy(); else client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); upstream?.destroy(); this.closing.signal.removeEventListener('abort', stop) }
    finally { this.handshakes-- }
  }
  async close() {
    this.closing.abort()
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>(done => this.server.close(() => done()))
    if (this.path) {
      try { if (lstatSync(this.path).isSocket() && lstatSync(this.path).ino === this.inode) unlinkSync(this.path) } catch { /* listener already removed its own socket */ }
    }
  }
}
