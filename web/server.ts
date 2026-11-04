// Shepherdr web (proof of concept): runs the same mods as the Herdr window, in a browser.
// This server only serves files and answers: the mods' own files (read-only, from the app's
// home), the browser runtime (client/), and one WebSocket that pushes the live state (herdr-core's
// terminals and layout documents, shared.json, settings) and runs the person's actions.
// Bound to 127.0.0.1 only; shared privately over the tailnet with `tailscale serve --set-path`.
// The window stays the one that runs things: whatever a mod starts by itself in the browser
// (timers, request queues, cleanups) is refused here unless it only reads (safety.ts).
import { readFileSync, existsSync, statSync, watch, readdirSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, normalize, extname, dirname } from 'node:path'
import { homedir } from 'node:os'
import { Core } from './core.ts'
import { classify, allowedWrite } from './safety.ts'

const HOME = homedir()
const APP = process.env.SHEPHERDR_WEB_APP ?? join(HOME, '.config/herdr-app')
const PORT = Number(process.env.PORT ?? 7591)
const HOST = '127.0.0.1'
const CLIENT = join(import.meta.dir, 'client')
const THEMES = JSON.parse(readFileSync(join(import.meta.dir, 'themes.json'), 'utf8'))

type Sock = { id: number }
const socks = new Set<import('bun').ServerWebSocket<Sock>>()
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---- live state ---------------------------------------------------------------------------
const state: Record<string, unknown> = { home: HOME, appHome: APP, themes: THEMES }
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
function push(key: string, value: unknown) {
  const was = JSON.stringify(state[key])
  const now = JSON.stringify(value)
  if (was === now) return
  state[key] = value
  for (const ws of socks) ws.send(`{"t":"set","key":${JSON.stringify(key)},"value":${now}}`)
}

// The app's own files, read again when they change (the window writes them).
const files: Record<string, string> = { shared: 'shared.json', view: 'view.json', settings: 'settings.json', keys: 'keys.json' }
function readFiles() {
  for (const [k, f] of Object.entries(files)) push(k, readJson(join(APP, f)))
  const name = (state.shared as any)?.layout ?? 'shepherdr'
  push('layoutName', name)
  push('layout', readJson(join(APP, 'layouts', `${name}.json`)))
}
readFiles()
let fileTimer: Timer | null = null
watch(APP, (_e, f) => {
  if (!f || !/^(shared|view|settings|keys)\.json$|^layouts/.test(String(f))) return
  if (fileTimer) clearTimeout(fileTimer)
  fileTimer = setTimeout(readFiles, 150)
})

// herdr-core: terminals on every machine, and each machine's layout document ("herdr-app").
const core = new Core(log)
async function readCore() {
  try {
    const list = await core.call('terminal.list', {})
    push('terminals', list.terminals)
    push('coreMachines', list.machines)
  } catch (e) { log('terminal.list', String(e)) }
}
async function readDocs() {
  const docs: Record<string, unknown> = { ...(state.docs as object ?? {}) }
  const names: (string | null)[] = [null, ...((state.coreMachines as any[]) ?? []).filter((m) => m.state === 'connected').map((m) => m.name)]
  await Promise.all(names.map(async (m) => {
    try {
      const r = await core.call('doc.get', m ? { name: 'herdr-app', on: m } : { name: 'herdr-app' }, 8000)
      if (r.value) docs[m ?? ''] = r.value; else delete docs[m ?? '']
    } catch { /* an offline machine keeps its last layout */ }
  }))
  push('docs', docs)
}
core.on('event', () => { scheduleCore() })
let coreTimer: Timer | null = null
function scheduleCore() {
  if (coreTimer) return
  coreTimer = setTimeout(async () => { coreTimer = null; await readCore(); await readDocs() }, 250)
}
await core.start()
await readCore()
await readDocs()
setInterval(readCore, 3000)
setInterval(readDocs, 4000)

// ---- the mods' calls ----------------------------------------------------------------------
const blocked: { at: number; what: string }[] = []
function note(what: string, mine: boolean) {
  const short = what.replace(/\n/g, ' ⏎ ').slice(0, 400)
  log(mine ? 'refused (a tap)' : 'refused', short)
  blocked.push({ at: Date.now(), what: short })
  if (blocked.length > 200) blocked.shift()
  for (const ws of socks) ws.send(JSON.stringify({ t: 'blocked', what: short, mine }))
}
function refuse(what: string, mine = false): never {
  note(what, mine)
  throw new Error(`Not from the web: ${what.slice(0, 80)}`)
}
// A refused command answers as one that couldn't run: mods treat it as a failed try, quietly.
function refused(what: string, mine: boolean) {
  note(what, mine)
  return { code: 126, stdout: '', stderr: 'Not run from the web: the Herdr window does this.' }
}

