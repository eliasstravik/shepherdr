import { Database } from 'bun:sqlite'
import { LOCK_WAIT } from './store.ts'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CoreError, Refusal } from './client.ts'
import { seal, unseal, type Envelope, type MailCredential } from './envelope.ts'

export interface DocConnection {
  call<T>(method: string, params: Record<string, unknown>): Promise<T>
}
export interface MailRequest { action: string; args: unknown; created: number; expires: number }
export type MailResponse = { ok: true; value: unknown } | { ok: false; error: string; uncertain?: boolean }
type Queue = Record<string, Envelope>
type Doc = { version: number; value: unknown }
export interface Grant {
  id: string
  /** Server-issued identity and access; never read from labels or request text. */
  chat: string
  session: string
  machine: string
  actions: string[]
  credential: MailCredential
}
type GrantRow = { id: string; chat: string; session: string; machine: string; actions: string; credential: string }
type JournalRow = { hash: string; response: string | null }
const queueName = (grant: string, direction: 'q' | 'a') => `shep-${direction}-${grant}`
export const mailRequestHash = (request: Pick<MailRequest, 'action' | 'args'>) => createHash('sha256').update(JSON.stringify([request?.action, request?.args])).digest('hex')

function queue(value: unknown): Queue {
  if (value === null) return Object.create(null) as Queue
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32) throw new Error('Invalid mailbox queue')
  const result: Queue = Object.create(null)
  for (const [id, envelope] of Object.entries(value)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid mailbox request id')
    result[id] = envelope as Envelope
  }
  return result
}

/** Optimistic writes are retried only after a fresh read. The caller supplies a stable request id. */
async function changeDoc(connection: DocConnection, name: string, on: string | undefined, change: (value: Queue) => Queue) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const doc = await connection.call<Doc>('doc.get', { name, on })
    const value = change(queue(doc.value))
    if (Buffer.byteLength(JSON.stringify(value)) > 900_000) throw new Error('Mailbox is full')
    try { await connection.call('doc.set', { name, on, value, version: doc.version }); return }
    catch (error) {
      if (!(error instanceof CoreError) || !['conflict', 'uncertain'].includes(error.kind)) throw error
      // After an uncertain write the new read may already contain our request/result.
    }
  }
  throw new Error('Mailbox changed too often; try again with the same request id')
}

/** Durable capability and response journal, private to this Shepherdr installation. */
export class Mailbox {
  private db: Database
  private busy = new Set<string>()
  private again = new Set<string>()
  private processing = new Map<string, Promise<void>>()
  private replies = new Map<string, Promise<void>>()
  private waiting = new Set<string>()
  private closed = false
  readonly server: string
  constructor(home: string, private readonly connection: DocConnection,
    private readonly route: (machineId: string) => Promise<string | undefined>,
    private readonly dispatch: (grant: Grant, request: MailRequest, requestId: string) => Promise<unknown>) {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const path = join(home, 'mailbox.sqlite')
    this.db = new Database(path, { create: true })
    chmodSync(path, 0o600)
    this.db.exec(`PRAGMA busy_timeout=${LOCK_WAIT}; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), server TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, chat TEXT NOT NULL, session TEXT NOT NULL,
        machine TEXT NOT NULL, actions TEXT NOT NULL, credential TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS requests (grant_id TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL,
        response TEXT, PRIMARY KEY(grant_id,id));`)
    this.db.query('INSERT OR IGNORE INTO identity VALUES(1,?)').run(randomUUID())
    this.server = (this.db.query('SELECT server FROM identity WHERE id=1').get() as { server: string }).server
  }

  issue(chat: string, session: string, machine: string, actions: string[]): Grant {
    const id = randomBytes(10).toString('hex')
    const credential: MailCredential = { version: 1, server: this.server, grant: id, machine, key: randomBytes(32).toString('base64') }
    this.db.transaction(() => {
      this.db.query('UPDATE grants SET revoked=1 WHERE chat=? AND revoked=0').run(chat)
      this.db.query('INSERT INTO grants(id,chat,session,machine,actions,credential) VALUES(?,?,?,?,?,?)')
        .run(id, chat, session, machine, JSON.stringify(actions), JSON.stringify(credential))
    })()
    return { id, chat, session, machine, actions, credential }
  }

