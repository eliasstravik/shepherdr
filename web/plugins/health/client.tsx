// Machine health, as 3.0's sidebar has it (mods/spaces-chat main.js meter, machine-popup.js): on each connected machine's
// header, its CPU, memory and disk as thin bars (grey while all is well, amber while new tasks wait there, red past its
// alert limit), its label the numbers and each plan's least left; a red dot when its health couldn't be read. A tap on
// the bars opens the machine's details: how fresh they are, each meter with its numbers, each agent CLI's plan, and
// Machine settings. The reads and every word are the shared core's (core/machines.js), as the window's.
import clsx from 'clsx'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { act, definePlugin, getState, setUI, useSnap } from '@client/kernel.ts'
import { sectionOf } from '@client/Settings.tsx'
import { CogIcon, ic, MonitorIcon, NextIcon, ServerIcon, useDismiss } from '@client/ui.tsx'
import type { Machine, MachineStats } from '@shared/types.ts'
import * as MC from '@core/machines.js'

type Level = 'ok' | 'busy' | 'over'
interface Meter { name: string; pct: number; level: Level; detail: string }
interface Read { state: string; at: number; windows?: { name: string; used: number; resets_at?: number; resets?: string }[]; plan?: string; account?: string; why?: string; failed?: string }
interface PlanRow { cli: string; name: string; read?: Read; pct?: number | null; level?: Level; none?: boolean }
interface WindowWords { dead?: string; name?: string; pct?: number; level?: Level; words?: string; refill?: string }

const core = MC as unknown as {
  healthMeters: (s: MachineStats) => Meter[]
  meterWords: (s: MachineStats) => string
  meterSub: (m: Meter) => string
  planRows: (s: MachineStats, now?: number) => PlanRow[]
  freshWords: (at: number | undefined, reading: boolean, now?: number) => string
  healthReadWords: (s: MachineStats, now?: number) => string
  noHealthWords: (s: MachineStats) => string
  noPlanWords: (s: MachineStats) => string
  cliTitle: (r: PlanRow) => string
  readOld: (read: Read, now?: number) => boolean
  windowWords: (w: NonNullable<Read['windows']>[number], now?: number) => WindowWords
  failedWords: (read: Read) => string
  whyWords: (read: Read) => string
  ago: (at: number, now: number) => string
  healthErrorWords: (error: string) => string
  NO_USAGE: string
  READING_MACHINE: string
}

/** a meter's colour: quiet while all is well */
const FILL: Record<Level, string> = { ok: 'bg-fg2', busy: 'bg-work', over: 'bg-need' }
const WORD: Record<Level, string> = { ok: 'text-fg2', busy: 'text-work-fg', over: 'text-need-fg' }

/** one thin upright bar per meter, filled to its share (a CPU loaded past its cores fills it) */
function Bars({ meters }: { meters: Meter[] }) {
  return (
    <span aria-hidden="true" className="flex h-3 items-end gap-0.5 phone:h-3.5">
      {meters.map((m) => (
        <span key={m.name} className="relative h-full w-[3px] overflow-hidden rounded-full bg-line2">
          <span className={clsx('absolute inset-x-0 bottom-0 h-(--fill) rounded-full', FILL[m.level])} style={{ '--fill': `${Math.max(8, Math.min(100, m.pct))}%` } as CSSProperties} />
        </span>
      ))}
    </span>
  )
}

/** a connected machine header's meter (3.0's): its bars, its label the numbers and the plans' least left; a tap opens
 *  its details under it. None until its health has been read. */
