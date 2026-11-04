// Terminal: an agent's live herdr terminal. A task's is an item of its side panel (a tab beside its chat on a desktop,
// a sheet from the task header's ⋯ on a phone); a coordinator's flips its chat, from the Terminal row of its top-right
// menu. Ctrl+` opens either on a desktop. Every key goes in, Esc too: in a coordinator's while it shows, in a task's
// while its screen has the focus (a click puts it there); Ctrl+` goes back to the chat. A phone gets a key row.
import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react'
import type { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { act, agentChat, definePlugin, getState, openItem, placeOf, setUI, shownItem, useStore, useUI } from '@client/kernel.ts'
import { CTRL, ic, MenuItem, shortcut, Small, TermIcon } from '@client/ui.tsx'
import type { Place, TermScreen } from '@shared/types.ts'
import { connectTerminal, streamInput } from './stream.ts'
import { colsOf, fitFont, foldShown, frame, LINE, MAX, MIN, PAD, ZOOM } from './screen.ts'

const KEYMAP: Record<string, string> = {
  Enter: 'enter',
  Escape: 'esc',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
}

/** a browser key event as herdr's key name, or text to type */
export function toKey(e: KeyboardEvent): { keys?: string[]; text?: string } | null {
  if (KEYMAP[e.key]) return { keys: [(e.shiftKey && e.key === 'Tab' ? 'shift+' : '') + KEYMAP[e.key]] }
  if (e.ctrlKey && e.key.length === 1) return { keys: [`ctrl+${e.key.toLowerCase()}`] }
  if (e.altKey && e.key.length === 1) return { keys: [`alt+${e.key.toLowerCase()}`] }
  if (e.key.length === 1 && !e.metaKey) return { text: e.key }
  return null
}

function terminalInput(chat: string, message: Parameters<typeof streamInput>[1]) {
  if (getState().snap?.terminalTransport === 'core') streamInput(chat, message)
  else act({ ...message, chat })
}

/** the task terminal's screen in the side panel: focused, every key goes into it */
const SCREEN = '[data-term-screen]'

/** one cell's width per px of font size, for the monospace font */
let cellRatio = 0
function cellOf(family: string) {
  if (cellRatio) return cellRatio
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return 0.6
  c.font = `100px ${family}`
  return (cellRatio = c.measureText('M'.repeat(20)).width / 2000 || 0.6)
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** The CLI's screen drawn by a real terminal (xterm.js), read only, at the pane's own columns: nothing wraps. The view
 *  fits the terminal, never the other way round: the agent draws for its own size whoever watches, so opening or
 *  resizing a view disturbs nobody. The font scales so the width fits; too small, it stops at MIN and the screen pans
 *  sideways. A pinch (or Ctrl and the wheel) zooms. */
function Screen({ screen, stream, className, ...p }: { screen: TermScreen | undefined; stream?: string } & HTMLAttributes<HTMLDivElement>) {
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [term, setTerm] = useState<Terminal | null>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null)
  /** following the newest line: scrolled to the bottom (and kept there as lines come in) */
  const stuck = useRef(true)
  const [streamStatus, setStreamStatus] = useState('Reading the terminal…')
  /** the live terminal's own columns, as the server says them */
  const [streamCols, setStreamCols] = useState<number | null>(null)
  const cols = stream ? streamCols ?? 80 : screen ? colsOf(screen) : 80
  const family = useMemo(() => css('--font-mono') || 'monospace', [])
  const whole = width ? fitFont(width, cols, cellOf(family)) : MAX
  const font = zoom ?? Math.min(MAX, Math.max(MIN, whole))
  // the font a pinch started from, and the fingers' distance then
  const pinch = useRef<{ d: number; font: number } | null>(null)
  // the pinch handlers read the size now, and zoom from the whole width up to ZOOM
  const fontRef = useRef(font)
  fontRef.current = font
  const low = useRef(MIN)
  low.current = Math.min(MIN, whole)
  const zoomTo = (f: number) => setZoom(Math.round(Math.min(ZOOM, Math.max(low.current, f)) * 4) / 4)

  useEffect(() => {
    let gone = false
    let made: Terminal | null = null
    Promise.all([import('@xterm/xterm'), import('@xterm/addon-unicode11')]).then(([{ Terminal }, { Unicode11Addon }]) => {
      if (gone || !host.current) return
      const ansi = ['0', '1', '2', '3', '4', '5', '6', '7'].map((n) => css(`--ansi-${n}`))
      const bright = ['0', '1', '2', '3', '4', '5', '6', '7'].map((n) => css(`--ansi-${n}b`))
      const [black, red, green, yellow, blue, magenta, cyan, white] = ansi
      const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = bright
      made = new Terminal({
        cols: 80,
        rows: stream ? 24 : 1,
        scrollback: stream ? 2000 : 0,
        disableStdin: true,
        cursorBlink: false,
        fontFamily: family,
        fontSize: MAX,
        lineHeight: LINE,
        allowProposedApi: true,
        theme: {
          background: css('--term'),
          foreground: css('--term-fg'),
          selectionBackground: 'rgb(255 255 255 / 0.25)',
          black, red, green, yellow, blue, magenta, cyan, white,
          brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
        },
      })
      made.loadAddon(new Unicode11Addon())
      made.unicode.activeVersion = '11'
      // keys go to herdr by Shepherdr's own handler; the terminal only draws
      made.attachCustomKeyEventHandler(() => false)
      // and the wheel scrolls (or, with Ctrl, zooms) the box around it: left to xterm, it would turn into arrow keys
      made.attachCustomWheelEventHandler(() => false)
      made.open(host.current)
      // its own input box never takes the keyboard: a tap on a phone types through the key row's box
      if (made.textarea) {
        made.textarea.readOnly = true
        made.textarea.tabIndex = -1
      }
      setTerm(made)
    })
    return () => {
      gone = true
      made?.dispose()
    }
  }, [family, stream])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    const onScroll = () => (stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4)
    el.addEventListener('scroll', onScroll, { passive: true })
    // two fingers zoom; the page itself never does
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch.current = { d: dist(e.touches), font: fontRef.current }
    }
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return
      e.preventDefault()
      zoomTo(pinch.current.font * (dist(e.touches) / pinch.current.d))
    }
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null
    }
    // a trackpad's pinch comes as Ctrl and the wheel
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomTo(fontRef.current * Math.exp(-e.deltaY / 100))
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end, { passive: true })
    el.addEventListener('touchcancel', end, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      el.removeEventListener('wheel', wheel)
    }
  }, [])

  const bottom = () => {
    if (stuck.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }
  /** a live terminal's blank rows fold away, its rows staying where it drew them, and the view follows its last line */
  const fit = (t: Terminal) => {
    const rows = t.element?.querySelectorAll<HTMLElement>('.xterm-rows > div'), drawn = t.element?.querySelector<HTMLElement>('.xterm-screen')
    if (host.current && rows?.length && drawn) host.current.style.height = `${(drawn.offsetHeight / t.rows) * foldShown(t, rows)}px`
    bottom()
  }
  useEffect(() => {
    if (!term) return
    term.options.fontSize = font
    requestAnimationFrame(() => (stream ? fit(term) : bottom()))
  }, [term, font, stream])
  useEffect(() => {
    if (!term || !screen || stream) return
    const { rows, data } = frame(screen.ansi)
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows)
    term.write(data, () => requestAnimationFrame(bottom))
  }, [term, screen, cols, stream])

  useEffect(() => {
    if (!term || !stream) return
    // every draw: new output, or the history scrolled to
    const drawn = term.onRender(() => fit(term))
    const connection = connectTerminal(stream, (bytes, done) => term.write(bytes, done), () => term.reset(), (cols, rows) => {
      // in turn with what was written before it: a first paint at this size comes next
      term.write('', () => { term.reset(); term.resize(cols, rows); setStreamCols(cols) })
    }, setStreamStatus)
    return () => { drawn.dispose(); connection.close() }
  }, [term, stream])

  return (
    <div
      ref={box}
      {...p}
      data-cols={cols}
      data-font={font}
      className={clsx('term-screen min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto bg-term', className)}
      style={{ padding: PAD }}
    >
      <div ref={host} className="w-max overflow-hidden" />
      {stream ? (streamStatus ? <div className="text-[0.75rem] text-(--ansi-0b)">{streamStatus}</div> : null) : screen ? null : <div className="text-[0.75rem] text-(--ansi-0b) phone:text-[0.8125rem]">Reading the terminal…</div>}
    </div>
  )
}

