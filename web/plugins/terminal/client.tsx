// Terminals. Your own: one per space, a real shell in the space's folder on its machine, in a dark drawer at the very
// bottom, below the message box (the whole screen on a phone), opened from the Terminal row of the space's name menu
// or Ctrl+`; a task has one too, in its folder, from its ⋯ menu.
// It keeps running when the drawer is closed. An agent's own terminal is tucked in a menu: "View as terminal" swaps
// a chat for the same session's live terminal, with a bar on top to switch back. Every terminal is a real one you
// type straight into, sized to its pane; on a phone or any touch screen a row of keys sits under it: esc, tab, ctrl
// and the arrows.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { definePlugin, getState, notice, openTask, setUI, useSnap, useUI, type Thread } from '@client/kernel.ts'
import { Btn, Hd, I, IB } from '@client/ui.tsx'
import { openMenu } from '@client/overlay.tsx'
import { copyText } from '@client/copy.ts'
import { appTakes, focusChat, focusTask } from '@client/commands.ts'
import { onPageReturn } from '@client/viewport.ts'
import type { Chat, Task } from '@shared/types.ts'
import { machineLabel, placeOf, taskChat, taskOf, tasksIn, tstate } from '@shared/view.ts'
import { fitGrid, following, footTop, lastPaintedRow, LINE, linesFor, shrinkTo, showKeys, sizeTaken } from './fit.ts'
import { followFold, spaceTermRow, switchView, taskTermRow, toggleSpaceTerm, toggleTaskTerm, viewRow } from './menu.ts'
import { connectTerminal, streamInput } from './stream.ts'
import { linkLayer, type LinkLayer } from './linklayer.ts'
import { mirrorFocus } from './focus.ts'
import { focusAfterKey } from './keyrow.ts'
import { opens, type Link } from './links.ts'

/** a web page opens the way a chat's link does: a new tab (the outside browser in the Android app), or in the app
 *  when it is this app's own (kernel.ts catches it) */
function openUrl(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.hidden = true
  document.body.appendChild(a)
  a.click()
  a.remove()
}

