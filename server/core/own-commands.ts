/** A launch's own shepherdr command, by what it may do without a permission prompt. secret run and secret env stay
 *  out: one runs any program, the other writes any ignored file. A verb that isn't listed only keeps its card. */
const OWN = ['help', 'show', 'models', 'set', 'unset', 'alert', 'space', 'task', 'status', 'ask', 'plan', 'review', 'pr', 'checks', 'ready', 'merge',
  'heartbeat', 'automation', 'todo', 'artifact', 'secret list', 'secret ask']

/** Claude's allow rules for this exact path. A path a rule can't state literally gets none, never a wider rule. */
export const ownRules = (command: string) => /^[\w@%+=:,./-]+$/.test(command) ? OWN.map(words => `Bash(${command} ${words}:*)`) : []

// One plain word: no expansion, redirect, separator or line break can sit outside a quote, or $ and ` inside one.
const WORD = /(?:[\w@%+=:,./-]+|'[^']*'|"(?:[^"\\$`]|\\["\\])*")+/y
const unquote = (word: string) => word.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_, single?: string, double?: string) => single ?? double!.replace(/\\(.)/g, '$1'))

/** The words of one simple shell command, or undefined for anything that isn't exactly that. */
function simpleCommand(text: string) {
  const words: string[] = []
  let at = 0
  while (at < text.length) {
    if (text[at] === ' ' || text[at] === '\t') { at++; continue }
    WORD.lastIndex = at
    const match = WORD.exec(text)
    if (!match) return undefined
    words.push(unquote(match[0]))
    at = WORD.lastIndex
  }
  return words
}

/** Whether a Codex permission request is only this launch's own command: what ownRules allows on Claude. */
export function ownCommand(command: string, tool: unknown, input: unknown) {
  const text = (input as { command?: unknown } | null | undefined)?.command
  if (tool !== 'Bash' || typeof text !== 'string') return false
  const words = simpleCommand(text.trim())
  if (words?.[0] !== command) return false
  return OWN.some(own => { const parts = own.split(' '); return parts.every((part, index) => words[index + 1] === part) })
}
