// The Screen view in full screen: the touch layer over the live picture, the slim bar on top (close, the address and
// reload on the Browser, the keyboard, Take over or Hand back) that hides itself, and the row of keys a phone's keyboard
// lacks. The picture itself stays the Browser's or the Desktop's own view, so going full screen never reconnects it.
import { useEffect, useRef, useState } from 'react'
import { notice } from '@client/kernel.ts'
import { Btn, IB } from '@client/ui.tsx'
import type { Size } from '@plugins/browser/input.ts'
import { chords, gestures, HOLD_MS, KEY_ROW, MOD_ROW, SENTINEL, SPECIAL, toRemote, typed, zoomAt, panBy, type Act, type Mod, type Mods, type Pt, type View } from './full.ts'

/** what the full screen view drives: the remote browser or desktop under the picture */
export type Remote = {
  /** the remote screen's size, its own px (none before the first picture) */
  pic(): Size | null
  /** a pointer act at a remote point */
  act(a: Act | { t: 'hover'; at: Pt }): void
  /** one key, with the modifiers held */
  press(key: string, m: Mods): void
  text(t: string): void
}

export const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/** The touch (and mouse) layer over the picture: gestures in box px, acts out to the remote or to the view. */
export function Surface({ remote, drive, view, setView, box, onBlocked, spot, typing }: { remote: React.RefObject<Remote | null>; drive: boolean; view: View; setView(v: View): void; box: Size; onBlocked(): void; spot: React.MutableRefObject<Pt | null>; typing: React.RefObject<HTMLInputElement | null> }) {
  const el = useRef<HTMLDivElement>(null)
  const g = useRef(gestures())
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const now = useRef({ view, drive, box })
  now.current = { view, drive, box }
  const lastHover = useRef(0)
  const ctx = () => {
    const pic = remote.current?.pic()
    return pic ? { box: now.current.box, pic, v: now.current.view, drive: now.current.drive } : null
  }
  const run = (acts: Act[]) => {
    for (const a of acts) {
      if (a.t === 'view') { now.current.view = a.v; setView(a.v) }
      else if (a.t === 'blocked') onBlocked()
      else remote.current?.act(a)
    }
    if (g.current.spot) spot.current = g.current.spot
  }
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = el.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const stopHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null }
  // the wheel: Ctrl (a trackpad's pinch) zooms, else it scrolls the remote (or moves the picture, before Take over)
  useEffect(() => {
    const s = el.current
    if (!s) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const c = ctx()
      if (!c) return
      const k = e.deltaMode === 1 ? 16 : 1
      const p = local(e)
      if (e.ctrlKey) return run([{ t: 'view', v: zoomAt(c.v, Math.exp(-e.deltaY * k / 200), p, c.box, c.pic) }])
      const at = toRemote(p, c.box, c.pic, c.v)
      if (c.drive && at) remote.current?.act({ t: 'scroll', at, dx: e.deltaX * k, dy: e.deltaY * k })
      else run([{ t: 'view', v: panBy(c.v, { x: -e.deltaX * k, y: -e.deltaY * k }, c.box, c.pic).v }])
    }
    s.addEventListener('wheel', wheel, { passive: false })
    return () => s.removeEventListener('wheel', wheel)
  }, [])
  useEffect(() => () => stopHold(), [])
  return (
    <div
      ref={el}
      className="fsurf"
      aria-label={drive ? 'Live view. Tap to click, hold to right-click, two fingers to zoom and scroll' : 'Live view. Take over to click and type'}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        // keeps the typing box focused (and the phone's keyboard up) while the picture is touched
        e.preventDefault()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const c = ctx()
        if (!c) return
        if (e.pointerType === 'mouse') {
          if (!coarse()) typing.current?.focus({ preventScroll: true })
          if (e.button === 1) return
          const at = toRemote(local(e), c.box, c.pic, c.v)
          if (!c.drive) return void (e.button === 0 && onBlocked())
          if (at) { spot.current = at; remote.current?.act({ t: 'down', at, button: e.button === 2 ? 'right' : 'left', count: e.detail || 1 }) }
          return
        }
        run(g.current.down(e.pointerId, local(e), c))
        stopHold()
        if (g.current.mode === 'press') hold.current = setTimeout(() => { const c2 = ctx(); if (c2) run(g.current.hold(c2)) }, HOLD_MS)
      }}
      onPointerMove={(e) => {
        const c = ctx()
        if (!c) return
        if (e.pointerType === 'mouse') {
          if (!c.drive) return
          const at = toRemote(local(e), c.box, c.pic, c.v)
          if (!at) return
          if (e.buttons & 3) return remote.current?.act({ t: 'move', at, button: e.buttons & 2 ? 'right' : 'left' })
          if (e.timeStamp - lastHover.current < 30) return
          lastHover.current = e.timeStamp
          return remote.current?.act({ t: 'hover', at })
        }
        run(g.current.move(e.pointerId, local(e), c))
        if (g.current.mode !== 'press') stopHold()
      }}
      onPointerUp={(e) => {
        const c = ctx()
        if (!c) return
        if (e.pointerType === 'mouse') {
          const at = toRemote(local(e), c.box, c.pic, c.v)
          if (c.drive && at && e.button !== 1) remote.current?.act({ t: 'up', at, button: e.button === 2 ? 'right' : 'left', count: e.detail || 1 })
          return
        }
        stopHold()
        run(g.current.up(e.pointerId, performance.now(), c))
      }}
      onPointerCancel={() => { stopHold(); run(g.current.cancel()) }}
    />
  )
}

