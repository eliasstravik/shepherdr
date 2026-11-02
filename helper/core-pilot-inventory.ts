// Stateless private capture metadata, read only through core machine.exec. Never enumerates a host provider home.
import { Database } from 'bun:sqlite'
import { constants, existsSync, lstatSync, realpathSync, openSync, closeSync, fstatSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { pilotCaptureName } from './core-pilot-records.ts'

export interface PilotInventory { files: { row: number; file: string; identity: string; session?: { id: string; cwd: string; source: string } }[]; next: number; more: boolean }
function session(root: string, file: string) {
  if (!file.startsWith('.codex/sessions/')) return
  const fd = openSync(join(root, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw Error('Native capture is not private')
    const bytes = Buffer.alloc(65536), size = readSync(fd, bytes, 0, bytes.length, 0), end = bytes.subarray(0, size).indexOf(10)
    if (end < 0) return
    let value
    try { value = JSON.parse(bytes.subarray(0, end).toString('utf8')) } catch { return }
    if (value && typeof value === 'object' && value.type === 'session_meta' && typeof value.payload?.id === 'string' && /^[a-f0-9-]{36}$/i.test(value.payload.id) && typeof value.payload.cwd === 'string' && typeof value.payload.source === 'string') return { id: value.payload.id, cwd: value.payload.cwd, source: value.payload.source }
  } finally { closeSync(fd) }
}
export function pilotInventory(root: string, after = 0): PilotInventory {
  if (typeof root !== 'string' || !Number.isSafeInteger(after) || after < 0) throw Error('Invalid private capture inventory')
  const directory = lstatSync(root)
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o077 || process.getuid && directory.uid !== process.getuid() || realpathSync(root) !== root) throw Error('Capture inventory needs a private owned real directory')
  const path = join(root, '.capture.sqlite')
  if (!existsSync(path)) return { files: [], next: 0, more: false }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw Error('Capture index is not private')
  const db = new Database(path, { readonly: true })
  try {
    db.exec('PRAGMA busy_timeout=500')
    const rows = db.query('SELECT rowid AS row,path AS file,identity FROM captures WHERE rowid>? ORDER BY rowid LIMIT 129').all(after) as { row: number; file: string; identity: string }[]
    const files = rows.slice(0, 128).map(row => {
      if (typeof row.identity !== 'string' || !/^\d+:\d+:\d+$/.test(row.identity) || row.identity.length > 128) throw Error('Invalid capture generation')
      return { row: row.row, file: pilotCaptureName(row.file), identity: row.identity, session: session(root, pilotCaptureName(row.file)) }
    })
    return { files, next: files.at(-1)?.row ?? after, more: rows.length > 128 }
  } finally { db.close() }
}
if (import.meta.main) {
  try { const text = await Bun.stdin.text(); if (text.length > 8192) throw Error('Capture inventory input is too large'); const input = JSON.parse(text); console.log(JSON.stringify(pilotInventory(input.root, input.after))) }
  catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}
