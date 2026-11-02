import { beforeEach, expect, spyOn, test } from 'bun:test'
import webpush from 'web-push'
import { createECDH, randomBytes } from 'node:crypto'
import { Push, pushContact, DEFAULT_PUSH_CONTACT } from '../server/push.ts'
import { writeJson, readJson } from '../server/store.ts'
import { Settings } from '../server/common/settings.ts'

const alert = { id: 'fake', from: 'fake', go: { place: '~' }, title: 'Test', body: 'Only fake delivery', tag: 'test' }
const sub = (id: string) => ({ endpoint: `https://push.example/${id}`, keys: { auth: 'private', p256dh: 'private' } })
const response = { statusCode: 201, body: '', headers: {} }
const name = () => 'a phone'
beforeEach(() => writeJson('push.json', []))

test('valid contact, stable keys and per-instance signing options', async () => {
  for (const bad of ['mailto:shepherdr@localhost', 'https://localhost', 'https://127.0.0.1', 'http://example.com', 'garbage']) expect(pushContact(bad)).toBe(DEFAULT_PUSH_CONTACT)
  expect(pushContact('mailto:admin@example.com')).toBe('mailto:admin@example.com')
  expect(pushContact('https://example.com/contact')).toBe('https://example.com/contact')
  const calls: webpush.RequestOptions[] = []
  const sender: typeof webpush.sendNotification = async (_s, _b, opts) => { calls.push(opts!); return response }
  const a = new Push('mailto:shepherdr@localhost', sender)
  a.subscribe(sub('a'), 'private browser user agent')
  const keys = readJson('vapid.json', {})
  const b = new Push('mailto:admin@example.com', sender)
  expect(b.publicKey).toBe(a.publicKey)
  expect(readJson('vapid.json', {})).toEqual(keys)
  await a.send(alert)
  await b.send(alert)
  expect(calls[0]?.vapidDetails?.subject).toBe(DEFAULT_PUSH_CONTACT)
  expect(calls[1]?.vapidDetails?.subject).toBe('mailto:admin@example.com')
})

test('partial success, private errors, quiet repeats, skipped devices and recovery', async () => {
  let fail = true
  const log = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const push = new Push(undefined, async (s) => {
      if (s.endpoint.endsWith('/a') && fail) throw { statusCode: 403, body: 'secret endpoint and payload', message: 'private' }
      return response
    })
    push.subscribe(sub('a'), 'private user agent')
    push.subscribe(sub('b'), 'private user agent')
    await push.send(alert)
    expect(push.warnings(name)).toEqual(['Device 1 (a phone): Push service rejected the alert (HTTP 403).'])
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private|https:/)
    await push.send(alert)
    expect(log).toHaveBeenCalledTimes(1)
    fail = false
    await push.send(alert, new Set([sub('a').endpoint]))
    expect(push.warnings(name)).toHaveLength(1)
    const rows = new Settings().sections(push.devices, [], null, undefined, [], undefined, undefined, push.warnings(name)).flatMap(s => s.rows)
    expect(rows.find(r => r.key === 'alerts')?.warn).toContain('1 device could not receive')
    await push.send(alert)
    expect(push.warnings(name)).toEqual([])
  } finally { log.mockRestore() }
})

test('404/410 remove expired subscriptions, other failures stay until same device succeeds or resubscribes', async () => {
  const push = new Push(undefined, async (s) => { throw { statusCode: s.endpoint.endsWith('/a') ? 404 : s.endpoint.endsWith('/b') ? 410 : 503 } })
  for (const id of ['a', 'b', 'c']) push.subscribe(sub(id), 'phone')
  await push.send(alert)
  expect(push.devices).toEqual(['phone'])
  expect(readJson<unknown[]>('push.json', [])).toHaveLength(1)
  expect(push.warnings(name)).toHaveLength(1)
  push.subscribe(sub('c'), 'phone')
  expect(push.warnings(name)).toEqual([])
})

test('old in-flight failures cannot remove a renewed subscription or overwrite a newer result', async () => {
  let reject!: (e: unknown) => void
  let first = true
  const push = new Push(undefined, async () => {
    if (first) { first = false; return new Promise((_resolve, no) => { reject = no }) }
    return response
  })
  push.subscribe(sub('a'), 'phone')
  const old = push.send(alert)
  await push.send(alert)
  reject({ statusCode: 403 })
  await old
  expect(push.warnings(name)).toEqual([])
  first = true
  const expired = push.send(alert)
  push.subscribe(sub('a'), 'new phone')
  reject({ statusCode: 410 })
  await expired
  expect(push.devices).toEqual(['new phone'])
})

// Exercise the real signer without opening a socket or sending a notification.
test('real VAPID JWT uses the configured subject without rotating keys', async () => {
  const client = createECDH('prime256v1')
  client.generateKeys()
  let subject = ''
  const push = new Push(undefined, async (subscription, payload, options) => {
    const request = webpush.generateRequestDetails(subscription, payload ?? undefined, options)
    const auth = String(request.headers.Authorization)
    const jwt = /t=([^,]+)/.exec(auth)![1]!
    subject = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).sub
    return response
  })
  push.subscribe({ endpoint: 'https://web.push.apple.com/fake', keys: { p256dh: client.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, 'phone')
  await push.send(alert)
  expect(subject).toBe(DEFAULT_PUSH_CONTACT)
  expect(push.warnings(name)).toEqual([])
})

test('two failing devices remain independent and network errors expose no raw text', async () => {
  let recovered = ''
  const push = new Push(undefined, async (s) => {
    if (s.endpoint.endsWith(recovered) && recovered) return response
    throw new Error('secret URL, auth and payload')
  })
  push.subscribe(sub('a'), 'phone')
  push.subscribe(sub('b'), 'phone')
  await push.send(alert)
  expect(push.warnings(name)).toHaveLength(2)
  expect(push.warnings(name).join()).not.toContain('secret')
  recovered = '/b'
  await push.send(alert)
  expect(push.warnings(name)).toHaveLength(1)
  expect(push.warnings(name)[0]).toContain('Device 1')
})

test('a batched expiry cannot delete a device after a newer send succeeds', async () => {
  let release!: () => void
  let first = true
  const push = new Push(undefined, async (s) => {
    if (first && s.endpoint.endsWith('/a')) throw { statusCode: 410 }
    if (first && s.endpoint.endsWith('/b')) return new Promise(resolve => { release = () => resolve(response) })
    return response
  })
  push.subscribe(sub('a'), 'phone')
  push.subscribe(sub('b'), 'mac')
  const old = push.send(alert)
  await Promise.resolve()
  first = false
  await push.send(alert)
  release()
  await old
  expect(push.devices).toEqual(['phone', 'mac'])
})
