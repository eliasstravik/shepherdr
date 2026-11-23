// Tasks: the pane with Now (Needs you, Working, Up next, Done, Archived) and Scheduled, a task opened as a thread
// (back, title, Terminal, Screen, its menu, expand, its own reply box), the review card wherever it comes up, the
// Start task dialog for one not started yet, and a task's menu.
import { useEffect, useState, type ReactNode } from 'react'
import { PaneFrame, placeholderOf } from '@client/App.tsx'
import { renameDialog } from '@client/list.tsx'
import { definePlugin, getState, go, has, notice, openTask, registry, setUI, togglePane, tryAct, act, useSnap, useUI, type MenuRow, type Thread } from '@client/kernel.ts'
import { confirm, openDialog, openForm, openMenu } from '@client/overlay.tsx'
import { AgentField, pickFor, type Pick } from '@client/picker.tsx'
import { edge } from '@client/resize.ts'
import { Btn, Cnt, cx, Empty, Hd, I, IB } from '@client/ui.tsx'
import type { MergeEvidence, Snapshot, Task } from '@shared/types.ts'
import { isEverything, machineLabel, needsCount, nowGroups, onBranch, placeDown, spaceLabel, spacesOf, etaOf, leftWords, statusWord, taskChat, taskLine, taskRef, taskWhen, tasksIn, tstate, whereWords } from '@shared/view.ts'
import { DoneRow } from '@plugins/chat/cards.tsx'
import { StatusIcon } from './icon.tsx'

export { StatusIcon }

/* ---------- a task's menu ---------- */

/** open a task: one not started yet opens its Start dialog instead of an empty thread */
export function open(t: Task) {
  if (tstate(t) === 'next') return startDialog(t)
  openTask(t.id)
}

function del(t: Task) {
  confirm({
    title: 'Delete this task?',
    body: `“${t.name}” is removed from Shepherdr and its agent is stopped. Its branch and files are left alone.`,
    ok: 'Delete',
    danger: true,
    run: async () => {
      if (await tryAct({ type: 'delete', chat: taskChat(t), force: true }) && getState().ui.task === t.id) setUI({ task: null, wide: false })
    },
  })
}

/** A task's menu, on its row and in its thread: Reply, Open task, Show in #space, Show screen, Move to (only before it
 *  has started), Mark as done, Rename, Stop, Switch to terminal, then Archive and Delete. */
