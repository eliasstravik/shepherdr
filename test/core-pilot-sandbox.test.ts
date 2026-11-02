import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, linkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pilotPublicAddress, pilotProviderConfig, pilotProjectFiles, pilotSandboxArgs, pilotGitPaths } from '../helper/core-pilot-sandbox.ts'

test('HTTPS destinations reject private, loopback, mapped, documentation and special-use addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.17.0.1', '100.100.100.100', '192.0.2.1', '192.168.1.1', '198.18.1.1', '198.51.100.1', '203.0.113.1', '224.1.2.3', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1%lo', '2001:db8::1', '2001::1', '2002:7f00:1::', '3fff::1', 'bad']) expect(pilotPublicAddress(ip)).toBe(false)
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(pilotPublicAddress(ip)).toBe(true)
})
test('provider configuration keeps selected login endpoints but strips execution hooks, plugins and other providers', () => {
  const claude = JSON.parse(pilotProviderConfig('claude', JSON.stringify({ hooks: { SessionStart: 'outside' }, mcpServers: { outside: {} }, env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', NODE_OPTIONS: '--require /host/execute', ANTHROPIC_OTHER: 'ignored' } })))
  expect(claude).toEqual({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } })
  const codex = Bun.TOML.parse(pilotProviderConfig('codex', 'model_provider="chosen"\nnotify=["outside"]\n[mcp_servers.outside]\ncommand="outside"\n[model_providers.chosen]\nname="Chosen"\nbase_url="https://api.openai.com"\ncredential_helper="outside"\n[model_providers.other]\nbase_url="https://other.invalid"')) as Record<string, unknown>
  expect(codex.notify).toBeUndefined(); expect(codex.mcp_servers).toBeUndefined()
  expect(codex.model_providers).toEqual({ chosen: { name: 'Chosen', base_url: 'https://api.openai.com' } })
})
test('read-only project sockets are masked and writable hardlinks are refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-files-')), socket = join(root, 'host.sock')
  const server = createServer()
  try {
    await new Promise<void>(resolve => server.listen(socket, resolve))
    expect(pilotProjectFiles([{ path: root, writable: false }])).toEqual([socket])
    writeFileSync(join(root, 'a'), 'host file'); linkSync(join(root, 'a'), join(root, 'b'))
    expect(() => pilotProjectFiles([{ path: root, writable: true }])).toThrow('hardlinks')
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }) }
})
test('sandbox arguments keep core credentials out and reject overlapping private mounts', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-args-'))
  try {
    for (const name of ['repo', 'task', 'state', 'control', 'secret', 'native']) mkdirSync(join(root, name), { mode: 0o700 })
    for (const name of ['codex', 'codex-code-mode-host']) writeFileSync(join(root, 'native', name), 'native fixture')
    for (const name of ['worktrees/task', 'objects', 'refs']) mkdirSync(join(root, 'repo/.git', name), { recursive: true })
    writeFileSync(join(root, 'task/.git'), 'gitdir: ../repo/.git/worktrees/task\n')
    writeFileSync(join(root, 'repo/.git/worktrees/task/commondir'), '../..\n')
    writeFileSync(join(root, 'repo/.git/worktrees/task/gitdir'), join(root, 'task/.git') + '\n')
    const input = { repo: join(root, 'repo'), cwd: join(root, 'task'), home: '/home/isolated', state: join(root, 'state'), control: join(root, 'control'), binary: join(root, 'native/codex'), bun: process.execPath, kind: 'codex' as const, writable: true, privateRoots: [join(root, 'secret')] }
    const args = pilotSandboxArgs(input)
    expect(args).toContain('--unshare-all'); expect(args).toContain('--clearenv'); expect(args).toContain('--new-session')
    expect(args).not.toContain(join(root, 'secret')); expect(args).not.toContain('HC_SOCKET'); expect(args).not.toContain('SHEPHERDR_CORE_CREDENTIAL')
    expect(args).toContain(join(root, 'native/codex-code-mode-host')); expect(args).toContain('/run/shepherdr/codex-code-mode-host')
    expect(() => pilotSandboxArgs({ ...input, privateRoots: [input.repo] })).toThrow('protected')
    expect(() => pilotSandboxArgs({ ...input, cwd: input.repo })).toThrow('own worktree')
    expect(() => pilotSandboxArgs({ ...input, privateRoots: [join(root, 'repo/.git')] })).toThrow('protected')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('hostile Git pointers cannot mount arbitrary host directories or another repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-git-')), repo = join(root, 'repo'), cwd = join(root, 'task')
  try {
    mkdirSync(repo); mkdirSync(cwd)
    for (const name of ['objects', 'refs', 'worktrees/task']) mkdirSync(join(repo, '.git', name), { recursive: true })
    writeFileSync(join(cwd, '.git'), 'gitdir: /etc\n')
    expect(() => pilotGitPaths(repo, cwd)).toThrow()
    const dir = join(repo, '.git/worktrees/task')
    writeFileSync(join(cwd, '.git'), `gitdir: ${dir}\n`)
    writeFileSync(join(dir, 'commondir'), '/etc\n')
    writeFileSync(join(dir, 'gitdir'), join(cwd, '.git') + '\n')
    expect(() => pilotGitPaths(repo, cwd)).toThrow('pointers')
    writeFileSync(join(dir, 'commondir'), '../..\n')
    writeFileSync(join(dir, 'gitdir'), '/unrelated/.git\n')
    expect(() => pilotGitPaths(repo, cwd)).toThrow('pointers')
    writeFileSync(join(dir, 'gitdir'), join(cwd, '.git') + '\n')
    expect(pilotGitPaths(repo, cwd)).toContain(join(repo, '.git'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
