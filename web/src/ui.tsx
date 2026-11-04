// Shared pieces every screen is built from. Heroicons Micro (16px) only; the voice wave and the muted
// microphone are the drawn icons.
import clsx from 'clsx'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, type RefObject, type TextareaHTMLAttributes } from 'react'
import { ChevronUpDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/16/solid'
import type { Status, Task, Report } from '@shared/types.ts'
import { TALKING, type Sample } from './meter.ts'
import { useMotion } from './motion.ts'

export {
  AdjustmentsHorizontalIcon as ModeIcon,
  BellSlashIcon,
  EnvelopeOpenIcon as ReadIcon,
  ArchiveBoxArrowDownIcon as ArchiveIcon,
  ArchiveBoxIcon as ArchivedIcon,
  ArchiveBoxXMarkIcon as UnarchiveIcon,
  ArrowDownTrayIcon as DownloadIcon,
  ArrowLeftIcon as PageBackIcon,
  ArrowRightIcon as PageForwardIcon,
  ArrowsPointingInIcon as UnfitIcon,
  ArrowsPointingOutIcon as FitIcon,
  ArrowPathIcon as ReloadIcon,
  ArrowPathRoundedSquareIcon as RestartIcon,
  ArrowTopRightOnSquareIcon as OpenIcon,
  ArrowUpIcon as UpIcon,
  ArrowUturnLeftIcon as ReplyIcon,
  BellIcon,
  BoltIcon as SpeedIcon,
  SignalIcon as EffortIcon,
  BookmarkIcon as PinTaskIcon,
  BookmarkSlashIcon as UnpinIcon,
  Bars3BottomLeftIcon as SelectIcon,
  Bars3Icon as MenuIcon,
  CameraIcon,
  ChatBubbleLeftIcon as ChatIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  ChevronDoubleLeftIcon as WidenIcon,
  ChevronDoubleRightIcon as NarrowIcon,
  ChevronDownIcon as DownIcon,
  ChevronLeftIcon as BackIcon,
  ChevronRightIcon as NextIcon,
  ChevronUpDownIcon as UpDownIcon,
  ClipboardDocumentListIcon as PlanIcon,
  Cog6ToothIcon as CogIcon,
  CommandLineIcon as TermIcon,
  CpuChipIcon as ModelIcon,
  DocumentDuplicateIcon as CopyIcon,
  DocumentIcon as FileIcon,
  EllipsisHorizontalIcon as MoreIcon,
  ExclamationCircleIcon as AlertIcon,
  FaceSmileIcon as SmileIcon,
  FolderIcon,
  FolderMinusIcon as RemoveProjectIcon,
  FolderOpenIcon,
  GlobeAltIcon as GlobeIcon,
  ListBulletIcon as TasksIcon,
  FunnelIcon as KeepFiltersIcon,
  MagnifyingGlassIcon as SearchIcon,
  MicrophoneIcon as MicIcon,
  MinusCircleIcon,
  MinusIcon,
  PauseIcon,
  PencilIcon as RenameIcon,
  PhoneXMarkIcon as EndCallIcon,
  PlusIcon,
  PuzzlePieceIcon as PluginIcon,
  QuestionMarkCircleIcon as QuestionIcon,
  RocketLaunchIcon as AutopilotIcon,
  ServerStackIcon as MachineIcon,
  StopIcon,
  SunIcon as AppearanceIcon,
  TrashIcon as DeleteIcon,
  ViewColumnsIcon as SplitIcon,
  WindowIcon as PageIcon,
  XCircleIcon,
  XMarkIcon as XIcon,
} from '@heroicons/react/16/solid'

/** Voice waveform: no Heroicon exists for it */
export function WaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-none stroke-current', className)} strokeWidth={1.6} strokeLinecap="round">
      <path d="M2.5 7v2M5 5v6M8 3v10M11 5v6M13.5 7v2" />
    </svg>
  )
}

/** A muted microphone: the Heroicon microphone, struck through. No Heroicon exists for it */
export function MicOffIcon({ className }: { className?: string }) {
  const gap = useId()
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <mask id={gap}>
        <rect width="16" height="16" fill="white" />
        <path d="M2 2l12 12" stroke="black" strokeWidth={3.5} />
      </mask>
      <g mask={`url(#${CSS.escape(gap)})`}>
        <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2Z" />
        <path d="M4.5 7A.75.75 0 0 0 3 7a5.001 5.001 0 0 0 4.25 4.944V13.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.556A5.001 5.001 0 0 0 13 7a.75.75 0 0 0-1.5 0 3.5 3.5 0 1 1-7 0Z" />
      </g>
      <path d="M2.5 2.5l11 11" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

/** A keyboard: keys cut out of a rounded box. No Heroicon exists for it */
export function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path fillRule="evenodd" d="M14 6a4 4 0 0 1-4.899 3.899l-1.955 1.955a.5.5 0 0 1-.353.146H5v1.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2.293a.5.5 0 0 1 .146-.353l3.955-3.955A4 4 0 1 1 14 6Zm-4-2a.75.75 0 0 0 0 1.5.5.5 0 0 1 .5.5.75.75 0 0 0 1.5 0 2 2 0 0 0-2-2Z" clipRule="evenodd" />
    </svg>
  )
}

export function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path fillRule="evenodd" d="M3 3.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2ZM3.5 5.25h1.5v1.25h-1.5ZM6 5.25h1.5v1.25h-1.5ZM8.5 5.25h1.5v1.25h-1.5ZM11 5.25h1.5v1.25h-1.5ZM3.5 7.5h1.5v1.25h-1.5ZM6 7.5h1.5v1.25h-1.5ZM8.5 7.5h1.5v1.25h-1.5ZM11 7.5h1.5v1.25h-1.5ZM5 9.75h6v1.25H5Z" />
    </svg>
  )
}

