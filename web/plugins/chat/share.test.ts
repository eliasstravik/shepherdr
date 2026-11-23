// SHEP-345: Share into Shepherdr. Android's Share sheet POSTs to ./share; the service worker (web/public/sw.js) keeps
// the share and opens the app on ./?share=<id>; the page puts it in the box of the chat open last. Here the real worker
// runs in a sandbox with an in-memory Cache Storage, and the page's half takes what it kept.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import type { Snapshot } from '@shared/types.ts'
import { getDraft, getState, setDraft } from '@client/kernel.ts'
import { land, landingChat, sharedText, SHARE_CACHE, takeShared } from './share.ts'

const SRC = readFileSync(join(import.meta.dir, '../../public/sw.js'), 'utf8')
const SCOPE = 'https://box.example.test/shepherdr/'

/** Cache Storage in memory, as a browser keeps it */
function memoryCaches() {
  const all = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    const m = all.get(name) ?? new Map<string, Response>()
    all.set(name, m)
    const key = (r: RequestInfo | URL) => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url)
    return {
      put: async (r: RequestInfo | URL, res: Response) => void m.set(key(r), new Response(await res.arrayBuffer(), { headers: res.headers })),
      match: async (r: RequestInfo | URL) => m.get(key(r))?.clone(),
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (r: RequestInfo | URL) => m.delete(key(r)),
    } as unknown as Cache
  }
  return { open, all } as unknown as CacheStorage & { all: Map<string, Map<string, Response>> }
}

/** the real service worker, with the share it is handed: its answer and the caches it filled */
async function share(form: FormData, url = `${SCOPE}share`) {
  const listeners: Record<string, (e: any) => void> = {}
  const caches = memoryCaches()
  const self: any = {
    registration: { scope: SCOPE },
    navigator: {},
    clients: { matchAll: async () => [], claim: async () => undefined },
    addEventListener: (k: string, fn: (e: any) => void) => (listeners[k] = fn),
    skipWaiting: () => undefined,
  }
  vm.runInContext(SRC, vm.createContext({ self, caches, URL, Response, Request, Promise, JSON, Math, Date, Array }))
  let answer = null as Promise<Response> | null
  listeners.fetch({ request: new Request(url, { method: 'POST', body: form }), respondWith: (p: Promise<Response>) => (answer = p) })
  return { answer: answer ? await answer : null, caches }
}

const png = (bytes: number[], name = 'Screenshot_20261123-101500.png') => new File([new Uint8Array(bytes)], name, { type: 'image/png' })

const snap = {
  places: [
    { id: 'p:everything', name: 'Everything', chat: 'all', machine: 'vm', home: true },
    { id: 'p:shop', name: 'shop', chat: 'shop', machine: 'vm' },
  ],
  tasks: [
    { id: 'SHOP-3', name: 'Bigger card', place: 'p:shop', status: 'work', agent: { chat: 'SHOP-3/worker' } },
    { id: 'SHOP-4', name: 'Not started', place: 'p:shop', status: 'todo' },
  ],
  machines: [],
  everything: 'p:everything',
  host: 'vm',
} as unknown as Snapshot

// a picture attached goes up at once: the upload answers here, nothing leaves the test
const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ path: '/tmp/up.png' }))) as unknown as typeof fetch
})
afterAll(() => {
  globalThis.fetch = realFetch
})

test('one screenshot shared: the worker keeps it and opens the app on its id; the page gets the picture back', async () => {
  const f = new FormData()
  f.append('files', png([1, 2, 3]))
  const { answer, caches } = await share(f)
  expect(answer!.status).toBe(303)
  const to = new URL(answer!.headers.get('location')!)
  expect(to.origin + to.pathname).toBe(SCOPE)
  const id = to.searchParams.get('share')!
  expect(id).toMatch(/^[\w-]+$/)
  const s = await takeShared(id, caches, new URL(SCOPE))
  expect(s!.text).toBe('')
  expect(s!.files.map((x) => [x.name, x.type, x.size])).toEqual([['Screenshot_20261123-101500.png', 'image/png', 3]])
  // taken: gone, so a reload doesn't attach it twice
  expect(await takeShared(id, caches, new URL(SCOPE))).toBeNull()
  expect(caches.all.get(SHARE_CACHE)!.size).toBe(0)
})

test('several pictures at once all come, in order; one with no real name gets a screenshot name', async () => {
  const f = new FormData()
  f.append('files', png([1], 'a.png'))
  f.append('files', png([2, 2], 'b.png'))
  f.append('files', new File([new Uint8Array([3, 3, 3])], 'image.jpg', { type: 'image/jpeg' }))
  const { answer, caches } = await share(f)
  const s = await takeShared(new URL(answer!.headers.get('location')!).searchParams.get('share')!, caches, new URL(SCOPE))
  expect(s!.files.map((x) => x.name.replace(/\d{4}-\d\d-\d\d-\d{6}/, 'T'))).toEqual(['a.png', 'b.png', 'screenshot-T-3.jpg'])
  expect(s!.files.map((x) => x.size)).toEqual([1, 2, 3])
})

