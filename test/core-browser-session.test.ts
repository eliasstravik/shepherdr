import { afterAll, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Browsers } from '../helper/core-browser-session.ts'
import { fakeAgentBrowser } from './fake-agent-browser.ts'
import type { BrowserDown } from '../shared/browser.ts'

const fake = fakeAgentBrowser(), session = '1234567890abcdef'
afterAll(() => fake.stop())
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000
  while (!predicate()) { if (Date.now() > deadline) throw Error('Browser did not reach expected state'); await Bun.sleep(10) }
}

test('core child uses its fixed local session, authentic controls await forwarding and cleanup preserves other sessions', async () => {
  const news: string[] = [], messages: BrowserDown[] = []
  const browser = new Browsers({ bin: fake.bin, owns: id => id === session, env: () => ({ ...fake.env, AGENT_BROWSER_NAMESPACE: 'sc-123456789abc', AGENT_BROWSER_SESSION: session, AGENT_BROWSER_PROFILE: join(fake.dir, session) }), host: 'test', user: () => 'Elias', working: () => true, tell: (_, text) => news.push(text) })
  const bridge = browser.attach(session, { send: raw => messages.push(JSON.parse(raw)), close() {} })
  try {
    // Server acceptance can precede the client's open/status callbacks on a busy runner.
    await until(() => messages.some(message => message.type === 'state' && message.connected))
    await expect(bridge.message(JSON.stringify({ type: 'input_keyboard', eventType: 'keyDown', key: 'Enter' }))).rejects.toThrow()
    expect(fake.fromPanel).toHaveLength(0)
    await bridge.message(JSON.stringify({ type: 'take' }))
    expect(news).toHaveLength(1)
    await bridge.message(JSON.stringify({ type: 'input_keyboard', eventType: 'keyDown', key: 'Enter' }))
    await until(() => fake.fromPanel.length === 1)
    expect(fake.fromPanel[0]).toMatchObject({ key: 'Enter' })
    await bridge.message(JSON.stringify({ type: 'pick', id: 1, x: 20, y: 30 }))
    expect(messages.find(message => message.type === 'picked')).toMatchObject({ pick: { element: 'button "Save"' } })
    expect(fake.cdpCalls.some(call => call.method === 'Page.captureScreenshot')).toBe(false)
    browser.release(session)
    expect(news[1]).toContain('handed the shared browser back')
    fake.state({ connected: true, sessions: [session, 'another-session'] })
    await browser.close('another-session')
    expect(fake.calls().some(call => call.session === 'another-session')).toBe(false)
    await browser.close(session)
    expect(fake.calls().filter(call => call.args[0] === 'close')).toHaveLength(1)
    expect(fake.calls().every(call => call.namespace === 'sc-123456789abc' && call.session === session)).toBe(true)
  } finally { bridge.end(); await browser.close(session) }
})
