import { Search } from './search.tsx'
// Keys, as the window's: Herdr's and Shepherdr's keys (keys.json) that mean something on the web, under the window's
// Keybinds names (core/keys.js; Ctrl+Shift+? or the tab bar's menu opens the Keybinds dialog). Those a browser keeps
// for itself (Ctrl+Tab, Ctrl+1–9, Ctrl+Shift+N, T, W) stay the window's. Ctrl+K jumps.
import { useState, useSyncExternalStore } from 'react'
import { closeArtifact, definePlugin, has, keysChat, setUI, togglePlaces, type UI } from '@client/kernel.ts'
import { toggleDictation } from '@plugins/chat/client.tsx'
import { openFind } from '@plugins/chat/find.tsx'
import { toggleCall } from '@plugins/voice/client.tsx'
import { ic, SearchIcon } from '@client/ui.tsx'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import * as K from '@core/keys.js'

const { grouped, flatKeys, keyFound, KEYBINDS, WEB_KEYS } = K as any
const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

/** the Keybinds list, as the window's dialog groups and names it: [{ group, rows: [{ name, keys }] }] */
export const KEYS: { group: string; rows: { name: string; keys: string[] }[] }[] = grouped(flatKeys(WEB_KEYS), { layout: 'BossGoat', mac: apple })

/* the Keybinds dialog (the window's mods/keybinds): open or not, on this page */
let keybindsOpen = false
const keybindsListeners = new Set<() => void>()
/** Open (or close) the Keybinds dialog: Ctrl+Shift+? and the tab bar's menu's "Keybinds" */
export function openKeybinds(on = true) {
  keybindsOpen = on
  keybindsListeners.forEach((l) => l())
}

/** The window's Keybinds dialog: "Keybinds", "Filter keys", each group's keys beside what they do, "No keys match." */
function Keybinds() {
  const open = useSyncExternalStore((l) => (keybindsListeners.add(l), () => void keybindsListeners.delete(l)), () => keybindsOpen)
  const [filter, setFilter] = useState('')
  if (!open) return null
  const close = () => {
    setFilter('')
    openKeybinds(false)
  }
  const groups = KEYS.map((g) => ({ ...g, rows: g.rows.filter((r) => keyFound(filter, g.group, r)) })).filter((g) => g.rows.length)
  return (
    <Sheet label={KEYBINDS.title} onClose={close} panel="max-w-[560px] desktop:max-h-[620px]">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3.5 pb-2">
        <h2 className="min-w-0 flex-1 text-base font-semibold">{KEYBINDS.title}</h2>
        <SheetClose onClose={close} />
      </div>
      <div className="shrink-0 px-4 pb-2">
        <div className="flex h-9 items-center gap-2 rounded-row px-2.5 shadow-[inset_0_0_0_1px_var(--line2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--focus)] phone:h-11">
          <SearchIcon className={ic + ' text-fg3'} />
          <input autoFocus name="keys" aria-label={KEYBINDS.filter} placeholder={KEYBINDS.filter} value={filter} onChange={(e) => setFilter(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg3 phone:text-[1rem]" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        {!groups.length ? <p className="py-6 text-center text-fg3">{KEYBINDS.none}</p> : groups.map((g) => (
          <section key={g.group} className="pt-2">
            <h3 className="pb-1 text-[0.75rem] font-medium text-fg3 phone:text-[0.8125rem]">{g.group}</h3>
            <dl>
              {g.rows.map((r) => (
                <div key={r.name} className="flex min-h-9 items-center gap-3">
                  <dt className="min-w-0 flex-1 truncate">{r.name}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {r.keys.map((k) => <kbd key={k} className="inline-grid h-5 place-items-center rounded-md px-1.5 font-sans text-[0.6875rem] whitespace-nowrap text-fg2 shadow-[inset_0_0_0_1px_var(--line2)]">{k}</kbd>)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
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
    reg.overlays.push(Keybinds)
    reg.views.search = Search
    reg.keys.push({
      order: 10,
      handle: ({ e, ui, snap }) => {
        // the Keybinds dialog: Ctrl+Shift+? again or Esc closes it
        if (e.ctrlKey && e.shiftKey && (e.code === 'Slash' || e.key === '?')) {
          e.preventDefault()
          openKeybinds(!keybindsOpen)
          setUI({ kb: true })
          return true
        }
        if (keybindsOpen) {
          if (e.key !== 'Escape') return false
          e.preventDefault()
          openKeybinds(false)
          return true
        }
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
