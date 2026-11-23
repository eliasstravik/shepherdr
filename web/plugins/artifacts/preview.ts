// An artifact tile's picture (SHEP-344): never a broken image. The picture is taken when a version is published, but a
// machine with no browser (or a shot that failed) has none for that version, and asking anyway showed the browser's
// broken-image icon. A tile shows a calm empty frame until its picture has loaded, tries again a few times, and else
// shows the page's first lines instead.

/** what a tile's frame shows: nothing yet (the calm empty frame), the picture, or the page's first lines */
export type Shot = { tries: number; shown: 'wait' | 'pic' | 'lines' }

/** how long to wait before each try again (ms): a picture still on its way, a machine slow to answer */
export const RETRIES = [2000, 5000, 12000]

/** a tile's start: its version has a picture (ask for it) or not (its first lines at once) */
export const startShot = (thumb: boolean): Shot => ({ tries: 0, shown: thumb ? 'wait' : 'lines' })

export const loaded = (s: Shot): Shot => ({ ...s, shown: 'pic' })

/** the picture didn't come: try again after `retryIn` ms, or, the tries used, its first lines */
export function failed(s: Shot): { shot: Shot; retryIn: number | null } {
  if (s.tries < RETRIES.length) return { shot: { tries: s.tries + 1, shown: 'wait' }, retryIn: RETRIES[s.tries]! }
  return { shot: { ...s, shown: 'lines' }, retryIn: null }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      try { return String.fromCodePoint(n) } catch { return m }
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })

/** A page's first lines of words, as text only (never run, never drawn as HTML): its headings and paragraphs, in
 *  order, without its head, scripts, styles or drawings. `head` marks a heading. */
export function firstLines(html: string, max = 6): { text: string; head: boolean }[] {
  const body = /<body[^>]*>([\s\S]*)/i.exec(html)?.[1] ?? html.replace(/<head[\s\S]*?<\/head>/i, '')
  const clean = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|select|button|nav)\b[\s\S]*?<\/\1\s*>/gi, '')
  const out: { text: string; head: boolean }[] = []
  // each block's words: a heading, a paragraph, a list item, a cell, a quote, a caption, a block of text
  const block = /<(h[1-6]|p|li|td|th|blockquote|figcaption|dt|dd|pre|summary)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
  for (let m; (m = block.exec(clean)) && out.length < max; ) {
    const text = decode(m[2]!.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (text) out.push({ text: text.length > 160 ? `${text.slice(0, 159)}…` : text, head: /^h/i.test(m[1]!) })
  }
  if (!out.length) {
    // a page of plain divs: its words as they come
    const text = decode(clean.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (text) out.push({ text: text.length > 300 ? `${text.slice(0, 299)}…` : text, head: false })
  }
  return out
}