let spot: HTMLElement | null = null
/** a link's menu, at the link: Open (a web page only) and Copy link, the address on top */
function linkMenu(link: Link, at: DOMRect | null) {
  spot?.remove()
  spot = document.createElement('span')
  const r = at ?? new DOMRect(16, 16, 0, 0)
  spot.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;pointer-events:none`
  document.body.appendChild(spot)
  openMenu(spot, [
    ...(opens(link.url) ? [{ icon: 'ext' as const, label: 'Open', run: () => openUrl(link.url) }] : []),
    { icon: 'copy' as const, label: 'Copy link', run: () => void copyText(link.url).then((ok) => ok && notice('Copied')) },
  ], { top: () => <div className="cap tlcap">{link.url}</div>, label: 'Link' })
}

/** a tap or a click on a link: a web page opens; any other kind (file: and the rest) only offers its copy */
const follow = (link: Link, at: DOMRect | null) => (opens(link.url) ? openUrl(link.url) : linkMenu(link, at))

/** a finger held this long on a link opens its menu */
const HOLD = 500

const KEYMAP: Record<string, string> = { Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown' }

/** a browser key event as herdr's key name, or text to type */
export function toKey(e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }, ctrl = false): { keys?: string[]; text?: string } | null {
  if (KEYMAP[e.key]) return { keys: [(e.shiftKey && e.key === 'Tab' ? 'shift+' : '') + KEYMAP[e.key]] }
  if ((e.ctrlKey || ctrl) && e.key.length === 1) return { keys: [`ctrl+${e.key.toLowerCase()}`] }
  if (e.altKey && e.key.length === 1) return { keys: [`alt+${e.key.toLowerCase()}`] }
  if (e.key.length === 1 && !e.metaKey) return { text: e.key }
  return null
}

/** the terminal's key on the server: your own shell in a space or a task's folder, or an agent's own session */
export const shellKey = (thread: Thread) => (thread.task ? `sh:task:${thread.task.id}` : `sh:${thread.place}`)

let cellRatio = 0
function cellOf(family: string) {
  if (cellRatio) return cellRatio
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return 0.6
  c.font = `100px ${family}`
  return (cellRatio = c.measureText('M'.repeat(20)).width / 2000 || 0.6)
}
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const COARSE = '(any-pointer: coarse)'
const onCoarse = (f: () => void) => {
  if (typeof matchMedia !== 'function') return () => {}
  const q = matchMedia(COARSE)
  q.addEventListener('change', f)
  return () => q.removeEventListener('change', f)
}
/** a touch screen anywhere on this device */
const useCoarse = () => useSyncExternalStore(onCoarse, () => typeof matchMedia === 'function' && matchMedia(COARSE).matches, () => false)

/** A real terminal (xterm.js) you type straight into. It asks for its pane's width, so lines wrap at the pane's edge
 *  (an agent's terminal goes back to its own size when you leave); when something else holds it at another size, the
 *  font shrinks to fit, down to 8 px. Your own shell takes the pane's height too. An agent's keeps its own height (at
 *  least the pane's): herdr sends only the screen, never older lines, so its tall screen is the history you scroll
 *  up through. It opens at the last line shown and follows new output, unless you scroll up; back down, it follows
 *  again. */
export function Term({ stream, fill, onEnd }: { stream: string; fill?: boolean; onEnd?: () => void }) {
  const phone = useUI((u) => u.phone)
  const coarse = useCoarse()
  const own = stream.startsWith('sh:')
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const cap = useRef<HTMLInputElement>(null)
  const xt = useRef<import('@xterm/xterm').Terminal | null>(null)
  const links = useRef<LinkLayer | null>(null)
  const coarseRef = useRef(coarse)
  coarseRef.current = coarse
  const press = useRef<{ link: Link; x: number; y: number; held: boolean; timer: ReturnType<typeof setTimeout> } | null>(null)
  const scrolling = useRef({ carry: 0, x: 0, y: 0 })
  const [status, setStatus] = useState('Opening the terminal…')
  const [ctrl, setCtrl] = useState(false)
  const ctrlRef = useRef(false)
  ctrlRef.current = ctrl
  const claim = useRef(() => {})
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  /** what pressed the key row last: 'touch', 'pen', 'mouse', or '' for a key press on its button */
  const pointer = useRef('')

  useLayoutEffect(() => {
    let gone = false
    let term: import('@xterm/xterm').Terminal | null = null
    let cursorVisible = true
    let link: { close(): void } | null = null
    let cols = 80, rows = 24, natural = 0
    let asked = '', wanted = '', opened = false, follow = true, lastFoot = 0
    // this page sets the terminal's size only while it is the one you used last (opened it here, typed, tapped or
    // clicked in it); another page's size, once it arrives, makes this one only shrink to fit, so two pages never trade
    // sizes back and forth. A hidden tab never takes it.
    let owner = typeof document === 'undefined' || !document.hidden, sizes = 0
    let later: ReturnType<typeof setTimeout> | undefined
    const el = box.current
    let visible = !!el?.clientHeight
    setStatus('Opening the terminal…')
    /** a character's width and a row's height per px of font, as xterm really draws them (it rounds to the screen's
     *  pixels); a guess from the font until it has drawn */
    const metrics = () => {
      const drawn = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } } })._core?._renderService?.dimensions?.css?.cell
      const at = term!.options.fontSize ?? 13
      return { cell: drawn && drawn.width > 0 ? drawn.width / at : cellOf(MONO), line: drawn && drawn.height > 0 ? drawn.height / at : LINE, at }
    }
    /** where the box is scrolled to when it follows: the last line with something on it at the box's foot */
    const foot = () => {
      if (!term || !el) return 0
      const b = term.buffer.active
      const last = lastPaintedRow(term.rows, b.cursorY, cursorVisible, (row) => b.getLine(b.baseY + row)?.translateToString(true))
      const { line, at } = metrics()
      return footTop(last, line * at, el.clientHeight, el.scrollHeight - el.clientHeight)
    }
    const land = () => {
      if (!el?.clientHeight) return
      lastFoot = foot()
      if (follow && Math.abs(el.scrollTop - lastFoot) >= 1) el.scrollTo({ top: lastFoot, behavior: 'instant' })
    }
    const reopen = () => {
      follow = true
      term?.scrollToBottom()
      land()
    }
    // you scrolled: away from the foot it stops following; back at it (or below), it follows again
    const scrolled = () => {
      if (!term || !el?.clientHeight) return
      const to = foot()
      if (follow && to !== lastFoot) return land()
      const { line, at } = metrics()
      follow = following(el.scrollTop, to, line * at)
    }
    el?.addEventListener('scroll', scrolled, { passive: true })
    const stopReturning = onPageReturn(reopen)
    const fit = () => {
      const wasVisible = visible
      visible = !!el?.clientHeight
      if (!term || !el) return
      // the box less its padding (16 left, 8 top and bottom) and room for the scrollbar
      const w = el.clientWidth - 16 - 12
      const h = el.clientHeight - 16
      if (w <= 0 || h <= 0) return
      const { cell, line } = metrics()
      const grid = fitGrid(w, h, cell, line)
      const want = own ? grid : { cols: grid.cols, rows: Math.max(grid.rows, Math.min(200, natural || grid.rows)) }
      const key = `${want.cols}x${want.rows}`
      if (opened && owner && key !== asked && key !== wanted) {
        // a drag, a rotation or the keyboard sends many sizes: ask for the last one
        wanted = key
        clearTimeout(later)
        later = setTimeout(() => {
          asked = key
          streamInput(stream, { type: 'resize', ...want })
        }, asked ? 150 : 0)
      }
      term.options.fontSize = shrinkTo(w, own ? h : Infinity, cols, rows, cell, line)
      if (!wasVisible) reopen()
      else land()
    }
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-unicode11')]).then(([{ Terminal }, { Unicode11Addon }]) => {
      if (gone || !host.current) return
      term = xt.current = new Terminal({ cols: 80, rows: 24, scrollback: 2000, disableStdin: true, cursorBlink: true, fontFamily: MONO, fontSize: 13, lineHeight: LINE, allowProposedApi: true, theme: { background: '#0a0a0a', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: 'rgb(255 255 255 / 0.25)' } })
      for (const final of ['h', 'l']) {
        term.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
          if (params.includes(25)) cursorVisible = final === 'h'
          return false
        })
      }
      const resetCursor = () => { cursorVisible = true; return false }
      term.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, resetCursor)
      term.parser.registerEscHandler({ final: 'c' }, resetCursor)
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
      // keys go to the terminal on its machine through the box over it; xterm only draws
      term.attachCustomKeyEventHandler(() => false)
      term.open(host.current)
      // The drawn grid can change after fit or a write. Position the outer box in that same render.
      term.onRender(land)
      links.current = linkLayer(term, () => coarseRef.current)
      if (term.textarea) {
        term.textarea.readOnly = true
        term.textarea.tabIndex = -1
      }
      // the box may already have the keys (opened with Ctrl+`): a solid cursor from the start
      if (cap.current && document.activeElement === cap.current) mirrorFocus(term.textarea, true)
      link = connectTerminal(
        stream,
        (bytes, done) => term!.write(bytes, () => { done(); land() }),
        () => {
          cursorVisible = true
          term!.reset()
          reopen()
          asked = wanted = ''
          sizes = 0
          natural = 0
        },
        (c, r) => {
          // the size it had before this page asked for one: an agent keeps that height
          if (!asked && !wanted) natural = r
          // another page set it: that one is in use now
          if (sizeTaken(asked, wanted, c, r, ++sizes === 1)) owner = false
          cols = c
          rows = r
          term!.resize(c, r)
          opened = true
          fit()
        },
        setStatus,
        // your own shell ended (Ctrl+D, exit): its drawer or screen closes
        () => endRef.current?.(),
      )
      fit()
    })
    // you used this page's terminal: it takes the size again (once, with no back and forth)
    claim.current = () => {
      if (owner) return
      owner = true
      clearTimeout(later)
      asked = wanted = ''
      fit()
    }
    const ro = new ResizeObserver(fit)
    if (el) ro.observe(el)
    return () => {
      gone = true
      clearTimeout(later)
      stopReturning()
      el?.removeEventListener('scroll', scrolled)
      ro.disconnect()
      link?.close()
      links.current?.dispose()
      links.current = null
      term?.dispose()
      xt.current = null
      claim.current = () => {}
    }
  }, [stream, own])

  /** a wheel or a finger's move over the terminal: the box pans (an agent's tall screen, a terminal too wide to fit),
   *  else the terminal's own history scrolls, a whole line at a time */
  const scrollBy = (dx: number, dy: number) => {
    const t = xt.current, el = box.current
    if (!t || !el) return
    if (dx) el.scrollLeft += dx
    if (el.scrollHeight > el.clientHeight + 1) { el.scrollTop += dy; return }
    const [n, rest] = linesFor(scrolling.current.carry, dy, (t.options.fontSize ?? 13) * LINE)
    scrolling.current.carry = rest
    if (n) t.scrollLines(n)
  }
  useEffect(() => links.current?.redraw(), [coarse])
  const linkAt = (e: { clientX: number; clientY: number }) => links.current?.at(e.clientX, e.clientY) ?? null
  const unpress = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  /** after a press of the key row: a mouse click gives the terminal the keys; a finger's tap leaves the on-screen
   *  keyboard as it was */
  const afterKey = () => {
    if (focusAfterKey(pointer.current)) cap.current?.focus()
    pointer.current = ''
  }
  const sendKey = (k: string) => {
    streamInput(stream, { type: 'keys', keys: [k] })
    afterKey()
  }
  return (
    <>
      <div className="tw" data-keys="own" style={fill ? { flex: 1, display: 'flex', flexDirection: 'column' } : undefined}>
        <div ref={box} className={fill ? 'termbox fill' : 'termbox'} data-term={stream}>
          <div ref={host} style={own ? { height: '100%' } : undefined} />
          {status && <div style={{ position: 'absolute', left: 16, top: 8, color: '#737373', font: `13px/20px ${MONO}` }}>{status}</div>}
        </div>
        <input
          ref={cap}
          className="tcap"
          name="terminal"
          aria-label="Terminal. Type here"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          onFocus={() => { mirrorFocus(xt.current?.textarea, true); claim.current() }}
          onBlur={() => mirrorFocus(xt.current?.textarea, false)}
          onWheel={(e) => scrollBy(e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY)}
          // a link: a click opens it (never focusing the box, so no keys and no keyboard), the mouse over it underlines
          // it, a right click or a held finger opens its menu
          onMouseMove={(e) => {
            const l = linkAt(e)
            links.current?.hover(l)
            e.currentTarget.style.cursor = l ? 'pointer' : ''
          }}
          onMouseLeave={() => links.current?.hover(null)}
          onMouseDown={(e) => {
            claim.current()
            if (e.button === 0 && linkAt(e)) e.preventDefault()
          }}
          onClick={(e) => {
            const l = linkAt(e)
            if (!l) return
            e.preventDefault()
            follow(l, links.current?.rect(l) ?? null)
          }}
          onContextMenu={(e) => {
            const l = press.current?.link ?? linkAt(e)
            if (!l) return
            e.preventDefault()
            if (press.current?.held) return
            if (press.current) press.current.held = true
            linkMenu(l, links.current?.rect(l) ?? null)
          }}
          onTouchStart={(e) => {
            claim.current()
            const t = e.touches[0]
            scrolling.current = { carry: 0, x: t.clientX, y: t.clientY }
            unpress()
            const l = e.touches.length === 1 ? linkAt(t) : null
            if (l)
              press.current = {
                link: l,
                x: t.clientX,
                y: t.clientY,
                held: false,
                timer: setTimeout(() => {
                  if (!press.current) return
                  press.current.held = true
                  linkMenu(l, links.current?.rect(l) ?? null)
                }, HOLD),
              }
          }}
          onTouchEnd={(e) => {
            const p = press.current
            if (!p) return
            unpress()
            // the tap is the link's alone: no click, no focus, no keyboard
            e.preventDefault()
            if (!p.held) follow(p.link, links.current?.rect(p.link) ?? null)
          }}
          onTouchCancel={unpress}
          onTouchMove={(e) => {
            const { clientX: x, clientY: y } = e.touches[0]
            if (press.current && Math.hypot(x - press.current.x, y - press.current.y) > 10) unpress()
            scrollBy(scrolling.current.x - x, scrolling.current.y - y)
            scrolling.current.x = x
            scrolling.current.y = y
          }}
          onKeyDown={(e) => {
            claim.current()
            // the app's own few keys pass (commands that say `terminal`): Cmd+K the palette, Ctrl+` your terminal
            if (appTakes(e.nativeEvent)) return
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            const k = toKey(e, ctrlRef.current)
            if (!k) return
            e.preventDefault()
            if (ctrlRef.current) setCtrl(false)
            streamInput(stream, k.keys ? { type: 'keys', keys: k.keys } : { type: 'text', text: k.text! })
          }}
          onChange={(e) => {
            // an on-screen keyboard (or an input method) gives text, not keys
            const t = e.target.value
            e.target.value = ''
            if (!t) return
            if (ctrlRef.current && t.length === 1) {
              setCtrl(false)
              streamInput(stream, { type: 'keys', keys: [`ctrl+${t.toLowerCase()}`] })
            } else streamInput(stream, { type: 'text', text: t })
          }}
          onPaste={(e) => {
            e.preventDefault()
            const t = e.clipboardData.getData('text')
            if (t) streamInput(stream, { type: 'text', text: t })
          }}
        />
      </div>
      {showKeys(phone, coarse) && (
        <div className="keys" onPointerDown={(e) => { pointer.current = e.pointerType; claim.current() }} onMouseDown={(e) => e.preventDefault()}>
          {([['esc', 'esc'], ['tab', 'tab']] as const).map(([l, k]) => <button type="button" key={l} aria-label={`${l} key`} onClick={() => sendKey(k)}>{l}</button>)}
          <button type="button" aria-label="ctrl key" aria-pressed={ctrl} style={ctrl ? { background: 'rgb(255 255 255/.3)' } : undefined} onClick={() => { setCtrl(!ctrl); afterKey() }}>ctrl</button>
          {([['←', 'left'], ['↑', 'up'], ['↓', 'down'], ['→', 'right']] as const).map(([l, k]) => <button type="button" key={k} aria-label={`${k} arrow key`} onClick={() => sendKey(k)}>{l}</button>)}
          <button type="button" aria-label="enter key" onClick={() => sendKey('enter')}>↵</button>
        </div>
      )}
    </>
  )
}

