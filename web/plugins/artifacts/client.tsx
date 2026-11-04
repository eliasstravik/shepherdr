// Artifacts any agent makes (shepherdr artifact): a card in the chat where it was made, in a sealed frame; full screen
// on a tap, with its versions, Mark up and a box to write to its keeper, so you change it by chatting beside it; and a
// list per place, and one per chat (its ⋯ → Artifacts). A newer version swaps in live: only its data changed, the page takes the new data without a reload.
// Shown in the side panel, it fills a place's Artifacts list (or a task's Artifacts tab) beside the chat.
import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  act,
  agentChat,
  artifactsIn,
  closeArtifact,
  closeSheet,
  definePlugin,
  filterOf,
  getState,
  listView,
  matches,
  openArtifact,
  openItem,
  openSplit,
  placeOf,
  setDraft,
  setFilter,
  setUI,
  splitClick,
  taskInMiddle,
  togglePanel,
  useDraftOf,
  useSnap,
  useStore,
  useUI,
} from '@client/kernel.ts'
import { ListChips } from '@client/chips.tsx'
import { DictationBox, toggleDictation, useChat } from '@plugins/chat/client.tsx'
import { canDictate } from '@client/dictation.ts'
import { useDialogFocus } from '@client/focus.ts'
import { useMotion } from '@client/motion.ts'
import { isDark, useDark } from '@client/theme.ts'
import {
  BackIcon,
  CheckIcon,
  ClockIcon,
  dimmed,
  Empty,
  FilterBox,
  Ghost,
  ic,
  IconButton,
  List,
  MarkBadge,
  MarkUpIcon,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MicIcon,
  MoreIcon,
  OpenIcon,
  PageIcon,
  PanelIcon,
  Row,
  SplitIcon,
  roundBtn,
  RowText,
  TextBox,
  UpIcon,
  XIcon,
} from '@client/ui.tsx'
import type { Artifact, Chat, Message, Task } from '@shared/types.ts'

export type Pick = { text: string; selector: string; component?: string; x: number; y: number }

const frameUrl = (id: string, v: number, full: boolean, device: string, part = '', theme = '') =>
  `api/artifacts/${encodeURIComponent(id)}${part}?v=${v}${full ? '&full=1' : ''}&device=${device}${theme ? `&theme=${theme}` : ''}`

/** the version whose HTML a version shows (one that brought only data shows the HTML before it) */
const htmlOf = (a: Artifact, n: number) => a.versions.find((x) => x.n === n)?.html ?? n

/* ---------- an artifact in the side panel ---------- */

const SHOWN = 'shepherdr.panelArtifacts'
/** the artifact each side panel shows, by "place:<id>" (its Artifacts list) or "chat:<key>" (a task's Artifacts tab),
 *  remembered on this device */
let shownIn: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(SHOWN) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
})()
const shownListeners = new Set<() => void>()

function setShown(key: string, id: string | null) {
  const { [key]: _, ...rest } = shownIn
  shownIn = id ? { ...rest, [key]: id } : rest
  try {
    localStorage.setItem(SHOWN, JSON.stringify(shownIn))
  } catch {
    /* private window: the list shows again next time */
  }
  shownListeners.forEach((l) => l())
}

/** the artifact a side panel shows, while it is still kept */
function useShown(key: string) {
  const id = useSyncExternalStore(
    (l) => {
      shownListeners.add(l)
      return () => shownListeners.delete(l)
    },
    () => shownIn[key],
  )
  return useSnap()?.artifacts?.find((a) => a.id === id)
}

/** Show an artifact beside the chat: in the Artifacts list on the right (whatever its chips show; a phone's
 *  Artifacts tab), or, on a desktop where an open task's chat covers that list, in the task's own Artifacts tab (a
 *  phone or tablet has no column for it: the task gives way to the list) */
export function showInPanel(id: string) {
  const { ui, snap } = getState()
  if (!snap) return
  const g = agentChat(ui, snap)
  if (ui.viewer) closeArtifact()
  if (ui.device === 'desktop' && ui.task && g && !taskInMiddle(ui, snap)) {
    setShown(`chat:${g.chat}`, id)
    return openItem('artifacts')
  }
  setShown(`list:${listView(ui, snap).key}`, id)
  setUI(ui.device === 'phone' ? { task: null, tab: 'artifacts', pick: null, plus: null, menu: false } : { task: ui.task && !taskInMiddle(ui, snap) ? null : ui.task, side: 'artifacts' })
}

