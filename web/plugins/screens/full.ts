// The Screen view in full screen: the live picture fills the device, zoomed and panned by hand, and a touch on it is a
// mouse at that point of the remote browser or desktop. This is its arithmetic, its gestures and its keys, kept apart
// from the page so the tests can drive them.
//
// Gestures, as chosen: a tap is a click (two quick taps a double click), a drag is a drag, a long press is a right
// click, two fingers pinch to zoom and move to pan the zoomed picture; once the picture can't pan further that way
// (or isn't zoomed), the two fingers scroll the remote page. Until Take over, a touch reaches nothing remote: one
// finger pans the zoomed picture and a tap says how to take over.
import { fit, toPage, type Rect, type Size } from '@plugins/browser/input.ts'
import type { BrowserUp } from '@shared/browser.ts'

export type Pt = { x: number; y: number }
/** how the fitted picture is zoomed (1: whole, up to MAX) and moved (box px), as transform: translate(x,y) scale(z) */
export type View = { z: number; x: number; y: number }
export const WHOLE: View = { z: 1, x: 0, y: 0 }
export const MAX = 8

/** where the picture shows in the box now */
export function shown(box: Size, pic: Size, v: View): Rect {
  const r = fit(box, pic)
  return { x: v.x + r.x * v.z, y: v.y + r.y * v.z, w: r.w * v.z, h: r.h * v.z }
}

/** a point in the box as a point on the remote screen (its own px); none off the picture */
export const toRemote = (p: Pt, box: Size, pic: Size, v: View) => toPage(p, shown(box, pic, v), pic)

/** remote px per box px at this zoom */
export const pxPer = (box: Size, pic: Size, v: View) => {
  const r = shown(box, pic, v)
  return r.w ? pic.w / r.w : 1
}

/** zoom within 1..MAX (whole at 1), no gap at an edge the picture is wide (or tall) enough to cover, and a picture
 *  narrower (or shorter) than the screen kept inside it, where the pinch put it */
export function clamp(v: View, box: Size, pic: Size): View {
  const z = Math.min(MAX, Math.max(1, v.z))
  if (z < 1.001) return WHOLE
  const r = fit(box, pic)
  const axis = (t: number, at: number, len: number, room: number) => {
    const w = len * z
    const s = t + at * z
    const [lo, hi] = w <= room ? [0, room - w] : [room - w, 0]
    return Math.min(hi, Math.max(lo, s)) - at * z
  }
  return { z, x: axis(v.x, r.x, r.w, box.w), y: axis(v.y, r.y, r.h, box.h) }
}

