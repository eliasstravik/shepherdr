// Keyboard shortcuts, the plain rules (no React): how a key press reads as a chord, how a chord shows (⌘K on a Mac,
// Ctrl+K elsewhere), where a chord may fire (a text box keeps its letters, a terminal keeps nearly everything), which
// chords clash and which the browser keeps, and the palette's fuzzy match. commands.ts holds the live bindings.
//
// A chord is written the same on every computer: "Mod+K" is ⌘K on a Mac and Ctrl+K elsewhere; "Ctrl" is the real
// Control key on both. Keys are the key's place (e.code), so Shift or Option never changes the letter: "Shift+/" is ?.
// Two chords with a space between are a sequence: "G T" is G, then T.

export interface KeyLike {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

const MODS = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const
type Mod = (typeof MODS)[number]

/** the key's place on the keyboard, as a chord names it: a letter, a digit, a sign, or a named key */
const CODE: Record<string, string> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
}
const KEYNAME: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Esc: 'Escape' }

function keyOf(e: KeyLike): string | null {
  const c = e.code ?? ''
  let m = /^Key([A-Z])$/.exec(c)
  if (m) return m[1]
  m = /^(?:Digit|Numpad)(\d)$/.exec(c)
  if (m) return m[1]
  if (/^F\d{1,2}$/.test(c)) return c
  if (CODE[c]) return CODE[c]
  // no code (a test, an odd keyboard): the key's own name
  const k = KEYNAME[e.key] ?? e.key
  if (['Shift', 'Control', 'Alt', 'Meta', 'OS', 'CapsLock', 'Dead', 'Unidentified', 'Process'].includes(k)) return null
  return k.length === 1 ? k.toUpperCase() : k
}

/** a key press as a chord ("Mod+Shift+K"), or null for a modifier alone */
export function chordOf(e: KeyLike, mac = isMac()): string | null {
  const k = keyOf(e)
  if (!k) return null
  const mods: Mod[] = []
  if (mac ? e.metaKey : e.ctrlKey) mods.push('Mod')
  if (mac && e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (!mac && e.metaKey) mods.push('Meta')
  return [...mods, k].join('+')
}

/** a chord written by hand ("cmd+shift+k", "ctrl+`") in its one spelling, or null when it isn't one */
export function normal(chord: string, mac = isMac()): string | null {
  const steps = chord.trim().split(/\s+/)
  if (!steps[0] || steps.length > 2) return null
  const out: string[] = []
  for (const step of steps) {
    const parts = step.split('+')
    // "Mod++" is the plus key
    const key = parts.pop() || (parts.pop(), '+')
    const mods = new Set<Mod>()
    for (const p of parts) {
      const m = p.toLowerCase()
      if (m === 'mod') mods.add('Mod')
      else if (m === 'cmd' || m === 'meta' || m === 'command') mods.add(mac ? 'Mod' : 'Meta')
      else if (m === 'ctrl' || m === 'control') mods.add(mac ? 'Ctrl' : 'Mod')
      else if (m === 'alt' || m === 'option' || m === 'opt') mods.add('Alt')
      else if (m === 'shift') mods.add('Shift')
      else return null
    }
    let k = KEYNAME[key] ?? key
    if (k === '?') (k = '/'), mods.add('Shift')
    if (k.length === 1) k = k.toUpperCase()
    out.push([...MODS.filter((m) => mods.has(m)), k].join('+'))
  }
  return out.join(' ')
}

/** "Mod" in a chord kept for every computer: on a Mac Ctrl stays Ctrl, elsewhere it is Mod (the same key) */
export const here = (chord: string, mac = isMac()) => (mac ? chord : chord.replace(/(^|\s|\+)Ctrl(?=\+)/g, '$1Mod'))

const SYM: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⊞' }
const SHOW: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵', Escape: 'Esc', Backspace: '⌫', Space: 'Space', Delete: 'Del' }

/** each key of a chord as it shows, one cap each: ⌘ ⇧ K on a Mac, Ctrl Shift K elsewhere; "Shift+/" is ? */
export function caps(chord: string, mac = isMac()): string[][] {
  return chord.split(' ').map((step) => {
    const parts = step.split('+')
    const key = parts.pop()!
    if (key === '/' && parts.includes('Shift')) parts.splice(parts.indexOf('Shift'), 1), parts.push('?')
    else parts.push(key)
    return parts.map((p, i) => (i === parts.length - 1 ? SHOW[p] ?? p : mac ? SYM[p] : p === 'Mod' ? 'Ctrl' : p === 'Meta' ? 'Win' : p))
  })
}

/** a chord in words for a screen reader and the sheet's search: "Command Shift K", "G then T" */
export function say(chord: string, mac = isMac()): string {
  const word: Record<string, string> = mac ? { '⌘': 'Command', '⌃': 'Control', '⌥': 'Option', '⇧': 'Shift' } : {}
  return caps(chord, mac).map((s) => s.map((c) => word[c] ?? c).join(' ')).join(' then ')
}

/** the aria-keyshortcuts spelling ("Meta+Shift+K", "Control+`") */
export function aria(chord: string, mac = isMac()): string {
  return chord
    .split(' ')
    .map((step) => step.split('+').map((p) => (p === 'Mod' ? (mac ? 'Meta' : 'Control') : p === 'Ctrl' ? 'Control' : p)).join('+'))
    .join(' ')
}

/* ---------- where a chord may fire ---------- */

/** what has the keys now: a text box (its letters are typing), a terminal (its keys go to the shell), or nothing */
export type Focus = 'text' | 'terminal' | 'none'

export function focusOf(el: Element | null): Focus {
  if (!el || typeof (el as HTMLElement).closest !== 'function') return 'none'
  // the agent's terminal and a screen taken over keep their keys (terminal plugin, screens plugin)
  if ((el as HTMLElement).closest('[data-keys="own"]')) return 'terminal'
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return 'text'
  if (tag === 'INPUT') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase()
    return ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(t) ? 'none' : 'text'
  }
  return 'none'
}