function TerminalView({ chatKey, panel }: { chatKey: string; panel?: boolean }) {
  const ui = useUI()
  const screen = useStore((s) => s.terms[chatKey])
  const streaming = useStore((s) => s.snap?.terminalTransport === 'core')
  const input = useRef<HTMLTextAreaElement>(null)
  const phone = ui.device === 'phone'
  // a mouse or keyboard types into a task's terminal while its screen has the focus; a finger, through the hidden box
  const typed = panel && !phone && ui.device === 'desktop'
  const touch = phone || (panel && !typed)
  const keys = (keys: string[]) => terminalInput(chatKey, { type: 'keys', keys })
  return (
    <>
      <Screen
        key={chatKey}
        screen={screen}
        stream={streaming ? chatKey : undefined}
        role="log"
        aria-label="Terminal"
        tabIndex={typed ? 0 : undefined}
        data-term-screen={typed ? chatKey : undefined}
        onClick={(e) => (touch ? input.current?.focus() : typed && (e.currentTarget as HTMLElement).focus())}
        className={clsx(typed && 'cursor-text focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-line2')}
      />
      {touch ? (
        <>
          <textarea
            ref={input}
            name="terminal-input"
            aria-label="Type into the terminal"
            autoCapitalize="off"
            autoCorrect="off"
            className="pointer-events-none absolute size-px opacity-0"
            value=""
            onChange={(e) => e.target.value && terminalInput(chatKey, { type: 'text', text: e.target.value })}
            onKeyDown={(e) => {
              // a tablet's keyboard: Ctrl keys go in as on a desktop (Alt alone, or AltGr's Ctrl+Alt, types its character)
              if (e.ctrlKey && !e.altKey) {
                const t = toKey(e.nativeEvent)
                if (t?.keys) {
                  e.preventDefault()
                  keys(t.keys)
                }
                return
              }
              const k = KEYMAP[e.key]
              if (k) {
                e.preventDefault()
                keys([k])
              }
            }}
          />
          {/* a bar of keys, as the browser's keyboard bar */}
          <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
            {(
              [
                ['Esc', 'esc'],
                ['Tab', 'tab'],
                ['↑', 'up'],
                ['↓', 'down'],
                ['Ctrl-C', 'ctrl+c'],
                ['Enter', 'enter'],
              ] as const
            ).map(([l, k]) => (
              <button key={l} type="button" onClick={() => keys([k])} className="press-dim h-11 min-w-12 rounded-full bg-bubble px-3 text-[0.875rem] font-medium">
                {l}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <Small className={clsx('truncate px-4 pb-3 text-fg3', touch ? 'pt-0.5' : 'pt-2')}>
        {touch ? 'Tap to type · pinch to zoom' : `${typed ? 'Click to type' : 'Keys go to the terminal'} · ${shortcut(CTRL, '`')} back to the chat`}
      </Small>
    </>
  )
}

function PlaceTerm({ place }: { place: Place }) {
  const ui = useUI()
  const on = ui.term === place.chat
  return (
    <MenuItem
      icon={<TermIcon className={ic} />}
      hint={ui.device === 'desktop' ? shortcut(CTRL, '`') : null}
      onClick={() => setUI({ term: on ? null : place.chat, arts: null, menu: false, plus: null, pick: null })}
    >
      {on ? 'Back to the chat' : 'Terminal'}
    </MenuItem>
  )
}

/** back to the task's chat from its terminal: its message box takes the focus */
function toChat(chat: string) {
  ;(document.activeElement as HTMLElement | null)?.blur()
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`textarea[name=message][data-chat="${CSS.escape(chat)}"]`)?.focus())
}

export default definePlugin({
  name: 'terminal',
  setup(reg) {
    reg.placeMenu.push({ order: 60, View: PlaceTerm })
    reg.taskPanel.push({ id: 'terminal', order: 10, label: 'Terminal', Icon: TermIcon, View: ({ chatKey }) => <TerminalView chatKey={chatKey} panel /> })
    reg.chatBody.push({ when: (ui, key) => ui.term === key, View: TerminalView })
    reg.keys.push({
      order: 0,
      handle: ({ e, ui, snap }) => {
        if (ui.device !== 'desktop') return false
        const task = agentChat(ui, snap)?.chat
        const focused = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(SCREEN)?.dataset.termScreen
        if (e.ctrlKey && e.key === '`') {
          e.preventDefault()
          // a task's: its panel opens on the terminal, which takes the focus; pressed in it, back to the chat
          if (task && !ui.term) {
            if (focused) return toChat(task), true
            openItem('terminal')
            requestAnimationFrame(() => document.querySelector<HTMLElement>(SCREEN)?.focus())
            return true
          }
          const c = placeOf(snap, ui.place).chat
          setUI({ term: ui.term === c ? null : c, arts: null, kb: true })
          return true
        }
        if (focused && shownItem(getState().ui, snap) === 'terminal') {
          const k = toKey(e)
          if (!k) return true
          e.preventDefault()
          if (k.keys) terminalInput(focused, { type: 'keys', keys: k.keys })
          else if (k.text) terminalInput(focused, { type: 'text', text: k.text })
          return true
        }
        if (!ui.term) return false
        const k = toKey(e)
        if (!k) return true
        e.preventDefault()
        if (k.keys) terminalInput(ui.term, { type: 'keys', keys: k.keys })
        else if (k.text) terminalInput(ui.term, { type: 'text', text: k.text })
        return true
      },
    })
  },
})
