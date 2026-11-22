// The chat: an agent's messages (formatted text, code, tables, pictures), one quiet line while it works saying what
// it is doing, one small folded row per turn ("Ran 4 commands · edited 2 files"), cards where it needs you, and the
// message box. The same parts draw a space's chat and a task's thread.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { copyText } from '@client/copy.ts'
import { act, definePlugin, getState, notice, registry, setUI, tryAct, useChat, useDraft, useSnap, useStore, useUI, type MenuRow, type Thread } from '@client/kernel.ts'
import { partsOf, placesOf, keyOf } from '@client/outbox.ts'
import { confirm, openMenu } from '@client/overlay.tsx'
import { AgentLine, openPicker, pickFor, pickWords, type Pick } from '@client/picker.tsx'
import { attach, detach, dropOut, retry, send } from '@client/send.ts'
import { cx, Empty, I, IB, useGrow } from '@client/ui.tsx'
import { isImage, isVideo } from '@shared/files.ts'
import type { Chat, Message, Snapshot, TurnActivity } from '@shared/types.ts'
import { isEverything, placeOf, taskOf } from '@shared/view.ts'
import { DoneRow, QuestionCard, SecretCard } from './cards.tsx'
import { dayLabel } from './days.ts'
import { Markdown } from './markdown.tsx'
import { dropped, pasted } from './paste.ts'
import { suggestionOf, suggestionsOn } from './suggest.ts'
import { typing, working } from './typing.ts'

/** a file a chat names, served by Shepherdr */
export const fileUrl = (chat: string, path: string, small = false) => `api/file?chat=${encodeURIComponent(chat)}&path=${encodeURIComponent(path)}${small ? '&thumb=1' : ''}`

const clock = (at: number) => {
  const d = new Date(at)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** a new time divider after this long without a message */
const QUIET = 30 * 60_000

/** "Ran 4 commands · edited 2 files": what a turn did, in one line */
export function didWords(a: TurnActivity): string {
  if (a.summary) return a.summary
  const n: Record<string, number> = {}
  for (const r of a.rows) n[r.kind] = (n[r.kind] ?? 0) + Math.max(1, r.steps.length)
  const say = (k: string, one: string, many: string) => (n[k] ? `${one} ${n[k]} ${n[k] === 1 ? many.replace(/s$/, '') : many}` : '')
  const parts = [say('run', 'ran', 'commands'), say('edit', 'edited', 'files'), say('read', 'read', 'files'), say('search', 'searched', 'times'), say('web', 'opened', 'pages'), say('agent', 'started', 'helpers'), say('other', 'took', 'steps')].filter(Boolean)
  const t = parts.join(' · ') || `${a.steps} ${a.steps === 1 ? 'step' : 'steps'}`
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** one small folded row per turn; it opens to list what it did */
function Did({ a }: { a: TurnActivity }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <I n={open ? 'down' : 'right'} c="s16" />
        {didWords(a)}
      </button>
      {open && (
        <div className="files">
          {a.rows.map((r) => (
            <span key={r.key}>
              {r.text}
              <em>{[r.added ? `+${r.added}` : '', r.removed ? `−${r.removed}` : '', r.failed ? 'failed' : ''].filter(Boolean).join(' ')}</em>
            </span>
          ))}
          {a.more ? <span>and {a.more} more</span> : null}
        </div>
      )}
    </>
  )
}

/** the line naming the task above messages that came from it */
function TaskRef({ id, title }: { id: string; title: string }) {
  return (
    <button type="button" className="ref" onClick={() => setUI({ task: id, pane: 'tasks', wide: false })}>
      <I n="chat" c="s16" />
      {title}
    </button>
  )
}

function msgMenu(anchor: Element, msg: Message, chat: Chat, thread: Thread, select: () => void) {
  const key = thread.chat
  const text = msg.text ?? msg.file?.name ?? ''
  const rows: MenuRow[] = [
    // Reply puts a quote of the message in the box
    { icon: 'reply', label: 'Reply', run: () => { setUI((ui) => ({ reply: { ...ui.reply, [key]: { id: msg.id, who: msg.who, text: text.slice(0, 200) } } })); document.querySelector<HTMLTextAreaElement>(`textarea[data-box="${CSS.escape(key)}"]`)?.focus() } },
    { icon: 'copy', label: 'Copy', run: () => void copyText(text).then((ok) => ok && notice('Copied')) },
    // Select text makes that message's text selectable
    { icon: 'select', label: 'Select text', run: select },
    // Share opens the device's share sheet, or copies on a desktop
    { icon: 'share', label: 'Share', run: () => (navigator.share ? void navigator.share({ text }).catch(() => undefined) : void copyText(text).then((ok) => ok && notice('Copied'))) },
    ...registry.messageMenu.flatMap((m) => m.rows?.(msg, chat) ?? []),
  ]
  const tops = registry.messageMenu.filter((m) => m.Top)
  openMenu(anchor, rows, { label: 'Message', top: tops.length ? (close) => tops.map((m, i) => (m.Top ? <m.Top key={i} msg={msg} chat={chat} close={close} /> : null)) : undefined })
}

function Bubble({ msg, chat, thread, gap, pending, failed }: { msg: Message; chat: Chat; thread: Thread; gap: boolean; pending?: boolean; failed?: string }) {
  const [sel, setSel] = useState(false)
  const jump = useUI((u) => u.jump === msg.id)
  const mine = msg.who === 'you'
  const open = (el: Element) => {
    if (sel || getSelection()?.toString()) return
    msgMenu(el, msg, chat, thread, () => setSel(true))
  }
  return (
    <>
      <div
        className={cx('b', mine && 'mine', gap && 'gap', sel && 'sel', pending && 'pending', jump && 'jump')}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        data-msg={msg.id}
        data-chat={chat.key}
        data-menu
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), open(e.currentTarget))}
      >
        {msg.reply && <span className="quote">{msg.reply.text}</span>}
        {mine ? <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div> : <Markdown text={msg.text ?? ''} mentions={msg.mentions} />}
      </div>
      {failed !== undefined && msg.cid && (
        <div className="ref" style={{ justifySelf: 'end', marginTop: 0 }}>
          <span className="c-red">Not sent{failed ? ` · ${failed}` : ''}</span>
          <span className="lk" role="button" tabIndex={0} onClick={() => retry(msg.cid!)}>Retry</span>
          <span className="lk" role="button" tabIndex={0} onClick={() => dropOut(msg.cid!)}>Remove</span>
        </div>
      )}
      {registry.messageEdge.map((e, i) => <e.View key={i} msg={msg} chat={chat} />)}
    </>
  )
}

