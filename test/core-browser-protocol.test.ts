import { expect, test } from 'bun:test'
import { BROWSER_OSC, BROWSER_PACKET_MAX, browserOpen, browserPacket, BrowserFrames } from '../server/core/browser-protocol.ts'

test('browser frames survive split UTF-8 and ignore core repaint bytes without trusting them', () => {
  const got: unknown[] = [], key = 'test-key', parser = new BrowserFrames(key, value => got.push(value))
  const value = { type: 'state', title: '🙂', driver: 'agent' }
  const bytes = Buffer.concat([Buffer.from('\x1b[2Jold screen'), BROWSER_OSC, Buffer.from(browserPacket(key, 'down', value)), Buffer.from([7])])
  for (const byte of bytes) parser.push(Buffer.from([byte]))
  expect(got).toEqual([value])
  parser.push(Buffer.concat([BROWSER_OSC, Buffer.from(browserPacket(key, 'down', { type: 'hello' })), Buffer.from([7])]))
  expect(got).toHaveLength(2)
})

test('browser packets reject forged, reflected and oversized payloads', () => {
  expect(() => browserOpen('wrong-key', 'up', browserPacket('key', 'up', { type: 'take' }))).toThrow('authentication')
  expect(() => browserOpen('key', 'down', browserPacket('key', 'up', { type: 'take' }))).toThrow('authentication')
  expect(() => browserPacket('key', 'down', { text: 'x'.repeat(BROWSER_PACKET_MAX) })).toThrow('limit')
  const parser = new BrowserFrames('key', () => {})
  expect(() => parser.push(Buffer.concat([BROWSER_OSC, Buffer.alloc(BROWSER_PACKET_MAX + 1, 'x')]))).toThrow('limit')
})
