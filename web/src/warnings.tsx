// The line just above Everything's message box: one line when a plan passes 75% or a machine runs low or can't be
// reached. It opens Settings › Usage or Machines and can be dismissed; it comes back the next day, or when a new
// warning appears. Several show as "2 things need a look".
import { isEverything } from '@shared/view.ts'
import { openSettings, registry, setUI, useSnap, useUI, type Thread } from './kernel.ts'
import { openMenu } from './overlay.tsx'
import { I, IB } from './ui.tsx'

const today = () => new Date().toDateString()

function Warnings({ thread }: { thread: Thread }) {
  const snap = useSnap()
  const off = useUI((u) => u.banner)
  if (!snap || thread.task || !isEverything(snap, thread.place)) return null
  const list = snap.warnings ?? []
  if (!list.length) return null
  const what = list.map((w) => w.id).sort().join('|')
  // a machine out of reach stays in view; the rest can be dismissed until tomorrow or a new warning
  const stays = list.some((w) => /^Can't reach/.test(w.text))
  if (!stays && off && off.day === today() && what.split('|').every((id) => off.what.split('|').includes(id))) return null
  const open = (w: (typeof list)[number]) => openSettings('all', w.kind === 'usage' ? 'Usage' : 'Machines')
  return (
    <div className="banner">
      <I n="warn" c="c-ask" />
      <button
        type="button"
        className="n"
        aria-haspopup={list.length > 1 ? 'menu' : undefined}
        onClick={(e) => (list.length === 1 ? open(list[0]!) : openMenu(e.currentTarget, list.map((w) => ({ icon: w.kind === 'usage' ? ('gauge' as const) : ('server' as const), label: w.text, run: () => open(w) }))))}
      >
        {list.length === 1 ? list[0]!.text : `${list.length} things need a look`}
      </button>
      {!stays && <IB icon="x" label="Dismiss" onClick={() => setUI({ banner: { day: today(), what } })} />}
    </div>
  )
}

registry.aboveBox.push({ order: 10, View: Warnings })
