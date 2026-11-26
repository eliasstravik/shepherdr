import { afterAll, expect, test } from 'bun:test'

// #1553: the switch holds the screen on while the app is on screen, asks again when it comes back, lets go when off
const events = new Map<string, () => void>()
const asked: { released: boolean; release(): Promise<void> }[] = []
const g = globalThis as any
const doc = { visibilityState: 'visible', addEventListener: (t: string, f: () => void) => events.set(t, f) }
const had = { document: g.document, localStorage: g.localStorage, isSecureContext: g.isSecureContext }
g.document = doc
const store = new Map<string, string>()
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
g.isSecureContext = true
Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
  const l = { released: false, release: async () => void (l.released = true) }
  asked.push(l)
  return l
} } })

// the fakes go after this file: other tests see no page
afterAll(() => {
  for (const k of Object.keys(had) as (keyof typeof had)[]) if (had[k] === undefined) delete g[k]; else g[k] = had[k]
  delete (navigator as any).wakeLock
})

const { canKeepAwake, setAwake } = (await import('./awake.ts' + '?fresh')) as typeof import('./awake.ts') // its own copy: another test may have loaded it on another page
const tick = () => new Promise((r) => setTimeout(r, 0))

test('off by default; on holds a lock, off lets it go', async () => {
  expect(canKeepAwake()).toBe(true)
  await tick()
  expect(asked.length).toBe(0)
  setAwake(true)
  await tick()
  expect(asked.length).toBe(1)
  setAwake(false)
  expect(asked[0].released).toBe(true)
})

test('asked again when the app comes back on screen', async () => {
  setAwake(true)
  await tick()
  const n = asked.length
  asked.at(-1)!.released = true // the browser let go when it was hidden
  events.get('visibilitychange')?.()
  await tick()
  expect(asked.length).toBe(n + 1)
  setAwake(false)
})
