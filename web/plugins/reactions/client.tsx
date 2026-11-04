// Reactions, the way iMessage, WhatsApp, Telegram and Slack do them. On a touch screen, hold a message (or tap it
// twice): it lifts out of the chat, which dims and blurs behind it, with your most used emoji above it and Reply, Copy
// and Select text below (Reply alone for a file), all kept on screen. With a mouse, the smiley beside a message opens the bar next to it. + opens
// every emoji (search, groups, frequently used and a skin tone, remembered on this device). Reactions sit on the
// bubble's bottom right corner, and tapping one adds yours or takes it back, like Slack. A reaction is sent at once, as
// a message (like iMessage reactions sent as SMS); sent while the agent shows a menu or is starting, it waits like a
// typed message, its pill faded until it goes in.
import clsx from 'clsx'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { act, definePlugin, setUI, useStore, useUI } from '@client/kernel.ts'
import { AWAY, buzz, moveTo, project, settleMs, SPRING, useMotion } from '@client/motion.ts'
import { useDialogFocus } from '@client/focus.ts'
import { follow as followFinger, mayPanDown } from '@client/gestures.ts'
import { ClockIcon, CopyIcon, ic, MenuItem, PlusIcon, ReplyIcon, SearchIcon, SelectIcon } from '@client/ui.tsx'
import type { Message } from '@shared/types.ts'
import { canReply, startReply } from '@plugins/chat/reply.ts'
import { frequent, loadEmoji, quickRow, remember, search, setTone, tone, TONES, withTone, type Emoji, type Group } from './emoji.ts'

const WHO = { them: 'Agent', me: 'You', both: 'You and agent' }

/** the quick row: your most used, then the favourites, in this device's skin tone */
export const quick = () => quickRow(tone())

export const mine = (msg: Message, emoji: string) => !!msg.reactions?.some((r) => r.emoji === emoji && r.by !== 'them')

/** send a reaction: yours added, or taken back if it is yours already */
function send(chat: string, msg: string, emoji: string) {
  remember(emoji)
  return act({ type: 'react', chat, message: msg, emoji })
}

/** react and close the bar or picker */
export function react(chat: string, msg: string, emoji: string) {
  setUI({ pick: null, pickAll: false })
  return send(chat, msg, emoji)
}

/** where the hold was and how the bar was opened: a touch lifts the message and offers Reply, Copy and Select */
let opened: { x: number; y: number; touch: boolean } | null = null

/** open the bar for a message; `at` is where a finger held it */
export function openBar(chat: string, msg: string, at?: { x: number; y: number; touch: boolean }) {
  opened = at ?? null
  setUI({ pick: msg, pickChat: chat, pickAll: false, selecting: null })
}

/** open the full picker (from the bar, or over a picture) */
export const openPicker = (chat: string, msg: string) => setUI({ pick: msg, pickChat: chat, pickAll: true })

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** a light tap from the phone (motion.ts) */
export { buzz }

/* ---------- on the bubble ---------- */

/** the reactions on a message: pills on its bubble's bottom right corner; tapping one toggles yours */
function Pills({ msg, chat }: { msg: Message; chat: { key: string } }) {
  return (msg.reactions ?? []).map((r) => {
    const yours = r.by !== 'them'
    return (
      <button
        key={r.emoji}
        type="button"
        aria-label={`${r.emoji} from ${WHO[r.by].toLowerCase()}`}
        // a phone's keyboard stays up (chat's keepBox)
        data-keep-box
        aria-pressed={yours}
        onClick={() => react(chat.key, msg.id, r.emoji)}
        className={clsx(
          // a ring of the page's colour cuts each pill out of the bubble's edge; on a phone a finger finds it 8px above
          // and below too, 44px in all
          "relative inline-flex h-6 items-center gap-[3px] rounded-full px-[7px] text-[0.8125rem] phone:h-7 phone:px-2 phone:text-[0.9375rem] phone:after:absolute phone:after:-inset-y-2 phone:after:inset-x-0 phone:after:content-['']",
          yours
            ? clsx(YOURS, 'shadow-[0_0_0_2px_var(--bg),inset_0_0_0_1.5px_var(--accent)]')
            : 'bg-bg shadow-[0_0_0_2px_var(--bg),inset_0_0_0_1px_var(--line2)] hover:bg-[color-mix(in_srgb,var(--fg)_4%,var(--bg))]',
          r.pending && 'opacity-50',
        )}
      >
        {r.emoji}
        {r.by === 'both' ? <small className="text-[0.6875rem] text-fg2 tabular-nums phone:text-[0.75rem]">2</small> : null}
      </button>
    )
  })
}

