// SHEP-336: the chat swaps to the right of a pane with one tap, and each layout class keeps its own choice on this
// device: a phone never splits, an unfolded fold or tablet and a desktop never move each other.
import { afterAll, beforeEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

// a device's localStorage, before the module reads what it keeps
const disk = new Map<string, string>()
const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
// the other test files run in this same process: put it back as it was
afterAll(() => {
  if (had) Object.defineProperty(globalThis, 'localStorage', had)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => void disk.set(k, v), removeItem: (k: string) => void disk.delete(k) },
})
const S = await import('./sides.ts')
const { secondTap } = await import('./resize.ts')
const { SidesRow } = await import('./settings.tsx')
const { readFileSync } = await import('node:fs')
const { setUI } = await import('./kernel.ts')

beforeEach(() => {
  disk.clear()
  S.reloadSides()
})

test('the layout class: a phone, an unfolded fold or tablet, a desktop', () => {
  expect(S.layoutOf({ phone: true, narrow: true }, true)).toBe('phone')
  // an unfolded fold: wider than a phone, under 1024 px, a touch screen
  expect(S.layoutOf({ phone: false, narrow: true }, true)).toBe('tablet')
  // a big tablet in landscape: touch first, whatever its width
  expect(S.layoutOf({ phone: false, narrow: false }, true)).toBe('tablet')
  // a narrow desktop window is still split like a tablet
  expect(S.layoutOf({ phone: false, narrow: true }, false)).toBe('tablet')
  expect(S.layoutOf({ phone: false, narrow: false }, false)).toBe('desktop')
})

test('the chat starts on the left everywhere', () => {
  for (const l of ['phone', 'tablet', 'desktop'] as const) expect(S.chatSide(l)).toBe('left')
})

test('one swap flips only the layout the window is in, and is kept on this device', () => {
  setUI({ phone: false, narrow: true }) // an unfolded fold (bun has no touch screen: narrow makes it one)
  expect(S.layoutNow()).toBe('tablet')
  S.swapSides()
  expect(S.chatSide('tablet')).toBe('right')
  expect(S.chatSide('desktop')).toBe('left')
  expect(S.chatSide('phone')).toBe('left')
  expect(JSON.parse(disk.get('shepherdr.sides')!)).toEqual({ tablet: 'right' })
  // a page load later
  S.reloadSides()
  expect(S.chatSide('tablet')).toBe('right')
  // and back
  S.swapSides()
  expect(S.chatSide('tablet')).toBe('left')
})

test('a desktop keeps its own side apart from the fold', () => {
  setUI({ phone: false, narrow: false })
  S.swapSides()
  expect(S.chatSide('desktop')).toBe('right')
  expect(S.chatSide('tablet')).toBe('left')
})

test('a phone has no split: nothing to swap, nothing kept', () => {
  setUI({ phone: true, narrow: true })
  S.swapSides()
  expect(S.chatSide('phone')).toBe('left')
  expect(disk.has('shepherdr.sides')).toBe(false)
})

test('what is kept but makes no sense is the left', () => {
  disk.set('shepherdr.sides', JSON.stringify({ tablet: 'up', desktop: 3 }))
  S.reloadSides()
  expect(S.chatSide('tablet')).toBe('left')
  disk.set('shepherdr.sides', 'not json')
  S.reloadSides()
  expect(S.chatSide('desktop')).toBe('left')
})

test('focus order follows the sides: the pane comes first when the chat is on the right', () => {
  expect(S.columnsOf('left')).toEqual(['chat', 'pane'])
  expect(S.columnsOf('right')).toEqual(['pane', 'chat'])
})

test('Settings says it in plain words, for the layout this device is in; a phone has no row', () => {
  const left = renderToStaticMarkup(<SidesRow layout="tablet" side="left" />)
  expect(left).toContain('Sides')
  expect(left).toMatch(/aria-pressed="true"[^>]*>Chat on the left</)
  expect(left).toMatch(/aria-pressed="false"[^>]*>Chat on the right</)
  const right = renderToStaticMarkup(<SidesRow layout="desktop" side="right" />)
  expect(right).toMatch(/aria-pressed="true"[^>]*>Chat on the right</)
  expect(renderToStaticMarkup(<SidesRow layout="phone" side="left" />)).toBe('')
})

test('the chat header menu swaps the sides, and says where the chat goes', () => {
  setUI({ phone: false, narrow: true })
  const [row] = S.swapRow({ phone: false, pane: 'tasks' }, 'left')
  expect(row?.label).toBe('Move the chat to the right')
  expect(S.swapRow({ phone: false, pane: 'tasks' }, 'right')[0]?.label).toBe('Move the chat to the left')
  row?.run?.()
  expect(S.chatSide('tablet')).toBe('right')
  // nothing to swap without a pane, nor on a phone
  expect(S.swapRow({ phone: false, pane: null })).toEqual([])
  expect(S.swapRow({ phone: true, pane: 'tasks' })).toEqual([])
})

test('the divider stays quiet: no button floats on it, and only a mouse hover lights it (SHEP-352)', () => {
  const css = readFileSync(new URL('./ds.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  expect(css).not.toContain('.swp')
  expect(app).not.toContain('SwapButton')
  // a touch screen keeps :hover after a tap: the edge's hover line only for a fine pointer that hovers
  const bare = css.replace(/@media \(hover:hover\) and \(pointer:fine\)\{[^\n]*\}\}/g, '')
  expect(bare).not.toMatch(/\.rz:hover/)
  expect(css).toMatch(/@media \(hover:hover\) and \(pointer:fine\)\{\.rz:hover::after/)
})

test('a double tap on the divider: two taps close in time and place on the same edge', () => {
  const first = { at: 1000, x: 400, y: 500, edge: 'pane' as const }
  expect(secondTap(first, 1200, 402, 505, 'pane')).toBe(true)
  expect(secondTap(first, 1400, 400, 500, 'pane')).toBe(false) // too slow
  expect(secondTap(first, 1200, 400, 620, 'pane')).toBe(false) // too far apart
  expect(secondTap(first, 1200, 400, 500, 'side')).toBe(false) // another edge
  expect(secondTap(null, 1200, 400, 500, 'pane')).toBe(false)
})