function FileRow({ msg, chat, gap }: { msg: Message; chat: Chat; gap: boolean }) {
  const f = msg.file!
  const mine = msg.who === 'you'
  if (f.path && (isImage(f.name) || isVideo(f.name)))
    return (
      <a className={cx('pic', mine && 'mine', gap && 'gap')} href={fileUrl(chat.key, f.path)} target="_blank" rel="noreferrer" aria-label={f.alt || f.name} data-msg={msg.id}>
        {isVideo(f.name) ? <video src={fileUrl(chat.key, f.path)} controls playsInline preload="metadata" /> : <img src={fileUrl(chat.key, f.path, true)} alt={f.alt || f.name} loading="lazy" />}
      </a>
    )
  return (
    <div className={cx('fchips', mine && 'mine')} data-msg={msg.id}>
      <a className="fchip" href={f.path ? fileUrl(chat.key, f.path) : undefined} target="_blank" rel="noreferrer">
        {isImage(f.name) ? <i className="pic" /> : <I n="doc" c="s16" />}
        {f.name}
      </a>
    </div>
  )
}

interface Shown {
  msg: Message
  pending?: boolean
  failed?: string
}

/** the chat's messages with what you sent that it does not show yet, in the order things were sent */
function shownOf(chat: Chat | undefined, key: string, outbox: ReturnType<typeof getState>['outbox']): Shown[] {
  const rows: Shown[] = (chat?.messages ?? []).filter((m) => !(m.waiting && m.waitsFor === 'turn' && m.cid && outbox.some((o) => o.cid === m.cid))).map((msg) => ({ msg, pending: !!msg.waiting }))
  const mine = outbox.filter((o) => o.chat === key)
  if (!mine.length) return rows
  const at = placesOf(rows.map((r) => ({ id: r.msg.id, cid: r.msg.cid })), mine)
  const add = mine.flatMap((o) => partsOf(o, chat).map((msg) => ({ at: at.get(o.cid) ?? rows.length, row: { msg, pending: o.state !== 'failed', failed: o.state === 'failed' ? (o.error ?? '') : undefined } as Shown })))
  for (const a of add.sort((x, y) => y.at - x.at)) rows.splice(a.at, 0, a.row)
  return rows
}

