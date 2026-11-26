// The command palette (SHEP-470): Cmd+K on a Mac, Ctrl+K elsewhere, or the list's search button. One box that finds
// anything (spaces, tasks, repos, artifacts, schedules, settings pages) and runs any command, the way Linear's, GitHub's
// and T3 Code's do: recent picks first, then what acts on the task or space in focus, then every command; typing ranks
// everything by a fuzzy match. "> " keeps to commands (VS Code's, GitHub's), "# " to spaces, "@ " to tasks. Each row
// shows its shortcut. Up and Down move, Enter runs, Esc closes; by touch, a tap.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { definePlugin, getState, go, openArtifact, openSettings, registry, setUI, useSnap, type Command, type MenuRow } from '@client/kernel.ts'
import { available, focusTask, keysOf, recents, runCommand, used } from '@client/commands.ts'
import { fuzzy } from '@client/keys.ts'
import { Kbd } from '@client/kbd.tsx'
import { ALL } from '@client/settings.tsx'
import { spaceRows } from '@client/list.tsx'
import { I, Row } from '@client/ui.tsx'
import type { IconName } from '@client/icons.ts'
import { SpaceIcon } from '@client/space-icon.tsx'
import { open as openTask, showRepo, taskRows } from '@plugins/tasks/client.tsx'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import type { Snapshot } from '@shared/types.ts'
import { agoShort, artifactsIn, everything, machineLabel, placeOf, reposOf, spaceLabel, spaceName, spacesOf, workName, workWords } from '@shared/view.ts'

type Kind = 'Command' | 'Space' | 'Task' | 'Repo' | 'Artifact' | 'Schedule' | 'Settings' | 'Action'
interface Item {
  /** what recents keep: "cmd:<id>", "space:<id>", … */
  key: string
  kind: Kind
  label: string
  sub?: string
  icon?: IconName
  lead?: ReactNode
  /** a shortcut to show */
  chord?: string
  /** more words it is found by */
  words?: string
  /** a task's key (SHOP-12): found by its start, typed with or without the dash */
  ref?: string
  /** only once something is typed (an archived task, as 3.1's Jump) */
  typed?: boolean
  run: () => void
}

/** the areas' order: the sheet's */
const AREAS = ['General', 'Go to', 'Spaces', 'Chat', 'Tasks', 'Terminal', 'Voice']

const KIND_WORD: Record<Kind, string> = { Command: '', Action: '', Space: 'Space', Task: 'Task', Repo: 'Folder', Artifact: 'Artifact', Schedule: 'Schedule', Settings: 'Settings' }

const fromCommand = (c: Command): Item => ({ key: `cmd:${c.id}`, kind: 'Command', label: c.title, icon: c.icon, chord: keysOf(c.id)[0], words: `${c.area} ${c.words ?? ''}`, run: () => runCommand(c) })

/** a menu's rows as palette rows, a sub-menu's rows flattened ("Move to › #web") */
function fromRows(rows: MenuRow[], of: string, prefix: string, cmds: Set<string>): Item[] {
  return rows.flatMap((r): Item[] => {
    if (r.cmd && cmds.has(r.cmd)) return []
    if (r.sub) return r.sub.map((s) => ({ key: `${prefix}:${r.label}›${s.label}`, kind: 'Action', label: `${r.label} › ${s.label}`, sub: of, icon: r.icon, run: () => s.run?.() }))
    return r.run ? [{ key: `${prefix}:${r.label}`, kind: 'Action', label: r.label, sub: of, icon: r.icon, chord: r.cmd ? keysOf(r.cmd)[0] : undefined, run: r.run }] : []
  })
}

