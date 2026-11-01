import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pilotGitCommand } from '../helper/core-pilot-git.ts'
import { readWorktree } from '../helper/core-worktree.ts'

// Bun reads bunfig.toml from where it starts, and a worker can write its worktree: a host Bun started there runs its code.
const start = (cwd: string) => Bun.spawn([process.execPath, '-e', '0'], { cwd, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).exited
test('a bunfig.toml planted in a worktree runs in no host Bun the broker starts', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shep-pilot-bunfig-'))), marker = `${root}-ran`
  const git = (...args: string[]) => { const out = Bun.spawnSync(['git', ...args], { cwd: root, env: { PATH: process.env.PATH, HOME: root, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }); if (out.exitCode) throw Error(out.stderr.toString()) }
  try {
    git('init', '-q', '-b', 'main'); writeFileSync(join(root, 'README'), 'x'); git('add', '.'); git('commit', '-qm', 'first')
    git('remote', 'add', 'origin', 'ssh://git@invalid.invalid/none.git')
    writeFileSync(join(root, 'bunfig.toml'), 'preload = ["./planted.ts"]\n')
    writeFileSync(join(root, 'planted.ts'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n`)
    const checked = { repo: root, writableRoots: [root], bun: process.execPath, helper: join(import.meta.dir, '../helper/core-pilot-git.ts') }
    // The worktree view starts the Git helper; an SSH remote makes Git start the SSH helper.
    await readWorktree({ folder: root, base: 'main', branch: 'main', checked, what: 'files' })
    expect(existsSync(marker)).toBe(false)
    await pilotGitCommand({ repo: root, cwd: root, args: ['fetch', 'origin'], writableRoots: [root], timeout: 8000 }).catch(() => {})
    expect(existsSync(marker)).toBe(false)
    // The form an agent launch takes (server/core/agents.ts): its terminal reports the worktree, but its Bun starts elsewhere.
    await Bun.spawn(['/bin/sh', '-c', 'cd "$0" && exec "$@"', tmpdir(), process.execPath, '-e', '0'], { cwd: root, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).exited
    expect(existsSync(marker)).toBe(false)
    // The plant works: a Bun started here does run it, so the checks above can't pass by accident.
    await start(root)
    expect(existsSync(marker)).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(marker, { force: true }) }
}, 30_000)
