// Screens: an agent's browser and desktop, to watch and to take over. Every chat (its name's menu) and every open task
// (its ⋯ menu) has a Screen row beside Terminal, whether or not the agent is using them. The view opens in
// the pane (full screen on a phone): Browser and Desktop tabs, an address bar with reload on the Browser tab, the live
// picture, the machine under the title. Where the agent is not using it, it is yours and there is no bar at the
// bottom; where it is, one pinned line says who is driving with one button: Take over, then Hand back. A task whose
// agent has one open shows a small live picture in its thread; one stuck on a step only a person can do shows a
// "Needs your hands" card with Skip and Take over.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { act as call, definePlugin, getState, notice, openSettings, openTask, setUI, togglePane, tryAct, useSnap, useUI, type ScreenAt, type Thread } from '@client/kernel.ts'
import { secretDialog } from '@client/settings.tsx'
import { openMenu } from '@client/overlay.tsx'
import { Btn, cx, Hd, I, IB } from '@client/ui.tsx'
import { DoneRow } from '@plugins/chat/cards.tsx'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import { shortUrl, toUrl, type BrowserDown, type BrowserUp } from '@shared/browser.ts'
import type { Chat, ScreenInfo, Snapshot, Task } from '@shared/types.ts'
import { isEverything, machineLabel, placeOf, spaceName, taskOf, tasksIn, tstate } from '@shared/view.ts'
import { screenKey, screenRow } from './menu.ts'
import { fit, keyEvent, modifiers, toPage, type Size } from '@plugins/browser/input.ts'
import { browserPress, deskPress, enterDevice, keysymOf, leaveDevice, refit, wheelSteps, WHOLE, type Mods, type Pt, type View } from './full.ts'
import { coarse, FullBar, KeyRow, pasteFrom, Surface, TypeBox, type Remote } from './fullview.tsx'

/** the picture in full screen: how it is zoomed and moved, in a box this size */
type Full = { view: View; box: Size } | null
const zoomed = (f: Full): React.CSSProperties | undefined => (f ? { transform: `translate(${f.view.x}px, ${f.view.y}px) scale(${f.view.z})` } : undefined)

type State = Extract<BrowserDown, { type: 'state' }>
const RETRY_MS = 10_000
/** ten minutes without input hands back by itself, and says so */
const IDLE_MS = 10 * 60_000

const wsUrl = (path: string) => {
  const url = new URL(path, location.href)
  url.protocol = url.protocol.replace('http', 'ws')
  return url
}

/** whose screen: a chat's, a task's or a machine's desktop */
function partsOf(snap: Snapshot, key: string) {
  const [kind, ...rest] = key.split(':')
  const id = rest.join(':')
  const task = kind === 'task' ? taskOf(snap, id) : undefined
  const place = kind === 'chat' ? id : task?.place
  const machine = kind === 'machine' ? id : (snap.places.find((p) => p.id === place)?.machine ?? snap.host)
  return { kind: kind as 'chat' | 'task' | 'machine', id, task, place, machine }
}

/** every chat and task has a screen: where the agent isn't using one it is idle, and yours to use */
function infoOf(snap: Snapshot, key: string): ScreenInfo {
  const known = snap.screens?.[key]
  const { kind, machine } = partsOf(snap, key)
  if (kind === 'machine') return known ?? { d: { of: machine, own: false } }
  return { b: known?.b ?? { url: '' }, d: known?.d ?? { of: machine, own: !snap.config?.desktops?.includes(machine) }, ...known }
}

/* ---------- the browser's live picture ---------- */

function useLink(key: string, onFrame: (data: string, width: number) => void) {
  const [state, setState] = useState<State | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const frame = useRef(onFrame)
  frame.current = onFrame
  useEffect(() => {
    let gone = false
    let timer: ReturnType<typeof setTimeout>
    let at = 0
    const open = () => {
      at = Date.now()
      const s = new WebSocket(wsUrl(`api/screen?key=${encodeURIComponent(key)}`))
      ws.current = s
      s.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as BrowserDown
        if (m.type === 'frame') return frame.current(m.data, m.metadata.deviceWidth)
        if (m.type === 'state') setState(m)
        else if (m.type === 'error') s.close()
      }
      s.onclose = () => {
        if (!gone) timer = setTimeout(open, Math.max(500, RETRY_MS - (Date.now() - at)))
      }
    }
    open()
    return () => {
      gone = true
      clearTimeout(timer)
      ws.current?.close()
    }
  }, [key])
  const send = useCallback((m: BrowserUp) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m))
  }, [])
  return { state, send }
}

/** The page as the agent's browser draws it: the latest frame wins. Driving, your clicks, keys and touches go to it;
 *  on a phone, tapping it brings up the phone's own keyboard. */
