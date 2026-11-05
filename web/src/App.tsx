import { attentionCounts } from './attention.ts'
import { StatusBar } from './status.tsx'
// The layout: places | coordinator chat | tasks or artifacts on a desktop (sidebars resize, places hides), and an open
// task's side panel after them (focus hides places and the chat, for the task); chat | tasks or artifacts with places in a drawer on a tablet; one column with a
// Chat | Tasks | Artifacts switch on a phone, where a task's panel items open as sheets. Every part inside comes from a
// plugin.
import clsx from 'clsx'
import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import {
  agentChat,
  closePane,
  focusPane,
  onlyPane,
  openArtifact,
  openSplit,
  panesHere,
  placesDocked,
  sizePanes,
  focusHere,
  getState,
  useStore,
  placeKind,
  chipName,
  listsPinned,
  listView,
  panelHere,
  placeOf,
  registry,
  setUI,
  taskInMiddle,
  taskOf,
  togglePin,
  pinTask,
  useSnap,
  useUI,
  type Pane,
} from './kernel.ts'
import { PANE_MIN } from './panes.ts'
import { ChatColumn, Frame, PanelColumn, PlacesColumn, PlacesToggle } from './Frame.tsx'
import { PanelSheet, TabBody, TaskPanel, TaskTabs } from './Panel.tsx'
import { openAccept, useAccepting } from './screens/Accept.tsx'
import * as TK from '@core/tasks.js'

/** a line's first letter a capital, as the window writes every reason (core/tasks.js) */
const capital = TK.capital as (s: string) => string
import { Drawer as SlideDrawer, Stack } from './Stack.tsx'
import { machineName, type Place, type Snapshot, type Task } from '@shared/types.ts'
import {
  BackIcon,
  BellIcon,
  ChatIcon,
  CrookIcon,
  CogIcon,
  OpenIcon,
  AttentionBadge,
  Dot,
  Empty,
  FitIcon,
  FootButton,
  Head,
  IconButton,
  Menu,
  MenuIcon,
  MenuSeparator,
  MoreIcon,
  PageIcon,
  PhoneTop,
  PinTaskIcon,
  UnpinIcon,
  Primary,
  KeepFiltersIcon,
  PlaceIcon,
  RoundButton,
  HeadButton,
  SearchIcon,
  Tab,
  Tabs,
  TasksIcon,
  ReportLine,
  Who,
  XIcon,
  ic,
} from './ui.tsx'

export default function App() {
  const snap = useSnap()
  const device = useUI((u) => u.device)
  const search = useUI((u) => u.search)
  const keyboard = useUI((u) => u.keyboard)
  useKeyboard()
  if (!snap) return <Loading />
  return (
    // sideways swipes go to the app (the drawer, going back); up and down scroll as the browser does. Wider than a phone, the app
    // keeps clear of the notch, the rounded corners and the home bar
    <div
      data-device={device}
      className={clsx(
        'isolate flex h-full touch-pan-y touch-pinch-zoom flex-col overflow-hidden bg-bg font-sans text-sm/5 antialiased phone:text-base/6',
        device !== 'phone' && 'pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]',
        device !== 'phone' && !keyboard && 'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {registry.topBars.map((Bar, i) => (
        <Bar key={i} />
      ))}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {device === 'phone' ? <PhoneLayout snap={snap} /> : <WideLayout snap={snap} />}
        <PanelSheet />
        {registry.overlays.map((O, i) => (
          <O key={i} />
        ))}
        {search && registry.views.search ? <registry.views.search onClose={() => setUI({ search: false })} /> : null}
      </div>
      {/* the window's status bar: machine, branch, Needs you (status.tsx) */}
      {device !== 'phone' ? <StatusBar /> : null}
    </div>
  )
}

/** before the first snapshot: the mark and a quiet word, in the app's own type; one that can't reach Shepherdr says so
 *  and keeps trying */
function Loading() {
  const device = useUI((u) => u.device)
  const lost = useUI((u) => !!u.offline)
  // a link that neither opens nor fails says so too, after a while
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000)
    return () => clearTimeout(t)
  }, [])
  const offline = lost || slow
  return (
    <div data-device={device} className="grid h-full place-items-center bg-bg px-6 font-sans text-sm/5 text-fg3 antialiased phone:text-base/6">
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-10 place-items-center overflow-hidden rounded-[11px] bg-fg pt-1 text-bg">
          <CrookIcon className="size-8 overflow-visible" />
        </span>
        {offline ? "Can't reach Shepherdr. Trying again…" : 'Loading…'}
      </div>
    </div>
  )
}

function useKeyboard() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const s = getState()
      if (!s.snap) return
      for (const k of registry.keys) if (k.handle({ e, ui: s.ui, snap: s.snap })) return
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])
}

/* ---------- pieces of the frame ---------- */

/** the sidebar's top row, as the window's (workspace-chrome-shepherdr): the mark and name, a search button (Jump,
 *  Ctrl+K) and the sidebar toggle */