/** where your own terminal is: the space's folder (a task's own, its worktree when it has one) on its machine */
function whereOf(thread: Thread) {
  const snap = getState().snap!
  const p = placeOf(snap, thread.place) ?? snap.places.find((x) => x.id === thread.place)
  const dir = thread.task?.taskFolder ?? p?.cwd ?? p?.where ?? '~'
  return `${dir} on ${machineLabel(snap, p?.machine ?? snap.host)}`
}

/** your own terminal, in the drawer under a chat or a task */
function Drawer({ thread }: { thread: Thread }) {
  const close = () => setUI(thread.task ? { tterm: false } : { term: false })
  return (
    <>
      <div className="tbar">
        <span>{whereOf(thread)}</span>
        <IB icon="x" label="Close the terminal" onClick={close} />
      </div>
      <Term stream={shellKey(thread)} onEnd={close} />
    </>
  )
}

/** a phone's terminal takes the whole screen */
function TerminalPane() {
  const snap = useSnap()
  const ui = useUI()
  if (!snap) return null
  const t = ui.termTask ? taskOf(snap, ui.task) : undefined
  const p = placeOf(snap, ui.at)
  if (!p) return null
  const thread: Thread = t ? { chat: taskChat(t), place: t.place, task: t, where: 'pane' } : { chat: p.chat, place: p.id, where: 'pane' }
  const close = () => setUI(t ? { pane: 'tasks' } : { pane: null })
  return (
    <PaneFrame flush head={() => (t ? <Hd back={{ label: 'Back to the task', run: () => setUI({ pane: 'tasks' }) }} title="Terminal" sub={t.name} /> : <Hd title="Terminal" pad={12} />)}>
      <div className="tdr" style={{ border: 0 }}>
        <div className="tbar">
          <span>{whereOf(thread)}</span>
          <IB icon="x" label="Close the terminal" onClick={close} />
        </div>
        <Term stream={shellKey(thread)} fill onEnd={close} />
      </div>
    </PaneFrame>
  )
}

