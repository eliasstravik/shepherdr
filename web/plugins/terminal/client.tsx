// Terminals. Your own: one per space, a real shell in the space's folder on its machine, in a dark drawer at the very
// bottom, below the message box (the whole screen on a phone); Ctrl+` toggles it; a task has one too, in its folder.
// It keeps running when the drawer is closed. An agent's own terminal is tucked in a menu: "Switch to terminal" swaps
// a chat for the same session's live terminal, with a bar on top to switch back. Every terminal is a real one you
// type straight into; on a phone a row of keys sits under it: esc, tab, ctrl and the arrows.
import { useEffect, useMemo, useRef, useState } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { definePlugin, getState, setUI, useSnap, useUI, type Thread } from '@client/kernel.ts'
import { Btn, Hd, I, IB } from '@client/ui.tsx'
import type { Chat, Task } from '@shared/types.ts'
import { machineLabel, placeOf, taskChat, taskOf, tasksIn, tstate } from '@shared/view.ts'
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

/** A real terminal (xterm.js) you type straight into. It is drawn at the terminal's own size, so nothing wraps: the
 *  font shrinks to fit the width down to 8 px, then the screen pans sideways. */
function Term({ stream, fill }: { stream: string; fill?: boolean }) {
  const phone = useUI((u) => u.phone)
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const cap = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('Opening the terminal…')
  const [ctrl, setCtrl] = useState(false)
  const ctrlRef = useRef(false)
  ctrlRef.current = ctrl

  useEffect(() => {
    let gone = false
    let term: import('@xterm/xterm').Terminal | null = null
    let link: { close(): void } | null = null
    let cols = 80
    const own = stream.startsWith('sh:')
    let asked = ''
    const fit = () => {
      if (!term || !box.current) return
      const w = box.current.clientWidth - 16
      if (own) {
        // your own terminal takes the drawer's size: as many columns and rows as fit at the normal font
        const c = Math.max(20, Math.floor(w / (13 * cellOf(MONO))))
        const r = Math.max(5, Math.floor((box.current.clientHeight - 16) / (13 * 1.25)))
        if (`${c}x${r}` !== asked && opened) {
          asked = `${c}x${r}`
          streamInput(stream, { type: 'resize', cols: c, rows: r })
        }
        return
      }
      term.options.fontSize = Math.max(8, Math.min(13, Math.floor((w / (cols * cellOf(MONO))) * 4) / 4))
    }
    let opened = false
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-unicode11')]).then(([{ Terminal }, { Unicode11Addon }]) => {
      if (gone || !host.current) return
      term = new Terminal({ cols: 80, rows: 24, scrollback: 2000, disableStdin: true, cursorBlink: true, fontFamily: MONO, fontSize: 13, lineHeight: 1.25, allowProposedApi: true, theme: { background: '#0a0a0a', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: 'rgb(255 255 255 / 0.25)' } })
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
        (bytes, done) => term!.write(bytes, done),
        () => term!.reset(),
        (c, r) => {
          cols = c
          term!.resize(c, r)
          opened = true
          fit()
        },
        setStatus,
      )
      fit()
    })
    const ro = new ResizeObserver(fit)
    if (box.current) ro.observe(box.current)
    return () => {
      gone = true
      ro.disconnect()
      link?.close()
      term?.dispose()
    }
  }, [stream])

  const sendKey = (k: string) => {
    streamInput(stream, { type: 'keys', keys: [k] })
    cap.current?.focus()
  }
  return (
    <>
      <div className="tw" style={fill ? { flex: 1, display: 'flex', flexDirection: 'column' } : undefined}>
        <div ref={box} className={fill ? 'termbox fill' : 'termbox'} data-term={stream}>
          <div ref={host} style={{ height: '100%' }} />
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
      {phone && (
        <div className="keys">
          {([['esc', 'esc'], ['tab', 'tab']] as const).map(([l, k]) => <button type="button" key={l} aria-label={`${l} key`} onClick={() => sendKey(k)}>{l}</button>)}
          <button type="button" aria-label="ctrl key" aria-pressed={ctrl} style={ctrl ? { background: 'rgb(255 255 255/.3)' } : undefined} onClick={() => { setCtrl(!ctrl); cap.current?.focus() }}>ctrl</button>
          {([['←', 'left'], ['↑', 'up'], ['↓', 'down'], ['→', 'right']] as const).map(([l, k]) => <button type="button" key={k} aria-label={`${k} arrow key`} onClick={() => sendKey(k)}>{l}</button>)}
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

/** the Terminal button of a chat's header */
function TermButton({ thread }: { thread: Thread }) {
  const ui = useUI()
  return <IB icon="term" label="Terminal" pressed={ui.phone ? ui.pane === 'terminal' && !ui.termTask : ui.term} onClick={() => toggle()} />
}
function toggle() {
  const { ui } = getState()
  if (ui.phone) setUI({ pane: ui.pane === 'terminal' ? null : 'terminal', termTask: false })
  else setUI({ term: !ui.term })
}

/** the Terminal button of an open task */
function TaskTermButton({ thread }: { thread: Thread }) {
  const ui = useUI()
  return <IB icon="term" label="Terminal" pressed={ui.phone ? false : ui.tterm} onClick={() => (ui.phone ? setUI({ pane: 'terminal', termTask: true, task: thread.task!.id }) : setUI({ tterm: !ui.tterm }))} />
}

/** "Waiting at a prompt": an agent's session waits for input that is not one of the app's own cards. Never raised by
 *  reading the agent's screen: it is what a blocked report with no kind looks like. It opens the agent's terminal. */
function Stuck({ thread }: { chat: Chat | undefined; thread: Thread }) {
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
      {p?.needs && getState().chats[thread.chat]?.blocked === 'prompt' && banner('own', 'Waiting at a prompt', thread.chat)}
      {tasksIn(snap, thread.place).filter(stuck).map((t) => banner(t.id, `${t.name} is waiting at a prompt`, taskChat(t), t))}
    </>
  )
}

export default definePlugin({
  name: 'terminal',
  setup(reg) {
    reg.header.push({ order: 10, phone: true, View: TermButton })
    reg.taskHeader.push({ order: 10, View: TaskTermButton })
    reg.panes.push({ id: 'terminal', View: TerminalPane })
    reg.drawer.push({ when: (ui, thread) => !ui.phone && (thread.task ? ui.tterm : ui.term), View: Drawer })
    reg.chatBody.push({ when: (ui, thread) => !!ui.aterm[thread.chat], View: AgentTerminal })
    reg.chatTail.push({ order: 25, View: Stuck })
    reg.spaceMenu.push({ order: 10, rows: (p) => [{ icon: 'term', label: getState().ui.aterm[p.chat] ? 'Switch to chat' : 'Switch to terminal', run: () => switchTo(p.chat, !getState().ui.aterm[p.chat]) }] })
    reg.taskMenu.push({ order: 10, rows: (t, where) => (where === 'thread' ? [{ icon: 'term', label: getState().ui.aterm[taskChat(t)] ? 'Switch to chat' : 'Switch to terminal', run: () => switchTo(taskChat(t), !getState().ui.aterm[taskChat(t)]) }] : []) })
    reg.keys.push({
      order: 20,
      handle: (e) => {
        if (!(e.ctrlKey && e.key === '`')) return false
        toggle()
        return true
      },
    })
  },
})

export { useMemo }
