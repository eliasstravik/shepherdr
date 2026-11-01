import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CoreClient } from './client.ts'
import { coreConfig, coreEnvironment, type CoreConfig } from './config.ts'
import { inspectHome, prepareHome } from './home.ts'

export interface RunRecord { pid: number; boot: string; home: string; port: number; root: string; operator?: string }
export interface Health { product: 'shepherdr-core'; boot: string; pid: number; core: boolean }

export function runRecord(home: string): RunRecord | undefined {
  try { return JSON.parse(readFileSync(join(home, 'run.json'), 'utf8')) as RunRecord } catch { return undefined }
}
async function health(record: RunRecord): Promise<Health | undefined> {
  if (!Number.isInteger(record.port) || record.port < 1024 || record.port > 65535) return
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/api/health`, { signal: AbortSignal.timeout(700) })
    const body = await response.json() as Health
    if (response.ok && body.product === 'shepherdr-core' && body.boot === record.boot && body.pid === record.pid) return body
  } catch { /* stopped, starting, or a different port owner */ }
}
function alive(pid: number) { try { process.kill(pid, 0); return true } catch { return false } }

/** Discover existing private mappings only. Startup never changes Tailscale configuration. */
export function privateUrls(port: number): string[] {
  try {
    const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 2000 })
    const serve = spawnSync('tailscale', ['serve', 'status', '--json'], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 })
    if (status.status !== 0 || serve.status !== 0) return []
    const dns = (JSON.parse(status.stdout).Self.DNSName as string).replace(/\.$/, '')
    const config = JSON.parse(serve.stdout) as { Web?: Record<string, { Handlers: Record<string, { Proxy?: string }> }>; AllowFunnel?: Record<string, boolean> }
    const urls: string[] = []
    for (const [host, web] of Object.entries(config.Web ?? {})) {
      if (host.split(':')[0] !== dns || config.AllowFunnel?.[host]) continue
      for (const [path, handler] of Object.entries(web.Handlers)) {
        if (handler.Proxy === `http://127.0.0.1:${port}`) urls.push(`https://${host.replace(/:443$/, '')}${path.endsWith('/') ? path : path + '/'}`)
      }
    }
    return urls
  } catch { return [] }
}

export async function launcherStatus(config: CoreConfig, observed?: { record: RunRecord; current: Health }) {
  const kind = inspectHome(config.home)
  if (kind === 'legacy') return 'Legacy 2.0 state is present. The core application has not started here; use an isolated preview home until cutover.'
  const record = observed?.record ?? runRecord(config.home)
  const current = observed?.current ?? (record && await health(record))
  if (!current || !record) return record && alive(record.pid) ? `Shepherdr’s recorded process is alive (PID ${record.pid}), but its status is not confirmed yet. It has not been signaled; check status again shortly.` : 'Shepherdr is stopped.'
  const urls = privateUrls(record.port)
  return `Shepherdr is running (PID ${record.pid}). Core ${current.core ? 'connected' : 'reconnecting'}.\n${urls.length ? urls.map(url => `Private URL: ${url}`).join('\n') : 'No private Tailscale Serve mapping points to this port. Configure one before opening from another device.'}`
}

async function withLock<T>(home: string, work: () => Promise<T>) {
  const lock = join(home, 'lifecycle.lock')
  const token = `${process.pid}:${randomUUID()}`
  for (let attempt = 0; ; attempt++) {
    try { mkdirSync(lock, { mode: 0o700 }); writeFileSync(join(lock, 'owner'), token, { mode: 0o600 }); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner = 0
      try { owner = Number(readFileSync(join(lock, 'owner'), 'utf8').split(':')[0]) } catch { /* another start is writing */ }
      if ((!owner || !alive(owner)) && Date.now() - statSync(lock).mtimeMs > 30_000) { rmSync(lock, { recursive: true }); continue }
      if (attempt >= 100) throw new Error('Another start or stop is still in progress; check status')
      await Bun.sleep(100)
    }
  }
  try { return await work() }
  finally {
    try { if (readFileSync(join(lock, 'owner'), 'utf8') === token) rmSync(lock, { recursive: true }) } catch { /* already removed */ }
  }
}

