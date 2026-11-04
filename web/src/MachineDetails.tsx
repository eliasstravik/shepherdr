// Settings › Machines: a machine's health and what is left of each agent CLI's plan, under its name, as the window's
// machine blocks (mods/shepherdr-settings/machines-section.js, lib/machines.js machineDetails). The reads and every
// word are the shared core's (core/machines.js), as the sidebar's machine popup has them.
import clsx from 'clsx'
import { useEffect, useState, type CSSProperties } from 'react'
import type { Machine, MachineStats } from '@shared/types.ts'
import * as MC from '@core/machines.js'

type Level = 'ok' | 'busy' | 'over'
interface Read { state: string; at: number; windows?: { name: string; used: number; resets_at?: number; resets?: string }[]; plan?: string; account?: string; why?: string; failed?: string }
interface PlanRow { cli: string; name: string; read?: Read; none?: boolean }

const core = MC as unknown as {
  healthMeters: (s: MachineStats) => { name: string; pct: number; level: Level; detail: string }[]
  meterSub: (m: { name: string; pct: number; level: Level; detail: string }) => string
  planRows: (s: MachineStats, now?: number) => PlanRow[]
  healthReadWords: (s: MachineStats, now?: number) => string
  noHealthWords: (s: MachineStats) => string
  noPlanWords: (s: MachineStats) => string
  cliTitle: (r: PlanRow) => string
  readOld: (read: Read, now?: number) => boolean
  windowWords: (w: NonNullable<Read['windows']>[number], now?: number) => { dead?: string; name?: string; pct?: number; level?: Level; words?: string; refill?: string }
  failedWords: (read: Read) => string
  whyWords: (read: Read) => string
  ago: (at: number, now: number) => string
  NO_USAGE: string
  READING_MACHINE: string
}

const FILL: Record<Level, string> = { ok: 'bg-fg2', busy: 'bg-work', over: 'bg-need' }
const WORD: Record<Level, string> = { ok: 'text-fg2', busy: 'text-work-fg', over: 'text-need-fg' }
const small = 'text-[0.75rem] phone:text-[0.8125rem]'

function Meter({ name, pct, level, words, sub }: { name: string; pct: number; level: Level; words: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5 text-[0.8125rem] phone:text-[0.9375rem]">
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <span className={clsx('shrink-0 tabular-nums', WORD[level])}>{words}</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-line2">
        <div className={clsx('h-full w-(--fill) rounded-full', FILL[level])} style={{ '--fill': `${Math.max(2, Math.min(100, pct))}%` } as CSSProperties} />
      </div>
      {sub ? <p className={clsx(small, 'text-fg3 tabular-nums')}>{sub}</p> : null}
    </div>
  )
}

/** a machine's details: Health, then Plan usage per CLI ("Reading…" until its first read) */
export function MachineDetails({ m }: { m?: Machine }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const s = m?.stats
  if (!s) return <p className={clsx(small, 'text-fg3')}>{core.READING_MACHINE}</p>
  const meters = core.healthMeters(s)
  const plans = core.planRows(s, now)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <div className={clsx(small, 'flex items-baseline justify-between gap-3 font-medium text-fg2')}>
          <h4>Health</h4>
          <span className={clsx('font-normal tabular-nums', s.error ? 'text-work-fg' : 'text-fg3')}>{core.healthReadWords(s, now)}</span>
        </div>
        {meters.map((x) => <Meter key={x.name} name={x.name} pct={x.pct} level={x.level} words={`${x.pct}%`} sub={core.meterSub(x)} />)}
        {meters.length ? null : <p className={clsx(small, 'text-fg3')}>{core.noHealthWords(s)}</p>}
      </div>
      <div className="h-px shrink-0 bg-line" />
      <div className="flex flex-col gap-3.5">
        <h4 className={clsx(small, 'font-medium text-fg2')}>Plan usage</h4>
        {plans.map((r) => {
          const title = <h5 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold phone:text-[0.9375rem]">{core.cliTitle(r)}</h5>
          if (r.none || !r.read) return <section key={r.cli} className="flex flex-col gap-1">{title}<p className={clsx(small, 'text-fg3')}>{core.NO_USAGE}</p></section>
          const read = r.read
          return (
            <section key={r.cli} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  {title}
                  <span className={clsx(small, 'shrink-0 tabular-nums', core.readOld(read, now) ? 'text-work-fg' : 'text-fg3')}>Read {core.ago(read.at, now)}</span>
                </div>
                {read.account ? <p className={clsx(small, 'truncate text-fg3')}>{read.account}</p> : null}
              </div>
              {read.state === 'ok' ? (
                <>
                  {(read.windows ?? []).map((w, i) => {
                    const x = core.windowWords(w, now)
                    return x.dead ? <p key={i} className={clsx(small, 'text-fg3')}>{x.dead}</p> : <Meter key={i} name={x.name!} pct={x.pct!} level={x.level!} words={x.words!} sub={x.refill} />
                  })}
                  {read.failed ? <p className={clsx(small, 'text-work-fg')}>{core.failedWords(read)}</p> : null}
                </>
              ) : (
                <p className={clsx(small, 'text-fg2')}>{core.whyWords(read)}</p>
              )}
            </section>
          )
        })}
        {plans.length ? null : <p className={clsx(small, 'text-fg3')}>{core.noPlanWords(s)}</p>}
      </div>
    </div>
  )
}