export function MachineMeter({ m }: { m: Machine }) {
  const s = m.stats
  const [open, setOpen] = useState(false)
  if (!s?.health) return null
  const meters = core.healthMeters(s)
  const words = core.meterWords(s)
  return (
    <span className="relative z-1 flex">
      <button type="button" aria-label={`${m.name}: ${words}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="hit grid h-6 place-items-center rounded-full px-1 hover:bg-sel aria-expanded:bg-sel phone:h-8">
        <Bars meters={meters} />
      </button>
      {open ? <MachinePopup m={m} onClose={() => setOpen(false)} /> : null}
    </span>
  )
}

/** a connected machine header's red dot: its health couldn't be read (the window's words in its label) */
export function HealthDot({ m }: { m: Machine }) {
  const error = m.stats?.error
  if (!error) return null
  const said = core.healthErrorWords(error)
  return <span role="img" aria-label={said} className="relative z-1 size-1.5 shrink-0 rounded-full bg-need" />
}

function useNow() {
  const [now, set] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** a row of the details: a name, its number, a bar, and a line under it */
function MeterRow({ name, pct, level, words, sub }: { name: string; pct: number; level: Level; words: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5 text-[0.8125rem] phone:text-[0.9375rem]">
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <span className={clsx('shrink-0 tabular-nums', WORD[level])}>{words}</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-line2">
        <div className={clsx('h-full w-(--fill) rounded-full', FILL[level])} style={{ '--fill': `${Math.max(2, Math.min(100, pct))}%` } as CSSProperties} />
      </div>
      {sub ? <p className="text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]">{sub}</p> : null}
    </div>
  )
}

function Heading({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[0.75rem] font-medium text-fg2 phone:text-[0.8125rem]">
      <h3>{name}</h3>
      {children}
    </div>
  )
}

/** one agent CLI's plan: its name and plan, how old the read is, its account, then each window (or why there are none) */
function Cli({ r, now }: { r: PlanRow; now: number }) {
  const title = <h4 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold phone:text-[0.9375rem]">{core.cliTitle(r)}</h4>
  if (r.none || !r.read)
    return (
      <section className="flex flex-col gap-1">
        {title}
        <p className="text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{core.NO_USAGE}</p>
      </section>
    )
  const read = r.read
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          {title}
          <span className={clsx('shrink-0 text-[0.75rem] tabular-nums phone:text-[0.8125rem]', core.readOld(read, now) ? 'text-work-fg' : 'text-fg3')}>Read {core.ago(read.at, now)}</span>
        </div>
        {read.account ? <p className="truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{read.account}</p> : null}
      </div>
      {read.state === 'ok' ? (
        <>
          {(read.windows ?? []).map((w, i) => {
            const x = core.windowWords(w, now)
            return x.dead ? (
              <p key={i} className="text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{x.dead}</p>
            ) : (
              <MeterRow key={i} name={x.name!} pct={x.pct!} level={x.level!} words={x.words!} sub={x.refill} />
            )
          })}
          {read.failed ? <p className="text-[0.75rem] text-work-fg phone:text-[0.8125rem]">{core.failedWords(read)}</p> : null}
        </>
      ) : (
        <p className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{core.whyWords(read)}</p>
      )}
    </section>
  )
}

/** A machine's details (the window's machine-popup.js), under its meter: its name and how fresh, its health, each agent
 *  CLI's plan, and Machine settings (Settings › Machines). Read again on opening when its plans are over a minute old. */
function MachinePopup({ m, onClose }: { m: Machine; onClose: () => void }) {
  const snap = useSnap()!
  const ref = useRef<HTMLDivElement>(null)
  const now = useNow()
  const s = m.stats
  const [reading, setReading] = useState(() => !s?.limitsAt || Date.now() - s.limitsAt > 60_000)
  useEffect(() => {
    if (reading) void act({ type: 'limits-check' }).catch(() => {}).finally(() => setReading(false))
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    addEventListener('keydown', key, true)
    ref.current?.focus({ preventScroll: true })
    return () => removeEventListener('keydown', key, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])
  useDismiss(ref, onClose)
  const meters = s ? core.healthMeters(s) : []
  const plans = s ? core.planRows(s, now) : []
  const Mark = m.here ? MonitorIcon : ServerIcon
  const settings = () => {
    onClose()
    const ui = getState().ui
    const section = sectionOf('Machines', snap.settings, { ...ui, settings: { section: 0, level: 'all' } })
    setUI({ settings: { section: Math.max(0, section), level: 'all' }, drawer: false })
  }
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={m.name}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      className="popover absolute top-full right-0 z-21 mt-1 flex max-h-[min(480px,calc(100dvh-6rem))] w-[min(20rem,calc(100vw-24px))] origin-top-right flex-col p-0! text-left font-normal text-fg outline-none"
    >
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line px-3.5">
        <Mark className="size-4 shrink-0 text-fg2" />
        <h2 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold phone:text-[0.9375rem]">{m.name}</h2>
        <p className="shrink-0 text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]">{core.freshWords(s?.at, reading, now)}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
        {!s ? (
          <p className="text-[0.8125rem] text-fg3">{core.READING_MACHINE}</p>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              <Heading name="Health">
                <span className={clsx('font-normal tabular-nums', s.error ? 'text-work-fg' : 'text-fg3')}>{core.healthReadWords(s, now)}</span>
              </Heading>
              {meters.map((x) => <MeterRow key={x.name} name={x.name} pct={x.pct} level={x.level} words={`${x.pct}%`} sub={core.meterSub(x)} />)}
              {meters.length ? null : <p className="text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{core.noHealthWords(s)}</p>}
            </div>
            <div className="h-px shrink-0 bg-line" />
            <div className="flex flex-col gap-3.5">
              <Heading name="Plan usage" />
              {plans.map((r) => <Cli key={r.cli} r={r} now={now} />)}
              {plans.length ? null : <p className="text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{core.noPlanWords(s)}</p>}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={settings}
        className="row-pop press mx-1.5 mb-1.5 flex h-8 shrink-0 items-center gap-2 px-2 text-[0.8125rem] text-fg2 hover:bg-hover hover:text-fg phone:h-11 phone:text-[0.9375rem]"
      >
        <CogIcon className={ic} />
        <span className="flex-1 text-left">Machine settings</span>
        <NextIcon className="size-3 shrink-0" />
      </button>
    </div>
  )
}

// 3.0 shows a machine's health in the sidebar (MachineMeter, HealthDot), not over a space's chat
export default definePlugin({
  name: 'health',
  setup() {},
})
