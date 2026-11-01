// Plan limits: beside Settings at the foot of the spaces list (in the drawer on a phone), a thin bar for each CLI and the
// least left of any plan, amber then red as it runs out. A tap opens every window, when it refills and how old the numbers
// are. Each machine has its own sign-ins, so each has its own numbers; a CLI's numbers are only ever its own (plan-limits.ts).
import clsx from 'clsx'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { act, definePlugin, useSnap } from '@client/kernel.ts'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import type { CliLimitsRead, LimitWindow, Machine, MachineLimits } from '@shared/types.ts'

const NAME: Record<keyof MachineLimits, string> = { claude: 'Claude Code', codex: 'Codex' }
const CLIS = Object.keys(NAME) as (keyof MachineLimits)[]
/** past a missed ten-minute read the numbers say how old they are, even at a glance */
const OLD = 15 * 60_000
const MINUTE = 60_000

const left = (w: LimitWindow) => Math.max(0, Math.round(100 - w.used))
const level = (pct: number) => (pct <= 10 ? 'over' : pct <= 25 ? 'busy' : 'ok')
const FILL = { ok: 'bg-fg3', busy: 'bg-work', over: 'bg-need' }
const WORD = { ok: 'text-fg2', busy: 'text-work-fg', over: 'text-need-fg' }

/** a window that has refilled since it was read says nothing of now */
const live = (w: LimitWindow, now: number) => !w.resetsAt || w.resetsAt > now

/** 2m, 3h 10m, 5d 4h */
function span(ms: number) {
  const m = Math.max(1, Math.round(ms / MINUTE))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`
}

const ago = (at: number, now: number) => (now - at < MINUTE ? 'just now' : `${span(now - at)} ago`)

const when = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })

const reads = (m: Machine) => CLIS.flatMap((cli) => (m.limits?.[cli] ? [{ cli, read: m.limits[cli]! }] : []))

/** for each CLI, its tightest window now: the same CLI on two machines counts once, at its tightest. unknown: reads
 *  with no number to stand on now, which a healthy number beside them mustn't hide */
function tightest(machines: Machine[], now: number) {
  const out = new Map<keyof MachineLimits, { pct: number; at: number; failed?: string }>()
  let unknown = 0
  for (const m of machines)
    for (const { cli, read } of reads(m)) {
      const windows = read.state === 'ok' ? read.windows.filter((x) => live(x, now)) : []
      if (read.state === 'unknown' || (read.state === 'ok' && !windows.length)) unknown++
      for (const w of windows) {
        const was = out.get(cli)
        if (!was || left(w) < was.pct) out.set(cli, { pct: left(w), at: read.at, failed: read.state === 'ok' ? read.failed : undefined })
      }
    }
  return { clis: [...out.values()].sort((a, b) => a.pct - b.pct), unknown }
}

function useNow() {
  const [now, set] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function LimitsButton() {
  const machines = useSnap()?.machines?.filter((m) => m.limits) ?? []
  const now = useNow()
  const [open, setOpen] = useState(false)
  if (!machines.length) return null
  const { clis: worst, unknown } = tightest(machines, now)
  const least = worst[0]
  const lv = least ? level(least.pct) : 'ok'
  const stale = least && (now - least.at > OLD || least.failed) ? ` · ${ago(least.at, now)}` : ''
  const said = least ? `${least.pct}% left${stale}${unknown ? ` · ${unknown} unknown` : ''}` : 'unknown'
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Plan limits: ${said}. Open details`}
        onClick={() => setOpen(true)}
        className="press flex min-h-8 min-w-0 shrink items-center gap-2 rounded-row px-2 text-[0.75rem] whitespace-nowrap hover:bg-hover focus-visible:outline-none coarse:min-h-11 keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] phone:min-h-12 phone:px-3 phone:text-[0.8125rem]"
      >
        <span aria-hidden="true" className="flex h-3.5 items-end gap-[3px]">
          {worst.map((c, i) => (
            <span key={i} className="relative h-full w-[3px] overflow-hidden rounded-full bg-line2">
              <span className={clsx('absolute inset-x-0 bottom-0 h-(--fill) rounded-full', FILL[level(c.pct)])} style={{ '--fill': `${Math.max(8, c.pct)}%` } as CSSProperties} />
            </span>
          ))}
          {Array.from({ length: unknown }, (_, i) => (
            <span key={`unknown-${i}`} className="h-full w-[3px] rounded-full bg-line2" />
          ))}
        </span>
        <span className={clsx('truncate tabular-nums', lv === 'ok' ? 'text-fg3 coarse:text-fg2' : WORD[lv])}>Limits {said}</span>
      </button>
      {open ? createPortal(<Details onClose={() => setOpen(false)} />, document.querySelector('[data-device]') ?? document.body) : null}
    </>
  )
}

