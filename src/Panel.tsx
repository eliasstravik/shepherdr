// An open task's side panel: its items (Terminal, Files, Diff, Pull request; plugins add them) as tabs in a column
// right of the task's chat on a desktop, or as rows of the task header's ⋯ menu opening a full-screen sheet on a phone
// or tablet (on a desktop the ⋯ lists them too, opening their tab). A coordinator chat has none.
import clsx from 'clsx'
import { Fragment, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
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
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [--fade-l:0px] [--fade-r:0px] [mask-image:linear-gradient(to_right,transparent,#000_var(--fade-l),#000_calc(100%-var(--fade-r)),transparent)] data-more-l:[--fade-l:1.5rem] data-more-r:[--fade-r:1.5rem]"
        >
          {registry.taskPanel.map((i) => (
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
        'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 after:absolute after:-inset-y-2 after:inset-x-0 hover:bg-hover aria-selected:bg-sel aria-selected:text-fg data-off:text-fg3 coarse:h-9',
      )}
    >
      <item.Icon className={ic} />
      {item.label}
    </button>
  )
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

/** The task header's ⋯, like a coordinator's: what plugins put first (Search in this chat), then the items, each a
 *  full-screen sheet on a phone or tablet and its tab on a desktop; one with nothing to show is greyed, and opens all
 *  the same, to say why. Last, the same task actions its row's ⋯ has */
export function TaskMenu({ task, chatKey, pane }: { task: Task; chatKey: string; pane?: number }) {
  const ui = useUI()
  // split, it opens in the focused pane (a click in a pane focuses it first), or the open task's on the right; a
  // pane's items open the task on the right, its side panel beside it
  const items = registry.taskPanel
  const split = panesHere(ui).length > 0
  const open = ui.taskMenu && (pane === undefined ? !split || ui.split.pane < 0 : ui.split.pane === pane)
  const Actions = registry.views.taskActions
  if (!registry.agentMenu.length && !items.length && !Actions) return null
  const B = ui.device === 'phone' ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx('rounded-full!', ui.device === 'phone' ? 'aria-expanded:bg-line2' : 'aria-expanded:bg-hover')}
        onClick={() => setUI({ taskMenu: !open, plus: null, pick: null })}
      >
        <MoreIcon className={ic} />
      </B>
      {open ? (
        <Menu label="More" onClose={() => setUI({ taskMenu: false })} className="absolute top-full right-0 z-21 mt-1.5 max-h-[calc(100dvh-5rem)] max-w-[calc(100vw-24px)] origin-top-right overflow-y-auto">
          {registry.agentMenu.map(({ View }, i) => (
            <Fragment key={i}>
              <View chatKey={chatKey} />
              {i === registry.agentMenu.length - 1 && items.length ? <MenuSeparator /> : null}
            </Fragment>
          ))}
          {items.map((i) => (
            <TaskMenuRow key={i.id} item={i} task={task} pane={pane} />
          ))}
          {/* the open task, beside the panes (desktop) */}
          {pane === undefined && ui.device === 'desktop' ? (
            <>
              <MenuSeparator />
              <MenuItem icon={<SplitIcon className={ic} />} onClick={() => openSplit({ kind: 'task', id: task.id })}>
                Open in split view
              </MenuItem>
            </>
          ) : null}
          {Actions ? (
            <>
              <MenuSeparator />
              <Actions task={task} close={() => setUI({ taskMenu: false })} />
            </>
          ) : null}
        </Menu>
      ) : null}
    </div>
  )
}

function TaskMenuRow({ item, task, pane }: { item: PanelItem; task: Task; pane?: number }) {
  const off = item.useOff?.(task) ?? null
  return (
    <MenuItem icon={<item.Icon className={ic} />} data-off={off ? '' : undefined} className={clsx(off && 'text-fg3')} onClick={() => (pane === undefined ? openItem(item.id) : paneToPanel(pane, item.id))}>
      {item.label}
    </MenuItem>
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
  const open = ui.device !== 'desktop' && !!task && !!g && !!item
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
