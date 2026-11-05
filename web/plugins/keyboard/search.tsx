// Jump (Ctrl+K), as the window's: one box over spaces, tasks and artifacts (and machines, once there are others), each
// group with its count, newest first, eight rows and then "Show N more". Every word typed is in the row somewhere.
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { goPlace, openArtifact, openTask, setUI, useSnap, useUI, getState, listView, type UI } from '@client/kernel.ts'
import { Sheet } from '@client/Stack.tsx'
import { sectionOf } from '@client/Settings.tsx'
import { Dot, ic, PageIcon, SearchIcon, ServerIcon } from '@client/ui.tsx'
import { showInPanel } from '@plugins/artifacts/client.tsx'
import type { Snapshot, TaskStatus } from '@shared/types.ts'

type Kind = 'space' | 'task' | 'artifact' | 'machine'
const KINDS: Kind[] = ['space', 'task', 'artifact', 'machine']
const GROUP: Record<Kind, string> = { space: 'Spaces', task: 'Tasks', artifact: 'Artifacts', machine: 'Machines' }
const SHOWN = 8
const STATUS: Record<TaskStatus, string> = { need: 'Needs you', work: 'Working', merging: 'Merging', ready: 'Ready', queued: 'Queued', scheduled: 'Scheduled', todo: 'To do', done: 'Done' } as Record<TaskStatus, string>

type Item = { kind: Kind; key: string; label: string; sub: string; at: number; icon?: string; ref?: string; status?: TaskStatus; pct?: number; active?: boolean; go: () => void }

