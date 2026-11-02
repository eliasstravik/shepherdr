import { Search } from './search.tsx'
// Keyboard: on a desktop everything works without a mouse. ? opens the list of keys in Settings; ⌘K (Ctrl+K off a Mac) searches and jumps.
import {
  closeArtifact,
  definePlugin,
  getState,
  panelHere,
  has,
  keysChat,
  listView,
  orderedTasks,
  shownPlaces,
  setUI,
  taskOf,
  toggleFocus,
  togglePlaces,
  toggleWide,
  type UI,
} from '@client/kernel.ts'
import { keysMoved } from '@client/focus.ts'
import { toggleDictation } from '@plugins/chat/client.tsx'
import { ALT, CTRL, Kbd, KeyboardIcon, MOD, SHIFT } from '@client/ui.tsx'
import { rowLook, sectionOf } from '@client/Settings.tsx'
import type { Snapshot } from '@shared/types.ts'

export const KEYS: [string[], string][] = [
  [['↑', '↓'], 'Move in tasks (or J, K)'],
  [['Enter'], 'Open'],
  [['Esc'], 'Back'],
  [['[', ']'], 'Previous or next space'],
  [[ALT, '↑', '↓'], 'Space above or below in Spaces, from the message box too'],
  [[ALT, SHIFT, '↑', '↓'], 'Move a focused machine or space up or down'],
  [[MOD, 'K'], 'Search and jump'],
  [[MOD, 'B'], 'Show or hide Spaces'],
  [[MOD, 'Click'], 'Open a space, task or artifact in split view'],
  [['F'], "Focus on a task: hide its coordinator's chat, or show it again"],
  [[SHIFT, 'F'], 'Widen the Task panel, or narrow it again'],
  [['/'], 'Write a message'],
  [['F'], 'Filter the tasks or artifacts (Esc clears it)'],
  [['T'], 'Talk to type: Enter puts it in the box, Esc drops it'],
  [['V'], 'Voice call (V again ends it)'],
  [['M'], 'Mute or unmute the call'],
  [['E'], 'React to the last message'],
  [[CTRL, '`'], "Terminal and back: a task's in its Task panel"],
  [[','], 'Settings'],
  [['N'], 'New space'],
  [['A'], 'Attach a file'],
  [['Tab'], 'Move through buttons, form choices and Send'],
  [['?'], 'These shortcuts'],
]

const SHORTCUTS = 'Keyboard shortcuts'

