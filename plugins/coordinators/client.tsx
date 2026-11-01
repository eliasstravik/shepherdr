// Coordinators: one agent per place. Each does what the human asks, and Autopilot is a switch on top of it:
// then it also works on its own.
// The switch is at the top of the coordinator chat's ⋯ menu, over search and the terminal. While Autopilot is on, a small
// red pill at the header's right, beside that menu (on a phone after the subtitle, under the name), says so, and a tap
// on it opens the menu; with it off the header says nothing of it. Turning it on replaces the coordinator and spends on
// its own, so it asks first, and where it can't run the switch is greyed with the reason; off is always one tap.
import { useState, useSyncExternalStore } from 'react'
import { act, definePlugin, has, setUI, useSnap, useUI } from '@client/kernel.ts'
import { Dialog } from '@client/rowmenu.tsx'
import { ic, MenuItem, MenuSwitch, ModeIcon, Primary } from '@client/ui.tsx'
import { PILOT_BLOCKED, pilotAccessWarning, type Place } from '@shared/types.ts'

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
  const warning = pilotAccessWarning(rows.find((row) => row.key === 'autopilot.access')?.value)
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
    <Dialog safe title={`Turn on Autopilot for ${place.name}?`} onCancel={close} buttons={<Primary disabled={busy} onClick={go}>{busy ? 'Changing coordinator…' : 'Turn on'}</Primary>}>
      <div data-autopilot-confirm className="flex flex-col gap-2.5 text-pretty">
        <p>A new coordinator replaces this one, in this chat. It wakes on a schedule and starts tasks by itself, even while you're away.</p>
        <p className="text-fg2">It spends your Claude Code or Codex allowance as it goes: {limitWords(rows)}. Settings → Autopilot sets the limits.</p>
        {warning ? <p className="text-fg2">{warning}</p> : null}
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
  const change = async (keepWorkers = false) => {
    if (busy) return
    if (!on) {
      setUI({ menu: false })
      return confirm(place.id)
    }
    setBusy(true); setError('')
    try { const result = await act({ type: 'mode', place: place.id, mode: 'regular', keepWorkers }); setError(result.error ?? '') }
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
      note={blocked ?? (busy ? 'Changing coordinator…' : state && state !== 'On' && state !== 'Off' ? state : on ? 'Works on its own' : 'Off: does what you ask')}
      onClick={() => void change()}
    />
    {on ? <MenuItem onClick={() => void change(true)}>Turn off; let workers finish</MenuItem> : null}
    {error ? <p role="alert" className="max-w-72 px-3 py-2 text-sm text-pretty text-need [overflow-wrap:anywhere]">{error}</p> : null}
    </>
  )
}

export default definePlugin({
  name: 'coordinators',
  setup(reg) {
    reg.placeMark.push({ order: 10, View: AutopilotPill })
    reg.placeMenu.push({ order: 10, View: AutopilotSwitch })
    reg.overlays.push(AutopilotConfirm)
  },
})
