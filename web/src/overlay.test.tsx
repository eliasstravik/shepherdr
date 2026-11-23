import { expect, test } from 'bun:test'
import { isValidElement, type ReactElement } from 'react'
import { closeAll, layersNow, openForm } from './overlay.tsx'

// SHEP-308: on a phone the keyboard coming up redraws the app, and each redraw draws every open dialog again. A form's
// fields only stay (and keep the focus) when each redraw gives the same component; a new one puts new fields in.

test('a form is the same component at every redraw, so its fields and their focus stay', () => {
  function Form() {
    return null
  }
  openForm(Form, { label: 'New space' })
  const [layer] = layersNow()
  const first = layer.render(() => {}) as ReactElement
  const again = layer.render(() => {}) as ReactElement
  expect(isValidElement(first)).toBe(true)
  expect(first.type).toBe(Form)
  expect(again.type).toBe(first.type)
  closeAll()
  expect(layersNow()).toHaveLength(0)
})

// SHEP-354: the Tasks filter stays inside its panel, its end lined up with its button, no taller than the room under it
test('a menu kept inside its panel: lined up with its button, inside the panel, as tall as the room allows', async () => {
  const { inside } = await import('./overlay.tsx')
  const g = globalThis as any
  const was = { iw: g.innerWidth, ih: g.innerHeight, cs: g.getComputedStyle }
  g.innerWidth = 1280
  g.innerHeight = 800
  g.getComputedStyle = () => ({ maxWidth: '280px', maxHeight: '640px' })
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect
  // a pop as wide as its content (400) up to its max-width, as tall as its rows (900) up to its max-height
  const pop = (natural: { w: number; h: number }) => {
    const style: Record<string, string> = {}
    return {
      style,
      get offsetWidth() { return Math.min(natural.w, parseFloat(style.maxWidth || '') || Infinity) },
      get offsetHeight() { return Math.min(natural.h, 640) },
    } as unknown as HTMLElement
  }
  try {
    const panel = rect(900, 0, 1280, 800)
    const button = rect(1208, 10, 1236, 38)
    const p = pop({ w: 400, h: 900 })
    const at = inside(p, button, panel)
    const w = p.offsetWidth
    expect(w).toBe(280)
    expect(at.left + w).toBe(1236) // its end at the button's end
    expect(at.left).toBeGreaterThanOrEqual(908) // inside the panel
    expect(at.top).toBe(42)
    expect(parseFloat(p.style.maxHeight!)).toBeLessThanOrEqual(800 - 8 - 42)
    // a narrow panel: no wider than the panel less 8 px a side
    const narrow = rect(1000, 0, 1240, 800)
    const q = pop({ w: 400, h: 200 })
    const at2 = inside(q, rect(1200, 10, 1228, 38), narrow)
    expect(q.offsetWidth).toBe(224)
    expect(at2.left).toBe(1008)
    expect(at2.left + q.offsetWidth).toBeLessThanOrEqual(1232)
    // little room under the button and much above: it opens upward, inside the screen
    const r = pop({ w: 200, h: 500 })
    const at3 = inside(r, rect(1100, 700, 1128, 728), panel)
    expect(at3.top).toBeGreaterThanOrEqual(8)
    expect(at3.top + Math.min(500, parseFloat(r.style.maxHeight!))).toBeLessThanOrEqual(696)
  } finally {
    g.innerWidth = was.iw
    g.innerHeight = was.ih
    g.getComputedStyle = was.cs
  }
})

// Terminal and Screen in a menu: a view row is a checkbox item with a check while its view is open
test("a menu's view row carries its open mark", async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MenuRows } = await import('./overlay.tsx')
  const html = renderToStaticMarkup(
    <MenuRows close={() => {}} rows={[{ icon: 'term', label: 'Terminal', on: true }, { icon: 'screen', label: 'Screen', on: false }, { icon: 'gear', label: 'Settings' }]} />,
  )
  expect(html).toMatch(/role="menuitemcheckbox" aria-checked="true"[^>]*>.*?Terminal.*?<svg/)
  expect(html).toMatch(/role="menuitemcheckbox" aria-checked="false"[^>]*>.*?Screen<\/span><\/button>/)
  expect(html).toMatch(/role="menuitem"[^>]*>.*?Settings/)
})