export function Brand() {
  const snap = useSnap()!
  return (
    <div className="flex items-center gap-1 px-3.5 pt-3 pb-0.5 text-[0.9375rem] font-semibold desktop:pr-2.5 phone:px-5 phone:pt-3 phone:pb-1 phone:text-[1.125rem]">
      <CrookIcon className="mr-1 size-6" />
      <span className="min-w-0 flex-1 truncate">{snap.name}</span>
      <SearchButton />
      <PlacesToggle when="open" />
    </div>
  )
}

/** the brand row's search: Jump (core keys' Ctrl+K), as the window's magnifier */
function SearchButton() {
  return (
    <IconButton label="Search" onClick={() => setUI({ search: true, searchScope: undefined, drawer: false })}>
      <SearchIcon className={ic} />
    </IconButton>
  )
}

function SideFoot({ drawer }: { drawer?: boolean }) {
  // a phone opens its list of sections; a wider screen the first, beside that list
  const phone = useUI((u) => u.device === 'phone')
  const settings = () => setUI({ settings: { section: phone ? null : 0 }, drawer: false })
  // pinned to the bottom under a thin line, over the rows scrolling behind it, and lifted clear of the phone's home bar
  // (wider, the frame keeps clear of it already)
  return (
    <div
      className={clsx(
        'sticky bottom-0 z-2 mt-auto flex border-t border-line bg-well px-1.5 pt-1.5 phone:px-2 phone:pt-2',
        drawer ? 'pb-2 phone:pb-[max(env(safe-area-inset-bottom),--spacing(2))]' : 'pb-1.5',
      )}
    >
      {/* the foot: Settings (this device's look is a page in them) and Add machine; the window's first says Shepherdr
          with the crook, but here it only opens settings */}
      <FootButton onClick={settings} className="flex-1">
        <CogIcon className="size-4 shrink-0 text-fg3 coarse:text-fg2 phone:size-5 phone:text-fg2" />
        Settings
      </FootButton>
      {registry.sideFoot.map(({ View }, i) => (
        <View key={i} />
      ))}
    </div>
  )
}

function Sidebar() {
  const P = registry.views.places
  return (
    <PlacesColumn>
      <Brand />
      {P ? <P /> : null}
      <SideFoot />
    </PlacesColumn>
  )
}

/** The places drawer (phone and tablet): out from the left edge or across the place's chat, back with a swipe left */
function Drawer() {
  const open = useUI((u) => u.drawer)
  const phone = useUI((u) => u.device === 'phone')
  // a swipe opens it only while nothing is over the place (a menu, a sheet, settings; a task, on a phone)
  const can = useUI((u) => !u.settings && !u.menu && !u.taskMenu && !u.plus && !u.pick && !u.search && !u.viewer && !u.photo && !u.adding && !(phone && (u.task || u.sheet)))
  const P = registry.views.places
  return (
    <SlideDrawer
      open={open}
      onOpen={(drawer) => setUI({ drawer })}
      can={can}
      label="Spaces"
      panel={phone ? 'w-[84%] pt-[env(safe-area-inset-top)]' : 'w-[320px]'}
    >
      <Brand />
      {P ? <P /> : null}
      <SideFoot drawer />
    </SlideDrawer>
  )
}

function MenuButton() {
  const device = useUI((u) => u.device)
  const docked = useStore((s) => placesDocked(s.ui, s.snap))
  if (docked) return null
  return device === 'phone' ? (
    <RoundButton label="Spaces" onClick={() => setUI({ drawer: true })}>
      <MenuIcon className={ic} />
    </RoundButton>
  ) : (
    <IconButton label="Spaces" onClick={() => setUI({ drawer: true })}>
      <MenuIcon className={ic} />
    </IconButton>
  )
}

/** The coordinator chat's top-right menu: plugins fill its sections (mode, search, terminal), a thin line between them */
function PlaceMenu({ place, pane }: { place: Place; pane?: number }) {
  const phone = useUI((u) => u.device === 'phone')
  const term = useUI((u) => u.term === place.chat)
  const arts = useUI((u) => u.arts === place.chat)
  // split, it opens in the focused pane: a click in a pane focuses it first
  const menu = useUI((u) => u.menu && (pane === undefined || u.split.pane === pane))
  if (!registry.placeMenu.length) return null
  const B = phone ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label={term ? 'Menu, terminal open' : arts ? 'Menu, artifacts open' : 'Menu'}
        aria-haspopup="menu"
        aria-expanded={menu}
        className={clsx('rounded-full!', phone ? 'aria-expanded:bg-line2' : 'aria-expanded:bg-hover', (term || arts) && (phone ? 'bg-fg! text-bg!' : 'bg-sel text-fg'))}
        onClick={() => setUI({ menu: !menu, plus: null, pick: null })}
      >
        <MoreIcon className={ic} />
      </B>
      {menu ? (
        <Menu label="Menu" tabs onClose={() => setUI({ menu: false })} className="absolute top-full right-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-right">
          {registry.placeMenu.map(({ View, joined }, i) => (
            <Fragment key={i}>
              {i && !joined ? <MenuSeparator /> : null}
              <View place={place} />
            </Fragment>
          ))}
        </Menu>
      ) : null}
    </div>
  )
}

