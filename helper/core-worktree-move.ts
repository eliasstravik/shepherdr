#!/usr/bin/env bun
// Trusted core-exec operation. The machine-local lock serializes uncertain duplicate requests before checking Git.
import { constants, lstatSync, mkdirSync, openSync, closeSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pilotGitCommand } from './core-pilot-git.ts'

interface Move { repo: string; from: string; to: string; branch: string; writableRoots: string[]; sessions: string }
async function move(input: Move) {
  const git = async (args: string[], cwd = input.repo) => (await pilotGitCommand({ repo: input.repo, cwd, args, writableRoots: input.writableRoots, timeout: 60000 })).toString('utf8')
  const list = await git(['worktree', 'list', '--porcelain', '-z'])
  const matches = list.split('\0\0').map(block => block.split('\0')).filter(lines => lines.includes(`branch refs/heads/${input.branch}`))
  const folder = matches.length === 1 ? matches[0].find(line => line.startsWith('worktree '))?.slice(9) : undefined
  if (folder === input.from && input.from !== input.to) await git(['worktree', 'move', input.from, input.to])
  else if (folder !== input.to) throw Error('Worktree registration changed; move refused')
  // This also validates the destination's Git metadata through the checked broker.
  if ((await git(['rev-parse', 'HEAD'], input.to)).trim() !== (await git(['rev-parse', '--verify', '--end-of-options', `${input.branch}^{commit}`])).trim()) throw Error('Moved worktree head differs from its branch')
  process.stdout.write('WORKTREE_MOVE_CONFIRMED')
}
if (import.meta.main) {
  try {
    const chunks: Buffer[] = []; let size = 0
    for await (const part of process.stdin) { const b = Buffer.from(part); size += b.length; if (size > 1024 * 1024) throw Error('Move input too large'); chunks.push(b) }
    const body = Buffer.concat(chunks), input = JSON.parse(body.toString('utf8')) as Move
    if (![input.repo, input.from, input.to, input.sessions].every(path => typeof path === 'string' && path.startsWith('/') && path !== '/' && !path.includes('\0')) || typeof input.branch !== 'string' || !Array.isArray(input.writableRoots)) throw Error('Invalid private worktree move')
    if (process.argv[2] === '--held') await move(input)
    else {
      const parent = lstatSync(input.sessions)
      if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077 || process.getuid && parent.uid !== process.getuid() || realpathSync(input.sessions) !== resolve(input.sessions)) throw Error('Invalid private session storage')
      const dir = join(input.sessions, 'worktree-moves'); try { mkdirSync(dir, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const s = lstatSync(dir)
      if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o077 || process.getuid && s.uid !== process.getuid() || realpathSync(dir) !== resolve(dir)) throw Error('Worktree moves need private real lock storage')
      const key = createHash('sha256').update(JSON.stringify([input.repo, input.from, input.to, input.branch])).digest('hex'), lock = join(dir, key)
      const fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
      closeSync(fd)
      const held = lstatSync(lock)
      if (!held.isFile() || held.isSymbolicLink() || held.nlink !== 1 || held.mode & 0o077 || process.getuid && held.uid !== process.getuid()) throw Error('Invalid move lock')
      const flock = Bun.which('flock')
      if (!flock) throw Error('Install flock for contained task adoption; no unlocked fallback')
      const child = Bun.spawn([realpathSync(flock), '--exclusive', '--nonblock', lock, process.execPath, import.meta.path, '--held'], { stdin: body, stdout: 'inherit', stderr: 'inherit', timeout: 70000 })
      process.exitCode = await child.exited
    }
  } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}
