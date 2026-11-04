// Artifacts any agent makes (shepherdr artifact): a card in the chat where it was made, in a sealed frame; full screen
// on a tap, with its versions, Mark up and a box to write to its keeper, so you change it by chatting beside it; and a
// list per place, and one per chat (its ⋯ → Artifacts). A newer version swaps in live: only its data changed, the page takes the new data without a reload.
// Shown in the side panel, it fills a place's Artifacts list (or a task's Artifacts tab) beside the chat.
import clsx from 'clsx'
import { Recipe } from '@client/screens/Recipe.tsx'
import * as R from '@core/recipe.js'
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
import { DictationBox, toggleDictation, useChat } from '@plugins/chat/client.tsx'
import { canDictate } from '@client/dictation.ts'
import { useDialogFocus } from '@client/focus.ts'
import { useMotion } from '@client/motion.ts'
import { isDark, useDark } from '@client/theme.ts'
import {
  BackIcon,
  NextIcon,
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

const { withIds, blockName } = R as any

export type Pick = { text: string; selector: string; component?: string; x: number; y: number }

const frameUrl = (id: string, v: number, full: boolean, device: string, part = '', theme = '') =>
  `api/artifacts/${encodeURIComponent(id)}${part}?v=${v}${full ? '&full=1' : ''}&device=${device}${theme ? `&theme=${theme}` : ''}`

/** how long ago, as the window says it: "just now", "5m ago", "2h ago", "3d ago" */
export function ago(ms: number) {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}

/** which version, who made it and when: "v3 · Claude Code · 2h ago" (the window's) */
const detailOf = (a: Artifact) => [`v${a.v}`, a.by, a.at ? ago(a.at) : null].filter(Boolean).join(' · ')

/** the version stepper the window's artifact bars have: ‹ v2 of 5 ›, then "· Latest ›" while an older one shows */
function Stepper({ art, shown, onStep }: { art: Artifact; shown: number; onStep: (n: number | undefined) => void }) {
  const kept = [...art.versions.map((x) => x.n)].sort((a, b) => a - b)
  const latest = art.v
  const older = shown < latest
  const prev = kept.filter((n) => n < shown).pop()
  const next = kept.find((n) => n > shown)
  const me = art.versions.find((x) => x.n === shown)
  if (kept.length <= 1 && !older) return <div className="shrink-0 text-xs text-fg2 tabular-nums phone:text-[0.8125rem]">v{shown}{me?.when ? ` · ${me.when}` : ''}</div>
  return (
    <div className="flex shrink-0 items-center text-xs tabular-nums phone:text-[0.8125rem]">
      <IconButton label={prev ? `v${prev}` : 'No older version'} disabled={!prev} className="rounded-full! disabled:opacity-40" onClick={() => prev && onStep(prev)}>
        <BackIcon className={ic} />
      </IconButton>
      <span className={clsx('px-0.5', older ? 'text-fg' : 'text-fg2')}>v{shown} of {latest}</span>
      <IconButton label={next ? `v${next}` : 'No newer version'} disabled={!next} className="rounded-full! disabled:opacity-40" onClick={() => next && onStep(next === latest ? undefined : next)}>
        <NextIcon className={ic} />
      </IconButton>
      {older ? (
        <>
          <span className="px-1 text-fg3">·</span>
          <button type="button" className="press-dim rounded-full px-1.5 py-1 font-medium text-focus hover:bg-hover" onClick={() => onStep(undefined)}>Latest ›</button>
        </>
      ) : null}
    </div>
  )
}

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
  if (ui.viewer) closeArtifact()
  setShown(`list:${listView(ui, snap).key}`, id)
  setUI(ui.device === 'phone' ? { task: null, tab: 'artifacts', pick: null, plus: null, menu: false } : { task: ui.task && !taskInMiddle(ui, snap) ? null : ui.task, side: 'artifacts' })
}

/** Mark up from the side panel: the viewer opens marking up (a phone's or browser's frame is too small to mark in) */
let markOnOpen = false

/** An artifact in the side panel, under the window's sidebar bar: ‹ Artifacts back to the list, its title, which
 *  version (‹ v2 of 5 ›, · Latest ›), and Mark up, which opens it full screen to mark it up there */
