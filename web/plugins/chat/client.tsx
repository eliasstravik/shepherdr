// The chat: an agent's messages (formatted text, code, tables, pictures), one quiet line while it works saying what
// it is doing, one small folded row per turn ("Ran 4 commands · edited 2 files"), cards where it needs you, and the
// message box. The same parts draw a space's chat and a task's thread.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { copyText } from '@client/copy.ts'
import { TEXT_IN_CALL, useDictating } from '@client/dictate.tsx'
import { attr } from '@client/attr.ts'
import { act, definePlugin, getState, has, notice, registry, setUI, tryAct, useChat, useDraft, useSnap, useStore, useUI, type MenuRow, type Thread } from '@client/kernel.ts'
import { partsOf, placeOutgoing, placesOf, keyOf, readNow, showsAs, type Outgoing } from '@client/outbox.ts'
import { confirm, openMenu } from '@client/overlay.tsx'
import { AgentLine, openPicker, pickFor, pickWords, type Pick } from '@client/picker.tsx'
import { attach, detach, dropOut, retry, reupload, send } from '@client/send.ts'
import { Btn, cx, Empty, I, IB, useGrow } from '@client/ui.tsx'
import type { IconName } from '@client/icons.ts'
import { isImage, isVideo } from '@shared/files.ts'
import type { Chat, Message, Relay, Snapshot, Task, TaskBrief, TurnActivity } from '@shared/types.ts'
import { isEverything, placeOf, statusWord, taskOf } from '@shared/view.ts'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import { DoneRow, QuestionCard, SecretCard } from './cards.tsx'
import { briefFrom, deliveryWord, looksLong, startWords } from './brief.ts'
import { relayLabel, relayState, relayWhy } from './relay.ts'
import { quickFit, type QuickFit } from './press.ts'
import { replyToTask, SlideHint, useSlide } from './slide.tsx'
import { dayLabel } from './days.ts'
import { Markdown, withLinks } from './markdown.tsx'
import { dropped, pasted } from './paste.ts'
import { touch } from './clip.ts'
import { landLaunchShare, putAway, useLanded, watchLastChat } from './share.ts'
import { openSendTo } from './sendto.tsx'
import { ReplyPress, repliesHidden, suggestionOf, suggestionsOn } from './suggest.ts'
import { BoxThumb, openPreview, SentThumb, sourcesOf } from './thumbs.tsx'
import { heldStep, signOf } from './typing.ts'
import { newsRow, type NewsRow } from './news.ts'
import { outOfView, setAway, useAway, type Waiting } from './away.ts'

export { fileUrl } from './thumbs.tsx'

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

/** one quiet row, as a turn's "Ran 4 commands", never a bubble: an icon, its words, then muted ones (its time, a
 *  state); with a body, a tap opens it under the row (a long one scrolls in place) and a tap again folds it. Task news
 *  (SHEP-365) and messages between agents (SHEP-368) are drawn with it, one style for both. */
function QuietRow({ icon, label, meta = [], body, startOpen = false, kind }: { icon: IconName; label: string; meta?: { word: string; tone?: 'red' | 'amber' }[]; body?: ReactNode; startOpen?: boolean; kind: string }) {
  const [open, setOpen] = useState(startOpen)
  const words = (
    <>
      <I n={icon} c="s16" />
      <span className="ql">
        {label}
        {meta.filter((x) => x.word).map((x, i) => <span key={i} className={cx('qm', x.tone === 'red' && 'c-red', x.tone === 'amber' && 'c-ask')}>{x.word}</span>)}
      </span>
    </>
  )
  // its own icon stands in the chat's one icon column (SHEP-383), so its words line up with every other row's; the
  // fold's chevron trails the words
  if (!body) return <div className={cx('fold quiet', kind)}>{words}</div>
  return (
    <>
      <button type="button" className={cx('fold quiet', kind)} aria-expanded={open} onClick={() => setOpen(!open)}>
        {words}
        <I n={open ? 'down' : 'right'} c="s16 qv" />
      </button>
      {open && <div className={cx('quietb', `${kind}b`)}>{body}</div>}
    </>
  )
}

/** a task's news as one quiet row (news.ts newsRow); longer words wait behind its fold */
function NewsLine({ row, at }: { row: NewsRow; at?: number }) {
  return <QuietRow kind="news" icon="note" label={row.label} meta={at ? [{ word: clock(at) }] : []} body={row.body ? <div className="qt">{row.body}</div> : undefined} />
}

/** a message between agents (SHEP-368), in the sender's chat and the receiver's: whom it went to or who sent it, when,
 *  and whether it got there; it opens to its words (and the files it came with), and why it waits or didn't go */
export function RelayRow({ r, text, at, startOpen = false }: { r: Relay; text: string; at?: number; startOpen?: boolean }) {
  const why = relayWhy(r)
  return (
    <QuietRow kind="relay" icon={r.dir === 'to' ? 'send' : 'chat'} label={relayLabel(r)} startOpen={startOpen} meta={[{ word: at ? clock(at) : '' }, relayState(r)]}
      body={
        <>
          {why && <p className={cx('qw', r.state === 'failed' ? 'c-red' : 'c-ask')}>{why}</p>}
          <div className="qt">{text}</div>
          {r.files?.length ? (
            <ul role="list" className="qf">
              {r.files.map((f, i) => <li key={i}><I n="doc" c="s16" />{f}</li>)}
            </ul>
          ) : null}
        </>
      } />
  )
}