function Window({ w, now }: { w: LimitWindow; now: number }) {
  if (!live(w, now))
    return (
      <div className="flex justify-between gap-3 text-[0.8125rem] phone:text-[0.9375rem]">
        <span className="font-medium">{w.name}</span>
        <span className="text-right text-fg3">Refilled {when(w.resetsAt!)}, not read since</span>
      </div>
    )
  const pct = left(w)
  const refill = w.resetsAt ? `Refills ${when(w.resetsAt)} · in ${span(w.resetsAt - now)}` : w.resets ? `Refills ${w.resets}` : 'No refill time reported'
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1 text-[0.8125rem] phone:text-[0.9375rem]">
      <div className="truncate font-medium">{w.name}</div>
      <div className={clsx('text-right tabular-nums', WORD[level(pct)])}>{pct}% left</div>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-line2">
        <div className={clsx('h-full w-(--fill) rounded-full', FILL[level(pct)])} style={{ '--fill': `${Math.max(2, pct)}%` } as CSSProperties} />
      </div>
      <div className="col-span-2 text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]">{refill}</div>
    </div>
  )
}

function Cli({ cli, read, now }: { cli: keyof MachineLimits; read: CliLimitsRead; now: number }) {
  const plan = read.state === 'ok' && read.plan ? ` · ${read.plan[0].toUpperCase()}${read.plan.slice(1)}` : ''
  const old = read.state === 'ok' && (now - read.at > OLD || read.failed)
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate text-[0.8125rem] font-semibold phone:text-[0.9375rem]">
          {NAME[cli]}
          <span className="font-normal text-fg3">{plan}</span>
        </h3>
        <p className={clsx('shrink-0 text-[0.75rem] tabular-nums phone:text-[0.8125rem]', old ? 'text-work-fg' : 'text-fg3')}>Read {ago(read.at, now)}</p>
      </div>
      {read.state === 'ok' ? read.windows.map((w) => <Window key={w.name} w={w} now={now} />) : null}
      {read.state === 'ok' && read.failed ? <p className="text-[0.75rem] text-work-fg phone:text-[0.8125rem]">Last read failed: {read.failed}</p> : null}
      {read.state === 'signed-out' ? <p className="text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">Not signed in on this machine</p> : null}
      {read.state === 'no-plan' ? <p className="text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">No plan limits: not signed in to a subscription</p> : null}
      {read.state === 'unknown' ? <p className="text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">Unknown. {read.why}</p> : null}
    </section>
  )
}

/** what a tap shows: read again on opening, if what is here is more than a moment old */
function Details({ onClose }: { onClose: () => void }) {
  const machines = useSnap()?.machines ?? []
  const now = useNow()
  const [reading, setReading] = useState(true)
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void act({ type: 'limits-check' }).catch(() => {}).finally(() => setReading(false))
  }, [])
  const shown = machines.filter((m) => m.limits)
  return (
    <Sheet label="Plan limits" onClose={onClose} z="z-40" panel="tablet:max-w-sm desktop:max-w-sm phone:mt-auto phone:flex-none">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 phone:pb-[max(env(safe-area-inset-bottom),--spacing(4))]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[0.9375rem] font-semibold phone:text-[1.0625rem]">Plan limits</h2>
            <p className="text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{reading ? 'Reading them now…' : 'As each CLI reports them'}</p>
          </div>
          <SheetClose onClose={onClose} />
        </div>
        {shown.map((m) => (
          <div key={m.machine} className="flex flex-col gap-3.5 border-t border-line pt-3.5">
            <p className="text-[0.75rem] text-fg3 phone:text-[0.8125rem]">On {m.name}</p>
            {reads(m).map(({ cli, read }) => (
              <Cli key={cli} cli={cli} read={read} now={now} />
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  )
}

export default definePlugin({
  name: 'limits',
  setup(reg) {
    reg.sideFoot.push({ order: 5, View: LimitsButton })
  },
})
