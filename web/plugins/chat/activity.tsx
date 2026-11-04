// What an agent does, calmly and in plain words: a turn's steps as a few quiet rows ("Edited 2 files: app.ts, panel.tsx",
// "Ran tests: 41 passed"), what it does now in one line while the turn runs ("Checking the task list"), and a small tag
// above the message box while background work runs (subagents, shells). A row opens to its command, output or diff;
// nothing streams by default, nothing flashes, and no command line shows until asked for.
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommandLineIcon,
  CpuChipIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  WrenchIcon,
} from '@heroicons/react/16/solid'
import { useStore } from '@client/kernel.ts'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import { countJobs, jobsWords, rowsOf, stepText, took } from '@shared/activity.ts'
import type { ActivityAnswer, Chat, Job, Step, StepKind, StepRow, TurnActivity } from '@shared/types.ts'

/* ---------- words ---------- */

const ICON: Record<StepKind, typeof CommandLineIcon> = {
  run: CommandLineIcon,
  read: DocumentTextIcon,
  edit: PencilSquareIcon,
  search: MagnifyingGlassIcon,
  web: GlobeAltIcon,
  agent: CpuChipIcon,
  other: WrenchIcon,
}

/** what a piece of background work is, the word the tag counts it by */
const KIND: Record<Job['kind'], string> = { agent: 'Subagent', headless: 'Subagent', shell: 'Shell', monitor: 'Watcher' }

/* ---------- ticking ---------- */

/** a re-draw every second while shown, for elapsed times */
function useTick(on = true) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

/* ---------- asking the server ---------- */

type Got = { data?: ActivityAnswer; loading: boolean }
const got = new Map<string, Got>()
const listeners = new Set<() => void>()

async function ask(chat: string, what: 'turn' | 'output' | 'job', id: string) {
  const k = `${chat}|${what}|${id}`
  got.set(k, { ...(got.get(k) ?? {}), loading: true })
  listeners.forEach((l) => l())
  try {
    const r = await fetch(`api/activity?${new URLSearchParams({ chat, what, id })}`)
    const b = (await r.json().catch(() => ({}))) as ActivityAnswer
    got.set(k, { data: r.ok ? b : { error: ('error' in b && b.error) || `It said ${r.status}.` }, loading: false })
  } catch {
    got.set(k, { ...(got.get(k) ?? {}), data: { error: "Can't reach Shepherdr right now." }, loading: false })
  }
  listeners.forEach((l) => l())
}

/** what the server says of a turn, a step's output or a job: asked when shown, and again every `every` ms */
function useActivity(chat: string, what: 'turn' | 'output' | 'job', id: string, every = 0): Got {
  const k = `${chat}|${what}|${id}`
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => got.get(k),
  )
  useEffect(() => {
    void ask(chat, what, id)
    if (!every) return
    const t = setInterval(() => void ask(chat, what, id), every)
    return () => clearInterval(t)
  }, [k, every])
  return v ?? { loading: true }
}

/* ---------- what opens: a turn's steps, a step's output, the background work, one job ---------- */

/** the chat whose background work shows in the sheet, and the piece of it opened there */
type Open = { chat: string; job?: string } | null
let open: Open = null
const openers = new Set<() => void>()
export function openJobs(o: Open) {
  open = o
  openers.forEach((l) => l())
}
const useOpen = () =>
  useSyncExternalStore(
    (l) => {
      openers.add(l)
      return () => openers.delete(l)
    },
    () => open,
  )

const quiet = 'text-[0.8125rem]/5 text-fg3 phone:text-[0.875rem]/5'

/** a test run's outcome in its words: "Ran the tests: 2 failed, 39 passed" */
const testsFailed = (r: StepRow) => /\b\d+ failed\b/.test(r.text)

function KindIcon({ kind, failed, loud }: { kind: StepKind; failed?: boolean; loud?: boolean }) {
  const I = failed ? ExclamationTriangleIcon : ICON[kind]
  return <I aria-hidden className={clsx('size-4 h-lh shrink-0', failed && loud ? 'fill-[var(--need)]' : 'fill-[var(--fg3)]')} />
}

/** lines an edit added and removed: "+12 −3" */
const Lines = ({ added, removed }: { added?: number; removed?: number }) =>
  added || removed ? (
    <span className="shrink-0 tabular-nums">
      <span className="text-[var(--ready)]">{`+${added ?? 0}`}</span> <span className="text-[var(--need)]">{`−${removed ?? 0}`}</span>
    </span>
  ) : null