/** A window with its left panel filled: shows or hides the sidebar. No Heroicon exists for it */
export function SidebarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path
        fillRule="evenodd"
        d="M4 2.5h8A2.5 2.5 0 0 1 14.5 5v6a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 11V5A2.5 2.5 0 0 1 4 2.5Zm3 1.5h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7V4Z"
      />
    </svg>
  )
}

/** A window with its right panel filled: shows or hides the task panel. No Heroicon exists for it */
export function PanelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path
        fillRule="evenodd"
        d="M12 2.5H4A2.5 2.5 0 0 0 1.5 5v6A2.5 2.5 0 0 0 4 13.5h8a2.5 2.5 0 0 0 2.5-2.5V5A2.5 2.5 0 0 0 12 2.5ZM9 4H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h5V4Z"
      />
    </svg>
  )
}

/** A push pin, leaning: pins the Tasks and Artifacts lists to a place. No Heroicon exists for it */
export function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path
        transform="rotate(40 8 8)"
        d="M5.5 1.5h5a.75.75 0 0 1 0 1.5H10v3.6l2.3 1.9a.75.75 0 0 1 .2.6v.4a.5.5 0 0 1-.5.5H8.75v4a.75.75 0 0 1-1.5 0V10H4a.5.5 0 0 1-.5-.5v-.4a.75.75 0 0 1 .2-.6L6 6.6V3h-.5a.75.75 0 0 1 0-1.5Z"
      />
    </svg>
  )
}

/** a pull request: two branches joining. No Heroicon exists for it */
export function PrIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-none stroke-current', className)} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
    </svg>
  )
}

/** a changed file: lines added and taken out. No Heroicon exists for it */
export function DiffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-none stroke-current', className)} strokeWidth={1.5} strokeLinecap="round">
      <path d="M8 2v6.5M4.75 5.25h6.5M4.75 12.5h6.5" />
    </svg>
  )
}

/** Shepherdr's mark: a shepherd's crook at a slight lean, its staff running off the bottom (public/icon.svg too) */
export function CrookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={clsx('shrink-0 fill-none stroke-current', className)} strokeWidth={4.5} strokeLinecap="round">
      <path transform="rotate(12 16 16)" d="M21 40V12a7 7 0 0 0-14 0v2.5" />
    </svg>
  )
}

/* Places' marks, as Slack's channels have theirs: lucide's outline icons (24px, stroke 2), drawn as they are. No
   Heroicon is a channel's # or an outline server */
const outline = (className?: string) => clsx('size-4 shrink-0 fill-none stroke-current', className)

/** a project: a channel's # */
export function HashIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="hash" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round">
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  )
}

/** a machine: two server units stacked, a light on each */
export function ServerIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="server" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="8" x="2" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </svg>
  )
}

/** All machines: layers stacked */
export function LayersIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="layers" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m2 12 9.17 4.17a2 2 0 0 0 1.66 0L22 12M2 17l9.17 4.17a2 2 0 0 0 1.66 0L22 17" />
    </svg>
  )
}

/** Pinned's heading: a pin standing up */
export function PinnedIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="pin" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  )
}

/** a section of the sidebar without an emoji: a folder, as outlined as the server and pin beside it */
export function SectionIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="section" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

/** a place's mark by its level: All machines' layers, a machine's server, a project's # */
export function PlaceIcon({ level, className }: { level: number; className?: string }) {
  const Icon = level === 0 ? LayersIcon : level === 1 ? ServerIcon : HashIcon
  return <Icon className={className} />
}

export const ic = 'size-4 shrink-0'

/** an Apple keyboard says ⌘ and ⌃; any other says Ctrl for both (the shortcuts take either) */
const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
export const SHIFT = apple ? '⇧' : 'Shift'
export const MOD = apple ? '⌘' : 'Ctrl'
export const CTRL = apple ? '⌃' : 'Ctrl'
export const ALT = apple ? '⌥' : 'Alt'
/** a shortcut written out: "⌘K" on a Mac, "Ctrl+K" elsewhere */
export const shortcut = (mod: string, key: string) => (mod.length > 1 ? `${mod}+${key}` : `${mod}${key}`)

/** one fade for anything greyed out */
export const dimmed = 'disabled:cursor-default disabled:opacity-40'

/** a text box's edge: a hairline, a shade darker while you type in it (the message box's look), never a bright ring */
export const field = 'shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus:shadow-box-focus'

/** the chat box's own buttons are circles the size of the send button, like the round header buttons */
export const roundBtn = 'size-[34px]! rounded-full! phone:size-11!'

