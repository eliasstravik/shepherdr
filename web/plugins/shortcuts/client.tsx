// Shortcuts for everything (SHEP-470): the app's own commands (the list, Settings, spaces), the sheet of every shortcut
// on ? (Linear's, GitHub's) or Cmd+/ (Slack's, Claude's), and Settings › Shortcuts, where each one is changed, removed
// or put back, with a warning when a key is another command's or the browser's. Every other command comes from its
// own plugin (registry.commands); the palette is the search plugin's.
import { useEffect, useState } from 'react'
import { definePlugin, getState, go, openSettings, registry, setUI, tryAct, useSnap, type Command } from '@client/kernel.ts'
import { available, bound, keysOf, prefsOf, usePrefs } from '@client/commands.ts'
import { browserOwns, caps, chordOf, clashes, focusOf, here, isMac, say, takenBy } from '@client/keys.ts'
import { Kbd } from '@client/kbd.tsx'
import { confirm, openDialog } from '@client/overlay.tsx'
import { newSpaceDialog } from '@client/list.tsx'
import { showList } from '@client/App.tsx'
import { SRow } from '@client/settings.tsx'
import { Btn, cx, I, IB, Tgl } from '@client/ui.tsx'
import { everything, listOf } from '@shared/view.ts'
import { shownOn } from '@client/kernel.ts'

/** the areas in the order the sheet and Settings show them */
const AREAS = ['General', 'Go to', 'Spaces', 'Chat', 'Tasks', 'Terminal', 'Voice']
const byArea = (list: Command[]) => {
  const areas = [...new Set([...AREAS, ...list.map((c) => c.area)])]
  return areas.map((a) => [a, list.filter((c) => c.area === a)] as const).filter(([, l]) => l.length)
}
/** keys that aren't commands, shown in the sheet so it is the whole story */
const BUILT_IN: [string, string, string][] = [
  ['Chat', 'Send', 'Enter'],
  ['Chat', 'New line', 'Shift+Enter'],
  ['General', 'Close what is open', 'Escape'],
]

/* ---------- the spaces in the list's order ---------- */

function spaceOrder(): string[] {
  const { snap, ui } = getState()
  if (!snap) return []
  const ev = everything(snap)
  const listed = listOf(snap, (m) => shownOn(ui, m)).flatMap((m) => [...m.groups.flatMap((g) => g.spaces), ...m.spaces].map((p) => p.id))
  return [...(ev ? [ev.id] : []), ...listed]
}
function stepSpace(by: 1 | -1) {
  const ids = spaceOrder()
  if (!ids.length) return
  const at = ids.indexOf(getState().ui.at)
  go(ids[(at + by + ids.length) % ids.length])
}

/* ---------- the sheet ---------- */

export function openSheet() {
  openDialog((close) => <Sheet close={close} />, { wide: true, bare: true, label: 'Keyboard shortcuts' })
}

function Sheet({ close }: { close: () => void }) {
  usePrefs()
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const list = registry.commands.filter((c) => !c.hidden && keysOf(c.id).length)
  const hit = (title: string, chords: string[]) => !s || title.toLowerCase().includes(s) || chords.some((k) => say(k).toLowerCase().includes(s))
  const letters = prefsOf().letters
  const nine = keysOf('space.1')[0]
  return (
    <div className="pk ksheet">
      <div className="hd">
        <h2 style={{ flex: 1 }}>Keyboard shortcuts</h2>
        <IB icon="x" label="Close" onClick={close} />
      </div>
      <input className="inp" name="kq" aria-label="Search shortcuts" placeholder="Search shortcuts" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="kcols">
        {byArea(list).map(([area, cmds]) => {
          const rows = [
            ...cmds.map((c) => ({ key: c.id, title: c.title, chords: keysOf(c.id), off: !letters && keysOf(c.id).every((k) => !/\+/.test(k.split(' ')[0])) })),
            ...BUILT_IN.filter((b) => b[0] === area).map((b) => ({ key: b[1], title: b[1], chords: [b[2]], off: false })),
            ...(area === 'Spaces' && nine ? [{ key: 'nine', title: 'Space 1 to 9 in the list', chords: [nine.replace(/1$/, '1–9')], off: false }] : []),
          ].filter((r) => hit(r.title, r.chords))
          if (!rows.length) return null
          return (
            <section key={area}>
              <div className="lab">{area}</div>
              {rows.map((r) => (
                <div key={r.key} className={cx('krow', r.off && 'off')}>
                  <span className="n">{r.title}</span>
                  {r.chords.slice(0, 2).map((k) => <Kbd key={k} chord={k} />)}
                </div>
              ))}
            </section>
          )
        })}
      </div>
      <div className="acts">
        <Btn onClick={() => { close(); openSettings('all', 'Shortcuts') }}>Change shortcuts</Btn>
      </div>
    </div>
  )
}

