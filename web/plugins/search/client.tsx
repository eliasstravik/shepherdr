// One search for everything: the search button in the list (Ctrl+K on a desktop) opens one box; typing a name gives
// results grouped Spaces, Tasks, Artifacts, each drawn as its usual row; picking one opens it. By name only.
import { useState } from 'react'
import { definePlugin, getState, go, openArtifact, setUI, useSnap } from '@client/kernel.ts'
import { I, Row } from '@client/ui.tsx'
import { open as openTask } from '@plugins/tasks/client.tsx'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import { agoShort, artifactsIn, everything, machineLabel, spaceLabel, spacesOf, whereWords } from '@shared/view.ts'

function Search({ close }: { close: () => void }) {
  const snap = useSnap()
  const [q, setQ] = useState('')
  if (!snap) return null
  const ev = everything(snap)
  const s = q.trim().toLowerCase()
  const hit = (name: string) => !!s && name.toLowerCase().includes(s)
  const spaces = [...(ev && hit('Everything') ? [ev] : []), ...spacesOf(snap).filter((p) => hit(p.name))]
  const tasks = snap.tasks.filter((t) => !t.archived && hit(t.name))
  const arts = ev ? artifactsIn(snap, ev.id).filter((a) => hit(a.title)) : []
  const none = !spaces.length && !tasks.length && !arts.length
  const pick = (f: () => void) => () => {
    close()
    f()
  }
  return (
    <div className="pk">
      <input className="inp" name="sq" aria-label="Search spaces, tasks and artifacts" placeholder="Search spaces, tasks and artifacts" value={q} autoComplete="off" autoFocus onChange={(e) => setQ(e.target.value)} />
      <div className="list" style={{ minHeight: 0 }}>
        {none && <p className="hint" style={{ padding: 8 }}>{s ? 'Nothing with that name.' : 'Type a name.'}</p>}
        {spaces.length > 0 && <div className="lab">Spaces</div>}
        {spaces.map((p) => <Row key={p.id} icon={p.id === ev?.id ? 'layers' : 'hash'} label={p.id === ev?.id ? 'Everything' : p.name} value={machineLabel(snap, p.machine)} onClick={pick(() => go(p.id))} />)}
        {tasks.length > 0 && <div className="lab">Tasks</div>}
        {tasks.map((t) => <Row key={t.id} lead={<StatusIcon t={t} time="side" />} label={t.name} sub={whereWords(snap, t.place)} onClick={pick(() => openTask(t))} />)}
        {arts.length > 0 && <div className="lab">Artifacts</div>}
        {arts.map((a) => <Row key={a.id} icon="doc" label={a.title} sub={`${spaceLabel(snap, a.place)} · ${agoShort(a.at)}`} onClick={pick(() => openArtifact(a.id))} />)}
      </div>
    </div>
  )
}

export default definePlugin({
  name: 'search',
  setup(reg) {
    reg.views.search = Search
    reg.keys.push({
      order: 10,
      handle: (e) => {
        if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) return false
        setUI({ search: !getState().ui.search, drawer: false })
        return true
      },
    })
  },
})

export { I }
