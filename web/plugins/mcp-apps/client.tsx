// MCP Apps in the chat (spec 2026-01-26): a call an agent made to an MCP tool that has a view shows that view under
// its step, the way an MCP Apps host does. The agent reached the server through herdr-mcp (service/mcp/gateway.ts),
// which kept the call; the view runs in a sandbox with no origin of its own (service/mcp-apps.ts) and talks to the
// page over postMessage (bridge.ts). A tool the view calls asks the person first (Allow once, Always, No), unless
// they said Always for that tool before.
import { useEffect, useRef, useState } from 'react'
import { definePlugin, getDraft, setDraft } from '@client/kernel.ts'
import { Btn, I, IB, cx } from '@client/ui.tsx'
import type { Chat, Message } from '@shared/types.ts'
import { Bridge, type DisplayMode, type Rpc } from './bridge.ts'
import './mcp-apps.css'

type Call = {
  id: string
  server: string
  tool: string
  def: any
  args: Record<string, unknown>
  state: 'running' | 'done' | 'error' | 'cancelled'
  result?: any
  error?: string
  view?: { uri: string; sha?: string; meta?: any; error?: string }
  live: boolean
}

type Ask = { tool: string; args: unknown; answer: (ok: 'once' | 'always' | null) => void }

/** the asks waiting, first shown: Always or No answers every one for that tool, Allow once only the first */
export function answerAsks(asks: Ask[], ok: 'once' | 'always' | null): Ask[] {
  const [first, ...rest] = asks
  if (!first) return asks
  first.answer(ok)
  if (ok === 'once') return rest
  for (const a of rest) if (a.tool === first.tool) a.answer(ok)
  return rest.filter((a) => a.tool !== first.tool)
}

const INLINE_MAX = 640

async function getJson(url: string) {
  const r = await fetch(url, { headers: { 'x-shepherdr': '1' }, cache: 'no-store' })
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `${r.status}`)
  return r.json()
}

const dark = () => {
  const t = document.documentElement.dataset.theme
  return t ? t === 'dark' || t === 'night' : matchMedia('(prefers-color-scheme: dark)').matches
}

/** words for what a view asks to run: its input, short */
const brief = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? {})
  return s.length > 160 ? `${s.slice(0, 160)}…` : s
}