async function execLocal(argv: string[], cwd?: string, timeoutMs = 30000) {
  const p = Bun.spawn(argv, { cwd: cwd && existsSync(cwd) ? cwd : HOME, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: process.env })
  const kill = setTimeout(() => p.kill(), timeoutMs)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(kill)
  return { code, stdout: stdout.slice(0, 8 << 20), stderr: stderr.slice(0, 1 << 20) }
}
async function execOn(on: string, argv: string[], cwd?: string) {
  const r = await core.call('machine.exec', { argv, on, ...(cwd ? { cwd } : {}), timeout: 30 }, 35000)
  const dec = (s: string) => Buffer.from(s ?? '', 'base64').toString('utf8')
  return { code: r.code ?? 1, stdout: dec(r.stdout), stderr: dec(r.stderr) }
}

const watchers = new Map<string, { waiting: ((paths: string[]) => void)[] }>()
function watchOnce(path: string): Promise<string[]> {
  return new Promise((resolve) => {
    let w = watchers.get(path)
    if (!w) {
      w = { waiting: [] }
      watchers.set(path, w)
      try {
        const fw = watch(path, { recursive: true }, (_e, f) => {
          const list = w!.waiting.splice(0)
          for (const r of list) r([f ? join(path, String(f)) : path])
        })
        fw.on('error', () => {})
      } catch { /* missing folder: the timeout answers */ }
    }
    w.waiting.push(resolve)
    setTimeout(() => { const i = w!.waiting.indexOf(resolve); if (i >= 0) { w!.waiting.splice(i, 1); resolve([path]) } }, 60000)
  })
}

// Files the page may read on this computer: inside the home folder (links followed first).
const inHome = (p: string) => {
  let n = normalize(String(p))
  try { n = realpathSync(n) } catch { /* not there yet: its own path */ }
  return n === HOME || n.startsWith(`${HOME}/`)
}
const homeOnly = (p: string) => { if (!inHome(p)) throw new Error('Outside the home folder') }

async function call(op: string, a: any, gesture: boolean): Promise<unknown> {
  switch (op) {
    case 'exec': {
      const [command, args = [], opts = {}] = a
      const argv = [command, ...args]
      const kind = classify(argv, APP)
      if (kind === 'write' && !(gesture && allowedWrite(argv, APP))) return refused(`exec ${argv.join(' ')}`, false)
      return opts.on ? execOn(opts.on, argv, opts.cwd) : execLocal(argv, opts.cwd)
    }
    case 'hc': {
      const argv = ['hc', ...a[0]]
      const kind = classify(argv, APP)
      if (kind === 'write' && !(gesture && allowedWrite(argv, APP))) return refused(argv.join(' '), false)
      return execLocal(argv)
    }
    case 'readTextFile': {
      const [path, opts = {}] = a
      if (opts.on) {
        try { return (await core.call('file.read', { path, on: opts.on }, 15000)).text } catch { return null }
      }
      if (!inHome(path)) return null
      try { const s = statSync(path); if (s.size > 1 << 20) throw new Error('too big'); return await readFile(path, 'utf8') } catch { return null }
    }
    case 'writeTextFile': refuse(`write ${a[0]}`)
    case 'fs.readFile': homeOnly(a[0]); try { return await readFile(a[0], 'utf8') } catch (e) { throw new Error(String(e)) }
    case 'fs.readdir': {
      homeOnly(a[0])
      const d = readdirSync(a[0], { withFileTypes: true })
      return a[1]?.withFileTypes ? d.map((x) => ({ name: x.name, dir: x.isDirectory() })) : d.map((x) => x.name)
    }
    case 'fs.exists': return inHome(a[0]) && existsSync(a[0])
    case 'fs.write': refuse(`fs ${a[1]} ${a[0]}`)
    case 'watch': return inHome(a[0]) ? watchOnce(a[0]) : [a[0]]
    case 'run': refuse(`run ${a[0]} ${JSON.stringify(a[1] ?? {}).slice(0, 120)}`, gesture)
    case 'blocked': return blocked
  }
  throw new Error(`unknown call ${op}`)
}

// ---- who may use it -------------------------------------------------------------------------
// The page can run the mods' commands, so only the person gets in: by a name this server goes by
// (no DNS rebinding), and through `tailscale serve` only as the tailnet's owner (Tailscale's
// identity header). Unshared, on 127.0.0.1, the computer's own browser.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
let OWNER: string | null = process.env.SHEPHERDR_WEB_LOGIN ?? null
try {
  const ts = JSON.parse(Bun.spawnSync(['tailscale', 'status', '--json']).stdout.toString())
  const dns = String(ts.Self?.DNSName ?? '').replace(/\.$/, '')
  if (dns) HOSTS.add(dns)
  OWNER ??= ts.User?.[String(ts.Self?.UserID)]?.LoginName ?? null
} catch { /* no Tailscale: this computer only */ }
function allowed(req: Request): true | string {
  const host = req.headers.get('host') ?? ''
  const fwdHost = req.headers.get('x-forwarded-host')
  const login = req.headers.get('tailscale-user-login')
  const viaServe = Boolean(fwdHost || req.headers.get('x-forwarded-for') || login)
  if (!viaServe) return HOSTS.has(host) && /^(127\.0\.0\.1|localhost):/.test(host) ? true : 'unknown host'
  if (fwdHost && !HOSTS.has(fwdHost)) return 'unknown host'
  if (!OWNER || login !== OWNER) return 'not the owner'
  return true
}