/** zoom by f about a point of the box, which stays where it is */
export function zoomAt(v: View, f: number, at: Pt, box: Size, pic: Size): View {
  const z = Math.min(MAX, Math.max(1, v.z * f))
  const k = z / v.z
  return clamp({ z, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, box, pic)
}

/** move the picture by d; what it couldn't move (at an edge, or not zoomed) comes back as rest */
export function panBy(v: View, d: Pt, box: Size, pic: Size): { v: View; rest: Pt } {
  const n = clamp({ ...v, x: v.x + d.x, y: v.y + d.y }, box, pic)
  return { v: n, rest: { x: d.x - (n.x - v.x), y: d.y - (n.y - v.y) } }
}

/**
 * The box changed size. Turned (a new width): the whole picture again. Only shorter or taller (the on-screen keyboard
 * came or went): the same size on screen, moved so the spot last touched (remote px) stays in view.
 */
export function refit(v: View, was: Size, box: Size, pic: Size, spot: Pt | null): View {
  if (Math.abs(was.w - box.w) > 1 || !was.h) return WHOLE
  const s0 = fit(was, pic).w / (pic.w || 1)
  const s1 = fit(box, pic).w / (pic.w || 1)
  let n: View = { z: v.z * (s1 ? s0 / s1 : 1), x: v.x, y: v.y }
  const r1 = fit(box, pic)
  // keep the left edge and the top where they were on screen
  n.x = v.x + fit(was, pic).x * v.z - r1.x * n.z
  n.y = v.y + fit(was, pic).y * v.z - r1.y * n.z
  n = clamp(n, box, pic)
  if (spot) {
    const r = shown(box, pic, n)
    const y = r.y + (spot.y / pic.h) * r.h
    const x = r.x + (spot.x / pic.w) * r.w
    const room = 24
    const dy = y > box.h - room ? box.h - room - y : y < room ? room - y : 0
    const dx = x > box.w - room ? box.w - room - x : x < room ? room - x : 0
    if (dx || dy) n = clamp({ ...n, x: n.x + dx, y: n.y + dy }, box, pic)
  }
  return n
}

/* ---------- gestures ---------- */

export type Button = 'left' | 'right'
/** what a gesture does: on the remote (remote px), to the view, or a tap before Take over */
export type Act =
  | { t: 'down' | 'move' | 'up'; at: Pt; button: Button; count?: number }
  | { t: 'click'; at: Pt; button: Button; count: number }
  | { t: 'scroll'; at: Pt; dx: number; dy: number }
  | { t: 'view'; v: View }
  | { t: 'blocked' }

/** a finger moved further than this is a drag, not a tap */
export const SLOP = 10
/** held this long without moving: a right click */
export const HOLD_MS = 500
const TWICE_MS = 400

type Touches = Map<number, Pt>
type Ctx = { box: Size; pic: Size; v: View; drive: boolean }

/**
 * Touches in, acts out. Feed it every pointer's down, move and up (box px) with the time, and hold() when a finger has
 * stayed put HOLD_MS. It keeps no clock of its own.
 */
export function gestures() {
  const pts: Touches = new Map()
  let mode: 'idle' | 'press' | 'drag' | 'pan' | 'two' | 'over' = 'idle'
  let start: Pt = { x: 0, y: 0 }
  let last: Pt = { x: 0, y: 0 }
  let remote: Pt | null = null
  let pinch = { d: 0, mid: { x: 0, y: 0 }, d0: 0 }
  let tap = { t: -1e9, at: { x: 0, y: 0 } }
  const two = () => {
    const [a, b] = [...pts.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }
  return {
    get mode() { return mode },
    down(id: number, p: Pt, c: Ctx): Act[] {
      pts.set(id, p)
      if (pts.size === 1) {
        mode = 'press'
        start = last = p
        remote = toRemote(p, c.box, c.pic, c.v)
        return []
      }
      const out: Act[] = []
      if (mode === 'drag' && remote) out.push({ t: 'up', at: remote, button: 'left' })
      if (pts.size === 2 && mode !== 'over') {
        mode = 'two'
        const g = two()
        pinch = { d: g.d, mid: g.mid, d0: g.d }
      } else mode = 'over'
      return out
    },
    move(id: number, p: Pt, c: Ctx): Act[] {
      if (!pts.has(id)) return []
      pts.set(id, p)
      if (mode === 'press' && Math.hypot(p.x - start.x, p.y - start.y) > SLOP) {
        if (c.drive && remote) {
          mode = 'drag'
          const at = toRemote(p, c.box, c.pic, c.v) ?? remote
          last = p
          return [{ t: 'down', at: remote, button: 'left' }, { t: 'move', at, button: 'left' }]
        }
        mode = 'pan'
      }
      if (mode === 'drag') {
        last = p
        const at = toRemote(p, c.box, c.pic, c.v)
        if (at) remote = at
        return [{ t: 'move', at: remote!, button: 'left' }]
      }
      if (mode === 'pan') {
        const { v } = panBy(c.v, { x: p.x - last.x, y: p.y - last.y }, c.box, c.pic)
        last = p
        return [{ t: 'view', v }]
      }
      if (mode === 'two' && pts.size === 2) {
        const g = two()
        let v = c.v
        const pinching = Math.abs(g.d / (pinch.d0 || 1) - 1) > 0.08
        if (pinching && pinch.d) v = zoomAt(v, g.d / pinch.d, g.mid, c.box, c.pic)
        const moved = panBy(v, { x: g.mid.x - pinch.mid.x, y: g.mid.y - pinch.mid.y }, c.box, c.pic)
        pinch = { ...pinch, d: g.d, mid: g.mid }
        const out: Act[] = [{ t: 'view', v: moved.v }]
        // what the picture couldn't take scrolls the remote: fingers up, the page goes down
        if (c.drive && !pinching && (moved.rest.x || moved.rest.y)) {
          const at = toRemote(g.mid, c.box, c.pic, moved.v)
          const k = pxPer(c.box, c.pic, moved.v)
          if (at) out.push({ t: 'scroll', at, dx: -moved.rest.x * k, dy: -moved.rest.y * k })
        }
        return out
      }
      return []
    },
    /** a finger has stayed put HOLD_MS */
    hold(c: Ctx): Act[] {
      if (mode !== 'press') return []
      mode = 'over'
      if (!c.drive || !remote) return c.drive ? [] : [{ t: 'blocked' }]
      return [{ t: 'click', at: remote, button: 'right', count: 1 }]
    },
    up(id: number, now: number, c: Ctx): Act[] {
      if (!pts.delete(id)) return []
      const out: Act[] = []
      if (mode === 'press') {
        if (!c.drive) out.push({ t: 'blocked' })
        else if (remote) {
          const again = now - tap.t < TWICE_MS && Math.hypot(start.x - tap.at.x, start.y - tap.at.y) < SLOP * 3
          out.push({ t: 'click', at: remote, button: 'left', count: again ? 2 : 1 })
          tap = { t: again ? -1e9 : now, at: start }
        }
        mode = 'over'
      } else if (mode === 'drag' && remote) {
        out.push({ t: 'up', at: remote, button: 'left' })
        mode = 'over'
      } else if (mode === 'two' || mode === 'pan') mode = 'over'
      if (!pts.size) mode = 'idle'
      return out
    },
    /** the gesture was cut short (the pointer was lost): a held button is let go */
    cancel(): Act[] {
      const out: Act[] = mode === 'drag' && remote ? [{ t: 'up', at: remote, button: 'left' }] : []
      pts.clear()
      mode = 'idle'
      return out
    },
    /** the remote point the gesture began on (what the keyboard keeps in view) */
    get spot() { return remote },
  }
}

/* ---------- keys ---------- */

export type Mod = 'ctrl' | 'alt' | 'cmd' | 'shift'
export type Mods = Partial<Record<Mod, boolean>>

/** the keys a phone's keyboard lacks: label, the DOM key name */
export const KEY_ROW: [string, string][] = [['esc', 'Escape'], ['tab', 'Tab'], ['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight'], ['↵', 'Enter']]
export const MOD_ROW: [string, Mod][] = [['ctrl', 'ctrl'], ['alt', 'alt'], ['cmd', 'cmd']]

/** a desktop's common chords: a Mac's (its shared screen) and a Linux desktop's (its own display) */
export function chords(mac: boolean): { label: string; key: string; mods: Mods }[] {
  return mac
    ? [{ label: '⌘ Space', key: ' ', mods: { cmd: true } }, { label: '⌘ Tab', key: 'Tab', mods: { cmd: true } }, { label: '⌘ Q', key: 'q', mods: { cmd: true } }]
    : [{ label: 'Alt Tab', key: 'Tab', mods: { alt: true } }, { label: 'Ctrl Alt Del', key: 'Delete', mods: { ctrl: true, alt: true } }]
}

/** Chrome's key codes for the keys that type nothing */
const VK: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 }
const CODE: Record<string, string> = { ' ': 'Space' }
const bits = (m: Mods) => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.cmd ? 4 : 0) | (m.shift ? 8 : 0)
const codeOf = (key: string) => CODE[key] ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key.length > 1 ? key : '')

