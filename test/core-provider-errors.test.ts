// A turn cut off by the model's provider: each CLI's log says so (on recorded endings in samples/endings, from
// herdr-projects' tests: the "-made" ones are written by hand in a recorded one's shape), which errors pass by
// themselves, and the waits and tries before the human hears.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.SHEPHERDR_HOME = mkdtempSync(join(tmpdir(), 'shep-retry-'))
const { readerFor } = await import('../server/common/readers/index.ts')
const { providerError } = await import('../server/common/provider-error.ts')

const ending = (name: string) => {
  const cli = name.split('-')[0]
  const lines = readFileSync(join(import.meta.dir, 'samples', 'endings', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((text, i) => ({ text, offset: i * 1000 }))
  const ev = readerFor(cli)!.parse(lines, `/logs/${name}.jsonl`)
  const e = ev.find((x) => x.kind === 'error')
  if (e?.kind !== 'error') throw new Error(`${name}: no error read`)
  // the turn is over with it
  expect(ev.findLastIndex((x) => x.kind === 'turn-end')).toBeGreaterThan(ev.indexOf(e))
  return providerError(e.text, e.code, e.status)
}

describe("each CLI's log says what cut its turn off", () => {
  test('errors that pass by themselves are waited out', () => {
    expect(ending('claude-overloaded-made')).toEqual({ passing: true, reason: 'Provider overloaded' })
    expect(ending('claude-rate-limit-made')).toEqual({ passing: true, reason: 'Rate limited' })
    expect(ending('codex-at-capacity')).toEqual({ passing: true, reason: 'Model at capacity' })
    expect(ending('pi-socket-closed')).toEqual({ passing: true, reason: 'Connection dropped' })
    expect(ending('pi-overloaded')).toEqual({ passing: true, reason: 'Provider overloaded' })
    expect(ending('pi-gateway-502').passing).toBe(true)
  })

  test('errors waiting cannot fix go on at once, in a few words', () => {
    expect(ending('claude-usage-limit-made')).toEqual({ passing: false, reason: 'Out of allowance until 5pm' })
    expect(ending('claude-model-not-found')).toEqual({ passing: false, reason: 'Model not available' })
    expect(ending('codex-unauthorized')).toEqual({ passing: false, reason: 'Signed out' })
    expect(ending('codex-model-not-supported')).toEqual({ passing: false, reason: 'Model not available' })
    expect(ending('pi-unknown-provider').passing).toBe(false)
    expect(providerError('Your input exceeds the context window of this model.', 'context_window_exceeded').reason).toBe('Context window full')
    expect(providerError("You've hit your limit · resets 5pm (Europe/Oslo)").reason).toBe('Out of allowance until 5pm')
    expect(providerError('Login expired · Please run /login', 'authentication_failed')).toEqual({ passing: false, reason: 'Signed out' })
    // anything not recognised is not waited out
    expect(providerError('Something odd happened')).toEqual({ passing: false, reason: 'Provider error' })
  })
})