/** the agent's own terminal in the chat's place, with a bar on top to switch back */
function AgentTerminal({ thread }: { thread: Thread }) {
  return (
    <>
      <div className="abar">
        <span>The terminal behind this {thread.task ? 'task' : 'chat'}</span>
        <Btn small onClick={() => switchView(thread.chat, false)}>View as chat</Btn>
      </div>
      <Term stream={thread.chat} fill />
    </>
  )
}

/** "Waiting at a prompt": an agent's session waits for input that is not one of the app's own cards. Never raised by
 *  reading the agent's screen: it is what a blocked report with no kind looks like. It opens the agent's terminal. */
function Stuck({ chat: own, thread }: { chat: Chat | undefined; thread: Thread }) {
  const snap = useSnap()
  if (!snap) return null
  const stuck = (t: Task) => t.blocked === 'prompt' && !t.archived && tstate(t) !== 'done'
  const banner = (key: string, words: string, chat: string, open?: Task) => (
    <div className="banner" style={{ margin: '8px 0 0' }} key={key}>
      <I n="warn" c="c-ask" />
      <span className="n">{words}</span>
      <Btn small onClick={() => { if (open) openTask(open.id); switchView(chat, true) }}>View as terminal</Btn>
    </div>
  )
  if (thread.task) return stuck(thread.task) ? banner('t', 'Waiting at a prompt', thread.chat) : null
  const p = placeOf(snap, thread.place)
  return (
    <>
      {p?.needs && !!own?.blocked && !own.messages.some((m) => m.question && m.question.sent === undefined && !m.question.closed) && banner('own', 'Waiting at a prompt', thread.chat)}
      {tasksIn(snap, thread.place).filter(stuck).map((t) => banner(t.id, `${t.name} is waiting at a prompt`, taskChat(t), t))}
    </>
  )
}

