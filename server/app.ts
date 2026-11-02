// The web server: the screen (built files), the API and the live link. Served on 127.0.0.1 only; it is shared
// privately over the tailnet (tailscale serve), never on a public address.
import type { ServerWebSocket } from 'bun'
import { existsSync, mkdirSync, readFileSync, statSync, watch } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'
import { notifies, waiting } from '../shared/alerts.ts'
import { buildId } from '../shared/build.ts'
import { fileType } from '../shared/files.ts'
import type { Action, AddSpace, ServerEvent, UpdateStatus, WorktreeAsk } from '../shared/types.ts'
import { frameResponse, wrapPage } from './frame.ts'
import { guarded } from './core/guarded.ts'
import type { Source } from './source.ts'
import type { Push } from './push.ts'

type Sock =
  /** visible: the screen is on; push: its push subscription, which gets no alerts while the screen is on */
  | { kind: 'live'; chats: string[]; term: string | null; visible: boolean; push: string | null; link?: boolean }
  | { kind: 'voice'; chat: string; bridge?: ReturnType<NonNullable<Source['voice']>> }
  | { kind: 'browser'; task: string; bridge?: ReturnType<NonNullable<Source['browser']>> }
  | { kind: 'terminal'; chat: string; bridge?: ReturnType<NonNullable<Source['terminal']>> }

const FONT = join(import.meta.dir, '..', 'node_modules', 'inter-ui', 'variable', 'InterVariable.woff2')

export interface AppOptions {
  source: Source
  dist: string
  push?: Push
  port: number
  host?: string
  /** update.json: how the last update of Shepherdr went, shown on every screen */
  updates?: string
  /** Standalone core launcher identity; absent in the legacy application. */
  health?: () => unknown
  /** A validated plugin build can replace presentation without restarting agents or the server. */
  assets?: { dist: string }
}