// ---- serving --------------------------------------------------------------------------------
const TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}
// The built-in modules a mod imports by name, and where the browser gets each.
const BUILTIN: Record<string, string> = {
  herdr: 'herdr.js', 'gpui-kit': 'gpui-kit.js', gpui: 'gpui-kit.js', 'gpui-base': 'gpui-base.js', 'gpui-component': 'gpui-base.js',
  'fs/promises': 'fs.js', path: 'node.js', crypto: 'node.js', os: 'node.js', process: 'node.js', buffer: 'node.js', url: 'node.js',
}
const PER_COPY = new Set(['herdr.js', 'fs.js'])
function rewrite(src: string, depth: number, copy: string) {
  const up = '../'.repeat(depth)
  return src.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([\w/-]+)\2/g, (m, pre, q, name) => {
    const f = BUILTIN[name]
    if (!f) return m
    return `${pre}${q}${up}rt/${f}${PER_COPY.has(f) ? `?copy=${copy}` : ''}${q}`
  })
}
// Pictures are only ever pictures: an SVG opened by itself runs no script on this page's origin.
const SANDBOX = { 'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", 'x-content-type-options': 'nosniff' }
const file = (path: string, type?: string, extra: Record<string, string> = {}) =>
  new Response(Bun.file(path), { headers: { 'content-type': type ?? TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...extra } })

Bun.serve<Sock>({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120,
  async fetch(req, srv) {
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname)
    // Only this page may talk to the socket (no other website in the person's browser).
    const who = allowed(req)
    if (who !== true) { log('turned away', who, req.headers.get('host'), req.headers.get('tailscale-user-login') ?? ''); return new Response('forbidden', { status: 403 }) }
    if (path === '/ws') {
      // Only this page may open the socket: its own origin, never another website's.
      const origin = req.headers.get('origin')
      if (!origin || !HOSTS.has(new URL(origin).host)) return new Response('forbidden', { status: 403 })
      return srv.upgrade(req, { data: { id: Math.random() } }) ? undefined : new Response('upgrade failed', { status: 400 })
    }
    if (path === '/' || path === '/index.html') return file(join(CLIENT, 'index.html'))
    if (path.startsWith('/rt/') || path.startsWith('/shell/') || path.startsWith('/vendor/')) {
      const p = normalize(join(CLIENT, path))
      if (!p.startsWith(CLIENT) || !existsSync(p)) return new Response('not found', { status: 404 })
      return file(p)
    }
    // A mod copy's files: /c/<copy>/mods/<mod>/<file>. Each copy gets its own module graph, as
    // each copy in Herdr runs on its own.
    const m = /^\/c\/([\w-]+)\/((?:mods|lib)\/.+)$/.exec(path)
    if (m) {
      const p = normalize(join(APP, m[2]))
      if (!p.startsWith(`${APP}/`) || !existsSync(p)) return new Response('not found', { status: 404 })
      if (extname(p) === '.js') {
        const depth = path.split('/').length - 2
        return new Response(rewrite(await readFile(p, 'utf8'), depth, m[1]), { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' } })
      }
      return file(p)
    }
    // The app's assets (icons, svgs a mod names by its path in the home folder).
    if (path.startsWith('/app/')) {
      const p = normalize(join(APP, path.slice(5)))
      if (!p.startsWith(`${APP}/`) || !TYPES[extname(p)] || extname(p) === '.json' || !existsSync(p)) return new Response('not found', { status: 404 })
      return file(p, undefined, SANDBOX)
    }
    // A picture a mod shows by its absolute path (an attachment, a screenshot): images only.
    if (path === '/file') {
      const p = normalize(url.searchParams.get('path') ?? '')
      if (!inHome(p) || !/\.(png|jpe?g|gif|webp|svg)$/i.test(p) || !existsSync(p)) return new Response('not found', { status: 404 })
      return file(p, undefined, SANDBOX)
    }
    return new Response('not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      socks.add(ws)
      ws.send(JSON.stringify({ t: 'state', state }))
    },
    close(ws) { socks.delete(ws) },
    async message(ws, raw) {
      let msg: any
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (msg.t !== 'call') return
      try {
        const value = await call(msg.op, msg.args ?? [], Boolean(msg.gesture))
        ws.send(JSON.stringify({ t: 'reply', id: msg.id, ok: true, value: value ?? null }))
      } catch (e) {
        ws.send(JSON.stringify({ t: 'reply', id: msg.id, ok: false, error: String((e as Error)?.message ?? e) }))
      }
    },
  },
})
log(`Shepherdr web on http://${HOST}:${PORT} (mods from ${APP})`)