/** yours, the one look everywhere: a pill on a bubble, an emoji in the bar or the picker */
const YOURS = 'bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg))]'
const yoursRing = 'aria-pressed:bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg))] aria-pressed:shadow-[inset_0_0_0_1.5px_var(--accent)]'

/* ---------- placing a popup next to the message ---------- */

const anchorOf = (chat: string | null, msg: string) => {
  const sel = `[data-msg="${CSS.escape(msg)}"]${chat ? `[data-chat="${CSS.escape(chat)}"]` : ''}`
  return document.querySelector<HTMLElement>(sel) ?? document.querySelector<HTMLElement>(`[data-msg="${CSS.escape(msg)}"]`)
}

/** over the message (under it when there's no room), on its outer side, inside the screen */
function useNextTo(ref: RefObject<HTMLElement | null>, chat: string, msg: string, deps: unknown[], off = false) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || off) return
    const put = () => {
      const m = 8
      const vw = document.documentElement.clientWidth
      const vh = visualViewport?.height ?? innerHeight
      const w = el.offsetWidth
      const h = el.offsetHeight
      const box = anchorOf(chat, msg)?.querySelector<HTMLElement>('[data-anchor]')
      const a = box?.getBoundingClientRect()
      let x = (vw - w) / 2
      let y = vh - h - 24
      if (a) {
        x = box!.closest('[data-you]') ? a.right - w : a.left
        if (a.top - h - m >= m) y = a.top - h - m
        else if (a.bottom + m + h <= vh - m) y = a.bottom + m
        // a message taller than the screen: by the finger that held it
        else if (opened) y = opened.y - h - 24 >= m ? opened.y - h - 24 : opened.y + 24
        else y = Math.max(a.top, m)
      }
      el.style.left = `${Math.round(Math.min(Math.max(m, x), vw - w - m))}px`
      el.style.top = `${Math.round(Math.min(Math.max(m, y), vh - h - m))}px`
      el.style.visibility = 'visible'
    }
    put()
    addEventListener('resize', put)
    return () => removeEventListener('resize', put)
  }, deps)
}

/** closes on Escape: before the app's own keys see it, so a picture under the picker stays open */
function useEscape(close: () => void) {
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
    }
    addEventListener('keydown', on, true)
    return () => removeEventListener('keydown', on, true)
  })
}

const close = () => setUI({ pick: null, pickAll: false })

/** the shade behind a popup: a tap on it closes the popup; the finger lifting off the hold that opened it doesn't */
function Backdrop({ dim, z }: { dim?: boolean; z: string }) {
  const down = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  // the sheets' shade, fading in and out with it
  useMotion(ref, 'fade')
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={clsx('fixed inset-0', z, dim && 'bg-black/35')}
      onPointerDown={() => (down.current = true)}
      onClick={() => down.current && close()}
      onWheel={close}
    />
  )
}

/* ---------- the bar ---------- */

