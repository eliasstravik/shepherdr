// Chat: every agent, coordinator or reviewer, gets the same chat. Replies render markdown; question cards answer
// a CLI's own menus; what you send shows at once and goes in at once, even mid-turn; only while the CLI shows a menu
// or is starting does it wait, and the bubble says why.
import clsx from 'clsx'
import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ComponentType, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { act, chatName, definePlugin, getDraft, getState, goChat, has, holdReload, openArtifact, openItem, openNeeds, openTask, registry, setDraft, setOutbox, setUI, taskOf, useDraft, useSnap, useStore, useUI, type UI } from '@client/kernel.ts'
import { keyOf, partsOf, priorOf, reasonOf, SEND_TIMEOUT, type Outgoing } from '@client/outbox.ts'
import { AlertIcon, BackIcon, CameraIcon, CheckIcon, Count, DeleteIcon, dimmed, Dot, DownIcon, DownloadIcon, Empty, field, FileIcon, ic, IconButton, KeyIcon, LinkButton, LiveWave, MachineIcon, Menu, MenuItem, MenuSeparator, MenuSetting, MicIcon, ModeIcon, MoreIcon, NextIcon, PageIcon, PlanIcon, PlusIcon, Primary, QuestionIcon, ReplyIcon, RestartIcon, roundBtn, SearchIcon, SecretField, Sent, SmileIcon, Tab, Tabs, TextBox, UpIcon, useElapsed, XIcon } from '@client/ui.tsx'
import { canDictate, dictate, dictSample, type Dictation } from '@client/dictation.ts'
import { extOf, isImage } from '@shared/files.ts'
import { modelCommand, modeName, taskChatId, type CardAsk, type Chat, type MergeEvidence, type Message, type Place, type Question, type ReplyQuote, type SecretAsk, type UpdateCard } from '@shared/types.ts'
import { buzz, mine, openBar, openPicker, quick, react } from '@plugins/reactions/client.tsx'
import { EDGE } from '@client/gestures.ts'
import { still, useArrive } from '@client/motion.ts'
import { draggingFiles, dropped, named, pasted } from './paste.ts'
import { dayLabel } from './days.ts'
import { FindBar, openFind } from './find.tsx'
import { Fold } from './fold.tsx'
import { Markdown } from './markdown.tsx'
import { answeredBy, cancelReply, canReply, isArtifact, jumpTo, startReply } from './reply.ts'
import { typing, working } from './typing.ts'
import { JobsSheet, JobsTag, LiveLine, TurnLine } from './activity.tsx'
import { AgentControls, AgentLine, openRestart, PlaceRestartItem, RestartSheet } from '@client/restart.tsx'

/* ---------- messages ---------- */

/** Human messages, including full task briefs and generated settings, exactly as written. */
function YourText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap wrap-anywhere">{text}</div>
}

export { Markdown }

/** the reaction bar is open on this message (one bubble redraws when it opens, not every one) */
const usePicked = (id: string, chat: string) => useUI((u) => u.pick === id && (u.pickChat ?? chat) === chat)

export function From({ children }: { children: ReactNode }) {
  return <div className="mb-0.5 text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{children}</div>
}