function Messages({ thread }: { thread: Thread }) {
  const chat = useChat(thread.chat)
  const snap = useSnap()
  const outbox = useStore((s) => s.outbox)
  const rows = useMemo(() => shownOf(chat, thread.chat, outbox), [chat, thread.chat, outbox])
  const end = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const jump = useUI((u) => u.jump)

  // it opens at the newest message and stays there as new ones come, unless you scrolled up; scrolling up to the top
  // loads earlier ones
  useLayoutEffect(() => {
    const sc = end.current?.closest<HTMLElement>('.scroll')
    if (!sc) return
    stuck.current = true
    sc.scrollTop = sc.scrollHeight
    const on = () => {
      stuck.current = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80
      const c = getState().chats[thread.chat]
      if (sc.scrollTop < 40 && c?.earlier && !loading.has(thread.chat)) {
        loading.add(thread.chat)
        const was = sc.scrollHeight
        void act({ type: 'earlier', chat: thread.chat })
          .catch(() => undefined)
          .finally(() => setTimeout(() => {
            loading.delete(thread.chat)
            sc.scrollTop += sc.scrollHeight - was
          }, 300))
      }
    }
    sc.addEventListener('scroll', on, { passive: true })
    return () => sc.removeEventListener('scroll', on)
  }, [thread.chat])
  useLayoutEffect(() => {
    const sc = end.current?.closest<HTMLElement>('.scroll')
    if (sc && stuck.current) sc.scrollTop = sc.scrollHeight
  })
  useEffect(() => {
    if (!jump) return
    const el = document.querySelector(`[data-msg="${CSS.escape(jump)}"], [data-card="${CSS.escape(jump)}"]`)
    if (!el) return
    stuck.current = false
    el.scrollIntoView({ block: 'center' })
    const t = setTimeout(() => setUI({ jump: null }), 2500)
    return () => clearTimeout(t)
  }, [jump, rows.length])

  if (!snap) return null
  const out: ReactNode[] = []
  let prev = ''
  let lastAt = 0
  const stub: Chat = chat ?? { key: thread.chat, messages: [], cli: '' }
  for (const { msg: m, pending, failed } of rows) {
    const who = m.who === 'you' ? 'me' : 'a'
    const k = keyOf(m)
    if (m.at && (!lastAt || new Date(m.at).toDateString() !== new Date(lastAt).toDateString() || m.at - lastAt > QUIET)) out.push(<div key={`t:${k}`} className="time">{dayLabel(m.at)} {clock(m.at)}</div>)
    if (m.at) lastAt = m.at
    const gap = !!prev && prev !== who
    if (m.newSession) {
      out.push(<div key={k} className="time" role="separator">New session</div>)
      continue
    }
    if (m.activity) out.push(<Did key={k} a={m.activity} />)
    else if (m.question) {
      if (m.question.by && !thread.task) out.push(<TaskRef key={`r:${k}`} id={taskIdOf(snap, m.question.by.chat)} title={m.question.by.title ?? m.question.by.ref} />)
      if (m.question.title && !m.question.command && !m.question.plan && !m.question.parts?.length && m.question.sent === undefined && !m.question.closed) out.push(<div key={`q:${k}`} className={cx('b', gap && 'gap')}>{m.question.title}</div>)
      out.push(<QuestionCard key={k} q={m.question} chat={thread.chat} place={thread.place} />)
    } else if (m.secret) out.push(<SecretCard key={k} ask={m.secret} chat={thread.chat} />)
    else if (m.news || m.card) {
      const taskId = m.news?.task ?? m.card?.task
      const t = taskOf(snap, taskId)
      if (t && !thread.task) out.push(<TaskRef key={`r:${k}`} id={t.id} title={t.name} />)
      const text = m.news?.text ?? m.card?.text ?? m.text ?? ''
      if (text) out.push(<Bubble key={k} msg={{ ...m, text }} chat={stub} thread={thread} gap={false} />)
    } else if (m.brief) out.push(<div key={k} className="ref"><I n="note" c="s16" /><span>{m.brief.label}</span></div>)
    else if (m.ended) out.push(<DoneRow key={k}>{m.text ?? 'Ended'}</DoneRow>)
    else if (m.error) out.push(<div key={k} className="ref c-red"><I n="warn" c="s16" /><span>{m.text}</span></div>)
    else if (m.file) out.push(<FileRow key={k} msg={m} chat={stub} gap={gap} />)
    else if (m.text) out.push(<Bubble key={k} msg={m} chat={stub} thread={thread} gap={gap} pending={pending} failed={failed} />)
    for (const [i, p] of registry.messageParts.entries()) out.push(<p.View key={`${k}:p${i}`} msg={m} chat={stub} thread={thread} />)
    if (!m.activity) prev = who
  }
  const empty = !rows.length && (!chat || chat.fresh || chat.notice === 'none' || chat.top !== false)
  const every = isEverything(snap, thread.place)
  return (
    <>
      {empty && !thread.task && chat && (
        <Empty title={every ? 'Welcome to Shepherdr' : `Nothing in #${placeOf(snap, thread.place)?.name ?? ''} yet`}>Tell me what you want done{every ? ', here or in a space.' : ' here.'}</Empty>
      )}
      {out}
      {registry.chatTail.map((t, i) => <t.View key={i} chat={chat} thread={thread} />)}
      <div ref={end} />
    </>
  )
}
const loading = new Set<string>()

