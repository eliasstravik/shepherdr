// Update <agent>: a chat whose agent (Claude Code, Codex) has a newer version shows a small update button beside its
// agent line, and the row in its menu (a space's header menu, a task's ⋯). Either asks first, then the server runs
// the CLI's own update on the chat's machine and reopens the chat on the same conversation
// (service/agent-update.ts). An agent that can't update this way never shows either.
import { act, dismissNotice, getState, notice, type MenuRow } from '@client/kernel.ts'
import { confirm } from '@client/overlay.tsx'
import { IB } from '@client/ui.tsx'
import type { Chat } from '@shared/types.ts'

const NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }

/** what a chat's agent can update to, and its name; null when there is nothing to update */
export function updateOf(chat: Chat | undefined): { name: string; to: string } | null {
  const a = chat?.agent
  if (!a?.update || !NAMES[a.kind] || chat?.finished) return null
  return { name: NAMES[a.kind], to: a.update }
}

const going = new Set<string>()

/** asks, then updates: a spinner while it runs (a minute or so), then what happened */
export function askUpdate(key: string) {
  const u = updateOf(getState().chats[key])
  if (!u || going.has(key)) return
  confirm({
    title: `Update ${u.name}?`,
    body: `${u.name} ${u.to} is out. ${u.name} closes, updates and opens again on this same conversation. If the update fails, it keeps running as it is.`,
    ok: 'Update',
    run: async () => {
      going.add(key)
      const spin = notice(`Updating ${u.name}…`, { busy: true })
      try {
        const r = await act<{ ok?: boolean; error?: string; words?: string }>({ type: 'agent-update', chat: key })
        dismissNotice(spin)
        if (r.ok === false) notice(r.error || 'The update did not work.', { tone: 'error' })
        else notice(r.words || `${u.name} is updated.`, { tone: 'ok' })
      } catch (e) {
        dismissNotice(spin)
        notice(e instanceof Error && e.message ? e.message : 'The update did not work.', { tone: 'error' })
      } finally {
        going.delete(key)
      }
    },
  })
}

/** the chat's menu row: "Update Claude Code", the new version at its right */
export function updateRows(key: string): MenuRow[] {
  const u = updateOf(getState().chats[key])
  return u ? [{ icon: 'reload', label: `Update ${u.name}`, value: u.to, run: () => askUpdate(key) }] : []
}

/** the quiet hint beside the agent line: a small update button, only while a newer version is out */
export function UpdateHint({ chat }: { chat: Chat | undefined }) {
  const u = updateOf(chat)
  if (!u || !chat) return null
  return <IB icon="reload" className="agent-upd" label={`Update ${u.name} to ${u.to}`} onClick={() => askUpdate(chat.key)} />
}
