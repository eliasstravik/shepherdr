// Local-only optional demo browser. Production uses core-owned browser children.
// The shared browser. Each task gets one agent-browser session (named after the task, in Shepherdr's own namespace),
// started on demand on the task's machine. Its agent drives it with the plain agent-browser command (its terminal has
// the session in its environment); you watch it in the task's Browser panel. agent-browser streams every session's
// viewport on a WebSocket bound to 127.0.0.1: the server relays it to the panel (the port itself is never shared) and
// passes your mouse, keys and touches back, but only while you drive. Mark up asks the page (over the session's
// DevTools connection) what is under your finger. The session closes when the task is
// stopped, done, archived or deleted, and a done task's browser profile goes with it. Whatever Chrome is still running
// in its profile after that is ended too: a web game left open in software WebGL takes a core or two for nothing. A
// browser no agent command used and no one watched for a while (Settings, browser.idleClose) closes the same way, its
// sign-ins kept: the agent's next command, or opening the panel, starts it again. Each agent command marks the time
// (bin/agent-browser, helper/agent-browser). Pages are told the reader prefers reduced motion, so they don't animate:
// Chrome draws them in software, with no GPU. The same wrappers ask Chrome for that, so the agent's commands and
// Shepherdr's (and an agent's started before this) ask for the same browser: two asking differently restart it.
import { dirname, join } from 'node:path'
import { toUrl, type BrowserDown, type BrowserPick, type BrowserUp, type Driver, type FrameMeta } from '../../shared/browser.ts'
import { ROOT } from '../root.ts'
import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { boxOf, describe } from '../browser-pick.ts'

/** agent-browser keeps Shepherdr's sessions apart from any of your own */
export const NAMESPACE = 'shepherdr'

/** the agent-browser command at the pinned version (bin/agent-browser picks the package's binary) */
export const browserBin = () => process.env.SHEPHERDR_AGENT_BROWSER ?? join(ROOT, 'bin', 'agent-browser')

/** a task's id (SHE-61): the only session names Shepherdr closes or forgets. agent-browser takes any name, so one an
 *  agent made up ("..") must never lead the clean-up to a folder that is not a task's own profile */
export const isTaskId = (s: string) => /^[A-Za-z0-9]+-\d+$/.test(s)

/** where a task's browser keeps its sign-ins between restarts */
export const profileOf = (task: string) => join(tmpdir(), 'shepherdr-demo', 'browser', task)

/** the environment that puts every agent-browser command in a task's terminal on its shared browser */
export function browserEnv(task: string): Record<string, string> {
  return { AGENT_BROWSER_NAMESPACE: NAMESPACE, AGENT_BROWSER_SESSION: task, AGENT_BROWSER_PROFILE: profileOf(task) }
}

/** the file each agent command touches (bin/agent-browser): when it last used its browser */
export const usedMark = (profile: string) => `${profile}.used`

export interface BrowserClient {
  send(s: string): void
  close(): void
  /** bytes waiting to go out: frames are skipped for a screen that can't keep up */
  buffered?(): number
}

export interface BrowserBridge {
  message(raw: string): void
  end(): void
}

export interface BrowsersOpts {
  bin?: string
  /** the session's environment (the demo keeps its own namespace and profiles) */
  env?: (task: string) => Record<string, string>
  /** a quiet line to the task's agent (it took over / handed back) */
  tell(task: string, text: string): void
  /** the task's agent is in a turn */
  working(task: string): boolean
  /** how long the task's browser may sit idle before it closes (ms); null: it stays */
  idleClose?(task: string): number | null
  user(): string
  host: string
}

type Run = { ok: boolean; data?: Record<string, unknown>; error?: string }

/** agent-browser's word for a session's daemon started by another version (or settings) meanwhile */
const CLASH = /different daemon configuration/i

const LEAVE_MS = 60_000
const IDLE_MS = 5000
/** frames are skipped for a screen this far behind */
const BEHIND = 2_000_000

