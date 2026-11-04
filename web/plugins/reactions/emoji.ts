// Emoji helpers: the spelling a reaction is kept by, skin tones, the ones this device uses most (scored like Slack's
// frequently used), and the full set (loaded only when the picker first opens: it ships with the app, a chunk of its own).

/** the quick row's favourites */
export const EMOJI = ['👍', '❤️', '😂', '🙌', '👀', '✅']

/** the spelling Unicode calls fully qualified: no presentation mark after a character that is already an emoji, so 👍
    from the quick row and 👍 from the picker are the same reaction */
export const fq = (s: string) => s.replace(/(\p{Emoji_Presentation})\uFE0F/gu, '$1')

/** tones 1-5 (light to dark) go after each person or hand in it; 0 is the yellow default */
export const withTone = (s: string, tone: number) => (tone ? fq(s).replace(/(\p{Emoji_Modifier_Base})\uFE0F?/gu, `$1${String.fromCodePoint(0x1f3fa + tone)}`) : fq(s))

export const TONES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']

export interface Emoji {
  e: string
  /** takes a skin tone */
  tone: boolean
  name: string
  /** Slack's shortcodes for it, space-separated */
  codes: string
  /** its name, shortcodes and more words, lower case */
  words: string
}
export interface Group {
  name: string
  icon: string
  list: Emoji[]
}

let groups: Promise<Group[]> | null = null
export function loadEmoji(): Promise<Group[]> {
  groups ??= import('./emoji-data.ts').then(({ default: d }) =>
    d.map(([name, icon, lines]) => ({
      name,
      icon,
      list: lines.split('\n').map((l) => {
        const [e, name, codes, more] = l.split('|')
        const tone = e.endsWith('~')
        return { e: tone ? e.slice(0, -1) : e, tone, name, codes, words: `${name} ${codes.replaceAll('_', ' ')} ${more}`.toLowerCase() }
      }),
    })),
  )
  return groups
}

/** best first: its name or shortcode itself (heart: ❤️), a name or shortcode that starts with what was typed, a word of
    the name, any word, then any match */
export function search(all: Group[], q: string): Emoji[] {
  const t = q.toLowerCase().replaceAll(':', '').replaceAll('_', ' ').trim().replace(/\s+/g, ' ')
  if (!t) return []
  const terms = t.split(' ')
  const rank = (x: Emoji) => {
    if (!terms.every((w) => x.words.includes(w))) return -1
    const name = x.name.toLowerCase()
    const words = ` ${x.words}`
    const codes = x.codes.split(' ')
    const code = t.replaceAll(' ', '_')
    if (name === t || codes.includes(code)) return 0
    if (name.startsWith(t) || codes.some((c) => c.startsWith(code))) return 1
    if (terms.every((w) => ` ${name}`.includes(` ${w}`))) return 2
    if (terms.every((w) => words.includes(` ${w}`))) return 3
    return 4
  }
  const tiers: Emoji[][] = [[], [], [], [], []]
  for (const g of all) for (const x of g.list) {
    const r = rank(x)
    if (r >= 0) tiers[r].push(x)
  }
  return tiers.flat()
}

/* ---------- remembered on this device ---------- */

const USES = 'shepherdr:emoji-uses'
/** the plain list of recents before uses were counted: read once, to start the counts */
const RECENT = 'shepherdr:emoji-recent'
const TONE = 'shepherdr:emoji-tone'
const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private window: not remembered */
  }
}

/** how often and how lately each emoji was used: a count and the last ten times */
type Uses = Record<string, { n: number; t: number[] }>

const H = 3600_000
/** Slack's frecency (after Firefox's): each of the last ten uses weighs by how long ago it was, and the average weight
    times the count is the score. A burst of use today beats a habit from last month; a habit beats a one-off. */
const BUCKETS: [number, number][] = [
  [4 * H, 100],
  [24 * H, 80],
  [72 * H, 60],
  [168 * H, 40],
  [720 * H, 20],
  [2160 * H, 10],
]
const weight = (age: number) => BUCKETS.find(([upTo]) => age <= upTo)?.[1] ?? 0
export const score = (u: { n: number; t: number[] }, now: number) => (u.t.length ? (u.n * u.t.reduce((s, t) => s + weight(now - t), 0)) / u.t.length : 0)

function uses(): Uses {
  try {
    const v = JSON.parse(read(USES) ?? 'null')
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const ok: Uses = {}
      for (const [e, u] of Object.entries(v as Record<string, { n?: unknown; t?: unknown }>))
        if (typeof u?.n === 'number' && Array.isArray(u.t)) ok[e] = { n: u.n, t: u.t.filter((x): x is number => typeof x === 'number').slice(0, 10) }
      return ok
    }
    // recents from before: newest first, a minute apart, each used once
    const old = JSON.parse(read(RECENT) ?? '[]')
    const now = Date.now()
    return Object.fromEntries((Array.isArray(old) ? old : []).filter((x) => typeof x === 'string').map((e, i) => [e, { n: 1, t: [now - i * 60_000] }]))
  } catch {
    return {}
  }
}

/** used emoji, best first: highest frecency, then the latest */
export function frequent(now = Date.now()): string[] {
  const all = Object.entries(uses())
  return all
    .map(([e, u]) => ({ e, s: score(u, now), last: u.t[0] ?? 0 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.last - a.last)
    .map((x) => x.e)
    .slice(0, 24)
}

export function remember(emoji: string, now = Date.now()) {
  const all = uses()
  const u = all[emoji] ?? { n: 0, t: [] }
  all[emoji] = { n: u.n + 1, t: [now, ...u.t].slice(0, 10) }
  // keep the best sixty
  const kept = Object.entries(all)
    .sort(([, a], [, b]) => score(b, now) - score(a, now))
    .slice(0, 60)
  write(USES, JSON.stringify(Object.fromEntries(kept)))
}

/** the quick row: six, your most used first, the favourites filling the rest until there's history (like Slack) */
export function quickRow(skin: number, now = Date.now()): string[] {
  const favs = EMOJI.map((e) => withTone(e, /\p{Emoji_Modifier_Base}/u.test(e) ? skin : 0))
  return [...new Set([...frequent(now), ...favs])].slice(0, EMOJI.length)
}

export const tone = () => Math.min(5, Math.max(0, Number(read(TONE)) || 0))
export const setTone = (t: number) => write(TONE, String(t))
