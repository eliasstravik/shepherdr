// What you send shows in the chat the moment you tap Send, quietly pending, and stays there until the message comes back
// from the agent's log: the server gives it back the screen's id (cid), and it takes the pending one's place. It goes in
// at once even while the agent works; a busy CLI may keep it until its next step, so it can take a while to come back.
import type { Chat, Message, ReplyQuote } from '@shared/types.ts'
import { GIVE_UP } from './uploads.ts'

export interface Outgoing {
  /** the screen's own id for it: the message comes back with it */
  cid: string
  chat: string
  text: string
  files: { name: string; path: string }[]
  /** the message it answers, and its quote to show at once */
  reply?: ReplyQuote & { id: string }
  /** when Send (or Retry) was tapped, by this screen's clock */
  at: number
  /** Shepherdr 3: held on purpose (Ctrl+Enter, or a long press on Send): it goes once the agent stops working */
  hold?: boolean
  /** sending: on its way; sent: in (or waiting for the agent), until it comes back; failed: it didn't go through */
  state: 'sending' | 'sent' | 'failed'
  /** the agent shows a menu or is starting (or its machine is out of reach): it goes in once it can */
  waiting?: boolean
  /** why it waits, as the server said */
  waitsFor?: Message['waitsFor']
  /** the chat shows it waiting for the agent (and this one stays hidden behind it) */
  queued?: boolean
  /** when it went in after waiting, by this screen's clock */
  wentAt?: number
  /** when the agent was last seen working since it went in: a working CLI takes it at its next step, so the time it has
   *  to come back counts from there */
  busyAt?: number
  /** the server's clock when it began to go in, to know it again without its id: the log has it after that */
  serverAt?: number
  /** your messages the chat already showed when you sent it: none of them can be it */
  prior?: string[]
  /** why it didn't go through */
  error?: string
  /** it went in but never showed in the chat: Retry sends it as a new message */
  lost?: boolean
  /** when the chat first showed a newer message of yours than it, by this screen's clock: the log moved past it */
  pastAt?: number
  /** the chat's last message when it was sent: it shows right after it (and after the ones sent before it), never
   *  under what came later (SHEP-93) */
  after?: string
  /** the ones sent before it in its chat, still on their way when it was sent: it shows after them */
  before?: string[]
  /** still sending: its files up so far (they go up before the message goes) */
  up?: number
  /** still sending: the network is gone or cut it off, and it goes again by itself */
  offline?: boolean
}

/** how long one try of Send waits for the server to answer: one with many pictures for another machine takes a while
 *  (asked again with the same id, it never goes twice) */
export const SEND_TIMEOUT = 90_000
/** one still sending (on this screen or another, or a reload ago) fails after this: it keeps trying by itself until
 *  then (uploads.ts GIVE_UP) */
const KEEP_SENDING = GIVE_UP + 60_000
/** one that went in but never came back from the log is not delivered after this, from when its agent last worked */
export const KEEP_SENT = 2 * 60_000
/** and after this however long its agent seems to work (one that stays working for good would keep it forever) */
const KEEP_BUSY = 30 * 60_000
/** one the log moved past without it (it came back changed: two messages in one, its pictures as markers) goes after
 *  this: it is in the chat already, as the agent got it */
export const KEEP_PAST = 60_000
/** a screen keeps no pending one longer than this */
const KEEP_OUT = 24 * 60 * 60_000
/** one waiting that the chat never showed waiting (a machine out of reach) fails after this */
const KEEP_WAITING = 30 * 60_000

const words = (s: string) => s.replace(/\s+/g, ' ').trim()
/** how much earlier than the server's clock the agent's log may stamp it: its machine's clock may differ a little */
const SLACK = 5000
/** a file as the log has it: on another machine it landed in a folder of its own there (hc put), under its own name */
const sameFile = (a: string | undefined, b: string) => a === b || (!!a && a.split('/').pop() === b.split('/').pop())

/** what this chat now shows of the pending ones. One that came back from the agent's log goes: by its id, or (from a
 *  machine on an older Shepherdr, or after its restart) by the very same message of yours: its words and files, new
 *  since you sent it, and read after it went in. One the chat shows waiting for the agent stays, hidden behind it, so
 *  nothing blinks while it goes in. */
