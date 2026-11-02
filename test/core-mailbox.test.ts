import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreError } from '../server/core/client.ts'
import { seal, unseal, type MailCredential } from '../server/core/envelope.ts'
import { Mailbox, mailRequestHash, requestMail, type DocConnection, type MailRequest, type MailResponse } from '../server/core/mailbox.ts'

class Documents implements DocConnection {
  docs = new Map<string, { version: number; value: unknown }>()
  async call<T>(method: string, p: Record<string, unknown>): Promise<T> {
    const key = `${p.on ?? ''}:${p.name}`
    const doc = this.docs.get(key) ?? { version: 0, value: null }
    if (method === 'doc.get') return structuredClone(doc) as T
    if (method !== 'doc.set') throw new Error('Unexpected method')
    if (p.version !== doc.version) throw new CoreError('conflict', 'stale version')
    this.docs.set(key, { version: doc.version + 1, value: structuredClone(p.value) })
    return { version: doc.version + 1 } as T
  }
  put(credential: MailCredential, id: string, request: MailRequest, on = 'box') {
    this.docs.set(`${on}:shep-q-${credential.grant}`, { version: 1, value: { [id]: seal(credential, id, 'request', request) } })
  }
  response(credential: MailCredential, id: string): MailResponse {
    const doc = this.docs.get(`box:shep-a-${credential.grant}`)!
    const requests = this.docs.get(`box:shep-q-${credential.grant}`)!.value as Record<string, unknown>
    const request = unseal<MailRequest>(credential, id, 'request', requests[id])
    return unseal(credential, `${id}:${mailRequestHash(request)}`, 'response', (doc.value as Record<string, unknown>)[id])
  }
}

test('authenticated scope is server-issued, restricted, durable, and independently revocable', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-mail-test-'))
  const docs = new Documents()
  const effects: string[] = []
  const dispatch = async (grant: { chat: string }) => { effects.push(grant.chat); return 'done' }
  const route = async (machine: string) => { if (machine !== 'trusted-machine-id') throw new Error('Unknown machine'); return 'box' }
  let mailbox = new Mailbox(home, docs, route, dispatch)
  try {
    const grant = mailbox.issue('TASK-1/Agent', 'session-1', 'trusted-machine-id', ['status'])
    const other = mailbox.issue('TASK-2/Agent', 'session-2', 'trusted-machine-id', ['status'])
    const id = randomUUID()
    const request = { action: 'status', args: { chat: 'FORGED/Agent', role: 'coordinator' }, created: Date.now(), expires: Date.now() + 60_000 }
    docs.put(grant.credential, id, request)
    await mailbox.receive(grant.id)
    expect(effects).toEqual(['TASK-1/Agent'])
    expect(docs.response(grant.credential, id)).toEqual({ ok: true, value: 'done' })
    mailbox.close(); mailbox = new Mailbox(home, docs, route, dispatch)
    await mailbox.resync()
    expect(effects).toHaveLength(1) // Reply recovered without repeating the side effect.
    docs.docs.delete(`box:shep-a-${grant.id}`)
    docs.put(grant.credential, id, { ...request, created: Date.now() + 1, expires: Date.now() + 60_001 })
    await mailbox.event(`shep-q-${grant.id}`, 'box')
    expect(effects).toHaveLength(1)
    expect(docs.response(grant.credential, id)).toEqual({ ok: true, value: 'done' })
    const deniedId = randomUUID()
    docs.put(grant.credential, deniedId, { ...request, action: 'secret' })
    await mailbox.receive(grant.id)
    expect(docs.response(grant.credential, deniedId).ok).toBe(false)
    expect(effects).toHaveLength(1)
    mailbox.issue('TASK-1/Agent', 'new-session', 'trusted-machine-id', ['status'])
    docs.put(grant.credential, randomUUID(), request)
    await mailbox.receive(grant.id)
    expect(effects).toHaveLength(1)
    expect(mailbox.active().map(g => g.id)).toContain(other.id)
    expect(statSync(join(home, 'mailbox.sqlite')).mode & 0o077).toBe(0)
  } finally { mailbox.close(); rmSync(home, { recursive: true, force: true }) }
})

test('forged machine/document credentials do not dispatch or expose a reply', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-mail-forge-'))
  const docs = new Documents()
  let called = 0
  const mailbox = new Mailbox(home, docs, async () => 'box', async () => { called++; return true })
  try {
    const grant = mailbox.issue('TASK-1/Agent', 'session', 'machine-id', ['secret'])
    const id = randomUUID()
    const forged = { ...grant.credential, key: Buffer.alloc(32, 9).toString('base64') }
    docs.put(forged, id, { action: 'secret', args: {}, created: Date.now(), expires: Date.now() + 60_000 })
    await mailbox.receive(grant.id)
    expect(called).toBe(0)
    expect(docs.docs.has(`box:shep-a-${grant.id}`)).toBe(false)
    const valid = { action: 'secret', args: {}, created: Date.now(), expires: Date.now() + 60_000 }
    docs.put(grant.credential, id, valid)
    await mailbox.event(`shep-q-${grant.id}`, 'untrusted-machine-id')
    expect(called).toBe(0)
  } finally { mailbox.close(); rmSync(home, { recursive: true, force: true }) }
})

