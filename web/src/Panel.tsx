// An open task's views, as 3.0's task view: Chat, then its items (Terminal, Pull request, Artifacts, Browser;
// plugins add them) as tabs on its header's row (TaskTabs; a phone's under it). On a desktop an item shows in a column right of the chat, on
// a phone or tablet over it, full screen. A coordinator chat has none.
import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { agentChat, closeSheet, focusHere, openItem, openSplit, panesHere, paneToPanel, placeOf, registry, setUI, taskInMiddle, taskOf, toggleFocus, togglePanel, toggleWide, useSnap, useStore, useUI, type PanelItem } from './kernel.ts'
import type { Task } from '@shared/types.ts'
import { Pushed } from './Stack.tsx'
import { BackIcon, Head, ic, IconButton, Menu, MenuItem, MenuSeparator, MoreIcon, NarrowIcon, PanelIcon, PhoneTop, RoundButton, SidebarIcon, Small, SplitIcon, Who, WidenIcon, XIcon } from './ui.tsx'

/** the item to show: the one picked, else the first */
function itemOf(id: string | null): PanelItem | undefined {
  return registry.taskPanel.find((i) => i.id === id) ?? registry.taskPanel[0]
}

/** The task header's toggle for the side panel (desktop) */
export function PanelToggle() {
  const ui = useUI()
  if (!registry.taskPanel.length) return null
  const open = ui.sidebars.panelOpen
  const label = open ? 'Hide task panel' : 'Show task panel'
  return (
    <IconButton label={label} pressed={open} aria-expanded={open} aria-controls="task-panel" onClick={togglePanel}>
      <PanelIcon className={ic} />
    </IconButton>
  )
}

/** The task header's toggle for focus (desktop and tablet), beside the panel's: it hides the coordinator chat to the left
 *  (and places) and shows it again */
export function FocusToggle({ task }: { task: Task }) {
  const focus = useStore((s) => focusHere(s.ui, s.snap))
  // in the middle (the lists pinned) it hides places and the pinned list
  const middle = useStore((s) => taskInMiddle(s.ui, s.snap))
  const snap = useSnap()!
  const name = placeOf(snap, task.place).name
  return (
    <IconButton label={focus ? `Show ${name}` : middle ? `Focus on ${task.id}` : `Hide ${name}`} pressed={focus} aria-expanded={!focus} onClick={toggleFocus}>
      <SidebarIcon className={ic} />
    </IconButton>
  )
}

/** The side panel's column (desktop): the items as tabs, the picked one under them */
export function TaskPanel({ task }: { task: Task }) {
  const ui = useUI()
  const snap = useSnap()!
  const g = agentChat(ui, snap)
  const tabs = useRef<HTMLDivElement>(null)
  const item = itemOf(ui.sidebars.item)
  useLayoutEffect(() => {
    const el = tabs.current
    if (!el) return
    const ro = new ResizeObserver(() => edges(el))
    ro.observe(el)
    return () => ro.disconnect()
  }, [!!g])
  if (!g || !item) return null
  // the arrow keys move between the tabs, as in any tab list
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...tabs.current!.querySelectorAll<HTMLButtonElement>('[role=tab]')]
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null
    if (to === null || at < 0) return
    e.preventDefault()
    all[(to + all.length) % all.length].focus()
  }
  return (
    <>
      <Head className="gap-1! pr-2! pl-2!">
        {/* too narrow for every tab, the cut edge fades: they scroll */}
        <div
          ref={tabs}
          role="tablist"
          aria-label="Task panel"
          onKeyDown={key}
          onScroll={(e) => edges(e.currentTarget)}
          className="scroll-x flex min-w-0 flex-1 items-center gap-0.5 [--fade-l:0px] [--fade-r:0px] [mask-image:linear-gradient(to_right,transparent,#000_var(--fade-l),#000_calc(100%-var(--fade-r)),transparent)] data-more-l:[--fade-l:1.5rem] data-more-r:[--fade-r:1.5rem]"
        >
          {itemsFor(task).map((i) => (
            <PanelTab key={i.id} item={i} task={task} on={i.id === item.id} />
          ))}
        </div>
        <IconButton label={ui.sidebars.wide ? 'Narrow the task panel' : 'Widen the task panel'} pressed={ui.sidebars.wide} aria-controls="task-panel" onClick={toggleWide}>
          {ui.sidebars.wide ? <NarrowIcon className={ic} /> : <WidenIcon className={ic} />}
        </IconButton>
        <IconButton label="Hide task panel" onClick={togglePanel}>
          <XIcon className={ic} />
        </IconButton>
      </Head>
      <div role="tabpanel" id="task-panel-body" aria-label={item.label} className="flex min-h-0 flex-1 flex-col">
        <ItemBody key={item.id} item={item} task={task} chatKey={g.chat} />
      </div>
    </>
  )
}

