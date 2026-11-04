// The Browser panel's arithmetic: where the page sits in the panel, where a tap lands on the page, where a pin goes as
// the page scrolls, and a key press as the browser wants it.
import type { BrowserPick, BrowserUp, FrameMeta } from '@shared/browser.ts'

export type Rect = { x: number; y: number; w: number; h: number }
export type Size = { w: number; h: number }

/** the page's picture fitted whole into the panel, centred */
export function fit(box: Size, page: Size): Rect {
  if (!page.w || !page.h || !box.w || !box.h) return { x: 0, y: 0, w: 0, h: 0 }
  const s = Math.min(box.w / page.w, box.h / page.h)
  const w = page.w * s
  const h = page.h * s
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h }
}

/** a point in the panel as a point in the page's viewport (CSS px); none outside the picture */
export function toPage(p: { x: number; y: number }, r: Rect, page: Size): { x: number; y: number } | null {
  if (!r.w || p.x < r.x || p.y < r.y || p.x > r.x + r.w || p.y > r.y + r.h) return null
  return { x: Math.round(((p.x - r.x) / r.w) * page.w), y: Math.round(((p.y - r.y) / r.h) * page.h) }
}

/** a viewport point as a point in the panel */
export function toPanel(p: { x: number; y: number }, r: Rect, page: Size) {
  return { x: r.x + (p.x / page.w) * r.w, y: r.y + (p.y / page.h) * r.h }
}

/** where a note's pin shows now: where it was tapped, moved with the page's scroll (not for a fixed element); none when
 *  it is off the picture or on another page */
export function pinAt(pick: Pick<BrowserPick, 'at' | 'fixed' | 'url'>, url: string, meta: FrameMeta | undefined, r: Rect, page: Size) {
  if (!meta || !sameUrl(pick.url, url)) return null
  const v = pick.fixed ? pick.at : { x: pick.at.x - (meta.scrollOffsetX ?? 0), y: pick.at.y - (meta.scrollOffsetY ?? 0) }
  if (v.x < 0 || v.y < 0 || v.x > page.w || v.y > page.h) return null
  return toPanel(v, r, page)
}

/** the same page, the fragment aside */
export const sameUrl = (a: string, b: string) => a.split('#')[0] === b.split('#')[0]

/** Chrome's key codes for the keys that type nothing */
const VK: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
}

type Key = { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

export const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)

/**
 * A key as the browser wants it. A character types itself as text, with no key code (a code there would make "." act
 * as Delete); a shortcut (Ctrl or Cmd with a letter) carries the letter's code so the page sees the shortcut. Modifier
 * keys alone, and keys it doesn't know, go nowhere.
 */
export function keyEvent(e: Key, type: 'keyDown' | 'keyUp'): Extract<BrowserUp, { type: 'input_keyboard' }> | null {
  const mods = modifiers(e)
  const shortcut = e.ctrlKey || e.metaKey
  if (VK[e.key] !== undefined)
    return { type: 'input_keyboard', eventType: type, key: e.key, code: e.code, windowsVirtualKeyCode: VK[e.key], modifiers: mods, ...(type === 'keyDown' && e.key === 'Enter' ? { text: '\r' } : {}) }
  if (e.key.length !== 1) return null
  if (shortcut) return { type: 'input_keyboard', eventType: type, key: e.key, code: e.code, windowsVirtualKeyCode: /^[a-z0-9]$/i.test(e.key) ? e.key.toUpperCase().charCodeAt(0) : 0, modifiers: mods }
  return { type: 'input_keyboard', eventType: type, key: e.key, code: e.code, modifiers: mods, ...(type === 'keyDown' ? { text: e.key } : {}) }
}

/** the part of the page a note's shot shows (viewport px): the element as far as it shows, with a little room; a huge
 *  one (or one inside a frame, whose box is the frame's own), the part around your tap */
export function shotRect(p: Pick<BrowserPick, 'box' | 'frame'>, tap: { x: number; y: number }, page: Size): Rect | null {
  const pad = 8
  let b = p.frame ? { x: tap.x - 160, y: tap.y - 100, w: 320, h: 200 } : p.box
  if (b.w * b.h > 900 * 700) b = { x: tap.x - 300, y: tap.y - 200, w: 600, h: 400 }
  const x0 = Math.max(0, b.x - pad)
  const y0 = Math.max(0, b.y - pad)
  const x1 = Math.min(page.w, b.x + b.w + pad)
  const y1 = Math.min(page.h, b.y + b.h + pad)
  return x1 - x0 < 4 || y1 - y0 < 4 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
