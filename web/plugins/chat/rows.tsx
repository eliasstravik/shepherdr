// The window's chat rows (mods/chat main.js rowBare/bar) in the web app's look: the band of actions under a message
// (its time, Reply, Copy, Rewind or Fork, then the reactions and the smiley), the quiet rows (a launch brief or a
// message another agent sent, a task's news line, an artifact still publishing), the agent's own question box, an error's red
// words, the reply line over a reply, images under a message, and the first row (Start of conversation, Loading
// earlier…). Their words and rules come from core/chat-view.js, as the window's do.
import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRightIcon, ChatBubbleLeftEllipsisIcon, CheckIcon as TickIcon, ChevronDownIcon, ChevronRightIcon, PaperClipIcon } from '@heroicons/react/16/solid'
import { useCopy } from '@client/copy.ts'
import { act, has, openTask, registry } from '@client/kernel.ts'
import { AutopilotIcon, CheckIcon, CopyIcon, PageIcon, ReplyIcon, SmileIcon, TermIcon } from '@client/ui.tsx'
import * as CV from '@core/chat-view.js'
import type { Chat, Message, ReplyQuote } from '@shared/types.ts'
import { openAccept, useAccepting } from '@client/screens/Accept.tsx'
import { ForkIcon, openPicker, RewindIcon } from '@plugins/reactions/client.tsx'
import { Markdown } from './markdown.tsx'
import { jumpTo, startReply } from './reply.ts'

const { WORDS, clock, initialOf, bandActs, bandOrder, imagesLine, fitThumbs, THUMB_GAP, questionsBelow, literal } = CV as unknown as {
  literal: (text: string) => string
  WORDS: Record<string, string>
  questionsBelow: (n: number) => string
  clock: (at?: number) => string
  initialOf: (name: string) => string
  bandActs: (side: 'user' | 'agent', text?: string, o?: { from?: string | null; fork?: boolean }) => string[]
  bandOrder: (side: 'user' | 'agent', acts: string[], o?: { time?: boolean; react?: boolean }) => string[]
  imagesLine: (n: number) => string
  fitThumbs: (sizes: ({ w: number; h: number } | null)[], width?: number) => { boxes: { w: number; h: number }[]; h: number }
  THUMB_GAP: number
}
export { WORDS, questionsBelow }

/** the small words of a quiet row: 12px, dim, as the window's */
const quiet = 'text-[0.75rem]/5 text-fg3 phone:text-[0.8125rem]/5'

/** a task's or a space's terminal: a space's chat shows it in place, a task's in its panel (set by the chat plugin) */
export let showTerminal: (chat: string) => void = () => undefined
export const onTerminal = (fn: (chat: string) => void) => void (showTerminal = fn)

/* ---------- the band under a message ---------- */

/** ONE row under a message, on its side, its reactions flush under the bubble's outer edge with the smiley beside
 *  them, each side the other's mirror: on yours the time (dim), Reply, Copy, Rewind (not on a /command), the smiley
 *  and then the reactions (furthest right); on the agent's the reactions (furthest left), the smiley, Fork, Copy,
 *  Reply and then the time.
 *  The reactions always show; the rest while the pointer is on the message,
 *  in room that is always kept, so nothing moves. A finger holds the message instead (its own bar). */
