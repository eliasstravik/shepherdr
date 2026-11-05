// Worktree: three of a task view's tabs, all read only, as the window's (mods task-files, task-changes, task-pr).
// Files browses the task's folder one folder at a time, with each changed file's letter, and shows a file,
// highlighted; Changes lists what the task changed against where it left its base (committed or not, new files
// too), each file's diff under the list; Pull request shows the task's PR on GitHub (state, size, branch, checks, a
// link). Their words are the window's own (core/worktree.js VIEW_WORDS). The server reads only that task's folder
// (service/worktree.ts).
import clsx from 'clsx'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { definePlugin, setUI, useStore } from '@client/kernel.ts'
import { escapeHtml, highlighter, HIGHLIGHT_MAX, highlightLine, highlightLines, languageOf, loadHighlighter } from '@client/highlight.ts'
import { BackIcon, CheckCircleIcon, ClockIcon, CopyIcon, DiffIcon, FileIcon, FolderIcon, ic, IconButton, MinusCircleIcon, NextIcon, OpenIcon, PrIcon, Small, XCircleIcon } from '@client/ui.tsx'
import type { Diff, DiffFile, FileText, Patch, PrCheck, PullRequest, Task } from '@shared/types.ts'
import * as W from '@core/worktree.js'

const WORDS = W.VIEW_WORDS as Record<string, string>
const CHANGE = W.CHANGE_WORDS as Record<string, string>
const CHECK = W.CHECK_WORDS as Record<string, string>
const STATE = W.PR_STATES as Record<string, string>
const checksLine = W.checksLine as (cs: PrCheck[]) => string
const noChanges = W.noChanges as (label: string | null) => string
const againstLine = W.againstLine as (label: string | null) => string
const filesCount = W.filesCount as (n: number) => string

/* ---------- asking the server ---------- */

type Ask = { what: 'diff' | 'pr' | 'marks' } | { what: 'file' | 'patch'; path: string } | { what: 'dir'; path: string }
type Got<T> = { data?: T; error?: string; loading: boolean }

/** what each ask last got, kept while the screen is open: a tab shown again draws at once, then reads again */
const got = new Map<string, Got<unknown>>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

const keyOf = (task: string, a: Ask) => `${task}|${a.what}|${'path' in a ? a.path : ''}`

async function ask(task: string, a: Ask) {
  const k = keyOf(task, a)
  got.set(k, { ...(got.get(k) ?? {}), loading: true })
  changed()
  try {
    // "space:<id>": the tab bar's Files and Changes (Herdr's panels), the space's folder (SpaceSource)
    const q = new URLSearchParams({ ...(task.startsWith('space:') ? { space: task.slice(6) } : { task }), what: a.what, ...('path' in a && a.path ? { path: a.path } : {}) })
    const r = await fetch(`api/worktree?${q}`)
    const b = (await r.json().catch(() => ({}))) as { error?: string }
    // the server says why it has nothing as { error } too: the view says those words, as the window's does
    got.set(k, r.ok && !b.error ? { data: b, loading: false } : { error: b.error ?? `It said ${r.status}.`, loading: false })
  } catch {
    got.set(k, { ...(got.get(k) ?? {}), error: "Can't reach Shepherdr right now.", loading: false })
  }
  changed()
}

/** an ask's answer, asked when shown and again every `every` ms while it shows (the window reads again every 10 s
 *  and when the folder changes) */
function useAsk<T>(task: string, a: Ask | null, every = 0): Got<T> {
  const k = a ? keyOf(task, a) : ''
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (k ? got.get(k) : undefined),
  ) as Got<T> | undefined
  useEffect(() => {
    if (!a) return
    ask(task, a)
    if (!every) return
    const t = setInterval(() => document.visibilityState === 'visible' && ask(task, a), every)
    return () => clearInterval(t)
    // the key says all an ask is
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, every])
  return v ?? { loading: !!a }
}

