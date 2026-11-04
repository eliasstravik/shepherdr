// Worktree: three items of a task's side panel, all read only. Files browses the task's worktree and shows a file,
// highlighted; Diff shows what the task changed against main (its files as a tree, each file's unified diff, lines
// added and taken out); Pull request shows the task's PR on GitHub (state, checks, a link), greyed out until one is
// open. The server reads only that worktree (server/live/worktree.ts).
import clsx from 'clsx'
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { definePlugin, setUI, useStore } from '@client/kernel.ts'
import { escapeHtml, highlighter, HIGHLIGHT_MAX, highlightLine, highlightLines, languageOf, loadHighlighter } from '@client/highlight.ts'
import { BackIcon, CheckCircleIcon, ClockIcon, DiffIcon, FileIcon, FolderIcon, FolderOpenIcon, ic, IconButton, MinusCircleIcon, NextIcon, OpenIcon, PrIcon, ReloadIcon, SearchIcon, Small, XCircleIcon } from '@client/ui.tsx'
import type { Diff, DiffFile, FileText, Patch, PrCheck, PullRequest, Task, TreeFiles } from '@shared/types.ts'

/* ---------- asking the server ---------- */

type Ask = { what: 'files' | 'diff' | 'pr' } | { what: 'file' | 'patch'; path: string }
/** manual: asked by a press of Refresh (it spins then; the asks every few seconds don't) */
type Got<T> = { data?: T; error?: string; loading: boolean; manual?: boolean }

/** what each ask last got, kept while the screen is open: a tab shown again draws at once, then refreshes */
const got = new Map<string, Got<unknown>>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

const keyOf = (task: string, a: Ask) => `${task}|${a.what}|${'path' in a ? a.path : ''}`

async function ask(task: string, a: Ask, manual = false) {
  const k = keyOf(task, a)
  got.set(k, { ...(got.get(k) ?? {}), loading: true, manual })
  changed()
  try {
    const q = new URLSearchParams({ task, what: a.what, ...('path' in a ? { path: a.path } : {}) })
    const r = await fetch(`api/worktree?${q}`)
    const b = (await r.json().catch(() => ({}))) as { error?: string }
    got.set(k, r.ok ? { data: b, loading: false } : { error: b.error ?? `It said ${r.status}.`, loading: false })
  } catch {
    got.set(k, { ...(got.get(k) ?? {}), error: "Can't reach Shepherdr right now.", loading: false })
  }
  changed()
}

/** an ask's answer, asked when shown and again every `every` ms while it shows */
function useAsk<T>(task: string, a: Ask | null, every = 0): Got<T> & { reload: () => void; spin: boolean } {
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
  const now = v ?? { loading: !!a }
  // Refresh spins while you asked, or while nothing has come yet; a quiet ask now and then doesn't spin it
  return { ...now, spin: now.loading && (!!now.manual || !now.data), reload: () => a && ask(task, a, true) }
}

/* ---------- a tree of paths ---------- */

interface Node {
  name: string
  path: string
  kids?: Node[]
}

/** paths as a tree, folders first; `squash` joins a folder with its only folder ("src/webhooks") */
export function treeOf(paths: string[], squash = false): Node[] {
  const root: Node = { name: '', path: '', kids: [] }
  for (const p of paths) {
    let at = root
    const parts = p.split('/')
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1) return at.kids!.push({ name, path })
      let next = at.kids!.find((k) => k.kids && k.name === name)
      if (!next) at.kids!.push((next = { name, path, kids: [] }))
      at = next
    })
  }
  const tidy = (n: Node): Node => {
    if (!n.kids) return n
    let kids = n.kids.map(tidy).sort((a, b) => (!!b.kids === !!a.kids ? a.name.localeCompare(b.name) : a.kids ? -1 : 1))
    let out: Node = { ...n, kids }
    while (squash && out.path && out.kids!.length === 1 && out.kids![0].kids) {
      const only = out.kids![0]
      out = { name: `${out.name}/${only.name}`, path: only.path, kids: only.kids }
      kids = out.kids!
    }
    return out
  }
  return tidy(root).kids!
}

/** a tree's rows as they show: an open folder's rows under it */
function rowsOf(nodes: Node[], open: Set<string>, depth = 0): { node: Node; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...(n.kids && open.has(n.path) ? rowsOf(n.kids, open, depth + 1) : [])])
}