test('a claimed request interrupted by a crash is uncertain and never run twice', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-mail-crash-'))
  const docs = new Documents()
  let called = 0
  const mailbox = new Mailbox(home, docs, async () => 'box', async () => { called++; return true })
  try {
    const grant = mailbox.issue('TASK-1/Agent', 'session', 'machine', ['merge'])
    const id = randomUUID()
    const request = { action: 'merge', args: {}, created: Date.now(), expires: Date.now() + 60_000 }
    docs.put(grant.credential, id, request)
    const db = new Database(join(home, 'mailbox.sqlite'))
    db.query('INSERT INTO requests(grant_id,id,hash) VALUES(?,?,?)').run(grant.id, id, createHash('sha256').update(JSON.stringify([request.action, request.args])).digest('hex'))
    db.close()
    await mailbox.receive(grant.id)
    expect(docs.response(grant.credential, id)).toMatchObject({ ok: false, uncertain: true })
    expect(called).toBe(0)
  } finally { mailbox.close(); rmSync(home, { recursive: true, force: true }) }
})

test('a consumed id cannot acknowledge a different action from a stale encrypted response', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-mail-stale-'))
  const docs = new Documents()
  let called = 0
  const mailbox = new Mailbox(home, docs, async () => 'box', async () => { called++; return 'done' })
  try {
    const grant = mailbox.issue('TASK-1/Agent', 'session', 'machine', ['status', 'merge'])
    const id = randomUUID()
    docs.put(grant.credential, id, { action: 'status', args: {}, created: Date.now(), expires: Date.now() + 60_000 })
    await mailbox.receive(grant.id)
    docs.docs.set(`box:shep-q-${grant.id}`, { version: 2, value: {} })
    const remote: DocConnection = { call: (method, params) => docs.call(method, { ...params, on: 'box' }) }
    await expect(requestMail(remote, grant.credential, 'merge', {}, { id, timeout: 1000 })).rejects.toThrow()
    expect(called).toBe(1)
  } finally { mailbox.close(); rmSync(home, { recursive: true, force: true }) }
})

test('a waiting permission does not block status or lose newer replies', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-mail-concurrent-'))
  const docs = new Documents()
  let release!: () => void, entered!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const effects: string[] = []
  const mailbox = new Mailbox(home, docs, async () => 'box', async (_grant, request) => {
    effects.push(request.action)
    if (request.action === 'permission') { entered(); await waiting }
    return request.action
  })
  try {
    const grant = mailbox.issue('TASK-1/Agent', 'session', 'machine', ['permission', 'status'])
    const first = randomUUID(), second = randomUUID()
    const request = (action: string): MailRequest => ({ action, args: {}, created: Date.now(), expires: Date.now() + 60_000 })
    docs.put(grant.credential, first, request('permission'))
    const pending = mailbox.receive(grant.id)
    await started
    const queue = docs.docs.get(`box:shep-q-${grant.id}`)!
    ;(queue.value as Record<string, unknown>)[second] = seal(grant.credential, second, 'request', request('status'))
    queue.version++
    await mailbox.receive(grant.id)
    expect(docs.response(grant.credential, second)).toEqual({ ok: true, value: 'status' })
    expect(effects).toEqual(['permission', 'status'])
    release(); await pending
    expect(docs.response(grant.credential, first)).toEqual({ ok: true, value: 'permission' })
    expect(docs.response(grant.credential, second)).toEqual({ ok: true, value: 'status' })
    expect(effects).toHaveLength(2)
  } finally { release(); mailbox.close(); rmSync(home, { recursive: true, force: true }) }
})

test('secret response values stay encrypted in core docs and durable response journal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-mail-secret-')), docs = new Documents()
  const value = 'synthetic-secret-response-value'
  const mailbox = new Mailbox(home, docs, async () => 'box', async () => ({ secrets: { DEMO: value } }))
  try {
    const grant = mailbox.issue('TASK-1/Agent', 'session', 'machine', ['secret']), id = randomUUID()
    docs.put(grant.credential, id, { action: 'secret', args: { names: ['DEMO'] }, created: Date.now(), expires: Date.now() + 60_000 })
    await mailbox.receive(grant.id)
    expect(docs.response(grant.credential, id)).toEqual({ ok: true, value: { secrets: { DEMO: value } } })
    expect(JSON.stringify([...docs.docs.values()])).not.toContain(value)
    const db = new Database(join(home, 'mailbox.sqlite'), { readonly: true })
    try { expect(JSON.stringify(db.query('SELECT * FROM requests').all())).not.toContain(value) } finally { db.close() }
  } finally { mailbox.close(); rmSync(home, { recursive: true, force: true }) }
})