export function Waves({ className }: { className?: string }) {
  return (
    <span className={clsx('wv', className)} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

/** minutes and seconds since a moment, ticking: "0:42" */
export function useElapsed(since: number) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const STEP = 5 // a 3px bar and a 2px gap, like the small wave
const EVERY = 70 // ms per new bar

/**
 * A live wave: bars come in on the right as the voice is heard and drift left, fading out at the left edge. Your
 * voice draws in the text colour, the agent's in green, quiet in grey. With reduced motion nothing drifts: a still row
 * of bars only changes colour with who is talking, drawn again only then.
 */
export function LiveWave({ sample, label, className }: { sample: () => Sample; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current!
    const g = el.getContext('2d')
    if (!g) return
    const still = matchMedia('(prefers-reduced-motion: reduce)')
    const bars: Sample[] = []
    let peak: Sample = { level: 0, who: null }
    let last = performance.now()
    let colours = { you: '', agent: '', quiet: '' }
    let read = 0
    let frame = 0
    /** what the still row last drew: drawn again only when it changes */
    let drawn = ''
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const dpr = devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
        drawn = ''
      }
      // the theme's colours, looked up again now and then (light and dark swap them)
      if (now - read > 1000) {
        const cs = getComputedStyle(el)
        colours = { you: cs.getPropertyValue('--fg'), agent: cs.getPropertyValue('--ready'), quiet: cs.getPropertyValue('--fg3') }
        read = now
      }
      const s = sample()
      if (s.level >= peak.level || !peak.who) peak = s
      const who = s.level > TALKING ? s.who : null
      const key = `${w}x${h} ${who} ${colours[who ?? 'quiet']}`
      if (still.matches && key === drawn) return
      drawn = still.matches ? key : ''
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const bar = (x: number, level: number, who: Sample['who']) => {
        const bh = Math.max(3, Math.round(level * h))
        g.fillStyle = who ? colours[who] : colours.quiet
        g.beginPath()
        g.roundRect(x, (h - bh) / 2, 3, bh, 1.5)
        g.fill()
      }
      if (still.matches) {
        const n = Math.min(24, Math.floor(w / STEP))
        for (let i = 0; i < n; i++) bar(w - (i + 1) * STEP + 2, 0.3, who)
        return
      }
      while (now - last >= EVERY) {
        bars.push(peak)
        peak = { level: 0, who: null }
        last += EVERY
        if (bars.length > 400) bars.splice(0, bars.length - 400)
      }
      const drift = ((now - last) / EVERY) * STEP
      for (let i = 0; i < bars.length; i++) {
        const x = w - (bars.length - i) * STEP - drift + 2
        if (x < -STEP) continue
        const b = bars[i]
        bar(x, b.level, b.level > TALKING ? b.who : null)
      }
      // before the first sounds come in, a calm row of dots fills the rest
      for (let x = w - (bars.length + 1) * STEP - drift + 2; x > -STEP; x -= STEP) bar(x, 0, null)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [sample])
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={clsx('h-6 min-w-0 [mask-image:linear-gradient(to_right,transparent,black_--spacing(8))]', className)}
    />
  )
}

/** A status mark; a working one with `p` fills its pie that far (the % done its agent reported). `frozen`: the %
 *  an agent waiting on you stopped at, said to screen readers where no pie shows it */
export function Dot({ s, halo, p, frozen, className }: { s: Status; halo?: boolean; p?: number; frozen?: Report; className?: string }) {
  const pie = s === 'work' && p !== undefined
  return (
    <span
      className={clsx('dot', s, halo && 'halo', className)}
      style={pie ? ({ '--p': `${Math.max(4, p)}%` } as CSSProperties) : undefined}
      aria-label={pie ? `${STATUS_WORD[s]}, ${p}% done` : frozen ? `${STATUS_WORD[s]}, ${frozen.progress}% done` : STATUS_WORD[s]}
      role="img"
    />
  )
}

/** The minutes left an agent reported, counted down: "~6 min", "~1 h 20 min", "<1 min" */
export function minutesLeft(eta: number) {
  if (eta < 1) return '<1 min'
  if (eta < 60) return `~${eta} min`
  const h = Math.floor(eta / 60)
  const m = eta % 60
  return h >= 10 || !m ? `~${h} h` : `~${h} h ${m} min`
}

/** The minutes left as few letters as fit under a dot: "<1m", "12m", "2h" */
export function etaShort(eta: number) {
  return eta < 1 ? '<1m' : eta < 60 ? `${eta}m` : `${Math.round(eta / 60)}h`
}

/**
 * A task row's status mark: working, the dot's pie shows the % done and the minutes left sit small under it, in the
 * dot's orange, level with the status line, centred on the dot without widening its column; the status line keeps
 * the row's whole width. Anything else is the dot alone; frozen while it waits on you, the % it stopped at stays in its
 * pie (still working) or, on the needs-you mark, for screen readers: its line says what it asks.
 */
export function TaskDot({ s, w }: { s: Status; w?: Report }) {
  const dot = <Dot s={s} p={w?.progress} frozen={w?.paused ? w : undefined} />
  if (s !== 'work' || !w || w.paused || w.eta === undefined) return dot
  return (
    <span className="mt-[3px] flex w-3.5 shrink-0 flex-col items-center self-stretch phone:mt-1 phone:w-4">
      {dot}
      <span aria-hidden className="mt-auto text-[0.625rem]/4 font-semibold whitespace-nowrap text-work tabular-nums phone:text-[0.6875rem]/5">
        {etaShort(w.eta)}
      </span>
      <span className="sr-only">{`, about ${minutesLeft(w.eta).replace(/^~/, '')} left`}</span>
    </span>
  )
}

/** The quiet words at the end of an agent's status line. In a header: the minutes left ("~12 min", "~12 min left" when
 *  wide), or frozen while it waits on you, the % it stopped at. In a row nothing: the minutes sit under the dot, which keeps the %. */
function reportEnd(w: Report, head: boolean, left: boolean) {
  if (!head) return ''
  if (w.paused) return `${w.progress}%`
  return w.eta !== undefined ? `${minutesLeft(w.eta)}${left ? ' left' : ''}` : ''
}

/**
 * What the agent is doing right now; in a header, its minutes left quietly at the end, the words giving way first so
 * the minutes never get cut off. While it waits on you, all of it frozen and quiet (no pause mark: Pause is the menu's
 * own action). `head` is a chat header's wording; on
 * a phone (`wrap`) the line flows centred, the minutes kept whole after the words: two lines at most for the
 * status line's 40 characters, and never more than three.
 */
