import { describe, expect, test } from 'bun:test'
import { afterLoad, IDLE_AFTER, mayRetry, RETRY_AFTER, safeNow, type Now } from './update.ts'

const calm: Now = { holds: 0, call: false, modal: false, composer: false, hidden: false, idleMs: IDLE_AFTER }

describe('a newer web app (SHEP-337)', () => {
  test('reloads by itself when nothing would be lost and the page is hidden or idle', () => {
    expect(safeNow(calm)).toBe(true)
    expect(safeNow({ ...calm, idleMs: 0, hidden: true })).toBe(true)
  })
  test('waits (the chip shows) while in use, typing, dictating, uploading, in a call or with a sheet open', () => {
    expect(safeNow({ ...calm, idleMs: 5000 })).toBe(false)
    expect(safeNow({ ...calm, composer: true, hidden: true })).toBe(false)
    expect(safeNow({ ...calm, holds: 1, hidden: true })).toBe(false)
    expect(safeNow({ ...calm, call: true, hidden: true })).toBe(false)
    expect(safeNow({ ...calm, modal: true, hidden: true })).toBe(false)
  })
  test('says "Updated to …" once after a reload that brought the new build', () => {
    const mark = { from: 'assets/old.js', to: 'assets/new.js', at: 1000 }
    expect(afterLoad(mark, 'assets/new.js', '3.2.3', 2000)).toEqual({ said: 'Updated to 3.2.3', keep: null })
    // the mark is gone, so the next load says nothing
    expect(afterLoad(null, 'assets/new.js', '3.2.3', 3000)).toEqual({ said: null, keep: null })
  })
  test('a reload that brought the same old page back is not tried again by itself for a while', () => {
    const mark = { from: 'assets/old.js', to: 'assets/new.js', at: 1000 }
    const r = afterLoad(mark, 'assets/old.js', '3.2.2', 2000)
    expect(r).toEqual({ said: null, keep: mark })
    expect(mayRetry(r.keep, 'assets/old.js', 2000)).toBe(false)
    expect(mayRetry(r.keep, 'assets/old.js', 1000 + RETRY_AFTER)).toBe(true)
    expect(afterLoad(mark, 'assets/old.js', '3.2.2', 1000 + RETRY_AFTER).keep).toBeNull()
    expect(mayRetry(null, 'assets/old.js', 2000)).toBe(true)
  })
})

test('a release is a new build even when the screen code is the same (SHEP-337)', async () => {
  const { buildId } = await import('@shared/build.ts')
  const page = (v: string) => `<meta name="shepherdr-version" content="${v}"><script src="./assets/index-a.js"></script>`
  expect(buildId(page('3.2.2'))).not.toBe(buildId(page('3.2.3')))
  expect(buildId(page('3.2.2'))).toBe('assets/index-a.js v3.2.2')
})
