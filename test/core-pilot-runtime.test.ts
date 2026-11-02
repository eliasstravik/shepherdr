import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { preparePilotHome } from '../helper/core-pilot-home.ts'
import { runPilotRuntime } from '../helper/core-pilot-runtime.ts'
import type { PilotProxyBackend } from '../helper/core-pilot-proxy.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-runtime-')), parent = join(root, 'sessions'), repo = join(root, 'repo'), provider = join(root, 'provider')
  for (const path of [parent, repo, provider]) mkdirSync(path, { mode: 0o700 })
  for (const part of ['objects', 'refs']) mkdirSync(join(repo, '.git', part), { recursive: true })
  const home = preparePilotHome(parent, provider, join(import.meta.dir, '..'), 'codex', '')
  const backend: PilotProxyBackend = { cli: async () => ({}), secret: async () => ({}), hook: async () => ({}), lease: async () => {}, reserve: async () => {} }
  const bwrap = join(root, 'fake-bwrap'), marker = join(root, 'started')
  const sandbox = { cwd: repo, repo, home: '/home/contained', state: home.state, control: home.control, binary: process.execPath, bun: process.execPath, kind: 'codex' as const, writable: false, privateRoots: [parent] }
  return { root, marker, home, backend, bwrap, sandbox, close() { home.discard(); rmSync(root, { recursive: true, force: true }) } }
}

test('runtime requires confirmed authority before spawn and removes its private gateway on normal exit', async () => {
  const f = fixture()
  try {
    writeFileSync(f.bwrap, `#!/bin/sh\nprintf '%s' "$SHEPHERDR_CORE_CREDENTIAL" > '${f.marker}'\nexit 7\n`, { mode: 0o700 })
    const result = await runPilotRuntime({ ...f, args: ['--', 'prompt'], hosts: [], signal: new AbortController().signal })
    expect(result).toBe(7)
    expect(readFileSync(f.marker, 'utf8')).toBe('')
    expect(existsSync(dirname(f.home.gateway))).toBe(false)
    expect(existsSync(f.home.captures)).toBe(true)
  } finally { f.close() }
})

test('refused initial lease never executes a process or leaves a gateway', async () => {
  const f = fixture()
  try {
    writeFileSync(f.bwrap, `#!/bin/sh\ntouch '${f.marker}'\n`, { mode: 0o700 })
    f.backend.lease = async () => { throw Error('Wrong actor') }
    await expect(runPilotRuntime({ ...f, args: [], hosts: [], signal: new AbortController().signal })).rejects.toThrow('Wrong actor')
    expect(existsSync(f.marker)).toBe(false)
    expect(existsSync(dirname(f.home.gateway))).toBe(false)
  } finally { f.close() }
})

test('the outside runtime deadline terminates its own holder and retains captured history', async () => {
  const f = fixture()
  try {
    writeFileSync(f.bwrap, '#!/bin/sh\nexec sleep 30\n', { mode: 0o700 })
    await expect(runPilotRuntime({ ...f, args: [], hosts: [], deadline: Date.now() + 500, signal: new AbortController().signal })).rejects.toThrow('runtime limit')
    expect(existsSync(dirname(f.home.gateway))).toBe(false)
    expect(existsSync(f.home.captures)).toBe(true)
  } finally { f.close() }
})
