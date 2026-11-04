import { Search } from './search.tsx'
// Keys, as the window's: Herdr's and Shepherdr's keys (keys.json) that mean something on the web, under the window's
// Keybinds names (Ctrl+Shift+? lists them). Those a browser keeps for itself (Ctrl+Tab, Ctrl+1–9, Ctrl+Shift+N, T, W)
// stay the window's. Ctrl+K jumps.
import { closeArtifact, definePlugin, has, keysChat, setUI, togglePlaces, type UI } from '@client/kernel.ts'
import { toggleDictation } from '@plugins/chat/client.tsx'
import { openFind } from '@plugins/chat/find.tsx'
import { toggleCall } from '@plugins/voice/client.tsx'
import { ALT, CTRL, Kbd, KeyboardIcon, SHIFT } from '@client/ui.tsx'
import { rowLook, sectionOf } from '@client/Settings.tsx'

/** the Keybinds list: each section's keys and the window's words for them */
export const KEYS: [string, [string[], string][]][] = [
  ['Tabs', [
    [[ALT, '1–9'], 'Tab 1–9'],
    [[ALT, '→'], 'Next tab'],
    [[ALT, '←'], 'Previous tab'],
    [[ALT, ']'], 'Next tab'],
    [[ALT, '['], 'Previous tab'],
  ]],
  ['Spaces', [
    [[ALT, '↓'], 'Next space'],
    [[ALT, '↑'], 'Previous space'],
    [[SHIFT, 'F2'], 'Rename space'],
  ]],
  ['App', [
    [[CTRL, 'K'], 'Jump to a space, task or artifact'],
    [[CTRL, SHIFT, 'K'], 'Jump to a space, task or artifact'],
    [[CTRL, SHIFT, '?'], 'Keybinds'],
    [[CTRL, SHIFT, 'B'], 'Show or hide the sidebar'],
    [[CTRL, ','], 'Settings'],
    [[CTRL, 'F'], 'Find in the chat'],
    [[CTRL, SHIFT, 'D'], 'Dictate'],
    [[CTRL, SHIFT, 'Space'], 'Start a call'],
  ]],
]

const SHORTCUTS = 'Keybinds'

/** Settings' Keybinds page (a desktop's): each section's keys beside what they do, in Settings' own rows */
function Shortcuts({ phone }: { phone: boolean }) {
  return (
    <div className="flex w-full flex-col gap-5">
      {KEYS.map(([section, keys]) => (
        <section key={section}>
          <h3 className="pb-1 text-[0.75rem] font-medium text-fg3">{section}</h3>
          <dl className="w-full">
            {keys.map(([k, l]) => (
              <div key={k.join('+')} className={rowLook(phone)}>
                <dt className="min-w-0">{l}</dt>
                <dd className="shrink-0">
                  <Kbd keys={k} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/* ---------- keys ---------- */

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement
  return el?.closest?.('input, textarea, select, [contenteditable=true]')
}

/** Esc: what is open on top closes, as the window's overlays */
function back(ui: UI): Partial<UI> | null {
  if (ui.adding) return { adding: false }
  if (ui.drawer) return { drawer: false }
  if (ui.settings) return { settings: null }
  if (ui.plus) return { plus: null }
  if (ui.menu) return { menu: false }
  if (ui.photo) return { photo: null }
  if (ui.viewer) return (closeArtifact(), {})
  if (ui.pick) return { pick: null }
  if (ui.task) return { task: null }
  if (ui.archived) return { archived: null }
  return null
}

export default definePlugin({
  name: 'keyboard',
  setup(reg) {
    // a desktop's, and a tablet's once a key was pressed on it (an iPad with a keyboard)
    reg.settingsPages.push({ name: SHORTCUTS, about: 'The keys that work here. Others are the Herdr window\'s.', Icon: KeyboardIcon, when: (ui) => ui.device === 'desktop' || (ui.device === 'tablet' && ui.kb), View: Shortcuts })
    reg.views.search = Search
    reg.keys.push({
      order: 10,
      handle: ({ e, ui, snap }) => {
        // 3.0's window keys that work while typing too
        const chatNow = () => keysChat(ui, snap)
        if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyD') {
          e.preventDefault()
          toggleDictation(chatNow())
          return true
        }
        if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'Space' && has('voice')) {
          e.preventDefault()
          toggleCall(chatNow())
          return true
        }
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyF') {
          e.preventDefault()
          openFind(chatNow())
          return true
        }
        if (e.ctrlKey && e.shiftKey && (e.code === 'Slash' || e.key === '?')) {
          const section = sectionOf(SHORTCUTS, snap.settings, { ...ui, kb: true })
          if (section < 0) return false
          e.preventDefault()
          setUI({ settings: ui.settings?.section === section ? null : { section }, kb: true })
          return true
        }
        if (e.shiftKey && e.key === 'F2') {
          e.preventDefault()
          dispatchEvent(new CustomEvent('shepherdr:rename', { detail: ui.place }))
          return true
        }
        // Alt+1–9 and Alt+←/→: the space's tabs, its chat first, then each other tab's terminal (3.0's tab bar)
        if (e.altKey && !e.ctrlKey && !e.metaKey && (/^Digit[1-9]$/.test(e.code) || e.code === 'BracketLeft' || e.code === 'BracketRight' || (!typing(e) && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')))) {
          const place = snap.places.find((p) => p.id === ui.place)
          if (!place) return false
          const tabs = [null, ...(place.tabs ?? []).map((t) => t.term)]
          const now = Math.max(0, tabs.indexOf(ui.term?.startsWith('t:') ? ui.term : null))
          const to = e.code.startsWith('Digit') ? Number(e.code.slice(5)) - 1 : (now + (e.code === 'ArrowRight' || e.code === 'BracketRight' ? 1 : tabs.length - 1)) % tabs.length
          if (to >= tabs.length) return false
          e.preventDefault()
          setUI({ term: tabs[to], task: null, arts: null, menu: false, plus: null, pick: null, kb: true })
          return true
        }
        // Ctrl+K and Ctrl+Shift+K: Jump (⌘K on a Mac too)
        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'KeyK') {
          e.preventDefault()
          setUI({ search: !ui.search, searchScope: undefined, focus: null })
          return true
        }
        // Jump keeps Esc to itself
        if (ui.search) {
          if (e.key !== 'Escape') return false
          e.preventDefault()
          setUI({ search: false })
          return true
        }
        if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyB') {
          e.preventDefault()
          // a tablet's spaces are in its drawer
          if (ui.device === 'desktop') togglePlaces()
          else setUI({ drawer: !ui.drawer })
          return true
        }
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === ',') {
          e.preventDefault()
          setUI({ settings: ui.settings ? null : { section: ui.device === 'phone' ? null : 0 }, kb: true })
          return true
        }
        if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const b = back(ui)
          if (!b) return false
          e.preventDefault()
          setUI({ ...b, kb: true })
          return true
        }
        if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return false
        // F: the shown list's filter (Tasks, Artifacts), as the window's panels
        if (e.key === 'f' || e.key === 'F') {
          const box = document.querySelector<HTMLInputElement>('input[name=filter]')
          if (!box) return false
          e.preventDefault()
          box.focus()
          return true
        }
        return false
      },
    })
  },
})
