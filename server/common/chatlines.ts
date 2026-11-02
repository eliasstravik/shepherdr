// Chat lines: everything the screen draws beyond text travels as plain lines both ways, taught by one skill every
// agent gets (like an iPhone sending a reaction to an Android phone as text). Each is an XML-style tag on a line of its
// own: its facts as attributes (double quotes in them made curly, so the tag stays whole), any words between its tags.
//
//   <reaction from="Elias" emoji="👍" to="PR #52 is ready to merge"/>
//   <reaction-removed from="Elias" emoji="👍" to="PR #52 is ready to merge"/>
//   <reaction from="Elias" emoji="👍" file="screenshot.png" path="~/inbox/screenshot.png"/>   (a file: by its path)
//   <reaction from="Elias" emoji="👍" title="Weekly board" artifact="wk3n" version="2"/>   (an artifact card)
//   <attachment from="Elias" name="screenshot.png" path="~/inbox/screenshot.png"/>
//   <answer from="Elias" question="Rerun CI on main?">Rerun it</answer>
//   <artifact-sent from="Elias" title="Weekly board" artifact="wk3n" version="2">Pinned colour: Accent</artifact-sent>
//   <artifact-comment from="Elias" title="Weekly board" artifact="wk3n" version="2">Make the bars blue</artifact-comment>
//   <artifact-note from="Elias" title="Weekly board" artifact="wk3n" version="2" on="“Send” (button.primary in Board)">Make it say “Send event”.</artifact-note>
//   <reply from="Elias" to="Tests pass on the branch">Merge it then</reply>     (the start of the message it answers)
//   <reply from="Elias" to="Weekly board · v2" artifact="wk3n">Bars in blue</reply>     (an artifact card)
//   <browser-notes from="Elias" url="http://localhost:5173/" title="Settings" viewport="1280×720">   (the shared
//   1. button "Save"                                                                  browser's Mark up: one
//      Note: Make it say "Save changes".                                              or more notes, numbered as
//      Selector: form > button.primary                                                their pins; each shot follows
//      ...                                                                            as an attachment)
//   </browser-notes>
//   agent → <react emoji="👀" to="What needs me today?"/>   or   <react emoji="👀" file="screenshot.png" path="~/inbox/screenshot.png"/>
//   agent → <reply to="What needs me today?"/>      a line of its own, then its reply
//   agent → <no-reply>SHE-72 merged, nothing to do</no-reply>   a reply that is only this shows nothing (news with nothing to say)
//
// Shepherdr's own lines to agents are <shepherdr type="news">…</shepherdr> and the like (agents.ts hidden). The older
// [square bracket] lines still read back, from agents started before the change and from old chat logs.

import type { BrowserNote } from '../../shared/browser.ts'
import { excerpt } from '../../shared/excerpt.ts'
import { artifactQuote, type ArtifactPost } from '../../shared/types.ts'

export { excerpt }

/** a value as an attribute: on one line, its double quotes made curly */
const attr = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/"([^"]*)"/g, '“$1”').replace(/"/g, '”')

/** a tag: <name a="…"/>, or <name a="…">words</name> when it has words (empty ones too) */
export function tag(name: string, attrs: Record<string, string | number | undefined>, body?: string) {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${attr(String(v))}"`)
    .join('')
  return body === undefined ? `<${name}${a}/>` : `<${name}${a}>${body}</${name}>`
}

/** an artifact by its title, id and the version shown, so its keeper knows what to update */
type Art = { title: string; artifact: string; version: number }