async function ensureCore(config: CoreConfig) {
  const result = spawnSync(config.binary, ['server', 'start'], { env: coreEnvironment(config), encoding: 'utf8', timeout: 15_000 })
  if (result.status !== 0) throw new Error(`Core did not start: ${result.error?.message || result.stderr.trim() || 'install herdr-core (hc) first'}`)
  const core = await CoreClient.open(config.socket)
  core.close()
}

/** Without the built page every visit is an error, while start would still say it runs. A Vite preview serves its own. */
export function buildProblem(config: Pick<CoreConfig, 'plugins'>, root = join(import.meta.dir, '../..')) {
  if (config.plugins === false || existsSync(join(root, 'dist/index.html'))) return
  return `Shepherdr is not built, so its page cannot open. Nothing was started. Run bun run build in ${root}, then start again.`
}

async function start(config: CoreConfig, foreground: boolean) {
  prepareHome(config.home)
  await withLock(config.home, async () => {
    const record = runRecord(config.home)
    const confirmed = record && await health(record)
    if (record && confirmed) { console.log(await launcherStatus(config, { record, current: confirmed })); return }
    if (record && alive(record.pid)) throw new Error('The recorded process is alive but its identity cannot be verified. No process was stopped; inspect it before restarting.')
    const problem = buildProblem(config)
    if (problem) throw new Error(problem)
    await ensureCore(config)
    const boot = randomUUID()
    const args = ['--home', config.home, '--port', String(config.port), '--core-bin', config.binary, '--core-session', config.session, '--core-socket', config.socket]
    if (config.plugins === false) args.push('--no-plugin-updates')
    if (foreground) {
      // Server starts before releasing the lifecycle lock; no second start can race its bind.
      const { runCoreServer } = await import('./main.ts')
      await runCoreServer(config, boot)
      return
    }
    const log = openSync(join(config.home, 'server.log'), 'a', 0o600)
    const child = spawn(process.execPath, [join(import.meta.dir, 'main.ts'), ...args], {
      detached: true, stdio: ['ignore', log, log], env: { ...coreEnvironment(config), ...(process.env.ELEVENLABS_API_KEY ? { ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY } : {}), SHEPHERDR_BOOT_ID: boot },
    })
    closeSync(log)
    let failed: Error | undefined
    child.on('error', error => { failed = error })
    child.unref()
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failed || child.exitCode !== null) throw new Error(`Shepherdr did not start; see the private server log. ${failed?.message ?? ''}`)
      const current = runRecord(config.home)
      const confirmed = current?.boot === boot && await health(current)
      if (current && confirmed) { console.log(await launcherStatus(config, { record: current, current: confirmed })); return }
      await Bun.sleep(100)
    }
    throw new Error('Shepherdr has not answered yet. Check status and its private server log before starting again.')
  })
}

async function stop(config: CoreConfig) {
  const kind = inspectHome(config.home)
  if (typeof kind !== 'object') { console.log(await launcherStatus(config)); return }
  await withLock(config.home, async () => {
    const record = runRecord(config.home)
    if (!record || !await health(record)) {
      if (record && alive(record.pid)) throw new Error('The recorded process cannot be verified; it has not been signaled')
      console.log('Shepherdr is stopped.'); return
    }
    process.kill(record.pid, 'SIGTERM')
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!alive(record.pid)) { console.log('Shepherdr stopped. Core and agents keep running.'); return }
      await Bun.sleep(100)
    }
    throw new Error('Shepherdr is finishing work before stopping. No agent was stopped; check status shortly.')
  })
}

if (import.meta.main) {
  try {
    const [verb, ...args] = process.argv.slice(2)
    const config = coreConfig(args)
    if (verb === 'start') await start(config, args.includes('--foreground'))
    else if (verb === 'stop') await stop(config)
    else if (verb === 'status') console.log(await launcherStatus(config))
    else throw new Error('Use shepherdr start, stop, or status')
  } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}
