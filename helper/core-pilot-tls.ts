// Bounded first ClientHello/SNI check, not TLS termination or encrypted HTTP inspection.
// Structures: RFC 8446 §4.1.2/§5.1, RFC 6066 §3; ECH types: RFC 9849 §5.
import { Transform, type TransformCallback } from 'node:stream'
export function pilotTlsName(raw: Buffer): string | undefined {
  if (raw.length > 96 * 1024) throw Error('TLS ClientHello exceeded its inspection bound')
  let offset = 0, records = 0, handshake = Buffer.alloc(0)
  while (offset < raw.length) {
    if (raw.length - offset < 5) return undefined
    if (++records > 64) throw Error('TLS ClientHello used too many fragments')
    if (raw[offset] !== 22 || raw[offset + 1] !== 3 || raw[offset + 2] > 3) throw Error('Only a TLS ClientHello is allowed through this gateway')
    const size = raw.readUInt16BE(offset + 3)
    if (!size || size > 16384) throw Error('Invalid TLS handshake record size')
    if (raw.length - offset < 5 + size) return undefined
    handshake = Buffer.concat([handshake, raw.subarray(offset + 5, offset + 5 + size)])
    if (handshake.length > 65536) throw Error('TLS ClientHello is too large')
    if (handshake.length >= 4) {
      if (handshake[0] !== 1) throw Error('The first TLS handshake must be ClientHello')
      const length = handshake.readUIntBE(1, 3)
      if (length < 38 || length > 65532) throw Error('Invalid TLS ClientHello length')
      if (handshake.length >= length + 4) return clientName(handshake.subarray(4, length + 4))
    }
    offset += size + 5
  }
  return undefined
}
function clientName(body: Buffer) {
  let at = 0
  const take = (size: number) => { if (size < 0 || at + size > body.length) throw Error('Truncated TLS ClientHello'); const value = body.subarray(at, at + size); at += size; return value }
  const byte = () => take(1)[0], word = () => take(2).readUInt16BE(0)
  const version = word()
  if (version < 0x0301 || version > 0x0303) throw Error('Unsupported TLS ClientHello version')
  take(32)
  const session = byte(); if (session > 32) throw Error('Invalid TLS session ID'); take(session)
  const ciphers = word(); if (ciphers < 2 || ciphers % 2) throw Error('Invalid TLS cipher list'); take(ciphers)
  const compression = byte(); if (!compression) throw Error('Invalid TLS compression list'); take(compression)
  const extensions = word(), end = at + extensions
  if (end !== body.length) throw Error('Invalid TLS extension block')
  let name: string | undefined
  const seen = new Set<number>()
  while (at < end) {
    const kind = word(), length = word(), data = take(length)
    if (seen.has(kind)) throw Error('Duplicate TLS extension'); seen.add(kind)
    if (kind === 65037 || kind === 64768) throw Error('Encrypted ClientHello cannot verify this isolated destination')
    if (kind !== 0) continue
    if (data.length < 5 || data.readUInt16BE(0) !== data.length - 2 || data[2] !== 0 || data.readUInt16BE(3) !== data.length - 5) throw Error('Invalid TLS server name list')
    const host = data.subarray(5)
    if (!host.length || host.some(byte => byte > 127) || !/^[a-z0-9.-]+$/i.test(host.toString('ascii'))) throw Error('Invalid TLS server name')
    name = host.toString('ascii').toLowerCase()
  }
  if (!name) throw Error('TLS server name is required for this isolated destination')
  return name
}
export class PilotTlsGuard extends Transform {
  readonly ready: Promise<void>
  private accept!: () => void
  private refuse!: (error: Error) => void
  private pending: Buffer | undefined = Buffer.alloc(96 * 1024)
  private size = 0
  private inspected = 0
  private needed = 5
  private valid = false
  constructor(private host: string) {
    super()
    this.ready = new Promise<void>((done, fail) => { this.accept = done; this.refuse = fail })
    void this.ready.catch(() => {})
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    if (this.valid) { done(null, chunk); return }
    try {
      this.size += chunk.length
      if (this.size > 96 * 1024) throw Error('TLS ClientHello exceeded its inspection bound')
      chunk.copy(this.pending!, this.size - chunk.length)
      if (this.size < this.needed) { done(); return }
      const bytes = this.pending!.subarray(0, this.size)
      // Do not reparse partial records on every arriving byte. Only completed records advance inspection.
      while (this.size >= this.needed) {
        if (this.needed === this.inspected + 5) {
          if (bytes[this.inspected] !== 22 || bytes[this.inspected + 1] !== 3 || bytes[this.inspected + 2] > 3) throw Error('Only a TLS ClientHello is allowed through this gateway')
          const length = bytes.readUInt16BE(this.inspected + 3)
          if (!length || length > 16384) throw Error('Invalid TLS handshake record size')
          this.needed = this.inspected + 5 + length
          if (this.size < this.needed) break
        }
        const name = pilotTlsName(bytes)
        if (name) {
          if (name !== this.host) throw Error('TLS server name differs from the permitted CONNECT host')
          this.valid = true; this.pending = undefined; this.accept(); done(null, Buffer.from(bytes)); return
        }
        this.inspected = this.needed; this.needed = this.inspected + 5
      }
      done()
    } catch (error) { this.refuse(error as Error); done(error as Error) }
  }
  override _final(done: TransformCallback) { done(this.valid ? undefined : Error('TLS ClientHello was not completed')) }
  override _destroy(error: Error | null, done: (error?: Error | null) => void) {
    if (!this.valid) this.refuse(error ?? Error('TLS ClientHello was interrupted'))
    this.pending = undefined; done(error)
  }
}