export function ReportLine({ w, head = false, wrap = false }: { w: Report; head?: boolean; wrap?: boolean }) {
  const end = reportEnd(w, head, head && !wrap)
  const tail = end ? <span className="whitespace-nowrap text-fg3 tabular-nums">{wrap ? ' ' : ''}· {end}</span> : null
  if (wrap)
    return (
      <span className={clsx('line-clamp-3 text-balance', w.paused && 'text-fg3')}>
        {w.msg}
        {tail}
      </span>
    )
  return (
    <span className={clsx('flex min-w-0 items-center gap-1', w.paused && 'text-fg3')}>
      <span className="truncate">{w.msg}</span>
      {tail ? <span className="shrink-0">{tail}</span> : null}
    </span>
  )
}

/** the progress a task row shows: only while it works. Waiting on you, its row says what it asks instead */
export const rowReport = (t: Task) => (t.status === 'work' ? t.report : undefined)

/**
 * A task row's one line under its title: working, its agent's status line; waiting on you, Ready or Done, what it asks,
 * waits for or did, cut short; To do, nothing (its sub is empty). Where the list doesn't say where the task is, it
 * starts with that (its machine, its project: "vm-str · gtm") in place of its pull request's number, which gives way
 * before the line it leads: at most half the width, cut short.
 */
export function taskLine(t: Task, where?: string[]): ReactNode {
  const w = rowReport(t)
  const line = w ? <ReportLine w={w} /> : t.sub
  // where it is leads, or else its pull request's number, small: the link itself is in its chat's header
  const parts = [...(where?.length ? where : t.pr ? [`PR #${t.pr.number}`] : []), ...(t.base ? [`→ ${t.base}`] : [])]
  const lead = parts.length ? (
    // alone (no line after it), it has the whole width: half of it cut the machine's short name ("vm-…")
    <span className={clsx('inline-flex min-w-0 shrink-0 align-bottom text-fg3', line ? 'max-w-1/2' : 'max-w-full')}>
      {parts.map((x, i) => (
        <Fragment key={i}>
          {i ? <span className="shrink-0 whitespace-pre"> · </span> : null}
          {/* the machine's name (short) stays whole as long as it can; the project gives way first */}
          <span className={!where?.length ? 'shrink-0 tabular-nums' : i < parts.length - 1 ? clsx('shrink-0 truncate', line && 'max-w-1/2') : 'min-w-0 truncate'}>{x}</span>
        </Fragment>
      ))}
      {line ? <span className="shrink-0 whitespace-pre"> · </span> : null}
    </span>
  ) : null
  if (lead && w)
    return (
      <span className="flex min-w-0">
        {lead}
        {line}
      </span>
    )
  return lead || line ? (
    <>
      {lead}
      {line}
    </>
  ) : null
}

const STATUS_WORD: Record<Status, string> = {
  need: 'Needs you',
  ready: 'Ready',
  merging: 'Merging',
  work: 'Working',
  idle: 'Stopped',
  queued: 'Queued',
  todo: 'To do',
  done: 'Done',
  off: "Can't reach",
}

export function Count({ n, className, label }: { n: number; className?: string; label?: string }) {
  if (!n) return null
  return (
    <span
      aria-label={label}
      className={clsx(
        'inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-need px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]',
        className,
      )}
    >
      {/* trimmed to the digits' own height (cap to baseline), so the grid centres the ink, not the line with its
          room for descenders below, which sat the digit a pixel low */}
      <span className="[text-box:trim-both_cap_alphabetic]">{n}</span>
    </span>
  )
}

/** what the badge's two colours count, in words: a space's menu says it, as a finger gets no hover */
export const attentionWords = (need: number, ready: number) => [need ? `${need} need${need === 1 ? 's' : ''} you` : '', ready ? `${ready} ready` : ''].filter(Boolean).join(' · ')

/** One notification, with separate counts: needs you on the left, ready on the right.
 * Cap each printed count independently; the accessible name always keeps the exact numbers. */
export function AttentionBadge({ need, ready, scope }: { need: number; ready: number; scope: string }) {
  if (!need && !ready) return null
  const split = need > 0 && ready > 0
  const label = `${need} needs you, ${ready} ready · ${scope}`
  const cap = (n: number) => n > 9 ? '9+' : String(n)
  return (
    <span role="img" aria-label={label} title={label} data-attention-badge={split ? 'both' : need ? 'need' : 'ready'}
      className={clsx('attention-badge', split && 'attention-badge-split')}>
      {need > 0 ? <span aria-hidden="true" className="attention-badge-need">{cap(need)}</span> : null}
      {ready > 0 ? <span aria-hidden="true" className="attention-badge-ready">{cap(ready)}</span> : null}
    </span>
  )
}

type Btn = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }

/** 28px icon button (44px on a phone), with a finger-sized hit area */
export function IconButton({ className, label, children, pressed, ...p }: Btn & { label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={clsx(
        'hit press-dim inline-grid size-7 shrink-0 place-items-center rounded-full text-fg2 enabled:hover:bg-hover aria-pressed:bg-sel aria-pressed:text-fg phone:size-11',
        dimmed,
        className,
      )}
      {...p}
    >
      {children}
    </button>
  )
}

/** Phone header buttons: round, 44px */
export function RoundButton({ className, label, children, pressed, ...p }: Btn & { label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={clsx('press-dim grid size-11 shrink-0 place-items-center rounded-full bg-bubble text-fg2', pressed && 'bg-fg! text-bg!', className)}
      {...p}
    >
      {children}
    </button>
  )
}

/** Secondary button: 28px desktop, 36px phone */
export function Ghost({ className, children, ...p }: Btn) {
  return (
    <button
      type="button"
      className={clsx(
        'press-dim relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] after:absolute after:-inset-x-0.5 after:-inset-y-2 enabled:hover:bg-hover disabled:cursor-default disabled:opacity-40 coarse:h-9 phone:h-9 phone:text-[0.875rem]',
        className,
      )}
      {...p}
    >
      {children}
    </button>
  )
}