/** An artifact filling a side panel at its width, under its own bar: back to the list, full screen, and close */
function PanelArtifact({ art, onBack, onClose }: { art: Artifact; onBack: () => void; onClose: () => void }) {
  return (
    <div role="region" aria-label={art.title} className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line py-1 pr-2 pl-1 coarse:py-0.5">
        <IconButton label="Back to Artifacts" className="rounded-full!" onClick={onBack}>
          <BackIcon className={ic} />
        </IconButton>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <div className="line-clamp-2 min-w-0 shrink font-semibold break-words">{art.title}</div>
          <div className="shrink-0 text-xs text-fg2 tabular-nums phone:text-sm">v{art.v}</div>
        </div>
        <IconButton label="Open full screen" className="rounded-full!" onClick={() => openArtifact(art.id)}>
          <OpenIcon className={ic} />
        </IconButton>
        <IconButton label="Close" className="rounded-full!" onClick={onClose}>
          <XIcon className={ic} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <ArtifactFrame art={art} v={art.v} full />
        </div>
      </div>
    </div>
  )
}

/** An artifact filling a split view's pane, at its latest */
function SplitArtifact({ artifactId }: { artifactId: string }) {
  const art = useSnap()?.artifacts?.find((a) => a.id === artifactId)
  return art ? (
    <div className="absolute inset-0">
      <ArtifactFrame art={art} v={art.v} full />
    </div>
  ) : null
}

/** a person just tapped or typed, and not in another frame: a tap inside a frame marks the app as touched too (the
 *  browser's user activation), a script can't; where the browser can't tell, the frame must have the focus */
function touchedNow(frame: HTMLIFrameElement | null) {
  const other = document.activeElement instanceof HTMLIFrameElement && document.activeElement !== frame
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  return !other && (ua ? ua.isActive : document.activeElement === frame)
}

const onResize = (l: () => void) => {
  addEventListener('resize', l)
  return () => removeEventListener('resize', l)
}
/** the window's height; on a touch screen at its tallest for its width, so a keyboard or a browser's toolbar coming
 *  and going doesn't resize every card in the chat (turning it does) */
let tallest = { w: 0, h: 0 }
const useWindowHeight = () =>
  useSyncExternalStore(onResize, () => {
    if (!matchMedia('(pointer: coarse)').matches) return innerHeight
    if (innerWidth !== tallest.w || innerHeight > tallest.h) tallest = { w: innerWidth, h: innerHeight }
    return tallest.h
  })

/** how tall each page last said it is, so a card scrolled back into the chat doesn't jump */
const heights = new Map<string, number>()

