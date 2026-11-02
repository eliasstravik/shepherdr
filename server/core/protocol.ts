/** Oldest herdr-core this was built on, protocol generation 1. Core updates itself and its API only grows within a
 * generation (schema/README.md in its repository), so newer ones pass; client.ts checks the generation and methods. */
export const CORE_MINIMUM = '0.1.14'
export const CORE_GENERATION = 1
export const MAX_FRAME = 16 * 1024 * 1024
export const FRAME = { data: 0, credit: 1, close: 2, resize: 3, focus: 4, facts: 5 } as const

export interface CoreTerminal {
  address: string
  name?: string | null
  parent?: string | null
  labels: Record<string, string>
  argv: string[]
  cwd: string
  state: string
  status?: { state: string; kind?: string; progress?: number; app?: string; title?: string; msg?: string } | null
  reported?: boolean
  turn?: number
  pid?: number | null
  reason?: string | null
  exit_code?: number | null
  signal?: number | null
  created_ms: number
  status_ms?: number | null
  cols: number
  rows: number
  [key: string]: unknown
}

export interface CoreSnapshot { seq: number; terminals: CoreTerminal[]; channel?: number }
export interface CoreNotification {
  jsonrpc: '2.0'
  method: 'event' | 'heartbeat' | 'missed'
  params: { seq: number; type?: string; terminal?: string; machine?: string; data?: Record<string, unknown>; terminals?: CoreTerminal[] }
}
export interface CoreHello {
  version: string
  generation: number
  framed: boolean
  core: { id: string; name: string }
  methods: string[]
  features: string[]
}

/** CORE_MINIMUM or newer, part by part: 0.1.100 is newer than 0.1.14. Anything that is no version is refused. */
export function coreVersionAccepted(version: unknown) {
  const parts = (text: string) => text.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]\S*)?$/)?.slice(1).map(Number)
  const found = typeof version === 'string' ? parts(version) : undefined, minimum = parts(CORE_MINIMUM)!
  if (!found) return false
  const differs = found.findIndex((part, index) => part !== minimum[index])
  return differs < 0 || found[differs]! > minimum[differs]!
}

export function encodeFrame(channel: number, kind: number, payload: Uint8Array): Buffer {
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffffffff || payload.length > MAX_FRAME) throw new Error('Invalid core frame')
  const frame = Buffer.allocUnsafe(9 + payload.length)
  frame.writeUInt32LE(channel, 0)
  frame[4] = kind
  frame.writeUInt32LE(payload.length, 5)
  frame.set(payload, 9)
  return frame
}

/** Incremental parser: a socket read need not end on a frame or UTF-8 boundary. */
export class FrameReader {
  private buffer = Buffer.alloc(0)
  push(bytes: Uint8Array, receive: (channel: number, kind: number, payload: Buffer) => void) {
    this.buffer = Buffer.concat([this.buffer, bytes])
    while (this.buffer.length >= 9) {
      const length = this.buffer.readUInt32LE(5)
      if (length > MAX_FRAME) throw new Error('Core frame exceeds 16 MiB')
      if (this.buffer.length < 9 + length) return
      const frame = this.buffer.subarray(0, 9 + length)
      this.buffer = this.buffer.subarray(9 + length)
      receive(frame.readUInt32LE(0), frame[4], frame.subarray(9))
    }
  }
}