function Output({ chat, id, job, live }: { chat: string; id: string; job?: boolean; live?: boolean }) {
  const g = useActivity(chat, job ? 'job' : 'output', id, live ? 2000 : 0)
  const d = g.data
  const text = !d ? 'Loading…' : 'error' in d ? d.error : 'output' in d ? d.output || '(no output)' : ''
  return (
    <pre data-output className="max-h-72 overflow-auto rounded-row bg-well px-3 py-2 font-mono text-[0.75rem]/5 whitespace-pre-wrap text-fg2">
      {/* a diff reads in its colours */}
      {text.split('\n').map((l, i) => (
        <span key={i} className={clsx('block', /^\+(?!\+\+)/.test(l) && 'text-[var(--ready)]', /^-(?!--)/.test(l) && 'text-[var(--need)]')}>
          {l || ' '}
        </span>
      ))}
    </pre>
  )
}

/** one step under its row: what it ran or opened (the command, the path), then its output; a row of one step shows its
 *  output at once, a row of several shows each step's on a tap */
function StepDetail({ s, chat, alone }: { s: Step; chat: string; alone: boolean }) {
  const [out, setOut] = useState(alone)
  useTick(!s.end)
  return (
    <li className="flex flex-col gap-1">
      {alone ? null : (
        <button
          type="button"
          disabled={!s.output}
          aria-expanded={s.output ? out : undefined}
          onClick={() => setOut(!out)}
          className={clsx('flex min-w-0 items-start gap-2 text-left', quiet, 'text-fg2!', s.output && 'cursor-pointer hover:text-fg!')}
        >
          <span className="min-w-0 flex-1 break-words">{s.end ? stepText(s) : s.doing}</span>
          <span className="shrink-0 text-fg3 tabular-nums">{took((s.end ?? Date.now()) - s.at)}</span>
        </button>
      )}
      {s.detail && s.detail !== s.target ? <code className="block font-mono text-[0.75rem]/5 break-all whitespace-pre-wrap text-fg3">{s.detail}</code> : null}
      {out && s.output ? <Output chat={chat} id={s.id} /> : null}
    </li>
  )
}

/** a row's steps, asked of the server when the row opens */
function RowSteps({ chat, what, id, ids, live }: { chat: string; what: 'turn' | 'job'; id: string; ids: string[]; live?: boolean }) {
  const g = useActivity(chat, what, id, live ? 2000 : 0)
  const d = g.data
  if (!d) return <p className={quiet}>Loading…</p>
  if ('error' in d) return <p className={quiet}>{d.error}</p>
  if (!('steps' in d)) return null
  const steps = d.steps.filter((s) => ids.includes(s.id))
  if (!steps.length) return <p className={quiet}>{d.catchingUp ? 'Loading the rest of this log…' : d.warning || 'It is no longer in its log.'}</p>
  return (
    <ul role="list" className="flex flex-col gap-2">
      {steps.map((s) => (
        <StepDetail key={s.id} s={s} chat={chat} alone={steps.length === 1} />
      ))}
    </ul>
  )
}

/** one row: an icon for its kind and what it did in words; a tap opens its command, output or diff below it. A phone's
 *  rows are 36px, so a finger picks the one it means */
function Row({ r, chat, what, id, live }: { r: StepRow; chat: string; what: 'turn' | 'job'; id: string; live?: boolean }) {
  const [on, setOn] = useState(false)
  return (
    <li data-row={r.key} className="flex flex-col">
      <button
        type="button"
        aria-expanded={on}
        onClick={() => setOn(!on)}
        className={clsx('flex min-w-0 cursor-pointer items-start gap-2 rounded-row px-1.5 py-0.5 text-left hover:bg-hover hover:text-fg2 phone:py-2', quiet, on && 'text-fg2')}
      >
        {/* a step that errored is often harmless (a search that found nothing): only failed tests are loud */}
        <KindIcon kind={r.kind} failed={!!r.failed} loud={testsFailed(r)} />
        <span className={clsx('min-w-0 flex-1', on ? 'break-words' : 'truncate')}>{r.text}</span>
        <Lines added={r.added} removed={r.removed} />
        {r.failed && !testsFailed(r) ? <span className="shrink-0">had an error</span> : null}
      </button>
      {on ? (
        <div className="flex flex-col gap-1 py-1 pr-1.5 pl-7.5">
          <RowSteps chat={chat} what={what} id={id} ids={r.steps} live={live} />
        </div>
      ) : null}
    </li>
  )
}