export function startApp({ source, dist, push, port, host = '127.0.0.1', updates, health, assets }: AppOptions) {
  const live = new Set<ServerWebSocket<Sock>>()
  const send = (ws: ServerWebSocket<Sock>, e: ServerEvent) => {
    if (ws.getBufferedAmount() > 1024 * 1024) { ws.close(1013, 'Reconnect for a fresh snapshot'); return }
    ws.send(JSON.stringify(e))
  }

  const calls = new Set<ServerWebSocket<Sock>>()
  /** about to restart for an update: no new voice call starts, so none is cut short */
  let draining = false
  // the build this server serves; a screen on another one reloads (it keeps what you were typing)
  const currentBuild = () => { const index = join(assets?.dist || dist, 'index.html'); return existsSync(index) ? buildId(readFileSync(index, 'utf8')) : '' }
  let build = currentBuild()
  let update = updates ? readUpdate(updates) : null
  if (updates) {
    mkdirSync(dirname(updates), { recursive: true })
    // the folder, not the file: the file may not be there yet, and it is replaced whole when written
    const w = watch(dirname(updates), (_, name) => {
      if (name !== basename(updates)) return
      const next = readUpdate(updates)
      if (JSON.stringify(next) === JSON.stringify(update)) return
      update = next
      for (const ws of live) send(ws, { type: 'update', update })
    })
    w.unref?.()
  }

  const rewatch = () => {
    const chats = new Set<string>()
    const terms = new Set<string>()
    for (const ws of live) {
      if (ws.data.kind !== 'live') continue
      ws.data.chats.forEach((c) => chats.add(c))
      if (ws.data.term) terms.add(ws.data.term)
    }
    source.watch([...chats], [...terms])
  }

  let snapTimer: ReturnType<typeof setTimeout> | null = null
  source.on('snapshot', () => {
    if (snapTimer) return
    snapTimer = setTimeout(() => {
      snapTimer = null
      void guarded('Snapshot', () => {
        const snapshot = source.snapshot()
        const next = currentBuild()
        if (next !== build) { build = next; for (const ws of live) send(ws, { type: 'build', id: build }) }
        for (const ws of live) send(ws, { type: 'snapshot', snapshot })
      })
    }, 30)
  })
  source.on('chat', (key) => {
    const chat = source.chat(key)
    if (!chat) return
    for (const ws of live) if (ws.data.kind === 'live' && ws.data.chats.includes(key)) send(ws, { type: 'chat', chat })
  })
  source.on('terminal', (key, screen) => {
    for (const ws of live) if (ws.data.kind === 'live' && ws.data.term === key) send(ws, { type: 'terminal', chat: key, ...screen })
  })
  // a worker for another machine: its news goes to the main machine's home space, over its main machine's link; while
  // there is none (the main server restarts) the last few wait for it
  const unsent: unknown[] = []
  source.on('news', (news) => {
    const links = [...live].filter((ws) => ws.data.kind === 'live' && ws.data.link)
    for (const ws of links) send(ws, { type: 'news', news } as unknown as ServerEvent)
    if (!links.length && unsent.push(news) > 20) unsent.shift()
  })
  // alerts only go out as push, and not to a device whose app is on screen: it shows nothing for them
  source.on('alert', (alert) => {
    // a worker for another machine: its main machine's link pushes them
    for (const ws of live) if (ws.data.kind === 'live' && ws.data.link) send(ws, { type: 'alert', alert } as unknown as ServerEvent)
    // what its place's Notify lets through: All, Needs me or Off
    const snap = source.snapshot()
    if (!notifies(snap, alert)) return
    const onScreen = new Set<string>()
    for (const ws of live) if (ws.data.kind === 'live' && ws.data.visible && ws.data.push) onScreen.add(ws.data.push)
    push?.send(alert, onScreen, waiting(snap)).then(() => source.emit('snapshot'))
  })

  const json = (v: unknown, status = 200) => Response.json(v, { status })

  const server = Bun.serve<Sock>({
    port,
    hostname: host,
    idleTimeout: 120,
    async fetch(req, srv) {
      const url = new URL(req.url)
      // the app may sit under a path (/shepherdr): everything is addressed relative to the app's own folder
      const at = url.pathname.indexOf('/api/')
      const path = at >= 0 ? url.pathname.slice(at) : url.pathname
      const q = url.searchParams

      // only this app's own pages may act: another website in your browser can't (no cross-site requests)
      if (path.startsWith('/api/') && path !== '/api/font/InterVariable.woff2' && !sameSite(req, path)) return new Response('forbidden', { status: 403 })

      if (path === '/api/ws') return srv.upgrade(req, { data: { kind: 'live', chats: [], term: null, visible: false, push: null } }) ? undefined : new Response('upgrade failed', { status: 400 })
      if (path === '/api/terminal') {
        if (!source.terminal) return new Response('no streaming terminal here', { status: 404 })
        return srv.upgrade(req, { data: { kind: 'terminal', chat: q.get('chat') ?? '' } }) ? undefined : new Response('upgrade failed', { status: 400 })
      }
      if (path === '/api/voice') return srv.upgrade(req, { data: { kind: 'voice', chat: q.get('chat') ?? '' } }) ? undefined : new Response('upgrade failed', { status: 400 })
      if (path === '/api/browser') {
        if (!source.browser) return new Response('no browser here', { status: 404 })
        return srv.upgrade(req, { data: { kind: 'browser', task: q.get('task') ?? '' } }) ? undefined : new Response('upgrade failed', { status: 400 })
      }

      try {
        if (path === '/api/health' && health) return json(health())
        if (path === '/api/chat') {
          const key = q.get('chat') ?? ''
          return json({ chat: source.chat(key) ?? null, status: source.chatStatus?.(key) })
        }
        if (path === '/api/snapshot') return json(source.snapshot())
        // Diagnostic build identity; standalone lifecycle ownership comes from its private run record.
        if (path === '/api/version') return json(running())
        // the updater restarts the server only once it has stopped new calls and none is on; both at once, so no call
        // can start in between. It lifts the stop again while it waits for a call to end.
        if (path === '/api/drain' && req.method === 'POST') {
          draining = !!((await req.json()) as { on?: boolean }).on
          return json({ calls: calls.size })
        }
        if (path === '/api/folders') {
          if (!source.folders) return json({ error: 'Adding spaces is not possible here.' }, 404)
          return json(await source.folders(q.get('machine') ?? '', q.get('path') ?? '~'))
        }
        if (path === '/api/spaces' && req.method === 'POST') {
          if (!source.addSpace) return json({ error: 'Adding spaces is not possible here.' }, 404)
          const b = (await req.json()) as AddSpace
          return json(await source.addSpace({ machine: String(b.machine ?? ''), path: String(b.path ?? ''), name: b.name === undefined ? undefined : String(b.name), create: !!b.create }))
        }
        if (path === '/api/worktree') {
          if (!source.worktree) return json({ error: 'Not possible here.' }, 404)
          const what = q.get('what')
          if (what !== 'files' && what !== 'file' && what !== 'diff' && what !== 'patch' && what !== 'pr') return json({ error: 'Ask for files, file, diff, patch or pr.' }, 400)
          const ask = { task: q.get('task') ?? '', what, path: q.get('path') ?? '' } as WorktreeAsk
          return json(await source.worktree(ask))
        }
        if (path === '/api/activity') {
          if (!source.activity) return json({ error: 'Not possible here.' }, 404)
          const what = q.get('what')
          if (what !== 'turn' && what !== 'output' && what !== 'job') return json({ error: 'Ask for turn, output or job.' }, 400)
          return json(await source.activity({ chat: q.get('chat') ?? '', what, id: q.get('id') ?? '' }))
        }
        if (path === '/api/action' && req.method === 'POST') {
          const a = (await req.json()) as Action
          return json((await source.act(a)) ?? {})
        }
        // an artifact: its page wrapped for a sealed frame, its data alone (pushed into open frames when only that
        // changed), the check's picture of it, and all of it raw for the main machine to pass on
        if (path.startsWith('/api/artifacts/')) {
          const [id, part] = decodeURIComponent(path.slice('/api/artifacts/'.length)).split('/')
          const v = Number(q.get('v')) || undefined
          if (part === 'thumb') {
            const b = await source.artifactThumb(id, q.has('dark'))
            return b ? new Response(b, { headers: { 'content-type': b.type || 'image/png', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } }) : new Response('no picture', { status: 404 })
          }
          const a = await source.artifact(id, v)
          if (part === 'raw') return a ? json(a) : json({ error: 'No such artifact' }, 404)
          if (part === 'data') return a ? json({ data: a.data ?? null }) : json({ error: 'No such artifact' }, 404)
          if (!a) return new Response('no such artifact', { status: 404 })
          return frameResponse(wrapPage(a.html, { sent: a.sent, data: a.data, big: q.has('full'), phone: q.get('device') === 'phone', theme: q.get('theme') === 'dark' ? 'dark' : q.get('theme') === 'light' ? 'light' : undefined }))
        }
        // the app's font, for artifacts in sealed frames (their origin is opaque, so it is fetched cross-origin)
        if (path === '/api/font/InterVariable.woff2')
          return new Response(Bun.file(FONT), { headers: { 'content-type': 'font/woff2', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' } })
        if (path === '/api/upload' && req.method === 'POST') {
          const form = await req.formData()
          const file = form.get('file') as File | null
          const chat = String(form.get('chat') ?? '')
          if (!file) return json({ error: 'No file' }, 400)
          const p = await source.upload(chat, file.name, new Uint8Array(await file.arrayBuffer()))
          return json({ path: p })
        }
        if (path === '/api/file') {
          const at = q.get('path') ?? ''
          const blob = await source.attachment(q.get('chat') ?? '', at)
          return blob ? attachment(blob, basename(at).replace(/^[a-z0-9]+-/, ''), q.has('download')) : new Response('no such file', { status: 404 })
        }
        if (path === '/api/cli' && req.method === 'POST') {
          const cli = (source as Source & { cli?(a: string[], c: { chat?: string; cwd?: string; stdin?: string; local?: boolean; proof?: string }): Promise<{ out: string; code: number }> }).cli
          if (!cli) return json({ out: source.kind === 'demo' ? 'This demo server does not accept shepherdr commands. Target your owning live server or installed helper.\n' : 'This server does not provide the shepherdr command. Check the target URL or installed helper.\n', code: 1 })
          const b = (await req.json()) as { args: string[]; chat?: string; cwd?: string; stdin?: string }
          // some commands wait long (shepherdr checks waits for GitHub's): no idle cut-off for these
          srv.timeout(req, 0)
          return json(await cli.call(source, b.args ?? [], { chat: b.chat, cwd: b.cwd, stdin: b.stdin, local: direct(req), proof: req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] }))
        }
        if (path === '/api/push/key') return json({ key: push?.publicKey ?? null })
        // what waits on you: the service worker sets the app icon's count with it after a notification button answers
        if (path === '/api/waiting') return json(waiting(source.snapshot()))
        if (path === '/api/push/subscribe' && req.method === 'POST') {
          const b = await req.json()
          push?.subscribe(b.sub, b.device)
          source.emit('snapshot')
          return json({ ok: true })
        }
        if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404)
      } catch (e) {
        return json({ error: (e as Error).message }, 500)
      }
      return serveStatic(assets?.dist || dist, path)
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === 'terminal' && source.terminal) {
          ws.data.bridge = source.terminal(ws.data.chat, { send: data => ws.send(data), close: () => ws.close(), buffered: () => ws.getBufferedAmount() })
        } else if (ws.data.kind === 'live') {
          live.add(ws)
          send(ws, { type: 'snapshot', snapshot: source.snapshot() })
          send(ws, { type: 'build', id: build })
          send(ws, { type: 'update', update })
        } else if (ws.data.kind === 'voice' && draining) {
          ws.send(JSON.stringify({ type: 'error', message: 'Shepherdr is updating. Call again in a moment.' }))
          ws.close()
        } else if (ws.data.kind === 'voice' && source.voice) {
          calls.add(ws)
          ws.data.bridge = source.voice(ws.data.chat, { send: (d) => ws.send(d), close: () => ws.close(), buffered: () => ws.getBufferedAmount() })
        } else if (ws.data.kind === 'browser' && source.browser) {
          ws.data.bridge = source.browser(ws.data.task, { send: (d) => ws.send(d), close: () => ws.close(), buffered: () => ws.getBufferedAmount() })
        }
      },
      message(ws, msg) {
        const d = ws.data
        if (d.kind === 'live') {
          const m = JSON.parse(String(msg)) as { type: 'ping' } | { type: 'watch'; chats: string[]; term: string | null; visible?: boolean; push?: string | null; link?: boolean }
          if (m.type === 'ping') return void send(ws, { type: 'pong' })
          if (m.type !== 'watch') return
          const before = new Set(d.chats)
          d.chats = m.chats
          d.term = m.term
          d.visible = !!m.visible
          d.push = m.push ?? null
          d.link = !!m.link
          if (d.link) for (const news of unsent.splice(0)) send(ws, { type: 'news', news } as unknown as ServerEvent)
          for (const k of m.chats) {
            if (before.has(k)) continue
            const chat = source.chat(k)
            if (chat) send(ws, { type: 'chat', chat })
          }
          rewatch()
        } else if (d.kind === 'voice') {
          if (typeof msg !== 'string') d.bridge?.audio(msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength) as ArrayBuffer)
        } else if (d.kind === 'browser' || d.kind === 'terminal') {
          if (typeof msg === 'string') d.bridge?.message(msg)
        }
      },
      close(ws) {
        if (ws.data.kind === 'live') {
          live.delete(ws)
          rewatch()
        } else if (ws.data.kind === 'voice') {
          calls.delete(ws)
          ws.data.bridge?.end()
        } else if (ws.data.kind === 'browser' || ws.data.kind === 'terminal') {
          ws.data.bridge?.end()
        }
      },
    },
  })

  return server
}