/** The one filled button of a view (34px; 44px on a phone). soft: the same size, secondary look (inside cards). */
export function Primary({ className, children, soft, ...p }: Btn & { soft?: boolean }) {
  return (
    <button
      type="button"
      className={clsx(
        'press-dim relative inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 font-medium after:absolute after:-inset-1 disabled:cursor-default disabled:opacity-40 coarse:h-11 phone:h-11',
        soft ? 'bg-bg text-fg shadow-soft enabled:hover:bg-hover' : 'bg-fg text-bg focus-visible:outline-offset-2',
        className,
      )}
      {...p}
    >
      {children}
    </button>
  )
}

/** Segmented tabs */
export function Tabs({ className, children, label, ...p }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div role="group" aria-label={label} className={clsx('inline-flex shrink-0 gap-0.5 rounded-full bg-hover p-0.5', className)} {...p}>
      {children}
    </div>
  )
}

/** a segment; filling, it shares out the room its row has (a menu setting's choices), and on a narrow screen its words
 * end in … before the row runs out */
export function Tab({ on, fill, className, children, ...p }: Btn & { on: boolean; fill?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={clsx(
        'relative inline-flex h-7 items-center gap-1.5 rounded-full text-[0.8125rem] whitespace-nowrap text-fg2 after:absolute after:-inset-y-2 after:inset-x-0 disabled:cursor-default disabled:opacity-40 aria-pressed:bg-seg-on aria-pressed:text-fg aria-pressed:shadow-[0_0_0_1px_var(--line2)] coarse:h-9 phone:h-9 phone:text-[0.875rem]',
        fill ? 'min-w-0 grow justify-center px-2 phone:max-[359px]:text-[0.8125rem]' : 'shrink-0 px-2.5 phone:px-3.5',
        className,
      )}
      {...p}
    >
      {fill ? <span className="truncate">{children}</span> : children}
    </button>
  )
}

/** the click a press outside a popup ends with only closes it: it presses nothing under it (the popup's own button
 * would open it again). A press that turns into a scroll ends with none. */
function swallowClick() {
  let t: ReturnType<typeof setTimeout> | undefined
  const off = () => {
    clearTimeout(t)
    removeEventListener('click', eat, true)
    removeEventListener('pointerdown', off, true)
    removeEventListener('pointercancel', off, true)
    removeEventListener('pointerup', up, true)
  }
  const eat = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    off()
  }
  const up = () => (t = setTimeout(off, 500))
  addEventListener('click', eat, true)
  addEventListener('pointerdown', off, true)
  addEventListener('pointercancel', off, true)
  addEventListener('pointerup', up, true)
}

/**
 * What every popup (a menu, a ⋯, a picker, a popover) shares: a click or tap anywhere outside it closes it, and so does
 * a click into a frame (a terminal, an artifact, the browser), which the page itself never hears.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      swallowClick()
      close.current()
    }
    const blur = () => setTimeout(() => document.activeElement instanceof HTMLIFrameElement && close.current())
    addEventListener('pointerdown', down, true)
    addEventListener('blur', blur)
    return () => {
      removeEventListener('pointerdown', down, true)
      removeEventListener('blur', blur)
    }
  }, [ref])
}

/**
 * A dropdown menu: one surface (the shared popover corner and shadow) whose rows all line up. Arrow keys, Home and
 * End move between its rows, Escape or a click outside closes it (useDismiss); opened from the keyboard, its first row takes the focus, and the focus
 * goes back to what opened it when it closes. `tabs`: it holds settings as tabs too, so Tab walks on to them rather
 * than closing it. `select`: a select's menu, whose chosen row (checked) takes the focus rather than the first.
 */