interface Hub {
  task: string
  clients: Set<BrowserClient>
  up?: WebSocket
  cdp?: Cdp
  starting?: Promise<void>
  driver: Driver
  /** the agent was told you took over (so it hears when you hand back) */
  told: boolean
  url: string
  title: string
  target: string
  connected: boolean
  viewport: { w: number; h: number }
  meta?: FrameMeta
  /** last frame, for a screen that joins */
  frame?: string
  agentAt: number
  /** commands this server runs itself are not the agent driving */
  own: number
  ownUntil: number
  hovering: boolean
  /** closed with its task: a start under way stops short */
  gone?: boolean
  /** when the last screen stopped watching (or you used it) */
  seenAt: number
  leave?: ReturnType<typeof setTimeout>
  idle?: ReturnType<typeof setTimeout>
  stateTimer?: ReturnType<typeof setTimeout>
  fwd?: { port: number; close(): void }
  cdpFwd?: { port: number; remote: number; close(): void }
  share?: { url: string; stop(): void; proc: unknown }
  sharing?: boolean
  /** panels that take frames straight from there */
  direct: Set<BrowserClient>
}

export class Browsers {
  private hubs = new Map<string, Hub>()
  private bin: string
  private ready: Promise<boolean>
  private ok = false
  private why = ''

  private env: (task: string) => Record<string, string>

  constructor(private o: BrowsersOpts) {
    this.bin = o.bin ?? browserBin()
    this.env = o.env ?? browserEnv
    this.ready = this.check()
  }

  /** whether the Browser item works on this machine, and if not, what to do */
  status(): { ready: boolean; hint?: string } {
    return this.ok ? { ready: true } : { ready: false, hint: this.why || 'Checking agent-browser…' }
  }

  /** agent-browser answers here: once it did, or now (one slow answer at start-up must not stop every clean-up after) */
  private async usable() {
    return (await this.ready) || this.ok || this.check()
  }

  private async check() {
    let ok = false
    try {
      const p = Bun.spawn([this.bin, '--version'], { env: { ...process.env }, stdout: 'pipe', stderr: 'pipe' })
      ok = /agent-browser/i.test(await new Response(p.stdout).text()) && (await p.exited) === 0
    } catch {
      /* not there at all */
    }
    this.ok = ok
    this.why = ok ? '' : `agent-browser is missing on ${this.o.host}: run bun install in ${ROOT}`
    return ok
  }

