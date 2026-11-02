import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, linkSync, unlinkSync, mkdirSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWorktree } from '../helper/core-worktree.ts'

// Real scratch Git repositories, run on GitHub only.
test('native worktree files, literal paths, rename diff and path isolation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-tree-'))
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root, stdin: 'ignore' })
    if (result.exitCode) throw Error(result.stderr.toString())
  }
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(root, 'example.txt'), 'before\n'); writeFileSync(join(root, 'a\tb.txt'), 'before\n'); writeFileSync(join(root, 'original.txt'), 'rename\n'); writeFileSync(join(root, '.gitignore'), '.env\n')
    git('add', '.'); git('commit', '-m', 'baseline'); git('switch', '-c', 'work/example')
    writeFileSync(join(root, 'example.txt'), 'after\n'); writeFileSync(join(root, 'a\tb.txt'), 'after\n'); git('mv', 'original.txt', 'renamed.txt'); writeFileSync(join(root, '[literal].txt'), 'new\n')
    writeFileSync(join(root, '.env'), 'SYNTHETIC_PRIVATE_MATERIAL')
    symlinkSync('.env', join(root, 'alias.txt'))
    symlinkSync('/etc/passwd', join(root, 'outside.txt'))
    linkSync(join(root, '.env'), join(root, 'linked.txt'))
    const ask = { folder: root, base: 'main', branch: 'work/example' }
    expect(await readWorktree({ ...ask, what: 'files' })).toMatchObject({ files: expect.arrayContaining(['example.txt', '[literal].txt']) })
    expect(await readWorktree({ ...ask, what: 'file', path: '[literal].txt' })).toMatchObject({ text: 'new\n' })
    for (const path of ['../secret', '.git/config', '.env', 'alias.txt', 'outside.txt', 'linked.txt']) await expect(readWorktree({ ...ask, what: 'file', path })).rejects.toThrow()
    unlinkSync(join(root, 'linked.txt'))
    expect(await readWorktree({ ...ask, what: 'diff' })).toMatchObject({ files: expect.arrayContaining([expect.objectContaining({ path: 'example.txt', add: 1, del: 1 }), expect.objectContaining({ path: '[literal].txt', add: 1 }), expect.objectContaining({ path: 'a\tb.txt', add: 1, del: 1 }), expect.objectContaining({ path: 'renamed.txt', status: 'renamed', from: 'original.txt' })]) })
    expect(await readWorktree({ ...ask, what: 'patch', path: '[literal].txt' })).toMatchObject({ text: expect.stringContaining('+new') })
    expect(await readWorktree({ ...ask, what: 'pr' })).toMatchObject({ pr: null, why: 'This space has no GitHub remote.' })
    await expect(readWorktree({ ...ask, what: 'patch', path: '.env' })).rejects.toThrow('no changes')
    unlinkSync(join(root, 'example.txt')); linkSync(join(root, '.env'), join(root, 'example.txt'))
    await expect(readWorktree({ ...ask, what: 'file', path: 'example.txt' })).rejects.toThrow()
    await expect(readWorktree({ ...ask, what: 'diff' })).rejects.toThrow('readable boundary')
    await expect(readWorktree({ ...ask, what: 'patch', path: 'example.txt' })).rejects.toThrow('readable boundary')
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('unreadable GitHub checks are not reported as no checks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-tree-gh-')), bin = join(root, 'bin')
  mkdirSync(bin)
  const git = (...args: string[]) => { const result = Bun.spawnSync(['git', ...args], { cwd: root, stdin: 'ignore' }); if (result.exitCode) throw Error(result.stderr.toString()) }
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(root, 'example.txt'), 'example\n'); git('add', '.'); git('commit', '-m', 'baseline'); git('remote', 'add', 'origin', 'https://github.com/example/example.git')
    const gh = join(bin, 'gh')
    writeFileSync(gh, `#!${process.execPath}\nconst args=process.argv.slice(2);if(args.some(word=>word.split(',').includes('headRefOid'))){process.stdout.write(JSON.stringify({number:1,title:'Example',state:'OPEN',isDraft:false,url:'https://github.com/example/example/pull/1',headRefOid:'abc'}))}else{process.stderr.write('not accessible by personal access token');process.exitCode=1}`)
    chmodSync(gh, 0o700)
    const script = readFileSync(join(import.meta.dir, '../helper/core-worktree.ts'), 'utf8') + '\nprocess.stdout.write(JSON.stringify(await readWorktree(JSON.parse(await Bun.stdin.text()))))'
    const child = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, PATH: bin + ':' + process.env.PATH }, stdin: Buffer.from(JSON.stringify({ folder: root, base: 'main', branch: 'main', what: 'pr' })) })
    expect(child.exitCode).toBe(0)
    expect(JSON.parse(child.stdout.toString())).toMatchObject({ pr: { checks: [], checksError: 'Could not read GitHub checks.' } })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('contained file and diff panels use checked Git without executing host callbacks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-tree-checked-'))
  const git = (...args: string[]) => { const p = Bun.spawnSync(['git', ...args], { cwd: root }); if (p.exitCode) throw Error(p.stderr.toString()) }
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(root, '[literal].txt'), 'before\n'); git('add', '.'); git('commit', '-m', 'Base')
    writeFileSync(join(root, '[literal].txt'), 'after\n')
    const marker = join(root, 'executed'), callback = join(root, 'callback')
    writeFileSync(callback, `#!/bin/sh\nprintf executed > '${marker}'\n`, { mode: 0o700 })
    git('config', 'core.fsmonitor', callback)
    const checked = { repo: root, writableRoots: [root], bun: process.execPath, helper: join(import.meta.dir, '../helper/core-pilot-git.ts') }
    const ask = { folder: root, base: 'main', branch: 'main', checked }
    expect(await readWorktree({ ...ask, what: 'file', path: '[literal].txt' })).toMatchObject({ text: 'after\n' })
    expect(await readWorktree({ ...ask, what: 'patch', path: '[literal].txt' })).toMatchObject({ text: expect.stringContaining('+after') })
    expect(await Bun.file(marker).exists()).toBe(false)
    git('config', 'include.path', '../not-created.cfg')
    await expect(readWorktree({ ...ask, what: 'files' })).rejects.toThrow('no longer available')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
