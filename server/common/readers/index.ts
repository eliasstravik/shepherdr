// Picks the reader for a CLI, and tails a log file: each read() returns the events of the lines written since the
// last one.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { ClaudeReader } from './claude.ts'
import { CodexReader } from './codex.ts'
import { PiReader } from './pi.ts'
import { LOG_FINDERS } from './find.ts'
import type { LogEvent, Reader } from './types.ts'

export { ClaudeReader, CodexReader, PiReader }

const READERS: Record<string, () => Reader> = {
  claude: () => new ClaudeReader(),
  codex: () => new CodexReader(),
  pi: () => new PiReader(),
}

/** Kinds with both runtime log discovery and a transcript reader. */
export const CHAT_KINDS = Object.keys(READERS).filter((kind) => !!LOG_FINDERS[kind])

export function chatProblem(kind: string): string | undefined {
  if (!CHAT_KINDS.includes(kind)) return `${kind} does not support Shepherdr chat: no chat log reader is available. Choose ${CHAT_KINDS.join(', ')}. Headless review support is separate.`
}

/** a fresh reader for herdr's agent kind (readers remember open questions and split replies per file) */
export function readerFor(cli: string): Reader | undefined {
  const kind = cli.toLowerCase()
  const key = kind === 'claude-code' || kind === 'claudecode' ? 'claude' : kind
  return Object.hasOwn(READERS, key) ? READERS[key]() : undefined
}

// read big files a piece at a time; Claude Code logs reach tens of MB
const CHUNK = 4 << 20

export class LogTail {
  /** byte offset of the first line not read yet */
  private offset = 0
  /** byte offset of what is read so far: from offset on, the start of a line not ended yet, kept in carry */
  private pos = 0
  private carry: Buffer[] = []
  /** the file's inode: a new one means the file was replaced */
  private ino = -1
  /** the last read stopped at its limit, short of the file's end */
  private more = false

  constructor(
    readonly file: string,
    readonly reader: Reader,
  ) {}

  /** how much of the file is read so far, in bytes */
  get done(): number {
    return this.pos
  }

  /** more is written than read so far: a read with a limit stopped short */
  get behind(): boolean {
    return this.more
  }

  /** events of the complete lines written since the last read, or of about `max` bytes more of the file (a line it
   *  ends in the middle of is kept, and comes whole from a later read); starts over when the file shrank or was
   *  replaced */
  read(max = Infinity): LogEvent[] {
    let size: number
    this.more = false
    try {
      const st = statSync(this.file)
      if (st.ino !== this.ino || st.size < this.pos) this.restart(st.ino)
      size = st.size
    } catch {
      return []
    }
    if (size <= this.pos) return []

    const out: LogEvent[] = []
    let fd: number
    try {
      fd = openSync(this.file, 'r')
    } catch {
      return []
    }
    try {
      const began = this.pos
      while (this.pos < size && this.pos - began < max) {
        const buf = Buffer.alloc(Math.min(CHUNK, Math.max(max, 64 << 10), size - this.pos))
        const got = readSync(fd, buf, 0, buf.length, this.pos)
        if (got <= 0) break
        this.pos += got
        const chunk = buf.subarray(0, got)
        // a long line goes on: joined once it ends
        if (chunk.indexOf(10) === -1) {
          this.carry.push(chunk)
          continue
        }
        const data = this.carry.length ? Buffer.concat([...this.carry, chunk]) : chunk
        const start = this.offset
        const lines: { text: string; offset: number }[] = []
        let from = 0
        for (let nl = data.indexOf(10); nl !== -1; nl = data.indexOf(10, from)) {
          let text = data.toString('utf8', from, nl)
          if (text.endsWith('\r')) text = text.slice(0, -1)
          if (text.trim()) lines.push({ text, offset: start + from })
          from = nl + 1
        }
        this.carry = from < data.length ? [Buffer.from(data.subarray(from))] : []
        this.offset = start + from
        if (lines.length) out.push(...this.reader.parse(lines, this.file))
      }
      this.more = this.pos < size
    } finally {
      closeSync(fd)
    }
    return out
  }

  /** every event in the file, from the start (later read() calls go on from the end) */
  readAll(): LogEvent[] {
    this.ino = -1
    return this.read()
  }

  private restart(ino: number) {
    this.offset = 0
    this.pos = 0
    this.carry = []
    this.ino = ino
    this.reader.reset?.(this.file)
  }
}