/** the line naming the task above messages that came from it */
/** a quiet "how it closed" line's words: what closed and how ("Fix login · Run: npm test · Allowed"); none when it
 *  has no words (a bare "Ended" says nothing) or is the same as the line right above it */
export function endedLine(text: string, above: string): string | null {
  const line = text.trim()
  return line && line !== above.trim() ? line : null
}

function TaskRef({ id, title, t }: { id: string; title: string; t?: Task }) {
  // a slide to the right replies to the task here, as to a message
  const { on, slide, armed, skip, moving } = useSlide(() => replyToTask({ id, name: title }))
  return (
    <button type="button" className="ref tslide" {...on} onClick={() => (skip.current ? void (skip.current = false) : setUI({ task: id, pane: 'tasks', wide: false }))}>
      <SlideHint slide={slide} armed={armed} />
      <span className={cx('tmv', moving.className)} style={moving.style} onTransitionEnd={moving.onTransitionEnd}>
        {t ? <StatusIcon t={t} time="side" /> : <I n="chat" c="s16" />}
        <span className="rt">{title}</span>
      </span>
    </button>
  )
}

/** the task a message replies to, above its words: its state and title; a tap opens it */
function TaskQuote({ id, title }: { id: string; title: string }) {
  const snap = useSnap()
  const t = snap ? taskOf(snap, id) : undefined
  const word = t ? statusWord(t).word : ''
  return (
    <button
      type="button"
      className="quote qtask"
      aria-label={`Replying to the task ${t?.name ?? title}${word ? `, ${word}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setUI({ task: id, pane: 'tasks', wide: false })
      }}
    >
      {t ? <StatusIcon t={t} time="none" /> : <I n="tasks" c="s16" />}
      <span className="qt1">{t?.name ?? title}</span>
      {word && <span className="qt2">{word}</span>}
    </button>
  )
}

/** reply to a message: a quote of it goes in the box, and the box takes the keyboard */
export function replyTo(msg: Message, key: string) {
  const text = msg.text ?? msg.file?.name ?? ''
  setUI((ui) => ({ reply: { ...ui.reply, [key]: { id: msg.id, who: msg.who, text: text.slice(0, 200) } } }))
  document.querySelector<HTMLTextAreaElement>(`textarea[data-box="${attr(key)}"]`)?.focus()
}

