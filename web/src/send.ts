// Sending a message: it shows in the chat the moment you send it (the outbox), goes again by itself while the network
// is the trouble, and keeps its words for Retry when it did not go through. Files go up as they are attached; a
// message waits for its files, and for the ones sent before it in its chat.
import type { ReplyQuote } from '@shared/types.ts'
import { act, getState, holdReload, notice, setOutbox, setUI, type Outgoing } from './kernel.ts'
import { anchorOf, priorOf, reasonOf, SEND_TIMEOUT } from './outbox.ts'
import { postFile, retrying } from './uploads.ts'

/** an id of the screen's own (randomUUID needs https, and a tailnet link may be plain http) */
const newCid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** up to 25 MB each */
export const MAX_FILE = 25 * 1024 * 1024

const uploads = new Map<string, Promise<string>>()
const gates = new Map<string, Promise<void>>()

/** what this screen still has of a file it put in a box: the file itself, a link to it for its picture and, once
 *  read, the picture's size (so a sent copy keeps its box before the picture has drawn) */
const local = new Map<string, { file: File; url: string; w?: number; h?: number }>()
/** the box file an uploaded path came from: the delivered message names only the path, and finds the same copy */
const fromPath = new Map<string, string>()
export const localOf = (id: string | undefined, path?: string) => (id ? local.get(id) : undefined) ?? (path ? local.get(fromPath.get(path) ?? '') : undefined)

const setBox = (key: string, fn: (fs: UIFile[]) => UIFile[]) => setUI((ui) => ({ files: { ...ui.files, [key]: fn(ui.files[key] ?? []) } }))
type UIFile = ReturnType<typeof getState>['ui']['files'][string][number]

function upload(key: string, chat: string, id: string, f: File) {
  const up = retrying(() => postFile(chat, f), Date.now())
  uploads.set(id, up)
  up.then(
    (path) => {
      fromPath.set(path, id)
      setBox(key, (fs) => fs.map((x) => (x.id === id ? { ...x, path, failed: undefined } : x)))
    },
    (e) => {
      // it stays in the box and says so on its tile: a tap tries again, its x takes it out
      uploads.delete(id)
      setBox(key, (fs) => fs.map((x) => (x.id === id ? { ...x, failed: reasonOf(e) || 'It did not go up' } : x)))
    },
  )
}

/** put files in a message box: each shows as a thumbnail at once and goes up meanwhile */
export function attach(key: string, chat: string, files: File[]) {
  for (const f of files) {
    if (f.size > MAX_FILE) {
      notice(`${f.name} is over 25 MB.`)
      continue
    }
    const id = newCid()
    let url = ''
    try {
      url = URL.createObjectURL(f)
    } catch {
      /* no object links here: its tile waits for the upload */
    }
    const l: { file: File; url: string; w?: number; h?: number } = { file: f, url }
    local.set(id, l)
    if (url && f.type.startsWith('image/') && typeof Image === 'function') {
      const img = new Image()
      img.onload = () => {
        l.w = img.naturalWidth
        l.h = img.naturalHeight
      }
      img.src = url
    }
    setBox(key, (fs) => [...fs, { name: f.name, id }])
    upload(key, chat, id, f)
  }
}

/** try a failed upload again */
export function reupload(key: string, chat: string, id: string) {
  const l = local.get(id)
  if (!l) return
  setBox(key, (fs) => fs.map((x) => (x.id === id ? { ...x, failed: undefined } : x)))
  upload(key, chat, id, l.file)
}

export function detach(key: string, index: number) {
  const gone = getState().ui.files[key]?.[index]
  if (gone?.id) {
    const l = local.get(gone.id)
    if (l?.url) URL.revokeObjectURL(l.url)
    local.delete(gone.id)
    uploads.delete(gone.id)
  }
  setBox(key, (fs) => fs.filter((_, i) => i !== index))
}

