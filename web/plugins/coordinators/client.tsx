// Coordinators: a space's Assistant, as 3.0's pane header and Assistant tab. Its header has the Autopilot switch with what
// it waits for ("Next 10:00", "On events", "Run now only", "Queued"; only the switch on a phone, as the window's narrow
// header), and on a desktop the tab bar's +. Its ⋯ menu is the window's tab menu: Rename…, Edit instructions…, Switch
// agent, Restart, Close tab (closing an Assistant asks whether its workers stop or finish). On a phone the + menu's
// items sit in the ⋯ menu too.
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { openRole } from '@client/screens/Role.tsx'
import { openWorktree } from '@client/screens/Worktree.tsx'
import { act, definePlugin, has, setUI, useSnap, useUI } from '@client/kernel.ts'
import { Dialog } from '@client/rowmenu.tsx'
import { openRestart } from '@client/restart.tsx'
import { Switch } from '@client/Settings.tsx'
import { field, ic, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, ModelIcon, PlanIcon, PlusIcon, Primary, RenameIcon, RestartIcon, SplitIcon, TermIcon, XIcon } from '@client/ui.tsx'
import { openAddSpace } from '@plugins/places/add.tsx'
import type { Place, SettingRow } from '@shared/types.ts'

/** a space's Autopilot rows (Settings › Autopilot for it), when it has them */
const usePilot = (place: Place) => useSnap()?.settings.find((x) => x.name === 'Autopilot' && x.level === place.id)?.rows

/** What follows "Autopilot" while on (3.0's): queued for an idle Assistant, the next scheduled wake, else what wakes it */
function detail(rows: SettingRow[]) {
  const row = (key: string) => rows.find((r) => r.key === key)
  if (row('autopilot.on')?.value !== 'on') return ''
  if (rows.find((r) => r.label === 'Next wake')?.value.startsWith('Waiting')) return 'Queued'
  const next = row('autopilot.every')?.trigger?.next[0]
  if (next) return next.startsWith('Today ') ? `Next ${next.slice(6)}` : `Next ${next.split(/[ ,]/)[0]}`
  return row('autopilot.events')?.value ? 'On events' : 'Run now only'
}

