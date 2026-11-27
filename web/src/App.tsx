// The shell: the list on the left (behind the menu button on a phone), the chat in the middle, the pane on the right
// (the whole screen on a phone), and the phone's bottom bar. SHEP-336: beside a pane the chat can swap to the right
// (the pane then sits between the list and the chat); the page's order follows, so Tab goes the way it reads. It only lays out what the plugins put in the kernel's
// places; the layout itself is the design system's (ds.css).
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { Snapshot } from '@shared/types.ts'
import { downWords, isEverything, needsCount, placeDown, placeOf, spaceLabel, spaceName, taskOf, type Space } from '@shared/view.ts'
import { getState, openSettings, registry, setUI, sideHidden, togglePane, useSnap, useStore, useUI, type Thread } from './kernel.ts'
import { dismiss, hold, subscribe, toasts } from './toasts.ts'
import { handleKey } from './commands.ts'
import { List, spaceMenu } from './list.tsx'
import { HeaderPath } from './where.tsx'
import { closeTop, Layers } from './overlay.tsx'
import { edge } from './resize.ts'
import { columnsOf, swapSides, useSides } from './sides.ts'
import { SettingsWindow } from './settings.tsx'
import { cx, Empty, I, IB, useScrolled } from './ui.tsx'
import { SpaceIcon } from './space-icon.tsx'
import { MarkRead } from './read-marks.ts'
import { pickFor, PickSummary, reportedPick, useCatalog } from './picker.tsx'

/** the thread the middle column shows: the open task when it has the middle, else the space's chat */
export function middleThread(snap: Snapshot, ui: { at: string; max: string | null }): Thread | null {
  const p = placeOf(snap, ui.at)
  if (!p) return null
  const t = ui.max ? taskOf(snap, ui.max) : undefined
  return t ? { chat: t.agent?.chat ?? `${t.id}/worker`, place: t.place, task: t, where: 'chat' } : { chat: p.chat, place: p.id, where: 'chat' }
}

/** the message box's placeholder: "Message Shepherdr", "Message #shop", "Add a reply" in a task */
export function placeholderOf(snap: Snapshot, thread: Thread): string {
  if (thread.task) return 'Add a reply'
  return isEverything(snap, thread.place) ? 'Message Shepherdr' : `Message ${spaceLabel(snap, thread.place)}`
}

function ChatHeader({ snap, thread, place, scrolled }: { snap: Snapshot; thread: Thread; place: Space; scrolled: boolean }) {
  const phone = useUI((u) => u.phone)
  const hidden = useUI(sideHidden)
  const agent = useStore((s) => s.chats[thread.chat]?.agent)
  const cat = useCatalog(thread.task ? undefined : place.machine)
  const TaskHead = registry.views.taskHead
  if (thread.task && TaskHead) return <TaskHead task={thread.task} where="chat" scrolled={scrolled} />
  const every = isEverything(snap, place.id)
  const pick = reportedPick(agent ?? place.agent) ?? pickFor(snap, every ? 'all' : place.id, 'Chats')
  return (
    <header className={cx('hd', scrolled && 'sc')}>
      {phone ? <IB icon="burger" label="Spaces" onClick={() => setUI({ drawer: true })} /> : hidden ? <IB icon="panel" label="Show the list" onClick={showList} /> : null}
      <div className="chat-heading">
        <div className="ttl">
          <button type="button" className="tbtn" aria-haspopup="menu" onClick={(e) => spaceMenu(e.currentTarget, place.id, true)}>
            {(!every || place.emoji) && <SpaceIcon snap={snap} id={place.id} c="s16" />}
            <span>{every ? 'Everything' : spaceName(snap, place)}</span>
            <I n="down" c="s16 c-mute" />
          </button>
          <HeaderPath snap={snap} place={place} />
        </div>
        <span className="t2"><PickSummary pick={pick} cat={cat} /></span>
      </div>
      {registry.header.filter((h) => !phone || h.phone).map((h, i) => <h.View key={i} thread={thread} />)}
    </header>
  )
}

/** The header's "Show the list" button: on a narrow window with a pane open it brings the list back and closes the
 *  pane; else it shows the list hidden by its own button. */
export function showList() {
  const { ui } = getState()
  if (ui.narrow && ui.pane && !ui.sideOff) setUI({ pane: null, task: null, art: null, artWide: false })
  else setUI({ sideOff: false })
}

