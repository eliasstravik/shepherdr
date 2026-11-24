// A tap on a button that asks the server for something (Mark as done, Allow once, an answer, Restart): it answers at
// once. One press per card at a time: the card's buttons wait while it goes (a second tap can't send it twice); the one
// tapped says what it does ("Marking as done…") with a spinner once it takes longer than a moment; then the card
// shows the server's answer: the card changes when the server's state does, or the button comes back with a short
// error to try again. Never done before the server said so. One store for every card, so the same card in Everything's
// chat and in its space's chat (and its task) waits together.

/** how long a press may take before its button shows it is busy (ms): a quick answer never flickers a spinner */
export const SHOW_AFTER = 150
/** a press the server said yes to waits for the card's own change; after this long it lets go anyway (ms) */
export const HOLD_MAX = 30_000

/** a card's press in flight, or its last one that failed */
export interface Press {
  /** which of its buttons */
  which: string
  /** the card's state when it was pressed: a new state settles it */
  at: string
  /** past SHOW_AFTER: its button shows it is busy */
  shown: boolean
  /** the server said yes: it waits for the card to change */
  held?: boolean
  /** the server said no, in its words */
  error?: string
}

const presses = new Map<string, Press>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => {
  version++
  for (const l of listeners) l()
}

export function onPresses(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const pressVersion = () => version

/** A card's press now: undefined when it has none, or once the card moved on from the state it was pressed in. */
export function pressOf(card: string, at: string): Press | undefined {
  const p = presses.get(card)
  return p && p.at === at ? p : undefined
}

/** whether a card waits on a press now (its buttons can't be pressed again) */
export const waiting = (p: Press | undefined) => !!p && !p.error

/**
 * Presses `which` on `card` (in its state `at`): `run` asks the server and says null for yes, else its error words.
 * Refused while that card already waits on one. `hold`: a yes still waits until the card's state changes (the card
 * then shows the result); without it, a yes lets go at once (the card changed itself, or nothing is to change).
 * Resolves with whether the server said yes (false when refused).
 */
export async function press(card: string, at: string, which: string, run: () => Promise<string | null>, hold = true): Promise<boolean> {
  if (waiting(pressOf(card, at))) return false
  const mine: Press = { which, at, shown: false }
  presses.set(card, mine)
  changed()
  const show = setTimeout(() => {
    if (presses.get(card) !== mine) return
    mine.shown = true
    changed()
  }, SHOW_AFTER)
  let error: string | null
  try {
    error = await run()
  } catch (e) {
    error = e instanceof Error && e.message ? e.message : 'That did not work.'
  }
  clearTimeout(show)
  if (presses.get(card) !== mine) return error === null
  if (error !== null) {
    presses.set(card, { which, at, shown: false, error: shortError(error) })
  } else if (hold) {
    // busy until the card's state moves on (pressOf stops matching); a state that never comes lets go in time
    presses.set(card, { ...mine, shown: true, held: true })
    const held = presses.get(card)
    setTimeout(() => {
      if (presses.get(card) === held) {
        presses.delete(card)
        changed()
      }
    }, HOLD_MAX)
  } else presses.delete(card)
  changed()
  return error === null
}

/** forgets a card's error (its next press, or the person closing it) */
export function clearPress(card: string) {
  if (presses.delete(card)) changed()
}

/** a server's words cut to one short line: the card shows it under its buttons */
export function shortError(text: string) {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return 'That did not work. Try again.'
  return line.length > 160 ? `${line.slice(0, 157).replace(/\s+\S*$/, '')}…` : line
}

/** for tests: no presses */
export function forgetPresses() {
  presses.clear()
  changed()
}
