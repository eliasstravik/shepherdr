// Diff viewer (off until switched on in Settings › Plugins): the Changes pane, beside Tasks and Artifacts. It shows
// what a task changed against its base (its branch, committed or not), or what isn't committed yet in a space's own
// folder, file by file; tap a file for its lines. Read only: nothing is staged, committed or edited here. The service
// reads git on the task's or space's machine (service/worktree.ts, GET /api/worktree).
import { useCallback, useEffect, useState } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { definePlugin, getState, setUI, togglePane, useSnap, useUI } from '@client/kernel.ts'
import { openMenu } from '@client/overlay.tsx'
import { cx, Empty, Hd, I, IB, Row } from '@client/ui.tsx'
import type { Diff, DiffFile, Patch, Snapshot } from '@shared/types.ts'
import { isEverything } from '@shared/view.ts'
import { hasFolder, lineKind, sourcesOf, splitPath } from './lines.ts'
import './diff.css'

type Src = { kind: 'task' | 'space'; id: string }
const srcKey = (s: Src) => `${s.kind}:${s.id}`
const parse = (k: string | undefined | null): Src | null => {
  const m = /^(task|space):(.+)$/.exec(k ?? '')
  return m ? { kind: m[1] as Src['kind'], id: m[2] } : null
}
const query = (s: Src, what: string, path?: string) =>
  `api/worktree?${s.kind}=${encodeURIComponent(s.id)}&what=${what}${path ? `&path=${encodeURIComponent(path)}` : ''}`

async function get<T>(url: string): Promise<T | { error: string }> {
  try {
    const r = await fetch(url, { headers: { 'x-shepherdr': '1' } })
    return (await r.json()) as T | { error: string }
  } catch {
    return { error: "Shepherdr didn't answer. Try again." }
  }
}

/** open the Changes pane on a task, at one of its files (a Ready card's file list) */
export function openDiff(task: string, file: string | null = null) {
  setUI({ pane: 'diff', task: null, art: null, artWide: false, drawer: false, search: false, diff: { src: `task:${task}`, file } })
}

/** what the pane shows when nothing was picked: the open task, else this space's folder, else the first task */
function pick(snap: Snapshot, at: string, picked: string | undefined): Src | null {
  const list = sourcesOf(snap, at)
  const p = parse(picked)
  if (p && list.some((s) => s.key === srcKey(p))) return p
  const ui = getState().ui
  const open = ui.task ?? ui.max
  if (open && list.some((s) => s.key === `task:${open}`)) return { kind: 'task', id: open }
  return parse(list[0]?.key)
}

function useLoad<T>(url: string | null) {
  const [got, setGot] = useState<{ url: string; v: T | { error: string } } | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!url) return
    let live = true
    void get<T>(url).then((v) => live && setGot({ url, v }))
    return () => { live = false }
  }, [url, n])
  const again = useCallback(() => setN((x) => x + 1), [])
  return { v: got && got.url === url ? got.v : null, again }
}

const plusMinus = (add: number, del: number) => (
  <span className="dnums">
    {add > 0 && <span className="a">+{add}</span>}
    {del > 0 && <span className="d">−{del}</span>}
  </span>
)

const WORD: Record<DiffFile['status'], string> = { added: 'New', deleted: 'Deleted', renamed: 'Renamed', modified: '' }

function FileList({ src, diff, open }: { src: Src; diff: Diff; open: (path: string) => void }) {
  if (!diff.files.length)
    return <Empty title="Nothing changed">{src.kind === 'space' ? 'Everything in this folder is committed.' : diff.against ? `No changes against ${diff.against}.` : 'Nothing new since its last commit.'}</Empty>
  return (
    <>
      <div className="lab">
        {diff.against ? `Against ${diff.against}` : 'Not committed yet'} · {diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}
      </div>
      {diff.files.map((f) => {
        const { dir, name } = splitPath(f.path)
        return (
          <Row key={f.path} className="dfile" two label={name} sub={[WORD[f.status], dir].filter(Boolean).join(' · ') || undefined}
            end={f.binary ? <span className="v">Binary</span> : plusMinus(f.add, f.del)} onClick={() => open(f.path)} />
        )
      })}
    </>
  )
}