function BrowserView({ k, drive, ring, send, state, onFrameRef, full, remoteRef }: { k: string; drive: boolean; ring: boolean; send: (m: BrowserUp) => void; state: State | null; onFrameRef: React.MutableRefObject<(data: string, width: number) => void>; full: Full; remoteRef: React.MutableRefObject<Remote | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const typed = useRef<HTMLInputElement>(null)
  const phone = useUI((u) => u.phone)
  const [page, setPage] = useState<Size>({ w: 1280, h: 800 })
  const bitmap = useRef<ImageBitmap | null>(null)
  const busy = useRef(false)
  const next = useRef<{ data: string; width: number } | null>(null)
  const [has, setHas] = useState(false)
  const pageNow = useRef(page)
  pageNow.current = page
  const zoom = useRef(1)
  zoom.current = full?.view.z ?? 1

  const draw = useCallback(() => {
    const c = canvas.current
    const b = bitmap.current
    if (!c || !b) return
    // zoomed in full screen: drawn sharper, as far as the picture has pixels
    const dpr = (devicePixelRatio || 1) * Math.min(zoom.current, 3)
    // the box takes the picture's own shape, whatever size the pane has
    c.style.aspectRatio = `${b.width} / ${b.height}`
    const w = c.clientWidth
    const h = Math.round((w * b.height) / b.width)
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.imageSmoothingQuality = 'high'
    g.drawImage(b, 0, 0, w, h)
  }, [])

  onFrameRef.current = (data, width) => {
    next.current = { data, width }
    if (busy.current) return
    busy.current = true
    void (async () => {
      while (next.current) {
        const f = next.current
        next.current = null
        try {
          const b = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${f.data}`)).blob())
          bitmap.current?.close()
          bitmap.current = b
          const w = f.width || b.width
          setPage((was) => (was.w === w && was.h === Math.round((b.height * w) / b.width) ? was : { w, h: Math.round((b.height * w) / b.width) }))
          setHas(true)
          draw()
        } catch {
          /* a broken frame: the next one will do */
        }
      }
      busy.current = false
    })()
  }
  useLayoutEffect(() => {
    const c = canvas.current
    if (!c) return
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [draw])
  useEffect(() => setHas(false), [k])
  useEffect(draw, [full?.view.z, draw])
  // full screen drives the page through this: a tap a click, a drag a drag, keys and text
  useEffect(() => {
    let held: 'left' | 'right' = 'left'
    const m = (eventType: string, at: Pt, more: Partial<Extract<BrowserUp, { type: 'input_mouse' }>> = {}) => send({ type: 'input_mouse', eventType, x: Math.round(at.x), y: Math.round(at.y), button: 'none', clickCount: 0, ...more })
    remoteRef.current = {
      pic: () => (has ? pageNow.current : null),
      act: (a) => {
        if (a.t === 'hover') return m('mouseMoved', a.at)
        if (a.t === 'down') { held = a.button; return m('mousePressed', a.at, { button: a.button, clickCount: a.count ?? 1, buttons: a.button === 'right' ? 2 : 1 }) }
        if (a.t === 'move') return m('mouseMoved', a.at, { button: held, buttons: held === 'right' ? 2 : 1 })
        if (a.t === 'up') return m('mouseReleased', a.at, { button: a.button, clickCount: a.count ?? 1 })
        if (a.t === 'scroll') return m('mouseWheel', a.at, { deltaX: a.dx, deltaY: a.dy })
        if (a.t === 'click') {
          m('mouseMoved', a.at)
          m('mousePressed', a.at, { button: a.button, clickCount: a.count, buttons: a.button === 'right' ? 2 : 1 })
          m('mouseReleased', a.at, { button: a.button, clickCount: a.count })
        }
      },
      press: (key, mods) => browserPress(key, mods).forEach(send),
      text: (text) => send({ type: 'text', text }),
    }
    return () => { remoteRef.current = null }
  }, [send, has])

  const at = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    return toPage({ x: e.clientX - r.left, y: e.clientY - r.top }, fit({ w: r.width, h: r.height }, page), page)
  }
  const mouse = (eventType: string, e: React.MouseEvent, more: Partial<Extract<BrowserUp, { type: 'input_mouse' }>> = {}) => {
    const p = at(e)
    if (p && drive) send({ type: 'input_mouse', eventType, x: p.x, y: p.y, button: e.button === 2 ? 'right' : 'left', clickCount: 1, modifiers: modifiers(e), ...more })
  }
  const touch = (eventType: string, e: React.TouchEvent) => {
    if (!drive) return
    const pts = Array.from(e.touches).map((t) => at(t)).filter((p): p is { x: number; y: number } => !!p)
    send({ type: 'input_touch', eventType, touchPoints: pts })
    if (eventType === 'touchEnd' && phone) typed.current?.focus({ preventScroll: true })
  }
  const blank = !has && !state?.url
  const r = full ? fit(full.box, page) : null
  return (
    <div className={cx('scr', ring && 'drive', blank && 'idle', full && 'full')} style={zoomed(full)} tabIndex={drive ? 0 : -1} onKeyDown={(e) => { if (!drive || e.target !== e.currentTarget) return; const k1 = keyEvent(e.nativeEvent, 'keyDown'); if (k1) { e.preventDefault(); send(k1) } }} onKeyUp={(e) => { if (!drive || e.target !== e.currentTarget) return; const k1 = keyEvent(e.nativeEvent, 'keyUp'); if (k1) send(k1) }}>
      <canvas
        ref={canvas}
        aria-label={drive ? 'Live view. Click and type' : 'Live view'}
        style={{ display: blank ? 'none' : 'block', ...(r ? { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h } : {}) }}
        onMouseDown={(e) => { e.currentTarget.parentElement?.focus(); mouse('mousePressed', e) }}
        onMouseUp={(e) => mouse('mouseReleased', e)}
        onMouseMove={(e) => e.buttons && mouse('mouseMoved', e, { button: 'none' })}
        onWheel={(e) => mouse('mouseWheel', e, { deltaX: e.deltaX, deltaY: e.deltaY, button: 'none' })}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={(e) => touch('touchStart', e)}
        onTouchMove={(e) => touch('touchMove', e)}
        onTouchEnd={(e) => touch('touchEnd', e)}
      />
      {/* why there is no page to show (its machine can't be reached, its tool isn't there), in its own line */}
      {blank && state?.error && <div className="empty desk-why" role="status"><b>{state.error}</b><span>Shepherdr looks again by itself.</span></div>}
      {/* a phone's own keyboard types into the page through this box */}
      {drive && phone && !full && <input ref={typed} aria-label="Type into the page" autoCapitalize="off" autoCorrect="off" style={{ position: 'absolute', opacity: 0, width: 1, height: 1, bottom: 0 }} onChange={(e) => { const t = e.target.value; e.target.value = ''; if (t) send({ type: 'text', text: t }) }} onKeyDown={(e) => { const k1 = e.key.length > 1 ? keyEvent(e.nativeEvent, 'keyDown') : null; if (k1) send(k1) }} />}
      {!drive && !full && <button type="button" className="veil" aria-label="Live view. Take over to click and type" onClick={() => notice('Take over to click and type')} />}
    </div>
  )
}

/** The fictional day has a small interactive stand-in for its sign-in and desktop. */
function DemoPicture({ k, drive, desktop, idle, onContinued }: { k: string; drive: boolean; desktop: boolean; idle: boolean; onContinued(): void }) {
  const [code, setCode] = useState('')
  const [continued, setContinued] = useState(false)
  const [paid, setPaid] = useState(false)
  const phone = useUI((u) => u.phone)
  const login = k.includes('SHOP-17') && !desktop
  const line: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e5e5e5', padding: '8px 0' }
  const primary: React.CSSProperties = { width: '100%', height: 40, border: 0, borderRadius: 6, background: '#171717', color: '#fff', font: 'inherit', fontWeight: 500 }
  return <div className="scr" style={{ position: 'relative', aspectRatio: phone ? '4 / 3' : '16 / 10', background: desktop ? '#52525b' : '#fff', boxShadow: !desktop && idle ? 'none' : undefined, color: '#171717', fontSize: phone ? 14 : 13, lineHeight: 1.4, overflow: 'hidden' }}>
    {desktop ? <><div style={{ background: '#e5e5e5', padding: '4px 12px', fontSize: 11 }}>Simulator　 File　 Edit <span style={{ float: 'right' }}>9:41</span></div><div style={{ background: '#fff', margin: '8% auto', width: '62%', borderRadius: 8, overflow: 'hidden' }}><div style={{ background: '#f5f5f5', padding: '6px 10px' }}>● ● ●　 garden-app</div><div style={{ padding: '12px 16px' }}><strong>Today</strong><div style={line}><span>Water the tomatoes</span><span>18:00</span></div><div style={line}><span>Feed the roses</span><span>19:30</span></div></div></div></> : !idle && login && !continued ? <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(80%, 280px)', display: 'grid', gap: 10 }}><strong style={{ fontSize: '1.25em' }}>Check your phone</strong><span style={{ color: '#525252' }}>Enter the 6-digit code we sent you.</span><input aria-label="Sign-in code" inputMode="numeric" placeholder="000000" disabled={!drive} value={code} onChange={(e) => setCode(e.target.value)} style={{ height: 40, padding: '0 10px', border: '1px solid #d4d4d4', borderRadius: 6, background: '#fff', color: '#171717', font: 'inherit' }} /><button type="button" disabled={!drive} onClick={() => { setContinued(true); onContinued() }} style={primary}>Continue</button></div> : !idle ? <div style={{ padding: '20px' }}><strong style={{ fontSize: '1.25em' }}>{continued ? 'Invoices' : 'Your basket'}</strong>{(continued ? [['October 2026', '€1,240.00'], ['September 2026', '€980.00'], ['August 2026', '€1,105.00']] : [['Garden gloves', '€12.00'], ['Total', '€12.00']]).map(([label, value]) => <div key={label} style={line}><span>{label}</span><span>{value}</span></div>)}{!continued && <button type="button" disabled={!drive} onClick={() => setPaid(true)} style={primary}>{paid ? 'Paid' : 'Pay now'}</button>}</div> : null}
    {!drive && <button type="button" className="veil" aria-label="Live view. Take over to click and type" onClick={() => notice('Take over to click and type')} />}
  </div>
}

/* ---------- the desktop's live picture ---------- */

/** Why a desktop can't be shown (the service's screen › check), in its own plain line. */
type Check = { ok: true } | { ok: false; code: string; why: string }
/** the secret a Mac's Screen Sharing password is kept in (service/screens.ts SCREEN_PASSWORD) */
const PASSWORD = 'SCREEN_SHARING_PASSWORD'
/** what the person can do about each reason: the steps, the button that fixes it, and whether it is looked at again
 *  by itself (and how often) */
function fixOf(code: string, onMac: string): { steps?: string[]; fix?: 'password' | 'machines'; again?: number } {
  const set = `Back here, tap Set the password: it is kept as the secret ${PASSWORD}, hidden, and never shown.`
  const allow = `For agents to click and type there, also allow Accessibility and Screen Recording on ${onMac}: run agent-desktop permissions there.`
  switch (code) {
    case 'starting': return { again: 1000 }
    case 'offline': return { again: 5000 }
    case 'gone': return { again: 3000 }
    case 'sharing-off': return { steps: [`On ${onMac}, open System Settings › General › Sharing and turn on Screen Sharing.`], again: 5000 }
    case 'mac-auth': return {
      steps: [`On ${onMac}, open System Settings › General › Sharing and tap the ⓘ button beside Screen Sharing.`, 'Turn on “VNC viewers may control screen with password” and choose a password.', set, allow],
      fix: 'password',
    }
    case 'password': return { steps: ['Use the password from “VNC viewers may control screen with password” (System Settings › General › Sharing, the ⓘ beside Screen Sharing).', set, allow], fix: 'password' }
    case 'password-wrong': return { steps: [`Set it again: it must match the one in ${onMac}'s Screen Sharing settings (the ⓘ button).`], fix: 'password' }
    case 'missing': return { steps: ['Install TigerVNC there: sudo apt install tigervnc-standalone-server'] }
    case 'no-tool': return { steps: ["It arrives with that machine's next tools update from Shepherdr."], again: 30_000 }
    default: return {}
  }
}

/** what full screen drives on a desktop: pointer events straight to the screen client's link, in the remote's own px
 *  (noVNC's own mouse handling reads its canvas, which full screen zooms), wheel steps for a scroll, and X keys */
type Rfb = import('@novnc/novnc').default & { _fbWidth?: number; _fbHeight?: number; _sock?: unknown; _rfbConnectionState?: string; _viewOnly?: boolean }
function deskRemote(r: Rfb): Remote {
  let mask = 0
  let carry: Pt = { x: 0, y: 0 }
  const send = (at: Pt, m: number) => {
    const msgs = (r.constructor as unknown as { messages?: { pointerEvent(sock: unknown, x: number, y: number, mask: number): void } }).messages
    if (r._rfbConnectionState !== 'connected' || r._viewOnly || !msgs) return
    msgs.pointerEvent(r._sock, Math.max(0, Math.round(at.x)), Math.max(0, Math.round(at.y)), m)
  }
  const bit = (b: 'left' | 'right') => (b === 'right' ? 4 : 1)
  return {
    pic: () => (r._fbWidth && r._fbHeight ? { w: r._fbWidth, h: r._fbHeight } : null),
    act: (a) => {
      if (a.t === 'hover' || a.t === 'move') return send(a.at, mask)
      if (a.t === 'down') return send(a.at, (mask |= bit(a.button)))
      if (a.t === 'up') return send(a.at, (mask &= ~bit(a.button)))
      if (a.t === 'click') {
        send(a.at, 0)
        for (let i = 0; i < a.count; i++) { send(a.at, bit(a.button)); send(a.at, 0) }
        mask = 0
        return
      }
      if (a.t === 'scroll') {
        const s = wheelSteps(carry, a.dx, a.dy)
        carry = s.carry
        // buttons 4 and 5 scroll up and down, 6 and 7 left and right
        const step = (b: number, n: number) => { for (let i = 0; i < n; i++) { send(a.at, mask | b); send(a.at, mask) } }
        step(s.y > 0 ? 16 : 8, Math.abs(s.y))
        step(s.x > 0 ? 64 : 32, Math.abs(s.x))
      }
    },
    press: (key, mods) => deskPress(key, mods).forEach(([sym, code, down]) => r.sendKey(sym, code, down)),
    text: (t) => { for (const ch of t) ch === '\n' ? r.sendKey(0xff0d, 'Enter') : r.sendKey(keysymOf(ch), null) },
  }
}

/** A desktop, drawn by a screen client (VNC) through Shepherdr's own connection. On a phone: pinch to zoom, drag to
 *  pan, tap to click, long-press to right-click, and a keyboard button with the extra keys. Before it connects, the
 *  service says whether it can be shown: its own display is started when it has none ("Starting the desktop…"), and
 *  a reason it can't gets its own line with what fixes it. It connects again by itself when the display comes back. */
function DesktopView({ k, drive, ring, apiRef, busy, onMac, full, remoteRef }: { k: string; drive: boolean; ring: boolean; apiRef: React.MutableRefObject<{ paste(t: string): void; shot(): string | null } | null>; busy?: string; onMac: string; full: Full; remoteRef: React.MutableRefObject<Remote | null> }) {
  const snap = useSnap()
  const host = useRef<HTMLDivElement>(null)
  const typed = useRef<HTMLInputElement>(null)
  const rfb = useRef<import('@novnc/novnc').default | null>(null)
  const phone = useUI((u) => u.phone)
  const [status, setStatus] = useState<Check | 'opening' | 'live'>('opening')
  // a new try: the Try again button, a password just set
  const [tries, setTries] = useState(0)
  const [watchAnyway, setWatchAnyway] = useState(false)
  const held = !!busy && !watchAnyway
  useEffect(() => {
    if (held) return
    let gone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = (f: () => void, ms: number) => { clearTimeout(timer); timer = setTimeout(f, ms) }
    const check = async () => {
      if (gone) return
      let c: Check
      try { c = await call<Check>({ type: 'screen', key: k, op: 'check' }) } catch { c = { ok: false, code: 'down', why: "Shepherdr can't be reached right now." } }
      if (gone) return
      if (c.ok) return void connect()
      setStatus(c)
      const again = c.code === 'down' ? 5000 : fixOf(c.code, onMac).again
      if (again) later(() => void check(), again)
    }
    const connect = () => void import('@novnc/novnc').then(({ default: RFB }) => {
      if (gone || !host.current) return
      const r = new RFB(host.current, wsUrl(`api/desktop?key=${encodeURIComponent(k)}`).href, { wsProtocols: ['binary'] })
      r.scaleViewport = true
      r.background = 'transparent'
      r.viewOnly = true
      r.addEventListener('connect', () => setStatus('live'))
      // the display went (or never came): ask why, and connect again once it is back
      r.addEventListener('disconnect', () => {
        if (rfb.current === r) { rfb.current = null; apiRef.current = null; remoteRef.current = null }
        if (gone) return
        setStatus('opening')
        later(() => void check(), 1000)
      })
      rfb.current = r
      apiRef.current = { paste: (t) => r.clipboardPasteFrom(t), shot: () => { try { return r.toDataURL('image/png') } catch { return null } } }
      remoteRef.current = deskRemote(r)
    })
    setStatus('opening')
    void check()
    return () => {
      gone = true
      clearTimeout(timer)
      rfb.current?.disconnect()
      rfb.current = null
      apiRef.current = null
      remoteRef.current = null
    }
  }, [k, tries, held])
  useEffect(() => {
    if (rfb.current) rfb.current.viewOnly = !drive
  }, [drive, status])
  const failed = typeof status === 'object' && !status.ok ? status : null
  const fx = failed ? fixOf(failed.code, onMac) : null
  const setPassword = () => { if (snap) secretDialog(snap, 'all', PASSWORD, 'all', { fresh: !snap.config?.secrets.some((x) => x.name === PASSWORD), done: () => setTries((n) => n + 1) }) }
  // X keysyms of the extra keys a phone's keyboard lacks
  const KEYS: [string, number, string][] = [['esc', 0xff1b, 'Escape'], ['tab', 0xff09, 'Tab'], ['←', 0xff51, 'ArrowLeft'], ['↑', 0xff52, 'ArrowUp'], ['↓', 0xff54, 'ArrowDown'], ['→', 0xff53, 'ArrowRight']]
  return (
    <>
      <div className={cx('scr', ring && 'drive', full && 'full')} style={full ? zoomed(full) : { aspectRatio: held || (failed && failed.code !== 'starting') ? undefined : phone ? '4/3' : '16/10' }}>
        <div ref={host} style={{ position: 'absolute', inset: 0 }} />
        {held ? (
          <div className="empty desk-why flow" role="status">
            <b>{busy} is using this Mac's screen now.</b>
            <span>The Mac has one screen, so agents take turns. This one's turn comes when it's done.</span>
            <div className="acts"><Btn small onClick={() => setWatchAnyway(true)}>Watch anyway</Btn></div>
          </div>
        ) : status === 'opening' ? (
          <div className="empty desk-why" role="status"><span>Opening the desktop…</span></div>
        ) : failed?.code === 'starting' ? (
          <div className="empty desk-why" role="status"><span>{failed.why}</span></div>
        ) : failed ? (
          <div className="empty desk-why flow" role="status">
            <b>{failed.why}</b>
            {fx?.steps && (fx.steps.length > 1 ? <ol>{fx.steps.map((t) => <li key={t}>{t}</li>)}</ol> : <span>{fx.steps[0]}</span>)}
            {fx?.again && failed.code !== 'starting' && <span>Shepherdr looks again by itself.</span>}
            <div className="acts">
              {fx?.fix === 'password' && <Btn small kind="pri" onClick={setPassword}>Set the password</Btn>}
              {/needs you to log in/.test(failed.why) && <Btn small onClick={() => { setUI({ pane: null }); openSettings('all', 'Machines') }}>Open Machines</Btn>}
              {!['elsewhere', 'no-screen'].includes(failed.code) && <Btn small onClick={() => setTries((n) => n + 1)}>Try again</Btn>}
            </div>
          </div>
        ) : null}
        {!drive && !full && status === 'live' && <button type="button" className="veil" aria-label="Live view. Take over to click and type" onClick={() => notice('Take over to click and type')} />}
      </div>
      {drive && phone && !full && status === 'live' && (
        <div className="keys" style={{ background: 'none', padding: '8px 0 0' }}>
          <button type="button" aria-label="Keyboard" style={{ background: 'var(--control)', color: 'var(--fg)' }} onClick={() => typed.current?.focus()}><I n="term" c="s16" /></button>
          {KEYS.map(([l, sym, code]) => <button type="button" key={code} aria-label={`${code} key`} style={{ background: 'var(--control)', color: 'var(--fg)' }} onClick={() => rfb.current?.sendKey(sym, code)}>{l}</button>)}
          <input ref={typed} aria-label="Type into the desktop" autoCapitalize="off" autoCorrect="off" style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} onChange={(e) => { const t = e.target.value; e.target.value = ''; for (const ch of t) rfb.current?.sendKey(ch.codePointAt(0)!, null) }} onKeyDown={(e) => { if (e.key === 'Enter') rfb.current?.sendKey(0xff0d, 'Enter'); else if (e.key === 'Backspace') rfb.current?.sendKey(0xff08, 'Backspace') }} />
        </div>
      )}
    </>
  )
}

/* ---------- the Screen view ---------- */

const act = (key: string, op: string, more: Record<string, unknown> = {}) => tryAct({ type: 'screen', key, op, ...more })

function ScreenPane() {
  const snap = useSnap()
  const ui = useUI()
  const scr = ui.scr
  const frame = useRef<(data: string, width: number) => void>(() => undefined)
  const desk = useRef<{ paste(t: string): void; shot(): string | null } | null>(null)
  const { state, send } = useLink(scr?.key ?? '', (d, w) => frame.current(d, w))
  const [addr, setAddr] = useState<string | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setAddr(null), [scr?.key, state?.url])

  // full screen: the picture fills the device, zoomed by hand; the keyboard types into it
  const full = ui.scrFull && !!scr
  const remote = useRef<Remote | null>(null)
  const driveNow = useRef(false)
  // what the full screen's touches and keys reach: nothing remote until Take over
  const gate = useRef<Remote>({
    pic: () => remote.current?.pic() ?? null,
    act: (a) => { if (driveNow.current) remote.current?.act(a) },
    press: (k1, m) => { if (driveNow.current) remote.current?.press(k1, m) },
    text: (t) => { if (driveNow.current) remote.current?.text(t) },
  })
  const boxEl = useRef<HTMLDivElement>(null)
  const typing = useRef<HTMLInputElement>(null)
  const spot = useRef<Pt | null>(null)
  const device = useRef(false)
  const [box, setBox] = useState<Size>({ w: 0, h: 0 })
  const [view, setView] = useState<View>(WHOLE)
  const [barOn, setBarOn] = useState(true)
  const [kb, setKb] = useState(false)
  const [rowOn, setRowOn] = useState(false)
  const [armed, setArmed] = useState<Mods>({})
  useEffect(() => setView(WHOLE), [scr?.key, scr?.src])
  // turned: the whole picture again; the keyboard came or went: the same size, the spot last touched in view
  useLayoutEffect(() => {
    const el = boxEl.current
    if (!full || !el) return
    let was: Size = { w: 0, h: 0 }
    const ro = new ResizeObserver(() => {
      const now = { w: el.clientWidth, h: el.clientHeight }
      const pic = gate.current.pic()
      setView((v) => (pic ? refit(v, was, now, pic, spot.current) : WHOLE))
      was = now
      setBox(now)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [full])
  const leaveFull = () => {
    const st = history.state as { step?: { scrFull?: boolean } } | null
    if (st?.step?.scrFull) history.back()
    else setUI({ scrFull: false })
  }
  const enterFull = () => {
    setUI({ scrFull: true })
    setBarOn(true)
    // the browser's own full screen where it allows it; a real keyboard's Esc and shortcuts then reach the screen
    void enterDevice().then((ok) => {
      device.current = ok
      const kl = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard
      if (ok && !coarse()) kl?.lock?.().catch(() => undefined)
    })
  }
  useEffect(() => {
    if (full) {
      // a computer's keyboard types into the screen at once; a phone's comes up with the keyboard button
      if (!coarse()) setTimeout(() => typing.current?.focus({ preventScroll: true }), 0)
      // the browser's full screen ended (Esc, the system's Back): the view leaves it too
      const off = () => {
        if (document.fullscreenElement || !device.current) return
        device.current = false
        if (getState().ui.scrFull) leaveFull()
      }
      document.addEventListener('fullscreenchange', off)
      return () => document.removeEventListener('fullscreenchange', off)
    }
    device.current = false
    ;(navigator as Navigator & { keyboard?: { unlock?: () => void } }).keyboard?.unlock?.()
    void leaveDevice()
    setKb(false)
    setRowOn(false)
    setArmed({})
    setView(WHOLE)
  }, [full])
  // the Screen view closed while full: full screen goes with it
  useEffect(() => () => { if (getState().ui.scrFull) setUI({ scrFull: false }) }, [])
  if (!snap || !scr) return null
  const k = scr.key
  const sc = infoOf(snap, k)
  const { kind, id, task: t, place, machine } = partsOf(snap, k)
  const ph = ui.phone
  const src: 'b' | 'd' = sc[scr.src] ? scr.src : sc.b ? 'b' : 'd'
  const hands = !!sc.hands && !sc.hands.settled
  const busy = src === 'd' && !!sc.d?.busy
  const isIdle = !sc.active && !hands && !busy
  const driving = scr.drive || state?.driver === 'you'
  const drive = driving || isIdle
  driveNow.current = drive
  const setScr = (p: Partial<ScreenAt>) => setUI({ scr: { ...scr, ...p } })
  const mach = machineLabel(snap, sc.d?.of ?? machine)
  const sub = (kind === 'chat' ? `${place && !isEverything(snap, place) ? ((p) => (p ? (spaceName(snap, p) === '~' ? '~' : `#${p.name}`) : ''))(placeOf(snap, place)) : 'Everything'} on ${mach}` : kind === 'machine' ? '' : mach) + (src === 'd' ? `${kind === 'machine' ? '' : ' · '}${sc.d?.own ? 'its own desktop' : 'shared desktop'}` : '')
  const back = () => {
    if (kind === 'task') setUI({ pane: 'tasks', task: id })
    else if (kind === 'machine') { setUI({ pane: null }); openSettings('all', 'Machines') }
    else setUI({ pane: null })
  }
  const take = () => {
    setScr({ drive: true })
    if (src === 'b') send({ type: 'take' })
    void act(k, 'take', { src })
    bump()
  }
  const handBack = (said?: string) => {
    if (idle.current) clearTimeout(idle.current)
    setScr({ drive: false })
    if (src === 'b') send({ type: 'handback' })
    // Hand back (or "I'm done") clears the flag and tells the agent to look again and carry on
    void act(k, 'handback', { src, done: hands }).then((ok) => ok && notice(said ?? 'Handed back to the agent'))
    if (hands && t) setUI({ pane: 'tasks', task: t.id })
  }
  const bump = () => {
    if (idle.current) clearTimeout(idle.current)
    idle.current = setTimeout(() => getState().ui.scr?.drive && handBack('Handed back after 10 minutes without input'), IDLE_MS)
  }
  const shot = async () => {
    const data = src === 'd' ? desk.current?.shot() : document.querySelector<HTMLCanvasElement>('.pane .scr canvas')?.toDataURL('image/png')
    if (!data) return notice('There is no picture to save yet.')
    if (kind === 'task') return void act(k, 'shot', { src, data }).then((ok) => ok && notice('Saved to the task'))
    const a = document.createElement('a')
    a.href = data
    a.download = 'screen.png'
    a.click()
    notice('Saved')
  }
  const menu = (anchor: Element) =>
    openMenu(anchor, [
      { icon: 'expand', label: 'Full screen', run: enterFull },
      { icon: 'ext', label: 'Open in a new tab', run: () => void window.open(`?pane=screen&screen=${encodeURIComponent(k)}`, '_blank', 'noopener') },
      { icon: 'copy', label: 'Paste from your clipboard', run: () => void navigator.clipboard?.readText().then((text) => { if (!drive) return notice('Take over to paste'); if (src === 'd') desk.current?.paste(text); else send({ type: 'text', text }); notice('Pasted') }).catch(() => notice('This browser did not let Shepherdr read your clipboard.')) },
      // a site that refuses an automated browser: the same address in a normal browser on that agent's desktop
      ...(src === 'b' ? [{ icon: 'screen' as const, label: 'Open on the desktop instead', run: () => void act(k, 'desktop', { url: state?.url ?? sc.b?.url ?? '' }).then((ok) => ok && setScr({ src: 'd' })) }] : []),
      { icon: 'doc', label: kind === 'task' ? 'Save a screenshot to the task' : 'Save a screenshot', run: () => void shot() },
    ])
  const url = addr ?? shortUrl(state?.url ?? sc.b?.url ?? '')
  const fullAt: Full = full && box.w ? { view, box } : null
  return (
    <PaneFrame
      head={(scd) => (
        <Hd back={kind === 'task' || ph ? { label: kind === 'task' ? 'Back to the task' : 'Back', run: back } : undefined} title={t ? t.name : kind === 'chat' ? 'Screen' : mach} sub={sub} pad={kind === 'task' || ph ? undefined : 4} scrolled={scd}>
          <IB icon="expand" label="Full screen" onClick={enterFull} />
          <IB icon="dots" label="More" aria-haspopup="menu" onClick={(e) => menu(e.currentTarget)} />
          {!ph && <IB icon="x" label="Close" onClick={() => togglePane(null)} />}
        </Hd>
      )}
      foot={
        isIdle ? undefined : (
          <div className="sbar">
            <span className="who">
              <i className={cx('dot', driving ? 'you' : hands ? 'ask' : '')} />
              {driving ? "You're driving" : hands ? 'Waiting for you' : busy ? `“${sc.d!.busy}” is using it` : 'The agent is driving'}
            </span>
            {driving ? <Btn kind="pri" onClick={() => handBack()}>{hands ? "I'm done" : 'Hand back'}</Btn> : <Btn kind={hands ? 'pri' : undefined} onClick={take}>Take over</Btn>}
          </div>
        )
      }
    >
      {sc.b && sc.d && (
        <div className="tabs" role="tablist" style={{ paddingInline: 0 }}>
          {([['b', 'Browser'], ['d', 'Desktop']] as const).map(([s, label]) => (
            <button type="button" key={s} className="tab" role="tab" aria-selected={src === s} aria-pressed={src === s} onClick={() => setScr({ src: s })}>{label}</button>
          ))}
        </div>
      )}
      {src === 'b' && (
        <div className="addr">
          <IB icon="reload" label="Reload" onClick={() => send({ type: 'reload' })} />
          <input className="inp" name="addr" aria-label="Address" placeholder="Search or type an address" value={url} autoComplete="off" autoCapitalize="off" enterKeyHint="go" disabled={!drive} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Enter' || !url.trim()) return; send({ type: 'go', url: toUrl(url) }); bump(); e.currentTarget.blur() }} />
        </div>
      )}
      {/* the same picture in the pane and in full screen (never connected again): full screen only wraps it */}
      <div className={full ? 'scrfull' : undefined} onPointerDown={bump} onKeyDown={bump}>
        <div ref={boxEl} className={full ? 'fbox' : undefined}>
          {snap.demo ? <DemoPicture key={`${k}:${src}`} k={k} drive={drive} desktop={src === 'd'} idle={isIdle && src === 'b'} onContinued={() => setAddr('billing.example.com/invoices')} /> : src === 'b' ? <BrowserView k={k} drive={drive} ring={driving} send={send} state={state} onFrameRef={frame} full={fullAt} remoteRef={remote} /> : <DesktopView k={k} drive={drive} ring={driving} apiRef={desk} busy={sc.d?.busy} onMac={sc.d?.own === false && machine !== snap.host ? mach : 'the Mac'} full={fullAt} remoteRef={remote} />}
          {full && !snap.demo ? <Surface remote={gate} drive={drive} view={view} setView={setView} box={box} spot={spot} typing={typing} onBlocked={() => { setBarOn(true); notice('Take over to click and type') }} /> : null}
          {full ? (
            <FullBar
              shown={barOn}
              setShown={setBarOn}
              close={leaveFull}
              title={t ? t.name : src === 'b' ? shortUrl(state?.url ?? '') : mach}
              addr={src === 'b' ? (
                <div className="addr faddr">
                  <IB icon="reload" label="Reload" onClick={() => send({ type: 'reload' })} />
                  <input className="inp" name="faddr" aria-label="Address" placeholder="Search or type an address" value={url} autoComplete="off" autoCapitalize="off" enterKeyHint="go" disabled={!drive} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Enter' || !url.trim()) return; send({ type: 'go', url: toUrl(url) }); bump(); e.currentTarget.blur() }} />
                </div>
              ) : undefined}
              canType={drive}
              kb={coarse() ? kb : rowOn}
              keyboard={() => {
                if (!coarse()) { setRowOn(!rowOn); typing.current?.focus({ preventScroll: true }); return }
                if (kb) typing.current?.blur()
                else typing.current?.focus({ preventScroll: true })
              }}
              driving={driving}
              hands={hands}
              idle={isIdle}
              take={take}
              handBack={() => handBack()}
            />
          ) : null}
        </div>
        {full && drive && (coarse() ? kb : rowOn) ? <KeyRow remote={gate} armed={armed} setArmed={setArmed} desk={src === 'd'} mac={sc.d?.own === false} paste={() => pasteFrom(gate)} /> : null}
        {full && drive ? <TypeBox remote={gate} armed={armed} setArmed={setArmed} onFocus={setKb} inputRef={typing} /> : null}
      </div>
    </PaneFrame>
  )
}

const openScreen = (key: string, drive = false) => {
  const snap = getState().snap
  const sc = snap ? infoOf(snap, key) : {}
  setUI({ scr: { key, src: sc.b ? 'b' : 'd', drive }, pane: 'screen', settings: null, drawer: false, art: null, task: key.startsWith('task:') ? key.slice(5) : null })
}

/* ---------- in a thread: the small live picture, and Needs your hands ---------- */

const shotUrl = (key: string, src: 'b' | 'd') => `api/screen/shot?key=${encodeURIComponent(key)}&src=${src}`

/** the picture now, read again every few seconds while it shows */
function Thumb({ k, src }: { k: string; src: 'b' | 'd' }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setN((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  return (
    <button type="button" className="thumb" aria-label="Open the live view" onClick={() => openScreen(k)}>
      <img src={`${shotUrl(k, src)}&n=${n}`} alt="" />
    </button>
  )
}

function HandsCard({ k, sc, t, ref_ }: { k: string; sc: ScreenInfo; t: Task; ref_: boolean }) {
  if (sc.hands!.settled) return ref_ ? null : <DoneRow>{sc.hands!.settled === 'skip' ? 'You skipped this' : 'You did this step'}</DoneRow>
  return (
    <>
      {ref_ && <button type="button" className="ref" onClick={() => openTask(t.id)}><StatusIcon t={t} time="side" /><span>{t.name}</span></button>}
      <div className="card" data-card={`hands:${t.id}`}>
        <span className="t">Needs your hands</span>
        <span className="s">{sc.hands!.what}{sc.b?.url ? ` · ${shortUrl(sc.b.url)}` : ''}</span>
        {(sc.b || sc.d) && <Thumb k={k} src={sc.b ? 'b' : 'd'} />}
        <div className="acts">
          {/* Skip tells the agent to find another way */}
          <Btn onClick={() => void act(k, 'skip')}>Skip</Btn>
          <Btn kind="pri" onClick={() => { openScreen(k, true); void act(k, 'take', { src: sc.b ? 'b' : 'd' }) }}>Take over</Btn>
        </div>
      </div>
    </>
  )
}

/** the small live picture while its task works: an aside under the newest message, as the working sign */
function InThread({ thread }: { chat: Chat | undefined; thread: Thread }) {
  const snap = useSnap()
  if (!snap || !thread.task) return null
  const t = thread.task
  const k = `task:${t.id}`
  const sc = snap.screens?.[k]
  if (!sc || sc.hands || tstate(t) !== 'working' || !sc.active) return null
  const src = sc.b ? 'b' : 'd'
  return (
    <div className="card live">
      <Thumb k={k} src={src} />
      <span className="s"><i className="dot" />{src === 'b' ? `Browser · ${shortUrl(sc.b!.url)}` : `Desktop · ${machineLabel(snap, sc.d!.of)}`}</span>
    </div>
  )
}

/** Needs your hands: a card where it was asked among the messages, never held at the end (SHEP-419) */
export function handsCards(snap: Snapshot, thread: Thread) {
  const list = thread.task ? [thread.task] : tasksIn(snap, thread.place).filter((t) => !t.archived)
  return list.flatMap((t) => {
    const k = `task:${t.id}`
    const sc = snap.screens?.[k]
    if (!sc?.hands || (!thread.task && sc.hands.settled)) return []
    return [{ key: `hands:${t.id}`, at: t.needsAt ?? t.needsAtWas, node: <HandsCard k={k} sc={sc} t={t} ref_={!thread.task} /> }]
  })
}

export default definePlugin({
  name: 'screens',
  setup(reg) {
    reg.spaceMenu.push({ order: 6, rows: (p, head) => (head ? [screenRow(getState().ui, screenKey(p.id), openScreen)] : []) })
    reg.taskMenu.push({ order: 6, rows: (t, where) => (where === 'thread' ? [screenRow(getState().ui, screenKey(t.place, t.id), openScreen)] : []) })
    reg.panes.push({ id: 'screen', View: ScreenPane })
    reg.chatTail.push({ order: 30, View: InThread })
    reg.chatCards.push({ order: 30, cards: handsCards })
    reg.taskMenu.push({ order: 20, rows: (t, where) => (where === 'row' ? [{ icon: 'screen', label: 'Show screen', run: () => openScreen(`task:${t.id}`) }] : []) })
  },
})
