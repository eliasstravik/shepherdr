import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeReset, parseClaude, parseCodex, sealArgs } from '../helper/core-plan-limits.ts'
import { CorePlanLimits, nextRead } from '../server/core/plan-limits.ts'
import { CoreStore } from '../server/core/store.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { MachineLimits } from '../shared/types.ts'

const NOW = Date.UTC(2026, 10, 1, 7, 0)

test('reads Claude Code\'s own /usage words, whatever windows it reports', () => {
  const text = 'You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 41% used · resets 11:59am (UTC)\nCurrent week (all models): 10% used · resets Nov 6, 11:59am (UTC)\nCurrent week (Fable): 0% used · resets Nov 6, 12pm (UTC)\n\nWhat\'s contributing to your limits usage?\n  69%  Start fresh when you switch tasks · run /clear'
  expect(parseClaude(text, NOW)).toEqual({ state: 'ok', windows: [
    { name: '5-hour', used: 41, resetsAt: Date.UTC(2026, 10, 1, 11, 59) },
    { name: 'Weekly (all models)', used: 10, resetsAt: Date.UTC(2026, 10, 6, 11, 59) },
    { name: 'Weekly (Fable)', used: 0, resetsAt: Date.UTC(2026, 10, 6, 12, 0) },
  ] })
})

test('a reset with no date is the next such time, and one past the new year is next year\'s', () => {
  expect(claudeReset('3am (UTC)', NOW)).toBe(Date.UTC(2026, 10, 2, 3, 0))
  expect(claudeReset('12am (UTC)', NOW)).toBe(Date.UTC(2026, 10, 2, 0, 0))
  expect(claudeReset('12pm (UTC)', NOW)).toBe(Date.UTC(2026, 10, 1, 12, 0))
  expect(claudeReset('Jan 2, 4pm (UTC)', Date.UTC(2026, 11, 30))).toBe(Date.UTC(2027, 0, 2, 16, 0))
  expect(claudeReset('soon', NOW)).toBeUndefined()
})

test('words it can\'t place stay the CLI\'s own, never a made-up moment', () => {
  expect(parseClaude('Current week (all models): 10% used · resets next Tuesdayish', NOW)).toEqual({ state: 'ok', windows: [{ name: 'Weekly (all models)', used: 10, resets: 'next Tuesdayish' }] })
})

test('no limits in the answer is signed out, no plan or unknown, never a number', () => {
  expect(parseClaude('Not logged in · Please run /login', NOW)).toEqual({ state: 'signed-out' })
  expect(parseClaude('Total cost:            $0.0000\nTotal duration (API):  0s', NOW)).toEqual({ state: 'no-plan' })
  expect(parseClaude('You are currently using your subscription to power your Claude Code usage', NOW).state).toBe('unknown')
})

test('reads Codex\'s windows by their own length, with a limit of its own named', () => {
  const limit = { limitId: 'codex', limitName: null, primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1793775820 }, secondary: { usedPercent: 68, windowDurationMins: 10080, resetsAt: 1793800000 }, planType: 'pro' }
  const other = { limitId: 'codex_x', limitName: 'GPT-X', primary: { usedPercent: 5, windowDurationMins: 10080 }, secondary: null, planType: 'pro' }
  expect(parseCodex({ rateLimits: limit, rateLimitsByLimitId: { codex_x: other, codex: limit } })).toEqual({ state: 'ok', plan: 'pro', windows: [
    { name: '5-hour', used: 12, resetsAt: 1793775820000 }, { name: 'Weekly', used: 68, resetsAt: 1793800000000 }, { name: 'GPT-X · Weekly', used: 5 },
  ] })
  expect(parseCodex({ rateLimits: { ...limit, primary: { usedPercent: 1, windowDurationMins: 1440 }, secondary: null } })).toMatchObject({ windows: [{ name: '1-day', used: 1 }] })
  expect(parseCodex({ rateLimits: { limitId: 'codex', primary: null, secondary: null } }).state).toBe('unknown')
})