/**
 * A tree of files: a folder opens and shuts, a file is picked. One row is in the Tab order; the arrow keys walk the
 * rows (right opens a folder, left shuts it or goes to its folder), Enter picks.
 */
function Tree({
  nodes,
  open,
  setOpen,
  picked,
  onPick,
  meta,
  label,
}: {
  nodes: Node[]
  open: Set<string>
  setOpen: (s: Set<string>) => void
  picked?: string
  onPick: (path: string) => void
  meta?: (path: string) => ReactNode
  label: string
}) {
  const rows = rowsOf(nodes, open)
  const [cur, setCur] = useState(picked ?? rows[0]?.node.path)
  const ref = useRef<HTMLDivElement>(null)
  const at = Math.max(0, rows.findIndex((r) => r.node.path === cur))
  const focus = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))]
    if (!r) return
    setCur(r.node.path)
    ref.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(r.node.path)}"]`)?.focus()
  }
  const flip = (n: Node, to?: boolean) => {
    const s = new Set(open)
    if (to ?? !s.has(n.path)) s.add(n.path)
    else s.delete(n.path)
    setOpen(s)
  }
  const key = (e: KeyboardEvent) => {
    const r = rows[at]
    if (!r) return
    const k = e.key
    if (k === 'ArrowDown') focus(at + 1)
    else if (k === 'ArrowUp') focus(at - 1)
    else if (k === 'Home') focus(0)
    else if (k === 'End') focus(rows.length - 1)
    else if (k === 'ArrowRight' && r.node.kids) open.has(r.node.path) ? focus(at + 1) : flip(r.node, true)
    else if (k === 'ArrowLeft') {
      if (r.node.kids && open.has(r.node.path)) flip(r.node, false)
      else for (let i = at - 1; i >= 0; i--) if (rows[i].depth < r.depth) return (e.preventDefault(), focus(i))
    } else return
    e.preventDefault()
  }
  return (
    <div ref={ref} role="tree" aria-label={label} onKeyDown={key} className="py-1">
      {rows.map(({ node: n, depth }, i) => (
        <button
          key={n.path}
          type="button"
          role="treeitem"
          data-path={n.path}
          aria-expanded={n.kids ? open.has(n.path) : undefined}
          aria-selected={!n.kids ? n.path === picked : undefined}
          aria-level={depth + 1}
          tabIndex={i === at ? 0 : -1}
          onFocus={() => setCur(n.path)}
          onClick={() => (setCur(n.path), n.kids ? flip(n) : onPick(n.path))}
          style={{ '--depth': depth } as CSSProperties}
          className="press mx-1.5 flex h-8 w-[calc(100%---spacing(3))] items-center gap-1.5 rounded-row pr-2 pl-[calc(--spacing(1.5)+var(--depth)*--spacing(3.5))] text-left text-[0.8125rem] text-fg hover:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] focus-visible:outline-none aria-selected:bg-sel aria-selected:hover:bg-sel coarse:h-11 phone:h-11 phone:text-[0.9375rem]"
        >
          {n.kids ? (
            <NextIcon className={clsx('size-3.5 shrink-0 text-fg3 motion-safe:transition-transform', open.has(n.path) && 'rotate-90')} />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          {n.kids ? open.has(n.path) ? <FolderOpenIcon className={clsx(ic, 'text-fg3')} /> : <FolderIcon className={clsx(ic, 'text-fg3')} /> : <FileIcon className={clsx(ic, 'text-fg3')} />}
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
          {meta?.(n.path)}
        </button>
      ))}
    </div>
  )
}

/* ---------- the two panes: a list, and what is picked in it ---------- */

/**
 * A list beside what is picked in it when the panel is wide; when it is narrow (a phone), one at a time: the list,
 * then the pick with a way back.
 */
function Panes({ list, pick, picked, onBack, back = 'All files' }: { list: ReactNode; pick: ReactNode; picked: boolean; onBack: () => void; back?: string }) {
  return (
    <div className="@container/pane flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-rows-1 @[40rem]/pane:grid-cols-[minmax(220px,32%)_minmax(0,1fr)]">
        <div className={clsx('flex min-h-0 flex-col @[40rem]/pane:border-r @[40rem]/pane:border-line', picked && '@max-[40rem]/pane:hidden')}>{list}</div>
        <div className={clsx('flex min-h-0 min-w-0 flex-col', !picked && '@max-[40rem]/pane:hidden')}>
          {picked ? (
            <>
              <Back.Provider value={{ label: back, go: onBack }}>{pick}</Back.Provider>
            </>
          ) : (
            <div className="grid flex-1 place-items-center px-6">
              <Small className="text-fg3">Pick a file to see it here.</Small>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** the way back to the list, for the bar over what is picked in it: shown only while the two take turns */
const Back = createContext<{ label: string; go: () => void } | null>(null)

/** A quiet bar over a list or a file: Back to the list when it's narrow, what it is, then its buttons */
function Bar({ children, onReload, loading }: { children: ReactNode; onReload?: () => void; loading?: boolean }) {
  const back = useContext(Back)
  return (
    <div className={clsx('flex min-h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 text-[0.75rem] text-fg2 phone:min-h-11 phone:text-[0.875rem]', back ? 'pl-1.5 @[40rem]/pane:pl-3' : 'pl-3')}>
      {back ? (
        <IconButton label={`Back to ${back.label.toLowerCase()}`} onClick={back.go} className="@[40rem]/pane:hidden">
          <BackIcon className={ic} />
        </IconButton>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {onReload ? (
        <IconButton label="Refresh" onClick={onReload} className={clsx(loading && '[&>svg]:motion-safe:animate-spin')}>
          <ReloadIcon className={ic} />
        </IconButton>
      ) : null}
    </div>
  )
}

function Note({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <div className="px-4 py-6 text-center">
      <Small className={clsx('font-sans text-pretty', error ? 'text-need-fg' : 'text-fg3')}>{children}</Small>
    </div>
  )
}

/** a path cut short at its start, so its file name always shows */
function PathText({ path }: { path: string }) {
  const at = path.lastIndexOf('/')
  return (
    <span title={path} className="flex min-w-0 font-mono">
      {at > 0 ? <span className="min-w-0 truncate text-fg3 [direction:rtl]">{path.slice(0, at)}</span> : null}
      <span className="shrink-0 text-fg">
        {at > 0 ? <span className="text-fg3">/</span> : null}
        {path.slice(at + 1)}
      </span>
    </span>
  )
}

/** what a panel item has picked, by task (kept while the screen is open, so another tab and back keeps it) */
function usePicked(task: string, item: string): [string | undefined, (p: string | undefined) => void] {
  const k = `${task}|${item}`
  const v = useStore((s) => s.ui.picked[k])
  return [v || undefined, (p) => setUI((ui) => ({ picked: { ...ui.picked, [k]: p ?? '' } }))]
}

/* ---------- code ---------- */

function useHighlighter() {
  const [h, setH] = useState(highlighter)
  useEffect(() => {
    if (!h) loadHighlighter().then(setH, () => undefined)
  }, [h])
  return h
}

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

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

/* ---------- Files ---------- */

/** the up and down arrows walk a list of buttons, which is one stop for Tab */
function walk(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
  const at = all.indexOf(document.activeElement as HTMLButtonElement)
  const to = all[Math.min(all.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
  if (!to) return
  e.preventDefault()
  all.forEach((b) => (b.tabIndex = b === to ? 0 : -1))
  to.focus()
}

function FilesView({ task }: { task: Task }) {
  const tree = useAsk<TreeFiles>(task.id, { what: 'files' })
  const [picked, pick] = usePicked(task.id, 'files')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(() => new Set<string>(picked ? picked.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/')) : []))
  const files = tree.data?.files ?? []
  const nodes = useMemo(() => treeOf(files), [files])
  const found = q.trim() ? files.filter((f) => f.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 300) : null
  const list = (
    <>
      <Bar onReload={tree.reload} loading={tree.spin}>
        <label className="flex min-w-0 flex-1 items-center gap-1.5">
          <SearchIcon className={clsx(ic, 'text-fg3')} />
          <input
            name="find-file"
            aria-label="Find a file"
            placeholder={tree.data ? `Find in ${files.length}${tree.data.more ? '+' : ''} files` : 'Find a file'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg3 phone:text-[1rem]"
          />
        </label>
      </Bar>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        {tree.error ? (
          <Note error>{tree.error}</Note>
        ) : !tree.data ? (
          <Note>Reading its files…</Note>
        ) : found ? (
          found.length ? (
            <div role="list" aria-label="Files found" onKeyDown={walk} className="py-1">
              {found.map((f, i) => (
                <div key={f} role="listitem">
                  <button
                    type="button"
                    tabIndex={i ? -1 : 0}
                    aria-current={f === picked || undefined}
                    onClick={() => pick(f)}
                    className="press mx-1.5 flex h-8 w-[calc(100%---spacing(3))] items-center gap-1.5 rounded-row px-2 text-left text-[0.8125rem] hover:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] focus-visible:outline-none aria-current:bg-sel coarse:h-11 phone:h-11 phone:text-[0.9375rem]"
                  >
                    <FileIcon className={clsx(ic, 'text-fg3')} />
                    <PathText path={f} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Note>No file matches “{q.trim()}”.</Note>
          )
        ) : files.length ? (
          <Tree label="Files" nodes={nodes} open={open} setOpen={setOpen} picked={picked} onPick={pick} />
        ) : (
          <Note>No files yet.</Note>
        )}
      </div>
    </>
  )
  return <Panes list={list} picked={!!picked} onBack={() => pick(undefined)} pick={picked ? <FileView key={picked} task={task} path={picked} /> : null} />
}

function FileView({ task, path }: { task: Task; path: string }) {
  const f = useAsk<FileText>(task.id, { what: 'file', path })
  return (
    <>
      <Bar onReload={f.reload} loading={f.spin}>
        <PathText path={path} />
        {f.data ? <span className="shrink-0 text-fg3 tabular-nums">{bytes(f.data.size)}</span> : null}
      </Bar>
      {f.error ? (
        <Note error>{f.error}</Note>
      ) : !f.data ? (
        <Note>Reading it…</Note>
      ) : f.data.binary ? (
        <Note>A binary file: nothing to read here.</Note>
      ) : (
        <>
          {f.data.tooBig ? <Note>Only its first megabyte shows.</Note> : null}
          <Code text={f.data.text ?? ''} path={path} />
        </>
      )}
    </>
  )
}

/* ---------- Diff ---------- */

const MARK: Record<DiffFile['status'], [string, string, string]> = {
  added: ['A', 'Added', 'text-ready-fg'],
  modified: ['M', 'Changed', 'text-work-fg'],
  deleted: ['D', 'Deleted', 'text-need-fg'],
  renamed: ['R', 'Renamed', 'text-fg2'],
}

function Counts({ add, del, className }: { add: number; del: number; className?: string }) {
  return (
    <span className={clsx('flex shrink-0 gap-1.5 font-mono text-[0.75rem] tabular-nums phone:text-[0.8125rem]', className)}>
      {add ? <span className="text-ready-fg">+{add}</span> : null}
      {del ? <span className="text-need-fg">−{del}</span> : null}
    </span>
  )
}

function DiffView({ task }: { task: Task }) {
  const d = useAsk<Diff>(task.id, { what: 'diff' }, 15_000)
  const [picked, pick] = usePicked(task.id, 'diff')
  const files = d.data?.files ?? []
  const nodes = useMemo(() => treeOf(files.map((f) => f.path), true), [files])
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])
  // every folder of a diff shows open: it is the changed files you came to see
  const [shut, setShut] = useState(new Set<string>())
  const folders = useMemo(() => {
    const all = new Set<string>()
    const walk = (ns: Node[]) => ns.forEach((n) => n.kids && (all.add(n.path), walk(n.kids)))
    walk(nodes)
    return all
  }, [nodes])
  const open = new Set([...folders].filter((p) => !shut.has(p)))
  const n = files.length
  const list = (
    <>
      <Bar onReload={d.reload} loading={d.spin}>
        {d.data ? (
          <>
            <span className="truncate">
              {n ? `${n} ${n === 1 ? 'file' : 'files'} changed` : 'No changes'} against {d.data.base}
            </span>
            <Counts add={d.data.add} del={d.data.del} />
          </>
        ) : (
          <span>Changes</span>
        )}
      </Bar>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        {d.error ? (
          <Note error>{d.error}</Note>
        ) : !d.data ? (
          <Note>Comparing it with main…</Note>
        ) : n ? (
          <Tree
            label="Changed files"
            nodes={nodes}
            open={open}
            setOpen={(s) => setShut(new Set([...folders].filter((p) => !s.has(p))))}
            picked={picked}
            onPick={pick}
            meta={(path) => {
              const f = byPath.get(path)
              if (!f) return null
              const [letter, word, tone] = MARK[f.status]
              return (
                <>
                  <Counts add={f.add} del={f.del} />
                  <span className={clsx('w-3 shrink-0 text-center font-mono text-[0.6875rem] font-semibold phone:text-[0.8125rem]', tone)}>
                    {letter}
                    <span className="sr-only"> ({f.from ? `${word} from ${f.from}` : word})</span>
                  </span>
                </>
              )
            }}
          />
        ) : (
          <Note>{task.id} hasn't changed anything against {d.data.base} yet.</Note>
        )}
      </div>
    </>
  )
  const f = picked ? byPath.get(picked) : undefined
  return <Panes list={list} picked={!!f} back="Changed files" onBack={() => pick(undefined)} pick={f ? <PatchView key={`${f.path}|${f.add}|${f.del}`} task={task} file={f} /> : null} />
}

type Line = { kind: 'hunk' | 'add' | 'del' | 'ctx' | 'note'; text: string; old?: number; new?: number }

/** a unified diff as rows: hunk headers, lines added, taken out and kept, with their old and new numbers */
export function patchLines(patch: string): Line[] {
  const out: Line[] = []
  let o = 0
  let n = 0
  let body = false
  for (const l of patch.split('\n')) {
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (h) {
      o = Number(h[1])
      n = Number(h[2])
      body = true
      out.push({ kind: 'hunk', text: l })
    } else if (!body) continue
    else if (l.startsWith('+')) out.push({ kind: 'add', text: l.slice(1), new: n++ })
    else if (l.startsWith('-')) out.push({ kind: 'del', text: l.slice(1), old: o++ })
    else if (l.startsWith(' ')) out.push({ kind: 'ctx', text: l.slice(1), old: o++, new: n++ })
    else if (l.startsWith('\\')) out.push({ kind: 'note', text: l.slice(2) })
    else if (l.startsWith('diff --git')) body = false
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
  const [, word] = MARK[file.status]
  return (
    <>
      <Bar onReload={p.reload} loading={p.spin}>
        <PathText path={file.path} />
        <span className="shrink-0 text-fg3">{file.from ? `from ${file.from}` : word}</span>
        <Counts add={file.add} del={file.del} />
      </Bar>
      {p.error ? (
        <Note error>{p.error}</Note>
      ) : !p.data ? (
        <Note>Reading its changes…</Note>
      ) : p.data.binary ? (
        <Note>A binary file: its changes can't be shown as text.</Note>
      ) : !lines.length ? (
        <Note>{file.status === 'renamed' ? 'Renamed, with no changes inside.' : 'Nothing to show.'}</Note>
      ) : (
        <div className="code-view min-h-0 flex-1 overflow-auto">
          {p.data.tooBig ? <Note>Only its first megabyte shows.</Note> : null}
          <table className="min-w-full border-collapse" aria-label={`Changes in ${file.path}`}>
            <tbody>
              {lines.map((l, i) =>
                l.kind === 'hunk' ? (
                  <tr key={i} className="bg-hover text-fg3">
                    <td colSpan={4} className="py-0.5 pr-4 pl-4 whitespace-pre" dangerouslySetInnerHTML={{ __html: html[i] }} />
                  </tr>
                ) : (
                  <tr key={i} data-line={l.kind} className="data-[line=add]:bg-add data-[line=del]:bg-del">
                    <td className="w-px pl-3 text-right align-top text-fg3 tabular-nums select-none">{l.old ?? ''}</td>
                    <td className="w-px pr-2 pl-2 text-right align-top text-fg3 tabular-nums select-none">{l.new ?? ''}</td>
                    <td aria-hidden className={clsx('w-px pr-1.5 align-top select-none', l.kind === 'add' ? 'text-ready-fg' : l.kind === 'del' ? 'text-need-fg' : 'text-fg3')}>
                      {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
                    </td>
                    <td className={clsx('pr-4 align-top whitespace-pre', l.kind === 'note' && 'text-fg3 italic')}>
                      <span className="sr-only">{l.kind === 'add' ? 'Added: ' : l.kind === 'del' ? 'Taken out: ' : ''}</span>
                      <span dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ---------- Pull request ---------- */

/** the task's PR, as gh tells it (kept a little while on the server) */
function usePr(task: Task) {
  return useAsk<{ pr: PullRequest | null; why?: string }>(task.id, { what: 'pr' }, 60_000)
}

/** greyed out until the task has a PR: what the snapshot says (SHE-59), else what gh said */
function usePrOff(task: Task) {
  const p = usePr(task)
  if (task.pr || p.data?.pr) return null
  return p.data?.why ?? (p.error ? "Couldn't ask GitHub about its pull request." : 'No pull request yet.')
}

/** a state is a soft tint with its word in the colour (red is for what needs you, so Closed is grey) */
const PR_STATE: Record<PullRequest['state'], [string, string]> = {
  open: ['Open', 'bg-ready/14 text-ready-fg'],
  draft: ['Draft', 'bg-sel text-fg2'],
  merged: ['Merged', 'bg-merged/14 text-merged'],
  closed: ['Closed', 'bg-sel text-fg2'],
}

const CHECK_ICON: Record<PrCheck['state'], [typeof CheckCircleIcon, string, string]> = {
  pass: [CheckCircleIcon, 'text-ready', 'Passed'],
  fail: [XCircleIcon, 'text-need', 'Failed'],
  pending: [ClockIcon, 'text-work', 'Running'],
  skip: [MinusCircleIcon, 'text-fg3', 'Skipped'],
}

/** "2 passed · 1 running" */
function checksLine(cs: PrCheck[]) {
  const n = (s: PrCheck['state']) => cs.filter((c) => c.state === s).length
  return [
    [n('fail'), 'failed'],
    [n('pending'), 'running'],
    [n('pass'), 'passed'],
    [n('skip'), 'skipped'],
  ]
    .filter(([k]) => k)
    .map(([k, w]) => `${k} ${w}`)
    .join(' · ')
}

function PrView({ task }: { task: Task }) {
  const p = usePr(task)
  const pr = p.data?.pr
  if (!pr) return <Note error={!!p.error}>{p.error ?? (p.data ? (p.data.why ?? 'No pull request yet.') : 'Asking GitHub…')}</Note>
  const [state, tone] = PR_STATE[pr.state]
  return (
    <>
      {/* the bar the other items have: what it is, and Refresh in the same spot */}
      <Bar onReload={p.reload} loading={p.spin}>
        <span className={clsx('rounded-full px-2 text-[0.75rem]/5 font-medium phone:text-[0.8125rem]/6', tone)}>{state}</span>
        <span className="tabular-nums">#{pr.number}</span>
      </Bar>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-4 p-4 phone:p-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-[0.9375rem]/6 font-semibold text-pretty phone:text-[1.0625rem]/7">{pr.title}</h3>
            <div>
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                // the secondary button's look (Ghost), as a link
                className="press-dim relative inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] after:absolute after:-inset-x-0.5 after:-inset-y-2 hover:bg-hover coarse:h-9 phone:h-9 phone:text-[0.875rem]"
              >
                <OpenIcon className={ic} />
                Open on GitHub
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
              <span>Checks</span>
              {pr.checks.length ? <span className="font-normal">{checksLine(pr.checks)}</span> : null}
            </div>
            {pr.checks.length ? (
              <ul role="list" className="-mx-2">
                {pr.checks.map((c, i) => {
                  const [Icon, color, word] = CHECK_ICON[c.state]
                  const body = (
                    <>
                      <Icon className={clsx(ic, color)} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="sr-only">{word}: </span>
                        {c.name}
                      </span>
                      {c.url ? <OpenIcon className={clsx(ic, 'text-fg3')} /> : null}
                    </>
                  )
                  return (
                    <li key={`${c.name}${i}`}>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer" className="press flex min-h-8 items-center gap-2 rounded-row px-2 hover:bg-hover coarse:min-h-11 phone:min-h-11">
                          {body}
                        </a>
                      ) : (
                        <div className="flex min-h-8 items-center gap-2 px-2 coarse:min-h-11 phone:min-h-11">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Small className={pr.checksError ? "text-need" : "text-fg3"}>{pr.checksError || "No checks on it."}</Small>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** a done task's worktree is put away: nothing left to browse or compare (worded as the browser's) */
const mergedOff = (task: Task) => (task.status === 'done' ? `${task.id} is done: its worktree was put away.` : null)

export default definePlugin({
  name: 'worktree',
  setup(reg) {
    reg.taskPanel.push(
      { id: 'files', order: 20, label: 'Files', Icon: FolderIcon, useOff: mergedOff, View: FilesView },
      { id: 'diff', order: 30, label: 'Diff', Icon: DiffIcon, useOff: mergedOff, View: DiffView },
      { id: 'pr', order: 40, label: 'Pull request', Icon: PrIcon, useOff: usePrOff, View: PrView },
    )
  },
})