function readUpdate(f: string): UpdateStatus | null {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as UpdateStatus
  } catch {
    return null
  }
}

/** the checkout herdr installed (or linked), its version, and the supervisor that keeps this server (none: started by
 *  hand) */
function running() {
  const root = process.env.SHEPHERDR_ROOT ?? join(import.meta.dir, '..')
  let version = ''
  try {
    version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? ''
  } catch {}
  const sup = Number(process.env.SHEPHERDR_SUPERVISOR)
  return { root, version, supervisor: sup > 0 ? sup : null }
}

/**
 * A browser always names the page a request comes from (Origin) on a POST and a WebSocket; it must be this app's own
 * address. Requests without an Origin come from programs (the shepherdr command, another machine's copy), not from a
 * website. A browser POST must also carry the app's own header, which a cross-site form or no-cors request can't set.
 */
export function sameSite(req: Request, path: string): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  if (origin !== null) {
    let ok = false
    try {
      const o = new URL(origin)
      ok = o.host === host || o.host === req.headers.get('host')
    } catch {
      ok = false
    }
    if (!ok) return false
  }
  const writes = req.method !== 'GET' && req.method !== 'HEAD'
  if (writes && origin !== null && req.headers.get('x-shepherdr') !== '1') return false
  // fetch metadata: a cross-site request is never let through, Origin or not
  const site = req.headers.get('sec-fetch-site')
  if (site === 'cross-site' && (writes || path === '/api/ws' || path === '/api/voice' || path === '/api/browser' || path === '/api/file' || path === '/api/folders' || path === '/api/worktree' || path === '/api/activity' || path === '/api/chat')) return false
  return true
}