/** the header's Autopilot switch: on and off in one tap; its word and detail beside it where there is room */
function AutopilotHeader({ place }: { place: Place }) {
  const rows = usePilot(place)
  const phone = useUI((u) => u.device === 'phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!rows || !has('autopilot')) return null
  const on = rows.find((r) => r.key === 'autopilot.on')?.value === 'on'
  const flip = async (next: boolean) => {
    if (busy) return
    setBusy(true); setError('')
    try { const r = await act({ type: 'mode', place: place.id, mode: next ? 'autopilot' : 'regular' }); setError(r.error ?? '') }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <div data-autopilot className="flex min-w-0 shrink items-center gap-2 text-[0.8125rem]" title={error || (phone ? 'Autopilot' : undefined)}>
      <Switch label="Autopilot" on={on} onChange={(v) => void flip(v)} />
      {phone ? null : (
        <>
          <span className={clsx('shrink-0 font-medium', on ? 'text-fg' : 'text-fg2')}>Autopilot</span>
          {on ? <span className="min-w-0 truncate text-fg3">{detail(rows)}</span> : null}
        </>
      )}
      {error ? <span role="alert" className="sr-only">{error}</span> : null}
    </div>
  )
}

/* ---------- the tab bar's + (3.0's new-menu) ---------- */

type Agent = { kind: string; name: string; installed: boolean }

/** Terminal, the Assistant, an agent of the installed ones, then New space, New worktree…, Open worktree… */
function PlusItems({ place, done }: { place: Place; done: () => void }) {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    act({ type: 'tab-agents', place: place.id } as never).then((r: { agents?: Agent[] }) => setAgents(r.agents ?? []), () => setFailed(true))
  }, [place.id])
  const newTab = (kind?: string) => () => { done(); void act({ type: 'tab-new', place: place.id, ...(kind ? { kind } : {}) } as never).catch((e: Error) => alert(e.message)) }
  return (
    <>
      <MenuItem icon={<TermIcon className={ic} />} onClick={newTab()}>Terminal</MenuItem>
      {/* the space's Assistant is its chat: shown here */}
      <MenuItem icon={<ModelIcon className={ic} />} onClick={() => { done(); setUI({ term: null, arts: null }) }}>Show Assistant</MenuItem>
      <MenuLabel>Start an agent</MenuLabel>
      {agents === null ? <MenuLabel>{failed ? "Couldn't load agents" : 'Checking installed agents…'}</MenuLabel> : agents.map((a) => (
        <MenuItem key={a.kind} icon={<ModelIcon className={ic} />} disabled={!a.installed} hint={a.installed ? undefined : 'Not installed'} onClick={newTab(a.kind)}>{a.name}</MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<PlusIcon className={ic} />} onClick={() => { done(); openAddSpace(place.machine) }}>New space</MenuItem>
      <MenuItem icon={<SplitIcon className={ic} />} onClick={() => { done(); openWorktree({ place: place.id, name: place.name, op: 'new' }) }}>New worktree…</MenuItem>
      <MenuItem icon={<SplitIcon className={ic} />} onClick={() => { done(); openWorktree({ place: place.id, name: place.name, op: 'open' }) }}>Open worktree…</MenuItem>
    </>
  )
}

/** the + beside the header's ⋯ (a desktop's or tablet's; a phone has its items in the ⋯ menu) */
function PlusButton({ place }: { place: Place }) {
  const phone = useUI((u) => u.device === 'phone')
  const [open, setOpen] = useState(false)
  if (phone) return null
  return (
    <div className="relative">
      <IconButton label="New tab" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <PlusIcon className={ic} />
      </IconButton>
      {open ? (
        <Menu label="New tab" onClose={() => setOpen(false)} className="absolute top-full right-0 z-21 mt-1.5 w-60 origin-top-right">
          <PlusItems place={place} done={() => setOpen(false)} />
        </Menu>
      ) : null}
    </div>
  )
}

/* ---------- the Assistant tab's menu (3.0's) ---------- */

let renaming: Place | null = null
const renameListeners = new Set<() => void>()
const openTabRename = (p: Place | null) => { renaming = p; renameListeners.forEach((f) => f()) }

/** Rename…, Edit instructions…, Switch agent, Restart, Close tab; on a phone, the + menu's items after them */
function TabItems({ place }: { place: Place }) {
  const phone = useUI((u) => u.device === 'phone')
  const [restarting, setRestarting] = useState(false)
  const close = () => setUI({ menu: false })
  // Restart: the same agent, model and effort again (the window's restarts at once)
  const restart = async () => {
    setRestarting(true)
    try {
      const r = (await act({ type: 'restart-info', chat: place.chat })) as { info?: { on: { kind: string; model?: string; effort?: string; speed?: string } }; error?: string }
      if (!r.info) throw new Error(r.error || 'It could not be restarted.')
      const { kind, model, effort, speed } = r.info.on
      await act({ type: 'restart', chat: place.chat, kind, model, effort, speed })
      close()
    } catch (e) { alert((e as Error).message) } finally { setRestarting(false) }
  }
  return (
    <>
      <MenuItem icon={<RenameIcon className={ic} />} onClick={() => { close(); openTabRename(place) }}>Rename…</MenuItem>
      <MenuItem icon={<PlanIcon className={ic} />} onClick={() => { close(); openRole({ kind: 'file', role: 'coordinator', title: 'What every Assistant is told first', file: 'assistant.md' }) }}>
        Edit instructions…
      </MenuItem>
      <MenuItem icon={<ModelIcon className={ic} />} onClick={() => { close(); openRestart(place.chat, place.name) }}>Switch agent</MenuItem>
      <MenuItem icon={<RestartIcon className={ic} />} disabled={restarting} onClick={() => void restart()}>{restarting ? 'Restarting…' : 'Restart'}</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<XIcon className={ic} />} onClick={() => { close(); openClose(place) }}>Close tab</MenuItem>
      {phone ? (
        <>
          <MenuSeparator />
          <PlusItems place={place} done={close} />
        </>
      ) : null}
    </>
  )
}

