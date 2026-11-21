import { describe, expect, test } from 'bun:test'
import { left, nextLook, retryRead, settle, type Got } from './find-state.ts'

const answer = (wait_ms: number): Got => ({ hosts: [{ to: 'box', over: 'ssh' }], last: null, wait_ms })

describe('Find machines (#1108)', () => {
  test('the cooldown counts down on this device and ends', () => {
    const g = settle(null, answer(10 * 60000), 1_000)
    expect(left(g, 1_000)).toBe(10 * 60000)
    expect(left(g, 1_000 + 4 * 60000)).toBe(6 * 60000)
    expect(left(g, 1_000 + 10 * 60000)).toBe(0)   // the button is back without a reload
  })

  test('it looks again as the shown minute changes', () => {
    expect(nextLook(10 * 60000)).toBe(60050)
    expect(nextLook(90_000)).toBe(30_050)
    expect(nextLook(20_000)).toBe(20_050)
  })

  test('a failed first read can be tried again; a later failure keeps what was there', () => {
    const failed = settle(null, { hosts: [], last: null, wait_ms: 0, error: "Couldn't reach Shepherdr." }, 5)
    expect(retryRead(failed)).toBe(true)
    const good = settle(failed, answer(0), 6)
    expect(retryRead(good)).toBe(false)
    expect(good.error).toBeUndefined()
    const cooling = settle(null, answer(60000), 10)
    const after = settle(cooling, { hosts: [], last: null, wait_ms: 0, error: 'nope' }, 20)
    expect(after.hosts.length).toBe(1)
    expect(left(after, 20)).toBe(59990)
    expect(retryRead(after)).toBe(false)
  })
})