/** everything the palette can show now */
function itemsOf(snap: Snapshot): { things: Item[]; commands: Item[]; actions: Item[] } {
  const ui = getState().ui
  // General first, then going places, as the sheet orders them; the palette itself isn't one of its rows
  const area = (a: string) => ((i) => (i < 0 ? 99 : i))(AREAS.indexOf(a))
  const cmds = registry.commands.filter((c) => !c.hidden && c.id !== 'search.palette' && available(c)).map((c, i) => ({ c, i })).sort((a, b) => area(a.c.area) - area(b.c.area) || a.i - b.i).map((x) => x.c)
  const commands = cmds.map(fromCommand)
  const ids = new Set(cmds.map((c) => c.id))
  // what acts on the task in focus, then on the space shown: their menus' rows
  const t = focusTask()
  const tRows = t ? taskRows(t, 'thread') : null
  const sRows = ui.at ? spaceRows(ui.at, true) : null
  const actions = [...(t && tRows ? fromRows(tRows, t.name, `task-act:${t.id}`, ids) : []), ...(sRows && !t ? fromRows(sRows, spaceLabel(snap, ui.at), `space-act:${ui.at}`, ids) : [])]
  const ev = everything(snap)
  // spaces whose Assistant changed last first (3.1's Jump): the ones in use now on top
  const byUse = spacesOf(snap).map((p, i) => ({ p, i })).sort((a, b) => (b.p.changedAt ?? 0) - (a.p.changedAt ?? 0) || a.i - b.i).map((x) => x.p)
  const spaces: Item[] = [...(ev ? [ev] : []), ...byUse].map((p) => ({
    key: `space:${p.id}`, kind: 'Space', label: p.id === ev?.id ? 'Everything' : spaceName(snap, p), sub: p.id === ev?.id ? undefined : machineLabel(snap, p.machine) + (p.archived ? ' · archived' : ''), lead: <SpaceIcon snap={snap} id={p.id} />, run: () => go(p.id),
  }))
  // archived ones too, once something is typed; each with its key (SHOP-12), as the task's chat names it
  const tasks: Item[] = snap.tasks.map((x) => {
    const ref = x.id.slice(x.id.lastIndexOf(':') + 1)
    return { key: `task:${x.id}`, kind: 'Task', label: x.name, sub: [ref, x.archived ? 'Archived' : '', workWords(snap, x)].filter(Boolean).join(' · '), words: workName(x), ref, typed: !!x.archived, lead: <StatusIcon t={x} time="side" />, run: () => openTask(x) }
  })
  const repos: Item[] = reposOf(snap).filter((r) => r.tasks.length).map((r) => ({ key: `repo:${r.key}`, kind: 'Repo', label: r.name, sub: [r.short, snap.machines.length > 1 ? machineLabel(snap, r.machine) : ''].filter(Boolean).join(' · '), icon: 'folder', run: () => showRepo(r.key) }))
  const arts: Item[] = ev ? artifactsIn(snap, ev.id).map((a) => ({ key: `art:${a.id}`, kind: 'Artifact', label: a.title, sub: `${spaceLabel(snap, a.place)} · ${agoShort(a.at)}`, icon: 'doc', run: () => openArtifact(a.id) })) : []
  const scheds: Item[] = registry.views.scheduled
    ? Object.entries(snap.automations ?? {}).flatMap(([place, list]) =>
        list.map((a, i) => ({ key: `sched:${place}:${a.id ?? i}`, kind: 'Schedule' as const, label: a.name, sub: `${placeOf(snap, place) ? spaceLabel(snap, place) : ''} · ${a.when}`, icon: 'clock' as const, run: () => { go(place); setUI({ pane: 'tasks', task: null, tab: 'Scheduled' }) } })))
    : []
  const own = registry.settings.filter((x) => x.scope !== 'space').map((x) => [x.name, x.icon] as [string, IconName])
  const pages: Item[] = [...ALL.slice(0, -1), ...own, ...ALL.slice(-1)].map(([name, icon]) => ({ key: `set:${name}`, kind: 'Settings', label: `Settings › ${name}`, icon, words: 'preferences', run: () => openSettings('all', name) }))
  return { things: [...spaces, ...tasks, ...repos, ...arts, ...scheds, ...pages], commands, actions }
}

const MODES: Record<string, (i: Item) => boolean> = {
  '>': (i) => i.kind === 'Command' || i.kind === 'Action',
  '#': (i) => i.kind === 'Space',
  '@': (i) => i.kind === 'Task',
}