/** Rename the Assistant's tab */
function TabRename() {
  const place = useSyncExternalStore((f) => (renameListeners.add(f), () => void renameListeners.delete(f)), () => renaming)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setName('Assistant'); setBusy(false); setError('') }, [place])
  if (!place) return null
  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    try { await act({ type: 'tab-rename', place: place.id, name } as never); openTabRename(null) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Dialog title="Rename tab" onCancel={() => openTabRename(null)} buttons={<Primary disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Rename'}</Primary>}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} aria-label="Tab name" className={`${field} h-10 w-full rounded-full bg-bg px-3.5`} />
      {error ? <p role="alert" className="mt-2 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

let closing: Place | null = null
const closeListeners = new Set<() => void>()
const openClose = (p: Place | null) => { closing = p; closeListeners.forEach((f) => f()) }

/** Close the Assistant? With workers running: stop them, or let them finish on their own */
function CloseAssistant() {
  const place = useSyncExternalStore((f) => (closeListeners.add(f), () => void closeListeners.delete(f)), () => closing)
  const [workers, setWorkers] = useState<number | null>(null)
  const [stop, setStop] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setWorkers(null); setStop(true); setBusy(false); setError('')
    if (place) act({ type: 'assistant-close', place: place.id, mode: 'count' } as never).then((r: { workers?: number; error?: string }) => (r.error ? setError(r.error) : setWorkers(r.workers ?? 0)), (e: Error) => setError(e.message))
  }, [place])
  if (!place) return null
  const go = async () => {
    setBusy(true); setError('')
    try { await act({ type: 'assistant-close', place: place.id, mode: stop ? 'stop' : 'keep' } as never); openClose(null) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  const choice = (on: boolean, title: string, detail: string, pick: () => void) => (
    <button type="button" role="radio" aria-checked={on} onClick={pick} className="press flex w-full items-start gap-2.5 rounded-row px-2 py-2 text-left hover:bg-hover">
      <span aria-hidden="true" className={clsx('mt-0.5 size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--fg3)]', on && 'shadow-[inset_0_0_0_5px_var(--fg)]')} />
      <span><span className="block font-medium">{title}</span><span className="block text-[0.8125rem] text-fg2">{detail}</span></span>
    </button>
  )
  return (
    <Dialog title="Close the Assistant?" onCancel={() => openClose(null)} safe
      buttons={<Primary disabled={busy || workers === null} onClick={() => void go()}>{busy ? 'Closing…' : 'Close Assistant'}</Primary>}>
      <div className="flex flex-col gap-2 text-pretty">
        <p className="text-fg2">{workers === null ? (error ? '' : 'Reading…') : workers ? `It has ${workers} worker${workers > 1 ? 's' : ''} running. Their branches and worktrees stay either way.` : 'It has no workers running.'}</p>
        {workers ? (
          <div role="radiogroup" aria-label="Its workers" className="flex flex-col">
            {choice(stop, 'Stop its workers', 'Ends the agents it started and closes their tabs.', () => setStop(true))}
            {choice(!stop, 'Let them finish', 'Workers keep running in their own tabs, on their own.', () => setStop(false))}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-need-fg">{error}</p> : null}
      </div>
    </Dialog>
  )
}

export default definePlugin({
  name: 'coordinators',
  setup(reg) {
    reg.placeHeader.push({ order: 10, View: AutopilotHeader }, { order: 20, View: PlusButton })
    reg.overlays.push(CloseAssistant, TabRename)
    reg.placeMenu.push({ order: 80, View: TabItems, joined: true })
  },
})
