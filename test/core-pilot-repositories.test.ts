import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreStore } from '../server/core/store.ts'
import { CorePilotRepositories } from '../server/core/pilot-repositories.ts'
import { CoreGit } from '../server/core/git.ts'
import type { CoreFiles } from '../server/core/files.ts'

test('private repository boundaries survive restart and retain other contained workspace/home capabilities', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-pilot-repos-'))
  let store = new CoreStore(home)
  try {
    const repos = new CorePilotRepositories(store)
    repos.remember('a', '/repo', ['/work/one'], ['/private/one/home'])
    repos.remember('a', '/other', ['/work/two'], ['/private/two/home'])
    repos.remember('b', '/repo', ['/remote/work'], ['/remote/home'])
    store.close(); store = new CoreStore(home)
    const restored = new CorePilotRepositories(store)
    expect(restored.context({ machine: 'a', folder: '/work/one' }, ['/future/work'])).toEqual({ repo: '/repo', writableRoots: ['/repo', '/work/one', '/future/work', '/private/one/home', '/other', '/work/two', '/private/two/home'] })
    expect(restored.context({ machine: 'a', folder: '/future/work' })?.repo).toBe('/repo')
    expect(restored.context({ machine: 'a', folder: '/ordinary' })).toBeUndefined()
    expect(restored.context({ machine: 'b', folder: '/repo' })?.writableRoots).toEqual(['/repo', '/remote/work', '/remote/home'])
  } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
})

test('task Git and GH stdin use the fixed core helper with prospective worktree boundaries', async () => {
  const calls: { machine: string; argv: string[]; cwd?: string; stdin?: Buffer }[] = [], extras: string[][] = []
  const files = { async exec(machine: string, argv: string[], cwd?: string, stdin?: Buffer) { calls.push({ machine, argv, cwd, stdin }); return Buffer.from('result\n') } } as unknown as CoreFiles
  const git = new CoreGit(files, (_, additional) => { extras.push(additional ?? []); return { repo: '/repo', writableRoots: ['/repo', ...(additional ?? [])] } }, async () => ({ root: '/private/immutable', bun: '/native/bun' }))
  const repo = { machine: 'remote', folder: '/repo' }
  await git.run(repo, ['commit-tree', 'tree', '-F', '-'], 30, 'message\n')
  await git.ghRun(repo, ['pr', 'create', '--body-file', '-'], 60, 'body\n')
  await git.addWorktree(repo, '/future/work', 'work/new', 'main')
  expect(calls.every(call => call.machine === 'remote' && call.cwd === undefined && call.argv.join(' ') === '/native/bun /private/immutable/helper/core-pilot-git.ts')).toBe(true)
  expect(JSON.parse(calls[0].stdin!.toString())).toMatchObject({ cwd: '/repo', tool: 'git', stdin: 'message\n', timeout: 30000 })
  expect(JSON.parse(calls[1].stdin!.toString())).toMatchObject({ tool: 'gh', stdin: 'body\n' })
  expect(extras.at(-1)).toEqual(['/future/work'])
  expect(JSON.parse(calls.at(-1)!.stdin!.toString()).writableRoots).toContain('/future/work')
})