export const line = {
  react: (user: string, emoji: string, text: string) => tag('reaction', { from: user, emoji, to: excerpt(text) }),
  unreact: (user: string, emoji: string, text: string) => tag('reaction-removed', { from: user, emoji, to: excerpt(text) }),
  /** a file by its path, which no other file has: two files may share a name */
  reactFile: (user: string, emoji: string, name: string, path: string) => tag('reaction', { from: user, emoji, file: name, path }),
  unreactFile: (user: string, emoji: string, name: string, path: string) => tag('reaction-removed', { from: user, emoji, file: name, path }),
  reactArtifact: (user: string, emoji: string, art: Art) => tag('reaction', { from: user, emoji, ...art }),
  unreactArtifact: (user: string, emoji: string, art: Art) => tag('reaction-removed', { from: user, emoji, ...art }),
  attach: (user: string, name: string, path: string) => tag('attachment', { from: user, name, path }),
  answer: (user: string, title: string, answer: string) => tag('answer', { from: user, question: title }, answer),
  /** a secret you gave, by its name and where it is kept: never its value */
  secret: (user: string, name: string, where: string) => tag('secret', { from: user, name, for: where }),
  artifact: (title: string, id: string, v: number): Art => ({ title, artifact: id, version: v }),
  artifactSend: (user: string, art: Art, text: string) => tag('artifact-sent', { from: user, ...art }, text),
  artifactSay: (user: string, art: Art, text: string) => tag('artifact-comment', { from: user, ...art }, text),
  /** a note on the artifact, or on one element of it (`on`: its words and where it is) */
  note: (user: string, art: Art, on: string | undefined, note: string) => tag('artifact-note', { from: user, ...art, on }, note),
  /** notes from the shared browser's Mark up, numbered as their pins; their shots go as attachments after */
  browserNotes: (user: string, page: { url: string; title?: string; viewport?: { w: number; h: number } }, notes: BrowserNote[]) =>
    tag(
      'browser-notes',
      { from: user, url: page.url, title: page.title || undefined, viewport: page.viewport ? `${page.viewport.w}×${page.viewport.h}` : undefined },
      `\n${notes.map((n, i) => browserNote(i + 1, n, page.url)).join('\n')}\n`,
    ),
  /** your words in reply to a message (a file by its name): the words may run over several lines */
  reply: (user: string, quoted: string, text: string) => tag('reply', { from: user, to: excerpt(quoted) }, text),
  /** your words in reply to an artifact's card: by its title and version, and its id */
  replyArtifact: (user: string, art: Art, text: string) => tag('reply', { from: user, to: artifactQuote(art.title, art.version), artifact: art.artifact }, text),
}

/** one note: what and where, your words, then what helps find it in the code; continuation lines are indented */
function browserNote(n: number, { comment, pick: p }: BrowserNote, url: string) {
  const one = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()
  const pad = '   '
  const out = [`${n}. ${one(p.element)}`, `${pad}Note: ${comment.trim().replace(/\n/g, `\n${pad}      `)}`, `${pad}Selector: ${one(p.selector)}`]
  const facts = [p.text && `Text: "${one(p.text)}"`, p.nearby && `Near: "${one(p.nearby)}"`, p.react && `React: ${one(p.react)}`, p.attrs && `Attributes: ${one(p.attrs)}`, p.a11y && `Accessibility: ${one(p.a11y)}`]
  const where = [`Box: x ${p.box.x}, y ${p.box.y}, ${p.box.w}×${p.box.h}${p.fixed ? ' (fixed)' : ''}${p.frame ? ' (inside a frame)' : ''}`, p.classes && `Classes: ${one(p.classes)}`]
  for (const row of [facts, where]) {
    const r = row.filter(Boolean).join(' · ')
    if (r) out.push(pad + r)
  }
  if (p.styles) out.push(`${pad}Styles: ${one(p.styles)}`)
  // a note made on another page than the one the browser shows now says which
  if (p.url && p.url !== url) out.push(`${pad}Page: ${p.url}`)
  if (p.shot) out.push(`${pad}Shot: ${p.shot.split('/').pop()}`)
  return out.join('\n')
}

export type Parsed =
  | { kind: 'react'; emoji: string; to: string; path?: string; artifact?: ArtifactPost }
  | { kind: 'unreact'; emoji: string; to: string; path?: string; artifact?: ArtifactPost }
  | { kind: 'attach'; name: string; path: string }
  | { kind: 'answer'; title: string; answer: string }
  | { kind: 'secret'; name: string; where: string }
  | { kind: 'artifact-send'; title: string; text: string }
  | { kind: 'artifact-say'; title: string; text: string }
  | { kind: 'note'; target: string; note: string }

/** a whole tag on its own: <name a="…"/> or <name a="…">words</name>; a value may hold a stray " (one an agent quoted
 *  by hand) */
