// SHEP-186: a message's suggested replies (the agent's <hc suggest> lines, core/chat-log.js, or one per option when it
// ends with a numbered question): the web app's bubbles (web/plugins/chat/suggest.ts) and the glance feed's `suggest`
// (service/glance.ts) both read them here, so they always agree.

/** the most bubbles shown for an ordinary reply */
export const MAX_SUGGESTS = 3
/** the most bubbles shown when the reply ends with a question and its options: one per option */
export const MAX_OPTION_SUGGESTS = 5
/** a bubble made from an option is at most this long (the agents' own limit) */
export const SUGGEST_CHARS = 40

/** a message's suggested replies, in order: the agent's own, at most MAX_SUGGESTS (an older service's single suggest is
 *  one). When the message ends with a question and its numbered or lettered options, one bubble per option, at most
 *  MAX_OPTION_SUGGESTS: the agent's own bubble for an option where it gave one, else one made from the option. */
export function suggestsOfMessage(m: { text?: string; suggest?: string; suggests?: string[] }): string[] {
  const all = m.suggests?.length ? m.suggests : m.suggest ? [m.suggest] : []
  const own = [...new Set(all.map((t) => t.trim()).filter(Boolean))]
  const opts = choicesOf(m.text ?? '')
  if (!opts.length) return own.slice(0, MAX_SUGGESTS)
  if (own.length >= opts.length) return own.slice(0, MAX_OPTION_SUGGESTS)
  // too few: each option gets the agent's bubble that starts with its label (more than a bare "1"), else its own; the
  // agent's others after
  const used = new Set<string>()
  const out = opts.map((o) => {
    const mine = own.find((t) => !used.has(t) && labelOf(t)?.toLowerCase() === o.label.toLowerCase())
    if (mine) used.add(mine)
    if (mine && /^\(?\w{1,2}[.),:]?$/.test(mine)) return o.bubble
    return mine ?? o.bubble
  })
  for (const t of own) if (!used.has(t) && !out.includes(t) && !labelOf(t)) out.push(t)
  return out.slice(0, MAX_OPTION_SUGGESTS)
}

// an option's line: "1." "1)" "a." "(b)" "**2.**" with its words after
const ITEM = /^\s{0,3}(?:[-*]\s+)?\**\(?([0-9]{1,2}|[a-zA-Z])[.)]\**\s+(\S.*)$/
// a bubble that starts with an option's label: "1", "1, …", "2. …", "b) …"
const LABEL = /^\(?([0-9]{1,2}|[a-zA-Z])(?:[.),:]|\s*$|\s+[-–—]|\s+(?=\S))/
function labelOf(t: string): string | null {
  const m = LABEL.exec(t.trim())
  // a lone letter word ("a quick fix") isn't a label: a letter counts only before . ) , : or alone
  if (!m) return null
  if (/^[a-zA-Z]$/.test(m[1]!) && !/^\(?[a-zA-Z](?:[.),:]|$)/.test(t.trim())) return null
  return m[1]!
}

const plain = (t: string) => t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim()

/** The options a message ends with, when it asks: a numbered (1, 2, 3…) or lettered (a, b, c…) list, last in the
 *  message, right after a line that ends with a question mark. "Other" (the person types that) is left out. Each:
 *  its label and a bubble of its own (the label and the option's first words, at most SUGGEST_CHARS). An ordinary
 *  list (steps, a summary, no question right before it) is none. */
export function choicesOf(text: string): { label: string; bubble: string }[] {
  const lines = text.replace(/\s+$/, '').split('\n')
  // the list's items, read from the end up: an item's wrapped lines (indented, or plain text under it) belong to it
  const items: { label: string; words: string }[] = []
  let more: string[] = []
  let i = lines.length - 1
  for (; i >= 0; i--) {
    const line = lines[i]!
    const m = ITEM.exec(line)
    if (m) {
      items.unshift({ label: m[1]!, words: [m[2]!, ...more].join(' ') })
      more = []
      continue
    }
    if (!line.trim()) {
      if (more.length) break // a paragraph after the list: the message doesn't end with it
      continue
    }
    if (!items.length || /^\s/.test(line)) {
      if (!items.length && !/^\s/.test(line)) return [] // the message ends with words, not a list
      more.unshift(line.trim())
      continue
    }
    break
  }
  if (more.length || items.length < 2) return []
  // in order: 1, 2, 3… or a, b, c… (either case)
  const first = items[0]!.label
  const num = /^[0-9]+$/.test(first)
  const ok = items.every((it, k) => num ? it.label === String(Number(first) + k) && Number(first) <= 1 : it.label.toLowerCase().charCodeAt(0) === 97 + k)
  if (!ok) return []
  // the question: the line right before the list (a blank line between is fine) ends with "?" (or "?:")
  let q = i
  while (q >= 0 && !lines[q]!.trim()) q--
  if (q < 0 || !/\?\s*:?$/.test(plain(lines[q]!))) return []
  return items
    .map((it) => ({ label: it.label, words: plain(it.words) }))
    .filter((it) => !/^(other|something else)\b/i.test(it.words))
    .map((it) => ({ label: it.label, bubble: bubbleOf(it.label, it.words) }))
}

// "1. One card per provider" from "One card per provider (recommended) — keeps it simple": the first words, up to a
// dash, a colon or a sentence's end, cut at a word to SUGGEST_CHARS
function bubbleOf(label: string, words: string): string {
  const head = words.split(/\s+[-–—]\s+|:\s|\.\s|\s\(/)[0]!.replace(/[.:,;]+$/, '').trim() || words
  let t = `${label}. ${head}`
  if (t.length > SUGGEST_CHARS) {
    t = t.slice(0, SUGGEST_CHARS + 1)
    const cut = t.lastIndexOf(' ')
    t = (cut > label.length + 2 ? t.slice(0, cut) : t.slice(0, SUGGEST_CHARS)).replace(/[\s,.;:–—-]+$/, '')
  }
  return t
}

// Settings › Agents › Suggested replies: on unless it's off (the snapshot's rows, as Everywhere has it)
export function suggestionsOn(settings: { rows: { key: string; value: string }[] }[] | undefined): boolean {
  return (settings ?? []).flatMap((s) => s.rows).find((r) => r.key === 'agents.suggestions')?.value !== 'off'
}
