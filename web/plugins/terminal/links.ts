// Web addresses on a terminal's screen. Found in the text itself, whole even when they wrap: a line the terminal
// wrapped joins the next for sure; a program that breaks a long address itself (Claude Code's sign-in address runs
// over three lines) leaves it at the screen's right edge and goes on at the start of the next line, which joins too.
// A trailing full stop, comma or closing bracket that isn't the address's own stays out. Links the program marks
// itself (OSC 8) come from xterm and win where both are. Only http and https open; any other kind is shown and can be
// copied, never opened.

/** one row of the screen: its text, a character per cell unless `at` says which column each UTF-16 unit sits on */
export interface Line {
  text: string
  /** the terminal wrapped the row above onto this one */
  wrapped?: boolean
  at?: number[]
}

/** a link's cells on one row: columns from `from` up to (not with) `to` */
export interface Part {
  row: number
  from: number
  to: number
}

export interface Link {
  url: string
  parts: Part[]
}

/** an address ending this close to the right edge was broken there by the program */
const EDGE = 3
const CH = String.raw`[^\s"<>\`─-╿ ]`
const URL_RE = new RegExp(String.raw`(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/` + CH + '+', 'gi')
const RUN_RE = new RegExp('^' + CH + '+')
const SCHEME_RE = /^[a-z][a-z0-9+.-]{0,30}:\/\//i
/** what a program puts before a continued line: indent, a box's side */
const LEAD_RE = /^[ \t│┃]*/
const TAIL_RE = /[\s│┃]*$/
const MAX = 4096

/** a character and the cell it sits on */
type Ch = { c: string; row: number; col: number }

/** the screen's rows as lines of text, a row the terminal wrapped joined onto the one above */
function logical(lines: Line[], first: number): Ch[][] {
  const out: Ch[][] = []
  lines.forEach((l, i) => {
    const row = first + i
    const chs = l.text.split('').map((c, k) => ({ c, row, col: l.at?.[k] ?? k }))
    if (l.wrapped && out.length) out[out.length - 1].push(...chs)
    else out.push(chs)
  })
  return out
}

const text = (chs: Ch[]) => chs.map((x) => x.c).join('')
/** the row's text less trailing blanks and a box's right side */
const body = (chs: Ch[]) => text(chs).replace(TAIL_RE, '')

/** the address's end, less what reads as the sentence's: a full stop, a comma, a quote, a bracket it never opened */
export function trimEnd(url: string): string {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' }
  const count = (s: string, c: string) => s.split(c).length - 1
  for (;;) {
    const last = url.at(-1) ?? ''
    if (/[.,;:!?'"*_~]/.test(last)) url = url.slice(0, -1)
    else if (pairs[last] && count(url, pairs[last]) < count(url, last)) url = url.slice(0, -1)
    else return url
  }
}

/** Every web address on these rows (`first` is the first one's row number), `width` the screen's columns. */
export function findLinks(lines: Line[], width: number, first = 0): Link[] {
  const rows = logical(lines, first)
  const links: Link[] = []
  rows.forEach((chs, li) => {
    const s = text(chs)
    for (const m of s.matchAll(URL_RE)) {
      let got = chs.slice(m.index!, m.index! + m[0].length)
      // broken at the right edge by the program: it goes on at the start of the next line
      let end = m.index! + m[0].length
      let line = chs, next = li + 1
      while (got.length < MAX && end === body(line).length && reachesEdge(line, width) && next < rows.length) {
        const n = rows[next]
        const t = text(n)
        const lead = t.match(LEAD_RE)![0].length
        const run = t.slice(lead).match(RUN_RE)?.[0] ?? ''
        if (!run || SCHEME_RE.test(run)) break
        const rest = t.slice(lead + run.length)
        // a line of words after an address that happened to fill the row is not the address's
        if (rest.trim() && !/[/?&=#%]/.test(run) && lead + run.length < width - EDGE) break
        got = got.concat(n.slice(lead, lead + run.length))
        end = lead + run.length
        line = n
        next++
      }
      const url = trimEnd(text(got))
      got = got.slice(0, url.length)
      if (SCHEME_RE.test(url) && url.length > url.indexOf('//') + 2) links.push({ url, parts: partsOf(got) })
    }
  })
  return links
}

/** the row's last character sits at the screen's right edge, or close to it (a box's border and padding) */
function reachesEdge(chs: Ch[], width: number) {
  const t = body(chs)
  const last = chs[t.length - 1]
  return !!last && last.col >= width - 1 - EDGE
}

function partsOf(chs: Ch[]): Part[] {
  const parts: Part[] = []
  for (const x of chs) {
    const p = parts.at(-1)
    if (p && p.row === x.row && x.col >= p.from) p.to = x.col + 1
    else parts.push({ row: x.row, from: x.col, to: x.col + 1 })
  }
  return parts
}

/** links the program marked (OSC 8), one per run of cells with the same target, merged with the ones found in the
 *  text: a marked link wins where they share a cell */
export function withMarked(found: Link[], marked: Link[]): Link[] {
  const hit = (a: Link, b: Link) => a.parts.some((p) => b.parts.some((q) => p.row === q.row && p.from < q.to && q.from < p.to))
  return [...marked, ...found.filter((f) => !marked.some((m) => hit(f, m)))]
}

/** the link on this cell */
export const linkAt = (links: Link[], row: number, col: number) => links.find((l) => l.parts.some((p) => p.row === row && col >= p.from && col < p.to)) ?? null

/** only a web page opens; file:, javascript: and the rest can only be copied */
export function opens(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