export function taskMenu(anchor: Element, t: Task, where: 'row' | 'thread') {
  const snap = getState().snap
  if (!snap) return
  const s = tstate(t)
  const th = where === 'thread'
  const chat = taskChat(t)
  const every = isEverything(snap, t.place)
  const extra = registry.taskMenu.flatMap((m) => m.rows(t, where))
  const rows: MenuRow[] = [
    ...(th ? [] : [
      // Reply opens it with the reply box ready to type in
      { icon: 'reply' as const, label: 'Reply', run: () => { open(t); setTimeout(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-box="${CSS.escape(chat)}"]`)?.focus(), 60) } },
      { icon: 'chat' as const, label: 'Open task', run: () => open(t) },
    ]),
    { icon: every ? 'layers' : 'hash', label: `Show in ${spaceLabel(snap, t.place)}`, run: () => go(t.place) },
    ...extra.filter((r) => r.label === 'Show screen'),
    ...(s === 'next' ? [{ icon: 'folder' as const, label: 'Move to', sub: spacesOf(snap).filter((p) => p.id !== t.place && !p.archived).map((p) => ({ label: `#${p.name}`, run: () => void tryAct({ type: 'task-move', chat, place: p.id }) })) }] : []),
    // from the menu it closes without merging: "Done · not merged" for a task on its own branch
    ...(s !== 'done' && s !== 'archived' ? [{ icon: 'check' as const, label: 'Mark as done', run: () => void tryAct({ type: 'close', chat, force: true }) }] : []),
    { icon: 'pen', label: 'Rename', run: () => renameDialog(t.name, (name) => tryAct({ type: 'task-rename', chat, name })) },
    // Stop pauses the agent, like pressing Esc: it drops what it was doing and waits
    ...(s === 'working' ? [{ icon: 'stop' as const, label: 'Stop', run: () => void tryAct({ type: 'stop', chat }) }] : []),
    ...extra.filter((r) => r.label !== 'Show screen'),
    { icon: 'archive', label: t.archived ? 'Unarchive' : 'Archive', line: true, run: () => { void tryAct({ type: 'archive', chat, on: !t.archived }); if (!t.archived && getState().ui.task === t.id) setUI({ task: null, wide: false }) } },
    { icon: 'bin', label: 'Delete', danger: true, run: () => del(t) },
  ]
  openMenu(anchor, rows, { label: t.name })
}

/* ---------- a task not started yet ---------- */

function startDialog(t: Task) {
  openForm(
    function Form({ close }) {
      const snap = getState().snap!
      const every = isEverything(snap, t.place)
      const machine = snap.places.find((p) => p.id === t.place)?.machine ?? t.on
      const [pick, setPick] = useState<Pick>(pickFor(snap, every ? 'all' : t.place, 'Tasks'))
      const [busy, setBusy] = useState(false)
      const start = async () => {
        if (busy) return
        setBusy(true)
        // Start task starts it and opens its thread
        if (await tryAct({ type: 'task-start', chat: taskChat(t), agent: pick })) {
          close()
          openTask(t.id)
        } else setBusy(false)
      }
      return (
        <>
          <div className="hd" style={{ height: 'auto', padding: 0, gap: 8, alignItems: 'flex-start' }}>
            <h2 style={{ flex: 1, minWidth: 0 }}>{t.name}</h2>
            <IB icon="x" label="Close" onClick={close} />
          </div>
          <p>{t.desc ? `${t.desc.replace(/\s+$/, '')}${/[.!?]$/.test(t.desc.trim()) ? '' : '.'} ` : ''}{t.afterTitle ? `It waits for ${t.afterTitle}; nothing starts before that unless you say go.` : 'Nothing starts until you say go.'}</p>
          <div className="fld">
            <span>Space</span>
            <span className="fake">
              <I n={every ? 'layers' : 'hash'} />
              <span style={{ marginLeft: 8 }}>
                <b style={{ fontWeight: 500 }}>{spaceLabel(snap, t.place).replace(/^#/, '')}</b> <span style={{ color: 'var(--muted)' }}>{machineLabel(snap, machine)}</span>
              </span>
            </span>
          </div>
          <AgentField title="This task runs on" machine={machine} pick={pick} onChange={setPick} />
          <Btn kind="pri" style={{ width: '100%' }} disabled={busy} onClick={() => void start()}>Start task</Btn>
        </>
      )
    },
    { label: t.name },
  )
}

/* ---------- the review card ---------- */

interface Evidence {
  summary?: string
  details?: string
  proof?: { id: string; title?: string } | string
  diff?: MergeEvidence['diff']
  checks?: MergeEvidence['checks']
  git?: { repo?: boolean; branch?: string; base?: string } | null
}
const evidence = new Map<string, Evidence | 'loading'>()
const later = new Set<string>()

function useEvidence(t: Task): Evidence | undefined {
  const [, tick] = useState(0)
  const key = `${t.id}@${t.at ?? ''}`
  useEffect(() => {
    if (evidence.has(key)) return
    evidence.set(key, 'loading')
    act<{ evidence?: Evidence }>({ type: 'evidence', task: t.id })
      .then((r) => evidence.set(key, r.evidence ?? {}))
      .catch(() => void evidence.delete(key))
      .finally(() => tick((n) => n + 1))
  }, [key])
  const e = evidence.get(key)
  return e && e !== 'loading' ? e : undefined
}

/** One review card wherever it comes up (Everything's chat, the space's chat and the task), answerable from any of
 *  them. On a branch or worktree: "Mark as done and merge". Changed in the folder, or not a repo: "Mark as done".
 *  "Not now" leaves it under Needs you; what you type next in that task goes to its agent. */
export function ReviewCard({ t, ctx }: { t: Task; ctx: 'chat' | 'thread' }) {
  const snap = useSnap()
  const ev = useEvidence(t)
  const [fold, setFold] = useState(false)
  const [, bump] = useState(0)
  const Tile = registry.views.tile
  if (!snap) return null
  const s = tstate(t)
  if (s === 'done' || s === 'archived') return <DoneRow>{statusWord(t).word} · {t.name}</DoneRow>
  const down = placeDown(snap, t.place)
  const branch = onBranch(t)
  const merging = t.status === 'merging' || !!t.accepting
  const where = branch ? 'On its own branch' : t.repo === 'folder' ? 'Changed in the folder, no branch' : 'Not a repo'
  const files = ev?.diff?.list ?? []
  // what its checks say, in their own words where they have some ("site builds")
  const checks = ev?.checks && ev.checks.state !== 'none' && ev.checks.state !== 'unknown' ? (ev.checks.state === 'passed' ? ev.checks.text || 'checks passed' : ev.checks.state === 'failed' ? 'checks failed' : 'checks running') : ''
  const foldWords = files.length ? [`${files.length} ${files.length === 1 ? 'file' : 'files'} changed${branch ? '' : ' in the folder'}`, checks].filter(Boolean).join(' · ') : ''
  const proof = t.proof ?? (typeof ev?.proof === 'string' ? ev.proof : ev?.proof?.id)
  return (
    <div className="card" data-card={`review:${t.id}`}>
      {ctx === 'chat' && <span className="t tw"><StatusIcon t={t} time="none" />{t.name}</span>}
      <span className="s">{where}</span>
      <span>{t.summary ?? ev?.summary ?? 'Ready for you to look at.'}</span>
      {proof && Tile && <div className="atile"><Tile id={proof} /></div>}
      {foldWords && (
        <button type="button" className="fold" aria-expanded={fold} onClick={() => setFold(!fold)}>
          <I n={fold ? 'down' : 'right'} c="s16" />
          {foldWords}
        </button>
      )}
      {fold && (
        <div className="files">
          {files.map((f) => (
            <span key={f.path}>{f.path}<em>{[f.added ? `+${f.added}` : '', f.removed ? `−${f.removed}` : ''].filter(Boolean).join(' ')}</em></span>
          ))}
        </div>
      )}
      {t.mergeFailed && <span className="s c-red">{t.mergeFailed}</span>}
      {later.has(t.id) && <span className="s">Still here when you want it. Say what to change in the box below.</span>}
      {down ? (
        <span className="s">Can't reach {down.name}: this waits until the link is back</span>
      ) : (
        <div className="acts">
          <Btn onClick={() => { later.add(t.id); bump((n) => n + 1) }}>Not now</Btn>
          <Btn kind={ctx === 'chat' ? 'str' : 'pri'} disabled={merging} onClick={() => void tryAct({ type: 'accept', task: t.id })}>
            {merging ? 'Merging…' : branch ? 'Mark as done and merge' : 'Mark as done'}
          </Btn>
        </div>
      )}
    </div>
  )
}

/** An agent that crashed or was cut off is never started again by Shepherdr on its own: a card with the reason and
 *  Restart. Stopped by you: the next message carries on. */
export function StoppedCard({ t }: { t: Task }) {
  if (!t.stopped || t.stopped.by === 'you') return null
  return (
    <div className="card" data-card={`stopped:${t.id}`}>
      <span className="t c-red">Stopped</span>
      <span>{t.stopped.why || (t.stopped.by === 'limit' ? "It hit its plan's limit." : 'Its agent is no longer running.')}</span>
      <div className="acts">
        <Btn kind="pri" onClick={() => void tryAct({ type: 'task-resume', chat: taskChat(t) })}>Restart</Btn>
      </div>
    </div>
  )
}

/** In a chat: the cards of the tasks that need the person there (a review, a stopped agent), each where it came up.
 *  The app puts them there from each task's status, not an agent. In a task: its own review or stopped card. */
function taskCards(snap: Snapshot, thread: Thread): { key: string; at?: number; node: ReactNode }[] {
  // a task handed in: its card while it waits, and where the card was, one quiet line once it is done
  const reviewing = (t: Task) => tstate(t) === 'ready' || t.status === 'merging' || !!t.accepting || (tstate(t) === 'done' && !t.quiet && !!t.needsAtWas)
  const halted = (t: Task) => tstate(t) === 'ask' && !!t.stopped && t.stopped.by !== 'you'
  if (thread.task) {
    const t = thread.task
    return [...(reviewing(t) ? [{ key: `review:${t.id}`, node: <ReviewCard t={t} ctx="thread" /> }] : []), ...(halted(t) ? [{ key: `stopped:${t.id}`, node: <StoppedCard t={t} /> }] : [])]
  }
  const mine = tasksIn(snap, thread.place)
  return [
    ...mine.filter(reviewing).map((t, i) => ({ key: `review:${t.id}`, at: snap.demo ? new Date().setHours(7, 30, 0, i + 1) : t.needsAt ?? t.needsAtWas, node: <ReviewCard t={t} ctx="chat" /> })),
    ...mine.filter(halted).map((t) => ({
      key: `stopped:${t.id}`,
      at: t.needsAt,
      node: (
        <>
          <button type="button" className="ref" onClick={() => open(t)}><StatusIcon t={t} time="side" />{t.name}</button>
          <StoppedCard t={t} />
        </>
      ),
    })),
  ]
}

/* ---------- an open task ---------- */

function TaskHead({ task: t, where, scrolled }: { task: Task; where: 'chat' | 'pane'; scrolled?: boolean }) {
  const ph = useUI((u) => u.phone)
  const thread: Thread = { chat: taskChat(t), place: t.place, task: t, where }
  return (
    <Hd back={where === 'chat' ? { label: 'Back', run: () => setUI({ wide: false, task: null }) } : { label: 'Back to tasks', run: () => setUI({ task: null }) }} title={t.name} scrolled={scrolled}>
      {registry.taskHeader.map((h, i) => <h.View key={i} thread={thread} />)}
      <IB icon="dots" label="More" aria-haspopup="menu" onClick={(e) => taskMenu(e.currentTarget, t, 'thread')} />
      {where === 'pane' && !ph && <IB icon="expand" label="Expand" onClick={() => setUI({ wide: true })} />}
      {where === 'pane' && !ph && <IB icon="x" label="Close" onClick={() => togglePane(null)} />}
    </Hd>
  )
}

/** the status line: its status, time left, its id as small print, its machine, its pull request */
function TaskTop({ task: t }: { task: Task }) {
  const snap = useSnap()
  if (!snap) return null
  const w = statusWord(t)
  const left = leftWords(etaOf(t))
  const strong = w.tone === 'ask' || w.tone === 'ready' || w.tone === 'red'
  return (
    <div className="status">
      {strong ? <b className={w.tone === 'red' ? 'c-red' : `c-${w.tone}`}>{w.word}</b> : w.word}
      {left && <span>· {left}</span>}
      <span>· {taskRef(t)}</span>
      <span>· {machineLabel(snap, t.on)}</span>
      {t.pr && <span>· <a className="lk" href={t.pr.url} target="_blank" rel="noreferrer">PR #{t.pr.number}</a></span>}
    </div>
  )
}

function TaskPane({ t }: { t: Task }) {
  const snap = useSnap()!
  const ui = useUI()
  const thread: Thread = { chat: taskChat(t), place: t.place, task: t, where: 'pane' }
  const down = placeDown(snap, t.place)
  const Body = registry.chatBody.find((b) => b.when(ui, thread))?.View
  const Messages = registry.views.messages
  const Box = registry.views.box
  const drawer = registry.drawer.find((d) => d.when(ui, thread))
  return (
    <PaneFrame
      head={(sc) => <TaskHead task={t} where="pane" scrolled={sc} />}
      scrollKey={thread.chat}
      foot={!down && !Body && Box ? <Box thread={thread} placeholder={placeholderOf(snap, thread)} /> : undefined}
      drawer={drawer && (
        <>
          <div className="rzh" {...edge('term')} />
          <div className="tdr"><drawer.View thread={thread} /></div>
        </>
      )}
    >
      <div className="msgs">
        {down ? (
          <Empty title={`Can't reach ${down.name}`}>{down.unreachableSince ? `Last seen ${down.unreachableSince}. ` : ''}Work there carries on, and shows here when the link is back.</Empty>
        ) : Body ? (
          <Body thread={thread} />
        ) : (
          <>
            <TaskTop task={t} />
            {Messages && <Messages thread={thread} />}
          </>
        )}
      </div>
    </PaneFrame>
  )
}

/* ---------- the list ---------- */

function TaskRow({ snap, t, inSpace }: { snap: Snapshot; t: Task; inSpace: boolean }) {
  const cur = useUI((u) => u.task === t.id)
  const down = placeDown(snap, t.place)
  const s = tstate(t)
  const sub = down ? `Can't reach ${down.name} · last seen ${{ ask: 'asking', working: 'working', ready: 'ready', next: 'waiting', done: 'done', archived: 'done' }[s]}` : taskLine(t)
  const when = down ? '' : taskWhen(t)
  return (
    <div className="rowx">
      <button type="button" className={cx('row row2 tk', down && 'dim')} aria-current={cur} onClick={() => open(t)}>
        <StatusIcon t={t} dim={!!down} />
        <span className="n">
          <span className="l1">{t.name}</span>
          {sub && <span className="l2">{sub}</span>}
          {!inSpace && <span className="l2">{whereWords(snap, t.place)}</span>}
        </span>
        {when && <span className="v">{when}</span>}
      </button>
      <IB icon="dots" label={`More for ${t.name}`} aria-haspopup="menu" onClick={(e) => taskMenu(e.currentTarget, t, 'row')} />
    </div>
  )
}

function Now({ snap, place }: { snap: Snapshot; place: string }) {
  const ui = useUI()
  const inSpace = !isEverything(snap, place)
  const groups = nowGroups(tasksIn(snap, place)).filter((g) => g.tasks.length)
  if (!groups.length) return <Empty>No tasks yet. Ask in a chat to add one.</Empty>
  return (
    <>
      {groups.map((g) => {
        // Done and Archived start folded; the others open
        const o = ui.open[g.name] ?? !['Done', 'Archived'].includes(g.name)
        const shown = g.name === 'Done' ? g.tasks.slice(0, ui.doneShown) : g.tasks
        return (
          <div key={g.name} style={{ display: 'contents' }}>
            <button type="button" className="grp" aria-expanded={o} onClick={() => setUI({ open: { ...ui.open, [g.name]: !o } })}>
              {g.name} · {g.tasks.length}
              <I n="down" c="s16" />
            </button>
            {o && shown.map((t) => <TaskRow key={t.id} snap={snap} t={t} inSpace={inSpace} />)}
            {o && shown.length < g.tasks.length && (
              <button type="button" className="grp" onClick={() => setUI({ doneShown: ui.doneShown + 20 })}>Show more</button>
            )}
          </div>
        )
      })}
    </>
  )
}

function TasksPane() {
  const snap = useSnap()
  const ui = useUI()
  if (!snap) return null
  const t = ui.task && !ui.wide ? snap.tasks.find((x) => x.id === ui.task) : undefined
  if (t) return <TaskPane t={t} />
  const inSp = isEverything(snap, ui.at) ? '' : ` in ${spaceLabel(snap, ui.at)}`
  const Scheduled = has('schedules') ? registry.views.scheduled : undefined
  const tab = Scheduled ? ui.tab : 'Now'
  return (
    <PaneFrame head={(sc) => <Hd title={`Tasks${inSp}`} pad={ui.phone ? 12 : 4} scrolled={sc}>{!ui.phone && <IB icon="x" label="Close" onClick={() => togglePane(null)} />}</Hd>}>
      {Scheduled && (
        <div className="tabs" role="tablist">
          {(['Now', 'Scheduled'] as const).map((n) => (
            <button type="button" key={n} className="tab" role="tab" aria-selected={tab === n} aria-pressed={tab === n} onClick={() => setUI({ tab: n })}>{n}</button>
          ))}
        </div>
      )}
      {tab === 'Now' || !Scheduled ? <Now snap={snap} place={ui.at} /> : <Scheduled place={ui.at} />}
    </PaneFrame>
  )
}

function TasksButton() {
  const snap = useSnap()
  const on = useUI((u) => u.pane === 'tasks')
  const at = useUI((u) => u.at)
  return (
    <IB icon="tasks" label="Tasks" pressed={on} onClick={() => togglePane('tasks')}>
      {snap && <Cnt n={needsCount(snap, at)} />}
    </IB>
  )
}

export default definePlugin({
  name: 'tasks',
  setup(reg) {
    reg.header.push({ order: 30, View: TasksButton })
    reg.bar.push({ order: 10, pane: 'tasks', label: 'Tasks', icon: 'tasks', count: (snap, place) => needsCount(snap, place) })
    reg.panes.push({ id: 'tasks', View: TasksPane })
    reg.views.taskHead = TaskHead
    reg.views.taskTop = TaskTop
    reg.chatCards.push({ order: 20, cards: taskCards })
  },
})

export { notice }