/* ---------- Settings › Shortcuts ---------- */

const set = (key: string, value: unknown) => tryAct({ type: 'config', place: 'all', key, value })
const plain = (chord: string) => !/\+/.test(chord.split(' ')[0])
const titleOf = (id: string) => registry.commands.find((c) => c.id === id)?.title ?? id

/** the keys pressed while a row listens: one chord, or two plain keys in a row ("G T") */
function useRecord(on: boolean, done: (chord: string | null) => void) {
  useEffect(() => {
    if (!on) return
    let first: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const key = (e: KeyboardEvent) => {
      const chord = chordOf(e)
      if (!chord) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!first && chord === 'Escape') return done(null)
      clearTimeout(timer)
      if (first) return done(plain(chord) ? `${first} ${chord}` : first)
      // a plain key may start a sequence: wait a moment for the second
      if (plain(chord) && chord !== 'Escape' && !chord.startsWith('Shift+')) {
        first = chord
        timer = setTimeout(() => done(first), 900)
        return
      }
      done(chord)
    }
    addEventListener('keydown', key, true)
    return () => {
      clearTimeout(timer)
      removeEventListener('keydown', key, true)
    }
  }, [on])
}

function KeyRow({ c, listening, listen, clash }: { c: Command; listening: boolean; listen: (on: boolean) => void; clash: string[] }) {
  const prefs = usePrefs()
  const keys = keysOf(c.id, prefs)
  const changed = prefs.keys[c.id] !== undefined
  const [ask, setAsk] = useState<{ chord: string; taken: string[]; browser: 'kept' | 'expected' | null } | null>(null)
  const save = async (chord: string, taken: string[]) => {
    setAsk(null)
    const all = bound(prefs)
    // the key moves here: off every command it was on
    for (const id of taken) await set(`shortcut.${id}`, all[id].filter((k) => k !== chord && k.split(' ')[0] !== chord && k !== chord.split(' ')[0]))
    await set(`shortcut.${c.id}`, [chord])
  }
  useRecord(listening, (chord) => {
    listen(false)
    if (!chord) return
    const k = here(chord)
    if (keys.includes(k)) return
    const browser = browserOwns(k)
    const taken = takenBy(bound(prefs), k, c.id)
    if (browser === 'kept' || browser === 'expected' || taken.length) return setAsk({ chord: k, taken, browser })
    void save(k, [])
  })
  return (
    <div className="kset">
      <SRow label={<>{c.title}{changed && <> · <span className="lk" role="button" tabIndex={0} onClick={() => void set(`shortcut.${c.id}`, null)} onKeyDown={(e) => e.key === 'Enter' && void set(`shortcut.${c.id}`, null)}>Reset</span></>}</>}>
        <button type="button" className={cx('kbtn', listening && 'on')} aria-label={`${c.title}: ${keys.length ? keys.map((k) => say(k)).join(' or ') : 'no shortcut'}. Change`} onClick={() => listen(!listening)}>
          {listening ? <span className="hint">Press keys…</span> : keys.length ? keys.slice(0, 2).map((k) => <Kbd key={k} chord={k} />) : <span className="hint">None</span>}
        </button>
        {keys.length > 0 && !listening ? <IB icon="x" label={`Remove ${c.title}'s shortcut`} onClick={() => void set(`shortcut.${c.id}`, [])} /> : <span className="ibgap" />}
      </SRow>
      {clash.length > 0 && !ask && <p className="kwarn"><I n="warn" c="s16" />Same keys as {clash.map(titleOf).join(', ')}: only the first that can run, runs.</p>}
      {ask && (
        <div className="kwarn">
          <I n="warn" c="s16" />
          <span className="n">
            {ask.browser === 'kept'
              ? <>Your browser keeps {caps(ask.chord).flat().join(isMac() ? '' : '+')} for itself: it never reaches this page.</>
              : `${caps(ask.chord).flat().join(isMac() ? '' : '+')} is already ${[...ask.taken.map(titleOf), ...(ask.browser === 'expected' ? ["your browser's"] : [])].join(' and ')}.`}
          </span>
          {ask.browser !== 'kept' && <Btn small kind="pri" onClick={() => void save(ask.chord, ask.taken)}>{ask.taken.length ? 'Use it here' : 'Use it anyway'}</Btn>}
          <Btn small onClick={() => setAsk(null)}>{ask.browser === 'kept' ? 'OK' : 'Cancel'}</Btn>
        </div>
      )}
    </div>
  )
}