function AppView({ msg, chat }: { msg: Message; chat: Chat }) {
  const id = msg.app?.id
  // a call an agent on another machine made: read there, through this service (service/mcp/remote.ts)
  const base = msg.app?.machine ? `api/mcp-apps/on/${encodeURIComponent(msg.app.machine)}/${id}` : `api/mcp-apps/${id}`
  const [call, setCall] = useState<Call | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const [near, setNear] = useState(false)
  const [height, setHeight] = useState(180)
  // a view still 0 high a while after its call ended has nothing to show for it (its own choice, as Flowbound's
  // execute with no run, table or workflow): the card folds away. Not at once: a view is 0 high while it loads.
  const [folded, setFolded] = useState(false)
  const [mode, setMode] = useState<DisplayMode>('inline')
  const [asks, setAsks] = useState<Ask[]>([])
  const ask = asks[0] ?? null
  const answer = (ok: 'once' | 'always' | null) => setAsks((l) => answerAsks(l, ok))
  const [link, setLink] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const bridge = useRef<Bridge | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

  // only once it comes near the screen: a view can be large
  useEffect(() => {
    const el = box.current
    if (!el || near) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  // the call, again every 2 s while it runs
  useEffect(() => {
    if (!id || !near) return
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const c: Call = await getJson(base)
        if (stop) return
        setCall(c)
        if (c.state === 'running' || !c.view?.sha) t = setTimeout(read, 2000)
      } catch (e) {
        if (!stop) setFail(String((e as Error).message))
      }
    }
    void read()
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [id, near])

  const sha = call?.view?.sha
  useEffect(() => {
    if (!id || !sha) return
    let stop = false
    fetch(`${base}/html`, { headers: { 'x-shepherdr': '1' } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("The view couldn't be read."))))
      .then((h) => !stop && setHtml(h))
      .catch((e) => !stop && setFail(e.message))
    return () => {
      stop = true
    }
  }, [id, sha])

  // the bridge, once the HTML is here; the call's result reaches it as it comes
  useEffect(() => {
    if (!call || html === null || !id) return
    const post = (m: Rpc) => frame.current?.contentWindow?.postMessage(m, '*')
    const context = () => {
      const w = box.current?.clientWidth ?? 600
      const full = modeRef.current === 'fullscreen'
      return {
        theme: dark() ? 'dark' : 'light',
        styles: { variables: { '--font-sans': getComputedStyle(document.body).fontFamily } },
        displayMode: modeRef.current,
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: full ? { width: innerWidth, height: innerHeight } : { width: w, maxHeight: INLINE_MAX },
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: 'Shepherdr',
        platform: matchMedia('(max-width: 700px)').matches ? 'mobile' : 'web',
        deviceCapabilities: { touch: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches },
      }
    }
    const b = new Bridge(
      post,
      { tool: call.def ?? { name: call.tool }, args: call.args, state: call.state, result: call.result, error: call.error, html, csp: call.view?.meta?.csp, permissions: call.view?.meta?.permissions?.clipboardWrite ? { clipboardWrite: {} } : {} },
      {
        async server(method, params) {
          let ok: 'once' | 'always' | undefined
          for (;;) {
            const r = await fetch(`${base}/call`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify({ method, params, ok }) })
            const j = await r.json().catch(() => ({}))
            if (j.ask) {
              const answer = await new Promise<'once' | 'always' | null>((answer) => setAsks((l) => [...l, { tool: String(params?.name ?? ''), args: params?.arguments, answer }]))
              if (!answer) throw { code: -32000, message: 'The person said no.' }
              ok = answer
              continue
            }
            if (j.error) throw j.error
            return j.result
          }
        },
        async openLink(url) {
          if (!window.open(url, '_blank', 'noopener,noreferrer')) setLink(url)
        },
        async message(text) {
          const now = getDraft(chat.key)
          setDraft(chat.key, now ? `${now}\n\n${text}` : text)
        },
        setMode(m) {
          setMode(m)
          modeRef.current = m
          return m
        },
        // a view that says 0 high has nothing to show for this call (its own choice): the card folds away
        resize(h) {
          if (h !== undefined && h >= 0) setHeight(Math.ceil(h))
        },
        context,
        close: () => setMode('inline'),
      },
    )
    bridge.current = b
    const on = (e: MessageEvent) => {
      if (e.source && e.source === frame.current?.contentWindow) void b.receive(e.data)
    }
    addEventListener('message', on)
    // the theme or the width changing reaches the view
    const ro = new ResizeObserver(() => b.contextChanged({ containerDimensions: context().containerDimensions }))
    if (box.current) ro.observe(box.current)
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const themed = () => b.contextChanged({ theme: dark() ? 'dark' : 'light' })
    mq.addEventListener('change', themed)
    const mo = new MutationObserver(themed)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      removeEventListener('message', on)
      ro.disconnect()
      mq.removeEventListener('change', themed)
      mo.disconnect()
      void b.teardown('The chat closed it.')
      bridge.current = null
    }
    // the bridge lives as long as its HTML: a result arriving later is an update, not a new view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, id])

  useEffect(() => {
    if (call) bridge.current?.update({ state: call.state, result: call.result, error: call.error })
  }, [call?.state, call?.result, call?.error])

  const done = call?.state !== undefined && call.state !== 'running'
  useEffect(() => {
    setFolded(false)
    if (height !== 0 || !done || html === null) return
    const t = setTimeout(() => setFolded(true), 1500)
    return () => clearTimeout(t)
  }, [height, done, html])

  useEffect(() => {
    if (mode !== 'fullscreen') return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMode('inline')
      modeRef.current = 'inline'
      bridge.current?.contextChanged({ displayMode: 'inline' })
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [mode])

  if (!msg.app) return null
  const name = `${msg.app.server} · ${msg.app.tool}`
  const err = fail ?? call?.view?.error ?? null
  const full = mode === 'fullscreen'
  const empty = folded && !full && !err && height === 0 && !asks.length && !link
  const toggle = () => {
    const m: DisplayMode = full ? 'inline' : 'fullscreen'
    setMode(m)
    modeRef.current = m
    if (bridge.current) bridge.current.mode = m
    bridge.current?.contextChanged({ displayMode: m })
  }
  return (
    <div ref={box} className={cx('mcpv', full && 'full', empty && 'mcpv-none', call?.view?.meta?.prefersBorder === false && 'bare')} aria-hidden={empty || undefined} data-state={call?.state}>
      <div className="mcpv-h">
        <I n="plug" c="s16" />
        <span className="mcpv-n">{name}</span>
        {call?.state === 'running' && <span className="mcpv-s">Running…</span>}
        {call && !call.live && call.state !== 'running' && <span className="mcpv-s">Read only</span>}
        <IB icon={full ? 'shrink' : 'expand'} label={full ? 'Back to the chat' : 'Full screen'} onClick={toggle} />
      </div>
      {err ? (
        <div className="mcpv-e">The view couldn't be shown: {err}</div>
      ) : (
        <div className="mcpv-b" style={full ? undefined : { height: empty ? 1 : Math.min(Math.max(height, 60), INLINE_MAX) }}>
          {near && html !== null && <iframe ref={frame} title={name} src={`${base}/sandbox`} referrerPolicy="no-referrer" />}
          {(!near || html === null) && <div className="mcpv-l">Loading the view…</div>}
        </div>
      )}
      {ask && (
        <div className="mcpv-ask" role="alertdialog" aria-label={`The view wants to use ${ask.tool}`}>
          <div className="mcpv-q">
            The view wants to use <b>{ask.tool}</b> on {msg.app.server}
            <code>{brief(ask.args)}</code>
          </div>
          <div className="acts">
            <Btn small onClick={() => answer(null)}>No</Btn>
            <Btn small onClick={() => answer('always')}>Always</Btn>
            <Btn small kind="pri" onClick={() => answer('once')}>Allow once</Btn>
          </div>
        </div>
      )}
      {link && (
        <div className="mcpv-ask">
          <div className="mcpv-q">
            The view wants to open <code>{link}</code>
          </div>
          <div className="acts">
            <Btn small onClick={() => setLink(null)}>No</Btn>
            <Btn small kind="pri" onClick={() => { window.open(link, '_blank', 'noopener,noreferrer'); setLink(null) }}>Open</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

export default definePlugin({
  name: 'mcp-apps',
  setup(reg) {
    reg.messageParts.push({ order: 45, View: AppView })
  },
})
