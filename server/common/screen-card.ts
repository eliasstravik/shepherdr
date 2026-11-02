import type { Choice } from '../../shared/types.ts'

/** What a CLI's own screen says, in terms no CLI or prompt is named in: its menu, or a press of Enter, and the words above. */
export interface ReadScreen { words: string; choices: Choice[]; at: number }

const MARKER = /^(\s*[❯›▶►➤→>]\s+)(.*)$/u
const TICK = /^[✔✓]\s+/u
const NUMBER = /^\d{1,2}[.)]\s+/
const ENTER = /press enter|enter to continue/i
const MOST_WORDS = 8
/** a frame of the usual Braille spinner or Claude Code's, starting a line, in a box or not: any other symbol there may mean something */
const SPINNER = /^([\s│┃]*)[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✢✳✶✻✽](?=\s|$)/u

/** box sides turn to spaces, so columns stay where the CLI drew them */
const cleaned = (text: string) => text.split('\n').map(line => line.replace(/[│┃]/g, ' ').trimEnd())
const indent = (line: string) => line.length - line.trimStart().length
/** words, not a logo, a rule or a spinner */
const wordy = (line: string) => { const text = line.replace(/\s/g, ''); return text.length > 2 && [...text.matchAll(/\p{L}/gu)].length * 2 > text.length }

interface Option { line: number; column: number; label: string }
const optionAt = (line: string, index: number, numbered: boolean, column: number): Option | undefined => {
  const mark = line.match(MARKER), text = mark ? mark[2] : line.trimStart(), tick = text.match(TICK)?.[0] ?? ''
  const label = text.slice(tick.length), at = (mark ? mark[1].length : indent(line)) + tick.length
  if (at !== column || numbered !== NUMBER.test(label)) return undefined
  return { line: index, column: at, label: label.replace(NUMBER, '').replace(/\s{2,}/g, ' · ') }
}

function menuAt(lines: string[], line: number) {
  const mark = lines[line].match(MARKER)
  if (!mark) return undefined
  const tick = mark[2].match(TICK)?.[0] ?? '', numbered = NUMBER.test(mark[2].slice(tick.length)), column = mark[1].length + tick.length
  // numbered menus may space their choices out; a plain one ends at its first blank line
  const walk = (step: 1 | -1) => {
    let end = line
    for (let at = line + step, blanks = 0; at >= 0 && at < lines.length; at += step) {
      if (!lines[at]) { if (!numbered || ++blanks > 1) break; continue }
      blanks = 0
      if (optionAt(lines[at], at, numbered, column)) end = at
      else if (indent(lines[at]) <= column) break
      else if (step > 0) end = at
    }
    return end
  }
  const top = walk(-1), bottom = walk(1), options: { label: string; description?: string; line: number }[] = []
  for (let at = top; at <= bottom; at++) {
    const option = optionAt(lines[at], at, numbered, column)
    if (option) options.push({ label: option.label, line: at })
    else if (lines[at] && options.length) options.at(-1)!.description = [options.at(-1)!.description, lines[at].trim()].filter(Boolean).join(' ')
  }
  return options.length > 1 ? { top, options, current: options.findIndex(option => option.line === line) } : undefined
}

/** the words just above: back to a logo or rule, or a wide gap */
function wordsAbove(lines: string[], end: number, most: number) {
  const words: string[] = []
  for (let at = end - 1, blanks = 0; at >= 0 && words.filter(Boolean).length < most; at--) {
    if (!lines[at]) { if (++blanks > 1 && words.length) break; continue }
    if (!wordy(lines[at])) { if (words.length) break; blanks = 0; continue }
    if (blanks && words.length) words.unshift('')
    blanks = 0
    words.unshift(lines[at].trim())
  }
  return words.join('\n').trim()
}

/** a link wrapped at the screen's edge, whole, whatever else keeps it from the words */
const links = (lines: string[], width: number, words: string) => {
  const found = lines.flatMap((line, at) => {
    if (!/https?:\/\//.test(line)) return []
    let link = line.slice(line.search(/https?:\/\//)), end = at
    while (lines[end].length >= width && lines[end + 1]) link += lines[++end]
    return [link.split(/\s/)[0]]
  })
  return [...new Set(found)].filter(link => !words.includes(link))
}
const withLinks = (words: string, lines: string[], width: number) => [words, ...links(lines, width, words)].filter(Boolean).join('\n\n')

/** The menu lowest on the screen, for it is the one in play: a line with the CLI's cursor mark and at least one sibling
 *  beside it. */
const cursorLine = (lines: string[]) => lines.findLastIndex((_, line) => menuAt(lines, line))

/** The choices are in screen order, and `at` is the one the cursor is on. */
export function readScreen(text: string, width = Infinity): ReadScreen {
  const lines = cleaned(text), line = cursorLine(lines)
  if (line >= 0) {
    const menu = menuAt(lines, line)!
    return { words: withLinks(wordsAbove(lines, menu.top, MOST_WORDS), lines.slice(0, menu.top), width), choices: menu.options.map(({ label, description }) => ({ label, ...(description ? { description } : {}) })), at: menu.current }
  }
  const enter = lines.findLastIndex(line => ENTER.test(line))
  return { words: withLinks(wordsAbove(lines, enter >= 0 ? enter : lines.length, MOST_WORDS), lines, width), choices: enter >= 0 ? [{ label: 'Continue' }] : [], at: 0 }
}

/** Letters only, so a screen with a timer on it still settles enough to show. It says nothing went unseen: that is `screenText`. */
export const sameScreen = (text: string) => cleaned(text).join(' ').replace(/[^\p{L}]+/gu, ' ').trim()
/** The screen as it is, all but what moves with no one touching the words: the menu's cursor and a spinner's frame. A tap
 *  needs this to match what the card was drawn from, whatever the card had room for. */
export function screenText(text: string) {
  const lines = text.split('\n'), plain = cleaned(text), cursor = cursorLine(plain)
  if (cursor >= 0) { const mark = plain[cursor].search(/\S/); lines[cursor] = `${lines[cursor].slice(0, mark)} ${lines[cursor].slice(mark + 1)}` }
  return lines.map(line => line.replace(SPINNER, '$1 ').trimEnd()).join('\n')
}
/** the keys that move from the cursor to a choice and take it */
export const pressKeys = (at: number, choice: number) => [...Array(Math.abs(choice - at)).fill(choice < at ? 'up' : 'down'), 'enter']