  revoke(chat: string) { this.db.query('UPDATE grants SET revoked=1 WHERE chat=?').run(chat) }
  permits(id: string, identity: { chat: string; session: string; machine: string }, action: string) {
    const grant = this.get(id)
    return !!grant && grant.chat === identity.chat && grant.session === identity.session && grant.machine === identity.machine && grant.actions.includes(action)
  }
  active(): Grant[] {
    if (this.closed) return []
    return (this.db.query('SELECT * FROM grants WHERE revoked=0').all() as GrantRow[]).map(row => this.grant(row))
  }
  /** Call after subscribing, every missed/reconnect, and each matching doc event. */
  async resync() { await Promise.allSettled(this.active().map(grant => this.receive(grant.id))) }
  async event(name: string, machine: string | undefined) {
    if (!name.startsWith('shep-q-')) return
    const grant = this.get(name.slice(7))
    // Events carry the configured alias; grants carry stable server-recorded machine ids.
    if (grant && await this.route(grant.machine) === machine) await this.receive(grant.id)
  }

  async receive(id: string): Promise<void> {
    if (this.closed) return
    if (this.busy.has(id)) { this.again.add(id); return }
    this.busy.add(id)
    const jobs: Promise<void>[] = []
    try {
      do {
        this.again.delete(id)
        const grant = this.get(id)
        if (!grant) return
        // route resolves stable, server-recorded machine ids against the current core machine list.
        const on = await this.route(grant.machine)
        const doc = await this.connection.call<Doc>('doc.get', { name: queueName(id, 'q'), on })
        const requests = queue(doc.value)
        for (const [requestId, envelope] of Object.entries(requests)) {
          const key = `${id}:${requestId}`
          if (this.processing.has(key)) continue
          if (this.processing.size >= 128) { this.waiting.add(id); break }
          // A permission can wait for a human without blocking status, other questions, or new requests.
          const job = this.respond(grant, requestId, envelope, on).finally(() => {
            this.processing.delete(key)
            if (!this.closed && this.waiting.size) {
              const waiting = [...this.waiting]; this.waiting.clear()
              for (const pending of waiting) void this.receive(pending).catch(() => {})
            }
          })
          this.processing.set(key, job); jobs.push(job)
          void job.catch(() => {}) // A later snapshot/event retries publication from the durable journal.
        }
      } while (this.again.has(id))
    } finally { this.busy.delete(id) }
    await Promise.allSettled(jobs)
  }

  private async respond(grant: Grant, id: string, envelope: Envelope, on: string | undefined) {
    const response = await this.process(grant, id, envelope)
    if (!response || this.closed || !this.get(grant.id)) return
    // Only answer publication is serialized. Read the current queue so an old long-running request
    // cannot discard replies belonging to requests added after it began.
    const previous = this.replies.get(grant.id) ?? Promise.resolve()
    const publish = previous.catch(() => {}).then(async () => {
      if (this.closed || !this.get(grant.id)) return
      const latest = queue((await this.connection.call<Doc>('doc.get', { name: queueName(grant.id, 'q'), on })).value)
      if (!latest[id]) return
      await changeDoc(this.connection, queueName(grant.id, 'a'), on, answers => {
        const next: Queue = Object.create(null)
        for (const key of Object.keys(latest)) if (answers[key]) next[key] = answers[key]
        next[id] = response
        return next
      })
    })
    this.replies.set(grant.id, publish)
    try { await publish } finally { if (this.replies.get(grant.id) === publish) this.replies.delete(grant.id) }
  }

  close() { this.closed = true; this.db.close() }
  private get(id: string): Grant | undefined {
    if (this.closed) return
    const row = this.db.query('SELECT * FROM grants WHERE id=? AND revoked=0').get(id) as GrantRow | null
    return row ? this.grant(row) : undefined
  }
  private grant(row: GrantRow): Grant {
    return { ...row, actions: JSON.parse(row.actions), credential: JSON.parse(row.credential) }
  }