/** What plugins put beside a coordinator's menu, or on a phone after its subtitle (its mode) */
function PlaceMarks({ place }: { place: Place }) {
  return registry.placeMark.length ? (
    <>
      {registry.placeMark.map(({ View }, i) => (
        <View key={i} place={place} />
      ))}
    </>
  ) : null
}

/** The coordinator chat in the middle; a container (named place) so its header can fit what it shows to its width */
function PlaceColumn({ place, pane }: { place: Place; pane?: number }) {
  const snap = useSnap()!
  const Chat = registry.views.chat
  const term = useUI((u) => u.term)
  // the pane header: the space's name, its folder (and machine) quieter under it; another tab shown names its program
  // ("Shell", "Codex") and folder. Then plugins' marks (placeHeader order ≤ 10); past the gap, right-aligned, its
  // status in words, the Autopilot pill and Chat | Terminal (placeHeader, by order). Never the Assistant's role or
  // agent (SHEP-36): the composer's model menu says which agent.
  const tab = term?.startsWith('t:') ? place.tabs?.find((t) => t.term === term) : undefined
  const name = tab ? (tab.prog ?? 'Shell') : place.name
  const where = tab ? tab.where : placeKind(snap, place)
  // another agent tab switched to Chat shows its own chat (its terminal otherwise: the terminal plugin's chatBody)
  const tabChat = useUI((u) => (tab && u.tabView?.[tab.term] === 'chat' ? tab.term : null))
  return (
    <section data-drawer-from className="@container/place flex min-h-0 min-w-0 flex-1 flex-col">
      <Head conversation className="group/head">
        <MenuButton />
        {pane ? null : <PlacesToggle when="closed" />}
        <div className="flex min-w-24 shrink-[100] items-center">
          <Who name={name} kind={where ? <PaneWhere where={where} /> : undefined} />
        </div>
        {registry.placeHeader.filter((h) => h.order <= 10).map(({ View }, i) => (
          <View key={i} place={place} />
        ))}
        <div className="flex-1" />
        {registry.placeHeader.filter((h) => h.order > 10).map(({ View }, i) => (
          <View key={i} place={place} />
        ))}
        <PlaceMarks place={place} />
        {pane === undefined ? null : <PaneButtons i={pane} />}
      </Head>
      {Chat ? (
        tabChat ? <Chat key={tabChat} chatKey={tabChat} placeholder={`Message ${tab?.prog ?? 'the agent'}`} /> : <Chat chatKey={place.chat} placeholder="Message the Assistant" unreachable={unreachable(place, snap)} />
      ) : null}
    </section>
  )
}

/** a pane header's quiet line: the folder, which gives way from its start so its own name stays ("…/dev/shepherdr") */
function PaneWhere({ where }: { where: string }) {
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate text-fg3 [direction:rtl]">
        <bdi>{where}</bdi>
      </span>
    </span>
  )
}

function unreachable(p: Place, snap: Snapshot) {
  const m = machineName(snap.machines, p.machine)
  // just after Shepherdr started (an update): what it showed last, calmly
  if (p.connecting) return `Connecting to ${m}… Showing what it said last; messages wait until it is back.`
  if (p.herdrDown) return `herdr isn't answering on ${m} since ${p.herdrDown}, so its agents can't hear anything. Messages wait until it is back.`
  return p.status === 'off' && p.unreachableSince ? `Can't reach ${m} since ${p.unreachableSince}. Showing what it said last; messages wait until it is back.` : undefined
}

// as 3.0's message box: "Message SHEP-7" (an ended agent's box says so itself)
function agentPlaceholder(t: Task, _finished: boolean | undefined) {
  return `Message ${t.id}`
}

/** The right-hand column: a place's tasks or its artifacts, and the open task's agent chat pushed over them (pinned,
 *  the task opens in the middle instead and the list stays) */
function TaskColumn({ snap }: { snap: Snapshot }) {
  const open = taskOf(snap, useUI((u) => u.task))
  const middle = useStore((s) => taskInMiddle(s.ui, s.snap))
  const task = middle ? null : open
  return (
    <Stack base={<SideList snap={snap} />} top={task ? <TaskPage task={task} /> : null} topKey={task?.id ?? null} onBack={() => setUI({ task: null })} />
  )
}


/** Ready tasks in the panel’s scope. What needs you is counted once, on Needs you, so no two red numbers can differ. */
function TaskAttention() {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const ids = snap.places.filter((p) => !view.chips.length || view.chips.includes(p.id) || view.chips.includes(`m:${p.machine}`)).map((p) => p.id)
  const c = attentionCounts(snap, ids)
  return <AttentionBadge need={registry.views.needs ? 0 : c.need} ready={c.ready} scope="panel scope" />
}