export default definePlugin({
  name: 'terminal',
  setup(reg) {
    reg.panes.push({ id: 'terminal', View: TerminalPane })
    // folding or unfolding keeps the open terminal: drawer <-> the phone's Terminal screen
    followFold()
    reg.drawer.push({ when: (ui, thread) => !ui.phone && (thread.task ? ui.tterm : ui.term), View: Drawer })
    reg.chatBody.push({ when: (ui, thread) => !!ui.aterm[thread.chat], View: AgentTerminal })
    reg.chatTail.push({ order: 25, View: Stuck })
    // Terminal opens your own shell beside the chat; below a line, View as terminal swaps this chat for its agent's live
    // terminal (View as chat swaps back)
    reg.spaceMenu.push({ order: 5, rows: (_p, head) => (head ? [spaceTermRow(getState().ui)] : []) })
    reg.taskMenu.push({ order: 5, rows: (t, where) => (where === 'thread' ? [taskTermRow(getState().ui, t.id)] : []) })
    reg.spaceMenu.push({ order: 10, rows: (p, head) => [viewRow(getState().ui, p.chat, head)] })
    reg.taskMenu.push({ order: 10, rows: (t, where) => (where === 'thread' ? [viewRow(getState().ui, taskChat(t), true)] : []) })
    // Ctrl+` (VS Code's, Claude's) opens your own terminal, and works from inside one; Ctrl+Shift+` swaps the chat in
    // focus for its agent's terminal
    reg.commands.push(
      { id: 'terminal.mine', title: 'Open your terminal', area: 'Terminal', icon: 'prompt', keys: ['Ctrl+`'], terminal: true, words: 'shell console toggle close', run: () => { const t = focusTask(); if (t && !getState().ui.phone && getState().ui.pane === 'tasks') toggleTaskTerm(t.id); else toggleSpaceTerm() } },
      { id: 'terminal.view', title: 'View as terminal', area: 'Terminal', icon: 'viewswap', keys: ['Ctrl+Shift+`'], terminal: true, words: 'view as chat agent raw switch', run: () => { const c = focusChat(); if (c) switchView(c, !getState().ui.aterm[c]) } },
    )
  },
})

export { useMemo }