function PanelArtifact({ art, onBack }: { art: Artifact; onBack: () => void }) {
  const [v, setV] = useState<number | undefined>(undefined)
  const shown = v && art.versions.some((x) => x.n === v) ? v : art.v
  return (
    <div role="region" aria-label={art.title} className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line py-1 pr-2 pl-1 coarse:py-0.5">
        <button type="button" onClick={onBack} className="press-dim flex h-8 shrink-0 items-center gap-0.5 rounded-full pr-2 pl-1 text-[0.8125rem] text-fg2 hover:bg-hover hover:text-fg phone:h-11 phone:text-[0.9375rem]">
          <BackIcon className={ic} />
          Artifacts
        </button>
        <div className="min-w-0 flex-1 truncate font-semibold">{art.title}</div>
        <Stepper art={art} shown={shown} onStep={setV} />
        <Ghost onClick={() => { markOnOpen = true; openArtifact(art.id, shown === art.v ? undefined : shown) }} className="shrink-0">
          <MarkUpIcon /> Mark up
        </Ghost>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <ArtifactFrame art={art} v={shown} full />
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

/** Shepherdr 3.1: a recipe artifact is drawn here as the web's own HTML (Recipe.tsx); an older one made for the Herdr
 *  window says so; a 2.1 page (none here now) still has its frame. */
export function ArtifactFrame(p: Parameters<typeof PageFrame>[0]) {
  if (p.art.kind === 'recipe') return <RecipeFrame {...p} />
  if (p.art.kind === 'gpui') return <WindowOnly />
  return <PageFrame {...p} />
}

/** A recipe of the version shown, its pictures from the service; in Mark up a tap on a block points at it. */
function RecipeFrame({ art, v, full, markup, onPick }: Parameters<typeof PageFrame>[0]) {
  const [recipe, setRecipe] = useState<{ blocks: unknown[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    setRecipe(null)
    fetch(`api/artifacts/${encodeURIComponent(art.id)}/recipe?v=${v}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gone'))))
      .then((r) => !gone && setRecipe(withIds(r)), () => !gone && setError("This version can't be read."))
    return () => { gone = true }
  }, [art.id, v])
  if (error) return <p className="p-4 text-fg3">{error}</p>
  if (!recipe) return <p className="p-4 text-fg3">Loading…</p>
  return (
    <div className={clsx('overflow-y-auto p-4 phone:p-5', full ? 'h-full' : 'max-h-[70dvh]')}>
      <Recipe recipe={recipe} asset={(src) => `api/artifacts/${encodeURIComponent(art.id)}/file/${src.split('/').map(encodeURIComponent).join('/')}?v=${v}`}
        reply={(text) => act({ type: 'artifact-send', place: art.place, artifact: art.id, v, text })}
        onNote={markup && onPick ? (b: any) => onPick({ text: blockName(b), selector: `[data-block="${b.id}"]`, x: 0, y: 0 }) : undefined} />
    </div>
  )
}

/** made before recipes, for the Herdr window only */
function WindowOnly() {
  return <p className="p-4 text-pretty text-fg3">Made for the Herdr window: open it there.</p>
}

/** An artifact's page in a sealed frame: scripts and forms run, never with this app's origin, and it loads nothing. */
function PageFrame({
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
function ArtifactCard({ msg, chat }: { msg: Message; chat: Chat; from: string }) {
  const snap = useSnap()!
  const post = msg.artifact
  if (!post) return null
  const art = snap.artifacts?.find((a) => a.id === post.id)
  const later = chat.messages.slice(chat.messages.indexOf(msg) + 1).some((m) => m.artifact?.id === post.id)
  // under the words it came with (a message of its own, on its own)
  const gap = msg.text && 'mt-2'
  if (!art)
    return (
      <div className={clsx(gap, 'flex max-w-full items-center gap-1.5 text-[0.75rem] text-fg3 phone:text-[0.8125rem]')}>
        <PageIcon className={ic} />
        This artifact was deleted.
      </div>
    )
  // an earlier publish of it: a quiet line, as the window's chat ("Published <title> v2"), that opens that version
  if (later)
    return (
      <button type="button" onClick={() => openArtifact(art.id, post.v)}
        className={clsx(gap, 'press-dim flex max-w-full items-center gap-1.5 rounded-row text-left text-[0.75rem] text-fg3 hover:bg-hover hover:text-fg2 phone:min-h-11 phone:text-[0.8125rem]')}>
        <PageIcon className={ic} />
        <span className="min-w-0 truncate">Published {art.title} v{post.v}</span>
      </button>
    )
  // its latest publish: the window's card, its title, "Artifact · v3" and Open
  return (
    <button type="button" data-card onClick={(e) => (splitClick(e) ? openSplit({ kind: 'artifact', id: art.id }) : openArtifact(art.id))}
      className={clsx(gap, 'press flex w-full max-w-[420px] items-center gap-2.5 rounded-box bg-bubble px-2.5 py-2 text-left shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover')}>
      <span className="grid size-8 shrink-0 place-items-center rounded-row bg-bg text-fg2 phone:size-10">
        <PageIcon className={ic} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{art.title}</span>
        <span className="text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]">Artifact · v{post.v}</span>
      </span>
      <span className="grid h-7 shrink-0 place-items-center rounded-row bg-bg px-2.5 text-[0.8125rem] font-medium shadow-[inset_0_0_0_1px_var(--line2)] phone:h-9">Open</span>
    </button>
  )
}

/** An artifact full screen: the page has the room, its versions sit at the top, and the box at the bottom writes to
 *  its keeper (or, after a tap in Mark up, notes on what you picked). A newer version swaps in while you look. */
function Viewer() {
  const v = useUI((u) => u.viewer)
  const device = useUI((u) => u.device)
  const snap = useSnap()
  const art = v && snap?.artifacts?.find((a) => a.id === v.artifact)
  const [markup, setMarkup] = useState(false)
  const [pick, setPick] = useState<Pick | null>(null)
  const [text, setText] = useState('')
  const [said, setSaid] = useState('')
  const [failed, setFailed] = useState(false)
  const [sending, setSending] = useState(false)
  // a version no longer kept (the last 20 are) shows the latest
  const shown = art && v?.v && art.versions.some((x) => x.n === v.v) ? v.v : art?.v
  useEffect(() => {
    // Mark up from the side panel opens it marking up
    setMarkup(markOnOpen)
    markOnOpen = false
    setPick(null)
    setText('')
    setSaid('')
  }, [v?.artifact])
  if (!v) return null
  const phone = device === 'phone'
  if (!art || !shown)
    return (
      <div role="dialog" aria-modal="true" aria-label="Artifact" className="fixed inset-0 z-40 grid place-items-center bg-black/35 p-6" onClick={closeArtifact}>
        <div className="rounded-box bg-bg px-5 py-4 shadow-dialog">{snap ? 'This artifact was deleted.' : 'Opening…'}</div>
      </div>
    )
  const keeper = art.keeper || 'the agent'
  // Mark up's Send, as the window's: to the agent that keeps it, about the marked spot or all of it
  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    const last = pick?.selector.split(' > ').pop() ?? ''
    const target = pick ? `${pick.text ? `"${pick.text.slice(0, 60)}" ` : ''}(${last}${pick.component ? ` in ${pick.component}` : ''})` : undefined
    setSending(true)
    setFailed(false)
    setSaid('Sending…')
    const r = (await act(pick ? { type: 'artifact-note', place: art.place, artifact: art.id, v: shown, note: t, target } : { type: 'artifact-say', place: art.place, artifact: art.id, v: shown, text: t }).catch(() => ({ ok: false }))) as {
      ok?: boolean
      error?: string
    }
    setSending(false)
    if (r.ok === false) {
      setFailed(true)
      return setSaid(r.error ?? "That didn't go through. Try again.")
    }
    setText('')
    setPick(null)
    setSaid(`Sent to ${keeper}. A new version shows here when it's in.`)
  }
  const line = said || (pick ? 'A note on the marked spot.' : `${device === 'desktop' ? 'Click' : 'Tap'} a spot, or write to ${keeper} about all of it.`)
  // round, like every header's buttons; grey circles on a phone
  const barBtn = phone ? 'rounded-full! bg-bubble' : 'rounded-full!'
  return (
    <ViewerShell label={art.title} phone={phone}>
      {/* the whole screen is the page's, but for a slim bar on top (the window's artifact viewer bar) */}
      <div className="flex w-full min-w-0 flex-col overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line pt-[calc(env(safe-area-inset-top)+--spacing(1))] pr-2 pb-1 pl-4 phone:gap-2 phone:px-3">
          <PageIcon className={clsx(ic, 'shrink-0 text-fg2 phone:hidden')} />
          <div className="min-w-0 flex-1 truncate font-semibold">{art.title}</div>
          <Stepper art={art} shown={shown} onStep={(n) => { setPick(null); openArtifact(art.id, n) }} />
          <IconButton
            label={markup ? 'Done' : 'Mark up'}
            pressed={markup}
            className={clsx(barBtn, 'w-auto! px-2 gap-1 inline-flex! aria-pressed:bg-[color-mix(in_srgb,var(--accent)_16%,var(--bg))]')}
            onClick={() => {
              setMarkup(!markup)
              setPick(null)
              setSaid('')
            }}
          >
            <MarkUpIcon /><span className="phone:hidden">{markup ? 'Done' : 'Mark up'}</span>
          </IconButton>
          {/* beside the chat, in the Artifacts panel */}
          {phone ? null : (
            <IconButton label="Open in sidebar" onClick={() => showInPanel(art.id)} className="rounded-full!">
              <PanelIcon className={ic} />
            </IconButton>
          )}
          <IconButton label="Close" onClick={closeArtifact} className={barBtn}>
            <XIcon className={ic} />
          </IconButton>
        </div>
        <div className={clsx('relative min-h-0 flex-1', markup && 'cursor-crosshair outline-2 -outline-offset-[6px] outline-focus outline-dashed')}>
          <div className="absolute inset-0">
            <ArtifactFrame art={art} v={shown} full markup={markup} onPick={(p) => { setPick(p); setSaid('') }} />
          </div>
          {pick ? <MarkBadge x={pick.x} y={pick.y} /> : null}
          {markup ? (
            // the window's markup card: what it's about, Clear spot, the note and Send
            <div className="absolute inset-x-2.5 bottom-[max(env(safe-area-inset-bottom),--spacing(2.5))] flex flex-col gap-1.5 rounded-box bg-bg p-2 shadow-dialog">
              <div className="flex items-start gap-2 px-0.5 text-[0.75rem] phone:text-[0.8125rem]">
                <p className={clsx('min-w-0 flex-1 text-pretty', failed ? 'text-need-fg' : 'text-fg2')} role={said ? 'status' : undefined}>{line}</p>
                {pick && !said ? (
                  <button type="button" className="shrink-0 font-medium text-focus hover:underline" onClick={() => setPick(null)}>Clear spot</button>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <TextBox
                  label="Note"
                  value={text}
                  onChange={(t) => {
                    setText(t)
                    if (said && !sending) setSaid('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !phone) {
                      e.preventDefault()
                      void send()
                    }
                    // Esc drops the spot, then ends marking up
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      if (pick) setPick(null)
                      else setMarkup(false)
                    }
                  }}
                  placeholder="What should change?"
                  className="max-h-32 min-h-8 min-w-0 flex-1 rounded-row bg-bg px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--line2)] outline-none placeholder:text-fg3 focus:shadow-[inset_0_0_0_1.5px_var(--focus)] phone:min-h-11 phone:text-[1rem]"
                />
                <button
                  type="button"
                  aria-label="Send"
                  disabled={!text.trim() || sending}
                  onClick={() => void send()}
                  className={clsx('press-dim relative grid size-8 shrink-0 place-items-center rounded-row bg-fg text-bg after:absolute after:-inset-1.5 phone:size-11', dimmed)}
                >
                  <UpIcon className={ic} />
                </button>
              </div>
            </div>
          ) : null}
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



/** "All" in the list's bar: every folder's artifacts, or the shown space's (the window's toggle), kept on this device */
const ALL = 'shepherdr.artifactsAll'
let allOn = (() => { try { return localStorage.getItem(ALL) === '1' } catch { return false } })()
const allListeners = new Set<() => void>()
function setAll(on: boolean) {
  allOn = on
  try { localStorage.setItem(ALL, on ? '1' : '0') } catch { /* private window */ }
  allListeners.forEach((l) => l())
}

/** The Artifacts panel, as the window's: "Artifacts", the space's folder or All folders, the All toggle, "Filter
 *  artifacts" (F), and each artifact with "v3 · its maker · 2h ago" ("Open · " while it shows); newest first */
function ArtifactList(_: { placeId: string }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const place = useUI((u) => u.place)
  const open = useUI((u) => u.viewer?.artifact)
  const all = useSyncExternalStore((l) => (allListeners.add(l), () => void allListeners.delete(l)), () => allOn)
  const value = useUI((u) => u.filter[`${view.search}|artifacts`] ?? '')
  const q = useUI((u) => filterOf(u, view.search, 'artifacts')).trim()
  // its key, where there is a keyboard
  const keys = useUI((u) => u.device === 'desktop' || u.kb)
  const here = placeOf(snap, place)
  const key = `list:${view.key}`
  // one shown in the panel takes the list's place
  const shown = useShown(key)
  const items = (snap.artifacts ?? []).filter((a) => all || a.place === here.id).sort((a, b) => b.at - a.at)
  const folderOf = (a: Artifact) => placeOf(snap, a.place).name
  // by its title, who made it, and (with All) its folder
  const list = q ? items.filter((a) => matches(q, a.title, a.by, all ? folderOf(a) : undefined)) : items
  if (shown) return <PanelArtifact art={shown} onBack={() => setShown(key, null)} />
  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-2 phone:px-4">
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-fg3 phone:text-[0.9375rem]">{all ? 'All folders' : here.name}</span>
        <button type="button" aria-pressed={all} onClick={() => setAll(!all)}
          className="press-dim h-7 shrink-0 rounded-full px-2.5 text-[0.8125rem] font-medium text-fg2 hover:bg-hover hover:text-fg aria-pressed:bg-sel aria-pressed:text-fg coarse:h-9 phone:h-9 phone:text-[0.875rem]">
          All
        </button>
      </div>
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
      />
      {!items.length ? (
        <div className="flex flex-col items-center gap-1.5 px-5 pt-7 pb-4 text-center">
          <PageIcon className={clsx(ic, 'text-fg3')} />
          <p className="pt-1 font-medium">No artifacts.</p>
          <p className="max-w-64 text-[0.8125rem] text-pretty text-fg2 phone:text-[0.9375rem]">
            {all ? 'Reports, boards and forms agents make show here.' : `Reports, boards and forms agents make for ${here.name} show here. Ask an agent to make one.`}
          </p>
        </div>
      ) : list.length ? (
        <List className="pt-1">
          {list.map((a) => (
            <Row key={a.id} two sel={open === a.id} onActivate={() => openArtifact(a.id)} className="gap-3! py-2!">
              <PageIcon className={clsx(ic, 'mt-0.5 shrink-0 self-start', open === a.id ? 'text-focus' : 'text-fg3')} />
              <RowText sub={<>{open === a.id ? 'Open · ' : ''}{detailOf(a)}</>}>
                <span className="block truncate">{a.title}</span>
              </RowText>
              {all ? <span className="max-w-36 shrink-0 truncate self-start text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{folderOf(a)}</span> : null}
            </Row>
          ))}
        </List>
      ) : (
        <p className="px-5 pt-7 text-center text-[0.8125rem] text-fg3 phone:text-[0.9375rem]">No artifacts match “{q}”.</p>
      )}
    </>
  )
}

export default definePlugin({
  name: 'artifacts',
  setup(reg) {
    reg.views.artifacts = ArtifactList
    reg.views.artifact = SplitArtifact
    reg.messageParts.push({ order: 50, View: ArtifactCard })
    reg.overlays.push(Viewer)
  },
})
