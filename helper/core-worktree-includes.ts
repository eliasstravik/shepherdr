import { createHash, randomUUID } from 'node:crypto'
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, realpathSync, readdirSync, fsyncSync, linkSync, unlinkSync, rmdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export interface IncludeInput { repo: string; folder: string; branch: string }
const MAX_LIST = 2 * 1024 * 1024, MAX_BYTES = 64 * 1024 * 1024, MAX_FILE = 16 * 1024 * 1024
async function git(cwd: string, args: string[], input?: Buffer, allowed = [0]) {
  const child = Bun.spawn(['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '--no-pager', ...args], { cwd, stdin: input ?? 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const deadline = setTimeout(() => child.kill(), 30_000)
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Buffer[] = []; let size = 0
    const reader = stream.getReader()
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > MAX_LIST) { child.kill(); throw Error('Worktree include selection is too large') }; chunks.push(Buffer.from(next.value)) } }
    finally { reader.releaseLock() }
    return Buffer.concat(chunks)
  }
  try {
    const [out, , code] = await Promise.all([read(child.stdout), read(child.stderr), child.exited])
    if (!allowed.includes(code)) throw Error('Git could not verify the worktree include selection')
    return out
  } finally { clearTimeout(deadline) }
}
const paths = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0').filter(Boolean)
function plainParents(root: string, rel: string, create = false) {
  const parts = rel.split('/')
  if (!rel || isAbsolute(rel) || rel.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || part === '.git')) throw Error('Worktree includes must stay inside the project')
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    if (create) { try { mkdirSync(current, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error } }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Worktree includes cannot follow directory links')
  }
}
export const includeStagePath = (repo: string, folder: string) => join(dirname(folder), `.shepherdr-includes-${createHash('sha256').update(JSON.stringify([repo, folder])).digest('hex').slice(0, 24)}`)
function checkStage(stage: string) {
  const stat = lstatSync(stage)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || realpathSync(stage) !== stage) throw Error('Worktree include staging must be private and owned')
}
/** Reconcile only our private temporary inodes; never remove a task's destination. */
async function repairStage(folder: string, stage: string) {
  try { checkStage(stage) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const names = readdirSync(stage)
  if (names.length > 4096) throw Error('Worktree include staging needs operator cleanup')
  const entries = names.map(name => {
    const path = join(stage, name), stat = lstatSync(path)
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(name) || !stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || stat.size > MAX_FILE || stat.nlink > 2) throw Error('Unrecognized worktree include staging was left untouched')
    return { path, stat }
  })
  const linked = new Set<string>()
  if (entries.some(entry => entry.stat.nlink === 2)) {
    for (const rel of paths(await git(folder, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']))) {
      plainParents(folder, rel)
      const stat = lstatSync(join(folder, rel))
      if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 2) linked.add(`${stat.dev}:${stat.ino}`)
    }
  }
  if (entries.some(entry => entry.stat.nlink === 2 && !linked.has(`${entry.stat.dev}:${entry.stat.ino}`))) throw Error('An interrupted include link could not be confirmed; staging was left untouched')
  for (const entry of entries) unlinkSync(entry.path)
  try { rmdirSync(stage) } catch { /* A concurrent owned copy may still be finishing. */ }
}
/** Copy only explicitly selected files ignored in both checkouts. No setup script, links or overwrites. */
export async function seedWorktreeIncludes(input: IncludeInput) {
  if (![input.repo, input.folder].every(path => typeof path === 'string' && isAbsolute(path) && !path.includes('\0')) || typeof input.branch !== 'string') throw Error('Invalid worktree include request')
  const repo = realpathSync(input.repo), folder = realpathSync(input.folder)
  if (repo !== resolve(input.repo) || folder !== resolve(input.folder) || repo === folder || folder.startsWith(join(repo, '.git') + '/')) throw Error('Worktree include roots must be real separate checkouts')
  for (const root of [repo, folder]) if ((await git(root, ['rev-parse', '--show-toplevel'])).toString('utf8').trim() !== root) throw Error('Worktree include roots must be checkout roots')
  const branch = (await git(folder, ['symbolic-ref', '--quiet', 'HEAD'])).toString('utf8').trim()
  const common = async (cwd: string) => realpathSync((await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).toString('utf8').trim())
  if (branch !== `refs/heads/${input.branch}` || await common(repo) !== await common(folder)) throw Error('Worktree include checkout identity changed')
  const stage = includeStagePath(repo, folder)
  if (stage.startsWith(repo + '/') || stage.startsWith(folder + '/')) throw Error('Worktree include staging must stay outside both checkouts')
  await repairStage(folder, stage)
  const list = join(repo, '.worktreeinclude')
  let rule: ReturnType<typeof lstatSync>
  try { rule = lstatSync(list) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { copied: 0 }; throw error }
  if (!rule.isFile() || rule.isSymbolicLink() || rule.nlink !== 1 || rule.size > 64 * 1024) throw Error('Use a plain .worktreeinclude file under 64 KiB')
  // Git itself applies gitignore syntax, including nested patterns and exclusions.
  const selected = paths(await git(repo, ['ls-files', '--others', '--ignored', '-z', '--exclude-from=.worktreeinclude']))
  if (selected.length > 2048) throw Error('Worktree includes support at most 2048 files')
  if (!selected.length) return { copied: 0 }
  const body = Buffer.from(selected.join('\0') + '\0')
  const sourceIgnored = new Set(paths(await git(repo, ['check-ignore', '--stdin', '-z'], body, [0, 1])))
  const targetIgnored = new Set(paths(await git(folder, ['check-ignore', '--stdin', '-z'], body, [0, 1])))
  const copy: { rel: string; size: number; mode: number }[] = []; let total = 0
  for (const rel of selected) {
    if (!sourceIgnored.has(rel)) continue
    plainParents(repo, rel)
    const from = join(repo, rel), stat = lstatSync(from)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_FILE) throw Error('Worktree includes need plain files under 16 MiB, without links')
    try { lstatSync(join(folder, rel)); continue } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!targetIgnored.has(rel)) throw Error('A selected include is not ignored in the task checkout; update its ignore rules before starting')
    total += stat.size
    if (total > MAX_BYTES) throw Error('Keep worktree includes under 64 MiB in total')
    copy.push({ rel, size: stat.size, mode: stat.mode })
  }
  if (!copy.length) return { copied: 0 }
  let madeStage = false
  try { mkdirSync(stage, { mode: 0o700 }); madeStage = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  checkStage(stage)
  let copied = 0
  try { for (const item of copy) {
    plainParents(repo, item.rel); plainParents(folder, item.rel, true)
    const from = openSync(join(repo, item.rel), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(from)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== item.size || stat.size > MAX_FILE) throw Error('A worktree include changed while copying; retry after it settles')
      // Read through the verified descriptor, with a bounded size. Values never leave this process.
      const bytes = Buffer.alloc(item.size)
      const fs = await import('node:fs')
      let offset = 0
      while (offset < bytes.length) { const count = fs.readSync(from, bytes, offset, bytes.length - offset, offset); if (!count) throw Error('A worktree include shrank while copying'); offset += count }
      const after = fstatSync(from)
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw Error('A worktree include changed while reading; retry after it settles')
      const temporary = join(stage, randomUUID())
      const target = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600 | (item.mode & 0o100))
      try {
        try { fs.writeFileSync(target, bytes); fsyncSync(target) } finally { closeSync(target) }
        // Publish a complete file without replacing even a concurrently created destination.
        linkSync(temporary, join(folder, item.rel)); copied++
      } finally { unlinkSync(temporary) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    finally { closeSync(from) }
  } } finally { if (madeStage) { try { rmdirSync(stage) } catch { /* A different in-flight copy or interrupted private staging remains. */ } } }
  return { copied }
}

if (import.meta.main) {
  try {
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 16 * 1024) throw Error('Worktree include request too large'); chunks.push(bytes) }
    const bytes = Buffer.concat(chunks)
    let input: IncludeInput
    try { input = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw Error('Invalid worktree include request') }
    console.log(JSON.stringify(await seedWorktreeIncludes(input)))
  } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}