export function settle(out: Outgoing[], chat: Chat, now = Date.now()): Outgoing[] {
  if (!out.some((o) => o.chat === chat.key)) return out
  const taken = new Set<string>()
  let changed = false
  const next = out.flatMap((o) => {
    if (o.chat !== chat.key) return [o]
    const shown = chat.messages.filter((m) => m.cid === o.cid)
    if (shown.some((m) => !m.waiting)) {
      changed = true
      return []
    }
    if (shown.length) {
      if (o.state === 'sent' && o.waiting && o.queued) return [o]
      changed = true
      return [{ ...o, state: 'sent' as const, waiting: true, queued: true, error: undefined, lost: undefined }]
    }
    // the server says it couldn't go in (not one sent again since: that is on its way once more)
    const failed = o.state === 'sent' && chat.failed?.find((f) => f.cid === o.cid)
    if (failed) {
      changed = true
      return [{ ...o, state: 'failed' as const, error: failed.error, waiting: undefined, queued: undefined }]
    }
    // it waited and is gone from the queue: it went in, and shows again until the log has it
    if (o.queued) {
      changed = true
      return [{ ...o, waiting: undefined, queued: undefined, wentAt: now }]
    }
    if (o.state === 'sending' || o.waiting || o.serverAt === undefined) return [o]
    const parts = sameAs(o, chat, taken)
    if (!parts) {
      if (o.pastAt || !(o.state === 'sent' || o.lost) || !movedPast(o, chat)) return [o]
      changed = true
      return [{ ...o, pastAt: now }]
    }
    for (const id of parts) taken.add(id)
    changed = true
    return []
  })
  return changed ? next : out
}

/** a message's words without the paths of the files sent with it, and which files those are: a file the agent got as a
 *  path (not a picture) comes in its words, on a line of its own after them */
function unfiled(text: string, files: Outgoing['files']) {
  const named = new Set<string>()
  const rest = text.split('\n').filter((line) => {
    const l = line.trim()
    const f = /^[/~]/.test(l) ? files.find((f) => !named.has(f.path) && sameFile(l, f.path)) : undefined
    if (f) named.add(f.path)
    return !f
  })
  return { words: words(rest.join('\n')), named }
}

/** the chat's own messages that are this one, without its id: each part new since you sent it, read after it went in,
 *  the same words and the same files */
function sameAs(o: Outgoing, chat: Chat, taken: Set<string>): string[] | null {
  const prior = new Set(o.prior ?? [])
  const fresh = chat.messages.filter((m) => m.who === 'you' && !m.cid && !m.answered && !m.waiting && !prior.has(m.id) && !taken.has(m.id) && (m.at ?? 0) >= o.serverAt! - SLACK)
  const ids: string[] = []
  let named = new Set<string>()
  for (const m of o.text || o.files.length ? fresh : []) {
    const u = m.text ? unfiled(m.text, o.files) : null
    if (!u || u.words !== words(o.text) || (!o.text && !u.named.size)) continue
    ids.push(m.id)
    named = u.named
    break
  }
  if (o.text && !ids.length) return null
  // its words came back: its pictures may come as files or only as how many there were (Claude Code's "[Image #1]")
  const said = ids[0]
  for (const f of o.files) {
    if (named.has(f.path)) continue
    const m = fresh.find((m) => sameFile(m.file?.path, f.path) && !ids.includes(m.id))
    if (m) ids.push(m.id)
    else if (!said) return null
  }
  // and what came with its words is its own (its files, its "2 images" line)
  if (said) for (const m of fresh) if (m.id.startsWith(`${said}:`) && !ids.includes(m.id)) ids.push(m.id)
  return ids.length ? ids : null
}

/** the chat shows a message of yours newer than it (the agent takes them in order): it won't come back as it was */
function movedPast(o: Outgoing, chat: Chat) {
  const prior = new Set(o.prior ?? [])
  return chat.messages.some((m) => m.who === 'you' && !m.waiting && !prior.has(m.id) && (m.at ?? 0) > o.serverAt! + SLACK)
}

/** your latest messages a chat shows now (older ones are long before anything you send next): none of them is it */
export function priorOf(chat: Chat | undefined): string[] {
  return (chat?.messages ?? [])
    .filter((m) => m.who === 'you')
    .slice(-30)
    .map((m) => m.id)
}

/** one the log moved past goes; what didn't go through in time fails, keeping its words and files for Retry: one still sending long after its time
 *  (the screen reloaded while it was on its way), one that went in but never showed in the chat (counted from when its
 *  agent last worked: a working CLI keeps it until its next step), and one waiting for a machine out of reach for long */
export function expire(out: Outgoing[], now: number, working: (chat: string) => boolean = () => false): Outgoing[] {
  let changed = false
  const next = out.flatMap((o) => {
    // the log moved past it a while ago: it is in the chat as the agent got it
    if (o.pastAt && now - o.pastAt > KEEP_PAST) {
      changed = true
      return []
    }
    const fail = (error: string, lost?: boolean) => {
      changed = true
      return { ...o, state: 'failed' as const, error, lost }
    }
    if (o.state === 'sending' && now - o.at > KEEP_SENDING) return fail("Couldn't reach Shepherdr.")
    if (o.state === 'sent' && !o.waiting && now - (o.wentAt ?? o.at) > KEEP_BUSY) return fail("It didn't show up in the chat.", true)
    if (o.state === 'sent' && !o.waiting && working(o.chat)) {
      // noted now and then, not on every tick: it is saved with the rest
      if (now - (o.busyAt ?? 0) < 30_000) return o
      changed = true
      return { ...o, busyAt: now }
    }
    if (o.state === 'sent' && !o.waiting && now - Math.max(o.wentAt ?? o.at, o.busyAt ?? 0) > KEEP_SENT) return fail("It didn't show up in the chat.", true)
    if (o.state === 'sent' && o.waiting && !o.queued && now - o.at > KEEP_WAITING) return fail('Still waiting after 30 minutes.')
    return o
  })
  return changed ? next : out
}