export function Menu({ label, onClose, tabs, select, className, children }: { label: string; onClose: () => void; tabs?: boolean; select?: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // it springs out of its button and fades away
  useMotion(ref, 'menu')
  const close = useRef(onClose)
  close.current = onClose
  useDismiss(ref, onClose)
  useLayoutEffect(() => {
    const el = ref.current!
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const rows = () => [...el.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)')]
    // opened from the keyboard, the first row takes the focus; a text field (always focus-visible) keeps it, so a tap on
    // + while typing leaves a phone's keyboard up
    if (opener?.matches(':focus-visible') && !opener.matches('input, textarea')) ((select && rows().find((r) => r.getAttribute('aria-checked') === 'true')) || rows()[0])?.focus({ preventScroll: true })
    const on = (e: KeyboardEvent) => {
      // a picker in it (a menu setting with many choices) takes its own arrow keys
      if (document.activeElement instanceof HTMLSelectElement && el.contains(document.activeElement) && e.key !== 'Escape' && e.key !== 'Tab') return
      const all = rows()
      const at = all.indexOf(document.activeElement as HTMLElement)
      const go = (i: number) => {
        e.preventDefault()
        e.stopImmediatePropagation()
        const row = all[(i + all.length) % all.length]
        row?.focus({ preventScroll: true })
        // a long menu (a setting's many choices) scrolls to it
        row?.scrollIntoView({ block: 'nearest' })
      }
      if (e.key === 'ArrowDown') go(at + 1)
      else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(-1)
      else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        close.current()
      } else if (e.key === 'Tab' && at >= 0 && !tabs) close.current()
    }
    // before the app's own keys, so Escape closes the menu and nothing behind it
    addEventListener('keydown', on, true)
    return () => {
      removeEventListener('keydown', on, true)
      if (el.contains(document.activeElement) && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  return (
    <div ref={ref} role="menu" aria-label={label} className={clsx('popover min-w-56 text-left', className)}>
      {children}
    </div>
  )
}

/** A menu's section name, over the rows' text */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="flex h-7 items-center pr-2 pl-8 text-[0.75rem] font-medium text-fg3 phone:h-9 phone:pr-3 phone:pl-10 phone:text-[0.8125rem]">{children}</div>
}

/** A thin line between a menu's sections */
export function MenuSeparator() {
  return <div role="separator" className="mx-2 my-1 h-px bg-line phone:mx-3" />
}

/**
 * A setting in a menu, one row about as tall as the others (room for the track on a desktop): its icon where a row's icon goes, then its choices as segmented
 * tabs filling the rest. The name labels the tabs; a
 * choice's hint is said to screen readers. A note, when given, is one quiet line under the tabs. Too many choices for
 * tabs on a phone (a CLI's models, its effort levels) make it a row with its name and the choice it is on, which opens
 * the device's own picker.
 */
export function MenuSetting({ name, icon, choices, note }: { name: string; icon: ReactNode; choices: { label: string; on: boolean; hint?: string; onClick: () => void }[]; note?: string }) {
  const long = choices.length > 3 || choices.reduce((n, c) => n + c.label.length, 0) > 24
  const on = Math.max(0, choices.findIndex((c) => c.on))
  const row = long ? (
    <label className="press relative flex h-8 items-center gap-2 px-2 whitespace-nowrap hover:bg-hover has-focus-visible:bg-hover coarse:h-11 phone:h-11 phone:gap-3 phone:px-3">
      <span className="grid size-4 shrink-0 place-items-center text-fg2 max-[359px]:hidden">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="flex min-w-0 items-center gap-1 text-fg2">
        <span className="truncate">{choices[on]?.label}</span>
        <ChevronUpDownIcon className={clsx(ic, 'shrink-0')} />
      </span>
      {/* the device's own picker: a wheel on a phone, a list on a desktop; 16px, so a phone doesn't zoom in */}
      <select name={name} aria-label={name} value={on} onChange={(e) => choices[Number(e.target.value)]?.onClick()} className="absolute inset-0 size-full cursor-pointer appearance-none text-base opacity-0">
        {choices.map((c, i) => (
          <option key={c.label} value={i}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <div className="flex h-9 items-center gap-2 px-2 phone:h-11 phone:gap-3 phone:px-3">
      <span className="grid size-4 shrink-0 place-items-center text-fg2 max-[359px]:hidden">
        {icon}
      </span>
      <Tabs label={name} className="min-w-0 flex-1">
        {choices.map((c) => (
          <Tab key={c.label} fill on={c.on} aria-label={c.hint ? `${c.label}: ${c.hint}` : undefined} onClick={c.onClick}>
            {c.label}
          </Tab>
        ))}
      </Tabs>
    </div>
  )
  if (!note) return row
  return (
    <div className="flex flex-col">
      {row}
      <Small className="truncate pr-2 pb-1 pl-8 text-fg3! tabular-nums phone:pr-3 phone:pl-10 max-[359px]:pl-2">{note}</Small>
    </div>
  )
}

/**
 * A setting that is on or off, as a menu row like the others (its icon in their slot, its switch where their hints go),
 * red when on (the colour of what it turns on, as the header's pill), and the whole row flips it. A note, when given, is
 * one quiet line under it.
 */
export function MenuSwitch({ name, icon, on, note, disabled, onClick }: { name: string; icon: ReactNode; on: boolean; note?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        disabled={disabled}
        onClick={onClick}
        className="group row-pop press flex h-8 w-full items-center gap-2 px-2 text-left whitespace-nowrap hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-50 coarse:h-11 phone:h-11 phone:gap-3 phone:px-3"
      >
        <span className="grid size-4 shrink-0 place-items-center text-fg2 max-[359px]:hidden">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {/* the track: grey off, red on; its knob slides across */}
        <span aria-hidden className="relative inline-flex w-9 shrink-0 rounded-full bg-line2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-200 ease-in-out group-aria-checked:bg-need group-aria-checked:shadow-none phone:w-11">
          <span className="aspect-square w-1/2 rounded-full bg-white shadow-xs ring-1 ring-black/5 transition-transform duration-200 ease-in-out group-aria-checked:translate-x-full" />
        </span>
      </button>
      {note ? <Small className={clsx('pr-2 pb-1 pl-8 text-fg3! tabular-nums phone:pr-3 phone:pl-10 max-[359px]:pl-2', disabled ? 'max-w-72 text-pretty' : 'truncate')}>{note}</Small> : null}
    </div>
  )
}

/**
 * A menu row (a menuitem unless given another role): an icon or check slot every row keeps, one line of text, and a
 * quiet hint or shortcut lined up on the right. 32px; 44px on a phone.
 */
export function MenuItem({ className, children, icon, hint, ...p }: Btn & { icon?: ReactNode; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx(
        'row-pop press flex h-8 w-full items-center gap-2 px-2 text-left whitespace-nowrap hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-[-2px] coarse:h-11 phone:h-11 phone:gap-3 phone:px-3',
        className,
      )}
      {...p}
    >
      <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 pl-4 text-[0.75rem] text-fg3 phone:text-[0.875rem]">{hint}</span> : null}
    </button>
  )
}

/** a list row's look: Row's, and a row that holds buttons of its own (its name a button stretched over it). dense:
 *  a sidebar row, Slack's 28px of 15px text with a mouse */
export function rowClass(sel?: boolean, kb?: boolean, dense?: boolean) {
  return clsx(
    dense ? 'min-h-7 text-[0.9375rem]/5 phone:text-base/6' : 'min-h-8',
    'press relative flex cursor-pointer items-center gap-2 rounded-row px-2 text-fg hover:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 phone:min-h-12 phone:px-3',
    sel && 'bg-sel hover:bg-sel',
    kb && 'cursor:shadow-[inset_0_0_0_1.5px_var(--focus)]',
  )
}

/** A list row: places, tasks, agents */
export function Row({
  className,
  sel,
  kb,
  two,
  children,
  onActivate,
  ...p
}: HTMLAttributes<HTMLLIElement> & { sel?: boolean; kb?: boolean; two?: boolean; onActivate?: () => void }) {
  return (
    <li
      role="button"
      tabIndex={0}
      aria-current={sel || undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          onActivate?.()
        }
      }}
      className={clsx(rowClass(sel, kb), two && 'items-start py-1.5 [&>.dot]:mt-[3px] phone:[&>.dot]:mt-1', className)}
      {...p}
    >
      {children}
    </li>
  )
}

export function List({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ul role="list" className={clsx('px-1.5 phone:px-2', className)}>
      {children}
    </ul>
  )
}

/** Row text: one line, cut short; an optional second line */
export function RowText({ children, sub, className }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <span className={clsx('min-w-0 flex-1 truncate', className)}>
      {children}
      {sub ? <span className="mt-px block truncate text-xs/4 font-normal text-fg2 phone:text-sm/5">{sub}</span> : null}
    </span>
  )
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('shrink-0 text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]', className)}>
      {children}
    </span>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-full px-2 text-xs/[18px] text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] phone:text-[0.8125rem]/5">{children}</span>
}