/** every word typed is in one of these, any case */
const matches = (q: string, ...fields: (string | undefined | null)[]) => {
  const all = fields.filter(Boolean).join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => all.includes(w))
}
const capital = (s: string) => (/^[a-z](?![A-Z])/.test(s) ? s[0].toUpperCase() + s.slice(1) : s)
/** "now", "5m ago", "3h ago", "2d ago", else the date */
function ago(at: number) {
  if (!at) return null
  const m = Math.floor((Date.now() - at) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`
  return new Date(at).toLocaleDateString()
}

function itemsOf(snap: Snapshot, q: string, ui: UI, fromChat: boolean): Item[] {
  const out: Item[] = []
  const machines = snap.machines ?? []
  const remote = machines.length > 1
  const machineName = (m?: string) => machines.find((x) => x.machine === m)?.name ?? m ?? 'This computer'
  const placeName = (id: string) => snap.places.find((p) => p.id === id)?.name
  for (const p of snap.places) {
    // 3.0's Jump: "<folder>", with "<machine> · " first where there are other machines
    const where = [remote ? machineName(p.machine) : null, p.where || '~'].filter(Boolean).join(' · ')
    if (q && !matches(q, p.name, machineName(p.machine), p.where)) continue
    out.push({ kind: 'space', key: `s:${p.id}`, label: p.name, icon: p.emoji ?? '#', sub: where, at: p.changedAt ?? 0, active: p.id === ui.place, go: () => goPlace(p.id) })
  }
  for (const t of snap.tasks) {
    if (t.archived && !q) continue
    const place = [t.listName || placeName(t.place), remote ? machineName(snap.places.find((p) => p.id === t.place)?.machine) : null].filter(Boolean).join(' · ')
    const line = t.sub ?? t.said ?? ''
    if (q && !matches(q, t.id, t.name, line, place)) continue
    out.push({
      kind: 'task', key: `t:${t.id}`, ref: t.id, label: t.name, status: t.status, pct: t.report?.progress,
      sub: [t.archived ? 'Archived' : STATUS[t.status], line && capital(line.split('\n')[0]), place].filter(Boolean).join(' · '),
      at: Math.max(t.archived ?? 0, t.doneAt ?? 0, t.at ?? 0),
      go: () => {
        openTask(t.id)
        const { ui, snap } = getState()
        if (t.archived && snap) setUI({ archived: listView(ui, snap).key })
      },
    })
  }
  for (const a of snap.artifacts ?? []) {
    // the space in its folder, else its folder's name
    const place = placeName(a.place) || a.folderName
    const on = a.machine ?? snap.host
    if (q && !matches(q, a.title, a.id, a.task, place, a.folder, remote ? machineName(on) : null)) continue
    out.push({
      kind: 'artifact', key: `a:${a.machine ?? ''}:${a.id}`, label: a.title || a.id, sub: [a.task, place, remote ? machineName(on) : null, `v${a.v}`, ago(a.at)].filter(Boolean).join(' · '), at: a.at ?? 0,
      // over the chat the keyboard was in, as its card opens it; else in the Artifacts list beside it
      go: () => (fromChat ? openArtifact(a.id) : showInPanel(a.id)),
    })
  }
  if (remote)
    for (const m of machines) {
      const n = snap.places.filter((p) => p.machine === m.machine).length
      if (q && !matches(q, m.name)) continue
      const first = snap.places.find((p) => p.machine === m.machine)
      out.push({
        kind: 'machine', key: `m:${m.machine}`, label: m.name, sub: [`${n} space${n === 1 ? '' : 's'}`, m.status === 'off' ? 'Offline' : null].filter(Boolean).join(' · '), at: 0,
        // its first space, else Settings › Machines
        go: () => {
          if (first) return goPlace(first.id)
          const { ui } = getState()
          setUI({ settings: { section: Math.max(0, sectionOf('Machines', snap.settings, { ...ui, settings: { section: 0 } } as UI)) } })
        },
      })
    }
  // newest first in each group (a space by when its tabs last changed); ties keep the sidebar's order (a stable sort)
  return out.sort((a, b) => b.at - a.at)
}

export function Search({ onClose }: { onClose: () => void }) {
  const snap = useSnap()
  const place = useUI((u) => u.place)
  // the keyboard was in a chat's box as Jump opened: an artifact opens over that chat, as its card there would
  const [fromChat] = useState(() => !!document.activeElement?.closest('[data-composer]'))
  const [q, setQ] = useState('')
  const [more, setMore] = useState<Set<Kind>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const query = q.trim()
  const rows = useMemo(() => {
    if (!snap) return []
    const all = itemsOf(snap, query, { ...getState().ui, place }, fromChat)
    const list: ({ head: Kind; count: number } | { more: Kind; count: number } | Item)[] = []
    for (const kind of KINDS) {
      const mine = all.filter((x) => x.kind === kind)
      if (!mine.length) continue
      list.push({ head: kind, count: mine.length })
      const shown = more.has(kind) ? mine : mine.slice(0, SHOWN)
      list.push(...shown)
      if (mine.length > shown.length) list.push({ more: kind, count: mine.length - shown.length })
    }
    return list
  }, [snap, query, more, place, fromChat])
  // task ids in a column of one width, so titles line up (the window's monospace id column)
  const idWidth = Math.max(0, ...rows.map((r) => ('ref' in r && r.ref ? r.ref.length : 0)))
  const pickable = rows.filter((r) => !('head' in r)) as (Item | { more: Kind; count: number })[]
  const keyOf = (r: Item | { more: Kind }) => ('more' in r ? `more:${r.more}` : r.key)
  const at = Math.max(0, pickable.findIndex((r) => keyOf(r) === sel))
  const cur = pickable[at]
  useEffect(() => { if (cur) document.getElementById(`jump-${keyOf(cur)}`)?.scrollIntoView({ block: 'nearest' }) }, [cur && keyOf(cur)])
  const go = (r?: Item | { more: Kind; count: number }) => {
    if (!r) return
    if ('more' in r) {
      setMore(new Set([...more, r.more]))
      setSel(null)
      return
    }
    onClose()
    r.go()
  }
  const move = (d: number) => {
    if (!pickable.length) return
    setSel(keyOf(pickable[Math.max(0, Math.min(pickable.length - 1, at + d))]))
  }
  return (
    <Sheet label="Jump" onClose={onClose} panel="max-w-[640px]">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4">
        <SearchIcon className={clsx(ic, 'text-fg3')} />
        <input
          autoFocus
          name="search"
          role="combobox"
          aria-expanded="true"
          aria-controls="jump-list"
          aria-activedescendant={cur ? `jump-${keyOf(cur)}` : undefined}
          aria-label="Search spaces, tasks, artifacts"
          placeholder="Search spaces, tasks, artifacts"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(null); setMore(new Set()) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) { e.preventDefault(); move(1) }
            else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) { e.preventDefault(); move(-1) }
            else if (e.key === 'Enter') { e.preventDefault(); go(cur) }
            else if (e.key === 'Escape') onClose()
          }}
          className="h-12 min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg3 phone:h-14 phone:text-[1rem]"
        />
      </div>
      <div id="jump-list" role="listbox" aria-label="Results" className="max-h-[60vh] min-h-0 overflow-y-auto overscroll-contain p-1.5 phone:max-h-none phone:flex-1 phone:pb-[calc(env(safe-area-inset-bottom)+8px)]">
        {!rows.length ? (
          <p className="grid h-30 place-items-center text-[0.8125rem] text-fg3 phone:text-[0.9375rem]">{!snap ? 'Reading tasks and artifacts…' : query ? 'Nothing found. Try fewer words.' : 'Nothing here.'}</p>
        ) : (
          rows.map((r) => {
            if ('head' in r)
              return (
                <h3 key={`h:${r.head}`} className="flex gap-1.5 px-2.5 pt-2.5 pb-1 text-[0.75rem] font-medium text-fg3 tabular-nums phone:text-[0.8125rem]">
                  {GROUP[r.head]}
                  <span>{r.count}</span>
                </h3>
              )
            const k = keyOf(r)
            if ('more' in r)
              return (
                <button key={k} id={`jump-${k}`} type="button" role="option" aria-selected={cur && keyOf(cur) === k} onClick={() => go(r)}
                  className="flex h-9 w-full items-center rounded-row px-2.5 text-[0.8125rem] text-focus hover:bg-hover aria-selected:bg-hover phone:h-11 phone:text-[0.9375rem]">
                  Show {r.count} more
                </button>
              )
            return (
              <div key={k} id={`jump-${k}`} role="option" tabIndex={-1} aria-selected={cur && keyOf(cur) === k} onClick={() => go(r)}
                className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-row px-2.5 py-1.5 hover:bg-hover aria-selected:bg-hover phone:min-h-14">
                <span className="grid w-4 shrink-0 place-items-center text-fg3">
                  {r.kind === 'task' ? <Dot s={r.status ?? 'todo'} p={r.status === 'work' ? r.pct : undefined} />
                    : r.kind === 'artifact' ? <PageIcon className={ic} />
                      : r.kind === 'machine' ? <ServerIcon className={ic} />
                        : <span className="text-[0.9375rem]">{r.icon}</span>}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-2">
                    {r.ref ? <span className="shrink-0 font-mono text-[0.6875rem] text-fg3" style={{ width: `${idWidth}ch` }}>{r.ref}</span> : null}
                    <span className={clsx('truncate text-[0.875rem] phone:text-[1rem]', r.active && 'font-semibold')}>{r.label}</span>
                  </span>
                  {r.sub ? <span className="truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{r.sub}</span> : null}
                </span>
              </div>
            )
          })
        )}
      </div>
    </Sheet>
  )
}
