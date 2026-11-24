import { expect, test } from 'bun:test'
import { HEARTBEAT, heartbeatDue } from './link.ts'

// "Not seeing your responses in chat": a socket that died without closing kept the chat still while the page stayed on
// screen. A quiet link on screen is pinged, and replaced when it doesn't answer (kernel.ts).
test('a link on screen that heard nothing for a while is checked; a busy, hidden or already asked one is not', () => {
  expect(heartbeatDue(HEARTBEAT, 0, true, false)).toBe(true)
  expect(heartbeatDue(HEARTBEAT - 1, 0, true, false)).toBe(false)
  expect(heartbeatDue(HEARTBEAT, 0, false, false)).toBe(false)
  expect(heartbeatDue(HEARTBEAT, 0, true, true)).toBe(false)
})