/** out: what you just sent, not back from the agent's log yet (last: its last bubble, which says when it failed) */
function Bubble({ msg, chat, from, out, last }: { msg: Message; chat: Chat; from: string; out?: Outgoing; last?: boolean }) {
  const you = msg.who === 'you'
  // an artifact's card on its own is held, reacted to and replied to as a whole, like a bubble
  const art = isArtifact(msg)
  const canReact = has('reactions') && !msg.waiting && !out && !!(msg.text || msg.file || art)
  const replies = canReply(msg, out)
  const picked = usePicked(msg.id, chat.key)
  const selecting = useUI((u) => u.selecting === msg.id)
  const text = useRef<HTMLDivElement>(null)
  // one on its way isn't a message yet: a hold (or ⋯ with a mouse) offers only to take it out
  const [menu, setMenu] = useState(false)
  const pending = out && out.state !== 'failed' ? out : undefined
  // a finger holds a message to react (like iMessage) and slides it right to reply; Select text in the bar lets it
  // select instead, until a tap elsewhere
  const hold = useHold(canReact && !selecting ? (at) => openBar(chat.key, msg.id, at) : pending ? () => setMenu(true) : null, replies && !selecting ? () => startReply(chat.key, msg) : null)
  useEffect(() => {
    if (!selecting) return
    if (text.current) getSelection()?.selectAllChildren(text.current)
    const off = (e: globalThis.PointerEvent) => !text.current?.contains(e.target as Node) && setUI({ selecting: null })
    addEventListener('pointerdown', off)
    return () => removeEventListener('pointerdown', off)
  }, [selecting])
  const keys = canReact
    ? {
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key !== 'Enter' || e.target !== e.currentTarget) return
          e.preventDefault()
          e.stopPropagation()
          openBar(chat.key, msg.id)
        },
        tabIndex: 0,
        'aria-label': 'Message: press Enter to react',
      }
    : {}
  // a file waiting to go in shows faded, without a line saying so
  const body = !!(msg.text || msg.answered || msg.waiting)
  const reacted = !!msg.reactions?.length
  const edge = registry.messageEdge.map(({ View }, i) => <View key={i} msg={msg} chat={chat} />)
  // reactions sit on the bubble's bottom right corner, yours and the agent's alike (like iMessage and WhatsApp); a row
  // wider than a short bubble grows toward the middle of the screen, never off it
  const pills = reacted ? <div className="relative -mt-2 flex max-w-full flex-wrap justify-end gap-1 self-end pr-2.5 pl-1 phone:-mt-2.5">{edge}</div> : null
  // a reply's quote rides on its first part: the words, or the file when there are none
  const quote = msg.reply ? <Quote q={msg.reply} chat={chat.key} from={from} you={you} /> : null
  const wide = !!msg.artifact
  const parts = registry.messageParts.map(({ View }, i) => <View key={i} msg={msg} chat={chat} from={from} />)
  const unit = (anchor: ReactNode, quoted?: boolean) => (
    <div
      data-msg={msg.id}
      data-chat={chat.key}
      data-you={you ? '' : undefined}
      className={clsx(
        'group/msg relative flex flex-col',
        you ? 'self-end' : 'self-start',
        // an artifact's card keeps the chat's width, less the room for the smiley and reply arrow beside it (a folded
        // one is as wide as its line)
        art ? 'max-w-full has-[[data-card]]:w-full pointer-fine:has-[[data-card]]:w-[calc(100%-4rem)]' : !wide ? 'max-w-full' : you ? 'max-w-[88%]' : 'max-w-[92%] phone:max-w-[96%]',
      )}
    >
      {replies ? <SwipeHint /> : null}
      {quoted ? quote : null}
      {anchor}
      {pills}
      <Beside msg={msg} chat={chat.key} you={you} picked={picked || menu} react={canReact} reply={replies} more={pending && (() => setMenu(true))} />
      {pending && menu ? <PendingMenu out={pending} onClose={() => setMenu(false)} /> : null}
    </div>
  )
  return (
    <>
      {msg.newSession ? <SessionLine /> : null}
      {/* yours on the right, the agent's on the left and a little wider: long replies keep a readable line on a phone */}
      {/* on its way it shows faded, like one waiting, and settles once it is in */}
      {/* data-whole: the message with its parts (a question's card), which an alert's link brings into view */}
      <div
        data-whole={msg.id}
        data-chat={chat.key}
        className={clsx(
          'flex flex-col transition-opacity duration-200',
          you ? 'items-end self-end' : 'items-start self-start',
          // something big (an artifact) takes the chat's whole width; the words above it keep a bubble's
          wide ? 'w-full' : you ? 'max-w-[88%]' : 'max-w-[92%] phone:max-w-[96%]',
          (msg.waiting || out?.state === 'sending') && 'opacity-60',
        )}
      >
        {/* the chat is with one agent, so its name shows only when someone else asks (the CLI's own question) */}
        {!you && msg.question?.asks ? <From>{`${from} · ${msg.question.asks}`}</From> : null}
        {msg.card ? (
          unit(
            <Card
              card={msg.card}
              chat={chat.key}
              at={msg.at}
              press={hold}
              keys={msg.card.task ? undefined : keys}
              className={clsx(canReact && !selecting && clsx(pressable, 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'), touchFor(replies && !selecting), picked && 'shadow-[inset_0_0_0_1.5px_var(--line2),0_0_0_2px_var(--bg)]')}
            />,
          )
        ) : body
          ? unit(
              <div
                data-anchor
                {...keys}
                {...hold}
                className={clsx(
                  // mirrored round corners: the small one points at whoever wrote it. Slack's 15/22 message text
                  'relative max-w-full min-w-0 text-[0.9375rem]/[1.375rem] text-pretty px-3.5 py-2 phone:px-4 phone:py-2.5 phone:text-base/6',
                  you ? 'rounded-bubble rounded-br-[6px] bg-reply' : 'rounded-bubble rounded-bl-[6px] bg-bubble',
                  you ? 'self-end' : 'self-start',
                  // on a touch screen a hold reacts (or offers Remove), so it doesn't start selecting text or a link's preview
                  ((canReact && !selecting) || pending) && clsx(pressable, 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'),
                  // after Select text it selects, though the app's chrome around it doesn't
                  selecting && 'select-text',
                  touchFor(replies && !selecting),
                  picked ? 'shadow-[inset_0_0_0_1.5px_var(--line2),0_0_0_2px_var(--bg)]' : quote && tucks,
                )}
              >
                {msg.answered ? (
                  <div className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
                    <CheckIcon className="inline size-3.5 align-[-2px]" /> {msg.answered}
                    {/* answered on its copy in the space's chat: a link there */}
                    {msg.elsewhere ? (
                      <>
                        {' in '}
                        <LinkButton onClick={() => goChat(msg.elsewhere!.chat)}>{msg.elsewhere.name}</LinkButton>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {msg.waiting ? <div className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{msg.waitsFor === 'menu' ? <>
                  Waiting for your answer above.{' '}
                  {(() => {
                    const blocker = chat.messages.findLast((m) => m.question?.sent === undefined && !!m.question && !m.waiting)
                    return blocker ? <LinkButton onClick={() => jumpTo(chat.key, blocker.id, { card: true })}>Go to question</LinkButton> : null
                  })()}
                </> : waitLine(msg.waitsFor)}</div> : null}
                {msg.text ? <div ref={text} data-text>{you ? <YourText text={msg.text} /> : <Fold id={msg.id}><Markdown text={msg.text} /></Fold>}</div> : null}
              </div>,
              true,
            )
          : null}
        {msg.file
          ? unit(
              <div data-anchor {...hold} className={clsx('relative max-w-full select-none [-webkit-touch-callout:none]', (canReact || pending) && pressable, touchFor(replies), you ? 'self-end' : 'self-start')}>
                <FileTile name={msg.file.name} chat={chat.key} path={msg.file.path} tucked={!body && !!quote} />
              </div>,
              !body,
            )
          : null}
        {art
          ? unit(
              <div
                data-anchor
                {...keys}
                {...hold}
                className={clsx('relative flex w-full flex-col items-start', canReact && clsx(pressable, 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'), touchFor(replies))}
              >
                {parts}
              </div>,
            )
          : null}
        {!body && !msg.file && !art && reacted ? <div className="mt-1.5 flex gap-1">{edge}</div> : null}
        {art ? null : parts}
        {out?.state === 'failed' && last ? <NotSent out={out} /> : null}
      </div>
    </>
  )
}

/** why one you sent waits: a busy agent takes it at once, so only a menu (typing could pick an option), an agent still
 *  starting, a CLI command mid-turn or a machine out of reach hold it */
function waitLine(why: Message['waitsFor']) {
  if (why === 'menu') return 'Waiting for your answer above.'
  if (why === 'start') return 'Goes in once the agent has started'
  if (why === 'turn') return 'Goes in once the agent finishes this step'
  return 'Goes in once it can be reached'
}

/** under what didn't go through: why, and Retry or Remove; the words stay in the bubble. One that went in but never came
 *  back from the agent's log says so calmly: it may well have reached the agent */
function NotSent({ out, className }: { out: Outgoing; className?: string }) {
  const btn = 'relative font-medium text-fg after:absolute after:-inset-x-1.5 after:-inset-y-2.5 hover:underline'
  return (
    <div role="alert" className={clsx('mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[0.75rem] phone:text-[0.8125rem]', out.lost ? 'text-fg2' : 'text-need', className)}>
      {out.lost ? (
        <span>Not delivered</span>
      ) : (
        <span className="flex items-center gap-1.5">
          <AlertIcon className="size-3.5 shrink-0" />
          Not sent. {out.error}
        </span>
      )}
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <button type="button" className={btn} onClick={() => retry(out.cid)}>
          Retry
        </button>
        <span aria-hidden="true" className="text-fg3">·</span>
        <button type="button" className={btn} onClick={() => removeOut(out.cid)}>
          Remove
        </button>
      </span>
    </div>
  )
}

/** take one you sent out of the chat, its words and files with it */
const removeOut = (cid: string) => setOutbox((all) => all.filter((o) => o.cid !== cid))

/** a hold on one still on its way (or ⋯ beside it, with a mouse): Remove takes it out, should it never come back. It
 *  opens above it: what is on its way is always at the end of the chat, over the box */
function PendingMenu({ out, onClose }: { out: Outgoing; onClose: () => void }) {
  return (
    <Menu label="Message" onClose={onClose} className="absolute right-0 bottom-full z-21 mb-1.5 w-max min-w-0! origin-bottom-right">
      <MenuItem
        icon={<DeleteIcon className={ic} />}
        onClick={() => {
          onClose()
          removeOut(out.cid)
        }}
      >
        Remove
      </MenuItem>
    </Menu>
  )
}

type At = { x: number; y: number; touch: boolean }

/** Telegram's timing: nothing for the first 120 ms (a tap, or a scroll starting), then the bubble eases down over the
    rest of the hold and it opens; slower than a tap, quicker than Safari's own long press */
const HOLD = 380
/** when a finger last scrolled the chat, its fling included: a finger that lands on a moving chat stops it, it doesn't
    hold a message. The chat following a reply as it comes in doesn't count. */
let scrolled = 0
let touched = 0
if (typeof addEventListener === 'function') {
  const touch = () => (touched = Date.now())
  addEventListener('touchmove', touch, { capture: true, passive: true })
  addEventListener('touchend', touch, { capture: true, passive: true })
  addEventListener('scroll', () => Math.min(Date.now() - touched, Date.now() - scrolled) < 120 && (scrolled = Date.now()), { capture: true, passive: true })
}

/** how far a message slides right before letting go replies to it (like WhatsApp and Telegram) */
const SWIPE = 64
/** how far the chat slides left to show every message's time (like iMessage) */
const PEEK = 80

/** on a touch screen, holding a message (or tapping it twice) does fn, with a light tap from the phone; sliding it
    right replies (swipe), sliding it left shows every message's time while the finger stays; scrolling, a tap on a link or a picture, a swipe from the screen's edge and a mouse are left
    alone */
function useHold(fn: ((at: At) => void) | null, swipe: (() => void) | null = null) {
  const r = useRef<{ x: number; y: number; touch: boolean; fired: boolean; last: number; el?: HTMLElement; timer?: ReturnType<typeof setTimeout>; slide?: 'on' | 'peek' | 'off'; dx: number; armed?: boolean }>({
    x: 0,
    y: 0,
    touch: false,
    fired: false,
    last: 0,
    dx: 0,
  })
  const cancel = () => {
    clearTimeout(r.current.timer)
    r.current.el?.removeAttribute('data-pressing')
  }
  /** the message the finger slides: its bubble with what hangs off it, or the album a picture is in, and the reply
      arrow beside it */
  const row = () =>
    (r.current.slide === 'peek' ? r.current.el?.closest<HTMLElement>('[data-messages]') : (r.current.el?.closest<HTMLElement>('[data-slide]') ?? r.current.el?.closest<HTMLElement>('[data-msg]'))) ?? null
  const slideBack = () => {
    const el = row()
    const dx = r.current.dx
    r.current.slide = undefined
    r.current.dx = 0
    if (!el || !dx) return
    el.style.removeProperty('translate')
    el.style.removeProperty('--swipe')
    el.style.removeProperty('--peek')
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 220, easing: 'cubic-bezier(.25, 1.12, .4, 1)' })
  }
  useEffect(() => cancel, [])
  if (!fn && !swipe) return {}
  const fire = () => {
    cancel()
    r.current.fired = true
    buzz()
    fn?.({ x: r.current.x, y: r.current.y, touch: true })
  }
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      cancel()
      const touch = e.pointerType !== 'mouse'
      const again = touch && Date.now() - r.current.last < 300 && Math.hypot(e.clientX - r.current.x, e.clientY - r.current.y) < 24
      r.current = { ...r.current, x: e.clientX, y: e.clientY, touch, fired: false, el: e.currentTarget, slide: undefined, dx: 0, armed: false }
      // a swipe from the screen's edge is the screen's (it goes back, or opens the places)
      if (!touch || Date.now() - scrolled < 250 || e.clientX < EDGE) return
      r.current.armed = true
      if (!fn) return
      if (again) {
        r.current.last = 0
        return fire()
      }
      // pressed in by about 15px across, like Telegram: the same feel on a short bubble and a wide one
      const el = e.currentTarget
      el.style.setProperty('--press', String(Math.max(0.9, (el.offsetWidth - 15) / el.offsetWidth)))
      el.setAttribute('data-pressing', '')
      r.current.timer = setTimeout(fire, HOLD)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const dx = e.clientX - r.current.x
      const dy = e.clientY - r.current.y
      if (Math.hypot(dx, dy) > 10) cancel()
      if (!r.current.armed || r.current.fired || r.current.slide === 'off') return
      if (!r.current.slide) {
        if (Math.hypot(dx, dy) < 10) return
        // mostly rightwards: a reply; leftwards: every message's time; up or down is a scroll, and the browser has it
        if (Math.abs(dx) < Math.abs(dy) * 1.5 || (dx > 0 && !swipe)) return void (r.current.slide = 'off')
        r.current.slide = dx > 0 ? 'on' : 'peek'
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
      const el = row()
      if (!el) return
      if (r.current.slide === 'peek') {
        // the chat follows the finger left as far as the times need, then holds back
        const x = Math.min(0, dx >= -PEEK ? dx : -PEEK + (dx + PEEK) * 0.25)
        r.current.dx = x
        el.style.translate = `${x}px 0`
        el.style.setProperty('--peek', String(Math.min(1, -x / PEEK)))
        return
      }
      // it follows the finger to the mark, then holds back
      const x = Math.max(0, dx <= SWIPE ? dx : SWIPE + (dx - SWIPE) * 0.25)
      if (x >= SWIPE && r.current.dx < SWIPE) buzz()
      r.current.dx = x
      el.style.translate = `${x}px 0`
      el.style.setProperty('--swipe', String(Math.min(1, x / SWIPE)))
    },
    onPointerUp: () => {
      cancel()
      if (r.current.slide === 'peek') {
        r.current.fired = true
        r.current.last = 0
        slideBack()
        return
      }
      if (r.current.slide === 'on') {
        const go = r.current.dx >= SWIPE
        // the tap that ends a slide opens nothing
        r.current.fired = true
        r.current.last = 0
        slideBack()
        if (go) swipe?.()
        return
      }
      r.current.last = r.current.touch && !r.current.fired ? Date.now() : 0
    },
    onPointerCancel: () => {
      cancel()
      slideBack()
      r.current.last = 0
    },
    // the tap that ends a hold opens nothing
    onClickCapture: (e: MouseEvent) => {
      if (!r.current.fired) return
      e.preventDefault()
      e.stopPropagation()
      r.current.fired = false
    },
    // a long press on Android also asks for the browser's own menu
    onContextMenu: (e: MouseEvent) => r.current.touch && e.preventDefault(),
    // sideways swipes on it are its own, not the screen's (gestures.ts)
    'data-hold': '',
  }
}

/** a bubble held down eases in, and springs back if let go early; with reduced motion it stays still */
const pressable =
  'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:data-pressing:scale-(--press) motion-safe:data-pressing:delay-120 motion-safe:data-pressing:duration-260'

/** a message that slides right to reply leaves sideways moves to the page; others let the browser have them (and
    skip its wait for a second tap) */
const touchFor = (slides: boolean) => (slides ? 'touch-pan-y touch-pinch-zoom' : 'touch-manipulation')

/** the reply arrow that comes in beside a message as a finger slides it right */
function SwipeHint() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-full mr-2 grid size-8 -translate-y-1/2 scale-[calc(0.5+0.5*var(--swipe,0))] place-items-center rounded-full bg-bubble text-fg2 opacity-[var(--swipe,0)] pointer-fine:hidden"
    >
      <ReplyIcon className={ic} />
    </span>
  )
}

/** with a mouse, a smiley and a reply arrow beside the message (like Slack and WhatsApp on the web) */
function Beside({ msg, chat, you, picked, react, reply, more, name, over }: { msg: Message; chat: string; you: boolean; picked: boolean; react: boolean; reply: boolean; more?: () => void; name?: string; over?: boolean }) {
  if (!react && !reply && !more) return null
  const btn = over
    ? 'grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70'
    : 'grid size-7 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg2'
  return (
    <div
      className={clsx(
        'absolute hidden items-center gap-0.5 transition-opacity focus-within:opacity-100 pointer-fine:flex',
        over ? 'top-1 right-1 gap-1' : clsx('top-1.5', you ? 'right-full mr-1 flex-row-reverse' : 'left-full ml-1'),
        picked ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100',
      )}
    >
      {react ? (
        <button
          type="button"
          aria-label={name ? `React to ${name}` : 'React'}
          onClick={(e) => openBar(chat, msg.id, e.detail ? { x: e.clientX, y: e.clientY, touch: false } : undefined)}
          className={clsx(btn, picked && !over && 'bg-hover text-fg2')}
        >
          <SmileIcon className={ic} />
        </button>
      ) : null}
      {reply ? (
        <button type="button" aria-label={name ? `Reply to ${name}` : 'Reply'} onClick={() => startReply(chat, msg)} className={btn}>
          <ReplyIcon className={ic} />
        </button>
      ) : null}
      {more ? (
        <button type="button" aria-label={name ? `More for ${name}` : 'More'} aria-haspopup="menu" onClick={more} className={clsx(btn, picked && !over && 'bg-hover text-fg2')}>
          <MoreIcon className={ic} />
        </button>
      ) : null}
    </div>
  )
}

/** a tap on a quote (or the box's reply line) jumps to the message it answers and lights it up; a div with the
    button role, not a button: a button leaves its width out of its parent's */
function jumps(chat: string, q: ReplyQuote, label: string) {
  if (!q.id) return {}
  const jump = (e: { stopPropagation(): void }) => {
    e.stopPropagation()
    jumpTo(chat, q.id!)
  }
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': `${label}: ${q.text}. Show it`,
    onClick: jump,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      jump(e)
    },
  }
}

/** the quote on a reply: one line of the message it answers, in that message's own shade, tucked under the top of the
    reply (like Messenger and iMessage). It takes no width of its own: the message stays as wide as its bubble (so
    reactions and the buttons beside it stay by it) and a long quote reaches past a short reply toward the middle.
    loose: on its own, not tucked (a card answered in the chat quotes the message that answered it) */
export function Quote({ q, chat, from, you, loose, label = 'Replying to' }: { q: ReplyQuote; chat: string; from: string; you: boolean; loose?: boolean; label?: string }) {
  const name = q.who === 'you' ? 'You' : q.who === 'agent' ? from : null
  return (
    <div className={clsx('relative flex', loose ? 'min-w-0' : '-mb-2 w-0 min-w-full', you ? 'justify-end' : 'justify-start')}>
      <div
        {...jumps(chat, q, `${label} ${name ?? 'a message'}`)}
        data-quote
        className={clsx(
          'truncate rounded-bubble px-3 text-[0.8125rem] text-fg2 phone:text-[0.875rem]',
          // the reply covers its bottom 8px: the words sit in the part that shows
          loose ? 'min-w-0 py-1 phone:py-1.5' : 'max-w-[min(18rem,calc(100vw-5rem))] shrink-0 pt-1 pb-3 phone:pt-1.5 phone:pb-3.5',
          q.who === 'you' ? 'bg-reply' : 'bg-bubble',
          loose ? null : you ? 'mr-2' : 'ml-2',
          q.id && 'cursor-pointer hover:text-fg',
        )}
      >
        {name ? <span className="mr-0.5 font-medium">{name} </span> : null}
        {q.file ? <FileIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.artifact ? <PageIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.text}
      </div>
    </div>
  )
}

/** what sits on a quote's bottom edge: a ring in the page colour, so a reply in the same shade still shows its edge */
const tucks = 'shadow-[0_0_0_2px_var(--bg)]'

/* ---------- attachments: each one a message of its own; pictures as small tiles side by side, anything else as a file tile ---------- */

export const fileUrl = (chat: string, path: string, download = false) =>
  `api/file?chat=${encodeURIComponent(chat)}&path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`

/** a picture on its own, with no words: it shows as a tile, and the viewer pages through every one in the chat */
export const isPicture = (m: Message) => !!m.file && !m.text && !m.answered && isImage(m.file.name)

function FileTile({ name, chat, path, tucked }: { name: string; chat: string; path: string; tucked?: boolean }) {
  const ext = extOf(name)
  return (
    <div className={clsx('flex w-[280px] max-w-full items-center gap-1 rounded-box bg-bubble p-1.5', tucked && tucks)}>
      <a href={fileUrl(chat, path)} target="_blank" rel="noopener" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-row p-1 hover:bg-hover">
        <span className="grid size-10 shrink-0 place-items-center rounded-[calc(var(--row-radius)-var(--spacing))] bg-bg text-fg2">
          <FileIcon className={ic} />
        </span>
        <span className="min-w-0">
          <span className="block truncate">{name}</span>
          <span className="block text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{ext ? `${ext.toUpperCase()} file` : 'File'}</span>
        </span>
      </a>
      <a href={fileUrl(chat, path, true)} download={name} aria-label={`Download ${name}`} className="hit grid size-9 shrink-0 place-items-center rounded-full text-fg2 hover:bg-hover phone:size-11">
        <DownloadIcon className={ic} />
      </a>
    </div>
  )
}

/** how pictures sent together lie: one keeps its shape; two or three sit in a row, four in a square, five or six in
 *  two rows of three, and past six the sixth says +N (like WhatsApp and Telegram) */
export function albumRows(n: number) {
  return n <= 3 ? [n] : n === 4 ? [2, 2] : n === 5 ? [3, 2] : [3, 3]
}

/** pictures sent together: small tiles about the size of the ones in the message box, side by side, the album's outer
 *  corners rounded like a bubble's (the small one points at whoever sent them) */
function Album({ msgs, chat, from, out, last: lastPart }: { msgs: Message[]; chat: Chat; from: string; out?: Outgoing; last?: boolean }) {
  const you = msgs[0].who === 'you'
  const rows = albumRows(msgs.length)
  const cols = Math.max(...rows)
  // the sixth tile is covered too: +N counts every picture not seen
  const more = msgs.length > 6 ? msgs.length - 5 : 0
  const big = 'var(--bubble-radius)'
  const small = '4px'
  let i = 0
  return (
    <>
      {msgs[0].newSession ? <SessionLine /> : null}
      <div
        role="group"
        data-slide
        aria-label={msgs.length > 1 ? `${msgs.length} pictures` : undefined}
        style={msgs.length > 1 ? ({ '--cols': cols } as CSSProperties) : undefined}
        className={clsx(
          'relative flex max-w-full flex-col gap-[3px] [--tile:--spacing(21)] phone:[--tile:--spacing(22)]',
          msgs.length > 1 && 'w-[calc(var(--tile)*var(--cols)+3px*(var(--cols)-1))]',
          you ? 'self-end' : 'self-start',
          'transition-opacity duration-200',
          (msgs[0].waiting || out?.state === 'sending') && 'opacity-60',
        )}
      >
        {canReply(msgs[0], out) ? <SwipeHint /> : null}
        {msgs[0].reply ? <Quote q={msgs[0].reply} chat={chat.key} from={from} you={you} /> : null}
        {rows.map((len, r) => (
          <div key={r} className={clsx('flex gap-[3px]', you && 'justify-end')}>
            {Array.from({ length: len }, (_, c) => {
              const m = msgs[i++]
              const last = r === rows.length - 1
              // the album's outer corners are a bubble's; the ones between tiles are small
              const radius = [
                !r && !c ? big : small,
                !r && c === len - 1 ? big : small,
                last && c === len - 1 ? (you ? '6px' : big) : small,
                last && !c ? (you ? big : '6px') : small,
              ].join(' ')
              return <Tile key={keyOf(m)} msg={m} chat={chat} you={you} radius={radius} single={msgs.length === 1} more={i === 6 ? more : 0} out={out} />
            })}
          </div>
        ))}
      </div>
      {out?.state === 'failed' && lastPart ? <NotSent out={out} className="-mt-2.5 self-end" /> : null}
    </>
  )
}

/** one picture in an album, a message of its own: a tap opens it full screen; a hold (or the smiley on it, with a
 *  mouse) reacts, and its reactions sit in its bottom right corner */
function Tile({ msg, chat, you, radius, single, more, out }: { msg: Message; chat: Chat; you: boolean; radius: string; single: boolean; more: number; out?: Outgoing }) {
  const f = msg.file!
  // a picture this browser can't show (HEIC on most desktops) is a file tile, or a small one in an album
  const [broken, setBroken] = useState(false)
  // one on its way isn't a message yet: nothing to react to
  const canReact = has('reactions') && !msg.waiting && !out
  const replies = canReply(msg, out)
  const picked = usePicked(msg.id, chat.key)
  // one on its way offers only Remove, as a bubble does
  const [menu, setMenu] = useState(false)
  const pending = out && out.state !== 'failed' ? out : undefined
  const hold = useHold(canReact ? (at) => openBar(chat.key, msg.id, at) : pending ? () => setMenu(true) : null, replies ? () => startReply(chat.key, msg) : null)
  const edge = msg.reactions?.length ? registry.messageEdge.map(({ View }, i) => <View key={i} msg={msg} chat={chat} />) : null
  const smiley = (beside: boolean) => (
    <>
      <Beside msg={msg} chat={chat.key} you={you} picked={picked || menu} react={canReact} reply={replies} more={pending && (() => setMenu(true))} name={f.name} over={!beside} />
      {pending && menu ? <PendingMenu out={pending} onClose={() => setMenu(false)} /> : null}
    </>
  )
  // on its own it is a file tile like any other file, its reactions on its bottom right corner as on a bubble
  if (broken && single)
    return (
      <div data-msg={msg.id} data-chat={chat.key} data-you={you ? '' : undefined} className="group/msg relative flex max-w-full flex-col">
        <div data-anchor {...hold} className={clsx('relative max-w-full select-none [-webkit-touch-callout:none]', (canReact || pending) && pressable, touchFor(replies))}>
          <FileTile name={f.name} chat={chat.key} path={f.path} />
        </div>
        {edge ? <div className="relative -mt-2 flex max-w-full flex-wrap justify-end gap-1 self-end pr-2.5 pl-1 phone:-mt-2.5">{edge}</div> : null}
        {smiley(true)}
      </div>
    )
  const frame = 'relative block overflow-hidden bg-bubble after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--line)]'
  return (
    <div data-msg={msg.id} data-chat={chat.key} data-you={you ? '' : undefined} className={clsx('group/msg relative min-w-0', !single && 'h-(--tile) flex-1')}>
      {broken ? (
        <a
          data-anchor
          href={fileUrl(chat.key, f.path, true)}
          download={f.name}
          aria-label={`Download ${f.name}`}
          {...hold}
          style={{ borderRadius: radius }}
          className={clsx(frame, 'grid size-full place-items-center text-fg2 select-none [-webkit-touch-callout:none] hover:text-fg', (canReact || pending) && pressable, touchFor(replies))}
        >
          <span className="grid justify-items-center gap-0.5 text-[0.6875rem] phone:text-[0.75rem]">
            <FileIcon className={ic} />
            {extOf(f.name).toUpperCase()}
          </span>
        </a>
      ) : (
        <button
          data-anchor
          type="button"
          aria-label={more ? `Open ${f.name} and ${more - 1} more` : `Open ${f.name}`}
          {...hold}
          // one on its way isn't a message yet: it opens on its own, like a file in the message box
          onClick={() => setUI({ photo: out ? { chat: chat.key, file: f } : { chat: chat.key, msg: msg.id } })}
          style={{ borderRadius: radius }}
          className={clsx(frame, 'select-none [-webkit-touch-callout:none]', (canReact || pending) && pressable, touchFor(replies), !single && 'size-full', picked && 'outline-2 outline-offset-2 outline-(--line2)')}
        >
          <img
            src={fileUrl(chat.key, f.path)}
            alt={f.name}
            draggable={false}
            onError={() => setBroken(true)}
            className={single ? 'block max-h-32 max-w-44 min-h-16 min-w-16 object-cover phone:max-h-36 phone:max-w-48' : 'size-full object-cover'}
          />
          {more ? <span className="absolute inset-0 grid place-items-center bg-black/45 text-[1.25rem] font-semibold text-white tabular-nums">+{more}</span> : null}
        </button>
      )}
      {/* reactions sit in the tile's corner: an album has no bubble edge of its own to hang them from */}
      {edge ? <div className="pointer-events-none absolute right-1 bottom-1 flex w-max max-w-[calc(var(--tile,100%)*3)] flex-wrap-reverse justify-end gap-1 *:pointer-events-auto">{edge}</div> : null}
      {smiley(false)}
    </div>
  )
}

type Shot = { file: { name: string; path: string }; msg?: Message }

/** what the viewer pages through: every picture in the chat, or the ones still waiting in the message box */
function shotsOf(photo: NonNullable<UI['photo']>, chat: Chat | undefined, waiting: { name: string; path?: string }[]): Shot[] {
  if (photo.msg) return (chat?.messages ?? []).filter(isPicture).map((m) => ({ file: m.file!, msg: m }))
  return waiting.filter((f) => f.path && isImage(f.name)).map((f) => ({ file: { name: f.name, path: f.path! } }))
}

/** a picture opened full screen: swipe or use the arrow keys for the others, pinch or double-tap to zoom, drag to look
 *  around, swipe it away, tap or press Esc to close */
function Photo() {
  const ui = useUI()
  const chat = useChat(ui.photo?.chat ?? '')
  if (!ui.photo) return null
  const photo = ui.photo
  const all = shotsOf(photo, chat, ui.files[photo.chat] ?? [])
  let at = all.findIndex((s) => (photo.msg ? s.msg?.id === photo.msg : s.file.path === photo.file?.path))
  // one no longer in the chat or the box shows on its own
  const shots = at < 0 && photo.file ? [{ file: photo.file }] : all
  if (at < 0) at = 0
  const shot = shots[at]
  if (!shot) return null
  const go = (s: Shot) => setUI({ photo: s.msg ? { chat: photo.chat, msg: s.msg.id } : { chat: photo.chat, file: s.file } })
  return <PhotoView key={shot.msg?.id ?? shot.file.path} shots={shots} at={at} go={go} chatKey={photo.chat} />
}

type Pt = { x: number; y: number }
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const MAX_ZOOM = 5
/** the dark space between two pictures as they slide past */
const GAP = 16

function PhotoView({ shots, at: index, go, chatKey }: { shots: Shot[]; at: number; go: (s: Shot) => void; chatKey: string }) {
  const { file: f, msg } = shots[index]
  const prev = shots[index - 1]
  const next = shots[index + 1]
  const box = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const [broken, setBroken] = useState(false)
  /** the picture's zoom and how far it is moved from the middle */
  const v = useRef({ s: 1, x: 0, y: 0 })
  const pts = useRef(new Map<number, Pt>())
  /** the gesture under way, from where it started; a swipe picks its way (across to page, up or down to close) */
  const g = useRef<{ kind: 'pinch' | 'pan' | 'swipe'; d0: number; s0: number; m0: Pt; t0: Pt; axis?: 'x' | 'y' } | null>(null)
  /** since the first finger went down: did it move, was it ever two fingers */
  const touch = useRef({ at: 0, start: { x: 0, y: 0 }, moved: false, multi: false })
  const lastTap = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sliding = useRef<ReturnType<typeof setTimeout>>(undefined)
  const close = () => setUI({ photo: null })

  const draw = (animate = false) => {
    const el = img.current
    if (!el) return
    // with reduced motion it lands at once
    el.style.transition = animate && !still() ? 'transform 200ms ease-out' : ''
    el.style.transform = `translate(${v.current.x}px, ${v.current.y}px) scale(${v.current.s})`
  }
  const shift = (x: number, animate = false) => {
    const el = strip.current
    if (!el) return
    el.style.transition = animate && !still() ? 'transform 220ms ease-out' : ''
    el.style.transform = `translateX(${x}px)`
  }
  /** slide to the one before (-1) or after (1); at either end it stays */
  const page = (dir: 1 | -1) => {
    const to = dir > 0 ? next : prev
    if (sliding.current) return
    if (!to) return shift(0, true)
    shift(-dir * (box.current!.clientWidth + GAP), true)
    sliding.current = setTimeout(() => go(to), still() ? 0 : 220)
  }
  /** keep a zoomed picture over the screen: no empty space past its edges */
  const settle = () => {
    const el = img.current
    const b = box.current
    if (!el || !b) return
    const { s } = v.current
    if (s <= 1.01) v.current = { s: 1, x: 0, y: 0 }
    else {
      const mx = Math.max(0, (el.offsetWidth * s - b.clientWidth) / 2)
      const my = Math.max(0, (el.offsetHeight * s - b.clientHeight) / 2)
      v.current.x = Math.min(mx, Math.max(-mx, v.current.x))
      v.current.y = Math.min(my, Math.max(-my, v.current.y))
    }
    draw(true)
  }
  /** zoom to s, keeping the point p (from the middle of the screen) where it is */
  const zoomAt = (s: number, p: Pt, from = v.current) => {
    const k = s / from.s
    v.current = { s, x: p.x - (p.x - from.x) * k, y: p.y - (p.y - from.y) * k }
  }
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
  }
  const begin = () => {
    const [a, b] = [...pts.current.values()]
    const t0 = { x: v.current.x, y: v.current.y }
    g.current = b ? { kind: 'pinch', d0: dist(a, b), s0: v.current.s, m0: mid(a, b), t0 } : { kind: v.current.s > 1 ? 'pan' : 'swipe', d0: 0, s0: v.current.s, m0: a, t0 }
  }

  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true })
    // a mouse wheel or trackpad pinch zooms where the pointer is
    const el = box.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(Math.min(MAX_ZOOM, Math.max(1, v.current.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)))), at(e))
      if (v.current.s === 1) v.current = { s: 1, x: 0, y: 0 }
      draw()
      clearTimeout(tapTimer.current)
      tapTimer.current = setTimeout(settle, 150)
    }
    // the arrow keys page through them
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      page(e.key === 'ArrowRight' ? 1 : -1)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    addEventListener('keydown', key)
    return () => {
      el.removeEventListener('wheel', wheel)
      removeEventListener('keydown', key)
      clearTimeout(tapTimer.current)
      // closed mid-slide: it doesn't open again on the next one
      clearTimeout(sliding.current)
    }
  }, [])

  const down = (e: PointerEvent) => {
    if (e.button > 0 || sliding.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    if (!pts.current.size) touch.current = { at: Date.now(), start: p, moved: false, multi: false }
    pts.current.set(e.pointerId, p)
    if (pts.current.size > 1) touch.current.multi = true
    begin()
  }
  const move = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !g.current) return
    const p = at(e)
    pts.current.set(e.pointerId, p)
    if (dist(p, touch.current.start) > 8) touch.current.moved = true
    const { kind, d0, s0, m0, t0 } = g.current
    if (kind === 'pinch') {
      const [a, b] = [...pts.current.values()]
      const m = mid(a, b)
      zoomAt(Math.min(MAX_ZOOM, Math.max(1, (s0 * dist(a, b)) / d0)), m0, { s: s0, ...t0 })
      v.current.x += m.x - m0.x
      v.current.y += m.y - m0.y
    } else if (kind === 'pan') v.current = { s: s0, x: t0.x + p.x - m0.x, y: t0.y + p.y - m0.y }
    else {
      const dx = p.x - m0.x
      const dy = p.y - m0.y
      if (!g.current.axis) {
        if (Math.hypot(dx, dy) < 8) return
        g.current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      // across: the row of pictures follows the finger, holding back at either end
      if (g.current.axis === 'x') return shift((dx > 0 ? prev : next) ? dx : dx / 3)
      // up or down: it follows the finger away and the dark behind it fades
      v.current = { s: 1, x: 0, y: dy }
      if (shade.current) shade.current.style.opacity = String(Math.max(0.3, 1 - Math.abs(dy) / 400))
    }
    draw()
  }
  const up = (e: PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return
    // a finger lifted from a pinch: the other one goes on moving it
    if (pts.current.size) return begin()
    const gesture = g.current
    g.current = null
    if (gesture?.kind === 'swipe' && gesture.axis === 'x') {
      const dx = at(e).x - gesture.m0.x
      if (Math.abs(dx) > Math.min(80, box.current!.clientWidth / 5) && e.type !== 'pointercancel') page(dx < 0 ? 1 : -1)
      else shift(0, true)
      return
    }
    if (gesture?.kind === 'swipe' && Math.abs(v.current.y) > 100) {
      if (still()) return close()
      // it carries on off the screen
      v.current.y = Math.sign(v.current.y) * innerHeight
      draw(true)
      setTimeout(close, 180)
      return
    }
    if (shade.current) shade.current.style.opacity = '1'
    settle()
    const t = touch.current
    if (t.moved || t.multi || Date.now() - t.at > 350 || e.type === 'pointercancel') return
    // a tap: two quick ones zoom in (or back out); one closes when it isn't zoomed
    clearTimeout(tapTimer.current)
    if (Date.now() - lastTap.current < 300) {
      lastTap.current = 0
      if (v.current.s > 1) v.current = { s: 1, x: 0, y: 0 }
      else zoomAt(2.5, t.start)
      settle()
    } else {
      lastTap.current = Date.now()
      tapTimer.current = setTimeout(() => v.current.s <= 1 && close(), 260)
    }
  }

  // the bars over the picture take their own taps: they start no gesture
  const own = { onPointerDown: (e: PointerEvent) => e.stopPropagation(), onPointerUp: (e: PointerEvent) => e.stopPropagation() }
  const barBtn = 'grid size-10 shrink-0 place-items-center rounded-full bg-white/12 text-white hover:bg-white/20 phone:size-11'
  // with a mouse, round arrows on either side page through them
  const sideBtn = 'absolute top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white shadow-[0_0_0_1px_rgb(255_255_255/0.12)] backdrop-blur-sm hover:bg-black/65 pointer-fine:grid'
  const neighbour = (s: Shot | undefined, side: 'left' | 'right') =>
    s ? (
      <div aria-hidden="true" className={clsx('absolute inset-y-0 grid w-full place-items-center', side === 'left' ? 'right-[calc(100%+16px)]' : 'left-[calc(100%+16px)]')}>
        <img src={fileUrl(chatKey, s.file.path)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
      </div>
    ) : null
  return (
    <div role="dialog" aria-modal="true" aria-label={f.name} className="fixed inset-0 z-50 overflow-hidden text-white">
      <div ref={shade} className="absolute inset-0 bg-black" />
      <div
        ref={box}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none]"
      >
        <div ref={strip} className="absolute inset-0 will-change-transform">
          {neighbour(prev, 'left')}
          <div className="absolute inset-0 grid place-items-center">
            {broken ? (
              <p className="px-8 text-center text-white/70">This picture can't be shown here. Download it to open it.</p>
            ) : (
              <img ref={img} src={fileUrl(chatKey, f.path)} alt={f.name} draggable={false} onError={() => setBroken(true)} className="max-h-full max-w-full object-contain will-change-transform" />
            )}
          </div>
          {neighbour(next, 'right')}
        </div>
      </div>
      <div {...own} className="absolute inset-x-0 top-0 flex items-center gap-2 bg-linear-to-b from-black/60 to-transparent px-3 pt-[calc(env(safe-area-inset-top)+10px)] pb-6">
        <div className="min-w-0 flex-1 pl-1">
          <div className="truncate text-[0.8125rem] text-white/80 phone:text-[0.9375rem]">{f.name}</div>
          {shots.length > 1 ? <div className="text-[0.75rem] text-white/55 tabular-nums phone:text-[0.8125rem]">{`${index + 1} of ${shots.length}`}</div> : null}
        </div>
        <a href={fileUrl(chatKey, f.path, true)} download={f.name} aria-label={`Download ${f.name}`} className={barBtn}>
          <DownloadIcon className={ic} />
        </a>
        <button ref={closeBtn} type="button" aria-label="Close" onClick={close} className={barBtn}>
          <XIcon className={ic} />
        </button>
      </div>
      {prev ? (
        <button {...own} type="button" aria-label="Previous picture" onClick={() => page(-1)} className={clsx(sideBtn, 'left-3')}>
          <BackIcon className={ic} />
        </button>
      ) : null}
      {next ? (
        <button {...own} type="button" aria-label="Next picture" onClick={() => page(1)} className={clsx(sideBtn, 'right-3')}>
          <NextIcon className={ic} />
        </button>
      ) : null}
      {msg && has('reactions') && !msg.waiting ? (
        <div {...own} className="absolute inset-x-0 bottom-0 flex justify-center bg-linear-to-t from-black/60 to-transparent px-3 pt-6 pb-[calc(env(safe-area-inset-bottom)+14px)]">
          <div role="group" aria-label="React" className="inline-flex gap-0.5 rounded-full bg-white/12 p-1">
            {quick().map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`React ${e}`}
                aria-pressed={mine(msg, e)}
                onClick={() => react(chatKey, msg.id, e)}
                className="size-10 rounded-full text-[1.125rem] hover:bg-white/15 aria-pressed:bg-white/25 phone:size-11 phone:text-[1.25rem]"
              >
                {e}
              </button>
            ))}
            <button
              type="button"
              aria-label="More emoji"
              onClick={() => openPicker(chatKey, msg.id)}
              className="grid size-10 place-items-center rounded-full bg-white/12 hover:bg-white/20 phone:size-11"
            >
              <PlusIcon className={ic} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SessionLine() {
  return (
    <div className="flex items-center gap-3 text-[0.75rem] font-medium text-fg3 phone:text-[0.8125rem]" role="separator">
      <span className="h-px flex-1 bg-line" />
      New session
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

function DateLine({ at }: { at: number }) {
  return (
    <div className="self-center text-[0.75rem] font-medium text-fg3 phone:text-[0.8125rem]">
      {dayLabel(at)}
    </div>
  )
}

/** where the replies that came in while you read further up begin */
function NewLine() {
  return (
    <div data-new-line className="flex items-center gap-3 text-[0.75rem] font-medium text-accent phone:text-[0.8125rem]">
      <span className="h-px flex-1 bg-[color-mix(in_srgb,var(--accent)_45%,transparent)]" />
      New
      <span className="h-px flex-1 bg-[color-mix(in_srgb,var(--accent)_45%,transparent)]" />
    </div>
  )
}

/** one message (or album, or card) across the chat's width, its time just past the right edge for a slide to show */
function Row({ at, arrive, children }: { at: number; arrive: string; children: ReactNode }) {
  return (
    <div data-arrive={arrive} className="relative flex flex-col gap-3.5">
      {children}
      {at ? (
        <time
          dateTime={new Date(at).toISOString()}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1.5 left-full ml-3 text-[0.75rem] whitespace-nowrap text-fg3 tabular-nums opacity-[var(--peek,0)] phone:ml-4 phone:text-[0.8125rem]"
        >
          {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      ) : null}
    </div>
  )
}

/** a task's row says what its task is doing now, when that moved on from the row's own words */
const NOW: Record<string, string> = { need: 'Needs you', done: 'Done', work: 'Working', ready: 'Ready', merging: 'Merging', queued: 'Queued', todo: 'To do' }

const cardBox = 'relative flex max-w-full items-center gap-2 self-start rounded-box px-3 py-2 text-left text-[0.9375rem] shadow-[inset_0_0_0_1px_var(--line2)]'
/** the card's words on one line: cut short with an ellipsis where the chat is narrow, what follows them kept whole */
const cardLine = 'flex min-w-0 items-baseline whitespace-nowrap'
const cardAside = 'shrink-0 text-[0.8125rem] text-fg2'

/** Shepherdr's update card about a task: one line, a dot, its id and a few words; a tap opens the task, where its
    summary is; held (or the smiley beside it) it reacts, like a message. A mode card marks when the place's
    coordinator went on a mode; a restart card what its agent started again on; a machine's health or a red main says
    what happened. Those open nothing */
function Card({ card: c, chat, at, press, keys, className }: { card: UpdateCard; chat: string; at?: number; press?: ReturnType<typeof useHold>; keys?: object; className?: string }) {
  const snap = useSnap()!
  // a machine's health: what crossed its limit (red) or came back under it
  if (c.health)
    return (
      <div data-anchor data-health-card={c.health.level} {...press} {...keys} className={clsx(cardBox, className)}>
        <MachineIcon className={clsx(ic, 'shrink-0', c.health.level === 'over' ? 'text-need' : 'text-fg2')} />
        <span className={cardLine}>
          <span className="truncate">
            <b className="font-semibold">{c.health.machine}</b> {c.text}
          </span>
        </span>
      </div>
    )
  // the project's main went red on GitHub
  if (c.red)
    return (
      <div data-anchor data-red-card {...press} {...keys} className={clsx(cardBox, className)}>
        <Dot s="need" className="shrink-0" />
        <span className={cardLine}>
          <span className="truncate">
            <b className="font-semibold">{c.red}</b> {c.text}
          </span>
        </span>
      </div>
    )
  // its agent started again: on what
  if (c.restart)
    return (
      <div data-anchor data-restart-card {...press} {...keys} className={clsx(cardBox, className)}>
        <RestartIcon className={clsx(ic, 'shrink-0 text-fg2')} />
        <span className={cardLine}>
          <span className="truncate">{c.text}</span>
        </span>
      </div>
    )
  if (!c.task)
    return (
      <div data-anchor data-mode-card={c.mode} {...press} {...keys} className={clsx(cardBox, className)}>
        <ModeIcon className={clsx(ic, 'shrink-0 text-fg2')} />
        <span className={cardLine}>
          <span className="truncate">
            <b className="font-semibold">{c.mode ? modeName(c.mode) : ''}</b> {c.text}
          </span>
        </span>
      </div>
    )
  const t = taskOf(snap, c.task)
  const task = c.task
  const status = t?.status ?? c.status ?? 'idle'
  const needs = (c.ask?.open || status === 'need') && registry.views.needs
  const pr = c.pr ?? t?.pr
  const line = (
    <button type="button" data-anchor data-needs-link={needs ? '' : undefined} {...press} onClick={() => (needs ? openNeeds() : openTask(task))} className={clsx(cardBox, 'hover:bg-hover', className)}>
      <Dot s={status} className="shrink-0" />
      <span className={cardLine}>
        <span className="truncate">
          <b className="font-semibold">{c.task}</b> {t && t.status !== c.status ? NOW[t.status] ?? t.status : c.text}
        </span>
        {pr ? (
          // set apart like a task row's
          <span className={cardAside}>
            &nbsp;· <PrOnCard pr={pr} />
          </span>
        ) : null}
      </span>
    </button>
  )
  return line
}

/** an agent that waits with no card: its words, and a reply to it that goes to the agent */
export function ReplyOnCard({ ask, reply, task, source }: { ask: CardAsk; reply: { id?: string; text: string }; task: string; source: CardSource }) {
  const [text, setText] = useDraft(`card-reply:${ask.chat}:${reply.id}`)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await act({ type: 'send', chat: ask.chat, text: text.trim(), reply: reply.id })
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else setText('')
    } catch {
      setErr("That didn't go through.")
    } finally {
      setBusy(false)
    }
  }
  const a = ask.answered
  return (
    <CardShell title={`${task} asks`} source={source}>
      <div data-ask-text className="line-clamp-6 break-words whitespace-pre-wrap">{reply.text}</div>
      {a ? (
        <Sent>
          <CheckIcon className={ic} />
          <span className="shrink-0">Answered in</span>
          <LinkButton onClick={() => goChat(ask.chat)}>{`${task} chat`}</LinkButton>
          {a.text ? <span className="min-w-0 truncate text-fg2">“{a.text.replace(/\s+/g, ' ')}”</span> : null}
        </Sent>
      ) : ask.open ? (
        <>
          <TextBox name="reply" data-kept label={`Reply to ${task}`} className={noteBox} placeholder="Type something…" value={text} onChange={setText} />
          <div className="flex items-center justify-end gap-2">
            {err ? <span role="alert" className="mr-auto text-[0.75rem] text-need phone:text-[0.8125rem]">{err}</span> : null}
            <Primary soft disabled={busy || !text.trim()} onClick={send}>
              Send
            </Primary>
          </div>
        </>
      ) : null}
    </CardShell>
  )
}

/** a task's pull request on its card: a link of its own (the card itself opens the task), so it is no <a> inside the
    card's button */
function PrOnCard({ pr, className }: { pr: { number: number; url: string }; className?: string }) {
  const open = (e: { stopPropagation(): void; preventDefault(): void }) => {
    e.stopPropagation()
    e.preventDefault()
    window.open(pr.url, '_blank', 'noopener')
  }
  return (
    <span
      role="link"
      tabIndex={0}
      data-pr={pr.number}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e)}
      onPointerDown={(e) => e.stopPropagation()}
      className={clsx('inline-block font-medium text-focus tabular-nums hover:underline', className)}
    >
      PR #{pr.number}
    </span>
  )
}