export function Band({ msg, chat, cli }: { msg: Message; chat: string; cli?: boolean }) {
  const you = msg.who === 'you'
  const { copied, copy } = useCopy()
  const acts = bandActs(you ? 'user' : 'agent', msg.text, { fork: cli !== false })
  const react = has('reactions')
  const pills = msg.reactions?.length ? registry.messageEdge.map(({ View }, i) => <View key={i} msg={msg} chat={{ key: chat } as Chat} />) : null
  const time = clock(msg.at)
  const btn = 'grid size-[22px] shrink-0 place-items-center rounded-[5px] text-fg3 hover:bg-hover hover:text-fg'
  const hover = 'pointer-coarse:hidden opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100 group-focus-within/msg:opacity-100'
  const icon = (a: string) => {
    if (a === 'reply') return <button key={a} type="button" aria-label="Reply" className={clsx(btn, hover)} onClick={() => startReply(chat, msg)}><ReplyIcon className="size-3.5" /></button>
    if (a === 'copy')
      return (
        <button key={a} type="button" aria-label={copied ? 'Copied' : 'Copy'} className={clsx(btn, hover, copied && 'text-fg opacity-100')}
          onClick={(e) => void copy(msg.text ?? '', 'copy', e)}>
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      )
    if (a === 'rewind')
      return <button key={a} type="button" aria-label="Rewind" className={clsx(btn, hover)} onClick={() => void act({ type: 'rewind', chat, message: msg.id } as never).then(() => showTerminal(chat), (e: Error) => alert(e.message))}><RewindIcon className="size-3.5" /></button>
    return <button key={a} type="button" aria-label="Fork" className={clsx(btn, hover)} onClick={() => void act({ type: 'fork', chat } as never).catch((e: Error) => alert(e.message))}><ForkIcon className="size-3.5" /></button>
  }
  const smiley = react ? (
    <button key="react" type="button" aria-label="React" className={clsx(btn, hover)} onClick={() => openPicker(chat, msg.id)}>
      <SmileIcon className="size-3.5" />
    </button>
  ) : null
  // as the window's: the pills 4px apart, 6px from the smiley (the band's own 2px gap and 4px here)
  const pillRow = pills ? <span key="pills" className={clsx('flex flex-wrap items-center gap-1', you ? 'pl-1' : 'pr-1')}>{pills}</span> : null
  const stamp = time ? <time key="time" dateTime={new Date(msg.at!).toISOString()} className={clsx('shrink-0 text-[0.71875rem] text-fg3 tabular-nums', you ? 'pr-1' : 'pl-1', hover)}>{time}</time> : null
  // the order is core's, as the window's: each side the other's mirror
  const part = (what: string) => (what === 'time' ? stamp : what === 'react' ? smiley : what === 'pills' ? pillRow : icon(what))
  return (
    <div data-band className={clsx('mt-1 flex min-h-[22px] max-w-full flex-wrap items-center gap-0.5', you ? 'justify-end self-end' : 'justify-start self-start')}>
      {bandOrder(you ? 'user' : 'agent', acts, { time: !!time, react }).map(part)}
    </div>
  )
}

/* ---------- the reply line over a reply ---------- */

/** the message this one answers, in one dim line above it (a press brings it into view) */
export function ReplyLine({ q, chat, you }: { q: ReplyQuote; chat: string; you: boolean }) {
  const go = () => (q.id ? jumpTo(chat, q.id) : undefined)
  return (
    <div className={clsx('flex w-full', you ? 'justify-end' : 'justify-start')}>
      <button type="button" data-quote onClick={go} className={clsx('flex max-w-[60%] min-w-0 items-center gap-[5px] text-[0.71875rem]/[18px] text-fg3 hover:text-fg2', q.id ? 'cursor-pointer' : 'cursor-default')}>
        <ReplyIcon className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{q.text}</span>
      </button>
    </div>
  )
}