function ShortcutsSettings() {
  useSnap()
  const prefs = usePrefs()
  const [q, setQ] = useState('')
  const [listening, setListening] = useState<string | null>(null)
  const s = q.trim().toLowerCase()
  const all = bound(prefs)
  const clash = clashes(all)
  const clashOf = (id: string) => [...new Set([...clash].filter(([k, ids]) => all[id].includes(k) && ids.includes(id)).flatMap(([, ids]) => ids.filter((x) => x !== id)))]
  const list = registry.commands.filter((c) => !s || c.title.toLowerCase().includes(s) || c.area.toLowerCase().includes(s) || all[c.id].some((k) => say(k).toLowerCase().includes(s)))
  const changed = Object.keys(prefs.keys).length > 0
  return (
    <>
      <SRow label="Single-letter keys"><Tgl label="Single-letter keys" on={prefs.letters} onChange={(v) => void set('shortcuts.letters', v)} /></SRow>
      <div className="fld">
        <input className="inp" name="ksq" aria-label="Search shortcuts" placeholder="Search shortcuts" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
      </div>
      {byArea(list).map(([area, cmds]) => (
        <div key={area}>
          <h3>{area}</h3>
          {cmds.map((c) => <KeyRow key={c.id} c={c} listening={listening === c.id} listen={(on) => setListening(on ? c.id : null)} clash={clashOf(c.id)} />)}
        </div>
      ))}
      {!list.length && <p className="hint">No shortcut matches.</p>}
      {changed && (
        <div className="acts" style={{ marginTop: 16 }}>
          <Btn onClick={() => confirm({ title: 'Reset every shortcut?', body: 'Each one goes back to what it was at the start.', ok: 'Reset all', run: () => set('shortcuts.reset', true) })}>Reset all</Btn>
        </div>
      )}
    </>
  )
}

/* ---------- the app's own commands ---------- */

const appCommands = (): Command[] => [
  { id: 'shortcuts.sheet', title: 'Keyboard shortcuts', area: 'General', icon: 'keyboard', keys: ['Shift+/', 'Mod+/'], words: 'help keys cheat sheet hotkeys', when: () => !getState().ui.phone, run: openSheet },
  { id: 'shortcuts.settings', title: 'Open Settings', area: 'General', icon: 'gear', keys: ['Mod+,'], words: 'preferences options', run: () => openSettings('all') },
  { id: 'shortcuts.list', title: 'Show or hide the list', area: 'General', icon: 'panel', keys: ['Mod+B'], words: 'sidebar toggle spaces', when: () => !getState().ui.phone, run: () => {
    const { ui } = getState()
    if (ui.sideOff || (ui.narrow && ui.pane)) showList()
    else setUI({ sideOff: true })
  } },
  { id: 'space.new', title: 'New space', area: 'Spaces', icon: 'plus', keys: ['Mod+Shift+O'], words: 'create add project', run: () => newSpaceDialog() },
  { id: 'space.next', title: 'Next space', area: 'Spaces', icon: 'down', keys: ['Alt+Down'], words: 'switch', run: () => stepSpace(1) },
  { id: 'space.prev', title: 'Previous space', area: 'Spaces', icon: 'up', keys: ['Alt+Up'], words: 'switch', run: () => stepSpace(-1) },
  ...Array.from({ length: 9 }, (_, i): Command => ({ id: `space.${i + 1}`, title: `Space ${i + 1} in the list`, area: 'Spaces', keys: [`Alt+${i + 1}`], hidden: true, when: () => spaceOrder().length > i, run: () => go(spaceOrder()[i]) })),
  { id: 'go.everything', title: 'Go to Everything', area: 'Go to', icon: 'layers', keys: ['G E'], when: () => !!getState().snap && !!everything(getState().snap!), run: () => go(everything(getState().snap!)!.id) },
  { id: 'go.chat', title: 'Go to the chat', area: 'Go to', icon: 'chat', keys: ['G C'], words: 'close pane back space', run: () => go(getState().ui.at) },
]

export default definePlugin({
  name: 'shortcuts',
  setup(reg) {
    reg.commands.push(...appCommands())
    reg.settings.push({ name: 'Shortcuts', icon: 'keyboard', order: 40, scope: 'all', View: ShortcutsSettings })
  },
})

export { available, focusOf }