test('the seal leaves only the CLI\'s own folder writable, with its settings read-only inside it', () => {
  const args = sealArgs(['claude', '-p', '/usage'], '/h/.claude', ['/h/.claude.json', '/h/.claude/settings.json'], '/tmp')
  expect(args.slice(0, 3)).toEqual(['bwrap', '--ro-bind', '/'])
  const at = (flag: string, path: string) => args.findIndex((word, i) => word === flag && args[i + 1] === path)
  expect(at('--bind', '/h/.claude')).toBeGreaterThan(0)
  expect(at('--ro-bind', '/h/.claude/settings.json')).toBeGreaterThan(at('--bind', '/h/.claude')) // Later mounts win.
  expect(at('--ro-bind', '/h/.claude.json')).toBeGreaterThan(0)
  expect(args.slice(-4)).toEqual(['--', 'claude', '-p', '/usage'])
})

test('a failed read keeps the last good numbers at their age; anything else replaces them', () => {
  const good = { state: 'ok' as const, at: 1, windows: [{ name: 'Weekly', used: 10 }] }
  expect(nextRead(good, { state: 'unknown', why: 'Timed out' }, 9)).toEqual({ ...good, failed: 'Timed out' })
  expect(nextRead(good, { state: 'signed-out' }, 9)).toEqual({ state: 'signed-out', at: 9 })
  expect(nextRead(undefined, { state: 'unknown', why: 'Timed out' }, 9)).toEqual({ state: 'unknown', why: 'Timed out', at: 9 })
})

async function fixture(run: (context: { limits: CorePlanLimits; answer: { value: unknown }; calls: string[][]; store: CoreStore; emits: string[]; online: { value: boolean } }) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-limits-')), store = new CoreStore(home), calls: string[][] = [], emits: string[] = []
  const answer: { value: unknown } = { value: {} }, online = { value: true }
  const source = { store, quiescing: false, machineIds: () => ['box'], machineConnected: () => online.value, emit(name: string) { emits.push(name) }, agents: { bun: async () => process.execPath },
    files: { exec: async (_machine: string, argv: string[]) => { calls.push(argv); if (answer.value instanceof Error) throw answer.value; return Buffer.from(JSON.stringify(answer.value)) } } } as unknown as CoreSource
  const limits = new CorePlanLimits(source)
  try { await run({ limits, answer, calls, store, emits, online }) }
  finally { limits.stop(); await limits.drain(); store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('core reads through exec, never through an agent, and leaves a CLI the machine lacks out', () => fixture(async ({ limits, answer, calls, emits }) => {
  answer.value = { claude: { state: 'ok', windows: [{ name: 'Weekly', used: 10, resetsAt: NOW }] } }
  await limits.refresh()
  expect(calls[0][1]).toBe('-e')
  expect(calls[0][2]).toContain('account/rateLimits/read')
  expect(limits.view('box')).toMatchObject({ claude: { state: 'ok', windows: [{ name: 'Weekly', used: 10 }] } })
  expect(limits.view('box')!.codex).toBeUndefined()
  expect(emits).toEqual(['snapshot'])
}))

test('a machine read a moment ago is left alone when asked, and a machine out of reach isn\'t tried', () => fixture(async ({ limits, answer, calls, online }) => {
  answer.value = { codex: { state: 'signed-out' } }
  await limits.refresh()
  await limits.refresh(60_000)
  expect(calls).toHaveLength(1)
  online.value = false
  await limits.refresh()
  expect(calls).toHaveLength(1)
}))

test('a broken answer is unknown, and losing the machine keeps what was read, at its age', () => fixture(async ({ limits, answer, store }) => {
  answer.value = { claude: { state: 'ok', windows: [{ name: 'Weekly', used: 'many' }] } }
  await limits.refresh()
  expect(limits.view('box')!.claude).toMatchObject({ state: 'unknown' })
  store.set('plan-limits', 'box', { claude: { state: 'ok', at: 5, windows: [{ name: 'Weekly', used: 10 }] } } satisfies MachineLimits)
  answer.value = new Error('Command timed out with a token-looking word')
  await limits.refresh()
  expect(limits.view('box')).toEqual({ claude: { state: 'ok', at: 5, windows: [{ name: 'Weekly', used: 10 }], failed: "Couldn't reach this machine's CLIs" } })
}))

test('with its plugin off nothing runs and nothing shows', () => fixture(async ({ limits, answer, calls }) => {
  answer.value = {}
  Object.assign((limits as unknown as { source: object }).source, { plugins: { has: () => false } })
  await limits.refresh()
  expect(calls).toHaveLength(0)
  expect(limits.view('box')).toBeUndefined()
}))
