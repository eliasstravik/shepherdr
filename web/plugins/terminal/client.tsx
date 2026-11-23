// Terminals. Your own: one per space, a real shell in the space's folder on its machine, in a dark drawer at the very
// bottom, below the message box (the whole screen on a phone), opened from the Terminal row of the space's name menu
// or Ctrl+`; a task has one too, in its folder, from its ⋯ menu.
// It keeps running when the drawer is closed. An agent's own terminal is tucked in a menu: "Switch to terminal" swaps
// a chat for the same session's live terminal, with a bar on top to switch back. Every terminal is a real one you
// type straight into, sized to its pane; on a phone or any touch screen a row of keys sits under it: esc, tab, ctrl
// and the arrows.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { definePlugin, getState, setUI, useSnap, useUI, type Thread } from '@client/kernel.ts'
import { Btn, Hd, I, IB } from '@client/ui.tsx'
import type { Chat, Task } from '@shared/types.ts'
import { machineLabel, placeOf, taskChat, taskOf, tasksIn, tstate } from '@shared/view.ts'
import { fitGrid, following, footTop, LINE, linesFor, shrinkTo, showKeys } from './fit.ts'
import { spaceTermRow, taskTermRow, toggleSpaceTerm } from './menu.ts'
import { connectTerminal, streamInput } from './stream.ts'

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
function Term({ stream, fill }: { stream: string; fill?: boolean }) {
  const phone = useUI((u) => u.phone)
  const coarse = useCoarse()
  const own = stream.startsWith('sh:')
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const cap = useRef<HTMLInputElement>(null)
  const xt = useRef<import('@xterm/xterm').Terminal | null>(null)
  const scrolling = useRef({ carry: 0, x: 0, y: 0 })
  const [status, setStatus] = useState('Opening the terminal…')
  const [ctrl, setCtrl] = useState(false)
  const ctrlRef = useRef(false)
  ctrlRef.current = ctrl

  useEffect(() => {
    let gone = false
    let term: import('@xterm/xterm').Terminal | null = null
    let link: { close(): void } | null = null
    let cols = 80, rows = 24, natural = 0
    let asked = '', wanted = '', opened = false, follow = true, moving = 0, frame = 0
    let later: ReturnType<typeof setTimeout> | undefined
    const el = box.current
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
      let last = b.cursorY
      for (let y = term.rows - 1; y > last; y--) {
        if (b.getLine(b.viewportY + y)?.translateToString(true).trim()) { last = y; break }
      }
      const { line, at } = metrics()
      return footTop(last, line * at, el.clientHeight, el.scrollHeight - el.clientHeight)
    }
    const land = () => {
      if (!follow || !el) return
      const to = foot()
      if (Math.abs(el.scrollTop - to) < 1) return
      moving++
      el.scrollTop = to
      requestAnimationFrame(() => moving--)
    }
    const landSoon = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; land() })
    }
    // you scrolled: away from the foot it stops following; back at it (or below), it follows again
    const scrolled = () => {
      if (moving || !term || !el) return
      const { line, at } = metrics()
      follow = following(el.scrollTop, foot(), line * at)
    }
    el?.addEventListener('scroll', scrolled, { passive: true })
    const fit = () => {
      if (!term || !el) return
      // the box less its padding (16 left, 8 top and bottom) and room for the scrollbar
      const w = el.clientWidth - 16 - 12
      const h = el.clientHeight - 16
      if (w <= 0 || h <= 0) return
      const { cell, line } = metrics()
      const grid = fitGrid(w, h, cell, line)
      const want = own ? grid : { cols: grid.cols, rows: Math.max(grid.rows, Math.min(200, natural || grid.rows)) }
      const key = `${want.cols}x${want.rows}`
      if (opened && key !== asked && key !== wanted) {
        // a drag, a rotation or the keyboard sends many sizes: ask for the last one
        wanted = key
        clearTimeout(later)
        later = setTimeout(() => {
          asked = key
          streamInput(stream, { type: 'resize', ...want })
        }, asked ? 150 : 0)
      }
      term.options.fontSize = shrinkTo(w, own ? h : Infinity, cols, rows, cell, line)
      if (follow) term.scrollToBottom()
      landSoon()
    }
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-unicode11')]).then(([{ Terminal }, { Unicode11Addon }]) => {
      if (gone || !host.current) return
      term = xt.current = new Terminal({ cols: 80, rows: 24, scrollback: 2000, disableStdin: true, cursorBlink: true, fontFamily: MONO, fontSize: 13, lineHeight: LINE, allowProposedApi: true, theme: { background: '#0a0a0a', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: 'rgb(255 255 255 / 0.25)' } })
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
      // keys go to the terminal on its machine through the box over it; xterm only draws
      term.attachCustomKeyEventHandler(() => false)
      term.open(host.current)
      if (term.textarea) {
        term.textarea.readOnly = true
        term.textarea.tabIndex = -1
      }
      link = connectTerminal(
        stream,
        (bytes, done) => term!.write(bytes, () => { done(); landSoon() }),
        () => {
          term!.reset()
          follow = true
          asked = wanted = ''
          natural = 0
        },
        (c, r) => {
          // the size it had before this page asked for one: an agent keeps that height
          if (!asked && !wanted) natural = r
          cols = c
          rows = r
          term!.resize(c, r)
          opened = true
          fit()
        },
        setStatus,
      )
      fit()
    })
    const ro = new ResizeObserver(fit)
    if (el) ro.observe(el)
    return () => {
      gone = true
      clearTimeout(later)
      cancelAnimationFrame(frame)
      el?.removeEventListener('scroll', scrolled)
      ro.disconnect()
      link?.close()
      term?.dispose()
      xt.current = null
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
  const sendKey = (k: string) => {
    streamInput(stream, { type: 'keys', keys: [k] })
    cap.current?.focus()
  }
  return (
    <>
      <div className="tw" style={fill ? { flex: 1, display: 'flex', flexDirection: 'column' } : undefined}>
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
          onWheel={(e) => scrollBy(e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY)}
          onTouchStart={(e) => {
            scrolling.current = { carry: 0, x: e.touches[0].clientX, y: e.touches[0].clientY }
          }}
          onTouchMove={(e) => {
            const { clientX: x, clientY: y } = e.touches[0]
            scrollBy(scrolling.current.x - x, scrolling.current.y - y)
            scrolling.current.x = x
            scrolling.current.y = y
          }}
          onKeyDown={(e) => {
            // the app's own keys pass: Ctrl+` closes the drawer, Ctrl+K searches
            if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key.toLowerCase() === 'k')) return
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
        <div className="keys">
          {([['esc', 'esc'], ['tab', 'tab']] as const).map(([l, k]) => <button type="button" key={l} aria-label={`${l} key`} onClick={() => sendKey(k)}>{l}</button>)}
          <button type="button" aria-label="ctrl key" aria-pressed={ctrl} style={ctrl ? { background: 'rgb(255 255 255/.3)' } : undefined} onClick={() => { setCtrl(!ctrl); cap.current?.focus() }}>ctrl</button>
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
  return (
    <>
      <div className="tbar">
        <span>{whereOf(thread)}</span>
        <IB icon="x" label="Close the terminal" onClick={() => setUI(thread.task ? { tterm: false } : { term: false })} />
      </div>
      <Term stream={shellKey(thread)} />
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
  return (
    <PaneFrame flush head={() => (t ? <Hd back={{ label: 'Back to the task', run: () => setUI({ pane: 'tasks' }) }} title="Terminal" sub={t.name} /> : <Hd title="Terminal" pad={12} />)}>
      <div className="tdr" style={{ border: 0 }}>
        <div className="tbar">
          <span>{whereOf(thread)}</span>
          <IB icon="x" label="Close the terminal" onClick={() => setUI(t ? { pane: 'tasks' } : { pane: null })} />
        </div>
        <Term stream={shellKey(thread)} fill />
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
        <Btn small onClick={() => switchTo(thread.chat, false)}>Switch to chat</Btn>
      </div>
      <Term stream={thread.chat} fill />
    </>
  )
}

function switchTo(chat: string, on: boolean) {
  setUI((ui) => ({ aterm: { ...ui.aterm, [chat]: on } }))
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
      <Btn small onClick={() => { if (open) setUI({ task: open.id, pane: 'tasks', wide: false }); switchTo(chat, true) }}>Switch to terminal</Btn>
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
    reg.drawer.push({ when: (ui, thread) => !ui.phone && (thread.task ? ui.tterm : ui.term), View: Drawer })
    reg.chatBody.push({ when: (ui, thread) => !!ui.aterm[thread.chat], View: AgentTerminal })
    reg.chatTail.push({ order: 25, View: Stuck })
    // Terminal opens your own shell; Switch to terminal swaps the agent's chat for its live terminal
    reg.spaceMenu.push({ order: 5, rows: (_p, head) => (head ? [spaceTermRow(getState().ui)] : []) })
    reg.taskMenu.push({ order: 5, rows: (t, where) => (where === 'thread' ? [taskTermRow(getState().ui, t.id)] : []) })
    reg.spaceMenu.push({ order: 10, rows: (p) => [{ icon: 'term', label: getState().ui.aterm[p.chat] ? 'Switch to chat' : 'Switch to terminal', run: () => switchTo(p.chat, !getState().ui.aterm[p.chat]) }] })
    reg.taskMenu.push({ order: 10, rows: (t, where) => (where === 'thread' ? [{ icon: 'term', label: getState().ui.aterm[taskChat(t)] ? 'Switch to chat' : 'Switch to terminal', run: () => switchTo(taskChat(t), !getState().ui.aterm[taskChat(t)]) }] : []) })
    reg.keys.push({
      order: 20,
      handle: (e) => {
        if (!(e.ctrlKey && e.key === '`')) return false
        toggleSpaceTerm()
        return true
      },
    })
  },
})

export { useMemo }