function ChatColumn({ snap }: { snap: Snapshot }) {
  const ui = useUI()
  const scroll = useRef<HTMLDivElement>(null)
  const scrolled = useScrolled(scroll)
  const thread = middleThread(snap, ui)
  const place = placeOf(snap, ui.at)
  if (!thread || !place) return <section className="col chat"><Empty title="Welcome to Shepherdr">Add a space to start: New space, at the foot of the list.</Empty></section>
  const down = placeDown(snap, thread.place)
  const Body = registry.chatBody.find((b) => b.when(ui, thread))?.View
  const Messages = registry.views.messages
  const Box = registry.views.box
  const Top = thread.task ? registry.views.taskTop : undefined
  const drawer = registry.drawer.find((d) => d.when(ui, thread))
  return (
    <section className="col chat" aria-label={thread.task ? thread.task.name : 'Chat'}>
      <ChatHeader snap={snap} thread={thread} place={place} scrolled={scrolled} />
      <div className="scroll" ref={scroll} data-scroll={thread.chat}>
        <div className="msgs">
          {down ? (
            <Empty title={`Can't reach ${down.name}`}>{down.unreachableSince ? `Last seen ${down.unreachableSince}. ` : ''}Work there carries on, and shows here when the link is back.</Empty>
          ) : Body ? (
            <Body thread={thread} />
          ) : (
            <>
              {Top && thread.task && <Top task={thread.task} />}
              {Messages && <Messages thread={thread} />}
            </>
          )}
        </div>
      </div>
      <div className="foot">
        {!down && registry.aboveBox.map((a, i) => <a.View key={i} thread={thread} />)}
        {!down && !Body && Box && <Box thread={thread} placeholder={placeholderOf(snap, thread)} />}
      </div>
      {drawer && (
        <>
          <div className="rzh" {...edge('term')} />
          <div className="tdr">
            <drawer.View thread={thread} />
          </div>
        </>
      )}
    </section>
  )
}

function PaneColumn() {
  const pane = useUI((u) => u.pane)
  const P = registry.panes.find((p) => p.id === pane)
  if (!P) return null
  return (
    <section className="col pane" aria-label={pane ?? undefined}>
      <P.View />
    </section>
  )
}

/** what a pane is made of: its header, what scrolls, what stays at its foot, and a terminal drawer under it */
export function PaneFrame({ head, children, foot, drawer, scrollKey, flush }: { head: (scrolled: boolean) => ReactNode; children: ReactNode; foot?: ReactNode; drawer?: ReactNode; scrollKey?: string; flush?: boolean }) {
  const scroll = useRef<HTMLDivElement>(null)
  const scrolled = useScrolled(scroll)
  return (
    <>
      {head(scrolled)}
      <div className="scroll" ref={scroll} data-scroll={scrollKey} style={flush ? { padding: 0 } : undefined}>
        {children}
      </div>
      {foot && <div className="foot">{foot}</div>}
      {drawer}
    </>
  )
}