/** An artifact's page in a sealed frame: scripts and forms run, never with this app's origin, and it loads nothing. */
export function ArtifactFrame({
  art,
  v,
  full,
  markup,
  onPick,
  onMore,
}: {
  art: Artifact
  v: number
  full?: boolean
  markup?: boolean
  onPick?: (p: Pick) => void
  /** more of the page is below what shows */
  onMore?: (more: boolean) => void
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const device = useUI((u) => u.device)
  // in the chat it is as tall as its page, up to most of the screen; the rest scrolls inside it
  const cap = Math.round(useWindowHeight() * (device === 'phone' ? 0.7 : 0.75))
  const known = `${art.id}:${htmlOf(art, v)}:${device}${full ? ':full' : ''}`
  const [h, setH] = useState(() => heights.get(known) ?? 96)
  // the version in the frame's address: a newer one with the same page only brings data, which goes in without a reload
  const [loaded, setLoaded] = useState(v)
  /** the version whose data is in the frame */
  const has = useRef(v)
  const last = useRef(0)
  const page = htmlOf(art, v)
  const pageLoaded = htmlOf(art, loaded)
  // it opens in the app's light or dark, and is told when that changes, without a reload
  const dark = useDark()
  const opened = useMemo(() => (isDark() ? 'dark' : 'light'), [loaded, full, device])
  const theme = dark ? 'dark' : 'light'
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ shepherdr: 'theme', theme }, '*')
  }, [theme])
  useEffect(() => {
    if (v === has.current) return
    if (page !== pageLoaded) {
      has.current = v
      return setLoaded(v)
    }
    has.current = v
    fetch(frameUrl(art.id, v, false, device, '/data'))
      .then((r) => r.json())
      .then((r: { data?: unknown }) => has.current === v && ref.current?.contentWindow?.postMessage({ shepherdr: 'data', data: r.data ?? null }, '*'))
      .catch(() => has.current === v && setLoaded(v))
  }, [art.id, v, page, pageLoaded, device])
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || !e.data || typeof e.data !== 'object') return
      const d = e.data as { shepherdr?: string; h?: number; stuck?: boolean; grows?: boolean; text?: string; url?: string; more?: boolean } & Pick
      if (d.shepherdr === 'more') onMore?.(!!d.more)
      if (d.shepherdr === 'height' && d.h) {
        // one that grows with its frame (100vh) starts from scratch each time, so it settles the same each time
        if (d.stuck) heights.delete(known)
        else if (!d.grows) heights.set(known, d.h)
        setH(d.h)
      }
      // a page speaks for you only right after you tapped or typed in it: the browser's own mark of a person's touch,
      // which no script can make; at most once every two seconds, and on one line (it can't write a chat line of its own)
      if (d.shepherdr === 'send' && typeof d.text === 'string' && d.text.trim() && touchedNow(ref.current) && Date.now() - last.current > 2000) {
        last.current = Date.now()
        const text = d.text.replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, 2000)
        act({ type: 'artifact-send', place: art.place, artifact: art.id, v, text })
          .then((r: { to?: string }) => ref.current?.contentWindow?.postMessage({ shepherdr: 'sent', text, to: r?.to }, '*'))
          .catch(() => undefined)
      }
      // a web link opens in a tab of its own, from a tap in the page, never with this app as its opener
      if (d.shepherdr === 'open' && typeof d.url === 'string' && /^https?:\/\//i.test(d.url) && touchedNow(ref.current)) window.open(d.url, '_blank', 'noopener,noreferrer')
      if (d.shepherdr === 'pick' && markup && onPick) onPick({ text: d.text ?? '', selector: d.selector, component: d.component, x: d.x, y: d.y })
    }
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [art.id, art.place, v, known, markup, onPick, onMore])
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ shepherdr: 'markup', on: !!markup }, '*')
  }, [markup])
  // a fixed-size design fits whole within the cap
  useEffect(() => {
    if (!full) ref.current?.contentWindow?.postMessage({ shepherdr: 'cap', h: cap }, '*')
  }, [cap, full])
  return (
    <iframe
      ref={ref}
      title={art.title}
      sandbox="allow-scripts allow-forms"
      loading={full ? undefined : 'lazy'}
      src={frameUrl(art.id, loaded, !!full, device, '', opened)}
      onLoad={() => {
        if (theme !== opened) ref.current?.contentWindow?.postMessage({ shepherdr: 'theme', theme }, '*')
        if (markup) ref.current?.contentWindow?.postMessage({ shepherdr: 'markup', on: true }, '*')
        if (!full) ref.current?.contentWindow?.postMessage({ shepherdr: 'cap', h: cap }, '*')
        // newer data came while it was still loading (or loaded again): it gets that data now
        if (has.current !== loaded) {
          const want = has.current
          fetch(frameUrl(art.id, want, false, device, '/data'))
            .then((r) => r.json())
            .then((r: { data?: unknown }) => has.current === want && ref.current?.contentWindow?.postMessage({ shepherdr: 'data', data: r.data ?? null }, '*'))
            .catch(() => undefined)
        }
      }}
      className={clsx('block w-full border-0 bg-transparent', full && 'h-full')}
      style={full ? undefined : { height: Math.min(Math.max(h, 24), cap) }}
    />
  )
}

/** the newest post of an artifact in a chat shows it; earlier ones fold to a line, so a chat never repeats big frames */
function ArtifactCard({ msg, chat, from }: { msg: Message; chat: Chat; from: string }) {
  const snap = useSnap()!
  const post = msg.artifact
  if (!post) return null
  const art = snap.artifacts?.find((a) => a.id === post.id)
  const later = chat.messages.slice(chat.messages.indexOf(msg) + 1).some((m) => m.artifact?.id === post.id)
  // under the words it came with (a message of its own, on its own)
  const gap = msg.text && 'mt-2'
  if (!art)
    return (
      <div className={clsx(gap, 'flex max-w-full items-center gap-2 rounded-full px-3.5 py-2 text-[0.8125rem] text-fg3 shadow-[inset_0_0_0_1px_var(--line)] phone:text-[0.9375rem]')}>
        <PageIcon className={ic} />
        This artifact was deleted.
      </div>
    )
  if (later)
    return (
      <button
        type="button"
        onClick={() => openArtifact(art.id, post.v)}
        className={clsx(
          gap,
          'flex max-w-full items-center gap-2 rounded-full px-3.5 py-2 text-left text-[0.8125rem] text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover phone:min-h-11 phone:text-[0.9375rem]',
        )}
      >
        <PageIcon className={ic} />
        <b className="line-clamp-3 min-w-0 flex-1 font-medium break-words text-fg">{art.title}</b>
        <span className="shrink-0 text-fg3 tabular-nums">v{post.v} · newer below</span>
      </button>
    )
  return <ArtifactPanel art={art} you={msg.who === 'you'} from={msg.who === 'you' ? 'You' : from} className={gap} />
}

/** The newest post of an artifact: the whole width of the chat, the page edge to edge under one slim row (its title,
 *  version and Open). The row has the sender's bubble shade and the card a bubble's corners, the small one pointing at
 *  whoever sent it, so it reads as theirs as plainly as a bubble does. */
