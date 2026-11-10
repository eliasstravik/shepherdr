import { expect, test } from 'bun:test'
import type { Action, AgentPick } from '@shared/types.ts'
import { restartPermission } from './permissions.ts'

const menu = (current: AgentPick) => ({ current, menus: { [current.agent]: { perms: [{ id: 'manual' }, { id: 'auto' }] } } })

test('applying a permission change preserves the model, reasoning and speed read at confirmation', async () => {
  const calls: unknown[] = []
  const latest = { agent: 'claude', model: 'sonnet', effort: 'high', fast: true, perm: 'manual' }
  const act = async (a: Action) => {
    calls.push(a)
    return calls.length === 1 ? { menu: menu(latest) } : { ok: true }
  }
  await restartPermission(act, 'p:space', 'claude', 'auto')
  expect(calls).toEqual([
    { type: 'model-menu', chat: 'p:space' },
    { type: 'restart', chat: 'p:space', kind: 'claude', model: 'sonnet', effort: 'high', speed: 'fast', perm: 'auto' },
  ])
})

test('a permission-only restart keeps default model and reasoning choices unset', async () => {
  const calls: unknown[] = []
  const act = async (a: Action) => {
    calls.push(a)
    return calls.length === 1 ? { menu: menu({ agent: 'claude', model: null, effort: null, fast: false, perm: 'manual' }) } : { ok: true }
  }
  await restartPermission(act, 'p:space', 'claude', 'auto')
  expect(calls[1]).toEqual({ type: 'restart', chat: 'p:space', kind: 'claude', model: '', effort: '', speed: 'normal', perm: 'auto' })
})

test('an agent changed while the menu was open is never switched back by a permission choice', async () => {
  const calls: unknown[] = []
  const act = async (a: Action) => {
    calls.push(a)
    return { menu: menu({ agent: 'codex', model: 'gpt-5', perm: 'manual' }) }
  }
  await expect(restartPermission(act, 'p:space', 'claude', 'auto')).rejects.toThrow('The agent changed.')
  expect(calls).toHaveLength(1)
})

test('failed refresh, removed mode and a mode already applied never restart the agent', async () => {
  for (const result of [
    { error: 'Its machine is offline.' },
    { menu: { current: { agent: 'claude', perm: 'manual' }, menus: { claude: { perms: [{ id: 'manual' }] } } } },
    { menu: menu({ agent: 'claude', perm: 'auto' }) },
  ]) {
    const calls: unknown[] = []
    const act = async (a: Action) => { calls.push(a); return result }
    const pending = restartPermission(act, 'p:space', 'claude', 'auto')
    if (result.menu?.current.perm === 'auto') expect(await pending).toEqual({ ok: true })
    else await expect(pending).rejects.toThrow()
    expect(calls).toHaveLength(1)
  }
})