function tagOf(s: string): { name: string; a: Record<string, string>; body?: string } | null {
  const m = s.match(/^<([a-z][\w-]*)((?:\s+[\w-]+="[^\n]*?")*)\s*(?:\/>|>([\s\S]*)<\/\1>)$/u)
  if (!m) return null
  const a: Record<string, string> = {}
  for (const x of m[2].matchAll(/([\w-]+)="([^\n]*?)"(?=\s+[\w-]+="|\s*$)/gu)) a[x[1]] = x[2]
  return { name: m[1], a, body: m[3] }
}

/** a reaction's quote: a message's start, a file by its name and path, or an artifact's card by its id and version */
const quoteOf = (a: Record<string, string>) =>
  a.artifact && a.version ? { to: a.title ?? '', artifact: { id: a.artifact, v: Number(a.version) } } : a.path ? { to: a.file ?? a.to ?? '', path: a.path } : { to: a.to ?? a.file ?? '' }

/** the [square bracket] lines from before tags: still read back, from old chat logs and agents started before */
const OLD = {
  react: /^\[(.+?) reacted (\S+) to "(.*)"\]$/u,
  unreact: /^\[(.+?) removed (\S+) from "(.*)"\]$/u,
  reactFile: /^\[(.+?) reacted (\S+) to ([^":]+?): (.+)\]$/u,
  unreactFile: /^\[(.+?) removed (\S+) from ([^":]+?): (.+)\]$/u,
  attach: /^\[(.+?) attached (.+?): (.+)\]$/u,
  answer: /^\[(.+?) answered "(.*?)": ([\s\S]*)\]$/u,
  artifactSend: /^\[(.+?) sent from "(.*?)"(?: \(artifact [\w-]+ v\d+\))?: ([\s\S]*)\]$/u,
  artifactSay: /^\[(.+?) wrote about "(.*?)" \(artifact [\w-]+ v\d+\): ([\s\S]*)\]$/u,
  note: /^\[(.+?) noted on (.*?): ([\s\S]*)\]$/u,
  reply: /^\[(.+?) replied to "(.*?)": ([\s\S]*)\]$/u,
  browserNotes: /^\[(.+?) noted in the browser on (\S+)[^\n]*:\n([\s\S]*)\]$/u,
  agentReact: /^\[react (\S+) to "(.*)"\]$/u,
  agentReply: /^\[reply to "(.*)"\]$/u,
  agentReplyFile: /^\[reply to ([^":]+?): (.+)\]$/u,
  agentReactFile: /^\[react (\S+) to ([^":]+?): (.+)\]$/u,
}

/** a line you sent, read back from the log */
export function parseUserLine(l: string): Parsed | null {
  const s = l.trim()
  const t = s.startsWith('<') ? tagOf(s) : null
  if (t) {
    const { a, body = '' } = t
    if ((t.name === 'reaction' || t.name === 'reaction-removed') && a.emoji) return { kind: t.name === 'reaction' ? 'react' : 'unreact', emoji: a.emoji, ...quoteOf(a) }
    if (t.name === 'attachment' && a.path) return { kind: 'attach', name: a.name ?? a.path.split('/').pop()!, path: a.path }
    if (t.name === 'answer') return { kind: 'answer', title: a.question ?? '', answer: body }
    if (t.name === 'secret' && a.name) return { kind: 'secret', name: a.name, where: a.for ?? '' }
    if (t.name === 'artifact-sent') return { kind: 'artifact-send', title: a.title ?? '', text: body }
    if (t.name === 'artifact-comment') return { kind: 'artifact-say', title: a.title ?? '', text: body }
    if (t.name === 'artifact-note') return { kind: 'note', target: a.on ? `${a.on} in "${a.title ?? ''}"` : `"${a.title ?? ''}"`, note: body }
    return null
  }
  let m: RegExpMatchArray | null
  if ((m = s.match(OLD.react))) return { kind: 'react', emoji: m[2], to: m[3] }
  if ((m = s.match(OLD.unreact))) return { kind: 'unreact', emoji: m[2], to: m[3] }
  if ((m = s.match(OLD.reactFile))) return { kind: 'react', emoji: m[2], to: m[3], path: m[4] }
  if ((m = s.match(OLD.unreactFile))) return { kind: 'unreact', emoji: m[2], to: m[3], path: m[4] }
  if ((m = s.match(OLD.answer))) return { kind: 'answer', title: m[2], answer: m[3] }
  if ((m = s.match(OLD.artifactSend))) return { kind: 'artifact-send', title: m[2], text: m[3] }
  if ((m = s.match(OLD.artifactSay))) return { kind: 'artifact-say', title: m[2], text: m[3] }
  if ((m = s.match(OLD.note))) return { kind: 'note', target: m[2], note: m[3] }
  if ((m = s.match(OLD.attach))) return { kind: 'attach', name: m[2], path: m[3] }
  return null
}

/** the tags whose words may run over several lines */
const LONG = /^<(answer|artifact-sent|artifact-comment|artifact-note|reply|browser-notes)[\s>]/

/** what you sent, line by line, a tag whose words run over several lines kept whole */
export function userLines(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].trim().match(LONG)
    // its last closing tag: the words may hold one of their own
    const close = open && lines.findLastIndex((l, j) => j >= i && l.trimEnd().endsWith(`</${open[1]}>`))
    if (close && close > i && tagOf(lines.slice(i, close + 1).join('\n').trim())) {
      out.push(lines.slice(i, close + 1).join('\n'))
      i = close
    } else out.push(lines[i])
  }
  return out
}

/** the words of a message and the attachments after them, on lines of their own */
function withFiles(text: string) {
  const lines = text.split('\n')
  let end = lines.length
  while (end > 0 && parseUserLine(lines[end - 1])?.kind === 'attach') end--
  return { head: lines.slice(0, end).join('\n').trim(), rest: lines.slice(end) }
}

/** notes from the shared browser, read back from the log: the page and each note's element and words (the files that
 *  follow are its shots) */
export function parseBrowserNotes(text: string): { url: string; notes: { element: string; note: string }[]; rest: string[] } | null {
  const { head, rest } = withFiles(text)
  const t = head.startsWith('<') ? tagOf(head) : null
  const m = t ? null : head.match(OLD.browserNotes)
  const url = t?.name === 'browser-notes' ? t.a.url : m?.[2]
  if (!url) return null
  const notes: { element: string; note: string }[] = []
  for (const l of (t ? t.body! : m![3]).split('\n')) {
    const head = l.match(/^(\d+)\. (.+)$/)
    if (head) notes.push({ element: head[2], note: '' })
    else if (notes.length && l.startsWith('   Note: ')) notes[notes.length - 1].note = l.slice('   Note: '.length)
    else if (notes.length && /^ {9}/.test(l) && notes[notes.length - 1].note) notes[notes.length - 1].note += `\n${l.trim()}`
  }
  return { url, notes, rest }
}

/** your reply to a message, read back from the log: the reply line, then any files that came with it */
export function parseReply(text: string): { to: string; text: string; rest: string[]; line: string; artifact?: string } | null {
  // files go on lines of their own after the words
  const { head: line, rest } = withFiles(text)
  const t = line.startsWith('<') ? tagOf(line) : null
  if (t) return t.name === 'reply' && t.a.from !== undefined ? { to: t.a.to ?? t.a.file ?? '', text: (t.body ?? '').trim(), rest, line, ...(t.a.artifact ? { artifact: t.a.artifact } : {}) } : null
  const m = line.match(OLD.reply)
  return m ? { to: m[2], text: m[3].trim(), rest, line } : null
}

type Quote = { to: string; path?: string }

/** a reply that is only <no-reply>why</no-reply> says nothing (any case, in backticks too): the agent took in news that
 *  needs no words, and the terminal still says why. The older markers ([[noted]], any [[...]], a lone [noted]) still say nothing for agents
 *  started before the rename. */
const NO_REPLY = /^(`?)(<no-reply>(?:(?!<\/no-reply>)[\s\S])*<\/no-reply>|<no-reply\s*\/>)\1$/i
const OLD_MARKER = /^(\[\[[^[\]\n]+\]\]|\[noted\])$/

/** the tags an agent's reply may start with, none of them for the chat as words */
const AGENT_TAGS = ['<no-reply', '<react', '<reply']

/** a reply that is or may become a hidden line as it streams in: one in brackets, or one of those tags or the start of
 *  one */
export const markerSoFar = (words: string) => {
  const w = words.replace(/^`/, '').toLowerCase()
  return w.startsWith('[') || AGENT_TAGS.some((t) => w.startsWith(t) || t.startsWith(w))
}

/** an agent's <react …/> or <reply …/> line; a reply's tag may also open its words (<reply to="…">words</reply>) */
const AGENT_TAG = /^<(react|reply)((?:\s+[\w-]+="[^\n]*?")+)\s*(\/?)>(.*)$/u

/** reactions and a reply the agent wrote as lines of its reply; returns the reply without them (and none for <no-reply>…</no-reply> or an older [[...]] marker) */
export function agentLines(text: string): { text: string; reactions: (Quote & { emoji: string })[]; reply?: Quote } {
  const reactions: (Quote & { emoji: string })[] = []
  let reply: Quote | undefined
  let opened = false
  let kept = text
    .split('\n')
    .flatMap((l) => {
      const s = l.trim()
      let m: RegExpMatchArray | null
      if ((m = s.match(AGENT_TAG))) {
        const t = tagOf(`<${m[1]}${m[2]}/>`)!
        const words = m[4].replace(/<\/reply>$/, '').trim()
        if (m[1] === 'react' && t.a.emoji && (t.a.to ?? t.a.file) !== undefined) {
          reactions.push({ emoji: t.a.emoji, ...quoteOf(t.a) })
          return words ? [words] : []
        }
        if (m[1] === 'reply' && (t.a.to ?? t.a.file) !== undefined && !reply) {
          reply = quoteOf(t.a)
          opened = !m[3] && !m[4].endsWith('</reply>')
          return words ? [words] : []
        }
        return [l]
      }
      if ((m = s.match(OLD.agentReact))) reactions.push({ emoji: m[1], to: m[2] })
      else if ((m = s.match(OLD.agentReactFile))) reactions.push({ emoji: m[1], to: m[2], path: m[3] })
      else if ((m = s.match(OLD.agentReply))) reply ??= { to: m[1] }
      else if ((m = s.match(OLD.agentReplyFile))) reply ??= { to: m[1], path: m[2] }
      return m ? [] : [l]
    })
    .join('\n')
    .trim()
  // the end of a reply its tag opened
  if (opened) kept = kept.replace(/\s*<\/reply>$/, '')
  return { text: NO_REPLY.test(kept) || OLD_MARKER.test(kept) ? '' : kept, reactions, ...(reply ? { reply } : {}) }
}

/** the same words however they were quoted: curly quotes, case, markdown and spacing aside */
const plain = (s: string) =>
  s
    .replace(/[”“„]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/(…|\.\.\.)$/, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** the words of a quote, without the reply line around them when a whole line of ours was quoted */
const quotedWords = (quoted: string) =>
  plain(
    quoted
      .replace(/^\[?[^"\]]*? replied to "[^"]*"?:?\s*/, '')
      .replace(/\]$/, '')
      .replace(/^<reply\b[^>]*>/, '')
      .replace(/<\/reply>$/, ''),
  )

/** does this message start with the quoted excerpt (loose: a quote copied by hand may differ a little) */
export function matches(text: string, quoted: string, loose = false) {
  const a = plain(excerpt(text, 400))
  const b = quotedWords(quoted)
  if (!b) return false
  if (a.startsWith(b)) return true
  // loose: the quote is somewhere in it, or its start is (an agent may shorten or trim it)
  return loose && b.length >= 8 && (a.includes(b) || (b.length >= 24 && a.startsWith(b.slice(0, 24))))
}

/** the latest message a quote names: an exact start first, then a looser match */
export function findQuoted<M extends { text?: string; file?: { name: string; path: string } }>(msgs: M[], to: string, path?: string): M | undefined {
  const rev = [...msgs].reverse()
  if (path) return rev.find((m) => m.file?.path === path)
  const name = to.trim()
  return (
    rev.find((m) => (m.text ? matches(m.text, to) : m.file?.name === name)) ??
    rev.find((m) => !!m.text && matches(m.text, to, true)) ??
    rev.find((m) => !m.text && !!m.file && plain(m.file.name) === plain(name))
  )
}
