// When a chat shows its agent's working sign (SHEP-313): only while herdr says its agent is working and it is in a turn
// that ends in a reply, or its log has the turn it is on, so the sign can never stick after it stops or while only its
// background work runs, and never while it waits on the human.
import type { Chat } from '@shared/types.ts'
import { waitingReport } from '@shared/view.ts'

/** a question card it posted last (its own, or the CLI's menu) waits on the human, whatever the terminal says;
 *  Shepherdr's update cards don't count */
function asks(chat: Chat) {
  const last = chat.messages.findLast((m) => !m.waiting && !m.card)
  return !!(last?.question && !last.question.queued && !last.question.closed && last.question.sent === undefined)
}

/** it works on a turn that ends in words you will see */
export function typing(chat: Chat) {
  if (!chat.working || chat.background || chat.finished) return false
  return !asks(chat)
}

/** herdr says it works and its log has the turn it is on, and no card of its waits on the human */
export function working(chat: Chat) {
  if (!chat.working || !chat.live || chat.live.end || chat.finished) return false
  return !asks(chat)
}

// Programs a step can name, as plain words for the working sign (SHEP-357): a command line never shows there.
const PROGRAMS: [RegExp, string][] = [
  [/^(python3?|node|bun|deno|ruby|perl) (-|-c|-e|<<|--eval)/, 'Running a script'],
  [/(^|\s)(test|pytest|unittest|jest|vitest|mocha)\b|\b(bun|npm|pnpm|yarn|go|cargo|deno) test\b/, 'Running tests'],
  [/^(npm|pnpm|yarn|bun|pip3?|uv|cargo|go|brew|apt(-get)?) (i|install|add|ci|sync|get)\b/, 'Installing packages'],
  [/\b(build|tsc|make|vite build|webpack|esbuild)\b/, 'Building'],
  [/^git\b/, 'Using git'],
  [/^gh\b/, 'Using GitHub'],
  [/^(curl|wget)\b/, 'Fetching a page'],
  [/^sleep\b/, 'Waiting'],
  [/^(ls|cat|head|tail|sed|grep|rg|ugrep|find|fd|wc|tree|less|stat|diff|jq|awk)\b/, 'Looking through files'],
  [/^(python3?|node|bun|deno|ruby|perl|php|bash|sh|zsh)\b/, 'Running a script'],
]

// a run of words a person wrote ("the build", "Unit tests"), not a command line ("python3 - <<'EOF' p='web", "git
// status", "ls"): letters only, and its first word no program's name
const words = (s: string) => /^[\p{L}\d'’,. ]+$/u.test(s) && !/[.,]$/.test(s.split(' ')[0])
const NAMES = new Set('git gh bun bunx npm npx pnpm yarn node deno python python3 pip pip3 uv go cargo rustc make cmake ls cat head tail sed grep rg ugrep find fd wc jq awk curl wget sleep echo printf cd cp mv rm mkdir touch chmod tar zip unzip docker kubectl ssh scp rsync tsc vite pytest jest vitest sh bash zsh hc brew apt sudo env kill ps lsof tmux open xdg-open'.split(' '))
const plain = (s: string) => words(s) && s.includes(' ') && !NAMES.has(s.split(' ')[0]) && !/\d/.test(s.split(' ')[0])

/** A step as plain words: what a tool does ("Reading app.ts", "Running tests"), or its agent's own words, never a
 *  command line, a regular expression or a long path. */
export function stepWords(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim()
  const run = /^(Running|Ran|Started|Watching) (.+)$/.exec(s)
  if (run) {
    const [, verb, what] = run
    if (plain(what)) return s
    const cmd = what.replace(/^(sudo|env( \w+=\S*)*|time|timeout \S+|nohup|\w+=\S*) /, '')
    const known = PROGRAMS.find(([re]) => re.test(cmd))?.[1]
    if (verb === 'Started') return 'Started a command in the background'
    if (verb === 'Watching') return 'Watching a command'
    return known ?? 'Running a command'
  }
  const find = /^(Searching for|Looking for) (.+)$/.exec(s)
  if (find) return words(find[2].replace(/[“”"]/g, '')) && find[2].length <= 40 ? s : find[1] === 'Looking for' ? 'Looking for files' : 'Searching the code'
  // anything else that looks like code (a tool's own raw input) reads as the tool at work
  if (/[<>|&;$`{}\\]|=['"]|\s--?\w/.test(s)) return 'Working'
  return s
}

/** The working sign at the chat's end: null when it doesn't show; else the step it is on, one line of plain words
 *  ('' when nothing is known: the sign alone). Its agent's own status line (`said`, a task's herdr-task status) comes
 *  first, then what its log says it does now. It goes with the turn: once herdr says it stopped working, it ended or
 *  crashed, or a card of its waits on you. Words that arrive mid-turn land above it; it stays below them while the next
 *  step runs. */
export function signOf(chat: Chat | undefined, said?: string): { step: string } | null {
  if (!chat || chat.notice === 'ended' || chat.notice === 'gone') return null
  const live = working(chat)
  if (!live && !typing(chat)) return null
  const now = live ? chat.live?.now : undefined
  const own = said?.replace(/\s+/g, ' ').trim()
  return { step: (!waitingReport(own) && own) || stepWords(chat.doing || now?.doing || now?.title || '') }
}

// SHEP-421: the step line stays for as long as the sign shows. A chat's last named step is held here until the next
// one replaces it (between tools its agent thinks or writes, and the step it was on still reads true), and goes with
// the sign. Before any step is known it reads "Thinking". SHEP-430: it is held for its turn only (the person's last
// message starts one), so a step from an earlier turn never shows, even when the sign was not on screen as it ended.
const held = new Map<string, { turn: string; step: string }>()

/** the turn a chat is on: its newest message from the person */
const turnOf = (chat: Chat | undefined) => chat?.messages.findLast((m) => m.who === 'you')?.id ?? ''

/** the words beside the sign: this step, else the last one this chat named in this turn while the sign showed, else
 *  "Thinking"; pass null when the sign doesn't show, which forgets it */
export function heldStep(key: string, sign: { step: string } | null, chat?: Chat): string {
  if (!sign) {
    held.delete(key)
    return ''
  }
  const turn = turnOf(chat)
  if (sign.step) held.set(key, { turn, step: sign.step })
  const h = held.get(key)
  return (h && h.turn === turn && h.step) || 'Thinking'
}