function ArtifactPanel({ art, you, from, className }: { art: Artifact; you: boolean; from: string; className?: string | false }) {
  const [more, setMore] = useState(false)
  const desktop = useUI((u) => u.device === 'desktop')
  return (
    <div
      data-card
      data-you={you ? '' : undefined}
      className={clsx(
        'relative w-full cursor-default overflow-hidden bg-bg',
        className,
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--line2)]',
        you ? 'rounded-bubble rounded-br-[6px]' : 'rounded-bubble rounded-bl-[6px]',
      )}
    >
      <div className={clsx('@container/card flex items-center gap-2 py-1 pr-1 pl-3 text-[0.75rem] text-fg2 phone:py-0 phone:text-[0.8125rem]', you ? 'bg-reply' : 'bg-bubble')}>
        <PageIcon className={ic} />
        <button type="button" onClick={(e) => (splitClick(e) ? openSplit({ kind: 'artifact', id: art.id }) : openArtifact(art.id))} className="min-w-0 flex-1 self-stretch py-1 text-left font-medium break-words text-fg">
          {/* a task's name in the title takes more than the narrow card's one line */}
          <span className="line-clamp-3 leading-4 phone:leading-[1.125rem]">{art.title}</span>
        </button>
        <span className="max-w-[55%] shrink-0 truncate tabular-nums">
          {/* a narrow card keeps its title: where it is from gives way */}
          <span className="phone:hidden @max-md/card:hidden">{from} · </span>v{art.v} · {art.when}
        </span>
        <IconButton label="Show in side panel" onClick={() => showInPanel(art.id)}>
          <PanelIcon className={ic} />
        </IconButton>
        {desktop ? (
          <IconButton label="Open in split view" onClick={() => openSplit({ kind: 'artifact', id: art.id })}>
            <SplitIcon className={ic} />
          </IconButton>
        ) : null}
        <IconButton label="Open full screen" onClick={() => openArtifact(art.id)}>
          <OpenIcon className={ic} />
        </IconButton>
      </div>
      <ArtifactFrame art={art} v={art.v} onMore={setMore} />
      {/* the page goes on below: it scrolls inside the card */}
      {more ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-bg to-transparent" /> : null}
    </div>
  )
}

/** An artifact full screen: the page has the room, its versions sit at the top, and the box at the bottom writes to
 *  its keeper (or, after a tap in Mark up, notes on what you picked). A newer version swaps in while you look. */
