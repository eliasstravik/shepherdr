// Coordinators: one agent per place. Each does what the human asks, and Autopilot is a switch on top of it:
// then it also works on its own.
// The switch is at the top of the coordinator chat's ⋯ menu, over search and the terminal. While Autopilot is on, a small
// red pill at the header's right, beside that menu (on a phone after the subtitle, under the name), says so, and a tap
// on it opens the menu; with it off the header says nothing of it. Turning it on replaces the coordinator and spends on
// its own, so it asks first, and where it can't run the switch is greyed with the reason; off is always one tap.
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { openRole } from '@client/screens/Role.tsx'
import { act, definePlugin, has, setUI, useSnap, useUI } from '@client/kernel.ts'
import { Dialog } from '@client/rowmenu.tsx'
import { ic, MenuItem, MenuSwitch, ModeIcon, PlanIcon, Primary, XIcon } from '@client/ui.tsx'
import { PILOT_BLOCKED, type Place } from '@shared/types.ts'

/** Autopilot on, as a red pill with a dot: at the header's right, or after the subtitle on a phone; a tap opens the ⋯
 *  menu, where it is switched off. Nothing when off */
function AutopilotPill({ place }: { place: Place }) {
  const menu = useUI((u) => u.menu)
  return place.mode === 'autopilot' ? (
    <button
      type="button"
      data-mode="autopilot"
      aria-label="Autopilot is on. Change it"
      aria-haspopup="menu"
      aria-expanded={menu}
      className="mode-pill hit press"
      onClick={() => setUI({ menu: !menu, plus: null, pick: null })}
    >
      <span>Autopilot</span>
    </button>
  ) : null
}

let confirming: string | null = null
const listeners = new Set<() => void>()
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f))
const confirm = (place: string | null) => {
  confirming = place
  listeners.forEach((f) => f())
}

/** "up to 3 tasks at once, no token limit, no time limit": what stops it, as its Settings say now */
function limitWords(rows: { key: string; value: string }[]) {
  const row = (key: string) => rows.find((r) => r.key === key)?.value
  const tokens = row('autopilot.tokens'), runtime = row('autopilot.runtime'), parallel = row('autopilot.parallel')
  return [parallel ? `up to ${parallel} tasks at once` : '', !tokens || tokens === 'off' ? 'no token limit' : `${tokens} reported tokens`, !runtime || runtime === 'off' ? 'no time limit' : runtime].filter(Boolean).join(', ')
}

/** what turning Autopilot on does and costs, before it does */
function AutopilotConfirm() {
  const id = useSyncExternalStore(subscribe, () => confirming)
  const snap = useSnap()
  const place = snap?.places.find((p) => p.id === id)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!place) return null
  const rows = snap!.settings.find((section) => section.name === 'Autopilot' && section.level === place.id)?.rows ?? []
  const close = () => {
    setError('')
    confirm(null)
  }
  const go = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await act({ type: 'mode', place: place.id, mode: 'autopilot' })
      if (result.error) setError(result.error)
      else close()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog safe title={`Turn on Autopilot for ${place.name}?`} onCancel={close} buttons={<Primary disabled={busy} onClick={go}>{busy ? 'Changing Assistant…' : 'Turn on'}</Primary>}>
      <div data-autopilot-confirm className="flex flex-col gap-2.5 text-pretty">
        <p>A new Assistant replaces this one, in this chat. It wakes on a schedule and starts tasks by itself, even while you're away.</p>
        <p className="text-fg2">It spends your Claude Code or Codex allowance as it goes: {limitWords(rows)}. Settings → Autopilot sets the limits.</p>
        {error ? <p role="alert" className="text-need-fg">{error}</p> : null}
      </div>
    </Dialog>
  )
}

/** Autopilot on or off at the top of the ⋯ menu */
function AutopilotSwitch({ place }: { place: Place }) {
  const on = place.mode === 'autopilot'
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = useSnap()?.settings.find((section) => section.name === 'Autopilot' && section.level === place.id)?.rows
  const state = rows?.find((row) => row.label === 'State')?.value
  const blocked = on ? undefined : rows?.find((row) => row.label === PILOT_BLOCKED)?.value
  // Shepherdr 3: a plain switch (the same Assistant, woken by its heartbeat), no dialog
  const change = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { const result = await act({ type: 'mode', place: place.id, mode: on ? 'regular' : 'autopilot' }); setError(result.error ?? '') }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  if (!on && !has('autopilot')) return null
  return (
    <>
    <MenuSwitch
      name="Autopilot"
      icon={<ModeIcon className={ic} />}
      on={on}
      disabled={!!blocked}
      note={blocked ?? (state && state !== 'On' && state !== 'Off' ? state : undefined)}
      onClick={() => void change()}
    />
    {error ? <p role="alert" className="max-w-72 px-3 py-2 text-sm text-pretty text-need [overflow-wrap:anywhere]">{error}</p> : null}
    </>
  )
}

/* ---------- 3.0's Assistant items: its instructions, and closing it ---------- */

let closing: Place | null = null
const closeListeners = new Set<() => void>()
const openClose = (p: Place | null) => { closing = p; closeListeners.forEach((f) => f()) }

/** "Edit instructions…" and "Close Assistant…" in a space's ⋯ menu, as the window's Assistant tab menu */
function AssistantItems({ place }: { place: Place }) {
  return (
    <>
      <MenuItem icon={<PlanIcon className={ic} />} onClick={() => { setUI({ menu: false }); openRole({ kind: 'file', role: 'coordinator', title: 'What every Assistant is told first', file: 'assistant.md' }) }}>
        Edit instructions…
      </MenuItem>
      <MenuItem icon={<XIcon className={ic} />} onClick={() => { setUI({ menu: false }); openClose(place) }}>
        Close Assistant…
      </MenuItem>
    </>
  )
}

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
    reg.placeMark.push({ order: 10, View: AutopilotPill })
    reg.placeMenu.push({ order: 10, View: AutopilotSwitch })
    reg.overlays.push(AutopilotConfirm, CloseAssistant)
    reg.placeMenu.push({ order: 80, View: AssistantItems })
  },
})