  private async run(task: string, args: string[], timeout = 30_000): Promise<Run> {
    const p = Bun.spawn([this.bin, ...args, '--json'], { env: { ...process.env, ...this.env(task), SHEPHERDR_OWN: '1' }, stdout: 'pipe', stderr: 'pipe' })
    const t = setTimeout(() => p.kill(), timeout)
    try {
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
      await p.exited
      const j = JSON.parse(out.trim().split('\n').pop() || '{}') as { success?: boolean; data?: Record<string, unknown>; error?: string }
      return { ok: !!j.success, data: j.data ?? undefined, error: j.error ?? (err.trim() || undefined) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    } finally {
      clearTimeout(t)
    }
  }

  /** a command of ours: the stream reports it like the agent's, so it doesn't count as the agent driving */
  private async ours(h: Hub, args: string[]) {
    h.own++
    try {
      return await this.run(h.task, args)
    } finally {
      h.own--
      h.ownUntil = Date.now() + 300
    }
  }

  private hub(task: string): Hub {
    let h = this.hubs.get(task)
    if (!h) {
      h = { task, clients: new Set(), driver: 'agent', told: false, url: '', title: '', target: '', connected: false, viewport: { w: 1280, h: 720 }, agentAt: 0, own: 0, ownUntil: 0, hovering: false, direct: new Set(), seenAt: 0 }
      this.hubs.set(task, h)
    }
    return h
  }

  /** a Browser panel opened: it gets the state, the last frame and everything after */
  attach(task: string, c: BrowserClient): BrowserBridge {
    const h = this.hub(task)
    clearTimeout(h.leave)
    clearTimeout(h.idle)
    h.clients.add(c)
    c.send(JSON.stringify(this.state(h)))
    if (h.frame) c.send(h.frame)
    if (!h.up) this.start(h)
    return {
      message: (raw) => {
        let m: BrowserUp
        try {
          m = JSON.parse(raw) as BrowserUp
        } catch {
          return
        }
        this.onMessage(h, c, m).catch((e) => c.send(JSON.stringify({ type: 'error', message: (e as Error).message } satisfies BrowserDown)))
      },
      end: () => {
        h.clients.delete(c)
        h.direct.delete(c)
        h.seenAt = Date.now()
        // closed with its task: nothing is left to hand back
        if (h.clients.size || h.gone) return
        // nobody watches: the stream stops (no frames to encode), and a take-over left open goes back to the agent
        h.idle = setTimeout(() => this.disconnect(h), IDLE_MS)
        if (h.driver === 'you') h.leave = setTimeout(() => this.handBack(h), LEAVE_MS)
      },
    }
  }

  private start(h: Hub) {
    h.starting ??= (async () => {
      if (!(await this.usable())) return this.broadcast(h, { type: 'error', message: this.why })
      // a daemon another agent-browser started meanwhile: agent-browser restarts it on the next try
      const ours = async (args: string[]) => {
        const r = await this.ours(h, args)
        return !r.ok && CLASH.test(r.error ?? '') && !h.gone ? this.ours(h, args) : r
      }
      let st = await ours(['stream', 'status'])
      if (h.gone) return
      if (!st.ok) throw new Error(st.error ?? 'agent-browser did not answer')
      if (!st.data?.connected) {
        const o = await ours(['open', 'about:blank'])
        // closed with its task meanwhile: what this just opened goes too
        if (h.gone) return void this.run(h.task, ['close'])
        if (!o.ok) throw new Error(o.error ?? 'the browser did not start')
        st = await ours(['stream', 'status'])
      }
      const port = Number(st.data?.port)
      if (!port) throw new Error('agent-browser has no stream for this session')
      if (!h.clients.size || h.gone) return
      this.connect(h, port)
    })()
      .catch((e) => this.broadcast(h, { type: 'error', message: this.hint((e as Error).message) }))
      .finally(() => (h.starting = undefined))
    return h.starting
  }

  /** an error said plainly, with what to do */
  private hint(e: string) {
    if (CLASH.test(e)) return `Another agent-browser (another version, or other settings) is using this browser, so it keeps restarting. The agent should run ${this.bin}, the version Shepherdr pins, without --session or --profile.`
    if (/chrome|chromium|executable|no browser|install/i.test(e)) return `Chrome is missing on ${this.o.host}: run ${this.bin} install there. (${e.split('\n')[0]})`
    return `The browser could not start: ${e.split('\n')[0]}`
  }

  private connect(h: Hub, port: number) {
    // 15 frames a second is smooth enough to watch and light enough for a phone
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?maxFps=15`)
    h.up = ws
    ws.onmessage = (e) => {
      const s = String(e.data)
      let m: { type?: string; [k: string]: unknown }
      try {
        m = JSON.parse(s)
      } catch {
        return
      }
      switch (m.type) {
        case 'frame':
          h.frame = s
          h.meta = m.metadata as FrameMeta
          for (const c of h.clients) if (!h.direct.has(c) && (c.buffered?.() ?? 0) < BEHIND) c.send(s)
          return
        case 'url':
          h.url = String(m.url ?? '')
          return this.stateSoon(h)
        case 'tabs': {
          const tab = (m.tabs as { active?: boolean; targetId?: string; title?: string; url?: string }[]).find((t) => t.active)
          if (tab) Object.assign(h, { target: tab.targetId ?? '', title: tab.title ?? '', url: tab.url ?? h.url })
          return this.stateSoon(h)
        }
        case 'status':
          h.connected = !!m.connected
          if (m.viewportWidth) h.viewport = { w: Number(m.viewportWidth), h: Number(m.viewportHeight) }
          return this.stateSoon(h)
        case 'command':
          if (h.own || Date.now() < h.ownUntil) return
          h.agentAt = Date.now()
          // you drive, and the agent did something in the browser: it is told once to hold off
          if (h.driver === 'you' && !h.told) this.tellTake(h)
          return this.stateSoon(h)
      }
    }
    ws.onclose = () => {
      if (h.up !== ws) return
      h.up = undefined
      h.connected = false
      h.frame = undefined
      h.cdp?.close()
      h.cdp = undefined
      this.stateSoon(h)
      // the agent closed it, or its daemon went idle: a screen still watching opens it again
      if (h.clients.size) setTimeout(() => h.clients.size && !h.up && this.start(h), 1500)
    }
  }

  private unshare(h: Hub) {
    h.share?.stop()
    h.share = undefined
    h.direct.clear()
  }

  private disconnect(h: Hub) {
    if (h.clients.size) return
    this.unshare(h)
    const up = h.up
    h.up = undefined
    up?.close()
    h.cdp?.close()
    h.cdp = undefined
    h.frame = undefined
    h.fwd?.close()
    h.cdpFwd?.close()
    h.fwd = h.cdpFwd = undefined
  }

  private state(h: Hub): BrowserDown {
    return { type: 'state', driver: h.driver, url: h.url, title: h.title, connected: h.connected && !!h.up, viewport: h.viewport, agentAgo: h.agentAt ? Date.now() - h.agentAt : undefined, direct: h.share?.url }
  }

  private stateSoon(h: Hub) {
    if (h.stateTimer) return
    h.stateTimer = setTimeout(() => {
      h.stateTimer = undefined
      this.broadcast(h, this.state(h))
    }, 50)
  }

  private broadcast(h: Hub, m: BrowserDown) {
    const s = JSON.stringify(m)
    for (const c of h.clients) c.send(s)
  }

  private async onMessage(h: Hub, c: BrowserClient, m: BrowserUp) {
    const reply = (d: BrowserDown) => c.send(JSON.stringify(d))
    switch (m.type) {
      case 'input_mouse':
      case 'input_keyboard':
      case 'input_touch':
        if (h.driver === 'you' && h.up?.readyState === WebSocket.OPEN) h.up.send(JSON.stringify(m))
        return
      case 'take':
        if (h.driver === 'you') return
        h.driver = 'you'
        if (this.o.working(h.task)) this.tellTake(h)
        return this.broadcast(h, this.state(h))
      case 'handback':
        clearTimeout(h.leave)
        return this.handBack(h)
      case 'start':
        if (!h.up) await this.start(h)
        return
      case 'direct':
        if (m.on && h.share) h.direct.add(c)
        else h.direct.delete(c)
        // back through the server: the last frame at once
        if (!m.on && h.frame) c.send(h.frame)
        return
      case 'pick':
        try {
          return reply({ type: 'picked', id: m.id, pick: await this.pick(h, m.x, m.y) })
        } catch (e) {
          return reply({ type: 'picked', id: m.id, error: (e as Error).message })
        }
      case 'hover': {
        if (h.hovering) return
        h.hovering = true
        try {
          const box = await this.onNode(h, m.x, m.y, (s, objectId) => this.callOn(s, objectId, String(boxOf), []))
          return reply({ type: 'hover', box: (box as BrowserPick['box'] | null) ?? null })
        } catch {
          return reply({ type: 'hover', box: null })
        } finally {
          h.hovering = false
        }
      }
    }
    // the rest moves the page: only while you drive
    if (h.driver !== 'you') return
    switch (m.type) {
      case 'text':
        await this.page(h, 'Input.insertText', { text: String(m.text).slice(0, 10_000) })
        return
      case 'go': {
        const url = toUrl(m.url)
        if (!/^(https?:|about:blank$)/.test(url)) return reply({ type: 'error', message: 'Only web addresses (http or https) open here.' })
        await this.page(h, 'Page.navigate', { url })
        return
      }
      case 'back':
      case 'forward': {
        const hist = (await this.page(h, 'Page.getNavigationHistory')) as { currentIndex: number; entries: { id: number }[] }
        const to = hist.entries[hist.currentIndex + (m.type === 'back' ? -1 : 1)]
        if (to) await this.page(h, 'Page.navigateToHistoryEntry', { entryId: to.id })
        return
      }
      case 'reload':
        await this.page(h, 'Page.reload')
        return
      case 'viewport': {
        const w = Math.round(Math.min(2560, Math.max(320, m.w)))
        const ht = Math.round(Math.min(1600, Math.max(240, m.h)))
        await this.ours(h, ['set', 'viewport', String(w), String(ht)])
        return
      }
    }
  }

  private tellTake(h: Hub) {
    h.told = true
    this.o.tell(
      h.task,
      `${this.o.user()} took over the shared browser. Don't drive it (no agent-browser clicks, typing, scrolling or navigation) until Shepherdr says it is handed back; reading it (snapshot, screenshot, get) is fine. Nothing else to say: reply with only <no-reply>browser taken over</no-reply>.`,
    )
  }