/** Everything that needs you, every space and machine: the sidebar's counts added up. */
function NeedsAttention() {
  const snap = useSnap()!
  return <AttentionBadge need={snap.needs.length} ready={0} scope="everywhere" />
}

/** The lists' tasks, or their artifacts: what their chips hold */
function SideList({ snap }: { snap: Snapshot }) {
  const place = placeOf(snap, useUI((u) => u.place))
  const view = useStore((s) => listView(s.ui, snap))
  const shown = useUI((u) => u.side)
  const Tasks = registry.views.tasks
  const TasksMenu = registry.views.tasksMenu
  const Artifacts = registry.views.artifacts
  const Needs = registry.views.needs
  // Herdr's own Files and Changes, the space's folder (the tab bar's buttons, as shared "workspace.panels" has them)
  const Space = registry.views.spacePanel
  const herdr = (shown === 'files' || shown === 'changes') && Space && (snap.panels ?? ['files', 'changes']).includes(shown) ? shown : null
  const side = herdr ?? ((shown === 'artifacts' && Artifacts) || (shown === 'needs' && Needs) ? shown : 'tasks')
  const title = { tasks: 'Tasks', needs: 'Needs you', artifacts: 'Artifacts', files: 'Files', changes: 'Changes' }[side]
  return (
    <section className="@container/side flex min-h-0 min-w-0 flex-1 flex-col border-l border-line" aria-label={title}>
      <Head>
        {/* 3.0's side panel: its name over it; which one shows (and what needs you, counted) is the tab bar's buttons */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h2 className="min-w-0 truncate font-semibold">{title}</h2>
        </div>
        {side === 'tasks' && TasksMenu ? <TasksMenu key={view.key} place={place} /> : null}
      </Head>
      {herdr && Space ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Space place={place} what={herdr} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">{side === 'needs' && Needs ? <Needs /> : side === 'artifacts' && Artifacts ? <Artifacts placeId={place.id} /> : Tasks ? <Tasks placeId={place.id} /> : null}</div>
      )}
    </section>
  )
}

/** A task that ran but whose chat is no longer kept (its agent's log is gone): what it said when it was ready, its
 *  details as their lines, and a quiet line saying why there's no chat (SHEP-26) */
function ChatGone({ task }: { task: Task }) {
  return (
    <div data-chat-gone className="flex flex-col gap-2 px-4 py-3 text-[0.8125rem] text-pretty phone:px-5 phone:text-[0.9375rem]">
      {task.summary ? <p className="text-fg">{task.summary}</p> : null}
      {task.details ? (
        <ul className="flex flex-col gap-1 text-fg2">
          {task.details.split('\n').map((l) => l.trim().replace(/^[-*•]\s*/, '')).filter(Boolean).map((l, i) => <li key={i} className="flex gap-1.5"><span aria-hidden className="text-fg3">·</span><span className="min-w-0">{l}</span></li>)}
        </ul>
      ) : null}
      <p className="text-fg3">Its chat is no longer kept.</p>
    </div>
  )
}

/** An open task is its one agent's chat; until its agent starts there is no chat yet. In the middle (the lists pinned),
 *  it has what the place's chat there has to bring places back. */