/** drawn again only when its chat, what you sent or the New line changes: never as you type */
const Messages = memo(function Messages({ chat, from }: { chat: Chat; from: string }) {
  const outbox = useStore((s) => s.outbox)
  type Item = { at: number; msg: Message; out?: Outgoing; last?: boolean } | { at: number; album: Message[]; out?: Outgoing; last?: boolean }
  const items: Item[] = chat.messages.map((msg) => ({ at: msg.at ?? 0, msg }))
  items.sort((a, b) => a.at - b.at)
  // what you just sent comes last, in one list with the rest: when it comes back it keeps its place in the list, so
  // nothing is drawn again (a picture doesn't load twice)
  for (const out of outbox) {
    if (out.chat !== chat.key) continue
    const parts = partsOf(out, chat)
    parts.forEach((msg, i) => items.push({ at: out.at, msg, out, last: i === parts.length - 1 }))
  }
  // pictures sent together (they share their time) sit side by side, like an album
  const rows: Item[] = []
  for (const it of items) {
    const last = rows.at(-1)
    if (!('msg' in it) || !isPicture(it.msg)) rows.push(it)
    else {
      const m = it.msg
      const prev = last && 'album' in last ? last.album.at(-1)! : null
      if (prev && prev.who === m.who && !m.newSession && !!prev.waiting === !!m.waiting && m.at === prev.at && prev.cid === m.cid) {
        const album = last as Extract<Item, { album: Message[] }>
        album.album.push(m)
        album.last = it.last
      } else rows.push({ at: it.at, album: [m], out: it.out, last: it.last })
    }
  }
  const newAt = useContext(NewAt)
  // a message just sent, or just in, rises into place
  const list = useRef<HTMLDivElement>(null)
  useArrive(list, chat.key)
  let day = ''
  return (
    // a finger sliding a message left moves them all (--peek), and each one's time comes in at the right, like iMessage
    <div ref={list} data-messages className="mx-auto flex w-full max-w-read flex-1 flex-col gap-3.5 px-5 pt-5 pb-3 phone:px-4">
      {!rows.length ? <Empty className="p-0!">No messages yet. Write to start.</Empty> : null}
      {rows.map((it) => {
        const at = it.at > 1e12 ? it.at : 0
        const d = at ? new Date(at).toDateString() : day
        const dated = !!at && d !== day
        day = d
        const first = 'album' in it ? it.album[0].id : it.msg.id
        const key = keyOf('album' in it ? it.album[0] : it.msg)
        return (
          <Fragment key={key}>
            {dated ? <DateLine at={at} /> : null}
            {newAt === first ? <NewLine /> : null}
            <Row at={at} arrive={key}>
              {'album' in it ? (
                <Album msgs={it.album} chat={chat} from={from} out={it.out} last={it.last} />
              ) : (
                <Bubble msg={it.msg} chat={chat} from={from} out={it.out} last={it.last} />
              )}
            </Row>
          </Fragment>
        )
      })}
      {registry.chatTail.map(({ View }, i) => (
        <View key={i} chat={chat} from={from} />
      ))}
    </div>
  )
})