function Viewer() {
  const v = useUI((u) => u.viewer)
  const device = useUI((u) => u.device)
  const dict = useUI((u) => u.dict)
  const snap = useSnap()
  // what you write to its keeper, kept like any draft (talk to type writes it too)
  const draft = useDraftOf(v ? `art:${v.artifact}` : '')
  const art = v && snap?.artifacts?.find((a) => a.id === v.artifact)
  const [markup, setMarkup] = useState(false)
  const [pick, setPick] = useState<Pick | null>(null)
  const [menu, setMenu] = useState<'versions' | 'more' | 'delete' | null>(null)
  const [said, setSaid] = useState('')
  const [fresh, setFresh] = useState<number | null>(null)
  /** the latest version this viewer has shown, of which artifact */
  const seen = useRef<{ id: string; v: number } | null>(null)
  // a version no longer kept (the last 20 are) shows the latest, and says so
  const gone = !!(art && v?.v && !art.versions.some((x) => x.n === v.v))
  const shown = gone ? art?.v : (v?.v ?? art?.v)
  useEffect(() => {
    setMarkup(false)
    setPick(null)
    setMenu(null)
    setSaid('')
    setFresh(null)
  }, [v?.artifact])
  // following the latest: say so when a new version comes in
  useEffect(() => {
    if (!art) return
    const was = seen.current
    seen.current = { id: art.id, v: art.v }
    if (!v?.v && was?.id === art.id && art.v > was.v) setFresh(art.v)
  }, [art?.id, art?.v, v?.v])
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setFresh(null), 4000)
    return () => clearTimeout(t)
  }, [fresh])
  if (!v) return null
  const phone = device === 'phone'
  if (!art || !shown)
    return (
      <div role="dialog" aria-modal="true" aria-label="Artifact" className="fixed inset-0 z-40 grid place-items-center bg-black/35 p-6" onClick={closeArtifact}>
        <div className="rounded-box bg-bg px-5 py-4 shadow-dialog">{snap ? 'This artifact was deleted.' : 'Opening…'}</div>
      </div>
    )
  const key = `art:${art.id}`
  const text = draft ?? ''
  const setText = (t: string) => setDraft(key, t)
  const ver = art.versions.find((x) => x.n === shown)
  const send = async () => {
    const t = text.trim()
    if (!t) return
    const last = pick?.selector.split(' > ').pop() ?? ''
    const target = pick ? `${pick.text ? `"${pick.text.slice(0, 60)}" ` : ''}(${last}${pick.component ? ` in ${pick.component}` : ''})` : undefined
    const r = (await act(pick ? { type: 'artifact-note', place: art.place, artifact: art.id, v: shown, note: t, target } : { type: 'artifact-say', place: art.place, artifact: art.id, v: shown, text: t }).catch(() => ({ ok: false }))) as {
      ok?: boolean
      error?: string
    }
    if (r.ok === false) return setSaid(r.error ?? "That didn't go through. Try again.")
    setText('')
    setPick(null)
    setMarkup(false)
    setSaid("Sent. A new version shows here when it's in.")
  }
  const del = async () => {
    const r = (await act({ type: 'artifact-delete', place: art.place, artifact: art.id }).catch(() => ({ ok: false }))) as { ok?: boolean; error?: string } | undefined
    if (r?.ok === false) {
      setMenu(null)
      return setSaid(r.error ?? "Couldn't delete it. Try again.")
    }
    closeArtifact()
  }
  // round, like every header's buttons; grey circles on a phone
  const barBtn = phone ? 'rounded-full! bg-bubble' : 'rounded-full!'
  return (
    <ViewerShell label={art.title} phone={phone}>
      {/* the whole screen is the page's, but for a slim bar on top and the box to its keeper below */}
      <div className="flex w-full min-w-0 flex-col overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line pt-[calc(env(safe-area-inset-top)+--spacing(1))] pr-2 pb-1 pl-4 phone:gap-2 phone:px-3">
          <IconButton label="Close" onClick={closeArtifact} className={clsx(barBtn, 'desktop:hidden tablet:hidden')}>
            <XIcon className={ic} />
          </IconButton>
          {/* the title whole first, then the version and when, cut short; a phone's bar has room for them only under it */}
          <div className="flex min-w-0 flex-1 items-baseline gap-2 phone:flex-col phone:items-stretch phone:gap-0">
            <div className="line-clamp-2 min-w-0 font-semibold break-words phone:leading-5">{art.title}</div>
            <div className="min-w-0 shrink-[100] truncate text-xs text-fg2 tabular-nums phone:text-[0.8125rem]/4">
              v{shown} · {ver?.by ?? art.by} · {ver?.when ?? art.when}
            </div>
          </div>
          <div className="relative">
            <IconButton label="Versions" aria-haspopup="menu" aria-expanded={menu === 'versions'} className={clsx(barBtn, 'w-auto! px-2 gap-1 inline-flex!')} onClick={() => setMenu(menu === 'versions' ? null : 'versions')}>
              <ClockIcon className={ic} /><span className="phone:hidden">Version </span><span>v{shown}</span>
            </IconButton>
            {menu === 'versions' ? (
              <Popover onClose={() => setMenu(null)} label="Versions">
                <MenuLabel>Versions</MenuLabel>
                {art.versions.map((x) => (
                  <MenuItem
                    key={x.n}
                    role="menuitemradio"
                    aria-checked={x.n === shown}
                    icon={x.n === shown ? <CheckIcon className={ic} /> : <span className={ic} />}
                    hint={x.when}
                    onClick={() => {
                      setMenu(null)
                      setPick(null)
                      openArtifact(art.id, x.n === art.v ? undefined : x.n)
                    }}
                  >
                    <span className="block min-w-0 truncate">
                      v{x.n}
                      {x.n === art.v ? ' · latest' : ''}
                      {x.note ? ` · ${x.note}` : x.what === 'data' ? ' · new data' : x.what === 'title' ? ' · new title' : ''}
                    </span>
                  </MenuItem>
                ))}
              </Popover>
            ) : null}
          </div>
          <IconButton
            label={markup ? 'Done marking up' : 'Mark up'}
            pressed={markup}
            className={clsx(barBtn, 'w-auto! px-2 gap-1 inline-flex! aria-pressed:bg-[color-mix(in_srgb,var(--accent)_16%,var(--bg))]')}
            onClick={() => {
              setMarkup(!markup)
              if (markup) setPick(null)
            }}
          >
            <MarkUpIcon /><span className="phone:hidden">{markup ? 'Done' : 'Mark up'}</span>
          </IconButton>
          <div className="relative">
            <IconButton label="More" aria-haspopup="menu" aria-expanded={menu === 'more' || menu === 'delete'} className={barBtn} onClick={() => setMenu(menu ? null : 'more')}>
              <MoreIcon className={ic} />
            </IconButton>
            {menu === 'more' || menu === 'delete' ? (
              <Popover onClose={() => setMenu(null)} label="More">
                <MenuLabel>Made in {placeOf(snap!, art.place).name}</MenuLabel>
                <MenuSeparator />
                {menu === 'more' ? (
                  <MenuItem icon={<PanelIcon className={ic} />} onClick={() => showInPanel(art.id)}>
                    {phone ? 'Show in Artifacts tab' : 'Show in side panel'}
                  </MenuItem>
                ) : null}
                {menu === 'more' && device === 'desktop' ? (
                  <MenuItem icon={<SplitIcon className={ic} />} onClick={() => openSplit({ kind: 'artifact', id: art.id })}>
                    Open in split view
                  </MenuItem>
                ) : null}
                {menu === 'more' ? (
                  <MenuItem className="text-need!" onClick={() => setMenu('delete')}>
                    Delete artifact
                  </MenuItem>
                ) : (
                  <MenuItem className="text-need!" onClick={del}>
                    Delete “{art.title}” for good
                  </MenuItem>
                )}
              </Popover>
            ) : null}
          </div>
          {/* beside the chat, at the side panel's width, to keep chatting while you look */}
          <IconButton label="Show in side panel" onClick={() => showInPanel(art.id)} className="rounded-full! phone:hidden">
            <PanelIcon className={ic} />
          </IconButton>
          <IconButton label="Close" onClick={closeArtifact} className="rounded-full! phone:hidden">
            <XIcon className={ic} />
          </IconButton>
        </div>
        {gone ? (
          <div className="shrink-0 bg-well px-4 py-1.5 text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">v{v.v} is no longer kept, only the last 20 versions are. This is the latest.</div>
        ) : v.v && v.v !== art.v ? (
          <div className="flex shrink-0 items-center gap-2 bg-well px-4 py-1.5 text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">
            <span className="min-w-0 flex-1 truncate">An older version: v{v.v} of {art.v}.</span>
            <button type="button" className="shrink-0 font-medium text-focus hover:underline" onClick={() => openArtifact(art.id)}>
              Show the latest
            </button>
          </div>
        ) : null}
        <div className={clsx('relative min-h-0 flex-1', markup && 'cursor-crosshair outline-2 -outline-offset-[6px] outline-focus outline-dashed')}>
          <div className="absolute inset-0">
            <ArtifactFrame art={art} v={shown} full markup={markup} onPick={(p) => setPick(p)} />
          </div>
          {pick ? <MarkBadge x={pick.x} y={pick.y} /> : null}
          {fresh ? (
            <div role="status" className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-fg px-3 py-1 text-[0.8125rem] font-medium text-bg shadow-toast phone:text-[0.9375rem]">
              Updated to v{fresh}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-line px-3 pt-2 pb-[max(env(safe-area-inset-bottom),--spacing(2))]">
          {pick ? (
            <div className="flex items-center gap-1.5 pb-1.5 text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
              <span className="min-w-0 flex-1 truncate">
                A note on <b className="font-medium text-fg">{pick.text ? `“${pick.text.slice(0, 40)}”` : 'what you picked'}</b>
              </span>
              <button type="button" className="shrink-0 font-medium text-focus hover:underline" onClick={() => setPick(null)}>
                Not on that
              </button>
            </div>
          ) : said ? (
            <div role="status" className="pb-1.5 text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
              {said}
            </div>
          ) : markup ? (
            <div className="pb-1.5 text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{device === 'desktop' ? 'Click' : 'Tap'} what should change.</div>
          ) : null}
          {/* the chat's message box: a pill, the same round buttons */}
          <div className="round-box flex items-end gap-1 bg-bg p-1.5 pl-3.5 shadow-box has-[textarea:focus]:shadow-box-focus phone:pl-4">
            {dict === key ? (
              <DictationBox />
            ) : (
              <>
                <TextBox
                  label={pick ? 'Note' : `Message ${art.keeper}`}
                  data-chat={key}
                  value={text}
                  onChange={(t) => {
                    setText(t)
                    if (said) setSaid('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !phone) {
                      e.preventDefault()
                      send()
                    }
                    // the box lets go first; Esc again closes the viewer
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                  placeholder={pick ? 'What should change?' : phone ? 'Ask for a change…' : `Ask ${art.keeper} for a change…`}
                  className="max-h-40 min-h-[34px] min-w-0 flex-1 bg-transparent py-[7px] outline-none placeholder:text-fg3 phone:min-h-11 phone:py-2.5 phone:text-[1rem]"
                />
                {canDictate() ? (
                  <IconButton label="Talk to type" className={roundBtn} onClick={() => toggleDictation(key)}>
                    <MicIcon className={ic} />
                  </IconButton>
                ) : null}
                <button
                  type="button"
                  aria-label={pick ? 'Send the note' : 'Send'}
                  disabled={!text.trim()}
                  onClick={send}
                  className={clsx('press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-fg text-bg after:absolute after:-inset-1.5 phone:size-11', dimmed)}
                >
                  <UpIcon className={ic} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </ViewerShell>
  )
}

/** the viewer over the whole screen: it pushes in on a phone and fades in wider, takes the focus and keeps Tab in it,
 *  and gives the focus back when it closes */
function ViewerShell({ label, phone, children }: { label: string; phone: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useMotion(ref, phone ? 'page' : 'fade')
  // a phone has no keyboard to move: nothing takes the focus there (it would only show a ring)
  useDialogFocus(ref, { focus: !phone })
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40 flex bg-bg">
      {children}
    </div>
  )
}

function Popover({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Menu label={label} onClose={onClose} className="absolute top-full right-0 z-21 mt-1.5 max-h-[60dvh] w-max max-w-[min(320px,calc(100vw-24px))] origin-top-right overflow-y-auto">
      {children}
    </Menu>
  )
}

/** The check's picture of it, in the screen's own theme */
function Thumb({ art }: { art: Artifact }) {
  const [broken, setBroken] = useState(false)
  const dark = useDark()
  const box = 'h-9 w-12 shrink-0 overflow-hidden rounded-row bg-well outline-1 -outline-offset-1 outline-line2 phone:h-11 phone:w-14'
  if (!art.thumb || broken)
    return (
      <span className={clsx(box, 'grid place-items-center text-fg3')}>
        <PageIcon className={ic} />
      </span>
    )
  const url = (dark: boolean) => `api/artifacts/${encodeURIComponent(art.id)}/thumb?v=${art.v}${dark ? '&dark=1' : ''}`
  return (
    <span className={box}>
      <img src={url(dark)} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover object-top" />
    </span>
  )
}

/** The lists' artifacts, newest first: what their chips hold (placeId, the place picked, is for plugins of old) */
function ArtifactList(_: { placeId: string }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const open = useUI((u) => u.viewer?.artifact)
  const value = useUI((u) => u.filter[`${view.search}|artifacts`] ?? '')
  const q = useUI((u) => filterOf(u, view.search, 'artifacts'))
  // its key, where there is a keyboard
  const keys = useUI((u) => u.device === 'desktop' || u.kb)
  // one space shown: its own artifacts need no name of where they are
  const one = view.level === 2 ? snap.places.find((p) => p.id === view.chips[0]) : undefined
  const key = `list:${view.key}`
  // one shown in the panel, from anywhere, takes the list's place
  const shown = useShown(key)
  const all = artifactsIn(snap, view)
  const whereOf = (a: Artifact) => {
    const at = placeOf(snap, a.place)
    return a.place !== one?.id && at.id === a.place ? at.name : null
  }
  // by its title, the task (or coordinator) that made it, and the place it lives in
  const list = q ? all.filter((a) => matches(q, a.title, a.by, whereOf(a) ?? undefined)) : all
  if (shown)
    return (
      <PanelArtifact
        art={shown}
        onBack={() => setShown(key, null)}
        // closed, the panel goes back to what shows beside the chat most: the tasks (a phone's chat)
        onClose={() => {
          setShown(key, null)
          setUI((u) => (u.device === 'phone' ? { tab: 'chat' } : { side: 'tasks' }))
        }}
      />
    )
  if (!all.length && !q)
    return (
      <>
        <ListChips alone />
        <Empty className="pt-3">No artifacts yet. Ask {one ? one.name : 'a coordinator'} for one: a report, a dashboard, a draft screen. Every agent can make them.</Empty>
      </>
    )
  return (
    <>
      <FilterBox
        label="Filter artifacts"
        hint={keys ? 'F' : undefined}
        value={value}
        onChange={(v) => setFilter(view.search, 'artifacts', v)}
        onKey={(e) => {
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault()
            openArtifact(list[0].id)
          }
        }}
      >
        <ListChips />
      </FilterBox>
      {list.length ? (
        <List className="pt-1">
          {list.map((a) => {
            const where = whereOf(a)
            return (
              <Row key={a.id} two sel={open === a.id} onActivate={() => openArtifact(a.id)} className="gap-3! py-2!">
                <Thumb art={a} />
                <RowText
                  sub={
                    <>
                      {where ? <span className="text-fg3">{where} · </span> : null}
                      v{a.v} · {a.by} · {a.when}
                    </>
                  }
                >
                  <span className="line-clamp-3 whitespace-normal break-words">{a.title}</span>
                </RowText>
              </Row>
            )
          })}
        </List>
      ) : (
        <Empty className="pt-3 text-fg3">No artifacts match “{q}”. Try another search or change the filters.</Empty>
      )}
    </>
  )
}

/** A chat's artifacts, newest first: the ones it made or updated, and any posted in it */
function useChatArtifacts(chatKey: string) {
  const all = useSnap()?.artifacts
  const chat = useChat(chatKey)
  return useMemo(() => {
    const posted = new Set(chat?.messages.flatMap((m) => (m.artifact ? [m.artifact.id] : [])))
    return (all ?? []).filter((a) => a.chats?.includes(chatKey) || posted.has(a.id))
  }, [all, chat, chatKey])
}

/** The artifacts of one chat, from its ⋯: a task's in its side panel, a coordinator's in place of its chat */
function ChatArtifacts({ chatKey }: { chatKey: string }) {
  const list = useChatArtifacts(chatKey)
  const open = useUI((u) => u.viewer?.artifact)
  if (!list.length) return <Empty className="pt-3">No artifacts in this chat yet. Ask for one: a report, a dashboard, a draft screen.</Empty>
  return (
    <List className="pt-1.5">
      {list.map((a) => (
        <Row key={a.id} two sel={open === a.id} onActivate={() => openArtifact(a.id)} className="gap-3! py-2!">
          <Thumb art={a} />
          <RowText
            sub={
              <>
                v{a.v} · {a.when}
              </>
            }
          >
            <span className="line-clamp-3 whitespace-normal break-words">{a.title}</span>
          </RowText>
        </Row>
      ))}
    </List>
  )
}

/** A coordinator chat flipped to its artifacts: the list, and the way back to the chat */
function PlaceArtifacts({ chatKey }: { chatKey: string }) {
  return (
    <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-[720px] pb-4">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 phone:px-5">
          <h2 className="text-[0.8125rem] font-medium text-fg2 phone:text-[0.9375rem]">Artifacts in this chat</h2>
          <Ghost onClick={() => setUI({ arts: null })}>Back to the chat</Ghost>
        </div>
        <ChatArtifacts chatKey={chatKey} />
      </div>
    </div>
  )
}

/** Artifacts in a coordinator's ⋯, under Terminal: greyed while its chat has none, and opens all the same, to say so */
function PlaceArtifactsItem({ place }: { place: { chat: string } }) {
  const on = useUI((u) => u.arts === place.chat)
  const off = !on && !useChatArtifacts(place.chat).length
  return (
    <MenuItem
      icon={<PageIcon className={ic} />}
      data-off={off ? '' : undefined}
      className={clsx(off && 'text-fg3')}
      onClick={() => setUI({ arts: on ? null : place.chat, term: null, menu: false, plus: null, pick: null })}
    >
      {on ? 'Back to the chat' : 'Artifacts'}
    </MenuItem>
  )
}

/** a task's Artifacts tab: its chat's, or one shown in the panel */
function TaskArtifacts({ chatKey }: { chatKey: string }) {
  const key = `chat:${chatKey}`
  const shown = useShown(key)
  const device = useUI((u) => u.device)
  if (!shown) return <ChatArtifacts chatKey={chatKey} />
  return <PanelArtifact art={shown} onBack={() => setShown(key, null)} onClose={() => (setShown(key, null), device === 'desktop' ? togglePanel() : closeSheet())} />
}

/** a task's side panel item: greyed while its chat has none and none is shown there */
function useTaskOff(task: Task) {
  const none = !useChatArtifacts(task.agent?.chat ?? '').length
  const shown = useShown(`chat:${task.agent?.chat ?? ''}`)
  return none && !shown ? `${task.id}'s chat has no artifacts yet.` : null
}

export default definePlugin({
  name: 'artifacts',
  setup(reg) {
    reg.views.artifacts = ArtifactList
    reg.views.artifact = SplitArtifact
    reg.taskPanel.push({ id: 'artifacts', order: 60, label: 'Artifacts', Icon: PageIcon, useOff: useTaskOff, View: TaskArtifacts })
    reg.placeMenu.push({ order: 70, joined: true, View: PlaceArtifactsItem })
    reg.chatBody.push({ when: (ui, key) => ui.arts === key && ui.term !== key, View: PlaceArtifacts })
    reg.keys.push({
      order: 0,
      // Esc goes back from a coordinator's artifacts to its chat
      handle: ({ e, ui }) => {
        if (!ui.arts || e.key !== 'Escape' || ui.viewer || ui.menu || (e.target as HTMLElement | null)?.closest?.('input, textarea, [role=menu]')) return false
        e.preventDefault()
        setUI({ arts: null })
        return true
      },
    })
    reg.messageParts.push({ order: 50, View: ArtifactCard })
    reg.overlays.push(Viewer)
  },
})