function Rows({ rows, chat, what, id, live }: { rows: StepRow[]; chat: string; what: 'turn' | 'job'; id: string; live?: boolean }) {
  return (
    <ul role="list" className="flex flex-col">
      {rows.map((r) => (
        <Row key={r.key} r={r} chat={chat} what={what} id={id} live={live} />
      ))}
    </ul>
  )
}

/** all of a turn's or a job's steps as rows, asked of the server; a live one again every few seconds */
function AllRows({ chat, what, id, live, fallback }: { chat: string; what: 'turn' | 'job'; id: string; live?: boolean; fallback?: StepRow[] }) {
  const g = useActivity(chat, what, id, live ? 2000 : 0)
  const d = g.data
  if (d && 'error' in d) return <p className={clsx(quiet, 'px-1.5 py-0.5')}>{d.error}</p>
  if (d && 'output' in d) return <Output chat={chat} id={id} job live={live} />
  const rows = d && 'steps' in d ? rowsOf(d.steps) : fallback
  if (!rows) return <p className={clsx(quiet, 'px-1.5 py-0.5')}>Loading…</p>
  const detail = d && 'steps' in d ? d : undefined
  return <>
    {detail?.warning ? <p className={clsx(quiet, 'px-1.5 py-0.5')}>{detail.warning}</p> : null}
    {rows.length ? <Rows rows={rows} chat={chat} what={what} id={id} live={live} /> : detail?.catchingUp ? null : <p className={clsx(quiet, 'px-1.5 py-0.5')}>No steps yet.</p>}
    {detail?.catchingUp ? <p className={clsx(quiet, 'px-1.5 py-0.5')}>Loading the rest of this log…</p> : null}
  </>
}