/** what a tab has picked, by task (kept while the screen is open, so another tab and back keeps it) */
function usePicked(task: string, item: string): [string | undefined, (p: string | undefined) => void] {
  const k = `${task}|${item}`
  const v = useStore((s) => s.ui.picked[k])
  return [v || undefined, (p) => setUI((ui) => ({ picked: { ...ui.picked, [k]: p ?? '' } }))]
}

/* ---------- pieces ---------- */

/** the bar each view has at its top: where it is, or what it sums up */
function Bar({ children }: { children: ReactNode }) {
  return <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[0.75rem] text-fg2 phone:min-h-11 phone:text-[0.875rem]">{children}</div>
}

/** a quiet line where a list or a view has nothing to show, or why */
function Note({ children, error, center }: { children: ReactNode; error?: boolean; center?: boolean }) {
  return (
    <div className={clsx('px-3 py-2', center && 'grid flex-1 place-items-center px-6 text-center')}>
      <Small className={clsx('text-pretty', error ? 'text-need-fg' : 'text-fg3')}>{children}</Small>
    </div>
  )
}

function useHighlighter() {
  const [h, setH] = useState(highlighter)
  useEffect(() => {
    if (!h) loadHighlighter().then(setH, () => undefined)
  }, [h])
  return h
}

/** A file's text with its line numbers, highlighted once highlight.js is in */
function Code({ text, path }: { text: string; path: string }) {
  const h = useHighlighter()
  const lines = useMemo(() => {
    const lang = h && text.length <= HIGHLIGHT_MAX ? languageOf(path, h) : null
    const t = text.endsWith('\n') ? text.slice(0, -1) : text
    return lang && h ? highlightLines(t, lang, h) : t.split('\n').map(escapeHtml)
  }, [h, text, path])
  return (
    <div className="code-view min-h-0 flex-1 overflow-auto">
      <table className="min-w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="sticky left-0 w-px bg-bg pr-3 pl-4 text-right align-top text-fg3 tabular-nums select-none">{i + 1}</td>
              <td className="pr-4 align-top whitespace-pre" dangerouslySetInnerHTML={{ __html: l || ' ' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** a change's mark as the window's: A green, D and U red, else amber */
const markTone = (m: string) => (m === 'A' ? 'text-ready-fg' : m === 'D' || m === 'U' ? 'text-need-fg' : 'text-work-fg')

const row = 'press flex h-7 w-full shrink-0 items-center gap-2 rounded-row pr-2 text-left text-[0.8125rem] hover:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] focus-visible:outline-none coarse:h-11 phone:h-11 phone:text-[0.9375rem]'

/* ---------- Files ---------- */

type Dir = { root: string; entries: { name: string; dir: boolean }[]; limited?: boolean }

/** Files, as the window's: the task's folder, one folder at a time as you open them (.git left out), each changed
 *  file's letter; a file opens in place of the list, All files back */
export function FilesView({ task }: { task: Task }) {
  const [file, pick] = usePicked(task.id, 'files')
  const [open, setOpen] = useState(() => new Set<string>())
  const top = useAsk<Dir>(task.id, { what: 'dir', path: '' }, 10_000)
  const marks = useAsk<{ marks: Record<string, string> }>(task.id, { what: 'marks' }, 10_000).data?.marks ?? {}
  const toggle = (p: string) => {
    const s = new Set(open)
    if (s.has(p)) for (const x of [...s]) (x === p || x.startsWith(`${p}/`)) && s.delete(x)
    else s.add(p)
    setOpen(s)
  }
  if (file) return <FileView task={task} path={file} onBack={() => pick(undefined)} />
  const entries = top.data?.entries ?? []
  return (
    <>
      <Bar>
        <span className="min-w-0 truncate text-fg3">{top.data?.root ?? ''}</span>
      </Bar>
      <div role="tree" aria-label="Files" className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-1.5">
        <Entries task={task} prefix="" entries={entries} depth={0} open={open} toggle={toggle} pick={pick} marks={marks} />
        {top.error || !entries.length ? <Note>{top.error ? (task.id.startsWith('space:') ? top.error : WORDS.folderGone) : top.loading || !top.data ? WORDS.loadingFiles : WORDS.noFiles}</Note> : null}
        {top.data?.limited ? <Note>{WORDS.limited}</Note> : null}
      </div>
    </>
  )
}

function Entries({ task, prefix, entries, depth, open, toggle, pick, marks }: {
  task: Task; prefix: string; entries: Dir['entries']; depth: number; open: Set<string>; toggle: (p: string) => void; pick: (p: string) => void; marks: Record<string, string>
}) {
  return (
    <>
      {entries.map((e) => {
        const path = prefix ? `${prefix}/${e.name}` : e.name
        const on = open.has(path)
        const mark = marks[path]
        return (
          <div key={path} role="none">
            <button type="button" role="treeitem" aria-expanded={e.dir ? on : undefined} aria-level={depth + 1} onClick={() => (e.dir ? toggle(path) : pick(path))}
              style={{ paddingLeft: `${8 + depth * 18}px` }} className={row}>
              {e.dir ? <NextIcon className={clsx('size-3 shrink-0 text-fg3', on && 'rotate-90')} /> : <span className="size-3 shrink-0" />}
              {e.dir ? <FolderIcon className={clsx(ic, 'text-fg2')} /> : <FileIcon className={clsx(ic, 'text-fg2')} />}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {mark ? <span className={clsx('shrink-0 text-[0.6875rem] phone:text-[0.8125rem]', markTone(mark))}>{mark}</span> : null}
            </button>
            {e.dir && on ? <Folder task={task} path={path} depth={depth + 1} open={open} toggle={toggle} pick={pick} marks={marks} /> : null}
          </div>
        )
      })}
    </>
  )
}

/** an open folder's entries, read when it opens */
function Folder({ task, path, depth, open, toggle, pick, marks }: { task: Task; path: string; depth: number; open: Set<string>; toggle: (p: string) => void; pick: (p: string) => void; marks: Record<string, string> }) {
  const d = useAsk<Dir>(task.id, { what: 'dir', path }, 10_000)
  if (d.error) return <Note>{WORDS.folderGone}</Note>
  return <Entries task={task} prefix={path} entries={d.data?.entries ?? []} depth={depth} open={open} toggle={toggle} pick={pick} marks={marks} />
}

function FileView({ task, path, onBack }: { task: Task; path: string; onBack: () => void }) {
  const f = useAsk<FileText>(task.id, { what: 'file', path })
  return (
    <>
      <Bar>
        <IconButton label={WORDS.allFiles} onClick={onBack} className="-ml-1.5">
          <BackIcon className={ic} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-fg">{path}</span>
      </Bar>
      {f.error ? (
        <Note>{f.error}</Note>
      ) : !f.data ? (
        <Note>{WORDS.loadingFile}</Note>
      ) : f.data.binary ? (
        <Note>{WORDS.binaryFile}</Note>
      ) : (
        <Code text={f.data.tooBig ? `${f.data.text ?? ''}\n${WORDS.truncated}` : (f.data.text ?? '')} path={path} />
      )}
    </>
  )
}

/* ---------- Changes ---------- */

const KIND: Record<DiffFile['status'], [string, string]> = {
  added: [CHANGE.A, 'bg-ready'],
  modified: [CHANGE.M, 'bg-work'],
  deleted: [CHANGE.D, 'bg-need'],
  renamed: [CHANGE.M, 'bg-work'],
}

/** Changes, as the window's: the files it changed against where it left its base (a colored dot, its word on
 *  hover; the folder dim, the name; lines added and taken out), and under the list the picked file's diff (the first
 *  until you pick another) */
export function DiffView({ task }: { task: Task }) {
  const d = useAsk<Diff>(task.id, { what: 'diff' }, 10_000)
  const [picked, pick] = usePicked(task.id, 'diff')
  const files = d.data?.files ?? []
  const n = files.length
  // the first file's diff shows until you pick another, or close it ('-')
  const open = picked === '-' ? undefined : picked && files.some((f) => f.path === picked) ? picked : files[0]?.path
  const f = open ? files.find((x) => x.path === open) : undefined
  const label = d.data ? (d.data.against ?? null) : null
  const empty = d.error ? d.error : !d.data ? WORDS.loadingChanges : noChanges(label)
  return (
    <>
      <Bar>
        {d.data ? <span className="shrink-0 text-fg2 tabular-nums">{filesCount(n)}</span> : null}
        {d.data?.add ? <span className="shrink-0 text-ready-fg tabular-nums">+{d.data.add.toLocaleString('en')}</span> : null}
        {d.data?.del ? <span className="shrink-0 text-need-fg tabular-nums">−{d.data.del.toLocaleString('en')}</span> : null}
        <span className="flex-1" />
        {d.data ? (
          <span className="flex min-w-0 items-center gap-1 text-fg3">
            <DiffIcon className="size-3 shrink-0" />
            <span className="truncate">{againstLine(label)}</span>
          </span>
        ) : null}
      </Bar>
      <div role="list" aria-label="Changed files" className="max-h-[200px] shrink-0 touch-pan-y overflow-y-auto overscroll-contain border-b border-line p-1.5 phone:max-h-[40%]">
        {files.map((x) => {
          const at = x.path.lastIndexOf('/')
          const [word, tone] = KIND[x.status]
          return (
            <button key={x.path} type="button" role="listitem" aria-current={x.path === open || undefined} onClick={() => pick(x.path === open ? '-' : x.path)} className={clsx(row, 'pl-2 aria-current:bg-sel')}>
              <span className="grid w-3.5 shrink-0 place-items-center">
                <span className={clsx('size-2 rounded-full', tone)} />
                <span className="sr-only">{word}</span>
              </span>
              <span className="flex min-w-0 flex-1">
                {at > 0 ? <span className="min-w-0 truncate text-fg3">{x.path.slice(0, at + 1)}</span> : null}
                <span className="max-w-[260px] min-w-0 shrink-0 truncate">{x.path.slice(at + 1)}</span>
              </span>
              {x.add ? <span className="shrink-0 text-[0.6875rem] text-ready-fg tabular-nums phone:text-[0.8125rem]">+{x.add}</span> : null}
              {x.del ? <span className="shrink-0 text-[0.6875rem] text-need-fg tabular-nums phone:text-[0.8125rem]">−{x.del}</span> : null}
            </button>
          )
        })}
        {!n ? <Note>{empty}</Note> : null}
      </div>
      {n >= 1000 ? <Note>{WORDS.firstThousand}</Note> : null}
      {f ? <PatchView key={`${f.path}|${f.add}|${f.del}`} task={task} file={f} /> : n ? <Note>{task.id.startsWith('space:') ? 'Select a file to view its changes' : WORDS.pickChange}</Note> : <div className="flex-1" />}
    </>
  )
}

type Line = { kind: 'hunk' | 'add' | 'del' | 'ctx' | 'note'; text: string; n?: number }

/** a unified diff as the window's rows: hunk headers, lines added, taken out and kept, each with its number (the
 *  new one, a line taken out its old one); at most 1,500 lines, a line cut at 4,000 characters */
export function patchLines(patch: string): Line[] {
  const out: Line[] = []
  let o = 0
  let n = 0
  let body = false
  const cut = (s: string) => (s.length > 4000 ? `${s.slice(0, 4000)}… (line truncated)` : s)
  for (const l of patch.split('\n')) {
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (h) {
      o = Number(h[1])
      n = Number(h[2])
      body = true
      out.push({ kind: 'hunk', text: cut(l) })
    } else if (!body) continue
    else if (l.startsWith('+')) out.push({ kind: 'add', text: cut(l.slice(1)), n: n++ })
    else if (l.startsWith('-')) out.push({ kind: 'del', text: cut(l.slice(1)), n: o++ })
    else if (l.startsWith(' ')) (o++, out.push({ kind: 'ctx', text: cut(l.slice(1)), n: n++ }))
    else if (l.startsWith('\\')) out.push({ kind: 'note', text: l })
    else if (l.startsWith('diff --git')) body = false
    if (out.length >= 1500) break
  }
  return out
}

function PatchView({ task, file }: { task: Task; file: DiffFile }) {
  const p = useAsk<Patch>(task.id, { what: 'patch', path: file.path })
  const h = useHighlighter()
  const lines = useMemo(() => (p.data?.text ? patchLines(p.data.text) : []), [p.data?.text])
  const lang = h ? languageOf(file.path, h) : null
  const html = useMemo(
    () => lines.map((l) => (l.kind === 'hunk' || l.kind === 'note' || !lang || !h || (p.data?.text.length ?? 0) > HIGHLIGHT_MAX ? escapeHtml(l.text) : highlightLine(l.text, lang, h))),
    [lines, lang, h, p.data?.text],
  )
  if (p.error) return <Note error>{WORDS.cantDiff}</Note>
  if (!p.data) return <div className="flex-1" />
  if (p.data.binary) return <Note>{file.status === 'added' ? WORDS.binaryDiff : WORDS.binaryChanged}</Note>
  if (!lines.length) return <Note>{WORDS.noTextDiff}</Note>
  return (
    <div className="code-view min-h-0 flex-1 overflow-auto">
      <table className="min-w-full border-collapse" aria-label={`Changes in ${file.path}`}>
        <tbody>
          {lines.map((l, i) =>
            l.kind === 'hunk' ? (
              <tr key={i} className="bg-hover text-fg3">
                <td colSpan={2} className="py-0.5 pr-4 pl-3 whitespace-pre" dangerouslySetInnerHTML={{ __html: html[i] }} />
              </tr>
            ) : (
              <tr key={i} data-line={l.kind} className="data-[line=add]:bg-add data-[line=del]:bg-del">
                <td className="w-px pr-2.5 pl-3 text-right align-top text-fg3 tabular-nums select-none">{l.n ?? ''}</td>
                <td className={clsx('pr-4 align-top whitespace-pre', l.kind === 'note' && 'text-fg3')}>
                  <span className="sr-only">{l.kind === 'add' ? 'Added: ' : l.kind === 'del' ? 'Taken out: ' : ''}</span>
                  <span dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Pull request ---------- */

/** a state is a soft tint with its word in the colour (red is for what needs you, so Closed is grey) */
const PR_TONE: Record<PullRequest['state'], string> = {
  open: 'bg-ready/14 text-ready-fg',
  draft: 'bg-sel text-fg2',
  merged: 'bg-merged/14 text-merged',
  closed: 'bg-sel text-fg2',
}

const CHECK_ICON: Record<PrCheck['state'], [typeof CheckCircleIcon, string]> = {
  pass: [CheckCircleIcon, 'text-ready'],
  fail: [XCircleIcon, 'text-need'],
  pending: [ClockIcon, 'text-work'],
  skip: [MinusCircleIcon, 'text-fg3'],
}

/** the window's branch mark (lucide's git-branch) */
function BranchIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

/** a secondary button, as the window's: a thin outline, its icon then its words */
const outline = 'press-dim relative inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] after:absolute after:-inset-x-0.5 after:-inset-y-2 hover:bg-hover coarse:h-9 phone:h-9 phone:text-[0.875rem]'

/** Pull request, as the window's: GitHub asked on showing, then every 30 s */
function PrView({ task }: { task: Task }) {
  const p = useAsk<{ pr?: PullRequest; why?: string }>(task.id, { what: 'pr' }, 30_000)
  const [copied, setCopied] = useState(false)
  const pr = p.data?.pr
  if (!pr) {
    const text = p.error ? `GitHub didn't answer: ${p.error}` : p.data ? (p.data.why ?? WORDS.noPr) : WORDS.askingGitHub
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div className="flex max-w-[300px] flex-col items-center gap-2">
          <PrIcon className="size-[18px] text-fg3" />
          <Small className={clsx('text-pretty', p.error ? 'text-need-fg' : 'text-fg3')}>{text}</Small>
        </div>
      </div>
    )
  }
  const copy = () => {
    void navigator.clipboard?.writeText(pr.url).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <>
      {/* the bar the other views have: its state and number, the size of the change */}
      <Bar>
        <span className={clsx('rounded-full px-2 text-[0.75rem]/5 font-medium phone:text-[0.8125rem]/6', PR_TONE[pr.state])}>{STATE[pr.state]}</span>
        <span className="text-fg2 tabular-nums">#{pr.number}</span>
        <span className="flex-1" />
        {pr.files !== undefined ? <span className="shrink-0 text-fg3 tabular-nums">{filesCount(pr.files)}</span> : null}
        {pr.add ? <span className="shrink-0 text-ready-fg tabular-nums">+{pr.add.toLocaleString('en')}</span> : null}
        {pr.del ? <span className="shrink-0 text-need-fg tabular-nums">−{pr.del.toLocaleString('en')}</span> : null}
      </Bar>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-4 p-4 phone:p-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-[0.875rem]/6 font-semibold text-pretty phone:text-[1.0625rem]/7">{pr.title}</h3>
            {pr.head ? (
              <div className="flex min-w-0 items-center gap-1.5 text-[0.75rem] text-fg3 phone:text-[0.875rem]">
                <BranchIcon className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{`${pr.head} → ${pr.base ?? ''}`}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <a href={pr.url} target="_blank" rel="noreferrer" className={outline}>
                <OpenIcon className={ic} />
                {WORDS.openOnGitHub}
              </a>
              <button type="button" onClick={copy} className={outline}>
                <CopyIcon className={ic} />
                {copied ? WORDS.copied : WORDS.copyLink}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[0.75rem] phone:text-[0.875rem]">
              <span className="font-medium text-fg2">{WORDS.checks}</span>
              {pr.checks.length ? <span className="min-w-0 truncate text-fg3 tabular-nums">{checksLine(pr.checks)}</span> : null}
            </div>
            {pr.checks.length ? (
              <ul role="list" className="-mx-2">
                {pr.checks.map((c, i) => {
                  const [Icon, color] = CHECK_ICON[c.state]
                  const word = CHECK[c.state]
                  const body = (
                    <>
                      <Icon className={clsx(ic, color)} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="sr-only">{word}: </span>
                        {c.name}
                      </span>
                      {c.url ? <OpenIcon className={clsx('size-3 shrink-0 text-fg3')} /> : null}
                    </>
                  )
                  return (
                    <li key={`${c.name}${i}`}>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer" className="press flex min-h-[30px] items-center gap-2 rounded-row px-2 text-[0.8125rem] hover:bg-hover coarse:min-h-11 phone:min-h-11 phone:text-[0.9375rem]">
                          {body}
                        </a>
                      ) : (
                        <div className="flex min-h-[30px] items-center gap-2 px-2 text-[0.8125rem] coarse:min-h-11 phone:min-h-11 phone:text-[0.9375rem]">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Small className={pr.checksError ? 'text-need' : 'text-fg3'}>{pr.checksError || WORDS.noChecks}</Small>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default definePlugin({
  name: 'worktree',
  setup(reg) {
    // as the window's task view: Files and Changes always, Pull request once the task has one (itemsFor); none dims:
    // each says in its own view why it has nothing to show
    reg.taskPanel.push(
      { id: 'files', order: 20, label: 'Files', Icon: FolderIcon, View: FilesView },
      { id: 'diff', order: 30, label: 'Changes', Icon: DiffIcon, View: DiffView },
      { id: 'pr', order: 40, label: 'Pull request', Icon: PrIcon, View: PrView },
    )
  },
})

