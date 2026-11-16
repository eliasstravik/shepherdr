// SHEP-238: opened at ?voice=1, one call starts, the address loses `voice`, and a call already on is only shown.
import { expect, test } from 'bun:test'
import { launcher, wantsCall, withoutVoice } from './launch.ts'

function page(href: string, o: { call?: boolean; may?: boolean } = {}) {
  const did: string[] = []
  let at = href, t = 1000, call = !!o.call
  const launch = launcher({
    inCall: () => call,
    start: () => { call = true; did.push('start') },
    show: () => did.push('show'),
    mayStart: () => o.may ?? true,
    ask: () => did.push('ask'),
    replace: (url) => { at = `https://box.example.ts.net${url}`; did.push(`replace ${url}`) },
    here: () => at,
    now: () => t,
  })
  return { did, launch, at: () => at, later: (ms: number) => void (t += ms), end: () => void (call = false) }
}

test('voice=1 starts a call and the address loses voice', () => {
  const p = page('https://box.example.ts.net/shepherdr/?voice=1')
  expect(p.launch(p.at())).toBe(true)
  expect(p.did).toEqual(['replace /shepherdr/', 'start'])
  expect(p.at()).toBe('https://box.example.ts.net/shepherdr/')
})

test('the rest of the address stays', () => {
  expect(withoutVoice('https://h/shepherdr/?place=shop&voice=1#x')).toBe('/shepherdr/?place=shop#x')
  expect(withoutVoice('https://h/shepherdr/?place=shop')).toBeNull()
})

test('the same launch twice (load and launch queue) starts one call', () => {
  const p = page('https://box.example.ts.net/shepherdr/?voice=1')
  const href = p.at()
  p.launch(href)
  p.end() // even had it ended at once
  p.launch(href)
  expect(p.did.filter((d) => d === 'start')).toEqual(['start'])
})

test('a reload after it starts none: voice is gone from the address', () => {
  const p = page('https://box.example.ts.net/shepherdr/?voice=1')
  p.launch(p.at())
  p.end()
  p.later(60_000)
  expect(p.launch(p.at())).toBe(false)
  expect(p.did.filter((d) => d === 'start')).toHaveLength(1)
})

test('a call already on is shown, not started again', () => {
  const p = page('https://box.example.ts.net/shepherdr/', { call: true })
  p.launch('https://box.example.ts.net/shepherdr/?voice=1')
  expect(p.did).toEqual(['show'])
})

test('a later wake word in the open window starts a new call once the last ended', () => {
  const p = page('https://box.example.ts.net/shepherdr/')
  p.launch('https://box.example.ts.net/shepherdr/?voice=1')
  p.end()
  p.later(60_000)
  p.launch('https://box.example.ts.net/shepherdr/?voice=1')
  expect(p.did).toEqual(['start', 'start'])
})

test('no tap allowed yet: the big button asks, no call fails silently', () => {
  const p = page('https://box.example.ts.net/shepherdr/?voice=1', { may: false })
  p.launch(p.at())
  expect(p.did).toEqual(['replace /shepherdr/', 'ask'])
})

test('without voice nothing happens', () => {
  const p = page('https://box.example.ts.net/shepherdr/?place=shop')
  expect(p.launch(p.at())).toBe(false)
  expect(p.did).toEqual([])
  expect(wantsCall('https://h/?voice=0')).toBe(false)
  expect(wantsCall('https://h/?voice')).toBe(true)
})
