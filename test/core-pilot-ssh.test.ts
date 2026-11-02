import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pilotSshArgs, pilotSshWords, preparePilotSsh } from '../helper/core-pilot-ssh.ts'
import { pilotConfigPath } from '../helper/core-pilot-path.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'shep-ssh-'))
  try { await work(setup(root)) } finally { rmSync(root, { recursive: true, force: true }) }
}
function setup(root: string) {
  const home = join(root, 'home'), workspace = join(root, 'workspace'), system = join(root, 'system.conf')
  mkdirSync(join(home, '.ssh/parts'), { recursive: true, mode: 0o700 }); mkdirSync(workspace)
  writeFileSync(system, 'Host *\n SendEnv LANG LC_*\n ServerAliveInterval 20\n', { mode: 0o600 })
  const user = join(home, '.ssh/config'), marker = join(root, 'executed')
  const validate = (path: string) => { const real = pilotConfigPath(path); if ([path, real].some(value => value === workspace || value.startsWith(workspace + '/'))) throw Error('mutable SSH configuration') }
  const prepare = () => preparePilotSsh({ home, cwd: workspace, ssh: Bun.which('ssh')!, validate, systemConfig: system, parent: root })
  return { root, home, workspace, system, user, marker, prepare }
}
test('SSH tokenization and Git service argv reject shell expansion and non-Git host commands', () => {
  expect(pilotSshWords('IdentityFile = "~/.ssh/key file" # note')).toEqual(['IdentityFile', '=', '~/.ssh/key file'])
  expect(pilotSshArgs(['-G', 'git@repo.example.com'])).toMatchObject({ probe: true })
  expect(pilotSshArgs(['-o', 'SendEnv=GIT_PROTOCOL', '-p', '2222', 'git@repo.example.com', "git-upload-pack 'repo.git'"])).toEqual({ probe: false, args: ['-p', '2222', 'git@repo.example.com', "git-upload-pack 'repo.git'"] })
  expect(pilotSshArgs(['git@repo.example.com', "git-receive-pack 'a'\\''b'"]).args.at(-1)).toBe(`git-receive-pack 'a'"'"'b'`)
  for (const args of [
    ['git@repo$(touch_marker)', "git-upload-pack 'repo'"],
    ['-o', 'ProxyCommand=touch_marker', 'git@repo', "git-upload-pack 'repo'"],
    ['git@repo', "git-upload-pack 'repo'; touch marker"],
    ['git@repo', "git-upload-pack '-option'"],
    ['git@repo', 'sh -c touch_marker'],
    ['git@repo', "git-upload-pack 'one' 'two'"],
  ]) expect(() => pilotSshArgs(args)).toThrow()
})
test('copied Include scopes and aliases retain native OpenSSH resolution without running callbacks', () => fixture(async f => {
  writeFileSync(join(f.home, '.ssh/parts/inactive.conf'), 'Host *\n HostName wrong.example.com\n', { mode: 0o600 })
  writeFileSync(f.user, `Host excluded\n Include parts/*.conf\nHost repo-alias\n HostName = repo.example.com\n User git\n Port 2222\n IdentityFile "~/.ssh/key file"\n ProxyJump operator@jump\nHost jump\n HostName bastion.example.com\n`, { mode: 0o600 })
  const prepared = await f.prepare()
  try {
    const profile = JSON.parse(readFileSync(prepared.profile, 'utf8'))
    // Actual native parser, no network/server or key authentication.
    const child = Bun.spawn([Bun.which('ssh')!, '-G', '-F', profile.config, 'repo-alias'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(code, err).toBe(0)
    expect(out).toContain('hostname repo.example.com\n')
    expect(out).toContain('user git\n'); expect(out).toContain('port 2222\n')
    expect(out).toContain(`identityfile ${join(f.home, '.ssh/key file')}\n`)
    expect(out).toContain('proxyjump operator@jump\n')
    expect(out).not.toContain('sendenv LANG')
  } finally { prepared.close() }
  expect(existsSync(prepared.profile)).toBe(false)
}))
test('all include branches are checked before native parsing and writable account paths are refused', () => fixture(async f => {
  const unsafe = [
    `Match exec "touch ${f.marker}"\n User git\n`,
    `Host *\n ProxyCommand touch ${f.marker}\n`,
    `Host *\n KnownHostsCommand touch ${f.marker}\n`,
    `Host *\n LocalCommand touch ${f.marker}\n`,
    `Host *\n PKCS11Provider ${join(f.workspace, 'provider.so')}\n`,
  ]
  for (const content of unsafe) {
    writeFileSync(join(f.home, '.ssh/parts/unsafe.conf'), content, { mode: 0o600 })
    writeFileSync(f.user, 'Host never-used\n Include parts/*.conf\n', { mode: 0o600 })
    await expect(f.prepare()).rejects.toThrow()
    expect(existsSync(f.marker)).toBe(false)
  }
  writeFileSync(f.user, `Host *\n IdentityFile ${join(f.workspace, 'key')}\n`, { mode: 0o600 })
  await expect(f.prepare()).rejects.toThrow('mutable')
  writeFileSync(f.user, `Include ${join(f.workspace, 'missing.conf')}\n`, { mode: 0o600 })
  await expect(f.prepare()).rejects.toThrow('mutable')
}))
