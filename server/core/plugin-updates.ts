import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { pluginCatalog, readOff, readStaged, stageUserPlugins, stagedPlugins, writeRegistries, writeStaged, type PluginEntry } from '../../scripts/build-plugins.ts'
import type { ServerPlugin } from '../plugin-api.ts'
import { CorePlugins } from './plugins.ts'
import type { CoreSource } from './source.ts'

const PARTS = ['assets', 'bin', 'helper', 'plugins', 'public', 'scripts', 'server', 'shared', 'skill', 'src', 'index.html', 'package.json', 'bun.lock', 'bunfig.toml', 'plugins.json', 'tsconfig.json', 'vite.config.ts']
type BuildResult = { ok: boolean; out: string }
export type PluginCompiler = (dir: string, signal?: AbortSignal) => Promise<BuildResult>
type RuntimeFailures = Record<string, { error: string; skipGood: boolean }>

/** Build output is bounded; an extension cannot fill memory or keep a build child forever. */
export async function compilePlugins(dir: string, signal?: AbortSignal): Promise<BuildResult> {
  const deadline = Date.now() + 120_000
  const run = (args: string[]): Promise<BuildResult> => new Promise(resolve => {
    if (signal?.aborted) { resolve({ ok: false, out: 'Plugin build stopped' }); return }
    // This child owns a fresh process group: timeout never signals core or agents.
    const child = spawn(process.execPath, args, { cwd: dir, detached: true, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, SHEPHERDR_HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', bytes = 0, problem = ''
    const kill = () => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    const abort = () => { problem = 'Plugin build stopped'; kill() }
    signal?.addEventListener('abort', abort, { once: true })
    const read = (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 1_048_576) { problem = 'Plugin build output exceeded 1 MiB'; kill(); return }
      out += chunk.toString('utf8')
    }
    child.stdout.on('data', read); child.stderr.on('data', read)
    const timer = setTimeout(() => { problem = 'Plugin build exceeded two minutes'; kill() }, Math.max(1, deadline - Date.now()))
    child.on('error', error => { signal?.removeEventListener('abort', abort); clearTimeout(timer); resolve({ ok: false, out: error.message }) })
    child.on('close', code => { signal?.removeEventListener('abort', abort); clearTimeout(timer); resolve({ ok: code === 0 && !problem, out: problem || out }) })
  })
  const client = await run(['run', 'build'])
  if (!client.ok || !existsSync(join(dir, 'dist/index.html'))) return { ok: false, out: client.out || 'Client build did not produce index.html' }
  // Dynamic server imports must parse/resolve before the last-good runtime is replaced.
  const server = await run(['build', 'generated/server-plugins.ts', '--target', 'bun', '--outdir', '.server-check'])
  rmSync(join(dir, '.server-check'), { recursive: true, force: true })
  return server
}

/** A fixed copy of the started application. Plugin edits never follow a checkout, branch, or git ref. */
export class PluginBuilds {
  readonly base: string
  readonly hash: string
  private root: string
  constructor(readonly home: string, application: string, private compile: PluginCompiler = compilePlugins) {
    this.root = join(home, 'plugin-builds'); mkdirSync(this.root, { recursive: true, mode: 0o700 })
    this.base = join(this.root, `base-${randomUUID()}`); mkdirSync(this.base, { mode: 0o700 })
    for (const part of PARTS) if (existsSync(join(application, part))) cpSync(join(application, part), join(this.base, part), { recursive: true })
    symlinkSync(join(application, 'node_modules'), join(this.base, 'node_modules'), 'dir')
    this.hash = fingerprint(PARTS.map(part => join(this.base, part)))
    this.prune([this.previous()].filter((path): path is string => !!path))
  }
  previous(): string | undefined {
    try {
      const saved = JSON.parse(readFileSync(join(this.root, 'current.json'), 'utf8')) as { hash: string; build: string }
      if (saved.hash === this.hash && /^build-[a-f0-9-]{36}$/.test(saved.build) && existsSync(join(this.root, saved.build, 'dist/index.html'))) return join(this.root, saved.build)
    } catch { /* no compatible last good build */ }
  }
  activate(dir: string, previous?: string) {
    const temporary = join(this.root, `current.${randomUUID()}.tmp`)
    writeFileSync(temporary, JSON.stringify({ hash: this.hash, build: basename(dir) }), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, join(this.root, 'current.json'))
    try { this.prune([dir, previous].filter((path): path is string => !!path)) } catch { /* an old build in use can be retried at the next update */ }
  }
  private prune(keep: string[]) {
    for (const name of readdirSync(this.root)) if (/^(base|build)-[a-f0-9-]{36}$/.test(name)) {
      const path = join(this.root, name)
      if (path !== this.base && !keep.includes(path)) rmSync(path, { recursive: true, force: true })
    }
  }
  async build(last?: string, failures: RuntimeFailures = {}, signal?: AbortSignal): Promise<string> {
    const dir = join(this.root, `build-${randomUUID()}`); mkdirSync(dir, { mode: 0o700 })
    try {
      for (const part of PARTS) if (existsSync(join(this.base, part))) cpSync(join(this.base, part), join(dir, part), { recursive: true })
      symlinkSync(join(this.base, 'node_modules'), join(dir, 'node_modules'), 'dir')
      stageUserPlugins(dir, this.home)
      for (const [name, failure] of Object.entries(failures)) {
        if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Error('Invalid failed plugin name')
        rmSync(join(dir, 'user-plugins', name), { recursive: true, force: true })
        const good = last && join(last, 'user-plugins', name), kept = !failure.skipGood && good && existsSync(good)
        if (kept) cpSync(good, join(dir, 'user-plugins', name), { recursive: true })
        const staged = readStaged(dir)
        writeStaged(dir, { ...staged, broken: { ...staged.broken, [name]: { error: failure.error, ...(kept ? { kept: true } : {}) } } })
      }
      for (let remaining = Math.min(16, stagedPlugins(dir).length * 2 + 2); ; remaining--) {
        if (signal?.aborted) throw Error('Plugin build stopped')
        writeRegistries(dir)
        const result = await this.compile(dir, signal)
        if (signal?.aborted) throw Error('Plugin build stopped')
        if (result.ok) return dir
        const mine = pluginCatalog(dir).filter(item => item.from === 'user' && item.on).map(item => item.name)
        if (!mine.length || remaining <= 0) throw Error(result.out.slice(-4000) || 'Plugin build failed')
        const named = mine.filter(name => result.out.includes(`user-plugins/${name}/`))
        for (const name of named.length ? named : mine) {
          const staged = readStaged(dir), at = join(dir, 'user-plugins', name)
          rmSync(at, { recursive: true, force: true })
          const good = last && join(last, 'user-plugins', name)
          const kept = !staged.broken[name] && good && existsSync(good)
          if (kept) cpSync(good, at, { recursive: true })
          writeStaged(dir, { ...staged, broken: { ...staged.broken, [name]: { error: staged.broken[name]?.error || result.out.slice(-2000).replaceAll(dir, '<build>'), ...(kept ? { kept: true } : {}) } } })
        }
      }
    } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error }
  }
}