/** one key press (down and up) as the remote browser wants it, with the modifiers held */
export function browserPress(key: string, m: Mods = {}): BrowserUp[] {
  const mods = bits(m)
  const shortcut = !!(m.ctrl || m.cmd || m.alt)
  const vk = VK[key] ?? (key.length === 1 && /^[a-z0-9]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : 0)
  const base = { type: 'input_keyboard' as const, key, code: codeOf(key), modifiers: mods, ...(vk ? { windowsVirtualKeyCode: vk } : {}) }
  const text = key === 'Enter' ? '\r' : key.length === 1 && !shortcut ? key : undefined
  return [{ ...base, eventType: 'keyDown', ...(text ? { text } : {}) }, { ...base, eventType: 'keyUp' }]
}

/** X keysyms */
const SYM: Record<string, number> = { Escape: 0xff1b, Tab: 0xff09, Enter: 0xff0d, Backspace: 0xff08, Delete: 0xffff, Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54, Insert: 0xff63 }
const MOD_SYM: Record<Mod, [number, string]> = { ctrl: [0xffe3, 'ControlLeft'], alt: [0xffe9, 'AltLeft'], cmd: [0xffeb, 'MetaLeft'], shift: [0xffe1, 'ShiftLeft'] }

/** a key as an X keysym: the named keys, then a character (Latin-1 as itself, the rest as Unicode) */
export function keysymOf(key: string): number {
  if (SYM[key]) return SYM[key]
  const cp = key.codePointAt(0) ?? 0
  return cp < 0x100 ? cp : 0x1000000 + cp
}