/** Legacy routing hint only. Headers do not authenticate a caller; secret access requires a capability. */
export const direct = (req: Request) => !['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'tailscale-user-login', 'origin'].some((h) => req.headers.has(h))

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
}

function serveStatic(dist: string, path: string) {
  // anything that is not a file is the app (its address carries the place and task)
  const clean = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '')
  const parts = clean.split('/').filter(Boolean)
  // strip a leading mount path such as /shepherdr/
  for (let i = 0; i <= parts.length; i++) {
    const f = join(dist, ...parts.slice(i))
    if (f.startsWith(dist) && existsSync(f) && statSync(f).isFile()) return file(f)
  }
  return file(join(dist, 'index.html'))
}

/** an attached file: a picture, PDF or text opens in the browser (as text, never as a page that runs); the rest
 *  downloads. Nothing in it runs with this app's origin. */
function attachment(blob: Blob, name: string, download: boolean) {
  const { type, inline } = fileType(name)
  return new Response(blob, {
    headers: {
      'content-type': type,
      'content-disposition': `${inline && !download ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // a PDF needs the browser's own viewer, which a sandbox blocks; it runs nothing of ours either way
      ...(type === 'application/pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" }),
      'cache-control': 'private, max-age=86400',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  })
}

function file(f: string) {
  const ext = f.slice(f.lastIndexOf('.'))
  const immutable = f.includes('/assets/')
  return new Response(Bun.file(f), {
    headers: {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  })
}