/** The slim bar on top: it hides itself a few seconds after you last touched it, leaving a small pill in the corner
 *  (show the bar, close) that fades. Tapping the picture before Take over brings it back. */
export function FullBar({ shown, setShown, close, title, addr, canType, keyboard, kb, driving, hands, idle, take, handBack }: { shown: boolean; setShown(on: boolean): void; close(): void; title: string; addr?: React.ReactNode; canType: boolean; keyboard(): void; kb: boolean; driving: boolean; hands: boolean; idle: boolean; take(): void; handBack(): void }) {
  const bar = useRef<HTMLDivElement>(null)
  const [poke, setPoke] = useState(0)
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => {
      // not while typing an address
      if (document.activeElement instanceof HTMLInputElement && bar.current?.contains(document.activeElement)) return setPoke((n) => n + 1)
      setShown(false)
    }, 3500)
    return () => clearTimeout(t)
  }, [shown, poke])
  if (!shown)
    return (
      <div className="fpill">
        <IB icon="down" label="Show the bar" onClick={() => setShown(true)} />
        <IB icon="x" label="Leave full screen" onClick={close} />
      </div>
    )
  return (
    <div ref={bar} className="fbar" onPointerDown={() => setPoke((n) => n + 1)} onKeyDown={() => setPoke((n) => n + 1)}>
      <IB icon="x" label="Leave full screen" onClick={close} />
      {addr ?? <div className="ft">{title}</div>}
      {canType && <IB icon="keyboard" label={kb ? 'Hide the keyboard' : 'Keyboard'} pressed={kb} onPointerDown={(e) => e.preventDefault()} onClick={keyboard} />}
      {!idle && (driving ? <Btn small kind="pri" onClick={handBack}>{hands ? "I'm done" : 'Hand back'}</Btn> : <Btn small kind={hands ? 'pri' : undefined} onClick={take}>Take over</Btn>)}
      <IB icon="up" label="Hide the bar" onClick={() => setShown(false)} />
    </div>
  )
}

/** The row of keys a phone's keyboard lacks (the terminal's key row): Esc, Tab, Ctrl, Alt and Cmd (held for the next
 *  key), the arrows, Enter, Paste, and on a desktop its common chords. A tap keeps the keyboard up. */
