import { constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface Installation { format: 'shepherdr-core'; schema: 1; id: string }
export const defaultHome = () => resolve(process.env.SHEPHERDR_HOME || join(homedir(), '.shepherdr'))
const MARKER = 'installation.json'

/** Read-only classification. In particular, status never creates or migrates a home. */
export function inspectHome(home: string): 'absent' | 'empty' | 'legacy' | Installation {
  if (!existsSync(home)) return 'absent'
  const stat = lstatSync(home)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Shepherdr home must be a real directory')
  const marker = join(home, MARKER)
  if (!existsSync(marker)) return readdirSync(home).length ? 'legacy' : 'empty'
  const installation = JSON.parse(readFileSync(marker, 'utf8')) as Installation
  if (installation.format !== 'shepherdr-core' || installation.schema !== 1 || typeof installation.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(installation.id)) throw new Error('Unsupported Shepherdr home format')
  return installation
}

export function prepareHome(home: string): Installation {
  const current = inspectHome(home)
  if (current === 'legacy') throw new Error('This home contains legacy state. Keep it untouched until the approved backup and cutover. For a preview, choose an empty --home and a separate --port.')
  if (typeof current === 'object') {
    if (lstatSync(home).mode & 0o077) throw new Error('Shepherdr home must be private (mode 0700)')
    return current
  }
  mkdirSync(home, { recursive: true, mode: 0o700 })
  if (lstatSync(home).mode & 0o077) throw new Error('Shepherdr home must be private (mode 0700)')
  const installation: Installation = { format: 'shepherdr-core', schema: 1, id: randomUUID() }
  try {
    const fd = openSync(join(home, MARKER), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try { writeFileSync(fd, JSON.stringify(installation)) } finally { closeSync(fd) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const winner = inspectHome(home)
    if (typeof winner !== 'object') throw new Error('Another process changed the home during startup')
    return winner
  }
  return installation
}

/** A credential reference is not authority unless it is private, owned, and opened without following a symlink. */
export function readCredential<T>(path: string): T {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Session credential must be a private file owned by you')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.mode & 0o077 || (process.getuid && opened.uid !== process.getuid())) throw new Error('Session credential changed while opening')
    return JSON.parse(readFileSync(fd, 'utf8')) as T
  } finally { closeSync(fd) }
}
