// Restart and End in a chat's menu (a space's header menu, a task's ⋯): a way out for a running agent, even a stuck
// one, on a phone too. Restart closes it and opens it again on the same CLI, model and conversation, as Update
// <agent> (update.tsx) and the Stopped card do (service: agent-restart → Agents.revive). End asks first, then stops a
// space's Assistant (assistant-close); its tasks keep running, and the next message starts it again.
import { getState, tryAct, type MenuRow } from '@client/kernel.ts'
import { confirm } from '@client/overlay.tsx'
import type { Chat } from '@shared/types.ts'
import type { Space } from '@shared/view.ts'

const NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }

/** the running agent's name in a chat, or null: nothing runs there (not started, ended: its Stopped card restarts) */
export function runningAgent(chat: Chat | undefined): string | null {
  if (!chat || chat.finished || chat.fresh || chat.notice === 'ended' || chat.notice === 'gone') return null
  return NAMES[chat.agent?.kind ?? ''] ?? null
}

/** Restart <agent>: at once, as 3.1's was; nothing is lost, it picks up the same conversation */
export function restartRows(key: string): MenuRow[] {
  const name = runningAgent(getState().chats[key])
  return name ? [{ icon: 'reload', label: `Restart ${name}`, run: () => void tryAct({ type: 'agent-restart', chat: key }, `${name} restarted.`, `Restarting ${name}…`) }] : []
}

/** End <agent>, a space's Assistant only (a task has Stop and Mark as done) */
export function endRows(p: Space): MenuRow[] {
  const name = runningAgent(getState().chats[p.chat])
  if (!name) return []
  const ask = () =>
    confirm({
      title: `End ${name}?`,
      body: `It stops now, even mid-turn. Its tasks keep running. Your next message here starts it again on this same conversation.`,
      ok: 'End',
      danger: true,
      run: () => tryAct({ type: 'assistant-close', place: p.id, mode: 'keep' }, `${name} ended.`, `Ending ${name}…`),
    })
  return [{ icon: 'stop', label: `End ${name}`, run: ask }]
}