function msgMenu(anchor: Element, msg: Message, chat: Chat, thread: Thread, select: () => void, reply?: () => void) {
  const key = thread.chat
  const text = msg.text ?? msg.file?.name ?? ''
  const rows: MenuRow[] = [
    // Reply puts a quote of the message in the box
    { icon: 'reply', label: 'Reply', run: () => (reply ? reply() : replyTo(msg, key)) },
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

/* ---------- acting on a message (SHEP-332) ---------- */

/** the one message whose quick bar a tap opened: `y`, where on it the tap was (px from its top) */
let quickNow: { id: string; y: number | null } | null = null
const quickSubs = new Set<() => void>()
function setQuick(q: typeof quickNow) {
  quickNow = q
  quickSubs.forEach((f) => f())
}
const quickSub = (f: () => void) => {
  quickSubs.add(f)
  return () => void quickSubs.delete(f)
}
const useQuick = (id: string) => useSyncExternalStore(quickSub, () => (quickNow?.id === id ? quickNow : null))

/** The quick bar beside a message, on its open side: add a reaction, reply, more (the whole menu); on a narrow screen
 *  only the first. `y`: where to centre it, for a message taller than the screen. */
function QuickBar({ msg, chat, mine, wrap, y, done, more, reply: onReply }: { msg: Message; chat: Chat; thread: Thread; mine: boolean; wrap: HTMLElement; y: number | null; done: () => void; more: (el: Element) => void; reply: () => void }) {
  const phone = useUI((u) => u.phone)
  const [fit, setFit] = useState<QuickFit | null>(null)
  useLayoutEffect(() => {
    const w = wrap.getBoundingClientRect()
    const m = (wrap.parentElement ?? wrap).getBoundingClientRect()
    setFit(quickFit(mine ? w.left - m.left : m.right - w.right, !phone))
  }, [wrap, mine, phone])
  const quick = registry.messageQuick
  const reply = (
    <button key="reply" type="button" className="qbtn" aria-label="Reply" onClick={() => { done(); onReply() }}>
      <I n="reply" />
    </button>
  )
  const buttons = [
    ...quick.map((q, i) => <q.View key={`q${i}`} msg={msg} chat={chat} />),
    reply,
    <button key="more" type="button" className="qbtn" aria-label="More" aria-haspopup="menu" onClick={(e) => more(e.currentTarget)}>
      <I n="dots" />
    </button>,
  ]
  // centred on the bubble (not its reactions); on one taller than a phone's thumb reach, where it was touched
  const b = wrap.querySelector<HTMLElement>('.b')
  const h = b?.offsetHeight ?? wrap.offsetHeight
  const top = y === null || h <= 120 ? `${(b?.offsetTop ?? 0) + h / 2}px` : `${Math.min(Math.max(y, 24), h - 24)}px`
  return (
    <div
      className={cx('qb', mine ? 'l' : 'r', fit?.over && 'over')}
      role="toolbar"
      aria-label="Message actions"
      style={{ top, visibility: fit ? undefined : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="qbx">{fit?.actions === 'react' ? buttons[0] : buttons}</div>
      {fit?.time && msg.at ? <span className="qt">{clock(msg.at)}</span> : null}
    </div>
  )
}

function Bubble({ msg, chat, thread, gap, pending, failed, mark, onReply }: { msg: Message; chat: Chat; thread: Thread; gap: boolean; pending?: boolean; failed?: string; mark?: Shown['mark']; onReply?: () => void }) {
  const [sel, setSel] = useState(false)
  const jump = useUI((u) => u.jump === msg.id)
  const mine = msg.who === 'you'
  const qid = `${chat.key}\n${msg.id}`
  const quick = useQuick(qid)
  const [hover, setHover] = useState<number | null | false>(false)
  const wrap = useRef<HTMLDivElement>(null)
  const full = (el: Element) => {
    if (sel) return
    setQuick(null)
    msgMenu(el, msg, chat, thread, () => setSel(true), onReply)
  }
  const reply = () => {
    setQuick(null)
    if (onReply) onReply()
    else replyTo(msg, thread.chat)
  }
  // a slide to the right replies, a press held still opens the whole menu (the click after either is not a tap)
  const { on, slide, armed, skip, pressing, moving } = useSlide(reply, { hold: full, off: sel })
  // a tap anywhere else (or Escape) puts the quick bar away
  useEffect(() => {
    if (!quick) return
    const away = (e: Event) => {
      const t = e.target as Element | null
      if (t && (wrap.current?.contains(t) || t.closest('.pop'))) return
      setQuick(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setQuick(null)
    addEventListener('pointerdown', away, true)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('pointerdown', away, true)
      removeEventListener('keydown', esc)
    }
  }, [quick])
  const yIn = (clientY: number) => clientY - (wrap.current?.getBoundingClientRect().top ?? 0)
  const bar = quick ?? (hover !== false && !quickNow ? { y: hover } : null)
  return (
    <>
      <div
        ref={wrap}
        className={cx('bw', mine && 'mine', gap && 'gap', !!bar && 'qon')}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(yIn(e.clientY))}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      >
        <SlideHint slide={slide} armed={armed} />
        <div className={cx('bmv', moving.className)} style={moving.style} onTransitionEnd={moving.onTransitionEnd}>
          <div
            className={cx('b', mine && 'mine', sel && 'sel', pending && 'pending', jump && 'jump')}
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            data-msg={msg.id}
            data-chat={chat.key}
            data-menu
            {...on}
            onContextMenu={(e) => {
              // a finger's hold is ours (above); a right click opens the whole menu
              e.preventDefault()
              if (pressing() || skip.current) return
              full(e.currentTarget)
            }}
            onClick={(e) => {
              if (skip.current) return void (skip.current = false)
              // a tap on a link follows the link, not the message's quick actions
              if ((e.target as Element).closest('a[href]')) return
              if (sel || getSelection()?.toString()) return
              setQuick(quick ? null : { id: qid, y: yIn(e.clientY) })
            }}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), full(e.currentTarget))}
          >
            {msg.reply?.task ? <TaskQuote id={msg.reply.task} title={msg.reply.text} /> : msg.reply && <span className="quote">{msg.reply.text}</span>}
            {mine ? <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{withLinks(msg.text ?? '')}</div> : <Markdown text={msg.text ?? ''} mentions={msg.mentions} />}
          </div>
          {registry.messageEdge.map((x, i) => <x.View key={i} msg={msg} chat={chat} />)}
        </div>
        {bar && wrap.current && !slide && (
          <QuickBar msg={msg} chat={chat} thread={thread} mine={mine} wrap={wrap.current} y={bar.y} done={() => { setQuick(null); setHover(false) }} more={full} reply={reply} />
        )}
      </div>
      {mark && <div className="seen" role="status">{mark === 'read' ? 'Read' : 'Sent'}</div>}
      {failed !== undefined && msg.cid && (
        <div className="ref" style={{ justifySelf: 'end', marginTop: 0 }}>
          <span className="c-red">Not sent{failed ? ` · ${failed}` : ''}</span>
          <span className="lk" role="button" tabIndex={0} onClick={() => retry(msg.cid!)}>Retry</span>
          <span className="lk" role="button" tabIndex={0} onClick={() => dropOut(msg.cid!)}>Remove</span>
        </div>
      )}
    </>
  )
}

/** A task's brief, the first message of its chat (SHEP-330): from its space's Assistant, the task's title and the prompt
 *  as written, a few lines with Show all when long, its Settings folded away, and under it whether its agent has it. */
export function BriefMessage({ msg, b, space }: { msg: Message; b: TaskBrief; space?: string }) {
  const [all, setAll] = useState(false)
  const [settings, setSettings] = useState(false)
  const [long, setLong] = useState(() => looksLong(b.text))
  const body = useRef<HTMLDivElement>(null)
  // long: its words run past the clipped height (measured, so a short brief shows no Show all)
  useLayoutEffect(() => {
    const el = body.current
    if (el && !all) setLong(el.scrollHeight > el.clientHeight + 1)
  }, [b.text, all])
  return (
    <>
      <div className="bfrom">{briefFrom(space)}</div>
      <div className="b mine brief" data-msg={msg.id}>
        <p className="bt">{b.title}</p>
        <div ref={body} className={cx('bbody', !all && 'clip', !all && long && 'fade')}>
          <Markdown text={b.text} />
        </div>
        {(long || all) && (
          <button type="button" className="fold" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show less' : 'Show all'}
          </button>
        )}
        {!!b.settings?.length && (
          <>
            <button type="button" className="fold" aria-expanded={settings} onClick={() => setSettings(!settings)}>
              <I n={settings ? 'down' : 'right'} c="s16" />
              Settings
            </button>
            {settings && (
              <ul role="list" className="bset">
                {b.settings.map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
      {/* SHEP-329's Sent / Read under a sent message */}
      <div className="seen" role="status">{deliveryWord(b.state)}</div>
    </>
  )
}

function FileRow({ msg, chat, gap }: { msg: Message; chat: Chat; gap: boolean }) {
  const f = msg.file! as NonNullable<Message['file']> & { id?: string }
  const mine = msg.who === 'you'
  const { small, full, box } = sourcesOf(chat.key, f)
  // a picture or video shows itself (this screen's own copy while it still goes up); a tap opens the preview
  if (full && (isImage(f.name) || isVideo(f.name)))
    return (
      <a
        className={cx('pic', mine && 'mine', gap && 'gap')}
        href={full}
        target="_blank"
        rel="noreferrer"
        aria-label={f.alt || f.name}
        data-msg={msg.id}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || isVideo(f.name)) return
          e.preventDefault()
          openPreview(chat.key, f)
        }}
      >
        {isVideo(f.name) ? <video src={full} controls playsInline preload="metadata" /> : <img src={small} alt={f.alt || f.name} loading="lazy" style={box} />}
      </a>
    )
  return (
    <div className={cx('athr', mine && 'mine')} data-msg={msg.id}>
      <SentThumb chat={chat.key} f={f} />
    </div>
  )
}

interface Shown {
  msg: Message
  /** dimmed: not in the agent yet (still on its way, or held on purpose for its turn) */
  pending?: boolean
  failed?: string
  /** under your message (SHEP-329): sent (in the agent's terminal, or its CLI's own queue, which takes it within
   *  seconds), then read (the agent took it in), on your latest until the agent answers */
  mark?: 'sent' | 'read'
}

/** the chat's messages with what you sent that it does not show yet, in the order things were sent */
function shownOf(chat: Chat | undefined, key: string, outbox: Outgoing[]): Shown[] {
  const rows: Shown[] = (chat?.messages ?? [])
    .filter((m) => !(m.waiting && m.waitsFor === 'turn' && m.cid && outbox.some((o) => o.cid === m.cid)))
    .map((msg) => (msg.waiting && msg.waitsFor === 'queue' ? { msg, mark: 'sent' } : { msg, pending: !!msg.waiting }))
  const mine = outbox.filter((o) => o.chat === key)
  if (mine.length) {
    const at = placesOf(rows.map((r) => ({ id: r.msg.id, cid: r.msg.cid })), mine)
    rows.splice(0, rows.length, ...placeOutgoing(rows, mine.map((o) => ({ at: at.get(o.cid) ?? rows.length, rows: partsOf(o, chat).map((msg) => ({ msg, ...showsAs(o) })) }))))
  }
  // your latest message, taken in and not answered yet: read
  const last = rows[rows.length - 1]
  if (last && readNow(last.msg) && !last.pending && !last.mark && last.failed === undefined) rows[rows.length - 1] = { ...last, mark: 'read' }
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
    let height = sc.scrollHeight
    const on = () => {
      // the chat grew (a picture loaded, a card came): that is not the person scrolling up
      if (sc.scrollHeight !== height) {
        height = sc.scrollHeight
        if (stuck.current) return void (sc.scrollTop = sc.scrollHeight)
      }
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
  // a picture that loads later (a card's, a tile's) grows the chat: it stays at the newest message
  useEffect(() => {
    const sc = end.current?.closest<HTMLElement>('.scroll')
    const box = end.current?.parentElement
    if (!sc || !box) return
    const ro = new ResizeObserver(() => {
      if (stuck.current) sc.scrollTop = sc.scrollHeight
    })
    ro.observe(box)
    // the box or the suggested replies above it grew: the chat's window got shorter, its bottom stays in view
    ro.observe(sc)
    return () => ro.disconnect()
  }, [thread.chat])
  // the cards that wait for an answer: while one is out of view, a reminder above the box leads to it (away.ts)
  const waiting = useRef<Waiting[]>([])
  waiting.current = waitingIn(rows, thread)
  useEffect(() => {
    const sc = end.current?.closest<HTMLElement>('.scroll')
    if (!sc) return
    const check = () => {
      const v = sc.getBoundingClientRect()
      const cards = waiting.current.flatMap((w) => {
        const el = sc.querySelector(`[data-card="${attr(w.id)}"]`)
        if (!el) return []
        const r = el.getBoundingClientRect()
        return [{ ...w, top: r.top, bottom: r.bottom }]
      })
      setAway(thread.chat, outOfView(cards, { top: v.top, bottom: v.bottom }))
    }
    check()
    sc.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(sc)
    return () => {
      sc.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [thread.chat, rows])
  useEffect(() => () => setAway(thread.chat, null), [thread.chat])
  useEffect(() => {
    if (!jump) return
    const el = document.querySelector(`[data-msg="${attr(jump)}"], [data-card="${attr(jump)}"]`)
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
  /** the task the last line named: its next message or card needs no second line */
  let lastRef = ''
  /** the last quiet "how it closed" line, so a twin right under it doesn't show */
  let lastEnded = ''
  // the app's own cards (a review, a stopped agent), each where it came up among the messages
  const cards = registry.chatCards.flatMap((c) => c.cards(snap, thread)).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
  const cardsUntil = (at: number) => {
    while (cards.length && (cards[0]!.at ?? Infinity) <= at) {
      const c = cards.shift()!
      out.push(<Fragment key={`c:${c.key}`}>{c.node}</Fragment>)
      prev = 'a'
      lastEnded = ''
    }
  }
  const stub: Chat = chat ?? { key: thread.chat, messages: [], cli: '' }
  for (const { msg: m, pending, failed, mark } of rows) {
    if (m.at) cardsUntil(m.at)
    const who = m.who === 'you' ? 'me' : 'a'
    const k = keyOf(m)
    if (m.at && (!lastAt || new Date(m.at).toDateString() !== new Date(lastAt).toDateString() || m.at - lastAt > QUIET)) out.push(<div key={`t:${k}`} className="time">{dayLabel(m.at)} {clock(m.at)}</div>)
    if (m.at) lastAt = m.at
    const gap = !!prev && prev !== who
    if (m.newSession) {
      out.push(<div key={k} className="time" role="separator">New session</div>)
      continue
    }
    if (m.taskBrief) out.push(<BriefMessage key={k} msg={m} b={m.taskBrief} space={placeOf(snap, thread.place)?.name} />)
    else if (m.activity) out.push(<Did key={k} a={m.activity} />)
    else if (m.question) {
      // a question from a task, shown in this chat: under a line naming the task (once), and it says where that task runs
      const from = m.question.by && !thread.task ? taskIdOf(snap, m.question.by.chat) : null
      if (from && from !== lastRef) out.push(<TaskRef key={`r:${k}`} id={from} title={m.question.by!.title ?? m.question.by!.ref} t={taskOf(snap, from)} />)
      if (from) lastRef = from
      const place = (from && taskOf(snap, from)?.place) || thread.place
      if (m.question.title && !m.question.command && !m.question.plan && !m.question.parts?.length && m.question.sent === undefined && !m.question.closed) out.push(<div key={`q:${k}`} className={cx('b', gap && 'gap')}>{m.question.title}</div>)
      out.push(<QuestionCard key={k} q={m.question} chat={m.question.by?.chat ?? thread.chat} place={place} />)
    } else if (m.secret) out.push(<SecretCard key={k} ask={m.secret} chat={thread.chat} />)
    else if (m.news) {
      // Herdr's news of a task, never a message (SHEP-365): one quiet row under the task's line, or nothing for what
      // the app shows by itself from the task's status (its review card, its Done line)
      const t = taskOf(snap, m.news.task)
      const row = newsRow(m.news, t?.name ?? '')
      if (!row) continue
      if (t && !thread.task && t.id !== lastRef) out.push(<TaskRef key={`r:${k}`} id={t.id} title={t.name} t={t} />)
      if (t) lastRef = t.id
      out.push(<NewsLine key={k} row={row} at={m.at} />)
    } else if (m.card) {
      const t = taskOf(snap, m.card.task)
      if (t && !thread.task && t.id !== lastRef) out.push(<TaskRef key={`r:${k}`} id={t.id} title={t.name} t={t} />)
      if (t) lastRef = t.id
      const text = m.card.text ?? m.text ?? ''
      if (text) out.push(<Bubble key={k} msg={{ ...m, text }} chat={stub} thread={thread} gap={false} onReply={t && !thread.task ? () => replyToTask(t) : undefined} />)
    }
    // a message between agents, in the sender's chat and the receiver's: its own quiet row (SHEP-368)
    else if (m.relay) out.push(<RelayRow key={k} r={m.relay} text={m.text ?? ''} at={m.at} />)
    // when its agent was started again, earlier messages stay, above a thin "New session" line
    else if (m.brief && thread.task && !/new session/i.test(m.brief.label)) continue
    else if (m.brief) out.push(/new session/i.test(m.brief.label) ? <div key={k} className="time" role="separator">New session</div> : <div key={k} className="ref"><I n="note" c="s16" /><span>{m.brief.label}</span></div>)
    // what closed and how ("Fix login · Run: npm test · Allowed"); the same line twice in a row shows once
    else if (m.ended !== undefined) {
      const line = endedLine(m.ended, lastEnded)
      if (!line) continue
      out.push(<DoneRow key={k}>{line}</DoneRow>)
    }
    else if (m.error) out.push(<div key={k} className="ref c-red"><I n="warn" c="s16" /><span>{m.text}</span></div>)
    else if (m.file) out.push(<FileRow key={k} msg={m} chat={stub} gap={gap} />)
    else if (m.text) {
      lastRef = ''
      out.push(<Bubble key={k} msg={m} chat={stub} thread={thread} gap={gap} pending={pending} failed={failed} mark={mark} />)
    }
    for (const [i, p] of registry.messageParts.entries()) out.push(<p.View key={`${k}:p${i}`} msg={m} chat={stub} thread={thread} />)
    // In the fictional shop conversation the review follows the mock-up, before the later task messages.
    if (snap.demo && !thread.task && m.artifact?.id === 'a-mock') cardsUntil(Infinity)
    if (!m.activity) prev = who
    lastEnded = m.ended ?? ''
  }
  const empty = !rows.length && (!chat || chat.fresh || chat.notice === 'none' || chat.top !== false)
  const every = isEverything(snap, thread.place)
  return (
    <>
      {empty && !thread.task && chat && (
        <Empty title={every ? 'Welcome to Shepherdr' : `Nothing in #${placeOf(snap, thread.place)?.name ?? ''} yet`}>Tell me what you want done{every ? ', here or in a space.' : ' here.'}</Empty>
      )}
      {out}
      {thread.task && <StartLine chat={chat} thread={thread} />}
      {cards.map((c) => <Fragment key={`c:${c.key}`}>{c.node}</Fragment>)}
      {registry.chatTail.map((t, i) => <t.View key={i} chat={chat} thread={thread} />)}
      <div ref={end} className="mend" />
    </>
  )
}
const loading = new Set<string>()

/** the cards in these rows still waiting for an answer, oldest first, with the reminder's words */
export function waitingIn(rows: Shown[], thread: Thread): Waiting[] {
  return rows.flatMap(({ msg: m }): Waiting[] => {
    if (m.question && m.question.sent === undefined && !m.question.closed) {
      const by = !thread.task ? m.question.by?.title ?? m.question.by?.ref : undefined
      return [{ id: m.question.id, words: by ? `${by} asks you` : 'A question waits for you' }]
    }
    if (m.secret && !m.secret.saved) return [{ id: m.secret.id, words: `A secret is asked for: ${m.secret.name}` }]
    return []
  })
}

/** one quiet line above the box while a waiting card is out of view; a tap scrolls to it */
function AwayCard({ thread }: { thread: Thread }) {
  const w = useAway(thread.chat)
  if (!w) return null
  return (
    <div className="banner">
      <I n="ask" c="c-ask" />
      <button type="button" className="n" onClick={() => setUI({ jump: w.id })}>{w.words}</button>
    </div>
  )
}

/** a task's id from its chat's key ("vm:SHOP-12/worker") */
const taskIdOf = (snap: Snapshot, chatKey: string) => snap.tasks.find((t) => t.agent?.chat === chatKey)?.id ?? chatKey.replace(/\/[^/]+$/, '')

/** Before a task's agent is at work, what it waits for, in words under its brief (SHEP-330): never an empty page */
function StartLine({ chat, thread }: { chat: Chat | undefined; thread: Thread }) {
  const snap = useSnap()
  const t = snap && thread.task ? snap.tasks.find((x) => x.id === thread.task!.id) ?? thread.task : thread.task
  const words = t ? startWords(t, chat) : ''
  if (!words) return null
  return (
    <div className="ref" role="status">
      <I n="clock" c="s16" />
      <span>{words}</span>
    </div>
  )
}

/** The working sign at the chat's end (SHEP-313, SHEP-343), as Claude Duet shows its agent at work: three dots that
 *  bounce in turn inside a small agent-side speech bubble, where its words will land. The step it is on, when Shepherdr
 *  knows it, stays quiet text beside the bubble, never in it (nothing the agent wrote), in plain words: a task's own
 *  status line, else the tool at work (typing.ts stepWords), never a command line. When words arrive the bubble
 *  goes and they take its place; keyed on the message count, a new one comes back under them a beat later if it still
 *  works, so the bubble seems to turn into the message. */
export function WorkingSign({ chat, thread }: { chat: Chat | undefined; thread?: Thread }) {
  // a task's own status line, what its agent last said it does (not while it waits on you)
  const report = thread?.task?.report
  const sign = signOf(chat, report && !report.paused ? report.msg : undefined)
  // SHEP-421: the line stays while the sign shows, the last step held until the next fades in over it
  const step = chat ? heldStep(chat.key, sign) : ''
  if (!sign) return null
  const n = chat?.messages.length ?? 0
  const el = (
    <div key={n} className="wsign" role="status" aria-label={step}>
      <span className="b wbub" aria-hidden="true"><span className="wdots"><i /><i /><i /></span></span>
      <span key={step} className="wstep">{step}</span>
    </div>
  )
  // SHEP-363: Stop sits on the working row (the box's round button is the voice call while it is empty), at its right
  // end over that round button, outside the sign's grow-in so it is its full size from the start
  if (!chat || !has('voice')) return el
  return (
    <div key={n} className="wrow">
      {el}
      <IB icon="stop" label="Stop" className="wstop" onClick={() => void tryAct({ type: 'stop', chat: chat.key })} />
    </div>
  )
}

/** a tap on it takes no focus: the box's focus (and a phone's keyboard) stays as it was */
export const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

/** A chat's own agent that crashed or was cut off is treated like a task's: a card in that chat with the reason and
 *  Restart. Shepherdr never starts it again on its own. */
function StoppedChat({ chat, thread }: { chat: Chat | undefined; thread: Thread }) {
  const snap = useSnap()
  if (!chat || !snap || thread.task || (chat.notice !== 'ended' && chat.notice !== 'gone')) return null
  const pick = pickOf(snap, chat, thread)
  return (
    <div className="card" data-card={`stopped:${chat.key}`}>
      <span className="t c-red">Stopped</span>
      <span>{chat.note || 'Its agent is no longer running.'}</span>
      <div className="acts">
        <Btn kind="pri" onClick={() => void tryAct({ type: 'restart', chat: chat.key, kind: pick.agent, model: pick.model ?? undefined, effort: pick.effort ?? undefined })}>Restart</Btn>
      </div>
    </div>
  )
}

/* ---------- the message box ---------- */

/** suggested replies already used: gone once you send something */
const spent = new Set<string>()

/** The agent's suggested replies as bubbles above the box (SHEP-186), in its order, the first the primary: a tap sends
 *  one as it is, a press held (or a right-click) puts it in the box to edit instead (ReplyPress). One line each; the
 *  row scrolls sideways when they don't fit. */
export function Replies({ texts, onSend, onEdit }: { texts: string[]; onSend: (t: string) => void; onEdit: (t: string) => void }) {
  return (
    <div className="sugs" role="group" aria-label="Suggested replies">
      {texts.map((t, i) => <Reply key={`${i}:${t}`} text={t} primary={i === 0} onSend={onSend} onEdit={onEdit} />)}
    </div>
  )
}

function Reply({ text, primary, onSend, onEdit }: { text: string; primary: boolean; onSend: (t: string) => void; onEdit: (t: string) => void }) {
  const edit = useRef(onEdit)
  edit.current = onEdit
  const press = useMemo(() => new ReplyPress(() => edit.current(text)), [text])
  useEffect(() => () => press.stop(), [press])
  return (
    <button
      type="button"
      className={cx('sug', primary && 'pri')}
      onMouseDown={keepFocus}
      onPointerDown={(e) => press.down(e.clientX, e.clientY)}
      onPointerMove={(e) => press.move(e.clientX, e.clientY)}
      onPointerUp={() => press.stop()}
      onPointerCancel={() => press.stop()}
      onPointerLeave={() => press.stop()}
      onContextMenu={(e) => {
        e.preventDefault()
        press.menu()
      }}
      onClick={() => press.click() && onSend(text)}
    >
      {text}
    </button>
  )
}

/** what a chat runs on now: its agent's own report; before its chat came, its space's (an Assistant's chat: what its
 *  Assistant runs, else what its first message starts it on, SHEP-298); else what is set for its kind */
export function pickOf(snap: Snapshot, chat: Chat | undefined, thread: Thread): Pick {
  const a = chat?.agent ?? (!thread.task ? snap.places.find((p) => p.id === thread.place && p.chat === thread.chat)?.agent : undefined)
  if (a?.kind) return { agent: a.kind, label: a.modelLabel ?? a.planned?.modelLabel ?? null, model: a.model ?? a.planned?.model ?? null, effort: a.effort ?? a.planned?.effort ?? null, fast: a.speed === 'ultrafast' ? 'ultrafast' : a.speed === 'fast', perm: a.perm ?? null }
  return pickFor(snap, isEverything(snap, thread.place) ? 'all' : thread.place, thread.task ? 'Tasks' : 'Chats')
}

/** A new model, effort or permission mode applies from your next message. A different agent restarts that chat, after
 *  you confirm; earlier messages stay. */
export function applyPick(chat: string, was: Pick, now: Pick, names: { agent: string }) {
  const same = (a: Pick, b: Pick) => a.agent === b.agent && (a.model ?? null) === (b.model ?? null) && (a.effort ?? null) === (b.effort ?? null) && (a.fast ?? false) === (b.fast ?? false) && (a.perm ?? null) === (b.perm ?? null)
  if (same(was, now)) return
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
  // a finger (a phone, a tablet): + opens a menu with Photos and Files
  const finger = useMemo(touch, [])
  const shared = useLanded() === key
  useGrow(ref, text)
  const sg = suggestionOf(chat, suggestionsOn(snap.settings))
  const busy = !!chat?.working && !chat.finished
  const call = useUI((u) => u.call)
  const dictating = useDictating()
  const sending = useStore((s) => s.outbox.some((o) => o.chat === key))
  const sug = sg && !repliesHidden({ text, files: files?.length ?? 0, dictating, call, working: busy, sending, spent: spent.has(sg.id) }) ? sg : null
  const machine = snap.places.find((p) => p.id === thread.place)?.machine ?? snap.host
  const pick = pickOf(snap, chat, thread)
  // a message sent while the agent works goes in at once (it steers); only Ctrl/Cmd+Enter asks it to wait its turn.
  // The round button and Enter send only what is in the box, never a suggested reply (those are their own bubbles).
  // In a voice call the box takes no text (TEXT_IN_CALL).
  const go = (wait = false) => {
    if (getState().ui.call && !TEXT_IN_CALL) return
    const t = text.trim()
    if (!t && !files?.length) return
    if (sg) spent.add(sg.id)
    send(key, key, t, wait && busy)
    setText('')
    if (shared) putAway()
  }

  /** a suggested reply tapped: sent at once as your message, as if typed (no keyboard comes up: its bubble takes no
   *  focus) */
  const sendSug = (t: string) => {
    if (!sug || (getState().ui.call && !TEXT_IN_CALL)) return
    spent.add(sug.id)
    send(key, key, t, false)
    if (shared) putAway()
  }
  /** a suggested reply held: written into the box to edit, the box focused at its end */
  const editSug = (t: string) => {
    setText(t)
    const box = ref.current
    if (!box) return
    box.focus()
    requestAnimationFrame(() => box.setSelectionRange(t.length, t.length))
  }
  const filled = !!text.trim() || !!files?.length
  const BoxEnd = has('voice') ? registry.views.boxEnd : undefined
  const stop = busy && !text.trim() && !files?.length
  return (
    <>
    {sug && <Replies texts={sug.texts} onSend={sendSug} onEdit={editSug} />}
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
      {shared && (
        <div className="fchips">
          <SharedChip chat={key} thread={thread} />
        </div>
      )}
      {reply && (
        <div className="fchips">
          <span className="fchip" aria-label={reply.task ? `Replying to the task ${reply.text}` : undefined}>
            <I n="reply" c="s16" />
            {reply.task && <I n="tasks" c="s16 c-mute" />}
            <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reply.text}</span>
            <button type="button" aria-label="Don't reply to it" onClick={() => setUI((ui) => { const { [key]: _, ...rest } = ui.reply; return { reply: rest } })}><I n="x" c="s16" /></button>
          </span>
        </div>
      )}
      {!!files?.length && (
        <div className="athr box" role="list" aria-label="Files to send">
          {files.map((f, i) => (
            <div role="listitem" key={f.id ?? i}>
              <BoxThumb chat={key} f={f} onRetry={() => f.id && reupload(key, key, f.id)} onRemove={() => detach(key, i)} />
            </div>
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
          placeholder={placeholder}
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
            // Enter sends and Shift+Enter makes a new line, the same on phone and desktop
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              go(e.ctrlKey || e.metaKey)
            }
          }}
        />
      </div>
      <div className="cbar">
        <AddButtons finger={finger} onFiles={(f) => attach(key, key, f)} />
        <AgentLine
          pick={pick}
          machine={machine}
          onClick={() => openPicker({ title: thread.task ? 'This task runs on' : 'This chat runs on', machine, pick, onChange: () => undefined, onClose: (now) => applyPick(key, pick, now, { agent: pickWords(now).agent }) })}
        />
        <span className="sp" />
        {registry.boxButtons.map((b, i) => <b.View key={i} thread={thread} setText={setText} />)}
        {BoxEnd ? (
          <BoxEnd thread={thread} setText={setText} filled={filled} send={() => go()} />
        ) : stop ? (
          <button type="button" className="send" aria-label="Stop" onClick={() => void tryAct({ type: 'stop', chat: key })}>
            <I n="square" c="s16" />
          </button>
        ) : (
          <button type="button" className="send" aria-label="Send" onClick={() => go()}>
            <I n="send" c="s16" />
          </button>
        )}
      </div>
    </div>
    </>
  )
}

/** +: on a desktop it opens files; on a phone or tablet a menu first: Photos, Files. Photos opens Android's
 *  photo picker straight away, newest first, and one tap on a picture attaches it (one at a time: picking several needs an
 *  Add tap more, measured on Android 15); Files takes several pictures at once */
export function AddButtons({ finger, onFiles }: { finger: boolean; onFiles: (f: File[]) => void }) {
  const pickFile = useRef<HTMLInputElement>(null)
  const pickPhoto = useRef<HTMLInputElement>(null)
  const take = (e: { target: HTMLInputElement }) => {
    onFiles([...(e.target.files ?? [])])
    e.target.value = ''
  }
  const plus = (e: { currentTarget: Element }) =>
    finger
      ? openMenu(
          e.currentTarget,
          [
            { icon: 'image', label: 'Photos', run: () => pickPhoto.current?.click() },
            { icon: 'doc', label: 'Files', run: () => pickFile.current?.click() },
          ],
          { label: 'Add' },
        )
      : pickFile.current?.click()
  return (
    <>
      <IB icon="plus" label={finger ? 'Add' : 'Add files'} onClick={plus} />
      <input ref={pickFile} type="file" multiple hidden onChange={take} />
      {finger && <input ref={pickPhoto} type="file" accept="image/*" hidden data-photo="" onChange={take} />}
    </>
  )
}

/** what Android's Share sheet put in this box: where it goes, and Change to send it to another space or task */
function SharedChip({ chat, thread }: { chat: string; thread: Thread }) {
  const snap = useSnap()!
  const t = thread.task
  const where = t ? t.name : isEverything(snap, thread.place) ? 'Everything' : `#${placeOf(snap, thread.place)?.name ?? ''}`
  return (
    <span className="fchip shared">
      <I n="share" c="s16" />
      <span className="where">Shared to {where}</span>
      <button type="button" className="chg" onClick={() => openSendTo(chat)}>Change</button>
      <button type="button" aria-label="Keep it here" onClick={putAway}><I n="x" c="s16" /></button>
    </span>
  )
}

export default definePlugin({
  name: 'chat',
  setup(reg) {
    // Share into Shepherdr (SHEP-345): a share lands in the chat open last
    watchLastChat()
    void landLaunchShare()
    reg.views.messages = Messages
    reg.views.box = Box
    reg.chatTail.push({ order: 15, View: StoppedChat }, { order: 95, View: WorkingSign })
    reg.aboveBox.push({ order: 20, View: AwayCard })
  },
})

export { Box, Messages }
