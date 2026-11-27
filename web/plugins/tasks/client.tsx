// Tasks: the pane with Now (Needs you, Working, Up next, Done, Archived) and Scheduled, a task opened as a thread
// (back, title, Terminal, Screen, its menu, expand, its own reply box), the review card wherever it comes up, the
// Start task dialog for one not started yet, and a task's menu. Now lists every task everywhere unless its filter says
// otherwise (SHEP-331): a filter button in the header, the choices that are on as chips under it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { PaneFrame, placeholderOf, showList } from '@client/App.tsx'
import { newSpaceDialog, renameDialog } from '@client/list.tsx'
import { definePlugin, getState, go, has, type Command, maximize, sideHidden, minimize, notice, openTask, registry, setUI, togglePane, tryAct, act, attempt, useSnap, useStore, useUI, type MenuRow, type Thread } from '@client/kernel.ts'
import { confirm, openDialog, openForm, openMenu } from '@client/overlay.tsx'
import { AgentField, pickFor, PickSummary, reportedPick, useCatalog, type Pick } from '@client/picker.tsx'
import { edge } from '@client/resize.ts'
import { ActBtn, ActError, Btn, Cnt, cx, Empty, Hd, I, IB, MenuGroup, Row, useCardActs } from '@client/ui.tsx'
import { waiting } from '@client/pending.ts'
import { copyText } from '@client/copy.ts'
import { alertWhat, taskAlerts, type Alert } from '@shared/needs-you.ts'
import { focusBox, focusChat, focusTask } from '@client/commands.ts'
import { SpaceIcon } from '@client/space-icon.tsx'
import type { MergeEvidence, Message, Snapshot, Task } from '@shared/types.ts'
import { askedWords, isEverything, machineLabel, nowGroups, onBranch, placeDown, reposOf, spaceLabel, spaceOnFolder, spacesOf, etaOf, headLine, leftWords, statusWord, taskChat, taskLine, taskWhen, tasksIn, tstate, workKey, workName, workWords, type Repo } from '@shared/view.ts'
import { DoneRow } from '@plugins/chat/cards.tsx'
import { Markdown } from '@plugins/chat/markdown.tsx'
import { readable, words as saidWords } from '@core/accept.js'
import { replyToTask, SlideHint, useSlide } from '@plugins/chat/slide.tsx'
import { StatusIcon } from './icon.tsx'
import { chipsOf, choices, clean, filterCount, filterOn, filterTasks, hereOn, NO_FILTER, toggle, type GroupKey, type TaskFilter } from '@shared/task-filter.ts'

export { StatusIcon }

/* ---------- where a task works (SHEP-325) ---------- */

/** a repo's or folder's tasks: the Tasks panel with its filter on that repo (SHEP-331: one filter; its other picks
 *  stay, but not a space, which would hide the rest of the repo) */
export function showRepo(key: string) {
  setUI((ui) => ({ pane: 'tasks', task: null, tab: 'Now', tf: { ...clean(ui.tf), repo: [key], space: [], here: false }, drawer: false, search: false, settings: null }))
}

/** a task's tag: where it works ("shepherdr", "shepherdr · mac-mini"); a tap shows that repo's tasks. A row has its
 *  repo line instead (RepoLine, SHEP-348). */
export function WorkTag({ snap, t }: { snap: Snapshot; t: Task }) {
  const words = workWords(snap, t)
  if (!words) return null
  const go = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    showRepo(workKey(t))
  }
  return <button type="button" className="wtag" aria-label={`All tasks in ${workName(t)}`} onClick={go}><I n="folder" />{words}</button>
}

/* ---------- its branch and pull request (SHEP-348) ---------- */

export type PrState = 'merged' | 'closed' | 'running' | 'failed' | 'passed' | 'open'

/** what its pull request says, in one word: merged, closed on GitHub, else its checks (open when none are known) */
export function prState(t: Task): PrState | null {
  if (!t.pr) return null
  if (t.merged) return 'merged'
  if (t.pr.closed) return 'closed'
  return t.pr.checks ?? 'open'
}

const PR_WORDS: Record<PrState, string> = { merged: 'merged', closed: 'closed', running: 'checks running', failed: 'checks failed', passed: 'checks passed', open: 'open' }

/** the one tiny mark for its checks: running a quiet ring, failed red, passed green (nothing for the rest) */
function ChecksMark({ st }: { st: PrState | null }) {
  if (st === 'running') return <I n="checking" />
  if (st === 'failed') return <I n="x" c="c-red" />
  if (st === 'passed') return <I n="check" c="c-ready" />
  return null
}

/** open a task at its branch and pull request strip (a row's repo line): the chat scrolls there and marks it a moment */
export function openAtStrip(t: Task) {
  if (tstate(t) === 'next' && !t.agent && !t.started) return startDialog(t)
  openTask(t.id)
  setUI({ jump: `strip:${t.id}` })
}

/** A row's repo line: where it works, the folder icon a branch one when it has its own branch (or worktree), and its
 *  pull request with one mark for its checks ("PR #1318 ×"), or "Merged #1314". A tap opens the task at its strip. */