/** Settings' Keyboard shortcuts page (a desktop's): each key beside what it does, in Settings' own rows */
function Shortcuts({ phone }: { phone: boolean }) {
  return (
    <dl className="w-full">
      {KEYS.map(([k, l]) => (
        <div key={l} className={rowLook(phone)}>
          <dt className="min-w-0">{l}</dt>
          <dd className="shrink-0">
            <Kbd keys={k} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ---------- keys ---------- */

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement
  return el?.closest?.('input, textarea, select, [contenteditable=true]')
}

function back(ui: UI, snap: Snapshot): Partial<UI> | null {
  if (ui.adding) return { adding: false }
  if (ui.drawer) return { drawer: false }
  if (ui.settings) return { settings: null }
  if (ui.plus) return { plus: null }
  if (ui.menu) return { menu: false }
  if (ui.photo) return { photo: null }
  if (ui.viewer) return (closeArtifact(), {})
  if (ui.pick) return { pick: null }
  if (ui.focus) return { focus: null }
  if (ui.task) return { cur: Math.max(0, orderedTasks(snap, listView(ui, snap)).findIndex((t) => t.id === ui.task)), task: null }
  if (ui.archived) return { archived: null, cur: 0 }
  return null
}

export default definePlugin({
  name: 'keyboard',
  setup(reg) {
    // a desktop's, and a tablet's once a key was pressed on it (an iPad with a keyboard)
    reg.settingsPages.push({ name: SHORTCUTS, about: 'Everything works without a mouse.', Icon: KeyboardIcon, when: (ui) => ui.device === 'desktop' || (ui.device === 'tablet' && ui.kb), View: Shortcuts })
    reg.views.search = Search
    reg.keys.push({
      order: 10,
      handle: ({ e, ui, snap }) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault()
          setUI({ search: !ui.search, searchScope: undefined, focus: null })
          return true
        }
        // a key pressed is a keyboard's: a tablet's (an iPad with one) gets the keys a desktop has
        if (ui.search) {
          // Esc closes it wherever the focus is in it (its x, its list), not only from the box
          if (e.key !== 'Escape') return false
          e.preventDefault()
          setUI({ search: false })
          return true
        }
        // works while typing too, like ⌘K: the message box has no bold
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
          e.preventDefault()
          // a tablet's places are in its drawer
          if (ui.device === 'desktop') togglePlaces()
          else setUI({ drawer: !ui.drawer })
          return true
        }
        if (typing(e)) return false
        if (e.metaKey || e.ctrlKey || e.altKey) return false
        const k = e.key
        const go = (p: Partial<UI>) => {
          e.preventDefault()
          setUI({ ...p, kb: true })
          return true
        }
        // the Add a project dialog keeps the keys to itself
        if (ui.adding) return k === 'Escape' ? go({ adding: false }) : false
        const task = taskOf(snap, ui.task)
        const list = task ? null : orderedTasks(snap, listView(ui, snap))
        if (k === '?') {
          // Settings at its Keyboard shortcuts page, and shut again from there
          const section = sectionOf(SHORTCUTS, snap.settings, { ...ui, kb: true })
          if (section < 0) return false
          return go({ settings: ui.settings?.section === section ? null : { section } })
        }
        if (k === 'Escape') {
          const b = back(ui, snap)
          return b ? go(b) : false
        }
        // an artifact full screen keeps the keys: the chat behind it is out of reach
        if (ui.viewer) return false
        const move = (cur: number) => (keysMoved('cursor'), go({ cur }))
        if ((k === 'ArrowDown' || k === 'j') && list) return move(Math.min(list.length - 1, ui.cur + 1))
        if ((k === 'ArrowUp' || k === 'k') && list) return move(Math.max(0, ui.cur - 1))
        if (k === 'Enter' && list && list[ui.cur] && !(e.target as HTMLElement)?.closest?.('button, a, [role=button]')) return go({ task: list[ui.cur].id, cur: 0 })
        if (k === '[' || k === ']') {
          const places = shownPlaces(snap)
          const i = places.findIndex((p) => p.id === ui.place)
          const n = places.length
          return go({ place: places[(i + (k === ']' ? 1 : n - 1)) % n].id, task: null, cur: 0 })
        }
        if (k === 'n' && has('places')) return go({ adding: true })
        if (k === 'f' && task && ui.device !== 'phone') {
          e.preventDefault()
          toggleFocus()
          return true
        }
        if (k === 'F' && panelHere(ui, snap)) {
          e.preventDefault()
          toggleWide()
          return true
        }
        if (k === ',') return go({ settings: ui.settings ? null : { section: ui.device === 'phone' ? null : 0 } })
        // split, the focused pane's
        const chatKey = keysChat(ui, snap)
        if (k === '/') return go({ focus: chatKey })
        if (k === 'f' && !task) {
          const box = document.querySelector<HTMLInputElement>('input[name=filter]')
          if (!box) return false
          e.preventDefault()
          box.focus()
          return true
        }
        if (k === 't') {
          e.preventDefault()
          toggleDictation(chatKey)
          return true
        }
        if (k === 'a') {
          e.preventDefault()
          setUI({ plus: chatKey, kb: true })
          setTimeout(() => document.querySelector<HTMLInputElement>(`input[name=file][data-chat="${CSS.escape(chatKey)}"]`)?.click(), 0)
          return true
        }
        if (k === 'e') {
          const msgs = getState().chats[chatKey]?.messages ?? []
          const m = [...msgs].reverse().find((x) => x.who === 'agent')
          return m ? go({ pick: ui.pick === m.id ? null : m.id }) : false
        }
        return false
      },
    })
  },
})