/** a task's id from its chat's key ("vm:SHOP-12/worker") */
const taskIdOf = (snap: Snapshot, chatKey: string) => snap.tasks.find((t) => t.agent?.chat === chatKey)?.id ?? chatKey.replace(/\/[^/]+$/, '')

/** the quiet line while the agent works, saying what it is doing; "…" while it writes */
function WorkingTail({ chat }: { chat: Chat | undefined }) {
  if (!chat) return null
  if (working(chat)) {
    const now = chat.live?.now
    return (
      <div className="ref" role="status">
        <I n="working" c="s16 c-working" />
        <span>{chat.doing || now?.doing || now?.title || 'Working'}</span>
      </div>
    )
  }
  return typing(chat) ? <p className="b gap" aria-label="Writing">…</p> : null
}

/* ---------- the message box ---------- */

/** suggested replies already used or typed over: gone once you send something */
const spent = new Set<string>()

/** what a chat runs on now: its agent's own report, else what is set for its kind */
export function pickOf(snap: Snapshot, chat: Chat | undefined, thread: Thread): Pick {
  const a = chat?.agent
  if (a?.kind) return { agent: a.kind, model: a.model ?? a.planned?.model ?? null, effort: a.effort ?? a.planned?.effort ?? null, fast: a.speed === 'ultrafast' ? 'ultrafast' : a.speed === 'fast', perm: (a as { perm?: string }).perm ?? null }
  return pickFor(snap, isEverything(snap, thread.place) ? 'all' : thread.place, thread.task ? 'Tasks' : 'Chats')
}

/** A new model, effort or permission mode applies from your next message. A different agent restarts that chat, after
 *  you confirm; earlier messages stay. */
export function applyPick(chat: string, was: Pick, now: Pick, names: { agent: string }) {
  if (JSON.stringify(was) === JSON.stringify(now)) return
  const run = (live: boolean) => void tryAct({ type: 'restart', chat, kind: now.agent, model: now.model ?? undefined, effort: now.effort ?? undefined, speed: now.fast === 'ultrafast' ? 'ultrafast' : now.fast ? 'fast' : 'normal', perm: now.perm ?? undefined, live })
  if (was.agent === now.agent) return run(true)
  confirm({ title: `Switch to ${names.agent}?`, body: 'This chat starts again on the new agent. Earlier messages stay, above a "New session" line.', ok: 'Switch', run: () => run(false) })
}

