import type { Action, AgentPick } from '@shared/types.ts'

type Result = { ok?: boolean; error?: string; menu?: { current: AgentPick; menus: Record<string, { perms?: { id: string }[] }> } }

export async function restartPermission(act: (a: Action) => Promise<Result>, chat: string, agent: string, perm: string | null) {
  const r = await act({ type: 'model-menu', chat } as never)
  if (!r.menu) throw new Error(r.error || "Couldn't read what it runs on.")
  const { current, menus } = r.menu
  if (current.agent !== agent) throw new Error('The agent changed. Reopen Permissions before applying.')
  if (!perm || !menus[agent]?.perms?.some((p) => p.id === perm)) throw new Error('That permission mode is no longer available.')
  if (current.perm === perm) return { ok: true }
  return act({ type: 'restart', chat, kind: current.agent, model: current.model ?? '', effort: current.effort ?? '', speed: current.fast ? 'fast' : 'normal', perm } as never)
}
