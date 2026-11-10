// SHEP-186: the suggested next message the chat box shows greyed out (the agent's reply's last line, core/chat-log.js).
import type { Chat } from '@shared/types.ts'

// SHEP-186: the suggested next message the box shows greyed out: the newest text is the agent's, it carries a suggestion
// (its reply's last line, core/chat-log.js) and the person hasn't written after it. Off in Settings: none. { id, text } or null.
export function suggestionOf(chat: Chat | undefined, on: boolean): { id: string; text: string } | null {
  if (!on || !chat) return null
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]!
    if (!m.text) continue
    if (m.who === 'you' || m.error) return null
    return m.suggest ? { id: m.id, text: m.suggest } : null
  }
  return null
}
// Settings › Agents › Suggested next message: on unless it's off (the snapshot's rows, as Everywhere has it)
export function suggestionsOn(settings: { rows: { key: string; value: string }[] }[] | undefined): boolean {
  return (settings ?? []).flatMap((s) => s.rows).find((r) => r.key === 'agents.suggestions')?.value !== 'off'
}