async function deliver(cid: string, pending: Promise<string>[]) {
  const first = getState().outbox.find((x) => x.cid === cid)
  if (!first || first.state !== 'sending') return
  let opened!: () => void
  const mine = new Promise<void>((r) => (opened = r))
  const before = getState()
    .outbox.filter((x) => x.chat === first.chat && x.cid !== cid && x.state === 'sending' && x.at <= first.at)
    .map((x) => gates.get(x.cid))
    .filter(Boolean)
  gates.set(cid, mine)
  const patch = (p: (x: Outgoing) => Partial<Outgoing>) => setOutbox((all) => all.map((x) => (x.cid === cid && x.state === 'sending' ? { ...x, ...p(x) } : x)))
  try {
    const paths = await Promise.all(pending)
    const files = first.files.map((f, i) => ({ ...f, path: paths[i] ?? f.path }))
    if (pending.length) patch(() => ({ files }))
    await Promise.all(before)
    const o = getState().outbox.find((x) => x.cid === cid)
    if (!o || o.state !== 'sending') return
    // a reload now would cut it off on its way
    const release = holdReload()
    let r: { waiting?: boolean; waitsFor?: Outgoing['waitsFor']; at?: number }
    try {
      r = await retrying(
        () => act<typeof r>({ type: 'send', chat: o.chat, text: o.text, attachments: files.map((f) => f.path), cid, ...(o.reply?.task ? { replyTask: o.reply.task } : { reply: o.reply?.id }), human: true, ...(o.hold ? { hold: true } : {}), ...(o.was ? { was: o.was } : {}) }, AbortSignal.timeout(SEND_TIMEOUT)),
        first.at,
        { onWait: (offline) => patch((x) => (!!x.offline === offline ? {} : { offline: offline || undefined })) },
      )
    } finally {
      release()
    }
    const serverAt = typeof r?.at === 'number' ? r.at : undefined
    patch((x) => ({ state: 'sent', error: undefined, offline: undefined, serverAt, ...(x.queued || x.wentAt ? {} : { waiting: r?.waiting || undefined, waitsFor: (r?.waiting && r.waitsFor) || undefined }) }))
  } catch (e) {
    patch(() => ({ state: 'failed', error: reasonOf(e), offline: undefined }))
  } finally {
    gates.delete(cid)
    opened()
  }
}

/** Send what a box holds: its words, its files and the message it replies to. `hold`: the agent is working, so it
 *  waits its turn and is delivered when the agent is free. */
export function send(key: string, chat: string, text: string, hold = false) {
  const s = getState()
  // one that failed to go up stays out of it (its tile said so)
  const boxed = (s.ui.files[key] ?? []).filter((f) => !f.failed)
  const reply = s.ui.reply[key] as (ReplyQuote & { id: string }) | undefined
  if (!text.trim() && !boxed.length) return
  const cid = newCid()
  const pending = boxed.map((f) => (f.path ? Promise.resolve(f.path) : (uploads.get(f.id ?? '') ?? Promise.reject(new Error('The file is gone.')))))
  const out: Outgoing = {
    cid,
    chat,
    text: text.trim(),
    files: boxed.map((f) => ({ name: f.name, path: f.path ?? '', ...(f.id ? { id: f.id } : {}) })),
    reply,
    at: Date.now(),
    prior: priorOf(s.chats[chat]),
    after: anchorOf(s.chats[chat]),
    before: s.outbox.filter((x) => x.chat === chat).map((x) => x.cid),
    state: 'sending',
    ...(hold ? { hold: true } : {}),
  }
  setOutbox((all) => [...all, out])
  const { [key]: _f, ...files } = s.ui.files
  const { [key]: _r, ...replies } = s.ui.reply
  setUI({ files, reply: replies })
  void deliver(cid, pending)
}

/** send again what didn't go through: it moves down to the end, like a new message */
export function retry(cid: string) {
  const s = getState()
  const o = s.outbox.find((x) => x.cid === cid)
  if (!o) return
  // one that went in but didn't show up goes as a new message, naming the first: the server sends it again only when
  // the agent's log doesn't have the first after all (it came back late: never twice)
  const again: Outgoing = { ...o, cid: o.lost ? newCid() : o.cid, was: o.lost ? (o.was ?? o.cid) : o.was, state: 'sending', error: undefined, lost: undefined, waiting: undefined, waitsFor: undefined, queued: undefined, serverAt: undefined, wentAt: undefined, busyAt: undefined, pastAt: undefined, offline: undefined, at: Date.now(), prior: priorOf(s.chats[o.chat]), after: anchorOf(s.chats[o.chat]), before: s.outbox.filter((x) => x.chat === o.chat && x.cid !== cid).map((x) => x.cid) }
  setOutbox((all) => all.map((x) => (x.cid === cid ? again : x)))
  void deliver(again.cid, [])
}

export const dropOut = (cid: string) => setOutbox((all) => all.filter((x) => x.cid !== cid))

/** a reload (or the phone dropping the page) cut these off on their way: they go on with the same id, which the
 *  server answers once (a send asked again never goes twice). Ones whose files had not gone up yet fail in time. */
export function resumeSending() {
  for (const o of getState().outbox) if (o.state === 'sending' && !gates.has(o.cid) && o.files.every((f) => f.path)) void deliver(o.cid, [])
}
if (typeof window !== 'undefined') setTimeout(resumeSending, 0)