/** the tasks a message mentions, as chips under it on its side (its id, then its title); a press opens the task */
export function Chips({ msg }: { msg: Message }) {
  if (!msg.mentions?.length) return null
  return (
    <div className={clsx('mt-[3px] flex max-w-full flex-wrap gap-1.5', msg.who === 'you' ? 'justify-end self-end' : 'self-start')}>
      {msg.mentions.map((k) => (
        <button key={k.task} type="button" onClick={() => openTask(k.task)}
          className="flex h-[22px] w-[170px] max-w-full items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-2 text-[0.71875rem] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_25%,transparent)] phone:h-8">
          <span className="shrink-0 font-medium text-fg">{k.ref}</span>
          <span className="min-w-0 truncate text-fg2">{k.title}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- quiet rows ---------- */

/** the window's quiet row: a chevron, its label, its first line; it opens to the words */
function Opens({ label, text, bare, children }: { label: ReactNode; text?: string; bare?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const first = String(text ?? '').split('\n').find((l) => l.trim()) ?? ''
  const Chev = open ? ChevronDownIcon : ChevronRightIcon
  return (
    <div className="flex w-full flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={clsx('flex w-full min-w-0 items-center gap-1.5 rounded-[7px] px-1.5 py-px text-left hover:bg-hover phone:py-1.5', quiet)}>
        <Chev aria-hidden className="size-3 shrink-0" />
        <span className="shrink-0 text-fg2">{label}</span>
        {!open && !bare && first ? <span className="min-w-0 flex-1 truncate">{first}</span> : null}
      </button>
      {open ? <div className="pt-1.5 pb-1 pl-[24px] text-[0.78125rem] text-fg2 phone:text-[0.875rem]">{children ?? <Markdown text={text ?? ''} />}</div> : null}
    </div>
  )
}

/** a launch brief ("Task brief", "New session"): its label, then its words when opened, as written (a "<word>" in them
 *  shows, as in the person's own bubble); a message between agents: AgentRow */
export function BriefRow({ msg }: { msg: Message }) {
  if (msg.brief!.from) return <AgentRow from={msg.brief!.from} to={msg.brief!.to} text={msg.text} at={msg.at} />
  return (
    <Opens label={msg.brief!.label} text={msg.text} bare={msg.brief!.bare}>
      <Markdown text={literal(msg.text ?? '')} />
    </Opens>
  )
}

/** a name's round initial, as a group chat shows who speaks: another agent's in the accent, the chat's own agent's
 *  (a message it sent) neutral */
function Avatar({ name, own }: { name: string; own?: boolean }) {
  return (
    <span aria-hidden className={clsx('grid size-5 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold',
      own ? 'bg-[color-mix(in_srgb,var(--fg)_10%,transparent)] text-fg2' : 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent')}>
      {initialOf(name)}
    </span>
  )
}

/** agent to agent, as a group chat (SHEP-12, SHEP-27): a message another agent sent this one ("Assistant on Mac mini ·
 *  Home") or one this chat's agent sent another ("Assistant → SHEP-4"). One quiet row like a news line: a speech
 *  bubble in the accent, who (→ whom) a step stronger, its first words, its time; it opens in place to the whole
 *  message as a speech bubble from that agent, its initial beside the name, and closes again from the same line */
function AgentRow({ from, to, text, at }: { from: string; to?: string; text?: string; at?: number }) {
  const [open, setOpen] = useState(false)
  const first = String(text ?? '').split('\n').find((l) => l.trim()) ?? ''
  const time = at ? clock(at) : ''
  return (
    <div data-from={to ? undefined : from} data-to={to} className="flex w-full flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-[7px] px-1.5 py-0.5 text-left text-[0.75rem]/5 text-fg2 hover:bg-hover phone:py-1.5 phone:text-[0.8125rem]/5">
        {open ? <Avatar name={from} own={!!to} /> : <ChatBubbleLeftEllipsisIcon aria-hidden className="size-4 shrink-0 fill-accent" />}
        <span className="shrink-0 font-medium text-fg"><span className="sr-only">Message from </span>{from}</span>
        {to ? (
          <>
            <ArrowRightIcon aria-hidden className="size-3 shrink-0 fill-fg3" />
            <span className="sr-only"> to </span>
            <span className="shrink-0 font-medium text-fg">{to}</span>
          </>
        ) : null}
        {!open && first ? <span className="min-w-0 flex-1 truncate">{first}</span> : <span className="flex-1" />}
        {time ? <span className="shrink-0 text-fg3 tabular-nums">{time}</span> : null}
      </button>
      {open ? (
        <div className="mt-1 mb-1 ml-8 max-w-[min(100%_-_2rem,640px)] self-start rounded-[14px] rounded-tl-[4px] bg-bubble px-3 py-2 text-[0.8125rem] text-fg phone:text-[0.9375rem]">
          <Markdown text={text ?? ''} />
        </div>
      ) : null}
    </div>
  )
}

/** a task's news line: its mark, the id, what happened, then its words, dim; a needs-you line still waiting in red.
 *  The line opens the task; a Ready one's Review (opens the Accept card) sits at its right end ("Accepting…" while it runs, as the window's),
 *  gone once the task moved on (the service tells the chat again then) */
export function NewsRow({ msg }: { msg: Message }) {
  const n = msg.news!
  const busy = useAccepting(n.task)
  const tick = (c: string) => (
    <span className={clsx('grid size-3 place-items-center rounded-full text-white', c)}>
      <TickIcon className="size-2.5" />
    </span>
  )
  const mark = n.mark === 'ready' ? tick('bg-ready') : n.mark === 'done' ? tick('bg-fg3') : <span className={clsx('size-2 rounded-full', n.mark === 'started' ? 'bg-work' : n.mark === 'needs' && n.live ? 'bg-need' : 'bg-fg3')} />
  return (
    <div role="button" tabIndex={0} data-news={n.ref} onClick={() => openTask(n.task)} onKeyDown={(e) => e.key === 'Enter' && openTask(n.task)}
      className={clsx('flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-1.5 py-px hover:bg-hover phone:py-1.5', quiet)}>
      <span className="grid size-3.5 shrink-0 place-items-center">{mark}</span>
      <span className="shrink-0 font-medium text-fg2">{n.ref}</span>
      <span className={clsx('shrink-0', n.live ? 'text-need' : 'text-fg2')}>{n.what}</span>
      {n.text ? <><span className="shrink-0">·</span><span className="min-w-0 flex-1 truncate">{n.text}</span></> : <span className="flex-1" />}
      {n.accept ? (
        <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); openAccept(n.task) }}
          className="press-dim ml-1 h-5 shrink-0 rounded-[6px] bg-fg px-2 text-[0.6875rem]/5 font-medium text-bg disabled:opacity-60 phone:h-7 phone:px-2.5 phone:text-xs/7">
          {busy ? 'Accepting…' : 'Review'}
        </button>
      ) : null}
    </div>
  )
}

/** an ask or start screen that closed: what it asked and how it went, quiet (the card itself is gone) */
export function EndedRow({ msg }: { msg: Message }) {
  return (
    <div className={clsx('flex w-full min-w-0 items-center gap-1.5 px-1.5 py-px', quiet)}>
      <CheckIcon className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{msg.ended}</span>
    </div>
  )
}

/** an Autopilot wake: why it woke and, once it shows, how it went ("· checked, nothing new"); its words never show */
export function PilotRow({ msg }: { msg: Message }) {
  return (
    <div data-pilot className={clsx('flex w-full min-w-0 items-center gap-1.5 px-1.5 py-px', quiet)}>
      <AutopilotIcon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{msg.pilot}</span>
    </div>
  )
}

/** a note at the conversation's end (a lost session being started again) */
export function NoteRow({ text }: { text: string }) {
  return <div role="status" className="w-full py-[7px] text-center text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{text}</div>
}

/** instead of the conversation (the window's notice): opening it, not a chat agent, its log not found, its agent
 *  ended; Open terminal where the terminal can say more, Resume for a task's ended agent */
export function Notice({ chat, resume }: { chat: Chat; resume?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const n = chat.notice!
  const task = /\/worker$/.test(chat.key)
  const title = n === 'opening' ? WORDS.opening : n === 'unsupported' ? WORDS.unsupported : n === 'none' ? WORDS.notFound : task ? WORDS.taskEnded : WORDS.agentEnded
  const body = n === 'unsupported' ? WORDS.unsupportedBody : n === 'none' ? WORDS.notFoundBody : null
  const btn = 'press-dim flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[0.78125rem] font-medium phone:h-10'
  return (
    <div role="status" data-notice={n} className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
      <TermIcon className="size-[18px] text-fg3" />
      <div className="pt-1 font-medium text-fg">{title}</div>
      {body ? <div className="max-w-[360px] text-[0.78125rem] text-fg2">{body}</div> : null}
      {n === 'unsupported' || n === 'none' ? (
        <div className="pt-2"><button type="button" onClick={() => showTerminal(chat.key)} className={clsx(btn, 'bg-fg text-bg')}><TermIcon className="size-3.5" />{WORDS.openTerminal}</button></div>
      ) : n === 'ended' && task && resume ? (
        <div className="pt-2"><button type="button" disabled={busy} onClick={() => { setBusy(true); void resume().finally(() => setBusy(false)) }} className={clsx(btn, 'bg-fg text-bg disabled:opacity-60')}>{busy ? WORDS.resuming : 'Resume'}</button></div>
      ) : null}
    </div>
  )
}

/** a publish the artifacts' registry doesn't list yet */
export function PublishingRow() {
  return (
    <div className={clsx('flex w-full min-w-0 items-center gap-1.5 px-1.5 py-px', quiet)}>
      <PageIcon className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{WORDS.publishing}</span>
    </div>
  )
}

/** images sent with a message that the chat can't show: how many, with a paperclip, under it */
export function ImagesLine({ n }: { n: number }) {
  return (
    <div className="flex items-center justify-end gap-[5px] self-end text-[0.75rem] text-fg3 phone:text-[0.8125rem]">
      <PaperClipIcon className="size-3 shrink-0" />
      <span className="truncate">{imagesLine(n)}</span>
    </div>
  )
}

/** an error the CLI wrote: its words in red */
export function ErrorRow({ msg }: { msg: Message }) {
  return <div className="w-full self-start text-[0.78125rem] text-need phone:text-[0.875rem]">{msg.text}</div>
}

/** the agent's own question as the log has it: red while its dialog is open; once it's gone, calm */
export function AskedRow({ msg }: { msg: Message }) {
  const closed = msg.asked !== 'open'
  return (
    <div className="flex w-full flex-col gap-1 self-start rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line2)]">
      <div className={clsx('text-[0.75rem] font-medium phone:text-[0.8125rem]', closed ? 'text-fg3' : 'text-need')}>
        {msg.asked === 'answered' ? WORDS.askedAnswered : closed ? WORDS.askedClosed : WORDS.asked}
      </div>
      <div className={closed ? 'text-fg2' : 'text-fg'}><Markdown text={msg.text ?? ''} /></div>
    </div>
  )
}

/** when the person last scrolled a chat up (a wheel, a finger) */
let scrolledUp = 0
let touchY = 0
if (typeof addEventListener === 'function') {
  addEventListener('wheel', (e) => { if ((e as WheelEvent).deltaY < 0) scrolledUp = Date.now() }, { capture: true, passive: true })
  addEventListener('touchstart', (e) => { touchY = (e as TouchEvent).touches[0]?.clientY ?? 0 }, { capture: true, passive: true })
  addEventListener('touchmove', (e) => { if (((e as TouchEvent).touches[0]?.clientY ?? 0) > touchY) scrolledUp = Date.now() }, { capture: true, passive: true })
}

/** the first row: the log read from its start, or earlier pages that load as the chat scrolls up */
export function HeadRow({ chat }: { chat: Chat }) {
  const ref = useRef<HTMLDivElement>(null)
  // scrolled up to it: the page before loads (as the window's loadEarlier), once per page
  const asked = useRef(0)
  const count = chat.messages.length
  useEffect(() => {
    const el = ref.current
    if (!el || !chat.earlier) return
    const io = new IntersectionObserver(([e]) => {
      // only while the person scrolls up (the window's wheel): a page loaded in its place doesn't load the next
      if (!e?.isIntersecting || asked.current === count || Date.now() - scrolledUp > 1500) return
      asked.current = count
      void act({ type: 'earlier', chat: chat.key } as never).catch(() => undefined)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [chat.earlier, chat.key, count])
  if (!chat.top && !chat.earlier) return null
  return <div ref={ref} data-head={chat.top ? 'top' : 'earlier'} className="w-full py-[7px] text-center text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{chat.top ? WORDS.top : WORDS.loading}</div>
}

/* ---------- images under a message ---------- */

/** each image whole, its shape kept, fitted in 320×220 (one) or 200×140 (several), on the message's side; a press opens
 *  the viewer. sizes are learnt as each one loads */
export function Thumbs({ files, chat, you, faded, open, width }: { files: { name: string; path: string; url: string; caption?: string }[]; chat: string; you: boolean; faded?: boolean; open: (i: number) => void; width: number }) {
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({})
  const fit = fitThumbs(files.map((f) => sizes[f.path] ?? null), width || Infinity)
  return (
    <div className={clsx('flex max-w-full items-start', you ? 'justify-end self-end' : 'justify-start self-start', faded && 'opacity-55')} style={{ gap: THUMB_GAP }} data-thumbs={chat}>
      {files.map((f, i) => (
        <div key={f.path} className="flex shrink-0 flex-col gap-1" style={{ width: fit.boxes[i].w }}>
          <button type="button" aria-label={`Open ${f.name}`} onClick={() => open(i)}
            style={{ width: fit.boxes[i].w, height: fit.boxes[i].h }}
            className="relative shrink-0 overflow-hidden rounded-[8px] bg-bubble after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--fg)_10%,transparent)]">
            <img src={f.url} alt={f.name} draggable={false} loading="lazy" decoding="async" className="block size-full"
              onLoad={(e) => { const im = e.currentTarget; if (!sizes[f.path] && im.naturalWidth) setSizes((s) => ({ ...s, [f.path]: { w: im.naturalWidth, h: im.naturalHeight } })) }} />
          </button>
          {/* an agent's words for it ("Before", "After"), when it gave some */}
          {f.caption ? <div className="truncate px-0.5 text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{f.caption}</div> : null}
        </div>
      ))}
    </div>
  )
}