/** the background work: each piece, what it does now and how long it has run; a tap opens its own steps or output */
function JobRow({ j, chat, deep }: { j: Job; chat: string; deep: (j: Job) => void }) {
  useTick()
  const I = j.kind === 'shell' || j.kind === 'monitor' ? CommandLineIcon : CpuChipIcon
  return (
    <li>
      <button type="button" disabled={!j.more} onClick={() => deep(j)} className={clsx('flex w-full min-w-0 items-start gap-2 rounded-row px-2 py-2 text-left', j.more && 'cursor-pointer hover:bg-hover')}>
        <I aria-hidden className="size-4 h-lh shrink-0 fill-[var(--fg3)]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.9375rem]/[1.375rem] text-fg phone:text-base/6">{j.title}</span>
          <span className={clsx(quiet, 'truncate')}>{[KIND[j.kind], j.now].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={clsx(quiet, 'shrink-0 tabular-nums')}>{took(Date.now() - j.at, false)}</span>
        {j.more ? <ChevronRightIcon aria-hidden className="size-4 h-lh shrink-0 fill-[var(--fg3)]" /> : null}
      </button>
    </li>
  )
}

function JobList({ chat, jobs, deep }: { chat: string; jobs: Job[]; deep: (j: Job) => void }) {
  if (!jobs.length) return <p className={clsx(quiet, 'px-2 py-2')}>Nothing runs in the background now.</p>
  return (
    <ul role="list" className="flex flex-col">
      {jobs.map((j) => (
        <JobRow key={j.id} j={j} chat={chat} deep={deep} />
      ))}
    </ul>
  )
}

/** the background work in a sheet (a phone) or a card (wider): each piece, then one piece's own steps or output */
export function JobsSheet() {
  const o = useOpen()
  const chat = useStore((s) => (o ? s.chats[o.chat] : undefined))
  if (!o) return null
  const close = () => openJobs(null)
  const jobs = chat?.jobs ?? []
  const job = o.job ? jobs.find((j) => j.id === o.job) : undefined
  const title = o.job ? (job?.title ?? 'Over now') : 'In the background'
  return (
    <Sheet label={title} onClose={close} panel="max-w-[560px]">
      <div className="flex shrink-0 items-center gap-1 px-4 pt-3 pb-2">
        {o.job ? (
          <button type="button" aria-label="Back" onClick={() => openJobs({ chat: o.chat })} className="-ml-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-hover">
            <ChevronLeftIcon aria-hidden className="size-4 fill-[var(--fg2)]" />
          </button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium phone:text-base">{title}</h2>
        <SheetClose onClose={close} />
      </div>
      <div data-jobs-sheet className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-4">
        {o.job ? (
          job ? (
            <AllRows chat={o.chat} what="job" id={o.job} live />
          ) : (
            <p className={clsx(quiet, 'px-2 py-1')}>It ended.</p>
          )
        ) : (
          <JobList chat={o.chat} jobs={jobs} deep={(j) => openJobs({ chat: o.chat, job: j.id })} />
        )}
      </div>
    </Sheet>
  )
}

const Chevron = ({ on }: { on?: boolean }) => <ChevronDownIcon aria-hidden className={clsx('size-4 h-lh shrink-0 fill-[var(--fg3)]', on && 'rotate-180')} />

/* ---------- a turn's rows ---------- */

/** a finished turn's steps: the rows that say most, at most three, in plain words, a thin line at their left; "4 more"
 *  shows the rest. Each row opens to what it ran and printed. */
export function TurnLine({ a, chat }: { a: TurnActivity; chat: string }) {
  const [all, setAll] = useState(false)
  return (
    <div data-activity={a.id} className="flex w-full max-w-[560px] flex-col border-l-2 border-line pl-1.5">
      {all ? <AllRows chat={chat} what="turn" id={a.id} fallback={a.rows} /> : <Rows rows={a.rows} chat={chat} what="turn" id={a.id} />}
      {a.more ? (
        <button type="button" data-more aria-expanded={all} onClick={() => setAll(!all)} className={clsx('flex cursor-pointer items-start gap-2 self-start rounded-row px-1.5 py-0.5 text-left hover:bg-hover hover:text-fg2 phone:py-2', quiet)}>
          <Chevron on={all} />
          <span>{all ? 'Show less' : `${a.more} more · ${took((a.end ?? a.at) - a.at, false)}`}</span>
        </button>
      ) : null}
    </div>
  )
}

/* ---------- the live line, while a turn runs ---------- */

/** what it does now in words ("Checking the task list") and for how long, in one quiet line where the typing dots would
 *  be; a tap shows the turn's rows so far */
export function LiveLine({ chat }: { chat: Chat }) {
  useTick()
  const [on, setOn] = useState(false)
  const a = chat.live!
  const now = a.now
  return (
    <div role="status" data-live className="flex w-full flex-col items-start gap-1">
      <button type="button" aria-expanded={on} onClick={() => setOn(!on)} className={clsx('flex max-w-full min-w-0 cursor-pointer items-center gap-2 text-left hover:text-fg2', quiet)}>
        <span aria-hidden className="live-dot size-1.5 shrink-0 rounded-full bg-[var(--work)]" />
        <span className="min-w-0 truncate text-fg2">{now ? (now.end ? stepText(now) : now.doing) : 'Thinking'}</span>
        <span className="shrink-0 tabular-nums">{took(Date.now() - a.at)}</span>
        {a.steps ? <Chevron on={on} /> : null}
      </button>
      {on ? (
        <div className="w-full max-w-[560px] border-l-2 border-line pl-1.5">
          <AllRows chat={chat.key} what="turn" id={a.id} live fallback={a.rows} />
        </div>
      ) : null}
    </div>
  )
}

/* ---------- the background tag ---------- */

/** what runs in the background, just above the message box (so it never scrolls away); a tap shows each piece */
export function JobsTag({ chatKey }: { chatKey: string; cli: string }) {
  const jobs = useStore((s) => s.chats[chatKey]?.jobs)
  if (!jobs?.length) return null
  return (
    <div className="flex justify-center pb-1.5">
      <button
        type="button"
        data-jobs
        onClick={() => openJobs({ chat: chatKey })}
        className="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-bubble py-1 pr-2.5 pl-2 text-[0.8125rem]/5 text-fg2 hover:text-fg phone:text-[0.875rem]/5"
      >
        <span aria-hidden className="live-dot size-1.5 shrink-0 rounded-full bg-[var(--work)]" />
        <span className="truncate">{jobsWords(countJobs(jobs))}</span>
      </button>
    </div>
  )
}
