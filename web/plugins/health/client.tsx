// Machine health: a machine's home space carries a small meter at the top right of its chat, one thin bar each for CPU,
// memory, disk (and a GPU), with a short status where the header has room. Calm: grey while all is well, amber
// while new tasks wait for room, red past an alert limit. A tap opens what is behind it (the numbers, the tasks at
// work against the limit, herdr) and the machine's settings. Shepherdr samples it every 30 seconds (health.ts).
import clsx from 'clsx'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { definePlugin, setUI, useSnap, useUI } from '@client/kernel.ts'
import { settingsPageOf } from '@client/Settings.tsx'
import { IconButton, NextIcon, RoundButton, ic, useDismiss } from '@client/ui.tsx'
import type { HealthLevel, HealthMeter, Machine, MachineHealth, Place } from '@shared/types.ts'

/** a meter's colour: quiet while all is well */
const FILL: Record<HealthLevel, string> = { ok: 'bg-fg3', busy: 'bg-work', over: 'bg-need' }
const WORD: Record<HealthLevel, string> = { ok: 'text-fg2', busy: 'text-work-fg', over: 'text-need-fg' }

/** CPU, Mem, Disk: short names for the header's line */
const SHORT: Record<string, string> = { Memory: 'Mem' }

/** how a machine does, said in one line: "CPU 85% · Memory 40% · Disk 22%" */
export const healthWords = (h: MachineHealth, short = false) => h.meters.map((m) => `${short ? (SHORT[m.name] ?? m.name) : m.name} ${m.pct}%`).join(' · ')

/** the worst of its meters, and herdr */
export const worst = (h: MachineHealth): HealthLevel => (!h.herdr || h.meters.some((m) => m.level === 'over') ? 'over' : h.meters.some((m) => m.level === 'busy') ? 'busy' : 'ok')

/** one thin upright bar per meter, filled to its share (a CPU loaded past its cores fills it) */
function Bars({ meters }: { meters: HealthMeter[] }) {
  return (
    <span aria-hidden="true" className="flex h-3.5 items-end gap-[3px] phone:h-4">
      {meters.map((m) => (
        <span key={m.name} className="relative h-full w-[3px] overflow-hidden rounded-full bg-line2">
          <span className={clsx('absolute inset-x-0 bottom-0 h-(--fill) rounded-full', FILL[m.level])} style={{ '--fill': `${Math.max(8, Math.min(100, m.pct))}%` } as CSSProperties} />
        </span>
      ))}
    </span>
  )
}

/** the meter at the top right of a machine's home space's chat, and what a tap shows */
function HealthButton({ place }: { place: Place }) {
  const m = useSnap()?.machines?.find((x) => x.machine === place.machine)
  const h = m?.health
  const phone = useUI((u) => u.device === 'phone')
  const [open, setOpen] = useState(false)
  if (!place.home || !m || !h) return null
  const engine = h.engine || 'herdr'
  const said = `${m.name}: ${healthWords(h)}${h.herdr ? '' : `, ${engine} isn't answering`}`
  const B = phone ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label={`Machine health. ${said}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={phone ? 'aria-expanded:bg-line2' : 'inline-flex! w-auto! gap-2 rounded-full! px-2.5 aria-expanded:bg-hover'}
      >
        <Bars meters={h.meters} />
        <span className={clsx('text-[0.75rem] whitespace-nowrap', worst(h) === 'over' ? 'text-need-fg' : worst(h) === 'busy' ? 'text-work-fg' : 'text-fg3', phone && worst(h) === 'ok' && 'sr-only')}>
          {phone ? (worst(h) === 'ok' ? 'Health' : '!') : !h.herdr ? `${engine} isn't answering` : worst(h) === 'over' ? 'Limit crossed' : worst(h) === 'busy' ? 'Busy' : 'Health'}
        </span>
      </B>
      {open ? <Details m={m} h={h} onClose={() => setOpen(false)} /> : null}
    </div>
  )
}

/** what a tap on the meter shows: each meter with its numbers, the tasks at work against the limit, herdr */
function Details({ m, h, onClose }: { m: Machine; h: MachineHealth; onClose: () => void }) {
  const snap = useSnap()!
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    addEventListener('keydown', key, true)
    ref.current?.focus({ preventScroll: true })
    return () => removeEventListener('keydown', key, true)
  }, [onClose])
  useDismiss(ref, onClose)
  const ui = useUI((u) => u)
  const page = settingsPageOf(snap.settings, m.machine, ui)
  const tasks = `${h.working}${h.max ? ` of ${h.max}` : ''} working${h.held ? ` · ${h.held} waiting` : ''}`
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${m.name} health`}
      tabIndex={-1}
      className="popover absolute top-full right-0 z-21 mt-1.5 w-[min(20rem,calc(100vw-24px))] origin-top-right p-3! text-left outline-none phone:p-4!"
    >
      <div className="flex items-baseline justify-between gap-3 pb-2.5">
        <h2 className="truncate text-[0.8125rem] font-semibold phone:text-[0.9375rem]">{m.name}</h2>
        <p className="shrink-0 text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]">at {h.at}</p>
      </div>
      <dl className="flex flex-col gap-2.5">
        {h.meters.map((m) => (
          <div key={m.name} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.75rem] items-center gap-x-3 gap-y-0.5 text-[0.8125rem] phone:text-[0.9375rem]">
            <dt className="font-medium">{m.name}</dt>
            <dd className="h-1.5 overflow-hidden rounded-full bg-line2">
              <div className={clsx('h-full w-(--fill) rounded-full', FILL[m.level])} style={{ '--fill': `${Math.max(2, Math.min(100, m.pct))}%` } as CSSProperties} />
            </dd>
            <dd className={clsx('text-right tabular-nums', m.level === 'ok' ? 'text-fg2' : WORD[m.level])}>{m.pct}%</dd>
            <dd className="col-start-2 col-end-4 text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]">{m.detail}{m.level === 'over' ? ' · Alert limit crossed' : m.level === 'busy' ? ' · New tasks wait for room' : ''}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[0.8125rem] phone:text-[0.9375rem]">
        <div className="flex justify-between gap-3">
          <dt className="font-medium">Tasks</dt>
          <dd className="truncate text-fg2 tabular-nums">{tasks}</dd>
        </div>
        {h.held && h.heldWhy ? <dd className="-mt-1 text-right text-[0.75rem] text-work-fg phone:text-[0.8125rem]">{h.heldWhy}</dd> : null}
        <div className="flex justify-between gap-3">
          <dt className="font-medium">{h.engine || 'herdr'}</dt>
          <dd className={h.herdr ? 'text-fg2' : 'text-need-fg'}>{h.herdr ? 'Answering' : "Isn't answering"}</dd>
        </div>
      </dl>
      {page !== undefined ? (
        <button
          type="button"
          onClick={() => {
            onClose()
            setUI({ settings: page })
          }}
          className="row-pop press -mx-1.5 mt-2 flex h-8 w-[calc(100%+--spacing(3))] items-center justify-between px-1.5 text-[0.8125rem] text-fg2 hover:bg-hover hover:text-fg phone:h-11 phone:text-[0.9375rem]"
        >
          Limits and alerts
          <NextIcon className={ic} />
        </button>
      ) : null}
    </div>
  )
}

export default definePlugin({
  name: 'health',
  setup(reg) {
    reg.placeHeader.push({ order: 5, View: HealthButton })
  },
})
