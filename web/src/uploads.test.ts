import { expect, test } from 'bun:test'
import { backoff, GIVE_UP, HttpError, postFile, retrying, transient } from './uploads.ts'

// SHEP-93: a phone on 5G loses its connection mid-upload, a proxy in front answers 502, a request times out: each goes
// again by itself; the server's own no (a file too big) does not
test('what is worth trying again by itself', () => {
  expect(transient(new TypeError('Load failed'))).toBe(true)
  expect(transient(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true)
  expect(transient(new HttpError(502, 'Bad Gateway'))).toBe(true)
  expect(transient(new HttpError(400, 'A file of at most 25 MB.'))).toBe(false)
  expect(transient(new Error("That agent isn't running."))).toBe(false)
})

/** a fake clock and naps that only move it */
function clock() {
  let t = 0
  return { now: () => t, nap: async (ms: number) => void (t += ms), naps: () => t }
}

/** Shepherdr's upload as a fake fetch: drops = how many tries the network cuts off first */
function server(drops: number, status = 200) {
  let tries = 0
  const got: number[] = []
  const f = (async (_url: string, init: RequestInit) => {
    tries++
    if (tries <= drops) throw new TypeError('Load failed')
    const file = (init.body as FormData).get('file') as File
    got.push(file.size)
    return new Response(JSON.stringify(status === 200 ? { path: `/attach/web-${tries}-${file.name}` } : { error: 'A file of at most 25 MB.' }), { status })
  }) as unknown as typeof fetch
  return { f, tries: () => tries, got }
}

test('eleven large pictures over a network that drops: each goes up, by itself, once', async () => {
  const c = clock()
  const pics = Array.from({ length: 11 }, (_, i) => new File([new Uint8Array(5 * 1024 * 1024)], `IMG_${1000 + i}.jpeg`, { type: 'image/jpeg' }))
  const s = server(3)
  const waits: boolean[] = []
  const paths: string[] = []
  for (const p of pics) paths.push(await retrying(() => postFile('p:demo', p, s.f), 0, { now: c.now, nap: c.nap, onWait: (w) => waits.push(w) }))
  expect(paths).toHaveLength(11)
  expect(new Set(paths).size).toBe(11)
  expect(s.got).toEqual(pics.map((p) => p.size))
  expect(s.tries()).toBe(14)
  // it said it waits for the network, then that it goes again
  expect(waits).toEqual([true, true, true, false])
  expect(c.naps()).toBe(backoff(0) + backoff(1) + backoff(2))
})

test("the server's no fails at once, and the network gone for good fails once the time is up", async () => {
  const c = clock()
  await expect(retrying(() => postFile('p:demo', new File(['x'], 'a.png'), server(0, 400).f), 0, { now: c.now, nap: c.nap })).rejects.toThrow('at most 25 MB')
  expect(c.naps()).toBe(0)
  const gone = server(Infinity)
  await expect(retrying(() => postFile('p:demo', new File(['x'], 'a.png'), gone.f), 0, { now: c.now, nap: c.nap })).rejects.toThrow('Load failed')
  expect(c.naps()).toBeGreaterThan(GIVE_UP)
})
