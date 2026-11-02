import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pilotConfigPath, pilotGitCommand, pilotGitOptions } from '../helper/core-pilot-git.ts'

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-git-')), repo = join(root, 'repo'), marker = join(root, 'executed'), attack = join(root, 'attack')
  mkdirSync(repo)
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
    if (result.exitCode) throw Error(result.stderr.toString() || result.stdout.toString())
    return result.stdout.toString().trim()
  }
  git('init', '--initial-branch=main'); git('config', 'user.name', 'Isolated CI'); git('config', 'user.email', 'proof@example.invalid')
  writeFileSync(attack, `#!/bin/sh\nprintf executed > ${quote(marker)}\ncat\n`, { mode: 0o700 })
  const run = (args: string[]) => pilotGitCommand({ repo, cwd: repo, args, writableRoots: [repo] })
  return { root, repo, marker, attack, git, run, close() { rmSync(root, { recursive: true, force: true }) } }
}

test('checked add/commit blocks workspace filters hooks fsmonitor and signing but preserves ordinary file content', async () => {
  const f = fixture()
  try {
    const hooks = join(f.root, 'hooks'); mkdirSync(hooks)
    for (const hook of ['pre-commit', 'post-commit']) writeFileSync(join(hooks, hook), readFileSync(f.attack), { mode: 0o700 })
    f.git('config', 'core.hooksPath', hooks)
    f.git('config', 'core.fsmonitor', f.attack)
    f.git('config', 'filter.attack.clean', `sh ${quote(f.attack)}`)
    f.git('config', 'filter.attack.required', 'true')
    f.git('config', 'commit.gpgSign', 'true'); f.git('config', 'gpg.program', f.attack)
    writeFileSync(join(f.repo, '.gitattributes'), '*.txt filter=attack\n')
    writeFileSync(join(f.repo, 'kept.txt'), 'ORIGINAL\n')
    await f.run(['add', '--all'])
    await f.run(['commit', '-m', 'Checked commit'])
    expect(existsSync(f.marker)).toBe(false)
    expect((await f.run(['show', 'HEAD:kept.txt'])).toString()).toBe('ORIGINAL\n')
  } finally { f.close() }
})

test('mutable and currently missing include targets are refused before a repository command', async () => {
  const f = fixture()
  try {
    f.git('config', 'include.path', '../mutable.cfg')
    writeFileSync(join(f.repo, 'mutable.cfg'), `[filter "later"]\n clean = sh ${f.attack}\n`)
    await expect(f.run(['status', '--porcelain'])).rejects.toThrow('writable contained')
    rmSync(join(f.repo, 'mutable.cfg'))
    await expect(f.run(['status', '--porcelain'])).rejects.toThrow('writable contained')
    const link = join(f.root, 'outside-link')
    symlinkSync(join(f.repo, 'not-created.cfg'), link)
    f.git('config', 'include.path', link)
    await expect(f.run(['status', '--porcelain'])).rejects.toThrow('writable contained')
    expect(existsSync(f.marker)).toBe(false)
  } finally { f.close() }
})

test('a custom merge driver cannot run workspace code during the checked merge-tree operation', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, '.gitattributes'), '*.txt merge=attack\n'); writeFileSync(join(f.repo, 'value.txt'), 'base\n')
    f.git('add', '--all'); f.git('commit', '-m', 'Base'); f.git('branch', 'right'); f.git('checkout', '-b', 'left')
    writeFileSync(join(f.repo, 'value.txt'), 'left\n'); f.git('add', '--all'); f.git('commit', '-m', 'Left'); f.git('checkout', 'right')
    writeFileSync(join(f.repo, 'value.txt'), 'right\n'); f.git('add', '--all'); f.git('commit', '-m', 'Right')
    f.git('config', 'merge.attack.driver', `sh ${quote(f.attack)}`)
    // The unsafe native operation demonstrates why metadata read-only alone is insufficient.
    Bun.spawnSync(['git', 'merge-tree', '--write-tree', 'left', 'right'], { cwd: f.repo })
    expect(existsSync(f.marker)).toBe(true); rmSync(f.marker)
    await expect(f.run(['merge-tree', '--write-tree', 'left', 'right'])).rejects.toThrow()
    expect(existsSync(f.marker)).toBe(false)
  } finally { f.close() }
})