  private async process(grant: Grant, id: string, envelope: Envelope): Promise<Envelope | undefined> {
    let request: MailRequest
    try { request = unseal<MailRequest>(grant.credential, id, 'request', envelope) } catch { return }
    // Time metadata can change on a retry after a reply was consumed. Identity binds the actual action and input.
    const hash = mailRequestHash(request)
    const previous = this.db.query('SELECT hash,response FROM requests WHERE grant_id=? AND id=?').get(grant.id, id) as JournalRow | null
    if (previous) {
      if (previous.hash !== hash) return
      return previous.response ? JSON.parse(previous.response) : seal(grant.credential, `${id}:${hash}`, 'response', {
        ok: false, uncertain: true, error: 'This request was interrupted. Check its outcome before issuing another.',
      } satisfies MailResponse)
    }
    let result: MailResponse
    const now = Date.now()
    if (!request || typeof request.action !== 'string' || !Number.isSafeInteger(request.created) || !Number.isSafeInteger(request.expires) || request.created > now + 60_000 || request.expires <= now || request.expires - request.created > 24 * 60 * 60_000) {
      result = { ok: false, error: 'Invalid or expired request' }
    } else if (!grant.actions.includes(request.action) || !this.get(grant.id)) {
      result = { ok: false, error: 'This session is not allowed to perform that action' }
    } else {
      // Commit the claim BEFORE effects. A crash cannot silently re-execute a merge or permission answer.
      this.db.query('INSERT INTO requests(grant_id,id,hash) VALUES(?,?,?)').run(grant.id, id, hash)
      try { result = { ok: true, value: await this.dispatch(grant, request, id) } }
      catch (error) { result = error instanceof Refusal ? { ok: false, error: error.message } : { ok: false, uncertain: true, error: 'The action failed. Check its outcome before trying again.' } }
    }
    if (this.closed) return
    const response = seal(grant.credential, `${id}:${hash}`, 'response', result)
    this.db.query('INSERT INTO requests(grant_id,id,hash,response) VALUES(?,?,?,?) ON CONFLICT(grant_id,id) DO UPDATE SET response=excluded.response')
      .run(grant.id, id, hash, JSON.stringify(response))
    return response
  }
}

/** Agent side, on its own machine's core. The credential is a protected file supplied at launch. */
export async function requestMail(connection: DocConnection, credential: MailCredential, action: string, args: unknown,
  options: { id?: string; timeout?: number; signal?: AbortSignal } = {}): Promise<unknown> {
  const id = options.id ?? randomUUID()
  options.signal?.throwIfAborted()
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid mailbox request id')
  const timeout = options.timeout ?? 60_000
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 24 * 60 * 60_000) throw new Error('Invalid mailbox timeout')
  const now = Date.now()
  const envelope = seal(credential, id, 'request', { action, args, created: now, expires: now + timeout } satisfies MailRequest)
  await changeDoc(connection, queueName(credential.grant, 'q'), undefined, value => {
    if (value[id]) {
      const previous = unseal<MailRequest>(credential, id, 'request', value[id])
      if (previous.action !== action || JSON.stringify(previous.args) !== JSON.stringify(args)) throw new Error('Request id already belongs to a different action')
      return value
    }
    if (Object.keys(value).length >= 32) throw new Error('Mailbox is full; wait for an earlier request')
    return { ...value, [id]: envelope }
  })
  for (;;) {
    if (options.signal?.aborted) throw new CoreError('uncertain', `Request ${id} was published before cancellation; check its outcome`)
    const doc = await connection.call<Doc>('doc.get', { name: queueName(credential.grant, 'a') })
    const answer = queue(doc.value)[id]
    if (answer) {
      // A stale answer for this id must not acknowledge a different action or input.
      const result = unseal<MailResponse>(credential, `${id}:${mailRequestHash({ action, args })}`, 'response', answer)
      await changeDoc(connection, queueName(credential.grant, 'q'), undefined, requests => { delete requests[id]; return requests })
      if (!result.ok) throw new CoreError(result.uncertain ? 'uncertain' : 'refused', result.error)
      return result.value
    }
    if (Date.now() >= now + timeout) throw new CoreError('uncertain', `No response for request ${id}; check its outcome before retrying`)
    await Bun.sleep(250)
  }
}