function TaskPage({ task, middle, pane }: { task: Task; middle?: boolean; pane?: number }) {
  const snap = useSnap()!
  const g = task.agent ?? null
  const Chat = registry.views.chat
  const finished = useStore((s) => s.chats[g?.chat ?? '']?.finished)
  // its agent's saved log is gone (deleted since): what it said when it was ready instead
  const gone = useStore((s) => s.chats[g?.chat ?? '']?.notice === 'gone')
  const back = () => setUI({ task: null })
  const phone = useUI((u) => u.device === 'phone')
  const desktop = useUI((u) => u.device === 'desktop')
  const keyboard = useUI((u) => u.keyboard)
  const coordinator = placeOf(snap, task.place).name
  const accepting = useAccepting(task.id) || !!task.accepting
  // as 3.0's task header (mods/chat/panel.js barRow): Pin / Unpin (not an archived task's), and Review (opens the Accept
  // card) once it is Ready ("Accepting…" while its accept runs), sized as the header's other buttons; then its tabs (TaskTabs)
  const tools = (
    <>
      {task.archived && task.status === 'done' ? null : (
        <IconButton label={task.pinned ? 'Unpin' : 'Pin'} pressed={!!task.pinned} onClick={() => void pinTask(task, !task.pinned).catch(() => undefined)}>
          {task.pinned ? <UnpinIcon className={ic} /> : <PinTaskIcon className={ic} />}
        </IconButton>
      )}
      {task.status === 'ready' && !task.archived ? <HeadButton disabled={accepting} onClick={() => openAccept(task.id)}>{accepting ? 'Accepting…' : 'Review'}</HeadButton> : null}
    </>
  )
  // its title alone on the first line, so it keeps the room; under it, quieter, its id in the list's monospace, then what
  // its agent is doing (working with no % yet, or a provider retry's line: its row's words, as the window's header says
  // them), else where it merges
  const ref = task.id.slice(task.id.lastIndexOf(':') + 1)
  const doing = task.report ? <ReportLine w={task.report} head /> : task.status === 'work' && task.sub ? <span className="truncate">{task.sub}</span> : null
  const sub = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 font-mono text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{ref}</span>
      {doing ? <span className="flex min-w-0 items-center gap-1.5"><span aria-hidden className="text-fg3">·</span>{doing}</span> : task.base ? <span className="min-w-0 truncate"><span aria-hidden className="text-fg3">· </span>→ {task.base}</span> : null}
    </span>
  )
  // in focus it sits at the window's edge: no line there
  const focus = useStore((s) => focusHere(s.ui, s.snap))
  // split, a click on the open task on the right gives it the focus (the keys work on its chat)
  const split = useUI((u) => panesHere(u).length > 0)
  const body = g && !gone ? (
    Chat ? <Chat chatKey={g.chat} placeholder={agentPlaceholder(task, g.status === 'done' || finished)} /> : null
  ) : g || task.started || task.summary ? (
    // it ran, but no log of its chat is left (its terminal and log are gone): its summary, and why there's no chat
    <ChatGone task={task} />
  ) : (
    // never started: why it waits, as the window's (a queued one's reason, else that it hasn't started)
    <Empty>{(task.status === 'queued' || task.status === 'scheduled') && task.sub ? capital(task.sub) : "This task hasn't started."}</Empty>
  )
  if (phone)
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <TaskTop back={back} task={task} sub={sub} tools={tools} />
        <TaskTabs task={task} />
        {/* no bar under a task's chat: the message box keeps clear of the home indicator itself */}
        <div className={clsx('flex min-h-0 flex-1 flex-col', !keyboard && 'pb-[env(safe-area-inset-bottom)]')}>
          <Scroll chat><TabBody task={task} chatKey={g?.chat ?? ''}>{body}</TabBody></Scroll>
        </div>
      </section>
    )
  if (pane !== undefined)
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Head conversation>
          {pane ? null : <><MenuButton /><PlacesToggle when="closed" /></>}
          <Dot s={task.status} p={task.report?.progress} halo />
          <Who name={task.name} kind={task.report ? <span className="flex min-w-0 gap-1">{task.id} ·<ReportLine w={task.report} head /></span> : `${task.id} · ${coordinator}`} />
          <div className="flex shrink-0 items-center gap-1">
            {tools}
            <PaneButtons i={pane} />
          </div>
        </Head>
        <Scroll chat={!!g && !gone}>{body}</Scroll>
      </section>
    )
  return (
    <section
      data-drawer-from={middle || undefined}
      onPointerDownCapture={split && !middle ? () => focusPane(-1) : undefined}
      onFocusCapture={split && !middle ? () => focusPane(-1) : undefined}
      className={clsx('@container/task flex min-h-0 min-w-0 flex-1 flex-col border-line', !focus && !middle && 'border-l')}
    >
      <Head conversation>
        {middle ? (
          <>
            <MenuButton />
            <PlacesToggle when="closed" />
          </>
        ) : null}
        {/* in a narrow column (the side's) Back is its arrow alone, so the title keeps the room */}
        <button type="button" onClick={back} aria-label="Tasks" className="press-dim relative inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[0.8125rem] text-fg2 after:absolute after:-inset-y-2 after:inset-x-0 hover:bg-hover hover:text-fg @lg/task:pr-2.5">
          <BackIcon className={ic} />
          <span aria-hidden className="hidden @lg/task:inline">Tasks</span>
        </button>
        <Dot s={task.status} p={task.report?.progress} halo />
        <Who name={task.name} kind={sub} />
        {/* its buttons close together, as a toolbar's, so the name keeps the room */}
        <div className="flex shrink-0 items-center gap-1">
          {tools}
        </div>
      </Head>
      <TaskTabs task={task} />
      <Scroll chat><TabBody task={task} chatKey={g?.chat ?? ''}>{body}</TabBody></Scroll>
    </section>
  )
}

/** A task's top on a phone, as the desktop's header: Back, its status, its title on one line (a tap shows it whole) over
 *  its id and what it is doing, then its buttons, each as tall as Back */
function TaskTop({ back, task, sub, tools }: { back: () => void; task: Task; sub: ReactNode; tools: ReactNode }) {
  const [whole, setWhole] = useState(false)
  return (
    // under a bar at the top (offline, a call) the notch is already kept clear
    <div data-kb data-chrome className="relative flex shrink-0 items-center gap-2 border-b border-line px-3 pt-[calc(env(safe-area-inset-top)+6px)] pb-1.5 [[data-topbar]~*_&]:pt-1.5">
      <RoundButton label="Tasks" onClick={back}>
        <BackIcon className={ic} />
      </RoundButton>
      <Dot s={task.status} p={task.report?.progress} halo />
      <button type="button" aria-expanded={whole} onClick={() => setWhole(!whole)} className="min-w-0 flex-1 py-0.5 text-left">
        <span className={clsx('block text-base/5 font-semibold', whole ? 'break-words' : 'truncate')}>{task.name}</span>
        <span className="mt-0.5 block text-[0.8125rem]/[18px] text-fg2">{sub}</span>
      </button>
      <div className="flex shrink-0 items-center gap-1">{tools}</div>
    </div>
  )
}