/** every word typed starts a word of `text`: "set pref" finds Open Settings by "preferences" */
export function byWords(q: string, text: string): number {
  const typed = q.toLowerCase().split(/\s+/).filter(Boolean)
  const words = text.toLowerCase().split(/[\s›·#@/._-]+/).filter(Boolean)
  return typed.length && typed.every((w) => words.some((x) => x.startsWith(w))) ? 300 : -1
}

/** a task's key by its start, case and dash aside: "shop-1" and "SHOP12" find SHOP-12 (its words alone, "shop" or "12", match by its row's line) */
export function refMatch(q: string, ref?: string): number {
  const flat = (x: string) => x.toLowerCase().replace(/[\s-]/g, '')
  const t = flat(q)
  return ref && t && /\d/.test(q) && flat(ref).startsWith(t) ? 400 - (flat(ref).length - t.length) : -1
}

/** the rows for a query: empty, recent picks, then actions on what is in focus, then the commands; typed, every item
 *  ranked by its match, a recent pick a little higher */
export function rank(q: string, all: { things: Item[]; commands: Item[]; actions: Item[] }, recent: string[]): { label?: string; items: Item[] }[] {
  const mode = MODES[q.trim()[0]] ? q.trim()[0] : ''
  const text = mode ? q.trim().slice(1) : q
  const pool = [...all.actions, ...all.commands, ...all.things].filter((i) => (MODES[mode] ?? (() => true))(i) && (!i.typed || !!text.trim()))
  if (!text.trim()) {
    const byKey = new Map(pool.map((i) => [i.key, i]))
    const rec = recent.map((k) => byKey.get(k)).filter((i): i is Item => !!i).slice(0, 5)
    const seen = new Set(rec.map((i) => i.key))
    if (mode === '#' || mode === '@') return [...(rec.length ? [{ label: 'Recent', items: rec }] : []), { items: pool.filter((i) => !seen.has(i.key)).slice(0, 60) }].filter((g) => g.items.length)
    const actions = all.actions.filter((i) => !seen.has(i.key) && (MODES[mode] ?? (() => true))(i))
    const commands = all.commands.filter((i) => !seen.has(i.key))
    return [
      ...(rec.length ? [{ label: 'Recent', items: rec }] : []),
      ...(actions.length ? [{ label: actions[0].sub ?? 'Actions', items: actions }] : []),
      { label: 'Commands', items: commands },
    ].filter((g) => g.items.length)
  }
  const scored = pool
    .map((i) => {
      // the label by a loose match; its other words (where it is, what else it's called) only by the starts of words
      const s = Math.max(fuzzy(text, i.label), byWords(text, `${i.sub ?? ''} ${i.words ?? ''}`), refMatch(text, i.ref))
      const r = recent.indexOf(i.key)
      return { i, s: s < 0 ? s : s + (r >= 0 ? 120 - r * 4 : 0) + (i.kind === 'Action' ? 20 : 0) }
    })
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
  return [{ items: scored.slice(0, 50).map((x) => x.i) }]
}

function Palette({ close }: { close: () => void }) {
  const snap = useSnap()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const all = useMemo(() => (snap ? itemsOf(snap) : { things: [], commands: [], actions: [] }), [snap])
  const groups = useMemo(() => rank(q, all, recents()), [q, all])
  const flat = groups.flatMap((g) => g.items)
  useEffect(() => setAt(0), [q])
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])
  if (!snap) return null
  const pick = (i: Item | undefined) => {
    if (!i) return
    if (i.kind !== 'Command') used(i.key)
    close()
    // after the palette is gone: a box the command focuses keeps the cursor
    requestAnimationFrame(() => i.run())
  }
  let n = -1
  return (
    <div className="pk pal">
      <div className="palq">
        <I n="search" />
        <input
          className="inp"
          name="sq"
          role="combobox"
          aria-expanded
          aria-controls="pal-list"
          aria-activedescendant={flat.length ? `pal-${at}` : undefined}
          aria-label="Search or run a command"
          placeholder="Search, or type > for commands"
          value={q}
          autoComplete="off"
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n' && !e.metaKey) || (e.ctrlKey && e.key === 'j')
            const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p' && !e.metaKey)
            if (down || up) {
              e.preventDefault()
              if (flat.length) setAt((a) => (a + (down ? 1 : -1) + flat.length) % flat.length)
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              pick(flat[at])
            } else if (e.key === 'Tab') e.preventDefault()
          }}
        />
      </div>
      <div className="list" id="pal-list" role="listbox" aria-label="Results" ref={list}>
        {!flat.length && <p className="hint" style={{ padding: 8 }}>{q.trim() ? 'Nothing matches.' : 'Type a name or a command.'}</p>}
        {groups.map((g, gi) => (
          <div key={gi} role="group" aria-label={g.label} style={{ display: 'contents' }}>
            {g.label && <div className="lab">{g.label}</div>}
            {g.items.map((i) => {
              n++
              const me = n
              return (
                <Row
                  key={i.key}
                  id={`pal-${me}`}
                  data-i={me}
                  role="option"
                  aria-selected={me === at}
                  tabIndex={-1}
                  icon={i.lead ? undefined : i.icon ?? (i.kind === 'Command' ? 'bolt' : undefined)}
                  lead={i.lead}
                  label={i.label}
                  sub={i.kind === 'Action' && g.label === i.sub ? undefined : i.sub}
                  value={KIND_WORD[i.kind] || undefined}
                  end={i.chord ? <Kbd chord={i.chord} /> : undefined}
                  onMouseMove={() => me !== at && setAt(me)}
                  onClick={() => pick(i)}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default definePlugin({
  name: 'search',
  setup(reg) {
    reg.views.search = Palette
    reg.commands.push({
      id: 'search.palette',
      title: 'Search and commands',
      area: 'General',
      icon: 'search',
      keys: ['Mod+K'],
      terminal: true,
      words: 'palette find go to anything',
      run: () => setUI({ search: !getState().ui.search, drawer: false }),
    })
  },
})
