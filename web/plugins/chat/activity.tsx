// What an agent does, calmly and in plain words: a turn's steps as a few quiet rows ("Edited 2 files: app.ts, panel.tsx",
// "Ran tests: 41 passed"), what it does now in one line while the turn runs ("Checking the task list"), and a small tag
// above the message box while background work runs (subagents, shells). A row opens to its command, output or diff;
// nothing streams by default, nothing flashes, and no command line shows until asked for.
import clsx from 'clsx'
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CommandLineIcon,
  StopIcon,
  CpuChipIcon,
  CheckIcon,
  ArrowUpRightIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  WrenchIcon,
} from '@heroicons/react/16/solid'
import { act, setUI, useStore } from '@client/kernel.ts'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import { countJobs, jobsWords, rowsOf, stepText, took } from '@shared/activity.ts'
import type { ActivityAnswer, Chat, Job, Step, StepKind, StepRow, TurnActivity } from '@shared/types.ts'
import * as CV from '@core/chat-view.js'
import { showTerminal, WORDS } from './rows.tsx'
const { elapsed } = CV as unknown as { elapsed: (secs: number) => string }

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
const KIND: Record<Job['kind'], string> = { agent: 'Subagent', headless: 'Subagent', child: 'Subagent', shell: 'Shell', monitor: 'Watcher' }

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

