import { afterAll, expect, test } from 'bun:test'
import type { Snapshot } from '@shared/types.ts'

// kernel.ts reads the page (its address, storage, width) as it loads: the little it needs, for this file only
const g = globalThis as Record<string, unknown>
const noop = () => {}
const page: Record<string, unknown> = {
  location: new URL('http://app.test/'),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  addEventListener: noop,
  removeEventListener: noop,
  innerWidth: 1280,
  innerHeight: 800,
  history: { replaceState: noop, pushState: noop, state: null },
  document: { head: { innerHTML: '' }, visibilityState: 'visible', addEventListener: noop, documentElement: { style: {}, dataset: {} } },
}
const had = Object.keys(page).filter((k) => k in g)
for (const k of Object.keys(page)) if (!had.includes(k)) g[k] = page[k]
afterAll(() => {
  for (const k of Object.keys(page)) if (!had.includes(k)) delete g[k]
})
const { placeOf } = await import('./kernel.ts')

const snap = (places: unknown[]) =>
  ({ name: 'vm', host: 'vm', user: 'you', places, machines: [{ id: 'm:vm', machine: 'vm', name: 'vm-demo', status: 'idle', here: true }], tasks: [], automations: {}, artifacts: [], asks: {}, needs: [], settings: [] }) as unknown as Snapshot

// #747: the last space closed, the page went blank: what reads the shown space (its chat, name, tabs) read undefined
test('with no space left, the shown space is an empty stand-in, never undefined', () => {
  const p = placeOf(snap([]), 'p:vm:gone')
  expect(p).toBeDefined()
  expect(p.id).toBe('')
  expect(p.chat).toBe('')
  expect(p.tabs).toEqual([])
})

test('with a space, the shown space is a real one', () => {
  const shop = { id: 'p:vm:shop', name: 'shop', machine: 'vm', level: 2, status: 'idle', mode: 'regular', chat: 'c:vm:shop' }
  expect(placeOf(snap([shop]), 'p:vm:gone').id).toBe('p:vm:shop')
})