export function KeyRow({ remote, armed, setArmed, desk, mac, paste }: { remote: React.RefObject<Remote | null>; armed: Mods; setArmed(m: Mods): void; desk: boolean; mac: boolean; paste(): void }) {
  const keep = (e: React.PointerEvent) => e.preventDefault()
  const press = (key: string, m: Mods = {}) => { remote.current?.press(key, { ...armed, ...m }); setArmed({}) }
  return (
    <div className="keys fkeys" role="toolbar" aria-label="Keys">
      {KEY_ROW.slice(0, 2).map(([l, k]) => <button type="button" key={k} aria-label={`${k} key`} onPointerDown={keep} onClick={() => press(k)}>{l}</button>)}
      {MOD_ROW.map(([l, m]) => <button type="button" key={m} aria-label={`${l} key, held for the next key`} aria-pressed={!!armed[m]} onPointerDown={keep} onClick={() => setArmed({ ...armed, [m]: !armed[m as Mod] })}>{l}</button>)}
      {KEY_ROW.slice(2).map(([l, k]) => <button type="button" key={k} aria-label={`${k} key`} onPointerDown={keep} onClick={() => press(k)}>{l}</button>)}
      <button type="button" aria-label="Paste from your clipboard" onPointerDown={keep} onClick={paste}>paste</button>
      {desk && chords(mac).map((c) => <button type="button" key={c.label} aria-label={c.label} onPointerDown={keep} onClick={() => press(c.key, c.mods)}>{c.label}</button>)}
    </div>
  )
}

/** The box the keyboard types into: hidden, focused while the keyboard is up. What an on-screen keyboard types comes
 *  as changes to its value (always SENTINEL, so Backspace has something to delete); a real keyboard's keys and
 *  shortcuts go as keys. */
export function TypeBox({ remote, armed, setArmed, onFocus, inputRef }: { remote: React.RefObject<Remote | null>; armed: Mods; setArmed(m: Mods): void; onFocus(on: boolean): void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const reset = (t: HTMLInputElement) => { t.value = SENTINEL; t.setSelectionRange(SENTINEL.length, SENTINEL.length) }
  const composing = useRef(false)
  const any = (m: Mods) => !!(m.ctrl || m.alt || m.cmd)
  const take = (t: HTMLInputElement) => {
    const { back, text } = typed(t.value)
    reset(t)
    const r = remote.current
    if (!r) return
    for (let i = 0; i < back; i++) r.press('Backspace', {})
    if (!text) return
    // a held Ctrl, Alt or Cmd from the row goes with the next letter typed
    if (any(armed) && [...text].length === 1) { r.press(text, armed); setArmed({}) }
    else r.text(text)
  }
  return (
    <input
      ref={inputRef}
      className="ftype"
      aria-label="Type into the screen"
      defaultValue={SENTINEL}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="enter"
      onFocus={(e) => { reset(e.currentTarget); onFocus(true) }}
      onBlur={() => onFocus(false)}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={(e) => { composing.current = false; take(e.currentTarget) }}
      onInput={(e) => { if (!composing.current) take(e.currentTarget) }}
      onPaste={(e) => {
        e.preventDefault()
        const t = e.clipboardData.getData('text')
        if (t) remote.current?.text(t)
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        const m: Mods = { ctrl: e.ctrlKey || armed.ctrl, alt: e.altKey || armed.alt, cmd: e.metaKey || armed.cmd, shift: e.shiftKey }
        // the app's own full screen key passes; a paste goes as text, read from the clipboard
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !armed.ctrl && !armed.cmd) return
        if (SPECIAL.has(e.key) || (e.key.length === 1 && any(m))) {
          e.preventDefault()
          remote.current?.press(e.key, m)
          if (any(armed)) setArmed({})
        }
      }}
    />
  )
}

/** paste from the person's clipboard into the remote, as typed text */
export function pasteFrom(remote: React.RefObject<Remote | null>) {
  if (!navigator.clipboard?.readText) return notice('This browser did not let Shepherdr read your clipboard.')
  void navigator.clipboard.readText().then((t) => { if (t) { remote.current?.text(t); notice('Pasted') } }).catch(() => notice('This browser did not let Shepherdr read your clipboard.'))
}