export function Section({ label, count, children, flip }: { label: ReactNode; count?: number; children?: ReactNode; flip?: string }) {
  return (
    <div data-flip={flip} className="flex min-h-9 items-center justify-between gap-2 px-4 pt-2.5 pb-0.5 text-[0.75rem] font-medium text-fg3 phone:px-5 phone:pt-3.5 phone:pb-1 phone:text-[0.875rem]">
      <span className="min-w-0 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 tabular-nums">{count}</span> : null}
      {children}
    </div>
  )
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-4 py-2 text-[0.8125rem] text-pretty text-fg2 phone:px-5 phone:text-[0.9375rem]', className)}>{children}</div>
}

/**
 * A list's filter: a slim field at its top that stays in view while the list scrolls. Esc clears it, and once empty
 * leaves it; onKey has the other keys first (the arrows, Enter).
 */
export function FilterBox({
  label,
  value,
  onChange,
  onKey,
  hint,
  children,
}: {
  label: string
  value: string
  onChange: (q: string) => void
  onKey?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
  hint?: string
  /** under the box, staying with it (the lists' chips) */
  children?: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div data-filter className="sticky top-0 z-2 bg-bg px-1.5 pt-2 pb-0.5 phone:px-2 phone:pt-3">
      {/* the look of the sidebar's Search or jump to */}
      <div className="flex h-8 items-center gap-2 rounded-full bg-bg pr-0.5 pl-3 text-[0.8125rem] text-fg3 shadow-[inset_0_0_0_1px_var(--line2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--focus)] coarse:h-11 phone:h-11 phone:text-[1rem]">
        <MagnifyingGlassIcon aria-hidden className={ic} />
        <input
          ref={input}
          name="filter"
          type="search"
          enterKeyHint="go"
          autoComplete="off"
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            onKey?.(e)
            if (e.defaultPrevented || e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            if (value) onChange('')
            else input.current?.blur()
          }}
          className="peer h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg3 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value ? (
          <IconButton
            label="Clear"
            className="size-7! coarse:size-10! phone:size-10!"
            onClick={() => {
              onChange('')
              input.current?.focus()
            }}
          >
            <XMarkIcon className={ic} />
          </IconButton>
        ) : hint ? (
          <kbd className="pr-2.5 font-sans text-[0.6875rem] text-fg3 peer-focus:invisible">{hint}</kbd>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function Small({ children, className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('text-[0.75rem] text-fg2 phone:text-[0.8125rem]', className)} {...p}>
      {children}
    </div>
  )
}

/** Column header: 52px with a hairline under it; its icon buttons are round, like its ⋯ */
export function Head({ children, className, conversation }: { children: ReactNode; className?: string; conversation?: boolean }) {
  return (
    <div data-chrome className={clsx('relative flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4 [&_.hit]:rounded-full', conversation && 'px-0!', className)}>
      {conversation ? <div data-conversation-head className="mx-auto flex min-h-[51px] w-full max-w-read min-w-0 items-center gap-2.5 pr-3 pl-5 [&_.hit]:rounded-full">{children}</div> : children}
    </div>
  )
}

/** A phone screen's top: round buttons either side, the title centred and as wide as the buttons leave room for; a
 *  mark after the subtitle */
