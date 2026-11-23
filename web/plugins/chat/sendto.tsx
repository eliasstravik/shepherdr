// Where a share goes (SHEP-345): it lands in the chat you had open last; "Change" on its chip picks another space or a
// task's chat instead, from one searchable list.
import { useState } from 'react'
import { getState } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { PickerHead } from '@client/picker.tsx'
import { I, Row } from '@client/ui.tsx'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import type { Snapshot } from '@shared/types.ts'
import { everything, machineLabel, spacesOf, taskChat, workWords } from '@shared/view.ts'
import { moveShared } from './share.ts'

/** the chats a share can go to: Everything, the spaces, then the tasks still going whose agent has a chat (newest first) */
export function destinations(snap: Snapshot, q = '') {
  const s = q.trim().toLowerCase()
  const hit = (...names: string[]) => !s || names.some((n) => n.toLowerCase().includes(s))
  const ev = everything(snap)
  const spaces = [...(ev && hit('Everything') ? [{ id: ev.id, name: 'Everything', chat: ev.chat, machine: ev.machine, root: true }] : []), ...spacesOf(snap).filter((p) => !p.archived && hit(p.name)).map((p) => ({ id: p.id, name: p.name, chat: p.chat, machine: p.machine, root: false }))]
  const tasks = snap.tasks.filter((t) => t.agent && !t.archived && t.status !== 'done' && hit(t.name, t.id)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  return { spaces, tasks }
}

function SendTo({ from, close }: { from: string; close: () => void }) {
  const snap = getState().snap!
  const [q, setQ] = useState('')
  const { spaces, tasks } = destinations(snap, q)
  const to = (x: { key: string; place?: string; task?: string }) => () => {
    close()
    if (x.key !== from) moveShared(from, x)
  }
  return (
    <div className="pk">
      <PickerHead title="Send to" close={close} />
      <input className="inp" name="stq" aria-label="Search spaces and tasks" placeholder="Search spaces and tasks" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {spaces.length > 0 && <div className="lab">Spaces</div>}
        {spaces.map((p) => (
          <Row key={p.id} icon={p.root ? 'layers' : 'hash'} label={p.name} value={machineLabel(snap, p.machine)} current={p.chat === from} end={p.chat === from ? <I n="check" /> : undefined} onClick={to({ key: p.chat, place: p.id })} />
        ))}
        {tasks.length > 0 && <div className="lab">Tasks</div>}
        {tasks.map((t) => (
          <Row key={t.id} lead={<StatusIcon t={t} time="side" />} label={t.name} sub={workWords(snap, t)} current={taskChat(t) === from} end={taskChat(t) === from ? <I n="check" /> : undefined} onClick={to({ key: taskChat(t), task: t.id })} />
        ))}
        {!spaces.length && !tasks.length && <p className="hint" style={{ padding: 8 }}>Nothing with that name.</p>}
      </div>
    </div>
  )
}

/** pick where what was shared into this box goes */
export function openSendTo(from: string) {
  openDialog((close) => <SendTo from={from} close={close} />, { wide: true, bare: true, label: 'Send to' })
}