/** while the agent works, the step it is on in one quiet line; three soft dots in the agent's bubble (like iMessage) where
 *  its log says nothing of its turn */
function Typing({ chat, from }: { chat: Chat; from: string }) {
  // the step it is on now, in place of the dots: in a turn it began itself too (news, its background work woke it),
  // so it never looks idle while it works
  if (working(chat)) return <LiveLine chat={chat} />
  if (!typing(chat)) return null
  return (
    <div role="status" className="typing self-start rounded-bubble rounded-bl-[6px] bg-bubble px-3.5 py-2 text-fg3 phone:px-4 phone:py-2.5">
      <span className="sr-only">{`${from} is working`}</span>
      <span aria-hidden className="flex h-lh items-center gap-1">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

/* ---------- question cards: forms, a CLI's own questions, plans ---------- */

/** a question's card: one width whatever its choices (the chat's width on a phone), its title in a header under a
 *  question mark, or a list for a plan. The title wraps onto as many lines as it needs, the mark on its first line */
type CardSource = { id: string; title?: string }

export function CardShell({ title, plan, icon, action, source, children }: { title: string; plan?: boolean; icon?: ComponentType<{ className?: string }>; action?: ReactNode; source?: CardSource; children: ReactNode }) {
  const Icon = icon ?? (plan ? PlanIcon : QuestionIcon)
  return (
    <div data-card className="mt-2 w-[440px] max-w-full cursor-default overflow-hidden rounded-box bg-bg shadow-[inset_0_0_0_1px_var(--line2)]">
      {source ? (
        <div data-card-source className="px-3 pt-2 text-[0.8125rem] break-words text-fg2">
          <span className="font-semibold">{source.id}</span>{source.title ? ` · ${source.title}` : ''}
        </div>
      ) : null}
      <div className="flex items-start gap-2 border-b border-line py-2 pr-2 pl-3 text-[0.9375rem]">
        <Icon className={clsx(ic, 'mt-[3px] text-fg2')} />
        <b data-card-title className="min-w-0 flex-1 font-semibold text-pretty break-words">{title}</b>
        {action}
      </div>
      <div className="flex flex-col gap-2 p-3">{children}</div>
    </div>
  )
}

/** how a card was answered: a pick (or an Other answer) on it, a message in the chat, or the CLI's own terminal */
function answeredHow(q: Question) {
  if (q.via === 'chat') return 'Answered in chat'
  if (q.via === 'terminal') return 'Answered in the terminal'
  return q.sent === -1 && !q.said ? 'Answered' : 'Sent'
}

/** a task's terminal is in its panel, a space's in its chat */
function openTerminal(key: string) {
  if (!key.includes('/')) return setUI({ term: key, arts: null, kb: true })
  goChat(key)
  openItem('terminal')
}

const noteBox = clsx('min-h-10 w-full resize-none rounded-row bg-transparent px-3 py-[9px] placeholder:text-fg3 coarse:min-h-11 phone:min-h-11 phone:text-[1rem]', field)

const CHECKS: Record<MergeEvidence['checks']['state'], string> = { passed: 'text-ready-fg', failed: 'text-need-fg', running: 'text-work-fg', none: 'text-fg2', unknown: 'text-need-fg' }

/** a merge card: what the human approves, and that this card is how */
function Evidence({ e, open }: { e: MergeEvidence; open: boolean }) {
  const label = 'shrink-0 w-14 text-fg2'
  return (
    <div data-evidence className="flex flex-col gap-1 text-[0.875rem] phone:text-[0.9375rem]">
      {e.summary ? <p className="mb-1 text-pretty break-words">{e.summary}</p> : null}
      <div className="flex gap-2"><span className={label}>Commit</span><code className="tabular-nums">{e.commit}</code></div>
      {e.diff ? (
        <details data-evidence-files className="min-w-0">
          <summary className="flex cursor-pointer gap-2"><span className={label}>Files</span><span className="tabular-nums">{e.diff.files} changed, <span className="text-ready-fg">+{e.diff.added}</span> <span className="text-need-fg">−{e.diff.removed}</span></span></summary>
          <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-auto pl-16 text-[0.8125rem]">
            {e.diff.list.map((f) => <li key={f.path} className="flex items-baseline justify-between gap-2"><span className="min-w-0 break-all">{f.path}</span><span className="shrink-0 text-fg2 tabular-nums">+{f.added} −{f.removed}</span></li>)}
            {e.diff.files > e.diff.list.length ? <li className="text-fg2">and {e.diff.files - e.diff.list.length} more</li> : null}
          </ul>
        </details>
      ) : <div className="flex gap-2"><span className={label}>Files</span><span className="text-need-fg">Couldn't read the changes</span></div>}
      <div className="flex gap-2"><span className={label}>Checks</span><span data-evidence-checks={e.checks.state} className={CHECKS[e.checks.state]}>{e.checks.text}</span></div>
      <div className="flex gap-2"><span className={label}>Proof</span>{e.proof ? <LinkButton onClick={() => openArtifact(e.proof!.id)}>{e.proof.title}</LinkButton> : <span className="text-fg2">No proof artifact</span>}</div>
      {open ? <p data-evidence-approve className="mt-1 text-[0.8125rem] text-fg2">Only this card approves the merge: pick Merge, then Send. A yes in the chat doesn't count.</p> : null}
    </div>
  )
}

/** oneTap: in Needs you, a choice sends at once, unless the card asks for several or a note */
export function QuestionCard({ q, chat, msg, from, source, oneTap }: { q: Question; chat: Chat; msg: string; from: string; source?: CardSource; oneTap?: boolean }) {
  // Unmarked cards always require a deliberate pick and Send, including all approval prompts.
  const [sel, setSel] = useState<number[]>([])
  // half-typed notes survive a reload
  const [note, setNote] = useDraft(`card:${chat.key}:${q.id}`)
  const [other, setOther] = useDraft(`card-other:${chat.key}:${q.id}`)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const [composing, setComposing] = useState(false)
  const [err, setErr] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const sent = q.sent !== undefined || !!q.closed
  const by = answeredBy(q, chat, msg)
  // a plan sent back says what to change in the note
  const needNote = q.noteRequiredFor !== undefined && sel[0] === q.noteRequiredFor
  const picked = sel.length > 0 || !!other.trim()
  // Positive opt-in, plus structural exclusions: unknown kinds and older/plugin cards remain confirmed.
  const ordinary = q.ordinary === true && (q.kind === 'Form' || q.kind === 'Question') && !q.multi && !q.terminal && !q.screen && !q.steps && !q.reject && !q.noNote && q.noteRequiredFor === undefined && !q.id.startsWith('menu:')
  const tap = ordinary || oneTap === true && !q.multi && q.noteRequiredFor === undefined
  const immediate = (tap && !composing && !note && !other || q.press === true) && !sent
  const choose = (j: number) => setSel(q.multi ? (sel.includes(j) ? sel.filter((x) => x !== j) : [...sel, j]) : [j])
  const send = async (reject = false, choice = sel[0] ?? -1) => {
    if (sent || sending.current) return
    // sending a plan back needs a note: the box says so and takes the focus
    if (needNote && !note.trim()) return noteRef.current?.focus()
    sending.current = true
    setBusy(true)
    setErr('')
    let accepted = false
    try {
      const r = await act({ type: 'answer', chat: chat.key, question: q.id, choice: reject ? -1 : choice, choices: q.multi ? (reject ? [] : sel) : undefined, note: note.trim() || undefined, other: other.trim() || undefined })
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else {
        accepted = true
        setNote('')
        setOther('')
      }
    } catch (e) {
      setErr(reasonOf(e))
    } finally {
      // Keep a successful answer locked until the server's answered snapshot arrives.
      if (!accepted) {
        sending.current = false
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    if (composing) noteRef.current?.focus()
  }, [composing])
  return (
    <CardShell title={q.title} plan={q.kind === 'Plan'} source={source}>
      {q.screen ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-fg2">{q.press ? q.screen.split(/(https?:\/\/\S+)/).map((part, j) => j % 2 ? <a key={j} href={part} target="_blank" rel="noreferrer" className="text-accent">{part}</a> : part) : q.screen}</pre> : null}
      {q.terminal && !sent && has('terminal') ? <button type="button" className="text-left text-accent" onClick={() => openTerminal(chat.key)}>Open terminal</button> : null}
      {q.evidence ? <Evidence e={q.evidence} open={!sent} /> : null}
      {q.plan ? <div data-plan className="max-h-96 overflow-auto"><Markdown text={q.plan} /></div> : null}
      {q.steps ? (
        <ol className="flex list-decimal flex-col gap-0.5 pl-5">
          {q.steps.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      ) : null}
      {immediate && !q.press ? <p className="text-[0.8125rem] text-fg2">Choose an answer to send it now.</p> : null}
      {q.choices.map((c, j) => {
        const on = sent ? q.sent === j : sel.includes(j)
        const word = immediate && !q.press ? `Send: ${c.label}` : c.label
        return (
          <button
            key={j}
            type="button"
            aria-pressed={immediate ? undefined : on}
            disabled={sent || busy}
            onClick={() => {
              if (immediate) {
                setSel([j])
                void send(false, j)
              } else choose(j)
            }}
            className="group press relative flex min-h-10 w-full items-center gap-2.5 rounded-row px-3 py-2 text-left shadow-[inset_0_0_0_1px_var(--line2)] enabled:hover:bg-hover disabled:cursor-default disabled:opacity-40 aria-pressed:shadow-[inset_0_0_0_1.5px_var(--fg)] disabled:aria-pressed:opacity-100 coarse:min-h-11 phone:min-h-12"
          >
            {immediate ? null : <span
              aria-hidden="true"
              className={clsx(
                'size-4 shrink-0 shadow-[inset_0_0_0_1.5px_var(--fg3)] group-aria-pressed:shadow-[inset_0_0_0_5px_var(--fg)]',
                q.multi ? 'rounded-[4px]' : 'rounded-full',
              )}
            />}
            {c.description ? (
              <span>
                <span className="block">{word}</span>
                <span className="block whitespace-pre-line text-[0.75rem]/[18px] text-fg2 phone:text-[0.8125rem]/5">{c.description}</span>
              </span>
            ) : (
              word
            )}
          </button>
        )
      })}
      {q.other && !sent ? (
        <input
          name="other"
          disabled={busy}
          data-kept
          aria-label="Other answer"
          className={noteBox}
          placeholder="Other: type your own answer…"
          value={other}
          onChange={(e) => {
            setOther(e.target.value)
            // a typed answer replaces the choices
            if (e.target.value.trim()) setSel([])
          }}
        />
      ) : null}
      {sent ? (
        <Sent className={q.closed ? 'text-fg2!' : undefined}>
          {q.closed ? <XIcon className={ic} /> : <CheckIcon className={ic} />}
          <span className="shrink-0">{q.closed ? 'Closed' : q.elsewhere?.label ?? answeredHow(q)}</span>
          {/* answered on its other copy: a link to that chat */}
          {q.elsewhere && !q.closed ? <LinkButton onClick={() => goChat(q.elsewhere!.chat)}>{q.elsewhere.name}</LinkButton> : null}
          {/* the words it was answered with, on one line (a message in the chat shows as its quote, below) */}
          {q.closed ? <span className="min-w-0 text-pretty text-fg2">{q.closed}</span> : q.said && q.via !== 'chat' ? <span className="min-w-0 truncate text-fg2">“{q.said.replace(/\s+/g, ' ')}”</span> : null}
        </Sent>
      ) : null}
      {/* the message that answered it, as a reply's quote: a tap jumps to it */}
      {by ? <Quote q={by} chat={chat.key} from={from} you={false} loose label="Answered by" /> : null}
      {sent || (q.terminal && !q.choices.length) ? null : (
        <>
          {immediate && !q.noNote ? (
            <button type="button" disabled={busy} className="min-h-11 text-left text-accent" onClick={() => setComposing(true)}>Add a note</button>
          ) : null}
          {(!q.other || tap) && !q.noNote && !immediate ? (
            <TextBox
              ref={noteRef}
              name="note"
              disabled={busy}
              data-kept
              label="Note"
              className={noteBox}
              placeholder={needNote ? 'Your note for the agent (needed to send it back)' : 'Add a note (optional)'}
              value={note}
              onChange={setNote}
            />
          ) : null}
          {/* in Needs you, its room is kept: Sending… must not push the cards below under a thumb */}
          <div className={clsx('flex items-center justify-end gap-2', oneTap && 'min-h-6')}>
            {err ? <span role="alert" className="mr-auto text-[0.75rem] text-need phone:text-[0.8125rem]">{err}</span> : null}
            {q.reject ? <button type="button" disabled={busy} onClick={() => send(true)}>{q.reject}</button> : null}
            {!immediate ? <Primary soft disabled={busy || !picked} onClick={() => send()}>
              Send
            </Primary> : null}
            {busy ? <span role="status" className="text-[0.8125rem] text-fg2">Sending…</span> : null}
          </div>
        </>
      )}
    </CardShell>
  )
}

/* ---------- a secret an agent asked for ---------- */

/** a masked box for a secret an agent asked for by name, and where it is kept (its space, its machine, Everywhere).
 *  The value goes once to the main machine and is never kept here, as a draft or otherwise; the agent is told it is
 *  there, by name only */
export function SecretCard({ ask, chat, source }: { ask: SecretAsk; chat: Chat; source?: CardSource }) {
  const [value, setValue] = useState('')
  const [level, setLevel] = useState(ask.levels[0]?.id ?? 'all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!value || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = (await act({ type: 'secret', level, name: ask.name, value, card: { chat: chat.key, id: ask.id } })) as { ok?: boolean; error?: string }
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else setValue('')
    } catch {
      setErr("That didn't go through: Shepherdr can't be reached.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <CardShell title={`Secret: ${ask.name}`} icon={KeyIcon} source={source}>
      {ask.why ? <p className="text-pretty break-words">{ask.why}</p> : null}
      {ask.saved ? (
        <Sent>
          <CheckIcon className={ic} />
          <span className="min-w-0 truncate">Saved for {ask.saved}</span>
        </Sent>
      ) : (
        <>
          <SecretField label={ask.name} value={value} onChange={setValue} onEnter={save} />
          {ask.levels.length > 1 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">For</span>
              <Tabs label="Where it is kept">
                {ask.levels.map((l) => (
                  <Tab key={l.id} on={l.id === level} onClick={() => setLevel(l.id)}>
                    {l.label}
                  </Tab>
                ))}
              </Tabs>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <span role="status" className={clsx('mr-auto text-[0.75rem] text-pretty phone:text-[0.8125rem]', err ? 'text-need' : 'text-fg3')}>
              {err || 'Agents use it by name, never seeing it.'}
            </span>
            <Primary soft disabled={busy || !value} onClick={save}>
              Save
            </Primary>
          </div>
        </>
      )}
    </CardShell>
  )
}

/* ---------- sending: it shows at once, and settles once it is in ---------- */

async function deliver(o: Outgoing) {
  const patch = (p: (x: Outgoing) => Partial<Outgoing>) => setOutbox((all) => all.map((x) => (x.cid === o.cid ? { ...x, ...p(x) } : x)))
  // a reload now would cut it off on its way
  const release = holdReload()
  try {
    const r = (await act({ type: 'send', chat: o.chat, text: o.text, attachments: o.files.map((f) => f.path), cid: o.cid, reply: o.reply?.id }, AbortSignal.timeout(SEND_TIMEOUT))) as {
      waiting?: boolean
      waitsFor?: Outgoing['waitsFor']
      at?: number
    }
    // the chat may already show it waiting (queued) or gone in: that knows better than the answer
    const serverAt = typeof r?.at === 'number' ? r.at : undefined
    patch((x) => ({ state: 'sent', error: undefined, serverAt, ...(x.queued || x.wentAt ? {} : { waiting: r?.waiting || undefined, waitsFor: (r?.waiting && r.waitsFor) || undefined }) }))
  } catch (e) {
    patch((x) => (x.state === 'sending' ? { state: 'failed', error: reasonOf(e) } : {}))
  } finally {
    release()
  }
}

/** an id of the screen's own (randomUUID needs https, and a tailnet link may be plain http) */
const newCid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** send again what didn't go through; it moves down to the end, like a new message. One that went in but never showed
 *  goes as a new message (its old id is spent: the server would take it as sent already). */
function retry(cid: string) {
  const s = getState()
  const o = s.outbox.find((x) => x.cid === cid)
  if (!o) return
  const again: Outgoing = { ...o, cid: o.lost ? newCid() : o.cid, state: 'sending', error: undefined, lost: undefined, waiting: undefined, waitsFor: undefined, queued: undefined, serverAt: undefined, wentAt: undefined, busyAt: undefined, at: Date.now(), prior: priorOf(s.chats[o.chat]) }
  setOutbox((all) => all.map((x) => (x.cid === cid ? again : x)))
  deliver(again)
}

/* ---------- composer ---------- */

export function useChat(key: string) {
  return useStore((s) => s.chats[key])
}

function Composer({ chatKey, placeholder, cli }: { chatKey: string; placeholder: string; cli: string }) {
  const [text, setText] = useDraft(chatKey)
  const files = useUI((u) => u.files[chatKey]) ?? noFiles
  const device = useUI((u) => u.device)
  const focused = useUI((u) => u.focus === chatKey)
  const keyboard = useUI((u) => u.keyboard)
  const plus = useUI((u) => u.plus === chatKey)
  const ref = useRef<HTMLTextAreaElement>(null)
  const live = useUI((u) => registry.composerLive.find((l) => l.when(u, chatKey)))
  const Idle = registry.composerIdle
  const Mic = registry.composerMic
  useEffect(() => {
    if (focused && device === 'desktop') ref.current?.focus()
  }, [focused, device])
  // a narrower box wraps the words too; a shorter one (a phone's keyboard coming up) keeps where you type in view
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      if (document.activeElement === el) reveal(el)
      fades(el)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [!!live])
  // its max height follows the screen's (a phone's keyboard coming or going): it fits it again at once, once the app
  // has taken the new height (viewport.ts)
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    const on = () => requestAnimationFrame(() => setRoom(vv?.height ?? innerHeight))
    vv?.addEventListener('resize', on)
    addEventListener('resize', on)
    return () => {
      vv?.removeEventListener('resize', on)
      removeEventListener('resize', on)
    }
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // the words grow the box upward, between buttons that stay put, up to its max height (CSS), then scroll inside.
    // Measuring at auto height loses where it was scrolled to: it scrolls back, then the line you type comes into full
    // view, padding and all (the browser alone stops short, under the fade)
    const top = el.scrollTop
    // measured at auto height, which is one line: what holds it keeps its height meanwhile, or the chat above would
    // grow for a moment, pull its newest message up out of view and let go of the bottom
    const hold = el.parentElement!
    hold.style.height = `${hold.offsetHeight}px`
    el.style.height = 'auto'
    // once it scrolls, it holds whole lines between its paddings, so at the end the line above shows only in the top
    // padding, where it fades: no line looks cut, and none under the fades is one you can read
    const cs = getComputedStyle(el)
    const [max, lh, pads] = [parseFloat(cs.maxHeight), parseFloat(cs.lineHeight), parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)]
    el.style.height = `${el.scrollHeight > max && lh ? pads + Math.floor((max - pads) / lh) * lh : el.scrollHeight}px`
    hold.style.height = ''
    el.scrollTop = top
    if (document.activeElement === el) reveal(el)
    fades(el)
    // and again when the box comes back after talking to type or a call: it is a new textarea then
  }, [text, width, room, !!live])
  const send = () => {
    const t = text.trim()
    if (!t && !files.length) return
    const reply = getState().ui.reply[chatKey]
    const model = reply ? undefined : modelCommand(t)
    if (model !== undefined) {
      setText('')
      const place = getState().snap?.places.find((p) => p.chat === chatKey)
      openRestart(chatKey, place?.name ?? taskChatId(chatKey) ?? chatKey, true, model)
      return
    }
    setText('')
    setUI((u) => {
      const { [chatKey]: _, ...replies } = u.reply
      // the + menu goes too (on a desktop Enter can send with it open)
      return { files: { ...u.files, [chatKey]: [] }, reply: replies, plus: u.plus === chatKey ? null : u.plus }
    })
    const out: Outgoing = {
      cid: newCid(),
      chat: chatKey,
      text: t,
      files: files.map((f) => ({ name: f.name, path: f.path ?? f.name })),
      reply,
      at: Date.now(),
      state: 'sending',
      prior: priorOf(getState().chats[chatKey]),
    }
    setOutbox((all) => [...all, out])
    deliver(out)
  }
  return (
    // what goes with the box (send, +, a file's x, its menu) leaves the box the focus: a phone's keyboard stays up
    <div data-kb data-keep-box className={clsx('mx-auto w-full max-w-read shrink-0 px-4 pt-2', keyboard && device === 'phone' ? 'pb-1' : 'pb-2.5')}>
      {registry.composerAbove.map(({ View }, i) => (
        <View key={i} chatKey={chatKey} cli={cli} />
      ))}
      {/* a pill: the corners are half its one-line height, so one line has round ends; taller, the buttons keep their
          size and spot in the bottom corners, with the same curve around them (like iMessage) */}
      <div data-composer className="round-box bg-bg p-1.5 shadow-box has-[textarea:focus]:shadow-box-focus">
        {/* what it replies to: one quiet line inside the box, over the words (like WhatsApp and Telegram) */}
        <ReplyStrip chatKey={chatKey} />
        <div data-btns className={live ? 'flex items-center gap-1' : 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-1'}>
          {live ? (
            <live.View chatKey={chatKey} />
          ) : (
            <>
              {registry.composerPlus ? (
                <IconButton
                  label="Attach files and more"
                  className={roundBtn}
                  pressed={plus}
                  onClick={() => setUI({ plus: plus ? null : chatKey })}
                >
                  <PlusIcon className={ic} />
                </IconButton>
              ) : null}
              <div className="relative col-start-2 flex min-w-0 self-stretch">
                <textarea
                  ref={ref}
                  name="message"
                  data-chat={chatKey}
                  data-kept
                  data-quiet
                  aria-label={placeholder}
                  rows={1}
                  value={text}
                  placeholder=""
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => {
                    // a screenshot or a copied file attaches, as + does; text pastes as text
                    const list = pasted(e.clipboardData)
                    if (!list.length) return
                    e.preventDefault()
                    attach(chatKey, list)
                  }}
                  onScroll={(e) => fades(e.currentTarget)}
                  // the caret moved (an arrow key, a tap, a letter typed, after which a phone scrolls to the caret
                  // itself, short of the padding): its line comes into full view
                  onSelect={(e) => {
                    reveal(e.currentTarget)
                    fades(e.currentTarget)
                  }}
                  onFocus={() => setUI({ focus: chatKey })}
                  onBlur={() => getState().ui.focus === chatKey && setUI({ focus: null })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && device === 'desktop' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      send()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      // a reply is dropped first, then the box lets go
                      if (getState().ui.reply[chatKey]) return cancelReply(chatKey)
                      ref.current?.blur()
                      setUI({ focus: null })
                    }
                  }}
                  className={clsx(
                    // at most 8 lines (less with a phone's keyboard up): past that it scrolls inside, an edge with more
                    // words past it fading out over its padding, so no line looks cut and every whole line stays crisp
                    // (the one you type too), the scrollbar only while it moves
                    'max-h-[min(calc(8lh+0.875rem),calc(var(--app-h,100dvh)*0.32))] min-h-[34px] w-full flex-1 resize-none self-center overflow-y-auto overscroll-y-contain bg-transparent py-[7px] pl-1.5 text-fg outline-none phone:max-h-[min(calc(8lh+1.25rem),calc(var(--app-h,100dvh)*0.32))] phone:min-h-11 phone:py-2.5',
                    '[--fade-down:0px] [--fade-up:0px] [mask-image:linear-gradient(transparent,#000_var(--fade-up),#000_calc(100%-var(--fade-down)),transparent)] data-more-down:[--fade-down:7px] data-more-up:[--fade-up:7px] phone:data-more-down:[--fade-down:10px] phone:data-more-up:[--fade-up:10px]',
                    !registry.composerPlus && 'pl-3',
                    text ? 'whitespace-pre-wrap' : 'whitespace-nowrap',
                  )}
                />
                {!text ? (
                  <span
                    aria-hidden="true"
                    className={clsx('pointer-events-none absolute inset-y-0 right-0 flex items-center text-fg3', registry.composerPlus ? 'left-1.5' : 'left-3')}
                  >
                    <span className="truncate">{placeholder}</span>
                  </span>
                ) : null}
              </div>
              <div data-btns className="col-start-3 flex items-center gap-1">
                {Mic ? <Mic chatKey={chatKey} /> : null}
                {text.trim() || files.length || !Idle ? (
                  <button
                    type="button"
                    aria-label="Send"
                    onClick={() => {
                      // a light tap from the phone as it goes, like ChatGPT's
                      if (matchMedia('(pointer: coarse)').matches) buzz()
                      send()
                    }}
                    className="press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-fg text-bg after:absolute after:-inset-1.5 phone:size-11"
                  >
                    <UpIcon className={ic} />
                  </button>
                ) : (
                  <Idle chatKey={chatKey} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <AgentLine chatKey={chatKey} cli={cli} />
    </div>
  )
}

const noFiles: { name: string; path?: string }[] = []

/** mark which ends of the message box have more words past them, for its fades */
function fades(el: HTMLElement) {
  // only words past the padding count: a box a few px short of its end (a phone showing the caret) has none below
  const cs = getComputedStyle(el)
  el.toggleAttribute('data-more-up', el.scrollTop > parseFloat(cs.paddingTop) + 1)
  el.toggleAttribute('data-more-down', el.scrollTop + el.clientHeight < el.scrollHeight - parseFloat(cs.paddingBottom) - 1)
}

/** the line with the caret in full view in the message box, with the padding round it, so no fade is on it */
function reveal(el: HTMLTextAreaElement) {
  if (el.scrollHeight <= el.clientHeight || el.selectionStart !== el.selectionEnd) return
  const cs = getComputedStyle(el)
  const [pt, pb, pl, pr, lh] = [cs.paddingTop, cs.paddingBottom, cs.paddingLeft, cs.paddingRight, cs.lineHeight].map(parseFloat)
  if (!lh) return
  // which line the caret is on: the words up to it, wrapped as the box wraps them, in a copy nobody sees
  const copy = document.createElement('div')
  const props = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing', 'lineHeight', 'tabSize', 'textIndent', 'textTransform', 'whiteSpace', 'overflowWrap', 'wordBreak'] as const
  for (const k of props) copy.style[k] = cs[k]
  Object.assign(copy.style, { position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden', width: `${el.clientWidth - pl - pr}px` })
  copy.textContent = el.value.slice(0, el.selectionEnd)
  const caret = copy.appendChild(document.createElement('span'))
  caret.textContent = '\u200b'
  document.body.appendChild(copy)
  const line = Math.floor(caret.offsetTop / lh)
  copy.remove()
  const top = line * lh
  const bottom = pt + (line + 1) * lh + pb
  if (top < el.scrollTop) el.scrollTop = top
  else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
}

/** in the message box while it replies, over the words: "Replying to" whom and the start of it on one line, with a
    small x to drop it; a tap on the line shows the message. It starts in line with the + under it, the x over send */
function ReplyStrip({ chatKey }: { chatKey: string }) {
  const q = useUI((u) => u.reply[chatKey])
  const snap = useSnap()
  if (!q) return null
  const name = q.who === 'you' ? 'You' : snap ? chatName(snap, chatKey) : 'Agent'
  return (
    <div data-reply-strip className="flex h-7 items-center gap-2 pr-0.75 pl-2.25 text-[0.8125rem] phone:h-8 phone:pr-2 phone:pl-3.5 phone:text-[0.875rem]">
      <div {...jumps(chatKey, q, `Replying to ${name}`)} className="min-w-0 flex-1 cursor-pointer truncate text-fg2">
        {/* a long name gives way, so some of the words always show */}
        Replying to <span className="inline-block max-w-[45%] truncate align-top font-medium text-fg">{name}</span>{' '}
        {q.file ? <FileIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.artifact ? <PageIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.text}
      </div>
      {/* taking the reply away keeps the keyboard up */}
      <button
        type="button"
        aria-label="Cancel reply"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => cancelReply(chatKey)}
        className="hit grid size-7 shrink-0 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg2"
      >
        <XIcon className={ic} />
      </button>
    </div>
  )
}

/** files waiting in the message box, in a row that scrolls sideways: a picture as a thumbnail you can open full
 *  screen, anything else as a small tile, each with a round x to take it out */
function Attachments({ chatKey }: { chatKey: string }) {
  const files = useUI((u) => u.files[chatKey]) ?? noFiles
  const row = useRef<HTMLDivElement>(null)
  const count = useRef(files.length)
  // a file just added scrolls into view at the end of the row
  useLayoutEffect(() => {
    const el = row.current
    if (el && files.length > count.current) el.scrollLeft = el.scrollWidth
    count.current = files.length
  }, [files.length])
  useEffect(() => {
    // a mouse wheel scrolls the row sideways, since it has no scrollbar to grab
    const el = row.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [files.length > 0])
  if (!files.length) return null
  const remove = (f: (typeof files)[number]) => setUI((u) => ({ files: { ...u.files, [chatKey]: (u.files[chatKey] ?? []).filter((x) => x !== f) } }))
  return (
    <div
      ref={row}
      role="list"
      aria-label="Attached files"
      className="-mx-4 mb-2 flex gap-2 overflow-x-auto overscroll-x-contain px-4 motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {files.map((f, i) => (
        <Pending key={`${f.path ?? f.name}-${i}`} f={f} chatKey={chatKey} onRemove={() => remove(f)} />
      ))}
    </div>
  )
}

function Pending({ f, chatKey, onRemove }: { f: { name: string; path?: string }; chatKey: string; onRemove: () => void }) {
  const [broken, setBroken] = useState(false)
  const path = f.path
  const picture = !!path && isImage(f.name) && !broken
  const ext = extOf(f.name)
  return (
    <div role="listitem" className="relative h-16 shrink-0 phone:h-[72px]">
      {picture ? (
        <button
          type="button"
          aria-label={`Open ${f.name}`}
          onClick={() => {
            // full screen, the keyboard goes down (the box keeps it for its other buttons)
            blurBox()
            setUI({ photo: { chat: chatKey, file: { name: f.name, path } } })
          }}
          className="relative block size-16 overflow-hidden rounded-box bg-bubble after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--line)] phone:size-[72px]"
        >
          <img src={fileUrl(chatKey, path)} alt={f.name} draggable={false} onError={() => setBroken(true)} className="size-full object-cover" />
        </button>
      ) : (
        <div title={f.name} className="flex h-full w-[184px] items-center gap-2.5 rounded-box bg-bubble pr-8 pl-2.5 phone:w-[200px]">
          <span className="grid size-10 shrink-0 place-items-center rounded-[calc(var(--box-radius)-var(--spacing)*2.5)] bg-bg text-fg2">
            <FileIcon className={ic} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[0.8125rem] phone:text-[0.9375rem]">{f.name}</span>
            <span className="block text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{ext ? `${ext.toUpperCase()} file` : 'File'}</span>
          </span>
        </div>
      )}
      {/* dark and ringed, so it shows on any picture in light and dark; taking a file out keeps the keyboard up */}
      <button
        type="button"
        aria-label={`Remove ${f.name}`}
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="absolute top-1 right-1 grid size-[22px] place-items-center rounded-full bg-black/60 after:absolute after:-inset-1 after:rounded-full text-white shadow-[0_0_0_1.5px_rgb(255_255_255/0.85)] backdrop-blur-sm hover:bg-black/75"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

/** files from +, a paste or a drop: each uploads to the agent's machine and waits in the message box until it is sent */
async function attach(chatKey: string, list: File[]) {
  if (!list.length) return
  const release = holdReload()
  let added: { name: string; path?: string }[]
  try {
    added = await Promise.all(
      list.map(async (f) => {
        const body = new FormData()
        body.append('chat', chatKey)
        body.append('file', f)
        const r = await fetch('api/upload', { method: 'POST', body, headers: { 'x-shepherdr': '1' } }).then((x) => x.json()).catch(() => null)
        return { name: f.name, path: r?.path as string | undefined }
      }),
    )
  } finally {
    release()
  }
  setUI((u) => ({ plus: null, files: { ...u.files, [chatKey]: [...(u.files[chatKey] ?? []), ...added] } }))
}

/** the + menu, and the device's file pickers it opens: they stay once the menu has closed, to hear what was picked */
function PlusMenu({ chatKey }: { chatKey: string }) {
  const open = useUI((u) => u.plus === chatKey)
  const file = useRef<HTMLInputElement>(null)
  const photo = useRef<HTMLInputElement>(null)
  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    attach(chatKey, Array.from(e.target.files ?? []))
    e.target.value = ''
  }
  return (
    <>
      <input ref={file} type="file" name="file" data-chat={chatKey} multiple hidden onChange={upload} />
      <input ref={photo} type="file" name="photo" accept="image/*" capture="environment" hidden onChange={upload} />
      {open ? <PlusOpen chatKey={chatKey} file={file} photo={photo} /> : null}
    </>
  )
}

/** The + menu: attachments close it; plugin settings can stay open. Launch controls open the restart sheet. */
function PlusOpen({ chatKey, file, photo }: { chatKey: string; file: RefObject<HTMLInputElement | null>; photo: RefObject<HTMLInputElement | null> }) {
  const phone = useUI((u) => u.device === 'phone')
  const snap = useSnap()
  const close = () => setUI({ plus: null })
  const screenshot = async () => {
    close()
    if (phone) return photo.current?.click()
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const track = stream.getVideoTracks()[0]
      const video = document.createElement('video')
      video.srcObject = stream
      await video.play()
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')!.drawImage(video, 0, 0)
      track.stop()
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) return
      attach(chatKey, [named(new File([blob], '', { type: 'image/png' }), new Date())])
    } catch {
      /* cancelled */
    }
  }
  const cli = useChat(chatKey)?.cli ?? 'Agent'
  const settings = snap ? registry.composerSettings.filter((x) => x.when(snap, chatKey)) : []
  return (
    <Menu label="Attach files and more" tabs onClose={close} className="mb-2 w-fit max-w-full origin-bottom-left">
      <MenuItem
        icon={<FileIcon className={ic} />}
        onClick={() => {
          close()
          file.current?.click()
        }}
      >
        File or photo
      </MenuItem>
      <MenuItem icon={<CameraIcon className={ic} />} onClick={screenshot}>
        {phone ? 'Take a photo' : 'Screenshot'}
      </MenuItem>
      <MenuSeparator />
      <AgentControls chatKey={chatKey} cli={cli} />
      {settings.map(({ View }, i) => (
        <View key={i} chatKey={chatKey} />
      ))}
    </Menu>
  )
}

/** Talk to type: the box records what you say, then it lands in the box to edit */
let dictation: Dictation | null = null

export function toggleDictation(chatKey: string) {
  const ui = getState().ui
  if (ui.dict === chatKey) return finishDictation()
  // a call has the microphone and the box: talk to type waits until it ends
  if (ui.call) return
  if (ui.dict) cancelDictation()
  // the words go where you were typing (in place of what you had selected), or else at the end
  const box = boxOf(chatKey)
  const at = box && document.activeElement === box ? [box.selectionStart, box.selectionEnd] : null
  // the box records instead of taking typing, so the keyboard goes down
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  setUI({ dict: chatKey, dictStarted: Date.now(), dictDone: false, focus: null, plus: null })
  dictation = dictate((said) => {
    dictation = null
    if (getState().ui.dict !== chatKey) return
    const now = getDraft(chatKey) ?? ''
    const [from, to] = at && at[1] <= now.length ? at : [now.length, now.length]
    const before = now.slice(0, from)
    const after = now.slice(to)
    let caret = to
    if (said) {
      const words = (before && !/\s$/.test(before) ? ' ' : '') + said
      setDraft(chatKey, before + words + (after && !/^\s/.test(after) ? ' ' : '') + after)
      caret = before.length + words.length
    }
    setUI({ dict: null, dictDone: false })
    // the box comes back as a new textarea: the cursor goes into it right after the words, its line in view
    let tries = 10
    const back = () => {
      const el = boxOf(chatKey)
      if (!el) return --tries && requestAnimationFrame(back)
      el.focus()
      el.setSelectionRange(caret, caret)
    }
    requestAnimationFrame(back)
  })
}

function boxOf(chatKey: string) {
  return document.querySelector<HTMLTextAreaElement>(`textarea[data-chat="${CSS.escape(chatKey)}"]`)
}

export function finishDictation() {
  setUI({ dictDone: true })
  dictation?.finish()
}

export function cancelDictation() {
  const d = dictation
  dictation = null
  setUI({ dict: null, dictDone: false })
  d?.cancel()
}

function Mic({ chatKey }: { chatKey: string }) {
  const on = useUI((u) => u.dict === chatKey)
  if (!canDictate()) return null
  return (
    <IconButton label="Talk to type" className={roundBtn} pressed={on} onClick={() => toggleDictation(chatKey)}>
      <MicIcon className={ic} />
    </IconButton>
  )
}

/** While you talk to type the box records: Cancel, a red dot and the time, the live wave of your voice, Done */
export function DictationBox() {
  const ui = useUI()
  const t = useElapsed(ui.dictStarted)
  return (
    <>
      <IconButton label="Cancel" className={roundBtn} onClick={cancelDictation}>
        <XIcon className={ic} />
      </IconButton>
      <p className="flex shrink-0 items-center gap-2 pr-1 pl-2 text-[0.8125rem] text-fg2 tabular-nums phone:text-[0.9375rem]">
        <span aria-hidden="true" className="size-2 rounded-full bg-need motion-safe:animate-pulse" />
        <span role="status" className="sr-only">
          {ui.dictDone ? 'Putting it in the box' : 'Recording'}
        </span>
        {t}
      </p>
      <LiveWave sample={dictSample} label="Your voice" className="mr-1.5 flex-1" />
      <button
        type="button"
        aria-label="Done: put it in the box"
        disabled={ui.dictDone}
        onClick={() => finishDictation()}
        className={clsx('press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-fg text-bg after:absolute after:-inset-1.5 phone:size-11', dimmed)}
      >
        <CheckIcon className={ic} />
      </button>
    </>
  )
}

/** the first of the agent's messages that came in while you read further up: the New line goes before it */
const NewAt = createContext<string | null>(null)

/** how far up (px) counts as reading back: the chat stops following new replies, and the jump to the latest shows */
const AWAY = 80
/** how long a jump to a message may glide (a slow phone takes its time) */
const JUMP_GLIDE = 2000

/** how far (px) a finger moves before its way is known: sideways (a reply, the drawer) or up and down (a scroll) */
const SLOP = 24

/** the message box has the focus (a phone's keyboard is up for it) */
const boxFocused = () => !!document.activeElement?.matches('textarea[name=message]')

function blurBox() {
  if (boxFocused()) (document.activeElement as HTMLElement).blur()
}

/** a tap on what goes with the message box (inside data-keep-box: send, +, a file's x, a reaction) leaves the box the
 *  focus, so a phone's keyboard stays up, as in iMessage and Slack; a text field there still takes it */
function keepBox(e: Event) {
  const t = e.target as HTMLElement
  if (boxFocused() && t.closest?.('[data-keep-box]') && !t.closest('input, textarea, select, [contenteditable=true]')) e.preventDefault()
}

/** a chat opens at its newest message and follows new ones (pages growing too) while you are at the bottom. Scrolled
    up, a round arrow jumps back down, counting the replies that came in meanwhile, and a New line marks where they
    begin (like WhatsApp and Slack); what you send clears it. */
/** how far up from the newest message a chat was read, kept across a reload for a new build (the tab's own storage) */
function scrollKeep(chatKey: string, left: number) {
  try {
    sessionStorage.setItem(`shepherdr.scroll.${chatKey}`, String(Math.round(left)))
  } catch {
    /* private window: it opens at the newest message */
  }
}

function scrollKept(chatKey: string): number | null {
  try {
    const v = sessionStorage.getItem(`shepherdr.scroll.${chatKey}`)
    sessionStorage.removeItem(`shepherdr.scroll.${chatKey}`)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function StickToBottom({ chatKey, children }: { chatKey: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  /** until when a jump to a message (a quote's, an alert's link) is still gliding to it */
  const jumping = useRef(0)
  const [away, setAway] = useState(false)
  const [newAt, setNewAt] = useState<string | null>(null)
  // the agent's messages, and how many of them you had seen at the bottom
  const replies = useStore((s) => (s.chats[chatKey]?.messages ?? []).filter((m) => m.who === 'agent' && !m.waiting).map((m) => m.id).join('\n'))
  const ids = replies ? replies.split('\n') : []
  /** the replies you had in view at the bottom: the others came in while you read further up */
  const read = useRef<Set<string> | null>(null)
  read.current ??= new Set(ids)
  const unseen = ids.filter((id) => !read.current!.has(id))
  /** you read to the bottom since the line was drawn: new ones later start a new line */
  const caughtUp = useRef(false)
  useEffect(() => {
    if (!away) {
      for (const id of ids) read.current!.add(id)
      caughtUp.current = true
    } else if (unseen.length && (!newAt || caughtUp.current)) {
      setNewAt(unseen[0])
      caughtUp.current = false
    }
  }, [replies, away])
  const unread = away ? unseen.length : 0
  // what you send scrolls the chat down to it, wherever you were
  const sentAt = useStore((s) => s.outbox.reduce((n, o) => (o.chat === chatKey ? Math.max(n, o.at) : n), 0))
  const seen = useRef(sentAt)
  useLayoutEffect(() => {
    if (sentAt <= seen.current) return
    seen.current = sentAt
    pinned.current = true
    setNewAt(null)
    box.current!.scrollTop = box.current!.scrollHeight
  }, [sentAt])
  useLayoutEffect(() => {
    const el = box.current!
    el.scrollTop = el.scrollHeight
    // read further up when the screen reloaded for a new build: back where you were, as far from the newest message
    // (held there while the chat draws in, its newest messages last)
    let back = scrollKept(chatKey)
    const placeBack = () => {
      if (back === null || el.scrollHeight - el.clientHeight < back) return
      pinned.current = false
      el.scrollTop = el.scrollHeight - el.clientHeight - back
      lastTop.current = el.scrollTop
      setAway(true)
    }
    placeBack()
    const settled = back === null ? undefined : setTimeout(() => (back = null), 1500)
    const keepScroll = () => {
      if (!pinned.current) scrollKeep(chatKey, el.scrollHeight - el.scrollTop - el.clientHeight)
    }
    addEventListener('shepherdr:reloading', keepScroll)
    // read further up, the chat keeps its bottom edge where it was as the box gets shorter or taller (the message box
    // growing as you type, the keyboard): what was just above the message box stays just above it, as in iMessage
    let height = el.clientHeight
    const keep = () => {
      if (back !== null) return placeBack()
      if (pinned.current) el.scrollTop = el.scrollHeight
      // (not while a jump glides up: setting it stops the glide)
      else if (performance.now() > jumping.current) el.scrollTop += height - el.clientHeight
      height = el.clientHeight
    }
    const ro = new ResizeObserver(keep)
    ro.observe(inner.current!)
    // and when the box itself gets shorter (the keyboard opens), the newest message stays in view: at once, so what
    // glides with the keyboard (viewport.ts) starts from the right place
    ro.observe(el)
    addEventListener('app-resized', keep)
    // a jump to a message (a quote's, an alert's, find's): its glide starts near the bottom, so no taking hold of it
    // again on the way, nor keeping the bottom edge (what draws late, a slow phone or a busy page, would stop it short)
    const glide = () => {
      pinned.current = false
      jumping.current = performance.now() + JUMP_GLIDE
    }
    el.addEventListener('chat-jump', glide)
    return () => {
      ro.disconnect()
      removeEventListener('app-resized', keep)
      removeEventListener('shepherdr:reloading', keepScroll)
      clearTimeout(settled)
      el.removeEventListener('chat-jump', glide)
    }
  }, [])
  // an alert's link: once this chat shows its card, the card comes into view, lit up, its buttons ready
  const jump = useStore((s) => s.ui.jump)
  const msgs = useStore((s) => s.chats[chatKey]?.messages)
  useEffect(() => {
    const m = jump ? msgs?.find((x) => x.id === jump || x.question?.id === jump) : undefined
    if (!m) return
    // after the chat has settled at its newest message
    const t = setTimeout(() => {
      if (jumpTo(chatKey, m.id, { card: !!m.question && m.question.id === jump })) setUI({ jump: null })
    }, 120)
    return () => clearTimeout(t)
  }, [jump, msgs])
  // as in iMessage, scrolling the chat keeps a phone's keyboard up: it goes down only when the finger drags down past
  // the message box into the keyboard, or on a plain tap on the chat
  const swipe = useRef<{ x: number; y: number; scroll?: boolean } | null>(null)
  const lastTop = useRef(0)
  const toBottom = () => {
    const el = box.current!
    pinned.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          const left = el.scrollHeight - el.scrollTop - el.clientHeight
          // only a scroll up lets go of the bottom: a picture loading grows the list under a scroll on its way down,
          // and the chat must still end at the newest message, not short of it under the arrow
          if (left < AWAY) pinned.current ||= performance.now() > jumping.current
          else if (el.scrollTop < lastTop.current) pinned.current = false
          lastTop.current = el.scrollTop
          setAway(!pinned.current)
        }}
        onTouchStart={(e) => {
          const t = e.touches[0]
          // one from the screen's edge is the screen's (the drawer, going back), even as a thumb's arc dips down
          const edge = t.clientX - e.currentTarget.getBoundingClientRect().left < EDGE
          swipe.current = e.touches.length === 1 && boxFocused() && !edge ? { x: t.clientX, y: t.clientY } : null
        }}
        onTouchMove={(e) => {
          const from = swipe.current
          const t = e.touches[0]
          if (!from || !t) return
          // a sideways swipe (a reply, the drawer) is never a drag into the keyboard
          const dx = Math.abs(t.clientX - from.x)
          const dy = Math.abs(t.clientY - from.y)
          if (!from.scroll && Math.max(dx, dy) > SLOP) {
            if (dx > dy) return void (swipe.current = null)
            from.scroll = true
          }
          // down past the bottom of the box, onto the keyboard
          const kb = document.activeElement?.closest('[data-composer]')?.getBoundingClientRect().bottom
          if (kb !== undefined && t.clientY > kb) {
            swipe.current = null
            blurBox()
          }
        }}
        onClick={(e) => {
          if (!matchMedia('(pointer: coarse)').matches || !boxFocused() || !getSelection()?.isCollapsed) return
          if ((e.target as HTMLElement).closest('a, button, input, textarea, select, label, iframe, [role=button], [role=menuitem], [contenteditable=true]')) return
          blurBox()
        }}
        className="flex min-h-0 flex-1 touch-pan-y touch-pinch-zoom flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div ref={inner} data-kb className="flex flex-1 flex-col">
          <NewAt.Provider value={newAt}>{children}</NewAt.Provider>
        </div>
      </div>
      {/* read further up, the chat fades out at the bottom, so the arrow sits on the fade, not on crisp words (like
          ChatGPT) */}
      {away ? <div aria-hidden="true" data-fade-under-jump className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-b from-transparent to-bg to-55%" /> : null}
      {away ? (
        <button
          type="button"
          aria-label={unread ? `${unread} new ${unread === 1 ? 'reply' : 'replies'}: jump to the latest` : 'Jump to the latest'}
          onClick={toBottom}
          // in the middle, over the gap between the two sides' bubbles, as in ChatGPT and Slack
          className="absolute bottom-2 left-1/2 z-10 grid size-10 -translate-x-1/2 place-items-center rounded-full bg-bg text-fg2 shadow-menu hover:text-fg phone:size-11"
        >
          <DownIcon className={ic} />
          {/* centred on the button's edge at its top right, a ring of the page around it so it reads clear of the
              button's shadow */}
          <Count n={unread} className="absolute -top-0.75 -right-0.75 shadow-[0_0_0_2px_var(--bg)] phone:-top-1 phone:-right-1" />
        </button>
      ) : null}
    </div>
  )
}

/* ---------- the chat ---------- */

function ChatView({ chatKey, placeholder, unreachable }: { chatKey: string; placeholder: string; unreachable?: string }) {
  const from = useStore((s) => chatName(s.snap!, chatKey))
  const chat = useChat(chatKey)
  const override = useUI((u) => registry.chatBody.find((b) => b.when(u, chatKey)))
  if (override) return <override.View chatKey={chatKey} />
  return (
    <DropFiles chatKey={chatKey}>
      <FindBar chatKey={chatKey} />
      <StickToBottom key={chatKey} chatKey={chatKey}>
        {unreachable ? (
          <div className="mx-auto w-full max-w-read px-5 pt-4">
            <div role="status" className="rounded-box bg-bubble px-3 py-2.5 text-[0.8125rem] text-pretty text-fg2 phone:text-[0.9375rem]">
              {unreachable}
            </div>
          </div>
        ) : null}
        <Messages chat={chat ?? { key: chatKey, cli: 'Claude Code', messages: [] }} from={from} />
      </StickToBottom>
      <Composer chatKey={chatKey} placeholder={placeholder} cli={chat?.cli ?? 'Claude Code'} />
    </DropFiles>
  )
}

/** Search in this chat, first in a chat's ⋯ menu (a coordinator's or a task's) */
function FindItem({ chatKey }: { chatKey: string }) {
  return (
    <>
      <MenuItem icon={<SearchIcon className={ic} />} onClick={() => openFind(chatKey)}>
        Search in this chat
      </MenuItem>
      {registry.views.search ? <MenuItem icon={<SearchIcon className={ic} />} onClick={() => setUI({ search: true, searchScope: { kind: 'chat', id: chatKey }, menu: false, taskMenu: false })}>
        Open full search
      </MenuItem> : null}
    </>
  )
}

/** files dragged onto a chat attach to its message box; while they hover, the chat dims softly under a quiet note */
function DropFiles({ chatKey, children }: { chatKey: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  // enter and leave fire for every child the drag crosses: count them, so the highlight doesn't flicker
  const depth = useRef(0)
  return (
    <div
      data-drop
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        if (--depth.current <= 0) {
          depth.current = 0
          setOver(false)
        }
      }}
      onDrop={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        attach(chatKey, dropped(e.dataTransfer))
      }}
    >
      {children}
      {over ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-box bg-bg/80 shadow-[inset_0_0_0_1.5px_var(--focus)] backdrop-blur-[2px]"
        >
          <span className="flex items-center gap-2 rounded-full bg-bubble px-3.5 py-2 text-fg2">
            <FileIcon className={ic} />
            Drop to attach
          </span>
        </div>
      ) : null}
    </div>
  )
}

export default definePlugin({
  name: 'chat',
  setup(reg) {
    reg.views.chat = ChatView
    reg.chatTail.push({ order: 90, View: Typing })
    reg.messageParts.push({ order: 10, View: ({ msg, chat }) => (msg.activity ? <TurnLine a={msg.activity} chat={chat.key} /> : null) })
    reg.composerAbove.push({ order: 10, View: JobsTag })
    reg.overlays.push(JobsSheet)
    reg.messageParts.push({ order: 60, View: ({ msg, chat, from }) => (msg.question ? <QuestionCard q={msg.question} chat={chat} msg={msg.id} from={from} /> : null) })
    reg.messageParts.push({ order: 61, View: ({ msg, chat }) => (msg.secret ? <SecretCard ask={msg.secret} chat={chat} /> : null) })
    reg.composerPlus = PlusMenu
    reg.composerMic = Mic
    reg.composerLive.push({ when: (ui, chatKey) => ui.dict === chatKey, View: DictationBox })
    // while it records, Enter puts it in the box and Esc drops it
    reg.keys.push({
      order: 5,
      handle: ({ e, ui }) => {
        if (!ui.dict || (e.key !== 'Enter' && e.key !== 'Escape') || (e.target as HTMLElement)?.closest?.('input, textarea, button')) return false
        e.preventDefault()
        if (e.key === 'Enter') finishDictation()
        else cancelDictation()
        return true
      },
    })
    reg.placeMenu.push({ order: 50, View: ({ place }) => <FindItem chatKey={place.chat} /> }, { order: 55, joined: true, View: PlaceRestartItem })
    reg.agentMenu.push({ order: 50, View: FindItem })
    reg.overlays.push(RestartSheet)
    reg.composerAbove.push({ order: 20, View: Attachments }, { order: 30, View: PlusMenu })
    reg.overlays.push(Photo)
    addEventListener('pointerdown', keepBox, true)
    addEventListener('mousedown', keepBox, true)
    // a file dropped beside a chat (a header, the task list) mustn't open in the tab and take the app away
    window.addEventListener('dragover', (e) => {
      if (!draggingFiles(e.dataTransfer) || (e.target as HTMLElement)?.closest?.('[data-drop]')) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'none'
    })
    window.addEventListener('drop', (e) => draggingFiles(e.dataTransfer) && !(e.target as HTMLElement)?.closest?.('[data-drop]') && e.preventDefault())
  },
})
