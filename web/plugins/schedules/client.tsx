// Schedules: the one concept for anything tied to a time. A schedule is a recipe, not a task: when (a time, a repeat
// or an event) and what to do. Every run starts an ordinary task. The Scheduled tab lists the recipes only, one-off
// and repeating alike; each row has a menu (when it last ran, Run now, Pause, View history, Edit). Made by asking in
// a chat; changed from its row's Edit.
import { useState } from 'react'
import { definePlugin, getState, openTask, setUI, tryAct, useSnap } from '@client/kernel.ts'
import { openDialog, openForm, openMenu } from '@client/overlay.tsx'
import { AgentField, pickFor, SpaceField, type Pick } from '@client/picker.tsx'
import { Btn, Empty, I, IB, Row } from '@client/ui.tsx'
import { dayLabel } from '@plugins/chat/days.ts'
import { doneWords, isEverything, scheduleLine, schedulesOf, statusWord, taskLine, taskOf, tstate, whereWords, type Schedule } from '@shared/view.ts'

const act = (x: Schedule, op: string, more: Record<string, unknown> = {}) => tryAct({ type: 'automation', op, id: x.id, place: x.place, name: x.name, ...more })

/** Edit: when it runs and what it does (two plain text fields), the space (and so the machine) and the agent. Save
 *  sends the new words to that space's agent, which sets the trigger, exactly as when it is asked in a chat. */
function edit(x: Schedule) {
  openForm(
    function Form({ close }) {
      const snap = getState().snap!
      const [when, setWhen] = useState(x.when)
      const [what, setWhat] = useState(x.what)
      const [place, setPlace] = useState(x.place)
      const [pick, setPick] = useState<Pick>(x.agent ?? pickFor(snap, isEverything(snap, x.place) ? 'all' : x.place, 'Tasks'))
      const machine = snap.places.find((p) => p.id === place)?.machine ?? snap.host
      const save = () => {
        close()
        const changed = { ...(when.trim() && when.trim() !== x.when ? { when: when.trim() } : {}), ...(what.trim() && what.trim() !== x.what ? { what: what.trim() } : {}), ...(place !== x.place ? { to: place } : {}), ...(JSON.stringify(pick) !== JSON.stringify(x.agent ?? pickFor(snap, isEverything(snap, x.place) ? 'all' : x.place, 'Tasks')) ? { agent: pick } : {}) }
        if (Object.keys(changed).length) void act(x, 'edit', changed)
      }
      return (
        <>
          <h2>{x.name}</h2>
          <label className="fld">
            <span>When</span>
            <input className="inp" name="schw" value={when} autoComplete="off" onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label className="fld">
            <span>What to do</span>
            <input className="inp" name="schd" value={what} autoComplete="off" onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </label>
          <SpaceField value={place} onChange={setPlace} />
          <AgentField title="Its tasks run on" machine={machine} pick={pick} onChange={setPick} />
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={save}>Save</Btn>
          </div>
        </>
      )
    },
    { label: x.name },
  )
}

const clock = (at: number) => {
  const d = new Date(at)
  return `${dayLabel(at)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** History: a plain list of earlier runs, newest first, each with how it ended; each opens its task */
function history(x: Schedule) {
  openDialog(
    (close) => {
      const snap = getState().snap!
      const runs = [...(x.runs ?? [])].sort((a, b) => b.at - a.at)
      return (
        <>
          <h2>{x.name}</h2>
          <p>Earlier runs</p>
          <div>
            {runs.map((r) => {
              const t = taskOf(snap, r.task)
              const how = r.error ? `Did not start · ${r.error}` : t ? (tstate(t) === 'done' || tstate(t) === 'archived' ? doneWords(t) : taskLine(t) || statusWord(t).word) : 'Done'
              return <Row key={r.at} icon="check" label={clock(r.at)} sub={how} end={t ? <I n="right" c="s16" /> : undefined} disabled={!t} onClick={() => { close(); if (t) openTask(t.id) }} />
            })}
            {!runs.length && <div className="empty"><span>It has not run yet.</span></div>}
          </div>
          <div className="acts"><Btn onClick={close}>Close</Btn></div>
        </>
      )
    },
    { label: `${x.name}: earlier runs` },
  )
}

function menu(anchor: Element, x: Schedule) {
  openMenu(
    anchor,
    [
      // Run now starts a task at once: it shows under Working
      { icon: 'play', label: 'Run now', run: () => void act(x, 'run').then((ok) => ok && setUI({ tab: 'Now' })) },
      x.on ? { icon: 'pause', label: 'Pause', run: () => void act(x, 'pause') } : { icon: 'play', label: 'Resume', run: () => void act(x, 'resume') },
      ...(x.once ? [] : [{ icon: 'clock' as const, label: 'View history', run: () => history(x) }]),
      { icon: 'pen', label: 'Edit', run: () => edit(x) },
    ],
    { cap: x.last ? `Last ran ${x.last}` : 'Has not run yet', label: x.name },
  )
}

function Scheduled({ place }: { place: string }) {
  const snap = useSnap()
  if (!snap) return null
  const inSpace = !isEverything(snap, place)
  const list = schedulesOf(snap, place)
  if (!list.length) return <Empty>Nothing scheduled. Ask in a chat to set one up.</Empty>
  return (
    <>
      {list.map((x) => (
        <div className="rowx" key={x.id}>
          <div className="row row2 tk">
            <I n="clock" c="c-mute" />
            <span className="n">
              <span className="l1">{x.name}</span>
              <span className="l2">{scheduleLine(x)}</span>
              {!inSpace && <span className="l2">{whereWords(snap, x.place)}</span>}
            </span>
          </div>
          <IB icon="dots" label={`More for ${x.name}`} aria-haspopup="menu" onClick={(e) => menu(e.currentTarget, x)} />
        </div>
      ))}
    </>
  )
}

export default definePlugin({
  name: 'schedules',
  setup(reg) {
    reg.views.scheduled = Scheduled
  },
})