export function PhoneTop({ left, dot, icon, p, name, kind, mark, right, report, expandName }: { left?: ReactNode; dot?: Status; icon?: ReactNode; p?: number; name: string; kind?: ReactNode; mark?: ReactNode; right?: ReactNode; report?: Report; expandName?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    // under a bar at the top (offline, a call) the notch is already kept clear
    <div data-kb data-chrome className={clsx('relative grid shrink-0 items-center gap-2 border-b border-line px-3 pt-[calc(env(safe-area-inset-top)+6px)] pb-1.5 [[data-topbar]~*_&]:pt-1.5', expandName ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[1fr_minmax(0,auto)_1fr]')}>
      <div className="flex gap-1">{left}</div>
      <div className="min-w-0 text-center">
        <div className="flex items-center justify-center gap-1.5 font-semibold">
          {dot ? <Dot s={dot} p={p} halo /> : null}
          {icon}
          {expandName ? (
            <button type="button" aria-label={`${expanded ? 'Collapse' : 'Show full'} task title: ${name}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className={clsx('min-w-0 text-left break-words', !expanded && 'line-clamp-2')}>
              {name}
            </button>
          ) : <span className="truncate">{name}</span>}
        </div>
        {mark && !report ? (
          // a mark (a coordinator's mode) ends the subtitle line, whole; the words before it give way first
          <div className="flex items-center justify-center gap-1.5 text-[0.8125rem]/[18px] text-fg2">
            <span className="min-w-0 truncate">{kind}</span>
            {mark}
          </div>
        ) : (
          <div className={clsx('text-[0.8125rem]/[18px] text-fg2', !report && 'truncate')}>{expandName ? kind : report ? <ReportLine w={report} head wrap /> : kind}</div>
        )}
        {expandName && report ? <div className="text-[0.8125rem]/[18px] text-fg2"><ReportLine w={report} head wrap /></div> : null}
      </div>
      <div className="flex justify-end gap-1">{right}</div>
    </div>
  )
}

export function Who({ name, kind }: { name: ReactNode; kind?: ReactNode }) {
  return (
    // the title a step over the chat's 15px words, as Slack's channel name is
    <div className="min-w-0 flex-1">
      <div className="truncate text-base/5 font-semibold">{name}</div>
      {kind ? <div className="truncate text-[0.8125rem]/[18px] text-fg2 phone:text-sm/5">{kind}</div> : null}
    </div>
  )
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <kbd className="inline-flex gap-1 font-sans">
      {keys.map((k) => (
        <span
          key={k}
          className="inline-grid h-6 min-w-6 place-items-center rounded-md px-1.5 text-xs/none font-medium text-fg shadow-[inset_0_0_0_1px_var(--line2),0_1px_0_var(--line2)]"
        >
          {k}
        </span>
      ))}
    </kbd>
  )
}

export function Sent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex items-center gap-1.5 text-[0.8125rem] text-ready-fg phone:text-[0.9375rem]', className)}>{children}</div>
}

/** Ghost-style link button */
export function LinkButton({ className, children, ...p }: Btn) {
  return (
    <button type="button" className={clsx('relative font-medium text-focus after:absolute after:-inset-x-1 after:-inset-y-2.5 hover:underline', className)} {...p}>
      {children}
    </button>
  )
}

/** A sidebar footer button: shaped like a place's row, so it is as easy to tap and reads as part of the list */
export function FootButton({ className, children, ...p }: Btn) {
  return (
    <button
      type="button"
      className={clsx(
        'press flex min-h-8 items-center gap-2 rounded-row px-2 text-left text-fg2 hover:bg-hover hover:text-fg keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 coarse:text-fg phone:min-h-12 phone:text-fg phone:gap-3 phone:px-3',
        className,
      )}
      {...p}
    >
      {children}
    </button>
  )
}

/** A text box without a resize grip that grows with what you write (and with its placeholder) */
export function TextBox({
  label,
  onChange,
  className,
  ref: outer,
  ...p
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { label: string; onChange: (v: string) => void; ref?: Ref<HTMLTextAreaElement> }) {
  const own = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = own.current
    if (!el) return
    el.style.height = 'auto'
    // an empty box is as tall as its placeholder
    if (!el.value && el.placeholder) {
      el.value = el.placeholder
      el.style.height = `${el.scrollHeight}px`
      el.value = ''
    } else el.style.height = `${el.scrollHeight}px`
  }, [p.value, p.placeholder])
  return (
    <textarea
      ref={(el) => {
        own.current = el
        if (typeof outer === 'function') outer(el)
        else if (outer) (outer as { current: HTMLTextAreaElement | null }).current = el
      }}
      rows={1}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={clsx('resize-none overflow-hidden', className)}
      {...p}
    />
  )
}

/** A secret's box: masked, never kept as a draft or offered for saving, and Enter saves. Its value lives only in the
 *  page's memory until it is sent */
export function SecretField({ label, value, onChange, onEnter, className, autoFocus }: { label: string; value: string; onChange: (v: string) => void; onEnter?: () => void; className?: string; autoFocus?: boolean }) {
  return (
    <input
      type="password"
      aria-label={label}
      placeholder="Paste or type it"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && onEnter?.()}
      className={clsx('min-h-10 w-full min-w-0 rounded-row bg-transparent px-3 py-[9px] font-mono placeholder:font-sans placeholder:text-fg3 coarse:min-h-11 phone:min-h-11 phone:text-[1rem]', field, className)}
    />
  )
}

/** The numbered mark Mark up leaves on what you picked */
export function MarkBadge({ x, y }: { x: number; y: number }) {
  return (
    <span
      className="pointer-events-none absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-focus px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]"
      style={{ left: x - 9, top: y - 9 }}
    >
      1
    </span>
  )
}

/** Mark up: a pointer and a speech bubble, a note left on a spot (like a design tool's comment). No Heroicon exists for
 *  it; drawn solid at 16px like the Micro set beside it */
export function MarkUpIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(ic, 'fill-current')}>
      <path d="M1.5 6.1a.6.6 0 0 1 .95-.49l6.6 4.75a.6.6 0 0 1-.28 1.08l-2.6.32 1.45 2.8a.75.75 0 1 1-1.33.7L4.85 12.5l-2.37 1.7a.6.6 0 0 1-.95-.5Z" />
      <path d="M9.75 1h3.5A1.75 1.75 0 0 1 15 2.75v2.5A1.75 1.75 0 0 1 13.25 7H12.5l-1.85 1.85A.4.4 0 0 1 10 8.57V7h-.25A1.75 1.75 0 0 1 8 5.25v-2.5A1.75 1.75 0 0 1 9.75 1Z" />
    </svg>
  )
}
