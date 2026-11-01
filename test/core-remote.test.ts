import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreRemotes } from '../server/core/remote.ts'
import type { CoreFiles } from '../server/core/files.ts'

/** Fake core transport, real private-file writer on CI. Never uses SSH or installed agent state. */
for (const core of ['0.1.14', '0.1.16']) test(`remote helpers on core ${core} are immutable private files and launch credentials cannot follow symlinks`, async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-remote-'))
  const files = { exec: async (_machine: string, argv: string[], _cwd?: string, input?: Uint8Array) => {
    if (argv[0] === 'rm') { const result = Bun.spawnSync(argv); if(result.exitCode) throw Error(result.stderr.toString()); return result.stdout }
    if (argv[0] === 'sh') return Buffer.from(process.execPath)
    if (argv[2].startsWith("const o=require")) return Buffer.from(JSON.stringify({ home, bun: process.execPath, hc: '/core/hc', path: '/core', version: `hc ${core}`, session: 'isolated', environment: { XDG_RUNTIME_DIR: '/private/runtime', XDG_STATE_HOME: '/private/state', XDG_CONFIG_HOME: null }, platform: process.platform, arch: process.arch, musl: false }))
    if (argv[2].startsWith('const {CoreClient}')) return Buffer.from('identity verified')
    const result = Bun.spawnSync(argv, { stdin: input ?? 'ignore' })
    if (result.exitCode) throw new Error(result.stderr.toString())
    return result.stdout
  } } as unknown as CoreFiles
  const remotes = new CoreRemotes(files, 'installation', () => ({ version: core }))
  try {
    const runtime = await remotes.prepare('machine')
    expect(runtime.endpoint).toEqual({ binary: '/core/hc', session: 'isolated', socket: undefined, environment: { XDG_RUNTIME_DIR: '/private/runtime', XDG_STATE_HOME: '/private/state', XDG_CONFIG_HOME: null } })
    expect(statSync(runtime.root).mode & 0o077).toBe(0)
    expect(statSync(join(runtime.root, 'bin/shepherdr')).mode & 0o777).toBe(0o700)
    expect((await remotes.prepare('machine')).root).toBe(runtime.root)
    expect(readFileSync(runtime.browser, 'utf8')).toContain('vendor/agent-browser/bin/')
    const version = Bun.spawnSync([runtime.browser, '--version'])
    expect(version.exitCode).toBe(0)
    expect(version.stdout.toString()).toContain('0.39.4')
    const credential = join(runtime.root, 'sessions/one.credential')
    await remotes.privateFile('machine', runtime, credential, 'private test token')
    expect(statSync(credential).mode & 0o777).toBe(0o600)
    const link = join(runtime.root, 'sessions/link.credential')
    symlinkSync(credential, link)
    await expect(remotes.privateFile('machine', runtime, link, 'overwrite')).rejects.toThrow()
    expect(readFileSync(credential, 'utf8')).toBe('private test token')
    await expect(remotes.privateFile('machine', runtime, join(home, 'outside'), 'no')).rejects.toThrow('outside')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a machine on a core older than the minimum is refused before anything is installed', async () => {
  const files = { exec: async (_machine: string, argv: string[]) => {
    if (argv[0] === 'sh') return Buffer.from(process.execPath)
    if (argv[2].startsWith("const o=require")) return Buffer.from(JSON.stringify({ version: 'hc 0.1.13' }))
    throw new Error(`Nothing else may run: ${argv[0]}`)
  } } as unknown as CoreFiles
  await expect(new CoreRemotes(files, 'installation', () => ({ version: '0.1.13' })).prepare('machine')).rejects.toThrow('must run core 0.1.14 or newer; no binary or service was changed')
  await expect(new CoreRemotes(files, 'installation', () => ({})).prepare('machine')).rejects.toThrow('must run core 0.1.14 or newer')
  await expect(new CoreRemotes(files, 'installation', () => ({ version: '0.1.16' })).prepare('machine')).rejects.toThrow('Remote hc must be 0.1.14 or newer; nothing was installed')
})