/** a chord that holds Cmd, Ctrl, Alt or the Windows key, or a function key: it never types a letter */
export const held = (chord: string) => /(^|\+)(Mod|Ctrl|Alt|Meta)\+/.test(chord) || /^F\d{1,2}$/.test(chord.split('+').pop()!)

/** May this chord fire with this focus? A text box keeps plain keys and sequences; a terminal keeps everything but
 *  the few commands that say `terminal`; single letters can be switched off (Settings › Shortcuts). */
export function mayFire(chord: string, focus: Focus, o: { terminal?: boolean; letters?: boolean } = {}): boolean {
  if (focus === 'terminal') return !!o.terminal
  const steps = chord.split(' ')
  const plain = steps.length > 1 || !held(chord)
  if (focus === 'text') return !plain
  if (plain && o.letters === false) return false
  return true
}

/* ---------- clashes ---------- */

/** chords the browser keeps for itself: a page never gets them (new window, new tab, close, quit, tab switching) */
const KEPT = ['Mod+N', 'Mod+Shift+N', 'Mod+T', 'Mod+Shift+T', 'Mod+W', 'Mod+Shift+W', 'Mod+Q', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Mod+Tab']
/** chords a page can take but people expect the browser's (address bar, reload, find, print, bookmark, tabs by number) */
const EXPECTED = ['Mod+L', 'Mod+R', 'Mod+Shift+R', 'Mod+F', 'Mod+P', 'Mod+D', 'Mod+S', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+Z', 'Mod+Shift+Z', 'Mod+A', 'Mod+H', 'Mod+M', 'Mod+[', 'Mod+]', 'Mod+=', 'Mod+-', 'Mod+0', ...'123456789'.split('').map((n) => `Mod+${n}`)]

/** what the browser says about a chord: it keeps it (never reaches the page), or people expect its own */
export function browserOwns(chord: string, mac = isMac()): 'kept' | 'expected' | null {
  const c = here(chord, mac)
  if (KEPT.some((k) => here(k, mac) === c) || (!mac && c === 'Ctrl+Tab')) return 'kept'
  if (EXPECTED.includes(c)) return 'expected'
  return null
}

/** the commands each chord belongs to, for chords on more than one; a sequence's first key clashes with a chord of
 *  that key alone ("G" and "G T") */
export function clashes(bound: Record<string, string[]>): Map<string, string[]> {
  const by = new Map<string, string[]>()
  for (const [id, list] of Object.entries(bound)) for (const c of list) by.set(c, [...(by.get(c) ?? []), id])
  for (const c of [...by.keys()]) {
    const first = c.split(' ')[0]
    if (c.includes(' ') && by.has(first)) for (const id of by.get(first)!) if (!by.get(c)!.includes(id)) by.set(c, [...by.get(c)!, id])
  }
  return new Map([...by].filter(([, ids]) => ids.length > 1))
}

/** the commands already on a chord, other than `id`: what a new chord takes over */
export function takenBy(bound: Record<string, string[]>, chord: string, id: string): string[] {
  const first = chord.split(' ')[0]
  return Object.entries(bound)
    .filter(([other, list]) => other !== id && list.some((c) => c === chord || c === first || c.split(' ')[0] === chord))
    .map(([other]) => other)
}

/* ---------- the palette's match ---------- */

/** How well `q` matches `text`: -1 for no match. The letters must come in order; a match at the start, at the start of
 *  a word (so "ot" finds Open Tasks) and in a run scores higher; a shorter text a little higher. */
export function fuzzy(q: string, text: string): number {
  const s = q.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!s) return 0
  const t = text.toLowerCase()
  const at = t.indexOf(s)
  // the words as typed, whole: the best
  if (at >= 0) return 1000 - at * 2 + (at === 0 || /[\s›#@/._-]/.test(t[at - 1]) ? 200 : 0) - t.length / 10
  let score = 0
  let j = 0
  let run = 0
  let weak = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === ' ') continue
    const k = t.indexOf(ch, j)
    if (k < 0) return -1
    const start = k === 0 || /[\s›#@/._-]/.test(t[k - 1])
    run = k === j && i > 0 ? run + 1 : 0
    // a letter found mid-word after a jump: a weak match; too many and it is none
    if (!start && k !== j && i > 0) weak++
    score += 10 + (start ? 30 : 0) + run * 15 - Math.min(k - j, 10)
    j = k + 1
  }
  if (weak > 1) return -1
  return score - t.length / 10
}
