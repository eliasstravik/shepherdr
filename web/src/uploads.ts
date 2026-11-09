// What you send from a phone survives its network (SHEP-93): a picture or a send that a dropped connection, a page put
// in the background or a slow upload cut off goes again by itself, a little later or the moment the network is back,
// until it went or GIVE_UP has passed. Pictures picked are kept on the device (IndexedDB) until their message went in,
// so a reload mid-upload still has them. Asking again is safe: the server knows a send by its id and never sends it
// twice (service/actions.ts once).

/** how long a message keeps trying by itself before it says it didn't go (Retry starts it over) */
export const GIVE_UP = 10 * 60_000

/** an answer from Shepherdr that said no, with its status: 5xx from a proxy in front is the network, not a no */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** worth trying again by itself: no network, cut off, timed out, or a proxy in front that couldn't reach Shepherdr */
export function transient(e: unknown): boolean {
  const err = e as Error
  if (err instanceof HttpError) return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 502
  return err instanceof TypeError || err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.name === 'NetworkError'
}

/** the wait before try n+1: 1 s, 2 s, 4 s, 8 s, 15 s, then every 30 s */
export const backoff = (n: number) => [1000, 2000, 4000, 8000, 15000][n] ?? 30000

/** how long one upload may take: a phone on a weak link moves maybe 25 KB a second, and never less than a minute */
export const uploadTimeout = (size: number) => Math.max(60_000, Math.ceil(size / 25_000) * 1000)

/** one try at a file's upload -> its path on Shepherdr's machine */
export async function postFile(chat: string, file: Blob & { name?: string }, f: typeof fetch = fetch): Promise<string> {
  const body = new FormData()
  body.append('chat', chat)
  body.append('file', file, file.name ?? 'file')
  const r = await f('api/upload', { method: 'POST', body, headers: { 'x-shepherdr': '1' }, signal: AbortSignal.timeout(uploadTimeout(file.size)) })
  const text = await r.text()
  let j: { path?: string; error?: string } = {}
  try {
    j = JSON.parse(text)
  } catch {
    /* a proxy's page */
  }
  if (!r.ok || !j.path) throw new HttpError(r.status, j.error ?? (text.trim().slice(0, 80) || `${r.status}`))
  return j.path
}

/* ---------- waking: a try waiting for its turn goes at once when the network or the page is back ---------- */

const sleepers = new Set<() => void>()

/** wait ms, or less: until the network comes back, the page shows again or the live link opens again */
export function nap(ms: number): Promise<void> {
  return new Promise((done) => {
    const wake = () => {
      clearTimeout(t)
      sleepers.delete(wake)
      done()
    }
    const t = setTimeout(wake, ms)
    sleepers.add(wake)
  })
}

/** everything waiting to try again tries now */
export function wakeAll() {
  for (const w of [...sleepers]) w()
}

if (typeof window !== 'undefined') {
  addEventListener('online', wakeAll)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wakeAll())
  addEventListener('pageshow', wakeAll)
}

/** fn until it works, tried again by itself while the trouble is the network and the time isn't up (since: when it
 *  began). onWait: told it waits for the network (true) or goes again (false) */
export async function retrying<T>(fn: () => Promise<T>, since: number, opts: { onWait?: (waiting: boolean) => void; now?: () => number; nap?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const now = opts.now ?? Date.now
  const wait = opts.nap ?? nap
  for (let n = 0; ; n++) {
    try {
      const r = await fn()
      if (n) opts.onWait?.(false)
      return r
    } catch (e) {
      if (!transient(e) || now() - since > GIVE_UP) throw e
      opts.onWait?.(true)
      await wait(backoff(n))
    }
  }
}

/* ---------- kept on the device: the files picked, until their message went in ---------- */

const DB = 'shepherdr-uploads'
const STORE = 'files'
/** a day, like the outbox */
const KEEP = 24 * 60 * 60_000

function db(): Promise<IDBDatabase | null> {
  return new Promise((done) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => done(req.result)
      req.onerror = () => done(null)
    } catch {
      done(null)
    }
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db()
  if (!d) return undefined
  return new Promise((done) => {
    try {
      const t = d.transaction(STORE, mode)
      const r = fn(t.objectStore(STORE))
      t.oncomplete = () => {
        d.close()
        done(r ? r.result : undefined)
      }
      t.onerror = t.onabort = () => {
        d.close()
        done(undefined)
      }
    } catch {
      d.close()
      done(undefined)
    }
  })
}

/** keep a file picked (by its stand-in id) until its message went in; a private window just doesn't */
export const keepFile = (id: string, file: File) => tx('readwrite', (s) => s.put({ file, name: file.name, at: Date.now() }, id))

/** a file kept on the device, by its stand-in id */
export async function keptFile(id: string): Promise<File | undefined> {
  const v = (await tx('readonly', (s) => s.get(id))) as { file?: Blob; name?: string } | undefined
  if (!v?.file) return undefined
  return v.file instanceof File ? v.file : new File([v.file], v.name ?? 'file', { type: v.file.type })
}

/** its message went in (or was taken out): the device lets them go */
export const dropFiles = (ids: string[]) => (ids.length ? tx('readwrite', (s) => void ids.forEach((id) => s.delete(id))) : Promise.resolve(undefined))

/** older than a day: let go */
export async function sweepFiles(now = Date.now()) {
  await tx('readwrite', (s) => {
    const c = s.openCursor()
    c.onsuccess = () => {
      const cur = c.result
      if (!cur) return
      if (now - ((cur.value as { at?: number })?.at ?? 0) > KEEP) cur.delete()
      cur.continue()
    }
  })
}