/** the phone's bottom bar: the pill Chat / Tasks / Artifacts (the voice call's button is in the message box) */
function Bar({ snap }: { snap: Snapshot }) {
  const pane = useUI((u) => u.pane)
  const at = useUI((u) => u.at)
  // the Tasks count follows the Tasks filter (SHEP-331): redraw when it changes
  useUI((u) => u.tf)
  const on = pane && registry.bar.some((b) => b.pane === pane) ? pane : pane ? '' : 'chat'
  return (
    <>
      <nav className="bar" aria-label="Views">
        <div className="pill" style={{ gridTemplateColumns: `repeat(${registry.bar.length + 1},minmax(0,1fr))` }}>
          <button type="button" className="pt" aria-pressed={on === 'chat'} onClick={() => togglePane(null)}>
            <span className="w"><I n="chat" c="s22" /></span>
            Chat
          </button>
          {registry.bar.map((b) => {
            const n = b.count?.(snap, at) ?? 0
            return (
              <button type="button" key={b.pane} className="pt" aria-pressed={on === b.pane} onClick={() => setUI({ pane: b.pane, task: null, art: null, artWide: false })}>
                <span className="w">
                  <I n={b.icon} c="s22" />
                  {n > 0 && <span className="cnt">{n}</span>}
                </span>
                {b.label}
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}

/** the toasts, stacked at the top, clear of the message box. Hovering or focusing them stops their time; each has a
 *  close button (Escape closes the focused one). The list is always there, so screen readers hear each new one; an
 *  error is said at once. */
function Toasts() {
  const list = useSyncExternalStore(subscribe, toasts, toasts)
  const close = (id: number, e: { currentTarget: HTMLElement }) => {
    // the focus goes to the next one's close button, not lost to the page
    const li = e.currentTarget.closest('li')
    const to = (li?.nextElementSibling ?? li?.previousElementSibling)?.querySelector<HTMLElement>('button')
    const had = li?.contains(document.activeElement)
    dismiss(id)
    if (had) to ? to.focus() : hold('focus', false)
  }
  return (
    <ol
      className="toasts"
      role="list"
      aria-label="Notifications"
      aria-live="polite"
      onFocus={() => hold('focus', true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && hold('focus', false)}
    >
      {list.map((t) => (
        <li key={t.id} className={cx('toast', t.busy && 'busy', t.tone === 'error' && 'err')} role={t.tone === 'error' ? 'alert' : undefined} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close(t.id, e))}
          onPointerEnter={(e) => e.pointerType === 'mouse' && hold('hover', true)}
          onPointerLeave={() => hold('hover', false)}
        >
          {t.busy ? <I n="working" c="s16" /> : t.tone === 'error' ? <I n="warn" c="s16 c-red" /> : null}
          <span className="tt">{t.text}{t.sub && <span className="ts">{t.sub}</span>}</span>
          {t.act && <button type="button" className="ta" onClick={(e) => { t.act!.run(); close(t.id, e) }}>{t.act.label}</button>}
          <button type="button" className="tx" aria-label="Dismiss" onClick={(e) => close(t.id, e)}>
            <I n="x" c="s16" />
          </button>
        </li>
      ))}
    </ol>
  )
}

/** a finger is the main pointer (a phone or a tablet): the app takes its touch sizes (SHEP-317) */
const COARSE = typeof matchMedia === 'function' ? matchMedia('(pointer:coarse)') : null
const onCoarse = (f: () => void) => (COARSE?.addEventListener('change', f), () => COARSE?.removeEventListener('change', f))
const useCoarse = () => useSyncExternalStore(onCoarse, () => !!COARSE?.matches, () => false)

export function App() {
  const snap = useSnap()
  const ui = useUI()
  const { side } = useSides()
  const coarse = useCoarse()
  // the document says which layout it is in, for the few styles outside the shell
  useEffect(() => {
    document.documentElement.classList.toggle('is-phone', ui.phone)
  }, [ui.phone])
  // Escape closes the topmost thing: a menu or dialog first (overlay.tsx), then search, settings, the list
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      for (const k of registry.keys) if (k.handle(e)) return void e.preventDefault()
      // the commands' shortcuts (commands.ts): Cmd+K, ?, G then T…, as each may fire where the keys are
      if (e.key !== 'Escape' && handleKey(e)) return void e.preventDefault()
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (closeTop()) return
      const u = getState().ui
      if (u.search) setUI({ search: false })
      else if (u.settings) setUI({ settings: null })
      else if (u.drawer) setUI({ drawer: false })
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  if (!snap) return <div className={cx('app', (ui.phone || coarse) && 'tap')}><div className="device" /></div>
  const hidden = sideHidden(ui)
  const swap = !ui.phone && !!ui.pane && side === 'right'
  const Search = registry.views.search
  const Middle = registry.middle.find((m) => m.when(ui))
  return (
    <div className={cx('app', ui.phone && 'phone', (ui.phone || coarse) && 'tap')}>
      <div className="device">
        {registry.topBars.map((V, i) => <V key={i} />)}
        <div className={cx('shell', ui.pane && 'has-pane', hidden && 'noside', swap && 'swap')}>
          {!ui.phone && !hidden && (
            <nav className="side" aria-label="Spaces">
              <List snap={snap} />
            </nav>
          )}
          {columnsOf(swap ? 'right' : 'left').map((c) =>
            c === 'chat' ? (
              Middle ? <section key="chat" className="col chat"><Middle.View /></section> : <ChatColumn key="chat" snap={snap} />
            ) : (
              ui.pane && <PaneColumn key="pane" />
            ),
          )}
          <div className="rz rzs" {...edge('side')} />
          <div className="rz rzp" {...edge('pane', swapSides)} />
        </div>
        {ui.phone && <Bar snap={snap} />}
        <div className="layer">
          {ui.drawer && ui.phone && (
            <>
              <div className="scrim" onClick={() => setUI({ drawer: false })} />
              <nav className="drawer in" aria-label="Spaces">
                <List snap={snap} />
              </nav>
            </>
          )}
          {ui.settings && (
            <>
              <div className="scrim" onClick={() => setUI({ settings: null })} />
              <SettingsWindow snap={snap} />
            </>
          )}
          {ui.search && Search && (
            <>
              <div className="scrim" onClick={() => setUI({ search: false })} />
              <div className={cx(ui.phone ? 'pop sheet' : 'dlg wide', 'srch in')} role="dialog" aria-modal="true" aria-label="Search">
                <Search close={() => setUI({ search: false })} />
              </div>
            </>
          )}
          <Layers />
          {registry.overlays.map((V, i) => <V key={i} />)}
        </div>
        <Toasts />
        <MarkRead />
      </div>
    </div>
  )
}

export { needsCount, openSettings }