export function RepoLine({ snap, t }: { snap: Snapshot; t: Task }) {
  const words = workWords(snap, t)
  if (!words) return null
  const branch = onBranch(t)
  const st = prState(t)
  const n = t.pr?.number
  const spoken = [words, branch ? 'own branch' : t.repo === 'folder' ? 'in the folder' : '', st === 'merged' ? `merged, pull request ${n}` : t.pr ? `pull request ${n}, ${PR_WORDS[st!]}` : ''].filter(Boolean).join(', ')
  const go = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    openAtStrip(t)
  }
  return (
    <span className="l2 rline" role="link" aria-label={`${spoken}: show its branch`} onClick={go}>
      <I n={branch ? 'branch' : 'folder'} />
      <span className="rn">{words}</span>
      {t.pr && <span aria-hidden="true">·</span>}
      {st === 'merged' && <><I n="merged" /><span className="pn">Merged #{n}</span></>}
      {t.pr && st !== 'merged' && <><span className="pn">PR #{n}</span><ChecksMark st={st} /></>}
    </span>
  )
}

/** The task's page, under its title: its full branch and what it builds on, its pull request (state, checks, a link to
 *  GitHub), and where it works: its own worktree, or the folder itself. Nothing for a task outside a repo. */
export function GitStrip({ t }: { t: Task }) {
  const on = useUI((u) => u.jump === `strip:${t.id}`)
  const branch = onBranch(t)
  if (!branch && t.repo !== 'folder' && !t.pr) return null
  const st = prState(t)
  return (
    <div className={cx('gstrip', on && 'jump')} data-card={`strip:${t.id}`}>
      {branch && (
        <div className="gl">
          <I n="branch" />
          <span className="tr gb">{t.branch || 'Its own branch'}</span>
          {t.base && <span className="mu">from {t.base}</span>}
        </div>
      )}
      {t.pr ? (
        <div className="gl">
          <I n={st === 'merged' ? 'merged' : 'pr'} />
          <span className="pn">PR #{t.pr.number}</span>
          <ChecksMark st={st} />
          <span className={cx('tr', st === 'failed' ? 'c-red' : 'mu')}>{PR_WORDS[st!]}</span>
          <a className="gh" href={t.pr.url} target="_blank" rel="noreferrer" aria-label={`Pull request ${t.pr.number} on GitHub`}>GitHub<I n="ext" /></a>
        </div>
      ) : branch && (
        <div className="gl"><I n="pr" /><span className="tr mu">No pull request yet</span></div>
      )}
      <div className="gl">
        <I n="folder" />
        <span className="tr mu">{!branch ? 'Works in the folder itself, no branch' : t.worktree ? 'In its own worktree' : 'In the folder, on its own branch'}</span>
      </div>
    </div>
  )
}

/* ---------- a task's menu ---------- */

/** open a task: one not started yet opens its Start dialog instead of its thread; one whose agent is starting opens
 *  its thread (its brief, and that it is starting: SHEP-330) */
export function open(t: Task) {
  if (tstate(t) === 'next' && !t.agent && !t.started) return startDialog(t)
  openTask(t.id)
}

/** Mark as done from the menu asks first: a slip of the thumb has no one-tap undo (reopening a task loses its Ready
 *  or its place in the queue), and it merges nothing */
function markDone(t: Task) {
  confirm({
    title: `Mark “${t.name}” as done?`,
    body: onBranch(t) ? 'Nothing is merged: its branch stays as it is.' : 'It moves to Done.',
    ok: 'Mark as done',
    run: () => tryAct({ type: 'close', chat: taskChat(t), force: true }, undefined, 'Marking as done…'),
  })
}

function del(t: Task) {
  confirm({
    title: 'Delete this task?',
    body: `“${t.name}” is removed from Shepherdr and its agent is stopped. Its branch and files are left alone.`,
    ok: 'Delete',
    danger: true,
    run: async () => {
      if (await tryAct({ type: 'delete', chat: taskChat(t), force: true }, undefined, 'Deleting…')) setUI((ui) => ({ ...(ui.task === t.id ? { task: null } : {}), ...(ui.max === t.id ? { max: null } : {}) }))
    },
  })
}

/** A task's menu, on its row and in its thread: in its thread first Terminal and Screen (its header has no buttons for
 *  them); Reply in chat (in the space's chat, SHEP-415), Open task, Show in #space, Show screen, Move to (only before it has started), Mark as done, Rename,
 *  Stop, then Archive and Delete. In its thread, View as terminal / View as chat follows Terminal and Screen below a line:
 *  it changes this chat's view rather than opening one beside it. */
export function taskMenu(anchor: Element, t: Task, where: 'row' | 'thread') {
  const rows = taskRows(t, where)
  if (rows) openMenu(anchor, rows, { label: t.name })
}

/** a task's menu's rows (its menu, and the palette's actions on the task in focus) */
export function taskRows(t: Task, where: 'row' | 'thread'): MenuRow[] | null {
  const snap = getState().snap
  if (!snap) return null
  const s = tstate(t)
  const th = where === 'thread'
  const chat = taskChat(t)
  const every = isEverything(snap, t.place)
  const extra = registry.taskMenu.flatMap((m) => m.rows(t, where))
  const views = extra.filter((r) => r.on !== undefined)
  const viewSwitch = extra.filter((r) => r.icon === 'viewswap')
  const rows: MenuRow[] = [
    ...views,
    ...viewSwitch,
    ...(th ? [] : [
      // Reply in chat quotes it in the space's chat, as a reply to a message: "status?" is then about this task. Writing
      // to its own agent is Open task.
      { icon: 'reply' as const, label: 'Reply in chat', run: () => replyToTask(t) },
      { icon: 'chat' as const, label: 'Open task', run: () => open(t) },
    ]),
    { icon: every ? 'layers' : 'hash', label: `Show in ${spaceLabel(snap, t.place)}`, line: views.length + viewSwitch.length > 0, run: () => go(t.place) },
    ...(t.work ? [{ icon: 'folder' as const, label: `All tasks in ${workName(t)}`, run: () => showRepo(workKey(t)) }] : []),
    ...extra.filter((r) => r.label === 'Show screen'),
    ...(s === 'next' ? [{ icon: 'folder' as const, label: 'Move to', sub: spacesOf(snap).filter((p) => p.id !== t.place && !p.archived).map((p) => ({ label: spaceLabel(snap, p.id), run: () => void tryAct({ type: 'task-move', chat, place: p.id }, undefined, 'Moving…') })) }] : []),
    // from the menu it closes without merging: "Done · not merged" for a task on its own branch
    ...(s !== 'done' && s !== 'archived' ? [{ icon: 'check' as const, label: 'Mark as done', run: () => markDone(t) }] : []),
    { icon: 'pen', label: 'Rename', cmd: 'tasks.rename', run: () => renameDialog(t.name, (name) => tryAct({ type: 'task-rename', chat, name })) },
    // Stop pauses the agent, like pressing Esc: it drops what it was doing and waits
    ...(s === 'working' ? [{ icon: 'stop' as const, label: 'Stop', cmd: 'tasks.stop', run: () => void tryAct({ type: 'stop', chat }, undefined, 'Stopping…') }] : []),
    ...extra.filter((r) => r.label !== 'Show screen' && r.on === undefined && r.icon !== 'viewswap'),
    { icon: 'archive', label: t.archived ? 'Unarchive' : 'Archive', line: true, run: () => { void tryAct({ type: 'archive', chat, on: !t.archived }, undefined, t.archived ? 'Unarchiving…' : 'Archiving…'); if (!t.archived) setUI((ui) => ({ ...(ui.task === t.id ? { task: null } : {}), ...(ui.max === t.id ? { max: null } : {}) })) } },
    { icon: 'bin', label: 'Delete', danger: true, run: () => del(t) },
  ]
  return rows
}

/* ---------- a task not started yet ---------- */

function TaskAgentSummary({ t, className }: { t: Task; className?: string }) {
  const agent = useStore((s) => s.chats[taskChat(t)]?.agent)
  const cat = useCatalog(t.on)
  const pick = reportedPick(agent ?? t.agent?.settings) ?? t.plannedAgent
  if (!pick) return null
  return <span className={className}><PickSummary pick={pick} cat={cat} /></span>
}

function startDialog(t: Task) {
  openForm(
    function Form({ close }) {
      const snap = getState().snap!
      const every = isEverything(snap, t.place)
      const machine = snap.places.find((p) => p.id === t.place)?.machine ?? t.on
      const initial = t.plannedAgent ?? pickFor(snap, every ? 'all' : t.place, 'Tasks')
      const [pick, setPick] = useState<Pick>(initial)
      const [busy, setBusy] = useState(false)
      const start = async () => {
        if (busy) return
        setBusy(true)
        // Start task starts it and opens its thread
        if (await tryAct({ type: 'task-start', chat: taskChat(t), ...(pick === initial ? {} : { agent: pick }) })) {
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
          <p>{t.desc ? `${t.desc.replace(/\s+$/, '')}${/[.!?]$/.test(t.desc.trim()) ? '' : '.'} ` : ''}{t.afterTitle ? `It waits for ${t.afterTitle}${t.afterMore ? ` and ${t.afterMore} more` : ''}; nothing starts before that unless you say go.` : 'Nothing starts until you say go.'}</p>
          <div className="fld">
            <span>Space</span>
            <span className="fake">
              <SpaceIcon snap={snap} id={t.place} />
              <span style={{ marginLeft: 8 }}>
                <b style={{ fontWeight: 500 }}>{spaceLabel(snap, t.place).replace(/^#/, '')}</b> <span style={{ color: 'var(--muted)' }}>{machineLabel(snap, machine)}</span>
              </span>
            </span>
          </div>
          <AgentField title="This task runs on" machine={machine} pick={pick} onChange={setPick} />
          <Btn kind="pri" className={busy ? 'busy' : undefined} style={{ width: '100%' }} aria-busy={busy || undefined} onClick={() => void start()}>{busy ? <><I n="working" c="s16" />Starting…</> : 'Start task'}</Btn>
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
  const [more, setMore] = useState(false)
  const [, bump] = useState(0)
  const Tile = registry.views.tile
  // its buttons answer at once and wait together (pending.ts): Mark as done holds until the server's state moves on
  const acts = useCardActs(`review:${t.id}`, `${tstate(t)}|${t.status ?? ''}|${t.mergeFailed ?? ''}`)
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
  // what its agent said with ready: the short summary up top, its details folded under it (an older, too long summary
  // keeps its first sentence and folds the rest)
  const said = saidWords({ summary: t.summary ?? ev?.summary, details: t.details ?? ev?.details }) as { summary: string; details: string }
  return (
    <div className="card" data-card={`review:${t.id}`}>
      {ctx === 'chat' && <span className="t tw"><StatusIcon t={t} time="none" />{t.name}</span>}
      <span className="s">{ctx === 'chat' && t.work && <><WorkTag snap={snap} t={t} /> · </>}{where}</span>
      {ctx === 'chat' && <TaskAgentSummary t={t} className="s" />}
      <span>{said.summary || 'Ready for you to look at.'}</span>
      {t.reviewerNotice && <span className="s">{t.reviewerNotice}</span>}
      {said.details && (
        <button type="button" className="fold" aria-expanded={more} onClick={() => setMore(!more)}>
          <I n={more ? 'down' : 'right'} c="s16" />
          Details
        </button>
      )}
      {more && said.details && <Markdown text={readable(said.details)} />}
      {proof && Tile && <div className="atile"><Tile id={proof} /></div>}
      {foldWords && (
        <button type="button" className="fold" aria-expanded={fold} onClick={() => setFold(!fold)}>
          <I n={fold ? 'down' : 'right'} c="s16" />
          {foldWords}
        </button>
      )}
      {fold && (
        <div className="files">
          {files.map((f) => {
            const n = <>{f.path}<em>{[f.added ? `+${f.added}` : '', f.removed ? `−${f.removed}` : ''].filter(Boolean).join(' ')}</em></>
            // with the Diff viewer on, a file opens its changes in the Changes pane
            return has('diff') ? <button type="button" key={f.path} onClick={() => setUI({ pane: 'diff', task: null, art: null, artWide: false, diff: { src: `task:${t.id}`, file: f.path } })}>{n}</button> : <span key={f.path}>{n}</span>
          })}
        </div>
      )}
      {t.mergeFailed && <span className="s c-red">{t.mergeFailed}</span>}
      {later.has(t.id) && <span className="s">Still here when you want it. Say what to change in the box below.</span>}
      {down ? (
        <span className="s">Can't reach {down.name}: this waits until the link is back</span>
      ) : (
        <>
          <div className="acts">
            <Btn disabled={waiting(acts.now) || merging} onClick={() => { later.add(t.id); bump((n) => n + 1) }}>Not now</Btn>
            {merging ? (
              <Btn kind={ctx === 'chat' ? 'str' : 'pri'} className="busy" aria-disabled aria-busy><I n="working" c="s16" />Merging…</Btn>
            ) : (
              <ActBtn acts={acts} id="accept" kind={ctx === 'chat' ? 'str' : 'pri'} busy={branch ? 'Merging…' : 'Marking as done…'} run={() => attempt({ type: 'accept', task: t.id })}>
                {branch ? 'Mark as done and merge' : 'Mark as done'}
              </ActBtn>
            )}
          </div>
          <ActError acts={acts} />
        </>
      )}
    </div>
  )
}

/** An agent that crashed or was cut off is never started again by Shepherdr on its own: a card with the reason and
 *  Restart. Stopped by you: the next message carries on. */
export function StoppedCard({ t }: { t: Task }) {
  const acts = useCardActs(`stopped:${t.id}`, `${tstate(t)}|${t.stopped?.why ?? ''}|${t.stopped?.by ?? ''}`)
  if (!t.stopped || t.stopped.by === 'you') return null
  return (
    <div className="card" data-card={`stopped:${t.id}`}>
      <span className="t c-red">Stopped</span>
      <TaskAgentSummary t={t} className="s" />
      <span>{t.stopped.why || (t.stopped.by === 'limit' ? "It hit its plan's limit." : 'Its agent is no longer running.')}</span>
      <div className="acts">
        <ActBtn acts={acts} id="restart" kind="pri" busy="Restarting…" run={() => attempt({ type: 'task-resume', chat: taskChat(t) })}>Restart</ActBtn>
      </div>
      <ActError acts={acts} />
    </div>
  )
}

/** its agent's alert while it stands (#1561): its words, say a guard's one-time approval code, and Copy */
function AlertCard({ a }: { a: Alert }) {
  return (
    <div className="card" data-card={`alert:${a.id}`}>
      <span className="t">{alertWhat(a)}</span>
      {a.body && <span>{a.body}</span>}
      {a.body && (
        <div className="acts">
          <Btn onClick={(e) => void copyText(a.body, e.currentTarget).then((ok) => ok && notice('Copied'))}>Copy</Btn>
        </div>
      )}
    </div>
  )
}

/** In a chat: the cards of the tasks that need the person there (a review, a stopped agent), each where it came up.
 *  The app puts them there from each task's status, not an agent. In a task: its own review or stopped card. */
function taskCards(snap: Snapshot, thread: Thread): { key: string; at?: number; past?: boolean; after?: (m: Message) => boolean; node: ReactNode }[] {
  // a task handed in: its card while it waits, and where the card was, one quiet line once it is done
  const reviewing = (t: Task) => tstate(t) === 'ready' || t.status === 'merging' || !!t.accepting || (tstate(t) === 'done' && !t.quiet && !!t.needsAtWas)
  const halted = (t: Task) => tstate(t) === 'ask' && !!t.stopped && t.stopped.by !== 'you'
  if (thread.task) {
    const t = thread.task
    const alert = taskAlerts(snap).get(t.id)
    // each where it came up among the messages, never held at the end (SHEP-419)
    // a Ready card still waiting goes below what was said after it (#1475)
    return [...(reviewing(t) ? [{ key: `review:${t.id}`, at: t.needsAt ?? t.needsAtWas, past: tstate(t) === 'done', after: () => true, node: <ReviewCard t={t} ctx="thread" /> }] : []), ...(halted(t) ? [{ key: `stopped:${t.id}`, at: t.needsAt, node: <StoppedCard t={t} /> }] : []), ...(alert ? [{ key: `alert:${alert.id}`, at: alert.at, after: () => true, node: <AlertCard a={alert} /> }] : [])]
  }
  // cards stay in the chat that asked (SHEP-325): a space's Tasks also holds what works in its folder, its chat does not
  const mine = tasksIn(snap, thread.place).filter((t) => isEverything(snap, thread.place) || t.place === thread.place)
  return [
    ...mine.filter(reviewing).map((t, i) => ({ key: `review:${t.id}`, at: snap.demo ? new Date().setHours(7, 30, 0, i + 1) : t.needsAt ?? t.needsAtWas, past: tstate(t) === 'done', after: (m: Message) => m.news?.task === t.id, node: <ReviewCard t={t} ctx="chat" /> })),
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

/** An open task's header. In the pane: Back to tasks, and Maximize, which gives it the middle. Maximized (SHEP-435,
 *  as Linear's and Notion's peek opened as a full page): Minimize in Back's place puts it back in the pane, and its
 *  space shows under its title, so where it sits and the way back are in sight. */
function TaskHead({ task: t, where, scrolled }: { task: Task; where: 'chat' | 'pane'; scrolled?: boolean }) {
  const ph = useUI((u) => u.phone)
  const hidden = useUI(sideHidden)
  const snap = useSnap()
  const thread: Thread = { chat: taskChat(t), place: t.place, task: t, where }
  const big = where === 'chat'
  // #1473: how it is doing, live, as its row in the list: its ring and its words (maximized, then its space)
  const live = (snap && snap.tasks.find((x) => x.id === t.id)) || t
  const line = headLine(live)
  return (
    <Hd
      back={big ? undefined : { label: 'Back to tasks', run: () => setUI({ task: null }) }}
      lead={big ? <>{hidden && !ph && <IB icon="panel" label="Show the list" onClick={showList} />}<IB icon="shrink" label="Minimize" onClick={minimize} /></> : undefined}
      title={t.name}
      sub={
        <span className="hline">
          <StatusIcon t={live} time="none" />
          <span>{big && snap ? `${line} · in ${spaceLabel(snap, t.place)}` : line}</span>
          <TaskAgentSummary t={live} className="head-agent" />
        </span>
      }
      scrolled={scrolled}
    >
      {registry.taskHeader.map((h, i) => <h.View key={i} thread={thread} />)}
      <IB icon="dots" label="More" aria-haspopup="menu" onClick={(e) => taskMenu(e.currentTarget, t, 'thread')} />
      {/* maximized, the space header's own buttons (Artifacts, Tasks) open the pane beside it */}
      {big && !ph && registry.header.map((h, i) => <h.View key={`h${i}`} thread={thread} />)}
      {where === 'pane' && !ph && <IB icon="expand" label="Maximize" onClick={() => maximize(t.id)} />}
      {where === 'pane' && !ph && <IB icon="x" label="Close" onClick={() => togglePane(null)} />}
    </Hd>
  )
}

/** the status line: its status, time left, its machine (SHEP-322: never its key; its pull request is in the strip under
 *  it, SHEP-348) */
function TaskTop({ task: t }: { task: Task }) {
  const snap = useSnap()
  if (!snap) return null
  const w = statusWord(t)
  const left = leftWords(etaOf(t))
  const strong = w.tone === 'ask' || w.tone === 'ready' || w.tone === 'red'
  return (
    <div className="status">
      {strong ? <b className={w.tone === 'ask' ? 'c-red' : `c-${w.tone}`}>{w.word}</b> : w.word}
      {left && <span>· {left}</span>}
      {t.work ? <span>· <WorkTag snap={snap} t={t} /></span> : <span>· {machineLabel(snap, t.on)}</span>}
    </div>
  )
}

/** the one quiet line under it: the space that asked for it, a tap opens that chat */
function AskedIn({ snap, t }: { snap: Snapshot; t: Task }) {
  const words = askedWords(snap, t)
  if (!words || !t.asked) return null
  const id = t.asked
  return <button type="button" className="asked lk" onClick={() => go(id)}>{words}</button>
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
      foot={!down && !Body && Box ? (
        <>
          {registry.aboveBox.filter((a) => a.inPane).map((a, i) => <a.View key={i} thread={thread} />)}
          <Box thread={thread} placeholder={placeholderOf(snap, thread)} />
        </>
      ) : undefined}
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
            <GitStrip t={t} />
            <AskedIn snap={snap} t={t} />
            {Messages && <Messages thread={thread} />}
          </>
        )}
      </div>
    </PaneFrame>
  )
}

/* ---------- the list ---------- */

function TaskRow({ snap, t, tag, alert }: { snap: Snapshot; t: Task; tag: boolean; alert?: Alert }) {
  const cur = useUI((u) => u.task === t.id)
  const down = placeDown(snap, t.place)
  const s = tstate(t)
  const sub = down ? `Can't reach ${down.name} · last seen ${{ ask: 'asking', working: 'working', ready: 'ready', next: 'waiting', done: 'done', archived: 'done' }[s]}` : taskLine(t)
  const when = down ? '' : taskWhen(t)
  // a slide to the right replies to it in the space's chat, as to a message (Reply in chat)
  const { on, slide, armed, skip, moving } = useSlide(() => replyToTask(t))
  return (
    <div className="rowx tsl" data-task-row={t.id} {...on}>
      <SlideHint slide={slide} armed={armed} />
      <button type="button" className={cx('row row2 tk', down && 'dim', moving.className)} style={moving.style} onTransitionEnd={moving.onTransitionEnd} aria-current={cur} onClick={() => (skip.current ? void (skip.current = false) : open(t))}>
        <StatusIcon t={t} dim={!!down} />
        <span className="n">
          <span className="l1">{t.name}</span>
          {alert && !down ? (
            <>
              <span className="l2 alw">{alertWhat(alert)}</span>
              {alert.body && <span className="l2">{alert.body}</span>}
            </>
          ) : sub && <span className="l2">{sub}</span>}
          <TaskAgentSummary t={t} className="l2" />
          {tag && t.work && <RepoLine snap={snap} t={t} />}
        </span>
        {when && <span className="v">{when}</span>}
      </button>
      <IB icon="dots" label={`More for ${t.name}`} aria-haspopup="menu" className={moving.className} style={moving.style} onClick={(e) => taskMenu(e.currentTarget, t, 'row')} />
    </div>
  )
}

/** a repo's tasks: its name, folder and machine, and its space, or "Make it a space" when none works there */
function RepoHead({ snap, r }: { snap: Snapshot; r: Repo }) {
  const sp = spaceOnFolder(snap, r)
  const n = r.tasks.length
  const facts = [r.short !== r.name ? r.short : '', snap.machines.length > 1 ? machineLabel(snap, r.machine) : '', `${n} ${n === 1 ? 'task' : 'tasks'}`].filter(Boolean).join(' · ')
  return (
    <div className="rhead">
      <I n="folder" />
      <span className="n">
        <span className="l1">{r.name}</span>
        <span className="l2">{facts}</span>
      </span>
      {sp ? (
        <Btn onClick={() => go(sp.id)}>Open {spaceLabel(snap, sp.id)}</Btn>
      ) : (
        <Btn onClick={() => newSpaceDialog(r.machine, { name: r.repo ? r.name : '', folder: r.short })}>Make it a space</Btn>
      )}
      <IB icon="x" label="Show all tasks" onClick={() => setTF((x) => ({ ...x, repo: [] }))} />
    </div>
  )
}

function Now({ snap, place }: { snap: Snapshot; place: string }) {
  const ui = useUI()
  const f = ui.tf
  // one repo picked: its head on top (its space, or Make it a space), and the rows leave out its tag
  const repo = f.repo.length === 1 ? reposOf(snap).find((r) => r.key === f.repo[0]) : undefined
  const top = repo && <RepoHead snap={snap} r={repo} />
  const alerts = taskAlerts(snap)
  const filtered = filterTasks(snap, f, place)
  const byId = new Map(filtered.filter((t) => !t.archived).map((t) => [t.id, t]))
  const queued = snap.needs.flatMap((n) => {
    const task = n.task ? byId.get(n.task) : undefined
    return n.question?.queued && task ? [{ task, question: n.question }] : []
  })
  const groups = nowGroups(filtered, alerts).filter((g) => g.tasks.length || (g.name === 'Needs you' && queued.length))
  if (!groups.length)
    return snap.tasks.length ? (
      <>
        {top}
        <Empty title="No tasks match">
          <Btn onClick={() => setUI({ tf: NO_FILTER })}>Clear filter</Btn>
        </Empty>
      </>
    ) : (
      <Empty>No tasks yet. Ask in a chat to add one.</Empty>
    )
  return (
    <>
      {top}
      {groups.map((g) => {
        // Done and Archived start folded; the others open
        const o = ui.open[g.name] ?? !['Done', 'Archived'].includes(g.name)
        const shown = g.name === 'Done' ? g.tasks.slice(0, ui.doneShown) : g.tasks
        const questions = g.name === 'Needs you' ? queued : []
        return (
          <div key={g.name} style={{ display: 'contents' }}>
            <button type="button" className="grp" aria-expanded={o} onClick={() => setUI({ open: { ...ui.open, [g.name]: !o } })}>
              {g.name} · {g.tasks.length + questions.length}
              <I n="down" c="s16" />
            </button>
            {o && shown.map((t) => <TaskRow key={t.id} snap={snap} t={t} tag={!repo} alert={alerts.get(t.id)} />)}
            {o && questions.map(({ task, question }) => <Row key={question.id} icon="chat"
              label={question.title} sub={task.name} onClick={() => { openTask(task.id); setUI({ jump: question.id }) }} />)}
            {o && shown.length < g.tasks.length && (
              <button type="button" className="grp" onClick={() => setUI({ doneShown: ui.doneShown + 20 })}>Show more</button>
            )}
          </div>
        )
      })}
    </>
  )
}

/* ---------- the filter ---------- */

const setTF = (f: (tf: TaskFilter) => TaskFilter) => setUI((ui) => ({ tf: f(clean(ui.tf)) }))

/** a box in a multi-select row: ticked when the choice is on */
const Tick = ({ on }: { on: boolean }) => <span className={cx('cbx', on && 'on')} aria-hidden="true">{on && <I n="check" />}</span>

/** the menu (a sheet on a phone): the quick choices, then State, Machine, Space and Repo, each a multi-select under its
 *  name, in the list's filter rhythm (MenuGroup); it stays open while you pick. Each row: its box, its name (a space's or
 *  repo's machine quiet beside it when there are several) and how many tasks it has. Its body scrolls, fading at the
 *  edge with more; Clear stays at its foot while a filter is on. A long Space or Repo list gets a search box. */
function FilterMenu() {
  const snap = useSnap()
  const f = useUI((u) => u.tf)
  const at = useUI((u) => u.at)
  const [qs, setQs] = useState<Record<string, string>>({})
  const body = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ up: false, down: false })
  const look = () => {
    const el = body.current
    if (!el) return
    const next = { up: el.scrollTop > 1, down: el.scrollHeight - el.scrollTop - el.clientHeight > 1 }
    setFade((was) => (was.up === next.up && was.down === next.down ? was : next))
  }
  useLayoutEffect(() => {
    look()
    const el = body.current
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(look) : null
    if (el) ro?.observe(el)
    return () => ro?.disconnect()
  })
  if (!snap) return null
  const inSpace = !!at && !isEverything(snap, at)
  const machines = new Set(snap.machines.map((m) => m.machine)).size > 1
  const check = (key: string, label: ReactNode, on: boolean, run: () => void, n?: number) => (
    <Row key={key} lead={<Tick on={on} />} label={label} value={n ? String(n) : undefined} role="menuitemcheckbox" aria-checked={on} onClick={run} />
  )
  const group = (key: GroupKey, name: string) => {
    const all = choices(snap, key, f)
    if (all.length < 2 && !f[key].length) return null
    const many = (key === 'space' || key === 'repo') && all.length > 8
    const q = qs[key] ?? ''
    const shown = many && q ? all.filter((c) => `${c.label} ${c.machine ?? ''}`.toLowerCase().includes(q.toLowerCase())) : all
    const find = key === 'space' ? 'Find a space' : 'Find a repo'
    return (
      <MenuGroup key={key} cap={name}>
        {many && <input className="inp tfq" name={`${key}-search`} aria-label={find} placeholder={find} value={q} onChange={(e) => setQs({ ...qs, [key]: e.target.value })} />}
        {shown.map((c) => {
          const where = machines && c.machine ? c.machine : ''
          const label = where ? <><span className="tft">{c.label}</span><span className="tfw">{where}</span></> : c.label
          return check(c.id, label, f[key].includes(c.id), () => setTF((x) => toggle(x, key, c.id)), c.n)
        })}
        {many && q && !shown.length && <p className="tfnone">Nothing called “{q}”</p>}
      </MenuGroup>
    )
  }
  const on = filterOn(snap, f, at)
  const picked = chipsOf(snap, f, at).length
  return (
    <div className="tfm">
      <div ref={body} className="tfb" onScroll={look} data-up={fade.up || undefined} data-down={fade.down || undefined}>
        <MenuGroup>
          {inSpace && check('here', `${spaceLabel(snap, at)} only`, f.here, () => setTF((x) => ({ ...x, here: !x.here })))}
          {check('hideDone', 'Hide done', f.hideDone, () => setTF((x) => ({ ...x, hideDone: !x.hideDone, state: x.hideDone ? x.state : x.state.filter((s) => s !== 'done' && s !== 'archived') })))}
        </MenuGroup>
        {group('state', 'State')}
        {group('machine', 'Machine')}
        {group('space', 'Space')}
        {group('repo', 'Repo')}
      </div>
      {on && (
        <div className="tff">
          <Row icon="x" label="Clear filters" value={`${picked} on`} role="menuitem" onClick={() => setUI({ tf: NO_FILTER })} />
        </div>
      )}
    </div>
  )
}

/** the filter button: the sidebar's, with a dot while a filter is on; its menu stays inside the panel, lined up with it */
function FilterButton() {
  const snap = useSnap()
  const f = useUI((u) => u.tf)
  const at = useUI((u) => u.at)
  const on = !!snap && filterOn(snap, f, at)
  return (
    <IB icon="filter" label={on ? 'Filter tasks (on)' : 'Filter tasks'} aria-haspopup="menu" data-marks="" onClick={(e) => openMenu(e.currentTarget, () => <FilterMenu />, { label: 'Filter tasks', within: e.currentTarget.closest('.hd')?.parentElement })}>
      {on && <span className="fdot" />}
    </IB>
  )
}

/** the choices that are on, each taken off by its ✕ */
function Chips({ snap }: { snap: Snapshot }) {
  const f = useUI((u) => u.tf)
  const at = useUI((u) => u.at)
  const chips = chipsOf(snap, f, at)
  if (!chips.length) return null
  return (
    <div className="fchips tfc" role="list" aria-label="Filters on">
      {chips.map((c) => (
        <span key={c.key} className="fchip" role="listitem">
          <I n={c.icon} c="s16" />
          <span className="tfl">{c.label}</span>
          <button type="button" aria-label={`Remove ${c.label}`} onClick={() => setTF(c.off)}><I n="x" c="s16" /></button>
        </span>
      ))}
    </div>
  )
}

function TasksPane() {
  const snap = useSnap()
  const ui = useUI()
  if (!snap) return null
  const t = ui.task ? snap.tasks.find((x) => x.id === ui.task) : undefined
  if (t) return <TaskPane t={t} />
  const Scheduled = has('schedules') ? registry.views.scheduled : undefined
  const tab = Scheduled ? ui.tab : 'Now'
  const now = tab === 'Now' || !Scheduled
  // the schedules keep their space's own; the filter is Now's
  const inSp = now || isEverything(snap, ui.at) ? '' : ` in ${spaceLabel(snap, ui.at)}`
  return (
    <PaneFrame
      head={(sc) => (
        <Hd title={`Tasks${inSp}`} pad={ui.phone ? 12 : 4} scrolled={sc}>
          {now && <FilterButton />}
          {!ui.phone && <IB icon="x" label="Close" onClick={() => togglePane(null)} />}
        </Hd>
      )}
    >
      {Scheduled && (
        <div className="tabs" role="tablist">
          {(['Now', 'Scheduled'] as const).map((n) => (
            <button type="button" key={n} className="tab" role="tab" aria-selected={tab === n} aria-pressed={tab === n} onClick={() => setUI({ tab: n })}>{n}</button>
          ))}
        </div>
      )}
      {now && <Chips snap={snap} />}
      {now ? <Now snap={snap} place={ui.at} /> : <Scheduled place={ui.at} />}
    </PaneFrame>
  )
}

function TasksButton() {
  const snap = useSnap()
  const on = useUI((u) => u.pane === 'tasks')
  const at = useUI((u) => u.at)
  const tf = useUI((u) => u.tf)
  return (
    <IB icon="tasks" label="Tasks" pressed={on} onClick={() => togglePane('tasks')}>
      {snap && <Cnt n={filterCount(snap, tf, at)} />}
    </IB>
  )
}

export default definePlugin({
  name: 'tasks',
  setup(reg) {
    reg.header.push({ order: 50, View: TasksButton })
    reg.bar.push({ order: 10, pane: 'tasks', label: 'Tasks', icon: 'tasks', count: (snap, place) => filterCount(snap, getState().ui.tf, place) })
    reg.panes.push({ id: 'tasks', View: TasksPane })
    reg.views.taskHead = TaskHead
    reg.views.taskTop = TaskTop
    reg.chatCards.push({ order: 20, cards: taskCards })
    reg.commands.push(...taskCommands())
  },
})

/* ---------- commands: the palette's rows and their shortcuts ---------- */

const ready = () => { const t = focusTask(); return t && tstate(t) === 'ready' && !t.accepting && t.status !== 'merging' ? t : undefined }
const shownRows = () => [...document.querySelectorAll<HTMLElement>('.col [data-task-row]')].map((r) => r.dataset.taskRow!)
/** J and K: the next or previous task of the Tasks pane's list, opened */
function step(by: 1 | -1) {
  const ids = shownRows()
  if (!ids.length) return
  const at = ids.indexOf(getState().ui.task ?? '')
  const id = ids[at < 0 ? (by > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, at + by))]
  const t = getState().snap?.tasks.find((x) => x.id === id)
  if (t) open(t)
  document.querySelector(`[data-task-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
}

/** G T opens Tasks (Linear's and GitHub's "go to"); J/K step through them (Gmail, Linear); E is Mark as done on the task
 *  in focus when it waits for you, as its card's button (Superhuman, Linear), H its Not now; C asks for a new task
 *  (Linear's create); F maximizes; Cmd+. stops its agent (the Mac's own cancel) */
function taskCommands(): Command[] {
  const open1 = () => !!focusTask()
  return [
    { id: 'tasks.open', title: 'Open Tasks', area: 'Go to', icon: 'tasks', keys: ['G T'], words: 'pane panel list show', run: () => setUI((ui) => (ui.pane === 'tasks' && !ui.task ? {} : { pane: 'tasks', task: null, art: null, artWide: false })) },
    { id: 'tasks.next', title: 'Next task', area: 'Tasks', icon: 'down', keys: ['J'], when: () => getState().ui.pane === 'tasks', run: () => step(1) },
    { id: 'tasks.prev', title: 'Previous task', area: 'Tasks', icon: 'up', keys: ['K'], when: () => getState().ui.pane === 'tasks', run: () => step(-1) },
    { id: 'tasks.new', title: 'New task', area: 'Tasks', icon: 'plus', keys: ['C'], words: 'create add make', when: () => !!getState().snap?.places.length, run: () => {
      const { snap, ui } = getState()
      const chat = snap?.places.find((p) => p.id === ui.at)?.chat
      if (ui.max) setUI({ max: null })
      // a task is made by asking the space's Assistant: the box starts the ask
      requestAnimationFrame(() => focusBox(chat, 'New task: '))
    } },
    { id: 'tasks.done', title: 'Mark as done and merge', area: 'Tasks', icon: 'check', keys: ['E'], words: 'accept merge approve finish', when: () => !!ready(), run: () => {
      const t = ready()
      if (t) void tryAct({ type: 'accept', task: t.id }, undefined, onBranch(t) ? 'Merging…' : 'Marking as done…')
    } },
    { id: 'tasks.later', title: 'Not now', area: 'Tasks', icon: 'clock', keys: ['H'], words: 'later skip review', when: () => !!ready() && !later.has(ready()!.id), run: () => {
      const t = ready()
      if (!t) return
      later.add(t.id)
      notice('Not now: it stays under Needs you')
    } },
    { id: 'tasks.stop', title: 'Stop the agent', area: 'Tasks', icon: 'stop', keys: ['Mod+.'], words: 'stop pause cancel interrupt', when: () => { const c = focusChat(); const { snap } = getState(); const t = focusTask(); return !!c && !!snap && (t ? tstate(t) === 'working' : !!snap.places.find((p) => p.id === getState().ui.at)) }, run: () => {
      const c = focusChat()
      if (c) void tryAct({ type: 'stop', chat: c }, undefined, 'Stopping…')
    } },
    { id: 'tasks.max', title: 'Maximize the task', area: 'Tasks', icon: 'expand', keys: ['F'], words: 'minimize full focus expand shrink', when: () => !getState().ui.phone && (open1() || !!getState().ui.max), run: () => {
      const { ui } = getState()
      if (ui.max && (!ui.task || ui.pane !== 'tasks')) return minimize()
      const t = focusTask()
      if (t) ui.max === t.id ? minimize() : maximize(t.id)
    } },
    { id: 'tasks.rename', title: 'Rename the task', area: 'Tasks', icon: 'pen', words: 'name title', when: open1, run: () => {
      const t = focusTask()
      if (t) renameDialog(t.name, (name) => tryAct({ type: 'task-rename', chat: taskChat(t), name }))
    } },
  ]
}

export { notice }