/** one key press on a desktop: the modifiers down, the key down and up, the modifiers up */
export function deskPress(key: string, m: Mods = {}): [number, string | null, boolean][] {
  const held = (['ctrl', 'alt', 'shift', 'cmd'] as Mod[]).filter((k) => m[k])
  const sym = keysymOf(key)
  const code = codeOf(key) || null
  return [...held.map((k) => [MOD_SYM[k][0], MOD_SYM[k][1], true] as [number, string, boolean]), [sym, code, true], [sym, code, false], ...held.reverse().map((k) => [MOD_SYM[k][0], MOD_SYM[k][1], false] as [number, string, boolean])]
}

/** the keys a typing box passes on itself (the rest it types as text) */
export const SPECIAL = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/**
 * What the typing box's value says was typed. It always holds SENTINEL with the caret at its end, so an on-screen
 * keyboard's Backspace has something to delete; after each input its value is read and set back.
 */
export const SENTINEL = '  '
export function typed(value: string): { back: number; text: string } {
  if (value.startsWith(SENTINEL)) return { back: 0, text: value.slice(SENTINEL.length) }
  if (SENTINEL.startsWith(value)) return { back: SENTINEL.length - value.length, text: '' }
  // the keyboard swapped the whole box (a suggestion): take what is new after the spaces
  const t = value.replace(/^ +/, '')
  return { back: Math.max(0, SENTINEL.length - (value.length - t.length)), text: t }
}

/** a scroll on a desktop: whole wheel steps (each about this many remote px), the rest kept for the next */
export const STEP = 40
export function wheelSteps(carry: Pt, dx: number, dy: number): { x: number; y: number; carry: Pt } {
  const cx = carry.x + dx
  const cy = carry.y + dy
  const x = Math.trunc(cx / STEP)
  const y = Math.trunc(cy / STEP)
  return { x, y, carry: { x: cx - x * STEP, y: cy - y * STEP } }
}

/* ---------- the device's own full screen ---------- */

type Doc = { fullscreenElement?: Element | null; documentElement: { requestFullscreen?: (o?: FullscreenOptions) => Promise<void> }; exitFullscreen?: () => Promise<void> }

/** the browser's own full screen where it allows it (its bars go too); where it doesn't (an iPhone), the app's
 *  full-window view alone. Says whether the browser's went on. */
export async function enterDevice(doc: Doc = document): Promise<boolean> {
  if (doc.fullscreenElement || !doc.documentElement.requestFullscreen) return !!doc.fullscreenElement
  try {
    await doc.documentElement.requestFullscreen({ navigationUI: 'hide' })
    return true
  } catch {
    return false
  }
}

export async function leaveDevice(doc: Doc = document) {
  if (doc.fullscreenElement && doc.exitFullscreen) await doc.exitFullscreen().catch(() => undefined)
}