/** mark which ends of the tab strip have tabs past them, for its fades */
function edges(el: HTMLElement) {
  el.toggleAttribute('data-more-l', el.scrollLeft > 1)
  el.toggleAttribute('data-more-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
}

function PanelTab({ item, task, on }: { item: PanelItem; task: Task; on: boolean }) {
  const off = item.useOff?.(task) ?? null
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      aria-controls="task-panel-body"
      tabIndex={on ? 0 : -1}
      data-off={off ? '' : undefined}
      onClick={() => openItem(item.id)}
      className={clsx(
        'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 after:absolute after:-inset-y-1.5 after:inset-x-0 hover:bg-hover aria-selected:bg-sel aria-selected:text-fg data-off:text-fg3 coarse:h-9',
      )}
    >
      <item.Icon className={ic} />
      {item.label}
      <Count n={item.count?.(task)} />
    </button>
  )
}

/** a tab's quiet count after its label (Artifacts 3), read with it ("Artifacts, 3"); nothing for none */
function Count({ n }: { n?: number }) {
  return n ? <span className="text-fg3 tabular-nums"><span className="sr-only">, </span>{n}</span> : null
}

/** An item's view, or why it has nothing to show (greyed out) */
function ItemBody({ item, task, chatKey }: { item: PanelItem; task: Task; chatKey: string }) {
  const off = item.useOff?.(task) ?? null
  if (off)
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div className="flex flex-col items-center gap-2 text-fg3">
          <item.Icon className={ic} />
          <Small className="text-pretty">{off}</Small>
        </div>
      </div>
    )
  return <item.View key={`${task.id}|${item.id}`} task={task} chatKey={chatKey} />
}

/** A task view's body: its chat, or the tab picked (Terminal, Pull request, Artifacts…) in its place, as 3.0's task view */
export function TabBody({ task, chatKey, children }: { task: Task; chatKey: string; children: ReactNode }) {
  const sheet = useUI((u) => u.sheet)
  // its agent ended while its terminal showed: back to its chat, which stays to read (the window's)
  const item = sheet && !(sheet === 'terminal' && !termRunning(task)) ? itemsFor(task).find((i) => i.id === sheet) : undefined
  return item ? <div className="flex min-h-0 flex-1 flex-col"><ItemBody key={item.id} item={item} task={task} chatKey={chatKey} /></div> : <>{children}</>
}

/** the task's agent runs: its Terminal can open (the window's Terminal is dim, "Not running", once it has ended) */
const termRunning = (task: Task) => !!task.agent?.running

/** A task's items as 3.0's task view has them: only those it has now (a pull request's once it has one) */
export const itemsFor = (task: Task) => registry.taskPanel.filter((i) => i.id !== 'pr' || !!task.pr)

/** The task view's tabs, as 3.0's (Chat, Terminal, Pull request, Artifacts, Browser): Chat is its chat; another
 *  opens its view, in the side panel on a desktop and over the chat on a phone or tablet */
/** A task's views. In a desktop's header (head): a segmented control, as the Assistant's Chat | Terminal, on the header's
 *  row; on a phone a row of its own under the header */