  private handBack(h: Hub) {
    if (h.driver === 'agent') return
    h.driver = 'agent'
    if (h.told) this.o.tell(h.task, `${this.o.user()} handed the shared browser back; the page may have changed, so snapshot again before you act. Nothing else to say: reply with only <no-reply>browser handed back</no-reply>.`)
    h.told = false
    this.broadcast(h, this.state(h))
  }

  /* ---------- the page, over DevTools ---------- */

  private async session(h: Hub): Promise<{ cdp: Cdp; id: string }> {
    if (!h.cdp || h.cdp.closed) {
      const r = await this.ours(h, ['get', 'cdp-url'])
      let url = String(r.data?.cdpUrl ?? '')
      if (!r.ok || !url.startsWith('ws://127.0.0.1:')) throw new Error('The browser is not running.')
      h.cdp = await Cdp.open(url)
    }
    if (!h.target) {
      const r = await this.ours(h, ['tab', 'list'])
      const tab = ((r.data?.tabs ?? []) as { active?: boolean; targetId?: string }[]).find((t) => t.active)
      h.target = tab?.targetId ?? ''
      if (!h.target) throw new Error('The browser has no page open.')
    }
    return { cdp: h.cdp, id: await h.cdp.attach(h.target) }
  }

  private async page(h: Hub, method: string, params: Record<string, unknown> = {}) {
    const s = await this.session(h)
    return s.cdp.call(method, params, s.id)
  }

