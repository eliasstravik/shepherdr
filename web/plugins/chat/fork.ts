// A copy of a chat's conversation in a new tab (the CLI's own fork). A task's chat whose agent still runs (#1050):
// the server asks first (core/agents.js FORK_LIVE), since a fork would be a second agent in the task's folder; the
// fork goes on only when the person says so, else they keep the live one.
import { act } from '@client/kernel.ts'

type Ask = { title: string; detail: string; verb: string; cancel: string }

export async function forkChat(chat: string, confirm: (text: string) => boolean = (t) => window.confirm(t)) {
  const r = (await act({ type: 'fork', chat } as never)) as { ok?: boolean; ask?: Ask }
  if (!r?.ask) return true
  const a = r.ask
  if (!confirm(`${a.title}\n\n${a.detail}\n\nOK: ${a.verb}. Cancel: ${a.cancel}.`)) return false
  await act({ type: 'fork', chat, force: true } as never)
  return true
}