export function TaskTabs({ task, head }: { task: Task; head?: boolean }) {
  const ui = useUI()
  const items = itemsFor(task)
  const bar = useRef<HTMLDivElement>(null)
  // as 3.0's: a tab switches the view in place, under the same header (never another panel)
  const on = ui.sheet && items.some((i) => i.id === ui.sheet) && !(ui.sheet === 'terminal' && !termRunning(task)) ? ui.sheet : 'chat'
  // the picked tab always in sight: a narrow column or a phone scrolls the strip to it (the last, Artifacts, was cut off)
  useLayoutEffect(() => {
    bar.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [on, task.id])
  if (!items.length) return null
  // dead: it can't open now (the window's disabled segment, its reason in its label): only Terminal, once its agent ended
  const tab = (id: string, label: string, dead: string | null, go: () => void, n?: number) => (
    <button key={id} type="button" role="tab" aria-selected={on === id} aria-disabled={dead ? true : undefined} data-off={dead ? '' : undefined} aria-label={dead ? `${label}: ${dead}` : undefined} onClick={dead ? undefined : go}
      className={clsx(
        'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 after:absolute after:inset-x-0 aria-selected:text-fg data-off:cursor-default data-off:text-fg3 data-off:hover:bg-transparent coarse:h-9',
        // the segment picked as the Assistant's (Tab): raised, bordered
        head ? 'after:-inset-y-2 aria-selected:bg-seg-on aria-selected:shadow-[0_0_0_1px_var(--line2)] not-aria-selected:hover:text-fg' : 'after:-inset-y-1.5 hover:bg-hover aria-selected:bg-sel phone:h-9 phone:px-3 phone:text-[0.875rem]',
      )}>
      {label}
      <Count n={n} />
    </button>
  )
  return (
    <div ref={bar} role="tablist" aria-label={`${task.id} views`} className={clsx('scroll-x flex items-center gap-0.5', head ? 'max-w-full min-w-0 rounded-full bg-hover p-0.5' : 'shrink-0 border-b border-line px-3 py-1.5 phone:px-4')}>
      {tab('chat', 'Chat', null, closeSheet)}
      {items.map((i) => tab(i.id, i.label, i.id === 'terminal' && !termRunning(task) ? 'Not running' : null, () => setUI({ sheet: i.id, taskMenu: false, plus: null, pick: null }), i.count?.(task)))}
    </div>
  )
}

/** An item open over the whole screen (phone and tablet), from the task header's ⋯: pushed over the chat, Back or a
 *  swipe right closes it */
export function PanelSheet() {
  const ui = useUI()
  const snap = useSnap()
  const task = snap && taskOf(snap, ui.task)
  const g = snap && agentChat(ui, snap)
  const item = ui.sheet ? registry.taskPanel.find((i) => i.id === ui.sheet) : undefined
  // the task view's tabs show their views in place now (TabBody): this sheet is only for a task without its tabs
  const open = false && ui.device !== 'desktop' && !!task && !!g && !!item
  // a keyboard (a tablet's) closes it with Esc, unless a box or menu has it
  useEffect(() => {
    if (!open) return
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement)?.closest?.('input, textarea, [role=menu]')) return
      e.preventDefault()
      closeSheet()
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [open])
  if (!open) return null
  const phone = ui.device === 'phone'
  return (
    <Pushed role="dialog" label={`${item.label} · ${task.id}`} onBack={closeSheet} className="z-6">
      {phone ? (
        <PhoneTop
          left={
            <RoundButton label="Back to the chat" onClick={closeSheet}>
              <BackIcon className={ic} />
            </RoundButton>
          }
          name={item.label}
          kind={`${task.id} · ${task.name}`}
        />
      ) : (
        <Head>
          <IconButton label="Back to the chat" onClick={closeSheet}>
            <BackIcon className={ic} />
          </IconButton>
          <Who name={item.label} kind={`${task.id} · ${task.name}`} />
        </Head>
      )}
      <div className={clsx('flex min-h-0 flex-1 flex-col', phone && !ui.keyboard && 'pb-[env(safe-area-inset-bottom)]')}>
        <ItemBody key={item.id} item={item} task={task} chatKey={g.chat} />
      </div>
    </Pushed>
  )
}
