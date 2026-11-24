// Shortcuts (SHEP-470): a key press read as a chord, how it shows on a Mac and elsewhere, where it may fire (a text
// box keeps its letters, a terminal its keys), clashes, the browser's own keys, and the palette's fuzzy match.
import { expect, test } from 'bun:test'
import { aria, browserOwns, caps, chordOf, clashes, focusOf, fuzzy, here, mayFire, normal, say, takenBy } from './keys.ts'

const ev = (key: string, code: string, m: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({ key, code, metaKey: !!m.meta, ctrlKey: !!m.ctrl, altKey: !!m.alt, shiftKey: !!m.shift })

test('Cmd on a Mac and Ctrl elsewhere are the same chord: Mod', () => {
  expect(chordOf(ev('k', 'KeyK', { meta: true }), true)).toBe('Mod+K')
  expect(chordOf(ev('k', 'KeyK', { ctrl: true }), false)).toBe('Mod+K')
  // a Mac's real Control stays Control; Ctrl+K on a Mac isn't Cmd+K
  expect(chordOf(ev('k', 'KeyK', { ctrl: true }), true)).toBe('Ctrl+K')
  expect(chordOf(ev('`', 'Backquote', { ctrl: true }), true)).toBe('Ctrl+`')
})

test("the key's place, not what Shift or Option types: ? is Shift+/, Option+1 is Alt+1", () => {
  expect(chordOf(ev('?', 'Slash', { shift: true }), true)).toBe('Shift+/')
  expect(chordOf(ev('¡', 'Digit1', { alt: true }), true)).toBe('Alt+1')
  expect(chordOf(ev('G', 'KeyG', { shift: true }), false)).toBe('Shift+G')
  expect(chordOf(ev('ArrowDown', 'ArrowDown', { alt: true }), false)).toBe('Alt+Down')
  // a modifier alone is no chord
  expect(chordOf(ev('Shift', 'ShiftLeft', { shift: true }), false)).toBeNull()
})

test('a chord written by hand reads as its one spelling', () => {
  expect(normal('cmd+shift+k', true)).toBe('Mod+Shift+K')
  expect(normal('ctrl+k', false)).toBe('Mod+K')
  expect(normal('ctrl+k', true)).toBe('Ctrl+K')
  expect(normal('?', true)).toBe('Shift+/')
  expect(normal('g t', true)).toBe('G T')
  expect(normal('hyper+k', true)).toBeNull()
  expect(normal('a b c', true)).toBeNull()
})

test('a default with Ctrl is Mod off a Mac, so it matches the press', () => {
  expect(here('Ctrl+`', false)).toBe('Mod+`')
  expect(here('Ctrl+`', true)).toBe('Ctrl+`')
  expect(here('Ctrl+Shift+`', false)).toBe(chordOf(ev('`', 'Backquote', { ctrl: true, shift: true }), false)!)
})

test('it shows as ⌘ ⇧ K on a Mac and Ctrl Shift K elsewhere; ? as ?; a sequence in steps', () => {
  expect(caps('Mod+Shift+K', true)).toEqual([['⌘', '⇧', 'K']])
  expect(caps('Mod+Shift+K', false)).toEqual([['Ctrl', 'Shift', 'K']])
  expect(caps('Shift+/', true)).toEqual([['?']])
  expect(caps('G T', false)).toEqual([['G'], ['T']])
  expect(caps('Alt+Down', true)).toEqual([['⌥', '↓']])
  expect(say('Mod+K', true)).toBe('Command K')
  expect(say('G T', false)).toBe('G then T')
  expect(aria('Mod+K', true)).toBe('Meta+K')
  expect(aria('Mod+K', false)).toBe('Control+K')
})

/* ---------- focus rules ---------- */

const el = (tag: string, o: { type?: string; editable?: boolean; inOwn?: boolean } = {}) =>
  ({ tagName: tag, type: o.type, isContentEditable: !!o.editable, closest: (s: string) => (s === '[data-keys="own"]' && o.inOwn ? {} : null) }) as unknown as Element

test('what has the keys: a text box, a terminal, or nothing', () => {
  expect(focusOf(null)).toBe('none')
  expect(focusOf(el('BODY'))).toBe('none')
  expect(focusOf(el('TEXTAREA'))).toBe('text')
  expect(focusOf(el('INPUT', { type: 'text' }))).toBe('text')
  expect(focusOf(el('INPUT', { type: 'checkbox' }))).toBe('none')
  expect(focusOf(el('DIV', { editable: true }))).toBe('text')
  // the terminal's own hidden input is a text box, but the terminal keeps its keys
  expect(focusOf(el('INPUT', { inOwn: true }))).toBe('terminal')
})

test('single letters and sequences only when no text box has the keys', () => {
  expect(mayFire('J', 'none')).toBe(true)
  expect(mayFire('J', 'text')).toBe(false)
  expect(mayFire('G T', 'text')).toBe(false)
  expect(mayFire('Shift+/', 'text')).toBe(false)
  expect(mayFire('Mod+K', 'text')).toBe(true)
  expect(mayFire('Alt+Down', 'text')).toBe(true)
  // switched off in Settings › Shortcuts: letters never fire, chords still do
  expect(mayFire('J', 'none', { letters: false })).toBe(false)
  expect(mayFire('G T', 'none', { letters: false })).toBe(false)
  expect(mayFire('Mod+K', 'none', { letters: false })).toBe(true)
})

test('a terminal keeps every key but the few commands that say so (the palette, your terminal)', () => {
  expect(mayFire('Mod+B', 'terminal')).toBe(false)
  expect(mayFire('J', 'terminal')).toBe(false)
  expect(mayFire('Mod+K', 'terminal', { terminal: true })).toBe(true)
  expect(mayFire('Ctrl+`', 'terminal', { terminal: true })).toBe(true)
})

/* ---------- clashes and the browser ---------- */

test('the browser keeps new tab, close and quit; people expect its address bar and reload', () => {
  expect(browserOwns('Mod+W', true)).toBe('kept')
  expect(browserOwns('Mod+T', false)).toBe('kept')
  expect(browserOwns('Mod+Shift+N', false)).toBe('kept')
  expect(browserOwns('Mod+L', true)).toBe('expected')
  expect(browserOwns('Mod+1', false)).toBe('expected')
  expect(browserOwns('Mod+K', true)).toBeNull()
  expect(browserOwns('G T', true)).toBeNull()
})

test('two commands on one key clash, and a sequence clashes with its first key alone', () => {
  const c = clashes({ a: ['Mod+K'], b: ['Mod+K', 'J'], c: ['G T'], d: ['G'], e: ['G A'] })
  expect(c.get('Mod+K')).toEqual(['a', 'b'])
  expect(c.get('G T')).toEqual(['c', 'd'])
  expect(c.has('J')).toBe(false)
  // G T and G A share only their first key: no clash between them
  expect(c.get('G A')).toEqual(['e', 'd'])
})

test('a new key takes over from the commands it was on', () => {
  const b = { a: ['Mod+B'], b: ['G T'], c: ['J'], me: [] }
  expect(takenBy(b, 'Mod+B', 'me')).toEqual(['a'])
  expect(takenBy(b, 'G', 'me')).toEqual(['b'])
  expect(takenBy(b, 'G A', 'me')).toEqual([])
  expect(takenBy(b, 'Mod+B', 'a')).toEqual([])
})

/* ---------- the palette's match ---------- */

test('fuzzy: the letters in order; whole words, a start and word starts rank higher', () => {
  expect(fuzzy('ot', 'Open Tasks')).toBeGreaterThan(0)
  expect(fuzzy('xyz', 'Open Tasks')).toBe(-1)
  expect(fuzzy('tasks', 'Open Tasks')).toBeGreaterThan(fuzzy('ot', 'Open Tasks'))
  expect(fuzzy('open', 'Open Tasks')).toBeGreaterThan(fuzzy('open', 'Reopen Tasks'))
  expect(fuzzy('ot', 'Open Tasks')).toBeGreaterThan(fuzzy('ot', 'Show or hide the list'))
  expect(fuzzy('', 'anything')).toBe(0)
  expect(fuzzy('SET', 'Settings › Shortcuts')).toBeGreaterThan(0)
  // letters scattered mid-word are no match: "sto" isn't Show or hide the list
  expect(fuzzy('sto', 'Show or hide the list')).toBe(-1)
  expect(fuzzy('shp', 'shop')).toBeGreaterThan(0)
})