test('custom remote programs are refused before effect and ordinary file-repository push still works', async () => {
  const f = fixture()
  try {
    const remote = join(f.root, 'remote.git')
    f.git('init', '--bare', remote)
    writeFileSync(join(f.repo, 'kept.txt'), 'kept'); f.git('add', '--all'); f.git('commit', '-m', 'Base')
    f.git('remote', 'add', 'origin', remote); f.git('config', 'remote.origin.receivepack', `sh ${quote(f.attack)}`)
    await expect(f.run(['push', 'origin', 'main'])).rejects.toThrow('Custom Git remote programs')
    expect(existsSync(f.marker)).toBe(false)
    f.git('config', '--unset', 'remote.origin.receivepack')
    await f.run(['push', 'origin', 'main'])
    expect(existsSync(f.marker)).toBe(false)
    expect(f.git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(f.git('rev-parse', 'HEAD'))
  } finally { f.close() }
})

test('driver options disable every configured callback and unresolved include paths retain their actual target', () => {
  const options = pilotGitOptions(['filter.lfs.process', 'filter.lfs.required', 'merge.custom.driver', 'diff.custom.textconv', 'remote.origin.uploadpack'])
  for (const value of ['filter.lfs.process=', 'filter.lfs.clean=', 'filter.lfs.smudge=', 'filter.lfs.required=false', 'merge.custom.driver=false', 'diff.custom.textconv=false', 'protocol.ext.allow=never', 'protocol.ssh.allow=never']) expect(options).toContain(value)
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-git-path-'))
  try { symlinkSync(join(root, 'missing/target'), join(root, 'link')); expect(pilotConfigPath(join(root, 'link'))).toBe(join(root, 'missing/target')) }
  finally { rmSync(root, { recursive: true, force: true }) }
})

test('repository core.worktree cannot redirect reads or staging into a private host directory', async () => {
  const f = fixture()
  try {
    const privateDir = join(f.root, 'private'); mkdirSync(privateDir)
    writeFileSync(join(privateDir, 'value.txt'), 'HOST_PRIVATE\n')
    writeFileSync(join(f.repo, 'value.txt'), 'APPROVED_WORKSPACE\n')
    f.git('config', 'core.worktree', privateDir)
    await f.run(['add', 'value.txt'])
    expect((await f.run(['show', ':value.txt'])).toString()).toBe('APPROVED_WORKSPACE\n')
    expect((await f.run(['rev-parse', '--show-toplevel'])).toString().trim()).toBe(f.repo)
    expect(readFileSync(join(privateDir, 'value.txt'), 'utf8')).toBe('HOST_PRIVATE\n')
  } finally { f.close() }
})

test('inactive conditional includes are traversed and cannot hide a future mutable include', async () => {
  const f = fixture()
  try {
    const outside = join(f.root, 'inactive.cfg')
    writeFileSync(outside, '[include]\n path = repo/future.cfg\n')
    f.git('config', 'includeIf.onbranch:future.path', outside)
    await expect(f.run(['status', '--porcelain'])).rejects.toThrow('writable contained')
    expect(existsSync(f.marker)).toBe(false)
  } finally { f.close() }
})

test('callbacks in inactive includes are disabled before a child worktree switches branch', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, '.gitattributes'), '*.txt filter=later\n')
    writeFileSync(join(f.repo, 'value.txt'), 'KEPT\n')
    f.git('add', '--all'); f.git('commit', '-m', 'Base')
    const outside = join(f.root, 'inactive.cfg'), worktree = join(f.root, 'next')
    writeFileSync(outside, `[filter "later"]\n smudge = sh ${quote(f.attack)}\n required = true\n`)
    f.git('config', 'includeIf.onbranch:future.path', outside)
    await pilotGitCommand({ repo: f.repo, cwd: f.repo, args: ['worktree', 'add', '-b', 'future', worktree], writableRoots: [f.repo, worktree] })
    expect(existsSync(f.marker)).toBe(false)
    expect(readFileSync(join(worktree, 'value.txt'), 'utf8')).toBe('KEPT\n')
  } finally { f.close() }
})

test('actual Git SSH invocation uses the fixed wrapper, drops unrelated environment and cleans private profile copies', async () => {
  const f = fixture()
  try {
    const home = join(f.root, 'home'), bin = join(f.root, 'bin'), args = join(f.root, 'ssh-args')
    mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 }); mkdirSync(bin)
    writeFileSync(join(home, '.ssh/config'), 'Host proof\n HostName repo.example.com\n User git\n', { mode: 0o600 })
    writeFileSync(join(bin, 'ssh'), `#!/bin/sh\n[ -z "\${SYNTHETIC_PARENT_FLAG:-}" ] || exit 89\nprintf '%s\\n' "$@" > ${quote(args)}\nexit 17\n`, { mode: 0o700 })
    f.git('remote', 'add', 'origin', 'proof:repo.git')
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../helper/core-pilot-git.ts')], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, SSH_AUTH_SOCK: '', SYNTHETIC_PARENT_FLAG: 'MUST_NOT_REACH_SSH' },
      stdin: Buffer.from(JSON.stringify({ repo: f.repo, cwd: f.repo, args: ['ls-remote', 'origin'], writableRoots: [f.repo] })), stdout: 'pipe', stderr: 'pipe',
    })
    const [_, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(code).not.toBe(0)
    expect(existsSync(args), err).toBe(true)
    const lines = readFileSync(args, 'utf8').trim().split('\n')
    expect(lines[0]).toBe('-F'); expect(existsSync(lines[1])).toBe(false)
    expect(lines).toContain('proof'); expect(lines.at(-1)).toBe("git-upload-pack 'repo.git'")
  } finally { f.close() }
})