/** the quick row and + for every emoji */
function Row({ msg, chat, pick, first }: { msg: Message; chat: string; pick: (e: string) => void; first?: RefObject<HTMLButtonElement | null> }) {
  return (
    <div role="group" aria-label="Reactions" className="flex gap-0.5 rounded-full bg-bg p-1 shadow-menu">
      {quick().map((e, i) => (
        <button
          key={e}
          ref={i ? undefined : first}
          type="button"
          aria-label={`React ${e}`}
          aria-pressed={mine(msg, e)}
          onClick={() => pick(e)}
          className={clsx('grid size-9 place-items-center rounded-full text-[1.25rem] hover:bg-hover coarse:size-11 phone:size-11 phone:text-[1.375rem]', yoursRing)}
        >
          {e}
        </button>
      ))}
      <button
        type="button"
        aria-label="More emoji"
        onClick={() => openPicker(chat, msg.id)}
        className="grid size-9 place-items-center rounded-full bg-sel text-fg2 hover:text-fg coarse:size-11 phone:size-11"
      >
        <PlusIcon className={ic} />
      </button>
    </div>
  )
}

/** with a mouse or the keyboard: the bar beside the message, the chat left as it is (like Slack and WhatsApp on the web) */
function Beside({ msg, chat }: { msg: Message; chat: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  useNextTo(ref, chat, msg.id, [msg.id])
  useEscape(close)
  // it springs out like a menu, and hands the focus back when it closes
  useMotion(ref, 'menu')
  useDialogFocus(ref, { focus: false })
  useEffect(() => {
    // from the keyboard, the first emoji takes the focus; a mouse leaves it where it is
    if (!opened) first.current?.focus({ preventScroll: true })
    // the chat moving under it: the bar would point at the wrong place
    addEventListener('scroll', close, true)
    return () => removeEventListener('scroll', close, true)
  }, [])
  return (
    <>
      <Backdrop z="z-40" />
      <div ref={ref} role="dialog" aria-label="React" className={clsx('invisible fixed z-40 flex', msg.who === 'you' ? 'origin-bottom-right justify-end' : 'origin-bottom-left justify-start')}>
        <Row msg={msg} chat={chat} first={first} pick={(e) => react(chat, msg.id, e)} />
      </div>
    </>
  )
}

/** gaps: the bar above the message, the menu below it, and the screen's edge */
const ABOVE = 12
const BELOW = 8
const EDGE = 8

/** On a touch screen, like iMessage and Telegram: the message lifts out of the chat, which dims and blurs behind it.
    Your emoji sit above it and the menu below it, on its side, inside the screen; the message moves to make room, and
    one too tall to fit shows the part the finger held. Picking anything, or a tap outside, sets it back down. */
function Lifted({ msg, chat }: { msg: Message; chat: string }) {
  const root = useRef<HTMLDivElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const lift = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // how far the message moved from its place in the chat, to go back
  const moved = useRef(0)
  const leaving = useRef(false)
  const you = msg.who === 'you'
  const text = msg.text ?? ''

  useLayoutEffect(() => {
    const anchor = anchorOf(chat, msg.id)?.querySelector<HTMLElement>('[data-anchor]')
    const r = root.current!
    const l = lift.current!
    const b = bar.current!
    const m = menu.current
    if (!anchor) return close()
    const pad = getComputedStyle(r)
    const vw = r.clientWidth
    const top = parseFloat(pad.paddingTop) + EDGE
    const bottom = r.clientHeight - parseFloat(pad.paddingBottom) - EDGE
    // its place in the chat, before the press shrank it
    const at = anchor.getBoundingClientRect()
    const w = anchor.offsetWidth
    const h = anchor.offsetHeight
    const x0 = at.left + at.width / 2 - w / 2
    const y0 = at.top + at.height / 2 - h / 2
    const bh = b.offsetHeight
    // a short screen (the keyboard up): the message shrinks to make room, down to a line; below that the menu gives way,
    // so the emoji always fit
    const room = (menu: number) => bottom - top - bh - ABOVE - menu
    const least = Math.min(h, 40)
    let mh = m ? m.offsetHeight + BELOW : 0
    if (m && room(mh) < least) {
      m.style.display = 'none'
      mh = 0
    }
    const shown = Math.max(Math.min(h, room(mh)), Math.min(least, room(0)), 0)
    // too tall to fit: the part around the finger
    const cut = h > shown ? Math.min(Math.max((opened?.y ?? y0) - y0 - shown / 2, 0), h - shown) : 0
    // the bar stays on screen before all else
    const y = Math.max(Math.min(y0 + cut, bottom - mh - shown), top + bh + ABOVE)
    moved.current = y0 + cut - y

    const copy = anchor.cloneNode(true) as HTMLElement
    for (const a of ['data-anchor', 'data-pressing', 'tabindex', 'title', 'aria-label']) copy.removeAttribute(a)
    copy.style.cssText = `width:${w}px;margin:0;box-shadow:none;transform:translateY(${-cut}px)`
    l.replaceChildren(copy)
    Object.assign(l.style, { left: `${x0}px`, top: `${y}px`, width: `${w}px`, height: `${shown}px` })
    // a cut edge fades out
    if (shown < h) l.style.maskImage = `linear-gradient(${cut ? 'transparent, #000 24px' : '#000, #000'}, ${cut + shown < h ? '#000 calc(100% - 24px), transparent' : '#000, #000'})`
    const side = (el: HTMLElement) => {
      const ew = el.offsetWidth
      el.style.left = `${Math.min(Math.max(EDGE, you ? x0 + w - ew : x0), vw - ew - EDGE)}px`
    }
    side(b)
    b.style.top = `${y - ABOVE - bh}px`
    if (m) {
      side(m)
      m.style.top = `${y + shown + BELOW}px`
    }
    r.style.visibility = 'visible'
    anchor.style.visibility = 'hidden'
    getSelection()?.removeAllRanges()

    shade.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    if (still()) {
      for (const el of [b, m]) el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
    } else {
      // from where it sat, pressed down, up into place; the bar and menu grow out of its side
      l.animate([{ transform: `translateY(${moved.current}px) scale(.96)` }, { transform: 'none' }], { duration: 420, easing: SPRING })
      b.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: SPRING })
      b.querySelectorAll('button').forEach((e, i) =>
        e.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 30 + i * 20, easing: SPRING, fill: 'backwards' }),
      )
      // the menu springs out like every menu
      m?.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: SPRING })
    }
    // the screen changing under it (turned, the keyboard): it would point at the wrong place
    const gone = () => close()
    visualViewport?.addEventListener('resize', gone)
    addEventListener('resize', gone)
    return () => {
      anchor.style.visibility = ''
      visualViewport?.removeEventListener('resize', gone)
      removeEventListener('resize', gone)
    }
  }, [msg.id])

  /** set the message back down, then do what was picked */
  const leave = (then: () => void = close) => {
    if (leaving.current) return
    leaving.current = true
    const ms = still() ? 120 : 200
    const opt = { duration: ms, easing: AWAY, fill: 'forwards' as const }
    shade.current?.animate([{ opacity: 1 }, { opacity: 0 }], opt)
    if (!still()) lift.current?.animate([{ transform: 'none' }, { transform: `translateY(${moved.current}px)` }], opt)
    for (const el of [bar.current, menu.current]) el?.animate([{ opacity: 1 }, { opacity: 0, transform: still() ? 'none' : 'scale(.85)' }], opt)
    setTimeout(then, ms)
  }
  useEscape(() => leave())
  const pick = (e: string) => {
    if (leaving.current) return
    buzz()
    send(chat, msg.id, e)
    leave()
  }
  const down = useRef(false)

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="React"
      // held while typing, the keyboard stays up through it (chat's keepBox)
      data-keep-box
      className="invisible fixed inset-x-0 top-0 z-40 h-[var(--app-h,100dvh)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] select-none [-webkit-touch-callout:none]"
    >
      {/* a tap outside sets it down; the finger lifting off the hold that opened it doesn't */}
      <div
        ref={shade}
        aria-hidden="true"
        onPointerDown={() => (down.current = true)}
        onClick={() => down.current && leave()}
        onWheel={close}
        className="absolute inset-0 touch-none bg-black/20 backdrop-blur-[10px] dark:bg-black/45"
      />
      <div ref={lift} aria-hidden="true" className="pointer-events-none absolute overflow-hidden" />
      <div ref={bar} className={clsx('absolute', you ? 'origin-bottom-right' : 'origin-bottom-left')}>
        <Row msg={msg} chat={chat} pick={pick} />
      </div>
      {canReply(msg) ? (
        <div ref={menu} role="menu" aria-label="Message" className={clsx('popover absolute w-56', you ? 'origin-top-right' : 'origin-top-left')}>
          <MenuItem icon={<ReplyIcon className={ic} />} onClick={() => startReply(chat, msg)}>
            Reply
          </MenuItem>
          {text ? (
            <>
              <MenuItem
                icon={<CopyIcon className={ic} />}
                onClick={() => {
                  // in the tap itself: Safari copies only then
                  navigator.clipboard?.writeText(text).catch(() => {})
                  leave()
                }}
              >
                Copy
              </MenuItem>
              {/* an update card is one short line: Copy takes it all */}
              {msg.card ? null : (
                <MenuItem icon={<SelectIcon className={ic} />} onClick={() => leave(() => setUI({ pick: null, pickAll: false, selecting: msg.id }))}>
                  Select text
                </MenuItem>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Bar({ msg, chat }: { msg: Message; chat: string }) {
  return opened?.touch ? <Lifted msg={msg} chat={chat} /> : <Beside msg={msg} chat={chat} />
}

/* ---------- the full picker ---------- */

function Picker({ msg, chat, sheet }: { msg: Message; chat: string; sheet: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useNextTo(ref, chat, msg.id, [msg.id, sheet], sheet)
  useEscape(close)
  // Tab stays in it, and the focus goes back when it closes (a phone's keeps its keyboard down: nothing takes the focus)
  useDialogFocus(ref, { focus: false })
  // opened while typing, a phone's sheet takes the screen the keyboard had; the box gets it back with the pick (in the
  // tap itself, so a phone brings its keyboard up again), or as the sheet closes (above)
  const typing = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const box = document.activeElement
    if (!sheet || !(box instanceof HTMLTextAreaElement) || box.name !== 'message') return
    typing.current = box
    box.blur()
  }, [])
  // a sheet slides up and drags down to close; beside a message it springs out like a menu
  useMotion(ref, sheet ? 'sheet' : 'menu')
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (!sheet || !mayPanDown(e.target, el)) return
    const h = el.offsetHeight
    followFinger(e.nativeEvent, {
      axis: 'y',
      sign: 1,
      move: (d) => (el.style.transform = `translateY(${d > 0 ? d : d * 0.2}px)`),
      end: ({ d, v }) => {
        const away = project(d, v) > h * 0.35 && v > -0.1
        void moveTo(el, { transform: `translateY(${away ? h : 0}px)` }, away ? settleMs(h - d, v, 340) : 300).then(() => {
          if (!away) return void (el.style.transform = '')
          el.dataset.gone = ''
          close()
        })
      },
      cancel: () => (el.style.transform = ''),
    })
  }
  const pick = (e: string) => {
    typing.current?.focus({ preventScroll: true })
    return react(chat, msg.id, e)
  }

  return (
    <>
      <Backdrop z="z-[60]" dim={sheet} />
      <div
        ref={ref}
        role="dialog"
        aria-label="Pick an emoji"
        onPointerDown={drag}
        className={clsx(
          'fixed z-[60] flex flex-col overflow-hidden bg-bg',
          sheet
            ? // on what is visible: above the keyboard while searching, back down when it closes
              'inset-x-0 top-[calc(var(--app-h,100dvh)-var(--sheet-h))] h-(--sheet-h) rounded-t-box pb-[env(safe-area-inset-bottom)] shadow-dialog [--sheet-h:min(62dvh,480px,calc(var(--app-h,100dvh)-48px))] motion-safe:transition-[top,height] motion-safe:duration-250 motion-safe:ease-out'
            : 'invisible h-[420px] max-h-[calc(100dvh-16px)] w-[360px] max-w-[calc(100vw-16px)] rounded-box shadow-menu',
        )}
      >
        {/* the sheets' grabber */}
        {sheet ? (
          <div aria-hidden="true" className="flex h-5 shrink-0 justify-center pt-1.5">
            <div className="h-1 w-9 rounded-full bg-line2" />
          </div>
        ) : null}
        <EmojiChooser onPick={pick} chosen={(e) => mine(msg, e)} focus={!sheet} hint={sheet ? undefined : 'Pick an emoji to react'} />
      </div>
    </>
  )
}

/** every emoji to pick from: a search, a skin tone, the groups (frequently used first) as tabs over one scrolling grid,
 *  and (with a hint) the one under the pointer named at the foot. The reactions' picker, and anything else picking one
 *  (a machine's emoji). */
export function EmojiChooser({ onPick, chosen, focus, hint }: { onPick: (e: string) => void; chosen?: (e: string) => boolean; focus?: boolean; hint?: string }) {
  const grid = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [q, setQ] = useState('')
  const [skin, setSkin] = useState(tone)
  const [tones, setTones] = useState(false)
  const [on, setOn] = useState(0)
  const [hover, setHover] = useState<Emoji | null>(null)
  const used = useMemo(() => frequent(), [])
  useEffect(() => {
    loadEmoji().then(setGroups)
    // a phone keeps its keyboard down until you tap the search
    if (focus) input.current?.focus({ preventScroll: true })
  }, [focus])

  const named = useMemo(() => new Map(groups?.flatMap((g) => g.list.map((x) => [x.e, x] as const))), [groups])
  const found = useMemo(() => (groups && q.trim() ? search(groups, q) : null), [groups, q])
  const sections: { name: string; icon?: string; list: Emoji[] }[] = [
    ...(used.length ? [{ name: 'Frequently used', list: used.map((e) => named.get(e) ?? { e, tone: false, name: e, codes: '', words: '' }) }] : []),
    ...(groups ?? []),
  ]
  const pick = (x: Emoji) => onPick(x.tone ? withTone(x.e, skin) : x.e)
  const jump = (i: number) => {
    const s = grid.current?.querySelectorAll<HTMLElement>('section')[i]
    if (s && grid.current) grid.current.scrollTop = s.offsetTop - grid.current.offsetTop
    setOn(i)
  }
  const follow = () => {
    const g = grid.current
    if (!g) return
    const all = [...g.querySelectorAll<HTMLElement>('section')]
    let i = 0
    all.forEach((s, j) => s.offsetTop - g.offsetTop <= g.scrollTop + 8 && (i = j))
    if (i !== on) setOn(i)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && found?.[0]) {
      e.preventDefault()
      e.stopPropagation()
      pick(found[0])
    }
  }
  const cell = (x: Emoji, key: string) => {
    const e = x.tone ? withTone(x.e, skin) : x.e
    return (
      <button
        key={key}
        type="button"
        aria-label={x.name}
        aria-pressed={chosen?.(e) ?? false}
        onClick={() => pick(x)}
        onPointerEnter={() => setHover(x)}
        onFocus={() => setHover(x)}
        className={clsx('grid aspect-square place-items-center rounded-full text-[1.5rem] leading-none hover:bg-hover focus-visible:bg-hover phone:text-[1.625rem]', yoursRing)}
      >
        {e}
      </button>
    )
  }
  const gridCls = 'grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] px-2 phone:grid-cols-[repeat(auto-fill,minmax(44px,1fr))]'

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 p-2 pb-1">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-sel px-3 text-fg3 focus-within:shadow-box-focus coarse:h-11 phone:h-11">
          <SearchIcon className={ic} />
          <input
            ref={input}
            name="emoji-search"
            aria-label="Search emoji"
            placeholder="Search emoji"
            autoComplete="off"
            enterKeyHint="go"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={keys}
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg3 phone:text-[1rem]"
          />
        </label>
        <button
          type="button"
          aria-label="Skin tone"
          aria-expanded={tones}
          onClick={() => setTones(!tones)}
          className="grid size-9 shrink-0 place-items-center rounded-full text-[1.25rem] hover:bg-hover aria-expanded:bg-sel coarse:size-11 phone:size-11"
        >
          {TONES[skin]}
        </button>
      </div>
      {tones ? (
        <div role="group" aria-label="Skin tone" className="flex shrink-0 justify-end gap-0.5 px-2 pb-1">
          {TONES.map((t, i) => (
            <button
              key={t}
              type="button"
              aria-label={i ? `Skin tone ${i}` : 'No skin tone'}
              aria-pressed={i === skin}
              onClick={() => {
                setSkin(i)
                setTone(i)
                setTones(false)
              }}
              className="grid size-9 place-items-center rounded-full text-[1.25rem] hover:bg-hover aria-pressed:bg-sel coarse:size-11 phone:size-11"
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {!found ? (
        <div role="tablist" aria-label="Emoji groups" className="flex shrink-0 justify-between border-b border-line px-1.5">
          {sections.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === on}
              aria-label={s.name}
              onClick={() => jump(i)}
              className="group grid h-9 min-w-0 flex-1 place-items-center rounded-full text-[1.0625rem] text-fg3 hover:bg-hover aria-selected:text-fg coarse:h-11 phone:h-11"
            >
              <span className="relative grid h-full place-items-center">
                {s.icon ? <span className="opacity-55 grayscale group-aria-selected:opacity-100 group-aria-selected:grayscale-0">{s.icon}</span> : <ClockIcon className={ic} />}
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full group-aria-selected:bg-fg" />
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {/* dragging the emoji puts the keyboard away, like a list on iOS: the sheet grows back to show more */}
      <div ref={grid} onScroll={follow} onTouchMove={() => document.activeElement === input.current && input.current?.blur()} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {!groups ? (
          <div className="p-6 text-center text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">Loading emoji…</div>
        ) : found ? (
          found.length ? (
            <div className={clsx(gridCls, 'pt-1')}>{found.slice(0, 160).map((x) => cell(x, x.e))}</div>
          ) : (
            <div className="p-6 text-center text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">No emoji found for “{q.trim()}”</div>
          )
        ) : (
          sections.map((s) => (
            // a group off screen isn't drawn until scrolled to: two thousand emoji stay light on a phone
            <section key={s.name} aria-label={s.name} className="[contain-intrinsic-size:auto_480px] [content-visibility:auto]">
              <h3 className="sticky top-0 z-[1] bg-bg/95 px-3 pt-2 pb-1 text-[0.75rem] font-medium text-fg2 phone:text-[0.8125rem]">{s.name}</h3>
              <div className={gridCls}>{s.list.map((x) => cell(x, `${s.name}:${x.e}`))}</div>
            </section>
          ))
        )}
      </div>
      {hint ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[0.75rem] text-fg2" aria-hidden="true">
          {hover ? (
            <>
              <span className="text-[1.125rem]">{hover.tone ? withTone(hover.e, skin) : hover.e}</span>
              <span className="truncate">{hover.name}</span>
            </>
          ) : (
            hint
          )}
        </div>
      ) : null}
    </>
  )
}

/** the open bar or picker, for the message it was opened on */
function Popup() {
  const ui = useUI()
  const chatKey = ui.pickChat ?? (ui.pick ? (anchorOf(null, ui.pick)?.dataset.chat ?? null) : null)
  const msg = useStore((s) => (chatKey && ui.pick ? s.chats[chatKey]?.messages.find((m) => m.id === ui.pick) : undefined))
  // the message went away (a reload), or the chat changed under it
  useEffect(() => {
    if (ui.pick && !msg) setUI({ pick: null, pickAll: false })
  }, [ui.pick, msg])
  if (!ui.pick || !msg || !chatKey) return null
  if (ui.pickAll) return <Picker key={msg.id} msg={msg} chat={chatKey} sheet={ui.device === 'phone' || !!ui.photo || !anchorOf(chatKey, msg.id)} />
  // over a picture opened full screen, its own row reacts
  if (ui.photo) return null
  return <Bar key={msg.id} msg={msg} chat={chatKey} />
}

export default definePlugin({
  name: 'reactions',
  setup(reg) {
    reg.messageEdge.push({ order: 100, View: Pills })
    reg.overlays.push(Popup)
  },
})