/** chats manage their own scrolling (messages scroll, composer stays); other bodies scroll as a whole */
function Scroll({ chat, children }: { chat: boolean; children: ReactNode }) {
  return chat ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">{children}</div>
}

/** The middle: the place's chat, or with the lists pinned the open task's */
function Middle({ snap }: { snap: Snapshot }) {
  const place = placeOf(snap, useUI((u) => u.place))
  const task = useStore((s) => (taskInMiddle(s.ui, s.snap) ? taskOf(snap, s.ui.task) : null))
  const panes = useUI(panesHere)
  const TabBar = registry.views.tabBar
  return (
    <ChatColumn>
      {/* 3.0's tab bar over it: the shown space's tabs, its + and the side panels' buttons */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {TabBar ? <TabBar place={place} /> : null}
        {panes.length ? <Split snap={snap} panes={panes} /> : task ? <TaskPage key={task.id} task={task} middle /> : <PlaceColumn place={place} />}
      </div>
    </ChatColumn>
  )
}

/* ---------- split view (panes.ts) ---------- */

/** The panes side by side, a divider between each two; the focused one marked while there are more */
function Split({ snap, panes }: { snap: Snapshot; panes: Pane[] }) {
  const sizes = useUI((u) => u.split.sizes)
  const focused = useUI((u) => u.split.pane)
  const box = useRef<HTMLDivElement>(null)
  return (
    // a window narrowed after they opened: each keeps a readable width, and they scroll sideways
    <div ref={box} className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
      {panes.map((p, i) => (
        <Fragment key={`${p.kind}:${p.id}`}>
          {i ? <Divider at={i} box={box} /> : null}
          <div
            data-pane={i}
            data-focused={panes.length > 1 && focused === i ? '' : undefined}
            style={{ flexGrow: sizes[i] ?? 1 }}
            // a click or the focus going in gives it the focus: the sidebar, the lists and the keys follow it
            onPointerDownCapture={() => focusPane(i)}
            onFocusCapture={() => focusPane(i)}
            className={clsx(
              'relative flex min-w-[280px] basis-0 flex-col',
              i && 'border-l border-line',
              // the focused one: a thin line along its top, as a focused editor's tab has
              'after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:z-3 after:h-0.5 after:bg-accent not-data-focused:after:hidden',
            )}
          >
            <PaneView snap={snap} p={p} i={i} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function PaneView({ snap, p, i }: { snap: Snapshot; p: Pane; i: number }) {
  if (p.kind === 'place') return <PlaceColumn place={placeOf(snap, p.id)} pane={i} />
  if (p.kind === 'tasks') return <TasksPane place={placeOf(snap, p.id)} i={i} />
  if (p.kind === 'artifact') return <ArtifactPane id={p.id} i={i} />
  const task = taskOf(snap, p.id)
  return task ? <TaskPage key={task.id} task={task} pane={i} /> : <GonePane i={i} what={`${p.id} is gone.`} />
}

/** A pane's own buttons, at the end of its header: the only one, and close */
function PaneButtons({ i }: { i: number }) {
  const many = useUI((u) => u.split.panes.length > 1)
  return (
    <div className="flex shrink-0 items-center gap-1">
      {many ? (
        <IconButton label="Make it the only one" onClick={() => onlyPane(i)}>
          <FitIcon className={ic} />
        </IconButton>
      ) : null}
      <IconButton label="Close pane" onClick={() => closePane(i)}>
        <XIcon className={ic} />
      </IconButton>
    </div>
  )
}

/** a space's tasks in a pane */
function TasksPane({ place, i }: { place: Place; i: number }) {
  const snap = useSnap()!
  const Tasks = registry.views.tasks
  const TasksMenu = registry.views.tasksMenu
  return (
    <section aria-label={`Tasks of ${place.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Head>
        {i ? null : <PlacesToggle when="closed" />}
        <TasksIcon className={clsx(ic, 'text-fg2')} />
        <Who name={<span className="flex items-center gap-1.5">Tasks<TaskAttention /></span>} kind={placeKind(snap, place) ? `${place.name} · ${placeKind(snap, place)}` : place.name} />
        {TasksMenu ? <TasksMenu key={place.id} place={place} /> : null}
        <PaneButtons i={i} />
      </Head>
      <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">{Tasks ? <Tasks placeId={place.id} /> : null}</div>
    </section>
  )
}

/** an artifact in a pane, at its latest */
function ArtifactPane({ id, i }: { id: string; i: number }) {
  const snap = useSnap()!
  const art = snap.artifacts?.find((a) => a.id === id)
  const View = registry.views.artifact
  if (!art) return <GonePane i={i} what="This artifact is gone." />
  return (
    <section aria-label={art.title} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Head>
        {i ? null : <PlacesToggle when="closed" />}
        <PageIcon className={clsx(ic, 'text-fg2')} />
        <Who name={art.title} kind={`${placeOf(snap, art.place).name} · v${art.v} · ${art.when}`} />
        <IconButton label="Open full screen" onClick={() => openArtifact(art.id)}>
          <OpenIcon className={ic} />
        </IconButton>
        <PaneButtons i={i} />
      </Head>
      <div className="relative min-h-0 flex-1">{View ? <View artifactId={art.id} /> : null}</div>
    </section>
  )
}

function GonePane({ i, what }: { i: number; what: string }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Head>
        <div className="flex-1" />
        <PaneButtons i={i} />
      </Head>
      <Empty>{what}</Empty>
    </section>
  )
}

/**
 * Between two panes: invisible until the pointer finds it, then a thin line, as the sidebars' edges are. Drag it to
 * share their width out again (each keeps PANE_MIN), double-click to share it evenly, or focus it and use the arrow
 * keys. While dragging, the shares go straight onto the panes and reach the store once, on letting go.
 */
function Divider({ at, box }: { at: number; box: RefObject<HTMLDivElement | null> }) {
  const drag = useRef<{ x: number; sizes: number[]; next: number[]; px: number } | null>(null)
  const sizes = () => getState().ui.split.sizes
  const els = () => [...(box.current?.querySelectorAll<HTMLElement>(':scope > [data-pane]') ?? [])]
  /** the two panes beside it shared out again, `dx` pixels moved */
  const moved = (from: number[], dx: number, px: number) => {
    const total = from.reduce((a, b) => a + b, 0)
    const pair = from[at - 1] + from[at]
    const unit = total / px
    const min = Math.min(PANE_MIN * unit, pair / 2)
    const left = Math.max(min, Math.min(pair - min, from[at - 1] + dx * unit))
    return from.map((s, j) => (j === at - 1 ? left : j === at ? pair - left : s))
  }
  const draw = (next: number[]) => els().forEach((el, j) => (el.style.flexGrow = String(next[j])))
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const px = els().reduce((a, el) => a + el.getBoundingClientRect().width, 0)
    drag.current = { x: e.clientX, sizes: sizes(), next: sizes(), px }
    e.currentTarget.dataset.dragging = ''
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.next = moved(d.sizes, e.clientX - d.x, d.px)
    draw(d.next)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    delete e.currentTarget.dataset.dragging
    sizePanes(d.next)
  }
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    const px = els().reduce((a, el) => a + el.getBoundingClientRect().width, 0)
    sizePanes(moved(sizes(), step, px))
  }
  return (
    <div className="relative z-4 w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => sizePanes(sizes().map(() => 1))}
        onKeyDown={key}
        className="group absolute inset-y-0 -left-1 flex w-2 cursor-col-resize touch-none justify-center focus-visible:outline-none"
      >
        <span className="w-0.5 bg-fg3 not-group-hover:not-group-focus-visible:not-group-data-dragging:opacity-0" />
      </div>
    </div>
  )
}

function WideLayout({ snap }: { snap: Snapshot }) {
  const settings = useUI((u) => !!u.settings)
  const desktop = useUI((u) => u.device === 'desktop')
  const docked = useStore((s) => placesDocked(s.ui, s.snap))
  // the open task whose side panel has a column here
  const panel = useUI((u) => (panelHere(u, snap) ? u.task : null))
  const shut = useUI((u) => !!u.sideShut)
  // a task opened (a toast, Jump, a card) shows the panel it opens in again, as the window's
  const opened = useUI((u) => u.task)
  useEffect(() => {
    if (opened && getState().ui.sideShut) setUI({ sideShut: false, side: 'tasks' })
  }, [opened])
  const Settings = registry.views.settings
  if (settings && Settings && desktop)
    return (
      <Frame places>
        <Sidebar />
        <Settings />
        {!docked ? <Drawer /> : null}
      </Frame>
    )
  if (desktop) {
    // the tab bar's open panel button pressed again hides the right-hand column (and an open task's panel with it)
    const task = panel && !shut ? taskOf(snap, panel) : null
    return (
      <Frame places tasks={!shut} panel={!!task}>
        <Sidebar />
        <Middle snap={snap} />
        {shut ? null : <TaskColumn snap={snap} />}
        {!docked ? <Drawer /> : null}
        {task ? (
          <PanelColumn>
            <TaskPanel task={task} />
          </PanelColumn>
        ) : null}
      </Frame>
    )
  }
  // a tablet: settings push over the chat and its tasks
  return (
    <Stack
      base={
        <Frame tasks={!shut}>
          <Middle snap={snap} />
          {shut ? null : <TaskColumn snap={snap} />}
          <Drawer />
        </Frame>
      }
      top={settings && Settings ? <Settings /> : null}
      topKey={settings ? 'settings' : null}
      onBack={() => setUI({ settings: null })}
    />
  )
}

/* ---------- phone: one column, Chat | Tasks ---------- */

function PhoneLayout({ snap }: { snap: Snapshot }) {
  const task = taskOf(snap, useUI((u) => u.task))
  const settings = useUI((u) => !!u.settings)
  const Settings = registry.views.settings
  // a task's chat, or settings, push over the place
  const top = settings && Settings ? <Settings /> : task ? <TaskPage task={task} /> : null
  return <Stack base={<PhoneHome snap={snap} />} top={top} topKey={settings ? 'settings' : (task?.id ?? null)} onBack={() => setUI(settings ? { settings: null } : { task: null })} />
}

/** The place: its chat, tasks or artifacts, the bar to switch them, and the drawer a swipe right opens */
function PhoneHome({ snap }: { snap: Snapshot }) {
  const place = placeOf(snap, useUI((u) => u.place))
  // Tasks and Artifacts show what their chips hold: pinned, the top bar says so and names them
  const view = useStore((s) => listView(s.ui, snap))
  const tab = useUI((u) => u.tab)
  const keyboard = useUI((u) => u.keyboard)
  // the space's other agent tab picked in ⋯ and shown as its chat
  const tabChat = useUI((u) => (u.term?.startsWith('t:') && u.tabView?.[u.term] === 'chat' ? u.term : null))
  const Chat = registry.views.chat
  const Tasks = registry.views.tasks
  const TasksMenu = registry.views.tasksMenu
  const Artifacts = registry.views.artifacts
  return (
    <div data-drawer-from className="relative flex min-h-0 flex-1 flex-col">
      <PhoneTop
        left={<MenuButton />}
        // as 3.0's panels: the chat names its space; Tasks and Artifacts are their panels, everything in them
        name={tab === 'tasks' ? 'Tasks' : tab === 'artifacts' ? 'Artifacts' : place.name}
        icon={tab === 'chat' ? <PlaceIcon level={2} className="text-fg2" /> : undefined}
        kind={tab === 'chat' ? placeKind(snap, place) : undefined}
        mark={tab === 'chat' ? <PlaceMarks place={place} /> : undefined}
        right={
          tab === 'chat' ? (
            <>
              {registry.placeHeader.map(({ View }, i) => (
                <View key={i} place={place} />
              ))}
              <PlaceMenu place={place} />
            </>
          ) : (
            tab === 'tasks' && TasksMenu ? <TasksMenu key={view.key} place={place} /> : null
          )
        }
      />
      {tab === 'chat' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {Chat ? (
            tabChat ? <Chat key={tabChat} chatKey={tabChat} placeholder={`Message ${place.tabs?.find((t) => t.term === tabChat)?.prog ?? 'the agent'}`} /> : <Chat chatKey={place.chat} placeholder="Message the Assistant" unreachable={unreachable(place, snap)} />
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">{tab === 'needs' && registry.views.needs ? <registry.views.needs /> : tab === 'artifacts' && Artifacts ? <Artifacts placeId={place.id} /> : Tasks ? <Tasks placeId={place.id} /> : null}</div>
      )}
      {/* the keyboard is up: the message box sits right on it, so more of the chat shows */}
      {keyboard ? null : <PhoneBar />}
      <Drawer />
    </div>
  )
}

/** Chat | Tasks | Artifacts and Search at the bottom of the phone (3.0 has no Needs you view: it is Tasks' first section) */
function PhoneBar() {
  const tab = useUI((u) => u.tab)
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 pt-1 pb-[max(env(safe-area-inset-bottom),--spacing(4))] max-[359px]:gap-1">
      {/* each tab as wide as its words and the rest shared out, so Tasks with its count gets the room it needs and the
          count never crowds the next tab */}
      <div role="group" aria-label="View" className="flex flex-1 rounded-full bg-bubble p-1">
        {(
          [
            ['chat', 'Chat', ChatIcon],
            ...(registry.views.needs ? [['needs', 'Needs you', BellIcon] as const] : []),
            ['tasks', 'Tasks', TasksIcon],
            ...(registry.views.artifacts ? [['artifacts', 'Artifacts', PageIcon] as const] : []),
          ] as const
        ).map(([k, l, Icon]) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setUI({ tab: k, pick: null, plus: null, menu: false })}
            className="relative flex h-12 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-full text-[0.875rem] whitespace-nowrap text-fg2 aria-pressed:bg-seg-on aria-pressed:text-fg aria-pressed:shadow-seg max-[359px]:gap-1"
          >
            {/* four tabs and Search: most phones have room for the words only, a phone in Display Zoom (320px) for fewer */}
            <Icon className={clsx(ic, 'max-[479px]:hidden')} />
            {k === 'needs' ? <>Needs<span className="max-[359px]:hidden"> you</span></> : l}
            {k === 'tasks' ? <TaskAttention /> : k === 'needs' ? <NeedsAttention /> : null}
          </button>
        ))}
      </div>
      <RoundButton label="Search" className="size-14 max-[359px]:size-12" onClick={() => setUI({ search: true, searchScope: undefined })}>
        <SearchIcon className={ic} />
      </RoundButton>
    </div>
  )
}

