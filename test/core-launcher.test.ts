import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareHome } from '../server/core/home.ts'
import { coreConfig } from '../server/core/config.ts'
import { buildProblem, launcherStatus, newHomeProblem } from '../server/core/launcher.ts'

test('a live unconfirmed process never reports stopped or gets signaled', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-launcher-'))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('not ready', { status: 503 }) })
  try {
    prepareHome(home)
    writeFileSync(join(home, 'run.json'), JSON.stringify({ pid: process.pid, boot: 'starting', home, port: server.port, root: '/unused' }), { mode: 0o600 })
    const text = await launcherStatus({ home, port: server.port!, binary: 'hc', session: 'test', socket: '/unused' })
    expect(text).toContain('process is alive')
    expect(text).not.toContain('is stopped')
    expect(text).toContain('not confirmed yet')
    expect(() => process.kill(process.pid, 0)).not.toThrow()
  } finally { server.stop(true); rmSync(home, { recursive: true, force: true }) }
})

test('start refuses an unbuilt application and names the step; a Vite preview serves its own page', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-launcher-build-'))
  try {
    expect(buildProblem({}, root)).toContain(`bun run build in ${root}`)
    expect(buildProblem({ plugins: false }, root)).toBeUndefined()
    mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist/index.html'), '<!doctype html>')
    expect(buildProblem({}, root)).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a new home never takes on its core\'s machines unless its start names that core', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-launcher-machines-'))
  const machines = async () => [{ name: 'mac-mini' }, { name: 'vps' }]
  const inherited = process.env.HC_SESSION
  process.env.HC_SESSION = 'default' // what any hc terminal hands down: never a choice
  try {
    const home = join(root, 'trial')
    const config = coreConfig(['--home', home, '--port', '17941'])
    expect(config.chosenCore).toBe(false)
    const refused = await newHomeProblem(config, machines)
    expect(refused).toContain('2 machines (mac-mini, vps)')
    expect(refused).toContain('Nothing was started')
    expect(refused).toContain('--core-session default')
    expect(existsSync(home)).toBe(false)

    mkdirSync(home)
    expect(await newHomeProblem(config, machines)).toContain('already has 2 machines')
    expect(await newHomeProblem(config, async () => [])).toBeUndefined()

    const unasked = async () => { throw new Error('must not ask core') }
    expect(await newHomeProblem(coreConfig(['--home', home, '--core-session', 'trial']), unasked)).toBeUndefined()
    expect(await newHomeProblem(coreConfig(['--home', home, '--core-session', 'default']), unasked)).toBeUndefined()
    expect(await newHomeProblem(coreConfig(['--home', home, '--core-socket', join(root, 'core.sock')]), unasked)).toBeUndefined()

    prepareHome(home)
    expect(await newHomeProblem(config, unasked)).toBeUndefined()
  } finally {
    if (inherited === undefined) delete process.env.HC_SESSION
    else process.env.HC_SESSION = inherited
    rmSync(root, { recursive: true, force: true })
  }
})