/** what a screen keeps when it loads: none older than a day, and none for a chat that is gone (exists: whether a chat
 *  is still there, once the screen knows) */
export function prune(out: Outgoing[], now: number, exists?: (chat: string) => boolean): Outgoing[] {
  const next = out.filter((o) => now - o.at < KEEP_OUT && (!exists || exists(o.chat)))
  return next.length === out.length ? out : next
}

/** how it shows: a bubble for the text, one for each file, like what comes back; nothing while the chat shows it */
export function partsOf(o: Outgoing, chat?: Chat): Message[] {
  if (chat?.messages.some((m) => m.cid === o.cid)) return []
  const waiting = (o.state === 'sent' && o.waiting) || undefined
  const base = { who: 'you' as const, cid: o.cid, at: o.at, waiting, waitsFor: waiting && o.waitsFor }
  // the quote goes on the words, or on the first file when there are none
  return [
    ...(o.text ? [{ ...base, id: `out:${o.cid}`, text: o.text, reply: o.reply }] : []),
    ...o.files.map((file, i) => ({ ...base, id: `out:${o.cid}:${i}`, file, reply: !i && !o.text ? o.reply : undefined })),
  ]
}

/** the chat's last message to send after: one in the conversation, not one waiting or a card that moves */
export function anchorOf(chat: Chat | undefined): string | undefined {
  const ms = chat?.messages ?? []
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i]
    if (!m.waiting && !/^(ask|secret|card|ae|se):/.test(m.id)) return m.id
  }
  return undefined
}

/** where each one on its way shows among the chat's rows (in order, each with its cid when it was sent from a
 *  screen): right after the message that was last when it was sent, and after the ones sent before it (still on their
 *  way then: before), even once they are in the chat, so the chat keeps the order things were sent in. One whose
 *  message is gone from the chat (or an old one without) goes at the end. -> the index to insert at, per cid */
export function placesOf(rows: { id: string; cid?: string }[], out: Pick<Outgoing, 'cid' | 'after' | 'before'>[]): Map<string, number> {
  const at = new Map<string, number>()
  const index = new Map<string, number>(rows.map((r, i) => [r.id, i]))
  for (const o of out) {
    const i = o.after !== undefined ? index.get(o.after) : undefined
    if (i === undefined) {
      at.set(o.cid, rows.length)
      continue
    }
    let n = i + 1
    const before = new Set(o.before ?? [])
    if (before.size) rows.forEach((r, k) => { if (r.cid && before.has(r.cid) && k + 1 > n) n = k + 1 })
    at.set(o.cid, n)
  }
  return at
}

/** a message's place in the list: what you sent keeps one from the moment you tap Send, so the swap redraws nothing */
export function keyOf(m: Message) {
  return m.cid ? (m.file ? `${m.cid}:${m.file.path}` : m.cid) : m.id
}

/** why it didn't go through, in a few words */
export function reasonOf(e: unknown): string {
  const err = e as Error
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'No answer from Shepherdr.'
  if (err instanceof TypeError) return "Can't reach Shepherdr."
  let msg = err?.message ?? ''
  try {
    msg = (JSON.parse(msg) as { error?: string }).error ?? msg
  } catch {
    /* plain text */
  }
  msg = msg.trim()
  return msg ? (msg.length > 80 ? `${msg.slice(0, 79)}…` : msg) : 'Something went wrong.'
}

// .2: once, every screen drops what it kept under the old name (ones with pictures that never matched, SHEP-22)
const STORE = 'shepherdr.outbox.2'
const OLD = ['shepherdr.outbox']

export function loadOutbox(): Outgoing[] {
  try {
    for (const k of OLD) localStorage.removeItem(k)
    const v = JSON.parse(localStorage.getItem(STORE) ?? '[]')
    return Array.isArray(v) ? prune(v, Date.now()) : []
  } catch {
    return []
  }
}

export function saveOutbox(out: Outgoing[]) {
  try {
    if (out.length) localStorage.setItem(STORE, JSON.stringify(out))
    else localStorage.removeItem(STORE)
  } catch {
    /* private window: it still shows until the screen reloads */
  }
}