function FileDiff({ patch }: { patch: Patch }) {
  if (patch.binary) return <Empty>A binary file: no lines to show.</Empty>
  const lines = patch.text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const shown = lines.map((l) => ({ l, k: lineKind(l) })).filter((x) => x.k !== 'meta')
  if (!shown.length) return <Empty>No lines changed in this file.</Empty>
  return (
    <div className="dlines" role="table" aria-label={`Changes in ${patch.path}`}>
      {shown.map((x, i) => (
        <div key={i} role="row" className={cx('dl', x.k)}>
          {x.k === 'hunk' ? x.l.replace(/^@@[^@]*@@ ?/, '') || '…' : x.l.slice(1) || ' '}
        </div>
      ))}
      {patch.tooBig && <div className="dl hunk">The rest of this file's changes are too long to show here.</div>}
    </div>
  )
}

function DiffPane() {
  const snap = useSnap()
  const ui = useUI()
  const src = snap ? pick(snap, ui.at, ui.diff?.src) : null
  const file = ui.diff?.file ?? null
  const list = useLoad<Diff>(src ? query(src, 'diff') : null)
  const one = useLoad<Patch>(src && file ? query(src, 'patch', file) : null)
  if (!snap) return null
  const sources = sourcesOf(snap, ui.at)
  const name = sources.find((s) => src && s.key === srcKey(src))?.label ?? ''
  const close = !ui.phone && <IB icon="x" label="Close" onClick={() => togglePane(null)} />
  const choose = (e: { currentTarget: Element }) =>
    openMenu(e.currentTarget, sources.map((s) => ({ icon: s.icon, label: s.label, value: s.sub, on: !!src && s.key === srcKey(src), run: () => setUI({ diff: { src: s.key, file: null } }) })), { label: 'Show changes of' })

  if (src && file) {
    const { dir, name: fname } = splitPath(file)
    const p = one.v
    return (
      <PaneFrame flush scrollKey={`diff:${srcKey(src)}:${file}`}
        head={(sc) => (
          <Hd back={{ label: 'Back to changes', run: () => setUI({ diff: { src: srcKey(src), file: null } }) }} title={fname} sub={dir || name} scrolled={sc}>
            <IB icon="reload" label="Refresh" onClick={one.again} />
            {close}
          </Hd>
        )}
      >
        {!p ? <Empty>Loading…</Empty> : 'error' in p ? <Empty title="Can't show this file">{p.error}</Empty> : <FileDiff patch={p} />}
      </PaneFrame>
    )
  }

  const d = list.v
  return (
    <PaneFrame scrollKey={`diff:${src ? srcKey(src) : ''}`}
      head={(sc) => (
        <Hd title="Changes" pad={ui.phone ? 12 : 4} scrolled={sc}>
          <IB icon="reload" label="Refresh" onClick={list.again} />
          {close}
        </Hd>
      )}
    >
      {!src ? (
        <Empty title="Nothing to show">{isEverything(snap, ui.at) ? 'No space or task with a folder yet.' : 'This space has no folder or task to show.'}</Empty>
      ) : (
        <>
          <Row className="dsrc" icon={src.kind === 'task' ? 'tasks' : 'folder'} label={name} sub={sources.find((s) => s.key === srcKey(src))?.sub}
            end={<I n="down" c="s16 c-mute" />} aria-haspopup="menu" onClick={choose} />
          {!d ? <Empty>Loading…</Empty> : 'error' in d ? <Empty title="Can't show its changes">{d.error}</Empty> : <FileList src={src} diff={d} open={(path) => setUI({ diff: { src: srcKey(src), file: path } })} />}
        </>
      )}
    </PaneFrame>
  )
}

function DiffButton() {
  const on = useUI((u) => u.pane === 'diff')
  return <IB icon="branch" label="Changes" pressed={on} onClick={() => togglePane('diff')} />
}

export default definePlugin({
  name: 'diff',
  setup(reg) {
    reg.commands.push({ id: 'diff.open', title: 'Open Changes', area: 'Go to', icon: 'branch', words: 'diff viewer changed files git', run: () => setUI((ui) => (ui.pane === 'diff' && !ui.diff?.file ? {} : { pane: 'diff', task: null, art: null, artWide: false, diff: ui.diff ? { ...ui.diff, file: null } : null })) })
    reg.header.push({ order: 45, View: DiffButton })
    reg.bar.push({ order: 40, pane: 'diff', label: 'Changes', icon: 'branch' })
    reg.panes.push({ id: 'diff', View: DiffPane })
    // a task's menu: what it changed
    reg.taskMenu.push({ order: 30, rows: (t) => (hasFolder(t) ? [{ icon: 'branch', label: 'Changes', run: () => openDiff(t.id) }] : []) })
  },
})

