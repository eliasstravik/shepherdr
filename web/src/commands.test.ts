// The commands' shortcuts live (SHEP-470): a plugin's defaults, the person's own keys over them, sequences, and where a
// key may fire (a text box keeps letters, a terminal its keys, something open over the app its plain keys).
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getState, registry, setUI, type Command } from './kernel.ts'
import { appTakes, bound, handleKey, keysOf, resetPending } from './commands.ts'

const ran: string[] = []
const cmd = (id: string, keys: string[], o: Partial<Command> = {}): Command => ({ id, title: id, area: 'General', keys, run: () => void ran.push(id), ...o })
let open = true
const mine: Command[] = [
  cmd('t.palette', ['Mod+K'], { terminal: true }),
  cmd('t.tasks', ['G T']),
  cmd('t.next', ['J'], { when: () => open }),
  cmd('t.sheet', ['Shift+/']),
  cmd('t.term', ['Ctrl+`'], { terminal: true }),
  cmd('t.list', ['Mod+B']),
]
const config = (shortcuts?: { keys: Record<string, string[]>; letters: boolean }) =>
  Object.assign(getState(), { snap: { places: [], tasks: [], machines: [], config: shortcuts ? { shortcuts } : {} } })

const body = { tagName: 'BODY', isContentEditable: false, closest: () => null }
const box = { tagName: 'TEXTAREA', isContentEditable: false, closest: () => null }
const term = { tagName: 'INPUT', isContentEditable: false, closest: (s: string) => (s === '[data-keys="own"]' ? {} : null) }
let t = 0
const press = (code: string, key: string, m: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}, target: object = body, mac = true) =>
  handleKey({ key, code, metaKey: !!m.meta, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, target, timeStamp: (t += 100), defaultPrevented: false, isComposing: false, keyCode: 0 } as unknown as KeyboardEvent, mac)

beforeEach(() => {
  registry.commands.push(...mine)
  ran.length = 0
  open = true
  resetPending()
  config()
  setUI({ search: false, settings: null })
})
afterEach(() => {
  registry.commands.splice(0, registry.commands.length, ...registry.commands.filter((c) => !mine.includes(c)))
})

test("a plugin's default keys run its command: ⌘K on a Mac, Ctrl+K elsewhere", () => {
  expect(press('KeyK', 'k', { meta: true })).toBe(true)
  expect(press('KeyK', 'k', { ctrl: true }, body, false)).toBe(true)
  // Ctrl+K on a Mac is the terminal's, not the palette's
  expect(press('KeyK', 'k', { ctrl: true })).toBe(false)
  expect(ran).toEqual(['t.palette', 't.palette'])
})

test('G then T is a sequence; G alone waits, another key forgets it', () => {
  expect(press('KeyG', 'g')).toBe(true)
  expect(ran).toEqual([])
  expect(press('KeyT', 't')).toBe(true)
  expect(ran).toEqual(['t.tasks'])
  press('KeyG', 'g')
  expect(press('KeyX', 'x')).toBe(false)
  expect(press('KeyT', 't')).toBe(false)
  expect(ran).toEqual(['t.tasks'])
})

test('a text box keeps its letters and ?; chords with Cmd still work there', () => {
  expect(press('KeyJ', 'j', {}, box)).toBe(false)
  expect(press('KeyG', 'g', {}, box)).toBe(false)
  expect(press('Slash', '?', { shift: true }, box)).toBe(false)
  expect(press('KeyB', 'b', { meta: true }, box)).toBe(true)
  expect(ran).toEqual(['t.list'])
})

test('a terminal keeps every key but the palette and your terminal', () => {
  expect(press('KeyB', 'b', { meta: true }, term)).toBe(false)
  expect(press('KeyJ', 'j', {}, term)).toBe(false)
  expect(press('KeyK', 'k', { meta: true }, term)).toBe(true)
  expect(press('Backquote', '`', { ctrl: true }, term)).toBe(true)
  expect(ran).toEqual(['t.palette', 't.term'])
  // the terminal's own handler lets those pass, and only those
  expect(appTakes({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBe(true)
  expect(appTakes({ key: 'c', code: 'KeyC', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, true)).toBe(false)
  expect(appTakes({ key: 'b', code: 'KeyB', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, false)).toBe(false)
})

test("a command that can't run now lets its key pass", () => {
  open = false
  expect(press('KeyJ', 'j')).toBe(false)
  open = true
  expect(press('KeyJ', 'j')).toBe(true)
})

test('the palette or settings open: plain keys wait, chords still work', () => {
  setUI({ search: true })
  expect(press('KeyJ', 'j')).toBe(false)
  expect(press('KeyK', 'k', { meta: true })).toBe(true)
  setUI({ search: false, settings: { scope: 'all', sec: 'Shortcuts' } })
  expect(press('KeyG', 'g')).toBe(false)
})

test("the person's own keys win over the defaults; empty is none; single letters can be off", () => {
  config({ keys: { 't.tasks': ['Mod+Shift+T'.replace('T', 'Y')], 't.list': [] }, letters: true })
  expect(keysOf('t.tasks')).toEqual(['Mod+Shift+Y'])
  expect(keysOf('t.list')).toEqual([])
  expect(keysOf('t.palette')).toEqual(['Mod+K'])
  press('KeyG', 'g')
  expect(press('KeyT', 't')).toBe(false)
  expect(press('KeyY', 'y', { meta: true, shift: true })).toBe(true)
  expect(press('KeyB', 'b', { meta: true })).toBe(false)
  expect(ran).toEqual(['t.tasks'])
  config({ keys: {}, letters: false })
  expect(press('KeyJ', 'j')).toBe(false)
  expect(press('Slash', '?', { shift: true })).toBe(false)
  expect(press('KeyK', 'k', { meta: true })).toBe(true)
})

test('every command has its keys in this computer’s spelling', () => {
  const b = bound()
  expect(b['t.term']).toEqual(process.platform === 'darwin' ? ['Ctrl+`'] : expect.any(Array))
  expect(b['t.tasks']).toEqual(['G T'])
})
