// The line just above Everything's message box: one line when a plan passes 75% or a machine runs low or can't be
// reached. It opens Settings › Usage or Machines and can be closed; it comes back only when a warning shows that
// wasn't there when it was closed (dismiss.ts). Several show as "2 things need a look", always all that are there now.
import { isEverything } from '@shared/view.ts'
import { idsOf, kept, showing } from './dismiss.ts'
import { getState, openSettings, registry, setUI, subscribe, useSnap, useUI, type Thread } from './kernel.ts'
import { openMenu } from './overlay.tsx'
import { I, IB } from './ui.tsx'

// a closed warning that goes away leaves the closed set, wherever the person is, so its return counts as new
subscribe(() => {
  const { snap, ui } = getState()
  if (!snap || !ui.banner) return
  const what = kept((snap.warnings ?? []).map((w) => w.id), idsOf(ui.banner.what))
  if (what !== ui.banner.what) setUI({ banner: what ? { what } : null })
})

function Warnings({ thread }: { thread: Thread }) {
  const snap = useSnap()
  const closed = useUI((u) => u.banner?.what)
  if (!snap || thread.task || !isEverything(snap, thread.place)) return null
  const list = snap.warnings ?? []
  const ids = list.map((w) => w.id)
  if (!showing(ids, idsOf(closed))) return null
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
      <IB icon="x" label="Close" onClick={() => setUI({ banner: { what: [...ids].sort().join('|') } })} />
    </div>
  )
}

registry.aboveBox.push({ order: 10, View: Warnings })
