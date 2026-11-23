import { afterAll, expect, test } from 'bun:test'

// SHEP-331: the Tasks filter is kept on this device across visits, with the list's other kept choices
// a stand-in for the browser's storage, taken away after: other files' tests (the outbox) read it when it is there
const was = (globalThis as { localStorage?: unknown }).localStorage
afterAll(() => {
  if (was === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
  else (globalThis as { localStorage?: unknown }).localStorage = was
})
const kept = new Map<string, string>([['shepherdr.ui', JSON.stringify({ tf: { state: ['done'], machine: 'vm', here: true } })]])
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
}

test('the filter comes back on the next visit, cleaned, and a change is kept', async () => {
  const { getState, setUI } = await import(`./kernel.ts?kept=${Date.now()}`)
  expect(getState().ui.tf).toEqual({ state: ['done'], machine: [], space: [], repo: [], here: true, hideDone: false })
  setUI({ tf: { state: [], machine: ['vm'], space: ['shop'], repo: ['vm:/srv/shop'], here: false, hideDone: true } })
  expect(JSON.parse(kept.get('shepherdr.ui')!).tf).toEqual({ state: [], machine: ['vm'], space: ['shop'], repo: ['vm:/srv/shop'], here: false, hideDone: true })
})