/** Fingerprint local trusted plugin sources, with explicit depth/count/size limits. */
function fingerprint(paths: string[]): string {
  const hash = createHash('sha256'); let files = 0, bytes = 0
  const walk = (path: string, depth: number) => {
    if (!existsSync(path)) return
    if (depth > 20 || ++files > 10_000) throw Error('Plugin folder exceeds 10,000 entries or 20 levels')
    const stat = statSync(path)
    if (stat.isDirectory()) { for (const name of readdirSync(path).sort()) if (!['.git', 'node_modules'].includes(name)) { hash.update(JSON.stringify([depth, name])); walk(join(path, name), depth + 1) } }
    else if (stat.isFile()) { bytes += stat.size; if (bytes > 32 * 1024 * 1024) throw Error('Plugin sources exceed 32 MiB'); hash.update(`${stat.size}:`); hash.update(readFileSync(path)) }
  }
  for (const path of paths) { hash.update(basename(path)); walk(path, 0) }
  return hash.digest('hex')
}
export const pluginFingerprint = (home: string) => fingerprint([join(home, 'plugins'), join(home, 'plugins.json')])

export class CorePluginUpdates {
  private builds?: PluginBuilds
  private timer?: ReturnType<typeof setInterval>
  private busy?: Promise<void>
  private stopped = false
  private fingerprint = ''
  private current?: string
  private preparing?: CorePlugins
  private controller = new AbortController()
  private error?: string
  readonly assets: { dist: string }
  constructor(private source: CoreSource, private application: string, private compile: PluginCompiler = compilePlugins) { this.assets = { dist: join(application, 'dist') } }
  start() {
    try {
      mkdirSync(join(this.source.config.home, 'plugins'), { recursive: true, mode: 0o700 })
      this.builds = new PluginBuilds(this.source.config.home, this.application, this.compile)
      this.current = this.builds.previous()
      // Own plugins or switches must be incorporated on startup too. Empty installations need no rebuild.
      this.fingerprint = pluginFingerprint(this.source.config.home)
      if (readdirSync(join(this.source.config.home, 'plugins')).length || readOff(this.source.config.home).length) this.request()
    } catch (error) { this.error = (error as Error).message }
    this.timer = setInterval(() => this.scan(), 2000)
  }
  scan() {
    if (this.stopped) return
    try { const next = pluginFingerprint(this.source.config.home); if (next !== this.fingerprint) { this.fingerprint = next; this.request() } }
    catch (error) { this.error = (error as Error).message; this.source.emit('snapshot') }
  }
  set(name: string, on: boolean) {
    if (this.stopped) throw Error('Plugin updates are stopping')
    if (!this.builds) throw Error(this.error || 'Plugin builder is unavailable')
    if (!this.source.plugins.entries().some(item => item.name === name)) throw Error('No such plugin')
    const home = this.source.config.home, off = readOff(home).filter(item => item !== name)
    const temporary = join(home, `plugins.${randomUUID()}.tmp`)
    writeFileSync(temporary, JSON.stringify({ off: on ? off : [...off, name] }), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, join(home, 'plugins.json'))
    this.fingerprint = pluginFingerprint(home); this.request()
  }
  private again = false
  private request() {
    if (this.stopped || !this.builds) return
    if (this.busy) { this.again = true; return }
    this.busy = this.update().finally(() => { this.busy = undefined; this.source.emit('snapshot'); if (this.again) { this.again = false; this.request() } })
  }
  private async update() {
    let next: CorePlugins | undefined
    let published = false
    try {
      const failures: RuntimeFailures = {}
      for (let attempt = 0; attempt < 8; attempt++) {
        const dir = await this.builds!.build(this.current, failures, this.controller.signal)
        if (this.stopped) return
        const registry = await import(pathToFileURL(join(dir, 'generated/server-plugins.ts')).href) as { default: ServerPlugin[]; catalog: PluginEntry[]; user: [string, () => Promise<{ default: ServerPlugin }>][] }
        next = new CorePlugins(this.source, true)
        this.preparing = next
        await next.start(registry.catalog, [...registry.default.map(plugin => [plugin.name, async () => plugin] as [string, () => Promise<ServerPlugin>]), ...registry.user.map(([name, load]) => [name, async () => (await load()).default] as [string, () => Promise<ServerPlugin>])])
        if (this.stopped) { next.stop(); return }
        const errors = Object.entries(next.errors())
        if (errors.length) {
          next.stop()
          for (const [name, error] of errors) {
            if (registry.catalog.find(item => item.name === name)?.from !== 'user' || failures[name]?.skipGood) throw Error(`Plugin ${name}: ${error}`)
            failures[name] = { error, skipGood: !!failures[name] }
          }
          rmSync(dir, { recursive: true, force: true })
          continue
        }
        next.activate() // Validates/commits staged setup state before replacing the working runtime.
        this.source.plugins.stop(); this.source.plugins = next
        published = true
        if (!next.has('voice')) this.source.voices.stop()
        const previous = this.current
        this.current = dir; this.assets.dist = join(dir, 'dist'); this.error = undefined
        try { this.builds!.activate(dir, previous) } catch { this.error = 'The plugin is running, but its last-good build could not be saved for restart.' }
        this.source.emit('snapshot')
        return
      }
      throw Error('Too many plugin startup failures; the previous build is still running')
    } catch (error) { this.error = (error as Error).message; this.source.emit('snapshot') }
    finally { this.preparing = undefined; if (!published) next?.stop() }
  }
  status() { return { updating: !!this.busy, error: this.error, off: readOff(this.source.config.home) } }
  stop() { this.stopped = true; clearInterval(this.timer); this.preparing?.stop(); this.controller.abort() }
  async drain() { while (this.busy) await this.busy }
}
