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

/** put files in a message box: each shows as a chip at once and goes up meanwhile */
export function attach(key: string, chat: string, files: File[]) {
  for (const f of files) {
    if (f.size > MAX_FILE) {
      notice(`${f.name} is over 25 MB.`)
      continue
    }
    const id = newCid()
    const since = Date.now()
    const up = retrying(() => postFile(chat, f), since)
    uploads.set(id, up)
    setUI((ui) => ({ files: { ...ui.files, [key]: [...(ui.files[key] ?? []), { name: f.name, id }] } }))
    up.then(
      (path) => setUI((ui) => ({ files: { ...ui.files, [key]: (ui.files[key] ?? []).map((x) => (x.id === id ? { ...x, path } : x)) } })),
      (e) => {
        notice(`${f.name} could not be added: ${reasonOf(e)}`)
        uploads.delete(id)
        setUI((ui) => ({ files: { ...ui.files, [key]: (ui.files[key] ?? []).filter((x) => x.id !== id) } }))
      },
    )
  }
}

export function detach(key: string, index: number) {
  setUI((ui) => ({ files: { ...ui.files, [key]: (ui.files[key] ?? []).filter((_, i) => i !== index) } }))
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
        () => act<typeof r>({ type: 'send', chat: o.chat, text: o.text, attachments: files.map((f) => f.path), cid, reply: o.reply?.id, human: true, ...(o.hold ? { hold: true } : {}) }, AbortSignal.timeout(SEND_TIMEOUT)),
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
  const boxed = s.ui.files[key] ?? []
  const reply = s.ui.reply[key] as (ReplyQuote & { id: string }) | undefined
  if (!text.trim() && !boxed.length) return
  const cid = newCid()
  const pending = boxed.map((f) => (f.path ? Promise.resolve(f.path) : (uploads.get(f.id ?? '') ?? Promise.reject(new Error('The file is gone.')))))
  const out: Outgoing = {
    cid,
    chat,
    text: text.trim(),
    files: boxed.map((f) => ({ name: f.name, path: f.path ?? '' })),
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
  const again: Outgoing = { ...o, cid: o.lost ? newCid() : o.cid, state: 'sending', error: undefined, lost: undefined, waiting: undefined, waitsFor: undefined, queued: undefined, serverAt: undefined, wentAt: undefined, busyAt: undefined, pastAt: undefined, offline: undefined, at: Date.now(), prior: priorOf(s.chats[o.chat]), after: anchorOf(s.chats[o.chat]), before: s.outbox.filter((x) => x.chat === o.chat && x.cid !== cid).map((x) => x.cid) }
  setOutbox((all) => all.map((x) => (x.cid === cid ? again : x)))
  void deliver(again.cid, [])
}

export const dropOut = (cid: string) => setOutbox((all) => all.filter((x) => x.cid !== cid))
