// A `!` command typed in the box: it runs in the agent's own shell, as in Claude Code (bash mode) and Codex, and its row
// in the chat says what it printed and whether it ran fine. Other agents have no such shell: the box says so and offers
// your own terminal instead of sending the words as a message.
import type { Message } from '@shared/types.ts'

/** the agents whose box runs a `!` line as a shell command */
export const RUNS_COMMANDS = new Set(['claude', 'codex'])

/** words that run as a command: they start with `!` and say more than that (core/send.js isCommand) */
export const isCommand = (text: string | undefined) => /^\s*!/.test(text ?? '') && (text ?? '').trim().length > 1

/** what the box does with these words for this agent: "run" (a command), "cant" (this agent runs none: they don't
 *  go), or null (a message). An agent not known yet (its chat still starting) gets the command. */
export function commandMode(text: string, agent: string | null | undefined): 'run' | 'cant' | null {
  if (!isCommand(text)) return null
  return !agent || RUNS_COMMANDS.has(agent) ? 'run' : 'cant'
}

export type CommandState = 'sending' | 'running' | 'done' | 'failed' | 'unsent'

/** a row's command state: the log's, else one of yours on its way (sending) or that didn't go (unsent); null for a
 *  message that is no command */
export function commandOf(m: Message, shown: { pending?: boolean; failed?: string; mark?: string }): CommandState | null {
  if (m.command) return m.command.state
  if (m.who !== 'you' || !m.id.startsWith('out:') || !isCommand(m.text)) return null
  if (shown.failed !== undefined) return 'unsent'
  // in the agent's box: it runs now; still on its way: sending
  return shown.mark === 'sent' ? 'running' : 'sending'
}

/** the quiet word after the command: how it went */
export const commandWord: Record<CommandState, string> = { sending: 'Sending…', running: 'Running…', done: 'Done', failed: 'Failed', unsent: 'Not sent' }