test('words and a link shared: they become the message, the link once', async () => {
  const f = new FormData()
  f.append('title', 'Pricing page')
  f.append('text', 'Look at this https://shop.example.test/pricing')
  f.append('url', 'https://shop.example.test/pricing')
  const { answer, caches } = await share(f)
  const s = await takeShared(new URL(answer!.headers.get('location')!).searchParams.get('share')!, caches, new URL(SCOPE))
  expect(s!.files).toEqual([])
  expect(s!.text).toBe('Look at this https://shop.example.test/pricing')
})

test("a share's words: text, then its link unless the text has it; a bare link keeps its title", () => {
  expect(sharedText({ text: 'hello' })).toBe('hello')
  expect(sharedText({ text: 'see', url: 'https://x.test/a' })).toBe('see\nhttps://x.test/a')
  expect(sharedText({ title: 'Page', url: 'https://x.test/a' })).toBe('Page\nhttps://x.test/a')
  expect(sharedText({ url: 'https://x.test/a' })).toBe('https://x.test/a')
  expect(sharedText({ title: 'Only a title' })).toBe('Only a title')
  expect(sharedText({})).toBe('')
})

test('only a POST to ./share is taken; the app opens with "share it again" when the share was unreadable', async () => {
  const other = await share(new FormData(), `${SCOPE}api/action`)
  expect(other.answer).toBeNull()
  // a body that isn't a form
  const listeners: Record<string, (e: any) => void> = {}
  const self: any = { registration: { scope: SCOPE }, navigator: {}, clients: {}, addEventListener: (k: string, fn: any) => (listeners[k] = fn), skipWaiting: () => undefined }
  vm.runInContext(SRC, vm.createContext({ self, caches: memoryCaches(), URL, Response, Request, Promise, JSON, Math, Date, Array }))
  let answer!: Promise<Response>
  listeners.fetch({ request: new Request(`${SCOPE}share`, { method: 'POST', body: 'not a form', headers: { 'content-type': 'text/plain' } }), respondWith: (p: Promise<Response>) => (answer = p) })
  expect((await answer).headers.get('location')).toBe(`${SCOPE}?share=lost`)
})

test('it lands in the chat open last: the task that was open (with an agent), else the space on screen', () => {
  expect(landingChat(snap, 'p:shop', 'SHOP-3')).toEqual({ key: 'SHOP-3/worker', task: 'SHOP-3' })
  expect(landingChat(snap, 'p:shop', null)).toEqual({ key: 'shop', place: 'p:shop' })
  // a task with no agent yet has no box: the space's
  expect(landingChat(snap, 'p:shop', 'SHOP-4')).toEqual({ key: 'shop', place: 'p:shop' })
  expect(landingChat(snap, 'p:everything', 'gone')).toEqual({ key: 'all', place: 'p:everything' })
})

test("landed: the pictures are in that chat's box as thumbnails, the words after what was typed there", () => {
  setDraft('shop', 'about this:')
  land('shop', { files: [png([1]), png([2], 'two.png')], text: 'https://shop.example.test/pricing' })
  expect(getState().ui.files.shop.map((f) => f.name)).toEqual(['Screenshot_20261123-101500.png', 'two.png'])
  expect(getDraft('shop')).toBe('about this:\nhttps://shop.example.test/pricing')
  // words alone, into an empty box
  land('SHOP-3/worker', { files: [], text: 'hello' })
  expect(getDraft('SHOP-3/worker')).toBe('hello')
  expect(getState().ui.files['SHOP-3/worker']).toBeUndefined()
})

test('every manifest (the default, light and dark) carries the same share target, files by POST to ./share', () => {
  const read = (n: string) => JSON.parse(readFileSync(join(import.meta.dir, `../../public/${n}`), 'utf8'))
  const target = read('manifest.webmanifest').share_target
  for (const n of readdirSync(join(import.meta.dir, '../../public')).filter((f) => f.endsWith('.webmanifest'))) expect(read(n).share_target).toEqual(target)
  expect(target).toMatchObject({ action: 'share', method: 'POST', enctype: 'multipart/form-data', params: { text: 'text', url: 'url', title: 'title' } })
  expect(target.params.files[0].name).toBe('files')
  expect(target.params.files[0].accept).toContain('image/*')
  // the worker answers the same path
  expect(SRC).toContain("new URL('share', self.registration.scope)")
})
