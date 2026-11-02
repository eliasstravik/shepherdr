// Reads only INSIDE containment. The trusted outer wrapper receives bytes, never a host path to open.
import { constants, existsSync, openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { join, relative } from 'node:path'
export interface PilotCapturePacket { file: string; identity: string; offset: number; reset: boolean; data: string }
export interface PilotCaptureResult { complete: boolean; files: number; error?: string }
interface Position { source: string; generation: number; offset: number; anchor: string; mtime: string; ctime: string }
export class PilotCapture {
  private positions = new Map<string, Position>()
  private pending = new Set<string>()
  private rotation = 0
  private busy = false
  constructor(private home: string, private send: (packet: PilotCapturePacket, signal?: AbortSignal) => Promise<unknown>) {}
  async poll(signal?: AbortSignal): Promise<PilotCaptureResult> {
    if (this.busy) return { complete: false, files: 0 }
    this.busy = true
    try {
      signal?.throwIfAborted()
      const files: string[] = []; let limited = false
      for (const dir of ['.claude/projects', '.codex/sessions']) {
        const cwd = join(this.home, dir)
        if (!existsSync(cwd)) continue
        for (const file of new Bun.Glob('**/*.jsonl').scanSync({ cwd, dot: true, absolute: true, onlyFiles: true })) {
          if (files.length === 10_000) { limited = true; break }
          files.push(file)
        }
      }
      const live = new Set(files)
      for (const file of this.positions.keys()) if (!live.has(file)) this.positions.delete(file)
      for (const file of this.pending) if (!live.has(file)) this.pending.delete(file)
      for (const file of files) if (!this.positions.has(file)) this.pending.add(file)
      const start = files.length ? this.rotation % files.length : 0
      const batch = [...files.slice(start), ...files.slice(0, start)].slice(0, 32)
      this.rotation = start + batch.length
      let error: string | undefined = limited ? 'Native transcript capture reached its 10000-file inspection limit' : undefined
      for (const file of batch) {
        signal?.throwIfAborted()
        let fd: number | undefined
        try {
          fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
          const stat = fstatSync(fd, { bigint: true }), size = Number(stat.size)
          if (!stat.isFile() || !Number.isSafeInteger(size)) throw Error('Native transcript is not a regular bounded file')
          const old = this.positions.get(file), source = `${stat.dev}:${stat.ino}`, mtime = String(stat.mtimeNs), ctime = String(stat.ctimeNs)
          const anchor = (offset: number) => { const size = Math.min(64, offset), data = Buffer.alloc(size); const n = readSync(fd!, data, 0, size, offset - size); return data.subarray(0, n).toString('base64') }
          const reset = !old || old.source !== source || old.offset > size || old.anchor !== anchor(old.offset) ||
            old.offset === size && (old.mtime !== mtime || old.ctime !== ctime)
          const generation = old ? old.generation + (reset ? 1 : 0) : 0, offset = reset ? 0 : old.offset
          if (offset === size) {
            if (reset) {
              await this.send({ file: relative(this.home, file), identity: `${source}:${generation}`, offset: 0, reset: true, data: '' }, signal)
              signal?.throwIfAborted()
            }
            this.pending.delete(file); this.positions.set(file, { source, generation, offset, anchor: anchor(offset), mtime, ctime }); continue
          }
          this.pending.add(file)
          const buffer = Buffer.alloc(Math.min(size - offset, 128 * 1024)), n = readSync(fd, buffer, 0, buffer.length, offset)
          await this.send({ file: relative(this.home, file), identity: `${source}:${generation}`, offset, reset, data: buffer.subarray(0, n).toString('base64') }, signal)
          signal?.throwIfAborted()
          this.positions.set(file, { source, generation, offset: offset + n, anchor: anchor(offset + n), mtime, ctime })
          if (offset + n >= size) this.pending.delete(file)
        } catch {
          this.pending.add(file)
          error ??= 'Native transcript capture is catching up after a read or gateway failure'
        } finally { if (fd !== undefined) closeSync(fd) }
      }
      return { complete: !limited && this.pending.size === 0, files: files.length, error }
    } catch { return { complete: false, files: 0, error: signal?.aborted ? 'Native transcript capture was cancelled' : 'Native transcript capture could not inspect its files' } }
    finally { this.busy = false }
  }
}
