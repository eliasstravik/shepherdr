import { afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { forgetPresses, HOLD_MAX, press, pressOf, shortError, SHOW_AFTER, waiting } from './pending.ts'
import { ActBtn, ActError, type CardActs } from './ui.tsx'

// A tap on a card's button that asks the server (Mark as done, Allow once, an answer): it answers at once, waits
// busy until the server says, and never shows done before it did (SHEP-450).

afterEach(() => forgetPresses())
const later = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** a server that answers when told */
function server() {
  let answer!: (v: string | null) => void
  const asked = new Promise<string | null>((r) => (answer = r))
  return { run: () => asked, answer }
}

test('a press waits at once; past a moment its button shows it is busy', async () => {
  const s = server()
  const done = press('review:T-1', 'ready', 'accept', s.run)
  expect(waiting(pressOf('review:T-1', 'ready'))).toBe(true)
  expect(pressOf('review:T-1', 'ready')?.shown).toBe(false)
  await later(SHOW_AFTER + 30)
  expect(pressOf('review:T-1', 'ready')?.shown).toBe(true)
  s.answer(null)
  expect(await done).toBe(true)
})

test('a second tap while it goes is refused: it is never sent twice', async () => {
  const s = server()
  let sent = 0
  const first = press('q:1', '', 'allow', () => (sent++, s.run()))
  // the same card's other button too, wherever that card shows
  expect(await press('q:1', '', 'decline', () => (sent++, s.run()))).toBe(false)
  expect(await press('q:1', '', 'allow', () => (sent++, s.run()))).toBe(false)
  s.answer(null)
  await first
  expect(sent).toBe(1)
})

test('a yes stays busy until the card itself changes: no done before the server says', async () => {
  const s = server()
  const done = press('review:T-1', 'ready', 'accept', s.run)
  s.answer(null)
  await done
  // the server said yes, but the card's state is still Ready: still busy, not done
  expect(waiting(pressOf('review:T-1', 'ready'))).toBe(true)
  expect(pressOf('review:T-1', 'ready')?.shown).toBe(true)
  // the new state came: the press is settled and the card shows its own result
  expect(pressOf('review:T-1', 'done')).toBeUndefined()
})

test('a no brings the button back with the words, and it can be tried again', async () => {
  const s = server()
  const done = press('review:T-1', 'ready', 'accept', s.run)
  s.answer("The pull request can't be merged: its checks failed.")
  expect(await done).toBe(false)
  const p = pressOf('review:T-1', 'ready')
  expect(waiting(p)).toBe(false)
  expect(p?.error).toBe("The pull request can't be merged: its checks failed.")
  const again = server()
  const second = press('review:T-1', 'ready', 'accept', again.run)
  expect(waiting(pressOf('review:T-1', 'ready'))).toBe(true)
  expect(pressOf('review:T-1', 'ready')?.error).toBeUndefined()
  again.answer(null)
  expect(await second).toBe(true)
})

test('a thrown failure (the link down) is a no too', async () => {
  expect(await press('q:2', '', 'c0', () => Promise.reject(new Error('Failed to fetch')))).toBe(false)
  expect(pressOf('q:2', '')?.error).toBe('Failed to fetch')
})

test('without hold a yes lets go at once', async () => {
  expect(await press('x', '', 'a', async () => null, false)).toBe(true)
  expect(pressOf('x', '')).toBeUndefined()
})

test('a held yes whose state never comes lets go in time', () => {
  expect(HOLD_MAX).toBeGreaterThanOrEqual(10_000)
})

test('the error line stays short', () => {
  expect(shortError('  ')).toBe('That did not work. Try again.')
  expect(shortError('x '.repeat(200)).length).toBeLessThanOrEqual(160)
  expect(shortError('two\nlines')).toBe('two lines')
})

const acts = (now: CardActs['now']): CardActs => ({ card: 'review:T-1', at: 'ready', now })
const btn = (a: CardActs, id: string) => renderToStaticMarkup(<ActBtn acts={a} id={id} busy="Marking as done…" run={async () => null}>Mark as done</ActBtn>)

test('the button: its label, then busy words with the Working ring, the others disabled', () => {
  expect(btn(acts(undefined), 'accept')).toContain('>Mark as done<')
  // tapped, before the moment passes: pressed look, label kept
  const going = btn(acts({ which: 'accept', at: 'ready', shown: false }), 'accept')
  expect(going).toContain('going')
  expect(going).toContain('>Mark as done<')
  // past it: the spinner and what it does
  const busy = btn(acts({ which: 'accept', at: 'ready', shown: true }), 'accept')
  expect(busy).toContain('aria-busy="true"')
  expect(busy).toContain('Marking as done…')
  expect(busy).toContain('turn')
  expect(busy).not.toContain('disabled=""')
  // the card's other button can't be pressed meanwhile
  expect(btn(acts({ which: 'accept', at: 'ready', shown: true }), 'later')).toContain('disabled=""')
  // a no: every button back, and the words under them
  const no = acts({ which: 'accept', at: 'ready', shown: false, error: 'It did not merge.' })
  expect(btn(no, 'accept')).not.toContain('disabled=""')
  expect(renderToStaticMarkup(<ActError acts={no} />)).toContain('It did not merge.')
})