  private async callOn(s: { cdp: Cdp; id: string }, objectId: string, fn: string, args: unknown[]) {
    const r = (await s.cdp.call('Runtime.callFunctionOn', { objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), returnByValue: true }, s.id)) as {
      result: { value?: unknown }
      exceptionDetails?: { text?: string }
    }
    if (r.exceptionDetails) throw new Error(`The page could not say: ${r.exceptionDetails.text ?? 'error'}`)
    return r.result.value
  }

  /** run fn on the element at a viewport point */
  private async onNode<T>(h: Hub, x: number, y: number, fn: (s: { cdp: Cdp; id: string }, objectId: string) => Promise<T>): Promise<T | null> {
    try {
      return await this.atPoint(h, x, y, fn)
    } catch (e) {
      // a page that moved to another process (a new site) leaves the old attachment blind: attach again, once
      if (!/no node found/i.test((e as Error).message) || !h.cdp) throw e
      h.cdp.forget(h.target)
      return this.atPoint(h, x, y, fn).catch((e2) => {
        if (/no node found/i.test((e2 as Error).message)) return null
        throw e2
      })
    }
  }

  private async atPoint<T>(h: Hub, x: number, y: number, fn: (s: { cdp: Cdp; id: string }, objectId: string) => Promise<T>): Promise<T | null> {
    const s = await this.session(h)
    // the DOM agent knows the document only once asked for it (again after each navigation)
    await s.cdp.call('DOM.getDocument', { depth: 0 }, s.id)
    // it takes page (document) coordinates: the point on screen plus how far the page is scrolled
    const sc = (await s.cdp.call('Runtime.evaluate', { expression: '[scrollX, scrollY]', returnByValue: true }, s.id)) as { result: { value?: [number, number] } }
    const [sx, sy] = sc.result.value ?? [0, 0]
    const n = (await s.cdp.call('DOM.getNodeForLocation', { x: Math.round(x + sx), y: Math.round(y + sy), includeUserAgentShadowDOM: false, ignorePointerEventsNone: true }, s.id)) as { backendNodeId?: number }
    if (!n.backendNodeId) return null
    const r = (await s.cdp.call('DOM.resolveNode', { backendNodeId: n.backendNodeId }, s.id)) as { object?: { objectId?: string } }
    const objectId = r.object?.objectId
    if (!objectId) return null
    try {
      return await fn(s, objectId)
    } finally {
      s.cdp.call('Runtime.releaseObject', { objectId }, s.id).catch(() => undefined)
    }
  }

  /** what is at a point. Its shot is cropped on the screen from the frame you see: a DevTools screenshot of part of the
   *  page resizes the live page while it is taken */
  private async pick(h: Hub, x: number, y: number): Promise<BrowserPick> {
    const got = (await this.onNode(h, x, y, (s, objectId) => this.callOn(s, objectId, String(describe), [x, y]))) as Omit<BrowserPick, 'url'> | null
    if (!got) throw new Error('Nothing there to note.')
    return { ...got, url: h.url }
  }

  /* ---------- clean-up ---------- */

  /** the sessions agent-browser runs for Shepherdr on this machine */
  private async sessions(): Promise<string[]> {
    const r = await this.run('_', ['session', 'list'])
    return r.ok ? ((r.data?.sessions ?? []) as string[]) : []
  }

  /** a task stopped or merged: its browser closes (and with forget, a merged task's sign-ins go too) */
  async close(task: string, forget = false) {
    if (!isTaskId(task)) return
    const h = this.hubs.get(task)
    if (h) {
      this.hubs.delete(task)
      h.gone = true
      const s = JSON.stringify({ type: 'error', message: 'The browser closed with the task.', gone: true } satisfies BrowserDown)
      for (const c of h.clients) {
        c.send(s)
        c.close()
      }
      h.clients.clear()
      clearTimeout(h.leave)
      clearTimeout(h.idle)
      const up = h.up
      h.up = undefined
      up?.close()
      h.cdp?.close()
      h.fwd?.close()
      h.cdpFwd?.close()
      this.unshare(h)
    }
    await this.end(task)
    if (forget) {
      rmSync(this.env(task).AGENT_BROWSER_PROFILE, { recursive: true, force: true })
      rmSync(usedMark(this.env(task).AGENT_BROWSER_PROFILE), { force: true })
    }
  }

  /** a task's browser closed and its whole Chrome ended (its profile stays). still: whether to go on, asked before each
   *  step (someone may start it again meanwhile) */
  private async end(task: string, still: () => Promise<boolean> = async () => true) {
    if ((await this.usable()) && (await this.sessions()).includes(task) && (await still())) await this.run(task, ['close'])
    // what agent-browser left running (a close that failed or timed out, a daemon gone before its Chrome): ended
    const left = (await this.chromes()).filter((c) => c.task === task)
    if (left.length && (await still())) await localCommand(['kill', '-9', ...left.map((c) => String(c.pid))], { timeoutMs: 20_000 })
  }

  /** every Chrome process running in a task's profile on this machine (agent-browser starts it with --user-data-dir),
   *  with how long ago it started */
  private async chromes(): Promise<Chrome[]> {
    const flag = `--user-data-dir=${dirname(this.env('X-1').AGENT_BROWSER_PROFILE)}/`
    const r = await localCommand(['ps', '-axo', 'pid=,etime=,command='], { timeoutMs: 20_000 })
    return r.code ? [] : chromesIn(r.out, flag)
  }

  /** when each task's agent last ran a command on its browser (0: never, as far as its mark says) */
  private async usedAt(tasks: string[]): Promise<Map<string, number>> {
    const marks = tasks.map((t) => usedMark(this.env(t).AGENT_BROWSER_PROFILE))
    return new Map(tasks.map((t, i) => [t, statSync(marks[i], { throwIfNoEntry: false })?.mtimeMs ?? 0]))
  }

  private idling = false

  /** browsers no agent command used and no one watched for longer than their task's setting: closed with their whole
   *  Chrome, sign-ins kept. Says which tasks they were */
  async closeIdle(now = Date.now()): Promise<string[]> {
    if (this.idling || !this.o.idleClose) return []
    this.idling = true
    try {
      // a task's browser runs since its newest Chrome process started
      const since = new Map<string, number>()
      for (const c of await this.chromes()) since.set(c.task, Math.max(since.get(c.task) ?? 0, Date.now() - c.age))
      const quiet = (task: string) => {
        const h = this.hubs.get(task)
        return !h?.clients.size && !h?.starting
      }
      const due = [...since.keys()].filter((t) => isTaskId(t) && this.o.idleClose!(t) !== null && quiet(t))
      if (!due.length) return []
      const used = await this.usedAt(due)
      const closed: string[] = []
      for (const t of due) {
        const h = this.hubs.get(t)
        const last = Math.max(since.get(t)!, used.get(t) ?? 0, h?.seenAt ?? 0, h?.agentAt ?? 0)
        // looked at again, or its setting changed, meanwhile
        const after = this.o.idleClose!(t)
        if (after === null || now - last < after || !quiet(t)) continue
        if (h) {
          clearTimeout(h.idle)
          this.disconnect(h)
          h.target = ''
        }
        // until it is gone, a screen opening it or the agent using it again keeps it
        const mark = used.get(t) ?? 0
        await this.end(t, async () => quiet(t) && ((await this.usedAt([t])).get(t) ?? 0) === mark)
        closed.push(t)
      }
      return closed
    } finally {
      this.idling = false
    }
  }

  /** browsers whose task is gone, stopped or done (left over from a restart, or opened again after): closed. Says
   *  which tasks they were */
  async sweep(keep: (task: string) => boolean, forget: (task: string) => boolean): Promise<string[]> {
    const open = new Set((await this.chromes()).map((c) => c.task))
    if (await this.usable()) for (const s of await this.sessions()) open.add(s)
    const closed = [...open].filter((s) => isTaskId(s) && !keep(s))
    for (const s of closed) await this.close(s, forget(s))
    return closed
  }
}