function Box({ thread, placeholder }: { thread: Thread; placeholder: string }) {
  const key = thread.chat
  const snap = useSnap()!
  const chat = useChat(key)
  const [text, setText] = useDraft(key)
  const files = useUI((u) => u.files[key])
  const reply = useUI((u) => u.reply[key])
  const phone = useUI((u) => u.phone)
  const ref = useRef<HTMLTextAreaElement>(null)
  const pickFile = useRef<HTMLInputElement>(null)
  useGrow(ref, text)
  const sg = suggestionOf(chat, suggestionsOn(snap.settings))
  const sug = sg && !spent.has(sg.id) ? sg : null
  const busy = !!chat?.working && !chat.finished
  const machine = snap.places.find((p) => p.id === thread.place)?.machine ?? snap.host
  const pick = pickOf(snap, chat, thread)
  const go = () => {
    const t = text.trim() || (!files?.length ? (sug?.text ?? '') : '')
    if (!t && !files?.length) return
    if (sug) spent.add(sug.id)
    // a message sent while the agent works waits its turn
    send(key, key, t, busy)
    setText('')
  }
  const useSug = () => {
    if (!sug) return
    setText(sug.text)
    ref.current?.focus()
  }
  const stop = busy && !text.trim() && !files?.length
  return (
    <div
      className="cbox"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const f = dropped(e.dataTransfer)
        if (!f.length) return
        e.preventDefault()
        attach(key, key, f)
      }}
    >
      {reply && (
        <div className="fchips">
          <span className="fchip">
            <I n="reply" c="s16" />
            <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reply.text}</span>
            <button type="button" aria-label="Don't reply to it" onClick={() => setUI((ui) => { const { [key]: _, ...rest } = ui.reply; return { reply: rest } })}><I n="x" c="s16" /></button>
          </span>
        </div>
      )}
      {!!files?.length && (
        <div className="fchips">
          {files.map((f, i) => (
            <span className="fchip" key={f.id ?? i} style={f.path ? undefined : { opacity: 0.6 }}>
              {isImage(f.name) ? <i className="pic" /> : <I n="doc" c="s16" />}
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => detach(key, i)}><I n="x" c="s16" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="crow">
        <textarea
          ref={ref}
          className="cin"
          rows={1}
          name="message"
          data-box={key}
          aria-label={placeholder}
          placeholder={sug?.text ?? placeholder}
          enterKeyHint="send"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const f = pasted(e.clipboardData)
            if (!f.length) return
            e.preventDefault()
            attach(key, key, f)
          }}
          onKeyDown={(e) => {
            // Tab writes the suggested reply into the box, so you can keep typing
            if (e.key === 'Tab' && !e.shiftKey && sug && !text) {
              e.preventDefault()
              return useSug()
            }
            // Enter sends and Shift+Enter makes a new line, the same on phone and desktop
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              go()
            }
          }}
        />
        {sug && !text && (
          <button type="button" className="kbd" aria-label="Use the suggested reply" onClick={useSug}>
            {phone ? <I n="tab" /> : 'Tab'}
          </button>
        )}
      </div>
      <div className="cbar">
        <IB icon="plus" label="Add files" onClick={() => pickFile.current?.click()} />
        <input
          ref={pickFile}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            attach(key, key, [...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <AgentLine
          pick={pick}
          machine={machine}
          onClick={() => openPicker({ title: thread.task ? 'This task runs on' : 'This chat runs on', machine, pick, onChange: () => undefined, onClose: (now) => applyPick(key, pick, now, { agent: pickWords(now).agent }) })}
        />
        <span className="sp" />
        {registry.boxButtons.map((b, i) => <b.View key={i} thread={thread} write={(t) => setText(text ? `${text.replace(/\s+$/, '')} ${t}` : t)} />)}
        {stop ? (
          <button type="button" className="send" aria-label="Stop" onClick={() => void tryAct({ type: 'stop', chat: key })}>
            <I n="stop" c="s16" />
          </button>
        ) : (
          <button type="button" className="send" aria-label="Send" onClick={go}>
            <I n="send" c="s16" />
          </button>
        )}
      </div>
    </div>
  )
}

export default definePlugin({
  name: 'chat',
  setup(reg) {
    reg.views.messages = Messages
    reg.views.box = Box
    reg.chatTail.push({ order: 90, View: WorkingTail })
  },
})

export { Box, Messages }
