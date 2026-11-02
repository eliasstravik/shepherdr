import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newRepository } from '../server/core/new-repository.ts'
import type { CoreFiles } from '../server/core/files.ts'

test('new and existing non-repository folders get a usable empty main commit without committing their files', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-new-repo-'))
  const run = (argv: string[], cwd?: string) => {
    const result = Bun.spawnSync(argv, { cwd, env: { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1' } })
    if (result.exitCode) throw Error(result.stderr.toString())
    return Buffer.from(result.stdout)
  }
  const files = { exec: async (_machine: string, argv: string[]) => run(argv) } as CoreFiles
  const git = (path: string, ...args: string[]) => run(['git', ...args], path).toString().trim()
  try {
    writeFileSync(join(home, '.gitconfig'), '[user]\n name = Acceptance\n email = acceptance@example.invalid\n')
    for (const existing of [false, true]) {
      const path = join(home, existing ? 'existing' : 'new')
      if (existing) { mkdirSync(path); writeFileSync(join(path, 'held.txt'), 'KEEP_BYTES\n') }
      expect(await newRepository(files, 'remote', process.execPath, path)).toBe(path)
      expect(git(path, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
      expect(git(path, 'rev-list', '--count', 'HEAD')).toBe('1')
      expect(git(path, 'ls-tree', '--name-only', 'HEAD')).toBe('')
      if (existing) { expect(readFileSync(join(path, 'held.txt'), 'utf8')).toBe('KEEP_BYTES\n'); expect(git(path, 'status', '--porcelain')).toContain('?? held.txt') }
      const head = git(path, 'rev-parse', 'HEAD')
      expect(await newRepository(files, 'remote', process.execPath, path)).toBe(path)
      expect(git(path, 'rev-parse', 'HEAD')).toBe(head)
    }
    await expect(newRepository(files, 'remote', process.execPath, home)).rejects.toThrow(/^Choose a folder inside your home, not home itself\.$/)
    // a refusal is its words alone: no script, no stack, no paths of the app's own
    await expect(newRepository(files, 'remote', process.execPath, join(tmpdir(), '..', 'outside-home', 'new'))).rejects.toThrow(/^Choose a folder in your home\.$/)
    await expect(newRepository(files, 'remote', process.execPath, join(home, 'no-parent', 'new'))).rejects.toThrow(/^Choose an existing parent folder\.$/)
    await expect(newRepository(files, 'remote', process.execPath, join(tmpdir(), 'not-this-home'))).rejects.toThrow(/^Choose a folder in your home\.$/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