/** a Chrome process in a task's profile, and how long it has run (ms) */
type Chrome = { pid: number; task: string; age: number }

/** from ps's pid, elapsed time and command lines, the processes started with a profile under flag's folder, with that
 *  profile's task */
export function chromesIn(ps: string, flag: string): Chrome[] {
  const out: Chrome[] = []
  for (const l of ps.split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/)
    const at = m ? m[3].indexOf(flag) : -1
    if (!m || at < 0) continue
    const task = m[3].slice(at + flag.length).split(' ')[0]
    if (isTaskId(task)) out.push({ pid: Number(m[1]), task, age: elapsed(m[2]) })
  }
  return out
}

/** ps's elapsed time, [[dd-]hh:]mm:ss (Linux and macOS alike), in ms */
export function elapsed(s: string) {
  const [d, rest] = s.includes('-') ? s.split('-') : ['0', s]
  const parts = rest.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  const ms = ((Number(d) * 24 + parts[0]) * 3600 + parts[1] * 60 + parts[2]) * 1000
  return Number.isFinite(ms) ? ms : 0
}

/** a DevTools connection to the session's browser, with one flattened session per page */
class Cdp {
  private n = 0
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>()
  private attached = new Map<string, Promise<string>>()
  closed = false

  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: { targetId?: string; sessionId?: string } }
      if (m.id !== undefined) {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.error) p?.rej(new Error(m.error.message))
        else p?.res(m.result)
      } else if (m.method === 'Target.detachedFromTarget') {
        for (const [t, s] of this.attached) s.then((id) => id === m.params?.sessionId && this.attached.delete(t)).catch(() => undefined)
      }
    }
    ws.onclose = () => {
      this.closed = true
      for (const p of this.pending.values()) p.rej(new Error('The browser closed.'))
      this.pending.clear()
    }
  }

  static open(url: string) {
    return new Promise<Cdp>((res, rej) => {
      const ws = new WebSocket(url)
      const t = setTimeout(() => (ws.close(), rej(new Error('The browser did not answer.'))), 5000)
      ws.onopen = () => (clearTimeout(t), res(new Cdp(ws)))
      ws.onerror = () => (clearTimeout(t), rej(new Error('The browser did not answer.')))
    })
  }

  call(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('The browser closed.'))
    const id = ++this.n
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        rej(new Error(`The browser took too long (${method}).`))
      }, 10_000)
      this.pending.set(id, { res: (v) => (clearTimeout(t), res(v)), rej: (e) => (clearTimeout(t), rej(e)) })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  attach(targetId: string) {
    let s = this.attached.get(targetId)
    if (!s) {
      s = this.call('Target.attachToTarget', { targetId, flatten: true }).then((r) => (r as { sessionId: string }).sessionId)
      s.catch(() => this.attached.delete(targetId))
      this.attached.set(targetId, s)
    }
    return s
  }

  forget(targetId: string) {
    const s = this.attached.get(targetId)
    this.attached.delete(targetId)
    s?.then((sessionId) => this.call('Target.detachFromTarget', { sessionId })).catch(() => undefined)
  }

  close() {
    this.closed = true
    this.ws.close()
  }
}

/** the first line a process prints */
async function localCommand(argv: string[], options: { timeoutMs?: number } = {}) {
  const child = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 20_000)
  try { const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { out, err, code } }
  finally { clearTimeout(timer) }
}