/** what a step or job printed; `tail`: a running job's last lines, kept scrolled to the newest (as the window's 8) */
function Output({ chat, id, job, live, tail }: { chat: string; id: string; job?: boolean; live?: boolean; tail?: boolean }) {
  const g = useActivity(chat, job ? 'job' : 'output', id, live ? 2000 : 0)
  const d = g.data
  const text = !d ? 'Loading…' : 'error' in d ? d.error : 'output' in d ? d.output || '(no output)' : ''
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => { if (tail && box.current) box.current.scrollTop = box.current.scrollHeight }, [tail, text])
  return (
    <pre ref={box} data-output className={clsx(tail ? 'max-h-40' : 'max-h-72', 'overflow-auto rounded-row bg-well px-3 py-2 font-mono text-[0.75rem]/5 whitespace-pre-wrap text-fg2')}>
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
      <button type="button" disabled={!j.more && !j.chat} onClick={() => (j.chat ? openSubagent(j) : deep(j))} className={clsx('flex w-full min-w-0 items-start gap-2 rounded-row px-2 py-2 text-left', (j.more || j.chat) && 'cursor-pointer hover:bg-hover')}>
        <I aria-hidden className="size-4 h-lh shrink-0 fill-[var(--fg3)]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.9375rem]/[1.375rem] text-fg phone:text-base/6">{j.title}</span>
          <span className={clsx(quiet, 'truncate')}>{[KIND[j.kind], j.status ? CV.subagentWord(j.status) : null, j.now].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={clsx(quiet, 'shrink-0 tabular-nums')}>{took(Date.now() - j.at, false)}</span>
        {j.more || j.chat ? <ChevronRightIcon aria-hidden className="size-4 h-lh shrink-0 fill-[var(--fg3)]" /> : null}
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

/** 3.0's tools row: calls in a row, between the agent's words, as one quiet line ("› Read 3 files, ran 2 commands",
 *  core/chat-log.js summary); it opens to each call's line and the first lines it printed, read only then */
export function TurnLine({ a, chat }: { a: TurnActivity; chat: string }) {
  const [open, setOpen] = useState(false)
  const Chev = open ? ChevronDownIcon : ChevronRightIcon
  return (
    <div data-activity={a.id} className="flex w-full flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-1.5 py-px text-left text-[0.75rem]/5 text-fg3 hover:bg-hover phone:py-1.5 phone:text-[0.8125rem]/5">
        <Chev aria-hidden className="size-3 shrink-0 fill-current" />
        <span className="min-w-0 flex-1 truncate">{a.summary ?? `${a.steps} steps`}</span>
      </button>
      {open ? <ToolSteps a={a} chat={chat} /> : null}
    </div>
  )
}

/** an open tools row: each call's line, and under it what it printed (asked of the server as the row opens) */
function ToolSteps({ a, chat }: { a: TurnActivity; chat: string }) {
  const g = useActivity(chat, 'turn', a.id)
  const d = g.data
  const steps: { id: string; line: string; out?: string }[] = d && 'steps' in d ? d.steps.map((s) => ({ id: s.id, line: s.title, out: s.out })) : a.rows.map((r) => ({ id: r.key, line: r.text }))
  return (
    <div className="flex flex-col gap-[3px] pt-1 pb-0.5 pl-[24px] text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
      {d && 'error' in d ? <p className="text-fg3">{d.error}</p> : null}
      {steps.map((s) => (
        <div key={s.id} className="flex min-w-0 flex-col">
          {s.line.split('\n').map((l, i) => <div key={i} className="truncate">{l}</div>)}
          {s.out != null ? (
            <div data-output className="mt-px mb-[3px] ml-0.5 border-l border-line pl-2 font-mono text-[0.71875rem] text-fg3">
              {(s.out || ' ').split('\n').map((l, i) => <div key={i} className="truncate">{l || ' '}</div>)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/* ---------- the window's lines over the box ---------- */

/** a turn's clock: when this page first saw the agent working */
const since = new Map<string, number>()

/** while the agent works: what it is doing in plain words, for how long, and Stop (Esc in an empty box; the hint only
 *  where there are keys), its edges the box's as the window's; only waiting
 *  (a wait, a sleep, a helper it waits on): a calm clock, no spinner */
export function WorkingLine({ chatKey }: { chatKey: string }) {
  const chat = useStore((s) => s.chats[chatKey])
  // the Assistant this chat is starting (its first message started it), before it says anything
  const starting = useStore((s) => chatKey.startsWith('p:') && !s.chats[chatKey]?.messages.length && s.outbox.some((o) => o.chat === chatKey && o.state !== 'failed'))
  const [stopping, setStopping] = useState(false)
  const on = !!chat?.working && !chat.finished
  useTick(on)
  useEffect(() => { if (!on) { since.delete(chatKey); setStopping(false) } else if (!since.has(chatKey)) since.set(chatKey, Date.now()) }, [on, chatKey])
  if (starting && !on)
    return (
      <div role="status" data-working className="flex h-[30px] items-center gap-2 text-[0.75rem] text-fg2 coarse:h-10 phone:h-10 phone:text-[0.8125rem]">
        <span aria-hidden className="live-dot size-1.5 shrink-0 rounded-full bg-[var(--work)]" />
        <span className="min-w-0 flex-1 truncate">{WORDS.startingAssistant}</span>
      </div>
    )
  if (!on) return null
  const secs = Math.floor((Date.now() - (since.get(chatKey) ?? Date.now())) / 1000)
  const waits = !!chat.waits && !stopping
  const stop = () => {
    setStopping(true)
    void act({ type: 'stop', chat: chatKey }).catch(() => setStopping(false))
  }
  return (
    <div role="status" data-working className="flex h-[30px] items-center gap-2 text-[0.75rem] text-fg2 coarse:h-10 phone:h-10 phone:text-[0.8125rem]">
      {waits ? <ClockIcon aria-hidden className="size-3 shrink-0 fill-[var(--fg3)]" /> : <span aria-hidden className="live-dot size-1.5 shrink-0 rounded-full bg-[var(--work)]" />}
      <span className="min-w-0 flex-1 truncate">{stopping ? WORDS.stopping : chat.doing || WORDS.working}</span>
      <span className="shrink-0 font-mono text-[0.71875rem] text-fg3 tabular-nums">{elapsed(secs)}</span>
      <button type="button" onClick={stop} disabled={stopping}
        className="flex h-[22px] shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[0.75rem] text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] enabled:hover:bg-hover enabled:hover:text-fg disabled:opacity-45 coarse:h-8 phone:h-8">
        <StopIcon aria-hidden className="size-2 shrink-0 fill-current" />
        Stop
        <kbd className="font-sans text-[0.6875rem] text-fg3 pointer-coarse:hidden">Esc</kbd>
      </button>
    </div>
  )
}

/** the agent asks in its terminal and no card here asks for it: Needs you, what it says it waits for, Open terminal */
export function NeedsYou({ chatKey }: { chatKey: string }) {
  const blocked = useStore((s) => s.chats[chatKey]?.blocked)
  if (blocked === undefined) return null
  return (
    <div role="alert" className="flex items-center gap-2.5 rounded-[10px] bg-bubble px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line2)]">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-need" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-fg">{WORDS.needsYou}</span>
        <span className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{blocked || WORDS.askingInTerminal}</span>
      </span>
      <button type="button" onClick={() => showTerminal(chatKey)}
        className="press-dim flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] bg-fg pr-2.5 pl-2 text-[0.78125rem] font-medium text-bg phone:h-10">
        <CommandLineIcon aria-hidden className="size-3.5 fill-current" />
        {WORDS.openTerminal}
      </button>
    </div>
  )
}

/* ---------- the background tag ---------- */

/** how long ago, as the window's rows count it: seconds for a minute, then minutes, then hours */
const ago = (at: number, until?: number) => {
  const s = Math.max(0, Math.floor(((until ?? Date.now()) - at) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

/** a background shell or watcher over the box (as the window's, mods/chat background()): a tap opens its command, what
 *  it printed last (Claude Code's, asked again every few seconds) and Stop */
function JobLine({ j, chat, open, toggle }: { j: Job; chat: string; open: boolean; toggle: () => void }) {
  const [stopping, setStopping] = useState(false)
  const I = j.kind === 'monitor' ? EyeIcon : CommandLineIcon
  const stop = () => {
    setStopping(true)
    void act({ type: 'stop-job', chat, job: j.id }).catch(() => setStopping(false))
  }
  return (
    <div data-job={j.id} className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={toggle}
        className={clsx('-mx-1 flex h-6 cursor-pointer items-center gap-2 rounded-[6px] px-1 text-left text-[0.75rem] hover:bg-hover phone:h-8 phone:text-[0.8125rem]', open && 'bg-hover')}>
        <I aria-hidden className="size-3 shrink-0 fill-[var(--work)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{j.title}</span>
        <span className="shrink-0 font-mono text-[0.71875rem] text-fg3 tabular-nums">{ago(j.at)}</span>
        <ChevronDownIcon aria-hidden className={clsx('size-3 shrink-0 fill-[var(--fg3)]', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="flex flex-col items-start gap-1.5 pt-1 pb-1.5 pl-5">
          {j.command ? <code className="block max-h-16 w-full overflow-hidden font-mono text-[0.71875rem]/[1.125rem] break-all whitespace-pre-wrap text-fg2">{j.command}</code> : null}
          {j.more === 'output' ? <div className="w-full"><Output chat={chat} id={j.id} job live tail /></div> : null}
          {j.stop ? (
            <button type="button" onClick={stop} disabled={stopping}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] pr-2.5 pl-2 text-[0.78125rem] font-medium text-fg shadow-[inset_0_0_0_1px_var(--line2)] enabled:hover:bg-hover disabled:text-fg3 phone:h-9">
              <StopIcon aria-hidden className="size-3 shrink-0 fill-current" />
              {stopping ? WORDS.stopping : 'Stop'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- subagents: an agent's own helper agents in herdr (SHEP-54) ---------- */

/** a subagent's chat followed while it shows (its row open, or its own chat in the sheet): kernel visibleChats */
function follow(chat: string, on: boolean) {
  // counted: each one that shows it holds one, and lets go of its own only (the row stays followed once its sheet closes)
  setUI((u) => {
    const subs = [...(u.subs ?? [])]
    if (on) subs.push(chat)
    else if (subs.includes(chat)) subs.splice(subs.indexOf(chat), 1)
    return { subs }
  })
}

/** the subagent whose own chat shows in its sheet (client.tsx SubagentSheet) */
let sub: Job | null = null
const subOpeners = new Set<() => void>()
export function openSubagent(j: Job | null) {
  if (sub?.chat) follow(sub.chat, false)
  sub = j
  if (j?.chat) follow(j.chat, true)
  subOpeners.forEach((l) => l())
}
export const useSubagent = () =>
  useSyncExternalStore(
    (l) => {
      subOpeners.add(l)
      return () => subOpeners.delete(l)
    },
    () => sub,
  )


/** its status as the dot the task rows use: amber and pulsing at work, red asking, a quiet check once done */
function SubDot({ status }: { status?: Job['status'] }) {
  if (status === 'done') return <CheckIcon aria-hidden className="size-3 shrink-0 fill-[var(--fg3)]" />
  return <span aria-hidden className={clsx('size-1.5 shrink-0 rounded-full', status === 'needs' ? 'bg-[var(--need)]' : 'live-dot bg-[var(--work)]')} />
}

/** a subagent's last words, from its own chat (followed while open) */
function SubWords({ chat }: { chat: string }) {
  const c = useStore((s) => s.chats[chat])
  const said = (c?.messages ?? []).filter((m) => m.who === 'agent' && typeof m.text === 'string' && m.text.trim()).slice(-2)
  if (!c) return <p className="text-[0.75rem]/5 text-fg3 phone:text-[0.8125rem]/5">Loading…</p>
  if (!said.length) return <p className="text-[0.75rem]/5 text-fg3 phone:text-[0.8125rem]/5">{c.working ? (c.doing || CV.WORDS.working) : 'Nothing said yet.'}</p>
  return (
    <ul role="list" className="flex w-full flex-col gap-1.5">
      {said.map((m) => (
        <li key={m.id} className="line-clamp-4 border-l-2 border-[var(--line2)] pl-2 text-[0.75rem]/[1.125rem] break-words whitespace-pre-wrap text-fg2 phone:text-[0.8125rem]/5">{m.text}</li>
      ))}
      {c.working && c.doing ? <li className="truncate pl-2.5 text-[0.71875rem] text-fg3">{c.doing}</li> : null}
    </ul>
  )
}

/** one subagent over its parent's box (as SHEP-27's agent rows: a quiet line that opens in place): its status, its role
 *  and CLI ("Reviewer · Codex"), its state in words and how long; open, its last words and a way into its own chat */
function SubagentLine({ j, open, toggle }: { j: Job; open: boolean; toggle: () => void }) {
  const chat = j.chat ?? ''
  useEffect(() => {
    if (!open || !chat) return
    follow(chat, true)
    return () => follow(chat, false)
  }, [open, chat])
  const word = CV.subagentWord(j.status ?? 'working')
  return (
    <div data-subagent={j.id} data-status={j.status} className="flex flex-col">
      <button type="button" aria-expanded={chat ? open : undefined} disabled={!chat} onClick={toggle}
        className={clsx('-mx-1 flex h-6 items-center gap-2 rounded-[6px] px-1 text-left text-[0.75rem] phone:h-8 phone:text-[0.8125rem]', chat && 'cursor-pointer hover:bg-hover', open && 'bg-hover')}>
        <span className="flex size-3 shrink-0 items-center justify-center"><SubDot status={j.status} /></span>
        <span className="min-w-0 truncate font-medium text-fg">{j.title}</span>
        <span className={clsx('shrink-0', j.status === 'needs' ? 'text-[var(--need-fg)]' : 'text-fg3')}>{word}</span>
        <span className="flex-1" />
        <span className="shrink-0 font-mono text-[0.71875rem] text-fg3 tabular-nums">{ago(j.at, j.ended)}</span>
        {chat ? <ChevronDownIcon aria-hidden className={clsx('size-3 shrink-0 fill-[var(--fg3)]', open && 'rotate-180')} /> : <span aria-hidden className="size-3 shrink-0" />}
      </button>
      {open && chat ? (
        <div className="flex flex-col items-start gap-2 pt-1 pb-1.5 pl-5">
          <SubWords chat={chat} />
          <button type="button" onClick={() => openSubagent(j)}
            className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] pr-2.5 pl-2 text-[0.78125rem] font-medium text-fg shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover phone:h-9">
            <ArrowUpRightIcon aria-hidden className="size-3 shrink-0 fill-current" />
            {CV.WORDS.subOpen}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** two or more of a kind over the box as one row (SHEP-92): "3 background processes", their shared state, the newest's
 *  title and how long it has run; open, the list of them in place, each opening as its own row does */
type Group = { kind: 'sub' | 'proc'; items: Job[]; newest: Job; status: NonNullable<Job['status']>; words: string | null }
function GroupLine({ g, open, toggle, children }: { g: Group; open: boolean; toggle: () => void; children: ReactNode }) {
  const sub = g.kind === 'sub'
  return (
    <div data-jobs-group={g.kind} data-count={g.items.length} className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={toggle}
        className={clsx('-mx-1 flex h-6 cursor-pointer items-center gap-2 rounded-[6px] px-1 text-left text-[0.75rem] hover:bg-hover phone:h-8 phone:text-[0.8125rem]', open && 'bg-hover')}>
        {sub ? <span className="flex size-3 shrink-0 items-center justify-center"><SubDot status={g.status} /></span> : <CommandLineIcon aria-hidden className="size-3 shrink-0 fill-[var(--work)]" />}
        <span className="shrink-0 font-medium text-fg">{g.words}</span>
        {sub ? <span className={clsx('shrink-0', g.status === 'needs' ? 'text-[var(--need-fg)]' : 'text-fg3')}>{CV.subagentWord(g.status)}</span> : null}
        <span className="min-w-0 flex-1 truncate text-fg3">{g.newest.title}</span>
        <span className="shrink-0 font-mono text-[0.71875rem] text-fg3 tabular-nums">{ago(g.newest.at, g.newest.ended)}</span>
        <ChevronDownIcon aria-hidden className={clsx('size-3 shrink-0 fill-[var(--fg3)]', open && 'rotate-180')} />
      </button>
      {open ? <div role="list" className="-mx-1 flex max-h-[40svh] flex-col overflow-y-auto overscroll-contain pt-0.5 pr-1 pl-6">{children}</div> : null}
    </div>
  )
}

/** what runs in the background, just above the message box (so it never scrolls away): the CLI's subagents, then its
 *  shells and watchers; at most one row of each kind (SHEP-92), as the window's (mods/chat background()) */
export function JobsTag({ chatKey }: { chatKey: string; cli: string }) {
  const all = useStore((s) => s.chats[chatKey]?.jobs)
  // Settings › Window › Show subagents above the chat box off: no subagents (its shells still show)
  const helpers = useStore((s) => s.snap?.look?.helpers !== false)
  const [groups, setGroups] = useState<Record<string, boolean>>({})
  const [opened, setOpened] = useState<string | null>(null)
  const jobs = (all ?? []).filter((j) => helpers || (j.kind !== 'agent' && j.kind !== 'headless' && j.kind !== 'child'))
  useTick(jobs.length > 0)
  if (!jobs.length) return null
  const row = (j: Job) =>
    j.kind === 'shell' || j.kind === 'monitor' ? (
      <JobLine key={j.id} j={j} chat={chatKey} open={opened === j.id} toggle={() => setOpened(opened === j.id ? null : j.id)} />
    ) : j.kind === 'child' ? (
      <SubagentLine key={j.id} j={j} open={opened === j.id} toggle={() => setOpened(opened === j.id ? null : j.id)} />
    ) : (
      <div key={j.id} className="flex h-6 items-center gap-2 text-[0.75rem] phone:h-8 phone:text-[0.8125rem]">
        <span aria-hidden className="live-dot size-1.5 shrink-0 rounded-full bg-[var(--work)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{j.title}</span>
        <span className="shrink-0 font-mono text-[0.71875rem] text-fg3 tabular-nums">{ago(j.at)}</span>
      </div>
    )
  return (
    <div data-jobs className="flex flex-col">
      {(CV.bgGroups(jobs) as Group[]).map((g) =>
        g.words ? (
          <GroupLine key={g.kind} g={g} open={!!groups[g.kind]} toggle={() => setGroups({ ...groups, [g.kind]: !groups[g.kind] })}>
            {g.items.map(row)}
          </GroupLine>
        ) : (
          row(g.items[0])
        ),
      )}
    </div>
  )
}
