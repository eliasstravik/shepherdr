// A slash command you type in a chat (/clear, /compact, a custom /review) goes into the agent's CLI as
// typed, between turns, so the CLI itself runs it. Shepherdr then follows what it did: a new session's log after /clear
// or /new, and a menu or view it opened in the terminal, which waits for keys there and would take your next message:
// what it showed comes into the chat, and it is closed. /model is the exception: it opens Restart (modelCommand).

/** a slash command as you would type it at the CLI's prompt: "/name" (or "/plugin:name"), then its arguments; a path
 *  ("/home/me/x is broken") is not one */
export const isCommand = (text: string) => /^\/[A-Za-z][\w:.-]*(?:\s|$)/.test(text.trim())

/** the command's name, without its slash */
export const commandName = (text: string) => /^\/([\w:.-]+)/.exec(text.trim())?.[1].toLowerCase() ?? ''

/** the same command, by name: Claude Code logs /new and /reset as /clear */
export function sameCommand(a: string, b: string) {
  if (!isCommand(a) || !isCommand(b)) return false
  const clear = ['clear', 'new', 'reset']
  const [x, y] = [commandName(a), commandName(b)]
  return x === y || (clear.includes(x) && clear.includes(y))
}

/** the commands that go on in another session of the CLI, by CLI */
const SESSION: Record<string, string[]> = {
  claude: ['clear', 'reset', 'new', 'resume', 'continue', 'branch', 'fork'],
  codex: ['new', 'clear', 'resume', 'fork'],
  pi: ['new', 'resume', 'fork', 'tree'],
}

/** does this command start (or switch to) another session of its CLI */
export const startsSession = (kind: string, text: string) => (SESSION[kind] ?? []).includes(commandName(text))

/** does the command still sit in the CLI's input, not run: its Enter went to the list of commands it shows as you
 *  type, or never came. The input is the last line with a prompt mark (❯ › >) near the bottom: what ran shows above. */
export function leftAtPrompt(screen: string, command: string): boolean {
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).slice(-25)
  const input = lines.findLast((l) => /^\s*[❯›>](\s|$)/.test(l))
  if (!input) return false
  const name = command.trim().split(/\s/)[0]
  return input.replace(/^\s*[❯›>]\s*/, '').startsWith(name)
}

/** the hint a CLI shows under a menu or view of its own that waits for keys */
const HINT = /\besc\b.{0,20}\b(cancel|close|back|exit|dismiss)\b/i

/** a rule a CLI draws between its parts (the prompt box's edges, the line above a view), maybe with a word in it */
const isRule = (l: string) => {
  const t = l.replace(/\s/g, '')
  const rule = t.length - t.replace(/[─━▔▁═╌-]/g, '').length
  return rule >= 8 && rule >= t.length * 0.6
}

/**
 * A menu or view the CLI opened on its screen and waits in, after a command: what it shows (its own words, without the
 * key hints under it), or nothing when the CLI is back at its prompt.
 */
export function viewOnScreen(screen: string, command: string): string | undefined {
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, ''))
  while (lines.length && !lines.at(-1)) lines.pop()
  // the hint sits at the bottom, under the view
  const tail = lines.slice(-4)
  const h = tail.findLastIndex((l) => HINT.test(l))
  if (h < 0) return undefined
  const end = lines.length - tail.length + h
  const echo = command.trim().split(/\s/)[0]
  let start = end
  while (start > 0 && end - start < 40) {
    const l = lines[start - 1]
    // a rule, what ran before it (Claude Code's ⎿, Codex's • and "Worked for"), or what was typed (not a menu's
    // pick): the view starts under it
    if (isRule(l) || /^\s*(⎿|•\s|Worked for\b)/.test(l) || /^\s*[❯›>]\s+(?!\d{1,2}[.)]\s)\S/.test(l) || new RegExp(`^\\s*[❯›>]\\s*${echo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l)) break
    start--
  }
  const body = lines.slice(start, end)
  while (body.length && !body[0].trim()) body.shift()
  while (body.length && !body.at(-1)!.trim()) body.pop()
  if (!body.length) return ''
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)))
  return body
    .map((l) => l.slice(indent))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** what the chat says of a view a command opened: what it showed, and that it is closed so your next message goes in;
 *  a menu to pick from is picked by typing the choice after the command */
export function viewNote(command: string, shown: string) {
  const name = `\`${command.trim().split(/\s/)[0]}\``
  const what = shown ? `${name} opened this in the terminal:\n\n\`\`\`\n${shown}\n\`\`\`\n\n` : `${name} opened a menu in the terminal. `
  const menu = !shown || /^\s*(?:[❯›>▶]\s*)?\d{1,2}[.)]\s/m.test(shown)
  return `${what}Closed it, so your next message goes in.${menu ? ` To pick from it, type your choice after the command, like ${name.slice(0, -1)} …\`.` : ''}`
}

/** how long a command has to open its menu or view before the screen is read */
export const VIEW_MS = 2500
