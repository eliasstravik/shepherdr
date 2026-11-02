import { createHmac, timingSafeEqual } from 'node:crypto'

export const BROWSER_OSC = Buffer.from('\x1b]777;shepherdr-browser;')
export const BROWSER_PACKET_MAX = 2 * 1024 * 1024

/** Direction-separated authentication; labels or terminal text are never authority. */
export function browserPacket(key: string, direction: 'up' | 'down', value: unknown) {
  const body = JSON.stringify(value)
  const signature = createHmac('sha256', key).update(direction + '\0' + body).digest('hex')
  const packet = JSON.stringify({ body, signature })
  if (Buffer.byteLength(packet) > BROWSER_PACKET_MAX) throw Error('Browser message exceeds the relay limit')
  return packet
}
export function browserOpen(key: string, direction: 'up' | 'down', packet: string): unknown {
  if (Buffer.byteLength(packet) > BROWSER_PACKET_MAX) throw Error('Browser message exceeds the relay limit')
  const value = JSON.parse(packet)
  if (typeof value.body !== 'string' || typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature)) throw Error('Invalid browser relay authentication')
  const expected = createHmac('sha256', key).update(direction + '\0' + value.body).digest()
  if (!timingSafeEqual(expected, Buffer.from(value.signature, 'hex'))) throw Error('Invalid browser relay authentication')
  return JSON.parse(value.body)
}

/** Unknown OSC records pass live through core but never become terminal screen/history. */
export class BrowserFrames {
  private pending = Buffer.alloc(0)
  constructor(private key: string, private receive: (value: unknown) => void) {}
  push(bytes: Buffer) {
    this.pending = Buffer.concat([this.pending, bytes])
    while (this.pending.length) {
      const start = this.pending.indexOf(BROWSER_OSC)
      if (start < 0) { this.pending = Buffer.from(this.pending.subarray(-BROWSER_OSC.length + 1)); return }
      if (start) this.pending = this.pending.subarray(start)
      const end = this.pending.indexOf(7, BROWSER_OSC.length)
      if (end < 0) {
        if (this.pending.length > BROWSER_PACKET_MAX + BROWSER_OSC.length) throw Error('Browser relay buffer exceeded its limit')
        return
      }
      const packet = this.pending.subarray(BROWSER_OSC.length, end).toString('utf8')
      this.pending = this.pending.subarray(end + 1)
      this.receive(browserOpen(this.key, 'down', packet))
    }
  }
}
