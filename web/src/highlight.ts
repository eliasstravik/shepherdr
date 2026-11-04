// Syntax highlighting for the side panel's Files and Diff: highlight.js with its common languages, loaded the first
// time code shows (its own chunk), the language picked by the file's name. Its output escapes the code it is given.
import type { HLJSApi } from 'highlight.js'

let hljs: HLJSApi | null = null
let loading: Promise<HLJSApi> | null = null

/** highlight.js, once loaded; loading starts on the first ask */
export function loadHighlighter(): Promise<HLJSApi> {
  loading ??= import('highlight.js/lib/common').then((m) => (hljs = m.default))
  return loading
}

export const highlighter = () => hljs

const BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  htm: 'xml',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  yml: 'yaml',
  toml: 'ini',
  sh: 'bash',
  zsh: 'bash',
  md: 'markdown',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  kt: 'kotlin',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  jsonc: 'json',
  webmanifest: 'json',
}

/** the language of a file by its name, if highlight.js knows it */
export function languageOf(path: string, h: HLJSApi): string | null {
  const name = path.split('/').pop() ?? ''
  if (name === 'Makefile') return 'makefile'
  if (name === 'Dockerfile') return h.getLanguage('dockerfile') ? 'dockerfile' : null
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const lang = BY_EXT[ext] ?? ext
  return lang && h.getLanguage(lang) ? lang : null
}

/** the most characters highlighted: past this, code shows plain */
export const HIGHLIGHT_MAX = 300_000

/**
 * Highlighted code, one HTML string per line: a token running over several lines (a block comment) is closed at the
 * end of each line and opened again on the next, so every line stands on its own.
 */
export function highlightLines(text: string, lang: string, h: HLJSApi): string[] {
  const html = h.highlight(text, { language: lang, ignoreIllegals: true }).value
  const out: string[] = []
  let open: string[] = []
  for (const line of html.split('\n')) {
    const start = open.join('')
    const stack = [...open]
    for (const m of line.matchAll(/<span[^>]*>|<\/span>/g)) {
      if (m[0] === '</span>') stack.pop()
      else stack.push(m[0])
    }
    out.push(start + line + '</span>'.repeat(stack.length))
    open = stack
  }
  return out
}

/** one line highlighted alone (a line of a diff) */
export function highlightLine(text: string, lang: string, h: HLJSApi): string {
  return h.highlight(text, { language: lang, ignoreIllegals: true }).value
}

/** text as HTML, for code shown plain */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
