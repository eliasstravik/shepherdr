// OUTSIDE containment. Only bytes are accepted; a sender can never select a host source path.
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { constants, chmodSync, closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { PilotCapturePacket } from './core-pilot-capture.ts'
interface Cursor { identity: string; offset: number; pending: string | null }
export function pilotCaptureName(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\x00-\x1f\x7f]/.test(value) || !/^(?:\.claude\/projects|\.codex\/sessions)\/.+\.jsonl$/.test(value) || value.split('/').length > 64 || value.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Invalid native capture name')
  return value
}
export class PilotRecords {
  private db: Database
  readonly root: string
  constructor(root: string) {
    this.root = resolve(root)
    this.directory(this.root)
    const file = join(this.root, '.capture.sqlite')
    if (existsSync(file)) this.privateFile(file)
    this.db = new Database(file, { create: true }); chmodSync(file, 0o600)
    this.db.exec('PRAGMA busy_timeout=500; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS captures(path TEXT PRIMARY KEY, identity TEXT NOT NULL, offset INTEGER NOT NULL, pending TEXT)')
  }
  private directory(path: string) {
    if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || realpathSync(path) !== path) throw Error('Native capture directory must be private and owned')
  }
  private privateFile(path: string) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw Error('Native capture file must be private and unlinked')
  }
  path(name: unknown) { return join(this.root, pilotCaptureName(name)) }
  write(input: PilotCapturePacket) {
    const name = pilotCaptureName(input?.file)
    if (typeof input.identity !== 'string' || !/^\d+:\d+:\d+$/.test(input.identity) || input.identity.length > 128 || !Number.isSafeInteger(input.offset) || input.offset < 0 || typeof input.reset !== 'boolean' || typeof input.data !== 'string' || input.data.length > 180_000) throw Error('Invalid native capture packet')
    const data = Buffer.from(input.data, 'base64')
    if (data.length > 128 * 1024 || data.toString('base64') !== input.data || input.reset && input.offset !== 0 || !Number.isSafeInteger(input.offset + data.length)) throw Error('Invalid native capture chunk')
    const path = this.path(name)
    // Check every existing/new parent; none is writable by the contained agent.
    let parent = this.root
    for (const part of name.split('/').slice(0, -1)) { parent = join(parent, part); this.directory(parent) }
    if (existsSync(path)) this.privateFile(path)
    let cursor = this.db.query('SELECT identity,offset,pending FROM captures WHERE path=?').get(name) as Cursor | null
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    if (!cursor || cursor.identity !== input.identity) {
      if (input.offset !== 0 || !input.reset) throw Error('Native capture changed identity; reset it first')
      if (!cursor && (this.db.query('SELECT count(*) AS n FROM captures').get() as { n: number }).n >= 10_000) throw Error('Native capture file limit reached')
      this.db.query('INSERT INTO captures VALUES(?,?,0,?) ON CONFLICT(path) DO UPDATE SET identity=excluded.identity,offset=0,pending=excluded.pending').run(name, input.identity, hash)
      cursor = { identity: input.identity, offset: 0, pending: hash }
    }
    if (cursor.pending && cursor.pending !== hash) throw Error('Retry the unconfirmed native reset before its next chunk')
    if (input.offset > cursor.offset) throw Error('Native capture has a gap; send its earlier chunk')
    const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw Error('Native capture file changed')
      if (cursor.pending) ftruncateSync(fd, 0)
      const size = cursor.pending ? 0 : stat.size
      if (size < cursor.offset || size < input.offset || size > Math.max(cursor.offset, input.offset + data.length)) throw Error('Native capture bytes changed outside its writer')
      const overlap = Math.min(data.length, Math.max(0, size - input.offset)), existing = Buffer.alloc(overlap)
      if (overlap && (readSync(fd, existing, 0, overlap, input.offset) !== overlap || !existing.equals(data.subarray(0, overlap)))) throw Error('Native capture retry differs from its saved bytes')
      // If a write finished before its metadata commit, verify/reuse those bytes on retry.
      let at = overlap
      while (at < data.length) at += writeSync(fd, data, at, data.length - at, input.offset + at)
      fsyncSync(fd)
      const offset = Math.max(cursor.offset, input.offset + data.length)
      this.db.query('UPDATE captures SET offset=?,pending=NULL WHERE path=?').run(offset, name)
      return { offset }
    } finally { closeSync(fd) }
  }
  close() { this.db.close() }
}
