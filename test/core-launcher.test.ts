import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareHome } from '../server/core/home.ts'
import { coreConfig } from '../server/core/config.ts'
import { buildProblem, claimHome, coreMachines, coreProblem, launcherStatus, saveCore } from '../server/core/launcher.ts'

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
  const inherited = process.env.HC_SESSION, socket = process.env.HC_SOCKET
  process.env.HC_SESSION = 'default' // what any hc terminal hands down: never a choice
  delete process.env.HC_SOCKET
  try {
    const home = join(root, 'trial')
    const config = coreConfig(['--home', home, '--port', '17941'])
    expect(config.chosenCore).toBe(false)
    const refused = await coreProblem(config, machines)
    expect(refused).toContain('2 machines (mac-mini, vps)')
    expect(refused).toContain('Nothing was started')
    expect(refused).toContain('--core-session default')
    expect(existsSync(home)).toBe(false)

    mkdirSync(home, { mode: 0o700 })
    expect(await coreProblem(config, machines)).toContain('already has 2 machines')
    expect(await coreProblem(config, async () => [])).toBeUndefined()

    const unasked = async () => { throw new Error('must not ask core') }
    expect(await coreProblem(coreConfig(['--home', home, '--core-session', 'trial']), unasked)).toBeUndefined()
    expect(await coreProblem(coreConfig(['--home', home, '--core-session', 'default']), unasked)).toBeUndefined()
    expect(await coreProblem(coreConfig(['--home', home, '--core-socket', join(root, 'core.sock')]), unasked)).toBeUndefined()

    prepareHome(home)
    expect(await coreProblem(config, unasked)).toBeUndefined()

    // A trial on its own core stays there: a later start with fewer words never lands on the shared one.
    const trial = coreConfig(['--home', home, '--core-session', 'trial'])
    saveCore(trial)
    const restart = await coreProblem(config, unasked)
    expect(restart).toContain('runs on core session trial at')
    expect(restart).toContain(`--core-session trial --core-socket ${trial.socket}`)
    expect(await coreProblem(trial, unasked)).toBeUndefined()

    // Held to the session and the socket: either alone can be a different core with its own machines.
    saveCore(config)
    expect(await coreProblem({ ...config, socket: join(root, 'moved.sock') }, unasked)).toContain('Nothing was started')
    expect(await coreProblem({ ...config, session: 'other' }, unasked)).toContain('Nothing was started')

    // An inherited socket never overrides a named session; only --core-socket does.
    process.env.HC_SOCKET = join(root, 'shared.sock')
    expect(coreConfig(['--home', home]).socket).toBe(join(root, 'shared.sock'))
    expect(coreConfig(['--home', home, '--core-session', 'trial']).socket).not.toBe(join(root, 'shared.sock'))
    expect(coreConfig(['--home', home, '--core-session', 'trial', '--core-socket', join(root, 'mine.sock')]).socket).toBe(join(root, 'mine.sock'))
    delete process.env.HC_SOCKET

    // A first start that fails after making the home still leaves its core: the retry is not a home from before the record.
    const failed = coreConfig(['--home', join(root, 'failed'), '--core-session', 'trial'])
    claimHome(failed)
    expect(await coreProblem({ ...failed, chosenCore: false, session: 'default' }, unasked)).toContain('Nothing was started')
    claimHome(failed)
    saveCore({ ...failed, session: 'later' })
    claimHome(failed)
    expect(await coreProblem({ ...failed, chosenCore: false, session: 'later' }, unasked)).toBeUndefined()
  } finally {
    if (inherited === undefined) delete process.env.HC_SESSION
    else process.env.HC_SESSION = inherited
    if (socket === undefined) delete process.env.HC_SOCKET
    else process.env.HC_SOCKET = socket
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stopped core is never started just to learn its machines', async () => {
  const root = mkdtempSync('/tmp/shep-launcher-stopped-') // A Mac's temporary folder would pass the core socket's length limit.
  const state = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = root
  try {
    const config = coreConfig(['--home', join(root, 'trial'), '--core-bin', join(root, 'no-such-hc'), '--no-plugin-updates'])
    const saved = join(root, 'herdr-core', config.session)
    mkdirSync(saved, { recursive: true })
    writeFileSync(join(saved, 'machines.json'), JSON.stringify([{ name: 'mac-mini' }]))
    expect(await coreProblem(config, () => coreMachines(config))).toContain('a machine (mac-mini)')

    // No saved machines: ask core, which may be running on state this start cannot see.
    writeFileSync(join(saved, 'machines.json'), '[]')
    await expect(coreMachines(config)).rejects.toThrow('Core did not start')
  } finally {
    if (state === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = state
    rmSync(root, { recursive: true, force: true })
  }
})
